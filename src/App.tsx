import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import UploadZone from './components/UploadZone';
import SwipeDeck from './components/SwipeDeck';
import AlbumGrid from './components/AlbumGrid';
import AlbumCard from './components/AlbumCard';
import LandingPage from './components/LandingPage';
import PeopleTab from './components/PeopleTab';
import AutoSortReview, { type ConfirmAlbumChoice } from './components/AutoSortReview';
import SavingScreen from './components/SavingScreen';
import FirstYearView from './components/FirstYearView';
import {
  addPhotos,
  assignPhotoToAlbum,
  createAlbum,
  deleteAlbum,
  getAllAlbums,
  getAllPeople,
  getKeptPhotosWithoutAlbum,
  getLibraryFingerprints,
  getPhotosByAlbum,
  getPhotosByIds,
  getPhotosByStatus,
  renameAlbum,
  renamePerson,
  setPhotoNote,
  updatePhotoStatus,
  type Album,
  type NewPhotoEntry,
  type Person,
  type Photo,
} from './db/indexedDb';
import { groupIntoBursts } from './lib/bursts';
import { runAutoSort, type AutoSortResult, type Sensitivity } from './lib/autoSort';
import { navigate, routeHref, tabOf, useRoute, type Route } from './lib/routes';

// What the swipe deck is showing: every unsorted photo one by one, or the screenshots that
// were kept out of the automatic sort.
type Selection = 'all' | 'screenshots';

interface Toast {
  message: string;
  href?: string;
  linkLabel?: string;
}

function NotFound({ message, href, linkLabel }: { message: string; href: string; linkLabel: string }) {
  return (
    <div className="py-10">
      <p className="text-[#7A7266] mb-3">{message}</p>
      <a href={href} className="text-sm text-[#BB5133] font-medium hover:underline">
        ← {linkLabel}
      </a>
    </div>
  );
}

export default function App() {
  const route = useRoute();
  const tab = tabOf(route);
  const [inbox, setInbox] = useState<Photo[]>([]);
  const [albums, setAlbums] = useState<Album[] | null>(null);
  const [people, setPeople] = useState<Person[] | null>(null);
  const [activeAlbumId, setActiveAlbumId] = useState<string | null>(null);
  const [keptWithoutAlbumCount, setKeptWithoutAlbumCount] = useState(0);
  const [creatingAlbum, setCreatingAlbum] = useState(false);
  const [newAlbumName, setNewAlbumName] = useState('');
  const [activeSelection, setActiveSelection] = useState<Selection | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [autoSorting, setAutoSorting] = useState(false);
  const [autoSortProgress, setAutoSortProgress] = useState<{ done: number; total: number } | null>(null);
  const [autoSortResult, setAutoSortResult] = useState<AutoSortResult | null>(null);
  const [confirmingAutoSort, setConfirmingAutoSort] = useState(false);
  const [sensitivity, setSensitivity] = useState<Sensitivity>('balanced');
  const [resorting, setResorting] = useState(false);
  const [savingProgress, setSavingProgress] = useState<{ done: number; total: number; photo: Photo | null } | null>(null);
  // Photo ids already handed to auto-sort, so it fires once per photo (on load or on upload)
  // instead of re-triggering every render or looping after a cancel puts photos back in view.
  const autoSortedIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    navigator.storage?.persist?.().catch(() => {});
  }, []);

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
          : [],
    [activeSelection, inbox],
  );

  useEffect(() => {
    if (activeSelection === 'screenshots' && photosToSort.length === 0) setActiveSelection(null);
  }, [activeSelection, photosToSort.length]);

  function showToast(next: Toast, ms = next.href ? 6000 : 3000) {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast(next);
    toastTimerRef.current = setTimeout(() => setToast(null), ms);
  }

  const bursts = useMemo(() => groupIntoBursts(photosToSort), [photosToSort]);

  const refreshInbox = useCallback(async () => {
    const photos = await getPhotosByStatus('inbox');
    photos.sort((a, b) => a.createdAt - b.createdAt);
    setInbox(photos);
  }, []);

  const refreshAlbums = useCallback(async () => {
    const list = await getAllAlbums();
    setAlbums(list);
    setActiveAlbumId((prev) => (prev && list.some((a) => a.id === prev) ? prev : (list[0]?.id ?? null)));
  }, []);

  const refreshPeople = useCallback(async () => {
    setPeople(await getAllPeople());
  }, []);

  const refreshKeptWithoutAlbumCount = useCallback(async () => {
    const kept = await getKeptPhotosWithoutAlbum();
    setKeptWithoutAlbumCount(kept.length);
  }, []);

  useEffect(() => {
    refreshInbox();
    refreshAlbums();
    refreshPeople();
    refreshKeptWithoutAlbumCount();
  }, [refreshInbox, refreshAlbums, refreshPeople, refreshKeptWithoutAlbumCount]);

  // Re-sync with storage whenever a page is opened — photos may have been moved, renamed or
  // filed on another page (or in another browser tab) since this one last read them.
  useEffect(() => {
    if (route.page === 'albums') {
      refreshAlbums();
      refreshKeptWithoutAlbumCount();
    }
    if (route.page === 'sort') refreshInbox();
    if (route.page === 'people' || route.page === 'person') refreshPeople();
  }, [route, refreshAlbums, refreshKeptWithoutAlbumCount, refreshInbox, refreshPeople]);

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

      const albumName = albums?.find((a) => a.id === albumId)?.name ?? 'Favorites';
      showToast({ message: `Added to "${albumName}" 📁`, href: routeHref({ page: 'album', albumId }), linkLabel: 'Open' }, 2500);
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
      refreshKeptWithoutAlbumCount();
      showToast(
        albumId
          ? {
              message: `Sorted! Saved ${keep.length} to "${albumName}" 📁`,
              href: routeHref({ page: 'album', albumId }),
              linkLabel: 'View album',
            }
          : {
              message: `Sorted! Kept ${keep.length}, set aside ${toDelete.length}.`,
              href: routeHref({ page: 'all-kept' }),
              linkLabel: 'View photos',
            },
      );
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
    showToast(
      movedCount > 0
        ? {
            message: `Deleted "${album.name}" — ${movedCount} photo${movedCount === 1 ? '' : 's'} moved to All Kept Photos 📦`,
            href: routeHref({ page: 'all-kept' }),
            linkLabel: 'View',
          }
        : { message: `Deleted "${album.name}"` },
    );
  }

  if (route.page === 'landing') {
    return <LandingPage />;
  }

  const back = (to: Route) => () => navigate(to);

  // Album, person and first-year pages render inside the same shell (header + width) as the
  // tabs, so every page keeps the app's look and navigation. Each has its own address, so it
  // can be reopened after a refresh or with the browser's back button.
  let subview: JSX.Element | null = null;
  if (route.page === 'album') {
    const album = albums?.find((a) => a.id === route.albumId);
    subview =
      albums === null ? (
        <p className="text-[#A69C8E]">Loading…</p>
      ) : !album ? (
        <NotFound message="This album doesn't exist any more — it may have been deleted." href={routeHref({ page: 'albums' })} linkLabel="All albums" />
      ) : (
        <AlbumGrid
          key={album.id}
          mode="album"
          currentAlbumId={album.id}
          title={album.name}
          fetchPhotos={() => getPhotosByAlbum(album.id)}
          onBack={back({ page: 'albums' })}
          backLabel="Albums"
          onRename={async (name) => {
            await renameAlbum(album.id, name);
            await refreshAlbums();
          }}
          emptyMessage="No photos in this album yet 🌱 Swipe up on a photo to add it here."
        />
      );
  } else if (route.page === 'all-kept') {
    subview = (
      <AlbumGrid
        key="all-kept"
        mode="unfiled"
        title="All Kept Photos"
        fetchPhotos={getKeptPhotosWithoutAlbum}
        onBack={back({ page: 'albums' })}
        backLabel="Albums"
        emptyMessage="No kept photos outside an album right now 🌱 Photos you keep without choosing an album show up here."
      />
    );
  } else if (route.page === 'first-year') {
    subview = <FirstYearView slot={route.slot} onBack={back({ page: 'albums' })} />;
  } else if (route.page === 'person') {
    const person = people?.find((p) => p.id === route.personId);
    subview =
      people === null ? (
        <p className="text-[#A69C8E]">Loading…</p>
      ) : !person ? (
        <NotFound message="This person isn't in your people list any more — a new face scan may have regrouped them." href={routeHref({ page: 'people' })} linkLabel="People" />
      ) : (
        <AlbumGrid
          key={person.id}
          mode="collection"
          title={person.name}
          // Only photos still kept — one deleted since the face scan shouldn't come back here.
          fetchPhotos={async () => (await getPhotosByIds(person.photoIds)).filter((p) => p.status === 'kept')}
          onBack={back({ page: 'people' })}
          backLabel="People"
          onRename={async (name) => {
            await renamePerson(person.id, name);
            await refreshPeople();
          }}
          renameHint="tap the name to rename this person"
        />
      );
  }

  const navClass = (t: 'sort' | 'albums' | 'people') =>
    `whitespace-nowrap transition-colors ${tab === t ? 'text-[#231F1B] font-medium' : 'text-[#8A8177] hover:text-[#231F1B]'}`;

  return (
    <div className="min-h-screen bg-[#F6F1E7] text-[#231F1B]">
      <div className="max-w-5xl mx-auto px-4 sm:px-8 pb-8 flex flex-col min-h-screen">
        <header className="flex flex-wrap items-center justify-between gap-4 py-6 border-b border-black/5 mb-6">
          <a href={routeHref({ page: 'landing' })} className="text-left shrink-0" title="Back to home">
            <span className="font-serif italic text-2xl sm:text-3xl tracking-tight whitespace-nowrap">
              Tidee Moments<span className="text-[#BB5133]">.</span>
            </span>
          </a>
          <nav className="flex items-center gap-6 sm:gap-8 text-[15px] shrink-0">
            <a href={routeHref({ page: 'albums' })} className={navClass('albums')} aria-current={route.page === 'albums' ? 'page' : undefined}>
              Albums
            </a>
            <a
              href={routeHref({ page: 'sort' })}
              onClick={() => setActiveSelection(null)}
              className={navClass('sort')}
              aria-current={route.page === 'sort' ? 'page' : undefined}
            >
              Sort photos{inbox.length > 0 ? ` (${inbox.length})` : ''}
            </a>
            <a href={routeHref({ page: 'people' })} className={navClass('people')} aria-current={route.page === 'people' ? 'page' : undefined}>
              People
            </a>
            <a href={routeHref({ page: 'landing' })} title="Back to home" aria-label="Back to home" className="text-[#8A8177] hover:text-[#231F1B] transition-colors">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M10 17l5-5-5-5M15 12H3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </a>
          </nav>
        </header>

      {subview}

      {route.page === 'sort' && (
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
            !autoSorting &&
            !autoSortResult &&
            !savingProgress &&
            (allSortablePhotos.length === 0 ? (
              <div className="text-center">
                <p className="text-[#A69C8E]">Upload some photos above to get started 🌱</p>
                <a href={routeHref({ page: 'albums' })} className="text-sm text-[#BB5133] font-medium hover:underline">
                  Or see the photos you've already sorted →
                </a>
              </div>
            ) : (
              // Photos waiting but nothing running — e.g. after "Start over" on the results.
              <div className="bg-white border border-black/5 rounded-2xl p-6 text-center">
                <p className="font-serif text-2xl mb-1">
                  {allSortablePhotos.length} photo{allSortablePhotos.length === 1 ? '' : 's'} waiting to be sorted
                </p>
                <p className="text-sm text-[#8A8177] mb-5">Let Tidee pick the keepers, or go through them yourself.</p>
                <div className="flex flex-wrap justify-center gap-2">
                  <button
                    onClick={() => handleAutoSort()}
                    className="text-sm bg-[#231F1B] hover:bg-black text-white font-medium px-5 py-2.5 rounded-full transition-colors"
                  >
                    Sort automatically
                  </button>
                  <button
                    onClick={() => setActiveSelection('all')}
                    className="text-sm bg-white border border-black/10 text-[#231F1B] font-medium px-5 py-2.5 rounded-full hover:bg-[#EFE9DD] transition-colors"
                  >
                    Sort one by one
                  </button>
                </div>
              </div>
            ))
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setActiveSelection(null)}
                    className="text-[#8A8177] hover:text-[#231F1B] transition-colors whitespace-nowrap"
                  >
                    ← Back
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
                {albums && albums.length > 0 && (
                  <select
                    aria-label="Album for swipe up"
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
                    navigate({ page: 'albums' });
                  }}
                />
              </div>

              {photosToSort[0] && (
                <div className="flex items-center justify-center gap-6">
                  <div className="flex flex-col items-center gap-1.5">
                    <button
                      onClick={() => handleSwipe(photosToSort[0], 'trash')}
                      title="Swipe left to delete"
                      aria-label="Delete"
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
                      aria-label="Add to album"
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
                      aria-label="Keep"
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
                {albums?.find((a) => a.id === activeAlbumId)?.name ?? 'Favorites'}"
              </p>
              <p className="text-xs text-[#8A8177] text-center">
                🔒 "Delete" only removes it from Tidee Moments — the original photo on your device is never
                touched.
              </p>
            </>
          )}
        </div>
      )}

      {route.page === 'albums' && (
        <div>
          <h1 className="font-serif text-4xl sm:text-5xl leading-tight mb-6">Your albums.</h1>
          <div className="flex flex-wrap items-center gap-2 mb-6">
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
            <a
              href={routeHref({ page: 'first-year', slot: null })}
              className="text-sm bg-white border border-black/10 text-[#231F1B] font-medium px-5 py-2.5 rounded-full hover:bg-[#EFE9DD] transition-colors"
            >
              First year 🍼
            </a>
            {keptWithoutAlbumCount > 0 && (
              <a
                href={routeHref({ page: 'all-kept' })}
                className="text-sm bg-white border border-black/10 text-[#231F1B] font-medium px-5 py-2.5 rounded-full hover:bg-[#EFE9DD] transition-colors"
              >
                All Kept Photos ({keptWithoutAlbumCount})
              </a>
            )}
          </div>
          {albums === null ? null : albums.length === 0 ? (
            <p className="text-[#A69C8E]">No albums yet 🌱 Create one, or swipe up on a photo while tidying up.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {albums.map((a) => (
                <AlbumCard key={a.id} album={a} href={routeHref({ page: 'album', albumId: a.id })} onDelete={() => handleDeleteAlbum(a)} />
              ))}
            </div>
          )}
        </div>
      )}

      {route.page === 'people' && <PeopleTab onPeopleChanged={refreshPeople} />}

      {toast && (
        <div
          role="status"
          className="fixed bottom-6 left-1/2 -translate-x-1/2 max-w-[calc(100%-2rem)] flex items-center gap-3 bg-[#231F1B] text-white text-sm font-medium px-4 py-2 rounded-full shadow-lg z-50"
        >
          <span>{toast.message}</span>
          {toast.href && (
            <a href={toast.href} onClick={() => setToast(null)} className="text-[#F6DFCF] underline underline-offset-2 whitespace-nowrap">
              {toast.linkLabel ?? 'Open'}
            </a>
          )}
        </div>
      )}
      </div>
    </div>
  );
}
