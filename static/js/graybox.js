/* Explorable cloud-world prototype with four interactive portfolio landmarks. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { createCloudGuide } from './cloud-guide.js';

const $ = id => document.getElementById(id);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const coarsePointer = matchMedia('(pointer: coarse)');
const PLATFORM = { halfX: 26, halfZ: 48, top: 0.5 };
const PLAYER_RADIUS = 0.42;
const OBJECT_POS = new THREE.Vector3(-8, PLATFORM.top, -27);
const SHIP_POS = new THREE.Vector3(-13, 8.5, -32);
const MOON_POS = new THREE.Vector3(20, 19, -50);
const MOON_FAR_POS = new THREE.Vector3(20, 19, -50);
const MOON_LAND_POS = new THREE.Vector3(20, 8, -44);
const SCROLL_POS = new THREE.Vector3(16, 1.7, -29);
const BIRD_POS = new THREE.Vector3(-17, 11, -11);
const BIRD_CHASE_POINTS = Array.from({ length: 4 }, () => new THREE.Vector3());
const LANDMARK_META = {
  viewer: { label: 'ship', title: 'About', color: 0xb898d4 },
  friend: { label: 'moon', title: 'Story', color: 0x9ebcff },
  personal: { label: 'scroll', title: 'Library', color: 0xd7ad72 },
  recruiter: { label: 'birds', title: 'Work', color: 0xffd36b },
};
const LANDMARK_ANCHORS = {
  viewer: OBJECT_POS,
  friend: new THREE.Vector3(9, PLATFORM.top, -20),
  personal: new THREE.Vector3(10.5, PLATFORM.top, -9.5),
  recruiter: new THREE.Vector3(-10.5, PLATFORM.top, -7.5),
};
const MOON_REQUIREMENTS = ['viewer', 'personal', 'recruiter'];
const SPAWN = new THREE.Vector3(0, PLATFORM.top, 38);
const PASSAGE = { x: 0, z: 0, radius: 8 };
const TOP_CEILING_Y = 45;
const FOCUS_DURATION = 2.4;
const FOCUS_IN = 0.42;
const FOCUS_OUT = 0.72;
const DOUBLE_SPACE_WINDOW = 360;
const HOLD_TO_FLY_DELAY = 0.48;
let maxFlightHeight = TOP_CEILING_Y - 1.9;
let upperCloudVisual;
let guide;
let navTick = 0;
let scrollBoard;
let scrollShelfHeight = 30;
const cloudSolids = [];
const SPEED_TAP_WINDOW = 330;
const SPEED_BOOST_DURATION = 10;
const CHARACTER_KEY = 'cloud_character_v1';
const SPEED_UNLOCK_KEY = 'cloud_speed_unlocked_v1';

let opts = {};
let scene;
let camera;
let renderer;
let player;
let playerVisual;
let classicPlayerVisual;
let riggedPlayerVisual;
let playerShadow;
let playerMixer;
let playerActionName = '';
const playerActions = new Map();
let platformVisual;
let cloudFloorVisual;
let moonHalo;
let testObject;
let testCore;
let raycaster;
let pointerNdc;
let ready = false;
let running = false;
let frame = 0;
let lastFrameAt = 0;
let elapsed = 0;
let cameraYaw = 0;
let cameraPitch = 0.1;
let verticalVelocity = 0;
let grounded = true;
let flightMode = false;
let touchFlightCruise = false;
let touchDropHeld = false;
let forwardHeldFor = 0;
let forwardSurgeLatched = false;
let spaceHeld = false;
let spaceHeldFor = 0;
let lastSpaceTap = -Infinity;
let nearLandmarkId = null;
let hoveredLandmarkId = null;
let focusedLandmarkId = null;
let interactionFocus = 0;
let jumpQueued = false;
let drag = null;
let resizeTimer = 0;
let pathTimer = 0;
let loadedLandmarks = 0;

const keys = new Set();
const landmarks = new Map();
const companions = [];
const visitedPaths = loadVisitedPaths();
let speedUnlocked = false;
try { speedUnlocked = sessionStorage.getItem(SPEED_UNLOCK_KEY) === 'true'; } catch { /* session storage is optional */ }
let moonState = visitedPaths.has('friend') ? 'landed' : 'locked';
let moonFallElapsed = 0;
let moonFallPending = false;
let birdChaseStep = visitedPaths.has('recruiter') ? 3 : loadBirdChaseStep();
let birdTeleportCooldown = 0;
let lastForwardTap = -Infinity;
let speedBoostRemaining = 0;
const joystick = { forward: 0, turn: 0 };
const velocity = new THREE.Vector3();
const desiredVelocity = new THREE.Vector3();
const forward = new THREE.Vector3();
const cameraDesired = new THREE.Vector3();
const cameraLook = new THREE.Vector3();
const focusCamera = new THREE.Vector3();
const focusLook = new THREE.Vector3();
const landmarkFocus = new THREE.Vector3(OBJECT_POS.x, 1.6, OBJECT_POS.z);
const scaleTarget = new THREE.Vector3();
const visitedGray = new THREE.Color(0x727985);
const visitedGlow = new THREE.Color(0x222b39);
const groundRaycaster = new THREE.Raycaster();
const groundProbeOrigin = new THREE.Vector3();
const groundProbeDirection = new THREE.Vector3(0, -1, 0);
const cameraSoftClouds = new Set();

function loadVisitedPaths() {
  try {
    const value = JSON.parse(sessionStorage.getItem('cloud_landmarks_visited_v2') || '[]');
    return new Set(Array.isArray(value) ? value.filter(id => LANDMARK_META[id]) : []);
  } catch {
    return new Set();
  }
}

function loadBirdChaseStep() {
  try {
    return THREE.MathUtils.clamp(Number(sessionStorage.getItem('cloud_bird_chase_v1')) || 0, 0, 3);
  } catch {
    return 0;
  }
}

function applyLandmarkLayout() {
  const portrait = innerWidth < 620;
  OBJECT_POS.set(portrait ? -6 : -8, PLATFORM.top, portrait ? -24 : -27);
  SHIP_POS.set(portrait ? -2 : 0, portrait ? 7.5 : 8.5, portrait ? -27 : -32);
  MOON_FAR_POS.set(portrait ? 12 : 20, portrait ? 18 : 19, portrait ? -44 : -50);
  MOON_LAND_POS.set(portrait ? 12 : 20, portrait ? 8 : 8, portrait ? -39 : -44);
  if (moonState !== 'falling') MOON_POS.copy(moonState === 'landed' ? MOON_LAND_POS : MOON_FAR_POS);
  // Keep the scroll over the starting point, lowered to the ship's level.
  SCROLL_POS.set(SPAWN.x, SHIP_POS.y + 1.05, SPAWN.z);
  BIRD_CHASE_POINTS[0].set(portrait ? -2 : -3, portrait ? 8 : 9, portrait ? 15 : 13);
  BIRD_CHASE_POINTS[1].set(portrait ? 6 : 8, portrait ? 7.5 : 8.5, portrait ? 43 : 45);
  BIRD_CHASE_POINTS[2].set(portrait ? -9 : -12, portrait ? 9 : 10, portrait ? 5 : 2);
  BIRD_CHASE_POINTS[3].set(portrait ? 8 : 12, portrait ? 8.5 : 9.5, portrait ? -17 : -20);
  BIRD_POS.copy(BIRD_CHASE_POINTS[Math.min(birdChaseStep, BIRD_CHASE_POINTS.length - 1)]);
  LANDMARK_ANCHORS.friend.set(MOON_LAND_POS.x, PLATFORM.top, MOON_LAND_POS.z + 6);
  LANDMARK_ANCHORS.viewer.set(SHIP_POS.x, PLATFORM.top, SHIP_POS.z + 5);
  LANDMARK_ANCHORS.personal.set(SCROLL_POS.x, PLATFORM.top, SCROLL_POS.z);
  LANDMARK_ANCHORS.recruiter.set(BIRD_POS.x, PLATFORM.top, BIRD_POS.z);

  const positions = { viewer: SHIP_POS, friend: MOON_POS, personal: SCROLL_POS, recruiter: BIRD_POS };
  landmarks.forEach(record => {
    if (record.id === 'friend' && moonState === 'falling') return;
    const position = positions[record.id];
    record.object.position.x = position.x;
    record.object.position.z = position.z;
    record.baseY = position.y;
    record.focus.copy(position);
  });
  if (scrollBoard) scrollBoard.position.set(SCROLL_POS.x + 5.8, SHIP_POS.y + 2.2, SCROLL_POS.z - 1.5);
}

export function canUseWebGL() {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2', { failIfMajorPerformanceCaveat: true }) ||
      canvas.getContext('webgl', { failIfMajorPerformanceCaveat: true });
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return Boolean(gl);
  } catch {
    return false;
  }
}

function usesSoftwareRenderer(gl) {
  try {
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String((debug && gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)) || gl.getParameter(gl.RENDERER) || '').toLowerCase();
    return /swiftshader|llvmpipe|software|microsoft basic|mesa offscreen/.test(name);
  } catch {
    return false;
  }
}

export function initWorld(options = {}) {
  opts = options;
  document.body.classList.add('graybox-active');
  buildInterface();
  setStatus('Loading Cloud…');
  const canvas = $('three-canvas');
  const stage = $('s-world');
  if (!canvas || !stage || !canUseWebGL()) {
    startFallback(new Error('WebGL unavailable'));
    return;
  }

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0d0a1d);
  scene.fog = new THREE.Fog(0x171329, 78, 138);
  camera = new THREE.PerspectiveCamera(innerWidth < 620 ? 68 : 58, innerWidth / Math.max(innerHeight, 1), 0.1, 190);
  camera.position.set(0, 5, 15);

  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    if (usesSoftwareRenderer(renderer.getContext())) {
      renderer.dispose();
      renderer.forceContextLoss();
      renderer = null;
      startFallback(new Error('Software WebGL renderer detected'));
      return;
    }
  } catch (error) {
    startFallback(error);
    return;
  }

  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.96;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  raycaster = new THREE.Raycaster();
  pointerNdc = new THREE.Vector2();

  applyLandmarkLayout();
  buildLighting();
  buildAtmosphere();
  buildPlatform();
  buildPlayer();
  guide = createCloudGuide($('world-ui'));
  buildTestObject();
  loadShipLandmark();
  loadMoonLandmark();
  loadScrollLandmark();
  loadBirdLandmark();
  bindEvents();
  updateCamera(0, true);
  ready = true;
  opts.onProgress?.(1);
  opts.onReady?.({ webgl: true, assets: [], graybox: true });
  resumeWorld();
}

function startFallback(error) {
  ready = true;
  $('s-world')?.classList.add('graybox-no-webgl');
  $('three-canvas')?.setAttribute('hidden', '');
  if ($('w-prompt-h')) $('w-prompt-h').textContent = 'Explore the cloud.';
  if ($('w-prompt-p')) $('w-prompt-p').textContent = 'This device cannot draw the 3D world, but every portfolio path remains available directly.';
  setStatus('3D movement needs WebGL.');
  opts.onWebGLUnavailable?.(error);
  opts.onProgress?.(1);
  requestAnimationFrame(() => opts.onReady?.({ webgl: false, assets: [], graybox: true }));
}

function buildInterface() {
  const eyebrow = document.querySelector('.world-eyebrow');
  if (eyebrow) eyebrow.textContent = 'Cloud';
  if ($('w-prompt-h')) $('w-prompt-h').textContent = 'Explore the cloud.';
  if ($('w-prompt-p')) $('w-prompt-p').textContent = 'Approach the ship, scroll, moon, or birds. Each opens a different path.';
  const ui = $('world-ui');
  if (!ui || $('graybox-controls')) return;
  const controls = document.createElement('div');
  controls.id = 'graybox-controls';
  controls.innerHTML = `
    <div class="graybox-help" aria-label="Movement instructions">
      <span><b>Move</b> W / S</span>
      <span><b>Steer</b> A / D</span>
      <span><b>Look</b> Grab + drag / wheel</span>
      <span><b>Jump / fly</b> Space ×2 or hold</span>
      <span><b>Drop faster</b> Shift</span>
      <span><b>Interact</b> E</span>
    </div>
    <div class="graybox-touch" aria-label="Touch controls">
      <div class="graybox-stick" aria-label="Drag to move and steer">
        <span class="graybox-stick-knob" aria-hidden="true"></span>
      </div>
      <div class="graybox-touch-actions">
        <button type="button" data-graybox-action="jump">Jump</button>
        <button type="button" data-graybox-action="fly">Fly</button>
        <button type="button" data-graybox-action="drop">Drop</button>
        <button type="button" data-graybox-action="interact">Use</button>
      </div>
    </div>
    <button id="graybox-interact" type="button"><span>Landmark nearby</span><strong>Press E or click to enter</strong></button>
    <div id="graybox-status" role="status" aria-live="polite"></div>
    <div id="cloud-utilities"><button id="graybox-character" type="button" aria-label="Switch character">Character · Mage</button><button id="cloud-privacy" type="button">Privacy</button></div>
    <div id="speed-unlock" role="status" aria-live="polite" hidden><i aria-hidden="true"></i><strong>Gale Step</strong><span>Double-tap W or ↑ to surge for 10 seconds.</span></div>
    <div id="speed-boost" aria-live="polite" hidden><span>Gale Step</span><b>10.0</b></div>`;
  ui.appendChild(controls);
  bindTouchControls(controls);
  $('graybox-character')?.addEventListener('click', toggleCharacter);
  $('cloud-privacy')?.addEventListener('click', () => $('privacy-settings')?.click());
}

function bindTouchControls(controls) {
  const stick = controls.querySelector('.graybox-stick');
  const knob = controls.querySelector('.graybox-stick-knob');
  let activePointer = null;
  const update = event => {
    const rect = stick.getBoundingClientRect();
    const radius = Math.max(rect.width * 0.34, 1);
    let x = (event.clientX - rect.left - rect.width / 2) / radius;
    let y = (event.clientY - rect.top - rect.height / 2) / radius;
    const length = Math.hypot(x, y);
    if (length > 1) { x /= length; y /= length; }
    joystick.turn = x;
    joystick.forward = -y;
    knob.style.transform = `translate(${x * radius}px,${y * radius}px)`;
  };
  const stop = event => {
    if (activePointer !== null && event?.pointerId !== undefined && event.pointerId !== activePointer) return;
    activePointer = null;
    joystick.forward = 0;
    joystick.turn = 0;
    knob.style.transform = 'translate(0,0)';
  };
  stick?.addEventListener('pointerdown', event => {
    event.preventDefault();
    event.stopPropagation();
    activePointer = event.pointerId;
    stick.setPointerCapture?.(event.pointerId);
    update(event);
  });
  stick?.addEventListener('pointermove', event => {
    if (event.pointerId !== activePointer) return;
    event.preventDefault();
    event.stopPropagation();
    update(event);
  });
  stick?.addEventListener('pointerup', stop);
  stick?.addEventListener('pointercancel', stop);
  stick?.addEventListener('lostpointercapture', stop);
  const jumpButton = controls.querySelector('[data-graybox-action="jump"]');
  jumpButton?.addEventListener('pointerdown', event => {
    event.preventDefault();
    beginSpaceInput();
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(type => {
    jumpButton?.addEventListener(type, endSpaceInput);
  });
  const flyButton = controls.querySelector('[data-graybox-action="fly"]');
  flyButton?.addEventListener('pointerdown', event => {
    event.preventDefault();
    touchFlightCruise = true;
    if (flightMode) {
      verticalVelocity = Math.max(verticalVelocity, 2.2);
      setStatus('Flight sustained — hold Rise to climb.');
    } else {
      beginFlight();
    }
  });
  const dropButton = controls.querySelector('[data-graybox-action="drop"]');
  dropButton?.addEventListener('pointerdown', event => {
    event.preventDefault();
    event.stopPropagation();
    dropButton.setPointerCapture?.(event.pointerId);
    touchDropHeld = true;
    touchFlightCruise = false;
    verticalVelocity = Math.min(verticalVelocity, -3.8);
    setStatus('Hold Drop to descend.');
  });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    dropButton?.addEventListener(name, () => { touchDropHeld = false; });
  }
  controls.querySelector('[data-graybox-action="interact"]')?.addEventListener('click', () => interact());
  $('graybox-interact')?.addEventListener('click', () => interact());
}

function buildLighting() {
  scene.add(new THREE.HemisphereLight(0xb9b3d1, 0x30263d, 1.32));
  scene.add(new THREE.AmbientLight(0x776b8a, 0.42));
  const sun = new THREE.DirectionalLight(0xffb69b, 1.72);
  sun.position.set(-22, 31, 18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -24, right: 24, top: 38, bottom: -38, near: 1, far: 80 });
  sun.shadow.bias = -0.001;
  scene.add(sun);

  const coolFill = new THREE.DirectionalLight(0x829ac8, 0.82);
  coolFill.position.set(18, 12, 24);
  scene.add(coolFill);
}

function buildAtmosphere() {
  /* The moon model is the light cue. A separate billboard or point light read
     as an unrelated glowing object, especially after the moon had fallen. */
  moonHalo = null;
}

function colorizeCloudFaces(geometry, palette, variation = .16) {
  let faceted = geometry.index ? geometry.toNonIndexed() : geometry;
  const positions = faceted.attributes.position;
  const colors = faceted.attributes.color;
  if (!colors) return faceted;
  for (let index = 0; index < positions.count; index += 3) {
    const seed = Math.sin(index * 12.9898 + positions.getX(index) * 4.13 + positions.getY(index) * 2.71);
    const faceVariation = 1 - variation * .5 + (seed * .5 + .5) * variation;
    for (let offset = 0; offset < 3; offset += 1) {
      const vertex = index + offset;
      colors.setXYZ(
        vertex,
        Math.min(1, colors.getX(vertex) * faceVariation),
        Math.min(1, colors.getY(vertex) * faceVariation),
        Math.min(1, colors.getZ(vertex) * faceVariation),
      );
    }
  }
  colors.needsUpdate = true;
  faceted.computeVertexNormals();
  return faceted;
}

function buildCloudEnvelope() {
  /* An icosahedral shell avoids the horizontal latitude bands of a UV sphere,
     so every direction reads as the same irregular low-poly cloud. */
  let shellGeometry = new THREE.IcosahedronGeometry(1, 4);
  const positions = shellGeometry.attributes.position;
  const colors = [];
  const floorTone = new THREE.Color(0x655c7b);
  const horizonTone = new THREE.Color(0x927c91);
  const upperTone = new THREE.Color(0x29233f);
  const crownTone = new THREE.Color(0x141126);

  for (let index = 0; index < positions.count; index += 1) {
    let x = positions.getX(index);
    let y = positions.getY(index);
    let z = positions.getZ(index);
    const angle = Math.atan2(z, x);
    const cloudNoise = Math.sin(x * 11.7 + z * 7.1) * .048
      + Math.sin(y * 18.3 - x * 6.2) * .036
      + Math.cos(z * 14.1 + y * 8.4) * .028;
    const shoulderNoise = Math.sin(angle * 7 + y * 5) * .052;
    const verticalWave = (1 - Math.abs(y)) * (Math.sin(angle * 5.0) * .055 + Math.sin(angle * 9.0 + y * 4) * .032);
    const radius = 1 + cloudNoise + shoulderNoise * (1 - Math.abs(y));
    x *= radius;
    z *= radius;
    y = y * (1 + cloudNoise * .45) + verticalWave;
    positions.setXYZ(index, x, y, z);

    const vertical = THREE.MathUtils.clamp((y + 1) * .5, 0, 1);
    const horizonBand = Math.exp(-Math.pow((y + .35 + Math.sin(angle * 6) * .04) / .27, 2));
    const base = vertical < .48
      ? floorTone.clone().lerp(horizonTone, vertical / .48)
      : upperTone.clone().lerp(crownTone, (vertical - .48) / .52);
    base.lerp(horizonTone, horizonBand * .62);
    colors.push(base.r, base.g, base.b);
  }
  shellGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  shellGeometry = colorizeCloudFaces(shellGeometry, null, .2);
  const shellMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    emissive: 0x171329,
    emissiveIntensity: .46,
    roughness: 1,
    metalness: 0,
    flatShading: true,
    side: THREE.BackSide,
  });
  const shell = new THREE.Mesh(shellGeometry, shellMaterial);
  shell.position.set(0, 17, -6);
  shell.scale.set(42, 30, 68);
  shell.receiveShadow = true;
  shell.name = 'Continuous enclosing cloud';
  scene.add(shell);
  scene.userData.cloudEnvelope = shell;
}

function buildPlatform() {
  buildCloudEnvelope();
  const width = PLATFORM.halfX * 2 + 8;
  const depth = PLATFORM.halfZ * 2 + 10;
  let islandGeometry = new THREE.PlaneGeometry(width, depth, 72, 112);
  const positions = islandGeometry.attributes.position;
  const colors = [];
  const low = new THREE.Color(0x625a79);
  const middle = new THREE.Color(0x81728e);
  const high = new THREE.Color(0xa08da3);
  for (let index = 0; index < positions.count; index += 1) {
    const x = positions.getX(index);
    const z = positions.getY(index);
    const ridge = Math.sin(x * .44 + z * .17) * .13
      + Math.cos(z * .31 - x * .19) * .095
      + Math.sin(x * 1.27 + z * .73) * .048
      + Math.cos(x * 2.31 - z * 1.86) * .018;
    const edge = THREE.MathUtils.smoothstep(Math.max(Math.abs(x) / (width / 2), Math.abs(z) / (depth / 2)), .78, 1);
    const cloudLift = edge * (1.05 + Math.sin(x * .22 + z * .16) * .28);
    positions.setZ(index, ridge + cloudLift);
    const shade = THREE.MathUtils.clamp(.46 + ridge * 1.45 + Math.sin(index * 2.17) * .08, .06, .96);
    const color = shade < .52
      ? low.clone().lerp(middle, shade / .52)
      : middle.clone().lerp(high, (shade - .52) / .48);
    colors.push(color.r, color.g, color.b);
  }
  islandGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  islandGeometry.rotateX(-Math.PI / 2);
  islandGeometry = colorizeCloudFaces(islandGeometry, null, .2);
  const surfaceTexture = createCloudSurfaceTexture();
  const bumpTexture = surfaceTexture.clone();
  bumpTexture.colorSpace = THREE.NoColorSpace;
  bumpTexture.needsUpdate = true;
  const cloudMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    map: surfaceTexture,
    bumpMap: bumpTexture,
    bumpScale: .22,
    emissive: 0x21192f,
    emissiveIntensity: 0.24,
    roughness: 1,
    flatShading: true,
  });
  platformVisual = new THREE.Mesh(islandGeometry, cloudMaterial);
  platformVisual.position.y = PLATFORM.top;
  platformVisual.receiveShadow = true;
  platformVisual.castShadow = true;
  platformVisual.name = 'Faceted cloud floor';
  scene.add(platformVisual);

}

function groundHeightAt(x, z, probeY = 100) {
  if (!cloudFloorVisual) return PLATFORM.top;
  // The imported clouds have inward-facing normals. Probe each whole shelf
  // from above and select its top, rather than treating an underside as land.
  groundProbeOrigin.set(x, 150, z);
  groundRaycaster.set(groundProbeOrigin, groundProbeDirection);
  groundRaycaster.near = 0;
  groundRaycaster.far = 250;
  cloudFloorVisual.updateWorldMatrix(true, false);
  const surfaces = [cloudFloorVisual];
  if (upperCloudVisual && probeY < 100) surfaces.push(upperCloudVisual);
  const hit = surfaces.map(surface => groundRaycaster.intersectObject(surface, true)[0])
    .filter(candidate => candidate && candidate.point.y <= probeY)
    .sort((a, b) => b.point.y - a.point.y)[0];
  /* A missing hit is a genuine break in the cloud. Keep a low rescue floor so
     the player falls into the pocket instead of gliding across empty space. */
  if (!hit) return PLATFORM.top - 8;
  return hit.point.y + .08;
}

// Sweep against the rendered cloud triangles, not oversized proxy boxes.
const cloudSweep = new THREE.Raycaster();
const sweepDirection = new THREE.Vector3();
const sweepOrigin = new THREE.Vector3();
function cloudClearance(start, end, padding = .3, objects = cloudSolids) {
  sweepDirection.subVectors(end, start);
  const distance = sweepDirection.length();
  if (!objects.length || distance < .0001) return 1;
  cloudSweep.set(start, sweepDirection.divideScalar(distance));
  cloudSweep.near = .015;
  cloudSweep.far = distance + padding;
  const hit = cloudSweep.intersectObjects(objects, true)[0];
  return hit ? THREE.MathUtils.clamp((hit.distance - padding) / distance, 0, 1) : 1;
}

function moveThroughClouds(x, z) {
  // Clouds are one-way landing surfaces, not stone ceilings or walls. During
  // flight, only the arena bounds and solid landmarks constrain movement.
  if (flightMode || !grounded) return { x, z };
  // Walking still respects steep terrain, with enough allowance for small
  // ridges. Never sweep the decorative overhead cloud against the character.
  const next = player.position.clone();
  for (const [axis, value] of [['x', x], ['z', z]]) {
    let fraction = 1;
    for (const height of [.85, 1.5]) {
      const start = next.clone(); start.y += height;
      const end = start.clone(); end[axis] = value;
      fraction = Math.min(fraction, cloudClearance(start, end, .18, cloudFloorVisual ? [cloudFloorVisual] : []));
    }
    next[axis] += (value - next[axis]) * fraction;
  }
  return next;
}

function createCloudSurfaceTexture() {
  const size = 384;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const context = canvas.getContext('2d');
  context.fillStyle = '#e8e2ea';
  context.fillRect(0, 0, size, size);
  let seed = 9301;
  const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  for (let index = 0; index < 150; index += 1) {
    const x = random() * size;
    const y = random() * size;
    const radius = 7 + random() * 42;
    const light = 188 + Math.round(random() * 54);
    const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, `rgba(${light},${light - 7},${light + 6},${.12 + random() * .2})`);
    gradient.addColorStop(1, 'rgba(220,215,225,0)');
    context.fillStyle = gradient;
    context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }
  // Fine, low-contrast grain gives close-up facets some softness. Generated
  // once and shared by all clouds; no extra model downloads or frame work.
  context.globalAlpha = .035;
  for (let index = 0; index < 9000; index += 1) {
    context.fillStyle = random() > .5 ? '#ffffff' : '#75687f';
    context.fillRect(random() * size, random() * size, 1, 1);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(4.5, 8);
  texture.anisotropy = Math.min(8, renderer?.capabilities?.getMaxAnisotropy?.() || 1);
  return texture;
}

function buildPlayer() {
  player = new THREE.Group();
  playerVisual = new THREE.Group();
  classicPlayerVisual = playerVisual;
  const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0xe1b95f, roughness: 0.72 });
  const darkMaterial = new THREE.MeshStandardMaterial({ color: 0x26323b, roughness: 0.88 });
  const skinMaterial = new THREE.MeshStandardMaterial({ color: 0xd7a57d, roughness: 0.9 });
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.27, 0.52, 4, 8), bodyMaterial);
  torso.position.y = 1.12;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 10), skinMaterial);
  head.position.y = 1.75;
  const makeLimb = (x, y, material) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, 0);
    const limb = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.42, 3, 6), material);
    limb.position.y = -0.24;
    pivot.add(limb);
    return pivot;
  };
  const leftLeg = makeLimb(-0.14, 0.8, darkMaterial);
  const rightLeg = makeLimb(0.14, 0.8, darkMaterial);
  const leftArm = makeLimb(-0.34, 1.4, bodyMaterial);
  const rightArm = makeLimb(0.34, 1.4, bodyMaterial);
  const hatBrim = new THREE.Mesh(new THREE.CylinderGeometry(0.43, 0.43, 0.055, 16), darkMaterial);
  hatBrim.position.y = 1.94;
  const hatCrown = new THREE.Mesh(new THREE.ConeGeometry(0.29, 0.58, 14), darkMaterial);
  hatCrown.position.y = 2.23;
  hatCrown.rotation.z = -0.08;
  const hatBand = new THREE.Mesh(new THREE.TorusGeometry(0.285, 0.026, 6, 18), bodyMaterial);
  hatBand.position.y = 2.01;
  hatBand.rotation.x = Math.PI / 2;

  const scarf = new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.055, 7, 18), bodyMaterial);
  scarf.position.y = 1.56;
  scarf.rotation.x = Math.PI / 2;
  playerVisual.userData.limbs = { leftLeg, rightLeg, leftArm, rightArm };
  playerVisual.add(
    torso, head, leftLeg, rightLeg, leftArm, rightArm,
    hatBrim, hatCrown, hatBand, scarf,
  );
  playerVisual.scale.setScalar(0.64);
  playerVisual.traverse(node => { if (node.isMesh) node.castShadow = true; });
  player.add(playerVisual);
  const shadowMaterial = new THREE.MeshBasicMaterial({ color: 0x100d19, transparent: true, opacity: .34, depthWrite: false });
  playerShadow = new THREE.Mesh(new THREE.CircleGeometry(.58, 24), shadowMaterial);
  playerShadow.rotation.x = -Math.PI / 2;
  playerShadow.renderOrder = 2;
  scene.add(playerShadow);
  player.position.copy(SPAWN);
  player.name = 'Graybox player';
  scene.add(player);
  loadRiggedPlayer();
}

function preferredCharacter() {
  try { return localStorage.getItem(CHARACTER_KEY) === 'classic' ? 'classic' : 'mage'; }
  catch { return 'mage'; }
}

function useCharacter(kind) {
  const useClassic = kind === 'classic' || !riggedPlayerVisual;
  if (classicPlayerVisual) classicPlayerVisual.visible = useClassic;
  if (riggedPlayerVisual) riggedPlayerVisual.visible = !useClassic;
  playerVisual = useClassic ? classicPlayerVisual : riggedPlayerVisual;
  if (!useClassic) setPlayerAction('Idle', true);
  const button = $('graybox-character');
  if (button) {
    button.textContent = useClassic ? 'Classic' : 'Mage';
    button.setAttribute('aria-label', `Character: ${useClassic ? 'Classic' : 'Mage'}. Activate to switch.`);
  }
  try { localStorage.setItem(CHARACTER_KEY, useClassic ? 'classic' : 'mage'); } catch { /* preference is optional */ }
}

function toggleCharacter() {
  useCharacter(playerVisual === classicPlayerVisual ? 'mage' : 'classic');
}

async function loadRiggedPlayer() {
  try {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const gltf = await loader.loadAsync('/static/assets/models/kaykit_mage.glb');
    const model = gltf.scene;
    const bounds = new THREE.Box3().setFromObject(model);
    const size = bounds.getSize(new THREE.Vector3());
    model.scale.setScalar(1.62 / Math.max(size.y, 1e-6));
    model.updateMatrixWorld(true);
    bounds.setFromObject(model);
    const center = bounds.getCenter(new THREE.Vector3());
    model.position.set(-center.x, -bounds.min.y, -center.z);
    model.traverse(node => {
      if (!node.isMesh) return;
      node.castShadow = true;
      node.receiveShadow = true;
    });
    riggedPlayerVisual = new THREE.Group();
    riggedPlayerVisual.add(model);
    riggedPlayerVisual.userData.rigged = true;
    riggedPlayerVisual.visible = false;
    player.add(riggedPlayerVisual);
    playerMixer = new THREE.AnimationMixer(model);
    gltf.animations.forEach(clip => playerActions.set(clip.name, playerMixer.clipAction(clip)));
    useCharacter(preferredCharacter());
  } catch (error) {
    console.warn('The optimized character could not load; keeping the classic wizard.', error);
    useCharacter('classic');
  }
}

function setPlayerAction(name, immediate = false) {
  if (!playerMixer || playerVisual !== riggedPlayerVisual || name === playerActionName) return;
  const next = playerActions.get(name) || playerActions.get('Idle');
  if (!next) return;
  const previous = playerActions.get(playerActionName);
  next.reset().fadeIn(immediate ? 0 : .16).play();
  previous?.fadeOut(immediate ? 0 : .16);
  playerActionName = next.getClip().name;
}

function buildTestObject() {
  testObject = new THREE.Group();
  const pedestal = new THREE.Mesh(
    new THREE.CylinderGeometry(0.72, 0.9, 0.38, 16),
    new THREE.MeshStandardMaterial({ color: 0x55616a, roughness: 0.8 }),
  );
  pedestal.position.y = 0.19;
  testCore = new THREE.Mesh(
    new THREE.BoxGeometry(1.15, 1.15, 1.15),
    new THREE.MeshStandardMaterial({ color: 0x6aa9c8, emissive: 0x102836, emissiveIntensity: 0.35, roughness: 0.48 }),
  );
  testCore.position.y = 1.25;
  testCore.castShadow = true;
  testCore.userData.testObject = true;
  testObject.add(pedestal, testCore);
  testObject.position.copy(OBJECT_POS);
  testObject.name = 'Test object';
  scene.add(testObject);
}

function fitModel(object, targetSize) {
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  object.scale.multiplyScalar(targetSize / Math.max(size.x, size.y, size.z, 1e-6));
  object.updateMatrixWorld(true);
  box.setFromObject(object);
  object.position.sub(box.getCenter(new THREE.Vector3()));
  return object;
}

function trimShipUnderslungStick(object) {
  object.traverse(node => {
    if (!node.isMesh || !node.geometry?.attributes?.position) return;
    const geometry = node.geometry.clone();
    const positions = geometry.attributes.position;
    geometry.computeBoundingBox();
    const bounds = geometry.boundingBox;
    const height = bounds.max.y - bounds.min.y;
    const depth = bounds.max.z - bounds.min.z;
    const centerZ = (bounds.min.z + bounds.max.z) * .5;
    const cutoff = bounds.min.y + height * .6;
    const narrowDepth = depth * .095;
    const source = geometry.index
      ? Array.from(geometry.index.array)
      : Array.from({ length: positions.count }, (_, index) => index);
    const kept = [];
    for (let index = 0; index < source.length; index += 3) {
      const a = source[index], b = source[index + 1], c = source[index + 2];
      const below = Math.max(positions.getY(a), positions.getY(b), positions.getY(c)) < cutoff;
      const narrow = Math.max(
        Math.abs(positions.getZ(a) - centerZ),
        Math.abs(positions.getZ(b) - centerZ),
        Math.abs(positions.getZ(c) - centerZ),
      ) < narrowDepth;
      if (!below || !narrow) kept.push(a, b, c);
    }
    if (kept.length < source.length && kept.length > source.length * .85) {
      geometry.setIndex(kept);
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      node.geometry = geometry;
    } else {
      geometry.dispose();
    }
  });
}

function prepareMaterials(object, minimumEmissive = 0.2) {
  const materials = [];
  object.traverse(node => {
    if (!node.isMesh) return;
    node.castShadow = true;
    node.receiveShadow = true;
    const originals = Array.isArray(node.material) ? node.material : [node.material];
    const copies = originals.filter(Boolean).map(material => {
      const copy = material.clone();
      copy.emissiveIntensity = Math.max(copy.emissiveIntensity || 0, minimumEmissive);
      copy.userData.landmarkBaseIntensity = copy.emissiveIntensity;
      copy.userData.landmarkBaseColor = copy.color?.clone();
      copy.userData.landmarkBaseEmissive = copy.emissive?.clone();
      materials.push(copy);
      return copy;
    });
    node.material = Array.isArray(node.material) ? copies : copies[0];
  });
  return materials;
}

function registerLandmark({
  id, object, focus, baseY, bob = 0.08, interactionRadius = 4.8,
  colliderRadius = 0, colliderMinY = -Infinity, colliderMaxY = Infinity,
  companionScale = 0.1, companionSource = object, mixers = [], birds = [], locked = false,
}) {
  const meta = LANDMARK_META[id];
  object.name = `${meta.title} · ${meta.label}`;
  object.traverse(node => {
    if (node.isMesh) node.userData.landmarkId = id;
  });
  const record = {
    id,
    ...meta,
    object,
    focus: focus.clone(),
    anchor: LANDMARK_ANCHORS[id],
    baseY,
    bob,
    interactionRadius,
    colliderRadius,
    colliderMinY,
    colliderMaxY,
    locked,
    baseScale: object.scale.clone(),
    materials: [],
    companionScale,
    companionSource,
    mixers,
    birds,
    visited: visitedPaths.has(id),
  };
  object.traverse(node => {
    if (!node.isMesh) return;
    const nodeMaterials = Array.isArray(node.material) ? node.material : [node.material];
    record.materials.push(...nodeMaterials.filter(Boolean));
  });
  record.materials = [...new Set(record.materials)];
  record.hoverGlow = new THREE.Color(record.color).multiplyScalar(0.2);
  landmarks.set(id, record);
  loadedLandmarks += 1;
  if (record.visited) addCompanion(record);
  updatePrototypeCopy();
  if (!nearLandmarkId) setStatus('Choose a landmark to explore.');
  return record;
}

function cloneForCompanion(source) {
  const miniature = cloneSkeleton(source);
  const lights = [];
  miniature.traverse(node => {
    if (node.isLight) lights.push(node);
    if (!node.isMesh || !node.material) return;
    const originals = Array.isArray(node.material) ? node.material : [node.material];
    const copies = originals.map(material => {
      const copy = material.clone();
      if (copy.color) copy.color.lerp(new THREE.Color(0xdbe6ff), 0.18);
      copy.emissiveIntensity = Math.max(copy.emissiveIntensity || 0, 0.45);
      return copy;
    });
    node.material = Array.isArray(node.material) ? copies : copies[0];
    node.castShadow = false;
    node.receiveShadow = false;
    delete node.userData.landmarkId;
  });
  lights.forEach(light => light.removeFromParent());
  miniature.position.set(0, 0, 0);
  miniature.rotation.set(0, 0, 0);
  return miniature;
}

function addCompanion(record) {
  if (!player || companions.some(item => item.id === record.id)) return;
  const object = cloneForCompanion(record.companionSource);
  fitModel(object, record.id === 'viewer' ? 1.8 : record.id === 'personal' ? 1.25 : 1.4);
  scene.add(object);
  companions.push({
    id: record.id,
    object,
    angle: companions.length * Math.PI * 0.65,
    radius: 2.3 + companions.length * 0.25,
    height: 1.7 + (companions.length % 2) * 0.35,
  });
}

function markVisited(record, withCompanion = true) {
  if (!record) return;
  if (!record.visited) {
    record.visited = true;
    visitedPaths.add(record.id);
    try { sessionStorage.setItem('cloud_landmarks_visited_v2', JSON.stringify([...visitedPaths])); } catch { /* session storage is optional */ }
    if (withCompanion) addCompanion(record);
  }
  $('s-world')?.setAttribute('data-visited-landmarks', [...visitedPaths].join(' '));
  updatePrototypeCopy();
  if (record.id !== 'friend' && MOON_REQUIREMENTS.every(id => visitedPaths.has(id))) moonFallPending = true;
}

function startMoonFall() {
  const record = landmarks.get('friend');
  if (!record || record.visited || moonState !== 'locked') {
    moonFallPending = !record && moonState === 'locked';
    return;
  }
  moonState = 'falling';
  moonFallPending = false;
  moonFallElapsed = 0;
  record.locked = true;
  focusedLandmarkId = 'friend';
  interactionFocus = reducedMotion.matches ? 0.8 : 4.9;
  landmarkFocus.copy(record.object.position);
  $('s-world')?.setAttribute('data-moon-state', moonState);
  setNearObject(null);
  setStatus('The moon is descending.');
}

function updateMoonFall(delta) {
  if (moonState !== 'falling') return;
  const record = landmarks.get('friend');
  if (!record) return;
  const duration = reducedMotion.matches ? 0.2 : 4.2;
  moonFallElapsed = Math.min(duration, moonFallElapsed + delta);
  const raw = moonFallElapsed / duration;
  const lateral = raw * raw * (3 - 2 * raw);
  const fall = raw * raw;
  record.object.position.x = THREE.MathUtils.lerp(MOON_FAR_POS.x, MOON_LAND_POS.x, lateral);
  record.object.position.z = THREE.MathUtils.lerp(MOON_FAR_POS.z, MOON_LAND_POS.z, lateral);
  record.object.position.y = THREE.MathUtils.lerp(MOON_FAR_POS.y, MOON_LAND_POS.y, fall);
  record.baseY = record.object.position.y;
  record.focus.copy(record.object.position);
  landmarkFocus.copy(record.object.position);
  if (raw < 1) return;

  moonState = 'landed';
  MOON_POS.copy(MOON_LAND_POS);
  record.object.position.copy(MOON_LAND_POS);
  record.baseY = MOON_LAND_POS.y;
  record.focus.copy(MOON_LAND_POS);
  record.locked = false;
  if (moonHalo) moonHalo.visible = false;
  /* Do not spawn the miniature during the landing shot: it read as a second
     moon. The companion is created when the player returns to the world. */
  markVisited(record, false);
  $('s-world')?.setAttribute('data-moon-state', moonState);
  setStatus('Moon found. Opening Story…');
  clearTimeout(pathTimer);
  pathTimer = setTimeout(() => opts.onPathChosen?.('friend'), reducedMotion.matches ? 80 : 520);
}

function clampToCloudIsland(x, z) {
  const halfX = PLATFORM.halfX - PLAYER_RADIUS;
  const halfZ = PLATFORM.halfZ - PLAYER_RADIUS;
  const cornerRadius = 6;
  let nextX = THREE.MathUtils.clamp(x, -halfX, halfX);
  let nextZ = THREE.MathUtils.clamp(z, -halfZ, halfZ);
  const innerX = halfX - cornerRadius;
  const innerZ = halfZ - cornerRadius;
  const cornerX = Math.max(Math.abs(nextX) - innerX, 0);
  const cornerZ = Math.max(Math.abs(nextZ) - innerZ, 0);
  const cornerDistance = Math.hypot(cornerX, cornerZ);
  if (cornerDistance > cornerRadius) {
    const ratio = cornerRadius / cornerDistance;
    nextX = Math.sign(nextX) * (innerX + cornerX * ratio);
    nextZ = Math.sign(nextZ) * (innerZ + cornerZ * ratio);
  }
  return { x: nextX, z: nextZ };
}

function resolveLandmarkCollisions(x, z, playerY) {
  let nextX = x;
  let nextZ = z;
  landmarks.forEach(record => {
    if (!record.colliderRadius || record.locked) return;
    const minY = record.object.position.y + record.colliderMinY;
    const maxY = record.object.position.y + record.colliderMaxY;
    if (playerY + 1.8 < minY || playerY > maxY) return;
    const dx = nextX - record.object.position.x;
    const dz = nextZ - record.object.position.z;
    const minimum = record.colliderRadius + PLAYER_RADIUS;
    const distance = Math.hypot(dx, dz);
    if (distance >= minimum) return;
    const fallbackX = player ? player.position.x - record.object.position.x : 1;
    const fallbackZ = player ? player.position.z - record.object.position.z : 0;
    const safeDistance = Math.hypot(fallbackX, fallbackZ) || 1;
    const unitX = distance > 0.001 ? dx / distance : fallbackX / safeDistance;
    const unitZ = distance > 0.001 ? dz / distance : fallbackZ / safeDistance;
    nextX = record.object.position.x + unitX * minimum;
    nextZ = record.object.position.z + unitZ * minimum;
  });
  return { x: nextX, z: nextZ };
}

function addShipCloudScenery(gltf) {
  const source = gltf.scene.getObjectByName('Cloud_Poly_Poly_0');
  if (!source) return;
  source.removeFromParent();
  fitModel(source, 20);
  const group = new THREE.Group();
  group.name = 'Single enlarged ship-cloud interior';
  const detail = createCloudSurfaceTexture();
  detail.repeat.set(3, 3);

  /* The source mesh is open decorative scenery, so it cannot be a watertight
     room or collision surface. It remains the recognizable cloud canopy while
     the procedural envelope seals every camera angle behind it. */
  const styleCloud = object => object.traverse(node => {
    if (!node.isMesh) return;
    const material = new THREE.MeshStandardMaterial({
      color: 0x82768f,
      emissive: 0x171326,
      emissiveIntensity: .24,
      map: node.geometry.attributes.uv ? detail : null,
      bumpMap: node.geometry.attributes.uv ? detail : null,
      bumpScale: .09,
      roughness: 1,
      metalness: 0,
      flatShading: true,
      side: THREE.DoubleSide,
      transparent: true,
    });
    node.material = material;
    node.castShadow = false;
    node.receiveShadow = true;
    node.userData.cloudScenery = true;
  });
  const cloud = cloneSkeleton(source);
  styleCloud(cloud);
  cloud.scale.multiply(new THREE.Vector3(
    innerWidth < 620 ? 5.25 : 6.3,
    innerWidth < 620 ? 2.9 : 3.45,
    innerWidth < 620 ? 5.8 : 7.0,
  ));
  cloud.rotation.set(Math.PI, -.08, 0);
  cloud.position.set(0, innerWidth < 620 ? 21 : 24, -16);
  // Keep the authored silhouette intact; ascent is no longer gated by a hole.
  group.add(cloud);
  upperCloudVisual = cloud;

  /* Use the very same cloud mesh and material language below the player.
     Its highest ridge sits just under the simple collision plane, giving the
     arena the asset's real silhouette without turning decorative triangles
     into unreliable level geometry. */
  const floorCloud = cloneSkeleton(source);
  styleCloud(floorCloud);
  floorCloud.scale.multiply(new THREE.Vector3(
    innerWidth < 620 ? 5.7 : 6.7,
    /* Preserve the source facets while flattening its relief enough for the
       invisible gameplay plane to stay visually attached to the player's feet. */
    innerWidth < 620 ? 2.0 : 2.35,
    innerWidth < 620 ? 6.5 : 7.5,
  ));
  floorCloud.rotation.set(0, -.08, 0);
  floorCloud.position.set(0, 0, -8);
  group.add(floorCloud);
  group.updateMatrixWorld(true);
  const spawnProbe = new THREE.Raycaster(
    new THREE.Vector3(SPAWN.x, 36, SPAWN.z),
    groundProbeDirection,
    0,
    80,
  ).intersectObject(floorCloud, true)[0];
  const floorBounds = new THREE.Box3().setFromObject(floorCloud);
  floorCloud.position.y += PLATFORM.top - .08 - (spawnProbe?.point.y ?? floorBounds.max.y);
  floorCloud.name = 'Ship cloud · walkable visual floor';
  cloudFloorVisual = floorCloud;

  /* Close the horizon with clones of the same authored cloud, rather than a
     differently coloured procedural wall. Geometry buffers remain shared, so
     this adds a handful of draw calls without multiplying download memory. */
  const wallSpecs = [
    { name: 'left', position: [-42, 11, -8], scale: [1.8, 4.0, 6.0] },
    { name: 'right', position: [42, 11, -8], scale: [1.8, 4.0, 6.0] },
    { name: 'far', position: [0, 11, -60], scale: [5.0, 4.0, 1.8] },
    { name: 'near', position: [0, 11, 58], scale: [5.0, 4.0, 1.8] },
  ];
  wallSpecs.forEach(spec => {
    const wall = cloneSkeleton(source);
    styleCloud(wall);
    wall.scale.multiply(new THREE.Vector3(...spec.scale));
    wall.position.set(...spec.position);
    // fitModel preserves the authored mesh's offset. Place its inner face
    // outside the playable area, rather than assuming its origin is centered.
    wall.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(wall);
    if (spec.name === 'left') wall.position.x += -28 - bounds.max.x;
    if (spec.name === 'right') wall.position.x += 28 - bounds.min.x;
    if (spec.name === 'far') wall.position.z += -53 - bounds.max.z;
    if (spec.name === 'near') wall.position.z += 51 - bounds.min.z;
    wall.name = `Ship cloud · ${spec.name} wall`;
    group.add(wall);
  });

  scene.add(group);
  scene.userData.cloudInterior = group;
  group.updateMatrixWorld(true);
  cloudSolids.length = 0;
  group.traverse(node => { if (node.isMesh) cloudSolids.push(node); });
  const shelf = new THREE.Raycaster(new THREE.Vector3(SPAWN.x, 150, SPAWN.z), groundProbeDirection, 0, 250).intersectObject(cloud, true)[0];
  const upperBounds = new THREE.Box3().setFromObject(cloud);
  scrollShelfHeight = (shelf?.point.y ?? upperBounds.max.y) + 2.2;
  maxFlightHeight = TOP_CEILING_Y - 1.9;
  const envelope = scene.userData.cloudEnvelope;
  if (envelope) cloudSolids.push(envelope);
  applyLandmarkLayout();
  /* Height probes use this same mesh, so its genuine gaps become fallable
     cloud pockets instead of being bridged by a hidden rectangular plane. */
  if (platformVisual) platformVisual.visible = false;
  createScrollBoard();
}

function createScrollBoard() {
  scene.remove(scrollBoard);
  scrollBoard = new THREE.Group();
  scrollBoard.name = 'Scroll notice board';
  const canvas = document.createElement('canvas');
  canvas.width = 768; canvas.height = 448;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const faceGeometry = new THREE.PlaneGeometry(4.8, 2.8);
  const faceMaterial = new THREE.MeshBasicMaterial({ map: texture, side: THREE.FrontSide });
  const front = new THREE.Mesh(faceGeometry, faceMaterial);
  front.position.z = .09;
  const back = new THREE.Mesh(faceGeometry, faceMaterial.clone());
  back.position.z = -.09; back.rotation.y = Math.PI;
  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(5.04, 3.04, .18),
    new THREE.MeshStandardMaterial({ color: 0x5a4030, roughness: .94 }),
  );
  scrollBoard.add(frame, front, back);
  scrollBoard.position.set(SCROLL_POS.x + 5.8, SHIP_POS.y + 2.2, SCROLL_POS.z - 1.5);
  scrollBoard.rotation.y = -.35;
  scene.add(scrollBoard);

  const draw = items => {
    const context = canvas.getContext('2d');
    context.fillStyle = '#e6d4aa'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#4d392a'; context.font = '600 30px serif';
    context.fillText('NOTES BY THE SCROLL', 42, 58);
    context.fillStyle = '#80674b'; context.fillRect(42, 79, 684, 3);
    const rows = items.length ? items : [{ title: 'More notes will appear here.' }];
    rows.slice(0, 3).forEach((item, index) => {
      context.fillStyle = '#4d392a'; context.font = '25px serif';
      const title = String(item.title || item).slice(0, 78);
      context.fillText(title, 48, 132 + index * 96, 650);
      context.fillStyle = '#765f48'; context.font = '16px sans-serif';
      context.fillText(String(item.category || item.excerpt || '').slice(0, 78), 48, 164 + index * 96, 650);
    });
    texture.needsUpdate = true;
  };
  draw([]);
  const refresh = async () => {
    try {
      const response = await fetch('/api/v1/posts?sort=new', { credentials: 'omit', cache: 'no-store' });
      const payload = response.ok ? await response.json() : { items: [] };
      const posts = Array.isArray(payload) ? payload : payload.items;
      const recent = Array.isArray(posts)
        ? [...posts].sort((a, b) => {
          const aTime = Date.parse(a.published_at || a.created_at || 0) || Number(a.id) || 0;
          const bTime = Date.parse(b.published_at || b.created_at || 0) || Number(b.id) || 0;
          return bTime - aTime;
        }).slice(0, 3)
        : [];
      draw(recent);
    } catch { /* Keep the quiet offline board. */ }
  };
  scrollBoard.userData.refresh = refresh;
  refresh();
}

async function loadShipLandmark() {
  try {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const gltf = await loader.loadAsync('/static/assets/models/ship_in_clouds.glb');
    const ship = gltf.scene.getObjectByName('Boot_Finaal_1_Boot_Finaal_0');
    if (!ship) throw new Error('Ship node was not found in the cloud asset.');
    ship.removeFromParent();
    addShipCloudScenery(gltf);
    fitModel(ship, 34);
    trimShipUnderslungStick(ship);
    prepareMaterials(ship, 0.82);

    scene.remove(testObject);
    const holder = new THREE.Group();
    holder.add(ship);
    holder.position.copy(SHIP_POS);
    holder.rotation.y = 0.34;
    scene.add(holder);
    testObject = holder;
    testCore = holder;
    registerLandmark({
      id: 'viewer',
      object: holder,
      focus: SHIP_POS,
      baseY: SHIP_POS.y,
      bob: 0.08,
      interactionRadius: 8.4,
      colliderRadius: 1.35,
      colliderMinY: -8,
      colliderMaxY: 18,
      companionScale: 0.04,
    });

    const lamp = new THREE.PointLight(0xffd1a8, 18, 20, 2);
    lamp.position.set(1, 2.5, 3);
    holder.add(lamp);

    setStatus('Choose a landmark to explore.');
  } catch (error) {
    console.warn('Keeping the test cube because the ship could not load:', error);
  }
}

async function loadMoonLandmark() {
  try {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const gltf = await loader.loadAsync('/static/assets/models/moon.glb');
    const moon = fitModel(gltf.scene, 10.5);
    const moonMaterials = prepareMaterials(moon, 0.82);
    moonMaterials.forEach(material => {
      material.emissive?.set(0x34496f);
      material.userData.landmarkBaseEmissive = material.emissive?.clone();
    });

    const moonObject = new THREE.Group();
    moonObject.add(moon);
    moonObject.position.copy(MOON_POS);
    moonObject.rotation.y = -0.28;
    scene.add(moonObject);
    registerLandmark({
      id: 'friend',
      object: moonObject,
      focus: MOON_POS,
      baseY: MOON_POS.y,
      bob: 0.12,
      interactionRadius: 7.2,
      colliderRadius: 6.7,
      colliderMinY: -7,
      colliderMaxY: 7,
      companionScale: 0.075,
      locked: moonState !== 'landed',
    });
    $('s-world')?.setAttribute('data-moon-state', moonState);
    if (moonState === 'locked' && MOON_REQUIREMENTS.every(id => visitedPaths.has(id))) startMoonFall();
  } catch (error) {
    console.warn('Moon landmark could not load:', error);
  }
}

async function loadScrollLandmark() {
  try {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const gltf = await loader.loadAsync('/static/assets/models/old__ancient_scroll.glb');
    const scroll = fitModel(gltf.scene, 1.45);
    prepareMaterials(scroll, 0.38);
    const holder = new THREE.Group();
    holder.add(scroll);
    holder.position.copy(SCROLL_POS);
    holder.rotation.set(0.08, -0.58, 0.12);
    scene.add(holder);
    const light = new THREE.PointLight(0x79dfbe, 9, 20, 2);
    light.position.set(0, 1.5, 2);
    holder.add(light);
    registerLandmark({
      id: 'personal',
      object: holder,
      focus: SCROLL_POS,
      baseY: SCROLL_POS.y,
      bob: 0.1,
      interactionRadius: 5.8,
      colliderRadius: 1.55,
      colliderMinY: -3.6,
      colliderMaxY: 4.5,
      companionScale: 0.1,
    });
  } catch (error) {
    console.warn('Scroll landmark could not load:', error);
  }
}

async function loadBirdLandmark() {
  try {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const gltf = await loader.loadAsync('/static/assets/models/bird.glb');
    const prototype = fitModel(gltf.scene, 2.9);
    const birdMaterials = prepareMaterials(prototype, 0.72);
    birdMaterials.forEach(material => {
      material.emissive?.set(0x806327);
      material.userData.landmarkBaseEmissive = material.emissive?.clone();
    });
    const flock = new THREE.Group();
    const mixers = [];
    const birds = [];
    const birdCount = innerWidth < 620 ? 4 : 5;
    for (let index = 0; index < birdCount; index += 1) {
      const bird = cloneSkeleton(prototype);
      const holder = new THREE.Group();
      holder.add(bird);
      flock.add(holder);
      const mixer = new THREE.AnimationMixer(bird);
      if (gltf.animations?.length) {
        const action = mixer.clipAction(gltf.animations[0]);
        action.time = index * 0.17;
        action.timeScale = 0.9 + index * 0.04;
        action.play();
      }
      mixers.push(mixer);
      birds.push({
        object: holder,
        angle: index / birdCount * Math.PI * 2,
        radius: 2.6 + (index % 3) * 0.55,
        height: (index % 2) * 0.8 - 0.3,
        speed: 0.22 + index * 0.018,
      });
    }
    flock.position.copy(BIRD_POS);
    scene.add(flock);
    const light = new THREE.PointLight(0xffd36b, 9, 22, 2);
    flock.add(light);
    registerLandmark({
      id: 'recruiter',
      object: flock,
      focus: BIRD_POS,
      baseY: BIRD_POS.y,
      bob: 0,
      colliderRadius: 2.8,
      colliderMinY: -2.5,
      colliderMaxY: 2.5,
      companionScale: 0.21,
      companionSource: prototype,
      mixers,
      birds,
      locked: birdChaseStep < 3,
    });
  } catch (error) {
    console.warn('Bird landmark could not load:', error);
  }
}

function updatePrototypeCopy() {
  const eyebrow = document.querySelector('.world-eyebrow');
  if (eyebrow) eyebrow.textContent = 'Cloud';
  if ($('w-prompt-h')) $('w-prompt-h').textContent = 'Explore the cloud.';
  if ($('w-prompt-p')) {
    const collected = MOON_REQUIREMENTS.filter(id => visitedPaths.has(id)).length;
    $('w-prompt-p').textContent = loadedLandmarks < 4
      ? 'Loading models…'
      : moonState === 'locked'
        ? `Find the ship, scroll, and birds. ${collected} of 3 found. The moon is out of reach.`
        : 'The ship, scroll, birds, and moon each open a path.';
  }
}

function bindEvents() {
  const stage = $('s-world');
  if (!stage || stage.dataset.grayboxBound) return;
  stage.dataset.grayboxBound = 'true';
  window.addEventListener('keydown', event => {
    if (stage.classList.contains('out') || event.target.matches?.('input,textarea,select')) return;
    const key = normalizedKey(event);
    if (key === ' ' || key === 'spacebar') {
      event.preventDefault();
      if (!event.repeat) beginSpaceInput();
      return;
    }
    if (key === 'e') {
      event.preventDefault();
      interact();
      return;
    }
    if (!event.repeat && (key === 'w' || key === 'arrowup')) {
      const now = performance.now();
      if (speedUnlocked && now - lastForwardTap <= SPEED_TAP_WINDOW) triggerSpeedBoost();
      lastForwardTap = now;
    }
    if (!['w', 's', 'a', 'd', 'shift', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) return;
    event.preventDefault();
    keys.add(key);
  });
  window.addEventListener('keyup', event => {
    const key = normalizedKey(event);
    if (key === ' ' || key === 'spacebar') endSpaceInput();
    keys.delete(key);
  });
  window.addEventListener('blur', clearInput);
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(onResize, 80);
  }, { passive: true });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pauseWorld();
    else if (!stage.classList.contains('out')) resumeWorld();
  });

  const canvas = $('three-canvas');
  canvas?.addEventListener('pointerdown', event => {
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, lastX: event.clientX, lastY: event.clientY, moved: false };
    canvas.setPointerCapture?.(event.pointerId);
  });
  canvas?.addEventListener('pointermove', event => {
    if (drag?.id === event.pointerId) {
      const dx = event.clientX - drag.lastX;
      const dy = event.clientY - drag.lastY;
      if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 6) drag.moved = true;
      if (drag.moved) {
        cameraYaw -= dx * 0.006;
        cameraPitch = THREE.MathUtils.clamp(cameraPitch + dy * 0.0058, -0.08, 0.74);
      }
      drag.lastX = event.clientX;
      drag.lastY = event.clientY;
    }
    updateObjectHover(event.clientX, event.clientY);
  });
  canvas?.addEventListener('pointerup', event => {
    if (drag?.id === event.pointerId && !drag.moved) {
      const id = landmarkAt(event.clientX, event.clientY);
      if (id) interact(id);
    }
    drag = null;
  });
  canvas?.addEventListener('pointercancel', () => { drag = null; });
  canvas?.addEventListener('pointerleave', () => setObjectHovered(null));
  canvas?.addEventListener('wheel', event => {
    if (coarsePointer.matches) return;
    event.preventDefault();
    cameraPitch = THREE.MathUtils.clamp(cameraPitch + event.deltaY * 0.00075, -0.08, 0.74);
  }, { passive: false });
}

function normalizedKey(event) {
  const code = String(event.code || '');
  if (code === 'ShiftLeft' || code === 'ShiftRight') return 'shift';
  if (code === 'Space') return ' ';
  if (/^Key[WASDE]$/.test(code)) return code.slice(3).toLowerCase();
  if (/^Arrow(Up|Down|Left|Right)$/.test(code)) return code.toLowerCase();
  return String(event.key || '').toLowerCase();
}

function triggerSpeedBoost() {
  speedBoostRemaining = SPEED_BOOST_DURATION;
  setStatus('Gale Step active — movement doubled for 10 seconds.');
  const stage = $('s-world');
  stage?.classList.remove('speed-surging');
  void stage?.offsetWidth;
  stage?.classList.add('speed-surging');
  setTimeout(() => stage?.classList.remove('speed-surging'), 650);
}

function unlockSpeed() {
  if (speedUnlocked) return;
  speedUnlocked = true;
  try { sessionStorage.setItem(SPEED_UNLOCK_KEY, 'true'); } catch { /* session storage is optional */ }
  const notice = $('speed-unlock');
  if (!notice) return;
  notice.querySelector('span').textContent = coarsePointer.matches
    ? 'Hold forward for 2 seconds to surge. Lasts 10 seconds.'
    : 'Double-tap W or ↑ to surge for 10 seconds.';
  notice.hidden = false;
  requestAnimationFrame(() => notice.classList.add('show'));
  setTimeout(() => {
    notice.classList.remove('show');
    setTimeout(() => { notice.hidden = true; }, 500);
  }, reducedMotion.matches ? 1800 : 4200);
}

function clearInput() {
  touchDropHeld = false;
  keys.clear();
  joystick.forward = 0;
  joystick.turn = 0;
  endSpaceInput();
}

function queueJump() {
  jumpQueued = true;
}

function beginSpaceInput() {
  spaceHeld = true;
  spaceHeldFor = 0;
  if (flightMode) {
    setStatus(coarsePointer.matches ? 'Flying — release Rise to drift down.' : 'Flying — release Space to drift down.');
    return;
  }
  const now = performance.now();
  if (now - lastSpaceTap <= DOUBLE_SPACE_WINDOW) {
    lastSpaceTap = -Infinity;
    beginFlight();
    return;
  }
  lastSpaceTap = now;
  queueJump();
}

function endSpaceInput() {
  spaceHeld = false;
  spaceHeldFor = 0;
}

function beginFlight() {
  if (flightMode || !player) return;
  flightMode = true;
  grounded = false;
  jumpQueued = false;
  verticalVelocity = Math.max(verticalVelocity, 3);
  updateFlightControls();
  setStatus(coarsePointer.matches ? 'Flying — hold Rise; release to drift down.' : 'Flying — Space rises, Shift drops faster.');
}

function finishLanding() {
  flightMode = false;
  touchFlightCruise = false;
  grounded = true;
  verticalVelocity = 0;
  if (player) player.position.y = groundHeightAt(player.position.x, player.position.z, player.position.y + .45);
  updateFlightControls();
  const nearby = landmarks.get(nearLandmarkId);
  setStatus(nearby ? `${nearby.label} in range. Press E.` : 'Choose a landmark to explore.');
}

function updateFlightControls() {
  const jumpButton = document.querySelector('[data-graybox-action="jump"]');
  const flyButton = document.querySelector('[data-graybox-action="fly"]');
  if (jumpButton) jumpButton.textContent = flightMode ? 'Rise' : 'Jump';
  if (flyButton) flyButton.textContent = 'Fly';
  $('s-world')?.classList.toggle('graybox-flying', flightMode);
}

function axis(positive, negative) {
  return Number(positive.some(key => keys.has(key))) - Number(negative.some(key => keys.has(key)));
}

function updateBirdChase(delta) {
  const record = landmarks.get('recruiter');
  if (!record || record.visited) return;
  birdTeleportCooldown = Math.max(0, birdTeleportCooldown - delta);
  if (birdChaseStep >= 3) {
    record.locked = false;
    return;
  }
  const distance = Math.hypot(
    player.position.x - record.object.position.x,
    player.position.z - record.object.position.z,
  );
  if (distance > 9.5 || birdTeleportCooldown > 0) return;

  birdChaseStep += 1;
  birdTeleportCooldown = 1.1;
  BIRD_POS.copy(BIRD_CHASE_POINTS[birdChaseStep]);
  record.object.position.copy(BIRD_POS);
  record.baseY = BIRD_POS.y;
  record.focus.copy(BIRD_POS);
  record.anchor.set(BIRD_POS.x, PLATFORM.top, BIRD_POS.z);
  record.teleportPulse = 1;
  record.locked = birdChaseStep < 3;
  try { sessionStorage.setItem('cloud_bird_chase_v1', String(birdChaseStep)); } catch { /* session storage is optional */ }
  const stage = $('s-world');
  if (stage) stage.dataset.birdChaseStep = String(birdChaseStep);
  setNearObject(null);
  setStatus(birdChaseStep < 3
    ? `The flock slips into another pocket of cloud. ${birdChaseStep} of 3 escapes.`
    : 'The flock settles beyond the ship. Approach once more to enter Work.');
}

function updateMovement(delta) {
  if (!player || interactionFocus > 0) return;
  speedBoostRemaining = Math.max(0, speedBoostRemaining - delta);
  const boost = speedBoostRemaining > 0 ? 2 : 1;
  const boostUi = $('speed-boost');
  if (boostUi) {
    boostUi.hidden = speedBoostRemaining <= 0;
    const value = boostUi.querySelector('b');
    if (value) value.textContent = speedBoostRemaining.toFixed(1);
  }
  const moveAxis = THREE.MathUtils.clamp(axis(['w', 'arrowup'], ['s', 'arrowdown']) + joystick.forward, -1, 1);
  if (coarsePointer.matches && speedUnlocked && joystick.forward > .8) {
    forwardHeldFor += delta;
    if (forwardHeldFor >= 2 && !forwardSurgeLatched && speedBoostRemaining <= 0) {
      triggerSpeedBoost();
      forwardSurgeLatched = true;
    }
  } else {
    forwardHeldFor = 0;
    forwardSurgeLatched = false;
  }
  const turnAxis = THREE.MathUtils.clamp(axis(['d', 'arrowright'], ['a', 'arrowleft']) + joystick.turn, -1, 1);
  cameraYaw -= turnAxis * delta * 2.15;
  forward.set(-Math.sin(cameraYaw), 0, -Math.cos(cameraYaw));
  desiredVelocity.copy(forward).multiplyScalar(moveAxis * (moveAxis >= 0 ? 6.2 : 4) * boost);
  velocity.lerp(desiredVelocity, Math.min(1, delta * 9));

  const bounded = clampToCloudIsland(player.position.x + velocity.x * delta, player.position.z + velocity.z * delta);
  const cloudMove = moveThroughClouds(bounded.x, bounded.z);
  const resolved = resolveLandmarkCollisions(cloudMove.x, cloudMove.z, player.position.y);
  player.position.x = resolved.x;
  player.position.z = resolved.z;
  const groundHeight = groundHeightAt(player.position.x, player.position.z, player.position.y + .45);

  if (!flightMode && spaceHeld && !grounded) {
    spaceHeldFor += delta;
    if (spaceHeldFor >= HOLD_TO_FLY_DELAY) beginFlight();
  }

  if (flightMode) {
    const descendingFast = keys.has('shift') || touchDropHeld;
    const touchLayout = coarsePointer.matches || innerWidth < 760;
    const verticalTarget = descendingFast ? -9 : (spaceHeld ? 3.5 : (touchLayout && touchFlightCruise ? 0 : -0.72));
    const response = descendingFast ? 9 : 4.8;
    verticalVelocity = THREE.MathUtils.lerp(verticalVelocity, verticalTarget, Math.min(1, delta * response));
    player.position.y = Math.min(maxFlightHeight, player.position.y + verticalVelocity * delta);
    if (verticalVelocity <= 0 && player.position.y <= groundHeight) finishLanding();
  } else {
    if (jumpQueued && grounded) {
      verticalVelocity = 5.35;
      grounded = false;
    }
    jumpQueued = false;
    verticalVelocity -= 12.5 * delta;
    player.position.y += verticalVelocity * delta;
    if (verticalVelocity <= 0 && player.position.y <= groundHeight) {
      player.position.y = groundHeight;
      verticalVelocity = 0;
      grounded = true;
    }
  }

  updateBirdChase(delta);

  const isMoving = Math.abs(moveAxis) > 0.05;
  playerVisual.rotation.y = cameraYaw + Math.PI;
  const limbs = playerVisual.userData.limbs;
  if (limbs) {
    const stride = isMoving && grounded && !reducedMotion.matches ? Math.sin(elapsed * 9 * boost) * 0.42 : 0;
    limbs.leftLeg.rotation.x = stride;
    limbs.rightLeg.rotation.x = -stride;
    limbs.leftArm.rotation.x = -stride * 0.72;
    limbs.rightArm.rotation.x = stride * 0.72;
    if (flightMode) {
      limbs.leftArm.rotation.z = -1.15;
      limbs.rightArm.rotation.z = 1.15;
    } else {
      limbs.leftArm.rotation.z = 0;
      limbs.rightArm.rotation.z = 0;
    }
  } else {
    setPlayerAction(flightMode || !grounded ? 'Jump_Idle' : (isMoving ? (boost > 1 ? 'Running_A' : 'Walking_A') : 'Idle'));
  }
  if (reducedMotion.matches || !grounded) {
    playerVisual.position.y = 0;
    playerVisual.rotation.z = 0;
  } else if (isMoving) {
    playerVisual.position.y = Math.abs(Math.sin(elapsed * 9)) * 0.012;
    playerVisual.rotation.z *= 0.82;
  } else {
    playerVisual.position.y = 0.018 + Math.sin(elapsed * 1.9) * 0.018;
    playerVisual.rotation.z = Math.sin(elapsed * 1.05 + 0.7) * 0.018;
  }

  if (playerShadow) {
    const floor = groundHeightAt(player.position.x, player.position.z, player.position.y + .45);
    const height = Math.max(0, player.position.y - floor);
    playerShadow.position.set(player.position.x, floor + .035, player.position.z);
    const scale = THREE.MathUtils.clamp(1 - height * .025, .58, 1);
    playerShadow.scale.setScalar(scale);
    playerShadow.material.opacity = THREE.MathUtils.clamp(.36 - height * .012, .1, .36);
  }

  let closestId = null;
  let closestDistance = Infinity;
  landmarks.forEach(record => {
    if (record.locked) return;
    // Altitude matters for flying landmarks. Without it, the overhead scroll
    // was considered "in range" while the player was still on the ground.
    const verticalDistance = (player.position.y - record.object.position.y) * .68;
    const distance = Math.hypot(
      player.position.x - record.anchor.x,
      player.position.z - record.anchor.z,
      verticalDistance,
    );
    if (distance < record.interactionRadius && distance < closestDistance) {
      closestId = record.id;
      closestDistance = distance;
    }
  });
  setNearObject(closestId);
  const stage = $('s-world');
  stage.dataset.playerX = player.position.x.toFixed(2);
  stage.dataset.playerY = player.position.y.toFixed(2);
  stage.dataset.playerZ = player.position.z.toFixed(2);
}

function setNearObject(id) {
  if (id === nearLandmarkId) return;
  nearLandmarkId = id;
  const record = landmarks.get(id);
  const prompt = $('graybox-interact');
  prompt?.classList.toggle('show', Boolean(record) && id !== 'personal');
  if (record && prompt) {
    prompt.querySelector('span').textContent = `${record.title} · ${record.label}${record.visited ? ' · visited' : ''}`;
    prompt.querySelector('strong').textContent = 'Press E or click to enter';
  }
  setStatus(record ? (coarsePointer.matches ? `Tap the ${record.label} or Use to enter.` : `${record.label} in range. Press E or click it.`) : '');
}

function landmarkDistance(record) {
  record.object.updateWorldMatrix(true, true);
  return new THREE.Box3().setFromObject(record.object).distanceToPoint(player.position.clone().add(new THREE.Vector3(0, 1, 0)));
}

function interact(requestedId = nearLandmarkId) {
  if (interactionFocus > 0) return;
  const record = landmarks.get(requestedId);
  if (record?.locked) {
    setStatus(record.id === 'recruiter'
      ? 'The flock is still moving. Follow it through the cloud.'
      : 'Find the ship, scroll, and birds before entering the moon.');
    return;
  }
  if (!record || landmarkDistance(record) > record.interactionRadius) {
    setStatus(record ? `Move closer to the ${record.label} before entering.` : 'Move closer to a landmark before entering.');
    return;
  }
  interactionFocus = FOCUS_DURATION;
  focusedLandmarkId = record.id;
  landmarkFocus.copy(record.focus);
  markVisited(record);
  setStatus(`${record.title} opened. A miniature ${record.label} now follows you.`);
  $('graybox-interact')?.classList.remove('show');
  clearTimeout(pathTimer);
  pathTimer = setTimeout(() => opts.onPathChosen?.(record.id), reducedMotion.matches ? 0 : 720);
}

function setStatus(message) {
  const status = $('graybox-status');
  if (status) status.textContent = message;
}

function landmarkAt(clientX, clientY) {
  if (!raycaster || !camera || !landmarks.size) return null;
  const rect = $('three-canvas').getBoundingClientRect();
  pointerNdc.set(
    ((clientX - rect.left) / Math.max(rect.width, 1)) * 2 - 1,
    -((clientY - rect.top) / Math.max(rect.height, 1)) * 2 + 1,
  );
  raycaster.setFromCamera(pointerNdc, camera);
  const hit = raycaster.intersectObjects([...landmarks.values()].map(record => record.object), true)[0];
  return hit?.object?.userData?.landmarkId || null;
}

function updateObjectHover(x, y) {
  if (!drag?.moved) setObjectHovered(landmarkAt(x, y));
}

function setObjectHovered(id) {
  hoveredLandmarkId = id;
  $('three-canvas')?.classList.toggle('graybox-object-hovered', Boolean(id));
}

function updateCloudPassageOpacity(delta) {
  cameraSoftClouds.clear();
  if (!upperCloudVisual || !player) return;
  // Preserve visibility when rising through the middle shelf. The enclosing
  // cloud remains opaque and solid as the world's upper boundary.
  groundProbeOrigin.set(player.position.x, 150, player.position.z);
  groundRaycaster.set(groundProbeOrigin, groundProbeDirection);
  groundRaycaster.near = 0;
  groundRaycaster.far = 250;
  const crossings = groundRaycaster.intersectObject(upperCloudVisual, true);
  const top = crossings[0]?.point.y;
  const bottom = crossings[crossings.length - 1]?.point.y;
  const withinShelf = crossings.length > 1 && player.position.y + 2 > bottom && player.position.y < top + .5;
  upperCloudVisual.traverse(node => {
    if (!node.isMesh) return;
    const target = withinShelf ? .12 : 1;
    node.material.opacity = THREE.MathUtils.lerp(node.material.opacity, target, Math.min(1, delta * 9));
    node.material.depthWrite = node.material.opacity > .98;
    if (withinShelf || node.material.opacity < .7) cameraSoftClouds.add(node);
  });
}

function updateCamera(delta, snap = false) {
  if (!player || !camera) return;
    const distance = innerWidth < 620 ? 7.4 : 9.2;
  const horizontal = Math.cos(cameraPitch) * distance;
  cameraDesired.set(
    player.position.x + Math.sin(cameraYaw) * horizontal,
    player.position.y + 1.25 + Math.sin(cameraPitch) * distance,
    player.position.z + Math.cos(cameraYaw) * horizontal,
  );
  cameraLook.copy(player.position).addScaledVector(forward.set(-Math.sin(cameraYaw), 0, -Math.cos(cameraYaw)), 3.6);
  cameraLook.y += 0.82;

  if (interactionFocus > 0) {
    const elapsedFocus = FOCUS_DURATION - interactionFocus;
    const entering = THREE.MathUtils.smoothstep(elapsedFocus, 0, FOCUS_IN);
    const leaving = THREE.MathUtils.smoothstep(interactionFocus, 0, FOCUS_OUT);
    const blend = Math.min(entering, leaving);
    const focusDistance = focusedLandmarkId === 'friend' ? 14 : (focusedLandmarkId === 'viewer' ? 11 : 7.5);
    focusCamera.copy(landmarkFocus).add(new THREE.Vector3(focusDistance * 0.72, 3.8, focusDistance));
    focusLook.copy(landmarkFocus);
    cameraDesired.lerp(focusCamera, blend);
    cameraLook.lerp(focusLook, blend);
  }
  const cameraFloor = groundHeightAt(cameraDesired.x, cameraDesired.z, player.position.y + .45) + 0.72;
  cameraDesired.y = Math.max(cameraDesired.y, cameraFloor);
  const resolvedCamera = resolveLandmarkCollisions(cameraDesired.x, cameraDesired.z, cameraDesired.y);
  cameraDesired.x = resolvedCamera.x;
  cameraDesired.z = resolvedCamera.z;
  camera.position.lerp(cameraDesired, snap ? 1 : Math.min(1, delta * 6));
  // Constrain the *smoothed* result too: smoothing an unobstructed endpoint
  // alone can still carry the camera through a cloud between frames.
  sweepOrigin.copy(player.position); sweepOrigin.y += 1.2;
  updateCloudPassageOpacity(delta);
  const cameraFraction = cloudClearance(sweepOrigin, camera.position, .45, cloudSolids.filter(mesh => !cameraSoftClouds.has(mesh)));
  if (cameraFraction < 1) camera.position.lerpVectors(sweepOrigin, camera.position, cameraFraction);
  camera.lookAt(cameraLook);
}

function animate(now) {
  if (!running) return;
  const delta = Math.min(Math.max((now - lastFrameAt) / 1000, 0), 0.05);
  lastFrameAt = now;
  elapsed += delta;
  updateMovement(delta);
  playerMixer?.update(delta);
  updateMoonFall(delta);
  if (interactionFocus > 0) {
    interactionFocus = Math.max(0, interactionFocus - delta);
    if (interactionFocus === 0) {
      focusedLandmarkId = null;
      $('graybox-interact')?.classList.toggle('show', Boolean(nearLandmarkId));
      const nearby = landmarks.get(nearLandmarkId);
      setStatus(nearby ? `${nearby.label} in range. Press E.` : 'Choose a landmark to explore.');
    }
  }
  updateCamera(delta);
  navTick += delta;
  if (guide && navTick > .1) {
    navTick = 0;
    guide.update({
      player: player.position,
      yaw: cameraYaw,
      landmarks,
      passage: PASSAGE,
      terrace: Math.max(2, scrollShelfHeight - 2.2),
      near: nearLandmarkId,
    });
  }
  landmarks.forEach(record => {
    const active = nearLandmarkId === record.id || hoveredLandmarkId === record.id || focusedLandmarkId === record.id;
    record.teleportPulse = Math.max(0, (record.teleportPulse || 0) - delta * 2.5);
    const targetScale = (focusedLandmarkId === record.id ? 1.09 : (active ? 1.045 : 1)) + record.teleportPulse * .18;
    scaleTarget.copy(record.baseScale).multiplyScalar(targetScale);
    record.object.scale.lerp(scaleTarget, reducedMotion.matches ? 1 : 0.1);
    if (!(record.id === 'friend' && moonState === 'falling')) {
      record.object.position.y = record.baseY + (reducedMotion.matches ? 0 : Math.sin(elapsed * (record.id === 'viewer' ? 0.72 : 0.52) + record.id.length) * record.bob);
    }

    if (record.id === 'viewer') {
      record.object.rotation.z = reducedMotion.matches ? 0 : Math.sin(elapsed * 0.3) * 0.012;
    } else if (record.label === 'moon') {
      record.object.rotation.y += reducedMotion.matches ? 0 : delta * 0.035;
    } else if (record.label === 'scroll') {
      record.object.rotation.y += reducedMotion.matches ? 0 : delta * 0.025;
    }

    record.mixers.forEach(mixer => mixer.update(delta));
    record.birds.forEach(bird => {
      const angle = bird.angle + elapsed * bird.speed;
      bird.object.position.set(
        Math.cos(angle) * bird.radius,
        bird.height + Math.sin(elapsed * 1.1 + bird.angle) * 0.35,
        Math.sin(angle) * bird.radius * 0.72,
      );
      bird.object.rotation.y = -angle + Math.PI;
    });

    record.materials.forEach(material => {
      const baseColor = material.userData.landmarkBaseColor;
      const baseEmissive = material.userData.landmarkBaseEmissive;
      const baseIntensity = material.userData.landmarkBaseIntensity || 0.2;
      if (material.color && baseColor) {
        const colorTarget = record.visited ? baseColor.clone().lerp(visitedGray, 0.68) : baseColor;
        material.color.lerp(colorTarget, reducedMotion.matches ? 1 : 0.075);
      }
      if (material.emissive && baseEmissive) {
        const glowTarget = record.visited ? visitedGlow : (active ? record.hoverGlow : baseEmissive);
        material.emissive.lerp(glowTarget, reducedMotion.matches ? 1 : 0.075);
      }
      const intensityTarget = record.visited ? baseIntensity * 0.62 : (active ? baseIntensity + 0.42 : baseIntensity);
      material.emissiveIntensity += (intensityTarget - material.emissiveIntensity) * (reducedMotion.matches ? 1 : 0.1);
    });
  });

  companions.forEach((companion, index) => {
    const angle = companion.angle + elapsed * (0.65 + index * 0.04);
    companion.object.position.set(
      player.position.x + Math.cos(angle) * companion.radius,
      player.position.y + companion.height + (reducedMotion.matches ? 0 : Math.sin(elapsed * 1.7 + index) * 0.1),
      player.position.z + Math.sin(angle) * companion.radius,
    );
    companion.object.rotation.y = -angle + Math.PI;
  });
  renderer.render(scene, camera);
  guide?.render(renderer);
  frame = requestAnimationFrame(animate);
}

function onResize() {
  if (!renderer || !camera) return;
  applyLandmarkLayout();
  camera.fov = innerWidth < 620 ? 68 : 58;
  camera.aspect = innerWidth / Math.max(innerHeight, 1);
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.75));
}

export function pauseWorld() {
  if (!running) return;
  running = false;
  window.__worldRunning = false;
  cancelAnimationFrame(frame);
  clearInput();
}

export function resumeWorld() {
  if (!ready || !renderer || running) return;
  running = true;
  window.__worldRunning = true;
  lastFrameAt = performance.now();
  frame = requestAnimationFrame(animate);
}

export function onReturnToWorld() {
  if (player) {
    verticalVelocity = 0;
    grounded = true;
    flightMode = false;
    touchFlightCruise = false;
    spaceHeld = false;
    spaceHeldFor = 0;
    interactionFocus = 0;
    focusedLandmarkId = null;
    updateFlightControls();
    setNearObject(null);
    updateCamera(0, true);
  }
  landmarks.forEach(record => { if (record.visited) addCompanion(record); });
  scrollBoard?.userData?.refresh?.();
  if (visitedPaths.has('friend') && !speedUnlocked) {
    clearTimeout(pathTimer);
    pathTimer = setTimeout(unlockSpeed, reducedMotion.matches ? 100 : 650);
  }
  if (moonFallPending || (moonState === 'locked' && MOON_REQUIREMENTS.every(id => visitedPaths.has(id)))) startMoonFall();
  resumeWorld();
}

export function isWorldReady() { return ready; }
export function resetMoon() {}
export function skipCinematic() {}
