/* Telemetry: the player's car is sampled ten times a second while it runs a lap. Each completed lap becomes a
   record { t, secs, samples, setup, tyre, ... }; the best and the latest lap per circuit are persisted
   (store "tele_<track>") so the garage can lay them over each other, with the best lap per setup beside them.
   Sample rows are [t, kph, thr, brk, steer, gear, temp, life, s] — see COL. */
import { store } from '../config/util.js';
import { gearOf } from '../car/physics.js';

const DT = 0.1, KEEP = 12, SAVE_DT = 0.2;
const COL = { t: 0, kph: 1, thr: 2, brk: 3, steer: 4, gear: 5, temp: 6, life: 7, s: 8 };
const r = (v, p) => { const k = Math.pow(10, p); return Math.round(v * k) / k; };

const laps = [];                                   // this session, newest last
function reset(){ laps.length = 0; }

function sample(S, c){
  const tl = c.tele || (c.tele = { buf: [], at: -1 });
  if(S.state !== "run" || c.lapStart == null || c.dnf) return;
  if(c.pitting || c.inPit || c.recovering){ tl.dirty = true; return; }       // a pit or recovery lap isn't a lap to learn from
  if(S.clock - tl.at < DT - 1e-6) return;          // epsilon: six 1/60 ticks sum to just under 0.1
  tl.at = S.clock;
  tl.buf.push([r((S.clock * 1000 - c.lapStart) / 1000, 2), Math.round(c.speed * 3.6), r(c.thr, 2), r(c.brk, 2),
               r(c.steer, 2), gearOf(c), r(c.temp, 2), r(c.life, 3), r((c.s || 0) / (S.track.length || 1), 4)]);
}
const startLap = c => { c.tele = { buf: [], at: -1 }; };

function stats(rows){
  if(!rows || rows.length < 5) return null;
  let top = 0, sum = 0, full = 0, brake = 0, coast = 0, topGear = 0, minV = 1e9, turn = 0;
  for(const q of rows){
    top = Math.max(top, q[COL.kph]); sum += q[COL.kph]; minV = Math.min(minV, q[COL.kph]);
    if(q[COL.thr] > 0.95) full++;
    if(q[COL.brk] > 0.2) brake++;
    if(q[COL.thr] < 0.05 && q[COL.brk] < 0.05) coast++;
    if(q[COL.gear] >= 8) topGear++;
    if(Math.abs(q[COL.steer]) > 0.35) turn++;
  }
  const n = rows.length, a = rows[0], z = rows[n - 1];
  return { top, avg: sum / n, min: minV, full: full / n, brake: brake / n, coast: coast / n,
           topGear: topGear / n, turn: turn / n,
           temp: rows.reduce((u, q) => u + q[COL.temp], 0) / n, wear: Math.max(0, a[COL.life] - z[COL.life]) };
}

/* A plain-English read of the lap for the garage screen: what the data says, and which slider it points at. */
function note(st, setup){
  if(!st) return "Run a clean lap and the engineer will have something to say.";
  const out = [];
  if(st.full > 0.62 && st.topGear > 0.12) out.push("Lots of time flat out in top gear: long gearing and low wing would suit this circuit.");
  else if(st.full < 0.38) out.push("You're rarely at full throttle: more downforce will carry speed through the corners.");
  if(st.brake > 0.2) out.push("Heavy on the brakes (" + Math.round(st.brake * 100) + "% of the lap). Brake bias forward calms the entry.");
  if(st.temp > 0.78) out.push("Tyres ran hot (" + Math.round(st.temp * 100) + "%): a harder pressure setting will cool them and save life.");
  else if(st.temp < 0.42) out.push("Tyres stayed cool; a softer pressure would bring more grip.");
  if(st.wear > 0.05) out.push("That lap cost " + Math.round(st.wear * 100) + "% of the tyre.");
  if(st.coast > 0.12) out.push("You're coasting for " + Math.round(st.coast * 100) + "% of the lap, the throttle or brake could be earlier.");
  if(setup && out.length === 0) out.push("Balanced lap. Change one slider at a time and compare against the best lap.");
  return out.slice(0, 3).join(" ");
}

/* Called as a lap is completed with a valid time `ms`. */
function finish(S, c, ms, setup){
  const tl = c.tele, buf = tl ? tl.buf : [];
  startLap(c);
  if(buf.length < 5 || tl.dirty || c.lapInvalid) return null;
  const rec = { t: ms, secs: c.secT.slice(), samples: buf, setup: setup ? { id: setup.id, name: setup.name } : null,
                tyre: c.tyre.key, wet: r(S.wet, 2), track: S.track.id, tm: Date.now() };
  rec.stats = stats(buf);
  laps.push(rec);
  while(laps.length > KEEP) laps.shift();
  persist(rec);
  return rec;
}

function thin(rec){
  const s = [], step = Math.max(1, Math.round(SAVE_DT / DT));
  rec.samples.forEach((q, i) => { if(i % step === 0 || i === rec.samples.length - 1) s.push(q); });
  return { ...rec, samples: s };
}
const key = id => "tele_" + id;
function persist(rec){
  const d = store(key(rec.track)) || { best: null, last: null, by: {} };
  d.last = thin(rec);
  if(!d.best || rec.t < d.best.t) d.best = thin(rec);
  const sid = rec.setup ? rec.setup.id : "std";
  d.by = d.by || {};
  if(!d.by[sid] || rec.t < d.by[sid].t) d.by[sid] = { t: rec.t, name: rec.setup ? rec.setup.name : "Standard", tyre: rec.tyre, tm: rec.tm };
  store(key(rec.track), d);
}
const forTrack = id => store(key(id)) || { best: null, last: null, by: {} };
const clearTrack = id => store(key(id), { best: null, last: null, by: {} });

export { COL, clearTrack, finish, forTrack, laps, note, reset, sample, startLap, stats };
