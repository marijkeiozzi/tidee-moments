// Standalone checks for the export helpers — no test runner is wired into this project, so this
// is executed directly with `npx tsx src/lib/exportAlbum.test.ts`.
import type { Photo } from '../db/indexedDb';
import { exportFileName, planZipParts, safeFileName, sortChronologically } from './exportAlbum';

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

const photo = (id: string, capturedAt: number, bytes: number, note = ''): Photo => ({
  id,
  blob: new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }),
  createdAt: 0,
  capturedAt,
  status: 'kept',
  albumId: null,
  analysis: null,
  note,
  isScreenshot: false,
});

check('slashes become dashes', safeFileName('Trip: day 1/2') === 'Trip day 1-2', safeFileName('Trip: day 1/2'));
check('illegal characters removed', safeFileName('a*b?c"d<e>f|g') === 'abcdefg');
check('empty name falls back', safeFileName('  ::  ') === 'Photos');
check('trailing dots/spaces trimmed (Windows)', safeFileName('Summer...  ') === 'Summer');
check('long names capped', safeFileName('x'.repeat(200)).length === 80);

const p1 = photo('a', 1000, 10, 'Fishing with Dad');
check('caption used, numbered', exportFileName(p1, 'Album', 0, 12, 'jpg') === '001 Fishing with Dad.jpg', exportFileName(p1, 'Album', 0, 12, 'jpg'));
check('no caption falls back to album title', exportFileName(photo('b', 0, 1), 'Mila 1/2', 4, 12, 'jpg') === '005 Mila 1-2.jpg');
check('numbering widens for big albums', exportFileName(photo('c', 0, 1), 'A', 9, 12000, 'jpg') === '00010 A.jpg');

const unordered = [photo('late', 3000, 1), photo('early', 1000, 1), photo('mid', 2000, 1)];
check('sorted oldest first', sortChronologically(unordered).map((p) => p.id).join() === 'early,mid,late');

const parts = planZipParts([photo('1', 1, 40), photo('2', 2, 40), photo('3', 3, 40), photo('4', 4, 100)], 100);
check('split into parts under the size cap', parts.map((p) => p.map((x) => x.id).join('')).join('|') === '12|3|4', parts.map((p) => p.map((x) => x.id).join('')).join('|'));
check('one oversized photo still gets its own part', planZipParts([photo('big', 1, 500)], 100).length === 1);
check('small album is one part', planZipParts(unordered, 100).length === 1);

console.log(`\n${pass}/${pass + fail} passed`);
if (fail > 0) process.exit(1);
