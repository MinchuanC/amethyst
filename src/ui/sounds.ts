import { useSettings } from '../state/settings';

export type Sound = 'hover' | 'select' | 'open' | 'whoosh' | 'focus';

let ctx: AudioContext | null = null;
let lastHover = 0;

function audio() {
  ctx ??= new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function tone(ac: AudioContext, at: number, from: number, to: number, dur: number, gain: number, type: OscillatorType = 'sine') {
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(from, at);
  osc.frequency.exponentialRampToValueAtTime(to, at + dur);
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(gain, at + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(g).connect(ac.destination);
  osc.start(at);
  osc.stop(at + dur + 0.02);
}

function noise(ac: AudioContext, at: number, dur: number, f0: number, f1: number, gain: number) {
  const len = Math.floor(ac.sampleRate * dur);
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = ac.createBufferSource();
  src.buffer = buf;
  const filter = ac.createBiquadFilter();
  filter.type = 'bandpass';
  filter.Q.value = 2.5;
  filter.frequency.setValueAtTime(f0, at);
  filter.frequency.exponentialRampToValueAtTime(f1, at + dur);
  const g = ac.createGain();
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(gain, at + dur * 0.3);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  src.connect(filter).connect(g).connect(ac.destination);
  src.start(at);
}

/** Synthesized interface sounds; silent unless the user turns them on. */
export function play(sound: Sound) {
  if (!useSettings.getState().sounds) return;
  const now = performance.now();
  if (sound === 'hover') {
    if (now - lastHover < 50) return;
    lastHover = now;
  }
  const ac = audio();
  const t = ac.currentTime + 0.005;
  switch (sound) {
    case 'hover':
      tone(ac, t, 2600, 1900, 0.03, 0.018);
      break;
    case 'select':
      tone(ac, t, 880, 900, 0.06, 0.04, 'triangle');
      tone(ac, t + 0.055, 1320, 1360, 0.08, 0.035, 'triangle');
      break;
    case 'open':
      tone(ac, t, 320, 960, 0.22, 0.04);
      noise(ac, t, 0.2, 600, 2400, 0.02);
      break;
    case 'whoosh':
      noise(ac, t, 0.18, 400, 2200, 0.03);
      break;
    case 'focus':
      tone(ac, t, 220, 660, 0.35, 0.035);
      tone(ac, t + 0.12, 660, 990, 0.3, 0.02, 'triangle');
      break;
  }
}
