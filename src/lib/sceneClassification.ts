// Free, local "what is this photo of?" — MobileNet (what's mostly in frame) plus COCO-SSD
// (is anyone in it), both self-hosted in public/models so no photo ever leaves the device.
// Used to catch photos of things — a pot being sold, an appliance, a lamp — that pass every
// quality check but aren't a family memory. The decision itself lives in sceneCategories.ts.
//
// Runs inside a Web Worker (see sceneClassification.worker.ts) — the modern tfjs it needs
// would otherwise collide with the ancient tfjs-core bundled inside face-api.js on the main
// thread (two versions fighting over the same global backend registry).
import { summarizeScene, type SceneClassification } from './sceneCategories';

export type { SceneClassification };

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, (result: SceneClassification) => void>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./sceneClassification.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ id: number; result: SceneClassification }>) => {
      const resolve = pending.get(e.data.id);
      if (resolve) {
        pending.delete(e.data.id);
        resolve(e.data.result);
      }
    };
  }
  return worker;
}

export async function classifyScene(blob: Blob): Promise<SceneClassification> {
  try {
    const w = getWorker();
    const id = nextId++;
    return await new Promise<SceneClassification>((resolve) => {
      pending.set(id, resolve);
      w.postMessage({ id, blob });
    });
  } catch {
    return summarizeScene([], null);
  }
}
