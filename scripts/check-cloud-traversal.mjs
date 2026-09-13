// Exercise the same geometry and containment functions used by the game.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from 'three';
import { CLOUD_SPACE, createCloudGeometry, lowerFloorAt, upperCeilingAt, inPassage, constrainCloudPoint } from '../static/js/cloud-space.js';
const source = fs.readFileSync(new URL('../static/js/graybox.js', import.meta.url), 'utf8');
const geometry = createCloudGeometry();
const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
const shell = new THREE.Mesh(geometry.shell, material);
const terrace = new THREE.Mesh(geometry.terrace, material);
shell.updateMatrixWorld(true); terrace.updateMatrixWorld(true);
const ray = new THREE.Raycaster();
let samples = 0;
for (let x = -32; x <= 32; x += 2) for (let z = -46; z <= 46; z += 2) {
  if (Math.hypot(x / 36, z / 52) > .94) continue;
  ray.set(new THREE.Vector3(x, 100, z), new THREE.Vector3(0, -1, 0)); ray.far = 200;
  const hits = ray.intersectObject(shell);
  assert.ok(hits.length >= 2, 'Closed floor and ceiling at ' + x + ',' + z);
  const shelfHits = ray.intersectObject(terrace);
  if (Math.hypot(x, z) < 7.8) assert.equal(shelfHits.length, 0);
  else if (Math.hypot(x, z) > 8.2) assert.ok(shelfHits.length >= 2, 'Complete middle floor');
  const clamped = constrainCloudPoint(new THREE.Vector3(x, 200, z));
  assert.ok(clamped.y + 1.8 < hits[0].point.y, 'Ceiling containment leaves headroom');
  samples++;
}
for (let x = -5; x <= 5; x++) for (let z = 32; z <= 42; z++) {
  assert.ok(lowerFloorAt(x, z) < 1, 'Starting area remains shallow and walkable');
}
const state = vm.createContext({
  THREE, CLOUD_SPACE, lowerFloorAt, upperCeilingAt, inPassage, PLAYER_RADIUS: .42,
  cloudSweep: new THREE.Raycaster(), sweepDirection: new THREE.Vector3(),
  cloudSolids: [shell, terrace], player: { position: new THREE.Vector3(0, 1, 38) },
});
for (const name of ['groundHeightAt', 'cloudClearance', 'moveThroughClouds']) {
  const start = source.indexOf('function ' + name + '(');
  vm.runInContext(source.slice(start, source.indexOf('\n}', start) + 2), state);
}
assert.equal(state.cloudClearance(new THREE.Vector3(0, 3, 0), new THREE.Vector3(0, 20, 0), .2), 1);
assert.equal(state.cloudClearance(new THREE.Vector3(0, 20, 0), new THREE.Vector3(0, 3, 0), .2), 1);
assert.ok(state.cloudClearance(new THREE.Vector3(14, 3, 8), new THREE.Vector3(14, 20, 8), .2) < 1);
assert.ok(state.cloudClearance(new THREE.Vector3(0, 20, 0), new THREE.Vector3(0, 100, 0), .2) < 1);
assert.equal(state.groundHeightAt(14, 8, 16), 14.12);
assert.ok(state.groundHeightAt(0, 0, 16) < 1);
assert.ok(upperCeilingAt(-10, -17) > CLOUD_SPACE.terraceY + 18 + 2, 'Ship clears ceiling');
console.log('Cloud checks passed: ' + samples + ' floor/ceiling samples, continuous middle floor, shallow spawn and two-way opening.');

// Held touch descent survives movement outside the button until release.
const handlers = new Map();
const drop = { addEventListener: (name, fn) => handlers.set(name, fn), setPointerCapture() {} };
const input = vm.createContext({
  touchDropHeld: false, touchFlightCruise: true, verticalVelocity: 0,
  $: () => null, endSpaceInput() {}, setStatus() {},
});
const bindStart = source.indexOf('function bindTouchControls(');
vm.runInContext(source.slice(bindStart, source.indexOf('\n}', bindStart) + 2), input);
input.bindTouchControls({ querySelector: selector => selector === '[data-graybox-action="drop"]' ? drop : null });
handlers.get('pointerdown')({ pointerId: 1, preventDefault() {}, stopPropagation() {} });
assert.equal(input.touchDropHeld, true);
assert.equal(input.touchFlightCruise, false);
assert.equal(handlers.has('pointerleave'), false, 'Captured hold is not cancelled by drifting off button');
handlers.get('pointerup')();
assert.equal(input.touchDropHeld, false);
console.log('Touch checks passed: held Drop, pointer capture and release.');
