import * as faceapi from 'face-api.js';
import type { Photo } from '../db/indexedDb';
import { withAnalysisImage } from './analysisImage';

let modelsLoaded: Promise<void> | null = null;

// BASE_URL, not a bare '/models' — on GitHub Pages the app lives under /tidee-moments/, and a
// root path would 404 there, silently disabling every face check.
const MODEL_URL = `${import.meta.env.BASE_URL}models`;

// Models are self-hosted in public/models — never fetched from an external CDN, so this
// feature works fully offline and keeps every photo on-device, same as the rest of the app.
export function loadFaceModels(): Promise<void> {
  if (!modelsLoaded) {
    modelsLoaded = Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
      faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
      faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
      faceapi.nets.faceExpressionNet.loadFromUri(MODEL_URL),
    ]).then(() => undefined);
  }
  return modelsLoaded;
}

// Works on the small shared working copy (see analysisImage.ts) rather than the full-size
// original — the face detector scales everything to 416px anyway, and a People scan runs over
// every kept photo.
export async function getFaceDescriptors(photo: Photo): Promise<Float32Array[]> {
  return withAnalysisImage(photo.blob, async (image) => {
    const detections = await faceapi
      .detectAllFaces(image.canvas, new faceapi.TinyFaceDetectorOptions())
      .withFaceLandmarks()
      .withFaceDescriptors();
    return detections.map((d) => d.descriptor);
  });
}

export interface FaceCluster {
  id: string;
  photoIds: string[];
  // One representative descriptor per cluster (its first member's), used to match new faces.
  centroid: Float32Array;
}

const MATCH_THRESHOLD = 0.6;

// Greedy clustering: each new face joins the closest existing cluster if within threshold,
// otherwise starts a new one. Simple but effective for a family-sized photo library.
export function clusterFaces(
  entries: { photoId: string; descriptor: Float32Array }[],
  existing: FaceCluster[] = [],
): FaceCluster[] {
  const clusters: FaceCluster[] = existing.map((c) => ({ ...c, photoIds: [...c.photoIds] }));

  for (const { photoId, descriptor } of entries) {
    let bestCluster: FaceCluster | null = null;
    let bestDistance = Infinity;

    for (const cluster of clusters) {
      const distance = faceapi.euclideanDistance(cluster.centroid, descriptor);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestCluster = cluster;
      }
    }

    if (bestCluster && bestDistance < MATCH_THRESHOLD) {
      if (!bestCluster.photoIds.includes(photoId)) bestCluster.photoIds.push(photoId);
    } else {
      clusters.push({ id: crypto.randomUUID(), photoIds: [photoId], centroid: descriptor });
    }
  }

  return clusters;
}
