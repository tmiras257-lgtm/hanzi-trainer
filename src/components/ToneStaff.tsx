/**
 * The tone staff — five levels, after the Chao tone-letter notation where a
 * tone is written as a line against a 1-5 pitch scale (55 flat high, 35 rising,
 * 214 dipping, 51 falling).
 *
 * The same scale places the ideal shape and the measured voice, so the two are
 * directly comparable: one line over another, not two charts side by side.
 * Levels are labelled on the left, and every label names a level the scale
 * actually reaches.
 */

import { useId } from 'react';
import { TONE_TEMPLATES } from '../lib/pitch';
import type { Tone } from '../lib/pinyin';

/** Semitones spanned by the staff, top to bottom. Templates live inside ±5. */
const ST_MAX = 6;

export type StaffSize = 'glyph' | 'inline' | 'full';

const DIMS: Record<StaffSize, { w: number; h: number; padX: number; padY: number; labels: boolean }> = {
  glyph:  { w: 42,  h: 26,  padX: 2,  padY: 3,  labels: false },
  inline: { w: 180, h: 76,  padX: 16, padY: 8,  labels: true },
  full:   { w: 320, h: 150, padX: 22, padY: 12, labels: true },
};

function path(shape: number[], w: number, h: number, padX: number, padY: number): string {
  if (shape.length < 2) return '';
  const x = (i: number) => padX + (i / (shape.length - 1)) * (w - padX * 2);
  const y = (st: number) => {
    const clamped = Math.max(-ST_MAX, Math.min(ST_MAX, st));
    return padY + ((ST_MAX - clamped) / (ST_MAX * 2)) * (h - padY * 2);
  };
  return shape.map((st, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(st).toFixed(1)}`).join(' ');
}

interface Props {
  /** Ideal shape to draw. Omit to show only the voice. */
  tone?: Tone | null;
  /** Measured contour in zero-meaned semitones, from classifyTone(). */
  voice?: number[] | null;
  /** Colour the voice line by this tone instead of the accent. */
  voiceTone?: Tone | null;
  size?: StaffSize;
  /** Draw the ideal shape at full strength rather than as a reference. */
  solo?: boolean;
  label?: string;
}

export default function ToneStaff({ tone, voice, voiceTone, size = 'inline', solo = false, label }: Props) {
  const { w, h, padX, padY, labels } = DIMS[size];
  const id = useId();

  // Five evenly spaced levels across the same semitone domain as the curves.
  const levels = [0, 1, 2, 3, 4].map((i) => {
    const st = ST_MAX - (i / 4) * (ST_MAX * 2);
    const y = padY + ((ST_MAX - st) / (ST_MAX * 2)) * (h - padY * 2);
    return { level: 5 - i, y };
  });

  const ideal = tone && tone !== 5 ? TONE_TEMPLATES[tone] : null;
  const hasVoice = Boolean(voice && voice.length > 1);

  return (
    <svg
      className={`staff ${tone ? `tone-${tone}` : ''}`}
      viewBox={`0 0 ${w} ${h}`}
      width={w}
      height={h}
      role="img"
      aria-labelledby={`${id}-t`}
      preserveAspectRatio="xMidYMid meet"
    >
      <title id={`${id}-t`}>
        {label ?? (tone ? `Тон ${tone}${hasVoice ? ' и контур твоего голоса' : ''}` : 'Контур голоса')}
      </title>

      {levels.map((l) => (
        <line
          key={l.level}
          className={`staff-line ${l.level === 1 || l.level === 5 ? 'edge' : ''}`}
          x1={padX}
          x2={w - padX}
          y1={l.y}
          y2={l.y}
          strokeDasharray={l.level === 1 || l.level === 5 ? undefined : '2 3'}
        />
      ))}

      {labels &&
        levels.map((l) => (
          <text key={l.level} className="staff-label" x={padX - 5} y={l.y + 3} textAnchor="end">
            {l.level}
          </text>
        ))}

      {ideal && <path className={`staff-target ${solo ? 'solo' : ''}`} d={path(ideal, w, h, padX, padY)} />}
      {hasVoice && (
        <path
          className={`staff-voice ${voiceTone ? `tone-${voiceTone}` : ''}`}
          style={voiceTone ? undefined : { stroke: 'var(--accent)' }}
          d={path(voice as number[], w, h, padX, padY)}
        />
      )}
    </svg>
  );
}
