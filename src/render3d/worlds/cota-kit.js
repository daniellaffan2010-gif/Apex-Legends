import * as THREE from 'three';
import { TAU, clamp } from '../../config/util.js';

/* ---------- COTA's geometry kit -------------------------------------------------
   Everything here is stylised low-poly with VERTEX colours (MeshLambertMaterial),
   built once and merged or instanced. Nothing repeated is its own draw call.

   Mesher: accumulates flat-shaded triangles in game space (x, y, z up), colours
   per vertex, and emits chunked meshes (so frustum culling still works).
   Species/props: unit-height geometries with a per-vertex "tintMask" (1 takes the
   instance's tint, 0 keeps its own colour: a trunk, a window).                  */

const cache = new Map();
const L = c => { let v = cache.get(c); if(!v){ v = new THREE.Color(c).convertSRGBToLinear(); cache.set(c, v); } return v; };
const shadeC = (c, k) => { const o = L(c).clone(); return k >= 0 ? o.lerp(new THREE.Color(1, 1, 1), k) : o.multiplyScalar(1 + k); };
const fh = f => { let h = Math.imul(f + 7, 2654435761) >>> 0; h ^= h >>> 15; return (h % 1000) / 1000; };
const sst = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

class Mesher {
  constructor(){ this.pos = []; this.col = []; }
  get tris(){ return this.pos.length / 9; }
  /* zero-area triangles are dropped: their vertex normals come out zero-length and
     Lambert's normalize() turns them into NaN, which the bloom pass smears into white blobs */
  tri(a, b, c, C){
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, A = nx * nx + ny * ny + nz * nz;
    if(!(A > 1e-10)) return false;
    const p = this.pos, q = this.col;
    p.push(a[0], a[2], a[1], b[0], b[2], b[1], c[0], c[2], c[1]);
    q.push(C.r, C.g, C.b, C.r, C.g, C.b, C.r, C.g, C.b);
    return true;
  }
  quad(a, b, c, d, C){ this.tri(a, b, c, C); this.tri(a, c, d, C); }
  /* an oriented box on the ground (z0 up to z0+h); l along ang, w across */
  box(cx, cy, z0, l, w, h, ang, C, Ctop){
    const ux = Math.cos(ang) * l / 2, uy = Math.sin(ang) * l / 2, vx = -Math.sin(ang) * w / 2, vy = Math.cos(ang) * w / 2, z1 = z0 + h;
    const p = (s, t, z) => [cx + ux * s + vx * t, cy + uy * s + vy * t, z];
    const A = p(-1, -1, z0), B = p(1, -1, z0), Cc = p(1, 1, z0), D = p(-1, 1, z0), A1 = p(-1, -1, z1), B1 = p(1, -1, z1), C1 = p(1, 1, z1), D1 = p(-1, 1, z1);
    this.quad(A, B, B1, A1, C); this.quad(B, Cc, C1, B1, C); this.quad(Cc, D, D1, C1, C); this.quad(D, A, A1, D1, C);
    this.quad(A1, B1, C1, D1, Ctop || C);
  }
  /* a gable roof over a footprint: ridge along the length */
  gable(cx, cy, z0, l, w, rise, ang, C, Cend){
    const ux = Math.cos(ang) * l / 2, uy = Math.sin(ang) * l / 2, vx = -Math.sin(ang) * w / 2, vy = Math.cos(ang) * w / 2;
    const p = (s, t, z) => [cx + ux * s + vx * t, cy + uy * s + vy * t, z];
    const a = p(-1, -1, z0), b = p(1, -1, z0), c = p(1, 1, z0), d = p(-1, 1, z0), r0 = p(-1, 0, z0 + rise), r1 = p(1, 0, z0 + rise);
    this.quad(a, b, r1, r0, C); this.quad(c, d, r0, r1, C);
    this.tri(a, d, r0, Cend || C); this.tri(b, r1, c, Cend || C);
  }
  /* a frustum standing on z0; closed on top if rt > 0 or capped to a point */
  frustum(cx, cy, z0, z1, r0, r1, N, C, Ctop, twist){
    const ring = (r, z, k) => { const a = k / N * TAU + (twist || 0); return [cx + Math.cos(a) * r, cy + Math.sin(a) * r, z]; };
    for(let k = 0; k < N; k++){
      const Ck = (typeof C === "function") ? C(k) : C;
      this.quad(ring(r0, z0, k), ring(r0, z0, k + 1), ring(r1, z1, k + 1), ring(r1, z1, k), Ck);
      if(Ctop) this.tri([cx, cy, z1], ring(r1, z1, k), ring(r1, z1, k + 1), Ctop);
    }
  }
  /* a roof cone in coloured facets */
  cone(cx, cy, z0, h, r, N, C){
    for(let k = 0; k < N; k++){
      const a0 = k / N * TAU, a1 = (k + 1) / N * TAU, Ck = typeof C === "function" ? C(k) : C;
      this.tri([cx + Math.cos(a0) * r, cy + Math.sin(a0) * r, z0], [cx + Math.cos(a1) * r, cy + Math.sin(a1) * r, z0], [cx, cy, z0 + h], Ck);
    }
  }
  /* a pole between two points, square section */
  pole(x0, y0, z0, x1, y1, z1, r, C){
    const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0, Ln = Math.hypot(dx, dy, dz) || 1;
    // two crossed flat strips: cheap and reads as a rod from any side
    const h = Math.hypot(dx, dy) || 1, nx = -dy / h * r, ny = dx / h * r;
    this.quad([x0 - nx, y0 - ny, z0], [x0 + nx, y0 + ny, z0], [x1 + nx, y1 + ny, z1], [x1 - nx, y1 - ny, z1], C);
    this.quad([x0, y0, z0 - r], [x0, y0, z0 + r], [x1, y1, z1 + r], [x1, y1, z1 - r], C);
  }
  geometry(){
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    g.computeVertexNormals(); g.computeBoundingSphere();
    return g;
  }
}
/* meshers by place: one per square of the map, emitted as one mesh each */
class Chunked {
  constructor(size){ this.size = size; this.map = new Map(); }
  at(x, y){ const k = Math.floor(x / this.size) + "," + Math.floor(y / this.size); let m = this.map.get(k); if(!m){ m = new Mesher(); this.map.set(k, m); } return m; }
  get tris(){ let t = 0; for(const m of this.map.values()) t += m.tris; return t; }
  emit(group, mat, cast){
    let made = 0;
    for(const m of this.map.values()){
      if(!m.pos.length) continue;
      const mesh = new THREE.Mesh(m.geometry(), mat);
      mesh.castShadow = !!cast; mesh.receiveShadow = true; mesh.userData.dynamic = true;   // out of the generic bake: it keeps its own colours
      group.add(mesh); made++;
    }
    return made;
  }
}

/* ---- plant and prop species: geometry painted per vertex, with a tint mask ---- */
function paint(geo, colFn, maskFn){
  const g = geo.index ? geo.toNonIndexed() : geo;
  const p = g.attributes.position, N = p.count;
  const col = new Float32Array(N * 3), msk = new Float32Array(N);
  for(let v = 0; v < N; v++){
    const f = Math.floor(v / 3), c = colFn(p.getX(v), p.getY(v), p.getZ(v), f);
    col[v * 3] = c.r; col[v * 3 + 1] = c.g; col[v * 3 + 2] = c.b;
    msk[v] = maskFn ? maskFn(p.getY(v), f) : 1;
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.setAttribute("tintMask", new THREE.BufferAttribute(msk, 1));
  return g;
}
function merge(geos){
  let n = 0; for(const g of geos) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), msk = new Float32Array(n);
  let o = 0;
  for(const g of geos){
    const c = g.attributes.position.count;
    pos.set(g.attributes.position.array, o * 3); col.set(g.attributes.color.array, o * 3); msk.set(g.attributes.tintMask.array, o);
    o += c;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  out.setAttribute("color", new THREE.BufferAttribute(col, 3));
  out.setAttribute("tintMask", new THREE.BufferAttribute(msk, 1));
  out.computeVertexNormals(); out.computeBoundingSphere();
  return out;
}
const grad = (lo, hi, y0, y1, jit) => { const A = L(lo), B = L(hi);
  return (x, y, z, f) => A.clone().lerp(B, clamp(sst(y0, y1, y) + (fh(f) - 0.5) * (jit || 0.25), 0, 1)); };
const flat = c => { const C = L(c); return () => C; };

function plantGeos(){
  const TRUNK = "#6B5640", TRUNK_D = "#4E4032", G = {};
  const trunk = (r0, r1, h, col, seg) => { const t = new THREE.CylinderGeometry(r1, r0, h, seg || 5); t.translate(0, h / 2, 0); return paint(t, flat(col || TRUNK), () => 0); };
  const blob = (r, x, y, z, sy, lo, hi, det) => { const b = new THREE.IcosahedronGeometry(r, det || 0); b.scale(1, sy, 1); b.translate(x, y, z); return paint(b, grad(lo, hi, y - r * sy, y + r * sy, 0.4)); };
  const cone = (r, h, y, seg, lo, hi) => { const c = new THREE.ConeGeometry(r, h, seg); c.translate(0, y + h / 2, 0); return paint(c, grad(lo, hi, y, y + h, 0.22)); };
  // live oak: a short fat trunk and a wide, low, rounded crown in dusty greens
  G.liveOak = merge([trunk(0.05, 0.035, 0.34, TRUNK_D, 6),
    blob(0.36, 0, 0.56, 0, 0.66, "#4A6040", "#7C9254", 1), blob(0.27, 0.33, 0.50, 0.06, 0.7, "#506846", "#86995A"), blob(0.26, -0.31, 0.52, -0.1, 0.7, "#4A6040", "#80965A"),
    blob(0.24, 0.05, 0.50, 0.32, 0.7, "#546C48", "#889C5E"), blob(0.23, -0.06, 0.54, -0.32, 0.7, "#4C6242", "#7E9458")]);
  G.liveOakFar = merge([trunk(0.05, 0.035, 0.30, TRUNK_D, 4), blob(0.46, 0, 0.55, 0, 0.62, "#4E6644", "#82985A")]);
  // cedar elm: taller, lighter, a rounder crown
  G.elm = merge([trunk(0.04, 0.025, 0.46, TRUNK),
    blob(0.30, 0, 0.64, 0, 0.82, "#5A7844", "#90A860", 1), blob(0.22, 0.14, 0.82, 0.05, 0.85, "#608048", "#98B066"), blob(0.2, -0.13, 0.86, -0.06, 0.85, "#5E7C46", "#94AC62")]);
  G.elmFar = merge([trunk(0.04, 0.025, 0.4, TRUNK, 4), blob(0.34, 0, 0.66, 0, 0.9, "#5E7C46", "#94AC62")]);
  // mesquite: crooked trunk and a flat, feathery, olive umbrella
  { const t = new THREE.CylinderGeometry(0.02, 0.035, 0.46, 5); t.translate(0, 0.23, 0); t.rotateZ(0.12);
    G.mesquite = merge([paint(t, flat(TRUNK_D), () => 0), blob(0.3, 0, 0.56, 0, 0.3, "#76884A", "#A6B26A"), blob(0.26, 0.26, 0.5, 0.05, 0.28, "#7C8E50", "#AAB66C"), blob(0.24, -0.24, 0.52, -0.08, 0.28, "#76884A", "#A2AE66")]); }
  G.mesquiteFar = merge([trunk(0.03, 0.03, 0.4, TRUNK_D, 4), blob(0.42, 0, 0.52, 0, 0.3, "#7C8E50", "#A8B46A")]);
  // juniper: a dark, close, ragged cone
  G.juniper = merge([trunk(0.02, 0.014, 0.18, TRUNK_D), cone(0.30, 0.62, 0.08, 6, "#34503A", "#4E7048"), cone(0.2, 0.5, 0.5, 6, "#3A5A3E", "#5A7E50")]);
  G.juniperFar = merge([cone(0.3, 0.95, 0.05, 5, "#3A583C", "#58784C")]);
  // prickly pear: flat pads on edge, a few red fruit
  { const parts = [];
    for(const [x, y, z, s, rz] of [[0, 0.2, 0, 0.6, 0.15], [0.3, 0.44, 0.05, 0.5, -0.3], [-0.28, 0.4, -0.06, 0.48, 0.4], [0.05, 0.66, 0.1, 0.44, -0.1], [-0.05, 0.38, -0.3, 0.42, 0.2]]){
      const p = new THREE.IcosahedronGeometry(0.28 * s * 1.5, 0); p.scale(1, 1.15, 0.28); p.rotateZ(rz); p.translate(x, y, z);
      parts.push(paint(p, grad("#5E8A52", "#86AE6A", y - 0.2, y + 0.3, 0.3), () => 0.5)); }
    for(const [x, y, z] of [[0.3, 0.7, 0.05], [-0.28, 0.66, -0.06], [0.05, 0.9, 0.1]]){ const b = new THREE.IcosahedronGeometry(0.07, 0); b.translate(x, y, z); parts.push(paint(b, flat("#C42E5C"), () => 0)); }
    G.pear = merge(parts); }
  // yucca: a spiky rosette on a short trunk with a white flower spike
  { const parts = [trunk(0.03, 0.025, 0.26, "#7A6A4C", 4)];
    for(let k = 0; k < 9; k++){ const a = k / 9 * TAU, c = new THREE.ConeGeometry(0.035, 0.55, 3); c.translate(0, 0.275, 0); c.rotateZ(1.0 + (k % 3) * 0.12); c.rotateY(a); c.translate(0, 0.26, 0);
      parts.push(paint(c, grad("#6A8A54", "#9ABA72", 0.2, 0.6, 0.15), () => 0.4)); }
    { const s = new THREE.CylinderGeometry(0.008, 0.012, 0.7, 4); s.translate(0, 0.35 + 0.28, 0); parts.push(paint(s, flat("#C8BC8E"), () => 0));
      const f = new THREE.IcosahedronGeometry(0.1, 0); f.scale(0.7, 1.7, 0.7); f.translate(0, 0.98, 0); parts.push(paint(f, flat("#F6F2E0"), () => 0)); }
    G.yucca = merge(parts); }
  // tall dry grass: a tuft of thin tapered blades, golden
  { const parts = [], seedl = [[0, 0.5], [0.2, 0.4], [-0.2, 0.34], [0.08, -0.2], [-0.12, -0.18], [0.0, 0.0]];
    for(let k = 0; k < seedl.length; k++){
      const [lx, lz] = seedl[k], c = new THREE.ConeGeometry(0.045, 1.0 - k * 0.07, 3, 1, true); c.translate(0, 0.5, 0); c.rotateZ(lx * 0.9); c.rotateX(lz * 0.9); c.translate(lx * 0.12, 0, lz * 0.12);
      parts.push(paint(c, grad("#B2A25E", "#E6D88E", 0.0, 1.0, 0.2), () => 0.7)); }
    G.grass = merge(parts); }
  // wild flowers: five small heads on a green base; the tint carries bluebonnet blue or paintbrush red
  { const parts = [], b = new THREE.OctahedronGeometry(0.2, 0); b.scale(1.2, 0.5, 1.2); b.translate(0, 0.1, 0); parts.push(paint(b, flat("#5E7E3E"), () => 0));
    for(const [x, z, y] of [[0, 0, 0.42], [0.22, 0.12, 0.34], [-0.2, 0.16, 0.38], [0.1, -0.24, 0.32], [-0.14, -0.14, 0.44]]){
      const h = new THREE.OctahedronGeometry(0.11, 0); h.scale(1, 1.5, 1); h.translate(x, y, z); parts.push(paint(h, flat("#FFFFFF"), () => 1)); }
    G.flowers = merge(parts); }
  return G;
}

/* A person, unit height 1 (1.75 m when scaled by h): legs and body in a shirt that takes the tint,
   a head, and a cowboy hat (a brim and a crown) in its own colour. The waver has an arm up. */
function personGeo(wave, hat){
  const parts = [], SK = "#E8B890";
  const bx = (sx, sy, sz, x, y, z, col, mask) => { const b = new THREE.BoxGeometry(sx, sy, sz); b.translate(x, y, z); return paint(b, flat(col), () => mask); };
  // one box for legs and shirt: dark trousers below 0.34, the tinted shirt above
  { const b = new THREE.BoxGeometry(0.22, 0.64, 0.14); b.translate(0, 0.32, 0); const T0 = L("#2E3A52"), W0 = L("#FFFFFF");
    parts.push(paint(b, (x, y) => (y < 0.34 ? T0 : W0), y => (y < 0.34 ? 0 : 1))); }
  const hd = new THREE.OctahedronGeometry(0.085, 0); hd.translate(0, 0.72, 0); parts.push(paint(hd, flat(SK), () => 0));
  if(hat){
    const br = new THREE.CircleGeometry(0.16, 6); br.rotateX(-Math.PI / 2); br.translate(0, 0.775, 0); parts.push(paint(br, flat(hat), () => 0));
    const cr = new THREE.ConeGeometry(0.075, 0.1, 5, 1, true); cr.translate(0, 0.83, 0); parts.push(paint(cr, flat(hat), () => 0));
  }
  if(wave){ const a = new THREE.BoxGeometry(0.05, 0.30, 0.05); a.translate(0.15, 0.78, 0); parts.push(paint(a, flat("#FFFFFF"), () => 1)); }
  const g = merge(parts);
  // waving: the arm's vertices are marked in a second attribute, used by the shader
  const p = g.attributes.position, arm = new Float32Array(p.count);
  if(wave) for(let v = 0; v < p.count; v++) arm[v] = p.getX(v) > 0.11 ? clamp((p.getY(v) - 0.62) / 0.3, 0, 1) : 0;
  g.setAttribute("arm", new THREE.BufferAttribute(arm, 1));
  return g;
}
/* A parked car, 4.3 m by 1.8 m, nose along +x (unit: scaled by sx, sy, sz) */
function carGeo(){
  const parts = [], bx = (sx, sy, sz, x, y, z, col, mask) => { const b = new THREE.BoxGeometry(sx, sy, sz); b.translate(x, y, z); return paint(b, flat(col), () => mask); };
  parts.push(bx(1, 0.34, 0.42, 0, 0.30, 0, "#FFFFFF", 1));
  parts.push(bx(0.5, 0.28, 0.38, -0.04, 0.60, 0, "#2E3640", 0.1));
  for(const z of [0.2, -0.2]) parts.push(bx(0.72, 0.16, 0.05, 0, 0.08, z, "#1C1C20", 0));
  const g = merge(parts); g.setAttribute("arm", new THREE.BufferAttribute(new Float32Array(g.attributes.position.count), 1)); return g;
}
/* a flag: a plane lying along +x, hung from x = 0; pennants are small triangles */
function flagGeo(){
  const g = new THREE.PlaneGeometry(1, 0.62, 5, 2); g.translate(0.5, 0, 0);
  const p = g.attributes.position, col = new Float32Array(p.count * 3), msk = new Float32Array(p.count), A = L("#FFFFFF");
  for(let v = 0; v < p.count; v++){ col[v * 3] = A.r; col[v * 3 + 1] = A.g; col[v * 3 + 2] = A.b; msk[v] = 1; }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3)); g.setAttribute("tintMask", new THREE.BufferAttribute(msk, 1));
  g.setAttribute("arm", new THREE.BufferAttribute(new Float32Array(p.count), 1));
  return g;
}
function pennantGeo(){
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute([-0.2, 0, 0, 0.2, 0, 0, 0, -0.55, 0, -0.2, 0, 0, 0, -0.55, 0, 0.2, 0, 0], 3));
  const A = L("#FFFFFF"); g.setAttribute("color", new THREE.Float32BufferAttribute([A.r, A.g, A.b, A.r, A.g, A.b, A.r, A.g, A.b, A.r, A.g, A.b, A.r, A.g, A.b, A.r, A.g, A.b], 3));
  g.setAttribute("tintMask", new THREE.BufferAttribute(new Float32Array(6).fill(1), 1));
  g.setAttribute("arm", new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 0]), 1));
  g.computeVertexNormals(); return g;
}

export { L, shadeC, fh, sst, Mesher, Chunked, paint, merge, plantGeos, personGeo, carGeo, flagGeo, pennantGeo };
