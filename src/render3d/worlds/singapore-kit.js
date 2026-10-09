import * as THREE from 'three';
import { TAU, clamp } from '../../config/util.js';
import { L, shadeC, fh, sst, Mesher, paint, merge } from './cota-kit.js';

/* ---------- Singapore's night kit ------------------------------------------------
   Everything stylised, flat-shaded, vertex-coloured. What glows glows because of its MATERIAL, never a light:
     * windows: three small shared canvas textures (an apartment grid, an office band, a narrow tower) on unlit
       materials, so a facade is two triangles and the lit/dark pattern is a texture lookup;
     * "bright" parts (neon edges, crowns, lamp lenses, roof beacons) are vertex colours on one unlit material;
     * everything else is Lambert, lit by the scene's moon and city glow.
   UMesher is cota-kit's Mesher plus a UV per vertex.                                                         */

class UMesher extends Mesher {
  constructor(){ super(); this.uv = []; }
  /* a quad a(bottom left), b(bottom right), c(top right), d(top left) with its texture rectangle */
  quadUV(a, b, c, d, C, u0, v0, u1, v1){
    if(this.tri(a, b, c, C)) this.uv.push(u0, v0, u1, v0, u1, v1);
    if(this.tri(a, c, d, C)) this.uv.push(u0, v0, u1, v1, u0, v1);
  }
  geometry(){ const g = super.geometry(); g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uv, 2)); return g; }
}

/* the meshers by place and by kind: windows (three textures), solid (Lambert), bright (unlit) */
class Town {
  constructor(size){ this.size = size; this.map = new Map(); }
  get(kind, x, y){
    const key = kind + "|" + Math.floor(x / this.size) + "," + Math.floor(y / this.size);
    let m = this.map.get(key);
    if(!m){ m = (kind === "grid" || kind === "band" || kind === "slim") ? new UMesher() : new Mesher(); this.map.set(key, m); }
    return m;
  }
  get tris(){ let t = 0; for(const m of this.map.values()) t += m.tris; return t; }
  emit(group, mats, cast){
    let made = 0;
    for(const [key, m] of this.map){
      if(!m.pos.length) continue;
      const kind = key.split("|")[0], mesh = new THREE.Mesh(m.geometry(), mats[kind]);
      mesh.castShadow = !!cast && kind === "solid"; mesh.receiveShadow = false; mesh.userData.dynamic = true;
      group.add(mesh); made++;
    }
    return made;
  }
}

/* three window textures. Each is an 8 x 8 grid of cells (3.4 m wide, 3.8 m tall in the world), a mix of warm white, cool white,
   cyan, pink and gold lights, some dim, some dark: shared by every building, with a random offset per building. */
function windowTextures(){
  const mk = (variant) => {
    const N = 256, C = 32, cv = document.createElement("canvas"); cv.width = cv.height = N;
    const g = cv.getContext("2d"); let a = variant * 7919 + 13;
    const r = () => { a = (a * 16807) % 2147483647; return a / 2147483647; };
    g.fillStyle = "#070A18"; g.fillRect(0, 0, N, N);
    const PAL = ["#FFD9A0", "#FFD9A0", "#FFE6B8", "#F2F6FF", "#F2F6FF", "#A8E8FF", "#FFE680", "#FFB0D8", "#C8B8FF"];
    for(let y = 0; y < 8; y++){
      if(variant === 1){                                   // an office floor: long lit strips with a few gaps
        const lit = r() < 0.7; let x = 0;
        while(x < 8){ const w = 1 + Math.floor(r() * 4), on = lit ? r() < 0.82 : r() < 0.18; if(on){ g.fillStyle = PAL[Math.floor(r() * PAL.length)]; g.globalAlpha = 0.65 + r() * 0.35; g.fillRect(x * C, y * C + 8, Math.min(w, 8 - x) * C, C - 16); g.globalAlpha = 1; } x += w; }
        g.fillStyle = "#0B0F20"; for(let x = 0; x < 8; x++) g.fillRect(x * C + C - 2, y * C + 8, 2, C - 16);       // mullions
      } else for(let x = 0; x < 8; x++){
        const on = r() < (variant === 2 ? 0.5 : 0.55);
        const px = variant === 2 ? 8 : 5, wpx = C - px * 2, hpx = variant === 2 ? C - 6 : C - 9;
        if(on){ g.fillStyle = PAL[Math.floor(r() * PAL.length)]; g.globalAlpha = 0.6 + r() * 0.4; g.fillRect(x * C + px, y * C + 4, wpx, hpx); g.globalAlpha = 1; }
        else { g.fillStyle = "#0E1226"; g.fillRect(x * C + px, y * C + 4, wpx, hpx); }
      }
    }
    const t = new THREE.CanvasTexture(cv); t.encoding = THREE.sRGBEncoding; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
    return t;
  };
  return { grid:mk(0), band:mk(1), slim:mk(2) };
}
const CELLW = { grid:3.4, band:3.4, slim:2.6 }, CELLH = { grid:3.8, band:3.8, slim:3.8 };

/* the standard facade tints: how a building's windows are coloured and how bright */
const TINTS = [[1.15, 0.98, 0.80], [1.05, 1.0, 0.92], [0.92, 1.0, 1.15], [1.1, 0.9, 1.1], [0.85, 1.1, 1.15], [1.2, 1.05, 0.8]];

/* A rectangular shaft: four facades with windows (kind: grid, band or slim), a roof. Heights z0..z1. */
function shaft(T, cx, cy, ang, w, d, z0, z1, kind, tint, seed, roof, shadeK){
  const ca = Math.cos(ang), sa = Math.sin(ang), m = T.get(kind, cx, cy), cw = CELLW[kind], ch = CELLH[kind];
  const P = (a, b, z) => [cx + ca * a - sa * b, cy + sa * a + ca * b, z];
  const ux = fh(seed * 3 + 1), uy = fh(seed * 5 + 2);
  const faces = [[-w / 2, -d / 2, w / 2, -d / 2, w, 0.78], [w / 2, -d / 2, w / 2, d / 2, d, 1.0], [w / 2, d / 2, -w / 2, d / 2, w, 0.66], [-w / 2, d / 2, -w / 2, -d / 2, d, 0.9]];
  let k = 0;
  for(const [ax, ay, bx, by, len, sh] of faces){
    const C = new THREE.Color(tint[0], tint[1], tint[2]).multiplyScalar(sh * (shadeK || 1));
    const u0 = ux * 8 + k * 2.7, u1 = u0 + len / cw / 8, v0 = uy * 8 + z0 / ch / 8, v1 = uy * 8 + z1 / ch / 8;
    m.quadUV(P(ax, ay, z0), P(bx, by, z0), P(bx, by, z1), P(ax, ay, z1), C, u0, v0, u1, v1);
    k++;
  }
  if(roof){ const s = T.get("solid", cx, cy); const R = L(roof); s.quad(P(-w / 2, -d / 2, z1), P(w / 2, -d / 2, z1), P(w / 2, d / 2, z1), P(-w / 2, d / 2, z1), R); }
}
/* trim: a thin ledge or a cornice round a shaft, solid */
function ledge(T, cx, cy, ang, w, d, z, h, col){
  T.get("solid", cx, cy).box(cx, cy, z, w, d, h, ang, L(col));
}
/* a glowing OUTLINE round a roof edge: four thin bars, not a slab (a flat unlit plate reads as a huge coloured square from above) */
function outline(m, cx, cy, z, w, d, ang, col, t){
  t = t || 0.45; const ca = Math.cos(ang), sa = Math.sin(ang), C = L(col);
  m.box(cx - sa * d / 2, cy + ca * d / 2, z, w, t, t, ang, C); m.box(cx + sa * d / 2, cy - ca * d / 2, z, w, t, t, ang, C);
  m.box(cx + ca * w / 2, cy + sa * w / 2, z, t, d, t, ang, C); m.box(cx - ca * w / 2, cy - sa * w / 2, z, t, d, t, ang, C);
}
/* a vertical line of neon up a corner, unlit */
function neonLine(T, cx, cy, ang, w, d, z0, z1, col, which){
  const ca = Math.cos(ang), sa = Math.sin(ang), sx = which & 1 ? 1 : -1, sy = which & 2 ? 1 : -1;
  const x = cx + ca * sx * w / 2 - sa * sy * d / 2, y = cy + sa * sx * w / 2 + ca * sy * d / 2;
  T.get("bright", cx, cy).box(x, y, z0, 0.35, 0.35, z1 - z0, ang, L(col));
}
/* a roof's clutter: plant rooms, a water tank, an antenna mast with a red beacon (returned for the blinkers) */
function rooftop(T, b, z, R, beacons, col){
  const m = T.get("solid", b.x, b.y), ca = Math.cos(b.ang), sa = Math.sin(b.ang);
  const rp = (a, c) => [b.x + ca * a - sa * c, b.y + sa * a + ca * c];
  for(let k = 0; k < 2 + Math.floor(R * 3); k++){
    const [x, y] = rp((fh(b.seed + k * 7) - 0.5) * b.w * 0.5, (fh(b.seed + k * 11) - 0.5) * b.d * 0.5);
    m.box(x, y, z, 3 + fh(b.seed + k) * 5, 3 + fh(b.seed + k + 3) * 4, 2 + fh(b.seed + k + 5) * 2.5, b.ang, L(col || "#3A3850"));
  }
  if(b.h > 70){
    const [x, y] = rp(0, 0), mh = 14 + R * 18;
    m.pole(x, y, z, x, y, z + mh, 0.25, L("#6A6E80"));
    m.pole(x, y, z + mh * 0.5, x + 1.8, y, z + mh * 0.5 - 2, 0.1, L("#6A6E80"));
    beacons.push([x, y, z + mh + 0.4]);
  }
}

/* instanced species with the tint mask: a rain tree (a wide umbrella of leaves on a clean trunk), a palm, a shrub */
function treeGeos(){
  const TRUNK = "#4A3C34", G = {};
  const trunk = (r0, r1, h, col, seg) => { const t = new THREE.CylinderGeometry(r1, r0, h, seg || 6); t.translate(0, h / 2, 0); return paint(t, () => L(col || TRUNK), () => 0); };
  const blob = (r, x, y, z, sy, lo, hi, det) => { const b = new THREE.IcosahedronGeometry(r, det || 0); b.scale(1, sy, 1); b.translate(x, y, z);
    const A = L(lo), B = L(hi); return paint(b, (px, py, pz, f) => A.clone().lerp(B, clamp(sst(y - r * sy, y + r * sy, py) + (fh(f) - 0.5) * 0.4, 0, 1))); };
  // the rain tree: a trunk forking to a broad flat crown, dark and lush
  G.tree = merge([trunk(0.05, 0.034, 0.5, TRUNK, 6),
    blob(0.5, 0, 0.72, 0, 0.42, "#1A3A2C", "#3A6A46", 0), blob(0.36, 0.42, 0.66, 0.1, 0.4, "#1C3E2E", "#3E6E4A"), blob(0.34, -0.4, 0.68, -0.12, 0.4, "#1A3A2C", "#386846"),
    blob(0.3, 0.06, 0.66, 0.42, 0.4, "#1E402F", "#3C6C48"), blob(0.3, -0.06, 0.7, -0.42, 0.4, "#1C3C2D", "#3A6A46")]);
  G.treeFar = merge([trunk(0.05, 0.034, 0.46, TRUNK, 4), blob(0.62, 0, 0.7, 0, 0.45, "#1C3C2D", "#386846")]);
  // a palm: a curved trunk and a crown of drooping fronds
  { const parts = [], N = 5;
    for(let k = 0; k < N; k++){ const c = new THREE.CylinderGeometry(0.02, 0.028, 0.22, 4); c.translate(0, 0.11 + k * 0.2, 0); c.translate(k * k * 0.006, 0, 0); parts.push(paint(c, () => L("#5A4A3C"), () => 0)); }
    const top = N * 0.2 + 0.02, tx = (N - 1) * (N - 1) * 0.006;
    for(let k = 0; k < 9; k++){ const a = k / 9 * TAU, f = new THREE.PlaneGeometry(0.46, 0.09); f.rotateX(-Math.PI / 2); f.translate(0.23, 0, 0); f.rotateZ(-0.35); f.rotateY(a); f.translate(tx, top, 0);
      parts.push(paint(f, (x, y, z, i) => L("#1E4A34").clone().lerp(L("#3E7A50"), fh(i)), () => 1)); }
    const nut = new THREE.IcosahedronGeometry(0.035, 0); nut.translate(tx, top - 0.03, 0); parts.push(paint(nut, () => L("#3A2A1C"), () => 0));
    G.palm = merge(parts); }
  // a planter: a box of flowers, magenta and gold under the lamps
  { const b = new THREE.BoxGeometry(1.2, 0.5, 0.5); b.translate(0, 0.25, 0); const p = [paint(b, () => L("#4A4658"), () => 0)];
    for(let k = 0; k < 6; k++){ const f = new THREE.OctahedronGeometry(0.17, 0); f.translate(-0.5 + k * 0.2, 0.62, (k & 1) * 0.08 - 0.04); p.push(paint(f, (x, y, z, i) => L(["#C8387A", "#F2C230", "#E8E8F0", "#B848E0"][i & 3]), () => 0)); }
    G.planter = merge(p); }
  return G;
}

/* a street lamp (a pole, an arm, a lens), and a floodlight pylon with its truss and lamp bank, in instance space:
   +x points toward the road, y up, unit scale in metres */
function lampGeos(){
  const box = (w, h, d, x, y, z, col, mask) => { const b = new THREE.BoxGeometry(w, h, d); b.translate(x, y, z); return paint(b, () => L(col), () => mask || 0); };
  const cyl = (r0, r1, h, x, y, z, col) => { const c = new THREE.CylinderGeometry(r1, r0, h, 6); c.translate(x, y + h / 2, z); return paint(c, () => L(col), () => 0); };
  const G = {};
  G.lamp = merge([cyl(0.11, 0.07, 5.6, 0, 0, 0, "#4A4E5E"), box(1.5, 0.08, 0.08, 0.7, 5.5, 0, "#4A4E5E"), box(0.5, 0.1, 0.26, 1.35, 5.42, 0, "#2A2C36")]);
  G.pylon = merge([cyl(0.3, 0.16, 11, 0, 0, 0, "#6A6E80"), box(5.8, 0.18, 0.18, 2.7, 10.7, 0.45, "#7A7E90"), box(5.8, 0.18, 0.18, 2.7, 10.7, -0.45, "#7A7E90"), box(5.8, 0.55, 0.12, 2.7, 10.45, 0, "#5A5E70"),
    box(0.9, 0.7, 1.6, 5.7, 10.5, 0, "#2A2C36")]);
  G.lens = merge([box(0.3, 0.12, 1.4, 6.0, 10.2, 0, "#FFF2D0", 0), box(0.1, 0.1, 0.2, 0, 0, 0, "#FFF2D0", 0)]);
  G.lampLens = box(0.34, 0.06, 0.2, 1.4, 5.36, 0, "#FFF0C8", 0);
  return G;
}
/* a stack of three tyres: black, with a white band on the middle one, a blue one on top */
function tyreGeo(){
  const parts = []; const ring = (y, col) => { const c = new THREE.CylinderGeometry(0.55, 0.55, 0.32, 10); c.translate(0, y, 0); return paint(c, () => L(col), () => 0); };
  parts.push(ring(0.16, "#16161C"), ring(0.49, "#E8E8F0"), ring(0.82, "#2E4A9A"));
  return merge(parts);
}
/* a small cabin boat, a ferry with lit windows, and a bus: low-poly instances, a body colour that takes the tint */
function vesselGeos(){
  const box = (w, h, d, x, y, z, col, mask) => { const b = new THREE.BoxGeometry(w, h, d); b.translate(x, y, z); return paint(b, () => L(col), () => mask == null ? 0 : mask); };
  const G = {};
  const hull = (l, w, h, col, mask) => { const g = new THREE.BoxGeometry(l, h, w, 1, 1, 1); const p = g.attributes.position;
    for(let i = 0; i < p.count; i++){ const x = p.getX(i); if(x > 0.45 * l){ p.setZ(i, p.getZ(i) * 0.12); } if(p.getY(i) < 0) p.setZ(i, p.getZ(i) * 0.7); }
    g.translate(0, h / 2, 0); return paint(g, () => L(col), () => mask); };
  G.boat = merge([hull(6, 2.2, 0.9, "#F2F2F4", 1), box(2.6, 1.0, 1.6, -0.6, 1.3, 0, "#C8CED8", 0), box(0.1, 3.6, 0.1, 0.4, 2.6, 0, "#9A9EAA", 0), box(0.3, 0.2, 0.3, 2.4, 1.1, 0, "#FFFFFF", 0), box(0.2, 0.2, 0.2, 0.4, 4.5, 0, "#FFD0A0", 0)]);
  G.ferry = merge([hull(16, 4.4, 1.6, "#F4F4F8", 1), box(10, 1.4, 3.8, -1, 2.3, 0, "#FFE6B8", 0), box(9, 1.2, 3.4, -1, 3.7, 0, "#FFD9A0", 0), box(3.4, 1.1, 3.0, 2, 5, 0, "#E8F0FF", 0), box(0.4, 1.8, 0.4, -4.5, 6, 0, "#D8352A", 0)]);
  G.bus = merge([box(11, 2.6, 2.5, 0, 0.9, 0, "#F2F2F4", 1), box(11.02, 0.8, 2.52, 0, 1.9, 0, "#2A3646", 0), box(0.1, 0.3, 2.3, 5.5, 2.5, 0, "#FFE9A0", 0)]);
  return G;
}

export { outline, tyreGeo, UMesher, Town, windowTextures, TINTS, shaft, ledge, neonLine, rooftop, treeGeos, lampGeos, vesselGeos, CELLW };
