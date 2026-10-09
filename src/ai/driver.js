import { obstacles, passLine } from '../game/recovery.js';
import { angWrap, clamp, lerp } from '../config/util.js';
import { AUDIO } from '../audio/audio.js';
import { BRAKE, DRAG, GRIP, VMAX, tyreGripK, tyreLoad } from '../car/physics.js';
import { TYRES } from '../car/parts.js';
import * as AERO from '../car/aero.js';

/* ---------- 4. AI --------------------------------------------------------- */
// The rail followers track their own speed in railV; the player's car does not,
// so asking for railV on a human-driven car reads a stale zero.
function carSpeed(o){ return (o.ai && o.railV != null) ? o.railV : o.speed; }


/* Where the next corner is, which side is its inside, and how slow it gets.
   The apexes are the local minima of the speed profile that are clearly slower
   than the road either side; the sign of the curvature there is the inside
   (right-handers are positive, and the racing line sits on that side). */
function cornerAhead(T, i){
  let C = T._corners;
  if(!C){
    const n = T.n, vp = T.vprof, W = Math.max(4, Math.round(120 / T.ds)), ap = [];
    for(let k = 0; k < n; k++){
      let mn = true, hi = 0;
      for(let q = -W; q <= W; q++){ const v = vp[(k + q + n) % n]; if(q && v < vp[k] - 1e-6){ mn = false; break; } if(v > hi) hi = v; }
      if(mn && vp[k] < hi * 0.8 && Math.abs(T.curv[k]) > 0.004 && (!ap.length || k - ap[ap.length - 1] > 6)) ap.push(k);
    }
    const dist = new Float32Array(n).fill(1e5), side = new Int8Array(n), vmin = new Float32Array(n).fill(200), apex = new Int32Array(n).fill(-1);
    if(ap.length) for(let k = 0; k < n; k++){
      let best = -1, bd = 1e9;
      for(const a of ap){ const d = (a - k + n) % n; if(d < bd){ bd = d; best = a; } }
      dist[k] = bd * T.ds; side[k] = Math.sign(T.curv[best]) || 0; vmin[k] = vp[best]; apex[k] = best;
    }
    C = T._corners = { dist, side, vmin, apex };
  }
  return { dist:C.dist[i], side:C.side[i], vmin:C.vmin[i], apex:C.apex[i] };
}

/* The rivals' own speed profile, built from the same limits the player's car
   has: full grip on the racing line, the real brakes, no padding. T.vprof is
   the cautious one the camera, the sound and the corner finder read; this one
   is how fast the line can actually be driven. Speeds are along the centre
   line (that is how the rail followers move), so a corner taken on a shorter
   inside line gets a little extra. No acceleration pass: the engine limits
   the rivals on the way out of a corner exactly as it limits the player. */
const aiBrake = () => BRAKE * 0.93;                // leave the controller a hair of margin
function aiProfile(T){
  if(T._aiProf) return T._aiProf;
  const n = T.n, px = i => T.x[i] + T.nx[i] * T.line[i], py = i => T.y[i] + T.ny[i] * T.line[i];
  const r = new Float64Array(n), V = new Float64Array(n);
  for(let i = 0; i < n; i++){ const b = (i + 1) % n; r[i] = clamp(Math.hypot(px(b) - px(i), py(b) - py(i)) / T.ds, 0.7, 1.3); }
  for(let i = 0; i < n; i++){
    // a touch of smoothing, so a kink in the line is not a reason to brake
    const a = (i - 1 + n) % n, b = (i + 1) % n;
    const k = (Math.abs(T.lcurv[a]) + 2 * Math.abs(T.lcurv[i]) + Math.abs(T.lcurv[b])) / 4 + 1e-6;
    V[i] = Math.min(VMAX * 1.06, Math.sqrt(GRIP * (1 + T.bank[i] * 1.8) / k));
  }
  /* Through a run of sweepers the limit ripples up and down. A driver holds
     one speed there rather than accelerating for twenty metres and braking
     again, so flatten every peak narrower than ~80 m (min, then max, filter:
     the dips themselves stay exactly where they were). */
  const w = Math.max(1, Math.round(40 / T.ds)), lo = new Float64Array(n);
  for(let i = 0; i < n; i++){ let m = Infinity; for(let q = -w; q <= w; q++) m = Math.min(m, V[(i + q + n) % n]); lo[i] = m; }
  for(let i = 0; i < n; i++){ let m = 0; for(let q = -w; q <= w; q++) m = Math.max(m, lo[(i + q + n) % n]); V[i] = Math.min(V[i], m); }
  for(let p = 0; p < 3; p++)
    for(let i = n - 1; i >= 0; i--){ const b = (i + 1) % n;
      V[i] = Math.min(V[i], Math.sqrt(V[b] * V[b] + 2 * (aiBrake() + DRAG * V[b] * V[b]) * T.ds * r[i])); }
  for(let i = 0; i < n; i++) V[i] /= r[i];
  return (T._aiProf = V);
}

/* How much tyre one lap at racing speed takes off, at wear multiplier 1:
   the session sets its wear multiplier from this so a compound lasts the
   same share of a race on every circuit, whatever the lap is like. */
function lapWearLoad(T){
  if(T._lapLoad) return T._lapLoad;
  const V = aiProfile(T), n = T.n;
  let sum = 0;
  for(let i = 0; i < n; i++){
    const v = Math.max(V[i] * 0.97, 8), brk = V[(i + 1) % n] < V[i] - 0.05 ? 1 : 0;
    sum += tyreLoad(Math.abs(T.lcurv[i]) * v * v, brk) * (T.ds / v) * 0.34;
  }
  return (T._lapLoad = sum);
}
// the share of the tyre a whole race takes, per point of compound wear: a soft
// (1.95) is past its best around half distance, a medium nearer three quarters
const RACE_WEAR = 0.78;
function wearMulFor(T, laps){ return RACE_WEAR / (Math.max(1, laps) * lapWearLoad(T)); }
// laps of racing a set of this compound gives before it is worth changing
function stintLaps(tyre, S, T){ return 0.72 / (tyre.wear * S.wearMul * lapWearLoad(T)); }

/* the pit wall's call: which compound to bolt on for the laps that are left */
function chooseTyre(c, S){
  if(S.wetTarget > 0.4 && S.wet > 0.3) return TYRES.wet;
  const left = Math.max(1, S.laps - c.lap);
  const opts = [TYRES.soft, TYRES.medium, TYRES.hard];
  // the softest set that gets to the flag, with a little in hand; else the longest-lasting
  for(const t of opts) if(stintLaps(t, S, c.T) >= left * 1.05) return t;
  return opts[opts.length - 1];
}

/* ---- off the line: a rival that has spun, or been knocked off, drives itself back ----
   No reset. It is on the full car physics (the same as the player's), so it can slide into a wall, get stuck in the
   gravel, take damage and lose parts. It turns round if it is facing the wrong way, backs off a wall it is nosed
   into, waits off the road for traffic, and only goes back to following the line once it is on the road, pointing
   down it and moving. If it cannot get going again it is out. */
function freeDrive(c, S, dt){
  const T = c.T, i = c.node, v = c.speed, L = T.length;
  c.freeT = (c.freeT || 0) + dt; c.boost = 0; c.hand = 0;
  // progress along the lap, to tell beached from merely slow
  let ds = c.s - (c.freeS != null ? c.freeS : c.s); if(ds > L / 2) ds -= L; else if(ds < -L / 2) ds += L;
  c.freeProg = Math.max(c.freeProg || 0, ds);
  if(c.freeT > 30 && c.freeProg < 40 && c !== S.player){ c.retire(S, T.surfAt && T.surfAt(i, c.off) === "gravel" ? "Beached in the gravel" : "Stuck — could not rejoin"); return; }
  const onRoad = Math.abs(c.off) < T.half - 0.4;
  const trackErr = angWrap(T.ang[i] - c.h);
  // aim back at the line a little way down the road
  const look = Math.round((9 + Math.max(v, 0) * 0.7) / T.ds), j = (i + look) % T.n;
  const offT = clamp(lerp(c.off, T.line[j], onRoad ? 0.7 : 0.45), -(T.half - 1.5), T.half - 1.5);
  const tx = T.x[j] + T.nx[j] * offT, ty = T.y[j] + T.ny[j] * offT;
  const err = angWrap(Math.atan2(ty - c.y, tx - c.x) - c.h);
  let vt = Math.abs(trackErr) > 1.9 ? 5 : Math.abs(err) > 0.6 ? 9 : onRoad ? 30 : 15;
  // rejoining: off the road, wait for anyone coming
  // (only for a car that would be there within three seconds, and never for more than eight seconds in all)
  if(!onRoad && (c.waitT || 0) < 8){
    let wait = false;
    for(const o of S.cars){
      if(o === c || o.dnf || o.pitting || o.aiFree) continue;
      let d = c.s - o.s; if(d > L / 2) d -= L; else if(d < -L / 2) d += L;
      if(d > 0 && o.speed > 20 && d / o.speed < 3){ wait = true; break; }
    }
    if(wait){ c.waitT = (c.waitT || 0) + dt; vt = Math.min(vt, Math.abs(c.off) > T.half + 1.5 ? 0 : 3); }
  }
  // nosed into a wall and not moving: back off it, turning the other way
  if(c.revT > 0) c.revT -= dt;
  else if(c.wallHit > 0.5 && v < 1.5 && Math.abs(err) > 0.5) c.revT = 1.4;
  c.wallHit = Math.max(0, (c.wallHit || 0) - dt * 2);
  const rev = c.revT > 0;
  const want = rev ? -clamp(err * 2, -1, 1) : clamp(err * 2.2, -1, 1);
  c.steer += clamp(want - c.steer, -5 * dt, 5 * dt);
  const fwd = c.vx * Math.cos(c.h) + c.vy * Math.sin(c.h);
  if(rev){ c.thr = 0; c.brk = fwd > 0.4 ? 1 : 0.8; }
  else if(fwd < vt - 1){ c.thr = !onRoad && v < 5 ? 1 : Math.abs(c.steer) > 0.6 ? 0.45 : 0.7; c.brk = 0; }   // flat out to crawl off the grass
  else if(fwd > vt + 2){ c.thr = 0; c.brk = 0.5; }
  else { c.thr = 0.2; c.brk = 0; }
  // back on the road, pointing down it and moving: back to the line from exactly here
  if(onRoad && Math.abs(trackErr) < 0.12 && v > 6 && !rev){
    c.aiFree = false; c.freeT = 0; c.waitT = 0;
    c.railS = null; c.railV = v; c.railOff = c.off; c.aiWant = c.off; c.aiWantS = c.off;
    c.aiOff = c.off - T.line[i]; c.latV = 0; c.hBlend = 1;
  }
}

/* a wheel gone: it cannot race on. It slows, pulls off to the side it can reach, and stops there */
function limp(c, S, dt){
  const T = c.T, i = c.node;
  c.limpT = (c.limpT || 0) + dt; c.boost = 0;
  const side = Math.sign(c.off) || (T.roR[i] > T.roL[i] ? 1 : -1);
  c.aiWant = clamp(side * (T.half + 1.4), -(T.half + 2), T.half + 2); c.aiWantS = c.aiWant;
  c.aiTargetV = Math.max(0, 16 - c.limpT * 3);
  if(c.limpT > 6 || (Math.abs(c.off) > T.half + 0.8 && carSpeed(c) < 4)) c.retire(S, "Lost a wheel");
}

function driveAI(c, S, dt){
  const T = c.T, i = c.node, v = carSpeed(c);
  if(c.pitting) return;
  if(c.aiFree || c.spinT > 0){ if(c.spinT <= 0) freeDrive(c, S, dt); return; }
  if(c.wheelOff >= 0 || c.wheelOff2 >= 0){ limp(c, S, dt); return; }
  const kNow = Math.abs(T.curv[i]);
  const look = Math.max(2, Math.round(clamp((10 + v * 0.46) / (1 + kNow * 40), 9, 56) / T.ds));
  const ti = (i + look) % T.n;

  // --- pace: the line's own limit, scaled by the grip this car has right now ---
  // (read a fraction of a second ahead, so the brakes go on at the board, not after it)
  const P = aiProfile(T), sNow = c.railS != null ? c.railS : c.s;
  const fi = (((sNow + v * 0.06) / T.ds) % T.n + T.n) % T.n, j0 = Math.floor(fi), j1 = (j0 + 1) % T.n;
  const vline = lerp(P[j0], P[j1], fi - j0);
  const wetK = S.wet > 0 ? lerp(1, c.tyre.key === "wet" ? 0.93 : 0.68, S.wet) : 1;
  const gripK = tyreGripK(c) * wetK * c.perf.grip * c.pace * (1 - c.damage * 0.22) * AERO.gripK(c);   // dirty air: brakes earlier, corners slower
  const topV = VMAX * c.pace * c.perf.top * AERO.topK(c) * (c.boost > 0 && c.batt > 0.02 && c.perf.boost ? 1.055 : 1);
  let vt = Math.min(topV, vline * Math.sqrt(gripK) * S.aiScale * (1 + c.mistake * 0.05));
  // under the safety car the field runs to a delta, well off the limit (a little freer once the car is in)
  if(S.sc && S.sc.state !== "off") vt = Math.min(vt, vline * (S.sc.car ? 0.66 : 0.88));

  // --- traffic: who is in front, who is hounding us ---
  let ahead = null, gap = 1e9, behind = null, bgap = 1e9;
  const halfLap = T.length / 2;
  for(const o of S.cars){
    if(o === c || o.dnf || o.pitting) continue;
    let d = o.s - c.s;
    if(d > halfLap) d -= T.length; else if(d < -halfLap) d += T.length;
    if(d > 0 && d < 140 && Math.abs(o.off - c.off) < 6.5){ if(d < gap){ gap = d; ahead = o; } }
    else if(d <= 0 && d > -42){ if(-d < bgap){ bgap = -d; behind = o; } }
  }
  // the safety car is traffic too, while it is on the road
  const scc = S.sc && S.sc.car && !S.sc.car.inLane ? S.sc.car : null;
  if(scc){
    let d = scc.s - c.s;
    if(d > halfLap) d -= T.length; else if(d < -halfLap) d += T.length;
    if(d > 0 && d < 140 && Math.abs(scc.off - c.off) < 6.5 && d < gap){ gap = d; ahead = scc; }
  }
  // a stopped wreck, or the truck recovering it: an obstacle to go round (it is flagged stalled)
  for(const o of obstacles(S)){
    let d = o.s - c.s;
    if(d > halfLap) d -= T.length; else if(d < -halfLap) d += T.length;
    if(d > -1 && d < 140 && Math.abs(o.off - c.off) < o.r + 3.6 && d < gap){ gap = Math.max(0.5, d); ahead = o; }
  }

  /* --- racing: the car in front, and the car behind --- */
  const D = S.combat || { defend:0.6, aggr:0.9, push:0.01, lunge:1 };
  const tight = T.half < 6.6 ? 0.5 : 1;        // there is nowhere to go on a street circuit
  if(c.prevRacePos != null && c.pos > c.prevRacePos) c.attackT = 10;   // just been passed — go get it back
  c.prevRacePos = c.pos;
  if(c.attackT > 0) c.attackT -= dt;
  if(c.defCool > 0) c.defCool -= dt;
  const avenging = c.attackT > 0 && S.mode === "race";
  // The first seconds are a scramble into turn one: hold the line, no moves
  const scOn = !!(S.sc && S.sc.state !== "off");
  const racing = S.mode === "race" && S.clock > 9 && !scOn;
  // the next corner: how far, which side is the inside, and whether we are braking for it
  const cn = cornerAhead(T, i);
  const brakeDist = Math.max(0, (v * v - cn.vmin * cn.vmin) / (2 * 26)) + 14;
  const inBrake = cn.dist < brakeDist;           // the corner's own braking zone, not braking for traffic
  // anyone at our elbow: side by side is about room, not about lines
  let elbow = null;
  for(const o of S.cars){
    if(o === c || o.dnf || o.pitting) continue;
    let d = o.s - c.s;
    if(d > halfLap) d -= T.length; else if(d < -halfLap) d += T.length;
    if(Math.abs(d) < 5.5 && Math.abs(o.off - c.off) < 4.4){ elbow = o; break; }
  }

  let passDir = 0, avoid = null;
  if(ahead){
    const av = carSpeed(ahead);
    const lane = scOn || Math.abs(ahead.off - c.off) < 3.6;      // are we actually behind them? (behind the safety car, everyone is)
    const respect = 8 + v * 0.26;
    const mine = c.pace * c.drv.skill * (0.86 + 0.14 * c.life);
    const theirs = ahead.pace * ahead.drv.skill * (0.86 + 0.14 * ahead.life);
    const quicker = mine > theirs * 0.998;
    // a car that has crashed, spun or stopped is an obstacle, not a rival to follow
    const stricken = ahead.stalled === true;
    // the real slipstream (aero.js) lifts topV; a driver in the tow also commits to the run past — this is what breaks a train up
    if(c.tow > 0.15 && v > 52 && kNow < 0.0045 && lane) vt *= 1 + (0.012 + D.push) * c.tow;
    if(avenging) vt *= 1 + D.push;                        // dig in while the place is fresh

    if(stricken){
      // take whichever side has the most road, measured from where THEY are stopped
      const roomL = (T.half - 1.8) - ahead.off, roomR = ahead.off + (T.half - 1.8);
      passDir = roomL > roomR ? 1 : -1;
      if(ahead.r){
        // a wreck or a recovery truck: the gap that clears everything there, or stop short if there is none
        const po = passLine(S, ahead, c.off);
        if(po == null){ c.passOff = c.off; vt = Math.min(vt, Math.max(0, (gap - ahead.r - 2.6) * 0.9)); }
        else { c.passOff = po; passDir = Math.sign(po - ahead.off) || passDir; }
      }
      avoid = ahead;
      if(lane && gap < 70) vt = Math.min(vt, Math.max(T.vprof[i] * 0.55, av + 12));
    } else if(lane){
      const bold = c.drv.aggr * D.aggr;
      // anyone quicker, anyone closing, and the bold ones always have a go
      const closing = v > av + 1.5;
      const willTry = racing &&
        ((T.half > 6.4 ? quicker : mine > theirs * 1.004) || closing || avenging || bold > 0.72);
      if(S.mode !== "race"){ if(gap < respect){ vt = Math.min(vt, av * 0.97); passDir = ahead.off > 0 ? -1 : 1; } }
      else if(willTry && gap < respect * (1 + 1.1 * tight)){
        // Line up the move on the straight, before the braking zone: the inside
        // of the next corner if there is one coming, else whichever side is open.
        // Once it is too late to set it up, wait for the next straight.
        // room to set it up: at least a second before the braking point
        const setUp = cn.dist > 320 || cn.dist - brakeDist > v * 1.0;
        if(!c.lungeSide && !inBrake && setUp){
          const inside = cn.dist < 300 ? cn.side : 0;
          const wantSide = inside || (ahead.off > 0 ? -1 : 1);
          const target = clamp(ahead.off + wantSide * 3.6, -(T.half - 1.8), T.half - 1.8);
          let busy = false;
          for(const o of S.cars){
            if(o === c || o === ahead || o.dnf || o.pitting) continue;
            let d2 = o.s - c.s;
            if(d2 > halfLap) d2 -= T.length; else if(d2 < -halfLap) d2 += T.length;
            if(d2 > -12 && d2 < 38 && Math.abs(o.off - target) < 4.2){ busy = true; break; }
          }
          // the defender has already taken that side: no move to make there
          if(!busy && !(ahead.defMove && ahead.defMove.side === wantSide && gap < 18)) c.lungeSide = wantSide;
        }
        if(c.lungeSide){ passDir = c.lungeSide; vt = Math.min(vt, av + 3 + D.aggr * 2); }
      } else if(gap < respect){
        c.lungeSide = 0;
        vt = Math.min(vt, av * clamp(0.98 + 0.02 * (gap / respect), 0.94, 1));
      } else if(gap > respect * 2.4) c.lungeSide = 0;
    } else if(gap > respect * 2.4) c.lungeSide = 0;
    // once committed, stay committed until the move is finished
    if(c.lungeSide && gap < respect * 1.5) passDir = c.lungeSide;
    // the dive: alongside or nearly, on the inside, into the braking zone. The
    // car that has the inside gets to brake a touch later; the car on the
    // outside lets it through rather than squeezing it.
    if(c.lungeSide && c.lungeSide === cn.side && gap < 6 && cn.dist < brakeDist + 40 && Math.abs(ahead.off - c.off) > 1.4){
      vt *= 1 + 0.028 * clamp(c.drv.aggr * D.aggr, 0.4, 1.3);
    }
    // only hold station behind someone while still in their lane; once alongside, go
    if(lane){
      const clearing = stricken && Math.abs(c.off - ahead.off) > (ahead.r ? ahead.r + 1.6 : 2.2);
      const press = passDir ? 0.5 : 1;          // committed to a move: close right up
      // sit right on their gearbox: a fifth of a second, plus the room to scrub off any speed difference
      const desired = (5 + v * 0.17 + Math.max(0, (v * v - av * av) / (2 * aiBrake()))) * press * (scOn ? 1.7 : 1);
      if(gap < desired) vt = Math.min(vt, Math.max(clearing ? 11 : 3, av - (desired - gap) * 2.0));
    } else if(gap < 7 && Math.abs(ahead.off - c.off) < 5.2){
      vt = Math.min(vt, Math.max(8, av * 1.03));         // wheel to wheel: edge past, don't barge
    }
    // a failed move: fell back or went past the corner without getting there
    if(c.lungeSide && (gap > respect * 2.4 || (inBrake && gap > 14 && !elbow)))c.lungeSide = 0;
  } else c.lungeSide = 0;

  /* --- defending, to the regulations: ONE move, made on the straight, never
         under braking, and always leave the attacker a car's width --- */
  let defend = 0;
  const bv = behind ? carSpeed(behind) : 0;
  const underThreat = behind && bgap < 19 && (bv > v + 0.6 || bgap < 10);
  if(c.defMove){
    const dm = c.defMove; dm.t += dm.t >= 0 ? dt : 0;
    const gone = !behind || bgap > 26;
    dm.gone = gone ? (dm.gone || 0) + dt : 0;
    // finished: through the corner they were defending, or the threat has gone, or held long enough
    if(dm.t > 9 || dm.gone > 1.2 || (dm.apex != null && cn.apex !== dm.apex && cn.dist > 40)){ c.defMove = null; c.defCool = 5; }
  } else if(underThreat && racing && !inBrake && !elbow && !(c.defCool > 0) && Math.random() < D.defend * tight * dt * 2.5){
    // take the inside line for the coming corner, which is what a defender does;
    // with no corner coming, cover the side they are on. Never into a car.
    const inside = cn.dist < 320 ? cn.side : 0;
    const side = inside || (behind.off > c.off ? 1 : -1);
    if(!((behind.off - c.off) * side > 3.0)) c.defMove = { side, t:0, apex:cn.apex };   // they are already well out there: nothing to cover
  }
  if(c.defMove){
    // a car's width must stay free between us and the edge; ease the move in over half a second
    const keep = Math.max(0, T.half - 3.6), dm = c.defMove;
    defend = dm.side * Math.min(2.8, keep) * clamp(c.drv.aggr * D.aggr, 0.3, 1.2) * clamp(dm.t / 0.6, 0, 1);
  }
  const room = T.half - (avoid ? 1.2 : 2.0);
  const lunge = Math.min(3.9, T.half * 0.52) * (S.combat ? S.combat.lunge : 1);
  const legalDef = Math.max(0, T.half - 3.6);      // leave them room to exist
  let targetOff = avoid ? (avoid.r ? clamp(c.passOff != null ? c.passOff : c.off, -room, room) : clamp(avoid.off + passDir * Math.max(4.0, lunge), -room, room))
                  : passDir ? clamp(T.line[ti] + passDir * lunge, -room, room)
                  : clamp(T.line[ti] + defend, -legalDef, legalDef);
  // nobody moves sideways into a car that is at their elbow: hold where we are
  if(elbow && !avoid){
    const toward = Math.sign(targetOff - c.off), there = Math.sign(elbow.off - c.off);
    if(toward && toward === there) targetOff = c.off;
  }
  c.aiOff = lerp(c.aiOff, targetOff - T.line[ti], dt * (avoid ? 4.2 : 2.0));
  let want = clamp(T.line[ti] + c.aiOff, -(T.half - 1.4), T.half - 1.4);
  const edge = T.half - 1.9;
  if(Math.abs(c.off) > edge) want -= Math.sign(c.off) * Math.min(3.4, (Math.abs(c.off) - edge) * 1.6);

  for(const o of S.cars){
    if(o === c || o.dnf || o.pitting) continue;
    let d = o.s - c.s;
    if(d > halfLap) d -= T.length; else if(d < -halfLap) d += T.length;
    const sep = Math.min(5.2, T.half * 0.94);
    if(Math.abs(d) < 7.5 && Math.abs(o.off - c.off) < sep){
      // Push apart smoothly. A hard sign flip at equal offsets made two cars
      // side by side swap their targets every frame and shake; here the push
      // fades to nothing at a tie, and the car index breaks the tie the same
      // way for both so they part rather than chase.
      const rel = c.off - o.off;
      const dir = Math.abs(rel) < 0.05 ? ((c.idx || 0) > (o.idx || 0) ? 0.5 : -0.5) : clamp(rel / 1.2, -1, 1);
      // the car with the inside keeps it; the one outside gives way
      want += dir * (sep - Math.abs(rel)) * 1.35 * (o.lungeSide && o.lungeSide === cn.side && o.s > c.s - 2 ? 1.25 : 1);
    }
  }
  want = clamp(want, -(T.half - 1.2), T.half - 1.2);
  // and never let the target jump from one frame to the next
  c.aiWantS = c.aiWantS == null ? want : lerp(c.aiWantS, want, 1 - Math.exp(-dt * 7));
  want = c.aiWantS;
  if(c.momentT > 0){
    c.momentT -= dt;
    if(c.momentKind === "lock") vt *= 0.88;
    else if(c.momentKind === "wide"){
      vt *= 1.07;
      const spill = T.half * 0.8 + Math.min(T.runoff, 3.5) * 0.4;
      want = clamp(want + c.momentSide * spill, -(T.half + 1.6), T.half + 1.6);
    }
  } else if(kNow > 0.004 && !scOn){
    const rate = (1.03 - c.drv.skill) * 0.016 * (1 + S.wet * 1.2) *
                 (1 + (1 - c.life) * 0.9) * (1 + c.damage * 1.5);
    if(Math.random() < rate * dt){
      c.momentT = 0.5 + Math.random() * 0.8;
      c.momentKind = Math.random() < 0.5 ? "lock" : "wide";
      c.momentSide = -Math.sign(T.curv[i]) || 1;
      // some of them are not saved: a lock-up or a slide that ends in a spin
      c.momentSpin = S.clock > 6 && v > 35 && Math.random() < 0.14 + S.wet * 0.3 + c.damage * 0.2 + (1 - c.life) * 0.15;
      try{ AUDIO.event("moment", c, S); }catch(e){}
      if(S.player && Math.abs(c.pos - S.player.pos) <= 2)
        S.toast(c.drv.last + (c.momentKind === "lock" ? " locks up" : " runs wide"));
    }
  }
  // a real mistake: the car gets away from them in a corner and goes round
  if(S.mode === "race" && S.state === "run" && c.spinT <= 0 && !c.inPit && v > 35 && S.clock > 6 && !scOn){
    const end = c.momentSpin && c.momentT <= 0;
    const rate = kNow > 0.006 ? (1.04 - c.drv.skill) * 0.011 * (1 + S.wet * 3) * (1 + (1 - c.life) * 1.2) * (1 + c.damage * 2) : 0;
    if(end || Math.random() < rate * dt){
      c.momentSpin = false;
      c.lastSpinWhy = "mistake"; c.startSpin(S, (Math.sign(T.curv[i]) || 1) * (3.2 + Math.random() * 1.8));
      c.momentT = 0;
      try{ AUDIO.event("moment", c, S); }catch(e){}
      if(S.player && !S.player.dnf && Math.abs(c.pos - S.player.pos) <= 3) S.toast(c.drv.last + " spins!");
    }
  }
  /* Called in: over the last few hundred metres it moves across to the pit side of the road and
     brakes so as to reach the speed limit at the line (car/pitpilot.js takes it from the entry). */
  let vtPit = Infinity;
  if(c.pitReq && S.mode === "race" && T.pitLimit){
    const toIn = (((T.pitIn - i) % T.n + T.n) % T.n) * T.ds;
    if(toIn < 380 && T.pitU(i) < 0){
      want = lerp(want, T.pitSide * (T.half - 1.3), clamp((380 - toIn) / 200, 0, 1));
      vtPit = Math.sqrt(T.pitLimit * T.pitLimit + 2 * 15 * (toIn + T.pitLimA));
      // another car heading in just ahead: drop in behind it, so they come down the entry road in single file
      for(const o of S.cars){
        if(o === c || o.dnf || !(o.pitReq || o.pitting)) continue;
        let d = o.s - c.s; if(d < -T.length / 2) d += T.length; if(d > T.length / 2) d -= T.length;
        if(d > 0 && d < 30) vtPit = Math.min(vtPit, Math.max(10, o.speed - 3 + (d - 16) * 0.6));
      }
    }
  }
  c.aiWant = want;
  c.aiTargetV = Math.min(vt * Math.sqrt(c.perf.grip), vtPit);
  c.mistake = lerp(c.mistake, (Math.random() - 0.5) * (1.04 - c.drv.skill) * 1.4, dt * 2.4);
  const straight = T.vprof[ti] > 74;
  c.boost = (straight && c.batt > 0.2 && v > 30 && (gap < 90 || c.batt > 0.6)) ? 1 : 0;
  c.hand = 0;

  /* pit call. Each car has its own idea of how far to run a set (some go
     early for the undercut, some stretch it); it watches what the last lap
     took off the tyres, and comes in when the next lap would take them past
     that. Nobody stops on the final lap, everybody makes the mandatory stop. */
  if(S.mode !== "race" || c.pitReq || c.lap < 1 || c.lap >= S.laps) return;
  if(c.wearLap !== c.lap){
    if(c.wearLap === c.lap - 1 && c.lifeAtLap != null && c.lifeAtLap > c.life) c.wearRate = c.lifeAtLap - c.life;
    c.wearLap = c.lap; c.lifeAtLap = c.life;
  }
  if(c.pitAt == null) c.pitAt = 0.22 + ((c.idx * 7) % 11) / 10 * 0.16;    // 0.22 .. 0.38 life left
  const perLap = c.wearRate || c.tyre.wear * S.wearMul * lapWearLoad(T) * 1.05;
  const lapsLeft = S.laps - c.lap;                       // full laps after this one
  const canFinish = c.life - perLap * (lapsLeft + 0.5) > 0.12;
  const owesStop = S.mustPit && c.stops === 0;
  let box = false;
  if(c.life - perLap * 1.1 < c.pitAt && (!canFinish || owesStop)) box = true;
  if(owesStop && lapsLeft <= 1) box = true;                // last chance to make the stop
  if(c.broken.size && lapsLeft > 1) box = true;
  if(S.wetTarget > 0.4 && S.wet > 0.45 && c.tyre.key !== "wet" && lapsLeft > 0) box = true;
  if(box){ c.pitReq = true; c.nextTyre = chooseTyre(c, S); }
}


export { aiProfile, driveAI, wearMulFor };
