// Free, local scene/object classification — MobileNet v1 (self-hosted in public/models, same
// offline-first pattern as the face-detection models), no AI/API call. Used to catch
// reference/utility photos (a laptop screen, a window frame, a car for sale) that pass every
// quality check but aren't a family memory — pure pixel-quality heuristics can't tell those
// apart from a genuine keeper, since nothing about them is technically "wrong".
//
// Runs inside a Web Worker (see sceneClassification.worker.ts) — the modern tfjs it needs
// would otherwise collide with the ancient tfjs-core bundled inside face-api.js on the main
// thread (two versions fighting over the same global backend registry).
export interface SceneClassification {
  isUtilityPhoto: boolean;
  label: string | null;
  confidence: number;
}

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
    return { isUtilityPhoto: false, label: null, confidence: 0 };
  }
}
