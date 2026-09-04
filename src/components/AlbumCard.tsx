import { useEffect, useState } from 'react';
import type { Album } from '../db/indexedDb';
import { getPhotosByAlbum } from '../db/indexedDb';
import { getDisplayableBlob } from '../hooks/usePhotoUrl';
import { pickCoverPhoto } from '../lib/pickCover';

interface AlbumCardProps {
  album: Album;
  onOpen: () => void;
  onDelete: () => void;
}

export default function AlbumCard({ album, onOpen, onDelete }: AlbumCardProps) {
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;

    getPhotosByAlbum(album.id).then(async (photos) => {
      if (cancelled) return;
      setCount(photos.length);
      const cover = await pickCoverPhoto(photos);
      if (cancelled || !cover) return;
      const blob = await getDisplayableBlob(cover);
      if (cancelled) return;
      objectUrl = URL.createObjectURL(blob);
      setCoverUrl(objectUrl);
    });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [album.id]);

  return (
    <div className="relative bg-white border border-stone-200 rounded-2xl overflow-hidden hover:border-rose-300 hover:shadow-md hover:-translate-y-0.5 transition-all">
      <button onClick={onOpen} className="w-full text-left">
        <div className="aspect-square bg-stone-100 flex items-center justify-center">
          {coverUrl ? (
            <img src={coverUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            <span className="text-3xl opacity-40">📁</span>
          )}
        </div>
        <div className="p-3">
          <p className="font-semibold text-stone-700 text-sm truncate">{album.name}</p>
          <p className="text-xs text-stone-400">{count === null ? '…' : `${count} photo${count === 1 ? '' : 's'}`}</p>
        </div>
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        title="Delete album (photos stay — they just move to All Kept Photos)"
        className="absolute top-2.5 right-2.5 w-7 h-7 rounded-full bg-white/90 text-stone-400 hover:text-red-500 hover:bg-red-50 flex items-center justify-center shadow-sm transition-colors"
      >
        ✕
      </button>
    </div>
  );
}
