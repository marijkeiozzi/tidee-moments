import { useEffect, useState } from 'react';
import type { Album, Person, Photo } from '../db/indexedDb';
import { assignPhotoToAlbum, createAlbum, getAllAlbums, getPhotosByIds, renamePerson } from '../db/indexedDb';
import { buildShareablePage } from '../lib/sharePage';
import { deliverFile } from '../lib/saveFile';
import PhotoThumbImage from './PhotoThumbImage';

interface PersonGridProps {
  person: Person;
  onBack: () => void;
}

export default function PersonGrid({ person, onBack }: PersonGridProps) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [name, setName] = useState(person.name);
  const [buildingPage, setBuildingPage] = useState(false);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [selectedAlbumId, setSelectedAlbumId] = useState('');
  const [creatingAlbum, setCreatingAlbum] = useState(false);
  const [newAlbumName, setNewAlbumName] = useState('');
  const [addingToAlbum, setAddingToAlbum] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    getPhotosByIds(person.photoIds).then(setPhotos);
  }, [person.photoIds]);

  useEffect(() => {
    getAllAlbums().then((list) => {
      setAlbums(list);
      setSelectedAlbumId((prev) => prev || list[0]?.id || '');
    });
  }, []);

  async function handleNameBlur() {
    if (name.trim() && name !== person.name) {
      await renamePerson(person.id, name.trim());
    }
  }

  async function handleSharePage() {
    setBuildingPage(true);
    try {
      const { blob } = await buildShareablePage(name || 'Photos', photos);
      deliverFile(blob, `${name || 'photos'}.html`, `${name || 'Photos'} — share page`);
    } finally {
      setBuildingPage(false);
    }
  }

  async function handleConfirmCreateAlbum() {
    const trimmed = newAlbumName.trim();
    if (!trimmed) return;
    const album = await createAlbum(trimmed);
    setAlbums((prev) => [...prev, album]);
    setSelectedAlbumId(album.id);
    setNewAlbumName('');
    setCreatingAlbum(false);
  }

  async function handleAddAllToAlbum() {
    if (!selectedAlbumId) return;
    setAddingToAlbum(true);
    try {
      await Promise.all(photos.map((p) => assignPhotoToAlbum(p.id, selectedAlbumId)));
      const albumName = albums.find((a) => a.id === selectedAlbumId)?.name ?? 'the album';
      setToast(`Added ${photos.length} photo${photos.length === 1 ? '' : 's'} to "${albumName}" 📁`);
      setTimeout(() => setToast(null), 2500);
    } finally {
      setAddingToAlbum(false);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <button onClick={onBack} className="text-[#BB5133] font-medium hover:underline">
          ← Back
        </button>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={handleNameBlur}
          className="text-lg font-bold text-[#231F1B] text-center bg-transparent border-b border-transparent hover:border-black/20 focus:border-[#BB5133]/50 outline-none"
        />
        <button
          onClick={handleSharePage}
          disabled={buildingPage || photos.length === 0}
          className="text-sm bg-[#231F1B] hover:bg-black text-white font-semibold px-3 py-1.5 rounded-full shadow-sm hover:shadow-md transition-all disabled:opacity-40"
        >
          {buildingPage ? 'Building…' : '📤 Share as a page'}
        </button>
      </div>

      <p className="text-xs text-[#A69C8E] mb-4">Tap the name above to rename this person.</p>

      {photos.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-4 bg-white border border-black/5 rounded-2xl p-3">
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
                className="text-sm border border-black/5 bg-white rounded-full px-3 py-1.5 text-[#231F1B] focus:outline-none focus:border-[#BB5133]/50"
              />
              <button
                type="submit"
                disabled={!newAlbumName.trim()}
                className="text-sm bg-[#231F1B] hover:bg-black text-white font-semibold px-3 py-1.5 rounded-full disabled:opacity-40"
              >
                Create
              </button>
              <button
                type="button"
                onClick={() => setCreatingAlbum(false)}
                className="text-sm text-[#8A8177] hover:underline"
              >
                Cancel
              </button>
            </form>
          ) : (
            <>
              <span className="text-sm text-[#8A8177]">Add all {photos.length} photos to:</span>
              {albums.length > 0 && (
                <select
                  value={selectedAlbumId}
                  onChange={(e) => setSelectedAlbumId(e.target.value)}
                  className="text-sm border border-black/5 bg-white rounded-lg px-2 py-1.5 text-[#231F1B]"
                >
                  {albums.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              )}
              <button
                onClick={() => setCreatingAlbum(true)}
                className="text-sm text-[#BB5133] hover:underline"
              >
                + New album
              </button>
              <button
                onClick={handleAddAllToAlbum}
                disabled={!selectedAlbumId || addingToAlbum}
                className="text-sm bg-[#231F1B] hover:bg-black text-white font-semibold px-3 py-1.5 rounded-full shadow-sm hover:shadow-md transition-all disabled:opacity-40 ml-auto"
              >
                {addingToAlbum ? 'Adding…' : '📁 Add all'}
              </button>
            </>
          )}
        </div>
      )}

      {photos.length === 0 ? (
        <p className="text-[#A69C8E]">No photos found for this person.</p>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
          {photos.map((p) => (
            <div key={p.id} className="w-full aspect-square rounded-xl overflow-hidden shadow-sm bg-[#EFE9DD]">
              <PhotoThumbImage photo={p} />
            </div>
          ))}
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-[#231F1B] text-white text-sm font-medium px-4 py-2 rounded-full shadow-lg z-50">
          {toast}
        </div>
      )}
    </div>
  );
}
