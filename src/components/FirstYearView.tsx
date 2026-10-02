import { useEffect, useMemo, useState } from 'react';
import type { Photo } from '../db/indexedDb';
import { getPhotosByStatus } from '../db/indexedDb';
import { getDisplayableBlob } from '../hooks/usePhotoUrl';
import { buildFirstYear, parseBirthDate, THIN_MONTH_MIN, type FirstYearSlot, type SlotStatus } from '../lib/firstYear';
import AlbumGrid from './AlbumGrid';

const STORAGE_KEY = 'tidee.firstYear';

interface ChildInfo {
  name: string;
  birthDate: string; // YYYY-MM-DD
}

// Remembered per browser so the parent only enters it once. Storage can be unavailable
// (private mode, blocked site data) — the view still works, it just asks again next time.
function loadChild(): ChildInfo | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ChildInfo;
    return parseBirthDate(parsed.birthDate) === null ? null : parsed;
  } catch {
    return null;
  }
}

function saveChild(info: ChildInfo) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(info));
  } catch {
    // Not fatal — see loadChild.
  }
}

const dateRange = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

const STATUS_BADGE: Record<SlotStatus, { text: string; className: string }> = {
  good: { text: 'Covered', className: 'bg-green-50 text-green-800' },
  thin: { text: 'A bit thin', className: 'bg-amber-50 text-amber-800' },
  missing: { text: 'Missing', className: 'bg-red-50 text-red-700' },
  'in-progress': { text: 'This month', className: 'bg-[#EFE9DD] text-[#7A7266]' },
  upcoming: { text: 'Still to come', className: 'bg-[#EFE9DD] text-[#A69C8E]' },
};

function MonthCard({ slot, photos, onOpen }: { slot: FirstYearSlot; photos: Photo[]; onOpen: () => void }) {
  const [coverUrl, setCoverUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    // Kept photos have already been through blur/closed-eyes cleanup, so the month's first
    // photo makes a fine cover. Re-scoring faces here (like AlbumCard does) for 13 cards at
    // once freezes the tab on devices without GPU acceleration.
    const cover = photos[0];
    if (!cover) {
      setCoverUrl(null);
      return;
    }
    getDisplayableBlob(cover).then((blob) => {
      if (cancelled) return;
      objectUrl = URL.createObjectURL(blob);
      setCoverUrl(objectUrl);
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [photos]);

  const badge = STATUS_BADGE[slot.status];
  const count = slot.photoIds.length;
  const disabled = count === 0;

  return (
    <button
      onClick={onOpen}
      disabled={disabled}
      className={`text-left bg-white border rounded-2xl overflow-hidden transition-all ${
        slot.status === 'missing' ? 'border-red-200' : 'border-black/5'
      } ${disabled ? 'cursor-default' : 'hover:border-[#BB5133]/30 hover:shadow-md hover:-translate-y-0.5'}`}
    >
      <div className="aspect-square bg-[#EFE9DD] flex items-center justify-center">
        {coverUrl ? (
          <img src={coverUrl} alt="" className="w-full h-full object-cover" />
        ) : (
          <span className="text-3xl opacity-40">{slot.key === 'birthday' ? '🎂' : '🍼'}</span>
        )}
      </div>
      <div className="p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="font-semibold text-[#231F1B] text-sm truncate">{slot.label}</p>
          <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${badge.className}`}>
            {badge.text}
          </span>
        </div>
        <p className="text-xs text-[#A69C8E]">
          {dateRange.format(slot.start)} – {dateRange.format(slot.end - 1)}
        </p>
        <p className="text-xs text-[#7A7266] mt-1">
          {count} photo{count === 1 ? '' : 's'}
          {slot.unsortedCount > 0 && <span className="text-[#BB5133]"> · {slot.unsortedCount} still to sort</span>}
        </p>
      </div>
    </button>
  );
}

interface FirstYearViewProps {
  onBack: () => void;
  onGoToSort: () => void;
}

export default function FirstYearView({ onBack, onGoToSort }: FirstYearViewProps) {
  const [child, setChild] = useState<ChildInfo | null>(() => loadChild());
  const [editing, setEditing] = useState(child === null);
  const [draftName, setDraftName] = useState(child?.name ?? '');
  const [draftBirth, setDraftBirth] = useState(child?.birthDate ?? '');
  const [kept, setKept] = useState<Photo[] | null>(null);
  const [unsorted, setUnsorted] = useState<Photo[]>([]);
  const [openSlot, setOpenSlot] = useState<FirstYearSlot | 'all' | null>(null);

  useEffect(() => {
    Promise.all([getPhotosByStatus('kept'), getPhotosByStatus('inbox')]).then(([k, u]) => {
      setKept(k);
      setUnsorted(u.filter((p) => !p.isScreenshot));
    });
  }, [openSlot]);

  const birth = child ? parseBirthDate(child.birthDate) : null;
  const slots = useMemo(
    () => (birth !== null && kept ? buildFirstYear(birth, kept, unsorted) : []),
    [birth, kept, unsorted],
  );
  const photoById = useMemo(() => new Map((kept ?? []).map((p) => [p.id, p])), [kept]);
  const slotPhotos = useMemo(
    () => new Map(slots.map((s) => [s.key, s.photoIds.map((id) => photoById.get(id)!)])),
    [slots, photoById],
  );

  const missing = slots.filter((s) => s.status === 'missing');
  const thin = slots.filter((s) => s.status === 'thin');
  const yearPhotoCount = slots.reduce((n, s) => n + s.photoIds.length, 0);
  const gapUnsorted = [...missing, ...thin].reduce((n, s) => n + s.unsortedCount, 0);
  const title = child?.name.trim() ? `${child.name.trim()}'s first year` : 'Baby’s first year';

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (parseBirthDate(draftBirth) === null) return;
    const info = { name: draftName.trim(), birthDate: draftBirth };
    saveChild(info);
    setChild(info);
    setEditing(false);
  }

  if (openSlot) {
    const photos =
      openSlot === 'all' ? slots.flatMap((s) => slotPhotos.get(s.key) ?? []) : (slotPhotos.get(openSlot.key) ?? []);
    return (
      <AlbumGrid
        title={openSlot === 'all' ? title : `${title} · ${openSlot.label}`}
        fetchPhotos={async () => photos}
        onBack={() => setOpenSlot(null)}
      />
    );
  }

  return (
    <div>
      <button onClick={onBack} className="text-sm text-[#8A8177] hover:text-[#231F1B] transition-colors mb-2">
        ← Back
      </button>
      <h2 className="font-serif text-3xl sm:text-4xl mb-2">{title}</h2>
      <p className="text-[#7A7266] text-sm mb-6 max-w-2xl">
        Your kept photos, laid out month by month from the day they were born — so you can see which months are
        covered and which still need photos before making the album.
      </p>

      {editing ? (
        <form onSubmit={handleSave} className="flex flex-wrap items-end gap-3 bg-white border border-black/5 rounded-2xl p-4 mb-6">
          <label className="flex flex-col gap-1 text-xs text-[#7A7266]">
            Child’s name (optional)
            <input
              type="text"
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              placeholder="e.g. Mila"
              className="text-sm border border-black/10 bg-white rounded-full px-4 py-2 text-[#231F1B] focus:outline-none focus:border-[#BB5133]/50"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-[#7A7266]">
            Birth date
            <input
              type="date"
              required
              value={draftBirth}
              onChange={(e) => setDraftBirth(e.target.value)}
              className="text-sm border border-black/10 bg-white rounded-full px-4 py-2 text-[#231F1B] focus:outline-none focus:border-[#BB5133]/50"
            />
          </label>
          <button
            type="submit"
            disabled={parseBirthDate(draftBirth) === null}
            className="text-sm bg-[#231F1B] hover:bg-black text-white font-medium px-5 py-2 rounded-full transition-colors disabled:opacity-40"
          >
            Show the first year
          </button>
          {child && (
            <button type="button" onClick={() => setEditing(false)} className="text-sm text-[#A69C8E] hover:underline px-2 py-2">
              Cancel
            </button>
          )}
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-3 mb-6 text-sm">
          <span className="text-[#7A7266]">
            Born {birth !== null && dateRange.format(birth)} · {yearPhotoCount} photo{yearPhotoCount === 1 ? '' : 's'}{' '}
            in the first year
          </span>
          <button onClick={() => setEditing(true)} className="text-[#BB5133] hover:underline">
            Change
          </button>
          <button
            onClick={() => setOpenSlot('all')}
            disabled={yearPhotoCount === 0}
            className="ml-auto text-sm font-medium bg-[#231F1B] hover:bg-black text-white px-4 py-2 rounded-full transition-colors disabled:opacity-40"
          >
            Open whole year
          </button>
        </div>
      )}

      {!editing && kept === null && <p className="text-[#A69C8E]">Loading your photos…</p>}

      {!editing && kept !== null && (
        <>
          {missing.length > 0 || thin.length > 0 ? (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 mb-6 text-sm text-amber-900">
              {missing.length > 0 && (
                <p>
                  <span className="font-semibold">No photos yet for:</span> {missing.map((s) => s.label).join(', ')}.
                </p>
              )}
              {thin.length > 0 && (
                <p className={missing.length > 0 ? 'mt-1' : ''}>
                  <span className="font-semibold">Fewer than {THIN_MONTH_MIN} photos:</span>{' '}
                  {thin.map((s) => `${s.label} (${s.photoIds.length})`).join(', ')}.
                </p>
              )}
              <p className="mt-2 text-amber-800">
                {gapUnsorted > 0 ? (
                  <>
                    You have {gapUnsorted} unsorted photo{gapUnsorted === 1 ? '' : 's'} from these months.{' '}
                    <button onClick={onGoToSort} className="font-semibold underline">
                      Sort them now →
                    </button>
                  </>
                ) : (
                  'Check your partner’s phone, grandparents, shared albums and messaging apps for photos from these months.'
                )}
              </p>
            </div>
          ) : (
            yearPhotoCount > 0 && (
              <p className="bg-green-50 border border-green-200 rounded-2xl px-4 py-3 mb-6 text-sm text-green-900">
                Every month so far has at least {THIN_MONTH_MIN} photos 🌱
              </p>
            )
          )}

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {slots.map((slot) => (
              <MonthCard
                key={slot.key}
                slot={slot}
                photos={slotPhotos.get(slot.key) ?? []}
                onOpen={() => setOpenSlot(slot)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
