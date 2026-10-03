import { useEffect, useRef, useState } from 'react';
import type { Photo } from '../db/indexedDb';
import { createThumbnailUrl } from '../lib/thumbnails';

// A grid tile's image: only made once the tile is near the screen, shrunk to a thumbnail,
// retried once from storage if the browser can't show it, and replaced by a clear "can't
// preview" tile — never the browser's broken-image icon — if it still won't load.
export default function PhotoThumbImage({ photo, className = '' }: { photo: Photo; className?: string }) {
  const holderRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0); // 0 = normal, 1 = re-read from storage
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = holderRef.current;
    if (!el || visible) return;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '600px 0px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!visible || failed) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    createThumbnailUrl(photo, { fresh: attempt > 0 })
      .then((u) => {
        if (cancelled) {
          URL.revokeObjectURL(u);
          return;
        }
        objectUrl = u;
        setUrl(u);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [visible, photo.id, photo.blob, attempt, failed]);

  function handleError() {
    setUrl(null);
    if (attempt === 0) setAttempt(1);
    else setFailed(true);
  }

  return (
    <div ref={holderRef} className="w-full h-full">
      {failed ? (
        <div className="w-full h-full flex items-center justify-center text-center text-[11px] leading-snug text-[#8A8177] px-2">
          Can't preview this photo
        </div>
      ) : url ? (
        <img src={url} alt="" decoding="async" onError={handleError} className={`w-full h-full object-cover ${className}`} />
      ) : null}
    </div>
  );
}
