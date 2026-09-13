// Regression checks for navigation priority over the asynchronous card greeting.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../static/js/paths/recruiter.js', import.meta.url), 'utf8');
function harness(mode = 'world') {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) {
      const classes = new Set();
      elements.set(id, {
        style: {}, scrollTop: 0, textContent: '',
        classList: { add: (...names) => names.forEach(n => classes.add(n)), remove: (...names) => names.forEach(n => classes.delete(n)), contains: n => classes.has(n) },
        getBoundingClientRect() {},
      });
    }
    return elements.get(id);
  };
  const motions = [], frames = [];
  const state = vm.createContext({
    $: element, document: { body: { dataset: { shellMode: mode } } },
    CARD: { role: 'Engineer' }, bootDone: false, introCancelled: false,
    foldActive: false, foldAnimating: false, tiltRaf: null,
    tiltX: 0, tiltY: 0, tiltXt: 0, tiltYt: 0, isFlipping: false, showingBack: false,
    REDUCED_MOTION: { matches: false }, FOLD_AT: () => 280, UNFOLD_AT: () => 100,
    clamp: (n, a, b) => Math.max(a, Math.min(b, n)),
    cycleRecs() {}, makeQR() {}, setShellSwitchInMini() {}, tiltLoop() {},
    setTimeout() {}, cancelAnimationFrame() {},
    requestAnimationFrame: callback => { frames.push(callback); return frames.length; },
    afterMotion: (node, name, callback) => motions.push(callback),
  });
  for (const name of ['finishCardIntro', 'dropCard', 'handleScroll', 'doFold', 'doUnfold']) {
    const start = source.indexOf(`function ${name}(`);
    assert.ok(start >= 0);
    vm.runInContext(source.slice(start, source.indexOf('\n}', start) + 2), state);
  }
  return { state, element, motions, frames };
}

const fast = harness();
fast.state.dropCard();
assert.equal(fast.element('cardWrap').classList.contains('do-drop'), true);
fast.element('rec-scroll').scrollTop = 600;
fast.state.handleScroll();
assert.equal(fast.state.bootDone, true);
assert.equal(fast.state.foldAnimating, true);
assert.equal(fast.element('cg').style.display, 'none');
await fast.motions.shift()(); // Late drop completion must not restart the greeting.
assert.equal(fast.element('cardWrap').classList.contains('do-drop'), false);
fast.element('rec-scroll').scrollTop = 0; // Reverse while the fold is still moving.
fast.motions.shift()();
fast.frames.shift()();
assert.equal(fast.state.foldActive, false);
assert.equal(fast.element('cardWrap').classList.contains('folding-down'), true);
fast.motions.shift()();
assert.equal(fast.state.foldAnimating, false);

const restored = harness();
restored.element('rec-scroll').scrollTop = 500;
restored.state.dropCard();
assert.equal(restored.state.bootDone, true);
assert.equal(restored.state.foldActive, true);
const device = harness('directory');
device.state.dropCard();
assert.equal(device.state.bootDone, true);
assert.equal(device.state.foldActive, false);
console.log('Card checks passed: fast scroll, stale greeting, scroll reversal, restored scroll and Device entry.');
