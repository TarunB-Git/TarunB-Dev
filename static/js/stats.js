/* Consent-gated first-party event collection and public aggregates. */
import { analyticsAllowed } from './consent.js';
import { maybeGet, v1 } from './v1.js';

const SESSION_KEY = 'portfolio_analytics_session_v1';
const SENT_KEY = 'portfolio_analytics_events_v1';

export function bucketReferrer(raw) {
  if (!raw) return 'Direct / QR';
  try {
    const host = new URL(raw).hostname.toLowerCase().replace(/^www\./, '');
    if (!host || host === location.hostname.toLowerCase().replace(/^www\./, '')) return 'Direct / QR';
    if (host === 'linkedin.com' || host.endsWith('.linkedin.com')) return 'LinkedIn';
    if (host === 'github.com' || host.endsWith('.github.com')) return 'GitHub';
    if (/(^|\.)(google|bing|duckduckgo|yahoo|ecosia|brave)\./.test(host)) return 'Search';
    if (/(^|\.)(facebook|instagram|threads|x|twitter|mastodon|bsky|reddit|tiktok)\./.test(host)) return 'Social';
  } catch { /* malformed referrers are deliberately collapsed */ }
  return 'Other';
}

const landingSource = bucketReferrer(document.referrer || '');

function audienceContext() {
  const ua = navigator.userAgent || '';
  const width = Math.min(screen.width || innerWidth, screen.height || innerHeight);
  const device_class = /Mobi|Android|iPhone|iPod/i.test(ua) ? 'mobile'
    : (/iPad|Tablet/i.test(ua) || width < 900 ? 'tablet' : 'desktop');
  const browser_family = /Edg\//.test(ua) ? 'Edge'
    : /Firefox\//.test(ua) ? 'Firefox'
      : /Chrome\//.test(ua) ? 'Chrome'
        : /Safari\//.test(ua) ? 'Safari' : 'Other';
  const rawLanguage = String(navigator.language || '').toLowerCase().split('-')[0];
  const language = /^[a-z]{2,3}$/.test(rawLanguage) ? rawLanguage : 'other';
  let timezone_region = 'Other';
  try {
    const region = String(Intl.DateTimeFormat().resolvedOptions().timeZone || '').split('/')[0];
    if (['Africa', 'America', 'Asia', 'Australia', 'Europe', 'Pacific'].includes(region)) {
      timezone_region = region === 'America' ? 'Americas'
        : ['Australia', 'Pacific'].includes(region) ? 'Oceania' : region;
    }
  } catch { /* coarse audience context remains Other */ }
  return { device_class, browser_family, language, timezone_region };
}

function randomId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  globalThis.crypto?.getRandomValues?.(bytes);
  return [...bytes].map(x => x.toString(16).padStart(2, '0')).join('') || `${Date.now()}-${Math.random()}`;
}

function sessionId() {
  let id = sessionStorage.getItem(SESSION_KEY);
  if (!id) {
    id = randomId();
    sessionStorage.setItem(SESSION_KEY, id);
  }
  return id;
}

function sentEvents() {
  try { return new Set(JSON.parse(sessionStorage.getItem(SENT_KEY) || '[]')); }
  catch { return new Set(); }
}

function rememberEvent(key) {
  const sent = sentEvents();
  sent.add(key);
  sessionStorage.setItem(SENT_KEY, JSON.stringify([...sent].slice(-80)));
}

export function sendStat(type, path = '', { once = false } = {}) {
  if (!analyticsAllowed()) return Promise.resolve({ skipped: true });
  const key = `${type}:${path || '-'}`;
  if (once && sentEvents().has(key)) return Promise.resolve({ duplicate: true });
  const body = {
    type,
    path,
    session_id: sessionId(),
    event_id: randomId(),
    landing_referrer: type === 'view' ? landingSource : undefined,
    ...(type === 'view' ? audienceContext() : {}),
  };
  if (once) rememberEvent(key);
  return v1.post('/stats/events', body, { headers: { 'X-Analytics-Consent': 'true' } })
    .catch(() => null);
}

export function trackView() {
  if (analyticsAllowed()) sendStat('view', '', { once: true });
}

export function withdrawAnalyticsSession() {
  try {
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(SENT_KEY);
  } catch { /* storage may be unavailable */ }
  return v1.del('/stats/session').catch(() => null);
}

window.addEventListener('privacychange', event => {
  if (event.detail?.analytics) trackView();
  else withdrawAnalyticsSession();
});

const fmt = n => Number(n || 0).toLocaleString();
let statsReturnFocus = null;

function prepareStatsDialog(modal) {
  if (!modal || modal.dataset.a11yReady) return;
  modal.dataset.a11yReady = 'true';
  modal.inert = true;
  modal.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeStats();
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

export async function openStats() {
  sendStat('stats_open');
  const mo = document.getElementById('stmo');
  if (!mo) return;
  prepareStatsDialog(mo);
  statsReturnFocus = document.activeElement;
  mo.inert = false;
  mo?.classList.add('open');
  mo?.setAttribute('aria-hidden', 'false');
  requestAnimationFrame(() => mo?.querySelector('.xb')?.focus());
  const s = await maybeGet('/stats/public');
  if (!s) return;
  const t = s.totals || {}, w = s.this_week || {};
  setText('st-views', fmt(t.view));
  setText('st-views-sub', `${fmt(w.view)} this week`);
  setText('st-resume', fmt(t.resume_open));
  setText('st-resume-sub', pct(t.resume_open, t.view) + ' of consented visits');
  setText('st-vcard', fmt(t.vcard));
  setText('st-vcard-sub', pct(t.vcard, t.view) + ' conversion');
  setText('st-shares', fmt(t.share));
  setText('st-shares-sub', `${fmt(w.share)} this week`);
  const bookings = Number(t.booking_click || 0) + Number(t.chat_book || 0);
  const weeklyBookings = Number(w.booking_click || 0) + Number(w.chat_book || 0);
  setText('st-bookings', fmt(bookings));
  setText('st-bookings-sub', `${fmt(weeklyBookings)} this week`);
  setText('st-card-flips', fmt(t.card_flip));
  setText('st-card-flips-sub', `${fmt(w.card_flip)} this week`);
  setText('st-paths', fmt(Object.values(s.paths || {}).reduce((a, b) => a + b, 0)));
  setText('st-paths-sub', topPath(s.paths));
  fillPaths(s.paths);
  fillSources(s.sources);
  fillWeekly(s.daily);
  setTimeout(() => {
    document.querySelectorAll('#stmo .bfill').forEach(f => { f.style.transform = `scaleX(${f.dataset.w || 0})`; });
  }, 80);
}

export function closeStats() {
  const mo = document.getElementById('stmo');
  mo?.classList.remove('open');
  mo?.setAttribute('aria-hidden', 'true');
  if (mo) mo.inert = true;
  document.querySelectorAll('#stmo .bfill').forEach(f => { f.style.transform = 'scaleX(0)'; });
  statsReturnFocus?.focus?.({ preventScroll: true });
  statsReturnFocus = null;
}

function setText(id, txt) {
  const el = document.getElementById(id);
  if (el) el.textContent = txt;
}

function pct(a, b) {
  return b ? `${((a || 0) / b * 100).toFixed(1)}%` : '0%';
}

function topPath(paths = {}) {
  const entries = Object.entries(paths);
  if (!entries.length) return 'no path chosen yet';
  entries.sort((a, b) => b[1] - a[1]);
  return `most walked: ${entries[0][0]}`;
}

function fillSources(sources = {}) {
  const wrap = document.getElementById('st-sources');
  if (!wrap) return;
  const total = Object.values(sources).reduce((a, b) => a + b, 0);
  wrap.replaceChildren();
  const entries = Object.entries(sources).sort((a, b) => b[1] - a[1]);
  if (!entries.length) {
    wrap.innerHTML = '<div class="brow"><span>no consented visits recorded yet</span><span>—</span></div>';
    return;
  }
  entries.forEach(([name, count]) => {
    const share = total ? count / total : 0;
    const row = document.createElement('div');
    row.className = 'brow';
    const label = document.createElement('span');
    label.textContent = name;
    const value = document.createElement('span');
    value.textContent = `${Math.round(share * 100)}%`;
    row.append(label, value);
    const track = document.createElement('div');
    track.className = 'btrack';
    const fill = document.createElement('div');
    fill.className = 'bfill';
    fill.dataset.w = share.toFixed(2);
    track.appendChild(fill);
    wrap.append(row, track);
  });
}

function fillPaths(paths = {}) {
  const wrap = document.getElementById('st-path-split');
  if (!wrap) return;
  const order = ['recruiter', 'friend', 'viewer', 'personal'];
  const total = Object.values(paths).reduce((sum, value) => sum + Number(value || 0), 0);
  wrap.replaceChildren();
  if (!total) {
    wrap.innerHTML = '<div class="brow"><span>no paths walked yet</span><span>—</span></div>';
    return;
  }
  order.forEach(name => {
    const count = Number(paths[name] || 0);
    const share = count / total;
    const row = document.createElement('div');
    row.className = 'brow';
    const label = document.createElement('span');
    label.textContent = name;
    const value = document.createElement('span');
    value.textContent = `${count.toLocaleString()} · ${Math.round(share * 100)}%`;
    row.append(label, value);
    const track = document.createElement('div');
    track.className = 'btrack';
    const fill = document.createElement('div');
    fill.className = 'bfill';
    fill.dataset.w = share.toFixed(2);
    track.appendChild(fill);
    wrap.append(row, track);
  });
}

function utcDay(date) {
  return date.toISOString().slice(0, 10);
}

function fillWeekly(daily = []) {
  const wrap = document.getElementById('st-weekly');
  if (!wrap) return;
  const today = new Date();
  const end = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const days = Array.from({ length: 7 }, (_, index) =>
    utcDay(new Date(end - (6 - index) * 86_400_000)));
  const byDay = new Map(days.map(day => [day, { visits: 0, actions: 0 }]));
  (Array.isArray(daily) ? daily : []).forEach(row => {
    const bucket = byDay.get(String(row?.day || ''));
    if (!bucket) return;
    const count = Math.max(0, Number(row.count) || 0);
    if (row.event_type === 'view') bucket.visits += count;
    else bucket.actions += count;
  });
  const max = Math.max(1, ...[...byDay.values()].map(item => item.visits + item.actions));
  const formatter = new Intl.DateTimeFormat(undefined, {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC',
  });
  wrap.replaceChildren();
  days.forEach(day => {
    const activity = byDay.get(day);
    const total = activity.visits + activity.actions;
    const row = document.createElement('div');
    row.className = 'brow';
    row.dataset.day = day;
    const label = document.createElement('span');
    label.textContent = formatter.format(new Date(`${day}T00:00:00Z`));
    const value = document.createElement('span');
    value.textContent = `${fmt(activity.visits)} visits · ${fmt(activity.actions)} actions`;
    row.append(label, value);
    const track = document.createElement('div');
    track.className = 'btrack';
    const fill = document.createElement('div');
    fill.className = 'bfill';
    fill.dataset.w = (total / max).toFixed(2);
    track.appendChild(fill);
    wrap.append(row, track);
  });
}
