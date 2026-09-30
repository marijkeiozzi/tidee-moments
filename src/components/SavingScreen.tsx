import type { Photo } from '../db/indexedDb';
import { usePhotoUrl } from '../hooks/usePhotoUrl';

interface SavingScreenProps {
  progress: { done: number; total: number; photo: Photo | null };
}

export default function SavingScreen({ progress }: SavingScreenProps) {
  const url = usePhotoUrl(progress.photo);
  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="flex flex-col items-center justify-center text-center py-16">
      {url && (
        <div className="bg-white p-2 pb-6 rounded-sm shadow-xl -rotate-2 mb-10 w-40 h-40">
          <img src={url} alt="" className="w-full h-full object-cover rounded-[2px]" />
        </div>
      )}
      <p className="font-serif text-6xl leading-none">
        {pct}
        <span className="text-2xl text-[#8A8177] align-top">%</span>
      </p>
      <p className="text-lg mt-6">Saving your album…</p>
      <p className="text-[#8A8177] text-sm mt-1">
        {progress.done} of {progress.total} photos
      </p>
      <div className="w-full max-w-sm h-1.5 bg-[#EFE9DD] rounded-full overflow-hidden mt-8">
        <div className="h-full bg-[#BB5133] transition-all" style={{ width: `${pct}%` }} />
      </div>
      <p className="text-[#A69C8E] text-sm mt-8">Keep this tab open until it finishes.</p>
    </div>
  );
}
