import type { GameEvent } from "@puck/shared";

/**
 * Synthesised sound effects (ROADMAP M5): Web Audio oscillators and a noise burst, no
 * asset files. Browsers only allow audio after a user gesture, so the context starts on
 * the first pointer or key press. M toggles mute (remembered per browser).
 */
export class Sfx {
  /** Events played (muted or not), for headless checks. */
  played = 0;
  private ctx: AudioContext | null = null;
  private muted = false;

  constructor() {
    try {
      this.muted = localStorage.getItem("puck.muted") === "1";
    } catch {
      /* storage unavailable: default unmuted */
    }
    const unlock = (): void => {
      try {
        this.ctx ??= new AudioContext();
        void this.ctx.resume();
      } catch {
        /* no audio */
      }
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", (e) => {
      unlock();
      if (e.key.toLowerCase() === "m" && !(e.target instanceof HTMLInputElement)) this.toggleMute();
    });
  }

  get isMuted(): boolean {
    return this.muted;
  }

  toggleMute(): void {
    this.muted = !this.muted;
    try {
      localStorage.setItem("puck.muted", this.muted ? "1" : "0");
    } catch {
      /* ignore */
    }
  }

  play(e: GameEvent): void {
    this.played++;
    if (this.muted || !this.ctx || this.ctx.state !== "running") return;
    switch (e.type) {
      case "hit": {
        const v = Math.min(1, e.impact / 1600);
        if (e.kind === "wall") this.tone(140 + 80 * v, 0.07, "triangle", 0.15 + 0.35 * v);
        else if (e.kind === "bar") this.tone(520 + 400 * v, 0.06, "square", 0.06 + 0.12 * v, 380);
        else this.tone(300 + 200 * v, 0.09, "sine", 0.2 + 0.3 * v);
        break;
      }
      case "launch":
        this.noise(e.auto ? 0.12 : 0.2, e.auto ? 0.08 : 0.18);
        this.tone(220, 0.15, "sawtooth", 0.05, 660);
        break;
      case "possession":
        this.tone(e.reason === "catch" ? 660 : 440, 0.08, "sine", 0.12);
        break;
      case "goal":
        [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.18, "triangle", 0.18, undefined, i * 0.09));
        break;
    }
  }

  private tone(freq: number, dur: number, type: OscillatorType, gain: number, slideTo?: number, delay = 0): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    amp.gain.setValueAtTime(gain, t);
    amp.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(amp).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private noise(dur: number, gain: number): void {
    const ctx = this.ctx!;
    const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const src = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const amp = ctx.createGain();
    src.buffer = buffer;
    filter.type = "bandpass";
    filter.frequency.value = 1800;
    amp.gain.value = gain;
    src.connect(filter).connect(amp).connect(ctx.destination);
    src.start();
  }
}
