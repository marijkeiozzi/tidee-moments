import type { Photo } from '../db/indexedDb';
import { usePhotoUrl } from '../hooks/usePhotoUrl';
import { formatCount, type PhotoSession } from '../lib/sessions';

interface SessionListProps {
  sessions: { session: PhotoSession; remaining: number; previewPhoto: Photo | undefined }[];
  screenshotCount: number;
  screenshotsPreviewPhoto: Photo | undefined;
  onOpenSession: (session: PhotoSession) => void;
  onOpenScreenshots: () => void;
  onSortAll: () => void;
  onGoToAlbums: () => void;
}

export default function SessionList({
  sessions,
  screenshotCount,
  screenshotsPreviewPhoto,
  onOpenSession,
  onOpenScreenshots,
  onSortAll,
  onGoToAlbums,
}: SessionListProps) {
  if (sessions.length === 0 && screenshotCount === 0) {
    return (
      <div className="flex flex-col items-start gap-2">
        <p className="text-stone-400">Upload some photos above to get started 🌱</p>
        <button onClick={onGoToAlbums} className="text-sm text-rose-400 font-medium hover:underline">
          📁 Or view photos you've already sorted →
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm text-stone-500">
          {sessions.length} bundle{sessions.length === 1 ? '' : 's'} to tidee up
        </p>
        {sessions.length > 1 && (
          <button onClick={onSortAll} className="text-xs text-rose-400 font-medium hover:underline">
            Tidee up everything at once
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {sessions.map(({ session, remaining, previewPhoto }) => (
          <BundleCard
            key={session.id}
            photo={previewPhoto}
            title={session.dateTimeLabel}
            subtitle={formatCount(remaining)}
            onClick={() => onOpenSession(session)}
          />
        ))}

        {screenshotCount > 0 && (
          <BundleCard
            photo={screenshotsPreviewPhoto}
            title="Screenshots"
            subtitle={`${formatCount(screenshotCount)} · kept separate`}
            muted
            onClick={onOpenScreenshots}
          />
        )}
      </div>
    </div>
  );
}

interface BundleCardProps {
  photo: Photo | undefined;
  title: string;
  subtitle: string;
  muted?: boolean;
  onClick: () => void;
}

function BundleCard({ photo, title, subtitle, muted, onClick }: BundleCardProps) {
  const url = usePhotoUrl(photo);

  return (
    <button
      onClick={onClick}
      className="group relative aspect-[3/4] rounded-2xl overflow-hidden shadow-sm hover:shadow-lg hover:-translate-y-0.5 transition-all"
    >
      {url ? (
        <img src={url} alt="" className="absolute inset-0 w-full h-full object-cover" />
      ) : (
        <div
          className={`absolute inset-0 ${muted ? 'bg-stone-200' : 'bg-gradient-to-br from-rose-100 to-rose-100'} flex items-center justify-center text-4xl`}
        >
          {muted ? '📱' : '📷'}
        </div>
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-transparent" />
      <div className="absolute bottom-0 left-0 right-0 p-3 text-left">
        <p className="text-white font-semibold text-sm leading-tight drop-shadow-sm">{title}</p>
        <p className="text-white/85 text-xs">{subtitle}</p>
      </div>
      <div className="absolute inset-0 ring-0 group-hover:ring-4 ring-rose-300/60 rounded-2xl transition-all" />
    </button>
  );
}
