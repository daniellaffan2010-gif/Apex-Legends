import { clamp, lerp, angWrap } from '../config/util.js';
import { PARTS, TYRES } from './parts.js';
import { planStop, aiPlan } from './pitstop.js';
import { AUDIO } from '../audio/audio.js';

/* ---- driving the pit lane ----------------------------------------------------------
   Every car in the lane is driven by this, the player's too (from the speed-limit line
   to the exit line, as the pit assist in an F1 game does), so they all behave the same:

     entry   (rivals only) down the entry road from wherever the car was on the track,
             easing across and braking to reach the limit at the line
     lane    on the limiter in the fast lane, keeping a car's length and a bit from
             whoever is in front
     box     turning into its own team's box in the working lane, braking, and stopping
             with the car's centre on the mark; a team-mate already there means waiting
             in the fast lane just short of the box until it has gone (double stacking)
     stopped the stop itself (car/pitstop.js): jacks, four wheels, release light; held on
             red while a car is coming down the fast lane
     out     pulling back out into the fast lane on the limiter
     exit    past the second line: off the limiter, up the exit road and back onto the
             track (rivals), or handed back to the driver (the player)

   State lives in c.pp. Positions are metres along the lap (a: metres down the lane
   from the entry, for lane geometry) and offsets across it. */
const GAP = 9.5;            // the gap kept to the car in front (a car is 5.6 m)
const BRAKE_BOX = 11;       // m/s² into the box: 80 km/h to nothing in about 22 m
/* Into the box late and out of it sharply, as the cars really do: boxes are 14 m apart, so a car may only start
   across once it is past the car stopped in the box behind, and must be back in the fast lane before it reaches
   the one in front (9 m in at up to about 25 degrees, 7.5 m out). */
const TURN_IN = 9, STRAIGHT = 1.0, PULL_OUT = 7.5, QUEUE = 12;   // a car double stacking waits in the fast lane, 12 m short of its box
const ease = x => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };

function laneS(c){
  // metres along the lap of where the car is now
  const T = c.T, i = c.node, al = (c.x - T.x[i]) * T.tx[i] + (c.y - T.y[i]) * T.ty[i];
  return ((T.s[i] + al) % T.length + T.length) % T.length;
}

/* start driving a car down the lane. who: "ai" from the pit entry, "player" at the first speed-limit line */
function pilotStart(c, S, who, plan){
  const T = S.track, s = laneS(c), box = T.boxOf(c.team);
  const pen = plan && plan.pen ? plan.pen : null;
  const stop = !(plan && plan.none) && pen !== "dt";
  c.pp = { who, s, a:T.pitAlong(s), v:c.speed, off:c.off, from:c.off, a0:T.pitAlong(s), phase:who === "ai" ? "entry" : "lane",
           box, stop, plan:plan || null, pen, st:null, stopA:null, relA:null, held:0, lead:null };
  c.pitting = 1; c.inPit = true;
}

/* the offset across the lane this car wants at lane distance a (peek: just asking, for somewhere ahead) */
function latFor(c, T, a, peek){
  const P = c.pp, f = T.pitFOf(T.pitSOf(T.pitIn) + a);
  const fast = T.pitFast(f);
  let lat = fast;
  if(P.stopA != null && P.relA == null && P.stopA >= P.box.a - 0.5){
    // the turn-in only ever goes one way: a car that has started across stays on its way (a target that moves
    // up, from the queue spot to the box, never swings it back out into the fast lane)
    const work = T.pitWork(f);
    const k = Math.max(P.turnK || 0, ease((a - (P.stopA - STRAIGHT - TURN_IN)) / TURN_IN));
    if(!peek) P.turnK = k;
    lat = lerp(fast, work, k);
  } else if(P.relA != null){
    const work = T.pitWork(f);
    lat = lerp(work, fast, ease((a - P.relA) / PULL_OUT));
  }
  // a rival coming off the track eases across from wherever it was (over at least 30 m, past the line if the entry road is short)
  if(P.who === "ai"){
    const L = Math.max(30, T.pitLimA - P.a0 - 10);
    if(a < P.a0 + L) lat = lerp(P.from, lat, ease((a - P.a0) / L));
  }
  return lat;
}

function place(c, T, a, lat){
  const L = T.length, s = (T.pitSOf(T.pitIn) + a) % L, f = s / T.ds;
  const j = ((Math.floor(f) % T.n) + T.n) % T.n, k = (j + 1) % T.n, u = f - Math.floor(f);
  c.node = j;
  c.x = lerp(T.x[j], T.x[k], u) + lerp(T.nx[j], T.nx[k], u) * lat;
  c.y = lerp(T.y[j], T.y[k], u) + lerp(T.ny[j], T.ny[k], u) * lat;
  c.z = lerp(T.z[j], T.z[k], u);
  c.off = lat; c.s = s;
  return s;
}

/* the box it is heading for: its own, or the spot behind it while a team-mate is in it */
function boxTarget(c, S){
  const P = c.pp, T = S.track;
  // a team-mate that has the box: stopped in it, or heading for it and further down the lane than this car
  const mate = S.cars.find(o => o !== c && o.pp && o.pp.box === P.box && o.pp.stop && o.pp.stopA === P.box.a && o.pp.relA == null && !o.dnf &&
                                (o.pp.phase === "stopped" || o.pp.a > P.a));
  return mate ? P.box.a - QUEUE : P.box.a;
}

/* Would pulling out of the box now cut across someone? The car needs about two seconds to get across into the
   fast lane and moving; anything moving down the lane that would reach it inside that time, anything alongside,
   and anything just released or being released from a box behind (it goes first) holds the light on red.
   Only cars that are moving or about to are counted, so a car waiting on a hold can never be holding this one. */
function laneTraffic(c, S, a){
  const T = S.track;
  for(const o of S.cars){
    if(o === c || o.dnf || !o.pp || !o.pitting) continue;
    const d = a - o.pp.a;                                         // > 0: it is behind this box
    if(d < -6.5 || d > 80) continue;
    // (a car already being held is not "going now": that is what keeps two holds from waiting on each other)
    const goingNow = o.pp.phase === "out" || (o.pp.phase === "stopped" && o.pp.st && !(o.pp.held > 0.05) && o.pp.st.t >= o.pp.st.green + o.pp.st.hold - 0.3);
    if(d <= 0){ if(o.pp.v > 0.5 || o.pp.phase === "queue") return o; continue; }   // alongside or just past and moving, or waiting in the way
    if(goingNow && d < 25) return o;
    if(o.pp.v > 0.5 && d - o.pp.v * 2.0 < 9 && Math.abs(o.pp.off - T.pitFast(T.pitFOf(T.pitSOf(T.pitIn) + o.pp.a))) < 2.2) return o;
  }
  return null;
}

/* Is car o in this car's way? Only if this car's own path, over the stretch where their bodies would overlap
   lengthwise, comes within a car's width of where o is (or, for a car pulling out of its box, of the fast lane
   it is heading for). So a car pulling out is not held up by one stopped in the working lane ahead, one turning
   in is not held up by the fast lane, and a car never drives through one it is overlapping already. */
const WIDE = 2.6, LONG = 6.0;
function inTheWay(c, T, a, o){
  const oa = o.pp.a;
  if(oa <= a) return false;
  const lats = [o.pp.off];
  if(o.pp.phase === "out") lats.push(T.pitFast(T.pitFOf(T.pitSOf(T.pitIn) + oa)));
  const a1 = Math.max(a, oa - LONG);
  for(const q of [a1, (a1 + oa) / 2, oa]){
    const mine = q <= a + 0.01 ? c.pp.off : latFor(c, T, q, true);
    for(const ol of lats) if(Math.abs(mine - ol) < WIDE) return true;
  }
  return false;
}

function finishWork(c, S){
  const P = c.pp, plan = P.plan || {};
  if(P.done) return;
  P.done = true;
  if(P.st && P.st.noWork) return;
  const fitted = plan.tyre && plan.tyre !== "none" ? TYRES[plan.tyre] : null;
  if(fitted){
    c.tyre = fitted; c.used.add(fitted.key); c.life = 1; c.temp = 0.45;
    if(c.broken.has("punct")){ c.broken.delete("punct"); if(c.health) c.health.punct = 1; }
    c.wearRate = null; c.lifeAtLap = null;
  }
  for(const k of (plan.repairs || [])){ c.broken.delete(k); if(c.health) c.health[k] = 1; }
  if(plan.repairs && plan.repairs.length){ c.wheelOff = c.wheelOff2 = -1; }
  if(c.recalcPerf) c.recalcPerf();
  c.damage = Math.max(0, c.damage - (plan.repairs && plan.repairs.length ? 0.5 : 0));
  c.stops++;
}

/* one frame of a car in the lane. Returns true when the car has left the lane's care. */
function pilotStep(c, S, dt, hooks){
  const T = S.track, P = c.pp, lim = T.pitLimit;
  if(!P) return true;
  let v = P.v, a = P.a;
  // --- where it is going and how fast it may go there ---
  let vmax;
  if(P.phase === "entry"){
    // brake to reach the limit at the line (16 m/s², hard but not a lock-up), from whatever it arrived at
    vmax = Math.sqrt(lim * lim + 2 * 16 * Math.max(0, T.pitLimA - a));
    if(a >= T.pitLimA){ P.phase = "lane"; }
  }
  if(P.phase === "lane" || P.phase === "box"){
    vmax = lim;
    if(P.stop && P.relA == null){
      const want = boxTarget(c, S);
      if(P.stopA !== want){ P.stopA = want; }
      if(a > P.stopA - STRAIGHT - TURN_IN - 30) P.phase = "box";
      vmax = Math.min(vmax, Math.sqrt(2 * BRAKE_BOX * Math.max(0, P.stopA - a)) + 0.4);
      if(P.stopA - a < 0.08 && v < 1.6){
        a = P.stopA; v = 0;
        if(P.stopA < P.box.a - 0.5){ P.phase = "queue"; P.stacked = true; }
        else {
          P.phase = "stopped";
          const plan = P.plan || {};
          P.st = planStop(c, { tyre:plan.tyre, repairs:plan.repairs || [], noWork:P.pen === "sg", wait:plan.wait || 0, pen:P.pen });
          if(hooks && hooks.stopped) hooks.stopped(c, S, P);
        }
      }
    }
    if(P.phase === "lane" && a > T.pitLimB) P.phase = "exit";
  }
  if(P.phase === "queue"){
    // waiting behind a team-mate: creep up the moment the box is free
    vmax = 0;
    if(boxTarget(c, S) === P.box.a){ P.phase = "box"; P.stopA = P.box.a; vmax = 3; }
  }
  if(P.phase === "stopped"){
    vmax = 0; v = 0;
    const st = P.st;
    st.t += dt;
    if(!P.done && st.t >= st.drop) finishWork(c, S);
    if(st.t >= st.green + st.hold - 0.3){
      // the light is about to go green: a last look up the fast lane. The release waits for a car
      // coming down it, except, once in a while, when the button goes a moment early: an unsafe release
      const traffic = laneTraffic(c, S, a);
      if(traffic){
        if(P.unsafe == null) P.unsafe = Math.random() < 0.025;
        if(!P.unsafe){ st.hold += dt; P.held += dt; }
        else if(!P.unsafeDone){ P.unsafeDone = true; if(hooks && hooks.unsafe) hooks.unsafe(c, S, traffic); }
      }
    }
    if(st.t >= st.go + st.hold){
      if(!P.done) finishWork(c, S);
      P.phase = "out"; P.relA = a;
      if(hooks && hooks.released) hooks.released(c, S, P);
    }
  }
  if(P.phase === "out"){
    vmax = lim;
    if(a > P.relA + PULL_OUT + 4) P.phase = "lane";
  }
  if(P.phase === "exit"){
    // off the limiter: up the exit road and back to racing speed
    vmax = P.who === "ai" ? 60 : lim;
  }
  // --- the car in front, in the same lane, sets a ceiling ---
  if(P.phase !== "stopped" && P.phase !== "queue"){
    let gapMin = 1e9, lead = null;
    for(const o of S.cars){
      if(o === c || o.dnf || !o.pp || !o.pitting) continue;
      const d = o.pp.a - a;
      if(d <= 0 || d > 60) continue;
      // a car still coming in off the track may be anywhere across the entry road
      if(!(P.phase === "entry" || o.pp.phase === "entry" ? Math.abs(o.pp.off - P.off) < 4.5 : inTheWay(c, T, a, o))) continue;
      // the real distance between them: on a lane that curves round a hairpin, metres of centreline are not metres of lane
      const g = Math.hypot(o.x - c.x, o.y - c.y);
      if(g < gapMin){ gapMin = g; lead = o; }
    }
    if(lead){
      // close up to a gap of GAP; inside it, fall back behind it (a car that came in nose to tail with it)
      vmax = Math.min(vmax, gapMin >= GAP ? lead.pp.v + (gapMin - GAP) * 1.6 : lead.pp.v * clamp((gapMin - 6.2) / (GAP - 6.2), 0, 0.95));
    }
    P.lead = lead;
    // waiting on a team-mate in the box: double stacking
    if(lead && lead.pp.box === P.box && lead.pp.phase === "stopped" && v < 0.5) P.stacked = true;
  }
  // --- speed: brake hard, pull away briskly ---
  if(vmax < v) v = Math.max(vmax, v - (P.phase === "entry" || (P.lead && vmax < P.lead.pp.v) ? 24 : 16) * dt);
  else v = Math.min(vmax, v + (P.phase === "exit" ? 9 : 7) * dt);
  if(v < 0.02 && vmax <= 0) v = 0;
  /* v is the car's own speed; a counts centreline metres, which on the inside of a curve are longer than the
     lane's (and shorter on the outside), so advance by what this offset turns v into */
  {
    const f0 = T.pitFOf(T.pitSOf(T.pitIn) + a), j0 = Math.floor(f0) % T.n;
    const k = 1 - (P.off || 0) * (T.curv[j0] || 0);
    a += v * dt / clamp(k, 0.3, 2.5);
  }
  if(P.phase === "box" && P.stopA != null && a > P.stopA) a = P.stopA;
  // --- across the lane, and the pose that goes with it ---
  const lat = latFor(c, T, a);
  const lat2 = latFor(c, T, a + 0.8);
  P.a = a; P.v = v; P.off = lat;
  const s = place(c, T, a, lat);
  // the heading from the path itself, so a turn into the box looks like one
  const f = s / T.ds, j = ((Math.floor(f) % T.n) + T.n) % T.n, k = (j + 1) % T.n, u = f - Math.floor(f);
  const ang = T.ang[j] + angWrap(T.ang[k] - T.ang[j]) * u;
  const nxs = lerp(T.nx[j], T.nx[k], u), nys = lerp(T.ny[j], T.ny[k], u);
  const dx = Math.cos(ang) * 0.8 + nxs * (lat2 - lat), dy = Math.sin(ang) * 0.8 + nys * (lat2 - lat);
  if(v > 0.05 || P.phase === "box") c.h = Math.atan2(dy, dx);
  c.vx = Math.cos(c.h) * v; c.vy = Math.sin(c.h) * v;
  c.thr = v < vmax - 0.2 ? 1 : 0; c.brk = v > vmax + 0.2 || (P.phase === "box" && v > 0.1 && vmax < v + 2) ? 1 : 0;
  c.steer = 0; c.boost = 0; c.slide = 0; c.inPit = true;
  // --- the hand-back ---
  if(P.who === "player" && P.phase === "exit") return true;
  if(P.who === "ai" && P.phase === "exit" && (T.pitRampF(f) <= 0.04 || T.pitU(j) < 0 || a >= T.pitLen - 2)) return true;
  return false;
}

/* hand a car back: a rival to its rail, the player to the physics, moving as it was */
function pilotEnd(c, S){
  const P = c.pp; if(!P) return;
  c.pitting = 0;
  if(c.ai){
    c.railS = c.s; c.railV = P.v; c.railOff = c.off; c.aiWant = c.off; c.aiWantS = c.off; c.inPit = false; c.pitReq = false;
    c.latV = 0; c.hBlend = 0;
  } else {
    c.vx = Math.cos(c.h) * P.v; c.vy = Math.sin(c.h) * P.v;
  }
  c.pp = null;
}

export { pilotStart, pilotStep, pilotEnd, laneS, aiPlan, GAP };
