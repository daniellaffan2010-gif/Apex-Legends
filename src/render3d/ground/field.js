import * as THREE from 'three';
import { bankZ } from '../../tracks/shared.js';

/* ---- the ground beside the circuit, as data -------------------------------------
   What surface is where, and exactly how high its drawn top is, for every system
   that puts something on the ground: the materials, the 3D kerbs, the pebbles and
   the sand, the grass. One answer, so nothing floats or sinks.

   Lateral layout on each side, a = metres out from the road edge (|off| - T.half):
     a < 0                      road (top at LIFT.road)
     kerb where T.kerbKind > 0  0 .. 1.5 (and the sausage behind), on top of the run-off
     0 .. ro                    the run-off: what T.surfAt says (asphalt, gravel, grass,
                                astro, runoff/plain), or asphalt on a circuit without it,
                                or asphalt/concrete on a street circuit ("wall")
     ro .. ro + VERGE           grass verge out to the barrier and past it (not on "wall")
   Heights: everything sits on the road's own surface function (centreline height,
   banking, camber, as G3.strip has it) plus a small lift per layer so the layers
   never fight: road 0.07 (G3.roadLift, which the worlds read), run-off 0.04, grass 0.035. */
const LIFT = { road:0.07, runoff:0.04, gravel:0.045, grass:0.035, kerb:0.072 };
const VERGE = 6;

const FIELD = {
  LIFT, VERGE,
  // the road surface's own height at node k, lateral offset o (no lift): G3.strip's E()
  baseZ(T, k, o){
    const c = T.curv[k];
    if(c && o * c > 0.80) o = 0.80 / c;
    return T.z[k] + bankZ(T, k, o) + o * T.camber[k];
  },
  roAt(T, i, off){ return off >= 0 ? T.roR[i] : T.roL[i]; },
  /* what is on top at node i, offset off */
  kindAt(T, i, off){
    const a = Math.abs(off) - T.half;
    if(a < 0) return "road";
    if(T.kerbH && T.kerbKind(i, off) && a <= 2.1 && T.kerbH(i, off) > 0) return "kerb";
    const ro = this.roAt(T, i, off), wall = T.barrier === "wall";
    if(a > ro) return wall ? "none" : (a > ro + VERGE ? "none" : "grass");
    if(T.surfAt){
      const k = T.surfAt(i, off);
      return k === "runoff" ? "asphalt" : k;                         // "plain" run-off is laid as tarmac apron + mown grass
    }
    return "asphalt";
  },
  /* the height of the drawn top surface at node i, offset off (kerbs included) */
  zAt(T, i, off){
    const base = this.baseZ(T, i, off), a = Math.abs(off) - T.half;
    if(a < 0) return base + LIFT.road;
    const kind = this.kindAt(T, i, off);
    const under = kind === "grass" ? LIFT.grass : kind === "gravel" ? LIFT.gravel : LIFT.runoff;
    const kh = T.kerbH ? T.kerbH(i, off) : 0;
    return base + (kh > 0 ? Math.max(LIFT.kerb + kh, under) : under);
  },
  /* where a world point is: nearest node, lateral offset, metres along the lap */
  locate(T, x, y, hint){
    const i = T.near(x, y, hint), dx = x - T.x[i], dy = y - T.y[i];
    const off = dx * T.nx[i] + dy * T.ny[i], al = dx * T.tx[i] + dy * T.ty[i];
    return { i, off, s: i * T.ds + al, al };
  },
  /* the same height as zAt, but between nodes too (blends to the neighbour like T.surfZ) */
  zAtXY(T, x, y, hint){
    const L = this.locate(T, x, y, hint), n = T.n;
    const j = (L.i + (L.al >= 0 ? 1 : n - 1)) % n, f = Math.min(Math.abs(L.al) / T.ds, 1);
    return this.zAt(T, L.i, L.off) * (1 - f) + this.zAt(T, j, L.off) * f;
  },

  /* A ribbon along the lap between two lateral offsets, laid exactly on the
     surface: split across into lanes of at most `lane` metres and along into `sub`
     pieces per node (positions interpolated between nodes), so a curved, banked or
     raised surface follows its shape instead of one flat quad per 7 m node.
       fa, fb   offsets (numbers or i => number), any order
       h(i, o, s) the height above baseZ at node i, offset o, s metres along (default: lift)
       filter(i)  which nodes get a piece
       colour(i, o, s) optional vertex colour (THREE.Color) per vertex
     UVs are world metres (u = game x, v = game y), so a material tiles per metre
     whatever the ribbon's width; uv2 = (metres across from fa, metres along). */
  ribbon(T, fa, fb, opts){
    const o = opts || {}, n = T.n, lane = o.lane || 1.5, sub = Math.max(1, o.sub || 1);
    const lift = o.lift != null ? o.lift : LIFT.runoff, h = o.h || null, filter = o.filter || null;
    const F = v => (typeof v === "function" ? v : () => v);
    const A = F(fa), B = F(fb);
    const pos = [], uv = [], uv2 = [], col = o.colour ? [] : null, idx = [];
    let v = 0;
    const P = (k0, k1, f, off) => {
      // a point a fraction f from node k0 to k1 at offset off
      const c0 = T.curv[k0], c1 = T.curv[k1];
      const o0 = c0 && off * c0 > 0.80 ? 0.80 / c0 : off, o1 = c1 && off * c1 > 0.80 ? 0.80 / c1 : off;
      const x = (T.x[k0] + T.nx[k0] * o0) * (1 - f) + (T.x[k1] + T.nx[k1] * o1) * f;
      const y = (T.y[k0] + T.ny[k0] * o0) * (1 - f) + (T.y[k1] + T.ny[k1] * o1) * f;
      const s = (k0 + f) * T.ds;
      const hz0 = h ? h(k0, off, s) : lift, hz1 = h ? h(k1, off, s) : lift;
      const z = (this.baseZ(T, k0, off) + hz0) * (1 - f) + (this.baseZ(T, k1, off) + hz1) * f;
      return [x, y, z, s];
    };
    for(let i = 0; i < n; i++){
      if(filter && !filter(i)) continue;
      const j = (i + 1) % n;
      let a0 = A(i), b0 = B(i), a1 = A(j), b1 = B(j);
      if(Math.abs(a0 - a1) > 6 || Math.abs(b0 - b1) > 6) continue;      // the offset flipped sides
      // keep the strip facing up: lay it from the lower offset to the higher
      if(a0 > b0){ [a0, b0] = [b0, a0]; [a1, b1] = [b1, a1]; }
      const K = Math.max(1, Math.ceil(Math.max(b0 - a0, b1 - a1) / lane));
      for(let q = 0; q < sub; q++){
        const f0 = q / sub, f1 = (q + 1) / sub;
        const base = v;
        for(const f of [f0, f1]){
          const aa = a0 + (a1 - a0) * f, bb = b0 + (b1 - b0) * f;
          for(let c = 0; c <= K; c++){
            const off = aa + (bb - aa) * c / K;
            const [x, y, z, s] = P(i, j, f, off);
            pos.push(x, z, y); uv.push(x, y); uv2.push(off - aa, s);
            if(col){ const cc = o.colour(i, off, s); col.push(cc.r, cc.g, cc.b); }
            v++;
          }
        }
        for(let c = 0; c < K; c++){
          const p0 = base + c, p1 = base + c + 1, q0 = base + K + 1 + c, q1 = q0 + 1;
          idx.push(p0, p1, q0, p1, q1, q0);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute("uv2", new THREE.Float32BufferAttribute(uv2, 2));
    if(col) g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  },
};

export { FIELD, LIFT, VERGE };
