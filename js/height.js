// A plain script, not a module, so the tool also runs when the page is opened straight from disk
// (browsers only block module files there). three.js still comes from the CDN, through the import map.
(async function(){
'use strict';
const [THREE, { OrbitControls }, { RoomEnvironment }, { mergeGeometries }] = await Promise.all([
  import('three'), import('three/addons/controls/OrbitControls.js'),
  import('three/addons/environments/RoomEnvironment.js'), import('three/addons/utils/BufferGeometryUtils.js')
]);
// start once the page has been read, the way a module would
if (document.readyState === 'loading') await new Promise(r => document.addEventListener('DOMContentLoaded', r, { once: true }));
window.__load && window.__load.set(0.55, 'Building the height gage…');

const T = THREE, TAU = Math.PI*2, IN = 25.4;
const $ = id => document.getElementById(id);
const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

/* ---------------------------------------------------------------------------
   Vernier height gage: 0–12″ / 0–300 mm dual scale,
   .001″ / 0.02 mm verniers, overall height 525, base 135 long x 45 high,
   slider 70, fine-feed unit 20, beam 28 wide, scriber 07GZA000 80 x 32 x 9 x 9,
   main scale adjustable 15 mm. All units below are millimeters, y up, the
   surface plate top at y = 0.
--------------------------------------------------------------------------- */
const H_TOTAL = 525, BASE_L = 135, BASE_H = 45, BASE_D = 80, BASE_X0 = -4, BASE_X1 = BASE_X0 + BASE_L;
const BEAM_X0 = 0, BEAM_X1 = 28, BEAM_Z0 = -5, BEAM_Z1 = 5;
const SL_H = 70, SL_X0 = -15, SL_X1 = 47, SL_Z0 = -9, PLATE_Z = 6.5;
const UNIT_H = 20;
const SCRIBE_DROP = 47;                  // scriber face to slider bottom
const V0 = 5;                            // vernier 0 line above the slider bottom
const SCALE_Y0 = SCRIBE_DROP + V0;       // main-scale 0 on the beam, before adjustment
const RANGE = 300;
const IN_MAIN = 0.05*IN, IN_VDIV = 0.049*IN;   // 50 vernier divisions over 49 main
const MM_VDIV = 0.98;                          // 50 vernier divisions over 49 mm
const FINE_MIN = 0, FINE_MAX = 9, FINE_PITCH = 0.5;   // fine-feed gap and mm per nut turn
const ZERO_RANGE = 7.5;
const TIP_X0 = -100, TIP_X1 = -93, TIP_Z0 = 1, TIP_Z1 = 10;   // scriber measuring face
const GRANITE = { x0: -460, x1: 320, z0: -240, z1: 240 };     // surface plate top
const CLEAR = 0.1*IN;                    // while the part moves, the scriber waits 0.100″ above its tallest point
// everything hanging below the slider, as footprints over the plate:
// [x0, x1, z0, z1, underside height above the scriber face, moves with the scriber in its clamp]
const UNDER = [
  [TIP_X0, -50, TIP_Z0, TIP_Z1, 0, true],             // scriber: flat underside, the measuring face
  [-58, -20, TIP_Z0, TIP_Z1, 23, true],               // scriber: raised arm into the clamp
  [-36, -19, -1, 12, 17, false],                      // scriber clamp
  [-21, -14, -3, 5, 21, false],                       // arm from the slider to the clamp
  [SL_X0, SL_X1 + 14, SL_Z0, PLATE_Z, SCRIBE_DROP, false]   // slider and its clamp knob
];

/* ---------- renderer ---------- */
const wrap = $('view');
const renderer = new T.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setClearColor(0x000000, 0);
renderer.toneMapping = T.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = T.PCFSoftShadowMap;
wrap.appendChild(renderer.domElement);
const MAX_ANISO = Math.min(8, renderer.capabilities.getMaxAnisotropy());


/* ---------- shop finish: real tools are satin and handled, not mirror-bright ----------
   Every lit material in the scene gets this once: chrome and lapped faces become satin, bare metal
   picks up fine scratches and handling marks, reflections are toned down, paint is a dull satin.
   Materials that glow on purpose (locked parts, highlights) are left alone. */
const WEAR_TEX = (() => {
  const s = 512, c = document.createElement('canvas'); c.width = c.height = s;
  const g = c.getContext('2d');
  g.fillStyle = 'rgb(222,222,222)'; g.fillRect(0, 0, s, s);
  // fine scratches from handling and cleaning
  for (let i = 0; i < 900; i++){
    const x = Math.random()*s, y = Math.random()*s, a = (Math.random() < 0.6 ? 0.1 : Math.PI/2) + (Math.random() - 0.5)*0.5, L = 6 + Math.random()*40;
    const v = Math.random() < 0.5 ? 255 : 170;
    g.strokeStyle = 'rgba(' + v + ',' + v + ',' + v + ',' + (0.15 + Math.random()*0.3) + ')'; g.lineWidth = 0.6 + Math.random()*0.8;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a)*L, y + Math.sin(a)*L); g.stroke();
  }
  // smudges and worn patches
  for (let i = 0; i < 70; i++){
    const x = Math.random()*s, y = Math.random()*s, r = 10 + Math.random()*55, v = Math.random() < 0.5 ? 255 : 175;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(' + v + ',' + v + ',' + v + ',0.35)'); gr.addColorStop(1, 'rgba(' + v + ',' + v + ',' + v + ',0)');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI*2); g.fill();
  }
  const t = new T.CanvasTexture(c); t.wrapS = t.wrapT = T.RepeatWrapping; t.anisotropy = 4;
  return t;
})();
const _finished = new WeakSet();
function shopFinish(root){
  root.traverse(o => {
    if (!o.isMesh) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]){
      if (!m || _finished.has(m) || !m.isMeshStandardMaterial || m.transparent) continue;
      _finished.add(m);
      if (m.emissive && m.emissive.getHex() !== 0 && m.emissiveIntensity > 0) continue;   // meant to glow
      if (m.metalness >= 0.6){
        m.roughness = Math.min(0.85, Math.max(m.roughness, 0.32) + 0.06);
        m.color.multiplyScalar(0.8);
        if (!m.roughnessMap){ m.roughnessMap = WEAR_TEX; m.roughness = Math.min(1, m.roughness/0.88); }
      } else m.roughness = Math.max(m.roughness, 0.58);
      m.envMapIntensity = (m.envMapIntensity == null ? 1 : m.envMapIntensity)*0.75;
      m.needsUpdate = true;
    }
  });
}

const scene = new T.Scene();
scene.environmentIntensity = 0.7;
{
  const pm = new T.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  pm.dispose();
}
// orthographic, like the micrometers: no perspective, so scales and faces read true at any angle.
// VIEW_H is the height of scene shown at zoom 1; the camera sits far back along its view direction.
const VIEW_H = 700, CAM_BACK = 4000;
const camera = new T.OrthographicCamera(-1, 1, 1, -1, 1, 20000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.dampingFactor = 0.1;
controls.screenSpacePanning = true;
controls.minZoom = 0.25; controls.maxZoom = 40;

const key = new T.DirectionalLight(0xffffff, 1.35);
key.position.set(260, 900, 520);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -420, right: 420, top: 620, bottom: -220, near: 100, far: 2400 });
key.shadow.bias = -0.0004; key.shadow.normalBias = 0.6;
scene.add(key);
const rim = new T.DirectionalLight(0xbcd4ff, 0.35); rim.position.set(-500, 300, -600); scene.add(rim);
scene.add(new T.HemisphereLight(0xffffff, 0x30343a, 0.35));

/* ---------- textures ---------- */
function canvasTex(w, h, draw, repeat, srgb){
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new T.CanvasTexture(c); t.wrapS = t.wrapT = T.RepeatWrapping;
  if (repeat) t.repeat.set(repeat[0], repeat[1]);
  if (srgb) t.colorSpace = T.SRGBColorSpace;
  t.anisotropy = MAX_ANISO;
  return t;
}
const rand = (a, b) => a + Math.random()*(b - a);
const rows = (g, w, h, base, amp) => { for (let y = 0; y < h; y++){ const v = base + amp*(Math.random() - 0.5); g.fillStyle = `rgb(${v|0},${v|0},${v|0})`; g.fillRect(0, y, w, 1); } };
// hammertone paint on the cast base
function hammer(light){
  return (g, s) => {
    g.fillStyle = light ? '#e8e8e8' : '#808080'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 2400; i++){
      const x = Math.random()*s, y = Math.random()*s, r = 2 + Math.random()*10;
      const up = Math.random() < 0.5, v = light ? (up ? 255 : 196) : (up ? 205 : 55);
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, `rgba(${v},${v},${v},${light ? 0.35 : 0.5})`); gr.addColorStop(1, `rgba(${v},${v},${v},0)`);
      g.fillStyle = gr;
      for (const dx of [-s, 0, s]) for (const dy of [-s, 0, s]){ g.beginPath(); g.arc(x + dx, y + dy, r, 0, TAU); g.fill(); }
    }
  };
}
const hammerBump = canvasTex(512, 512, hammer(false), [0.02, 0.02]);
const hammerMap = canvasTex(512, 512, hammer(true), [0.02, 0.02], true);
const brushedV = canvasTex(64, 512, (g, w, h) => rows(g, w, h, 170, 110), [1, 1]);   // lengthwise grinding on the beam
brushedV.rotation = Math.PI/2;
const satinTex = canvasTex(256, 256, (g, w, h) => { g.fillStyle = '#c8c8c8'; g.fillRect(0, 0, w, h); g.globalAlpha = 0.12; for (let i = 0; i < 2500; i++){ const v = Math.random() < 0.5 ? 255 : 90; g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(Math.random()*w, Math.random()*h, 1.2, 1.2); } }, [0.08, 0.08]);
const granite = canvasTex(512, 512, (g, s) => {
  g.fillStyle = '#23252a'; g.fillRect(0, 0, s, s);
  for (let i = 0; i < 9000; i++){ const v = Math.random() < 0.5 ? rand(30, 70) : rand(110, 190); g.fillStyle = `rgba(${v|0},${v|0},${v|0},${rand(0.15, 0.5)})`; g.beginPath(); g.arc(Math.random()*s, Math.random()*s, rand(0.6, 2.6), 0, TAU); g.fill(); }
}, [0.004, 0.004], true);
// diamond knurl as a normal map with shaded valleys
function knurlMaps(){
  const size = 64, nC = document.createElement('canvas'), cC = document.createElement('canvas');
  nC.width = nC.height = cC.width = cC.height = size;
  const nG = nC.getContext('2d'), cG = cC.getContext('2d'), nD = nG.createImageData(size, size), cD = cG.createImageData(size, size);
  const frac = t => t - Math.floor(t);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++){
    const x = (i + 0.5)/size, y = (j + 0.5)/size, fa = frac(x + y), fb = frac(x - y);
    const a = 1 - 2*Math.abs(fa - 0.5), b = 1 - 2*Math.abs(fb - 0.5);
    let h, gx, gy;
    if (a < b){ h = a; const s = fa < 0.5 ? 2 : -2; gx = s; gy = s; } else { h = b; const s = fb < 0.5 ? 2 : -2; gx = s; gy = -s; }
    if (h > 0.78){ gx = 0; gy = 0; }
    let nx = -gx*1.1, ny = gy*1.1, nz = 1; const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const k = (j*size + i)*4;
    nD.data[k] = (nx*0.5 + 0.5)*255; nD.data[k+1] = (ny*0.5 + 0.5)*255; nD.data[k+2] = (nz*0.5 + 0.5)*255; nD.data[k+3] = 255;
    const sh = 120 + 118*Math.pow(Math.min(h/0.78, 1), 0.55); cD.data[k] = sh; cD.data[k+1] = sh + 1; cD.data[k+2] = sh + 4; cD.data[k+3] = 255;
  }
  nG.putImageData(nD, 0, 0); cG.putImageData(cD, 0, 0);
  return { nC, cC };
}
const KN = knurlMaps();
function knurlMat(ru, rv, color){
  const map = new T.CanvasTexture(KN.cC), nrm = new T.CanvasTexture(KN.nC);
  for (const t of [map, nrm]){ t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(ru, rv); t.anisotropy = MAX_ANISO; }
  map.colorSpace = T.SRGBColorSpace;
  return new T.MeshStandardMaterial({ map, normalMap: nrm, color: color || 0xffffff, metalness: 1, roughness: 0.42 });
}

/* ---------- finishes: ground, lapped and turned surfaces, as they come off the machines ---------- */
// surface grinding: fine straight lines, a little uneven
const groundTex = canvasTex(256, 256, (g, w, h) => { rows(g, w, h, 180, 70); g.globalAlpha = 0.12; for (let i = 0; i < 120; i++){ const y = Math.random()*h; g.fillStyle = Math.random() < 0.5 ? '#fff' : '#555'; g.fillRect(0, y, w, 1); } }, [0.06, 0.06]);
// lapping: a fine random cross-hatch
const lappedTex = canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#c8c8c8'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 1800; i++){ const x = Math.random()*w, y = Math.random()*h, a = Math.random()*Math.PI, L = 4 + Math.random()*14, v = Math.random() < 0.5 ? 235 : 150;
    g.strokeStyle = 'rgba(' + v + ',' + v + ',' + v + ',0.35)'; g.lineWidth = 0.7; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a)*L, y + Math.sin(a)*L); g.stroke(); }
}, [0.05, 0.05]);
// turning: rings around the part
const turnedTex = canvasTex(64, 256, (g, w, h) => rows(g, w, h, 170, 100), [1, 8]);
turnedTex.rotation = Math.PI/2;
/* ---------- materials ---------- */
const std = o => new T.MeshStandardMaterial(o);
const M = {
  beam: std({ color: 0xdfe2e6, metalness: 1, roughness: 0.3, roughnessMap: brushedV }),
  steel: std({ color: 0xd6d9dd, metalness: 1, roughness: 0.34, roughnessMap: groundTex, bumpMap: groundTex, bumpScale: 0.12 }),
  plate: std({ color: 0xe6e8eb, metalness: 0.85, roughness: 0.5, roughnessMap: satinTex }),
  black: std({ color: 0x17181a, metalness: 0.35, roughness: 0.45 }),
  base: std({ color: 0x9aa0a7, map: hammerMap, bumpMap: hammerBump, bumpScale: 0.6, metalness: 0.45, roughness: 0.55 }),
  baseGround: std({ color: 0xb8bdc3, metalness: 0.9, roughness: 0.35, roughnessMap: groundTex, bumpMap: groundTex, bumpScale: 0.1 }),
  brass: std({ color: 0xc9a24a, metalness: 1, roughness: 0.34 }),
  carbide: std({ color: 0x5a5f66, metalness: 0.85, roughness: 0.28, roughnessMap: lappedTex }),
  cap: std({ color: 0xa9adb3, metalness: 0.2, roughness: 0.55 }),
  screw: std({ color: 0xb4b8bd, metalness: 1, roughness: 0.3, roughnessMap: turnedTex }),
  screwHead: std({ color: 0x6d7076, metalness: 1, roughness: 0.42, roughnessMap: turnedTex }),
  granite: std({ color: 0x4a4e55, map: granite, metalness: 0, roughness: 0.78 }),
  line: new T.MeshBasicMaterial({ color: 0x0a0a0a, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
  pick: new T.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false })
};
M.knurl = knurlMat(22, 3);

/* ---------- clear markings by default; the realistic metal finish is a setting ----------
   The turned and brushed finish puts streaks and reflections behind the graduations and makes them
   harder to read, so by default the surfaces that carry markings are a plain, even matte grey.
   "Realistic metal finish" in the sidebar brings the real finish back; the choice is remembered. */
const CLEAR_MATS = () => [[M.beam, 0xe2e4e7], [M.plate, 0xe8eaec]];
let realFinish = false;
try { realFinish = localStorage.getItem('pt-real-finish') === '1'; } catch (e) {}
function applyFinish() {
  shopFinish(scene);                   // the shop finish lands first, so what is saved is the real look
  for (const [m, hex] of CLEAR_MATS()) {
    if (!m) continue;
    if (!m.userData.real) m.userData.real = { map: m.map, roughnessMap: m.roughnessMap, bumpMap: m.bumpMap, color: m.color.clone(), metalness: m.metalness, roughness: m.roughness, env: m.envMapIntensity };
    const r = m.userData.real;
    if (realFinish) {
      m.map = r.map; m.roughnessMap = r.roughnessMap; m.bumpMap = r.bumpMap; m.color.copy(r.color);
      m.metalness = r.metalness; m.roughness = r.roughness; m.envMapIntensity = r.env;
    } else {
      m.map = null; m.roughnessMap = null; m.bumpMap = null; m.color.setHex(hex);
      m.metalness = 0.3; m.roughness = 0.6; m.envMapIntensity = 0.55;
    }
    m.needsUpdate = true;
  }
  
}
function bindFinish() {
  const c = document.getElementById('realChk');
  c.checked = realFinish;
  c.addEventListener('change', () => { realFinish = c.checked; try { localStorage.setItem('pt-real-finish', realFinish ? '1' : '0'); } catch (e) {} applyFinish(); });
  applyFinish();
}

M.knurlSmall = knurlMat(14, 3);
M.knurlBrass = knurlMat(14, 2, 0xd9b45c);
const HLC = { imain: cssVar('--hl-main'), ivern: cssVar('--hl-vern'), mmain: cssVar('--hl-mmain'), mvern: cssVar('--hl-mvern') };
const hlMat = c => new T.MeshBasicMaterial({ color: new T.Color(c), toneMapped: false, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5 });

/* ---------- geometry helpers ---------- */
function shade(m){ m.castShadow = true; m.receiveShadow = true; return m; }
function box(x0, x1, y0, y1, z0, z1, mat){
  const g = new T.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
  g.translate((x0 + x1)/2, (y0 + y1)/2, (z0 + z1)/2);
  return shade(new T.Mesh(g, mat));
}
// rounded box: an extruded rounded rectangle, for anything that should not look like a primitive
function rbox(x0, x1, y0, y1, z0, z1, r, mat){
  const w = x1 - x0, h = y1 - y0, d = z1 - z0, b = Math.min(r, w/3, h/3, d/3);
  const s = new T.Shape(), x = b, y = b, W = w - 2*b, H = h - 2*b, c = Math.min(b, W/2, H/2)*0.001;
  s.moveTo(x, y); s.lineTo(x + W, y); s.lineTo(x + W, y + H); s.lineTo(x, y + H); s.closePath();
  const g = new T.ExtrudeGeometry(s, { depth: d - 2*b, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: 3, curveSegments: 8 });
  g.translate(x0, y0, z0 + b);
  return shade(new T.Mesh(g, mat));
}
// a cylinder along an axis ('x', 'y' or 'z') between two coordinates
function cyl(r, a0, a1, axis, at, mat, seg){
  const g = new T.CylinderGeometry(r, r, Math.abs(a1 - a0), seg || 40);
  const mid = (a0 + a1)/2;
  if (axis === 'x'){ g.rotateZ(-Math.PI/2); g.translate(mid, at[0], at[1]); }
  else if (axis === 'z'){ g.rotateX(Math.PI/2); g.translate(at[0], at[1], mid); }
  else g.translate(at[0], mid, at[1]);
  return shade(new T.Mesh(g, mat));
}
// flat line work: rectangles on a plane facing +z
function Quads(){ this.p = []; this.i = []; }
Quads.prototype.rect = function(x0, y0, x1, y1, z){
  const n = this.p.length/3;
  this.p.push(x0, y0, z, x1, y0, z, x1, y1, z, x0, y1, z);
  this.i.push(n, n+1, n+2, n, n+2, n+3);
  return this;
};
Quads.prototype.geo = function(){
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(this.p, 3)); g.setIndex(this.i);
  g.computeBoundingSphere();
  return g;
};

// numbers and labels from one texture atlas
let atlas = null;
function makeAtlas(strings){
  const px = 96, pad = 10, maxW = 1024, cellH = Math.round(px*1.2);
  const c = document.createElement('canvas'), g = c.getContext('2d');
  const font = `600 ${px}px Arial, Helvetica, sans-serif`; g.font = font;
  let x = 0, y = 0;
  const items = [...new Set(strings)].map(s => ({ s, w: Math.ceil(g.measureText(s).width) + pad*2 }));
  items.forEach(it => { if (x + it.w > maxW){ x = 0; y += cellH + 4; } it.x = x; it.y = y; x += it.w + 4; });
  c.width = maxW; c.height = T.MathUtils.ceilPowerOfTwo(y + cellH + 4);
  g.font = font; g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  const rects = {};
  items.forEach(it => {
    g.fillText(it.s, it.x + it.w/2, it.y + cellH/2 + px*0.04);
    rects[it.s] = { u0: it.x/c.width, u1: (it.x + it.w)/c.width, v1: 1 - it.y/c.height, v0: 1 - (it.y + cellH)/c.height, aspect: it.w/cellH };
  });
  const tex = new T.CanvasTexture(c); tex.colorSpace = T.SRGBColorSpace; tex.anisotropy = MAX_ANISO;
  const base = { map: tex, transparent: true, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 };
  return { rects, mat: new T.MeshBasicMaterial(Object.assign({ color: 0x0a0a0a }, base)), tex, base };
}
function TextBatch(){ this.p = []; this.uv = []; this.i = []; }
// h = cap height; anchor 'c' center, 'l' left, 'r' right; rot = quarter turns
TextBatch.prototype.add = function(s, h, x, y, z, anchor, rot){
  const r = atlas.rects[s]; if (!r) return;
  const H = h*1.2, W = H*r.aspect, n = this.p.length/3;
  const ox = anchor === 'l' ? W/2 : anchor === 'r' ? -W/2 : 0;
  const cs = Math.cos((rot || 0)*Math.PI/2), sn = Math.sin((rot || 0)*Math.PI/2);
  [[-W/2, -H/2], [W/2, -H/2], [W/2, H/2], [-W/2, H/2]].forEach(([u, v]) => {
    const px = u + ox, py = v;
    this.p.push(x + px*cs - py*sn, y + px*sn + py*cs, z);
  });
  this.uv.push(r.u0, r.v0, r.u1, r.v0, r.u1, r.v1, r.u0, r.v1);
  this.i.push(n, n+1, n+2, n, n+2, n+3);
};
TextBatch.prototype.geo = function(){
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(this.p, 3));
  g.setAttribute('uv', new T.Float32BufferAttribute(this.uv, 2));
  g.setIndex(this.i); g.computeBoundingSphere();
  return g;
};
// a free-standing printed label (canvas text on a plane)
function label(lines, w, h, opts){
  const o = Object.assign({ bg: null, color: '#101113', font: 'Arial, Helvetica, sans-serif' }, opts || {});
  const ppm = 24, c = document.createElement('canvas'); c.width = Math.round(w*ppm); c.height = Math.round(h*ppm);
  const g = c.getContext('2d');
  if (o.bg){ g.fillStyle = o.bg; g.fillRect(0, 0, c.width, c.height); }
  g.textAlign = 'center'; g.textBaseline = 'middle';
  for (const L of lines){
    g.fillStyle = L.color || o.color;
    g.font = `${L.weight || 600} ${L.size*ppm}px ${L.font || o.font}`;
    g.save(); g.translate(c.width/2 + (L.x || 0)*ppm, (L.y)*ppm); if (L.sx) g.scale(L.sx, 1); g.fillText(L.t, 0, 0); g.restore();
  }
  const tex = new T.CanvasTexture(c); tex.colorSpace = T.SRGBColorSpace; tex.anisotropy = MAX_ANISO;
  const m = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ map: tex, transparent: !o.bg, depthWrite: !!o.bg, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  return m;
}

/* ---------- build the height gage ---------- */
const root = new T.Group(); scene.add(root);
const pickables = [];
function pickable(o, kind){ o.traverse(c => { c.userData.kind = kind; if (c.isMesh) pickables.push(c); }); return o; }
let scaleG, sliderG, scriberG, unitG, nutG, zeroKnob, clampSliderG, clampUnitG, partG = null;
const HL = {};

let tableMesh = null;
// the table button: shows or hides the granite table, remembered between visits
function setTable(off){
  if (tableMesh) tableMesh.visible = !off;
  const b = $('tableBtn'), t = off ? 'Show the table' : 'Hide the table';
  b.setAttribute('aria-pressed', String(off)); b.setAttribute('aria-label', t);
  b.dataset.tip = t + (off ? '\nPuts the granite table back under the gage.' : '\nTakes the granite table out of the picture.');
  try { localStorage.setItem('pt-table-off', off ? '1' : '0'); } catch (e) {}
}
function buildGage(){
  atlas = makeAtlas([...Array(51).keys()].map(String).concat(['12 in.', '30cm', '0.02mm', 'IN']));

  // granite surface plate
  const plate = box(GRANITE.x0, GRANITE.x1, -60, 0, GRANITE.z0, GRANITE.z1, M.granite);
  plate.castShadow = false; plate.userData.noFit = true;
  root.add(plate); tableMesh = plate;

  // base: one hammertone casting on a ground and lapped band. It is flat and full height where
  // the beam stands in it, then eases down to a lower deck. The outline is drawn 4 mm inside its
  // final size; the bevel grows it back to BASE_X0..BASE_X1 x 3..BASE_H x BASE_D.
  const s = new T.Shape(), b = 4;
  s.moveTo(BASE_X0 + b, 3 + b); s.lineTo(BASE_X1 - b - 6, 3 + b);
  s.quadraticCurveTo(BASE_X1 - b, 3 + b, BASE_X1 - b, 13);
  s.lineTo(BASE_X1 - b, 24);
  s.quadraticCurveTo(BASE_X1 - b, 30, BASE_X1 - b - 8, 30);
  s.lineTo(76, 30);
  s.bezierCurveTo(62, 30, 56, BASE_H - b, 42, BASE_H - b);
  s.lineTo(BASE_X0 + b, BASE_H - b);
  s.closePath();
  const baseG = new T.ExtrudeGeometry(s, { depth: BASE_D - 2*b, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: 4, curveSegments: 32 });
  baseG.translate(0, 0, -BASE_D/2 + b);
  root.add(pickable(shade(new T.Mesh(baseG, M.base)), 'none'));
  root.add(pickable(rbox(BASE_X0 + 0.5, BASE_X1 - 0.5, 0, 3.2, -BASE_D/2 + 0.5, BASE_D/2 - 0.5, 1, M.baseGround), 'none'));
  // machined boss where the beam is clamped into the casting
  root.add(pickable(rbox(BEAM_X0 - 4, BEAM_X1 + 4, BASE_H - 1, BASE_H + 5, BEAM_Z0 - 4, BEAM_Z1 + 4, 1.2, M.baseGround), 'none'));

  // beam
  root.add(pickable(rbox(BEAM_X0, BEAM_X1, 20, H_TOTAL, BEAM_Z0, BEAM_Z1, 0.8, M.beam), 'none'));
  // printing near the top of the beam (fixed; the scale strip below it slides)
  const top = label([
    { t: 'STAINLESS', y: 22.5, size: 1.8, weight: 600 },
    { t: 'HARDENED', y: 25.3, size: 1.8, weight: 600 }
  ], 26, 28);
  top.position.set(14, 430, BEAM_Z1 + 0.03);
  root.add(top);

  // main scale strip: dual scale on the beam face, adjustable for zero
  scaleG = new T.Group(); root.add(scaleG);
  const q = new Quads(), tb = new TextBatch(), z = BEAM_Z1 + 0.03, lw = 0.17;
  const imainGeo = [], mmainGeo = [];
  for (let j = 0; j <= 240; j++){
    const y = SCALE_Y0 + j*IN_MAIN, L = j % 20 === 0 ? 7.5 : j % 10 === 0 ? 6 : j % 2 === 0 ? 4.6 : 3.2;
    q.rect(0, y - lw/2, L, y + lw/2, z);
    imainGeo.push(new Quads().rect(0, y - 0.18, L + 0.4, y + 0.18, z + 0.01).geo());
    if (j % 20 === 0) tb.add(String(j/20), 3.2, 10.6, y, z, 'c');
    else if (j % 4 === 0) tb.add(String((j/2) % 10), 1.9, 8.9, y, z, 'c');
  }
  for (let m = 0; m <= RANGE; m++){
    const y = SCALE_Y0 + m, L = m % 10 === 0 ? 7.5 : m % 5 === 0 ? 5.6 : 3.6;
    q.rect(BEAM_X1 - L, y - lw/2, BEAM_X1, y + lw/2, z);
    mmainGeo.push(new Quads().rect(BEAM_X1 - L - 0.4, y - 0.18, BEAM_X1, y + 0.18, z + 0.01).geo());
    if (m % 10 === 0) tb.add(String(m/10), 3.2, 19.2, y, z, 'c');
  }
  tb.add('12 in.', 2.4, 1.5, SCALE_Y0 + 12*IN + 7, z, 'l');
  tb.add('30cm', 2.4, 26.5, SCALE_Y0 + 300 + 7, z, 'r');
  scaleG.add(new T.Mesh(q.geo(), M.line), new T.Mesh(tb.geo(), atlas.mat));
  HL.imain = hlOn(scaleG, HLC.imain, imainGeo);
  HL.mmain = hlOn(scaleG, HLC.mmain, mmainGeo);
  // the slotted black plate at the top belongs to the scale strip and slides past the knob
  scaleG.add(rbox(4, 24, 456, 512, BEAM_Z1 - 0.2, BEAM_Z1 + 1.2, 0.6, M.black));
  scaleG.add(box(11.5, 16.5, 464, 504, BEAM_Z1 + 1.2, BEAM_Z1 + 1.25, new T.MeshBasicMaterial({ color: 0x050505 })));

  // main-scale adjustment knob (fixed to the beam)
  zeroKnob = new T.Group(); zeroKnob.position.set(14, 484, 0); root.add(zeroKnob);
  zeroKnob.add(cyl(3, BEAM_Z1, BEAM_Z1 + 3, 'z', [0, 0], M.steel));
  zeroKnob.add(cyl(9, BEAM_Z1 + 2.5, BEAM_Z1 + 9, 'z', [0, 0], M.knurl, 64));
  zeroKnob.add(cyl(6.5, BEAM_Z1 + 9, BEAM_Z1 + 9.6, 'z', [0, 0], M.steel, 48));
  zeroKnob.add(cyl(2.6, BEAM_Z1 + 9.6, BEAM_Z1 + 10.4, 'z', [0, 0], M.screw, 24));
  zeroKnob.add(box(-2.2, 2.2, -0.35, 0.35, BEAM_Z1 + 10.35, BEAM_Z1 + 10.45, M.black));
  pickable(zeroKnob, 'zeroKnob');

  // slider (local y = 0 at its bottom edge)
  sliderG = new T.Group(); root.add(sliderG);
  sliderG.add(rbox(SL_X0, 0, 0, SL_H, SL_Z0, BEAM_Z1, 1, M.steel));
  sliderG.add(rbox(BEAM_X1, SL_X1, 0, SL_H, SL_Z0, BEAM_Z1, 1, M.steel));
  sliderG.add(box(0, BEAM_X1, 0, SL_H, SL_Z0, BEAM_Z0, M.steel));
  sliderG.add(box(2, 26, SL_H - 2.2, SL_H, BEAM_Z1, PLATE_Z, M.steel));
  // vernier plates: inch on the left, metric on the right
  sliderG.add(rbox(SL_X0, 2, 1.2, SL_H - 1.2, BEAM_Z1, PLATE_Z, 0.5, M.plate));
  sliderG.add(rbox(26, SL_X1, 1.2, SL_H - 1.2, BEAM_Z1, PLATE_Z, 0.5, M.plate));
  for (const [x, y] of [[-11.5, 7.5], [-11.5, 62.5], [43.5, 7.5], [43.5, 62.5]]){
    // pan-head mounting screw with a cross recess
    sliderG.add(cyl(2.3, PLATE_Z, PLATE_Z + 0.5, 'z', [x, y], M.screwHead, 28));
    sliderG.add(cyl(2.0, PLATE_Z + 0.5, PLATE_Z + 1.0, 'z', [x, y], M.screwHead, 28));
    sliderG.add(box(x - 1.3, x + 1.3, y - 0.22, y + 0.22, PLATE_Z + 1.0, PLATE_Z + 1.05, M.black));
    sliderG.add(box(x - 0.22, x + 0.22, y - 1.3, y + 1.3, PLATE_Z + 1.0, PLATE_Z + 1.05, M.black));
  }
  const vq = new Quads(), vt = new TextBatch(), vz = PLATE_Z + 0.03, ivGeo = [], mvGeo = [];
  for (let k = 0; k <= 50; k++){
    const y = V0 + k*IN_VDIV, L = k % 5 === 0 ? 5 : 3.2;
    vq.rect(2 - L, y - lw/2, 2, y + lw/2, vz);
    ivGeo.push(new Quads().rect(2 - L - 0.4, y - 0.18, 2, y + 0.18, vz + 0.01).geo());
    if (k % 5 === 0) vt.add(String(k), 2.3, -6.4, y, vz, 'c');
  }
  for (let k = 0; k <= 50; k++){
    const y = V0 + k*MM_VDIV, L = k % 5 === 0 ? 5 : 3.2;
    vq.rect(26, y - lw/2, 26 + L, y + lw/2, vz);
    mvGeo.push(new Quads().rect(26, y - 0.18, 26 + L + 0.4, y + 0.18, vz + 0.01).geo());
    if (k % 5 === 0) vt.add(String(k/5), 2.3, 34.8, y, vz, 'c');
  }
  vt.add('0.02mm', 2.0, 45.5, SL_H - 11, vz, 'r');
  vt.add('IN', 2.0, -13.5, SL_H - 11, vz, 'l');
  sliderG.add(new T.Mesh(vq.geo(), M.line), new T.Mesh(vt.geo(), atlas.mat));
  HL.ivern = hlOn(sliderG, HLC.ivern, ivGeo);
  HL.mvern = hlOn(sliderG, HLC.mvern, mvGeo);
  // slider clamp knob, right side
  clampSliderG = clampKnob(40); sliderG.add(clampSliderG); pickable(clampSliderG, 'clampSlider');
  // scriber arm, clamp and the 07GZA000 carbide-tipped scriber
  sliderG.add(rbox(-21, -14, -26, 30, -3, 5, 0.6, M.black));
  sliderG.add(rbox(-36, -19, -30, -12, -1, 12, 1, M.steel));
  sliderG.add(cyl(2, -12, -8, 'y', [-27.5, 5.5], M.screw));
  sliderG.add(cyl(4.3, -8, -1.5, 'y', [-27.5, 5.5], M.knurlBrass, 32));
  sliderG.add(cyl(3.6, -1.5, -1, 'y', [-27.5, 5.5], M.brass, 32));
  const sc = new T.Shape();
  sc.moveTo(-100, -47); sc.lineTo(-50, -47); sc.lineTo(-50, -24); sc.lineTo(-20, -24); sc.lineTo(-20, -15);
  sc.lineTo(-58, -15); sc.lineTo(-58, -38); sc.lineTo(-86, -38); sc.lineTo(-100, -45.6); sc.closePath();
  // the scriber can sit a little high or low in its clamp: that is what zero-setting corrects
  scriberG = new T.Group(); sliderG.add(scriberG);
  const scG = new T.ExtrudeGeometry(sc, { depth: TIP_Z1 - TIP_Z0, bevelEnabled: false });
  scG.translate(0, 0, TIP_Z0);
  scriberG.add(pickable(shade(new T.Mesh(scG, M.steel)), 'slider'));
  scriberG.add(box(-100, -89, -47.02, -45.2, TIP_Z0 + 0.1, TIP_Z1 - 0.1, M.carbide));
  // fine-feed screw, fixed to the slider and running up through the unit into the nut. It is cut so
  // its end stays inside the nut at the smallest gap, so it never sticks out of the top
  sliderG.add(cyl(2.1, SL_H, SL_H + FINE_MIN + UNIT_H + 9.5, 'y', [40, -1], M.screw, 20));
  sliderG.children.forEach(c => { if (!c.userData.kind) pickable(c, 'slider'); });

  // fine-feed unit (local y = 0 at its bottom)
  unitG = new T.Group(); root.add(unitG);
  unitG.add(rbox(SL_X0, SL_X1, 0, UNIT_H, SL_Z0, 7, 1.2, M.steel));
  const tag = label([{ t: 'HEIGHT GAGE', y: 3.5, size: 3.6, weight: 800, sx: 0.78, color: '#15171a' }], 36, 7, { bg: '#e9ebee' });
  tag.position.set(14, UNIT_H/2, 7.03); unitG.add(tag);
  clampUnitG = clampKnob(UNIT_H/2); unitG.add(clampUnitG); pickable(clampUnitG, 'clampUnit');
  nutG = new T.Group(); nutG.position.set(40, UNIT_H, -1); unitG.add(nutG);
  // thumb nut: a thin washer on the block, the knurled body, and a crowned cap over the screw end
  nutG.add(cyl(6.6, 0, 0.8, 'y', [0, 0], M.steel, 40));
  nutG.add(cyl(6, 0.8, 10.2, 'y', [0, 0], M.knurlSmall, 40));
  nutG.add(cyl(5.6, 10.2, 11, 'y', [0, 0], M.steel, 40));
  nutG.add(cyl(4.6, 11, 11.6, 'y', [0, 0], M.steel, 40));
  pickable(nutG, 'nut');
  unitG.children.forEach(c => { if (!c.userData.kind) pickable(c, 'unit'); });
}
// a locked part turns solid red, and stays red until it is released
const lockRedCache = new Map();
function lockRedOf(mat){
  let r = lockRedCache.get(mat);
  if (!r){
    r = mat.clone(); r.color = new T.Color(0xd8261b);
    r.metalness = Math.min(r.metalness, 0.45); r.roughness = Math.max(r.roughness, 0.3);
    r.emissive = new T.Color(0x4a0603); r.emissiveIntensity = 1;
    lockRedCache.set(mat, r);
  }
  return r;
}
function paintLock(parts, v){ parts.forEach(o => { if (!o.userData.lockBase) o.userData.lockBase = o.material; o.material = v ? lockRedOf(o.userData.lockBase) : o.userData.lockBase; }); }
const lockMeshes = g => { const out = []; g.traverse(o => { if (o.isMesh && o.material && o.material.colorWrite !== false && !o.material.isShaderMaterial) out.push(o); }); return out; };
// knurled clamp screw on the right-hand side of the slider or the unit
function clampKnob(y){
  const g = new T.Group(); g.position.set(0, y, -1);   // pivot on the screw axis so it can turn
  g.add(cyl(2.2, SL_X1, SL_X1 + 4, 'x', [0, 0], M.screw, 20));
  g.add(cyl(5, SL_X1 + 3.5, SL_X1 + 12.5, 'x', [0, 0], M.knurlSmall, 40));
  g.add(cyl(4.3, SL_X1 + 12.5, SL_X1 + 14, 'x', [0, 0], M.cap, 32));
  return g;
}
// one highlight mesh that can be pointed at any line of a scale
function hlOn(parent, color, geos){
  const m = new T.Mesh(geos[0], hlMat(color));
  m.visible = false; m.renderOrder = 5;
  parent.add(m);
  return { set(i){ if (i < 0 || i >= geos.length){ m.visible = false; return; } m.geometry = geos[i]; m.visible = true; } };
}

/* ---------- parts on the plate: boxes and cylinders standing on y = 0 ---------- */
const boxS = (x0, x1, z0, z1, y1, feat) => ({ t: 'box', x0, x1, z0, z1, y1, feat });
const cylS = (cx, cz, r, y1, feat) => ({ t: 'cyl', cx, cz, r, y1, feat });
const jitter = (nom, mm) => Math.round((nom + rand(-mm, mm))*1000)/1000;
// every feature is placed so the scriber tip lands on it with lower material to its right,
// under the rest of the scriber
const PARTS = {
  step: { name: 'Step block', mat: 'ground',
    make(){
      const hs = [jitter(95, 2.5), jitter(70, 2.5), jitter(45, 2.5), jitter(20, 2.5)];
      const solids = hs.map((h, i) => boxS(i*22, i*22 + 22, -20, 20, h, 's' + i));
      return { solids, feats: hs.map((h, i) => ({ id: 's' + i, label: `Step ${i + 1}`, value: h })),
        targets: Object.fromEntries(hs.map((h, i) => ['s' + i, [i*22 + 15, 0]])) };
    } },
  blocks: { name: 'Gage blocks (reference)', mat: 'lapped', ref: true,
    make(){
      const hs = [100, 2.5*IN, 1*IN], names = ['100 mm', '2.5000″', '1.0000″'];
      const solids = hs.map((h, i) => boxS(i*18, i*18 + 9, -17.5, 17.5, h, 'b' + i));
      return { solids, feats: hs.map((h, i) => ({ id: 'b' + i, label: `${names[i]} gage block`, value: h })),
        targets: Object.fromEntries(hs.map((h, i) => ['b' + i, [i*18 + 4.5, 0]])), labels: names };
    } },
  pin: { name: 'Shouldered shaft', mat: 'turned',
    make(){
      const top = jitter(178, 3), sh = jitter(42, 1.5);
      return { solids: [cylS(0, 0, 16, top, 'top'), cylS(0, 0, 30, sh, 'sh')],
        feats: [{ id: 'top', label: 'Top of the shaft', value: top }, { id: 'sh', label: 'Shoulder', value: sh }],
        targets: { top: [8, 0], sh: [23, 0] } };
    } },
  riser: { name: 'Riser block', mat: 'ground',
    make(){
      const h = jitter(252, 3);
      return { solids: [boxS(0, 60, -25, 25, h, 'top')], feats: [{ id: 'top', label: 'Top of the riser', value: h }],
        targets: { top: [52, 0] } };
    } },
  plate: { name: 'Surface plate (zero check)', ref: true,
    make(){ return { solids: [], feats: [{ id: 'z', label: 'Surface plate', value: 0 }], targets: { z: [0, 0] } }; } }
};
const PMAT = {
  ground: std({ color: 0xbfc4ca, metalness: 1, roughness: 0.38, roughnessMap: groundTex, bumpMap: groundTex, bumpScale: 0.12 }),
  lapped: std({ color: 0xdadde1, metalness: 1, roughness: 0.18, roughnessMap: lappedTex, bumpMap: lappedTex, bumpScale: 0.05 }),
  turned: std({ color: 0xc6cbd1, metalness: 1, roughness: 0.45, roughnessMap: turnedTex, bumpMap: turnedTex, bumpScale: 0.1 })
};
Object.values(PMAT).forEach(m => { m.vertexColors = true; });   // lets a face of the part change color
// parts get a shop-floor finish: grey metal that scatters most of the light, with soft broad
// highlights, instead of a chrome mirror of the dark room. Only lapped faces stay fairly bright.
// (A roughness map darkens roughness, so the base value is raised to land on the target.)
function partFinish(m, metal, rough, o){
  o = o || {};
  m.color.multiplyScalar(o.tone || 0.86);
  m.metalness = metal;
  m.roughness = m.roughnessMap ? Math.min(1, rough/0.62) : rough;
  m.envMapIntensity = o.env || 0.5;
  if (m.bumpMap) m.bumpScale *= o.bump || 0.5;
  m.needsUpdate = true;
  _finished.add(m);                  // already finished: the shop-finish pass leaves it alone
}
partFinish(PMAT.ground, 0.5, 0.46);
partFinish(PMAT.lapped, 0.62, 0.3, { env: 0.6 });
partFinish(PMAT.turned, 0.5, 0.54);
const topHL = std({ color: 0x2fd36b, metalness: 0.35, roughness: 0.4, emissive: 0x0d4a22, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
let topMeshes = {}, litTop = null;
function paintTop(id){
  if (id === litTop) return;
  const tint = (e, r, g, b) => { if (!e) return; const C = e.mesh.geometry.attributes.color; for (const v of e.top) C.setXYZ(v, r, g, b); C.needsUpdate = true; };
  tint(topMeshes[litTop], 1, 1, 1);
  tint(topMeshes[id], 0.28, 0.95, 0.42);
  litTop = id;
}


function unionPath(rects, c){
  const bs = [...new Set(rects.flatMap(r => [r.b0, r.b1]))].sort((p, q) => p - q), S = [];
  for (let i = 0; i < bs.length - 1; i++){
    const m = (bs[i] + bs[i + 1])/2, cov = rects.filter(r => r.b0 <= m && r.b1 >= m);
    if (!cov.length) continue;
    const s = { b0: bs[i], b1: bs[i + 1], lo: Math.min(...cov.map(r => r.a0)), hi: Math.max(...cov.map(r => r.a1)) }, l = S[S.length - 1];
    if (l && Math.abs(l.hi - s.hi) < 1e-9 && Math.abs(l.lo - s.lo) < 1e-9 && Math.abs(l.b1 - s.b0) < 1e-9) l.b1 = s.b1; else S.push(s);
  }
  const cc = s => Math.max(0, Math.min(c || 0, (s.b1 - s.b0)/3, (s.hi - s.lo)/3));
  const pts = [[S[0].lo, S[0].b0]];
  const k0 = cc(S[0]); if (k0) pts.push([S[0].hi - k0, S[0].b0], [S[0].hi, S[0].b0 + k0]); else pts.push([S[0].hi, S[0].b0]);
  S.forEach((s, i) => {
    const n = S[i + 1], k = cc(s);
    if (!n){ if (k) pts.push([s.hi, s.b1 - k], [s.hi - k, s.b1]); else pts.push([s.hi, s.b1]); return; }
    const kn = Math.min(k, cc(n));
    if (s.hi > n.hi && kn){ pts.push([s.hi, s.b1 - kn], [s.hi - kn, s.b1], [n.hi, s.b1]); }
    else if (s.hi < n.hi && kn){ pts.push([s.hi, s.b1], [n.hi - kn, s.b1], [n.hi, s.b1 + kn]); }
    else pts.push([s.hi, s.b1], [n.hi, s.b1]);
  });
  const L = S[S.length - 1];
  pts.push([L.lo, L.b1]);
  if (S.every(s => s.lo === 0)) return pts;                       // solid of revolution: stop at the axis
  for (let i = S.length - 1; i >= 0; i--){ const s = S[i], p = S[i - 1]; pts.push([s.lo, s.b0]); if (p) pts.push([p.lo, s.b0]); }
  const out = pts.filter((p, i) => i === 0 || Math.abs(p[0] - pts[i - 1][0]) > 1e-9 || Math.abs(p[1] - pts[i - 1][1]) > 1e-9);
  return out;
}

// the part drawn as one solid: stacked boxes become one extruded profile, coaxial cylinders one turned
// piece. Separate things (like a row of gage blocks) stay separate.
function partMeshes(P, mat){
  const S = P.solids;
  const same = (k) => S.every(s => Math.abs(s[k] - S[0][k]) < 1e-9);
  if (S.length > 1 && S.every(s => s.t === 'box') && same('z0') && same('z1')){
    const xs = [...S].sort((p, q) => p.x0 - q.x0);
    if (xs.every((s, i) => i === 0 || Math.abs(s.x0 - xs[i - 1].x1) < 1e-6)){
      const pts = unionPath(S.map(s => ({ a0: 0, a1: s.y1, b0: s.x0, b1: s.x1 })));
      const sh = new T.Shape(pts.map(([a, b]) => new T.Vector2(b, a)));
      const g = new T.ExtrudeGeometry(sh, { depth: S[0].z1 - S[0].z0, bevelEnabled: false });
      g.translate(0, 0, S[0].z0);
      return [{ mesh: shade(new T.Mesh(g, mat)), solids: S }];
    }
  }
  if (S.length > 1 && S.every(s => s.t === 'cyl') && same('cx') && same('cz')){
    // widest first, each narrower one standing on it, open at the bottom so no hidden face lies on another.
    // (openEnded would drop the top cap too, leaving the step hollow, so only the bottom cap is cut away.)
    const byR = [...S].sort((p, q) => q.r - p.r), geos = [];
    let base = 0;
    byR.forEach((s, i) => {
      const h = s.y1 - base, g = new T.CylinderGeometry(s.r, s.r, h, 64, 1, false);
      if (i > 0){
        const idx = g.index.array, keep = [];
        g.groups.forEach(q => { if (q.materialIndex !== 2) for (let k = q.start; k < q.start + q.count; k++) keep.push(idx[k]); });
        g.setIndex(keep); g.clearGroups();
      }
      g.translate(s.cx, base + h/2, s.cz); geos.push(g.toNonIndexed());
      base = s.y1;
    });
    return [{ mesh: shade(new T.Mesh(mergeGeometries(geos), mat)), solids: S }];
  }
  return S.map(s => ({ mesh: s.t === 'box' ? rbox(s.x0, s.x1, 0, s.y1, s.z0, s.z1, 0.6, mat) : cyl(s.r, 0, s.y1, 'y', [s.cx, s.cz], mat, 64), solids: [s] }));
}
function newPart(key, keepSel){
  if (partG){ root.remove(partG); partG.traverse(o => { if (o.geometry) o.geometry.dispose(); }); partG = null; }
  pickables.splice(0, pickables.length, ...pickables.filter(p => p.userData.kind !== 'part'));
  const D = PARTS[key], P = D.make();
  const prevSel = state.part && state.part.sel;
  P.key = key; P.name = D.name; P.ref = !!D.ref; P.revealed = !!D.ref;
  P.sel = keepSel && P.feats.some(f => f.id === prevSel) ? prevSel : P.feats[0].id;
  state.part = P;
  partG = new T.Group(); root.add(partG);
  topMeshes = {}; litTop = null;
  for (const { mesh: m, solids } of partMeshes(P, PMAT[D.mat])){
    partG.add(pickable(m, 'part'));
    if (m.geometry.index) m.geometry = m.geometry.toNonIndexed();
    const g = m.geometry, n = g.attributes.position.count, Pp = g.attributes.position, Nn = g.attributes.normal;
    g.setAttribute('color', new T.BufferAttribute(new Float32Array(n*3).fill(1), 3));
    // each feature's flat top face, which tints green when it is the one being measured
    for (const s of solids){
      const top = [];
      for (let v = 0; v < n; v++){
        if (Nn.getY(v) < 0.99 || Math.abs(Pp.getY(v) - s.y1) > 0.01) continue;
        const x = Pp.getX(v), z = Pp.getZ(v);
        const inside = s.t === 'box' ? x >= s.x0 - 1e-3 && x <= s.x1 + 1e-3 : Math.hypot(x - s.cx, z - s.cz) <= s.r + 0.01;
        if (inside) top.push(v);
      }
      topMeshes[s.feat] = { mesh: m, top };
    }
  }
  P.solids.forEach((s, i) => {
    if (P.labels){
      const lb = label([{ t: P.labels[i], y: 2.4, size: 2.4, weight: 700 }], 17, 4.6);
      lb.rotation.y = -Math.PI/2; lb.position.set(s.x0 - 0.02, Math.min(s.y1 - 6, 20), 0);
      partG.add(lb);
    }
  });
  // park it clear of the scriber
  state.px = TIP_X0 - 150; state.pz = 5.5; state.partTarget = null; state.partGoal = null;
  partG.position.set(state.px, 0, state.pz);
  renderFeats();
  liftForMove();
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// top of a solid if it reaches under a footprint (in part coordinates), else 0
function topUnder(s, x0, x1, z0, z1){
  if (s.t === 'box') return s.x0 < x1 && s.x1 > x0 && s.z0 < z1 && s.z1 > z0 ? s.y1 : 0;
  const cx = clamp(s.cx, x0, x1), cz = clamp(s.cz, z0, z1);
  return (cx - s.cx)**2 + (cz - s.cz)**2 < s.r*s.r ? s.y1 : 0;
}
// h/feat: the highest thing under the scriber face, which is what it rests on.
// hsMin: the lowest the slider can go before anything hanging below it touches the part.
function contactAt(){
  const P = state.part;
  let h = 0, feat = P && P.solids.length === 0 ? 'z' : null, hsMin = -state.eps;
  if (!P) return { h, feat, hsMin };
  UNDER.forEach(([ux0, ux1, uz0, uz1, off, withScriber], i) => {
    const x0 = ux0 - state.px, x1 = ux1 - state.px, z0 = uz0 - state.pz, z1 = uz1 - state.pz;
    let top = 0, f = null;
    for (const s of P.solids){ const t = topUnder(s, x0, x1, z0, z1); if (t > top){ top = t; f = s.feat; } }
    if (i === 0 && f){ h = top; feat = f; }
    hsMin = Math.max(hsMin, top - off - (withScriber ? state.eps : 0));
  });
  return { h, feat, hsMin };
}
const tallest = () => state.part ? Math.max(0, ...state.part.solids.map(s => s.y1)) : 0;
function partBounds(P){
  const b = { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity };
  for (const s of P.solids){
    const r = s.t === 'box' ? [s.x0, s.x1, s.z0, s.z1] : [s.cx - s.r, s.cx + s.r, s.cz - s.r, s.cz + s.r];
    b.x0 = Math.min(b.x0, r[0]); b.x1 = Math.max(b.x1, r[1]); b.z0 = Math.min(b.z0, r[2]); b.z1 = Math.max(b.z1, r[3]);
  }
  return b;
}
// where the part can go: on the plate, and never into the base (it slides along the base instead)
function placePart(x, z){
  const P = state.part, from = state.partGoal || { x: state.px, z: state.pz };
  if (!P || !P.solids.length) return from;
  const b = partBounds(P), m = 3;
  x = clamp(x, GRANITE.x0 + m - b.x0, GRANITE.x1 - m - b.x1);
  z = clamp(z, GRANITE.z0 + m - b.z0, GRANITE.z1 - m - b.z1);
  const hits = (px, pz) => px + b.x1 > BASE_X0 - 1 && px + b.x0 < BASE_X1 + 1 && pz + b.z1 > -BASE_D/2 - 1 && pz + b.z0 < BASE_D/2 + 1;
  // walk there in short steps so a fast flick can't jump across the base; blocked steps slide along it
  let cx = from.x, cz = from.z;
  const n = Math.max(1, Math.ceil(Math.hypot(x - from.x, z - from.z)/4));
  const dx = (x - from.x)/n, dz = (z - from.z)/n;
  for (let i = 0; i < n; i++){
    if (!hits(cx + dx, cz + dz)){ cx += dx; cz += dz; }
    else if (!hits(cx + dx, cz)) cx += dx;
    else if (!hits(cx, cz + dz)) cz += dz;
  }
  return { x: cx, z: cz };
}
// any time the part moves, the scriber first goes to 0.100″ above the part's tallest point and waits there
function liftForMove(){
  if (state.sliderLocked) setLock('sliderLocked', false);
  if (state.unitLocked) setLock('unitLocked', false);
  state.seq = null;
  state.lift = tallest() + CLEAR;
}

/* ---------- mechanism ---------- */
// hs: slider position (scriber face height when the scriber sits exactly in its clamp)
// eps: how far the scriber actually sits from that; delta: main-scale shift
const state = {
  hs: 60, g: 0, eps: 0, delta: 0,
  unitLocked: false, sliderLocked: false,
  part: null, px: 0, pz: 0, partTarget: null, seq: null, contact: { h: 0, feat: null, hsMin: 0 },   // filled in properly by contactAt() once a part is down
  moveGoal: null, lift: null, partGoal: null, partDrag: false, autoLower: false, dwelled: false, partMoveT: 0,
  practice: false, pRevealed: false, pUnitAns: null, exam: false, pScore: { right: 0, total: 0, streak: 0 },
  hl: { imain: false, ivern: false, mmain: false, mvern: false, face: true }
};
const faceH = () => state.hs + state.eps;
const readingMM = () => state.hs - state.delta;
const minHs = () => state.contact.hsMin;
const maxHs = () => RANGE - Math.max(0, state.delta) + 0.5;
const touching = () => faceH() <= state.contact.h + 1e-6;
let toastTimer = 0;
function toast(msg){ const el = $('toast'); el.textContent = msg; el.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2300); }

// coarse movement of slider and unit together
function moveSlider(d, quiet){
  if (state.sliderLocked){ if (!quiet) toast('The slider is clamped — release the lower clamp knob first'); return false; }
  if (state.unitLocked){ if (!quiet) toast('The fine-feed unit is clamped — use the fine-feed nut, or release the upper clamp'); return false; }
  if (!quiet){ state.lift = null; state.autoLower = false; }
  const to = clamp(state.hs + d, minHs(), maxHs());
  if (d < 0 && to <= minHs() + 1e-9 && state.hs > minHs() + 1e-6 && !quiet){
    const face = state.hs + state.eps <= state.contact.h + 1e-6 || to + state.eps <= state.contact.h + 1e-6;
    toast(!face ? 'The scriber clamp is sitting on the part — slide the part so only the scriber is over it' : state.contact.h > 0 ? 'Scriber is resting on the part' : 'Scriber is on the surface plate');
  }
  state.hs = to;
  return true;
}
// the fine-feed nut: with the unit clamped it walks the slider; otherwise it walks the unit
function fineTurn(dg){
  if (state.sliderLocked){ toast('The slider is clamped — release the lower clamp knob first'); return; }
  state.lift = null;
  let g = clamp(state.g + dg, FINE_MIN, FINE_MAX);
  if (state.unitLocked){
    let hs = state.hs - (g - state.g);
    if (hs < minHs()){ g -= (minHs() - hs); hs = minHs(); }
    if (hs > maxHs()){ g += (hs - maxHs()); hs = maxHs(); }
    state.hs = hs;
  }
  if (Math.abs(g - state.g) < 1e-9 && Math.abs(dg) > 0) toast(g <= FINE_MIN + 1e-6 || g >= FINE_MAX - 1e-6 ? 'End of the fine-feed travel — release the upper clamp, move it, and clamp again' : 'Scriber is resting on the part');
  state.g = g;
}
function setLock(which, v){
  state[which] = v;
  const btn = $(which === 'unitLocked' ? 'clampUnit' : 'clampSlider');
  btn.setAttribute('aria-pressed', String(v));
  paintLock(lockMeshes(which === 'unitLocked' ? clampUnitG : clampSliderG), v);
  btn.textContent = (v ? 'Release ' : 'Clamp ') + (which === 'unitLocked' ? 'fine-feed unit' : 'slider');
  toast(which === 'unitLocked' ? (v ? 'Fine-feed unit clamped — the nut now moves the slider' : 'Fine-feed unit released') : (v ? 'Slider clamped' : 'Slider released'));
}
// raise → slide the part in → lower onto the feature
function measureFeature(id){
  const P = state.part; if (!P) return;
  const t = P.targets[id]; if (!t) return;
  P.sel = id; renderFeats();
  if (state.sliderLocked) setLock('sliderLocked', false);
  if (state.unitLocked) setLock('unitLocked', false);
  state.lift = null; state.partGoal = null;
  state.seq = { stage: 'raise', clear: tallest() + CLEAR, x: TIP_X0 + 3.5 - t[0], z: 5.5 - t[1] };
}
function lowerOnto(){
  if (state.sliderLocked) setLock('sliderLocked', false);
  if (state.unitLocked) setLock('unitLocked', false);
  state.lift = null; state.partGoal = null;
  state.seq = { stage: 'lower' };
}
function stepSeq(dt){
  const q = state.seq; if (!q) return;
  if (q.stage === 'raise'){
    if (faceH() < q.clear){ moveSlider(Math.min(q.clear - faceH(), Math.max(60, (q.clear - faceH())*6)*dt), true); return; }
    state.partTarget = { x: q.x, z: q.z }; q.stage = 'slide'; return;
  }
  if (q.stage === 'slide'){ if (state.partTarget) return; q.stage = 'lower'; }
  if (q.stage === 'lower'){
    const before = state.hs;
    moveSlider(-Math.max(20, (state.hs - minHs())*5)*dt, true);
    if (state.hs <= minHs() + 1e-6 || Math.abs(before - state.hs) < 1e-9){
      state.seq = null;
      if (q.zero){
        const want = -state.eps;
        if (Math.abs(want) > ZERO_RANGE){ setDelta(Math.sign(want)*ZERO_RANGE); toast('The scriber sits too far out for the main-scale adjustment — re-clamp it closer'); }
        else { setDelta(want); toast('Zeroed on the surface plate: both scales read 0'); }
      } else if (!state.practice) toast(`Reads ${(readingMM()/IN).toFixed(3)}″ / ${readingMM().toFixed(2)} mm`);
    }
  }
}
function setDelta(d){
  state.delta = clamp(d, -ZERO_RANGE, ZERO_RANGE);
  $('zeroAdj').value = String(Math.round(state.delta*100));
  $('zeroNote').textContent = Math.abs(state.delta) < 0.005
    ? 'Main scale at its center position.'
    : `Main scale shifted ${state.delta > 0 ? 'up' : 'down'} ${(Math.abs(state.delta)/IN).toFixed(4)}″ (${Math.abs(state.delta).toFixed(2)} mm).`;
}
function zeroOnPlate(){
  if (state.sliderLocked) setLock('sliderLocked', false);
  if (state.unitLocked) setLock('unitLocked', false);
  // move any part out from under the scriber, lower onto the plate, then shift the main scale to read 0
  state.lift = null; state.partGoal = null;
  state.seq = { stage: 'raise', clear: tallest() + CLEAR, x: TIP_X0 - 150, z: 5.5, zero: true };
}

/* ---------- readings ---------- */
// the vernier line that lines up is the nearest whole division, so readings resolve to .001″ / 0.02 mm
function splitIn(mm){
  const n = Math.round(mm/IN*1000), main = Math.floor(n/50)*50;
  return { mainIdx: main/50, main: main/1000, k: n - main, total: n/1000 };
}
function splitMM(mm){
  const n = Math.round(mm*50), main = Math.floor(n/50);
  return { mainIdx: main, main, k: n - main*50, total: n/50 };
}
const fmtIn = v => (v < 0 ? '−' : '') + Math.abs(v).toFixed(3);
const fmtMM = v => (v < 0 ? '−' : '') + Math.abs(v).toFixed(2);
let lastUI = '';
function updateUI(){
  const R = readingMM(), I = splitIn(R), Mm = splitMM(R);
  const key = [I.total, Mm.total, state.sliderLocked, state.unitLocked, touching(), state.contact.feat, state.practice, state.pRevealed].join('|');
  if (key === lastUI) return; lastUI = key;
  $('iMain').textContent = fmtIn(I.main); $('iMainH').textContent = `${I.mainIdx} lines × 0.050″`;
  $('iVern').textContent = fmtIn(I.k/1000); $('iVernH').textContent = `line ${I.k} × 0.001″`;
  $('iTot').textContent = fmtIn(I.total);
  $('mMain').textContent = fmtMM(Mm.main); $('mMainH').textContent = `${Mm.mainIdx} mm`;
  $('mVern').textContent = fmtMM(Mm.k*0.02); $('mVernH').textContent = `line ${Mm.k} × 0.02 mm`;
  $('mTot').textContent = fmtMM(Mm.total);
  const st = $('status');
  st.textContent = state.sliderLocked ? 'Slider clamped' : state.unitLocked ? 'Unit clamped — fine feed' : 'Slider free';
  st.className = 'status-chip ' + (state.sliderLocked ? 'warn' : state.unitLocked ? 'ok' : '');
  const P = state.part, f = P && state.contact.feat && P.feats.find(x => x.id === state.contact.feat);
  const ct = $('contact');
  ct.textContent = touching() ? (f ? `On: ${f.label}` : 'On the surface plate') : 'Scriber in the air';
  ct.className = 'status-chip ' + (touching() ? 'ok' : '');
  // highlights
  const show = !state.practice || state.pRevealed, hl = state.hl;
  HL.imain.set(show && hl.imain ? I.mainIdx : -1);
  HL.ivern.set(show && hl.ivern ? I.k : -1);
  HL.mmain.set(show && hl.mmain ? Mm.mainIdx : -1);
  HL.mvern.set(show && hl.mvern ? Mm.k : -1);
  // the face under the scriber is lit all the time, so moving the part shows where it will measure
  paintTop(hl.face ? state.contact.feat : null);
  drawFlatHG();
}
function renderFeats(){
  const P = state.part, box = $('feats');
  $('revealBtn').textContent = P && P.revealed ? 'Hide actual' : 'Show actual';
  if (!P){ box.innerHTML = ''; return; }
  box.innerHTML = P.feats.map(f => `<button class="fcard${P.sel === f.id ? ' sel' : ''}" data-feat="${f.id}"><span class="fn">${f.label}</span>${P.revealed ? `<span class="fv">${(f.value/IN).toFixed(4)}″ · ${f.value.toFixed(3)} mm</span>` : ''}</button>`).join('');
}

/* ---------- practice ---------- */
function setPractice(on){
  state.practice = on; state.pRevealed = false;
  document.body.classList.toggle('practice', on);
  $('practiceBtn').setAttribute('aria-pressed', String(on));
  lastUI = '';
  if (on) loadPractice();
}
function loadPractice(){
  const keys = Object.keys(PARTS).filter(k => k !== 'plate');
  const key = keys[Math.floor(Math.random()*keys.length)];
  $('partSel').value = key; newPart(key);
  const f = state.part.feats[Math.floor(Math.random()*state.part.feats.length)];
  measureFeature(f.id);
  state.pRevealed = false; lastUI = '';
  $('guess').value = ''; $('pfb').className = ''; $('pfb').innerHTML = `<p class="pintro">Read the <b>${$('pUnit').value === 'in' ? 'inch (left-hand)' : 'metric (right-hand)'}</b> scales and type the height, then press <b>Check</b>. Score ${state.pScore.right}/${state.pScore.total}.</p>`;
}
/* ---------- practice feedback: what went wrong, drawn out step by step ---------- */
const VZ = { ok: '#5fcf8a', bad: '#ff7a6e', ink: '#e4e6ea', mute: '#8a8f97', metal: '#2a2d32', edge: '#8e949c' };
let _mctx = null;
function textW(t, size, weight){
  if (!_mctx) _mctx = document.createElement('canvas').getContext('2d');
  _mctx.font = `${weight || 600} ${size}px Inter, Arial, sans-serif`;
  return _mctx.measureText(String(t)).width;
}
const boxHit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
function Viz(W, H){ this.W = W; this.H = H; this.out = []; this.obs = []; this.labs = []; }
Viz.prototype.surface = function(svg){ this.out.push(svg); return this; };
Viz.prototype.ob = function(svg, box, id){ this.out.push(svg); this.obs.push(Object.assign({ id }, box)); return this; };
Viz.prototype.line = function(x1, y1, x2, y2, col, w, dash, id){
  const p = (w || 1)/2 + 1;
  return this.ob(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${col}" stroke-width="${w || 1}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`,
    { x: Math.min(x1, x2) - p, y: Math.min(y1, y2) - p, w: Math.abs(x2 - x1) + 2*p, h: Math.abs(y2 - y1) + 2*p }, id);
};
Viz.prototype.rect = function(x, y, w, h, attrs, id){ return this.ob(`<rect x="${x}" y="${y}" width="${w}" height="${h}" ${attrs}/>`, { x: x - 1, y: y - 1, w: w + 2, h: h + 2 }, id); };
Viz.prototype.circle = function(cx, cy, r, attrs, id){ return this.ob(`<circle cx="${cx}" cy="${cy}" r="${r}" ${attrs}/>`, { x: cx - r - 1, y: cy - r - 1, w: 2*r + 2, h: 2*r + 2 }, id); };
Viz.prototype.path = function(d, box, attrs, id){ return this.ob(`<path d="${d}" ${attrs}/>`, box, id); };
Viz.prototype.text = function(t, x, y, o){ this.labs.push(Object.assign({ t: String(t), x, y }, o || {})); return this; };
Viz.prototype.render = function(){
  const W = this.W, H = this.H, m = 1.5, placed = [], txt = [];
  for (const L of this.labs){
    const anchor = L.anchor || 'middle', weight = L.weight || 600, base = L.size || 11;
    let done = false;
    for (const size of [base, base*0.9, base*0.8]){
      const tw = textW(L.t, size, weight), w = tw + 2*m, h = size + 2*m;
      const at = (x, y) => ({ x: (anchor === 'start' ? x : anchor === 'end' ? x - tw : x - tw/2) - m, y: y - h/2, w, h });
      const cands = [[0, 0]].concat(L.alts || []);
      const R = L.maxShift == null ? 12 : L.maxShift;
      for (let r = 2; r <= R; r += 2) for (const d of [[0, -r], [0, r], [r, 0], [-r, 0], [r, -r], [-r, -r], [r, r], [-r, r]]) cands.push(d);
      for (const [dx, dy] of cands){
        const bx = at(L.x + dx, L.y + dy);
        if (bx.x < 0 || bx.y < 0 || bx.x + bx.w > W || bx.y + bx.h > H) continue;
        const wi = L.within;
        if (wi && !(bx.x >= wi.x && bx.y >= wi.y && bx.x + bx.w <= wi.x + wi.w && bx.y + bx.h <= wi.y + wi.h)) continue;
        if (this.obs.some(o => o.id == null || o.id !== L.inside ? boxHit(bx, o) : false)) continue;
        if (placed.some(p => boxHit(bx, p))) continue;
        placed.push(bx);
        txt.push({ L, x: L.x + dx, y: L.y + dy, size, anchor, weight });
        done = true; break;
      }
      if (done) break;
    }
  }
  const halo = L => L.noHalo ? '' : ` stroke="${L.halo || '#0c0d0f'}" stroke-opacity=".72" stroke-width="3" stroke-linejoin="round" paint-order="stroke"`;
  const texts = txt.map(({ L, x, y, size, anchor, weight }) =>
    `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" fill="${L.col || VZ.ink}" font-size="${size.toFixed(1)}" font-family="Inter,Arial,sans-serif" font-weight="${weight}" text-anchor="${anchor}" dominant-baseline="central"${halo(L)}>${L.t}</text>`).join('');
  const clip = 'vzclip' + (Viz.n = (Viz.n || 0) + 1);
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-hidden="true"><defs><clipPath id="${clip}"><rect width="${W}" height="${H}" rx="4"/></clipPath></defs><g clip-path="url(#${clip})">${this.out.join('')}</g>${texts}</svg>`;
};


const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const pickOne = a => a[Math.floor(Math.random()*a.length)];
// a reading in whole units of the finest step (0.001″ or 0.02 mm), split into main scale and vernier
const UNIT = {
  in: { step: 1/1000, per: 50, line: 0.05, vstep: 0.001, dp: 3, sym: '″', mainName: 'Main scale', vernName: 'Vernier', lineWord: '0.050″ line', side: 'left' },
  mm: { step: 1/50, per: 50, line: 1, vstep: 0.02, dp: 2, sym: ' mm', mainName: 'Main scale', vernName: 'Vernier', lineWord: '1 mm line', side: 'right' }
};
function splitU(u, v){
  const n = Math.round(v/UNIT[u].step), main = Math.floor(n/UNIT[u].per);
  return { n, mainIdx: main, main: main*UNIT[u].line, k: n - main*UNIT[u].per };
}
const fmtU = (u, v) => (v < 0 ? '−' : '') + Math.abs(v).toFixed(UNIT[u].dp);
function explainHG(u, you, ans, Rmm){
  const U = UNIT[u], A = splitU(u, ans), Y = splitU(u, Math.max(0, you)), notes = [], why = {};
  const other = u === 'in' ? Rmm : Rmm/IN, otherU = u === 'in' ? 'mm' : 'in';
  if (Math.abs(you - other) <= UNIT[otherU].step*1.5 && Math.abs(you - ans) > U.step){
    notes.push({ icon: 'fa-right-left', title: 'That’s the ' + (u === 'in' ? 'metric' : 'inch') + ' reading — and it’s right!', text: 'You read the ' + UNIT[otherU].side + '-hand scales perfectly. The answer box is set to ' + (u === 'in' ? 'inches' : 'millimeters') + ', so read the ' + U.side + '-hand scales this time (or switch the box to ' + (u === 'in' ? 'Metric' : 'Inch') + ').' });
    return { A, Y, notes, why, swap: true };
  }
  const ratio = ans ? you/ans : 0, lg = ratio > 0 ? Math.log10(ratio) : NaN;
  if (Number.isFinite(lg) && Math.round(lg) !== 0 && Math.abs(lg - Math.round(lg)) < 1e-9){
    notes.push({ icon: 'fa-heart', title: 'Every line was read correctly — only the decimal point wandered', text: 'This one is written ' + fmtU(u, ans) + U.sym + '. That’s a tiny fix!' });
    return { A, Y, notes, why, decimal: true };
  }
  if (Y.mainIdx !== A.mainIdx){
    why.main = Y.mainIdx === A.mainIdx + 1
      ? 'So close! That line is just <i>above</i> the vernier’s 0, so the slider hasn’t reached it yet. The last ' + U.lineWord + ' at or below the 0 is worth <b>' + fmtU(u, A.main) + U.sym + '</b>.'
      : Y.mainIdx === A.mainIdx - 1
      ? 'Nearly! One more ' + U.lineWord + ' has already slipped below the vernier’s 0, so it counts. The main scale gives <b>' + fmtU(u, A.main) + U.sym + '</b>.'
      : 'Look straight across from the vernier’s 0 line to the ' + U.side + '-hand main scale: the last line below it is worth <b>' + fmtU(u, A.main) + U.sym + '</b>' + (u === 'in' ? ' (each line is 0.050″, numbered every inch).' : ' (each line is 1 mm, numbered every centimeter).');
  }
  if (Y.k !== A.k){
    why.vern = Math.abs(Y.k - A.k) === 1
      ? 'So close — neighbors always look almost lined up! The one that meets a main-scale line exactly, as one straight line, is vernier line <b>' + A.k + '</b>, worth ' + fmtU(u, A.k*U.vstep) + U.sym + '.'
      : 'Run your eye up the vernier until one of its lines meets a main-scale line exactly. That’s line <b>' + A.k + '</b>, and each line is worth ' + U.vstep + (u === 'in' ? '″' : ' mm') + ', so it adds ' + fmtU(u, A.k*U.vstep) + U.sym + '.';
  }
  return { A, Y, notes, why };
}
// diagrams: 'main' shows where the vernier 0 sits on the main scale, 'vern' shows which lines meet
function vizHG(k, u, A, Y){
  const U = UNIT[u], W = 280;
  if (k === 'main'){
    const H = 150, v = new Viz(W, H), edge = 150, sp = 24, y0 = H/2;
    const frac = A.k/U.per;                       // how far the vernier 0 sits above the correct line
    v.surface('<rect x="0" y="0" width="' + edge + '" height="' + H + '" fill="' + VZ.metal + '"/><rect x="' + edge + '" y="0" width="' + (W - edge) + '" height="' + H + '" fill="#3a3f46"/>');
    for (let i = -3; i <= 3; i++){
      const idx = A.mainIdx + i; if (idx < 0) continue;
      const y = y0 + (frac - i)*sp; if (y < 8 || y > H - 8) continue;
      const isA = i === 0, isY = idx === Y.mainIdx && !isA, col = isA ? VZ.ok : isY ? VZ.bad : VZ.ink;
      v.line(isA || isY ? 70 : 104, y, edge, y, col, isA || isY ? 2.6 : 1.2, isY ? '4 3' : '');
      if (isA || isY) v.text(fmtU(u, idx*U.line) + U.sym, 36, y, { col, size: 11, maxShift: 6 });
    }
    v.line(edge, y0, edge + 70, y0, VZ.ok, 2.2);
    v.circle(edge, y0, 4, 'fill="#3a3f46" stroke="' + VZ.ok + '" stroke-width="2"');
    v.text('Vernier 0', edge + 76, y0, { anchor: 'start', col: '#c3c7cd', size: 10, halo: '#3a3f46', maxShift: 8 });
    v.text('Main scale', 6, 11, { anchor: 'start', col: VZ.mute, size: 9, within: { x: 0, y: 0, w: edge, h: H } });
    v.text('Vernier', W - 6, 11, { anchor: 'end', col: '#aeb3ba', size: 9, within: { x: edge, y: 0, w: W - edge, h: H }, halo: '#3a3f46' });
    v.text('↑ Higher', W - 6, H - 10, { anchor: 'end', col: VZ.mute, size: 9, within: { x: edge, y: 0, w: W - edge, h: H }, halo: '#3a3f46' });
    return v.render();
  }
  // vernier: main-scale lines on the left, vernier lines on the right; where they meet is the answer.
  // The spacing difference is exaggerated so the idea shows at this size.
  const H = 196, v = new Viz(W, H), edge = 150, sm = 20, sv = 17, yk = H/2 + 6, lo = Math.max(0, A.k - 4), hi = Math.min(U.per, A.k + 4);
  v.surface('<rect x="0" y="0" width="' + edge + '" height="' + H + '" fill="' + VZ.metal + '"/><rect x="' + edge + '" y="0" width="' + (W - edge) + '" height="' + H + '" fill="#3a3f46"/>');
  for (let m = -4; m <= 4; m++){
    const y = yk - m*sm; if (y < 16 || y > H - 6) continue;
    v.line(104, y, edge, y, m === 0 ? VZ.ok : VZ.ink, m === 0 ? 2.6 : 1.2);
  }
  for (let j = lo; j <= hi; j++){
    const y = yk - (j - A.k)*sv; if (y < 16 || y > H - 6) continue;
    const isA = j === A.k, isY = j === Y.k && !isA, col = isA ? VZ.ok : isY ? VZ.bad : VZ.ink;
    v.line(edge, y, edge + (j % 5 === 0 ? 40 : 28), y, col, isA || isY ? 2.6 : 1.2, isY ? '4 3' : '');
    v.text(j, edge + 54, y, { col, size: isA || isY ? 11 : 9, maxShift: 2, halo: '#3a3f46' });
    if (isA || isY) v.text(isA ? 'Correct' : 'Yours', W - 8, y, { anchor: 'end', col, size: 9.5, weight: isA ? 600 : 500, maxShift: 4, halo: '#3a3f46' });
  }
  if (Y.k < lo || Y.k > hi) v.text('Yours: line ' + Y.k + (Y.k > hi ? ' ↑' : ' ↓'), W - 8, Y.k > hi ? 24 : H - 12, { anchor: 'end', col: VZ.bad, size: 9.5, weight: 500, halo: '#3a3f46' });
  v.circle(edge, yk, 4.5, 'fill="' + VZ.metal + '" stroke="' + VZ.ok + '" stroke-width="2"');
  v.text('Main scale', 6, 11, { anchor: 'start', col: VZ.mute, size: 9, within: { x: 0, y: 0, w: edge, h: H } });
  v.text('Vernier', W - 6, 11, { anchor: 'end', col: '#aeb3ba', size: 9, within: { x: edge, y: 0, w: W - edge, h: H }, halo: '#3a3f46' });
  v.text('Lines meet here', 8, yk, { anchor: 'start', col: VZ.ok, size: 9.5, weight: 600, within: { x: 0, y: 0, w: 100, h: H } });
  return v.render();
}
function checkPractice(){
  const u = $('pUnit').value, U = UNIT[u], fb = $('pfb');
  const g = parseFloat(String($('guess').value).replace(/[″"a-z\s]/gi, ''));
  if (isNaN(g)){ fb.innerHTML = '<div class="fb-empty"><i class="fa-solid fa-keyboard"></i> Whenever you’re ready, type your reading — for example ' + (u === 'in' ? '3.742' : '95.06') + '.</div>'; return; }
  const R = readingMM(), ans = u === 'in' ? R/IN : R;
  const A0 = splitU(u, ans), aVal = A0.n*U.step, you = g;
  const sc = state.pScore; sc.total++;
  const ok = Math.round(g/U.step) === A0.n;
  if (ok){ sc.right++; sc.streak++; } else sc.streak = 0;
  const ex = ok ? { A: A0, Y: null, notes: [], why: {} } : explainHG(u, you, aVal, R);
  const A = ex.A, Y = ex.decimal || ex.swap ? null : ex.Y;
  // left out, or added, one whole piece?
  let miss = null;
  if (!ok && !ex.decimal && !ex.swap){
    const Yn = Math.round(you/U.step);
    if (Yn === A.mainIdx*U.per && A.k) { miss = { type: 'missing', keys: ['vern'] }; ex.why = { vern: 'You did the main scale perfectly — the vernier just never made it into the total. Line <b>' + A.k + '</b> adds <b>' + fmtU(u, A.k*U.vstep) + U.sym + '</b>.' }; }
    else if (Yn === A.k && A.mainIdx) { miss = { type: 'missing', keys: ['main'] }; ex.why = { main: 'You found the vernier line perfectly — the main scale just never made it into the total. It gives <b>' + fmtU(u, A.main) + U.sym + '</b>.' }; }
  }
  const STEPS = { main: { name: U.mainName, css: u === 'in' ? 'var(--hl-main)' : 'var(--hl-mmain)', val: S => S.main, det: S => S.mainIdx + ' × ' + (u === 'in' ? '0.050″' : '1 mm') },
                  vern: { name: U.vernName, css: u === 'in' ? 'var(--hl-vern)' : 'var(--hl-mvern)', val: S => S.k*U.vstep, det: S => 'line ' + S.k + ' × ' + (u === 'in' ? '0.001″' : '0.02 mm') } };
  const KEYS = ['main', 'vern'];
  const wrong = ok ? [] : KEYS.filter(k => ex.why[k]);
  state.pRevealed = true; lastUI = '';
  const nWrong = wrong.length;
  const title = ok ? pickOne(['Spot on!', 'Beautifully read!', 'Nailed it!', 'Perfect reading!'])
    : ex.swap ? 'Right reading, other scale!'
    : ex.decimal ? 'Your reading is right!'
    : miss ? 'Just one piece left out — so close!'
    : nWrong <= 1 ? pickOne(['So close — you’ve got this!', 'Almost perfect!', 'Just one small thing!'])
    : pickOne(['Good effort — let’s fine-tune it', 'You’re on the right track']);
  const sub = ok ? (sc.streak >= 3 ? sc.streak + ' in a row — you’re really getting the hang of this.' : 'Main scale and vernier both read correctly. Keep it going!')
    : ex.swap ? 'Only the scale needs switching.'
    : ex.decimal ? 'Only the decimal point needs moving.'
    : miss ? 'The other step was exactly right.'
    : (nWrong === 1 ? 'Only one step needs' : 'Both steps need') + ' a second look.';
  const pct = sc.total ? Math.round(sc.right/sc.total*100) : 0;
  const hero = '<div class="fx-hero ' + (ok ? 'ok' : '') + '"><div class="fx-badge"><i class="fa-solid ' + (ok ? 'fa-check' : miss ? 'fa-puzzle-piece' : 'fa-seedling') + '"></i></div>' +
    '<div class="fx-head"><h4>' + title + '</h4><p>' + sub + '</p></div>' +
    '<div class="fx-score"><div class="fx-ring" style="--p:' + pct + '"><span>' + pct + '%</span></div><div><small>Score</small><b>' + sc.right + ' / ' + sc.total + '</b><small>' + (sc.streak ? '🔥 ' + sc.streak + ' in a row' : 'keep going') + '</small></div></div></div>';
  const d = you - aVal;
  const cmp = ok ? '<div class="fx-cmp solo"><div class="fx-num ans"><small>Your reading</small><b>' + fmtU(u, aVal) + U.sym + '</b></div></div>'
    : '<div class="fx-cmp"><div class="fx-num you"><small>You entered</small><b>' + esc(String(g)) + U.sym + '</b></div>' +
      '<div class="fx-delta"><span>' + (d > 0 ? 'too high by' : 'too low by') + '</span><div class="ar"></div><b>' + fmtU(u, Math.abs(d)) + U.sym + '</b></div>' +
      '<div class="fx-num ans"><small>Correct reading</small><b>' + fmtU(u, aVal) + U.sym + '</b></div></div>';
  const missBox = miss ? '<div class="fx-miss" style="--c:' + STEPS[miss.keys[0]].css + '"><div class="fx-miss-ic"><i class="fa-solid fa-puzzle-piece"></i></div><div><h5>The ' + STEPS[miss.keys[0]].name.toLowerCase() + ' wasn’t added</h5><p>Everything else lines up perfectly — adding this one value back in gives the exact answer:</p>' +
    '<div class="fx-sum"><span>' + esc(String(g)) + U.sym + '</span><span class="op">+</span><span class="add">' + fmtU(u, STEPS[miss.keys[0]].val(A)) + U.sym + '</span><span class="op">=</span><span class="res">' + fmtU(u, aVal) + U.sym + '</span></div></div></div>' : '';
  const chips = KEYS.map(k => {
    const D = STEPS[k], bad = !ok && wrong.includes(k), mk = miss && miss.keys.includes(k);
    return '<div class="fx-chip ' + (bad ? 'bad ' : '') + (mk ? 'miss' : '') + '" style="--c:' + D.css + '">' + (mk ? '<span class="tag">MISSING</span>' : '') +
      '<small>' + D.name + '</small><b>' + fmtU(u, D.val(A)) + U.sym + '</b><em>' + D.det(A) + '</em>' +
      (ok ? '' : '<span class="yv"><i class="fa-solid ' + (bad ? 'fa-xmark' : 'fa-check') + '"></i>You answered ' + (Y ? fmtU(u, D.val(Y)) + U.sym : '—') + '</span>') + '</div>';
  }).join('<span class="fx-op">+</span>');
  const eq = '<div class="fx-sec">How the reading adds up</div><div class="fx-eq">' + chips + '<span class="fx-op">=</span>' +
    '<div class="fx-chip total"><small>Reading</small><b>' + fmtU(u, aVal) + U.sym + '</b><em>correct total</em>' + (ok ? '' : '<span class="yv" style="color:#ff9d94"><i class="fa-solid fa-xmark"></i>You answered ' + esc(String(g)) + U.sym + '</span>') + '</div></div>';
  const notes = ex.notes.map(nt => '<div class="fx-note"><i class="fa-solid ' + nt.icon + '"></i><div><b>' + nt.title + '</b><span>' + nt.text + '</span></div></div>').join('');
  const steps = wrong.length ? '<div class="fx-sec">Let’s look closer</div><div class="fx-steps">' + wrong.map((k, i) => {
    const D = STEPS[k], mk = miss && miss.keys.includes(k);
    const yd = Y ? (k === 'main' ? fmtU(u, Y.main) + U.sym : 'line ' + Y.k) : '—', ad = k === 'main' ? fmtU(u, A.main) + U.sym : 'line ' + A.k;
    return '<article class="fx-step" style="--c:' + D.css + '"><div class="fx-step-h"><span class="num">' + (i + 1) + '</span><b>' + D.name + '</b><span class="chg"><s>' + (mk ? 'not added' : yd) + '</s><i class="fa-solid fa-arrow-right"></i><strong>' + ad + '</strong></span></div>' +
      '<p>' + ex.why[k] + '</p><figure>' + vizHG(k, u, A, Y || A) + '<figcaption><span><i style="background:#5fcf8a"></i>correct</span><span><i style="background:#ff7a6e"></i>yours</span></figcaption></figure>' +
      '<div class="fx-step-f"><span><i class="fa-solid fa-location-arrow"></i>Highlighted on the gage</span><button class="fx-show" data-show="' + u + ':' + k + '"><i class="fa-solid fa-crosshairs"></i>Show me</button></div></article>';
  }).join('') + '</div>' : '';
  const good = !ok && Y ? KEYS.filter(k => !wrong.includes(k)) : [];
  const goodRow = good.length ? '<div class="fx-sec">What you got right</div><div class="fx-good">' + good.map(k => '<span><i class="fa-solid fa-circle-check"></i>' + STEPS[k].name + '</span>').join('') + '</div>' : '';
  const foot = '<div class="fx-foot"><i class="fa-solid ' + (ok ? 'fa-star' : 'fa-heart') + '"></i><span>' + (ok ? 'Press <b>Next</b> whenever you’d like another one.'
    : 'Every expert has made this exact slip while learning. The colored lines on the gage show the right marks — press <b>Next</b> when you feel ready.') + '</span></div>';
  fb.className = '';
  fb.innerHTML = '<div class="fx">' + hero + cmp + missBox + notes + eq + steps + goodRow + foot + '</div>';
  fb.scrollTop = 0;
}

/* ---------- examination: labels on every part ---------- */
const SVGNS = 'http://www.w3.org/2000/svg';
const _p = new T.Vector3(), _q = new T.Vector3(), _cd = new T.Vector3();
function makeTag(){
  const dot = document.createElement('span'); dot.className = 'xdot';
  const box = document.createElement('div'); box.className = 'xl'; box.innerHTML = '<b></b><small></small>';
  const ln = document.createElementNS(SVGNS, 'line');
  $('xsvg').appendChild(ln); $('xlayer').appendChild(dot); $('xlayer').appendChild(box);
  return { dot, box, ln, b: box.querySelector('b'), sm: box.querySelector('small') };
}
function dropTag(t){ t.dot.remove(); t.box.remove(); t.ln.remove(); }
const clampTag = (v, a, b) => Math.max(a, Math.min(b, v));
function placeTag(t, p, nrm, off, placed){
  const r = wrap.getBoundingClientRect();
  _p.copy(p).project(camera);
  const sx = (_p.x + 1)/2*r.width, sy = (1 - _p.y)/2*r.height;
  _q.copy(p).add(nrm).project(camera);
  let dx = (_q.x + 1)/2*r.width - sx, dy = (1 - _q.y)/2*r.height - sy;
  const L = Math.hypot(dx, dy);
  if (L < 1e-3){ dx = 0.6; dy = -0.8; } else { dx /= L; dy /= L; }
  camera.getWorldDirection(_cd);
  const facing = -(nrm.x*_cd.x + nrm.y*_cd.y + nrm.z*_cd.z);
  const tx = sx + dx*off, ty = sy + dy*off;
  const ax = dx < -0.35 ? -1 : dx > 0.35 ? 0 : -0.5;
  const ay = dy < -0.35 ? -1 : dy > 0.35 ? 0 : -0.5;
  // labels are nowrap, so their size only changes with their text — measure then, not every frame
  const txt = t.b.textContent + ' ' + t.sm.textContent;
  if (!t.bw || t.txt !== txt || t.vw !== innerWidth) { t.bw = t.box.offsetWidth; t.bh = t.box.offsetHeight; t.txt = txt; t.vw = innerWidth; }   // again if it was first sized while hidden, or the window changed
  // keep the whole label inside the view instead of letting it run off the edge
  const m = 6, bw = t.bw, bh = t.bh, loY = m, hiY = Math.max(m, r.height - bh - m);
  let bx = clampTag(tx + ax*bw, m, Math.max(m, r.width - bw - m));
  let by = clampTag(ty + ay*bh, loY, hiY);
  // find the nearest spot where the label covers neither another label nor a panel or button row:
  // try steps up and down, and each side of everything already placed; failing that, the least covered spot
  if (placed && facing > -0.08) {
    const g = 4, hiX = Math.max(m, r.width - bw - m);
    const cover = (x, y) => placed.reduce((sum, q) => sum +
      Math.max(0, Math.min(x + bw + g, q.x + q.w) - Math.max(x - g, q.x))*Math.max(0, Math.min(y + bh + g, q.y + q.h) - Math.max(y - g, q.y)), 0);
    if (cover(bx, by) > 0){
      const xs = [bx], ys = [by];
      for (let k = 1; k <= 14; k++) ys.push(by + k*(bh + g)/2, by - k*(bh + g)/2);
      for (const q of placed) xs.push(q.x - bw - g, q.x + q.w + g);
      let best = null;
      for (const x0 of xs) for (const y0 of ys){
        const x = clampTag(x0, m, hiX), y = clampTag(y0, loY, hiY);
        const c = cover(x, y)*1e4 + Math.hypot(x - bx, y - by);
        if (!best || c < best.c) best = { x, y, c };
      }
      bx = best.x; by = best.y;
    }
    placed.push({ x: bx, y: by, w: bw, h: bh });
  }
  t.dot.style.transform = `translate(${sx}px,${sy}px)`;
  t.box.style.transform = `translate(${bx}px,${by}px)`;
  // end the leader on the point of the label nearest its dot
  t.ln.setAttribute('x1', sx); t.ln.setAttribute('y1', sy);
  t.ln.setAttribute('x2', clampTag(sx, bx, bx + bw)); t.ln.setAttribute('y2', clampTag(sy, by, by + bh));
  const op = facing > -0.08 ? '1' : '0.15';
  t.dot.style.opacity = op; t.box.style.opacity = op; t.ln.style.opacity = op;
}
const V = (x, y, z) => new T.Vector3(x, y, z);
const N = (x, y, z) => new T.Vector3(x, y, z).normalize();
const slY = () => state.hs + SCRIBE_DROP, unY = () => state.hs + SCRIBE_DROP + SL_H + state.g;
const EXAM = [
  ['Beam', 'Hardened stainless steel', () => ({ p: V(BEAM_X1, 410, 0), n: N(1, 0, 0.35) })],
  ['Main scale — inch', '0.050″ lines, numbered every inch', () => ({ p: V(3, SCALE_Y0 + state.delta + 250, BEAM_Z1), n: N(-0.6, 0.1, 1) })],
  ['Main scale — metric', '1 mm lines, numbered every centimeter', () => ({ p: V(25, SCALE_Y0 + state.delta + 215, BEAM_Z1), n: N(0.6, 0.1, 1) })],
  ['Main-scale adjustment', 'Slides the whole scale ±7.5 mm to set zero', () => ({ p: V(23, 484, BEAM_Z1 + 6), n: N(0.7, 0.3, 1) })],
  ['Slider', 'Carries both verniers and the scriber', () => ({ p: V(SL_X0, slY() + 38, -2), n: N(-1, 0.1, 0.3) })],
  ['Inch vernier', '50 lines, each adds 0.001″', () => ({ p: V(-7, slY() + 22, PLATE_Z), n: N(-0.5, 0, 1) })],
  ['Metric vernier', '50 lines, each adds 0.02 mm', () => ({ p: V(37, slY() + 22, PLATE_Z), n: N(0.5, 0, 1) })],
  ['Slider clamp', 'Locks the slider to hold a reading', () => ({ p: V(SL_X1 + 14, slY() + 40, -1), n: N(1, -0.2, 0.3) })],
  ['Fine-feed unit', 'Clamp it, then fine-adjust with the nut', () => ({ p: V(14, unY() + UNIT_H/2, 7), n: N(-0.3, 0.2, 1) })],
  ['Fine-feed clamp', 'Locks the unit to the beam', () => ({ p: V(SL_X1 + 14, unY() + UNIT_H/2, -1), n: N(1, 0.2, 0.2) })],
  ['Fine-feed nut', `Moves the slider ${FINE_PITCH} mm per turn`, () => ({ p: V(40, unY() + UNIT_H + 11, 3), n: N(0.4, 1, 0.3) })],
  ['Scriber clamp', 'Loosen to re-set the scriber', () => ({ p: V(-27.5, slY() - 1, 5.5), n: N(-0.2, 1, 0.5) })],
  ['Carbide-tipped scriber', 'Its lower face is the measuring face', () => ({ p: V(-98, faceH() + 1, 5.5), n: N(-0.7, -0.1, 0.7) })],
  ['Base', 'Heavy cast base, lapped underside', () => ({ p: V(112, 30, BASE_D/2), n: N(0.4, 0.3, 1) })],
  ['Surface plate', 'Every height is taken from it', () => ({ p: V(-260, 0, 150), n: N(-0.2, 1, 0.4) })]
];
let examTags = [], examLabels = true;
function setExam(on){
  state.exam = on;
  document.body.classList.toggle('exam', on);
  if (on){
    if (state.practice) setPractice(false);
    examTags = EXAM.map(([title, sub]) => { const t = makeTag(); t.b.textContent = title; t.sm.textContent = sub; return t; });
    setSpin(true); setLabels(true);
    setTimeout(() => setView('iso'), 60);
  } else {
    examTags.forEach(dropTag); examTags = [];
    setSpin(false);
    setTimeout(() => setView('iso'), 60);
  }
}
function setSpin(on){ controls.autoRotate = on; controls.autoRotateSpeed = 0.8; $('spinBtn').setAttribute('aria-pressed', String(on)); }
function setLabels(on){
  examLabels = on; $('labelsBtn').setAttribute('aria-pressed', String(on));
  examTags.forEach(t => { t.dot.hidden = t.box.hidden = !on; t.ln.style.display = on ? '' : 'none'; });
}
// what the labels must stay off: the black bars in examination, otherwise the floating controls
function labelObstacles(){
  if (document.body.classList.contains('exam')){
    const W = wrap.clientWidth, H = wrap.clientHeight;
    const t = document.querySelector('.cine.top').offsetHeight, b = document.querySelector('.cine.bot').offsetHeight;
    return [{ x: 0, y: 0, w: W, h: t, fixed: true }, { x: 0, y: H - b, w: W, h: b, fixed: true }];
  }
  return [];
}
function updateExam(){
  if (!state.exam || !examLabels) return;
  const tight = wrap.clientWidth < 560, placed = labelObstacles();   // shorter leaders so labels stay clear of the edges
  EXAM.forEach((e, i) => { const a = e[2](); placeTag(examTags[i], a.p, a.n, tight ? 44 : 70, placed); });
}

/* ---------- camera ---------- */
let flight = null;
function orthoFor(pos, target){
  const p = new T.Vector3(...pos), t = new T.Vector3(...target), d = p.distanceTo(t);
  return { p: t.clone().add(p.sub(t).normalize().multiplyScalar(CAM_BACK)), t, z: VIEW_H/(0.536*d) };   // 0.536 = 2·tan 15°, the old 30° view
}
function flyTo(pos, target, ms){
  const o = orthoFor(pos, target);
  flight = { p0: camera.position.clone(), t0: controls.target.clone(), z0: camera.zoom, p1: o.p, t1: o.t, z1: o.z, start: performance.now(), ms: matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : (ms || 800) };
}
controls.addEventListener('start', () => { flight = null; if (state.exam && controls.autoRotate) setSpin(false); });
// "Show me": a tight close-up on the exact line a practice step is about
function showMe(u, k){
  const R = readingMM(), inch = u === 'in', sl = state.hs + SCRIBE_DROP;
  let p;
  if (k === 'main'){
    const idx = inch ? splitIn(R).mainIdx : splitMM(R).mainIdx;
    p = [inch ? 4 : BEAM_X1 - 4, SCALE_Y0 + state.delta + idx*(inch ? IN_MAIN : 1), BEAM_Z1];
  } else {
    const kk = inch ? splitIn(R).k : splitMM(R).k;
    p = [inch ? 0 : 28, sl + V0 + kk*(inch ? IN_VDIV : MM_VDIV), PLATE_Z];
  }
  flyTo([p[0] + (inch ? -8 : 8), p[1] + 6, p[2] + 42], p);
}

/* ---------- iso view that fits: everything on the table (tool, part, blocks) sized into the open
   screen area between the floating buttons and the flat view, whatever the window shape ---------- */
function fitBox(root){
  const box = new T.Box3(), b = new T.Box3(), s = new T.Vector3();
  root.updateMatrixWorld(true);
  root.traverse(o => {
    if (!o.isMesh || o.userData.noFit) return;
    for (let p = o; p; p = p.parent) if (!p.visible) return;
    const m = o.material;
    if (!m || m.isShadowMaterial || m.isShaderMaterial) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    b.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
    if (b.isEmpty()) return;
    b.getSize(s); if (Math.max(s.x, s.y, s.z) > 700) return;          // the table or floor under everything
    box.union(b);
  });
  return box;
}
// open screen areas to frame the model in: the band under the top buttons, and the column
// between the top-left and top-right buttons (which can run the full height of the view)
function freeRects(W, H){
  const rs = [...labelObstacles(), ...[...wrap.querySelectorAll(':scope > .actions, :scope > .quick, :scope > .legend, :scope > .views, :scope > .flat')].filter(e => e.offsetParent).map(e => { const r = e.getBoundingClientRect(), w = wrap.getBoundingClientRect(); return { x: r.left - w.left, y: r.top - w.top, w: r.width, h: r.height }; })], out = [];
  let top = 8, bottom = H - 8, left = 8, right = W - 8;
  for (const r of rs){
    if (r.h > H*0.4 && r.x > W*0.5) right = Math.min(right, r.x - 10);           // the flat view down the right side
    else if (r.y + r.h/2 < H/2) top = Math.max(top, r.y + r.h + 10);
    else bottom = Math.min(bottom, r.y - 10);
  }
  if (bottom - top > H*0.25 && right - left > W*0.3) out.push({ x: left, y: top, w: right - left, h: bottom - top });
  let l = 8, rr = W - 8;
  for (const r of rs){ if (r.x + r.w/2 < W/2) l = Math.max(l, r.x + r.w + 10); else rr = Math.min(rr, r.x - 10); }
  if (rr - l > W*0.25) out.push({ x: l, y: 8, w: rr - l, h: H - 16 });
  return out.length ? out : [{ x: 8, y: 8, w: W - 16, h: H - 16 }];
}
// find the camera spot (and zoom) that fits the box into the free area, looking along dir
// try each open area and keep whichever shows the model biggest
function fitIso(dir, target, dist, box){
  const c = el; let best = null;
  for (const free of freeRects(c.clientWidth, c.clientHeight)){
    const f = fitIsoIn(dir, target, dist, box, free);
    const score = camera.isOrthographicCamera ? f.zoom : 1/Math.max(1e-6, f.pos.distanceTo(f.target));
    if (!best || score > best.score) best = Object.assign(f, { score });
  }
  return best;
}
function fitIsoIn(dir, target, dist, box, free){
  const cam = camera.clone(), cv = el, W = cv.clientWidth, H = cv.clientHeight;
  if (cam.isOrthographicCamera) cam.zoom = 1;
  if (box.isEmpty() || W < 2 || H < 2) return { target: target.clone(), zoom: cam.zoom, pos: target.clone().addScaledVector(dir, dist) };
  const pts = [];
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) pts.push(new T.Vector3(x, y, z));
  const tg = box.getCenter(new T.Vector3()), q = new T.Vector3();
  let d = dist;
  const place = () => { cam.position.copy(tg).addScaledVector(dir, d); cam.lookAt(tg); cam.updateMatrixWorld(true); cam.updateProjectionMatrix(); };
  const scr = v => { q.copy(v).project(cam); return [(q.x + 1)/2*W, (1 - q.y)/2*H]; };
  const bounds = () => { let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity; for (const p of pts){ const [x, y] = scr(p); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } return { x0, x1, y0, y1 }; };
  const right = new T.Vector3(), up = new T.Vector3();
  for (let i = 0; i < 6; i++){
    place();
    let b = bounds();
    const s = Math.min(free.w/Math.max(1, b.x1 - b.x0), free.h/Math.max(1, b.y1 - b.y0))*0.92;
    if (cam.isOrthographicCamera) cam.zoom *= s; else d /= s;
    place(); b = bounds();
    // then slide it so the middle of the box sits in the middle of the free area
    right.setFromMatrixColumn(cam.matrixWorld, 0); up.setFromMatrixColumn(cam.matrixWorld, 1);
    const o = scr(tg), r = scr(tg.clone().add(right)), u = scr(tg.clone().add(up));
    const kx = r[0] - o[0], ky = u[1] - o[1];
    const dx = free.x + free.w/2 - (b.x0 + b.x1)/2, dy = free.y + free.h/2 - (b.y0 + b.y1)/2;
    if (Math.abs(kx) > 1e-6) tg.addScaledVector(right, -dx/kx);
    if (Math.abs(ky) > 1e-6) tg.addScaledVector(up, -dy/ky);
  }
  place();
  return { target: tg, zoom: cam.zoom, pos: cam.position.clone() };
}
function setView(name){
  const sy = state.hs + SCRIBE_DROP;
  // front and iso are both fitted to the gage and part, so neither backs off to take in the whole table
  if (name === 'front'){
    const fb = fitIso(new T.Vector3(0, 18, 1120).normalize(), new T.Vector3(10, 262, 0), CAM_BACK, fitBox(root));
    flight = { p0: camera.position.clone(), t0: controls.target.clone(), z0: camera.zoom, p1: fb.pos, t1: fb.target, z1: fb.zoom, start: performance.now(), ms: matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : 800 };
  }
  else if (name === 'vernier') flyTo([18, sy + 28, 215], [16, sy + 30, 6]);
  else if (name === 'scriber'){ const f = faceH(); flyTo([TIP_X0 - 70, f + 60, 190], [TIP_X0 + 10, f + 4, 5]); }
  else {
    const box = fitBox(root), nutTop = state.hs + SCRIBE_DROP + SL_H + state.g + UNIT_H + 14;
    box.max.y = Math.min(box.max.y, nutTop);          // iso frames the part and the gage up to the top of the nut
    const dir = new T.Vector3(660, 350, 1000).normalize(), fb = fitIso(dir, new T.Vector3(-20, 210, 0), CAM_BACK, box);
    flight = { p0: camera.position.clone(), t0: controls.target.clone(), z0: camera.zoom, p1: fb.pos, t1: fb.target, z1: fb.zoom, start: performance.now(), ms: matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : 800 };
  }
}

/* ---------- pointer ---------- */
const el = renderer.domElement, ray = new T.Raycaster(), ndc = new T.Vector2(), dragPlane = new T.Plane(), hitP = new T.Vector3();
let drag = null;
function setRay(e){ const r = el.getBoundingClientRect(); ndc.set(((e.clientX - r.left)/r.width)*2 - 1, -((e.clientY - r.top)/r.height)*2 + 1); ray.setFromCamera(ndc, camera); }
function pick(e){ setRay(e); const h = ray.intersectObjects(pickables, false); return h.length ? h[0] : null; }
/* ---------- click face to measure: a click on a flat face brings the scriber down onto it ---------- */
let faceMode = false;
// the whole flat face under the pointer: grown out from the triangle that was hit through every
// neighbouring triangle lying in the same plane, so a hover lights up the surface the click will measure
const faceHL = new T.Mesh(new T.BufferGeometry(), new T.MeshBasicMaterial({ color: 0x5fcf8a, transparent: true, opacity: 0.5,
  depthWrite: false, side: T.DoubleSide, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
faceHL.renderOrder = 20; faceHL.visible = false; faceHL.userData.noFit = true; faceHL.raycast = () => {};
let faceHLOn = null;   // { geo, id } of the surface being shown
function flatRegion(geo, fi, eps){
  const pos = geo.attributes.position, idx = geo.index, nt = (idx ? idx.count : pos.count)/3;
  const vi = (t, k) => idx ? idx.getX(t*3 + k) : t*3 + k;
  let F = geo.userData.faces;
  if (!F){
    // which triangles touch each corner, keyed on position so unwelded copies still join up
    const at = new Map(), keys = new Array(nt*3), q = i => Math.round(pos.getX(i)*1e4) + ',' + Math.round(pos.getY(i)*1e4) + ',' + Math.round(pos.getZ(i)*1e4);
    for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++){ const s = q(vi(t, k)); keys[t*3 + k] = s; let a = at.get(s); if (!a) at.set(s, a = []); a.push(t); }
    F = geo.userData.faces = { at, keys, of: new Int32Array(nt).fill(-1), list: [] };
  }
  if (F.of[fi] >= 0) return { id: F.of[fi], tris: F.list[F.of[fi]] };
  const A = new T.Vector3(), B = new T.Vector3(), C = new T.Vector3(), e1 = new T.Vector3(), e2 = new T.Vector3();
  const plane = t => {
    A.fromBufferAttribute(pos, vi(t, 0)); B.fromBufferAttribute(pos, vi(t, 1)); C.fromBufferAttribute(pos, vi(t, 2));
    const n = e1.subVectors(C, B).cross(e2.subVectors(A, B)).normalize().clone();
    return { n, d: n.dot(A) };
  };
  const p0 = plane(fi), id = F.list.length, tris = [fi];
  F.of[fi] = id;
  for (let i = 0; i < tris.length; i++){
    const t = tris[i];
    for (let k = 0; k < 3; k++) for (const u of F.at.get(F.keys[t*3 + k])){
      if (F.of[u] >= 0) continue;
      const p = plane(u);
      if (p.n.dot(p0.n) > 0.999 && Math.abs(p.d - p0.d) < eps){ F.of[u] = id; tris.push(u); }
    }
  }
  F.list.push(tris);
  return { id, tris };
}
function showFaceHL(h, eps){
  const geo = h.object.geometry, r = flatRegion(geo, h.faceIndex, eps);
  if (!faceHLOn || faceHLOn.geo !== geo || faceHLOn.id !== r.id){
    const pos = geo.attributes.position, idx = geo.index, out = new Float32Array(r.tris.length*9);
    r.tris.forEach((t, j) => { for (let k = 0; k < 3; k++){ const v = idx ? idx.getX(t*3 + k) : t*3 + k; out[j*9 + k*3] = pos.getX(v); out[j*9 + k*3 + 1] = pos.getY(v); out[j*9 + k*3 + 2] = pos.getZ(v); } });
    faceHL.geometry.dispose();
    faceHL.geometry = new T.BufferGeometry();
    faceHL.geometry.setAttribute('position', new T.BufferAttribute(out, 3));
    faceHLOn = { geo, id: r.id };
  }
  if (faceHL.parent !== h.object) h.object.add(faceHL);
  faceHL.visible = true;
}
function hideFaceHL(){ faceHL.visible = false; }
function setFaceMode(on){
  faceMode = on;
  $('faceBtn').setAttribute('aria-pressed', String(on));
  if (!on){ hideFaceHL(); el.style.cursor = ''; }
  toast(on ? 'Click a flat face on the part to measure it' : 'Click face to measure is off');
}
// where on the part a hit lands, in the part's own space — only for a face that points up
function faceSpot(h){
  if (!h || h.object.userData.kind !== 'part' || !h.face || !partG) return null;
  const n = h.face.normal.clone().transformDirection(h.object.matrixWorld);
  return n.y > 0.7 ? partG.worldToLocal(h.point.clone()) : null;
}
function measureFace(pl){
  const P = state.part; if (!P) return;
  // a known step goes to that step's own spot; any other flat face, straight to where it was clicked
  const f = P.feats.find(f => Math.abs(f.value - pl.y) < 0.05 && P.targets[f.id]);
  const t = f ? P.targets[f.id] : [pl.x, pl.z];
  if (f){ P.sel = f.id; renderFeats(); }
  if (state.sliderLocked) setLock('sliderLocked', false);
  if (state.unitLocked) setLock('unitLocked', false);
  state.lift = null; state.partGoal = null;
  state.seq = { stage: 'raise', clear: tallest() + CLEAR, x: TIP_X0 + 3.5 - t[0], z: 5.5 - t[1] };
}
el.addEventListener('pointerdown', e => {
  $('hint').hidden = true;
  if (e.button !== 0) return;
  const h = pick(e), kind = h && h.object.userData.kind;
  if (!kind || kind === 'none') return;
  controls.enabled = false; flight = null; state.seq = null;
  try { el.setPointerCapture(e.pointerId); } catch (err) {}
  if (kind === 'part'){
    // slide it on the plate: grab point stays under the pointer
    liftForMove(); state.partDrag = true; state.partTarget = null; state.autoLower = false; state.dwelled = false; state.partMoveT = 0;
    dragPlane.setFromNormalAndCoplanarPoint(new T.Vector3(0, 1, 0), h.point);
    drag = { kind: 'part', ox: h.point.x - state.px, oz: h.point.z - state.pz, spot: faceSpot(h), x0: e.clientX, y0: e.clientY };
    hideFaceHL();
    el.style.cursor = 'grabbing';
    return;
  }
  if (kind === 'clampSlider'){ setLock('sliderLocked', !state.sliderLocked); drag = { kind: 'click' }; return; }
  if (kind === 'clampUnit'){ setLock('unitLocked', !state.unitLocked); drag = { kind: 'click' }; return; }
  if (kind === 'nut' || kind === 'zeroKnob'){ drag = { kind, x: e.clientX }; el.style.cursor = 'grabbing'; return; }
  // slider, scriber or unit: drag straight up and down
  const n = new T.Vector3(); camera.getWorldDirection(n); n.y = 0;
  if (n.lengthSq() < 1e-6) n.set(0, 0, -1);
  dragPlane.setFromNormalAndCoplanarPoint(n.normalize(), h.point);
  drag = { kind: 'slide', y: h.point.y };
  el.style.cursor = 'grabbing';
});
el.addEventListener('pointermove', e => {
  if (!drag){ hover(e); return; }
  if (drag.kind === 'click') return;
  if (drag.kind === 'nut'){ const dx = e.clientX - drag.x; drag.x = e.clientX; fineTurn(-dx*0.004*(e.shiftKey ? 0.25 : 1)*(fineOn ? FINE_K : 1)); return; }
  if (drag.kind === 'part'){
    setRay(e);
    if (!ray.ray.intersectPlane(dragPlane, hitP)) return;
    const goal = placePart(hitP.x - drag.ox, hitP.z - drag.oz);
    if (Math.abs(goal.x - state.px) < 1e-3 && Math.abs(goal.z - state.pz) < 1e-3 && !state.partGoal) return;
    // moving again after a pause: back up to the clearance height before the part slides
    if (state.dwelled){ state.dwelled = false; liftForMove(); state.partDrag = true; }
    state.partGoal = goal; state.partMoveT = performance.now();
    return;
  }
  if (drag.kind === 'zeroKnob'){ const dx = e.clientX - drag.x; drag.x = e.clientX; setDelta(state.delta + dx*0.02*(e.shiftKey ? 0.2 : 1)*(fineOn ? FINE_K : 1)); return; }
  setRay(e);
  if (!ray.ray.intersectPlane(dragPlane, hitP)) return;
  const dy = hitP.y - drag.y;
  // fine adjust: the slider only follows a tenth of the pointer's travel
  if (moveSlider(dy*(e.shiftKey ? 0.2 : 1)*(fineOn ? FINE_K : 1))) drag.y = hitP.y;
});
function endDrag(e){ if (!drag) return;
  // in click-face mode a click (not a drag) on a flat face measures that face
  if (drag.kind === 'part' && faceMode && drag.spot && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 5){ state.partDrag = false; state.dwelled = false; state.autoLower = false; measureFace(drag.spot); }
  else if (drag.kind === 'part'){ state.partDrag = false; state.autoLower = !state.dwelled; state.dwelled = false; } drag = null; controls.enabled = true; el.style.cursor = ''; try { el.releasePointerCapture(e.pointerId); } catch (err) {} }
el.addEventListener('pointerup', endDrag);
el.addEventListener('pointerleave', () => { hideFaceHL(); });
el.addEventListener('pointercancel', endDrag);
let hoverQ = false;
function hover(e){
  if (hoverQ) return; hoverQ = true;
  requestAnimationFrame(() => {
    hoverQ = false;
    const h = pick(e), k = h && h.object.userData.kind;
    // in click-face mode the whole face under the pointer lights up
    const spot = faceMode && !drag ? faceSpot(h) : null;
    if (spot) showFaceHL(h, 0.01); else hideFaceHL();
    el.style.cursor = (k === 'clampSlider' || k === 'clampUnit') ? 'pointer' : (k === 'nut' || k === 'zeroKnob') ? 'ew-resize' : spot ? 'crosshair' : k === 'part' ? 'grab' : (k && k !== 'none') ? 'ns-resize' : '';
  });
}
el.addEventListener('wheel', e => {
  const h = pick(e), k = h && h.object.userData.kind;
  if (k !== 'nut' && k !== 'zeroKnob') return;
  e.preventDefault(); e.stopImmediatePropagation();
  const s = Math.sign(e.deltaY || e.deltaX);
  const fk = fineOn ? FINE_K : 1;
  if (k === 'nut') fineTurn(s*0.02*(e.shiftKey ? 5 : 1)*fk);
  else setDelta(state.delta - s*0.05*fk);
}, { capture: true, passive: false });

/* ---------- tutorial ---------- */
function openTut(){ $('tut').hidden = false; setTimeout(() => { $('tutClose').focus({ preventScroll: true }); $('tut').scrollTop = 0; }, 30); }
function closeTut(){ if ($('tut').hidden) return; $('tut').hidden = true; try { localStorage.setItem('height-tutorial-seen', '1'); } catch (e) {} }


/* ---------- fine adjust: every control moves about ten times slower, for hairline settings ---------- */
let fineOn = false;
const FINE_K = 0.1;
function setFine(v){
  fineOn = v;
  ['fineBtn', 'fineQuick'].forEach(id => { const b = $(id); if (b) b.setAttribute('aria-pressed', String(v)); });
  const em = $('fineBtn').querySelector('em'); if (em) em.textContent = v ? 'on' : 'off';
  
  toast(v ? 'Fine adjust on — the slider, nut and arrow keys move about 10× slower' : 'Fine adjust off');
}
/* ---------- units: inches by default, millimeters on request ---------- */
let units = 'in';
try { units = localStorage.getItem('pt-units') === 'mm' ? 'mm' : 'in'; } catch (e) {}
const MOVES = { in: [[-25.4, '−1″'], [-2.54, '−.100″'], [-0.254, '−.010″'], [25.4, '+1″'], [2.54, '+.100″'], [0.254, '+.010″']],
                mm: [[-10, '−10 mm'], [-1, '−1 mm'], [-0.1, '−0.1 mm'], [10, '+10 mm'], [1, '+1 mm'], [0.1, '+0.1 mm']] };
function setUnits(u){
  units = u;
  try { localStorage.setItem('pt-units', u); } catch (e) {}
  document.querySelectorAll('[data-units]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.units === u)));
  document.querySelectorAll('[data-move]').forEach((b, i) => { const [v, t] = MOVES[u][i]; b.dataset.move = String(v); b.textContent = t; });
  $('pUnit').value = u; $('guess').placeholder = u === 'in' ? '0.000' : '0.00';
  $('setTo').placeholder = u === 'in' ? 'Go to 3.742 in' : 'Go to 95.06 mm';   // says which unit a plain number means
}
// "Go to": glide the slider until the gage reads the typed value, in the units showing
// a unit typed with the number wins: in, inch, inches, ″ or " read as inches; mm, millimeter(s) as mm
const unitOf = s => { const t = String(s).trim(); return /(mm|millimet(er|re)s?)\.?$/i.test(t) ? 'mm' : /(["″]|in(ch(es)?)?\.?)$/i.test(t) ? 'in' : null; };
const numOf = s => parseFloat(String(s).replace(',', '.').replace(/[^0-9.\-]+/g, ' ').trim());
function goToReading(){
  const txt = $('setTo').value.trim(), u = unitOf(txt) || units;
  const v = numOf(txt), mm = u === 'in' ? v*IN : v;
  const hi = u === 'in' ? fmtIn(RANGE/IN) + '″' : fmtMM(RANGE) + ' mm';
  if (!txt || isNaN(v) || mm < 0 || mm > RANGE){ toast(`Enter a reading between 0 and ${hi}`); return; }
  const goal = mm + state.delta;
  if (goal < minHs() - 1e-6) toast('The scriber can’t go that low here — it stops on the part');
  if (state.sliderLocked || state.unitLocked){ moveSlider(0); return; }   // says which clamp is holding it
  state.seq = null; state.lift = null;
  state.moveGoal = clamp(goal, minHs(), maxHs());
}
// the slider glides to where a button sends it, rather than jumping there
function glide(d){
  if (state.sliderLocked || state.unitLocked){ moveSlider(d); return; }            // explains why it can't move
  state.seq = null; state.lift = null;
  const from = state.moveGoal != null ? state.moveGoal : state.hs;
  state.moveGoal = clamp(from + d, minHs(), maxHs());
}

/* ---------- fold away the side panel / the reading panel ---------- */
// slide the side panel and the reading panel in and out instead of snapping
function foldAnimated(which, off, apply){
  const body = document.body, app = document.querySelector('.app'), aside = document.querySelector('aside'), rd = document.querySelector('.reading');
  const el = which === 'side' ? app : rd, cls = which === 'side' ? 'fold-side' : 'fold-panel';
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  // below 861px the side panel stacks under the view, and in exam mode both are hidden anyway
  const can = el && el.animate && !reduce && !body.classList.contains('exam') && (which !== 'side' || matchMedia('(min-width:861px)').matches);
  // measure where things are right now, which is mid-way if an earlier fold is still running
  const shown = x => x && x.getClientRects().length > 0;
  const sideNow = () => shown(aside) ? document.querySelector('main').getBoundingClientRect().left - app.getBoundingClientRect().left : 0;
  const from = which === 'side' ? sideNow() : (shown(rd) ? rd.offsetHeight : 0);
  const pad = shown(rd) ? [getComputedStyle(rd).paddingTop, getComputedStyle(rd).paddingBottom] : ['0px', '0px'];
  if (el && el._fold) el._fold.end(false);
  if (which === 'side' && shown(aside) && !body.classList.contains(cls)) app._sideW = aside.offsetWidth;
  if (!can){ apply(); return; }
  const opt = { duration: 300, easing: 'cubic-bezier(.22,.8,.25,1)' };
  const colW = app._sideW || 310;
  let a;
  if (!off) apply();   // opening: show it first so its full size can be measured
  body.classList.add(cls);
  if (which === 'side'){
    // the panel keeps its width and slides out past the left edge as its column narrows
    aside.style.width = colW + 'px';
    const cols = w => ({ gridTemplateColumns: w + 'px minmax(0px, 1fr)' });
    a = app.animate([cols(from), cols(off ? 0 : colW)], opt);
  } else {
    const to = off ? 0 : rd.offsetHeight, toPad = off ? ['0px', '0px'] : [getComputedStyle(rd).paddingTop, getComputedStyle(rd).paddingBottom];
    const fromPad = off ? pad : (from ? pad : ['0px', '0px']);
    const k = (h, p) => ({ height: h + 'px', minHeight: '0px', paddingTop: p[0], paddingBottom: p[1] });
    a = rd.animate([k(from, fromPad), k(to, toPad)], opt);
  }
  const end = (settle) => {
    if (el._fold !== fold) return;
    el._fold = null; a.cancel();
    body.classList.remove(cls);
    if (which === 'side') aside.style.width = '';
    if (off) apply();
    if (settle !== false) window.dispatchEvent(new Event('resize'));
  };
  const fold = el._fold = { end };
  a.onfinish = end;
  // a timer backs this up, since animations stall while the page is not being painted
  setTimeout(end, opt.duration + 150);
}
{
  const syncTitle = el => { if (el) el.title = el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1 ? el.textContent : ''; };
  const ids = ['status', 'contact'].map(i => document.getElementById(i)).filter(Boolean)
    .concat([...document.querySelectorAll('.reading .cell .v, .reading .cell .h, .reading .meta')]);
  const mo = new MutationObserver(() => ids.forEach(syncTitle));
  ids.forEach(el => mo.observe(el, { childList: true, characterData: true, subtree: true }));
}
function setFold(which, off, instant){
  const cls = which === 'side' ? 'side-off' : 'panel-off', btn = $(which === 'side' ? 'sideBtn' : 'panelBtn');
  const apply = () => document.body.classList.toggle(cls, off);
  if (instant) apply(); else foldAnimated(which, off, apply);
  btn.setAttribute('aria-pressed', String(off));
  const what = which === 'side' ? 'side panel' : 'reading panel';
  btn.setAttribute('aria-label', (off ? 'Show the ' : 'Hide the ') + what);
  btn.dataset.tip = off ? 'Show the ' + what : (which === 'side' ? 'Hide the side panel\nGives the 3D view the whole width.' : 'Hide the reading panel\nGives the 3D view the whole height.');
  try { localStorage.setItem('pt-fold-' + which, off ? '1' : '0'); } catch (e) {}
  setTimeout(() => window.dispatchEvent(new Event('resize')), 30);
}
function bindFolds(){
  $('sideBtn').addEventListener('click', () => setFold('side', !document.body.classList.contains('side-off')));
  $('panelBtn').addEventListener('click', () => setFold('panel', !document.body.classList.contains('panel-off')));
  try { if (localStorage.getItem('pt-fold-side') === '1') setFold('side', true, true); if (localStorage.getItem('pt-fold-panel') === '1') setFold('panel', true, true); } catch (e) {}
}
/* ---------- UI bindings ---------- */
function bindUI(){
  $('partSel').innerHTML = Object.entries(PARTS).map(([k, d]) => `<option value="${k}">${d.name}</option>`).join('');
  $('partSel').addEventListener('change', e => newPart(e.target.value));
  $('feats').addEventListener('click', e => { const b = e.target.closest('[data-feat]'); if (b) measureFeature(b.dataset.feat); });
  $('newVals').addEventListener('click', () => newPart(state.part.key, true));
  $('revealBtn').addEventListener('click', () => { if (state.part){ state.part.revealed = !state.part.revealed; renderFeats(); } });
  document.querySelectorAll('[data-move]').forEach(b => b.addEventListener('click', () => glide(parseFloat(b.dataset.move))));
  $('goBtn').addEventListener('click', goToReading);
  $('tableBtn').addEventListener('click', () => setTable($('tableBtn').getAttribute('aria-pressed') !== 'true'));
  { let off = false; try { off = localStorage.getItem('pt-table-off') === '1'; } catch (e) {} setTable(off); }
  $('setTo').addEventListener('keydown', e => { if (e.key === 'Enter') goToReading(); });
  document.querySelectorAll('[data-units]').forEach(b => b.addEventListener('click', () => setUnits(b.dataset.units)));
  setUnits(units);
  bindFolds();
  document.querySelectorAll('[data-fine]').forEach(b => b.addEventListener('click', () => { state.seq = null; fineTurn(-0.02*parseFloat(b.dataset.fine)); }));
  $('lowerBtn').addEventListener('click', lowerOnto);
  $('clampUnit').addEventListener('click', () => setLock('unitLocked', !state.unitLocked));
  $('clampSlider').addEventListener('click', () => setLock('sliderLocked', !state.sliderLocked));
  $('zeroAdj').addEventListener('input', e => setDelta(Number(e.target.value)/100));
  $('zeroBtn').addEventListener('click', zeroOnPlate);
  $('reclampBtn').addEventListener('click', () => {
    state.eps = Math.round(rand(-2.5, 2.5)*100)/100;
    if (state.hs < minHs()) state.hs = minHs();
    toast('Scriber re-clamped — it now sits a little off, so zero the gage on the plate before measuring');
  });
  document.querySelectorAll('[data-hl]').forEach(c => c.addEventListener('change', () => { state.hl[c.dataset.hl] = c.checked; lastUI = ''; }));
  document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));
  $('practiceBtn').addEventListener('click', () => setPractice(!state.practice));
  $('faceBtn').addEventListener('click', () => setFaceMode(!faceMode));
  $('examBtn').addEventListener('click', () => setExam(true));
  $('exitExam').addEventListener('click', () => setExam(false));
  $('spinBtn').addEventListener('click', () => setSpin(!controls.autoRotate));
  $('labelsBtn').addEventListener('click', () => setLabels(!examLabels));
  $('checkBtn').addEventListener('click', checkPractice);
  $('fineBtn').addEventListener('click', () => setFine(!fineOn));
  $('flatMaxBtn').addEventListener('click', () => setFlatMax(!flatMax));
  if (flatMax) setTimeout(() => setFlatMax(true), 0);
  $('flatBtn').addEventListener('click', () => {
    flatOpen = !flatOpen;
    animateFlat(() => flipLayout(() => { $('flat').classList.toggle('closed', !flatOpen); placeFlat(); }, $('flat')));
    const b = $('flatBtn'); b.setAttribute('aria-expanded', String(flatOpen)); b.setAttribute('aria-label', flatOpen ? 'Hide flat view' : 'Show flat view'); b.dataset.tip = flatOpen ? 'Hide flat view' : 'Show flat view';
    b.innerHTML = flatOpen ? '<i class="fa-solid fa-eye-slash"></i>' : '<i class="fa-solid fa-eye"></i>';
    flatKey = ''; drawFlatHG();
  });
  window.addEventListener('resize', resize);
  $('tutBtn').addEventListener('click', openTut);
  $('tutClose').addEventListener('click', closeTut);
  $('tut').addEventListener('click', e => { if (e.target === $('tut')) closeTut(); });
  $('guess').addEventListener('keydown', e => { if (e.key === 'Enter') checkPractice(); });
  $('nextBtn').addEventListener('click', loadPractice);
  $('pfb').addEventListener('click', e => { const b = e.target.closest('[data-show]'); if (b) showMe(...b.dataset.show.split(':')); });
  $('pUnit').addEventListener('change', () => { $('guess').placeholder = $('pUnit').value === 'in' ? '0.000' : '0.00'; });
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape'){ closeTut(); if (state.exam) setExam(false); return; }
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown'){
      const s = e.key === 'ArrowUp' ? 1 : -1;
      state.seq = null;
      const fk = fineOn ? FINE_K : 1;
      const step = units === 'in' ? (e.shiftKey ? 0.05*IN : 0.001*IN) : (e.shiftKey ? 1 : 0.02);
      if (state.unitLocked) fineTurn(-s*step*fk); else moveSlider(s*step*fk);
      e.preventDefault();
    } else if (e.key === 'u' || e.key === 'U') setLock('unitLocked', !state.unitLocked);
    else if (e.key === 's' || e.key === 'S') setLock('sliderLocked', !state.sliderLocked);
    else if (e.key === 'v' || e.key === 'V') setView('vernier');
    else if (e.key === 'f' || e.key === 'F') setFine(!fineOn);
  });
}

/* ---------- loop ---------- */
// the flat view sits in the corner of the 3D view, sized to fit under the buttons; on a phone it moves below
let flatOpen = true;
// glide the flat view between its open and folded sizes instead of snapping
function animateFlat(apply, done){
  const el = $('flat'), cv = $('flatCv');
  const box = () => ({ left: el.offsetLeft + 'px', top: el.offsetTop + 'px', width: el.offsetWidth + 'px', height: el.offsetHeight + 'px' });
  const from = box(), cvFrom = [cv.style.width, cv.style.height];
  if (el._flatAnim){ el._flatAnim.forEach(a => a.cancel()); el._flatAnim = null; }
  el.classList.remove('flat-anim');
  apply();
  const to = box(), cvTo = [cv.style.width, cv.style.height];
  const finish = () => { if (el._flatAnim !== anims) return; el._flatAnim.forEach(x => x.cancel()); el.classList.remove('flat-anim'); cv.style.width = cvTo[0]; cv.style.height = cvTo[1]; el._flatAnim = null; if (done) done(); };
  if (!el.animate || matchMedia('(prefers-reduced-motion: reduce)').matches || (from.width === to.width && from.height === to.height)){ if (done) done(); return; }
  // while it folds, the scales keep the size they had so they slide out of view rather than jump
  if (!flatOpen){ cv.style.width = cvFrom[0]; cv.style.height = cvFrom[1]; }
  el.classList.add('flat-anim');
  const opt = { duration: 280, easing: 'cubic-bezier(.22,.8,.25,1)' };
  const a = el.animate([from, to], opt);
  const b = cv.animate([{ opacity: flatOpen ? 0 : 1 }, { opacity: flatOpen ? 1 : 0 }], opt);
  const anims = el._flatAnim = [a, b];
  a.onfinish = finish;
  // a timer backs this up, since animations stall while the page is not being painted
  setTimeout(finish, opt.duration + 150);
}
function placeFlat(){
  const el = $('flat'), cv = $('flatCv'), dock = $('flatDock'), lp = $('loupeCv');
  const narrow = matchMedia('(max-width:700px)').matches;
  const home = narrow ? dock : wrap;
  if (el.parentElement !== home) home.appendChild(el);
  el.classList.toggle('docked', narrow);
  const views = wrap.querySelector('.views'), legend = wrap.querySelector('.legend');
  views.style.right = legend.style.right = views.style.top = legend.style.visibility = ''; el.style.top = el.style.bottom = '';
  if (lp) lp.style.display = '';
  if (narrow){ cv.style.width = cv.style.height = ''; if (lp) lp.style.width = lp.style.height = ''; el.classList.remove('min'); return; }
  // what the panel takes besides its two canvases: header, units toggle, padding, the gap between them
  const extra = el.offsetHeight - (cv.offsetHeight || 0) - (lp ? lp.offsetHeight : 0);
  // size the scales and the close-up above them (116 tall per 280 of scales) into a height;
  // both always show, shrinking together when the window is short
  const size = (avail, maxW) => {
    let w = (avail - 6)/(396/260);
    if (maxW && w > maxW) w = maxW;
    return { w, h: w*280/260, loupe: !!lp };
  };
  const apply = z => {
    cv.style.width = Math.round(z.w) + 'px'; cv.style.height = Math.round(z.h) + 'px';
    if (lp){ lp.style.display = z.loupe ? '' : 'none'; lp.style.width = Math.round(z.w) + 'px'; lp.style.height = Math.round(z.w*116/260) + 'px'; }
    if (cv._maxW !== Math.round(z.w)){ cv._maxW = Math.round(z.w); flatKey = ''; }
  };
  // maximized: scales and close-up fill the height on the right, the top-right buttons move left of them
  if (flatMax && flatOpen){
    const z = size(Math.max(120, wrap.clientHeight - 24 - extra), wrap.clientWidth*0.5);
    apply(z);
    el.classList.remove('min');
    el.style.top = '12px'; el.style.bottom = 'auto';
    const off = (el.offsetWidth + 24) + 'px';
    views.style.right = off; legend.style.right = off;
    // where the room left of the flat view is too narrow, the mouse hints step aside and the view
    // buttons drop below the top-left row instead of sitting on it
    const act = wrap.querySelector('.actions'), aR = act.offsetLeft + act.offsetWidth, fL = el.offsetLeft;
    if (fL - 12 - legend.offsetWidth < aR + 8) legend.style.visibility = 'hidden';
    if (fL - 12 - views.offsetWidth < aR + 8) views.style.top = (act.offsetTop + act.offsetHeight + 8) + 'px';
    return;
  }
  // corner size: the room left under the top-right buttons, never more than full size
  const top = wrap.clientWidth < 520 ? 140 : 100;
  const z = size(Math.min(402, wrap.clientHeight - top - 12 - extra));
  el.classList.toggle('min', z.h < 96);
  if (z.h >= 96) apply(z);
}
let flatKey = '';
// maximize: the flat view stretches to the full height of the 3D view (keeping its shape), and the
// buttons in the top right move over so none of them sit on it
let flatMax = false;
try { flatMax = localStorage.getItem('pt-flat-max') === '1'; } catch (e) {}
// smooth layout changes: every floating panel glides from where it was to where it lands, and
// grows or shrinks on the way, instead of jumping (skip: a panel animated some other way)
function flipLayout(apply, skip){
  const els = [...wrap.querySelectorAll('.actions, .views, .legend, .quick, .flat')].filter(e => e !== skip && e.offsetParent);
  const before = new Map(els.map(e => [e, e.getBoundingClientRect()]));
  apply();
  if (!Element.prototype.animate || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  for (const e of els){
    const a = before.get(e), b = e.getBoundingClientRect();
    if (!a.width || !b.width || !a.height || !b.height) continue;
    const dx = a.left - b.left, dy = a.top - b.top, sx = a.width/b.width, sy = a.height/b.height;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(sx - 1) < 0.005 && Math.abs(sy - 1) < 0.005) continue;
    if (e._flip) e._flip.cancel();
    e._flip = e.animate([
      { transformOrigin: '0 0', transform: `translate(${dx}px,${dy}px) scale(${sx},${sy})` },
      { transformOrigin: '0 0', transform: 'none' }
    ], { duration: 360, easing: 'cubic-bezier(.22,.8,.25,1)' });
  }
}
function setFlatMax(on){
  flatMax = on;
  const b = $('flatMaxBtn'), t = on ? 'Restore flat view' : 'Maximize flat view';
  b.setAttribute('aria-pressed', String(on)); b.setAttribute('aria-label', t);
  b.dataset.tip = t + (on ? '\nBack to its corner size.' : '\nStretches it to the full height of the 3D view.');
  document.body.classList.toggle('flat-max', on);
  try { localStorage.setItem('pt-flat-max', on ? '1' : '0'); } catch (e) {}
  if (on && !flatOpen) $('flatBtn').click();
  flatKey = '';
  flipLayout(() => placeFlat()); drawFlatHG();
}
// Corner text in the flat view: a see-through halo in the colour of whatever is behind it, and a spot
// that keeps clear of the marks and numbers already drawn. The asked-for spot is tried first, then
// spots stepping away from the corner (down for top text, inward along the row); the patch under
// each is read back from the canvas and the one with the least ink on it wins. Draw it last, after
// everything it should avoid. Returns the box it took, so arrow labels can keep off it too.
function cornerText(g, s, x, y, o){
  o = o || {};
  const size = o.size || 10, align = o.align || 'left', cv = g.canvas;
  g.save();
  g.font = (o.weight || 600) + ' ' + size + 'px Inter, Arial, sans-serif';
  g.textAlign = align; g.textBaseline = 'middle';
  const w = g.measureText(s).width, h = size + 2, pad = 3;
  const T = g.getTransform();
  const R = o.region || { x: 0, y: 0, w: cv.width/T.a, h: cv.height/T.d };
  const left = xx => align === 'left' ? xx : align === 'right' ? xx - w : xx - w/2;
  const inward = align === 'right' ? -1 : 1, down = o.up ? -1 : 1;
  const tries = [];
  for (let j = 0; j < 5; j++) for (let i = 0; i < 6; i++) tries.push([x + inward*i*Math.max(12, w/3), y + down*j*(h + 2)]);
  let best = null;
  for (const [tx, ty] of tries){
    const bx = left(tx) - pad, by = ty - h/2 - pad, bw = w + 2*pad, bh = h + 2*pad;
    if (bx < R.x - 0.5 || by < R.y - 0.5 || bx + bw > R.x + R.w + 0.5 || by + bh > R.y + R.h + 0.5) continue;
    const px = Math.max(0, Math.round(bx*T.a + T.e)), py = Math.max(0, Math.round(by*T.d + T.f));
    const pw = Math.min(cv.width - px, Math.round(bw*T.a)), ph = Math.min(cv.height - py, Math.round(bh*T.d));
    let ink = 1, bg = [128, 128, 128];
    if (pw > 0 && ph > 0){
      try {
        const d = g.getImageData(px, py, pw, ph).data, n = d.length/4, lum = new Float32Array(n);
        for (let k = 0; k < n; k++) lum[k] = 0.3*d[k*4] + 0.59*d[k*4 + 1] + 0.11*d[k*4 + 2];
        const med = Float32Array.from(lum).sort()[n >> 1];
        let c = 0, r = 0, gg = 0, b = 0, m = 0;
        for (let k = 0; k < n; k++){
          if (Math.abs(lum[k] - med) > 38) c++;
          else { r += d[k*4]; gg += d[k*4 + 1]; b += d[k*4 + 2]; m++; }
        }
        ink = c/n; if (m) bg = [r/m, gg/m, b/m];
      } catch (e) { ink = 0; }
    }
    if (!best || ink < best.ink - 0.004) best = { tx, ty, ink, bg, box: { x: bx, y: by, w: bw, h: bh } };
    if (ink < 0.004) break;
  }
  if (!best) best = { tx: x, ty: y, bg: [128, 128, 128], box: { x: left(x) - pad, y: y - h/2 - pad, w: w + 2*pad, h: h + 2*pad } };
  const [r, gg, b] = best.bg.map(Math.round);
  g.lineJoin = 'round'; g.lineWidth = o.halo || 4;
  g.strokeStyle = 'rgba(' + r + ',' + gg + ',' + b + ',' + (o.haloAlpha || 0.72) + ')';
  g.strokeText(s, best.tx, best.ty);
  g.fillStyle = o.col || '#111'; g.fillText(s, best.tx, best.ty);
  g.restore();
  return best.box;
}
function drawFlatHG(){
  if (!flatOpen) return;
  const R = readingMM(), I = splitIn(R), Mm = splitMM(R), show = !state.practice || state.pRevealed, hl = state.hl;
  const key = [R.toFixed(4), show, hl.imain, hl.ivern, hl.mmain, hl.mvern].join('|');
  if (key === flatKey) return; flatKey = key;
  const cv = $('flatCv'), g = cv.getContext('2d'), W = 260, H = 280, dpr = Math.min(4, (window.devicePixelRatio || 1)*Math.max(1, ($('flatCv').clientWidth || 260)/260));
  if (cv.width !== Math.round(W*dpr)){ cv.width = Math.round(W*dpr); cv.height = Math.round(H*dpr); }
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const K = 3.5, y0 = H - 16, X0 = 72, X1 = 188;            // px per mm, vernier zero, the beam's two edges
  const Y = v => y0 - (v - R)*K;
  const seg = (x0, y, x1, w, c) => { g.strokeStyle = c; g.lineWidth = w; g.beginPath(); g.moveTo(x0, y); g.lineTo(x1, y); g.stroke(); };
  const txt = (t, x, y, size, c, align) => { g.font = '600 ' + size + 'px Inter, Arial, sans-serif'; g.fillStyle = c; g.textAlign = align || 'center'; g.textBaseline = 'middle'; g.fillText(t, x, y); };
  g.fillStyle = '#0b0c0e'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#d7dadd'; g.fillRect(X0, 0, X1 - X0, H);            // beam with both main scales
  g.fillStyle = '#aeb3b9'; g.fillRect(0, 18, X0, H - 18); g.fillRect(X1, 18, W - X1, H - 18);   // vernier plates
  const C = { imain: cssVar('--hl-main'), ivern: cssVar('--hl-vern'), mmain: cssVar('--hl-mmain'), mvern: cssVar('--hl-mvern') };
  const vLo = R - 18/K, vHi = R + H/K;
  // inch main scale, on the left edge of the beam: 0.050″ lines, inch numbers, 0.2″ digits
  for (let j = Math.max(0, Math.ceil(vLo/IN_MAIN)); j*IN_MAIN <= vHi; j++){
    const y = Y(j*IN_MAIN); if (y < 20) continue;
    const L = j % 20 === 0 ? 26 : j % 10 === 0 ? 20 : j % 2 === 0 ? 14 : 9, hot = show && hl.imain && j === I.mainIdx;
    seg(X0, y, X0 + (hot ? L + 6 : L), hot ? 3 : 1.1, hot ? C.imain : '#111');
    if (j % 20 === 0) txt(String(j/20), X0 + 40, y, 15, '#111'); else if (j % 4 === 0) txt(String((j/2) % 10), X0 + 32, y, 9, '#222');
  }
  // metric main scale, on the right edge: 1 mm lines, centimeters numbered
  for (let m = Math.max(0, Math.ceil(vLo)); m <= vHi; m++){
    const y = Y(m); if (y < 20) continue;
    const L = m % 10 === 0 ? 26 : m % 5 === 0 ? 18 : 12, hot = show && hl.mmain && m === Mm.mainIdx;
    seg(X1 - (hot ? L + 6 : L), y, X1, hot ? 3 : 1, hot ? C.mmain : '#111');
    if (m % 10 === 0) txt(String(m/10), X1 - 40, y, 15, '#111');
  }
  // the two verniers, riding on the slider: 50 lines each, starting at the vernier 0
  for (let v = 0; v <= 50; v++){
    const yi = y0 - v*IN_VDIV*K, ym = y0 - v*MM_VDIV*K;
    const hi = show && hl.ivern && v === I.k, hm = show && hl.mvern && v === Mm.k;
    if (yi >= 20){ seg(X0 - (v % 5 === 0 ? 20 : 12), yi, X0, hi ? 3 : 1.1, hi ? C.ivern : '#111'); if (v % 5 === 0) txt(String(v), X0 - 32, yi, 10, hi ? '#0b5a2a' : '#1a1a1a'); }
    if (ym >= 20){ seg(X1, ym, X1 + (v % 5 === 0 ? 20 : 12), hm ? 3 : 1.1, hm ? C.mvern : '#111'); if (v % 5 === 0) txt(String(v/5), X1 + 32, ym, 10, hm ? '#0b2f66' : '#1a1a1a'); }
  }
  cornerText(g, 'Inch', 6, 9, { size: 10, col: '#c9ccd1' });
  cornerText(g, 'Metric', W - 6, 9, { size: 10, col: '#c9ccd1', align: 'right' });
  cornerText(g, 'Beam', (X0 + X1)/2, 9, { size: 10, col: '#8a8f97', align: 'center' });
  drawLoupeHG(R, I, Mm, show, C);
}
// close-up above the flat view: each row lays one vernier on its side and magnifies it around the
// line that meets a main-scale line (main scale above the edge, vernier below), inch then metric.
// While practicing, the close-up centers near the answer but does not mark it.
function drawLoupeHG(R, I, Mm, show, C){
  const cv = $('loupeCv'); if (!cv) return;
  const W = 260, H = 116, dpr = Math.min(4, (window.devicePixelRatio || 1)*Math.max(1, ($('flatCv').clientWidth || 260)/260));
  if (cv.width !== Math.round(W*dpr)){ cv.width = Math.round(W*dpr); cv.height = Math.round(H*dpr); }
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = '#0b0c0e'; g.fillRect(0, 0, W, H);
  const hl = state.hl;
  const rows = [
    { top: 0, name: 'Inch', main: IN_MAIN, vdiv: IN_VDIV, k: I.k, idx: I.mainIdx, col: C.ivern, on: hl.ivern, k2: 38, lab: v => String(v), step: '0.001″' },
    { top: 60, name: 'Metric', main: 1, vdiv: MM_VDIV, k: Mm.k, idx: Mm.mainIdx, col: C.mvern, on: hl.mvern, k2: 48, lab: v => (v % 5 === 0 ? String(v/5) : ''), step: '0.02 mm' }
  ];
  const seg = (x, y0, y1, w, c) => { g.strokeStyle = c; g.lineWidth = w; g.beginPath(); g.moveTo(x, y0); g.lineTo(x, y1); g.stroke(); };
  const pill = (s, x, y, align, bg, fg) => {
    g.font = '700 9px Inter, Arial, sans-serif'; const w = g.measureText(s).width + 10, x0 = align === 'right' ? x - w : x;
    g.fillStyle = bg || 'rgba(11,12,14,.82)'; g.fillRect(x0, y - 7, w, 14);
    g.fillStyle = fg || '#e4e6ea'; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(s, x0 + 5, y + 0.5);
  };
  for (const r of rows){
    const top = r.top, rh = 56, mid = top + 34, cx = W/2;
    const hot = show && r.on;
    const center = hot || show ? r.k : Math.max(0, Math.min(50, r.k + (Math.round(R*37) % 3) - 1));
    const vC = R + center*r.vdiv, X = v => cx + (v - vC)*r.k2, span = (W/2 + 20)/r.k2;
    g.save();
    g.beginPath(); g.rect(0, top, W, rh); g.clip();
    g.fillStyle = '#d7dadd'; g.fillRect(0, top, W, mid - top);        // main scale
    g.fillStyle = '#aeb3b9'; g.fillRect(0, mid, W, top + rh - mid);   // vernier plate
    g.fillStyle = 'rgba(0,0,0,.4)'; g.fillRect(0, mid - 0.75, W, 1.5);
    for (let j = Math.max(0, Math.floor((vC - span)/r.main)); j*r.main <= vC + span; j++){
      const x = X(j*r.main), on = hot && j === r.idx + r.k;
      seg(x, mid, top + 18, on ? 3 : 1.8, on ? r.col : '#111');
    }
    for (let v = 0; v <= 50; v++){
      const x = X(R + v*r.vdiv); if (x < -10 || x > W + 10) continue;
      const on = hot && v === r.k;
      seg(x, mid, mid + 11, on ? 3 : 1.8, on ? r.col : '#111');
      // the lit line is labeled with what it adds: thousandths on the inch vernier, mm on the metric one
      const t = on ? (r.name === 'Metric' ? (v*0.02).toFixed(2) : String(v)) : r.lab(v);
      if (t){ g.font = (on ? '700 11px' : '600 9.5px') + ' Inter, Arial, sans-serif'; g.fillStyle = on ? r.col : '#1a1a1a'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(t, x, mid + 16.5); }
    }
    pill(r.name + ' · ' + r.step, 4, top + 8);
    if (hot) pill('Line ' + r.k + ' meets a main line', W - 4, top + 8, 'right', r.col, '#fff');
    g.restore();
    g.strokeStyle = '#3a3e44'; g.lineWidth = 1; g.strokeRect(0.5, top + 0.5, W - 1, rh - 1);
  }
}
function resize(){
  placeFlat();
  const w = Math.max(1, wrap.clientWidth), h = Math.max(1, wrap.clientHeight);
  renderer.setSize(w, h, false);
  const a = w/h; camera.left = -VIEW_H/2*a; camera.right = VIEW_H/2*a; camera.top = VIEW_H/2; camera.bottom = -VIEW_H/2;
  camera.updateProjectionMatrix();
  // resizing clears the canvas, so draw straight away rather than show a blank frame
  try { renderer.render(scene, camera); } catch (e) {}
}
new ResizeObserver(resize).observe(wrap);
let prev = performance.now();
function tick(now){
  requestAnimationFrame(tick);
  const dt = Math.min(0.05, (now - prev)/1000); prev = now;
  if (state.partTarget){
    const p = state.partTarget, dx = p.x - state.px, dz = p.z - state.pz, d = Math.hypot(dx, dz);
    const step = Math.min(d, Math.max(80, d*5)*dt);
    if (d < 0.01){ state.px = p.x; state.pz = p.z; state.partTarget = null; }
    else { state.px += dx/d*step; state.pz += dz/d*step; }
  }
  // moving the part: lift the scriber to its clearance first, then let the part follow the pointer
  if (state.lift != null){
    if (state.sliderLocked || state.unitLocked) state.lift = null;
    else {
      const want = clamp(state.lift - state.eps, minHs(), maxHs()), d = want - state.hs;
      state.hs = Math.abs(d) < 0.01 ? want : state.hs + Math.sign(d)*Math.min(Math.abs(d), Math.max(60, Math.abs(d)*10)*dt);
    }
  }
  if (state.moveGoal != null){
    if (state.sliderLocked || state.unitLocked || state.seq || drag) state.moveGoal = null;
    else {
      const want = clamp(state.moveGoal, minHs(), maxHs()), d = want - state.hs;
      if (Math.abs(d) < 0.005){ state.hs = want; state.moveGoal = null; }
      else state.hs += Math.sign(d)*Math.min(Math.abs(d), Math.max(15, Math.abs(d)*7)*dt);
    }
  }
  if (state.partGoal && (state.lift == null || faceH() >= state.lift - 0.05)){
    state.px = state.partGoal.x; state.pz = state.partGoal.z; state.partGoal = null;
  }
  if (state.lift != null && !state.partDrag && !state.partGoal && Math.abs(faceH() - state.lift) < 0.01){
    state.lift = null;
    // dropped the part: bring the scriber down onto the lit face, like the depth micrometer does
    if (state.autoLower){ state.autoLower = false; state.seq = { stage: 'lower' }; }
  }
  if (state.partDrag && !state.dwelled && state.partMoveT && now - state.partMoveT > 350 && !state.partGoal && state.lift != null && faceH() >= state.lift - 0.05){
    state.dwelled = true; state.lift = null; state.seq = { stage: 'lower' };
  }
  state.contact = contactAt();
  if (state.hs < minHs() - 1e-9) state.hs = minHs();       // nothing passes through the scriber
  if (state.seq) stepSeq(dt);
  if (partG) partG.position.set(state.px, 0, state.pz);
  sliderG.position.y = state.hs + SCRIBE_DROP;
  scriberG.position.y = state.eps;
  unitG.position.y = state.hs + SCRIBE_DROP + SL_H + state.g;
  nutG.rotation.y = -state.g/FINE_PITCH*TAU;
  scaleG.position.y = state.delta;
  zeroKnob.rotation.z = state.delta/5*TAU;
  clampSliderG.rotation.x = state.sliderLocked ? 0.9 : 0;
  clampUnitG.rotation.x = state.unitLocked ? 0.9 : 0;
  if (flight){
    const k = Math.min(1, (now - flight.start)/flight.ms), e = k < 0.5 ? 4*k*k*k : 1 - Math.pow(-2*k + 2, 3)/2;
    camera.position.lerpVectors(flight.p0, flight.p1, e); controls.target.lerpVectors(flight.t0, flight.t1, e);
    camera.zoom = flight.z0*Math.pow(flight.z1/flight.z0, e); camera.updateProjectionMatrix();
    if (k >= 1) flight = null;
  }
  controls.update();
  updateUI();
  updateExam();
  shopFinish(scene);
  renderer.render(scene, camera);
}

async function start(){
  window.__load && window.__load.set(0.9, 'Setting up the view…');
  buildGage();
  bindUI();
  newPart('step');
  state.contact = contactAt();       // so moves made before the first frame have a floor to stop at
  bindFinish();
  // compile every shader in the background before the first frame, so loading never freezes the page
  shopFinish(scene);
  await new Promise(r => setTimeout(r));
  try { await renderer.compileAsync(scene, camera); } catch (e) {}
  resize();
  state.hs = 140;
  { const o = orthoFor([640, 560, 1000], [-20, 210, 0]); camera.position.copy(o.p); controls.target.copy(o.t); camera.zoom = o.z; camera.updateProjectionMatrix(); controls.update(); }
  setView('iso'); if (flight) flight.ms = 1;       // open on the fitted iso view

  // the first view is framed before the layout has settled (fonts, panels, the flat view's corner),
  // so frame it again a few times as things land, until the first touch from the user
  {
    let touched = false;
    const stop = () => { touched = true; };
    ['pointerdown', 'wheel', 'keydown'].forEach(t => window.addEventListener(t, stop, { capture: true, once: true }));
    const refit = () => { if (!touched && !state.exam) { setView('iso'); if (flight) flight.ms = 1; } };
    requestAnimationFrame(() => requestAnimationFrame(refit));
    [150, 400, 900, 1600].forEach(ms => setTimeout(refit, ms));
    window.addEventListener('resize', () => setTimeout(refit, 120));
  }
  measureFeature('s1');
  setDelta(0);
  window.__load ? window.__load.done() : $('loading').remove();
  requestAnimationFrame(tick);
}
const fontsReady = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
window.__load && window.__load.set(0.8, 'Loading fonts…');
Promise.race([fontsReady, new Promise(r => setTimeout(r, 2000))]).then(start);
})();
