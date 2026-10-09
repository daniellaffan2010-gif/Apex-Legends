import { addKerbs } from './kerbs.js';
import { addPitLane } from './pitlane.js';
import { RAD, TAU, angWrap, clamp, dist, lerp, mulberry } from '../config/util.js';
import { TEAMS } from '../config/teams.js';
import { bankZ, ELEV_VISUAL } from './shared.js';

/* ---------- 2. track builder --------------------------------------------- */
function parseLayout(str){
  return str.trim().split(/\s+/).map(tok => {
    if(tok[0] === "S") return { t:"S", len:parseFloat(tok.slice(1)) };
    const [a, r] = tok.slice(1).split("/").map(parseFloat);
    return { t:tok[0], a, r };
  });
}
/* Handedness. In the physics a right-hand turn is a POSITIVE change of heading
   (steer right: h grows), so "R" in a layout string must turn the heading up.
   It used to turn it down, which drew every layout-built circuit as its own mirror
   image (Monza anticlockwise, Singapore clockwise...). The corner letters in the
   layouts are the real ones. Las Vegas is deliberately left as it was, by request. */
const LEGACY_MIRRORED = new Set(["vegas"]);
function turtle(cmds, k, hand){
  const pts = []; let x = 0, y = 0, h = 0;
  const push = () => pts.push([x, y]);
  push();
  for(const c of cmds){
    if(c.t === "S"){
      const steps = Math.max(1, Math.round(c.len / 12));
      for(let i = 0; i < steps; i++){ x += Math.cos(h) * c.len / steps; y += Math.sin(h) * c.len / steps; push(); }
    } else {
      const ang = c.a * k * RAD * (c.t === "R" ? hand : -hand);
      const steps = Math.max(3, Math.round(Math.abs(ang) * c.r / 10));
      const dh = ang / steps, ds = Math.abs(dh) * c.r;
      for(let i = 0; i < steps; i++){ h += dh; x += Math.cos(h) * ds; y += Math.sin(h) * ds; push(); }
    }
  }
  return pts;
}
function catmull(p0, p1, p2, p3, t){
  const t2 = t * t, t3 = t2 * t;
  return [0, 1].map(j => 0.5 * ((2 * p1[j]) + (-p0[j] + p2[j]) * t +
    (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3));
}
function resampleClosed(pts, ds){
  const n = pts.length, fine = [];
  for(let i = 0; i < n; i++){
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    const steps = Math.max(2, Math.ceil(dist(p1[0], p1[1], p2[0], p2[1]) / 3));
    for(let s = 0; s < steps; s++) fine.push(catmull(p0, p1, p2, p3, s / steps));
  }
  const m = fine.length, cum = [0];
  for(let i = 1; i <= m; i++) cum[i] = cum[i - 1] + dist(...fine[i % m], ...fine[i - 1]);
  const total = cum[m], count = Math.max(64, Math.round(total / ds)), out = [];
  let j = 0;
  for(let i = 0; i < count; i++){
    const target = total * i / count;
    while(j < m && cum[j + 1] < target) j++;
    const seg = cum[j + 1] - cum[j] || 1, t = (target - cum[j]) / seg;
    out.push([lerp(fine[j][0], fine[(j + 1) % m][0], t), lerp(fine[j][1], fine[(j + 1) % m][1], t)]);
  }
  return { pts:out, length:total };
}

function buildTrack(def){
  let raw;
  if(def.path){
    // a surveyed centreline: already closed, already the right shape
    raw = def.path().map(p => [p[0], p[1]]);
  } else {
    const cmds = parseLayout(def.layout);
    const hand = LEGACY_MIRRORED.has(def.id) ? -1 : 1;
    let turn = 0;
    for(const c of cmds) if(c.t !== "S") turn += c.a * (c.t === "R" ? hand : -hand);
    // normalise to a closed lap. A figure-of-eight nets to nothing (Suzuka), and
    // must not have its corners blown up to chase 360.
    const k = Math.abs(turn) < 100 ? 1 : clamp((360 * Math.sign(turn)) / turn, 0.78, 1.28);
    raw = turtle(cmds, k, hand);
    const gx = raw[0][0] - raw[raw.length - 1][0], gy = raw[0][1] - raw[raw.length - 1][1];
    const N0 = raw.length - 1;
    raw = raw.map((p, i) => [p[0] + gx * i / N0, p[1] + gy * i / N0]);   // distribute the closing gap
    raw.pop();
  }
  let worldScale = 1;
  if(def.len){                                     // scale to the circuit's real lap distance
    let plen = 0; for(let i = 0; i < raw.length; i++){ const a = raw[i], b = raw[(i + 1) % raw.length]; plen += Math.hypot(a[0] - b[0], a[1] - b[1]); }
    const sc = def.len / plen; raw = raw.map(p => [p[0] * sc, p[1] * sc]);
    worldScale = sc;
  }

  const { pts, length } = resampleClosed(raw, 7);
  const n = pts.length, ds = length / n;
  const T = { def, id:def.id, name:def.name, loc:def.loc, n, ds, length, worldScale,
    width:def.width, half:def.width / 2, runoff:def.runoff, barrier:def.barrier, pal:def.pal,
    night:def.night, sun:def.sun, x:new Float64Array(n), y:new Float64Array(n), z:new Float64Array(n),
    tx:new Float64Array(n), ty:new Float64Array(n), nx:new Float64Array(n), ny:new Float64Array(n),
    curv:new Float64Array(n), bank:new Float64Array(n), s:new Float64Array(n), ang:new Float64Array(n) };

  for(let i = 0; i < n; i++){
    T.x[i] = pts[i][0]; T.y[i] = pts[i][1]; T.s[i] = i * ds;
    const u = i / n;
    T.z[i] = def.elev ? def.elev(u) * ELEV_VISUAL : 0;
    T.bank[i] = def.bank ? def.bank(u) : 0;
  }
  // iron out spline kinks left by the loop closure before anything reads the curvature
  { const sx = new Float64Array(n), sy = new Float64Array(n);
    const passes = def.smooth != null ? def.smooth : 8;
    for(let p = 0; p < passes; p++){
      for(let i = 0; i < n; i++){
        const a = (i - 1 + n) % n, b = (i + 1) % n;
        sx[i] = T.x[i] + 0.28 * ((T.x[a] + T.x[b]) / 2 - T.x[i]);
        sy[i] = T.y[i] + 0.28 * ((T.y[a] + T.y[b]) / 2 - T.y[i]);
      }
      T.x.set(sx); T.y.set(sy);
    } }
  for(let i = 0; i < n; i++){
    const a = (i - 1 + n) % n, b = (i + 1) % n;
    let dx = T.x[b] - T.x[a], dy = T.y[b] - T.y[a];
    const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L;
    T.tx[i] = dx; T.ty[i] = dy; T.nx[i] = -dy; T.ny[i] = dx; T.ang[i] = Math.atan2(dy, dx);
  }
  for(let i = 0; i < n; i++){
    const a = (i - 1 + n) % n, b = (i + 1) % n;
    T.curv[i] = angWrap(T.ang[b] - T.ang[a]) / (2 * ds);
  }
  // camber: a straight cross-slope, for off-camber corners (Casino)
  T.camber = new Float64Array(n);
  if(def.camber) for(let i = 0; i < n; i++) T.camber[i] = def.camber(i / n);
  // how steep the road is here, along the lap (+ is uphill)
  T.grade = i => (T.z[(i + 1) % n] - T.z[(i - 1 + n) % n]) / (2 * ds);
  // smooth elevation so the ribbon does not stair-step
  const zs = new Float64Array(n);
  for(let p = 0; p < 3; p++){
    for(let i = 0; i < n; i++) zs[i] = (T.z[(i - 1 + n) % n] + 2 * T.z[i] + T.z[(i + 1) % n]) / 4;
    T.z.set(zs);
  }

  /* --- self-crossings: carry one section over the other on a bridge --- */
  T.bridge = new Uint8Array(n);
  T.deckH = new Float64Array(n);
  // a covered section: node i is under the roof between the two lap fractions
  T.inTunnel = i => !!def.tunnel && (i / n) >= def.tunnel[0] && (i / n) <= def.tunnel[1];
  {
    const sep = T.width + 9, sep2 = sep * sep;
    const minApart = Math.max(200, length * 0.07);
    const span = Math.max(4, Math.round(55 / ds));
    // collect every pair of far-apart nodes that sit on top of each other
    const pairs = [];
    for(let i = 0; i < n; i++){
      for(let j = i + 1; j < n; j++){
        let dS = (j - i) * ds; dS = Math.min(dS, length - dS);
        if(dS < minApart) continue;
        const dx = T.x[i] - T.x[j], dy = T.y[i] - T.y[j];
        if(dx * dx + dy * dy <= sep2) pairs.push([i, j]);
      }
    }
    // group them into crossings — one decision per crossing, or the two decks fight
    const groups = [];
    for(const pr of pairs){
      const g = groups[groups.length - 1];
      if(g && pr[0] - g.iMax <= 4 && Math.abs(pr[1] - g.jLast) <= 30){
        g.iMax = Math.max(g.iMax, pr[0]); g.jLast = pr[1]; g.items.push(pr);
      } else groups.push({ iMax:pr[0], jLast:pr[1], items:[pr] });
    }
    const bump = new Float64Array(n);
    for(const g of groups){
      let zi = 0, zj = 0;
      for(const pr of g.items){ zi += T.z[pr[0]]; zj += T.z[pr[1]]; }
      zi /= g.items.length; zj /= g.items.length;
      const overIsFirst = zi >= zj;                      // one side carries the bridge
      const sep = Math.abs(zi - zj), need = Math.max(0, 8.5 - sep);
      for(const pr of g.items){
        const hi = overIsFirst ? pr[0] : pr[1];
        for(let k = -span; k <= span; k++){
          const idx = (hi + k + n) % n;
          const w = 0.5 * (1 + Math.cos(Math.PI * k / span));
          if(need * w > bump[idx]) bump[idx] = need * w;
          // the deck exists over the whole crossing even where the land already
          // gives the clearance — otherwise the upper road floats on nothing
          if(Math.abs(k) <= span * 0.75){ T.bridge[idx] = 1; T.deckH[idx] = Math.max(T.deckH[idx], (sep + need) * w); }
        }
      }
    }
    for(let i = 0; i < n; i++) T.z[i] += bump[i];
  }

  /* --- racing line: curvature minimisation inside the white lines --------- */
  const lim = T.half * 0.78 - 1.2, off = new Float64Array(n);
  for(let i = 0; i < n; i++) off[i] = clamp(Math.sign(T.curv[i]) * Math.min(1, Math.abs(T.curv[i]) * 120) * lim, -lim, lim);
  const px = i => T.x[i] + T.nx[i] * off[i], py = i => T.y[i] + T.ny[i] * off[i];
  for(let it = 0; it < 220; it++){
    for(let i = 0; i < n; i++){
      const a = (i - 1 + n) % n, b = (i + 1) % n;
      const mx = (px(a) + px(b)) / 2 - px(i), my = (py(a) + py(b)) / 2 - py(i);
      off[i] = clamp(off[i] + (mx * T.nx[i] + my * T.ny[i]) * 0.42, -lim, lim);
    }
  }
  T.line = off;
  T.lcurv = new Float64Array(n);
  for(let i = 0; i < n; i++){
    const a = (i - 1 + n) % n, b = (i + 1) % n;
    const ax = px(a), ay = py(a), bx = px(b), by = py(b), cx = px(i), cy = py(i);
    const v1x = cx - ax, v1y = cy - ay, v2x = bx - cx, v2y = by - cy;
    const cr = v1x * v2y - v1y * v2x, d1 = Math.hypot(v1x, v1y), d2 = Math.hypot(v2x, v2y);
    const d3 = Math.hypot(bx - ax, by - ay);
    T.lcurv[i] = (2 * cr) / ((d1 * d2 * d3) || 1);
  }

  /* --- speed profile ------------------------------------------------------ */
  /* Real banking, tied to the corners themselves. Each banked corner names a
     window to look in; its arc is wherever the curvature there is above a third
     of its peak, and the banking ramps in before the arc and out after it. The
     cross-section is progressive: the slope across the road starts at g0 at the
     inside edge and steepens to g1 at the outside (dz/ds = g0 + (g1-g0)(s/W)^p),
     carrying on up the apron to the wall. A "camber" corner is a gentle linear
     tilt of the track itself, held level beyond the kerbs. Nothing is banked
     inside the pit-lane zone. */
  if(def.banking){
    const B = def.banking, Wt = new Float64Array(n), Sd = new Int8Array(n), Cw = new Float64Array(n), Cg = new Float64Array(n);
    const PD0 = def.pit || {}, pin = Math.round(n * (PD0.in != null ? PD0.in : 0.86)), pout = Math.round(n * (PD0.out != null ? PD0.out : 0.10));
    const inPit = i => { const span = ((pout - pin + n) % n) || 1, a = (i - pin + n) % n; return a <= span; };
    T.bankArcs = [];
    for(const c of B.corners){
      const i0 = Math.round(c.a * n), i1 = Math.round(c.b * n), len = ((i1 - i0) % n + n) % n;
      let pk = 0, sg = 0;
      for(let k = 0; k <= len; k++){ const i = (i0 + k) % n, v = Math.abs(T.curv[i]); if(v > pk){ pk = v; sg = Math.sign(T.curv[i]); } }
      let s0 = -1, s1 = -1;
      for(let k = 0; k <= len; k++){ const i = (i0 + k) % n; if(Math.abs(T.curv[i]) > pk * 0.33 && Math.sign(T.curv[i]) === sg){ if(s0 < 0) s0 = k; s1 = k; } }
      const ramp = Math.max(2, Math.round((c.ramp || 40) / ds));
      for(let k = s0 - ramp; k <= s1 + ramp; k++){
        const i = ((i0 + k) % n + n) % n;
        const e = k < s0 ? (k - (s0 - ramp)) / ramp : k > s1 ? ((s1 + ramp) - k) / ramp : 1, w = e * e * (3 - 2 * e);
        if(c.kind === "camber"){ if(w > Cw[i]){ Cw[i] = w; Cg[i] = -sg * c.g; } }
        else if(w > Wt[i]){ Wt[i] = w; Sd[i] = -sg; }
      }
      T.bankArcs.push({ name:c.name, kind:c.kind || "bank", u0:((i0 + s0) % n) / n, u1:((i0 + s1) % n) / n, ramp:ramp * ds });
    }
    for(let i = 0; i < n; i++) if(inPit(i)) Wt[i] = 0;
    const g0 = B.g0, g1 = B.g1, p = B.p, half = T.half, Wb = 2 * half + (B.apron || 3);
    const top = g0 * Wb + (g1 - g0) * Wb / (p + 1);
    const Zs = s => s <= 0 ? 0 : s <= Wb ? g0 * s + (g1 - g0) * Wb * Math.pow(s / Wb, p + 1) / (p + 1) : top + g1 * (s - Wb);
    const zc = Zs(half), lim = half + 1.6;
    T.bankProfile = { g0, g1, p, Wb, Zs, half };
    T.bankW = Wt; T.bankOut = Sd; T.bankCamber = Cw;
    T.bankZf = (k, o) => {
      let z = 0;
      const w = Wt[k]; if(w) z += w * (Zs(o * Sd[k] + half) - zc);
      const c = Cw[k]; if(c) z += c * Cg[k] * clamp(o, -lim, lim);
      return z;
    };
    // the speed a corner can be taken at feels the slope where the racing line runs
    for(let i = 0; i < n; i++){
      const w = Wt[i]; if(!w){ T.bank[i] = 0; continue; }
      const sl = clamp(T.line[i] * Sd[i] + half, 0, Wb) / Wb;
      T.bank[i] = w * (g0 + (g1 - g0) * Math.pow(sl, p)) * (B.speedK != null ? B.speedK : 1);
    }
  }
  const V = new Float64Array(n), VMAX = 92, ALAT = 30 * (def.width >= 14.5 ? 1 : 0.94), ABRK = 36, AACC = 12;
  const ks = new Float64Array(n);
  for(let i = 0; i < n; i++){
    const a = (i - 1 + n) % n, b = (i + 1) % n;
    const sm = (Math.abs(T.curv[a]) + Math.abs(T.curv[i]) * 2 + Math.abs(T.curv[b])) / 4;
    ks[i] = Math.max(Math.abs(T.lcurv[i]), sm * 0.62);
  }
  for(let i = 0; i < n; i++){
    const kk = ks[i] + 1e-6;
    V[i] = clamp(Math.sqrt((ALAT * (1 + T.bank[i] * 1.8)) / kk), 12.5, VMAX);
  }
  for(let p = 0; p < 3; p++){
    for(let i = n - 1; i >= 0; i--){ const b = (i + 1) % n; V[i] = Math.min(V[i], Math.sqrt(V[b] * V[b] + 2 * ABRK * ds)); }
    for(let i = 0; i < n; i++){ const a = (i - 1 + n) % n; V[i] = Math.min(V[i], Math.sqrt(V[a] * V[a] + 2 * AACC * ds)); }
  }
  T.vprof = V;

  /* --- spatial hash for nearest-node queries ------------------------------ */
  let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
  for(let i = 0; i < n; i++){ minX = Math.min(minX, T.x[i]); maxX = Math.max(maxX, T.x[i]);
                              minY = Math.min(minY, T.y[i]); maxY = Math.max(maxY, T.y[i]); }
  T.bounds = { minX, minY, maxX, maxY, w:maxX - minX, h:maxY - minY };
  const CELL = 60;
  T.cell = CELL; T.gw = Math.ceil((maxX - minX) / CELL) + 3; T.gh = Math.ceil((maxY - minY) / CELL) + 3;
  T.grid = Array.from({ length:T.gw * T.gh }, () => []);
  const cellIdx = (x, y) => {
    const cx = clamp(Math.floor((x - minX) / CELL) + 1, 0, T.gw - 1);
    const cy = clamp(Math.floor((y - minY) / CELL) + 1, 0, T.gh - 1);
    return cy * T.gw + cx;
  };
  T.cellIdx = cellIdx;
  for(let i = 0; i < n; i++){
    const cx = Math.floor((T.x[i] - minX) / CELL) + 1, cy = Math.floor((T.y[i] - minY) / CELL) + 1;
    for(let a = -1; a <= 1; a++) for(let b = -1; b <= 1; b++){
      const gx2 = clamp(cx + a, 0, T.gw - 1), gy2 = clamp(cy + b, 0, T.gh - 1);
      T.grid[gy2 * T.gw + gx2].push(i);
    }
  }
  T.near = (x, y, hint) => {
    if(hint != null){                       // cheap local search from the last frame
      let best = hint, bd = 1e18;
      for(let o = -14; o <= 14; o++){ const i = (hint + o + n) % n;
        const d = (T.x[i] - x) ** 2 + (T.y[i] - y) ** 2; if(d < bd){ bd = d; best = i; } }
      if(bd < 3600) return best;
    }
    const list = T.grid[cellIdx(x, y)]; let best = 0, bd = 1e18;
    if(list.length){ for(const i of list){ const d = (T.x[i] - x) ** 2 + (T.y[i] - y) ** 2; if(d < bd){ bd = d; best = i; } } }
    else { for(let i = 0; i < n; i++){ const d = (T.x[i] - x) ** 2 + (T.y[i] - y) ** 2; if(d < bd){ bd = d; best = i; } } }
    return best;
  };

  // the height of the road surface under any point: the ribbon is straight
  // between nodes, so this is exact for the mesh that gets drawn
  T.surfZ = (x, y, hint) => {
    const i = T.near(x, y, hint), dx = x - T.x[i], dy = y - T.y[i];
    const off = dx * T.nx[i] + dy * T.ny[i], al = dx * T.tx[i] + dy * T.ty[i];
    const j = (i + (al >= 0 ? 1 : n - 1)) % n, f = Math.min(Math.abs(al) / ds, 1);
    const cam = T.camber[i] + (T.camber[j] - T.camber[i]) * f;
    return T.z[i] + (T.z[j] - T.z[i]) * f + off * cam + bankZ(T, i, off);
  };
  // the height of the surface at a node and offset: the one place everything else asks
  T.zAt = (i, o) => T.z[i] + bankZ(T, i, o) + o * T.camber[i];

  /* --- pit lane ----------------------------------------------------------- */
  // where the lane is, if the circuit says; otherwise the old default
  const PD = def.pit || {};
  T.pitSide = PD.side || -1;
  T.pitIn = Math.round(n * (PD.in != null ? PD.in : 0.86)); T.pitOut = Math.round(n * (PD.out != null ? PD.out : 0.10));
  T.pitBox = Math.round(n * (PD.box != null ? PD.box : 0.975)) % n;
  T.pitW = PD.width || 7.6;
  T.pitSpan = ((T.pitOut - T.pitIn + n) % n) || 1;
  // 0..1 through the pit zone, -1 outside it
  T.pitU = i => { const a = (i - T.pitIn + n) % n; return a <= T.pitSpan ? a / T.pitSpan : -1; };
  // the lane opens off the straight, runs parallel, then merges back
  T.pitRamp = i => { const u = T.pitU(i); if(u < 0) return 0;
    return clamp(Math.min(u / 0.14, (1 - u) / 0.14), 0, 1); };
  T.pitEdge = i => T.half + T.pitW * T.pitRamp(i);              // outer edge, pit side
  T.pitCentre = i => T.pitSide * (T.half + T.pitW * T.pitRamp(i) * 0.5);
  T.inPitLane = (i, off) => { const r = T.pitRamp(i); if(r <= 0.03) return false;
    const o = off * T.pitSide; return o > T.half - 0.6 && o < T.half + T.pitW * r + 0.6; };
  T.inPitZone = i => T.pitU(i) >= 0;
  // the limit, the lines, the two lanes and a box for every team (src/tracks/pitlane.js)
  addPitLane(T);

  /* --- sectors + set dressing --------------------------------------------- */
  T.sec = [0, Math.round(n / 3), Math.round(2 * n / 3)];
  const rnd = mulberry(def.id.split("").reduce((a, c) => a + c.charCodeAt(0), 7) * 2654435761);
  T.props = [];
  // how much room each kind of object needs around it
  // which side of the circuit faces away from the middle of it
  let cX = 0, cY = 0;
  for(let i = 0; i < n; i++){ cX += T.x[i]; cY += T.y[i]; }
  cX /= n; cY /= n;
  let outv = 0;
  for(let i = 0; i < n; i += 5) outv += (T.nx[i] * (T.x[i] - cX) + T.ny[i] * (T.y[i] - cY)) > 0 ? 1 : -1;
  T.outSide = outv > 0 ? 1 : -1;
  const sideOf = e => e.side === "out" ? T.outSide : e.side === "in" ? -T.outSide
                    : (e.side || (rnd() < 0.5 ? 1 : -1));
  const CLEAR = { tree:5, palm:5, dune:11, grandstand:20, hotel:17, tower:15, yacht:25,
                  pylon:3, ferris:34, garage:15, banking:0, stadium:0,
                  neon:9, sphere:0, billboard:7, arch:0, marshal:4, fence:3, lm:0 };
  // a circuit doubles back on itself, so "40m to the side of node X" can land on node Y
  const clears = (x, y, need) => {
    if(need <= 0) return true;
    const j = T.near(x, y);
    if(Math.hypot(x - T.x[j], y - T.y[j]) < T.half + need) return false;
    // the nearest-node lookup is local, so sweep the whole lap coarsely as well
    for(let k = 0; k < n; k += 3){
      const dx = x - T.x[k], dy = y - T.y[k];
      if(dx * dx + dy * dy < (T.half + need) * (T.half + need)) return false;
    }
    return true;
  };
  // trees go down last, so they can keep clear of the grandstands and buildings
  const sceneOrder = [...(def.scene || [])].sort((a, b) => (a.t === "tree") - (b.t === "tree"));
  const hitsStructure = (x, y, cr) => {
    for(const q of T.props){
      if(q.t === "tree" || q.t === "marshal" || q.t === "fence" || q.t === "billboard" || q.t === "arch") continue;
      const dx = x - q.x, dy = y - q.y;
      if(q.t === "grandstand" || q.t === "garage" || q.wid){
        const c = Math.cos(q.rot), s = Math.sin(q.rot);
        if(Math.abs(dx * c + dy * s) < (q.wid || 26) / 2 + cr + 4 && Math.abs(-dx * s + dy * c) < 24 + cr) return true;
      } else if(dx * dx + dy * dy < (Math.max(14, q.h * 0.6) + cr) ** 2) return true;
    }
    return false;
  };
  for(const e of sceneOrder){
    for(let i = 0; i < e.n; i++){
      const u = e.a + (e.b - e.a) * ((i + 0.5) / e.n + (rnd() - 0.5) * 0.012);
      const idx = ((Math.round(u * n) % n) + n) % n;
      const side = sideOf(e);
      let need = CLEAR[e.t] != null ? CLEAR[e.t] : 6;
      // a canopy is wider than the trunk: keep it off the tarmac, not just the trunk
      if(e.t === "tree") need = Math.max(need, e.h[1] * 0.45);
      const halfLen = e.wid ? e.wid / 2 : 0;
      let placed = false;
      // try the intended spot, then progressively further out before giving up
      for(let attempt = 0; attempt < 6 && !placed; attempt++){
        const off2 = e.off * (e.wid ? 1 : (0.82 + rnd() * 0.5)) + attempt * (need * 0.8 + halfLen * 0.25);
        const px = T.x[idx] + T.nx[idx] * off2 * side, py = T.y[idx] + T.ny[idx] * off2 * side;
        if(!clears(px, py, need)) continue;
        if(e.t === "tree" && hitsStructure(px, py, e.h[1] * 0.45)) continue;
        if(halfLen){
          const tx2 = Math.cos(T.ang[idx]), ty2 = Math.sin(T.ang[idx]);
          let ok = true;
          for(const f of [-1, -0.5, 0.5, 1]) if(!clears(px + tx2 * halfLen * f, py + ty2 * halfLen * f, 12)){ ok = false; break; }
          if(!ok) continue;
        }
        T.props.push({ t:e.t, k:e.k, wid:e.wid, x:px, y:py, z:T.z[idx], h:lerp(e.h[0], e.h[1], rnd()),
                       col:e.col, rot:T.ang[idx], r:rnd(), only2d:!!e.only2d });
        placed = true;
      }
    }
  }
  /* --- the land the circuit sits in --------------------------------------- */
  // Painted before the circuit is, so a patch is allowed to run across the road:
  // the tarmac, verge and runoff go down afterwards and cover it. That means no
  // clearance search, and a field can be the size of a real field.
  T.land = [];
  for(const e of (def.land || [])){
    const a0 = e.a == null ? 0 : e.a, b0 = e.b == null ? 1 : e.b;
    for(let i = 0; i < e.n; i++){
      const u = a0 + (b0 - a0) * ((i + 0.5) / e.n + (rnd() - 0.5) * 0.05);
      const idx = ((Math.round(u * n) % n) + n) % n;
      const side = sideOf(e);
      const along = (rnd() - 0.5) * (e.spread == null ? (e.far - e.near) * 0.7 : e.spread);
      const rad = lerp(e.size[0], e.size[1], rnd());
      let off = lerp(e.near, e.far, rnd()), cx, cy, ok = true;
      // water and anything else marked `clear` must not end up lying across the
      // circuit, so walk it outwards until it is genuinely clear of every node
      for(let att = 0; ; att++){
        cx = T.x[idx] + T.nx[idx] * off * side + Math.cos(T.ang[idx]) * along;
        cy = T.y[idx] + T.ny[idx] * off * side + Math.sin(T.ang[idx]) * along;
        if(!e.clear) break;
        if(clears(cx, cy, rad * 0.86)) break;
        if(att >= 5){ ok = false; break; }
        off += rad * 0.55;
      }
      if(!ok) continue;
      let pts;
      if(e.t === "parcel"){
        // straight-edged land: farm parcels, city blocks, car parks, aprons
        const rot = (e.angle == null ? T.ang[idx] : e.angle) + (rnd() - 0.5) * (e.jitter == null ? 0.18 : e.jitter);
        const hw = rad * (0.45 + rnd() * 0.75), hl = rad * (0.5 + rnd() * 0.95);
        const c2 = Math.cos(rot), s2 = Math.sin(rot);
        pts = [[hl, hw], [hl, -hw], [-hl, -hw], [-hl, hw]]
          .map(q => [cx + q[0] * c2 - q[1] * s2, cy + q[0] * s2 + q[1] * c2]);
      } else {
        // organic land: woodland, scrub, water, dunes
        const k = 8 + Math.floor(rnd() * 4);
        const el = 1.25 + rnd() * 1.5, ea = rnd() * TAU;          // a long axis
        const ce = Math.cos(ea), se = Math.sin(ea);
        let last = 0.5 + rnd() * 0.9;
        pts = [];
        for(let q = 0; q < k; q++){
          // walk the radius rather than redrawing it, so the edge is ragged
          // rather than spiky
          last = clamp(last + (rnd() - 0.5) * 0.55, 0.42, 1.5);
          const th = q / k * TAU + (rnd() - 0.5) * 0.30;
          const lx = Math.cos(th) * rad * last * el, ly = Math.sin(th) * rad * last / el;
          pts.push([cx + lx * ce - ly * se, cy + lx * se + ly * ce]);
        }
      }
      const ent = { x:cx, y:cy, z:T.z[idx] - (e.drop || 0), r:rad, pts, col:e.col, drop:e.drop || 0,
                    kind:e.kind || (e.drop ? "water" : e.t === "parcel" ? "asphalt" : "grass") };
      if(e.rim){
        const g = 1 + (e.rimW || 8) / rad;
        ent.rim = e.rim;
        ent.rimPts = pts.map(q => [cx + (q[0] - cx) * g, cy + (q[1] - cy) * g]);
      }
      T.land.push(ent);
    }
  }
  // biggest first: a bay goes down before the promenade that sits on its edge
  T.land.sort((a, b) => b.r - a.r);

  // a garage for every team, right behind its own box, in its own colours (the order is pitlane.js's)
  for(const b of T.pitBoxes){
    const f = b.f, i = Math.floor(f) % T.n, j = (i + 1) % T.n, u = f - Math.floor(f);
    if(T.pitRamp(i) < 0.85) continue;
    const o = T.pitSide * (T.half + T.pitW + 7.0);
    const gx2 = T.x[i] + (T.x[j] - T.x[i]) * u + T.nx[i] * o, gy2 = T.y[i] + (T.y[j] - T.y[i]) * u + T.ny[i] * o;
    if(!clears(gx2, gy2, 9)) continue;
    T.props.push({ t:"garage", only2d:!!def.survey, x:gx2, y:gy2, z:T.z[i], h:4.6, w:13.6, team:b.id,
                   col:b.team.body, rot:T.ang[i], r:0.5 });
  }
  /* Run-off, corner by corner.
     Most circuits are one number all the way round and stay that way. A street
     track is not: the Strip is walled within a metre or two of the white line
     for most of the lap, and then there are four or five places with a proper
     asphalt escape. runoffZones says where those are, as lap fractions and a
     width for each side; everywhere else falls back to def.runoff.
     Sign convention: r is the +off side (along the normal), l is -off. */
  {
    const base = def.runoff || 0;
    T.roL = new Float64Array(n); T.roR = new Float64Array(n);
    T.roL.fill(base); T.roR.fill(base);
    for(const z of (def.runoffZones || [])){
      const i0 = Math.round(z.a * n), i1 = Math.round(z.b * n);
      const span = ((i1 - i0) % n + n) % n || 1;
      const ramp = Math.max(3, Math.round(span * 0.22));
      for(let k = 0; k <= span; k++){
        const i = (i0 + k) % n;
        // ease in and out, so the wall line does not step
        const e = Math.min(1, Math.min(k, span - k) / ramp);
        const w2 = e * e * (3 - 2 * e);
        if(z.l != null) T.roL[i] = Math.max(T.roL[i], base + (z.l - base) * w2);
        if(z.r != null) T.roR[i] = Math.max(T.roR[i], base + (z.r - base) * w2);
      }
    }
    // what the run-off is made of, where a circuit says: 0 is the old one-surface
    // behaviour, then asphalt, gravel, grass, artificial grass, asphalt-then-gravel,
    // and "plain": the old untyped run-off, kept for a circuit that only wants a few traps
    const SC = { asphalt:1, gravel:2, grass:3, astro:4, mix:5, plain:6 };
    if(def.runoffSurf){
      T.rsL = new Uint8Array(n).fill(SC[def.runoffSurf] || 3); T.rsR = new Uint8Array(n).fill(SC[def.runoffSurf] || 3);
      T.rtL = new Float32Array(n); T.rtR = new Float32Array(n);
      T.astro = def.runoffAstro || 0;
      for(const z of (def.runoffZones || [])){
        const i0 = Math.round(z.a * n), i1 = Math.round(z.b * n), span = ((i1 - i0) % n + n) % n || 1;
        for(let k = 0; k <= span; k++){
          const i = (i0 + k) % n;
          if(z.ls){ T.rsL[i] = SC[z.ls]; T.rtL[i] = z.lt || 0; }
          if(z.rs){ T.rsR[i] = SC[z.rs]; T.rtR[i] = z.rt || 0; }
        }
      }
      // which barrier stands at the end of it: 0 the track's own, 1 a SAFER wall
      T.barL = new Uint8Array(n); T.barR = new Uint8Array(n);
      for(const z of (def.runoffZones || [])){
        const i0 = Math.round(z.a * n), i1 = Math.round(z.b * n), span = ((i1 - i0) % n + n) % n || 1;
        for(let k = 0; k <= span; k++){ const i = (i0 + k) % n; if(z.lb === "safer") T.barL[i] = 1; if(z.rb === "safer") T.barR[i] = 1; }
      }
      T.safer = (i, sd) => (sd < 0 ? T.barL[i] : T.barR[i]) === 1;
      // which surface is under a car at this offset
      T.surfAt = (i, off) => {
        const a = Math.abs(off) - T.half, code = off >= 0 ? T.rsR[i] : T.rsL[i], ro = off >= 0 ? T.roR[i] : T.roL[i];
        if(a > ro) return "grass";
        if(code === 5) return a < (off >= 0 ? T.rtR[i] : T.rtL[i]) ? "asphalt" : "gravel";
        if(code === 3 && a < T.astro + 1.6) return "astro";
        return ["", "asphalt", "gravel", "grass", "astro", "", "runoff"][code];
      };
    }
    let mx = base;
    for(let i = 0; i < n; i++) mx = Math.max(mx, T.roL[i], T.roR[i]);
    T.runoffMax = mx;
    // the width on whichever side a car has wandered onto
    T.roAt = (i, off) => (off >= 0 ? T.roR[i] : T.roL[i]);
    // true where an escape road ends and the barrier stops being concrete
    T.tecpro = (i, sd) => (sd >= 0 ? T.roR[i] : T.roL[i]) > base + 2.5;
  }

  addKerbs(T);
  return T;
}


export { buildTrack };
