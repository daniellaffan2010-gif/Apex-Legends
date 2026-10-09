import * as THREE from 'three';
import { TAU, clamp, shade } from '../config/util.js';
import { SPHERE } from '../render2d/sphere.js';
import { TEX } from '../render2d/textures.js';
import { drawProp, setB3 } from '../render2d/props.js';
import { PTEX } from './surfaces.js';
import { ADS } from './hoardings.js';
import { G3 } from './g3.js';
import { LM3 } from './worlds/vegas.js';

/* ---- scenery ------------------------------------------------------------
   The simple props get real solids of revolution. The landmarks are already
   written as boxCol/pyramid calls, so those run unchanged with the geometry
   captured instead of painted — see B3 in box()/pyramid()/groundEllipse().  */
const NOCTX = new Proxy({}, {
  get(t, k){
    if(k === "canvas") return { width:1, height:1 };
    return () => ({ addColorStop(){}, width:0, height:0 });
  },
  set(){ return true; }
});

G3.prop = function(parent, p, T, S){
  const g = new THREE.Group(), z = p.z, night = T.night;
  // tall things have to be able to get out of the way on their own, so they stay
  // out of the bake and carry their own materials
  const big = p.t === "sphere" || p.fade ||
    (p.h > 12 && ["lm", "hotel", "tower", "grandstand", "stadium", "ferris", "garage"].includes(p.t));
  const B = (cx, cy, cz, l, w, h, ang, col, tex) => this.boxAt(g, cx, cy, cz, l, w, h, ang, col, tex);
  const sphere = (cx, cy, cz, r, col, seg) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, seg || 12, (seg || 12) / 2), this.mat(col));
    m.position.set(cx, cz, cy); m.castShadow = true; m.receiveShadow = true; g.add(m); return m;
  };
  const lamp = (cx, cy, cz, col, inten, dist) => {
    if(!night) return;
    const L = new THREE.PointLight(G3.col(col), inten, dist || 90, 2);
    L.position.set(cx, cz, cy); L.userData.dynamic = true; g.add(L);
  };
  switch(p.t){
    case "tree": {
      B(p.x, p.y, z, 0.8, 0.8, p.h * 0.45, 0, "#4A3A28");
      sphere(p.x, p.y, z + p.h * 0.72, p.h * 0.42, p.col, 10).castShadow = p.h > 14;
      sphere(p.x + p.h * 0.12, p.y - p.h * 0.1, z + p.h * 0.92, p.h * 0.3, shade(p.col, 0.1), 8);
      break; }
    case "palm": {
      B(p.x, p.y, z, 0.5, 0.5, p.h, 0, "#7A6247");
      for(let a = 0; a < 7; a++){
        const th = a / 7 * TAU + p.r * TAU;
        const f = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.18, 0.9), this.mat(p.col));
        f.position.set(p.x + Math.cos(th) * 2.0, z + p.h - 0.3, p.y + Math.sin(th) * 2.0);
        f.rotation.y = -th; f.rotation.z = 0.32; g.add(f);
      }
      break; }
    case "dune": {
      const m = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 8, 0, TAU, 0, Math.PI / 2), this.mat(p.col));
      m.position.set(p.x, z, p.y); m.scale.set(p.h * 2.4, p.h * 0.8, p.h * 1.5);
      m.rotation.y = p.r * TAU; m.receiveShadow = true; m.castShadow = true; g.add(m);
      break; }
    case "grandstand": {
      const wid = p.wid || (26 + p.r * 16);
      // the bank of seats, raked
      const rows = 7;
      for(let k = 0; k < rows; k++){
        const t = k / (rows - 1), off = -4 + t * 8, hh = p.h * (0.30 + 0.62 * t);
        const cx = p.x + Math.cos(p.rot + Math.PI / 2) * off, cy = p.y + Math.sin(p.rot + Math.PI / 2) * off;
        this.boxAt(g, cx, cy, z, wid, 1.5, hh, p.rot, p.col, k ? TEX.seats(p.col, night) : null);
      }
      B(p.x, p.y, z + p.h * 0.94, wid + 2, 13, 0.8, p.rot, shade(p.col, -0.3));
      break; }
    case "hotel": case "tower": {
      const wid = p.t === "tower" ? 14 + p.r * 16 : 16 + p.r * 22;
      const style = p.t === "tower" ? "glass" : (T.def.facade || "hotel");
      B(p.x, p.y, z, wid, wid * 0.8, p.h, p.rot * 0.2 + p.r, p.col, TEX.facade(style, p.col, night));
      B(p.x, p.y, z + p.h, wid + 1, wid * 0.8 + 1, 0.8, p.rot * 0.2 + p.r, shade(p.col, -0.2));
      break; }
    case "yacht": {
      B(p.x, p.y, z - 1.0, 26 + p.r * 18, 7, 3.4, p.rot, p.col);
      B(p.x - 2, p.y, z + 2.4, 11, 5.2, 3.0, p.rot, shade(p.col, -0.06));
      B(p.x - 4, p.y, z + 5.4, 5, 3.4, 2.2, p.rot, "#DCE3E8");
      break; }
    case "pylon": {
      B(p.x, p.y, z, 0.5, 0.5, p.h, 0, p.col);
      // the head glows and drops a pool of light, which is far cheaper than
      // sixty real lamps and reads the same from above
      const head = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.5, 0.8),
        night ? this.glowMat("#FFE0A8", 3.0) : this.mat("#C8CDD3"));
      head.position.set(p.x, z + p.h + 0.25, p.y); head.rotation.y = -p.rot; g.add(head);
      if(night){
        const pool = new THREE.Mesh(new THREE.CircleGeometry(p.h * 0.85, 16),
          this.poolMat("#FFCE86", 0.16));
        pool.rotation.x = -Math.PI / 2; pool.position.set(p.x, z + 0.10, p.y);
        g.add(pool);
      }
      break; }
    case "ferris": {
      B(p.x, p.y, z, 3, 3, p.h * 0.5, 0, "#8A9199");
      const rr = p.h * 0.42;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(rr, rr * 0.035, 8, 40), this.mat(p.col));
      ring.position.set(p.x, z + p.h * 0.72, p.y); ring.rotation.y = p.rot; g.add(ring);
      for(let a = 0; a < 14; a++){
        const th = a / 14 * TAU;
        const cab = new THREE.Mesh(new THREE.BoxGeometry(1.8, 2.0, 1.8), this.mat(a % 2 ? "#F2F2F2" : p.col));
        cab.position.set(p.x + Math.cos(th) * rr * Math.cos(p.rot), z + p.h * 0.72 + Math.sin(th) * rr,
                         p.y + Math.cos(th) * rr * Math.sin(p.rot));
        g.add(cab);
      }
      lamp(p.x, p.y, z + p.h * 0.72, p.col, 2.0, 200);
      break; }
    case "stadium": {
      const rx = 150, ry = 62, segs = 30, ca = Math.cos(p.rot), sa = Math.sin(p.rot);
      for(let q = 0; q < segs; q++){
        const th = q / segs * TAU;
        if(Math.abs(Math.sin(th)) < 0.3) continue;
        const lx = Math.cos(th) * rx, ly = Math.sin(th) * ry;
        const cx = p.x + lx * ca - ly * sa, cy = p.y + lx * sa + ly * ca;
        const tall = p.h * (0.55 + 0.45 * Math.abs(Math.sin(th)));
        const rot2 = p.rot + Math.atan2(Math.sin(th) * rx, Math.cos(th) * ry) + Math.PI / 2;
        this.boxAt(g, cx, cy, z, 30, 16, tall, rot2, p.col, TEX.seats(p.col, night));
        this.boxAt(g, cx, cy, z + tall, 30, 17, 1.2, rot2, shade(p.col, -0.3));
      }
      break; }
    case "neon": {
      B(p.x, p.y, z, 1.0, 1.0, p.h * 0.45, 0, "#2A2A32");
      // the tubes are the light, not a box lit by one
      for(let k = 0; k < 4; k++){
        const m = new THREE.Mesh(new THREE.BoxGeometry(0.5, p.h * 0.10, 6.5),
          night ? this.glowMat(p.col, 3.4) : this.mat(p.col));
        m.position.set(p.x, z + p.h * 0.5 + k * p.h * 0.13 + p.h * 0.05, p.y);
        m.rotation.y = -p.rot; g.add(m);
      }
      lamp(p.x, p.y, z + p.h * 0.75, p.col, 1.6, 90);
      break; }
    case "sphere": {
      /* The Sphere.
         Published dimensions: 366 ft tall by 516 ft wide — 111.6 m by 157 m —
         so it is markedly wider than it is tall, and a plain ball of the right
         height would be 45 m too narrow. A sphere of radius 78.5 m whose centre
         sits 33.1 m above grade is exactly 111.6 m to the crown and exactly
         157 m across at its widest, which is a third of the way up. That is the
         profile used here: a sphere truncated below its equator, revolved from
         a lathe so the silhouette is under our control rather than the
         tessellator's, and cut off a few metres up where the LED skin stops and
         the podium takes over. See SPHERE.LAT0 for how the picture is laid on it. */
      const HT = p.h, R = HT * 0.7034, CZ = HT - R;          // 111.6 -> 78.5 and 33.1
      const zb = HT * 0.054;                                  // the skin stops here
      const lat0 = Math.asin(clamp((zb - CZ) / R, -1, 1));    // about -20 degrees
      const NV = 88;                                          // vertical samples: the
      const NU = 128;                                         // silhouette has to be clean at TV range
      const prof = [];
      // a crisp lip where the skin meets the plinth, then the ball
      prof.push(new THREE.Vector2(R * Math.cos(lat0) * 0.965, zb - 1.2));
      for(let i = 0; i <= NV; i++){
        const la = lat0 + (Math.PI / 2 - lat0) * (i / NV);
        prof.push(new THREE.Vector2(Math.max(0.01, R * Math.cos(la)), CZ + R * Math.sin(la)));
      }
      const geo = new THREE.LatheGeometry(prof, NU);
      // Lathe lays v out by profile index. The picture is drawn in latitude, so
      // rewrite v as the latitude each ring actually sits at: the graphics then
      // wrap the curvature instead of bunching at the crown.
      {
        const pos = geo.attributes.position, uv = geo.attributes.uv;
        for(let i = 0; i < pos.count; i++){
          const y = pos.getY(i), x = pos.getX(i), zz = pos.getZ(i);
          const rr = Math.hypot(x, zz);
          const la = Math.atan2(y - CZ, Math.max(rr, 1e-4)) * 180 / Math.PI;
          uv.setY(i, clamp(0.5 + la / 180, 0, 1));
        }
        uv.needsUpdate = true;
      }

      const cv = document.createElement("canvas"); cv.width = SPHERE.W; cv.height = SPHERE.H;
      const tx = G3.srgb(new THREE.CanvasTexture(cv));
      tx.wrapS = tx.wrapT = THREE.ClampToEdgeWrapping;
      tx.anisotropy = 8;
      // near black off, white light on: the picture lives entirely in the
      // emissive channel, which is what lets it blow past 1.0 and bloom
      const mat = new THREE.MeshStandardMaterial({
        color:G3.col("#08080C"), roughness:0.46, metalness:0.20,
        emissiveMap:tx, emissive:new THREE.Color(1, 1, 1), emissiveIntensity:1.05,
        normalMap:PTEX.facetsBall(), normalScale:new THREE.Vector2(0.24, 0.24),
        envMapIntensity:0.9,
      });
      /* The picture is drawn flat and wrapped here rather than in the canvas.
         vUv is equirectangular on the ball, so rebuild the surface normal from
         it, then project orthographically about a point tilted up to meet the
         camera: the poster reads undistorted head-on and curves away at the
         limb, which is what a flat video mapped onto the real Exosphere does.
         Doing it in the shader costs nothing; doing it per pixel in the canvas
         every frame would cost milliseconds. */
      mat.onBeforeCompile = sh => {
        sh.uniforms.uTilt = { value: SPHERE.TILT };
        sh.uniforms.uScale = { value: SPHERE.SCALE };
        sh.fragmentShader = "uniform float uTilt;\nuniform float uScale;\n" + sh.fragmentShader
          .replace("#include <emissivemap_fragment>", `
        #ifdef USE_EMISSIVEMAP
          float lon = vUv.x * 6.283185307;
          float lat = (vUv.y - 0.5) * 3.141592654;
          float cl = cos(lat);
          vec3 nrm = vec3(cl * sin(lon), sin(lat), cl * cos(lon));
          float sp = sin(uTilt), cp = cos(uTilt);
          float facing = nrm.y * sp + nrm.z * cp;
          vec2 pv = vec2(nrm.x, nrm.y * cp - nrm.z * sp) * (0.5 / uScale) + 0.5;
          vec4 emissiveColor = vec4(0.0);
          if(facing > 0.0){
            emissiveColor = texture2D(emissiveMap, pv);
            emissiveColor.rgb = emissiveMapTexelToLinear(emissiveColor).rgb;
            emissiveColor.rgb *= smoothstep(0.0, 0.26, facing);
          }
          // the pucks, in the surface's own space rather than the picture's
          emissiveColor.rgb *= 0.90 + 0.10 * cos(vUv.y * 3.141592654 * 320.0);
          totalEmissiveRadiance *= emissiveColor.rgb;
        #endif`);
      };
      // the injected uniforms change the program, so give it its own cache key
      mat.customProgramCacheKey = () => "sphereProj";
      const m = new THREE.Mesh(geo, mat);
      m.position.set(p.x, z, p.y);
      /* The poster's centre projects to local +Z, which LatheGeometry puts at
         u = 0. A quarter turn aims that at the camera's 45-degree azimuth. Set
         once, and then left alone — it never tracks the camera. */
      m.rotation.y = Math.PI * 0.25;
      m.castShadow = false; m.receiveShadow = false;
      m.userData.dynamic = true; g.add(m);

      /* the plinth: a low dark ring with a lit edge where it meets the ball */
      const pr = R * Math.cos(lat0) * 1.02;
      const pod = new THREE.Mesh(new THREE.CylinderGeometry(pr, pr * 1.06, zb, 64, 1, false),
        this.mat("#0E0C14", { roughness:0.9, metalness:0.1 }));
      pod.position.set(p.x, z + zb / 2, p.y); pod.receiveShadow = true; g.add(pod);
      const rim = new THREE.Mesh(new THREE.CylinderGeometry(pr * 1.005, pr * 1.005, 0.9, 64, 1, true),
        this.glowMat("#3C6EA8", 1.5, { side:THREE.DoubleSide }));
      rim.position.set(p.x, z + zb - 0.5, p.y); g.add(rim);
      // the apron it stands on
      const apron = new THREE.Mesh(new THREE.CylinderGeometry(pr * 1.5, pr * 1.55, 1.2, 48),
        this.mat("#15131C"));
      apron.position.set(p.x, z + 0.6, p.y); apron.receiveShadow = true; g.add(apron);

      const L = new THREE.PointLight(0xFFC85A, 3.2, 640, 2);
      L.position.set(p.x, z + CZ, p.y); L.userData.dynamic = true; g.add(L);
      this.dyn.push({ kind:"sphere", cv, tx, light:L, ctx:cv.getContext("2d"),
                      mesh:m, probe:document.createElement("canvas"), tick:0 });
      break; }
    case "billboard": {
      B(p.x, p.y, z, 0.6, 0.6, p.h * 0.55, 0, "#5A6069");
      const bw2 = 9 + p.r * 4, bh2 = p.h * 0.45;
      B(p.x, p.y, z + p.h * 0.55, 0.55, bw2, bh2, p.rot, "#23262E");
      // the lit face, on the side the camera is on
      const agEO = new THREE.PlaneGeometry(bw2 * 0.94, bh2 * 0.88), amat = ADS.mat(p.r, night);
      const fgrp = new THREE.Group();
      const fa = new THREE.Mesh(agEO, amat); fa.position.z = 0.30; fgrp.add(fa);
      const fb = new THREE.Mesh(agEO, amat); fb.position.z = -0.30; fb.rotation.y = Math.PI; fgrp.add(fb);
      fgrp.position.set(p.x, z + p.h * 0.55 + bh2 / 2, p.y);
      fgrp.rotation.y = -p.rot + Math.PI / 2;
      g.add(fgrp);
      break; }
    case "arch": {
      const w2 = T.half + T.runoff + 3;
      const nx = Math.cos(p.rot + Math.PI / 2), ny = Math.sin(p.rot + Math.PI / 2);
      for(const s of [-1, 1]) B(p.x + nx * w2 * s, p.y + ny * w2 * s, z, 1.4, 1.4, p.h, p.rot, "#3C434C");
      B(p.x, p.y, z + p.h, 1.8, w2 * 2 + 2, 1.7, p.rot, p.col);
      break; }
    case "marshal": {
      B(p.x, p.y, z, 2.2, 2.2, p.h, p.rot, p.col);
      B(p.x, p.y, z + p.h, 2.8, 2.8, 0.3, p.rot, "#D8352A");
      break; }
    case "fence": {
      B(p.x, p.y, z, 0.2, 7, p.h, p.rot, p.col);
      break; }
    case "garage": {
      B(p.x, p.y, z, p.w || 22, 9, p.h, p.rot, p.col, TEX.garage(p.col));
      B(p.x, p.y, z + p.h, (p.w || 22) + 0.4, 10, 0.7, p.rot, shade(p.col, -0.28));
      break; }
    case "banking": {
      B(p.x, p.y, z, 90, 9, 9, p.rot, p.col);
      break; }
    default: {
      // A landmark with a builder of its own gets purpose-made geometry. Anything
      // without one falls back to its box-and-pyramid recipe, captured as
      // geometry rather than painted — which is still what most circuits use.
      if(p.t === "lm" && LM3[p.k]){
        LM3[p.k](this, g, p, T, S);
      } else {
        setB3({ g, self:this });
        try{ drawProp(NOCTX, p, T, S); } finally { setB3(null); }
        if(night && (p.t === "lm")) lamp(p.x, p.y, z + p.h * 0.6, "#FFD9A0", 1.1, p.h * 2.2);
      }
      break; }
  }
  if(big){
    const meshes = [];
    g.traverse(o => {
      if(!o.isMesh && !o.isInstancedMesh) return;
      o.userData.dynamic = true;
      // a mesh may carry several materials — the extruded sign has a face and a
      // side — so every one of them needs its own copy to fade
      const ms = Array.isArray(o.material) ? o.material : [o.material];
      const cl = ms.map(m => {
        const c = m.clone();
        // Material.copy does not carry a shader hook, so a cloned material
        // silently loses its onBeforeCompile and falls back to the stock
        // shader. The Sphere's whole projection lives in that hook.
        if(m.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile){
          c.onBeforeCompile = m.onBeforeCompile;
          c.customProgramCacheKey = m.customProgramCacheKey;
          c.needsUpdate = true;
        }
        c.transparent = true; c.depthWrite = true; return c;
      });
      o.material = Array.isArray(o.material) ? cl : cl[0];
      meshes.push(o);
    });
    if(meshes.length){
      // the Sphere is wider than it is tall, so its footprint is not its height
      const rad = p.t === "sphere" ? p.h * 0.72 : Math.max(16, p.h * 0.4);
      this.occluders.push({ meshes, x:p.x, y:p.y, z:z + p.h * (p.t === "sphere" ? 0.30 : 0.5),
                            rx:rad, ry:p.h * (p.t === "sphere" ? 0.62 : 0.55), fade:1 });
    }
  }
  parent.add(g);
  return g;
};

