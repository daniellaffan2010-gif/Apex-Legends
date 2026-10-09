import * as THREE from 'three';
import { shade } from '../../config/util.js';
import { FIELD, LIFT, VERGE } from './field.js';

/* ---- grass you can see blades in, beside the road, for the cockpit view -------
   From 74 cm up the verge is no longer a green texture seen from a helicopter
   but a lawn a few metres away, and a flat texture there reads as a carpet. So
   near the cockpit camera the grass is tufts: a few crossed blades each, 6-14 cm
   on the mown verges, longer and rougher behind the barrier, short uniform fibres
   on the artificial grass, all swaying in the wind.

   Where: only where FIELD says the top is grass (the verge out to ro + VERGE, and
   grass run-off where a circuit has it), or astro for the fibres. Never on road,
   kerb, tarmac or gravel, not under the armco (ro + 2.6), not in the pit lane,
   and never on a stretch of verge that another part of the lap passes over (a
   hairpin's other leg). Rooted at FIELD.zAt, the same height the ground layers
   are laid at, so they neither float nor sink.

   How: one InstancedMesh with its own material (rule 1 of the instance-colour
   pitfall: always setColorAt, never share). The lap is cut into chunks, one per
   node, side and 8 m band across, each generated once on first sight from a
   per-node hash, so a tuft is always in the same place and the same colour:
   tufts never swim as the camera moves. Every tuft has a rank (0..1) and the
   chunk keeps its tufts sorted by it, so thinning with distance is a prefix:
   the chunk shows only its first k tufts, and the shader shrinks each tuft into
   the ground as the camera leaves its own reach, so nothing pops. Dense within
   ~12 m, an eighth as dense by 40 m, none past 42 m. (At ~7 px per metre in the
   overhead view a blade is less than a pixel, so the overhead camera gets none.)

   Per frame: find the chunks near the camera (a node grid), work out each one's
   prefix, and write only what changed into the instance buffers, which are
   handed out in pages (see place). New chunks are made within a small time
   allowance a frame. */

const R_FULL = 12, R_END = 40, R_MAX = 42;   // full density inside R_FULL, DENS_END at R_END, nothing past R_MAX
const DENS_END = 0.12;
const DENSITY = 11;          // tufts per square metre at full density (mown and rough grass)
const ASTRO_DENS = 7;        // fibre tufts per square metre on the artificial grass
const PAGE = 32;             // instance slots are handed to chunks this many at a time (a power of two)
const NP = 294;              // pages
const CAP = PAGE * NP;       // 9408 instances x 8 triangles: 75k, under the 80k budget
const GEN_MS = 0.08;         // milliseconds a frame for making new chunks (at least one is made when any is due)
const BAND = 8;              // a chunk's width across the verge, metres
const KEEP = 600;            // chunks kept generated before the least recently seen are dropped
const POOL = 400;            // dropped chunks kept for their buffers, so a lap does not make ~60 MB of garbage
const CELL = 24;             // the node grid's cell, metres

// the fraction of tufts drawn at d metres from the camera (the shader has the same curve)
function dens(d){
  if(d <= R_FULL) return 1;
  if(d >= R_MAX) return 0;
  if(d >= R_END) return DENS_END * (R_MAX - d) / (R_MAX - R_END);
  return 1 - (1 - DENS_END) * (d - R_FULL) / (R_END - R_FULL);
}
// a small integer hash to 0..1, so a tuft's place, size and colour are fixed by where it is
function hash(a, b, c){
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b); h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35); h ^= h >>> 16;
  return h >>> 0;
}
/* One tuft, in unit space: blades fanning out from a small base, height 1 and
   reach 1, scaled per instance to metres. Four blades of two triangles, each a
   tapered quad leaning out and twisting a little. Every normal points up: a
   blade a few centimetres tall is lit like the lawn it grows from, not like a
   card, and both its faces get the same light. The colour attribute darkens the
   roots, which is most of what makes a clump read as a clump. */
function tuftGeometry(){
  const pos = [], nrm = [], col = [], idx = [];
  const B = 4;
  for(let k = 0; k < B; k++){
    const a = k / B * Math.PI + (k % 2 ? 0.35 : 0);        // crossed: 0, 45+, 90, 135+ degrees
    const ca = Math.cos(a), sa = Math.sin(a);
    const lean = k % 2 ? 0.55 : -0.45, tall = k === 1 ? 0.78 : k === 3 ? 0.9 : 1;
    const bw = 0.30, tw = 0.07;                              // base and tip half widths (unit)
    const bx = -sa * 0.12, bz = ca * 0.12;                   // blades start a little apart
    const tx = bx + -sa * lean, tz = bz + ca * lean;         // and lean outward
    const v0 = pos.length / 3;
    pos.push(bx - ca * bw, 0, bz - sa * bw,  bx + ca * bw, 0, bz + sa * bw,
             tx - ca * tw, tall, tz - sa * tw,  tx + ca * tw, tall, tz + sa * tw);
    for(let q = 0; q < 4; q++) nrm.push(0, 1, 0);
    col.push(0.52, 0.56, 0.5,  0.52, 0.56, 0.5,  1.08, 1.06, 1.0,  1.08, 1.06, 1.0);
    idx.push(v0, v0 + 1, v0 + 2,  v0 + 1, v0 + 3, v0 + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/* The tuft shader: a stock MeshStandardMaterial with three changes.
   - begin_vertex: shrink the tuft into its root as the camera leaves its reach
     (its rank against the density at its distance), then bend it downwind, by
     the square of the height so the roots stay put, on two waves and a slow
     travelling gust. Done in the tuft's own space (the wind turned into it
     through the instance matrix's own axes), so shadows and fog see the same
     bent blade.
   - normal_fragment_begin: a double-sided material turns the normal over on the
     back face; for blades lit as lawn, turn it back. */
function grassMaterial(U){
  const m = new THREE.MeshStandardMaterial({ color:0xFFFFFF, vertexColors:true, roughness:0.93, metalness:0, side:THREE.DoubleSide });
  m.onBeforeCompile = sh => {
    sh.uniforms.uTime = U.time; sh.uniforms.uWind = U.wind; sh.uniforms.uWindDir = U.windDir;
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", `#include <common>
attribute float aRank;
uniform float uTime; uniform float uWind; uniform vec2 uWindDir;`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>
#ifdef USE_INSTANCING
  vec3 gRoot = (modelMatrix * vec4(instanceMatrix[3].xyz, 1.0)).xyz;
  float gD = distance(gRoot, cameraPosition);
  float gDen = gD <= ${R_FULL.toFixed(1)} ? 1.0 : gD >= ${R_MAX.toFixed(1)} ? 0.0 : gD >= ${R_END.toFixed(1)}
    ? ${DENS_END.toFixed(3)} * (${R_MAX.toFixed(1)} - gD) / ${(R_MAX - R_END).toFixed(1)}
    : 1.0 - ${(1 - DENS_END).toFixed(3)} * (gD - ${R_FULL.toFixed(1)}) / ${(R_END - R_FULL).toFixed(1)};
  float gFade = clamp((gDen - aRank) * 14.0, 0.0, 1.0);
  // (a blank slot is a zero matrix: keep its sums finite, it is shrunk to nothing anyway)
  vec3 gAx = instanceMatrix[0].xyz, gAz = instanceMatrix[2].xyz;
  float gSy = max(length(instanceMatrix[1].xyz), 1e-4);
  float gH = position.y * gSy;                                     // metres above the root
  float gPh = gRoot.x * 0.71 + gRoot.z * 0.53;
  float gGust = sin(uTime * 0.8 - dot(gRoot.xz, uWindDir) * 0.09) * 0.5 + 0.5;
  float gSw = (0.35 + 0.65 * gGust) * (sin(uTime * 2.7 + gPh) * 0.55 + sin(uTime * 4.3 + gPh * 1.9) * 0.2 + 0.45);
  float gBend = uWind * gSw * gH * gH * 9.0;                       // metres the tip moves
  vec3 gW = vec3(uWindDir.x, 0.0, uWindDir.y) * gBend;
  transformed.x += dot(gW, gAx) / max(dot(gAx, gAx), 1e-8);
  transformed.z += dot(gW, gAz) / max(dot(gAz, gAz), 1e-8);
  transformed.y -= 0.5 * gBend * gBend / max(gH, 0.02) / gSy;     // a bent blade is a little lower, not longer
  transformed *= gFade;
#endif`);
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <normal_fragment_begin>", `#include <normal_fragment_begin>
#ifdef DOUBLE_SIDED
  normal = normal * faceDirection;
#endif`);
  };
  m.customProgramCacheKey = () => "groundGrass";
  return m;
}

const GRASS = {
  mesh:null, geo:null, mat:null, rank:null, T:null,
  U:{ time:{ value:0 }, wind:{ value:0.22 }, windDir:{ value:new THREE.Vector2(0.8, 0.6) } },
  chunks:new Map(), pool:new Map(), pooled:0, runsC:null, grid:null, others:null, frameNo:0, gen:0,
  live:[], shown:[], ord:[], pageUsed:new Uint8Array(NP), free:NP, dLo:0, dHi:-1, stats:{ count:0, chunks:0, gen:0, uploads:0, ms:0 },

  /* once per G3.build, after the ground is laid: what about the lap does not
     change, and the one mesh. Nothing per node is worked out here (that is done
     the first time the camera comes near it), so a build costs a few milliseconds. */
  build(G, S){
    this.dispose();
    const T = S.track, n = T.n;
    // a street circuit has walls where the verges would be: nothing to grow
    if(T.barrier === "wall" && !T.surfAt) return;
    this.T = T;
    this.colours(G, T);
    this.runsC = new Array(n * 2).fill(null);
    // the node grid, for finding the chunks near the camera and the places where the lap folds back on itself
    const g = new Map();
    for(let i = 0; i < n; i++){
      const k = this.gkey(Math.floor(T.x[i] / CELL), Math.floor(T.y[i] / CELL));
      let l = g.get(k); if(!l){ l = []; g.set(k, l); } l.push(i);
    }
    this.grid = g;
    /* Where the lap folds back on itself (a hairpin's two legs, a crossover), the
       verge of one part can be the road of another. For each node, the nodes of
       other parts of the lap (more than 4 along) whose ground could reach its verge. */
    this.others = new Array(n).fill(null);
    for(let i = 0; i < n; i++){
      const reach = T.half * 2 + Math.max(T.roL[i], T.roR[i]) + VERGE * 2 + T.runoffMax + T.ds, list = [];
      const c0 = Math.floor((T.x[i] - reach) / CELL), c1 = Math.floor((T.x[i] + reach) / CELL);
      const d0 = Math.floor((T.y[i] - reach) / CELL), d1 = Math.floor((T.y[i] + reach) / CELL);
      for(let cx = c0; cx <= c1; cx++) for(let cy = d0; cy <= d1; cy++){
        const l = g.get(this.gkey(cx, cy)); if(!l) continue;
        for(const j of l){
          // close enough for the two sides' ground (road, run-off and verge) to meet
          const di = Math.min(Math.abs(i - j), n - Math.abs(i - j)), rj = T.half * 2 + Math.max(T.roL[i], T.roR[i]) + Math.max(T.roL[j], T.roR[j]) + VERGE * 2 + T.ds;
          if(di > 4 && (T.x[i] - T.x[j]) ** 2 + (T.y[i] - T.y[j]) ** 2 < rj * rj) list.push(j);
        }
      }
      if(list.length) this.others[i] = Int32Array.from(list);
    }
    this.geo = tuftGeometry();
    this.rank = new THREE.InstancedBufferAttribute(new Float32Array(CAP), 1);
    this.rank.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute("aRank", this.rank);
    this.mat = grassMaterial(this.U);
    const m = new THREE.InstancedMesh(this.geo, this.mat, CAP);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.setColorAt(0, this.cGrass);                           // creates instanceColor: every slot is written with one
    m.instanceColor.setUsage(THREE.DynamicDrawUsage);
    m.count = 0; m.frustumCulled = false; m.castShadow = false; m.receiveShadow = true;
    m.userData.dynamic = true; m.name = "grass"; m.visible = false;
    this.mesh = m;
    // the wind: a steady direction per circuit
    const wa = hash(n, Math.round(T.x[0]), 3) / 4294967296 * Math.PI * 2;
    this.U.windDir.value.set(Math.cos(wa), Math.sin(wa));
    (G.world || G.scene).add(m);
  },

  /* the grass colour to match what is laid under it: the worlds that mow their
     verges say what colour they mow them, the rest use the palette's grass band */
  colours(G, T){
    const C = c => (G && G.col ? G.col(c) : new THREE.Color(c).convertSRGBToLinear());
    const w = T.def && T.def.world, P = T.pal || {};
    const mown = { spa:"#5E8A40", suzuka:"#7DA950", interlagos:"#5E8A40", mexico:"#5A7E3E" }[w];
    this.cGrass = C(mown || shade(P.grass || "#5E8A3E", -0.05));
    this.cRough = C(shade(P.grass || "#5E8A3E", -0.16));
    this.cAstro = C("#3E8A4A");
    this.cDry = C("#9A9A5A");
  },

  /* What grows at node i, offset off: 0 nothing, 1 mown grass, 2 mown grass on a
     "plain" run-off, 3 artificial grass, 4 rough grass behind the barrier. FIELD
     decides, with refinements for what is actually drawn: the "plain" run-off is a
     tarmac apron two metres wide and then verge (build.js lays it so, a world may
     mow it, though FIELD.kindAt calls the whole of it asphalt), and nothing under
     the armco, in or beside the pit lane, or past where FIELD's heights stop. */
  kind(T, i, off){
    const a = Math.abs(off) - T.half;
    // the first 20 cm past the edge line is the road's own lip (the bands start at half + 0.2)
    if(a < 0.25) return 0;
    // a bridge deck has nothing beside it at road level but air
    if(T.bridge && T.bridge[i] && T.deckH[i] > 0.15) return 0;
    const ro = off >= 0 ? T.roR[i] : T.roL[i];
    if(a > ro + VERGE - 0.3) return 0;
    if(T.pitRamp && (off >= 0 ? 1 : -1) === T.pitSide && T.pitRamp(i) > 0.02 && a < T.pitW + 1.5) return 0;
    const k = FIELD.kindAt(T, i, off);
    if(k === "grass") return a > ro + 3.2 ? 4 : a > ro + 2.35 ? 0 : 1;
    if(k === "astro") return 3;
    if(k === "asphalt" && a > 2.15 && T.surfAt && T.barrier !== "wall" && T.surfAt(i, off) === "runoff") return 2;
    return 0;
  },

  /* The runs of each kind across one side of node i, as [lo, hi, code, ...] in
     metres out from the road edge, each pulled in from its ends by a blade's reach
     so a tuft never leans over the kerb, the tarmac or the gravel next to it.
     Found by a coarse scan and a bisection at each change, so to a few millimetres. */
  runs(i, s){
    const key = i * 2 + s, have = this.runsC[key];
    if(have) return have;
    const T = this.T, sd = s ? 1 : -1, ro = s ? T.roR[i] : T.roL[i], top = ro + VERGE, st = 0.25;
    const out = [];
    let a = 0, k = this.kind(T, i, sd * T.half), lo = 0;
    const close = (hi, code) => {
      const pad = code === 3 ? 0.06 : 0.14;
      if(code && hi - lo > pad * 2 + 0.05) out.push(lo + pad, hi - pad, code);
    };
    while(a < top){
      const b = Math.min(top, a + st), kb = this.kind(T, i, sd * (T.half + b));
      if(kb !== k){
        let x0 = a, x1 = b;
        for(let q = 0; q < 6; q++){ const xm = (x0 + x1) * 0.5; if(this.kind(T, i, sd * (T.half + xm)) === k) x0 = xm; else x1 = xm; }
        close(x0, k); lo = x1; k = kb;
      }
      a = b;
    }
    close(top, k);
    return (this.runsC[key] = new Float32Array(out));
  },

  /* One chunk: the grass on one side of the segment from node i to i+1, in one
     band of BAND metres across (a wide grass run-off is several chunks, so each
     costs little to make and the far ones can be left out). Every tuft is placed
     by hashing its slot on a jittered lattice, so it is always in the same place,
     the same size and the same colour; the chunk keeps them in rank order. Per
     tuft ten floats: the rotation-and-width pair, height, position (three's x, y,
     z), colour, rank. */
  chunk(i, s, b){
    const T = this.T, n = T.n, j = (i + 1) % n, sd = s ? 1 : -1;
    const Ri = this.runs(i, s), Rj = this.runs(j, s);
    const tun = T.inTunnel && (T.inTunnel(i) || T.inTunnel(j));
    const sp = 1 / Math.sqrt(DENSITY), steps = Math.max(1, Math.round(T.ds / sp));
    const c = this.c, oth = this.others[i] || this.others[j], b0 = b * BAND, b1 = b0 + BAND;
    const ci = T.curv[i], cj = T.curv[j];
    let N = 0, cx = 0, cy = 0, scr = this.scr;
    if(!tun) for(let p = 0; p < Ri.length; p += 3) for(let q = 0; q < Rj.length; q += 3){
      const code = Ri[p + 2];
      if(Rj[q + 2] !== code) continue;
      const lo = Math.max(Ri[p], Rj[q], b0), hi = Math.min(Ri[p + 1], Rj[q + 1], b1);
      if(hi <= lo) continue;
      const lift = code === 1 || code === 4 ? LIFT.grass : LIFT.runoff;
      for(let v = Math.floor(lo / sp); v <= Math.floor(hi / sp); v++){
        // the surface height at both ends of this column at both nodes; the tufts in
        // it take a straight line between them, as the ground's lanes do
        const oa = sd * (T.half + v * sp), ob = sd * (T.half + (v + 1) * sp);
        const zia = FIELD.baseZ(T, i, oa), zib = FIELD.baseZ(T, i, ob), zja = FIELD.baseZ(T, j, oa), zjb = FIELD.baseZ(T, j, ob);
        for(let u = 0; u < steps; u++){
          // one hash for the slot, stirred for each further number it needs
          let h = hash(i, u * 4096 + v, s);
          const h2 = (h & 0xFFFF) / 65536, a = (v + h2) * sp;
          if(a < lo || a >= hi) continue;
          h = Math.imul(h ^ (h >>> 13), 0x5bd1e995) >>> 0;
          const h3 = (h & 0xFFFF) / 65536, r = (h >>> 16) / 65536;
          if(code === 3 && h3 > ASTRO_DENS / DENSITY) continue;
          // the fibres are a few centimetres tall: they rank last, so they are gone by ~20 m
          const rk = code === 3 ? 0.75 + r * 0.25 : r;
          // nothing the camera could never be close enough to see: a tuft a metres out is at
          // least a - 4 from a camera on the road or just off it (where the lap folds back,
          // from whichever road is nearer)
          if(!oth && rk >= dens(a - 4)) continue;
          h = Math.imul(h ^ (h >>> 15), 0x27d4eb2d) >>> 0;
          const h1 = (h & 0xFFFF) / 65536, rot = (h >>> 16) / 65536 * 6.2832;
          const f = (u + h1) / steps, off = sd * (T.half + a);
          // on the inside of a tight bend, far enough out the ground folds over on itself
          // (the ribbons pin it at 0.8 / curvature): no grass on a fold
          if(off * ci > 0.74 || off * cj > 0.74) continue;
          // where it is: between the two nodes, as the ribbons lay it
          const x = (T.x[i] + T.nx[i] * off) * (1 - f) + (T.x[j] + T.nx[j] * off) * f;
          const y = (T.y[i] + T.ny[i] * off) * (1 - f) + (T.y[j] + T.ny[j] * off) * f;
          const g = a / sp - v;
          let z = ((zia + (zib - zia) * g) * (1 - f) + (zja + (zjb - zja) * g) * f) + lift;
          if(oth){
            /* The other part of the lap nearest this tuft. Where its ground reaches here
               too, the two overlap: a tuft only where this part's ground is the higher
               one and the other's is not its road or run-off. */
            let bj = -1, bd = 1e18;
            for(let k = 0; k < oth.length; k++){
              const q2 = oth[k], d2 = (T.x[q2] - x) ** 2 + (T.y[q2] - y) ** 2;
              if(d2 < bd){ bd = d2; bj = q2; }
            }
            // too far for any of its ground to be here: nothing to ask
            const reach = T.half + Math.max(T.roL[bj], T.roR[bj]) + VERGE + T.ds * 0.5;
            // bj is that part's nearest node (the list holds all of them near here), so it stands for FIELD.locate
            const Lo = bd < reach * reach ? this.at(T, bj, x, y) : null;
            const aj = Lo ? Math.abs(Lo.off) - T.half : 1e9;
            const own = Lo && Math.min(Math.abs(Lo.i - i), n - Math.abs(Lo.i - i)) <= 2;
            if(Lo && !own && aj < (Lo.off >= 0 ? T.roR[Lo.i] : T.roL[Lo.i]) + VERGE){
              const kj = this.kind(T, Lo.i, Lo.off);
              const j2 = (Lo.i + (Lo.al >= 0 ? 1 : n - 1)) % n, f2 = Math.min(Math.abs(Lo.al) / T.ds, 1);
              const zo = FIELD.zAt(T, Lo.i, Lo.off) * (1 - f2) + FIELD.zAt(T, j2, Lo.off) * f2;
              // its ground higher than this one here: whichever of the two is drawn on top,
              // a tuft at this height would be buried in it or standing on nothing, so none
              if(zo > z + 0.01) continue;
              // its ground nearer, and not grass: its run-off or its road
              if(aj < a && kj !== code) continue;
              if(rk >= dens(Math.min(a, aj) - 4)) continue;
            } else if(rk >= dens(a - 4)) continue;
          }
          let hgt, wid;
          if(code === 3){ hgt = 0.022 + h3 * 0.018; wid = 0.05 + h1 * 0.02; c.copy(this.cAstro).multiplyScalar(0.9 + h2 * 0.18); }
          else {
            const pn = this.noise(x, y, 2.6), rough = code === 4;
            hgt = rough ? 0.10 + r * 0.05 + pn * 0.08 : 0.06 + h3 * 0.05 + pn * 0.03;
            wid = (rough ? 0.13 : 0.105) + h1 * 0.05;
            c.copy(rough ? this.cRough : this.cGrass).lerp(this.cDry, Math.max(0, this.noise(x + 91, y - 37, 7) - 0.6) * 0.8);
            c.multiplyScalar(0.84 + h2 * 0.24 + pn * 0.1);
          }
          if((N + 1) * 10 > scr.length){ const nb = new Float32Array(scr.length * 2); nb.set(scr); scr = this.scr = nb; }
          const o = N * 10;
          scr[o] = Math.cos(rot) * wid; scr[o + 1] = Math.sin(rot) * wid; scr[o + 2] = hgt;
          scr[o + 3] = x; scr[o + 4] = z; scr[o + 5] = y;
          scr[o + 6] = c.r; scr[o + 7] = c.g; scr[o + 8] = c.b; scr[o + 9] = rk;
          cx += x; cy += y; N++;
        }
      }
    }
    // rank order by a counting sort on 256 buckets (the prefix only has to be right to 1/256)
    const B = this.bk; B.fill(0);
    for(let k = 0; k < N; k++) B[Math.min(255, (scr[k * 10 + 9] * 256) | 0) + 1]++;
    for(let k = 1; k < 257; k++) B[k] += B[k - 1];
    const ch = this.take((N + 63) & ~63), d = ch.d, rank = ch.rank;
    for(let k = 0; k < N; k++){
      const t = B[Math.min(255, (scr[k * 10 + 9] * 256) | 0)]++;
      for(let e = 0; e < 10; e++) d[t * 10 + e] = scr[k * 10 + e];
      rank[t] = scr[k * 10 + 9];
    }
    if(N){ cx /= N; cy /= N; }
    let r2 = 0;
    for(let k = 0; k < N; k++) r2 = Math.max(r2, (d[k * 10 + 3] - cx) ** 2 + (d[k * 10 + 5] - cy) ** 2);
    this.stats.gen++;
    ch.n = N; ch.x = cx; ch.y = cy; ch.r = Math.sqrt(r2) + 0.3; ch.seen = 0; ch.np = 0; ch.shown = 0; ch.want = 0; ch.liveFr = 0;
    return ch;
  },

  /* A chunk's storage for cap tufts (a multiple of 64): one a dropped chunk left
     behind if there is one. Some 5000 chunks are made in a lap and only KEEP are
     kept, so fresh typed arrays for each would be tens of megabytes of garbage a
     lap, and the collector's pauses (a millisecond or two) were the grass's only
     slow frames. */
  take(cap){
    const l = this.pool.get(cap);
    if(l && l.length){ this.pooled--; return l.pop(); }
    return { n:0, d:new Float32Array(cap * 10), rank:new Float32Array(cap), cap, x:0, y:0, r:0, seen:0,
      pages:cap ? new Int16Array(cap / PAGE) : null, np:0, shown:0, want:0, liveFr:0 };
  },
  // drop the chunks not seen for a while (Map.forEach with a bound function: no allocation)
  evict(ch, k){
    const G = GRASS;
    if(G.frameNo - ch.seen <= 120 || ch.np) return;
    G.chunks.delete(k);
    if(G.pooled >= POOL) return;
    let l = G.pool.get(ch.cap); if(!l){ l = []; G.pool.set(ch.cap, l); }
    l.push(ch); G.pooled++;
  },

  // FIELD.locate's answer when the nearest node is already known (one reused object)
  at(T, i, x, y){
    const dx = x - T.x[i], dy = y - T.y[i], L = this.loc;
    L.i = i; L.off = dx * T.nx[i] + dy * T.ny[i]; L.al = dx * T.tx[i] + dy * T.ty[i];
    return L;
  },

  /* smooth value noise from a small table, for the paler and darker patches a verge
     has; sc is the size of a patch in metres */
  noise(x, y, sc){
    const t = this.ntab, gx = x / sc, gy = y / sc, ix = Math.floor(gx), iy = Math.floor(gy);
    const fx = gx - ix, fy = gy - iy, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    const x0 = ix & 63, x1 = (ix + 1) & 63, y0 = (iy & 63) << 6, y1 = ((iy + 1) & 63) << 6;
    return (t[y0 + x0] * (1 - u) + t[y0 + x1] * u) * (1 - v) + (t[y1 + x0] * (1 - u) + t[y1 + x1] * u) * v;
  },

  /* Every frame. view = { fp, x, y, z, hx, hy, dt }: whether the grass is wanted
     (the cockpit; the overhead camera is too far away to see a blade), the
     camera's game position and its heading on the ground. */
  frame(G, S, view){
    const m = this.mesh;
    if(!m) return;
    if(!view || !view.fp){ m.visible = false; return; }
    const t0 = this.now();
    m.visible = true;
    this.U.time.value = (S && S.clock) || 0;
    const fr = ++this.frameNo, live = this.live;
    live.length = 0; this.gen = 0; this.genEnd = t0 + GEN_MS; this.stats.genMs = 0;
    // the chunks within reach (the grid walked by hand: no closure a frame)
    const r = R_MAX + 34, x = view.x, y = view.y;
    const c0 = Math.floor((x - r) / CELL), c1 = Math.floor((x + r) / CELL), d0 = Math.floor((y - r) / CELL), d1 = Math.floor((y + r) / CELL);
    for(let cx = c0; cx <= c1; cx++) for(let cy = d0; cy <= d1; cy++){
      const l = this.grid.get(this.gkey(cx, cy));
      if(l) for(let k = 0; k < l.length; k++) for(let s = 0; s < 2; s++) this.consider(l[k], s, view, fr);
    }
    // nearest first, so when the pages run out it is the far ones that go without
    const L = live.length / 3, ord = this.ord;
    ord.length = L;
    for(let k = 0; k < L; k++) ord[k] = k;
    ord.sort(this.byDist);
    this.place(L, fr);
    // forget the chunks not seen for a while once there are too many
    if(this.chunks.size > KEEP && fr % 30 === 0) this.chunks.forEach(this.evict);
    this.stats.count = m.count; this.stats.chunks = L; this.stats.ms = this.now() - t0;
  },

  /* one side of one node's part in this frame, band by band: generate a chunk if
     it is new and in reach (while this frame's time for it lasts), then how many
     of its tufts the distance allows */
  consider(i, s, view, fr){
    const T = this.T, hx = view.hx, hy = view.hy, sd = s ? 1 : -1;
    const ro = Math.max(s ? T.roR[i] : T.roL[i], s ? T.roR[(i + 1) % T.n] : T.roL[(i + 1) % T.n]);
    // the whole side out of reach or behind: one test instead of one per band
    const ex = T.x[i] - view.x, ey = T.y[i] - view.y, reach = T.half + ro + VERGE + T.ds;
    if(ex * ex + ey * ey > (R_MAX + reach) * (R_MAX + reach) || ex * hx + ey * hy < -(reach + 6)) return;
    const nb = Math.min(8, Math.ceil((ro + VERGE) / BAND));
    for(let b = 0; b < nb; b++){
      const key = (i * 2 + s) * 8 + b;
      let ch = this.chunks.get(key);
      if(!ch){
        // a rough bound before it exists, so far and behind chunks are never generated
        const mid = T.half + (b + 0.5) * BAND;
        const bx = T.x[i] + T.tx[i] * T.ds * 0.5 + T.nx[i] * sd * mid, by = T.y[i] + T.ty[i] * T.ds * 0.5 + T.ny[i] * sd * mid;
        const br = Math.hypot(T.ds, BAND) * 0.5 + 1.5;
        const dx = bx - view.x, dy = by - view.y;
        if(Math.hypot(dx, dy) - br > R_MAX || dx * hx + dy * hy < -(br + 6)) continue;
        // a few milliseconds' worth would be a hitch: past this frame's share, wait for the next
        if(this.gen && this.now() > this.genEnd) continue;
        const g0 = this.now();
        ch = this.chunk(i, s, b); this.chunks.set(key, ch); this.gen++;
        this.stats.genMs += this.now() - g0;
      }
      ch.seen = fr;
      if(!ch.n) continue;
      const dx = ch.x - view.x, dy = ch.y - view.y;
      const d = Math.max(0, Math.hypot(dx, dy) - ch.r);
      if(d > R_MAX || dx * hx + dy * hy < -(ch.r + 6)) continue;
      // the prefix: every tuft whose rank is under the density at the chunk's nearest point,
      // in steps of 1/24 so it changes a few times on the way past, not every frame
      const want = Math.min(1.01, Math.ceil(dens(d) * 24) / 24), rk = ch.rank;
      let lo = 0, hi = ch.n;
      while(lo < hi){ const mid = (lo + hi) >> 1; if(rk[mid] < want) lo = mid + 1; else hi = mid; }
      if(lo) this.live.push(key, lo, d);
    }
  },

  /* The instance buffers are cut into pages of PAGE tufts, and a chunk holds as
     many pages as its prefix needs, for as long as it is in reach. So when the
     camera moves on, only what changed is written: a chunk that grows writes its
     new tufts into its pages, one that shrinks blanks its tail, one that leaves
     hands its pages back. A blank slot is a zero matrix: every vertex at one
     point, nothing drawn. The pages in use need not be contiguous; the draw runs
     to the last one, and the blanks between cost a little vertex work and nothing
     else. One upload range covers what was written. */
  place(L, fr){
    const live = this.live, ord = this.ord, shown = this.shown, used = this.pageUsed;
    this.dLo = Infinity; this.dHi = -1;
    // first everything that gives pages back: chunks gone out of reach, and the ones that need fewer
    for(let k = 0; k < L; k++){ const ch = this.chunks.get(live[k * 3]); ch.want = live[k * 3 + 1]; ch.liveFr = fr; }
    let w = 0;
    for(let k = 0; k < shown.length; k++){
      const ch = this.chunks.get(shown[k]);
      if(ch.liveFr !== fr){ this.resize(ch, 0); continue; }
      if(Math.ceil(ch.want / PAGE) < ch.np) this.resize(ch, ch.want);
      shown[w++] = shown[k];
    }
    shown.length = w;
    // then, nearest first, the ones that need more; when the pages run out, the
    // farthest chunks still holding some give theirs up to the nearer ones
    let tail = L - 1;
    for(let k = 0; k < L; k++){
      const key = live[ord[k] * 3], ch = this.chunks.get(key);
      if(!ch.np && ch.want) shown.push(key);
      if(ch.want === ch.shown) continue;
      while(this.free < Math.ceil(ch.want / PAGE) - ch.np && tail > k){
        const far = this.chunks.get(live[ord[tail--] * 3]);
        if(far.np){ this.resize(far, 0); }
        far.want = 0;
      }
      this.resize(ch, ch.want);
    }
    for(let k = shown.length - 1; k >= 0; k--) if(!this.chunks.get(shown[k]).np){ shown[k] = shown[shown.length - 1]; shown.length--; }
    // the draw runs to the last page in use
    let top = NP - 1;
    while(top >= 0 && !used[top]) top--;
    const m = this.mesh;
    m.count = (top + 1) * PAGE;
    if(this.dHi >= 0){
      const a = this.dLo, n = this.dHi - this.dLo + 1;
      m.instanceMatrix.updateRange.offset = a * 16; m.instanceMatrix.updateRange.count = n * 16; m.instanceMatrix.needsUpdate = true;
      m.instanceColor.updateRange.offset = a * 3; m.instanceColor.updateRange.count = n * 3; m.instanceColor.needsUpdate = true;
      this.rank.updateRange.offset = a; this.rank.updateRange.count = n; this.rank.needsUpdate = true;
      this.stats.uploads++; this.stats.written = n;
    }
  },

  /* show the first `want` tufts of a chunk: take or give back pages, write the new
     tufts, blank the ones no longer shown */
  resize(ch, want){
    const used = this.pageUsed, M = this.mesh.instanceMatrix.array, C = this.mesh.instanceColor.array, R = this.rank.array;
    if(!ch.pages) ch.pages = new Int16Array(Math.ceil(ch.n / PAGE));
    let need = Math.ceil(want / PAGE);
    // take pages, lowest free first, so the draw count stays low
    for(let p = 0; ch.np < need && this.free && p < NP; p++) if(!used[p]){ used[p] = 1; ch.pages[ch.np++] = p; this.free--; }
    if(ch.np < need){ need = ch.np; want = Math.min(want, need * PAGE); }
    const d = ch.d;
    // the new tufts
    for(let t = ch.shown; t < want; t++){
      const s = ch.pages[t >> 5] * PAGE + (t & (PAGE - 1)), o = t * 10, w = s * 16, c3 = s * 3;
      // a turn about the vertical and a scale: wide across, tall up
      M[w] = d[o]; M[w + 1] = 0; M[w + 2] = -d[o + 1]; M[w + 3] = 0;
      M[w + 4] = 0; M[w + 5] = d[o + 2]; M[w + 6] = 0; M[w + 7] = 0;
      M[w + 8] = d[o + 1]; M[w + 9] = 0; M[w + 10] = d[o]; M[w + 11] = 0;
      M[w + 12] = d[o + 3]; M[w + 13] = d[o + 4]; M[w + 14] = d[o + 5]; M[w + 15] = 1;
      C[c3] = d[o + 6]; C[c3 + 1] = d[o + 7]; C[c3 + 2] = d[o + 8]; R[s] = d[o + 9];
      if(s < this.dLo) this.dLo = s;
      if(s > this.dHi) this.dHi = s;
    }
    // the ones no longer shown, out to the end of the pages that are kept or given back
    for(let t = want; t < ch.shown; t++){
      const s = ch.pages[t >> 5] * PAGE + (t & (PAGE - 1));
      M.fill(0, s * 16, s * 16 + 16); R[s] = 2;
      if(s < this.dLo) this.dLo = s;
      if(s > this.dHi) this.dHi = s;
    }
    while(ch.np > need){ used[ch.pages[--ch.np]] = 0; this.free++; }
    ch.shown = want;
  },

  // wet grass is darker: weather.js's eased wetness (0..1)
  wet(wv){
    if(this.mat) this.mat.color.setScalar(1 - Math.min(1, Math.max(0, wv)) * 0.24);
  },

  dispose(){
    if(this.mesh){ if(this.mesh.parent) this.mesh.parent.remove(this.mesh); this.mesh.dispose(); }
    if(this.geo) this.geo.dispose();
    if(this.mat) this.mat.dispose();
    this.mesh = this.geo = this.mat = this.rank = null; this.T = null; this.runsC = null; this.grid = null; this.others = null;
    this.chunks.clear(); this.pool.clear(); this.pooled = 0; this.live.length = 0; this.shown.length = 0; this.pageUsed.fill(0); this.free = NP; this.frameNo = 0;
  },

  gkey(cx, cy){ return cx * 65536 + cy; },
  now: typeof performance !== "undefined" ? () => performance.now() : () => Date.now(),
  byDist:(A, B) => GRASS.live[A * 3 + 2] - GRASS.live[B * 3 + 2],
  loc:{ i:0, off:0, al:0 }, scr:new Float32Array(10 * 4096), bk:new Int32Array(257), c:new THREE.Color(), genEnd:0,
  ntab:(() => { const t = new Float32Array(64 * 64); for(let k = 0; k < t.length; k++) t[k] = hash(k & 63, k >> 6, 7) / 4294967296; return t; })(),
};

export { GRASS };
