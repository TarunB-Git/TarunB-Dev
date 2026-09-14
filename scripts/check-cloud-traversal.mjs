// Numerical checks for Cloud traversal; no browser or rendering required.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from 'three';

const source = fs.readFileSync(new URL('../static/js/graybox.js', import.meta.url), 'utf8');
const guideSource = fs.readFileSync(new URL('../static/js/cloud-guide.js', import.meta.url), 'utf8');
assert.ok(source.includes("import { createCloudGuide } from './cloud-guide.js'"), 'Current 3D guide remains connected');
assert.ok(guideSource.includes('new THREE.PerspectiveCamera'), 'Current perspective arrow remains intact');
assert.equal((source.match(/function createScrollBoard\(/g) || []).length, 1, 'Exactly one world board remains');
assert.ok(!source.includes('createWorldBoard'), 'Scattered board system is removed');
assert.ok(source.includes('SCROLL_POS.set(SPAWN.x, SHIP_POS.y + 1.05, SPAWN.z)'), 'Scroll is lowered to the ship level');
assert.ok(source.includes('cloudSolids.push(envelope)'), 'The enclosing top cloud participates in camera collision');
assert.ok(source.includes('maxFlightHeight = TOP_CEILING_Y - 1.9'), 'The top cloud limits player ascent');
assert.ok(!source.includes('setInterval(refresh'), 'The post board does not poll on a timer');
assert.ok(source.includes('scrollBoard?.userData?.refresh?.()'), 'The post board refreshes when returning to the world');
assert.ok(source.includes('return bTime - aTime'), 'The newest post is drawn first');

const floor = new THREE.Mesh(new THREE.BoxGeometry(40, 2, 40), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
floor.position.y = -1;
const shelf = new THREE.Mesh(new THREE.BoxGeometry(40, 6, 40), floor.material.clone());
shelf.position.y = 20;
floor.updateMatrixWorld(true); shelf.updateMatrixWorld(true);
const state = vm.createContext({
  THREE, PLATFORM: { top: 0 }, cloudFloorVisual: floor, upperCloudVisual: shelf,
  groundProbeOrigin: new THREE.Vector3(), groundProbeDirection: new THREE.Vector3(0, -1, 0),
  groundRaycaster: new THREE.Raycaster(), cloudSweep: new THREE.Raycaster(),
  sweepDirection: new THREE.Vector3(), cloudSolids: [floor, shelf],
  player: { position: new THREE.Vector3(0, 18, 0) }, flightMode: true, grounded: false,
  cameraSoftClouds: new Set(),
});
for (const name of ['groundHeightAt', 'cloudClearance', 'moveThroughClouds', 'updateCloudPassageOpacity']) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf('\n}', start) + 2;
  vm.runInContext(source.slice(start, end), state);
}
assert.equal(state.groundHeightAt(0, 0, 18), .08, 'Inside a cloud must not land on its underside');
assert.equal(state.groundHeightAt(0, 0, 24), 23.08, 'Above a cloud lands on its upper surface');
assert.equal(state.moveThroughClouds(5, 5).x, 5, 'Flying is not blocked by cloud sides');
state.updateCloudPassageOpacity(1);
assert.equal(shelf.material.opacity, .12, 'The existing middle cloud remains passable');
state.player.position.y = 26;
state.updateCloudPassageOpacity(1);
assert.equal(shelf.material.opacity, 1, 'Middle cloud appearance returns above the shelf');
assert.equal(state.cameraSoftClouds.size, 0, 'Normal camera protection returns after passage');
console.log('Cloud traversal checks passed.');
