import * as faceapi from 'face-api.js';
import type { Photo } from '../db/indexedDb';

let modelsLoaded: Promise<void> | null = null;

// Models are self-hosted in public/models — never fetched from an external CDN, so this
// feature works fully offline and keeps every photo on-device, same as the rest of the app.
export function loadFaceModels(): Promise<void> {
  if (!modelsLoaded) {
    modelsLoaded = Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri('/models'),
      faceapi.nets.faceLandmark68Net.loadFromUri('/models'),
      faceapi.nets.faceRecognitionNet.loadFromUri('/models'),
      faceapi.nets.faceExpressionNet.loadFromUri('/models'),
    ]).then(() => undefined);
  }
  return modelsLoaded;
}

export function blobToImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (err) => {
      URL.revokeObjectURL(url);
      reject(err);
    };
    img.src = url;
  });
}

export async function getFaceDescriptors(photo: Photo): Promise<Float32Array[]> {
  const img = await blobToImage(photo.blob);
  const detections = await faceapi
    .detectAllFaces(img, new faceapi.TinyFaceDetectorOptions())
    .withFaceLandmarks()
    .withFaceDescriptors();
  return detections.map((d) => d.descriptor);
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
