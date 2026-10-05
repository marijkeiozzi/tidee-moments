// Pure keep/review/delete decision logic — takes already-computed per-photo signals (from the
// blur/eyes/quality/document/scene detectors) plus optional duplicate-relationship context and
// returns a verdict with a human-readable reason and evidence string. No canvas/DOM/AI here —
// kept pure and synchronous so it's unit-testable with hand-built signal fixtures instead of real
// image blobs (see classifyPhoto.test.ts).
//
// Philosophy: KEEP is the default whenever evidence is ambiguous. DELETE requires strong,
// specific evidence — a near-exact duplicate of a clearly better photo, or a photo so degraded
// (blank/black, blown-out, severely blurred, or a screenshot/document with nobody in it) that
// there's no memory to lose. Imperfect blur, closed eyes, poor exposure, an off-center face, or a
// low aesthetic read are soft signals, never deletion triggers on their own — especially once a
// face is in frame. "Duplicate" is judged on visual similarity + a quality gap, never on
// low-quality alone, so it stays additive to (not a substitute for) the other signals.

export type Verdict = 'keep' | 'review' | 'delete';

export interface ClassifySignals {
  sharpness: number;
  isBlurry: boolean;
  isLowQuality: boolean;
  qualityReason?: 'low-resolution' | 'too-dark' | 'overexposed';
  isDocument: boolean;
  isUtilityPhoto: boolean;
  utilityLabel: string | null;
  utilityConfidence: number;
  // Someone is in frame per the object detector — sees bodies, sleeping babies and the backs of
  // heads that face detection misses. Optional so older callers/fixtures default to "no".
  hasPerson?: boolean;
  // true only when the upload positively found no camera Make/Model (unknown = undefined).
  noCameraExif?: boolean;
  eyesClosed: boolean;
  facingAway: boolean;
  faceCount: number;
  openEyesFraction: number;
  smileScore: number;
  maxFaceArea: number;
}

// This photo's relationship to the single best photo in its duplicate/burst group.
export interface DuplicateContext {
  hammingDistance: number; // out of 64 — lower is more visually identical
  qualityGap: number; // the other photo's scorePhotoQuality() minus this one's
  comparePhotoId: string;
}

export interface ClassifyScores {
  qualityScore: number;
  blurScore: number; // 0 (severely blurry) .. 1 (tack sharp)
  exposureScore: number; // 0 (blank/blown out) .. 1 (well exposed)
  peopleScore: number; // 0.5 neutral (no faces) up to 1 (clear smiling frontal face)
  uniquenessScore: number; // 1 unless part of a tight duplicate relationship
  duplicateScore: number; // 0 none .. 1 near-exact duplicate of a clearly better photo
  confidence: number; // confidence in the final verdict, 0..1
}

export interface Classification {
  verdict: Verdict;
  reason: string;
  evidence: string;
  scores: ClassifyScores;
}

// How willing the classifier is to call something a duplicate/blur/reference-shot worth
// deleting. Exposed to the user as "Just the best" / "Balanced" / "Generous" — the underlying
// evidence rules never change (still only these five categories, still never on aesthetics
// alone), only how far each one reaches. "strict" is the most aggressive at decluttering,
// "generous" is closest to "when in doubt, keep."
export type Sensitivity = 'strict' | 'balanced' | 'generous';

interface Thresholds {
  // Below this sharpness, a photo is "too blurry to make out" — see rule 4 below.
  severeBlurSharpness: number;
  // Near-zero edge detail — a genuinely featureless frame (pocket shot, lens cap), not just a
  // dim room or a moody low-light photo (which still has real detail once you look).
  blankSharpness: number;
  // scorePhotoQuality() points. Two near-identical shots can differ by 200+ points just from one
  // having eyes open vs closed. Used only to decide the wording/confidence of a duplicate
  // deletion, never to gate whether one happens at all — see duplicateHammingCeiling below.
  meaningfulDuplicateGap: number;
  // Upper bound on the Hamming distance a DuplicateContext is trusted at — autoSort.ts always
  // attaches the widest possible relationship (up to 32 for a time-bounded burst), and this is
  // what decides, per sensitivity level, how much of that counts as "the same shot" worth
  // deleting down to one copy.
  duplicateHammingCeiling: number;
  // sceneCategories.ts only flags isUtilityPhoto once it's ruled out people, pets and food; this
  // is how much of MobileNet's top-5 weight must also sit on household objects before that
  // flag alone sets a photo aside. Every real object photo in the tuning set scored 0.6+.
  utilityDeleteConfidence: number;
}

const THRESHOLDS: Record<Sensitivity, Thresholds> = {
  // "Just the best" — most aggressive declutter: a fairly loose bar for "beyond recognition"
  // blur, and treats a burst photo as redundant even with real pose/arm movement between frames.
  strict: { severeBlurSharpness: 45, blankSharpness: 6, meaningfulDuplicateGap: 50, duplicateHammingCeiling: 32, utilityDeleteConfidence: 0.5 },
  // Middle ground — still catches obvious duplicates and unusable shots, less eager on borderline
  // ones.
  balanced: { severeBlurSharpness: 32, blankSharpness: 6, meaningfulDuplicateGap: 65, duplicateHammingCeiling: 20, utilityDeleteConfidence: 0.6 },
  // "Generous" — when in doubt, keep it. Only near-pixel-identical duplicates and truly
  // unusable frames get removed; anything with real in-frame variation stays.
  generous: { severeBlurSharpness: 22, blankSharpness: 6, meaningfulDuplicateGap: 90, duplicateHammingCeiling: 8, utilityDeleteConfidence: 0.85 },
};

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function peopleScoreOf(s: ClassifySignals): number {
  if (s.faceCount === 0) return 0.5; // neutral — no one to judge, not a penalty
  let score = 0.5;
  if (!s.facingAway) score += 0.2;
  score += s.openEyesFraction * 0.15;
  score += s.smileScore * 0.1;
  score += s.maxFaceArea * 0.05;
  return clamp01(score);
}

function blurScoreOf(sharpness: number): number {
  return clamp01(sharpness / 300);
}

function exposureScoreOf(s: ClassifySignals): number {
  if (!s.isLowQuality) return 1;
  if (s.qualityReason === 'low-resolution') return 0.6; // usable, just small — a weak signal
  return 0.3; // too-dark / overexposed, but not necessarily blank
}

export function classifyPhoto(s: ClassifySignals, dup?: DuplicateContext, sensitivity: Sensitivity = 'balanced'): Classification {
  const {
    severeBlurSharpness: SEVERE_BLUR_SHARPNESS,
    blankSharpness: BLANK_SHARPNESS,
    meaningfulDuplicateGap: MEANINGFUL_DUPLICATE_QUALITY_GAP,
    duplicateHammingCeiling: DUPLICATE_HAMMING_CEILING,
    utilityDeleteConfidence: UTILITY_DELETE_CONFIDENCE,
  } = THRESHOLDS[sensitivity];

  const qualityScore = blurScoreOf(s.sharpness) * 0.5 + exposureScoreOf(s) * 0.5;
  const peopleScore = peopleScoreOf(s);
  const uniquenessScore = dup ? clamp01(dup.hammingDistance / DUPLICATE_HAMMING_CEILING) : 1;
  const duplicateScore = dup ? clamp01(1 - dup.hammingDistance / DUPLICATE_HAMMING_CEILING) : 0;
  const base: ClassifyScores = {
    qualityScore,
    blurScore: blurScoreOf(s.sharpness),
    exposureScore: exposureScoreOf(s),
    peopleScore,
    uniquenessScore,
    duplicateScore,
    confidence: 0,
  };

  // 1. Duplicate of a photo already being kept — the moment is already preserved elsewhere, so
  // keeping every near-identical copy adds clutter, not memories. DUPLICATE_HAMMING_CEILING (8
  // out of 64, ~87%+ similarity) is already a tight, near-pixel-identical bar — real bursts of
  // a moving subject land at 20-36 and never reach here (see the isBurst gate in autoSort.ts), so
  // once a photo clears this bar it genuinely is "the same shot," not just "a similar one." A
  // meaningful quality gap makes the reasoning stronger/more specific, but isn't required: two
  // near-pixel-identical frames of equal quality are still redundant, and forceKeepIds already
  // guarantees the single best copy of every group survives regardless.
  if (dup && dup.hammingDistance <= DUPLICATE_HAMMING_CEILING) {
    const similarityPct = Math.round((1 - dup.hammingDistance / 64) * 100);
    const clearlyBetter = dup.qualityGap >= MEANINGFUL_DUPLICATE_QUALITY_GAP;
    return {
      verdict: 'delete',
      reason: `${similarityPct}% duplicate of a photo you're keeping`,
      evidence: clearlyBetter
        ? `Perceptual similarity ${similarityPct}% (Hamming distance ${dup.hammingDistance}/64) — the kept photo scores ${Math.round(dup.qualityGap)} points better on sharpness/faces.`
        : `Perceptual similarity ${similarityPct}% (Hamming distance ${dup.hammingDistance}/64) — near-identical content, so only one copy is kept.`,
      scores: { ...base, confidence: clearlyBetter ? 0.95 : 0.85 },
    };
  }

  // 2. Blank/black frame — near-zero brightness and no detail at all.
  if (s.isLowQuality && s.qualityReason === 'too-dark' && s.sharpness < BLANK_SHARPNESS) {
    return {
      verdict: 'delete',
      reason: 'Looks like a blank, black frame',
      evidence: `Near-zero brightness with no visible detail (sharpness ${Math.round(s.sharpness)}) — consistent with an accidental shot (e.g. taken in a pocket) rather than a photo of anything.`,
      scores: { ...base, confidence: 0.92 },
    };
  }

  // 3. Fully blown-out frame — near-total brightness and no detail at all.
  if (s.isLowQuality && s.qualityReason === 'overexposed' && s.sharpness < BLANK_SHARPNESS) {
    return {
      verdict: 'delete',
      reason: 'Looks like a blank, fully overexposed frame',
      evidence: `Near-total brightness with no visible detail (sharpness ${Math.round(s.sharpness)}) — consistent with a blown-out or accidental shot rather than a real photo.`,
      scores: { ...base, confidence: 0.9 },
    };
  }

  // 4. Severely blurred — beyond recognition, not just soft-focus.
  if (s.sharpness < SEVERE_BLUR_SHARPNESS) {
    return {
      verdict: 'delete',
      reason: 'Too blurry to make out',
      evidence: `Sharpness score ${Math.round(s.sharpness)} — far below even a soft-focus shot; the subject isn't recognizable.`,
      scores: { ...base, confidence: 0.85 },
    };
  }

  // 5a. A small image with no camera data at all and nobody in it — a cropped screenshot, a
  // video still, a saved thumbnail. Phone cameras always write Make/Model, and photos that lose
  // it on the way (WhatsApp, Messenger) are still far bigger than this, so a genuine memory
  // never matches all three.
  if (s.noCameraExif && s.isLowQuality && s.qualityReason === 'low-resolution' && s.faceCount === 0 && !s.hasPerson) {
    return {
      verdict: 'delete',
      reason: 'Looks like a screenshot or saved image',
      evidence: 'Small, with no camera information in the file and nobody in it — consistent with a screenshot, video still or image saved from an app, not a photo taken with a camera.',
      scores: { ...base, confidence: 0.8 },
    };
  }

  // 5. Screenshot/document, or a photo of a thing (a pot, an appliance, a lamp) — only ever with
  // nobody in it: no face AND no person from the object detector. A weak object read isn't
  // strong enough on its own — that's handled as a soft "uncertain" signal below.
  const confidentUtility = s.isUtilityPhoto && s.utilityConfidence >= UTILITY_DELETE_CONFIDENCE;
  if (s.faceCount === 0 && !s.hasPerson && (s.isDocument || confidentUtility)) {
    const evidence = s.isDocument
      ? 'Flat, mostly-uniform background with dense text/print-like detail — matches a document or screenshot, not a photo, and nobody is in it.'
      : `Looks like a photo of a ${s.utilityLabel ?? 'household object'} (${Math.round(s.utilityConfidence * 100)}% confidence) with no person, pet or food in it.`;
    return {
      verdict: 'delete',
      reason: s.isDocument ? 'Looks like a screenshot or document' : 'Looks like a photo of a thing, not a moment',
      evidence,
      scores: { ...base, confidence: 0.8 },
    };
  }

  // Everything else is a soft signal at most — imperfect blur, closed eyes, a turned-away face,
  // poor exposure, or a low aesthetic read. None of those, alone or combined, is strong enough
  // evidence to delete someone's photo (a real duplicate relationship was already handled above,
  // so it never reaches here). Uncertain cases are tagged "review" internally — still routed to
  // Keep since there's no third UI bucket yet — so the reasoning stays inspectable instead of
  // silently collapsing into a plain "keep".
  const uncertain = s.isBlurry || s.isLowQuality || s.eyesClosed || s.facingAway || s.isDocument || s.isUtilityPhoto;
  if (uncertain) {
    return {
      verdict: 'review',
      reason: 'Kept — no single issue was strong enough to delete',
      evidence:
        'Imperfect on one or more soft signals (blur, exposure, eyes, or a similar photo elsewhere), but nothing here rises to "duplicate of a clearly better copy", "blank", "severely blurred", or "a people-free screenshot" — so it stays.',
      scores: { ...base, confidence: 0.6 },
    };
  }

  return {
    verdict: 'keep',
    reason: 'Keep',
    evidence: 'No issues detected.',
    scores: { ...base, confidence: 0.95 },
  };
}
