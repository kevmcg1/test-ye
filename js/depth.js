window.__load && window.__load.set(0.55, 'Building the depth micrometer…');
/*CORE*/
const CORE = (function(){
  const ROD_R = 0.0785;                 // ø.157" measuring rod
  const BASE_HX = 1.25, BASE_HZ = 0.315; // 2.5" x .63" reference face

  // sample points for the base face and the rod end
  const BASE_PTS = [], ROD_PTS = [[0, 0]];
  for (let i = 0; i <= 50; i++) for (let j = 0; j <= 8; j++){
    const x = -BASE_HX + i*BASE_HX/25, z = -BASE_HZ + j*BASE_HZ/4;
    if (Math.hypot(x, z) > ROD_R + 0.03) BASE_PTS.push([x, z]);
  }
  for (let k = 0; k < 12; k++){
    const a = k/12*Math.PI*2;
    ROD_PTS.push([Math.cos(a)*ROD_R*0.995, Math.sin(a)*ROD_R*0.995]);
    ROD_PTS.push([Math.cos(a)*ROD_R*0.5, Math.sin(a)*ROD_R*0.5]);
  }

  function inside(p, x, z){
    return p.t === 'box'
      ? (x >= p.x0 - 1e-9 && x <= p.x1 + 1e-9 && z >= p.z0 - 1e-9 && z <= p.z1 + 1e-9)
      : ((x - p.cx)*(x - p.cx) + (z - p.cz)*(z - p.cz) <= p.r*p.r + 1e-9);
  }
  function bbox(p){ return p.t === 'box' ? [p.x0, p.x1, p.z0, p.z1] : [p.cx - p.r, p.cx + p.r, p.cz - p.r, p.cz + p.r]; }
  function overlaps(a, b){
    const A = bbox(a), B = bbox(b);
    return A[0] < B[1] - 1e-9 && B[0] < A[1] - 1e-9 && A[2] < B[3] - 1e-9 && B[2] < A[3] - 1e-9;
  }
  function contains(a, b){
    const A = bbox(a), B = bbox(b);
    return A[0] <= B[0] + 1e-9 && A[1] >= B[1] - 1e-9 && A[2] <= B[2] + 1e-9 && A[3] >= B[3] - 1e-9;
  }
  // top of the part at a point: tallest solid there, cut back by any pocket or hole
  function heightAt(S, x, z){
    let h = 0;
    for (const s of S.solids) if (s.y1 > h && inside(s, x, z)) h = s.y1;
    for (const c of S.cuts) if (h > c.floor && inside(c, x, z)) h = c.floor;
    return h;
  }
  // where the base seats, where the rod lands, and which feature is under the rod
  function evalAt(S, ox, oz){
    if (!S) return { hb: 0, hr: 0, feat: null, onPart: false };
    let hb = 0, hr = 0;
    for (const [x, z] of BASE_PTS){ const h = heightAt(S, x - ox, z - oz); if (h > hb) hb = h; }
    for (const [x, z] of ROD_PTS){ const h = heightAt(S, x - ox, z - oz); if (h > hr) hr = h; }
    let feat = null;
    for (const f of S.feats){
      const g = S.geo[f.id];
      if (!g) continue;
      if (Math.abs(hr - g.floor) < 1e-6 && Math.abs(hb - g.ref) < 1e-6 && inside(g.region, -ox, -oz)){ feat = f.id; break; }
    }
    return { hb, hr, feat, onPart: hb > 1e-9 };
  }

  /* ---- parts: solids stack up, cuts are pockets and holes taken back out ---- */
  const box = (x0, x1, z0, z1, y1) => ({ t: 'box', x0, x1, z0, z1, y1 });
  const cyl = (cx, cz, r, y1) => ({ t: 'cyl', cx, cz, r, y1 });
  const cutBox = (x0, x1, z0, z1, floor) => ({ t: 'box', x0, x1, z0, z1, floor });
  const cutCyl = (cx, cz, r, floor) => ({ t: 'cyl', cx, cz, r, floor });

  const DEFS = {
    // deeper features need taller parts, so the footprint grows with them too
    slot: { name: 'Slotted block',
      feats: B => [['sd', 'slot', 'Slot depth', B + 0.60], ['st', 'step', 'End step depth', B + 0.30]],
      make(v, B){
        const H = B + 1.25, w = 0.3125, S = 1 + B*0.16;
        const landL = box(-1.75*S, -w, -0.75*S, 0.75*S, H);
        const landR = box(w, 1.2*S, -0.75*S, 0.75*S, H);
        const floor = box(-w, w, -0.75*S, 0.75*S, H - v.sd);
        const step = box(1.2*S, 2.4*S, -0.75*S, 0.75*S, H - v.st);
        return { solids: [landL, landR, floor, step], cuts: [], mat: 'milled', top: H,
          geo: { sd: { region: floor, floor: H - v.sd, ref: H }, st: { region: step, floor: H - v.st, ref: H } },
          targets: { sd: [0, 0], st: [1.2*S + 0.45, 0] } };
      } },
    pocket: { name: 'Pocketed plate',
      feats: B => [['pd', 'pocket', 'Pocket depth', B + 0.35], ['hd', 'hole', 'Drilled hole depth', B + 0.80]],
      make(v, B){
        const H = B + 1.25, S = 1 + B*0.16;
        const plate = box(-1.75*S, 1.75*S, -1*S, 1*S, H);
        const pocket = cutBox(-0.6, 0.6, -0.4, 0.4, H - v.pd);
        const hole = cutCyl(0.2, 0, 0.1563, H - v.hd);
        return { solids: [plate], cuts: [pocket, hole], mat: 'milledAlu', top: H,
          geo: { pd: { region: pocket, floor: H - v.pd, ref: H }, hd: { region: hole, floor: H - v.hd, ref: H } },
          targets: { pd: [-0.32, 0], hd: [0.2, 0] } };
      } },
    cbore: { name: 'Counterbored block',
      feats: B => [['cb', 'counterbore', 'Counterbore depth', B + 0.25], ['bh', 'hole', 'Blind hole depth', B + 0.70]],
      make(v, B){
        const H = B + 1.25, S = 1 + B*0.16;
        const block = box(-1.5*S, 1.5*S, -1*S, 1*S, H);
        const cbore = cutCyl(0, 0, 0.5, H - v.cb);
        const hole = cutCyl(0, 0, 0.1875, H - v.bh);
        return { solids: [block], cuts: [cbore, hole], mat: 'milled', top: H,
          geo: { cb: { region: cbore, floor: H - v.cb, ref: H }, bh: { region: hole, floor: H - v.bh, ref: H } },
          targets: { cb: [0.34, 0], bh: [0, 0] } };
      } },
    pin: { name: 'Shouldered pin',
      feats: B => [['sh', 'shoulder', 'Shoulder depth', B + 0.50], ['fl', 'step', 'Flange depth', B + 0.85]],
      make(v, B){
        const H = B + 1.25, rb = 0.6*(1 + B*0.09), rf = 0.95*(1 + B*0.13);
        const head = cyl(0, 0, 0.3, H);
        const body = cyl(0, 0, rb, H - v.sh);
        const flange = cyl(0, 0, rf, H - v.fl);
        return { solids: [head, body, flange], cuts: [], mat: 'turned', top: H,
          geo: { sh: { region: body, floor: H - v.sh, ref: H }, fl: { region: flange, floor: H - v.fl, ref: H } },
          targets: { sh: [(0.3 + rb)/2, 0], fl: [(rb + rf)/2, 0] } };
      } },
    master: { name: 'Depth master', ref: true, avail: B => B >= 1,
      feats: B => [['m', 'reference', `${B}.000″ depth master`, B]],
      make(v, B){
        const H = B + 0.75, w = 0.35, S = 1 + B*0.14;
        const landL = box(-1.6*S, -w, -0.7*S, 0.7*S, H);
        const landR = box(w, 1.6*S, -0.7*S, 0.7*S, H);
        const floor = box(-w, w, -0.7*S, 0.7*S, H - v.m);
        return { solids: [landL, landR, floor], cuts: [], mat: 'lapped', top: H,
          label: `${v.m.toFixed(3)} IN`,
          geo: { m: { region: floor, floor: H - v.m, ref: H } },
          targets: { m: [0, 0] } };
      } },
    plate: { name: 'Surface plate (zero check)', ref: true, avail: B => B === 0,
      feats: () => [['z', 'reference', '0.000″ zero check', 0]],
      make(){
        return { solids: [], cuts: [], mat: 'lapped', top: 0,
          geo: { z: { region: { t: 'box', x0: -5, x1: 5, z0: -4, z1: 4 }, floor: 0, ref: 0 } },
          targets: { z: [0, 0] } };
      } }
  };

  function available(B){ return Object.keys(DEFS).filter(k => !DEFS[k].avail || DEFS[k].avail(B)); }
  function makeSample(key, B, rnd){
    const D = DEFS[key];
    const feats = D.feats(B).map(([id, type, label, nom]) => ({ id, type, label, nom,
      valid: !!D.ref || (nom >= B + 0.03 && nom <= B + 0.97) }));
    const vals = {};
    // real depths land on a thousandth: this micrometer can only read that far
    feats.forEach(f => { vals[f.id] = D.ref ? f.nom : Math.round((f.nom + (Math.floor(rnd()*21) - 10)/1000)*1000)/1000; });
    const m = D.make(vals, B);
    let halfX = 1.2, halfZ = 0.9, bx = [0, 0], bz = [0, 0];
    for (const s of m.solids){
      const bb = bbox(s);
      halfX = Math.max(halfX, Math.abs(bb[0]), Math.abs(bb[1]));
      halfZ = Math.max(halfZ, Math.abs(bb[2]), Math.abs(bb[3]));
      bx = [Math.min(bx[0], bb[0]), Math.max(bx[1], bb[1])];
      bz = [Math.min(bz[0], bb[2]), Math.max(bz[1], bb[3])];
    }
    return Object.assign({ key, name: D.name, ref: !!D.ref, feats, vals, halfX, halfZ, bx, bz }, m);
  }
  // does each end of the base (left of the rod, right of the rod) rest on something at the seat height?
  function support(S, ox, oz, hb){
    let l = false, r = false;
    if (!S) return { l: true, r: true };
    for (const [x, z] of BASE_PTS){
      if (Math.abs(x) < 0.25) continue;
      if (heightAt(S, x - ox, z - oz) >= hb - 1e-6){ if (x < 0) l = true; else r = true; }
    }
    return { l, r };
  }
  return { ROD_R, BASE_HX, BASE_HZ, inside, overlaps, contains, bbox, heightAt, evalAt, support, DEFS, available, makeSample };
})();
/*ENDCORE*/

(function(){
"use strict";
const T = THREE, TAU = Math.PI*2;
const IN = 1/25.4;
const TPI = 40, DIV = TAU/25;
// analog depth micrometer proportions: base 2.5" x .63",
// base height 18 mm, 3 mm collar, 65.4 mm sleeve + thimble, 17 mm ratchet end, thimble ø18.3 mm
const BASE_W = 2.5, BASE_D = 0.63, BASE_H = 18*IN;
const SLV_R = 6*IN, SLV_BOT = 21*IN, SLV_TOP = 58*IN;
const Y_ZERO = 48.2*IN;                 // sleeve "0" line: thimble edge sits here at 0.000
const TH_LEN = 38.2*IN, TH_EDGE_R = 6.6*IN, GRAD_R = 9*IN, KN_R = 9.15*IN;
const BEVEL = 3.6*IN, GRAD_TOP = 13*IN, GROOVE_R = 8.7*IN, GROOVE_TOP = 14*IN, KNURL_TOP = 35.5*IN;
const RAT_R = 6.4*IN, RAT_TOP = TH_LEN + 17*IN, NUT_BOT = 2.0315, NUT_R = 0.165;
const ROD_R = CORE.ROD_R;
const $ = id => document.getElementById(id);
const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

let B = 0;
const state = {
  reading: 0, locked: false,
  sampleKey: 'slot', sample: null, px: 4.0, pz: 0, partTarget: null, ev: null, seq: null,
  micY: 0, lifted: false,
  practice: false, pRevealed: false, pErr: [], exam: false, cut: false, secAxis: '+z', secT: 0.45,
  pScore: { right: 0, total: 0, streak: 0 },
  hl: { num: false, line: false, thimble: false, outline: true },
  ratchetExtra: 0, slipAcc: 0, clicks: 0, anim: null,
  coachOn: true, coach: false, coachArmed: true
};
let dirty = true;
const invalidate = () => { dirty = true; };

/* ---------- feedback ---------- */
let toastTimer = 0, lastToastAt = 0, lastToastMsg = '';
function toast(msg){
  const now = performance.now();
  if (msg === lastToastMsg && now - lastToastAt < 900) return;
  lastToastMsg = msg; lastToastAt = now;
  const el = $('toast'); el.textContent = msg; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}
// sound effects are off unless switched on in Settings; the choice is shared by every tool
let actx = null, soundOn = false;
try { soundOn = localStorage.getItem('precision-tools-sound') === '1'; } catch (e) {}
function setSound(on){ soundOn = on; const c = $('soundChk'); if (c) c.checked = on; try { localStorage.setItem('precision-tools-sound', on ? '1' : '0'); } catch (e) {} }
function clickSound(){
  if (!soundOn) return;
  try{
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const n = 900, b = actx.createBuffer(1, n, actx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random()*2 - 1)*Math.exp(-i/60);
    const s = actx.createBufferSource(); s.buffer = b;
    const g = actx.createGain(); g.gain.value = 0.22;
    s.connect(g); g.connect(actx.destination); s.start();
  }catch(e){}
}

/* ---------- renderer ---------- */
const wrap = $('view');
const renderer = new T.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
renderer.setClearColor(0x000000, 0);
renderer.outputEncoding = T.sRGBEncoding;
renderer.toneMapping = T.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = T.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;
renderer.localClippingEnabled = true;
renderer.domElement.tabIndex = 0;
renderer.domElement.className = 'gl';
wrap.appendChild(renderer.domElement);
const MAX_ANISO = Math.min(8, renderer.capabilities.getMaxAnisotropy());
// Section: a cutting plane swept in from whichever face of the part you pick.
const SEC_DIRS = { '+x': [1, 0, 0], '-x': [-1, 0, 0], '+y': [0, 1, 0], '-y': [0, -1, 0], '+z': [0, 0, 1], '-z': [0, 0, -1] };
const SEC_LABEL = { '+x': 'the right-hand face', '-x': 'the left-hand face', '+y': 'the top face', '-y': 'underneath', '+z': 'the front face', '-z': 'the back face' };
const CUT_PLANE = new T.Plane(new T.Vector3(0, 0, -1), 0);

const GFX = {
  high:   { maxDpr: Math.min(window.devicePixelRatio || 1, 2), shadows: true, map: 1024 },
  medium: { maxDpr: Math.min(window.devicePixelRatio || 1, 1.25), shadows: true, map: 512 },
  low:    { maxDpr: 0.85, shadows: false, map: 512 }
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
scene.environmentIntensity = 0.7;
const camera = new T.OrthographicCamera(-1, 1, 1, -1, 0.01, 200);
scene.add(camera);

const partTop = () => state.sample ? state.sample.top : 0;
function frameTop(){ return Math.max(partTop(), state.micY) + RAT_TOP + Y_ZERO + 0.25; }
function center(){ return new T.Vector3(0, (frameTop() - 0.35)/2, 0); }
let started = false;
// The floating controls sit over the canvas, so the model is framed in the strip
// between them rather than in the whole canvas.
function resize(){
  const w = Math.max(1, wrap.clientWidth), h = Math.max(1, wrap.clientHeight);
  renderer.setPixelRatio(dprCur);
  renderer.setSize(w, h, false);
  const padT = Math.min(104, h*0.2), padB = Math.min(64, h*0.12), padX = 10;
  const fw = Math.max(120, w - 2*padX), fh = Math.max(120, h - padT - padB);
  const S = state.sample;
  const H = frameTop() + 0.35, W = Math.max(5.2, 2*((S ? S.halfX : 1.75) + 1.4));
  const a = fw/fh, vh = Math.max(H*1.06, W*1.05/a);
  camera.left = -vh*a/2; camera.right = vh*a/2; camera.top = vh/2; camera.bottom = -vh/2;
  camera.setViewOffset(fw, fh, -padX, -padT, w, h);
  camera.updateProjectionMatrix();
  invalidate();
  if (started){ shopFinish(scene); renderer.render(scene, camera); }
}
new ResizeObserver(resize).observe(wrap);

(function(){
  const es = new T.Scene();
  es.add(new T.Mesh(new T.BoxGeometry(24, 24, 24), new T.MeshBasicMaterial({ color: 0x3a3e44, side: T.BackSide })));
  const panel = (w, h, c, pos) => {
    const m = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ color: c, side: T.DoubleSide }));
    m.position.set(pos[0], pos[1], pos[2]); m.lookAt(0, 0, 0); es.add(m);
  };
  panel(16, 6, new T.Color(6, 6, 6), [0, 11, 3]);
  panel(4, 10, new T.Color(3.5, 3.6, 3.8), [-11, 3, 6]);
  panel(4, 12, new T.Color(2.2, 2.4, 2.8), [11, 2, -4]);
  panel(10, 2, new T.Color(3, 3, 3), [0, 1, 11]);
  panel(24, 24, new T.Color(0.05, 0.05, 0.06), [0, -11.5, 0]);
  const pm = new T.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(es, 0.035, 0.1, 100).texture;
  pm.dispose();
})();
const key = new T.DirectionalLight(0xffffff, 1.15);
key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02;
scene.add(key, key.target);
const rimL = new T.DirectionalLight(0xbcd4ff, 0.45); scene.add(rimL, rimL.target);
const hemi = new T.HemisphereLight(0xffffff, 0x30343a, 0.35); scene.add(hemi);
[key, rimL, hemi].forEach(l => l.layers.enable(1));

function applyGfx(name){
  gfx = GFX[name]; dprCur = dprCeil = gfx.maxDpr;
  key.castShadow = gfx.shadows;
  if (key.shadow.map){ key.shadow.map.dispose(); key.shadow.map = null; }
  key.shadow.mapSize.set(gfx.map, gfx.map);
  renderer.shadowMap.needsUpdate = true;
  resize(); updateGfxInfo();
}
function updateGfxInfo(){ $('gfxInfo').textContent = `Render scale ${Math.round(dprCur*100)}% · adapts automatically to hold 60 fps.`; }
function placeLights(){
  const c = center(), s = frameTop()/2 + 2.5;
  key.position.set(c.x + 4, c.y + 12, c.z + 6); key.target.position.copy(c);
  const sc = key.shadow.camera;
  sc.left = -s; sc.right = s; sc.top = s; sc.bottom = -s; sc.near = 0.1; sc.far = 40; sc.updateProjectionMatrix();
  rimL.position.set(c.x - 5, c.y + 3, c.z - 8); rimL.target.position.copy(c);
  renderer.shadowMap.needsUpdate = true;
}

const dimQuad = new T.Mesh(new T.PlaneGeometry(2, 2), new T.ShaderMaterial({
  uniforms: { a: { value: 0 } },
  vertexShader: 'void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: 'uniform float a; void main(){ gl_FragColor = vec4(0.0, 0.0, 0.0, a); }',
  transparent: true, depthTest: false, depthWrite: false
}));
dimQuad.frustumCulled = false; dimQuad.renderOrder = 9999; dimQuad.visible = false;
scene.add(dimQuad);

/* ---------- textures ---------- */
function canvasTex(w, h, draw, repeat){
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new T.CanvasTexture(c); t.wrapS = t.wrapT = T.RepeatWrapping;
  if (repeat) t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = MAX_ANISO;
  return t;
}
const rand = (a, b) => a + Math.random()*(b - a);
const rows = (g, w, h, base, amp, fine) => {
  for (let y = 0; y < h; y++){
    const v = base + amp*(Math.random() - 0.5) + fine*Math.sin(y*1.9);
    g.fillStyle = `rgb(${v|0},${v|0},${v|0})`; g.fillRect(0, y, w, 1);
  }
};
const brushed = canvasTex(256, 256, (g, w, h) => rows(g, w, h, 170, 150, 0), [7, 1]);
const turnedTex = canvasTex(32, 512, (g, w, h) => rows(g, w, h, 160, 130, 40));
const milledTex = canvasTex(512, 512, (g, w, h) => {
  g.fillStyle = '#b4b4b4'; g.fillRect(0, 0, w, h);
  const R = w*0.9;
  for (let k = -12; k < 70; k++){
    const cx = -R*0.35 + k*9, v = 120 + Math.random()*120;
    g.strokeStyle = `rgba(${v|0},${v|0},${v|0},0.55)`; g.lineWidth = rand(1.5, 4);
    for (const dy of [-h, 0, h]){ g.beginPath(); g.arc(cx, h/2 + dy, R, -Math.PI/2.6, Math.PI/2.6); g.stroke(); }
  }
}, [1.6, 1.6]);
const lappedTex = canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#c8c8c8'; g.fillRect(0, 0, w, h);
  g.globalAlpha = 0.18;
  for (let i = 0; i < 1600; i++){ const x = Math.random()*w, y = Math.random()*h, a = Math.random()*Math.PI, l = rand(4, 22), v = Math.random() < 0.5 ? 255 : 80;
    g.strokeStyle = `rgb(${v},${v},${v})`; g.lineWidth = 0.6; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a)*l, y + Math.sin(a)*l); g.stroke(); }
}, [3, 3]);
const granite = canvasTex(512, 512, (g, s) => {
  g.fillStyle = '#23252a'; g.fillRect(0, 0, s, s);
  for (let i = 0; i < 9000; i++){
    const v = Math.random() < 0.5 ? rand(30, 70) : rand(110, 190);
    g.fillStyle = `rgba(${v|0},${v|0},${v|0},${rand(0.15, 0.5)})`;
    g.beginPath(); g.arc(Math.random()*s, Math.random()*s, rand(0.6, 2.6), 0, TAU); g.fill();
  }
}, [3, 2]);
// diamond knurl: crossed helices, as a normal map plus a little shading
function knurlMaps(size, depth){
  const nC = document.createElement('canvas'), cC = document.createElement('canvas');
  nC.width = nC.height = cC.width = cC.height = size;
  const nG = nC.getContext('2d'), cG = cC.getContext('2d');
  const nD = nG.createImageData(size, size), cD = cG.createImageData(size, size);
  const frac = t => t - Math.floor(t);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++){
    const x = (i + 0.5)/size, y = (j + 0.5)/size;
    const fa = frac(x + y), fb = frac(x - y);
    const a = 1 - 2*Math.abs(fa - 0.5), b = 1 - 2*Math.abs(fb - 0.5);
    let h, gx, gy;
    if (a < b){ h = a; const s = fa < 0.5 ? 2 : -2; gx = s; gy = s; }
    else { h = b; const s = fb < 0.5 ? 2 : -2; gx = s; gy = -s; }
    if (h > 0.78){ gx = 0; gy = 0; }
    let nx = -gx*depth, ny = gy*depth, nz = 1;
    const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const k = (j*size + i)*4;
    nD.data[k] = (nx*0.5 + 0.5)*255; nD.data[k+1] = (ny*0.5 + 0.5)*255; nD.data[k+2] = (nz*0.5 + 0.5)*255; nD.data[k+3] = 255;
    const sh = 120 + 118*Math.pow(Math.min(h/0.78, 1), 0.55);
    cD.data[k] = sh; cD.data[k+1] = sh + 1; cD.data[k+2] = sh + 4; cD.data[k+3] = 255;
  }
  nG.putImageData(nD, 0, 0); cG.putImageData(cD, 0, 0);
  const mk = (c, srgb) => { const t = new T.CanvasTexture(c); t.wrapS = t.wrapT = T.RepeatWrapping; t.anisotropy = MAX_ANISO; if (srgb) t.encoding = T.sRGBEncoding; return t; };
  return { normal: mk(nC, false), color: mk(cC, true) };
}
const KNURL = knurlMaps(64, 1.1);
function knurlMat(ru, rv){
  const map = KNURL.color.clone(), nrm = KNURL.normal.clone();
  map.needsUpdate = nrm.needsUpdate = true;
  map.repeat.set(ru, rv); nrm.repeat.set(ru, rv);
  return new T.MeshStandardMaterial({ map, normalMap: nrm, normalScale: new T.Vector2(1, 1), metalness: 1, roughness: 0.42 });
}

/* ---------- materials ---------- */
const std = o => new T.MeshStandardMaterial(o);
const M = {
  satin: std({ color: 0xdfe2e5, metalness: 1, roughness: 0.32, roughnessMap: brushed, bumpMap: brushed, bumpScale: 0.002, side: T.DoubleSide }),
  chrome: std({ color: 0xe8eaec, metalness: 1, roughness: 0.16, side: T.DoubleSide }),
  ground: std({ color: 0xdadde1, metalness: 1, roughness: 0.2 }),
  nut: std({ color: 0x1d1e21, metalness: 0.5, roughness: 0.45 }),
  granite: std({ color: 0x4a4e55, map: granite, bumpMap: granite, bumpScale: 0.004, metalness: 0, roughness: 0.75 }),
  line: new T.MeshBasicMaterial({ color: 0x050505, side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, toneMapped: false }),
  pick: new T.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false })
};
M.bevel = std({ color: 0xf2f4f6, metalness: 0.5, roughness: 0.45, roughnessMap: brushed, bumpMap: brushed, bumpScale: 0.002, side: T.DoubleSide });
M.knurlTh = knurlMat(72, 27);

/* ---------- clear markings by default; the realistic metal finish is a setting ----------
   The turned and brushed finish puts streaks and reflections behind the graduations and makes them
   harder to read, so by default the surfaces that carry markings are a plain, even matte grey.
   "Realistic metal finish" in the sidebar brings the real finish back; the choice is remembered. */
const CLEAR_MATS = () => [[M.satin, 0xe2e4e7], [M.bevel, 0xeceef0]];
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
  renderer.shadowMap.needsUpdate = true; invalidate();
}
function bindFinish() {
  const c = document.getElementById('realChk');
  c.checked = realFinish;
  c.addEventListener('change', () => { realFinish = c.checked; try { localStorage.setItem('pt-real-finish', realFinish ? '1' : '0'); } catch (e) {} applyFinish(); });
  applyFinish();
}

M.knurlRat = knurlMat(50, 14);
M.knurlClamp = knurlMat(42, 4);
// part materials take a per-vertex tint, so a face of the part itself can change color
const PM = {
  turned:    std({ color: 0xc6cbd1, metalness: 1, roughness: 0.55, roughnessMap: turnedTex, bumpMap: turnedTex, bumpScale: 0.006, side: T.DoubleSide }),
  milled:    std({ color: 0xb9bfc6, metalness: 1, roughness: 0.55, roughnessMap: milledTex, bumpMap: milledTex, bumpScale: 0.006, side: T.DoubleSide }),
  milledAlu: std({ color: 0xcdd2d8, metalness: 0.95, roughness: 0.62, roughnessMap: milledTex, bumpMap: milledTex, bumpScale: 0.005, side: T.DoubleSide }),
  lapped:    std({ color: 0xdadde1, metalness: 1, roughness: 0.22, roughnessMap: lappedTex, bumpMap: lappedTex, bumpScale: 0.002, side: T.DoubleSide })
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
partFinish(PM.turned, 0.5, 0.54);
partFinish(PM.milled, 0.45, 0.58);
partFinish(PM.milledAlu, 0.36, 0.62, { tone: 0.97 });
partFinish(PM.lapped, 0.62, 0.3, { env: 0.6 });
// cut material, hatched the way a section is drawn
const hatchTex = canvasTex(64, 64, (g, w, h) => {
  g.fillStyle = '#c9ced6'; g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(34,40,48,.5)'; g.lineWidth = 2.2;
  for (let i = -2; i <= 2; i++){ g.beginPath(); g.moveTo(i*w, 0); g.lineTo(i*w + w, h); g.stroke(); }
}, [5, 5]);
hatchTex.encoding = T.sRGBEncoding;
const capMat = std({ color: 0xffffff, map: hatchTex, metalness: 0.15, roughness: 0.8, side: T.DoubleSide });
const HLC = { num: cssVar('--hl-num'), line: cssVar('--hl-line'), thimble: cssVar('--hl-thimble'), floor: cssVar('--hl-floor') };
// the counted marks sit under the thimble, so their highlights are drawn through it
const hlMat = (c, xray) => new T.MeshBasicMaterial({ color: new T.Color(c), side: T.DoubleSide, toneMapped: false,
  depthTest: !xray, transparent: !!xray, opacity: xray ? 0.95 : 1,
  polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 });
const HM = { num: hlMat(HLC.num, true), line: hlMat(HLC.line, true), thimble: hlMat(HLC.thimble, false) };
const ACCENT = new T.Color(cssVar('--accent') || '#5b93ea');
const R = {
  satin: M.satin.clone(), chrome: M.chrome.clone(), knurl: M.knurlRat.clone(),
  nut: M.nut.clone()
};
Object.values(R).forEach(m => { m.emissive = ACCENT.clone(); m.emissiveIntensity = 0; });

const TYPES = {
  slot:        { name: 'Slot',        c: '#a3e635' },
  step:        { name: 'Step',        c: '#e879f9' },
  pocket:      { name: 'Pocket',      c: '#2dd4bf' },
  hole:        { name: 'Hole',        c: '#ff8a3d' },
  counterbore: { name: 'Counterbore', c: '#a78bfa' },
  shoulder:    { name: 'Shoulder',    c: '#f472b6' },
  reference:   { name: 'Reference',   c: '#9aa0a8' }
};

/* ---------- geometry helpers ---------- */
const PY = (y, r, t) => [r*Math.sin(t), y, r*Math.cos(t)];
function cylY(r, y0, y1, mat, seg, open){
  const g = new T.CylinderGeometry(r, r, y1 - y0, seg || 96, 1, !!open);
  g.translate(0, (y0 + y1)/2, 0);
  return new T.Mesh(g, mat);
}
function coneY(rTop, rBot, y0, y1, mat, seg){
  const g = new T.CylinderGeometry(rTop, rBot, y1 - y0, seg || 96, 1, true);
  g.translate(0, (y0 + y1)/2, 0);
  return new T.Mesh(g, mat);
}
// one lathe band per profile segment keeps every machined edge crisp
function latheY(pts, mat, seg){
  const g = new T.Group();
  for (let i = 0; i < pts.length - 1; i++){
    const lg = new T.LatheGeometry([new T.Vector2(pts[i][0], pts[i][1]), new T.Vector2(pts[i+1][0], pts[i+1][1])], seg || 96);
    g.add(new T.Mesh(lg, mat));
  }
  return g;
}
function Strip(){ this.p = []; this.i = []; }
Strip.prototype.q = function(a, b, c, d){ const n = this.p.length/3; this.p.push(...a, ...b, ...c, ...d); this.i.push(n, n+1, n+2, n, n+2, n+3); };
Strip.prototype.circ = function(y, r, t0, t1, w){
  const n = Math.max(2, Math.ceil(Math.abs(t1 - t0)/0.05));
  for (let k = 0; k < n; k++){
    const a = t0 + (t1 - t0)*k/n, b = t0 + (t1 - t0)*(k + 1)/n;
    this.q(PY(y - w/2, r, a), PY(y + w/2, r, a), PY(y + w/2, r, b), PY(y - w/2, r, b));
  }
  return this;
};
Strip.prototype.axial = function(y0, y1, rf, t, w, seg){
  const n = seg || Math.max(1, Math.ceil((y1 - y0)/0.06));
  for (let k = 0; k < n; k++){
    const ya = y0 + (y1 - y0)*k/n, yb = y0 + (y1 - y0)*(k + 1)/n;
    const ra = rf(ya), rb = rf(yb), da = w/2/ra, db = w/2/rb;
    this.q(PY(ya, ra, t - da), PY(yb, rb, t - db), PY(yb, rb, t + db), PY(ya, ra, t + da));
  }
  return this;
};
Strip.prototype.geo = function(){
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(this.p, 3)); g.setIndex(this.i);
  g.computeBoundingSphere();
  return g;
};

let atlas = null;
function makeAtlas(strings){
  const px = 72, pad = 10, maxW = 512, cellH = Math.round(px*1.25);
  const c = document.createElement('canvas'), g = c.getContext('2d');
  const font = `600 ${px}px "Inter", Arial, sans-serif`; g.font = font;
  let x = 0, y = 0;
  const items = [...new Set(strings)].map(s => ({ s, w: Math.ceil(g.measureText(s).width) + pad*2 }));
  items.forEach(it => { if (x + it.w > maxW){ x = 0; y += cellH + 4; } it.x = x; it.y = y; x += it.w + 4; });
  c.width = maxW; c.height = T.MathUtils.ceilPowerOfTwo(y + cellH + 4);
  g.font = font; g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  const rects = {};
  items.forEach(it => {
    g.fillText(it.s, it.x + it.w/2, it.y + cellH/2 + px*0.03);
    rects[it.s] = { u0: it.x/c.width, u1: (it.x + it.w)/c.width, v1: 1 - it.y/c.height, v0: 1 - (it.y + cellH)/c.height, aspect: it.w/cellH };
  });
  const tex = new T.CanvasTexture(c); tex.encoding = T.sRGBEncoding; tex.anisotropy = MAX_ANISO;
  const base = { map: tex, transparent: true, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 };
  const mat = new T.MeshBasicMaterial(Object.assign({ color: 0x050505 }, base));
  const hl = new T.MeshBasicMaterial(Object.assign({ color: new T.Color(HLC.num), depthTest: false, polygonOffsetFactor: -7, polygonOffsetUnits: -7 }, base));
  return { rects, mat, hl };
}
function TextBatch(){ this.p = []; this.uv = []; this.i = []; }
TextBatch.prototype.add = function(s, h, mtx){
  const r = atlas.rects[s], H = h*1.25, W = H*r.aspect, n = this.p.length/3, v = new T.Vector3();
  [[-W/2, -H/2], [W/2, -H/2], [W/2, H/2], [-W/2, H/2]].forEach(([x, y]) => { v.set(x, y, 0).applyMatrix4(mtx); this.p.push(v.x, v.y, v.z); });
  this.uv.push(r.u0, r.v0, r.u1, r.v0, r.u1, r.v1, r.u0, r.v1);
  this.i.push(n, n+1, n+2, n, n+2, n+3);
  return { W, H };
};
TextBatch.prototype.geo = function(){
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(this.p, 3));
  g.setAttribute('uv', new T.Float32BufferAttribute(this.uv, 2));
  g.setIndex(this.i); g.computeBoundingSphere();
  return g;
};
// a text quad wrapped onto a vertical cylinder; rotZ turns the text to read up the axis
function cylMtx(y, r, t, rotZ){
  const m = new T.Matrix4().makeRotationY(t);
  if (rotZ) m.multiply(new T.Matrix4().makeRotationZ(rotZ));
  const p = PY(y, r, t);
  m.setPosition(p[0], p[1], p[2]);
  return m;
}
function label(text, h, color, bg){
  const px = 72, c = document.createElement('canvas'), g = c.getContext('2d');
  const font = `600 ${px}px "Inter", Arial, sans-serif`; g.font = font;
  const w = Math.ceil(g.measureText(text).width) + 24;
  c.width = w; c.height = Math.round(px*1.25);
  if (bg){ g.fillStyle = bg; g.fillRect(0, 0, c.width, c.height); }
  g.font = font; g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, w/2, c.height/2 + px*0.03);
  const tex = new T.CanvasTexture(c); tex.encoding = T.sRGBEncoding;
  const H = h*1.25;
  const m = new T.Mesh(new T.PlaneGeometry(H*w/c.height, H), new T.MeshBasicMaterial({
    map: tex, color: new T.Color(color || '#050505'), transparent: !bg, depthWrite: !!bg, toneMapped: false,
    polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
  m.renderOrder = 2; m.userData.noShadow = true; m.userData.ownMat = true;
  return m;
}
// the printing on the front of the base
function baseDecal(){
  const ppi = 1000, c = document.createElement('canvas');
  c.width = Math.round(BASE_W*ppi); c.height = Math.round(BASE_H*ppi);
  const g = c.getContext('2d');
  const P = (x, y) => [(x + BASE_W/2)*ppi, (BASE_H - y)*ppi];
  g.fillStyle = '#101113'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `600 ${0.095*ppi}px Arial, sans-serif`; g.fillText('.001in', ...P(0, 0.45));
  const tex = new T.CanvasTexture(c); tex.encoding = T.sRGBEncoding; tex.anisotropy = MAX_ANISO;
  const m = new T.Mesh(new T.PlaneGeometry(BASE_W, BASE_H), new T.MeshBasicMaterial({
    map: tex, color: 0xffffff, transparent: true, depthWrite: false, toneMapped: false,
    polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
  m.position.set(0, BASE_H/2, BASE_D/2 + 0.002);
  m.userData.noShadow = true; m.userData.ownMat = true;
  return m;
}
function HL(parent, mat, geos, order){
  const c = new T.Mesh(geos[0], mat);
  c.renderOrder = order || 4; c.visible = false; c.userData.noShadow = true;
  parent.add(c);
  return { set(i){ if (i < 0 || i >= geos.length){ c.visible = false; return; } c.geometry = geos[i]; c.visible = true; } };
}
function hullGeo(m){
  if (m.userData.hull) return m.userData.hull;
  let g = m.geometry.clone();
  g.deleteAttribute('normal'); if (g.attributes.uv) g.deleteAttribute('uv');
  if (T.BufferGeometryUtils && T.BufferGeometryUtils.mergeVertices) g = T.BufferGeometryUtils.mergeVertices(g, 1e-4);
  g.computeVertexNormals();
  return m.userData.hull = g;
}
function disposeTree(o){
  o.traverse(c => {
    if (c.geometry) c.geometry.dispose();
    if (c.userData.hull) c.userData.hull.dispose();
    if (c.userData.ownMat && c.material){ if (c.material.map) c.material.map.dispose(); c.material.dispose(); }
  });
}
function shadows(o){ o.traverse(c => { if (c.isMesh && !c.userData.noShadow) c.castShadow = true; }); }

/* ---------- build the micrometer ---------- */
const root = new T.Group(); scene.add(root);
const pickables = [];
function pickable(m, kind){ m.traverse(o => { o.userData.kind = kind; if (o.isMesh) pickables.push(o); }); return m; }
let micG, thG, ratchetG, rodMesh, leverR, halo = [], HLs = {}, trash = [], lockHulls = [];
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
let lockParts = [];
const LOCK_HULL = new T.ShaderMaterial({
  uniforms: { c: { value: new T.Color('#ff3b30') }, w: { value: 0.012 } },
  vertexShader: 'uniform float w; void main(){ vec3 p = position + normalize(normal)*w; gl_Position = projectionMatrix*modelViewMatrix*vec4(p,1.0); }',
  fragmentShader: 'uniform vec3 c; void main(){ gl_FragColor = vec4(c,1.0); }',
  side: T.BackSide
});
let partG = null, partMesh = null, capMesh = null, floorHL = {}, plateMesh = null;

function basePath(){
  const b = 0.024, W = BASE_W/2 - b, E = 10*IN - b, HT = BASE_H - b, HW = 9.5*IN, SW = 24*IN;
  const s = new T.Shape();
  s.moveTo(-W, b);
  s.lineTo(W, b); s.lineTo(W, E); s.lineTo(SW, E);
  s.quadraticCurveTo(HW + 4.5*IN, E, HW, HT);
  s.lineTo(-HW, HT);
  s.quadraticCurveTo(-HW - 4.5*IN, E, -SW, E);
  s.lineTo(-W, E); s.closePath();
  return s;
}

// the table button: shows or hides the granite table, remembered between visits
let tableOff = false;
try { tableOff = localStorage.getItem('pt-table-off') === '1'; } catch (e) {}
function setTable(off){
  tableOff = off;
  if (plateMesh) plateMesh.visible = !off;
  const b = $('tableBtn'), t = off ? 'Show the table' : 'Hide the table';
  b.setAttribute('aria-pressed', String(off)); b.setAttribute('aria-label', t);
  b.dataset.tip = t + (off ? '\nPuts the granite table back under the micrometer.' : '\nTakes the granite table out of the picture.');
  try { localStorage.setItem('pt-table-off', off ? '1' : '0'); } catch (e) {}
  renderer.shadowMap.needsUpdate = true; invalidate();
}
function build(){
  removeSample();
  while (root.children.length){ const c = root.children[0]; disposeTree(c); root.remove(c); }
  trash.forEach(g => g.dispose()); trash = [];
  pickables.length = 0; halo = [];

  // surface plate
  plateMesh = new T.Mesh(new T.BoxGeometry(26, 1.5, 16), M.granite);
  plateMesh.userData.noFit = true;
  plateMesh.position.y = -0.75; plateMesh.receiveShadow = true;
  plateMesh.visible = !tableOff;
  root.add(plateMesh);

  micG = new T.Group(); root.add(micG);

  // base
  const b = 0.024;
  const baseG = new T.ExtrudeGeometry(basePath(), { depth: BASE_D - 2*b, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: 3, curveSegments: 40 });
  baseG.translate(0, 0, -(BASE_D - 2*b)/2);
  const base = new T.Mesh(baseG, M.satin);
  micG.add(pickable(base, 'none'));
  micG.add(baseDecal());
  const bore = new T.Mesh(new T.RingGeometry(ROD_R, ROD_R + 0.022, 40), new T.MeshBasicMaterial({ color: 0x17181a, toneMapped: false }));
  bore.rotation.x = Math.PI/2; bore.position.y = -0.0008; bore.userData.noShadow = true;
  micG.add(bore);

  // collar, the knurled measuring-rod clamp in the 3 mm step, then the sleeve
  micG.add(pickable(latheY([[7.6*IN, BASE_H - 0.04], [7.6*IN, 18.8*IN], [7.2*IN, 18.8*IN]], M.chrome), 'none'));
  leverR = new T.Group(); micG.add(leverR);
  const ring = cylY(7.2*IN, 18.8*IN, 20.8*IN, M.knurlClamp, 96, true);
  leverR.add(pickable(ring, 'lever'));
  const ringTop = latheY([[7.2*IN, 20.8*IN], [6.6*IN, SLV_BOT], [SLV_R, SLV_BOT]], M.chrome);
  leverR.add(pickable(ringTop, 'lever'));
  micG.add(pickable(cylY(SLV_R, SLV_BOT, SLV_TOP, M.satin, 96, true), 'none'));
  lockHulls = [];
  [ring, ...ringTop.children].forEach(m => {
    const h = new T.Mesh(hullGeo(m), LOCK_HULL);
    h.visible = state.locked; h.userData.noShadow = true;
    h.position.copy(m.position); h.rotation.copy(m.rotation); h.scale.copy(m.scale);
    m.parent.add(h); lockHulls.push(h);
  });
  lockParts = [];
  [ring, ringTop].forEach(m => lockParts.push(...lockMeshes(m)));
  paintLock(lockParts, state.locked);

  // sleeve scale: index line, 40 lines of .025", numbers every .100" — counting toward the base
  const Rr = SLV_R + 0.0015, rS = () => Rr;
  const sBase = new Strip(), tickC = [], numC = [], numO = [], tb = new TextBatch();
  sBase.axial(Y_ZERO - 1.035, SLV_TOP, rS, 0, 0.006, 1);
  for (let i = 0; i <= 40; i++){
    const y = Y_ZERO - i*0.025, L = i % 4 === 0 ? 0.098 : (i % 2 === 0 ? 0.075 : 0.055);
    sBase.circ(y, Rr, -L/Rr, 0, 0.0055);
    tickC.push(new Strip().circ(y, Rr + 0.0008, -L/Rr, 0, 0.0075).geo());
    if (i % 4 === 0){
      const t = -(L + 0.048)/Rr, s = String(i/4);
      const sz = tb.add(s, 0.05, cylMtx(y, Rr + 0.003, t, Math.PI/2));
      const one = new TextBatch(); one.add(s, 0.05, cylMtx(y, Rr + 0.0045, t, Math.PI/2)); numC.push(one.geo());
      const hy = sz.W/2 + 0.006, ht = (sz.H/2 + 0.006)/Rr, w = 0.005, bx = new Strip();
      bx.circ(y - hy, Rr + 0.003, t - ht, t + ht, w).circ(y + hy, Rr + 0.003, t - ht, t + ht, w);
      bx.axial(y - hy, y + hy, () => Rr + 0.003, t - ht, w, 1).axial(y - hy, y + hy, () => Rr + 0.003, t + ht, w, 1);
      numO.push(bx.geo());
    }
  }
  const bm = new T.Mesh(sBase.geo(), M.line); bm.renderOrder = 1; bm.userData.noShadow = true; micG.add(bm);
  const tm = new T.Mesh(tb.geo(), atlas.mat); tm.renderOrder = 2; tm.userData.noShadow = true; micG.add(tm);
  const numBox = new T.Mesh(numO[0], HM.num); numBox.renderOrder = 20; numBox.visible = false; numBox.userData.noShadow = true; micG.add(numBox);
  const numTxt = new T.Mesh(numC[0], atlas.hl); numTxt.renderOrder = 21; numTxt.visible = false; numTxt.userData.noShadow = true; micG.add(numTxt);
  HLs.num = { set(i){ if (i < 0 || i >= numC.length){ numBox.visible = numTxt.visible = false; return; } numBox.geometry = numO[i]; numTxt.geometry = numC[i]; numBox.visible = numTxt.visible = true; } };
  HLs.line = HL(micG, HM.line, tickC, 20);
  trash.push(...tickC, ...numC, ...numO);

  // thimble: local y = 0 at the reading edge
  thG = new T.Group(); micG.add(thG);
  thG.add(pickable(latheY([[6.25*IN, 0.118], [6.25*IN, 0], [TH_EDGE_R, 0]], M.chrome), 'thimble'));
  thG.add(pickable(coneY(GRAD_R, TH_EDGE_R, 0, BEVEL, M.bevel), 'thimble'));
  thG.add(pickable(cylY(GRAD_R, BEVEL, GRAD_TOP, M.satin, 96, true), 'thimble'));
  thG.add(pickable(latheY([[GRAD_R, GRAD_TOP], [GROOVE_R, GRAD_TOP], [GROOVE_R, GROOVE_TOP], [KN_R, GROOVE_TOP]], M.chrome), 'thimble'));
  thG.add(pickable(cylY(KN_R, GROOVE_TOP, KNURL_TOP, M.knurlTh, 128, true), 'thimble'));
  thG.add(pickable(latheY([[KN_R, KNURL_TOP], [KN_R, KNURL_TOP + 0.016], [0.2992, TH_LEN], [0.189, TH_LEN]], M.chrome), 'thimble'));

  // thimble scale: 25 divisions of .001", one turn = .025"
  const rT = y => (y < BEVEL ? TH_EDGE_R + (GRAD_R - TH_EDGE_R)*(y/BEVEL) : GRAD_R) + 0.0015;
  const tl = new Strip(), thC = [], ttb = new TextBatch();
  for (let v = 0; v < 25; v++){
    const t = v*DIV, L = v % 5 === 0 ? 0.126 : 0.079, W = 0.006;
    const bl = Math.min(BEVEL, L), hc = new Strip();
    tl.axial(0, bl, rT, t, W, 3); hc.axial(0, bl, y => rT(y) + 0.0008, t, W + 0.0004, 3);
    if (L > BEVEL){ tl.axial(BEVEL, L, rT, t, W, 1); hc.axial(BEVEL, L, y => rT(y) + 0.0008, t, W + 0.0004, 1); }
    thC.push(hc.geo());
    if (v % 5 === 0) ttb.add(String(v), 0.055, cylMtx(0.205, GRAD_R + 0.004, t));
  }
  const tlm = new T.Mesh(tl.geo(), M.line); tlm.renderOrder = 1; tlm.userData.noShadow = true; thG.add(tlm);
  const ttm = new T.Mesh(ttb.geo(), atlas.mat); ttm.renderOrder = 2; ttm.userData.noShadow = true; thG.add(ttm);
  HLs.thimble = HL(thG, HM.thimble, thC, 4);
  trash.push(...thC);

  // measuring rod: tip at base level minus the rod size, nut on top of the ratchet
  const tipY = -(B + Y_ZERO);
  rodMesh = cylY(ROD_R, tipY + 0.012, NUT_BOT, M.ground, 32);
  thG.add(pickable(rodMesh, 'none'));
  thG.add(pickable(latheY([[0, tipY], [ROD_R - 0.006, tipY], [ROD_R, tipY + 0.008], [ROD_R, tipY + 0.014]], M.ground, 32), 'none'));

  // ratchet stop
  ratchetG = new T.Group(); thG.add(ratchetG);
  ratchetG.add(pickable(latheY([[0.189, TH_LEN], [0.189, 1.5984], [0.2283, 1.5984], [RAT_R, 1.6299]], R.chrome), 'ratchet'));
  ratchetG.add(pickable(cylY(RAT_R, 1.6299, 2.0, R.knurl, 96, true), 'ratchet'));
  ratchetG.add(pickable(latheY([[RAT_R, 2.0], [0.2283, 2.0157], [0.2, NUT_BOT], [NUT_R, NUT_BOT]], R.chrome), 'ratchet'));
  ratchetG.traverse(o => o.layers.enable(1));
  // rod nut
  thG.add(pickable(latheY([[NUT_R, NUT_BOT], [NUT_R, RAT_TOP - 0.014], [0.15, RAT_TOP], [0, RAT_TOP]], M.nut), 'none'));
  for (let i = 0; i < 2; i++){
    const g = new T.TorusGeometry(0.33, i ? 0.006 : 0.012, 8, 96); g.rotateX(Math.PI/2);
    const h = new T.Mesh(g, new T.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0, depthTest: false, depthWrite: false, toneMapped: false }));
    h.position.y = 1.82; h.layers.set(1); h.renderOrder = 10000; h.userData.noShadow = true; h.userData.ownMat = true;
    ratchetG.add(h); halo.push(h);
  }
  shadows(root);
  hlKey = '';
}

/* ---------- parts ---------- */
// shapes live in the extrusion plane (x, -z) and are extruded upward
function shapeOf(p, Ctor){
  const s = new (Ctor || T.Shape)();
  if (p.t === 'box'){ s.moveTo(p.x0, -p.z1); s.lineTo(p.x1, -p.z1); s.lineTo(p.x1, -p.z0); s.lineTo(p.x0, -p.z0); s.closePath(); }
  else s.absarc(p.cx, -p.cz, p.r, 0, TAU, false);
  return s;
}
const plan = p => { const b = CORE.bbox(p); return (b[1] - b[0])*(b[3] - b[2]); };
// A hole inside another hole is not a hole: a drilled hole in the floor of a pocket
// or a counterbore is already open at this level, and handing the triangulator two
// overlapping holes in one face tears the face apart.
const outermost = (list) => list.filter(a => !list.some(b => b !== a && CORE.contains(b, a) && plan(b) > plan(a) + 1e-9));

/* The part as one closed skin with nothing inside it. Each height band's outline is the union of the
   solids standing that tall less every pocket and hole already open at that height; walls run round
   those outlines, and a flat face is laid only where a level is actually exposed (a top, a step, a
   pocket floor) and underneath. Stacking a separate extrusion per band left a floor between every pair
   of bands and a wall wherever two blocks touched, and a section or the dissolve showed them all. */
function shellGeometry(S){
  const C = window.ClipperLib; if (!C) return null;
  const K = 1e6, SEG = 96;
  const toPath = pts => pts.map(([x, z]) => ({ X: Math.round(x*K), Y: Math.round(z*K) }));
  const outline = p => {
    if (p.t === 'box') return toPath([[p.x0, p.z0], [p.x1, p.z0], [p.x1, p.z1], [p.x0, p.z1]]);
    const pts = []; for (let i = 0; i < SEG; i++){ const a = i/SEG*TAU; pts.push([p.cx + p.r*Math.cos(a), p.cz + p.r*Math.sin(a)]); }
    return toPath(pts);
  };
  const ccw = path => (C.Clipper.Orientation(path) ? path : path.slice().reverse());
  // a boolean on two sets of paths; the result is a tree of outlines with their holes
  const bool = (type, subj, clip) => {
    const c = new C.Clipper(), tree = new C.PolyTree();
    if (subj.length) c.AddPaths(subj, C.PolyType.ptSubject, true);
    if (clip.length) c.AddPaths(clip, C.PolyType.ptClip, true);
    c.Execute(type, tree, C.PolyFillType.pftNonZero, C.PolyFillType.pftNonZero);
    return tree;
  };
  const paths = tree => C.Clipper.PolyTreeToPaths(tree);

  const hs = [...new Set([0, ...S.solids.map(s => s.y1), ...S.cuts.map(c => c.floor)])].sort((a, b) => a - b);
  const bands = [];
  for (let k = 0; k < hs.length - 1; k++){
    const ya = hs[k], yb = hs[k + 1];
    if (yb - ya < 1e-6) continue;
    const solids = S.solids.filter(s => s.y1 >= yb - 1e-9).map(s => ccw(outline(s)));
    const cuts = S.cuts.filter(c => c.floor <= ya + 1e-9).map(c => ccw(outline(c)));
    bands.push({ ya, yb, tree: bool(C.ClipType.ctDifference, solids, cuts) });
  }
  if (!bands.length) return null;

  const pos = [], nor = [], uv = [];
  const P = q => [q.X/K, q.Y/K];
  const tri = (a, b, c, na, nb, nc, ua, ub, uc) => { pos.push(...a, ...b, ...c); nor.push(...na, ...nb, ...nc); uv.push(...ua, ...ub, ...uc); };

  // walls: Clipper hands back outer outlines one way round and holes the other, so the material is always
  // on the left of the path and the outside is on its right
  const CREASE = Math.cos(30*Math.PI/180);
  for (const b of bands){
    for (const path of paths(b.tree)){
      const n = path.length; if (n < 3) continue;
      const pt = path.map(P), en = [];
      for (let i = 0; i < n; i++){ const a = pt[i], c = pt[(i + 1)%n], dx = c[0] - a[0], dz = c[1] - a[1], l = Math.hypot(dx, dz) || 1; en.push([dz/l, 0, -dx/l]); }
      // round walls shade smooth, corners stay sharp. Vertex v sits between edges v-1 and v.
      const vn = (v, e) => {
        const o = en[e], m = en[e === v ? (v - 1 + n)%n : v];
        if (o[0]*m[0] + o[2]*m[2] < CREASE) return o;
        const x = o[0] + m[0], z = o[2] + m[2], l = Math.hypot(x, z) || 1; return [x/l, 0, z/l];
      };
      for (let i = 0; i < n; i++){
        const a = pt[i], c = pt[(i + 1)%n], j = (i + 1)%n;
        const A = [a[0], b.ya, a[1]], B = [c[0], b.ya, c[1]], Ct = [c[0], b.yb, c[1]], D = [a[0], b.yb, a[1]];
        const na = vn(i, i), nb = vn(j, i);
        const horiz = Math.abs(c[0] - a[0]) > Math.abs(c[1] - a[1]);
        const U = p => [horiz ? p[0] : p[2], p[1]];
        tri(A, Ct, B, na, nb, nb, U(A), U(Ct), U(B));
        tri(A, D, Ct, na, na, nb, U(A), U(D), U(Ct));
      }
    }
  }
  // flat faces: what each level leaves exposed, facing up; the underside facing down
  const cap = (tree, y, up) => {
    const walk = node => {
      for (const ch of node.Childs()){
        if (!ch.IsHole()){
          const contour = ch.Contour().map(q => new T.Vector2(q.X/K, q.Y/K));
          const holes = ch.Childs().filter(h => h.IsHole()).map(h => h.Contour().map(q => new T.Vector2(q.X/K, q.Y/K)));
          const all = contour.concat(...holes);
          for (const f of T.ShapeUtils.triangulateShape(contour, holes)){
            let [i0, i1, i2] = f;
            const p0 = all[i0], p1 = all[i1], p2 = all[i2];
            // the triangle's normal is +y when it winds clockwise seen from above in x/z
            const cr = (p1.x - p0.x)*(p2.y - p0.y) - (p1.y - p0.y)*(p2.x - p0.x);
            if ((cr < 0) !== up) [i1, i2] = [i2, i1];
            const v = i => [all[i].x, y, all[i].y], w = i => [all[i].x, -all[i].y], nn = [0, up ? 1 : -1, 0];
            tri(v(i0), v(i1), v(i2), nn, nn, nn, w(i0), w(i1), w(i2));
          }
        }
        walk(ch);
      }
    };
    walk(tree);
  };
  for (let k = 0; k < bands.length; k++){
    const b = bands[k], next = bands[k + 1], prev = bands[k - 1];
    cap(next ? bool(C.ClipType.ctDifference, paths(b.tree), paths(next.tree)) : b.tree, b.yb, true);
    cap(prev ? bool(C.ClipType.ctDifference, paths(b.tree), paths(prev.tree)) : b.tree, b.ya, false);
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new T.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  return g;
}
function partGeometry(S){
  const shell = shellGeometry(S);
  if (shell) return shell;
  // without the polygon library (offline), fall back to a stack of extrusions
  const hs = [...new Set([0, ...S.solids.map(s => s.y1), ...S.cuts.map(c => c.floor)])].sort((a, b) => a - b);
  const geos = [];
  for (let k = 0; k < hs.length - 1; k++){
    const ya = hs[k], yb = hs[k + 1];
    if (yb - ya < 1e-6) continue;
    const solids = outermost(S.solids.filter(s => s.y1 >= yb - 1e-9));   // a boss inside a bigger body adds nothing
    const cuts = outermost(S.cuts.filter(c => c.floor <= ya + 1e-9));
    for (const s of solids){
      const sh = shapeOf(s);
      for (const c of cuts) if (CORE.overlaps(s, c)) sh.holes.push(shapeOf(c, T.Path));
      const g = new T.ExtrudeGeometry(sh, { depth: yb - ya, bevelEnabled: false, curveSegments: 48 });
      g.rotateX(-Math.PI/2); g.translate(0, ya, 0);
      geos.push(g);
    }
  }
  if (!geos.length) return null;
  const merged = T.BufferGeometryUtils.mergeBufferGeometries(geos, false);
  geos.forEach(g => g.dispose());
  return merged;
}
// The cut face: the part is a height field, so the material on the section plane is
// simply everything under the height profile along that line.
// The cut face. A vertical plane cuts the height profile along the line it follows;
// a horizontal one cuts the footprint of whatever is still standing at that height.
function capGeometry(S, axis, c){
  if (!S.solids.length) return null;
  const sign = axis[0] === '+' ? 1 : -1, pos = c*sign;
  if (axis[1] === 'y'){
    const geos = [];
    for (const s of outermost(S.solids.filter(v => v.y1 > pos + 1e-6))){
      const sh = shapeOf(s);
      for (const cc of outermost(S.cuts.filter(v => v.floor < pos - 1e-6))) if (CORE.overlaps(s, cc)) sh.holes.push(shapeOf(cc, T.Path));
      const g = new T.ShapeGeometry(sh, 48);
      g.rotateX(-Math.PI/2); g.translate(0, pos, 0);
      geos.push(g);
    }
    if (!geos.length) return null;
    if (geos.length === 1) return geos[0];
    const m = T.BufferGeometryUtils.mergeBufferGeometries(geos, false);
    geos.forEach(g => g.dispose());
    return m;
  }
  const alongX = axis[1] === 'x';
  const rng = alongX ? S.bz : S.bx;
  const N = 700, a0 = rng[0] - 0.02, a1 = rng[1] + 0.02, step = (a1 - a0)/N;
  const h = [];
  for (let i = 0; i <= N; i++){
    const u = a0 + i*step;
    h.push(alongX ? CORE.heightAt(S, pos, u) : CORE.heightAt(S, u, pos));
  }
  if (!h.some(v => v > 1e-6)) return null;
  const X = u => alongX ? -u : u;
  const sh = new T.Shape();
  sh.moveTo(X(a0), 0); sh.lineTo(X(a0), h[0]);
  for (let i = 1; i <= N; i++) if (Math.abs(h[i] - h[i-1]) > 1e-6){
    const u = a0 + (i - 0.5)*step;
    sh.lineTo(X(u), h[i-1]); sh.lineTo(X(u), h[i]);
  }
  sh.lineTo(X(a1), h[N]); sh.lineTo(X(a1), 0); sh.closePath();
  const g = new T.ShapeGeometry(sh, 1);
  if (alongX){ g.rotateY(Math.PI/2); g.translate(pos, 0, 0); }
  else g.translate(0, 0, pos);
  return g;
}
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
// place the plane for the current face and sweep, and rebuild the cut face to match
function updateSection(){
  if (!state.sample || !partG) return;
  const S = state.sample, d = new T.Vector3(...SEC_DIRS[state.secAxis]);
  const k = state.secAxis[1], rng = k === 'x' ? S.bx : k === 'z' ? S.bz : [0, S.top];
  const pos = d[k] > 0 ? 1 : -1;
  const hi = pos > 0 ? rng[1] : -rng[0], lo = pos > 0 ? rng[0] : -rng[1];
  const c = hi - state.secT*(hi - lo) + 0.001;
  CUT_PLANE.normal.copy(d).negate();
  CUT_PLANE.constant = c + d.x*state.px + d.z*state.pz;
  const u = capMesh && capMesh.userData;
  if (!capMesh || u.axis !== state.secAxis || Math.abs(u.c - c) > 1e-4){
    if (capMesh){ partG.remove(capMesh); capMesh.geometry.dispose(); capMesh = null; }
    const g = capGeometry(S, state.secAxis, c);
    if (g){
      capMesh = new T.Mesh(g, capMat);
      // just outside the cut, not inside the part: tucked in, the thin slab of part in front of it showed
      // every internal wall of the solid as a seam across the hatching
      capMesh.position.copy(d).multiplyScalar(0.0005);
      capMesh.userData = { axis: state.secAxis, c, noShadow: true };
      partG.add(capMesh);
    }
  }
  // the cut face stays up while a switched-off section is still rebuilding, or the hollow inside shows
  if (capMesh) capMesh.visible = state.cut || SecFx.running() === 'build';
  invalidate();
}
function setCutT(t, quiet){
  state.secT = Math.max(0, Math.min(1, t));
  if (!quiet) $('cutT').value = String(Math.round(state.secT*100));
  updateSection();
}
// Front / Side buttons: start the section from that side; pressing the lit one switches the section off.
// Switching sides while a section is up rebuilds the removed piece first and then cuts from the new side.
function pickCut(axis){
  if (pendingCut){
    // mid-switch: pick again to retarget, or press the side it is heading to again to stay off
    pendingCut = pendingCut === axis ? null : axis; syncReveal();
    return;
  }
  if (state.cut && state.secAxis === axis){ state.cut = false; applyCut(); syncReveal(); return; }
  if (state.cut){
    pendingCut = axis; state.cut = false; applyCut(); syncReveal();
    if (!SecFx.running()) runPendingCut();   // nothing animated (reduced motion, or no part): switch straight away
    return;
  }
  cutFrom(axis);
}
function cutFrom(axis){
  setCutFace(axis);
  setCutT(rodCutT(axis));
  syncReveal();
}
function runPendingCut(){
  const axis = pendingCut; pendingCut = null;
  if (axis && !state.cut) cutFrom(axis);
}
// the sweep that puts the cut straight through the rod. The rod stays at the origin while the part moves
// under it, so in the part's own space the rod is at (-px, -pz). With the rod off the part, cut it in half.
function rodCutT(axis){
  const S = state.sample, k = axis[1];
  if (!S || (k !== 'x' && k !== 'z')) return 0.5;
  const rx = -state.px, rz = -state.pz;
  const onPart = rx >= S.bx[0] && rx <= S.bx[1] && rz >= S.bz[0] && rz <= S.bz[1];
  if (!onPart || state.lifted) return 0.5;
  const [lo, hi] = k === 'x' ? S.bx : S.bz, r = k === 'x' ? rx : rz;
  // a cut from the + side sweeps down from hi, one from the - side sweeps up from lo
  const t = axis[0] === '+' ? (hi - r)/(hi - lo) : (r - lo)/(hi - lo);
  return Math.max(0, Math.min(1, t));
}
function setCutFace(axis){
  state.secAxis = axis;
  if (!state.cut){ state.cut = true; applyCut(); }
  setCutT(Math.max(state.secT, 0.2));
  $('cutNote').textContent = `Cutting in from ${SEC_LABEL[axis]} — slide to take more or less away, or pick the other side.`;
  toast(`Section from ${SEC_LABEL[axis]}`);
}

function floorOverlay(S, id){
  const g = S.geo[id];
  if (!g.region || Math.abs(g.region.x1 - g.region.x0) > 8) return null;   // the surface plate has no outline
  const sh = shapeOf(g.region);
  const open = S.cuts.filter(c => c !== g.region && c.floor < g.floor - 1e-9 && CORE.overlaps(g.region, c))
    .concat(S.solids.filter(s => s.y1 > g.floor + 1e-9 && CORE.contains(g.region, s)));
  for (const c of outermost(open)) sh.holes.push(shapeOf(c, T.Path));
  const geo = new T.ShapeGeometry(sh, 48);
  geo.rotateX(-Math.PI/2); geo.translate(0, g.floor + 0.004, 0);
  const f = S.feats.find(x => x.id === id);
  const mat = new T.MeshBasicMaterial({ color: new T.Color(TYPES[f.type].c), transparent: true, opacity: 0.5,
    depthWrite: false, side: T.DoubleSide, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    clippingPlanes: state.cut ? [CUT_PLANE] : [] });
  const m = new T.Mesh(geo, mat);
  m.visible = false; m.userData.noShadow = true; m.userData.ownMat = true;
  return m;
}
function fillSampleOptions(){
  const keys = CORE.available(B);
  $('sampleSel').innerHTML = keys.map(k => `<option value="${k}">${CORE.DEFS[k].name}</option>`).join('') + '<option value="none">No part (in hand)</option>';
  if (state.sampleKey !== 'none' && !keys.includes(state.sampleKey)) state.sampleKey = 'slot';
  $('sampleSel').value = state.sampleKey;
}
function removeSample(){
  if (!partG) return;
  const set = new Set(); partG.traverse(o => set.add(o));
  const keep = pickables.filter(p => !set.has(p)); pickables.length = 0; pickables.push(...keep);
  disposeTree(partG); root.remove(partG);
  partG = null; partMesh = null; capMesh = null; floorHL = {};
  gbKey = '*';
}
function newSample(key, keepSel){
  state.sampleKey = key;
  const prevSel = state.sample && state.sample.sel;
  removeSample();
  state.seq = null; state.partTarget = null;
  if (key === 'none' || !CORE.DEFS[key]){
    state.sample = null; state.ev = CORE.evalAt(null); state.lifted = true;
    renderFeats(); resize(); placeLights(); updateAll(); syncReveal(); return;
  }
  const S = CORE.makeSample(key, B, Math.random);
  S.guesses = {}; S.revealed = S.ref;
  const valid = S.feats.filter(f => f.valid);
  S.sel = keepSel && valid.some(f => f.id === prevSel) ? prevSel : (valid[0] || S.feats[0]).id;
  state.sample = S;
  partG = new T.Group(); root.add(partG);
  const geo = partGeometry(S);
  // one continuous finish over the whole part: texture laid on by position, so the stacked layers don't show
  if (geo){
    const P = geo.attributes.position, N = geo.attributes.normal, uv = geo.attributes.uv;
    for (let i = 0; i < P.count; i++){
      const nx = Math.abs(N.getX(i)), ny = Math.abs(N.getY(i)), nz = Math.abs(N.getZ(i));
      if (ny >= nx && ny >= nz) uv.setXY(i, P.getX(i)*1.5, P.getZ(i)*1.5);
      else if (nx >= nz) uv.setXY(i, P.getZ(i)*1.5, P.getY(i)*1.5);
      else uv.setXY(i, P.getX(i)*1.5, P.getY(i)*1.5);
    }
    uv.needsUpdate = true;
  }
  if (geo){
    partMesh = new T.Mesh(geo, PM[S.mat] || PM.milled);
    partMesh.castShadow = partMesh.receiveShadow = true;
    partG.add(pickable(partMesh, 'part'));
  }
  if (S.label){
    const lb = label(S.label, 0.12, '#2a2e33');
    lb.position.set(-0.85, S.top - 0.3, 0.702);
    partG.add(lb);
  }
  floorHL = {}; floorLit = null;
  if (partMesh){
    if (partMesh.geometry.index) partMesh.geometry = partMesh.geometry.toNonIndexed();
    const g = partMesh.geometry, n = g.attributes.position.count;
    g.setAttribute('color', new T.BufferAttribute(new Float32Array(n*3).fill(1), 3));
    S.feats.forEach(f => { const r = floorTris(S, f.id, g); if (r && r.tris.length) floorHL[f.id] = r; });
  }
  state.lifted = false;
  state.px = S.halfX + 2.2; state.pz = 0;
  partG.position.set(state.px, 0, state.pz);
  refreshEval();
  if (state.cut) updateSection();
  state.micY = seatY();
  resize(); placeLights();
  renderFeats();
  renderer.shadowMap.needsUpdate = true;
  syncReveal();
}
/* ---------- gage blocks under an overhanging base ----------
   With only one end of the base on the part it would tip, so, as in the shop, a stack of gage blocks is
   wrung together under the other end. The stack is built the way you would from a real set: biggest
   blocks first, down to the thousandth (3.147″ = 3″ + .125″ + .020″ + .002″). */
const GB_SIZES = [4000, 3000, 2000, 1000, 500, 250, 125, 100, 50, 20, 10, 5, 2, 1];   // thousandths
const GB_X = 0.354, GB_Z = 1.378;                                                    // 9 x 35 mm blocks
// two finishes, alternated, so neighbouring blocks read as separate pieces
const gbMats = [std({ color: 0xd6d9dd, metalness: 1, roughness: 0.2 }), std({ color: 0xbfc4ca, metalness: 1, roughness: 0.32 })];
const gbSeam = std({ color: 0x15171a, metalness: 0.2, roughness: 0.8 });
let gbList = '';
// a block with its edges broken, as real gage blocks are, so every edge catches the light
function gbGeom(h){
  const b = Math.min(0.014, h*0.22);
  if (b < 0.001 || h - 2*b <= 1e-4) return new T.BoxGeometry(GB_X, h, GB_Z);
  const sh = new T.Shape();
  sh.moveTo(-GB_X/2 + b, b); sh.lineTo(GB_X/2 - b, b); sh.lineTo(GB_X/2 - b, h - b); sh.lineTo(-GB_X/2 + b, h - b); sh.closePath();
  const g = new T.ExtrudeGeometry(sh, { depth: GB_Z - 2*b, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: 2 });
  g.translate(0, -h/2, -GB_Z/2 + b);
  return g;
}
let gbG = null, gbKey = '';
function gbStackFor(h){
  let r = Math.floor(h*1000 + 1e-6); const out = [];
  for (const sz of GB_SIZES) while (r >= sz){ out.push(sz); r -= sz; }
  return out;
}
const gbName = t => t >= 1000 ? (t/1000) + '″' : '.' + String(t).padStart(3, '0') + '″';
function updateGageBlocks(){
  const S = state.sample, ev = state.ev;
  let want = null;
  if (S && ev && ev.onPart && seated()){
    const sup = CORE.support(S, state.px, state.pz, ev.hb);
    if (sup.l !== sup.r){
      const side = sup.l ? 1 : -1, cx = side*(CORE.BASE_HX - GB_X/2 - 0.03);
      // it stands on whatever is below that end: the highest point under its footprint
      let floor = 0;
      for (let i = 0; i <= 4; i++) for (let j = 0; j <= 6; j++){
        const x = cx - GB_X/2 + i*GB_X/4, z = -GB_Z/2 + j*GB_Z/6;
        floor = Math.max(floor, CORE.heightAt(S, x - state.px, z - state.pz));
      }
      const sizes = gbStackFor(ev.hb - floor);
      if (sizes.length) want = { cx, floor, sizes };
    }
  }
  // in practice the sizes etched on the blocks would give the answer away, so they stay blank until the reading is checked
  const sizesShown = !state.practice || state.pRevealed;
  const warn = $('gbWarn');
  if (warn.hidden === !!want){ warn.hidden = !want; queueLayout(); }
  const key = want ? [want.cx, want.floor.toFixed(4), want.sizes.join(','), sizesShown].join('|') : '';
  gbList = want && sizesShown ? want.sizes.map(gbName).join(' + ') : '';
  if (key === gbKey) return;
  gbKey = key;
  if (gbG){ root.remove(gbG); disposeTree(gbG); gbG = null; }
  if (!want) { invalidate(); return; }
  gbG = new T.Group(); root.add(gbG);
  let y = want.floor;
  want.sizes.forEach((t, i) => {
    const hgt = t/1000;
    const b = new T.Mesh(gbGeom(hgt), gbMats[i % 2]);
    b.position.set(want.cx, y + hgt/2, 0); b.castShadow = b.receiveShadow = true;
    gbG.add(b);
    // the wrung joint between two blocks shows as a fine dark line
    if (i){ const sm = new T.Mesh(new T.BoxGeometry(GB_X + 0.003, 0.0035, GB_Z + 0.003), gbSeam); sm.position.set(want.cx, y, 0); gbG.add(sm); }
    // the size is etched on the face of every block big enough to carry it
    if (hgt >= 0.09 && sizesShown){
      const lb = label(gbName(t), Math.min(0.07, hgt*0.55), '#30343a');
      lb.position.set(want.cx, y + hgt/2, GB_Z/2 + 0.002);
      gbG.add(lb);
    }
    y += hgt;
  });
  renderer.shadowMap.needsUpdate = true;
  invalidate();
}
Object.values(PM).forEach(m => { m.vertexColors = true; });
// every floor of the part: the up-facing triangles at that floor's height inside its outline
function floorTris(S, id, geo){
  const g = S.geo[id];
  if (!g || !g.region || Math.abs(g.region.x1 - g.region.x0) > 8) return null;   // the surface plate has no outline
  const P = geo.attributes.position, N = geo.attributes.normal, out = [];
  for (let t = 0; t < P.count; t += 3){
    if (N.getY(t) < 0.99 || N.getY(t + 1) < 0.99 || N.getY(t + 2) < 0.99) continue;
    const y = (P.getY(t) + P.getY(t + 1) + P.getY(t + 2))/3;
    if (Math.abs(y - g.floor) > 1e-4) continue;
    const cx = (P.getX(t) + P.getX(t + 1) + P.getX(t + 2))/3, cz = (P.getZ(t) + P.getZ(t + 1) + P.getZ(t + 2))/3;
    if (CORE.inside(g.region, cx, cz)) out.push(t);
  }
  const f = S.feats.find(x => x.id === id);
  const c = new T.Color(TYPES[f.type].c).lerp(new T.Color(1, 1, 1), 0.15);
  return { tris: out, col: c };
}
let floorLit = null;
function paintFloor(id){
  if (!partMesh || floorLit === id) return;
  const C = partMesh.geometry.attributes.color;
  if (!C) return;
  const set = (f, c) => { if (f) for (const t of f.tris) for (let k = 0; k < 3; k++) C.setXYZ(t + k, c.r, c.g, c.b); };
  const white = new T.Color(1, 1, 1);
  if (floorLit && floorHL[floorLit]) set(floorHL[floorLit], white);
  if (id && floorHL[id]) set(floorHL[id], floorHL[id].col);
  floorLit = id; C.needsUpdate = true;
  invalidate();
}
function refreshEval(){
  state.ev = CORE.evalAt(state.sample, state.px, state.pz);
  updateFloorHL();
}
function updateFloorHL(){
  const feat = state.ev && state.ev.feat && state.hl.outline !== false ? state.ev.feat : null;
  paintFloor(feat);
}
/* ---------- "Reveal inside": cut the part straight down the middle, by length or by width ---------- */
const HIDDEN_INSIDE = ['pocket', 'cbore'];            // parts whose feature can't be seen from outside
function syncReveal(){
  const btn = $('revealInside'); if (!btn) return;
  btn.disabled = !state.sample;
  btn.classList.toggle('bounce', !!state.sample && HIDDEN_INSIDE.includes(state.sampleKey) && !state.cut);
  document.querySelectorAll('[data-cutdir]').forEach(b => { b.disabled = !state.sample; b.setAttribute('aria-pressed', String((state.cut && state.secAxis === b.dataset.cutdir) || pendingCut === b.dataset.cutdir)); });
}
function revealInside(axis){
  if (!state.sample) return;
  state.secAxis = axis || (state.cut ? state.secAxis : '+z');
  state.secT = rodCutT(state.secAxis); state.cut = true;
  applyCut();
  toast(state.secAxis[1] === 'z' ? 'Cut in half by length' : 'Cut in half by width');
}
function applyCut(){
  queueMicrotask(syncReveal);
  const planes = state.cut ? [CUT_PLANE] : [];
  // switching the section on or off plays the disintegrate / rebuild; while it runs the shader does the cutting
  if (state.cut !== cutShown){
    cutShown = state.cut;
    if (state.cut) pendingCut = null;   // switched on some other way: a queued side switch no longer applies
    Object.values(PM).forEach(m => SecFx.attach(m));
    if (state.sample && state.cut) updateSection();
    SecFx.start(state.cut, { root: () => state.sample && partG ? partG : null, redraw: () => { renderer.shadowMap.needsUpdate = true; invalidate(); }, done: () => { applyCut(); if (pendingCut) runPendingCut(); } });
  }
  const fx = SecFx.running();
  Object.values(PM).forEach(m => { m.clippingPlanes = fx ? [] : planes; m.needsUpdate = true; });
  if (capMesh) capMesh.visible = state.cut || fx === 'build';
  $('cutBtn').setAttribute('aria-pressed', String(state.cut));
  $('sectionChk').checked = state.cut;
  $('cutT').disabled = !state.cut;
  $('cutT').value = String(Math.round(state.secT*100));
  if (!state.cut) $('cutNote').textContent = 'Switch it on and pick Front or Side to choose where it cuts in from, then slide: the part dissolves away in that direction and the cut face is hatched.';
  else if (state.sample) $('cutNote').textContent = `Cutting in from ${SEC_LABEL[state.secAxis]} — slide to take more or less away, or pick the other side.`;
  updateSection();
  renderer.shadowMap.needsUpdate = true;
  invalidate();
}

/* ---------- mechanism ---------- */
const ext = () => B + state.reading;                    // how far the rod reaches below the base
function seatY(){
  const ev = state.ev || CORE.evalAt(null);
  return Math.max(ev.hb, ev.hr + ext());
}
function liftY(){ return partTop() + ext() + 0.35; }
const settled = () => !state.lifted && Math.abs(state.micY - seatY()) < 1e-4;
// the deepest the rod can go with the base still seated
function extLimit(){
  if (!settled()) return Infinity;
  const ev = state.ev || CORE.evalAt(null);
  return ev.hb - ev.hr - B;
}
const seated = () => settled() && state.micY <= (state.ev ? state.ev.hb : 0) + 1e-5;
const isContact = () => settled() && (state.ev ? state.ev.hr : 0) + ext() >= (state.ev ? state.ev.hb : 0) - 1e-6;
const measuredDepth = () => state.ev ? state.ev.hb - state.ev.hr : 0;
const showAnsDepth = () => seated() && isContact();

const flashLocked = () => toast('The rod clamp is on — twist the knurled ring above the base to release it');

/* ---------- fine adjust: every control moves about ten times slower, for hairline settings ---------- */
let fineOn = false;
const FINE_K = 0.1;
function setFine(v){
  fineOn = v;
  ['fineBtn', 'fineQuick'].forEach(id => { const b = $(id); if (b) b.setAttribute('aria-pressed', String(v)); });
  const em = $('fineBtn').querySelector('em'); if (em) em.textContent = v ? 'on' : 'off';
  
  toast(v ? 'Fine adjust on — the thimble, ratchet and arrow keys move about 10× slower' : 'Fine adjust off');
}
function tryTurn(dR, mode){
  if (state.locked){ flashLocked(); return false; }
  const lim = extLimit();
  if (mode === 'thimble' && dR > 0){
    if (state.coach) return false;
    if (state.coachOn && state.coachArmed && lim !== Infinity && state.reading + dR > lim - 0.003){
      state.reading = Math.min(state.reading + dR, Math.max(state.reading, lim - 0.003));
      startCoach(); return false;
    }
  }
  let nr = state.reading + dR, blocked = false;
  const top = Math.min(1, Math.max(state.reading, lim));
  if (nr > top){
    const over = nr - top; nr = top; blocked = true;
    if (mode === 'ratchet'){
      const ang = over*TPI*TAU;
      state.ratchetExtra += ang; state.slipAcc += ang;
      while (state.slipAcc > 0.45){ state.slipAcc -= 0.45; clickSound(); state.clicks++; }
    } else if (mode === 'thimble'){
      toast(lim <= 1 ? 'The rod is on the floor — use the ratchet for consistent pressure' : 'End of travel: this rod only moves 1″');
    }
  }
  if (nr < 0){ nr = 0; blocked = true; }
  state.reading = Math.round(nr*1e7)/1e7;
  return !blocked;
}
const stopAnim = () => { state.anim = null; };
function goTo(v, quiet){
  if (state.locked){ flashLocked(); return; }
  v = Math.max(0, Math.min(1, v));
  const lim = extLimit();
  if (v > lim + 1e-7 && lim !== Infinity){
    if (!quiet) toast(lim < 0 ? 'This rod is already too long for that surface' : `The floor is in the way — the deepest reading here is ${(B + Math.max(0, lim)).toFixed(3)}″`);
    v = Math.max(0, Math.min(v, lim));
  }
  state.anim = { type: 'to', target: v };
}
function ratchetClose(){
  if (state.locked){ flashLocked(); return; }
  endCoach(); state.clicks = 0; state.slipAcc = 0;
  state.anim = { type: 'ratchet' };
}
function setLock(v){
  state.locked = v;
  $('lockBtn').setAttribute('aria-pressed', String(v));
  $('lockBtn').textContent = v ? 'Unlock rod' : 'Lock rod';
  const lq = $('lockQuick');
  lq.setAttribute('aria-pressed', String(v));
  lq.setAttribute('aria-label', v ? 'Unlock rod' : 'Lock rod');
  lq.dataset.tip = v ? 'Unlock rod\nThe rod clamp is on. Twist the ring back so the rod can move.' : 'Lock rod\nTwists the knurled clamp ring so the rod can’t move. The ring turns red while locked.';
  lockHulls.forEach(h => h.visible = v);
  paintLock(lockParts, v);
  renderer.shadowMap.needsUpdate = true;
  invalidate();
  if (v){ stopAnim(); state.seq = null; }
  toast(v ? 'Rod clamped' : 'Rod released');
}

/* ---------- moving the part ---------- */
function movePartTo(x, z){
  if (!state.sample) return;
  const lx = state.sample.halfX + 3.2, lz = state.sample.halfZ + 2;
  state.px = Math.max(-lx, Math.min(lx, x));
  state.pz = Math.max(-lz, Math.min(lz, z));
  partG.position.set(state.px, 0, state.pz);
  refreshEval();
  if (state.cut) updateSection();
  renderer.shadowMap.needsUpdate = true;
  invalidate();
}
/* sequence: back the rod off → lift → slide → set down → run the ratchet in */
function goToFeature(id, close){
  const S = state.sample; if (!S) return;
  const t = S.targets[id]; if (!t) return;
  endCoach();
  if (state.locked) setLock(false);
  stopAnim();
  S.sel = id; renderFeats();
  state.seq = { stage: 'retract', id, close, x: -t[0], z: -t[1] };
}
function stepSeq(){
  const q = state.seq;
  if (!q || !state.sample){ state.seq = null; return; }
  // measure where the part was set (or where it is being held still): back the rod off, sit down, run it in
  if (q.stage === 'here'){
    if (state.reading > 1e-7 && !state.locked){ if (!state.anim) goTo(0, true); return; }
    if (state.anim) return;
    state.lifted = false; q.stage = 'lower'; q.close = !state.locked; q.quiet = true; return;
  }
  if (q.stage === 'retract'){
    if (state.reading > 1e-7){ if (!state.anim) goTo(0, true); return; }
    if (state.anim) return;
    q.stage = 'lift';
  }
  if (q.stage === 'lift'){
    state.lifted = true;
    if (state.micY < liftY() - 2e-3) return;
    state.partTarget = { x: q.x, z: q.z };
    q.stage = 'slide'; return;
  }
  if (q.stage === 'slide'){
    if (state.partTarget) return;
    state.lifted = false;
    q.stage = 'lower'; return;
  }
  if (q.stage === 'lower'){
    if (state.micY > seatY() + 1e-4) return;
    const lim = extLimit();
    if (lim < -1e-6){
      if (!q.quiet) toast(`The ${B}–${B + 1}″ rod is longer than that depth — fit a shorter rod`);
      state.seq = null; return;
    }
    q.stage = 'close';
    if (q.close) ratchetClose(); else { state.seq = null; autoFrame(); return; }
    return;
  }
  if (q.stage === 'close' && !state.anim){
    state.seq = null;
    autoFrame();
    if (!state.practice && isContact()) toast(`Measured ${(B + state.reading).toFixed(3)}″`);
  }
}

/* ---------- units: inches by default, millimeters on request ---------- */
let units = 'in';
try { units = localStorage.getItem('pt-units') === 'mm' ? 'mm' : 'in'; } catch (e) {}
const MM_STEPS = [-2,-0.5,-0.02,2,0.5,0.02];
// the Go to hint: an example inside this range, in the unit a plain number is read as
// the depth micrometer's scales are inch only, so Go to takes inches whatever the units buttons say, and says so
const goHint = () => `Inches only: ${(B + 0.625).toFixed(3)}`;
const unitOf = s => { const t = String(s).trim(); return /(mm|millimet(er|re)s?)\.?$/i.test(t) ? 'mm' : /(["″]|in(ch(es)?)?\.?)$/i.test(t) ? 'in' : null; };
const numOf = s => parseFloat(String(s).replace(',', '.').replace(/[^0-9.\-]+/g, ' ').trim());
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
  if (st) st.placeholder = goHint();   // the hint says which unit a plain number means
}
const inputInches = s => { const n = parseIn(s); return units === 'mm' ? n/25.4 : n; };

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
function autoMeasure(){
  const S = state.sample;
  if (!S){ toast('Choose a part first'); return; }
  const det = state.ev && state.ev.feat;
  if (det && seated()){ S.sel = det; renderFeats(); endCoach(); if (state.locked) setLock(false); ratchetClose(); return; }
  goToFeature(S.sel, true);
}
function slideOut(){
  const S = state.sample; if (!S) return;
  endCoach();
  const out = state.sample.halfX + 2.2;
  state.seq = { stage: 'retract', id: null, close: false, quiet: true, x: state.px > 0 ? out : -out, z: 0 };
}

/* ---------- screen tags: examination labels and correction arrows ---------- */
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
// anchors are given in micrometer-local heights and lifted by the current base height
const cylAnchor = (y, r, t) => ({ p: new T.Vector3(r*Math.sin(t), state.micY + y, r*Math.cos(t)), n: new T.Vector3(Math.sin(t), 0, Math.cos(t)) });
const edgeY = () => Y_ZERO - state.reading;
const EXAM = [
  ['Base', 'Reference face, 2.5″ × .63″, lapped flat', () => ({ p: new T.Vector3(-0.95, state.micY + 0.12, BASE_D/2), n: new T.Vector3(-0.4, 0.15, 1).normalize() })],
  ['Measuring rod', 'ø.157″, lapped end, swaps in 1″ steps', () => ({ p: new T.Vector3(0, state.micY - ext()*0.55, ROD_R), n: new T.Vector3(0.4, -0.2, 1).normalize() })],
  ['Rod size', '', () => cylAnchor(edgeY() + RAT_TOP - 0.07, NUT_R, -0.7)],
  ['Rod clamp', 'The knurled ring: twist it to hold the reading', () => cylAnchor(19.8*IN, 7.2*IN, -0.6)],
  ['Sleeve (barrel)', 'Fixed; carries the main scale', () => cylAnchor((SLV_BOT + Y_ZERO)/2 - 0.1, SLV_R, -1.25)],
  ['Index line', 'The thimble is read against this line', () => cylAnchor(edgeY() - 0.22, SLV_R, 0)],
  ['Main scale', 'Reversed: numbers count toward the base', () => cylAnchor(Math.min(edgeY() + 0.35, Y_ZERO - 0.1), SLV_R, -0.55)],
  ['Thimble', 'Turn to run the rod down', () => cylAnchor(edgeY() + 1.0, KN_R, -0.85)],
  ['Thimble scale', '25 lines, 0.001″ each; one turn is 0.025″', () => cylAnchor(edgeY() + 0.12, GRAD_R, 0.6)],
  ['Ratchet stop', 'Seats the rod with the same force every time', () => cylAnchor(edgeY() + 1.82, RAT_R, -0.5)],
  ['Rod nut', 'Unscrew it to change rods', () => cylAnchor(edgeY() + RAT_TOP - 0.05, NUT_R, 0.8)],
  ['Surface plate', 'Everything is measured from a flat reference', () => ({ p: new T.Vector3(-2.6, 0, 1.4), n: new T.Vector3(-0.2, 1, 0.3).normalize() })]
];
let examTags = [], errTags = {}, errArrows = {}, examLabels = true;
function setExam(on){
  state.exam = on;
  document.body.classList.toggle('exam', on);
  if (on){
    if (state.practice) setPractice(false);
    endCoach(); closeTut();
    examTags = EXAM.map(([title, sub]) => { const t = makeTag(false); t.b.textContent = title; t.sm.textContent = sub; return t; });
    examTags[2].sm.textContent = `This rod reads ${B}.000″ to ${B + 1}.000″`;
    setSpin(true); setLabels(true);
    setTimeout(() => setView('iso'), 60);
  } else {
    examTags.forEach(dropTag); examTags = [];
    setSpin(false); setLabels(true);
    setTimeout(() => setView('iso'), 60);
  }
  invalidate();
}
function setSpin(on){ controls.autoRotate = on; controls.autoRotateSpeed = 0.8; $('spinBtn').setAttribute('aria-pressed', String(on)); invalidate(); }
function setLabels(on){ examLabels = on; $('labelsBtn').setAttribute('aria-pressed', String(on)); examTags.forEach(t => { t.dot.hidden = t.box.hidden = !on; t.ln.style.display = on ? '' : 'none'; }); invalidate(); }
function makeArrowMesh(color){
  const grp = new T.Group();
  const mat = new T.MeshBasicMaterial({ color: new T.Color(color), depthTest: false, transparent: true, toneMapped: false });
  const out = new T.MeshBasicMaterial({ color: 0x000000, depthTest: false, transparent: true, toneMapped: false });
  const add = (geo, y, m, ro) => { const me = new T.Mesh(geo, m); me.position.y = y; me.renderOrder = ro; me.userData.noShadow = true; grp.add(me); };
  const cone = new T.ConeGeometry(0.034, 0.075, 20); cone.rotateX(Math.PI);
  const cone2 = new T.ConeGeometry(0.046, 0.097, 20); cone2.rotateX(Math.PI);
  add(cone2, 0.043, out, 10000); add(new T.CylinderGeometry(0.019, 0.019, 0.165, 12), 0.15, out, 10000);
  add(cone, 0.04, mat, 10001); add(new T.CylinderGeometry(0.011, 0.011, 0.15, 12), 0.15, mat, 10001);
  scene.add(grp);
  return grp;
}
const ERR_INFO = {
  inch: ['Rod size', 'var(--muted)', '#c9ced4'],
  a: ['Sleeve number', 'var(--hl-num)', HLC.num],
  b: ['Sleeve line', 'var(--hl-line)', HLC.line],
  c: ['Thimble line', 'var(--hl-thimble)', HLC.thimble]
};
// the counted marks are hidden under the thimble, so the arrows point at the thimble over them
function errAnchor(k){
  const n = Math.round(state.reading*1000), a = Math.floor(n/100), li = Math.floor(n/25), c = n % 25;
  const Rr = SLV_R + 0.004, e = edgeY();
  if (k === 'inch') return Object.assign(cylAnchor(e + RAT_TOP - 0.07, NUT_R, -0.7), { label: `This rod starts at ${B}.000″` });
  const over = y => {
    const d = y - e;
    if (d < -1e-6) return { r: Rr, y };                                   // still showing below the thimble
    if (d < BEVEL) return { r: TH_EDGE_R + (GRAD_R - TH_EDGE_R)*(d/BEVEL) + 0.004, y };
    return { r: GRAD_R + 0.004, y };
  };
  if (k === 'a'){
    const y = Y_ZERO - a*0.1, o = over(y);
    return Object.assign(cylAnchor(o.y, o.r, -(0.098 + 0.03)/Rr), { label: `“${a}” is covered — that is the one that counts` });
  }
  if (k === 'b'){
    const y = Y_ZERO - li*0.025, L = li % 4 === 0 ? 0.098 : (li % 2 === 0 ? 0.075 : 0.055), m = li % 4, o = over(y);
    return Object.assign(cylAnchor(o.y, o.r, -(L*0.7)/Rr), { label: m ? `${m} covered line${m === 1 ? '' : 's'} past “${a}”` : `Right on the “${a}” line` });
  }
  return Object.assign(cylAnchor(e + 0.2, GRAD_R + 0.004, 0), { label: `Line ${c} is at the index` });
}
function syncErr(){
  const want = state.practice && !state.exam ? state.pErr : [];
  for (const k of Object.keys(errTags)) if (!want.includes(k)){
    dropTag(errTags[k]); delete errTags[k];
    scene.remove(errArrows[k]); errArrows[k].traverse(o => { if (o.geometry) o.geometry.dispose(); }); delete errArrows[k];
  }
  for (const k of want) if (!errTags[k]){
    const info = ERR_INFO[k];
    const t = makeTag(true); t.b.textContent = info[0];
    t.box.style.setProperty('--c', info[2]); t.dot.style.setProperty('--c', info[2]);
    t.ln.style.stroke = info[2];
    errTags[k] = t; errArrows[k] = makeArrowMesh(info[2]);
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
function updateOverlays(){
  syncErr();
  const tight = wrap.clientWidth < 560, placed = labelObstacles();   // shorter leaders so labels stay clear of the edges
  if (state.exam && examLabels) EXAM.forEach((e, i) => { const an = e[2](); placeTag(examTags[i], an.p, an.n, tight ? 44 : 70, placed); });
  const k0 = ((camera.top - camera.bottom)/camera.zoom)/3.2, bob = 0.5 + 0.5*Math.sin(time*4);
  for (const k of Object.keys(errTags)){
    const an = errAnchor(k), t = errTags[k];
    t.sm.textContent = an.label;
    placeTag(t, an.p, an.n, tight ? 56 : 90, placed);
    const ar = errArrows[k];
    ar.scale.setScalar(k0);
    ar.quaternion.setFromUnitVectors(UPV, an.n);
    ar.position.copy(an.p).addScaledVector(an.n, 0.004 + bob*0.02*k0);
  }
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
  const wc = $('gbWarn');
  if (!wc.hidden){
    // bottom middle if there's room; otherwise the nearest clear spot, narrower if need be;
    // and if the view is too cramped for it at all, it moves out under the view
    if (wc.parentElement !== wrap){ wrap.appendChild(wc); wc.classList.remove('docked'); }
    const taken = result.map(o => o.r);
    // measure it from the left edge: a box parked at 50% only has half the width to size itself in
    wc.style.left = '0px'; wc.style.top = '0px'; wc.style.bottom = 'auto'; wc.style.transform = 'none';
    let spot = null;
    for (const mw of [440, 380, 320, 260]){
      wc.style.maxWidth = Math.min(mw, W - 2*pad) + 'px';
      const ww = wc.offsetWidth, wh = wc.offsetHeight, span = Math.max(0, W - ww - 2*pad);
      for (let y = H - pad - wh; y >= pad && !spot; y -= 6)
        for (const x of [pad + span/2, pad + span*0.3, pad + span*0.7, pad, pad + span])
          if (!taken.some(r => rectsHit({ x, y, w: ww, h: wh }, r, gap))){ spot = { x, y, w: ww, h: wh }; break; }
      if (spot) break;
    }
    if (spot){
      wc.style.left = Math.round(spot.x) + 'px'; wc.style.top = Math.round(spot.y) + 'px'; wc.style.bottom = 'auto'; wc.style.transform = 'none';
      bots.push(spot); OVL.rects.push(spot);
    } else {
      wc.style.left = wc.style.top = wc.style.bottom = wc.style.transform = wc.style.maxWidth = '';
      $('warnDock').appendChild(wc); wc.classList.add('docked');
    }
  }
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
  flipLayout(() => { OVL.queued = false; placeFlat(); layoutOverlays(); }); queueLayout(); if (typeof invalidate === 'function') invalidate(); drawFlat();
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
let rhPracticeSet = false;
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
  sp.addEventListener('pointerup', e => { if (dragging && state.practice) rhPracticeSet = true; end(e); });
  sp.addEventListener('pointercancel', end);
  sp.addEventListener('dblclick', () => { RH[state.practice ? 'practice' : 'normal'] = state.practice ? 380 : 132; applyRH(); });
  sp.addEventListener('keydown', e => {
    const k = state.practice ? 'practice' : 'normal';
    if (e.key === 'ArrowUp'){ RH[k] += e.shiftKey ? 64 : 16; applyRH(); e.preventDefault(); e.stopPropagation(); }
    else if (e.key === 'ArrowDown'){ RH[k] -= e.shiftKey ? 64 : 16; applyRH(); e.preventDefault(); e.stopPropagation(); }
  });
  window.addEventListener('resize', applyRH);
}

/* ---------- feature cards ---------- */
const fmt = v => (v < 0 ? '−' : '') + Math.abs(v).toFixed(3);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function renderFeats(){
  const box = $('feats'), S = state.sample;
  $('revealBtn').textContent = S && S.revealed ? 'Hide actual' : 'Show actual';
  $('revealBtn').disabled = !S;
  if (!S){ box.innerHTML = '<p class="note" style="margin:8px 0 0">No part selected — the micrometer is held in the air.</p>'; return; }
  box.innerHTML = S.feats.filter(f => f.valid).map(f => {
    const t = TYPES[f.type];
    return `<div class="fcard${S.sel === f.id ? ' sel' : ''}" style="--c:${t.c}">
      <button class="fhead" data-select="${f.id}" aria-pressed="${S.sel === f.id}" title="Measure this feature"><i class="sw" style="--c:${t.c}"></i><span class="fname">${esc(f.label)}</span><span class="ftype">${t.name}</span></button>
      ${S.revealed ? `<div class="fres">Actual ${S.vals[f.id].toFixed(3)}″</div>` : ''}</div>`;
  }).join('') || '<p class="note" style="margin:8px 0 0">No feature on this part is inside this rod’s range — fit another rod.</p>';
}

/* ---------- ratchet reminder ---------- */
// while the ratchet hint shows, the camera swings round to the ratchet stop; "Got it" puts it back where it was
let coachCam = null;
function camNow(){ return { dir: camera.position.clone().sub(controls.target).normalize(), target: controls.target.clone(), zoom: camera.zoom }; }
function tweenCam(to){
  const from = camNow();
  camTween = { t: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0.999 : 0, fromDir: from.dir, fromTarget: from.target, fromZoom: from.zoom, toDir: to.dir, toTarget: to.target, toZoom: to.zoom };
  invalidate();
}
function focusRatchet(){
  if (!coachCam) coachCam = Object.assign(camNow(), { camUser });   // keep the first view saved if it re-aims
  const box = new T.Box3().setFromObject(ratchetG), c = box.getCenter(new T.Vector3());
  const W = el.clientWidth, H = el.clientHeight;
  if (box.isEmpty() || W < 2 || H < 2) return;
  // measure the ratchet on screen at the current zoom, then zoom so it fills about a third of the view
  camera.updateMatrixWorld(true);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity; const q = new T.Vector3();
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]){
    q.set(x, y, z).project(camera); const sx = (q.x + 1)/2*W, sy = (1 - q.y)/2*H;
    x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
  }
  // aim for the biggest patch of the view clear of the buttons and flat view, below the hint card
  const free = freeRects(W, H).reduce((m, r) => r.w*r.h > m.w*m.h ? r : m);
  const card = document.querySelector('.coach').getBoundingClientRect(), box0 = el.getBoundingClientRect();
  const top = Math.max(free.y, card.bottom - box0.top + 12), bottom = free.y + free.h;
  const room = { w: free.w, h: Math.max(bottom - top, free.h*0.4) };
  const s = Math.min(0.5*room.h/Math.max(1, y1 - y0), 0.4*room.w/Math.max(1, x1 - x0));
  const zoom = Math.max(controls.minZoom, Math.min(controls.maxZoom, camera.zoom*s));
  // slide the target so the ratchet lands in the middle of that space rather than the middle of the canvas
  const right = new T.Vector3().setFromMatrixColumn(camera.matrixWorld, 0), up = new T.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
  const a = c.clone().project(camera), bx = c.clone().add(right).project(camera), by = c.clone().add(up).project(camera);
  const kx = Math.abs((bx.x - a.x)/2*W)*(zoom/camera.zoom), ky = Math.abs((by.y - a.y)/2*H)*(zoom/camera.zoom);
  const sx = free.x + free.w/2, sy = Math.min(bottom - room.h/2, Math.max(top + room.h/2, H/2));
  const target = c.clone();
  if (kx > 1e-6) target.addScaledVector(right, (W/2 - sx)/kx);
  if (ky > 1e-6) target.addScaledVector(up, (sy - H/2)/ky);
  tweenCam({ dir: coachCam.dir.clone(), target, zoom });
}
// the view changed size while the hint is up: aim at the ratchet again
window.addEventListener('resize', () => { if (state.coach && coachCam) setTimeout(focusRatchet, 60); });
function restoreCoachCam(){
  if (!coachCam) return;
  const saved = coachCam; coachCam = null;
  tweenCam(saved);
  camUser = saved.camUser;
}
function startCoach(){ if (state.coach) return; state.coach = true; state.coachArmed = false; document.body.classList.add('coaching'); focusRatchet(); invalidate(); }
// restore: true when the hint is dismissed (Got it / Esc); if the ratchet is taken up instead, the view stays on it
function endCoach(restore){ if (!state.coach) return; state.coach = false; document.body.classList.remove('coaching'); if (restore) restoreCoachCam(); else coachCam = null; invalidate(); }

/* ---------- tutorial ---------- */
function openTut(){ $('tut').hidden = false; $('tutClose').focus({ preventScroll: true }); $('tut').scrollTop = 0; }
function closeTut(){
  if ($('tut').hidden) return;
  $('tut').hidden = true;
  try { localStorage.setItem('depthmic-tutorial-seen', '1'); } catch (e) {}
}

/* ---------- practice ---------- */
const showAns = () => !state.practice || state.pRevealed;
let lastPracticeKey = '';
function setPractice(on){
  setTimeout(autoFrame, 400);   // the answer panel changes the size of the view
  if (on && !rhPracticeSet){
    const mh = document.querySelector('main').clientHeight;
    RH.practice = Math.max(200, Math.min(380, mh - 400));
  }
  state.practice = on; state.pRevealed = false; state.pErr = []; flatKey = '';
  document.body.classList.toggle('practice', on);
  applyRH();
  $('practiceBtn').setAttribute('aria-pressed', String(on));
  $('practiceBtn').dataset.tip = on ? 'Stop practicing\nShows the answers and the reading breakdown again.' : 'Practice reading\nHides the answers, picks a random rod and part, and puts an answer box in the reading bar.';
  updateAll();
  if (on) loadPractice();
}
function loadPractice(){
  let nb = Math.floor(Math.random()*6);
  if (nb === B) nb = (nb + 1 + Math.floor(Math.random()*5)) % 6;
  if (state.locked) setLock(false);
  endCoach();
  setRange(nb);
  const all = CORE.available(B).filter(k => !CORE.DEFS[k].ref);
  const keys = all.filter(k => k !== lastPracticeKey);
  const pool = keys.length ? keys : all;
  const key = pool[Math.floor(Math.random()*pool.length)];
  lastPracticeKey = key;
  newSample(key);
  $('sampleSel').value = key;
  const valid = state.sample.feats.filter(f => f.valid);
  const f = valid[Math.floor(Math.random()*valid.length)];
  goToFeature(f.id, true);
  state.pRevealed = false; state.pErr = []; flatKey = ''; updateAll();
  $('guess').value = '';
  $('feedback').innerHTML = `<p class="pintro">Read the <b>${B}–${B + 1}″</b> depth micrometer, type the reading and press <b>Check</b>. Remember the sleeve runs backwards. Score ${state.pScore.right}/${state.pScore.total}.</p>`;
  setTimeout(() => $('guess').focus({ preventScroll: true }), 50);
}
function splitReading(n){
  const inch = Math.floor(n/1000); let r = n - inch*1000;
  const a = Math.floor(r/100); r -= a*100;
  const b = Math.floor(r/25);
  return { inch, a, b, c: r - b*25 };
}
const pickOne = a => a[Math.floor(Math.random()*a.length)];
function explainReading(you, ans){
  const A = splitReading(ans), Y = splitReading(Math.max(0, you));
  const f3 = n => (n/1000).toFixed(3) + '″';
  const notes = [], why = {};
  const ratio = ans ? you/ans : 0, lg = ratio > 0 ? Math.log10(ratio) : NaN;
  if (Number.isFinite(lg) && Math.round(lg) !== 0 && Math.abs(lg - Math.round(lg)) < 1e-9){
    notes.push({ icon: 'fa-heart', title: 'You read every scale correctly — only the decimal point wandered', text: `Every digit you found is right, which is the hard part. Inch depth readings are written with three decimal places, so this one is ${f3(ans)}. That’s a tiny fix!` });
    return { A, Y, notes, why, decimal: true };
  }
  if (you < B*1000 || you > (B + 1)*1000)
    notes.push({ icon: 'fa-ruler', title: 'A quick range check', text: `The ${B}–${B + 1}″ rod can only read between ${B}.000″ and ${B + 1}.000″. Checking which rod is fitted first is a great habit — it catches slips like this before they happen.` });
  if (Y.inch === A.inch && Y.a === A.a + 1 && Y.b === 0)
    notes.push({ icon: 'fa-arrows-up-down', title: 'This is the classic depth-micrometer trap', text: `On an outside micrometer you read the scale that is <i>showing</i>. Here the numbers run toward the base and the thimble <i>covers</i> the reading as the rod goes down, so “${Y.a}” is the next number the rod hasn’t reached yet. Everything under the thimble is what counts.` });
  if (Math.abs(you - ans) <= 25 && Y.inch === A.inch && (Y.a !== A.a || Y.b !== A.b))
    notes.push({ icon: 'fa-rotate', title: 'You were incredibly close', text: `Only ${f3(Math.abs(you - ans))} away. The thimble had just rolled past 0, which covers a new sleeve line and restarts the thimble count. Almost everyone trips on this at first.` });
  if (Y.inch !== A.inch) why.inch = `Easy to forget! The ${B}–${B + 1}″ rod puts ${A.inch}.000″ under everything the scales show.`;
  if (Y.a !== A.a){
    why.a = Y.a === A.a + 1 ? `“${Y.a}” is the first number still showing below the thimble, so the rod hasn’t reached it. The last number the thimble has <b>covered</b> is “${A.a}” — that’s the one that counts.`
      : Y.a === A.a - 1 ? `“${A.a}” is covered too — look at how far the thimble edge has traveled past it. Covered numbers count on a depth micrometer.`
      : `Follow the thimble edge down the sleeve: the last number it has covered is “${A.a}”. The arrow points at where it sits under the thimble.`;
  }
  if (Y.b !== A.b){
    why.b = Y.b > A.b ? `You’re counting carefully, which is exactly right. One more step: a line only counts once the thimble edge has actually passed it, so ${A.b} ${A.b === 1 ? 'line is' : 'lines are'} covered here.`
      : `The short lines are easy to overlook. Every covered line after the number is worth 0.025″, and there ${A.b === 1 ? 'is' : 'are'} ${A.b} here.`;
  }
  if (Y.c !== A.c){
    why.c = Y.c === A.c + 1 ? `So close! Line ${Y.c} hasn’t reached the index line yet. The last one that has is ${A.c}.`
      : Y.c === A.c - 1 ? `Nearly! Line ${A.c} has already reached the index line, so it counts. You were reading one line early.`
      : Math.abs(Y.c - A.c) >= 20 ? `The thimble starts again at 0 on every turn, which can feel backwards at first. That full turn already lives in the sleeve lines, so the thimble reads ${A.c}.`
      : `Follow the index line straight across onto the thimble — it lands on line ${A.c}. The arrow points right at it.`;
  }
  return { A, Y, notes, why };
}

/* ---------- small diagrams ---------- */
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

// sleeve drawn flat: the base is to the right, and the thimble covers everything left of its edge
function vizFor(k, A, Y, n){
  const W = 280, H = 76, v = new Viz(W, H);
  if (k === 'a' || k === 'b'){
    const rem = n % 1000 - A.a*100;
    const sp = k === 'a' ? 60 : 46, x0 = k === 'a' ? 96 : 40;
    const edge = k === 'a'
      ? x0 + (rem/100)*sp + 16
      : x0 + A.b*sp + 14 + ((rem - A.b*25)/25)*(sp - 26);
    v.surface(`<rect x="0" y="0" width="${W}" height="${H}" fill="${VZ.metal}"/>`);
    v.line(0, 50, W, 50, VZ.ink, 1.4);
    if (k === 'a'){
      for (const num of [A.a - 1, A.a, A.a + 1]){
        if (num < 0 || num > 10) continue;
        const x = x0 + (num - A.a)*sp, isA = num === A.a, isY = num === Y.a, covered = x < edge;
        const col = isA ? VZ.ok : isY ? VZ.bad : covered ? '#c3c7cd' : VZ.ink;
        v.line(x, 50, x, 30, col, isA || isY ? 2.2 : 1.6);
        v.text(num, x, 15, { col, size: isA || isY ? 13 : 12, maxShift: 4 });
      }
    } else {
      v.line(x0, 50, x0, 24, VZ.ink, 1.8);
      v.text(`“${A.a}”`, x0, 12, { size: 12, maxShift: 6 });
      for (let i = 1; i <= 4; i++){
        const x = x0 + i*sp, L = i % 4 === 0 ? 26 : i % 2 === 0 ? 20 : 14;
        const counted = i <= A.b, yours = i > A.b && i <= Y.b;
        if (x > W - 20) continue;
        v.line(x, 50, x, 50 - L, counted ? VZ.ok : yours ? VZ.bad : '#9aa0a8', counted || yours ? 2.4 : 1.2, yours ? '3 2' : '');
      }
    }
    // the thimble, drawn see-through so the covered marks still read
    v.surface(`<rect x="0" y="0" width="${edge}" height="${H}" fill="#4a4f57" fill-opacity=".62"/>`);
    v.surface(`<line x1="${edge}" y1="0" x2="${edge}" y2="${H}" stroke="${VZ.edge}" stroke-width="2"/>`);
    if (k === 'a'){
      for (const num of [A.a, Y.a]){
        if (num == null || num < 0 || num > 10 || Math.abs(num - A.a) > 1) continue;
        const x = x0 + (num - A.a)*sp, isA = num === A.a, col = isA ? VZ.ok : VZ.bad;
        v.rect(x - 14, 4, 28, 22, `rx="4" fill="#0c0d0f" stroke="${col}" stroke-width="2"${isA ? '' : ' stroke-dasharray="4 3"'}`, 'nb' + num);
        v.text(num, x, 15, { col, size: 13, inside: 'nb' + num, maxShift: 0, noHalo: true });
        v.text(isA ? 'Covered — counts' : (x < edge ? 'Covered' : 'Not reached yet'), x, 64, { col, size: 9.5, weight: 500, halo: '#3a3f46', maxShift: 8 });
      }
    } else {
      for (let i = 1; i <= 4; i++){
        const x = x0 + i*sp;
        if (x > W - 20) continue;
        const counted = i <= A.b, yours = i > A.b && i <= Y.b;
        if (counted){ v.circle(x, 63, 7, `fill="${VZ.ok}"`, 'cc' + i); v.text(i, x, 63.5, { col: '#0b0c0e', size: 9.5, weight: 700, inside: 'cc' + i, maxShift: 0, noHalo: true }); }
        if (yours){ v.circle(x, 63, 7, `fill="none" stroke="${VZ.bad}" stroke-width="1.5"`, 'cy' + i); v.text('×', x, 63, { col: VZ.bad, size: 11, weight: 700, inside: 'cy' + i, maxShift: 0, noHalo: true }); }
      }
    }
    v.text('Thimble', 6, 10, { anchor: 'start', size: 9, col: '#e4e6ea', within: { x: 0, y: 0, w: Math.max(50, edge - 2), h: H }, alts: [[0, 16]], halo: '#3a3f46' });
    v.text('Toward the base →', W - 6, 10, { anchor: 'end', size: 9, col: VZ.mute, within: { x: edge + 2, y: 0, w: W - edge - 2, h: H }, alts: [[0, 16], [0, 30]] });
    return v.render();
  }
  if (k === 'c'){
    const tm = n % 25, sp = 15, iy = H/2;
    v.surface(`<rect x="0" y="0" width="112" height="${H}" fill="${VZ.metal}"/><rect x="112" y="0" width="${W - 112}" height="${H}" fill="#3a3f46"/>`);
    v.line(0, iy, 114, iy, VZ.ink, 1.8);
    const rows = [];
    for (let dv = -3; dv <= 3; dv++){
      const num = ((A.c + dv) % 25 + 25) % 25, y = iy - (A.c + dv - tm)*sp;
      if (y < 6 || y > H - 6) continue;
      const isA = num === A.c, isY = num === Y.c && !isA, big = isA || isY;
      const col = isA ? VZ.ok : isY ? VZ.bad : VZ.ink;
      v.line(114, y, big ? 172 : 150, y, col, big ? 2.6 : 1.2, isY ? '4 3' : '');
      rows.push({ num, y, col, big, isA, isY });
    }
    rows.sort((p, q) => (q.big - p.big));
    for (const r of rows) v.text(r.num, (r.big ? 172 : 150) + 14, r.y, { col: r.col, size: r.big ? 11.5 : 9.5, maxShift: 4, halo: '#3a3f46' });
    for (const r of rows) if (r.isA || r.isY) v.text(r.isA ? 'Correct' : 'Yours', W - 8, r.y, { anchor: 'end', col: r.col, size: 9.5, weight: r.isA ? 600 : 500, maxShift: 6, halo: '#3a3f46' });
    v.text('Index line', 8, iy - 9, { anchor: 'start', col: VZ.mute, size: 9.5, weight: 500, within: { x: 0, y: 0, w: 110, h: H }, alts: [[0, 18]] });
    return v.render();
  }
  const lo = Math.min(A.inch, Y.inch), hi = Math.min(lo + 6, Math.max(A.inch, Y.inch) + 1);
  const span = Math.max(1, hi - lo), xa = 24, xb = W - 24, X = q => xa + (q - lo)/span*(xb - xa), ly = 46;
  v.surface(`<rect x="0" y="0" width="${W}" height="${H}" fill="${VZ.metal}"/>`);
  v.line(xa, ly, xb, ly, '#6d737c', 2);
  for (let q = lo; q <= hi; q++) v.line(X(q), ly - 4, X(q), ly + 4, '#9aa0a8', 1.4);
  v.line(X(A.inch), ly, X(A.inch + 1), ly, VZ.ok, 6);
  v.circle(X(A.inch), ly, 5, `fill="${VZ.ok}"`);
  const my = ly - 8;
  v.path(`M${X(Y.inch)} ${my} l-6 -9 h12 z`, { x: X(Y.inch) - 7, y: my - 10, w: 14, h: 11 }, `fill="${VZ.bad}"`);
  for (let q = lo; q <= hi; q++) v.text(`${q}″`, X(q), ly + 17, { col: q === A.inch ? VZ.ok : q === Y.inch ? VZ.bad : VZ.mute, size: 10, maxShift: 6 });
  v.text('This rod', X(A.inch + 0.5), ly - 14, { col: VZ.ok, size: 10, alts: [[0, -12], [18, -12], [-18, -12]], maxShift: 20 });
  v.text('You started here', X(Y.inch), my - 18, { col: VZ.bad, size: 9.5, weight: 500, alts: [[30, 0], [-30, 0], [0, -6]], maxShift: 30 });
  return v.render();
}

const STEP_DEF = {
  inch: { name: 'Rod size', word: 'rod size', css: '#c9ced4', val: A => A.inch*1000, fmt: v => (v/1000).toFixed(3), det: A => `${A.inch}–${A.inch + 1}″ rod` },
  a: { name: 'Sleeve number', word: 'sleeve number', css: 'var(--hl-num)', val: A => A.a*100, fmt: v => (v/1000).toFixed(3), det: A => `covered number “${A.a}”` },
  b: { name: 'Sleeve lines', word: 'sleeve lines', css: 'var(--hl-line)', val: A => A.b*25, fmt: v => (v/1000).toFixed(3), det: A => `${A.b} covered × 0.025` },
  c: { name: 'Thimble', word: 'thimble reading', css: 'var(--hl-thimble)', val: A => A.c, fmt: v => (v/1000).toFixed(3), det: A => `line ${A.c}` }
};
const STEP_KEYS = ['inch', 'a', 'b', 'c'];
function findMissing(you, ans, A, Y){
  const diff = ans - you;
  if (!diff) return null;
  const src = diff > 0 ? A : Y, other = diff > 0 ? Y : A;
  const keys = STEP_KEYS.filter(k => STEP_DEF[k].val(src) > 0 && STEP_DEF[k].val(other) === 0);
  let best = null;
  for (let m = 1; m < (1 << keys.length); m++){
    const set = keys.filter((_, i) => m & (1 << i));
    const sum = set.reduce((t, k) => t + STEP_DEF[k].val(src), 0);
    if (sum === Math.abs(diff) && (!best || set.length < best.length)) best = set;
  }
  return best ? { type: diff > 0 ? 'missing' : 'extra', keys: best, amount: Math.abs(diff) } : null;
}
const listWords = ks => ks.length === 1 ? ks[0] : ks.slice(0, -1).join(', ') + ' and ' + ks[ks.length - 1];
const parseIn = s => parseFloat(String(s).replace(/[″"in\s]/g, ''));

function checkPractice(){
  const fb = $('feedback'), raw = $('guess').value;
  const g = parseIn(raw);
  if (isNaN(g)){ fb.innerHTML = `<div class="fb-empty"><i class="fa-solid fa-keyboard"></i> Whenever you’re ready, type your reading — for example ${(B + 0.347).toFixed(3)}.</div>`; return; }
  const S = state.sample;
  const target = state.seq && S && state.seq.id ? B + Math.min(1, S.vals[state.seq.id] - B)
    : B + (state.anim && state.anim.type === 'to' ? state.anim.target : state.reading);
  const ans = Math.round(target*1000), you = Math.round(g*1000);
  const sc = state.pScore; sc.total++;
  const ok = you === ans;
  if (ok){ sc.right++; sc.streak++; } else sc.streak = 0;
  const d = (you - ans)/1000;
  const ex = ok ? { A: splitReading(ans), Y: null, notes: [], why: {} } : explainReading(you, ans);
  const A = ex.A, Y = ex.decimal ? null : ex.Y;
  const miss = ok || ex.decimal ? null : findMissing(you, ans, A, ex.Y);
  if (miss) miss.keys.forEach(k => {
    const src = miss.type === 'missing' ? A : ex.Y, v = (STEP_DEF[k].val(src)/1000).toFixed(3);
    const where = {
      inch: `Every reading with this rod starts at ${A.inch}.000″.`,
      a: `The last number the thimble has covered is “${A.a}”, worth ${(A.a/10).toFixed(3)}″.`,
      b: `${A.b === 1 ? 'One line is' : `${A.b} lines are`} covered past the number, and each one is worth 0.025″.`,
      c: `Follow the index line straight across onto the thimble — it lands on line ${A.c}.`
    }[k];
    const none = {
      inch: `This rod starts at ${A.inch}.000″.`,
      a: 'The thimble hasn’t covered a number yet, so the sleeve number adds nothing here.',
      b: 'No line is covered past the number yet, so the lines add nothing here.',
      c: 'The index line sits on thimble line 0, so the thimble adds nothing here.'
    }[k];
    ex.why[k] = miss.type === 'missing'
      ? `You did everything else right — this value just never made it into the total. It’s worth <b>+${v}″</b>. ${where}`
      : `Nearly perfect! This <b>${v}″</b> was added, but it doesn’t belong in this reading. ${none}`;
  });
  const wrong = ok ? [] : STEP_KEYS.filter(k => ex.why[k]);
  state.pRevealed = true;
  state.pErr = ok || ex.decimal ? [] : wrong;
  flatKey = ''; updateAll();
  const nWrong = wrong.length;
  const title = ok
    ? pickOne(['Spot on!', 'Beautifully read!', 'Nailed it!', 'Perfect reading!'])
    : ex.decimal ? 'Your reading is right!'
    : miss ? (miss.type === 'missing' ? 'Just one piece left out — so close!' : 'Just one extra piece — so close!')
    : nWrong <= 1 ? pickOne(['So close — you’ve got this!', 'Almost perfect!', 'Just one small thing!'])
    : pickOne(['Good effort — let’s fine-tune it', 'You’re on the right track', 'Great start — a couple of tweaks']);
  const sub = ok
    ? (sc.streak >= 3 ? `${sc.streak} in a row — you’re really getting the hang of this.` : 'Every scale read correctly. Keep it going!')
    : ex.decimal ? 'Only the decimal point needs moving.'
    : miss ? `Your other ${4 - miss.keys.length} steps were exactly right.`
    : `${nWrong === 1 ? 'Only one step needs' : `${nWrong} steps need`} a second look — you got ${4 - nWrong} of 4 right.`;
  const pct = sc.total ? Math.round(sc.right/sc.total*100) : 0;

  const hero = `<div class="fx-hero ${ok ? 'ok' : ''}">
      <div class="fx-badge"><i class="fa-solid ${ok ? 'fa-check' : miss ? 'fa-puzzle-piece' : 'fa-seedling'}"></i></div>
      <div class="fx-head"><h4>${title}</h4><p>${sub}</p></div>
      <div class="fx-score"><div class="fx-ring" style="--p:${pct}"><span>${pct}%</span></div><div><small>Score</small><b>${sc.right} / ${sc.total}</b><small>${sc.streak ? `🔥 ${sc.streak} in a row` : 'keep going'}</small></div></div>
    </div>`;
  const cmp = ok
    ? `<div class="fx-cmp solo"><div class="fx-num ans"><small>Your reading</small><b>${fmt(ans/1000)}″</b></div></div>`
    : `<div class="fx-cmp"><div class="fx-num you"><small>You entered</small><b>${esc(fmt(you/1000))}″</b></div>
       <div class="fx-delta"><span>${d > 0 ? 'too high by' : 'too low by'}</span><div class="ar"></div><b>${Math.abs(d).toFixed(3)}″</b></div>
       <div class="fx-num ans"><small>Correct reading</small><b>${fmt(ans/1000)}″</b></div></div>`;
  let missBox = '';
  if (miss){
    const k0 = miss.keys[0], words = listWords(miss.keys.map(k => STEP_DEF[k].word));
    const parts = miss.keys.map(k => `${(STEP_DEF[k].val(miss.type === 'missing' ? A : ex.Y)/1000).toFixed(3)}″ ${STEP_DEF[k].word}`).join(' + ');
    missBox = `<div class="fx-miss" style="--c:${STEP_DEF[k0].css}">
      <div class="fx-miss-ic"><i class="fa-solid ${miss.type === 'missing' ? 'fa-puzzle-piece' : 'fa-scissors'}"></i></div>
      <div><h5>${miss.type === 'missing' ? `The ${words} wasn’t added` : `An extra ${words} was added`}</h5>
      <p>${miss.type === 'missing' ? 'Everything else lines up perfectly — adding this one value back in gives the exact answer:' : 'Everything else lines up perfectly — taking this value out gives the exact answer:'}</p>
      <div class="fx-sum"><span>${esc(fmt(you/1000))}″</span><span class="op">${miss.type === 'missing' ? '+' : '−'}</span><span class="add">${parts}</span><span class="op">=</span><span class="res">${fmt(ans/1000)}″</span></div></div></div>`;
  }
  const chips = STEP_KEYS.map(k => {
    const D = STEP_DEF[k], bad = !ok && wrong.includes(k), mk = miss && miss.keys.includes(k);
    const yours = Y ? `${D.fmt(D.val(Y))}″` : '—';
    return `<div class="fx-chip ${bad ? 'bad' : ''} ${mk ? 'miss' : ''}" style="--c:${D.css}">
      ${mk ? `<span class="tag">${miss.type === 'missing' ? 'MISSING' : 'EXTRA'}</span>` : ''}
      <small>${D.name}</small><b>${D.fmt(D.val(A))}″</b><em>${D.det(A)}</em>
      ${ok ? '' : `<span class="yv"><i class="fa-solid ${bad ? 'fa-xmark' : 'fa-check'}"></i>You answered ${yours}</span>`}</div>`;
  }).join('<span class="fx-op">+</span>');
  const eq = `<div class="fx-sec">How the reading adds up</div>
    <div class="fx-eq">${chips}<span class="fx-op">=</span>
      <div class="fx-chip total"><small>Reading</small><b>${fmt(ans/1000)}″</b><em>correct total</em>${ok ? '' : `<span class="yv" style="color:#ff9d94"><i class="fa-solid fa-xmark"></i>You answered ${esc(fmt(you/1000))}″</span>`}</div></div>`;
  const notes = ex.notes.map(nt => `<div class="fx-note"><i class="fa-solid ${nt.icon}"></i><div><b>${nt.title}</b><span>${nt.text}</span></div></div>`).join('');
  const steps = wrong.length ? `<div class="fx-sec">Let’s look closer</div><div class="fx-steps">${wrong.map((k, i) => {
    const D = STEP_DEF[k];
    const yd = k === 'inch' ? `${Y.inch}.000″` : k === 'a' ? `“${Y.a}”` : k === 'b' ? `${Y.b} line${Y.b === 1 ? '' : 's'}` : `line ${Y[k]}`;
    const ad = k === 'inch' ? `${A.inch}.000″` : k === 'a' ? `“${A.a}”` : k === 'b' ? `${A.b} line${A.b === 1 ? '' : 's'}` : `line ${A[k]}`;
    const mk = miss && miss.keys.includes(k);
    return `<article class="fx-step" style="--c:${D.css}">
      <div class="fx-step-h"><span class="num">${i + 1}</span><b>${D.name}</b><span class="chg">${mk && miss.type === 'missing' ? '<s>not added</s>' : `<s>${yd}</s>`}<i class="fa-solid fa-arrow-right"></i><strong>${mk && miss.type === 'extra' ? 'not needed' : ad}</strong></span></div>
      <p>${ex.why[k]}</p>
      <figure>${vizFor(k, A, Y, ans)}<figcaption><span><i style="background:#5fcf8a"></i>correct</span><span><i style="background:#ff7a6e"></i>yours</span></figcaption></figure>
      <div class="fx-step-f"><span><i class="fa-solid fa-location-arrow"></i>${k === 'inch' ? 'Arrow on the rod nut' : 'Arrow on the micrometer and flat view'}</span>
      <button class="fx-show" data-show="${k}"><i class="fa-solid fa-crosshairs"></i>Show me</button></div></article>`;
  }).join('')}</div>` : '';
  const good = !ok && Y ? STEP_KEYS.filter(k => !wrong.includes(k)) : [];
  const goodRow = good.length ? `<div class="fx-sec">What you got right</div><div class="fx-good">${good.map(k => `<span><i class="fa-solid fa-circle-check"></i>${STEP_DEF[k].name}</span>`).join('')}</div>` : '';
  const foot = `<div class="fx-foot"><i class="fa-solid ${ok ? 'fa-star' : 'fa-heart'}"></i><span>${ok
    ? 'Press <b>Next</b> whenever you’d like another one.'
    : 'Every expert has made this exact slip while learning. Take a look at the arrows, then press <b>Next</b> when you feel ready — you’re improving with every try.'}</span></div>`;
  fb.innerHTML = `<div class="fx">${hero}${cmp}${missBox}${notes}${eq}${steps}${goodRow}${foot}</div>`;
  fb.scrollTop = 0;
}

/* ---------- flat (unrolled) sleeve view ---------- */
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
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
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
function flatArrow(g, W, H, tx, ty, dx, dy, col, lab, placed, region) {
  const L = 28, h = 14, R = region || { x: 2, y: 2, w: W - 4, h: H - 4 };
  g.font = '700 10px Inter, Arial, sans-serif'; const w = g.measureText(lab).width + 8;
  const fit = (x, y) => ({ x: clamp(x, R.x, Math.max(R.x, R.x + R.w - w)), y: clamp(y, R.y, Math.max(R.y, R.y + R.h - h)) });
  const others = (placed || []).concat([{ x: tx - 4, y: ty - 4, w: 8, h: 8 }]);
  const hits = b => others.some(q => b.x < q.x + q.w + 3 && q.x < b.x + w + 3 && b.y < q.y + q.h + 3 && q.y < b.y + h + 3);
  const sx = tx + dx * L, sy = ty + dy * L;
  let box = fit(sx - w / 2, sy + (dy < 0 ? -h - 2 : 2));
  if (hits(box)) {
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
function drawFlat(){
  if (!flatOpen) return;
  const n = Math.round(state.reading*1000), show = showAns(), hl = state.hl;
  const key = [n, show, hl.num, hl.line, hl.thimble, state.pErr.join('')].join('|');
  if (key === flatKey) return; flatKey = key;
  const cv = $('flatCv'), g = cv.getContext('2d');
  const W = 260, H = 280, dpr = Math.min(4, (window.devicePixelRatio || 1)*Math.max(1, ($('flatCv').clientWidth || 260)/260));
  if (cv.width !== Math.round(W*dpr)){ cv.width = Math.round(W*dpr); cv.height = Math.round(H*dpr); }
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const k = 900, ey = 122, ix = 176, r = n/1000;
  const Y = d => ey + (d - r)*k;          // d = position on the sleeve, in inches from the 0 line
  const a = Math.floor(n/100), li = Math.floor(n/25), c = n % 25;
  let gr = g.createLinearGradient(0, 0, W, 0);
  gr.addColorStop(0, '#bfc3c8'); gr.addColorStop(0.5, '#e6e9ec'); gr.addColorStop(1, '#c4c8cd');
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  g.lineCap = 'butt';
  const seg = (x0, y0, x1, y1, w, col, dash) => {
    g.save(); if (dash) g.setLineDash(dash);
    g.strokeStyle = col; g.lineWidth = w; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); g.restore();
  };
  const txt = (s, x, y, size, col) => { g.font = `600 ${size}px Inter, Arial, sans-serif`; g.fillStyle = col; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(s, x, y); };
  // index line and the sleeve scale (the covered part is drawn too, then veiled by the thimble)
  seg(ix, 0, ix, H, 1.4, '#111');
  for (let i = 0; i <= 40; i++){
    const y = Y(i*0.025);
    if (y < -12 || y > H + 12) continue;
    const L = i % 4 === 0 ? 58 : i % 2 === 0 ? 44 : 32;
    seg(ix - L, y, ix, y, i % 4 === 0 ? 1.5 : 1.3, '#111');
    if (i % 4 === 0) txt(String(i/4), ix - L - 13, y, 12, '#111');
  }
  // the thimble covers everything above its edge
  g.fillStyle = 'rgba(146,152,160,.78)'; g.fillRect(0, 0, W, ey);
  g.fillStyle = 'rgba(0,0,0,.30)'; g.fillRect(0, ey - 2, W, 2.5);
  // the marks that count are under there: show the highlighted ones through it
  if (show && hl.line){
    const y = Y(li*0.025), L = li % 4 === 0 ? 58 : li % 2 === 0 ? 44 : 32;
    seg(ix - L, y, ix, y, 2.1, HLC.line, y < ey ? [5, 3] : null);
  }
  if (show && hl.num){
    const y = Y(a*0.1), L = 58, x = ix - L - 13;
    g.font = '600 12px Inter, Arial, sans-serif';
    const w = g.measureText(String(a)).width + 10;
    g.fillStyle = '#000'; g.fillRect(x - w/2, y - 9, w, 18);
    g.strokeStyle = HLC.num; g.lineWidth = 2; g.strokeRect(x - w/2, y - 9, w, 18);
    txt(String(a), x, y, 12, HLC.num);
    seg(ix - L, y, ix, y, 2.1, HLC.num, y < ey ? [5, 3] : null);
  }
  // thimble divisions run up from the edge
  const sp = 22;
  for (let v = 0; v < 25; v++) for (const m of [-1, 0, 1]){
    const x = ix + (v - c + m*25)*sp;
    if (x < -20 || x > W + 20) continue;
    const L = v % 5 === 0 ? 46 : 30;
    const on = show && hl.thimble && v === c;
    seg(x, ey - 2, x, ey - L, on ? 2.1 : 1.2, on ? HLC.thimble : '#111');
    if (v % 5 === 0) txt(String(v), x, ey - L - 11, 12, '#111');
  }
  g.fillStyle = 'rgba(0,0,0,.6)'; g.font = '600 9.5px Inter, Arial, sans-serif'; g.textAlign = 'left';
  g.fillText('Sleeve — numbers run toward the base ↓', 5, H - 7);
  const topBox = cornerText(g, 'Thimble — covers the reading', 5, 8, { size: 9.5, col: 'rgba(0,0,0,.6)' });
  // arrows to whatever was misread
  const placed = [topBox];
  const arrow = (tx, ty, dx, dy, col, lab) => flatArrow(g, W, H, tx, ty, dx, dy, col, lab, placed, { x: 2, y: 12, w: W - 4, h: H - 14 });

  for (const kk of state.pErr){
    if (kk === 'a') arrow(ix - 71 - 12, Y(a*0.1), -0.45, 0.89, HLC.num, 'Sleeve no. ' + a);
    else if (kk === 'b'){ const L = li % 4 === 0 ? 58 : li % 2 === 0 ? 44 : 32; arrow(ix - L - 2, Y(li*0.025), -0.6, 0.8, HLC.line, 'Sleeve line'); }
    else if (kk === 'c') arrow(ix + 4, ey - 50, 0.55, -0.84, HLC.thimble, 'Thimble ' + c);
  }
}

/* ---------- camera ---------- */
let controls, camTween = null;

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
    b.getSize(s); if (Math.max(s.x, s.y, s.z) > 12) return;          // the table or floor under everything
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
let camUser = false;
// re-fit whichever fitted view is showing (iso or front) as things change size; a close-up is left where it is
let viewName = 'iso';
function autoFrame(){ if (!camUser && !state.exam && !drag && !state.coach && (viewName === 'iso' || viewName === 'front')) setView(viewName); }
function setView(name, instant){
  camUser = false; viewName = name;
  let target = center(), dir, zoom = 1;
  const e = state.micY + edgeY(), zf = Math.max(2.5, (frameTop() + 0.35)/0.95);
  if (name === 'front') dir = new T.Vector3(0, 0.04, 1).normalize();
  else if (name === 'scale'){ dir = new T.Vector3(0, 0.12, 1).normalize(); target = new T.Vector3(-0.06, e - 0.06, 0); zoom = zf; }
  else if (name === 'tip'){
    // look square at the cut face, a little off to one side
    const d = new T.Vector3(...SEC_DIRS[state.secAxis]);
    dir = d.clone().multiplyScalar(0.92).add(new T.Vector3(-0.3, 0.26, 0)).normalize();
    if (Math.abs(dir.y) > 0.9) dir.set(-0.3, 0.85, 0.45).normalize();
    target = new T.Vector3(0, state.micY - ext()*0.55, 0);
    zoom = Math.max(2.2, zf*0.55);
    if (state.sample && !state.cut){ state.cut = true; applyCut(); }
    if (state.sample && state.secT < 0.2) setCutT(0.45);
  }
  else dir = new T.Vector3(0.55, 0.42, 1).normalize();
  if (name === 'iso' || name === 'front' || !['scale', 'vernier', 'tip'].includes(name)){ const my = micG.position.y; micG.position.y = seatY();               // frame it seated, even mid-move
    const fb = fitIso(dir, target, 40, fitBox(scene)); micG.position.y = my; micG.updateMatrixWorld(true); target = fb.target; zoom = fb.zoom; }
  if (instant || window.matchMedia('(prefers-reduced-motion: reduce)').matches){
    camera.position.copy(target).add(dir.clone().multiplyScalar(40)); controls.target.copy(target); camera.zoom = zoom;
    camera.updateProjectionMatrix(); controls.update(); camTween = null; invalidate(); return;
  }
  camTween = { t: 0, fromDir: camera.position.clone().sub(controls.target).normalize(), fromTarget: controls.target.clone(), fromZoom: camera.zoom, toDir: dir, toTarget: target, toZoom: zoom };
}
// "Show me": a tight close-up on the exact mark, looking at it square-on
function showMe(k){
  const an = errAnchor(k); if (!an) return;
  const dir = an.n.clone().multiplyScalar(0.55).add(new T.Vector3(0.1, 0.2, 1).normalize().multiplyScalar(0.45)).normalize();
  const zf = 4.4*(1 + B*0.3);
  camTween = { t: 0, fromDir: camera.position.clone().sub(controls.target).normalize(), fromTarget: controls.target.clone(), fromZoom: camera.zoom, toDir: dir, toTarget: an.p.clone(), toZoom: zf*2.1 };
  invalidate();
}
function stepCam(dt){
  if (!camTween) return false;
  const c = camTween; c.t = Math.min(1, c.t + dt/0.6);
  const e = c.t < 0.5 ? 2*c.t*c.t : 1 - Math.pow(-2*c.t + 2, 2)/2;
  const d = c.fromDir.clone().lerp(c.toDir, e); if (d.lengthSq() < 1e-6) d.set(0, 0, 1);
  controls.target.copy(c.fromTarget.clone().lerp(c.toTarget, e));
  camera.position.copy(controls.target).add(d.normalize().multiplyScalar(40));
  camera.zoom = c.fromZoom + (c.toZoom - c.fromZoom)*e;
  camera.updateProjectionMatrix();
  if (c.t >= 1) camTween = null;
  return true;
}

/* ---------- pointer ---------- */
const el = renderer.domElement;
const ray = new T.Raycaster(), ndc = new T.Vector2();
const dragPlane = new T.Plane(new T.Vector3(0, 1, 0), 0), _hit = new T.Vector3();
let drag = null;
/* ---------- click face to measure: a click on a flat face sends the rod there and runs it down ---------- */
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
  invalidate();
}
// where on the part a hit lands, in the part's own space — only for a face that points up
function faceSpot(h){
  if (!h || h.object.userData.kind !== 'part' || !h.face || !partG) return null;
  const n = h.face.normal.clone().transformDirection(h.object.matrixWorld);
  return n.y > 0.7 ? partG.worldToLocal(h.point.clone()) : null;
}
function measureFace(pl){
  const S = state.sample; if (!S) return;
  // a known feature floor goes to that feature's own spot, where the base is sure to seat
  const f = S.feats.find(f => { const g = S.geo[f.id]; return g && Math.abs(g.floor - pl.y) < 2e-3 && CORE.inside(g.region, pl.x, pl.z); });
  if (f){ goToFeature(f.id, true); return; }
  endCoach();
  if (state.locked) setLock(false);
  stopAnim();
  state.seq = { stage: 'retract', id: null, close: true, x: -pl.x, z: -pl.z };
}
function pick(e){
  const r = el.getBoundingClientRect();
  ndc.set(((e.clientX - r.left)/r.width)*2 - 1, -((e.clientY - r.top)/r.height)*2 + 1);
  ray.setFromCamera(ndc, camera);
  const h = ray.intersectObjects(pickables, false);
  return h.length ? h[0] : null;
}
function planePoint(e){
  const r = el.getBoundingClientRect();
  ndc.set(((e.clientX - r.left)/r.width)*2 - 1, -((e.clientY - r.top)/r.height)*2 + 1);
  ray.setFromCamera(ndc, camera);
  return ray.ray.intersectPlane(dragPlane, _hit) ? _hit.clone() : null;
}
function toScreen(v){ const p = v.clone().project(camera), r = el.getBoundingClientRect(); return new T.Vector2((p.x + 1)/2*r.width, (1 - p.y)/2*r.height); }
// which way a clicked face points, snapped to the nearest square direction
el.addEventListener('pointerdown', e => {
  if (e.button !== 0) return;
  const h = pick(e), kind = h && h.object.userData.kind;
  if (!kind || kind === 'none') return;
  controls.enabled = false; camTween = null;
  try { el.setPointerCapture(e.pointerId); } catch (err) {}
  if (kind === 'lever'){ setLock(!state.locked); drag = { kind: 'click' }; return; }
  state.seq = null;
  if (kind === 'part'){
    dragPlane.set(new T.Vector3(0, 1, 0), -h.point.y);
    const p = planePoint(e);
    // a click (rather than a drag) sets the part down where it is, or in click-face mode measures that face
    drag = { kind, ox: state.px - (p ? p.x : 0), oz: state.pz - (p ? p.z : 0),
      face: h.face ? h.face.normal.clone() : null, spot: faceSpot(h), x0: e.clientX, y0: e.clientY };
    hideFaceHL();
    state.lifted = true;
    state.partTarget = null;
  } else {
    const p = h.point.clone();
    // tangent at the grab point: one unit of rotation about the vertical axis
    const dirW = new T.Vector3(p.z, 0, -p.x);
    const sd = toScreen(p.clone().add(dirW.clone().multiplyScalar(0.01))).sub(toScreen(p)).divideScalar(0.01);
    drag = { kind, x: e.clientX, y: e.clientY, sd };
    stopAnim();
    if (kind === 'ratchet'){ endCoach(); state.slipAcc = 0; }
  }
  el.style.cursor = 'grabbing';
}, true);
el.addEventListener('pointermove', e => {
  if (!drag){ hover(e); return; }
  if (drag.kind === 'click') return;
  if (drag.kind === 'part'){
    const p = planePoint(e);
    if (p && (Math.abs(p.x + drag.ox - state.px) > 1e-4 || Math.abs(p.z + drag.oz - state.pz) > 1e-4)){
      // moving again after a pause: lift clear before the part slides
      if (drag.dwelled){ drag.dwelled = false; state.seq = null; stopAnim(); }
      state.lifted = true;
      drag.moved = performance.now();
      movePartTo(p.x + drag.ox, p.z + drag.oz);
    }
    return;
  }
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  drag.x = e.clientX; drag.y = e.clientY;
  const l2 = drag.sd.lengthSq();
  let du = l2 > 9 ? (dx*drag.sd.x + dy*drag.sd.y)/l2 : dx*0.01;
  if (e.shiftKey) du *= 0.2;
  if (fineOn) du *= FINE_K;
  tryTurn(-du/(TPI*TAU), drag.kind);
});
function endDrag(e){
  if (!drag) return;
  const wasPart = drag.kind === 'part', wasDwell = !!drag.dwelled;
  const tap = wasPart && drag.face && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 5, spot = drag.spot;
  drag = null; controls.enabled = true;
  if (tap){
    state.lifted = false;
    if (faceMode && spot) measureFace(spot);
    else state.seq = { stage: 'lower', close: false, quiet: true };
    try { el.releasePointerCapture(e.pointerId); } catch (err) {}
    el.style.cursor = '';
    return;
  }
  if (wasPart && !wasDwell) state.seq = { stage: 'here' };
  try { el.releasePointerCapture(e.pointerId); } catch (err) {}
  el.style.cursor = '';
}
el.addEventListener('pointerup', endDrag);
el.addEventListener('pointercancel', endDrag);
let hoverPending = false;
function hover(e){
  if (hoverPending) return; hoverPending = true;
  requestAnimationFrame(() => {
    hoverPending = false;
    const h = pick(e), k = h && h.object.userData.kind;
    // in click-face mode the whole face under the pointer lights up; a section cuts it like the part
    const spot = faceMode && !drag ? faceSpot(h) : null;
    if (spot){ faceHL.material.clippingPlanes = state.cut ? [CUT_PLANE] : []; showFaceHL(h, 1e-4); } else hideFaceHL();
    if (faceMode) invalidate();
    el.style.cursor = k === 'lever' ? 'pointer'
      : spot ? 'crosshair'
      : (k && k !== 'none' ? 'grab' : '');
  });
}

/* ---------- reading panel ---------- */
let lastKey = '', hlKey = '';
function updateAll(){ lastKey = ''; hlKey = ''; invalidate(); }
function updateUI(){
  const ev = state.ev, I = B + state.reading;
  const k = [B, state.reading, state.locked, state.lifted, Math.round(state.micY*1e4), state.practice,
    ev ? [ev.hb, ev.hr, ev.feat] : '', state.sample && state.sample.key].join('|');
  if (k === lastKey) return; lastKey = k;
  $('lcd').textContent = fmt(I);
  $('lcdmm').textContent = (I*25.4).toFixed(2) + ' mm';
  $('vBase').textContent = B.toFixed(3); $('hBase').textContent = `${B}–${B + 1}″ rod`;
  const n = Math.round(state.reading*1000);
  const a = Math.floor(n/100); let rem = n - a*100;
  const b = Math.floor(rem/25); const c = rem - b*25;
  $('vA').textContent = (a/10).toFixed(3); $('hA').textContent = `“${a}” covered × 0.100″`;
  $('vB').textContent = (b*0.025).toFixed(3); $('hB').textContent = `${b} covered × 0.025″`;
  $('vC').textContent = (c*0.001).toFixed(3); $('hC').textContent = `line ${c} × 0.001″`;
  $('vT').textContent = fmt(I);
  $('gap').textContent = state.lifted ? '— lifted —' : (seated() ? measuredDepth().toFixed(3) + '″' : 'base not seated');
  if (document.activeElement !== $('slider')) $('slider').value = n;

  const fc = $('featCell'), S = state.sample;
  let fk = 'Measuring', fv = '—', fh = 'nothing under the rod', col = '';
  if (S && ev){
    const f = ev.feat && S.feats.find(x => x.id === ev.feat);
    if (f){ col = TYPES[f.type].c; fk = TYPES[f.type].name; fv = f.label; fh = isContact() ? 'rod on the floor' : 'rod above the floor'; }
    else if (!ev.onPart){ fk = 'Measuring'; fv = 'Surface plate'; fh = 'base on the plate'; }
    else { fk = 'Measuring'; fv = 'Unlisted surface'; fh = isContact() ? 'rod touching' : 'slide the part under the rod'; }
  } else if (!S){ fk = 'Measuring'; fv = 'Nothing — held in the air'; fh = 'choose a part'; }
  if (col) fc.style.setProperty('--c', col); else fc.style.removeProperty('--c');
  $('fK').textContent = fk; $('fV').textContent = fv; $('fH').textContent = fh;

  let msg = 'Rod free', cls = '';
  const lim = extLimit();
  if (state.lifted) msg = 'Lifted off the part';
  else if (!seated()) { msg = 'Rod is holding the base up — back it off'; cls = 'warn'; }
  else if (isContact()){
    msg = (!ev || !ev.onPart) && B === 0 && state.reading < 1e-6 ? 'Zero check: rod on the surface plate' : 'Base seated, rod on the floor';
    cls = 'ok';
  }
  else if (lim > 1 - 1e-7){ msg = 'Rod can’t reach — fit a longer rod'; cls = 'warn'; }
  else msg = 'Base seated — run the rod down';
  if (state.locked){ msg += ' · clamped'; cls = cls || 'warn'; }
  if (gbList && !state.lifted) msg += ' · on gage blocks ' + gbList;
  $('status').textContent = msg; $('status').className = 'status ' + cls;
  $('pullBtn').disabled = $('autoBtn').disabled = !S;
}
function updateHighlights(){
  const n = Math.round(state.reading*1000), hl = state.hl, show = showAns();
  const k = [n, show, hl.num, hl.line, hl.thimble, B].join('|');
  if (k === hlKey) return; hlKey = k;
  const a = Math.floor(n/100), li = Math.floor(n/25), c = n % 25;
  HLs.num.set(show && hl.num ? a : -1);
  HLs.line.set(show && hl.line ? li : -1);
  HLs.thimble.set(show && hl.thimble ? c : -1);
  invalidate();
}

function setRange(nb){
  B = nb; stopAnim(); endCoach(); state.seq = null; state.coachArmed = true;
  state.reading = 0;
  document.querySelectorAll('[data-range]').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.range === B)));
  $('brand').textContent = `${B}–${B + 1}″ rod`;
  $('setTo').placeholder = goHint();
  document.title = `Depth Micrometer ${B}–${B + 1}″ · 3D`;
  build();
  fillSampleOptions();
  newSample(state.sampleKey);
  state.micY = seatY();
  placeLights();
  resize();
  updateAll();
}

/* ---------- UI bindings ---------- */
function bindUI(){
  document.querySelectorAll('[data-range]').forEach(b => b.addEventListener('click', () => { if (+b.dataset.range !== B){ setRange(+b.dataset.range); setView('iso'); } }));
  document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));
  document.querySelectorAll('[data-step]').forEach(b => b.addEventListener('click', () => {
    const base = state.anim && state.anim.type === 'to' ? state.anim.target : state.reading;
    goTo(Math.round((base + parseFloat(b.dataset.step))*1e3)/1e3);
  }));
  document.querySelectorAll('[data-hl]').forEach(c => c.addEventListener('change', () => { state.hl[c.dataset.hl] = c.checked; if (c.dataset.hl === 'outline') updateFloorHL(); updateAll(); }));
  $('slider').addEventListener('input', e => { stopAnim(); state.seq = null; tryTurn(e.target.value/1000 - state.reading, 'slider'); });
  $('ratchetBtn').addEventListener('click', ratchetClose);
  $('closeBtn').addEventListener('click', () => goTo(0));
  $('openBtn').addEventListener('click', () => goTo(1));
  $('lockBtn').addEventListener('click', () => setLock(!state.locked));
  $('lockQuick').addEventListener('click', () => setLock(!state.locked));
  $('closeQuick').addEventListener('click', () => { state.seq = null; goTo(0); });
  $('openQuick').addEventListener('click', () => { state.seq = null; ratchetClose(); });
  $('cutBtn').addEventListener('click', () => { state.cut = !state.cut; applyCut(); });
  $('tableBtn').addEventListener('click', () => setTable(!tableOff));
  setTable(tableOff);
  $('faceBtn').addEventListener('click', () => setFaceMode(!faceMode));
  el.addEventListener('pointerleave', () => { if (faceHL.visible){ hideFaceHL(); invalidate(); } });
  $('sectionChk').addEventListener('change', e => { state.cut = e.target.checked; applyCut(); });
  $('revealInside').addEventListener('click', () => revealInside());
  document.querySelectorAll('[data-cutdir]').forEach(b => b.addEventListener('click', () => pickCut(b.dataset.cutdir)));
  syncReveal();
  $('cutT').addEventListener('input', e => { if (state.cut) setCutT(Number(e.target.value)/100, true); });
  $('coachChk').addEventListener('change', e => { state.coachOn = e.target.checked; if (!e.target.checked) endCoach(); });
  $('coachOk').addEventListener('click', () => endCoach(true));
  $('autoBtn').addEventListener('click', autoMeasure);
  $('pullBtn').addEventListener('click', slideOut);
  const go = () => {
    const txt = $('setTo').value;
    if (unitOf(txt) === 'mm') { toast(`The depth micrometer reads inches only. Type the depth in inches, like ${(B + 0.625).toFixed(3)}`); return; }
    const v = numOf(txt);
    if (isNaN(v) || v < B || v > B + 1){ toast(`Enter a reading between ${B}.000 and ${B + 1}.000`); return; }
    goTo(Math.round((v - B)*1e3)/1e3);
  };
  $('goBtn').addEventListener('click', go);
  $('setTo').addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  document.querySelectorAll('[data-units]').forEach(b => b.addEventListener('click', () => setUnits(b.dataset.units)));
  setUnits(units);
  bindFolds();
  $('sampleSel').addEventListener('change', e => newSample(e.target.value));
  $('newVals').addEventListener('click', () => { if (state.sampleKey !== 'none') newSample(state.sampleKey, true); });
  $('revealBtn').addEventListener('click', () => { if (state.sample){ state.sample.revealed = !state.sample.revealed; renderFeats(); } });
  $('feats').addEventListener('click', e => { const sel = e.target.closest('[data-select]'); if (sel) goToFeature(sel.dataset.select, true); });
  $('practiceBtn').addEventListener('click', () => setPractice(!state.practice));
  $('fineBtn').addEventListener('click', () => setFine(!fineOn));
  $('fineQuick').addEventListener('click', () => setFine(!fineOn));
  $('soundChk').checked = soundOn;
  $('soundChk').addEventListener('change', e => setSound(e.target.checked));
  {
    const ro = new ResizeObserver(queueLayout);
    ro.observe(wrap);
    window.addEventListener('resize', queueLayout);
    OV_ITEMS.forEach(o => { const el2 = wrap.querySelector(o.sel); if (el2) ro.observe(el2); });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(queueLayout);
    queueLayout();
  }
  $('examBtn').addEventListener('click', () => setExam(true));
  $('feedback').addEventListener('click', e => { const b = e.target.closest('[data-show]'); if (b) showMe(b.dataset.show); });
  $('exitExam').addEventListener('click', () => setExam(false));
  $('spinBtn').addEventListener('click', () => setSpin(!controls.autoRotate));
  $('labelsBtn').addEventListener('click', () => setLabels(!examLabels));
  bindSplit(); applyRH();
  $('randomBtn').addEventListener('click', loadPractice);
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
    $('flatBtn').setAttribute('aria-label', fl);
    $('flatBtn').dataset.tip = fl;
    flatKey = '';
  });
  $('checkBtn').addEventListener('click', checkPractice);
  $('guess').addEventListener('keydown', e => { if (e.key === 'Enter') checkPractice(); });
  $('guess').addEventListener('input', () => { if (state.pRevealed){ state.pRevealed = false; state.pErr = []; flatKey = ''; updateAll(); } });
  $('gfxSel').addEventListener('change', e => applyGfx(e.target.value));
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape'){ endCoach(true); closeTut(); if (state.exam) setExam(false); return; }
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
    let d = 0;
    if (e.key === 'ArrowUp') d = e.shiftKey ? 0.010 : 0.001;
    else if (e.key === 'ArrowDown') d = e.shiftKey ? -0.010 : -0.001;
    else if (e.key === 'PageUp') d = 0.025;
    else if (e.key === 'PageDown') d = -0.025;
    else if (e.key === 'r' || e.key === 'R'){ ratchetClose(); return; }
    else if (e.key === 'f' || e.key === 'F'){ setFine(!fineOn); return; }
    else if (e.key === 'l' || e.key === 'L'){ setLock(!state.locked); return; }
    else if (e.key === 'a' || e.key === 'A'){ autoMeasure(); return; }
    else if (e.key === 'c' || e.key === 'C'){ state.cut = !state.cut; applyCut(); return; }
    else if (e.key === '[' || e.key === ']'){
      if (!state.sample) return;
      state.seq = null; state.partTarget = null; state.lifted = true;
      movePartTo(state.px + (e.key === ']' ? 1 : -1)*(e.shiftKey ? 0.02 : 0.1), state.pz);
      clearTimeout(slideTimer); slideTimer = setTimeout(() => { state.lifted = false; state.seq = { stage: 'lower', close: false, quiet: true }; }, 400);
      return;
    }
    else return;
    if (fineOn) d *= FINE_K;
    e.preventDefault(); stopAnim(); state.seq = null; tryTurn(d, 'key');
  });
  window.addEventListener('pointerup', invalidate);
}
let slideTimer = 0;

/* ---------- loop ---------- */
const clock = new T.Clock();
let leverAngle = 0, dim = 0, time = 0, lastSig = '', shadowPending = true, frameN = 0, lastRenderT = 0;
const perf = [];
function adaptResolution(now){
  const dt = now - lastRenderT; lastRenderT = now;
  if (dt > 120){ perf.length = 0; return; }
  perf.push(dt);
  if (perf.length < 60) return;
  const avg = perf.reduce((a, b) => a + b, 0)/perf.length; perf.length = 0;
  const floor = Math.min(1, gfx.maxDpr);
  if (drag || document.activeElement === $('slider')) return;
  if (avg > 21 && dprCur > floor + 0.01){ dprCeil = dprCur*0.95; dprCur = Math.max(floor, dprCur*0.85); resize(); updateGfxInfo(); }
  else if (avg < 17.4 && dprCur < Math.min(dprCeil, gfx.maxDpr) - 0.01){ dprCur = Math.min(dprCeil, gfx.maxDpr, dprCur*1.08); resize(); updateGfxInfo(); }
}
function tick(now){
  requestAnimationFrame(tick);
  const dt = Math.min(0.05, clock.getDelta()); time += dt; frameN++;
  const a = state.anim;
  if (a){
    if (a.type === 'to'){
      const diff = a.target - state.reading;
      const moved = tryTurn(Math.sign(diff)*Math.min(Math.abs(diff), Math.max(a.fast ? 0.6 : 0.05, Math.abs(diff)*(a.fast ? 9 : 5))*dt), 'auto');
      if (Math.abs(a.target - state.reading) < 1e-7 || !moved) state.anim = null;
    } else if (a.type === 'ratchet'){
      const lim = Math.min(1, extLimit());
      tryTurn(Math.max(0.05, (lim - state.reading)*4)*dt, 'ratchet');
      if (state.clicks >= 4) state.anim = null;
    }
  }
  // the part slides while the micrometer is lifted clear of it
  if (state.partTarget && state.sample && !drag){
    const p = state.partTarget;
    const dx = p.x - state.px, dz = p.z - state.pz, d = Math.hypot(dx, dz);
    const step = Math.min(d, Math.max(2.5, d*5)*dt);
    if (d < 1e-4){ state.partTarget = null; movePartTo(p.x, p.z); }
    else movePartTo(state.px + dx/d*step, state.pz + dz/d*step);
  }
  // the micrometer rises to clear the part, and settles back onto it
  const seat = seatY(), want = state.lifted ? liftY() : seat;
  if (Math.abs(state.micY - want) > 1e-5){
    const v = Math.max(2.5, Math.abs(want - state.micY)*9)*dt;
    state.micY = state.micY < want ? Math.min(want, state.micY + v) : Math.max(want, state.micY - v);
  } else state.micY = want;
  if (!state.lifted && state.micY < seat) state.micY = seat;

  // holding the part still over a surface for a moment measures it right there
  if (drag && drag.kind === 'part' && !drag.dwelled && drag.moved && performance.now() - drag.moved > 350){
    drag.dwelled = true; state.seq = { stage: 'here' };
  }
  if (state.seq) stepSeq();
  if (!state.coachArmed && !state.coach){
    const lim = extLimit();
    if (lim === Infinity || lim - state.reading > 0.02) state.coachArmed = true;
  }

  const la = state.locked ? 0.5 : 0;
  leverAngle = Math.abs(la - leverAngle) < 0.001 ? la : leverAngle + (la - leverAngle)*Math.min(1, dt*14);
  const dimT = state.coach ? 0.7 : 0;
  dim = Math.abs(dimT - dim) < 0.002 ? dimT : dim + (dimT - dim)*Math.min(1, dt*8);

  const sig = [state.reading, state.micY, state.px, state.pz, state.ratchetExtra, leverAngle].join('|');
  const moved = sig !== lastSig; lastSig = sig;
  if (moved){
    micG.position.y = state.micY;
    thG.position.y = Y_ZERO - state.reading;
    thG.rotation.y = -state.reading*TPI*TAU;
    ratchetG.rotation.y = state.ratchetExtra;
    leverR.rotation.y = leverAngle;
    shadowPending = true;
  }
  updateGageBlocks();
  const camMoved = stepCam(dt) | controls.update();
  updateUI();
  updateHighlights();
  drawFlat();

  const coaching = dim > 0.002;
  const pointing = Object.keys(errTags).length > 0 || (state.practice && state.pErr.length > 0);
  if (!(moved || camMoved || dirty || coaching || shadowPending || pointing)) return;
  updateOverlays();
  dirty = false;
  if (shadowPending && gfx.shadows && (!moved || frameN % 3 === 0)){ renderer.shadowMap.needsUpdate = true; shadowPending = false; }
  else if (!gfx.shadows) shadowPending = false;

  if (coaching){
    const pulse = 0.5 + 0.5*Math.sin(time*5);
    Object.values(R).forEach(m => m.emissiveIntensity = dim*(0.25 + 0.35*pulse));
    halo.forEach((h, i) => {
      const ph = (time*0.9) % 1;
      h.material.opacity = dim*(i ? 0.5*(1 - ph) : 0.9);
      const s = i ? 1 + ph*0.35 : 1 + 0.04*pulse; h.scale.set(s, 1, s);
    });
  } else if (R.chrome.emissiveIntensity !== 0){
    Object.values(R).forEach(m => m.emissiveIntensity = 0);
    halo.forEach(h => h.material.opacity = 0);
  }
  dimQuad.material.uniforms.a.value = dim;
  dimQuad.visible = coaching;
  shopFinish(scene);
  renderer.render(scene, camera);
  if (coaching){
    renderer.autoClear = false;
    renderer.shadowMap.needsUpdate = false;
    camera.layers.set(1);
    shopFinish(scene);
  renderer.render(scene, camera);
    camera.layers.set(0);
    renderer.autoClear = true;
  }
  adaptResolution(now || performance.now());
}

function start(){
  window.__load && window.__load.set(0.9, 'Setting up the view…');
  atlas = makeAtlas(['0','1','2','3','4','5','6','7','8','9','10','15','20']);
  controls = new T.OrbitControls(camera, el);
  controls.enableDamping = true; controls.dampingFactor = 0.14;
  controls.screenSpacePanning = true;
  controls.minZoom = 0.3; controls.maxZoom = 60; controls.zoomSpeed = 1.3;
  controls.addEventListener('start', () => { camTween = null; camUser = true; if (state.exam && controls.autoRotate) setSpin(false); });
  controls.addEventListener('change', invalidate);
  bindUI();
  // on a phone the flat view would cover the model, so it starts folded away
  if (window.innerWidth < 560){
    flatOpen = false;
    $('flat').classList.add('closed');
    $('flatBtn').setAttribute('aria-expanded', 'false');
    $('flatBtn').setAttribute('aria-label', 'Show flat view');
    $('flatBtn').dataset.tip = 'Show flat view';
  }
  applyGfx('high');
  setRange(0);
  bindFinish();
  setView('iso', true);

  // the first view is framed before the layout has settled (fonts, panels, the flat view's corner),
  // so frame it again a few times as things land, until the first touch from the user
  {
    let touched = false;
    const stop = () => { touched = true; };
    ['pointerdown', 'wheel', 'keydown'].forEach(t => window.addEventListener(t, stop, { capture: true, once: true }));
    const refit = () => { if (!touched && !state.exam && !state.coach) { setView('iso', true); } };
    requestAnimationFrame(() => requestAnimationFrame(refit));
    [150, 400, 900, 1600].forEach(ms => setTimeout(refit, ms));
    window.addEventListener('resize', () => setTimeout(refit, 120));
  }
  window.__load ? window.__load.done() : $('loading').remove();
  started = true;
  const S = state.sample;
  if (S){ const f = S.feats.find(x => x.valid); if (f) goToFeature(f.id, true); }
  requestAnimationFrame(tick);
}
const fontsReady = document.fonts && document.fonts.load
  ? Promise.all([document.fonts.load('600 72px "Inter"'), document.fonts.ready]).catch(() => {})
  : Promise.resolve();
window.__load && window.__load.set(0.8, 'Loading fonts…');
Promise.race([fontsReady, new Promise(r => setTimeout(r, 2500))]).then(start);
})();
