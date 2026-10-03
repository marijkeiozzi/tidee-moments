import { useEffect, useState } from 'react';
import type { Album, Photo } from '../db/indexedDb';
import { getPhotosByAlbum } from '../db/indexedDb';
import PhotoThumbImage from './PhotoThumbImage';
import { pickCoverPhoto } from '../lib/pickCover';

interface AlbumCardProps {
  album: Album;
  onOpen: () => void;
  onDelete: () => void;
}

export default function AlbumCard({ album, onOpen, onDelete }: AlbumCardProps) {
  const [cover, setCover] = useState<Photo | null>(null);
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    getPhotosByAlbum(album.id).then(async (photos) => {
      if (cancelled) return;
      setCount(photos.length);
      const picked = await pickCoverPhoto(photos);
      if (!cancelled) setCover(picked);
    });
    return () => {
      cancelled = true;
    };
  }, [album.id]);

  return (
    <div className="relative bg-white border border-black/5 rounded-2xl overflow-hidden hover:border-[#BB5133]/30 hover:shadow-md hover:-translate-y-0.5 transition-all">
      <button onClick={onOpen} className="w-full text-left">
        <div className="aspect-square bg-[#EFE9DD] flex items-center justify-center">
          {cover ? <PhotoThumbImage photo={cover} /> : <span className="text-3xl opacity-40">📁</span>}
        </div>
        <div className="p-3">
          <p className="font-semibold text-[#231F1B] text-sm truncate">{album.name}</p>
          <p className="text-xs text-[#A69C8E]">{count === null ? '…' : `${count} photo${count === 1 ? '' : 's'}`}</p>
        </div>
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        title="Delete album (the photos stay in your Timeline)"
        className="absolute top-2.5 right-2.5 w-7 h-7 rounded-full bg-white/90 text-[#A69C8E] hover:text-red-500 hover:bg-red-50 flex items-center justify-center shadow-sm transition-colors"
      >
        ✕
      </button>
    </div>
  );
}
