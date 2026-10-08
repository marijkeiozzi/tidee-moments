import { useRef, useState } from 'react';
import SortProgress from './SortProgress';
import { getFileMeta } from '../lib/photoDate';
import { convertHeicIfNeeded, isHeicFile } from '../lib/heicConvert';
import { isMobileDevice, mapWithConcurrency } from '../lib/concurrency';
import type { AddPhotosResult, NewPhotoEntry } from '../db/indexedDb';

interface UploadZoneProps {
  // Saves photos as they're ready, without refreshing the app — called many times per upload.
  onSavePhotos: (entries: NewPhotoEntry[]) => Promise<AddPhotosResult>;
  // Called once at the end, so sorting starts on the whole batch rather than a partial one.
  onUploadComplete: () => Promise<void>;
  // Photos are already in: a shorter drop zone, so "Sort my photos" stays in view above it.
  hasPhotos?: boolean;
}

// Reading and saving is mostly waiting on storage, so a few more at once than the photo checks
// use — but still few enough that a phone never holds more than a handful of photos in memory.
function pickUploadConcurrency(): number {
  return isMobileDevice() ? 3 : 6;
}

// Safari (iPhone, iPad, Mac) opens HEIC photos natively, so converting them to JPEG in
// JavaScript — about a second or two per photo — is wasted time there. Tested once on the first
// HEIC file; other browsers still convert, since they can't display HEIC at all.
let nativeHeic: Promise<boolean> | null = null;
async function shouldConvertHeic(file: File): Promise<boolean> {
  if (!isHeicFile(file)) return false;
  if (!nativeHeic) {
    nativeHeic = createImageBitmap(file)
      .then((bitmap) => {
        bitmap.close();
        return true;
      })
      .catch(() => false);
  }
  return !(await nativeHeic);
}

// Most a single go can add. Plenty for a year or two of a camera roll; anyone picking more is
// asked to add the rest in another go, rather than the browser tab struggling with it all at once.
export const MAX_PHOTOS_PER_BATCH = 10_000;

// The progress bar updates at most this often — live on a slow phone (no waiting for 10 photos
// before it first moves), without thousands of re-renders on a fast computer.
const PROGRESS_INTERVAL_MS = 120;

export default function UploadZone({ onSavePhotos, onUploadComplete, hasPhotos = false }: UploadZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });

  async function handleFiles(fileList: File[]) {
    // Some mobile pickers (notably Android picking from a cloud-backed gallery like Google
    // Photos) hand back files with an empty or generic type ('', 'application/octet-stream')
    // instead of 'image/...', even though accept="image/*" already constrained the picker to
    // images. Requiring a real image/* type or a .heic/.heif name silently dropped those files
    // here with zero feedback — the picker would close and nothing would happen. Only reject
    // files with a type that's positively something ELSE (video, pdf, etc.); an ambiguous type
    // is let through, and downstream per-file error handling (already in place) reports it as
    // failed rather than silently vanishing the whole batch if it turns out not to be an image.
    const images = fileList.filter(
      (f) => f.type === '' || f.type === 'application/octet-stream' || f.type.startsWith('image/') || isHeicFile(f),
    );
    if (!images.length) {
      if (fileList.length) setStatus("None of those were photos this app can read (JPEG, PNG, WebP or HEIC) — nothing was added.");
      return;
    }
    const files = images.slice(0, MAX_PHOTOS_PER_BATCH);
    const leftOver = images.length - files.length;

    // Shows the spinner the instant files land, before any HEIC conversion/EXIF reading
    // starts — otherwise the drop zone looks like nothing happened for the whole time it
    // takes to process a big batch, well before the sort-progress UI has anything to show.
    setProcessing(true);
    setProgress({ done: 0, total: files.length });
    setStatus(null);
    try {
      // Each photo goes all the way through — read, check, convert if needed, save — and is then
      // let go, a few at a time. The old way read EVERY photo into memory first and only then
      // saved them, so a few thousand iPhone photos meant gigabytes held at once and the page
      // stalled on "Saving…" or was killed by the browser.
      let done = 0;
      let added = 0;
      let failed = 0;
      let screenshots = 0;
      let lastShown = 0;
      let storageFull = false;
      let notTried = 0;
      await mapWithConcurrency(files, pickUploadConcurrency(), async (file) => {
        // Once storage is full every further save would fail too — stop trying.
        if (storageFull) {
          notTried++;
          done++;
          return;
        }
        try {
          // On phones, a plain in-memory copy first: a phone picker's read permission on the
          // original can expire partway through a big batch, failing later reads with no useful
          // error. Computers don't need it, and skipping it matters there: the browser holds
          // copies like this until it gets round to freeing them, and a few thousand photos
          // (several GB) filled its photo memory, so later previews failed to save or show.
          // Saving the picked file itself copies it straight into storage.
          const safe = isMobileDevice()
            ? new File([await file.arrayBuffer()], file.name, { type: file.type, lastModified: file.lastModified })
            : file;
          // Read EXIF from the original before any HEIC conversion — conversion drops EXIF,
          // which the screenshot check depends on.
          const meta = await getFileMeta(safe);
          const stored = (await shouldConvertHeic(safe)) ? await convertHeicIfNeeded(safe).catch(() => safe) : safe;
          const result = await onSavePhotos([{ file: stored, inMemory: true, ...meta }]);
          added += result.added;
          failed += result.failed;
          if (result.storageFull) storageFull = true;
          if (meta.isScreenshot && result.added) screenshots++;
        } catch {
          failed++;
        }
        done++;
        const now = performance.now();
        if (done === files.length || now - lastShown > PROGRESS_INTERVAL_MS) {
          lastShown = now;
          setProgress({ done, total: files.length });
        }
      });

      await onUploadComplete();

      const parts = [`Added ${added.toLocaleString()} photo${added === 1 ? '' : 's'}`];
      if (screenshots > 0) parts.push(`${screenshots} screenshot${screenshots === 1 ? '' : 's'} set aside separately`);
      if (storageFull) {
        const missed = failed + notTried;
        parts.push(
          `⚠️ This device ran out of space for photos, so ${missed.toLocaleString()} weren't added. Free up some storage, or sort and save what's here first, then add the rest`,
        );
      } else if (failed > 0) {
        parts.push(`⚠️ ${failed} photo${failed === 1 ? '' : 's'} couldn't be added — try adding ${failed === 1 ? 'it' : 'them'} again`);
      }
      if (leftOver > 0) {
        parts.push(
          `You picked ${images.length.toLocaleString()}, so the first ${MAX_PHOTOS_PER_BATCH.toLocaleString()} were added. Add the other ${leftOver.toLocaleString()} in another go`,
        );
      }
      setStatus(parts.join(' · ') + '.');
    } finally {
      setProcessing(false);
    }
  }

  return (
    <div>
      <div
        className={`border-2 border-dashed border-black/15 bg-[#FBF8F2] rounded-3xl px-6 text-center cursor-pointer hover:border-[#BB5133]/40 transition-colors ${
          hasPhotos && !processing ? 'py-8' : 'py-16 sm:py-20'
        }`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          handleFiles(Array.from(e.dataTransfer.files));
        }}
      >
        {processing || hasPhotos ? null : (
          <div className="w-16 h-16 mx-auto mb-5 rounded-full bg-[#F6DFCF] flex items-center justify-center">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#BB5133" strokeWidth="1.8">
              <rect x="3" y="3" width="14" height="14" rx="2.5" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="8" cy="8" r="1.4" fill="#BB5133" stroke="none" />
              <path d="M3 14l4-4 3 3 4-5 3 3.5" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M18 15v6M15 18h6" strokeLinecap="round" />
            </svg>
          </div>
        )}
        {processing ? (
          <SortProgress
            step={1}
            title="Adding your photos"
            done={progress.done}
            total={progress.total}
            note="Keep this page open. Once they're all in, press Sort my photos."
          />
        ) : (
          <>
            <h3 className="font-serif text-2xl sm:text-3xl mb-2">{hasPhotos ? 'Add more photos' : 'Drop photos here'}</h3>
            <p className="text-[#8A8177] text-sm mb-6">JPEG, PNG or WebP. HEIC photos work in Safari.</p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  inputRef.current?.click();
                }}
                className="text-sm font-semibold bg-[#231F1B] hover:bg-black text-white px-6 py-3 rounded-full transition-colors"
              >
                Choose photos
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  folderInputRef.current?.click();
                }}
                className="inline-flex items-center gap-2 text-sm font-semibold bg-white hover:bg-[#F6F1E7] text-[#231F1B] border border-black/10 px-6 py-3 rounded-full transition-colors"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path
                    d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                Choose a folder
              </button>
            </div>
            <p className="text-[#A69C8E] text-xs mt-6 max-w-sm mx-auto">
              Up to 10,000 photos at a time. For big batches use "Choose a folder" — dragging hundreds at once can
              silently drop some, since browsers cap how many files a single drag can carry.
            </p>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            handleFiles(Array.from(e.target.files || []));
            e.target.value = '';
          }}
        />
        <input
          ref={folderInputRef}
          type="file"
          accept="image/*"
          multiple
          // @ts-expect-error non-standard attribute, supported by Chrome/Edge/Safari for folder picking
          webkitdirectory=""
          className="hidden"
          onChange={(e) => {
            handleFiles(Array.from(e.target.files || []));
            e.target.value = '';
          }}
        />
      </div>

      {!processing && status && <p className="text-sm text-[#5B5349] mt-3">{status}</p>}

      <p className="flex items-center gap-2 text-xs text-[#A69C8E] mt-4">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0">
          <path
            d="M12 2 4 5v6c0 5 3.4 8.6 8 10 4.6-1.4 8-5 8-10V5l-8-3Z"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path d="m9 12 2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Nothing is ever uploaded — every photo stays on this device.
      </p>
    </div>
  );
}
