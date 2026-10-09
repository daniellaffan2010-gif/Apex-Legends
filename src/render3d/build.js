import * as THREE from 'three';
import { shade } from '../config/util.js';
import { TEAMS } from '../config/teams.js';
import { bankZ } from '../tracks/shared.js';
import { TEX } from '../render2d/textures.js';
import { PTEX } from './surfaces.js';
import { ADS } from './hoardings.js';
import { PP, buildEnv } from './pipeline.js';
import { G3 } from './g3.js';
import { LB } from './worlds/vegas.js';
import { CITY } from './worlds/vegas-city.js';
import { MONACO } from './worlds/monaco.js';
import { SILVER } from './worlds/silverstone.js';
import { ZAND } from './worlds/zandvoort.js';
import { SUZUKA } from './worlds/suzuka.js';
import { SPA } from './worlds/spa.js';
import { ILG } from './worlds/ilg.js';
import { MEX } from './worlds/mex.js';
import { SINGAPORE } from './worlds/singapore.js';
import { BAKU } from './worlds/baku.js';
import { MONZA } from './worlds/monza.js';
import { COTA } from './worlds/cota.js';
import { WEATHER } from './weather.js';
import { CRASH } from './crash.js';
import { CFG } from '../config/settings.js';
import { FIELD } from './ground/field.js';
import { GMAT } from './ground/materials.js';
import { KERBS3D } from './ground/kerbs3d.js';
import { PITBOX } from './pitbox.js';
import { PITCREW } from './pitcrew.js';
import { GRAVEL } from './ground/gravel.js';
import { GRASS } from './ground/grass.js';

G3.tileSplit = function(root, cell, minTris){
  const jobs = [];
  root.traverse(o => {
    if(!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || o.userData.noSplit || Array.isArray(o.material)) return;
    const g = o.geometry; if(!g || !g.attributes.position || (g.groups && g.groups.length > 1)) return;
    const tri = (g.index ? g.index.count : g.attributes.position.count) / 3; if(tri < minTris) return;
    if(!g.boundingSphere) g.computeBoundingSphere(); if(g.boundingSphere.radius < cell * 0.9) return;
    jobs.push(o);
  });
  const v = new THREE.Vector3();
  for(const o of jobs){
    o.updateMatrixWorld(true);
    const g = o.geometry, idx = g.index ? g.index.array : null, pos = g.attributes.position;
    const nTri = (idx ? idx.length : pos.count) / 3, buckets = new Map();
    for(let t = 0; t < nTri; t++){
      let cx = 0, cz = 0;
      for(let k = 0; k < 3; k++){ const i = idx ? idx[t * 3 + k] : t * 3 + k; v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld); cx += v.x; cz += v.z; }
      const key = Math.floor(cx / 3 / cell) + "," + Math.floor(cz / 3 / cell);
      let b = buckets.get(key); if(!b){ b = []; buckets.set(key, b); } b.push(t);
    }
    if(buckets.size < 2) continue;
    const names = Object.keys(g.attributes);
    for(const tris of buckets.values()){
      const ng = new THREE.BufferGeometry();
      for(const nm of names){
        const a = g.attributes[nm], is = a.itemSize, out = new a.array.constructor(tris.length * 3 * is);
        let w = 0;
        for(const t of tris) for(let k = 0; k < 3; k++){ const i = idx ? idx[t * 3 + k] : t * 3 + k; for(let c = 0; c < is; c++) out[w++] = a.array[i * is + c]; }
        ng.setAttribute(nm, new THREE.BufferAttribute(out, is, a.normalized));
      }
      ng.computeBoundingSphere();
      const m = new THREE.Mesh(ng, o.material);
      m.position.copy(o.position); m.quaternion.copy(o.quaternion); m.scale.copy(o.scale);
      m.castShadow = o.castShadow; m.receiveShadow = o.receiveShadow; m.renderOrder = o.renderOrder;
      m.userData = Object.assign({}, o.userData); m.frustumCulled = true;
      o.parent.add(m);
    }
    o.parent.remove(o); g.dispose();
  }
  return jobs.length;
};

G3.clearPitTrees = function(root, T){
  const pts = [];
  for(let i = 0; i < T.n; i += 2){ if(T.pitRamp(i) <= 0.02) continue;
    const o = T.pitCentre(i); pts.push(T.x[i] + T.nx[i] * o, T.y[i] + T.ny[i] * o); }
  if(!pts.length) return;
  const R2 = 27 * 27, m = new THREE.Matrix4(), v = new THREE.Vector3(), zero = new THREE.Matrix4().makeScale(0, 0, 0);
  root.traverse(o => {
    if(!o.isInstancedMesh) return;
    const g = o.geometry; if(!g.boundingBox) g.computeBoundingBox();
    const sz = g.boundingBox.getSize(new THREE.Vector3());
    if(!((sz.x >= 3.5 && sz.y >= 1) || (sz.y >= 5.4 && sz.x <= 1.6))) return;
    let hit = false;
    for(let i = 0; i < o.count; i++){
      o.getMatrixAt(i, m); v.setFromMatrixPosition(m);
      for(let k = 0; k < pts.length; k += 2){ const dx = v.x - pts[k], dz = v.z - pts[k + 1]; if(dx * dx + dz * dz < R2){ o.setMatrixAt(i, zero); hit = true; break; } }
    }
    if(hit) o.instanceMatrix.needsUpdate = true;
  });
};

/* The environment map is only worth its cost on things that can show it. It
   used to be the scene's environment, so every surface in the frame sampled it
   twice per pixel, grass and tarmac included; that was a third of the frame.
   Now glass, metal, water and paintwork keep it, and everything matte gets the
   same sky-above, ground-below fill from a hemisphere light, which costs
   nothing per pixel. */
G3.ENV_FILL = 1.0;
G3.applyEnv = function(T, P){
  if(this.envFill){ this.scene.remove(this.envFill); this.envFill = null; }
  if(!this.envRT || CFG.envAll) return;
  const tex = this.envRT.texture, seen = new Set();
  this.scene.environment = null;
  this.scene.traverse(o => {
    const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for(const m of ms){
      if(seen.has(m) || !m.isMeshStandardMaterial) continue; seen.add(m);
      const shiny = m.metalness >= 0.25 || m.roughness <= 0.5;
      if(shiny){ if(m.envMap !== tex){ m.envMap = tex; m.needsUpdate = true; } m.userData.autoEnv = true; }
      else if(m.userData.autoEnv && m.envMap){ m.envMap = null; m.needsUpdate = true; m.userData.autoEnv = false; }
    }
  });
  // what the environment box looks like from below and above: its lit sky panel and its ground
  const sky = T.night ? "#2A2030" : "#C8D8EE", ground = T.night ? "#4A3418" : (G3.cssGround || "#6E7460");
  // how strong, matched by eye-free means: the mean brightness of three views of each circuit,
  // with the old environment against the fill. The surveyed circuits are lower because
  // their ground already took less of the environment than the generic one did.
  const K = { silverstone:0.57, monaco:0.38, baku:0.71, zandvoort:0.64 };
  const k = T.night ? 0.5 : (K[T.id] != null ? K[T.id] : 0.8);
  this.envFill = new THREE.HemisphereLight(this.col(sky), this.col(ground), k * this.ENV_FILL);
  this.scene.add(this.envFill);
};

G3.build = function(S){
  const T = S.track, P = T.pal, n = T.n, w = T.half, ro = T.runoffMax, wall = T.barrier === "wall";
  // the boundary is now a pair of curves, not a number
  const roR = i => T.roR[i], roL = i => T.roL[i];
  KERBS3D.dispose(); GRAVEL.dispose(); GRASS.dispose(); PITBOX.dispose(); PITCREW.dispose();
  if(this.world){
    this.world.traverse(o => {
      if(o.geometry) o.geometry.dispose();
      const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      // the ground's textures are generated once and kept (ground/materials.js marks them)
      for(const m of ms){ if(m.map && !(m.map.userData && m.map.userData.keep)) m.map.dispose(); m.dispose(); }
    });
    this.scene.remove(this.world);
  }
  for(const t of this.texes.values()) t.dispose();
  this.mats.clear(); this.texes.clear(); PTEX.dispose();
  ADS.VEGAS; ADS.dispose(); ADS.use(T.def.world === "monaco" ? "monaco" : T.def.world === "silverstone" ? "silverstone" : T.def.world === "zandvoort" ? "zandvoort" : T.def.world === "cota" ? "cota" : T.def.world === "spa" ? "spa" : T.def.world === "singapore" ? "singapore" : T.def.world === "interlagos" ? "interlagos" : T.def.world === "baku" ? "baku" : T.def.world === "mexico" ? "mexico" : T.def.world === "monza" ? "monza" : "vegas");
  while(this.scene.children.length) this.scene.remove(this.scene.children[0]);
  this.rend.renderLists.dispose();
  this.world = new THREE.Group(); this.scene.add(this.world);
  this.built = S.uid; this.cars = []; this.dyn = []; this.occluders = [];

  /* sky, haze and the light of the place */
  this.scene.background = this.col(P.skyB);
  this.scene.fog = new THREE.Fog(this.col(P.skyB), 500, 2000);
  this.fogSpan = T.night ? 900 : 1700;
  // what the glass and the metal have to look at. Never the background: the sky
  // colour is doing that job already, and a visible room would give it away.
  if(this.envRT){ this.envRT.dispose(); this.envRT = null; }
  if(PP.ready){
    G3.cssGround = P.ground;
    try{ this.envRT = buildEnv(this.rend, T.night, P); this.scene.environment = this.envRT.texture; }
    catch(e){ console.warn("environment map unavailable", e); this.scene.environment = null; }
  } else this.scene.environment = null;

  // the grade for this circuit: exposure, how hard things bloom, and where the
  // bloom starts. Vegas at night wants a dark frame with a few very bright
  // things in it; a daytime circuit wants almost none of this.
  this.grade = T.night
    ? { exposure:1.22, strength:0.72, radius:0.72, threshold:1.05, knee:0.38 }
    : { exposure:1.02, strength:0.16, radius:0.50, threshold:1.35, knee:0.30 };
  if(T.def.grade) Object.assign(this.grade, T.def.grade);

  // the totals are chosen so a flat surface comes back at its own colour
  const amb = T.night ? 0.44 : 0.42, dir = T.night ? 0.22 : 1.15;
  const softSky = shade(P.skyA, 0.35);                 // the sky lights from above: keep it near neutral
  this.scene.add(new THREE.HemisphereLight(this.col(T.night ? "#141828" : softSky), this.col(T.night ? "#4A3220" : P.ground), amb));
  this.scene.add(new THREE.AmbientLight(this.col(T.night ? "#5A5478" : "#FFFFFF"), T.night ? 0.30 : 0.12));
  // at night this is moonlight, and the warmth in the frame comes from the city
  const sun = new THREE.DirectionalLight(this.col(T.night ? "#7C90C8" : "#FFF4E2"), dir);
  const sa = T.sun == null ? 0.9 : T.sun;
  sun.position.set(Math.cos(sa) * 400, 520 * (T.def.sunH || 1), Math.sin(sa) * 400);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  // wrapped tight around what the camera can actually see, so the texels land
  // where they are wanted rather than being spread over the whole circuit
  sc.left = -150; sc.right = 150; sc.top = 150; sc.bottom = -150; sc.near = 60; sc.far = 1100;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.9;
  sc.updateProjectionMatrix();
  this.scene.add(sun); this.scene.add(sun.target);
  this.sun = sun;
  if(T.night){
    // a warm wash coming up off the city, opposite the moon: it is what keeps
    // the ground from reading as flat black under a blue key
    const glow = new THREE.DirectionalLight(this.col("#FF9A46"), 0.80);
    glow.position.set(-Math.cos(sa) * 320, 130, -Math.sin(sa) * 320);
    this.scene.add(glow); this.cityGlow = glow;
  } else this.cityGlow = null;

  // a surveyed circuit brings its own ground, land and landmarks
  const surveyed = T.def.world === "monaco" || T.def.world === "silverstone" || T.def.world === "zandvoort";
  const monacoW = T.def.world === "monaco";
  // Suzuka, COTA and Spa are not surveyed paths, but their worlds lay their own terrain and planting
  const ownGround = surveyed || T.def.world === "suzuka" || T.def.world === "cota" || T.def.world === "spa" || T.def.world === "singapore" || T.def.world === "interlagos" || T.def.world === "baku" || T.def.world === "mexico" || T.def.world === "monza";
  /* The wide grass strip under the run-off and the road is one quad per node, 55 m
     across, and the bands drawn over it are narrower quads. On a curve their two
     triangles split along different diagonals, so on a slope they sit at different
     heights, and with the strip only 2 cm under them it came up through them in a
     sawtooth (up to 11 cm at Suzuka's chicane, 7 cm at Eau Rouge). Put it 35 cm
     under the road instead, and the flat land patches the same distance lower, so
     they keep their place under it. A surveyed world lays its own ground just under
     this strip, so there it stays where it was. */
  const baseDrop = surveyed ? 0 : 0.37;
  G3.fadeU.value = 1; G3.fadeEdgeU.value = 1;
  this.fogNear = null; this.fogSpanK = null;
  // per-track haze as data: atmo:{ near, k, tint } (k scales the visible distance, tint is a fog colour)
  const atmo = T.def.atmo;
  if(atmo){
    if(atmo.near != null) this.fogNear = atmo.near;
    if(atmo.k != null) this.fogSpanK = atmo.k;
    if(atmo.tint && this.scene.fog){ this.scene.fog.color.copy(this.col(atmo.tint)); this.scene.background = this.col(atmo.tint); }
  }
  /* the ground the circuit sits on — a surveyed circuit brings its own */
  if(!ownGround){
  const bb = T.bounds, pad = (T.def.streets ? 3400 : 520), GX = 150;
  const gw = bb.w + pad * 2, gh = bb.h + pad * 2;
  const ggeo = new THREE.PlaneGeometry(gw, gh, GX, GX);
  ggeo.rotateX(-Math.PI / 2);
  const gcx = bb.minX + bb.w / 2, gcy = bb.minY + bb.h / 2;
  const gp = ggeo.attributes.position, hts = new Float32Array(gp.count);
  for(let i = 0; i < gp.count; i++){
    const wx = gp.getX(i) + gcx, wy = gp.getZ(i) + gcy;
    hts[i] = T.z[T.near(wx, wy)];
  }
  // one smoothing pass so the field does not step between nodes
  const row = GX + 1, sm = new Float32Array(hts);
  for(let r = 1; r < GX; r++) for(let c = 1; c < GX; c++){
    const k = r * row + c;
    sm[k] = (hts[k] * 2 + hts[k - 1] + hts[k + 1] + hts[k - row] + hts[k + row]) / 6;
  }
  for(let i = 0; i < gp.count; i++) gp.setY(i, sm[i] - 1.0);
  ggeo.computeVertexNormals();
  const gplane = new THREE.Mesh(ggeo, this.mat(P.ground));
  gplane.position.set(gcx, 0, gcy); gplane.receiveShadow = true;
  this.world.add(gplane); this.gplane = gplane;

  /* the land: every patch a flat polygon */
  const land = new THREE.Group(); this.world.add(land);
  for(const L of (T.land || [])){
    try{ this.patch(land, L.pts, L.z - 0.4 - baseDrop + Math.min(L.r, 40) * 0.0005, L.col, L.kind || "grass"); }catch(e){}
  }
  } else this.gplane = null;

  /* the circuit surface, band by band, each one lifted clear of the last */
  const road = this.world; let lift = 0.02;
  /* The ground's materials (ground/materials.js): textured asphalt, tarmac, gravel,
     astroturf, grass and concrete, all tiled in world metres. G3.strip's own UVs are
     a fraction across by metres along, so every strip is re-mapped (wuv). Every band
     starts flush at the road edge: the old 0.2 m slot showed from the cockpit. */
  const GM = GMAT.build(this, T, P);
  const wuv = g => GMAT.worldUV(g, T);
  // a world that mows its own verges (Spa and the circuits built on it, Suzuka) keeps them; elsewhere grass is laid here
  const mows = ["spa", "interlagos", "mexico", "suzuka"].includes(T.def.world);
  if(!wall && T.surfAt){
    /* run-off made of what the circuit says it is: tarmac, gravel traps, grass,
       and the strip of artificial grass along the kerbs. The wide strip under it all
       is grass too, so any seam between the bands shows grass, not a hole. */
    this.add(road, wuv(this.strip(T, i => -(w + roL(i) + 6), i => (w + roR(i) + 6), lift - baseDrop, 9)), GM.grass);
    lift += 0.02;
    const tarmac = GM.tarmac, gravelM = GM.gravel, astroM = GM.astro;
    const gEdge = this.mat("#8E8670");
    for(const sd of [-1, 1]){
      const code = i => (sd < 0 ? T.rsL[i] : T.rsR[i]), rf = sd < 0 ? roL : roR, rt = i => (sd < 0 ? T.rtL[i] : T.rtR[i]);
      const band = (a, b, f, m, l) => this.add(road, wuv(sd < 0 ? this.strip(T, i => -b(i), i => -a(i), lift + l, 9, f) : this.strip(T, a, b, lift + l, 9, f)), m);
      band(() => w, i => w + rf(i), i => code(i) === 1, tarmac, 0);
      band(() => w, i => w + rf(i), i => code(i) === 2, gravelM, 0.004);
      band(() => w, i => w + Math.max(0.5, rt(i)), i => code(i) === 5, tarmac, 0);
      band(i => w + Math.max(0.5, rt(i)), i => w + rf(i), i => code(i) === 5, gravelM, 0.004);
      // the raked lip where a gravel trap meets the grass
      band(i => w + rf(i) - 0.5, i => w + rf(i), i => code(i) === 2 || code(i) === 5, gEdge, 0.008);
      band(() => w, i => w + Math.min(rf(i), mows ? 1.8 : T.astro + 1.6), i => code(i) === 3 || code(i) === 4, astroM, 0.002);
      band(i => w + T.astro + 1.6, i => w + rf(i), i => code(i) === 4 && rf(i) > T.astro + 1.8, astroM, 0.002);
      // the white line down the edge of a tarmac escape
      band(i => w + rf(i) - 0.6, i => w + rf(i) - 0.25, i => code(i) === 1 && rf(i) > 10, this.mat("#E8E8EA"), 0.01);
      // plain run-off: a tarmac apron behind the kerb, then the verge (a world may mow it)
      band(() => w, i => w + Math.min(rf(i), 2.0), i => code(i) === 6, tarmac, 0);
      // the grass: on a grass run-off past its strip of astro, past an apron, and the verge beyond any run-off
      if(!mows){
        const gStart = i => code(i) === 3 ? w + Math.min(rf(i), T.astro + 1.6) : code(i) === 6 ? w + Math.min(rf(i), 2.0) : w + rf(i);
        band(gStart, i => w + rf(i) + 6, null, GM.grass, -0.005);
      }
    }
  } else if(!wall){
    this.add(road, wuv(this.strip(T, i => -(w + roL(i) + 6), i => (w + roR(i) + 6), lift - baseDrop, 9)), GM.grass);
    lift += 0.02;
    this.add(road, wuv(this.strip(T, i => -(w + roL(i)), -w, lift, 9)), GM.tarmac);
    this.add(road, wuv(this.strip(T, w, i => w + roR(i), lift, 9)), GM.tarmac);
    if(!mows){
      this.add(road, wuv(this.strip(T, i => -(w + roL(i) + 6), i => -(w + roL(i)), lift - 0.005, 9)), GM.grass);
      this.add(road, wuv(this.strip(T, i => w + roR(i), i => w + roR(i) + 6, lift - 0.005, 9)), GM.grass);
    }
  } else {
    this.add(road, wuv(this.strip(T, i => -(w + roL(i) + 1.4), i => (w + roR(i) + 1.4), lift, 9)), GM.concrete);
    lift += 0.02;
    // the escape roads are laid in a lighter, dustier asphalt than the circuit
    const escape = GM.tarmac;
    const plain = GM.tarmac;
    for(const [sd, rf] of [[-1, roL], [1, roR]]){
      const wide = i => rf(i) > T.def.runoff + 2.5;
      const lo = i => Math.min(sd * w, sd * (w + rf(i))), hi = i => Math.max(sd * w, sd * (w + rf(i)));
      this.add(road, wuv(this.strip(T, lo, hi, lift, 9,
        i => rf(i) > 0.5 && !wide(i))), plain);
      this.add(road, wuv(this.strip(T, lo, hi, lift, 9,
        i => wide(i))), escape);
      const kf = i => rf(i) > 0.5 && !wide(i) && Math.abs(T.curv[i]) > 0.004 && (Math.floor(i / 2) % 2);
      this.add(road, this.strip(T, i => sd * (w + rf(i)), i => sd * (w + rf(i) - 0.5), lift + 0.01, 9, kf), this.mat(P.kerbA));
      // an escape road is painted: a line down its outer edge and arrows on it
      this.add(road, this.strip(T, i => sd * (w + rf(i) - 0.7), i => sd * (w + rf(i) - 0.2), lift + 0.012, 9,
        i => wide(i)), this.mat("#E8E8EA"));
      this.add(road, this.strip(T, i => sd * (w + 1.4), i => sd * (w + rf(i) * 0.55), lift + 0.012, 3,
        i => wide(i) && (Math.floor(i / 3) % 5) === 0), this.mat("#DCDCE0"));
    }
  }
  lift += 0.03;
  this.roadLift = lift;
  /* The road: textured asphalt laid exactly on the surface in 1.5 m lanes, its vertex
     colours carrying the rubbered-in racing line, repair patches and skid marks
     (ground/materials.js roadColour). G3.roadMat stays the one material the wet look drives. */
  this.roadMat = GM.road;
  this.add(road, FIELD.ribbon(T, -w, w, { lift, lane:1.5, sub:2, colour:GMAT.roadColourOf(T) }), this.roadMat);
  // the kerbs, as solids: ridged where the corner is slow, painted flat where it is fast, sausages behind the slowest apexes (ground/kerbs3d.js)
  try{ this.world.add(KERBS3D.build(this, T, P)); }catch(e){ console.warn("kerbs3d", e.message); }
  // the traps' pebbles, the gravel and sand the cars throw and the wind moves (ground/gravel.js), and grass round the cockpit (ground/grass.js)
  try{ GRAVEL.build(this, S); }catch(e){ console.warn("gravel", e.message); }
  try{ GRASS.build(this, S); }catch(e){ console.warn("grass", e.message); }
  // the white lines
  this.add(road, this.strip(T, w - 0.45, w - 0.05, lift + 0.025, 9), this.mat(P.line));
  this.add(road, this.strip(T, -(w - 0.05), -(w - 0.45), lift + 0.025, 9), this.mat(P.line));

  /* the pit lane: a lighter surface than the track laid just over it (the cars' tyres stand on it, not in it),
     a lit lane edge, the line between the fast lane and the working lane, and a lit gantry over the entry
     and the exit so the lane reads from the air. The boxes, boards, lights and crews: render3d/pitbox.js, pitcrew.js */
  const pOn = i => T.pitRamp(i) > 0.02, sg = T.pitSide, nite = !!T.night;
  const pin = i => sg * (T.half - 0.05), pout = i => sg * (T.half + T.pitW * T.pitRamp(i));
  // a strip wants its offsets low to high, or it faces the ground: on the left-hand side they come the other way round
  const ps = (fa, fb, l, u, f) => sg > 0 ? this.strip(T, fa, fb, l, u, f) : this.strip(T, fb, fa, l, u, f);
  const lit = (c, k) => this.mat(c, { emissive:c, emissiveIntensity:nite ? k : k * 0.18, roughness:0.6 });
  this.add(road, ps(pin, pout, lift + 0.004, 8, pOn), nite ? this.mat("#586178", { emissive:"#3A4560", emissiveIntensity:0.6 }) : this.mat(shade(P.road, 0.2)));
  this.add(road, ps(i => sg * (T.half + T.pitW * T.pitRamp(i) - 0.35), pout, lift + 0.008, 8, pOn), lit("#EEF3F8", 1.3));
  // the line between the fast lane and the working lane, 4 m out (pitlane.js: fast lane 2.4, boxes 5.6)
  this.add(road, ps(sg * (T.half + 3.85), sg * (T.half + 4.15), lift + 0.008, 8, i => T.pitRamp(i) > 0.9), lit("#EEF3F8", 1.0));
  this.add(road, ps(sg * (T.half + 0.05), sg * (T.half + 0.5), lift + 0.008, 8,
    i => T.pitRamp(i) > 0.9 && i % 5 < 3), lit("#EEF3F8", 1.3));
  // every team's box, its board and release light, and the crews
  try{ PITBOX.build(this, S); PITCREW.build(this, S); }catch(e){ console.warn("pit boxes", e.message); }
  // the wall, with a lit top rail
  const pw = i => T.pitRamp(i) > 0.9;
  this.add(road, this.wall(T, sg * (T.half + 0.35), 1.0, pw), this.twoSided(this.mat(nite ? "#59607A" : "#D8DCE0", nite ? { roughness:1 } : undefined)), true);
  this.add(road, ps(sg * (T.half + 0.35), sg * (T.half + 0.75), 1.0, 8, pw), lit("#BFE3FF", 1.5));
  // entry and exit gantries
  if(!this._pitSign){
    const cv = document.createElement("canvas"); cv.width = 256; cv.height = 128;
    const g2 = cv.getContext("2d"); g2.fillStyle = "#1E7FD6"; g2.fillRect(0, 0, 256, 128);
    g2.strokeStyle = "#EEF3F8"; g2.lineWidth = 8; g2.strokeRect(8, 8, 240, 112);
    g2.fillStyle = "#FFFFFF"; g2.font = "900 82px 'Arial Black',sans-serif"; g2.textAlign = "center"; g2.textBaseline = "middle"; g2.fillText("PIT", 128, 70);
    this._pitSign = new THREE.CanvasTexture(cv); this._pitSign.encoding = THREE.sRGBEncoding;
  }
  const gantry = i => {
    const o = sg * (T.half + T.pitW * 0.5), gr = new THREE.Group();
    gr.position.set(T.x[i] + T.nx[i] * o, T.z[i], T.y[i] + T.ny[i] * o); gr.rotation.y = -T.ang[i];
    const hw = T.pitW * 0.5 + 0.9, dark = this.mat("#20242B");
    for(const sd of [-1, 1]){ const m = new THREE.Mesh(new THREE.BoxGeometry(0.45, 5.6, 0.45), dark); m.position.set(0, 2.8, sd * hw); m.castShadow = true; gr.add(m); }
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, hw * 2 + 0.45), dark); bar.position.y = 5.6; bar.castShadow = true; gr.add(bar);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 2.6), new THREE.MeshBasicMaterial({ map:this._pitSign, toneMapped:false }));
    sign.rotation.x = -Math.PI / 2; sign.rotation.z = Math.PI / 2; sign.position.y = 5.88; gr.add(sign);
    const rim = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, hw * 2), lit("#3FA9F5", 2.4)); rim.position.set(-0.32, 5.25, 0); gr.add(rim);
    road.add(gr);
  };
  gantry((T.pitIn + Math.round(T.pitSpan * 0.08)) % n);
  gantry((T.pitOut - Math.round(T.pitSpan * 0.08) + n) % n);

  /* start line and grid boxes */
  for(let k = 0; k < 14; k++){
    this.add(road, this.strip(T, -w + (2 * w) * k / 14, -w + (2 * w) * (k + 1) / 14, lift + 0.05, 9,
      i => i === 0 || i === 1), this.mat(k % 2 ? "#141518" : "#F0F0F0"));
  }
  if(S.mode !== "tt") for(let k = 0; k < 11; k++){
    const o = (k % 2 ? 1 : -1) * (w * 0.45);
    this.add(road, this.strip(T, o - 0.9, o + 0.9, lift + 0.045, 9,
      i => i === (3 + k * 2) % n), new THREE.MeshStandardMaterial({ color:new THREE.Color("#F0F0F0"), roughness:0.9, metalness:0, transparent:true, opacity:0.55 }));
  }

  /* barriers — they follow the boundary wherever it goes */
  const boAt = (sd, i) => sd * (w + (sd < 0 ? roL(i) : roR(i)) + (wall ? 1.0 : 2.6));
  const bo = w + ro + (wall ? 1.0 : 2.6);
  if(wall){
    for(const sd of [-1, 1]){
      const rf = sd < 0 ? roL : roR, wide = i => rf(i) > T.def.runoff + 2.5;
      const f = i => boAt(sd, i);
      // concrete along the lap, and TecPro where an escape road ends
      this.add(road, this.wall(T, f, 1.25, i => !wide(i)), this.twoSided(this.mat(P.wall)), true);
      this.add(road, this.strip(T, f, i => f(i) + sd * 0.5, 1.25, 8, i => !wide(i)), this.mat(shade(P.wall, 0.18)));
      this.add(road, this.wall(T, f, 1.15, wide), this.twoSided(this.mat("#1E5FC0")), true);
      this.add(road, this.strip(T, f, i => f(i) + sd * 0.6, 1.15, 8, wide), this.mat("#E8E8EA"));
      // the blocks read as blocks because the top rail is broken up
      this.add(road, this.strip(T, i => f(i) + sd * 0.05, i => f(i) + sd * 0.55, 1.32, 8,
        i => wide(i) && (i % 3 < 2)), this.mat("#F2F2F4"));
    }
  } else {
    for(const sd of [-1, 1]){
      const f = i => boAt(sd, i);
      // where a circuit has a SAFER wall instead, its own builder puts that up
      // and where a circuit's pit building faces its lane (def.noPitArmco), none along the lane on that side
      const armco = i => !(T.safer && T.safer(i, sd)) && !(T.def.noPitArmco && sd === T.pitSide && T.pitRamp(i) > 0.02);
      this.add(road, this.wall(T, f, 1.0, armco, 0), this.twoSided(this.mat("#C7CDD3")), true);
      this.add(road, this.strip(T, f, i => f(i) + sd * 0.4, 1.0, 8, armco), this.mat("#8A9199"));
      // posts
      const post = new THREE.BoxGeometry(0.18, 1.0, 0.18);
      for(let i = 0; i < n; i += 4){
        if(!armco(i)) continue;
        const o = boAt(sd, i) + sd * 0.2;
        const m = new THREE.Mesh(post, this.mat("#6E757C"));
        m.position.set(T.x[i] + T.nx[i] * o, T.z[i] + bankZ(T, i, o) + 0.5, T.y[i] + T.ny[i] * o);
        m.castShadow = true; road.add(m);
      }
    }
  }

  /* Debris fencing over the concrete, all the way round. One alpha-tested plane
     per side plus instanced posts: it is the single thing that makes a street
     circuit read as streets rather than as a track with walls. */
  if(wall && T.def.fencing !== false){
    const fh = 3.6;
    const fmat = new THREE.MeshStandardMaterial({ map:PTEX.fence(), alphaMap:PTEX.fence(),
      transparent:true, alphaTest:0.28, side:THREE.DoubleSide, roughness:0.6, metalness:0.5,
      color:this.col("#B8C0C8"), depthWrite:true });
    fmat.map.repeat.set(1, 1);
    for(const sd of [-1, 1]){
      const f = i => boAt(sd, i) + sd * 0.25;
      const fg = this.wall(T, f, fh, null, -1.3);
      if(fg){
        // one repeat every four metres up and along
        const uv = fg.attributes.uv;
        for(let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * 2.0, uv.getY(k) * (fh / 4));
        uv.needsUpdate = true;
        const fm = new THREE.Mesh(fg, fmat);
        fm.castShadow = false; fm.receiveShadow = false; road.add(fm);
      }
      const pg = new THREE.BoxGeometry(0.16, fh + 1.3, 0.16); pg.translate(0, (fh - 1.3) / 2, 0);
      const list = [];
      for(let i = 0; i < n; i += 3){
        const o = boAt(sd, i) + sd * 0.25;
        list.push([T.x[i] + T.nx[i] * o, T.y[i] + T.ny[i] * o, T.z[i] + 0.65, 0]);
      }
      LB.many(this, road, pg, this.mat("#6E757C", { roughness:0.6, metalness:0.5 }), list, false);
    }
  }

  /* the hillside under a circuit that climbs */
  let zLo = Infinity; for(let i = 0; i < n; i++) zLo = Math.min(zLo, T.z[i]);
  if(!ownGround) for(const sd of [-1, 1])
    this.add(road, this.wall(T, sd * bo, 0.2, i => T.z[i] > zLo + 9, i => T.z[i] - zLo + 1),
      this.twoSided(this.mat(shade(P.ground, -0.2))), true);

  /* the tunnel */
  if(T.def.tunnel && !surveyed){
    const tf = i => T.inTunnel(i);
    this.add(road, this.strip(T, -(w + ro + 2), (w + ro + 2), 5.6, 8, tf), this.mat("#8C8478"));
    for(const sd of [-1, 1]) this.add(road, this.wall(T, sd * (w + ro + 1.6), 5.6, tf), this.twoSided(this.mat("#9A9284")), true);
  }

  /* Monaco: the surveyed town, harbour, tunnel and all */
  this.monaco = null; this.silver = null;
  if(monacoW){
    const before = new Set(this.world.children);
    try{ MONACO.build(this, this.world, T, S); this.monaco = MONACO; this.cutAll(this.world.children.filter(c => !before.has(c))); this.clearPitTrees(this.world, T);
      // the meshes the survey fades by hand keep their identity; the rest can be tiled
      for(const m of (MONACO.fade || [])) if(m && m.userData) m.userData.noSplit = true;
      for(const c of this.world.children) if(!before.has(c)) this.tileSplit(c, 250, 3000); }
    catch(e){ console.warn("monaco", e.message, e.stack); }
  }
  /* Silverstone: the surveyed airfield, the farmland, the Wing and the crowds */
  if(T.def.world === "silverstone" || T.def.world === "zandvoort"){
    const W = T.def.world === "zandvoort" ? ZAND : SILVER;
    try{ W.build(this, this.world, T, S); this.silver = W; }
    catch(e){ console.warn(T.def.world, e.message, e.stack); }
  }

  /* the city, for a circuit that has one described */
  if(!surveyed && (T.def.streets || T.def.garages || T.def.bridges)){
    const town = new THREE.Group();
    try{ CITY.build(this, town, T, S); }catch(e){ console.warn("city", e.message, e.stack); }
    this.world.add(this.bake(town, 400));
  }

  /* the scenery */
  const props = new THREE.Group();
  // the trees nearest the road carry their own materials so they can fade when they
  // stand between the camera and the car. Capped, since each one is its own draw call.
  const nearTrees = T.props.filter(p => p.t === "tree" && p.h > 12)
    .map(p => { const j = T.near(p.x, p.y); return { p, d:Math.hypot(p.x - T.x[j], p.y - T.y[j]) }; })
    .sort((a, b) => a.d - b.d).slice(0, 110);
  for(const o of nearTrees) o.p.fade = true;
  for(const p of T.props){
    if(p.only2d && ownGround) continue;           // the survey (or the world) built the real one
    try{ this.prop(props, p, T, S); }catch(e){ console.warn("prop", p.t, p.k, e.message); } }
  const baked = this.bake(props, 260);
  this.world.add(baked);

  /* Suzuka: the wooded hills, the planting, the park and the bridges */
  this.suzuka = null;
  if(T.def.world === "suzuka"){
    try{ SUZUKA.build(this, this.world, T, S); this.suzuka = SUZUKA; }
    catch(e){ console.warn("suzuka", e.message, e.stack); }
  }
  /* Spa: the Ardennes valley, its forest, villages, stands and stream */
  this.spa = null;
  if(T.def.world === "spa"){
    try{ SPA.build(this, this.world, T, S); this.spa = SPA; }
    catch(e){ console.warn("spa", e.message, e.stack); }
  }
  /* Interlagos: the bowl, the lake and the city round it */
  this.ilg = null;
  if(T.def.world === "interlagos"){
    try{ ILG.build(this, this.world, T, S); this.ilg = ILG; }
    catch(e){ console.warn("interlagos", e.message, e.stack); }
  }
  /* Mexico City: the autódromo in the sports city, the Foro Sol, the dome, the city round them */
  this.mex = null;
  if(T.def.world === "mexico"){
    try{ MEX.build(this, this.world, T, S); this.mex = MEX; }
    catch(e){ console.warn("mexico", e.message, e.stack); }
  }

  /* Baku: the Caspian, the Old City walls, the sandstone town */
  this.monza = null;
  if(T.def.world === "monza"){
    try{ MONZA.build(this, this.world, T, S); this.monza = MONZA; }
    catch(e){ console.warn("monza", e.message, e.stack); }
  }
  this.baku = null;
  if(T.def.world === "baku"){
    try{ BAKU.build(this, this.world, T, S); this.baku = BAKU; }
    catch(e){ console.warn("baku", e.message, e.stack); }
  }

  /* Singapore: the night city, the bay, the lamps, the light show */
  this.singapore = null;
  if(T.def.world === "singapore"){
    try{ SINGAPORE.build(this, this.world, T, S); this.singapore = SINGAPORE; }
    catch(e){ console.warn("singapore", e.message, e.stack); }
  }

  /* Austin: the Hill Country, the tower, the stands, the paddock, the sky */
  this.cota = null;
  if(T.def.world === "cota"){
    try{ COTA.build(this, this.world, T, S); this.cota = COTA; }
    catch(e){ console.warn("cota", e.message, e.stack); }
  }

  /* the cars */
  for(const c of S.cars){ const g = this.car(c); this.world.add(g); this.cars.push({ c, g }); }

  this.applyEnv(T, P);

  /* sparks and debris */
  const sg2 = new THREE.BufferGeometry();
  sg2.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(900), 3));
  this.sparks = new THREE.Points(sg2, new THREE.PointsMaterial({ color:0xFFC35A, size:0.5, sizeAttenuation:true, transparent:true }));
  this.sparks.frustumCulled = false; this.world.add(this.sparks);

  /* the rain, the spray and the wet look (see weather.js); after the world, so it
     knows what the light and the road are in the dry */
  WEATHER.build(this, S);
  CRASH.build(this, S);
};

