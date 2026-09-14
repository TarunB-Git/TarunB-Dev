/* Application shell: loader, four-path routing, history, and delegated actions. */
import { SND } from './audio.js';
import { cur, curRing, setFlame } from './cursor.js';
import { initWorld, onReturnToWorld, pauseWorld } from './graybox.js';
import { discardDirectoryApp, initDirectory, showDirectory, setDirectoryApp } from './directory.js';
import { bindConsentBanner } from './consent.js';
import { trackView, sendStat, openStats, closeStats } from './stats.js';
import {
  initRecruiterPath, leaveRecruiterPath, setRecruiterMode, isRecruiterMode,
  cp, dlVCard, openResume, closeResume, openShare, closeShare,
  pickColor, cpLink, shareLinkedIn, dlCard, dlResume,
} from './paths/recruiter.js';
import { initFriendPath, leaveFriendPath, showFriendContent } from './paths/friend.js';
import { initViewerPath } from './paths/viewer.js';
import { initPersonalPath } from './paths/personal.js';
import { closePost } from './blog.js';

const $ = id => document.getElementById(id);
const PATHS = new Set(['recruiter', 'friend', 'viewer', 'personal']);
const REDUCED_MOTION = matchMedia('(prefers-reduced-motion: reduce)');
const ov = $('ov');
const PATH_LABELS = {
  recruiter: 'Recruiter path',
  friend: 'Friend path',
  viewer: 'Curious viewer path',
  personal: 'Personal path',
};
const initFns = {
  recruiter: initRecruiterPath,
  friend: initFriendPath,
  viewer: initViewerPath,
  personal: initPersonalPath,
};
const leaveFns = {
  recruiter: leaveRecruiterPath,
  friend: leaveFriendPath,
};

const SHELL_KEY = 'portfolio-shell-mode-v1';
function savedShellMode() {
  const requested = new URL(location.href).searchParams.get('shell');
  if (requested === 'world' || requested === 'directory') return requested;
  if (new URL(location.href).searchParams.get('view') === 'world') return 'world';
  try { return localStorage.getItem(SHELL_KEY) === 'world' ? 'world' : 'directory'; } catch { return 'directory'; }
}
let activePath = null;
let worldFocusPath = 'recruiter';
let shellMode = savedShellMode();
let homeView = shellMode;
let transitionVersion = 0;
let initialRouteApplied = false;
document.body.dataset.shellMode = shellMode;
if ($('ld-mode-img')) $('ld-mode-img').src = shellMode === 'world' ? '/static/assets/ui/cloud.png' : '/static/assets/ui/device.png';

/* ── Loader ────────────────────────────────────────────── */
let displayed = 0;
let target = 8;
let loaderHidden = false;

function tickLoader() {
  displayed = Math.min(displayed + Math.max(2, (target - displayed) * 0.22), target);
  $('s-loading')?.style.setProperty('--load', `${displayed}%`);
  if (displayed >= 100) {
    clearInterval(loaderTicker);
    setTimeout(hideLoader, REDUCED_MOTION.matches ? 0 : 90);
  }
}

function hideLoader() {
  if (loaderHidden) return;
  loaderHidden = true;
  const loader = $('s-loading');
  loader?.classList.add('out');
  setTimeout(() => { if (loader) loader.hidden = true; }, REDUCED_MOTION.matches ? 0 : (shellMode === 'directory' ? 180 : 520));
}

const loaderTicker = window.setInterval(tickLoader, 80);

/* ── Route model ───────────────────────────────────────── */
function currentRoute() {
  const pathname = location.pathname.replace(/\/+$/, '') || '/';
  const params = new URL(location.href).searchParams;
  const direct = pathname.match(/^\/(recruiter|friend|viewer|personal)$/)?.[1];
  const blog = pathname.match(/^\/blog\/([a-z0-9-]+)$/)?.[1];
  const requestedShell = params.get('shell');
  const shell = requestedShell === 'world' || requestedShell === 'directory' ? requestedShell : shellMode;
  if (direct) {
    return {
      path: direct,
      mode: direct === 'recruiter' && params.get('mode') === 'light',
      blog: '',
      shell,
    };
  }
  if (blog) {
    const origin = params.get('from');
    const path = PATHS.has(origin) ? origin : 'personal';
    return { path, mode: path === 'recruiter' && params.get('mode') === 'light', blog, shell };
  }
  return { path: null, mode: false, blog: '', homeView: shell };
}

function pathUrl(path, mode = false, shell = shellMode) {
  const params = new URLSearchParams();
  if (path === 'recruiter' && mode) params.set('mode', 'light');
  params.set('shell', shell);
  return `/${path}?${params}`;
}

function writeHistory(kind, url, state = {}) {
  if (kind !== 'push' && kind !== 'replace') return;
  history[`${kind}State`]({ ...(history.state || {}), ...state }, '', url);
}

function setStageVisibility(path, view = shellMode) {
  shellMode = view;
  homeView = view;
  document.body.dataset.shellMode = shellMode;
  if (path) document.body.dataset.path = path;
  else delete document.body.dataset.path;
  if (path) delete document.body.dataset.homeView; else document.body.dataset.homeView = view;
  document.querySelectorAll('.ps').forEach(panel => {
    const selected = panel.id === `ps-${path}`;
    panel.classList.toggle('on', selected);
    panel.setAttribute('aria-hidden', String(!selected));
    panel.inert = !selected;
  });
  const directory = $('s-directory');
  const directoryVisible = view === 'directory';
  directory?.classList.toggle('out', !directoryVisible);
  directory?.setAttribute('aria-hidden', String(!directoryVisible));
  if (directory) directory.inert = !directoryVisible;
  const world = $('s-world');
  const worldVisible = !path && view === 'world';
  world?.classList.toggle('out', !worldVisible);
  world?.setAttribute('aria-hidden', String(!worldVisible));
  if (world) world.inert = !worldVisible;
  setDirectoryApp(path, Boolean(path && view === 'directory'));
  updateShellControls();
}

export function goPath(id, options = {}) {
  if (!PATHS.has(id)) return;
  shellMode = options.shell === 'world' ? 'world' : options.shell === 'directory' ? 'directory' : shellMode;
  try { localStorage.setItem(SHELL_KEY, shellMode); } catch { /* preference storage is optional */ }
  const mode = id === 'recruiter' ? Boolean(options.mode) : false;
  if (activePath === id) {
    setStageVisibility(id, shellMode);
    if (id === 'recruiter') setRecruiterMode(mode, options.animate !== false);
    writeHistory(options.history, pathUrl(id, mode, shellMode), { path: id, mode, shellMode });
    return;
  }

  const previousPath = activePath;
  const version = ++transitionVersion;
  if (previousPath) leaveFns[previousPath]?.();
  activePath = id;
  worldFocusPath = id;
  document.body.dataset.path = id;
  pauseWorld();
  setFlame(false);
  cur?.classList.remove('gold', 'frnd', 'plain');
  curRing?.classList.remove('world');
  if (id === 'recruiter') setRecruiterMode(mode, false);
  else setRecruiterMode(false, false);
  writeHistory(options.history ?? 'push', pathUrl(id, mode, shellMode), { path: id, mode, shellMode });
  sendStat('path_enter', id);
  if (shellMode === 'world') SND.whoosh();
  SND.stopWorld();
  SND.stopPathAmbient();
  if (SND.enabled) SND.startPathAmbient(id);

  const animateTransition = shellMode === 'world' && options.animate !== false && !REDUCED_MOTION.matches;
  const delay = animateTransition ? 420 : 0;
  if (animateTransition) ov?.classList.add('on');
  setTimeout(() => {
    if (version !== transitionVersion) return;
    setStageVisibility(id);
    initFns[id]?.();
    const panel = $(`ps-${id}`);
    panel?.setAttribute('tabindex', '-1');
    panel?.setAttribute('role', 'region');
    panel?.setAttribute('aria-label', PATH_LABELS[id]);
    if (options.focus !== false) requestAnimationFrame(() => panel?.focus({ preventScroll: true }));
    if (animateTransition) setTimeout(() => ov?.classList.remove('on'), 80);
  }, delay);
}

export function goBack(options = {}) {
  goHome(options);
}

export function goHome(options = {}) {
  const previousPath = activePath;
  const version = ++transitionVersion;
  if (previousPath) leaveFns[previousPath]?.();
  activePath = null;
  if (shellMode === 'directory' && options.discardDirectory !== false) discardDirectoryApp();
  homeView = shellMode;
  closePost({ fromHistory: true });
  const homeUrl = shellMode === 'world' ? '/?shell=world' : '/?shell=directory';
  writeHistory(options.history ?? 'push', homeUrl, { path: null, homeView, shellMode });
  const animateTransition = shellMode === 'world' && options.animate !== false && !REDUCED_MOTION.matches;
  if (animateTransition) ov?.classList.add('on');
  SND.stopPathAmbient();
  const delay = animateTransition ? 420 : 0;
  setTimeout(() => {
    if (version !== transitionVersion) return;
    setStageVisibility(null, homeView);
    delete document.body.dataset.path;
    setRecruiterMode(false, false);
    if (shellMode === 'world') onReturnToWorld(); else { pauseWorld(); showDirectory(); }
    if (animateTransition) setTimeout(() => ov?.classList.remove('on'), 80);
    $('directory-window')?.focus?.({ preventScroll: true });
  }, delay);
}

export function goExplore(options = {}) {
  setShellMode('world', { history: options.history ?? 'push', keepPath: false });
}

export function setShellMode(mode, options = {}) {
  if (!['directory', 'world'].includes(mode)) return;
  shellMode = mode; homeView = mode;
  if (mode === 'directory') {
    const webglNotice = document.getElementById('webgl-notice');
    if (webglNotice) {
      webglNotice.classList.remove('open');
      webglNotice.setAttribute('aria-hidden', 'true');
      window.setTimeout(() => { webglNotice.hidden = true; }, 220);
    }
  }
  try { localStorage.setItem(SHELL_KEY, mode); } catch { /* preference storage is optional */ }
  if (!options.keepPath && activePath) leaveFns[activePath]?.();
  if (!options.keepPath) activePath = null;
  const url = activePath ? pathUrl(activePath, activePath === 'recruiter' && isRecruiterMode(), mode) : `/?shell=${mode}`;
  writeHistory(options.history ?? 'push', url, { path: activePath, shellMode: mode });
  setStageVisibility(activePath, mode);
  if (!activePath) {
    if (mode === 'world') { onReturnToWorld(); if (SND.enabled) SND.startWorld(); }
    else { pauseWorld(); showDirectory(); SND.stopWorld(); }
  }
}

function updateShellControls() {
  document.querySelectorAll('#experience-switch [data-shell-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.shellMode === shellMode)));
  document.querySelectorAll('.site-home,[data-action="home"]').forEach(button => {
    if (!button.matches('button,a')) return;
    button.textContent = shellMode === 'world' ? '⌂ Cloud' : '⌂ Device';
    if (button.matches('a')) button.setAttribute('href', `/?shell=${shellMode}`);
  });
}

function applyLocationRoute({ initial = false } = {}) {
  const route = currentRoute();
  if (route.path) {
    shellMode = route.shell || shellMode;
    goPath(route.path, { mode: route.mode, shell: shellMode, history: 'none', animate: !initial, focus: !initial });
  } else {
    if (activePath) leaveFns[activePath]?.();
    activePath = null;
    homeView = route.homeView || 'directory';
    setStageVisibility(null, homeView);
    if (homeView === 'world') onReturnToWorld();
    else { pauseWorld(); showDirectory(); }
  }
}

function requestRecruiterMode(next = !isRecruiterMode()) {
  if (activePath !== 'recruiter') {
    goPath('recruiter', { mode: true, history: 'push' });
    return;
  }
  setRecruiterMode(next);
  writeHistory('push', pathUrl('recruiter', next), { path: 'recruiter', mode: next });
}

/* ── World boot ────────────────────────────────────────── */
document.querySelectorAll('.ps').forEach(panel => {
  panel.setAttribute('aria-hidden', 'true');
  panel.inert = true;
});

initDirectory({
  onPath: id => goPath(id, { mode: false, shell: 'directory', history: 'push', animate: false }),
  onAppClose: () => goHome({ history: 'push', animate: false, discardDirectory: true }),
  onWorld: () => setShellMode('world', { history: 'push', keepPath: false }),
});

initWorld({
  onProgress: progress => { target = Math.max(target, Math.round(progress * 100)); },
  onAssetStatus: asset => {
    const status = $('world-status');
    if (!status || asset.status === 'loading') return;
    status.textContent = asset.status === 'loaded'
      ? `${asset.id} path ready.`
      : `${asset.id} path is using its accessible fallback.`;
  },
  onWebGLUnavailable: () => {
    const notice = $('webgl-notice');
    if (notice) {
      notice.hidden = false;
      requestAnimationFrame(() => notice.classList.add('open'));
    }
    window.setTimeout(() => {
      const beforeFallback = new URL(location.href);
      const route = currentRoute();
      const timelineEvent = beforeFallback.searchParams.get('event');
      if (route.path && !activePath) {
        shellMode = 'directory';
        homeView = 'directory';
        try { localStorage.setItem(SHELL_KEY, 'directory'); } catch { /* preference storage is optional */ }
        initialRouteApplied = true;
        applyLocationRoute({ initial: true });
      }
      const preservePath = Boolean(activePath || route.path);
      setShellMode('directory', { history: route.blog ? 'none' : 'replace', keepPath: preservePath });
      if (route.blog) {
        const params = new URLSearchParams({ from: route.path, shell: 'directory' });
        writeHistory('replace', `/blog/${route.blog}?${params}`, {
          path: route.path,
          blog: route.blog,
          shellMode: 'directory',
        });
      } else if (timelineEvent) {
        const url = new URL(location.href);
        url.searchParams.set('event', timelineEvent);
        writeHistory('replace', `${url.pathname}${url.search}`, {
          path: route.path,
          timelineEvent,
          shellMode: 'directory',
        });
      }
    }, 4200);
  },
  onReady: () => {
    target = 100;
    if (!initialRouteApplied) {
      initialRouteApplied = true;
      applyLocationRoute({ initial: true });
    }
  },
  onPathChosen: id => goPath(id, { mode: false, history: 'push' }),
});

/* Directory pages do not wait for the optional 3D assets. The world keeps
   loading in the background and is ready when the visitor switches modes. */
if (shellMode === 'directory' && !initialRouteApplied) {
  target = 100;
  initialRouteApplied = true;
  applyLocationRoute({ initial: true });
}

bindConsentBanner();
trackView();

/* ── Controls and CSP-safe action delegation ───────────── */
const actions = {
  'copy-email': () => cp($('card-email')?.textContent || '', 'Email copied'),
  'copy-phone': () => cp($('card-phone')?.textContent || '', 'Phone copied'),
  'download-vcard': dlVCard,
  'open-resume': openResume,
  'close-resume': closeResume,
  'download-resume': dlResume,
  'open-share': openShare,
  'close-share': closeShare,
  'pick-color': trigger => pickColor(trigger),
  'copy-link': cpLink,
  'share-linkedin': shareLinkedIn,
  'download-card': dlCard,
  'toggle-mode': () => requestRecruiterMode(),
  'open-stats': openStats,
  'close-stats': closeStats,
  'friend-content': showFriendContent,
  world: () => goExplore({ history: 'push' }),
  home: () => goHome({ history: 'push' }),
  'explore-world': () => goExplore({ history: 'push' }),
  'dismiss-landscape': trigger => trigger.closest('.landscape-prompt')?.classList.add('dismissed'),
};

/* Path surfaces have their own stacking and animation contexts. Bind Home at
   the control as well as keeping it in the action map, so it remains reliable
   even when a path-specific interaction stops bubbling. */
document.querySelectorAll('.site-home,[data-action="home"]').forEach(button => {
  button.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    goHome({ history: 'push' });
  });
});

document.addEventListener('click', event => {
  /* Body also carries data-shell-mode for styling. Restrict this lookup to
     the actual switch so ordinary buttons do not get mistaken for it. */
  const shellButton = event.target.closest('#experience-switch [data-shell-mode],#webgl-notice [data-shell-mode]');
  if (shellButton) { event.preventDefault(); setShellMode(shellButton.dataset.shellMode, { history: 'push', keepPath: false }); return; }
  const trigger = event.target.closest('[data-action]');
  if (!trigger) return;
  const action = actions[trigger.dataset.action];
  if (!action) return;
  event.preventDefault();
  event.stopPropagation();
  action(trigger, event);
});

window.addEventListener('recruitermoderequest', () => requestRecruiterMode());

for (const [id, close] of [['rmo', closeResume], ['smo', closeShare], ['stmo', closeStats]]) {
  $(id)?.addEventListener('click', event => { if (event.target === event.currentTarget) close(); });
}

document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  if ($('blog-mo')?.classList.contains('open')) { closePost(); return; }
  const timelineDialog = document.querySelector('.tl-dialog[open]');
  if (timelineDialog) { event.preventDefault(); timelineDialog.close?.(); return; }
  if ($('rmo')?.classList.contains('open')) { closeResume(); return; }
  if ($('smo')?.classList.contains('open')) { closeShare(); return; }
  if ($('stmo')?.classList.contains('open')) { closeStats(); return; }
  if (activePath) goHome({ history: 'push' });
});

window.addEventListener('popstate', () => applyLocationRoute());

/* Retained for the two unserved source prototypes and manual smoke tests. */
Object.assign(window, { goBack, goHome, goExplore, goPath, setShellMode });
