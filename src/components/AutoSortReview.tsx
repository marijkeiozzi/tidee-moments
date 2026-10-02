import { useEffect, useMemo, useRef, useState } from 'react';
import type { Photo } from '../db/indexedDb';
import { suggestAlbumName } from '../lib/sessions';
import { suggestMilestoneAlbumName } from '../lib/milestones';
import type { DeleteCandidate, Moment, Sensitivity } from '../lib/autoSort';
import { usePhotoUrl } from '../hooks/usePhotoUrl';

export type ConfirmAlbumChoice = { type: 'single'; name: string };

interface AutoSortReviewProps {
  keepPhotos: Photo[];
  deletePhotos: DeleteCandidate[];
  moments: Moment[];
  sensitivity: Sensitivity;
  onSensitivityChange: (s: Sensitivity) => void;
  resorting: boolean;
  onMove: (photoId: string, to: 'keep' | 'delete') => void;
  onConfirm: (choice: ConfirmAlbumChoice) => void;
  onCancel: () => void;
  confirming: boolean;
}

const SENSITIVITY_OPTIONS: { value: Sensitivity; label: string }[] = [
  { value: 'strict', label: 'Just the best' },
  { value: 'balanced', label: 'Balanced' },
  { value: 'generous', label: 'Generous' },
];

type Filter = 'all' | 'kept' | 'setAside';

const dayFormat = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const timeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

// Short badge label for a set-aside photo, derived from its classification reason — matches
// what actually got it flagged (BLURRY, SIMILAR, BLANK, SCREENSHOT...) rather than a generic
// "not kept" label, so the reason is visible at a glance without opening each photo.
function badgeLabel(reason: string | undefined, similar: boolean): string {
  if (!reason) return similar ? 'Similar' : 'Set aside';
  const r = reason.toLowerCase();
  if (r.includes('duplicate')) return 'Similar';
  if (r.includes('blurry')) return 'Blurry';
  if (r.includes('blank')) return 'Blank';
  if (r.includes('screenshot') || r.includes('document')) return 'Screenshot';
  if (r.includes('reference photo')) return 'Reference';
  if (r.includes('moved to delete')) return 'Set aside';
  return similar ? 'Similar' : 'Set aside';
}

function MomentThumb({
  photo,
  kept,
  similar,
  reason,
  onToggle,
}: {
  photo: Photo;
  kept: boolean;
  similar: boolean;
  reason?: string;
  onToggle: () => void;
}) {
  const url = usePhotoUrl(photo);
  return (
    <button
      onClick={onToggle}
      className={`relative aspect-square w-full rounded-xl overflow-hidden bg-[#EFE9DD] ${kept ? 'ring-2 ring-[#BB5133]' : ''}`}
    >
      {url ? (
        <img src={url} alt="" className={`w-full h-full object-cover transition-all ${kept ? '' : 'grayscale opacity-70'}`} />
      ) : null}
      {!kept && (
        <span className="absolute top-2 left-2 bg-black/55 text-white text-[10px] font-semibold tracking-wide uppercase px-2 py-0.5 rounded-full">
          {badgeLabel(reason, similar)}
        </span>
      )}
      {kept && (
        <span className="absolute top-2 right-2 w-6 h-6 rounded-full bg-[#BB5133] text-white flex items-center justify-center shadow">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
            <path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      )}
    </button>
  );
}

export default function AutoSortReview({
  keepPhotos,
  deletePhotos,
  moments,
  sensitivity,
  onSensitivityChange,
  resorting,
  onMove,
  onConfirm,
  onCancel,
  confirming,
}: AutoSortReviewProps) {
  const [filter, setFilter] = useState<Filter>('all');
  const [showAlbumModal, setShowAlbumModal] = useState(false);
  const [albumName, setAlbumName] = useState(() => `Our moments · ${suggestAlbumName(keepPhotos)}`);
  const nameEditedRef = useRef(false);

  useEffect(() => {
    suggestMilestoneAlbumName(keepPhotos).then((name) => {
      if (!nameEditedRef.current) setAlbumName(name);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const keptIds = useMemo(() => new Set(keepPhotos.map((p) => p.id)), [keepPhotos]);
  const total = keepPhotos.length + deletePhotos.length;

  const blurryCount = useMemo(() => deletePhotos.filter((d) => d.reason.includes('blurry') || d.reason.includes('blank')).length, [deletePhotos]);
  const duplicateCount = useMemo(() => deletePhotos.filter((d) => d.reason.includes('duplicate')).length, [deletePhotos]);
  const dayCount = useMemo(() => new Set(moments.map((m) => dayKey(m.timestamp))).size, [moments]);

  const dayGroups = useMemo(() => {
    const groups = new Map<string, { label: string; sortTs: number; moments: Moment[] }>();
    for (const moment of moments) {
      const key = dayKey(moment.timestamp);
      let group = groups.get(key);
      if (!group) {
        group = { label: dayFormat.format(new Date(moment.timestamp)), sortTs: moment.timestamp, moments: [] };
        groups.set(key, group);
      }
      group.moments.push(moment);
    }
    return Array.from(groups.values()).sort((a, b) => a.sortTs - b.sortTs);
  }, [moments]);

  return (
    <div className="flex flex-col flex-1">
      <div className="flex items-start justify-between gap-4 mb-1">
        <div>
          <p className="text-[#BB5133] text-xs font-semibold tracking-[0.2em] uppercase mb-3">Sorted</p>
          <h1 className="font-serif text-4xl sm:text-5xl leading-none">
            Keeping <span className="text-[#BB5133] italic">{keepPhotos.length}</span> of {total}
          </h1>
        </div>
        <button
          onClick={onCancel}
          className="flex items-center gap-1.5 text-sm text-[#8A8177] hover:text-[#231F1B] transition-colors whitespace-nowrap pt-2"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 12a9 9 0 1 0 2.6-6.3" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M3 4v5h5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Start over
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-[15px] mt-5">
        <span>
          <span className="font-semibold">{blurryCount}</span> <span className="text-[#8A8177]">blurry</span>
        </span>
        <span>
          <span className="font-semibold">{duplicateCount}</span> <span className="text-[#8A8177]">{duplicateCount === 1 ? 'duplicate or near-duplicate' : 'duplicates & near-duplicates'}</span>
        </span>
        <span>
          <span className="font-semibold">{dayCount}</span> <span className="text-[#8A8177]">{dayCount === 1 ? 'day' : 'days'}</span>
        </span>
      </div>
      <p className="text-[#8A8177] text-sm mt-3">Tap any photo to keep it or set it aside.</p>

      <div className="flex flex-wrap items-center gap-3 mt-6">
        <div className="inline-flex items-center bg-[#EFE9DD] rounded-full p-1 text-sm">
          {SENSITIVITY_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => onSensitivityChange(opt.value)}
              disabled={resorting}
              className={`px-3.5 py-1.5 rounded-full font-medium transition-colors disabled:opacity-60 ${
                sensitivity === opt.value ? 'bg-white text-[#231F1B] shadow-sm' : 'text-[#8A8177] hover:text-[#231F1B]'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <div className="inline-flex items-center bg-[#EFE9DD] rounded-full p-1 text-sm">
          {(
            [
              ['all', 'All'],
              ['kept', 'Kept'],
              ['setAside', 'Set aside'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setFilter(value)}
              className={`px-3.5 py-1.5 rounded-full font-medium transition-colors ${
                filter === value ? 'bg-white text-[#231F1B] shadow-sm' : 'text-[#8A8177] hover:text-[#231F1B]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          onClick={() => setShowAlbumModal(true)}
          disabled={confirming || keepPhotos.length === 0}
          className="ml-auto bg-[#231F1B] hover:bg-black text-white text-sm font-medium px-6 py-2.5 rounded-full transition-colors disabled:opacity-40"
        >
          Create album · {keepPhotos.length}
        </button>
      </div>
      <p className="text-[#A69C8E] text-xs mt-2">One photo per moment{resorting ? ' — re-sorting…' : ''}</p>

      <div className="mt-8 flex flex-col gap-10">
        {dayGroups.map((day) => {
          const dayKept = day.moments.reduce((n, m) => n + m.photos.filter((p) => keptIds.has(p.photo.id)).length, 0);
          const dayTotal = day.moments.reduce((n, m) => n + m.photos.length, 0);
          return (
            <div key={day.label}>
              <div className="flex items-baseline justify-between gap-4 border-b border-black/5 pb-3 mb-6">
                <h2 className="font-serif text-2xl sm:text-3xl">{day.label}</h2>
                <p className="text-sm text-[#8A8177] whitespace-nowrap">
                  {dayKept} of {dayTotal} kept · {day.moments.length} moment{day.moments.length === 1 ? '' : 's'}
                </p>
              </div>
              <div className="flex flex-col gap-8">
                {day.moments.map((moment) => {
                  const visiblePhotos = moment.photos.filter((p) => {
                    const kept = keptIds.has(p.photo.id);
                    if (filter === 'kept') return kept;
                    if (filter === 'setAside') return !kept;
                    return true;
                  });
                  if (visiblePhotos.length === 0) return null;
                  return (
                    <div key={moment.id}>
                      <p className="text-xs font-semibold tracking-[0.15em] uppercase text-[#A69C8E] mb-3">
                        {timeFormat.format(new Date(moment.timestamp))} · {moment.photos.length} shot{moment.photos.length === 1 ? '' : 's'}
                      </p>
                      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
                        {visiblePhotos.map((p) => (
                          <MomentThumb
                            key={p.photo.id}
                            photo={p.photo}
                            kept={keptIds.has(p.photo.id)}
                            similar={p.similar}
                            reason={p.reason}
                            onToggle={() => onMove(p.photo.id, keptIds.has(p.photo.id) ? 'delete' : 'keep')}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {showAlbumModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" onClick={() => setShowAlbumModal(false)}>
          <div className="bg-[#FBF8F2] rounded-2xl p-8 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-1">
              <h2 className="font-serif text-3xl">Name your album</h2>
              <button onClick={() => setShowAlbumModal(false)} className="text-[#8A8177] hover:text-[#231F1B] transition-colors">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
            <p className="text-[#8A8177] text-sm mb-6">{keepPhotos.length} photos will be saved to this device.</p>
            <input
              type="text"
              value={albumName}
              onChange={(e) => {
                nameEditedRef.current = true;
                setAlbumName(e.target.value);
              }}
              className="w-full font-serif text-2xl bg-transparent border-b-2 border-[#BB5133] focus:outline-none pb-2 mb-6"
              autoFocus
            />
            <button
              onClick={() => {
                setShowAlbumModal(false);
                onConfirm({ type: 'single', name: albumName.trim() });
              }}
              disabled={confirming}
              className="w-full bg-[#231F1B] hover:bg-black text-white font-medium py-3.5 rounded-full transition-colors disabled:opacity-50"
            >
              Create album
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
