/**
 * Speech synthesis.
 *
 * The app is audio-first now, so a missing Chinese voice is not a cosmetic
 * problem — it is the difference between a working trainer and a silent one.
 * Two things make that fragile in browsers:
 *
 *  - getVoices() is empty until the engine has loaded, and Chrome fires
 *    'voiceschanged' late, sometimes only after the first user gesture;
 *  - a macOS install without a Chinese voice will happily read 马 with an
 *    English voice, producing something that is not Mandarin at all.
 *
 * So voices are polled as well as listened for, and the absence of a Chinese
 * voice is reported to the interface rather than hidden behind a dead button.
 */

export const ttsSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;

let voices: SpeechSynthesisVoice[] = [];
const listeners = new Set<() => void>();
let polling = 0;

function isChinese(v: SpeechSynthesisVoice): boolean {
  return /^zh|^cmn|Chinese|Mandarin/i.test(`${v.lang} ${v.name}`);
}

export function chineseVoices(): SpeechSynthesisVoice[] {
  return voices.filter(isChinese);
}

export function allVoices(): SpeechSynthesisVoice[] {
  return voices;
}

function refresh(): boolean {
  if (!ttsSupported) return false;
  const next = window.speechSynthesis.getVoices();
  if (next.length === voices.length && next.every((v, i) => v.voiceURI === voices[i]?.voiceURI)) return false;
  voices = next;
  listeners.forEach((cb) => cb());
  return true;
}

/**
 * Subscribe to the voice list. Polls for a few seconds after start because
 * 'voiceschanged' is unreliable, then stops so nothing spins forever.
 */
export function onVoicesReady(cb: () => void): () => void {
  if (!ttsSupported) return () => {};
  listeners.add(cb);
  refresh();

  const handler = () => refresh();
  window.speechSynthesis.addEventListener('voiceschanged', handler);

  if (!polling) {
    let tries = 0;
    polling = window.setInterval(() => {
      tries += 1;
      const found = refresh();
      if (tries > 20 || (found && chineseVoices().length)) {
        window.clearInterval(polling);
        polling = 0;
      }
    }, 250);
  }

  return () => {
    listeners.delete(cb);
    window.speechSynthesis.removeEventListener('voiceschanged', handler);
  };
}

export type VoiceStatus = 'ready' | 'loading' | 'no-chinese' | 'unsupported';

export function voiceStatus(): VoiceStatus {
  if (!ttsSupported) return 'unsupported';
  if (chineseVoices().length) return 'ready';
  return voices.length ? 'no-chinese' : 'loading';
}

export const VOICE_HELP: Record<VoiceStatus, string> = {
  ready: '',
  loading: 'Голоса ещё загружаются…',
  'no-chinese':
    'В системе нет китайского голоса, поэтому озвучка звучала бы не по-китайски. macOS: Системные настройки → Универсальный доступ → Проговаривание → Системный голос → Управление голосами → добавь китайский (Tingting или Li-Mu).',
  unsupported: 'Этот браузер не умеет синтез речи. Нужен Chrome, Edge или Safari.',
};

export function pickVoice(preferredURI?: string | null): SpeechSynthesisVoice | undefined {
  const zh = chineseVoices();
  if (!zh.length) return undefined;
  const normalised = (v: SpeechSynthesisVoice) => v.lang.replace('_', '-').toLowerCase();
  return (
    (preferredURI ? zh.find((v) => v.voiceURI === preferredURI) : undefined) ??
    zh.find((v) => normalised(v) === 'zh-cn') ??
    zh.find((v) => normalised(v).startsWith('zh')) ??
    zh[0]
  );
}

export interface SpeakOptions {
  voiceURI?: string | null;
  rate?: number;
  onStart?: () => void;
  onEnd?: () => void;
}

/**
 * Speaks text, resolving to false when no Chinese voice exists so the caller
 * can say why instead of appearing to do nothing.
 */
export function speak(text: string, opts: SpeakOptions = {}): boolean {
  if (!ttsSupported || !text) return false;
  const voice = pickVoice(opts.voiceURI);
  if (!voice) return false;

  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.voice = voice;
  u.lang = voice.lang || 'zh-CN';
  u.rate = opts.rate ?? 0.8;
  if (opts.onStart) u.onstart = () => opts.onStart?.();
  if (opts.onEnd) {
    u.onend = () => opts.onEnd?.();
    u.onerror = () => opts.onEnd?.();
  }
  window.speechSynthesis.speak(u);
  return true;
}

export function stopSpeaking(): void {
  if (ttsSupported) window.speechSynthesis.cancel();
}
