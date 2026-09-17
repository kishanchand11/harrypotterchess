import type { PieceKind } from '../types/chess';

/** Tiny procedural sound stage. No audio files are required: every cue is shaped in Web Audio. */
export class AudioController {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private enabled = false;

  get isEnabled() {
    return this.enabled;
  }

  async setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (enabled) {
      await this.ensureContext();
      await this.context?.resume();
    }
  }

  async ensureContext() {
    if (!this.context) {
      const AudioContextConstructor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextConstructor) return;
      this.context = new AudioContextConstructor();
      this.master = this.context.createGain();
      this.master.gain.value = 0.18;
      this.master.connect(this.context.destination);
    }
    return this.context;
  }

  playMove(kind: PieceKind) {
    if (!this.enabled || !this.context || !this.master) return;
    const now = this.context.currentTime;
    const duration = kind === 'knight' ? 0.42 : 0.26;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    const filter = this.context.createBiquadFilter();
    oscillator.type = 'sawtooth';
    oscillator.frequency.setValueAtTime(kind === 'knight' ? 82 : 58, now);
    oscillator.frequency.exponentialRampToValueAtTime(29, now + duration);
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(760, now);
    filter.frequency.exponentialRampToValueAtTime(180, now + duration);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.42, now + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    oscillator.connect(filter).connect(gain).connect(this.master);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
  }

  playImpact(kind: PieceKind) {
    if (!this.enabled || !this.context || !this.master) return;
    const now = this.context.currentTime;
    const length = Math.floor(this.context.sampleRate * 0.75);
    const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) {
      const envelope = Math.pow(1 - i / length, 2.4);
      data[i] = (Math.random() * 2 - 1) * envelope;
    }
    const noise = this.context.createBufferSource();
    noise.buffer = buffer;
    const lowpass = this.context.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = kind === 'knight' ? 420 : 280;
    const noiseGain = this.context.createGain();
    noiseGain.gain.setValueAtTime(0.001, now);
    noiseGain.gain.exponentialRampToValueAtTime(kind === 'king' ? 1.2 : 0.9, now + 0.015);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.72);
    noise.connect(lowpass).connect(noiseGain).connect(this.master);
    noise.start(now);

    const sub = this.context.createOscillator();
    const subGain = this.context.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(kind === 'king' ? 42 : 56, now);
    sub.frequency.exponentialRampToValueAtTime(23, now + 0.5);
    subGain.gain.setValueAtTime(0.001, now);
    subGain.gain.exponentialRampToValueAtTime(0.6, now + 0.02);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.58);
    sub.connect(subGain).connect(this.master);
    sub.start(now);
    sub.stop(now + 0.6);
  }

  playSelect() {
    if (!this.enabled || !this.context || !this.master) return;
    const now = this.context.currentTime;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(440, now);
    oscillator.frequency.exponentialRampToValueAtTime(660, now + 0.12);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.12, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
    oscillator.connect(gain).connect(this.master);
    oscillator.start(now);
    oscillator.stop(now + 0.18);
  }

  dispose() {
    void this.context?.close();
    this.context = null;
    this.master = null;
  }
}
