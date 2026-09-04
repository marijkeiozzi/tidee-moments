import { useEffect, useState } from 'react';
import type { Photo } from '../db/indexedDb';
import { getDisplayableBlob } from '../hooks/usePhotoUrl';
import { detectBlur } from '../lib/blurDetection';
import { detectClosedEyes } from '../lib/eyesClosed';
import { scorePhotoQuality } from '../lib/photoScore';

const NO_FACE_CHECK = { eyesClosed: false, facingAway: false, faceCount: 0, openEyesFraction: 1, smileScore: 0, maxFaceArea: 0 };

interface BurstCardProps {
  photos: Photo[];
  onResolve: (keep: Photo, skip: Photo[]) => void;
  onKeepAll: (photos: Photo[]) => void;
  onDeleteAll: (photos: Photo[]) => void;
  onReviewIndividually: () => void;
}

export default function BurstCard({ photos, onResolve, onKeepAll, onDeleteAll, onReviewIndividually }: BurstCardProps) {
  const [urls, setUrls] = useState<string[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const objectUrls: string[] = [];

    Promise.all(photos.map((p) => getDisplayableBlob(p))).then((blobs) => {
      if (cancelled) return;
      blobs.forEach((blob) => objectUrls.push(URL.createObjectURL(blob)));
      setUrls(objectUrls);
    });

    return () => {
      cancelled = true;
      objectUrls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [photos]);

  // Free, local pick — same sharpness/face/eyes-open scoring auto-sort uses to pick a group
  // winner. No AI, no API call, no photo ever leaves the device.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    setSelectedIndex(null);
    setReason(null);

    Promise.all(
      photos.map(async (p) => {
        const [blur, face] = await Promise.all([
          detectBlur(p.blob).catch(() => ({ isBlurry: false, sharpness: 0 })),
          detectClosedEyes(p.blob).catch(() => NO_FACE_CHECK),
        ]);
        return { score: scorePhotoQuality({ sharpness: blur.sharpness, ...face }), face };
      }),
    )
      .then((results) => {
        if (cancelled) return;
        let bestIdx = 0;
        for (let i = 1; i < results.length; i++) {
          if (results[i].score > results[bestIdx].score) bestIdx = i;
        }
        const bestFace = results[bestIdx].face;
        setSelectedIndex(bestIdx);
        setReason(
          bestFace.faceCount === 0
            ? 'Picked the sharpest shot'
            : bestFace.smileScore > 0.5
              ? 'Picked the clearest smiling shot with eyes open'
              : 'Picked the clearest shot with eyes open',
        );
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [photos]);

  const effectiveIndex = selectedIndex ?? 0;

  function handleConfirm() {
    const keep = photos[effectiveIndex];
    const skip = photos.filter((_, i) => i !== effectiveIndex);
    onResolve(keep, skip);
  }

  return (
    <div className="flex flex-col w-full h-full rounded-2xl overflow-hidden bg-white shadow-lg select-none">
      <div className="relative flex-1 min-h-0 bg-stone-100">
        {urls[effectiveIndex] && (
          <img src={urls[effectiveIndex]} alt="" className="w-full h-full object-contain pointer-events-none" draggable={false} />
        )}
        <div className="absolute top-3 left-3 bg-rose-400/90 text-white text-xs font-medium px-2 py-1 rounded-full shadow-sm">
          🎯 Burst of {photos.length}
        </div>
        {loading && (
          <div className="absolute top-3 right-3 bg-rose-400/90 text-white text-xs font-medium px-2 py-1 rounded-full shadow-sm">
            ✨ Picking the best one…
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-stone-200 bg-white p-3">
        <div className="flex gap-2 mb-3 overflow-x-auto" onPointerDown={(e) => e.stopPropagation()}>
          {urls.map((url, i) => (
            <button
              key={photos[i].id}
              onClick={() => setSelectedIndex(i)}
              className={`shrink-0 w-14 h-14 rounded-lg overflow-hidden border-2 ${
                i === effectiveIndex ? 'border-rose-400' : 'border-transparent opacity-60'
              }`}
            >
              <img src={url} alt="" className="w-full h-full object-cover" />
            </button>
          ))}
        </div>

        {!loading && !failed && reason && (
          <p className="text-xs text-stone-500 mb-2 leading-snug">✨ {reason}</p>
        )}
        {!loading && failed && (
          <p className="text-xs text-stone-400 mb-2">
            Couldn't automatically pick a favorite — showing the first shot. Tap a thumbnail to choose a different one.
          </p>
        )}

        <div
          className="flex flex-col gap-1.5"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={handleConfirm}
            className="bg-rose-400 hover:bg-rose-500 text-white font-semibold text-sm py-2 rounded-full shadow-sm transition-colors"
          >
            ❤️ Keep this one, skip the rest
          </button>
          <div className="flex gap-1.5">
            <button
              onClick={() => onKeepAll(photos)}
              className="flex-1 bg-green-100 hover:bg-green-200 text-green-700 font-semibold text-sm py-2 rounded-full transition-colors"
            >
              ✅ Keep all {photos.length}
            </button>
            <button
              onClick={() => onDeleteAll(photos)}
              className="flex-1 bg-red-100 hover:bg-red-200 text-red-700 font-semibold text-sm py-2 rounded-full transition-colors"
            >
              🗑️ Delete all {photos.length}
            </button>
          </div>
          <button
            onClick={onReviewIndividually}
            className="text-xs text-stone-400 hover:text-stone-600 hover:underline py-1"
          >
            Review each photo individually instead
          </button>
        </div>
      </div>
    </div>
  );
}
