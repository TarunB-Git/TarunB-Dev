/* Portfolio OS: a stateful file manager and window shell. */
import { applyBookingLink, loadBookingUrl } from './booking.js';
import { maybeGet } from './v1.js';
const $ = id => document.getElementById(id);
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)');
const PATH_TITLES = { recruiter: 'Work & Résumé', viewer: 'About Me', personal: 'Library & Blogs', friend: 'Stories & Memories' };
const CONTACTS = {
  email: 'mailto:tarunb.co@gmail.com?subject=Portfolio%20conversation&body=Hi%2C%20I%20found%20your%20portfolio%20and%20would%20like%20to%20talk%20about...',
  call: 'tel:+46767464810',
  whatsapp: 'https://wa.me/46767464810?text=Hi%2C%20I%20found%20your%20portfolio.',
};
let initialized = false;
let callbacks = {};
let currentLocation = '/home/guest/Desktop';
let locationHistory = ['/home', '/home/guest', currentLocation];
let historyIndex = 2;
let renderedLocationKey = '';
let renderedDesktopKey = '';
let publicMedia = [];
const htmlEsc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

function isMobileWindow() {
  return typeof innerWidth !== 'undefined' && innerWidth <= 720;
}

function maximizeNewMobileWindow(node) {
  if (node && isMobileWindow()) node.classList.add('is-maximized');
}

function cloudUnlocks() {
  try {
    const value = JSON.parse(sessionStorage.getItem('cloud_landmarks_visited_v2') || '[]');
    return new Set(Array.isArray(value) ? value : []);
  } catch {
    return new Set();
  }
}
const folder = (name, target, note = 'Folder') => ({ name, target, note, kind: 'folder' });
const documentFile = (name, document, note = 'Read-only document') => ({ name, document, note, kind: 'document' });
const shortcut = (name, href, note, icon) => ({ name, href, note, icon, kind: 'shortcut' });

function entriesFor(path) {
  if (path === '/home') return [
    { name: 'Guest', target: '/home/guest', note: 'Standard portfolio profile', kind: 'profile', icon: 'guest' },
    { name: 'Administrator', target: '/admin', note: 'Owner login and content manager', kind: 'profile', icon: 'admin' },
  ];
  if (path === '/home/guest') return [folder('Desktop', '/home/guest/Desktop'), folder('Downloads', '/home/guest/Downloads'), folder('Pictures', '/home/guest/Pictures'), folder('Trash', '/home/guest/Trash')];
  if (path === '/home/guest/Desktop') {
    const unlocked = cloudUnlocks();
    const items = [
      { name: 'Work & Résumé', path: 'recruiter', note: 'Recruiter view', kind: 'path' },
      documentFile('Walkthrough.md', 'walkthrough', 'Cloud exploration guide'),
    ];
    if (unlocked.has('viewer')) items.push({ name: 'About Me', path: 'viewer', note: "The ship's voyage", kind: 'path' });
    if (unlocked.has('personal')) {
      items.push({ name: 'Library & Notes', path: 'personal', note: 'Reading timeline', kind: 'path' });
      items.push(documentFile('Blogs', 'blogs', 'Open the writing archive'));
    }
    if (unlocked.has('friend')) items.push({ name: 'Stories & Memories', path: 'friend', note: 'Unlocked by the fallen moon', kind: 'path' });
    items.push(
      documentFile('Legal & Credits.txt', 'legal'),
      shortcut('Email', CONTACTS.email, 'Start an email', '@'),
      shortcut('Call', CONTACTS.call, 'Call by phone', '☎'),
      shortcut('WhatsApp', CONTACTS.whatsapp, 'Open WhatsApp', '◉'),
    );
    return items;
  }
  if (path === '/home/guest/Downloads') return [documentFile('Resume.pdf', 'resume', 'Downloadable résumé · PDF')];
  if (path === '/home/guest/Pictures') return publicMedia.length
    ? publicMedia.map(media => ({ ...media, name: media.original_name || `media-${media.id}`, note: `${media.mime_type || 'Media'} · uploaded from Admin`, kind: 'media' }))
    : [documentFile('README.txt', 'pictures-empty', 'Upload images in Admin → Files & Media')];
  if (path === '/home/guest/Trash') return [documentFile('README.txt', 'trash', 'Read-only note')];
  return null;
}

function desktopEntries() {
  const files = entriesFor('/home/guest/Desktop') || [];
  return [
    ...files,
    folder('Home', '/home/guest', 'Home folder'),
    folder('Trash', '/home/guest/Trash', 'Trash'),
  ];
}

function entryType(entry) {
  if (entry.kind === 'folder' || entry.kind === 'path') return 'folder';
  if (entry.kind === 'profile') return 'profile';
  if (entry.kind === 'shortcut') return 'shortcut';
  return 'document';
}

function entryGlyph(entry, type) {
  if (type === 'shortcut') return entry.icon || '↗';
  if (type === 'document') return entry.kind === 'media' || entry.document?.startsWith('picture') ? '▧' : '≡';
  if (type === 'profile') return entry.icon === 'admin' ? '⚿' : '●';
  return '';
}

function renderDesktopShortcuts(force = false) {
  const desktop = $('directory-desktop-icons');
  if (!desktop) return;
  const entries = desktopEntries();
  const key = entries.map(entry => `${entry.kind}:${entry.name}`).join('|');
  if (!force && key === renderedDesktopKey) return;
  renderedDesktopKey = key;
  desktop.innerHTML = entries.map((entry, index) => {
    const type = entryType(entry);
    const glyph = entryGlyph(entry, type);
    const attrs = entry.kind === 'shortcut'
      ? `href="${entry.href}"${entry.href.startsWith('https:') ? ' target="_blank" rel="noopener noreferrer"' : ''}`
      : `type="button" data-desktop-entry="${index}"`;
    const tag = entry.kind === 'shortcut' ? 'a' : 'button';
    return `<${tag} ${attrs} class="desktop-shortcut ${type}-shortcut"><span class="${type}-icon" aria-hidden="true">${glyph}</span><strong>${entry.name}</strong></${tag}>`;
  }).join('');
}

function updateDockState() {
  const files = $('directory-window');
  const documentWindow = $('directory-document-window');
  const app = $('directory-app-window');
  const filesDock = $('directory-dock-files');
  const documentDock = $('directory-dock-document');
  const pathDock = $('directory-dock-path');
  filesDock?.classList.toggle('is-minimized', Boolean(files?.classList.contains('is-minimized')));
  if (documentDock) {
    documentDock.hidden = Boolean(documentWindow?.hidden) || Boolean(documentWindow?.classList.contains('is-closed'));
    documentDock.classList.toggle('is-minimized', Boolean(documentWindow?.classList.contains('is-minimized')));
    documentDock.querySelector('small').textContent = $('document-window-title')?.textContent || 'Document';
  }
  if (pathDock) {
    pathDock.hidden = !app?.classList.contains('active');
    pathDock.classList.toggle('is-minimized', Boolean(app?.classList.contains('is-minimized')));
    pathDock.querySelector('small').textContent = $('app-window-title')?.textContent || 'Path';
  }
}

function renderLocation(force = false) {
  const entries = entriesFor(currentLocation) || [];
  if ($('directory-location')) $('directory-location').value = currentLocation;
  if ($('directory-item-count')) $('directory-item-count').textContent = `${entries.length} ${entries.length === 1 ? 'item' : 'items'}`;
  if ($('directory-back')) $('directory-back').disabled = historyIndex <= 0;
  if ($('directory-forward')) $('directory-forward').disabled = historyIndex >= locationHistory.length - 1;
  document.querySelectorAll('[data-directory-location]').forEach(button => button.classList.toggle('active', button.dataset.directoryLocation === currentLocation));
  const files = $('directory-files');
  if (!files) return;
  const key = `${currentLocation}:${entries.map(entry => `${entry.kind}:${entry.name}`).join('|')}`;
  if (!force && key === renderedLocationKey) return;
  renderedLocationKey = key;
  files.innerHTML = entries.map((entry, index) => {
    const type = entryType(entry);
    const glyph = entryGlyph(entry, type);
    return `<button class="directory-file ${type}-file ${entry.icon || ''}" type="button" data-entry-index="${index}"><span class="${type}-icon" aria-hidden="true">${glyph}</span><strong>${entry.name}</strong><small>${entry.note}</small></button>`;
  }).join('');
}

function navigate(path, record = true) {
  if (!entriesFor(path)) { openDocument('not-found', path); return false; }
  currentLocation = path;
  if (record) { locationHistory = locationHistory.slice(0, historyIndex + 1); locationHistory.push(path); historyIndex = locationHistory.length - 1; }
  renderLocation();
  const files = $('directory-window');
  const filesWereHidden = files?.classList.contains('is-minimized') || files?.classList.contains('is-closed');
  if (filesWereHidden) restoreFiles();
  else {
    focusWindow(files);
    updateDockState();
  }
  return true;
}

let windowOrder = 60;
function focusWindow(node) {
  if (!node) return;
  clearTimeout(node._windowMotion);
  node.classList.remove('is-minimizing', 'is-closing');
  const desktop = $('s-directory');
  if (desktop) desktop.inert = false;
  node.style.zIndex = String(++windowOrder);
  node.focus?.({ preventScroll: true });
}

function animateWindow(node, kind, after) {
  if (!node) return;
  node.classList.remove('is-minimizing', 'is-closing', 'is-restoring');
  node.classList.add(kind === 'minimize' ? 'is-minimizing' : 'is-closing');
  clearTimeout(node._windowMotion);
  node._windowMotion = setTimeout(() => { node.classList.remove('is-minimizing', 'is-closing'); after?.(); }, REDUCED.matches ? 0 : 260);
}
function restoreFiles(reset = false) {
  const node = $('directory-window');
  const wasHidden = node?.classList.contains('is-minimized') || node?.classList.contains('is-closed');
  if (reset) { currentLocation = '/home/guest/Desktop'; locationHistory = ['/home', '/home/guest', currentLocation]; historyIndex = 2; renderLocation(); }
  if (reset) maximizeNewMobileWindow(node);
  node?.classList.remove('is-minimized', 'is-closed');
  node?.classList.toggle('is-restoring', Boolean(wasHidden));
  focusWindow(node);
  if (wasHidden) setTimeout(() => node?.classList.remove('is-restoring'), REDUCED.matches ? 0 : 320);
  updateDockState();
}

function bindDrag(windowNode, titlebar) {
  if (!windowNode || !titlebar) return;
  windowNode.addEventListener('pointerdown', () => focusWindow(windowNode));
  let drag = null;
  titlebar.addEventListener('pointerdown', event => {
    if (event.target.closest('button') || windowNode.classList.contains('is-maximized') || innerWidth < 721) return;
    const style = getComputedStyle(windowNode);
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, baseX: parseFloat(style.getPropertyValue('--win-x')) || 0, baseY: parseFloat(style.getPropertyValue('--win-y')) || 0 };
    titlebar.setPointerCapture?.(event.pointerId); windowNode.classList.add('is-dragging');
  });
  titlebar.addEventListener('pointermove', event => {
    if (!drag || drag.id !== event.pointerId) return;
    windowNode.style.setProperty('--win-x', `${Math.max(-innerWidth / 2 + 150, Math.min(innerWidth / 2 - 150, drag.baseX + event.clientX - drag.x))}px`);
    windowNode.style.setProperty('--win-y', `${Math.max(-innerHeight / 2 + 100, Math.min(innerHeight / 2 - 100, drag.baseY + event.clientY - drag.y))}px`);
  });
  const finish = event => { if (drag?.id !== event.pointerId) return; drag = null; windowNode.classList.remove('is-dragging'); };
  titlebar.addEventListener('pointerup', finish); titlebar.addEventListener('pointercancel', finish);
  titlebar.addEventListener('dblclick', event => { if (!event.target.closest('button')) windowNode.classList.toggle('is-maximized'); });
}

function bindResize(windowNode) {
  if (!windowNode || windowNode.querySelector(':scope > .directory-resize-handle')) return;
  const handle = document.createElement('span');
  handle.className = 'directory-resize-handle';
  handle.setAttribute('aria-hidden', 'true');
  windowNode.append(handle);
  let resize = null;
  handle.addEventListener('pointerdown', event => {
    if (windowNode.classList.contains('is-maximized')) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = windowNode.getBoundingClientRect();
    const style = getComputedStyle(windowNode);
    resize = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      width: rect.width,
      height: rect.height,
      baseX: parseFloat(style.getPropertyValue('--win-x')) || 0,
      baseY: parseFloat(style.getPropertyValue('--win-y')) || 0,
      mobile: isMobileWindow(),
      minWidth: Math.min(innerWidth - 20, Math.max(280, parseFloat(style.minWidth) || 0)),
      minHeight: Math.min(innerHeight - 80, Math.max(260, parseFloat(style.minHeight) || 0)),
    };
    handle.setPointerCapture?.(event.pointerId);
    windowNode.classList.add('is-resizing');
  });
  handle.addEventListener('pointermove', event => {
    if (!resize || resize.id !== event.pointerId) return;
    const rect = windowNode.getBoundingClientRect();
    const maxWidth = resize.mobile ? innerWidth - rect.left - 8 : innerWidth - 16;
    const maxHeight = resize.mobile ? innerHeight - rect.top - 8 : innerHeight - 40;
    const width = Math.max(resize.minWidth, Math.min(maxWidth, resize.width + event.clientX - resize.startX));
    const height = Math.max(resize.minHeight, Math.min(maxHeight, resize.height + event.clientY - resize.startY));
    windowNode.style.width = `${width}px`;
    windowNode.style.height = `${height}px`;
    if (!resize.mobile) {
      windowNode.style.setProperty('--win-x', `${resize.baseX + (width - resize.width) / 2}px`);
      windowNode.style.setProperty('--win-y', `${resize.baseY + (height - resize.height) / 2}px`);
    }
  });
  const finish = event => {
    if (!resize || resize.id !== event.pointerId) return;
    resize = null;
    windowNode.classList.remove('is-resizing');
  };
  handle.addEventListener('pointerup', finish);
  handle.addEventListener('pointercancel', finish);
  handle.addEventListener('lostpointercapture', finish);
}

function documentMarkup(kind, detail = '') {
  if (kind === 'walkthrough') return `<p class="doc-meta">MARKDOWN · READ ONLY</p><h1>Walkthrough</h1><p>Some paths and folders are hidden when you first open Device mode. Explore the Cloud and visit its landmarks: each path you discover is automatically saved into Device after you visit it.</p><hr><h2>Walking the Cloud</h2><ul><li><strong>Move:</strong> W / S or the ↑ / ↓ arrow keys.</li><li><strong>Steer:</strong> A / D or the ← / → arrow keys.</li><li><strong>Look around:</strong> grab and drag the world; use the mouse wheel to look farther up or down.</li><li><strong>Jump or fly:</strong> double-tap or hold Space. Hold Shift to drop faster.</li><li><strong>Interact:</strong> press E when a landmark is nearby. On touch screens, use the movement stick and the on-screen action buttons.</li></ul><p>Follow the navigation arrow in the top-right corner to learn where to go next. It points toward the next undiscovered path, or toward the opening between levels when the next destination lies elsewhere.</p><p>After you visit a path, a miniature of its landmark rotates around your character and can take you back there. Pressing <strong>E</strong> is the recommended way to enter a new path, since clicking may instead select one of those spinning companions.</p><p>Discover every path and the Cloud may reveal a special way to travel. There are secret levels hidden above and below the obvious route too—curiosity is rewarded.</p>`;
  if (kind === 'blogs') {
    const requested = String(detail || '/blogs');
    const path = /^\/blogs(?:[?#]|$)/.test(requested) || /^\/blog\/[a-z0-9-]+(?:[?#]|$)/.test(requested)
      ? requested : '/blogs';
    const url = new URL(path, location.origin);
    url.searchParams.set('embed', '1');
    return `<iframe class="directory-blog-frame" src="${htmlEsc(`${url.pathname}${url.search}`)}" title="Writing archive"></iframe>`;
  }
  if (kind === 'legal') return `<p class="doc-meta">READ ONLY · LEGAL, PRIVACY & CREDITS</p><h1>Legal and credits</h1><p class="doc-updated">Last reviewed: September 2026</p><p>This document explains ownership, privacy, cookies, submissions, and the third-party assets used by this portfolio. </p><h2 id="privacy">Privacy</h2><p><strong>Controller:</strong> Portfolio owner · <a href="mailto:tarunb.co@gmail.com">tarunb.co@gmail.com</a></p><p>The site stores information you deliberately submit through contact, comment, and message forms. Contact details remain private. A message is published only after separate consent and owner approval.</p><p>Optional first-party analytics record aggregate events such as page views, path choices, résumé opens, shares, broad traffic source, and coarse browser context (device class, browser family, language, and world region from the time zone). No age, gender, ethnicity, precise location, or cross-site advertising profile is inferred. Optional analytics remain disabled until accepted through Privacy choices.</p><h2 id="cookies">Cookies and local storage</h2><ul><li><strong>visitor_id</strong> supports reversible reactions without connecting them to a named profile.</li><li><strong>admin_session</strong> is issued only after an owner login.</li><li>Session storage remembers visited landmarks, unlocks, and interface state for this browser session.</li></ul><p>Necessary site features continue to work when optional analytics are rejected.</p><h2 id="retention">Retention and rights</h2><p>Consented raw analytics events are aggregated and removed after 90 days. Owner sessions expire according to server configuration. To request access, correction, or deletion of a submitted message, email the controller with enough detail to locate it.</p><h2 id="terms">Terms of use</h2><ul><li>Portfolio text, design, and original code belong to the site owner unless stated otherwise.</li><li>Do not submit unlawful, abusive, confidential, or third-party material you cannot share.</li><li>User submissions remain yours; publication requires the permissions described above.</li><li>The site and external links are provided as-is without a guarantee of continuous availability.</li></ul><h2 id="attribution">3D model attribution</h2><div class="doc-credit"><strong>Ship in Clouds</strong><span>Bastien Genbrugge · CC BY 4.0</span><a href="https://sketchfab.com/3d-models/ship-in-clouds-c475323dc7f24e26ba2009c08c8e1941" target="_blank" rel="noopener noreferrer">Original model ↗</a></div><div class="doc-credit"><strong>Old / Ancient Scroll</strong><span>Kigha · CC BY 4.0</span><a href="https://sketchfab.com/3d-models/old-ancient-scroll-73e9333251c7490786f99e67beb41d6e" target="_blank" rel="noopener noreferrer">Original model ↗</a></div><div class="doc-credit"><strong>Moon</strong><span>Akshat (shooter24994) · CC BY 4.0</span><a href="https://sketchfab.com/3d-models/moon-4db2273f6dd943b8ad7fa5e3b1b2431a" target="_blank" rel="noopener noreferrer">Original model ↗</a></div><div class="doc-credit"><strong>Bird</strong><span>moizmuhammad373 · CC BY 4.0</span><a href="https://sketchfab.com/3d-models/bird-e93a906eb38343c4a14458a637136329" target="_blank" rel="noopener noreferrer">Original model ↗</a></div><div class="doc-credit"><strong>KayKit Adventurers · Mage</strong><span>Kay Lousberg · CC0 1.0</span><a href="https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0" target="_blank" rel="noopener noreferrer">Original pack ↗</a></div><p>Models are scaled, positioned, materially adjusted, and optimized for web delivery. The site also uses Three.js, FastAPI, and locally served open-source fonts.</p><h2>Contact</h2><p>Questions about privacy, attribution, or removal requests: <a href="mailto:hello@example.com?subject=Portfolio%20legal%20question">hello@example.com</a>.</p>`;
  if (kind === 'resume') return '<p class="doc-meta">PDF DOCUMENT</p><h1>Résumé</h1><p>The full downloadable résumé, separate from the abridged card view.</p><p><a href="/resume.pdf" download="resume.pdf">Download résumé PDF</a></p>';
  if (kind === 'picture-cloud') return `<p class="doc-meta">IMAGE PREVIEW · Placeholder</p><div class="placeholder-picture cloud-picture"><span>Cloud reference</span></div><p>A future media item managed from the owner dashboard.</p>`;
  if (kind === 'picture-ship') return `<p class="doc-meta">IMAGE PREVIEW · Placeholder</p><div class="placeholder-picture ship-picture"><span>Ship concept</span></div><p>A future project or reference image.</p>`;
  if (kind === 'pictures-empty') return '<p class="doc-meta">PICTURES</p><h1>No uploaded media yet</h1><p>Images and videos uploaded in <strong>Admin → Files & Media</strong> appear in this folder. Their bytes live in the server upload directory, while the database keeps their names and descriptions.</p>';
  if (kind === 'media') {
    const media = detail || {};
    const url = /^\/media\/[A-Za-z0-9._-]+$/.test(media.url || '') ? media.url : '';
    const preview = String(media.mime_type || '').startsWith('video/')
      ? `<video src="${htmlEsc(url)}" controls style="max-width:100%;max-height:55vh"></video>`
      : `<img src="${htmlEsc(url)}" alt="${htmlEsc(media.alt_text || '')}" style="max-width:100%;max-height:55vh;object-fit:contain">`;
    return `<p class="doc-meta">${htmlEsc(media.mime_type || 'MEDIA')} · ${Number(media.byte_size || 0).toLocaleString()} bytes</p>${preview}<p>${htmlEsc(media.alt_text || media.original_name || '')}</p><p><a href="${htmlEsc(url)}" download>Download original</a></p>`;
  }
  if (kind === 'trash') return `<p class="doc-meta">READ ONLY</p><h1>Trash</h1><p>Nothing important has been deleted. Placeholder files can live here while the portfolio is being assembled.</p>`;
  return `<p class="doc-meta">404 · FILE NOT FOUND</p><h1>That path does not exist.</h1><p><code>${String(detail).replace(/[<>&]/g, '')}</code> is not present in this profile.</p><button type="button" data-document-action="close">Return to Files</button>`;
}
function openDocument(kind, detail = '') {
  const node = $('directory-document-window'); if (!node) return;
  const wasClosed = node.hidden || node.classList.contains('is-closed');
  const titles = { walkthrough: 'Walkthrough.md', blogs: 'Blogs — The Scroll', legal: 'Legal & Credits.txt', resume: 'Resume.pdf', 'picture-cloud': 'cloud-world-reference.png', 'picture-ship': 'ship-concept.png', 'pictures-empty': 'Pictures — README.txt', trash: 'README.txt', 'not-found': '404 — File not found' };
  const content = $('directory-document-content');
  $('document-window-title').textContent = kind === 'media' ? (detail.original_name || 'Media') : (titles[kind] || 'Document');
  content.classList.toggle('directory-blog-document', kind === 'blogs');
  content.innerHTML = documentMarkup(kind, detail);
  node.hidden = false; node.classList.remove('is-minimized', 'is-closed');
  if (wasClosed) maximizeNewMobileWindow(node);
  node.classList.add('is-restoring'); focusWindow(node); setTimeout(() => node.classList.remove('is-restoring'), 320);
  updateDockState();
}

export function openBlogWindow(path = '/blogs') {
  openDocument('blogs', path);
}
function closeDocument(minimize = false) {
  const node = $('directory-document-window');
  animateWindow(node, minimize ? 'minimize' : 'close', () => {
    if (minimize) node.classList.add('is-minimized');
    else { node.hidden = true; node.classList.add('is-closed'); }
    updateDockState();
  });
}
function openEntry(entry) {
  if (entry.kind === 'folder') navigate(entry.target);
  else if (entry.kind === 'path') callbacks.onPath?.(entry.path);
  else if (entry.kind === 'profile' && entry.icon === 'admin') location.href = '/admin';
  else if (entry.kind === 'profile') navigate(entry.target);
  else if (entry.kind === 'shortcut') {
    if (entry.href.startsWith('https:')) window.open(entry.href, '_blank', 'noopener,noreferrer');
    else location.href = entry.href;
  }
  else if (entry.kind === 'media') openDocument('media', entry);
  else openDocument(entry.document);
}

function updateClockAndCalendar() {
  const now = new Date();
  const locale = String(navigator.language || '').toLowerCase().startsWith('sv') ? 'sv-SE' : 'en-GB';
  const formatted = new Intl.DateTimeFormat(locale, { timeZone: 'Europe/Stockholm', weekday: 'short', hour: '2-digit', minute: '2-digit' }).format(now);
  if ($('directory-clock')) $('directory-clock').textContent = formatted;
  const parts = new Intl.DateTimeFormat(locale, { timeZone: 'Europe/Stockholm', year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(now);
  const values = Object.fromEntries(parts.map(part => [part.type, Number(part.value)]));
  const first = new Date(values.year, values.month - 1, 1), days = new Date(values.year, values.month, 0).getDate();
  if ($('calendar-month')) $('calendar-month').textContent = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'Europe/Stockholm' }).format(now);
  const weekdays = locale === 'sv-SE' ? ['M','T','O','T','F','L','S'] : ['M','T','W','T','F','S','S'];
  if ($('calendar-grid')) $('calendar-grid').innerHTML = weekdays.map(day => `<b>${day}</b>`).join('') + Array((first.getDay() + 6) % 7).fill('<i></i>').join('') + Array.from({ length: days }, (_, i) => `<span class="${i + 1 === values.day ? 'today' : ''}">${i + 1}</span>`).join('');
}

export function setDirectoryApp(path, active, { discard = false } = {}) {
  const node = $('directory-app-window'); if (!node) return;
  const wasOpen = node.classList.contains('active') && !node.classList.contains('is-closed');
  const parent = document.body.dataset.shellMode === 'directory' ? $('s-directory') : document.body;
  if (parent && node.parentElement !== parent) parent.append(node);
  if (discard) {
    node.classList.remove('active', 'is-minimized', 'is-closed', 'is-maximized', 'shell-hidden');
    delete node.dataset.path;
  } else if (active) {
    const changedPath = node.dataset.path !== path;
    node.dataset.path = path;
    node.classList.add('active');
    node.classList.remove('shell-hidden', 'is-closed');
    /* Opening another path must always restore the app, even when the previous
       path was minimized. This is the state that previously left Device inert. */
    if (changedPath || node.classList.contains('is-minimized')) node.classList.remove('is-minimized');
    if (!wasOpen) maximizeNewMobileWindow(node);
    focusWindow(node);
  } else if (node.classList.contains('active')) {
    /* Cloud and Device own separate navigation state. Suspend, do not destroy,
       a minimized Device window while the visitor explores the Cloud. */
    // This wrapper also contains Cloud path pages. Hiding the wrapper while
    // in Cloud made a successful path transition look like an unresponsive tap.
    node.classList.toggle('shell-hidden', document.body.dataset.shellMode === 'directory');
  }
  const titlePath = path || node.dataset.path;
  if ($('app-window-title')) $('app-window-title').textContent = PATH_TITLES[titlePath] || 'Portfolio';
  updateDockState();
}

export function discardDirectoryApp() {
  setDirectoryApp('', false, { discard: true });
}

export function initDirectory(next = {}) {
  callbacks = { ...callbacks, ...next }; if (initialized) return; initialized = true;
  loadBookingUrl().then(url => applyBookingLink($('directory-book-call'), url));
  maybeGet('/content/card').then(payload => {
    const card = payload?.data || payload || {};
    const email = String(card.email || '').trim();
    const phone = String(card.phone || '').trim();
    const digits = phone.replace(/\D/g, '');
    if (email) CONTACTS.email = `mailto:${email}?subject=Portfolio%20conversation&body=Hi%2C%20I%20found%20your%20portfolio%20and%20would%20like%20to%20talk%20about...`;
    if (phone) CONTACTS.call = `tel:${phone}`;
    if (digits) CONTACTS.whatsapp = `https://wa.me/${digits}?text=Hi%2C%20I%20found%20your%20portfolio.`;
    renderLocation(true);
    renderDesktopShortcuts(true);
  });
  maybeGet('/media').then(payload => {
    publicMedia = Array.isArray(payload) ? payload : payload?.items || [];
    if (currentLocation === '/home/guest/Pictures') renderLocation(true);
  });
  maximizeNewMobileWindow($('directory-window'));
  bindDrag($('directory-window'), $('directory-titlebar')); bindDrag($('directory-document-window'), $('document-titlebar')); bindDrag($('directory-app-window'), $('app-titlebar'));
  bindResize($('directory-window')); bindResize($('directory-document-window')); bindResize($('directory-app-window'));
  updateClockAndCalendar(); setInterval(updateClockAndCalendar, 30_000); renderLocation(); renderDesktopShortcuts(); updateDockState();
  $('directory-files')?.addEventListener('click', event => { const button = event.target.closest('[data-entry-index]'); if (button) openEntry(entriesFor(currentLocation)[Number(button.dataset.entryIndex)]); });
  $('directory-desktop-icons')?.addEventListener('click', event => {
    const button = event.target.closest('[data-desktop-entry]');
    if (button) openEntry(desktopEntries()[Number(button.dataset.desktopEntry)]);
  });
  document.querySelectorAll('[data-directory-location]').forEach(button => button.addEventListener('click', () => navigate(button.dataset.directoryLocation)));
  $('directory-location')?.addEventListener('keydown', event => { if (event.key === 'Enter') navigate(event.currentTarget.value.trim()); });
  $('directory-brand')?.addEventListener('click', () => { const node = $('directory-overview'); node.hidden = !node.hidden; $('directory-brand').setAttribute('aria-expanded', String(!node.hidden)); });
  $('directory-clock')?.addEventListener('click', event => { event.stopPropagation(); const node = $('directory-calendar'); node.hidden = !node.hidden; $('directory-clock').setAttribute('aria-expanded', String(!node.hidden)); });
  document.addEventListener('click', event => {
    const calendar = $('directory-calendar');
    if (calendar && !calendar.hidden && !event.target.closest('#directory-calendar,#directory-clock')) {
      calendar.hidden = true;
      $('directory-clock')?.setAttribute('aria-expanded', 'false');
    }
    const dir = event.target.closest('[data-directory-action]');
    if (dir?.dataset.directoryAction === 'back' && historyIndex > 0) { historyIndex -= 1; currentLocation = locationHistory[historyIndex]; renderLocation(); }
    if (dir?.dataset.directoryAction === 'forward' && historyIndex < locationHistory.length - 1) { historyIndex += 1; currentLocation = locationHistory[historyIndex]; renderLocation(); }
    if (dir?.dataset.directoryAction === 'restore' || dir?.dataset.directoryAction === 'focus-files') { restoreFiles(dir.dataset.directoryAction === 'restore' && $('directory-window')?.classList.contains('is-closed')); if ($('directory-overview')) $('directory-overview').hidden = true; }
    if (dir?.dataset.directoryAction === 'restore-document') { $('directory-document-window')?.classList.remove('is-minimized', 'is-closed'); focusWindow($('directory-document-window')); if ($('directory-overview')) $('directory-overview').hidden = true; updateDockState(); }
    if (dir?.dataset.directoryAction === 'focus-path') {
      const app = $('directory-app-window');
      const suspendedPath = app?.dataset.path;
      if (suspendedPath && !app.querySelector('.ps.on')) callbacks.onPath?.(suspendedPath);
      else app?.classList.remove('is-minimized', 'is-closed', 'shell-hidden');
      focusWindow(app);
      if ($('directory-overview')) $('directory-overview').hidden = true;
      updateDockState();
    }
    if (dir?.dataset.directoryAction === 'open-world') { if ($('directory-overview')) $('directory-overview').hidden = true; callbacks.onWorld?.(); }
    const win = event.target.closest('[data-window-action]');
    if (win?.dataset.windowAction === 'minimize') animateWindow($('directory-window'), 'minimize', () => { $('directory-window').classList.add('is-minimized'); updateDockState(); });
    if (win?.dataset.windowAction === 'close') animateWindow($('directory-window'), 'close', () => { $('directory-window').classList.add('is-closed'); updateDockState(); });
    if (win?.dataset.windowAction === 'maximize') $('directory-window')?.classList.toggle('is-maximized');
    const doc = event.target.closest('[data-document-action]');
    if (doc?.dataset.documentAction === 'close') closeDocument(); if (doc?.dataset.documentAction === 'minimize') closeDocument(true); if (doc?.dataset.documentAction === 'maximize') $('directory-document-window')?.classList.toggle('is-maximized');
    const app = event.target.closest('[data-app-action]');
    if (app?.dataset.appAction === 'close') callbacks.onAppClose?.();
    if (app?.dataset.appAction === 'minimize') animateWindow($('directory-app-window'), 'minimize', () => { $('directory-app-window').classList.add('is-minimized'); if ($('s-directory')) $('s-directory').inert = false; updateDockState(); });
    if (app?.dataset.appAction === 'maximize') $('directory-app-window')?.classList.toggle('is-maximized');
  });
}

export function showDirectory() {
  renderLocation();
  renderDesktopShortcuts();
  const app = $('directory-app-window');
  // A path may still be suspended in the dock after returning from Cloud.
  // Reveal the app only when its document is actually mounted; otherwise an
  // empty window covers the desktop and makes the dock appear unresponsive.
  const hasMountedPath = Boolean(app?.querySelector('.ps.on'));
  if (app?.classList.contains('active') && hasMountedPath) {
    app.classList.remove('shell-hidden');
  }
  updateDockState();
  requestAnimationFrame(() => {
    const target = app?.classList.contains('active') && hasMountedPath && !app.classList.contains('is-minimized') ? app : $('directory-window');
    target?.focus?.({ preventScroll: true });
  });
}
