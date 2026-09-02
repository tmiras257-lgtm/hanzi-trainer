/**
 * Thin wrappers over the Web Speech API.
 *
 * Synthesis is reliable; recognition is not. Browsers expose recognition as a
 * word-level transcript with no phonetic or tonal detail, and Chrome streams the
 * audio to a remote service, so it needs a network connection. A wrong tone often
 * still transcribes to the character you aimed for, so a "correct" result here is
 * weak evidence. The UI says so wherever recognition is offered.
 */

export const ttsSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;

type SR = typeof window extends { SpeechRecognition: infer T } ? T : any;
const RecognitionCtor: any =
  typeof window !== 'undefined'
    ? (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition
    : undefined;

export const asrSupported = Boolean(RecognitionCtor);

let voices: SpeechSynthesisVoice[] = [];

export function chineseVoices(): SpeechSynthesisVoice[] {
  return voices.filter((v) => /^zh/i.test(v.lang));
}

export function refreshVoices(): SpeechSynthesisVoice[] {
  if (!ttsSupported) return [];
  voices = window.speechSynthesis.getVoices();
  return chineseVoices();
}

export function onVoicesReady(cb: () => void): () => void {
  if (!ttsSupported) return () => {};
  refreshVoices();
  const handler = () => {
    refreshVoices();
    cb();
  };
  window.speechSynthesis.addEventListener('voiceschanged', handler);
  return () => window.speechSynthesis.removeEventListener('voiceschanged', handler);
}

export function speak(text: string, opts: { voiceURI?: string | null; rate?: number } = {}): void {
  if (!ttsSupported || !text) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'zh-CN';
  u.rate = opts.rate ?? 0.85;
  const zh = chineseVoices();
  const chosen =
    (opts.voiceURI && zh.find((v) => v.voiceURI === opts.voiceURI)) ??
    zh.find((v) => v.lang.replace('_', '-').toLowerCase() === 'zh-cn') ??
    zh[0];
  if (chosen) u.voice = chosen;
  window.speechSynthesis.speak(u);
}

export interface RecognitionResult {
  transcript: string;
  confidence: number;
}

export function listenOnce(timeoutMs = 6000): Promise<RecognitionResult> {
  return new Promise((resolve, reject) => {
    if (!RecognitionCtor) return reject(new Error('unsupported'));
    const rec: any = new RecognitionCtor();
    rec.lang = 'zh-CN';
    rec.continuous = false;
    rec.interimResults = false;
    rec.maxAlternatives = 3;

    let settled = false;
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        rec.stop();
      } catch {
        /* already stopped */
      }
      fn();
    };
    const timer = setTimeout(() => done(() => reject(new Error('timeout'))), timeoutMs);

    rec.onresult = (e: any) => {
      const r = e.results[0][0];
      done(() => resolve({ transcript: String(r.transcript ?? ''), confidence: Number(r.confidence ?? 0) }));
    };
    rec.onerror = (e: any) => done(() => reject(new Error(e.error || 'error')));
    rec.onend = () => done(() => reject(new Error('no-speech')));

    try {
      rec.start();
    } catch (e) {
      done(() => reject(e as Error));
    }
  });
}

/** Recognition returns text, so all we can honestly check is whether the characters match. */
export function transcriptMatches(transcript: string, target: string): boolean {
  const clean = (s: string) => s.replace(/[\s,.。，、!?！？]/g, '');
  return clean(transcript).includes(clean(target));
}

export type SRType = SR;
