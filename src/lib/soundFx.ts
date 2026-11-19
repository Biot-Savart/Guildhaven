class VillageSoundFX {
  private ctx: AudioContext | null = null;
  public enabled = true;

  private getContext(): AudioContext | null {
    if (!this.enabled || typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  private playTone(freq: number, duration: number, type: OscillatorType = 'sine', gain = 0.05, delay = 0) {
    const ctx = this.getContext();
    if (!ctx) return;

    const now = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);

    amp.gain.setValueAtTime(0.0001, now);
    amp.gain.exponentialRampToValueAtTime(gain, now + 0.015);
    amp.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    osc.connect(amp);
    amp.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  public phoneRing() {
    this.playTone(587.33, 0.09, 'triangle', 0.045, 0);
    this.playTone(783.99, 0.12, 'triangle', 0.045, 0.1);
  }

  public doorEnter() {
    this.playTone(329.63, 0.08, 'sine', 0.04, 0);
    this.playTone(440.0, 0.14, 'sine', 0.04, 0.08);
  }

  public taskDone() {
    this.playTone(523.25, 0.1, 'sine', 0.045, 0);
    this.playTone(659.25, 0.1, 'sine', 0.045, 0.09);
    this.playTone(783.99, 0.18, 'sine', 0.05, 0.18);
  }

  public townHallBell() {
    this.playTone(440, 0.25, 'triangle', 0.05, 0);
    this.playTone(554.37, 0.35, 'triangle', 0.045, 0.12);
  }

  public chatPop() {
    this.playTone(660, 0.05, 'sine', 0.03, 0);
  }
}

export const soundFx = new VillageSoundFX();
