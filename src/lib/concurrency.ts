// Shared bounded-concurrency helpers — used everywhere a big batch of photos gets processed
// (upload, save, auto-sort) so a drop of thousands of photos runs in parallel waves sized to
// the device's actual CPU, instead of either choking the tab (unbounded) or crawling on a
// hardcoded low number regardless of hardware.

// navigator.hardwareConcurrency reports logical cores; capped well below that since each
// "worker" here can itself spin up canvas/WASM work, not just wait on I/O.
export function pickConcurrency(cap = 8): number {
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : undefined;
  return Math.max(2, Math.min(cap, cores ?? 4));
}

export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const idx = cursor++;
      results[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}
