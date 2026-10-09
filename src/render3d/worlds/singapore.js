import * as THREE from 'three';
import { TAU, clamp } from '../../config/util.js';
import { CFG } from '../../config/settings.js';
import { planSingapore, auditSingapore, WATER_Y, SEABED } from './singapore-plan.js';
import * as K from './cota-kit.js';
import * as N from './singapore-kit.js';
import * as B from './singapore-bld.js';

const { L, shadeC, fh, sst, Mesher } = K;
const WIND = 0.5;
const CROWD = ["#E8402E", "#2E7AE8", "#F2C230", "#F4F2EC", "#2EAA6A", "#E8742A", "#8A4AD8", "#22222A", "#E8509C", "#18B8C8"];

/* ---------- Singapore: the night city -----------------------------------------------
   The circuit stays what the track definition says; around it this builds a dense lit skyline (shared window textures on
   unlit materials), the bay with a fake reflection of the skyline and drifting glints, the old bridge and footbridges,
   shophouses and colonial buildings, an observation wheel, a domed arts centre, rain trees and palms, floodlight pylons
   whose glow is a sprite and a light pool painted along the road, boats, a light show, fireworks, and a rare storm.
   NO real lights: every glow is an emissive/unlit material, an additive sprite or a texture.                         */

/* one material for every instanced thing: vertex colour, the instance's tint where the mask says, and its motion */
function instMat(mode, U){
  const m = new THREE.MeshLambertMaterial({ vertexColors:true });
  const body = { sway:`vec3 sIp = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
  float sSw = (sin(uTime * 1.1 + sIp.x * 0.05 + sIp.z * 0.07) * 0.6 + sin(uTime * 2.3 + sIp.x * 0.11) * 0.25) * 0.01 * max(position.y - 0.3, 0.0);
  transformed.x += sSw * ${Math.cos(WIND).toFixed(3)}; transformed.z += sSw * ${Math.sin(WIND).toFixed(3)};`,
    wave:`vec3 sIp = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
  float ph = sIp.x * 0.37 + sIp.z * 0.51;
  transformed.x += sin(uTime * 6.0 + ph) * 0.22 * arm; transformed.y += (1.0 - cos(uTime * 6.0 + ph)) * 0.03 * arm;`,
    flag:`vec3 sIp = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
  float ph = sIp.x * 0.13 + sIp.z * 0.17;
  float fx = max(position.x, 0.0);
  transformed.y += sin(position.x * 7.0 - uTime * 7.0 + ph) * 0.07 * fx;
  transformed.z += cos(position.x * 6.0 - uTime * 6.0 + ph) * 0.05 * fx;`, plain:"" }[mode];
  m.onBeforeCompile = sh => {
    sh.uniforms.uTime = U;
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float tintMask;\n" + (mode === "wave" || mode === "flag" ? "attribute float arm;\n" : "") + "uniform float uTime;")
      .replace("#include <color_vertex>", `vColor = vec3(1.0);
#ifdef USE_COLOR
  vColor *= color;
#endif
#ifdef USE_INSTANCING_COLOR
  vColor *= mix(vec3(1.0), instanceColor.xyz, tintMask);
#endif`)
      .replace("#include <begin_vertex>", "#include <begin_vertex>\n#ifdef USE_INSTANCING\n  " + body + "\n#endif");
  };
  m.side = mode === "flag" ? THREE.DoubleSide : THREE.FrontSide;
  m.customProgramCacheKey = () => "sgp_" + mode;
  return m;
}
/* chunked instancing: each chunk has its own bounds, so the camera and the shadow pass only draw what they can see */
function instance(g, geo, mat, list, cast, C){
  if(!list.length) return 0;
  if(!geo.boundingSphere) geo.computeBoundingSphere();
  const r0 = geo.boundingSphere.radius + geo.boundingSphere.center.length(), groups = new Map();
  for(const it of list){ const k = Math.floor(it.x / C) + "," + Math.floor(it.y / C); let a = groups.get(k); if(!a){ a = []; groups.set(k, a); } a.push(it); }
  const pos = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), M = new THREE.Matrix4(), tint = new THREE.Color();
  let made = 0;
  for(const items of groups.values()){
    const gg = new THREE.BufferGeometry(); for(const name in geo.attributes) gg.setAttribute(name, geo.attributes[name]);
    const im = new THREE.InstancedMesh(gg, mat, items.length);
    let x0 = 1e9, y0 = 1e9, z0 = 1e9, x1 = -1e9, y1 = -1e9, z1 = -1e9, smax = 0;
    items.forEach((it, i) => {
      pos.set(it.x, it.z, it.y); q.setFromAxisAngle(up, it.ry || 0);
      if(it.sx) sc.set(it.sx, it.sy, it.sz); else { const s = it.h * (it.w || 1); sc.set(s, it.h, s); }
      M.compose(pos, q, sc); im.setMatrixAt(i, M);
      const t = it.tint; if(typeof t === "string") tint.set(t).convertSRGBToLinear(); else if(t) tint.setRGB(t[0], t[1], t[2]); else tint.setRGB(1, 1, 1);
      im.setColorAt(i, tint);
      x0 = Math.min(x0, it.x); x1 = Math.max(x1, it.x); z0 = Math.min(z0, it.y); z1 = Math.max(z1, it.y); y0 = Math.min(y0, it.z); y1 = Math.max(y1, it.z);
      smax = Math.max(smax, sc.x, sc.y, sc.z);
    });
    gg.boundingSphere = new THREE.Sphere(new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), Math.hypot(x1 - x0, y1 - y0, z1 - z0) / 2 + r0 * smax + 2);
    im.instanceMatrix.needsUpdate = true; if(im.instanceColor) im.instanceColor.needsUpdate = true;
    im.castShadow = !!cast; im.receiveShadow = true; im.userData.dynamic = true; g.add(im); made++;
  }
  return made;
}
const dotTex = (inner, stops) => { const cv = document.createElement("canvas"); cv.width = cv.height = 64; const c = cv.getContext("2d"), gr = c.createRadialGradient(32, 32, 0, 32, 32, 32);
  for(const [p, col] of stops) gr.addColorStop(p, col); c.fillStyle = gr; c.fillRect(0, 0, 64, 64); const t = new THREE.CanvasTexture(cv); t.encoding = THREE.sRGBEncoding; return t; };

const SINGAPORE = {
  U:{ value:0 },

  /* ---- the ground: tiles of the plan's grid, and the bay's water with the skyline mirrored under it ---- */
  ground(g, P){
    const { X0, Y0, STEP, NX, NY, H, COL, WATER } = P.grid, TILE = 48, mat = new THREE.MeshLambertMaterial({ vertexColors:true }), c = new THREE.Color();
    this.groundMat = mat; let tiles = 0;
    for(let r0 = 0; r0 < NY - 1; r0 += TILE) for(let c0 = 0; c0 < NX - 1; c0 += TILE){
      const r1 = Math.min(NY - 1, r0 + TILE), c1 = Math.min(NX - 1, c0 + TILE), w = c1 - c0 + 1, h = r1 - r0 + 1;
      const pos = new Float32Array(w * h * 3), col = new Float32Array(w * h * 3), idx = [];
      for(let r = r0; r <= r1; r++) for(let cc = c0; cc <= c1; cc++){
        const k = r * NX + cc, v = (r - r0) * w + (cc - c0);
        pos[v * 3] = X0 + cc * STEP; pos[v * 3 + 1] = H[k]; pos[v * 3 + 2] = Y0 + r * STEP;
        c.setRGB(COL[k * 3], COL[k * 3 + 1], COL[k * 3 + 2]).convertSRGBToLinear(); col[v * 3] = c.r; col[v * 3 + 1] = c.g; col[v * 3 + 2] = c.b;
      }
      for(let r = 0; r < h - 1; r++) for(let cc = 0; cc < w - 1; cc++){ const a = r * w + cc, b = a + 1, d = a + w, e = d + 1; idx.push(a, d, b, b, d, e); }
      const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.BufferAttribute(pos, 3)); geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
      geo.setIndex(idx); geo.computeVertexNormals(); geo.computeBoundingSphere();
      const m = new THREE.Mesh(geo, mat); m.receiveShadow = true; m.userData.dynamic = true; g.add(m); tiles++;
    }
    // the water: a flat sheet over every cell that has water in or next to it; dark, glossy and a little see-through
    const pos = [], uv = [];
    for(let r = 0; r < NY - 1; r++) for(let cc = 0; cc < NX - 1; cc++){
      const k = r * NX + cc; if(!(WATER[k] || WATER[k + 1] || WATER[k + NX] || WATER[k + NX + 1])) continue;
      const x = X0 + cc * STEP, y = Y0 + r * STEP, s = STEP;
      for(const [a, b] of [[0, 0], [0, 1], [1, 0], [1, 0], [0, 1], [1, 1]]){ pos.push(x + a * s, WATER_Y, y + b * s); uv.push((x + a * s) / 38, (y + b * s) / 38); }
    }
    const wg = new THREE.BufferGeometry(); wg.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); wg.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2)); wg.computeVertexNormals(); wg.computeBoundingSphere();
    const wm = new THREE.Mesh(wg, new THREE.MeshPhongMaterial({ color:L("#0C3A4C"), shininess:110, specular:new THREE.Color(0.25, 0.3, 0.38), transparent:true, opacity:0.84, depthWrite:false }));
    wm.renderOrder = 2; wm.userData.dynamic = true; g.add(wm);
    // drifting highlights: streaks of warm and cyan light that slide slowly over the water
    const cv = document.createElement("canvas"); cv.width = 256; cv.height = 256; const cx = cv.getContext("2d"); let a = 5;
    const rr = () => { a = (a * 16807) % 2147483647; return a / 2147483647; };
    cx.clearRect(0, 0, 256, 256);
    for(let k = 0; k < 90; k++){ const x = rr() * 256, y = rr() * 256, w = 8 + rr() * 38; cx.fillStyle = ["rgba(255,214,150,", "rgba(120,230,255,", "rgba(255,160,210,", "rgba(255,255,255,"][k % 4] + (0.15 + rr() * 0.45) + ")"; cx.fillRect(x, y, w, 1 + rr() * 1.6); }
    const gt = new THREE.CanvasTexture(cv); gt.wrapS = gt.wrapT = THREE.RepeatWrapping; gt.encoding = THREE.sRGBEncoding;
    this.glintTex = gt;
    const gm = new THREE.Mesh(wg, new THREE.MeshBasicMaterial({ map:gt, transparent:true, opacity:0.55, blending:THREE.AdditiveBlending, depthWrite:false, fog:false }));
    gm.position.y = 0.04; gm.renderOrder = 3; gm.userData.dynamic = true; g.add(gm);
    return tiles;
  },

  /* ---- the skyline and every building, merged: windows, solid parts, unlit bright parts; and its reflection in the bay ---- */
  city(g, P, T){
    const S = P.structs, TW = new N.Town(320), TM = new N.Town(320), beacons = [], mbeac = [];
    const tex = N.windowTextures(), mk = (map, side) => new THREE.MeshBasicMaterial({ map, vertexColors:true, side });
    const mats = { grid:mk(tex.grid, THREE.FrontSide), band:mk(tex.band, THREE.FrontSide), slim:mk(tex.slim, THREE.FrontSide),
      solid:new THREE.MeshLambertMaterial({ vertexColors:true, side:THREE.DoubleSide }), bright:new THREE.MeshBasicMaterial({ vertexColors:true, side:THREE.DoubleSide, toneMapped:false }) };
    const mm = { grid:mk(tex.grid, THREE.DoubleSide), band:mk(tex.band, THREE.DoubleSide), slim:mk(tex.slim, THREE.DoubleSide),
      solid:new THREE.MeshBasicMaterial({ vertexColors:true, side:THREE.DoubleSide }), bright:new THREE.MeshBasicMaterial({ vertexColors:true, side:THREE.DoubleSide }) };
    this.cityMats = mats;
    const draw = (Tn, b, bc) => {
      switch(b.type){
        case "shop": B.shophouses(Tn, b); break;
        case "colonial": B.colonial(Tn, b); break;
        case "deco": B.deco(Tn, b, bc); break;
        case "ring": B.ring(Tn, b, bc); break;
        default: B.block(Tn, b, bc);
      }
    };
    // the wet ones: anything within reach of the bay's edge, and tall enough to see
    const nearWater = (x, y) => { for(let d = 0; d <= 320; d += 80) for(let k = 0; k < 8; k++){ const a = k / 8 * TAU; if(P.isWater(x + Math.cos(a) * d, y + Math.sin(a) * d)) return true; } return false; };
    let mirrored = 0;
    for(const b of S.buildings){
      draw(TW, b, beacons);
      if(b.h > 18 && nearWater(b.x, b.y)){ draw(TM, b, mbeac); mirrored++; }
    }
    // the landmarks that are not in the building list
    if(S.tri){ const b = { ...S.tri, z:Math.max(P.height(S.tri.x, S.tri.y), 0), seed:7 }; B.triTower(TW, b, beacons); B.triTower(TM, b, mbeac); mirrored++; this.triB = b; }
    for(const d of S.domes){ const z = 0; B.dome(TW, { ...d }); B.dome(TM, { ...d }); }
    if(S.merlion) B.merlion(TW, S.merlion, Math.max(P.height(S.merlion.x, S.merlion.y), 0));
    this.beacons = beacons;
    // mirror the reflection set about the water, darker
    for(const m of TM.map.values()){ const p = m.pos, c = m.col; for(let i = 0; i < p.length; i += 3) p[i + 1] = 2 * WATER_Y - p[i + 1]; for(let i = 0; i < c.length; i++) c[i] *= 0.30; }
    const st = { tris:TW.tris, mirrorTris:TM.tris, mirrored };
    st.meshes = TW.emit(g, mats, true); st.mirrorMeshes = TM.emit(g, mm, false);
    return st;
  },

  /* ---- the circuit's own structures: stands (with scaffold, fencing, crowds), the pit building, bridges, the wheel, signs ---- */
  structures(g, P, T){
    const S = P.structs, n = T.n, TW = new N.Town(300), at = P.at, ht = P.height, st = { crowdSpots:[] };
    const pt = (i, side, off, z) => { const a = at(i, side, off); return [a[0], a[1], z]; };
    const WALL = "#6A6C80";

    for(const s of S.stands){
      const { i0, span, side, off0, rows, rowD, rowH, depth } = s, seat = s.col;
      const tread = r => (r & 1 ? shadeC(seat, -0.08) : L(seat)), riser = shadeC(seat, -0.4), aisle = shadeC(seat, 0.3);
      const zb = []; for(let k = 0; k <= span; k++){ const i = (i0 + k) % n, a = at(i, side, off0), b = at(i, side, off0 + depth); zb.push(Math.max(ht(a[0], a[1]), ht(b[0], b[1]), T.z[i] - 0.5) + 0.12); }
      s.zb = zb;
      for(let k = 0; k < span; k++){
        const ia = (i0 + k) % n, ib = (i0 + k + 1) % n, m = TW.get("solid", ...at(ia, side, off0 + depth / 2)), za = zb[k], zn = zb[k + 1], isA = k % 9 === 0;
        for(let r = 0; r < rows; r++){
          const oa = off0 + r * rowD, ob = oa + rowD, ta = za + (r + 1) * rowH, tb = zn + (r + 1) * rowH, lo = r === 0 ? 2.5 : 0;
          m.quad(pt(ia, side, oa, ta), pt(ia, side, ob, ta), pt(ib, side, ob, tb), pt(ib, side, oa, tb), isA ? aisle : tread(r));
          m.quad(pt(ia, side, oa, ta - rowH - lo), pt(ib, side, oa, tb - rowH - lo), pt(ib, side, oa, tb), pt(ia, side, oa, ta), riser);
        }
        m.quad(pt(ia, side, off0 + depth, za + rows * rowH), pt(ib, side, off0 + depth, zn + rows * rowH), pt(ib, side, off0 + depth, zn - 3), pt(ia, side, off0 + depth, za - 3), L(WALL));
        // a lit strip along the front edge of the lowest row, and the scaffold: posts, rails and cross braces at the back
        TW.get("bright", ...at(ia, side, off0)).quad(pt(ia, side, off0 - 0.1, za + rowH + 0.1), pt(ib, side, off0 - 0.1, zn + rowH + 0.1), pt(ib, side, off0 - 0.1, zn + rowH + 0.35), pt(ia, side, off0 - 0.1, za + rowH + 0.35), L("#FFD9A0"));
        if(k % 3 === 0){
          const bk = pt(ia, side, off0 + depth + 0.4, 0), top = za + rows * rowH + 2.4, bot = za - 0.2, bk2 = pt(ib, side, off0 + depth + 0.4, 0);
          m.pole(bk[0], bk[1], bot, bk[0], bk[1], top, 0.1, L("#8A8EA0"));
          for(const f of [0.35, 0.7]){ const z = bot + (top - bot) * f, nxt = pt((ia + 3) % n, side, off0 + depth + 0.4, 0); m.pole(bk[0], bk[1], z, nxt[0], nxt[1], z, 0.06, L("#8A8EA0")); }
          const nx3 = pt((ia + 3) % n, side, off0 + depth + 0.4, 0); m.pole(bk[0], bk[1], bot, nx3[0], nx3[1], top * 0.7 + bot * 0.3, 0.05, L("#8A8EA0"));
        }
      }
      for(const k of [0, span]){ const i = (i0 + k) % n, m = TW.get("solid", ...at(i, side, off0 + depth / 2));
        for(let r = 0; r < rows; r++){ const oa = off0 + r * rowD, ob = oa + rowD, t = zb[k] + (r + 1) * rowH; m.quad(pt(i, side, oa, zb[k] - 3), pt(i, side, ob, zb[k] - 3), pt(i, side, ob, t), pt(i, side, oa, t), L(WALL)); } }
      if(s.roof){
        const top = rows * rowH + 4.4;
        for(let k = 0; k < span; k++){
          const ia = (i0 + k) % n, ib = (i0 + k + 1) % n, m = TW.get("solid", ...at(ia, side, off0 + depth / 2)), za = zb[k] + top, zn = zb[k + 1] + top, f0 = off0 - 2.5, f1 = off0 + depth + 2.5;
          m.quad(pt(ia, side, f0, za), pt(ib, side, f0, zn), pt(ib, side, f1, zn + 0.8), pt(ia, side, f1, za + 0.8), L("#6C7088"));
          m.quad(pt(ia, side, f0, za - 0.5), pt(ib, side, f0, zn - 0.5), pt(ib, side, f1, zn + 0.3), pt(ia, side, f1, za + 0.3), shadeC("#6C7088", -0.4));
          TW.get("bright", ...at(ia, side, f0)).quad(pt(ia, side, f0 + 0.2, za - 0.55), pt(ib, side, f0 + 0.2, zn - 0.55), pt(ib, side, f0 + 0.2, zn - 0.3), pt(ia, side, f0 + 0.2, za - 0.3), L(seat));
          if(k % 5 === 0){ const fa = at(ia, side, f0 + 1.2); m.pole(fa[0], fa[1], zb[k] - 0.5, fa[0], fa[1], za - 0.5, 0.18, L("#7A7E8E")); }
        }
      }
      // catch fencing in front of every stand: posts and three rails, see-through
      for(let k = 0; k < span; k++){
        const ia = (i0 + k) % n, ib = (i0 + k + 1) % n, oa = P.edge(ia, side) + 1.0, ob = P.edge(ib, side) + 1.0, m = TW.get("solid", ...at(ia, side, oa));
        const A = at(ia, side, oa), Bq = at(ib, side, ob), za = ht(A[0], A[1]), zn = ht(Bq[0], Bq[1]), C = L("#8A8EA0");
        for(const hh of [1.4, 2.9, 4.4]) m.quad([A[0], A[1], za + hh], [Bq[0], Bq[1], zn + hh], [Bq[0], Bq[1], zn + hh + 0.12], [A[0], A[1], za + hh + 0.12], C);
        if(k % 3 === 0) m.pole(A[0], A[1], za - 0.2, A[0], A[1], za + 4.6, 0.09, C);
      }
      // the floating stand: a pontoon under it, with legs down into the bay
      if(s.floating){
        for(let k = 0; k < span; k += 2){ const i = (i0 + k) % n, [x, y] = at(i, side, off0 + depth * 0.5); TW.get("solid", x, y).box(x, y, WATER_Y - 0.4, 8, depth + 8, 1.6, T.ang[i], L("#4A5470")); }
      }
    }

    /* the pit building: lit glass over the garages, set-back floors, a roof deck, a timing tower */
    { const pb = S.pit, { i0, span, side, off0 } = pb, D0 = off0, D1 = off0 + pb.depth;
      for(let k = 0; k < span; k++){
        const ia = (i0 + k) % n, ib = (i0 + k + 1) % n, za = T.z[ia] - 0.5, zn = T.z[ib] - 0.5, Fm = TW.get("band", ...at(ia, side, D0)), Sm = TW.get("solid", ...at(ia, side, D0)), Bm = TW.get("bright", ...at(ia, side, D0));
        const u0 = k * T.ds / 3.4 / 8, u1 = (k + 1) * T.ds / 3.4 / 8, tint = new THREE.Color(1.1, 1.0, 0.85);
        Sm.quad(pt(ia, side, D0, za), pt(ib, side, D0, zn), pt(ib, side, D0, zn + 1.1), pt(ia, side, D0, za + 1.1), L("#5A5870"));
        Fm.quadUV(pt(ia, side, D0, za + 1.1), pt(ib, side, D0, zn + 1.1), pt(ib, side, D0, zn + 5.4), pt(ia, side, D0, za + 5.4), tint, u0, 0.1, u1, 0.1 + 4.3 / 3.8 / 8);
        Bm.quad(pt(ia, side, D0 - 0.05, za + 5.4), pt(ib, side, D0 - 0.05, zn + 5.4), pt(ib, side, D0 - 0.05, zn + 5.7), pt(ia, side, D0 - 0.05, za + 5.7), (k >> 1) & 1 ? L("#FF4A4A") : L("#FFF2D8"));
        Sm.quad(pt(ia, side, D0, za + 5.4), pt(ib, side, D0, zn + 5.4), pt(ib, side, D0 + 3.5, zn + 5.4), pt(ia, side, D0 + 3.5, za + 5.4), L("#4A4860"));
        Fm.quadUV(pt(ia, side, D0 + 3.5, za + 5.7), pt(ib, side, D0 + 3.5, zn + 5.7), pt(ib, side, D0 + 3.5, zn + 10), pt(ia, side, D0 + 3.5, za + 10), tint.clone().multiplyScalar(0.9), u0 + 0.2, 0.5, u1 + 0.2, 0.5 + 4.3 / 3.8 / 8);
        Sm.quad(pt(ia, side, D0 + 3.5, za + 10), pt(ib, side, D0 + 3.5, zn + 10), pt(ib, side, D1, zn + 10), pt(ia, side, D1, za + 10), L("#3A3852"));
        Sm.quad(pt(ia, side, D1, za + 10), pt(ib, side, D1, zn + 10), pt(ib, side, D1, zn - 1), pt(ia, side, D1, za - 1), L("#3A3852"));
      }
      { const i = (i0 + (span >> 1)) % n, [x, y] = at(i, side, D0 + 10), z = T.z[i] - 0.5, a = T.ang[i];
        shaft(TW, x, y, a, 12, 12, z, z + 24, "band", [1.15, 1.0, 0.8], 91, "#2A2840");
        TW.get("bright", x, y).box(x, y, z + 24, 12.6, 12.6, 0.5, a, L("#FF4A4A")); TW.get("solid", x, y).pole(x, y, z + 24.5, x, y, z + 34, 0.3, L("#9A9EA6")); }
    }
    function shaft(Tn, ...a){ return N.shaft(Tn, ...a); }

    /* the bridges: the Anderson-style crossing and the smaller one before it. Parapets and a lit arch each side, piers into the bay. */
    st.bridgeLights = [];
    for(const br of S.bridges){
      const span = ((br.i1 - br.i0) % n + n) % n;
      for(let k = 0; k < span; k++){
        const ia = (br.i0 + k) % n, ib = (br.i0 + k + 1) % n, m = TW.get("solid", T.x[ia], T.y[ia]), lt = TW.get("bright", T.x[ia], T.y[ia]);
        for(const side of [-1, 1]){
          const oa = P.edge(ia, side) + 0.2, ob = P.edge(ib, side) + 0.2, A = at(ia, side, oa), Bq = at(ib, side, ob), za = T.z[ia] - 0.1, zn = T.z[ib] - 0.1;
          m.quad([A[0], A[1], za - 1.6], [Bq[0], Bq[1], zn - 1.6], [Bq[0], Bq[1], zn + 1.3], [A[0], A[1], za + 1.3], L("#8A8CA0"));          // the parapet and the deck's fascia
          // the arch: a lit tube that rises along the middle of the span
          const t = k / span, arch = 4.2 * Math.sin(t * Math.PI), t2 = (k + 1) / span, arch2 = 4.2 * Math.sin(t2 * Math.PI);
          lt.quad([A[0], A[1], za + 1.3 + arch], [Bq[0], Bq[1], zn + 1.3 + arch2], [Bq[0], Bq[1], zn + 1.62 + arch2], [A[0], A[1], za + 1.62 + arch], L(br.name === "anderson" ? "#40E8FF" : "#FF8AD0"));
          if(k % 4 === 0) m.pole(A[0], A[1], za + 1.3, A[0], A[1], za + 1.3 + arch, 0.07, L("#B8BCCC"));
        }
        if(k % 11 === 5){                                                 // a pier down into the water
          const c = at(ia, -1, 0), e = P.edge(ia, -1), f = P.edge(ia, 1);
          for(const sd of [-1, 1]){ const a = at(ia, sd, (sd < 0 ? e : f) - 1.5); m.box(a[0], a[1], SEABED, 2.6, 2.6, T.z[ia] - 1.8 - SEABED, T.ang[ia], L("#6A6C82")); }
        }
      }
    }
    /* footbridges: a deck across the straight with a lit rail and a lit arch, on four legs */
    for(const f of S.footbridges){
      const m = TW.get("solid", f.pl[0], f.pl[1]), lt = TW.get("bright", f.pl[0], f.pl[1]), dx = f.pr[0] - f.pl[0], dy = f.pr[1] - f.pl[1], L2 = Math.hypot(dx, dy), a = Math.atan2(dy, dx), mx = (f.pl[0] + f.pr[0]) / 2, my = (f.pl[1] + f.pr[1]) / 2, zD = f.z + 5.8;
      m.box(mx, my, zD, L2 + 4, 3.2, 0.55, a, L("#8A8EA2"), L("#6A6E82"));
      for(const sd of [-1, 1]){ const ox = -Math.sin(a) * 1.5 * sd, oy = Math.cos(a) * 1.5 * sd;
        lt.box(mx + ox, my + oy, zD + 0.55, L2 + 4, 0.14, 0.16, a, L("#40E8FF")); m.box(mx + ox, my + oy, zD + 0.55, L2 + 4, 0.12, 1.0, a, L("#6A6E82"));
        for(let k = 0; k < 12; k++){ const t0 = k / 12, t1 = (k + 1) / 12, e = (t) => [f.pl[0] + dx * t + ox, f.pl[1] + dy * t + oy, zD + 1.6 + 2.0 * Math.sin(t * Math.PI)], A = e(t0), Bq = e(t1); lt.pole(A[0], A[1], A[2], Bq[0], Bq[1], Bq[2], 0.09, L("#FF8AD0")); if(k % 2 === 0) m.pole(A[0], A[1], zD + 0.6, A[0], A[1], A[2], 0.05, L("#B8BCCC")); } }
      for(const end of [f.pl, f.pr]) for(const sd of [-1, 1]){ const px = end[0] - Math.sin(a) * 1.3 * sd, py = end[1] + Math.cos(a) * 1.3 * sd; m.box(px, py, f.z - 0.4, 0.9, 0.9, 6.3, a, L("#6A6E82")); }
    }
    /* TV towers: scaffold legs, braces, a platform with a rail and a canopy */
    for(const t of S.tv){
      const m = TW.get("solid", t.x, t.y), s0 = 1.15, s1 = 0.9, z = t.z - 0.3, h = t.h, c = L("#8A9098"), ca = Math.cos(t.ang), sa = Math.sin(t.ang), corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
      const w = (l, q, sc) => [t.x + ca * l * sc - sa * q * sc, t.y + sa * l * sc + ca * q * sc];
      corners.forEach(([l, q], k) => { const a = w(l, q, s0), b = w(l, q, s1); m.pole(a[0], a[1], z, b[0], b[1], z + h, 0.1, c); const [l2, q2] = corners[(k + 1) % 4]; for(const f of [0.4, 0.75]){ const aa = w(l, q, s0 + (s1 - s0) * f), bb = w(l2, q2, s0 + (s1 - s0) * (f + 0.25)); m.pole(aa[0], aa[1], z + h * f, bb[0], bb[1], z + h * (f + 0.25), 0.05, c); } });
      m.box(t.x, t.y, z + h, 3.2, 3.2, 0.3, t.ang, L("#C8C8D0")); m.box(t.x, t.y, z + h + 0.3, 3.1, 3.1, 0.8, t.ang, L("#2A2E36")); m.box(t.x, t.y, z + h + 2.6, 3.4, 3.4, 0.25, t.ang, L("#E8E6E0"));
      TW.get("bright", t.x, t.y).box(t.x, t.y, z + h + 0.6, 3.15, 3.15, 0.18, t.ang, L("#FFD9A0"));
    }
    for(const p of S.flagPoles) TW.get("solid", p.x, p.y).pole(p.x, p.y, p.z - 0.3, p.x, p.y, p.z + p.h, 0.09, L("#E6E6EE"));
    /* food stalls: a counter, a striped canopy, a string of bulbs */
    for(const q of S.stalls){
      const m = TW.get("solid", q.x, q.y), lt = TW.get("bright", q.x, q.y), col = ["#E8402E", "#2E7AE8", "#F2C230", "#2EAA6A", "#E8742A"][q.c % 5], ca = Math.cos(q.ang), sa = Math.sin(q.ang);
      m.box(q.x, q.y, q.z - 0.2, 6, 3, 1.1, q.ang, L("#5A5870"), L("#E8E0D0"));
      for(const sx of [-1, 1]) for(const sy of [-1, 1]){ const px = q.x + ca * sx * 2.8 - sa * sy * 1.4, py = q.y + sa * sx * 2.8 + ca * sy * 1.4; m.pole(px, py, q.z - 0.2, px, py, q.z + 2.8, 0.06, L("#B8BCCC")); }
      m.gable(q.x, q.y, q.z + 2.8, 7, 4.2, 1.1, q.ang, L(col));
      for(let k = 0; k < 7; k++) lt.box(q.x + ca * (k - 3) * 0.95 - sa * 1.7, q.y + sa * (k - 3) * 0.95 + ca * 1.7, q.z + 2.7, 0.22, 0.22, 0.22, q.ang, L(["#FFD9A0", "#FFB070", "#FFF2D8"][k % 3]));
    }
    return Object.assign(st, { tris:TW.tris, meshes:TW.emit(g, this.cityMats, true) });
  },

  /* ---- the observation wheel, the light show's masts and signs, all animated pieces ---- */
  features(g, P, T){
    const S = P.structs, anim = this.anim = { t:0, boats:[], lasers:[], fw:null };
    // the wheel
    if(S.wheel){
      const w = S.wheel, R = w.r, hub = R + 8, root = new THREE.Group(), z0 = Math.max(P.height(w.x, w.y), 0);
      root.position.set(w.x, z0, w.y); root.rotation.y = -w.ang;
      const frame = new Mesher(); for(const s of [-1, 1]){ frame.pole(-R * 0.5, s * 3, 0, 0, s * 3, hub, 0.7, L("#C8CCD8")); frame.pole(R * 0.5, s * 3, 0, 0, s * 3, hub, 0.7, L("#C8CCD8")); } frame.box(0, 0, 0, 16, 10, 1.0, 0, L("#4A4860"));
      root.add(Object.assign(new THREE.Mesh(frame.geometry(), new THREE.MeshLambertMaterial({ vertexColors:true, side:THREE.DoubleSide })), { castShadow:false }));
      const rim = new Mesher(), spokes = new Mesher(), NS = 48;
      for(const s of [-2.6, 2.6]) for(let k = 0; k < NS; k++){ const a0 = k / NS * TAU, a1 = (k + 1) / NS * TAU; rim.pole(Math.cos(a0) * R, s, Math.sin(a0) * R, Math.cos(a1) * R, s, Math.sin(a1) * R, 0.32, L("#9AE8FF")); }
      for(let k = 0; k < 16; k++){ const a = k / 16 * TAU; for(const s of [-2.6, 2.6]) spokes.pole(0, s, 0, Math.cos(a) * R, s, Math.sin(a) * R, 0.1, L("#D8DCE8")); }
      const wheel = new THREE.Group(); wheel.position.set(0, hub, 0);
      wheel.add(new THREE.Mesh(rim.geometry(), new THREE.MeshBasicMaterial({ vertexColors:true, side:THREE.DoubleSide, toneMapped:false })));
      wheel.add(new THREE.Mesh(spokes.geometry(), new THREE.MeshLambertMaterial({ vertexColors:true, side:THREE.DoubleSide })));
      root.add(wheel);
      // 28 capsules, kept upright, and a ring of LED bulbs that cycle in colour
      const gon = new THREE.InstancedMesh(new THREE.BoxGeometry(5, 3.6, 3.6), new THREE.MeshBasicMaterial({ color:0xFFFFFF, toneMapped:false }), 28);
      for(let k = 0; k < 28; k++) gon.setColorAt(k, new THREE.Color(["#FFE0B0", "#B8F0FF", "#FFC8E8", "#F2F6FF"][k & 3]).convertSRGBToLinear().multiplyScalar(0.9));
      gon.frustumCulled = false; gon.userData.dynamic = true; root.add(gon);
      const bulbs = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.7, 0), new THREE.MeshBasicMaterial({ color:0xFFFFFF, toneMapped:false }), 48);
      bulbs.setColorAt(0, new THREE.Color(1, 1, 1)); bulbs.frustumCulled = false; bulbs.userData.dynamic = true; wheel.add(bulbs);
      for(let k = 0; k < 48; k++){ const a = k / 48 * TAU, M4 = new THREE.Matrix4().makeTranslation(Math.cos(a) * R, Math.sin(a) * R, 0); bulbs.setMatrixAt(k, M4); }
      bulbs.instanceMatrix.needsUpdate = true;
      g.add(root); anim.wheel = { root, wheel, gon, bulbs, R, hub, n:28, a:0, m:new THREE.Matrix4() };
    }
    // the light show: beams from the tops of the tall landmarks, swept slowly, on a cycle
    const tops = []; if(this.triB){ const b = this.triB, ca = Math.cos(b.ang), sa = Math.sin(b.ang); tops.push([b.x + ca * 100, b.y + sa * 100, b.z + b.h * 0.9 + 4], [b.x - ca * 100, b.y - sa * 100, b.z + b.h * 0.9 + 4]); }
    for(const b of S.buildings) if(b.type === "deco" || b.type === "ring") tops.push([b.x, b.y, b.z + b.h + 6]);
    for(const b of S.buildings.filter(q => q.h > 200).slice(0, 4)) tops.push([b.x, b.y, b.z + b.h + 3]);
    const beamGeo = new THREE.CylinderGeometry(0.5, 1.6, 700, 6, 1, true); beamGeo.translate(0, 350, 0);
    const COLS = ["#40E8FF", "#FF4AA0", "#B060FF", "#7CFFB0", "#FFD060"];
    tops.slice(0, 6).forEach((tp, k) => {
      const m = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color:new THREE.Color(COLS[k % COLS.length]).convertSRGBToLinear(), transparent:true, opacity:0.0, blending:THREE.AdditiveBlending, depthWrite:false, fog:false, side:THREE.DoubleSide }));
      m.position.set(tp[0], tp[2], tp[1]); m.frustumCulled = false; m.userData.dynamic = true; g.add(m); anim.lasers.push({ m, k, ph:k * 1.7 });
    });
    // boats on the bay (instanced) and ships at anchor
    const V = N.vesselGeos(), im = instMat("plain", this.U), boatList = S.boats.map(b => ({ x:b.x, y:b.y, z:WATER_Y - 0.05, ry:0, h:1, tint:["#F2F2F4", "#FFE6B8", "#C8E0FF"][b.c % 3] }));
    const mkBoats = (geo, kinds, cnt) => { const mesh = new THREE.InstancedMesh(geo, im, Math.max(cnt, 1)); mesh.frustumCulled = false; mesh.castShadow = false; mesh.userData.dynamic = true; g.add(mesh); return mesh; };
    const small = S.boats.filter(b => b.kind !== 2), ferries = S.boats.filter(b => b.kind === 2);
    anim.boatsSmall = { mesh:mkBoats(V.boat, 0, small.length), list:small, scale:1.1 }; anim.boatsFerry = { mesh:mkBoats(V.ferry, 0, ferries.length), list:ferries, scale:1.0 };
    for(const o of [anim.boatsSmall, anim.boatsFerry]) o.list.forEach((b, i) => o.mesh.setColorAt(i, new THREE.Color(["#F2F2F4", "#FFE6B8", "#C8E0FF"][b.c % 3]).convertSRGBToLinear()));
    // ships at anchor: long lit hulls, built once
    { const sm = new N.Town(2000); for(const s2 of S.ships){ const ca = Math.cos(s2.ang), sa = Math.sin(s2.ang), m = sm.get("solid", s2.x, s2.y), br = sm.get("bright", s2.x, s2.y), len = 150;
        m.box(s2.x, s2.y, WATER_Y - 3, len, 24, 9, s2.ang, L("#3A3C50"), L("#2A2C40"));
        m.box(s2.x + ca * 30, s2.y + sa * 30, WATER_Y + 5.6, 70, 20, 5, s2.ang, L("#E8EAF2"));
        for(let d = 0; d < 4; d++) m.box(s2.x + ca * (30 - d * 3), s2.y + sa * (30 - d * 3), WATER_Y + 10.6 + d * 3.4, 55 - d * 10, 17 - d * 2, 3, s2.ang, L("#F4F4FA"));
        for(let d = 0; d < 5; d++) br.box(s2.x + ca * (30 - d * 3), s2.y + sa * (30 - d * 3), WATER_Y + 12 + d * 3.4 - 0.7, 54 - d * 10, 17.2 - d * 2, 0.7, s2.ang, L("#FFD9A0"));
        m.box(s2.x - ca * 40, s2.y - sa * 40, WATER_Y + 6, 14, 12, 14, s2.ang, L("#E8EAF2")); br.box(s2.x - ca * 40, s2.y - sa * 40, WATER_Y + 16, 14.2, 12.2, 1.2, s2.ang, L("#FF4A4A"));
        for(let c = 0; c < 18; c++) m.box(s2.x - ca * (40 - c * 4), s2.y - sa * (40 - c * 4), WATER_Y + 5.6, 3, 8, 4, s2.ang, L(["#D8352A", "#2B6CD8", "#F2C230", "#2E9A5A"][c & 3])); }
      sm.emit(g, { solid:this.cityMats.solid, bright:this.cityMats.bright }, false); }
    // fireworks over the bay now and then, and a helicopter with steady red and white lights
    { const NP = 90, pg = new THREE.BufferGeometry(), pos = new Float32Array(NP * 3), cl = new Float32Array(NP * 3);
      pg.setAttribute("position", new THREE.BufferAttribute(pos, 3)); pg.setAttribute("color", new THREE.BufferAttribute(cl, 3));
      const pts = new THREE.Points(pg, new THREE.PointsMaterial({ size:6, sizeAttenuation:false, vertexColors:true, transparent:true, opacity:1, depthWrite:false, blending:THREE.AdditiveBlending, fog:false }));
      pts.frustumCulled = false; pts.userData.dynamic = true; g.add(pts);
      const vel = []; for(let k = 0; k < NP; k++){ const a = Math.random() * TAU, e = (Math.random() - 0.3) * Math.PI * 0.9, s = 14 + Math.random() * 18; vel.push([Math.cos(a) * Math.cos(e) * s, Math.sin(e) * s, Math.sin(a) * Math.cos(e) * s]); }
      const c0 = S.tri || { x:S.peninsulas[0].x, y:S.peninsulas[0].y };
      anim.fw = { pts, pos, cl, vel, NP, t:-8, col:[1, 0.6, 0.3], x:c0.x + 120, y:230, z:c0.y + 60, hold:0 }; }
    { const hm = new Mesher(); hm.box(0, 0, 0, 7, 2.4, 2.4, 0, L("#2A2E3E")); hm.box(2, 0, 1.0, 2.4, 2.2, 1.4, 0, L("#7FB0CC")); hm.box(-5.4, 0, 1.0, 5, 0.5, 0.6, 0, L("#2A2E3E")); hm.box(0, 0, 2.4, 0.5, 0.5, 1.2, 0, L("#2A2E3E"));
      const heli = new THREE.Mesh(hm.geometry(), new THREE.MeshLambertMaterial({ vertexColors:true, side:THREE.DoubleSide })); heli.frustumCulled = false; heli.userData.dynamic = true;
      const rm = new Mesher(); rm.box(0, 0, 0, 14, 0.4, 0.06, 0, L("#1A1C24")); rm.box(0, 0, 0, 0.4, 14, 0.06, 0, L("#1A1C24"));
      const rotor = new THREE.Mesh(rm.geometry(), new THREE.MeshBasicMaterial({ vertexColors:true, side:THREE.DoubleSide })); rotor.position.y = 3.6; heli.add(rotor); g.add(heli);
      const strobe = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 0), new THREE.MeshBasicMaterial({ color:0xFF3030, toneMapped:false, fog:false })); strobe.position.set(-8, 1.4, 0); heli.add(strobe);
      const strobe2 = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 0), new THREE.MeshBasicMaterial({ color:0xFFFFFF, toneMapped:false, fog:false })); strobe2.position.set(0.5, -1.4, 0); heli.add(strobe2);
      anim.heli = { heli, rotor, strobe, strobe2 }; }
    anim.cx = T.bounds.minX + T.bounds.w / 2; anim.cy = T.bounds.minY + T.bounds.h / 2;
  },

  /* ---- everything that glows: lamp heads and the floodlights as additive sprites, the road's light pools, the aviation lights ---- */
  lights(g, G, P, T){
    const S = P.structs, lite = CFG.detail === 0, n = T.n, glows = [];
    const add = (x, y, z, r, gr, b) => glows.push(x, z, y, r, gr, b);
    for(const p of S.pylons){ const dx = p.hx - p.x, dy = p.hy - p.y, l = Math.hypot(dx, dy) || 1; add(p.x + dx / l * 5.7, p.y + dy / l * 5.7, p.z + 10.4, 1.0, 0.92, 0.78); }
    for(const l of S.lamps) if(!lite || (l.x * 7 + l.y * 3) % 2 < 1) add(l.x + Math.cos(l.ang) * 1.35, l.y + Math.sin(l.ang) * 1.35, l.z + 5.4, 1.0, 0.82, 0.55);
    for(const f of S.footbridges){ add(f.pl[0], f.pl[1], f.z + 7, 0.5, 0.9, 1); add(f.pr[0], f.pr[1], f.z + 7, 0.5, 0.9, 1); }
    for(const s of S.stalls){ for(let k = 0; k < 5; k++){ const a = s.ang + (k - 2) * 0.4; add(s.x + Math.cos(a) * 3, s.y + Math.sin(a) * 3, s.z + 3.3, 1, 0.7, 0.4); } }
    const gp = new Float32Array(glows.length / 6 * 3), gc = new Float32Array(glows.length / 6 * 3);
    for(let i = 0, k = 0; i < glows.length; i += 6, k += 3){ gp[k] = glows[i]; gp[k + 1] = glows[i + 1]; gp[k + 2] = glows[i + 2]; gc[k] = glows[i + 3]; gc[k + 1] = glows[i + 4]; gc[k + 2] = glows[i + 5]; }
    const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.BufferAttribute(gp, 3)); geo.setAttribute("color", new THREE.BufferAttribute(gc, 3));
    const tex = dotTex(0, [[0, "rgba(255,255,255,1)"], [0.18, "rgba(255,240,210,0.7)"], [0.5, "rgba(255,200,140,0.18)"], [1, "rgba(255,160,100,0)"]]);
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ map:tex, size:lite ? 12 : 17, sizeAttenuation:false, vertexColors:true, transparent:true, blending:THREE.AdditiveBlending, depthWrite:false, fog:false }));
    pts.frustumCulled = false; pts.userData.dynamic = true; g.add(pts); this.glowPts = pts;
    // red aviation lights on the roofs, in two groups, both burning steady
    const bp = [[], []]; this.beacons.forEach((b, k) => bp[k & 1].push(b[0], b[2], b[1]));
    this.blink = bp.map(arr => { const bg = new THREE.BufferGeometry(); bg.setAttribute("position", new THREE.Float32BufferAttribute(arr, 3));
      const o = new THREE.Points(bg, new THREE.PointsMaterial({ map:dotTex(0, [[0, "rgba(255,80,60,1)"], [0.3, "rgba(255,60,40,0.6)"], [1, "rgba(255,40,30,0)"]]), size:9, sizeAttenuation:false, color:0xFFFFFF, transparent:true, blending:THREE.AdditiveBlending, depthWrite:false, fog:false }));
      o.frustumCulled = false; o.userData.dynamic = true; g.add(o); return o; });
    // light pools on the road, one under each lamp, and a faint cyan streaked sheen that makes the damp asphalt shine
    const pool = document.createElement("canvas"); pool.width = 64; pool.height = 128; const pc = pool.getContext("2d");
    pc.fillStyle = "rgba(0,0,0,1)"; pc.fillRect(0, 0, 64, 128);
    for(const [cx, cy, a] of [[14, 32, 1.0], [50, 96, 1.0], [32, 64, 0.35], [32, 0, 0.35], [32, 128, 0.35]]){ const gr = pc.createRadialGradient(cx, cy, 0, cx, cy, 46); gr.addColorStop(0, `rgba(255,236,190,${a})`); gr.addColorStop(1, "rgba(0,0,0,0)"); pc.fillStyle = gr; pc.save(); pc.beginPath(); pc.rect(0, 0, 64, 128); pc.clip(); pc.scale(1, 1); pc.fillRect(0, 0, 64, 128); pc.restore(); }
    const pt2 = new THREE.CanvasTexture(pool); pt2.wrapS = pt2.wrapT = THREE.RepeatWrapping; pt2.encoding = THREE.sRGBEncoding;
    const strip = G.strip(T, -T.half - 1.5, T.half + 1.5, 0.07, 26, null);
    if(strip){ const m = new THREE.Mesh(strip, new THREE.MeshBasicMaterial({ map:pt2, transparent:true, opacity:lite ? 0.45 : 0.62, blending:THREE.AdditiveBlending, depthWrite:false, polygonOffset:true, polygonOffsetFactor:-3, polygonOffsetUnits:-3 })); m.renderOrder = 4; m.userData.dynamic = true; g.add(m); }
    const sh = document.createElement("canvas"); sh.width = 32; sh.height = 64; const sc2 = sh.getContext("2d"); sc2.fillStyle = "#000"; sc2.fillRect(0, 0, 32, 64);
    for(let k = 0; k < 7; k++){ const x = 3 + k * 4.2 + (k % 2), gr = sc2.createLinearGradient(0, 0, 0, 64); gr.addColorStop(0, "rgba(0,0,0,0)"); gr.addColorStop(0.5, k % 2 ? "rgba(90,210,255,0.8)" : "rgba(255,190,150,0.7)"); gr.addColorStop(1, "rgba(0,0,0,0)"); sc2.fillStyle = gr; sc2.fillRect(x, 0, 1.4, 64); }
    const st2 = new THREE.CanvasTexture(sh); st2.wrapS = st2.wrapT = THREE.RepeatWrapping; st2.encoding = THREE.sRGBEncoding;
    const sheen = G.strip(T, -T.half, T.half, 0.075, 13, null);
    if(sheen){ const m = new THREE.Mesh(sheen, new THREE.MeshBasicMaterial({ map:st2, transparent:true, opacity:lite ? 0.12 : 0.22, blending:THREE.AdditiveBlending, depthWrite:false, polygonOffset:true, polygonOffsetFactor:-4, polygonOffsetUnits:-4 })); m.renderOrder = 5; m.userData.dynamic = true; g.add(m); }
    return glows.length / 6;
  },

  /* ---- the sky: a deep blue-violet night with a warm city haze at the horizon and a few stars, a distant storm cloud ---- */
  sky(g, T){
    const geo = new THREE.SphereGeometry(4200, 28, 16), p = geo.attributes.position, col = new Float32Array(p.count * 3);
    const top = L("#05082A"), mid = L("#141A4C"), low = L("#3A2A66"), hor = L("#9A5A72"), c = new THREE.Color();
    for(let v = 0; v < p.count; v++){ const e = p.getY(v) / 4200;
      if(e > 0.25) c.copy(mid).lerp(top, sst(0.25, 0.95, e)); else if(e > 0.07) c.copy(low).lerp(mid, sst(0.07, 0.25, e)); else c.copy(hor).lerp(low, sst(0.0, 0.07, e));
      if(e < 0) c.copy(hor); col[v * 3] = c.r; col[v * 3 + 1] = c.g; col[v * 3 + 2] = c.b; }
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    this.domeMat = new THREE.MeshBasicMaterial({ vertexColors:true, side:THREE.BackSide, fog:false, depthWrite:false });
    const dome = new THREE.Mesh(geo, this.domeMat); const b = T.bounds; dome.position.set(b.minX + b.w / 2, 0, b.minY + b.h / 2); dome.renderOrder = -10; dome.frustumCulled = false; dome.userData.dynamic = true; g.add(dome);
    // stars
    { const N2 = 320, sp = new Float32Array(N2 * 3), sc = new Float32Array(N2 * 3); let a = 11; const r = () => { a = (a * 16807) % 2147483647; return a / 2147483647; };
      for(let k = 0; k < N2; k++){ const az = r() * TAU, el = 0.12 + r() * 1.35, R2 = 4100; sp[k * 3] = Math.cos(az) * Math.cos(el) * R2; sp[k * 3 + 1] = Math.sin(el) * R2; sp[k * 3 + 2] = Math.sin(az) * Math.cos(el) * R2; const v = 0.4 + r() * 0.6; sc[k * 3] = v; sc[k * 3 + 1] = v; sc[k * 3 + 2] = v * (0.8 + r() * 0.2); }
      const sg = new THREE.BufferGeometry(); sg.setAttribute("position", new THREE.BufferAttribute(sp, 3)); sg.setAttribute("color", new THREE.BufferAttribute(sc, 3));
      const stars = new THREE.Points(sg, new THREE.PointsMaterial({ size:2, sizeAttenuation:false, vertexColors:true, transparent:true, opacity:0.8, depthWrite:false, fog:false })); stars.position.copy(dome.position); stars.frustumCulled = false; stars.userData.dynamic = true; g.add(stars); }
    // a storm cloud far off to one side, dark and flat, no lightning
    { const cg = new THREE.IcosahedronGeometry(1, 1), cm = new THREE.MeshBasicMaterial({ color:0x1A1630, fog:false, depthWrite:false }), cl = new THREE.InstancedMesh(cg, cm, 24), M4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3(); let a = 31; const r = () => { a = (a * 16807) % 2147483647; return a / 2147483647; };
      const ang = 0.9; for(let k = 0; k < 24; k++){ const d = 2600 + r() * 600, lat = (r() - 0.5) * 1700; ps.set(Math.cos(ang) * d - Math.sin(ang) * lat, 520 + r() * 220, Math.sin(ang) * d + Math.cos(ang) * lat); sc.set(300 + r() * 280, 70 + r() * 60, 220 + r() * 160); M4.compose(ps, q, sc); cl.setMatrixAt(k, M4); }
      cl.instanceMatrix.needsUpdate = true; cl.frustumCulled = false; cl.renderOrder = -9; cl.userData.dynamic = true; cl.position.set(dome.position.x, 0, dome.position.z); g.add(cl);
      // the bolt: a jagged line from the cloud to the horizon
      const bp = new Float32Array(14 * 3), bg = new THREE.BufferGeometry(); bg.setAttribute("position", new THREE.BufferAttribute(bp, 3));
      const bolt = new THREE.Line(bg, new THREE.LineBasicMaterial({ color:0xE8E8FF, fog:false, transparent:true, opacity:0 })); bolt.frustumCulled = false; bolt.userData.dynamic = true; g.add(bolt);
      this.storm = { cl, cm, bolt, bp, next:30 + Math.random() * 30, flash:0, ang, dome }; }
  },

  /* ---- build ---- */
  build(G, world, T, S){
    const t0 = performance.now(), tm = {}, stats = this.stats = {};
    const step = (k, fn) => { const a = performance.now(); try{ fn(); }catch(e){ console.warn("singapore " + k, e.message, e.stack); } tm[k] = Math.round(performance.now() - a); };
    const g = new THREE.Group(); world.add(g); this.root = g; this.T = T;
    let P; step("plan", () => { P = planSingapore(T, { detail:CFG.detail }); });
    if(!P) return;
    this.P = P; this.anim = null;
    step("ground", () => { stats.tiles = this.ground(g, P); });
    step("city", () => { stats.city = this.city(g, P, T); });
    step("structures", () => { stats.structs = this.structures(g, P, T); });
    // instanced street life
    const GE = Object.assign(N.treeGeos(), N.lampGeos(), N.vesselGeos(), { tyres:N.tyreGeo(), car:K.carGeo(), person:K.personGeo(false, null), personW:K.personGeo(true, null), flag:K.flagGeo() });
    this.GE = GE; const sway = instMat("sway", this.U), plain = instMat("plain", this.U), wave = instMat("wave", this.U), flagM = instMat("flag", this.U);
    step("instances", () => {
      const lite = CFG.detail === 0, tint = () => [0.85 + Math.random() * 0.3, 0.9 + Math.random() * 0.2, 0.85 + Math.random() * 0.3];
      const near = (x, y) => P.clearance(x, y) < 160;
      const trees = P.structs.trees.map(t => ({ ...t, tint:tint() })), nearT = trees.filter(t => near(t.x, t.y)), farT = trees.filter(t => !near(t.x, t.y));
      let c = 0;
      c += instance(g, GE.tree, sway, nearT, true, 300); c += instance(g, GE.treeFar, sway, farT, false, 500);
      c += instance(g, GE.palm, sway, P.structs.palms.map(t => ({ ...t, tint:tint() })), false, 300);
      c += instance(g, GE.planter, plain, P.structs.planters.map(p => ({ x:p.x, y:p.y, z:p.z, ry:-p.ang, sx:1, sy:1, sz:1 })), false, 400);
      c += instance(g, GE.lamp, plain, P.structs.lamps.map(l => ({ x:l.x, y:l.y, z:l.z, ry:-l.ang, h:1, w:1 })), false, 400);
      c += instance(g, GE.pylon, plain, P.structs.pylons.map(p => ({ x:p.x, y:p.y, z:p.z, ry:-Math.atan2(p.hy - p.y, p.hx - p.x), h:1, w:1 })), true, 400);
      c += instance(g, GE.car, plain, P.structs.cars.map((q, k) => ({ x:q.x, y:q.y, z:q.z + 0.05, ry:-q.ry, sx:4.2, sy:2.0, sz:4.3, tint:["#C8C8CC", "#222428", "#8A1E1E", "#2E4E8A", "#D8D8D0", "#5A5E66", "#1E5A3A"][k % 7] })), false, 400);
      c += instance(g, GE.bus, plain, P.structs.buses.map(q => ({ x:q.x, y:q.y, z:q.z + 0.1, ry:-q.ang, h:1, w:1, tint:["#F2F2F4", "#D8E8FF"][q.c & 1] })), false, 400);
      c += instance(g, GE.tyres, plain, P.structs.tyres.map(q => ({ x:q.x, y:q.y, z:q.z, ry:q.c * 0.7, h:1, w:1 })), false, 400);
      stats.instChunks = c;
      // the crowd on the stands and on the footbridges
      const R2 = (() => { let a = 4711; return () => { a = (a * 16807) % 2147483647; return a / 2147483647; }; })(), sp = lite ? 2.6 : 1.9, list = [], wv = [], n = T.n;
      for(const s of P.structs.stands){
        if(!s.zb || s.wet && !s.floating) continue;
        for(let r = 1; r < s.rows; r += 2) for(let k = 0; k < s.span; k++){
          if(k % 9 === 0) continue;
          const ia = (s.i0 + k) % n, ib = (s.i0 + k + 1) % n, o = s.off0 + r * s.rowD + s.rowD * 0.5;
          for(let q = 0; q < T.ds; q += sp){
            if(R2() > s.fill) continue; const t = q / T.ds, pa = P.at(ia, s.side, o), pb = P.at(ib, s.side, o);
            const z = s.zb[k] + (r + 1) * s.rowH + (s.zb[k + 1] - s.zb[k]) * t;
            (R2() < 0.15 ? wv : list).push({ x:pa[0] + (pb[0] - pa[0]) * t, y:pa[1] + (pb[1] - pa[1]) * t, z, ry:-Math.atan2(-s.side * T.ny[ia], -s.side * T.nx[ia]) + Math.PI / 2 + (R2() - 0.5) * 0.5, h:1.95 + R2() * 0.25, w:1, tint:CROWD[(R2() * CROWD.length) | 0] });
          }
        }
      }
      for(const f of P.structs.footbridges){ const ca = Math.cos(f.ang + Math.PI / 2), sa = Math.sin(f.ang + Math.PI / 2), mx = (f.pl[0] + f.pr[0]) / 2, my = (f.pl[1] + f.pr[1]) / 2;
        for(let a = -f.len / 2 + 2; a < f.len / 2 - 2; a += 2.2) if(R2() < 0.55) (R2() < 0.4 ? wv : list).push({ x:mx - ca * a * -1 + Math.cos(f.ang) * (R2() - 0.5) * 1.8, y:my - sa * a * -1 + Math.sin(f.ang) * (R2() - 0.5) * 1.8, z:f.z + 6.2, ry:R2() * 6.28, h:2.0, w:1, tint:CROWD[(R2() * CROWD.length) | 0] }); }
      stats.crowd = list.length + wv.length;
      instance(g, GE.person, wave, list, false, 500); instance(g, GE.personW, wave, wv, false, 500);
      // flags along the stands
      instance(g, GE.flag, flagM, P.structs.flagPoles.map((p, k) => ({ x:p.x, y:p.y, z:p.z + p.h - 0.35, ry:-WIND, sx:2.4, sy:2.4, sz:2.4, tint:["#E8402E", "#F4F2EC", "#2E7AE8", "#F2C230"][k & 3] })), false, 600);
    });
    step("features", () => this.features(g, P, T));
    step("lights", () => { stats.glows = this.lights(g, G, P, T); });
    step("sky", () => this.sky(g, T));
    step("signs", () => { stats.signs = this.signs(g, P, T); });
    // whatever stands between the overhead camera and the car is cut away (G3.cutU), as at Monaco, Spa and Interlagos
    step("cut", () => { for(const m of Object.values(this.cityMats)) G.cutMat(m); });
    this.light(G, T);
    tm.total = Math.round(performance.now() - t0); this.timing = tm; Object.assign(stats, { counts:P.stats.counts });
    try{ window.__singapore = { stats, timing:tm, audit:() => auditSingapore(P, T), plan:P }; }catch(e){}
  },

  /* ---- the big screens, the paddock sign: textured, unlit ---- */
  signs(g, P, T){
    if(typeof document === "undefined") return 0;
    const S = P.structs, mk = (w, h, draw) => { const cv = document.createElement("canvas"); cv.width = w; cv.height = h; draw(cv.getContext("2d"), w, h);
      const t = new THREE.CanvasTexture(cv); t.encoding = THREE.sRGBEncoding; t.anisotropy = 4; return new THREE.MeshBasicMaterial({ map:t, side:THREE.DoubleSide, toneMapped:false }); };
    const font = (px, wg) => (wg || 800) + " " + px + "px 'Saira Condensed',Impact,sans-serif";
    const SCR = [["NO QUEUE HERE", "Queue for the chicken rice instead", "#0C2A4A", "#40E8FF"], ["BRING AN UMBRELLA", "Or a boat. We have both.", "#1A1040", "#FF8AD0"], ["TURN 13 IS TIGHT", "So is the queue for the lift", "#103A3A", "#7CFFC0"], ["NO DURIAN ON THE GRID", "Marshals' orders", "#2A1A06", "#FFD060"]];
    const screens = S.screens.map((s, k) => { const [a, b, bg, fg] = SCR[k % SCR.length];
      const mat = mk(512, 288, (c, w, h) => { c.fillStyle = bg; c.fillRect(0, 0, w, h); for(let q = 0; q < 12; q++){ c.fillStyle = "rgba(255,255,255," + (0.03 + (q % 3) * 0.02) + ")"; c.fillRect(0, q * 24, w, 10); }
        c.fillStyle = fg; c.textAlign = "center"; c.font = font(76); c.fillText(a, w / 2, h * 0.5); c.font = font(38, 700); c.fillText(b, w / 2, h * 0.74); c.strokeStyle = fg; c.lineWidth = 8; c.strokeRect(10, 10, w - 20, h - 20); });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(14, 7.9), mat); m.position.set(s.x, s.z + 11.2, s.y); m.rotation.y = Math.PI / 2 - (s.a0 - s.side * Math.PI / 2); m.userData.dynamic = true; g.add(m);
      const pm = new THREE.MeshLambertMaterial({ color:L("#4A4E60") }); for(const q of [-6.4, 6.4]){ const p = new THREE.Mesh(new THREE.BoxGeometry(0.8, 11, 0.8), pm); p.position.set(s.x + Math.cos(s.a0) * q, s.z + 5.5, s.y + Math.sin(s.a0) * q); p.userData.dynamic = true; g.add(p); }
      return m; });
    { const mat = mk(1024, 256, (c, w, h) => { c.fillStyle = "#12304A"; c.fillRect(0, 0, w, h);
        for(let q = 0; q < 6; q++){ c.fillStyle = "rgba(64,232,255,0.16)"; c.beginPath(); c.moveTo(q * 60, h); c.lineTo(q * 60 + 70, 0); c.lineTo(q * 60 + 100, 0); c.lineTo(q * 60 + 30, h); c.fill(); }
        c.fillStyle = "#FFFFFF"; c.textAlign = "center"; c.font = font(150, 900); c.fillText("PADDOCK", w / 2 + 20, h * 0.66);
        c.fillStyle = "#40E8FF"; c.font = font(44, 700); c.fillText("TEAMS · GUESTS · ONE VERY COLD AIRCON", w / 2 + 20, h * 0.92);
        for(let q = 0; q < 32; q++){ c.fillStyle = q & 1 ? "#111" : "#FFF"; c.fillRect(q * 32, 0, 32, 14); c.fillStyle = q & 1 ? "#FFF" : "#111"; c.fillRect(q * 32, 14, 32, 14); } });
      const pb = P.structs.pit, i = pb.i0, side = pb.side, [x, y] = P.at(i, side, T.half + T.pitW + 12), z = T.z[i];
      const m = new THREE.Mesh(new THREE.PlaneGeometry(26, 6.5), mat); m.position.set(x, z + 12.5, y); m.rotation.y = Math.PI / 2 - (T.ang[i] - side * Math.PI / 2); m.userData.dynamic = true; g.add(m);
      const pm = new THREE.MeshLambertMaterial({ color:L("#4A4E60") }); for(const q of [-13, 13]){ const p = new THREE.Mesh(new THREE.BoxGeometry(0.9, 15, 0.9), pm); p.position.set(x + Math.cos(T.ang[i]) * q, z + 7, y + Math.sin(T.ang[i]) * q); p.userData.dynamic = true; g.add(p); } }
    return screens.length + 1;
  },

  /* ---- light: the moon, a violet-teal fill, a warm city haze ---- */
  light(G, T){
    if(G.sun){ G.sun.color.set(L("#8AA0E0")); G.sun.intensity = 0.34; }
    G.scene.traverse(o => { if(o.isHemisphereLight && o !== G.envFill){ o.color.copy(L("#2A3A78")); o.groundColor.copy(L("#4A3A62")); o.intensity = 0.62; } });
    if(G.scene.fog) G.scene.fog.color.copy(L("#2A2448"));
  },

  frame(S, G){
    const t = S.clock || 0, dt = this._t == null ? 0 : clamp(t - this._t, 0, 0.1); this._t = t;
    this.U.value = t;
    const A = this.anim; if(!A) return;
    if(this.glintTex){ this.glintTex.offset.set(t * 0.012, t * 0.007); }
    const W = A.wheel;
    if(W){
      W.a += dt * TAU / 420; W.wheel.rotation.z = W.a;
      for(let k = 0; k < W.n; k++){ const a = W.a + k / W.n * TAU; W.m.makeTranslation(Math.cos(a) * W.R, W.hub + Math.sin(a) * W.R - 2.6, 0); W.gon.setMatrixAt(k, W.m); }
      W.gon.instanceMatrix.needsUpdate = true;
      const c = new THREE.Color(); for(let k = 0; k < 48; k++){ c.setHSL((t * 0.12 + k / 48) % 1, 1, 0.58); W.bulbs.setColorAt(k, c); } W.bulbs.instanceColor.needsUpdate = true;
    }
    // boats drift round on the bay
    const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), M4 = new THREE.Matrix4(), ps = new THREE.Vector3(), sc = new THREE.Vector3();
    for(const o of [A.boatsSmall, A.boatsFerry]){
      o.list.forEach((b, i) => { const a = b.a + t * b.sp, x = b.x + Math.cos(a) * b.r, y = b.y + Math.sin(a) * b.r, hd = a + (b.sp > 0 ? Math.PI / 2 : -Math.PI / 2);
        q.setFromAxisAngle(up, -hd); ps.set(x, WATER_Y + 0.05 + Math.sin(t * 1.3 + i) * 0.08, y); sc.setScalar(o.scale); M4.compose(ps, q, sc); o.mesh.setMatrixAt(i, M4); });
      o.mesh.instanceMatrix.needsUpdate = true;
    }
    // the light show: beams fade in and out on a 60 s cycle and sweep
    const cyc = (t % 60) / 60, on = sst(0.05, 0.12, cyc) * (1 - sst(0.62, 0.7, cyc));
    for(const l of A.lasers){ l.m.material.opacity = 0.34 * on * (0.6 + 0.4 * Math.sin(t * 2 + l.ph)); l.m.rotation.set(Math.sin(t * 0.35 + l.ph) * 0.5 + (l.k % 2 ? 0.2 : -0.2), 0, Math.cos(t * 0.3 + l.ph * 1.3) * 0.55); l.m.visible = on > 0.01; }
    // fireworks
    const F = A.fw;
    if(F){
      F.t += dt;
      if(F.t > 22){ F.t = 0; const c = new THREE.Color().setHSL(Math.random(), 1, 0.6); F.col = [c.r, c.g, c.b]; F.x += (Math.random() - 0.5) * 200; F.z += (Math.random() - 0.5) * 200; }
      for(let k = 0; k < F.NP; k++){ const tt = Math.max(F.t, 0), v = F.vel[k], life = F.t < 0 || F.t > 3 ? 0 : Math.max(0, 1 - tt / 3);
        F.pos[k * 3] = F.x + v[0] * tt; F.pos[k * 3 + 1] = F.y + v[1] * tt - 5 * tt * tt; F.pos[k * 3 + 2] = F.z + v[2] * tt;
        F.cl[k * 3] = F.col[0] * life; F.cl[k * 3 + 1] = F.col[1] * life; F.cl[k * 3 + 2] = F.col[2] * life; }
      F.pts.geometry.attributes.position.needsUpdate = true; F.pts.geometry.attributes.color.needsUpdate = true;
    }
    // the helicopter
    const H = A.heli;
    if(H){ const a = -t * 0.09 + 0.7, r = 620; H.heli.position.set(A.cx + Math.cos(a) * r, 190 + Math.sin(t * 0.4) * 6, A.cy + Math.sin(a) * r * 0.8); H.heli.rotation.y = -(a - Math.PI / 2); H.rotor.rotation.y = t * 32; }
    // nothing flashes: the helicopter's lights and the roof beacons burn steady (set once in lights()), and the storm cloud sits dark with no lightning
    const st = this.storm;
    if(st){
      st.bolt.material.opacity = 0; st.cm.color.setRGB(0.10, 0.09, 0.19);
      if(this.domeMat) this.domeMat.color.setScalar(1);
      G.scene.traverse(o => { if(o.isHemisphereLight && o !== G.envFill) o.intensity = 0.62; });
    }
  },
};

export { SINGAPORE };
