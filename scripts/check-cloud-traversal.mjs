// Numerical checks for Cloud traversal; no browser or rendering required.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from 'three';

const source = fs.readFileSync(new URL('../static/js/graybox.js', import.meta.url), 'utf8');
const guideSource = fs.readFileSync(new URL('../static/js/cloud-guide.js', import.meta.url), 'utf8');
assert.ok(source.includes("import { createCloudGuide } from './cloud-guide.js'"), 'Current 3D guide remains connected');
assert.ok(guideSource.includes('new THREE.PerspectiveCamera'), 'Current perspective arrow remains intact');
assert.equal((source.match(/function createScrollBoard\(/g) || []).length, 1, 'Exactly one scroll board remains');
assert.equal((source.match(/function createAdminBoard\(/g) || []).length, 1, 'Exactly one lower-pocket admin board exists');
assert.ok(!source.includes('createWorldBoard'), 'Scattered board system is removed');
assert.ok(source.includes("window.location.assign('/admin')"), 'Lower-pocket board opens the admin page');
assert.ok(source.includes('payload.items'), 'Recent-post board understands paginated API responses');
assert.ok(source.includes('return bTime - aTime'), 'Recent-post board orders newest posts first');
const floor = new THREE.Mesh(new THREE.BoxGeometry(40, 2, 40), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
floor.position.y = -1;
const middle = new THREE.Mesh(new THREE.RingGeometry(2, 20, 48, 4), floor.material.clone());
middle.rotation.x = -Math.PI / 2;
middle.position.y = 10;
const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), floor.material.clone());
ceiling.rotation.x = -Math.PI / 2;
ceiling.position.y = 16;
const canopy = new THREE.Mesh(new THREE.BoxGeometry(40, 2, 40), floor.material.clone());
canopy.position.y = 16;
floor.updateMatrixWorld(true); middle.updateMatrixWorld(true); ceiling.updateMatrixWorld(true); canopy.updateMatrixWorld(true);
const state = vm.createContext({
  THREE, PLATFORM: { top: 0 }, PLAYER_RADIUS: .42, PASSAGE: { x: 0, z: 0, radius: 2 },
  cloudFloorVisual: floor, middleCloudVisual: middle, upperCloudVisual: canopy,
  firstLevelHeight: 10, ceilingHeight: 16, verticalVelocity: 2,
  groundProbeOrigin: new THREE.Vector3(), groundProbeDirection: new THREE.Vector3(0, -1, 0),
  groundRaycaster: new THREE.Raycaster(), cloudSweep: new THREE.Raycaster(),
  sweepDirection: new THREE.Vector3(), cloudSolids: [floor, middle, ceiling],
  player: { position: new THREE.Vector3(0, 8, 0) }, flightMode: true, grounded: false,
  cameraSoftClouds: new Set(),
});
for (const name of ['insidePassage', 'groundHeightAt', 'cloudClearance', 'moveThroughClouds', 'constrainVerticalCloudLevels', 'updateCloudPassageOpacity']) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf('\n}', start) + 2;
  vm.runInContext(source.slice(start, end), state);
}
assert.equal(state.groundHeightAt(0, 0, 12), .08, 'The central opening reaches the ground level');
assert.equal(state.groundHeightAt(5, 0, 12), 10.08, 'The middle cloud is solid outside its opening');
assert.equal(state.moveThroughClouds(5, 5).x, 5, 'Flying is not blocked by cloud sides');
state.player.position.set(5, 9, 0);
state.constrainVerticalCloudLevels(8);
assert.equal(state.player.position.y, 8.12, 'Test setup uses the configured middle underside');
assert.equal(state.verticalVelocity, 0, 'Rising into the solid middle cloud is stopped');
state.player.position.set(0, 8, 0);
state.verticalVelocity = 2;
state.constrainVerticalCloudLevels(6);
assert.equal(state.player.position.y, 8, 'The central opening remains passable');
state.player.position.set(0, 18, 0);
state.constrainVerticalCloudLevels(15);
assert.equal(state.player.position.y, 14.08, 'The upper cloud ceiling is solid');
state.updateCloudPassageOpacity(1);
assert.equal(canopy.material.opacity, 1, 'The upper cloud ceiling stays opaque');
assert.equal(state.cameraSoftClouds.size, 0, 'The solid ceiling remains camera-protected');
assert.ok(source.includes('abovePassage') && source.includes('belowPassage'), 'The moon falls through the middle passage');
console.log('Cloud traversal checks passed.');
