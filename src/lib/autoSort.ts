import type { Photo } from '../db/indexedDb';
import { findDuplicateGroups, hammingDistance, thumbDifference } from './duplicateDetection';
import { groupIntoBursts } from './bursts';
import { classifyScene } from './sceneClassification';
import { scorePhotoQuality } from './photoScore';
import { mapWithConcurrency, pickConcurrency } from './concurrency';
import { analyzePhoto, THUMB_SIZE, type PhotoFingerprint } from './photoAnalysis';
import {
  classifyPhoto,
  type ClassifySignals,
  type DuplicateContext,
  type QualityFlag,
  type Sensitivity,
} from './classifyPhoto';

export type { Sensitivity, QualityFlag };

// A photo already kept in an earlier sort, with the fingerprint saved for it then — lets a new
// batch (say, the same photos arriving again from a partner's phone or a WhatsApp chat) be
// checked against the whole library, not just against itself.
export interface LibraryEntry {
  id: string;
  fingerprint: PhotoFingerprint;
}

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
  flags: QualityFlag[];
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
  // Per-photo fingerprint, saved alongside each photo that ends up kept (see App.tsx) so later
  // sorts can recognise copies of it.
  fingerprints: Map<string, PhotoFingerprint>;
}

// How often the progress callback fires for a big batch — calling it (and the React state
// update it usually drives) on every single photo would mean thousands of re-renders for a
// batch of thousands; this keeps the UI feeling live without that overhead.
const PROGRESS_STEP = 10;

interface Check extends ClassifySignals {
  photo: Photo;
  hash: bigint | null;
  fingerprint: PhotoFingerprint | null;
}

const NO_FACE_CHECK = { eyesClosed: false, facingAway: false, faceCount: 0, openEyesFraction: 1, smileScore: 0, maxFaceArea: 0 };

// Two photos within the dHash duplicate threshold only count as the same shot if their colour
// thumbnails also match block by block (see thumbDifference). Calibrated on test photos:
// re-saved, resized, messaging-app and lightly edited copies stayed at or under 12; the same
// scene with the subject moved, recoloured (a different outfit) or swapped measured 22-90.
const SAME_SHOT_MAX_BLOCK_DIFFERENCE = 16;
// Matches duplicateDetection.ts's default near-exact threshold.
const LIBRARY_HAMMING_CEILING = 8;
// A library match with at least this many times the pixels of the copy already kept is the
// better copy (e.g. the original from a partner's phone vs. a compressed WhatsApp copy kept
// earlier) — kept and flagged instead of deleted.
const BETTER_COPY_PIXEL_RATIO = 1.5;

function sameShot(a: PhotoFingerprint | null, b: PhotoFingerprint | null): boolean {
  if (!a || !b) return false;
  if (a.sha256 && a.sha256 === b.sha256) return true;
  return thumbDifference(a.thumb, b.thumb, THUMB_SIZE).worstBlock <= SAME_SHOT_MAX_BLOCK_DIFFERENCE;
}

function isExactCopy(a: PhotoFingerprint | null, b: PhotoFingerprint | null): boolean {
  return Boolean(a?.sha256 && a.sha256 === b?.sha256);
}

// Entirely on-device — blur, closed-eyes, exposure/resolution, and near-duplicate detection.
// No AI, no API call, no cost, works offline.
export async function runAutoSort(
  photos: Photo[],
  onProgress: (done: number, total: number) => void,
  sensitivity: Sensitivity = 'balanced',
  library: LibraryEntry[] = [],
): Promise<AutoSortResult> {
  const keep: Photo[] = [];
  const toDelete: DeleteCandidate[] = [];
  let done = 0;

  const checks = await mapWithConcurrency(photos, pickConcurrency(), async (photo) => {
    let check: Check;
    try {
      const [analysis, scene] = await Promise.all([
        analyzePhoto(photo.blob),
        classifyScene(photo.blob).catch(() => ({ isUtilityPhoto: false, label: null, confidence: 0 })),
      ]);
      const face = analysis.face;
      check = {
        photo,
        sharpness: analysis.sharpness,
        focusSharpness: analysis.focusSharpness,
        hash: analysis.hash,
        fingerprint: analysis.fingerprint,
        isBlurry: analysis.isBlurry,
        isLowQuality: analysis.quality.isLowQuality,
        qualityReason: analysis.quality.reason,
        clippedHighlights: analysis.clippedHighlights,
        isDocument: analysis.isDocument,
        isUtilityPhoto: scene.isUtilityPhoto,
        utilityLabel: scene.label,
        utilityConfidence: scene.confidence,
        eyesClosed: face.eyesClosed,
        facingAway: face.facingAway,
        faceCount: face.faceCount,
        openEyesFraction: face.openEyesFraction,
        smileScore: face.smileScore,
        maxFaceArea: face.maxFaceArea,
        faceSharpness: face.faceSharpness,
        faceBrightness: face.faceBrightness,
        frameBrightness: face.frameBrightness,
      };
    } catch {
      // If a check fails for a photo, default to keep — never auto-delete on an error.
      check = {
        photo,
        sharpness: Infinity,
        hash: null,
        fingerprint: null,
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
        dupContextById.set(c.photo.id, {
          hammingDistance: distance,
          qualityGap: gap,
          comparePhotoId: best.photo.id,
          exact: isExactCopy(c.fingerprint, best.fingerprint),
        });
      }
    }
  }

  const withHash = checks.filter((c): c is Check & { hash: bigint } => c.hash !== null);
  // No time bound on this pass, so a dHash match must also be confirmed by sameShot() — the
  // same crib from the same angle on a different day is not a duplicate.
  const duplicateGroups = findDuplicateGroups(
    withHash.map((c) => ({ id: c.photo.id, hash: c.hash })),
    undefined,
    (i, j) => sameShot(withHash[i].fingerprint, withHash[j].fingerprint),
  );
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

  // Copies of photos already kept in an earlier sort. Same bar as the in-batch duplicate pass
  // (exact file, or a dHash match confirmed block by block).
  const libraryDupById = new Map<string, DuplicateContext>();
  if (library.length > 0) {
    const bySha = new Map<string, LibraryEntry>();
    for (const entry of library) if (entry.fingerprint.sha256) bySha.set(entry.fingerprint.sha256, entry);
    const libraryHashes = library.map((entry) => {
      try {
        return BigInt(`0x${entry.fingerprint.dHash}`);
      } catch {
        return null;
      }
    });
    for (const c of checks) {
      if (!c.fingerprint || c.hash === null) continue;
      let match: LibraryEntry | undefined = c.fingerprint.sha256 ? bySha.get(c.fingerprint.sha256) : undefined;
      let distance = 0;
      if (!match) {
        let best = Infinity;
        for (let k = 0; k < library.length; k++) {
          const h = libraryHashes[k];
          if (h === null) continue;
          const d = hammingDistance(c.hash, h);
          if (d <= LIBRARY_HAMMING_CEILING && d < best && sameShot(c.fingerprint, library[k].fingerprint)) {
            best = d;
            match = library[k];
          }
        }
        distance = best;
      }
      if (!match) continue;
      const pixels = c.fingerprint.width * c.fingerprint.height;
      const libraryPixels = match.fingerprint.width * match.fingerprint.height;
      if (!isExactCopy(c.fingerprint, match.fingerprint) && pixels >= libraryPixels * BETTER_COPY_PIXEL_RATIO) {
        c.betterCopyOfLibraryPhoto = true;
        continue;
      }
      libraryDupById.set(c.photo.id, {
        hammingDistance: distance,
        qualityGap: 0,
        comparePhotoId: match.id,
        exact: isExactCopy(c.fingerprint, match.fingerprint),
        inLibrary: true,
      });
    }
  }

  const debugRows: Record<string, unknown>[] = [];
  const keptIds = new Set<string>();
  const resultById = new Map<string, { reason: string; evidence: string; flags: QualityFlag[] }>();
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
    // Already in the library trumps everything: even the best shot of this batch's group is
    // redundant if the moment is already kept.
    const dup = libraryDupById.get(c.photo.id) ?? (isWinner ? undefined : dupContextById.get(c.photo.id));
    const result = classifyPhoto(c, dup, sensitivity);
    if (isWinner && result.verdict !== 'delete') {
      keep.push(c.photo);
      keptIds.add(c.photo.id);
      resultById.set(c.photo.id, { reason: result.reason, evidence: result.evidence, flags: result.flags });
      debugRows.push({ id: c.photo.id.slice(0, 8), verdict: 'keep (group winner)', flags: result.flags.join(' ') });
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
      focus: c.focusSharpness?.toFixed(0),
      face: c.faceSharpness?.toFixed(0),
      flags: result.flags.join(' '),
    });
    resultById.set(c.photo.id, { reason: result.reason, evidence: result.evidence, flags: result.flags });
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
        similar: dupContextById.has(id) || libraryDupById.has(id),
        reason: r?.reason,
        evidence: r?.evidence,
        flags: r?.flags ?? [],
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
          similar: dupContextById.has(c.photo.id) || libraryDupById.has(c.photo.id),
          reason: r?.reason,
          evidence: r?.evidence,
          flags: r?.flags ?? [],
        },
      ],
    });
  }
  moments.sort((a, b) => a.timestamp - b.timestamp);

  const fingerprints = new Map<string, PhotoFingerprint>();
  for (const c of checks) if (c.fingerprint) fingerprints.set(c.photo.id, c.fingerprint);

  return { keep, toDelete, moments, fingerprints };
}
