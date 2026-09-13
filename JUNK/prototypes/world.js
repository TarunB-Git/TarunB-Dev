/* Four-path cloud world.
   ship → viewer · scroll → friend · moon (seventh click) → personal
   bird flock → recruiter. Three.js is resolved by the site's import map. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';

import { SND, CHIME_FREQ } from './audio.js';
import { cur, curRing, setFlame, addRipple, pointer, setCursorPath } from './cursor.js';

const $ = id => document.getElementById(id);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const finePointer = matchMedia('(hover: hover) and (pointer: fine)');
const lowPower = Boolean(
  navigator.connection?.saveData ||
  (navigator.deviceMemory && navigator.deviceMemory <= 4) ||
  (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) ||
  Math.min(innerWidth, innerHeight) < 720
);
const MODEL_ROOT = new URL('../assets/models/', import.meta.url).href;
const MODEL_TIMEOUT_MS = 30_000;
const PATHS = ['recruiter', 'friend', 'viewer', 'personal'];
const PATH_META = {
  recruiter: { title: 'Work', detail: 'Career, projects, and résumé', icon: '01' },
  friend: { title: 'Story', detail: 'Memories and the longer history', icon: '02' },
  viewer: { title: 'About', detail: 'Background, values, and writing', icon: '03' },
  personal: { title: 'Personal', detail: 'Notes and quieter things', icon: '04' },
};
const HOVER_COLORS = {
  friend: new THREE.Color(0x6ecfb3), viewer: new THREE.Color(0xb898d4),
  personal: new THREE.Color(0xd06060), recruiter: new THREE.Color(0xffd700),
};
const FLAME_COLORS = {
  friend: [110, 207, 179], viewer: [184, 152, 212], personal: [210, 90, 90],
};
const RIPPLE_COLORS = {
  friend: [110, 207, 179], viewer: [184, 152, 212],
  personal: [210, 90, 90], recruiter: [255, 215, 0],
};
const FOG_TARGETS = {
  none: new THREE.Color(0x7189a2), friend: new THREE.Color(0x6f958e),
  viewer: new THREE.Color(0x817f9f), personal: new THREE.Color(0x927d88),
  recruiter: new THREE.Color(0x9a916f),
};
const WORLD_PROMPTS = {
  none: { h: 'Explore the cloud.', p: 'Walk toward a destination, then press E or click it.' },
  friend: { h: 'Story.', p: 'Memories and the longer history. Click to enter.' },
  viewer: { h: 'About.', p: 'Background, values, and writing. Click to enter.' },
  personal: { h: 'Personal.', p: 'Notes and quieter things. Click to enter.' },
  recruiter: { h: 'Work.', p: 'Career, projects, and résumé. Click to enter.' },
};
const LABELS = {
  friend: { text: 'STORY · THE SCROLL', color: 'var(--teal)' },
  viewer: { text: 'ABOUT · THE SHIP', color: 'var(--violet)' },
  personal: { text: 'PERSONAL · THE MOON', color: 'var(--crimson)' },
  recruiter: { text: 'WORK · THE BIRDS', color: '#ffd700' },
};

let scene, camera, renderer, composer, raycaster, mouse3d;
let ready = false;
let renderActive = false;
let pauseRequested = false;
let animationFrame = 0;
let lastFrameAt = 0;
let elapsed = 0;
let hoveredId = null;
let lastChimedId = null;
let promptSequence = 0;
let opts = {};
let webglAvailable = true;
let resizeTimer = 0;
let cinematicActive = false;
let cinematicProgress = 0;
let pathTimer = 0;
let worldPointerDown = null;
let playerGroup = null;
let playerBody = null;
let playerHasMoved = false;
let cameraYaw = 0;
let cameraPitch = 0.42;
let pathFlight = null;
let nearestId = null;

const mouseNorm = { x: 0, y: 0 };
const moveKeys = new Set();
const moveButtons = { forward: false, back: false, left: false, right: false };
const playerVelocity = new THREE.Vector3();
const playerSpawn = new THREE.Vector3(0, 0, 11);
const cameraLook = new THREE.Vector3();
const cameraDesired = new THREE.Vector3();
const moveForward = new THREE.Vector3();
const moveDesired = new THREE.Vector3();
const objectGroups = {};
const objectLights = {};
const hitProxies = {};
const labelEls = {};
const labels3D = {};
const rings = {};
const auras = {};
const torches = {};
const birds = [];
const grassBlades = [];
const clouds = [];
const loadState = new Map();
let loadProgressFloor = 0;
let grassPatch = null;
let flockProxy = null;

const POS = {
  viewer: new THREE.Vector3(), friend: new THREE.Vector3(),
  personal: new THREE.Vector3(), recruiter: new THREE.Vector3(),
};
const camHome = new THREE.Vector3();
const camFocus = new THREE.Vector3();
const cinematicFrom = new THREE.Vector3();
const cinematicFocusFrom = new THREE.Vector3();

const MOON_CLICKS_TO_FALL = 1;
let moonGroup = null;
let moonLight = null;
let moonHalo = null;
let moonState = 'idle';
let moonClicks = 0;
let moonVelocity = 0;

const BIRD_COUNT = lowPower ? 5 : 9;
const FLOCK_RADIUS = lowPower ? 8.5 : 11.5;
const INTERACTION_RADIUS = { recruiter: 5.8, friend: 5, viewer: 6.5, personal: 5 };

const ASSETS = [
  { id: 'viewer', file: 'ship_in_clouds.glb', bytes: 1_978_244, add: addShip, fallback: fallbackShip },
  { id: 'friend', file: 'old__ancient_scroll.glb', bytes: 202_184, add: addScroll, fallback: fallbackScroll },
  { id: 'personal', file: 'moon.glb', bytes: 159_984, add: addMoon, fallback: fallbackMoon },
  { id: 'recruiter', file: 'bird.glb', bytes: 47_764, add: addBirds, fallback: fallbackBirds },
];

export function canUseWebGL() {
  try {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('webgl2', { failIfMajorPerformanceCaveat: true }) ||
      canvas.getContext('webgl', { failIfMajorPerformanceCaveat: true });
    context?.getExtension('WEBGL_lose_context')?.loseContext();
    return Boolean(context);
  } catch {
    return false;
  }
}

function usesSoftwareRenderer(gl) {
  try {
    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    const rendererName = String(
      (debugInfo && gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)) ||
      gl.getParameter(gl.RENDERER) || '',
    ).toLowerCase();
    return /swiftshader|llvmpipe|software|microsoft basic|mesa offscreen/.test(rendererName);
  } catch {
    return false;
  }
}

export function initWorld(options = {}) {
  opts = options;
  ensureWorldControls();
  webglAvailable = canUseWebGL();
  const stage = $('s-world');
  stage?.classList.toggle('no-webgl', !webglAvailable);
  if (!webglAvailable) {
    $('three-canvas')?.setAttribute('hidden', '');
    opts.onWebGLUnavailable?.();
    opts.onProgress?.(1);
    ready = true;
    window.__worldRunning = false;
    requestAnimationFrame(() => opts.onReady?.({ webgl: false, assets: [] }));
    return;
  }

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x7892ad);
  scene.fog = new THREE.FogExp2(0x7189a2, lowPower ? 0.016 : 0.012);
  camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.1, 260);
  applyResponsiveLayout(true);
  camera.position.copy(reducedMotion.matches ? camHome : cinematicFrom);
  camera.lookAt(camFocus);
  const canvas = $('three-canvas');
  try {
    renderer = new THREE.WebGLRenderer({
      canvas, antialias: !lowPower, alpha: false,
      powerPreference: lowPower ? 'low-power' : 'high-performance',
    });
    /* Software WebGL (headless browsers, remote desktops, some virtual
       machines) can spend tens of seconds on a single frame. In that case
       the semantic world is the usable experience; real low-power GPUs still
       receive the reduced-effects 3D scene selected above. */
    if (usesSoftwareRenderer(renderer.getContext())) {
      renderer.dispose();
      renderer.forceContextLoss();
      renderer = null;
      webglAvailable = false;
      stage?.classList.add('no-webgl');
      canvas?.setAttribute('hidden', '');
      opts.onWebGLUnavailable?.(new Error('Software WebGL renderer detected'));
      opts.onProgress?.(1);
      ready = true;
      window.__worldRunning = false;
      requestAnimationFrame(() => opts.onReady?.({ webgl: false, assets: [] }));
      return;
    }
  } catch (error) {
    webglAvailable = false;
    stage?.classList.add('no-webgl');
    canvas?.setAttribute('hidden', '');
    opts.onWebGLUnavailable?.(error);
    opts.onProgress?.(1);
    ready = true;
    requestAnimationFrame(() => opts.onReady?.({ webgl: false, assets: [] }));
    return;
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, lowPower ? 1.25 : 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = lowPower ? 1.15 : 1.28;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = !lowPower;
  if (!lowPower) renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  raycaster = new THREE.Raycaster();
  mouse3d = new THREE.Vector2();

  buildLights();
  buildGround();
  buildPlayer();
  buildSky();
  buildAtmosphere();
  buildHoverRings();
  buildTorches();
  buildObjectAuras();
  setupPostProcessing();
  setupLabels();
  bindWorldEvents();
  const loading = loadModels();
  let announcedReady = false;
  const announceReady = (reason, results = null) => {
    if (announcedReady) return;
    announcedReady = true;
    ready = true;
    cinematicActive = !reducedMotion.matches;
    cinematicProgress = 0;
    $('world-skip')?.classList.toggle('show', cinematicActive);
    setCursorPath('world');
    if (!pauseRequested) resumeWorld();
    const assets = results ? results.map((result, index) => ({ id: ASSETS[index].id, status: result.status })) :
      ASSETS.map(asset => ({ id: asset.id, status: loadState.get(asset.id)?.status || 'loading' }));
    opts.onReady?.({
      webgl: true, assets, progressive: reason === 'progressive',
    });
  };
  const progressiveTimer = setTimeout(() => announceReady('progressive'), 4_000);
  loading.then(results => {
    clearTimeout(progressiveTimer);
    announceReady('complete', results);
    opts.onAssetsReady?.({
      assets: results.map((result, index) => ({ id: ASSETS[index].id, status: result.status })),
    });
  });
}

function bindWorldEvents() {
  const stage = $('s-world');
  if (!stage || stage.dataset.worldBound) return;
  stage.dataset.worldBound = 'true';
  stage.addEventListener('pointermove', event => {
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    if (worldPointerDown?.id === event.pointerId && !event.target.closest('button,a')) {
      const dx = event.clientX - worldPointerDown.lastX;
      const dy = event.clientY - worldPointerDown.lastY;
      const distance = Math.hypot(event.clientX - worldPointerDown.x, event.clientY - worldPointerDown.y);
      if (distance > 8 && !worldPointerDown.dragged) {
        worldPointerDown.dragged = true;
        skipCinematic();
      }
      if (worldPointerDown.dragged) {
        cameraYaw -= dx * 0.0045;
        cameraPitch = THREE.MathUtils.clamp(cameraPitch + dy * 0.003, 0.24, 0.7);
        setHovered(null);
      }
      worldPointerDown.lastX = event.clientX;
      worldPointerDown.lastY = event.clientY;
    }
    if (!worldPointerDown?.dragged && (event.pointerType === 'mouse' || event.pointerType === 'pen')) {
      updateHoverAt(event.clientX, event.clientY);
    }
  }, { passive: true });
  stage.addEventListener('pointerleave', () => setHovered(null));
  stage.addEventListener('pointerdown', event => {
    if (event.target.closest('button,a')) return;
    worldPointerDown = {
      id: event.pointerId, x: event.clientX, y: event.clientY,
      lastX: event.clientX, lastY: event.clientY, dragged: false,
    };
  }, { passive: true });
  stage.addEventListener('pointerup', event => {
    if (event.button !== undefined && event.button !== 0) return;
    if (event.target.closest('button,a')) return;
    if (!worldPointerDown || worldPointerDown.id !== event.pointerId || worldPointerDown.dragged ||
        Math.hypot(event.clientX - worldPointerDown.x, event.clientY - worldPointerDown.y) > 16) {
      worldPointerDown = null;
      return;
    }
    worldPointerDown = null;
    chooseAt(event.clientX, event.clientY);
  });
  stage.addEventListener('pointercancel', () => { worldPointerDown = null; });
  $('three-canvas')?.addEventListener('webglcontextlost', event => {
    event.preventDefault();
    pauseWorld();
    stage.classList.add('no-webgl');
    const note = $('world-fallback-note');
    if (note) note.textContent = 'The 3D world paused after the graphics context was lost. Every path remains available.';
    opts.onWebGLUnavailable?.(new Error('WebGL context lost'));
  });
  $('three-canvas')?.addEventListener('webglcontextrestored', () => {
    stage.classList.remove('no-webgl');
    resumeWorld();
  });
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(onResize, 80);
  }, { passive: true });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pauseWorld();
    else if (!$('s-world')?.classList.contains('out')) resumeWorld();
  });
  window.addEventListener('keydown', event => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) return;
    if (stage.classList.contains('out')) return;
    const key = event.key.toLowerCase();
    if (key === 'e' && nearestId) {
      event.preventDefault();
      choosePath(nearestId, innerWidth / 2, innerHeight / 2);
      return;
    }
    if (!['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) return;
    event.preventDefault();
    moveKeys.add(key);
    skipCinematic();
  });
  window.addEventListener('keyup', event => moveKeys.delete(event.key.toLowerCase()));
  window.addEventListener('blur', () => {
    moveKeys.clear();
    Object.keys(moveButtons).forEach(key => { moveButtons[key] = false; });
  });
}

function ensureWorldControls() {
  const ui = $('world-ui');
  if (!ui) return;
  if (!$('world-paths')) {
    const nav = document.createElement('nav');
    nav.id = 'world-paths';
    nav.className = 'world-paths';
    nav.setAttribute('aria-label', 'Portfolio destinations');
    PATHS.forEach(id => {
      const meta = PATH_META[id];
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `world-path-choice path-${id}`;
      button.dataset.path = id;
      button.innerHTML = `<span aria-hidden="true">${meta.icon}</span><strong>${meta.title}</strong><small>${meta.detail}</small>`;
      button.addEventListener('focus', () => setHovered(id));
      button.addEventListener('blur', () => setHovered(null));
      button.addEventListener('pointerenter', event => {
        if (event.pointerType === 'mouse' || event.pointerType === 'pen') setHovered(id);
      });
      button.addEventListener('pointerleave', event => {
        if (event.pointerType === 'mouse' || event.pointerType === 'pen') setHovered(null);
      });
      button.addEventListener('click', event => choosePath(id, event.clientX, event.clientY));
      nav.appendChild(button);
    });
    ui.appendChild(nav);
  }
  if (!$('world-skip')) {
    const skip = document.createElement('button');
    skip.id = 'world-skip';
    skip.type = 'button';
    skip.textContent = 'Skip animation';
    skip.addEventListener('click', skipCinematic);
    ui.appendChild(skip);
  }
  if (!$('world-fallback-note')) {
    const note = document.createElement('p');
    note.id = 'world-fallback-note';
    note.setAttribute('role', 'status');
    note.textContent = 'The cloud world could not start on this device. Every path is still available below.';
    ui.appendChild(note);
  }
  if (!$('world-play-hud')) {
    const hud = document.createElement('div');
    hud.id = 'world-play-hud';
    hud.innerHTML = `
      <p><strong>Walk</strong><span>W / S or ↑ / ↓</span></p>
      <p><strong>Turn</strong><span>A / D or ← / →</span></p>
      <p><strong>Look</strong><span>drag the sky</span></p>
      <div class="world-dpad" role="group" aria-label="Movement controls">
        <button type="button" data-move="forward" aria-label="Move forward">↑</button>
        <button type="button" data-move="left" aria-label="Turn left">←</button>
        <button type="button" data-move="back" aria-label="Move backward">↓</button>
        <button type="button" data-move="right" aria-label="Turn right">→</button>
      </div>`;
    hud.querySelectorAll('[data-move]').forEach(button => {
      const direction = button.dataset.move;
      const stop = () => { moveButtons[direction] = false; };
      button.addEventListener('pointerdown', event => {
        event.preventDefault();
        button.setPointerCapture?.(event.pointerId);
        moveButtons[direction] = true;
        skipCinematic();
      });
      button.addEventListener('pointerup', stop);
      button.addEventListener('pointercancel', stop);
      button.addEventListener('lostpointercapture', stop);
    });
    ui.appendChild(hud);
  }
  if (!$('world-interact')) {
    const interact = document.createElement('button');
    interact.id = 'world-interact';
    interact.type = 'button';
    interact.setAttribute('aria-live', 'polite');
    interact.innerHTML = '<span>Nearby</span><strong>Press E to enter</strong>';
    interact.addEventListener('click', () => {
      if (nearestId) choosePath(nearestId, innerWidth / 2, innerHeight / 2);
    });
    ui.appendChild(interact);
  }
}

/* Progressive, isolated model loading. */
async function loadModels() {
  loadProgressFloor = 0;
  ASSETS.forEach(asset => loadState.set(asset.id, { loaded: 0, total: asset.bytes, status: 'queued' }));
  reportLoadProgress();
  const jobs = ASSETS.map(async asset => {
    reportAsset(asset, 'loading');
    try {
      const gltf = await fetchAndParseGLB(asset);
      asset.add(gltf);
      reportAsset(asset, 'loaded');
      markChoiceState(asset.id, 'loaded');
      return gltf;
    } catch (error) {
      console.warn(`Using the ${asset.id} fallback:`, error);
      asset.fallback();
      reportAsset(asset, 'failed', error);
      markChoiceState(asset.id, 'fallback');
      throw error;
    }
  });
  const results = await Promise.allSettled(jobs);
  ASSETS.forEach(asset => {
    const state = loadState.get(asset.id);
    state.loaded = state.total;
  });
  reportLoadProgress(true);
  return results;
}

async function fetchAndParseGLB(asset) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new DOMException('Model load timed out', 'TimeoutError')), MODEL_TIMEOUT_MS);
  const url = MODEL_ROOT + asset.file;
  try {
    const response = await fetch(url, { signal: controller.signal, credentials: 'same-origin' });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const state = loadState.get(asset.id);
    const headerBytes = Number(response.headers.get('content-length'));
    state.total = Number.isFinite(headerBytes) && headerBytes > 0 ? headerBytes : asset.bytes;
    let buffer;
    if (response.body?.getReader) {
      const reader = response.body.getReader();
      const chunks = [];
      let received = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.byteLength;
        state.loaded = Math.min(received, state.total);
        reportLoadProgress();
        opts.onAssetStatus?.({ id: asset.id, url, status: 'loading', loaded: received, total: state.total });
      }
      const joined = new Uint8Array(received);
      let offset = 0;
      chunks.forEach(chunk => { joined.set(chunk, offset); offset += chunk.byteLength; });
      buffer = joined.buffer;
    } else {
      buffer = await response.arrayBuffer();
      state.loaded = buffer.byteLength;
      reportLoadProgress();
    }
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    return await new Promise((resolve, reject) => loader.parse(buffer, MODEL_ROOT, resolve, reject));
  } finally {
    clearTimeout(timeout);
  }
}

function reportAsset(asset, status, error = null) {
  const state = loadState.get(asset.id) || { loaded: 0, total: asset.bytes };
  state.status = status;
  if (status === 'loaded' || status === 'failed') state.loaded = state.total;
  loadState.set(asset.id, state);
  opts.onAssetStatus?.({
    id: asset.id, url: MODEL_ROOT + asset.file, status,
    loaded: state.loaded, total: state.total,
    error: error ? String(error.message || error) : undefined,
  });
  reportLoadProgress();
}

function reportLoadProgress(force = false) {
  let loaded = 0;
  let total = 0;
  loadState.forEach(state => { loaded += Math.min(state.loaded, state.total); total += state.total; });
  loadProgressFloor = Math.max(loadProgressFloor, force ? 1 : (total ? loaded / total : 0));
  opts.onProgress?.(Math.min(loadProgressFloor, 1));
}

function markChoiceState(id, state) {
  const button = document.querySelector(`.world-path-choice[data-path="${id}"]`);
  if (!button) return;
  button.dataset.assetState = state;
  button.classList.toggle('uses-fallback', state === 'fallback');
}

/* Models and fallbacks. */
function fitModel(object, targetSize) {
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  object.scale.setScalar(targetSize / Math.max(size.x, size.y, size.z, 1e-6));
  box.setFromObject(object);
  object.position.sub(box.getCenter(new THREE.Vector3()));
  return object;
}

function registerGroup(inner, id, rotationY = 0) {
  const group = new THREE.Group();
  group.add(inner);
  group.position.copy(POS[id]);
  group.rotation.y = rotationY;
  inner.traverse(node => {
    if (!node.isMesh) return;
    node.castShadow = !lowPower;
    node.receiveShadow = !lowPower;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    node.userData.hoverMaterials = materials.filter(material => material?.emissive);
  });
  scene.add(group);
  objectGroups[id] = group;
  return group;
}

function addProxy(id, geometry) {
  const proxy = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ visible: false }));
  proxy.position.copy(POS[id]);
  proxy.userData.pathId = id;
  scene.add(proxy);
  hitProxies[id] = proxy;
  return proxy;
}

function addShip(gltf) {
  /* The ship-and-clouds asset is the world's outer shell. The other models,
     player, and paths all remain independent objects inside its bounds. */
  /* The source contains its own enclosing sky mesh. The site supplies the sky;
     keeping both made the smaller destinations disappear behind the shell. */
  gltf.scene.traverse(node => {
    if (node.isMesh && /sky/i.test(node.name || '')) node.visible = false;
  });
  registerGroup(fitModel(gltf.scene, 32), 'viewer', 0.12);
  addLight('viewer', 0xb898d4);
  const fill = new THREE.PointLight(0x9eb7df, lowPower ? 0.32 : 0.64, 72, 1.6);
  scene.add(fill);
  scene.userData.viewerFill = fill;
  addProxy('viewer', new THREE.BoxGeometry(10, 8, 7));
  applyResponsiveLayout();
}

function addScroll(gltf) {
  const group = registerGroup(fitModel(gltf.scene, 3.65), 'friend', 0.7);
  group.rotation.z = 0.05;
  addLight('friend', 0x6ecfb3);
  addProxy('friend', new THREE.SphereGeometry(3.4, lowPower ? 8 : 12, 8));
  buildGrassPatch();
  applyResponsiveLayout();
}

function addMoon(gltf) {
  moonGroup = registerGroup(fitModel(gltf.scene, 4.8), 'personal');
  moonLight = new THREE.PointLight(0xd4e4ff, lowPower ? 0.58 : 0.85, 150);
  moonHalo = new THREE.Mesh(
    new THREE.SphereGeometry(6.2, lowPower ? 10 : 16, lowPower ? 10 : 16),
    new THREE.MeshBasicMaterial({ color: 0x4060a0, transparent: true, opacity: 0.04, side: THREE.BackSide }),
  );
  scene.add(moonLight, moonHalo);
  addProxy('personal', new THREE.SphereGeometry(3.6, 10, 8));
  if (moonState === 'idle') resetMoon();
  else {
    moonGroup.position.copy(POS.personal);
    moonGroup.position.y = -30;
    moonLight.position.copy(moonGroup.position);
    moonHalo.position.copy(moonGroup.position);
    hitProxies.personal.position.copy(moonGroup.position);
  }
}

function addBirds(gltf) {
  for (let index = 0; index < BIRD_COUNT; index++) {
    const bird = cloneSkeleton(gltf.scene);
    fitModel(bird, lowPower ? 1.45 : 1.7);
    const holder = new THREE.Group();
    holder.userData.pathId = 'recruiter';
    holder.add(bird);
    scene.add(holder);
    const mixer = new THREE.AnimationMixer(bird);
    if (gltf.animations?.length) {
      const action = mixer.clipAction(gltf.animations[0]);
      action.timeScale = 0.9 + Math.random() * 0.35;
      action.startAt(Math.random() * 2).play();
    }
    birds.push({
      obj: holder, mixer, angle: (index / BIRD_COUNT) * Math.PI * 2,
      radius: FLOCK_RADIUS * (0.56 + Math.random() * 0.55),
      height: (Math.random() - 0.5) * 3.2,
      speed: 0.16 + Math.random() * 0.1,
    });
  }
  objectGroups.recruiter = new THREE.Group();
  addLight('recruiter', 0xffd700);
  flockProxy = addProxy('recruiter', new THREE.SphereGeometry(4.8, 10, 8));
  applyResponsiveLayout();
}

function fallbackShip() {
  const group = new THREE.Group();
  const cloudMaterial = new THREE.MeshStandardMaterial({ color: 0x7383a8, roughness: 0.95 });
  [-3, 0, 3].forEach((x, index) => {
    const cloud = new THREE.Mesh(new THREE.SphereGeometry(2.5 + index * 0.4, 12, 8), cloudMaterial);
    cloud.position.set(x, index % 2, 0);
    group.add(cloud);
  });
  const hull = new THREE.Mesh(
    new THREE.ConeGeometry(3, 7, 4),
    new THREE.MeshStandardMaterial({ color: 0x382719, roughness: 0.75, emissive: 0x000000 }),
  );
  hull.rotation.z = Math.PI / 2;
  hull.position.y = 3;
  group.add(hull);
  addShip({ scene: group });
}

function fallbackScroll() {
  addScroll({ scene: new THREE.Mesh(
    new THREE.BoxGeometry(4, 0.35, 2.2),
    new THREE.MeshStandardMaterial({ color: 0x8a6f3b, roughness: 0.9, emissive: 0x000000 }),
  ) });
}

function fallbackMoon() {
  addMoon({ scene: new THREE.Mesh(
    new THREE.SphereGeometry(2.8, 20, 16),
    new THREE.MeshStandardMaterial({ color: 0xb9c2d8, roughness: 0.85, emissive: 0x05070c }),
  ) });
}

function fallbackBirds() {
  const bird = new THREE.Group();
  const wing = new THREE.Mesh(
    new THREE.ConeGeometry(0.35, 1.5, 3),
    new THREE.MeshStandardMaterial({ color: 0xd7bd58, side: THREE.DoubleSide, emissive: 0x000000 }),
  );
  wing.rotation.z = Math.PI / 2;
  bird.add(wing);
  addBirds({ scene: bird, animations: [] });
}

function applyResponsiveLayout(initial = false) {
  const portrait = innerWidth / Math.max(innerHeight, 1) < 0.86;
  if (portrait) {
    POS.viewer.set(2.1, 3.8, -4.6);
    POS.friend.set(-4.25, 0.32, 3.1);
    POS.personal.set(5.2, 4.4, 0.2);
    POS.recruiter.set(0, 3.1, -1.5);
    playerSpawn.set(0, 0, 8);
    camHome.set(0, 5.8, 15);
    camFocus.set(0, 2.4, -1);
    cinematicFrom.set(-12, 17, 31);
    cinematicFocusFrom.set(-2, 4, -2);
    if (camera) camera.fov = 70;
  } else {
    POS.viewer.set(2.5, 4, -4.5);
    POS.friend.set(-4.8, 0.34, 3.2);
    POS.personal.set(6.5, 4.5, 0.2);
    POS.recruiter.set(0, 3.2, -1.5);
    playerSpawn.set(0, 0, 8);
    camHome.set(0, 5.8, 16);
    camFocus.set(0, 2.2, -1);
    cinematicFrom.set(-18, 19, 34);
    cinematicFocusFrom.set(-4, 4, -2);
    if (camera) camera.fov = 65;
  }
  camera?.updateProjectionMatrix();
  Object.entries(objectGroups).forEach(([id, group]) => {
    if (id !== 'recruiter') group.position.copy(POS[id]);
  });
  Object.entries(hitProxies).forEach(([id, proxy]) => proxy.position.copy(POS[id]));
  if (grassPatch) grassPatch.position.copy(POS.friend);
  if (moonState === 'idle' && moonGroup) moonGroup.position.copy(POS.personal);
  if (moonLight) moonLight.position.copy(moonGroup?.position || POS.personal);
  if (moonHalo) moonHalo.position.copy(moonGroup?.position || POS.personal);
  if (flockProxy) flockProxy.position.copy(POS.recruiter);
  Object.entries(objectLights).forEach(([id, light]) => {
    light.position.copy(POS[id]).add(new THREE.Vector3(0, id === 'friend' || id === 'viewer' ? 4 : 0, id === 'viewer' ? 6 : 0));
  });
  if (scene?.userData.viewerFill) scene.userData.viewerFill.position.copy(POS.viewer).add(new THREE.Vector3(6, 10, 12));
  if (rings.friend) rings.friend.position.set(POS.friend.x, 0.05, POS.friend.z);
  if (rings.viewer) rings.viewer.position.set(POS.viewer.x, 0.05, POS.viewer.z);
  Object.entries(auras).forEach(([id, aura]) => aura.mat.uniforms.center.value.copy(POS[id]));
  labels3D.viewer = POS.viewer.clone().add(new THREE.Vector3(0, 7.5, 0));
  labels3D.friend = POS.friend.clone().add(new THREE.Vector3(0, 3.4, 0));
  labels3D.personal = POS.personal.clone().add(new THREE.Vector3(0, 5.2, 0));
  labels3D.recruiter = POS.recruiter.clone().add(new THREE.Vector3(0, 3.8, 0));
  if (playerGroup && !playerHasMoved) {
    playerGroup.position.copy(playerSpawn);
    playerGroup.position.y = groundHeightAt(playerSpawn.x, playerSpawn.z);
  }
  if (!initial && !cinematicActive && camera) {
    updatePlayerCamera(0, true);
  }
}

/* Environment. */
function buildLights() {
  scene.add(new THREE.AmbientLight(0xb9cbe0, lowPower ? 1.05 : 1.25));
  const light = new THREE.DirectionalLight(0xfff0d2, lowPower ? 1.45 : 2.15);
  light.position.set(-14, 24, 12);
  if (!lowPower) {
    light.castShadow = true;
    light.shadow.mapSize.set(1024, 1024);
    Object.assign(light.shadow.camera, { near: 0.5, far: 100, left: -35, right: 35, top: 25, bottom: -25 });
    light.shadow.bias = -0.001;
  }
  scene.add(light, new THREE.HemisphereLight(0xd7ecff, 0x53677d, lowPower ? 0.75 : 1.05));
}

function buildGround() {
  const segments = lowPower ? 34 : 72;
  let geometry = new THREE.PlaneGeometry(130, 130, segments, segments);
  const positions = geometry.attributes.position;
  for (let index = 0; index < positions.count; index++) {
    const x = positions.getX(index);
    const z = positions.getY(index);
    if (Math.hypot(x, z) > 6) positions.setZ(index,
      Math.sin(x * 0.28) * Math.cos(z * 0.22) * 0.35 +
      Math.sin(x * 0.65 + z * 0.5) * 0.16 + Math.sin(x * 0.12 + z * 0.09) * 0.5);
  }
  geometry = geometry.toNonIndexed();
  geometry.computeVertexNormals();
  const cloudTexture = buildCloudSurfaceTexture();
  const ground = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
    color: 0xa2a3b9, map: cloudTexture, bumpMap: cloudTexture,
    bumpScale: 0.32, roughness: 0.98, metalness: 0, flatShading: true,
  }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = !lowPower;
  scene.add(ground);
  buildGroundCloudCarpet(cloudTexture);
}

function buildGroundCloudCarpet(texture) {
  const count = lowPower ? 46 : 108;
  const geometry = new THREE.IcosahedronGeometry(1, 1);
  const material = new THREE.MeshStandardMaterial({
    color: 0xb2aec2, map: texture, roughness: 1, metalness: 0,
    flatShading: true, transparent: true, opacity: 0.84,
  });
  const carpet = new THREE.InstancedMesh(geometry, material, count);
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const euler = new THREE.Euler();
  let seed = 9187;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let index = 0; index < count; index++) {
    const x = (random() - 0.5) * 74;
    const z = (random() - 0.5) * 58 - 4;
    const width = 1.8 + random() * 3.8;
    position.set(x, groundHeightAt(x, z) - 0.16 - random() * 0.14, z);
    euler.set(random() * 0.12, random() * Math.PI, random() * 0.08);
    rotation.setFromEuler(euler);
    scale.set(width, 0.48 + random() * 0.34, width * (0.7 + random() * 0.5));
    matrix.compose(position, rotation, scale);
    carpet.setMatrixAt(index, matrix);
  }
  carpet.instanceMatrix.needsUpdate = true;
  carpet.receiveShadow = !lowPower;
  scene.add(carpet);
  scene.userData.groundCloudCarpet = carpet;
}

function buildCloudSurfaceTexture() {
  const size = lowPower ? 256 : 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  context.fillStyle = '#777f9d';
  context.fillRect(0, 0, size, size);
  let seed = 7261;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const puffs = lowPower ? 130 : 280;
  for (let index = 0; index < puffs; index++) {
    const x = random() * size;
    const y = random() * size;
    const radius = size * (0.035 + random() * 0.12);
    const lightness = 122 + Math.round(random() * 78);
    const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, `rgba(${lightness + 16},${lightness + 8},${lightness + 22},${0.14 + random() * 0.18})`);
    gradient.addColorStop(0.58, `rgba(${lightness},${lightness - 4},${lightness + 12},${0.07 + random() * 0.1})`);
    gradient.addColorStop(1, 'rgba(80,87,116,0)');
    context.fillStyle = gradient;
    context.beginPath();
    context.ellipse(x, y, radius, radius * (0.52 + random() * 0.5), random() * Math.PI, 0, Math.PI * 2);
    context.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(5.5, 5.5);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = Math.min(4, renderer?.capabilities?.getMaxAnisotropy?.() || 1);
  return texture;
}

function groundHeightAt(x, z) {
  if (Math.hypot(x, z) <= 6) return 0;
  return Math.sin(x * 0.28) * Math.cos(z * 0.22) * 0.35 +
    Math.sin(x * 0.65 + z * 0.5) * 0.16 + Math.sin(x * 0.12 + z * 0.09) * 0.5;
}

function buildPlayer() {
  playerGroup = new THREE.Group();
  playerBody = new THREE.Group();
  const coat = new THREE.MeshStandardMaterial({ color: 0xd8b96a, roughness: 0.76, emissive: 0x211704 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x18202a, roughness: 0.9 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xd5a77e, roughness: 0.88 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 0.5, 4, 8), coat);
  body.position.y = 1.12;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.25, 12, 9), skin);
  head.position.y = 1.76;
  const hood = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.48, 10), dark);
  hood.position.set(0, 2.05, 0.03);
  const makeLimb = (x, y, material = dark) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, 0);
    const limb = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.45, 3, 6), material);
    limb.position.y = -0.26;
    pivot.add(limb);
    return pivot;
  };
  const leftLeg = makeLimb(-0.14, 0.82);
  const rightLeg = makeLimb(0.14, 0.82);
  const leftArm = makeLimb(-0.34, 1.4, coat);
  const rightArm = makeLimb(0.34, 1.4, coat);
  playerBody.add(body, head, hood, leftLeg, rightLeg, leftArm, rightArm);
  playerBody.userData.limbs = { leftLeg, rightLeg, leftArm, rightArm };
  playerBody.traverse(node => {
    if (node.isMesh) node.castShadow = !lowPower;
  });
  const glow = new THREE.PointLight(0xf2cf7b, lowPower ? 0.18 : 0.3, 7, 2);
  glow.position.y = 1.25;
  playerGroup.add(playerBody, glow);
  playerGroup.position.copy(playerSpawn);
  playerGroup.position.y = groundHeightAt(playerSpawn.x, playerSpawn.z);
  scene.add(playerGroup);
}

function buildGrassPatch() {
  grassPatch = new THREE.Group();
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(5.2, 24),
    new THREE.MeshStandardMaterial({ color: 0x0a2410, roughness: 1 }),
  );
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = 0.02;
  grassPatch.add(disc);
  const material = new THREE.MeshStandardMaterial({ color: 0x14501e, roughness: 0.95 });
  const count = lowPower ? 34 : 90;
  for (let index = 0; index < count; index++) {
    const angle = Math.random() * Math.PI * 2;
    const radius = 1.2 + Math.random() * 3.8;
    const blade = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.32 + Math.random() * 0.5, 4), material);
    blade.position.set(Math.cos(angle) * radius, 0.16, Math.sin(angle) * radius);
    blade.userData.phase = Math.random() * Math.PI * 2;
    grassPatch.add(blade);
    grassBlades.push(blade);
  }
  grassPatch.position.copy(POS.friend);
  scene.add(grassPatch);
}

function buildSky() {
  const count = lowPower ? 950 : 2600;
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  for (let index = 0; index < count; index++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.random() * Math.PI * 0.42;
    const radius = 95 + Math.random() * 22;
    positions[index * 3] = radius * Math.sin(phi) * Math.cos(theta);
    positions[index * 3 + 1] = radius * Math.cos(phi) + 8;
    positions[index * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);
    sizes[index] = Math.random() * 1.9 + 0.3;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('pSize', new THREE.BufferAttribute(sizes, 1));
  const material = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 } },
    vertexShader: 'attribute float pSize;uniform float time;varying float vA;void main(){vA=.42+.58*sin(time*1.4+position.x*.28+position.z*.19);gl_PointSize=pSize*(1.+.28*sin(time*1.9+position.y*.09));gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: 'varying float vA;void main(){float d=distance(gl_PointCoord,vec2(.5));if(d>.5)discard;gl_FragColor=vec4(.86,.91,1.,smoothstep(.5,.0,d)*vA);}',
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  scene.add(new THREE.Points(geometry, material));
  scene.userData.starsMat = material;
}

function buildAtmosphere() {
  const count = lowPower ? 22 : 58;
  const positions = new Float32Array(count * 3);
  const phases = new Float32Array(count);
  for (let index = 0; index < count; index++) {
    positions[index * 3] = (Math.random() - 0.5) * 55;
    positions[index * 3 + 1] = Math.random() * 5.5 + 0.4;
    positions[index * 3 + 2] = (Math.random() - 0.5) * 32 - 5;
    phases[index] = Math.random() * Math.PI * 2;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('phase', new THREE.BufferAttribute(phases, 1));
  const material = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 } },
    vertexShader: 'attribute float phase;uniform float time;varying float vB;void main(){vB=.4+.6*sin(time*2.3+phase);vec3 p=position;p.x+=sin(time*.38+phase)*1.6;p.y+=sin(time*.55+phase*1.3)*.7;p.z+=cos(time*.32+phase*.9)*1.3;gl_PointSize=4.;gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);}',
    fragmentShader: 'varying float vB;void main(){float d=distance(gl_PointCoord,vec2(.5));if(d>.5)discard;gl_FragColor=vec4(.65,1.,.45,smoothstep(.5,.0,d)*vB*.82);}',
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  scene.add(new THREE.Points(geometry, material));
  scene.userData.fireflyMat = material;
  const cloudCount = lowPower ? 7 : 14;
  for (let index = 0; index < cloudCount; index++) {
    const cloud = new THREE.Mesh(
      new THREE.PlaneGeometry(28 + Math.random() * 36, 3.2 + Math.random() * 4.5),
      new THREE.MeshBasicMaterial({ color: 0x5870a8, transparent: true, opacity: 0.022, depthWrite: false }),
    );
    cloud.rotation.x = -Math.PI / 2 + (Math.random() - 0.5) * 0.12;
    cloud.position.set((Math.random() - 0.5) * 60, 0.4 + Math.random() * 9, (Math.random() - 0.5) * 40 - 6);
    cloud.rotation.y = Math.random() * Math.PI;
    cloud.userData.drift = 0.12 + Math.random() * 0.3;
    clouds.push(cloud);
    scene.add(cloud);
  }
}

function buildHoverRings() {
  const config = {
    friend: { color: 0x6ecfb3, radius: [2.6, 3.3] },
    viewer: { color: 0xb898d4, radius: [7.5, 8.6] },
  };
  Object.entries(config).forEach(([id, item]) => {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(item.radius[0], item.radius[1], lowPower ? 28 : 48),
      new THREE.MeshBasicMaterial({ color: item.color, transparent: true, opacity: 0, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    scene.add(ring);
    rings[id] = ring;
  });
  applyResponsiveLayout();
}

function buildTorches() {
  const config = {
    friend: { color: 0x6ecfb3, base: 0.12, frequency: 2.1, phase: 0 },
    viewer: { color: 0xb898d4, base: 0.1, frequency: 1.7, phase: 1.2 },
  };
  Object.entries(config).forEach(([id, item]) => {
    const light = new THREE.PointLight(item.color, item.base, 12, 1.8);
    light.position.copy(POS[id]).add(new THREE.Vector3(id === 'friend' ? 2.6 : 8, id === 'friend' ? 1.1 : 3, id === 'friend' ? -1.4 : 8));
    scene.add(light);
    torches[id] = { light, ...item };
  });
}

function buildObjectAuras() {
  const config = {
    friend: { color: new THREE.Color(0x6ecfb3), count: lowPower ? 12 : 34, spread: 1 },
    viewer: { color: new THREE.Color(0xb898d4), count: lowPower ? 16 : 44, spread: 3 },
    recruiter: { color: new THREE.Color(0xffd700), count: lowPower ? 14 : 40, spread: 1.6 },
  };
  Object.entries(config).forEach(([id, item]) => {
    const phases = new Float32Array(item.count);
    const speeds = new Float32Array(item.count);
    const radii = new Float32Array(item.count);
    const positions = new Float32Array(item.count * 3);
    for (let index = 0; index < item.count; index++) {
      phases[index] = Math.random() * Math.PI * 2;
      speeds[index] = 0.3 + Math.random() * 0.7;
      radii[index] = (1 + Math.random() * 2.5) * item.spread;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
    geometry.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));
    geometry.setAttribute('aRadius', new THREE.BufferAttribute(radii, 1));
    const material = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 }, color: { value: item.color }, center: { value: POS[id].clone() },
        opacity: { value: 0.07 }, spread: { value: item.spread },
      },
      vertexShader: 'attribute float aPhase,aSpeed,aRadius;uniform float time,spread;uniform vec3 center;varying float vL;void main(){float a=time*aSpeed+aPhase;vec3 p=vec3(center.x+cos(a)*aRadius,center.y+mod(time*aSpeed*.4+aPhase,3.0*spread)+sin(time*aSpeed+aPhase*1.3)*.3,center.z+sin(a)*aRadius*.7);vL=1.-smoothstep(0.,3.5*spread,length(p-center)-1.);gl_PointSize=2.2+sin(time*aSpeed*2.+aPhase)*.7;gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);}',
      fragmentShader: 'uniform vec3 color;uniform float opacity;varying float vL;void main(){float d=distance(gl_PointCoord,vec2(.5));if(d>.5)discard;gl_FragColor=vec4(color,smoothstep(.5,.0,d)*opacity*vL);}',
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    scene.add(new THREE.Points(geometry, material));
    auras[id] = { mat: material };
  });
}

function addLight(id, color) {
  const light = new THREE.PointLight(color, 0, 24, 1.4);
  scene.add(light);
  objectLights[id] = light;
}

function setupPostProcessing() {
  if (lowPower || reducedMotion.matches) return;
  try {
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.72, 0.48, 0.2));
    const grain = new ShaderPass({
      uniforms: { tDiffuse: { value: null }, time: { value: 0 }, amount: { value: 0.028 } },
      vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader: 'uniform sampler2D tDiffuse;uniform float time,amount;varying vec2 vUv;float rnd(vec2 c){return fract(sin(dot(c*time,vec2(12.9898,78.233)))*43758.5453);}void main(){vec4 c=texture2D(tDiffuse,vUv);c.rgb+=rnd(vUv)*amount-amount*.5;gl_FragColor=c;}',
    });
    composer.addPass(grain);
    scene.userData.grainPass = grain;
  } catch (error) {
    console.warn('Post-processing unavailable; using the direct renderer.', error);
    composer = null;
  }
}

function setupLabels() {
  const ui = $('world-ui');
  Object.entries(LABELS).forEach(([id, config]) => {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = 'obj-label';
    element.textContent = config.text;
    element.style.color = config.color;
    element.setAttribute('aria-label', `Open ${PATH_META[id].title}: ${PATH_META[id].detail}`);
    element.addEventListener('pointerenter', event => {
      if (event.pointerType === 'mouse' || event.pointerType === 'pen') setHovered(id);
    });
    element.addEventListener('pointerleave', () => setHovered(null));
    element.addEventListener('focus', () => setHovered(id));
    element.addEventListener('blur', () => setHovered(null));
    element.addEventListener('click', event => {
      event.stopPropagation();
      choosePath(id, event.clientX, event.clientY);
    });
    ui?.appendChild(element);
    labelEls[id] = element;
  });
}

/* Interaction. Pointer-up always performs a fresh raycast at that coordinate. */
function pathAt(clientX, clientY) {
  if (!raycaster || !camera) return null;
  const rect = $('three-canvas')?.getBoundingClientRect() || { left: 0, top: 0, width: innerWidth, height: innerHeight };
  mouseNorm.x = ((clientX - rect.left) / Math.max(rect.width, 1)) * 2 - 1;
  mouseNorm.y = -((clientY - rect.top) / Math.max(rect.height, 1)) * 2 + 1;
  mouse3d.set(mouseNorm.x, mouseNorm.y);
  raycaster.setFromCamera(mouse3d, camera);
  const hit = raycaster.intersectObjects([
    ...Object.values(hitProxies), ...birds.map(bird => bird.obj),
  ], true)[0];
  let target = hit?.object || null;
  while (target && !target.userData?.pathId) target = target.parent;
  const id = target?.userData?.pathId || null;
  return id === 'personal' && moonState !== 'idle' ? null : id;
}

function updateHoverAt(clientX, clientY) { setHovered(pathAt(clientX, clientY)); }

function setHovered(id) {
  if (!PATHS.includes(id)) id = null;
  if (id === hoveredId) return;
  hoveredId = id;
  curRing.className = `world${id ? ` hov-${id}` : ''}`;
  if (id) {
    if (FLAME_COLORS[id]) { cur.classList.remove('gold'); setFlame(true, FLAME_COLORS[id]); }
    else { setFlame(false); cur.classList.add('gold'); }
    if (id !== lastChimedId) {
      SND.chime(CHIME_FREQ[id] || 440);
      lastChimedId = id;
    }
  } else {
    setFlame(false);
    cur.classList.remove('gold');
    lastChimedId = null;
  }
  const prompt = WORLD_PROMPTS[id || 'none'];
  const sequence = ++promptSequence;
  const promptElement = $('w-prompt');
  promptElement?.classList.add('swap');
  setTimeout(() => {
    if (sequence !== promptSequence) return;
    if ($('w-prompt-h')) $('w-prompt-h').textContent = prompt.h;
    if ($('w-prompt-p')) $('w-prompt-p').textContent = prompt.p;
    promptElement?.classList.remove('swap');
  }, reducedMotion.matches ? 0 : 180);
}

function chooseAt(clientX, clientY) {
  const id = pathAt(clientX, clientY);
  /* A touch has no preceding hover. Do not turn its first six moon taps into
     an accidental prompt/chime by synthesizing hover here. */
  if (id !== 'personal') setHovered(id);
  if (id) choosePath(id, clientX, clientY);
}

function choosePath(id, x = pointer.x, y = pointer.y) {
  if (!PATHS.includes(id)) return;
  setNearestObject(null);
  if (id === 'personal') return moonClicked(x, y);
  addRipple(x || innerWidth / 2, y || innerHeight / 2, RIPPLE_COLORS[id]);
  if (reducedMotion.matches || !camera || !renderActive) {
    opts.onPathChosen?.(id);
    return;
  }
  if (pathFlight) return;
  const target = POS[id].clone().add(new THREE.Vector3(0, id === 'viewer' ? 4 : 2.2, 0));
  const approach = camera.position.clone().sub(target);
  approach.y = Math.max(approach.y, 2.4);
  approach.setLength(id === 'viewer' ? 12 : 7.5);
  pathFlight = {
    id, progress: 0, duration: 0.72,
    from: camera.position.clone(),
    to: target.clone().add(approach),
    target,
  };
}

function moonClicked(x, y) {
  if (moonState !== 'idle') return;
  moonClicks += 1;
  if (moonClicks < MOON_CLICKS_TO_FALL) return;
  addRipple(x || innerWidth / 2, y || innerHeight / 2, RIPPLE_COLORS.personal);
  SND.chime(110, 0.35);
  setHovered(null);
  moonVelocity = 0;
  moonState = 'falling';
  if (reducedMotion.matches || !moonGroup) finishMoonFall();
}

function finishMoonFall() {
  if (moonGroup) moonGroup.position.y = -30;
  if (moonLight && moonGroup) moonLight.position.copy(moonGroup.position);
  if (moonHalo && moonGroup) moonHalo.position.copy(moonGroup.position);
  moonState = 'landed';
  SND.thud();
  clearTimeout(pathTimer);
  pathTimer = setTimeout(() => opts.onPathChosen?.('personal'), reducedMotion.matches ? 0 : 320);
}

export function resetMoon() {
  clearTimeout(pathTimer);
  pathTimer = 0;
  moonClicks = 0;
  moonVelocity = 0;
  moonState = 'idle';
  pathFlight = null;
  if (moonGroup) {
    moonGroup.position.copy(POS.personal);
    moonGroup.rotation.set(0, 0, 0);
  }
  hitProxies.personal?.position.copy(POS.personal);
  moonLight?.position.copy(POS.personal);
  moonHalo?.position.copy(POS.personal);
  $('moon-msg')?.classList.remove('show');
  $('moon-hint')?.classList.remove('show');
}

export function skipCinematic() {
  if (!camera) return;
  cinematicActive = false;
  cinematicProgress = 1;
  if (playerGroup) updatePlayerCamera(0, true);
  else {
    camera.position.copy(camHome);
    camera.lookAt(camFocus);
  }
  $('world-skip')?.classList.remove('show');
}

export function pauseWorld() {
  pauseRequested = true;
  if (!renderActive) {
    window.__worldRunning = false;
    SND.stopWorld();
    return;
  }
  renderActive = false;
  window.__worldRunning = false;
  cancelAnimationFrame(animationFrame);
  animationFrame = 0;
  setHovered(null);
  setNearestObject(null);
  SND.stopWorld();
  $('s-world')?.classList.add('world-paused');
}

export function resumeWorld() {
  pauseRequested = false;
  if (!ready || !webglAvailable || renderActive) return;
  renderActive = true;
  window.__worldRunning = true;
  lastFrameAt = performance.now();
  $('s-world')?.classList.remove('world-paused');
  setCursorPath('world');
  if (SND.enabled) SND.startWorld();
  animationFrame = requestAnimationFrame(animateWorld);
}

export function onReturnToWorld() {
  resetMoon();
  resumeWorld();
}

export function isWorldReady() { return ready; }

function movementAxis(positiveKeys, negativeKeys, positiveButton, negativeButton) {
  const positive = positiveKeys.some(key => moveKeys.has(key)) || moveButtons[positiveButton];
  const negative = negativeKeys.some(key => moveKeys.has(key)) || moveButtons[negativeButton];
  return Number(positive) - Number(negative);
}

function setNearestObject(id) {
  if (id === nearestId) return;
  nearestId = id;
  const interact = $('world-interact');
  if (!interact) return;
  interact.classList.toggle('show', Boolean(id));
  interact.dataset.path = id || '';
  if (!id) {
    interact.innerHTML = '<span>Nearby</span><strong>Press E to enter</strong>';
    return;
  }
  const meta = PATH_META[id];
  interact.innerHTML = `<span>${meta.title} is nearby</span><strong>Press E or click to enter</strong>`;
}

function updateNearestObject() {
  if (!playerGroup || pathFlight) return;
  let closest = null;
  let closestRatio = Infinity;
  PATHS.forEach(id => {
    if (!hitProxies[id]) return;
    let distance;
    if (id === 'recruiter' && birds.length) {
      distance = Math.min(...birds.map(bird => Math.hypot(
        playerGroup.position.x - bird.obj.position.x,
        playerGroup.position.z - bird.obj.position.z,
      )));
    } else {
      const dx = playerGroup.position.x - POS[id].x;
      const dz = playerGroup.position.z - POS[id].z;
      distance = Math.hypot(dx, dz);
    }
    const ratio = distance / INTERACTION_RADIUS[id];
    if (ratio <= 1 && ratio < closestRatio) {
      closest = id;
      closestRatio = ratio;
    }
  });
  setNearestObject(closest);
}

function updatePlayer(delta, motion) {
  if (!playerGroup || pathFlight) return;
  const forwardAxis = movementAxis(['w', 'arrowup'], ['s', 'arrowdown'], 'forward', 'back');
  const turnAxis = movementAxis(['d', 'arrowright'], ['a', 'arrowleft'], 'right', 'left');
  if (turnAxis) {
    cameraYaw -= turnAxis * delta * 2.15;
    playerHasMoved = true;
  }
  moveForward.set(-Math.sin(cameraYaw), 0, -Math.cos(cameraYaw));
  moveDesired.copy(moveForward).multiplyScalar(forwardAxis);
  const isMoving = moveDesired.lengthSq() > 0.001;
  if (isMoving) {
    playerHasMoved = true;
    moveDesired.multiplyScalar(forwardAxis > 0 ? 5.2 : 3.4);
    playerVelocity.lerp(moveDesired, Math.min(1, delta * 7));
    playerGroup.position.addScaledVector(playerVelocity, delta);
    playerGroup.position.x = THREE.MathUtils.clamp(playerGroup.position.x, -14, 14);
    playerGroup.position.z = THREE.MathUtils.clamp(playerGroup.position.z, -16, 12);
    playerBody.rotation.y = cameraYaw + Math.PI;
  } else {
    playerVelocity.multiplyScalar(Math.max(0, 1 - delta * 8));
  }
  playerGroup.position.y = groundHeightAt(playerGroup.position.x, playerGroup.position.z);
  const stride = motion && isMoving ? Math.sin(elapsed * 8) * 0.38 : 0;
  const limbs = playerBody.userData.limbs;
  limbs.leftLeg.rotation.x = stride;
  limbs.rightLeg.rotation.x = -stride;
  limbs.leftArm.rotation.x = -stride * 0.72;
  limbs.rightArm.rotation.x = stride * 0.72;
  playerBody.position.y = motion && isMoving ? Math.abs(Math.sin(elapsed * 8)) * 0.02 : 0;
  const stage = $('s-world');
  if (stage) {
    stage.dataset.playerX = playerGroup.position.x.toFixed(2);
    stage.dataset.playerZ = playerGroup.position.z.toFixed(2);
  }
  updateNearestObject();
}

function updatePlayerCamera(delta, snap = false) {
  if (!playerGroup || !camera) return;
  const distance = innerWidth < 760 ? 7 : 7.8;
  const horizontal = Math.cos(cameraPitch) * distance;
  cameraDesired.set(
    playerGroup.position.x + Math.sin(cameraYaw) * horizontal,
    playerGroup.position.y + 1.4 + Math.sin(cameraPitch) * distance,
    playerGroup.position.z + Math.cos(cameraYaw) * horizontal,
  );
  cameraLook.copy(playerGroup.position).addScaledVector(moveForward.set(-Math.sin(cameraYaw), 0, -Math.cos(cameraYaw)), 4.4);
  cameraLook.y += 1.25;
  camera.position.lerp(cameraDesired, snap ? 1 : Math.min(1, delta * 4));
  camera.lookAt(cameraLook);
}

function animateWorld(now) {
  if (!renderActive) return;
  const minimumFrameMs = reducedMotion.matches ? 80 : (lowPower ? 32 : 0);
  if (minimumFrameMs && now - lastFrameAt < minimumFrameMs) {
    animationFrame = requestAnimationFrame(animateWorld);
    return;
  }
  const delta = Math.min(Math.max((now - lastFrameAt) / 1000, 0), 0.05);
  lastFrameAt = now;
  elapsed += delta;
  const motion = !reducedMotion.matches;
  updatePlayer(delta, motion);
  if (cinematicActive) {
    cinematicProgress = Math.min(cinematicProgress + delta / 5, 1);
    const eased = 1 - Math.pow(1 - cinematicProgress, 3);
    camera.position.lerpVectors(cinematicFrom, camHome, eased);
    camera.lookAt(new THREE.Vector3().lerpVectors(cinematicFocusFrom, camFocus, eased));
    if (cinematicProgress >= 1) skipCinematic();
  } else if (pathFlight) {
    pathFlight.progress = Math.min(1, pathFlight.progress + delta / pathFlight.duration);
    const eased = 1 - Math.pow(1 - pathFlight.progress, 3);
    camera.position.lerpVectors(pathFlight.from, pathFlight.to, eased);
    camera.lookAt(pathFlight.target);
    if (pathFlight.progress >= 1) {
      const chosen = pathFlight.id;
      pathFlight = null;
      opts.onPathChosen?.(chosen);
    }
  } else {
    updatePlayerCamera(delta);
  }
  const shaderTime = motion ? elapsed : 0;
  if (scene.userData.starsMat) scene.userData.starsMat.uniforms.time.value = shaderTime;
  if (scene.userData.fireflyMat) scene.userData.fireflyMat.uniforms.time.value = shaderTime;
  if (scene.userData.grainPass) scene.userData.grainPass.uniforms.time.value = shaderTime * 8;
  if (motion) scene.fog.color.lerp(FOG_TARGETS[hoveredId || 'none'], 0.015);
  else scene.fog.color.copy(FOG_TARGETS[hoveredId || 'none']);

  if (objectGroups.viewer) {
    objectGroups.viewer.position.y = POS.viewer.y + (motion ? Math.sin(elapsed * 0.4) * 0.35 : 0);
    objectGroups.viewer.rotation.z = motion ? Math.sin(elapsed * 0.3) * 0.02 : 0;
    objectGroups.viewer.rotation.x = motion ? Math.sin(elapsed * 0.24 + 1) * 0.015 : 0;
    if (hitProxies.viewer) hitProxies.viewer.position.y = objectGroups.viewer.position.y;
  }
  if (objectGroups.friend) {
    objectGroups.friend.position.y = POS.friend.y + (motion ? Math.sin(elapsed * 0.65) * (hoveredId === 'friend' ? 0.1 : 0.03) : 0);
    if (hitProxies.friend) hitProxies.friend.position.y = objectGroups.friend.position.y;
  }
  if (motion) {
    grassBlades.forEach(blade => { blade.rotation.z = Math.sin(elapsed * 1.4 + blade.userData.phase) * 0.12; });
    clouds.forEach(cloud => {
      cloud.position.x += cloud.userData.drift * delta;
      if (cloud.position.x > 45) cloud.position.x = -45;
    });
  }
  birds.forEach(bird => {
    if (motion) bird.mixer.update(delta);
    const angle = bird.angle + (motion ? elapsed * bird.speed : 0);
    bird.obj.position.set(
      POS.recruiter.x + Math.cos(angle) * bird.radius,
      POS.recruiter.y + bird.height + (motion ? Math.sin(elapsed * 0.9 + bird.angle) * 0.6 : 0),
      POS.recruiter.z + Math.sin(angle) * bird.radius * 0.8,
    );
    bird.obj.rotation.y = -angle + Math.PI;
  });
  Object.entries(objectLights).forEach(([id, light]) => {
    const active = hoveredId === id;
    const targetIntensity = active ? (id === 'recruiter' ? 3.6 : 3.1) : 0.48;
    light.intensity += (targetIntensity - light.intensity) * (motion ? 0.075 : 1);
    if (id !== 'recruiter') objectGroups[id]?.traverse(node => {
      node.userData.hoverMaterials?.forEach(material => {
        material.emissive.lerp(HOVER_COLORS[id].clone().multiplyScalar(active ? 0.18 : 0), motion ? 0.075 : 1);
      });
    });
    const ring = rings[id];
    if (ring) {
      const target = active ? 0.55 + (motion ? Math.sin(elapsed * 4) * 0.2 : 0) : 0;
      ring.material.opacity += (target - ring.material.opacity) * (motion ? 0.08 : 1);
    }
  });
  birds.forEach(bird => bird.obj.traverse(node => {
    if (!node.isMesh) return;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    materials.forEach(material => material?.emissive?.lerp(
      HOVER_COLORS.recruiter.clone().multiplyScalar(hoveredId === 'recruiter' ? 0.3 : 0), motion ? 0.075 : 1));
  }));
  Object.values(torches).forEach(item => {
    item.light.intensity = motion ? Math.max(0,
      item.base + Math.sin(elapsed * item.frequency + item.phase) * 0.04 +
      Math.sin(elapsed * item.frequency * 2.7 + item.phase * 1.3) * 0.02) : item.base;
  });
  Object.entries(auras).forEach(([id, aura]) => {
    aura.mat.uniforms.time.value = shaderTime;
    const target = hoveredId === id ? 0.45 : 0.07;
    aura.mat.uniforms.opacity.value += (target - aura.mat.uniforms.opacity.value) * (motion ? 0.05 : 1);
  });
  if (moonState === 'falling' && moonGroup) {
    moonVelocity += 18 * delta;
    moonGroup.position.y -= moonVelocity * delta;
    moonGroup.rotation.x += 0.9 * delta;
    moonGroup.rotation.z += 0.45 * delta;
    moonLight?.position.copy(moonGroup.position);
    moonHalo?.position.copy(moonGroup.position);
    hitProxies.personal?.position.copy(moonGroup.position);
    if (moonGroup.position.y < -22) finishMoonFall();
  }
  updateLabels();
  if (composer) composer.render();
  else renderer.render(scene, camera);
  animationFrame = requestAnimationFrame(animateWorld);
}

function updateLabels() {
  Object.keys(LABELS).forEach(id => {
    const element = labelEls[id];
    const point = labels3D[id];
    if (!element || !point) return;
    const vector = point.clone().project(camera);
    element.style.left = `${(vector.x * 0.5 + 0.5) * innerWidth}px`;
    element.style.top = `${(vector.y * -0.5 + 0.5) * innerHeight}px`;
    const onScreen = vector.z > -1 && vector.z < 1 && Math.abs(vector.x) < 1.15 && Math.abs(vector.y) < 1.15;
    element.style.opacity = onScreen ? (hoveredId === id || nearestId === id ? '1' : '.58') : '0';
    element.style.pointerEvents = onScreen ? 'auto' : 'none';
    element.tabIndex = onScreen ? 0 : -1;
    element.classList.toggle('is-near', nearestId === id);
  });
}

function onResize() {
  if (!camera || !renderer) return;
  camera.aspect = innerWidth / Math.max(innerHeight, 1);
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, lowPower ? 1.25 : 2));
  renderer.setSize(innerWidth, innerHeight);
  composer?.setSize(innerWidth, innerHeight);
  applyResponsiveLayout();
}
