import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Photo } from '../db/indexedDb';
import { setPhotoNote } from '../db/indexedDb';
import { suggestAlbumName, groupPhotosByDay, groupPhotosByMonth } from '../lib/sessions';
import { suggestMilestoneAlbumName } from '../lib/milestones';
import type { DeleteCandidate } from '../lib/autoSort';
import VirtualPhotoGrid from './VirtualPhotoGrid';

const NEVER_SELECTED = () => false;

export type ConfirmAlbumChoice = { type: 'perDay' } | { type: 'perMonth' } | { type: 'single'; name: string };
type GroupingMode = 'single' | 'perMonth' | 'perDay';

interface AutoSortReviewProps {
  keepPhotos: Photo[];
  deletePhotos: DeleteCandidate[];
  onMove: (photoId: string, to: 'keep' | 'delete') => void;
  onConfirm: (choice: ConfirmAlbumChoice) => void;
  onCancel: () => void;
  confirming: boolean;
}

export default function AutoSortReview({
  keepPhotos,
  deletePhotos,
  onMove,
  onConfirm,
  onCancel,
  confirming,
}: AutoSortReviewProps) {
  const [activeTab, setActiveTab] = useState<'keep' | 'delete'>('keep');
  const [albumName, setAlbumName] = useState(() => suggestAlbumName(keepPhotos));
  const nameEditedRef = useRef(false);
  const dayGroups = useMemo(() => groupPhotosByDay(keepPhotos), [keepPhotos]);
  const monthGroups = useMemo(() => groupPhotosByMonth(keepPhotos), [keepPhotos]);
  // Defaults to one combined album (matches suggestAlbumName's own date-range naming, e.g.
  // "Jan–Mar 2026" for a multi-month batch) — splitting is opt-in, not forced, since someone
  // sorting a season's backlog often wants exactly one album for the whole range, not one per
  // day or month.
  const [grouping, setGrouping] = useState<GroupingMode>('single');

  useEffect(() => {
    suggestMilestoneAlbumName(keepPhotos).then((name) => {
      if (!nameEditedRef.current) setAlbumName(name);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const deletePhotoObjs = useMemo(() => deletePhotos.map((d) => d.photo), [deletePhotos]);
  const captionsById = useMemo(() => {
    const map = new Map<string, { reason: string; evidence: string }>();
    for (const d of deletePhotos) map.set(d.photo.id, { reason: d.reason, evidence: d.evidence });
    return map;
  }, [deletePhotos]);

  const activePhotos = activeTab === 'keep' ? keepPhotos : deletePhotoObjs;
  const handleToggle = useCallback(
    (id: string) => onMove(id, activeTab === 'keep' ? 'delete' : 'keep'),
    [onMove, activeTab],
  );

  return (
    <div className="flex flex-col flex-1 gap-4">
      <div>
        <h2 className="text-lg font-bold text-stone-100 mb-1">
          ✨ Sorted {keepPhotos.length + deletePhotos.length} photos
        </h2>
        <p className="text-sm text-stone-400">
          {deletePhotos.length === 0
            ? "Good news — nothing cleared the bar for deletion, so every photo passed. You're all set to save them."
            : "Only flagged for a specific reason — a clear duplicate, a blank/black frame, a shot too blurry to make out, or a screenshot with nobody in it. See why under each photo in the Delete tab. Tap any photo to move it to the other pile before confirming."}
        </p>
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => setActiveTab('keep')}
          className={`flex-1 text-sm font-semibold px-4 py-2 rounded-full transition-all ${
            activeTab === 'keep' ? 'bg-green-600 text-white shadow-md' : 'bg-white border border-stone-200 text-stone-600'
          }`}
        >
          ✅ Keep ({keepPhotos.length})
        </button>
        <button
          onClick={() => setActiveTab('delete')}
          className={`flex-1 text-sm font-semibold px-4 py-2 rounded-full transition-all ${
            activeTab === 'delete' ? 'bg-red-600 text-white shadow-md' : 'bg-white border border-stone-200 text-stone-600'
          }`}
        >
          🗑️ Delete ({deletePhotos.length})
        </button>
      </div>

      {activePhotos.length === 0 ? (
        <p className="text-stone-400 text-sm">Nothing here.</p>
      ) : (
        <>
          <p
            className={`text-xs font-semibold rounded-lg px-3 py-2 ${
              activeTab === 'keep' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
            }`}
          >
            {activeTab === 'keep'
              ? `These ${activePhotos.length} will be saved when you confirm. Tap the 🗑️ on any photo to move it to the delete pile instead.`
              : `These ${activePhotos.length} will be deleted when you confirm. The ✅ isn't a "kept" badge — tap it to rescue that photo back to Keep.`}
          </p>
          <VirtualPhotoGrid
            photos={activePhotos}
            isSelected={NEVER_SELECTED}
            moveIcon={activeTab === 'keep' ? '🗑️' : '✅'}
            onToggle={handleToggle}
            onNoteChange={setPhotoNote}
            getCaption={activeTab === 'delete' ? (id) => captionsById.get(id) : undefined}
          />
        </>
      )}

      <div className="bg-white border border-stone-200 rounded-2xl p-3 flex flex-col gap-3">
        {(dayGroups.length > 1 || monthGroups.length > 1) && (
          <div className="flex flex-wrap items-center gap-1 text-sm text-stone-600 px-1">
            <span className="text-stone-400 mr-1">Albums:</span>
            <button
              onClick={() => setGrouping('single')}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                grouping === 'single' ? 'bg-rose-400 text-white' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
              }`}
            >
              One album for this whole batch
            </button>
            {monthGroups.length > 1 && (
              <button
                onClick={() => setGrouping('perMonth')}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  grouping === 'perMonth' ? 'bg-rose-400 text-white' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                }`}
              >
                One per month ({monthGroups.length})
              </button>
            )}
            {dayGroups.length > 1 && (
              <button
                onClick={() => setGrouping('perDay')}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  grouping === 'perDay' ? 'bg-rose-400 text-white' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                }`}
              >
                One per day ({dayGroups.length})
              </button>
            )}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {grouping === 'perDay' ? (
            <div className="flex-1 min-w-[220px] text-xs text-stone-400 px-1">
              Will create {dayGroups.length} albums: {dayGroups.map((g) => g.label).join(', ')}
            </div>
          ) : grouping === 'perMonth' ? (
            <div className="flex-1 min-w-[220px] text-xs text-stone-400 px-1">
              Will create {monthGroups.length} albums: {monthGroups.map((g) => g.label).join(', ')}
            </div>
          ) : (
            <div className="flex-1 min-w-[220px]">
              <input
                type="text"
                value={albumName}
                onChange={(e) => {
                  nameEditedRef.current = true;
                  setAlbumName(e.target.value);
                }}
                placeholder="Leave blank to skip creating an album"
                className="w-full text-sm border border-stone-200 bg-white rounded-full px-4 py-2 text-stone-700 focus:outline-none focus:border-rose-300"
              />
              <p className="text-xs text-stone-400 mt-1 px-1">
                Suggested from the photo dates — matches a past album on the same date each year, or flags an
                unusually big day. Edit it or clear it — e.g. "January – March 2026" for the whole range.
              </p>
            </div>
          )}
          <button onClick={onCancel} className="text-sm text-stone-500 hover:underline px-2">
            Cancel
          </button>
          <button
            onClick={() =>
              onConfirm(
                grouping === 'perDay'
                  ? { type: 'perDay' }
                  : grouping === 'perMonth'
                    ? { type: 'perMonth' }
                    : { type: 'single', name: albumName.trim() },
              )
            }
            disabled={confirming}
            className="text-sm bg-rose-400 hover:bg-rose-500 text-white font-semibold px-4 py-2 rounded-full shadow-sm hover:shadow-md transition-all disabled:opacity-50"
          >
            {confirming ? 'Applying…' : `✓ Confirm — keep ${keepPhotos.length}, delete ${deletePhotos.length}`}
          </button>
        </div>
      </div>
    </div>
  );
}
