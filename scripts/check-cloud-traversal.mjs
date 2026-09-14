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
assert.ok(source.includes('scrollCloudY + .1 - scrollBoundsY.min'), 'Scroll rests on the sampled cloud surface');
assert.ok(!source.includes('function createUpperTerrace'), 'No separate flat upper shelf is rendered');
assert.ok(source.includes('function upperCloudBandAt'), 'The visible upper cloud supplies its own collision band');
assert.ok(source.includes('carvePassageThroughCloud(cloud)'), 'The decorative cloud is opened at the real passage');
assert.ok(source.includes('cloudSolids.push(envelope)'), 'The enclosing top cloud participates in camera collision');
assert.ok(source.includes('maxFlightHeight = TOP_CEILING_Y - 1.9'), 'The top cloud limits player ascent');
assert.ok(source.includes("surface = 'cloud-underside'"), 'The visible upper cloud blocks ascent outside the opening');
assert.ok(source.includes("surface = 'cloud-top'"), 'The visible upper cloud catches falls outside the opening');
assert.ok(!source.includes('if (!record.colliderRadius || record.locked) return'), 'Locked moon collision remains solid');
assert.ok(source.includes('record.object.position.lerpVectors(aboveOpening, belowOpening'), 'The moon falls vertically through the opening');
assert.ok(!source.includes('markVisited(record, false)'), 'Landing does not count as visiting the moon');
assert.ok(!source.includes('setInterval(refresh'), 'The post board does not poll on a timer');
assert.ok(source.includes('scrollBoard?.userData?.refresh?.()'), 'The post board refreshes when returning to the world');
assert.ok(source.includes('return bTime - aTime'), 'The newest post is drawn first');
assert.ok(source.includes('texture.generateMipmaps = false'), 'Canvas signs avoid unstable mipmap flashing');
assert.ok(source.includes("window.location.assign('/admin')"), 'The below-cloud board opens owner login');
assert.ok(guideSource.includes("item.level === level"), 'The arrow filters destinations to the current level');
assert.ok(guideSource.includes("item.id !== 'friend' || !item.locked"), 'The arrow ignores the moon until it is unlocked');
assert.ok(guideSource.includes('delta.dot(cameraRight)'), 'The arrow uses the full camera-relative 3D direction');
assert.ok(source.includes('passageRadiusAt(angle)'), 'The cloud opening uses an irregular torn boundary');
assert.ok(source.includes('const crownTone = new THREE.Color(0xaaa1b2)'), 'The enclosing ceiling reads as illuminated cloud');
assert.ok(source.includes('CAMERA_PITCH_MIN = -0.92'), 'Vertical orbit allows a clear view upward');
assert.ok(source.includes('Math.max(0, -cameraPitch) * 10.5'), 'Upward orbit raises the camera target toward the sky');

const floor = new THREE.Mesh(new THREE.BoxGeometry(40, 2, 40), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
floor.position.y = -1;
floor.updateMatrixWorld(true);
const upperCloud = new THREE.Mesh(new THREE.BoxGeometry(40, 4, 40), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
upperCloud.position.y = 27;
upperCloud.updateMatrixWorld(true);
const state = vm.createContext({
  THREE, PLATFORM: { top: 0 }, PASSAGE: { x: 0, z: 0, radius: 8 },
  PLAYER_RADIUS: .42, PLAYER_HEIGHT: 1.9, UPPER_TERRACE_Y: 27, UPPER_TERRACE_THICKNESS: 2.4,
  CLOUD_CEILING_CENTER_Y: 17, CLOUD_CEILING_RADIUS_Y: 42,
  TOP_CEILING_Y: 59, maxFlightHeight: 57.1, cloudFloorVisual: floor, upperCloudVisual: upperCloud,
  groundProbeOrigin: new THREE.Vector3(), groundProbeDirection: new THREE.Vector3(0, -1, 0),
  groundRaycaster: new THREE.Raycaster(), cloudSweep: new THREE.Raycaster(),
  sweepDirection: new THREE.Vector3(), cloudSolids: [floor],
  player: { position: new THREE.Vector3(0, 13, 0) }, flightMode: true, grounded: false,
});
for (const name of ['passageRadiusAt', 'inUpperPassage', 'ceilingHeightAt', 'lowerGroundHeightAt', 'upperCloudBandAt', 'upperSurfaceHeightAt', 'groundHeightAt', 'cloudClearance', 'moveThroughClouds', 'resolveVerticalTravel']) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf('\n}', start) + 2;
  vm.runInContext(source.slice(start, end), state);
}
assert.equal(state.groundHeightAt(0, 0, 32), .08, 'The central opening exposes the lower floor');
assert.equal(state.groundHeightAt(12, 0, 32), 29.08, 'The rendered cloud top is the walkable upper floor');
assert.equal(state.resolveVerticalTravel(20, 32, 12, 0).surface, 'cloud-underside', 'Flight cannot cross the cloud outside the opening');
assert.equal(state.resolveVerticalTravel(20, 32, 0, 0).y, 32, 'Flight crosses the terrace through the opening');
assert.equal(state.resolveVerticalTravel(32, 20, 12, 0).surface, 'cloud-top', 'Falling outside the opening lands on the cloud');
assert.ok(state.resolveVerticalTravel(50, 70, 0, 0).y <= 56.9, 'The enclosing crown caps flight');
assert.notEqual(state.passageRadiusAt(0), state.passageRadiusAt(Math.PI / 3), 'The opening is not circular');
state.player.position.set(0, 24.5, 0);
const rim = state.moveThroughClouds(12, 0);
assert.ok(Math.hypot(rim.x, rim.z) <= state.passageRadiusAt(0) - .42 + 1e-6, 'The solid opening rim cannot be crossed mid-ascent');
console.log('Cloud traversal checks passed.');
