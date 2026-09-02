import { useEffect, useMemo, useRef, useState } from 'react';
import HanziWriter from 'hanzi-writer';
import type { StrokeData } from '../lib/strokes';
import { strokesLabel } from '../lib/format';

export type WriterMode = 'animate' | 'trace' | 'quiz';

export interface WriteResult {
  mistakes: number;
  hintUsed: boolean;
  revealed: boolean;
}

interface Props {
  char: string;
  data: StrokeData;
  mode: WriterMode;
  size?: number;
  onDone?: (r: WriteResult) => void;
  /** Bumping this restarts the exercise. */
  attempt?: number;
}

const COLORS = {
  stroke: '#e9eef1',
  outline: '#39444b',
  radical: '#e9eef1',
  drawing: '#5ad1a8',
  highlight: '#f0b429',
};

export default function Writer({ char, data, mode, size = 380, onDone, attempt = 0 }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const writer = useRef<HanziWriter | null>(null);
  const finished = useRef(false);

  const [strokeIdx, setStrokeIdx] = useState(0);
  const [mistakes, setMistakes] = useState(0);
  const [playing, setPlaying] = useState(false);
  // Whether a hint was used. A ref, not state: the quiz callbacks read it while
  // grading, and nothing in the render output depends on it.
  const hintRef = useRef(false);

  const total = data.strokes.length;
  // hanzi-writer mutates the data it is handed, so give every instance its own copy.
  const charData = useMemo(() => JSON.parse(JSON.stringify(data)), [data, attempt]);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    el.innerHTML = '';
    finished.current = false;
    hintRef.current = false;
    setStrokeIdx(0);
    setMistakes(0);

    const w = HanziWriter.create(el, char, {
      width: size,
      height: size,
      padding: 12,
      showOutline: mode !== 'quiz',
      showCharacter: mode === 'animate',
      strokeColor: COLORS.stroke,
      outlineColor: COLORS.outline,
      radicalColor: COLORS.radical,
      drawingColor: COLORS.drawing,
      highlightColor: COLORS.highlight,
      drawingWidth: 22,
      strokeAnimationSpeed: 1,
      delayBetweenStrokes: 180,
      leniency: mode === 'trace' ? 1.35 : 1.05,
      showHintAfterMisses: mode === 'trace' ? 2 : 4,
      highlightOnComplete: true,
      charDataLoader: (_c, onLoad) => onLoad(charData),
    });
    writer.current = w;

    if (mode === 'animate') {
      setPlaying(true);
      w.animateCharacter({ onComplete: () => setPlaying(false) });
    } else {
      let local = 0;
      w.quiz({
        onCorrectStroke: () => {
          local += 1;
          setStrokeIdx(local);
        },
        onMistake: () => setMistakes((m) => m + 1),
        onComplete: ({ totalMistakes }) => {
          if (finished.current) return;
          finished.current = true;
          onDone?.({ mistakes: totalMistakes, hintUsed: hintRef.current, revealed: false });
        },
      });
    }

    return () => {
      try {
        w.cancelQuiz();
      } catch {
        /* instance already torn down */
      }
      el.innerHTML = '';
      writer.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [char, mode, attempt, size]);

  const replay = () => {
    const w = writer.current;
    if (!w || mode !== 'animate') return;
    setPlaying(true);
    w.animateCharacter({ onComplete: () => setPlaying(false) });
  };

  const hint = () => {
    const w = writer.current;
    if (!w) return;
    hintRef.current = true;
    w.highlightStroke(strokeIdx);
  };

  const reveal = () => {
    if (finished.current) return;
    finished.current = true;
    writer.current?.cancelQuiz();
    writer.current?.showCharacter();
    onDone?.({ mistakes, hintUsed: hintRef.current, revealed: true });
  };

  return (
    <div className="writer">
      <div className="writer-pad" data-char={char} style={{ width: size, height: size }}>
        <GridBackdrop size={size} />
        <div ref={host} className="writer-host" />
      </div>

      {mode === 'animate' ? (
        <div className="writer-bar">
          <button className="btn ghost" onClick={replay} disabled={playing}>
            {playing ? 'Играет…' : '↻ Показать ещё раз'}
          </button>
          <span className="writer-meta">{strokesLabel(total)}</span>
        </div>
      ) : (
        <div className="writer-bar">
          <span className="writer-meta">
            Черта <b>{Math.min(strokeIdx + 1, total)}</b> из {total}
            {mistakes > 0 && <span className="writer-miss"> · ошибок: {mistakes}</span>}
          </span>
          <span className="spacer" />
          <button className="btn ghost sm" onClick={hint}>
            Подсказать черту
          </button>
          <button className="btn ghost sm" onClick={reveal}>
            Не помню
          </button>
        </div>
      )}
    </div>
  );
}

/** 米字格 — the guide grid Chinese handwriting practice sheets use. */
function GridBackdrop({ size }: { size: number }) {
  return (
    <svg className="writer-grid" width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <rect x="0.5" y="0.5" width="99" height="99" rx="3" className="grid-frame" />
      <line x1="50" y1="0" x2="50" y2="100" className="grid-line" />
      <line x1="0" y1="50" x2="100" y2="50" className="grid-line" />
      <line x1="0" y1="0" x2="100" y2="100" className="grid-line faint" />
      <line x1="100" y1="0" x2="0" y2="100" className="grid-line faint" />
    </svg>
  );
}
