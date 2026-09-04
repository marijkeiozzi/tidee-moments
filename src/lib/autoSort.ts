import type { Photo } from '../db/indexedDb';
import { detectBlur } from './blurDetection';
import { detectClosedEyes } from './eyesClosed';
import { detectLowQuality } from './qualityDetection';
import { computeImageHash, findDuplicateGroups, hammingDistance } from './duplicateDetection';
import { groupIntoBursts } from './bursts';
import { detectDocumentLike } from './documentDetection';
import { classifyScene } from './sceneClassification';
import { scorePhotoQuality } from './photoScore';
import { mapWithConcurrency, pickConcurrency } from './concurrency';
import { classifyPhoto, type ClassifySignals, type DuplicateContext } from './classifyPhoto';

export interface DeleteCandidate {
  photo: Photo;
  reason: string;
  evidence: string;
  comparePhotoId?: string;
}

export interface AutoSortResult {
  keep: Photo[];
  toDelete: DeleteCandidate[];
}

// How often the progress callback fires for a big batch — calling it (and the React state
// update it usually drives) on every single photo would mean thousands of re-renders for a
// batch of thousands; this keeps the UI feeling live without that overhead.
const PROGRESS_STEP = 10;

interface Check extends ClassifySignals {
  photo: Photo;
  hash: bigint | null;
}

const NO_FACE_CHECK = { eyesClosed: false, facingAway: false, faceCount: 0, openEyesFraction: 1, smileScore: 0, maxFaceArea: 0 };

// Entirely on-device — blur, closed-eyes, exposure/resolution, and near-duplicate detection.
// No AI, no API call, no cost, works offline.
export async function runAutoSort(photos: Photo[], onProgress: (done: number, total: number) => void): Promise<AutoSortResult> {
  const keep: Photo[] = [];
  const toDelete: DeleteCandidate[] = [];
  let done = 0;

  const checks = await mapWithConcurrency(photos, pickConcurrency(), async (photo) => {
    let check: Check;
    try {
      const [{ isBlurry, sharpness }, face, quality, hash, isDocument, scene] = await Promise.all([
        detectBlur(photo.blob).catch(() => ({ isBlurry: false, sharpness: Infinity })),
        detectClosedEyes(photo.blob).catch(() => NO_FACE_CHECK),
        detectLowQuality(photo.blob).catch(() => ({ isLowQuality: false }) as const),
        computeImageHash(photo.blob).catch(() => null),
        detectDocumentLike(photo.blob).catch(() => false),
        classifyScene(photo.blob).catch(() => ({ isUtilityPhoto: false, label: null, confidence: 0 })),
      ]);
      check = {
        photo,
        sharpness,
        hash,
        isBlurry,
        isLowQuality: quality.isLowQuality,
        qualityReason: quality.reason,
        isDocument,
        isUtilityPhoto: scene.isUtilityPhoto,
        utilityLabel: scene.label,
        utilityConfidence: scene.confidence,
        eyesClosed: face.eyesClosed,
        facingAway: face.facingAway,
        faceCount: face.faceCount,
        openEyesFraction: face.openEyesFraction,
        smileScore: face.smileScore,
        maxFaceArea: face.maxFaceArea,
      };
    } catch {
      // If a check fails for a photo, default to keep — never auto-delete on an error.
      check = {
        photo,
        sharpness: Infinity,
        hash: null,
        isBlurry: false,
        isLowQuality: false,
        isDocument: false,
        isUtilityPhoto: false,
        utilityLabel: null,
        utilityConfidence: 0,
        ...NO_FACE_CHECK,
      };
    }
    done++;
    if (done % PROGRESS_STEP === 0 || done === photos.length) onProgress(done, photos.length);
    return check;
  });

  // Duplicate + burst passes: within each group of similar/near-identical shots, the single
  // best one is always force-kept — even if it (or every member) individually tripped a
  // blur/eyes/quality flag — because losing every copy of a real moment is worse than keeping
  // one imperfect shot of it. Every other member gets a DuplicateContext recording exactly how
  // visually close it is to the winner and by how much the winner scores better — the actual
  // delete-vs-keep call is left to classifyPhoto, which only treats it as a "duplicate" deletion
  // when both the similarity and the quality gap are strong (see classifyPhoto.ts). Duplicate
  // evidence is additive to, never a substitute for, that photo's own individual signals.
  const forceKeepIds = new Set<string>();
  const dupContextById = new Map<string, DuplicateContext>();
  // O(1) id -> Check lookups — with a large batch, re-scanning the whole checks array for
  // every id inside these grouping loops would make this quadratic in the number of photos.
  const checkById = new Map(checks.map((c) => [c.photo.id, c]));
  // Matches duplicateDetection.ts's own near-exact threshold — used for the any-time-gap pass
  // (findDuplicateGroups below), which has no temporal bound at all, so it stays tight to avoid
  // ever linking two genuinely different moments taken far apart that happen to look similar.
  const STRICT_DUPLICATE_CEILING = 8;
  // A posed multi-shot sequence ("stand there, let me take a few") isn't a held-still burst —
  // real weight shifts, arm movement, and re-framing between shots push the coarse 64-bit dHash
  // distance well past STRICT_DUPLICATE_CEILING even though the shots are obviously redundant.
  // A close-up handheld selfie session moves this even further — the phone itself shifts a few
  // centimeters between shots, which reframes a close subject a lot more than the same handshake
  // would for a farther-away scene. This looser ceiling only applies to members of a time-bounded
  // burst (already confirmed within ~30s of each other by groupIntoBursts), so the risk of it
  // linking two unrelated moments is already bounded by that time window, unlike the any-time-gap
  // pass above.
  const BURST_DUPLICATE_CEILING = 22;

  function resolveGroup(groupChecks: Check[], isBurst: boolean) {
    if (groupChecks.length < 2) return;
    // Documents/screenshots/utility photos never win a group — they aren't a "memory" worth
    // rescuing just because they're the sharpest copy of a recipe card or a window frame. If
    // every member falls in one of those buckets, nobody gets force-kept and they fall through
    // to their individual classification.
    const eligible = groupChecks.filter((c) => !c.isDocument && !c.isUtilityPhoto);
    if (eligible.length === 0) return;
    const best = eligible.reduce((a, b) => (scorePhotoQuality(b) > scorePhotoQuality(a) ? b : a));
    forceKeepIds.add(best.photo.id);

    for (const c of groupChecks) {
      if (forceKeepIds.has(c.photo.id)) continue;
      if (c.hash === null || best.hash === null) continue; // can't judge a visual relationship without a hash
      const distance = hammingDistance(c.hash, best.hash);
      // Being close together in time isn't strong evidence of being the *same shot* — a whole
      // photo session (different poses, minutes apart) chains into one burst group, and shots of
      // a moving subject land at a Hamming distance of ~20-36/64 just from the subject shifting.
      // Only count a burst member as a duplicate relationship when it's within the looser
      // burst-scoped ceiling — otherwise it's a distinct moment that stands on its own signals.
      if (isBurst && distance > BURST_DUPLICATE_CEILING) continue;
      const gap = scorePhotoQuality(best) - scorePhotoQuality(c);
      const existing = dupContextById.get(c.photo.id);
      if (!existing || distance < existing.hammingDistance) {
        dupContextById.set(c.photo.id, { hammingDistance: distance, qualityGap: gap, comparePhotoId: best.photo.id });
      }
    }
  }

  const withHash = checks.filter((c): c is Check & { hash: bigint } => c.hash !== null);
  const duplicateGroups = findDuplicateGroups(withHash.map((c) => ({ id: c.photo.id, hash: c.hash })));
  for (const groupIds of duplicateGroups) {
    resolveGroup(
      groupIds.map((id) => checkById.get(id)!),
      false,
    );
  }

  // Shots taken within ~8s of each other, chained (up to 6 at a time) — a candidate set for
  // "same moment," gated above to only count as a duplicate relationship when actually
  // near-identical to the winner, not merely nearby in time.
  const burstGroups = groupIntoBursts(photos);
  for (const burst of burstGroups) {
    resolveGroup(
      burst.photoIds.map((id) => checkById.get(id)!),
      true,
    );
  }

  const debugRows: Record<string, unknown>[] = [];
  for (const c of checks) {
    const isWinner = forceKeepIds.has(c.photo.id);
    // Group winners are protected from duplicate-loser status and from soft/uncertain signals
    // (blur, exposure, eyes) — that's the whole point of picking a "best of the group." But that
    // protection shouldn't extend to hard evidence that the winner itself is unusable: if an
    // entire burst came out blank or too blurry to make out (e.g. a phone briefly in a pocket),
    // "the best of a bad batch" is still bad, and force-keeping it anyway just because it beat
    // out three equally-ruined shots defeats the purpose of a "keepsake" app. No dup context is
    // passed for a winner — it's the reference point other members are compared against, so it
    // can never itself be "a duplicate of something better."
    const dup = isWinner ? undefined : dupContextById.get(c.photo.id);
    const result = classifyPhoto(c, dup);
    if (isWinner && result.verdict !== 'delete') {
      keep.push(c.photo);
      debugRows.push({ id: c.photo.id.slice(0, 8), verdict: 'keep (group winner)' });
      continue;
    }
    debugRows.push({
      id: c.photo.id.slice(0, 8),
      verdict: result.verdict,
      reason: result.reason,
      quality: result.scores.qualityScore.toFixed(2),
      blur: result.scores.blurScore.toFixed(2),
      exposure: result.scores.exposureScore.toFixed(2),
      people: result.scores.peopleScore.toFixed(2),
      uniqueness: result.scores.uniquenessScore.toFixed(2),
      duplicate: result.scores.duplicateScore.toFixed(2),
      confidence: result.scores.confidence.toFixed(2),
    });
    if (result.verdict === 'delete') {
      toDelete.push({ photo: c.photo, reason: result.reason, evidence: result.evidence, comparePhotoId: dup?.comparePhotoId });
    } else {
      keep.push(c.photo);
    }
  }
  // Per-photo score breakdown for diagnosability — visible in devtools, never shown to the
  // parent using the app. See classifyPhoto.ts for what each column means.
  if (debugRows.length > 0) console.table(debugRows);

  return { keep, toDelete };
}
