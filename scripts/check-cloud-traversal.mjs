// Exercise the same geometry and containment functions used by the game.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from 'three';
import { CLOUD_SPACE, createCloudGeometry, lowerFloorAt, upperCeilingAt, inPassage, constrainCloudPoint, terraceHeightAt, setCloudRelief } from '../static/js/cloud-space.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
const source = fs.readFileSync(new URL('../static/js/graybox.js', import.meta.url), 'utf8');
const geometry = createCloudGeometry();
const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
const shell = new THREE.Mesh(geometry.shell, material);
const terrace = new THREE.Mesh(geometry.terrace, material);
// Include the actual authored asset in the geometry regression, without GPU textures.
const binary = fs.readFileSync(new URL('../static/assets/models/ship_in_clouds.glb', import.meta.url));
const length = binary.readUInt32LE(12), asset = JSON.parse(binary.subarray(20, 20 + length));
asset.buffers[0].uri = 'data:application/octet-stream;base64,' + binary.subarray(28 + length).toString('base64');
delete asset.images; delete asset.textures; asset.materials = [];
for (const mesh of asset.meshes) for (const primitive of mesh.primitives) delete primitive.material;
globalThis.ProgressEvent = class {};
const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
const gltf = await loader.parseAsync(JSON.stringify(asset), '');
assert.ok(gltf.scene.getObjectByName('Cloud_Poly_Poly_0'));
const reliefContext = vm.createContext({ THREE, setCloudRelief, createCloudGeometry, cloudChamber: shell, upperCloudVisual: terrace, applyLandmarkLayout() {}, boardObject: null });
const reliefStart = source.indexOf('function restoreAuthoredCloudRelief(');
vm.runInContext(source.slice(reliefStart, source.indexOf('\n}', reliefStart) + 2), reliefContext);
reliefContext.restoreAuthoredCloudRelief(gltf);
shell.updateMatrixWorld(true); terrace.updateMatrixWorld(true);
const ray = new THREE.Raycaster();
let samples = 0;
for (let x = -44; x <= 44; x += 3) for (let z = -62; z <= 62; z += 3) {
  if (Math.hypot(x / 48, z / 68) > .94) continue;
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
  assert.ok(lowerFloorAt(x, z) < 2.2, 'Starting area retains modest relief, not huge mounds');
}
const state = vm.createContext({
  THREE, CLOUD_SPACE, lowerFloorAt, upperCeilingAt, inPassage, terraceHeightAt, PLAYER_RADIUS: .42,
  cloudSweep: new THREE.Raycaster(), sweepDirection: new THREE.Vector3(),
  cloudSolids: [shell, terrace], player: { position: new THREE.Vector3(0, 1, 38) },
});
for (const name of ['groundHeightAt', 'cloudClearance', 'moveThroughClouds']) {
  const start = source.indexOf('function ' + name + '(');
  vm.runInContext(source.slice(start, source.indexOf('\n}', start) + 2), state);
}
assert.equal(state.cloudClearance(new THREE.Vector3(0, 3, 0), new THREE.Vector3(0, 20, 0), .2), 1);
assert.equal(state.cloudClearance(new THREE.Vector3(0, 20, 0), new THREE.Vector3(0, 3, 0), .2), 1);
assert.ok(state.cloudClearance(new THREE.Vector3(14, 3, 8), new THREE.Vector3(14, 35, 8), .2) < 1);
assert.ok(state.cloudClearance(new THREE.Vector3(0, 20, 0), new THREE.Vector3(0, 100, 0), .2) < 1);
assert.equal(state.groundHeightAt(14, 8, 35), terraceHeightAt(14, 8) + .12);
assert.ok(state.groundHeightAt(0, 0, 35) < 2.2);
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
