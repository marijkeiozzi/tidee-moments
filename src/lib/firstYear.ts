// "First year by month" — slices photos into the 12 months after a baby's birth date (plus
// the first-birthday week) so a parent can see at a glance which months are well covered and
// which have nothing yet. Pure date math, no image analysis: a photo belongs to a month purely
// by its capturedAt.

// Fewer kept photos than this in a past month is flagged as "thin" — the advice is 5–10 per
// month for a printed first-year book.
export const THIN_MONTH_MIN = 5;

// The first birthday gets its own slot covering the birthday itself and the few days after,
// when the party usually happens.
const BIRTHDAY_WINDOW_DAYS = 7;

export type SlotStatus = 'good' | 'thin' | 'missing' | 'upcoming' | 'in-progress';

export interface FirstYearSlot {
  key: string;
  label: string;
  start: number;
  end: number; // exclusive
  status: SlotStatus;
  photoIds: string[];
  unsortedCount: number;
}

interface Dated {
  id: string;
  capturedAt: number;
}

// Adds whole calendar months, clamping to the month's last day — a baby born Jan 31 turns
// "1 month" on Feb 28/29, not Mar 3.
export function addMonths(ts: number, months: number): number {
  const d = new Date(ts);
  const day = d.getDate();
  const target = new Date(d.getFullYear(), d.getMonth() + months, 1, 0, 0, 0, 0);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(day, lastDay));
  return target.getTime();
}

// Local midnight of the given date string ("YYYY-MM-DD") — new Date("YYYY-MM-DD") parses as
// UTC, which would shift the birth day back by one for anyone west of Greenwich.
export function parseBirthDate(value: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

function monthLabel(n: number): string {
  if (n === 0) return 'Newborn';
  return `${n} month${n === 1 ? '' : 's'}`;
}

function statusFor(start: number, end: number, count: number, now: number): SlotStatus {
  if (start > now) return 'upcoming';
  if (end > now) return count >= THIN_MONTH_MIN ? 'good' : 'in-progress';
  if (count === 0) return 'missing';
  if (count < THIN_MONTH_MIN) return 'thin';
  return 'good';
}

export function buildFirstYear(birth: number, kept: Dated[], unsorted: Dated[], now = Date.now()): FirstYearSlot[] {
  const ranges: { key: string; label: string; start: number; end: number }[] = [];
  for (let n = 0; n < 12; n++) {
    ranges.push({ key: `m${n}`, label: monthLabel(n), start: addMonths(birth, n), end: addMonths(birth, n + 1) });
  }
  const birthday = addMonths(birth, 12);
  ranges.push({
    key: 'birthday',
    label: 'First birthday',
    start: birthday,
    end: birthday + BIRTHDAY_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  });

  const byCapture = (a: Dated, b: Dated) => a.capturedAt - b.capturedAt;
  const sortedKept = [...kept].sort(byCapture);

  return ranges.map((r) => {
    const photoIds = sortedKept.filter((p) => p.capturedAt >= r.start && p.capturedAt < r.end).map((p) => p.id);
    const unsortedCount = unsorted.filter((p) => p.capturedAt >= r.start && p.capturedAt < r.end).length;
    return { ...r, photoIds, unsortedCount, status: statusFor(r.start, r.end, photoIds.length, now) };
  });
}
