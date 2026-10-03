import { useEffect, useState } from 'react';
import type { Photo } from '../db/indexedDb';
import PhotoThumbImage from './PhotoThumbImage';

const monthLabelFormat = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' });
const dayLabelFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });

function monthKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}`;
}

interface MonthGroup {
  key: string;
  label: string;
  sortTs: number;
  photos: Photo[];
}

// Buckets by month (most recent month first) without reordering photos within a month —
// callers may already have them in a meaningful order (burst/session grouping, etc).
function groupByMonth(photos: Photo[]): MonthGroup[] {
  const groups = new Map<string, MonthGroup>();
  for (const photo of photos) {
    const key = monthKey(photo.capturedAt);
    let group = groups.get(key);
    if (!group) {
      group = { key, label: monthLabelFormat.format(new Date(photo.capturedAt)), sortTs: photo.capturedAt, photos: [] };
      groups.set(key, group);
    }
    group.photos.push(photo);
  }
  return Array.from(groups.values()).sort((a, b) => b.sortTs - a.sortTs);
}

function PhotoThumb({
  photo,
  selected,
  moveIcon,
  onToggle,
  onNoteChange,
  caption,
}: {
  photo: Photo;
  selected: boolean;
  moveIcon?: string;
  onToggle: () => void;
  onNoteChange?: (id: string, note: string) => void;
  caption?: { reason: string; evidence: string };
}) {
  const [noteDraft, setNoteDraft] = useState(photo.note);

  useEffect(() => {
    setNoteDraft(photo.note);
  }, [photo.id, photo.note]);

  return (
    <div className="flex flex-col gap-1">
      <button
        onClick={onToggle}
        title={moveIcon ? 'Tap to move to the other pile' : undefined}
        className={`relative aspect-square w-full rounded-xl overflow-hidden shadow-sm bg-stone-100 ${selected ? 'ring-4 ring-rose-400' : ''}`}
      >
        <PhotoThumbImage photo={photo} />
        {selected && (
          <span className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-rose-400 text-white text-xs flex items-center justify-center shadow">
            ✓
          </span>
        )}
        {moveIcon && (
          <span className="absolute top-1.5 right-1.5 min-w-[22px] h-[22px] px-1 rounded-full bg-black/60 text-white text-sm flex items-center justify-center shadow">
            {moveIcon}
          </span>
        )}
      </button>
      <p className="text-xs text-stone-400 text-center truncate">{dayLabelFormat.format(new Date(photo.capturedAt))}</p>
      {caption && (
        <div className="text-xs bg-red-50 border border-red-100 rounded-lg px-2 py-1.5 text-red-700" title={caption.evidence}>
          <p className="font-semibold truncate">{caption.reason}</p>
          <p className="text-red-500 leading-snug line-clamp-2">{caption.evidence}</p>
        </div>
      )}
      {onNoteChange && (
        <input
          type="text"
          value={noteDraft}
          onChange={(e) => setNoteDraft(e.target.value)}
          onBlur={() => {
            if (noteDraft !== photo.note) onNoteChange(photo.id, noteDraft);
          }}
          placeholder="Add a caption…"
          className="w-full text-xs text-stone-600 placeholder:text-stone-400 bg-white border border-stone-200 rounded-lg px-2 py-1 outline-none focus:border-rose-300"
        />
      )}
    </div>
  );
}

interface VirtualPhotoGridProps {
  photos: Photo[];
  isSelected: (id: string) => boolean;
  onToggle: (id: string) => void;
  moveIcon?: string;
  onNoteChange?: (id: string, note: string) => void;
  getCaption?: (id: string) => { reason: string; evidence: string } | undefined;
}

export default function VirtualPhotoGrid({
  photos,
  isSelected,
  onToggle,
  moveIcon,
  onNoteChange,
  getCaption,
}: VirtualPhotoGridProps) {
  const groups = groupByMonth(photos);

  return (
    <div className="flex flex-col gap-6">
      {groups.map((group) => (
        <div key={group.key}>
          <h3 className="text-sm font-semibold text-[#8A8177] mb-2">
            {group.label} <span className="text-stone-500 font-normal">· {group.photos.length}</span>
          </h3>
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
            {group.photos.map((photo) => (
              <PhotoThumb
                key={photo.id}
                photo={photo}
                selected={isSelected(photo.id)}
                moveIcon={moveIcon}
                onToggle={() => onToggle(photo.id)}
                onNoteChange={onNoteChange}
                caption={getCaption?.(photo.id)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
