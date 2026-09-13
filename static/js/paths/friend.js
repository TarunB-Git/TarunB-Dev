/* Story path. The world moon-fall is the entrance; this module continues
   directly into the lunar timeline. Earlier experiments remain archived. */
import { SND } from '../audio.js';
import { renderTimeline } from '../timeline.js';
import { maybeGet } from '../v1.js';
import { mountTaggedPosts } from '../blog.js';
import { mountMessageBox, renderWall } from '../messages.js';
import { setCursorPath } from '../cursor.js';

const $ = id => document.getElementById(id);
const esc = s => { const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML; };
const REDUCED_MOTION = matchMedia('(prefers-reduced-motion: reduce)');
const SESSION_COMPLETE = 'moon_story_opened_v1';
const SAMPLE_TIMELINE = {
  periods: [
    { label: 'Waxing', events: [{ slug: 'sample-waxing', category: 'Beginning', title: 'A person who changed the tide', summary: 'Introduce a friendship, collaboration, or place that still shapes how you see the world.', details_md: 'Tell one precise memory rather than a biography: where you were, what happened, and why it remained.', layout: 'upper', accent: 'blue' }] },
    { label: 'Full', events: [{ slug: 'sample-full', category: 'Shared orbit', title: 'The season everything aligned', summary: 'A shared obsession, project, journey, or ritual at the center of this chapter.', details_md: 'Use sensory details and a small honest moment. This path can be personal without becoming private.', layout: 'feature', accent: 'violet' }] },
    { label: 'Afterglow', events: [{ slug: 'sample-afterglow', category: 'What remains', title: 'The thing still carried forward', summary: 'Close with what the memory taught you and where its influence appears now.', details_md: 'A lunar story should feel cyclical: something ended, something remained, and something quietly returned.', layout: 'lower', accent: 'teal' }] },
  ],
};
const friendComplete = () => { try { return sessionStorage.getItem(SESSION_COMPLETE) === '1'; } catch { return false; } };
const rememberFriendComplete = () => { try { sessionStorage.setItem(SESSION_COMPLETE, '1'); } catch { /* storage unavailable */ } };

/* ══ Trials data — v7's three + a new fourth ══════════════ */
const TRIALS = [
  { label: 'Trial I of IV', prompt: 'The first trial.', sub: 'Choose the slip that calls to you.', slips: [
    { char: '火', label: 'FIRE', effect: 'fire', ec: '#ff6600', msg: '"The flames of arrogance consumed you. A real friend doesn\'t torch the place on the way in."' },
    { char: '虛', label: 'VOID', effect: 'void', ec: '#8888ff', msg: '"You dove into endless darkness. There is nothing down here. Just like your judgment."' },
    { char: '風', label: 'WIND', effect: 'wind', ec: '#aaddff', msg: '"Like the wind, your loyalty scattered in every direction simultaneously. They\'re still flying."' },
    { char: '土', label: 'EARTH', effect: 'earth', ec: '#88bb44', msg: '"Down you went. The others drifted above your grave in a serene little circle. Almost beautiful."' },
    { char: '雷', label: 'THUNDER', effect: 'thunder', ec: '#ccccff', msg: '"Shocking. Genuinely, truly shocking. And not — not even slightly — in a good way."' },
  ]},
  { label: 'Trial II of IV', prompt: 'You survived. The second trial.', sub: 'Perhaps the correct answer will reveal itself.', slips: [
    { char: '冰', label: 'ICE', effect: 'ice', ec: '#88ddff', msg: '"Cold. Your instincts are absolutely, completely freezing. This is not the vibe."' },
    { char: '星', label: 'STARS', effect: 'stars', ec: '#ffeeaa', msg: '"You reached for the stars. You grabbed the wrong constellation entirely. Wrong galaxy, even."' },
    { char: '浪', label: 'WAVE', effect: 'wave', ec: '#4488ff', msg: '"You rode the wave all the way into a reef. Spectacular to watch. Completely wrong."' },
    { char: '霧', label: 'MIST', effect: 'mist', ec: '#aabbcc', msg: '"You walked into the mist. We waited. You didn\'t come back for a while. Still wrong."' },
  ]},
  { label: 'Trial III of IV', prompt: 'The third trial.', sub: "Interesting that you're still here.", slips: [
    { char: '笑', label: 'JOY', effect: 'bounce', ec: '#ffcc44', msg: '"You chose chaos. Vibrant, joyful, thoroughly wrong chaos. The slips are still bouncing."' },
    { char: '淚', label: 'GRIEF', effect: 'rain', ec: '#6688bb', msg: '"Dramatic. Beautifully, operatically dramatic. Still wrong though."' },
    { char: '靜', label: 'SILENCE', effect: 'still', ec: '#999999', msg: '"..."' },
    { char: '夢', label: 'DREAM', effect: 'dream', ec: '#cc88ff', msg: '"You chose a dream. This is reality. You are, in reality, wrong."' },
  ]},
  { label: 'Trial IV of IV', prompt: 'The final trial. Truly, this time.', sub: 'Surely by now you can feel it.', slips: [
    { char: '金', label: 'GOLD', effect: 'gold', ec: '#ffd700', msg: '"You grabbed for gold. It rained everywhere and none of it stuck to you. Poetic, honestly."' },
    { char: '鏡', label: 'MIRROR', effect: 'mirror', ec: '#c0e8ff', msg: '"You looked into the mirror and picked yourself. Bold. Wrong, and also vain."' },
    { char: '影', label: 'SHADOW', effect: 'shadow', ec: '#5a4a7a', msg: '"You sided with the shadows. The shadows have taken a vote. They also think you\'re wrong."' },
    { char: '磁', label: 'LODESTONE', effect: 'magnet', ec: '#ff8866', msg: '"Everything was drawn to you. Attention is not the same as being right."' },
    { char: '雪', label: 'SNOW', effect: 'snow', ec: '#eef6ff', msg: '"A blizzard, because of you. Everyone is cold now. I hope the aesthetic was worth it."' },
  ]},
];

const REVEAL_LINES = ['You have failed every single trial.', '', 'Every.', 'Single.', 'One.', '',
  'You chose fire.', 'You dove into the void.', 'You summoned a blizzard indoors.',
  'You sank into the earth while the others watched.', '', '...', '', 'And yet.', '',
  "You're still here.", 'After four rounds of increasingly unhinged bamboo slip nonsense.',
  'Still trying.', ''];
const REVEAL_END = "★  That's it. That's the whole test.  ★";

/* ══ Phase driver ═════════════════════════════════════════ */

let started = false, contentInited = false;
let fxCv, fxCt, fxRAF = null, fxT = 0, fxParticles = [];
let orbitRAF = null, orbitOn = false, origPos = {};
let frndTestIdx = 0, frndCurrentSlips = [];
let flowToken = 0, replaying = false, touchArmedSlip = null;
const flowTimers = new Set();

export function initFriendPath() {
  setCursorPath('friend');
  fxCv = $('frnd-fx'); fxCt = fxCv.getContext('2d');
  resizeFxCanvas();
  ensureFriendControls();
  if (!fxCv.dataset.resizeBound) {
    fxCv.dataset.resizeBound = 'true';
    window.addEventListener('resize', resizeFxCanvas, { passive: true });
  }
  if (started) return;         // re-entering resumes where you were
  started = true;
  showFriendContent();
}

function resizeFxCanvas() {
  if (!fxCv) return;
  /* Effects deliberately render at CSS resolution: this is substantially
     cheaper on mobile and avoids allocating a multi-megapixel trail buffer. */
  fxCv.width = innerWidth;
  fxCv.height = innerHeight;
  fxCv.style.width = innerWidth + 'px';
  fxCv.style.height = innerHeight + 'px';
}

function later(callback, delay, token = flowToken) {
  const timer = setTimeout(() => {
    flowTimers.delete(timer);
    if (token === flowToken) callback();
  }, delay);
  flowTimers.add(timer);
  return timer;
}

function clearFlowTimers() {
  flowTimers.forEach(clearTimeout);
  flowTimers.clear();
}

function ensureFriendControls() {
  const ui = $('frnd-ui');
  if (ui && !$('frnd-skip')) {
    const button = document.createElement('button');
    button.id = 'frnd-skip';
    button.type = 'button';
    button.textContent = 'Skip animation';
    button.addEventListener('click', skipFriendAnimation);
    ui.appendChild(button);
  }
}

function showPhase(id) {
  ['frnd-unroll', 'frnd-bamboo-intro', 'frnd-test-panel', 'frnd-wrong-panel', 'frnd-reveal-panel', 'frnd-content-panel']
    .forEach(p => {
      const el = $(p);
      if (!el) return;
      const active = el.id === id;
      el.hidden = !active;
      el.inert = !active;
      el.setAttribute('aria-hidden', String(!active));
      el.classList.toggle('show', active);
      el.classList.toggle('hide', !active);
    });
  const skip = $('frnd-skip');
  if (skip) {
    const skippable = id === 'frnd-unroll';
    skip.classList.toggle('show', skippable);
    skip.textContent = 'Skip opening';
  }
}

function skipFriendAnimation() {
  const current = document.querySelector('.frnd-phase.show')?.id;
  if (current === 'frnd-unroll') {
    flowToken++;
    clearFlowTimers();
    showFriendContent();
  }
}

export function replayFriendTrials() {
  replaying = true;
  stopFx();
  flowToken++;
  clearFlowTimers();
  frndTestIdx = 0;
  playUnroll();
}

/* ── Phase 0: the fallen moon opens ── */

function playUnroll() {
  const token = ++flowToken;
  clearFlowTimers();
  showPhase('frnd-unroll');
  const paper = $('unroll-paper'), glyphs = $('unroll-glyphs'), story = $('unroll-story');
  $('frnd-unroll').classList.remove('play');
  paper.style.width = '';
  glyphs.innerHTML = '';
  glyphs.classList.remove('fade');
  story?.classList.remove('show');
  story?.setAttribute('aria-hidden', 'true');
  for (let index = 0; index < 34; index++) {
    const star = document.createElement('i');
    star.className = 'moon-star';
    star.style.setProperty('--x', `${8 + Math.random() * 84}%`);
    star.style.setProperty('--y', `${7 + Math.random() * 86}%`);
    star.style.setProperty('--d', `${0.5 + Math.random() * 1.8}s`);
    star.style.setProperty('--s', `${1 + Math.random() * 2.5}px`);
    glyphs.appendChild(star);
  }
  requestAnimationFrame(() => {
    if (token !== flowToken) return;
    $('frnd-unroll').classList.add('play');
    if (!REDUCED_MOTION.matches) SND.whoosh();
  });
  if (REDUCED_MOTION.matches) {
    later(showFriendContent, 0, token);
    return;
  }
  later(() => {
    glyphs.classList.add('fade');
    story?.classList.add('show');
    story?.setAttribute('aria-hidden', 'false');
    SND.chime(392, 0.24);
    later(showFriendContent, 2300, token);
  }, 2400, token);
}

/* ── Phase 1: morph into bamboo slips (v7 intro) ── */

function playBambooMorph(token = flowToken) {
  if (token !== flowToken) return;
  showPhase('frnd-bamboo-intro');
  const bwrap = $('bamboo-wrap'), goldRope = $('gold-rope'), fringeRow = $('fringe-row');
  bwrap.querySelectorAll('.slip').forEach(s => s.remove());
  fringeRow.innerHTML = '';
  goldRope.classList.remove('show'); fringeRow.classList.remove('show');
  $('bamboo-welcome').classList.remove('show');
  const CHARS = '天地道德仁義禮智信忠孝勇誠善美風雲山川', N = 13, slipEls = [];
  for (let i = 0; i < 58; i++) {
    const t = document.createElement('div');
    t.className = 'tassel';
    t.style.cssText = `height:${10 + Math.random() * 14}px;--sd:${2 + Math.random() * 2.5}s;--so:${Math.random() * 3}s;`;
    fringeRow.appendChild(t);
  }
  for (let i = 0; i < N; i++) {
    const s = document.createElement('div');
    s.className = 'slip';
    s.innerHTML = `<div class="slip-face"><div class="slip-char">${CHARS[i % CHARS.length]}</div></div>`;
    bwrap.appendChild(s);
    slipEls.push(s);
  }
  const W = bwrap.offsetWidth || 940, sw = 46, gap = 6, step = sw + gap;
  const total = N * step - gap, startX = (W - total) / 2, cX = W / 2 - sw / 2, mid = (N - 1) / 2;
  slipEls.forEach((s, i) => {
    const fl = startX + i * step, dx = fl - cX;
    s.style.left = `${fl}px`;
    s.style.transition = 'none';
    s.style.transform = `translateX(${-dx}px) rotate(${(i - mid) * 1.6}deg)`;
    s.style.opacity = '.1';
    s.style.zIndex = i < mid ? i + 1 : N - i;
    later(() => {
      const dur = .72 + Math.random() * .28, del = .1 + i * .058;
      s.style.transition = `transform ${dur}s cubic-bezier(.22,.61,.36,1) ${del}s,opacity .4s ease ${del}s`;
      s.style.transform = 'translateX(0) rotate(0deg)';
      s.style.opacity = '1';
    }, 40, token);
  });
  later(() => goldRope.classList.add('show'), 820, token);
  later(() => fringeRow.classList.add('show'), 1060, token);
  later(() => $('bamboo-welcome').classList.add('show'), 1720, token);
  later(startTrials, 3600, token);
}

function startTrials() {
  clearFlowTimers();
  frndTestIdx = 0;
  showPhase('frnd-test-panel');
  buildTrial(0);
}

/* ══ Phase 2: trials (ported from v7 + new effects) ═══════ */

function buildTrial(idx) {
  const trial = TRIALS[idx];
  $('frnd-trial-label').textContent = trial.label;
  $('frnd-trial-prompt').textContent = trial.prompt;
  $('frnd-trial-sub').textContent = trial.sub;
  const stage = $('frnd-slips-stage');
  stage.innerHTML = '';
  frndCurrentSlips = []; origPos = {}; touchArmedSlip = null;
  const sd = trial.slips;
  const W = stage.offsetWidth || Math.min(800, innerWidth - 40);
  const sw = 52, gap = Math.min(28, (W - sw * sd.length) / (sd.length - 1));
  const total = sd.length * sw + (sd.length - 1) * gap, startX = (W - total) / 2;
  sd.forEach((d, i) => {
    const slip = document.createElement('button');
    slip.type = 'button';
    slip.className = 'f-slip';
    slip.style.setProperty('--ec', d.ec);
    slip.setAttribute('aria-label', `${d.label} slip. Focus or first tap previews its effect; activate to choose.`);
    slip.innerHTML = `<div class="f-slip-face"><div class="f-slip-char">${d.char}</div><div class="f-slip-label">${d.label}</div></div>`;
    const x = startX + i * (sw + gap), y = 20;
    slip.style.left = x + 'px'; slip.style.top = y + 'px';
    origPos[i] = { x: x + sw / 2, y: y + 150, left: x, top: y };
    slip.addEventListener('mouseenter', () => onFSlipHover(slip, i, d));
    slip.addEventListener('mouseleave', () => {
      if (document.activeElement !== slip && touchArmedSlip !== slip) stopFx();
    });
    slip.addEventListener('focus', () => onFSlipHover(slip, i, d));
    slip.addEventListener('blur', () => {
      if (touchArmedSlip !== slip) stopFx();
    });
    slip.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') touchArmedSlip = slip;
    });
    slip.addEventListener('pointerdown', event => { slip._pointerType = event.pointerType; });
    slip.addEventListener('click', event => {
      if ((slip._pointerType === 'touch' || slip._pointerType === 'pen') && touchArmedSlip !== slip) {
        event.preventDefault();
        touchArmedSlip = slip;
        onFSlipHover(slip, i, d);
        slip.setAttribute('aria-label', `${d.label} effect previewed. Activate again to choose.`);
        return;
      }
      touchArmedSlip = null;
      onFSlipClick(d);
    });
    stage.appendChild(slip);
    frndCurrentSlips.push(slip);
  });
  requestAnimationFrame(() => frndCurrentSlips[0]?.focus({ preventScroll: true }));
}

function onFSlipHover(hs, idx, d) {
  stopFx();
  const eff = d.effect, ec = d.ec;
  frndCurrentSlips.forEach(s => s.classList.remove('lit'));
  hs.classList.add('lit');
  hs.style.setProperty('--ec', ec);
  fxT = 0; fxParticles = [];

  if (REDUCED_MOTION.matches) return;

  if (eff === 'wind') {
    frndCurrentSlips.forEach(s => {
      if (s === hs) return;
      const angle = Math.random() * Math.PI * 2;
      const dx = Math.cos(angle) * (45 + Math.random() * 35);
      const dy = Math.sin(angle) * (45 + Math.random() * 35) - 20;
      const rot = (Math.random() - .5) * 540;
      s.classList.add('scattered');
      s.style.transform = `translate(${dx}vw,${dy}vh) rotate(${rot}deg)`;
      s.style.opacity = '.18';
    });
    fxRAF = requestAnimationFrame(() => windLoop());
    return;
  }
  if (eff === 'earth') {
    hs.classList.add('sinking');
    hs.style.transform = 'translateY(130vh) rotate(8deg)';
    hs.style.opacity = '.1';
    const others = frndCurrentSlips.filter(s => s !== hs);
    const stR = $('frnd-slips-stage').getBoundingClientRect();
    const cx = stR.left + stR.width / 2, cy = stR.top + stR.height / 2;
    others.forEach(s => {
      const r = s.getBoundingClientRect();
      s.classList.add('orbiting');
      s.style.position = 'fixed';
      s.style.left = r.left + 'px'; s.style.top = r.top + 'px';
      s.style.margin = '0'; s.style.zIndex = '999';
    });
    orbitOn = true;
    let oT = 0;
    const oF = () => {
      if (!orbitOn) return;
      oT += .016;
      others.forEach((s, i) => {
        const ang = (i / others.length) * Math.PI * 2 + oT * .9;
        s.style.left = (cx + 130 * Math.cos(ang) - 26) + 'px';
        s.style.top = (cy + 130 * Math.sin(ang) - 150) + 'px';
        s.style.transform = `rotate(${oT * 40 + i * 50}deg)`;
        s.style.opacity = (0.55 + 0.35 * Math.sin(oT * 2 + i)).toString();
      });
      orbitRAF = requestAnimationFrame(oF);
    };
    orbitRAF = requestAnimationFrame(oF);
    fxRAF = requestAnimationFrame(() => earthLoop());
    return;
  }
  if (eff === 'still') {
    frndCurrentSlips.forEach(s => { s.style.transition = 'none'; });
    fxCt.clearRect(0, 0, fxCv.width, fxCv.height);
    const g = fxCt.createRadialGradient(innerWidth / 2, innerHeight / 2, innerWidth * .2, innerWidth / 2, innerHeight / 2, innerWidth * .8);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(8,8,8,.75)');
    fxCt.fillStyle = g;
    fxCt.fillRect(0, 0, fxCv.width, fxCv.height);
    return;
  }
  if (eff === 'bounce') {
    frndCurrentSlips.forEach((s, i) => { s.style.animation = `fBounce ${.35 + i * .07}s ease-in-out infinite alternate`; });
    fxRAF = requestAnimationFrame(() => bounceLoop());
    return;
  }
  if (eff === 'mirror') {
    frndCurrentSlips.forEach((s, i) => {
      if (s === hs) return;
      s.classList.add('scattered');
      s.style.transform = 'scaleX(-1) rotate(180deg)';
      s.style.filter = 'saturate(.2) brightness(1.5)';
    });
    fxRAF = requestAnimationFrame(() => cvFxLoop('mirror', ec));
    return;
  }
  if (eff === 'shadow') {
    frndCurrentSlips.forEach(s => {
      if (s === hs) return;
      s.classList.add('scattered');
      s.style.filter = 'brightness(.06)';
      s.style.transform = 'scale(.94)';
    });
    fxRAF = requestAnimationFrame(() => cvFxLoop('shadow', ec));
    return;
  }
  if (eff === 'magnet') {
    frndCurrentSlips.forEach((s, i) => {
      if (s === hs) return;
      const dx = origPos[idx].x - origPos[i].x;
      s.classList.add('scattered');
      s.style.transform = `translateX(${dx * .82}px) rotate(${dx > 0 ? 14 : -14}deg)`;
    });
    fxRAF = requestAnimationFrame(() => cvFxLoop('magnet', ec));
    return;
  }
  fxRAF = requestAnimationFrame(() => cvFxLoop(eff, ec));
}

function stopFx() {
  if (fxRAF) { cancelAnimationFrame(fxRAF); fxRAF = null; }
  if (orbitRAF) { cancelAnimationFrame(orbitRAF); orbitRAF = null; }
  orbitOn = false;
  fxParticles = [];
  if (fxCt) fxCt.clearRect(0, 0, fxCv.width, fxCv.height);
  frndCurrentSlips.forEach((s, i) => {
    s.classList.remove('lit', 'scattered', 'sinking', 'orbiting');
    s.style.position = 'absolute';
    s.style.transform = ''; s.style.opacity = '1';
    s.style.animation = ''; s.style.transition = ''; s.style.filter = '';
    s.style.zIndex = '2';
    if (origPos[i]) { s.style.left = origPos[i].left + 'px'; s.style.top = origPos[i].top + 'px'; }
  });
}

/* canvas particle fx (v7 + gold/snow/mirror/shadow/magnet backdrops) */
const BG = { fire: '#0d0200', void: '#000000', thunder: '#02020c', ice: '#020810', stars: '#000005', wave: '#01081a', rain: '#030408', dream: '#080312', mist: '#050608', gold: '#0a0700', snow: '#04060c', mirror: '#020608', shadow: '#010101', magnet: '#0a0402' };

class FxP {
  constructor(x, y, vx, vy, life, sz, r, g, b) {
    this.x = x; this.y = y; this.vx = vx; this.vy = vy;
    this.life = life; this.ml = life; this.sz = sz;
    this.r = r; this.g = g; this.b = b;
  }
  step() { this.x += this.vx; this.y += this.vy; this.vy *= .98; this.vx *= .99; this.life--; this.sz *= .98; }
  get t() { return this.life / this.ml; }
}

function hsl(h, s, l) {
  let r, g, b;
  if (s === 0) { r = g = b = l; }
  else {
    const q = l < .5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    const f = (p, q, t) => {
      if (t < 0) t += 1; if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    r = f(p, q, h + 1 / 3); g = f(p, q, h); b = f(p, q, h - 1 / 3);
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

function spawnFx(eff, W, H) {
  switch (eff) {
    case 'fire':
      for (let i = 0; i < 8; i++) {
        const [r, g, b] = hsl(Math.random() * 45 / 360, .9, .4 + Math.random() * .3);
        fxParticles.push(new FxP(W * .1 + Math.random() * W * .8, H, (Math.random() - .5) * 2, -(Math.random() * 6 + 3), 50 + Math.random() * 40, 8 + Math.random() * 14, r, g, b));
      }
      break;
    case 'void':
      if (fxT % 3 === 0) {
        const ang = Math.random() * Math.PI * 2, rad = W * .45 + Math.random() * W * .1, cx = W / 2, cy = H / 2;
        fxParticles.push(new FxP(cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad, -Math.cos(ang) * rad * .012, -Math.sin(ang) * rad * .012, 120, 1.5 + Math.random() * 1.5, 200, 200, 255));
      }
      break;
    case 'thunder':
      if (fxT % 4 === 0) {
        const x = Math.random() * W, y = Math.random() * H;
        for (let i = 0; i < 6; i++) fxParticles.push(new FxP(x, y, (Math.random() - .5) * 8, (Math.random() - .5) * 8, 20, 3, 180, 180, 255));
      }
      break;
    case 'ice':
      if (fxT % 5 === 0) fxParticles.push(new FxP(Math.random() * W, -10, (Math.random() - .5) * .5, 1.2 + Math.random(), 120, 2 + Math.random() * 3, 160, 210, 255));
      break;
    case 'stars':
      for (let i = 0; i < 4; i++) {
        const ang = Math.random() * Math.PI * 2;
        fxParticles.push(new FxP(W / 2, H / 2, Math.cos(ang) * (2 + Math.random() * 6), Math.sin(ang) * (2 + Math.random() * 6), 60 + Math.random() * 40, 1 + Math.random() * 1.5, 255, 240, 180));
      }
      break;
    case 'wave':
      if (fxT % 3 === 0) {
        const y = H * .5 + Math.sin(fxT * .05) * H * .2;
        fxParticles.push(new FxP(Math.random() * W, y, (Math.random() - .5) * 3, -1 - Math.random() * 2, 80, 4 + Math.random() * 6, 40, 100, 220));
      }
      break;
    case 'rain':
      for (let i = 0; i < 5; i++) fxParticles.push(new FxP(Math.random() * W * 1.2 - W * .1, -10, .5 + Math.random() * .5, 12 + Math.random() * 8, 40, 1.5, 100, 130, 200));
      break;
    case 'dream':
      if (fxT % 2 === 0) fxParticles.push(new FxP(Math.random() * W, Math.random() * H, (Math.random() - .5) * 1, -.5 - Math.random() * 1, 100, 3 + Math.random() * 5, 180, 100, 255));
      break;
    case 'mist':
      if (fxT % 8 === 0) fxParticles.push(new FxP(Math.random() * W, H * .4 + Math.random() * H * .3, (Math.random() - .5) * .4, -.15, 200, 18 + Math.random() * 22, 140, 160, 190));
      break;
    case 'gold':
      for (let i = 0; i < 6; i++) fxParticles.push(new FxP(Math.random() * W, -10, (Math.random() - .5) * 1.2, 5 + Math.random() * 6, 60, 2 + Math.random() * 3.5, 255, 200 + Math.random() * 40, 40));
      if (fxT % 2 === 0) fxParticles.push(new FxP(Math.random() * W, Math.random() * H, 0, 0, 14, 1.4, 255, 245, 170));
      break;
    case 'snow':
      for (let i = 0; i < 7; i++) fxParticles.push(new FxP(Math.random() * W * 1.3 - W * .15, -10, 1.5 + Math.random() * 2.5, 2.5 + Math.random() * 3, 130, 1.6 + Math.random() * 2.6, 235, 244, 255));
      break;
    case 'mirror':
      if (fxT % 3 === 0) {
        const x = Math.random() * W;
        fxParticles.push(new FxP(x, Math.random() * H, .8, 0, 50, 1.2, 190, 230, 255));
        fxParticles.push(new FxP(W - x, Math.random() * H, -.8, 0, 50, 1.2, 190, 230, 255));
      }
      break;
    case 'shadow':
      if (fxT % 4 === 0) fxParticles.push(new FxP(Math.random() * W, H + 10, (Math.random() - .5) * .6, -(.8 + Math.random() * 1.4), 140, 10 + Math.random() * 16, 18, 12, 30));
      break;
    case 'magnet':
      if (fxT % 2 === 0) {
        const ang = Math.random() * Math.PI * 2, rad = W * .4;
        const cx = W / 2, cy = H / 2;
        fxParticles.push(new FxP(cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad, -Math.cos(ang) * 3.4, -Math.sin(ang) * 3.4, 70, 1.8 + Math.random() * 2, 255, 140, 100));
      }
      break;
  }
}

function cvFxLoop(eff, ec) {
  fxT++;
  const ctx = fxCt, W = fxCv.width, H = fxCv.height;
  ctx.globalAlpha = .14;
  ctx.fillStyle = BG[eff] || '#000';
  ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 1;
  spawnFx(eff, W, H);
  for (let i = fxParticles.length - 1; i >= 0; i--) {
    const p = fxParticles[i];
    p.step();
    if (p.life <= 0) { fxParticles.splice(i, 1); continue; }
    ctx.globalAlpha = p.t * .8;
    ctx.fillStyle = `rgb(${p.r},${p.g},${p.b})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(p.sz * p.t, .5), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  if (eff === 'void' || eff === 'shadow') {
    const g = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W * .55);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(.6, 'rgba(0,0,5,.3)'); g.addColorStop(1, 'rgba(0,0,10,.85)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  if (eff === 'fire') {
    const g = ctx.createLinearGradient(0, H, 0, 0);
    g.addColorStop(0, 'rgba(200,60,0,.28)'); g.addColorStop(.4, 'rgba(150,30,0,.12)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  if (eff === 'gold') {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, 'rgba(255,200,40,.12)'); g.addColorStop(1, 'rgba(120,80,0,.05)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  if (eff === 'mirror' && fxT % 30 < 2) {
    ctx.strokeStyle = 'rgba(200,235,255,.5)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); ctx.stroke();
  }
  if (eff === 'thunder' && fxT % 18 < 3) {
    ctx.strokeStyle = 'rgba(180,200,255,.9)'; ctx.lineWidth = 1.5;
    ctx.shadowColor = '#8888ff'; ctx.shadowBlur = 12;
    const bl = (x, y, dx, dy, dep) => {
      if (dep <= 0) return;
      ctx.beginPath(); ctx.moveTo(x, y);
      const nx = x + dx + (Math.random() - .5) * 40, ny = y + dy;
      ctx.lineTo(nx, ny); ctx.stroke();
      bl(nx, ny, dx, dy, dep - 1);
      if (Math.random() < .4) bl(nx, ny, (Math.random() - .5) * 30, dy * .7, dep - 2);
    };
    bl(Math.random() * W, 0, (Math.random() - .5) * 80, 60, 5);
    ctx.shadowBlur = 0;
  }
  fxRAF = requestAnimationFrame(() => cvFxLoop(eff, ec));
}

function windLoop() {
  fxT++;
  const ctx = fxCt, W = fxCv.width, H = fxCv.height;
  ctx.globalAlpha = .1; ctx.fillStyle = '#050815'; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1;
  for (let i = 0; i < 3; i++) fxParticles.push(new FxP(Math.random() * W, Math.random() * H, (Math.random() - .5) * 12, (Math.random() - .5) * 6, 25, 1, 180, 210, 240));
  for (let i = fxParticles.length - 1; i >= 0; i--) {
    const p = fxParticles[i];
    p.step();
    if (p.life <= 0) { fxParticles.splice(i, 1); continue; }
    ctx.globalAlpha = p.t * .5;
    ctx.strokeStyle = `rgba(180,210,240,${p.t})`;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 4, p.y - p.vy * 4); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  fxRAF = requestAnimationFrame(() => windLoop());
}

function earthLoop() {
  fxT++;
  const ctx = fxCt, W = fxCv.width, H = fxCv.height;
  ctx.globalAlpha = .12; ctx.fillStyle = '#060601'; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1;
  if (fxT % 3 === 0) fxParticles.push(new FxP(W / 2 + (Math.random() - .5) * 80, H * .7, (Math.random() - .5) * 2, -(Math.random() * 2 + .5), 80, 3 + Math.random() * 4, 100, 80, 30));
  for (let i = fxParticles.length - 1; i >= 0; i--) {
    const p = fxParticles[i];
    p.step();
    if (p.life <= 0) { fxParticles.splice(i, 1); continue; }
    ctx.globalAlpha = p.t * .45;
    ctx.fillStyle = `rgb(${p.r},${p.g},${p.b})`;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.sz, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
  fxRAF = requestAnimationFrame(() => earthLoop());
}

function bounceLoop() {
  fxT++;
  const ctx = fxCt, W = fxCv.width, H = fxCv.height;
  ctx.globalAlpha = .1; ctx.fillStyle = '#100008'; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1;
  if (fxT % 2 === 0) {
    const [r, g, b] = hsl(Math.random(), 1, .55);
    fxParticles.push(new FxP(Math.random() * W, Math.random() * H, (Math.random() - .5) * 4, (Math.random() - .5) * 4, 60, 4 + Math.random() * 6, r, g, b));
  }
  for (let i = fxParticles.length - 1; i >= 0; i--) {
    const p = fxParticles[i];
    p.step();
    if (p.life <= 0) { fxParticles.splice(i, 1); continue; }
    ctx.globalAlpha = p.t * .7;
    ctx.fillStyle = `rgb(${p.r},${p.g},${p.b})`;
    ctx.fillRect(p.x, p.y, p.sz, p.sz * .6);
  }
  ctx.globalAlpha = 1;
  fxRAF = requestAnimationFrame(() => bounceLoop());
}

/* ── wrong guess → next trial → reveal ── */

function onFSlipClick(d) {
  stopFx();
  showPhase('frnd-wrong-panel');
  $('frnd-wrong-msg').textContent = d.msg;
  requestAnimationFrame(() => $('frnd-continue-btn')?.focus({ preventScroll: true }));
  SND.whoosh();
  fxCt.globalAlpha = .6; fxCt.fillStyle = '#1a0000';
  fxCt.fillRect(0, 0, fxCv.width, fxCv.height);
  fxCt.globalAlpha = 1;
  later(() => fxCt.clearRect(0, 0, fxCv.width, fxCv.height), 400);
  $('frnd-continue-btn').onclick = () => {
    frndTestIdx++;
    if (frndTestIdx < TRIALS.length) {
      showPhase('frnd-test-panel');
      buildTrial(frndTestIdx);
    } else {
      showPhase('frnd-reveal-panel');
      fxCt.clearRect(0, 0, fxCv.width, fxCv.height);
      rememberFriendComplete();
      startReveal();
    }
  };
}

function startReveal() {
  const token = ++flowToken;
  clearFlowTimers();
  const el = $('frnd-reveal-text');
  el.innerHTML = '';
  $('frnd-enter-btn').classList.remove('show');
  if (REDUCED_MOTION.matches) {
    finishReveal();
    return;
  }
  let li = 0, ci = 0;
  const all = [...REVEAL_LINES];
  const next = () => {
    if (li >= all.length) {
      const em = document.createElement('span');
      em.className = 'r-em';
      em.textContent = REVEAL_END;
      el.appendChild(em);
      later(() => {
        $('frnd-enter-btn').classList.add('show');
        $('frnd-enter-btn').focus({ preventScroll: true });
      }, 600, token);
      return;
    }
    const line = all[li];
    if (line === '') { el.appendChild(document.createElement('br')); li++; ci = 0; later(next, 180, token); return; }
    if (line === '...') {
      const sp = document.createElement('span');
      sp.textContent = '...'; sp.style.opacity = '.4';
      el.appendChild(sp); el.appendChild(document.createElement('br'));
      li++; ci = 0; later(next, 600, token); return;
    }
    if (ci === 0) {
      const sp = document.createElement('span');
      sp.dataset.li = li;
      el.appendChild(sp);
    }
    const sps = el.querySelectorAll('span[data-li]');
    const cur = sps[sps.length - 1];
    if (ci < line.length) { cur.textContent += line[ci]; ci++; later(next, 38 + Math.random() * 24, token); }
    else { el.appendChild(document.createElement('br')); li++; ci = 0; later(next, line.length > 20 ? 320 : 150, token); }
  };
  later(next, 600, token);
}

function finishReveal() {
  const el = $('frnd-reveal-text');
  el.innerHTML = '';
  REVEAL_LINES.forEach(line => {
    if (line) el.append(document.createTextNode(line));
    el.appendChild(document.createElement('br'));
  });
  const end = document.createElement('span');
  end.className = 'r-em';
  end.textContent = REVEAL_END;
  el.appendChild(end);
  $('frnd-enter-btn').classList.add('show');
  rememberFriendComplete();
  requestAnimationFrame(() => $('frnd-enter-btn')?.focus({ preventScroll: true }));
}

export function leaveFriendPath() {
  flowToken++;
  clearFlowTimers();
  stopFx();
  started = false;
  replaying = false;
  touchArmedSlip = null;
}

/* ── Phase 3: the Keep — timeline, links, message box ── */

export async function showFriendContent() {
  setCursorPath('friend');
  replaying = false;
  rememberFriendComplete();
  clearFlowTimers();
  stopFx();
  $('frnd-skip')?.classList.remove('show');
  const opening = $('frnd-unroll');
  const content = $('frnd-content-panel');
  const handoff = !REDUCED_MOTION.matches && opening?.classList.contains('show');
  if (handoff && content) {
    ['frnd-bamboo-intro', 'frnd-test-panel', 'frnd-wrong-panel', 'frnd-reveal-panel'].forEach(id => {
      const phase = $(id);
      if (!phase) return;
      phase.hidden = true;
      phase.inert = true;
      phase.setAttribute('aria-hidden', 'true');
      phase.classList.remove('show');
      phase.classList.add('hide');
    });
    content.hidden = false;
    content.inert = false;
    content.setAttribute('aria-hidden', 'false');
    content.classList.remove('hide');
    content.classList.add('show', 'moon-entering');
    opening.classList.add('moon-handoff');
    later(() => {
      opening.hidden = true;
      opening.inert = true;
      opening.setAttribute('aria-hidden', 'true');
      opening.classList.remove('show', 'moon-handoff');
      opening.classList.add('hide');
      content.classList.remove('moon-entering');
    }, 1050, flowToken);
  } else {
    showPhase('frnd-content-panel');
  }
  if (fxCt) fxCt.clearRect(0, 0, fxCv.width, fxCv.height);
  if (contentInited) return;
  contentInited = true;
  const record = await maybeGet('/content/friend_links');
  const links = Array.isArray(record?.data) ? record.data : [];
  const people = links.length ? links.slice(0, 6).map(link => ({
    eyebrow: link.label || 'Friend', title: link.name || link.label || 'A person in orbit',
    copy: link.note || 'A place for the story of how you met and what stayed with you.',
  })) : [
    { eyebrow: 'First orbit', title: 'The old friend', copy: 'How you met, the ritual you kept, and the quality you still borrow from them.' },
    { eyebrow: 'Shared season', title: 'The collaborator', copy: 'A friendship made through a difficult project and the trust built while making it.' },
    { eyebrow: 'Distant light', title: 'The friend elsewhere', copy: 'A relationship that survives distance, changing cities, and uneven time.' },
  ];
  $('frnd-people').innerHTML = people.map(item => `<article><small>${esc(item.eyebrow)}</small><strong>${esc(item.title)}</strong><p>${esc(item.copy)}</p></article>`).join('');
  $('frnd-shared-projects').innerHTML = [
    ['Shared map', 'Places we keep returning to', 'A small map or photo trail attached to a friendship.'],
    ['Time capsule', 'Notes across the years', 'Messages, milestones, or snapshots arranged without turning people into statistics.'],
    ['Side quest', 'The thing we made for no reason', 'A playful collaborative project that says more than a formal case study.'],
  ].map(([eyebrow, title, copy]) => `<article><small>${eyebrow}</small><strong>${title}</strong><p>${copy}</p></article>`).join('');
  renderTimeline($('frnd-timeline'), 'friend', $('frnd-content-panel'), SAMPLE_TIMELINE);
  mountTaggedPosts($('frnd-posts'), 'friend');
  renderWall($('frnd-wall'), { path: 'friend', compact: true });
  mountMessageBox($('frnd-msgbox'), 'friend');
}

Object.assign(window, { showFriendContent, replayFriendTrials });
