// Turns a caption into a safe file name, falling back to a numbered name when there's no
// caption — used wherever a photo gets exported (zip download, shareable page) so a photo
// captioned "Fishing with Dad" saves to disk as that instead of a random ID or bare index.
const ILLEGAL_CHARS = /[/\\?%*:|"<>]/g;
const MAX_LENGTH = 80;

export function photoFilename(note: string, fallbackBase: string, index: number, ext: string): string {
  const cleaned = note.trim().replace(ILLEGAL_CHARS, '').replace(/\s+/g, ' ').slice(0, MAX_LENGTH).trim();
  const base = cleaned || `${fallbackBase}-${index}`;
  return `${base}.${ext}`;
}
