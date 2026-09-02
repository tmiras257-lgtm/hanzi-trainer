import strokeIndex from '../data/strokeIndex.json';

export interface StrokeData {
  strokes: string[];
  medians: number[][][];
}

type Index = { chunks: number; index: Record<string, number> };
const meta = strokeIndex as Index;

const cache = new Map<string, StrokeData>();
const inflight = new Map<number, Promise<void>>();

const chunkUrl = (n: number) => `${import.meta.env.BASE_URL}strokes/chunk-${n}.json`;

async function loadChunk(n: number): Promise<void> {
  let p = inflight.get(n);
  if (!p) {
    p = fetch(chunkUrl(n))
      .then((r) => {
        if (!r.ok) throw new Error(`chunk ${n}: ${r.status}`);
        return r.json();
      })
      .then((data: Record<string, StrokeData>) => {
        for (const [ch, d] of Object.entries(data)) cache.set(ch, d);
      })
      .catch((e) => {
        inflight.delete(n);
        throw e;
      });
    inflight.set(n, p);
  }
  return p;
}

export function peekStroke(c: string): StrokeData | undefined {
  return cache.get(c);
}

export async function getStroke(c: string): Promise<StrokeData> {
  const hit = cache.get(c);
  if (hit) return hit;
  const chunk = meta.index[c];
  if (chunk === undefined) throw new Error(`no stroke data for ${c}`);
  await loadChunk(chunk);
  const data = cache.get(c);
  if (!data) throw new Error(`stroke data missing after load: ${c}`);
  return data;
}

/** Warms the chunks a set of characters lives in, so the writer never stalls mid-session. */
export async function prefetch(chars: string[]): Promise<void> {
  const chunks = new Set<number>();
  for (const c of chars) {
    if (cache.has(c)) continue;
    const n = meta.index[c];
    if (n !== undefined) chunks.add(n);
  }
  await Promise.all([...chunks].map((n) => loadChunk(n).catch(() => {})));
}

/** Pulls every chunk into the HTTP cache so the app keeps working offline. */
export async function prefetchAll(): Promise<void> {
  for (let n = 0; n < meta.chunks; n++) {
    try {
      await loadChunk(n);
    } catch {
      return;
    }
  }
}
