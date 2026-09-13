/* Fine-pointer cursor, path flame, and click ripples. Touch users and people
   requesting reduced motion always retain the system pointer. */

export const cur = document.getElementById('cur');
export const curRing = document.getElementById('cur-ring');
const fc = document.getElementById('flame-canvas'), fctx = fc.getContext('2d');

export const pointer = { x: innerWidth / 2, y: innerHeight / 2 };
let flameOn = false, flameCol = [255, 130, 30];
let cursorPath = 'world';
const pts = [];
const ripples = [];
let cursorRaf = 0;
const finePointer = matchMedia('(hover: hover) and (pointer: fine)');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const lowPower = Boolean(navigator.connection?.saveData ||
  (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4));

const PATH_COLORS = {
  friend: [110, 207, 179], viewer: [184, 152, 212], personal: [210, 90, 90],
};

function effectsAllowed() { return finePointer.matches && !reducedMotion.matches; }

function rsFC() { fc.width = innerWidth; fc.height = innerHeight; }
rsFC();
window.addEventListener('resize', rsFC);

document.addEventListener('pointermove', e => {
  if (!effectsAllowed() || (e.pointerType && e.pointerType !== 'mouse' && e.pointerType !== 'pen')) return;
  pointer.x = e.clientX; pointer.y = e.clientY;
  cur.style.left = pointer.x + 'px'; cur.style.top = pointer.y + 'px';
  curRing.style.left = pointer.x + 'px'; curRing.style.top = pointer.y + 'px';
}, { passive: true });

class FP {
  constructor() {
    this.x = pointer.x + (Math.random() - .5) * 16; this.y = pointer.y + 4;
    this.vx = (Math.random() - .5) * 2.2; this.vy = -(Math.random() * 4 + 2);
    this.life = 1; this.decay = .022 + Math.random() * .02; this.r = 5 + Math.random() * 10;
  }
  step() { this.x += this.vx; this.y += this.vy; this.vy *= .97; this.vx *= .985; this.life -= this.decay; this.r *= .965; }
  draw() {
    const [r, g, b] = flameCol;
    const gd = fctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, this.r);
    gd.addColorStop(0, `rgba(255,255,200,${this.life * .9})`);
    gd.addColorStop(.35, `rgba(${r},${g},${b},${this.life * .7})`);
    gd.addColorStop(1, `rgba(${Math.max(r - 70, 0)},0,0,0)`);
    fctx.fillStyle = gd; fctx.beginPath(); fctx.arc(this.x, this.y, this.r, 0, Math.PI * 2); fctx.fill();
  }
}

function fLoop() {
  cursorRaf = 0;
  fctx.clearRect(0, 0, fc.width, fc.height);
  if (flameOn && effectsAllowed() && !document.hidden) {
    const count = lowPower ? 2 : 5;
    for (let i = 0; i < count; i++) pts.push(new FP());
  }
  for (let i = pts.length - 1; i >= 0; i--) {
    pts[i].step();
    if (pts[i].life <= 0) pts.splice(i, 1); else pts[i].draw();
  }
  for (let i = ripples.length - 1; i >= 0; i--) {
    const rp = ripples[i]; rp.r += 2.8; rp.life -= .05;
    if (rp.life <= 0) { ripples.splice(i, 1); continue; }
    fctx.beginPath(); fctx.arc(rp.x, rp.y, rp.r, 0, Math.PI * 2);
    fctx.strokeStyle = `rgba(${rp.col.join(',')},${rp.life * .5})`;
    fctx.lineWidth = 1.5; fctx.stroke();
    fctx.beginPath(); fctx.arc(rp.x, rp.y, rp.r * .6, 0, Math.PI * 2);
    fctx.strokeStyle = `rgba(${rp.col.join(',')},${rp.life * .2})`;
    fctx.lineWidth = .8; fctx.stroke();
  }
  if (flameOn || pts.length || ripples.length) ensureCursorLoop();
}

function ensureCursorLoop() {
  if (!cursorRaf) cursorRaf = requestAnimationFrame(fLoop);
}

export function setFlame(on, col) {
  flameOn = Boolean(on && effectsAllowed());
  if (col) flameCol = col;
  fc.style.opacity = flameOn || ripples.length ? '1' : '0';
  if (flameOn || pts.length || ripples.length) ensureCursorLoop();
}

export function addRipple(x, y, col = [255, 255, 255]) {
  if (reducedMotion.matches) return;
  ripples.push({ x, y, r: 0, life: 1, col });
  fc.style.opacity = '1';
  ensureCursorLoop();
  setTimeout(() => { if (!flameOn) fc.style.opacity = '0'; }, 800);
}

export function setCursorPath(path = 'world') {
  cursorPath = path;
  cur.classList.remove('gold', 'frnd', 'plain');
  curRing.classList.toggle('world', path === 'world');
  if (path === 'recruiter') {
    setFlame(false);
    cur.classList.add('plain');
    return;
  }
  if (PATH_COLORS[path]) {
    if (path === 'friend') cur.classList.add('frnd');
    setFlame(true, PATH_COLORS[path]);
    return;
  }
  setFlame(false);
}

function syncPointerCapability() {
  document.documentElement.classList.toggle('system-pointer', !effectsAllowed());
  if (!effectsAllowed()) {
    flameOn = false;
    pts.length = 0;
    ripples.length = 0;
    cancelAnimationFrame(cursorRaf);
    cursorRaf = 0;
    fctx.clearRect(0, 0, fc.width, fc.height);
    fc.style.opacity = '0';
  } else {
    setCursorPath(cursorPath);
  }
}

finePointer.addEventListener?.('change', syncPointerCapability);
reducedMotion.addEventListener?.('change', syncPointerCapability);
syncPointerCapability();
