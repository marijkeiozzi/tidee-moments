// "Save space" (phones): during the sort, each photo's stored copy is swapped for a print-quality
// one. A 12-megapixel phone photo (4032 x 3024) becomes 3200 x 2400 — 300 dpi on an 8 x 10 in
// (20 x 25 cm) print — at high JPEG quality, roughly a third to a half of the bytes. Done in the
// sort, from the decode it already makes, so adding photos stays as fast as before. Smaller
// photos (screenshots, WhatsApp images) and anything that wouldn't come out smaller are kept
// exactly as they are.
//
// Re-encoding drops the original EXIF, so a small one is written back: the date taken (so the
// photo lands on the right day when imported anywhere else) and the camera make/model.
// Rotation is already applied to the pixels.
import { parse } from 'exifr';
import { isMobileDevice } from './concurrency';

export const PRINT_MAX_SIDE = 3200;
const JPEG_QUALITY = 0.9;

export interface ShrinkInfo {
  capturedAt: number;
  cameraMake?: string;
  cameraModel?: string;
}

const SAVE_SPACE_KEY = 'tidee:saveSpace';

export function getSaveSpace(): boolean {
  try {
    return localStorage.getItem(SAVE_SPACE_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setSaveSpace(on: boolean) {
  try {
    localStorage.setItem(SAVE_SPACE_KEY, on ? 'on' : 'off');
  } catch {
    // Not remembered — defaults back to on next visit.
  }
}

function canvasToJpeg(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
}

// Phones only: storage space is tightest there. Computers keep full-size originals.
export function saveSpaceActive(): boolean {
  return isMobileDevice() && getSaveSpace();
}

// Whether a stored photo is worth re-encoding: PNG/GIF are usually screenshots or graphics —
// small already, and JPEG would blur their text.
export function canShrink(blob: Blob): boolean {
  return blob.type !== 'image/png' && blob.type !== 'image/gif';
}

// Encodes the sort's print-size canvas, with the date and camera written back in. Returns null
// when it wouldn't save anything.
export async function encodePrintCopy(print: HTMLCanvasElement, original: Blob, capturedAt: number): Promise<Blob | null> {
  const jpeg = await canvasToJpeg(print);
  if (!jpeg || jpeg.size >= original.size * 0.9) return null;
  let cameraMake: string | undefined;
  let cameraModel: string | undefined;
  try {
    const exif = await parse(original, { pick: ['Make', 'Model'] });
    if (typeof exif?.Make === 'string') cameraMake = exif.Make;
    if (typeof exif?.Model === 'string') cameraModel = exif.Model;
  } catch {
    // No camera info to carry over.
  }
  const bytes = withExif(new Uint8Array(await jpeg.arrayBuffer()), { capturedAt, cameraMake, cameraModel });
  return new Blob([bytes], { type: 'image/jpeg' });
}

function exifDate(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}:${p(d.getMonth() + 1)}:${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// Builds a minimal little-endian EXIF block and puts it straight after the JPEG's start marker.
function withExif(jpeg: Uint8Array, info: ShrinkInfo): Uint8Array<ArrayBuffer> {
  const ascii = (s: string) => [...s.replace(/[^\x20-\x7e]/g, '').slice(0, 60)].map((c) => c.charCodeAt(0)).concat(0);
  const date = ascii(exifDate(info.capturedAt));
  type Entry = { tag: number; type: number; data: number[] }; // type 2 = ASCII, 3 = SHORT, 4 = LONG
  const ifd0: Entry[] = [];
  if (info.cameraMake) ifd0.push({ tag: 0x010f, type: 2, data: ascii(info.cameraMake) });
  if (info.cameraModel) ifd0.push({ tag: 0x0110, type: 2, data: ascii(info.cameraModel) });
  ifd0.push({ tag: 0x0112, type: 3, data: [1, 0] }); // Orientation: already upright
  ifd0.push({ tag: 0x0132, type: 2, data: date });
  ifd0.push({ tag: 0x8769, type: 4, data: [] }); // pointer to the Exif sub-IFD, filled below
  const exifIfd: Entry[] = [
    { tag: 0x9003, type: 2, data: date }, // DateTimeOriginal
    { tag: 0x9004, type: 2, data: date }, // CreateDate
  ];

  const ifdSize = (entries: Entry[]) => 2 + entries.length * 12 + 4;
  const extraSize = (entries: Entry[]) => entries.reduce((n, e) => n + (e.data.length > 4 ? e.data.length + (e.data.length % 2) : 0), 0);
  const ifd0Start = 8;
  const exifStart = ifd0Start + ifdSize(ifd0) + extraSize(ifd0);
  const tiffLength = exifStart + ifdSize(exifIfd) + extraSize(exifIfd);
  const tiff = new Uint8Array(tiffLength);
  const view = new DataView(tiff.buffer);
  tiff.set([0x49, 0x49, 0x2a, 0x00]);
  view.setUint32(4, ifd0Start, true);

  function writeIfd(entries: Entry[], start: number) {
    view.setUint16(start, entries.length, true);
    let extra = start + ifdSize(entries);
    entries.forEach((e, i) => {
      const at = start + 2 + i * 12;
      view.setUint16(at, e.tag, true);
      view.setUint16(at + 2, e.type, true);
      if (e.tag === 0x8769) {
        view.setUint32(at + 4, 1, true);
        view.setUint32(at + 8, exifStart, true);
      } else if (e.type === 2) {
        view.setUint32(at + 4, e.data.length, true);
        if (e.data.length <= 4) tiff.set(e.data, at + 8);
        else {
          view.setUint32(at + 8, extra, true);
          tiff.set(e.data, extra);
          extra += e.data.length + (e.data.length % 2);
        }
      } else {
        view.setUint32(at + 4, 1, true);
        tiff.set(e.data, at + 8);
      }
    });
    view.setUint32(start + 2 + entries.length * 12, 0, true); // no next IFD
  }
  writeIfd(ifd0, ifd0Start);
  writeIfd(exifIfd, exifStart);

  const header = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // "Exif\0\0"
  const segmentLength = 2 + header.length + tiff.length;
  const out = new Uint8Array(jpeg.length + 2 + segmentLength);
  out.set([0xff, 0xd8, 0xff, 0xe1, segmentLength >> 8, segmentLength & 0xff]);
  out.set(header, 6);
  out.set(tiff, 6 + header.length);
  out.set(jpeg.subarray(2), 6 + header.length + tiff.length);
  return out;
}
