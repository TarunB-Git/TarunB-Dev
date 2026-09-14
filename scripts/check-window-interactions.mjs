import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from 'three';

const directoryCss = fs.readFileSync(new URL('../static/css/directory.css', import.meta.url), 'utf8');
const navigationCss = fs.readFileSync(new URL('../static/css/cloud-navigation.css', import.meta.url), 'utf8');
assert.ok(directoryCss.includes('body[data-shell-mode="directory"] .directory-dock{'));
assert.ok(directoryCss.includes('top:2px;bottom:auto'), 'Window switcher stays in the OS bar');
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
  PATH_TITLES: { recruiter: 'Work' }, REDUCED: { matches: true },
  setTimeout() {}, clearTimeout() {}, updateDockState() {}, renderLocation() {},
  entriesFor: path => ['/home/guest', '/home/guest/Trash'].includes(path) ? [] : null,
  currentLocation: '/home/guest/Desktop', locationHistory: ['/home/guest/Desktop'], historyIndex: 0,
});
install(directory, fs.readFileSync(new URL('../static/js/directory.js', import.meta.url), 'utf8'), ['focusWindow', 'restoreFiles', 'navigate', 'setDirectoryApp']);
const app = nodes.get('directory-app-window'), files = nodes.get('directory-window');
app.classList.add('active', 'is-minimized');
directory.setDirectoryApp('recruiter', true);
assert.equal(app.parentElement, nodes.get('s-directory'));
assert.equal(app.classList.contains('is-minimized'), false);
files.classList.add('is-minimized');
directory.navigate('/home/guest');
assert.equal(files.classList.contains('is-minimized'), false);
assert.ok(+files.style.zIndex > +app.style.zIndex);
assert.equal(app.classList.contains('active'), true, 'Switching to Files does not close the path');
directory.navigate('/home/guest/Trash');
assert.equal(directory.currentLocation, '/home/guest/Trash');
directory.focusWindow(app);
assert.ok(+app.style.zIndex > +files.style.zIndex);
assert.equal(nodes.get('s-directory').inert, false, 'Dock remains available with a path open');
body.dataset.shellMode = 'world'; directory.setDirectoryApp(null, false);
assert.equal(app.parentElement, body, 'Cloud paths are outside the hidden Device desktop');
assert.equal(app.classList.contains('shell-hidden'), false, 'Cloud path wrapper cannot retain Device hidden state');

const opened = [], timers = [];
const scroll = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1)); scroll.position.x = 2;
const record = { id: 'personal', object: scroll, label: 'scroll', title: 'Library', interactionRadius: 4, focus: new THREE.Vector3(), locked: false };
const game = vm.createContext({
  THREE, landmarks: new Map([['personal', record]]), player: { position: new THREE.Vector3() },
  nearLandmarkId: 'viewer', interactionFocus: 0, focusedLandmarkId: null,
  FOCUS_DURATION: 2.4, landmarkFocus: new THREE.Vector3(), pathTimer: null,
  $: () => null, markVisited() {}, setStatus() {}, clearTimeout() {},
  reducedMotion: { matches: false }, setTimeout: callback => { timers.push(callback); return timers.length; },
  opts: { onPathChosen: id => opened.push(id) },
});
install(game, fs.readFileSync(new URL('../static/js/graybox.js', import.meta.url), 'utf8'), ['landmarkDistance', 'interact']);
game.interact('personal'); game.interact('personal');
assert.equal(timers.length, 1, 'Repeated taps cannot restart the opening timer');
timers.shift()(); assert.deepEqual(opened, ['personal'], 'Clicked in-range object opens even if another object was nearest');
game.interactionFocus = 0; scroll.position.x = 30; game.interact('personal');
assert.equal(timers.length, 0, 'Out-of-range objects still require approach');
console.log('Window and click checks passed: Home/Trash restoration, stacking, Cloud reparenting and direct model interaction.');
