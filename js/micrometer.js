window.__load && window.__load.set(0.55, 'Building the micrometer…');
/*CORE*/
const CORE = (function(){
  const RHO = 0.128;                 // 0.256" measuring faces
  const C30 = Math.cos(Math.PI/6);

  function dims(B){
    const g = 0.05*B, armL = -0.7 - g, armR = -0.12, hx = B + 1.12, hubR = B + 1.7 + g;
    const cx = (armR + hx)/2, rxi = (hx - armR)/2, rxo = (hubR - armL)/2, cy = -0.5 - 0.35*B;
    const ryi = rxi*0.95, ryo = ryi + 0.46 + 0.12*B, zs = 1 + 0.08*B, ar = (armR - armL)/2;
    return { g, armL, armR, hx, hubR, cx, cy, rxi, rxo, ryi, ryo, zs, ar,
      bottom: cy - ryo, rimFront: 0.18*zs + 0.022, coreFront: 0.14*zs + 0.015, armTop: 0.08 + ar, hubTop: 0.34 };
  }
  // open throat: allowed x-range at height y
  function xl(D, y){ if (y > D.armTop) return -Infinity; if (y >= D.cy) return D.armR; const t = (y - D.cy)/D.ryi; if (t <= -1) return Infinity; return D.cx - D.rxi*Math.sqrt(1 - t*t); }
  function xr(D, y){ if (y > D.hubTop) return Infinity; if (y >= D.cy) return D.hx; const t = (y - D.cy)/D.ryi; if (t <= -1) return -Infinity; return D.cx + D.rxi*Math.sqrt(1 - t*t); }

  // local -> setup frame: optional flip (180° about x), optional ry (local z becomes x), then offset
  function xf(p, s){
    let x = p[0], y = p[1], z = p[2];
    if (s.flip){ y = -y; z = -z; }
    if (s.ry){ const nx = z, nz = -x; x = nx; z = nz; }
    const o = s.pos || [0, 0, 0];
    return [x + o[0], y + o[1], z + o[2]];
  }
  function prep(prims, s){
    return prims.map((p, i) => {
      if (p.t === 'box'){
        const cs = [];
        for (const X of [p.x0, p.x1]) for (const Y of [p.y0, p.y1]) for (const Z of [p.z0, p.z1]) cs.push(xf([X, Y, Z], s));
        const c = k => cs.map(v => v[k]);
        return { k: 'box', i, p, X0: Math.min(...c(0)), X1: Math.max(...c(0)), Y0: Math.min(...c(1)), Y1: Math.max(...c(1)), Z0: Math.min(...c(2)), Z1: Math.max(...c(2)) };
      }
      const a = xf([p.cx || 0, p.cy || 0, p.z0], s), b = xf([p.cx || 0, p.cy || 0, p.z1], s);
      const ro = p.t === 'rz' ? p.ro : p.r, ri = p.t === 'rz' ? p.ri : 0;
      if (s.ry) return { k: 'cx', i, p, X0: Math.min(a[0], b[0]), X1: Math.max(a[0], b[0]), Yc: a[1], Zc: a[2], ro: p.hex ? p.af/2 : ro, ri };
      return { k: 'cz', i, p, X: a[0], Y: a[1], Z0: Math.min(a[2], b[2]), Z1: Math.max(a[2], b[2]), ro, ri, hex: !!p.hex, af: p.af };
    });
  }
  function getPrep(S, id){ return S.prep[id] || (S.prep[id] = prep(S.prims, S.setups[id])); }

  // Evaluate the part at slide position partZ: contact with the faces, frame clearance,
  // how far it is pushed toward the anvil, and which feature is being measured.
  function evalAt(S, id, partZ, sxPrev, B){
    const D = dims(B), pr = getPrep(S, id), rf = D.rimFront + 0.006, m = 0.012, E = 0.003;
    let contact = false, dxmin = Infinity, dxmax = -Infinity, top = null, blocked = false;
    const pts = [], touching = [];
    for (const q of pr){
      let r = null;
      if (q.k === 'box'){
        const Z0 = q.Z0 + partZ, Z1 = q.Z1 + partZ;
        const dy = Math.max(q.Y0, 0, -q.Y1), dz = Math.max(Z0, 0, -Z1);
        if (dy*dy + dz*dz < (RHO - E)*(RHO - E)) r = [q.X0, q.X1];
        if (Z1 > -rf && Z0 < rf){
          const xm = (q.X0 + q.X1)/2, ym = (q.Y0 + q.Y1)/2;
          for (const X of [q.X0, xm, q.X1]) for (const Y of [q.Y0, ym, q.Y1]) pts.push([X, Y]);
        }
      } else if (q.k === 'cz'){
        const Z0 = q.Z0 + partZ, Z1 = q.Z1 + partZ;
        const zb = Math.min(Math.max(0, Z0), Z1);
        if (Math.abs(zb) < RHO - E){
          const ym = Math.sqrt(RHO*RHO - zb*zb), yb = Math.min(Math.max(q.Y, -ym), ym), d = Math.abs(yb - q.Y);
          let h = null;
          if (q.hex){ if (d <= q.ro/2) h = q.af/2; else if (d < q.ro - E) h = q.af/2*(q.ro - d)/(q.ro/2); }
          else if (d < q.ro - E) h = Math.sqrt(q.ro*q.ro - d*d);
          if (h !== null) r = [q.X - h, q.X + h];
        }
        if (Z1 > -rf && Z0 < rf){
          const n = q.hex ? 6 : 24;
          for (let k = 0; k < n; k++){
            const t = q.hex ? -Math.PI/2 + k*Math.PI/3 : k/n*Math.PI*2;
            pts.push([q.X + q.ro*Math.cos(t), q.Y + q.ro*Math.sin(t)]);
          }
        }
      } else {
        const Zc = q.Zc + partZ, d = Math.hypot(q.Yc, Zc);
        if (d < q.ro + RHO - E && (q.ri <= 0 || d + RHO > q.ri + E)) r = [q.X0, q.X1];
        const dz = Math.max(0, Math.abs(Zc) - rf);
        if (dz < q.ro){
          const hY = Math.sqrt(q.ro*q.ro - dz*dz);
          for (const X of [q.X0, (q.X0 + q.X1)/2, q.X1]) for (const Y of [q.Yc - hY, q.Yc, q.Yc + hY]) pts.push([X, Y]);
        }
      }
      if (r){
        contact = true; touching.push(q.i);
        if (r[0] < dxmin) dxmin = r[0];
        if (r[1] > dxmax + 1e-9){ dxmax = r[1]; top = q; }
      }
    }
    let sxFrame = -Infinity;
    for (const [x, y] of pts){
      const l = xl(D, y);
      if (l === Infinity){ blocked = true; break; }
      if (l !== -Infinity) sxFrame = Math.max(sxFrame, l + m - x);
    }
    const sx = contact ? Math.max(-dxmin, sxFrame) : Math.max(sxPrev == null ? 0 : sxPrev, sxFrame);
    if (!blocked) for (const [x, y] of pts){ if (x + sx > xr(D, y) - m){ blocked = true; break; } }
    const gap = contact && sxFrame > -dxmin + 1e-6;
    let measured = null, minFrac = 0, eff = false, tooSmall = false, tooBig = false;
    if (contact){
      measured = sx + dxmax;
      const f = measured - B;
      if (f > 1 + 1e-9){ blocked = true; tooBig = true; }
      else if (f < -1e-9) tooSmall = true;
      else { minFrac = Math.max(0, f); eff = true; }
    }
    const tag = top && top.p.tags ? (top.p.tags[id] || null) : null;
    return { contact, eff, gap, blocked, tooSmall, tooBig, sx, measured, minFrac, inSlab: pts.length > 0,
      feat: eff && !gap ? tag : null, tag, touching };
  }

  function zExtent(S, id){
    let lo = Infinity, hi = -Infinity;
    for (const q of getPrep(S, id)){
      if (q.k === 'cx'){ lo = Math.min(lo, q.Zc - q.ro); hi = Math.max(hi, q.Zc + q.ro); }
      else { lo = Math.min(lo, q.Z0); hi = Math.max(hi, q.Z1); }
    }
    return [lo, hi];
  }
  function restZ(S, id, B, side){
    const D = dims(B), e = zExtent(S, id);
    return side < 0 ? -(e[1] + D.rimFront + 0.3) : (-e[0] + D.rimFront + 0.3);
  }
  function pathInfo(S, id, z0, z1, B){
    let sx = null, maxF = 0;
    const n = Math.max(2, Math.ceil(Math.abs(z1 - z0)/0.01));
    for (let i = 0; i <= n; i++){
      const e = evalAt(S, id, z0 + (z1 - z0)*i/n, sx, B);
      if (e.blocked) return { ok: false };
      sx = e.sx;
      if (e.eff) maxF = Math.max(maxF, e.minFrac);
    }
    return { ok: true, maxF, sx };
  }

  /* ---- samples (all shapes are built from these primitives, so visuals match the physics) ---- */
  function gaugeMake(v){
    const g = v.g, hy = g < 0.9 ? 0.5925 : 0.6875;
    return { prims: [{ t: 'box', x0: 0, x1: g, y0: -hy, y1: hy, z0: -0.175, z1: 0.175, mat: 'lapped', tags: { A: 'g' }, label: g.toFixed(4) + ' IN' }],
      setups: { A: {} }, targets: { g: { s: 'A', z: 0 } } };
  }
  const DEFS = {
    shaft: { name: 'Step shaft',
      feats: B => [['d1', 'diameter', 'Large diameter', B + 0.80], ['d2', 'diameter', 'Middle diameter', B + 0.55], ['d3', 'diameter', 'Small diameter', B + 0.30]],
      make(v){
        const L = 0.6;
        return { prims: [
          { t: 'cz', r: v.d3/2, z0: 0, z1: L, mat: 'turned', tags: { A: 'd3' }, cham: 0.02 },
          { t: 'cz', r: v.d2/2, z0: L, z1: 2*L, mat: 'turned', tags: { A: 'd2' }, cham: 0.02 },
          { t: 'cz', r: v.d1/2, z0: 2*L, z1: 3*L, mat: 'turned', tags: { A: 'd1' }, cham: 0.03 }],
          setups: { A: {} },
          targets: { d1: { s: 'A', z: -2.5*L }, d2: { s: 'A', z: -1.5*L }, d3: { s: 'A', z: -0.5*L } } };
      } },
    hub: { name: 'Flanged hub',
      feats: B => [['fd', 'flange', 'Flange diameter', B + 0.90], ['bd', 'boss', 'Boss diameter', B + 0.35], ['ft', 'thickness', 'Flange thickness', 0.18], ['ol', 'length', 'Overall length', B + 0.70]],
      make(v){
        const F = v.fd/2, H = v.bd/2, ft = v.ft, OL = v.ol, rb = H*0.45, yL = Math.max(0, H - 0.15), dt = (H + F)/2;
        return { prims: [
          { t: 'rz', ri: rb, ro: F, z0: OL - ft, z1: OL, mat: 'turnedAlu', tags: { A: 'fd', B: 'ft' }, cham: 0.012 },
          { t: 'rz', ri: rb, ro: H, z0: 0, z1: OL - ft, mat: 'turnedAlu', tags: { A: 'bd', B: 'ol' }, cham: 0.012 }],
          setups: { A: {}, B: { flip: true, ry: true, pos: [0, yL, 0] } },
          targets: { fd: { s: 'A', z: -(OL - ft/2) }, bd: { s: 'A', z: -(OL - ft)/2 },
            ol: { s: 'B', z: 0, hl: [0, 1] }, ft: { s: 'B', z: -Math.sqrt(Math.max(0, dt*dt - yL*yL)) } } };
      } },
    block: { name: 'Step block',
      feats: B => [['t', 'thickness', 'Thickness', B + 0.60], ['s', 'step', 'Step thickness', B + 0.35], ['w', 'width', 'Width', B + 0.85]],
      make(v, B){
        const hh = 0.25 + 0.08*B, a = v.w*0.55;
        return { prims: [
          { t: 'box', x0: 0, x1: v.t, y0: -hh, y1: hh, z0: 0, z1: a, mat: 'milled', tags: { A: 't', B: 'w' } },
          { t: 'box', x0: 0, x1: v.s, y0: -hh, y1: hh, z0: a, z1: v.w, mat: 'milled', tags: { A: 's', B: 'w' } }],
          setups: { A: {}, B: { ry: true, pos: [0, 0, v.s/2] } },
          targets: { t: { s: 'A', z: -a/2 }, s: { s: 'A', z: -(a + v.w)/2 }, w: { s: 'B', z: 0 } } };
      } },
    plate: { name: 'Boss plate',
      feats: B => [['bd', 'boss', 'Boss diameter', B + 0.50], ['w', 'width', 'Plate width', B + 0.90], ['h', 'length', 'Overall height', B + 0.70]],
      make(v){
        const d = v.bd, W = v.w, pt = 0.2, bh = v.h - pt, W2 = Math.max(0.8, d + 0.2), yUp = W2/2 - 0.35;
        return { prims: [
          { t: 'box', x0: -W/2, x1: W/2, y0: -W2/2, y1: W2/2, z0: 0, z1: pt, mat: 'milledAlu', tags: { A: 'w', B: 'w' } },
          { t: 'cz', r: d/2, z0: pt, z1: pt + bh, mat: 'turnedAlu', tags: { A: 'bd', C: 'h' }, cham: 0.015 }],
          setups: { A: {}, B: { flip: true, pos: [0, yUp, 0] }, C: { ry: true, pos: [0, yUp, 0] } },
          targets: { bd: { s: 'A', z: -(pt + bh/2) }, w: { s: 'B', z: pt/2 }, h: { s: 'C', z: 0, hl: [0, 1] } } };
      } },
    washer: { name: 'Washer',
      feats: B => [['od', 'diameter', 'Outside diameter', B + 0.85], ['t', 'thickness', 'Thickness', 0.12]],
      make(v){
        const R = v.od/2, ri = R*0.5, yc = (ri + R)/2;
        return { prims: [{ t: 'rz', ri, ro: R, z0: 0, z1: v.t, mat: 'ground', tags: { A: 'od', B: 't' }, cham: 0.008 }],
          setups: { A: {}, B: { ry: true, pos: [0, yc, 0] } },
          targets: { od: { s: 'A', z: -v.t/2 }, t: { s: 'B', z: 0 } } };
      } },
    hex: { name: 'Hex bar',
      feats: B => [['af', 'flats', 'Across flats', B + 0.625]],
      make(v){
        return { prims: [{ t: 'cz', hex: true, af: v.af, r: v.af/2/C30, z0: -0.4, z1: 0.4, mat: 'brass', tags: { A: 'af' } }],
          setups: { A: {} }, targets: { af: { s: 'A', z: 0 } } };
      } },
    gauge: { name: 'Gage block (fractional)', ref: true, feats: B => [['g', 'reference', `${(B + 0.25).toFixed(4)}″ gage block`, B + 0.25]], make: gaugeMake },
    std: { name: 'Setting standard', ref: true, avail: B => B >= 1,
      feats: B => [['s', 'reference', `${B}.0000″ setting standard`, B]],
      make(v){
        return { prims: [
          { t: 'cz', r: 0.125, z0: 0, z1: v.s, mat: 'turned', tags: { A: 's' }, cham: 0.02 },
          { t: 'cz', r: 0.19, z0: v.s*0.3, z1: v.s*0.7, mat: 'grip', tags: {} }],
          setups: { A: { ry: true } }, targets: { s: { s: 'A', z: 0, hl: [0] } } };
      } }
  };
  for (let n = 1; n <= 6; n++){
    DEFS['g' + n] = { name: `Gage block ${n}.0000″`, ref: true, avail: B => n >= B && n <= B + 1,
      feats: () => [['g', 'reference', `${n}.0000″ gage block`, n]], make: gaugeMake };
  }

  function available(B){ return Object.keys(DEFS).filter(k => !DEFS[k].avail || DEFS[k].avail(B)); }
  function makeSample(key, B, rnd){
    const Dd = DEFS[key];
    const feats = Dd.feats(B).map(([id, type, label, nom]) => ({ id, type, label, nom, valid: !!Dd.ref || (nom >= B + 0.03 && nom <= B + 0.97) }));
    const vals = {};
    feats.forEach(f => {
      if (Dd.ref || !f.valid) vals[f.id] = f.nom;
      else vals[f.id] = Math.round((f.nom + (Math.floor(rnd()*201) - 100)/1e4)*1e4)/1e4;
    });
    const m = Dd.make(vals, B);
    return { key, name: Dd.name, ref: !!Dd.ref, feats, vals, prims: m.prims, setups: m.setups, targets: m.targets, prep: {} };
  }
  function hlPrims(S, featId, setupId){
    const t = S.targets[featId];
    if (t && t.hl && t.s === setupId) return t.hl;
    return S.prims.map((p, i) => (p.tags && p.tags[setupId] === featId) ? i : -1).filter(i => i >= 0);
  }
  return { RHO, dims, evalAt, restZ, pathInfo, zExtent, DEFS, available, makeSample, hlPrims };
})();
/*ENDCORE*/

(function(){
"use strict";
const T = THREE, TAU = Math.PI*2;
const DIV = TAU/25, VSTEP = DIV*0.9, VERN0 = DIV*3, TPI = 40;
// inches: 0.256" carbide faces (Fowler spec), 18 mm scale diameter typical of 0–1" heads
const SP_R = CORE.RHO, SLV_R = 0.29, TH_EDGE_R = 0.305, TH_R = 0.3545, KN_R = 0.395;
const $ = id => document.getElementById(id);
const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const dims = () => CORE.dims(B);

let B = 0, S0 = 2.1;
const state = {
  reading: 0.25, locked: false,
  sampleKey: 'shaft', sample: null, setup: 'A', side: -1,
  partZ: 0, partTarget: null, sxT: 0, sxV: 0, ev: null, seq: null,
  practice: false, pRevealed: false, pErr: [], exam: false, pScore: { right: 0, total: 0, streak: 0 }, hl: { num: false, line: false, thimble: false, vernier: false, outline: false },
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
renderer.domElement.tabIndex = 0;
renderer.domElement.className = 'gl';
wrap.appendChild(renderer.domElement);
const MAX_ANISO = Math.min(8, renderer.capabilities.getMaxAnisotropy());

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

function center(){ const D = dims(); return new T.Vector3((D.armL + S0 + 2.7)/2, (0.45 + D.bottom)/2, 0); }
function resize(){
  const w = Math.max(1, wrap.clientWidth), h = Math.max(1, wrap.clientHeight);
  renderer.setPixelRatio(dprCur);
  renderer.setSize(w, h, false);
  const D = dims(), W = S0 + 2.9 - D.armL, H = 0.65 - D.bottom;
  const a = w/h, vh = Math.max(H*1.25, W*1.1/a);
  camera.left = -vh*a/2; camera.right = vh*a/2; camera.top = vh/2; camera.bottom = -vh/2;
  camera.updateProjectionMatrix();
  invalidate();
  if (started){ shopFinish(scene); renderer.render(scene, camera); }
}
let started = false;
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
const ground = new T.Mesh(new T.PlaneGeometry(120, 120), new T.ShadowMaterial({ opacity: 0.38 }));
ground.rotation.x = -Math.PI/2; ground.receiveShadow = true; scene.add(ground);

function applyGfx(name){
  gfx = GFX[name]; dprCur = dprCeil = gfx.maxDpr;
  key.castShadow = gfx.shadows; ground.visible = gfx.shadows;
  if (key.shadow.map){ key.shadow.map.dispose(); key.shadow.map = null; }
  key.shadow.mapSize.set(gfx.map, gfx.map);
  renderer.shadowMap.needsUpdate = true;
  resize(); updateGfxInfo();
}
function updateGfxInfo(){ $('gfxInfo').textContent = `Render scale ${Math.round(dprCur*100)}% · adapts automatically to hold 60 fps.`; }
function placeLights(){
  const c = center(), D = dims(), s = Math.max(S0 + 3 - D.armL, 1 - D.bottom)/2 + 1.2;
  key.position.set(c.x + 1.5, c.y + 12, c.z + 3.5); key.target.position.copy(c);
  const sc = key.shadow.camera;
  sc.left = -s; sc.right = s; sc.top = s; sc.bottom = -s; sc.near = 0.1; sc.far = 40; sc.updateProjectionMatrix();
  rimL.position.set(c.x - 4, c.y + 3, c.z - 7); rimL.target.position.copy(c);
  ground.position.set(c.x, D.bottom - 0.3, 0);
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
function hammerDraw(light){
  return (g, s) => {
    g.fillStyle = light ? '#ececec' : '#808080'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 2600; i++){
      const x = Math.random()*s, y = Math.random()*s, r = 2 + Math.random()*11;
      const up = Math.random() < 0.5, v = light ? (up ? 255 : 196) : (up ? 200 : 60);
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, `rgba(${v},${v},${v},${light ? 0.35 : 0.5})`);
      gr.addColorStop(1, `rgba(${v},${v},${v},0)`);
      g.fillStyle = gr;
      for (const dx of [-s, 0, s]) for (const dy of [-s, 0, s]){ g.beginPath(); g.arc(x + dx, y + dy, r, 0, TAU); g.fill(); }
    }
  };
}
const hammerBump = canvasTex(512, 512, hammerDraw(false), [0.55, 0.55]);
const hammerMap = canvasTex(512, 512, hammerDraw(true), [0.55, 0.55]); hammerMap.encoding = T.sRGBEncoding;
const rows = (g, w, h, base, amp, fine) => {
  for (let y = 0; y < h; y++){
    const v = base + amp*(Math.random() - 0.5) + fine*Math.sin(y*1.9);
    g.fillStyle = `rgb(${v|0},${v|0},${v|0})`; g.fillRect(0, y, w, 1);
  }
};
const brushed = canvasTex(256, 256, (g, w, h) => rows(g, w, h, 170, 150, 0), [1, 7]);
// turned finish: tight tool-feed rings (used along the lathe profile)
const turnedTex = canvasTex(32, 512, (g, w, h) => rows(g, w, h, 160, 130, 40));
// ground finish: fine straight scratches
const groundTex = canvasTex(512, 512, (g, w, h) => {
  rows(g, w, h, 180, 60, 0);
  g.globalAlpha = 0.25;
  for (let i = 0; i < 900; i++){ const y = Math.random()*h, v = Math.random() < 0.5 ? 255 : 60; g.strokeStyle = `rgb(${v},${v},${v})`; g.lineWidth = rand(0.5, 1.4); g.beginPath(); g.moveTo(rand(-50, w), y); g.lineTo(rand(0, w + 50), y + rand(-1.5, 1.5)); g.stroke(); }
}, [1.4, 1.4]);
// fly-cut milled face: overlapping arcs
const milledTex = canvasTex(512, 512, (g, w, h) => {
  g.fillStyle = '#b4b4b4'; g.fillRect(0, 0, w, h);
  const R = w*0.9;
  for (let k = -12; k < 70; k++){
    const cx = -R*0.35 + k*9, v = 120 + Math.random()*120;
    g.strokeStyle = `rgba(${v|0},${v|0},${v|0},0.55)`; g.lineWidth = rand(1.5, 4);
    for (const dy of [-h, 0, h]){ g.beginPath(); g.arc(cx, h/2 + dy, R, -Math.PI/2.6, Math.PI/2.6); g.stroke(); }
  }
}, [1.6, 1.6]);
// lapped gage-block finish: very fine random cross-hatch
const lappedTex = canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#c8c8c8'; g.fillRect(0, 0, w, h);
  g.globalAlpha = 0.18;
  for (let i = 0; i < 1600; i++){ const x = Math.random()*w, y = Math.random()*h, a = Math.random()*Math.PI, l = rand(4, 22), v = Math.random() < 0.5 ? 255 : 80;
    g.strokeStyle = `rgb(${v},${v},${v})`; g.lineWidth = 0.6; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a)*l, y + Math.sin(a)*l); g.stroke(); }
}, [3, 3]);
// cold-drawn bar: streaks along the length
const drawnTex = canvasTex(512, 16, (g, w, h) => {
  for (let x = 0; x < w; x++){ const v = 170 + 80*(Math.random() - 0.5); g.fillStyle = `rgb(${v|0},${v|0},${v|0})`; g.fillRect(x, 0, 1, h); }
}, [6, 1]);
const knurlBump = canvasTex(128, 128, (g, s) => {
  g.fillStyle = '#d0d0d0'; g.fillRect(0, 0, s, s); g.strokeStyle = '#1c1c1c'; g.lineWidth = 11;
  for (let k = -2; k <= 2; k++){
    g.beginPath(); g.moveTo(k*s, 0); g.lineTo(k*s + s, s); g.stroke();
    g.beginPath(); g.moveTo(k*s + s, 0); g.lineTo(k*s, s); g.stroke();
  }
}, [58, 9]);
const grooveBump = canvasTex(64, 64, (g, s) => { g.fillStyle = '#d0d0d0'; g.fillRect(0, 0, s, s); g.fillStyle = '#202020'; g.fillRect(s*0.35, 0, s*0.35, s); }, [44, 1]);
const pebble = canvasTex(128, 128, (g, s) => { g.fillStyle = '#808080'; g.fillRect(0, 0, s, s); for (let i = 0; i < 900; i++){ const v = Math.random() < 0.5 ? 200 : 50; g.fillStyle = `rgba(${v},${v},${v},0.5)`; g.beginPath(); g.arc(Math.random()*s, Math.random()*s, rand(0.6, 2), 0, TAU); g.fill(); } }, [8, 8]);

/* ---------- materials ---------- */
const std = o => new T.MeshStandardMaterial(o);
const M = {
  frame: std({ color: 0x3a74cc, map: hammerMap, bumpMap: hammerBump, bumpScale: 0.016, metalness: 0.35, roughness: 0.42, envMapIntensity: 0.9 }),
  chrome: std({ color: 0xf2f4f6, metalness: 1, roughness: 0.1 }),
  satin: std({ color: 0xdfe2e5, metalness: 1, roughness: 0.55, roughnessMap: brushed, bumpMap: brushed, bumpScale: 0.006, side: T.DoubleSide }),
  knurl: std({ color: 0xd6d9dc, metalness: 1, roughness: 0.5, roughnessMap: knurlBump, bumpMap: knurlBump, bumpScale: 0.04 }),
  carbide: std({ color: 0x80868d, metalness: 0.9, roughness: 0.22 }),
  ground: std({ color: 0xcfd3d7, metalness: 1, roughness: 0.3, roughnessMap: brushed, bumpMap: brushed, bumpScale: 0.0025 }),
  line: new T.MeshBasicMaterial({ color: 0x050505, side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, toneMapped: false }),
  outline: new T.MeshBasicMaterial({ color: 0x000000, side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, toneMapped: false }),
  pick: new T.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false })
};
M.frameD = M.frame.clone(); M.frameD.side = T.DoubleSide;
M.carbideD = M.carbide.clone(); M.carbideD.side = T.DoubleSide;
/* ---------- clear markings by default; the realistic metal finish is a setting ----------
   The turned and brushed finish puts streaks and reflections behind the graduations and makes them
   harder to read, so by default the surfaces that carry markings are a plain, even matte grey.
   "Realistic metal finish" in the sidebar brings the real finish back; the choice is remembered. */
const CLEAR_MATS = () => [[M.satin, 0xe2e4e7]];
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
// sample finishes
const PM = {

  turned:    std({ color: 0xc6cbd1, metalness: 1, roughness: 0.55, roughnessMap: turnedTex, bumpMap: turnedTex, bumpScale: 0.009, side: T.DoubleSide }),
  turnedAlu: std({ color: 0xd3d7dc, metalness: 0.95, roughness: 0.62, roughnessMap: turnedTex, bumpMap: turnedTex, bumpScale: 0.008, side: T.DoubleSide }),
  ground:    std({ color: 0xbfc4ca, metalness: 1, roughness: 0.42, roughnessMap: turnedTex, bumpMap: turnedTex, bumpScale: 0.004, side: T.DoubleSide }),
  milled:    std({ color: 0xb9bfc6, metalness: 1, roughness: 0.55, roughnessMap: milledTex, bumpMap: milledTex, bumpScale: 0.009 }),
  milledAlu: std({ color: 0xcdd2d8, metalness: 0.95, roughness: 0.62, roughnessMap: milledTex, bumpMap: milledTex, bumpScale: 0.008 }),
  lapped:    std({ color: 0xdadde1, metalness: 1, roughness: 0.22, roughnessMap: lappedTex, bumpMap: lappedTex, bumpScale: 0.0025 }),
  brass:     std({ color: 0xcfa64e, metalness: 1, roughness: 0.5, roughnessMap: drawnTex, bumpMap: drawnTex, bumpScale: 0.006 }),
  grip:      std({ color: 0x2c3036, metalness: 0, roughness: 0.8, bumpMap: pebble, bumpScale: 0.012, side: T.DoubleSide })
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
partFinish(PM.turnedAlu, 0.38, 0.6, { tone: 0.97 });
partFinish(PM.ground, 0.52, 0.44);
partFinish(PM.milled, 0.45, 0.58);
partFinish(PM.milledAlu, 0.36, 0.62, { tone: 0.97 });
partFinish(PM.lapped, 0.62, 0.3, { env: 0.6 });
partFinish(PM.brass, 0.55, 0.5);
const HLC = { num: cssVar('--hl-num'), line: cssVar('--hl-line'), thimble: cssVar('--hl-thimble'), vernier: cssVar('--hl-vernier') };
const hlMat = c => new T.MeshBasicMaterial({ color: new T.Color(c), side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6, toneMapped: false });
const HM = { num: hlMat(HLC.num), line: hlMat(HLC.line), thimble: hlMat(HLC.thimble), vernier: hlMat(HLC.vernier) };
const ACCENT = new T.Color(cssVar('--accent') || '#5b93ea');
const R = {
  satin: M.satin.clone(), chrome: M.chrome.clone(),
  black: std({ color: 0x19191b, metalness: 0.25, roughness: 0.5, bumpMap: grooveBump, bumpScale: 0.035 }),
  blackSmooth: std({ color: 0x19191b, metalness: 0.25, roughness: 0.35, side: T.DoubleSide })
};
Object.values(R).forEach(m => { m.emissive = ACCENT.clone(); m.emissiveIntensity = 0; });

const TYPES = {
  diameter:  { name: 'Diameter',     c: '#ff8a3d' },
  boss:      { name: 'Boss',         c: '#a78bfa' },
  flange:    { name: 'Flange',       c: '#2dd4bf' },
  thickness: { name: 'Thickness',    c: '#f472b6' },
  width:     { name: 'Width',        c: '#a3e635' },
  length:    { name: 'Length',       c: '#d59a6a' },
  step:      { name: 'Step',         c: '#e879f9' },
  flats:     { name: 'Across flats', c: '#e5e7eb' },
  reference: { name: 'Reference',    c: '#9aa0a8' }
};
const hullMats = {};
function hullMat(type){
  return hullMats[type] || (hullMats[type] = new T.ShaderMaterial({
    uniforms: { c: { value: new T.Color(TYPES[type].c) }, w: { value: 0.014 } },
    vertexShader: 'uniform float w; void main(){ vec3 p = position + normalize(normal)*w; gl_Position = projectionMatrix*modelViewMatrix*vec4(p,1.0); }',
    fragmentShader: 'uniform vec3 c; void main(){ gl_FragColor = vec4(c,1.0); }',
    side: T.BackSide
  }));
}

/* ---------- geometry helpers ---------- */
const P = (x, r, t) => [x, r*Math.sin(t), r*Math.cos(t)];
function cylX(r, x0, x1, mat, seg, open){
  const g = new T.CylinderGeometry(r, r, x1 - x0, seg || 64, 1, !!open);
  g.rotateZ(-Math.PI/2); g.translate((x0 + x1)/2, 0, 0);
  return new T.Mesh(g, mat);
}
function latheX(pts, mat, seg){
  const g = new T.LatheGeometry(pts.map(p => new T.Vector2(p[0], p[1])), seg || 96);
  g.rotateZ(-Math.PI/2);
  return new T.Mesh(g, mat);
}
// lathe along local z with hard corners and UVs that follow the profile (tool marks / facing rings)
function turnedGeo(profile, seg){
  const pts = [];
  profile.forEach((p, i) => { pts.push(p); if (p[2] && i > 0 && i < profile.length - 1) pts.push(p); });
  const g = new T.LatheGeometry(pts.map(p => new T.Vector2(Math.max(0, p[0]), p[1])), seg);
  const np = pts.length, cum = [0];
  for (let j = 1; j < np; j++) cum.push(cum[j - 1] + Math.hypot(pts[j][0] - pts[j - 1][0], pts[j][1] - pts[j - 1][1]));
  const uv = g.attributes.uv;
  for (let i = 0; i <= seg; i++) for (let j = 0; j < np; j++) uv.setXY(i*np + j, i/seg*6, cum[j]*6);
  uv.needsUpdate = true;
  g.rotateX(Math.PI/2);
  return g;
}
function roundedBox(x0, x1, y0, y1, z0, z1, c){
  const h = [(x1 - x0)/2, (y1 - y0)/2, (z1 - z0)/2], o = [(x0 + x1)/2, (y0 + y1)/2, (z0 + z1)/2];
  c = Math.min(c, h[0]/3, h[1]/3, h[2]/3);
  const Pt = (sg, k) => [0, 1, 2].map(i => sg[i]*(i === k ? h[i] : h[i] - c));
  const pos = [], uv = [];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross = (a, b) => [a[1]*b[2] - a[2]*b[1], a[2]*b[0] - a[0]*b[2], a[0]*b[1] - a[1]*b[0]];
  const poly = pts => {
    const cen = [0, 1, 2].map(i => pts.reduce((t, p) => t + p[i], 0)/pts.length);
    const n = cross(sub(pts[1], pts[0]), sub(pts[2], pts[0]));
    if (n[0]*cen[0] + n[1]*cen[1] + n[2]*cen[2] < 0) pts = pts.slice().reverse();
    const an = n.map(Math.abs), ax = an[0] >= an[1] && an[0] >= an[2] ? 0 : (an[1] >= an[2] ? 1 : 2);
    const u = ax === 0 ? 1 : 0, v = ax === 2 ? 1 : 2;
    for (let k = 1; k < pts.length - 1; k++) for (const p of [pts[0], pts[k], pts[k + 1]]){
      pos.push(p[0] + o[0], p[1] + o[1], p[2] + o[2]);
      uv.push(p[u] + o[u], p[v] + o[v]);
    }
  };
  const S = [-1, 1];
  for (let k = 0; k < 3; k++){
    const a = (k + 1) % 3, b = (k + 2) % 3;
    for (const s0 of S){
      const q = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sa, sb]) => { const sg = [0, 0, 0]; sg[k] = s0; sg[a] = sa; sg[b] = sb; return Pt(sg, k); });
      poly(q);
    }
  }
  for (const [a, b] of [[0, 1], [0, 2], [1, 2]]){
    const oo = 3 - a - b;
    for (const sa of S) for (const sb of S){
      const sg = so => { const g = [0, 0, 0]; g[a] = sa; g[b] = sb; g[oo] = so; return g; };
      poly([Pt(sg(-1), a), Pt(sg(1), a), Pt(sg(1), b), Pt(sg(-1), b)]);
    }
  }
  for (const sx of S) for (const sy of S) for (const sz of S){
    const sg = [sx, sy, sz];
    poly([Pt(sg, 0), Pt(sg, 1), Pt(sg, 2)]);
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}
function Strip(){ this.p = []; this.i = []; }
Strip.prototype.q = function(a, b, c, d){ const n = this.p.length/3; this.p.push(...a, ...b, ...c, ...d); this.i.push(n, n+1, n+2, n, n+2, n+3); };
Strip.prototype.circ = function(x, r, t0, t1, w){
  const n = Math.max(2, Math.ceil((t1 - t0)/0.05));
  for (let k = 0; k < n; k++){
    const a = t0 + (t1 - t0)*k/n, b = t0 + (t1 - t0)*(k + 1)/n;
    this.q(P(x - w/2, r, a), P(x + w/2, r, a), P(x + w/2, r, b), P(x - w/2, r, b));
  }
  return this;
};
Strip.prototype.axial = function(x0, x1, rf, t, w, seg){
  const n = seg || Math.max(1, Math.ceil((x1 - x0)/0.06));
  for (let k = 0; k < n; k++){
    const xa = x0 + (x1 - x0)*k/n, xb = x0 + (x1 - x0)*(k + 1)/n;
    const ra = rf(xa), rb = rf(xb), da = w/2/ra, db = w/2/rb;
    this.q(P(xa, ra, t - da), P(xb, rb, t - db), P(xb, rb, t + db), P(xa, ra, t + da));
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
  const mat = new T.MeshBasicMaterial({ map: tex, color: 0x050505, transparent: true, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  const hl = new T.MeshBasicMaterial({ map: tex, color: new T.Color(HLC.num), transparent: true, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -7, polygonOffsetUnits: -7 });
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
function cylMtx(x, r, t){ const m = new T.Matrix4().makeRotationX(-t); const p = P(x, r, t); m.setPosition(p[0], p[1], p[2]); return m; }
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
function HL(parent, mat, geosC, geosO){
  const o = new T.Mesh(geosO[0], M.outline), c = new T.Mesh(geosC[0], mat);
  c.renderOrder = 4; c.visible = false;
  c.userData.noShadow = true;
  parent.add(c);
  return { set(i){ if (i < 0 || i >= geosC.length){ c.visible = false; return; } c.geometry = geosC[i]; c.visible = true; } };
}

/* ---------- build micrometer ---------- */
const root = new T.Group(); scene.add(root);
const pickables = [];
function pickable(m, kind){ m.userData.kind = kind; pickables.push(m); return m; }
let thG, ratchetG, leverR, halo = [], HLs = {}, trash = [], lockHulls = [];
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
  uniforms: { c: { value: new T.Color('#ff3b30') }, w: { value: 0.009 } },
  vertexShader: 'uniform float w; void main(){ vec3 p = position + normalize(normal)*w; gl_Position = projectionMatrix*modelViewMatrix*vec4(p,1.0); }',
  fragmentShader: 'uniform vec3 c; void main(){ gl_FragColor = vec4(c,1.0); }',
  side: T.BackSide
});
let partG = null, setupG = null, flipG = null, primMeshes = [], hullMeshes = [], hullFeat = '';

function disposeTree(o){
  o.traverse(c => {
    if (c.geometry) c.geometry.dispose();
    if (c.userData.hull) c.userData.hull.dispose();
    if (c.userData.ownMat && c.material){ if (c.material.map) c.material.map.dispose(); c.material.dispose(); }
  });
}
function shadows(o){ o.traverse(c => { if (c.isMesh && !c.userData.noShadow) c.castShadow = true; }); }

function cPath(p, d, D){
  p.moveTo(D.armL + d, 0.08);
  p.lineTo(D.armL + d, D.cy);
  p.absellipse(D.cx, D.cy, D.rxo - d, D.ryo - d, Math.PI, TAU, false);
  p.lineTo(D.hubR - d, 0.14);
  p.absarc(D.hubR - 0.2, 0.14, 0.2 - d, 0, Math.PI/2, false);
  p.lineTo(D.hx + 0.2, 0.34 - d);
  p.absarc(D.hx + 0.2, 0.14, 0.2 - d, Math.PI/2, Math.PI, false);
  p.lineTo(D.hx + d, D.cy);
  p.absellipse(D.cx, D.cy, D.rxi + d, D.ryi + d, 0, Math.PI, true);
  p.lineTo(D.armR - d, 0.08);
  p.absarc(D.armL + D.ar, 0.08, D.ar - d, 0, Math.PI, false);
  return p;
}

function build(){
  removeSample();
  while (root.children.length){ const c = root.children[0]; disposeTree(c); root.remove(c); }
  trash.forEach(g => g.dispose()); trash = [];
  pickables.length = 0; halo = [];
  const D = dims();
  S0 = D.hubR + 0.20;

  const coreG = new T.ExtrudeGeometry(cPath(new T.Shape(), 0, D), { depth: 0.28*D.zs, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.012, bevelSegments: 2, curveSegments: 64 });
  coreG.translate(0, 0, -0.14*D.zs);
  root.add(pickable(new T.Mesh(coreG, M.frame), 'none'));
  const rim = cPath(new T.Shape(), 0, D);
  rim.holes.push(cPath(new T.Path(), 0.065 + 0.01*B, D));
  const rimG = new T.ExtrudeGeometry(rim, { depth: 0.36*D.zs, bevelEnabled: true, bevelThickness: 0.022, bevelSize: 0.014, bevelSegments: 3, curveSegments: 64 });
  rimG.translate(0, 0, -0.18*D.zs);
  root.add(pickable(new T.Mesh(rimG, M.frame), 'none'));

  const ny = D.cy - (D.ryi + D.ryo)/2;
  const plate = label(`${B}–${B + 1} in      .0001 in`, 0.07 + 0.012*B, '#dfe2e6', '#0f1012');
  plate.position.set(D.cx, ny, D.coreFront + 0.004);
  root.add(plate);
  const bez = new T.Mesh(new T.BoxGeometry(plate.geometry.parameters.width + 0.03, plate.geometry.parameters.height + 0.03, 0.014), M.chrome);
  bez.position.set(D.cx, ny, D.coreFront - 0.006); root.add(bez);

  root.add(pickable(cylX(SP_R, -0.32, -0.03, M.ground, 48), 'none'));
  root.add(pickable(latheX([[SP_R, -0.03], [SP_R, -0.007], [SP_R - 0.007, 0], [0, 0]], M.carbideD, 48), 'none'));
  root.add(pickable(latheX([[SP_R, -0.075], [0.14, -0.088], [0.145, -0.1], [0.145, -0.3], [SP_R, -0.3]], M.frameD, 48), 'none'));
  root.add(pickable(cylX(0.145, B + 1.03, D.hx + 0.01, M.chrome), 'none'));
  root.add(pickable(latheX([[SLV_R, D.hubR - 0.01], [0.325, D.hubR], [0.328, D.hubR + 0.02], [0.328, D.hubR + 0.07], [0.31, D.hubR + 0.09], [SLV_R, D.hubR + 0.09]], M.chrome, 96), 'none'));

  // spindle lock
  const lg = new T.Group(); lg.position.set(D.hx + 0.2, 0.13, D.coreFront - 0.003); root.add(lg);
  const seat = new T.Mesh(new T.CylinderGeometry(0.1, 0.105, 0.04, 40), M.chrome);
  seat.rotation.x = Math.PI/2; seat.position.z = 0.02; lg.add(pickable(seat, 'lever'));
  const ball = new T.Mesh(new T.SphereGeometry(0.085, 32, 20), M.chrome);
  ball.position.z = 0.055; lg.add(pickable(ball, 'lever'));
  leverR = new T.Group(); leverR.position.z = 0.05 + 0.04*D.zs; lg.add(leverR);
  leverR.add(pickable(new T.Mesh(new T.TorusGeometry(0.1, 0.018, 12, 40), M.chrome), 'lever'));
  const armG = new T.CylinderGeometry(0.013, 0.02, 0.26, 16);
  armG.rotateZ(-Math.PI/2); armG.translate(0.23, 0, 0);
  leverR.add(pickable(new T.Mesh(armG, M.chrome), 'lever'));
  const tip = new T.Mesh(new T.SphereGeometry(0.026, 16, 12), M.chrome);
  tip.scale.set(1.4, 1, 0.8); tip.position.x = 0.37; leverR.add(pickable(tip, 'lever'));
  const lpick = new T.Mesh(new T.BoxGeometry(0.4, 0.09, 0.09), M.pick);
  lpick.position.x = 0.2; lpick.userData.noShadow = true; leverR.add(pickable(lpick, 'lever'));
  lockHulls = [];
  [seat, ball, ...leverR.children.filter(c => c !== lpick)].forEach(m => {
    const h = new T.Mesh(hullGeo(m), LOCK_HULL);
    h.visible = state.locked; h.userData.noShadow = true;
    h.position.copy(m.position); h.rotation.copy(m.rotation); h.scale.copy(m.scale);
    m.parent.add(h); lockHulls.push(h);
  });
  lockParts = [];
  [seat, ball, ...leverR.children].forEach(m => lockParts.push(...lockMeshes(m)));
  paintLock(lockParts, state.locked);

  // sleeve (fixed)
  const sleeveG = new T.Group(); root.add(sleeveG);
  sleeveG.add(pickable(cylX(SLV_R, D.hubR, S0 + 1.10, M.satin, 96), 'none'));
  const Rr = SLV_R + 0.0015, rS = () => Rr;
  const base = new Strip(); base.axial(S0 - 0.06, S0 + 1.10, rS, 0, 0.008, 1);
  const tickC = [], tickO = [], numC = [], numO = [], tb = new TextBatch();
  for (let i = 0; i <= 40; i++){
    const x = S0 + i*0.025, L = i % 4 === 0 ? 0.085 : (i % 2 === 0 ? 0.055 : 0.04);
    base.circ(x, Rr, 0, L/Rr, 0.0075);
    tickO.push(new Strip().circ(x, Rr + 0.0003, 0, (L + 0.004)/Rr, 0.012).geo());
    tickC.push(new Strip().circ(x, Rr + 0.0006, 0, L/Rr, 0.0078).geo());
    if (i % 4 === 0){
      const t = (L + 0.04)/Rr, s = String(i/4);
      const sz = tb.add(s, 0.05, cylMtx(x, Rr + 0.001, t));
      const one = new TextBatch(); one.add(s, 0.05, cylMtx(x, Rr + 0.0015, t)); numC.push(one.geo());
      const hw = sz.W/2 + 0.004, ht = (sz.H/2 + 0.004)/Rr, w = 0.005, box = new Strip();
      box.circ(x - hw, Rr + 0.001, t - ht, t + ht, w).circ(x + hw, Rr + 0.001, t - ht, t + ht, w);
      box.axial(x - hw, x + hw, rS, t - ht, w, 1).axial(x - hw, x + hw, rS, t + ht, w, 1);
      numO.push(box.geo());
    }
  }
  const vernC = [], vernO = [];
  for (let k = 0; k < 10; k++){
    const t = VERN0 + k*VSTEP;
    base.axial(S0 - 0.06, S0 + 1.10, rS, t, 0.007, 1);
    vernO.push(new Strip().axial(S0 - 0.06, S0 + 1.10, () => Rr + 0.0003, t, 0.011, 1).geo());
    vernC.push(new Strip().axial(S0 - 0.06, S0 + 1.10, () => Rr + 0.0006, t, 0.0073, 1).geo());
    tb.add(String(k), 0.036, cylMtx(S0 - 0.088, Rr + 0.001, t));
  }
  const bm = new T.Mesh(base.geo(), M.line); bm.renderOrder = 1; bm.userData.noShadow = true; sleeveG.add(bm);
  const tm = new T.Mesh(tb.geo(), atlas.mat); tm.renderOrder = 2; tm.userData.noShadow = true; sleeveG.add(tm);
  const numBox = new T.Mesh(numO[0], HM.num); numBox.renderOrder = 4; numBox.visible = false; numBox.userData.noShadow = true; sleeveG.add(numBox);
  const numTxt = new T.Mesh(numC[0], atlas.hl); numTxt.renderOrder = 5; numTxt.visible = false; numTxt.userData.noShadow = true; sleeveG.add(numTxt);
  HLs.num = { set(i){ if (i < 0 || i >= numC.length){ numBox.visible = numTxt.visible = false; return; } numBox.geometry = numO[i]; numTxt.geometry = numC[i]; numBox.visible = numTxt.visible = true; } };
  HLs.line = HL(sleeveG, HM.line, tickC, tickO);
  HLs.vA = HL(sleeveG, HM.vernier, vernC, vernO);
  trash.push(...tickC, ...tickO, ...numC, ...numO, ...vernC, ...vernO);

  // thimble
  thG = new T.Group(); root.add(thG);
  thG.add(pickable(latheX([[0.292, 0], [TH_EDGE_R, 0], [TH_R, 0.09], [TH_R, 0.58], [KN_R, 0.62], [KN_R, 1.02], [0.34, 1.08], [0.30, 1.13], [0.2, 1.13]], M.satin, 128), 'thimble'));
  thG.add(pickable(cylX(KN_R + 0.0015, 0.625, 1.015, M.knurl, 128, true), 'thimble'));
  const rT = x => (x < 0.09 ? TH_EDGE_R + (TH_R - TH_EDGE_R)*(x/0.09) : TH_R) + 0.0015;
  const tl = new Strip(), thC = [], thO = [], ttb = new TextBatch();
  for (let v = 0; v < 25; v++){
    const t = v*DIV, L = v % 5 === 0 ? 0.30 : 0.19;
    const W = 0.0085, K = 0.09;
    tl.axial(0, K, rT, t, W, 3).axial(K, L, rT, t, W, 1);
    thO.push(new Strip().axial(0, K, rT, t, W, 3).axial(K, L, rT, t, W, 1).geo());
    thC.push(new Strip().axial(0, K, x => rT(x) + 0.0006, t, W + 0.0003, 3).axial(K, L, x => rT(x) + 0.0006, t, W + 0.0003, 1).geo());
    if (v % 5 === 0) ttb.add(String(v), 0.06, cylMtx(0.40, TH_R + 0.0025, t));
  }
  const tlm = new T.Mesh(tl.geo(), M.line); tlm.renderOrder = 1; tlm.userData.noShadow = true; thG.add(tlm);
  const ttm = new T.Mesh(ttb.geo(), atlas.mat); ttm.renderOrder = 2; ttm.userData.noShadow = true; thG.add(ttm);
  HLs.thimble = HL(thG, HM.thimble, thC, thO);
  HLs.tA = HL(thG, HM.vernier, thC, thO);
  trash.push(...thC, ...thO);
  // spindle: face sits at x = B + reading (thimble edge at S0 + reading marks the frame's zero)
  const face = B - S0;
  thG.add(pickable(cylX(SP_R, face + 0.03, 0.95, M.ground, 48), 'none'));
  thG.add(pickable(latheX([[0, face], [SP_R - 0.007, face], [SP_R, face + 0.007], [SP_R, face + 0.03]], M.carbideD, 48), 'none'));

  // ratchet stop
  ratchetG = new T.Group(); thG.add(ratchetG);
  ratchetG.add(pickable(cylX(0.2, 1.12, 1.205, R.satin, 48), 'ratchet'));
  ratchetG.add(pickable(latheX([[0.20, 1.20], [0.255, 1.23], [0.27, 1.27], [0.27, 1.31], [0.25, 1.325], [0.24, 1.325], [0, 1.325]], R.chrome, 72), 'ratchet'));
  ratchetG.add(pickable(cylX(0.24, 1.32, 1.58, R.black, 72, true), 'ratchet'));
  ratchetG.add(pickable(latheX([[0.24, 1.58], [0.232, 1.605], [0.19, 1.635], [0, 1.645]], R.blackSmooth, 72), 'ratchet'));
  ratchetG.traverse(o => o.layers.enable(1));
  for (let i = 0; i < 2; i++){
    const g = new T.TorusGeometry(0.30, i ? 0.006 : 0.012, 8, 96); g.rotateY(Math.PI/2);
    const h = new T.Mesh(g, new T.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0, depthTest: false, depthWrite: false, toneMapped: false }));
    h.position.x = 1.45; h.layers.set(1); h.renderOrder = 10000; h.userData.noShadow = true; h.userData.ownMat = true;
    ratchetG.add(h); halo.push(h);
  }
  shadows(root);
  hlKey = '';
}

/* ---------- samples ---------- */

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

// what is seen of a sample: one solid. Stepped turned parts become a single turned profile, stacked
// blocks a single extruded profile, anything else is merged into one mesh. The separate pieces stay
// behind, invisible, for clicking and for the feature outlines.
const PM_GHOST = new T.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
function wholeMesh(prims){
  const turned = prims.every(p => (p.t === 'cz' && !p.hex) || p.t === 'rz') && prims.every(p => !p.cx && !p.cy) && prims.every(p => p.mat === prims[0].mat);
  if (turned){
    const c = Math.min(...prims.map(p => p.cham || 0.012));
    const pts = unionPath(prims.map(p => ({ a0: p.t === 'rz' ? p.ri : 0, a1: p.t === 'rz' ? p.ro : p.r, b0: p.z0, b1: p.z1 })), c);
    return new T.Mesh(turnedGeo(pts.map(q => [q[0], q[1], 1]), 72), PM[prims[0].mat] || PM.turned);
  }
  const boxes = prims.every(p => p.t === 'box') && prims.every(p => p.y0 === prims[0].y0 && p.y1 === prims[0].y1 && p.x0 === prims[0].x0) && prims.every(p => p.mat === prims[0].mat);
  if (boxes){
    const pts = unionPath(prims.map(p => ({ a0: p.x0, a1: p.x1, b0: p.z0, b1: p.z1 })));
    const sh = new T.Shape(pts.map(([x, z]) => new T.Vector2(x, -z)));
    const g = new T.ExtrudeGeometry(sh, { depth: prims[0].y1 - prims[0].y0, bevelEnabled: false });
    g.rotateX(-Math.PI/2); g.translate(0, prims[0].y0, 0);
    return new T.Mesh(g, PM[prims[0].mat] || PM.milled);
  }
  const geos = prims.map(p => { const m = primMesh(p); m.updateMatrix(); const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry; g.applyMatrix4(m.matrix); return g; });
  const keep = ['position', 'normal', 'uv'];
  geos.forEach(g => Object.keys(g.attributes).forEach(k => { if (!keep.includes(k)) g.deleteAttribute(k); }));
  geos.forEach(g => { if (!g.attributes.uv) g.setAttribute('uv', new T.Float32BufferAttribute(new Float32Array(g.attributes.position.count*2), 2)); if (!g.attributes.normal) g.computeVertexNormals(); });
  const merged = T.BufferGeometryUtils.mergeBufferGeometries(geos, true);
  return new T.Mesh(merged, prims.map(p => PM[p.mat] || PM.turned));
}
function primMesh(p){
  let g;
  if (p.t === 'box') g = roundedBox(p.x0, p.x1, p.y0, p.y1, p.z0, p.z1, 0.012);
  else if (p.hex){
    g = new T.CylinderGeometry(p.r, p.r, p.z1 - p.z0, 6, 1);
    g.rotateX(Math.PI/2); g.translate(0, 0, (p.z0 + p.z1)/2);
  } else if (p.t === 'rz'){
    const c = p.cham || 0.01, ri = p.ri, ro = p.ro, a = p.z0, b = p.z1;
    g = turnedGeo([[ri + c, a], [ro - c, a, 1], [ro, a + c, 1], [ro, b - c, 1], [ro - c, b, 1], [ri + c, b, 1], [ri, b - c, 1], [ri, a + c, 1], [ri + c, a]], 72);
  } else {
    const c = p.cham || 0, r = p.r, a = p.z0, b = p.z1;
    g = turnedGeo([[0, a], [r - c, a, 1], [r, a + c, 1], [r, b - c, 1], [r - c, b, 1], [0, b]], 72);
  }
  if (p.cx || p.cy) g.translate(p.cx || 0, p.cy || 0, 0);
  const m = new T.Mesh(g, PM[p.mat] || PM.turned);
  return m;
}
function fillSampleOptions(){
  const keys = CORE.available(B);
  $('sampleSel').innerHTML = keys.map(k => `<option value="${k}">${CORE.DEFS[k].name}</option>`).join('') + '<option value="none">No sample</option>';
  if (state.sampleKey !== 'none' && !keys.includes(state.sampleKey)) state.sampleKey = 'shaft';
  $('sampleSel').value = state.sampleKey;
}
function removeSample(){
  if (!partG) return;
  const set = new Set(); partG.traverse(o => set.add(o));
  const keep = pickables.filter(p => !set.has(p)); pickables.length = 0; pickables.push(...keep);
  disposeTree(partG); root.remove(partG);
  partG = setupG = flipG = null; primMeshes = []; hullMeshes = []; hullFeat = '';
}
function newSample(key, keepSel){
  state.sampleKey = key;
  const prevSel = state.sample && state.sample.sel;
  removeSample();
  state.seq = null; state.partTarget = null;
  if (key === 'none' || !CORE.DEFS[key]){ state.sample = null; state.ev = null; renderFeats(); updateAll(); return; }
  const S = CORE.makeSample(key, B, Math.random);
  S.guesses = {}; S.results = {}; S.revealed = S.ref;
  const valid = S.feats.filter(f => f.valid);
  S.sel = keepSel && valid.some(f => f.id === prevSel) ? prevSel : valid[0].id;
  state.sample = S;
  partG = new T.Group(); setupG = new T.Group(); flipG = new T.Group();
  partG.add(setupG); setupG.add(flipG);
  const whole = S.prims.length > 1 ? wholeMesh(S.prims) : null;
  if (whole){ flipG.add(pickable(whole, 'part')); whole.userData.ownGeo = true; }
  primMeshes = S.prims.map(p => {
    const m = primMesh(p);
    if (whole){ m.material = PM_GHOST; m.userData.noShadow = true; }
    flipG.add(pickable(m, 'part'));
    if (p.label){
      const small = p.x1 - p.x0 < 0.3;
      const lb = label(p.label, small ? 0.045 : 0.07, '#2a2e33');
      lb.position.set((p.x0 + p.x1)/2, 0, p.z1 + 0.0015);
      if (small) lb.rotation.z = Math.PI/2;
      flipG.add(lb);
    }
    return m;
  });
  shadows(partG);
  root.add(partG);
  const t = S.targets[S.sel];
  setSetup(t.s, -1, true);
  renderFeats();
}
function setSetup(id, side, atRest){
  const S = state.sample, s = S.setups[id];
  state.setup = id; state.side = side;
  flipG.rotation.set(s.flip ? Math.PI : 0, 0, 0);
  setupG.rotation.set(0, s.ry ? Math.PI/2 : 0, 0);
  setupG.position.set(...(s.pos || [0, 0, 0]));
  // start aligned the way the part will sit once it reaches the faces
  const t = Object.values(S.targets).find(x => x.s === id);
  const e = t ? CORE.evalAt(S, id, t.z, null, B) : null;
  state.sxT = state.sxV = e ? e.sx : 0;
  if (atRest) state.partZ = CORE.restZ(S, id, B, side);
  refreshEval();
  renderer.shadowMap.needsUpdate = true;
  invalidate();
}
function refreshEval(){
  const S = state.sample;
  if (!S){ state.ev = null; return; }
  state.ev = CORE.evalAt(S, state.setup, state.partZ, state.sxT, B);
  state.sxT = state.ev.sx;
  updateHull();
}
function hullGeo(m){
  if (m.userData.hull) return m.userData.hull;
  let g = m.geometry.clone();
  g.deleteAttribute('normal'); if (g.attributes.uv) g.deleteAttribute('uv');
  if (T.BufferGeometryUtils && T.BufferGeometryUtils.mergeVertices) g = T.BufferGeometryUtils.mergeVertices(g, 1e-4);
  g.computeVertexNormals();
  return m.userData.hull = g;
}
function updateHull(){
  const S = state.sample, ev = state.ev;
  const feat = ev && ev.feat && state.hl.outline !== false ? ev.feat : '';
  const k = state.setup + '|' + feat;
  if (k === hullFeat) return; hullFeat = k;
  hullMeshes.forEach(h => flipG.remove(h)); hullMeshes = [];
  if (!feat) { invalidate(); return; }
  const f = S.feats.find(x => x.id === feat);
  const hm = hullMat(f.type); hm.uniforms.w.value = 0.012 + 0.003*B;
  CORE.hlPrims(S, feat, state.setup).forEach(i => {
    const h = new T.Mesh(hullGeo(primMeshes[i]), hm); h.userData.noShadow = true;
    flipG.add(h); hullMeshes.push(h);
  });
  invalidate();
}

const minReading = () => state.ev && state.ev.eff ? state.ev.minFrac : 0;
const between = () => !!(state.ev && state.ev.eff);
const isContact = () => between() && Math.abs(state.reading - state.ev.minFrac) < 5e-7;
function slideRange(){ const S = state.sample; return [CORE.restZ(S, state.setup, B, -1), CORE.restZ(S, state.setup, B, 1)]; }
function openingTo(){ return state.anim && state.anim.type === 'to' && state.anim.target > state.reading ? state.anim.target : state.reading; }
function okAt(e){ return !e.blocked && (!e.eff || e.minFrac <= openingTo() + 1e-7); }
// the spindle backs off to its maximum whenever the part is being moved
function openForMove(){
  if (state.locked || state.reading >= 1 - 1e-7) return;
  if (state.anim && state.anim.type === 'to' && state.anim.target >= 1) return;
  state.anim = { type: 'to', target: 1, fast: true };
}

// move the part along its slide, stopping at the first point it would hit the frame or the spindle
function movePartTo(z){
  const S = state.sample; if (!S) return false;
  const [lo, hi] = slideRange();
  z = Math.max(lo, Math.min(hi, z));
  const at = zz => CORE.evalAt(S, state.setup, zz, state.sxT, B);
  let e = at(z), target = z;
  if (!okAt(e)){
    let a = state.partZ, b = z;
    for (let i = 0; i < 14; i++){ const mid = (a + b)/2; if (okAt(at(mid))) a = mid; else b = mid; }
    target = a; e = at(a);
    toast(e.blocked || at(b).blocked
      ? (at(b).tooBig ? 'That part of the sample is too big for this frame' : 'The sample would hit the frame there')
      : 'The spindle is closed too far — open it to slide onto the larger size');
  }
  const moved = Math.abs(target - state.partZ) > 1e-6;
  state.partZ = target; state.ev = e; state.sxT = e.sx;
  updateHull();
  return moved && Math.abs(target - z) < 1e-6;
}

/* ---------- feature cards ---------- */
const fmt = v => (v < 0 ? '−' : '') + Math.abs(v).toFixed(4);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function renderFeats(){
  const box = $('feats'), S = state.sample;
  $('revealBtn').textContent = S && S.revealed ? 'Hide actual' : 'Show actual';
  $('revealBtn').disabled = !S;
  if (!S){ box.innerHTML = '<p class="note" style="margin:8px 0 0">No sample selected.</p>'; return; }
  box.innerHTML = S.feats.filter(f => f.valid).map(f => {
    const t = TYPES[f.type];
    return `<div class="fcard${S.sel === f.id ? ' sel' : ''}" style="--c:${t.c}">
      <button class="fhead" data-select="${f.id}" aria-pressed="${S.sel === f.id}" title="Slide this feature between the faces"><i class="sw" style="--c:${t.c}"></i><span class="fname">${esc(f.label)}</span><span class="ftype">${t.name}</span></button>
      ${S.revealed ? `<div class="fres">Actual ${S.vals[f.id].toFixed(4)}″</div>` : ''}</div>`;
  }).join('');
}

/* ---------- positioning sequence: out → switch setup → open → slide in → (ratchet) ---------- */
function goToFeature(id, close){
  const S = state.sample; if (!S) return;
  const t = S.targets[id]; if (!t) return;
  endCoach();
  if (state.locked) setLock(false);
  stopAnim();
  S.sel = id; renderFeats();
  let plan = null;
  if (t.s === state.setup){
    const p = CORE.pathInfo(S, t.s, state.partZ, t.z, B);
    if (p.ok) plan = { switchTo: null, need: p.maxF };
  }
  if (!plan){
    for (const sd of [-1, 1]){
      const rz = CORE.restZ(S, t.s, B, sd), p = CORE.pathInfo(S, t.s, rz, t.z, B);
      if (p.ok){ plan = { switchTo: { s: t.s, side: sd }, need: p.maxF }; break; }
    }
  }
  if (!plan){ toast('That feature can’t be reached in this frame'); return; }
  state.seq = { stage: plan.switchTo ? 'prep' : 'open', id, close, z: t.z, need: plan.need, sw: plan.switchTo };
}
function stepSeq(){
  const q = state.seq, S = state.sample;
  if (!q || !S){ state.seq = null; return; }
  if (q.stage === 'prep'){
    // open fully so the part can leave without catching on the spindle
    if (state.ev && state.ev.inSlab){
      if (state.reading < 1 - 1e-7){ if (!state.anim) goTo(1, true); return; }
      if (state.anim) return;
      state.partTarget = CORE.restZ(S, state.setup, B, state.partZ >= 0 ? 1 : -1);
    }
    q.stage = 'out';
  }
  if (q.stage === 'out'){
    if (state.partTarget !== null) return;
    setSetup(q.sw.s, q.sw.side, true);
    q.stage = 'open';
  }
  if (q.stage === 'open'){
    if (state.reading < 1 - 1e-7){ openForMove(); return; }
    if (state.anim) return;
    state.partTarget = q.z; q.stage = 'slide'; return;
  }
  if (q.stage === 'slide'){
    if (state.partTarget !== null) return;
    if (Math.abs(state.partZ - q.z) > 0.003){ state.seq = null; return; }
    if (q.close){ ratchetClose(); q.stage = 'close'; } else state.seq = null;
    return;
  }
  if (q.stage === 'close' && !state.anim){
    state.seq = null;
    if (!state.practice && state.ev && state.ev.eff) toast(`Measured ${(B + state.reading).toFixed(4)}″`);
  }
}

/* ---------- units: inches by default, millimeters on request ---------- */
let units = 'in';
try { units = localStorage.getItem('pt-units') === 'mm' ? 'mm' : 'in'; } catch (e) {}
const MM_STEPS = [-0.5,-0.01,-0.002,0.5,0.01,0.002];
// the Go to hint: an example inside this range, in the unit a plain number is read as
const goHint = () => units === 'mm' ? `Go to ${((B + 0.6254)*25.4).toFixed(2)} mm` : `Go to ${(B + 0.6254).toFixed(4)} in`;
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
  if (!S){ toast('Choose a sample first'); return; }
  const det = state.ev && state.ev.feat;
  if (det && Math.abs(state.partZ - (S.targets[det] || {}).z) < 0.003 && S.targets[det].s === state.setup){ S.sel = det; renderFeats(); goToFeature(det, true); return; }
  if (between() && !det){ endCoach(); if (state.locked) setLock(false); ratchetClose(); return; }
  goToFeature(S.sel, true);
}
function slideOut(){
  const S = state.sample; if (!S) return;
  state.seq = null;
  state.partTarget = CORE.restZ(S, state.setup, B, state.partZ > 0 ? 1 : -1);
}
function nextSetup(){
  const S = state.sample; if (!S) return;
  const ids = [...new Set(S.feats.filter(f => f.valid).map(f => S.targets[f.id].s))];
  if (ids.length < 2){ toast('This sample has only one way to hold it'); return; }
  const next = ids[(ids.indexOf(state.setup) + 1) % ids.length];
  const f = S.feats.find(x => x.valid && S.targets[x.id].s === next);
  goToFeature(f.id, true);
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
const cylAnchor = (x, r, t) => ({ p: new T.Vector3(x, r*Math.sin(t), r*Math.cos(t)), n: new T.Vector3(0, Math.sin(t), Math.cos(t)) });
function nameplateAnchor(){ const D = dims(); return { p: new T.Vector3(D.cx, D.cy - (D.ryi + D.ryo)/2, D.coreFront + 0.01), n: new T.Vector3(0, -0.35, 1).normalize() }; }
const EXAM = [
  ['Frame', 'Holds the anvil and spindle rigidly in line', () => { const D = dims(), a = Math.PI*1.2, rx = (D.rxi + D.rxo)/2, ry = (D.ryi + D.ryo)/2; return { p: new T.Vector3(D.cx + rx*Math.cos(a), D.cy + ry*Math.sin(a), D.rimFront), n: new T.Vector3(Math.cos(a), Math.sin(a), 0.8).normalize() }; }],
  ['Anvil', 'Fixed measuring face', () => ({ p: new T.Vector3(-0.06, SP_R, 0), n: new T.Vector3(-0.3, 1, 0.2).normalize() })],
  ['Measuring faces', '0.256″ carbide tips', () => ({ p: new T.Vector3((B + state.reading)/2, 0, 0), n: new T.Vector3(0, -0.6, 1).normalize() })],
  ['Spindle', 'Moves 0.025″ per turn (40 TPI)', () => ({ p: new T.Vector3(B + state.reading + Math.max(0.02, Math.min(0.5, (1.03 - state.reading)/2)), SP_R, 0), n: new T.Vector3(0, 1, 0.25).normalize() })],
  ['Spindle lock', 'Flip to hold the reading', () => { const D = dims(); return { p: new T.Vector3(D.hx + 0.2, 0.13, D.coreFront + 0.1), n: new T.Vector3(-0.2, 0.8, 0.6).normalize() }; }],
  ['Frame size', '', nameplateAnchor],
  ['Sleeve (barrel)', 'Fixed; carries the main scale', () => cylAnchor((dims().hubR + S0)/2 + 0.02, SLV_R, -0.9)],
  ['Index line', 'Reference line for the thimble', () => cylAnchor(S0 - 0.04, SLV_R, 0)],
  ['Main scale', 'Numbers = 0.100″, lines = 0.025″', () => cylAnchor(S0 + Math.min(state.reading, 0.2)*0.5, SLV_R, 0.45)],
  ['Vernier scale', 'Adds the 0.0001″ digit', () => cylAnchor(S0 + state.reading - 0.18, SLV_R, Math.PI/2)],
  ['Thimble', 'Turn to move the spindle', () => cylAnchor(S0 + state.reading + 0.45, TH_R, -0.8)],
  ['Thimble scale', '25 lines, 0.001″ each', () => cylAnchor(S0 + state.reading + 0.12, TH_R, 0.6)],
  ['Ratchet stop', 'Turn this to close with steady pressure', () => cylAnchor(S0 + state.reading + 1.45, 0.24, -0.5)]
];
let examTags = [], errTags = {}, errArrows = {}, examLabels = true;
function setExam(on){
  state.exam = on;
  document.body.classList.toggle('exam', on);
  if (on){
    if (state.practice) setPractice(false);
    endCoach(); closeTut();
    examTags = EXAM.map(([title, sub]) => { const t = makeTag(false); t.b.textContent = title; t.sm.textContent = sub; return t; });
    examTags[5].sm.textContent = `This frame reads ${B}.0000″ to ${B + 1}.0000″`;
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
  inch: ['Frame size', 'var(--muted)', '#c9ced4'],
  a: ['Sleeve number', 'var(--hl-num)', HLC.num],
  b: ['Sleeve line', 'var(--hl-line)', HLC.line],
  c: ['Thimble line', 'var(--hl-thimble)', HLC.thimble],
  d: ['Vernier line', 'var(--hl-vernier)', HLC.vernier]
};
function errAnchor(k){
  const n = Math.round(state.reading*1e4), a = Math.floor(n/1000), li = Math.floor(n/250), c = Math.floor(n/10) % 25, d = n % 10;
  const Rr = SLV_R + 0.002;
  if (k === 'inch') return Object.assign(nameplateAnchor(), { label: `This frame starts at ${B}.0000″` });
  if (k === 'a') return Object.assign(cylAnchor(S0 + a*0.1, Rr, (0.125 + 0.03)/Rr), { label: `“${a}” is the last full number` });
  if (k === 'b'){
    const L = li % 4 === 0 ? 0.085 : (li % 2 === 0 ? 0.055 : 0.04), m = li % 4;
    return Object.assign(cylAnchor(S0 + li*0.025, Rr, (L*0.7)/Rr), { label: m ? `${m} line${m === 1 ? '' : 's'} past “${a}”` : `Right on the “${a}” line` });
  }
  if (k === 'c'){ const tm = (n/10) % 25; return Object.assign(cylAnchor(S0 + state.reading + 0.2, TH_R + 0.002, (c - tm)*DIV), { label: `Line ${c} is at the index` }); }
  return Object.assign(cylAnchor(S0 + state.reading - 0.14, Rr, VERN0 + d*VSTEP), { label: `Line ${d} lines up` });
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

/* ---------- practice ---------- */
const showAns = () => !state.practice || state.pRevealed;
let lastPracticeKey = '';
let rhPracticeSet = false;
function setPractice(on){
  if (on && !rhPracticeSet){
    const mh = document.querySelector('main').clientHeight;
    RH.practice = Math.max(200, Math.min(380, mh - 400));
  }
  state.practice = on; state.pRevealed = false; state.pErr = []; flatKey = '';
  document.body.classList.toggle('practice', on);
  applyRH();
  $('practiceBtn').setAttribute('aria-pressed', String(on));
  $('practiceBtn').dataset.tip = on ? 'Stop practicing\nShows the answers and the reading breakdown again.' : 'Practice reading\nHides the answers, picks a random frame size and part, and puts an answer box in the reading bar.';
  updateAll();
  if (on) loadPractice();
}
function loadPractice(){
  // new frame size each time (different from the last one)
  let nb = Math.floor(Math.random()*6);
  if (nb === B) nb = (nb + 1 + Math.floor(Math.random()*5)) % 6;
  if (state.locked) setLock(false);
  endCoach();
  setRange(nb); setView('iso');
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
  $('feedback').innerHTML = `<p class="pintro">Read the <b>${B}–${B + 1}″</b> micrometer, type the reading and press <b>Check</b>. Score ${state.pScore.right}/${state.pScore.total}.</p>`;
  setTimeout(() => $('guess').focus({ preventScroll: true }), 50);
}
function splitReading(n){
  const inch = Math.floor(n/1e4); let r = n - inch*1e4;
  const a = Math.floor(r/1000); r -= a*1000;
  const b = Math.floor(r/250); r -= b*250;
  const c = Math.floor(r/10);
  return { inch, a, b, c, d: r - c*10 };
}
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const pickOne = a => a[Math.floor(Math.random()*a.length)];
function explainReading(you, ans){
  const A = splitReading(ans), Y = splitReading(Math.max(0, you));
  const f4 = n => (n/1e4).toFixed(4) + '″';
  const notes = [], why = {};
  const ratio = ans ? you/ans : 0, lg = ratio > 0 ? Math.log10(ratio) : NaN;
  if (Number.isFinite(lg) && Math.round(lg) !== 0 && Math.abs(lg - Math.round(lg)) < 1e-9){
    notes.push({ icon: 'fa-heart', title: 'You read every scale correctly — only the decimal point wandered', text: `Every digit you found is right, which is the hard part. Inch readings are written with four decimal places, so this one is ${f4(ans)}. That’s a tiny fix!` });
    return { A, Y, notes, why, decimal: true };
  }
  if (you < B*1e4 || you > (B + 1)*1e4)
    notes.push({ icon: 'fa-ruler', title: 'A quick range check', text: `This ${B}–${B + 1}″ micrometer can only show readings between ${B}.0000″ and ${B + 1}.0000″. Glancing at the frame size first is a great habit — it catches slips like this before they happen.` });
  if (Math.abs(you - ans) < 250 && Y.inch === A.inch && (Y.a !== A.a || Y.b !== A.b))
    notes.push({ icon: 'fa-rotate', title: 'You were incredibly close', text: `Only ${f4(Math.abs(you - ans))} away! The thimble had just rolled past 0, which uncovers a new sleeve line and restarts the thimble count. Almost everyone trips on this at first — reading the sleeve line and the thimble together makes it click.` });
  if (Y.inch !== A.inch) why.inch = `Easy to forget! On this ${B}–${B + 1}″ micrometer, every reading starts at ${A.inch}.0000″, and the scales are added on top.`;
  if (Y.a !== A.a){
    why.a = Y.a === A.a + 1 ? `Good eye spotting “${Y.a}” — it’s right there by the thimble edge. It isn’t uncovered yet, though, so the last full number is “${A.a}”.`
      : Y.a === A.a - 1 ? `“${A.a}” is hugging the thimble edge, which makes it easy to miss. It’s fully uncovered, so it counts.`
      : `Look just left of the thimble edge — the last number you can fully see is “${A.a}”. The arrow shows exactly where.`;
  }
  if (Y.b !== A.b){
    why.b = Y.b > A.b ? `You’re counting carefully, which is exactly right. One more step: a line only counts once the thimble edge has completely passed it, so there ${A.b === 1 ? 'is' : 'are'} ${A.b} here.`
      : `The short lines are easy to overlook. Every line after the number counts as 0.025″, so there ${A.b === 1 ? 'is' : 'are'} ${A.b} here.`;
  }
  if (Y.c !== A.c){
    why.c = Y.c === A.c + 1 ? `So close! Line ${Y.c} is just above the index line but hasn’t reached it yet. The last line that has reached it is ${A.c}.`
      : Y.c === A.c - 1 ? `Nearly! Line ${A.c} has already reached the index line, so it counts. You were reading one line early.`
      : Math.abs(Y.c - A.c) >= 20 ? `The thimble starts again at 0 on every turn, which can feel backwards at first. That full turn already lives in the sleeve lines, so the thimble reads ${A.c}.`
      : `Follow the index line straight across onto the thimble — it lands on line ${A.c}. The arrow points right at it.`;
  }
  if (Y.d !== A.d){
    why.d = Y.d === 0 && A.d !== 0 ? `You read everything else — only the vernier is missing, and it’s the trickiest part! Line ${A.d} lines up here, adding 0.000${A.d}″.`
      : Math.abs(Y.d - A.d) === 1 ? `This one is genuinely hard: lines ${Y.d} and ${A.d} both look close. Only line ${A.d} is perfectly straight with a thimble line, like in the picture.`
      : `Scan the vernier lines for the one that makes a perfectly straight line with a thimble line. Here it’s line ${A.d}.`;
  }
  return { A, Y, notes, why };
}

/* small diagrams for each step that needs another look */
const VZ = { ok: '#5fcf8a', bad: '#ff7a6e', ink: '#e4e6ea', mute: '#8a8f97', metal: '#2a2d32', edge: '#8e949c' };
const svgText = (x, y, t, col, size, anchor, weight) => `<text x="${x}" y="${y}" fill="${col}" font-size="${size || 11}" font-family="Inter,Arial,sans-serif" font-weight="${weight || 600}" text-anchor="${anchor || 'middle'}" dominant-baseline="middle">${t}</text>`;
/* ---------- collision-free diagram builder ---------- */
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
  const W = this.W, H = this.H, m = 1.5, placed = [], txt = [], dropped = [];
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

function vizFor(k, A, Y, n){
  const W = 280, H = 76, v = new Viz(W, H);
  if (k === 'a' || k === 'b'){
    const rem = n % 10000 - A.a*1000;
    const sp = k === 'a' ? 56 : 44, x0 = k === 'a' ? 70 : 36;
    // the thimble edge always sits in the gap after the last uncovered marking, clear of any label
    const edge = k === 'a'
      ? x0 + 17 + (rem/1000)*(sp - 34)
      : x0 + A.b*sp + 12 + ((rem - A.b*250)/250)*(sp - 24);
    v.surface(`<rect x="0" y="0" width="${W}" height="${H}" fill="${VZ.metal}"/>`);
    v.surface(`<rect x="${edge}" y="0" width="${W - edge}" height="${H}" fill="#4a4f57"/>`);
    v.line(edge, 0, edge, H, VZ.edge, 2);
    v.line(0, 50, edge - 1, 50, VZ.ink, 1.4);
    if (k === 'a'){
      for (const num of [A.a - 1, A.a, A.a + 1]){
        if (num < 0 || num > 10) continue;
        const x = x0 + (num - A.a)*sp, isA = num === A.a, isY = num === Y.a, hidden = x > edge;
        const col = isA ? VZ.ok : isY ? VZ.bad : hidden ? '#7d838b' : VZ.ink;
        v.line(x, hidden ? 44 : 50, x, 30, col, isA || isY ? 2.2 : 1.6, hidden ? '3 2' : '');
        if (isA || isY){
          v.rect(x - 13, 5, 26, 20, `rx="4" fill="#0c0d0f" stroke="${col}" stroke-width="2"${isA ? '' : ' stroke-dasharray="4 3"'}`, 'nb' + num);
          v.text(num, x, 15, { col, size: 13, inside: 'nb' + num, maxShift: 0, noHalo: true });
        } else v.text(num, x, 15, { col, size: 12, maxShift: 4 });
        if (hidden && isY) v.text('Covered', x, 62, { col: VZ.bad, size: 9.5, weight: 500, halo: '#4a4f57' });
      }
    } else {
      v.line(x0, 50, x0, 24, VZ.ink, 1.8);
      v.text(`“${A.a}”`, x0, 12, { size: 12, maxShift: 6 });
      for (let i = 1; i <= 4; i++){
        const x = x0 + i*sp, L = i % 4 === 0 ? 26 : i % 2 === 0 ? 20 : 14;
        const counted = i <= A.b, yours = i > A.b && i <= Y.b;
        if (x > W - 50 && !counted && !yours) continue;
        v.line(x, 50, x, 50 - L, counted ? VZ.ok : yours ? VZ.bad : '#9aa0a8', counted || yours ? 2.4 : 1.2, yours || x > edge ? '3 2' : '');
        if (counted){ v.circle(x, 63, 7, `fill="${VZ.ok}"`, 'cc' + i); v.text(i, x, 63.5, { col: '#0b0c0e', size: 9.5, weight: 700, inside: 'cc' + i, maxShift: 0, noHalo: true }); }
        if (yours){ v.circle(x, 63, 7, `fill="none" stroke="${VZ.bad}" stroke-width="1.5"`, 'cy' + i); v.text('×', x, 63, { col: VZ.bad, size: 11, weight: 700, inside: 'cy' + i, maxShift: 0, noHalo: true }); }
      }
    }
    v.text('Thimble', W - 6, H - 8, { anchor: 'end', size: 9, col: '#c3c7cd', within: { x: edge + 2, y: 0, w: W - edge - 2, h: H }, alts: [[0, -16], [0, -34], [0, -52]], halo: '#4a4f57' });
    return v.render();
  }
  if (k === 'c'){
    const tm = (n/10) % 25, sp = 15, iy = H/2;
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
  if (k === 'd'){
    // upright, like the flat view: vernier lines on the sleeve at the left counting up, thimble at the right.
    // The two panels meet at the thimble edge, where each vernier line runs on into a thimble line.
    const H = 196, v = new Viz(W, H), edge = 150, y0 = H - 20, sv = 17, st = sv/0.9;
    v.surface(`<rect x="0" y="0" width="${edge}" height="${H}" fill="${VZ.metal}"/><rect x="${edge}" y="0" width="${W - edge}" height="${H}" fill="#3a3f46"/>`);
    for (let j = 0; j < 10; j++){
      const y = y0 - j*sv, isA = j === A.d, isY = j === Y.d && !isA, col = isA ? VZ.ok : isY ? VZ.bad : VZ.ink;
      v.line(96, y, edge, y, col, isA || isY ? 2.6 : 1.2, isY ? '4 3' : '');
      v.text(j, 82, y, { col, size: isA || isY ? 11 : 9, maxShift: 2 });
      if (isA || isY) v.text(isA ? 'Correct' : 'Yours', 40, y, { col, size: 9.5, weight: isA ? 600 : 500, maxShift: 4 });
    }
    for (let m = -1; m <= 9; m++){
      const y = y0 - A.d*sv - (m - A.d)*st;
      if (y < 6 || y > H - 4) continue;
      v.line(edge, y, edge + 46, y, m === A.d ? VZ.ok : VZ.ink, m === A.d ? 2.6 : 1.2);
    }
    v.circle(edge, y0 - A.d*sv, 4.5, `fill="${VZ.metal}" stroke="${VZ.ok}" stroke-width="2"`);
    v.text('Vernier', 6, 11, { anchor: 'start', col: VZ.mute, size: 9, within: { x: 0, y: 0, w: edge, h: H } });
    v.text('Thimble', W - 6, 11, { anchor: 'end', col: '#aeb3ba', size: 9, within: { x: edge, y: 0, w: W - edge, h: H }, halo: '#3a3f46' });
    return v.render();
  }
  // frame size: whole inches on a line; the frame's range in green, the start you used in red
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
  v.text('This frame', X(A.inch + 0.5), ly - 14, { col: VZ.ok, size: 10, alts: [[0, -12], [18, -12], [-18, -12]], maxShift: 20 });
  v.text('You started here', X(Y.inch), my - 18, { col: VZ.bad, size: 9.5, weight: 500, alts: [[30, 0], [-30, 0], [0, -6]], maxShift: 30 });
  return v.render();
}

const STEP_DEF = {
  inch: { name: 'Frame size', word: 'frame size', css: '#c9ced4', val: A => A.inch*1e4, fmt: v => (v/1e4).toFixed(4), det: A => `${A.inch}–${A.inch + 1}″ frame` },
  a: { name: 'Sleeve number', word: 'sleeve number', css: 'var(--hl-num)', val: A => A.a*1000, fmt: v => (v/1e4).toFixed(3), det: A => `number “${A.a}”` },
  b: { name: 'Sleeve lines', word: 'sleeve lines', css: 'var(--hl-line)', val: A => A.b*250, fmt: v => (v/1e4).toFixed(3), det: A => `${A.b} line${A.b === 1 ? '' : 's'} × 0.025` },
  c: { name: 'Thimble', word: 'thimble reading', css: 'var(--hl-thimble)', val: A => A.c*10, fmt: v => (v/1e4).toFixed(3), det: A => `line ${A.c}` },
  d: { name: 'Vernier', word: 'vernier reading', css: 'var(--hl-vernier)', val: A => A.d, fmt: v => (v/1e4).toFixed(4), det: A => `line ${A.d}` }
};
const STEP_KEYS = ['inch', 'a', 'b', 'c', 'd'];
// A value that should have been added (or was added by mistake) explains the whole difference
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

function checkPractice(){
  const fb = $('feedback'), raw = $('guess').value;
  const g = parseIn(raw);
  if (isNaN(g)){ fb.innerHTML = `<div class="fb-empty"><i class="fa-solid fa-keyboard"></i> Whenever you’re ready, type your reading — for example ${(B + 0.3478).toFixed(4)}.</div>`; return; }
  const S = state.sample;
  const target = state.seq && S ? S.vals[state.seq.id] : B + (state.anim && state.anim.type === 'to' ? state.anim.target : state.reading);
  const ans = Math.round(target*1e4), you = Math.round(g*1e4);
  const sc = state.pScore; sc.total++;
  const ok = you === ans;
  if (ok){ sc.right++; sc.streak++; } else sc.streak = 0;
  const d = (you - ans)/1e4;
  const ex = ok ? { A: splitReading(ans), Y: null, notes: [], why: {} } : explainReading(you, ans);
  const A = ex.A, Y = ex.decimal ? null : ex.Y;
  const miss = ok || ex.decimal ? null : findMissing(you, ans, A, ex.Y);
  if (miss) miss.keys.forEach(k => {
    const src = miss.type === 'missing' ? A : ex.Y, v = (STEP_DEF[k].val(src)/1e4).toFixed(4);
    const where = {
      inch: `Every reading on this ${B}–${B + 1}″ frame starts at ${A.inch}.0000″.`,
      a: `The last number showing on the sleeve is “${A.a}”, which is worth ${(A.a/10).toFixed(4)}″.`,
      b: `There ${A.b === 1 ? 'is' : 'are'} ${A.b} line${A.b === 1 ? '' : 's'} past the number, and each one is worth 0.0250″.`,
      c: `Follow the index line straight across onto the thimble — it lands on line ${A.c}.`,
      d: `Vernier line ${A.d} is the one that lines up perfectly with a thimble line.`
    }[k];
    const none = {
      inch: `This frame starts at ${A.inch}.0000″.`,
      a: 'No number has been uncovered yet, so the sleeve number adds nothing here.',
      b: 'No line has been uncovered past the number yet, so the lines add nothing here.',
      c: 'The index line sits on thimble line 0, so the thimble adds nothing here.',
      d: 'Vernier line 0 is the one that lines up, so the vernier adds nothing here.'
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
    : miss ? `Your other ${5 - miss.keys.length} steps were exactly right.`
    : `${nWrong === 1 ? 'Only one step needs' : `${nWrong} steps need`} a second look — you got ${5 - nWrong} of 5 right.`;
  const pct = sc.total ? Math.round(sc.right/sc.total*100) : 0;

  const hero = `<div class="fx-hero ${ok ? 'ok' : ''}">
      <div class="fx-badge"><i class="fa-solid ${ok ? 'fa-check' : miss ? 'fa-puzzle-piece' : 'fa-seedling'}"></i></div>
      <div class="fx-head"><h4>${title}</h4><p>${sub}</p></div>
      <div class="fx-score"><div class="fx-ring" style="--p:${pct}"><span>${pct}%</span></div><div><small>Score</small><b>${sc.right} / ${sc.total}</b><small>${sc.streak ? `🔥 ${sc.streak} in a row` : 'keep going'}</small></div></div>
    </div>`;
  const cmp = ok
    ? `<div class="fx-cmp solo"><div class="fx-num ans"><small>Your reading</small><b>${fmt(ans/1e4)}″</b></div></div>`
    : `<div class="fx-cmp"><div class="fx-num you"><small>You entered</small><b>${esc(fmt(you/1e4))}″</b></div>
       <div class="fx-delta"><span>${d > 0 ? 'too high by' : 'too low by'}</span><div class="ar"></div><b>${Math.abs(d).toFixed(4)}″</b></div>
       <div class="fx-num ans"><small>Correct reading</small><b>${fmt(ans/1e4)}″</b></div></div>`;
  let missBox = '';
  if (miss){
    const k0 = miss.keys[0], words = listWords(miss.keys.map(k => STEP_DEF[k].word));
    const parts = miss.keys.map(k => `${(STEP_DEF[k].val(miss.type === 'missing' ? A : ex.Y)/1e4).toFixed(4)}″ ${STEP_DEF[k].word}`).join(' + ');
    missBox = `<div class="fx-miss" style="--c:${STEP_DEF[k0].css}">
      <div class="fx-miss-ic"><i class="fa-solid ${miss.type === 'missing' ? 'fa-puzzle-piece' : 'fa-scissors'}"></i></div>
      <div><h5>${miss.type === 'missing' ? `The ${words} wasn’t added` : `An extra ${words} was added`}</h5>
      <p>${miss.type === 'missing' ? 'Everything else lines up perfectly — adding this one value back in gives the exact answer:' : 'Everything else lines up perfectly — taking this value out gives the exact answer:'}</p>
      <div class="fx-sum"><span>${esc(fmt(you/1e4))}″</span><span class="op">${miss.type === 'missing' ? '+' : '−'}</span><span class="add">${parts}</span><span class="op">=</span><span class="res">${fmt(ans/1e4)}″</span></div></div></div>`;
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
      <div class="fx-chip total"><small>Reading</small><b>${fmt(ans/1e4)}″</b><em>correct total</em>${ok ? '' : `<span class="yv" style="color:#ff9d94"><i class="fa-solid fa-xmark"></i>You answered ${esc(fmt(you/1e4))}″</span>`}</div></div>`;
  const notes = ex.notes.map(nt => `<div class="fx-note"><i class="fa-solid ${nt.icon}"></i><div><b>${nt.title}</b><span>${nt.text}</span></div></div>`).join('');
  const steps = wrong.length ? `<div class="fx-sec">Let’s look closer</div><div class="fx-steps">${wrong.map((k, i) => {
    const D = STEP_DEF[k];
    const yd = k === 'inch' ? `${Y.inch}.0000″` : k === 'a' ? `“${Y.a}”` : k === 'b' ? `${Y.b} line${Y.b === 1 ? '' : 's'}` : `line ${Y[k]}`;
    const ad = k === 'inch' ? `${A.inch}.0000″` : k === 'a' ? `“${A.a}”` : k === 'b' ? `${A.b} line${A.b === 1 ? '' : 's'}` : `line ${A[k]}`;
    const mk = miss && miss.keys.includes(k);
    return `<article class="fx-step" style="--c:${D.css}">
      <div class="fx-step-h"><span class="num">${i + 1}</span><b>${D.name}</b><span class="chg">${mk && miss.type === 'missing' ? '<s>not added</s>' : `<s>${yd}</s>`}<i class="fa-solid fa-arrow-right"></i><strong>${mk && miss.type === 'extra' ? 'not needed' : ad}</strong></span></div>
      <p>${ex.why[k]}</p>
      <figure>${vizFor(k, A, Y, ans)}<figcaption><span><i style="background:#5fcf8a"></i>correct</span><span><i style="background:#ff7a6e"></i>yours</span></figcaption></figure>
      <div class="fx-step-f"><span><i class="fa-solid fa-location-arrow"></i>${k === 'inch' ? 'Arrow on the nameplate' : 'Arrow on the micrometer and flat view'}</span>
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

/* ---------- tutorial ---------- */
function openTut(){ $('tut').hidden = false; $('tutClose').focus({ preventScroll: true }); $('tut').scrollTop = 0; }
function closeTut(){
  if ($('tut').hidden) return;
  $('tut').hidden = true;
  try { localStorage.setItem('mic-tutorial-seen', '1'); } catch (e) {}
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
  const n = Math.round(state.reading*1e4), show = showAns(), hl = state.hl;
  const key = [n, show, hl.num, hl.line, hl.thimble, hl.vernier, state.pErr.join('')].join('|');
  if (key === flatKey) return; flatKey = key;
  const cv = $('flatCv'), g = cv.getContext('2d');
  const W = 260, H = 280, dpr = Math.min(4, (window.devicePixelRatio || 1)*Math.max(1, ($('flatCv').clientWidth || 260)/260));
  if (cv.width !== Math.round(W*dpr)){ cv.width = Math.round(W*dpr); cv.height = Math.round(H*dpr); }
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const k = 240, R = SLV_R, ex = Math.round(W*0.6), r = state.reading, t0 = -0.55, yb = H - 14;
  const X = dx => ex + dx*k, Y = t => yb - (t - t0)*R*k;
  let gr = g.createLinearGradient(0, 0, 0, H);
  gr.addColorStop(0, '#c4c8cd'); gr.addColorStop(0.55, '#e6e9ec'); gr.addColorStop(1, '#bfc3c8');
  g.fillStyle = gr; g.fillRect(0, 0, ex, H);
  gr = g.createLinearGradient(0, 0, 0, H);
  gr.addColorStop(0, '#b3b8be'); gr.addColorStop(0.55, '#d8dce0'); gr.addColorStop(1, '#aeb3b9');
  g.fillStyle = gr; g.fillRect(ex, 0, W - ex, H);
  g.fillStyle = 'rgba(0,0,0,.28)'; g.fillRect(ex, 0, 2, H);
  g.lineCap = 'butt';
  const seg = (x0, y0, x1, y1, w, col) => { g.strokeStyle = col; g.lineWidth = w; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); };
  const hot = (x0, y0, x1, y1, col) => seg(x0, y0, x1, y1, 1.9, col);
  const txt = (s, x, y, size, col) => { g.font = `600 ${size}px Inter, Arial, sans-serif`; g.fillStyle = col; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(s, x, y); };
  const a = Math.floor(n/1000), li = Math.floor(n/250), c = Math.floor(n/10) % 25, d = n % 10;
  // index line
  seg(0, Y(0), ex, Y(0), 1.4, '#111');
  // main scale (lines hidden under the thimble are not drawn)
  for (let i = 0; i <= 40; i++){
    const dx = i*0.025 - r;
    if (dx > 0.0004 || X(dx) < -4) continue;
    const L = i % 4 === 0 ? 0.085 : (i % 2 === 0 ? 0.055 : 0.04), x = X(dx);
    if (show && hl.line && i === li) hot(x, Y(0), x, Y(L/R), HLC.line); else seg(x, Y(0), x, Y(L/R), 1.3, '#111');
    if (i % 4 === 0){
      const ty = Y((L + 0.04)/R), s = String(i/4);
      if (show && hl.num && i/4 === a){
        g.font = '600 12px Inter, Arial, sans-serif';
        const w = g.measureText(s).width + 8;
        g.fillStyle = '#000'; g.fillRect(x - w/2, ty - 9, w, 18);
        g.strokeStyle = HLC.num; g.lineWidth = 2; g.strokeRect(x - w/2, ty - 9, w, 18);
        txt(s, x, ty, 12, HLC.num);
      } else txt(s, x, ty, 12, '#111');
    }
  }
  // vernier lines along the top of the sleeve
  for (let j = 0; j < 10; j++){
    const y = Math.round(Y(VERN0 + j*VSTEP)*2)/2;
    if (show && hl.vernier && j === d) hot(22, y, ex, y, HLC.vernier); else seg(22, y, ex, y, 1.1, '#111');
    txt(String(j), 11, y, 10, '#111');
  }
  // thimble graduations
  // thimble drawn at the displayed 0.0001" reading so the answer pair lines up exactly
  const tm = (n/10) % 25;
  for (let v = 0; v < 25; v++) for (const m of [-1, 0, 1]){
    const th = (v - tm)*DIV + m*TAU;
    if (th < t0 - 0.1 || th > 3.35) continue;
    const y = Math.round(Y(th)*2)/2, L = v % 5 === 0 ? 0.26 : 0.16, x1 = X(L);
    const onV = show && hl.vernier && v === (c + 3 + d) % 25;
    const onT = show && hl.thimble && v === c;
    if (onV) hot(ex + 2, y, x1, y, HLC.vernier);
    else if (onT) hot(ex + 2, y, x1, y, HLC.thimble);
    else seg(ex + 2, y, x1, y, 1.2, '#111');
    if (v % 5 === 0) txt(String(v), X(0.33), y, 12, '#111');
  }
  cornerText(g, 'Sleeve', 4, 6, { size: 9.5, weight: 500, col: 'rgba(0,0,0,.6)', region: { x: 0, y: 0, w: ex, h: H } });
  cornerText(g, 'Thimble', ex + 6, 6, { size: 9.5, weight: 500, col: 'rgba(0,0,0,.6)', region: { x: ex, y: 0, w: W - ex, h: H } });
  // arrows to the markings that were misread
  const placed = [];
  const arrow = (tx, ty, dx, dy, col, lab) => flatArrow(g, W, H, tx, ty, dx, dy, col, lab, placed, { x: 2, y: 12, w: W - 4, h: H - 14 });

  for (const k of state.pErr){
    if (k === 'a') arrow(X(a*0.1 - r), Y(0.125/R) - 9, -0.55, -0.83, HLC.num, 'Sleeve no. ' + a);
    else if (k === 'b'){ const L = li % 4 === 0 ? 0.085 : (li % 2 === 0 ? 0.055 : 0.04); arrow(X(li*0.025 - r) - 1, Y(L/R) - 3, -0.6, -0.8, HLC.line, 'Sleeve line'); }
    else if (k === 'c') arrow(X(0.2), Y((c - tm)*DIV) - 2, 0.35, -0.94, HLC.thimble, 'Thimble ' + c);
    else if (k === 'd') arrow(70, Y(VERN0 + d*VSTEP) - 2, 0.45, -0.89, HLC.vernier, 'Vernier ' + d);
  }
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
  if (!coachCam) coachCam = camNow();   // keep the first view saved if it re-aims
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
}
function startCoach(){ if (state.coach) return; state.coach = true; state.coachArmed = false; document.body.classList.add('coaching'); focusRatchet(); invalidate(); }
// restore: true when the hint is dismissed (Got it / Esc); if the ratchet is taken up instead, the view stays on it
function endCoach(restore){ if (!state.coach) return; state.coach = false; document.body.classList.remove('coaching'); if (restore) restoreCoachCam(); else coachCam = null; invalidate(); }

/* ---------- spindle motion ---------- */
const flashLocked = () => toast('Spindle lock is on — flip the lock lever to release it');

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
  const min = minReading();
  if (mode === 'thimble' && dR < 0){
    if (state.coach) return false;
    if (state.coachOn && state.coachArmed && state.reading + dR - min < 0.003){
      state.reading = Math.max(state.reading + dR, Math.min(state.reading, min + 0.003));
      startCoach(); return false;
    }
  }
  let nr = state.reading + dR, blocked = false;
  if (nr < min){
    const over = min - nr; nr = min; blocked = true;
    if (mode === 'ratchet'){
      const ang = over*TPI*TAU;
      state.ratchetExtra -= ang; state.slipAcc += ang;
      while (state.slipAcc > 0.45){ state.slipAcc -= 0.45; clickSound(); state.clicks++; }
    } else if (mode === 'thimble') toast('Faces are touching — use the ratchet for consistent pressure');
  }
  if (nr > 1){ nr = 1; blocked = true; }
  state.reading = Math.round(nr*1e7)/1e7;
  return !blocked;
}
const stopAnim = () => { state.anim = null; };
function goTo(v, quiet){
  if (state.locked){ flashLocked(); return; }
  v = Math.max(0, Math.min(1, v));
  if (v < minReading() - 1e-7){ if (!quiet) toast(`The part is in the way — the smallest reading now is ${(B + minReading()).toFixed(4)}″`); v = minReading(); }
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
  $('lockBtn').textContent = v ? 'Unlock spindle' : 'Lock spindle';
  const lq = $('lockQuick');
  lq.setAttribute('aria-pressed', String(v));
  lq.setAttribute('aria-label', v ? 'Unlock spindle' : 'Lock spindle');
  lq.dataset.tip = v ? 'Unlock spindle\nThe spindle is locked. Flip the lever back so it can turn.' : 'Lock spindle\nFlips the lock lever so the spindle can’t turn. The lever turns red while locked.';
  lockHulls.forEach(h => h.visible = v);
  paintLock(lockParts, v);
  renderer.shadowMap.needsUpdate = true;
  invalidate();
  if (v){ stopAnim(); state.seq = null; }
  toast(v ? 'Spindle locked' : 'Spindle unlocked');
}

function setRange(nb){
  B = nb; stopAnim(); endCoach(); state.seq = null; state.coachArmed = true;
  document.querySelectorAll('[data-range]').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.range === B)));
  $('brand').textContent = `${B}–${B + 1}″`;
  $('setTo').placeholder = goHint();
  document.title = `Vernier Micrometer ${B}–${B + 1}″ · 3D`;
  build();
  fillSampleOptions();
  newSample(state.sampleKey);
  placeLights();
  resize();
  updateAll();
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
// what the overview frames: the micrometer, and the part only once it is between the faces, so a part
// waiting off to the side doesn't make the view back away from the tool
function toolBox(){
  const hide = partG && partG.visible && !between();
  if (hide) partG.visible = false;
  const box = fitBox(scene);
  if (hide) partG.visible = true;
  return box;
}
function setView(name, instant){
  let target = center(), dir, zoom = 1;
  const edge = S0 + state.reading, zf = 4.4*(1 + B*0.3);
  if (name === 'front') dir = new T.Vector3(0, 0, 1);
  else if (name === 'scale'){ dir = new T.Vector3(0, 0.22, 1).normalize(); target = new T.Vector3(edge - 0.05, 0.06, 0); zoom = zf; }
  else if (name === 'vernier'){ dir = new T.Vector3(0, 1, 0.12).normalize(); target = new T.Vector3(edge - 0.08, 0, -0.1); zoom = zf; }
  else dir = new T.Vector3(0.42, 0.52, 1).normalize();
  if (name === 'iso' || name === 'front' || !['scale', 'vernier', 'tip'].includes(name)){ const fb = fitIso(dir, target, 40, toolBox()); target = fb.target; zoom = fb.zoom; }
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
let drag = null;
function pick(e){
  const r = el.getBoundingClientRect();
  ndc.set(((e.clientX - r.left)/r.width)*2 - 1, -((e.clientY - r.top)/r.height)*2 + 1);
  ray.setFromCamera(ndc, camera);
  const h = ray.intersectObjects(pickables, false);
  return h.length ? h[0] : null;
}
function toScreen(v){ const p = v.clone().project(camera), r = el.getBoundingClientRect(); return new T.Vector2((p.x + 1)/2*r.width, (1 - p.y)/2*r.height); }
el.addEventListener('pointerdown', e => {
  if (e.button !== 0) return;
  const h = pick(e), kind = h && h.object.userData.kind;
  if (!kind || kind === 'none') return;
  controls.enabled = false; camTween = null;
  try { el.setPointerCapture(e.pointerId); } catch (err) {}
  if (kind === 'lever'){ setLock(!state.locked); drag = { kind: 'click' }; return; }
  const p = h.point.clone();
  const dirW = kind === 'part' ? new T.Vector3(0, 0, 1) : new T.Vector3(0, -p.z, p.y);
  let sd = toScreen(p.clone().add(dirW.clone().multiplyScalar(0.01))).sub(toScreen(p)).divideScalar(0.01);
  if (kind === 'part' && sd.lengthSq() < 9){
    // looking straight down the slide: use horizontal screen motion instead
    const xs = toScreen(p.clone().add(new T.Vector3(1, 0, 0))).sub(toScreen(p));
    sd = new T.Vector2(xs.y, -xs.x);
  }
  drag = { kind, x: e.clientX, y: e.clientY, sd };
  state.seq = null;
  if (kind === 'ratchet'){ endCoach(); state.slipAcc = 0; }
  if (kind !== 'part') stopAnim(); else { state.partTarget = null; openForMove(); }
  el.style.cursor = 'grabbing';
}, true);
el.addEventListener('pointermove', e => {
  if (!drag){ hover(e); return; }
  if (drag.kind === 'click') return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  drag.x = e.clientX; drag.y = e.clientY;
  const l2 = drag.sd.lengthSq();
  let du = l2 > 9 ? (dx*drag.sd.x + dy*drag.sd.y)/l2 : dy*0.01;
  if (e.shiftKey) du *= 0.2;
  if (fineOn) du *= FINE_K;
  if (drag.kind === 'part'){ openForMove(); movePartTo(state.partZ + du); }
  else tryTurn(du/(TPI*TAU), drag.kind);
});
function endDrag(e){
  if (!drag) return;
  const wasPart = drag.kind === 'part';
  drag = null; controls.enabled = true;
  if (wasPart && between() && !state.locked){
    const S = state.sample, det = state.ev.feat;
    if (S && det && S.sel !== det){ S.sel = det; renderFeats(); }
    ratchetClose();
  }
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
    el.style.cursor = k === 'lever' ? 'pointer' : (k && k !== 'none' ? 'grab' : '');
  });
}

/* ---------- reading panel ---------- */
let lastKey = '', hlKey = '';
function updateAll(){ lastKey = ''; hlKey = ''; invalidate(); }
function updateUI(){
  const ev = state.ev, I = B + state.reading;
  const k = [B, state.reading, state.locked, isContact(), state.practice, ev ? [ev.contact, ev.eff, ev.gap, ev.tooSmall, ev.feat, ev.measured] : '', state.sample && state.sample.key].join('|');
  if (k === lastKey) return; lastKey = k;
  $('lcd').textContent = fmt(I);
  $('lcdmm').textContent = (I*25.4).toFixed(3) + ' mm';
  $('vBase').textContent = B.toFixed(4); $('hBase').textContent = `${B}–${B + 1}″ frame`;
  const n = Math.round(state.reading*1e4);
  const a = Math.floor(n/1000); let rem = n - a*1000;
  const b = Math.floor(rem/250); rem -= b*250;
  const c = Math.floor(rem/10), d = rem - c*10;
  $('vA').textContent = (a/10).toFixed(4); $('hA').textContent = `“${a}” × 0.100″`;
  $('vB').textContent = (b*0.025).toFixed(4); $('hB').textContent = `${b} × 0.025″`;
  $('vC').textContent = (c*0.001).toFixed(4); $('hC').textContent = `line ${c} × 0.001″`;
  $('vD').textContent = (d*0.0001).toFixed(4); $('hD').textContent = `line ${d} × 0.0001″`;
  $('vT').textContent = fmt(I);
  $('gap').textContent = I.toFixed(4) + '″';
  if (document.activeElement !== $('slider')) $('slider').value = n;

  const fc = $('featCell'), S = state.sample;
  let fk = 'Measuring', fv = '—', fh = 'no sample', col = '';
  if (S && ev){
    const f = ev.feat && S.feats.find(x => x.id === ev.feat);
    if (f){ col = TYPES[f.type].c; fk = TYPES[f.type].name; fv = f.label; fh = isContact() ? 'faces touching' : 'between the faces'; }
    else if (ev.gap){ col = cssVar('--warn'); fk = 'Frame contact'; fv = 'Part hits the frame'; fh = 'reading includes a gap'; }
    else if (ev.tooSmall){ fk = 'Too small'; fv = 'Below this frame’s range'; fh = `under ${B}.0000″`; }
    else if (ev.eff){ fk = 'Measuring'; fv = 'Unlisted dimension'; fh = isContact() ? 'faces touching' : 'between the faces'; }
    else { fk = 'Measuring'; fv = 'Nothing between the faces'; fh = 'drag the part in'; }
  }
  if (col) fc.style.setProperty('--c', col); else fc.style.removeProperty('--c');
  $('fK').textContent = fk; $('fV').textContent = fv; $('fH').textContent = fh;

  let msg = 'Spindle free', cls = '';
  if (isContact() && ev.gap){ msg = 'Touching, but the part is held off the anvil by the frame'; cls = 'warn'; }
  else if (isContact()){ msg = 'Measuring faces on the part'; cls = 'ok'; }
  else if (!between() && state.reading < 1e-7){ msg = B > 0 ? 'Fully closed — check zero with the setting standard' : 'Spindle closed on the anvil'; cls = 'ok'; }
  else if (between()){ msg = 'Part between the faces — close with the ratchet'; }
  if (state.locked){ msg += ' · locked'; cls = cls || 'warn'; }
  $('status').textContent = msg; $('status').className = 'status ' + cls;
  $('pullBtn').disabled = $('autoBtn').disabled = !S;
}
function updateHighlights(){
  const n = Math.round(state.reading*1e4), hl = state.hl, show = showAns();
  const k = [n, show, hl.num, hl.line, hl.thimble, hl.vernier, B].join('|');
  if (k === hlKey) return; hlKey = k;
  const a = Math.floor(n/1000), li = Math.floor(n/250), c = Math.floor(n/10) % 25, d = n % 10;
  HLs.num.set(show && hl.num ? a : -1);
  HLs.line.set(show && hl.line ? li : -1);
  HLs.thimble.set(show && hl.thimble ? c : -1);
  HLs.vA.set(show && hl.vernier ? d : -1);
  HLs.tA.set(show && hl.vernier ? (c + 3 + d) % 25 : -1);
  invalidate();
}

/* ---------- UI bindings ---------- */
const parseIn = s => parseFloat(String(s).replace(/[″"in\s]/g, ''));
function bindUI(){
  document.querySelectorAll('[data-range]').forEach(b => b.addEventListener('click', () => { if (+b.dataset.range !== B){ setRange(+b.dataset.range); setView('iso'); } }));
  document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));
  document.querySelectorAll('[data-step]').forEach(b => b.addEventListener('click', () => {
    const base = state.anim && state.anim.type === 'to' ? state.anim.target : state.reading;
    goTo(Math.round((base + parseFloat(b.dataset.step))*1e4)/1e4);
  }));
  document.querySelectorAll('[data-hl]').forEach(c => c.addEventListener('change', () => { state.hl[c.dataset.hl] = c.checked; if (c.dataset.hl === 'outline'){ hullFeat = ''; updateHull(); } }));
  $('slider').addEventListener('input', e => { stopAnim(); state.seq = null; tryTurn(e.target.value/1e4 - state.reading, 'slider'); });
  $('ratchetBtn').addEventListener('click', ratchetClose);
  $('closeBtn').addEventListener('click', () => goTo(0));
  $('openBtn').addEventListener('click', () => goTo(1));
  $('lockBtn').addEventListener('click', () => setLock(!state.locked));
  $('lockQuick').addEventListener('click', () => setLock(!state.locked));
  $('closeQuick').addEventListener('click', () => { state.seq = null; goTo(0); });
  $('openQuick').addEventListener('click', () => { state.seq = null; goTo(1); });
  $('coachChk').addEventListener('change', e => { state.coachOn = e.target.checked; if (!e.target.checked) endCoach(); });
  $('coachOk').addEventListener('click', () => endCoach(true));
  $('autoBtn').addEventListener('click', autoMeasure);
  $('pullBtn').addEventListener('click', slideOut);
  const go = () => {
    const v = inputInches($('setTo').value);
    if (isNaN(v) || v < B || v > B + 1){ toast(`Enter a reading between ${B}.0000 and ${B + 1}.0000`); return; }
    goTo(Math.round((v - B)*1e4)/1e4);
  };
  $('goBtn').addEventListener('click', go);
  $('setTo').addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  document.querySelectorAll('[data-units]').forEach(b => b.addEventListener('click', () => setUnits(b.dataset.units)));
  setUnits(units);
  bindFolds();
  $('sampleSel').addEventListener('change', e => newSample(e.target.value));
  $('newVals').addEventListener('click', () => { if (state.sampleKey !== 'none') newSample(state.sampleKey, true); });
  $('revealBtn').addEventListener('click', () => { if (state.sample){ state.sample.revealed = !state.sample.revealed; renderFeats(); } });
  const feats = $('feats');
  feats.addEventListener('click', e => {
    const sel = e.target.closest('[data-select]'); if (sel){ goToFeature(sel.dataset.select, true); return; }

  });
  $('practiceBtn').addEventListener('click', () => setPractice(!state.practice));
  $('fineBtn').addEventListener('click', () => setFine(!fineOn));
  $('fineQuick').addEventListener('click', () => setFine(!fineOn));
  $('soundChk').checked = soundOn;
  $('soundChk').addEventListener('change', e => setSound(e.target.checked));
  {
    const ro = new ResizeObserver(queueLayout);
    ro.observe(wrap);
    window.addEventListener('resize', queueLayout);
    OV_ITEMS.forEach(o => { const el = wrap.querySelector(o.sel); if (el) ro.observe(el); });
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
    if (e.key === 'ArrowUp') d = e.shiftKey ? 0.0001 : 0.001;
    else if (e.key === 'ArrowDown') d = e.shiftKey ? -0.0001 : -0.001;
    else if (e.key === 'PageUp') d = 0.025;
    else if (e.key === 'PageDown') d = -0.025;
    else if (e.key === 'r' || e.key === 'R'){ ratchetClose(); return; }
    else if (e.key === 'f' || e.key === 'F'){ setFine(!fineOn); return; }
    else if (e.key === 'l' || e.key === 'L'){ setLock(!state.locked); return; }
    else if (e.key === 'a' || e.key === 'A'){ autoMeasure(); return; }
    else if (e.key === '[' || e.key === ']'){ state.seq = null; state.partTarget = null; movePartTo(state.partZ + (e.key === ']' ? 1 : -1)*(e.shiftKey ? 0.01 : 0.05)); return; }
    else return;
    if (fineOn) d *= FINE_K;
    e.preventDefault(); stopAnim(); state.seq = null; tryTurn(d, 'key');
  });
  window.addEventListener('pointerup', invalidate);
}

/* ---------- loop: renders only when something changed ---------- */
const clock = new T.Clock();
let leverAngle = -1.1, dim = 0, time = 0, lastSig = '', shadowPending = true, frameN = 0, lastRenderT = 0;
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
      const moved = tryTurn(Math.sign(diff)*Math.min(Math.abs(diff), Math.max(a.fast ? 0.6 : 0.02, Math.abs(diff)*(a.fast ? 9 : 5))*dt), 'auto');
      if (Math.abs(a.target - state.reading) < 1e-7 || !moved) state.anim = null;
    } else if (a.type === 'ratchet'){
      tryTurn(-Math.max(0.03, (state.reading - minReading())*4)*dt, 'ratchet');
      if (state.clicks >= 4) state.anim = null;
    }
  }
  if (state.partTarget !== null && state.sample && !drag){
    openForMove();
    const d = state.partTarget - state.partZ, step = Math.min(Math.abs(d), Math.max(0.6, Math.abs(d)*5)*dt);
    const reached = Math.abs(d) < 1e-6 || movePartTo(state.partZ + Math.sign(d)*step);
    if (Math.abs(state.partTarget - state.partZ) < 1e-5) state.partTarget = null;
    else if (!reached){ state.partTarget = null; state.seq = null; }
  }
  if (state.seq) stepSeq();
  if (!state.coachArmed && !state.coach && state.reading - minReading() > 0.02) state.coachArmed = true;

  // part eases toward the anvil as the measured section changes size
  state.sxV = Math.abs(state.sxT - state.sxV) < 1e-5 ? state.sxT : state.sxV + (state.sxT - state.sxV)*Math.min(1, dt*14);
  const la = state.locked ? -0.5 : -1.1;
  leverAngle = Math.abs(la - leverAngle) < 0.001 ? la : leverAngle + (la - leverAngle)*Math.min(1, dt*14);
  const dimT = state.coach ? 0.7 : 0;
  dim = Math.abs(dimT - dim) < 0.002 ? dimT : dim + (dimT - dim)*Math.min(1, dt*8);

  const sig = state.reading + '|' + state.partZ + '|' + state.sxV + '|' + state.ratchetExtra + '|' + leverAngle + '|' + state.setup;
  const moved = sig !== lastSig; lastSig = sig;
  if (moved){
    thG.position.x = S0 + state.reading;
    thG.rotation.x = state.reading*TPI*TAU;
    ratchetG.rotation.x = state.ratchetExtra;
    leverR.rotation.z = leverAngle;
    if (partG) partG.position.set(state.sxV, 0, state.partZ);
    shadowPending = true;
  }
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
      const s = i ? 1 + ph*0.35 : 1 + 0.04*pulse; h.scale.set(1, s, s);
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
  controls.addEventListener('start', () => { camTween = null; if (state.exam && controls.autoRotate) setSpin(false); });
  controls.addEventListener('change', invalidate);
  bindUI();
  applyGfx('high');
  setRange(0);
  bindFinish();
  setView('iso', true);
  window.__load ? window.__load.done() : $('loading').remove();

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
  started = true;
  requestAnimationFrame(tick);
}
const fontsReady = document.fonts && document.fonts.load
  ? Promise.all([document.fonts.load('600 72px "Inter"'), document.fonts.ready]).catch(() => {})
  : Promise.resolve();
window.__load && window.__load.set(0.8, 'Loading fonts…');
Promise.race([fontsReady, new Promise(r => setTimeout(r, 2500))]).then(start);
})();
