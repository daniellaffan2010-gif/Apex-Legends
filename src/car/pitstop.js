import { clamp } from '../config/util.js';
import { PARTS, TYRES } from './parts.js';

/* ---- a pit stop, second by second ------------------------------------------------
   Built the moment the car stops on its mark, and read by everything else: the car's
   own pose (jacks, wheels off and on), the crew, the release light, the HUD, the sound.
   Times are seconds from the car stopping (t = 0), as a real stop is timed:

     0.00        the car stops on the mark, the front jack man is already under the nose
     jackF/jackR the jacks are in and the car goes up, 5-6 cm
     per corner  gun on and the nut off (off), the old wheel out and the new one on (swap),
                 the nut done up and the gun's light on (on)
     drop        the last gun is done: the jacks come down
     green       the release light goes green (later if the fast lane is not clear)
     go          the car moves

   A good crew does it in a little over two seconds; every team has its own crew, and
   every stop can go wrong at one corner: a nut that will not start, a wheel that sticks.
   A stop to serve a time penalty waits that long first with nobody touching the car.
   A stop-and-go is ten seconds with nothing done at all. Repairs (a new nose, a floor)
   are done while the car is up, alongside the tyres, so the longest job sets the time. */

// how quick each team's crew is, on average, from stop to release (seconds; 2025-ish form)
const CREW = { mcl:2.15, rbr:2.15, fer:2.30, mer:2.40, wil:2.35, rbu:2.40, ast:2.45, haa:2.55, aud:2.55, alp:2.50, cad:2.65 };

const rnd = (a, b) => a + Math.random() * (b - a);

function planStop(c, opts){
  const o = opts || {}, team = c.team && c.team.id;
  const st = { t:0, wait:o.wait || 0, noWork:!!o.noWork, tyre:o.tyre || null, repairs:o.repairs || [], hold:0,
               oldTyre:c.tyre ? c.tyre.key : "medium", corners:[], slow:-1, pen:o.pen || null };
  if(st.noWork){
    // a stop-and-go: the car sits on the mark for ten seconds, untouched
    st.jackF = st.jackR = st.drop = Infinity; st.rep = {};
    for(let q = 0; q < 4; q++) st.corners.push({ off:Infinity, swap:Infinity, on:Infinity, none:true });   // the renderer and HUD index corners[q].none
    st.green = 10; st.go = 10.15;
    return st;
  }
  const w = st.wait;                                                      // a time penalty being served first
  const base = CREW[team] || 2.5;
  const k = (base - 0.38) / 1.08;                                         // jack, off, swap, on add up to 1.08 s at k = 1 (+0.38 s of drop, light and reaction): scale to this crew
  st.jackF = w + rnd(0.10, 0.18) * k;
  st.jackR = w + rnd(0.08, 0.15) * k;
  const up = Math.max(st.jackF, st.jackR);
  // what can go wrong, once a stop: 84 % clean, 11 % a slow corner, 4 % a nut that will not go, 1 % a proper problem
  const r = Math.random(), bad = r < 0.84 ? 0 : r < 0.95 ? rnd(0.5, 1.4) : r < 0.99 ? rnd(2.0, 5.0) : rnd(6, 11);
  const slowAt = bad > 0 ? Math.floor(Math.random() * 4) : -1;
  st.slow = slowAt; st.slowBy = bad;
  const tyres = !!st.tyre && st.tyre !== "none";
  for(let q = 0; q < 4; q++){
    // the guns go on as the car settles; off, swap, on, each a few tenths
    if(!tyres){ st.corners.push({ off:Infinity, swap:Infinity, on:up, none:true }); continue; }
    const off = up + rnd(0.18, 0.30) * k;
    const swap = off + rnd(0.30, 0.42) * k + (q === slowAt && bad < 2 ? bad : 0);
    const on = swap + rnd(0.28, 0.40) * k + (q === slowAt && bad >= 2 ? bad : 0);
    st.corners.push({ off, swap, on });
  }
  // repairs run alongside: the longest job decides it
  let rep = 0;
  st.rep = {};                                                            // each job's own window, for the animation
  for(const key of st.repairs){ const p = PARTS[key]; if(p && !p.tyre){ const d = p.fix * rnd(0.85, 1.05); rep = Math.max(rep, d); st.rep[key] = [up, up + d]; } }
  st.repairEnd = up + rep;
  const allOn = Math.max(...st.corners.map(q => q.on));
  st.drop = Math.max(allOn, st.repairEnd) + rnd(0.04, 0.10);
  st.green = st.drop + rnd(0.12, 0.22);
  st.go = st.green + rnd(0.10, 0.18);                                    // the driver's reaction to the light
  return st;
}

/* Where a stop is at time t: 0..1 progress of each job, for the pose and the crew.
   jack (0 down .. 1 up) per end, and per corner: 0 old wheel on, 1 old wheel off,
   2 new wheel on, 3 done; plus the light. */
function stopPose(st, out){
  const o = out || {};
  const t = st.t;
  const ease = (a, b) => clamp((t - a) / Math.max(1e-3, b - a), 0, 1);
  if(st.noWork){ o.jackF = o.jackR = 0; o.light = t >= st.green ? 1 : 0; o.c0 = o.c1 = o.c2 = o.c3 = 0; o.work = 0; return o; }
  const upF = ease(st.jackF - 0.12, st.jackF), upR = ease(st.jackR - 0.12, st.jackR), dn = ease(st.drop, st.drop + 0.10);
  o.jackF = upF * (1 - dn); o.jackR = upR * (1 - dn);
  for(let q = 0; q < 4; q++){
    const k = st.corners[q];
    o["c" + q] = k.none ? 0 : t < k.off ? 0 : t < k.swap ? 1 + ease(k.off, k.swap) * 0.999 : t < k.on ? 2 : 3;
  }
  o.light = t >= st.green + st.hold ? 1 : 0;
  o.work = t >= st.wait ? 1 : 0;
  return o;
}

/* a quick plan for a car the player is not driving: what tyre, which repairs */
function aiPlan(c){
  const repairs = [...(c.broken || [])].filter(k => PARTS[k] && !PARTS[k].tyre);
  return { tyre:(c.nextTyre || TYRES.medium).key, repairs };
}

export { CREW, planStop, stopPose, aiPlan };
