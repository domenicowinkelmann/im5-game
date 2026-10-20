const COIN_FREQ = { bronze: 880, silver: 1046, gold: 1318, diamond: 1760 };

class GameAudio {
  ensure() {
    if (!this.ctx) {
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        this.ctx = new Ctx();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.45;
        this.master.connect(this.ctx.destination);
        this.initWind();
      } catch (e) { this.ctx = null; return; }
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  noiseBuffer(sec = 2) {
    const b = this.ctx.createBuffer(1, this.ctx.sampleRate * sec, this.ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  initWind() {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer(2); src.loop = true;
    this.windFilter = this.ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass'; this.windFilter.frequency.value = 500; this.windFilter.Q.value = 0.7;
    this.windGain = this.ctx.createGain(); this.windGain.gain.value = 0;
    src.connect(this.windFilter).connect(this.windGain).connect(this.master);
    src.start();
  }

  setWind(level) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.windGain.gain.setTargetAtTime(level * 0.35, now, 0.15);
    this.windFilter.frequency.setTargetAtTime(350 + level * 1500, now, 0.15);
  }

  tone(freq, dur = 0.15, type = 'triangle', vol = 0.3, when = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  coin(type, mult = 1) {
    const f = COIN_FREQ[type] * (1 + (mult - 1) * 0.06);
    this.tone(f, 0.12, 'triangle', 0.22);
    this.tone(f * 1.5, 0.16, 'sine', 0.15, 0.05);
  }

  bonus() { [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.18, 'square', 0.08, i * 0.06)); }
  lost() { this.tone(300, 0.25, 'sine', 0.12); this.tone(220, 0.3, 'sine', 0.1, 0.1); }

  crash() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource(); src.buffer = this.noiseBuffer(1);
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(1200, t);
    f.frequency.exponentialRampToValueAtTime(80, t + 0.8);
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0.8, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
    src.connect(f).connect(g).connect(this.master); src.start(t);
  }

  reelStop(i) { this.tone(220 + i * 60, 0.08, 'square', 0.1); }
  tick() { this.tone(1400, 0.03, 'square', 0.04); }
  countTick() { this.tone(1700 + Math.random() * 500, 0.04, 'triangle', 0.05); }
  heartbeat() { this.tone(70, 0.12, 'sine', 0.35); this.tone(58, 0.12, 'sine', 0.25, 0.13); }

  lever() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource(); src.buffer = this.noiseBuffer(0.2);
    const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 1.5;
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0.4, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    src.connect(f).connect(g).connect(this.master); src.start(t);
    this.tone(95, 0.2, 'sine', 0.3, 0.05);
  }

  tension(seconds) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(160, t);
    o.frequency.exponentialRampToValueAtTime(760, t + seconds);
    f.type = 'lowpass'; f.frequency.value = 1400;
    g.gain.setValueAtTime(0.001, t);
    g.gain.exponentialRampToValueAtTime(0.06, t + seconds * 0.9);
    g.gain.exponentialRampToValueAtTime(0.001, t + seconds + 0.05);
    o.connect(f).connect(g).connect(this.master);
    o.start(t); o.stop(t + seconds + 0.1);
  }

  lose() { [392, 349, 311, 262].forEach((f, i) => this.tone(f, 0.3, 'triangle', 0.13, i * 0.17)); }

  jackpot() {
    [523, 659, 784, 1046, 1318, 1568, 2093].forEach((f, i) => this.tone(f, 0.25, 'square', 0.09, i * 0.07));
    for (let i = 0; i < 14; i++) this.tone(1500 + Math.random() * 900, 0.1, 'triangle', 0.08, 0.55 + i * 0.07);
  }

  win(rarity) {
    const seq = {
      coins: [660, 880],
      common: [523, 659, 784],
      rare: [523, 659, 784, 1046],
      epic: [523, 659, 784, 1046, 1318],
      legendary: [392, 523, 659, 784, 1046, 1318, 1568],
    }[rarity] || [660];
    seq.forEach((f, i) => this.tone(f, 0.22, 'triangle', 0.18, i * 0.08));
  }
}

export const audio = new GameAudio();
