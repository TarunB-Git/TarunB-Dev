import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from 'three';
import { applyBookingLink, loadBookingUrl, safeBookingUrl } from '../static/js/booking.js';

const directoryCss = fs.readFileSync(new URL('../static/css/directory.css', import.meta.url), 'utf8');
const navigationCss = fs.readFileSync(new URL('../static/css/cloud-navigation.css', import.meta.url), 'utf8');
assert.ok(directoryCss.includes('body[data-shell-mode="directory"] .directory-dock{'));
assert.ok(directoryCss.includes('left:8px;top:50%;bottom:auto'), 'Window switcher remains in the Device sidebar');
assert.ok(directoryCss.includes('.directory-dock-item small{display:block}'), 'Open window names remain visible');
assert.ok(directoryCss.includes('.directory-resize-handle{display:block}'), 'Mobile resize handles remain available');
assert.ok(directoryCss.includes('.directory-app-window.active:not(.is-maximized)'), 'Mobile windows have a restored, resizable size');
assert.ok(navigationCss.includes('#mini .is-mini-privacy'), 'Cloud recruiter privacy control is integrated into its navbar');

function install(context, source, names) {
  for (const name of names) {
    const start = source.indexOf(`function ${name}(`);
    assert.ok(start >= 0, name);
    vm.runInContext(source.slice(start, source.indexOf('\n}', start) + 2), context);
  }
}
function node(id) {
  const classes = new Set();
  return { id, dataset: {}, style: {}, inert: false, focus() {},
    append(child) { child.parentElement = this; },
    classList: { add: (...names) => names.forEach(n => classes.add(n)), remove: (...names) => names.forEach(n => classes.delete(n)), contains: n => classes.has(n), toggle: (n, on) => on ? classes.add(n) : classes.delete(n) },
  };
}
const nodes = new Map(['s-directory', 'directory-window', 'directory-app-window', 'app-window-title'].map(id => [id, node(id)]));
const body = node('body'); body.dataset.shellMode = 'directory';
const directory = vm.createContext({
  $: id => nodes.get(id), document: { body }, windowOrder: 60,
  innerWidth: 390, innerHeight: 844,
  PATH_TITLES: { recruiter: 'Work' }, REDUCED: { matches: true },
  setTimeout() {}, clearTimeout() {}, updateDockState() {}, renderLocation() {},
  entriesFor: path => ['/home/guest', '/home/guest/Trash'].includes(path) ? [] : null,
  currentLocation: '/home/guest/Desktop', locationHistory: ['/home/guest/Desktop'], historyIndex: 0,
});
install(directory, fs.readFileSync(new URL('../static/js/directory.js', import.meta.url), 'utf8'), ['isMobileWindow', 'maximizeNewMobileWindow', 'focusWindow', 'restoreFiles', 'navigate', 'setDirectoryApp']);
const app = nodes.get('directory-app-window'), files = nodes.get('directory-window');
directory.setDirectoryApp('recruiter', true);
assert.equal(app.parentElement, nodes.get('s-directory'));
assert.equal(app.classList.contains('is-maximized'), true, 'A newly opened mobile path fills the screen');
app.classList.remove('is-maximized');
app.classList.add('is-minimized');
directory.setDirectoryApp('recruiter', true);
assert.equal(app.classList.contains('is-minimized'), false);
assert.equal(app.classList.contains('is-maximized'), false, 'Restoring preserves the user-selected window size');
directory.maximizeNewMobileWindow(files);
assert.equal(files.classList.contains('is-maximized'), true, 'Mobile Files starts maximized');
files.classList.remove('is-maximized');
files.classList.add('is-minimized');
directory.navigate('/home/guest');
assert.equal(files.classList.contains('is-minimized'), false);
assert.ok(+files.style.zIndex > +app.style.zIndex);
assert.equal(app.classList.contains('active'), true, 'Switching to Files does not close the path');
files.classList.remove('is-restoring');
directory.navigate('/home/guest/Trash');
assert.equal(directory.currentLocation, '/home/guest/Trash');
assert.equal(files.classList.contains('is-restoring'), false, 'Folder navigation does not replay the window-open animation');
directory.restoreFiles();
assert.equal(files.classList.contains('is-restoring'), false, 'Switching back to an already-open Files window only focuses it');
directory.focusWindow(app);
assert.ok(+app.style.zIndex > +files.style.zIndex);
assert.equal(nodes.get('s-directory').inert, false, 'Dock remains available with a path open');
body.dataset.shellMode = 'world'; directory.setDirectoryApp(null, false);
assert.equal(app.parentElement, body, 'Cloud paths are outside the hidden Device desktop');
assert.equal(app.classList.contains('shell-hidden'), false, 'Cloud path wrapper cannot retain Device hidden state');

const opened = [], timers = [];
const grayboxSource = fs.readFileSync(new URL('../static/js/graybox.js', import.meta.url), 'utf8');
const scroll = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1)); scroll.position.x = 2;
const record = { id: 'personal', object: scroll, label: 'scroll', title: 'Library', interactionRadius: 4, focus: new THREE.Vector3(), locked: false };
const game = vm.createContext({
  THREE, landmarks: new Map([['personal', record]]), player: { position: new THREE.Vector3() },
  nearLandmarkId: 'viewer', interactionFocus: 0, focusedLandmarkId: null,
  FOCUS_DURATION: 2.4, landmarkFocus: new THREE.Vector3(), pathTimer: null,
  $: () => null, markVisited() {}, setStatus() {}, clearTimeout() {},
  reducedMotion: { matches: false }, setTimeout: callback => { timers.push(callback); return timers.length; },
  opts: { onPathChosen: id => opened.push(id) },
  companions: [{ id: 'personal' }], LANDMARK_META: { personal: { title: 'Library' } },
});
install(game, grayboxSource, ['landmarkDistance', 'interact', 'openCompanion']);
game.interact('personal'); game.interact('personal');
assert.equal(timers.length, 1, 'Repeated taps cannot restart the opening timer');
timers.shift()(); assert.deepEqual(opened, ['personal'], 'Clicked in-range object opens even if another object was nearest');
game.interactionFocus = 0; scroll.position.x = 30; game.interact('personal');
assert.equal(timers.length, 0, 'Out-of-range objects still require approach');
game.openCompanion('personal');
assert.deepEqual(opened, ['personal', 'personal'], 'A visited miniature opens its path without landmark proximity');
game.openCompanion('viewer');
assert.equal(opened.length, 2, 'Only an actually collected miniature can open a path');
assert.ok(grayboxSource.includes('targets.push(...companions.map(companion => companion.object))'), 'Companions participate in raycast picking');
assert.ok(grayboxSource.includes("record.id === 'recruiter' ? 1.45 : 1.05"), 'The visited bird miniature has a forgiving click target');
assert.ok(grayboxSource.includes('speedUnlocked && joystick.forward > .55'), 'A normal mobile forward-diagonal drag can unlock the 2x surge');
assert.equal(safeBookingUrl('javascript:alert(1)'), '', 'The booking link rejects executable URLs');
globalThis.document = { body: { dataset: { contentSource: 'database' } } };
globalThis.fetch = async path => {
  assert.equal(path, '/api/v1/content/site', 'Both booking controls use the published Site destination first');
  return { ok: true, status: 200, headers: { get: () => 'application/json' },
    json: async () => ({ data: { booking_url: 'https://calendar.example/book' } }) };
};
const bookingUrl = await loadBookingUrl();
const calendarLink = { hidden: true, removeAttribute(name) { delete this[name]; } };
applyBookingLink(calendarLink, bookingUrl);
assert.equal(calendarLink.href, 'https://calendar.example/book');
assert.equal(calendarLink.hidden, false, 'Calendar booking action becomes visible with a valid URL');
assert.equal(calendarLink.target, '_blank', 'Booking opens directly in a new tab');
assert.ok(calendarLink.rel.includes('noopener'), 'External booking tab is isolated');
assert.ok(!fs.readFileSync(new URL('../static/index.html', import.meta.url), 'utf8').includes('href="/recruiter#contact"'), 'The Device calendar does not redirect to the card');
console.log('Window and click checks passed: Home/Trash restoration, stacking, Cloud reparenting and direct model interaction.');
