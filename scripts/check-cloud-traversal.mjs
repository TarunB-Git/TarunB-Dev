// Actual-model traversal checks without a browser or GPU.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
const source = fs.readFileSync(new URL('../static/js/graybox.js', import.meta.url), 'utf8');
const binary = fs.readFileSync(new URL('../static/assets/models/ship_in_clouds.glb', import.meta.url));
const jsonLength = binary.readUInt32LE(12);
const json = JSON.parse(binary.subarray(20, 20 + jsonLength));
json.buffers[0].uri = 'data:application/octet-stream;base64,' + binary.subarray(28 + jsonLength).toString('base64');
delete json.images; delete json.textures; json.materials = [];
for (const mesh of json.meshes) for (const primitive of mesh.primitives) delete primitive.material;
globalThis.ProgressEvent = class {};
const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
const gltf = await loader.parseAsync(JSON.stringify(json), '');
const state = vm.createContext({
  THREE, cloneSkeleton: clone, PLATFORM: { top: .5 }, SPAWN: new THREE.Vector3(0, .5, 38),
  PASSAGE: { x: 0, z: 8, radius: 7 }, scene: new THREE.Scene(),
  cloudFloorVisual: null, cloudChamber: null, upperCloudVisual: null, platformVisual: null,
  scrollShelfHeight: 30, maxFlightHeight: 48,
  groundProbeOrigin: new THREE.Vector3(), groundProbeDirection: new THREE.Vector3(0, -1, 0),
  groundRaycaster: new THREE.Raycaster(), cloudSweep: new THREE.Raycaster(),
  sweepDirection: new THREE.Vector3(), cloudSolids: [],
  player: { position: new THREE.Vector3(0, .5, 38) }, flightMode: true, grounded: false,
  createCloudSurfaceTexture: () => new THREE.Texture(), applyLandmarkLayout: () => {}, createWorldBoard: () => {},
});
for (const name of ['fitModel', 'addShipCloudScenery', 'terraceTopAt', 'chamberCeilingAt', 'groundHeightAt', 'cloudClearance', 'moveThroughClouds']) {
  const start = source.indexOf('function ' + name + '(');
  assert.ok(start >= 0, 'Missing ' + name);
  const end = source.indexOf('\n}', start) + 2;
  vm.runInContext(source.slice(start, end), state);
}
state.addShipCloudScenery(gltf);
const ray = new THREE.Raycaster(new THREE.Vector3(0, 60, 8), new THREE.Vector3(0, -1, 0), 0, 150);
assert.equal(ray.intersectObject(state.upperCloudVisual, true).length, 0, 'Opening cuts through both shelf surfaces');
assert.ok(Math.abs(state.groundHeightAt(0, 38, 1) - .5) < .02, 'Spawn rests on the chamber floor');
for (const [x, z] of [[-11, -18], [14, 8], [18, 10]]) {
  ray.set(new THREE.Vector3(x, 100, z), new THREE.Vector3(0, -1, 0));
  assert.ok(ray.intersectObject(state.upperCloudVisual, true).length > 0, 'Terrace supports each landmark');
  assert.ok(state.terraceTopAt(x, z) > 10 && state.terraceTopAt(x, z) < 15);
}
const start = new THREE.Vector3(0, 3, 8), end = new THREE.Vector3(0, 18, 8);
assert.equal(state.cloudClearance(start, end, .2), 1, 'Ascent through opening');
assert.equal(state.cloudClearance(end, start, .2), 1, 'Descent through opening');
assert.ok(state.cloudClearance(new THREE.Vector3(14, 3, 8), new THREE.Vector3(14, 18, 8), .2) < 1, 'Shelf remains solid away from passage');
assert.ok(state.cloudClearance(end, new THREE.Vector3(0, 100, 8), .2) < 1, 'Upper ceiling stops flight');
ray.set(new THREE.Vector3(17, 150, -31), new THREE.Vector3(0, -1, 0)); ray.far = 300;
const moonChamber = ray.intersectObject(state.cloudChamber, true);
const moonY = Math.min(30, state.chamberCeilingAt(17, -31) - 5);
assert.ok(moonChamber[0].point.y > moonY + 4.5, 'Moon fits below the ceiling');
assert.ok(moonChamber.at(-1).point.y < 27.5, 'Moon remains inside the chamber');
console.log('Actual-model checks passed: floor, landmark terrace, two-way passage, solid shelf and ceiling.');
assert.ok(state.chamberCeilingAt(-11, -18) > state.terraceTopAt(-11, -18) + 25, 'Ship fits beneath the upper ceiling');
