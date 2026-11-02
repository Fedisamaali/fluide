'use strict';

class AudioReactor {
  constructor() {
    this.active = false;
    this.level = 0;
    this.bass = 0;
    this.treble = 0;
    this.beat = false;
    this.averageBass = 0;
    this.cooldown = 0;
  }

  async start() {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    this.stream = stream;
    this.context = new (window.AudioContext || window.webkitAudioContext)();
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.55;
    this.context.createMediaStreamSource(stream).connect(this.analyser);
    this.data = new Uint8Array(this.analyser.frequencyBinCount);
    this.active = true;
  }

  stop() {
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    if (this.context) this.context.close();
    this.stream = null;
    this.context = null;
    this.active = false;
    this.level = this.bass = this.treble = 0;
    this.beat = false;
  }

  band(from, to) {
    let sum = 0;
    for (let i = from; i < to; i++) sum += this.data[i];
    return sum / ((to - from) * 255);
  }

  update(dt) {
    this.beat = false;
    if (!this.active) return;
    this.analyser.getByteFrequencyData(this.data);

    const binHz = this.context.sampleRate / this.analyser.fftSize;
    const bin = (hz) => Math.max(1, Math.min(this.data.length - 1, Math.round(hz / binHz)));
    const bass = this.band(bin(30), bin(180));
    const mid = this.band(bin(180), bin(2000));
    const treble = this.band(bin(2000), bin(9000));

    const smooth = (prev, next, k) => prev + (next - prev) * Math.min(1, dt * k);
    this.bass = smooth(this.bass, bass, 18);
    this.treble = smooth(this.treble, treble, 12);
    this.level = smooth(this.level, (bass + mid + treble) / 3, 10);
    this.averageBass = smooth(this.averageBass, bass, 1.2);

    this.cooldown -= dt;
    if (this.cooldown <= 0 && bass > 0.22 && bass > this.averageBass * 1.25 + 0.04) {
      this.beat = true;
      this.cooldown = 0.2;
    }
  }
}
