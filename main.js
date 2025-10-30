import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

/* ----------------- Constants ----------------- */
const EPS_SPRITE = 0.01;     // tiny lift so chips never z-fight
const EPS_LINE   = 0.01;     // tiny lift for strokes
const MIN_DIST   = 0.15;     // sampling distance for freehand
const CHIP_PX    = 36;       // desired on-screen height (pixels) for the number sprite

/* ----------------- Renderer ----------------- */
const canvas = document.querySelector('#c');
const renderer = new THREE.WebGLRenderer({ antialias: true, canvas });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;

/* ----------------- Scene + Camera ----------------- */
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x202025);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.01, 2000);
camera.position.set(0, 18, 22);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

/* ----------------- Lights ----------------- */
scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const dir = new THREE.DirectionalLight(0xffffff, 2);
dir.position.set(10, 20, 10);
scene.add(dir);

/* ----------------- Picking plane at true court height ----------------- */
const courtPlane = new THREE.Mesh(
  new THREE.PlaneGeometry(1000, 1000),                // big plane, we clamp to bounds later
  new THREE.MeshBasicMaterial({ visible: false })
);
courtPlane.rotateX(-Math.PI / 2);
scene.add(courtPlane);

// Clamp to standard full-court rectangle after we scale X to 28m.
let COURT_BOUNDS = { minX: -14, maxX: 14, minZ: -7.5, maxZ: 7.5 };

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();

function clampToCourt(p) {
  p.x = Math.min(Math.max(p.x, COURT_BOUNDS.minX), COURT_BOUNDS.maxX);
  p.z = Math.min(Math.max(p.z, COURT_BOUNDS.minZ), COURT_BOUNDS.maxZ);
  return p;
}

function getPointFromEvent(ev) {
  const rect = renderer.domElement.getBoundingClientRect();
  ndc.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
  ndc.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(ndc, camera);
  const hit = raycaster.intersectObject(courtPlane, false)[0];
  if (!hit) return null;
  return clampToCourt(hit.point.clone());
}

/* ----------------- Materials / Geoms ----------------- */
const lineMatFinal = new THREE.LineBasicMaterial({ color: 0xfff07a });
lineMatFinal.depthTest = false;   // keep strokes visible
lineMatFinal.depthWrite = false;

const playerColors = ['#e74c3c','#f39c12','#27ae60','#2980b9','#8e44ad'];

/* Disk (floor) + sprite (number) combo */
function makePlayerChip(number) {
  const color = playerColors[number - 1] || '#4b82f0';

  // Floor disk marker
  const diskGeo = new THREE.CircleGeometry(0.45, 48); // ~0.9m diameter
  const diskMat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.85,
    depthTest: true,
    polygonOffset: true,
    polygonOffsetUnits: -2   // nudge toward camera to avoid z-fighting on paint
  });
  const disk = new THREE.Mesh(diskGeo, diskMat);
  disk.rotation.x = -Math.PI / 2;
  disk.position.y = EPS_SPRITE;
  disk.renderOrder = 2;

  // Number sprite (constant screen size, always readable)
  const size = 128;
  const cvs = document.createElement('canvas');
  cvs.width = cvs.height = size;
  const ctx = cvs.getContext('2d');

  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(size/2, size/2, size*0.45, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 72px system-ui, Arial';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(String(number), size/2, size/2);

  const tex = new THREE.CanvasTexture(cvs);
  const spriteMat = new THREE.SpriteMaterial({
    map: tex,
    depthTest: false,    // render on top of fences etc. for clarity
    depthWrite: false,
    transparent: true
  });
  const sprite = new THREE.Sprite(spriteMat);
  sprite.center.set(0.5, 0.0);          // bottom-center
  sprite.position.y = EPS_SPRITE + 0.02;
  sprite.renderOrder = 10;

  // Group both so we can move them together
  const group = new THREE.Group();
  group.add(disk);
  group.add(sprite);
  group.userData.sprite = sprite;
  return group;
}

/* ----------------- State & UI wiring ----------------- */
let tool = 'place';        // 'place' | 'draw'
let activePlayer = 1;

const playersByNumber = new Map(); // number -> Group (disk + sprite)
const allSprites = [];             // for constant pixel sizing

const actions = []; // stack of {type:'player-add'|'player-move'|'stroke', ...}
const strokes = [];

const byId = (id) => document.getElementById(id);
const toolPlaceBtn = byId('tool-place');
const toolDrawBtn  = byId('tool-draw');
const undoBtn = byId('undo');
const clearBtn = byId('clear');
const playerBtns = [...document.querySelectorAll('.player')];

function setTool(t) {
  tool = t;
  toolPlaceBtn.classList.toggle('active', t === 'place');
  toolDrawBtn.classList.toggle('active', t === 'draw');
}
toolPlaceBtn.onclick = () => setTool('place');
toolDrawBtn.onclick  = () => setTool('draw');

playerBtns.forEach(b=>{
  b.onclick = () => {
    playerBtns.forEach(x=>x.classList.remove('active'));
    b.classList.add('active');
    activePlayer = parseInt(b.dataset.num, 10);
  };
});
playerBtns[0].classList.add('active');

undoBtn.onclick = () => undo();
clearBtn.onclick = () => clearAll();

/* ----------------- Load court, compute true floor Y + frame camera ----------------- */
const loader = new GLTFLoader();
loader.load('./basketball_court.glb', (gltf) => {
  const court = gltf.scene;
  scene.add(court);

  // Center & scale to ~28m length (X)
  const box = new THREE.Box3().setFromObject(court);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  court.position.sub(center);

  const targetLen = 28;                         // standard full-court length (m)
  const s = targetLen / Math.max(size.x, 0.0001);
  court.scale.setScalar(s);

  // Robust floor Y: median of rays over a small central grid
  const rc = new THREE.Raycaster();
  const ys = [];
  const gridHalf = 3;      // samples across -3..3
  const step = 1.5;        // meters
  for (let gx = -gridHalf; gx <= gridHalf; gx++) {
    for (let gz = -gridHalf; gz <= gridHalf; gz++) {
      const x = gx * step;
      const z = gz * step;
      rc.set(new THREE.Vector3(x, 1000, z), new THREE.Vector3(0, -1, 0));
      const hits = rc.intersectObject(court, true);
      const hit = hits.find(h => h.face && h.face.normal.y > 0.5) || hits[0];
      if (hit) ys.push(hit.point.y);
    }
  }
  ys.sort((a,b)=>a-b);
  const courtY = ys.length ? ys[Math.floor(ys.length/2)] : 0;
  courtPlane.position.y = courtY + 0.0001; // plane exactly at hardwood

  // Clamp to standard full-court bounds after our scaling
  COURT_BOUNDS = { minX: -14, maxX: 14, minZ: -7.5, maxZ: 7.5 };

  // Frame camera
  const b2 = new THREE.Box3().setFromObject(court);
  const size2 = b2.getSize(new THREE.Vector3());
  const maxDim = Math.max(size2.x, size2.y, size2.z);
  const fov = camera.fov * Math.PI/180;
  const dist = (maxDim/2) / Math.tan(fov/2);
  camera.near = Math.max(dist/100, 0.01);
  camera.far = dist*100;
  camera.updateProjectionMatrix();
  camera.position.set(0, dist*0.6, dist*1.2);
  controls.target.set(0,0,0);
  controls.maxDistance = maxDim*4;
  controls.update();
});

/* ----------------- Place/move players (one per role) ----------------- */
function placeOrMovePlayerAt(p, number) {
  const existing = playersByNumber.get(number);
  if (!existing) {
    const chip = makePlayerChip(number);
    chip.position.copy(p);
    scene.add(chip);
    playersByNumber.set(number, chip);
    allSprites.push(chip.userData.sprite);
    actions.push({ type: 'player-add', number, object: chip });
  } else {
    const prev = existing.position.clone();
    existing.position.copy(p);
    actions.push({ type: 'player-move', number, object: existing, prevPosition: prev });
  }
}

/* ----------------- Freehand drawing (on plane) ----------------- */
let drawing = false;
let currentStrokePoints = [];
let currentStroke = null;

function startStroke(p) {
  drawing = true;
  p.y += EPS_LINE;
  currentStrokePoints = [p.clone()];
  currentStroke = new THREE.Line(new THREE.BufferGeometry().setFromPoints(currentStrokePoints), lineMatFinal);
  scene.add(currentStroke);
  controls.enabled = false;
}
function addStrokePoint(p) {
  if (!p) return;
  p.y += EPS_LINE;
  const last = currentStrokePoints[currentStrokePoints.length - 1];
  if (!last || last.distanceTo(p) < MIN_DIST) return;
  currentStrokePoints.push(p.clone());
  currentStroke.geometry.dispose();
  currentStroke.geometry = new THREE.BufferGeometry().setFromPoints(currentStrokePoints);
}
function endStroke() {
  if (!drawing) return;
  drawing = false;
  controls.enabled = true;
  if (currentStrokePoints.length < 2) {
    scene.remove(currentStroke);
    currentStroke.geometry.dispose();
  } else {
    actions.push({ type:'stroke', object: currentStroke });
    strokes.push(currentStroke);
  }
  currentStroke = null;
  currentStrokePoints = [];
}

/* ----------------- Pointer events ----------------- */
renderer.domElement.addEventListener('pointerdown', (e) => {
  const p = getPointFromEvent(e);
  if (!p) return;
  if (tool === 'place') placeOrMovePlayerAt(p, activePlayer);
  else if (tool === 'draw') startStroke(p);
});
renderer.domElement.addEventListener('pointermove', (e) => {
  if (!drawing || tool !== 'draw') return;
  addStrokePoint(getPointFromEvent(e));
});
window.addEventListener('pointerup', endStroke);
renderer.domElement.addEventListener('pointerleave', endStroke);
renderer.domElement.addEventListener('pointerdown', () => {
  if (tool === 'draw') controls.enabled = false;
});
window.addEventListener('pointerup', () => { controls.enabled = true; });

/* ----------------- Undo / Clear ----------------- */
function undo() {
  if (drawing) { endStroke(); return; }
  const last = actions.pop();
  if (!last) return;

  switch (last.type) {
    case 'stroke': {
      scene.remove(last.object);
      last.object.geometry?.dispose?.();
      const i = strokes.indexOf(last.object);
      if (i >= 0) strokes.splice(i, 1);
      break;
    }
    case 'player-add': {
      scene.remove(last.object);
      // remove sprite ref used for constant pixel sizing
      const spr = last.object.userData.sprite;
      const idx = allSprites.indexOf(spr);
      if (idx >= 0) allSprites.splice(idx, 1);
      // dispose
      last.object.traverse(o => {
        if (o.material) {
          if (Array.isArray(o.material)) o.material.forEach(m => m.dispose?.());
          else o.material.dispose?.();
        }
        o.geometry?.dispose?.();
      });
      playersByNumber.delete(last.number);
      break;
    }
    case 'player-move': {
      last.object.position.copy(last.prevPosition);
      break;
    }
  }
}

function clearAll() {
  // remove strokes
  strokes.forEach(s => { scene.remove(s); s.geometry?.dispose?.(); });
  strokes.length = 0;

  // remove player chips
  playersByNumber.forEach(chip => {
    scene.remove(chip);
    chip.traverse(o => {
      if (o.material) {
        if (Array.isArray(o.material)) o.material.forEach(m => m.dispose?.());
        else o.material.dispose?.();
      }
      o.geometry?.dispose?.();
    });
  });
  playersByNumber.clear();
  allSprites.length = 0;
  actions.length = 0;
}

/* ----------------- Resize + Animate ----------------- */
function onResize() {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', onResize);

/* ---- keep number sprites a constant on-screen size ---- */
function fitSpriteToPixels(sprite, px) {
  const worldPos = sprite.getWorldPosition(new THREE.Vector3());
  const dist = camera.position.distanceTo(worldPos);
  const vFOV = camera.fov * Math.PI / 180;
  const worldHeight = 2 * Math.tan(vFOV / 2) * dist;
  const worldPerPixel = worldHeight / renderer.domElement.clientHeight;
  const size = worldPerPixel * px;
  sprite.scale.set(size, size, 1);
}
function resizeAllSprites() {
  for (const spr of allSprites) fitSpriteToPixels(spr, CHIP_PX);
}

function tick() {
  requestAnimationFrame(tick);
  controls.update();
  resizeAllSprites();
  renderer.render(scene, camera);
}
tick();
onResize();
