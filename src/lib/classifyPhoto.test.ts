// Standalone verification of classifyPhoto against the representative scenarios from the
// over-deletion bug report — no test runner is wired into this project, so this is executed
// directly with `npx tsx src/lib/classifyPhoto.test.ts`. The one property that matters most:
// reasonable doubt must resolve to keep/review, never delete.
import { classifyPhoto, type ClassifySignals, type DuplicateContext } from './classifyPhoto';
import { scorePhotoQuality } from './photoScore';
import { thumbDifference } from './duplicateDetection';

const BASE: ClassifySignals = {
  sharpness: 250,
  isBlurry: false,
  isLowQuality: false,
  isDocument: false,
  isUtilityPhoto: false,
  utilityLabel: null,
  utilityConfidence: 0,
  eyesClosed: false,
  facingAway: false,
  faceCount: 0,
  openEyesFraction: 1,
  smileScore: 0,
  maxFaceArea: 0,
};

interface Case {
  name: string;
  signals: ClassifySignals;
  dup?: DuplicateContext;
  expect: 'keep' | 'review' | 'delete';
}

const cases: Case[] = [
  {
    name: 'perfect photo',
    signals: { ...BASE, faceCount: 2, openEyesFraction: 1, smileScore: 0.9, maxFaceArea: 0.3 },
    expect: 'keep',
  },
  {
    name: 'slightly blurry but meaningful (person, soft focus)',
    signals: { ...BASE, sharpness: 90, isBlurry: true, faceCount: 1, openEyesFraction: 1, smileScore: 0.7 },
    expect: 'review',
  },
  {
    name: 'dark but meaningful (dim room, real detail)',
    signals: { ...BASE, sharpness: 60, isLowQuality: true, qualityReason: 'too-dark', faceCount: 1, openEyesFraction: 1 },
    expect: 'review',
  },
  {
    name: 'unique candid moment, no faces, technically fine',
    signals: { ...BASE, sharpness: 200, faceCount: 0 },
    expect: 'keep',
  },
  {
    name: 'group photo, one person blinked',
    signals: { ...BASE, faceCount: 5, openEyesFraction: 0.8, eyesClosed: true, smileScore: 0.6, maxFaceArea: 0.15 },
    expect: 'review',
  },
  {
    name: 'duplicate — near-identical, clearly worse than the kept copy',
    signals: { ...BASE, sharpness: 40, faceCount: 1, openEyesFraction: 0, eyesClosed: true },
    dup: { hammingDistance: 3, qualityGap: 400, comparePhotoId: 'winner' },
    expect: 'delete',
  },
  {
    name: 'near-pixel-identical duplicate, roughly equal quality (still redundant — dedupe it)',
    signals: { ...BASE, sharpness: 220, faceCount: 1, openEyesFraction: 1 },
    dup: { hammingDistance: 1, qualityGap: 5, comparePhotoId: 'winner' },
    expect: 'delete',
  },
  {
    name: 'accidental pocket photo (blank/black)',
    signals: { ...BASE, sharpness: 2, isLowQuality: true, qualityReason: 'too-dark' },
    expect: 'delete',
  },
  {
    name: 'fully blown-out / blank white frame',
    signals: { ...BASE, sharpness: 1, isLowQuality: true, qualityReason: 'overexposed' },
    expect: 'delete',
  },
  {
    name: 'screenshot, no people',
    signals: { ...BASE, sharpness: 200, isDocument: true, faceCount: 0 },
    expect: 'delete',
  },
  {
    name: 'medical/NICU equipment close-up misread as "desk" at low confidence, no face in frame',
    signals: { ...BASE, sharpness: 200, isUtilityPhoto: true, utilityLabel: 'desk', utilityConfidence: 0.42, faceCount: 0 },
    expect: 'review',
  },
  {
    name: 'genuine reference photo (laptop screen) at high confidence, no people',
    signals: { ...BASE, sharpness: 200, isUtilityPhoto: true, utilityLabel: 'laptop', utilityConfidence: 0.85, faceCount: 0 },
    expect: 'delete',
  },
  {
    name: 'burst: different moment entirely, well beyond the loosened ceiling (distance 45, not a real duplicate)',
    signals: { ...BASE, sharpness: 180, faceCount: 1, openEyesFraction: 1 },
    dup: { hammingDistance: 45, qualityGap: 300, comparePhotoId: 'winner' },
    expect: 'keep',
  },
  {
    name: 'burst: near-identical frame, same pose, worse quality',
    signals: { ...BASE, sharpness: 50, faceCount: 1, openEyesFraction: 0, eyesClosed: true },
    dup: { hammingDistance: 5, qualityGap: 350, comparePhotoId: 'winner' },
    expect: 'delete',
  },
  {
    name: 'burst: posed multi-shot sequence with natural pose movement (distance 13, still redundant)',
    signals: { ...BASE, sharpness: 200, faceCount: 2, openEyesFraction: 1, smileScore: 0.8 },
    dup: { hammingDistance: 13, qualityGap: 20, comparePhotoId: 'winner' },
    expect: 'delete',
  },
  {
    name: 'technically bad but unique (very soft, only shot of the moment)',
    signals: { ...BASE, sharpness: 70, isBlurry: true, faceCount: 1, openEyesFraction: 1, smileScore: 0.9 },
    expect: 'review',
  },
  {
    name: 'severely blurred beyond recognition',
    signals: { ...BASE, sharpness: 10, isBlurry: true, faceCount: 1 },
    expect: 'delete',
  },
];

// Signals from photoAnalysis.ts (sharpest regions, face focus/lighting, clipping) and library
// matching. Values below are the ones measured on the calibration photos.
const ANALYZED: ClassifySignals = { ...BASE, focusSharpness: 4000, faceSharpness: null, faceBrightness: null, frameBrightness: 120, clippedHighlights: 0 };

cases.push(
  {
    name: 'portrait mode: soft background, sharp subject (whole-frame 25, sharpest regions 1600) is not "too blurry"',
    signals: { ...ANALYZED, sharpness: 25, isBlurry: true, focusSharpness: 1600, faceCount: 1, faceSharpness: 1700, faceBrightness: 170 },
    expect: 'review',
  },
  {
    name: 'blurred all over (whole-frame 20, sharpest regions 45) is still deleted',
    signals: { ...ANALYZED, sharpness: 20, isBlurry: true, focusSharpness: 45 },
    expect: 'delete',
  },
  {
    name: 'background sharp, baby moved (face 23) is flagged, not deleted',
    signals: { ...ANALYZED, sharpness: 1474, focusSharpness: 4600, faceCount: 1, faceSharpness: 23, faceBrightness: 170 },
    expect: 'review',
  },
  {
    name: 'backlit by a window (face 51 vs frame 139) is flagged, not deleted',
    signals: { ...ANALYZED, faceCount: 1, faceSharpness: 155, faceBrightness: 51, frameBrightness: 139 },
    expect: 'review',
  },
  {
    name: 'washed out (56% pure white) is flagged, not deleted',
    signals: { ...ANALYZED, clippedHighlights: 0.56 },
    expect: 'review',
  },
  {
    name: 'sleeping baby (single face, eyes closed) is a keeper, not flagged',
    signals: { ...ANALYZED, faceCount: 1, eyesClosed: true, openEyesFraction: 0, faceSharpness: 900, faceBrightness: 150 },
    expect: 'review', // eyesClosed is still an internal soft signal; checked below that no flag is shown
  },
  {
    name: 'exact copy of a photo in this batch',
    signals: ANALYZED,
    dup: { hammingDistance: 0, qualityGap: 0, comparePhotoId: 'winner', exact: true },
    expect: 'delete',
  },
  {
    name: 'already in the library (WhatsApp copy of a kept photo)',
    signals: ANALYZED,
    dup: { hammingDistance: 2, qualityGap: 0, comparePhotoId: 'kept-earlier', inLibrary: true },
    expect: 'delete',
  },
  {
    name: 'higher-resolution copy of a library photo is kept and flagged',
    signals: { ...ANALYZED, betterCopyOfLibraryPhoto: true },
    expect: 'review',
  },
);

let pass = 0;
let fail = 0;
for (const c of cases) {
  const result = classifyPhoto(c.signals, c.dup);
  const ok = c.expect === 'review' ? result.verdict === 'keep' || result.verdict === 'review' : result.verdict === c.expect;
  if (ok) {
    pass++;
    console.log(`PASS  ${c.name} -> ${result.verdict} (${result.reason})`);
  } else {
    fail++;
    console.error(`FAIL  ${c.name} -> got ${result.verdict}, expected ${c.expect} (${result.reason} — ${result.evidence})`);
  }
}

function check(name: string, ok: boolean) {
  if (ok) {
    pass++;
    console.log(`PASS  ${name}`);
  } else {
    fail++;
    console.error(`FAIL  ${name}`);
  }
}
const extraChecks: [string, boolean][] = [];
const flagsFor = (signals: ClassifySignals) => classifyPhoto(signals).flags;
extraChecks.push(
  ['portrait shot is not flagged blurry', !flagsFor({ ...ANALYZED, sharpness: 25, isBlurry: true, focusSharpness: 1600 }).includes('blurry')],
  ['moved baby is flagged "soft-face"', flagsFor({ ...ANALYZED, faceCount: 1, faceSharpness: 23 }).includes('soft-face')],
  ['backlit face is flagged "face-in-shadow"', flagsFor({ ...ANALYZED, faceCount: 1, faceBrightness: 51, frameBrightness: 139 }).includes('face-in-shadow')],
  ['dim room overall is not "face-in-shadow"', !flagsFor({ ...ANALYZED, faceCount: 1, faceBrightness: 50, frameBrightness: 60 }).includes('face-in-shadow')],
  ['sleeping baby has no flags', flagsFor({ ...ANALYZED, faceCount: 1, eyesClosed: true, openEyesFraction: 0 }).length === 0],
  ['group blink is flagged', flagsFor({ ...ANALYZED, faceCount: 4, eyesClosed: true, openEyesFraction: 0.75 }).includes('blink')],
  ['library copy reason', classifyPhoto(ANALYZED, { hammingDistance: 0, qualityGap: 0, comparePhotoId: 'x', inLibrary: true, exact: true }).reason === 'Already in your library'],
  ['generous still deletes blur-everywhere', classifyPhoto({ ...ANALYZED, sharpness: 5, isBlurry: true, focusSharpness: 9 }, undefined, 'generous').verdict === 'delete'],
  ['strict still protects portrait', classifyPhoto({ ...ANALYZED, sharpness: 30, isBlurry: true, focusSharpness: 700 }, undefined, 'strict').verdict !== 'delete'],
);
for (const [name, ok] of extraChecks) check(name, ok);

// Best-shot scoring: in a burst, the shot with the sharp, well-lit face should win even when
// another frame has a sharper background.
const face = { eyesClosed: false, facingAway: false, faceCount: 1, openEyesFraction: 1, smileScore: 0.5, maxFaceArea: 0.1 };
check(
  'burst pick: sharp face beats sharp background with blurry face',
  scorePhotoQuality({ ...face, sharpness: 900, faceSharpness: 1500, faceBrightness: 160 }) >
    scorePhotoQuality({ ...face, sharpness: 1500, faceSharpness: 30, faceBrightness: 160 }),
);
check(
  'burst pick: well-lit face beats backlit face',
  scorePhotoQuality({ ...face, sharpness: 900, faceSharpness: 800, faceBrightness: 150 }) >
    scorePhotoQuality({ ...face, sharpness: 900, faceSharpness: 800, faceBrightness: 45 }),
);
check(
  'burst pick: sharper still wins above the old 300 cap',
  scorePhotoQuality({ ...face, sharpness: 900, faceSharpness: 1200, faceBrightness: 150 }) >
    scorePhotoQuality({ ...face, sharpness: 900, faceSharpness: 400, faceBrightness: 150 }),
);

// Duplicate confirmation on thumbnails: an evenly, slightly different copy matches; a copy
// with one region changed (subject moved / different outfit) doesn't.
const size = 24;
const thumbA = new Uint8Array(size * size * 3).map((_, i) => (i * 37) % 256);
const recompressed = thumbA.map((v, i) => Math.max(0, Math.min(255, v + ((i % 5) - 2))));
const brighter = thumbA.map((v) => Math.min(255, Math.round(v * 1.1)));
const changedRegion = thumbA.map((v, i) => {
  const cell = Math.floor(i / 3);
  const x = cell % size;
  const y = Math.floor(cell / size);
  return x >= 8 && x < 14 && y >= 8 && y < 14 ? 255 - v : v;
});
check('recompressed copy passes block check', thumbDifference(thumbA, recompressed, size).worstBlock <= 16);
check('brightened copy passes block check', thumbDifference(thumbA, brighter, size).worstBlock <= 16);
check('changed subject region fails block check', thumbDifference(thumbA, changedRegion, size).worstBlock > 16);

const total = cases.length + extraChecks.length + 6;
console.log(`\n${pass}/${total} passed`);
if (fail > 0) process.exit(1);
