import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRButton } from 'three/addons/webxr/VRButton.js';

const SHIP_MODEL_PATH = new URL('../assets/hms_london.glb', import.meta.url).href;
const ISLAND_MODEL_PATH = new URL('../assets/island_coast.glb', import.meta.url).href;
const OCEAN_AUDIO_PATH = new URL('../assets/audio/ocean-ambience.mp3', import.meta.url).href;
const BOMBARDMENT_AUDIO_PATH = new URL('../assets/audio/shore-bombardment.mp3', import.meta.url).href;
const SHIP_DECK_Y = 5.02;
const WATER_LEVEL = -3.7;
const PLAYER_EYE_HEIGHT = 0.92;
const PLAYER_COLLISION_RADIUS = 0.3;
const ENEMY_WATER_HEIGHT = WATER_LEVEL + 0.42;
const MAX_HULL_INTEGRITY = 100;
const PLAYER_FIRE_RANGE = 430;
const PLAYER_FIRE_COOLDOWN = 0.22;
const ENEMY_POOL_SIZE = 20;
const WALK_BOUNDS = {
  minX: -6.2,
  maxX: 6.2,
  minZ: -55,
  maxZ: 54,
};
const FLOOR_CHECK_HEIGHT = 8;
const FLOOR_CHECK_DEPTH = 12;
const FLOOR_SURFACE_TOLERANCE = 0.9;
const WALL_CHECK_HEIGHT = 1.02;
const WALL_CHECK_UP_DOT_LIMIT = 0.42;
const WALL_PATH_HEIGHTS = [0.34, 0.78];
const WALL_CLEARANCE_HEIGHTS = [0.32, 0.72];
const WALL_CLEARANCE_DIRECTIONS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

const state = {
  keys: new Set(),
  pointerDown: false,
  lastPointer: null,
  pointerTravel: 0,
  pointerDownAt: 0,
  yaw: 0.42,
  pitch: 0.08,
  binoculars: false,
  fireQueued: false,
  lastUpdateSeconds: 0,
  shipLoaded: false,
  shipLoadError: null,
  islandLoaded: false,
  islandLoadError: null,
  audioUnlocked: false,
  ambienceLoaded: false,
  ambienceStarted: false,
  bombardmentLoaded: false,
  audioMuted: false,
  audioError: null,
  timers: {
    shoreFlash: 0.2,
    skyBurst: 0.8,
    tracer: 0.45,
  },
};

const up = new THREE.Vector3(0, 1, 0);
const desktopLook = new THREE.Euler(0, 0, 0, 'YXZ');
const desktopForward = new THREE.Vector3();
const desktopRight = new THREE.Vector3();
const xrForward = new THREE.Vector3();
const xrRight = new THREE.Vector3();
const localMove = new THREE.Vector3();
const tempQuaternion = new THREE.Quaternion();
const tempVector = new THREE.Vector3();
const tempVectorB = new THREE.Vector3();
const tempVectorC = new THREE.Vector3();
const tempVectorD = new THREE.Vector3();
const tempVectorE = new THREE.Vector3();
const tempVectorF = new THREE.Vector3();
const tempVectorG = new THREE.Vector3();
const tempVectorH = new THREE.Vector3();
const shipMotionState = {
  roll: 0,
  pitch: 0,
  heave: 0,
  energy: 0,
};
const combatState = {
  phase: 'playing',
  wave: 1,
  hull: MAX_HULL_INTEGRITY,
  score: 0,
  kills: 0,
  escaped: 0,
  shotsFired: 0,
  shotsHit: 0,
  shotCooldown: 0,
  spawnTimer: 1.2,
  intermissionTimer: 0,
  bannerTimer: 0,
  bannerText: '',
  waveSpawned: 0,
  waveQuota: 0,
  xrTriggerLatched: false,
};

function makeGlowTexture(stops) {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [offset, color] of stops) {
    gradient.addColorStop(offset, color);
  }
  context.clearRect(0, 0, size, size);
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function sampleOceanHeight(nx, ny) {
  const ridgeA = Math.sin((nx * 1.0 + ny * 0.18) * Math.PI * 2);
  const ridgeB = Math.cos((ny * 1.34 - nx * 0.46) * Math.PI * 2);
  const chopA = Math.sin((nx * 2.8 + ny * 1.9) * Math.PI * 2);
  const chopB = Math.cos((nx * 4.4 - ny * 3.2) * Math.PI * 2);
  const ripple = Math.sin((nx * 7.6 + ny * 6.2) * Math.PI * 2) * Math.cos((ny * 8.4 - nx * 5.8) * Math.PI * 2);
  return ridgeA * 0.34 + ridgeB * 0.26 + chopA * 0.18 + chopB * 0.14 + ripple * 0.08;
}

function makeOceanSurfaceTextures() {
  const size = 256;
  const heights = new Float32Array(size * size);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const nx = x / size;
      const ny = y / size;
      heights[y * size + x] = sampleOceanHeight(nx, ny);
    }
  }

  const heightCanvas = document.createElement('canvas');
  heightCanvas.width = size;
  heightCanvas.height = size;
  const heightContext = heightCanvas.getContext('2d');
  const heightImage = heightContext.createImageData(size, size);

  const normalCanvas = document.createElement('canvas');
  normalCanvas.width = size;
  normalCanvas.height = size;
  const normalContext = normalCanvas.getContext('2d');
  const normalImage = normalContext.createImageData(size, size);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const left = heights[y * size + ((x - 1 + size) % size)];
      const right = heights[y * size + ((x + 1) % size)];
      const down = heights[((y - 1 + size) % size) * size + x];
      const upSample = heights[((y + 1) % size) * size + x];
      const center = heights[y * size + x];
      const heightShade = Math.round(128 + center * 98);

      const index = (y * size + x) * 4;
      heightImage.data[index] = heightShade;
      heightImage.data[index + 1] = heightShade;
      heightImage.data[index + 2] = heightShade;
      heightImage.data[index + 3] = 255;

      const dx = left - right;
      const dy = down - upSample;
      const normal = new THREE.Vector3(dx * 4.6, dy * 4.6, 1).normalize();
      normalImage.data[index] = Math.round((normal.x * 0.5 + 0.5) * 255);
      normalImage.data[index + 1] = Math.round((normal.y * 0.5 + 0.5) * 255);
      normalImage.data[index + 2] = Math.round((normal.z * 0.5 + 0.5) * 255);
      normalImage.data[index + 3] = 255;
    }
  }

  heightContext.putImageData(heightImage, 0, 0);
  normalContext.putImageData(normalImage, 0, 0);

  const heightTexture = new THREE.CanvasTexture(heightCanvas);
  heightTexture.wrapS = THREE.RepeatWrapping;
  heightTexture.wrapT = THREE.RepeatWrapping;
  heightTexture.repeat.set(10, 9);
  heightTexture.colorSpace = THREE.NoColorSpace;
  heightTexture.needsUpdate = true;

  const normalTexture = new THREE.CanvasTexture(normalCanvas);
  normalTexture.wrapS = THREE.RepeatWrapping;
  normalTexture.wrapT = THREE.RepeatWrapping;
  normalTexture.repeat.set(13, 11);
  normalTexture.colorSpace = THREE.NoColorSpace;
  normalTexture.needsUpdate = true;

  return { heightTexture, normalTexture };
}

const moonDiscTexture = makeGlowTexture([
  [0, 'rgba(255,255,255,1)'],
  [0.32, 'rgba(255,255,255,0.98)'],
  [0.58, 'rgba(240,245,255,0.92)'],
  [0.8, 'rgba(176,198,255,0.18)'],
  [1, 'rgba(0,0,0,0)'],
]);

const moonHaloTexture = makeGlowTexture([
  [0, 'rgba(255,255,255,0.24)'],
  [0.2, 'rgba(208,222,255,0.18)'],
  [0.55, 'rgba(124,157,255,0.08)'],
  [1, 'rgba(0,0,0,0)'],
]);

const warmFlashTexture = makeGlowTexture([
  [0, 'rgba(255,255,255,1)'],
  [0.14, 'rgba(255,242,214,0.96)'],
  [0.32, 'rgba(255,188,112,0.78)'],
  [0.6, 'rgba(255,128,64,0.18)'],
  [1, 'rgba(0,0,0,0)'],
]);

const coolFlashTexture = makeGlowTexture([
  [0, 'rgba(255,255,255,1)'],
  [0.18, 'rgba(238,245,255,0.94)'],
  [0.42, 'rgba(176,205,255,0.46)'],
  [0.7, 'rgba(94,132,255,0.12)'],
  [1, 'rgba(0,0,0,0)'],
]);

const { heightTexture: oceanHeightTexture, normalTexture: oceanNormalTexture } = makeOceanSurfaceTextures();

const clock = new THREE.Clock();
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x040811);
scene.fog = new THREE.FogExp2(0x07111a, 0.0042);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 1500);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ReinhardToneMapping;
renderer.toneMappingExposure = 1.84;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.xr.enabled = true;
renderer.domElement.style.touchAction = 'none';
document.body.appendChild(renderer.domElement);
document.body.appendChild(VRButton.createButton(renderer));

const shipMotionGroup = new THREE.Group();
scene.add(shipMotionGroup);

const shipVisualGroup = new THREE.Group();
shipMotionGroup.add(shipVisualGroup);

const shipCollisionRoot = new THREE.Group();
shipMotionGroup.add(shipCollisionRoot);

const player = new THREE.Group();
player.position.set(-4.4, 0, 46);
shipMotionGroup.add(player);

camera.position.set(0, PLAYER_EYE_HEIGHT, 0);
player.add(camera);

const audioListener = new THREE.AudioListener();
camera.add(audioListener);

const muteButton = document.querySelector('.hud__mute');
const hudWaveValue = document.querySelector('[data-hud-wave]');
const hudScoreValue = document.querySelector('[data-hud-score]');
const hudContactsValue = document.querySelector('[data-hud-contacts]');
const hudHullValue = document.querySelector('[data-hud-hull]');
const hudHullBar = document.querySelector('[data-hud-hull-bar]');
const hudStatus = document.querySelector('[data-hud-status]');
const hudBanner = document.querySelector('[data-hud-banner]');
const ambienceSound = new THREE.Audio(audioListener);
const audioLoader = new THREE.AudioLoader();
const AMBIENCE_VOLUME = 0.055;
const BOMBARDMENT_MASTER_GAIN = 0.32;
const audioState = {
  ambienceBuffer: null,
  bombardmentBuffer: null,
  bombardmentMaster: audioListener.context.createGain(),
};
audioState.bombardmentMaster.gain.value = BOMBARDMENT_MASTER_GAIN;
audioState.bombardmentMaster.connect(audioListener.getInput());

const playerMuzzleFlash = new THREE.PointLight(0xffd4a1, 0, 16, 2);
playerMuzzleFlash.position.set(0.24, -0.14, -0.72);
camera.add(playerMuzzleFlash);

const shipCollisionMeshes = [];
const collisionRaycaster = new THREE.Raycaster();
const collisionHits = [];
const shipCollisionMaterial = new THREE.MeshBasicMaterial({
  color: 0x000000,
  side: THREE.DoubleSide,
  transparent: true,
  opacity: 0,
  depthWrite: false,
});
shipCollisionMaterial.colorWrite = false;

function applyAudioMix() {
  ambienceSound.setVolume(state.audioMuted ? 0 : AMBIENCE_VOLUME);
  audioState.bombardmentMaster.gain.value = state.audioMuted ? 0 : BOMBARDMENT_MASTER_GAIN;
}

function updateMuteButton() {
  if (!muteButton) {
    return;
  }
  muteButton.textContent = state.audioMuted ? 'Unmute' : 'Mute';
  muteButton.setAttribute('aria-pressed', state.audioMuted ? 'true' : 'false');
}

function toggleMute() {
  state.audioMuted = !state.audioMuted;
  applyAudioMix();
  updateMuteButton();
}

function showBanner(text = '', duration = 0) {
  combatState.bannerText = text;
  combatState.bannerTimer = duration;
  if (!hudBanner) {
    return;
  }
  hudBanner.textContent = text;
  hudBanner.hidden = !text;
}

function countActiveEnemies() {
  return enemies.filter((enemy) => enemy.active).length;
}

function syncHud() {
  const activeContacts = countActiveEnemies();
  const hullRatio = THREE.MathUtils.clamp(combatState.hull / MAX_HULL_INTEGRITY, 0, 1);
  const accuracy = combatState.shotsFired > 0 ? Math.round((combatState.shotsHit / combatState.shotsFired) * 100) : 0;

  hudWaveValue.textContent = String(combatState.wave);
  hudScoreValue.textContent = String(combatState.score);
  hudContactsValue.textContent = String(activeContacts);
  hudHullValue.textContent = `${Math.ceil(combatState.hull)}%`;
  hudHullBar.style.width = `${hullRatio * 100}%`;

  if (combatState.phase === 'gameover') {
    hudStatus.textContent = `Hull compromised. Final score ${combatState.score}. Accuracy ${accuracy}%. Press R to restart.`;
  } else if (combatState.phase === 'intermission') {
    hudStatus.textContent = `Wave ${combatState.wave} cleared. Shore batteries regrouping. Accuracy ${accuracy}%.`;
  } else {
    const remainingToSpawn = Math.max(combatState.waveQuota - combatState.waveSpawned, 0);
    hudStatus.textContent = `Wave ${combatState.wave}: ${activeContacts} boats in the water, ${remainingToSpawn} still launching. Accuracy ${accuracy}%.`;
  }
}

function tryStartAmbience() {
  if (!state.audioUnlocked || !state.ambienceLoaded || state.ambienceStarted || ambienceSound.isPlaying) {
    return;
  }
  ambienceSound.setLoop(true);
  applyAudioMix();
  ambienceSound.play();
  state.ambienceStarted = true;
}

async function unlockAudio() {
  try {
    await audioListener.context.resume();
    state.audioUnlocked = audioListener.context.state === 'running';
    tryStartAmbience();
  } catch (error) {
    console.error(error);
    state.audioError = 'Could not start audio.';
  }
}

function handleUserAudioUnlock() {
  if (state.audioUnlocked && state.ambienceStarted) {
    return;
  }
  void unlockAudio();
}

muteButton?.addEventListener('click', () => {
  toggleMute();
});
updateMuteButton();

function playBombardmentThud() {
  if (!state.audioUnlocked || !audioState.bombardmentBuffer) {
    return;
  }
  const source = audioListener.context.createBufferSource();
  const gain = audioListener.context.createGain();
  source.buffer = audioState.bombardmentBuffer;
  source.playbackRate.value = 0.94 + Math.random() * 0.1;
  gain.gain.value = 0.16 + Math.random() * 0.04;
  source.connect(gain);
  gain.connect(audioState.bombardmentMaster);
  source.start(0);
  source.onended = () => {
    source.disconnect();
    gain.disconnect();
  };
}

audioLoader.load(
  OCEAN_AUDIO_PATH,
  (buffer) => {
    audioState.ambienceBuffer = buffer;
    ambienceSound.setBuffer(buffer);
    state.ambienceLoaded = true;
    tryStartAmbience();
  },
  undefined,
  (error) => {
    console.error(error);
    state.audioError = 'Could not load ocean ambience.';
  },
);

audioLoader.load(
  BOMBARDMENT_AUDIO_PATH,
  (buffer) => {
    audioState.bombardmentBuffer = buffer;
    state.bombardmentLoaded = true;
  },
  undefined,
  (error) => {
    console.error(error);
    state.audioError = 'Could not load bombardment audio.';
  },
);

const nightAmbient = new THREE.AmbientLight(0x0a1018, 0.028);
scene.add(nightAmbient);

const skyFill = new THREE.HemisphereLight(0x2a4164, 0x03060b, 0.24);
scene.add(skyFill);

const moonlight = new THREE.DirectionalLight(0xe4ecff, 1.72);
moonlight.position.set(-110, 132, -250);
moonlight.castShadow = true;
moonlight.shadow.mapSize.set(1536, 1536);
moonlight.shadow.camera.left = -85;
moonlight.shadow.camera.right = 85;
moonlight.shadow.camera.top = 85;
moonlight.shadow.camera.bottom = -85;
moonlight.shadow.camera.near = 1;
moonlight.shadow.camera.far = 320;
moonlight.shadow.bias = -0.00018;
moonlight.target.position.set(0, 0, 0);
scene.add(moonlight);
scene.add(moonlight.target);

const bridgePractical = new THREE.PointLight(0x9cb7e6, 34, 78, 2);
bridgePractical.position.set(-1.8, 14.5, 17);
shipMotionGroup.add(bridgePractical);

const deckPractical = new THREE.SpotLight(0xb9cfff, 58, 128, 0.62, 0.72, 2);
deckPractical.position.set(0.8, 19, 18);
deckPractical.target.position.set(0, 3.4, 7);
shipMotionGroup.add(deckPractical);
shipMotionGroup.add(deckPractical.target);

const sternPractical = new THREE.PointLight(0x6f88b5, 18, 72, 2);
sternPractical.position.set(-0.6, 11.5, -11);
shipMotionGroup.add(sternPractical);

const moon = new THREE.Sprite(
  new THREE.SpriteMaterial({
    map: moonDiscTexture,
    color: 0xf5f8ff,
    transparent: true,
    opacity: 0.96,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  }),
);
moon.scale.set(22, 22, 1);
moon.position.copy(moonlight.position);
scene.add(moon);

const moonDirectionXZ = new THREE.Vector2(moon.position.x, moon.position.z).normalize();
const moonTrackCenter = moonDirectionXZ.clone().multiplyScalar(205);

const moonHalo = new THREE.Sprite(
  new THREE.SpriteMaterial({
    map: moonHaloTexture,
    color: 0x95b4ff,
    transparent: true,
    opacity: 0.34,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  }),
);
moonHalo.scale.set(52, 52, 1);
moonHalo.position.copy(moon.position);
scene.add(moonHalo);

const oceanGeometry = new THREE.PlaneGeometry(1600, 1600, 132, 132);
const oceanBasePositions = Float32Array.from(oceanGeometry.attributes.position.array);
const oceanMaterial = new THREE.MeshStandardMaterial({
  color: 0x07131d,
  roughness: 0.9,
  metalness: 0,
});
oceanMaterial.normalMap = oceanNormalTexture;
oceanMaterial.normalScale.set(1.65, 1.25);
const oceanShaderState = {
  uniforms: {
    time: { value: 0 },
    moonPosition: { value: moon.position.clone() },
    moonTrackCenter: { value: moonTrackCenter.clone() },
    islandOrigin: { value: new THREE.Vector2(0, 0) },
    shipMotion: { value: new THREE.Vector4(0, 0, 0, 0) },
    detailHeightMap: { value: oceanHeightTexture },
  },
  shader: null,
};
oceanMaterial.onBeforeCompile = (shader) => {
  oceanShaderState.shader = shader;
  shader.uniforms.uOceanTime = oceanShaderState.uniforms.time;
  shader.uniforms.uMoonPosition = oceanShaderState.uniforms.moonPosition;
  shader.uniforms.uMoonTrackCenter = oceanShaderState.uniforms.moonTrackCenter;
  shader.uniforms.uIslandOrigin = oceanShaderState.uniforms.islandOrigin;
  shader.uniforms.uShipMotion = oceanShaderState.uniforms.shipMotion;
  shader.uniforms.uDetailHeightMap = oceanShaderState.uniforms.detailHeightMap;
  shader.vertexShader = shader.vertexShader
    .replace(
      '#include <common>',
      `#include <common>
varying vec3 vOceanWorldPosition;
varying vec3 vOceanWorldNormal;
varying float vWaveHeight;
`,
    )
    .replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
vWaveHeight = transformed.z;
`,
    )
    .replace(
      '#include <normal_vertex>',
      `#include <normal_vertex>
vOceanWorldNormal = normalize( mat3( modelMatrix ) * transformedNormal );
`,
    )
    .replace(
      '#include <worldpos_vertex>',
      `#include <worldpos_vertex>
vOceanWorldPosition = worldPosition.xyz;
`,
    );
  shader.fragmentShader = shader.fragmentShader
    .replace(
      '#include <common>',
      `#include <common>
uniform float uOceanTime;
uniform vec3 uMoonPosition;
uniform vec2 uMoonTrackCenter;
uniform vec2 uIslandOrigin;
uniform vec4 uShipMotion;
uniform sampler2D uDetailHeightMap;
varying vec3 vOceanWorldPosition;
varying vec3 vOceanWorldNormal;
varying float vWaveHeight;

float oceanSat( float x ) {
  return clamp( x, 0.0, 1.0 );
}

vec4 getOceanNoise( vec2 uv ) {
  vec2 uv0 = uv / 240.0 + vec2( uOceanTime * 0.012, uOceanTime * 0.008 );
  vec2 uv1 = uv / 132.0 - vec2( uOceanTime * 0.014, -uOceanTime * 0.01 );
  vec2 uv2 = uv / 58.0 + vec2( -uOceanTime * 0.029, uOceanTime * 0.023 );
  vec2 uv3 = uv / 24.0 - vec2( uOceanTime * 0.061, uOceanTime * 0.042 );
  return texture2D( uDetailHeightMap, uv0 ) +
    texture2D( uDetailHeightMap, uv1 ) +
    texture2D( uDetailHeightMap, uv2 ) +
    texture2D( uDetailHeightMap, uv3 );
}
`,
    )
    .replace(
      '#include <dithering_fragment>',
      `
vec3 oceanViewDir = normalize( cameraPosition - vOceanWorldPosition );
vec3 oceanNormal = normalize( vOceanWorldNormal );
vec2 oceanXZ = vOceanWorldPosition.xz;
vec4 detailNoise = getOceanNoise( oceanXZ );
vec2 detailFlow = vec2( detailNoise.r - detailNoise.g, detailNoise.b - detailNoise.a );
vec3 detailNormal = normalize( vec3( detailFlow.x * 2.1, 1.0, detailFlow.y * 2.1 ) );
oceanNormal = normalize( mix( oceanNormal, detailNormal, 0.42 ) );
float fresnel = pow( 1.0 - oceanSat( dot( oceanNormal, oceanViewDir ) ), 4.3 );
float broadBands = 0.5 + 0.5 * sin( oceanXZ.x * 0.0065 - uOceanTime * 0.34 + oceanXZ.y * 0.0048 );
float microRipples = 0.5 + 0.5 * sin( oceanXZ.x * 0.082 + uOceanTime * 5.4 + detailNoise.r * 3.2 ) * sin( oceanXZ.y * 0.071 - uOceanTime * 4.8 + detailNoise.b * 3.2 );
float waveShadow = oceanSat( 0.5 + vWaveHeight * 0.36 );
float swellLines = 0.5 + 0.5 * sin( oceanXZ.y * 0.044 - uOceanTime * 1.18 + oceanXZ.x * 0.008 + detailNoise.r * 2.0 );
float crossLines = 0.5 + 0.5 * sin( oceanXZ.x * 0.058 + uOceanTime * 1.06 + detailNoise.b * 2.2 );
float waveBands = mix( swellLines, crossLines, 0.34 );
float crest = smoothstep( 0.54, 0.94, waveShadow * 0.65 + microRipples * 0.5 + detailNoise.r * 0.22 );

vec2 moonAxis = normalize( uMoonPosition.xz );
vec2 moonNormal = vec2( -moonAxis.y, moonAxis.x );
float stripeDistance = abs( dot( oceanXZ - uMoonTrackCenter, moonNormal ) );
float stripeFalloff = 1.0 - oceanSat( length( oceanXZ - uMoonTrackCenter ) / 390.0 );
float moonStripe = pow( 1.0 - oceanSat( stripeDistance / 15.0 ), 5.8 ) * stripeFalloff;
float shimmer = 0.5 + 0.5 * sin( oceanXZ.x * 0.025 + uOceanTime * 1.8 + detailNoise.r * 4.0 ) * sin( oceanXZ.y * 0.018 - uOceanTime * 1.5 + detailNoise.b * 4.0 );
float moonBreakup = 0.28 + 0.72 * microRipples * ( 0.65 + 0.35 * waveShadow ) * ( 0.8 + detailNoise.r * 0.22 );
moonStripe *= ( 0.06 + 0.2 * fresnel ) * shimmer * moonBreakup;

vec2 islandLocal = oceanXZ - uIslandOrigin;
float shorelineBand = smoothstep( 176.0, 126.0, islandLocal.x ) * ( 1.0 - smoothstep( 82.0, 126.0, abs( islandLocal.y ) ) );
float foamPulse = 0.5 + 0.5 * sin( uOceanTime * 3.2 + islandLocal.y * 0.08 + islandLocal.x * 0.03 );
float shorelineFoam = shorelineBand * ( 0.16 + 0.38 * foamPulse );

float nearHull = exp( -pow( oceanXZ.x / 23.0, 2.0 ) - pow( oceanXZ.y / 138.0, 2.0 ) );
float shipEnergy = oceanSat( uShipMotion.w );
float shipSway = 0.5 + 0.5 * sin( oceanXZ.y * 0.12 - uOceanTime * 2.4 + uShipMotion.x * 46.0 + uShipMotion.y * 58.0 + detailNoise.g * 3.0 );
float hullWake = nearHull * shipEnergy * shipSway * ( 0.8 + crest * 0.45 );
float hullGlow = smoothstep( 110.0, 8.0, length( oceanXZ ) ) * fresnel;
float distantFade = oceanSat( length( oceanXZ ) / 780.0 );

gl_FragColor.rgb = mix( gl_FragColor.rgb, vec3( 0.014, 0.04, 0.055 ), 0.56 );
gl_FragColor.rgb *= 0.8 + 0.13 * broadBands;
gl_FragColor.rgb *= 0.88 + 0.12 * waveShadow;
gl_FragColor.rgb *= 0.84 + 0.16 * waveBands;
gl_FragColor.rgb += fresnel * vec3( 0.014, 0.032, 0.054 );
gl_FragColor.rgb += crest * vec3( 0.018, 0.03, 0.038 );
gl_FragColor.rgb += moonStripe * vec3( 0.07, 0.1, 0.15 );
gl_FragColor.rgb += shorelineFoam * vec3( 0.065, 0.088, 0.1 );
gl_FragColor.rgb += hullWake * vec3( 0.03, 0.048, 0.058 );
gl_FragColor.rgb += hullGlow * vec3( 0.016, 0.032, 0.05 );
gl_FragColor.rgb += microRipples * vec3( 0.003, 0.006, 0.009 );
gl_FragColor.rgb = mix( gl_FragColor.rgb, vec3( 0.04, 0.06, 0.078 ), distantFade * 0.08 );

#include <dithering_fragment>
`,
    );
};
oceanMaterial.customProgramCacheKey = () => 'battlewatch-ocean-v4';
const ocean = new THREE.Mesh(oceanGeometry, oceanMaterial);
ocean.rotation.x = -Math.PI / 2;
ocean.position.y = WATER_LEVEL;
ocean.receiveShadow = true;
scene.add(ocean);

const starGeometry = new THREE.BufferGeometry();
const starCount = 1200;
const starPositions = new Float32Array(starCount * 3);
for (let i = 0; i < starCount; i += 1) {
  const radius = 320 + Math.random() * 680;
  const theta = Math.random() * Math.PI * 2;
  const phi = Math.random() * Math.PI * 0.48;
  starPositions[i * 3] = Math.cos(theta) * Math.sin(phi) * radius;
  starPositions[i * 3 + 1] = 120 + Math.cos(phi) * radius * 0.26;
  starPositions[i * 3 + 2] = Math.sin(theta) * Math.sin(phi) * radius;
}
starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
const stars = new THREE.Points(
  starGeometry,
  new THREE.PointsMaterial({ color: 0xe9efff, size: 1.15, sizeAttenuation: true }),
);
scene.add(stars);

const islandRoot = new THREE.Group();
islandRoot.position.set(-176, -3.2, -34);
scene.add(islandRoot);
oceanShaderState.uniforms.islandOrigin.value.set(islandRoot.position.x, islandRoot.position.z);
const islandFallbackGroup = new THREE.Group();
const islandVisualGroup = new THREE.Group();
islandRoot.add(islandFallbackGroup);
islandRoot.add(islandVisualGroup);

const islandBaseMaterial = new THREE.MeshStandardMaterial({
  color: 0x1d241e,
  roughness: 0.98,
  metalness: 0.02,
});
const islandTopMaterial = new THREE.MeshStandardMaterial({
  color: 0x40503a,
  roughness: 1,
  metalness: 0,
});

function islandHeightAt(localX, localZ) {
  const coastline = THREE.MathUtils.smoothstep(160 - localX, 0, 135);
  const ridgeA = 17 * Math.exp(-((localX + 20) ** 2) / (2 * 85 ** 2));
  const ridgeB = 10 * Math.exp(-((localX - 88) ** 2) / (2 * 50 ** 2));
  const undulation = Math.sin((localX + localZ) * 0.055) * 2.3 + Math.cos(localZ * 0.075) * 1.8;
  const shorelineShelf = (1 - coastline) * 8.5;
  return Math.max(2.2, shorelineShelf + ridgeA + ridgeB + undulation);
}

function createIsland() {
  const terrainGeometry = new THREE.PlaneGeometry(330, 220, 54, 30);
  const position = terrainGeometry.attributes.position;
  for (let i = 0; i < position.count; i += 1) {
    const localX = position.getX(i);
    const localZ = position.getY(i);
    position.setZ(i, islandHeightAt(localX, localZ));
  }
  terrainGeometry.computeVertexNormals();

  const islandTop = new THREE.Mesh(terrainGeometry, islandTopMaterial);
  islandTop.rotation.x = -Math.PI / 2;
  islandTop.receiveShadow = true;
  islandTop.castShadow = true;
  islandFallbackGroup.add(islandTop);

  const islandBase = new THREE.Mesh(new THREE.BoxGeometry(312, 16, 200), islandBaseMaterial);
  islandBase.position.set(0, -10, 0);
  islandBase.receiveShadow = true;
  islandBase.castShadow = true;
  islandFallbackGroup.add(islandBase);
}

createIsland();
islandFallbackGroup.visible = false;

const coastSearchlight = new THREE.SpotLight(0xb7d0ff, 170, 430, 0.22, 0.42, 2);
coastSearchlight.position.set(islandRoot.position.x + 28, islandRoot.position.y + 26, islandRoot.position.z + 18);
coastSearchlight.target.position.set(-20, 18, -10);
scene.add(coastSearchlight);
scene.add(coastSearchlight.target);

const shipSearchlightBeam = new THREE.Mesh(
  new THREE.CylinderGeometry(0.35, 4.6, 42, 24, 1, true),
  new THREE.MeshBasicMaterial({
    color: 0xa8c2ff,
    transparent: true,
    opacity: 0.08,
    side: THREE.DoubleSide,
    depthWrite: false,
  }),
);
shipSearchlightBeam.rotation.x = Math.PI / 2;
shipSearchlightBeam.position.set(-2.2, 6.8, -4);
shipMotionGroup.add(shipSearchlightBeam);

const shipSearchlight = new THREE.SpotLight(0xcfe1ff, 220, 320, 0.16, 0.54, 2);
shipSearchlight.position.set(-2.2, 7.1, -3.5);
shipSearchlight.target.position.set(islandRoot.position.x + 42, islandRoot.position.y + 22, islandRoot.position.z - 16);
shipMotionGroup.add(shipSearchlight);
scene.add(shipSearchlight.target);

const shoreBatteryCoords = [
  [-118, -70],
  [-86, -22],
  [-48, 44],
  [18, -12],
  [58, 66],
];

function getIslandWorldPoint(localX, localZ, heightOffset = 0) {
  return new THREE.Vector3(
    islandRoot.position.x + localX,
    islandRoot.position.y + islandHeightAt(localX, localZ) + heightOffset,
    islandRoot.position.z + localZ,
  );
}

function createFlashState(color, distance) {
  const core = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: warmFlashTexture,
      color,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  core.visible = false;
  core.scale.set(1, 1, 1);
  scene.add(core);

  const halo = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: coolFlashTexture,
      color: 0xffe2bd,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  halo.visible = false;
  halo.scale.set(1, 1, 1);
  scene.add(halo);

  const light = new THREE.PointLight(color, 0, distance, 2);
  light.visible = false;
  scene.add(light);

  return {
    core,
    halo,
    light,
    age: 1,
    maxAge: 0.9,
  };
}

const shoreFlashes = Array.from({ length: 8 }, () => createFlashState(0xffa56c, 150));
const skyBursts = Array.from({ length: 7 }, () => createFlashState(0xf2f5ff, 120));

const tracerMaterial = new THREE.LineBasicMaterial({
  color: 0xffbf7f,
  transparent: true,
  opacity: 0.8,
});
const tracerState = Array.from({ length: 8 }, () => {
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
    tracerMaterial.clone(),
  );
  line.visible = false;
  scene.add(line);
  return {
    line,
    start: new THREE.Vector3(),
    end: new THREE.Vector3(),
    progress: 2,
    speed: 1.1,
  };
});

function primeFlash(entry, position, options = {}) {
  const {
    coreHex = 0xffb26e,
    haloHex = 0xffc58a,
    lightHex = 0xff9458,
    lightDistance = entry.light.distance,
    maxAge = 0.9,
    coreMap = warmFlashTexture,
  } = options;

  entry.core.visible = true;
  entry.halo.visible = true;
  entry.light.visible = true;
  entry.core.position.copy(position);
  entry.halo.position.copy(position);
  entry.light.position.copy(position);
  entry.age = 0;
  entry.maxAge = maxAge;
  entry.light.distance = lightDistance;
  entry.core.material.map = coreMap;
  entry.core.material.color.setHex(coreHex);
  entry.halo.material.color.setHex(haloHex);
  entry.light.color.setHex(lightHex);
}

function activateFlash(entry, mode) {
  const [localX, localZ] = shoreBatteryCoords[Math.floor(Math.random() * shoreBatteryCoords.length)];
  const worldPoint = getIslandWorldPoint(localX, localZ, mode === 'sky' ? 16 + Math.random() * 16 : 1.6);
  if (mode === 'sky') {
    worldPoint.x += (Math.random() - 0.5) * 22;
    worldPoint.z += (Math.random() - 0.5) * 20;
  } else {
    worldPoint.x += (Math.random() - 0.5) * 12;
    worldPoint.z += (Math.random() - 0.5) * 12;
  }

  primeFlash(entry, worldPoint, {
    maxAge: mode === 'sky' ? 0.65 + Math.random() * 0.45 : 0.9 + Math.random() * 0.65,
    coreMap: mode === 'sky' ? coolFlashTexture : warmFlashTexture,
    coreHex: mode === 'sky' ? 0xf1f6ff : 0xffb26e,
    haloHex: mode === 'sky' ? 0x9fbfff : 0xffc58a,
    lightHex: mode === 'sky' ? 0xcddfff : 0xff9458,
  });
  if (mode === 'shore') {
    playBombardmentThud();
  }
}

function activateTracer(entry) {
  const [localX, localZ] = shoreBatteryCoords[Math.floor(Math.random() * shoreBatteryCoords.length)];
  entry.start.copy(getIslandWorldPoint(localX, localZ, 8 + Math.random() * 5));
  entry.end.set(
    -45 + Math.random() * 125,
    14 + Math.random() * 36,
    -150 + Math.random() * 210,
  );
  entry.progress = 0;
  entry.speed = 0.75 + Math.random() * 1.2;
  entry.line.visible = true;
  entry.line.material.opacity = 0.85;
  entry.line.geometry.setFromPoints([entry.start, entry.start.clone()]);
}

function updateFlashCollection(collection, deltaSeconds, mode) {
  collection.forEach((entry) => {
    entry.age += deltaSeconds;
    if (entry.age >= entry.maxAge) {
      entry.core.visible = false;
      entry.halo.visible = false;
      entry.light.visible = false;
      entry.core.material.opacity = 0;
      entry.halo.material.opacity = 0;
      entry.light.intensity = 0;
      return;
    }
    const t = entry.age / entry.maxAge;
    const pulse = Math.sin(t * Math.PI);
    entry.core.visible = true;
    entry.halo.visible = true;
    entry.light.visible = true;
    entry.core.scale.setScalar((mode === 'sky' ? 7.5 : 9.5) * pulse + 0.9);
    entry.halo.scale.setScalar((mode === 'sky' ? 13 : 17) * pulse + 2.2);
    entry.core.material.opacity = (1 - t) * (mode === 'sky' ? 0.8 : 0.92);
    entry.halo.material.opacity = (1 - t) * (mode === 'sky' ? 0.28 : 0.34);
    entry.light.intensity = (1 - t) * (mode === 'sky' ? 18 : 28);
  });
}

function updateTracers(deltaSeconds) {
  tracerState.forEach((entry) => {
    entry.progress += deltaSeconds * entry.speed;
    if (entry.progress >= 1.18) {
      entry.line.visible = false;
      return;
    }
    if (entry.progress < 0) {
      return;
    }
    tempVector.copy(entry.start).lerp(entry.end, entry.progress);
    entry.line.visible = true;
    entry.line.geometry.setFromPoints([entry.start, tempVector]);
    entry.line.material.opacity = THREE.MathUtils.clamp(0.9 - entry.progress * 0.8, 0, 0.85);
  });
}

const enemyRoot = new THREE.Group();
scene.add(enemyRoot);

const shotRaycaster = new THREE.Raycaster();
const shotHits = [];
const enemyHitMeshes = [];
const enemyRouteTemplates = [
  { beachLocal: [96, 92], waterStartOffset: [30, 74], end: [-12.2, ENEMY_WATER_HEIGHT, 40], sway: 5.2, launchShare: 0.16 },
  { beachLocal: [108, 54], waterStartOffset: [26, 50], end: [-11.9, ENEMY_WATER_HEIGHT, 26], sway: 4.5, launchShare: 0.15 },
  { beachLocal: [118, 20], waterStartOffset: [40, 20], end: [-11.6, ENEMY_WATER_HEIGHT, 12], sway: 3.8, launchShare: 0.15 },
  { beachLocal: [110, -18], waterStartOffset: [58, -8], end: [-11.4, ENEMY_WATER_HEIGHT, -2], sway: 3.2, launchShare: 0.14 },
  { beachLocal: [92, -54], waterStartOffset: [38, -34], end: [-11.9, ENEMY_WATER_HEIGHT, -16], sway: 4.2, launchShare: 0.16 },
];

function createPlayerTracer(color) {
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
    new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: 0,
    }),
  );
  line.visible = false;
  scene.add(line);
  return {
    line,
    start: new THREE.Vector3(),
    end: new THREE.Vector3(),
    age: 1,
    maxAge: 0.12,
  };
}

const playerTracers = Array.from({ length: 14 }, () => createPlayerTracer(0xffd5a0));
const impactBursts = Array.from({ length: 12 }, () => createFlashState(0xffd1a0, 48));

function activateImpactBurst(position, options = {}) {
  const entry = impactBursts.find((candidate) => !candidate.core.visible) ?? impactBursts[0];
  primeFlash(entry, position, {
    maxAge: options.maxAge ?? 0.24,
    coreHex: options.coreHex ?? 0xffd1a0,
    haloHex: options.haloHex ?? 0xffa160,
    lightHex: options.lightHex ?? 0xff9a4c,
    lightDistance: options.lightDistance ?? 48,
    coreMap: options.coreMap ?? warmFlashTexture,
  });
}

function updateImpactBursts(deltaSeconds) {
  impactBursts.forEach((entry) => {
    entry.age += deltaSeconds;
    if (entry.age >= entry.maxAge) {
      entry.core.visible = false;
      entry.halo.visible = false;
      entry.light.visible = false;
      entry.core.material.opacity = 0;
      entry.halo.material.opacity = 0;
      entry.light.intensity = 0;
      return;
    }
    const t = entry.age / entry.maxAge;
    const pulse = Math.sin(t * Math.PI);
    entry.core.scale.setScalar(4.4 * pulse + 0.7);
    entry.halo.scale.setScalar(9.2 * pulse + 1.2);
    entry.core.material.opacity = (1 - t) * 0.95;
    entry.halo.material.opacity = (1 - t) * 0.34;
    entry.light.intensity = (1 - t) * 10;
  });
}

function spawnPlayerTracer(start, end, hit = false) {
  const tracer = playerTracers.find((entry) => !entry.line.visible) ?? playerTracers[0];
  tracer.start.copy(start);
  tracer.end.copy(end);
  tracer.age = 0;
  tracer.maxAge = hit ? 0.1 : 0.08;
  tracer.line.visible = true;
  tracer.line.material.color.setHex(hit ? 0xfff0c8 : 0xffc989);
  tracer.line.material.opacity = 0.96;
  tracer.line.geometry.setFromPoints([tracer.start, tracer.end]);
}

function updatePlayerTracers(deltaSeconds) {
  playerTracers.forEach((entry) => {
    entry.age += deltaSeconds;
    if (entry.age >= entry.maxAge) {
      entry.line.visible = false;
      return;
    }
    const t = entry.age / entry.maxAge;
    entry.line.material.opacity = (1 - t) * 0.92;
  });
}

function createEnemyBoat() {
  const group = new THREE.Group();
  group.visible = false;

  const hullMaterial = new THREE.MeshStandardMaterial({
    color: 0x1f2730,
    roughness: 0.88,
    metalness: 0.08,
    emissive: 0x000000,
  });
  const steelMaterial = new THREE.MeshStandardMaterial({
    color: 0x5b6773,
    roughness: 0.76,
    metalness: 0.14,
    emissive: 0x000000,
  });
  const crewMaterial = new THREE.MeshStandardMaterial({
    color: 0x59614d,
    roughness: 1,
    metalness: 0,
    emissive: 0x000000,
  });
  const lampMaterial = new THREE.MeshStandardMaterial({
    color: 0xc47258,
    roughness: 0.45,
    metalness: 0.08,
    emissive: 0x5c140a,
    emissiveIntensity: 1.15,
  });

  const hull = new THREE.Mesh(new THREE.BoxGeometry(4.8, 1.1, 10.8), hullMaterial);
  hull.position.y = 0.62;
  hull.castShadow = true;
  hull.receiveShadow = true;
  group.add(hull);

  const bow = new THREE.Mesh(new THREE.ConeGeometry(1.55, 3.4, 6), hullMaterial);
  bow.rotation.x = Math.PI / 2;
  bow.position.set(0, 0.82, -6.4);
  bow.castShadow = true;
  bow.receiveShadow = true;
  group.add(bow);

  const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.1, 1.7, 2.6), steelMaterial);
  cabin.position.set(0, 1.9, -0.8);
  cabin.castShadow = true;
  cabin.receiveShadow = true;
  group.add(cabin);

  const gunBase = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.32, 0.52, 10), steelMaterial);
  gunBase.position.set(0, 2.35, -3.1);
  gunBase.castShadow = true;
  gunBase.receiveShadow = true;
  group.add(gunBase);

  const gunBarrel = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 2.2), steelMaterial);
  gunBarrel.position.set(0, 2.42, -4.0);
  gunBarrel.castShadow = true;
  gunBarrel.receiveShadow = true;
  group.add(gunBarrel);

  const crew = new THREE.Mesh(new THREE.BoxGeometry(0.72, 1.2, 0.72), crewMaterial);
  crew.position.set(0.58, 2.55, -1);
  crew.castShadow = true;
  crew.receiveShadow = true;
  group.add(crew);

  const sternLamp = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 10), lampMaterial);
  sternLamp.position.set(0, 1.7, 4.25);
  group.add(sternLamp);

  enemyRoot.add(group);

  const enemy = {
    id: crypto.randomUUID?.() ?? `enemy-${Math.random().toString(16).slice(2)}`,
    active: false,
    group,
    hullMaterial,
    steelMaterial,
    crewMaterial,
    lampMaterial,
    flash: 0,
    health: 1,
    progress: 0,
    speed: 0,
    bobOffset: Math.random() * Math.PI * 2,
    swayPhase: Math.random() * Math.PI * 2,
    swayStrength: 1,
    launchShare: 0.15,
    beachPosition: new THREE.Vector3(),
    waterStart: new THREE.Vector3(),
    start: new THREE.Vector3(),
    end: new THREE.Vector3(),
    sideDirection: new THREE.Vector3(),
    currentPosition: new THREE.Vector3(),
    distanceToShip: Infinity,
    routeIndex: 0,
    hitMeshes: [hull, bow, cabin, gunBase, gunBarrel, crew],
  };

  enemy.hitMeshes.forEach((mesh) => {
    mesh.userData.enemy = enemy;
    enemyHitMeshes.push(mesh);
  });

  return enemy;
}

const enemies = Array.from({ length: ENEMY_POOL_SIZE }, () => createEnemyBoat());

function getWaveQuota(wave) {
  return 5 + wave * 2;
}

function getWaveSpawnInterval(wave) {
  return Math.max(0.68, 1.65 - wave * 0.1 + Math.random() * 0.32);
}

function deactivateEnemy(enemy) {
  enemy.active = false;
  enemy.group.visible = false;
  enemy.flash = 0;
}

function resetEnemyVisual(enemy) {
  const flashMix = THREE.MathUtils.clamp(enemy.flash / 0.18, 0, 1);
  enemy.hullMaterial.emissive.setRGB(flashMix * 0.55, flashMix * 0.18, flashMix * 0.05);
  enemy.steelMaterial.emissive.setRGB(flashMix * 0.38, flashMix * 0.16, flashMix * 0.08);
  enemy.crewMaterial.emissive.setRGB(flashMix * 0.16, flashMix * 0.08, flashMix * 0.04);
  enemy.lampMaterial.emissiveIntensity = 1.15 + flashMix * 0.9;
}

function spawnEnemyBoat(routeIndex = Math.floor(Math.random() * enemyRouteTemplates.length)) {
  const enemy = enemies.find((candidate) => !candidate.active);
  if (!enemy) {
    return null;
  }

  const route = enemyRouteTemplates[routeIndex];
  enemy.active = true;
  enemy.routeIndex = routeIndex;
  enemy.progress = 0;
  enemy.health = combatState.wave >= 4 && Math.random() < 0.32 ? 2 : 1;
  enemy.speed = 0.042 + combatState.wave * 0.004 + Math.random() * 0.006;
  enemy.bobOffset = Math.random() * Math.PI * 2;
  enemy.swayPhase = Math.random() * Math.PI * 2;
  enemy.swayStrength = route.sway * (0.72 + Math.random() * 0.5);
  enemy.launchShare = route.launchShare;
  enemy.flash = 0;
  enemy.beachPosition.copy(getIslandWorldPoint(route.beachLocal[0], route.beachLocal[1], 0.7));
  enemy.waterStart.set(
    islandRoot.position.x + route.waterStartOffset[0],
    ENEMY_WATER_HEIGHT,
    islandRoot.position.z + route.waterStartOffset[1],
  );
  enemy.start.copy(enemy.waterStart);
  enemy.end.set(route.end[0], route.end[1], route.end[2]);
  enemy.sideDirection.set(-(enemy.end.z - enemy.start.z), 0, enemy.end.x - enemy.start.x).normalize();
  enemy.group.visible = true;
  enemy.currentPosition.copy(enemy.beachPosition);
  enemy.group.position.copy(enemy.beachPosition);
  enemy.group.rotation.set(0, 0, 0);
  resetEnemyVisual(enemy);
  return enemy;
}

function startWave(wave) {
  combatState.phase = 'playing';
  combatState.wave = wave;
  combatState.waveSpawned = 0;
  combatState.waveQuota = getWaveQuota(wave);
  combatState.spawnTimer = 0.7;
  combatState.intermissionTimer = 0;
  showBanner(`Wave ${wave} incoming`, 2.2);
}

function resetCombat() {
  combatState.phase = 'playing';
  combatState.wave = 1;
  combatState.hull = MAX_HULL_INTEGRITY;
  combatState.score = 0;
  combatState.kills = 0;
  combatState.escaped = 0;
  combatState.shotsFired = 0;
  combatState.shotsHit = 0;
  combatState.shotCooldown = 0;
  combatState.xrTriggerLatched = false;
  playerMuzzleFlash.intensity = 0;
  enemies.forEach((enemy) => {
    deactivateEnemy(enemy);
    resetEnemyVisual(enemy);
  });
  startWave(1);
  syncHud();
}

function damageShip(amount) {
  combatState.hull = Math.max(0, combatState.hull - amount);
  playBombardmentThud();
  activateImpactBurst(tempVectorF.set(-8.8, 1.4, 8 + (Math.random() - 0.5) * 28), {
    coreHex: 0xffb078,
    haloHex: 0xff8344,
    lightHex: 0xff6b2d,
    maxAge: 0.28,
  });
  if (combatState.hull <= 0) {
    combatState.phase = 'gameover';
    showBanner('HMS London overrun', 6);
    enemies.forEach((enemy) => deactivateEnemy(enemy));
  }
}

function destroyEnemy(enemy) {
  combatState.score += 12 + combatState.wave * 3;
  combatState.kills += 1;
  activateImpactBurst(enemy.currentPosition, {
    coreHex: 0xffe3bc,
    haloHex: 0xffba78,
    lightHex: 0xff9652,
    maxAge: 0.3,
    lightDistance: 56,
  });
  deactivateEnemy(enemy);
}

function applyDamageToEnemy(enemy, damage, hitPoint) {
  if (!enemy?.active) {
    return;
  }
  enemy.health -= damage;
  enemy.flash = 0.18;
  activateImpactBurst(hitPoint ?? enemy.currentPosition, {
    coreHex: enemy.health <= 0 ? 0xffe2bb : 0xffc990,
    haloHex: enemy.health <= 0 ? 0xffa96a : 0xff9150,
    lightHex: enemy.health <= 0 ? 0xff8f42 : 0xff7a32,
    maxAge: enemy.health <= 0 ? 0.28 : 0.18,
  });
  if (enemy.health <= 0) {
    destroyEnemy(enemy);
  }
}

function requestPlayerFire() {
  if (combatState.phase === 'gameover') {
    return;
  }
  state.fireQueued = true;
  handleUserAudioUnlock();
}

function firePlayerShot() {
  const firingCamera = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
  firingCamera.getWorldPosition(tempVectorF);
  firingCamera.getWorldDirection(tempVectorG).normalize();
  tempVectorF.addScaledVector(tempVectorG, 0.7);

  shotRaycaster.set(tempVectorF, tempVectorG);
  shotRaycaster.far = PLAYER_FIRE_RANGE;
  shotHits.length = 0;
  shotRaycaster.intersectObjects(enemyHitMeshes, false, shotHits);

  let hitEnemy = null;
  tempVectorH.copy(tempVectorF).addScaledVector(tempVectorG, PLAYER_FIRE_RANGE);

  for (const hit of shotHits) {
    const enemy = hit.object.userData.enemy;
    if (!enemy?.active) {
      continue;
    }
    hitEnemy = enemy;
    tempVectorH.copy(hit.point);
    break;
  }

  spawnPlayerTracer(tempVectorF, tempVectorH, Boolean(hitEnemy));
  playerMuzzleFlash.intensity = 10;
  combatState.shotsFired += 1;
  combatState.shotCooldown = PLAYER_FIRE_COOLDOWN;

  if (hitEnemy) {
    combatState.shotsHit += 1;
    applyDamageToEnemy(hitEnemy, 1, tempVectorH.clone());
  }
}

function updateXRCombatInput() {
  if (!renderer.xr.isPresenting) {
    combatState.xrTriggerLatched = false;
    return;
  }

  const session = renderer.xr.getSession();
  if (!session) {
    combatState.xrTriggerLatched = false;
    return;
  }

  let triggerPressed = false;
  for (const source of session.inputSources) {
    if (!source.gamepad || source.handedness !== 'right') {
      continue;
    }
    triggerPressed = Boolean(source.gamepad.buttons[0]?.pressed ?? source.gamepad.buttons[1]?.pressed);
    if (triggerPressed) {
      break;
    }
  }

  if (triggerPressed && !combatState.xrTriggerLatched) {
    requestPlayerFire();
  }
  combatState.xrTriggerLatched = triggerPressed;
}

function updateEnemies(deltaSeconds, seconds) {
  enemies.forEach((enemy) => {
    if (!enemy.active) {
      return;
    }

    enemy.progress += deltaSeconds * enemy.speed;
    const pathAmount = THREE.MathUtils.clamp(enemy.progress, 0, 1);
    const sway = Math.sin(seconds * 1.4 + enemy.swayPhase + enemy.progress * 9) * enemy.swayStrength;

    if (pathAmount < enemy.launchShare) {
      const launchT = pathAmount / enemy.launchShare;
      tempVectorF.copy(enemy.beachPosition).lerp(enemy.waterStart, launchT);
      tempVectorG.copy(enemy.beachPosition).lerp(enemy.waterStart, Math.min(1, launchT + 0.08));
      tempVectorF.y = THREE.MathUtils.lerp(tempVectorF.y, ENEMY_WATER_HEIGHT, launchT);
      tempVectorG.y = THREE.MathUtils.lerp(tempVectorG.y, ENEMY_WATER_HEIGHT, Math.min(1, launchT + 0.08));
    } else {
      const waterT = (pathAmount - enemy.launchShare) / (1 - enemy.launchShare);
      tempVectorF.copy(enemy.start).lerp(enemy.end, waterT);
      tempVectorF.addScaledVector(enemy.sideDirection, sway);
      tempVectorF.y = ENEMY_WATER_HEIGHT + Math.sin(seconds * 2.8 + enemy.bobOffset) * 0.26 + Math.cos(seconds * 1.2 + enemy.bobOffset) * 0.08;
      tempVectorG.copy(enemy.start).lerp(enemy.end, Math.min(1, waterT + 0.02));
      tempVectorG.addScaledVector(
        enemy.sideDirection,
        Math.sin(seconds * 1.4 + enemy.swayPhase + (enemy.progress + 0.02) * 9) * enemy.swayStrength,
      );
      tempVectorG.y = ENEMY_WATER_HEIGHT;
    }

    enemy.currentPosition.copy(tempVectorF);
    enemy.group.position.copy(enemy.currentPosition);
    enemy.group.rotation.y = Math.atan2(tempVectorG.x - enemy.currentPosition.x, tempVectorG.z - enemy.currentPosition.z) + Math.PI;
    enemy.group.rotation.x = Math.sin(seconds * 1.6 + enemy.bobOffset) * 0.03;
    enemy.group.rotation.z = Math.sin(seconds * 2.1 + enemy.bobOffset) * 0.05;
    enemy.distanceToShip = enemy.currentPosition.distanceTo(enemy.end);
    enemy.flash = Math.max(0, enemy.flash - deltaSeconds);
    resetEnemyVisual(enemy);

    if (enemy.progress >= 1) {
      deactivateEnemy(enemy);
      combatState.escaped += 1;
      damageShip(12 + combatState.wave * 1.6);
    }
  });
}

function updateCombatDirector(deltaSeconds) {
  if (combatState.phase === 'gameover') {
    return;
  }

  if (combatState.phase === 'intermission') {
    combatState.intermissionTimer -= deltaSeconds;
    if (combatState.intermissionTimer <= 0) {
      startWave(combatState.wave + 1);
    }
    return;
  }

  if (combatState.waveSpawned < combatState.waveQuota) {
    combatState.spawnTimer -= deltaSeconds;
    if (combatState.spawnTimer <= 0) {
      spawnEnemyBoat();
      combatState.waveSpawned += 1;
      combatState.spawnTimer = getWaveSpawnInterval(combatState.wave);
    }
  } else if (countActiveEnemies() === 0) {
    combatState.phase = 'intermission';
    combatState.intermissionTimer = 3.2;
    showBanner(`Wave ${combatState.wave} repelled`, 2.4);
  }
}

function updateCombat(deltaSeconds, seconds) {
  combatState.shotCooldown = Math.max(0, combatState.shotCooldown - deltaSeconds);
  playerMuzzleFlash.intensity = Math.max(0, playerMuzzleFlash.intensity - deltaSeconds * 66);
  updateXRCombatInput();

  if (state.fireQueued && combatState.shotCooldown <= 0 && combatState.phase !== 'gameover') {
    firePlayerShot();
  }
  state.fireQueued = false;

  updateCombatDirector(deltaSeconds);
  updateEnemies(deltaSeconds, seconds);
  updatePlayerTracers(deltaSeconds);
  updateImpactBursts(deltaSeconds);

  if (combatState.bannerTimer > 0) {
    combatState.bannerTimer -= deltaSeconds;
    if (combatState.bannerTimer <= 0) {
      showBanner('');
    }
  }

  syncHud();
}

const loader = new GLTFLoader();
loader.load(
  SHIP_MODEL_PATH,
  (gltf) => {
    const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();
    shipCollisionMeshes.length = 0;
    shipCollisionRoot.clear();
    gltf.scene.position.y = -SHIP_DECK_Y;
    gltf.scene.traverse((object) => {
      if (!object.isMesh) {
        return;
      }
      object.castShadow = true;
      object.receiveShadow = true;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material) => {
        if (!material) {
          return;
        }
        if (material.map) {
          material.map.anisotropy = maxAnisotropy;
        }
        if ('roughness' in material) {
          material.roughness = THREE.MathUtils.clamp(material.roughness - 0.08, 0.1, 1);
        }
        if ('metalness' in material) {
          material.metalness *= 0.85;
        }
        if (material.color) {
          material.color.multiplyScalar(1.08);
        }
        if (material.emissive) {
          material.emissive.setHex(0x162333);
          material.emissiveIntensity = 0.16;
        }
      });
    });

    const collisionScene = gltf.scene.clone(true);
    collisionScene.traverse((object) => {
      if (!object.isMesh) {
        return;
      }
      object.castShadow = false;
      object.receiveShadow = false;
      object.material = shipCollisionMaterial;
      shipCollisionMeshes.push(object);
    });

    shipVisualGroup.add(gltf.scene);
    shipCollisionRoot.add(collisionScene);
    state.shipLoaded = true;
    document.body.dataset.shipLoaded = 'true';
  },
  undefined,
  (error) => {
    console.error(error);
    state.shipLoadError = 'Could not load the ship model.';
    document.body.dataset.shipLoaded = 'error';
  },
);

loader.load(
  ISLAND_MODEL_PATH,
  (gltf) => {
    const islandScene = gltf.scene;
    const landscape = islandScene.getObjectByName('Landscape.012');
    const islandModel = landscape ? landscape.clone(true) : islandScene;

    islandModel.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(islandModel);
    const center = box.getCenter(new THREE.Vector3());
    const min = box.min.clone();

    islandModel.position.set(-center.x, -min.y + 0.35, -center.z);
    islandModel.rotation.y = -0.46;
    islandModel.scale.set(3.1, 7.4, 3.4);

    islandModel.traverse((object) => {
      if (!object.isMesh) {
        return;
      }
      object.castShadow = false;
      object.receiveShadow = true;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material) => {
        if (!material) {
          return;
        }
        if ('roughness' in material) {
          material.roughness = THREE.MathUtils.clamp((material.roughness ?? 0.7) + 0.12, 0.2, 1);
        }
        if ('metalness' in material) {
          material.metalness *= 0.5;
        }
        if (material.color) {
          material.color.offsetHSL(-0.01, -0.12, -0.08);
        }
        if (material.emissive) {
          material.emissive.setHex(0x132030);
          material.emissiveIntensity = 0.2;
        }
      });
    });

    islandVisualGroup.position.set(-12, 0.8, 8);
    islandVisualGroup.add(islandModel);
    islandFallbackGroup.visible = false;
    state.islandLoaded = true;
  },
  undefined,
  (error) => {
    console.error(error);
    state.islandLoadError = 'Could not load the island model.';
    islandFallbackGroup.visible = true;
  },
);

function resize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

window.addEventListener('resize', resize);
window.addEventListener('pointerdown', handleUserAudioUnlock, { passive: true });
window.addEventListener('keydown', handleUserAudioUnlock);
window.addEventListener('touchstart', handleUserAudioUnlock, { passive: true });
renderer.xr.addEventListener('sessionstart', handleUserAudioUnlock);

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen?.();
  } else {
    document.exitFullscreen?.();
  }
}

window.addEventListener('keydown', (event) => {
  state.keys.add(event.code);
  if (event.code === 'KeyB' && !event.repeat) {
    state.binoculars = !state.binoculars;
    document.body.classList.toggle('binoculars', state.binoculars);
  }
  if (event.code === 'KeyF' && !event.repeat) {
    toggleFullscreen();
  }
  if (event.code === 'Space' && !event.repeat) {
    event.preventDefault();
    requestPlayerFire();
  }
  if (event.code === 'KeyR' && !event.repeat) {
    resetCombat();
  }
});

window.addEventListener('keyup', (event) => {
  state.keys.delete(event.code);
});

renderer.domElement.addEventListener('pointerdown', (event) => {
  if (renderer.xr.isPresenting) {
    return;
  }
  if (event.button !== 0) {
    return;
  }
  state.pointerDown = true;
  state.pointerTravel = 0;
  state.pointerDownAt = performance.now();
  state.lastPointer = { x: event.clientX, y: event.clientY };
});

window.addEventListener('pointerup', (event) => {
  if (
    state.pointerDown
    && event.button === 0
    && state.pointerTravel < 8
    && performance.now() - state.pointerDownAt < 240
  ) {
    requestPlayerFire();
  }
  state.pointerDown = false;
  state.pointerTravel = 0;
  state.lastPointer = null;
});

window.addEventListener('pointermove', (event) => {
  if (!state.pointerDown || renderer.xr.isPresenting) {
    return;
  }
  if (!state.lastPointer) {
    state.lastPointer = { x: event.clientX, y: event.clientY };
    return;
  }
  const deltaX = event.clientX - state.lastPointer.x;
  const deltaY = event.clientY - state.lastPointer.y;
  state.pointerTravel += Math.hypot(deltaX, deltaY);
  state.lastPointer = { x: event.clientX, y: event.clientY };
  state.yaw -= deltaX * 0.0031;
  state.pitch = THREE.MathUtils.clamp(state.pitch - deltaY * 0.0025, -1.15, 1.05);
});

function updateOcean(seconds) {
  const position = ocean.geometry.attributes.position;
  const shipEnergy = THREE.MathUtils.clamp(
    Math.abs(shipMotionState.roll) * 34 + Math.abs(shipMotionState.pitch) * 46 + Math.abs(shipMotionState.heave) * 0.72,
    0,
    1,
  );

  for (let i = 0; i < position.count; i += 1) {
    const x = oceanBasePositions[i * 3];
    const planeY = oceanBasePositions[i * 3 + 1];
    const baseHeight = oceanBasePositions[i * 3 + 2];
    const swellA = Math.sin((x * 0.0078 + planeY * 0.0026) + seconds * 0.78) * 1.5;
    const swellB = Math.cos((x * -0.0038 + planeY * 0.0106) - seconds * 0.56) * 1.02;
    const swellC = Math.sin((x * 0.011 + planeY * 0.015) + seconds * 1.04) * 0.46;
    const fineChop =
      Math.sin((x * 0.046 - planeY * 0.032) + seconds * 2.8) *
      Math.cos((planeY * 0.038 + x * 0.022) - seconds * 2.2) *
      0.18;

    const nearHullBand = Math.exp(-((x / 28) ** 2) - ((planeY / 145) ** 2));
    const swayRipple =
      Math.sin(planeY * 0.122 - seconds * 2.4 + shipMotionState.roll * 52 + shipMotionState.pitch * 38) *
      nearHullBand *
      (0.24 + shipEnergy * 0.42);
    const sideWake =
      Math.exp(-((Math.abs(x) - 10.5) ** 2) / (2 * 5.4 ** 2)) *
      Math.exp(-((planeY / 138) ** 2)) *
      Math.sin(planeY * 0.146 - seconds * 3.0 + shipMotionState.roll * 62) *
      (0.08 + shipEnergy * 0.12);
    const wakeTrailing =
      Math.cos((planeY + seconds * 26) * 0.074 + shipMotionState.pitch * 66) *
      Math.exp(-((x / 20) ** 2)) *
      THREE.MathUtils.smoothstep(planeY, -20, 96) *
      (1 - THREE.MathUtils.smoothstep(planeY, 96, 255)) *
      0.22;

    position.setXYZ(i, x, planeY, baseHeight + swellA + swellB + swellC + fineChop + swayRipple + sideWake + wakeTrailing);
  }
  position.needsUpdate = true;
  ocean.geometry.computeVertexNormals();
  oceanShaderState.uniforms.time.value = seconds;
  oceanHeightTexture.offset.x = seconds * 0.0026 + shipMotionState.roll * 0.16;
  oceanHeightTexture.offset.y = -seconds * 0.0018 + shipMotionState.pitch * 0.14;
  oceanNormalTexture.offset.x = seconds * 0.0058 + shipMotionState.roll * 0.26;
  oceanNormalTexture.offset.y = -seconds * 0.0042 + shipMotionState.pitch * 0.22;
  oceanShaderState.uniforms.shipMotion.value.set(
    shipMotionState.roll,
    shipMotionState.pitch,
    shipMotionState.heave,
    shipEnergy,
  );
}

function updateShipMotion(seconds) {
  const roll = Math.sin(seconds * 0.74) * 0.017 + Math.cos(seconds * 0.31) * 0.01;
  const pitch = Math.cos(seconds * 0.54) * 0.012;
  const heave = Math.sin(seconds * 1.08) * 0.26;
  shipMotionGroup.rotation.z = roll;
  shipMotionGroup.rotation.x = pitch;
  shipMotionGroup.position.y = heave;
  shipMotionState.roll = roll;
  shipMotionState.pitch = pitch;
  shipMotionState.heave = heave;
  shipMotionState.energy = THREE.MathUtils.clamp(Math.abs(roll) * 34 + Math.abs(pitch) * 46 + Math.abs(heave) * 0.72, 0, 1);

  shipSearchlight.target.position.set(
    islandRoot.position.x + 34 + Math.sin(seconds * 0.36) * 52,
    islandRoot.position.y + 18 + Math.sin(seconds * 0.62) * 5,
    islandRoot.position.z - 40 + Math.cos(seconds * 0.41) * 44,
  );
  shipSearchlightBeam.rotation.z = Math.sin(seconds * 0.34) * 0.2;

  coastSearchlight.target.position.set(
    -24 + Math.sin(seconds * 0.28 + 1.2) * 54,
    12 + Math.sin(seconds * 0.5) * 8,
    -28 + Math.cos(seconds * 0.26) * 62,
  );
}

function updateDesktopLook() {
  if (renderer.xr.isPresenting) {
    return;
  }
  desktopLook.set(state.pitch, state.yaw, 0);
  camera.quaternion.setFromEuler(desktopLook);
}

function isWithinBroadWalkBounds(x, z) {
  return x >= WALK_BOUNDS.minX && x <= WALK_BOUNDS.maxX && z >= WALK_BOUNDS.minZ && z <= WALK_BOUNDS.maxZ;
}

function getShipWorldUp(target) {
  shipMotionGroup.getWorldQuaternion(tempQuaternion);
  return target.set(0, 1, 0).applyQuaternion(tempQuaternion).normalize();
}

function hasDeckSupport(localX, localZ) {
  if (!isWithinBroadWalkBounds(localX, localZ)) {
    return false;
  }

  if (!state.shipLoaded || shipCollisionMeshes.length === 0) {
    return true;
  }

  const worldUp = getShipWorldUp(tempVectorB);
  tempVector.set(localX, PLAYER_EYE_HEIGHT + FLOOR_CHECK_HEIGHT, localZ);
  shipMotionGroup.localToWorld(tempVector);

  collisionRaycaster.set(tempVector, tempVectorC.copy(worldUp).negate());
  collisionRaycaster.far = PLAYER_EYE_HEIGHT + FLOOR_CHECK_DEPTH;
  collisionHits.length = 0;
  collisionRaycaster.intersectObjects(shipCollisionMeshes, false, collisionHits);

  for (const hit of collisionHits) {
    if (!hit.face) {
      continue;
    }

    tempVectorD.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
    if (tempVectorD.dot(worldUp) < 0.55) {
      continue;
    }

    tempVectorE.copy(hit.point);
    shipMotionGroup.worldToLocal(tempVectorE);
    if (Math.abs(tempVectorE.y) > FLOOR_SURFACE_TOLERANCE) {
      continue;
    }

    return true;
  }

  return false;
}

function pathHitsWall(fromX, fromZ, toX, toZ) {
  const deltaX = toX - fromX;
  const deltaZ = toZ - fromZ;
  const travelDistance = Math.hypot(deltaX, deltaZ);

  if (travelDistance < 0.0001 || !state.shipLoaded || shipCollisionMeshes.length === 0) {
    return false;
  }

  const worldUp = getShipWorldUp(tempVectorB);
  tempVector.set(deltaX, 0, deltaZ).normalize();
  tempVectorC.set(-tempVector.z, 0, tempVector.x);

  shipMotionGroup.getWorldQuaternion(tempQuaternion);
  tempVectorD.copy(tempVector).applyQuaternion(tempQuaternion).normalize();

  const probeOffsets = [0, -PLAYER_COLLISION_RADIUS, PLAYER_COLLISION_RADIUS];
  for (const height of WALL_PATH_HEIGHTS) {
    for (const offset of probeOffsets) {
      tempVectorE.copy(tempVectorC).multiplyScalar(offset);
      tempVectorB.set(fromX + tempVectorE.x, height, fromZ + tempVectorE.z);
      shipMotionGroup.localToWorld(tempVectorB);

      collisionRaycaster.set(tempVectorB, tempVectorD);
      collisionRaycaster.far = travelDistance + PLAYER_COLLISION_RADIUS + 0.08;
      collisionHits.length = 0;
      collisionRaycaster.intersectObjects(shipCollisionMeshes, false, collisionHits);

      for (const hit of collisionHits) {
        if (!hit.face) {
          continue;
        }

        tempVectorE.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
        if (Math.abs(tempVectorE.dot(worldUp)) > WALL_CHECK_UP_DOT_LIMIT) {
          continue;
        }

        tempVector.copy(hit.point);
        shipMotionGroup.worldToLocal(tempVector);
        if (tempVector.y < -0.25 || tempVector.y > 2.4) {
          continue;
        }

        return true;
      }
    }
  }

  return false;
}

function hasWallClearance(localX, localZ) {
  if (!state.shipLoaded || shipCollisionMeshes.length === 0) {
    return true;
  }

  const worldUp = getShipWorldUp(tempVectorB);
  shipMotionGroup.getWorldQuaternion(tempQuaternion);

  for (const height of WALL_CLEARANCE_HEIGHTS) {
    tempVector.set(localX, height, localZ);
    shipMotionGroup.localToWorld(tempVector);

    for (const [dirX, dirZ] of WALL_CLEARANCE_DIRECTIONS) {
      tempVectorC.set(dirX, 0, dirZ).normalize();
      tempVectorD.copy(tempVectorC).applyQuaternion(tempQuaternion).normalize();

      collisionRaycaster.set(tempVector, tempVectorD);
      collisionRaycaster.far = PLAYER_COLLISION_RADIUS + 0.08;
      collisionHits.length = 0;
      collisionRaycaster.intersectObjects(shipCollisionMeshes, false, collisionHits);

      for (const hit of collisionHits) {
        if (!hit.face) {
          continue;
        }

        tempVectorE.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
        if (Math.abs(tempVectorE.dot(worldUp)) > WALL_CHECK_UP_DOT_LIMIT) {
          continue;
        }

        tempVectorB.copy(hit.point);
        shipMotionGroup.worldToLocal(tempVectorB);
        if (tempVectorB.y < -0.25 || tempVectorB.y > 2.4) {
          continue;
        }

        return false;
      }
    }
  }

  return true;
}

function canOccupyPosition(targetX, targetZ, fromX, fromZ) {
  return hasDeckSupport(targetX, targetZ)
    && hasWallClearance(targetX, targetZ)
    && !pathHitsWall(fromX, fromZ, targetX, targetZ);
}

function resolvePlayerPosition(targetX, targetZ) {
  const currentX = player.position.x;
  const currentZ = player.position.z;
  const clampedX = THREE.MathUtils.clamp(targetX, WALK_BOUNDS.minX, WALK_BOUNDS.maxX);
  const clampedZ = THREE.MathUtils.clamp(targetZ, WALK_BOUNDS.minZ, WALK_BOUNDS.maxZ);

  if (canOccupyPosition(clampedX, clampedZ, currentX, currentZ)) {
    player.position.set(clampedX, player.position.y, clampedZ);
    return;
  }

  if (canOccupyPosition(clampedX, currentZ, currentX, currentZ)) {
    player.position.set(clampedX, player.position.y, currentZ);
    return;
  }

  if (canOccupyPosition(currentX, clampedZ, currentX, currentZ)) {
    player.position.set(currentX, player.position.y, clampedZ);
  }
}

function updateDesktopMovement(deltaSeconds) {
  if (renderer.xr.isPresenting) {
    return;
  }

  desktopForward.set(0, 0, -1).applyAxisAngle(up, state.yaw);
  desktopRight.set(1, 0, 0).applyAxisAngle(up, state.yaw);

  localMove.set(0, 0, 0);
  if (state.keys.has('KeyW')) localMove.add(desktopForward);
  if (state.keys.has('KeyS')) localMove.sub(desktopForward);
  if (state.keys.has('KeyA')) localMove.sub(desktopRight);
  if (state.keys.has('KeyD')) localMove.add(desktopRight);

  const speed = state.keys.has('ShiftLeft') || state.keys.has('ShiftRight') ? 10.5 : 5.7;
  if (localMove.lengthSq() > 0) {
    localMove.normalize().multiplyScalar(speed * deltaSeconds);
    resolvePlayerPosition(player.position.x + localMove.x, player.position.z + localMove.z);
  }
}

function updateXRMovement(deltaSeconds) {
  if (!renderer.xr.isPresenting) {
    return;
  }

  const session = renderer.xr.getSession();
  if (!session) {
    return;
  }

  let axisX = 0;
  let axisY = 0;
  for (const source of session.inputSources) {
    if (!source.gamepad || source.handedness !== 'left') {
      continue;
    }
    const axes = source.gamepad.axes;
    axisX = axes[2] ?? axes[0] ?? 0;
    axisY = axes[3] ?? axes[1] ?? 0;
    break;
  }

  if (Math.abs(axisX) < 0.18) axisX = 0;
  if (Math.abs(axisY) < 0.18) axisY = 0;
  if (axisX === 0 && axisY === 0) {
    return;
  }

  camera.getWorldDirection(xrForward);
  xrForward.y = 0;
  if (xrForward.lengthSq() < 0.0001) {
    xrForward.set(0, 0, -1);
  }
  xrForward.normalize();
  tempQuaternion.copy(shipMotionGroup.quaternion).invert();
  xrForward.applyQuaternion(tempQuaternion).normalize();
  xrRight.crossVectors(xrForward, up).normalize();

  localMove.set(0, 0, 0);
  localMove.addScaledVector(xrRight, axisX);
  localMove.addScaledVector(xrForward, -axisY);
  if (localMove.lengthSq() > 0) {
    localMove.normalize().multiplyScalar(4.3 * deltaSeconds);
    resolvePlayerPosition(player.position.x + localMove.x, player.position.z + localMove.z);
  }
}

function updateBattle(deltaSeconds, seconds) {
  state.timers.shoreFlash -= deltaSeconds;
  state.timers.skyBurst -= deltaSeconds;
  state.timers.tracer -= deltaSeconds;

  if (state.timers.shoreFlash <= 0) {
    const available = shoreFlashes.find((entry) => !entry.core.visible) ?? shoreFlashes[0];
    activateFlash(available, 'shore');
    state.timers.shoreFlash = 0.22 + Math.random() * 0.75;
  }

  if (state.timers.skyBurst <= 0) {
    const available = skyBursts.find((entry) => !entry.core.visible) ?? skyBursts[0];
    activateFlash(available, 'sky');
    state.timers.skyBurst = 0.55 + Math.random() * 1.2;
  }

  if (state.timers.tracer <= 0) {
    const available = tracerState.find((entry) => !entry.line.visible) ?? tracerState[0];
    activateTracer(available);
    state.timers.tracer = 0.35 + Math.random() * 0.95;
  }

  updateFlashCollection(shoreFlashes, deltaSeconds, 'shore');
  updateFlashCollection(skyBursts, deltaSeconds, 'sky');
  updateTracers(deltaSeconds);
  updateCombat(deltaSeconds, seconds);
}

function renderGameState() {
  return JSON.stringify({
    coordinateSystem: 'local ship deck uses x right, y up, z aft; negative z points toward the bow',
    mode: renderer.xr.isPresenting ? 'vr' : 'desktop',
    shipLoaded: state.shipLoaded,
    shipLoadError: state.shipLoadError,
    islandLoaded: state.islandLoaded,
    islandLoadError: state.islandLoadError,
    audio: {
      unlocked: state.audioUnlocked,
      ambienceLoaded: state.ambienceLoaded,
      ambienceStarted: state.ambienceStarted,
      bombardmentLoaded: state.bombardmentLoaded,
      muted: state.audioMuted,
      audioError: state.audioError,
    },
    binoculars: state.binoculars,
    player: {
      x: Number(player.position.x.toFixed(2)),
      y: Number((player.position.y + shipMotionGroup.position.y).toFixed(2)),
      z: Number(player.position.z.toFixed(2)),
      yaw: Number(state.yaw.toFixed(2)),
      pitch: Number(state.pitch.toFixed(2)),
    },
    walkDeck: {
      xMin: WALK_BOUNDS.minX,
      xMax: WALK_BOUNDS.maxX,
      zMin: WALK_BOUNDS.minZ,
      zMax: WALK_BOUNDS.maxZ,
    },
    battle: {
      phase: combatState.phase,
      wave: combatState.wave,
      score: combatState.score,
      hull: Number(combatState.hull.toFixed(1)),
      kills: combatState.kills,
      escaped: combatState.escaped,
      shotsFired: combatState.shotsFired,
      shotsHit: combatState.shotsHit,
      activeEnemyCount: countActiveEnemies(),
      waveSpawned: combatState.waveSpawned,
      waveQuota: combatState.waveQuota,
      shoreFlashes: shoreFlashes.filter((entry) => entry.core.visible).length,
      skyBursts: skyBursts.filter((entry) => entry.core.visible).length,
      tracers: tracerState.filter((entry) => entry.line.visible).length,
      enemies: enemies
        .filter((enemy) => enemy.active)
        .slice(0, 8)
        .map((enemy) => ({
          id: enemy.id,
          health: enemy.health,
          progress: Number(enemy.progress.toFixed(2)),
          x: Number(enemy.currentPosition.x.toFixed(1)),
          y: Number(enemy.currentPosition.y.toFixed(1)),
          z: Number(enemy.currentPosition.z.toFixed(1)),
          distanceToShip: Number(enemy.distanceToShip.toFixed(1)),
        })),
    },
  });
}

resetCombat();

window.render_game_to_text = renderGameState;
window.__battlewatchDebug = {
  getState() {
    return JSON.parse(renderGameState());
  },
  setPlayerPose(x, z, yaw = state.yaw, pitch = state.pitch) {
    player.position.set(x, player.position.y, z);
    state.yaw = yaw;
    state.pitch = pitch;
    updateDesktopLook();
    return JSON.parse(renderGameState());
  },
  testSupport(x, z) {
    return hasDeckSupport(x, z);
  },
  testClearance(x, z) {
    return hasWallClearance(x, z);
  },
  testMove(fromX, fromZ, toX, toZ) {
    return {
      support: hasDeckSupport(toX, toZ),
      clearance: hasWallClearance(toX, toZ),
      wall: pathHitsWall(fromX, fromZ, toX, toZ),
      canOccupy: canOccupyPosition(toX, toZ, fromX, fromZ),
    };
  },
  spawnEnemy(routeIndex) {
    const enemy = spawnEnemyBoat(routeIndex);
    syncHud();
    return enemy
      ? {
          id: enemy.id,
          routeIndex: enemy.routeIndex,
          start: enemy.start.toArray(),
          end: enemy.end.toArray(),
        }
      : null;
  },
  fire() {
    requestPlayerFire();
    return true;
  },
  resetCombat,
};
window.advanceTime = (ms) => {
  const clamped = Math.max(16, ms);
  const steps = Math.max(1, Math.round(clamped / (1000 / 60)));
  const fixedDelta = clamped / 1000 / steps;
  for (let i = 0; i < steps; i += 1) {
    const virtualSeconds = state.lastUpdateSeconds + fixedDelta;
    updateFrame(fixedDelta, virtualSeconds);
    state.lastUpdateSeconds = virtualSeconds;
  }
  renderer.render(scene, camera);
};

function updateFrame(deltaSeconds, seconds) {
  updateShipMotion(seconds);
  updateOcean(seconds);
  updateDesktopLook();
  updateDesktopMovement(deltaSeconds);
  updateXRMovement(deltaSeconds);
  updateBattle(deltaSeconds, seconds);

  const targetFov = state.binoculars && !renderer.xr.isPresenting ? 34 : 70;
  camera.fov = THREE.MathUtils.lerp(camera.fov, targetFov, 0.08);
  camera.updateProjectionMatrix();
}

renderer.setAnimationLoop(() => {
  const deltaSeconds = Math.min(clock.getDelta(), 0.05);
  const seconds = clock.elapsedTime;
  state.lastUpdateSeconds = seconds;
  updateFrame(deltaSeconds, seconds);
  renderer.render(scene, camera);
});
