export type SoundEffect = 'coin' | 'land' | 'spring' | 'jump' | 'buff' | 'stomp' | 'hit' | 'gameover' | 'record';

const SOUND_KEY = 'hoprise-sound-enabled';
const patterns: Record<SoundEffect, { notes: number[]; duration: number; wave: OscillatorType; volume?: number }> = {
  coin: { notes: [660, 990], duration: 0.075, wave: 'sine' },
  land: { notes: [190], duration: 0.07, wave: 'triangle', volume: 0.035 },
  spring: { notes: [310, 620, 930], duration: 0.09, wave: 'triangle' },
  jump: { notes: [420], duration: 0.07, wave: 'triangle', volume: 0.035 },
  buff: { notes: [520, 660, 880], duration: 0.11, wave: 'sine' },
  stomp: { notes: [240, 480], duration: 0.08, wave: 'square', volume: 0.04 },
  hit: { notes: [360, 150], duration: 0.16, wave: 'sawtooth', volume: 0.04 },
  gameover: { notes: [392, 294, 196], duration: 0.2, wave: 'triangle' },
  record: { notes: [523, 659, 784, 1047], duration: 0.12, wave: 'sine' },
};

let context: AudioContext | null = null;
let enabled = (() => {
  try { return localStorage.getItem(SOUND_KEY) !== 'false'; }
  catch { return true; }
})();

export function isSoundEnabled(): boolean {
  return enabled;
}

export function setSoundEnabled(next: boolean): void {
  enabled = next;
  try { localStorage.setItem(SOUND_KEY, String(enabled)); } catch { /* storage can be unavailable */ }
}

function getContext(): AudioContext | null {
  if (typeof window.AudioContext === 'undefined') return null;
  context ??= new window.AudioContext();
  return context;
}

export function unlockAudio(): void {
  if (!enabled) return;
  const audio = getContext();
  if (audio?.state === 'suspended') void audio.resume().catch(() => undefined);
}

export function playSound(effect: SoundEffect): void {
  if (!enabled) return;
  const audio = getContext();
  if (!audio) return;
  if (audio.state === 'suspended') void audio.resume().catch(() => undefined);

  const pattern = patterns[effect];
  const now = audio.currentTime + 0.012;
  pattern.notes.forEach((frequency, index) => {
    const start = now + index * pattern.duration * 0.82;
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = pattern.wave;
    oscillator.frequency.setValueAtTime(frequency, start);
    if (effect === 'hit' || effect === 'gameover') {
      oscillator.frequency.exponentialRampToValueAtTime(Math.max(55, frequency * 0.72), start + pattern.duration);
    }
    const volume = pattern.volume ?? 0.055;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + pattern.duration);
    oscillator.connect(gain);
    gain.connect(audio.destination);
    oscillator.start(start);
    oscillator.stop(start + pattern.duration + 0.015);
  });
}
