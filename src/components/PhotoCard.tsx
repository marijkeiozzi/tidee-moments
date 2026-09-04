import { useEffect, useState } from 'react';
import type { Photo } from '../db/indexedDb';
import { usePhotoUrl } from '../hooks/usePhotoUrl';

interface PhotoCardProps {
  photo: Photo;
  editable?: boolean;
  onNoteChange?: (id: string, note: string) => void;
}

export default function PhotoCard({ photo, editable, onNoteChange }: PhotoCardProps) {
  const url = usePhotoUrl(photo);
  const [noteDraft, setNoteDraft] = useState(photo.note);

  useEffect(() => {
    setNoteDraft(photo.note);
  }, [photo.id, photo.note]);

  return (
    <div className="flex flex-col w-full h-full rounded-2xl overflow-hidden bg-white shadow-lg select-none">
      <div className="relative flex-1 min-h-0 bg-stone-100">
        {url ? (
          <img src={url} alt="" className="w-full h-full object-contain pointer-events-none" draggable={false} />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-10 h-10 rounded-full border-4 border-stone-200 border-t-rose-400 animate-spin" />
          </div>
        )}
      </div>

      {editable && (
        <div
          className="shrink-0 border-t border-stone-200 bg-white px-3 py-2 flex items-center gap-2"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <input
            type="text"
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            onBlur={() => onNoteChange?.(photo.id, noteDraft)}
            placeholder="Add a note… (e.g. Emma's 3rd birthday)"
            className="flex-1 min-w-0 text-sm text-stone-700 placeholder:text-stone-400 outline-none"
          />
        </div>
      )}
    </div>
  );
}
