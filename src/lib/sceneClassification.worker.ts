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
import { setWasmPaths } from '@tensorflow/tfjs-backend-wasm';
import * as cocoSsd from '@tensorflow-models/coco-ssd';
import * as faceapi from '@vladmandic/face-api/dist/face-api.esm-nobundle.js';
import { summarizeFaces, type FaceCheck } from './faceSummary';
import { IMAGENET_CLASSES } from './imagenetClasses';
import { couldBeObjectPhoto, summarizeScene, type SceneClassification, type SceneDetection, type ScenePrediction } from './sceneCategories';
import type { DetectMode } from './sceneClassification';

const MODEL_ROOT = `${import.meta.env.BASE_URL}models`;

// Inside a worker the GPU backend usually isn't available, and TF.js then silently falls back to
// its plain-JavaScript 'cpu' backend — measured at ~3-4 s per photo for these two models. The
// WebAssembly backend (SIMD) runs the same models several times faster and works in workers on
// every current browser, iPhone Safari included. Its .wasm files are self-hosted like the models.
// (The multi-threaded variant needs cross-origin isolation headers GitHub Pages can't send.)
let backendReady: Promise<void> | null = null;
function ensureBackend(): Promise<void> {
  if (!backendReady) {
    backendReady = (async () => {
      setWasmPaths(`${import.meta.env.BASE_URL}tfjs-wasm/`);
      for (const name of ['wasm', 'webgl', 'cpu']) {
        try {
          if (await tf.setBackend(name)) break;
        } catch {
          // try the next one
        }
      }
      await tf.ready();
    })();
  }
  return backendReady;
}

let mobilenetPromise: Promise<tf.LayersModel> | null = null;
let detectorPromise: Promise<cocoSsd.ObjectDetection> | null = null;

function loadMobilenet(): Promise<tf.LayersModel> {
  if (!mobilenetPromise) mobilenetPromise = ensureBackend().then(() => tf.loadLayersModel(`${MODEL_ROOT}/mobilenet/model.json`));
  return mobilenetPromise;
}

function loadDetector(): Promise<cocoSsd.ObjectDetection> {
  if (!detectorPromise) {
    detectorPromise = ensureBackend().then(() =>
      cocoSsd.load({ base: 'lite_mobilenet_v2', modelUrl: `${MODEL_ROOT}/coco-ssd/model.json` }),
    );
  }
  return detectorPromise;
}

// The face check (eyes closed, facing away, smiles) can run here too, using a maintained fork of
// face-api.js built on this same modern tfjs and the same self-hosted model files. On the main
// thread it runs one photo at a time and, on many computers, on tfjs's slow plain-JavaScript
// backend; here each worker in the pool runs it on WebAssembly, side by side.
let faceModelsPromise: Promise<void> | null = null;
function loadFaceModels(): Promise<void> {
  if (!faceModelsPromise) {
    faceModelsPromise = ensureBackend().then(async () => {
      // face-api looks for a DOM; a worker has none, so point it at the worker equivalents.
      faceapi.env.setEnv({
        Canvas: OffscreenCanvas,
        CanvasRenderingContext2D: OffscreenCanvasRenderingContext2D,
        Image: class {},
        ImageData,
        Video: class {},
        createCanvasElement: () => new OffscreenCanvas(1, 1),
        createImageElement: () => {
          throw new Error('no images in a worker');
        },
        createVideoElement: () => {
          throw new Error('no video in a worker');
        },
        fetch: (url: string, init?: RequestInit) => fetch(url, init),
        readFile: () => {
          throw new Error('no file system in a worker');
        },
      } as unknown as Parameters<typeof faceapi.env.setEnv>[0]);
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_ROOT),
        faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_ROOT),
        faceapi.nets.faceExpressionNet.loadFromUri(MODEL_ROOT),
      ]);
    });
  }
  return faceModelsPromise;
}

async function detectFaces(bitmap: ImageBitmap): Promise<FaceCheck> {
  await loadFaceModels();
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  ctx.drawImage(bitmap, 0, 0);
  // Handed over as a canvas, not a tensor, so face-api scales it exactly as the main-thread
  // version does (browser canvas scaling rather than tfjs's), and decisions match.
  const detections = await faceapi
    .detectAllFaces(canvas as unknown as HTMLCanvasElement, new faceapi.TinyFaceDetectorOptions())
    .withFaceLandmarks()
    .withFaceExpressions();
  return summarizeFaces(detections, bitmap.width * bitmap.height);
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

self.onmessage = async (
  e: MessageEvent<{ id: number; op?: 'scene' | 'faces'; blob?: Blob; bitmap?: ImageBitmap; detect?: DetectMode }>,
) => {
  const { id, blob, detect = 'auto', op = 'scene' } = e.data;
  if (op === 'faces') {
    const bitmap = e.data.bitmap!;
    try {
      self.postMessage({ id, faces: await detectFaces(bitmap) });
    } catch (err) {
      // Reported back so the caller can fall back to the main-thread face check.
      self.postMessage({ id, error: String(err) });
    } finally {
      bitmap.close();
    }
    return;
  }
  let result: SceneClassification;
  try {
    const bitmap = e.data.bitmap ?? (await createImageBitmap(blob!));
    try {
      const top = await predictTopK(bitmap);
      // Skipped detection is reported as null ("couldn't rule anyone out"), which never lets a
      // photo count as just an object — the safe direction.
      const runDetector = detect === 'always' || (detect === 'auto' && couldBeObjectPhoto(top));
      const detections = runDetector ? await detectObjects(bitmap).catch(() => null) : null;
      result = summarizeScene(top, detections);
    } finally {
      bitmap.close();
    }
  } catch {
    result = summarizeScene([], null);
  }
  self.postMessage({ id, result });
};
