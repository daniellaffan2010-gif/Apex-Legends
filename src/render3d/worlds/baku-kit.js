import * as THREE from 'three';
import { TAU, clamp } from '../../config/util.js';
import { L, shadeC, fh, sst, Mesher, paint, merge } from './cota-kit.js';
import { shaft, ledge, outline, rooftop, CELLW } from './singapore-kit.js';

/* ---------- Baku's kit ------------------------------------------------------------------
   A sunny sandstone city: three small shared facade textures (stone with windows, blue glass, concrete panel), lit by the sun
   like everything else (Lambert with vertex colours as the tint), and the buildings, old walls and landmarks built from them.
   The Town/UMesher/shaft machinery is Singapore's; here "grid" is stone, "band" is glass and "slim" is panel.          */

function dayTextures(){
  const mk = (variant) => {
    const N = 256, C = 32, cv = document.createElement("canvas"); cv.width = cv.height = N;
    const g = cv.getContext("2d"); let a = variant * 6151 + 29;
    const r = () => { a = (a * 16807) % 2147483647; return a / 2147483647; };
    g.fillStyle = variant === 1 ? "#9CC4DA" : "#FFFFFF"; g.fillRect(0, 0, N, N);
    for(let y = 0; y < 8; y++) for(let x = 0; x < 8; x++){
      const X = x * C, Y = y * C;
      if(variant === 0){                                   // stone: a deep window with a light lintel and sill, some with shutters
        g.fillStyle = "#26324A"; g.fillRect(X + 8, Y + 7, 16, 18);
        g.fillStyle = "#E8DCC0"; g.fillRect(X + 6, Y + 5, 20, 3); g.fillRect(X + 6, Y + 25, 20, 3);
        if(r() < 0.3){ g.fillStyle = ["#7A9A5A", "#8A5A3A", "#5A7A9A"][Math.floor(r() * 3)]; g.fillRect(X + 4, Y + 7, 4, 18); g.fillRect(X + 24, Y + 7, 4, 18); }
        else if(r() < 0.3){ g.fillStyle = "#5A6A8A"; g.fillRect(X + 8, Y + 7, 16, 6); }
        if(r() < 0.2){ g.fillStyle = "#3A3A44"; g.fillRect(X + 5, Y + 25, 22, 2); }
      } else if(variant === 1){                            // glass: a dark aluminium frame, a pane that reflects sky or cloud, a solid spandrel under it
        g.fillStyle = "#2C4256"; g.fillRect(X, Y, C, C);
        const k = r(), gr = g.createLinearGradient(X, Y, X, Y + 23);
        if(k < 0.2){ gr.addColorStop(0, "#F0F8FC"); gr.addColorStop(1, "#8CBCD6"); }           // a pane catching a cloud
        else if(k < 0.65){ gr.addColorStop(0, "#9AD0EC"); gr.addColorStop(1, "#3E7CA6"); }
        else { gr.addColorStop(0, "#5C9CC4"); gr.addColorStop(1, "#244E74"); }                  // a deep pane
        g.fillStyle = gr; g.fillRect(X + 2, Y + 2, C - 3, 21);
        g.fillStyle = "rgba(255,255,255,0.28)"; g.beginPath(); g.moveTo(X + 3, Y + 22); g.lineTo(X + 14, Y + 2); g.lineTo(X + 20, Y + 2); g.lineTo(X + 9, Y + 22); g.fill();
        g.fillStyle = r() < 0.5 ? "#4A6C84" : "#56788E"; g.fillRect(X + 2, Y + 24, C - 3, 7);   // spandrel
        g.fillStyle = "#9CB4C4"; g.fillRect(X, Y + 23, C, 1);
      } else {                                             // concrete panels: pairs of small windows and balcony bands
        g.fillStyle = "#E4E0D6"; g.fillRect(X, Y, C, C);
        g.fillStyle = "#3A4658"; g.fillRect(X + 4, Y + 7, 9, 14); g.fillRect(X + 19, Y + 7, 9, 14);
        g.fillStyle = r() < 0.5 ? "#B8B4A8" : "#D0CCBE"; g.fillRect(X, Y + 23, C, 5);
        g.fillStyle = "#B4B0A4"; g.fillRect(X + C - 1, Y, 1, C);
      }
    }
    const t = new THREE.CanvasTexture(cv); t.encoding = THREE.sRGBEncoding; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
    return t;
  };
  return { grid:mk(0), band:mk(1), slim:mk(2) };
}

const SAND = [[1.0, 0.92, 0.76], [0.98, 0.86, 0.68], [1.0, 0.82, 0.66], [0.94, 0.88, 0.78], [1.0, 0.9, 0.84], [0.92, 0.82, 0.64], [1.0, 0.8, 0.72]];
const GLASS = [[0.85, 1.0, 1.1], [0.9, 1.05, 1.1], [0.8, 0.95, 1.05], [1.0, 1.05, 1.1]];
const PANEL = [[1.0, 0.98, 0.94], [0.92, 0.92, 0.9], [1.0, 0.94, 0.86], [0.9, 0.94, 0.98]];
const ROOF = ["#B8553A", "#A8482E", "#9A4A34", "#C0643E"];

/* Day planting, instanced with the tint mask: a palm (tall, curved, a head of fronds), an umbrella pine, a plane tree, and a flower bed. */
function plantGeos(){
  const G = {}, trunk = (r0, r1, h, col, seg) => { const t = new THREE.CylinderGeometry(r1, r0, h, seg || 5); t.translate(0, h / 2, 0); return paint(t, () => L(col), () => 0); };
  const blob = (r, x, y, z, sy, lo, hi, det) => { const b = new THREE.IcosahedronGeometry(r, det || 0); b.scale(1, sy, 1); b.translate(x, y, z); const A = L(lo), B = L(hi); return paint(b, (px, py, pz, f) => A.clone().lerp(B, clamp(sst(y - r * sy, y + r * sy, py) + (fh(f) - 0.5) * 0.4, 0, 1))); };
  { const parts = [], N = 6;
    for(let k = 0; k < N; k++){ const c = new THREE.CylinderGeometry(0.02, 0.03, 0.17, 5); c.translate(0, 0.085 + k * 0.165, 0); c.translate(k * k * 0.005, 0, 0); parts.push(paint(c, (x, y) => L(k & 1 ? "#8A7458" : "#7A6448"), () => 0)); }
    const top = N * 0.165 + 0.01, tx = (N - 1) * (N - 1) * 0.005;
    for(let k = 0; k < 10; k++){ const a = k / 10 * TAU, f = new THREE.PlaneGeometry(0.5, 0.1); f.rotateX(-Math.PI / 2); f.translate(0.25, 0, 0); f.rotateZ(-0.38 - (k & 1) * 0.12); f.rotateY(a); f.translate(tx, top, 0);
      parts.push(paint(f, (x, y, z, i) => L("#4C8A44").clone().lerp(L("#8AB85A"), fh(i)), () => 1)); }
    const nut = new THREE.IcosahedronGeometry(0.04, 0); nut.translate(tx, top - 0.03, 0); parts.push(paint(nut, () => L("#6A4A24"), () => 0));
    G.palm = merge(parts); }
  G.pine = merge([trunk(0.035, 0.025, 0.55, "#6A5640", 5), blob(0.4, 0, 0.78, 0, 0.45, "#3A6A3A", "#5E8E4A", 0), blob(0.3, 0.2, 0.86, 0.1, 0.4, "#3E6E3C", "#628E4C"), blob(0.26, -0.2, 0.84, -0.12, 0.4, "#3A6A3A", "#5E8A48")]);
  G.pineFar = merge([trunk(0.035, 0.025, 0.5, "#6A5640", 4), blob(0.5, 0, 0.78, 0, 0.42, "#3E6E3C", "#628E4C")]);
  G.tree = merge([trunk(0.05, 0.035, 0.46, "#6A5A46", 6), blob(0.42, 0, 0.7, 0, 0.8, "#4C7E3E", "#86B055", 1), blob(0.3, 0.26, 0.64, 0.1, 0.75, "#528440", "#8CB65A"), blob(0.28, -0.24, 0.66, -0.12, 0.75, "#4C7E3E", "#82AC52")]);
  G.treeFar = merge([trunk(0.05, 0.035, 0.42, "#6A5A46", 4), blob(0.5, 0, 0.68, 0, 0.8, "#528440", "#86B055")]);
  { const b = new THREE.BoxGeometry(1.4, 0.45, 0.6); b.translate(0, 0.22, 0); const p = [paint(b, () => L("#C8B898"), () => 0)];
    for(let k = 0; k < 7; k++){ const f = new THREE.OctahedronGeometry(0.17, 0); f.translate(-0.6 + k * 0.2, 0.55, (k & 1) * 0.08 - 0.04); p.push(paint(f, (x, y, z, i) => L(["#E84A6A", "#F2C230", "#F4F4F0", "#B848E0"][i & 3]), () => 0)); }
    G.planter = merge(p); }
  return G;
}
/* a gull: a body and two wings that flap (the wing tips carry the `arm` weight the shader moves) */
function gullGeo(){
  const g = new THREE.BufferGeometry(), W = [1, 1, 1];
  const pos = [0, 0, -0.1, 0.55, 0, 0.1, 0, 0, 0.12, 0, 0, -0.1, 0, 0, 0.12, -0.55, 0, 0.1, 0.12, 0.02, -0.1, -0.12, 0.02, -0.1, 0, 0.02, 0.4];
  const idx = [0, 1, 2, 3, 4, 5, 6, 7, 8];
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  const col = []; for(let k = 0; k < 9; k++){ const c = L(k >= 6 ? "#E8E8EC" : "#F6F6F8"); col.push(c.r, c.g, c.b); }
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3)); g.setAttribute("tintMask", new THREE.BufferAttribute(new Float32Array(9), 1));
  g.setAttribute("arm", new THREE.BufferAttribute(new Float32Array([0, 1, 0, 0, 0, 1, 0, 0, 0]), 1));
  g.computeVertexNormals(); return g;
}
/* a kite: a diamond on a short tail, in the tint's colour */
function kiteGeo(){
  const m = new Mesher(), C = L("#FFFFFF");
  m.tri([0, 0, 0.5], [0.3, 0, 0], [-0.3, 0, 0], C); m.tri([0, 0, -0.5], [-0.3, 0, 0], [0.3, 0, 0], C);
  for(let k = 0; k < 5; k++) m.box(0, 0, -0.7 - k * 0.22, 0.05, 0.12, 0.1, 0, L(k & 1 ? "#E84A4A" : "#FFFFFF"));
  const g = m.geometry(); const N = g.attributes.position.count;
  g.setAttribute("tintMask", new THREE.BufferAttribute(new Float32Array(N).fill(1), 1)); g.setAttribute("arm", new THREE.BufferAttribute(new Float32Array(N), 1)); return g;
}

/* ---- the buildings ---- */
function building(T, b, beacons){
  const seed = b.seed || 1, z0 = b.z, ca = Math.cos(b.ang), sa = Math.sin(b.ang), m = T.get("solid", b.x, b.y);
  const pick = (a) => a[seed % a.length];
  switch(b.type){
    case "old": {                                                                  // a low flat-roofed house: a parapet, water tank, a dish; sometimes a little minaret
      const tint = pick(SAND);
      shaft(T, b.x, b.y, b.ang, b.w, b.d, z0 - 0.3, z0 + b.h, "grid", tint, seed, "#C8B896");
      ledge(T, b.x, b.y, b.ang, b.w + 0.6, b.d + 0.6, z0 + b.h, 0.7, "#E0D2B4");
      rooftop(T, { ...b, h:30 }, z0 + b.h + 0.7, fh(seed + 2), [], "#B8A888");
      if(fh(seed + 5) < 0.06) { const mx = b.x + ca * b.w * 0.3, my = b.y + sa * b.w * 0.3; m.frustum(mx, my, z0 + b.h, z0 + b.h + 12, 1.1, 0.8, 8, L("#E8DCC0"), L("#D8CCAE")); m.cone(mx, my, z0 + b.h + 12.8, 3, 1.3, 8, L("#5A8A9A")); }
      break; }
    case "stone": {                                                                // a sandstone mid-rise: cornice, balconies, a tiled or flat roof
      const tint = pick(SAND), fl = Math.max(2, Math.round(b.h / 3.6));
      shaft(T, b.x, b.y, b.ang, b.w, b.d, z0 - 0.3, z0 + b.h, "grid", tint, seed, null);
      ledge(T, b.x, b.y, b.ang, b.w + 1.0, b.d + 1.0, z0 + b.h - 0.6, 0.9, "#EADFC6");
      if(fh(seed + 3) < 0.5) for(let k = 2; k < fl; k += 2) ledge(T, b.x, b.y, b.ang, b.w + 0.9, b.d + 0.9, z0 + k * 3.6 - 0.2, 0.25, "#D8C8A6");
      if(fh(seed + 4) < 0.5) m.gable(b.x, b.y, z0 + b.h + 0.3, b.w + 1.2, b.d + 1.2, 2.4 + fh(seed) * 1.6, b.ang, L(pick(ROOF)));
      else { ledge(T, b.x, b.y, b.ang, b.w, b.d, z0 + b.h, 0.5, "#C8B896"); rooftop(T, b, z0 + b.h + 0.5, fh(seed + 2), [], "#B8A888"); }
      break; }
    case "soviet": {                                                                // a concrete slab
      const tint = pick(PANEL);
      shaft(T, b.x, b.y, b.ang, b.w, b.d, z0 - 0.3, z0 + b.h, "slim", tint, seed, "#A8A498");
      rooftop(T, b, z0 + b.h, fh(seed + 2), [], "#8A8678");
      break; }
    case "glass": {                                                                 // a glass tower: setbacks, a crown
      const tint = pick(GLASS), tiers = b.h > 90 ? 3 : 2; let z = z0 - 0.3, w = b.w, d = b.d, left = b.h;
      shaft(T, b.x, b.y, b.ang, w + 6, d + 6, z, z + 6, "grid", pick(SAND), seed + 1, "#C8B896"); z += 6; left -= 6;
      for(let t = 0; t < tiers; t++){ const th = t === tiers - 1 ? left : left * 0.55; shaft(T, b.x, b.y, b.ang, w, d, z, z + th, "band", tint, seed + t, "#7AA0B8"); z += th; left -= th; w *= 0.78; d *= 0.78; }
      if(fh(seed + 9) < 0.5){ m.pole(b.x, b.y, z, b.x, b.y, z + 14 + fh(seed) * 14, 0.4, L("#C8CCD4")); } else { outline(T.get("bright", b.x, b.y), b.x, b.y, z, w / 0.78, d / 0.78, b.ang, "#FFFFFF", 0.4); }
      break; }
    case "hotel": {
      const tint = pick(SAND), hp = 6 + fh(seed) * 3;
      shaft(T, b.x, b.y, b.ang, b.w + 5, b.d + 5, z0 - 0.3, z0 + hp, "grid", tint, seed, "#C8B896");
      shaft(T, b.x, b.y, b.ang, b.w, b.d, z0 + hp, z0 + b.h, fh(seed + 6) < 0.5 ? "band" : "grid", fh(seed + 6) < 0.5 ? pick(GLASS) : tint, seed + 4, "#B8A888");
      ledge(T, b.x, b.y, b.ang, b.w + 5.6, b.d + 5.6, z0 + hp, 0.5, "#EADFC6");
      T.get("solid", b.x, b.y).box(b.x + ca * 0, b.y + sa * 0, z0 + 3.4, 3, b.d + 5.6, 0.2, b.ang, L("#D8352A"));
      break; }
  }
}

/* The Old City wall: a stone curtain with battlements, round towers, as the plan gave their heights. */
function cityWall(T, W, TW){
  const m = (x, y) => T.get("solid", x, y), STONE = "#D6C49C", STONE2 = "#C8B488", CAP = "#E2D2AA";
  for(let k = 0; k < W.length - 1; k++){
    const a = W[k], b = W[k + 1]; if(Math.hypot(b.x - a.x, b.y - a.y) > 14) continue;
    const mm = m(a.x, a.y), th = 1.7, dx = b.x - a.x, dy = b.y - a.y, L2 = Math.hypot(dx, dy) || 1, nx = -dy / L2 * th / 2, ny = dx / L2 * th / 2, za = a.z, zb = b.z;
    // two faces and the top
    mm.quad([a.x - nx, a.y - ny, za - 0.3], [b.x - nx, b.y - ny, zb - 0.3], [b.x - nx, b.y - ny, zb + b.h], [a.x - nx, a.y - ny, za + a.h], L((k >> 1) & 1 ? STONE : STONE2));
    mm.quad([a.x + nx, a.y + ny, za + a.h], [b.x + nx, b.y + ny, zb + b.h], [b.x + nx, b.y + ny, zb - 0.3], [a.x + nx, a.y + ny, za - 0.3], L((k >> 1) & 1 ? STONE2 : STONE));
    mm.quad([a.x - nx, a.y - ny, za + a.h], [b.x - nx, b.y - ny, zb + b.h], [b.x + nx, b.y + ny, zb + b.h], [a.x + nx, a.y + ny, za + a.h], L(CAP));
    // merlons along the top, every other segment, on the tall stretches
    if(a.h > 3.2 && k % 2 === 0) mm.box((a.x + b.x) / 2, (a.y + b.y) / 2, (za + zb) / 2 + (a.h + b.h) / 2, L2 * 0.55, th * 0.9, 0.9, Math.atan2(dy, dx), L(CAP));
  }
  for(const t of TW){
    const mm = m(t.x, t.y), r = t.r;
    mm.frustum(t.x, t.y, t.z - 0.3, t.z + t.h, r * 1.08, r, 12, k => L(k & 1 ? STONE : STONE2), L(CAP));
    mm.frustum(t.x, t.y, t.z + t.h, t.z + t.h + 0.7, r * 1.25, r * 1.25, 12, L(CAP), L(STONE2));
    for(let q = 0; q < 8; q++){ const a = q / 8 * TAU; mm.box(t.x + Math.cos(a) * r * 1.15, t.y + Math.sin(a) * r * 1.15, t.z + t.h + 0.7, 1.1, 1.0, 1.1, a, L(CAP)); }
  }
}

/* the Maiden Tower: a stout cylinder with a buttress, a stepped crown; the Government House: long, symmetric, a central tower; the carpet-shaped museum; a white wave */
function maiden(T, M){
  const m = T.get("solid", M.x, M.y), S1 = L("#D9C79F"), S2 = L("#CDB98E"), z = M.z - 0.4, h = M.h;
  m.frustum(M.x, M.y, z, z + h, 8.8, 7.2, 14, k => (k & 1 ? S1 : S2), L("#E2D2AA"));
  m.frustum(M.x, M.y, z + h, z + h + 1.4, 8.3, 8.3, 14, L("#E2D2AA"), L("#D0BE94"));
  for(let q = 0; q < 12; q++){ const a = q / 12 * TAU; m.box(M.x + Math.cos(a) * 8.2, M.y + Math.sin(a) * 8.2, z + h + 1.4, 1.5, 1.1, 1.4, a, L("#E2D2AA")); }
  m.frustum(M.x, M.y, z + h * 0.55, z + h * 0.85, 4.4, 3.4, 10, L("#CDB98E"), L("#D0BE94"));          // a drum above the roof line
  m.frustum(M.x, M.y, z + h * 0.30, z + h * 0.48, 9.6, 9.0, 14, L("#C6B284"), L("#C6B284"));          // a stepped ring part-way up
  const ca = Math.cos(M.ang), sa = Math.sin(M.ang); m.box(M.x + ca * 7.6, M.y + sa * 7.6, z, 5, 3, h * 0.82, M.ang, L("#D2BF96"));   // the buttress on one side
}
function govHouse(T, M){
  const ca = Math.cos(M.ang), sa = Math.sin(M.ang), z = M.z - 0.3, h = M.h;
  shaft(T, M.x, M.y, M.ang, M.w, M.d, z, z + h * 0.8, "grid", [1.0, 0.92, 0.78], 77, "#C8B896");
  shaft(T, M.x, M.y, M.ang, 30, 26, z + h * 0.8, z + h * 1.25, "grid", [1.0, 0.94, 0.82], 78, "#C8B896");
  const m = T.get("solid", M.x, M.y), br = T.get("bright", M.x, M.y);
  for(let k = -5; k <= 5; k++) m.box(M.x - sa * (M.d / 2 + 2) + ca * k * 3.4, M.y + ca * (M.d / 2 + 2) + sa * k * 3.4, z, 0.9, 0.9, h * 0.62, M.ang, L("#F0E8D4"));
  m.box(M.x - sa * (M.d / 2 + 1.2), M.y + ca * (M.d / 2 + 1.2), z + h * 0.62, 38, 4.6, 0.8, M.ang, L("#E8DFC6"));
  m.gable(M.x - sa * (M.d / 2 + 1.0), M.y + ca * (M.d / 2 + 1.0), z + h * 0.62 + 0.8, 38, 5, 3.4, M.ang, L("#9A8E78"));
  m.frustum(M.x, M.y, z + h * 1.25, z + h * 1.25 + 7, 8, 4.6, 12, L("#E4D8BC"), L("#C8D8DC")); m.cone(M.x, M.y, z + h * 1.25 + 7, 5, 5, 12, L("#6AA0B0"));
  for(const s of [-1, 1]) m.box(M.x + ca * s * (M.w / 2 - 6), M.y + sa * s * (M.w / 2 - 6), z + h * 0.8, 12, M.d * 0.7, 3, M.ang, L("#9A8E78"));
  br.box(M.x - sa * (M.d / 2 + 2.4), M.y + ca * (M.d / 2 + 2.4), z + 0.2, 36, 0.2, 0.3, M.ang, L("#FFE8B0"));
}
function carpet(T, M){
  const m = T.get("solid", M.x, M.y), N = 14, ca = Math.cos(M.ang), sa = Math.sin(M.ang), z = M.z - 0.3, R = M.d / 2, len = M.w;
  const P = (a, th, rad) => [M.x + ca * a - sa * Math.cos(th) * rad, M.y + sa * a + ca * Math.cos(th) * rad, z + Math.sin(th) * rad * 0.8];
  const cols = ["#C8442A", "#E8B040", "#2A5A8A", "#E8DCC0", "#8A2A2A"];
  for(let k = 0; k < N; k++){
    const t0 = k / N * Math.PI, t1 = (k + 1) / N * Math.PI, C = L(cols[k % cols.length]);
    m.quad(P(-len / 2, t0, R), P(len / 2, t0, R), P(len / 2, t1, R), P(-len / 2, t1, R), C);
    m.tri(P(-len / 2, 0, 0), P(-len / 2, t0, R), P(-len / 2, t1, R), L("#E8D8B0")); m.tri(P(len / 2, 0, 0), P(len / 2, t1, R), P(len / 2, t0, R), L("#E8D8B0"));
  }
  m.box(M.x, M.y, z - 0.3, len + 8, R * 2 + 8, 0.6, M.ang, L("#D8CCB0"));
}
function wave(T, M){
  const m = T.get("solid", M.x, M.y), br = T.get("band", M.x, M.y), ca = Math.cos(M.ang), sa = Math.sin(M.ang), z = M.z - 0.3, NA = 18, NB = 8;
  const P = (ia, ib) => { const a = (ia / NA - 0.5) * M.w, b = (ib / NB - 0.5) * M.d, env = Math.sin(ia / NA * Math.PI) * (0.5 + 0.5 * Math.sin(ib / NB * Math.PI)), hgt = 6 + env * M.h * (0.55 + 0.45 * Math.sin(ia / NA * 9 + ib * 0.6));
    return [M.x + ca * a - sa * b, M.y + sa * a + ca * b, z + hgt]; };
  for(let ia = 0; ia < NA; ia++) for(let ib = 0; ib < NB; ib++){ const A = P(ia, ib), B2 = P(ia + 1, ib), C = P(ia + 1, ib + 1), D = P(ia, ib + 1); m.quad(A, B2, C, D, L((ia + ib) & 1 ? "#F4F4F0" : "#E8E8E4")); }
  shaft(T, M.x, M.y, M.ang, M.w * 0.9, M.d * 0.9, z, z + 6, "band", [0.9, 1.0, 1.05], 88, null);
}
/* the three flame-shaped towers: leaning leaf-shaped shafts, glass below and a bright warm crown above */
function flame(T, F, beacons){
  const m = T.get("solid", F.x, F.y), br = T.get("bright", F.x, F.y), gl = T.get("band", F.x, F.y), ca = Math.cos(F.ang), sa = Math.sin(F.ang);
  const hs = [F.h, F.h * 0.93, F.h * 0.86], dx = [-56, 0, 56];
  for(let t = 0; t < 3; t++){
    const cx = F.x + ca * dx[t] * 0.9, cy = F.y + sa * dx[t] * 0.9, H = hs[t], SL = 14, z0 = Math.max(0, F.z || 0);
    const rad = f => 26 * (1 - 0.62 * Math.pow(f, 1.5)) * (0.85 + 0.35 * Math.sin(f * Math.PI)), lean = f => -10 * f * f;
    for(let k = 0; k < SL; k++){
      const f0 = k / SL, f1 = (k + 1) / SL, r0 = rad(f0), r1 = rad(f1), top = f1 > 0.78;
      const C = L(["#FF8A2A", "#FFB830", "#FF5A2A"][(k + t) % 3]), N = 7;
      for(let q = 0; q < N; q++){
        const a0 = q / N * TAU + F.ang, a1 = (q + 1) / N * TAU + F.ang, p = (a, rr, f) => [cx + Math.cos(a) * rr + ca * lean(f), cy + Math.sin(a) * rr * 0.62 + sa * lean(f), F.base + f * H];
        if(top){ br.quad(p(a0, r0, f0), p(a1, r0, f0), p(a1, r1, f1), p(a0, r1, f1), C); continue; }
        /* the glass skin: the window texture over a light blue tint, shaded a little by facet so the curve reads */
        const sh = (q & 1 ? 1 : 0.84) * (k & 1 ? 1 : 0.94), seg = Math.max(r0, r1) * TAU / N * 0.8;
        const u0 = t * 1.7 + q * seg / CELLW.band / 8, u1 = u0 + seg / CELLW.band / 8, v0 = (F.base + f0 * H) / 3.8 / 8, v1 = (F.base + f1 * H) / 3.8 / 8;
        gl.quadUV(p(a0, r0, f0), p(a1, r0, f0), p(a1, r1, f1), p(a0, r1, f1), new THREE.Color(0.78 * sh, 0.98 * sh, 1.18 * sh), u0, v0, u1, v1);
      }
    }
    beacons.push([cx + ca * lean(1), cy + sa * lean(1), F.base + H + 1]);
    m.box(cx, cy, F.base - 0.4, rad(0) * 2.2, rad(0) * 1.6, 3, F.ang, L("#C8B896"));
  }
}

export { dayTextures, plantGeos, gullGeo, kiteGeo, building, cityWall, maiden, govHouse, carpet, wave, flame, SAND, ROOF };
