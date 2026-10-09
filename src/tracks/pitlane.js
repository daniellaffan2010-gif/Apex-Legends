import { clamp } from '../config/util.js';
import { TEAMS } from '../config/teams.js';

/* ---- the pit lane, as the regulations lay it out --------------------------------
   The lane itself is still the strip beside the road that buildTrack widens between
   T.pitIn and T.pitOut. What this adds is everything that makes it a real pit lane:

   - A speed limit: 80 km/h, 60 at Monaco and Zandvoort (def.pit.limit, in km/h).
   - The speed-limit lines: the limit holds only between them (a zone up to about 560 m long,
     def.pit.limitLen), with the boxes inside it. Before the first line the driver brakes
     for it; after the second the car is free to accelerate up the exit road.
   - Two lanes across it: the fast lane by the pit wall, where cars travel, and the
     working lane by the garages, where every team has its own box.
   - A box for every team, about 14 m apart, in last year's constructors' order with the
     champions nearest the exit (nobody drives past their release). Each box is the spot
     the car's centre stops on; the garage, the painted box, the board over it and the
     crew are all laid out from this one table.

   Distances along the lap are metres (T.s), positions across it are offsets from the
   centreline like everything else (positive = T.pitSide * metres out). */
const ORDER = ["mcl", "mer", "rbr", "fer", "wil", "rbu", "ast", "haa", "aud", "alp", "cad"];   // 2025 standings, champions first
const BOX_GAP = 14;            // metres between boxes
const FAST = 2.4, WORK = 5.6;  // lane centres, metres out from the road edge (the lane is T.pitW = 7.6 wide)

function addPitLane(T){
  const def = T.def || {}, PD = def.pit || {}, n = T.n, ds = T.ds, L = T.length || n * ds;
  T.pitLimit = (PD.limit || 80) / 3.6;
  T.pitFastOff = FAST; T.pitWorkOff = WORK;
  // node index (fractional) <-> metres along the lap
  const sOf = f => ((f % n) + n) % n * ds;
  const fOf = s => ((s / ds) % n + n) % n;
  T.pitSOf = sOf; T.pitFOf = fOf;
  // metres from the pit entry along the lane (0 .. span), for a lap position in metres
  const s0 = T.pitIn * ds, span = T.pitSpan * ds;
  T.pitLen = span;
  T.pitAlong = s => ((s - s0) % L + L) % L;
  // the lane's full-width stretch (the ramps take the first and last 14 %)
  const full0 = span * 0.16, full1 = span * 0.84;
  // the boxes: a block of 11, centred on def.pit.box but kept inside the full-width stretch
  const nb = ORDER.length, block = (nb - 1) * BOX_GAP;
  let mid = T.pitAlong(T.pitBox * ds);
  if(mid > span) mid = span / 2;
  mid = clamp(mid, full0 + block / 2 + 8, full1 - block / 2 - 8);
  if(full1 - full0 < block + 16) mid = (full0 + full1) / 2;                 // a very short lane: squeeze in the middle
  const first = mid + block / 2;                                            // the champions, nearest the exit
  T.pitBoxes = ORDER.map((id, k) => {
    const team = TEAMS.find(t => t.id === id) || TEAMS[k % TEAMS.length];
    const a = first - k * BOX_GAP, s = (s0 + a) % L;
    return { team, id:team.id, k, a, s, f:fOf(s) };
  });
  // any team not in the list (a mod, a renamed id) gets a box at the entry end
  for(const t of TEAMS) if(!T.pitBoxes.some(b => b.id === t.id)){
    const k = T.pitBoxes.length, a = first - k * BOX_GAP, s = (s0 + a) % L;
    T.pitBoxes.push({ team:t, id:t.id, k, a, s, f:fOf(s) });
  }
  T.boxOf = team => T.pitBoxes.find(b => b.id === (team && team.id ? team.id : team)) || T.pitBoxes[0];
  // the limit zone: about def.pit.limitLen metres round the boxes, inside the lane
  const want = PD.limitLen || 560, lo = first - block, hi = first;
  const extra = Math.max(60, (want - block) / 2);
  T.pitLimA = clamp(lo - extra, span * 0.04, lo - 40);                      // metres along the lane
  T.pitLimB = clamp(hi + extra, hi + 40, span * 0.96);
  T.pitLimS0 = (s0 + T.pitLimA) % L; T.pitLimS1 = (s0 + T.pitLimB) % L;
  T.pitInLimit = s => { const a = T.pitAlong(s); return a >= T.pitLimA && a <= T.pitLimB; };
  // the lane centres across, eased in and out with the ramps (fractional node)
  const ramp = f => { const i = Math.floor(((f % n) + n) % n), j = (i + 1) % n, u = f - Math.floor(f);
                      return T.pitRamp(i) * (1 - u) + T.pitRamp(j) * u; };
  T.pitRampF = ramp;
  T.pitFast = f => T.pitSide * (T.half + FAST * Math.min(1, ramp(f) / 0.6));
  T.pitWork = f => T.pitSide * (T.half + WORK * Math.min(1, ramp(f) / 0.85));
  // T.pitBox stays the middle of the block, for anything that only wants "the pits"
  T.pitBox = Math.round(fOf(s0 + mid)) % n;
  return T;
}

export { addPitLane, ORDER, BOX_GAP, FAST, WORK };
