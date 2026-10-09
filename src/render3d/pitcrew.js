import * as THREE from 'three';
import { clamp, lerp } from '../config/util.js';
import { TYRES } from '../car/parts.js';
import { CAR_SPEC } from '../car/spec.js';
import { stopPose } from '../car/pitstop.js';
import { wearLook } from '../car/tyrewear.js';
import { CARGEO } from './car.js';
import { PITBOX } from './pitbox.js';

/* ---- the pit crews ---------------------------------------------------------------
   Each team's crew lives at its own box (tracks/pitlane.js) and is only built, shown and
   posed while one of its cars is on its way in, stopped or just gone. Seventeen people:
   at each wheel a gunner kneeling at the hub, a man to take the old wheel off and one
   to put the new one on; a jack man in front of the nose and one behind the gearbox;
   a stabiliser either side of the cockpit; and the release man by the light.

   They wait on the apron in front of the garage, walk out as the car comes down the lane,
   take their places, and work to the stop's own timeline (car/pitstop.js): jacks under,
   guns on, the old wheels off and away, the new ones (in the compound fitted) on, guns
   again, jacks down; the front jack man swings out of the way before the car goes; then
   they walk back in with the old tyres.

   People are jointed (hips, knees, shoulders, a leaning back) and drawn as instanced
   parts, eight draw calls a crew, each crew with its own materials and every instance
   coloured (the instance-colour pitfall). Frame: x along the lane (forward), z the side
   positive offsets lie on, y up, origin on the box mark on the lane surface. */
const PARTS = ["torso", "helmet", "thighL", "thighR", "shinL", "shinR", "armL", "armR"];
const HIP = 0.93, THIGH = 0.46, SHIN = 0.45, ARM = 0.62, SHOULDER = 0.52;
const SP = CAR_SPEC;

function geoFor(part){
  const g = new THREE.BufferGeometry(), pos = [], col = [];
  const add = (geo, hex, x, y, z) => {
    const c = new THREE.Color(hex), p = geo.toNonIndexed().attributes.position;
    for(let i = 0; i < p.count; i++){ pos.push(p.getX(i) + x, p.getY(i) + y, p.getZ(i) + z); col.push(c.r, c.g, c.b); }
  };
  const W = "#FFFFFF", D = "#26292E";                      // white takes the instance colour; dark stays dark
  if(part === "torso"){ add(new THREE.BoxGeometry(0.30, 0.60, 0.44), W, 0, 0.32, 0); add(new THREE.BoxGeometry(0.32, 0.10, 0.46), D, 0, 0.04, 0);
                        add(new THREE.BoxGeometry(0.10, 0.10, 0.10), W, 0, 0.66, 0); }
  if(part === "helmet"){ add(new THREE.BoxGeometry(0.30, 0.28, 0.27), W, 0, 0.82, 0); add(new THREE.BoxGeometry(0.06, 0.10, 0.24), "#0B0D10", 0.15, 0.83, 0); }
  if(part === "thighL" || part === "thighR") add(new THREE.BoxGeometry(0.17, THIGH, 0.17), W, 0, -THIGH / 2, 0);
  if(part === "shinL" || part === "shinR"){ add(new THREE.BoxGeometry(0.14, SHIN - 0.07, 0.14), W, 0, -(SHIN - 0.07) / 2, 0); add(new THREE.BoxGeometry(0.27, 0.08, 0.13), D, 0.05, -SHIN + 0.04, 0); }
  if(part === "armL" || part === "armR"){ add(new THREE.BoxGeometry(0.11, ARM - 0.1, 0.11), W, 0, -(ARM - 0.1) / 2, 0); add(new THREE.BoxGeometry(0.12, 0.12, 0.12), D, 0, -ARM + 0.05, 0); }
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals(); g.computeBoundingSphere();
  return g;
}
const GEO = {};
const geo = p => GEO[p] || (GEO[p] = geoFor(p));

/* where everyone works (car centre at 0,0; front axle x = 1.55, rear -1.58; wheels at z = +-0.83) and
   what they do: kind gun | off | on | jackF | jackR | stab | rel. q is the corner (0 RR, 1 RL, 2 FR, 3 FL,
   the car's own order; "right" is +z) */
function stations(side){
  const S2 = [], fx = SP.front.x, rx = SP.rear.x;
  for(let q = 0; q < 4; q++){
    const x = q < 2 ? rx : fx, sd = q % 2 === 0 ? 1 : -1, z = sd * 0.83, fwd = q >= 2 ? 1 : -1;
    S2.push({ kind:"gun", q, x, z:z + sd * 0.72, face:-sd });
    S2.push({ kind:"off", q, x:x - fwd * 0.55, z:z + sd * 1.45, face:-sd });
    S2.push({ kind:"on", q, x:x + fwd * 0.60, z:z + sd * 1.45, face:-sd });
  }
  S2.push({ kind:"jackF", x:4.15, z:0, face:2 }, { kind:"jackR", x:-4.25, z:0, face:0 });
  S2.push({ kind:"stab", x:0.15, z:1.45, face:-1 }, { kind:"stab", x:0.15, z:-1.45, face:1 });
  S2.push({ kind:"rel", x:3.1, z:side * 2.9, face:-side });
  // only out when there is a repair to do: two men to change the front wing, one for a bent corner
  S2.push({ kind:"noseL", x:3.2, z:1.05, face:-1, extra:true }, { kind:"noseR", x:3.2, z:-1.05, face:1, extra:true }, { kind:"susp", x:0, z:0, face:1, extra:true });
  // waiting on the apron, in a line in front of the garage
  S2.forEach((m, k) => { m.wx = -6.5 + k * 0.8; m.wz = side * 3.7; });
  return S2;
}

const M4 = new THREE.Matrix4(), M5 = new THREE.Matrix4(), M6 = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), V = new THREE.Vector3(), ONE = new THREE.Vector3(1, 1, 1);

const PITCREW = {
  crews:new Map(),
  build(G, S){ this.dispose(); this.G = G; this.T = S.track; },
  crewFor(G, T, box){
    let C = this.crews.get(box.id);
    if(C) return C;
    const grp = new THREE.Group(); grp.name = "crew-" + box.id;
    const st = stations(T.pitSide), n = st.length, t = box.team;
    const mats = [], meshes = {};
    for(const p of PARTS){
      const m = new THREE.MeshStandardMaterial({ vertexColors:true, roughness:0.8, metalness:0, flatShading:true });
      const im = new THREE.InstancedMesh(geo(p), m, n); im.castShadow = true; im.frustumCulled = false;
      const c = new THREE.Color(p === "helmet" ? (t.accent || t.body) : (p === "armL" || p === "armR") ? (t.accent2 || t.body) : t.body).convertSRGBToLinear();
      for(let k = 0; k < n; k++) im.setColorAt(k, c);
      grp.add(im); meshes[p] = im; mats.push(m);
    }
    // the tools: four guns, two jacks, and a wheel for every man carrying one
    const toolMat = new THREE.MeshStandardMaterial({ color:0x2B2F35, roughness:0.5, metalness:0.3 });
    const guns = [0, 1, 2, 3].map(() => { const g = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.13, 0.13), toolMat); grp.add(g); return g; });
    const jackGeo = new THREE.BoxGeometry(1.7, 0.08, 0.10), jackHead = new THREE.BoxGeometry(0.35, 0.22, 0.5);
    const jacks = [0, 1].map(() => { const j = new THREE.Group(), h = new THREE.Mesh(jackGeo, toolMat), hd = new THREE.Mesh(jackHead, toolMat);
      h.position.x = 0.85; j.add(h, hd); grp.add(j); return j; });
    // the repairs: the broken wing coming off, the new one going on, a spanner for the suspension
    const E = CARGEO.team(G, t), bodyMat = G.carMats(t).body;
    const wingOld = new THREE.Mesh(E.fwStub, bodyMat), wingNew = new THREE.Mesh(E.fw, bodyMat), spanner = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.05, 0.07), toolMat);
    for(const w of [wingOld, wingNew, spanner]){ w.visible = false; w.castShadow = true; grp.add(w); }
    const wheels = [];
    for(let q = 0; q < 4; q++){
      const ax = q < 2 ? SP.rear : SP.front;
      const tm = car3dTyreMat(G), g0 = this.wheelGeo(G, ax, "medium", t);
      const old = new THREE.Mesh(g0, G.tyreWearMat(tm)), nw = new THREE.Mesh(g0, G.tyreWearMat(tm));
      for(const w of [old, nw]){ w.visible = false; w.castShadow = true; grp.add(w); }
      wheels.push({ ax, old, nw, oldKey:null, newKey:null });
    }
    C = { grp, st, meshes, mats, guns, jacks, wheels, wingOld, wingNew, spanner, u:0, box, team:t, toolMat, seen:false };
    G.world.add(grp);
    this.crews.set(box.id, C);
    return C;
  },
  // the right wheel model for a corner and compound, the car's own rim colour
  wheelGeo(G, ax, key, team){
    const col = (TYRES[key] || TYRES.medium).col;
    return CARGEO.wheel(G, ax.r, ax.w, col, team.wheel || "#2A2D31");
  },

  frame(G, S){
    const T = S.track; if(!T || !T.pitBoxes) return;
    const dt = clamp((S.clock || 0) - (this.t0 == null ? S.clock || 0 : this.t0), 0, 0.1); this.t0 = S.clock || 0;
    const cam = G.cam;
    for(const box of T.pitBoxes){
      // the car of this team that matters most to the box right now: stopped in it, on its way to it, or just gone
      let car = null, score = -1;
      for(const c of S.cars){
        const P = c.pp; if(!P || P.box !== box || c.dnf) continue;
        const sc = P.phase === "stopped" ? 3 : P.stop && P.relA == null && box.a - P.a < 220 ? 2 : P.relA != null && P.a - P.relA < 30 ? 1 : 0;
        if(sc > score){ score = sc; car = c; }
      }
      let C = this.crews.get(box.id);
      const want = score >= 1 ? 1 : 0;
      if(!C && !want) continue;
      // only worth building and posing if the camera is anywhere near it
      const bp = PITBOX.boxPt(T, box, 0, 0, 0, V);
      if(cam && cam.position && cam.isPerspectiveCamera && bp.distanceTo(cam.position) > 260){ if(C) C.grp.visible = false; continue; }
      if(!C) C = this.crewFor(G, T, box);
      C.u = clamp(C.u + (want ? 1 / 2.4 : -1 / 3.0) * dt, 0, 1);
      if(want && C.u === 0) C.u = 0.001;
      C.grp.visible = C.u > 0;
      if(!C.grp.visible) continue;
      this.pose(G, S, T, C, car, dt);
    }
  },

  pose(G, S, T, C, car, dt){
    const box = C.box, side = T.pitSide, t = S.clock || 0;
    PITBOX.boxPt(T, box, 0, 0, 0, V); C.grp.position.copy(V);
    C.grp.rotation.set(0, -PITBOX.ang(T, box.a), 0, "YXZ");
    const P = car && car.pp, st = P && P.phase === "stopped" ? P.st : null;
    const po = st ? stopPose(st, C.po || (C.po = {})) : null;
    const ready = C.u, ease = k => k * k * (3 - 2 * k), k = ease(ready);
    const walking = ready > 0 && ready < 1;
    const lift = po ? 0.06 : 0;
    // tyres for this stop: old off the car, new from the garage
    const oldKey = st ? st.oldTyre : car && car.tyre ? car.tyre.key : "medium";
    const newKey = st && st.tyre && st.tyre !== "none" ? st.tyre : P && P.plan && P.plan.tyre && P.plan.tyre !== "none" ? P.plan.tyre : null;
    for(const W of C.wheels){
      if(W.oldKey !== oldKey){ W.oldKey = oldKey; W.old.geometry = this.wheelGeo(G, W.ax, oldKey, C.team); }
      if(newKey && W.newKey !== newKey){ W.newKey = newKey; W.nw.geometry = this.wheelGeo(G, W.ax, newKey, C.team); }
    }
    // the wheel coming off is as worn as the car's tyres were; the one going on is new
    const oldLife = car && car.life != null ? car.life : 1;
    for(const W of C.wheels){ G.setTyreWear(W.old.material, wearLook(oldLife, C.look || (C.look = {}))); G.setTyreWear(W.nw.material, wearLook(1, C.look2 || (C.look2 = {}))); }
    const pose = {};
    const rep = st && st.rep ? st.rep : {}, wingJob = !!(rep.wing || (P && P.plan && (P.plan.repairs || []).includes && (P.plan.repairs || []).includes("wing")));
    const suspJob = !!(rep.susp || (P && P.plan && (P.plan.repairs || []).includes && (P.plan.repairs || []).includes("susp")));
    const bentQ = car ? car.idx % 4 : 0;
    C.st.forEach((m, i) => {
      // the repair men: hidden unless there is their job on this stop
      if(m.extra && !((m.kind === "susp" && suspJob) || (m.kind !== "susp" && wingJob))){ hidePerson(C, i); return; }
      if(m.kind === "susp"){ const ax = bentQ < 2 ? SP.rear : SP.front, sd = bentQ % 2 === 0 ? 1 : -1; m.x = ax.x + (bentQ < 2 ? 0.55 : -0.55); m.z = sd * 1.3; m.face = -sd; }
      // where: from the apron line out to the station
      // walking out to the station (a car is coming) or back to the apron (it has gone): face the way they walk
      const out = !!car, dx = (m.x - m.wx) * (out ? 1 : -1), dz = (m.z - m.wz) * (out ? 1 : -1);
      let x = lerp(m.wx, m.x, k), z = lerp(m.wz, m.z, k), face = walking ? Math.atan2(-dz, dx) : faceAng(m.face);
      for(const key in pose) delete pose[key];
      pose.hip = HIP; pose.lean = 0; pose.hl = 0; pose.hr = 0; pose.kl = 0; pose.kr = 0; pose.al = 0; pose.ar = 0;
      if(walking){
        const ph = t * 7 + i;
        pose.hl = Math.sin(ph) * 0.45; pose.hr = -pose.hl; pose.kl = Math.max(0, -Math.sin(ph)) * 0.6; pose.kr = Math.max(0, Math.sin(ph)) * 0.6;
        pose.al = -pose.hl * 0.8; pose.ar = -pose.hr * 0.8; pose.lean = 0.12;
      } else if(ready >= 1){
        workPose(m, pose, po, st, t, i);
        if(m.extra && po) repairPose(m, pose, st, rep, t, i);
        // the wing men: pull the broken wing forward and away, fetch the new one from the garage side, carry it in, fit it
        if((m.kind === "noseL" || m.kind === "noseR") && po && rep.wing){
          const k2 = clamp((st.t - rep.wing[0]) / (rep.wing[1] - rep.wing[0]), 0, 1), sdw = Math.sign(m.z);
          if(k2 < 0.12){ x += 0.9 * (k2 / 0.12); }
          else if(k2 < 0.35){ const q = (k2 - 0.12) / 0.23; x += 0.9 + q * 0.6; z = lerp(m.z, m.z + side * 2.2 * (sdw === side ? 1 : 0.4), q); }
          else if(k2 < 0.6){ const q = (k2 - 0.35) / 0.25; x += 1.5 - q * 1.5; z = lerp(m.z + side * 2.2 * (sdw === side ? 1 : 0.4), m.z, q); }
        }
        // the front jack man swings out of the car's way once the jacks are down
        if(m.kind === "jackF" && po && st.t > st.drop + 0.05){ z += side * 1.8 * clamp((st.t - st.drop - 0.05) / 0.25, 0, 1); x -= 0.4; }   // towards the garage: the car leaves towards the fast lane
        if(m.kind === "jackF" && P && P.phase === "out"){ z += side * 1.8; x -= 0.4; }
        // wheel men step out with the old wheel and in with the new
        if(m.kind === "off" && po){ const c = po["c" + m.q]; if(c >= 1) z += Math.sign(m.z) * 0.5 * clamp(c - 1, 0, 1); }
        if(m.kind === "on" && po){ const c = po["c" + m.q]; if(c >= 1.6 && c < 2) z -= Math.sign(m.z) * 0.45; }
      } else {
        pose.lean = 0.02;                                   // waiting on the apron
      }
      setPerson(C, i, x, z, face, pose);
      // the tools and the wheels that go with the job
      if(m.kind === "gun"){
        // the gun on the nut, spinning while it works
        const g = C.guns[m.q], hub = Math.sign(m.z) * 0.83;
        g.visible = ready >= 1;
        g.position.set(m.x, C.wheels[m.q].ax.r + lift, hub + Math.sign(m.z) * 0.36);
        g.rotation.set(po && gunBusy(st, m.q) ? t * 60 : 0, Math.PI / 2, 0);
      }
      if(m.kind === "jackF" || m.kind === "jackR"){
        const j = C.jacks[m.kind === "jackF" ? 0 : 1], front = m.kind === "jackF", up = po ? (front ? po.jackF : po.jackR) : 0;
        j.visible = ready > 0;
        const out = front && ((po && st.t > st.drop + 0.05) || (P && P.phase === "out"));
        // under the nose (or the gearbox) at work, the handle back towards the jack man and down as it lifts
        j.position.set(front ? 2.25 : -2.5, 0.12, out ? side * 1.8 : 0);
        j.rotation.set(0, front ? 0 : Math.PI, (0.55 - up * 0.45) * (ready >= 1 ? 1 : 0));
        if(ready < 1){ j.position.set(x + (front ? -0.5 : 0.5), 0.1, z); j.rotation.set(0, 0, 0.1); }
      }
    });
    // the wing: the stub comes off forward and is laid down; the new wing comes from the garage side and slides on
    const wk = po && rep.wing ? clamp((st.t - rep.wing[0]) / (rep.wing[1] - rep.wing[0]), 0, 1) : -1;
    C.wingOld.visible = wk >= 0.12 && ready >= 1;
    if(C.wingOld.visible){ const q = clamp((wk - 0.12) / 0.23, 0, 1); C.wingOld.position.set(0.9 + q * 2.2, lift - q * 0.05, side * 2.6 * q); C.wingOld.rotation.set(0, q * 0.5, 0); }
    C.wingNew.visible = !!(wingJob && ready >= 1 && (!po || st.t < st.drop));
    if(C.wingNew.visible){
      const q = wk < 0.35 ? 0 : clamp((wk - 0.35) / 0.25, 0, 1), fit = wk > 0.6 ? Math.sin(t * 22) * 0.004 * (wk < 0.95 ? 1 : 0) : 0;
      C.wingNew.position.set(lerp(1.4, 0, q) + fit, lerp(0.85, lift, q), lerp(side * 3.0, 0, q)); C.wingNew.rotation.set(0, (1 - q) * 0.4, 0);
    }
    // the spanner in the suspension man's hands, going to work on the bent corner
    const sk = po && rep.susp ? clamp((st.t - rep.susp[0]) / (rep.susp[1] - rep.susp[0]), 0, 1) : -1;
    C.spanner.visible = sk >= 0 && sk < 1 && ready >= 1;
    if(C.spanner.visible){ const ax = bentQ < 2 ? SP.rear : SP.front, sd = bentQ % 2 === 0 ? 1 : -1;
      C.spanner.position.set(ax.x + (bentQ < 2 ? 0.3 : -0.3), ax.r * 0.8 + lift, sd * 0.55); C.spanner.rotation.set(Math.sin(t * 9) * 0.6, 0, 0); }
    // the wheels: the old one comes off with the wheel-off man, the new one goes on from the wheel-on man
    for(let q = 0; q < 4; q++){
      const W = C.wheels[q], ax = W.ax, sd = q % 2 === 0 ? 1 : -1, x = ax.x, hubZ = sd * 0.83, hubY = ax.r + lift;
      const c = po ? po["c" + q] : 0;
      // the old wheel: on the car until it is off (the car hides its own), then out to the man and down beside him
      W.old.visible = !!(po && c >= 1 && !st.corners[q].none);
      if(W.old.visible){
        const o = clamp((c >= 2 ? 1 : c - 1) / 0.6, 0, 1);
        W.old.position.set(x - (q >= 2 ? 1 : -1) * 0.55 * o, lerp(hubY, ax.r, o), hubZ + sd * lerp(0, 1.3, o));
      }
      // the new wheel: held by the wheel-on man until the swap, then on the hub (the car shows its own)
      const onMan = C.st[q * 3 + 2];
      const before = !po || c < 2;
      W.nw.visible = !!newKey && ready > 0 && before && !(po && st.corners[q].none);
      if(W.nw.visible){
        const sw = po && c >= 1 ? clamp((c - 1.55) / 0.42, 0, 1) : 0;
        const hx = ready >= 1 ? onMan.x : lerp(onMan.wx, onMan.x, k), hz = ready >= 1 ? onMan.z : lerp(onMan.wz, onMan.z, k);
        W.nw.position.set(lerp(hx, x, sw), lerp(0.75, hubY, sw), lerp(hz - sd * 0.25, hubZ, sw));
      }
    }
    for(const p of PARTS) C.meshes[p].instanceMatrix.needsUpdate = true;
  },

  dispose(){
    for(const C of this.crews.values()){
      if(C.grp.parent) C.grp.parent.remove(C.grp);
      for(const m of C.mats) m.dispose();
      C.toolMat.dispose();
      for(const p of PARTS) C.meshes[p].dispose && C.meshes[p].dispose();
    }
    this.crews.clear(); this.t0 = null;
  },
};

// a crew member facing the car (face: +1 / -1 across, 0 forward, 2 back) as a heading in the box frame
function faceAng(f){ return f === 2 ? Math.PI : f === 0 ? 0 : f > 0 ? -Math.PI / 2 : Math.PI / 2; }
// is the gun on this corner spinning right now (nut off, or nut on)?
function gunBusy(st, q){
  const k = st.corners[q]; if(k.none) return false;
  const up = Math.max(st.jackF, st.jackR);
  return (st.t > up && st.t < k.off) || (st.t > k.swap && st.t < k.on);
}
// the working pose for each job at this moment of the stop
function workPose(m, p, po, st, t, i){
  if(m.kind === "gun"){                          // kneeling at the hub, the gun out in both hands
    p.hip = 0.55; p.hl = 1.45; p.kl = 1.5; p.hr = -0.15; p.kr = 1.75; p.lean = 0.38; p.al = 1.25; p.ar = 1.25;
    if(po && gunBusy(st, m.q)){ p.lean += Math.sin(t * 40 + i) * 0.02; }
    if(po && po["c" + m.q] >= 3){ p.ar = 2.6; }  // done: an arm up
  } else if(m.kind === "off" || m.kind === "on"){
    p.hip = 0.80; p.hl = 0.55; p.kl = 0.8; p.hr = 0.35; p.kr = 0.6; p.lean = 0.55; p.al = 0.95; p.ar = 0.95;
  } else if(m.kind === "jackF" || m.kind === "jackR"){
    const up = po ? (m.kind === "jackF" ? po.jackF : po.jackR) : 0;
    p.lean = -0.15 * up + 0.2 * (1 - up); p.al = 0.7 - up * 0.3; p.ar = 0.7 - up * 0.3; p.hl = 0.25; p.hr = -0.25; p.kl = 0.15;
  } else if(m.kind === "stab"){
    p.lean = 0.45; p.al = 1.1; p.ar = 1.1; p.hl = 0.2; p.hr = 0.2; p.kl = 0.25; p.kr = 0.25; p.hip = 0.88;
  } else if(m.kind === "rel"){
    p.al = 0.2; p.ar = po && po.light ? 2.7 : 0.45;  // the arm goes up as the light goes green
  }
}
// the repair men at work: the wing men bent over the nose, the suspension man on one knee at the corner
function repairPose(m, p, st, rep, t, i){
  if(m.kind === "susp"){
    p.hip = 0.55; p.hl = 1.45; p.kl = 1.5; p.hr = -0.15; p.kr = 1.75; p.lean = 0.45; p.al = 1.0; p.ar = 1.2;
    if(rep.susp && st.t < rep.susp[1]) p.ar += Math.sin(t * 9 + i) * 0.35;           // working the spanner
  } else {
    p.hip = 0.82; p.hl = 0.5; p.kl = 0.7; p.hr = 0.5; p.kr = 0.7; p.lean = 0.6; p.al = 1.15; p.ar = 1.15;
  }
}
// someone not needed on this stop: folded away to nothing
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
function hidePerson(C, i){ for(const k of PARTS) C.meshes[k].setMatrixAt(i, ZERO); }
// forward kinematics: one person's parts into the crew's instanced meshes
function setPerson(C, i, x, z, face, p){
  const root = M4.compose(V.set(x, 0, z), Q.setFromEuler(E.set(0, face, 0)), ONE);
  const hips = M5.copy(root).multiply(M6.makeTranslation(0, p.hip, 0));
  const torso = new THREE.Matrix4().copy(hips).multiply(M6.makeRotationZ(-p.lean));
  C.meshes.torso.setMatrixAt(i, torso); C.meshes.helmet.setMatrixAt(i, torso);
  for(const [sd, h, kk, part, shin] of [[-1, p.hl, p.kl, "thighL", "shinL"], [1, p.hr, p.kr, "thighR", "shinR"]]){
    const th = new THREE.Matrix4().copy(hips).multiply(M6.makeTranslation(0, 0, sd * 0.1)).multiply(new THREE.Matrix4().makeRotationZ(h));
    C.meshes[part].setMatrixAt(i, th);
    const sh = new THREE.Matrix4().copy(th).multiply(M6.makeTranslation(0, -THIGH, 0)).multiply(new THREE.Matrix4().makeRotationZ(-kk));
    C.meshes[shin].setMatrixAt(i, sh);
  }
  for(const [sd, a, part] of [[-1, p.al, "armL"], [1, p.ar, "armR"]]){
    const am = new THREE.Matrix4().copy(torso).multiply(M6.makeTranslation(0, SHOULDER, sd * 0.27)).multiply(new THREE.Matrix4().makeRotationZ(a));
    C.meshes[part].setMatrixAt(i, am);
  }
}
// the car's own tyre material (vertex-coloured), so a wheel in a mechanic's hands looks like the ones on the car
function car3dTyreMat(G, car){
  if(!G._crewTyreMat) G._crewTyreMat = new THREE.MeshStandardMaterial({ vertexColors:true, flatShading:true, roughness:0.82, metalness:0 });
  return G._crewTyreMat;
}

export { PITCREW };
