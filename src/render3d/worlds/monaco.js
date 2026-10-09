import * as THREE from 'three';
import { MGEO } from '../../tracks/survey/monaco.js';
import { TAU, clamp, mulberry } from '../../config/util.js';
import { R } from '../../render2d/view.js';
import { PTEX } from '../surfaces.js';
import { LB } from './vegas.js';
import { CITY } from './vegas-city.js';
import { CFG } from '../../config/settings.js';

/* ---------- 10d. Monaco, built from the survey ------------------------------
   The circuit runs on the real OpenStreetMap centreline, so everything else can
   sit where it really is: the ground from SRTM, the harbour and the Rock from the
   coastline, 3,400 buildings on their actual footprints, the piers, the pools,
   the gardens, the streets and the stairs. This builds all of it for the 3D
   renderer; the 2D fallback keeps its stylised Monaco.

   The road still owns its own height. The survey's ground is fitted to it:
   paved to road level under the sidewalks, a stone retaining wall where the
   hill rises behind, a balustrade where it drops away.
   ------------------------------------------------------------------------- */
const MONACO = {
  CELL:20,

  /* ---- where is the circuit from here? ---- */
  index(T){
    this.T = T;
    const C = this.CELL, map = new Map();
    for(let i = 0; i < T.n; i++){
      const k = Math.floor(T.x[i] / C) + "," + Math.floor(T.y[i] / C);
      let a = map.get(k); if(!a){ a = []; map.set(k, a); } a.push(i);
    }
    this.cells = map;
  },
  // nearest point on the centreline, with the side and the road height there
  near(x, y, maxR, skip){
    const T = this.T, C = this.CELL, cx = Math.floor(x / C), cy = Math.floor(y / C);
    const R = Math.ceil((maxR || 140) / C);
    let best = -1, bd = Infinity;
    for(let r = 0; r <= R; r++){
      for(let dx = -r; dx <= r; dx++) for(let dy = -r; dy <= r; dy++){
        if(Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const a = this.cells.get((cx + dx) + "," + (cy + dy));
        if(!a) continue;
        for(const i of a){
          // skip: leave out the stretch of road around this node, to find the next carriageway over
          if(skip != null){ const dd = Math.abs(i - skip); if(Math.min(dd, T.n - dd) < 6) continue; }
          const d = (T.x[i] - x) ** 2 + (T.y[i] - y) ** 2; if(d < bd){ bd = d; best = i; } }
      }
      if(best >= 0 && Math.sqrt(bd) < (r - 0.5) * C) break;
    }
    if(best < 0) return null;
    // refine onto the segment either side, so distance and height are smooth
    const n = T.n; let res = null;
    for(const j of [(best - 1 + n) % n, best]){
      const k = (j + 1) % n;
      const ax = T.x[j], ay = T.y[j], dx = T.x[k] - ax, dy = T.y[k] - ay, l2 = dx * dx + dy * dy || 1;
      const t = clamp(((x - ax) * dx + (y - ay) * dy) / l2, 0, 1);
      const px = ax + dx * t, py = ay + dy * t, d = Math.hypot(x - px, y - py);
      if(!res || d < res.d){
        const l = Math.sqrt(l2), side = ((x - px) * -dy + (y - py) * dx) / l;
        res = { i:t < 0.5 ? j : k, d, side:side >= 0 ? 1 : -1, z:T.z[j] + (T.z[k] - T.z[j]) * t };
      }
    }
    return res;
  },
  /* Push a footprint's corners back until they are a couple of metres beyond the
     barrier line, so no building, however important, stands on the track. */
  clear(P, gap){
    const T = this.T;
    return P.map(([x0, y0]) => {
      let x = x0, y = y0;
      for(let pass = 0; pass < 3; pass++){
        const q = this.near(x, y, 60); if(!q) break;
        const need = T.half + (q.side < 0 ? T.roL[q.i] : T.roR[q.i]) + gap;
        if(q.d >= need) break;
        // away from the nearest bit of road, not from the node
        const k = (q.i + 1) % T.n, dx = T.x[k] - T.x[q.i], dy = T.y[k] - T.y[q.i], l = Math.hypot(dx, dy) || 1;
        const nx = -dy / l * q.side, ny = dx / l * q.side, push = need - q.d + 0.05;
        x += nx * push; y += ny * push;
      }
      return [x, y];
    });
  },
  /* Anything that stands between the overhead camera and the hairpin or the last
     two turns is left out, so those corners can be seen. The camera looks down a
     fixed line (from the south-east, 35 degrees up), so for each bit of road in
     those stretches take the points along that line and note how high the line
     is there; a building whose roof is above the line at a point inside its
     footprint is in the way. */
  viewSamples(){
    const T = this.T, n = T.n, S = new Map(), d = Math.SQRT1_2, slope = Math.tan(35.264 * Math.PI / 180);
    for(const [a, b] of [[0.335, 0.395], [0.825, 0.935]]){
      for(let i = Math.round(a * n); i <= Math.round(b * n); i++){
        for(const o of [-T.half * 0.7, 0, T.half * 0.7]){
          const x = T.x[i] + T.nx[i] * o, y = T.y[i] + T.ny[i] * o, z = T.z[i] + 0.6;
          for(let t = 2; t <= 170; t += 3){
            const px = x + d * t, py = y + d * t, k = Math.floor(px / 8) + "," + Math.floor(py / 8);
            let l = S.get(k); if(!l){ l = []; S.set(k, l); } l.push(px, py, z + slope * t);
          }
        }
      }
    }
    return (this._view = S);
  },
  hidesRoad(P, top){
    const S = this._view || this.viewSamples();
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for(const [x, y] of P){ x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    for(let cx = Math.floor(x0 / 8); cx <= Math.floor(x1 / 8); cx++) for(let cy = Math.floor(y0 / 8); cy <= Math.floor(y1 / 8); cy++){
      const l = S.get(cx + "," + cy); if(!l) continue;
      for(let k = 0; k < l.length; k += 3){
        if(l[k + 2] - 26 >= top) continue;       // 26 m of slack: the buildings crowding the foreground too
        // inside the footprint?
        const x = l[k], y = l[k + 1]; let inside = false;
        for(let i = 0, j = P.length - 1; i < P.length; j = i++){
          const a = P[i], b = P[j];
          if((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
        }
        if(inside) return true;
      }
    }
    return false;
  },
  // how far the paving runs from the centreline before the town starts
  rin(i, side){ const T = this.T; return T.half + (side < 0 ? T.roL[i] : T.roR[i]) + 5.0; },

  /* ---- the ground ---- */
  // what the survey says, before the circuit is cut in
  raw(x, y){
    const M = this.M;
    if(!M.land(x, y)) return -7;
    // the waterfront is quays and sea walls: nothing slopes into the harbour
    return Math.max(M.dem(x, y) * this.zS, 2.4);
  },
  // and with the circuit cut in
  ground(x, y, pad){
    pad = pad || 0;                // the terrain mesh asks for a margin of one grid step, so no slope starts inside the road
    const q = this.near(x, y, 90);
    if(!q) return this.raw(x, y);
    const T = this.T;
    if(T.inTunnel(q.i) && q.d < T.half + 11) return q.z - 0.25;    // the tunnel's floor, under its roof
    const rin = this.rin(q.i, q.side) + pad;
    // Where the road doubles back (the hairpin, Beau Rivage over the harbour road),
    // a second carriageway may be close too. The ground follows the lowest road
    // whose margin covers the point: following the higher one would raise the
    // hillside straight through the road below.
    let q2 = null;
    if(q.d < 44){
      q2 = this.near(x, y, 52, q.i);
      if(q2 && (T.inTunnel(q2.i) || q2.d >= this.rin(q2.i, q2.side) + 7 + pad)) q2 = null;
    }
    const h = this.raw(x, y);
    const cs = q2 ? [q, q2] : [q];
    let out = Infinity;
    for(const c of cs) if(c.d < (c === q ? rin : this.rin(c.i, c.side) + pad)) out = Math.min(out, c.z - 0.25);
    if(out < Infinity) return out;
    // uphill, keep a terrace at road level for a few metres behind the wall so
    // the step lands behind it rather than as a ramp across the pavement
    for(const c of cs) if(h > c.z && c.d < (c === q ? rin : this.rin(c.i, c.side) + pad) + 7) out = Math.min(out, c.z - 0.25);
    return out < Infinity ? out : h;
  },

  build(G, world, T, S){
    const t0 = performance.now();
    this.G = G; this.T = T; this.S = S; this.night = T.night;
    this.zS = T.def.zScale || 1;
    this.M = MGEO.init(T.worldScale || 1);
    this.detail = CFG.detail !== 0;
    this.index(T);
    this.anim = [];
    this.fade = [];
    const g = new THREE.Group(); world.add(g);
    this.root = g;
    const steps = [["terrain", this.terrain], ["edges", this.edges], ["water", this.water], ["quays", this.quays],
                   ["greens", this.greens], ["streets", this.streets], ["buildings", this.buildings],
                   ["landmarks", this.landmarks], ["harbour", this.harbour], ["tunnel", this.tunnel],
                   ["dressing", this.dressing]];
    this.timing = {};
    for(const [name, fn] of steps){
      const a = performance.now();
      try{ fn.call(this, G, g, T, S); }catch(e){ console.warn("monaco " + name, e.message, e.stack); }
      this.timing[name] = +(performance.now() - a).toFixed(0);
    }
    // everything static and loose — grandstand rows, landmark parts, gantries,
    // signs — merges by material and by 260 m cell, like the rest of the scenery
    world.remove(g);
    const baked = G.bake(g, 260);
    world.add(baked); this.root = baked;
    this.timing.total = +(performance.now() - t0).toFixed(0);
    return baked;
  },

  /* ---- terrain: a fine grid over the town, a coarse one out to the Alps ---- */
  terrain(G, g, T){
    const M = this.M, sc = M.sc;
    const step = this.detail ? 8 : 12;
    const X0 = -1100 * sc, X1 = 1300 * sc, Y0 = -1450 * sc, Y1 = 1050 * sc;
    const nx = Math.ceil((X1 - X0) / step) + 1, ny = Math.ceil((Y1 - Y0) / step) + 1;
    const H = new Float32Array(nx * ny), Lm = new Uint8Array(nx * ny);
    for(let r = 0; r < ny; r++) for(let c = 0; c < nx; c++){
      const x = X0 + c * step, y = Y0 + r * step, k = r * nx + c;
      H[k] = this.ground(x, y, step * 0.75); Lm[k] = M.land(x, y) ? 1 : 0;
    }
    this.gridH = { H, nx, ny, X0, Y0, step };
    // colour by what the ground is: paving in town, green in the gardens, grey
    // rock on the cliffs, and a darker band where the hill is steep
    const pos = [], col = [], idx = [];
    const vid = new Int32Array(nx * ny).fill(-1);
    const cPave = G.col("#D8CFBE"), cHill = G.col("#B8AA90"), cRock = G.col("#9E9282"), cScrub = G.col("#7E8A5A");
    const tmp = new THREE.Color();
    const addV = (r, c) => {
      const k = r * nx + c;
      if(vid[k] >= 0) return vid[k];
      const x = X0 + c * step, y = Y0 + r * step, h = H[k];
      pos.push(x, h, y);
      // slope from the neighbours
      const hx = H[r * nx + Math.min(nx - 1, c + 1)] - H[r * nx + Math.max(0, c - 1)];
      const hy = H[Math.min(ny - 1, r + 1) * nx + c] - H[Math.max(0, r - 1) * nx + c];
      const slope = Math.hypot(hx, hy) / (2 * step);
      tmp.copy(cPave);
      if(h > 70 * this.zS) tmp.lerp(cScrub, clamp((h - 70) / 60, 0, 0.75));
      if(slope > 0.45) tmp.lerp(cRock, clamp((slope - 0.45) / 0.6, 0, 1));
      else if(slope > 0.18) tmp.lerp(cHill, clamp((slope - 0.18) / 0.3, 0, 1));
      col.push(tmp.r, tmp.g, tmp.b);
      return (vid[k] = pos.length / 3 - 1);
    };
    const CH = Math.round(200 / step), chunkIdx = new Map();
    for(let r = 0; r < ny - 1; r++) for(let c = 0; c < nx - 1; c++){
      const k = r * nx + c;
      // under water all round: the sea floor is never seen
      if(!Lm[k] && !Lm[k + 1] && !Lm[k + nx] && !Lm[k + nx + 1]) continue;
      const a = addV(r, c), b = addV(r, c + 1), d = addV(r + 1, c), e = addV(r + 1, c + 1);
      const ck = Math.floor(r / CH) * 1000 + Math.floor(c / CH);
      let arr = chunkIdx.get(ck); if(!arr){ arr = []; chunkIdx.set(ck, arr); }
      arr.push(a, d, b, b, d, e);
      idx.push(a, d, b, b, d, e);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx); geo.computeVertexNormals();
    const tex = PTEX.paving();
    const mat = new THREE.MeshStandardMaterial({ vertexColors:true, roughness:0.93, metalness:0,
      map:tex, envMapIntensity:0.6 });
    // world-space UVs so the paving tiles at its real size
    const uv = new Float32Array(pos.length / 3 * 2);
    for(let i = 0; i < pos.length / 3; i++){ uv[i * 2] = pos[i * 3] / 6; uv[i * 2 + 1] = pos[i * 3 + 2] / 6; }
    geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    // one mesh per chunk, all drawing from the same vertex buffers
    this.terrainGeo = geo;
    for(const arr of chunkIdx.values()){
      const cg2 = new THREE.BufferGeometry();
      for(const nm of ["position", "normal", "color", "uv"]) cg2.setAttribute(nm, geo.attributes[nm]);
      cg2.setIndex(arr); cg2.computeBoundingSphere();
      const m = new THREE.Mesh(cg2, mat);
      m.receiveShadow = true; m.castShadow = true; m.userData.dynamic = true;
      g.add(m);
    }
    this.terrainTris = idx.length / 3;

    /* the country beyond: the coarse grid out to Mont Agel and Tête de Chien.
       No shadows, and the haze takes most of it. */
    const cg = M.ter.coarse, N = cg.N, Mm = cg.M, cpos = [], cidx = [], ccol = [];
    const cFar = G.col("#8C9278"), cFarHigh = G.col("#A8A48E");
    for(let r = 0; r < N; r++) for(let c = 0; c < Mm; c++){
      const x = (cg.x0 + (cg.x1 - cg.x0) * c / (Mm - 1)) * sc, y = (cg.y0 + (cg.y1 - cg.y0) * r / (N - 1)) * sc;
      let h = cg.h[r * Mm + c] * this.zS;
      // inside the fine grid, sink it out of the way
      const inside = x > X0 + 60 && x < X1 - 60 && y > Y0 + 60 && y < Y1 - 60;
      if(inside) h = Math.min(h, -20);
      else if(h < 1) h = -8;
      cpos.push(x, h, y);
      tmp.copy(cFar).lerp(cFarHigh, clamp(h / 900, 0, 1));
      ccol.push(tmp.r, tmp.g, tmp.b);
    }
    for(let r = 0; r < N - 1; r++) for(let c = 0; c < Mm - 1; c++){
      const k = r * Mm + c;
      cidx.push(k, k + Mm, k + 1, k + 1, k + Mm, k + Mm + 1);
    }
    const cgeo = new THREE.BufferGeometry();
    cgeo.setAttribute("position", new THREE.Float32BufferAttribute(cpos, 3));
    cgeo.setAttribute("color", new THREE.Float32BufferAttribute(ccol, 3));
    cgeo.setIndex(cidx); cgeo.computeVertexNormals();
    const cm = new THREE.Mesh(cgeo, new THREE.MeshStandardMaterial({ vertexColors:true, roughness:1, metalness:0 }));
    cm.userData.dynamic = true; cm.frustumCulled = false; g.add(cm);
  },

  /* ---- where the circuit meets the ground: pavements, walls, balustrades ---- */
  edges(G, g, T){
    const n = T.n, w = T.half;
    const pave = G.mat("#CFC6B4", { roughness:0.92 }), kerbStone = G.mat("#B8B0A0", { roughness:0.9 });
    const stone = G.faceMat("stone", "#C9B99C", false, { roughness:0.9 });
    const rail = G.mat("#EDEAE2", { roughness:0.6 });
    const posts = [];
    for(const sd of [-1, 1]){
      const rf = i => (sd < 0 ? T.roL[i] : T.roR[i]);
      const inner = i => sd * (w + rf(i) + 1.4), outer = i => sd * this.rin(i, sd);
      // the pavement, a kerb's height above the road
      G.add(g, G.strip(T, inner, outer, 0.14, 4, i => !T.inTunnel(i)), pave);
      // what the ground does just behind it
      const back = new Float64Array(n), has = new Uint8Array(n);
      for(let i = 0; i < n; i++){
        if(T.inTunnel(i)) continue;
        const o = this.rin(i, sd) + 3;
        const x = T.x[i] + T.nx[i] * sd * o, y = T.y[i] + T.ny[i] * sd * o;
        // another part of the lap is closer there: leave that to its own edge
        const q = this.near(x, y, 40);
        if(q && Math.min(Math.abs(q.i - i), n - Math.abs(q.i - i)) > 6) continue;
        back[i] = this.raw(x, y); has[i] = 1;
      }
      // smooth along the lap so the wall tops run level, not in steps
      const bs = new Float64Array(back);
      for(let p = 0; p < 3; p++) for(let i = 0; i < n; i++){
        if(!has[i]) continue;
        const a = has[(i - 1 + n) % n] ? bs[(i - 1 + n) % n] : bs[i], b = has[(i + 1) % n] ? bs[(i + 1) % n] : bs[i];
        bs[i] = (a + 2 * bs[i] + b) / 4;
      }
      const up = i => has[i] && bs[i] - T.z[i] > 1.2;
      const down = i => has[i] && T.z[i] - bs[i] > 1.2;
      // retaining walls where the hill rises behind the pavement, per node
      const wallGeo = (filter, top, bot) => {
        const pos = [], uv = [], idx = []; let v = 0;
        for(let i = 0; i < n; i++){
          const j = (i + 1) % n;
          if(!filter(i) || !filter(j)) continue;
          const oa = outer(i), ob = outer(j);
          const ax = T.x[i] + T.nx[i] * oa, ay = T.y[i] + T.ny[i] * oa, bx = T.x[j] + T.nx[j] * ob, by = T.y[j] + T.ny[j] * ob;
          pos.push(ax, bot(i), ay, bx, bot(j), by, bx, top(j), by, ax, top(i), ay);
          const u0 = i * T.ds / 3, u1 = (i + 1) * T.ds / 3;
          uv.push(u0, bot(i) / 3, u1, bot(j) / 3, u1, top(j) / 3, u0, top(i) / 3);
          idx.push(v, v + 1, v + 2, v, v + 2, v + 3); v += 4;
        }
        if(!pos.length) return null;
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
        geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
        geo.setIndex(idx); geo.computeVertexNormals();
        return geo;
      };
      // No stone retaining walls: they read as huge brown curtains. The terrain
      // already holds a shoulder at road level and slopes away from it, so the
      // hill rises or falls from the pavement edge. Where it falls away, a
      // balustrade goes on top.
      const gb = wallGeo(down, i => T.z[i] + 1.05, i => T.z[i] + 0.95);
      if(gb){ const m = new THREE.Mesh(gb, G.twoSided(rail)); g.add(m); }
      for(let i = 0; i < n; i++) if(down(i)){
        const o = outer(i);
        for(const f of [0, 0.5]){
          const j = (i + 1) % n, x = T.x[i] + (T.x[j] - T.x[i]) * f + T.nx[i] * o, y = T.y[i] + (T.y[j] - T.y[i]) * f + T.ny[i] * o;
          posts.push([x, y, T.z[i] + 0.14, 0, 1]);
        }
      }
    }
    if(posts.length){
      // balusters: little turned posts, instanced
      const pts = [new THREE.Vector2(0.10, 0), new THREE.Vector2(0.13, 0.12), new THREE.Vector2(0.07, 0.35),
                   new THREE.Vector2(0.12, 0.6), new THREE.Vector2(0.07, 0.8), new THREE.Vector2(0.10, 0.85)];
      const bg = new THREE.LatheGeometry(pts, 6);
      LB.many(G, g, bg, G.mat("#EDEAE2", { roughness:0.6 }), posts, false);
    }
  },

  /* ---- the sea ----
     One tuned standard material rather than a bespoke shader, so it takes the
     environment map, the sun, fog and shadows like everything else. Two ripple
     layers scroll against each other through a patched normal-map line; the
     colour runs turquoise at the quays to deep Mediterranean blue offshore. */
  water(G, g, T){
    const M = this.M, sc = M.sc;
    // distance to land, on a coarse raster, for the colour
    const S = 12, X0 = -1500 * sc, Y0 = -1520 * sc, W = Math.ceil(3000 * sc / S), H = Math.ceil(2820 * sc / S);
    const dist = new Float32Array(W * H).fill(1e9);
    const q = [];
    for(let r = 0; r < H; r++) for(let c = 0; c < W; c++){
      if(M.land(X0 + (c + 0.5) * S, Y0 + (r + 0.5) * S)){ dist[r * W + c] = 0; q.push(r * W + c); }
    }
    // a cheap two-pass chamfer distance
    const pass = (dir) => {
      const r0 = dir > 0 ? 0 : H - 1, c0 = dir > 0 ? 0 : W - 1;
      for(let r = r0; r >= 0 && r < H; r += dir) for(let c = c0; c >= 0 && c < W; c += dir){
        const k = r * W + c; let d = dist[k];
        const pr = r - dir, pc = c - dir;
        if(pr >= 0 && pr < H) d = Math.min(d, dist[pr * W + c] + S);
        if(pc >= 0 && pc < W) d = Math.min(d, dist[r * W + pc] + S);
        if(pr >= 0 && pr < H && pc >= 0 && pc < W) d = Math.min(d, dist[pr * W + pc] + S * 1.414);
        dist[k] = d;
      }
    };
    pass(1); pass(-1);
    this.seaDist = { dist, W, H, X0, Y0, S };

    const cNear = G.col("#3FC4C8"), cMid = G.col("#1E8FB4"), cDeep = G.col("#0B4A86"), tmp = new THREE.Color();
    const gx = 160, gy = 150;
    const geo = new THREE.PlaneGeometry(W * S, H * S, gx, gy);
    geo.rotateX(-Math.PI / 2);
    geo.translate(X0 + W * S / 2, 0, Y0 + H * S / 2);
    const p = geo.attributes.position, colr = new Float32Array(p.count * 3);
    for(let i = 0; i < p.count; i++){
      const x = p.getX(i), y = p.getZ(i);
      const c = clamp(Math.floor((x - X0) / S), 0, W - 1), r = clamp(Math.floor((y - Y0) / S), 0, H - 1);
      const d = dist[r * W + c];
      tmp.copy(cNear).lerp(cMid, clamp(d / 70, 0, 1)).lerp(cDeep, clamp((d - 70) / 260, 0, 1));
      colr[i * 3] = tmp.r; colr[i * 3 + 1] = tmp.g; colr[i * 3 + 2] = tmp.b;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colr, 3));
    const nrm = PTEX.ripples();
    const mat = new THREE.MeshStandardMaterial({ vertexColors:true, color:0xffffff, roughness:0.10, metalness:0.0,
      normalMap:nrm, normalScale:new THREE.Vector2(0.55, 0.55), envMapIntensity:1.35, transparent:false });
    mat.onBeforeCompile = sh => {
      sh.uniforms.uW1 = { value:new THREE.Vector2() };
      sh.uniforms.uW2 = { value:new THREE.Vector2() };
      this.waterU = sh.uniforms;
      sh.fragmentShader = "uniform vec2 uW1;\nuniform vec2 uW2;\n" + sh.fragmentShader.replace("#include <normal_fragment_maps>",
        THREE.ShaderChunk.normal_fragment_maps.replace("vec3 mapN = texture2D( normalMap, vUv ).xyz * 2.0 - 1.0;",
          "vec3 mapN = normalize((texture2D( normalMap, vUv + uW1 ).xyz * 2.0 - 1.0) + (texture2D( normalMap, vUv * 0.61 + uW2 ).xyz * 2.0 - 1.0) + vec3(0.0, 0.0, 0.6));"));
    };
    mat.customProgramCacheKey = () => "monacoWater";
    const m = new THREE.Mesh(geo, mat);
    m.receiveShadow = true; m.userData.dynamic = true;
    g.add(m);
    // world-space ripple scale
    const uv = geo.attributes.uv;
    for(let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / 34, p.getZ(i) / 34);
    uv.needsUpdate = true;
    // and the open sea beyond, deep blue, out to the horizon
    const far = new THREE.Mesh(new THREE.PlaneGeometry(40000, 40000, 1, 1),
      new THREE.MeshStandardMaterial({ color:cDeep, roughness:0.18, metalness:0, envMapIntensity:1.0 }));
    far.rotation.x = -Math.PI / 2; far.position.set(0, -0.35, 6000); far.userData.dynamic = true; far.frustumCulled = false;
    g.add(far);
    this.anim.push(t => {
      if(!this.waterU) return;
      this.waterU.uW1.value.set(t * 0.011, t * 0.017);
      this.waterU.uW2.value.set(-t * 0.014, t * 0.006);
    });
  },

  /* ---- quays, piers, pontoons and the Digue ---- */
  quays(G, g, T){
    const M = this.M;
    const stone = G.faceMat("stone", "#CBBFA6", false, { roughness:0.9 });
    const concrete = G.mat("#D6D2C8", { roughness:0.88 });
    const deck = G.mat("#9C8466", { roughness:0.85 });
    const foamPos = [], foamIdx = []; let fv = 0;
    const foam = (ax, ay, bx, by, sd) => {
      // a pale line on the water hugging the wall; which side is water is sd
      const dx = bx - ax, dy = by - ay, l = Math.hypot(dx, dy) || 1, nx = -dy / l * sd, ny = dx / l * sd;
      foamPos.push(ax, 0.04, ay, bx, 0.04, by, bx + nx * 1.6, 0.04, by + ny * 1.6, ax + nx * 1.6, 0.04, ay + ny * 1.6);
      foamIdx.push(fv, fv + 1, fv + 2, fv, fv + 2, fv + 3); fv += 4;
    };
    // sea walls along the whole coast: from below the water to the quay top
    const wp = [], wi = [], wu = []; let v = 0;
    for(const ln of (M.line.coast || [])){
      for(let k = 0; k < ln.length - 1; k++){
        const [ax, ay] = ln[k], [bx, by] = ln[k + 1];
        const L = Math.hypot(bx - ax, by - ay); if(L < 0.2) continue;
        // which side is land? probe a couple of metres across
        const nx = -(by - ay) / L, ny = (bx - ax) / L;
        const mx = (ax + bx) / 2, my = (ay + by) / 2;
        const landSide = M.land(mx + nx * 3, my + ny * 3) ? 1 : -1;
        const topA = Math.max(2.4, this.raw(ax + nx * landSide * 4, ay + ny * landSide * 4));
        const topB = Math.max(2.4, this.raw(bx + nx * landSide * 4, by + ny * landSide * 4));
        const ta = Math.min(topA, 2.4 + 60), tb = Math.min(topB, 2.4 + 60);
        wp.push(ax, -3, ay, bx, -3, by, bx, tb, by, ax, ta, ay);
        wu.push(0, -1, L / 3, -1, L / 3, tb / 3, 0, ta / 3);
        wi.push(v, v + 1, v + 2, v, v + 2, v + 3); v += 4;
        foam(ax, ay, bx, by, -landSide);
      }
    }
    if(wp.length){
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(wp, 3));
      geo.setAttribute("uv", new THREE.Float32BufferAttribute(wu, 2));
      geo.setIndex(wi); geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, G.twoSided(stone)); m.receiveShadow = true; m.userData.dynamic = true; g.add(m);
    }
    // the quay top: a paved band inland of the wall, at the wall's own height,
    // laid over the terrain grid's ragged edge. It stops short of the circuit.
    { const qp = [], qi = [], qu = []; let qv = 0;
      for(const ln of (M.line.coast || [])){
        for(let k = 0; k < ln.length - 1; k++){
          const [ax, ay] = ln[k], [bx, by] = ln[k + 1];
          const L = Math.hypot(bx - ax, by - ay); if(L < 0.2) continue;
          const nx = -(by - ay) / L, ny = (bx - ax) / L;
          const landSide = M.land((ax + bx) / 2 + nx * 3, (ay + by) / 2 + ny * 3) ? 1 : -1;
          const ix = nx * landSide * 9, iy = ny * landSide * 9;
          const pts = [[ax, ay], [bx, by], [bx + ix, by + iy], [ax + ix, ay + iy]];
          let ok = true, top = Infinity;
          for(const [x, y] of pts){
            const q = this.near(x, y, 30);
            if(q && q.d < this.rin(q.i, q.side) + 1){ ok = false; break; }
            top = Math.min(top, Math.max(2.4, this.raw(x, y)));
          }
          if(!ok || top > 12) continue;          // cliffs are the cliff pass's business
          for(const [x, y] of pts){ qp.push(x, top + 0.04, y); qu.push(x / 6, y / 6); }
          if(landSide > 0) qi.push(qv, qv + 3, qv + 1, qv + 1, qv + 3, qv + 2);
          else qi.push(qv, qv + 1, qv + 3, qv + 1, qv + 2, qv + 3);
          qv += 4;
        }
      }
      if(qp.length){
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.Float32BufferAttribute(qp, 3));
        geo.setAttribute("uv", new THREE.Float32BufferAttribute(qu, 2));
        geo.setIndex(qi); geo.computeVertexNormals();
        const mat = new THREE.MeshStandardMaterial({ map:PTEX.paving(), color:G.col("#E4DCCB"), roughness:0.92, side:THREE.DoubleSide,
          polygonOffset:true, polygonOffsetFactor:-1, polygonOffsetUnits:-1 });
        const m = new THREE.Mesh(geo, mat); m.receiveShadow = true; m.userData.dynamic = true; g.add(m);
      }
    }
    // piers: concrete jetties stand proud, narrow pontoons float low
    const piers = (M.poly.pier || []);
    this.piers = [];
    const bollards = [];
    for(const ring of piers){
      if(ring.length < 3) continue;
      let A = 0, P = 0;
      for(let k = 0; k < ring.length; k++){
        const a = ring[k], b = ring[(k + 1) % ring.length];
        A += a[0] * b[1] - b[0] * a[1]; P += Math.hypot(b[0] - a[0], b[1] - a[1]);
      }
      A = Math.abs(A) / 2;
      const width = A / (P / 2);
      const pontoon = width < 5.5;
      const top = pontoon ? 0.7 : 2.3;
      const shape = new THREE.Shape(ring.map(([x, y]) => new THREE.Vector2(x, y)));
      const geo = new THREE.ExtrudeGeometry(shape, { depth:top + 3, bevelEnabled:false });
      geo.rotateX(Math.PI / 2); geo.translate(0, top, 0);
      // ExtrudeGeometry builds along +z; rotating +90 about x sends y to z, so the
      // shape keeps its game-space x/y as world x/z
      const m = new THREE.Mesh(geo, [pontoon ? deck : concrete, G.twoSided(stone)]);
      m.receiveShadow = true; m.castShadow = !pontoon; m.userData.dynamic = true;
      g.add(m);
      this.piers.push({ ring, top, pontoon, width, area:A });
      for(let k = 0; k < ring.length; k++){
        const a = ring[k], b = ring[(k + 1) % ring.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        foam(a[0], a[1], b[0], b[1], 1); foam(a[0], a[1], b[0], b[1], -1);
        if(!pontoon) for(let s = 3; s < L - 2; s += 9) bollards.push([a[0] + (b[0] - a[0]) * s / L, a[1] + (b[1] - a[1]) * s / L, top, 0, 1]);
      }
    }
    if(bollards.length){
      const bg = new THREE.CylinderGeometry(0.22, 0.28, 0.7, 8); bg.translate(0, 0.35, 0);
      LB.many(G, g, bg, G.mat("#2A2C30", { roughness:0.5, metalness:0.5 }), bollards, false);
    }
    // the lighthouse on the end of the Digue: the pier furthest out to sea
    let best = null;
    for(const p of this.piers){
      for(const [x, y] of p.ring){
        const d = this.seaDistAt(x, y);
        if(!best || d > best.d) best = { d, x, y, top:p.top };
      }
    }
    if(best){
      this.lighthouse = best;
      const lh = new THREE.Group();
      LB.cyl(G, lh, best.x, best.y, best.top, 2.4, 1.9, 13, G.mat("#F2F0EA", { roughness:0.6 }), 16);
      LB.cyl(G, lh, best.x, best.y, best.top + 13, 2.2, 2.2, 1.4, G.mat("#C8302A"), 16);
      LB.cyl(G, lh, best.x, best.y, best.top + 14.4, 1.3, 1.3, 2.2, G.glowMat("#FFE8B0", 1.2), 12);
      LB.cone(G, lh, best.x, best.y, best.top + 16.6, 1.8, 2.2, G.mat("#C8302A"), 12);
      lh.traverse(o => { if(o.isMesh) o.userData.dynamic = true; });
      g.add(lh);
    }
    if(foamPos.length){
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(foamPos, 3));
      const u = []; for(let k = 0; k < foamPos.length / 12; k++) u.push(0, 0, 1, 0, 1, 1, 0, 1);
      geo.setAttribute("uv", new THREE.Float32BufferAttribute(u, 2));
      geo.setIndex(foamIdx);
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map:PTEX.foam(), transparent:true, opacity:0.55,
        depthWrite:false, color:0xffffff, side:THREE.DoubleSide }));
      m.userData.dynamic = true; m.renderOrder = 2; g.add(m);
    }
  },
  seaDistAt(x, y){
    const s = this.seaDist; if(!s) return 0;
    const c = clamp(Math.floor((x - s.X0) / s.S), 0, s.W - 1), r = clamp(Math.floor((y - s.Y0) / s.S), 0, s.H - 1);
    return s.dist[r * s.W + c];
  },

  /* ---- scanline-fill a set of polygons onto a grid: cheap point-in-polygon for
     tens of thousands of lookups ---- */
  raster(rings, X0, Y0, step, nx, ny, out, val){
    for(const ring of rings){
      let y0 = Infinity, y1 = -Infinity;
      for(const [, y] of ring){ y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      const r0 = Math.max(0, Math.floor((y0 - Y0) / step)), r1 = Math.min(ny - 1, Math.ceil((y1 - Y0) / step));
      for(let r = r0; r <= r1; r++){
        const y = Y0 + r * step, xs = [];
        for(let k = 0; k < ring.length; k++){
          const a = ring[k], b = ring[(k + 1) % ring.length];
          if((a[1] <= y) !== (b[1] <= y)) xs.push(a[0] + (y - a[1]) / (b[1] - a[1]) * (b[0] - a[0]));
        }
        xs.sort((p, q) => p - q);
        for(let k = 0; k + 1 < xs.length; k += 2){
          const c0 = Math.max(0, Math.ceil((xs[k] - X0) / step)), c1 = Math.min(nx - 1, Math.floor((xs[k + 1] - X0) / step));
          for(let c = c0; c <= c1; c++) out[r * nx + c] = val;
        }
      }
    }
  },

  /* ---- gardens, woods, the Rock's cliffs, pools and trees ---- */
  greens(G, g, T){
    const M = this.M, GH = this.gridH;
    // recolour the terrain under the green spaces rather than laying patches on
    // it: the ground follows the hill exactly, and it costs nothing
    const cls = new Uint8Array(GH.nx * GH.ny);
    this.raster(M.poly.green || [], GH.X0, GH.Y0, GH.step, GH.nx, GH.ny, cls, 1);
    this.raster(M.poly.pitch || [], GH.X0, GH.Y0, GH.step, GH.nx, GH.ny, cls, 1);
    this.raster(M.poly.wood || [], GH.X0, GH.Y0, GH.step, GH.nx, GH.ny, cls, 2);
    this.raster(M.poly.rock || [], GH.X0, GH.Y0, GH.step, GH.nx, GH.ny, cls, 3);
    this.raster(M.poly.beach || [], GH.X0, GH.Y0, GH.step, GH.nx, GH.ny, cls, 4);
    this.greenCls = cls;
    const terr = this.terrainGeo ? { geometry:this.terrainGeo } : null;
    if(terr){
      const p = terr.geometry.attributes.position, c = terr.geometry.attributes.color;
      const COLS = [null, G.col("#7E9A58"), G.col("#5E7A44"), G.col("#A09684"), G.col("#E4D6B4")];
      for(let i = 0; i < p.count; i++){
        const cc = Math.round((p.getX(i) - GH.X0) / GH.step), rr = Math.round((p.getZ(i) - GH.Y0) / GH.step);
        const k = cls[clamp(rr, 0, GH.ny - 1) * GH.nx + clamp(cc, 0, GH.nx - 1)];
        if(k) c.setXYZ(i, COLS[k].r, COLS[k].g, COLS[k].b);
      }
      c.needsUpdate = true;
    }
    // the Rock's cliffs: bare limestone faces from the sea up to the top
    const cliff = G.faceMat("stone", "#BCAE94", false, { roughness:0.95 });
    const cp = [], ci = [], cu = []; let v = 0;
    for(const ln of (M.line.cliff || [])){
      for(let k = 0; k < ln.length - 1; k++){
        const [ax, ay] = ln[k], [bx, by] = ln[k + 1];
        const L = Math.hypot(bx - ax, by - ay); if(L < 0.5) continue;
        // OSM draws cliffs with the drop on the right: top on the left
        const nx = -(by - ay) / L, ny = (bx - ax) / L;
        const top = h => Math.max(h, 3);
        const ta = top(this.raw(ax - nx * 4, ay - ny * 4)), tb = top(this.raw(bx - nx * 4, by - ny * 4));
        const ba = Math.min(ta - 3, this.raw(ax + nx * 6, ay + ny * 6)), bb = Math.min(tb - 3, this.raw(bx + nx * 6, by + ny * 6));
        cp.push(ax, ba, ay, bx, bb, by, bx, tb, by, ax, ta, ay);
        cu.push(0, ba / 4, L / 4, bb / 4, L / 4, tb / 4, 0, ta / 4);
        ci.push(v, v + 1, v + 2, v, v + 2, v + 3); v += 4;
      }
    }
    if(cp.length){
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(cp, 3));
      geo.setAttribute("uv", new THREE.Float32BufferAttribute(cu, 2));
      geo.setIndex(ci); geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, G.twoSided(cliff)); m.castShadow = true; m.receiveShadow = true;
      m.userData.dynamic = true; g.add(m);
    }
    // swimming pools, the bright blue of every hotel terrace in town
    const poolMat = new THREE.MeshStandardMaterial({ color:G.col("#2FB8E0"), roughness:0.08, metalness:0,
      emissive:G.col("#0E6A8A"), emissiveIntensity:0.35, envMapIntensity:1.2 });
    const coping = G.mat("#F0ECE2", { roughness:0.8 });
    for(const ring of (M.poly.pool || [])){
      if(ring.length < 3) continue;
      let cx = 0, cy = 0; for(const [x, y] of ring){ cx += x; cy += y; } cx /= ring.length; cy /= ring.length;
      const q = this.near(cx, cy, 20); if(q && q.d < this.rin(q.i, q.side)) continue;
      let z = -Infinity; for(const [x, y] of ring) z = Math.max(z, this.ground(x, y));
      const shape = new THREE.Shape(ring.map(([x, y]) => new THREE.Vector2(x, y)));
      const geo = new THREE.ExtrudeGeometry(shape, { depth:0.5, bevelEnabled:false });
      geo.rotateX(Math.PI / 2); geo.translate(0, z + 0.25, 0);
      const m = new THREE.Mesh(geo, [poolMat, coping]);
      m.receiveShadow = true; m.userData.dynamic = true; g.add(m);
    }
    // trees: every mapped one, plus planting through the gardens and woods
    const rnd = mulberry(90210);
    const list = { pine:[], palm:[], cypress:[], broad:[] };
    const put = (x, y, kindHint) => {
      if(!M.land(x, y)) return;
      const q = this.near(x, y, 30); if(q && q.d < this.rin(q.i, q.side) + 1) return;
      if(q && this.T.pitRamp(q.i) > 0.02 && q.d < this.T.half + this.T.pitW + 18) return;      // keep the pit lane and its crew in view
      const z = this.ground(x, y);
      const nearSea = this.seaDistAt(x, y) < 60;
      let k = kindHint || (nearSea ? (rnd() < 0.7 ? "palm" : "pine") :
              (r => r < 0.34 ? "pine" : r < 0.56 ? "palm" : r < 0.74 ? "cypress" : "broad")(rnd()));
      const s = 0.8 + rnd() * 0.5;
      list[k].push([x, y, z, rnd() * TAU, s]);
    };
    for(const [x, y] of M.trees) put(x, y);
    const GH2 = this.gridH;
    for(let r = 0; r < GH2.ny; r++) for(let c = 0; c < GH2.nx; c++){
      const k = cls[r * GH2.nx + c];
      if(k !== 1 && k !== 2) continue;
      if(rnd() > (k === 2 ? 0.55 : 0.22) * (this.detail ? 1 : 0.5)) continue;
      put(GH2.X0 + (c + rnd() - 0.5) * GH2.step, GH2.Y0 + (r + rnd() - 0.5) * GH2.step, k === 2 ? (rnd() < 0.5 ? "pine" : "broad") : null);
    }
    this.trees(G, g, list);
  },

  /* four tree species, each an instanced trunk and an instanced canopy */
  trees(G, g, list){
    const bark = G.mat("#6A5440", { roughness:0.95 }), pineGreen = G.mat("#3E5A2E", { roughness:0.9 });
    const palmGreen = G.mat("#4E7A36", { roughness:0.85 }), cypGreen = G.mat("#2E4A26", { roughness:0.9 }),
          broadGreen = G.mat("#5A7E3A", { roughness:0.9 });
    const one = (items, trunk, crown, tm, cm) => {
      if(!items.length) return;
      LB.many(G, g, trunk, tm, items, true);
      LB.many(G, g, crown, cm, items, true);
    };
    // the umbrella pine: a tall bare trunk and a wide flat crown
    { const t = new THREE.CylinderGeometry(0.28, 0.45, 9, 6); t.translate(0, 4.5, 0);
      const c = new THREE.SphereGeometry(5.2, 10, 6); c.scale(1, 0.34, 1); c.translate(0, 9.6, 0);
      one(list.pine, t, c, bark, pineGreen); }
    // the palm: a leaning ringed trunk and a burst of fronds
    { const t = new THREE.CylinderGeometry(0.22, 0.34, 10, 6); t.translate(0, 5, 0);
      const fr = [];
      for(let k = 0; k < 8; k++){
        const f = new THREE.BoxGeometry(4.4, 0.12, 0.8);
        f.translate(2.0, 0, 0); f.rotateZ(-0.35); f.rotateY(k / 8 * TAU); f.translate(0, 10, 0);
        fr.push(f);
      }
      const c = LB.merge(fr);
      one(list.palm, t, c, G.mat("#8A7458", { roughness:0.9 }), palmGreen); }
    // the cypress: a dark, narrow flame
    { const t = new THREE.CylinderGeometry(0.2, 0.25, 1.5, 5); t.translate(0, 0.75, 0);
      const c = new THREE.ConeGeometry(1.5, 11, 8); c.translate(0, 6.8, 0);
      one(list.cypress, t, c, bark, cypGreen); }
    // a round broadleaf: plane trees and the like
    { const t = new THREE.CylinderGeometry(0.3, 0.42, 4, 6); t.translate(0, 2, 0);
      const c = new THREE.IcosahedronGeometry(3.6, 1); c.scale(1, 0.85, 1); c.translate(0, 6.2, 0);
      one(list.broad, t, c, bark, broadGreen); }
    this.treeCount = list.pine.length + list.palm.length + list.cypress.length + list.broad.length;
  },

  /* ---- the streets that meet the circuit, and the stairs between levels ---- */
  streets(G, g, T){
    const M = this.M;
    const WID = [10.5, 7.5, 5.0, 5.0, 3.0];
    const mats = [G.mat("#4E5258", { roughness:0.92 }), G.mat("#55595F", { roughness:0.92 }),
                  G.mat("#60646A", { roughness:0.92 }), G.mat("#D4CAB6", { roughness:0.92 }),
                  new THREE.MeshStandardMaterial({ map:PTEX.stairs(), color:G.col("#E2DACB"), roughness:0.9 })];
    const walkMat = G.mat("#CFC6B4", { roughness:0.92 }), paint = G.mat("#E8E6DE", { roughness:0.85 });
    for(let cl = 0; cl < 5; cl++){
      const pos = [], uv = [], idx = [], sw = [], swi = []; let v = 0, sv = 0;
      const dash = [], dashI = []; let dv = 0;
      for(const line of (M.streets[cl] || [])){
        // resample every 5 m and drop whatever lies on the circuit
        const pts = [];
        for(let k = 0; k < line.length - 1; k++){
          const [ax, ay] = line[k], [bx, by] = line[k + 1], L = Math.hypot(bx - ax, by - ay);
          const N2 = Math.max(1, Math.ceil(L / 5));
          for(let s = 0; s < N2; s++) pts.push([ax + (bx - ax) * s / N2, ay + (by - ay) * s / N2]);
        }
        pts.push(line[line.length - 1]);
        let run = [];
        const flush = () => {
          if(run.length < 2){ run = []; return; }
          let along = 0;
          for(let k = 0; k < run.length; k++){
            const p = run[k], a = run[Math.max(0, k - 1)], b = run[Math.min(run.length - 1, k + 1)];
            const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L;
            if(k) along += Math.hypot(p[0] - run[k - 1][0], p[1] - run[k - 1][1]);
            const hw = WID[cl] / 2, z = p[2] + 0.12;
            pos.push(p[0] - nx * hw, z, p[1] - ny * hw, p[0] + nx * hw, z, p[1] + ny * hw);
            uv.push(0, along / (cl === 4 ? 1.2 : 8), 1, along / (cl === 4 ? 1.2 : 8));
            if(k){ idx.push(v - 2, v - 1, v, v - 1, v + 1, v); }
            v += 2;
            if(cl <= 1){
              for(const sd of [-1, 1]){
                const o1 = hw, o2 = hw + 2.4;
                sw.push(p[0] + nx * sd * o1, z + 0.16, p[1] + ny * sd * o1, p[0] + nx * sd * o2, z + 0.16, p[1] + ny * sd * o2);
              }
              if(k){ for(const off of [0, 2]){ const b0 = sv - 4 + off, b1 = sv + off;
                swi.push(b0, b0 + 1, b1, b0 + 1, b1 + 1, b1); } }
              sv += 4;
              if(k && (Math.floor(along / 6) % 2 === 0)){
                const q0 = run[k - 1];
                dash.push(q0[0] - nx * 0.08, z + 0.02, q0[1] - ny * 0.08, q0[0] + nx * 0.08, z + 0.02, q0[1] + ny * 0.08,
                          p[0] + nx * 0.08, z + 0.02, p[1] + ny * 0.08, p[0] - nx * 0.08, z + 0.02, p[1] - ny * 0.08);
                dashI.push(dv, dv + 1, dv + 2, dv, dv + 2, dv + 3); dv += 4;
              }
            }
          }
          run = [];
        };
        for(const [x, y] of pts){
          const q = this.near(x, y, 30);
          const onCircuit = q && q.d < this.rin(q.i, q.side) + WID[cl] / 2 - 1;
          const inTunnel = q && T.inTunnel(q.i) && q.d < T.half + 10;
          if(onCircuit || inTunnel || !M.land(x, y)){ flush(); continue; }
          run.push([x, y, this.ground(x, y)]);
        }
        flush();
      }
      const mk = (P, I, U, mat) => {
        if(!P.length) return;
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
        if(U) geo.setAttribute("uv", new THREE.Float32BufferAttribute(U, 2));
        geo.setIndex(I); geo.computeVertexNormals();
        const mm = mat.clone(); mm.polygonOffset = true; mm.polygonOffsetFactor = -2; mm.polygonOffsetUnits = -2;
        const m = new THREE.Mesh(geo, mm); m.receiveShadow = true; m.userData.dynamic = true; g.add(m);
      };
      mk(pos, idx, uv, mats[cl]);
      mk(sw, swi, null, walkMat);
      mk(dash, dashI, null, paint);
    }
  },

  /* ---- the town: every mapped building on its real footprint ----
     Each one stands on the lowest ground under it and rises its storeys above
     the highest, so on a slope the downhill face shows extra floors and the
     rooflines step up the hill the way they do on the real rock face. Walls are
     batched by facade, roofs by kind, so 3,400 buildings are a handful of draws. */
  buildings(G, g, T){
    const M = this.M, rnd = mulberry(20260524);
    const TILE_W = 12, TILE_H = 9.45;                 // four bays by three floors
    const PAL = PTEX.monacoPalette();
    const nPal = PAL.length;
    // one bucket per facade colour, plus roofs; and a separate set for anything
    // standing over the tunnel, which has to be able to fade on its own
    const bucket = () => ({ pos:[], nrm:[], uv:[], col:[] });
    let tint = [1, 1, 1];
    const tintN = (b, n) => { for(let k = 0; k < n; k++) b.col.push(tint[0], tint[1], tint[2]); };
    // buckets by material and by 250 m chunk, so culling can skip most of the town
    const BK = new Map();
    const bk = (name, cx, cy) => { const k = name + "|" + Math.floor(cx / 250) + "," + Math.floor(cy / 250);
      let b = BK.get(k); if(!b){ b = bucket(); b.name = name; BK.set(k, b); } return b; };
    const fWalls = [...Array(nPal)].map(bucket), fFlat = bucket(), fTerra = bucket();
    const push = (b, a, c, d, e, n) => {             // a quad a-c-d-e, one normal, wound to face n
      b.pos.push(...a, ...d, ...c, ...a, ...e, ...d);
      for(let k = 0; k < 6; k++) b.nrm.push(n[0], n[1], n[2]);
      tintN(b, 6);
    };
    const tri = (b, a, c, d) => {
      let ux = c[0] - a[0], uy = c[1] - a[1], uz = c[2] - a[2], vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      if(ny < 0){ const t = c; c = d; d = t; nx = -nx; ny = -ny; nz = -nz; }   // face the sky
      b.pos.push(...a, ...c, ...d);
      tintN(b, 3);
      const l = Math.hypot(nx, ny, nz) || 1;
      for(let k = 0; k < 3; k++) b.nrm.push(nx / l, ny / l, nz / l);
      b.uv.push(a[0] / 8, a[2] / 8, c[0] / 8, c[2] / 8, d[0] / 8, d[2] / 8);
    };
    this.bInfo = [];
    const balc = [], people = [], rooftop = [], tanks = [], gardens = [];
    let skipped = 0, count = 0, overTunnel = 0, hiddenView = 0;
    const tunnelNear = (x, y) => { const q = this.near(x, y, 40); return q && T.inTunnel(q.i) && q.d < T.half + 14; };
    for(const B of M.blds){
      const P = B.pts; if(P.length < 3) continue;
      if(B.lm) continue;                                // the landmarks build themselves
      let cx = 0, cy = 0, area = 0, per = 0;
      for(let k = 0; k < P.length; k++){
        const a = P[k], b = P[(k + 1) % P.length];
        cx += a[0]; cy += a[1]; area += a[0] * b[1] - b[0] * a[1]; per += Math.hypot(b[0] - a[0], b[1] - a[1]);
      }
      cx /= P.length; cy /= P.length; area = Math.abs(area) / 2;
      // how near the circuit is it, and does it stand on the road?
      let dMin = Infinity, onRoad = false, fades = false;
      for(const [x, y] of P.concat([[cx, cy]])){
        const q = this.near(x, y, 60);
        if(!q) continue;
        dMin = Math.min(dMin, q.d);
        if(T.inTunnel(q.i)){ if(q.d < T.half + 14) fades = true; continue; }
        if(q.d < T.half + (q.side < 0 ? T.roL[q.i] : T.roR[q.i]) + 1.2) onRoad = true;
      }
      if(onRoad){ skipped++; continue; }
      if(!this.detail && dMin > 700) continue;
      // storeys: the mapped number where there is one, a Monaco guess where not
      const h01 = ((Math.sin(cx * 12.9898 + cy * 78.233) * 43758.5453) % 1 + 1) % 1;
      let lv = B.lv;
      if(!lv){
        if(B.kind === 2) lv = 2 + Math.floor(h01 * 2);
        else if(B.kind === 3) lv = 4;
        else if(B.kind === 7) lv = 1;
        else if(area < 80) lv = 3 + Math.floor(h01 * 3);
        else if(area < 250) lv = 4 + Math.floor(h01 * 5);
        else if(area < 700) lv = 6 + Math.floor(h01 * 6);
        else if(area < 2000) lv = 8 + Math.floor(h01 * 8);
        else lv = 7 + Math.floor(h01 * 10);
      }
      if(!M.land(cx, cy) && lv > 3) lv = B.lv ? Math.min(B.lv, 4) : 3;
      // long thin footprints with no mapped height are sheds, terminals and
      // breakwater buildings, not towers
      if(!B.lv && per * per / Math.max(area, 1) > 40) lv = Math.min(lv, 4);
      const height = lv * 3.15 + 1.2;
      let gLo = Infinity, gHi = -Infinity;
      for(const [x, y] of P){ const h = this.ground(x, y); gLo = Math.min(gLo, h); gHi = Math.max(gHi, h); }
      if(gLo < 0.5) gLo = 0.5;                           // standing in the harbour is not a thing
      const base = gLo - 0.4, top = Math.max(gHi, gLo) + height;
      if(this.hidesRoad(P, top)){ hiddenView++; continue; }
      // facade colour: the old town is ochre and cream, the rest pastel
      let pal = Math.floor(h01 * nPal * 7.31) % nPal;
      { const v = 0.90 + ((h01 * 97.3) % 1) * 0.16, w2 = ((h01 * 53.1) % 1 - 0.5) * 0.06;
        tint = [v + w2, v, v - w2]; }
      if(lv >= 14) pal = PTEX.PALETTE_MODERN;
      const W = fades ? fWalls[pal] : bk("walls", cx, cy);
      // the palette rides in v for the atlas, four tiles in from its boundary so
      // walls that start just below ground stay inside their own palette
      const vOff = fades ? 0 : pal * 32 + 4;
      let along = 0;
      for(let k = 0; k < P.length; k++){
        const a = P[k], b = P[(k + 1) % P.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if(L < 0.05) continue;
        // footprints are counter-clockwise in game space; the outward normal is (dy, -dx)
        const nx = (b[1] - a[1]) / L, ny = -(b[0] - a[0]) / L;
        push(W, [a[0], base, a[1]], [b[0], base, b[1]], [b[0], top, b[1]], [a[0], top, a[1]], [nx, 0, ny]);
        const u0 = along / TILE_W, u1 = (along + L) / TILE_W, v0 = (base - gLo) / TILE_H + vOff, v1 = (top - gLo) / TILE_H + vOff;
        W.uv.push(u0, v0, u1, v1, u1, v0, u0, v0, u0, v1, u1, v1);
        along += L;
        // balconies on the faces that look at the circuit, near it
        if(this.detail && dMin < 95 && L > 7 && lv >= 3){
          const q = this.near((a[0] + b[0]) / 2 + nx * 6, (a[1] + b[1]) / 2 + ny * 6, 110);
          if(q){
            const tx = T.x[q.i] - (a[0] + b[0]) / 2, ty = T.y[q.i] - (a[1] + b[1]) / 2, tl = Math.hypot(tx, ty) || 1;
            if((tx * nx + ty * ny) / tl > 0.35){
              const ang = Math.atan2(ny, nx);
              for(let s = 3; s < L - 2; s += 6){
                const px = a[0] + (b[0] - a[0]) * s / L + nx * 0.6, py = a[1] + (b[1] - a[1]) * s / L + ny * 0.6;
                const gz = this.ground(px, py);
                for(let f = 1; f < lv; f += (lv > 8 ? 2 : 1)){
                  const z = Math.max(base, gz) + 1.2 + f * 3.15;
                  if(z > top - 2) break;
                  balc.push([px, py, z, -ang, 1]);
                  // on a race weekend there is somebody on most of them
                  if(dMin < 70 && rnd() < 0.55) people.push([px + nx * 0.2, py + ny * 0.2, z + 0.9, rnd() * TAU, 0.9 + rnd() * 0.2]);
                }
              }
            }
          }
        }
      }
      // the roof: terracotta on the small old houses, flat terraces everywhere else
      const smallOld = area < 420 && lv <= 6 && P.length <= 6;
      const R = fades ? (smallOld ? fTerra : fFlat) : bk(smallOld ? "terra" : "flat", cx, cy);
      const tris = THREE.ShapeUtils.triangulateShape(P.map(([x, y]) => new THREE.Vector2(x, y)), []);
      if(smallOld){
        // a low hip towards the middle
        const apex = [cx, top + Math.min(4.5, Math.sqrt(area) * 0.28), cy];
        for(let k = 0; k < P.length; k++){
          const a = P[k], b = P[(k + 1) % P.length];
          tri(R, [a[0], top, a[1]], apex, [b[0], top, b[1]]);
        }
      } else {
        for(const t3 of tris){
          const A = P[t3[0]], Bq = P[t3[1]], C = P[t3[2]];
          tri(R, [A[0], top, A[1]], [Bq[0], top, Bq[1]], [C[0], top, C[1]]);
        }
        // what lives on a flat roof in Monaco: plant, tanks, and a garden or two
        if(this.detail && dMin < 450 && area > 90){
          const nAC = Math.min(6, 1 + Math.floor(area / 250));
          for(let k = 0; k < nAC; k++){
            const t3 = tris[Math.floor(rnd() * tris.length)]; if(!t3) break;
            const A = P[t3[0]], Bq = P[t3[1]], C = P[t3[2]];
            let r1 = rnd(), r2 = rnd(); if(r1 + r2 > 1){ r1 = 1 - r1; r2 = 1 - r2; }
            const x = A[0] + (Bq[0] - A[0]) * r1 + (C[0] - A[0]) * r2, y = A[1] + (Bq[1] - A[1]) * r1 + (C[1] - A[1]) * r2;
            (rnd() < 0.3 ? tanks : rooftop).push([x, y, top, rnd() * TAU, 0.8 + rnd() * 0.5]);
          }
          if(rnd() < 0.18 && area > 250) gardens.push([cx, cy, top + 0.05, rnd() * TAU, Math.sqrt(area) * 0.35]);
        }
      }
      this.bInfo.push({ cx, cy, base, top, area, dMin });
      count++; if(fades) overTunnel++;
    }
    // materials
    const mk = (b, mat, cast) => {
      if(!b.pos.length) return null;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(b.pos, 3));
      geo.setAttribute("normal", new THREE.Float32BufferAttribute(b.nrm, 3));
      if(b.uv.length) geo.setAttribute("uv", new THREE.Float32BufferAttribute(b.uv, 2));
      if(b.col.length){ geo.setAttribute("color", new THREE.Float32BufferAttribute(b.col, 3));
        if(!mat.vertexColors){
          const c = mat.clone(); c.vertexColors = true;
          if(mat.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile){
            c.onBeforeCompile = mat.onBeforeCompile; c.customProgramCacheKey = mat.customProgramCacheKey; }
          mat = c;
        } }
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = cast; m.receiveShadow = true; m.userData.dynamic = true;
      g.add(m); return m;
    };
    const facades = PAL.map((p, i) => PTEX.monacoFacade(i));
    const roofFlat = new THREE.MeshStandardMaterial({ map:PTEX.roofGravel(), color:G.col("#E2D8C6"), roughness:0.95, vertexColors:true });
    const roofTerra = new THREE.MeshStandardMaterial({ map:PTEX.roofTiles(), color:G.col("#D07048"), roughness:0.85, vertexColors:true });
    // one tinted material per facade, shared by every chunk that uses it
    const tinted = new Map();
    const tintMat = base => { let m = tinted.get(base); if(!m){ m = base.clone(); m.vertexColors = true; tinted.set(base, m); } return m; };
    for(const b of BK.values()){
      const name = b.name;
      const mat = name === "flat" ? roofFlat : name === "terra" ? roofTerra : PTEX.monacoAtlas();
      const m = mk(b, mat, true);
      if(m) m.geometry.computeBoundingSphere();
    }
    for(let i = 0; i < nPal; i++){
      const fm = mk(fWalls[i], G.ditherMat(facades[i]), true);
      if(fm) this.fade.push(fm);
    }
    for(const [b, mat] of [[fFlat, roofFlat], [fTerra, roofTerra]]){ const fm = mk(b, G.ditherMat(mat), true); if(fm) this.fade.push(fm); }
    // balconies: a slab with a solid parapet, which is most of Monaco's
    if(balc.length){
      const bg = LB.merge([ (() => { const s = new THREE.BoxGeometry(1.25, 0.18, 3.0); s.translate(0.62, 0, 0); return s; })(),
                            (() => { const s = new THREE.BoxGeometry(0.10, 1.0, 3.0); s.translate(1.22, 0.55, 0); return s; })() ]);
      LB.many(G, g, bg, G.mat("#F2EEE6", { roughness:0.8 }), balc, false);
    }
    if(people.length) this.crowd(G, g, people);
    if(rooftop.length){ const ac = new THREE.BoxGeometry(1.6, 1.0, 1.1); ac.translate(0, 0.5, 0);
      LB.many(G, g, ac, G.mat("#B8BCC0", { roughness:0.6, metalness:0.3 }), rooftop, false); }
    if(tanks.length){ const tk = new THREE.CylinderGeometry(0.9, 0.9, 1.8, 10); tk.translate(0, 1.2, 0);
      LB.many(G, g, tk, G.mat("#E8E6E0", { roughness:0.7 }), tanks, false); }
    if(gardens.length){ const gp = new THREE.CylinderGeometry(1, 1, 0.3, 8); gp.translate(0, 0.15, 0);
      const list = gardens.map(([x, y, z, r, s]) => [x, y, z, r, s, 1]);
      LB.many(G, g, gp, G.mat("#6E8E48", { roughness:0.95 }), list, false); }
    this.stats = Object.assign(this.stats || {}, { buildings:count, skippedOnRoad:skipped, hiddenInView:hiddenView, overTunnel,
      balconies:balc.length, balconyPeople:people.length });
  },

  /* people: a capsule body and a head, instanced, in a spread of colours */
  crowd(G, g, list){
    // one body mesh with a colour per person, rather than a mesh per shirt colour
    const body = this._body || (this._body = (() => { const b = new THREE.CylinderGeometry(0.22, 0.28, 1.2, 6); b.translate(0, 0.6, 0); return b; })());
    const head = this._head || (this._head = (() => { const h = new THREE.SphereGeometry(0.17, 6, 4); h.translate(0, 1.38, 0); return h; })());
    const shirts = ["#E8E4DC", "#1E3A6A", "#C8302A", "#F2C230", "#2E8C5A", "#101418", "#E86A9A", "#6AA8E0"];
    const items = list.map((p, i) => [p[0], p[1], p[2], p[3], p[4], null, shirts[(i * 7 + Math.floor(p[0] * 3)) % shirts.length]]);
    LB.many(G, g, body, G.mat("#FFFFFF", { roughness:0.9 }), items, false);
    LB.many(G, g, head, G.mat("#D8A88A", { roughness:0.8 }), list, false);
    this.stats = Object.assign(this.stats || {}, { people:(this.stats && this.stats.people || 0) + list.length });
  },

  /* ---- the landmarks, each on its own surveyed footprint ---- */
  foot(k){
    const B = this.M.blds.find(b => b.lm === k); if(!B) return null;
    const P = this.clear(B.pts, 2.4); let cx = 0, cy = 0, area = 0;
    for(let i = 0; i < P.length; i++){ const a = P[i], b = P[(i + 1) % P.length]; cx += a[0]; cy += a[1]; area += a[0] * b[1] - b[0] * a[1]; }
    cx /= P.length; cy /= P.length;
    let lo = Infinity, hi = -Infinity;
    for(const [x, y] of P){ const h = this.ground(x, y); lo = Math.min(lo, h); hi = Math.max(hi, h); }
    // a landmark in the way of the hairpin or the last turns is left out too
    if(this.hidesRoad(P, hi + (k === "fairmont" ? 26.4 : 20))){ (this.hiddenLandmarks = this.hiddenLandmarks || []).push(k); return null; }
    return { P, cx, cy, area:Math.abs(area) / 2, lo:Math.max(0.5, lo), hi };
  },
  // the edge of a footprint that faces a point, and the directions off it
  facing(F, tx, ty){
    let best = null;
    for(let i = 0; i < F.P.length; i++){
      const a = F.P[i], b = F.P[(i + 1) % F.P.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if(L < 4) continue;
      const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, d = Math.hypot(tx - mx, ty - my) - L * 0.15;
      if(!best || d < best.d) best = { d, mx, my, L, tx:(b[0] - a[0]) / L, ty:(b[1] - a[1]) / L, nx:(b[1] - a[1]) / L, ny:-(b[0] - a[0]) / L };
    }
    return best;
  },
  // a footprint, shrunk towards its middle
  shrink(P, cx, cy, f){ return P.map(([x, y]) => [cx + (x - cx) * f, cy + (y - cy) * f]); },
  prism(G, g, P, z0, h, mat, cast){
    const shape = new THREE.Shape(P.map(([x, y]) => new THREE.Vector2(x, y)));
    const geo = new THREE.ExtrudeGeometry(shape, { depth:h, bevelEnabled:false });
    geo.rotateX(Math.PI / 2); geo.translate(0, z0 + h, 0);
    // extrusions come out with the shape's own coordinates as UVs; rescale the
    // side walls to metres so facade maps tile at their real size
    const uv = geo.attributes.uv, pos = geo.attributes.position, nrm = null;
    const m = new THREE.Mesh(geo, mat); m.castShadow = cast !== false; m.receiveShadow = true;
    m.userData.dynamic = true; g.add(m); return m;
  },
  // wall UVs in metres: u along the wall, v up it (ExtrudeGeometry's own are
  // useless for a facade texture)
  facadeUV(geo, tileW, tileH, z0){
    const pos = geo.attributes.position, nrm = geo.attributes.normal, uv = geo.attributes.uv;
    for(let i = 0; i < pos.count; i++){
      const ny = nrm.getY(i);
      if(Math.abs(ny) > 0.5){ uv.setXY(i, pos.getX(i) / 8, pos.getZ(i) / 8); continue; }
      const nx = nrm.getX(i), nz = nrm.getZ(i);
      const along = pos.getX(i) * -nz + pos.getZ(i) * nx;
      uv.setXY(i, along / tileW, (pos.getY(i) - z0) / tileH);
    }
    uv.needsUpdate = true;
  },

  landmarks(G, g, T){
    const M = this.M, lm = M.lm;
    const stone = "#EADFC8";
    const copper = G.mat("#5FA08A", { roughness:0.55, metalness:0.35 });
    const slate = G.mat("#7C8898", { roughness:0.55, metalness:0.25 });
    const gold = G.mat("#C8A04A", { roughness:0.35, metalness:0.8 });
    const glass = new THREE.MeshStandardMaterial({ color:G.col("#9EC8C4"), roughness:0.08, metalness:0.2,
      transparent:true, opacity:0.55, envMapIntensity:1.6 });
    const cream = (c, rough) => G.faceMat("stone", c || stone, false, { roughness:rough || 0.8 });
    const beaux = PTEX.monacoFacade(PTEX.PALETTE_BEAUX);
    const made = {};
    const body = (F, h, mat) => {
      const m = this.prism(G, g, F.P, F.lo - 0.4, (F.hi - F.lo) + h + 0.4, mat);
      this.facadeUV(m.geometry, 12, 9.45, F.lo);
      return F.hi + h;
    };
    /* the Casino de Monte-Carlo: Beaux-Arts cream stone, two ornate towers on
       the square, a central dome, green copper and slate roofs */
    { const F = this.foot("casino");
      if(F){
        const top = body(F, 17, beaux);
        const fr = this.facing(F, lm.fountain[0], lm.fountain[1]);
        // the roof: a slate mansard band stepped in from the walls
        this.prism(G, g, this.shrink(F.P, F.cx, F.cy, 0.9), top, 3.2, slate);
        if(fr){
          const bx = fr.mx - fr.nx * 7, by = fr.my - fr.ny * 7, ang = Math.atan2(fr.ty, fr.tx);
          for(const s of [-1, 1]){
            const x = bx + fr.tx * s * fr.L * 0.36, y = by + fr.ty * s * fr.L * 0.36;
            LB.box(G, g, x, y, F.lo, 9, 9, top - F.lo + 9, ang, cream("#EFE4CC"));
            LB.box(G, g, x, y, top + 9, 10, 10, 1.2, ang, cream("#E2D6BC"));
            // the copper pavilion roofs, and a lantern on each
            const c = LB.cone(G, g, x, y, top + 10.2, 6.6, 9, copper, 4); c.rotation.y = -ang + Math.PI / 4;
            LB.cyl(G, g, x, y, top + 19.2, 0.9, 0.5, 3.2, gold, 8);
          }
          // the dome over the atrium, a little back from the entrance
          const dx = fr.mx - fr.nx * 16, dy = fr.my - fr.ny * 16;
          LB.cyl(G, g, dx, dy, top + 3, 7.5, 7.5, 5, cream("#EDE2CA"), 24);
          const pts = []; for(let k = 0; k <= 10; k++){ const a = k / 10 * Math.PI / 2; pts.push(new THREE.Vector2(7.6 * Math.cos(a) + 0.01, 7.2 * Math.sin(a))); }
          LB.lathe(G, g, dx, dy, top + 8, pts, copper, 24);
          LB.cyl(G, g, dx, dy, top + 15, 1.4, 1.0, 3.4, cream("#EDE2CA"), 10);
          LB.cyl(G, g, dx, dy, top + 18.4, 0.3, 0.05, 2.4, gold, 6);
          // the entrance: an arcade of three arches under a balcony
          const ex = fr.mx + fr.nx * 2.2, ey = fr.my + fr.ny * 2.2;
          LB.box(G, g, ex, ey, F.lo, 22, 4.4, 9, ang, cream("#F2E8D2"));
          const arch = [];
          for(const s of [-1, 0, 1]) arch.push([ex + fr.tx * s * 6.5 + fr.nx * 2.25, ey + fr.ty * s * 6.5 + fr.ny * 2.25, F.lo, -ang, 1]);
          const ag = new THREE.BoxGeometry(4.2, 6.2, 0.2); ag.translate(0, 3.1, 0);
          LB.many(G, g, ag, G.mat("#3A3226", { roughness:0.6 }), arch, false);
          LB.box(G, g, ex, ey, F.lo + 9, 23, 5, 0.7, ang, gold);
          made.casino = { x:fr.mx, y:fr.my };
        }
      } }
    /* the Hotel de Paris: a long cream Belle Epoque front under a mansard, with
       its domed rotunda on the corner nearest the square */
    { const F = this.foot("hotelparis");
      if(F){
        const top = body(F, 22, beaux);
        this.prism(G, g, this.shrink(F.P, F.cx, F.cy, 0.93), top, 4.2, slate);
        // the corner: whichever footprint vertex is nearest the Casino fountain
        let c = F.P[0], cd = Infinity;
        for(const p of F.P){ const d = Math.hypot(p[0] - lm.fountain[0], p[1] - lm.fountain[1]); if(d < cd){ cd = d; c = p; } }
        const rx = c[0] + (F.cx - c[0]) * 0.08, ry = c[1] + (F.cy - c[1]) * 0.08;
        LB.cyl(G, g, rx, ry, F.lo, 7, 7, top - F.lo + 3, cream("#F4EAD6"), 20);
        const pts = []; for(let k = 0; k <= 8; k++){ const a = k / 8 * Math.PI / 2; pts.push(new THREE.Vector2(7.1 * Math.cos(a) + 0.01, 6 * Math.sin(a))); }
        LB.lathe(G, g, rx, ry, top + 3, pts, slate, 20);
        LB.cyl(G, g, rx, ry, top + 9, 0.8, 0.5, 2.6, gold, 8);
        // flags along the roof
        const fl = [];
        const fr = this.facing(F, lm.fountain[0], lm.fountain[1]);
        if(fr) for(let k = -2; k <= 2; k++) fl.push([fr.mx + fr.tx * k * 12 - fr.nx * 2, fr.my + fr.ty * k * 12 - fr.ny * 2, top + 4.2, 0, 1]);
        this.flags(G, g, fl);
        // red awnings over the ground floor on the square
        if(fr){ const ang = Math.atan2(fr.ty, fr.tx);
          LB.box(G, g, fr.mx + fr.nx * 1.6, fr.my + fr.ny * 1.6, F.lo + 4.2, fr.L * 0.8, 3.2, 0.25, ang, G.mat("#B8282E", { roughness:0.8 })); }
      } }
    /* the Cafe de Paris: a lower Belle Epoque pavilion with its terrace spilling
       onto the square under parasols */
    { const F = this.foot("cafeparis");
      if(F){
        const top = body(F, 11, PTEX.monacoFacade(PTEX.PALETTE_OCHRE));
        this.prism(G, g, this.shrink(F.P, F.cx, F.cy, 0.94), top, 2.2, slate);
        const fr = this.facing(F, lm.fountain[0], lm.fountain[1]);
        if(fr){
          const ang = Math.atan2(fr.ty, fr.tx);
          LB.box(G, g, fr.mx + fr.nx * 3.5, fr.my + fr.ny * 3.5, F.lo + 4, fr.L * 0.9, 7, 0.3, ang, glass);
          const tables = [];
          for(let a = -3; a <= 3; a++) for(let b = 0; b < 2; b++){
            const x = fr.mx + fr.tx * a * 5.2 + fr.nx * (9 + b * 5), y = fr.my + fr.ty * a * 5.2 + fr.ny * (9 + b * 5);
            const q = this.near(x, y, 20); if(q && q.d < this.rin(q.i, q.side)) continue;
            tables.push([x, y, this.ground(x, y), 0, 1]);
          }
          this.terrace(G, g, tables, "#F2F0E6");
        }
      } }
    /* the Hermitage, and its glass-domed winter garden */
    { const F = this.foot("hermitage");
      if(F){
        const top = body(F, 20, PTEX.monacoFacade(PTEX.PALETTE_CREAM));
        this.prism(G, g, this.shrink(F.P, F.cx, F.cy, 0.93), top, 2.8, G.mat("#B8683E", { roughness:0.8 }));
        const dome = new THREE.Mesh(new THREE.SphereGeometry(9, 20, 10, 0, TAU, 0, Math.PI / 2), glass);
        dome.position.set(F.cx, top + 2.8, F.cy); dome.userData.dynamic = true; g.add(dome);
        const ribs = new THREE.Mesh(new THREE.SphereGeometry(9.05, 12, 5, 0, TAU, 0, Math.PI / 2),
          new THREE.MeshStandardMaterial({ color:G.col("#E8E6DE"), wireframe:true }));
        ribs.position.copy(dome.position); ribs.userData.dynamic = true; g.add(ribs);
      } }
    /* the Fairmont: long, low, curved round the hairpin, balcony bands all the
       way along, gardens on the flat roof — and the tunnel running under it, so
       every piece of it fades with the tunnel */
    { const F = this.foot("fairmont");
      if(F){
        const fm = PTEX.monacoFacade(PTEX.PALETTE_FAIRMONT);
        const m = this.prism(G, g, F.P, F.lo - 0.4, (F.hi - F.lo) + 26.4, G.ditherMat(fm));
        this.facadeUV(m.geometry, 12, 9.45, F.lo);
        this.fade.push(m);
        const top = F.hi + 26;
        // the roof garden and its pool
        const rg = this.prism(G, g, this.shrink(F.P, F.cx, F.cy, 0.86), top, 0.5, G.ditherMat(G.mat("#6E8E48", { roughness:0.95 })), false);
        this.fade.push(rg);
        const pool = new THREE.Mesh(new THREE.BoxGeometry(22, 0.4, 9), G.ditherMat(new THREE.MeshStandardMaterial({
          color:G.col("#2FB8E0"), roughness:0.08, emissive:G.col("#0E6A8A"), emissiveIntensity:0.35 })));
        pool.position.set(F.cx, top + 0.7, F.cy); pool.userData.dynamic = true; g.add(pool); this.fade.push(pool);
        this.fairmontTop = top;
      } }
    /* the Prince's Palace, on top of the Rock: pale ochre, crenellated, its
       towers at the corners */
    { const F = this.foot("palace");
      if(F){
        const top = body(F, 15, PTEX.monacoFacade(PTEX.PALETTE_OCHRE));
        const merl = [];
        for(let i = 0; i < F.P.length; i++){
          const a = F.P[i], b = F.P[(i + 1) % F.P.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
          for(let s = 1; s < L; s += 2.2) merl.push([a[0] + (b[0] - a[0]) * s / L, a[1] + (b[1] - a[1]) * s / L, top, -Math.atan2(b[1] - a[1], b[0] - a[0]), 1]);
        }
        const mg = new THREE.BoxGeometry(1.1, 1.2, 0.7); mg.translate(0, 0.6, 0);
        LB.many(G, g, mg, G.mat("#E2C89A", { roughness:0.85 }), merl, false);
        // the two towers: the footprint corners furthest apart
        let A = F.P[0], Bq = F.P[1], bd = 0;
        for(const p of F.P) for(const q2 of F.P){ const d = Math.hypot(p[0] - q2[0], p[1] - q2[1]); if(d > bd){ bd = d; A = p; Bq = q2; } }
        for(const [x, y] of [A, Bq]){
          const tx = x + (F.cx - x) * 0.06, ty = y + (F.cy - y) * 0.06;
          LB.box(G, g, tx, ty, F.lo, 8, 8, top - F.lo + 9, 0, PTEX.monacoFacade(PTEX.PALETTE_OCHRE));
          const tm = [];
          for(let k = 0; k < 12; k++){ const a = k / 12 * TAU; tm.push([tx + Math.cos(a) * 4.3, ty + Math.sin(a) * 4.3, top + 9, a, 1]); }
          LB.many(G, g, mg, G.mat("#E2C89A", { roughness:0.85 }), tm, false);
        }
        this.flags(G, g, [[F.cx, F.cy, top, 0, 1.4]]);
      } }
    /* the Cathedral: white La Turbie stone, a bell tower and an apse dome */
    { const F = this.foot("cathedral");
      if(F){
        const top = body(F, 15, G.faceMat("stone", "#F2EEE4", false));
        this.prism(G, g, this.shrink(F.P, F.cx, F.cy, 0.95), top, 3, G.mat("#B86A44", { roughness:0.8 }));
        let far = F.P[0], fd = 0;
        for(const p of F.P){ const d = Math.hypot(p[0] - F.cx, p[1] - F.cy); if(d > fd){ fd = d; far = p; } }
        const bx = far[0] + (F.cx - far[0]) * 0.18, by = far[1] + (F.cy - far[1]) * 0.18;
        LB.box(G, g, bx, by, F.lo, 7, 7, top - F.lo + 13, 0, G.faceMat("stone", "#F2EEE4", false));
        LB.cone(G, g, bx, by, top + 13, 5, 5, G.mat("#B86A44"), 4);
        const opp = [F.cx * 2 - bx, F.cy * 2 - by];
        const pts = []; for(let k = 0; k <= 8; k++){ const a = k / 8 * Math.PI / 2; pts.push(new THREE.Vector2(6 * Math.cos(a) + 0.01, 5 * Math.sin(a))); }
        LB.lathe(G, g, (opp[0] + F.cx) / 2, (opp[1] + F.cy) / 2, top, pts, G.faceMat("stone", "#F2EEE4", false), 18);
      } }
    /* the Musee Oceanographique, on the cliff edge of the Rock */
    { const F = this.foot("musee");
      if(F){
        const top = body(F, 22, beaux);
        const pts = []; for(let k = 0; k <= 8; k++){ const a = k / 8 * Math.PI / 2; pts.push(new THREE.Vector2(7 * Math.cos(a) + 0.01, 6 * Math.sin(a))); }
        LB.cyl(G, g, F.cx, F.cy, top, 7, 7, 3, cream("#EFE6D2"), 18);
        LB.lathe(G, g, F.cx, F.cy, top + 3, pts, slate, 18);
      } }
    /* La Rascasse: low, with its terrace and awnings and the crowd on it */
    { const F = this.foot("rascasse");
      if(F){
        const top = body(F, 6.5, PTEX.monacoFacade(PTEX.PALETTE_SALMON));
        this.prism(G, g, this.shrink(F.P, F.cx, F.cy, 0.97), top, 1.1, G.mat("#E8E4DA"));
        const q = this.near(F.cx, F.cy, 120);
        if(q){
          const fr = this.facing(F, T.x[q.i], T.y[q.i]);
          if(fr){
            const ang = Math.atan2(fr.ty, fr.tx);
            LB.box(G, g, fr.mx + fr.nx * 2, fr.my + fr.ny * 2, F.lo + 3.4, fr.L, 4, 0.25, ang, G.mat("#1E4E8A", { roughness:0.8 }));
            const crowd = [];
            for(let k = 0; k < 60; k++){
              const s = (Math.random() - 0.5) * fr.L, d = 1 + Math.random() * 3.2;
              crowd.push([fr.mx + fr.tx * s + fr.nx * d, fr.my + fr.ty * s + fr.ny * d, F.hi + 0.1, Math.random() * TAU, 1]);
            }
            this.crowd(G, g, crowd);
          }
        }
      } }
    /* Sainte-Devote: a small pale chapel with a bell gable, right on the T1 barrier */
    { const F = this.foot("chapel");
      if(F){
        const top = body(F, 8, G.faceMat("stucco", "#F0E6D2", false));
        const ap = [F.cx, top + 4, F.cy];
        this.prism(G, g, this.shrink(F.P, F.cx, F.cy, 1.0), top, 0.5, G.mat("#C0643E"));
        LB.cone(G, g, F.cx, F.cy, top + 0.5, Math.sqrt(F.area) * 0.62, 3.6, G.mat("#C0643E"), 4).rotation.y = Math.PI / 4;
        const q = this.near(F.cx, F.cy, 80);
        if(q){
          const fr = this.facing(F, T.x[q.i], T.y[q.i]);
          if(fr){
            const ang = Math.atan2(fr.ty, fr.tx);
            LB.box(G, g, fr.mx, fr.my, top, 4.5, 1.0, 5.5, ang, G.faceMat("stucco", "#F0E6D2", false));
            LB.box(G, g, fr.mx + fr.nx * 0.2, fr.my + fr.ny * 0.2, top + 1.8, 1.6, 1.1, 2.2, ang, G.mat("#3A3026"));
            LB.cyl(G, g, fr.mx, fr.my, top + 5.5, 0.12, 0.06, 1.4, G.mat("#3A3026"), 5);
          }
        }
      } }
    /* the Yacht Club de Monaco: long, white, decks stepping back like a ship's */
    { const F = this.foot("yachtclub");
      if(F){
        const white = G.mat("#F4F4F2", { roughness:0.5 });
        const band = new THREE.MeshStandardMaterial({ color:G.col("#22303C"), roughness:0.08, metalness:0.4, envMapIntensity:1.6 });
        let z = F.lo;
        for(let k = 0; k < 5; k++){
          const P2 = this.shrink(F.P, F.cx, F.cy, 1 - k * 0.1);
          this.prism(G, g, this.shrink(F.P, F.cx, F.cy, 0.985 - k * 0.1), z, 2.4, band);
          this.prism(G, g, P2, z + 2.4, 1.0, white);
          z += 3.4;
        }
        LB.cyl(G, g, F.cx, F.cy, z, 0.35, 0.2, 16, white, 8);
        this.flags(G, g, [[F.cx, F.cy, z + 15, 0, 1.2]]);
      } }
    /* Tour Odeon: the twin-crowned tower up at the east end, about 170 m */
    { const F = this.foot("odeon");
      if(F){
        const gl = G.faceMat("glass", "#7A8C9E", false);
        // split the footprint along its long axis into the two towers
        let A = F.P[0], Bq = F.P[1], bd = 0;
        for(const p of F.P) for(const q2 of F.P){ const d = Math.hypot(p[0] - q2[0], p[1] - q2[1]); if(d > bd){ bd = d; A = p; Bq = q2; } }
        const ax = (Bq[0] - A[0]) / bd, ay = (Bq[1] - A[1]) / bd;
        for(const [f, h] of [[0.28, 170], [0.72, 156]]){
          const x = A[0] + ax * bd * f, y = A[1] + ay * bd * f;
          const m = LB.cyl(G, g, x, y, F.lo, bd * 0.26, bd * 0.24, h, gl, 24);
          const cap = new THREE.Mesh(new THREE.SphereGeometry(bd * 0.24, 20, 8, 0, TAU, 0, Math.PI / 2), G.mat("#DCE2E8", { roughness:0.3, metalness:0.6 }));
          cap.position.set(x, F.lo + h, y); cap.scale.y = 0.6; cap.userData.dynamic = true; g.add(cap);
        }
        LB.box(G, g, F.cx, F.cy, F.lo, bd * 0.5, bd * 0.3, 120, Math.atan2(ay, ax), gl);
      } }
    this.stats = Object.assign(this.stats || {}, { landmarks:Object.keys(M.blds.reduce((a, b) => (b.lm && (a[b.lm] = 1), a), {})).length });
  },

  // cafe tables under parasols
  terrace(G, g, list, col){
    if(!list.length) return;
    const pole = new THREE.CylinderGeometry(0.05, 0.05, 2.4, 4); pole.translate(0, 1.2, 0);
    const shade = new THREE.ConeGeometry(1.5, 0.55, 8); shade.translate(0, 2.55, 0);
    const table = new THREE.CylinderGeometry(0.45, 0.45, 0.75, 8); table.translate(0, 0.375, 0);
    LB.many(G, this.root, pole, G.mat("#8A8E94"), list, false);
    LB.many(G, this.root, shade, G.mat(col || "#F2F0E6", { roughness:0.9 }), list, true);
    LB.many(G, this.root, table, G.mat("#E8E6E0"), list, false);
  },
  // flags: small cloth panels that stir, instanced, red over white
  flags(G, g, list){
    if(!list.length) return;
    const pole = new THREE.CylinderGeometry(0.06, 0.08, 5, 5); pole.translate(0, 2.5, 0);
    LB.many(G, g, pole, G.mat("#D8DCE0", { metalness:0.6, roughness:0.4 }), list, false);
    const cloth = new THREE.PlaneGeometry(2.4, 1.6, 8, 1); cloth.translate(1.2, 4.1, 0);
    const col = [];
    const p = cloth.attributes.position;
    for(let i = 0; i < p.count; i++){ const top = p.getY(i) > 4.1; const c = G.col(top ? "#D8202A" : "#F4F4F4"); col.push(c.r, c.g, c.b); }
    cloth.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    const mat = new THREE.MeshStandardMaterial({ vertexColors:true, side:THREE.DoubleSide, roughness:0.9 });
    mat.onBeforeCompile = sh => {
      sh.uniforms.uT = this.timeU || (this.timeU = { value:0 });
      sh.vertexShader = "uniform float uT;\n" + sh.vertexShader.replace("#include <begin_vertex>",
        "#include <begin_vertex>\n  transformed.z += sin(position.x * 2.6 - uT * 5.0) * 0.18 * position.x;");
    };
    mat.customProgramCacheKey = () => "flagWave";
    LB.many(G, g, cloth, mat, list, false);
  },

  /* ---- yachts: lofted hulls, not boxes ----
     A hull is a run of cross-sections from transom to bow: a V under the water,
     flaring to the deck edge, with the sheer rising towards a pointed bow. Each
     model is built once at its own length and instanced; the hull takes a
     per-instance colour, the superstructure does not. */
  hull(L, B, D, H0){
    const S = 22, pos = [], idx = [], col = [];
    const sec = t => {
      const b = B * (t < 0.62 ? (0.92 + 0.08 * Math.min(1, t / 0.2)) : Math.pow(Math.cos((t - 0.62) / 0.38 * Math.PI / 2), 0.75));
      const d = D * (1 - 0.35 * t), h = H0 * (1 + 0.28 * t * t);
      // keel, bilge, waterline, deck edge
      return [[0, -d], [b * 0.72, -d * 0.35], [b, 0.2], [b * 0.97, h]];
    };
    const rows = [];
    for(let s = 0; s <= S; s++){
      const t = s / S, x = (t - 0.5) * L, c = sec(t);
      const row = [];
      for(const sd of [-1, 1]) for(let k = 0; k < c.length; k++){
        const [w, z] = c[k];
        row.push(pos.length / 3);
        pos.push(x, z, w * sd);
        // a dark boot stripe at the waterline; the rest takes the hull colour
        const boot = k === 2 ? 0.25 : 1; col.push(boot, boot, boot);
      }
      rows.push(row);
    }
    const nC = 4;
    for(let s = 0; s < S; s++){
      const a = rows[s], b = rows[s + 1];
      for(const side of [0, 1]){
        for(let k = 0; k < nC - 1; k++){
          const i0 = a[side * nC + k], i1 = a[side * nC + k + 1], j0 = b[side * nC + k], j1 = b[side * nC + k + 1];
          if(side) idx.push(i0, j0, i1, i1, j0, j1); else idx.push(i0, i1, j0, i1, j1, j0);
        }
      }
    }
    // the deck, between the two sheer lines, facing up: without it you look
    // straight down into the hull and see the water through the boat
    for(let s = 0; s < S; s++){
      const a = rows[s], b = rows[s + 1];
      idx.push(a[nC - 1], a[2 * nC - 1], b[nC - 1], a[2 * nC - 1], b[2 * nC - 1], b[nC - 1]);
    }
    // the transom
    const t0 = rows[0];
    for(let k = 0; k < nC - 1; k++) idx.push(t0[k], t0[nC + k], t0[k + 1], t0[k + 1], t0[nC + k], t0[nC + k + 1]);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx); g.computeVertexNormals();
    return g;
  },
  // decks, cabins, window bands, masts: everything above the hull, coloured by vertex
  topsides(L, B, H0, kind){
    const parts = [];
    const add = (geo, hex) => {
      const c = new THREE.Color(hex).convertSRGBToLinear(), n = geo.attributes.position.count, a = new Float32Array(n * 3);
      for(let i = 0; i < n; i++){ a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
      geo.setAttribute("color", new THREE.BufferAttribute(a, 3)); parts.push(geo.index ? geo.toNonIndexed() : geo);
    };
    const box = (l, h, w, x, z, hex) => { const b = new THREE.BoxGeometry(l, h, w); b.translate(x, z + h / 2, 0); add(b, hex); };
    const deckZ = H0 * 1.02;
    // the teak deck, lofted from the same sections as the hull so it meets the bow
    { const S2 = 22, pos = [], idx = [];
      for(let s = 0; s <= S2; s++){
        const t = s / S2, x = (t - 0.5) * L;
        const b = B * (t < 0.62 ? (0.92 + 0.08 * Math.min(1, t / 0.2)) : Math.pow(Math.cos((t - 0.62) / 0.38 * Math.PI / 2), 0.75)) * 0.97;
        const h = H0 * (1 + 0.28 * t * t) + 0.05;
        pos.push(x, h, -b, x, h, b);
        if(s) idx.push(s * 2 - 2, s * 2 - 1, s * 2, s * 2 - 1, s * 2 + 1, s * 2);      // faces up
      }
      const dg = new THREE.BufferGeometry();
      dg.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); dg.setIndex(idx); dg.computeVertexNormals();
      add(dg, "#B48A5E"); }
    if(kind === "sail"){
      box(L * 0.3, 1.0, B * 1.0, -L * 0.05, deckZ, "#F4F4F2");
      box(L * 0.3, 0.3, B * 1.02, -L * 0.05, deckZ + 0.55, "#1A2028");
      const m = new THREE.CylinderGeometry(0.12, 0.18, L * 1.25, 6); m.translate(L * 0.08, deckZ + L * 0.625, 0); add(m, "#DADCE0");
      const bm = new THREE.CylinderGeometry(0.1, 0.1, L * 0.42, 5); bm.rotateZ(Math.PI / 2); bm.translate(-L * 0.12, deckZ + 2.2, 0); add(bm, "#DADCE0");
      return LB.merge(parts);
    }
    const decks = kind === "motor" ? 1 : kind === "fly" ? 2 : kind === "super" ? 3 : 4;
    let z = deckZ, len = L * 0.62, x0 = -L * 0.05;
    for(let k = 0; k < decks; k++){
      const hgt = 2.6;
      box(len, hgt * 0.45, B * 1.6 - k * 0.5, x0, z, "#F6F6F4");
      // the tinted window band that makes a yacht look like a yacht
      box(len * 0.96, hgt * 0.38, B * 1.62 - k * 0.5, x0 + len * 0.01, z + hgt * 0.45, "#141C26");
      box(len * 1.02, 0.18, B * 1.64 - k * 0.5, x0 - len * 0.01, z + hgt * 0.83, "#F6F6F4");
      z += hgt; len *= 0.72; x0 -= L * 0.03;
    }
    if(kind !== "motor"){
      // the radar arch and mast
      box(0.5, 2.4, B * 1.2, x0 - len * 0.1, z, "#F6F6F4");
      const r = new THREE.SphereGeometry(0.7, 8, 6); r.translate(x0 - len * 0.1, z + 2.9, 0); add(r, "#EDEDEB");
    } else {
      box(len * 0.5, 0.8, B * 1.2, x0 + len * 0.1, z, "#1A2028");
    }
    if(kind === "mega"){
      // a helipad on the aft deck
      const hp = new THREE.CylinderGeometry(B * 0.85, B * 0.85, 0.2, 18); hp.translate(-L * 0.36, deckZ + 2.9, 0); add(hp, "#3A4048");
      const ring = new THREE.TorusGeometry(B * 0.6, 0.12, 4, 18); ring.rotateX(Math.PI / 2); ring.translate(-L * 0.36, deckZ + 3.05, 0); add(ring, "#F2F2F2");
    }
    if(kind === "super" || kind === "mega"){
      // a covered aft deck
      box(L * 0.2, 0.2, B * 1.6, -L * 0.32, deckZ + 2.6, "#F6F6F4");
    }
    return LB.merge(parts);
  },
  yachtModels(){
    if(this._ym) return this._ym;
    const M = (L, B, D, H0, kind) => ({ L, kind, hull:this.hull(L, B, D, H0), top:this.topsides(L, B, H0, kind) });
    return (this._ym = {
      motor:M(15, 2.3, 1.1, 1.6, "motor"), fly:M(28, 3.4, 1.6, 2.3, "fly"),
      super:M(55, 5.2, 2.6, 3.0, "super"), mega:M(88, 7.6, 3.6, 3.8, "mega"), sail:M(20, 2.6, 1.9, 1.4, "sail"),
    });
  },

  harbour(G, g, T){
    const M = this.M, rnd = mulberry(1297);
    const wet = (x, y) => !M.land(x, y) && !this.onPier(x, y);
    // pier outlines, for the "is this water or a jetty?" test
    this.pierGrid = new Map();
    for(const p of (this.piers || [])){
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for(const [x, y] of p.ring){ x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
      p.bb = [x0, y0, x1, y1];
    }
    // every quay and pier edge that faces water inside the harbour is a berth
    const berths = [];
    // a berth counts only in enclosed water: from inside Port Hercule or
    // Fontvieille most directions meet a quay within a few hundred metres,
    // while from the open coast half of them run out to sea
    const encl = new Map();
    const inHarbour = (x, y) => {
      const key = Math.round(x / 20) + "," + Math.round(y / 20);
      if(encl.has(key)) return encl.get(key);
      let hits = 0;
      for(let k = 0; k < 16; k++){
        const a = k / 16 * TAU, ca = Math.cos(a), sa = Math.sin(a);
        for(let d = 10; d <= 420; d += 10){ const px = x + ca * d, py = y + sa * d;
          if(M.land(px, py) || this.onPier(px, py)){ hits++; break; } }
      }
      const ok = hits >= 13;
      encl.set(key, ok); return ok;
    };
    for(const p of (this.piers || [])){
      for(let k = 0; k < p.ring.length; k++){
        const a = p.ring[k], b = p.ring[(k + 1) % p.ring.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if(L < 8) continue;
        const nx = (b[1] - a[1]) / L, ny = -(b[0] - a[0]) / L;
        for(const sd of [1, -1]){
          const mx = (a[0] + b[0]) / 2 + nx * sd * 6, my = (a[1] + b[1]) / 2 + ny * sd * 6;
          if(wet(mx, my) && inHarbour(mx, my)) berths.push({ a, b, L, nx:nx * sd, ny:ny * sd, top:p.top, big:!p.pontoon && p.area > 1500 });
        }
      }
    }
    for(const ln of (M.line.coast || [])){
      for(let k = 0; k < ln.length - 1; k++){
        const a = ln[k], b = ln[k + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if(L < 8) continue;
        const nx = -(b[1] - a[1]) / L, ny = (b[0] - a[0]) / L;
        for(const sd of [1, -1]){
          const mx = (a[0] + b[0]) / 2 + nx * sd * 6, my = (a[1] + b[1]) / 2 + ny * sd * 6;
          if(wet(mx, my) && inHarbour(mx, my) && M.land((a[0] + b[0]) / 2 - nx * sd * 4, (a[1] + b[1]) / 2 - ny * sd * 4))
            berths.push({ a, b, L, nx:nx * sd, ny:ny * sd, top:2.4, big:true });
        }
      }
    }
    // moor them stern-to, in tidy rows, biggest on the outer quays
    const models = this.yachtModels();
    const inst = { motor:[], fly:[], super:[], mega:[], sail:[] };
    const taken = new Map(), TK = 10;
    const free = (pts) => {
      for(const [x, y] of pts){
        if(!wet(x, y)) return false;
        const k = Math.floor(x / TK) + "," + Math.floor(y / TK);
        if(taken.get(k)) return false;
      }
      return true;
    };
    const take = (pts) => { for(const [x, y] of pts) taken.set(Math.floor(x / TK) + "," + Math.floor(y / TK), 1); };
    // and no two hulls may overlap: separating-axis test between rotated rectangles
    const PC = 60, placed = new Map();
    const boxOverlap = (A, B) => {
      const ax = [[A.ux, A.uy], [-A.uy, A.ux], [B.ux, B.uy], [-B.uy, B.ux]], dx = B.cx - A.cx, dy = B.cy - A.cy;
      for(const [x, y] of ax){
        const ra = A.hl * Math.abs(A.ux * x + A.uy * y) + A.hw * Math.abs(-A.uy * x + A.ux * y);
        const rb = B.hl * Math.abs(B.ux * x + B.uy * y) + B.hw * Math.abs(-B.uy * x + B.ux * y);
        if(Math.abs(dx * x + dy * y) > ra + rb) return false;
      }
      return true;
    };
    const clashes = (bx) => {
      const gx = Math.floor(bx.cx / PC), gy = Math.floor(bx.cy / PC);
      for(let a = -2; a <= 2; a++) for(let b = -2; b <= 2; b++){
        const l = placed.get((gx + a) + "," + (gy + b)); if(!l) continue;
        for(const o of l) if(boxOverlap(bx, o)) return true;
      }
      return false;
    };
    const keep = (bx) => { const k = Math.floor(bx.cx / PC) + "," + Math.floor(bx.cy / PC);
      let l = placed.get(k); if(!l){ l = []; placed.set(k, l); } l.push(bx); };
    for(const b of berths){
      let s = 2;
      while(s < b.L - 2){
        const r = rnd();
        let kind = b.big ? (r < 0.10 ? "mega" : r < 0.42 ? "super" : r < 0.82 ? "fly" : "sail")
                         : (r < 0.46 ? "motor" : r < 0.78 ? "fly" : "sail");
        const md = models[kind];
        const scl = kind === "mega" ? 0.85 + rnd() * 0.3 : 0.8 + rnd() * 0.45;
        const len = md.L * scl, beam = (kind === "mega" ? 7.6 : kind === "super" ? 5.2 : kind === "fly" ? 3.4 : kind === "sail" ? 2.6 : 2.3) * 2 * scl;
        const t = (s + beam / 2) / b.L;
        const px = b.a[0] + (b.b[0] - b.a[0]) * t, py = b.a[1] + (b.b[1] - b.a[1]) * t;
        // stern at the quay (a gangway's length off), bow out into the basin
        const sx = px + b.nx * 1.8, sy = py + b.ny * 1.8;
        const cx = sx + b.nx * len / 2, cy = sy + b.ny * len / 2;
        const probe = [[cx, cy], [sx + b.nx * len * 0.95, sy + b.ny * len * 0.95], [sx + b.nx * 2, sy + b.ny * 2]];
        const box = { cx, cy, hl:len / 2, hw:beam / 2 + 0.3, ux:b.nx, uy:b.ny };
        if(free(probe) && !clashes(box)){
          keep(box);
          take(probe.concat([[sx + b.nx * len * 0.5, sy + b.ny * len * 0.5]]));
          // the model's +x is the bow
          const ang = Math.atan2(b.ny, b.nx);
          const hue = rnd();
          const col = hue < 0.80 ? "#F6F6F4" : hue < 0.92 ? "#1A2A4A" : hue < 0.97 ? "#3A3E44" : "#B8BEC6";
          inst[kind].push({ x:cx, y:cy, a:ang, s:scl, col, ph:rnd() * TAU, top:b.top });
          s += beam + 1.4;
        } else s += 3;
      }
    }
    // a few boats anchored out in the bay
    for(let k = 0; k < 14; k++){
      const x = -600 + rnd() * 1400, y = 350 + rnd() * 700;
      if(!wet(x, y) || this.seaDistAt(x, y) < 120) continue;
      const kind = rnd() < 0.5 ? "super" : rnd() < 0.5 ? "mega" : "sail";
      inst[kind].push({ x, y, a:rnd() * TAU, s:0.9 + rnd() * 0.3, col:"#F6F6F4", ph:rnd() * TAU });
    }
    this.yachtSets = [];
    const obj = new THREE.Object3D();
    let total = 0;
    const hullMat = new THREE.MeshStandardMaterial({ vertexColors:true, roughness:0.22, metalness:0.1, envMapIntensity:1.3 });
    const topMat = new THREE.MeshStandardMaterial({ vertexColors:true, roughness:0.35, metalness:0.05, envMapIntensity:1.1 });
    const shareGeo = (geo, cx, cy, r) => {
      const gg = new THREE.BufferGeometry();
      for(const nm in geo.attributes) gg.setAttribute(nm, geo.attributes[nm]);
      if(geo.index) gg.setIndex(geo.index);
      gg.boundingSphere = new THREE.Sphere(new THREE.Vector3(cx, 4, cy), r);
      return gg;
    };
    for(const kind in inst){
      const md = models[kind];
      const chunks = new Map();
      for(const y of inst[kind]){ const k = Math.floor(y.x / 220) + "," + Math.floor(y.y / 220);
        let a = chunks.get(k); if(!a){ a = []; chunks.set(k, a); } a.push(y); }
      for(const list of chunks.values()){
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for(const y of list){ x0 = Math.min(x0, y.x); x1 = Math.max(x1, y.x); y0 = Math.min(y0, y.y); y1 = Math.max(y1, y.y); }
      const rad = Math.hypot(x1 - x0, y1 - y0) / 2 + md.L * 0.8;
      const hm = new THREE.InstancedMesh(shareGeo(md.hull, (x0 + x1) / 2, (y0 + y1) / 2, rad), hullMat, list.length);
      const tm = new THREE.InstancedMesh(shareGeo(md.top, (x0 + x1) / 2, (y0 + y1) / 2, rad + 20), topMat, list.length);
      list.forEach((y, i) => {
        obj.position.set(y.x, 0, y.y); obj.rotation.set(0, -y.a, 0); obj.scale.setScalar(y.s); obj.updateMatrix();
        hm.setMatrixAt(i, obj.matrix); tm.setMatrixAt(i, obj.matrix);
        hm.setColorAt(i, new THREE.Color(y.col).convertSRGBToLinear());
      });
      for(const m of [hm, tm]){ m.castShadow = true; m.receiveShadow = true; m.userData.dynamic = true; m.frustumCulled = true; g.add(m); }
      this.yachtSets.push({ list, hm, tm });
      total += list.length;
      }
    }
    // the moored boats breathe on the water: a little heave, roll and pitch
    this.anim.push((t, frame) => {
      if(frame % 2) return;
      for(const set of this.yachtSets){
        set.list.forEach((y, i) => {
          const w = t * 0.9 + y.ph;
          obj.position.set(y.x, Math.sin(w) * 0.08 * y.s, y.y);
          obj.rotation.set(Math.sin(w * 0.7) * 0.012, -y.a, Math.sin(w * 1.1 + 1) * 0.006, "YXZ");
          obj.scale.setScalar(y.s); obj.updateMatrix();
          set.hm.setMatrixAt(i, obj.matrix); set.tm.setMatrixAt(i, obj.matrix);
        });
        set.hm.instanceMatrix.needsUpdate = true; set.tm.instanceMatrix.needsUpdate = true;
      }
    });
    this.stats = Object.assign(this.stats || {}, { yachts:total, berths:berths.length });

    /* the cruise ship, along the seaward face of the Digue */
    const dig = (this.piers || []).filter(p => !p.pontoon).sort((a, b) => b.area - a.area)[0];
    if(dig){
      // the long axis of the breakwater
      let A = dig.ring[0], Bq = dig.ring[1], bd = 0;
      for(const p of dig.ring) for(const q2 of dig.ring){ const d = Math.hypot(p[0] - q2[0], p[1] - q2[1]); if(d > bd){ bd = d; A = p; Bq = q2; } }
      const ax = (Bq[0] - A[0]) / bd, ay = (Bq[1] - A[1]) / bd, mx = (A[0] + Bq[0]) / 2, my = (A[1] + Bq[1]) / 2;
      for(const sd of [1, -1]){
        const x = mx - ay * sd * 30, y = my + ax * sd * 30;
        if(wet(x, y) && this.seaDistAt(x, y) > 40){ this.cruise(G, g, x, y, Math.atan2(ay, ax)); break; }
      }
    }
    /* tenders shuttling about the basin, with a white V behind each */
    const tenders = [];
    const hc = this.harbourCentre();
    for(let k = 0; k < 7; k++){
      const r = 40 + rnd() * 90, ph = rnd() * TAU, sp = (0.05 + rnd() * 0.05) * (rnd() < 0.5 ? -1 : 1);
      tenders.push({ r, ph, sp, cx:hc[0] + (rnd() - 0.5) * 60, cy:hc[1] + (rnd() - 0.5) * 60 });
    }
    const tg = LB.merge([this.hull(7, 1.3, 0.5, 0.8), (() => { const b = new THREE.BoxGeometry(2, 0.9, 1.8); b.translate(-0.5, 1.1, 0);
      const c = new Float32Array(b.attributes.position.count * 3).fill(0.3); b.setAttribute("color", new THREE.BufferAttribute(c, 3)); return b.toNonIndexed(); })()]);
    const tmesh = new THREE.InstancedMesh(tg, new THREE.MeshStandardMaterial({ vertexColors:true, roughness:0.3 }), tenders.length);
    const wg = new THREE.PlaneGeometry(1, 1); wg.rotateX(-Math.PI / 2);
    // a wake: a white fan behind the boat
    const wp = wg.attributes.position; wp.setXYZ(0, -9, 0.05, -3.5); wp.setXYZ(1, 0, 0.05, -0.6); wp.setXYZ(2, -9, 0.05, 3.5); wp.setXYZ(3, 0, 0.05, 0.6);
    const wmesh = new THREE.InstancedMesh(wg, new THREE.MeshBasicMaterial({ map:PTEX.foam(), color:0xffffff, transparent:true,
      opacity:0.6, depthWrite:false, side:THREE.DoubleSide }), tenders.length);
    for(const m of [tmesh, wmesh]){ m.userData.dynamic = true; m.frustumCulled = false; g.add(m); }
    this.anim.push(t => {
      tenders.forEach((b, i) => {
        let a = b.ph + t * b.sp, x = b.cx + Math.cos(a) * b.r, y = b.cy + Math.sin(a) * b.r * 0.6;
        const hdg = Math.atan2(Math.cos(a) * b.r * 0.6 * b.sp, -Math.sin(a) * b.r * b.sp);
        obj.position.set(x, 0.05, y); obj.rotation.set(0, -hdg, 0); obj.scale.setScalar(1); obj.updateMatrix();
        tmesh.setMatrixAt(i, obj.matrix); wmesh.setMatrixAt(i, obj.matrix);
      });
      tmesh.instanceMatrix.needsUpdate = true; wmesh.instanceMatrix.needsUpdate = true;
    });
    // tenders must stay in water: keep their loops away from the quays
    for(const b of tenders){ for(let k = 0; k < 6; k++){ let ok = true;
      for(let a = 0; a < TAU; a += 0.4) if(!wet(b.cx + Math.cos(a) * b.r, b.cy + Math.sin(a) * b.r * 0.6)){ ok = false; break; }
      if(ok) break; b.r *= 0.7; } }

    this.harbourFront(G, g, T);
  },
  onPier(x, y){
    for(const p of (this.piers || [])){
      const b = p.bb; if(!b || x < b[0] || x > b[2] || y < b[1] || y > b[3]) continue;
      let inside = false; const R = p.ring;
      for(let i = 0, j = R.length - 1; i < R.length; j = i++){
        if((R[i][1] > y) !== (R[j][1] > y) && x < (R[j][0] - R[i][0]) * (y - R[i][1]) / (R[j][1] - R[i][1]) + R[i][0]) inside = !inside;
      }
      if(inside) return true;
    }
    return false;
  },
  harbourCentre(){
    // Port Hercule: the water enclosed by the most pier length
    let sx = 0, sy = 0, n = 0;
    for(const p of (this.piers || [])) for(const [x, y] of p.ring){ sx += x; sy += y; n++; }
    return n ? [sx / n, sy / n] : [-120, 110];
  },
  cruise(G, g, x, y, ang){
    const L = 210, B = 15;
    const grp = new THREE.Group();
    const hullG = this.hull(L, B, 7, 9);
    const hm = new THREE.Mesh(hullG, new THREE.MeshStandardMaterial({ vertexColors:true, color:G.col("#F4F4F2"), roughness:0.3 }));
    grp.add(hm);
    const white = G.mat("#F6F6F4", { roughness:0.45 }), win = G.mat("#1C2A3A", { roughness:0.15, metalness:0.3 });
    for(let k = 0; k < 7; k++){
      const len = L * (0.74 - k * 0.035), z = 9 + k * 3;
      const d = new THREE.Mesh(new THREE.BoxGeometry(len, 2.1, B * 1.86 - k * 0.6), white); d.position.set(-L * 0.04, z + 1.05, 0); grp.add(d);
      const w = new THREE.Mesh(new THREE.BoxGeometry(len * 0.98, 0.8, B * 1.88 - k * 0.6), win); w.position.set(-L * 0.04, z + 1.2, 0); grp.add(w);
    }
    const fn = new THREE.Mesh(new THREE.BoxGeometry(14, 10, 8), G.mat("#1E3A6A")); fn.position.set(-L * 0.22, 35, 0); grp.add(fn);
    grp.position.set(x, 0, y); grp.rotation.y = -ang;
    grp.traverse(o => { if(o.isMesh){ o.castShadow = true; o.receiveShadow = true; o.userData.dynamic = true; } });
    g.add(grp);
  },

  /* the harbour front: the pool, the grandstands and terraces, pines and palms */
  harbourFront(G, g, T){
    const M = this.M, rnd = mulberry(4711), n = T.n;
    // the Stade Nautique Rainier III: the pool nearest the mapped point
    let pool = null, pd = Infinity;
    for(const r of (M.poly.pool || [])){
      let cx = 0, cy = 0; for(const [x, y] of r){ cx += x; cy += y; } cx /= r.length; cy /= r.length;
      const d = Math.hypot(cx - M.lm.piscine[0], cy - M.lm.piscine[1]); if(d < pd){ pd = d; pool = { r, cx, cy }; }
    }
    if(pool && pd < 80){
      // lane lines along its long axis
      let A = pool.r[0], Bq = pool.r[1], bd = 0;
      for(const p of pool.r) for(const q2 of pool.r){ const d = Math.hypot(p[0] - q2[0], p[1] - q2[1]); if(d > bd){ bd = d; A = p; Bq = q2; } }
      const ang = Math.atan2(Bq[1] - A[1], Bq[0] - A[0]);
      const z = this.ground(pool.cx, pool.cy) + 0.3;
      const lanes = [];
      for(let k = -3; k <= 3; k++) lanes.push([pool.cx - Math.sin(ang) * k * 2.5, pool.cy + Math.cos(ang) * k * 2.5, z, -ang, 1]);
      const lg = new THREE.BoxGeometry(bd * 0.7, 0.05, 0.25);
      LB.many(G, g, lg, G.glowMat("#F4F4F4", 0.2, { color:G.col("#F4F4F4") }), lanes, false);
    }
    // grandstands: on the quay between the circuit and the water, and behind the pits
    const stands = [[0.705, 0.745, -1], [0.765, 0.800, -1], [0.828, 0.852, -1], [0.955, 0.995, 1], [0.020, 0.040, -1]];
    const people = [];
    for(const [a, b, sd] of stands){
      const i0 = Math.round(a * n), i1 = Math.round(b * n);
      for(let i = i0; i < i1; i += 2){
        const back = sd > 0 ? T.half + T.pitW + 10 : T.half + T.roAt(i, sd) + 3.5;
        const x = T.x[i] + T.nx[i] * sd * back, y = T.y[i] + T.ny[i] * sd * back;
        if(!this.M.land(x, y)) continue;
        const ang = T.ang[i];
        // stand on the highest ground under it, or the hill behind the pits swallows the lower rows
        let base = T.z[i];
        for(let row = 0; row < 7; row++){
          const o = back + row * 0.9;
          base = Math.max(base, this.ground(T.x[i] + T.nx[i] * sd * o, T.y[i] + T.ny[i] * sd * o));
        }
        if(base > T.z[i] + 0.2) base += 0.8;            // the terrain mesh is coarser than ground()
        for(let row = 0; row < 7; row++){
          const o = back + row * 0.9;
          const rx = T.x[i] + T.nx[i] * sd * o, ry = T.y[i] + T.ny[i] * sd * o, rz = base + 0.4 + row * 0.62;
          if(!this.M.land(rx, ry) && row > 1) break;
          LB.box(G, g, rx, ry, T.z[i] - 1, T.ds * 2.02, 0.9, rz - T.z[i] + 1, ang, G.mat(row % 2 ? "#C8CCD2" : "#B8BEC6", { roughness:0.8 }));
          for(let s = 0; s < 4; s++) if(rnd() < 0.85)
            people.push([rx + Math.cos(ang) * (s - 1.5) * 3.2, ry + Math.sin(ang) * (s - 1.5) * 3.2, rz, -ang - Math.PI / 2 * sd, 0.95 + rnd() * 0.1]);
        }
      }
    }
    if(people.length) this.crowd(G, g, people);
    // palms and umbrella pines along the quay side of the harbour straights
    const palms = [], pines = [];
    for(let i = 0; i < n; i += 3){
      const u = i / n;
      if(!(u > 0.62 && u < 0.99)) continue;
      for(const sd of [-1, 1]){
        const o = sd * (this.rin(i, sd) + 2.5);
        const x = T.x[i] + T.nx[i] * o, y = T.y[i] + T.ny[i] * o;
        if(!this.M.land(x, y) || this.onPier(x, y)) continue;
        if(rnd() < 0.35) (rnd() < 0.75 ? palms : pines).push([x, y, this.ground(x, y), rnd() * TAU, 0.9 + rnd() * 0.3]);
      }
    }
    this.trees(G, g, { palm:palms, pine:pines, cypress:[], broad:[] });
  },

  /* ---- the tunnel under the Fairmont ----
     A proper box this time: roof slab, a solid wall on the hill side, a sea wall
     of piers and openings that lets the low sun in in slashes, portals with a lip
     at each end, and two rows of lamps. Every piece of it, and everything built
     on top, uses the dithered fade: pixels are discarded in a Bayer pattern
     rather than blended, so nothing needs sorting and nothing flickers. */
  tunnel(G, g, T){
    const n = T.n, w = T.half;
    const nodes = []; for(let i = 0; i < n; i++) if(T.inTunnel(i)) nodes.push(i);
    if(!nodes.length) return;
    this.tunnelNodes = nodes;
    const conc = G.ditherMat(G.mat("#C4BCAE", { roughness:0.92 }));
    const concDark = G.ditherMat(G.mat("#8E877C", { roughness:0.95 }));
    const lip = G.ditherMat(G.mat("#D8D0C0", { roughness:0.85 }), true);
    const lampM = G.ditherMat(G.glowMat("#FFE6B8", 2.2));
    const roofO = i => w + Math.max(T.roL[i], T.roR[i]) + 2.2;
    const inT = i => T.inTunnel(i);
    const add = (geo, mat, cast) => { if(!geo) return; const m = new THREE.Mesh(geo, mat); m.castShadow = cast !== false;
      m.receiveShadow = true; m.userData.dynamic = true; g.add(m); this.fade.push(m); return m; };
    // which side is the sea, per node
    const sea = new Int8Array(n);
    for(const i of nodes){
      const o = w + 16;
      const l = this.M.land(T.x[i] - T.nx[i] * o, T.y[i] - T.ny[i] * o), r = this.M.land(T.x[i] + T.nx[i] * o, T.y[i] + T.ny[i] * o);
      sea[i] = l && !r ? 1 : !l && r ? -1 : (this.raw(T.x[i] + T.nx[i] * o, T.y[i] + T.ny[i] * o) < this.raw(T.x[i] - T.nx[i] * o, T.y[i] - T.ny[i] * o) ? 1 : -1);
    }
    // the roof slab: its underside and its top
    add(G.strip(T, i => -roofO(i), i => roofO(i), 6.0, 6, inT), concDark, true);
    add(G.strip(T, i => -roofO(i), i => roofO(i), 6.9, 6, inT), conc, true);
    for(const sd of [-1, 1]){
      const o = i => sd * roofO(i);
      add(G.wall(T, i => sd * (roofO(i) - 0.02), 6.9, inT, 0.02), G.twoSided(conc), true);
      // the land-side wall is solid; the sea side is piers with openings
      const landSide = i => sea[i] !== sd;
      add(G.wall(T, i => sd * (roofO(i) - 0.6), 6.0, i => inT(i) && landSide(i)), G.twoSided(conc), true);
    }
    const piers = [];
    for(let k = 0; k < nodes.length; k += 2){
      const i = nodes[k], sd = sea[i], o = sd * (roofO(i) - 0.6);
      piers.push([T.x[i] + T.nx[i] * o, T.y[i] + T.ny[i] * o, T.z[i], -T.ang[i], 1]);
    }
    const pg = new THREE.BoxGeometry(3.0, 6.0, 1.1); pg.translate(0, 3.0, 0);
    const pm = LB.many(G, g, pg, G.ditherMat(G.mat("#C4BCAE", { roughness:0.92 })), piers, true);
    if(pm) this.fade.push(pm);
    // a lintel along the top of the openings
    for(const sd of [-1, 1]) add(G.wall(T, i => sd * (roofO(i) - 0.6), 6.0, i => inT(i) && sea[i] === sd, -4.4), G.twoSided(conc), true);
    // the portals: a lip across the road at each end
    for(const i of [nodes[0], nodes[nodes.length - 1]]){
      const ang = T.ang[i], z = T.z[i];
      const m = LB.box(G, g, T.x[i], T.y[i], z + 4.9, 1.6, roofO(i) * 2 + 1.4, 2.1, ang, lip);
      m.userData.dynamic = true; this.fade.push(m);
      for(const sd of [-1, 1]){
        const o = sd * (roofO(i) + 0.4);
        const p2 = LB.box(G, g, T.x[i] + T.nx[i] * o, T.y[i] + T.ny[i] * o, z, 1.6, 1.4, 7.0, ang, lip);
        p2.userData.dynamic = true; this.fade.push(p2);
      }
    }
    // the lamps: two rows of warm strips on the ceiling
    const lamps = [];
    for(const i of nodes) for(const o of [-3.2, 3.2])
      lamps.push([T.x[i] + T.nx[i] * o, T.y[i] + T.ny[i] * o, T.z[i] + 5.92, -T.ang[i], 1]);
    const lg = new THREE.BoxGeometry(3.2, 0.08, 0.35);
    const lm2 = LB.many(G, g, lg, lampM, lamps, false);
    if(lm2) this.fade.push(lm2);
    // a warm light that rides along with the leader through the tunnel: the
    // lamps sliding over the car, for the price of one light
    const L = new THREE.PointLight(G.col("#FFD9A0"), 0, 26, 2);
    L.userData.dynamic = true; g.add(L); this.tunnelLight = L;
    this.tunnelRange = [nodes[0], nodes[nodes.length - 1]];
  },

  /* ---- footbridges: barrier to barrier, on stair towers that reach the ground ---- */
  footbridges(G, g, T, list){
    const n = T.n, rnd = mulberry(818);
    const deck = G.mat("#3A3F48", { roughness:0.7, metalness:0.3 });
    const rail = G.mat("#8A96A4", { roughness:0.5, metalness:0.3 });
    const tower = G.mat("#333842");
    const ppl = [];
    for(const o of list){
      const i = Math.round(o.u * n) % n, a = T.ang[i];
      const ext = sd => {
        let e = this.rin(i, sd) + 1.4;
        if(sd === T.pitSide && T.inPitZone(i)) e = Math.max(e, T.half + T.pitW + 2.4);
        return e;
      };
      const eL = -ext(-1), eR = ext(1), len = eR - eL, mid = (eR + eL) / 2;
      const cx = T.x[i] + T.nx[i] * mid, cy = T.y[i] + T.ny[i] * mid;
      const zd = T.z[i] + 6.4;
      LB.box(G, g, cx, cy, zd, 4.4, len, 0.8, a, deck);
      for(const sd of [-1, 1]){
        // the rail and the canopy post at each edge
        const rx = cx + Math.cos(a) * sd * 2.1, ry = cy + Math.sin(a) * sd * 2.1;
        LB.box(G, g, rx, ry, zd + 0.8, 0.18, len, 1.2, a, rail);
      }
      LB.box(G, g, cx, cy, zd + 3.4, 4.8, len, 0.35, a, G.mat("#6E7A88"));
      // a stair tower at each end, standing on the ground it lands on
      for(const e of [eL - 2.6, eR + 2.6]){
        const x = T.x[i] + T.nx[i] * e, y = T.y[i] + T.ny[i] * e;
        let lo = Infinity;
        for(const [dx, dy] of [[0, 0], [2, 2], [-2, 2], [2, -2], [-2, -2]])
          lo = Math.min(lo, this.ground(x + dx, y + dy));
        const base = Math.min(lo, zd - 3) - 0.6;
        LB.box(G, g, x, y, base, 4.4, 4.4, zd + 0.8 - base, a, tower);
      }
      for(let k = 0; k < 12; k++)
        ppl.push([cx + T.nx[i] * (rnd() - 0.5) * len * 0.8 + Math.cos(a) * (rnd() - 0.5) * 2,
                  cy + T.ny[i] * (rnd() - 0.5) * len * 0.8 + Math.sin(a) * (rnd() - 0.5) * 2, zd + 0.8, rnd() * TAU, 1]);
    }
    if(ppl.length){
      const hg = new THREE.CylinderGeometry(0.26, 0.3, 1.7, 5); hg.translate(0, 0.85, 0);
      LB.many(G, g, hg, G.mat("#7A6A78"), ppl, false);
    }
  },

  /* ---- dressing the lap: cranes, the banner, gantries, bridges, clutter ---- */
  dressing(G, g, T, S){
    const rnd = mulberry(606), n = T.n;
    // hand the generic street-circuit furniture the right context
    Object.assign(CITY, { G, T, night:T.night, rnd:mulberry(33), keepOut:[], _spots:new Map(), streetSegs:[] });
    try{ CITY.furniture(G, g, T); }catch(e){ console.warn("monaco furniture", e.message); }
    try{ CITY.adverts(G, g, T); }catch(e){ console.warn("monaco adverts", e.message); }
    // the Strip's overpass is 84 m long and 9 m up: on a hillside it lands on other roads.
    // Monaco gets its own, just wide enough for the road it crosses
    { const br = T.def.bridges; T.def.bridges = null;
      try{ CITY.blocks(G, g, T); }catch(e){ console.warn("monaco blocks", e.message); }
      finally{ T.def.bridges = br; }
      try{ this.footbridges(G, g, T, br || []); }catch(e){ console.warn("monaco footbridges", e.message); } }
    // the red telescopic TV cranes, over the hairpin, the Casino and the harbour
    for(const [u, sd, reach] of [[0.378, 1, 26], [0.262, -1, 22], [0.745, 1, 24]]){
      const i = Math.round(u * n) % n, o = sd * (this.rin(i, sd) + 6);
      const x = T.x[i] + T.nx[i] * o, y = T.y[i] + T.ny[i] * o, z = this.ground(x, y);
      const red = G.mat("#D22A22", { roughness:0.5, metalness:0.3 });
      LB.box(G, g, x, y, z, 6, 2.6, 2.4, T.ang[i], G.mat("#2A2E34"));
      LB.cyl(G, g, x, y, z + 2.4, 0.9, 0.9, 1.8, red, 10);
      const boom = new THREE.Mesh(new THREE.BoxGeometry(reach, 0.7, 0.7), red);
      const ang = Math.atan2(T.y[i] - y, T.x[i] - x);
      boom.position.set(x + Math.cos(ang) * reach * 0.42, z + 4.2 + reach * 0.32, y + Math.sin(ang) * reach * 0.42);
      boom.rotation.set(0, -ang, 0.62, "YXZ"); boom.castShadow = true; boom.userData.dynamic = true; g.add(boom);
      LB.box(G, g, x + Math.cos(ang) * reach * 0.84, y + Math.sin(ang) * reach * 0.84, z + 3.6 + reach * 0.62, 1.2, 1.0, 1.0, ang, G.mat("#16181C"));
    }
    // the MONACO banner on the outside wall of the hairpin
    { const i = Math.round(0.374 * n) % n;
      // the outside of a left-hander is +1
      const o = this.rin(i, 1) - 3.9;
      const x = T.x[i] + T.nx[i] * o, y = T.y[i] + T.ny[i] * o;
      LB.text(G, g, "MONACO", x, y, T.z[i] + 2.9, 30, 3.4, T.ang[i], "#D8202A", "#F6F6F4"); }
    // Monaco's ornate street lamps along the pavements, and the mapped ones
    const lamps = [];
    for(let i = 0; i < n; i += 5){
      if(T.inTunnel(i)) continue;
      for(const sd of [-1, 1]){ if((i / 5 + (sd > 0 ? 1 : 0)) % 2) continue;
        const o = sd * (this.rin(i, sd) - 1.0);
        lamps.push([T.x[i] + T.nx[i] * o, T.y[i] + T.ny[i] * o, T.z[i] + 0.14, 0, 1]); }
    }
    for(const [x, y] of this.M.lamps){ const q = this.near(x, y, 30); if(q && q.d < this.rin(q.i, q.side)) continue; lamps.push([x, y, this.ground(x, y), 0, 1]); }
    { const post = new THREE.CylinderGeometry(0.09, 0.14, 4.6, 6); post.translate(0, 2.3, 0);
      const head = new THREE.SphereGeometry(0.34, 8, 6); head.translate(0, 4.75, 0);
      LB.many(G, g, post, G.mat("#1E2A24", { roughness:0.5, metalness:0.5 }), lamps, false);
      LB.many(G, g, head, G.mat("#F6F2E4", { roughness:0.3 }), lamps, false); }
    // planters and flower beds along the pavements: Monaco is very manicured
    const beds = [];
    for(let i = 2; i < n; i += 9){
      if(T.inTunnel(i)) continue;
      const sd = i % 2 ? 1 : -1, o = sd * (this.rin(i, sd) - 2.2);
      beds.push([T.x[i] + T.nx[i] * o, T.y[i] + T.ny[i] * o, T.z[i] + 0.14, -T.ang[i], 1]);
    }
    { const bx = new THREE.BoxGeometry(3.2, 0.7, 1.1); bx.translate(0, 0.35, 0);
      const fl = new THREE.BoxGeometry(3.0, 0.35, 0.95); fl.translate(0, 0.85, 0);
      LB.many(G, g, bx, G.mat("#E0D6C2"), beds, false);
      LB.many(G, g, fl, G.mat("#C83A5A", { roughness:0.9 }), beds.filter((_, k) => k % 2), false);
      LB.many(G, g, fl, G.mat("#E8A030", { roughness:0.9 }), beds.filter((_, k) => !(k % 2)), false); }
    // parked cars and scooters on the side streets, behind the fences
    const cars = [], scoot = [];
    for(let cl = 0; cl <= 1; cl++) for(const line of (this.M.streets[cl] || [])){
      for(let k = 0; k < line.length - 1; k++){
        const [ax, ay] = line[k], [bx, by] = line[k + 1], L2 = Math.hypot(bx - ax, by - ay);
        const nx = -(by - ay) / (L2 || 1), ny = (bx - ax) / (L2 || 1), ang = Math.atan2(by - ay, bx - ax);
        for(let s = 3; s < L2 - 3; s += 6.5){
          if(rnd() > 0.5) continue;
          const sd = rnd() < 0.5 ? -1 : 1, off = sd * ((cl ? 7.5 : 10.5) / 2 - 1.3);
          const x = ax + (bx - ax) * s / L2 + nx * off, y = ay + (by - ay) * s / L2 + ny * off;
          const q = this.near(x, y, 60); if(!q || q.d > 180 || q.d < this.rin(q.i, q.side) + 2) continue;
          (rnd() < 0.35 ? scoot : cars).push([x, y, this.ground(x, y) + 0.12, -ang, 1]);
        }
      }
    }
    if(cars.length) CITY.cars(G, g, cars);
    if(scoot.length){ const sg = new THREE.BoxGeometry(1.8, 1.0, 0.6); sg.translate(0, 0.5, 0);
      LB.many(G, g, sg, G.mat("#D8DCE0", { roughness:0.4, metalness:0.3 }), scoot, false); }
    // luxury cars lined up outside the Casino
    if(this.M.lm.casino){
      const lux = [], [x0, y0] = this.M.lm.fountain, [x1, y1] = this.M.lm.casino;
      const ang = Math.atan2(y1 - y0, x1 - x0);
      for(let k = -3; k <= 3; k++){
        const x = x1 + Math.cos(ang) * -24 + Math.cos(ang + Math.PI / 2) * k * 3.2, y = y1 + Math.sin(ang) * -24 + Math.sin(ang + Math.PI / 2) * k * 3.2;
        const q = this.near(x, y, 30); if(q && q.d < this.rin(q.i, q.side)) continue;
        lux.push([x, y, this.ground(x, y), -ang, 1]);
      }
      const cols = ["#C8201E", "#F2C230", "#E8E8E8", "#1A1C20", "#2E6ABE"];
      cols.forEach((c, k) => { const sub = lux.filter((_, j) => j % cols.length === k);
        if(sub.length){ const b = new THREE.BoxGeometry(4.6, 1.1, 2.0); b.translate(0, 0.6, 0);
          LB.many(G, g, b, G.mat(c, { roughness:0.25, metalness:0.6 }), sub, true); } });
    }
    // the Casino gardens and fountain in the middle of the square
    if(this.M.lm.fountain){
      const [fx, fy] = this.M.lm.fountain, fz = this.ground(fx, fy);
      const lawn = new THREE.Mesh(new THREE.CircleGeometry(1, 32), G.mat("#6E9A4A", { roughness:0.95 }));
      lawn.rotation.x = -Math.PI / 2; lawn.scale.set(22, 13, 1); lawn.position.set(fx, fz + 0.2, fy); lawn.userData.dynamic = true;
      g.add(lawn);
      LB.cyl(G, g, fx, fy, fz, 5.2, 5.4, 0.8, G.mat("#EDE6D6"), 24);
      const basin = new THREE.Mesh(new THREE.CircleGeometry(4.8, 24), new THREE.MeshStandardMaterial({ color:G.col("#3AA8C8"), roughness:0.05, envMapIntensity:1.5 }));
      basin.rotation.x = -Math.PI / 2; basin.position.set(fx, fz + 0.82, fy); basin.userData.dynamic = true; g.add(basin);
      LB.cyl(G, g, fx, fy, fz + 0.8, 0.35, 0.1, 3.4, G.mat("#EAF6FA", { transparent:true, opacity:0.7 }), 8);
      const beds2 = [];
      for(let k = 0; k < 14; k++){ const a = k / 14 * TAU; beds2.push([fx + Math.cos(a) * 16, fy + Math.sin(a) * 9, fz + 0.2, a, 1]); }
      const bg = new THREE.CylinderGeometry(1.1, 1.1, 0.4, 8); bg.translate(0, 0.2, 0);
      LB.many(G, g, bg, G.mat("#D83A6A", { roughness:0.9 }), beds2, false);
    }
  },

  /* ---- every frame ---- */
  frame(S, G){
    const T = this.T; if(!T) return;
    const now = performance.now(), dt = clamp((now - (this._last || now)) / 1000, 0.001, 0.05) || 0.016;
    this._last = now; this.dt = dt;
    this.t = (this.t || 0) + dt; this.fno = (this.fno || 0) + 1;
    if(this.timeU) this.timeU.value = this.t;
    for(const f of this.anim) f(this.t, this.fno);
    // the tunnel: fade it (and the Fairmont) for the player's car, in the
    // overhead camera only (never from the cockpit), eased over about a third of a second
    const p = S.player; if(!p || !this.tunnelRange) return;
    const [a, b] = this.tunnelRange, n = T.n;
    const i = p.node, inside = T.inTunnel(i);
    const before = ((a - i) % n + n) % n * T.ds, after = ((i - b) % n + n) % n * T.ds;
    const nearIt = inside || before < 40 || after < 25;
    const want = (nearIt && !R.tv && G.cam !== G.camFP) ? 0.12 : 1;
    const k = 1 - Math.pow(0.0005, dt);
    this.fadeV = this.fadeV == null ? 1 : this.fadeV + (want - this.fadeV) * k;
    G.fadeU.value = this.fadeV;
    G.fadeEdgeU.value = Math.max(this.fadeV, 0.42);
    // inside: the lamps slide over the car, the frame darkens, the exit blazes
    const L = this.tunnelLight;
    if(L){
      if(inside){
        L.position.set(p.x, p.z + 4.8, p.y);
        L.intensity = 1.4 * (0.55 + 0.45 * Math.cos(T.s[i] / 6 * TAU));
      } else L.intensity = 0;
    }
    const gr = G.grade; if(gr){
      const toExit = ((b - i) % n + n) % n * T.ds;
      const tgt = inside ? (toExit < 70 ? 1.02 + (70 - toExit) / 70 * 0.28 : 0.86) : 1.02;
      gr.exposure += (tgt - gr.exposure) * k * 0.6;
    }
  },
};

/* ---- building the world for a session ---------------------------------- */
/* trees and their trunks stand wherever the survey put them, which includes the pit lane: take the
   tall ones out of the instanced batches within reach of it so the box and the crew can be seen */


export { MONACO };
