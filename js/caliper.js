// A plain script, not a module, so the tool also runs when the page is opened straight from disk
// (browsers only block module files there). three.js still comes from the CDN, through the import map.
(async function(){
'use strict';
const [THREE, { OrbitControls }, { RoomEnvironment }, { mergeVertices, mergeGeometries }] = await Promise.all([
  import('three'), import('three/addons/controls/OrbitControls.js'),
  import('three/addons/environments/RoomEnvironment.js'), import('three/addons/utils/BufferGeometryUtils.js')
]);
// start once the page has been read, the way a module would
if (document.readyState === 'loading') await new Promise(r => document.addEventListener('DOMContentLoaded', r, { once: true }));
window.__load && window.__load.set(0.55, 'Building the caliper…');

const T = THREE;
const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const TAU = Math.PI * 2;
const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

const state = {
  pos: 1.0,              // true jaw opening (inches)
  bezel: 0,              // bezel rotation (radians, CCW positive)
  sliderLocked: false, bezelLocked: false, cut: false, secT: 0.5, secAxis: '+z',
  animQ: [],             // queued slider targets: { to, speed }
  practice: false, pRevealed: false, pErr: [], exam: false,
  pScore: { right: 0, total: 0, streak: 0 },
  hl: { inch: false, tenth: false, dial: false, sub: false, vern: false, outline: false },
  revealed: false,
  inst: 'dial',          // which instrument is on the bench: 'dial' or 'vern'
  fine: false            // fine adjustment: every control moves the needle ~10x slower
};
// how much slower each input runs in fine mode
const FINE = { drag: 0.09, bezel: 0.13, wheel: 0.0001, key: 0.0001, keyBig: 0.001, window: 0.05 };

/* ---------- renderer ---------- */
const wrap = $('view');
const renderer = new T.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
renderer.setClearColor(0x000000, 0);
renderer.outputColorSpace = T.SRGBColorSpace;
renderer.toneMapping = T.NeutralToneMapping;
renderer.toneMappingExposure = 0.9;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = T.PCFSoftShadowMap;
renderer.domElement.tabIndex = 0;
renderer.domElement.className = 'gl';
wrap.appendChild(renderer.domElement);
const canvas = renderer.domElement;
const MAX_ANISO = renderer.capabilities.getMaxAnisotropy();
renderer.localClippingEnabled = true;

const GFX = {
  high:   { maxDpr: Math.min(window.devicePixelRatio || 1, 2), shadows: true, map: 2048 },
  medium: { maxDpr: Math.min(window.devicePixelRatio || 1, 1.25), shadows: true, map: 1024 },
  low:    { maxDpr: 0.85, shadows: false, map: 1024 }
};
let gfx = GFX.high, dprCur = gfx.maxDpr, dprCeil = gfx.maxDpr;


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
const pmrem = new T.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.03).texture;
scene.environmentIntensity = 0.55;

const camera = new T.PerspectiveCamera(30, 1, 0.05, 300);

const CENTER = new T.Vector3(3.9, -0.45, 0);
scene.add(new T.HemisphereLight(0xffffff, 0x9aa2aa, 0.35));
const key = new T.DirectionalLight(0xffffff, 1.9);
key.shadow.bias = -0.0004; key.shadow.normalBias = 0.01; key.shadow.intensity = 0.7;
Object.assign(key.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10, near: 0.5, far: 60 });
const fill = new T.DirectionalLight(0xffffff, 0.45);
const rim = new T.DirectionalLight(0xffffff, 0.7);
key.position.copy(CENTER).add(new T.Vector3(-4, 9, 14));
fill.position.copy(CENTER).add(new T.Vector3(8, -2, 12));
rim.position.copy(CENTER).add(new T.Vector3(2, 6, -12));
[key, fill, rim].forEach(l => { l.target.position.copy(CENTER); scene.add(l, l.target); });
const ground = new T.Mesh(new T.PlaneGeometry(80, 80), new T.ShadowMaterial({ opacity: 0.35 }));
ground.rotation.x = -Math.PI / 2; ground.position.set(CENTER.x, -2.9, 0); ground.receiveShadow = true;
scene.add(ground);

let booted = false;
function resize() {
  const w = Math.max(1, wrap.clientWidth), h = Math.max(1, wrap.clientHeight);
  renderer.setPixelRatio(dprCur);
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  // resizing clears the canvas, so draw straight away rather than show a blank frame (not while loading:
  // the first frame waits until the shaders have compiled in the background)
  if (controls && booted) renderer.render(scene, camera);
}
new ResizeObserver(resize).observe(wrap);

function applyGfx(name) {
  gfx = GFX[name]; dprCur = dprCeil = gfx.maxDpr;
  key.castShadow = gfx.shadows; ground.visible = gfx.shadows;
  if (key.shadow.map) { key.shadow.map.dispose(); key.shadow.map = null; }
  key.shadow.mapSize.set(gfx.map, gfx.map);
  resize(); updateGfxInfo();
}
function updateGfxInfo() { $('gfxInfo').textContent = `Render scale ${Math.round(dprCur * 100)}% · adapts automatically to hold 60 fps.`; }

/* ------------------------------------------------------------------ textures */
function brushedTexture(base, spread, color) {
  const c = document.createElement('canvas'); c.width = c.height = 1024;
  const g = c.getContext('2d');
  g.fillStyle = `rgb(${base},${base},${base})`; g.fillRect(0, 0, 1024, 1024);
  for (let i = 0; i < 9000; i++) {
    const y = Math.random() * 1024, x0 = Math.random() * 1024, len = 60 + Math.random() * 800;
    const v = clamp(base + (Math.random() * 2 - 1) * spread, 0, 255) | 0;
    g.strokeStyle = `rgba(${v},${v},${v},${0.25 + Math.random() * 0.45})`;
    g.lineWidth = 0.4 + Math.random() * 1.3;
    g.beginPath(); g.moveTo(x0, y); g.lineTo(x0 + len, y); g.stroke();
    if (x0 + len > 1024) { g.beginPath(); g.moveTo(x0 - 1024, y); g.lineTo(x0 + len - 1024, y); g.stroke(); }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = MAX_ANISO;
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function rotated(tex) {
  const t = tex.clone(); t.center.set(0.5, 0.5); t.rotation = Math.PI / 2; t.needsUpdate = true; return t;
}
const brushMap = brushedTexture(205, 38, true);
const brushRough = brushedTexture(95, 65, false);

/* ------------------------------------------------------------------ materials */
const steel = new THREE.MeshStandardMaterial({ color: 0xc4c8cc, metalness: 0.92, roughness: 1, map: brushMap, roughnessMap: brushRough, bumpMap: brushRough, bumpScale: 0.3 });
const steelV = steel.clone(); steelV.map = rotated(brushMap); steelV.roughnessMap = rotated(brushRough); steelV.bumpMap = steelV.roughnessMap;
const steelSlider = steel.clone(); steelSlider.color = new THREE.Color(0xbcc0c4);
const knife = new THREE.MeshStandardMaterial({ color: 0x8d9197, metalness: 0.95, roughness: 0.18 });
const chrome = new THREE.MeshStandardMaterial({ color: 0xc8cbce, metalness: 1, roughness: 0.22, side: THREE.DoubleSide });
const chromeSatin = new THREE.MeshStandardMaterial({ color: 0xb4b8bc, metalness: 1, roughness: 0.35, side: THREE.DoubleSide });
// bezel ring: brushed rather than mirror, so the knurl reads as texture instead of a band of glare
const bezelChrome = new THREE.MeshStandardMaterial({ color: 0xb0b4b8, metalness: 1, roughness: 0.42, envMapIntensity: 0.7, side: THREE.DoubleSide });
const casting = new THREE.MeshStandardMaterial({ color: 0x6c7176, metalness: 0.7, roughness: 0.55 });
const rackMat = new THREE.MeshStandardMaterial({ color: 0xa9adb2, metalness: 0.95, roughness: 0.3 });
const blackGloss = new THREE.MeshStandardMaterial({ color: 0x131416, metalness: 0.1, roughness: 0.62, envMapIntensity: 0.5 });
const slotInk = new THREE.MeshStandardMaterial({ color: 0x33363a, roughness: 0.8 });

/* ------------------------------------------------------------------ geometry helpers */
function mesh(g, m) { const o = new THREE.Mesh(g, m); o.castShadow = o.receiveShadow = true; return o; }
function shapeFrom(pts) {
  const s = new THREE.Shape(); s.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
  return s;
}
// extrude a polygon (x,y inches) between z0 and z1, with a small edge bevel kept inside the outline
function prism(pts, z0, z1, mat, bevel = 0.008) {
  const b = Math.min(bevel, (z1 - z0) * 0.3);
  const g = new THREE.ExtrudeGeometry(shapeFrom(pts), {
    depth: (z1 - z0) - 2 * b, bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelOffset: -b, bevelSegments: 2, curveSegments: 1
  });
  g.translate(0, 0, z0 + b);
  return mesh(g, mat);
}
function box(x0, x1, y0, y1, z0, z1, mat, bevel) { return prism([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], z0, z1, mat, bevel); }
// polygon whose half-thickness varies per vertex -> knife-edge jaw tips
function taper(pts, zc, halfFn, capMat, sideMat) {
  const g = new THREE.ExtrudeGeometry(shapeFrom(pts), { depth: 1, bevelEnabled: false });
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const h = halfFn(p.getX(i), p.getY(i));
    p.setZ(i, zc + (p.getZ(i) > 0.5 ? h : -h));
  }
  g.computeVertexNormals();
  return mesh(g, [capMat, sideMat]);
}
// flat chamfer facet: each polygon corner gets its own half-thickness, giving a crisp ground bevel
function facet(pts, hs, zc, capMat, sideMat) {
  return taper(pts, zc, (x, y) => {
    let best = 0, bd = Infinity;
    pts.forEach((p, i) => { const d = (p[0] - x) ** 2 + (p[1] - y) ** 2; if (d < bd) { bd = d; best = i; } });
    return hs[best];
  }, capMat, sideMat);
}
// lathe around Y; vertices in the knurl band alternate outward to form knurl ridges
function knurled(profile, knurlIdx, amp, segs, mat) {
  const g = new THREE.LatheGeometry(profile.map(p => new THREE.Vector2(p[0], p[1])), segs);
  const p = g.attributes.position, n = profile.length;
  for (let i = 0; i <= segs; i += 2) for (const j of knurlIdx) {
    const k = i * n + j, x = p.getX(k), z = p.getZ(k), r = Math.hypot(x, z);
    if (r > 1e-6) { const s = (r + amp) / r; p.setX(k, x * s); p.setZ(k, z * s); }
  }
  g.computeVertexNormals();
  return mesh(g, mat);
}
function lathe(profile, mat, segs = 96) {
  return mesh(new THREE.LatheGeometry(profile.map(p => new THREE.Vector2(p[0], p[1])), segs), mat);
}
function cylZ(r, z0, z1, mat, seg = 48) {
  const g = new THREE.CylinderGeometry(r, r, z1 - z0, seg); g.rotateX(Math.PI / 2); g.translate(0, 0, (z0 + z1) / 2);
  return mesh(g, mat);
}
// Phillips pan-head screw facing +z
function screw(x, y, z, r) {
  const grp = new THREE.Group();
  const cap = Math.PI * 0.32, cosC = Math.cos(cap);
  const head = new THREE.SphereGeometry(r, 32, 12, 0, TAU, 0, cap);
  head.rotateX(Math.PI / 2); head.translate(0, 0, -r * cosC);
  grp.add(mesh(head, chromeSatin));
  const dome = r * (1 - cosC);
  const s1 = mesh(new THREE.BoxGeometry(r * 1.2, r * 0.22, dome * 0.9), slotInk); s1.position.z = dome * 0.7;
  const s2 = s1.clone(); s2.rotation.z = Math.PI / 2;
  grp.add(s1, s2);
  grp.position.set(x, y, z);
  return grp;
}

/* ------------------------------------------------------------------ dimensions (inches) */
const BT = 0.07;             // half beam thickness
const XL = -0.8, XR = 8.75; // beam ends; x = 0 is the fixed outside-jaw face
const TRAVEL = 6.3;
const ID_FACE = -0.5;       // fixed inside-jaw measuring face; moving face sits at pos + ID_FACE
const ROD_Y = 0.16, ROD_Z = -0.045;

const cal = new THREE.Group();
cal.rotation.z = 0;
scene.add(cal);

/* ------------------------------------------------------------------ beam + fixed jaws */
const beam = new THREE.Group(); cal.add(beam);
// instrument-specific parts: only one of each pair is visible at a time (see setInst)
const beamDial = new THREE.Group(), beamVern = new THREE.Group();
beam.add(beamDial, beamVern);
const BEAM_TAIL = [
  [XL, 0.31], [XL, -0.42], [-0.64, -0.52], [-0.5, -1.35], [-0.29, -1.7], [0, -1.55],
  [0, -0.46], [-0.045, -0.43], [-0.045, -0.37], [0, -0.34], [0, -0.31]
];
// dial caliper: channel down the middle for the rack
beamDial.add(prism([[XR, -0.31], [XR, 0.07], [0.25, 0.07], [0.25, 0.25], [XR, 0.25], [XR, 0.31], ...BEAM_TAIL], -BT, BT, steel));
// vernier caliper: solid bar, so the whole front face carries the scale
beamVern.add(prism([[XR, -0.31], [XR, 0.31], ...BEAM_TAIL], -BT, BT, steel));
beamDial.add(box(0.25, XR, 0.07, 0.25, -0.02, 0.02, steel, 0));     // channel web
beamDial.add(box(8.1, XR, 0.07, 0.25, 0.02, BT, steel, 0));          // front fill under end plate
// outside-jaw tip: ground ramp on the inner side running down to a knife edge
beam.add(facet([[0, -1.55], [0, -2.1], [-0.05, -2.1], [-0.29, -1.7]], [BT, 0.018, 0.018, BT], 0, knife, steelV));
// inside-measuring blade: wide and short, measuring face on its left, bevelled top
beam.add(prism([[ID_FACE, 0.30], [-0.14, 0.30], [-0.14, 0.40], [ID_FACE, 0.68]], -0.05, 0.05, steelV, 0.004));
beam.add(facet([[ID_FACE, 0.68], [-0.14, 0.40], [-0.14, 0.52], [-0.47, 0.82], [ID_FACE, 0.82]], [0.05, 0.05, 0.012, 0.012, 0.012], 0, knife, steelV));

// gear rack in the channel: teeth point up toward the dial pinion
(function rack() {
  const x0 = 0.47, x1 = 8.08, p = 0.0314;
  const s = new THREE.Shape(); s.moveTo(x0, 0.085); s.lineTo(x0, 0.15);
  let x = x0;
  while (x + p <= x1) {
    s.lineTo(x + p * 0.2, 0.176); s.lineTo(x + p * 0.5, 0.176); s.lineTo(x + p * 0.7, 0.15); s.lineTo(x + p, 0.15);
    x += p;
  }
  s.lineTo(x, 0.085);
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.028, bevelEnabled: false, curveSegments: 1 });
  g.translate(0, 0, 0.02);
  beamDial.add(mesh(g, rackMat));
})();
beamDial.add(box(0.25, 0.47, 0.075, 0.245, 0.02, 0.058, steel, 0.004));
beamDial.add(screw(0.36, 0.16, 0.058, 0.04));
// end plate
beam.add(box(8.42, 8.7, -0.14, 0.31, BT, BT + 0.03, steel, 0.006));
beam.add(screw(8.5, 0.22, BT + 0.03, 0.035));
beam.add(screw(8.62, -0.06, BT + 0.03, 0.035));

// engraved scale + lettering
(function scaleDecal() {
  const S = 420, H = 0.38, W = XR - XL;
  const c = document.createElement('canvas'); c.width = Math.round(W * S); c.height = Math.round(H * S);
  const g = c.getContext('2d');
  const bx = x => (x - XL) * S, by = y => (0.07 - y) * S;
  g.fillStyle = 'rgba(14,15,17,0.96)';
  g.fillRect(bx(-0.08), by(-0.103), (6.12 + 0.08) * S, 0.006 * S);
  for (let i = 0; i <= 60; i++) {
    const x = i / 10, major = i % 10 === 0;
    // inch lines stand well above the tenths, the way the vernier beam draws them
    const up = major ? 0.09 : 0, w = major ? 0.013 : 0.01;
    g.fillRect(bx(x) - w / 2 * S, by(-0.103 + up), w * S, (0.187 + up) * S);
    g.textAlign = 'right'; g.textBaseline = 'alphabetic';
    g.font = major ? `700 ${0.125 * S}px Arial, Helvetica, sans-serif` : `600 ${0.092 * S}px Arial, Helvetica, sans-serif`;
    g.fillText(major ? String(i / 10) : String(i % 10), bx(x) - 0.016 * S, by(major ? -0.258 : -0.248));
  }
  g.textAlign = 'left';
  g.font = `italic 600 ${0.1 * S}px Arial, Helvetica, sans-serif`;
  g.fillText('in', bx(6.035), by(-0.248));
  g.font = `${0.058 * S}px Arial, Helvetica, sans-serif`;
  if ('letterSpacing' in g) g.letterSpacing = `${0.012 * S}px`;
  g.fillText('STAINLESS   HARDENED', bx(6.95), by(-0.035));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = MAX_ANISO;
  const m = new THREE.MeshStandardMaterial({ map: t, transparent: true, roughness: 0.7, metalness: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(W, H), m);
  plane.position.set((XL + XR) / 2, 0.07 - H / 2, BT + 0.0008);
  plane.receiveShadow = true;
  beamDial.add(plane);
})();

/* ---------- vernier caliper scales ----------
   Inch vernier, 0.001″: the beam is ruled every 0.025″ (40 lines per inch, a digit every
   0.100″); the vernier plate has 25 divisions spanning 0.600″ (24 beam divisions), so each
   vernier division is 0.024″ and the line that lines up with a beam line gives thousandths.
   Both zeros sit VZ0 right of the jaw faces, so they coincide when the jaws close. */
const VZ0 = 0.12;                  // vernier zero, measured from the moving jaw face
const VDIV = 0.025, VSTEP = 0.024;  // beam division, vernier division
const VEDGE = -0.21;               // y of the inch vernier plate's reading edge (its upper edge) on the beam face
const MEDGE = 0.2;                 // y of the metric vernier plate's reading edge (its lower edge)
const MM = 1 / 25.4, MDIV = 1.95 * MM;   // metric vernier: 20 lines over 39 mm, so each line is 0.05 mm
// a canvas decal draped over a plate's profile, bevel and face: prof is [[y, z], ...] in increasing y.
// The texture runs straight up the profile, so lines drawn on it follow the bevel down to the edge.
function drapeGeo(x0, x1, prof) {
  const pos = [], uv = [], idx = [], y0 = prof[0][0], y1 = prof[prof.length - 1][0];
  prof.forEach(([y, z], i) => {
    pos.push(x0, y, z, x1, y, z);
    const v = (y - y0) / (y1 - y0); uv.push(0, v, 1, v);
    if (i) { const a = (i - 1) * 2; idx.push(a, a + 1, a + 3, a, a + 3, a + 2); }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}
function drapeDecal(parent, x0, x1, prof, S, draw) {
  const y0 = prof[0][0], y1 = prof[prof.length - 1][0], c = document.createElement('canvas');
  c.width = Math.round((x1 - x0) * S); c.height = Math.round((y1 - y0) * S);
  draw(c.getContext('2d'), x => (x - x0) * S, y => (y1 - y) * S, S);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = MAX_ANISO;
  const m = new THREE.MeshStandardMaterial({ map: t, transparent: true, roughness: 0.7, metalness: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
  const mesh = new THREE.Mesh(drapeGeo(x0, x1, prof.map(([y, z]) => [y, z + 0.0006])), m);
  mesh.receiveShadow = true; parent.add(mesh);
  return mesh;
}
// a canvas decal in inch coordinates, cut into tiles so each texture stays under 4096 px
function decal(parent, x0, x1, y0, y1, z, S, tiles, draw, mat) {
  const tw = (x1 - x0) / tiles;
  for (let i = 0; i < tiles; i++) {
    const tx0 = x0 + i * tw, c = document.createElement('canvas');
    c.width = Math.round(tw * S); c.height = Math.round((y1 - y0) * S);
    const g = c.getContext('2d');
    draw(g, x => (x - tx0) * S, y => (y1 - y) * S, S);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = MAX_ANISO;
    const m = new THREE.MeshStandardMaterial(Object.assign({ map: t, transparent: true, roughness: 0.7, metalness: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }, mat || {}));
    const p = new THREE.Mesh(new THREE.PlaneGeometry(tw, y1 - y0), m);
    p.position.set(tx0 + tw / 2, (y0 + y1) / 2, z); p.receiveShadow = true;
    parent.add(p);
  }
}
const INK = 'rgba(14,15,17,0.96)';
// metric scale along the top of the beam: every line hangs from under the upper plate, cm numbered
// below the lines. Inch scale along the bottom: every line rises from under the lower plate, and its
// top (y) depends on the division: inch, 0.100″, 0.050″, 0.025″, with the digits above the lines.
const M_ROOT = 0.27;
const mLineBot = m => M_ROOT - (m % 10 === 0 ? 0.15 : m % 5 === 0 ? 0.125 : 0.105);
const V_ROOT = -0.28;
const vLineTop = i => V_ROOT + (i % 40 === 0 ? 0.2 : i % 4 === 0 ? 0.155 : i % 2 === 0 ? 0.125 : 0.105);
decal(beamVern, XL, XR, -0.31, 0.31, BT + 0.0008, 800, 2, (g, bx, by, S) => {
  g.fillStyle = INK; g.textBaseline = 'middle'; g.textAlign = 'center';
  for (let m = 0; m <= 180; m++) {
    const x = VZ0 + m * MM, w = (m % 5 === 0 ? 0.005 : 0.004) * S;
    g.fillRect(bx(x) - w / 2, by(M_ROOT), w, (M_ROOT - mLineBot(m)) * S);
    if (m % 10 === 0) {
      g.font = `600 ${0.072 * S}px Arial, Helvetica, sans-serif`;
      g.fillText(String(m / 10), bx(x), by(0.08));
    }
  }
  for (let i = 0; i <= 280; i++) {
    const x = VZ0 + i * VDIV, w = (i % 4 === 0 ? 0.0055 : 0.0045) * S;
    g.fillRect(bx(x) - w / 2, by(vLineTop(i)), w, (vLineTop(i) - V_ROOT) * S);
    if (i % 40 === 0) {
      g.font = `700 ${0.1 * S}px Arial, Helvetica, sans-serif`;
      g.fillText(String(i / 40), bx(x), by(-0.03));
    } else if (i % 4 === 0) {
      g.font = `600 ${0.058 * S}px Arial, Helvetica, sans-serif`;
      g.fillText(String((i / 4) % 10), bx(x), by(-0.088));
    }
  }
  g.textAlign = 'left';
  g.font = `italic 600 ${0.07 * S}px Arial, Helvetica, sans-serif`;
  g.fillText('mm', bx(VZ0 + 181 * MM), by(0.08));
  g.fillText('in', bx(VZ0 + 7.05), by(-0.03));
  g.font = `${0.052 * S}px Arial, Helvetica, sans-serif`;
  if ('letterSpacing' in g) g.letterSpacing = `${0.012 * S}px`;
  g.fillText('STAINLESS   HARDENED', bx(7.55), by(0.02));
  g.fillText('0.05 mm · 0.001 in', bx(7.55), by(-0.075));
});

/* ------------------------------------------------------------------ slider */
const slider = new THREE.Group(); slider.userData.role = 'slider'; cal.add(slider);

// moving outside jaw + bridge under the beam
slider.add(prism([
  [0, -0.315], [2.1, -0.315], [2.1, -0.45], [0.64, -0.45], [0.64, -0.52], [0.5, -1.35], [0.29, -1.7], [0, -1.55],
  [0, -0.46], [0.045, -0.43], [0.045, -0.37], [0, -0.34]
], -BT, BT, steelV));
slider.add(facet([[0, -1.55], [0.29, -1.7], [0.05, -2.1], [0, -2.1]], [BT, BT, 0.018, 0.018], 0, knife, steelV));
slider.add(box(0.02, 2.1, 0.315, 0.42, -BT, BT, steelSlider));                                           // top gib
const sliderDial = new THREE.Group(), sliderVern = new THREE.Group();
slider.add(sliderDial, sliderVern);
sliderDial.add(prism([[0, -0.62], [1.5, -0.62], [1.72, -0.45], [2.1, -0.45], [2.1, 0.42], [0, 0.42]], BT + 0.002, 0.18, steelSlider)); // front plate
// vernier slider, built like the real one: an open frame whose window shows the beam's middle, a
// metric vernier plate screwed along the top and an inch vernier plate along the bottom. Each plate's
// reading edge is ground to a bevel that comes right down to the beam, so the lines meet with little
// parallax; the thumb-roller corner and the end post are the only solid parts of the frame.
const VWIN = 1.7;                 // right end of the inch plate (the roller bracket sits beyond it)
const VPOST = 1.98;               // inside face of the frame's end post
const VPZ = BT + 0.045;           // front face of both plates
const VB = 0.04;                  // height of each bevel
const vernPlateMat = new THREE.MeshStandardMaterial({ color: 0xc9cdd1, metalness: 0.62, roughness: 0.5, envMapIntensity: 0.7 });
// frame: the body under the metric plate, and the solid corner with the roller bracket and end post
sliderVern.add(prism([[0, -0.62], [1.5, -0.62], [VWIN, -0.466], [VWIN, -0.44], [0, -0.44]], BT + 0.002, 0.13, steelSlider));
sliderVern.add(prism([[VWIN, -0.466], [1.72, -0.45], [2.1, -0.45], [2.1, 0.42], [VPOST, 0.42], [VPOST, -0.2], [VWIN, -0.2]], BT + 0.002, 0.18, steelSlider));
// metric plate: face from the bevel up to the top of the slider
const UP_PROF = [[MEDGE, BT + 0.006], [MEDGE + VB, VPZ], [0.42, VPZ]];
sliderVern.add(prism([[0, MEDGE + VB], [VPOST, MEDGE + VB], [VPOST, 0.42], [0, 0.42]], BT + 0.002, VPZ, vernPlateMat, 0.004));
sliderVern.add(facet([[0, MEDGE], [VPOST, MEDGE], [VPOST, MEDGE + VB], [0, MEDGE + VB]], [0.003, 0.003, 0.042, 0.042], BT + 0.003, vernPlateMat, vernPlateMat));
// inch plate: face from below the beam up to its bevel
const LO_PROF = [[-0.44, VPZ], [VEDGE - VB, VPZ], [VEDGE, BT + 0.006]];
sliderVern.add(prism([[0.004, -0.44], [VWIN, -0.44], [VWIN, VEDGE - VB], [0.004, VEDGE - VB]], BT + 0.002, VPZ, vernPlateMat, 0.004));
sliderVern.add(facet([[0.004, VEDGE - VB], [VWIN, VEDGE - VB], [VWIN, VEDGE], [0.004, VEDGE]], [0.042, 0.042, 0.003, 0.003], BT + 0.003, vernPlateMat, vernPlateMat));
// screws at each end of both plates
// (the inside-jaw root covers the plate left of x = 0.3 above the beam, so the screw sits past it)
sliderVern.add(screw(0.36, 0.37, VPZ, 0.026), screw(VPOST - 0.07, 0.37, VPZ, 0.026));
sliderVern.add(screw(0.05, -0.395, VPZ, 0.028), screw(VWIN - 0.06, -0.395, VPZ, 0.028));
// metric vernier: 20 lines of 0.05 mm, numbered 0–10, running up from the reading edge
drapeDecal(sliderVern, 0, VPOST, UP_PROF, 1600, (g, bx, by, S) => {
  g.fillStyle = INK; g.textBaseline = 'middle'; g.textAlign = 'center';
  for (let k = 0; k <= 20; k++) {
    const x = VZ0 + k * MDIV, L = k % 2 === 0 ? 0.06 : 0.04, w = 0.0045 * S;
    g.fillRect(bx(x) - w / 2, by(MEDGE + L), w, L * S);
    if (k % 2 === 0) {
      g.font = `600 ${0.05 * S}px Arial, Helvetica, sans-serif`;
      g.fillText(String(k / 2), bx(x), by(0.285));
    }
  }
  g.textAlign = 'left';
  g.font = `600 ${0.042 * S}px Arial, Helvetica, sans-serif`;
  g.fillText('0.05mm', bx(VZ0 + 20 * MDIV + 0.07), by(0.285));
});
// inch vernier: 25 lines of 0.001″, running down from its reading edge
drapeDecal(sliderVern, 0.004, VWIN, LO_PROF, 1600, (g, bx, by, S) => {
  g.fillStyle = INK; g.textBaseline = 'middle'; g.textAlign = 'center';
  for (let i = 0; i <= 25; i++) {
    const x = VZ0 + i * VSTEP, L = i % 5 === 0 ? 0.075 : 0.05, w = 0.0045 * S;
    g.fillRect(bx(x) - w / 2, by(VEDGE), w, L * S);
    if (i % 5 === 0) {
      g.font = `600 ${0.055 * S}px Arial, Helvetica, sans-serif`;
      g.fillText(String(i), bx(x), by(-0.33));
    }
  }
  g.textAlign = 'left';
  g.font = `600 ${0.042 * S}px Arial, Helvetica, sans-serif`;
  g.fillText('0.001in', bx(VZ0 + 0.66), by(-0.33));
});
slider.add(box(0, 2.1, -0.62, 0.42, -0.18, -BT - 0.002, steelSlider));                                  // back plate
// moving inside jaw (measuring face on its right)
slider.add(box(-0.86, 0.3, 0.31, 0.42, 0.055, 0.15, steelSlider, 0.006));
slider.add(prism([[ID_FACE, 0.31], [ID_FACE, 0.68], [-0.86, 0.40], [-0.86, 0.31]], 0.055, 0.125, steelV, 0.004));
slider.add(facet([[ID_FACE, 0.68], [ID_FACE, 0.82], [-0.53, 0.82], [-0.86, 0.52], [-0.86, 0.40]], [0.035, 0.01, 0.01, 0.01, 0.035], 0.09, knife, steelV));
// depth rod riding in the rear groove
slider.add(box(0.65, 8.4, 0.1, 0.22, -0.065, -0.025, steel, 0.004));
slider.add(box(8.4, XR, 0.1, 0.16, -0.065, -0.025, steel, 0.004));

// dial assembly
const dial = new THREE.Group(); dial.position.set(0.95, 0.22, 0); sliderDial.add(dial);
dial.add(cylZ(0.738, 0.18, 0.36, steelSlider, 96));

const bezel = new THREE.Group(); dial.add(bezel);
(function buildBezel() {
  const prof = [[0.655, 0.47], [0.668, 0.498], [0.7, 0.518], [0.752, 0.52], [0.779, 0.506], [0.786, 0.49], [0.786, 0.435], [0.786, 0.378], [0.776, 0.354], [0.748, 0.342], [0.736, 0.346]];
  const ring = knurled(prof, [5, 6, 7], 0.009, 420, bezelChrome);
  ring.geometry.rotateX(Math.PI / 2);
  ring.userData.role = 'bezel';
  bezel.add(ring);

  // dial face
  const S = 2048, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d'), cx = S / 2, px = (S / 2) / 0.67;
  const P = (u, v) => [cx + u * px, cx - v * px];
  g.fillStyle = '#f0f1f2'; g.beginPath(); g.arc(cx, cx, S / 2, 0, TAU); g.fill();
  const rg = g.createRadialGradient(cx, cx, S * 0.40, cx, cx, S / 2);
  rg.addColorStop(0, 'rgba(0,0,0,0)'); rg.addColorStop(1, 'rgba(40,45,50,0.16)');
  g.fillStyle = rg; g.beginPath(); g.arc(cx, cx, S / 2, 0, TAU); g.fill();
  g.strokeStyle = '#0f1012'; g.lineCap = 'butt';
  for (let i = 0; i < 100; i++) {
    const a = i / 100 * TAU, len = i % 10 === 0 ? 0.105 : i % 5 === 0 ? 0.08 : 0.052;
    const r0 = 0.648, r1 = r0 - len;
    g.lineWidth = (i % 10 === 0 ? 0.008 : i % 5 === 0 ? 0.0065 : 0.005) * px;
    g.beginPath(); g.moveTo(...P(r0 * Math.sin(a), r0 * Math.cos(a))); g.lineTo(...P(r1 * Math.sin(a), r1 * Math.cos(a))); g.stroke();
  }
  g.fillStyle = '#0f1012'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `${0.1 * px}px Arial, Helvetica, sans-serif`;
  for (let v = 0; v < 100; v += 10) {
    const a = v / 100 * TAU, r = 0.455;
    g.fillText(String(v), ...P(r * Math.sin(a), r * Math.cos(a)));
  }
  g.fillStyle = '#0f1012';
  (function sym(u, v) { // ►|◄ resolution symbol
    const [x, y] = P(u, v), s = 0.022 * px;
    g.beginPath(); g.moveTo(x - 3.4 * s, y - s * 0.6); g.lineTo(x - 2.2 * s, y); g.lineTo(x - 3.4 * s, y + s * 0.6); g.fill();
    g.fillRect(x - 2.2 * s, y - s * 0.9, s * 0.22, s * 1.8);
    g.fillRect(x - 1.3 * s, y - s * 0.9, s * 0.22, s * 1.8);
    g.beginPath(); g.moveTo(x - 0.1 * s, y - s * 0.6); g.lineTo(x - 1.1 * s, y); g.lineTo(x - 0.1 * s, y + s * 0.6); g.fill();
  })(-0.03, -0.205);
  g.textAlign = 'left'; g.font = `${0.058 * px}px Arial, Helvetica, sans-serif`;
  g.fillText('0.001"', ...P(0.02, -0.205));
  g.textAlign = 'center'; g.font = `${0.056 * px}px Arial, Helvetica, sans-serif`;
  g.fillText('SHOCK-PROOF', ...P(0, -0.3));
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = MAX_ANISO;
  // tinted down so the white face sits in the light like the steel instead of glowing
  const face = mesh(new THREE.CircleGeometry(0.67, 128), new THREE.MeshStandardMaterial({ map: t, color: 0xa7abb0, roughness: 1, metalness: 0, envMapIntensity: 0.12 }));
  face.position.z = 0.462; face.userData.role = 'slider';
  bezel.add(face);
})();

// needle
const needle = new THREE.Group(); dial.add(needle);
(function buildNeedle() {
  const s = shapeFrom([[0, 0.635], [0.011, 0.1], [0.024, 0], [0.018, -0.3], [-0.018, -0.3], [-0.024, 0], [-0.011, 0.1]]);
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.006, bevelEnabled: false });
  g.translate(0, 0, 0.47);
  needle.add(mesh(g, blackGloss));
  needle.add(cylZ(0.05, 0.462, 0.482, blackGloss, 40));
  needle.add(cylZ(0.02, 0.482, 0.49, chrome, 24));
})();

// crystal
(function crystal() {
  const R = 4, top = 0.53;
  const g = new THREE.SphereGeometry(R, 72, 6, 0, TAU, 0, Math.asin(0.672 / R));
  g.rotateX(Math.PI / 2); g.translate(0, 0, top - R);
  const m = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, metalness: 0, roughness: 0.4, ior: 1.42,
    transparent: true, opacity: 0.03, depthWrite: false,
    clearcoat: 0.1, clearcoatRoughness: 0.55,
    specularIntensity: 0.18, envMapIntensity: 0.15
  });
  const o = new THREE.Mesh(g, m); o.raycast = () => {};
  dial.add(o);
})();

// a locked part turns solid red, and stays red until it is released
const lockRedCache = new Map();
function lockRedOf(mat){
  let r = lockRedCache.get(mat);
  if (!r){
    r = mat.clone(); r.color = new THREE.Color(0xd8261b);
    r.metalness = Math.min(r.metalness, 0.45); r.roughness = Math.max(r.roughness, 0.3);
    r.emissive = new THREE.Color(0x4a0603); r.emissiveIntensity = 1;
    lockRedCache.set(mat, r);
  }
  return r;
}
function paintLock(parts, v){ parts.forEach(o => { if (!o.userData.lockBase) o.userData.lockBase = o.material; o.material = v ? lockRedOf(o.userData.lockBase) : o.userData.lockBase; }); }
const lockMeshes = g => { const out = []; g.traverse(o => { if (o.isMesh && o.material && o.material.colorWrite !== false && !o.material.isShaderMaterial) out.push(o); }); return out; };
// lock screws
const KNOB_PROFILE = [[0.001, 0], [0.088, 0], [0.1, 0.014], [0.1, 0.1], [0.1, 0.186], [0.088, 0.2], [0.001, 0.2]];
function knob() {
  const grp = new THREE.Group();
  grp.add(mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.05, 20).translate(0, -0.02, 0), chromeSatin));
  const k = knurled(KNOB_PROFILE, [2, 3, 4], 0.007, 72, chrome);
  k.position.y = 0.005; grp.add(k);
  return grp;
}
const lockTop = new THREE.Group(); lockTop.position.set(1.45, 0.44, 0); lockTop.userData.role = 'sliderLock';
const lockTopKnob = knob(); lockTop.add(lockTopKnob); slider.add(lockTop);

sliderDial.add(box(1.09, 1.31, -0.66, -0.5, 0.17, 0.37, steelSlider, 0.006));
const lockBot = new THREE.Group(); lockBot.position.set(1.2, -0.68, 0.27); lockBot.rotation.x = Math.PI; lockBot.userData.role = 'bezelLock';
const lockBotKnob = knob(); lockBot.add(lockBotKnob); sliderDial.add(lockBot);

// thumb roller and bracket
slider.add(prism([[1.7, -0.64], [2.28, -0.64], [2.5, -0.5], [2.5, -0.34], [2.3, -0.2], [1.7, -0.2]], 0.18, 0.25, casting));
slider.add(screw(1.92, -0.42, 0.25, 0.055));
const WHEEL_R = 0.24;
const wheel = new THREE.Group(); wheel.position.set(2.5, -0.44, 0); wheel.userData.role = 'wheel'; slider.add(wheel);
(function buildWheel() {
  wheel.add(cylZ(0.05, 0.24, 0.27, chromeSatin, 24));
  const prof = [[0.001, 0.388], [0.06, 0.388], [0.07, 0.378], [0.12, 0.378], [0.13, 0.372], [0.19, 0.372], [0.222, 0.368], [0.24, 0.352], [0.24, 0.32], [0.24, 0.288], [0.222, 0.272], [0.18, 0.264], [0.001, 0.264]];
  const w = knurled(prof, [7, 8, 9], 0.011, 150, chrome);
  w.geometry.rotateX(Math.PI / 2);
  wheel.add(w);
})();


/* ---------- clear markings by default; the realistic metal finish is a setting ----------
   The turned and brushed finish puts streaks and reflections behind the graduations and makes them
   harder to read, so by default the surfaces that carry markings are a plain, even matte grey.
   "Realistic metal finish" in the sidebar brings the real finish back; the choice is remembered. */
const CLEAR_MATS = () => [[steel, 0xd3d6da], [steelV, 0xd3d6da], [steelSlider, 0xc9cdd1], [vernPlateMat, 0xe4e6e9]];
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

/* ------------------------------------------------------------------ parts to measure */
const M = {
  ground: new THREE.MeshStandardMaterial({ color: 0xc2c6ca, metalness: 1, roughness: 0.2, side: THREE.DoubleSide }),
  brass: new THREE.MeshStandardMaterial({ color: 0xb88f3e, metalness: 1, roughness: 0.3, side: THREE.DoubleSide }),
  alu: new THREE.MeshStandardMaterial({ color: 0x4f78a8, metalness: 0.55, roughness: 0.45, side: THREE.DoubleSide }),
  aluRed: new THREE.MeshStandardMaterial({ color: 0xa9553f, metalness: 0.5, roughness: 0.45, side: THREE.DoubleSide }),
  aluGreen: new THREE.MeshStandardMaterial({ color: 0x4f9670, metalness: 0.5, roughness: 0.45, side: THREE.DoubleSide }),
  steelBar: new THREE.MeshStandardMaterial({ color: 0xaeb3b8, metalness: 0.95, roughness: 1, map: brushMap, roughnessMap: brushRough, bumpMap: brushRough, bumpScale: 0.3 }),
  blue: new THREE.MeshStandardMaterial({ color: 0x5b9dff, metalness: 0.2, roughness: 0.5 }),
};
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
// plain ground steel gets fine grinding marks so it is not a perfectly smooth, fake-looking surface
M.ground.bumpMap = brushRough; M.ground.bumpScale = 0.04;
partFinish(M.ground, 0.5, 0.44);
partFinish(M.brass, 0.55, 0.46);
partFinish(M.alu, 0.3, 0.56, { tone: 1 });
partFinish(M.aluRed, 0.3, 0.56, { tone: 1 });
partFinish(M.aluGreen, 0.3, 0.56, { tone: 1 });
partFinish(M.steelBar, 0.5, 0.62, { bump: 0.6 });
const zAxis = g => (g.rotateX(Math.PI / 2), g);          // Y-axis geometry -> Z axis
const xAxis = g => (g.rotateZ(-Math.PI / 2), g);         // Y-axis geometry -> X axis
const V2 = pts => pts.map(p => new THREE.Vector2(p[0], p[1]));

/*
 * tool 'od'    : part built centered on the origin, measured along x, `ext` = height in y
 * tool 'id'    : part built around the bore/slot center, sitting on y = 0 and rising up
 * tool 'depth' : part built from the beam end face (x = 0) outward, centered on the rod line
 */
const PARTS = {
  pin: { tool: 'od', label: 'Gauge pin', what: 'diameter', range: [0.2, 2.2], hint: 'Close the outside jaws on the pin.',
    build(D) {
      const g = new THREE.Group();
      g.add(mesh(zAxis(new THREE.CylinderGeometry(D / 2, D / 2, 0.7, 96)), M.ground));
      return { obj: g, ext: D };
    } },
  hex: { tool: 'od', label: 'Hex bar', what: 'width across flats', range: [0.25, 1.75], hint: 'Put the jaws on two opposite flats.',
    build(F) {
      const r = F / Math.sqrt(3);
      const g = new THREE.Group();
      g.add(mesh(zAxis(new THREE.CylinderGeometry(r, r, 0.9, 6)), M.steelBar));
      return { obj: g, ext: 2 * r };
    } },
  block: { tool: 'od', label: 'Gauge block', what: 'length', range: [0.1, 4.0], hint: 'Close the outside jaws on the block ends.',
    build(L) {
      const g = new THREE.Group();
      g.add(mesh(new THREE.BoxGeometry(L, 0.35, 1.2), M.ground));
      return { obj: g, ext: 0.35 };
    } },
  ball: { tool: 'od', label: 'Steel ball', what: 'diameter', range: [0.187, 2.0], hint: 'Close the outside jaws across the ball.',
    build(D) {
      const g = new THREE.Group();
      g.add(mesh(new THREE.SphereGeometry(D / 2, 64, 40), M.ground));
      return { obj: g, ext: D };
    } },
  tube: { tool: 'od', label: 'Aluminum tube', what: 'outside diameter', range: [0.5, 2.2], hint: 'Close the outside jaws across the tube.',
    build(D) {
      const w = Math.min(0.12, D * 0.12), L = 0.9, ro = D / 2, ri = ro - w;
      const g = new THREE.Group();
      g.add(mesh(zAxis(new THREE.LatheGeometry(V2([[ri, -L / 2], [ro, -L / 2], [ro, L / 2], [ri, L / 2], [ri, -L / 2]]), 96)), M.alu));
      return { obj: g, ext: D };
    } },

  ring: { tool: 'id', label: 'Ring gauge', what: 'bore', range: [0.5, 2.0], hint: 'Open the inside jaws until they touch the bore.',
    build(d) {
      const ri = d / 2, ro = ri + 0.17, h = 0.13;
      const g = new THREE.Group();
      g.add(lathe([[ri, 0], [ro, 0], [ro, h], [ri, h], [ri, 0]], M.ground, 128));
      return { obj: g };
    } },
  bearing: { tool: 'id', label: 'Ball bearing', what: 'bore', range: [0.5, 1.3], hint: 'Open the inside jaws against the inner race.',
    build(d) {
      const ri = d / 2, h = 0.22, g = new THREE.Group();
      g.add(lathe([[ri, 0], [ri + 0.12, 0], [ri + 0.12, h], [ri, h], [ri, 0]], M.ground, 128));
      g.add(lathe([[ri + 0.3, 0], [ri + 0.45, 0], [ri + 0.45, h], [ri + 0.3, h], [ri + 0.3, 0]], M.ground, 128));
      g.add(lathe([[ri + 0.12, 0.03], [ri + 0.3, 0.03]], M.blue, 128));   // seal
      const rb = ri + 0.21, n = Math.floor(TAU * rb / 0.2);
      for (let i = 0; i < n; i++) {
        const b = mesh(new THREE.SphereGeometry(0.085, 20, 14), M.ground);
        b.position.set(rb * Math.cos(i / n * TAU), h / 2, rb * Math.sin(i / n * TAU));
        g.add(b);
      }
      return { obj: g };
    } },
  slot: { tool: 'id', label: 'Slotted block', what: 'slot width', range: [0.5, 2.4], hint: 'Open the inside jaws against the slot walls.',
    build(w) {
      // one solid block with a through slot, extruded upward
      const h = 0.18, b = 0.01, a0 = -w / 2 - 0.35, a1 = w / 2 + 0.35;
      const s = shapeFrom([[a0, -0.45], [a1, -0.45], [a1, 0.5], [a0, 0.5]]);
      s.holes.push(new THREE.Path([[-w / 2, -0.2], [-w / 2, 0.25], [w / 2, 0.25], [w / 2, -0.2]].map(p => new THREE.Vector2(p[0], p[1]))));
      const geo = new THREE.ExtrudeGeometry(s, { depth: h - 2 * b, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelOffset: -b, bevelSegments: 2, curveSegments: 1 });
      geo.translate(0, 0, b); geo.rotateX(Math.PI / 2); geo.translate(0, h, 0);
      const g = new THREE.Group(); g.add(mesh(geo, M.aluRed));
      return { obj: g };
    } },
  coupling: { tool: 'id', label: 'Brass coupling', what: 'inside diameter', range: [0.6, 2.0], hint: 'Open the inside jaws inside the coupling.',
    build(d) {
      const ri = d / 2, ro = ri + 0.08, h = 0.2, g = new THREE.Group();
      g.add(lathe([[ri, 0], [ro, 0], [ro + 0.03, 0.03], [ro + 0.03, h - 0.03], [ro, h], [ri, h], [ri, 0]], M.brass, 128));
      return { obj: g };
    } },

  pocket: { tool: 'depth', label: 'Pocket block', what: 'pocket depth', range: [0.3, 2.8], hint: 'Rest the beam end on the block and run the rod to the bottom.',
    build(h) {
      const e = h + 0.45, Y0 = -1.0, Y1 = 0.85, Z0 = -0.7, Z1 = 0.7, py = 0.12, pz = 0.18;
      // one watertight block with a closed rectangular pocket (no internal faces or seams)
      const geo = solidGeo([
        ['x', e, 1, Y0, Y1, Z0, Z1],
        ['x', 0, -1, Y0, -py, Z0, Z1], ['x', 0, -1, py, Y1, Z0, Z1], ['x', 0, -1, -py, py, Z0, -pz], ['x', 0, -1, -py, py, pz, Z1],
        ['y', Y1, 1, Z0, Z1, 0, e], ['y', Y0, -1, Z0, Z1, 0, e],
        ['z', Z1, 1, 0, e, Y0, Y1], ['z', Z0, -1, 0, e, Y0, Y1],
        ['x', h, -1, -py, py, -pz, pz],
        ['y', -py, 1, -pz, pz, 0, h], ['y', py, -1, -pz, pz, 0, h],
        ['z', -pz, 1, 0, h, -py, py], ['z', pz, -1, 0, h, -py, py]
      ]);
      const g = new THREE.Group(); g.add(mesh(geo, M.alu));
      return { obj: g };
    } },
  hole: { tool: 'depth', label: 'Round boss', what: 'blind hole depth', range: [0.25, 2.5], hint: 'Rest the beam end on the boss face and run the rod into the hole.',
    build(h) {
      const L = h + 0.4, rh = 0.14, R = 0.85, g = new THREE.Group();
      g.add(mesh(xAxis(new THREE.LatheGeometry(V2([[rh, 0], [R - 0.03, 0], [R, 0.03], [R, L], [0.001, L], [0.001, h], [rh, h], [rh, 0]]), 96)), M.steelBar));
      return { obj: g };
    } },
  shoulder: { tool: 'depth', label: 'Shouldered block', what: 'step height', range: [0.2, 2.5], hint: 'Rest the beam end on the upper step and lower the rod to the next one.',
    build(h) {
      const e = h + 0.5, g = new THREE.Group();
      g.add(prism([[0, -1.0], [e, -1.0], [e, 0.9], [h, 0.9], [h, -0.1], [0, -0.1]], -0.65, 0.65, M.aluGreen, 0.01));
      return { obj: g };
    } },
  channel: { tool: 'depth', label: 'Channel block', what: 'groove depth', range: [0.15, 2.0], hint: 'Bridge the groove with the beam end and run the rod to the bottom.',
    build(h) {
      const e = h + 0.4, g = new THREE.Group();
      g.add(prism([[0, -1.0], [e, -1.0], [e, 0.9], [0, 0.9], [0, 0.12], [h, 0.12], [h, -0.1], [0, -0.1]], -0.65, 0.65, M.steelBar, 0.01));
      return { obj: g };
    } },
};
// axis-aligned faces -> one mesh. face: [axis, plane, normalSign, a0, a1, b0, b1]
// in-plane axes: x -> (y, z), y -> (z, x), z -> (x, y)
function solidGeo(faces) {
  const pos = [], nrm = [], uv = [];
  for (const [ax, c, s, a0, a1, b0, b1] of faces) {
    const P = (a, b) => ax === 'x' ? [c, a, b] : ax === 'y' ? [b, c, a] : [a, b, c];
    let q = [[a0, b0], [a1, b0], [a1, b1], [a0, b1]];
    if (s < 0) q = q.reverse();
    const n = ax === 'x' ? [s, 0, 0] : ax === 'y' ? [0, s, 0] : [0, 0, s];
    for (const i of [0, 1, 2, 0, 2, 3]) { pos.push(...P(...q[i])); nrm.push(...n); uv.push(q[i][0], q[i][1]); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeBoundingSphere();
  return g;
}
/* ---------- feedback ---------- */
let toastTimer = 0, lastToastAt = 0, lastToastMsg = '';
function toast(msg){
  const now = performance.now();
  if (msg === lastToastMsg && now - lastToastAt < 900) return;
  lastToastMsg = msg; lastToastAt = now;
  const el = $('toast'); el.textContent = msg; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}
const SVGNS = 'http://www.w3.org/2000/svg';
const _p = new T.Vector3(), _q = new T.Vector3(), _cd = new T.Vector3(), UPV = new T.Vector3(0, 1, 0);
function makeTag(err){
  const dot = document.createElement('span'); dot.className = 'xdot' + (err ? ' err' : '');
  const box = document.createElement('div'); box.className = 'xl' + (err ? ' err' : '');
  box.innerHTML = '<b></b><small></small>';
  const ln = document.createElementNS(SVGNS, 'line'); if (err) ln.setAttribute('class', 'err');
  $('xsvg').appendChild(ln); $('xlayer').appendChild(dot); $('xlayer').appendChild(box);
  return { dot, box, ln, b: box.querySelector('b'), sm: box.querySelector('small') };
}
function dropTag(t){ t.dot.remove(); t.box.remove(); t.ln.remove(); }
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
  let bx = clamp(tx + ax*bw, m, Math.max(m, r.width - bw - m));
  let by = clamp(ty + ay*bh, loY, hiY);
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
        const x = clamp(x0, m, hiX), y = clamp(y0, loY, hiY);
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
  t.ln.setAttribute('x2', clamp(sx, bx, bx + bw)); t.ln.setAttribute('y2', clamp(sy, by, by + bh));
  const op = facing > -0.08 ? '1' : '0.15';
  t.dot.style.opacity = op; t.box.style.opacity = op; t.ln.style.opacity = op;
}
/* ---------- overlay layout: keep every floating control clear of the others ---------- */
const OVL = { busy: false, queued: false };
const OV_ITEMS = [
  { sel: '.actions', corner: 'tl' },
  { sel: '.legend', corner: 'tr', optional: true },
  { sel: '.views', corner: 'tr' },
  { sel: '.quick', corner: 'bl' },
  { sel: '.flat', corner: 'br', flat: true }
];
function rectsHit(a, b, g){ return a.x < b.x + b.w + g && b.x < a.x + a.w + g && a.y < b.y + b.h + g && b.y < a.y + a.h + g; }
// Candidate arrangements, best first. Moving the other controls always beats shrinking the flat view.
const OV_PLANS = [
  { '.legend': 'tr', '.views': 'tr', '.quick': 'bl', '.flat': 'br', legend: true },
  { '.legend': 'tr', '.views': 'tl', '.quick': 'bl', '.flat': 'br', legend: true },
  { '.legend': 'tl', '.views': 'tl', '.quick': 'bl', '.flat': 'br', legend: true },
  { '.legend': 'tr', '.views': 'tl', '.quick': 'bl', '.flat': 'br', legend: false },
  { '.views': 'tl', '.quick': 'tl', '.flat': 'br', legend: false },
  { '.views': 'tl', '.quick': 'bl', '.flat': 'tr', legend: false },
  { '.views': 'tl', '.quick': 'tl', '.flat': 'tr', legend: false },
  { '.views': 'bl', '.quick': 'bl', '.flat': 'tr', legend: false }
];
function layoutOverlays(){
  if (OVL.busy) return;
  const W = wrap.clientWidth, H = wrap.clientHeight;
  if (W < 2 || H < 2) return;
  OVL.busy = true;
  const pad = W < 520 ? 8 : 12, gap = 8;
  const items = OV_ITEMS.map(o => Object.assign({ el: wrap.querySelector(o.sel) }, o)).filter(o => o.el);
  const flat = items.find(o => o.flat), cv = $('flatCv');
  const tries = [];
  for (const scale of flat ? [1, 0.85, 0.72, 0.62] : [1]) for (const nq of [false, true]) for (const plan of OV_PLANS) tries.push({ plan, scale, nq });
  if (flat) tries.push({ plan: OV_PLANS[4], scale: 0.62, min: true });
  let result = null, lastScale = -1;
  // maximized: the flat view takes the full height on the right; everything else lays out around it
  if (flatMax && flat && flatOpen && !flat.el.classList.contains('docked')){
    flat.el.classList.remove('ov-min', 'ov-hide');
    cv.style.width = '260px'; cv.style.height = '280px';
    const extra = flat.el.offsetHeight - cv.offsetHeight;
    let ch = Math.max(140, H - 2*pad - extra), cw = ch*260/280;
    if (cw > W*0.58){ cw = W*0.58; ch = cw*280/260; }        // the model keeps at least ~40% of the width
    cv.style.width = Math.round(cw) + 'px'; cv.style.height = Math.round(ch) + 'px';
    if (cv._maxW !== Math.round(cw)){ cv._maxW = Math.round(cw); flatKey = ''; }
    const fw = flat.el.offsetWidth, fh = flat.el.offsetHeight, fx = W - pad - fw;
    const placed = [{ x: fx, y: pad, w: fw, h: fh }];
    result = [{ it: flat, r: placed[0] }];
    for (const it of items){
      if (it === flat) continue;
      const el = it.el; el.classList.remove('ov-hide');
      if (getComputedStyle(el).display === 'none') continue;
      el.style.maxWidth = Math.max(120, fx - pad - gap) + 'px';
      const w = el.offsetWidth, h = el.offsetHeight, left = it.corner[1] === 'l', topSide = it.corner[0] === 't';
      let x = left ? pad : Math.max(pad, fx - gap - w), y = topSide ? pad : H - pad - h;
      for (let k = 0; k < 12; k++){
        const hit = placed.find(r => rectsHit({ x, y, w, h }, r, gap));
        if (!hit) break;
        y = topSide ? hit.y + hit.h + gap : hit.y - h - gap;
      }
      const r = { x, y, w, h }; placed.push(r); result.push({ it, r });
    }
  }
  for (const t of (result ? [] : tries)){
    if (flat && t.scale !== lastScale){
      cv.style.width = Math.round(260*t.scale) + 'px'; cv.style.height = Math.round(280*t.scale) + 'px';
      lastScale = t.scale;
    }
    if (flat) flat.el.classList.toggle('ov-min', !!t.min);
    const placed = [], out = [];
    let fits = true;
    for (const it of items){
      const el = it.el, hideLegend = it.optional && !t.plan.legend;
      el.classList.toggle('ov-hide', !!hideLegend);
      if (hideLegend || getComputedStyle(el).display === 'none') continue;
      el.style.maxWidth = (it.sel === '.quick' && t.nq ? Math.min(330, W - 2*pad) : W - 2*pad) + 'px';
      const w = el.offsetWidth, h = el.offsetHeight;
      const corner = t.plan[it.sel] || it.corner;
      const left = corner[1] === 'l', topSide = corner[0] === 't';
      let x = left ? pad : W - pad - w, y = topSide ? pad : H - pad - h;
      for (let k = 0; k < 12; k++){
        const hit = placed.find(r => rectsHit({ x, y, w, h }, r, gap));
        if (!hit) break;
        y = topSide ? hit.y + hit.h + gap : hit.y - h - gap;
      }
      if (y < pad - 0.5 || y + h > H - pad + 0.5 || placed.some(r => rectsHit({ x, y, w, h }, r, gap))) fits = false;
      const r = { x, y, w, h };
      placed.push(r); out.push({ it, r });
    }
    result = out;
    if (fits) break;
  }
  for (const { it, r } of result){
    const st = it.el.style, left = r.x + r.w/2 < W/2, topSide = r.y + r.h/2 < H/2;
    st.left = Math.round(r.x) + 'px'; st.top = Math.round(r.y) + 'px'; st.right = 'auto'; st.bottom = 'auto';
    it.el.classList.add('ov');
    it.el.classList.toggle('ov-left', left); it.el.classList.toggle('ov-right', !left);
    it.el.classList.toggle('ov-top', topSide); it.el.classList.toggle('ov-bottom', !topSide);
    it.r = r; it.topSide = topSide;
  }
  OVL.rects = result.filter(o => !o.it.el.classList.contains('ov-hide')).map(o => o.r);
  const tops = result.filter(o => o.it.topSide).map(o => o.r), bots = result.filter(o => !o.it.topSide).map(o => o.r);
  const coach = wrap.querySelector('.coach'), toastEl = $('toast');
  const cw = Math.min(420, W - 32), cx = (W - cw)/2;
  const under = tops.filter(r => r.x < cx + cw && cx < r.x + r.w).reduce((m, r) => Math.max(m, r.y + r.h), pad);
  coach.style.top = Math.round(under + gap) + 'px';
  const tw = Math.min(W*0.7, toastEl.offsetWidth || 260), tx = (W - tw)/2;
  const above = bots.filter(r => r.x < tx + tw && tx < r.x + r.w).reduce((m, r) => Math.min(m, r.y), H - pad);
  toastEl.style.bottom = Math.round(H - above + gap) + 'px';
  OVL.busy = false;
}
/* On a phone the flat view would cover the model, and shrinking it far enough to fit
   makes the scales unreadable — so below 700px it moves out into its own dock under
   the 3D view at full size. Out of #view it drops out of OV_ITEMS on its own. */
function placeFlat(){
  const el = $('flat'), dock = $('flatDock');
  const home = window.matchMedia('(max-width:700px)').matches ? dock : wrap;
  if (el.parentElement === home) return;
  home.appendChild(el);
  const docked = home === dock;
  el.classList.toggle('docked', docked);
  if (docked){
    el.classList.remove('ov', 'ov-min', 'ov-hide', 'ov-left', 'ov-right', 'ov-top', 'ov-bottom');
    el.style.left = el.style.top = el.style.maxWidth = '';
    const cv = $('flatCv'); cv.style.width = cv.style.height = '';
  }
  flatKey = '';
}

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
  flipLayout(() => { OVL.queued = false; placeFlat(); layoutOverlays(); }); queueLayout();
}
function queueLayout(){
  if (OVL.queued) return;
  OVL.queued = true;
  // a timer backs up the frame callback, which never fires while the page is not being painted
  const run = () => { if (!OVL.queued) return; OVL.queued = false; placeFlat(); layoutOverlays(); };
  requestAnimationFrame(run); setTimeout(run, 80);
}

/* ---------- resizable reading panel ---------- */
const RH = { normal: 132, practice: 380 };
function applyRH(){
  const main = document.querySelector('main');
  const max = Math.max(120, main.clientHeight - 220);
  const k = state.practice ? 'practice' : 'normal';
  RH[k] = Math.max(96, Math.min(max, RH[k]));
  $('reading').style.setProperty('--rh', RH[k] + 'px');
  $('split').setAttribute('aria-valuenow', String(Math.round(RH[k])));
  $('split').setAttribute('aria-valuemin', '96');
  $('split').setAttribute('aria-valuemax', String(Math.round(max)));
}
function bindSplit(){
  const sp = $('split');
  let dragging = null;
  sp.addEventListener('pointerdown', e => {
    dragging = { y: e.clientY, h: RH[state.practice ? 'practice' : 'normal'] };
    sp.setPointerCapture(e.pointerId); sp.classList.add('drag'); document.body.classList.add('resizing');
    e.preventDefault();
  });
  sp.addEventListener('pointermove', e => {
    if (!dragging) return;
    RH[state.practice ? 'practice' : 'normal'] = dragging.h - (e.clientY - dragging.y);
    applyRH();
  });
  const end = e => { if (!dragging) return; dragging = null; sp.classList.remove('drag'); document.body.classList.remove('resizing'); try { sp.releasePointerCapture(e.pointerId); } catch (err) {} };
  sp.addEventListener('pointerup', e => { if (dragging && state.practice) rhPracticeSet = true; end(e); }); sp.addEventListener('pointercancel', end);
  sp.addEventListener('dblclick', () => { RH[state.practice ? 'practice' : 'normal'] = state.practice ? 380 : 132; applyRH(); });
  sp.addEventListener('keydown', e => {
    const k = state.practice ? 'practice' : 'normal';
    if (e.key === 'ArrowUp'){ RH[k] += e.shiftKey ? 64 : 16; applyRH(); e.preventDefault(); e.stopPropagation(); }
    else if (e.key === 'ArrowDown'){ RH[k] -= e.shiftKey ? 64 : 16; applyRH(); e.preventDefault(); e.stopPropagation(); }
  });
  window.addEventListener('resize', applyRH);
}

/* ================================================================== reading math */
const HLC = { inch: cssVar('--hl-inch'), tenth: cssVar('--hl-tenth'), dial: cssVar('--hl-dial'), bezel: cssVar('--hl-bezel'), sub: cssVar('--hl-sub'), vern: cssVar('--hl-vern') };
const isVern = () => state.inst === 'vern';
const TOOL = {
  od:    { name: 'Outside jaws', c: '#ff8a3d' },
  id:    { name: 'Inside jaws',  c: '#a78bfa' },
  depth: { name: 'Depth rod',    c: '#2dd4bf' }
};
// the vernier has no bezel: its zero is engraved, so the offset only exists on the dial caliper
function bezelOffset() { if (isVern()) return 0; const b = state.bezel / TAU * 0.1; return b - 0.1 * Math.round(b / 0.1); }
const indicated = () => state.pos + bezelOffset();
// split a reading in thousandths into what the scales show.
// dial: inch + tenth + dial.  vernier: inch + tenth + sub (0.025″ lines past the tenth) + vern.
// the vernier caliper reads metric when millimeters are picked: the top scale and the top plate
const metric = () => isVern() && units === 'mm';
// metric reading to the vernier's 0.05 mm: centimeter number, millimeter lines past it, vernier line
function splitMM() {
  const q = Math.round(state.pos * 25.4 / 0.05 + 1e-6);
  return { q, cm: Math.floor(q / 200), mm: Math.floor(q / 20) % 10, vern: q % 20, whole: Math.floor(q / 20), total: q * 0.05 };
}
function split(n) {
  n = Math.max(0, n);
  const rem = n % 100;
  return { inch: Math.floor(n / 1000), tenth: Math.floor(n / 100) % 10, rem, dial: rem, sub: Math.floor(rem / 25), vern: rem % 25 };
}
const stepKeys = () => metric() ? ['inch', 'tenth', 'vern'] : isVern() ? ['inch', 'tenth', 'sub', 'vern'] : ['inch', 'tenth', 'dial'];
const f3 = v => (v < 0 ? '−' : '') + Math.abs(v).toFixed(3);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ================================================================== 3D highlights */
function hlMat(c) {
  return new T.MeshBasicMaterial({ color: new T.Color(c), toneMapped: false, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -8 });
}
function outlineGeo(w, h, t) {
  const s = new T.Shape([new T.Vector2(-w / 2, -h / 2), new T.Vector2(w / 2, -h / 2), new T.Vector2(w / 2, h / 2), new T.Vector2(-w / 2, h / 2)]);
  s.holes.push(new T.Path([new T.Vector2(-w / 2 + t, -h / 2 + t), new T.Vector2(-w / 2 + t, h / 2 - t), new T.Vector2(w / 2 - t, h / 2 - t), new T.Vector2(w / 2 - t, -h / 2 + t)]));
  return new T.ShapeGeometry(s);
}
const HL3 = {
  inchBox: new T.Mesh(outlineGeo(0.12, 0.17, 0.014), hlMat(HLC.inch)),
  tenthTick: new T.Mesh(new T.PlaneGeometry(0.02, 0.2), hlMat(HLC.tenth)),
  tenthBox: new T.Mesh(outlineGeo(0.085, 0.13, 0.011), hlMat(HLC.tenth)),
  dialTick: new T.Mesh(new T.PlaneGeometry(0.016, 0.13), hlMat(HLC.dial)),
  dialDot: new T.Mesh(new T.CircleGeometry(0.03, 24), hlMat(HLC.dial))
};
Object.values(HL3).forEach(m => { m.renderOrder = 5; m.visible = false; });
beamDial.add(HL3.inchBox, HL3.tenthTick, HL3.tenthBox);
bezel.add(HL3.dialTick, HL3.dialDot);
// vernier highlights: beam-side marks live on the beam, the aligned vernier line rides the slider
const HLV = {
  inchBox: new T.Mesh(outlineGeo(0.11, 0.125, 0.012), hlMat(HLC.inch)),
  tenthTick: new T.Mesh(new T.PlaneGeometry(0.014, 1), hlMat(HLC.tenth)),
  tenthBox: new T.Mesh(outlineGeo(0.07, 0.08, 0.01), hlMat(HLC.tenth)),
  subTick: new T.Mesh(new T.PlaneGeometry(0.014, 1), hlMat(HLC.sub)),
  // drawn over the inch plate's bevel and face, so it follows the line right down to the edge
  vernTick: new T.Mesh(drapeGeo(-0.007, 0.007, [[VEDGE - 0.08, VPZ + 0.002], [VEDGE - VB, VPZ + 0.002], [VEDGE, BT + 0.008]]), hlMat(HLC.vern)),
  vernBeam: new T.Mesh(new T.PlaneGeometry(0.014, 0.05), hlMat(HLC.vern))
};
Object.values(HLV).forEach(m => { m.renderOrder = 5; m.visible = false; });
beamVern.add(HLV.inchBox, HLV.tenthTick, HLV.tenthBox, HLV.subTick, HLV.vernBeam);
// the same highlights for the metric side: centimeter number, last millimeter line, the metric
// vernier line that lines up (drawn over the top plate's bevel), and the beam line it meets
const HLM = {
  cmBox: new T.Mesh(outlineGeo(0.1, 0.1, 0.012), hlMat(HLC.inch)),
  mmTick: new T.Mesh(new T.PlaneGeometry(0.014, 1), hlMat(HLC.tenth)),
  vernTick: new T.Mesh(drapeGeo(-0.007, 0.007, [[MEDGE, BT + 0.008], [MEDGE + VB, VPZ + 0.002], [MEDGE + 0.065, VPZ + 0.002]]), hlMat(HLC.vern)),
  vernBeam: new T.Mesh(new T.PlaneGeometry(0.014, 0.05), hlMat(HLC.vern))
};
Object.values(HLM).forEach(m => { m.renderOrder = 5; m.visible = false; });
beamVern.add(HLM.cmBox, HLM.mmTick, HLM.vernBeam);
sliderVern.add(HLM.vernTick);
function updateMetricHighlights(show) {
  const hl = state.hl, z = BT + 0.003, M = splitMM();
  Object.values(HLV).forEach(m => { m.visible = false; });
  HLM.cmBox.visible = show && hl.inch;
  HLM.cmBox.position.set(VZ0 + M.cm * 10 * MM, 0.08, z);
  HLM.mmTick.visible = show && hl.tenth;
  const bot = mLineBot(M.whole), hh = MEDGE - bot;
  HLM.mmTick.scale.y = hh; HLM.mmTick.position.set(VZ0 + M.whole * MM, bot + hh / 2, z);
  HLM.vernTick.visible = HLM.vernBeam.visible = show && hl.vern;
  HLM.vernTick.position.set(VZ0 + M.vern * MDIV, 0, 0);
  // vernier line k sits on beam line (whole mm + 2k)
  HLM.vernBeam.position.set(VZ0 + (M.whole + 2 * M.vern) * MM, MEDGE - 0.025, z);
}
sliderVern.add(HLV.vernTick);
// a tick from the vernier edge up to the top of beam line i
function beamTick(m, i, x) {
  const top = vLineTop(i), h = top - VEDGE;
  m.scale.y = h; m.position.set(x, VEDGE + h / 2, BT + 0.003);
}
function updateVernHighlights(A, show) {
  if (metric()) { updateMetricHighlights(show); return; }
  Object.values(HLM).forEach(m => { m.visible = false; });
  const hl = state.hl, z = BT + 0.003, xi = VZ0 + A.inch, xt = xi + A.tenth / 10;
  HLV.inchBox.visible = show && hl.inch;
  HLV.inchBox.position.set(xi, -0.03, z);
  HLV.tenthTick.visible = show && hl.tenth;
  beamTick(HLV.tenthTick, A.inch * 40 + A.tenth * 4, xt);
  HLV.tenthBox.visible = show && hl.tenth && A.tenth > 0;
  HLV.tenthBox.position.set(xt, -0.088, z);
  HLV.subTick.visible = show && hl.sub && A.sub > 0;
  beamTick(HLV.subTick, A.inch * 40 + A.tenth * 4 + A.sub, xt + A.sub * VDIV);
  // the vernier line that lines up, plus the beam line it meets
  HLV.vernTick.visible = HLV.vernBeam.visible = show && hl.vern;
  HLV.vernTick.position.set(VZ0 + A.vern * VSTEP, 0, 0);
  const j = A.inch * 40 + A.tenth * 4 + A.sub + A.vern;
  HLV.vernBeam.position.set(VZ0 + j * VDIV, VEDGE + 0.025, z);
}

let hlKey = '';
function updateHighlights() {
  const n = Math.round(indicated() * 1000), A = split(n), hl = state.hl, show = showAns();
  const k = [state.inst, units, n, isVern() ? splitMM().q : 0, Math.round(state.bezel * 1e4), show, hl.inch, hl.tenth, hl.dial, hl.sub, hl.vern].join('|');
  if (k === hlKey) return; hlKey = k;
  if (isVern()) { updateVernHighlights(A, show); return; }
  Object.values(HLM).forEach(m => { m.visible = false; });
  const z = BT + 0.003;
  HL3.inchBox.visible = show && hl.inch;
  HL3.inchBox.position.set(A.inch - 0.05, -0.2, z);
  const tx = A.inch + A.tenth / 10;
  HL3.tenthTick.visible = show && hl.tenth;
  HL3.tenthTick.position.set(tx, -0.197, z);
  HL3.tenthBox.visible = show && hl.tenth && A.tenth > 0;
  HL3.tenthBox.position.set(tx - 0.042, -0.2, z);
  // dial marks are drawn clockwise from 0 on the face, which turns with the bezel
  const a = A.dial / 100 * TAU;
  HL3.dialTick.visible = HL3.dialDot.visible = show && hl.dial;
  HL3.dialTick.position.set(0.59 * Math.sin(a), 0.59 * Math.cos(a), 0.4635);
  HL3.dialTick.rotation.z = -a;
  HL3.dialDot.position.set(0.37 * Math.sin(a), 0.37 * Math.cos(a), 0.4635);
  HL3.dialDot.visible = false;
}

/* ================================================================== parts */
let sample = { type: 'none', tool: null, size: 0, obj: null };
const rnd = (a, b) => Math.round((a + Math.random() * (b - a)) * 1000) / 1000;
const hullMats = {};
function hullMat(tool) {
  return hullMats[tool] || (hullMats[tool] = new T.ShaderMaterial({
    uniforms: { c: { value: new T.Color(TOOL[tool].c) }, w: { value: 0.016 } },
    vertexShader: 'uniform float w;\n#include <clipping_planes_pars_vertex>\nvoid main(){ vec3 p = position + normalize(normal)*w; vec4 mvPosition = modelViewMatrix*vec4(p,1.0); gl_Position = projectionMatrix*mvPosition;\n#include <clipping_planes_vertex>\n}',
    fragmentShader: 'uniform vec3 c;\n#include <clipping_planes_pars_fragment>\nvoid main(){\n#include <clipping_planes_fragment>\ngl_FragColor = vec4(c,1.0); }',
    side: T.BackSide, clipping: true, clippingPlanes: secPlanes()
  }));
}
function buildSample(type) {
  if (sample.obj) { cal.remove(sample.obj); sample.obj.traverse(o => o.geometry && o.geometry.dispose()); }
  sample = { type, tool: null, size: 0, obj: null };
  const def = PARTS[type];
  if (!def) { refreshPartCard(); return; }
  const size = rnd(...def.range);
  const { obj, ext } = def.build(size);
  // a part made of several pieces is merged into one solid (one mesh, one finish)
  {
    const solids = []; obj.updateMatrixWorld(true);
    obj.traverse(o => { if (o.isMesh && !o.material.transparent) solids.push(o); });
    if (solids.length > 1){
      const geos = solids.map(o => { const g = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()).applyMatrix4(o.matrixWorld);
        Object.keys(g.attributes).forEach(k => { if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k); });
        if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count*2), 2));
        return g; });
      const mat = solids[0].material;
      solids.forEach(o => o.parent.remove(o));
      obj.add(mesh(mergeGeometries(geos), mat));
    }
  }
  if (def.tool === 'od') obj.position.set(size / 2, clamp(-0.37 - ext / 2, -1.9, -0.95), 0);
  if (def.tool === 'id') obj.position.set(ID_FACE + size / 2, 0.58, 0.045);
  if (def.tool === 'depth') obj.position.set(XR, ROD_Y, ROD_Z);
  const hm = hullMat(def.tool), hulls = [];
  const caps = [];
  obj.traverse(o => {
    if (!o.isMesh) return;
    o.castShadow = o.receiveShadow = true; o.userData.role = 'part';
    o.material = o.material.clone(); o.userData.side = o.material.side;
    const flat = o.geometry.type === 'PlaneGeometry' || o.geometry.type === 'ShapeGeometry' || o.material.transparent;
    if (!flat) caps.push(o);
    let g = o.geometry.clone();
    g.deleteAttribute('normal'); if (g.attributes.uv) g.deleteAttribute('uv');
    g = mergeVertices(g, 1e-4); g.computeVertexNormals();
    hulls.push([o, new T.Mesh(g, hm)]);
  });
  hulls.forEach(([o, h]) => { h.raycast = () => {}; h.userData.hull = true; o.add(h); });
  caps.forEach(o => { const c = new T.Mesh(o.geometry, capMat); c.raycast = () => {}; c.userData.cap = true; c.castShadow = false; o.add(c); });
  cal.add(obj);
  sample = { type, tool: def.tool, size, obj };
  state.revealed = false;
  updateOutline();
  refreshPartCard();
  applyCut();
}

/* ---------- section view: a plane cuts the part (never the caliper) so the jaws or rod inside show ---------- */
const CUT_PLANE = new T.Plane(new T.Vector3(0, 0, -1), 0);
const secPlanes = () => state.cut ? [CUT_PLANE] : [];
const SEC_LABEL = { '+z': 'the front', '-z': 'the back', '+x': 'the right', '-x': 'the left', '+y': 'the top', '-y': 'the bottom' };
// the cut face: back faces seen through the cut, drawn flat with section hatching
const capMat = new T.MeshBasicMaterial({ color: 0xc7ccd2, side: T.BackSide, clippingPlanes: [CUT_PLANE], toneMapped: false });
capMat.onBeforeCompile = sh => {
  sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP;')
    .replace('#include <project_vertex>', '#include <project_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
  sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP;')
    .replace('vec4 diffuseColor = vec4( diffuse, opacity );',
      'float hatch = step(0.62, fract((vWP.x + vWP.y + vWP.z) * 14.0));\nvec4 diffuseColor = vec4( mix(diffuse, diffuse * 0.45, hatch), opacity );');
};
/* ---------- section view: the piece being cut away disintegrates instead of vanishing ----------
   The nanite front from the visualizer. A front sweeps through the removed piece from its outer face in to
   the cut, erasing it a grain at a time; switching the section off runs the same front back out and the
   piece builds up again. While it runs the part's own clip plane is off and this shader does the cutting;
   once it lands, the ordinary clip plane takes over, so the finished section is exactly what it always was. */
const SecFx = (() => {
  const MS = 850, BAND = 0.10, JITTER = 0.055, CELLS = 26;
  const U = {
    uSdOn: { value: 0 }, uSdT: { value: 0 }, uSdC: { value: 0 }, uSdMax: { value: 1 }, uSdCell: { value: 1 },
    uSdN: { value: new T.Vector3(0, 0, 1) }, uSdU: { value: new T.Vector3(1, 0, 0) }, uSdV: { value: new T.Vector3(0, 1, 0) },
    uSdBand: { value: BAND }, uSdJit: { value: JITTER }
  };
  const FRAG = [
    'uniform float uSdOn, uSdT, uSdC, uSdMax, uSdCell, uSdBand, uSdJit;',
    'uniform vec3 uSdN, uSdU, uSdV;',
    'varying vec3 vSdWP;',
    'float sdHash(vec2 q){ q = fract(q*vec2(123.34, 456.21)); q += dot(q, q + 45.32); return fract(q.x*q.y); }',
    'void sdCut(){',
    '  if (uSdOn < 0.5) return;',
    '  float d = dot(uSdN, vSdWP) + uSdC;                   // the section keeps d >= 0',
    '  if (d >= 0.0) return;',
    '  float t = clamp(-d/max(uSdMax, 1e-4), 0.0, 1.0);     // 0 at the cut, 1 at the far outside face',
    '  float rnd = sdHash(floor(vec2(dot(vSdWP, uSdU), dot(vSdWP, uSdV))*uSdCell));',
    '  float front = mix(1.0 + uSdBand, -uSdBand, uSdT);    // travels in from the outside face to the cut',
    '  if (t - front + (rnd - 0.5)*uSdJit > 0.0) discard;',
    '}'
  ].join('\n');
  const grafted = new WeakSet();
  function attach(mat){
    if (!mat || grafted.has(mat)) return;
    grafted.add(mat);
    const prev = mat.onBeforeCompile, base = prev ? prev.toString() : '';
    mat.onBeforeCompile = (sh, r) => {
      if (prev) prev.call(mat, sh, r);
      Object.assign(sh.uniforms, U);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vSdWP;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvSdWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + FRAG)
        .replace('#include <clipping_planes_fragment>', 'sdCut();\n#include <clipping_planes_fragment>');
    };
    mat.customProgramCacheKey = () => base + '|secfx';
    mat.needsUpdate = true;
  }
  // point the front at the current cut and measure how deep the removed piece goes
  const _box = new T.Box3(), _p = new T.Vector3(), _up = new T.Vector3();
  function aim(root){
    const n = CUT_PLANE.normal, c = CUT_PLANE.constant;
    U.uSdN.value.copy(n); U.uSdC.value = c;
    _box.setFromObject(root);
    let far = 1e-3;
    for (let i = 0; i < 8; i++){
      _p.set(i & 1 ? _box.max.x : _box.min.x, i & 2 ? _box.max.y : _box.min.y, i & 4 ? _box.max.z : _box.min.z);
      far = Math.max(far, -(n.dot(_p) + c));
    }
    U.uSdMax.value = far;
    if (Math.abs(n.y) < 0.9) _up.set(0, 1, 0); else _up.set(1, 0, 0);
    U.uSdU.value.crossVectors(n, _up).normalize(); U.uSdV.value.crossVectors(n, U.uSdU.value).normalize();
    const s = _box.getSize(_p); U.uSdCell.value = CELLS/Math.max(s.x, s.y, s.z, 1e-3);
  }
  const ease = t => t*t*(3 - 2*t);
  let job = null;
  function end(j){ if (job !== j) return; job = null; U.uSdOn.value = 0; j.done(); }
  function tick(){
    if (!job) return;
    const j = job, raw = Math.min(1, (performance.now() - j.t0)/MS), root = j.root();
    if (root) aim(root);
    U.uSdT.value = j.erase ? ease(raw) : 1 - ease(raw);
    j.redraw();
    if (raw >= 1 || !root){ end(j); return; }
    requestAnimationFrame(tick);
  }
  /* erase: true when a section is switched on, false when it is switched off. Reversing one mid-way
     picks up from where the front is, so a quick double toggle never jumps. */
  function start(erase, o){
    const root = o.root();
    if (!root || matchMedia('(prefers-reduced-motion: reduce)').matches){ job = null; U.uSdOn.value = 0; return false; }
    let raw0 = 0;
    if (job && job.erase !== erase) raw0 = 1 - Math.min(1, (performance.now() - job.t0)/MS);
    const j = job = Object.assign({ erase, t0: performance.now() - raw0*MS }, o);
    aim(root); U.uSdOn.value = 1; U.uSdT.value = erase ? ease(raw0) : 1 - ease(raw0);
    requestAnimationFrame(tick);
    // a timer backs up the frame callbacks, which stop while the page is not being painted
    setTimeout(() => end(j), (1 - raw0)*MS + 250);
    return true;
  }
  return { attach, start, running: () => job ? (job.erase ? 'erase' : 'build') : null };
})();
let cutShown = false, pendingCut = null;   // pendingCut: the side to cut from once a rebuild lands
const _secBox = new T.Box3(), _secM = new T.Matrix4();
function updateSection(){
  if (!state.cut || !sample.obj) return;
  // the part's extent along the cut axis, in caliper space
  _secM.copy(cal.matrixWorld).invert();
  _secBox.makeEmpty();
  sample.obj.traverse(o => { if (o.isMesh && !o.userData.cap && !o.userData.hull){ o.geometry.computeBoundingBox(); const b = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld).applyMatrix4(_secM); _secBox.union(b); } });
  const k = state.secAxis[1], sign = state.secAxis[0] === '+' ? 1 : -1;
  const hi = sign > 0 ? _secBox.max[k] : -_secBox.min[k], lo = sign > 0 ? _secBox.min[k] : -_secBox.max[k];
  const c = hi - state.secT*(hi - lo);
  const nLocal = new T.Vector3(); nLocal[k] = -sign;               // keeps the material on the far side of the cut
  const pLocal = new T.Vector3(); pLocal[k] = c*sign;
  CUT_PLANE.setFromNormalAndCoplanarPoint(nLocal, pLocal).applyMatrix4(cal.matrixWorld);
}
function applyCut(){
  const planes = secPlanes();
  // switching the section on or off plays the disintegrate / rebuild; while it runs the shader does the cutting
  if (state.cut !== cutShown){
    cutShown = state.cut;
    if (state.cut) pendingCut = null;   // switched on some other way: a queued side switch no longer applies
    if (sample.obj){ state.cut && updateSection(); sample.obj.traverse(o => { if (o.isMesh && !o.userData.hull && !o.userData.cap) SecFx.attach(o.material); }); }
    SecFx.start(state.cut, { root: () => sample.obj, redraw: () => {}, done: () => { applyCut(); if (pendingCut) runPendingCut(); } });
  }
  const fx = SecFx.running(), cutLook = state.cut || fx === 'build';
  if (sample.obj) sample.obj.traverse(o => {
    if (!o.isMesh || o.userData.hull) return;
    if (o.userData.cap){ o.visible = cutLook; return; }
    SecFx.attach(o.material);
    o.material.clippingPlanes = fx ? [] : planes;
    // a double-sided surface would show its own inside through the cut instead of the hatched face
    o.material.side = cutLook ? T.FrontSide : o.userData.side;
    o.material.needsUpdate = true;
  });
  Object.values(hullMats).forEach(m => { m.clippingPlanes = planes; m.needsUpdate = true; });
  updateSection();
}
// Front / Side buttons: start the section from that side; pressing the lit one switches the section off.
// Switching sides while a section is up rebuilds the removed piece first and then cuts from the new side.
function pickCut(axis){
  if (pendingCut){
    // mid-switch: pick again to retarget, or press the side it is heading to again to stay off
    pendingCut = pendingCut === axis ? null : axis; applyCut();
    return;
  }
  if (state.cut && state.secAxis === axis){ state.cut = false; applyCut(); applyCut(); return; }
  if (state.cut){
    pendingCut = axis; state.cut = false; applyCut(); applyCut();
    if (!SecFx.running()) runPendingCut();   // nothing animated (reduced motion, or no part): switch straight away
    return;
  }
  cutFrom(axis);
}
function cutFrom(axis){
  setCutFace(axis);
  state.secT = 0.5; applyCut();
}
function runPendingCut(){
  const axis = pendingCut; pendingCut = null;
  if (axis && !state.cut) cutFrom(axis);
}
function setCutFace(axis){
  state.secAxis = axis;
  if (!state.cut){ state.cut = true; applyCut(); }
  state.secT = Math.max(state.secT, 0.2);
  applyCut();
  toast(`Section from ${SEC_LABEL[axis]}`);
}

function updateOutline() {
  if (!sample.obj) return;
  sample.obj.traverse(o => { if (o.userData.hull) o.visible = state.hl.outline && showAns(); });
}
function refreshPartCard() {
  const box = $('feats'), def = PARTS[sample.type];
  $('revealBtn').disabled = $('newVals').disabled = !def;
  $('revealBtn').textContent = state.revealed ? 'Hide actual' : 'Show actual';
  if (!def) { box.innerHTML = '<p class="note" style="margin:8px 0 0">No part on the caliper. Choose one above.</p>'; return; }
  const t = TOOL[def.tool];
  box.innerHTML = `<div class="pcard" style="--c:${t.c}"><div class="pcard-h"><b>${esc(def.label)}</b><span>${t.name}</span></div>
    <p>${esc(def.hint)} Measure the ${esc(def.what)}.</p>
    ${state.revealed ? `<div class="fres">Actual ${sample.size.toFixed(3)}″</div>` : ''}</div>`;
}

/* ================================================================== mechanism */
function limits() {
  let lo = 0, hi = TRAVEL;
  if (sample.staged) return [lo, hi];   // the part is not on the caliper yet
  if (sample.tool === 'od') lo = sample.size;
  if (sample.tool === 'id' || sample.tool === 'depth') hi = sample.size;
  return [lo, hi];
}
function inContact() {
  if (sample.staged) return false;
  const [lo, hi] = limits();
  if (sample.tool === 'od') return state.pos <= lo + 1e-7;
  if (sample.tool) return state.pos >= hi - 1e-7;
  return false;
}
const flashLocked = () => toast('The slider is locked. Click the screw on top of the slider to free it.');
function setPos(v, force) {
  if (state.sliderLocked && !force) { flashLocked(); return false; }
  const [lo, hi] = limits();
  const nv = clamp(v, lo, hi);
  const hit = Math.abs(nv - v) > 1e-9;
  state.pos = Math.round(nv * 1e6) / 1e6;
  return !hit;
}
function goTo(v, speed) {
  if (state.sliderLocked) { flashLocked(); return; }
  state.animQ = [{ to: v, speed: speed || 5 }];
}

/* ---------- fine adjustment ----------
   In fine mode the range input spans only a small window around the current
   reading, so the same drag travel moves the jaws a fraction as far. Every
   other control (3D drag, thumb wheel, bezel, arrow keys) is scaled to match. */
let fineWin = [0, TRAVEL];
const sliderUnit = () => state.fine ? 10000 : 1000;   // range value = inches × unit
function applySliderRange() {
  const s = $('slider'), u = sliderUnit();
  if (state.fine) {
    const half = FINE.window, lo = clamp(state.pos - half, 0, Math.max(0, TRAVEL - 2 * half));
    fineWin = [lo, Math.min(TRAVEL, lo + 2 * half)];
  } else fineWin = [0, TRAVEL];
  s.min = Math.round(fineWin[0] * u);
  s.max = Math.round(fineWin[1] * u);
  s.value = Math.round(clamp(state.pos, fineWin[0], fineWin[1]) * u);
  $('fineWin').textContent = state.fine
    ? `Slider spans ${f3(fineWin[0])}″ – ${f3(fineWin[1])}″ · re-centers when you let go.`
    : '';
}
/* ---------- instrument: dial caliper or vernier caliper ----------
   Both share the beam, jaws, slider body, depth rod, lock screw and thumb wheel.
   Only the scales and the reading hardware (dial/bezel vs vernier plate) swap. */
const INST = {
  dial: { name: 'Dial', full: 'dial caliper', flat: 'Beam &amp; dial, flat view', flatAria: 'Beam scale at the slider edge and the dial face',
    view: ['Dial view', 'Close-up of the dial and needle.'] },
  vern: { name: 'Vernier', full: 'vernier caliper', flat: 'Beam &amp; vernier, flat view', flatAria: 'Beam scale and vernier scale, with a magnified view of the line that lines up',
    view: ['Vernier view', 'Close-up of the inch vernier plate and the beam lines above it.'] }
};
function setInst(inst, quiet) {
  if (!INST[inst]) inst = 'dial';
  const I = INST[inst], changed = state.inst !== inst;
  state.inst = inst;
  syncHlCards();                     // the highlight cards name inch or metric marks
  syncGoHint();
  const v = inst === 'vern';
  document.body.classList.toggle('vern', v);
  beamDial.visible = sliderDial.visible = !v;
  beamVern.visible = sliderVern.visible = v;
  document.querySelectorAll('[data-inst-pick]').forEach(b => { const on = b.dataset.instPick === inst; b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; });
  $('logoTop').textContent = I.name;
  $('logoMark').setAttribute('aria-label', I.full[0].toUpperCase() + I.full.slice(1));
  document.title = `${I.name} Caliper Trainer`;
  $('flatTitle').innerHTML = I.flat;
  $('flatCv').setAttribute('aria-label', I.flatAria);
  const fv = $('fineViewBtn'); fv.setAttribute('aria-label', I.view[0]); fv.dataset.tip = I.view.join('\n');
  state.pErr = []; state.pRevealed = false;
  lastKey = ''; hlKey = ''; flatKey = '';
  if (changed && state.exam) { examTags.forEach(dropTag); examTags = []; setExam(true); }
  if (changed && state.practice) loadPractice();
  queueLayout();
  if (changed && !quiet) toast(`Switched to the ${I.full}`);
}
function setFine(v) {
  state.fine = v;
  [['fineBtn', 'Fine adjust'], ['fineQuick', 'Fine adjust']].forEach(([id]) => {
    const el = $(id); if (el) el.setAttribute('aria-pressed', String(v));
  });
  const em = $('fineBtn').querySelector('em'); if (em) em.textContent = v ? 'on' : 'off';
  $('fineQuick').setAttribute('aria-label', v ? 'Fine adjust on' : 'Fine adjust');
  applySliderRange();
  toast(v ? 'Fine adjust on — every control moves the needle ~10× slower' : 'Fine adjust off');
}

/* ---------- units: inches by default, millimeters on request ---------- */
let units = 'in';
try { units = localStorage.getItem('pt-units') === 'mm' ? 'mm' : 'in'; } catch (e) {}
const MM_STEPS = [-1,-0.1,-0.02,1,0.1,0.02];
// the highlight cards name the marks of whichever scale is being read
const HL_TEXT = {
  inch: [['Inch number', 'Last whole inch the slider edge has passed'], ['Centimeter number', 'Last centimeter number the vernier zero has passed']],
  tenth: [null, ['Millimeter line', 'Last millimeter line left of the vernier zero']],
  vern: [['Vernier line', 'The vernier line that meets a beam line, in thousandths'], ['Vernier line', 'The top-plate line that meets a beam line, in 0.05 mm']]
};
function syncHlCards() {
  const met = metric();
  const gs = document.getElementById('guess'); if (gs) gs.placeholder = met ? '0.00 mm' : '0.000';
  for (const [key, pair] of Object.entries(HL_TEXT)) {
    const card = document.querySelector(`input[data-hl="${key}"]`).closest('.hlcard'), t = pair[met ? 1 : 0];
    const b = card.querySelector('b'), smalls = card.querySelectorAll('small');
    if (b.dataset.orig == null) { b.dataset.orig = b.textContent; smalls.forEach(s => { s.dataset.orig = s.textContent; }); }
    b.textContent = t ? t[0] : b.dataset.orig;
    smalls.forEach(s => { s.textContent = t ? t[1] : s.dataset.orig; });
  }
  const sub = document.querySelector('input[data-hl="sub"]').closest('.hlcard');
  sub.style.display = met ? 'none' : '';
}
function setUnits(u){
  units = u;
  try { localStorage.setItem('pt-units', u); } catch (e) {}
  document.querySelectorAll('[data-units]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.units === u)));
  document.querySelectorAll('[data-step]').forEach((b, i) => {
    if (b.dataset.stepIn == null){ b.dataset.stepIn = b.dataset.step; b.dataset.labIn = b.textContent; }
    const mm = MM_STEPS[i];
    if (u === 'mm' && mm != null){ b.dataset.step = String(mm/25.4); b.textContent = (mm < 0 ? '−' : '+') + Math.abs(mm) + ' mm'; }
    else { b.dataset.step = b.dataset.stepIn; b.textContent = b.dataset.labIn; }
  });
  const st = $('setTo');
  syncGoHint();
}
// a unit typed with the number wins: in, inch, inches, ″ or " read as inches; mm, millimeter(s) as mm
const unitOf = s => { const t = String(s).trim(); return /(mm|millimet(er|re)s?)\.?$/i.test(t) ? 'mm' : /(["″]|in(ch(es)?)?\.?)$/i.test(t) ? 'in' : null; };
const numOf = s => parseFloat(String(s).replace(',', '.').replace(/[^0-9.\-]+/g, ' ').trim());
const inputInches = s => { const n = numOf(s), u = unitOf(s) || units; return u === 'mm' ? n/25.4 : n; };
// the Go to hint says which unit a plain number is read as. The dial caliper's scales are inch only,
// so it takes inches whatever the units buttons say, and says so
function syncGoHint(){
  const st = document.getElementById('setTo'); if (!st) return;
  const inchOnly = !isVern();
  st.placeholder = inchOnly ? 'Inches only: 1.234' : units === 'mm' ? 'Go to 31.34 mm' : 'Go to 1.234 in';
  st.title = inchOnly ? 'The dial caliper reads in inches only' : 'Add in or mm to pick the unit';
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
function autoMeasure() {
  const def = PARTS[sample.type];
  if (!def) { toast('Choose a part first'); return; }
  if (state.sliderLocked) setSliderLock(false);
  const s = sample.size;
  state.animQ = def.tool === 'od'
    ? [{ to: Math.max(state.pos, s + 0.25), speed: 6 }, { to: s, speed: 2.5 }]
    : [{ to: Math.min(state.pos, Math.max(0, s - 0.25)), speed: 6 }, { to: s, speed: 2.5 }];
}
function stepAnim(dt) {
  if (sample.staged) {
    if (partClear()) unstagePart();
    else if (!state.animQ.length && !state.sliderLocked) state.animQ = [{ to: clearTarget(), speed: 8 }];
  }
  const a = state.animQ[0];
  if (!a) return;
  const diff = a.to - state.pos;
  // the floor tracks the speed so a slow move stays slow all the way in
  const step = Math.sign(diff) * Math.min(Math.abs(diff), Math.max(0.006 * a.speed, Math.abs(diff) * a.speed) * dt);
  const free = setPos(state.pos + step, true);
  if (Math.abs(a.to - state.pos) < 1e-6 || !free) state.animQ.shift();
}
function setSliderLock(v) {
  state.sliderLocked = v; knobAnim.top = v ? -Math.PI * 1.5 : 0;
  paintLock(lockMeshes(lockTopKnob), v);
  if (v) state.animQ = [];
  $('lockBtn').setAttribute('aria-pressed', String(v));
  $('lockBtn').textContent = v ? 'Unlock slider' : 'Lock slider';
  const lq = $('lockQuick');
  lq.setAttribute('aria-pressed', String(v));
  lq.setAttribute('aria-label', v ? 'Unlock slider' : 'Lock slider');
  lq.dataset.tip = v ? 'Unlock slider\nLoosens the lock screw so the slider can move.' : 'Lock slider\nTightens the lock screw so the slider can’t move.';
  lastKey = '';
}
function setBezelLock(v) {
  state.bezelLocked = v; knobAnim.bot = v ? -Math.PI * 1.5 : 0;
  paintLock(lockMeshes(lockBotKnob), v);
  $('bezelLockBtn').setAttribute('aria-pressed', String(v));
  $('bezelLockBtn').textContent = v ? 'Unlock bezel' : 'Lock bezel';
  $('bezelRange').disabled = v;
  lastKey = '';
}
function setBezelThou(t) {
  if (state.bezelLocked) { toast('The bezel is locked. Click the screw under the dial to free it.'); return; }
  state.bezel = t / 100 * TAU;
}
const knobAnim = { top: 0, bot: 0 };

/* ================================================================== reading bar */
let lastKey = '';
function updateUI() {
  const I = indicated(), n = Math.round(I * 1000), A = split(n), b = bezelOffset(), contact = inContact();
  const k = [state.inst, units, n, state.pos.toFixed(4), Math.round(b * 1e4), state.sliderLocked, state.bezelLocked, contact, state.practice, state.fine, sample.type, sample.size].join('|');
  if (k === lastKey) return; lastKey = k;
  $('lcd').textContent = f3(n / 1000);
  $('lcdmm').textContent = (n / 1000 * 25.4).toFixed(2) + ' mm';
  $('vA').textContent = A.inch.toFixed(3); $('hA').textContent = `number “${A.inch}”`;
  $('vB').textContent = (A.tenth / 10).toFixed(3); $('hB').textContent = `${A.tenth} line${A.tenth === 1 ? '' : 's'} × 0.100″`;
  $('vC').textContent = (A.dial / 1000).toFixed(3); $('hC').textContent = `mark ${A.dial} × 0.001″`;
  // the vernier row has two more cells, so its hints are kept short enough not to truncate
  if (isVern()) $('hB').textContent = `${A.tenth} × 0.100″`;
  $('vS').textContent = (A.sub * 25 / 1000).toFixed(3); $('hS').textContent = `${A.sub} × 0.025″`;
  $('vV').textContent = (A.vern / 1000).toFixed(3); $('hV').textContent = `line ${A.vern}`;
  $('vT').textContent = f3(n / 1000);
  // metric on the vernier: centimeters + millimeter lines + vernier line, all in mm
  const met = metric(), cellOf = id => $(id).closest('.cell');
  cellOf('vA').querySelector('.k').textContent = met ? 'Centimeters' : 'Inches';
  cellOf('vB').querySelector('.k').textContent = met ? 'Millimeters' : 'Tenths';
  cellOf('vS').style.display = cellOf('vS').previousElementSibling.style.display = met ? 'none' : '';
  cellOf('vT').querySelector('.h').textContent = met ? 'millimeters' : 'inches';
  document.querySelector('#reading .answer .unit').textContent = met ? 'mm' : 'in';
  if (met) {
    const M = splitMM();
    $('lcd').textContent = M.total.toFixed(2); $('lcdmm').textContent = f3(n / 1000) + ' in';
    $('vA').textContent = (M.cm * 10).toFixed(2); $('hA').textContent = `number “${M.cm}”`;
    $('vB').textContent = M.mm.toFixed(2); $('hB').textContent = `${M.mm} × 1 mm`;
    $('vV').textContent = (M.vern * 0.05).toFixed(2); $('hV').textContent = `line ${M.vern}`;
    $('vT').textContent = M.total.toFixed(2);
  }
  const bz = Math.round(b * 1000);
  $('bezelCell').hidden = bz === 0;
  $('vD').textContent = (bz > 0 ? '+' : '−') + Math.abs(bz / 1000).toFixed(3);
  $('gap').textContent = state.pos.toFixed(3) + '″';
  $('bezelVal').textContent = (bz > 0 ? '+' : bz < 0 ? '−' : '') + Math.abs(bz / 1000).toFixed(3) + '″';
  const sEl = $('slider');
  if (document.activeElement !== sEl) {
    if (state.fine && (state.pos < fineWin[0] || state.pos > fineWin[1])) applySliderRange();
    else sEl.value = Math.round(state.pos * sliderUnit());
  }
  if (document.activeElement !== $('bezelRange')) $('bezelRange').value = bz;

  const def = PARTS[sample.type], fc = $('featCell');
  let fk = 'Measuring', fv = 'No part', fh = 'choose one in the sidebar', col = '';
  if (def) {
    col = TOOL[def.tool].c; fk = TOOL[def.tool].name;
    fv = `${def.label} ${def.what}`;
    fh = contact ? (def.tool === 'depth' ? 'rod on the bottom' : 'jaws touching') : (def.tool === 'od' ? 'close the jaws' : def.tool === 'id' ? 'open the jaws' : 'extend the rod');
  }
  if (col) fc.style.setProperty('--c', col); else fc.style.removeProperty('--c');
  $('fK').textContent = fk; $('fV').textContent = fv; $('fH').textContent = fh;

  let msg = 'Slider free', cls = '';
  if (contact) { msg = def.tool === 'depth' ? 'Depth rod on the bottom' : 'Jaws on the part'; cls = 'ok'; }
  else if (state.pos < 5e-4 && !def && isVern()) { msg = 'Jaws closed, vernier on zero'; cls = 'ok'; }
  else if (state.pos < 5e-4 && !def) { msg = bz ? `Closed, but the dial reads ${A.dial} — zero the bezel` : 'Jaws closed, dial on zero'; cls = bz ? 'warn' : 'ok'; }
  else if (def) msg = `Part on the caliper — ${fh}`;
  if (state.sliderLocked) { msg += ' · locked'; cls = cls || 'warn'; }
  if (state.fine) msg += ' · fine adjust';
  $('status').textContent = msg; $('status').className = 'status ' + cls;
  $('pullBtn').disabled = $('autoBtn').disabled = !def;
}

/* ================================================================== camera views */
let controls, camTween = null;
function showAns() { return !state.practice || state.pRevealed; }
function viewFor(name) {
  // portrait screens need extra distance so the whole caliper, jaws to depth rod, stays in frame
  const a = Math.max(0.3, camera.aspect), far = Math.max(1, 1.55 / a) * (a < 1 ? 1 + 0.6 * (1 - a) : 1), p = state.pos;
  if (name === 'front') return { target: CENTER.clone(), dir: new T.Vector3(0, 0, 1), dist: 15 * far };
  if (isVern() && (name === 'scale' || name === 'dial')) {
    // 'dial' is the fine-reading close-up: on the vernier that is the inch plate and the beam lines above it
    const close = name === 'dial', span = close ? 1.45 : 1.9;
    // when the flat view floats over the right of the 3D view, aim a little right so the vernier sits clear of it
    const dist = Math.max(close ? 2.1 : 2.6, span / (0.536 * a));
    const floating = flatOpen && !$('flat').classList.contains('docked');
    const shift = close && floating ? 0.14 * dist * a * 0.536 : 0;
    return { target: new T.Vector3(p + VZ0 + (close ? 0.32 : -0.1) + shift, close ? -0.18 : 0, BT), dir: new T.Vector3(0, 0.04, 1), dist };
  }
  if (name === 'scale') return { target: new T.Vector3(p - 0.1, -0.15, 0), dir: new T.Vector3(0, 0.12, 1), dist: 3.2 };
  if (name === 'dial') return { target: new T.Vector3(p + 0.95, 0.22, 0.45), dir: new T.Vector3(0, 0.05, 1), dist: 3.4 };
  if (name === 'jaws') {
    if (sample.tool === 'od') return { target: new T.Vector3(p / 2, -1.2, 0), dir: new T.Vector3(-0.2, 0.25, 1), dist: 4.5 + p };
    if (sample.tool === 'id') return { target: new T.Vector3(-0.5 + p / 2, 0.65, 0), dir: new T.Vector3(-0.25, 0.9, 1), dist: 3.4 + p };
    if (sample.tool === 'depth') return { target: new T.Vector3(XR + p / 2, 0.16, 0), dir: new T.Vector3(0.5, 0.55, 1), dist: 4.5 + p };
    return { target: new T.Vector3(p / 2 - 0.2, -0.6, 0), dir: new T.Vector3(-0.2, 0.25, 1), dist: 5.5 };
  }
  return { target: CENTER.clone(), dir: new T.Vector3(-0.3, 0.32, 1), dist: 14.5 * far };
}
// "Show me": a tight close-up on the exact mark, looking at it square-on
function showMe(k) {
  const an = errAnchor(k); if (!an) return;
  const dir = an.n.clone().multiplyScalar(0.5).add(new T.Vector3(0, 0.1, 1).normalize().multiplyScalar(0.5)).normalize();
  const toPos = an.p.clone().add(dir.multiplyScalar(1.7));
  camTween = { t: 0, fromPos: camera.position.clone(), fromTarget: controls.target.clone(), toPos, toTarget: an.p.clone() };
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
    b.getSize(s); if (Math.max(s.x, s.y, s.z) > 25) return;          // the table or floor under everything
    box.union(b);
  });
  return box;
}
// open screen areas to frame the model in: the band under the top buttons, and the column
// between the top-left and top-right buttons (which can run the full height of the view)
function freeRects(W, H){
  const rs = labelObstacles(), out = [];
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
  const c = canvas; let best = null;
  for (const free of freeRects(c.clientWidth, c.clientHeight)){
    const f = fitIsoIn(dir, target, dist, box, free);
    const score = camera.isOrthographicCamera ? f.zoom : 1/Math.max(1e-6, f.pos.distanceTo(f.target));
    if (!best || score > best.score) best = Object.assign(f, { score });
  }
  return best;
}
function fitIsoIn(dir, target, dist, box, free){
  const cam = camera.clone(), cv = canvas, W = cv.clientWidth, H = cv.clientHeight;
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
function setView(name, instant) {
  const v = viewFor(name);
  let toPos = v.target.clone().add(v.dir.clone().normalize().multiplyScalar(v.dist));
  if (name === 'iso' || name === 'front'){ const f = fitIso(v.dir.clone().normalize(), v.target, v.dist, fitBox(cal)); toPos = f.pos; v.target = f.target; }
  if (instant || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    camera.position.copy(toPos); controls.target.copy(v.target); controls.update(); camTween = null; return;
  }
  camTween = { t: 0, fromPos: camera.position.clone(), fromTarget: controls.target.clone(), toPos, toTarget: v.target };
}
function stepCam(dt) {
  if (!camTween) return;
  const c = camTween; c.t = Math.min(1, c.t + dt / 0.6);
  const e = c.t < 0.5 ? 2 * c.t * c.t : 1 - Math.pow(-2 * c.t + 2, 2) / 2;
  controls.target.lerpVectors(c.fromTarget, c.toTarget, e);
  camera.position.lerpVectors(c.fromPos, c.toPos, e);
  if (c.t >= 1) camTween = null;
}

/* ================================================================== examination labels */
const V3 = (x, y, z) => new T.Vector3(x, y, z);
const N3 = (x, y, z) => new T.Vector3(x, y, z).normalize();
const EXAM = [
  ['Beam', 'Hardened stainless bar', () => ({ p: V3(6.6, 0.28, BT), n: N3(0.2, 1, 0.6) })],
  ['Main scale', 'Numbers are inches, lines are 0.100″', () => ({ p: V3(Math.max(0.3, state.pos - 0.45), -0.2, BT), n: N3(-0.3, -1, 0.7) })],
  ['Reading edge', 'Read the beam at this edge', () => ({ p: V3(state.pos, -0.12, 0.18), n: N3(0.2, -1, 0.6) })],
  ['Fixed outside jaw', 'Stationary measuring face', () => ({ p: V3(-0.3, -1.3, BT), n: N3(-1, -0.2, 0.6) })],
  ['Moving outside jaw', 'Travels with the slider', () => ({ p: V3(state.pos + 0.3, -1.5, BT), n: N3(1, -0.4, 0.6) })],
  ['Inside jaws', 'Measure bores and slot widths', () => ({ p: V3(-0.45, 0.78, 0.05), n: N3(-0.6, 1, 0.4) })],
  ['Dial', '0.001″ per mark · 0.100″ per turn', () => ({ p: V3(state.pos + 1.4, 0.55, 0.47), n: N3(1, 0.8, 0.8) })],
  ['Bezel', 'Turn it to zero the dial', () => ({ p: V3(state.pos + 0.4, 0.78, 0.45), n: N3(-0.6, 1, 0.5) })],
  ['Slider lock screw', 'Holds the slider in place', () => ({ p: V3(state.pos + 1.45, 0.66, 0), n: N3(0.3, 1, 0.2) })],
  ['Bezel lock screw', 'Holds the dial face in place', () => ({ p: V3(state.pos + 1.2, -0.86, 0.27), n: N3(0, -1, 0.4) })],
  ['Thumb wheel', 'Roll it for fine moves', () => ({ p: V3(state.pos + 2.74, -0.44, 0.33), n: N3(1, -0.4, 0.6) })],
  ['Rack', 'Turns the pinion that drives the needle', () => ({ p: V3(Math.min(7.9, state.pos + 2.9), 0.16, 0.05), n: N3(0.2, 1, 0.7) })],
  ['Depth rod', 'Slides out of the beam end', () => ({ p: V3(XR + Math.max(0.05, state.pos) * 0.6, 0.19, -0.045), n: N3(0.6, 1, -0.2) })]
];
const EXAM_V = [
  ['Beam', 'Hardened stainless bar', () => ({ p: V3(6.9, 0.29, BT), n: N3(0.2, 1, 0.6) })],
  ['Main scale', 'Inches along the bottom edge: digits are 0.100″, lines are 0.025″', () => ({ p: V3(Math.max(0.3, state.pos - 0.3), -0.1, BT), n: N3(-0.3, -1, 0.7) })],
  ['Vernier scale', '25 lines, 0.001″ each', () => ({ p: V3(state.pos + VZ0 + 0.45, -0.33, VPZ), n: N3(0.3, -1, 0.7) })],
  ['Vernier zero', 'Read the beam at this line', () => ({ p: V3(state.pos + VZ0, VEDGE - 0.03, VPZ), n: N3(-0.5, -1, 0.6) })],
  ['Metric scale', 'Millimeters along the top edge', () => ({ p: V3(Math.max(0.3, state.pos - 0.4), 0.12, BT), n: N3(-0.3, 1, 0.7) })],
  ['Metric vernier', '20 lines, 0.05 mm each', () => ({ p: V3(state.pos + VZ0 + 0.9, 0.285, VPZ), n: N3(0.3, 1, 0.7) })],
  ['Fixed outside jaw', 'Stationary measuring face', () => ({ p: V3(-0.3, -1.3, BT), n: N3(-1, -0.2, 0.6) })],
  ['Moving outside jaw', 'Travels with the slider', () => ({ p: V3(state.pos + 0.3, -1.5, BT), n: N3(1, -0.4, 0.6) })],
  ['Inside jaws', 'Measure bores and slot widths', () => ({ p: V3(-0.45, 0.78, 0.05), n: N3(-0.6, 1, 0.4) })],
  ['Slider lock screw', 'Holds the slider in place', () => ({ p: V3(state.pos + 1.45, 0.66, 0), n: N3(0.3, 1, 0.2) })],
  ['Thumb wheel', 'Roll it for fine moves', () => ({ p: V3(state.pos + 2.74, -0.44, 0.33), n: N3(1, -0.4, 0.6) })],
  ['Depth rod', 'Slides out of the beam end', () => ({ p: V3(XR + Math.max(0.05, state.pos) * 0.6, 0.19, -0.045), n: N3(0.6, 1, -0.2) })]
];
const examList = () => isVern() ? EXAM_V : EXAM;
let examTags = [], examLabels = true, errTags = {};
function setExam(on) {
  state.exam = on;
  document.body.classList.toggle('exam', on);
  if (on) {
    if (state.practice) setPractice(false);
    closeTut();
    examTags = examList().map(([title, sub]) => { const t = makeTag(false); t.b.textContent = title; t.sm.textContent = sub; return t; });
    setSpin(true); setLabels(true);
  } else {
    examTags.forEach(dropTag); examTags = [];
    setSpin(false);
  }
  setTimeout(() => { resize(); setView('iso'); }, 60);
}
function setSpin(on) { controls.autoRotate = on; controls.autoRotateSpeed = 0.8; $('spinBtn').setAttribute('aria-pressed', String(on)); }
function setLabels(on) { examLabels = on; $('labelsBtn').setAttribute('aria-pressed', String(on)); examTags.forEach(t => { t.dot.hidden = t.box.hidden = !on; t.ln.style.display = on ? '' : 'none'; }); }

// practice mistakes: tags pointing at the marks that were misread
const ERR_INFO = { inch: ['Inch number', HLC.inch], tenth: ['Tenth line', HLC.tenth], dial: ['Dial mark', HLC.dial], sub: ['0.025″ lines', HLC.sub], vern: ['Vernier line', HLC.vern] };
function dialMarkWorld(mark, r) {
  const a = mark / 100 * TAU, lx = r * Math.sin(a), ly = r * Math.cos(a), c = Math.cos(state.bezel), s = Math.sin(state.bezel);
  return V3(state.pos + 0.95 + lx * c - ly * s, 0.22 + lx * s + ly * c, 0.47);
}
function errAnchor(k) {
  const A = split(Math.round(indicated() * 1000));
  if (metric()) {
    const M = splitMM();
    if (k === 'inch') return { p: V3(VZ0 + M.cm * 10 * MM, 0.12, BT), n: N3(-0.4, 1, 0.8), label: `“${M.cm}” is the last centimeter number passed` };
    if (k === 'tenth') return { p: V3(VZ0 + M.whole * MM, 0.17, BT), n: N3(-0.2, 1, 0.8), label: `${plural(M.mm, 'millimeter line')} past “${M.cm}”` };
    return { p: V3(state.pos + VZ0 + M.vern * MDIV, MEDGE + 0.07, VPZ), n: N3(0.2, 1, 0.8), label: `Line ${M.vern} lines up` };
  }
  if (isVern()) {
    const xt = VZ0 + A.inch + A.tenth / 10;
    if (k === 'inch') return { p: V3(VZ0 + A.inch, 0.02, BT), n: N3(-0.4, 1, 0.8), label: `“${A.inch}” is the last inch number passed` };
    if (k === 'tenth') return { p: V3(xt, -0.06, BT), n: N3(-0.2, 1, 0.8), label: `${A.tenth} digit${A.tenth === 1 ? '' : 's'} past “${A.inch}”` };
    if (k === 'sub') return { p: V3(xt + A.sub * VDIV, -0.16, BT), n: N3(0.2, 1, 0.8), label: `${A.sub} small line${A.sub === 1 ? '' : 's'} past the digit` };
    return { p: V3(state.pos + VZ0 + A.vern * VSTEP, VEDGE - 0.07, VPZ), n: N3(0.2, -1, 0.8), label: `Line ${A.vern} lines up` };
  }
  if (k === 'inch') return { p: V3(A.inch - 0.05, -0.2, BT), n: N3(-0.4, -1, 0.8), label: `“${A.inch}” is the last inch number passed` };
  if (k === 'tenth') return { p: V3(A.inch + A.tenth / 10, -0.28, BT), n: N3(0.1, -1, 0.8), label: `${A.tenth} line${A.tenth === 1 ? '' : 's'} past “${A.inch}”` };
  const p = dialMarkWorld(A.dial, 0.6);
  return { p, n: V3(p.x - state.pos - 0.95, p.y - 0.22, 0.9).normalize(), label: `Needle on mark ${A.dial}` };
}
const ERR_INFO_MM = { inch: ['Centimeter number', HLC.inch], tenth: ['Millimeter lines', HLC.tenth], vern: ['Vernier line', HLC.vern] };
let errUnits = '';
function syncErr() {
  const want = state.practice && !state.exam ? state.pErr : [];
  // switching units re-labels the tags, so start them over
  const u = metric() ? 'mm' : 'in';
  if (u !== errUnits) { errUnits = u; for (const k of Object.keys(errTags)) { dropTag(errTags[k]); delete errTags[k]; } }
  for (const k of Object.keys(errTags)) if (!want.includes(k)) { dropTag(errTags[k]); delete errTags[k]; }
  for (const k of want) if (!errTags[k]) {
    const [name, col] = (metric() ? ERR_INFO_MM : ERR_INFO)[k], t = makeTag(true);
    t.b.textContent = name;
    t.box.style.setProperty('--c', col); t.dot.style.setProperty('--c', col); t.ln.style.stroke = col;
    errTags[k] = t;
  }
}
// what the labels must stay off: the black bars in examination, otherwise the floating controls
function labelObstacles(){
  if (document.body.classList.contains('exam')){
    const W = wrap.clientWidth, H = wrap.clientHeight;
    const t = document.querySelector('.cine.top').offsetHeight, b = document.querySelector('.cine.bot').offsetHeight;
    return [{ x: 0, y: 0, w: W, h: t, fixed: true }, { x: 0, y: H - b, w: W, h: b, fixed: true }];
  }
  return (OVL.rects || []).map(q => Object.assign({ fixed: true }, q));
}
function updateOverlays() {
  syncErr();
  const tight = wrap.clientWidth < 560;   // shorter leaders so labels stay clear of the edges
  const placed = labelObstacles();
  if (state.exam && examLabels) examList().forEach((e, i) => { const an = e[2](); placeTag(examTags[i], an.p, an.n, tight ? 44 : 70, placed); });
  for (const k of Object.keys(errTags)) { const an = errAnchor(k); errTags[k].sm.textContent = an.label; placeTag(errTags[k], an.p, an.n, tight ? 56 : 90, placed); }
}

/* ================================================================== flat view: beam at the slider edge + dial face */
let flatOpen = true, flatKey = '';
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
function drawFlat() {
  if (!flatOpen) return;
  const n = Math.round(indicated() * 1000), A = split(n), show = showAns(), hl = state.hl, pos = state.pos;
  const key = [state.inst, units, n, pos.toFixed(4), Math.round(state.bezel * 1e4), show, hl.inch, hl.tenth, hl.dial, hl.sub, hl.vern, state.pErr.join('')].join('|');
  if (key === flatKey) return; flatKey = key;
  const cv = $('flatCv'), g = cv.getContext('2d'), W = 260, H = 280, dpr = Math.min(4, (window.devicePixelRatio || 1)*Math.max(1, ($('flatCv').clientWidth || 260)/260));
  if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const txt = (s, x, y, size, col, align) => { g.font = `600 ${size}px Inter, Arial, sans-serif`; g.fillStyle = col; g.textAlign = align || 'center'; g.textBaseline = 'middle'; g.fillText(s, x, y); };
  const seg = (x0, y0, x1, y1, w, col) => { g.strokeStyle = col; g.lineWidth = w; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); };
  g.fillStyle = '#0b0c0e'; g.fillRect(0, 0, W, H);
  if (metric()) { drawFlatVernMM(g, W, H, splitMM(), show, txt, seg); return; }
  if (isVern()) { drawFlatVern(g, W, H, A, show, txt, seg); return; }

  // ---- beam strip
  const bt = 8, bh = 96, k = 360, ex = 170, X = x => ex + (x - pos) * k, base = bt + bh - 10;
  let gr = g.createLinearGradient(0, bt, 0, bt + bh);
  gr.addColorStop(0, '#c9cdd2'); gr.addColorStop(1, '#e3e6e9');
  g.fillStyle = gr; g.fillRect(0, bt, W, bh);
  for (let i = Math.max(0, Math.floor((pos - 0.5) * 10)); i <= Math.min(63, Math.ceil((pos + 0.3) * 10)); i++) {
    const x = X(i / 10), major = i % 10 === 0;
    const isT = show && hl.tenth && i === A.inch * 10 + A.tenth;
    seg(x, base, x, base - (major ? 78 : 46), isT ? 3 : major ? 2.2 : 1.6, isT ? HLC.tenth : '#111');
    const s = major ? String(i / 10) : String(i % 10), ty = base - 60, size = major ? 20 : 14;
    const isI = show && hl.inch && major && i / 10 === A.inch;
    if (isI) { g.strokeStyle = HLC.inch; g.lineWidth = 2.5; g.strokeRect(x - 26, ty - 14, 22, 28); }
    if (isT && !major) { g.strokeStyle = HLC.tenth; g.lineWidth = 2; g.strokeRect(x - 20, ty - 11, 16, 22); }
    txt(s, x - 15, ty, size, '#111');
  }
  seg(0, base - 46, W, base - 46, 1, 'rgba(0,0,0,.5)');
  // slider covers everything right of the reading edge
  gr = g.createLinearGradient(0, bt, 0, bt + bh);
  gr.addColorStop(0, '#8e949b'); gr.addColorStop(1, '#a9aeb4');
  g.fillStyle = gr; g.fillRect(ex, bt, W - ex, bh);
  g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(ex, bt, 2, bh);
  let hintBox = null;
  if (show && hl.inch && A.inch < pos - 0.47) {
    hintBox = cornerText(g, `← “${A.inch}” is ${(pos - A.inch).toFixed(1)}″ left`, 6, bt + 12, { size: 11, col: '#6b5300', region: { x: 0, y: bt, w: W, h: bh - 16 } });
  }
  g.fillStyle = 'rgba(0,0,0,.6)'; g.font = '600 9.5px Inter, Arial, sans-serif'; g.textAlign = 'left';
  g.fillText('Beam', 6, bt + bh - 5); g.fillText('Slider', ex + 6, bt + bh - 5);

  // ---- dial
  // sized to leave a clear margin all round, where the callouts go so they never cover the face
  const cx = 130, cy = 194, R = 68;
  g.fillStyle = '#fbfbf9'; g.beginPath(); g.arc(cx, cy, R, 0, TAU); g.fill();
  g.strokeStyle = '#9aa0a8'; g.lineWidth = 5; g.beginPath(); g.arc(cx, cy, R + 3, 0, TAU); g.stroke();
  const faceRot = -state.bezel; // canvas y is down, so a CCW bezel turn is a negative canvas angle
  const at = (m, r) => { const a = m / 100 * TAU + faceRot; return [cx + r * Math.sin(a), cy - r * Math.cos(a)]; };
  for (let i = 0; i < 100; i++) {
    const L = i % 10 === 0 ? 12 : i % 5 === 0 ? 9 : 6, isD = show && hl.dial && i === A.dial;
    const [x0, y0] = at(i, R - 2), [x1, y1] = at(i, R - 2 - (isD ? 16 : L));
    seg(x0, y0, x1, y1, isD ? 3 : i % 10 === 0 ? 1.8 : 1, isD ? HLC.dial : '#111');
  }
  for (let v = 0; v < 100; v += 10) { const [x, y] = at(v, R - 26); txt(String(v), x, y, 11, '#111'); }
  // needle angle comes from the true slider position; the face turns with the bezel
  const nAng = ((state.pos / 0.1) % 1) * TAU;
  g.strokeStyle = '#0c0c0d'; g.lineWidth = 2.6; g.lineCap = 'round';
  g.beginPath(); g.moveTo(cx - (R - 50) * Math.sin(nAng), cy + (R - 50) * Math.cos(nAng)); g.lineTo(cx + (R - 8) * Math.sin(nAng), cy - (R - 8) * Math.cos(nAng)); g.stroke();
  g.lineCap = 'butt';
  g.fillStyle = '#0c0c0d'; g.beginPath(); g.arc(cx, cy, 5, 0, TAU); g.fill();
  g.fillStyle = 'rgba(255,255,255,.55)'; g.font = '600 9.5px Inter, Arial, sans-serif'; g.textAlign = 'left';
  g.fillText('Dial', 6, bt + bh + 16);

  // arrows at the marks that were misread
  // the printed BEAM / SLIDER / DIAL words count as taken, so no callout covers them
  const placed = [{ x: 4, y: bt + bh - 14, w: 34, h: 12 }, { x: ex + 4, y: bt + bh - 14, w: 44, h: 12 }, { x: 4, y: bt + bh + 9, w: 28, h: 12 }];
  if (hintBox) placed.push(hintBox);
  const arrow = (tx, ty, dx, dy, col, lab, region) => flatArrow(g, W, H, tx, ty, dx, dy, col, lab, placed, region);
  // the tenth line always sits just left of the slider edge, so its callout goes on the gray slider
  const onSlider = { x: ex + 6, y: bt + 4, w: W - ex - 10, h: bh - 22 };
  for (const kk of ['tenth', 'inch', 'dial'].filter(q => state.pErr.includes(q))) {
    if (kk === 'inch') arrow(clamp(X(A.inch) - 15, 14, ex - 10), base - 74, 0.2, -0.98, HLC.inch, 'Inch ' + A.inch);
    else if (kk === 'tenth') arrow(X(A.inch + A.tenth / 10), base - 20, 1, 0, HLC.tenth, 'Tenth line', onSlider);
    else if (kk === 'dial') {
      // the arrow stops at the rim, pointing in at the mark, and its label sits outside the dial
      const [x, y] = at(A.dial, R + 6);
      flatArrow(g, W, H, x, y, (x - cx) / (R + 6), (y - cy) / (R + 6), HLC.dial, 'Mark ' + A.dial, placed, null, { x: cx, y: cy, r: R + 4 });
    }
  }
}

// arrow + label pointing at a mark in the flat view. Labels keep clear of each other and of the
// marks they point at: the preferred spot is tried first, then nearby spots inside the region.
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
function flatArrow(g, W, H, tx, ty, dx, dy, col, lab, placed, region, avoid) {
  const L = 28, h = 14, R = region || { x: 2, y: 2, w: W - 4, h: H - 4 };
  g.font = '700 10px Inter, Arial, sans-serif'; const w = g.measureText(lab).width + 8;
  const fit = (x, y) => ({ x: clamp(x, R.x, Math.max(R.x, R.x + R.w - w)), y: clamp(y, R.y, Math.max(R.y, R.y + R.h - h)) });
  const others = (placed || []).concat([{ x: tx - 4, y: ty - 4, w: 8, h: 8 }]);
  const inCircle = b => avoid && Math.hypot(clamp(avoid.x, b.x, b.x + w) - avoid.x, clamp(avoid.y, b.y, b.y + h) - avoid.y) < avoid.r + 2;
  const hits = b => inCircle(b) || others.some(q => b.x < q.x + q.w + 3 && q.x < b.x + w + 3 && b.y < q.y + q.h + 3 && q.y < b.y + h + 3);
  const sx = tx + dx * L, sy = ty + dy * L;
  let box = fit(sx - w / 2, sy + (dy < 0 ? -h - 2 : 2));
  if (avoid) {
    // walk round the ring outside the circle, nearest the mark first, until the label fits clear of everything
    const a0 = Math.atan2(ty - avoid.y, tx - avoid.x);
    search: for (const da of [0, 0.15, -0.15, 0.3, -0.3, 0.45, -0.45, 0.6, -0.6, 0.8, -0.8, 1, -1, 1.3, -1.3, 1.6, -1.6])
      for (const dr of [0, 6, 12]) {
        const a = a0 + da, ux = Math.cos(a), uy = Math.sin(a);
        const d = avoid.r + 4 + Math.abs(ux) * w / 2 + Math.abs(uy) * h / 2 + dr;
        const b = fit(avoid.x + ux * d - w / 2, avoid.y + uy * d - h / 2);
        if (!hits(b)) { box = b; break search; }
      }
  } else if (hits(box)) {
    let best = null;
    for (let r = 6; r <= 120 && !best; r += 6)
      for (const [ux, uy] of [[0, -1], [0, 1], [1, 0], [-1, 0], [1, -1], [-1, -1], [1, 1], [-1, 1]]) {
        const b = fit(box.x + ux * r, box.y + uy * r);
        if (!hits(b)) { best = b; break; }
      }
    if (best) box = best;
  }
  if (placed) placed.push({ x: box.x, y: box.y, w, h });
  // leader from the nearest point of the label to the mark
  const lx = clamp(tx, box.x, box.x + w), ly = clamp(ty, box.y, box.y + h), ang = Math.atan2(ty - ly, tx - lx);
  const ux = Math.cos(ang), uy = Math.sin(ang), long = Math.hypot(tx - lx, ty - ly) > 12;
  g.lineCap = 'round';
  if (long) for (const [lw, cc] of [[5, '#000'], [2.4, col]]) { g.strokeStyle = cc; g.lineWidth = lw; g.beginPath(); g.moveTo(lx, ly); g.lineTo(tx - ux * 7, ty - uy * 7); g.stroke(); }
  g.fillStyle = col; g.strokeStyle = '#000'; g.lineWidth = 1.5;
  g.beginPath(); g.moveTo(tx, ty); g.lineTo(tx - Math.cos(ang + 0.5) * 11, ty - Math.sin(ang + 0.5) * 11); g.lineTo(tx - Math.cos(ang - 0.5) * 11, ty - Math.sin(ang - 0.5) * 11); g.closePath(); g.fill(); g.stroke();
  g.fillStyle = '#000'; g.fillRect(box.x, box.y, w, h); g.strokeStyle = col; g.lineWidth = 1.2; g.strokeRect(box.x, box.y, w, h);
  g.font = '700 10px Inter, Arial, sans-serif'; g.fillStyle = col; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(lab, box.x + 4, box.y + 7.5);
  g.lineCap = 'butt';
}
// vernier flat view: the beam + vernier plate around the vernier zero, and a magnified loupe
// on the line that lines up (in practice it is only roughly centered, so it doesn't give the answer away)
// metric vernier flat view: the top plate above its reading edge and the beam's millimeters below,
// as on the caliper, and a loupe on the vernier line that meets a beam line
function drawFlatVernMM(g, W, H, M, show, txt, seg) {
  const hl = state.hl, P = state.pos * 25.4, jm = M.whole + 2 * M.vern;
  const top = 8, yE = 60, bot = 138, k = 5.4, ex = 22, Xm = m => ex + (m - P) * k;
  let gr = g.createLinearGradient(0, top, 0, yE);
  gr.addColorStop(0, '#9ea4ab'); gr.addColorStop(1, '#b3b8be');
  g.fillStyle = gr; g.fillRect(0, top, W, yE - top);
  gr = g.createLinearGradient(0, yE, 0, bot);
  gr.addColorStop(0, '#e3e6e9'); gr.addColorStop(1, '#c9cdd2');
  g.fillStyle = gr; g.fillRect(0, yE, W, bot - yE);
  g.fillStyle = 'rgba(0,0,0,.4)'; g.fillRect(0, yE - 1.5, W, 1.5);
  const LEN = m => m % 10 === 0 ? 42 : m % 5 === 0 ? 30 : 20;
  for (let m = Math.max(0, Math.floor(P - ex / k)); m <= Math.min(180, Math.ceil(P + (W - ex) / k)); m++) {
    const x = Xm(m), isT = show && hl.tenth && m === M.whole, isV = show && hl.vern && m === jm;
    seg(x, yE, x, yE + LEN(m), isT || isV ? 2.4 : m % 5 === 0 ? 1.3 : 1, isV ? HLC.vern : isT ? HLC.tenth : '#111');
    if (m % 10 === 0) {
      if (show && hl.inch && m / 10 === M.cm) { g.strokeStyle = HLC.inch; g.lineWidth = 2.5; g.strokeRect(x - 12, yE + 46, 24, 26); }
      txt(String(m / 10), x, yE + 59, 19, '#111');
    }
  }
  for (let q = 0; q <= 20; q++) {
    const x = ex + q * 1.95 * k, isV = show && hl.vern && q === M.vern;
    seg(x, yE, x, yE - (q % 2 === 0 ? 19 : 12), isV ? 2.6 : 1.1, isV ? HLC.vern : '#111');
    if (q % 2 === 0) txt(String(q / 2), x, yE - 30, 10, '#111');
  }
  // the aligned line gets its own tag when it has no number printed
  const vx = ex + M.vern * 1.95 * k, tagV = show && hl.vern && M.vern % 2 !== 0;
  if (tagV) {
    const s = (M.vern * 0.05).toFixed(2);
    g.font = '700 10px Inter, Arial, sans-serif'; const w = g.measureText(s).width + 8;
    g.fillStyle = HLC.vern; g.fillRect(vx - w / 2, yE - 51, w, 13);
    txt(s, vx, yE - 44.5, 10, '#fff');
    seg(vx, yE - 12, vx, yE - 38, 1.4, HLC.vern);
  }
  if (show && hl.inch && Xm(M.cm * 10) < -6) cornerText(g, `← “${M.cm}” is ${(P - M.cm * 10).toFixed(1)} mm left`, 6, bot - 9, { size: 11, col: '#6b5300', up: true, region: { x: 0, y: yE, w: W, h: bot - yE } });
  g.fillStyle = 'rgba(0,0,0,.55)'; g.font = '600 9.5px Inter, Arial, sans-serif'; g.textBaseline = 'alphabetic';
  const labRight = !tagV || vx < W / 2;
  g.textAlign = labRight ? 'right' : 'left';
  g.fillText('Vernier · 0.05 mm', labRight ? W - 6 : 6, top + 11);

  // ---- loupe
  const L0 = bot + 8, L1 = H - 6, lm = (L0 + L1) / 2, k2 = 40, cx = W / 2;
  const center = show ? M.vern : clamp(M.vern + ((M.q * 7) % 3) - 1, 0, 20);
  const vC = P + center * 1.95, Lx = v => cx + (v - vC) * k2;
  g.save();
  g.beginPath(); g.rect(4, L0, W - 8, L1 - L0); g.clip();
  g.fillStyle = '#aab0b6'; g.fillRect(0, L0, W, lm - L0);
  g.fillStyle = '#dfe2e5'; g.fillRect(0, lm, W, L1 - lm);
  g.fillStyle = 'rgba(0,0,0,.4)'; g.fillRect(0, lm - 1.5, W, 1.5);
  for (let m = Math.floor(vC - 4); m <= Math.ceil(vC + 4); m++) {
    if (m < 0) continue;
    const x = Lx(m), hot = show && hl.vern && m === jm;
    seg(x, lm, x, L1 - 6, hot ? 3.4 : 2.2, hot ? HLC.vern : '#111');
  }
  for (let q = 0; q <= 20; q++) {
    const x = Lx(P + q * 1.95);
    if (x < -20 || x > W + 20) continue;
    const hot = show && hl.vern && q === M.vern;
    seg(x, lm, x, lm - 28, hot ? 3.4 : 2.2, hot ? HLC.vern : '#111');
    txt(q % 2 === 0 ? String(q / 2) : '·', x, lm - 38, hot ? 13 : 12, hot ? HLC.vern : '#111');
  }
  const pill = (s, x, y, align) => {
    g.font = '700 9px Inter, Arial, sans-serif'; const w = g.measureText(s).width + 10, x0 = align === 'right' ? x - w : x;
    g.fillStyle = 'rgba(11,12,14,.82)'; g.fillRect(x0, y - 7, w, 14);
    g.fillStyle = '#e4e6ea'; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(s, x0 + 5, y + 0.5);
  };
  pill('Magnified ×7', 10, L0 + 10);
  pill(show ? 'Blue line meets a beam line' : 'Which line meets a beam line?', W - 10, L1 - 11, 'right');
  g.restore();
  g.strokeStyle = '#3a3e44'; g.lineWidth = 1;
  g.beginPath(); g.rect(4.5, L0 + 0.5, W - 9, L1 - L0 - 1); g.stroke();

  const placed = [];
  for (const kk of state.pErr) {
    if (kk === 'inch') flatArrow(g, W, H, clamp(Xm(M.cm * 10), 14, W - 14), yE + 72, 0.3, 0.95, HLC.inch, 'Cm ' + M.cm, placed);
    else if (kk === 'tenth') flatArrow(g, W, H, Xm(M.whole), yE + 22, -0.5, 0.86, HLC.tenth, plural(M.mm, 'mm line'), placed);
    else if (kk === 'vern') flatArrow(g, W, H, vx, yE - 20, 0.3, -0.95, HLC.vern, 'Line ' + M.vern, placed);
  }
}
function drawFlatVern(g, W, H, A, show, txt, seg) {
  const hl = state.hl, pos = state.pos, n = A.inch * 1000 + A.tenth * 100 + A.rem;
  const tenthV = A.inch + A.tenth / 10, subV = tenthV + A.sub * VDIV, j = A.inch * 40 + A.tenth * 4 + A.sub + A.vern;
  // ---- strip: beam above the vernier edge, vernier plate below
  const top = 8, yE = 86, bot = 138, k = 340, ex = 40, Xv = v => ex + (v - pos) * k;
  let gr = g.createLinearGradient(0, top, 0, yE);
  gr.addColorStop(0, '#c9cdd2'); gr.addColorStop(1, '#e3e6e9');
  g.fillStyle = gr; g.fillRect(0, top, W, yE - top);
  gr = g.createLinearGradient(0, yE, 0, bot);
  gr.addColorStop(0, '#b3b8be'); gr.addColorStop(1, '#9ea4ab');
  g.fillStyle = gr; g.fillRect(0, yE, W, bot - yE);
  g.fillStyle = 'rgba(0,0,0,.4)'; g.fillRect(0, yE, W, 1.5);
  const LEN = i => i % 40 === 0 ? 44 : i % 4 === 0 ? 34 : i % 2 === 0 ? 22 : 15;
  for (let i = Math.max(0, Math.floor((pos - 0.16) / VDIV)); i <= Math.min(280, Math.ceil((pos + 0.7) / VDIV)); i++) {
    const v = i * VDIV, x = Xv(v);
    const isT = show && hl.tenth && i === A.inch * 40 + A.tenth * 4;
    const isS = show && hl.sub && A.sub > 0 && i === A.inch * 40 + A.tenth * 4 + A.sub;
    const isV = show && hl.vern && i === j;
    const col = isV ? HLC.vern : isS ? HLC.sub : isT ? HLC.tenth : '#111';
    seg(x, yE, x, yE - LEN(i), isT || isS || isV ? 2.8 : i % 4 === 0 ? 1.5 : 1.1, col);
    if (i % 40 === 0) {
      const isI = show && hl.inch && i / 40 === A.inch;
      if (isI) { g.strokeStyle = HLC.inch; g.lineWidth = 2.5; g.strokeRect(x - 12, yE - 72, 24, 26); }
      txt(String(i / 40), x, yE - 59, 19, '#111');
    } else if (i % 4 === 0) {
      if (isT) { g.strokeStyle = HLC.tenth; g.lineWidth = 2; g.strokeRect(x - 8, yE - 51, 16, 19); }
      txt(String((i / 4) % 10), x, yE - 41, 12, '#111');
    }
  }
  for (let i = 0; i <= 25; i++) {
    const x = ex + i * VSTEP * k, isV = show && hl.vern && i === A.vern;
    seg(x, yE, x, yE + (i % 5 === 0 ? 19 : 12), isV ? 2.8 : 1.1, isV ? HLC.vern : '#111');
    if (i % 5 === 0) txt(String(i), x, yE + 30, 11, '#111');
  }
  // the aligned line's number sits on its own row below, so it never crowds the 0/5/10… labels
  const vx = ex + A.vern * VSTEP * k, tagV = show && hl.vern && A.vern % 5 !== 0;
  if (tagV) {
    g.font = '700 10.5px Inter, Arial, sans-serif'; const w = g.measureText(String(A.vern)).width + 8;
    g.fillStyle = HLC.vern; g.fillRect(vx - w / 2, yE + 38, w, 13);
    txt(String(A.vern), vx, yE + 45, 10.5, '#fff');
    seg(vx, yE + 12, vx, yE + 38, 1.4, HLC.vern);
  }
  if (show && hl.inch && Xv(A.inch) < 4 && !state.pErr.length) cornerText(g, `← “${A.inch}” is ${(pos - A.inch).toFixed(1)}″ left`, 6, top + 11, { size: 11, col: '#6b5300', region: { x: 0, y: top, w: W, h: yE - top } });
  g.fillStyle = 'rgba(0,0,0,.55)'; g.font = '600 9.5px Inter, Arial, sans-serif'; g.textBaseline = 'alphabetic';
  const labRight = !tagV || vx < W / 2;
  g.textAlign = labRight ? 'right' : 'left';
  g.fillText('Vernier', labRight ? W - 6 : 6, bot - 5);

  // ---- loupe
  const L0 = bot + 8, L1 = H - 6, lm = (L0 + L1) / 2, k2 = 3200, cx = W / 2;
  const center = show ? A.vern : clamp(A.vern + ((n * 7) % 3) - 1, 0, 25);
  const vC = pos + center * VSTEP;                    // value coordinate under the loupe center
  const Lx = v => cx + (v - vC) * k2;
  g.save();
  g.beginPath(); g.rect(4, L0, W - 8, L1 - L0); g.clip();
  g.fillStyle = '#dfe2e5'; g.fillRect(0, L0, W, lm - L0);
  g.fillStyle = '#aab0b6'; g.fillRect(0, lm, W, L1 - lm);
  g.fillStyle = 'rgba(0,0,0,.4)'; g.fillRect(0, lm, W, 1.5);
  for (let i = Math.floor((vC - 0.05) / VDIV); i <= Math.ceil((vC + 0.05) / VDIV); i++) {
    if (i < 0) continue;
    const x = Lx(i * VDIV), hot = show && hl.vern && i === j;
    seg(x, lm, x, L0 + 6, hot ? 3.4 : 2.2, hot ? HLC.vern : '#111');
  }
  for (let m = 0; m <= 25; m++) {
    const x = Lx(pos + m * VSTEP);
    if (x < -20 || x > W + 20) continue;
    const hot = show && hl.vern && m === A.vern;
    seg(x, lm, x, lm + 28, hot ? 3.4 : 2.2, hot ? HLC.vern : '#111');
    txt(String(m), x, lm + 40, hot ? 13 : 12, hot ? HLC.vern : '#111');
  }
  // labels on dark pills so the lines behind them never make them hard to read
  const pill = (s, x, y, align) => {
    g.font = '700 9px Inter, Arial, sans-serif'; const w = g.measureText(s).width + 10, x0 = align === 'right' ? x - w : x;
    g.fillStyle = 'rgba(11,12,14,.82)'; g.fillRect(x0, y - 7, w, 14);
    g.fillStyle = '#e4e6ea'; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(s, x0 + 5, y + 0.5);
  };
  pill('Magnified ×10', 10, L0 + 12);
  pill(show ? 'Blue line meets a beam line' : 'Which line meets a beam line?', W - 10, L1 - 11, 'right');
  g.restore();
  g.strokeStyle = '#3a3e44'; g.lineWidth = 1;
  g.beginPath(); g.rect(4.5, L0 + 0.5, W - 9, L1 - L0 - 1); g.stroke();

  const placed = [];
  for (const kk of state.pErr) {
    if (kk === 'inch') flatArrow(g, W, H, clamp(Xv(A.inch), 14, W - 14), yE - 72, 0.3, -0.95, HLC.inch, 'Inch ' + A.inch, placed);
    else if (kk === 'tenth') flatArrow(g, W, H, Xv(tenthV), yE - 52, -0.5, -0.86, HLC.tenth, 'Tenth ' + A.tenth, placed);
    else if (kk === 'sub') flatArrow(g, W, H, Xv(subV), yE - 18, 0.55, -0.83, HLC.sub, A.sub + ' × .025', placed);
    else if (kk === 'vern') flatArrow(g, W, H, ex + A.vern * VSTEP * k, yE + 20, 0.3, 0.95, HLC.vern, 'Line ' + A.vern, placed);
  }
}

/* ================================================================== parts from the sidebar */
/* A new part never appears inside the jaws or the rod: it waits off the caliper ("staged") while the
   slider moves somewhere the part will fit, and only then is put in place. */
const CLEAR_GAP = 0.02;
function partClear() {
  if (sample.tool === 'od') return state.pos >= sample.size + CLEAR_GAP;
  if (sample.tool === 'id' || sample.tool === 'depth') return state.pos <= sample.size - CLEAR_GAP;
  return true;
}
function clearTarget() {
  if (sample.tool === 'od') return Math.max(state.pos, sample.size + 0.25);
  if (sample.tool === 'id') return Math.min(state.pos, Math.max(0, sample.size - 0.25));
  if (sample.tool === 'depth') return 0;
  return state.pos;
}
function unstagePart() {
  if (!sample.staged) return;
  sample.staged = false;
  cal.add(sample.obj);
  updateOutline();
  lastKey = ''; hlKey = ''; flatKey = '';
}
function newSample(type) {
  if (state.sliderLocked) setSliderLock(false);
  buildSample(type);
  const def = PARTS[type];
  if (def) {
    const to = clearTarget();
    if (partClear()) state.animQ = [{ to, speed: 6 }];
    else { sample.staged = true; cal.remove(sample.obj); state.animQ = [{ to, speed: 8 }]; }
  }
  else setPos(state.pos, true);
  lastKey = ''; hlKey = ''; flatKey = '';
  if (def) toast(def.hint);
}
function removePart() { $('sampleSel').value = 'none'; newSample('none'); }

/* ================================================================== practice */
let rhPracticeSet = false, lastPracticeKey = '';
function setPractice(on) {
  if (on && !rhPracticeSet) {
    const mh = document.querySelector('main').clientHeight;
    RH.practice = Math.max(200, Math.min(380, mh - 400));
  }
  state.practice = on; state.pRevealed = false; state.pErr = [];
  document.body.classList.toggle('practice', on);
  applyRH();
  $('practiceBtn').setAttribute('aria-pressed', String(on));
  $('practiceBtn').dataset.tip = on ? 'Stop practicing\nShows the answers and the reading breakdown again.' : 'Practice reading\nHides the answers, picks a random part and size, and puts an answer box in the reading bar.';
  lastKey = ''; hlKey = ''; flatKey = '';
  updateOutline();
  if (on) loadPractice();
}
// which jaws practice uses: any mix of outside, inside and the depth rod (at least one stays on)
const pTools = new Set(['od', 'id', 'depth']);
try { const saved = JSON.parse(localStorage.getItem('caliper-practice-tools') || 'null'); if (Array.isArray(saved) && saved.length) { pTools.clear(); saved.forEach(t => TOOL[t] && pTools.add(t)); } } catch (e) {}
if (!pTools.size) ['od', 'id', 'depth'].forEach(t => pTools.add(t));
function syncPTools() { document.querySelectorAll('[data-ptool]').forEach(b => b.setAttribute('aria-pressed', String(pTools.has(b.dataset.ptool)))); }
function togglePTool(t) {
  if (pTools.has(t)) { if (pTools.size === 1) { toast('Pick at least one tool to practice with'); return; } pTools.delete(t); }
  else pTools.add(t);
  syncPTools();
  try { localStorage.setItem('caliper-practice-tools', JSON.stringify([...pTools])); } catch (e) {}
  // the part on the caliper no longer matches the choice: move on to one that does
  if (state.practice && !pTools.has(PARTS[lastPracticeKey] ? PARTS[lastPracticeKey].tool : '')) loadPractice();
}
function loadPractice() {
  const pool = Object.keys(PARTS).filter(k => pTools.has(PARTS[k].tool));
  const keys = pool.length > 1 ? pool.filter(k => k !== lastPracticeKey) : pool;
  const key = keys[Math.floor(Math.random() * keys.length)];
  lastPracticeKey = key;
  if (state.bezelLocked) setBezelLock(false);
  state.bezel = 0;
  setBezelLock(true);
  $('sampleSel').value = key;
  newSample(key);
  autoMeasure();
  state.pRevealed = false; state.pErr = [];
  lastKey = ''; hlKey = ''; flatKey = ''; updateOutline();
  setView('iso');
  $('guess').value = '';
  const def = PARTS[key];
  $('feedback').innerHTML = `<p class="pintro">The ${TOOL[def.tool].name.toLowerCase()} ${def.tool === 'depth' ? 'is' : 'are'} on a <b>${esc(def.label.toLowerCase())}</b>. Read the ${esc(def.what)}${metric() ? ' in millimeters (top scale)' : ''}, type it and press <b>Check</b>. Score ${state.pScore.right}/${state.pScore.total}.</p>`;
  setTimeout(() => $('guess').focus({ preventScroll: true }), 50);
}

const parseIn = s => parseFloat(String(s).replace(/[″"in\s]/g, ''));
const pickOne = a => a[Math.floor(Math.random() * a.length)];
const STEP_DEF = {
  inch:  { name: 'Inch number', css: 'var(--hl-inch)', hex: () => HLC.inch, val: A => A.inch * 1000, det: A => `number “${A.inch}”`, view: 'scale' },
  tenth: { get name() { return isVern() ? 'Tenth digits' : 'Tenth lines'; }, css: 'var(--hl-tenth)', hex: () => HLC.tenth, val: A => A.tenth * 100, det: A => `${A.tenth} × 0.100″`, view: 'scale' },
  dial:  { name: 'Dial', css: 'var(--hl-dial)', hex: () => HLC.dial, val: A => A.dial, det: A => `mark ${A.dial}`, view: 'dial' },
  sub:   { name: '0.025″ lines', css: 'var(--hl-sub)', hex: () => HLC.sub, val: A => A.sub * 25, det: A => `${A.sub} × 0.025″`, view: 'scale' },
  vern:  { name: 'Vernier', css: 'var(--hl-vern)', hex: () => HLC.vern, val: A => A.vern, det: A => `line ${A.vern}`, view: 'dial' }
};
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
// how a step's value is described in the "yours → correct" header
function stepWord(k, X) {
  if (k === 'inch') return `“${X.inch}”`;
  if (k === 'tenth') return plural(X.tenth, isVern() ? 'digit' : 'line');
  if (k === 'sub') return plural(X.sub, 'line');
  if (k === 'vern') return `line ${X.vern}`;
  return `mark ${X.dial}`;
}

function explain(you, ans) {
  const A = split(ans), Y = split(you), why = {}, notes = [];
  const ratio = ans ? you / ans : 0, lg = ratio > 0 ? Math.log10(ratio) : NaN;
  if (Number.isFinite(lg) && Math.round(lg) !== 0 && Math.abs(lg - Math.round(lg)) < 1e-9) {
    notes.push({ icon: 'fa-heart', title: 'Every digit is right — only the decimal point moved', text: `Inch readings on this caliper have three decimal places, so this one is ${(ans / 1000).toFixed(3)}″.` });
    return { A, Y, why, notes, decimal: true };
  }
  if (isVern()) return explainVern(A, Y, you, ans);
  const near = A.dial >= 90 || A.dial <= 10;
  if (Y.inch !== A.inch) {
    why.inch = Y.inch === A.inch + 1
      ? `“${Y.inch}” is to the right of the slider edge, so the slider hasn't reached it yet. The last number it has passed is “${A.inch}”.`
      : `Look left along the beam from the slider edge. The last whole-inch number is “${A.inch}”, so the reading starts at ${A.inch}.000″.`;
  }
  if (Y.tenth !== A.tenth) {
    why.tenth = near && Math.abs(Y.tenth - A.tenth) === 1
      ? `The slider edge is right next to a line, which makes this tricky. Let the dial decide: it reads ${A.dial}, so ${A.dial >= 90 ? `the next line hasn't been reached yet and the count is ${A.tenth}` : `line ${A.tenth} has just been passed`}.`
      : Y.tenth > A.tenth
        ? `Only lines left of the slider edge count. Counting from “${A.inch}”, the edge has passed ${A.tenth} line${A.tenth === 1 ? '' : 's'}.`
        : `Every line after “${A.inch}” is worth 0.100″. The slider edge has passed ${A.tenth} of them.`;
  }
  if (Y.dial !== A.dial) {
    why.dial = Y.dial === 100 - A.dial && A.dial !== 50
      ? `The dial counts clockwise from 0. Reading it the other way gives ${Y.dial} instead of ${A.dial}.`
      : Math.abs(Y.dial - A.dial) <= 2
        ? `So close — the needle sits on mark ${A.dial}, just ${Math.abs(Y.dial - A.dial)} mark${Math.abs(Y.dial - A.dial) === 1 ? '' : 's'} from your value.`
        : `Each small mark is 0.001″. The needle points at mark ${A.dial}, which adds ${(A.dial / 1000).toFixed(3)}″.`;
  }
  if (Math.abs(you - ans) < 100 && (Y.tenth !== A.tenth || Y.inch !== A.inch) && near)
    notes.push({ icon: 'fa-rotate', title: 'You were very close', text: `Only ${(Math.abs(you - ans) / 1000).toFixed(3)}″ away. The needle was near 0, which is exactly where the beam moves on to the next tenth line.` });
  return { A, Y, why, notes };
}

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
  const W = this.W, H = this.H, m = 2.5, placed = [], txt = [], dropped = [];
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
    if (!done) dropped.push(L.t);
  }
  Viz.last = { placed, obs: this.obs, labs: txt, dropped, W, H };
  const halo = L => L.noHalo ? '' : ` stroke="${L.halo || '#0c0d0f'}" stroke-opacity=".72" stroke-width="3" stroke-linejoin="round" paint-order="stroke"`;
  const texts = txt.map(({ L, x, y, size, anchor, weight }) =>
    `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" fill="${L.col || VZ.ink}" font-size="${size.toFixed(1)}" font-family="Inter,Arial,sans-serif" font-weight="${weight}" text-anchor="${anchor}" dominant-baseline="central"${halo(L)}>${L.t}</text>`).join('');
  const clip = 'vzclip' + (Viz.n = (Viz.n || 0) + 1);
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-hidden="true"><defs><clipPath id="${clip}"><rect width="${W}" height="${H}" rx="4"/></clipPath></defs><g clip-path="url(#${clip})">${this.out.join('')}</g>${texts}</svg>`;
};

/* small diagrams for each step that needs another look.
   Every label gets a translucent outline, and the placer keeps label + outline clear of all lines, shapes and other labels. */
const VZ = { ok: '#5fcf8a', bad: '#ff7a6e', ink: '#e4e6ea', mute: '#8a8f97', metal: '#2a2d32', slide: '#4a4f57', hidden: '#7d838b' };
function vizFor(k, A, Y) {
  if (k === 'dial') return vizDial(A, Y);
  if (k === 'sub') return vizSub(A, Y);
  if (k === 'vern') return vizVern(A, Y);
  const W = 280, H = 88, v = new Viz(W, H), base = 66;
  let ticks, edge;
  if (k === 'inch') {
    const sp = 88, x0 = 56, frac = (A.tenth * 100 + A.rem) / 1000;
    edge = Math.min(x0 + sp - 14, x0 + 8 + frac * (sp - 22));
    ticks = [];
    for (let num = A.inch - 1; num <= A.inch + 2; num++) {
      if (num < 0 || num > 6) continue;
      ticks.push({ x: x0 + (num - A.inch) * sp, label: `${num}″`, isA: num === A.inch, isY: !!Y && num === Y.inch && num !== A.inch });
    }
  } else {
    const sp = 32, t0 = Math.max(0, A.inch * 10 + A.tenth - 3), x0 = 26, cur = A.inch * 10 + A.tenth;
    edge = x0 + (cur - t0) * sp + 6 + (A.rem / 100) * (sp - 14);
    ticks = [];
    for (let t = t0; t <= t0 + 7; t++) {
      // compare the tenth count on its own, even if the inch number was also misread
      const yt = Y ? A.inch * 10 + Y.tenth : -1;
      ticks.push({ x: x0 + (t - t0) * sp, label: t % 10 === 0 ? `${t / 10}″` : String(t % 10), isA: t === cur, isY: t === yt && t !== cur, major: t % 10 === 0 });
    }
  }
  v.surface(`<rect x="0" y="0" width="${W}" height="${H}" fill="${VZ.metal}"/>`);
  v.surface(`<rect x="${edge}" y="0" width="${W - edge}" height="${H}" fill="${VZ.slide}"/>`);
  v.line(edge, 0, edge, H, '#aeb3ba', 2);
  v.line(0, base, edge - 1, base, VZ.ink, 1.2);
  for (const t of ticks) {
    const hidden = t.x > edge, hot = t.isA || t.isY;
    const col = t.isA ? VZ.ok : t.isY ? VZ.bad : hidden ? VZ.hidden : VZ.ink;
    const top = hot || t.major || k === 'inch' ? 38 : 46;
    v.line(t.x, base, t.x, top, col, hot ? 2.6 : 1.4, t.isY || hidden ? '4 3' : '');
    if (t.isA) v.circle(t.x, base + 11, 4, `fill="${VZ.ok}"`);
    if (t.isY) v.circle(t.x, base + 11, 4, `fill="none" stroke="${VZ.bad}" stroke-width="1.6"`);
    v.text(t.label, t.x, 24, { col, size: hot ? 13 : 11, weight: hot ? 700 : 600, maxShift: 12, halo: hidden ? VZ.slide : VZ.metal });
  }
  v.text(isVern() ? 'Vernier 0' : 'Slider', W - 8, H - 10, { anchor: 'end', size: 9, col: '#c3c7cd', halo: VZ.slide, within: { x: edge + 2, y: 0, w: W - edge - 2, h: H }, alts: [[0, -20], [0, -40], [0, -58]] });
  return v.render();
}
function vizDial(A, Y) {
  const W = 280, H = 100, v = new Viz(W, H), cx = W / 2, R = 160, top = 40, cy = top + R, step = TAU / 100 * 1.5, span = 9;
  v.surface(`<rect x="0" y="0" width="${W}" height="${H}" fill="${VZ.metal}"/>`);
  v.surface(`<path d="M ${cx - R} ${cy} A ${R} ${R} 0 0 1 ${cx + R} ${cy} Z" fill="#3a3f46"/>`);
  let yVisible = false;
  for (let d = -span; d <= span; d++) {
    const m = ((A.dial + d) % 100 + 100) % 100, a = d * step;
    const isA = d === 0, isY = !!Y && m === Y.dial && !isA;
    if (isY) yVisible = true;
    const hot = isA || isY, L = m % 10 === 0 ? 18 : m % 5 === 0 ? 13 : 9;
    const col = isA ? VZ.ok : isY ? VZ.bad : VZ.ink;
    const px = r => cx + r * Math.sin(a), py = r => cy - r * Math.cos(a);
    v.line(px(R), py(R), px(R - (hot ? 20 : L)), py(R - (hot ? 20 : L)), col, hot ? 2.6 : 1.2, isY ? '4 3' : '');
    // numbers sit above the marks, outside the ring
    if (m % 5 === 0 || hot) v.text(m, px(R + 13), py(R + 13), { col, size: hot ? 12.5 : 10, weight: hot ? 700 : 600, maxShift: 10, alts: [[0, -6]] });
  }
  v.line(cx, H, cx, top + 6, '#0c0c0d', 4);
  v.circle(cx, top + 6, 2.5, `fill="${VZ.ok}"`);
  v.text('Needle', cx - 12, H - 10, { anchor: 'end', size: 9, col: VZ.mute, alts: [[-20, 0], [24 + 12 * 2, 0]] });
  if (Y && !yVisible) v.text(`Yours: mark ${Y.dial}`, W - 8, H - 10, { anchor: 'end', size: 10, col: VZ.bad, alts: [[0, -16]] });
  return v.render();
}

function explainVern(A, Y, you, ans) {
  const why = {}, notes = [];
  if (Y.inch !== A.inch) {
    why.inch = Y.inch === A.inch + 1
      ? `“${Y.inch}” is to the right of the vernier zero, so it hasn't been reached yet. The last inch number passed is “${A.inch}”.`
      : `Look left along the beam from the vernier zero. The last whole-inch number is “${A.inch}”, so the reading starts at ${A.inch}.000″.`;
  }
  if (Y.tenth !== A.tenth) {
    why.tenth = Y.tenth > A.tenth
      ? `Only digits left of the vernier zero count. Counting from “${A.inch}”, the zero has passed ${plural(A.tenth, 'digit')}.`
      : `Each small digit on the beam is 0.100″. The vernier zero has passed ${A.tenth} of them after “${A.inch}”, adding ${(A.tenth / 10).toFixed(3)}″.`;
  }
  if (Y.sub !== A.sub) {
    why.sub = Y.sub === 0
      ? `Don't skip the short lines. Between digit ${A.tenth} and the vernier zero there ${A.sub === 1 ? 'is 1 more line, worth 0.025″' : `are ${A.sub} more lines, each worth 0.025″`} — that adds ${(A.sub * 0.025).toFixed(3)}″.`
      : Y.sub > A.sub
        ? `Only beam lines left of the vernier zero count. Past digit ${A.tenth} it has passed ${plural(A.sub, 'short line')}, not ${Y.sub}.`
        : `Each short beam line is 0.025″. Past digit ${A.tenth} the vernier zero has passed ${A.sub} of them, adding ${(A.sub * 0.025).toFixed(3)}″.`;
  }
  if (Y.vern !== A.vern) {
    const d = Math.abs(Y.vern - A.vern);
    why.vern = d <= 2
      ? `So close — line ${A.vern} is the one that meets a beam line exactly. Its neighbors are each 0.001″ out, so they miss by a hair.`
      : `Run your eye along the vernier and find the one line that meets a beam line exactly. It's line ${A.vern}, which adds ${(A.vern / 1000).toFixed(3)}″.`;
  }
  if (why.sub && !why.vern && !why.inch && !why.tenth && Math.abs(you - ans) % 25 === 0)
    notes.push({ icon: 'fa-lightbulb', title: 'Your vernier reading was right', text: `Only the 0.025″ count was off — that's the step people most often forget on an inch vernier.` });
  return { A, Y, why, notes };
}
// the short 0.025″ lines between one beam digit and the next
function vizSub(A, Y) {
  const W = 280, H = 88, v = new Viz(W, H), base = 66, sp = 56, x0 = 30, edge = x0 + (A.rem / 25) * sp;
  v.surface(`<rect x="0" y="0" width="${W}" height="${H}" fill="${VZ.metal}"/>`);
  v.surface(`<rect x="${edge}" y="0" width="${W - edge}" height="${H}" fill="${VZ.slide}"/>`);
  v.line(edge, 0, edge, H, '#aeb3ba', 2);
  v.line(0, base, edge - 1, base, VZ.ink, 1.2);
  const lab = t => t === 0 ? (A.tenth ? String(A.tenth) : `${A.inch}″`) : t === 4 ? (A.tenth === 9 ? `${A.inch + 1}″` : String(A.tenth + 1)) : `+.0${t * 25}`;
  for (let t = 0; t <= 4; t++) {
    const x = x0 + t * sp, hidden = x > edge, isA = t === A.sub, isY = !!Y && t === Y.sub && !isA, hot = isA || isY;
    const col = isA ? VZ.ok : isY ? VZ.bad : hidden ? VZ.hidden : VZ.ink;
    const top = t % 4 === 0 ? 34 : t === 2 ? 42 : 48;
    v.line(x, base, x, hot ? Math.min(top, 40) : top, col, hot ? 2.6 : 1.4, isY || hidden ? '4 3' : '');
    if (isA) v.circle(x, base + 11, 4, `fill="${VZ.ok}"`);
    if (isY) v.circle(x, base + 11, 4, `fill="none" stroke="${VZ.bad}" stroke-width="1.6"`);
    v.text(lab(t), x, 20, { col, size: hot ? 12.5 : 10.5, weight: hot ? 700 : 600, maxShift: 10, halo: hidden ? VZ.slide : VZ.metal });
  }
  v.text('Vernier 0', W - 8, H - 10, { anchor: 'end', size: 9, col: '#c3c7cd', halo: VZ.slide, within: { x: edge + 2, y: 0, w: W - edge - 2, h: H }, alts: [[0, -20], [0, -40], [0, -58]] });
  return v.render();
}
// beam lines above, vernier lines below; the mismatch is exaggerated so "lines up" is easy to see
function vizVern(A, Y) {
  const W = 280, H = 104, v = new Viz(W, H), cx = W / 2, edge = 50, bs = 30, vs = 25;
  v.surface(`<rect x="0" y="0" width="${W}" height="${H}" fill="${VZ.metal}"/>`);
  v.surface(`<rect x="0" y="${edge}" width="${W}" height="${H - edge}" fill="${VZ.slide}"/>`);
  v.line(0, edge, W, edge, '#aeb3ba', 1.2);
  let yVisible = false;
  for (let m = 0; m <= 25; m++) {
    const xv = cx + (m - A.vern) * vs, xb = cx + (m - A.vern) * bs;
    const isA = m === A.vern, isY = !!Y && m === Y.vern && !isA, hot = isA || isY;
    if (xb >= 2 && xb <= W - 2) v.line(xb, edge, xb, edge - (isA ? 30 : 22), isA ? VZ.ok : VZ.ink, isA ? 2.6 : 1.2);
    if (xv < 2 || xv > W - 2) continue;
    if (isY) yVisible = true;
    const col = isA ? VZ.ok : isY ? VZ.bad : VZ.ink;
    v.line(xv, edge, xv, edge + (hot ? 26 : m % 5 === 0 ? 20 : 14), col, hot ? 2.6 : 1.2, isY ? '4 3' : '');
    if (m % 5 === 0 || hot) v.text(m, xv, edge + 38, { col, size: hot ? 12.5 : 10, weight: hot ? 700 : 600, maxShift: 8 });
  }
  v.text('Beam', 8, 10, { anchor: 'start', size: 9, col: VZ.mute, alts: [[0, 8]] });
  v.text('Spacing exaggerated', W - 8, 10, { anchor: 'end', size: 9, col: VZ.mute, alts: [[0, 8]] });
  if (Y && !yVisible) v.text(`Yours: line ${Y.vern}`, W - 8, H - 9, { anchor: 'end', size: 10, col: VZ.bad, alts: [[0, -12]] });
  return v.render();
}

// a metric reading in 0.05 mm steps, split the way it is read off the caliper
const splitQ = q => ({ q, cm: Math.floor(q / 200), mm: Math.floor(q / 20) % 10, vern: q % 20, whole: Math.floor(q / 20), total: q * 0.05 });
const STEP_MM = {
  inch:  { name: 'Centimeter number', css: 'var(--hl-inch)', val: M => M.cm * 10, det: M => `number “${M.cm}”`, word: M => `“${M.cm}”` },
  tenth: { name: 'Millimeter lines', css: 'var(--hl-tenth)', val: M => M.mm, det: M => `${M.mm} × 1 mm`, word: M => plural(M.mm, 'line') },
  vern:  { name: 'Vernier', css: 'var(--hl-vern)', val: M => M.vern * 0.05, det: M => `line ${M.vern}`, word: M => `line ${M.vern}` }
};
function explainMM(A, Y) {
  const why = {}, notes = [];
  if (Y.cm !== A.cm) {
    why.inch = Y.cm === A.cm + 1
      ? `“${Y.cm}” is to the right of the top vernier's zero, so it hasn't been reached yet. The last centimeter number passed is “${A.cm}”.`
      : `Look left along the top scale from the vernier zero. The last centimeter number is “${A.cm}”, so the reading starts at ${A.cm * 10} mm.`;
  }
  if (Y.mm !== A.mm) {
    why.tenth = Y.mm > A.mm
      ? `Only millimeter lines left of the vernier zero count. After “${A.cm}” the zero has passed ${plural(A.mm, 'line')}, not ${Y.mm}.`
      : `Each small line on the top scale is 1 mm. After “${A.cm}” the vernier zero has passed ${plural(A.mm, 'line')}, adding ${A.mm} mm.`;
  }
  if (Y.vern !== A.vern) {
    const d = Math.abs(Y.vern - A.vern);
    why.vern = d <= 2
      ? `So close — line ${A.vern} is the one that meets a beam line exactly. Its neighbors are each 0.05 mm out, so they miss by a hair.`
      : `Run your eye along the top vernier and find the one line that meets a millimeter line exactly. It's line ${A.vern}: each line is 0.05 mm, so it adds ${(A.vern * 0.05).toFixed(2)} mm.`;
  }
  if (why.vern && !why.inch && !why.tenth && Y.vern === A.vern * 2)
    notes.push({ icon: 'fa-lightbulb', title: 'Count the lines, not the numbers', text: `The numbers on the top vernier (0–10) are tenths of a millimeter and sit on every second line. Line ${A.vern} is worth ${(A.vern * 0.05).toFixed(2)} mm.` });
  return { A, Y, why, notes };
}
// millimeter lines (or centimeter numbers) up to the vernier zero, correct vs yours
function vizMM(k, A, Y) {
  if (k === 'vern') return vizMMVern(A, Y);
  const W = 280, H = 88, v = new Viz(W, H), base = 66;
  const ticks = []; let edge;
  if (k === 'inch') {
    const sp = 88, x0 = 56;
    edge = Math.min(x0 + sp - 14, x0 + 8 + ((A.mm + A.vern * 0.05) / 10) * (sp - 22));
    for (let c = A.cm - 1; c <= A.cm + 2; c++) {
      if (c < 0 || c > 18) continue;
      ticks.push({ x: x0 + (c - A.cm) * sp, label: String(c), isA: c === A.cm, isY: !!Y && c === Y.cm && c !== A.cm, major: true });
    }
  } else {
    const sp = 24, m0 = Math.max(0, A.whole - 4), x0 = 26;
    edge = x0 + (A.whole - m0) * sp + 4 + (A.vern / 20) * (sp - 8);
    const ym = Y ? A.cm * 10 + Y.mm : -1;
    for (let m = m0; m <= m0 + 10; m++) ticks.push({ x: x0 + (m - m0) * sp, label: m % 10 === 0 ? String(m / 10) : '', isA: m === A.whole, isY: m === ym && m !== A.whole, major: m % 10 === 0 || m % 5 === 0 });
  }
  v.surface(`<rect x="0" y="0" width="${W}" height="${H}" fill="${VZ.metal}"/>`);
  v.surface(`<rect x="${edge}" y="0" width="${W - edge}" height="${H}" fill="${VZ.slide}"/>`);
  v.line(edge, 0, edge, H, '#aeb3ba', 2);
  v.line(0, base, edge - 1, base, VZ.ink, 1.2);
  for (const t of ticks) {
    const hidden = t.x > edge, hot = t.isA || t.isY;
    const col = t.isA ? VZ.ok : t.isY ? VZ.bad : hidden ? VZ.hidden : VZ.ink;
    v.line(t.x, base, t.x, hot || t.major ? 38 : 48, col, hot ? 2.6 : 1.4, t.isY || hidden ? '4 3' : '');
    if (t.isA) v.circle(t.x, base + 11, 4, `fill="${VZ.ok}"`);
    if (t.isY) v.circle(t.x, base + 11, 4, `fill="none" stroke="${VZ.bad}" stroke-width="1.6"`);
    if (t.label) v.text(t.label, t.x, 24, { col, size: hot ? 13 : 11, weight: hot ? 700 : 600, maxShift: 12, halo: hidden ? VZ.slide : VZ.metal });
  }
  v.text('Vernier 0', W - 8, H - 10, { anchor: 'end', size: 9, col: '#c3c7cd', halo: VZ.slide, within: { x: edge + 2, y: 0, w: W - edge - 2, h: H }, alts: [[0, -20], [0, -40], [0, -58]] });
  return v.render();
}
// millimeter lines above, the 20 vernier lines below; spacing exaggerated so "lines up" is easy to see
function vizMMVern(A, Y) {
  const W = 280, H = 104, v = new Viz(W, H), cx = W / 2, edge = 50, bs = 30, vs = 25;
  v.surface(`<rect x="0" y="0" width="${W}" height="${H}" fill="${VZ.metal}"/>`);
  v.surface(`<rect x="0" y="${edge}" width="${W}" height="${H - edge}" fill="${VZ.slide}"/>`);
  v.line(0, edge, W, edge, '#aeb3ba', 1.2);
  let yVisible = false;
  for (let m = 0; m <= 20; m++) {
    const xv = cx + (m - A.vern) * vs, xb = cx + (m - A.vern) * bs;
    const isA = m === A.vern, isY = !!Y && m === Y.vern && !isA, hot = isA || isY;
    if (xb >= 2 && xb <= W - 2) v.line(xb, edge, xb, edge - (isA ? 30 : 22), isA ? VZ.ok : VZ.ink, isA ? 2.6 : 1.2);
    if (xv < 2 || xv > W - 2) continue;
    if (isY) yVisible = true;
    const col = isA ? VZ.ok : isY ? VZ.bad : VZ.ink;
    v.line(xv, edge, xv, edge + (hot ? 26 : m % 2 === 0 ? 20 : 14), col, hot ? 2.6 : 1.2, isY ? '4 3' : '');
    if (m % 2 === 0 || hot) v.text(hot && m % 2 ? `line ${m}` : String(m / 2), xv, edge + 38, { col, size: hot ? 12.5 : 10, weight: hot ? 700 : 600, maxShift: 8 });
  }
  v.text('Millimeters', 8, 10, { anchor: 'start', size: 9, col: VZ.mute, alts: [[0, 8]] });
  v.text('Spacing exaggerated', W - 8, 10, { anchor: 'end', size: 9, col: VZ.mute, alts: [[0, 8]] });
  if (Y && !yVisible) v.text(`Yours: line ${Y.vern}`, W - 8, H - 9, { anchor: 'end', size: 10, col: VZ.bad, alts: [[0, -12]] });
  return v.render();
}
function checkPracticeMM() {
  const fb = $('feedback'), g = parseFloat(String($('guess').value).replace(/mm|[\s,]/gi, m => m === ',' ? '.' : ''));
  if (isNaN(g)) { fb.innerHTML = `<div class="fb-empty"><i class="fa-solid fa-keyboard"></i> Whenever you’re ready, type your reading in millimeters — for example 33.95.</div>`; return; }
  // everything in hundredths of a millimeter; the caliper itself reads in 0.05 mm steps
  const ansQ = Math.round(sample.size * 25.4 / 0.05 + 1e-6), ans = ansQ * 5, you = Math.round(g * 100);
  const sc = state.pScore; sc.total++;
  const ok = you === ans;
  if (ok) { sc.right++; sc.streak++; } else sc.streak = 0;
  const A = splitQ(ansQ);
  let ex = { A, Y: null, why: {}, notes: [] };
  if (!ok) {
    const ratio = ans ? you / ans : 0, lg = ratio > 0 ? Math.log10(ratio) : NaN;
    if (Number.isFinite(lg) && Math.round(lg) !== 0 && Math.abs(lg - Math.round(lg)) < 1e-9) {
      ex = { A, Y: null, why: {}, notes: [{ icon: 'fa-heart', title: 'Every digit is right — only the decimal point moved', text: `Metric readings on this caliper have two decimal places, so this one is ${(ans / 100).toFixed(2)} mm.` }], decimal: true };
    } else {
      ex = explainMM(A, splitQ(Math.round(you / 5)));
      if (you % 5) ex.notes.unshift({ icon: 'fa-ruler', title: 'Metric readings come in 0.05 mm steps', text: `Each line on the top vernier is 0.05 mm, so a reading always ends in 0 or 5 in the second decimal place — like ${(ans / 100).toFixed(2)}.` });
    }
  }
  const Y = ex.decimal ? null : ex.Y;
  const keys = stepKeys(), wrong = ok || ex.decimal ? [] : keys.filter(k => ex.why[k]);
  state.pRevealed = true; state.pErr = wrong;
  lastKey = ''; hlKey = ''; flatKey = ''; updateOutline();
  const d = (you - ans) / 100, def = PARTS[sample.type];
  const title = ok ? pickOne(['Spot on!', 'Beautifully read!', 'Nailed it!', 'Perfect reading!'])
    : ex.decimal ? 'Your reading is right!'
    : wrong.length <= 1 ? pickOne(['So close — you’ve got this!', 'Almost perfect!', 'Just one small thing!'])
    : pickOne(['Good effort — let’s fine-tune it', 'You’re on the right track']);
  const sub = ok ? (sc.streak >= 3 ? `${sc.streak} in a row — you’re really getting the hang of this.` : `The ${esc(def.what)} is ${(ans / 100).toFixed(2)} mm.`)
    : ex.decimal ? 'Only the decimal point needs moving.'
    : wrong.length ? `${wrong.length === 1 ? 'Only one step needs' : `${wrong.length} steps need`} a second look — you got ${keys.length - wrong.length} of ${keys.length} right.`
    : 'Every mark was read right — only the last step size needs a look.';
  const pct = sc.total ? Math.round(sc.right / sc.total * 100) : 0;
  const hero = `<div class="fx-hero ${ok ? 'ok' : ''}"><div class="fx-badge"><i class="fa-solid ${ok ? 'fa-check' : 'fa-seedling'}"></i></div>
    <div class="fx-head"><h4>${title}</h4><p>${sub}</p></div>
    <div class="fx-score"><div class="fx-ring" style="--p:${pct}"><span>${pct}%</span></div><div><small>Score</small><b>${sc.right} / ${sc.total}</b><small>${sc.streak ? `${sc.streak} in a row` : 'keep going'}</small></div></div></div>`;
  const cmp = ok ? '' : `<div class="fx-cmp"><div class="fx-num you"><small>You entered</small><b>${esc((you / 100).toFixed(2))} mm</b></div>
    <div class="fx-delta"><span>${d > 0 ? 'too high by' : 'too low by'}</span><div class="ar"></div><b>${Math.abs(d).toFixed(2)} mm</b></div>
    <div class="fx-num ans"><small>Correct reading</small><b>${(ans / 100).toFixed(2)} mm</b></div></div>`;
  const chips = keys.map(k => {
    const D = STEP_MM[k], bad = wrong.includes(k);
    return `<div class="fx-chip ${bad ? 'bad' : ''}" style="--c:${D.css}"><small>${D.name}</small><b>${D.val(A).toFixed(2)} mm</b><em>${D.det(A)}</em>
      ${ok ? '' : `<span class="yv"><i class="fa-solid ${bad ? 'fa-xmark' : 'fa-check'}"></i>You answered ${Y ? D.val(Y).toFixed(2) + ' mm' : '—'}</span>`}</div>`;
  }).join('<span class="fx-op">+</span>');
  const eq = `<div class="fx-sec">How the reading adds up</div><div class="fx-eq">${chips}<span class="fx-op">=</span>
    <div class="fx-chip total"><small>Reading</small><b>${(ans / 100).toFixed(2)} mm</b><em>correct total</em></div></div>`;
  const notes = ex.notes.map(nt => `<div class="fx-note"><i class="fa-solid ${nt.icon}"></i><div><b>${nt.title}</b><span>${nt.text}</span></div></div>`).join('');
  const steps = wrong.length ? `<div class="fx-sec">Let’s look closer</div><div class="fx-steps">${wrong.map((k, i) => {
    const D = STEP_MM[k];
    return `<article class="fx-step" style="--c:${D.css}">
      <div class="fx-step-h"><span class="num">${i + 1}</span><b>${D.name}</b><span class="chg"><s>${D.word(Y)}</s><i class="fa-solid fa-arrow-right"></i><strong>${D.word(A)}</strong></span></div>
      <p>${ex.why[k]}</p>
      <figure>${vizMM(k, A, Y)}<figcaption><span><i style="background:#5fcf8a"></i>correct</span><span><i style="background:#ff7a6e"></i>yours</span></figcaption></figure>
      <div class="fx-step-f"><span><i class="fa-solid fa-location-arrow"></i>Arrow on the caliper and flat view</span>
      <button class="fx-show" data-show="${k}"><i class="fa-solid fa-crosshairs"></i>Show me</button></div></article>`;
  }).join('')}</div>` : '';
  const good = !ok && Y ? keys.filter(k => !wrong.includes(k)) : [];
  const goodRow = good.length ? `<div class="fx-sec">What you got right</div><div class="fx-good">${good.map(k => `<span><i class="fa-solid fa-circle-check"></i>${STEP_MM[k].name}</span>`).join('')}</div>` : '';
  const foot = `<div class="fx-foot"><i class="fa-solid ${ok ? 'fa-star' : 'fa-heart'}"></i><span>${ok ? 'Press <b>Next</b> whenever you’d like another one.' : 'Check the arrows on the caliper, then press <b>Next</b> when you’re ready.'}</span></div>`;
  fb.innerHTML = `<div class="fx">${hero}${cmp}${notes}${eq}${steps}${goodRow}${foot}</div>`;
  fb.scrollTop = 0;
}
function checkPractice() {
  if (metric() && sample.tool) return checkPracticeMM();
  const fb = $('feedback'), g = parseIn($('guess').value);
  if (!sample.tool) { loadPractice(); return; }
  if (isNaN(g)) { fb.innerHTML = `<div class="fb-empty"><i class="fa-solid fa-keyboard"></i> Whenever you’re ready, type your reading — for example 1.347.</div>`; return; }
  const ans = Math.round(sample.size * 1000), you = Math.round(g * 1000);
  const sc = state.pScore; sc.total++;
  const ok = you === ans;
  if (ok) { sc.right++; sc.streak++; } else sc.streak = 0;
  const ex = ok ? { A: split(ans), Y: null, why: {}, notes: [] } : explain(you, ans);
  const A = ex.A, Y = ex.decimal ? null : ex.Y;
  const wrong = ok || ex.decimal ? [] : stepKeys().filter(k => ex.why[k]);
  state.pRevealed = true; state.pErr = wrong;
  lastKey = ''; hlKey = ''; flatKey = ''; updateOutline();
  const d = (you - ans) / 1000, def = PARTS[sample.type];
  const title = ok ? pickOne(['Spot on!', 'Beautifully read!', 'Nailed it!', 'Perfect reading!'])
    : ex.decimal ? 'Your reading is right!'
    : wrong.length <= 1 ? pickOne(['So close — you’ve got this!', 'Almost perfect!', 'Just one small thing!'])
    : pickOne(['Good effort — let’s fine-tune it', 'You’re on the right track']);
  const sub = ok ? (sc.streak >= 3 ? `${sc.streak} in a row — you’re really getting the hang of this.` : `The ${esc(def.what)} is ${(ans / 1000).toFixed(3)}″.`)
    : ex.decimal ? 'Only the decimal point needs moving.'
    : `${wrong.length === 1 ? 'Only one step needs' : `${wrong.length} steps need`} a second look — you got ${stepKeys().length - wrong.length} of ${stepKeys().length} right.`;
  const pct = sc.total ? Math.round(sc.right / sc.total * 100) : 0;
  const hero = `<div class="fx-hero ${ok ? 'ok' : ''}"><div class="fx-badge"><i class="fa-solid ${ok ? 'fa-check' : 'fa-seedling'}"></i></div>
    <div class="fx-head"><h4>${title}</h4><p>${sub}</p></div>
    <div class="fx-score"><div class="fx-ring" style="--p:${pct}"><span>${pct}%</span></div><div><small>Score</small><b>${sc.right} / ${sc.total}</b><small>${sc.streak ? `${sc.streak} in a row` : 'keep going'}</small></div></div></div>`;
  const cmp = ok ? '' : `<div class="fx-cmp"><div class="fx-num you"><small>You entered</small><b>${esc(f3(you / 1000))}″</b></div>
    <div class="fx-delta"><span>${d > 0 ? 'too high by' : 'too low by'}</span><div class="ar"></div><b>${Math.abs(d).toFixed(3)}″</b></div>
    <div class="fx-num ans"><small>Correct reading</small><b>${(ans / 1000).toFixed(3)}″</b></div></div>`;
  const chips = stepKeys().map(k => {
    const D = STEP_DEF[k], bad = wrong.includes(k);
    return `<div class="fx-chip ${bad ? 'bad' : ''}" style="--c:${D.css}"><small>${D.name}</small><b>${(D.val(A) / 1000).toFixed(3)}″</b><em>${D.det(A)}</em>
      ${ok ? '' : `<span class="yv"><i class="fa-solid ${bad ? 'fa-xmark' : 'fa-check'}"></i>You answered ${Y ? (D.val(Y) / 1000).toFixed(3) + '″' : '—'}</span>`}</div>`;
  }).join('<span class="fx-op">+</span>');
  const eq = `<div class="fx-sec">How the reading adds up</div><div class="fx-eq">${chips}<span class="fx-op">=</span>
    <div class="fx-chip total"><small>Reading</small><b>${(ans / 1000).toFixed(3)}″</b><em>correct total</em></div></div>`;
  const notes = ex.notes.map(nt => `<div class="fx-note"><i class="fa-solid ${nt.icon}"></i><div><b>${nt.title}</b><span>${nt.text}</span></div></div>`).join('');
  const steps = wrong.length ? `<div class="fx-sec">Let’s look closer</div><div class="fx-steps">${wrong.map((k, i) => {
    const D = STEP_DEF[k];
    const yd = stepWord(k, Y);
    const ad = stepWord(k, A);
    return `<article class="fx-step" style="--c:${D.css}">
      <div class="fx-step-h"><span class="num">${i + 1}</span><b>${D.name}</b><span class="chg"><s>${yd}</s><i class="fa-solid fa-arrow-right"></i><strong>${ad}</strong></span></div>
      <p>${ex.why[k]}</p>
      <figure>${vizFor(k, A, Y)}<figcaption><span><i style="background:#5fcf8a"></i>correct</span><span><i style="background:#ff7a6e"></i>yours</span></figcaption></figure>
      <div class="fx-step-f"><span><i class="fa-solid fa-location-arrow"></i>Arrow on the caliper and flat view</span>
      <button class="fx-show" data-show="${k}"><i class="fa-solid fa-crosshairs"></i>Show me</button></div></article>`;
  }).join('')}</div>` : '';
  const good = !ok && Y ? stepKeys().filter(k => !wrong.includes(k)) : [];
  const goodRow = good.length ? `<div class="fx-sec">What you got right</div><div class="fx-good">${good.map(k => `<span><i class="fa-solid fa-circle-check"></i>${STEP_DEF[k].name}</span>`).join('')}</div>` : '';
  const foot = `<div class="fx-foot"><i class="fa-solid ${ok ? 'fa-star' : 'fa-heart'}"></i><span>${ok ? 'Press <b>Next</b> whenever you’d like another one.' : 'Check the arrows on the caliper, then press <b>Next</b> when you’re ready.'}</span></div>`;
  fb.innerHTML = `<div class="fx">${hero}${cmp}${notes}${eq}${steps}${goodRow}${foot}</div>`;
  fb.scrollTop = 0;
}

/* ================================================================== tutorial */
function openTut() { $('tut').hidden = false; $('tutClose').focus({ preventScroll: true }); $('tut').scrollTop = 0; }
function closeTut() {
  if ($('tut').hidden) return;
  $('tut').hidden = true;
  try { localStorage.setItem('caliper-tutorial-seen', '1'); } catch (e) {}
}

/* ================================================================== pointer */
const pointer = new T.Vector2(), raycaster = new T.Raycaster();
function setRay(e) {
  const r = canvas.getBoundingClientRect();
  pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
}
function roleOf(o) { while (o) { if (o.userData.role) return o.userData.role; o = o.parent; } return null; }
function pick(e) {
  setRay(e);
  // the raycaster still walks hidden groups, so check the whole chain (the other instrument's parts are hidden)
  const shown = o => { for (; o; o = o.parent) if (!o.visible) return false; return true; };
  const hit = raycaster.intersectObject(cal, true).find(h => shown(h.object));
  return hit ? { hit, role: roleOf(hit.object) } : null;
}
let drag = null;
const plane = new T.Plane(), tmpV = new T.Vector3();
// registered before OrbitControls so these handlers can claim the event first
function bindPointer() {
  canvas.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    const p = pick(e);
    if (p && p.role === 'part') return;
    if (!p || !p.role) return;
    e.stopImmediatePropagation(); camTween = null;
    if (p.role === 'sliderLock') { setSliderLock(!state.sliderLocked); toast(state.sliderLocked ? 'Slider locked' : 'Slider unlocked'); return; }
    if (p.role === 'bezelLock') { setBezelLock(!state.bezelLocked); toast(state.bezelLocked ? 'Bezel locked' : 'Bezel unlocked'); return; }
    if (p.role === 'bezel') {
      if (state.bezelLocked) { toast('The bezel is locked. Click the screw under the dial to free it.'); return; }
      plane.setFromNormalAndCoplanarPoint(new T.Vector3(0, 0, 1).transformDirection(dial.matrixWorld), p.hit.point);
      const l = dial.worldToLocal(p.hit.point.clone());
      drag = { type: 'bezel', last: Math.atan2(l.y, l.x) };
    } else {
      if (state.sliderLocked) { flashLocked(); return; }
      state.animQ = [];
      const axis = new T.Vector3(1, 0, 0).transformDirection(cal.matrixWorld);
      const dir = camera.getWorldDirection(new T.Vector3());
      const n = dir.sub(axis.clone().multiplyScalar(dir.dot(axis)));
      if (n.lengthSq() < 1e-6) n.set(0, 0, 1);
      plane.setFromNormalAndCoplanarPoint(n.normalize(), p.hit.point);
      drag = { type: 'slider', last: cal.worldToLocal(p.hit.point.clone()).x };
    }
    canvas.setPointerCapture(e.pointerId);
    canvas.style.cursor = 'grabbing';
  });
  let hoverPending = false;
  canvas.addEventListener('pointermove', e => {
    if (!drag) {
      if (e.buttons || hoverPending) return;
      hoverPending = true;
      requestAnimationFrame(() => {
        hoverPending = false;
        const p = pick(e), r = p && p.role;
        canvas.style.cursor = !r || r === 'part' ? '' : (r === 'sliderLock' || r === 'bezelLock') ? 'pointer' : 'grab';
      });
      return;
    }
    setRay(e);
    if (!raycaster.ray.intersectPlane(plane, tmpV)) return;
    if (drag.type === 'slider') {
      const x = cal.worldToLocal(tmpV.clone()).x, d = x - drag.last; drag.last = x;
      setPos(state.pos + d * (state.fine ? FINE.drag : 1) * (e.shiftKey ? 0.1 : 1));
    } else {
      const l = dial.worldToLocal(tmpV.clone()), a = Math.atan2(l.y, l.x);
      let d = a - drag.last; drag.last = a;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      state.bezel += d * (state.fine ? FINE.bezel : 1) * (e.shiftKey ? 0.2 : 1);
    }
  });
  const endDrag = e => { if (!drag) return; drag = null; canvas.style.cursor = 'grab'; try { canvas.releasePointerCapture(e.pointerId); } catch (_) {} };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('wheel', e => {
    const p = pick(e);
    if (!p || p.role !== 'wheel') return;
    e.preventDefault(); e.stopImmediatePropagation();
    const d = e.deltaY || e.deltaX;
    if (!d) return;
    state.animQ = [];
    setPos(state.pos + (d < 0 ? 1 : -1) * (state.fine ? (e.shiftKey ? 0.001 : FINE.wheel) : (e.shiftKey ? 0.01 : 0.001)));
  }, { passive: false });
}

/* ================================================================== UI bindings */
function bindUI() {
  const target = () => state.animQ.length ? state.animQ[state.animQ.length - 1].to : state.pos;
  $('slider').addEventListener('input', e => { state.animQ = []; setPos(e.target.value / sliderUnit()); });
  $('slider').addEventListener('change', () => { if (state.fine) applySliderRange(); });
  document.querySelectorAll('[data-step]').forEach(b => b.addEventListener('click', () => goTo(Math.round((target() + parseFloat(b.dataset.step)) * 1000) / 1000, state.fine ? 1 : 7)));
  const fine = () => setFine(!state.fine);
  $('fineBtn').addEventListener('click', fine); $('fineQuick').addEventListener('click', fine);
  const close = () => goTo(limits()[0]), open = () => goTo(limits()[1]);
  $('closeBtn').addEventListener('click', close); $('closeQuick').addEventListener('click', close);
  $('openBtn').addEventListener('click', open); $('openQuick').addEventListener('click', open);
  const lock = () => { setSliderLock(!state.sliderLocked); toast(state.sliderLocked ? 'Slider locked' : 'Slider unlocked'); };
  $('lockBtn').addEventListener('click', lock); $('lockQuick').addEventListener('click', lock);
  $('bezelLockBtn').addEventListener('click', () => { setBezelLock(!state.bezelLocked); toast(state.bezelLocked ? 'Bezel locked' : 'Bezel unlocked'); });
  const go = () => {
    const txt = $('setTo').value;
    if (!isVern() && unitOf(txt) === 'mm') { toast('The dial caliper reads inches only. Type the size in inches, like 1.234'); return; }
    const v = isVern() ? inputInches(txt) : numOf(txt);
    if (isNaN(v) || v < 0 || v > TRAVEL) { toast(`Enter a reading between 0.000 and ${TRAVEL.toFixed(3)}`); return; }
    goTo(v);
  };
  $('goBtn').addEventListener('click', go);
  $('setTo').addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  document.querySelectorAll('[data-units]').forEach(b => b.addEventListener('click', () => {
    setUnits(b.dataset.units); syncHlCards();
    if (state.practice && isVern()) {
      state.pRevealed = false; state.pErr = []; lastKey = ''; hlKey = ''; flatKey = ''; updateOutline();
      $('guess').value = '';
      $('feedback').innerHTML = `<p class="pintro">Now reading in <b>${metric() ? 'millimeters — use the top scale and top vernier' : 'inches — use the bottom scale and bottom vernier'}</b>. Type your reading and press <b>Check</b>.</p>`;
    }
  }));
  setUnits(units); syncHlCards();
  bindFolds();
  $('bezelRange').addEventListener('input', e => setBezelThou(+e.target.value));
  $('zeroBtn').addEventListener('click', () => {
    if (state.bezelLocked) { toast('The bezel is locked. Unlock it before zeroing.'); return; }
    state.bezel = 0; toast('Bezel set to zero');
  });
  // reset: back to zero whatever the lock says, and the lock stays as it was
  $('bezelResetBtn').addEventListener('click', () => {
    state.bezel = 0; $('bezelRange').value = 0;
    toast(state.bezelLocked ? 'Bezel reset to zero (still locked)' : 'Bezel reset to zero');
  });
  $('skewBtn').addEventListener('click', () => {
    if (state.bezelLocked) { toast('The bezel is locked. Unlock it first.'); return; }
    const t = (5 + Math.floor(Math.random() * 36)) * (Math.random() < 0.5 ? -1 : 1);
    state.bezel = t / 100 * TAU; toast('Bezel knocked off zero — close the jaws and zero it');
  });
  $('sampleSel').addEventListener('change', e => newSample(e.target.value));
  $('newVals').addEventListener('click', () => newSample(sample.type));
  $('revealBtn').addEventListener('click', () => { state.revealed = !state.revealed; refreshPartCard(); });
  document.querySelectorAll('[data-hl]').forEach(c => c.addEventListener('change', () => { state.hl[c.dataset.hl] = c.checked; hlKey = ''; flatKey = ''; updateOutline(); }));
  document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));
  $('autoBtn').addEventListener('click', autoMeasure);
  $('pullBtn').addEventListener('click', removePart);
  $('practiceBtn').addEventListener('click', () => setPractice(!state.practice));
  $('randomBtn').addEventListener('click', loadPractice);
  document.querySelectorAll('[data-ptool]').forEach(b => b.addEventListener('click', () => togglePTool(b.dataset.ptool)));
  syncPTools();
  $('checkBtn').addEventListener('click', checkPractice);
  $('guess').addEventListener('keydown', e => { if (e.key === 'Enter') checkPractice(); });
  $('guess').addEventListener('input', () => { if (state.pRevealed) { state.pRevealed = false; state.pErr = []; lastKey = ''; hlKey = ''; flatKey = ''; updateOutline(); } });
  $('feedback').addEventListener('click', e => { const b = e.target.closest('[data-show]'); if (b) showMe(b.dataset.show); });
  $('examBtn').addEventListener('click', () => setExam(true));
  $('exitExam').addEventListener('click', () => setExam(false));
  $('spinBtn').addEventListener('click', () => setSpin(!controls.autoRotate));
  $('labelsBtn').addEventListener('click', () => setLabels(!examLabels));
  $('tutBtn').addEventListener('click', openTut);
  $('tutClose').addEventListener('click', closeTut);
  $('tut').addEventListener('click', e => { if (e.target.id === 'tut') closeTut(); });
  $('flatMaxBtn').addEventListener('click', () => setFlatMax(!flatMax));
  if (flatMax) setTimeout(() => setFlatMax(true), 0);
  $('flatBtn').addEventListener('click', () => {
    flatOpen = !flatOpen;
    // lay out now, not next frame, so the animation knows where the panel ends up
    animateFlat(() => flipLayout(() => { $('flat').classList.toggle('closed', !flatOpen); OVL.queued = false; placeFlat(); layoutOverlays(); }, $('flat')), queueLayout);
    if (!flatOpen && flatMax) setFlatMax(false);
    const fl = flatOpen ? 'Hide flat view' : 'Show flat view';
    $('flatBtn').setAttribute('aria-expanded', String(flatOpen));
    $('flatBtn').setAttribute('aria-label', fl); $('flatBtn').dataset.tip = fl;
    flatKey = '';
  });
  $('gfxSel').addEventListener('change', e => applyGfx(e.target.value));
  {
    const ro = new ResizeObserver(queueLayout);
    ro.observe(wrap);
    OV_ITEMS.forEach(o => { const el = document.querySelector(o.sel); if (el) ro.observe(el); });
    window.addEventListener('resize', queueLayout);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(queueLayout);
    queueLayout();
  }
  bindSplit(); applyRH(); applySliderRange();
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeTut(); if (state.exam) setExam(false); return; }
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
    const sm = state.fine ? FINE.key : 0.001, bg = state.fine ? FINE.keyBig : 0.01;
    let d = 0;
    if (e.key === 'ArrowRight') d = e.shiftKey ? bg : sm;
    else if (e.key === 'ArrowLeft') d = e.shiftKey ? -bg : -sm;
    else if (e.key === 'PageUp') d = 0.1;
    else if (e.key === 'PageDown') d = -0.1;
    else if (e.key === 'l' || e.key === 'L') { lock(); return; }
    else if (e.key === 'b' || e.key === 'B') { if (!isVern()) $('bezelLockBtn').click(); return; }
    else if (e.key === 'z' || e.key === 'Z') { if (!isVern()) $('zeroBtn').click(); return; }
    else if (e.key === 'a' || e.key === 'A') { autoMeasure(); return; }
    else if (e.key === 'f' || e.key === 'F') { fine(); return; }
    else return;
    e.preventDefault(); state.animQ = [];
    const q = state.fine ? 1e4 : 1e3;
    setPos(Math.round((state.pos + d) * q) / q);
  });
}

/* ================================================================== loop */
const clock = new T.Clock(), perf = [];
let lastRenderT = 0;
function adaptResolution(now) {
  const dt = now - lastRenderT; lastRenderT = now;
  if (dt > 120) { perf.length = 0; return; }
  perf.push(dt);
  if (perf.length < 60) return;
  const avg = perf.reduce((a, b) => a + b, 0) / perf.length; perf.length = 0;
  const floor = Math.min(1, gfx.maxDpr);
  if (drag) return;
  if (avg > 21 && dprCur > floor + 0.01) { dprCeil = dprCur * 0.95; dprCur = Math.max(floor, dprCur * 0.85); resize(); updateGfxInfo(); }
  else if (avg < 17.4 && dprCur < Math.min(dprCeil, gfx.maxDpr) - 0.01) { dprCur = Math.min(dprCeil, gfx.maxDpr, dprCur * 1.08); resize(); updateGfxInfo(); }
}
function loop(now) {
  const dt = Math.min(0.05, clock.getDelta());
  stepAnim(dt);
  slider.position.x = state.pos;
  needle.rotation.z = -TAU * state.pos / 0.1;
  wheel.rotation.z = state.pos / WHEEL_R;
  bezel.rotation.z = state.bezel;
  lockTopKnob.rotation.y += (knobAnim.top - lockTopKnob.rotation.y) * 0.15;
  lockTopKnob.position.y = lockTopKnob.rotation.y / (-Math.PI * 1.5) * -0.012;
  lockBotKnob.rotation.y += (knobAnim.bot - lockBotKnob.rotation.y) * 0.15;
  lockBotKnob.position.y = lockBotKnob.rotation.y / (-Math.PI * 1.5) * -0.012;
  if (state.cut) updateSection();
  stepCam(dt);
  controls.update();
  updateUI(); updateHighlights(); drawFlat();
  shopFinish(scene);
  renderer.render(scene, camera);
  updateOverlays();
  adaptResolution(now || performance.now());
}

async function start() {
  window.__load && window.__load.set(0.9, 'Setting up the view…');
  bindPointer();
  controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.dampingFactor = 0.12;
  controls.minDistance = 1; controls.maxDistance = 60;
  controls.addEventListener('start', () => { camTween = null; if (state.exam && controls.autoRotate) setSpin(false); });
  bindUI();
  applyGfx('high');
  // the host tab opens this page as the dial or the vernier caliper (caliper.html?inst=vern)
  { const q = new URLSearchParams(location.search).get('inst') || window.__INST; setInst(q === 'vern' ? 'vern' : 'dial', true); }
  buildSample('none');
  setView('iso', true);
  bindFinish();
  // compile every shader in the background before the first frame, so loading never freezes the page
  shopFinish(scene);
  await new Promise(r => setTimeout(r));
  try { await renderer.compileAsync(scene, camera); } catch (e) {}
  booted = true;
  window.__load ? window.__load.done() : $('loading').remove();

  // the first view is framed before the layout has settled (fonts, panels, the flat view's corner),
  // so frame it again a few times as things land, until the first touch from the user
  {
    let touched = false;
    const stop = () => { touched = true; };
    ['pointerdown', 'wheel', 'keydown'].forEach(t => window.addEventListener(t, stop, { capture: true, once: true }));
    const refit = () => { if (!touched && !state.exam) { setView('iso', true); } };
    requestAnimationFrame(() => requestAnimationFrame(refit));
    [150, 400, 900, 1600].forEach(ms => setTimeout(refit, ms));
    window.addEventListener('resize', () => setTimeout(refit, 120));
  }
  window.__caliper = { state, camera, controls, setView, newSample, setPractice, checkPractice, setInst, setPos };
  renderer.setAnimationLoop(loop);
}
const fontsReady = document.fonts && document.fonts.load
  ? Promise.all([document.fonts.load('600 72px "Inter"'), document.fonts.ready]).catch(() => {})
  : Promise.resolve();
window.__load && window.__load.set(0.8, 'Loading fonts…');
Promise.race([fontsReady, new Promise(r => setTimeout(r, 2500))]).then(start);
})();
