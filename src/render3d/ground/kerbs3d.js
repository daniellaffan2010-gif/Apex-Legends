import * as THREE from 'three';
import { FIELD, LIFT } from './field.js';
import { kerbProfile, rib, KW, SAUS0, SAUS1, RIB_H, RIB_P, SAUS_H } from '../../tracks/kerbs.js';

/* ---- the kerbs, as solid things ----------------------------------------------------
   Built from the same data the physics rattles on (T.kerbL / T.kerbR and the profile in
   tracks/kerbs.js), so the kerb a car is shaken by is the kerb that is drawn:
     - flat kerbs (1): a painted slab a centimetre proud, rounded into the road;
     - ridged kerbs (2, 3): the serrated F1 kerb, rising to 25 mm with the 12 mm
       sawtooth ribs across it, the paint changing at a rib;
     - sausage kerbs (3): the 10 cm half-round yellow hump behind the kerb, black
       chevrons on it, tapered into the ground at each end.
   Every piece is closed: a skirt down to the run-off at the road edge and the outer
   edge, and a face across each end of a run, so nothing reads as paper from the
   cockpit at 0.74 m or from the side.

   Why not FIELD.ribbon: it samples along the lap at a fixed step, and a sawtooth is
   only drawn exactly by a row at each trough and each crest (two rows per 0.6 m rib).
   A fixed step either misses crests (ribs that beat in and out of existence along a
   kerb) or costs three times the triangles. So the rows are placed by hand here, but
   every point is laid by the same rule as FIELD.ribbon (FIELD.baseZ, the same offset
   clamp past a corner's centre, the same interpolation between nodes), so the kerb
   sits on exactly the surface the rest of the ground does.

   The colour blocks are 1.2 m, two ribs: a real kerb is moulded in sections and the
   paint changes at a trough, which is what this does. 1.2 m is about 8 px from the
   overhead camera (7 px a metre), enough that the alternation reads cleanly instead of
   shimmering; from the cockpit a block close by is a clear stripe, and further off the
   shader eases the two colours into their mean before they turn into moire (see far).

   One material for all of it (vertex colours), merged into at most 12 chunks along the
   lap so the frustum can drop the kerbs behind the camera. */
const BLOCK = 2 * RIB_P;                  // metres of one colour along the lap
const CREST = 0.7 * RIB_P;                // where in a rib its crest is (rib() rises over 0.7 of it)
const SKIRT = LIFT.runoff - 0.01;         // how far down the skirts reach: just under the run-off
const MAXCH = 12;                         // the draw-call budget
// lateral rows, metres out from the road edge: the rounded rise, the ribs' fade in and out, the drop
const U_RIDGED = [0, 0.2, 0.42, 1.28, 1.48, KW + 0.05];
const U_FLAT = [0, 0.035, KW - 0.02, KW + 0.05];
const SAUS_LANES = 6, SAUS_TAPER = 1.0, SAUS_PERIOD = 1.0, SAUS_BLACK = 0.4, CHEVRON = 0.22;
const YELLOW = "#F2C318", BLACK = "#1B1B1D";

function sm(x){ x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); }
/* the kerb's height above the road plane for a kind, u out from the road edge, s along:
   kerbs.js's kerbHr, with the kind given rather than read from a node, so a segment can
   blend from one kind to the next instead of stepping */
function kerbAt(kind, u, s){
  let h = kerbProfile(kind, u);
  if(kind >= 2 && u > 0.25 && u < KW - 0.05) h += RIB_H * rib(s) * sm((u - 0.25) / 0.2) * sm((KW - 0.05 - u) / 0.2);
  return h;
}

/* A chunk's arrays. Triangles are wound by the direction they should face (up for a top,
   out for a skirt, along the lap for an end), so FrontSide is right everywhere without
   reasoning about the game-to-three mirror. */
function Chunk(){ this.pos = []; this.col = []; this.far = []; this.idx = []; this.v = 0; this.s0 = 0; }
Chunk.prototype.vert = function(p, c, f){
  this.pos.push(p[0], p[2], p[1]);                           // game (x, y, z) -> three (x, z, y)
  this.col.push(c.r, c.g, c.b); this.far.push(f.r, f.g, f.b);
  return this.v++;
};
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _n = new THREE.Vector3();
Chunk.prototype.tri = function(a, b, c, dx, dy, dz){
  const P = this.pos;
  _a.set(P[b * 3] - P[a * 3], P[b * 3 + 1] - P[a * 3 + 1], P[b * 3 + 2] - P[a * 3 + 2]);
  _b.set(P[c * 3] - P[a * 3], P[c * 3 + 1] - P[a * 3 + 1], P[c * 3 + 2] - P[a * 3 + 2]);
  _n.crossVectors(_a, _b);
  if(_n.lengthSq() < 1e-14) return;                          // collapsed past a corner's centre
  if(_n.x * dx + _n.y * dy + _n.z * dz < 0) this.idx.push(a, c, b); else this.idx.push(a, b, c);
};
// a quad a-b-c-d (in order round it) facing direction d (three coordinates)
Chunk.prototype.quad = function(a, b, c, d, dx, dy, dz){ this.tri(a, b, c, dx, dy, dz); this.tri(a, c, d, dx, dy, dz); };
Chunk.prototype.geometry = function(){
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
  g.setAttribute("kfar", new THREE.Float32BufferAttribute(this.far, 3));
  g.setIndex(this.idx);
  g.computeVertexNormals(); g.computeBoundingSphere();
  return g;
};

/* a point on the surface a fraction f from node k0 to k1 at offset off: FIELD.ribbon's own
   rule, returning game x, y and the road surface height there (no lift) */
function at(T, k0, k1, f, off, out){
  const c0 = T.curv[k0], c1 = T.curv[k1];
  const o0 = c0 && off * c0 > 0.80 ? 0.80 / c0 : off, o1 = c1 && off * c1 > 0.80 ? 0.80 / c1 : off;
  out[0] = (T.x[k0] + T.nx[k0] * o0) * (1 - f) + (T.x[k1] + T.nx[k1] * o1) * f;
  out[1] = (T.y[k0] + T.ny[k0] * o0) * (1 - f) + (T.y[k1] + T.ny[k1] * o1) * f;
  out[2] = FIELD.baseZ(T, k0, off) * (1 - f) + FIELD.baseZ(T, k1, off) * f;
  return out;
}
// the same by metres along the lap
function atS(T, s, off, out){
  const n = T.n, q = s / T.ds, k = Math.floor(q), f = q - k, k0 = ((k % n) + n) % n;
  return at(T, k0, (k0 + 1) % n, f, off, out);
}

const KERBS3D = {
  mat:null, ownMat:false, group:null, stats:null,

  material(){
    if(this.mat) return this.mat;
    const m = new THREE.MeshStandardMaterial({ vertexColors:true, roughness:0.62, metalness:0 });
    m.userData.dry = { r:0.62 };
    /* Far away the 1.2 m blocks get smaller than a pixel (and much sooner in the cockpit,
       where the kerb is seen almost edge-on), and alternating colours under a pixel
       crawl. So in a perspective view each vertex eases from its own colour to the
       mean of its pair (kfar) as the blocks shrink: kd is the half-height of the view at
       that depth, and the ease runs from 12 to 35 m of it (about 22 to 65 m away in the
       cockpit, further for the narrower TV lenses). The overhead camera is orthographic, the blocks
       are 8 px there at any distance, and it keeps them. */
    m.onBeforeCompile = sh => {
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nattribute vec3 kfar;")
        .replace("#include <project_vertex>", `#include <project_vertex>
  #ifdef USE_COLOR
  if(projectionMatrix[2][3] == -1.0){
    float kd = -mvPosition.z / projectionMatrix[1][1];
    vColor.xyz = mix(vColor.xyz, kfar, smoothstep(12.0, 35.0, kd));
  }
  #endif`);
    };
    m.customProgramCacheKey = () => "kerbs3d";
    this.mat = m; this.ownMat = true;
    return m;
  },

  /* G3, the track, its palette; mat optionally a material from the materials module
     (it must take vertex colours). Returns a group of at most 12 meshes. */
  build(G3, T, P, mat){
    this.dispose();
    const n = T.n, ds = T.ds, lap = n * ds;
    if(mat){ this.mat = mat; this.ownMat = false; }
    const material = this.material();
    const cA = G3.col(P.kerbA || "#D8352A"), cB = G3.col(P.kerbB || "#EDEDED");
    const cMid = cA.clone().lerp(cB, 0.5);
    const cY = G3.col(YELLOW), cK = G3.col(BLACK);
    const cYmid = cY.clone().lerp(cK, SAUS_BLACK / SAUS_PERIOD);
    const items = [];            // { s0, build(chunk) }, gathered first so chunks can be cut along the lap
    const tmp = [0, 0, 0], col = new THREE.Color(), far = new THREE.Color();

    for(const sd of [1, -1]){
      const A = sd > 0 ? T.kerbR : T.kerbL;
      if(!A) continue;
      // the first node that starts a run, so a run across the start line stays whole
      let start = -1;
      for(let i = 0; i < n; i++) if(A[i] && !A[(i - 1 + n) % n]){ start = i; break; }
      if(start < 0) continue;
      const runs = [];
      for(let q = 0; q < n; q++){
        const i = (start + q) % n;
        if(!A[i]) continue;
        if(!A[(i - 1 + n) % n] || !runs.length) runs.push([]);
        runs[runs.length - 1].push(i);
      }
      for(const run of runs){
        items.push({ s0:run[0] * ds, make:ch => this.kerbRun(T, ch, run, A, sd, cA, cB, cMid, tmp, col, far) });
        // the sausage behind, where the run has kind 3
        let sr = null;
        const flush = () => { if(sr){ const r = sr; items.push({ s0:r[0] * ds, make:ch => this.sausage(T, ch, r, sd, cY, cK, cYmid, tmp, col, far) }); sr = null; } };
        for(const i of run){ if(A[i] === 3){ (sr = sr || []).push(i); } else flush(); }
        flush();
      }
    }

    // cut the lap into chunks: a new one when the current spans more than a twelfth of the lap (250 m at least)
    items.sort((a, b) => a.s0 - b.s0);
    const span = Math.max(250, lap / (MAXCH - 1));
    const chunks = [];
    for(const it of items){
      let ch = chunks[chunks.length - 1];
      if(!ch || it.s0 - ch.s0 > span){ ch = new Chunk(); ch.s0 = it.s0; chunks.push(ch); }
      it.make(ch);
    }
    const g = new THREE.Group(); g.name = "kerbs3d";
    let tris = 0, verts = 0;
    for(const ch of chunks){
      if(!ch.idx.length) continue;
      const m = new THREE.Mesh(ch.geometry(), material);
      m.name = "kerbs3d"; m.receiveShadow = true; m.castShadow = false; m.userData.noSplit = true;
      tris += ch.idx.length / 3; verts += ch.v;
      g.add(m);
    }
    this.group = g;
    this.stats = { meshes:g.children.length, tris, verts, runs:items.length };
    return g;
  },

  /* one run of kerb on one side: segments run[k] -> run[k] + 1 */
  kerbRun(T, ch, run, A, sd, cA, cB, cMid, p, col, far){
    const n = T.n, ds = T.ds, half = T.half;
    const last = run.length - 1;
    let firstRow = null, lastRow = null;
    for(let r = 0; r <= last; r++){
      const i = run[r], j = (i + 1) % n;
      const kA = A[i], kB = A[j] || kA;                      // the end of a run keeps its height to the end node, then a face closes it
      const rid = Math.max(kA, kB) >= 2;
      const Ui = rid ? U_RIDGED : U_FLAT;
      const s0 = i * ds, s1 = s0 + ds;
      // the rows along: each trough and crest of the ribs (or each block edge on a flat kerb)
      const rows = [s0];
      const step = rid ? RIB_P : BLOCK;
      for(let m = Math.ceil(s0 / step - 1e-9); m * step < s1; m++){
        for(const d of (rid ? [0, CREST] : [0])){
          const s = m * step + d;
          if(s > s0 + 0.03 && s < s1 - 0.03) rows.push(s);
        }
      }
      rows.push(s1);
      // pieces between rows, each with its own vertices so a rib face and a colour block keep hard edges
      for(let q = 0; q < rows.length - 1; q++){
        const sa = rows[q], sb = rows[q + 1], mid = (sa + sb) / 2;
        const blk = Math.floor(mid / BLOCK) & 1;
        const base = blk ? cB : cA;
        // the steep back of each rib a little darker, as moulded kerbs read
        const ph = ((mid / RIB_P) % 1 + 1) % 1, steep = rid && ph > 0.7 ? 0.84 : 1;
        const v0 = ch.v;
        for(const s of [sa, sb]){
          const f = (s - s0) / ds;
          for(let c = 0; c < Ui.length; c++){
            const u = Ui[c], off = sd * (half + u);
            at(T, i, j, f, off, p);
            p[2] += LIFT.kerb + kerbAt(kA, u, s) * (1 - f) + kerbAt(kB, u, s) * f;
            // the inner edge carries the rubber the cars leave on it
            const rub = u < 0.1 ? 0.8 : u < 0.3 ? 0.92 : 1;
            col.copy(base).multiplyScalar(steep * rub); far.copy(cMid).multiplyScalar(rub);
            ch.vert(p, col, far);
          }
        }
        const W = Ui.length;
        for(let c = 0; c < W - 1; c++) ch.quad(v0 + c, v0 + c + 1, v0 + W + c + 1, v0 + W + c, 0, 1, 0);
      }
      // the skirts at the road edge and the outer edge: the top edges there are straight between
      // the nodes (no ribs at either), so one quad per segment covers them
      for(const [u, outward] of [[Ui[0], -1], [Ui[Ui.length - 1], 1]]){
        const off = sd * (half + u), v0 = ch.v;
        for(const f of [0, 1]){
          const s = f ? s1 : s0;
          at(T, i, j, f, off, p);
          const zb = p[2];
          p[2] = zb + LIFT.kerb + (f ? kerbAt(kB, u, s) : kerbAt(kA, u, s));
          col.copy(cMid).multiplyScalar(0.55); far.copy(col);
          ch.vert(p, col, far);
          p[2] = zb + SKIRT; ch.vert(p, col, far);
        }
        const dir = sd * outward, nx = T.nx[i] * dir, ny = T.ny[i] * dir;
        ch.quad(v0, v0 + 1, v0 + 3, v0 + 2, nx, 0, ny);
      }
      if(r === 0) firstRow = { i, j, f:0, kind:kA, s:s0, U:Ui };
      if(r === last) lastRow = { i, j, f:1, kind:kB, s:s1, U:Ui };
    }
    // a face across each end of the run, from the profile down to the run-off
    for(const [R, fwd] of [[firstRow, -1], [lastRow, 1]]){
      if(!R) continue;
      const v0 = ch.v, W = R.U.length;
      col.copy(cMid).multiplyScalar(0.6); far.copy(col);
      for(const u of R.U){
        const off = sd * (half + u);
        at(T, R.i, R.j, R.f, off, p);
        const zb = p[2];
        p[2] = zb + LIFT.kerb + kerbAt(R.kind, u, R.s); ch.vert(p, col, far);
        p[2] = zb + SKIRT; ch.vert(p, col, far);
      }
      const k = R.f ? R.j : R.i, tx = T.tx[k] * fwd, ty = T.ty[k] * fwd;
      for(let c = 0; c < W - 1; c++) ch.quad(v0 + c * 2, v0 + c * 2 + 2, v0 + c * 2 + 3, v0 + c * 2 + 1, tx, 0, ty);
    }
  },

  /* the sausage kerb behind a run of kind 3 nodes: a half-round hump SAUS0..SAUS1 out from
     the road edge, tapered to nothing over its last metre at each end, yellow with black
     chevrons pointing along the lap */
  sausage(T, ch, sr, sd, cY, cK, cYmid, p, col, far){
    const ds = T.ds, half = T.half;
    const sS = sr[0] * ds, sE = (sr[sr.length - 1] + 1) * ds;
    if(sE - sS < 2 * SAUS_TAPER + 0.2) return;
    const env = s => sm(Math.min(s - sS, sE - s) / SAUS_TAPER);
    // the cross-section: lanes evenly round the half circle
    const T_ = [];
    for(let k = 0; k <= SAUS_LANES; k++) T_.push((1 - Math.cos(Math.PI * k / SAUS_LANES)) / 2);
    // where the chevron's stripe edge sits for a lane: a V, its point at the crown
    const chev = t => CHEVRON * Math.abs(2 * t - 1);
    // the stripe edges, plus extra rows through the tapers so they curve
    const cuts = new Set([sS, sE]);
    for(let m = Math.ceil(sS / SAUS_PERIOD); m * SAUS_PERIOD < sE; m++){
      cuts.add(m * SAUS_PERIOD); cuts.add(m * SAUS_PERIOD + SAUS_PERIOD - SAUS_BLACK);
    }
    for(const d of [0.3, 0.6]){ cuts.add(sS + d); cuts.add(sE - d); }
    const rows = [...cuts].filter(s => s >= sS && s <= sE).sort((a, b) => a - b).filter((s, k, a) => !k || s - a[k - 1] > 0.04);
    if(rows[rows.length - 1] !== sE) rows[rows.length - 1] = sE;
    const W = T_.length;
    const H = (s, t) => LIFT.kerb + SAUS_H * Math.sqrt(Math.max(0, 1 - (2 * t - 1) ** 2)) * env(s);
    const rowS = (s, t) => (s <= sS || s >= sE) ? s : Math.min(sE, Math.max(sS, s + chev(t)));
    for(let q = 0; q < rows.length - 1; q++){
      const sa = rows[q], sb = rows[q + 1], mid = (sa + sb) / 2;
      const ph = ((mid / SAUS_PERIOD) % 1 + 1) % 1;
      const base = ph >= (SAUS_PERIOD - SAUS_BLACK) / SAUS_PERIOD ? cK : cY;
      const v0 = ch.v;
      for(const s of [sa, sb]){
        for(const t of T_){
          const ss = rowS(s, t), off = sd * (half + SAUS0 + (SAUS1 - SAUS0) * t);
          atS(T, ss, off, p); p[2] += H(ss, t);
          col.copy(base); far.copy(cYmid);
          ch.vert(p, col, far);
        }
      }
      for(let c = 0; c < W - 1; c++) ch.quad(v0 + c, v0 + c + 1, v0 + W + c + 1, v0 + W + c, 0, 1, 0);
    }
    // skirts along both feet, piece by piece (the feet sit on straight node chords)
    for(const [t, outward] of [[0, -1], [1, 1]]){
      const off = sd * (half + SAUS0 + (SAUS1 - SAUS0) * t);
      col.copy(cK).lerp(cY, 0.3); far.copy(col);
      const v0 = ch.v, feet = [];
      for(let k = sr[0]; k <= sr[sr.length - 1] + 1; k++) feet.push(k * ds);
      for(const s of feet){
        atS(T, s, off, p); const zb = p[2];
        p[2] = zb + LIFT.kerb; ch.vert(p, col, far);
        p[2] = zb + SKIRT; ch.vert(p, col, far);
      }
      const dir = sd * outward;
      for(let k = 0; k < feet.length - 1; k++){
        const kk = (sr[0] + k) % T.n, nnx = T.nx[kk] * dir, nny = T.ny[kk] * dir;
        ch.quad(v0 + k * 2, v0 + k * 2 + 2, v0 + k * 2 + 3, v0 + k * 2 + 1, nnx, 0, nny);
      }
    }
    // the ends: the taper has brought the hump down to the kerb's lift; close the 3 cm under it
    for(const [s, fwd] of [[sS, -1], [sE, 1]]){
      const v0 = ch.v;
      col.copy(cK).lerp(cY, 0.3); far.copy(col);
      for(const t of T_){
        atS(T, s, sd * (half + SAUS0 + (SAUS1 - SAUS0) * t), p); const zb = p[2];
        p[2] = zb + H(s, t); ch.vert(p, col, far);
        p[2] = zb + SKIRT; ch.vert(p, col, far);
      }
      const k = ((Math.round(s / ds) % T.n) + T.n) % T.n, tx = T.tx[k] * fwd, ty = T.ty[k] * fwd;
      for(let c = 0; c < W - 1; c++) ch.quad(v0 + c * 2, v0 + c * 2 + 2, v0 + c * 2 + 3, v0 + c * 2 + 1, tx, 0, ty);
    }
  },

  /* wv 0..1 (G3.wetVis): wet paint goes dark and glossy, and slippery-looking. Roughness
     stays above what G3.applyEnv would give an environment map at build time (it reads
     the dry value), so getting wet costs nothing but the uniform. */
  wet(wv){
    const m = this.mat; if(!m || !this.ownMat) return;
    const w = Math.min(1, Math.max(0, wv || 0));
    m.roughness = m.userData.dry.r - 0.34 * w;
    m.color.setScalar(1 - 0.28 * w);
  },

  dispose(){
    if(this.group){
      for(const o of this.group.children) if(o.geometry) o.geometry.dispose();
      if(this.group.parent) this.group.parent.remove(this.group);
      this.group = null;
    }
    if(this.mat && this.ownMat) this.mat.dispose();
    this.mat = null; this.ownMat = false;
  },
};

export { KERBS3D, kerbAt, BLOCK };
