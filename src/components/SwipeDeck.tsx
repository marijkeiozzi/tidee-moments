import { useEffect, useMemo, useState } from 'react';
import { motion, useMotionValue, useTransform, type PanInfo } from 'framer-motion';
import type { Photo } from '../db/indexedDb';
import type { PhotoBurst } from '../lib/bursts';
import PhotoCard from './PhotoCard';
import BurstCard from './BurstCard';

type SwipeDirection = 'keep' | 'trash' | 'album';

interface SwipeDeckProps {
  photos: Photo[];
  bursts: PhotoBurst[];
  onSwipe: (photo: Photo, direction: SwipeDirection) => void;
  onNoteChange: (id: string, note: string) => void;
  onResolveBurst: (keep: Photo, skip: Photo[]) => void;
  onKeepAllBurst: (photos: Photo[]) => void;
  onDeleteAllBurst: (photos: Photo[]) => void;
  onGoToAlbums: () => void;
}

const SWIPE_THRESHOLD = 120;
const VELOCITY_THRESHOLD = 500;

export default function SwipeDeck({
  photos,
  bursts,
  onSwipe,
  onNoteChange,
  onResolveBurst,
  onKeepAllBurst,
  onDeleteAllBurst,
  onGoToAlbums,
}: SwipeDeckProps) {
  const top = photos[0];
  const [dismissedBurstIds, setDismissedBurstIds] = useState<Set<string>>(new Set());

  const activeBurst = top ? bursts.find((b) => !dismissedBurstIds.has(b.id) && b.photoIds.includes(top.id)) : undefined;

  const burstPhotos = useMemo(
    () =>
      activeBurst
        ? activeBurst.photoIds.map((id) => photos.find((p) => p.id === id)).filter((p): p is Photo => Boolean(p))
        : [],
    [activeBurst, photos],
  );

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (!top || activeBurst) return;
      if (e.key === 'ArrowRight') onSwipe(top, 'keep');
      if (e.key === 'ArrowLeft') onSwipe(top, 'trash');
      if (e.key === 'ArrowUp') onSwipe(top, 'album');
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [top, onSwipe, activeBurst]);

  if (!top) {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center text-stone-400 gap-3">
        <span className="text-4xl">🎉</span>
        <span>No photos left to tidee up — nice work!</span>
        <button
          onClick={onGoToAlbums}
          className="text-sm bg-rose-400 hover:bg-rose-500 text-white font-semibold px-4 py-2 rounded-full shadow-sm hover:shadow-md transition-all"
        >
          📁 View your sorted photos
        </button>
      </div>
    );
  }

  if (activeBurst && burstPhotos.length >= 3) {
    return (
      <div className="absolute inset-0">
        <BurstCard
          key={activeBurst.id}
          photos={burstPhotos}
          onResolve={onResolveBurst}
          onKeepAll={onKeepAllBurst}
          onDeleteAll={onDeleteAllBurst}
          onReviewIndividually={() => setDismissedBurstIds((prev) => new Set(prev).add(activeBurst.id))}
        />
      </div>
    );
  }

  return (
    <div className="absolute inset-0">
      {photos
        .slice(0, 3)
        .reverse()
        .map((photo, i, arr) => {
          const isTop = i === arr.length - 1;
          return (
            <SwipeCard
              key={photo.id}
              photo={photo}
              stackDepth={arr.length - 1 - i}
              interactive={isTop}
              onSwipe={(direction) => onSwipe(photo, direction)}
              onNoteChange={onNoteChange}
            />
          );
        })}
    </div>
  );
}

interface SwipeCardProps {
  photo: Photo;
  stackDepth: number;
  interactive: boolean;
  onSwipe: (direction: SwipeDirection) => void;
  onNoteChange: (id: string, note: string) => void;
}

function SwipeCard({ photo, stackDepth, interactive, onSwipe, onNoteChange }: SwipeCardProps) {
  const [exiting, setExiting] = useState<SwipeDirection | null>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotate = useTransform(x, [-300, 300], [-15, 15]);
  const keepOpacity = useTransform(x, [0, SWIPE_THRESHOLD], [0.35, 1]);
  const trashOpacity = useTransform(x, [0, -SWIPE_THRESHOLD], [0.35, 1]);
  const albumOpacity = useTransform(y, [0, -SWIPE_THRESHOLD], [0.35, 1]);

  function handleDragEnd(_: unknown, info: PanInfo) {
    const { offset, velocity } = info;

    if (offset.y < -SWIPE_THRESHOLD || velocity.y < -VELOCITY_THRESHOLD) {
      setExiting('album');
      onSwipe('album');
      return;
    }
    if (offset.x > SWIPE_THRESHOLD || velocity.x > VELOCITY_THRESHOLD) {
      setExiting('keep');
      onSwipe('keep');
      return;
    }
    if (offset.x < -SWIPE_THRESHOLD || velocity.x < -VELOCITY_THRESHOLD) {
      setExiting('trash');
      onSwipe('trash');
      return;
    }
  }

  const exitAnimation =
    exiting === 'keep'
      ? { x: 500, opacity: 0 }
      : exiting === 'trash'
        ? { x: -500, opacity: 0 }
        : exiting === 'album'
          ? { y: -500, opacity: 0 }
          : undefined;

  return (
    <motion.div
      className="absolute inset-0"
      style={{
        x: interactive ? x : 0,
        y: interactive ? y : 0,
        rotate: interactive ? rotate : 0,
        scale: 1 - stackDepth * 0.04,
        top: stackDepth * 10,
        zIndex: 100 - stackDepth,
      }}
      drag={interactive}
      dragElastic={0.7}
      onDragEnd={handleDragEnd}
      animate={exitAnimation}
      transition={{ duration: 0.3 }}
    >
      <PhotoCard photo={photo} editable={interactive} onNoteChange={onNoteChange} />

      {interactive && (
        <>
          <motion.div
            style={{ opacity: trashOpacity }}
            className="absolute top-2 left-2 sm:top-6 sm:left-6 bg-white/90 border-2 sm:border-4 border-red-500 text-red-600 font-bold text-xs sm:text-xl px-1.5 py-0.5 sm:px-3 sm:py-1 rounded sm:rounded-lg -rotate-12 shadow-md whitespace-nowrap"
          >
            ← DELETE
          </motion.div>
          <motion.div
            style={{ opacity: keepOpacity }}
            className="absolute top-2 right-2 sm:top-6 sm:right-6 bg-white/90 border-2 sm:border-4 border-green-500 text-green-600 font-bold text-xs sm:text-xl px-1.5 py-0.5 sm:px-3 sm:py-1 rounded sm:rounded-lg rotate-12 shadow-md whitespace-nowrap"
          >
            KEEP →
          </motion.div>
        </>
      )}
    </motion.div>
  );
}
