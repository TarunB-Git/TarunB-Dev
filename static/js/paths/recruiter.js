/* Recruiter path: the business card (ported from card.html) + recruiter timeline.
   Dark (default): card → timeline of experience/projects/education.
   Light ("Recruiter Mode", body.rm-on): card → Selected Work → Career, as before.
   The card folds into the mini navbar when the overlay scrolls. */
import { renderTimeline } from '../timeline.js';
import { maybeGet } from '../v1.js';
import { sendStat, openStats, closeStats } from '../stats.js';
import { mountMessageBox, renderWall } from '../messages.js';
import { mountTaggedPosts } from '../blog.js';
import { setCursorPath } from '../cursor.js';
import { applyBookingLink, loadBookingUrl } from '../booking.js';

const $ = id => document.getElementById(id);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const esc = s => { const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML; };
const REDUCED_MOTION = matchMedia('(prefers-reduced-motion: reduce)');

let CARD = null, RESUME = null;
let booted = false, bootDone = false;
let usingSampleCard = false;

const SAMPLE_CARD = {
  name: 'Tarun Boddeda',
  role: 'Software Developer / Foward Deployed Engineer / Researcher',
  status: 'Available for the right opportunity',
  updated: 'Sep 2026 profile',
  chips: ['Product engineering', 'Machine Learning', 'System Design'],
  email: 'tarunb.co@gmail.com',
  phone: '+46767464810',
  phone_display: '+46 (767) 464 810',
  tagline: 'I research, build, deploy and ship.',
  logos: ['BTH', 'OPEN SOURCE'],
  recs: [
    { q: "Tarun's contribution and commitment are highly satisfactory. He is a good team player and it has been a pleasure to work with him.", a: 'Ravi Pasupuleti · CEO, Baylogic' },
    { q: 'I have been in contact with Tarun in his role as a mentor and have been consistently impressed by his commitment, initiative and positive impact on the students he has supported.', a: 'Susana Nikolin · Intize' },
  ],
  selected_work: [
    { num: '01', title: 'Project Atlas', sub: 'Platform redesign · Sample case study', stat: 'Result: +32% task completion', year: '2025' },
    { num: '02', title: 'Cloud Console', sub: 'Developer tooling · Sample product', stat: 'Result: 40% faster setup', year: '2024' },
    { num: '03', title: 'Design System', sub: 'Cross-team foundation · Sample program', stat: 'Result: adopted by 6 teams', year: '2023' },
  ],
  career: [
    { year: '2026 — PRESENT', role: 'Research Collaborator', co: 'Independent', desc: 'Describe the scope, team, and clearest measurable outcome.' },
    { year: '2026 — PRESENT', role: 'Linux Kernel Summer Mentee', co: 'Linux Foundation', desc: 'Summarize the systems you owned and the users you served.' },
    { year: '2025 — 2026', role: 'B.Sc. Comp Sci (AI & ML)', co: 'Blekinge Institute of Technology', desc: 'Add the credential only if it strengthens the story.' },
  ],
  footer: 'your-domain.example · sample content',
};

const SAMPLE_RESUME = {
  stub: 'Research Collaborator/ Dev · tarunb.co@gmail.com · your-domain.example',
  experience: SAMPLE_CARD.career.map(item => ({ role: item.role, co: item.co, dates: item.year, desc: item.desc })),
  education: [{ role: 'Relevant degree or training', co: 'Institution Name', dates: '20XX — 20XX', desc: 'Optional focus or distinction.' }],
  notable: SAMPLE_CARD.selected_work.map(item => ({ title: item.title, desc: `${item.sub}; ${item.stat}` })),
};

const SAMPLE_TIMELINE = {
  periods: [
    { label: '2022', events: [{ slug: 'sample-foundation', category: 'Foundation', title: 'Joined Company Name', summary: 'Set the baseline: role, team, product area, and the problem you inherited.', details_md: 'Replace this with the context a recruiter needs to understand your starting point.', layout: 'upper', accent: 'blue' }] },
    { label: '2023', events: [
      { slug: 'sample-system', category: 'Systems', title: 'Built the shared foundation', summary: 'A sample milestone showing ownership across teams.', details_md: 'Explain the decision, your contribution, and the measurable effect.', layout: 'feature', accent: 'gold', important: true },
      { slug: 'sample-mentoring', category: 'Team note', title: 'Started a mentoring circle', summary: 'A smaller event that becomes visible when “All events” is selected.', details_md: 'Use the complete view for talks, internal launches, awards, mentoring, and other context.', layout: 'lower', accent: 'teal', important: false },
    ] },
    { label: '2024', events: [{ slug: 'sample-launch', category: 'Launch', title: 'Shipped Project Atlas', summary: 'A representative launch with a clear customer outcome.', details_md: 'Add one short result, one constraint, and what you learned.', layout: 'media-right', accent: 'violet' }] },
    { label: 'Now', events: [{ slug: 'sample-now', category: 'Direction', title: 'What you want to build next', summary: 'Close with the kind of challenge, team, and impact you are looking for.', details_md: 'This makes the timeline forward-looking instead of ending at the last job.', layout: 'lower', accent: 'teal' }] },
  ],
};

async function loadContent(key) {
  const record = await maybeGet(`/content/${encodeURIComponent(key)}`);
  return record && typeof record === 'object' && 'data' in record ? record.data || {} : {};
}

export async function initRecruiterPath() {
  setCursorPath('recruiter');
  prepareResumeDialog();
  prepareShareDialog();
  ensureMiniModeButton();
  if (booted) {
    setShellSwitchInMini(Boolean($('mini')?.classList.contains('show')) && document.body.dataset.shellMode === 'world');
    cycleRecs();
    requestAnimationFrame(handleScroll);
    return;
  }
  booted = true;
  const [cardContent, resumeContent] = await Promise.all([loadContent('card'), loadContent('resume')]);
  usingSampleCard = !cardContent.name && !cardContent.role;
  CARD = usingSampleCard ? structuredClone(SAMPLE_CARD) : { ...SAMPLE_CARD, ...cardContent };
  RESUME = (!resumeContent.stub && !(resumeContent.experience || []).length)
    ? structuredClone(SAMPLE_RESUME)
    : { ...SAMPLE_RESUME, ...resumeContent };
  fillStaticContent();
  const bookingUrl = await loadBookingUrl();
  for (const id of ['cal-btn', 'mini-cal']) applyBookingLink($(id), bookingUrl);
  $('rec-scroll').addEventListener('scroll', handleScroll, { passive: true });
  refreshCardViewCount();
  bindCardInteractions();
  await renderTimeline($('rec-timeline'), 'recruiter', $('rec-scroll'), SAMPLE_TIMELINE);
  initRecruiterTimelineTools();
  const sampleNote = $('rec-timeline-sample');
  if (sampleNote) sampleNote.hidden = $('rec-timeline')?.dataset.timelineSample !== 'true';
  document.body.classList.toggle('using-sample-card', usingSampleCard);
  mountTaggedPosts($('rec-posts'), 'recruiter');
  mountMessageBox($('rec-msgbox'), 'recruiter');
  renderWall($('rec-wall'), { path: 'recruiter', compact: true });
  $('cal-btn')?.addEventListener('click', () => sendStat('booking_click'));
  $('mini-cal')?.addEventListener('click', () => sendStat('booking_click'));
  dropCard();
}

function ensureMiniModeButton() {
  if ($('mini-mode')) return;
  const actions = document.querySelector('#mini .mini-acts');
  if (!actions) return;
  const button = document.createElement('button');
  button.id = 'mini-mode';
  button.type = 'button';
  button.className = 'mab';
  button.addEventListener('click', () => window.dispatchEvent(new CustomEvent('recruitermoderequest')));
  const worldLink = actions.querySelector('a:last-child');
  actions.insertBefore(button, worldLink || null);
  updateModeControls();
}

function updateModeControls() {
  const on = isRecruiterMode();
  const toggle = $('rtog');
  toggle?.setAttribute('role', 'switch');
  toggle?.setAttribute('tabindex', '0');
  toggle?.setAttribute('aria-checked', String(on));
  const label = toggle?.querySelector('.rtlbl');
  if (label) label.textContent = on ? 'Dark recruiter view' : 'Light résumé view';
  const mini = $('mini-mode');
  if (mini) {
    mini.textContent = on ? 'Dark' : 'Light';
    mini.setAttribute('aria-label', on ? 'Switch to dark recruiter view' : 'Switch to light recruiter mode');
    mini.setAttribute('aria-pressed', String(on));
  }
}

function prepareResumeDialog() {
  const modal = $('rmo');
  const box = modal?.querySelector('.rm-box');
  if (!modal || modal.dataset.a11yReady) return;
  modal.dataset.a11yReady = 'true';
  modal.setAttribute('aria-hidden', 'true');
  box?.setAttribute('role', 'dialog');
  box?.setAttribute('aria-modal', 'true');
  box?.setAttribute('aria-label', 'Resume');
  modal.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeResume();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [...modal.querySelectorAll('button,a[href],[tabindex]:not([tabindex="-1"])')]
      .filter(element => !element.disabled && element.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && modal.classList.contains('open')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      closeResume();
    }
  }, true);
}

function afterMotion(element, eventName, callback, timeout = 900) {
  let done = false;
  const finish = event => {
    if (event && event.target !== element) return;
    if (done) return;
    done = true;
    element.removeEventListener(eventName, finish);
    clearTimeout(timer);
    callback();
  };
  const timer = setTimeout(finish, REDUCED_MOTION.matches ? 0 : timeout);
  element.addEventListener(eventName, finish);
}

/* ── Content fill ────────────────────────────────────────── */

function renderProfileLinks(card) {
  // Only the artwork is static markup; profile URLs always come from Admin → Card.
  const profiles = [
    ['GitHub', card.github_url, '<path d="M12 .8a11.2 11.2 0 0 0-3.54 21.83c.56.1.77-.24.77-.54v-2.08c-3.13.68-3.79-1.33-3.79-1.33-.51-1.3-1.25-1.65-1.25-1.65-1.02-.7.08-.68.08-.68 1.13.08 1.73 1.16 1.73 1.16 1 1.72 2.63 1.22 3.27.93.1-.73.39-1.22.71-1.5-2.5-.29-5.13-1.25-5.13-5.57 0-1.23.44-2.23 1.15-3.01-.12-.29-.5-1.43.11-2.98 0 0 .95-.31 3.08 1.15a10.7 10.7 0 0 1 5.6 0c2.14-1.46 3.08-1.15 3.08-1.15.62 1.55.23 2.69.11 2.98.72.78 1.15 1.78 1.15 3.01 0 4.33-2.63 5.28-5.14 5.56.4.35.76 1.04.76 2.09v3.07c0 .3.2.65.77.54A11.2 11.2 0 0 0 12 .8Z"/>'],
    ['LinkedIn', card.linkedin_url, '<path d="M4.6 3a1.8 1.8 0 1 1 0 3.6 1.8 1.8 0 0 1 0-3.6ZM3 8h3.2v13H3Zm5.5 0h3.1v1.8C12.4 8.5 13.7 7.7 15.5 7.7c3.4 0 4.5 2.1 4.5 5.5V21h-3.3v-7.1c0-1.9-.4-3.3-2.3-3.3-1.9 0-2.6 1.3-2.6 3.3V21H8.5Z"/>'],
  ];
  for (const id of ['card-socials', 'mini-socials', 'resume-socials']) {
    const container = $(id);
    container.replaceChildren();
    for (const [label, value, artwork] of profiles) {
      let href = '';
      try {
        const url = new URL(value);
        if (['https:', 'http:'].includes(url.protocol)) href = url.href;
      } catch { /* An unset profile is visible but never links to a made-up account. */ }
      const link = document.createElement(href ? 'a' : 'span');
      link.className = 'profile-link';
      link.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${artwork}</svg>`;
      link.setAttribute('aria-label', href ? label : `${label} — profile not configured`);
      link.title = href ? label : `${label} — add profile URL in Admin → Card`;
      if (href) {
        link.href = href;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
      } else {
        link.setAttribute('role', 'img');
        link.dataset.disabled = 'true';
      }
      container.append(link);
    }
  }
}

function fillStaticContent() {
  const c = CARD;
  renderProfileLinks(c);
  ['card-name', 'mini-name'].forEach(id => $(id).textContent = c.name || '');
  $('card-updated').textContent = c.updated || '';
  $('card-status').textContent = c.status || '';
  $('mini-role').textContent = c.role || '';
  $('card-chips').innerHTML = (c.chips || []).map(x => `<div class="chip">${esc(x)}</div>`).join('');
  const email = $('card-email');
  email.textContent = c.email || '';
  email.closest('.ci').hidden = !c.email;
  if (c.email) email.href = `mailto:${c.email}`;
  else email.removeAttribute('href');
  const phone = $('card-phone');
  phone.textContent = c.phone_display || c.phone || '';
  phone.closest('.ci').hidden = !c.phone;
  if (c.phone) phone.href = `tel:${c.phone}`;
  else phone.removeAttribute('href');
  const whatsapp = $('card-whatsapp');
  const whatsappNumber = String(c.phone || '').replace(/\D/g, '');
  if (whatsappNumber) {
    whatsapp.href = `https://wa.me/${whatsappNumber}`;
    whatsapp.hidden = false;
  } else {
    whatsapp.removeAttribute('href');
    whatsapp.hidden = true;
  }
  $('card-tagline').innerHTML = esc(c.tagline || '').replace(/\n/g, '<br>');
  $('card-logos').innerHTML = (c.logos || []).map(x => `<div class="logo">${esc(x)}</div>`).join('');
  $('rec-foot').textContent = c.footer || '';

  $('sw-list').innerHTML = (c.selected_work || []).map(w => `
    <div class="work-item"><div class="wi-num">${esc(w.num)}</div>
    <div class="wi-body"><div class="wi-title">${esc(w.title)}</div>
    <div class="wi-sub">${esc(w.sub)}</div><div class="wi-stat">${esc(w.stat)}</div></div>
    <div class="wi-year">${esc(w.year)}</div></div>`).join('');
  $('career-list').innerHTML = (c.career || []).map(t => `
    <div class="ctl-item"><div class="ctl-year">${esc(t.year)}</div>
    <div class="ctl-role">${esc(t.role)}</div><div class="ctl-co">${esc(t.co)}</div>
    <div class="ctl-desc">${esc(t.desc)}</div></div>`).join('');
  renderNotableWork(c, RESUME);

  const r = RESUME;
  $('rm-name').textContent = c.name || '';
  $('rm-stub').textContent = r.stub || '';
  const entry = e => `<div class="re"><div class="rrl">${esc(e.role)}</div>
    <div class="rco"><span>${esc(e.co)}</span><span>${esc(e.dates)}</span></div>
    ${e.desc ? `<div class="rd">${esc(e.desc)}</div>` : ''}</div>`;
  $('rm-exp').innerHTML = (r.experience || []).map(entry).join('');
  $('rm-edu').innerHTML = (r.education || []).map(entry).join('');
  $('rm-notable').innerHTML = (r.notable || []).map(n =>
    `<strong>${esc(n.title)}</strong> — ${esc(n.desc)}<br>`).join('');
}

const SAMPLE_NOTABLE = [
  { kind: 'Product · 2025', title: 'Project Atlas', summary: 'A platform redesign framed around the problem, your decisions, and a measurable result.' },
  { kind: 'Publication · 2025', title: 'Article or Paper', summary: 'The central idea, venue, collaborators, and why the work mattered.' },
  { kind: 'Open source · Active', title: 'Repository Name', summary: 'A useful tool, the people it serves, and the contribution you made.' },
  { kind: 'Prototype · 2024', title: 'Cloud Console', summary: 'An exploratory interface that reduced setup friction and clarified the first-run experience.' },
  { kind: 'Talk · 2024', title: 'Designing for Complex Systems', summary: 'A concise talk or workshop with its audience and practical takeaway.' },
  { kind: 'Research · 2023', title: 'Field Study', summary: 'A compact account of the question, method, and insight carried into product work.' },
];

function renderNotableWork(card, resume) {
  const source = (card.selected_work || []).map((item, index) => ({
    kind: `Project · ${item.year || 'Selected'}`,
    title: item.title || `Project ${index + 1}`,
    summary: [item.sub, item.stat].filter(Boolean).join(' — '),
  }));
  (resume.notable || []).forEach(item => {
    if (!source.some(entry => entry.title === item.title)) source.push({
      kind: 'Publication or project', title: item.title, summary: item.desc,
    });
  });
  const items = usingSampleCard ? SAMPLE_NOTABLE : source;
  const grid = $('rec-notable-grid');
  if (!grid) return;
  grid.innerHTML = items.map((item, index) => `<article${index > 2 ? ' class="rec-notable-extra"' : ''}>
    <span class="rec-notable-thumb" aria-hidden="true"><i>${String(index + 1).padStart(2, '0')}</i></span>
    <span class="rec-notable-copy"><small>${esc(item.kind || 'Selected work')}</small><strong>${esc(item.title)}</strong><p>${esc(item.summary || '')}</p></span>
  </article>`).join('');
  const toggle = $('rec-notable-toggle');
  const heading = $('rec-notable-heading');
  toggle.hidden = items.length <= 3;
  const setExpanded = expanded => {
    grid.classList.toggle('is-expanded', expanded);
    toggle.setAttribute('aria-expanded', String(expanded));
    toggle.textContent = expanded ? 'View less' : 'Read more';
    heading.textContent = expanded ? 'Projects & Publications' : 'Notable Projects & Publications';
  };
  setExpanded(false);
  toggle.onclick = () => setExpanded(toggle.getAttribute('aria-expanded') !== 'true');
}

function initRecruiterTimelineTools() {
  const container = $('rec-timeline');
  const select = $('rec-timeline-filter');
  const news = $('rec-news');
  const timeline = container?.timelineData;
  if (!container || !select || !timeline) return;
  const apply = () => {
    const importantOnly = select.value === 'important';
    container.querySelectorAll('.tl-event').forEach(event => {
      event.classList.toggle('is-event-filtered', importantOnly && event.dataset.important !== 'true');
    });
  };
  select.onchange = apply;
  apply();
  if (news) {
    const items = timeline.periods.flatMap(period => period.events.map(event => ({ ...event, period: period.label })));
    news.innerHTML = items.length ? items.map(event => `<article>
      <time>${esc(event.period)}</time><div><small>${esc(event.category || 'Milestone')}</small><strong>${esc(event.title)}</strong><p>${esc(event.summary)}</p></div>
    </article>`).join('') : '<p class="wall-empty">No timeline notes yet.</p>';
  }
}

async function refreshCardViewCount() {
  const stats = await maybeGet('/stats/public');
  if (!stats) return;
  const count = Number(stats.totals?.view || 0).toLocaleString();
  if ($('apill-views')) $('apill-views').textContent = `${count} views`;
}

/* ── Boot: drop + greeting + decode ─────────────────────── */

// Scrolling takes priority over the greeting. Its async work must never reveal
// the card again after the user has already folded it into the navigation.
let introCancelled = false;
function finishCardIntro() {
  if (bootDone) return;
  introCancelled = true;
  $('cardWrap').classList.remove('do-drop');
  $('cardWrap').classList.add('card-visible');
  $('cfi').style.opacity = '1';
  $('cg').style.opacity = '0';
  $('cg').style.display = 'none';
  $('role').textContent = CARD.role || '';
  cycleRecs();
  makeQR();
  bootDone = true;
}

function dropCard() {
  if (bootDone) { handleScroll(); return; }
  const cw = $('cardWrap');
  if (document.body.dataset.shellMode === 'directory' || $('rec-scroll').scrollTop >= FOLD_AT()) {
    finishCardIntro();
    handleScroll();
    return;
  }
  cw.classList.add('do-drop');
  afterMotion(cw, 'animationend', async () => {
    if (introCancelled) return;
    cw.classList.add('card-visible');
    cw.classList.remove('do-drop');
    if (!REDUCED_MOTION.matches) await greetOnCard();
    if (introCancelled) return;
    $('cfi').style.opacity = '1';
    $('cg').style.opacity = '0';
    if (!REDUCED_MOTION.matches) await sleep(520);
    if (introCancelled) return;
    $('cg').style.display = 'none';
    decodeRole(); cycleRecs(); makeQR();
    bootDone = true;
    handleScroll();
  }, 2400);
}

function getGreeting() {
  const h = new Date().getHours(), r = document.referrer;
  let p = h < 5 ? 'Still up?' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  if (r.includes('linkedin.com')) p = 'You found me on LinkedIn';
  else if (r.includes('github.com')) p = 'Fellow builder';
  else if (r.includes('twitter.com') || r.includes('x.com')) p = 'From the timeline';
  return p + ' —';
}

async function type(el, txt, spd) {
  for (let i = 0; i <= txt.length && !introCancelled; i++) { el.textContent = txt.slice(0, i); await sleep(spd + Math.random() * 14 - 7); }
}

async function greetOnCard() {
  $('cg').style.opacity = '1';
  await sleep(140);
  await type($('cgpre'), getGreeting(), 50);
  await sleep(55);
  await type($('cgname'), CARD.name || '', 72);
  await sleep(980);
  $('cgcur').style.transition = 'opacity 0.3s';
  $('cgcur').style.opacity = '0';
  await sleep(280);
}

function decodeRole() {
  const ROLE = CARD.role || '';
  const el = $('role'), ch = '█▓▒░▪';
  if (REDUCED_MOTION.matches) { el.textContent = ROLE; return; }
  const st = ROLE.split('').map(c => c === ' ' ? ' ' : ch[0]);
  const done = new Set();
  function step() {
    const left = [];
    for (let i = 0; i < ROLE.length; i++) if (!done.has(i) && ROLE[i] !== ' ') left.push(i);
    if (!left.length) { el.textContent = ROLE; return; }
    done.add(left[Math.floor(Math.random() * left.length)]);
    for (let i = 0; i < st.length; i++) {
      if (done.has(i)) st[i] = ROLE[i];
      else if (ROLE[i] !== ' ') st[i] = ch[Math.floor(Math.random() * ch.length)];
    }
    el.textContent = st.join('');
    setTimeout(step, 50 + Math.random() * 36);
  }
  el.textContent = st.join('');
  setTimeout(step, 200);
}

let ri = 0, recTimer = null, recFadeTimer = null;
function cycleRecs() {
  const RECS = CARD.recs || [];
  if (!RECS.length) return;
  const show = () => {
    $('rq').textContent = '"' + RECS[ri].q + '"';
    $('ra').textContent = '— ' + RECS[ri].a;
  };
  show();
  if (REDUCED_MOTION.matches || recTimer) return;
  recTimer = setInterval(() => {
    ri = (ri + 1) % RECS.length;
    const rq = $('rq'), ra = $('ra');
    rq.style.opacity = ra.style.opacity = '0';
    recFadeTimer = setTimeout(() => {
      show();
      rq.style.transition = ra.style.transition = 'opacity 0.5s';
      rq.style.opacity = ra.style.opacity = '1';
    }, 460);
  }, 5800);
}

function makeQR() {
  const el = $('qrc');
  el.innerHTML = '';
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', `QR code for ${CARD.url || location.origin}`);
  const dark = !document.body.classList.contains('rm-on');
  try {
    new QRCode(el, {
      text: CARD.url || location.origin, width: 54, height: 54,
      colorDark: dark ? '#f4d090' : '#3c2410',
      colorLight: dark ? '#0a0a1a' : '#c4c0b8',
      correctLevel: QRCode.CorrectLevel.M,
    });
    const hideImplementation = () => el.querySelectorAll('img,canvas').forEach(node => {
      node.setAttribute('aria-hidden', 'true');
      if (node.tagName === 'IMG') node.setAttribute('alt', '');
    });
    hideImplementation();
    requestAnimationFrame(hideImplementation);
  } catch (e) {
    el.innerHTML = `<div class="qr-fallback">QR<br>${esc((CARD.url || '').replace(/^https?:\/\//, ''))}</div>`;
  }
}

export function leaveRecruiterPath() {
  if (recTimer) clearInterval(recTimer);
  if (recFadeTimer) clearTimeout(recFadeTimer);
  recTimer = null;
  recFadeTimer = null;
  $('att')?.classList.remove('vis');
  setShellSwitchInMini(false);
}

/* ── Tilt + flip (ported verbatim, scoped) ──────────────── */

let tiltX = 0, tiltY = 0, tiltXt = 0, tiltYt = 0;
let isFlipping = false, tiltRaf = null, showingBack = false;
let foldActive = false, foldAnimating = false;
let shellSwitchHome = null;
let privacyHome = null;

function setShellSwitchInMini(embedded) {
  const shellSwitch = $('experience-switch');
  const privacy = $('privacy-settings');
  const miniBar = document.querySelector('#mini .mini-bar');
  if (!shellSwitch || !miniBar) return;
  if (!shellSwitchHome) {
    shellSwitchHome = document.createComment('experience switch home');
    shellSwitch.before(shellSwitchHome);
  }
  if (privacy && !privacyHome) {
    privacyHome = document.createComment('privacy control home');
    privacy.before(privacyHome);
  }
  if (embedded && document.body.dataset.shellMode === 'world') {
    miniBar.insertBefore(shellSwitch, miniBar.querySelector('.mini-acts'));
    shellSwitch.classList.add('is-mini-switch');
    if (privacy) {
      miniBar.insertBefore(privacy, miniBar.querySelector('.mini-acts'));
      privacy.classList.add('is-mini-privacy');
    }
  } else if (shellSwitchHome.parentNode) {
    shellSwitchHome.parentNode.insertBefore(shellSwitch, shellSwitchHome.nextSibling);
    shellSwitch.classList.remove('is-mini-switch');
    if (privacy && privacyHome?.parentNode) {
      privacyHome.parentNode.insertBefore(privacy, privacyHome.nextSibling);
      privacy.classList.remove('is-mini-privacy');
    }
  }
}

function setTiltTransform() {
  $('cw').style.transform = `rotateX(${tiltX.toFixed(3)}deg) rotateY(${tiltY.toFixed(3)}deg)`;
}
function tiltLoop() {
  if (isFlipping || foldActive) { tiltRaf = null; return; }
  const dx = tiltXt - tiltX, dy = tiltYt - tiltY;
  if (Math.abs(dx) < 0.005 && Math.abs(dy) < 0.005) {
    tiltX = tiltXt; tiltY = tiltYt; tiltRaf = null;
    setTiltTransform(); return;
  }
  tiltX += dx * 0.1; tiltY += dy * 0.1;
  setTiltTransform();
  tiltRaf = requestAnimationFrame(tiltLoop);
}
function showFace(back) {
  showingBack = back;
  $('cfront').style.display = back ? 'none' : 'block';
  $('cback').style.display = back ? 'block' : 'none';
  $('cw').setAttribute('aria-label', back ? 'Business card back' : 'Business card front');
}
function doFlip(rightSide) {
  if (isFlipping) return;
  isFlipping = true;
  sendStat('card_flip', 'recruiter');
  if (tiltRaf) { cancelAnimationFrame(tiltRaf); tiltRaf = null; }
  tiltX = 0; tiltY = 0; tiltXt = 0; tiltYt = 0;
  const cw = $('cw');
  if (REDUCED_MOTION.matches) {
    showFace(!showingBack);
    cw.style.transition = 'none';
    cw.style.transform = 'rotateX(0deg) rotateY(0deg)';
    isFlipping = false;
    return;
  }
  const edge = rightSide ? 90 : -90;
  cw.style.transition = 'transform 0.18s cubic-bezier(0.4,0,1,1)';
  cw.style.transform = `rotateX(0deg) rotateY(${edge}deg)`;
  afterMotion(cw, 'transitionend', () => {
    showFace(!showingBack);
    cw.style.transition = 'none';
    cw.style.transform = `rotateX(0deg) rotateY(${-edge}deg)`;
    cw.getBoundingClientRect();
    cw.style.transition = 'transform 0.22s cubic-bezier(0,0,0.58,1)';
    cw.style.transform = 'rotateX(0deg) rotateY(0deg)';
    afterMotion(cw, 'transitionend', () => {
      cw.style.transition = 'none';
      isFlipping = false;
      if (!tiltRaf) tiltRaf = requestAnimationFrame(tiltLoop);
    }, 420);
  }, 360);
}

function initHolo(face, holo) {
  face.addEventListener('mousemove', e => {
    if (REDUCED_MOTION.matches || !matchMedia('(hover:hover) and (pointer:fine)').matches) return;
    const r = face.getBoundingClientRect();
    const mx = (e.clientX - r.left) / r.width, my = (e.clientY - r.top) / r.height;
    const ang = Math.atan2(my - .5, mx - .5) * (180 / Math.PI);
    holo.style.background = `conic-gradient(from ${ang + 150}deg at ${mx * 100}% ${my * 100}%,transparent 0deg,rgba(160,120,255,.12) 40deg,rgba(80,200,255,.1) 90deg,rgba(255,200,90,.09) 140deg,rgba(80,255,160,.08) 195deg,transparent 220deg)`;
    holo.style.opacity = '1';
  });
  face.addEventListener('mouseleave', () => holo.style.opacity = '0');
}

function bindCardInteractions() {
  initHolo($('cfront'), $('holo'));
  initHolo($('cback'), $('holo2'));

  const card = $('cw');
  card.setAttribute('role', 'group');
  showFace(false);
  $('fhint')?.addEventListener('click', event => { event.stopPropagation(); doFlip(true); });
  $('bhint')?.addEventListener('click', event => { event.stopPropagation(); doFlip(false); });

  document.getElementById('ps-recruiter').addEventListener('mousemove', e => {
    if (foldActive || foldAnimating || isFlipping) return;
    tiltXt = -(e.clientY / innerHeight - .5) * 4.5;
    tiltYt = (e.clientX / innerWidth - .5) * 7;
    if (!tiltRaf) tiltRaf = requestAnimationFrame(tiltLoop);
    const rect = $('cw').getBoundingClientRect();
    if (rect.width > 0) $('fhint').textContent = (e.clientX - rect.left) > rect.width / 2 ? 'flip →' : '← flip';
  });

  let touchStart = null;
  let swipeClick = null;
  card.addEventListener('pointerdown', event => {
    // Leave links and action buttons to their normal tap handlers.
    if (swipeClick) swipeClick = null;
    if (event.pointerType !== 'touch' || event.target.closest('button,a,.apill') ||
        foldActive || foldAnimating || isFlipping) return;
    touchStart = { id: event.pointerId, x: event.clientX, y: event.clientY };
  }, { passive: true });

  const finishCardSwipe = event => {
    if (!touchStart || touchStart.id !== event.pointerId) return;
    const start = touchStart;
    touchStart = null;
    if (foldActive || foldAnimating || isFlipping) return;
    const deltaX = event.clientX - start.x;
    const deltaY = event.clientY - start.y;
    if (Math.abs(deltaX) < 44 || Math.abs(deltaX) < Math.abs(deltaY) * 1.2) return;
    swipeClick = { x: event.clientX, y: event.clientY, at: performance.now() };
    doFlip(deltaX > 0);
  };
  const cancelCardSwipe = event => {
    if (touchStart?.id === event.pointerId) touchStart = null;
  };
  window.addEventListener('pointerup', finishCardSwipe);
  window.addEventListener('pointercancel', cancelCardSwipe);

  $('cw').addEventListener('click', e => {
    if (swipeClick) {
      const sameSwipeClick = e.detail > 0 && performance.now() - swipeClick.at < 400 &&
        Math.hypot(e.clientX - swipeClick.x, e.clientY - swipeClick.y) < 36;
      swipeClick = null;
      if (sameSwipeClick) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
    }
    if (e.target.closest('button,a,.apill')) return;
    const rect = $('cw').getBoundingClientRect();
    doFlip((e.clientX - rect.left) > rect.width / 2);
  });

  // Analytics pill → live tooltip + stats modal. The request can resolve after
  // the pointer has already left, so guard the async result instead of letting
  // a stale response resurrect a tooltip that can no longer receive leave.
  const att = $('att');
  const analyticsPill = $('apill');
  const fineHover = matchMedia('(hover:hover) and (pointer:fine)');
  let previewActive = false;
  let previewVersion = 0;
  const hideAnalyticsPreview = () => {
    previewActive = false;
    previewVersion += 1;
    att.classList.remove('vis');
  };
  analyticsPill.addEventListener('pointerenter', async () => {
    if (!fineHover.matches) return;
    previewActive = true;
    const version = ++previewVersion;
    const s = await maybeGet('/stats/public');
    if (!previewActive || version !== previewVersion) return;
    if (s) {
      $('att-views').textContent = (s.totals.view || 0).toLocaleString();
      $('att-resume').textContent = (s.totals.resume_open || 0).toLocaleString();
      $('att-shares').textContent = (s.totals.share || 0).toLocaleString();
      $('att-vcards').textContent = (s.totals.vcard || 0).toLocaleString();
      $('apill-views').textContent = (s.totals.view || 0).toLocaleString() + ' views';
    }
    const r = analyticsPill.getBoundingClientRect();
    att.style.top = (r.bottom + 8) + 'px';
    att.style.left = Math.max(8, r.left) + 'px';
    att.classList.add('vis');
  });
  analyticsPill.addEventListener('pointerleave', hideAnalyticsPreview);
  analyticsPill.addEventListener('blur', hideAnalyticsPreview);
  analyticsPill.addEventListener('click', e => {
    e.stopPropagation();
    hideAnalyticsPreview();
    openStats();
  });
  $('rec-scroll')?.addEventListener('scroll', hideAnalyticsPreview, { passive: true });
  window.addEventListener('blur', hideAnalyticsPreview);
  const toggle = $('rtog');
  if (toggle && toggle.tagName !== 'BUTTON') toggle.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    toggleRM();
  });
  const stats = document.querySelector('.statslink');
  if (stats && stats.tagName !== 'BUTTON') stats.setAttribute('role', 'button');
  if (stats && stats.tagName !== 'BUTTON') stats.setAttribute('tabindex', '0');
  if (stats && stats.tagName !== 'BUTTON') stats.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    openStats();
  });
}

/* ── Scroll fold (overlay scroll container, not window) ── */

const FOLD_AT = () => Math.max(72, innerHeight * (innerWidth < 620 ? .24 : .3));
const UNFOLD_AT = () => Math.max(24, innerHeight * (innerWidth < 620 ? .1 : .14));

function handleScroll() {
  if (!CARD) return;
  const sy = $('rec-scroll').scrollTop;
  const fa = FOLD_AT();
  if (!bootDone && sy >= fa) finishCardIntro();
  if (!bootDone || foldAnimating) return;
  if (!foldActive && sy >= fa) { foldActive = true; doFold(); return; }
  if (foldActive && sy <= UNFOLD_AT()) { foldActive = false; doUnfold(); return; }
  if (!foldActive) {
    const p = clamp(sy / fa, 0, 1);
    $('below').style.opacity = (1 - p * p).toString();
  }
}

function doFold() {
  foldAnimating = true;
  if (tiltRaf) { cancelAnimationFrame(tiltRaf); tiltRaf = null; }
  tiltX = 0; tiltY = 0; tiltXt = 0; tiltYt = 0;
  isFlipping = false;
  if (showingBack) showFace(false);
  $('cw').style.transition = 'none';
  $('cw').style.transform = 'rotateX(0deg) rotateY(0deg)';
  $('below').style.opacity = '0'; $('below').style.pointerEvents = 'none';
  const cw = $('cardWrap');
  cw.classList.remove('folding-down', 'folded');
  cw.getBoundingClientRect();
  cw.classList.add('folding-up');
  const mini = $('mini');
  setShellSwitchInMini(document.body.dataset.shellMode === 'world');
  mini.classList.add('receiving');
  setTimeout(() => mini.classList.add('show'), REDUCED_MOTION.matches ? 0 : 250);
  afterMotion(cw, 'animationend', () => {
    cw.classList.remove('folding-up');
    cw.classList.add('folded');
    setTimeout(() => mini.classList.remove('receiving'), 420);
    foldAnimating = false;
    requestAnimationFrame(handleScroll);
  }, 1100);
}

function doUnfold() {
  foldAnimating = true;
  $('mini').classList.remove('show', 'receiving');
  setShellSwitchInMini(false);
  const cw = $('cardWrap');
  cw.classList.remove('folded', 'folding-up');
  cw.getBoundingClientRect();
  cw.classList.add('folding-down');
  afterMotion(cw, 'animationend', () => {
    cw.classList.remove('folding-down');
    foldAnimating = false;
    $('below').style.pointerEvents = '';
    const p = clamp($('rec-scroll').scrollTop / FOLD_AT(), 0, 1);
    $('below').style.opacity = (1 - p * p).toString();
    if (!tiltRaf && !isFlipping) tiltRaf = requestAnimationFrame(tiltLoop);
    requestAnimationFrame(handleScroll);
  }, 980);
}

/* ── Actions: copy / vCard / resume / share ─────────────── */

export function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove('on'), 2500);
}

async function cp(v, msg) {
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable');
    await navigator.clipboard.writeText(v);
    toast(msg);
  } catch {
    const input = document.createElement('textarea');
    input.value = v;
    input.setAttribute('readonly', '');
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.appendChild(input);
    input.select();
    const copied = document.execCommand?.('copy');
    input.remove();
    toast(copied ? msg : 'Copy unavailable — select the text manually');
  }
}

function dlVCard() {
  const c = CARD;
  const vcard = value => String(value || '')
    .replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/([,;])/g, '\\$1');
  const v = `BEGIN:VCARD\r\nVERSION:3.0\r\nFN:${vcard(c.name)}\r\nTITLE:${vcard(c.role)}\r\nEMAIL:${vcard(c.email)}\r\nTEL:${vcard(c.phone)}\r\nURL:${vcard(c.url)}\r\nEND:VCARD`;
  const a = document.createElement('a');
  const objectUrl = URL.createObjectURL(new Blob([v], { type: 'text/vcard' }));
  a.href = objectUrl;
  a.download = (c.name || 'contact').toLowerCase().replace(/\s+/g, '-') + '.vcf';
  a.click();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  sendStat('vcard');
  toast('Contact saved ✓');
}

let resumeReturnFocus = null;
function openResume() {
  const modal = $('rmo');
  resumeReturnFocus = document.activeElement;
  modal.inert = false;
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  modal.querySelector('.xb')?.focus();
  sendStat('resume_open');
}
function closeResume() {
  const modal = $('rmo');
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  modal.inert = true;
  resumeReturnFocus?.focus?.();
}

function dlResume() {
  sendStat('resume_open');
  const anchor = document.createElement('a');
  anchor.href = '/resume.pdf';
  anchor.download = '';
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  toast('Resume download started…');
}

function openResumePage() {
  sendStat('resume_open');
  window.open('/resume', '_blank', 'noopener,noreferrer');
}

let sBg = '#0a0a1a', sFg = '#fff4c8', sSub = '#c8bca8';
let shareReturnFocus = null;
function prepareShareDialog() {
  const modal = $('smo');
  if (!modal || modal.dataset.a11yReady) return;
  modal.dataset.a11yReady = 'true';
  modal.inert = true;
  modal.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeShare();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [...modal.querySelectorAll('button:not(:disabled),a[href],[tabindex]:not([tabindex="-1"])')]
      .filter(element => element.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0], last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
}
function openShare() {
  prepareShareDialog();
  const modal = $('smo');
  shareReturnFocus = document.activeElement;
  modal.inert = false;
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  requestAnimationFrame(() => modal.querySelector('.xb')?.focus());
}
function closeShare() {
  const modal = $('smo');
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  modal.inert = true;
  shareReturnFocus?.focus?.({ preventScroll: true });
  shareReturnFocus = null;
}
function pickColor(el) {
  document.querySelectorAll('.swatch').forEach(s => s.classList.remove('act'));
  el.classList.add('act');
  sBg = el.dataset.bg; sFg = el.dataset.fg; sSub = el.dataset.sub;
  $('sprev').style.background = sBg; $('spn').style.color = sFg; $('spr').style.color = sSub;
}
function cardShareUrl() {
  try {
    const publicBase = new URL(CARD?.url || location.href, location.href);
    if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname) && !/^(localhost|127\.0\.0\.1)$/.test(publicBase.hostname)) {
      return new URL('/recruiter', publicBase).href;
    }
  } catch { /* use the current page */ }
  return location.href;
}
function cpLink() { cp(cardShareUrl(), 'Link copied!'); sendStat('share'); }
function shareLinkedIn() {
  sendStat('share');
  const popup = window.open(
    'https://www.linkedin.com/sharing/share-offsite/?url=' + encodeURIComponent(cardShareUrl()),
    'linkedin-share', 'width=720,height=720',
  );
  if (popup) popup.opener = null;
  else toast('Allow pop-ups to open LinkedIn sharing.');
}
function dlCard() {
  const bhint = $('bhint'), cg = $('cg');
  bhint.style.visibility = 'hidden'; cg.style.display = 'none';
  const face = $('cfront'), orig = face.style.background;
  face.style.background = sBg;
  toast('Preparing image…');
  if (typeof html2canvas !== 'function') {
    face.style.background = orig; bhint.style.visibility = ''; cg.style.display = '';
    toast('Card export is unavailable right now');
    return;
  }
  html2canvas(face, {
    scale: 2.5, backgroundColor: sBg, logging: false, useCORS: true,
    ignoreElements: el => el.classList.contains('holo'),
  }).then(canvas => {
    face.style.background = orig; bhint.style.visibility = ''; cg.style.display = '';
    const a = document.createElement('a');
    a.download = 'card.png'; a.href = canvas.toDataURL('image/png'); a.click();
    sendStat('share');
    toast('Card image saved ✓'); closeShare();
  }).catch(() => {
    face.style.background = orig; bhint.style.visibility = ''; cg.style.display = '';
    toast('Try right-click → Save image');
  });
}

/* ── Recruiter Mode (formerly Light Mode) ───────────────── */

export function setRecruiterMode(on, spin = true) {
  document.body.classList.toggle('rm-on', on);
  $('rtog')?.classList.toggle('ron', on);
  document.getElementById('rm-global')?.classList.toggle('on', on);
  updateModeControls();
  if (booted) makeQR();
  if (!spin || !booted) return;
  if (REDUCED_MOTION.matches) {
    toast(on ? 'Recruiter mode on' : 'Dark mode restored');
    return;
  }
  // The Mask spin, only when the card is on screen
  if (showingBack) showFace(false);
  tiltX = 0; tiltY = 0; tiltXt = 0; tiltYt = 0;
  if (tiltRaf) { cancelAnimationFrame(tiltRaf); tiltRaf = null; }
  isFlipping = true;
  const cw = $('cw');
  cw.style.transition = 'none';
  cw.style.transform = 'rotateX(0deg) rotateY(0deg)';
  cw.getBoundingClientRect();
  cw.classList.add('spinning');
  afterMotion(cw, 'animationend', () => {
    cw.classList.remove('spinning');
    cw.style.transform = 'rotateX(0deg) rotateY(0deg)';
    isFlipping = false;
    if (!tiltRaf) tiltRaf = requestAnimationFrame(tiltLoop);
  }, 1800);
  toast(on ? 'Light mode on' : 'Dark mode restored');
}

export function isRecruiterMode() { return document.body.classList.contains('rm-on'); }

function toggleRM() { setRecruiterMode(!isRecruiterMode()); }

export {
  cp, dlVCard, openResume, closeResume, openShare, closeShare,
  pickColor, cpLink, shareLinkedIn, dlCard, toggleRM, dlResume,
  openResumePage,
};

/* Compatibility for the unserved card.html prototype. */
Object.assign(window, {
  cp, dlVCard, openResume, closeResume, openShare, closeShare,
  pickColor, cpLink, shareLinkedIn, dlCard, toggleRM, openStats, closeStats,
  dlResume, openResumePage,
});
