import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import UploadZone from './components/UploadZone';
import SwipeDeck from './components/SwipeDeck';
import AlbumGrid from './components/AlbumGrid';
import AlbumCard from './components/AlbumCard';
import LandingPage from './components/LandingPage';
import PeopleTab from './components/PeopleTab';
import PersonGrid from './components/PersonGrid';
import AutoSortReview, { type ConfirmAlbumChoice } from './components/AutoSortReview';
import SavingScreen from './components/SavingScreen';
import FirstYearView from './components/FirstYearView';
import {
  addPhotos,
  assignPhotoToAlbum,
  createAlbum,
  deleteAlbum,
  getAllAlbums,
  getKeptPhotosWithoutAlbum,
  getLibraryFingerprints,
  getPhotosByAlbum,
  getPhotosByStatus,
  setPhotoNote,
  updatePhotoStatus,
  type Album,
  type NewPhotoEntry,
  type Person,
  type Photo,
} from './db/indexedDb';
import { groupIntoSessions } from './lib/sessions';
import { groupIntoBursts } from './lib/bursts';
import { runAutoSort, type AutoSortResult, type Sensitivity } from './lib/autoSort';

type Tab = 'sort' | 'albums' | 'people';

type View = 'landing' | 'app';

export default function App() {
  const [view, setView] = useState<View>('landing');
  const [tab, setTab] = useState<Tab>('sort');
  const [inbox, setInbox] = useState<Photo[]>([]);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [activeAlbumId, setActiveAlbumId] = useState<string | null>(null);
  const [openAlbum, setOpenAlbum] = useState<Album | null>(null);
  const [showAllKept, setShowAllKept] = useState(false);
  const [showFirstYear, setShowFirstYear] = useState(false);
  const [keptWithoutAlbumCount, setKeptWithoutAlbumCount] = useState(0);
  const [creatingAlbum, setCreatingAlbum] = useState(false);
  const [newAlbumName, setNewAlbumName] = useState('');
  const [openPerson, setOpenPerson] = useState<Person | null>(null);
  const [activeSelection, setActiveSelection] = useState<'all' | string | null>(null);
  const [albumToast, setAlbumToast] = useState<string | null>(null);
  const [autoSorting, setAutoSorting] = useState(false);
  const [autoSortProgress, setAutoSortProgress] = useState<{ done: number; total: number } | null>(null);
  const [autoSortResult, setAutoSortResult] = useState<AutoSortResult | null>(null);
  const [confirmingAutoSort, setConfirmingAutoSort] = useState(false);
  const [sensitivity, setSensitivity] = useState<Sensitivity>('balanced');
  const [resorting, setResorting] = useState(false);
  const [savingProgress, setSavingProgress] = useState<{ done: number; total: number; photo: Photo | null } | null>(null);
  // Every inbox photo ever seen, kept even after it's swiped away — so session boundaries
  // (computed from this) don't shift as the live queue shrinks mid-sort.
  const [allInboxEver, setAllInboxEver] = useState<Photo[]>([]);
  // Photo ids already handed to auto-sort, so it fires once per photo (on load or on upload)
  // instead of re-triggering every render or looping after a cancel puts photos back in view.
  const autoSortedIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    setAllInboxEver((prev) => {
      const known = new Set(prev.map((p) => p.id));
      const additions = inbox.filter((p) => !known.has(p.id));
      return additions.length ? [...prev, ...additions] : prev;
    });
  }, [inbox]);

  useEffect(() => {
    navigator.storage?.persist?.().catch(() => {});
  }, []);

  const sessions = useMemo(() => groupIntoSessions(allInboxEver), [allInboxEver]);

  const sessionsWithRemaining = useMemo(
    () =>
      sessions
        .map((s) => {
          const photos = inbox.filter((p) => s.photoIds.includes(p.id));
          return { session: s, remaining: photos.length, previewPhoto: photos[0] };
        })
        .filter((s) => s.remaining > 0),
    [sessions, inbox],
  );

  const activeSession =
    activeSelection && activeSelection !== 'all' && activeSelection !== 'screenshots'
      ? sessions.find((s) => s.id === activeSelection)
      : null;

  const screenshotPhotos = useMemo(() => inbox.filter((p) => p.isScreenshot), [inbox]);
  const screenshotsRemaining = screenshotPhotos.length;

  // Everything Automatic mode can sort — the whole camera roll at once, screenshots excluded
  // (same set "Sort All" uses), independent of which bundle (if any) is open.
  const allSortablePhotos = useMemo(() => inbox.filter((p) => !p.isScreenshot), [inbox]);

  const photosToSort = useMemo(
    () =>
      activeSelection === 'all'
        ? inbox.filter((p) => !p.isScreenshot)
        : activeSelection === 'screenshots'
          ? inbox.filter((p) => p.isScreenshot)
          : activeSession
            ? inbox.filter((p) => activeSession.photoIds.includes(p.id))
            : [],
    [activeSelection, inbox, activeSession],
  );

  useEffect(() => {
    if (activeSelection && activeSelection !== 'all' && photosToSort.length === 0) {
      setActiveSelection(null);
    }
  }, [activeSelection, photosToSort.length]);

  const bursts = useMemo(() => groupIntoBursts(photosToSort), [photosToSort]);

  const refreshInbox = useCallback(async () => {
    const photos = await getPhotosByStatus('inbox');
    photos.sort((a, b) => a.createdAt - b.createdAt);
    setInbox(photos);
  }, []);

  const refreshAlbums = useCallback(async () => {
    const list = await getAllAlbums();
    setAlbums(list);
    if (!activeAlbumId && list.length > 0) setActiveAlbumId(list[0].id);
  }, [activeAlbumId]);

  const refreshKeptWithoutAlbumCount = useCallback(async () => {
    const kept = await getKeptPhotosWithoutAlbum();
    setKeptWithoutAlbumCount(kept.length);
  }, []);

  useEffect(() => {
    refreshInbox();
    refreshAlbums();
    refreshKeptWithoutAlbumCount();
  }, [refreshInbox, refreshAlbums, refreshKeptWithoutAlbumCount]);

  useEffect(() => {
    if (tab === 'albums') refreshKeptWithoutAlbumCount();
    // Re-sync with storage on landing on this tab — if another tab/window changed photo
    // statuses since this page mounted, in-memory `inbox` state would otherwise silently
    // drift from what's actually in IndexedDB (e.g. showing a stale, nonzero count with
    // nothing left to actually review).
    if (tab === 'sort') refreshInbox();
  }, [tab, refreshKeptWithoutAlbumCount, refreshInbox]);

  async function handleFilesSelected(entries: NewPhotoEntry[]) {
    const result = await addPhotos(entries);
    await refreshInbox();
    return result;
  }

  async function handleSwipe(photo: Photo, direction: 'keep' | 'trash' | 'album') {
    setInbox((prev) => prev.filter((p) => p.id !== photo.id));

    if (direction === 'keep') {
      await updatePhotoStatus(photo.id, 'kept');
      refreshKeptWithoutAlbumCount();
    } else if (direction === 'trash') {
      await updatePhotoStatus(photo.id, 'trashed');
    } else if (direction === 'album') {
      let albumId = activeAlbumId;
      if (!albumId) {
        const created = await createAlbum('Favorites');
        albumId = created.id;
        await refreshAlbums();
        setActiveAlbumId(albumId);
      }
      await assignPhotoToAlbum(photo.id, albumId);

      const albumName = albums.find((a) => a.id === albumId)?.name ?? 'Favorites';
      setAlbumToast(`Added to "${albumName}" 📁`);
      setTimeout(() => setAlbumToast((prev) => (prev === `Added to "${albumName}" 📁` ? null : prev)), 2000);
    }
  }

  async function handleNoteChange(id: string, note: string) {
    await setPhotoNote(id, note);
    setInbox((prev) => prev.map((p) => (p.id === id ? { ...p, note } : p)));
  }

  async function handleKeepAll() {
    const toKeep = photosToSort;
    setInbox((prev) => prev.filter((p) => !toKeep.some((k) => k.id === p.id)));
    await Promise.all(toKeep.map((p) => updatePhotoStatus(p.id, 'kept')));
    refreshKeptWithoutAlbumCount();
  }

  async function handleDeleteAll() {
    const toDelete = photosToSort;
    setInbox((prev) => prev.filter((p) => !toDelete.some((d) => d.id === p.id)));
    await Promise.all(toDelete.map((p) => updatePhotoStatus(p.id, 'trashed')));
  }

  async function handleAutoSort(nextSensitivity: Sensitivity = sensitivity) {
    if (allSortablePhotos.length === 0) return;
    setAutoSorting(true);
    setAutoSortProgress({ done: 0, total: allSortablePhotos.length });
    try {
      const library = await getLibraryFingerprints();
      const result = await runAutoSort(
        allSortablePhotos,
        (done, total) => setAutoSortProgress({ done, total }),
        nextSensitivity,
        library,
      );
      setAutoSortResult(result);
    } finally {
      setAutoSorting(false);
    }
  }

  // Re-running the full detection pipeline just to change how aggressively duplicates/blur get
  // treated is wasteful, but the classification thresholds live inside runAutoSort's single pass
  // rather than being cached separately — keeping this simple for now over a bigger refactor to
  // split "detect" from "decide." resorting (not autoSorting) drives its own loading state so the
  // sensitivity buttons stay visible instead of the whole review screen disappearing.
  async function handleSensitivityChange(next: Sensitivity) {
    if (next === sensitivity || !autoSortResult) return;
    setSensitivity(next);
    setResorting(true);
    try {
      const library = await getLibraryFingerprints();
      const result = await runAutoSort(allSortablePhotos, () => {}, next, library);
      setAutoSortResult(result);
    } finally {
      setResorting(false);
    }
  }

  // Sorting starts on its own the moment there are photos to sort — no button tap needed,
  // whether they just finished loading from IndexedDB or were just dropped in.
  useEffect(() => {
    if (autoSorting || autoSortResult || confirmingAutoSort) return;
    const unsorted = allSortablePhotos.filter((p) => !autoSortedIdsRef.current.has(p.id));
    if (unsorted.length === 0) return;
    for (const p of allSortablePhotos) autoSortedIdsRef.current.add(p.id);
    handleAutoSort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allSortablePhotos, autoSorting, autoSortResult, confirmingAutoSort]);

  function handleMoveAutoSort(photoId: string, to: 'keep' | 'delete') {
    setAutoSortResult((prev) => {
      if (!prev) return prev;
      const photo = prev.keep.find((p) => p.id === photoId) ?? prev.toDelete.find((d) => d.photo.id === photoId)?.photo;
      if (!photo) return prev;
      const keep = prev.keep.filter((p) => p.id !== photoId);
      const toDelete = prev.toDelete.filter((d) => d.photo.id !== photoId);
      if (to === 'keep') keep.push(photo);
      else toDelete.push({ photo, reason: 'Moved to delete by you', evidence: 'You moved this photo to the delete pile.' });
      return { ...prev, keep, toDelete };
    });
  }

  async function handleConfirmAutoSort(choice: ConfirmAlbumChoice) {
    if (!autoSortResult) return;
    setConfirmingAutoSort(true);
    const { keep, toDelete, fingerprints } = autoSortResult;
    setSavingProgress({ done: 0, total: keep.length, photo: keep[0] ?? null });
    try {
      setInbox((prev) => prev.filter((p) => !keep.some((k) => k.id === p.id) && !toDelete.some((d) => d.photo.id === p.id)));

      await Promise.all(toDelete.map((d) => updatePhotoStatus(d.photo.id, 'trashed')));

      const albumName = choice.name;
      let albumId: string | null = null;
      if (albumName) {
        const created = await createAlbum(albumName);
        albumId = created.id;
      }
      let done = 0;
      for (const p of keep) {
        await updatePhotoStatus(p.id, 'kept', fingerprints.get(p.id));
        if (albumId) await assignPhotoToAlbum(p.id, albumId);
        done++;
        setSavingProgress({ done, total: keep.length, photo: keep[done] ?? p });
      }
      if (albumId) {
        await refreshAlbums();
        setActiveAlbumId(albumId);
      }
      const toastMessage = albumName
        ? `Sorted! Saved ${keep.length} to "${albumName}" 📁`
        : `Sorted! Kept ${keep.length}, deleted ${toDelete.length}.`;

      refreshKeptWithoutAlbumCount();
      setAlbumToast(toastMessage);
      setTimeout(() => setAlbumToast(null), 3000);
      setAutoSortResult(null);
    } finally {
      setConfirmingAutoSort(false);
      setSavingProgress(null);
    }
  }

  function handleCancelAutoSort() {
    setAutoSortResult(null);
  }

  async function handleResolveBurst(_keep: Photo, skip: Photo[]) {
    // The kept photo stays in the inbox for a normal individual swipe next — the burst picker
    // only resolves "which of these survives," not a final keep/delete/album decision.
    setInbox((prev) => prev.filter((p) => !skip.some((s) => s.id === p.id)));
    await Promise.all(skip.map((p) => updatePhotoStatus(p.id, 'trashed')));
  }

  async function handleKeepAllBurst(photos: Photo[]) {
    setInbox((prev) => prev.filter((p) => !photos.some((b) => b.id === p.id)));
    await Promise.all(photos.map((p) => updatePhotoStatus(p.id, 'kept')));
    refreshKeptWithoutAlbumCount();
  }

  async function handleDeleteAllBurst(photos: Photo[]) {
    setInbox((prev) => prev.filter((p) => !photos.some((b) => b.id === p.id)));
    await Promise.all(photos.map((p) => updatePhotoStatus(p.id, 'trashed')));
  }

  async function handleConfirmCreateAlbum() {
    const name = newAlbumName.trim();
    if (!name) return;
    const album = await createAlbum(name);
    await refreshAlbums();
    setActiveAlbumId(album.id);
    setNewAlbumName('');
    setCreatingAlbum(false);
  }

  async function handleDeleteAlbum(album: Album) {
    const movedCount = await deleteAlbum(album.id);
    await refreshAlbums();
    await refreshKeptWithoutAlbumCount();
    setAlbumToast(
      movedCount > 0
        ? `Deleted "${album.name}" — ${movedCount} photo${movedCount === 1 ? '' : 's'} moved to All Kept Photos 📦`
        : `Deleted "${album.name}"`,
    );
    setTimeout(() => setAlbumToast(null), 3000);
  }

  if (view === 'landing') {
    return <LandingPage onGetStarted={() => setView('app')} />;
  }

  function closeSubviews() {
    setOpenAlbum(null);
    setShowAllKept(false);
    setOpenPerson(null);
    setShowFirstYear(false);
    refreshAlbums();
    refreshKeptWithoutAlbumCount();
  }

  function goToTab(next: Tab) {
    closeSubviews();
    setTab(next);
  }

  // Album, person and first-year pages render inside the same shell (header + width) as the
  // tabs, so every page keeps the app's look and navigation.
  const subview = openAlbum ? (
    <AlbumGrid
      key={openAlbum.id}
      title={openAlbum.name}
      fetchPhotos={() => getPhotosByAlbum(openAlbum.id)}
      onBack={closeSubviews}
      emptyMessage="No photos in this album yet 🌱 Swipe up on a photo to add it here."
    />
  ) : showAllKept ? (
    <AlbumGrid
      title="All Kept Photos"
      fetchPhotos={getKeptPhotosWithoutAlbum}
      onBack={closeSubviews}
      emptyMessage="No kept photos outside an album right now 🌱 Photos you keep without choosing an album show up here."
    />
  ) : openPerson ? (
    <PersonGrid key={openPerson.id} person={openPerson} onBack={closeSubviews} />
  ) : showFirstYear ? (
    <FirstYearView onBack={closeSubviews} onGoToSort={() => goToTab('sort')} />
  ) : null;

  return (
    <div className="min-h-screen bg-[#F6F1E7] text-[#231F1B]">
      <div className="max-w-5xl mx-auto px-4 sm:px-8 pb-8 flex flex-col min-h-screen">
        <header className="flex flex-wrap items-center justify-between gap-4 py-6 border-b border-black/5 mb-6">
          <button onClick={() => setView('landing')} className="text-left shrink-0" title="Back to home">
            <span className="font-serif italic text-2xl sm:text-3xl tracking-tight whitespace-nowrap">
              Tidee Moments<span className="text-[#BB5133]">.</span>
            </span>
          </button>
          <nav className="flex items-center gap-6 sm:gap-8 text-[15px] shrink-0">
            <button
              onClick={() => goToTab('albums')}
              className={`whitespace-nowrap transition-colors ${tab === 'albums' && !subview ? 'text-[#231F1B] font-medium' : 'text-[#8A8177] hover:text-[#231F1B]'}`}
            >
              Albums
            </button>
            <button
              onClick={() => goToTab('sort')}
              className={`whitespace-nowrap transition-colors ${tab === 'sort' && !subview ? 'text-[#231F1B] font-medium' : 'text-[#8A8177] hover:text-[#231F1B]'}`}
            >
              Sort photos{inbox.length > 0 ? ` (${inbox.length})` : ''}
            </button>
            <button
              onClick={() => goToTab('people')}
              className={`whitespace-nowrap transition-colors ${tab === 'people' && !subview ? 'text-[#231F1B] font-medium' : 'text-[#8A8177] hover:text-[#231F1B]'}`}
            >
              People
            </button>
            <button
              onClick={() => setView('landing')}
              title="Back to home"
              className="text-[#8A8177] hover:text-[#231F1B] transition-colors"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M10 17l5-5-5-5M15 12H3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </nav>
        </header>

      {subview}

      {!subview && tab === 'sort' && (
        <div className="flex flex-col flex-1 gap-4">
          {activeSelection === null && (
            <div className="mb-2">
              <h1 className="font-serif text-4xl sm:text-5xl leading-tight mb-3">Bring in the whole camera roll.</h1>
              <p className="text-[#7A7266] text-base sm:text-lg max-w-2xl leading-relaxed">
                Hundreds or thousands at once is fine. Your photos are analysed right here on your device, and
                nothing is uploaded anywhere — ever.
              </p>
            </div>
          )}
          <UploadZone onFilesSelected={handleFilesSelected} />

          {activeSelection === null && (
            <>
              {screenshotsRemaining > 0 && (
                <button
                  onClick={() => setActiveSelection('screenshots')}
                  className="text-sm text-[#BB5133] font-medium hover:underline mx-auto"
                >
                  📱 {screenshotsRemaining} screenshot{screenshotsRemaining === 1 ? '' : 's'} kept separate — review
                  them →
                </button>
              )}

              {savingProgress ? (
                <SavingScreen progress={savingProgress} />
              ) : autoSortResult ? (
                <AutoSortReview
                  keepPhotos={autoSortResult.keep}
                  deletePhotos={autoSortResult.toDelete}
                  moments={autoSortResult.moments}
                  sensitivity={sensitivity}
                  onSensitivityChange={handleSensitivityChange}
                  resorting={resorting}
                  onMove={handleMoveAutoSort}
                  onConfirm={handleConfirmAutoSort}
                  onCancel={handleCancelAutoSort}
                  confirming={confirmingAutoSort}
                />
              ) : autoSorting ? (
                <div className="flex flex-col items-center justify-center gap-3 text-[#8A8177] py-8">
                  <span className="text-4xl">✨</span>
                  <p className="font-semibold text-[#231F1B]">
                    Sorting {autoSortProgress?.done ?? 0} of {autoSortProgress?.total ?? 0}…
                  </p>
                  <div className="w-64 h-2 bg-[#EFE9DD] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[#BB5133] transition-all"
                      style={{
                        width: `${autoSortProgress ? (autoSortProgress.done / autoSortProgress.total) * 100 : 0}%`,
                      }}
                    />
                  </div>
                  <p className="text-xs text-[#A69C8E] max-w-sm text-center">
                    Blurry, closed-eyes, poor-quality, and duplicate shots get flagged automatically — all
                    on-device, no AI, no cost. You'll review both piles before anything is final.
                  </p>
                </div>
              ) : null}
            </>
          )}

          {activeSelection === null ? (
            !autoSorting && !autoSortResult && allSortablePhotos.length === 0 && (
              <p className="text-[#A69C8E] text-center">Upload some photos above to get started 🌱</p>
            )
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setActiveSelection(null)}
                    className="text-[#8A8177] hover:text-[#231F1B] transition-colors whitespace-nowrap"
                  >
                    ← All bundles
                  </button>
                  {photosToSort.length > 1 && (
                    <>
                      <button
                        onClick={handleKeepAll}
                        className="text-xs font-medium text-white bg-[#231F1B] hover:bg-black rounded-full px-3 py-1.5 whitespace-nowrap transition-colors"
                      >
                        ✓ Keep all {photosToSort.length}
                      </button>
                      <button
                        onClick={handleDeleteAll}
                        className="text-xs font-medium text-[#231F1B] bg-white border border-black/10 hover:bg-[#EFE9DD] rounded-full px-3 py-1.5 whitespace-nowrap transition-colors"
                      >
                        ✕ Delete all {photosToSort.length}
                      </button>
                    </>
                  )}
                </div>
                {albums.length > 0 && (
                  <select
                    value={activeAlbumId ?? ''}
                    onChange={(e) => setActiveAlbumId(e.target.value)}
                    className="text-sm border border-black/10 bg-white rounded-full px-3 py-1.5 text-[#231F1B]"
                  >
                    {albums.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="relative flex-1 min-h-[640px]">
                <SwipeDeck
                  photos={photosToSort}
                  bursts={bursts}
                  onSwipe={handleSwipe}
                  onNoteChange={handleNoteChange}
                  onResolveBurst={handleResolveBurst}
                  onKeepAllBurst={handleKeepAllBurst}
                  onDeleteAllBurst={handleDeleteAllBurst}
                  onGoToAlbums={() => {
                    setActiveSelection(null);
                    setTab('albums');
                  }}
                />
              </div>

              {photosToSort[0] && (
                <div className="flex items-center justify-center gap-6">
                  <div className="flex flex-col items-center gap-1.5">
                    <button
                      onClick={() => handleSwipe(photosToSort[0], 'trash')}
                      title="Swipe left to delete"
                      className="w-14 h-14 rounded-full bg-white border border-black/10 text-[#231F1B] text-2xl shadow-sm hover:shadow-md hover:scale-110 active:scale-95 transition-all flex items-center justify-center"
                    >
                      ✕
                    </button>
                    <span className="text-xs font-medium text-[#8A8177]">← Delete</span>
                  </div>
                  <div className="flex flex-col items-center gap-1.5">
                    <button
                      onClick={() => handleSwipe(photosToSort[0], 'album')}
                      title="Swipe up to add to album"
                      className="w-14 h-14 rounded-full bg-white border border-black/10 text-[#231F1B] text-2xl shadow-sm hover:shadow-md hover:scale-110 active:scale-95 transition-all flex items-center justify-center"
                    >
                      📁
                    </button>
                    <span className="text-xs font-medium text-[#8A8177]">↑ Album</span>
                  </div>
                  <div className="flex flex-col items-center gap-1.5">
                    <button
                      onClick={() => handleSwipe(photosToSort[0], 'keep')}
                      title="Swipe right to keep"
                      className="w-14 h-14 rounded-full bg-[#BB5133] border border-[#BB5133] text-white text-2xl shadow-sm hover:shadow-md hover:scale-110 active:scale-95 transition-all flex items-center justify-center"
                    >
                      ♥
                    </button>
                    <span className="text-xs font-medium text-[#BB5133]">Keep →</span>
                  </div>
                </div>
              )}

              <p className="text-xs text-[#A69C8E] text-center">
                Tap a button, swipe, or use arrow keys · saves to "
                {albums.find((a) => a.id === activeAlbumId)?.name ?? 'Favorites'}"
              </p>
              <p className="text-xs text-[#8A8177] text-center">
                🔒 "Delete" only removes it from Tidee Moments — the original photo on your device is never
                touched.
              </p>
            </>
          )}
        </div>
      )}

      {!subview && tab === 'albums' && (
        <div>
          <h1 className="font-serif text-4xl sm:text-5xl leading-tight mb-6">Your albums.</h1>
          <div className="flex items-center gap-2 mb-6">
            {creatingAlbum ? (
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
                  className="text-sm border border-black/10 bg-white rounded-full px-4 py-2 text-[#231F1B] focus:outline-none focus:border-[#BB5133]/50"
                />
                <button
                  type="submit"
                  disabled={!newAlbumName.trim()}
                  className="text-sm bg-[#231F1B] hover:bg-black text-white font-medium px-4 py-2 rounded-full transition-colors disabled:opacity-40"
                >
                  Create
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCreatingAlbum(false);
                    setNewAlbumName('');
                  }}
                  className="text-sm text-[#A69C8E] hover:underline px-2"
                >
                  Cancel
                </button>
              </form>
            ) : (
              <button
                onClick={() => setCreatingAlbum(true)}
                className="text-sm bg-[#231F1B] hover:bg-black text-white font-medium px-5 py-2.5 rounded-full transition-colors"
              >
                New album
              </button>
            )}
            <button
              onClick={() => setShowFirstYear(true)}
              className="text-sm bg-white border border-black/10 text-[#231F1B] font-medium px-5 py-2.5 rounded-full hover:bg-[#F6F1E7] transition-colors"
            >
              First year 🍼
            </button>
            {keptWithoutAlbumCount > 0 && (
              <button
                onClick={() => setShowAllKept(true)}
                className="text-sm bg-white border border-black/10 text-[#231F1B] font-medium px-5 py-2.5 rounded-full hover:bg-[#F6F1E7] transition-colors"
              >
                All Kept Photos ({keptWithoutAlbumCount})
              </button>
            )}
          </div>
          {albums.length === 0 ? (
            <p className="text-[#A69C8E]">No albums yet 🌱 Create one, or swipe up on a photo while tidying up.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {albums.map((a) => (
                <AlbumCard key={a.id} album={a} onOpen={() => setOpenAlbum(a)} onDelete={() => handleDeleteAlbum(a)} />
              ))}
            </div>
          )}
        </div>
      )}

      {!subview && tab === 'people' && <PeopleTab onOpenPerson={setOpenPerson} />}

      {albumToast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-[#231F1B] text-white text-sm font-medium px-4 py-2 rounded-full shadow-lg z-50">
          {albumToast}
        </div>
      )}
      </div>
    </div>
  );
}
