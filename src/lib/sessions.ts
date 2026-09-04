import type { Photo } from '../db/indexedDb';

export interface PhotoSession {
  id: string;
  dateTimeLabel: string;
  photoIds: string[];
  startAt: number;
  endAt: number;
}

// A gap of an hour or more between consecutive shots marks a new session.
const SESSION_GAP_MS = 60 * 60 * 1000;

export function formatCount(count: number): string {
  return `${count} photo${count === 1 ? '' : 's'}`;
}

function formatDateTimeLabel(startAt: number, endAt: number): string {
  const start = new Date(startAt);
  const end = new Date(endAt);
  const dateStr = start.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const startTime = start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const endTime = end.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const timeRange = startTime === endTime ? startTime : `${startTime}–${endTime}`;
  return `${dateStr} · ${timeRange}`;
}

export function groupIntoSessions(photos: Photo[]): PhotoSession[] {
  const realPhotos = photos.filter((p) => !p.isScreenshot);
  if (realPhotos.length === 0) return [];

  const sorted = [...realPhotos].sort((a, b) => a.capturedAt - b.capturedAt);
  const sessions: PhotoSession[] = [];
  let current: Photo[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i].capturedAt - sorted[i - 1].capturedAt;
    if (gap > SESSION_GAP_MS) {
      sessions.push(buildSession(current));
      current = [sorted[i]];
    } else {
      current.push(sorted[i]);
    }
  }
  sessions.push(buildSession(current));

  return sessions;
}

// A reasonable default album name from a batch of photos' capture dates — e.g. "July 2026",
// "Jul–Sep 2026" for a batch spanning a few months, or "Jul 2025 – Sep 2026" across years.
// Always editable by the user; this just saves typing a name from scratch.
export function suggestAlbumName(photos: Photo[]): string {
  if (photos.length === 0) return '';

  const times = photos.map((p) => p.capturedAt);
  const earliest = new Date(Math.min(...times));
  const latest = new Date(Math.max(...times));

  const sameMonth = earliest.getFullYear() === latest.getFullYear() && earliest.getMonth() === latest.getMonth();
  if (sameMonth) {
    return earliest.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  }

  const sameYear = earliest.getFullYear() === latest.getFullYear();
  if (sameYear) {
    const startMonth = earliest.toLocaleDateString(undefined, { month: 'short' });
    const endMonth = latest.toLocaleDateString(undefined, { month: 'short' });
    return `${startMonth}–${endMonth} ${earliest.getFullYear()}`;
  }

  const start = earliest.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
  const end = latest.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
  return `${start} – ${end}`;
}

export interface DayGroup {
  dayKey: string;
  label: string;
  photos: Photo[];
}

// Splits a batch into one group per calendar day (by capture date), each with a full date
// name ("March 16, 2023") — used to offer "one album per day" instead of a single combined
// album when a confirmed batch spans more than one day, so a big backlog sort doesn't dump
// weeks of unrelated days into one giant album.
export function groupPhotosByDay(photos: Photo[]): DayGroup[] {
  const groups = new Map<string, Photo[]>();
  for (const p of photos) {
    const d = new Date(p.capturedAt);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(p);
  }
  return Array.from(groups.entries())
    .map(([dayKey, dayPhotos]) => ({
      dayKey,
      label: new Date(dayPhotos[0].capturedAt).toLocaleDateString(undefined, {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      }),
      photos: dayPhotos,
    }))
    .sort((a, b) => a.photos[0].capturedAt - b.photos[0].capturedAt);
}

// Same idea as groupPhotosByDay, but by calendar month ("January 2026") — a middle ground
// between one giant album and one-per-day, for someone who wants roughly "this month's photos"
// as their own album without splitting all the way down to individual days.
export function groupPhotosByMonth(photos: Photo[]): DayGroup[] {
  const groups = new Map<string, Photo[]>();
  for (const p of photos) {
    const d = new Date(p.capturedAt);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(p);
  }
  return Array.from(groups.entries())
    .map(([dayKey, monthPhotos]) => ({
      dayKey,
      label: new Date(monthPhotos[0].capturedAt).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
      photos: monthPhotos,
    }))
    .sort((a, b) => a.photos[0].capturedAt - b.photos[0].capturedAt);
}

function buildSession(photos: Photo[]): PhotoSession {
  const startAt = photos[0].capturedAt;
  const endAt = photos[photos.length - 1].capturedAt;
  return {
    id: `session-${startAt}`,
    dateTimeLabel: formatDateTimeLabel(startAt, endAt),
    photoIds: photos.map((p) => p.id),
    startAt,
    endAt,
  };
}
