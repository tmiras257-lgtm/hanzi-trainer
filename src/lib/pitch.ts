/**
 * Microphone pitch tracking and tone classification.
 *
 * The old version of this app checked pronunciation with the Web Speech API,
 * which returns a word-level transcript and nothing else. That cannot judge a
 * tone: a wrong tone usually still transcribes to the character you aimed for,
 * and Chrome streams the audio to a remote service, so it also needs a network.
 *
 * This module measures the thing that actually carries the tone — the pitch
 * contour of the syllable. Fundamental frequency comes from the McLeod pitch
 * method (a normalised square difference function with parabolic refinement),
 * computed locally on raw microphone samples. Nothing leaves the machine.
 *
 * Register varies by speaker and by time of day, so the contour is converted to
 * semitones relative to the median of the utterance and compared by shape only.
 */

import type { Tone } from './pinyin';

/** Human speech, generously bounded: roughly E1 to B4. */
const MIN_HZ = 65;
const MAX_HZ = 500;

/** Below this the frame is treated as silence rather than a very quiet voice. */
const SILENCE_RMS = 0.008;

/** NSDF peak height, relative to the strongest peak, needed to accept a lag. */
const CLARITY_FLOOR = 0.62;

export interface PitchFrame {
  /** Milliseconds since the take started. */
  t: number;
  hz: number;
  /** NSDF peak height, 0..1. Higher means a more clearly periodic frame. */
  clarity: number;
  rms: number;
}

/**
 * Normalised square difference function, McLeod & Wyvill.
 *
 *   n(tau) = 2 * sum(x[i] * x[i+tau]) / sum(x[i]^2 + x[i+tau]^2)
 *
 * Unlike plain autocorrelation this is bounded to [-1, 1] and does not fall off
 * as the lag grows, so a simple threshold on peak height is meaningful.
 */
function nsdf(buf: Float32Array<ArrayBufferLike>, minLag: number, maxLag: number): Float32Array {
  const w = buf.length;
  const out = new Float32Array(maxLag + 1);
  for (let tau = minLag; tau <= maxLag; tau++) {
    let acf = 0;
    let norm = 0;
    const n = w - tau;
    for (let i = 0; i < n; i++) {
      const a = buf[i];
      const b = buf[i + tau];
      acf += a * b;
      norm += a * a + b * b;
    }
    out[tau] = norm > 0 ? (2 * acf) / norm : 0;
  }
  return out;
}

/** Refine an integer peak to sub-sample precision through its two neighbours. */
function parabolic(d: Float32Array, i: number): number {
  const prev = d[i - 1] ?? d[i];
  const next = d[i + 1] ?? d[i];
  const denom = 2 * (2 * d[i] - prev - next);
  if (denom === 0) return i;
  return i + (next - prev) / denom;
}

export function detectPitch(buf: Float32Array<ArrayBufferLike>, sampleRate: number): { hz: number; clarity: number; rms: number } {
  let sumSq = 0;
  for (let i = 0; i < buf.length; i++) sumSq += buf[i] * buf[i];
  const rms = Math.sqrt(sumSq / buf.length);
  if (rms < SILENCE_RMS) return { hz: 0, clarity: 0, rms };

  const minLag = Math.max(2, Math.floor(sampleRate / MAX_HZ));
  const maxLag = Math.min(buf.length - 2, Math.ceil(sampleRate / MIN_HZ));
  if (maxLag <= minLag) return { hz: 0, clarity: 0, rms };

  const d = nsdf(buf, minLag, maxLag);

  // Key maxima: the highest point of each hump that rises above zero.
  const peaks: number[] = [];
  let tau = minLag;
  while (tau < maxLag && d[tau] > 0) tau++; // skip the hump around lag 0
  while (tau < maxLag) {
    if (d[tau] > 0 && d[tau] >= d[tau - 1] && d[tau] >= d[tau + 1]) {
      peaks.push(tau);
      while (tau < maxLag && d[tau] > 0) tau++;
    }
    tau++;
  }
  if (!peaks.length) return { hz: 0, clarity: 0, rms };

  // Take the earliest peak that is nearly as tall as the tallest. Picking the
  // tallest outright tends to land an octave low on breathy voices.
  let best = peaks[0];
  for (const p of peaks) if (d[p] > d[best]) best = p;
  const threshold = CLARITY_FLOOR * d[best];
  const chosen = peaks.find((p) => d[p] >= threshold) ?? best;

  const hz = sampleRate / parabolic(d, chosen);
  if (!Number.isFinite(hz) || hz < MIN_HZ || hz > MAX_HZ) return { hz: 0, clarity: 0, rms };
  return { hz, clarity: d[chosen], rms };
}

export type MicError = 'denied' | 'no-device' | 'insecure' | 'unsupported' | 'failed';

export function micErrorFrom(e: unknown): MicError {
  const name = (e as { name?: string })?.name ?? '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'no-device';
  return 'failed';
}

export const MIC_MESSAGES: Record<MicError, string> = {
  denied:
    'Браузер не дал доступ к микрофону. Нажми на замок слева от адреса и разреши микрофон для этого сайта.',
  'no-device': 'Микрофон не найден. Проверь, что он подключён и выбран в настройках системы.',
  insecure: 'Микрофон работает только на https. Открой сайт по https-ссылке.',
  unsupported: 'Этот браузер не даёт доступ к микрофону. Нужен Chrome, Edge или Safari посвежее.',
  failed: 'Не удалось включить микрофон. Закрой другие приложения, которые могут его занимать.',
};

export function micAvailable(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    typeof window !== 'undefined' &&
    Boolean(window.AudioContext ?? (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext)
  );
}

/**
 * Streams pitch frames from the microphone until stopped.
 *
 * Echo cancellation and noise suppression are turned off: they are tuned for
 * speech intelligibility and will happily reshape the pitch track.
 */
export class PitchTracker {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private raf = 0;
  private startedAt = 0;
  private buf: Float32Array<ArrayBuffer> = new Float32Array(0);

  readonly frames: PitchFrame[] = [];

  async start(onFrame?: (f: PitchFrame) => void): Promise<void> {
    if (!micAvailable()) {
      if (typeof window !== 'undefined' && !window.isSecureContext) throw Object.assign(new Error('insecure'), { name: 'SecurityError' });
      throw Object.assign(new Error('unsupported'), { name: 'UnsupportedError' });
    }

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });

    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctor();
    if (this.ctx.state === 'suspended') await this.ctx.resume();

    const source = this.ctx.createMediaStreamSource(this.stream);
    const analyser = this.ctx.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);

    this.buf = new Float32Array(analyser.fftSize);
    this.startedAt = performance.now();
    this.frames.length = 0;

    const tick = () => {
      if (!this.ctx) return;
      analyser.getFloatTimeDomainData(this.buf);
      const { hz, clarity, rms } = detectPitch(this.buf, this.ctx.sampleRate);
      const frame: PitchFrame = { t: performance.now() - this.startedAt, hz, clarity, rms };
      this.frames.push(frame);
      onFrame?.(frame);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop(): PitchFrame[] {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    void this.ctx?.close();
    this.ctx = null;
    return this.frames.slice();
  }

  get running(): boolean {
    return this.raf !== 0;
  }
}

/* ------------------------------------------------------------------ *
 * Contour shape and tone classification
 * ------------------------------------------------------------------ */

export interface ContourPoint {
  /** Position within the voiced part of the take, 0..1. */
  t: number;
  /** Semitones relative to the median pitch of the take. */
  st: number;
}

/** Frames are kept only where the detector was confident it heard a voice. */
function voicedFrames(frames: PitchFrame[]): PitchFrame[] {
  return frames.filter((f) => f.hz > 0 && f.clarity >= CLARITY_FLOOR);
}

/**
 * Convert a take into a shape: median-referenced semitones over normalised
 * time. Absolute pitch is discarded on purpose — a tone is a shape, and a bass
 * and a soprano produce the same shape at different registers.
 */
export function toContour(frames: PitchFrame[]): ContourPoint[] {
  const voiced = voicedFrames(frames);
  if (voiced.length < 4) return [];

  const sorted = voiced.map((f) => f.hz).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  if (!median) return [];

  // Drop octave errors: a frame a fifth away from the median in either
  // direction is far more likely a halved or doubled lag than real speech.
  const kept = voiced.filter((f) => Math.abs(12 * Math.log2(f.hz / median)) < 12);
  if (kept.length < 4) return [];

  const t0 = kept[0].t;
  const span = kept[kept.length - 1].t - t0;
  if (span < 120) return []; // too short to carry a contour

  return kept.map((f) => ({ t: (f.t - t0) / span, st: 12 * Math.log2(f.hz / median) }));
}

/** Duration of the voiced part, in milliseconds. */
export function voicedMs(frames: PitchFrame[]): number {
  const voiced = voicedFrames(frames);
  if (voiced.length < 2) return 0;
  return voiced[voiced.length - 1].t - voiced[0].t;
}

/** Sample a contour at n evenly spaced positions, averaging nearby points. */
export function resample(points: ContourPoint[], n = 20): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const lo = i / n;
    const hi = (i + 1) / n;
    const bucket = points.filter((p) => p.t >= lo && (p.t < hi || (i === n - 1 && p.t <= 1)));
    if (bucket.length) {
      out.push(bucket.reduce((s, p) => s + p.st, 0) / bucket.length);
    } else {
      // Nearest neighbour, so a gap does not become a fake dip.
      let best = points[0];
      let bestD = Infinity;
      const mid = (lo + hi) / 2;
      for (const p of points) {
        const d = Math.abs(p.t - mid);
        if (d < bestD) { bestD = d; best = p; }
      }
      out.push(best ? best.st : 0);
    }
  }
  return out;
}

function zeroMean(v: number[]): number[] {
  const m = v.reduce((s, x) => s + x, 0) / v.length;
  return v.map((x) => x - m);
}

function fromControlPoints(pts: [number, number][], n = 20): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : i / (n - 1);
    let j = 0;
    while (j < pts.length - 2 && pts[j + 1][0] < t) j++;
    const [t0, v0] = pts[j];
    const [t1, v1] = pts[j + 1];
    const k = t1 === t0 ? 0 : (t - t0) / (t1 - t0);
    out.push(v0 + (v1 - v0) * k);
  }
  return zeroMean(out);
}

/**
 * Idealised shapes in semitones, written from the Chao tone letters:
 * 55 flat high, 35 rising, 214 dipping, 51 sharply falling. Each is
 * zero-meaned, so only the shape is compared, never the register.
 */
export const TONE_TEMPLATES: Record<Exclude<Tone, 5>, number[]> = {
  1: fromControlPoints([[0, 0], [1, 0]]),
  2: fromControlPoints([[0, -2.2], [0.35, -2.0], [1, 3.4]]),
  3: fromControlPoints([[0, -0.6], [0.35, -3.6], [0.62, -3.3], [1, 3.6]]),
  4: fromControlPoints([[0, 4.6], [0.45, -0.6], [1, -5.2]]),
};

/** RMS distance in semitones between two equal-length shapes. */
function rms(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2;
  return Math.sqrt(s / a.length);
}

export interface ToneReading {
  /** Best matching tone, or null when the take was too short or too quiet. */
  tone: Exclude<Tone, 5> | null;
  /** Confidence 0..1 across the four tones. */
  scores: Record<Exclude<Tone, 5>, number>;
  /** Total pitch movement, in semitones — useful for honest feedback. */
  range: number;
  /** Net slope from start to end, in semitones. */
  slope: number;
  voicedMs: number;
  contour: ContourPoint[];
  shape: number[];
}

const EMPTY_SCORES: Record<Exclude<Tone, 5>, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };

export function classifyTone(frames: PitchFrame[]): ToneReading {
  const contour = toContour(frames);
  const ms = voicedMs(frames);
  if (contour.length < 4) {
    return { tone: null, scores: { ...EMPTY_SCORES }, range: 0, slope: 0, voicedMs: ms, contour, shape: [] };
  }

  const shape = zeroMean(resample(contour));
  const tones: Exclude<Tone, 5>[] = [1, 2, 3, 4];
  const distances = tones.map((t) => rms(shape, TONE_TEMPLATES[t]));

  // Soft scores: a 2-semitone error still leaves real confidence, a 6-semitone
  // one does not. Normalised so the four add up to 1.
  const weights = distances.map((d) => Math.exp(-(d * d) / (2 * 2.4 * 2.4)));
  const total = weights.reduce((s, w) => s + w, 0) || 1;

  const scores = { ...EMPTY_SCORES };
  tones.forEach((t, i) => { scores[t] = weights[i] / total; });

  let bestIdx = 0;
  for (let i = 1; i < distances.length; i++) if (distances[i] < distances[bestIdx]) bestIdx = i;

  const head = shape.slice(0, 3).reduce((s, x) => s + x, 0) / 3;
  const tail = shape.slice(-3).reduce((s, x) => s + x, 0) / 3;

  return {
    tone: tones[bestIdx],
    scores,
    range: Math.max(...shape) - Math.min(...shape),
    slope: tail - head,
    voicedMs: ms,
    contour,
    shape,
  };
}
