// Standalone verification of the first-year month slicing — no test runner is wired into this
// project, so this is executed directly with `npx tsx src/lib/firstYear.test.ts`.
import { addMonths, buildFirstYear, parseBirthDate, THIN_MONTH_MIN } from './firstYear';

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    pass++;
    console.log(`PASS  ${name}`);
  } else {
    fail++;
    console.error(`FAIL  ${name} ${detail}`);
  }
}

const day = 24 * 60 * 60 * 1000;
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime();

const birth = parseBirthDate('2025-01-31')!;
check('parses birth date as local midnight', birth === new Date(2025, 0, 31).getTime());
check('rejects malformed birth date', parseBirthDate('31/01/2025') === null);
check('Jan 31 + 1 month clamps to Feb 28', addMonths(birth, 1) === new Date(2025, 1, 28).getTime());
check('Jan 31 + 2 months is Mar 31', addMonths(birth, 2) === new Date(2025, 2, 31).getTime());
check('Jan 31 + 12 months is next Jan 31', addMonths(birth, 12) === new Date(2026, 0, 31).getTime());

const kept = [
  // Newborn month: enough photos.
  ...Array.from({ length: THIN_MONTH_MIN }, (_, i) => ({ id: `nb${i}`, capturedAt: at(2025, 2, 1 + i) })),
  // 1 month: just two.
  { id: 'one-a', capturedAt: at(2025, 3, 5) },
  { id: 'one-b', capturedAt: at(2025, 3, 6) },
  // First birthday party, two days after.
  { id: 'bday', capturedAt: at(2026, 2, 2) },
  // Before birth — belongs nowhere.
  { id: 'bump', capturedAt: at(2025, 1, 10) },
];
const unsorted = [{ id: 'u1', capturedAt: at(2025, 4, 10) }];

const slots = buildFirstYear(birth, kept, unsorted, at(2026, 6, 1));
check('13 slots (12 months + birthday)', slots.length === 13);
check('newborn month is good', slots[0].status === 'good' && slots[0].photoIds.length === THIN_MONTH_MIN);
check('1 month is thin', slots[1].status === 'thin' && slots[1].photoIds.join() === 'one-a,one-b');
check('2 months is missing but has an unsorted photo', slots[2].status === 'missing' && slots[2].unsortedCount === 1);
check('birthday slot catches the party', slots[12].photoIds.join() === 'bday' && slots[12].status === 'thin');
check('pre-birth photo is excluded', !slots.some((s) => s.photoIds.includes('bump')));

const midYear = buildFirstYear(birth, [], [], at(2025, 3, 10));
check('current month is in-progress', midYear[1].status === 'in-progress');
check('future months are upcoming, not missing', midYear[5].status === 'upcoming');
check('past empty month is missing', midYear[0].status === 'missing');

const boundary = buildFirstYear(birth, [{ id: 'edge', capturedAt: addMonths(birth, 1) }], [], at(2027, 1, 1));
check('photo at a month boundary lands in the later month', boundary[1].photoIds[0] === 'edge' && boundary[0].photoIds.length === 0);
check('birthday window closes after a week', buildFirstYear(birth, [{ id: 'late', capturedAt: addMonths(birth, 12) + 8 * day }], [], at(2027, 1, 1))[12].photoIds.length === 0);

console.log(`\n${pass}/${pass + fail} passed`);
if (fail > 0) process.exit(1);
