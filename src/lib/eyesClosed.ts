import * as faceapi from 'face-api.js';
import { blobToImage, loadFaceModels } from './faces';

function eyeAspectRatio(eye: faceapi.Point[]): number {
  const dist = (a: faceapi.Point, b: faceapi.Point) => Math.hypot(a.x - b.x, a.y - b.y);
  return (dist(eye[1], eye[5]) + dist(eye[2], eye[4])) / (2 * dist(eye[0], eye[3]));
}

function centerOf(points: faceapi.Point[]): { x: number; y: number } {
  const sum = points.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
  return { x: sum.x / points.length, y: sum.y / points.length };
}

// How horizontally centered the nose is between the two eyes — 1 for dead-on frontal, shrinking
// toward 0 as the head turns to profile (one eye-to-nose distance collapses relative to the
// other). Landmark 30 (nose tip) is index 3 in face-api's 9-point getNose() array (27..35).
function frontalRatio(landmarks: faceapi.FaceLandmarks68): number {
  const nose = landmarks.getNose();
  const noseTip = nose[3];
  const leftEye = centerOf(landmarks.getLeftEye());
  const rightEye = centerOf(landmarks.getRightEye());
  const distToLeft = Math.abs(noseTip.x - leftEye.x);
  const distToRight = Math.abs(noseTip.x - rightEye.x);
  const wider = Math.max(distToLeft, distToRight);
  return wider === 0 ? 1 : Math.min(distToLeft, distToRight) / wider;
}

// Below this, an eye reads as closed/mid-blink rather than open. Set conservatively low —
// a squint during a big smile can read close to a genuine blink on EAR alone, and losing an
// entire moment to a false positive is worse than occasionally missing a real closed-eye shot.
const EAR_CLOSED_THRESHOLD = 0.16;

// Below this frontal ratio, a face reads as turned well away from the camera (profile or
// near-profile) rather than glancing slightly off-center.
const FRONTAL_RATIO_THRESHOLD = 0.35;

export interface FaceCheck {
  eyesClosed: boolean;
  facingAway: boolean;
  faceCount: number;
  // Fraction of detected faces with eyes open (1 when there are no faces to judge) — lets a
  // group-of-5 photo where one person blinked score far better than a solo portrait with
  // closed eyes, instead of both being flattened to the same "eyesClosed: true" penalty.
  openEyesFraction: number;
  // Average "happy" expression probability (0-1) across detected faces — a genuine smile,
  // not just open eyes, is what actually makes a family photo the keeper.
  smileScore: number;
  // Largest detected face's bounding-box area as a fraction of the whole image (0-1) — a
  // close-up, prominent face is usually a better keepsake than a person tiny in the background.
  maxFaceArea: number;
}

const NO_FACES: FaceCheck = {
  eyesClosed: false,
  facingAway: false,
  faceCount: 0,
  openEyesFraction: 1,
  smileScore: 0,
  maxFaceArea: 0,
};

// Free, local face analysis — eyes-closed, orientation, smile, and prominence — reusing the
// same face-landmark model already loaded for person-clustering (lib/faces.ts). No AI/API
// call. Photos with no detected face return the neutral NO_FACES result (nothing to judge, so
// never auto-flagged for it, and never preferred by the group-survivor picker either).
export async function detectClosedEyes(blob: Blob): Promise<FaceCheck> {
  await loadFaceModels();
  const img = await blobToImage(blob);
  const detections = await faceapi
    .detectAllFaces(img, new faceapi.TinyFaceDetectorOptions())
    .withFaceLandmarks()
    .withFaceExpressions();

  if (detections.length === 0) return NO_FACES;

  const imgArea = img.width * img.height;
  let eyesClosed = false;
  let anyFrontal = false;
  let openEyesCount = 0;
  let smileSum = 0;
  let maxFaceArea = 0;

  for (const d of detections) {
    const ear = (eyeAspectRatio(d.landmarks.getLeftEye()) + eyeAspectRatio(d.landmarks.getRightEye())) / 2;
    if (ear < EAR_CLOSED_THRESHOLD) {
      eyesClosed = true;
    } else {
      openEyesCount++;
    }
    if (frontalRatio(d.landmarks) >= FRONTAL_RATIO_THRESHOLD) anyFrontal = true;
    smileSum += d.expressions.happy;
    if (imgArea > 0) {
      const box = d.detection.box;
      maxFaceArea = Math.max(maxFaceArea, (box.width * box.height) / imgArea);
    }
  }

  return {
    eyesClosed,
    facingAway: !anyFrontal,
    faceCount: detections.length,
    openEyesFraction: openEyesCount / detections.length,
    smileScore: smileSum / detections.length,
    maxFaceArea,
  };
}
