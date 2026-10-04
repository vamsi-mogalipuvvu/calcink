const STORAGE_KEY = 'calcink-feedback';

let enabled = loadEnabled();
let audioCtx: AudioContext | null = null;

function loadEnabled(): boolean {
  try {
    const stored = globalThis.localStorage?.getItem(STORAGE_KEY);
    return stored === null || stored === undefined ? true : stored !== 'false';
  } catch {
    return true;
  }
}

function getAudioContext(): AudioContext | null {
  if (!enabled) return null;
  try {
    if (audioCtx) return audioCtx;
    const AudioCtor = globalThis.AudioContext
      ?? (globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) return null;
    audioCtx = new AudioCtor();
    return audioCtx;
  } catch {
    return null;
  }
}

function tone(
  type: OscillatorType,
  startFreq: number,
  endFreq: number,
  start: number,
  duration: number,
  gainValue: number,
): void {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    void ctx.resume();

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(startFreq, start);
    if (endFreq !== startFreq) osc.frequency.linearRampToValueAtTime(endFreq, start + duration);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(gainValue, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(start);
    osc.stop(start + duration + 0.01);
  } catch {
    // no-op
  }
}

export function setFeedbackEnabled(v: boolean): void {
  enabled = v;
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, String(v));
  } catch {
    // no-op
  }
}

export function isFeedbackEnabled(): boolean {
  return enabled;
}

export function chime(): void {
  if (!enabled) return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    tone('sine', 660, 660, ctx.currentTime, 0.07, 0.035);
    tone('sine', 880, 880, ctx.currentTime + 0.075, 0.075, 0.035);
  } catch {
    // no-op
  }
}

export function buzz(): void {
  if (!enabled) return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    tone('triangle', 180, 180, ctx.currentTime, 0.11, 0.03);
  } catch {
    // no-op
  }
}

export function swish(): void {
  if (!enabled) return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    tone('sine', 500, 150, ctx.currentTime, 0.18, 0.025);
  } catch {
    // no-op
  }
}

export function haptic(ms: number): void {
  if (!enabled) return;
  try {
    globalThis.navigator?.vibrate?.(ms);
  } catch {
    // no-op
  }
}
