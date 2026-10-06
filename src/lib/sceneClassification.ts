// Free, local "what is this photo of?" — MobileNet (what's mostly in frame) plus COCO-SSD
// (is anyone in it), both self-hosted in public/models so no photo ever leaves the device.
// Used to catch photos of things — a pot being sold, an appliance, a lamp — that pass every
// quality check but aren't a family memory. The decision itself lives in sceneCategories.ts.
//
// Runs inside a Web Worker (see sceneClassification.worker.ts) — the modern tfjs it needs
// would otherwise collide with the ancient tfjs-core bundled inside face-api.js on the main
// thread (two versions fighting over the same global backend registry).
import { summarizeScene, type SceneClassification } from './sceneCategories';
import type { AnalysisImage } from './analysisImage';
import type { FaceCheck } from './faceSummary';
import { isMobileDevice } from './concurrency';

export type { SceneClassification };

// A small pool of identical workers, so several photos' face and scene checks run at the same
// time on a computer's spare cores. Phones get one: each worker holds its own copy of the models.
interface PooledWorker {
  worker: Worker;
  busy: number;
}
type Reply = { id: number; result?: SceneClassification; faces?: FaceCheck; error?: string };

let pool: PooledWorker[] | null = null;
let nextId = 0;
const pending = new Map<number, { resolve: (reply: Reply) => void; owner: PooledWorker }>();

function poolSize(): number {
  return isMobileDevice() ? 1 : Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
}

function getWorker(): PooledWorker {
  if (!pool) {
    pool = Array.from({ length: poolSize() }, () => {
      const entry: PooledWorker = {
        worker: new Worker(new URL('./sceneClassification.worker.ts', import.meta.url), { type: 'module' }),
        busy: 0,
      };
      entry.worker.onmessage = (e: MessageEvent<Reply>) => {
        const job = pending.get(e.data.id);
        if (job) {
          pending.delete(e.data.id);
          job.owner.busy--;
          job.resolve(e.data);
        }
      };
      return entry;
    });
  }
  return pool.reduce((least, w) => (w.busy < least.busy ? w : least));
}

function send(message: Record<string, unknown>, transfer: Transferable[]): Promise<Reply> {
  const owner = getWorker();
  const id = nextId++;
  owner.busy++;
  return new Promise<Reply>((resolve) => {
    pending.set(id, { resolve, owner });
    owner.worker.postMessage({ ...message, id }, transfer);
  });
}

// Whether the sort should run the face check in the worker pool. On phones it stays on the main
// thread, where face-api.js uses the phone's graphics chip and only one extra model copy is held.
export function facesInWorker(): boolean {
  return !isMobileDevice() && typeof OffscreenCanvas !== 'undefined';
}

export async function detectFacesInWorker(input: AnalysisImage): Promise<FaceCheck> {
  const bitmap = await createImageBitmap(input.canvas);
  const reply = await send({ op: 'faces', bitmap }, [bitmap]);
  if (!reply.faces) throw new Error(reply.error ?? 'face check failed');
  return reply.faces;
}

// Given the sort's already-decoded working copy, hands the worker a small ImageBitmap
// (transferred, not copied) instead of the original file, so the worker never decodes the
// full-size photo again.
// 'auto': run the person/pet/food detector only when MobileNet says the photo is mostly an
// object. 'always': also when another check says it looks like a document (which is only set
// aside with nobody in it). 'never': a face was already found, so nothing here can change the
// outcome.
export type DetectMode = 'auto' | 'always' | 'never';

export async function classifyScene(input: Blob | AnalysisImage, detect: DetectMode = 'auto'): Promise<SceneClassification> {
  try {
    const bitmap = input instanceof Blob ? null : await createImageBitmap(input.canvas);
    const reply = bitmap ? await send({ bitmap, detect }, [bitmap]) : await send({ blob: input, detect }, []);
    return reply.result ?? summarizeScene([], null);
  } catch {
    return summarizeScene([], null);
  }
}
