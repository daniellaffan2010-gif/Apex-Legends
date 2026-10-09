import * as THREE from 'three';
import { TAU, angWrap, clamp, lerp, shade } from '../config/util.js';
import { TYRES } from '../car/parts.js';
import { CAR_SPEC } from '../car/spec.js';
import { G3 } from './g3.js';
import { CRASH } from './crash.js';
import { stopPose } from '../car/pitstop.js';
import { wearLook } from '../car/tyrewear.js';

/* ---- the cars ----------------------------------------------------------
   Built from simple faceted shapes in the dimensions of CAR_SPEC: a lofted tub
   and nose, sculpted sidepods, a floor with its diffuser, the halo, three-
   element front wing and two-element rear wing with moving flaps, suspension
   arms, and lathe-turned tyres. Every static piece is one vertex-coloured mesh,
   built once per team and shared between its cars; only the wheels, the flaps
   and the lights move. */
const CARGEO = {
  cache:new Map(),
  // a triangle soup with a colour per triangle, in the car's real-world frame
  // (d = metres behind the front axle, y = metres out, z = metres up)
  soup(){ return { p:[], c:[] }; },
  // wind every triangle so it faces away from a point inside the solid
  tri(b, a, q, r, col, inside){
    const ux = q[0] - a[0], uy = q[1] - a[1], uz = q[2] - a[2], vx = r[0] - a[0], vy = r[1] - a[1], vz = r[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const cx = (a[0] + q[0] + r[0]) / 3 - inside[0], cy = (a[1] + q[1] + r[1]) / 3 - inside[1], cz = (a[2] + q[2] + r[2]) / 3 - inside[2];
    // (d, y, z) -> (x, y, z) of the group is d reversed and y, z swapped: two flips, so the
    // winding survives the mapping and a face pointing away from the inside stays that way
    if(nx * cx + ny * cy + nz * cz < 0){ const t = q; q = r; r = t; }
    b.p.push(a[0], a[1], a[2], q[0], q[1], q[2], r[0], r[1], r[2]);
    for(let k = 0; k < 3; k++) b.c.push(col.r, col.g, col.b);
  },
  quad(b, a, q, r, s, col, inside){ this.tri(b, a, q, r, col, inside); this.tri(b, a, r, s, col, inside); },
  // rings of points, one per section, stitched into a skin; colour decided per face
  skin(b, rings, colOf, capA, capB){
    for(let i = 0; i < rings.length - 1; i++){
      const A = rings[i], B2 = rings[i + 1], m = A.length;
      const inside = [(A.c[0] + B2.c[0]) / 2, (A.c[1] + B2.c[1]) / 2, (A.c[2] + B2.c[2]) / 2];
      for(let k = 0; k < m; k++){
        const a = A[k], q = A[(k + 1) % m], r = B2[(k + 1) % m], s = B2[k];
        const cx = (a[0] + q[0] + r[0] + s[0]) / 4, cy = (a[1] + q[1] + r[1] + s[1]) / 4, cz = (a[2] + q[2] + r[2] + s[2]) / 4;
        // which way the face looks: out from the ring centre
        const oy = cy - inside[1], oz = cz - inside[2];
        const fc = colOf(cx, cy, cz, oy, oz);
        if(fc) this.quad(b, a, q, r, s, fc, inside);                        // (no colour: an opening)
      }
    }
    for(const [R0, col, dir] of [[rings[0], capA, -1], [rings[rings.length - 1], capB, 1]]){
      if(!col) continue;
      const inside = [R0.c[0] - dir * 0.3, R0.c[1], R0.c[2]];            // the solid lies behind the first ring, ahead of the last
      for(let k = 0; k < R0.length; k++) this.tri(b, R0.c, R0[k], R0[(k + 1) % R0.length], col, inside);
    }
  },
  ring(pts, d, yc){
    const r = pts.map(([y, z]) => [d, yc + y, z]);
    let sy = 0, sz = 0; for(const [y, z] of pts){ sy += y; sz += z; }
    r.c = [d, yc + sy / pts.length, sz / pts.length];
    return r;
  },
  box(b, d, y, z, l, w, h, col, topShrink){
    const k = topShrink || 1, P = [];
    for(const [dz, s] of [[0, 1], [h, k]]) for(const [dd, dy] of [[-l / 2, -w / 2], [l / 2, -w / 2], [l / 2, w / 2], [-l / 2, w / 2]])
      P.push([d + dd * s, y + dy * s, z + dz]);
    const inside = [d, y, z + h / 2];
    this.quad(b, P[0], P[1], P[2], P[3], col, inside); this.quad(b, P[4], P[5], P[6], P[7], col, inside);
    for(let i = 0; i < 4; i++){ const j = (i + 1) % 4; this.quad(b, P[i], P[j], P[j + 4], P[i + 4], col, inside); }
  },
  // a thin tube with a few sides between two points
  tube(b, p0, p1, r, col, sides){
    sides = sides || 5;
    const dx = p1[0] - p0[0], dy = p1[1] - p0[1], dz = p1[2] - p0[2], L = Math.hypot(dx, dy, dz) || 1;
    const t = [dx / L, dy / L, dz / L];
    let u = Math.abs(t[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    let v = [t[1] * u[2] - t[2] * u[1], t[2] * u[0] - t[0] * u[2], t[0] * u[1] - t[1] * u[0]];
    const vl = Math.hypot(...v); v = v.map(x => x / vl);
    u = [v[1] * t[2] - v[2] * t[1], v[2] * t[0] - v[0] * t[2], v[0] * t[1] - v[1] * t[0]];
    const ring = (p, s) => [...Array(sides)].map((_, k) => { const a = k / sides * TAU;
      return [p[0] + (u[0] * Math.cos(a) + v[0] * Math.sin(a)) * r * s, p[1] + (u[1] * Math.cos(a) + v[1] * Math.sin(a)) * r * s, p[2] + (u[2] * Math.cos(a) + v[2] * Math.sin(a)) * r * s]; });
    const A = ring(p0, 1), B2 = ring(p1, 1), inside = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2];
    for(let k = 0; k < sides; k++){ const j = (k + 1) % sides;
      // each face's own inside: the axis point beside it
      this.quad(b, A[k], A[j], B2[j], B2[k], col, inside); }
  },
  // a flat plate: an outline in (d, z) given a thickness in y, or in (d, y) with a thickness in z
  plateY(b, pts, y, thick, col){
    const n = pts.length, A = pts.map(([d, z]) => [d, y - thick / 2, z]), B2 = pts.map(([d, z]) => [d, y + thick / 2, z]);
    let cd = 0, cz = 0; for(const [d, z] of pts){ cd += d; cz += z; } cd /= n; cz /= n;
    const inside = [cd, y, cz];
    for(let k = 1; k < n - 1; k++){ this.tri(b, A[0], A[k], A[k + 1], col, inside); this.tri(b, B2[0], B2[k], B2[k + 1], col, inside); }
    for(let k = 0; k < n; k++){ const j = (k + 1) % n; this.quad(b, A[k], A[j], B2[j], B2[k], col, [cd, y, cz]); }
  },
  slabZ(b, pts, z0, z1, col, colTop){
    const n = pts.length, A = pts.map(([d, y]) => [d, y, z0]), B2 = pts.map(([d, y]) => [d, y, z1]);
    let cd = 0, cy = 0; for(const [d, y] of pts){ cd += d; cy += y; } cd /= n; cy /= n;
    const inside = [cd, cy, (z0 + z1) / 2];
    for(let k = 1; k < n - 1; k++){ this.tri(b, A[0], A[k], A[k + 1], col, inside); this.tri(b, B2[0], B2[k], B2[k + 1], colTop || col, inside); }
    for(let k = 0; k < n; k++){ const j = (k + 1) % n; this.quad(b, A[k], A[j], B2[j], B2[k], col, inside); }
  },
  // one wing element: an aerofoil section run across the span, the tips rising.
  // Built about its own leading edge so it can be turned there.
  wing(b, o){
    const st = o.stations || 9, prof = [[0, 0], [0.22, 0.55], [0.6, 0.42], [1, 0.04], [0.6, -0.22], [0.22, -0.3]];
    const rings = [];
    for(let s = 0; s < st; s++){
      const f = s / (st - 1) * 2 - 1, y = f * o.span / 2, rise = (o.tipRise || 0) * Math.pow(Math.abs(f), 3);
      const chord = o.chord * (1 - (o.tipTaper || 0) * Math.pow(Math.abs(f), 2));
      const ca = Math.cos(o.aoa || 0), sa = Math.sin(o.aoa || 0);
      const r = prof.map(([u, v]) => { const uu = u * chord, vv = v * o.thick;
        return [o.d + uu * ca, y, o.z + rise + uu * sa + vv * ca]; });
      let cd = 0, cz = 0; for(const q of r){ cd += q[0]; cz += q[2]; }
      r.c = [cd / r.length, y, cz / r.length];
      rings.push(r);
    }
    // stitch across the span; the tips are the caps
    const col = o.col;
    for(let i = 0; i < rings.length - 1; i++){
      const A = rings[i], B2 = rings[i + 1], m = A.length, inside = [(A.c[0] + B2.c[0]) / 2, (A.c[1] + B2.c[1]) / 2, (A.c[2] + B2.c[2]) / 2];
      for(let k = 0; k < m; k++) this.quad(b, A[k], A[(k + 1) % m], B2[(k + 1) % m], B2[k], col, inside);
    }
    for(const R0 of [rings[0], rings[rings.length - 1]]){
      const inside = [R0.c[0], R0.c[1] * 0.9, R0.c[2]];
      for(let k = 1; k < R0.length - 1; k++) this.tri(b, R0[0], R0[k], R0[k + 1], col, inside);
    }
  },
  // out of the real-world frame into the car group's (x forward, y up, z out)
  geo(b){
    const n = b.p.length / 3, pos = new Float32Array(n * 3), S = CAR_SPEC;
    for(let i = 0; i < n; i++){ pos[i * 3] = S.X(b.p[i * 3]); pos[i * 3 + 1] = S.Z(b.p[i * 3 + 2]); pos[i * 3 + 2] = S.Y(b.p[i * 3 + 1]); }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(b.c, 3));
    g.computeVertexNormals(); g.computeBoundingSphere();
    return g;
  },
  // the same, but about a pivot, for a flap that turns on its leading edge
  geoAbout(b, d0, z0){
    const g = this.geo(b), S = CAR_SPEC, p = g.attributes.position;
    for(let i = 0; i < p.count; i++){ p.setX(i, p.getX(i) - S.X(d0)); p.setY(i, p.getY(i) - S.Z(z0)); }
    g.computeBoundingSphere();
    return g;
  },

  /* ---- the pieces, per team ---- */
  TUB:[ // d, half width, bottom, top, top-width fraction: nose tip to crash structure
    [-0.98, 0.085, 0.130, 0.250, 0.50], [-0.70, 0.125, 0.150, 0.320, 0.55], [-0.35, 0.165, 0.165, 0.400, 0.60],
    [0.05, 0.210, 0.175, 0.480, 0.62], [0.50, 0.270, 0.120, 0.560, 0.65], [0.95, 0.340, 0.070, 0.640, 0.70],
    [1.30, 0.370, 0.060, 0.640, 0.72], [1.62, 0.370, 0.060, 0.700, 0.66], [1.80, 0.340, 0.060, 0.960, 0.30],
    [2.15, 0.310, 0.060, 0.900, 0.36], [2.60, 0.270, 0.060, 0.740, 0.46], [3.05, 0.190, 0.080, 0.580, 0.56],
    [3.45, 0.120, 0.120, 0.460, 0.62], [3.85, 0.080, 0.180, 0.400, 0.70], [4.05, 0.070, 0.220, 0.360, 0.70]],
  POD:[ // d, outer half width, bottom, top, undercut: the coke bottle
    [1.18, 0.60, 0.17, 0.53, 0.05], [1.45, 0.70, 0.12, 0.58, 0.12], [1.90, 0.68, 0.10, 0.55, 0.14],
    [2.40, 0.56, 0.09, 0.47, 0.12], [2.85, 0.40, 0.08, 0.38, 0.08], [3.15, 0.27, 0.08, 0.30, 0.04]],
  tubTop(d){
    const T = this.TUB;
    for(let i = 0; i < T.length - 1; i++) if(d >= T[i][0] && d <= T[i + 1][0]){
      const f = (d - T[i][0]) / (T[i + 1][0] - T[i][0]);
      return { top:lerp(T[i][3], T[i + 1][3], f), w:lerp(T[i][1], T[i + 1][1], f) * lerp(T[i][4], T[i + 1][4], f) };
    }
    return { top:0.3, w:0.1 };
  },
  /* How far out the tub's surface is at d along the car and z up: its eight-sided
     section, full width in the middle band, narrowing below to the floor and above
     to the top. 0 above or below it. */
  tubHalf(d, z){
    const T = this.TUB;
    d = clamp(d, T[0][0], T[T.length - 1][0]);
    let i = 0; while(i < T.length - 2 && d > T[i + 1][0]) i++;
    const f = (d - T[i][0]) / (T[i + 1][0] - T[i][0]), L = k => lerp(T[i][k], T[i + 1][k], f);
    const w = L(1), zb = L(2), zt = L(3), tw = L(4), h = zt - zb;
    if(z < zb || z > zt) return 0;
    if(z < zb + h * 0.28) return w * (0.72 + 0.28 * (z - zb) / (h * 0.28));
    if(z < zb + h * 0.72) return w;
    return w - w * (1 - tw) * (z - zb - h * 0.72) / (h * 0.28);
  },
  // a suspension pick-up on the tub: pulled in (and down, below the top) until it sits just inside the surface
  onTub(d, y, z){
    const T = this.TUB; let i = 0; const dd = clamp(d, T[0][0], T[T.length - 1][0]);
    while(i < T.length - 2 && dd > T[i + 1][0]) i++;
    const f = (dd - T[i][0]) / (T[i + 1][0] - T[i][0]), zb = lerp(T[i][2], T[i + 1][2], f), zt = lerp(T[i][3], T[i + 1][3], f);
    const zz = clamp(z, zb + 0.03, zt - 0.03);
    return [d, Math.min(y, this.tubHalf(d, zz) - 0.012), zz];
  },
  palette(G, t){
    const c = x => G.col(x);
    return {
      body:c(t.body), body2:c(shade(t.body, -0.14)), nose:c(t.accent), accent:c(t.accent), accent2:c(t.accent2 || t.accent),
      carbon:c(t.carbon || "#1A1D22"), black:c("#16181C"), dark:c("#0B0D10"), under:c("#121418"),
    };
  },
  team(G, t){
    const key = t.id;
    let E = this.cache.get(key);
    if(E) return E;
    const C = this.palette(G, t);
    E = { body:this.buildBody(C, false), bodyChipped:null, C,
          fw:this.buildFrontWing(C), fwFlap:this.buildFrontFlaps(C), rw:this.buildRearWing(C), rwFlap:this.buildRearFlap(C),
          fwStub:this.buildFwStub(C), rwStub:this.buildRwStub(C) };
    this.cache.set(key, E);
    return E;
  },
  chipped(G, t){ const E = this.team(G, t); if(!E.bodyChipped) E.bodyChipped = this.buildBody(E.C, true); return E.bodyChipped; },
  /* The player's own body in the cockpit view: the same car without the halo's
     centre pillar (render3d/cockpit.js draws it see-through: two eyes look past
     a real one, a single lens cannot) and without the visor strip that sits in
     front of the driver's eyes. */
  cockpit(G, t, chipped){
    const E = this.team(G, t), k = chipped ? "fpChipped" : "fpBody";
    if(!E[k]) E[k] = this.buildBody(E.C, chipped, true);
    return E[k];
  },

  buildBody(C, chipped, cockpit){
    const b = this.soup();
    /* the tub: nose, monocoque, airbox and engine cover in one loft */
    const oct = (w, zb, zt, tw) => { const h = zt - zb;
      return [[w * 0.72, zb], [w, zb + h * 0.28], [w, zb + h * 0.72], [w * tw, zt], [-w * tw, zt], [-w, zb + h * 0.72], [-w, zb + h * 0.28], [-w * 0.72, zb]]; };
    const rings = this.TUB.map(([d, w, zb, zt, tw]) => this.ring(oct(w, zb, zt, tw), d, 0));
    this.skin(b, rings, (d, y, z, oy, oz) => {
      if(oz < -0.02 && Math.abs(oz) > Math.abs(oy)) return C.under;              // the underside
      if(d < -0.34) return C.nose;                                               // the nose in the contrast colour
      if(d > 1.0 && d < 1.62 && z > 0.58 && Math.abs(y) < 0.29) return cockpit ? null : C.dark;   // into the cockpit (open, when you sit in it)
      if(d > 1.62 && d < 1.80 && z > 0.62) return C.dark;                        // the airbox mouth
      if(d > 1.9 && d < 3.5 && Math.abs(y) < 0.075 && oz > 0) return C.accent;    // a spine stripe along the engine cover
      return C.body;
    }, C.nose, C.carbon);
    /* sidepods: an inlet at the front, an undercut, and a taper into the floor */
    for(const sd of [-1, 1]){
      const rs = this.POD.map(([d, w, zb, zt, uc]) => {
        const pts = [[0.20, zt], [w - 0.10, zt], [w, zt - 0.10], [w, zb + 0.16], [w - uc, zb], [0.20, zb]].map(([y, z]) => [y * sd, z]);
        return this.ring(pts, d, 0);
      });
      this.skin(b, rs, (d, y, z, oy, oz) => {
        // the livery cut: a band running down and back across the pod
        if(oz < -0.02 && Math.abs(oz) > Math.abs(oy) * 0.8) return C.under;
        const k = (d - 1.18) / (3.15 - 1.18) - (Math.abs(y) - 0.2) * 0.55;
        if(z > 0.30 && k > 0.30 && k < 0.46) return C.accent2;
        return C.body;
      }, C.dark, C.body2);
    }
    /* the floor, its edges, and the diffuser */
    const fl = [[0.45, 0.36], [0.75, 0.66], [1.25, 0.76], [2.70, 0.76], [3.10, 0.60], [3.30, 0.54]];
    const inner = fl.map(([d, y]) => [d, Math.min(y, 0.64)]);
    this.slabZ(b, [...inner.map(([d, y]) => [d, y]), ...inner.slice().reverse().map(([d, y]) => [d, -y])], 0.025, 0.05, C.black);
    for(const sd of [-1, 1]){
      if(chipped && sd < 0){
        // a bite out of the left-hand edge: just the front and the back of it survive
        this.slabZ(b, [[0.75, -0.64], [1.25, -0.76], [1.25, -0.64]], 0.025, 0.05, C.black);
        this.slabZ(b, [[1.25, -0.64], [1.25, -0.76], [1.55, -0.71], [1.60, -0.64]], 0.025, 0.05, C.black);
        this.slabZ(b, [[2.35, -0.64], [2.45, -0.71], [2.70, -0.76], [3.10, -0.64]], 0.025, 0.05, C.black);
        continue;
      }
      this.slabZ(b, [[0.75, 0.64 * sd], [1.25, 0.76 * sd], [2.70, 0.76 * sd], [3.10, 0.64 * sd]], 0.025, 0.05, C.black);
      // the floor-edge fence
      this.plateY(b, [[1.30, 0.05], [2.60, 0.05], [2.60, 0.10], [1.40, 0.12]], 0.745 * sd, 0.012, C.carbon);
    }
    // the diffuser ramp, its side walls and three strakes
    const ramp = [[3.25, -0.50, 0.04], [3.25, 0.50, 0.04], [3.95, 0.50, 0.30], [3.95, -0.50, 0.30]];
    this.quad(b, ramp[0], ramp[1], ramp[2], ramp[3], C.black, [3.6, 0, 0.35]);
    this.quad(b, ramp[0], ramp[1], ramp[2], ramp[3], C.black, [3.6, 0, -0.2]);
    for(const y of [-0.5, 0.5]) this.plateY(b, [[3.25, 0.04], [3.95, 0.30], [3.95, 0.34], [3.25, 0.10]], y, 0.02, C.carbon);
    for(const y of [-0.24, 0, 0.24]) this.plateY(b, [[3.35, 0.05], [3.92, 0.28], [3.92, 0.10], [3.45, 0.05]], y, 0.014, C.black);
    // a low shark fin on the engine cover
    this.plateY(b, [[2.05, 0.90], [3.30, 0.60], [3.40, 0.48], [2.20, 0.74]], 0, 0.02, C.body2);
    /* the cockpit: halo, headrest, mirrors */
    const H = CAR_SPEC.R.haloTop, hr = 0.045;
    const halo = [[1.62, 0.30, 0.66], [1.50, 0.29, 0.86], [1.30, 0.25, H - 0.015], [1.10, 0.14, H], [1.00, 0, H]];
    for(const sd of [-1, 1]) for(let i = 0; i < halo.length - 1; i++)
      this.tube(b, [halo[i][0], halo[i][1] * sd, halo[i][2]], [halo[i + 1][0], halo[i + 1][1] * sd, halo[i + 1][2]], hr, C.carbon, 6);
    if(!cockpit){
      this.tube(b, [1.00, 0, H], [0.92, 0, 0.78], hr * 1.1, C.carbon, 6);
      this.tube(b, [0.92, 0, 0.78], [0.86, 0, 0.64], hr * 1.2, C.carbon, 6);
    }
    this.box(b, 1.52, 0, 0.62, 0.14, 0.40, 0.10, C.body2, 0.85);                     // headrest behind the helmet
    if(!cockpit) this.box(b, 1.24, 0, 0.72, 0.05, 0.20, 0.035, C.dark);              // visor strip (the helmet's own is in the driver mesh)
    for(const sd of [-1, 1]){
      this.tube(b, [1.02, 0.34 * sd, 0.58], [1.02, 0.52 * sd, 0.63], 0.014, C.carbon, 4);
      this.box(b, 1.03, 0.57 * sd, 0.60, 0.07, 0.15, 0.075, C.body, 0.9);
    }
    // the two front-wing pylons under the nose
    for(const sd of [-1, 1]) this.plateY(b, [[-0.92, 0.10], [-0.62, 0.10], [-0.62, 0.17], [-0.90, 0.14]], 0.07 * sd, 0.02, C.carbon);
    /* suspension: wishbones and push/pull rods at each corner, and brake-duct
       fairings. The inboard ends are pick-ups on the tub (onTub), so every arm
       runs into the bodywork instead of stopping short of it in mid air. */
    const R2 = CAR_SPEC.R, yf = R2.trackF / 2, yr = R2.trackR / 2;
    for(const sd of [-1, 1]){
      const ar = (p, q, r) => this.tube(b, [p[0], p[1] * sd, p[2]], [q[0], q[1] * sd, q[2]], r || 0.016, C.black, 4);
      const tub = (d, y, z) => this.onTub(d, y, z);
      const uf = [0.0, yf - 0.10, 0.44], lf = [0.02, yf - 0.10, 0.17];
      ar(tub(-0.18, 0.16, 0.42), uf); ar(tub(0.22, 0.20, 0.46), uf); ar(tub(-0.22, 0.16, 0.20), lf); ar(tub(0.26, 0.20, 0.22), lf);
      ar([0.02, yf - 0.14, 0.20], tub(-0.05, 0.20, 0.44), 0.02);
      this.box(b, 0.08, (yf - 0.20) * sd, 0.26, 0.26, 0.06, 0.18, C.body2);
      const ur = [3.40, yr - 0.14, 0.44], lr = [3.40, yr - 0.14, 0.17];
      ar(tub(3.10, 0.20, 0.44), ur); ar(tub(3.62, 0.18, 0.40), ur); ar(tub(3.05, 0.22, 0.18), lr); ar(tub(3.65, 0.20, 0.20), lr);
      ar([3.40, yr - 0.18, 0.42], tub(3.10, 0.20, 0.22), 0.02);
    }
    return this.geo(b);
  },
  buildFrontWing(C){
    const b = this.soup(), half = CAR_SPEC.R.fwSpan / 2;
    // the main plane, curling up to the endplates
    this.wing(b, { d:-1.05, z:0.085, chord:0.27, thick:0.05, aoa:-0.10, span:half * 2, tipRise:0.07, col:C.accent, stations:11 });
    for(const sd of [-1, 1]){
      // endplate, and the footplate turning out at its foot
      this.plateY(b, [[-1.07, 0.06], [-0.55, 0.06], [-0.50, 0.17], [-0.62, 0.25], [-0.96, 0.22]], half * sd, 0.022, C.accent2);
      this.slabZ(b, [[-1.02, half * sd], [-0.58, half * sd], [-0.62, (half - 0.09) * sd], [-0.98, (half - 0.07) * sd]], 0.055, 0.07, C.accent2);
    }
    return this.geo(b);
  },
  // the two flaps, about the first flap's leading edge, so the pair can turn together
  FWF:{ d:-0.84, z:0.12 },
  buildFrontFlaps(C){
    const b = this.soup(), half = CAR_SPEC.R.fwSpan / 2 - 0.02, P = this.FWF;
    this.wing(b, { d:P.d, z:P.z, chord:0.19, thick:0.035, aoa:0.30, span:half * 2, tipRise:0.12, tipTaper:0.15, col:C.accent });
    this.wing(b, { d:P.d + 0.15, z:P.z + 0.075, chord:0.15, thick:0.03, aoa:0.52, span:half * 2 - 0.08, tipRise:0.14, tipTaper:0.2, col:C.body });
    return this.geoAbout(b, P.d, P.z);
  },
  buildRearWing(C){
    const b = this.soup(), half = CAR_SPEC.R.rwSpan / 2, top = CAR_SPEC.R.rwTop;
    this.wing(b, { d:3.93, z:0.70, chord:0.30, thick:0.06, aoa:0.14, span:half * 2, tipRise:-0.02, col:C.accent });
    // the beam wing, low down behind the diffuser
    this.wing(b, { d:3.92, z:0.40, chord:0.20, thick:0.04, aoa:0.18, span:half * 1.6, col:C.carbon, stations:5 });
    for(const sd of [-1, 1]){
      // a slim endplate, cut away low down the way the 2026 wings are
      this.plateY(b, [[3.97, 0.60], [4.40, 0.58], [4.47, top - 0.05], [4.36, top], [4.02, top - 0.03], [3.94, top - 0.12]], half * sd, 0.024, C.accent2);
      this.plateY(b, [[4.02, 0.36], [4.30, 0.36], [4.30, 0.60], [4.05, 0.62]], half * 0.88 * sd, 0.02, C.carbon);
    }
    // the swan-neck support
    this.plateY(b, [[3.95, 0.30], [4.12, 0.30], [4.10, 0.72], [4.00, 0.72]], 0, 0.03, C.carbon);
    // the rear crash structure, where the rain light sits
    this.box(b, 4.12, 0, 0.24, 0.16, 0.13, 0.10, C.carbon);
    return this.geo(b);
  },
  RWF:{ d:4.19, z:0.79 },
  buildRearFlap(C){
    const b = this.soup(), half = CAR_SPEC.R.rwSpan / 2 - 0.015, P = this.RWF;
    this.wing(b, { d:P.d, z:P.z, chord:0.25, thick:0.04, aoa:0, span:half * 2, col:C.accent, stations:5 });
    return this.geoAbout(b, P.d, P.z);
  },
  // what is left when a wing has come off
  buildFwStub(C){
    const b = this.soup();
    this.slabZ(b, [[-0.98, -0.30], [-0.70, -0.30], [-0.70, 0.36], [-0.95, 0.26]], 0.07, 0.11, C.carbon);
    // an endplate hanging by a thread
    this.plateY(b, [[-0.95, 0.00], [-0.55, 0.02], [-0.58, 0.22], [-0.90, 0.20]], -0.46, 0.022, C.accent2);
    return this.geo(b);
  },
  buildRwStub(C){
    const b = this.soup();
    this.plateY(b, [[3.95, 0.30], [4.12, 0.30], [4.10, 0.52], [4.02, 0.58]], 0, 0.03, C.carbon);
    this.box(b, 4.12, 0, 0.24, 0.16, 0.13, 0.10, C.carbon);
    return this.geo(b);
  },
  // the driver: helmet and the T-cam in the driver's own colour, with a dark visor
  driver(G, cam){
    const key = "drv|" + cam;
    let g = this.cache.get(key);
    if(g) return g;
    const b = this.soup(), col = G.col(cam), dark = G.col("#0B0D10");
    // a low-poly helmet: rings of latitude
    const cx = 1.34, cz = 0.78, r = 0.125, lat = 5, lon = 8, rings = [];
    for(let i = 1; i < lat; i++){ const th = i / lat * Math.PI, rr = Math.sin(th) * r, z = cz + Math.cos(th) * r;
      rings.push([...Array(lon)].map((_, k) => { const a = k / lon * TAU; return [cx + Math.cos(a) * rr, Math.sin(a) * rr, z]; })); }
    const inside = [cx, 0, cz];
    for(let i = 0; i < rings.length - 1; i++) for(let k = 0; k < lon; k++){
      const j = (k + 1) % lon, a = rings[i][k], q = rings[i][j], s = rings[i + 1][k], r2 = rings[i + 1][j];
      // the visor band: the forward-facing faces of the middle row
      const fwd = (a[0] + q[0]) / 2 < cx - r * 0.35 && i === 1;
      this.quad(b, a, q, r2, s, fwd ? dark : col, inside);
    }
    for(const [R0, z] of [[rings[0], cz + r], [rings[rings.length - 1], cz - r]])
      for(let k = 0; k < lon; k++) this.tri(b, [cx, 0, z], R0[k], R0[(k + 1) % lon], col, inside);
    // the T-cam on top of the airbox
    this.box(b, 1.80, 0, 0.965, 0.10, 0.20, 0.05, col);
    g = this.geo(b);
    this.cache.set(key, g);
    return g;
  },
  /* A tyre turned on a lathe: flat tread, rounded shoulders, flat sidewalls,
     with the compound's colour as a ring on both faces and the rim in the
     team's wheel colour. Axle along z, centred on the origin, in game metres. */
  wheel(G, radius, width, tyreCol, rimCol){
    const key = "whl|" + radius.toFixed(3) + "|" + width.toFixed(3) + "|" + tyreCol + "|" + rimCol;
    let g = this.cache.get(key);
    if(g) return g;
    const Rr = radius, W = width / 2, seg = 16;
    const rubber = G.col("#15181C"), ring = G.col(tyreCol), rim = G.col(rimCol), hub = G.col(shade(rimCol, -0.35));
    // the profile, from the rim on one face round the tread to the rim on the other
    const P = [[0.60, W], [0.78, W], [0.87, W], [0.955, W * 0.96], [1, W * 0.80], [1, -W * 0.80], [0.955, -W * 0.96], [0.87, -W], [0.78, -W], [0.60, -W]];
    const cols = [rubber, ring, rubber, rubber, rubber, rubber, rubber, ring, rubber];
    /* Something to see it turn by: a slick is round and plain, and from the
       cockpit the front tyres look frozen. Lettering in the compound band (two
       pale blocks each side) and faint scuffing across the tread. */
    const pale = ring.clone().lerp(new THREE.Color(1, 1, 1), 0.55), scuff = rubber.clone().lerp(new THREE.Color(1, 1, 1), 0.035);
    const colAt = (s, k) => (s === 1 || s === 7) ? ((k % 8) < 2 ? pale : ring) : (s >= 3 && s <= 5 && (k & 1)) ? scuff : cols[s];
    // per-vertex zone for the wear shader (render3d/g3.js tyreWearMat): 0 rim and hub, 1 sidewall, 2 compound band, 3 tread
    const zoneOf = s => (s === 1 || s === 7) ? 2 : (s >= 3 && s <= 5) ? 3 : 1;
    const pos = [], col = [], zone = [];
    const push = (a, q, r, c, z) => {
      // face away from the wheel's centre
      const ux = q[0] - a[0], uy = q[1] - a[1], uz = q[2] - a[2], vx = r[0] - a[0], vy = r[1] - a[1], vz = r[2] - a[2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const cx = a[0] + q[0] + r[0], cy = a[1] + q[1] + r[1], cz = a[2] + q[2] + r[2];
      if(nx * cx + ny * cy + nz * cz < 0){ const t = q; q = r; r = t; }
      pos.push(...a, ...q, ...r); for(let k = 0; k < 3; k++){ col.push(c.r, c.g, c.b); zone.push(z); }
    };
    const pt = (f, z, k) => { const a = k / seg * TAU; return [Math.cos(a) * f * Rr, Math.sin(a) * f * Rr, z]; };
    for(let s = 0; s < P.length - 1; s++) for(let k = 0; k < seg; k++){
      const a = pt(P[s][0], P[s][1], k), q = pt(P[s][0], P[s][1], k + 1), r = pt(P[s + 1][0], P[s + 1][1], k + 1), t = pt(P[s + 1][0], P[s + 1][1], k);
      push(a, q, r, colAt(s, k), zoneOf(s)); push(a, r, t, colAt(s, k), zoneOf(s));
    }
    // the wheel covers, slightly dished, and a hub nut that shows the wheel turning
    for(const sd of [-1, 1]) for(let k = 0; k < seg; k++){
      const a = pt(0.60, W * sd * 0.98, k), q = pt(0.60, W * sd * 0.98, k + 1), c0 = [0, 0, W * sd * 0.9];
      push(c0, a, q, k % 4 === 0 ? hub : rim, 0);
    }
    g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute("zone", new THREE.Float32BufferAttribute(zone, 1));
    g.computeVertexNormals(); g.computeBoundingSphere();
    this.cache.set(key, g);
    return g;
  },
  // the lights: the rain light on the crash structure and the four brake discs
  lights(G){
    let g = this.cache.get("lights");
    if(g) return g;
    const b = this.soup(), red = G.col("#FF2A1E"), disc = G.col("#FF7A2A"), R2 = CAR_SPEC.R;
    this.box(b, 4.21, 0, 0.26, 0.03, 0.09, 0.06, red);
    for(const [d, y, r] of [[0, R2.trackF / 2 - 0.15, 0.13], [R2.wheelbase, R2.trackR / 2 - 0.19, 0.13]])
      for(const sd of [-1, 1]) this.plateY(b, [...Array(8)].map((_, k) => { const a = k / 8 * TAU; return [d + Math.cos(a) * r, R2.tyreDF / 2 + Math.sin(a) * r]; }), y * sd, 0.02, disc);
    g = this.geo(b);
    this.cache.set("lights", g);
    return g;
  },
  // one mechanic in the team's overalls, facing +x with both arms out in front; the pose is done by moving the mesh
  mechanic(G, t){
    const key = "mech|" + t.id;
    let g = this.cache.get(key);
    if(g) return g;
    const pos = [], col = [];
    const add = (geo, hex, x, y, z) => {
      const c = G.col(hex), p = geo.toNonIndexed().attributes.position;
      for(let i = 0; i < p.count; i++){ pos.push(p.getX(i) + x, p.getY(i) + y, p.getZ(i) + z); col.push(c.r, c.g, c.b); }
    };
    add(new THREE.BoxGeometry(0.30, 0.86, 0.34), "#1B1E24", 0, 0.43, 0);              // legs
    add(new THREE.BoxGeometry(0.40, 0.66, 0.50), t.body, 0, 1.18, 0);                 // torso
    add(new THREE.BoxGeometry(0.42, 0.14, 0.52), t.accent, 0, 0.96, 0);               // belt in the accent colour
    add(new THREE.BoxGeometry(0.36, 0.34, 0.34), t.accent, 0.02, 1.70, 0);            // helmet
    add(new THREE.BoxGeometry(0.10, 0.14, 0.30), "#0B0D10", 0.19, 1.70, 0);           // visor
    for(const sd of [-1, 1]) add(new THREE.BoxGeometry(0.70, 0.14, 0.14), "#F2F4F6", 0.38, 1.28, sd * 0.30);   // arms and gloves
    g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals(); g.computeBoundingSphere();
    this.cache.set(key, g);
    return g;
  },
  // one atlas of every race number, 0 to 99, bold white with a dark outline
  numberAtlas(){
    if(this._atlas) return this._atlas;
    const cv = document.createElement("canvas"); cv.width = cv.height = 1024;
    const g = cv.getContext("2d"), cell = 102.4;
    g.clearRect(0, 0, 1024, 1024);
    g.textAlign = "center"; g.textBaseline = "middle";
    g.font = "italic 900 80px 'Arial Black','Saira Condensed',sans-serif";
    g.lineJoin = "round";
    for(let n = 0; n < 100; n++){
      const x = (n % 10 + 0.5) * cell, y = (Math.floor(n / 10) + 0.5) * cell;
      g.lineWidth = 14; g.strokeStyle = "#0B0D10"; g.strokeText(String(n), x, y + 3);
      g.fillStyle = "#F8F8F6"; g.fillText(String(n), x, y + 3);
    }
    const t = new THREE.CanvasTexture(cv);
    t.encoding = THREE.sRGBEncoding; t.anisotropy = 4;
    return (this._atlas = t);
  },
  // the number quads: on the nose and on top of the engine cover (game metres)
  numbers(n){
    const key = "num|" + n;
    let g = this.cache.get(key);
    if(g) return g;
    const S = CAR_SPEC, u0 = (n % 10) / 10, v0 = 1 - (Math.floor(n / 10) + 1) / 10;
    const pos = [], uv = [];
    const decal = (d0, d1, halfW) => {
      const t0 = this.tubTop(d0), t1 = this.tubTop(d1);
      // front and back edges of the decal, sat just proud of the bodywork
      const A = [S.X(d0), S.Z(t0.top + 0.012)], B2 = [S.X(d1), S.Z(t1.top + 0.012)], w = S.Y(halfW);
      // the number reads from behind the car, top to the front
      const P = [[A[0], A[1], -w], [A[0], A[1], w], [B2[0], B2[1], w], [B2[0], B2[1], -w]];
      const U = [[u0, v0 + 0.1], [u0 + 0.1, v0 + 0.1], [u0 + 0.1, v0], [u0, v0]];
      // make "up" on the texture point forward, read from the camera behind and above
      const order = [0, 1, 2, 0, 2, 3];
      for(const i of order) pos.push(P[i][0], P[i][1], P[i][2]);
      for(const i of order) uv.push(U[i][0], U[i][1]);
    };
    decal(-0.52, -0.18, 0.11);
    decal(2.35, 2.95, 0.15);
    g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    // both triangles face up: flip any that ended up facing down
    const p = g.attributes.position, nrm = g.attributes.normal;
    if(nrm.getY(0) < 0){
      for(let i = 0; i < p.count; i += 3){
        const x = p.getX(i + 1), y = p.getY(i + 1), z = p.getZ(i + 1);
        p.setXYZ(i + 1, p.getX(i + 2), p.getY(i + 2), p.getZ(i + 2)); p.setXYZ(i + 2, x, y, z);
        const u = g.attributes.uv; const ux = u.getX(i + 1), uy = u.getY(i + 1); u.setXY(i + 1, u.getX(i + 2), u.getY(i + 2)); u.setXY(i + 2, ux, uy);
      }
      g.computeVertexNormals();
    }
    g.computeBoundingSphere();
    this.cache.set(key, g);
    return g;
  },
};

export { CARGEO };
G3.carMats = function(t){
  // the body's finish, as the 2D car does with its highlight: gloss shines, matte does not
  const f = t.finish === "gloss" ? { roughness:0.34, metalness:0.12 } : t.finish === "satin" ? { roughness:0.52, metalness:0.08 } : { roughness:0.78, metalness:0.02 };
  return { body:this.mat("#FFFFFF", Object.assign({ vertexColors:true, flatShading:true }, f)),
           tyre:this.mat("#FFFFFF", { vertexColors:true, flatShading:true, roughness:0.82, metalness:0 }) };
};
G3.carNumberMat = function(){
  let m = this.mats.get("carnum|");
  if(!m){ m = new THREE.MeshStandardMaterial({ map:CARGEO.numberAtlas(), alphaTest:0.5, roughness:0.55, metalness:0,
            polygonOffset:true, polygonOffsetFactor:-2, polygonOffsetUnits:-2 }); this.mats.set("carnum|", m); }
  return m;
};

G3.car = function(c){
  const t = c.team, E = CARGEO.team(this, t), M = this.carMats(t), SP = CAR_SPEC;
  const g = new THREE.Group();
  const mesh = (geo, mat, name, shadow) => { const m = new THREE.Mesh(geo, mat); if(name) m.name = name; m.castShadow = shadow !== false; m.receiveShadow = false; return m; };
  const body = mesh(E.body, M.body, "body"); g.add(body);
  const drv = mesh(CARGEO.driver(this, c.drv.cam || "#FFFFFF"), M.body, "driver"); g.add(drv);
  const num = mesh(CARGEO.numbers(clamp(c.drv.n | 0, 0, 99)), this.carNumberMat(), "numbers", false); g.add(num);
  // the old contract: something called "nose" at the nose
  const nose = new THREE.Object3D(); nose.name = "nose"; nose.position.set(SP.nose.tip, SP.nose.z, 0); g.add(nose);
  // the wings, each with its flaps on a pivot at the leading edge
  const fw = new THREE.Group(); fw.name = "frontwing";
  fw.add(mesh(E.fw, M.body));
  const fwFlap = new THREE.Group(); fwFlap.position.set(SP.X(CARGEO.FWF.d), SP.Z(CARGEO.FWF.z), 0);
  fwFlap.add(mesh(E.fwFlap, M.body)); fw.add(fwFlap); g.add(fw);
  const rw = new THREE.Group(); rw.name = "rearwing";
  rw.add(mesh(E.rw, M.body));
  const rwFlap = new THREE.Group(); rwFlap.position.set(SP.X(CARGEO.RWF.d), SP.Z(CARGEO.RWF.z), 0);
  rwFlap.add(mesh(E.rwFlap, M.body)); rw.add(rwFlap); g.add(rw);
  const fwStub = mesh(E.fwStub, M.body, "fwstub"); fwStub.visible = false; g.add(fwStub);
  const rwStub = mesh(E.rwStub, M.body, "rwstub"); rwStub.visible = false; g.add(rwStub);
  // the rain light and brake discs share one glowing material of the car's own
  const glowMat = new THREE.MeshBasicMaterial({ vertexColors:true, color:new THREE.Color(0.35, 0.35, 0.35), toneMapped:true });
  const glow = mesh(CARGEO.lights(this), glowMat, "lights", false); g.add(glow);
  // wheels: a pivot that steers, lifts and bends, and the tyre in it that turns
  g.userData.wheels = []; const pivots = [];
  const compound = (c.tyre && c.tyre.col) || TYRES.medium.col;
  // the same order as the 2D car: rear right, rear left, front right, front left
  for(const [ax, sd] of [[SP.rear, 1], [SP.rear, -1], [SP.front, 1], [SP.front, -1]]){
    const pv = new THREE.Group(); pv.position.set(ax.x, ax.r, ax.y * sd);
    const w = mesh(CARGEO.wheel(this, ax.r, ax.w, compound, t.wheel || "#2A2D31"), this.tyreWearMat(M.tyre));
    pv.add(w); g.add(pv); pivots.push(pv); g.userData.wheels.push(w);
    pv.userData.base = { x:ax.x, y:ax.r, z:ax.y * sd, sd, ax };
  }
  g.userData.car = c;
  g.userData.parts = { ownGeo:false, dentVer:0, body, drv, fw, rw, fwFlap, rwFlap, fwStub, rwStub, glow, glowMat, pivots, compound, chipped:false };
  g.userData.anim = { life:c.life != null ? c.life : 1, spinF:0, spinR:0, steer:0, flap:0, brake:0, clock:null, h:null };
  return g;
};

/* Everything about the car that is not where it is on the track: steering,
   the wheels turning, the active-aero flaps, the lights, damage and the pit
   stop. It reads the car's state and never writes to it. */
G3.carAnim = function(g, c, S, dt){
  const P = g.userData.parts, A = g.userData.anim, SP = CAR_SPEC;
  if(!P) return;
  const gone = c.broken || new Set();
  const v = (c.ai && c.railV != null) ? c.railV : Math.hypot(c.vx || 0, c.vy || 0);
  /* The wheels turn with the road, but never more than 0.3 rad in a frame: past
     that the markings would strobe (a tyre at 300 km/h turns 40 times a second)
     and seem to stand still or run backwards. Capped, they always roll forwards. */
  A.spinF = (A.spinF + Math.min(v * dt / SP.front.r, 0.3)) % TAU; A.spinR = (A.spinR + Math.min(v * dt / SP.rear.r, 0.3)) % TAU;
  // steering: the player's input directly; a rail-following car's from how fast it is turning
  let want = 0;
  if(!c.ai) want = clamp(c.steer || 0, -1, 1) * 0.35;
  else if(A.h != null && dt > 0){
    const yaw = angWrap(c.h - A.h) / dt;
    want = clamp(Math.atan(SP.wheelbase * yaw / Math.max(v, 4)), -0.35, 0.35);
  }
  A.h = c.h;
  A.steer += (want - A.steer) * (1 - Math.exp(-dt * 14));
  /* The pit stop (car/pitstop.js): the jacks lift each end 6 cm, and each wheel comes off and the new one goes
     on at its own moment. While a corner is off the car its wheel is in a mechanic's hands (render3d/pitcrew.js),
     so the car hides its own; once the new one is on it shows that, in the new compound. */
  const st = c.pp && c.pp.phase === "stopped" ? c.pp.st : null;
  const po = st ? stopPose(st, A.po || (A.po = {})) : null;
  let lift = 0, liftPitch = 0;
  if(po){ lift = 0.06 * (po.jackF + po.jackR) / 2; liftPitch = Math.atan2((po.jackF - po.jackR) * 0.06, SP.wheelbase); }
  const wheelOut = 0;
  g.userData.lift = lift; g.userData.liftPitch = liftPitch; g.userData.wheelOut = 0; g.userData.stopP = st ? clamp(st.t / Math.max(0.1, st.go + st.hold), 0, 1) : -1;
  const compound = (c.tyre && c.tyre.col) || TYRES.medium.col;
  const newKey = st && st.tyre && st.tyre !== "none" ? st.tyre : null;
  P.pivots.forEach((pv, i) => {
    let comp = compound;
    if(po && newKey) comp = po["c" + i] >= 2 ? TYRES[newKey].col : (TYRES[st.oldTyre] || TYRES.medium).col;
    const w = g.userData.wheels[i];
    if(w.userData.comp !== comp){ const ax = pv.userData.base.ax; w.geometry = CARGEO.wheel(this, ax.r, ax.w, comp, c.team.wheel || "#2A2D31"); w.userData.comp = comp; }
    // wear: eases down with the car's tyres, snaps up on a fresh set; a corner with the new tyre on is fresh
    if(i === 0){
      const cl = c.life != null ? c.life : 1;
      A.life = cl > A.life ? cl : A.life + (cl - A.life) * (1 - Math.exp(-dt * 6));
    }
    const fresh = po && newKey && po["c" + i] >= 2;
    this.setTyreWear(w.material, wearLook(fresh ? 1 : A.life, A.look || (A.look = {})));
  });
  P.compound = compound;
  const bent = gone.has("susp") && !(c.wheelOff >= 0) ? (c.idx % 4) : -1, flat = gone.has("punct") ? ((c.idx + 1) % 4) : -1;
  // a bent corner being fixed in the box straightens as the job goes on
  const unbend = po && st.rep && st.rep.susp ? 1 - clamp((st.t - st.rep.susp[0]) / Math.max(0.1, st.rep.susp[1] - st.rep.susp[0]), 0, 1) : 1;
  P.pivots.forEach((pv, i) => {
    const B = pv.userData.base, front = i >= 2, w = g.userData.wheels[i];
    pv.visible = !(c.wheelOff === i || c.wheelOff2 === i) && !(po && !st.corners[i].none && po["c" + i] >= 1 && po["c" + i] < 2);
    const out = wheelOut + (i === bent ? 0.34 * unbend : 0);
    pv.position.set(B.x, B.y - (i === flat ? 0.09 : 0) + wheelOut * 0.45, B.z + B.sd * out);
    pv.rotation.set(i === bent ? 0.42 * B.sd * unbend : 0, (front ? -A.steer : 0) + (i === bent ? 0.3 * unbend : 0), 0, "YXZ");
    pv.scale.set(1, i === flat ? 0.74 : 1, 1);
    w.rotation.z = -(front ? A.spinF : A.spinR);
  });
  // 2026 active aero: both wings' flaps lie flat under override, easing over about 0.15 s
  const boosting = c.boost > 0 && c.batt > 0.01;
  A.flap += ((boosting ? 1 : 0) - A.flap) * (1 - Math.exp(-dt / 0.05));
  P.rwFlap.rotation.z = -lerp(0.62, 0.08, A.flap);
  P.fwFlap.rotation.z = -lerp(0.0, -0.18, A.flap);
  // damage: the wings come off, the floor loses a chunk
  const noFront = gone.has("wing"), noRear = gone.has("rear");
  P.fw.visible = !noFront; P.fwStub.visible = noFront;
  // in the box, the broken wing is off the car once the crew have pulled it (render3d/pitcrew.js carries it)
  if(po && st.rep && st.rep.wing && st.t > lerp(st.rep.wing[0], st.rep.wing[1], 0.12)) P.fwStub.visible = false;
  P.rw.visible = !noRear; P.rwStub.visible = noRear;
  const chip = gone.has("floor"), dv = c.dentVer || 0, now = (S && S.clock) || 0;
  // the bodywork crumples where it was hit; rebuilt at most a few times a second while a car is being ground along a wall
  if(chip !== P.chipped || (dv !== P.dentVer && now - (P.dentT || -9) > 0.15)){
    P.chipped = chip; P.dentVer = dv; P.dentT = now;
    const base = P.fp ? CARGEO.cockpit(this, c.team, chip) : chip ? CARGEO.chipped(this, c.team) : CARGEO.team(this, c.team).body;
    if(P.ownGeo){ P.body.geometry.dispose(); P.ownGeo = false; }
    if(c.dents && c.dents.length){ P.body.geometry = CRASH.deformed(base, c.dents); P.ownGeo = true; }
    else P.body.geometry = base;
  }
  // a wing that survives a hit hangs from the nose a little lower, and a bit crooked
  let sagF = 0, sagR = 0, sideF = 0;
  if(c.dents) for(const d of c.dents){ if(d.x > 1.4){ sagF += d.mag; sideF += d.z * d.mag; } else if(d.x < -1.4) sagR += d.mag; }
  P.fw.rotation.set(clamp(sideF * 0.04, -0.12, 0.12), 0, -clamp(sagF * 0.05, 0, 0.12));
  P.rw.rotation.set(0, 0, clamp(sagR * 0.04, 0, 0.1));
  // the lights: brighter under braking, the rain light flashing in the wet, stuck on with broken brakes
  A.brake += (clamp(c.brk || 0, 0, 1) - A.brake) * (1 - Math.exp(-dt * 12));
  const wet = (S && S.wet > 0.2) ? (((S.clock || 0) * 4) % 1 < 0.5 ? 1 : 0.25) : 0;
  const night = S && S.track && S.track.night ? 0.35 : 0;
  const k = Math.max(0.30, night, wet, A.brake * (v > 3 ? 1 : 0.4), gone.has("brakes") ? 0.85 : 0);
  P.glowMat.color.setScalar(0.25 + k * 3.2);
};

/* merge a group's direct mesh children, material by material, keeping any
   named mesh or sub-group as it is */
G3.mergeChildren = function(group){
  const by = new Map();
  for(const o of group.children.slice()){
    if(!o.isMesh || o.name) continue;
    let a = by.get(o.material); if(!a){ a = []; by.set(o.material, a); } a.push(o);
  }
  for(const [mat, list] of by){
    if(list.length < 2) continue;
    const parts = list.map(m => { m.updateMatrix(); const q = (m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone()); q.applyMatrix4(m.matrix); return q; });
    let n = 0; for(const q of parts) n += q.attributes.position.count;
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
    let o = 0;
    for(const q of parts){ pos.set(q.attributes.position.array, o * 3); nor.set(q.attributes.normal.array, o * 3); o += q.attributes.position.count; q.dispose(); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = list.some(x => x.castShadow); m.receiveShadow = list.some(x => x.receiveShadow);
    for(const x of list){ group.remove(x); x.geometry.dispose(); }
    group.add(m);
  }
};

// Anything standing between the camera and your car is in the way. Work in the
// camera's own space: closer to the lens and overlapping you on screen means fade.
G3._v = null;
G3.fadeOccluders = function(S, p){
  if(!this.occluders || !this.occluders.length) return;
  const cam = this.cam || this.camIso;
  if(!cam) return;
  cam.updateMatrixWorld();
  if(!this._v){ this._v = new THREE.Vector3(); this._pv = new THREE.Vector3(); }
  const v = this._v, pv = this._pv;
  pv.set(p.x, p.z + 1, p.y).applyMatrix4(cam.matrixWorldInverse);
  for(const oc of this.occluders){
    v.set(oc.x, oc.z, oc.y).applyMatrix4(cam.matrixWorldInverse);
    // in camera space the lens looks down -z, so a larger z is nearer the camera
    const inFront = v.z > pv.z;
    const over = Math.abs(v.x - pv.x) < oc.rx + 14 && Math.abs(v.y - pv.y) < oc.ry + 14;
    // (from the cockpit nothing stands between you and your car)
    const want = (inFront && over && cam !== this.camFP) ? 0.22 : 1;
    oc.fade += (want - oc.fade) * 0.12;
    const o = oc.fade;
    for(const m of oc.meshes){
      const ms = Array.isArray(m.material) ? m.material : [m.material];
      for(const mm of ms){ mm.opacity = o; mm.transparent = o < 0.995; }
      m.castShadow = o > 0.6 && m.userData.wasCaster !== false;
    }
  }
};

