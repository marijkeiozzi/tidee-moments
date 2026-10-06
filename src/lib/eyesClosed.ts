import * as faceapi from 'face-api.js';
import { loadFaceModels } from './faces';
import { withAnalysisImage, type AnalysisImage } from './analysisImage';
import { summarizeFaces, type FaceCheck } from './faceSummary';

export type { FaceCheck };

// Free, local face analysis — eyes-closed, orientation, smile, and prominence — reusing the
// same face-landmark model already loaded for person-clustering (lib/faces.ts). No AI/API
// call. Photos with no detected face return the neutral NO_FACES result (nothing to judge, so
// never auto-flagged for it, and never preferred by the group-survivor picker either).
export async function detectClosedEyes(input: Blob | AnalysisImage): Promise<FaceCheck> {
  await loadFaceModels();
  return withAnalysisImage(input, (image) => analyzeFaces(image.canvas));
}

async function analyzeFaces(img: HTMLCanvasElement): Promise<FaceCheck> {
  const detections = await faceapi
    .detectAllFaces(img, new faceapi.TinyFaceDetectorOptions())
    .withFaceLandmarks()
    .withFaceExpressions();

  return summarizeFaces(detections, img.width * img.height);
}
