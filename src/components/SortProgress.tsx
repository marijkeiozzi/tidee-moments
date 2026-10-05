// One progress bar for both stages of bringing photos in — adding them (step 1) and sorting
// them (step 2) — so it looks like one continuous job. Shown the instant photos are chosen.
interface SortProgressProps {
  step: 1 | 2;
  title: string;
  done: number;
  total: number;
  note?: string;
}

export default function SortProgress({ step, title, done, total, note }: SortProgressProps) {
  const pct = total > 0 ? Math.min(100, (done / total) * 100) : 0;
  const starting = done === 0;
  return (
    <div className="w-full max-w-md mx-auto text-center" role="status" aria-live="polite">
      <p className="text-[#BB5133] text-xs font-semibold tracking-[0.2em] uppercase mb-2">Step {step} of 2</p>
      <p className="font-serif text-2xl sm:text-3xl text-[#231F1B] mb-4">{title}</p>
      <div className="h-2.5 bg-[#EFE9DD] rounded-full overflow-hidden">
        {starting ? (
          // Nothing finished yet (models loading, first photo being read) — a moving sliver so
          // it never looks frozen at 0%.
          <div className="h-full w-1/4 bg-[#BB5133]/70 rounded-full animate-[tidee-slide_1.2s_ease-in-out_infinite]" />
        ) : (
          <div className="h-full bg-[#BB5133] rounded-full transition-[width] duration-300 ease-out" style={{ width: `${pct}%` }} />
        )}
      </div>
      <p className="text-sm text-[#5B5349] mt-3 tabular-nums">
        {starting ? 'Getting ready…' : `${done.toLocaleString()} of ${total.toLocaleString()} photos`}
      </p>
      {note && <p className="text-xs text-[#A69C8E] mt-2 max-w-sm mx-auto">{note}</p>}
    </div>
  );
}
