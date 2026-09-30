import { useRef, useState } from 'react';
import { getFileMeta } from '../lib/photoDate';
import { convertHeicIfNeeded, isHeicFile } from '../lib/heicConvert';
import { mapWithConcurrency, pickConcurrency } from '../lib/concurrency';
import type { AddPhotosResult, NewPhotoEntry } from '../db/indexedDb';

interface UploadZoneProps {
  onFilesSelected: (entries: NewPhotoEntry[]) => Promise<AddPhotosResult>;
}

// How often the on-screen counter updates during a big batch — updating state on every single
// photo for a batch of thousands would trigger thousands of re-renders for no visible benefit;
// this keeps the counter feeling live without that overhead.
const PROGRESS_STEP = 10;

export default function UploadZone({ onFilesSelected }: UploadZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);

  async function handleFiles(fileList: File[]) {
    // Some mobile pickers (notably Android picking from a cloud-backed gallery like Google
    // Photos) hand back files with an empty or generic type ('', 'application/octet-stream')
    // instead of 'image/...', even though accept="image/*" already constrained the picker to
    // images. Requiring a real image/* type or a .heic/.heif name silently dropped those files
    // here with zero feedback — the picker would close and nothing would happen. Only reject
    // files with a type that's positively something ELSE (video, pdf, etc.); an ambiguous type
    // is let through, and downstream per-file error handling (already in place) reports it as
    // failed rather than silently vanishing the whole batch if it turns out not to be an image.
    const files = fileList.filter(
      (f) => f.type === '' || f.type === 'application/octet-stream' || f.type.startsWith('image/') || isHeicFile(f),
    );
    if (!files.length) return;

    // Shows the spinner the instant files land, before any HEIC conversion/EXIF reading
    // starts — otherwise the drop zone looks like nothing happened for the whole time it
    // takes to process a big batch, well before the sort-progress UI has anything to show.
    setProcessing(true);
    setStatus(null);
    try {
      const concurrency = pickConcurrency();

      // Read each file's bytes into a plain in-memory File right away, before anything else
      // touches it — HEIC conversion, EXIF parsing, and dimension-checking each open the file
      // again later, and a mobile picker's read grant on the original handle (especially for a
      // cloud-backed gallery item) can be transient and expire partway through a big batch,
      // failing later reads with no useful error. A copy made from already-read bytes has no
      // such dependency, matching the same safeguard indexedDb.ts already applies at save time —
      // this just makes sure every earlier step benefits from it too, not only the last one.
      let safeDone = 0;
      setStatus(`Reading ${files.length} photo${files.length === 1 ? '' : 's'}…`);
      const safeFiles = await mapWithConcurrency(files, concurrency, async (file) => {
        let safe = file;
        try {
          const bytes = await file.arrayBuffer();
          safe = new File([bytes], file.name, { type: file.type, lastModified: file.lastModified });
        } catch {
          // Couldn't read it at all — leave the original handle; it'll fail again (and get
          // counted as failed) at save time rather than being silently skipped here.
        }
        safeDone++;
        if (files.length > 10 && (safeDone % PROGRESS_STEP === 0 || safeDone === files.length)) {
          setStatus(`Reading photos… ${safeDone}/${files.length}`);
        }
        return safe;
      });

      const heicCount = safeFiles.filter(isHeicFile).length;

      // Read EXIF/screenshot metadata from the ORIGINAL file, before HEIC conversion — heic2any
      // re-encodes through a canvas, which drops EXIF entirely (including the camera Make/Model
      // that isScreenshot's real-photo check depends on). Reading metadata afterward meant every
      // converted iPhone photo looked exactly like a screenshot (no camera EXIF, JPEG), silently
      // misfiling real photos. exifr reads HEIC's own EXIF directly, so this has always been the
      // correct order — do it first, then convert for storage/display.
      let metaDone = 0;
      setStatus(`Reading ${safeFiles.length} photo${safeFiles.length === 1 ? '' : 's'}…`);
      const metas = await mapWithConcurrency(safeFiles, concurrency, async (file) => {
        const meta = await getFileMeta(file);
        metaDone++;
        if (safeFiles.length > 10 && (metaDone % PROGRESS_STEP === 0 || metaDone === safeFiles.length)) {
          setStatus(`Reading photos… ${metaDone}/${safeFiles.length}`);
        }
        return meta;
      });

      let convertedDone = 0;
      if (heicCount > 0) setStatus(`Converting ${heicCount} iPhone photo${heicCount === 1 ? '' : 's'}…`);
      const converted = await mapWithConcurrency(safeFiles, concurrency, async (file) => {
        try {
          return await convertHeicIfNeeded(file);
        } catch {
          return file;
        } finally {
          convertedDone++;
          if (heicCount > 10 && (convertedDone % PROGRESS_STEP === 0 || convertedDone === files.length)) {
            setStatus(`Converting photos… ${convertedDone}/${files.length}`);
          }
        }
      });

      const entries: NewPhotoEntry[] = converted.map((file, i) => ({ file, ...metas[i] }));
      const screenshotCount = entries.filter((e) => e.isScreenshot).length;

      setStatus('Saving…');
      const result = await onFilesSelected(entries);

      const parts = [`Added ${result.added} photo${result.added === 1 ? '' : 's'}`];
      if (screenshotCount > 0) parts.push(`${screenshotCount} screenshot${screenshotCount === 1 ? '' : 's'} set aside separately`);
      if (result.failed > 0) {
        parts.push(`⚠️ ${result.failed} photo${result.failed === 1 ? '' : 's'} couldn't be saved — try adding ${result.failed === 1 ? 'it' : 'them'} again`);
      }
      setStatus(parts.join(' · ') + '.');
    } finally {
      setProcessing(false);
    }
  }

  return (
    <div>
      <div
        className="border-2 border-dashed border-black/15 bg-[#FBF8F2] rounded-3xl px-6 py-16 sm:py-20 text-center cursor-pointer hover:border-[#BB5133]/40 transition-colors"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          handleFiles(Array.from(e.dataTransfer.files));
        }}
      >
        {processing ? (
          <div className="w-9 h-9 mx-auto mb-5 rounded-full border-4 border-[#EFDFC8] border-t-[#BB5133] animate-spin" />
        ) : (
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
          <p className="text-[#5B5349] font-medium">{status ?? 'Reading your photos…'}</p>
        ) : (
          <>
            <h3 className="font-serif text-2xl sm:text-3xl mb-2">Drop photos here</h3>
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
              Uploading a big batch (100+ at once)? Use "Choose photos" or "Choose a folder" — dragging that many at
              once can silently drop some, since browsers cap how many files a single drag can carry.
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

      {!processing && status && <p className="text-xs text-[#8A8177] mt-3">{status}</p>}

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
