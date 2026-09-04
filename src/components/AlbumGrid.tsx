import { useCallback, useEffect, useState } from 'react';
import JSZip from 'jszip';
import type { Album, Photo } from '../db/indexedDb';
import { assignPhotoToAlbum, createAlbum, getAllAlbums, setPhotoNote } from '../db/indexedDb';
import { buildShareablePage } from '../lib/sharePage';
import { photoFilename } from '../lib/filename';
import VirtualPhotoGrid from './VirtualPhotoGrid';

interface AlbumGridProps {
  title: string;
  fetchPhotos: () => Promise<Photo[]>;
  onBack: () => void;
  emptyMessage?: string;
}

export default function AlbumGrid({ title, fetchPhotos, onBack, emptyMessage }: AlbumGridProps) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [exporting, setExporting] = useState(false);
  const [buildingPage, setBuildingPage] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [albums, setAlbums] = useState<Album[]>([]);
  const [targetAlbumId, setTargetAlbumId] = useState('');
  const [creatingAlbum, setCreatingAlbum] = useState(false);
  const [newAlbumName, setNewAlbumName] = useState('');
  const [moving, setMoving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [exportNote, setExportNote] = useState<string | null>(null);

  useEffect(() => {
    fetchPhotos().then(setPhotos);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    getAllAlbums().then((list) => {
      setAlbums(list);
      setTargetAlbumId((prev) => prev || list[0]?.id || '');
    });
  }, []);

  const toggleSelected = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const isSelected = useCallback((id: string) => selectedIds.has(id), [selectedIds]);

  async function handleConfirmCreateAlbum() {
    const trimmed = newAlbumName.trim();
    if (!trimmed) return;
    const album = await createAlbum(trimmed);
    setAlbums((prev) => [...prev, album]);
    setTargetAlbumId(album.id);
    setNewAlbumName('');
    setCreatingAlbum(false);
  }

  async function handleMoveSelected() {
    if (!targetAlbumId || selectedIds.size === 0) return;
    setMoving(true);
    try {
      const ids = Array.from(selectedIds);
      await Promise.all(ids.map((id) => assignPhotoToAlbum(id, targetAlbumId)));
      const albumName = albums.find((a) => a.id === targetAlbumId)?.name ?? 'the album';
      setToast(`Moved ${ids.length} photo${ids.length === 1 ? '' : 's'} to "${albumName}" 📁`);
      setTimeout(() => setToast(null), 2500);
      setPhotos((prev) => prev.filter((p) => !selectedIds.has(p.id)));
      setSelectedIds(new Set());
    } finally {
      setMoving(false);
    }
  }

  async function handleExport() {
    setExporting(true);
    setExportNote(null);
    try {
      const zip = new JSZip();
      let failed = 0;
      const usedNames = new Set<string>();
      for (let i = 0; i < photos.length; i++) {
        const photo = photos[i];
        try {
          const bytes = await photo.blob.arrayBuffer();
          const ext = photo.blob.type.split('/')[1] || 'jpg';
          let name = photoFilename(photo.note, title, i + 1, ext);
          // Two photos captioned the same thing would otherwise silently overwrite each other
          // in the zip — keep the caption but disambiguate with a counter.
          let suffix = 2;
          while (usedNames.has(name)) {
            name = photoFilename(`${photo.note} (${suffix})`, title, i + 1, ext);
            suffix++;
          }
          usedNames.add(name);
          zip.file(name, bytes);
        } catch {
          failed++;
        }
      }

      const included = photos.length - failed;
      if (included === 0) {
        setExportNote("Couldn't export any photos — they may be corrupted in storage. Try reloading the page.");
        return;
      }

      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${title}.zip`;
      a.click();
      URL.revokeObjectURL(url);

      setExportNote(
        failed > 0 ? `Exported ${included} of ${photos.length} photos — ${failed} couldn't be read.` : null,
      );
    } catch (err) {
      setExportNote(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setExporting(false);
    }
  }

  async function handleSharePage() {
    setBuildingPage(true);
    setExportNote(null);
    try {
      const { blob, included, failed } = await buildShareablePage(title, photos);
      if (included === 0) {
        setExportNote("Couldn't build a page — no photos could be read. Try reloading the page.");
        return;
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${title}.html`;
      a.click();
      URL.revokeObjectURL(url);

      setExportNote(failed > 0 ? `Included ${included} of ${photos.length} photos — ${failed} couldn't be read.` : null);
    } catch (err) {
      setExportNote(`Couldn't build the page: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBuildingPage(false);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <button onClick={onBack} className="text-rose-400 font-medium hover:underline">
          ← Back
        </button>
        <h2 className="text-lg font-bold text-stone-100">📁 {title}</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={handleSharePage}
            disabled={buildingPage || photos.length === 0}
            className="text-sm bg-rose-400 hover:bg-rose-500 text-white font-semibold px-3 py-1.5 rounded-full shadow-sm hover:shadow-md transition-all disabled:opacity-40 disabled:hover:shadow-sm"
          >
            {buildingPage ? 'Building…' : '📤 Share as a page'}
          </button>
          <button
            onClick={handleExport}
            disabled={exporting || photos.length === 0}
            className="text-sm bg-stone-800 hover:bg-stone-900 text-white font-semibold px-3 py-1.5 rounded-full shadow-sm hover:shadow-md transition-all disabled:opacity-40 disabled:hover:shadow-sm"
          >
            {exporting ? 'Zipping…' : '📦 Export zip'}
          </button>
        </div>
      </div>

      <p className="text-xs text-stone-400 mb-4">
        Tap photos below to select them, then file a batch into an album in one go. "Share as a page" makes
        one file you can text/email/AirDrop — "Export zip" gives you the original files.
      </p>

      {exportNote && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 mb-4">
          ⚠️ {exportNote}
        </p>
      )}

      {photos.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-4 bg-white border border-stone-200 rounded-2xl p-3">
          {selectedIds.size === 0 ? (
            <span className="text-sm text-stone-400">No photos selected yet — tap any photo below.</span>
          ) : creatingAlbum ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleConfirmCreateAlbum();
              }}
              className="flex items-center gap-2"
            >
              <input
                type="text"
                autoFocus
                value={newAlbumName}
                onChange={(e) => setNewAlbumName(e.target.value)}
                placeholder="Album name…"
                className="text-sm border border-stone-200 bg-white rounded-full px-3 py-1.5 text-stone-700 focus:outline-none focus:border-rose-300"
              />
              <button
                type="submit"
                disabled={!newAlbumName.trim()}
                className="text-sm bg-stone-800 hover:bg-stone-900 text-white font-semibold px-3 py-1.5 rounded-full disabled:opacity-40"
              >
                Create
              </button>
              <button
                type="button"
                onClick={() => setCreatingAlbum(false)}
                className="text-sm text-stone-500 hover:underline"
              >
                Cancel
              </button>
            </form>
          ) : (
            <>
              <span className="text-sm font-semibold text-stone-700">{selectedIds.size} selected</span>
              {albums.length > 0 && (
                <select
                  value={targetAlbumId}
                  onChange={(e) => setTargetAlbumId(e.target.value)}
                  className="text-sm border border-stone-200 bg-white rounded-lg px-2 py-1.5 text-stone-700"
                >
                  {albums.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              )}
              <button onClick={() => setCreatingAlbum(true)} className="text-sm text-rose-400 hover:underline">
                + New album
              </button>
              <button
                onClick={handleMoveSelected}
                disabled={!targetAlbumId || moving}
                className="text-sm bg-rose-400 hover:bg-rose-500 text-white font-semibold px-3 py-1.5 rounded-full shadow-sm hover:shadow-md transition-all disabled:opacity-40"
              >
                {moving ? 'Moving…' : '📁 Move selected'}
              </button>
              <button
                onClick={() => setSelectedIds(new Set())}
                className="text-sm text-stone-400 hover:underline ml-auto"
              >
                Clear selection
              </button>
            </>
          )}
        </div>
      )}

      {photos.length === 0 ? (
        <p className="text-stone-400">{emptyMessage ?? 'No photos here yet 🌱'}</p>
      ) : (
        <VirtualPhotoGrid photos={photos} isSelected={isSelected} onToggle={toggleSelected} onNoteChange={setPhotoNote} />
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-stone-800 text-white text-sm font-medium px-4 py-2 rounded-full shadow-lg z-50">
          {toast}
        </div>
      )}
    </div>
  );
}
