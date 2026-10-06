import type { Photo } from '../db/indexedDb';
import { detectBlur } from './blurDetection';
import { detectClosedEyes } from './eyesClosed';
import { detectLowQuality, type QualityResult } from './qualityDetection';
import { computeImageHash, findDuplicateGroups, hammingDistance } from './duplicateDetection';
import { groupIntoBursts } from './bursts';
import { detectDocumentLike } from './documentDetection';
import { classifyScene, detectFacesInWorker, facesInWorker } from './sceneClassification';
import { summarizeScene } from './sceneCategories';
import { scorePhotoQuality } from './photoScore';
import { mapWithConcurrency, pickPhotoConcurrency } from './concurrency';
import { decodeForAnalysis, makeThumbnail, releaseAnalysisImage } from './analysisImage';
import { saveThumb } from '../db/indexedDb';
import { classifyPhoto, type ClassifySignals, type DuplicateContext, type Sensitivity } from './classifyPhoto';

export type { Sensitivity };

export interface DeleteCandidate {
  photo: Photo;
  reason: string;
  evidence: string;
  comparePhotoId?: string;
}

// One photo within a "moment" (a burst, or a standalone shot treated as a moment of one) — used
// to render the day/moment-grouped review UI, including which member(s) of a moment were flagged
// as visually similar to the one being kept.
export interface MomentPhoto {
  photo: Photo;
  kept: boolean;
  similar: boolean;
  reason?: string;
  evidence?: string;
  // Soft issues worth a second look (closed eyes, soft focus, dark...) on a photo that was
  // still kept — never enough to set it aside on their own, but shown so the parent can decide.
  flags: string[];
}

// Human-readable soft issues for the review badges — the same signals classifyPhoto treats as
// "uncertain, keep", surfaced instead of silently swallowed.
function softFlagsOf(c: ClassifySignals): string[] {
  const flags: string[] = [];
  if (c.faceCount > 0 && c.eyesClosed) flags.push(c.faceCount > 1 ? 'Someone blinked' : 'Eyes closed');
  if (c.faceCount > 0 && c.facingAway) flags.push('Looking away');
  if (c.isBlurry) flags.push('Soft focus');
  if (c.isLowQuality && c.qualityReason === 'too-dark') flags.push('Too dark');
  if (c.isLowQuality && c.qualityReason === 'overexposed') flags.push('Overexposed');
  if (c.isLowQuality && c.qualityReason === 'low-resolution') flags.push('Low resolution');
  return flags;
}

export interface Moment {
  id: string;
  timestamp: number;
  photos: MomentPhoto[];
}

export interface AutoSortResult {
  keep: Photo[];
  toDelete: DeleteCandidate[];
  moments: Moment[];
}

// The progress callback fires at most this often (plus always on the last photo) — live from
// the very first photo on a slow phone, without a re-render per photo on a fast computer.
const PROGRESS_INTERVAL_MS = 150;

interface Check extends ClassifySignals {
  photo: Photo;
  hash: bigint | null;
}

const NO_FACE_CHECK = { eyesClosed: false, facingAway: false, faceCount: 0, openEyesFraction: 1, smileScore: 0, maxFaceArea: 0 };

// Per-photo signals for this page session. Detection is the slow part; the keep/set-aside
// decision on top of it is instant — so changing sensitivity or tapping "Start over" re-decides
// from these instead of re-analysing every photo.
const signalCache = new Map<string, Omit<Check, 'photo'>>();

async function analyzePhoto(photo: Photo): Promise<Omit<Check, 'photo'>> {
  const image = await decodeForAnalysis(photo.blob);
  try {
    const [{ isBlurry, sharpness }, face, quality, hash, isDocument, thumb] = await Promise.all([
      detectBlur(image).catch(() => ({ isBlurry: false, sharpness: Infinity })),
      (facesInWorker() ? detectFacesInWorker(image).catch(() => detectClosedEyes(image)) : detectClosedEyes(image)).catch(
        () => NO_FACE_CHECK,
      ),
      detectLowQuality(image).catch((): QualityResult => ({ isLowQuality: false })),
      computeImageHash(image).catch(() => null),
      detectDocumentLike(image).catch(() => false),
      makeThumbnail(image).catch(() => null),
    ]);
    // After the face check, so the slow person detector is skipped whenever a face already
    // settles it (see DetectMode).
    // The detector also has to rule out a person before a small camera-less image is set aside.
    const smallNoCamera = photo.hasCameraExif === false && quality.reason === 'low-resolution';
    const scene = await classifyScene(image, face.faceCount > 0 ? 'never' : isDocument || smallNoCamera ? 'always' : 'auto').catch(() =>
      summarizeScene([], null),
    );
    if (thumb) saveThumb(photo.id, thumb).catch(() => {});
    return {
      sharpness,
      hash,
      isBlurry,
      isLowQuality: quality.isLowQuality,
      qualityReason: quality.reason,
      isDocument,
      isUtilityPhoto: scene.isUtilityPhoto,
      utilityLabel: scene.label,
      utilityConfidence: scene.confidence,
      hasPerson: scene.hasPerson,
      noCameraExif: photo.hasCameraExif === false,
      eyesClosed: face.eyesClosed,
      facingAway: face.facingAway,
      faceCount: face.faceCount,
      openEyesFraction: face.openEyesFraction,
      smileScore: face.smileScore,
      maxFaceArea: face.maxFaceArea,
    };
  } finally {
    releaseAnalysisImage(image);
  }
}

// Entirely on-device — blur, closed-eyes, exposure/resolution, and near-duplicate detection.
// No AI, no API call, no cost, works offline.
export async function runAutoSort(
  photos: Photo[],
  onProgress: (done: number, total: number) => void,
  sensitivity: Sensitivity = 'balanced',
): Promise<AutoSortResult> {
  const keep: Photo[] = [];
  const toDelete: DeleteCandidate[] = [];
  let done = 0;
  let lastReported = 0;
  onProgress(0, photos.length);

  const checks = await mapWithConcurrency(photos, pickPhotoConcurrency(), async (photo) => {
    let check: Check;
    const cached = signalCache.get(photo.id);
    if (cached) {
      check = { photo, ...cached };
    } else {
      try {
        const signals = await analyzePhoto(photo);
        signalCache.set(photo.id, signals);
        check = { photo, ...signals };
      } catch {
        // If a photo can't be analysed, default to keep — never auto-delete on an error. Not
        // cached, so a later re-sort gets another try.
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
    }
    done++;
    const now = performance.now();
    if (done === photos.length || now - lastReported > PROGRESS_INTERVAL_MS) {
      lastReported = now;
      onProgress(done, photos.length);
    }
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
  // would for a farther-away scene. Small in-frame changes (a blink, eyes gradually closing while
  // falling asleep) push it further still. This looser ceiling only applies to members of a
  // time-bounded burst (already confirmed within ~30s of each other by groupIntoBursts), so the
  // risk of it linking two unrelated moments is already bounded by that time window, unlike the
  // any-time-gap pass above — tuned aggressively per explicit user preference for deduping over
  // preserving small in-sequence variation.
  const BURST_DUPLICATE_CEILING = 32;

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

  // A run of near-identical shots longer than a burst's 6-photo cap gets split into several
  // bursts, and each would otherwise force-keep its own winner — so ten copies of the same
  // moment came out as two. A burst winner that is itself a near-exact duplicate of a better
  // winner (from the any-time duplicate pass) gives way to it, and anything compared against it
  // is re-pointed at the photo actually being kept.
  for (const id of Array.from(forceKeepIds)) {
    const ctx = dupContextById.get(id);
    if (!ctx || ctx.comparePhotoId === id || ctx.hammingDistance > STRICT_DUPLICATE_CEILING) continue;
    if (!forceKeepIds.has(ctx.comparePhotoId)) continue;
    forceKeepIds.delete(id);
    for (const [otherId, other] of dupContextById) {
      if (other.comparePhotoId === id && otherId !== ctx.comparePhotoId) {
        dupContextById.set(otherId, { ...other, comparePhotoId: ctx.comparePhotoId });
      }
    }
  }

  const debugRows: Record<string, unknown>[] = [];
  const keptIds = new Set<string>();
  const resultById = new Map<string, { reason: string; evidence: string }>();
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
    const result = classifyPhoto(c, dup, sensitivity);
    if (isWinner && result.verdict !== 'delete') {
      keep.push(c.photo);
      keptIds.add(c.photo.id);
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
    resultById.set(c.photo.id, { reason: result.reason, evidence: result.evidence });
    if (result.verdict === 'delete') {
      toDelete.push({ photo: c.photo, reason: result.reason, evidence: result.evidence, comparePhotoId: dup?.comparePhotoId });
    } else {
      keep.push(c.photo);
      keptIds.add(c.photo.id);
    }
  }
  // Per-photo score breakdown for diagnosability — visible in devtools, never shown to the
  // parent using the app. See classifyPhoto.ts for what each column means.
  if (debugRows.length > 0) console.table(debugRows);

  // Group every processed photo into "moments" for the review UI — a burst becomes one moment,
  // and any photo that wasn't part of a burst becomes its own single-shot moment. This is purely
  // a display grouping (by capture time), separate from the duplicate/keep decision above.
  const inBurst = new Set<string>();
  const moments: Moment[] = burstGroups.map((burst) => {
    const momentPhotos = burst.photoIds.map((id) => {
      inBurst.add(id);
      const c = checkById.get(id)!;
      const r = resultById.get(id);
      return {
        photo: c.photo,
        kept: keptIds.has(id),
        similar: dupContextById.has(id),
        reason: r?.reason,
        evidence: r?.evidence,
        flags: softFlagsOf(c),
      };
    });
    momentPhotos.sort((a, b) => a.photo.capturedAt - b.photo.capturedAt);
    return { id: burst.id, timestamp: momentPhotos[0].photo.capturedAt, photos: momentPhotos };
  });
  for (const c of checks) {
    if (inBurst.has(c.photo.id)) continue;
    const r = resultById.get(c.photo.id);
    moments.push({
      id: `single-${c.photo.id}`,
      timestamp: c.photo.capturedAt,
      photos: [
        {
          photo: c.photo,
          kept: keptIds.has(c.photo.id),
          similar: dupContextById.has(c.photo.id),
          reason: r?.reason,
          evidence: r?.evidence,
          flags: softFlagsOf(c),
        },
      ],
    });
  }
  moments.sort((a, b) => a.timestamp - b.timestamp);

  return { keep, toDelete, moments };
}
