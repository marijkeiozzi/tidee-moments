// Standalone verification of classifyPhoto against the representative scenarios from the
// over-deletion bug report — no test runner is wired into this project, so this is executed
// directly with `npx tsx src/lib/classifyPhoto.test.ts`. The one property that matters most:
// reasonable doubt must resolve to keep/review, never delete.
import { classifyPhoto, type ClassifySignals, type DuplicateContext } from './classifyPhoto';

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
    name: 'burst: same time window but different pose/expression (distance 24, not a real duplicate)',
    signals: { ...BASE, sharpness: 180, faceCount: 1, openEyesFraction: 1 },
    dup: { hammingDistance: 24, qualityGap: 300, comparePhotoId: 'winner' },
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

console.log(`\n${pass}/${cases.length} passed`);
if (fail > 0) process.exit(1);
