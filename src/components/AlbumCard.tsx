import { useEffect, useState } from 'react';
import type { Album } from '../db/indexedDb';
import { getPhotosByAlbum } from '../db/indexedDb';
import { getDisplayableBlob } from '../hooks/usePhotoUrl';
import { pickCoverPhoto } from '../lib/pickCover';

interface AlbumCardProps {
  album: Album;
  href: string;
  onDelete: () => void;
}

export default function AlbumCard({ album, href, onDelete }: AlbumCardProps) {
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

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
    <div className="relative bg-white border border-black/5 rounded-2xl overflow-hidden hover:border-[#BB5133]/30 hover:shadow-md hover:-translate-y-0.5 transition-all">
      <a href={href} className="block w-full text-left">
        <div className="aspect-square bg-[#EFE9DD] flex items-center justify-center">
          {coverUrl ? (
            <img src={coverUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            <span className="text-3xl opacity-40">📁</span>
          )}
        </div>
        <div className="p-3">
          <p className="font-semibold text-[#231F1B] text-sm truncate">{album.name}</p>
          <p className="text-xs text-[#A69C8E]">{count === null ? '…' : `${count} photo${count === 1 ? '' : 's'}`}</p>
        </div>
      </a>
      {confirmingDelete ? (
        <div className="absolute inset-0 bg-[#FBF8F2]/95 flex flex-col items-center justify-center gap-3 p-4 text-center">
          <p className="text-sm font-semibold text-[#231F1B]">Delete "{album.name}"?</p>
          <p className="text-xs text-[#7A7266]">The photos stay — they move to All Kept Photos.</p>
          <div className="flex gap-2">
            <button
              onClick={() => setConfirmingDelete(false)}
              className="text-sm bg-white border border-black/10 text-[#231F1B] font-medium px-3 py-1.5 rounded-full hover:bg-[#EFE9DD] transition-colors"
            >
              Keep it
            </button>
            <button
              onClick={onDelete}
              className="text-sm bg-[#BB5133] text-white font-medium px-3 py-1.5 rounded-full hover:bg-[#9A3F26] transition-colors"
            >
              Delete album
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setConfirmingDelete(true)}
          aria-label={`Delete album ${album.name}`}
          title="Delete album (photos stay — they just move to All Kept Photos)"
          className="absolute top-2.5 right-2.5 w-7 h-7 rounded-full bg-white/90 text-[#A69C8E] hover:text-[#BB5133] hover:bg-[#F6DFCF] flex items-center justify-center shadow-sm transition-colors"
        >
          ✕
        </button>
      )}
    </div>
  );
}
