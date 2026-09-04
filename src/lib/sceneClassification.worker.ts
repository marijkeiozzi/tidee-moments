// Runs in a Web Worker — its own JS scope means the modern @tensorflow/tfjs it loads here
// never shares a module graph with the ancient tfjs-core (v1.7) bundled inside face-api.js on
// the main thread. Two different tfjs-core versions registering the same 'cpu'/'webgl' backend
// names in one global scope corrupts both; keeping them in separate threads sidesteps that
// entirely instead of trying to reconcile two incompatible major versions.
import * as tf from '@tensorflow/tfjs';
import { IMAGENET_CLASSES } from './imagenetClasses';

let modelPromise: Promise<tf.LayersModel> | null = null;

function loadModel(): Promise<tf.LayersModel> {
  if (!modelPromise) {
    modelPromise = tf.loadLayersModel('/models/mobilenet/model.json');
  }
  return modelPromise;
}

// See sceneClassification.ts for the rationale behind this list and the confidence threshold.
// Includes marketplace/product-listing subjects (bikes, scooters, carts) and household
// storage/inventory shots (pantry shelves, cupboards, fridges) alongside the original
// office/screen/document set — a studio-background product photo or a "what's in the pantry"
// snapshot is exactly as "not a memory" as a photo of a laptop, and faceCount still protects any
// photo that's actually of a person WITH one of these (a kid proudly riding their new bike, or
// raiding the pantry).
const UTILITY_CLASS_INDICES = new Set<number>([
  446, 475, 479, 481, 482, 485, 487, 508, 511, 526, 527, 535, 549, 556, 581, 590, 592, 605, 620,
  662, 664, 673, 681, 742, 745, 753, 761, 782, 817, 844, 851, 872, 878, 904, 905, 916, 922,
  428, 444, 575, 665, 670, 671, 791, 870, 880,
  453, 495, 553, 582, 648, 729, 760, 894,
]);

const CONFIDENCE_THRESHOLD = 0.35;

export interface SceneClassification {
  isUtilityPhoto: boolean;
  label: string | null;
  confidence: number;
}

async function classify(bitmap: ImageBitmap): Promise<SceneClassification> {
  const model = await loadModel();
  const canvas = new OffscreenCanvas(224, 224);
  const ctx = canvas.getContext('2d');
  if (!ctx) return { isUtilityPhoto: false, label: null, confidence: 0 };
  ctx.drawImage(bitmap, 0, 0, 224, 224);

  const prediction = tf.tidy(() => {
    const pixels = tf.browser.fromPixels(ctx.getImageData(0, 0, 224, 224)).toFloat();
    const normalized = pixels.div(127.5).sub(1);
    const batched = normalized.expandDims(0);
    return model.predict(batched) as tf.Tensor;
  });

  const data = await prediction.data();
  prediction.dispose();

  let bestIdx = 0;
  let bestVal = data[0];
  for (let i = 1; i < data.length; i++) {
    if (data[i] > bestVal) {
      bestVal = data[i];
      bestIdx = i;
    }
  }

  return {
    isUtilityPhoto: UTILITY_CLASS_INDICES.has(bestIdx) && bestVal >= CONFIDENCE_THRESHOLD,
    label: IMAGENET_CLASSES[bestIdx] ?? null,
    confidence: bestVal,
  };
}

self.onmessage = async (e: MessageEvent<{ id: number; blob: Blob }>) => {
  const { id, blob } = e.data;
  try {
    const bitmap = await createImageBitmap(blob);
    try {
      const result = await classify(bitmap);
      self.postMessage({ id, result });
    } finally {
      bitmap.close();
    }
  } catch {
    self.postMessage({ id, result: { isUtilityPhoto: false, label: null, confidence: 0 } });
  }
};
