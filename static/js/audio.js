/* Small procedural Web Audio layer. It never starts before consent-by-gesture,
   fades rather than snapping, and tears down every oscillator when disabled. */

function stopOscillator(oscillator, delay = 0) {
  setTimeout(() => { try { oscillator.stop(); } catch { /* already stopped */ } }, delay);
}

export const SND = {
  ctx: null, master: null, worldDrone: null, pathDrones: {}, enabled: false,
  suspendedByPage: false,
  init() {
    if (this.ctx || !(window.AudioContext || window.webkitAudioContext)) return;
    try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch { return; }
    this.master = this.ctx.createGain();
    this.master.gain.value = .35;
    this.master.connect(this.ctx.destination);
  },
  async wake() {
    if (this.ctx?.state === 'suspended') {
      try { await this.ctx.resume(); } catch { /* browser still requires a gesture */ }
    }
  },
  startWorld() {
    if (!this.ctx || !this.enabled || this.worldDrone || this.ctx.state === 'closed') return;
    this.wake();
    const o1 = this.ctx.createOscillator(), o2 = this.ctx.createOscillator();
    const flt = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
    o1.frequency.value = 55; o2.frequency.value = 55.55;
    o1.type = o2.type = 'sawtooth';
    flt.type = 'lowpass'; flt.frequency.value = 180;
    g.gain.value = 0;
    o1.connect(flt); o2.connect(flt); flt.connect(g); g.connect(this.master);
    o1.start(); o2.start();
    g.gain.linearRampToValueAtTime(.07, this.ctx.currentTime + 4);
    this.worldDrone = { o1, o2, g };
  },
  stopWorld() {
    if (!this.worldDrone || !this.ctx) return;
    const { g, o1, o2 } = this.worldDrone;
    g.gain.cancelScheduledValues(this.ctx.currentTime);
    g.gain.setTargetAtTime(0, this.ctx.currentTime, .5);
    stopOscillator(o1, 2000); stopOscillator(o2, 2000);
    this.worldDrone = null;
  },
  startPathAmbient(id) {
    if (!this.ctx || !this.enabled || this.ctx.state === 'closed') return;
    this.stopPathAmbient();
    const freqs = { friend: [130, 130.6], viewer: [82, 82.35], personal: [55, 55.25] };
    if (!freqs[id]) return;
    const [f1, f2] = freqs[id];
    const o1 = this.ctx.createOscillator(), o2 = this.ctx.createOscillator();
    const flt = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
    o1.frequency.value = f1; o2.frequency.value = f2;
    o1.type = o2.type = 'sawtooth';
    flt.type = 'lowpass'; flt.frequency.value = 220;
    g.gain.value = 0;
    o1.connect(flt); o2.connect(flt); flt.connect(g); g.connect(this.master);
    o1.start(); o2.start();
    g.gain.linearRampToValueAtTime(.05, this.ctx.currentTime + 2.5);
    this.pathDrones[id] = { o1, o2, g };
  },
  stopPathAmbient() {
    Object.values(this.pathDrones).forEach(d => {
      d.g.gain.cancelScheduledValues(this.ctx.currentTime);
      d.g.gain.setTargetAtTime(0, this.ctx.currentTime, .4);
      stopOscillator(d.o1, 1800); stopOscillator(d.o2, 1800);
    });
    this.pathDrones = {};
  },
  chime(freq = 880, vol = .18) {
    if (!this.ctx || !this.enabled) return;
    const o = this.ctx.createOscillator(), env = this.ctx.createGain();
    o.type = 'sine'; o.frequency.value = freq;
    env.gain.setValueAtTime(0, this.ctx.currentTime);
    env.gain.linearRampToValueAtTime(vol, this.ctx.currentTime + .04);
    env.gain.exponentialRampToValueAtTime(.001, this.ctx.currentTime + 1.8);
    o.connect(env); env.connect(this.master);
    o.start(); o.stop(this.ctx.currentTime + 1.8);
  },
  whoosh() {
    if (!this.ctx || !this.enabled) return;
    const bs = this.ctx.sampleRate * .35, buf = this.ctx.createBuffer(1, bs, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < bs; i++) d[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource(), flt = this.ctx.createBiquadFilter(), env = this.ctx.createGain();
    src.buffer = buf; flt.type = 'bandpass'; flt.frequency.value = 700; flt.Q.value = .7;
    env.gain.setValueAtTime(.22, this.ctx.currentTime);
    env.gain.exponentialRampToValueAtTime(.001, this.ctx.currentTime + .35);
    src.connect(flt); flt.connect(env); env.connect(this.master);
    src.start(); src.stop(this.ctx.currentTime + .35);
  },
  thud() {
    if (!this.ctx || !this.enabled) return;
    const o = this.ctx.createOscillator(), env = this.ctx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(80, this.ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(20, this.ctx.currentTime + .6);
    env.gain.setValueAtTime(.5, this.ctx.currentTime);
    env.gain.exponentialRampToValueAtTime(.001, this.ctx.currentTime + .6);
    o.connect(env); env.connect(this.master);
    o.start(); o.stop(this.ctx.currentTime + .6);
  },
  stopAll() {
    this.stopWorld();
    this.stopPathAmbient();
  },
};

export const CHIME_FREQ = { friend: 523.25, viewer: 440, personal: 349.23, recruiter: 659.25 };

function updateAudioButton() {
  const button = document.getElementById('audio-btn');
  if (!button) return;
  button.textContent = SND.enabled ? '🔊' : '🔇';
  button.setAttribute('aria-pressed', String(SND.enabled));
  button.title = SND.enabled ? 'Mute sound' : 'Enable sound';
}

export async function toggleAudio() {
  SND.init();
  SND.enabled = !SND.enabled;
  updateAudioButton();
  if (!SND.enabled) {
    SND.stopAll();
    return;
  }
  await SND.wake();
  const activePath = document.body.dataset.path;
  if (activePath && activePath !== 'recruiter') SND.startPathAmbient(activePath);
  else if (window.__worldRunning) SND.startWorld();
}

document.addEventListener('visibilitychange', () => {
  if (!SND.ctx || !SND.enabled) return;
  if (document.hidden) {
    SND.suspendedByPage = true;
    SND.ctx.suspend().catch(() => {});
  } else if (SND.suspendedByPage) {
    SND.suspendedByPage = false;
    SND.ctx.resume().catch(() => {});
  }
});

updateAudioButton();
