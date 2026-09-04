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

      let metaDone = 0;
      setStatus(`Reading ${converted.length} photo${converted.length === 1 ? '' : 's'}…`);
      const withMeta = await mapWithConcurrency(converted, concurrency, async (file) => {
        const meta = await getFileMeta(file);
        metaDone++;
        if (converted.length > 10 && (metaDone % PROGRESS_STEP === 0 || metaDone === converted.length)) {
          setStatus(`Reading photos… ${metaDone}/${converted.length}`);
        }
        return { file, ...meta };
      });

      const entries: NewPhotoEntry[] = withMeta;
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
        className="border-2 border-dashed border-rose-300 bg-white rounded-2xl p-5 text-center cursor-pointer hover:border-rose-400 hover:bg-rose-50 transition-colors"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          handleFiles(Array.from(e.dataTransfer.files));
        }}
      >
        {processing ? (
          <div className="w-7 h-7 mx-auto mb-2 rounded-full border-4 border-rose-200 border-t-rose-400 animate-spin" />
        ) : (
          <div className="text-2xl mb-1">🖼️</div>
        )}
        {processing ? (
          <p className="text-stone-500 font-medium">{status ?? 'Reading your photos…'}</p>
        ) : (
          <>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                inputRef.current?.click();
              }}
              className="text-sm font-semibold bg-rose-400 hover:bg-rose-500 text-white px-4 py-2 rounded-full shadow-sm hover:shadow-md transition-all mb-1.5"
            >
              📁 Choose photos
            </button>
            <p className="text-stone-400 text-xs">or drag and drop them here</p>
            <p className="text-stone-300 text-xs mt-1">
              Uploading a big batch (100+ at once)? Use "Choose photos" — dragging that many at
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
      </div>

      {!processing && status && <p className="text-xs text-stone-400 mt-2">{status}</p>}
    </div>
  );
}
