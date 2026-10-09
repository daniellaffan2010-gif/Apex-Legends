import { TAU, angWrap, clamp, lerp } from '../config/util.js';
import { PARTS, PART_KEYS, TYRES } from './parts.js';
import { bankZ } from '../tracks/shared.js';
import { spawn } from '../render2d/particles.js';
import { AUDIO } from '../audio/audio.js';
import { addDent, contactLocal, contactTorque, pushFx } from './damage.js';
import { pilotStep, pilotEnd } from './pitpilot.js';
import * as AERO from './aero.js';
import { NEUTRAL } from './tune.js';

/* ---------- 3. cars: physics --------------------------------------------- */
const LAUNCH_LO = 0.52, LAUNCH_HI = 0.74;          // the rev window for a clean getaway
const VMAX = 92, ENGINE = 15.2, DRAG = 0.00128, BRAKE = 40, GRIP = 38.5, STEER_AUTH = 2.55;
const SURF = { road:1, kerb:0.94, runoff:0.62, grass:0.48, sand:0.42, pit:1, tarmac:0.86, gravel:0.30, astro:0.60 };
const GRADE_G = 9.81 * 0.5;                      // gravity along a slope, at half strength

/* How much grip a set of tyres has left. They fade steadily to 93% at 30% life,
   then fall off the cliff: on the canvas they are down to 78%, seconds a lap. */
function tyreWearK(life){
  life = clamp(life, 0, 1);
  return life >= 0.3 ? 0.93 + 0.07 * (life - 0.3) / 0.7 : 0.78 + 0.15 * (life / 0.3);
}
function tyreGripK(c){ return c.tyre.grip * tyreWearK(c.life) * lerp(0.93, 1, clamp(c.temp, 0, 1)); }
// the same wear sum for the player and the rivals: a base rate, cornering load and braking
function tyreLoad(lat, brk){ return 0.00042 + lat * 0.00005 + brk * 0.00055; }

class Car {
  constructor(team, drv, idx, T){
    this.team = team; this.drv = drv; this.idx = idx; this.T = T;
    this.x = 0; this.y = 0; this.z = 0; this.h = 0; this.vx = 0; this.vy = 0;
    this.node = 0; this.lap = 0; this.s = 0; this.prog = 0; this.off = 0;
    this.steer = 0; this.thr = 0; this.brk = 0; this.hand = 0; this.boost = 0;
    this.batt = 1; this.tyre = TYRES.medium; this.life = 1; this.temp = 0.5;
    this.damage = 0; this.slide = 0; this.pitting = 0; this.pitReq = false; this.pitT = 0;
    this.broken = new Set(); this.perf = { grip:1, power:1, brake:1, top:1, boost:true, pull:0 };
    this.health = {}; for(const k of PART_KEYS) this.health[k] = 1;
    this.inPit = false; this.pitPlan = null; this.stopT = 0; this.stopTotal = 0; this.pitVisit = 0;
    this.momentT = 0; this.momentKind = null; this.retiredBy = null;
    this.revs = 0; this.launchMul = 1; this.launchT = 0; this.launchGrade = null;
    this.roll = 0; this.pitch = 0; this.rollV = 0; this.pitchV = 0;
    this.air = 0; this.airV = 0; this.spinV = 0; this.spinT = 0; this.wrecked = false;
    this.stops = 0; this.used = new Set(); this.finished = false; this.dnf = false;
    this.lapStart = null; this.best = null; this.last = null; this.laps = []; this.secBest = [null, null, null];
    this.secStart = 0; this.curSec = 0; this.secT = [null, null, null];
    this.ai = true; this.pace = 1; this.pos = idx + 1; this.gap = null; this.total = 0;
    this.aiOff = 0; this.aiTarget = 0; this.mistake = 0; this.kerbShake = 0; this.wallHit = 0;
    this.dents = []; this.dentVer = 0; this.wheelOff = -1; this.wheelOff2 = -1; this.lossT = 0; this.spinCool = 0; this.lastHit = null;
    this.tow = 0; this.dirty = 0; this.wakeOf = null; this.wakeGap = null;      // slipstream and dirty air, see aero.js
    this.su = NEUTRAL;                                                          // the garage setup's multipliers (tune.js); only the player's differ
  }
  /* ---------- crash dynamics ----------------------------------------------
     A wrecked car leaves the track model entirely and becomes a ballistic
     body: it tumbles, lands, bounces, and can clear the barriers.           */
  launch(imp, S){
    this.wrecked = true; this.spinT = 0; this.crashT = 0;
    this.air = Math.max(this.air, 0.35);
    this.airV = clamp(imp * 0.30, 5, 14);
    this.rollV = (Math.random() < 0.5 ? -1 : 1) * (4 + Math.random() * 4.5);
    this.pitchV = (Math.random() - 0.5) * 4.2;
    this.spinV = (Math.random() - 0.5) * 8;
    const sp = Math.hypot(this.vx, this.vy);
    if(sp > 2){ this.vx *= 0.9; this.vy *= 0.9; }
    if(S){
      for(let k = 0; k < 22; k++)
        spawn(this.x, this.y, this.z + 0.4, (Math.random() - 0.5) * 16, (Math.random() - 0.5) * 16,
              2 + Math.random() * 9, 0.7 + Math.random() * 1.2,
              k % 3 ? "#8A9199" : "#FFC46B", 0.28, k % 3 ? "spark" : "smoke");
      // a heavy crash sheds the wings, a wheel or two and a shower of bodywork
      if(!this.broken.has("wing")) this.breakPart("wing", S, true, true);
      if(!this.broken.has("rear")) this.breakPart("rear", S, true, true);
      this.tearWheel(S, this.lastHit && this.lastHit.lf < 0 ? 0 : 2, imp);
      if(Math.random() < 0.8) this.tearWheel(S, (Math.random() * 4) | 0, imp);
      pushFx(S, { t:"shards", car:this, n:18 + (imp * 0.4 | 0), power:1.4 });
      pushFx(S, { t:"crash", car:this, imp });
    }
  }
  /* A wheel comes off and goes bouncing away on its own. */
  tearWheel(S, idx, imp){
    if(this.wheelOff === idx) return;
    if(this.wheelOff >= 0 && this.wheelOff2 === idx) return;
    if(this.wheelOff < 0) this.wheelOff = idx; else this.wheelOff2 = idx;
    this.broken.add("susp"); this.health.susp = 0; this.recalcPerf();
    pushFx(S, { t:"wheel", car:this, idx, imp: imp || 20 });
  }
  wreckStep(dt, S){
    const T = this.T;
    this.x += this.vx * dt; this.y += this.vy * dt;
    this.air += this.airV * dt;
    this.airV -= 17 * dt;
    this.h += this.spinV * dt;
    this.roll += this.rollV * dt;
    this.pitch += this.pitchV * dt;
    if(this.air <= 0){
      this.air = 0;
      if(this.airV < -2.5){
        this.airV = -this.airV * 0.34;                    // bounce
        this.rollV *= 0.55; this.pitchV *= 0.45; this.spinV *= 0.7;
        this.vx *= 0.72; this.vy *= 0.72;
        for(let k = 0; k < 8; k++)
          spawn(this.x, this.y, this.z + 0.2, (Math.random() - 0.5) * 9, (Math.random() - 0.5) * 9,
                1.5 + Math.random() * 4, 0.6, k % 2 ? "#FFC46B" : "#9AA0A7", 0.3, k % 2 ? "spark" : "smoke");
        if(this === S.player) S.shake = Math.min(1, S.shake + 0.5);
      } else this.airV = 0;
      const k2 = Math.pow(0.22, dt);
      this.vx *= k2; this.vy *= k2;
      this.spinV *= Math.pow(0.25, dt);
      this.rollV *= Math.pow(0.2, dt);
      this.pitchV *= Math.pow(0.2, dt);
    }
    this.node = T.near(this.x, this.y, this.node);
    const i = this.node;
    const dx = this.x - T.x[i], dy = this.y - T.y[i];
    this.off = dx * T.nx[i] + dy * T.ny[i];
    this.s = T.s[i] + (dx * T.tx[i] + dy * T.ty[i]);
    // the barrier stops a tumbling car as it stops any other
    const lim = T.half + T.roAt(i, this.off) + (T.barrier === "wall" ? 0.9 : 3.2);
    if(Math.abs(this.off) > lim){
      const sg = Math.sign(this.off), push = Math.abs(this.off) - lim;
      this.x -= T.nx[i] * sg * push; this.y -= T.ny[i] * sg * push; this.off -= sg * push;
      const into = this.vx * T.nx[i] * sg + this.vy * T.ny[i] * sg;
      if(into > 1){
        this.vx -= T.nx[i] * sg * into * 1.45; this.vy -= T.ny[i] * sg * into * 1.45;
        this.rollV += (Math.random() - 0.5) * 3; this.airV = Math.max(this.airV, Math.min(6, into * 0.3));
        if(into > 4) pushFx(S, { t:"shards", car:this, n:Math.min(10, 3 + into * 0.3 | 0), power:0.8 });
        if(this === S.player) S.shake = Math.min(1, S.shake + into * 0.03);
      }
    }
    this.z = this.roadZ(i, dx * T.tx[i] + dy * T.ty[i]) + this.air;
    this.slide = 0;
    if(this.air === 0 && Math.hypot(this.vx, this.vy) < 1.2 && Math.abs(this.rollV) < 0.5){
      this.wrecked = false;                                // come to rest, on wheels or roof
      this.roll = Math.round(this.roll / Math.PI) * Math.PI;
      this.pitch *= 0.2; this.rollV = this.pitchV = this.spinV = 0;
      this.vx = this.vy = 0;
    }
  }
  startSpin(S, v){
    if(this.spinT > 0 || this.wrecked || this.dnf) return;
    this.spinT = 1.6 + Math.random() * 0.6; this.spinV = v;
    this.slide = 1; this.lossT = 0;
    if(this === S.player){ S.shake = Math.min(1, S.shake + 0.45); S.toast && 0; }
    try{ AUDIO.event("spin", this, S); }catch(e){}
  }
  scuff(S, imp){
    if(!S.marks) S.marks = [];
    if(S.marks.length > 90) S.marks.shift();
    S.marks.push({ x:this.x, y:this.y, z:this.z, a:this.h,
                   w:clamp(imp * 0.22, 1.4, 6), o:clamp(imp / 34, 0.12, 0.55) });
  }
  recalcPerf(){
    const p = { grip:1, power:1, brake:1, top:1, boost:true, pull:0 };
    for(const k of this.broken){
      const d = PARTS[k]; if(!d) continue;
      if(d.grip) p.grip *= d.grip;
      if(d.power) p.power *= d.power;
      if(d.brake) p.brake *= d.brake;
      if(d.top) p.top *= d.top;
      if(d.noBoost) p.boost = false;
      if(d.pull) p.pull += (this.idx % 2 ? 1 : -1) * 0.14;
    }
    this.perf = p;
  }
  breakPart(where, S, exact, quiet){
    let k;
    if(exact){ k = where; if(this.broken.has(k)) return null; }
    else {
      // pick something that has not already gone, biased by where the hit landed
      const pool = PART_KEYS.filter(k2 => !this.broken.has(k2) &&
        (where === "any" || PARTS[k2].where === "any" || PARTS[k2].where === where));
      const list = pool.length ? pool : PART_KEYS.filter(k2 => !this.broken.has(k2));
      if(!list.length) return null;
      k = list[(Math.random() * list.length) | 0];
    }
    this.health[k] = 0;
    this.broken.add(k); this.recalcPerf();
    if(PARTS[k].tyre) this.life = Math.min(this.life, 0.08);
    if(S){
      if(k === "wing" || k === "rear") pushFx(S, { t:"part", car:this, part:k });
      if(k === "susp" && this.wheelOff < 0 && !quiet){
        const lh = this.lastHit, idx = lh ? (lh.front ? 2 : 0) + (lh.lr > 0 ? 0 : 1) : (this.idx % 4);
        if(!lh || Math.random() < 0.6) this.tearWheel(S, idx, 14);
      }
      if(!quiet){
        try{ AUDIO.event("fail", this, S, PARTS[k].name); }catch(e){}
        if(!this.ai) S.toast(PARTS[k].name + " damaged — box for repairs");
        else if(S.player && Math.abs(this.pos - S.player.pos) <= 3) S.toast(this.drv.last + ": " + PARTS[k].name.toLowerCase() + " trouble");
      }
    }
    return k;
  }
  /* hit = the world direction from this car towards what it struck. It puts the
     dent where the contact was, decides which corner of the car takes the part
     damage, and tells the 3D car where to throw its bodywork. */
  hurt(imp, where, S, hit){
    if(this.dnf || !S || !S.damage) return;
    let loc = null;
    if(hit){
      loc = contactLocal(hit.dx, hit.dy, this.h); this.lastHit = loc;
      where = loc.zone === "nose" || loc.zone === "fl" || loc.zone === "fr" ? "front"
            : loc.zone === "tail" || loc.zone === "rl" || loc.zone === "rr" ? "rear" : "side";
      addDent(this, loc, imp / 24);
      if(imp > 8) pushFx(S, { t:"shards", car:this, n:Math.min(14, 2 + imp * 0.45 | 0), power:Math.min(1.2, imp / 20), loc });
    }
    if(imp < 6) return;
    this.damage = clamp(this.damage + Math.pow(clamp(imp / 30, 0, 1.3), 1.7) * 0.32, 0, 1);
    if(imp > 30 || this.damage >= 0.995){ this.launch(imp, S); this.retire(S, "Heavy crash"); return; }
    // a hard enough knock takes the nearest wing straight off
    if(loc && imp > 13 && !this.broken.has("wing") && (loc.zone === "nose" || loc.zone === "fl" || loc.zone === "fr") && Math.random() < (imp - 8) / 22) this.breakPart("wing", S, true);
    if(loc && imp > 13 && !this.broken.has("rear") && (loc.zone === "tail" || loc.zone === "rl" || loc.zone === "rr") && Math.random() < (imp - 8) / 22) this.breakPart("rear", S, true);
    if(loc && imp > 15 && this.wheelOff < 0 && (loc.zone === "fl" || loc.zone === "fr" || loc.zone === "rl" || loc.zone === "rr" || loc.zone === "left" || loc.zone === "right") && Math.random() < (imp - 10) / 26){
      this.tearWheel(S, (loc.front ? 2 : 0) + (loc.lr > 0 ? 0 : 1), imp);
      if(!this.broken.has("susp")) this.breakPart("susp", S, true, true);
    }
    // wear the components on the side that took the hit
    for(const k of PART_KEYS){
      if(this.broken.has(k)) continue;
      const P = PARTS[k];
      const aim = (P.where === where) ? 1.0 : (P.where === "any" ? 0.45 : 0.18);
      if(aim <= 0) continue;
      this.health[k] = clamp(this.health[k] - Math.pow(clamp(imp / 30, 0, 1.2), 2) * aim * (0.35 + Math.random() * 0.5), 0, 1);
      if(this.health[k] <= 0.001) this.breakPart(k, S, true);
    }
    const chance = clamp((imp - 5) / 34, 0, 0.9) * (0.30 + this.damage * 0.9) * 0.45;
    if(Math.random() < chance) this.breakPart(where, S);
  }
  retire(S, why){
    if(this.dnf) return;
    this.dnf = true; this.retiredBy = why || "Retired"; this.thr = 0; this.brk = 1;
    if(this.ai && !this.pitting){ this.inPit = false; this.pitReq = false; }   // out on the circuit: no stale pit-lane state
    if(!this.wrecked){ this.vx = this.vy = 0; }
    this.railV = 0;
    if(typeof spawn === "function") for(let k = 0; k < 16; k++)
      spawn(this.x, this.y, this.z + 0.5, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12,
            2 + Math.random() * 6, 0.9 + Math.random(), k % 3 ? "#6E7681" : "#FFB86B", 0.5, "smoke");
    try{ AUDIO.event("out", this, S); if(this === S.player) setTimeout(() => AUDIO.silence(), 900); }catch(e){}
    if(this === S.player){
      S.toast("RETIRED — " + this.retiredBy);
      S.crashCam = this.wrecked ? 9 : 2.2;            // watch it come to rest first (the session runs the cutscene)
      S.crashKind = this.wrecked ? "wreck" : "stop";
    }
    else S.toast(this.drv.last + " is out — " + this.retiredBy.toLowerCase());
  }
  /* How hard the kerb under the outer wheels shakes the car (0 if there is none):
     a painted kerb a little, a ridged one fully, the sausage behind it with a jolt.
     The outer wheels run about 0.8 m out from the car's centre. src/tracks/kerbs.js */
  kerbRattle(T, off){
    const a = Math.abs(off) + 0.8 - T.half;
    if(a < 0.05 || a > 2.1) return 0;
    if(!T.kerbKind) return 1;
    const k = T.kerbKind(this.node, off);
    return k === 0 ? 0 : k === 1 ? 0.45 : (k === 3 && a > 1.55) ? 1.3 : 1;
  }
  place(node, lateral){
    const T = this.T, i = ((node % T.n) + T.n) % T.n;
    this.x = T.x[i] + T.nx[i] * lateral; this.y = T.y[i] + T.ny[i] * lateral;
    this.z = T.z[i]; this.h = T.ang[i]; this.node = i; this.vx = this.vy = 0;
    this.railS = T.s[i]; this.railV = 0; this.s = T.s[i]; this.off = lateral;
  }
  get speed(){ return Math.hypot(this.vx, this.vy); }
  /* The ribbon is straight between nodes, so the road height under the car is a
     straight line too. Snapping to the nearest node instead made the car jump a
     whole step at every half-way point, which on a real climb is most of a metre. */
  roadZ(i, along){
    const T = this.T, n = T.n, j = (i + (along >= 0 ? 1 : n - 1)) % n, f = Math.min(Math.abs(along) / T.ds, 1);
    return T.z[i] + (T.z[j] - T.z[i]) * f;
  }
  roadCamber(i, along){
    const T = this.T, n = T.n, j = (i + (along >= 0 ? 1 : n - 1)) % n, f = Math.min(Math.abs(along) / T.ds, 1);
    return T.camber[i] + (T.camber[j] - T.camber[i]) * f;
  }

  surface(){
    const T = this.T, a = Math.abs(this.off);
    if(this.pitting) return SURF.pit;
    if((this.pitReq || this.pitting) && T.inPitLane(this.node, this.off)) return SURF.pit;
    if(a < T.half - 0.4) return SURF.road;
    if(a < T.half + 1.6) return SURF.kerb;
    if(T.surfAt){ const k = T.surfAt(this.node, this.off);
      return k === "asphalt" ? SURF.tarmac : k === "gravel" ? SURF.gravel : k === "astro" ? SURF.astro : k === "runoff" ? SURF.runoff : SURF.grass; }
    const ro = T.roAt(this.node, this.off);
    if(ro > 0 && a < T.half + ro) return T.pal.ground === "#D6C79E" || T.id === "baku" ? SURF.sand : SURF.runoff;
    // on a street circuit there is nothing beyond the run-off but the wall, so
    // the last strip stays as grippy as the road — except in a real escape road,
    // where the dusty asphalt keeps its penalty right up to the TecPro
    if(T.barrier === "wall") return ro > 4 ? SURF.runoff : SURF.road;
    return SURF.grass;
  }

  step(dt, S){
    const T = this.T;
    if(this.dnf && !this.wrecked){
      // a wreck that came to rest on its roof is put back on its wheels, so the driver can climb out
      if(!this.ai){ const to = Math.round(this.roll / TAU) * TAU; this.roll += (to - this.roll) * Math.min(1, dt * 2.5); }
      return;
    }
    if(S.damage && !this.pitting){
      const risk = (0.00005 + this.damage * 0.0011 + (this.life < 0.12 ? 0.0004 : 0)) * dt;
      if(Math.random() < risk) this.breakPart("any", S);
    }
    this.slowT = this.speed < 10 ? (this.slowT || 0) + dt : 0;
    this.stalled = this.slowT > 1.2 && !this.pitting;
    // ---- pit lane is driven on rails; the stop itself is the drama ----
    if(this.pitting){ this.pitStep(dt, S); return; }
    if(this.wrecked){ this.wreckStep(dt, S); return; }
    // a rival on the line follows its rail; one that has spun or gone off drives itself back, on the same physics as yours
    if(this.ai && this.spinT <= 0 && !this.aiFree){ this.aiStep(dt, S); return; }

    const fx = Math.cos(this.h), fy = Math.sin(this.h), rx = -fy, ry = fx;
    let vf = this.vx * fx + this.vy * fy, vs = this.vx * rx + this.vy * ry;

    const surf = this.surface();
    const wetK = S.wet > 0 ? lerp(1, this.tyre.key === "wet" ? 0.93 : 0.68, S.wet) : 1;
    const tyreGrip = tyreGripK(this);
    const g = GRIP * surf * wetK * tyreGrip * (1 - this.damage * 0.22) * this.pace * this.perf.grip * AERO.gripK(this) * this.su.grip;
    const boosting = this.boost > 0 && this.batt > 0.01 && vf > 8 && this.perf.boost;
    const vmax = VMAX * (boosting ? 1.055 : 1) * this.pace * this.perf.top * AERO.topK(this) * this.su.top;

    // longitudinal
    const eng = ENGINE * (boosting ? 1.10 : 1) * (1 - this.damage * 0.18) * surf * this.pace * this.perf.power * this.launchMul
      * lerp(this.su.power, this.su.top, clamp(vf / 70, 0, 1));      // setup: pull off the line, then reach at speed (gearing trades one for the other)
    if(this.launchT > 0){
      this.launchT -= dt;
      if(this.launchT <= 0) this.launchMul = 1;
      else if(this.launchGrade === "spin" && this.thr > 0 && Math.abs(vf) < 45 && Math.random() < dt * 40)
        spawn(this.x - Math.cos(this.h) * 1.6, this.y - Math.sin(this.h) * 1.6, this.z + 0.2,
              (Math.random() - 0.5) * 5, (Math.random() - 0.5) * 5, 0.6, 0.7, "#C6CBD1", 0.5, "smoke");
    }
    let af = this.thr * eng * Math.min(1, 0.55 + Math.abs(vf) / 25);
    // the speed limit holds between the pit lane's two lines (the lane drives itself there; this is the backstop)
    const limZone = this.inPit && T.pitInLimit && T.pitInLimit(this.s), plim = T.pitLimit || 22.2;
    if(limZone && vf > plim) af = Math.min(af, -26);
    af -= this.brk * BRAKE * this.perf.brake * this.su.brake * surf * wetK * (vf > 0.4 ? 1 : 0);
    if(this.brk > 0 && vf <= 0.4 && vf > -11) af -= this.brk * eng * 0.5;          // reverse
    // gravel digs in, and harder the faster you arrive, but a car can still crawl out of it (and off the grass:
    // its drag fades at a crawl, or a car that stopped there could never pull away again)
    const gravel = surf === SURF.gravel;
    af -= Math.sign(vf) * (DRAG * AERO.dragK(this) * this.su.drag * vf * vf) + vf * 0.035 + (surf < 0.72 ? Math.sign(vf) * (gravel ? 1.4 : 6.5) * clamp(Math.abs(vf) / 10, 0.25, 1) : 0)
      + (gravel ? Math.sign(vf) * clamp((Math.abs(vf) - 5) / 6, 0, 1) * (9 + Math.abs(vf) * 0.32) : 0);
    // the hill: gravity along the road, at half strength so it is felt without
    // rebalancing the field — slower up Beau Rivage, quicker down to the hairpin
    af -= GRADE_G * T.grade(this.node) * Math.cos(this.h - T.ang[this.node]);
    vf += af * dt;
    if(vf > vmax) vf = lerp(vf, vmax, 1 - Math.pow(0.02, dt));
    if(limZone && vf > plim) vf = Math.max(plim, vf - 30 * dt);
    if(this.thr === 0 && this.brk === 0 && Math.abs(vf) < 0.35) vf = 0;

    // yaw + lateral friction
    const spd = Math.hypot(vf, vs);
    let auth = Math.min(STEER_AUTH, 1.06 * g / Math.max(spd, 7)) *
               clamp(spd / 4.5, 0, 1) * (1 - clamp(Math.abs(vs) / 26, 0, 0.28)) * (vf < 0 ? -1 : 1);
    // catching a slide should work: countersteer gets extra authority
    if(vs !== 0 && Math.sign(this.steer) === Math.sign(vs)) auth *= 1 + clamp(Math.abs(vs) / 10, 0, 0.35);
    const spinning = this.spinT > 0;
    const yaw = spinning ? 0 : (this.steer + this.perf.pull) * auth * (1 - this.hand * 0.25);
    if(!spinning){
      this.h += yaw * dt;
      vs += -vf * yaw * dt;
      const latMax = g * (1 - this.hand * 0.62) * dt;
      if(Math.abs(vs) <= latMax) vs = 0; else vs -= Math.sign(vs) * latMax;
      vf -= Math.abs(vs) * 0.28 * dt;
    }
    this.slide = lerp(this.slide, spinning ? 1 : clamp(Math.abs(vs) / 9, 0, 1), 0.2);
    this.spinCool = Math.max(0, this.spinCool - dt);

    /* Beyond the limit the car lets go. The friction circle: what the steering asks
       of the tyres sideways and what the brakes ask of them at once. Too much of it
       for long enough, or being on the grass at speed with the wheel turned, and the
       back end goes. It turns the way the corner was going, so it is the car you
       were steering that spins, not a random one. */
    if(!spinning && !this.dnf && this.spinCool <= 0){
      const spdNow = Math.hypot(vf, vs);
      const latDem = Math.abs(yaw * vf) / Math.max(g, 1);
      const brkDem = this.brk * BRAKE * this.perf.brake * this.su.brake * this.su.stab * surf * wetK * (vf > 0.4 ? 1 : 0) / Math.max(g, 1);
      const use = Math.hypot(latDem, brkDem + this.thr * 0.12 * (spdNow < 30 ? 1.8 : 0.4));
      let over = use > 1.38 ? (use - 1.27) * 4.2 : 0;
      if(surf < 0.7 && spdNow > 55 && Math.abs(this.steer) > 0.65) over += (1 - surf) * 1.5 * Math.abs(this.steer);
      if(Math.abs(vs) > 13 && Math.abs(vf) > 20) over += Math.abs(vs) / 19;       // already well sideways
      if(this.hand > 0.5 && spdNow > 30 && Math.abs(this.steer) > 0.55) over += 0.9;
      if(over > 0) this.lossT += over * dt; else this.lossT = Math.max(0, this.lossT - dt * 3.0);
      if(this.lossT > 1.0 && spdNow > 20){
        this.lossT = 0;
        const dir = Math.abs(yaw) > 0.05 ? Math.sign(yaw) : (vs !== 0 ? -Math.sign(vs) : (Math.random() < 0.5 ? -1 : 1));
        this.lastSpinWhy = "grip"; this.startSpin(S, dir * (3.2 + Math.min(spdNow, 80) * 0.035 + Math.random() * 1.2));
      }
    }
    if(this.spinT > 0){
      // a spinning car slides on along the line it had, scrubbing speed off as it turns
      const sp0 = Math.hypot(this.vx, this.vy);
      this.h += this.spinV * dt;
      this.spinV *= Math.pow(sp0 < 8 ? 0.05 : 0.5, dt);
      const dec = (10 + (1 - surf) * 12 + this.brk * 12) * dt;
      const k3 = sp0 > dec ? (sp0 - dec) / sp0 : 0;
      this.vx *= k3; this.vy *= k3;
      if(Math.abs(this.spinV) < 1.6 || sp0 < 5) this.spinT -= dt * 2.4; else this.spinT -= dt * 0.25;
      this.pitch = lerp(this.pitch, 0, dt * 3);
      if(this.ai){ this.thr = 0; this.brk = 0.75; this.steer = 0; }
      if(sp0 > 6 && Math.random() < dt * 60)
        spawn(this.x - Math.cos(this.h) * 0.6, this.y - Math.sin(this.h) * 0.6, this.z + 0.15, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6,
              0.8 + Math.random(), 0.9 + Math.random() * 0.5, "#D4D8DC", 0.7, "smoke");
      if(this.spinT <= 0){
        this.spinCool = 1.4; this.spinV = 0;
        // no reset: it is wherever the spin left it, facing whichever way, and has to drive itself back (ai/driver.js freeDrive)
        if(this.ai){ this.aiFree = true; this.freeT = 0; this.revT = 0; this.freeS = this.s; this.freeProg = 0; }
      }
    }
    // body leans under load, and settles when it is not
    this.roll = lerp(this.roll, clamp(-vs * 0.012, -0.11, 0.11), dt * 6);
    this.pitch = lerp(this.pitch, clamp((this.brk * 0.05 - this.thr * 0.025), -0.05, 0.06), dt * 5);

    // rebuild in the NEW heading's frame, so the velocity actually turns with the car
    if(!spinning){
      const nfx = Math.cos(this.h), nfy = Math.sin(this.h);
      this.vx = nfx * vf - nfy * vs; this.vy = nfy * vf + nfx * vs;
    }
    this.x += this.vx * dt; this.y += this.vy * dt;

    // ---- track frame ----
    this.node = T.near(this.x, this.y, this.node);
    const i = this.node;
    const dx = this.x - T.x[i], dy = this.y - T.y[i];
    this.off = dx * T.nx[i] + dy * T.ny[i];
    const along = dx * T.tx[i] + dy * T.ty[i];
    this.s = T.s[i] + along;
    this.z = this.roadZ(i, along) + bankZ(T, i, this.off) + this.off * this.roadCamber(i, along);

    this.inPit = (this.pitReq || this.pitting) && T.inPitLane(i, this.off);
    // committed: the pit wall stops you rejoining until the lane merges back
    if(this.inPit && !this.ai && T.pitRamp(i) > 0.35){
      const sg = T.pitSide, innerEdge = T.half - 0.2;
      if(this.off * sg < innerEdge){
        const push = (innerEdge - this.off * sg) * sg;
        this.x += T.nx[i] * push; this.y += T.ny[i] * push; this.off += push;
        const into = this.vx * T.nx[i] * sg + this.vy * T.ny[i] * sg;
        if(into < 0){ this.vx -= T.nx[i] * sg * into * 1.3; this.vy -= T.ny[i] * sg * into * 1.3; }
      }
    }
    // barriers
    const onPitSide = Math.sign(this.off) === T.pitSide;
    const pitExtra = (onPitSide && (this.pitReq || this.pitting)) ? T.pitW * T.pitRamp(i) : 0;
    const roHere = T.roAt(i, this.off);
    const saferHere = T.safer && T.safer(i, Math.sign(this.off) || 1);
    const limit = T.half + pitExtra + (pitExtra > 0.2 ? 1.0 : (T.barrier === "wall" ? roHere + 0.9 : saferHere ? roHere + 1.7 : roHere + 3));
    if(Math.abs(this.off) > limit){
      const push = (Math.abs(this.off) - limit) * Math.sign(this.off);
      this.x -= T.nx[i] * push; this.y -= T.ny[i] * push; this.off -= push;
      const into = this.vx * T.nx[i] * Math.sign(this.off) + this.vy * T.ny[i] * Math.sign(this.off);
      if(into > 0){
        const sg = Math.sign(this.off);
        const hitD = { dx:T.nx[i] * sg, dy:T.ny[i] * sg }, hitL = contactLocal(hitD.dx, hitD.dy, this.h);
        const rest = into > 26 ? 0.22 : clamp(0.35 + into * 0.012, 0.35, 0.75);       // it bounces, it does not stick; a wreck crumples
        this.vx -= T.nx[i] * sg * into * (1 + rest);
        this.vy -= T.ny[i] * sg * into * (1 + rest);
        this.vx *= 0.86; this.vy *= 0.86;
        if(into > 3){
          this.scuff(S, into);
          for(let k = 0; k < Math.min(14, 2 + into | 0); k++)
            spawn(this.x, this.y, this.z + 0.25 + Math.random() * 0.4,
                  -T.nx[i] * sg * (3 + Math.random() * 9) + (Math.random() - 0.5) * 6,
                  -T.ny[i] * sg * (3 + Math.random() * 9) + (Math.random() - 0.5) * 6,
                  2 + Math.random() * 6, 0.35 + Math.random() * 0.4,
                  k % 4 ? "#FFC46B" : "#C9CED4", 0.22, "spark");
        }
        // the contact is on the corner that touched: a front corner pushes the nose off
        // the wall, a rear one swings the nose into it. Either way, at speed, it spins.
        const lf = hitL.lf, lr = hitL.lr, spd0 = Math.hypot(this.vx, this.vy) + into;
        if(into > 4.5 && spd0 > 32 && this.spinT <= 0 && !this.wrecked){
          const side = Math.abs(lf) < 0.15 ? 1 : (lf > 0 ? -1 : 1);
          const dirS = side * (Math.sign(lr) || 1);
          this.lastSpinWhy = "wall"; this.startSpin(S, dirS * clamp(2.4 + into * 0.18 + spd0 * 0.03, 2.6, 7));
        }
        if(into > 1.2) this.hurt(into, Math.abs(this.off) > T.half ? "side" : "front", S, hitD);
        this.wallHit = 1; if(!this.ai) S.shake = Math.min(1, S.shake + into * 0.03);
      }
    }
    // kerb rattle: only where a kerb is drawn, and by its kind (the grip stays the kerb band's, as before)
    const rattle = surf === SURF.kerb ? this.kerbRattle(T, this.off) : 0;
    this.kerbShake = rattle > 0 ? rattle : Math.max(0, this.kerbShake - dt * 4);

    // battery + tyres
    if(boosting) this.batt = clamp(this.batt - dt * 0.30, 0, 1);
    else this.batt = clamp(this.batt + dt * (this.brk > 0.2 ? 0.20 : 0.035), 0, 1);
    const load = tyreLoad(Math.abs(yaw) * Math.abs(vf), this.brk) + Math.abs(vs) * 0.00055;
    this.life = clamp(this.life - load * this.tyre.wear * S.wearMul * AERO.wearK(this) * this.su.wear * dt * 0.34, 0, 1);
    this.temp = clamp(this.temp + (Math.abs(vs) * 0.02 + Math.abs(vf) * 0.004 + AERO.heat(this) + this.su.heat - (this.temp - 0.35) * 0.55) * dt, 0, 1.2);
  }

  /* Rivals follow the line with real speed dynamics: they brake, accelerate and
     wear tyres like the player's car, but they cannot spin themselves off the road.
     Contact displaces them bodily — the next frame re-reads position, so a hit
     genuinely knocks them off line and they have to work their way back. */
  aiStep(dt, S){
    const T = this.T, h0 = this.h;
    const i = this.node = T.near(this.x, this.y, this.node);
    const dx = this.x - T.x[i], dy = this.y - T.y[i];
    let off = dx * T.nx[i] + dy * T.ny[i];
    const derived = T.s[i] + (dx * T.tx[i] + dy * T.ty[i]);
    /* A rail follower knows its own lane. Measuring it back from the position
       is fine on a straight, but on the inside of a tight corner the nearest
       node's normal is nowhere near the right direction, the error feeds into
       the next frame's position, and the car spirals to the edge. So if we are
       where the rail says we are, keep the lane we had; only re-measure after
       something (a contact, a spin) has moved us. */
    if(this.railOff != null && this.railS != null){
      const f0 = this.railS / T.ds, j0 = ((Math.floor(f0) % T.n) + T.n) % T.n, k0 = (j0 + 1) % T.n, u0 = f0 - Math.floor(f0);
      const px = lerp(T.x[j0], T.x[k0], u0) + lerp(T.nx[j0], T.nx[k0], u0) * this.railOff;
      const py = lerp(T.y[j0], T.y[k0], u0) + lerp(T.ny[j0], T.ny[k0], u0) * this.railOff;
      if(Math.hypot(this.x - px, this.y - py) < 0.8) off = this.railOff;
    }
    // keep our own arc-length, but resync whenever contact has shoved us somewhere else
    let s = this.railS;
    if(s == null || Math.abs(angWrap((derived - s) / T.length * TAU)) > 0.004 * TAU) s = derived;

    // longitudinal
    let v = this.railV != null ? this.railV : this.speed;
    const vt = this.aiTargetV != null ? this.aiTargetV : v;
    if(vt > v){
      // the same pull of the hill as the player feels, on the way up to speed
      const accCap = Math.max(1.4, ENGINE * this.pace * this.perf.power * (this.boost > 0 && this.batt > 0.02 && this.perf.boost ? 1.10 : 1) *
        (1 - this.damage * 0.20) * Math.min(1, 0.55 + v / 25) - DRAG * AERO.dragK(this) * v * v - v * 0.035 - GRADE_G * T.grade(i));
      v = Math.min(vt, v + Math.min(accCap, (vt - v) * 3.2) * dt);
      this.brk = 0; this.thr = 1;
    } else if(v - vt < 0.8 && !(this.brk > 0.02)){
      // a hair too quick: lift and let the drag take it, no stab of the brakes
      // (once braking for a corner, though, stay on them until it is done)
      v = Math.max(vt, v - (2 + DRAG * v * v) * dt);
      this.brk = 0; this.thr = 0;
    } else {
      const decCap = BRAKE * this.perf.brake * (S.wet > 0 ? lerp(1, 0.78, S.wet) : 1) + DRAG * v * v;
      v = Math.max(1.2, v - Math.min(decCap, (v - vt) * 14) * dt);
      this.brk = clamp((this.railV - v) / (decCap * dt || 1), 0, 1); this.thr = 0;
    }
    this.railV = v;

    // lateral: ease onto the intended line, but no faster than a car can change direction
    const want = this.aiWant != null ? this.aiWant : T.line[i];
    const latRate = clamp(6.5 + v * 0.06, 4, 13);
    const dOff = clamp(want - off, -latRate * dt, latRate * dt);
    off += dOff;
    off = clamp(off, -(T.half + T.roL[i] * 0.7 + 0.6), T.half + T.roR[i] * 0.7 + 0.6);
    if(Math.abs(off) > T.half + 1.0) v *= 1 - 0.30 * dt;        // off the road costs real time

    // advance along the ribbon, interpolating between nodes
    s = (s + v * dt) % T.length; if(s < 0) s += T.length;
    this.railS = s;
    const f = s / T.ds, j = ((Math.floor(f) % T.n) + T.n) % T.n, k = (j + 1) % T.n, u = f - Math.floor(f);
    this.node = j;
    const cx = lerp(T.x[j], T.x[k], u), cy = lerp(T.y[j], T.y[k], u);
    const nxi = lerp(T.nx[j], T.nx[k], u), nyi = lerp(T.ny[j], T.ny[k], u);
    this.x = cx + nxi * off;
    this.y = cy + nyi * off;
    this.z = lerp(T.z[j], T.z[k], u) + off * T.camber[j];
    this.off = off; this.railOff = off;
    this.s = s;
    // the nose follows the smoothed sideways speed, not the raw step: at a
    // standstill a tiny shuffle sideways used to swing the heading by tens of degrees
    this.latV = lerp(this.latV || 0, dOff / Math.max(dt, 0.001), 1 - Math.exp(-dt * 9));
    const steerAng = Math.atan2(this.latV, Math.max(v, 8)) * 0.6;
    this.h = T.ang[j] + angWrap(T.ang[k] - T.ang[j]) * u + clamp(steerAng, -0.4, 0.4);
    // just back on the line after driving itself out of trouble: the nose swings round to it, it does not jump
    if(this.hBlend > 0){ this.h += angWrap(h0 - this.h) * this.hBlend; this.hBlend = Math.max(0, this.hBlend - dt * 2.5); }
    this.vx = Math.cos(this.h) * v; this.vy = Math.sin(this.h) * v;

    // wear, heat, battery — driven by how hard the corner is
    const lat = Math.abs(T.lcurv[j]) * v * v;
    this.slide = lerp(this.slide, clamp(lat / (GRIP * 1.05) - 0.72, 0, 1), 0.18);
    const rattle = this.kerbRattle(T, off);
    this.kerbShake = rattle > 0 ? rattle : Math.max(0, this.kerbShake - dt * 4);
    if(this.boost > 0 && this.batt > 0.01) this.batt = clamp(this.batt - dt * 0.30, 0, 1);
    else this.batt = clamp(this.batt + dt * (this.brk > 0.2 ? 0.20 : 0.035), 0, 1);
    const load = tyreLoad(lat, this.brk);
    this.life = clamp(this.life - load * this.tyre.wear * S.wearMul * AERO.wearK(this) * this.su.wear * dt * 0.34, 0, 1);
    this.temp = clamp(this.temp + (lat * 0.0016 + v * 0.004 + AERO.heat(this) + this.su.heat - (this.temp - 0.35) * 0.55) * dt, 0, 1.2);
  }

  /* In the pit lane every car is driven by car/pitpilot.js; when it lets go, the car goes
     back to its rail (a rival) or to the driver (the player), at the speed it had. */
  pitStep(dt, S){
    if(!this.pp){ this.pitting = 0; return; }
    const done = pilotStep(this, S, dt, S.pitHooks);
    if(done){ const P = this.pp; pilotEnd(this, S); if(S.pitHooks && S.pitHooks.ended) S.pitHooks.ended(this, S, P); }
  }
}

// the engine's revs from the road speed, through eight gears 42 km/h apart (the HUD's tacho and the wheel's shift lights);
// the garage's gearing slider stretches the gears, so a long box spreads the same eight over more road
const GEAR_KPH = 42;
function gearOf(c){ return clamp(Math.ceil(c.speed * 3.6 / (GEAR_KPH * c.su.gearSpan)), 1, 8); }
function rpmOfCar(c){
  const span = GEAR_KPH * c.su.gearSpan, kph = c.speed * 3.6, gear = clamp(Math.ceil(kph / span), 1, 8);
  return 4200 + clamp((kph - (gear - 1) * span) / span, 0, 1) * 9200;
}

export { BRAKE, Car, DRAG, GRIP, LAUNCH_HI, LAUNCH_LO, VMAX, gearOf, rpmOfCar, tyreGripK, tyreLoad };
