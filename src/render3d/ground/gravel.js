import * as THREE from 'three';
import { FIELD } from './field.js';

/* ---- gravel traps that are made of gravel ------------------------------------
   The trap's texture reads as gravel from the overhead camera, where a stone is
   a seventh of a pixel. From the driver's eye, three-quarters of a metre off the
   ground, it reads as a beige carpet. Three things put the stones back:

   (a) The bed. Real little stones, eight triangles each, on the trap in front of
       the cockpit lens and thinning out with distance, where they would be less
       than a pixel anyway. Each piece of trap (a patch: a quarter of a node long,
       two metres across) owns a fixed list of stones drawn from a hash of its
       number, so they never swim; nearer patches simply show more of their list,
       and each stone grows in from nothing as it joins, so the edge of the
       detail is never a line that pops. Stones sit a third sunk into the surface
       FIELD says is there. Off in the overhead view, where nobody could see it.
   (b) The spray. A car in the trap ploughs it: stones thrown up and out from the
       wheels, flying under gravity, bouncing once or twice and coming to rest,
       then settling into the bed; fine sand that hangs a little longer; and a
       low cloud of dust that drifts off with the wind. Fixed pools, packed so a
       frame only touches the live ones, the oldest overwritten when one fills.
   (c) The wind. Even with nobody in it, a trap is never quite still: fine grains
       skitter across it in gusts, and in a strong gust a faint wisp of dust
       lifts off it. A wet trap does neither, and its stones go dark.

   Four draw calls in all: the bed, the thrown stones, the grains (thrown and
   blown share one mesh) and the dust (points with a soft round falloff). Every
   InstancedMesh has its own material and always has instance colours (the
   shared-material pitfall in three r128). Nothing in frame() allocates.

   Coordinates: game (x, y, z up) is three (x, z, y), as everywhere else. */

const BED_MAX = 4500, STONE_MAX = 1200, GRAIN_MAX = 2400, WIND_MAX = 400, DUST_MAX = 400;
const SPRAY_GRAINS = GRAIN_MAX - WIND_MAX;
const PATCH_W = 2, PATCH_SUB = 4, MAXP = 256;     // a patch: 2 m across, a quarter of a node along, at most 256 stones
const AHEAD = 12;      // metres: the cockpit's view centre is this far ahead of the car, so the eye is this far behind it
const RB = 28;         // the bed reaches this far from the eye
const D0 = 64, DR = 4; // stones per square metre under the eye, and the distance at which that has halved
const RI = 90;         // in the overhead view, the reach for wisps and the spray (it sees about this far)
const GRAV = 9.81;
const NROT = 64;       // orientations: the first 64 lie flat-ish (a stone at rest), the next 64 are any way up (tumbling)

// an integer hash, and a float in 0..1 from it
function hash(a){
  a |= 0;
  a = Math.imul(a ^ (a >>> 16), 0x7feb352d);
  a = Math.imul(a ^ (a >>> 15), 0x846ca68b);
  return (a ^ (a >>> 16)) >>> 0;
}
const U = a => hash(a) * 2.3283064365386963e-10;
// a cheap random for the spray, where determinism does not matter but allocation does
let rs = 0x2545F491;
function rnd(){ rs ^= rs << 13; rs ^= rs >>> 17; rs ^= rs << 5; return (rs >>> 0) * 2.3283064365386963e-10; }
const sm = x => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/* Bed stones per square metre at (dx, dy) from the eye, heading (hx, hy): thick
   underfoot and halving by 4 m, only inside the lens's cone (with room for the
   head's look into a corner), and fading to nothing at the bed's reach. */
function dens(dx, dy, hx, hy){
  const a = dx * hx + dy * hy;
  if(a < -1.5) return 0;
  const l = Math.abs(dy * hx - dx * hy), d2 = dx * dx + dy * dy;
  if(d2 > RB * RB) return 0;
  const cone = sm((a * 1.15 + 2.5 - l) * 0.4);
  if(cone <= 0) return 0;
  return D0 / (1 + d2 / (DR * DR)) * cone * (1 - sm((Math.sqrt(d2) - RB + 8) * 0.125));
}

/* The height of the drawn surface under a point, exactly as FIELD.zAtXY has it,
   without the object FIELD.locate returns: this runs for hundreds of particles a
   frame. Leaves the node and what is on top there in ZI and ZK. */
let ZI = 0, ZK = "none";
function zxy(T, x, y, hint){
  const i = T.near(x, y, hint), dx = x - T.x[i], dy = y - T.y[i];
  const off = dx * T.nx[i] + dy * T.ny[i], al = dx * T.tx[i] + dy * T.ty[i], n = T.n;
  const j = (i + (al >= 0 ? 1 : n - 1)) % n, f = Math.min(Math.abs(al) / T.ds, 1);
  ZI = i; ZK = FIELD.kindAt(T, i, off);
  return FIELD.zAt(T, i, off) * (1 - f) + FIELD.zAt(T, j, off) * f;
}

/* A small pebble: an octahedron with its corners pushed in and out and squashed
   flat, so with a random turn and stretch no two look alike. Non-indexed, so its
   faces stay faceted under smooth shading too. */
function stoneGeo(){
  const g = new THREE.OctahedronGeometry(1, 0), p = g.attributes.position;
  for(let k = 0; k < p.count; k++){
    const x = p.getX(k), y = p.getY(k), z = p.getZ(k);
    const key = Math.round(x * 3 + 7) * 31 + Math.round(y * 3 + 7) * 7 + Math.round(z * 3 + 7);
    const r = 0.78 + 0.36 * U(key * 13 + 5);
    p.setXYZ(k, x * r * 1.12, y * r * 0.70, z * r * 0.94);
  }
  g.computeVertexNormals(); g.computeBoundingSphere();
  return g;
}

const GRAVEL = {
  on:false, AHEAD,

  build(G3, S){
    this.dispose();
    const T = S.track;
    if(!T || !T.surfAt || !G3.world) return;
    this.T = T;
    const n = T.n;

    /* Where the gravel is, per node and side: the run of offsets FIELD calls gravel,
       a little inside its edges (a stone on the edge of the trap's texture looks
       spilt), as distances out from the centre line. */
    const ua = new Float32Array(n * 2).fill(-1), ub = new Float32Array(n * 2).fill(-1);
    let any = false;
    for(let i = 0; i < n; i++){
      for(let sd = 0; sd < 2; sd++){
        const sg = sd ? 1 : -1, ro = sd ? T.roR[i] : T.roL[i];
        let a = -1, b = -1;
        for(let u = T.half; u <= T.half + ro + 0.3; u += 0.2){
          if(FIELD.kindAt(T, i, sg * u) === "gravel"){ if(a < 0) a = u; b = u; }
        }
        if(a >= 0 && b - a > 0.6){ ua[i * 2 + sd] = a + 0.12; ub[i * 2 + sd] = b - 0.12; any = true; }
      }
    }
    if(!any) return;
    this.ua = ua; this.ub = ub;

    /* The patches. A segment (node i to i+1) of trap is cut into lanes 2 m across
       and four pieces along, laid like FIELD.ribbon lays its quads, and each piece's
       corners are kept with their drawn height, so a stone's place is a bilinear
       blend of four stored points and never a search. Where the trap ends at node
       i+1, the piece takes node i's run at both ends, as the drawn band does. */
    const P = (k0, k1, f, off, out, o3) => {
      const c0 = T.curv[k0], c1 = T.curv[k1];
      const o0 = c0 && off * c0 > 0.80 ? 0.80 / c0 : off, o1 = c1 && off * c1 > 0.80 ? 0.80 / c1 : off;
      out[o3] = (T.x[k0] + T.nx[k0] * o0) * (1 - f) + (T.x[k1] + T.nx[k1] * o1) * f;
      out[o3 + 1] = (T.y[k0] + T.ny[k0] * o0) * (1 - f) + (T.y[k1] + T.ny[k1] * o1) * f;
      out[o3 + 2] = FIELD.zAt(T, k0, off) * (1 - f) + FIELD.zAt(T, k1, off) * f;
    };
    const pc = [], pa = [], pcx = [], pcy = [], pr = [], pn = [];
    const segN = [], segP0 = [], segP1 = [], segCx = [], segCy = [], segR = [];
    const tmp = new Float32Array(12);
    for(let i = 0; i < n; i++){
      const j = (i + 1) % n, first = pa.length;
      let sx = 0, sy = 0, cnt = 0;
      for(let sd = 0; sd < 2; sd++){
        const qi = i * 2 + sd, qj = j * 2 + sd;
        if(ua[qi] < 0) continue;
        let a0 = ua[qi], b0 = ub[qi], a1 = ua[qj], b1 = ub[qj];
        if(a1 < 0 || Math.abs(a1 - a0) > 6 || Math.abs(b1 - b0) > 6){ a1 = a0; b1 = b0; }
        const sg = sd ? 1 : -1, K = Math.max(1, Math.ceil(Math.max(b0 - a0, b1 - a1) / PATCH_W));
        for(let q = 0; q < PATCH_SUB; q++){
          const f0 = q / PATCH_SUB, f1 = (q + 1) / PATCH_SUB;
          for(let c = 0; c < K; c++){
            const A0 = a0 + (a1 - a0) * f0, B0 = b0 + (b1 - b0) * f0, A1 = a0 + (a1 - a0) * f1, B1 = b0 + (b1 - b0) * f1;
            P(i, j, f0, sg * (A0 + (B0 - A0) * c / K), tmp, 0);
            P(i, j, f0, sg * (A0 + (B0 - A0) * (c + 1) / K), tmp, 3);
            P(i, j, f1, sg * (A1 + (B1 - A1) * c / K), tmp, 6);
            P(i, j, f1, sg * (A1 + (B1 - A1) * (c + 1) / K), tmp, 9);
            for(let k = 0; k < 12; k++) pc.push(tmp[k]);
            // the area, as two triangles, and a circle round the four corners
            const ar = 0.5 * Math.abs((tmp[3] - tmp[0]) * (tmp[7] - tmp[1]) - (tmp[6] - tmp[0]) * (tmp[4] - tmp[1]))
                     + 0.5 * Math.abs((tmp[3] - tmp[9]) * (tmp[7] - tmp[10]) - (tmp[6] - tmp[9]) * (tmp[4] - tmp[10]));
            const cx = (tmp[0] + tmp[3] + tmp[6] + tmp[9]) / 4, cy = (tmp[1] + tmp[4] + tmp[7] + tmp[10]) / 4;
            let r = 0;
            for(let k = 0; k < 12; k += 3) r = Math.max(r, Math.hypot(tmp[k] - cx, tmp[k + 1] - cy));
            pa.push(ar); pcx.push(cx); pcy.push(cy); pr.push(r); pn.push(i);
            sx += cx; sy += cy; cnt++;
          }
        }
      }
      if(cnt){
        const cx = sx / cnt, cy = sy / cnt;
        let r = 0;
        for(let p = first; p < pa.length; p++) r = Math.max(r, Math.hypot(pcx[p] - cx, pcy[p] - cy) + pr[p]);
        segN.push(i); segP0.push(first); segP1.push(pa.length); segCx.push(cx); segCy.push(cy); segR.push(r);
      }
    }
    this.pc = new Float32Array(pc); this.pa = new Float32Array(pa); this.pcx = new Float32Array(pcx); this.pcy = new Float32Array(pcy);
    this.pr = new Float32Array(pr); this.pn = new Int32Array(pn);
    this.segN = new Int32Array(segN); this.segP0 = new Int32Array(segP0); this.segP1 = new Int32Array(segP1);
    this.segCx = new Float32Array(segCx); this.segCy = new Float32Array(segCy); this.segR = new Float32Array(segR);
    this.near = new Int32Array(segN.length); this.nearD = new Float32Array(segN.length); this.nNear = 0;
    this.actP = new Int32Array(4096); this.nAct = 0;

    /* Orientations, three-space 3x3 columns: lying ones (any heading, tipped up to
       25 degrees) for the bed and stones at rest, any-way-up ones for tumbling. */
    const ROT = this.ROT = new Float32Array(NROT * 2 * 9), m4 = new THREE.Matrix4(), e = new THREE.Euler(), q4 = new THREE.Quaternion();
    for(let k = 0; k < NROT * 2; k++){
      if(k < NROT) m4.makeRotationFromEuler(e.set((U(k * 3 + 1) - 0.5) * 0.85, U(k * 3 + 2) * Math.PI * 2, (U(k * 3 + 3) - 0.5) * 0.85, "YXZ"));
      else { q4.set(U(k * 5 + 1) - 0.5, U(k * 5 + 2) - 0.5, U(k * 5 + 3) - 0.5, U(k * 5 + 4) - 0.5).normalize(); m4.makeRotationFromQuaternion(q4); }
      const el = m4.elements;
      ROT.set([el[0], el[1], el[2], el[4], el[5], el[6], el[8], el[9], el[10]], k * 9);
    }

    /* The colours: the circuit's gravel tone and its neighbours, beige, grey,
       brown, a pale one and a dark one, the way a washed river gravel is. */
    const base = G3.col((T.pal && T.pal.gravel) || "#ADA38C");
    const tints = [[1.04,1.00,0.94],[0.92,0.93,0.96],[0.86,0.76,0.62],[1.18,1.15,1.08],[0.62,0.60,0.57],[1.00,0.88,0.74],
                   [0.80,0.80,0.80],[1.10,1.04,0.92],[0.74,0.68,0.60],[0.96,0.96,0.94],[1.06,0.94,0.80],[0.70,0.72,0.74]];
    const PAL = this.PAL = new Float32Array(tints.length * 3);
    tints.forEach((t, k) => { PAL[k * 3] = base.r * t[0]; PAL[k * 3 + 1] = base.g * t[1]; PAL[k * 3 + 2] = base.b * t[2]; });
    this.npal = tints.length;
    const sand = G3.col("#C9BC9C");
    this.sand = [sand.r, sand.g, sand.b];
    this.dustCol = new THREE.Color(base.r * 1.15, base.g * 1.12, base.b * 1.05).multiplyScalar(T.night ? 0.22 : 0.95);

    /* The meshes, each its own material. Stones are rough and plain (no
       environment map needed); the grains are Lambert, a pixel at most. */
    const mk = (geo, mat, max) => {
      const im = new THREE.InstancedMesh(geo, mat, max);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.setColorAt(0, new THREE.Color(1, 1, 1));               // sized to max now, before count drops
      im.instanceColor.setUsage(THREE.DynamicDrawUsage);
      im.count = 0; im.visible = false;
      im.frustumCulled = false; im.castShadow = false; im.receiveShadow = true;
      im.userData.dynamic = true; im.userData.noSplit = true;
      G3.world.add(im);
      return im;
    };
    this.geoS = stoneGeo();
    this.geoG = new THREE.TetrahedronGeometry(1, 0);
    this.matBed = new THREE.MeshStandardMaterial({ roughness:0.92, metalness:0, flatShading:true });
    this.matSpray = new THREE.MeshStandardMaterial({ roughness:0.92, metalness:0, flatShading:true });
    this.matGrain = new THREE.MeshLambertMaterial({});
    this.bed = mk(this.geoS, this.matBed, BED_MAX); this.bed.name = "gravel-bed";
    this.spray = mk(this.geoS, this.matSpray, STONE_MAX); this.spray.name = "gravel-spray";
    this.grain = mk(this.geoG, this.matGrain, GRAIN_MAX); this.grain.name = "gravel-grains"; this.grain.receiveShadow = false;

    /* The dust: points, sized in metres (so they shrink with distance and work
       for the orthographic camera too), soft round, depth-tested but not
       writing depth, so they never cut holes in each other. */
    const dg = new THREE.BufferGeometry();
    this.dPos = new Float32Array(DUST_MAX * 3); this.dSize = new Float32Array(DUST_MAX); this.dAl = new Float32Array(DUST_MAX);
    dg.setAttribute("position", new THREE.BufferAttribute(this.dPos, 3).setUsage(THREE.DynamicDrawUsage));
    dg.setAttribute("aSize", new THREE.BufferAttribute(this.dSize, 1).setUsage(THREE.DynamicDrawUsage));
    dg.setAttribute("aAlpha", new THREE.BufferAttribute(this.dAl, 1).setUsage(THREE.DynamicDrawUsage));
    dg.setDrawRange(0, 0);
    this.matDust = new THREE.ShaderMaterial({
      uniforms:THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uCol:{ value:this.dustCol.clone() }, uH:{ value:720 } }]),
      vertexShader:`
        attribute float aSize; attribute float aAlpha; uniform float uH; varying float vA;
        #include <fog_pars_vertex>
        void main(){
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          gl_PointSize = aSize * projectionMatrix[1][1] * uH * 0.5 / gl_Position.w;
          vA = aAlpha;
          #include <fog_vertex>
        }`,
      fragmentShader:`
        uniform vec3 uCol; varying float vA;
        #include <fog_pars_fragment>
        void main(){
          vec2 c = gl_PointCoord * 2.0 - 1.0; float r = dot(c, c);
          if(r > 1.0) discard;
          float a = vA * (1.0 - r) * (1.0 - r);
          gl_FragColor = vec4(uCol, a);
          #include <tonemapping_fragment>
          #include <encodings_fragment>
          #include <fog_fragment>
        }`,
      transparent:true, depthWrite:false, fog:true,
    });
    this.dust = new THREE.Points(dg, this.matDust);
    this.dust.frustumCulled = false; this.dust.visible = false; this.dust.userData.dynamic = true; this.dust.renderOrder = 2;
    this.dust.name = "gravel-dust";
    G3.world.add(this.dust);

    /* The pools, structure-of-arrays, packed: the live ones are [0, count). */
    const pool = N => ({ n:0, ring:0, x:new Float32Array(N), y:new Float32Array(N), z:new Float32Array(N),
      vx:new Float32Array(N), vy:new Float32Array(N), vz:new Float32Array(N), age:new Float32Array(N), t1:new Float32Array(N),
      r:new Float32Array(N), gz:new Float32Array(N), node:new Int32Array(N), rot:new Uint8Array(N), col:new Uint8Array(N),
      st:new Uint8Array(N), tick:new Uint8Array(N), N });
    this.S = pool(STONE_MAX);
    this.G = pool(GRAIN_MAX); this.nGS = 0; this.nGW = 0;
    this.G.lim = new Float32Array(GRAIN_MAX); this.G.dz = new Float32Array(GRAIN_MAX); this.G.dd = new Float32Array(GRAIN_MAX);
    this.D = pool(DUST_MAX); this.D.s0 = new Float32Array(DUST_MAX); this.D.s1 = new Float32Array(DUST_MAX); this.D.a0 = new Float32Array(DUST_MAX);
    this.acc = new Float32Array(64 * 3);
    this.windA = U(String(T.def && T.def.id || "x").length * 977 + n) * Math.PI * 2;
    this.windAcc = 0; this.wispAcc = 0;
    this.last = new Float32Array(5).fill(NaN);
    this.G3 = G3;
    this.on = true;
  },

  /* the wind over the traps: a slowly turning direction and gusts that come and
     go over a few seconds, both waves of the race clock so a pause holds them */
  wind(t){
    const a = this.windA + 0.5 * Math.sin(t * 0.031) + 0.25 * Math.sin(t * 0.077 + 1.0);
    const g = (0.5 + 0.5 * Math.sin(t * 0.21)) * (0.5 + 0.5 * Math.sin(t * 0.53 + 2.0));
    this.gust = Math.min(1, 0.15 + 1.4 * g);
    const sp = 0.4 + 2.4 * this.gust;
    this.wx = Math.cos(a) * sp; this.wy = Math.sin(a) * sp;
  },

  frame(G3, S, view){
    if(!this.on) return;
    const T = this.T;
    if(S.track !== T) return;
    const dt = Math.min(Math.max(view.dt || 0, 0), 0.05), t = S.clock || 0, fp = !!view.fp;
    const wet = G3.wetVis || 0;
    this.wind(t);
    const cx = view.x, cy = view.y;

    // the trap segments within reach, nearest first (an insertion sort: a handful of them)
    const reach = fp ? RB + AHEAD + 4 : RI;
    let nn = 0;
    for(let s = 0; s < this.segN.length; s++){
      const d = Math.hypot(this.segCx[s] - cx, this.segCy[s] - cy) - this.segR[s];
      if(d > reach) continue;
      let k = nn++;
      while(k > 0 && this.nearD[k - 1] > d){ this.near[k] = this.near[k - 1]; this.nearD[k] = this.nearD[k - 1]; k--; }
      this.near[k] = s; this.nearD[k] = d;
    }
    this.nNear = nn;

    if(dt > 0) this.emit(S, cx, cy, dt, wet);
    const busy = this.S.n || this.G.n || this.D.n;
    if(!nn && !busy){
      if(this.bed.visible || this.spray.visible || this.grain.visible || this.dust.visible){
        this.bed.visible = this.spray.visible = this.grain.visible = this.dust.visible = false;
        this.bed.count = this.spray.count = this.grain.count = 0;
      }
      return;
    }
    const wc = 1 - 0.42 * wet;                                   // wet gravel is darker
    if(Math.abs(this.matBed.color.r - wc) > 1e-3){ this.matBed.color.setScalar(wc); this.matSpray.color.setScalar(wc); this.matGrain.color.setScalar(wc); }

    this.bedFrame(fp, view, wet);
    if(dt > 0){ this.stepStones(T, dt); this.stepGrains(T, dt); this.stepDust(dt); }
    const iso = fp ? 1 : 2.5;
    this.drawPool(this.spray, this.S, iso, 0);
    this.drawPool(this.grain, this.G, fp ? 1 : 3.5, 1);
    this.drawDust(G3, fp);
  },

  /* (a) the bed in front of the cockpit lens. How many stones a patch shows is
     the density at its four corners, blended across it, so the per-stone work is
     a hash, a blend and a matrix. Rewritten only once the eye has moved 12 cm or
     turned a tenth of a degree: the stones are fixed in the world, so a bed a
     frame old is exactly the same bed. */
  bedFrame(fp, view, wet){
    const bed = this.bed;
    if(!fp || !this.nNear){ bed.count = 0; bed.visible = false; this.nAct = 0; this.last[0] = NaN; return; }
    const hx = view.hx, hy = view.hy, ex = view.x - hx * AHEAD, ey = view.y - hy * AHEAD;
    const L = this.last;
    if((L[0] - ex) * (L[0] - ex) + (L[1] - ey) * (L[1] - ey) < 0.0144 && Math.abs(L[2] - hx) + Math.abs(L[3] - hy) < 0.002){ bed.visible = bed.count > 0; return; }
    L[0] = ex; L[1] = ey; L[2] = hx; L[3] = hy;
    const M = bed.instanceMatrix.array, C = bed.instanceColor.array, ROT = this.ROT, PAL = this.PAL, pc = this.pc, npal = this.npal;
    let nb = 0, na = 0;
    for(let q = 0; q < this.nNear && nb < BED_MAX; q++){
      const s = this.near[q];
      for(let p = this.segP0[s]; p < this.segP1[s] && nb < BED_MAX; p++){
        const dxp = this.pcx[p] - ex, dyp = this.pcy[p] - ey, pr = this.pr[p];
        const dp = Math.sqrt(dxp * dxp + dyp * dyp);
        if(dp - pr > RB) continue;
        const ap = dxp * hx + dyp * hy, lp = Math.abs(dyp * hx - dxp * hy);
        if(ap + pr < -1.5 || lp - pr > (ap + pr) * 1.15 + 2.5) continue;
        const o = p * 12, area = this.pa[p];
        const x0 = pc[o], y0 = pc[o + 1], z0 = pc[o + 2], x1 = pc[o + 3], y1 = pc[o + 4], z1 = pc[o + 5];
        const x2 = pc[o + 6], y2 = pc[o + 7], z2 = pc[o + 8], x3 = pc[o + 9], y3 = pc[o + 10], z3 = pc[o + 11];
        const w0 = dens(x0 - ex, y0 - ey, hx, hy) * area, w1 = dens(x1 - ex, y1 - ey, hx, hy) * area;
        const w2 = dens(x2 - ex, y2 - ey, hx, hy) * area, w3 = dens(x3 - ex, y3 - ey, hx, hy) * area;
        const kmax = Math.min(MAXP, Math.ceil(Math.max(w0, w1, w2, w3)));
        if(kmax <= 0) continue;
        if(dp < 22 && na < this.actP.length) this.actP[na++] = p;
        const seed = Math.imul(p, 0x9E3779B1);
        for(let k = 0; k < kmax && nb < BED_MAX; k++){
          const h0 = hash(seed + k), u = (h0 & 0xffff) * 1.52587890625e-5, v = (h0 >>> 16) * 1.52587890625e-5;
          const wa = w0 + (w1 - w0) * v, wb = w2 + (w3 - w2) * v, w = wa + (wb - wa) * u - k;
          if(w <= 0) continue;
          const xa = x0 + (x1 - x0) * v, xb = x2 + (x3 - x2) * v;
          const ya = y0 + (y1 - y0) * v, yb = y2 + (y3 - y2) * v;
          const za = z0 + (z1 - z0) * v, zb = z2 + (z3 - z2) * v;
          /* one more hash for the rest: size (10 bits, squared so most are small),
             stretch on three axes (4 bits each), orientation (6), colour (4) */
          const h1 = hash(h0 ^ 0x27d4eb2d), fs = (h1 & 1023) * 9.775e-4;
          const r0 = (0.007 + 0.011 * fs * fs) * (k < 4 ? 1.6 : 1) * (w < 1 ? w : 1);
          const sx = r0 * (0.85 + ((h1 >>> 10) & 15) * 0.026), sy = r0 * (0.55 + ((h1 >>> 14) & 15) * 0.022), sz = r0 * (0.8 + ((h1 >>> 18) & 15) * 0.022);
          const ri = ((h1 >>> 22) & (NROT - 1)) * 9, mo = nb * 16;
          M[mo] = ROT[ri] * sx; M[mo + 1] = ROT[ri + 1] * sx; M[mo + 2] = ROT[ri + 2] * sx; M[mo + 3] = 0;
          M[mo + 4] = ROT[ri + 3] * sy; M[mo + 5] = ROT[ri + 4] * sy; M[mo + 6] = ROT[ri + 5] * sy; M[mo + 7] = 0;
          M[mo + 8] = ROT[ri + 6] * sz; M[mo + 9] = ROT[ri + 7] * sz; M[mo + 10] = ROT[ri + 8] * sz; M[mo + 11] = 0;
          // a third sunk: the centre a quarter of its height above the surface
          M[mo + 12] = xa + (xb - xa) * u; M[mo + 13] = za + (zb - za) * u + sy * 0.25; M[mo + 14] = ya + (yb - ya) * u; M[mo + 15] = 1;
          const ci = ((h1 >>> 28) % npal) * 3, br = 0.88 + (h0 & 31) * 0.0077, co = nb * 3;
          C[co] = PAL[ci] * br; C[co + 1] = PAL[ci + 1] * br; C[co + 2] = PAL[ci + 2] * br;
          nb++;
        }
      }
    }
    this.nAct = na;
    bed.count = nb; bed.visible = nb > 0;
    bed.instanceMatrix.needsUpdate = true; bed.instanceColor.needsUpdate = true;
  },

  /* (b) and (c): who is throwing gravel, and what the wind lifts */
  emit(S, cx, cy, dt, wet){
    const T = this.T, cars = S.cars || [];
    for(let ci = 0; ci < cars.length && ci < 64; ci++){
      const c = cars[ci];
      if(!c || c.recovering || c.recovered) continue;
      const sp = Math.hypot(c.vx || 0, c.vy || 0);
      if(sp < 1.5 || (c.air || 0) > 0.15){ this.acc[ci * 3] = this.acc[ci * 3 + 1] = this.acc[ci * 3 + 2] = 0; continue; }
      const ddx = c.x - cx, ddy = c.y - cy;
      if(ddx * ddx + ddy * ddy > 250 * 250) continue;
      if(FIELD.kindAt(T, c.node || 0, c.off || 0) !== "gravel") continue;
      const k = Math.min(1.6, Math.max(0.12, sp / 25));
      const a = this.acc, o = ci * 3;
      a[o] += dt * 240 * k; a[o + 1] += dt * 520 * k; a[o + 2] += dt * 18 * k * (1 - 0.8 * wet);
      if(a[o] < 1 && a[o + 1] < 1 && a[o + 2] < 1) continue;
      const gz = zxy(T, c.x, c.y, c.node || 0), node = ZI;
      const hx = Math.cos(c.h), hy = Math.sin(c.h), nx = -hy, ny = hx;
      // sliding sideways ploughs the gravel sideways: how much of the motion is across the car
      const vl = (c.vx * nx + c.vy * ny);
      while(a[o] >= 1 || a[o + 1] >= 1 || a[o + 2] >= 1){
        // a wheel: mostly the rear pair, which drive and dig
        const wr = rnd(), rear = wr < 0.65, sd = (wr * 1000 & 1) ? 1 : -1;
        const ax = rear ? -1.58 : 1.55, tw = rear ? 0.79 : 0.83;
        const px = c.x + hx * (ax + (rnd() - 0.5) * 0.3) + nx * sd * (tw + (rnd() - 0.5) * 0.3);
        const py = c.y + hy * (ax + (rnd() - 0.5) * 0.3) + ny * sd * (tw + (rnd() - 0.5) * 0.3);
        const carry = 0.15 + rnd() * 0.45, kick = (rear ? 0.6 + rnd() * 3.2 : rnd() * 1.2), side = 0.3 + rnd() * (1.6 + Math.abs(vl) * 0.08);
        const vx = c.vx * carry - hx * kick + nx * sd * side + (rnd() - 0.5) * 1.2;
        const vy = c.vy * carry - hy * kick + ny * sd * side + (rnd() - 0.5) * 1.2;
        const vz = (rear ? 1.0 : 0.6) + rnd() * (1.2 + sp * 0.07);
        if(a[o] >= 1){ a[o] -= 1; this.spawn(this.S, STONE_MAX, px, py, gz + 0.03, vx, vy, vz, gz, node, 0.007 + rnd() * 0.013); }
        if(a[o + 1] >= 1){
          a[o + 1] -= 1;
          // thrown sand has its own share of the pool, so it never pushes out the blown sand (or the other way)
          if(this.nGS < SPRAY_GRAINS){
            this.spawn(this.G, GRAIN_MAX, px, py, gz + 0.02, vx * 0.9 + (rnd() - 0.5) * 2, vy * 0.9 + (rnd() - 0.5) * 2, vz * (0.8 + rnd() * 0.6), gz, node, 0.0025 + rnd() * 0.003);
            this.nGS++;
          }
        }
        if(a[o + 2] >= 1){
          a[o + 2] -= 1;
          const D = this.D, i = this.spawn(D, DUST_MAX, px, py, gz + 0.15, c.vx * 0.22 + this.wx * 0.5 + (rnd() - 0.5), c.vy * 0.22 + this.wy * 0.5 + (rnd() - 0.5), 0.25 + rnd() * 0.6, gz, node, 0);
          D.t1[i] = 1.2 + rnd() * 1.6; D.s0[i] = 0.5 + rnd() * 0.4; D.s1[i] = 2.2 + rnd() * 1.6 + sp * 0.02; D.a0[i] = 0.22 + rnd() * 0.12;
        }
      }
    }

    /* (c) the wind. Grains in the cockpit view, picked off the patches of bed near
       the lens; wisps of dust in either view, off any trap nearby. */
    const dry = 1 - wet, g = this.gust;
    if(this.nAct && dry > 0.05){
      this.windAcc += dt * 220 * g * g * dry;
      while(this.windAcc >= 1){
        this.windAcc -= 1;
        if(this.nGW >= WIND_MAX) { this.windAcc = 0; break; }
        const p = this.actP[(rnd() * this.nAct) | 0], o = p * 12, pc = this.pc, u = rnd(), v = rnd();
        const x = (pc[o] + (pc[o + 3] - pc[o]) * v) * (1 - u) + (pc[o + 6] + (pc[o + 9] - pc[o + 6]) * v) * u;
        const y = (pc[o + 1] + (pc[o + 4] - pc[o + 1]) * v) * (1 - u) + (pc[o + 7] + (pc[o + 10] - pc[o + 7]) * v) * u;
        const z = (pc[o + 2] + (pc[o + 5] - pc[o + 2]) * v) * (1 - u) + (pc[o + 8] + (pc[o + 11] - pc[o + 8]) * v) * u;
        /* A blown grain runs in a straight line (the wind turns far too slowly to bend
           it in its few seconds), so look down that line once, now: how far it can go
           before the trap ends, and how the surface rises or falls on the way. It
           stops at the edge, where blown sand piles up, and never goes onto the
           grass or the tarmac. */
        const ws = Math.hypot(this.wx, this.wy) || 1, wa = (rnd() - 0.5) * 0.5, cw = Math.cos(wa), sw = Math.sin(wa);
        const dx = (this.wx * cw - this.wy * sw) / ws, dy = (this.wx * sw + this.wy * cw) / ws;
        let lim = 0, zl = z, hint = this.pn[p];
        for(let m = 0.2; m <= 2.4; m += 0.2){
          const zm = zxy(this.T, x + dx * m, y + dy * m, hint); hint = ZI;
          if(ZK !== "gravel") break;
          lim = m; zl = zm;
        }
        if(lim < 0.8) continue;
        lim -= 0.2;                                                   // short of the last good look, never past it
        const G = this.G, j = 0.6 + rnd() * 0.8;
        const i = this.spawn(G, GRAIN_MAX, x, y, z, dx * j, dy * j, 6 + rnd() * 10, z, this.pn[p], 0.0022 + rnd() * 0.0025);
        G.st[i] = 3; G.t1[i] = 1.0 + rnd() * 2.2;                     // vz: the hop rate, for a blown grain
        G.lim[i] = lim; G.dz[i] = (zl - z) / lim; G.dd[i] = 0;
        this.nGW++;
      }
    }
    if(this.nNear && dry > 0.05){
      this.wispAcc += dt * 2.2 * Math.max(0, g - 0.45) * dry * Math.min(4, this.nNear);
      while(this.wispAcc >= 1){
        this.wispAcc -= 1;
        const s = this.near[(rnd() * this.nNear) | 0], p = this.segP0[s] + ((rnd() * (this.segP1[s] - this.segP0[s])) | 0), o = p * 12;
        const D = this.D, z = this.pc[o + 2];
        const i = this.spawn(D, DUST_MAX, this.pcx[p], this.pcy[p], z + 0.1, this.wx * 0.9, this.wy * 0.9, 0.05 + rnd() * 0.15, z, this.pn[p], 0);
        D.t1[i] = 2.5 + rnd() * 2.5; D.s0[i] = 1.0 + rnd(); D.s1[i] = 3.5 + rnd() * 3; D.a0[i] = 0.07 + rnd() * 0.06;
        D.st[i] = 4;                                                  // a wisp of the wind's, not a car's
      }
    }
  },

  /* put a particle in a pool: at the end of the live ones, or over the oldest
     slot of the ring once it is full. Returns its index. */
  spawn(P, N, x, y, z, vx, vy, vz, gz, node, r){
    let i;
    if(P.n < N) i = P.n++;
    else { i = P.ring; P.ring = (P.ring + 1) % N; }              // (the grains keep their shares, so they never get here)
    P.x[i] = x; P.y[i] = y; P.z[i] = z; P.vx[i] = vx; P.vy[i] = vy; P.vz[i] = vz;
    P.age[i] = 0; P.t1[i] = 0; P.r[i] = r; P.gz[i] = gz; P.node[i] = node;
    P.rot[i] = (rnd() * 255) | 0; P.col[i] = (rnd() * 255) | 0; P.st[i] = 1; P.tick[i] = (rnd() * 255) | 0;
    return i;
  },
  kill(P, i){
    const j = --P.n;
    if(P === this.G){ if(P.st[i] === 3) this.nGW--; else this.nGS--; }
    if(i !== j){
      P.x[i] = P.x[j]; P.y[i] = P.y[j]; P.z[i] = P.z[j]; P.vx[i] = P.vx[j]; P.vy[i] = P.vy[j]; P.vz[i] = P.vz[j];
      P.age[i] = P.age[j]; P.t1[i] = P.t1[j]; P.r[i] = P.r[j]; P.gz[i] = P.gz[j]; P.node[i] = P.node[j];
      P.rot[i] = P.rot[j]; P.col[i] = P.col[j]; P.st[i] = P.st[j]; P.tick[i] = P.tick[j];
      if(P.s0){ P.s0[i] = P.s0[j]; P.s1[i] = P.s1[j]; P.a0[i] = P.a0[j]; }
      if(P.lim){ P.lim[i] = P.lim[j]; P.dz[i] = P.dz[j]; P.dd[i] = P.dd[j]; }
    }
    if(P.ring > P.n) P.ring = 0;
  },

  /* thrown stones: fly, bounce, lie a while, then settle into the bed */
  stepStones(T, dt){
    const P = this.S, dr = Math.exp(-0.25 * dt);
    for(let i = P.n - 1; i >= 0; i--){
      const age = (P.age[i] += dt);
      if(P.st[i] === 1){
        P.vz[i] -= GRAV * dt; P.vx[i] *= dr; P.vy[i] *= dr;
        P.x[i] += P.vx[i] * dt; P.y[i] += P.vy[i] * dt; P.z[i] += P.vz[i] * dt;
        // where it will land: looked up again every eighth frame on the way down (a trap is all but flat)
        if(P.vz[i] < 0 && (P.tick[i]++ & 7) === 0){ P.gz[i] = zxy(T, P.x[i], P.y[i], P.node[i]); P.node[i] = ZI; }
        const floor = P.gz[i] + P.r[i] * 0.3;
        if(P.z[i] < floor){
          P.z[i] = floor;
          if(P.vz[i] < -1.1){ P.vz[i] *= -0.32; P.vx[i] *= 0.5; P.vy[i] *= 0.5; }
          else { P.st[i] = 2; P.t1[i] = age; P.gz[i] = zxy(T, P.x[i], P.y[i], P.node[i]); P.z[i] = P.gz[i] + P.r[i] * 0.3; }
        }
        if(age > 6) this.kill(P, i);
      } else {
        // at rest for a second or two, then sinking into the bed over most of a second
        const f = (age - P.t1[i] - (1.2 + (P.col[i] & 7) * 0.2)) / 0.8;
        if(f >= 1){ this.kill(P, i); continue; }
        if(f > 0) P.z[i] = P.gz[i] + P.r[i] * (0.3 - 1.1 * f);
      }
    }
  },

  /* grains: thrown sand drops and is gone; blown sand hops along the trap */
  stepGrains(T, dt){
    const P = this.G, dr = Math.exp(-1.4 * dt);
    for(let i = P.n - 1; i >= 0; i--){
      const age = (P.age[i] += dt), st = P.st[i];
      if(st === 1){
        P.vz[i] -= GRAV * dt; P.vx[i] *= dr; P.vy[i] *= dr; P.vz[i] *= dr;
        P.x[i] += P.vx[i] * dt; P.y[i] += P.vy[i] * dt; P.z[i] += P.vz[i] * dt;
        // sand comes down within a metre or two of the wheel: the ground under the wheel will do
        if(P.z[i] < P.gz[i] + P.r[i] * 0.5){ P.z[i] = P.gz[i] + P.r[i] * 0.5; P.st[i] = 2; P.t1[i] = age; }
        if(age > 5) this.kill(P, i);
      } else if(st === 2){
        if(age - P.t1[i] > 0.35 + (P.col[i] & 7) * 0.06) this.kill(P, i);
      } else {
        // blown: along the wind with a little wander, in hops of a centimetre or two
        // blown: down its line at the wind's speed (times its own), in hops of a centimetre or two, until the edge
        const room = P.lim[i] - P.dd[i];
        let hop = 0;
        if(room > 0){
          // (vx, vy) is the line times this grain's own pace, so the distance gone is the step times that pace
          const j = Math.hypot(P.vx[i], P.vy[i]), step = Math.min(room, Math.hypot(this.wx, this.wy) * j * dt);
          P.x[i] += P.vx[i] / j * step; P.y[i] += P.vy[i] / j * step; P.dd[i] += step;
          hop = Math.abs(Math.sin(age * P.vz[i])) * (0.004 + 0.016 * this.gust);
        }
        P.z[i] = P.gz[i] + P.dz[i] * P.dd[i] + P.r[i] * 0.5 + hop;
        if(age > P.t1[i]) this.kill(P, i);
      }
    }
  },

  /* dust: rises a little, spreads, slows, drifts with the wind and thins out */
  stepDust(dt){
    const P = this.D, dr = Math.exp(-1.6 * dt);
    for(let i = P.n - 1; i >= 0; i--){
      const age = (P.age[i] += dt);
      if(age > P.t1[i]){ this.kill(P, i); continue; }
      P.vx[i] = P.vx[i] * dr + this.wx * (1 - dr); P.vy[i] = P.vy[i] * dr + this.wy * (1 - dr); P.vz[i] *= dr;
      P.x[i] += P.vx[i] * dt; P.y[i] += P.vy[i] * dt; P.z[i] += P.vz[i] * dt;
    }
  },

  /* the live particles of a pool into an instanced mesh */
  drawPool(im, P, scale, grains){
    const M = im.instanceMatrix.array, C = im.instanceColor.array, ROT = this.ROT, PAL = this.PAL, sand = this.sand;
    const n = P.n;
    for(let i = 0; i < n; i++){
      const st = P.st[i], age = P.age[i];
      let r = P.r[i] * scale;
      if(grains){
        if(st === 3) r *= Math.min(1, age / 0.15, (P.t1[i] - age) / 0.3);
        else if(st === 2) r *= Math.max(0, 1 - (age - P.t1[i]) / 0.6);
      } else if(st === 1 && age < 0.05) r *= age / 0.05;
      // tumbling in the air (a new random turn twenty times a second), lying flat at rest
      const ri = (st === 1 ? NROT + ((P.rot[i] + ((age * 20) | 0)) & (NROT - 1)) : (P.rot[i] & (NROT - 1))) * 9;
      const sx = r * 1.05, sy = grains ? r : r * 0.72, sz = r * 0.92, mo = i * 16;
      M[mo] = ROT[ri] * sx; M[mo + 1] = ROT[ri + 1] * sx; M[mo + 2] = ROT[ri + 2] * sx; M[mo + 3] = 0;
      M[mo + 4] = ROT[ri + 3] * sy; M[mo + 5] = ROT[ri + 4] * sy; M[mo + 6] = ROT[ri + 5] * sy; M[mo + 7] = 0;
      M[mo + 8] = ROT[ri + 6] * sz; M[mo + 9] = ROT[ri + 7] * sz; M[mo + 10] = ROT[ri + 8] * sz; M[mo + 11] = 0;
      M[mo + 12] = P.x[i]; M[mo + 13] = P.z[i]; M[mo + 14] = P.y[i]; M[mo + 15] = 1;
      if(grains){ const b = 0.85 + (P.col[i] & 31) / 31 * 0.3; C[i * 3] = sand[0] * b; C[i * 3 + 1] = sand[1] * b; C[i * 3 + 2] = sand[2] * b; }
      else { const ci = (P.col[i] % this.npal) * 3; C[i * 3] = PAL[ci]; C[i * 3 + 1] = PAL[ci + 1]; C[i * 3 + 2] = PAL[ci + 2]; }
    }
    if(n || im.count){ im.instanceMatrix.needsUpdate = true; im.instanceColor.needsUpdate = true; }
    im.count = n; im.visible = n > 0;
  },

  drawDust(G3, fp){
    const P = this.D, n = P.n, pos = this.dPos, sz = this.dSize, al = this.dAl;
    for(let i = 0; i < n; i++){
      const f = P.age[i] / P.t1[i];
      pos[i * 3] = P.x[i]; pos[i * 3 + 1] = P.z[i]; pos[i * 3 + 2] = P.y[i];
      sz[i] = (P.s0[i] + (P.s1[i] - P.s0[i]) * Math.sqrt(f)) * (fp ? 1 : 1.4);
      // in quickly, out slowly
      al[i] = P.a0[i] * Math.min(1, f / 0.08) * (1 - f) * (1 - f);
    }
    const g = this.dust.geometry;
    if(n || g.drawRange.count){
      g.attributes.position.needsUpdate = true; g.attributes.aSize.needsUpdate = true; g.attributes.aAlpha.needsUpdate = true;
    }
    g.setDrawRange(0, n);
    this.dust.visible = n > 0;
    const de = G3.rend && G3.rend.domElement;
    this.matDust.uniforms.uH.value = (de && de.height) || 720;
  },

  dispose(){
    for(const o of [this.bed, this.spray, this.grain, this.dust]) if(o && o.parent) o.parent.remove(o);
    for(const r of [this.geoS, this.geoG, this.dust && this.dust.geometry, this.matBed, this.matSpray, this.matGrain, this.matDust]) if(r) r.dispose();
    this.bed = this.spray = this.grain = this.dust = null;
    this.geoS = this.geoG = this.matBed = this.matSpray = this.matGrain = this.matDust = null;
    this.on = false; this.T = null; this.nNear = 0; this.nAct = 0;
  },
};

export { GRAVEL };
