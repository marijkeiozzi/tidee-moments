import { useEffect, useState } from 'react';
import type { Person, Photo } from '../db/indexedDb';
import { getAllPeople, getPhotosByIds, getPhotosByStatus, renamePerson, replaceAllPeople } from '../db/indexedDb';
import { loadFaceModels, getFaceDescriptors, clusterFaces } from '../lib/faces';

interface PeopleTabProps {
  onOpenPerson: (person: Person) => void;
}

const MIN_CLUSTER_SIZE = 2;

export default function PeopleTab({ onOpenPerson }: PeopleTabProps) {
  const [people, setPeople] = useState<Person[]>([]);
  const [thumbUrls, setThumbUrls] = useState<Record<string, string>>({});
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastScanSummary, setLastScanSummary] = useState<string | null>(null);

  useEffect(() => {
    getAllPeople().then(setPeople);
  }, []);

  function handleRename(id: string, name: string) {
    const trimmed = name.trim() || 'Unnamed';
    setPeople((prev) => prev.map((p) => (p.id === id ? { ...p, name: trimmed } : p)));
    renamePerson(id, trimmed);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const urls: Record<string, string> = {};
      for (const person of people) {
        const [firstId] = person.photoIds;
        if (!firstId) continue;
        const [photo] = await getPhotosByIds([firstId]);
        if (photo && !cancelled) urls[person.id] = URL.createObjectURL(photo.blob);
      }
      if (!cancelled) setThumbUrls(urls);
      else Object.values(urls).forEach((u) => URL.revokeObjectURL(u));
    })();
    return () => {
      cancelled = true;
    };
  }, [people]);

  useEffect(() => {
    return () => {
      Object.values(thumbUrls).forEach((u) => URL.revokeObjectURL(u));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thumbUrls]);

  async function handleScan() {
    setScanning(true);
    setError(null);
    setProgress(null);
    setLastScanSummary(null);
    try {
      await loadFaceModels();
      const keptPhotos = await getPhotosByStatus('kept');
      const entries: { photoId: string; descriptor: Float32Array }[] = [];
      let photosWithFaces = 0;
      let photosFailed = 0;

      for (let i = 0; i < keptPhotos.length; i++) {
        setProgress({ done: i, total: keptPhotos.length });
        const photo: Photo = keptPhotos[i];
        try {
          const descriptors = await getFaceDescriptors(photo);
          if (descriptors.length > 0) photosWithFaces++;
          for (const descriptor of descriptors) {
            entries.push({ photoId: photo.id, descriptor });
          }
        } catch {
          // Skip photos that fail to decode/detect — don't let one bad file stop the scan.
          photosFailed++;
        }
      }
      setProgress({ done: keptPhotos.length, total: keptPhotos.length });

      const allClusters = clusterFaces(entries);
      const clusters = allClusters.filter((c) => c.photoIds.length >= MIN_CLUSTER_SIZE);
      const newPeople: Person[] = clusters.map((c, i) => ({
        id: c.id,
        name: `Person ${i + 1}`,
        createdAt: Date.now(),
        photoIds: c.photoIds,
        centroid: Array.from(c.centroid),
      }));

      await replaceAllPeople(newPeople);
      setPeople(newPeople);
      setLastScanSummary(
        `Scanned ${keptPhotos.length} photo${keptPhotos.length === 1 ? '' : 's'} · found faces in ${photosWithFaces} · ` +
          `${entries.length} face${entries.length === 1 ? '' : 's'} detected · grouped into ${newPeople.length} ` +
          `${newPeople.length === 1 ? 'person' : 'people'} (${allClusters.length - clusters.length} single-photo match${allClusters.length - clusters.length === 1 ? '' : 'es'} left ungrouped)` +
          (photosFailed > 0 ? ` · ${photosFailed} photo${photosFailed === 1 ? '' : 's'} couldn't be scanned` : ''),
      );
    } catch (err) {
      console.error('face scan failed', err);
      setError("Couldn't scan for faces — check your connection and try again.");
    } finally {
      setScanning(false);
      setProgress(null);
    }
  }

  return (
    <div>
      <h1 className="font-serif text-4xl sm:text-5xl leading-tight mb-6">Your people.</h1>
      <button
        onClick={handleScan}
        disabled={scanning}
        className="mb-4 text-sm bg-[#231F1B] hover:bg-black text-white font-medium px-5 py-2.5 rounded-full transition-colors disabled:opacity-60"
      >
        {scanning
          ? progress
            ? `Scanning… ${progress.done}/${progress.total}`
            : 'Loading face detection…'
          : people.length > 0
            ? 'Re-scan kept photos'
            : 'Find faces in your kept photos'}
      </button>

      <p className="text-xs text-[#A69C8E] mb-4">
        Runs entirely on your device — no photo is ever sent anywhere for this. Scans photos you've already
        kept, not your whole upload pile.
      </p>

      {error && <p className="text-xs text-red-600 mb-4">{error}</p>}
      {lastScanSummary && !scanning && <p className="text-xs text-[#A69C8E] mb-4">{lastScanSummary}</p>}

      {people.length === 0 && !scanning ? (
        <p className="text-[#A69C8E]">
          No people found yet 🌱 Keep some photos while sorting, then scan to group them by who's in them.
        </p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {people.map((person) => (
            <div
              key={person.id}
              className="bg-white border border-black/5 rounded-2xl overflow-hidden text-left hover:border-[#BB5133]/30 hover:shadow-md transition-all"
            >
              <button onClick={() => onOpenPerson(person)} className="block w-full aspect-square bg-[#EFE9DD]">
                {thumbUrls[person.id] && (
                  <img src={thumbUrls[person.id]} alt="" className="w-full h-full object-cover" />
                )}
              </button>
              <div className="p-2">
                <input
                  value={person.name}
                  onChange={(e) => setPeople((prev) => prev.map((p) => (p.id === person.id ? { ...p, name: e.target.value } : p)))}
                  onBlur={(e) => handleRename(person.id, e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  placeholder="Name this person…"
                  className="w-full font-semibold text-[#231F1B] text-sm truncate outline-none focus:ring-2 focus:ring-[#BB5133]/30 rounded px-0.5 -mx-0.5"
                />
                <p className="text-xs text-[#A69C8E]">{person.photoIds.length} photos</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
