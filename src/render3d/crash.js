import * as THREE from 'three';
import { TAU, clamp, lerp } from '../config/util.js';
import { CAR_SPEC } from '../car/spec.js';
import { wearLook } from '../car/tyrewear.js';
import { spawn } from '../render2d/particles.js';
import { CARGEO } from './car.js';
import { G3 } from './g3.js';
import { SFX } from './cine.js';

/* ---------- crashes, in 3D -------------------------------------------------
   Three jobs, all driven by what the physics reports and none of them feeding
   back into it:

   - crumple: the car's body is a faceted mesh built once per team. When a car
     has dents, it gets its own copy, cut finer so there is something to bend,
     and every vertex near a dent is pushed into the car, scattered a little
     and darkened to bare carbon. Depth is how hard the hit was; place is where
     it landed.
   - debris: wings, wheels and bodywork come off as little bodies of their own
     that fly, bounce and come to rest on the circuit, and stay there.
   - the effect queue (S.fx) is read once a frame, so a hit is shown the frame
     it happens, in slow motion too.                                          */
const GRAV = 21;

function hash3(x, y, z, s){
  const v = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + s * 19.19) * 43758.5453;
  return v - Math.floor(v);
}

/* cut every large triangle into four, up to a few times; colours follow the triangle */
function subdivide(src, maxEdge, passes){
  let pos = src.attributes.position.array, col = src.attributes.color.array;
  for(let pass = 0; pass < passes; pass++){
    const np = [], nc = [];
    let any = false;
    for(let i = 0; i < pos.length; i += 9){
      const ax = pos[i], ay = pos[i + 1], az = pos[i + 2], bx = pos[i + 3], by = pos[i + 4], bz = pos[i + 5], cx = pos[i + 6], cy = pos[i + 7], cz = pos[i + 8];
      const L = Math.max(Math.hypot(bx - ax, by - ay, bz - az), Math.hypot(cx - bx, cy - by, cz - bz), Math.hypot(ax - cx, ay - cy, az - cz));
      const r = col[i], g = col[i + 1], b = col[i + 2];
      if(L <= maxEdge){ for(let k = 0; k < 9; k++){ np.push(pos[i + k]); nc.push(col[i + k]); } continue; }
      any = true;
      const abx = (ax + bx) / 2, aby = (ay + by) / 2, abz = (az + bz) / 2, bcx = (bx + cx) / 2, bcy = (by + cy) / 2, bcz = (bz + cz) / 2, cax = (cx + ax) / 2, cay = (cy + ay) / 2, caz = (cz + az) / 2;
      np.push(ax, ay, az, abx, aby, abz, cax, cay, caz,  abx, aby, abz, bx, by, bz, bcx, bcy, bcz,
              cax, cay, caz, bcx, bcy, bcz, cx, cy, cz,  abx, aby, abz, bcx, bcy, bcz, cax, cay, caz);
      for(let k = 0; k < 12; k++) nc.push(r, g, b);
    }
    pos = new Float32Array(np); col = new Float32Array(nc);
    if(!any) break;
  }
  return { pos:Float32Array.from(pos), col:Float32Array.from(col) };
}

const SCRAPE = [0.045, 0.047, 0.052], BARE = [0.30, 0.31, 0.33];

const CRASH = {
  subs:new Map(), items:[], group:null, _t:null,

  /* the finer copy of a body, once per base mesh */
  fine(base){
    let f = this.subs.get(base.uuid);
    if(!f){ f = subdivide(base, 0.26, 2); this.subs.set(base.uuid, f); }
    return f;
  },
  /* a car's own body, bent by its dents */
  deformed(base, dents){
    const f = this.fine(base), n = f.pos.length / 3;
    const pos = new Float32Array(f.pos), col = new Float32Array(f.col);
    for(let v = 0; v < n; v++){
      let x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
      const x0 = x, y0 = y, z0 = z;
      for(const d of dents){
        const dx = x0 - d.x, dz = z0 - d.z, dy = (y0 - 0.32) * 0.7;
        const R = 0.5 + d.mag * 0.95, dist = Math.sqrt(dx * dx + dz * dz + dy * dy);
        if(dist >= R) continue;
        let w = 1 - dist / R; w = w * w * (3 - 2 * w);
        const nz = hash3(Math.round(x0 * 12), Math.round(y0 * 12), Math.round(z0 * 12), d.seed);
        const push = Math.min(0.55, d.mag * 0.36) * w * (0.5 + nz * 0.9);
        x += d.nx * push; z += d.nz * push;
        // crumple: the skin is thrown about, most where it was hit hardest
        const j = d.mag * w * 0.16;
        x += (hash3(x0 * 9, y0 * 9, z0 * 9, d.seed + 1) - 0.5) * j;
        y += (hash3(x0 * 9, y0 * 9, z0 * 9, d.seed + 2) - 0.5) * j * 1.4 - w * d.mag * 0.04;
        z += (hash3(x0 * 9, y0 * 9, z0 * 9, d.seed + 3) - 0.5) * j;
        // the paint goes: scraped to black carbon, streaked with bare metal
        const t = clamp(w * (0.45 + d.mag * 0.9) * (0.55 + nz * 0.7), 0, 1);
        const to = nz > 0.72 ? BARE : SCRAPE;
        col[v * 3] += (to[0] - col[v * 3]) * t; col[v * 3 + 1] += (to[1] - col[v * 3 + 1]) * t; col[v * 3 + 2] += (to[2] - col[v * 3 + 2]) * t;
      }
      pos[v * 3] = x; pos[v * 3 + 1] = y; pos[v * 3 + 2] = z;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals(); g.computeBoundingSphere();
    return g;
  },

  build(G, S){
    this.items.length = 0; this._t = null;
    this.group = new THREE.Group(); this.group.name = "debris";
    G.world.add(this.group);
    this.box = new THREE.BoxGeometry(1, 1, 1);
    this.pieces = new Map();
  },
  /* a wing as a body of its own: the mesh re-centred on itself so it tumbles about its middle */
  piece(G, key, geo){
    let p = this.pieces.get(key);
    if(!p){
      const g = geo.clone(); g.computeBoundingBox();
      const c = new THREE.Vector3(); g.boundingBox.getCenter(c); g.translate(-c.x, -c.y, -c.z);
      p = { geo:g, c }; this.pieces.set(key, p);
    }
    return p;
  },
  add(it){
    if(this.items.length > 170){ const o = this.items.shift(); this.group.remove(o.m); }
    this.items.push(it); this.group.add(it.m);
  },

  /* read what the physics reported */
  fx(G, S){
    const q = S.fx;
    if(!q || !q.length) return;
    S.fx = [];
    const p = S.player;
    for(const ev of q){
      const e = G.cars.find(x => x.c === ev.car);
      if(!e) continue;
      const g = e.g, c = e.c;
      // do not spend meshes on a pile-up on the far side of the circuit
      if(p && c !== p && Math.hypot(c.x - p.x, c.y - p.y) > 160) continue;
      const near = p ? Math.hypot(c.x - p.x, c.y - p.y) : 0;
      if(near < 120){ if(ev.t === "crash") SFX.crash(true); else if(ev.t === "shards" && ev.n > 5) SFX.hit(); else if(ev.t === "wheel" || ev.t === "part") SFX.hit(); }
      g.updateMatrixWorld(true);
      const quat = new THREE.Quaternion(); g.getWorldQuaternion(quat);
      const T = S.track;
      const gz0 = c.z - (c.air || 0);
      const vel = new THREE.Vector3(c.vx || 0, 0, c.vy || 0);
      if(ev.t === "part"){
        const E = CARGEO.team(G, c.team), geo = ev.part === "wing" ? E.fw : E.rw, mat = G.carMats(c.team).body;
        const pc = this.piece(G, c.team.id + "|" + ev.part, geo);
        const m = new THREE.Mesh(pc.geo, mat); m.castShadow = true;
        const wp = pc.c.clone().applyMatrix4(g.matrixWorld);
        m.position.copy(wp); m.quaternion.copy(quat);
        this.add({ m, v:vel.clone().multiplyScalar(0.8).add(new THREE.Vector3((Math.random() - 0.5) * 7, 3 + Math.random() * 5, (Math.random() - 0.5) * 7)),
                   w:new THREE.Vector3((Math.random() - 0.5) * 9, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 9),
                   kind:"part", c, rest:0.38, fric:3.2, t:0, gz:gz0, node:c.node });
        this.sparks(wp, 8, S);
      } else if(ev.t === "wheel"){
        const P = g.userData.parts, pv = P.pivots[ev.idx]; if(!pv) continue;
        const wp = new THREE.Vector3(); pv.getWorldPosition(wp);
        const ax = CAR_SPEC[ev.idx >= 2 ? "front" : "rear"];
        const m = new THREE.Mesh(CARGEO.wheel(G, ax.r, ax.w, P.compound, c.team.wheel || "#2A2D31"), G.tyreWearMat(G.carMats(c.team).tyre));
        G.setTyreWear(m.material, wearLook(c.life != null ? c.life : 1));
        m.castShadow = true; m.position.copy(wp); m.quaternion.copy(quat);
        // the axle runs along the car's z; it leaves outward, hopping
        const out = new THREE.Vector3(0, 0, ev.idx % 2 ? -1 : 1).applyQuaternion(quat);
        this.add({ m, v:vel.clone().multiplyScalar(0.95).add(out.multiplyScalar(2 + Math.random() * 5)).add(new THREE.Vector3((Math.random() - 0.5) * 4, 3 + Math.random() * 6 + ev.imp * 0.1, (Math.random() - 0.5) * 4)),
                   w:new THREE.Vector3((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3, 14 * (Math.random() < 0.5 ? -1 : 1)),
                   kind:"wheel", c, rest:0.5, fric:0.7, t:0, gz:gz0, node:c.node });
        this.sparks(wp, 10, S);
      } else if(ev.t === "shards"){
        const col = [c.team.body, c.team.accent, "#14171B", "#14171B", "#9AA0A7", c.team.body];
        const n = Math.min(24, ev.n | 0);
        for(let k = 0; k < n; k++){
          const loc = ev.loc;
          const lp = loc ? new THREE.Vector3(loc.px * (0.7 + Math.random() * 0.3), 0.25 + Math.random() * 0.35, loc.pz * (0.7 + Math.random() * 0.3))
                         : new THREE.Vector3((Math.random() - 0.5) * 4, 0.3 + Math.random() * 0.4, (Math.random() - 0.5) * 1.4);
          const wp = lp.clone().applyMatrix4(g.matrixWorld);
          const dir = loc ? new THREE.Vector3(loc.lf, 0, loc.lr).normalize().applyQuaternion(quat) : new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
          const sp = (2 + Math.random() * 8) * (ev.power || 1);
          const m = new THREE.Mesh(this.box, G.mat(col[(Math.random() * col.length) | 0], { roughness:0.55, metalness:0.1, flatShading:true }));
          const s = 0.07 + Math.random() * 0.26;
          m.scale.set(s * (0.6 + Math.random()), s * 0.18, s * (0.5 + Math.random() * 0.8));
          m.position.copy(wp); m.rotation.set(Math.random() * TAU, Math.random() * TAU, Math.random() * TAU); m.castShadow = true;
          this.add({ m, v:vel.clone().multiplyScalar(0.7).add(dir.multiplyScalar(sp)).add(new THREE.Vector3((Math.random() - 0.5) * 5, 2 + Math.random() * 7 * (ev.power || 1), (Math.random() - 0.5) * 5)),
                     w:new THREE.Vector3((Math.random() - 0.5) * 22, (Math.random() - 0.5) * 22, (Math.random() - 0.5) * 22),
                     kind:"shard", c, rest:0.3, fric:4, t:0, gz:gz0, node:c.node, life:28 + Math.random() * 10 });
        }
      }
    }
  },
  sparks(wp, n, S){
    for(let k = 0; k < n; k++)
      spawn(wp.x, wp.z, wp.y, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, 2 + Math.random() * 7, 0.4 + Math.random() * 0.5,
            k % 3 ? "#FFC46B" : "#E5E8EC", 0.22, "spark");
  },

  /* once a frame: move the debris. dt follows the game clock, so slow motion slows it too */
  step(G, S){
    const t = S.clock || 0, dt = this._t == null ? 0 : clamp(t - this._t, 0, 0.05); this._t = t;
    if(!dt) return;
    const T = S.track;
    for(let i = this.items.length - 1; i >= 0; i--){
      const it = this.items[i], m = it.m;
      it.t += dt;
      if(it.life && it.t > it.life){
        const k = clamp(1 - (it.t - it.life) / 2, 0, 1); m.scale.multiplyScalar(k > 0 ? Math.max(0.9, k) : 0);
        if(k <= 0){ this.group.remove(m); this.items.splice(i, 1); continue; }
      }
      if(it.rest0) continue;
      it.v.y -= GRAV * dt;
      m.position.addScaledVector(it.v, dt);
      m.rotation.x += it.w.x * dt; m.rotation.y += it.w.y * dt; m.rotation.z += it.w.z * dt;
      // the ground under it
      let gz = it.gz;
      try{ it.node = T.near(m.position.x, m.position.z, it.node); const z = T.surfZ(m.position.x, m.position.z, it.node); if(z === z) gz = z; }catch(e){}
      const floor = gz + (it.kind === "wheel" ? 0.36 : it.kind === "part" ? 0.12 : 0.03);
      if(m.position.y < floor){
        m.position.y = floor;
        if(it.v.y < -1.6){
          it.v.y = -it.v.y * it.rest;
          it.v.x *= 0.8; it.v.z *= 0.8;
          it.w.multiplyScalar(0.7);
          if(it.kind !== "shard" && it.v.y > 1.2) this.sparks(m.position, 3, S);
        } else it.v.y = 0;
        const k = Math.exp(-it.fric * dt);
        it.v.x *= k; it.v.z *= k;
        it.w.multiplyScalar(Math.exp(-3 * dt));
        if(it.kind === "wheel"){ it.w.z = it.w.z * 0.97; }
        if(Math.hypot(it.v.x, it.v.z) < 0.25 && Math.abs(it.w.x) + Math.abs(it.w.y) + Math.abs(it.w.z) < 0.6){ it.rest0 = true; }
      }
    }
  },
};

export { CRASH };
