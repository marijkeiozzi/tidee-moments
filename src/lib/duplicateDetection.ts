// Free, local near-duplicate detection via a difference hash (dHash) — no AI/API call.
// Each photo gets a coarse 64-bit fingerprint of its gradient pattern; near-identical
// fingerprints (small Hamming distance) mean the photos look alike, regardless of when
// they were taken — catching duplicates the time-based burst detector would miss.

export async function computeImageHash(source: Blob | ImageBitmap): Promise<bigint> {
  const bitmap = await createImageBitmap(source);
  try {
    const w = 9;
    const h = 8;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('no 2d context');
    ctx.drawImage(bitmap, 0, 0, w, h);

    const { data } = ctx.getImageData(0, 0, w, h);
    const gray = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) {
      gray[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
    }

    let hash = 0n;
    let bit = 0n;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w - 1; x++) {
        if (gray[y * w + x] > gray[y * w + x + 1]) hash |= 1n << bit;
        bit++;
      }
    }
    return hash;
  } finally {
    bitmap.close();
  }
}

// Classic SWAR bit-counting trick on a 32-bit int — dramatically faster than looping bit-by-bit
// over a BigInt. findDuplicateGroups calls this for every pair in the batch (O(n²) by nature),
// so for a batch of thousands of photos this function's speed matters a lot.
function popcount32(x: number): number {
  // Unsigned shifts throughout — BigInt.asIntN below can hand back a negative 32-bit value,
  // and a signed >> would sign-extend and corrupt the count.
  x = x - ((x >>> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  x = (x + (x >>> 4)) & 0x0f0f0f0f;
  return (x * 0x01010101) >>> 24;
}

export function hammingDistance(a: bigint, b: bigint): number {
  const x = a ^ b;
  const lo = Number(BigInt.asIntN(32, x)) | 0;
  const hi = Number(BigInt.asIntN(32, x >> 32n)) | 0;
  return popcount32(lo) + popcount32(hi);
}

const DUPLICATE_HAMMING_THRESHOLD = 8;

// Second opinion for a dHash match. The 64-bit dHash only sees a 9x8 grayscale outline, so two
// different photos with the same layout (same crib, same angle, different day or outfit) can
// land within the duplicate threshold. A real copy — re-saved, resized, sent through a
// messaging app — differs only slightly and *evenly* across the frame; a different moment
// differs a lot somewhere (the subject moved, changed clothes, someone walked in). So compare
// small colour thumbnails block by block and look at the worst block, after evening out
// overall brightness so a lightly edited copy still matches.
const THUMB_BLOCK = 4; // cells per block side; 24x24 thumbnail -> 6x6 blocks

export interface ThumbDifference {
  mean: number; // average per-channel difference, 0..255
  worstBlock: number; // biggest average difference in any one block, 0..255
}

export function thumbDifference(a: Uint8Array, b: Uint8Array, size: number): ThumbDifference {
  const luma = (t: Uint8Array) => {
    let sum = 0;
    for (let i = 0; i < t.length; i += 3) sum += 0.299 * t[i] + 0.587 * t[i + 1] + 0.114 * t[i + 2];
    return sum / (t.length / 3);
  };
  const gain = Math.min(1.4, Math.max(0.7, luma(a) / Math.max(1, luma(b))));
  const blocks = Math.ceil(size / THUMB_BLOCK);
  const blockSum = new Float64Array(blocks * blocks);
  const blockCount = new Uint32Array(blocks * blocks);
  let total = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 3;
      const d =
        (Math.abs(a[i] - Math.min(255, b[i] * gain)) +
          Math.abs(a[i + 1] - Math.min(255, b[i + 1] * gain)) +
          Math.abs(a[i + 2] - Math.min(255, b[i + 2] * gain))) /
        3;
      const blk = Math.floor(y / THUMB_BLOCK) * blocks + Math.floor(x / THUMB_BLOCK);
      blockSum[blk] += d;
      blockCount[blk]++;
      total += d;
    }
  }
  let worstBlock = 0;
  for (let k = 0; k < blockSum.length; k++) worstBlock = Math.max(worstBlock, blockSum[k] / Math.max(1, blockCount[k]));
  return { mean: total / (size * size), worstBlock };
}

// Union-find over pairwise Hamming distances — groups photos whose fingerprints are close
// enough to be near-duplicates. Returns only groups with more than one photo. When `verify` is
// given, a pair within the threshold is only linked if verify(i, j) also agrees.
export function findDuplicateGroups(
  hashes: { id: string; hash: bigint }[],
  threshold = DUPLICATE_HAMMING_THRESHOLD,
  verify?: (i: number, j: number) => boolean,
): string[][] {
  const n = hashes.length;
  const parent = Array.from({ length: n }, (_, i) => i);

  function find(x: number): number {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  }
  function union(a: number, b: number) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  }

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (hammingDistance(hashes[i].hash, hashes[j].hash) <= threshold && (!verify || verify(i, j))) union(i, j);
    }
  }

  const groups = new Map<number, string[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(hashes[i].id);
  }
  return Array.from(groups.values()).filter((g) => g.length > 1);
}
