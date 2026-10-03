// Runs in a Web Worker — its own JS scope means the modern @tensorflow/tfjs it loads here
// never shares a module graph with the ancient tfjs-core (v1.7) bundled inside face-api.js on
// the main thread. Two different tfjs-core versions registering the same 'cpu'/'webgl' backend
// names in one global scope corrupts both; keeping them in separate threads sidesteps that
// entirely instead of trying to reconcile two incompatible major versions.
//
// Two free, self-hosted models run here on every photo:
//  - MobileNet (ImageNet, 1000 classes) — what the photo is mostly *of* (a Dutch oven, a lake,
//    a golden retriever). Its top-5 guesses feed sceneCategories.ts.
//  - COCO-SSD (80 object classes, including "person") — whether anyone is actually in frame.
//    ImageNet has no "person" class at all, and face detection misses sleeping babies, backs
//    of heads and people in profile, so this is what keeps those photos safe.
import * as tf from '@tensorflow/tfjs';
import * as cocoSsd from '@tensorflow-models/coco-ssd';
import { IMAGENET_CLASSES } from './imagenetClasses';
import { summarizeScene, type SceneClassification, type SceneDetection, type ScenePrediction } from './sceneCategories';

const MODEL_ROOT = `${import.meta.env.BASE_URL}models`;

let mobilenetPromise: Promise<tf.LayersModel> | null = null;
let detectorPromise: Promise<cocoSsd.ObjectDetection> | null = null;

function loadMobilenet(): Promise<tf.LayersModel> {
  if (!mobilenetPromise) mobilenetPromise = tf.loadLayersModel(`${MODEL_ROOT}/mobilenet/model.json`);
  return mobilenetPromise;
}

function loadDetector(): Promise<cocoSsd.ObjectDetection> {
  if (!detectorPromise) {
    detectorPromise = cocoSsd.load({ base: 'lite_mobilenet_v2', modelUrl: `${MODEL_ROOT}/coco-ssd/model.json` });
  }
  return detectorPromise;
}

const TOP_K = 5;
// Low on purpose — sceneCategories decides how much to trust each score; a faint "person" is
// still worth knowing about before calling something "just an object".
const DETECTION_MIN_SCORE = 0.2;
const DETECTION_MAX_SIZE = 640;

// MobileNet expects a square 224px input. Squashing a 4:3 or 16:9 photo into a square distorts
// everything in it; a centered square crop keeps proportions, the way the model was trained.
async function predictTopK(bitmap: ImageBitmap): Promise<ScenePrediction[]> {
  const model = await loadMobilenet();
  const canvas = new OffscreenCanvas(224, 224);
  const ctx = canvas.getContext('2d');
  if (!ctx) return [];
  const side = Math.min(bitmap.width, bitmap.height);
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 224, 224);

  const prediction = tf.tidy(() => {
    const pixels = tf.browser.fromPixels(ctx.getImageData(0, 0, 224, 224)).toFloat();
    return model.predict(pixels.div(127.5).sub(1).expandDims(0)) as tf.Tensor;
  });
  const data = await prediction.data();
  prediction.dispose();

  const order = Array.from(data.keys()).sort((a, b) => data[b] - data[a]).slice(0, TOP_K);
  return order.map((index) => ({ index, label: IMAGENET_CLASSES[index] ?? String(index), probability: data[index] }));
}

async function detectObjects(bitmap: ImageBitmap): Promise<SceneDetection[]> {
  const detector = await loadDetector();
  const scale = Math.min(1, DETECTION_MAX_SIZE / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  if (!ctx) return [];
  ctx.drawImage(bitmap, 0, 0, w, h);
  const detections = await detector.detect(ctx.getImageData(0, 0, w, h), 20, DETECTION_MIN_SCORE);
  return detections.map((d) => ({ label: d.class, score: d.score, area: (d.bbox[2] * d.bbox[3]) / (w * h) }));
}

self.onmessage = async (e: MessageEvent<{ id: number; blob: Blob }>) => {
  const { id, blob } = e.data;
  let result: SceneClassification;
  try {
    const bitmap = await createImageBitmap(blob);
    try {
      const top = await predictTopK(bitmap);
      const detections = await detectObjects(bitmap).catch(() => null);
      result = summarizeScene(top, detections);
    } finally {
      bitmap.close();
    }
  } catch {
    result = summarizeScene([], null);
  }
  self.postMessage({ id, result });
};
