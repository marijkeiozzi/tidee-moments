import { useState } from 'react';
import type { Photo } from '../db/indexedDb';
import { isMobileDevice } from '../lib/concurrency';
import { getSaveSpace, setSaveSpace } from '../lib/shrinkPhoto';
import PhotoThumbImage from './PhotoThumbImage';

// "1 Add photos → 2 Sort & review" across the top of the Sort tab.
export function StepHeader({ step, onBack }: { step: 1 | 2; onBack?: () => void }) {
  const item = (n: 1 | 2, label: string) => (
    <span className={`flex items-center gap-2 ${step === n ? 'text-[#231F1B] font-semibold' : 'text-[#A69C8E]'}`}>
      <span
        className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${
          step === n ? 'bg-[#BB5133] text-white' : step > n ? 'bg-[#F6DFCF] text-[#BB5133]' : 'bg-black/5 text-[#8A8177]'
        }`}
      >
        {step > n ? '✓' : n}
      </span>
      {label}
    </span>
  );
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
      {item(1, 'Add photos')}
      <span className="text-[#C9BFB1]" aria-hidden>
        →
      </span>
      {item(2, 'Sort & review')}
      {onBack && (
        <button onClick={onBack} className="ml-auto text-sm text-[#BB5133] hover:underline">
          ← Add more photos
        </button>
      )}
    </div>
  );
}

const PREVIEW_COUNT = 8;

// Between the two steps: how many photos are in, a peek at the latest ones, and the button that
// starts sorting.
export function ReadyToSort({ photos, onSort }: { photos: Photo[]; onSort: () => void }) {
  const count = photos.length;
  const latest = photos.slice(-PREVIEW_COUNT).reverse();
  const minutesPerThousand = isMobileDevice() ? 'several minutes' : 'a minute or two';
  return (
    <section className="bg-white border border-black/5 rounded-3xl p-5 sm:p-6 flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wider text-[#8A8177] font-semibold mb-1">Next step</p>
          <h2 className="font-serif text-3xl leading-tight">
            {count.toLocaleString()} photo{count === 1 ? '' : 's'} ready
          </h2>
        </div>
        <button
          onClick={onSort}
          className="text-base font-semibold bg-[#BB5133] hover:bg-[#A4462B] text-white px-7 py-3.5 rounded-full shadow-sm transition-colors"
        >
          Sort my photos →
        </button>
      </div>
      <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
        {latest.map((p) => (
          <div key={p.id} className="aspect-square rounded-xl overflow-hidden bg-[#F6F1E7]">
            <PhotoThumbImage photo={p} />
          </div>
        ))}
      </div>
      {isMobileDevice() && <SaveSpaceOption />}
      <p className="text-xs text-[#8A8177]">
        Got more? Add them above first and they'll all be sorted together. Sorting takes about {minutesPerThousand} per
        1,000 photos. Keep this page open while it runs.
      </p>
    </section>
  );
}

// Phones only (see shrinkPhoto.ts) — with the print-size disclaimer right next to the choice.
function SaveSpaceOption() {
  const [on, setOn] = useState(getSaveSpace);
  return (
    <label className="flex items-start gap-3 bg-[#FBF8F2] border border-black/5 rounded-2xl px-4 py-3 cursor-pointer">
      <input
        type="checkbox"
        checked={on}
        onChange={(e) => {
          setOn(e.target.checked);
          setSaveSpace(e.target.checked);
        }}
        className="mt-0.5 h-4 w-4 shrink-0 accent-[#BB5133]"
      />
      <span className="text-xs leading-relaxed text-[#5B5349]">
        <strong className="text-sm font-semibold text-[#231F1B]">Save space on this phone</strong>
        <br />
        While sorting, each photo is stored at print quality: up to 3200 pixels on the longest side (about 8
        megapixels), enough for sharp prints up to 8×10 in (20×25 cm), in about a third to half the space. Your
        originals in your camera roll are never changed. Downloads and backups contain the stored version, so untick
        this before sorting if you want full-size copies for larger prints.
      </span>
    </label>
  );
}
