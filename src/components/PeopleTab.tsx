import { useEffect, useState } from 'react';
import type { Person, Photo } from '../db/indexedDb';
import { getAllPeople, getPhotosByIds, getPhotosByStatus, renamePerson, replaceAllPeople } from '../db/indexedDb';
import * as faceapi from 'face-api.js';
import { loadFaceModels, getFaceDescriptors, clusterFaces } from '../lib/faces';

interface PeopleTabProps {
  onOpenPerson: (person: Person) => void;
}

const MIN_CLUSTER_SIZE = 2;
// A re-scanned cluster inherits an existing person's name (and id) when their representative
// faces are this close — the same bar clusterFaces uses to call two faces one person.
const SAME_PERSON_DISTANCE = 0.6;
const SCAN_SIGNATURE_KEY = 'tidee:peopleScanSignature';

// Face descriptors per photo for this page session, so re-scanning after keeping a few more
// photos only runs detection on the new ones instead of the whole library again.
const descriptorCache = new Map<string, Float32Array[]>();

// Cheap fingerprint of exactly which photos are kept — when it matches the last scan, the
// People list is already up to date and there's nothing to re-scan.
function signatureOf(photos: Photo[]): string {
  const ids = photos.map((p) => p.id).sort();
  let h = 2166136261;
  for (const id of ids) for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return `${ids.length}:${(h >>> 0).toString(36)}`;
}

function readSignature(): string | null {
  try {
    return localStorage.getItem(SCAN_SIGNATURE_KEY);
  } catch {
    return null;
  }
}

function writeSignature(sig: string) {
  try {
    localStorage.setItem(SCAN_SIGNATURE_KEY, sig);
  } catch {
    // Storage blocked — the scan just runs again next visit.
  }
}

export default function PeopleTab({ onOpenPerson }: PeopleTabProps) {
  const [people, setPeople] = useState<Person[]>([]);
  const [thumbUrls, setThumbUrls] = useState<Record<string, string>>({});
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastScanSummary, setLastScanSummary] = useState<string | null>(null);

  // "Auto-grouped": scan on its own whenever the set of kept photos has changed since the last
  // scan (or there's never been one), instead of waiting for a button tap.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const existing = await getAllPeople();
      if (cancelled) return;
      setPeople(existing);
      const kept = await getPhotosByStatus('kept');
      if (cancelled || kept.length === 0) return;
      if (signatureOf(kept) !== readSignature()) handleScan();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
          let descriptors = descriptorCache.get(photo.id);
          if (!descriptors) {
            descriptors = await getFaceDescriptors(photo);
            descriptorCache.set(photo.id, descriptors);
          }
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
      // Carry names over from the previous scan — re-scanning must never turn "Grandma" back
      // into "Person 3". Each old person is matched to at most one new cluster, closest first.
      const previous = await getAllPeople();
      const unclaimed = new Set(previous.map((p) => p.id));
      let unnamed = 0;
      const newPeople: Person[] = clusters.map((c) => {
        let match: Person | null = null;
        let matchDistance = SAME_PERSON_DISTANCE;
        for (const old of previous) {
          if (!unclaimed.has(old.id)) continue;
          const d = faceapi.euclideanDistance(Float32Array.from(old.centroid), c.centroid);
          if (d < matchDistance) {
            match = old;
            matchDistance = d;
          }
        }
        if (match) unclaimed.delete(match.id);
        return {
          id: match?.id ?? c.id,
          name: match?.name ?? `Person ${previous.length + ++unnamed}`,
          createdAt: match?.createdAt ?? Date.now(),
          photoIds: c.photoIds,
          // Keep the old centroid so the next re-scan matches against the same reference face.
          centroid: match ? match.centroid : Array.from(c.centroid),
        };
      });

      await replaceAllPeople(newPeople);
      setPeople(newPeople);
      writeSignature(signatureOf(keptPhotos));
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
        Runs entirely on your device — no photo is ever sent anywhere for this. Kept photos are scanned
        automatically whenever they change; names you give people stay put.
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
