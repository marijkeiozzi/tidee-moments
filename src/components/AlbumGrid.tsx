import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Album, Photo } from '../db/indexedDb';
import { assignPhotoToAlbum, createAlbum, getAllAlbums, setPhotoNote } from '../db/indexedDb';
import { buildShareablePage } from '../lib/sharePage';
import { downloadBlob, exportAlbumZip, safeFileName, sortChronologically } from '../lib/exportAlbum';
import VirtualPhotoGrid from './VirtualPhotoGrid';

// How "file into an album" behaves depends on what this page is showing:
//  - 'album': a real album. Filing photos elsewhere moves them out, so they leave this page,
//    and this album is not offered as a destination.
//  - 'unfiled': kept photos that aren't in any album. Filing them moves them out of here too.
//  - 'collection': a view computed from the photos themselves (a First year month, a
//    person). Photos stay on this page after being filed, since they still belong to it.
export type AlbumGridMode = 'album' | 'unfiled' | 'collection';

interface AlbumGridProps {
  title: string;
  fetchPhotos: () => Promise<Photo[]>;
  onBack: () => void;
  backLabel?: string;
  emptyMessage?: string;
  mode: AlbumGridMode;
  currentAlbumId?: string;
  // When given, the title becomes editable (album or person name).
  onRename?: (name: string) => Promise<void> | void;
  renameHint?: string;
}

export default function AlbumGrid({
  title,
  fetchPhotos,
  onBack,
  backLabel = 'Back',
  emptyMessage,
  mode,
  currentAlbumId,
  onRename,
  renameHint,
}: AlbumGridProps) {
  const [photos, setPhotos] = useState<Photo[] | null>(null);
  const [name, setName] = useState(title);
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [albums, setAlbums] = useState<Album[]>([]);
  const [targetAlbumId, setTargetAlbumId] = useState('');
  const [creatingAlbum, setCreatingAlbum] = useState(false);
  const [newAlbumName, setNewAlbumName] = useState('');
  const [moving, setMoving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [exportNote, setExportNote] = useState<string | null>(null);

  useEffect(() => setName(title), [title]);

  useEffect(() => {
    fetchPhotos().then((list) => setPhotos(sortChronologically(list)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const targets = useMemo(() => albums.filter((a) => a.id !== currentAlbumId), [albums, currentAlbumId]);

  useEffect(() => {
    getAllAlbums().then(setAlbums);
  }, []);

  useEffect(() => {
    if (!targets.some((a) => a.id === targetAlbumId)) setTargetAlbumId(targets[0]?.id ?? '');
  }, [targets, targetAlbumId]);

  const toggleSelected = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const isSelected = useCallback((id: string) => selectedIds.has(id), [selectedIds]);

  function showToast(message: string) {
    setToast(message);
    setTimeout(() => setToast((prev) => (prev === message ? null : prev)), 2500);
  }

  async function commitRename() {
    const trimmed = name.trim();
    if (!onRename || !trimmed || trimmed === title) {
      setName(title);
      return;
    }
    await onRename(trimmed);
  }

  // Captions become the exported file names, so keep the in-memory copy current too — otherwise
  // a caption typed here wouldn't show up in an export until the page was reopened.
  async function handleNoteChange(id: string, note: string) {
    await setPhotoNote(id, note);
    setPhotos((prev) => (prev ?? []).map((p) => (p.id === id ? { ...p, note } : p)));
  }

  async function handleConfirmCreateAlbum() {
    const trimmed = newAlbumName.trim();
    if (!trimmed) return;
    const album = await createAlbum(trimmed);
    setAlbums((prev) => (prev.some((a) => a.id === album.id) ? prev : [...prev, album]));
    setTargetAlbumId(album.id);
    setNewAlbumName('');
    setCreatingAlbum(false);
  }

  async function handleFileSelected() {
    if (!targetAlbumId || selectedIds.size === 0) return;
    setMoving(true);
    try {
      const ids = Array.from(selectedIds);
      await Promise.all(ids.map((id) => assignPhotoToAlbum(id, targetAlbumId)));
      const albumName = albums.find((a) => a.id === targetAlbumId)?.name ?? 'the album';
      const verb = mode === 'collection' ? 'Added' : 'Moved';
      showToast(`${verb} ${ids.length} photo${ids.length === 1 ? '' : 's'} to "${albumName}" 📁`);
      if (mode !== 'collection') setPhotos((prev) => (prev ?? []).filter((p) => !selectedIds.has(p.id)));
      else setPhotos((prev) => (prev ?? []).map((p) => (selectedIds.has(p.id) ? { ...p, albumId: targetAlbumId, status: 'kept' } : p)));
      setSelectedIds(new Set());
    } finally {
      setMoving(false);
    }
  }

  async function handleExport() {
    if (!photos?.length) return;
    setBusy(true);
    setExportNote(null);
    try {
      const result = await exportAlbumZip(name, photos, ({ done, total, part, parts }) =>
        setExportStatus(parts > 1 ? `Zipping part ${part} of ${parts} · ${done}/${total}…` : `Zipping ${done}/${total}…`),
      );
      if (result.included === 0) {
        setExportNote("Couldn't export any photos — they may be corrupted in storage. Try reloading the page.");
      } else if (result.failed > 0) {
        setExportNote(`Exported ${result.included} of ${photos.length} photos — ${result.failed} couldn't be read.`);
      } else if (result.parts > 1) {
        setExportNote(
          `Saved as ${result.parts} zip files so each stays a manageable size. If your browser asks, allow this page to download multiple files.`,
        );
      }
    } catch (err) {
      setExportNote(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
      setExportStatus(null);
    }
  }

  async function handleSharePage() {
    if (!photos?.length) return;
    setBusy(true);
    setExportNote(null);
    try {
      const { blob, included, failed } = await buildShareablePage(name, photos, (done, total) =>
        setExportStatus(`Preparing ${done}/${total}…`),
      );
      if (included === 0) {
        setExportNote("Couldn't build a page — no photos could be read. Try reloading the page.");
        return;
      }
      downloadBlob(blob, `${safeFileName(name)}.html`);
      if (failed > 0) setExportNote(`Included ${included} of ${photos.length} photos — ${failed} couldn't be read.`);
    } catch (err) {
      setExportNote(`Couldn't build the page: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
      setExportStatus(null);
    }
  }

  const count = photos?.length ?? 0;
  const allSelected = count > 0 && selectedIds.size === count;
  const fileVerb = mode === 'collection' ? 'Add to album' : 'Move to album';

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4 mb-2">
        <div className="min-w-0">
          <button onClick={onBack} className="text-sm text-[#8A8177] hover:text-[#231F1B] transition-colors mb-2">
            ← {backLabel}
          </button>
          {onRename ? (
            <input
              aria-label="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                if (e.key === 'Escape') {
                  setName(title);
                  (e.target as HTMLInputElement).blur();
                }
              }}
              title={renameHint ?? 'Tap to rename'}
              className="block w-full font-serif text-3xl sm:text-4xl bg-transparent border-b border-transparent hover:border-black/15 focus:border-[#BB5133]/50 outline-none"
            />
          ) : (
            <h2 className="font-serif text-3xl sm:text-4xl">{title}</h2>
          )}
          <p className="text-sm text-[#8A8177] mt-1">
            {photos === null ? 'Loading…' : `${count} photo${count === 1 ? '' : 's'}`}
            {onRename && <span className="text-[#A69C8E]"> · {renameHint ?? 'tap the name to rename'}</span>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleSharePage}
            disabled={busy || count === 0}
            className="inline-flex items-center gap-2 text-sm font-medium bg-white hover:bg-[#EFE9DD] text-[#231F1B] border border-black/10 px-4 py-2 rounded-full transition-colors disabled:opacity-40"
          >
            Share as a page
          </button>
          <button
            onClick={handleExport}
            disabled={busy || count === 0}
            className="text-sm font-medium bg-[#231F1B] hover:bg-black text-white px-4 py-2 rounded-full transition-colors disabled:opacity-40"
          >
            Export zip
          </button>
        </div>
      </div>

      <p className="text-xs text-[#A69C8E] mb-4">
        "Export zip" saves the original, full-quality files, numbered in the order they were taken. "Share as a page"
        makes one file you can text, email or AirDrop to family, with photos sized for screens.
      </p>

      {exportStatus && (
        <p className="text-xs text-[#5B5349] bg-[#EFE9DD] rounded-xl px-3 py-2 mb-4" role="status">
          {exportStatus}
        </p>
      )}

      {exportNote && (
        <p className="text-xs text-[#9A3F26] bg-[#F6DFCF]/60 border border-[#BB5133]/20 rounded-xl px-3 py-2 mb-4">
          {exportNote}
        </p>
      )}

      {count > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-4 bg-white border border-black/5 rounded-2xl p-3">
          {creatingAlbum ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleConfirmCreateAlbum();
              }}
              className="flex flex-wrap items-center gap-2"
            >
              <input
                type="text"
                autoFocus
                value={newAlbumName}
                onChange={(e) => setNewAlbumName(e.target.value)}
                placeholder="New album name…"
                className="text-sm border border-black/10 bg-white rounded-full px-3 py-1.5 text-[#231F1B] focus:outline-none focus:border-[#BB5133]/50"
              />
              <button
                type="submit"
                disabled={!newAlbumName.trim()}
                className="text-sm bg-[#231F1B] hover:bg-black text-white font-medium px-3 py-1.5 rounded-full disabled:opacity-40"
              >
                Create
              </button>
              <button type="button" onClick={() => setCreatingAlbum(false)} className="text-sm text-[#8A8177] hover:underline">
                Cancel
              </button>
            </form>
          ) : (
            <>
              <button
                onClick={() => setSelectedIds(allSelected ? new Set() : new Set((photos ?? []).map((p) => p.id)))}
                className="text-sm font-medium text-[#231F1B] bg-[#EFE9DD] hover:bg-[#E6DECF] px-3 py-1.5 rounded-full transition-colors"
              >
                {allSelected ? 'Select none' : `Select all ${count}`}
              </button>
              {selectedIds.size === 0 ? (
                <span className="text-sm text-[#A69C8E]">or tap photos below to choose some.</span>
              ) : (
                <>
                  <span className="text-sm font-semibold text-[#231F1B]">{selectedIds.size} selected</span>
                  {targets.length > 0 && (
                    <select
                      aria-label="Album"
                      value={targetAlbumId}
                      onChange={(e) => setTargetAlbumId(e.target.value)}
                      className="text-sm border border-black/10 bg-white rounded-full px-3 py-1.5 text-[#231F1B]"
                    >
                      {targets.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                  )}
                  <button onClick={() => setCreatingAlbum(true)} className="text-sm text-[#BB5133] hover:underline">
                    + New album
                  </button>
                  <button
                    onClick={handleFileSelected}
                    disabled={!targetAlbumId || moving}
                    className="text-sm bg-[#231F1B] hover:bg-black text-white font-medium px-3 py-1.5 rounded-full transition-colors disabled:opacity-40 sm:ml-auto"
                  >
                    {moving ? 'Saving…' : fileVerb}
                  </button>
                </>
              )}
            </>
          )}
          {mode === 'collection' && selectedIds.size > 0 && !creatingAlbum && (
            <p className="basis-full text-xs text-[#A69C8E]">
              A photo lives in one album at a time — adding it here moves it out of any album it's already in.
            </p>
          )}
        </div>
      )}

      {photos === null ? null : count === 0 ? (
        <p className="text-[#A69C8E]">{emptyMessage ?? 'No photos here yet 🌱'}</p>
      ) : (
        <VirtualPhotoGrid photos={photos} isSelected={isSelected} onToggle={toggleSelected} onNoteChange={handleNoteChange} />
      )}

      {toast && (
        <div
          role="status"
          className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-[#231F1B] text-white text-sm font-medium px-4 py-2 rounded-full shadow-lg z-50"
        >
          {toast}
        </div>
      )}
    </div>
  );
}
