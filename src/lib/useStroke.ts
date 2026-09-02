import { useEffect, useState } from 'react';
import { getStroke, peekStroke, type StrokeData } from './strokes';

export function useStroke(char: string | null): { data: StrokeData | null; error: string | null } {
  const [data, setData] = useState<StrokeData | null>(() => (char ? peekStroke(char) ?? null : null));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!char) {
      setData(null);
      return;
    }
    const hit = peekStroke(char);
    if (hit) {
      setData(hit);
      setError(null);
      return;
    }
    let alive = true;
    setData(null);
    setError(null);
    getStroke(char)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(String(e.message ?? e)));
    return () => {
      alive = false;
    };
  }, [char]);

  return { data, error };
}
