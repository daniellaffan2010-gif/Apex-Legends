import { showMsg, showToast } from '../ui/screens.js';
import { AUDIO } from '../audio/audio.js';
import { aiProfile } from '../ai/driver.js';

/* ---------- the stewards ----------
   Every penalty in the book that this game can see:
     warning · reprimand · 5 s · 10 s · drive-through · 10 s stop-and-go · disqualification
     grid-place drops · deleted laps (qualifying) · track limits (judged on the time an excursion gained)
   Drive-throughs and stop-and-gos are served in the pit lane within three laps; whatever is
   still owed at the flag, or can no longer be served, turns into time (20 s / 30 s).
   The player hears about their own through the message and the radio; the AI's arrive as steward notices. */

const K = {
  warn: { name:"Warning", pts:0 },
  rep:  { name:"Reprimand", pts:0 },
  t5:   { name:"5 second time penalty", short:"5s penalty", sec:5, pts:1, big:"5 SECOND PENALTY", say:"five second time penalty" },
  t10:  { name:"10 second time penalty", short:"10s penalty", sec:10, pts:2, big:"10 SECOND PENALTY", say:"ten second time penalty" },
  dt:   { name:"Drive-through penalty", short:"drive-through", conv:20, pts:2, big:"DRIVE-THROUGH PENALTY", say:"drive-through penalty" },
  sg:   { name:"10 second stop-and-go", short:"10s stop-go", conv:30, pts:3, big:"STOP-AND-GO PENALTY", say:"ten second stop and go" },
  dsq:  { name:"Disqualification", short:"DISQUALIFIED", pts:0, big:"BLACK FLAG", say:"disqualification" },
};

function st(c){
  return c.pen || (c.pen = { time:0, todo:[], reps:0, points:0, dsq:false, dsqReason:"", cool:-99, n:0,
                             exT:0, inEx:false, exVoid:false, exClock:0, exS:0, exV:0, blueT:0, blueSaid:false, lane:false, laneT:0, laneSpeed:false });
}

/* steward notices queue up, so two in a row are both read */
function notify(S, text, secs){
  (S.penQ || (S.penQ = [])).push({ text, secs:secs || 3.4 });
}
function pump(S, dt){
  S.penT = (S.penT || 0) + dt;
  if(S.penQ && S.penQ.length && S.penT >= (S.penNext || 0)){
    const m = S.penQ.shift();
    showToast(m.text, m.secs);
    S.penNext = S.penT + m.secs + 0.25;
  }
}
function radio(text){ try{ AUDIO.say(text, "eng", true); }catch(e){} }

function issue(S, c, kind, reason, opts){
  if(!S || !c || c.dnf || S.ended) return false;
  const p = st(c), me = c === S.player;
  if(p.dsq) return false;
  if(kind === "rep"){ p.reps++; if(p.reps >= 3){ kind = "dt"; reason = "Third reprimand — " + reason.toLowerCase(); } }
  const k = K[kind];
  p.n++; p.points += k.pts || 0;
  let line = k.name, small = reason, sec = 0, conv = 0;
  if(kind === "dt" || kind === "sg"){
    if(S.mode !== "race" || c.finished || c.lap >= S.laps){
      p.time += k.conv; sec = k.conv; line = k.name + " → +" + k.conv + " s (no time left to serve it)";
      small = reason + " · +" + k.conv + " s on your race time";
    } else {
      p.todo.push({ kind, by:c.lap + 3 }); conv = k.conv;
      small = reason + (me ? " · pit (P) within 3 laps" : "");
    }
  } else if(k.sec){ p.time += k.sec; sec = k.sec; p.serve = (p.serve || 0) + k.sec; }    // a time penalty can be served at the next stop
  else if(kind === "dsq"){ p.dsq = true; p.dsqReason = reason; }
  (S.penLog || (S.penLog = [])).push({ lap:Math.max(1, c.lap), abbr:c.drv.abbr, last:c.drv.last, me, text:line, reason, sec, conv, kind });
  if(me){
    if(kind === "warn") showMsg("WARNING", reason, 2.8);
    else if(kind === "rep") showMsg("REPRIMAND", reason, 3);
    else showMsg(k.big, small, 4.2);
    if(kind === "warn" || kind === "rep") radio("Stewards: " + k.name.toLowerCase() + ". " + reason + ".");
    else if(kind === "dsq") radio("You have been shown the black flag. " + reason + ".");
    else if(kind === "dt" || kind === "sg") radio("Stewards have given us a " + k.say + ". " + reason + ". Box within three laps.");
    else radio("Stewards have given us a " + k.say + ". " + reason + ".");
    if(p.points >= 12) notify(S, "12 penalty points on your licence — one-race ban", 4);
    if(kind === "dsq" && S.endNow) setTimeout(() => { if(!S.ended) S.endNow(); }, 1800);
  } else if(kind !== "warn"){
    notify(S, "STEWARDS · " + c.drv.abbr + " " + c.drv.last + " — " + (k.short || k.name) + " · " + reason, kind === "rep" ? 3 : 3.8);
  }
  return true;
}

/* ---- fault in a collision: whoever was behind, or whoever drove into the other ---- */
function contact(S, A, B, ux, uy, imp, ds2){
  if(S.mode !== "race" || S.state !== "run" || imp < 3.5) return;
  const ca = A.vx * ux + A.vy * uy, cb = -(B.vx * ux + B.vy * uy);     // each car's closing speed on the other
  let f = null, v = null;
  if(Math.abs(ds2) > 2.2){ f = ds2 > 0 ? A : B; v = f === A ? B : A; }  // clearly one behind the other
  else if(ca > cb * 1.4 && ca > 1){ f = A; v = B; }
  else if(cb > ca * 1.4 && cb > 1){ f = B; v = A; }
  if(!f || f.spinT > 0 || f.wrecked || f.pitting || f.inPit || v.spinT > 0 || v.wrecked) return;
  const p = st(f);
  if((S.penT || 0) - p.cool < 5) return;
  p.cool = S.penT || 0;
  const why = "Causing a collision with " + v.drv.last;
  if(imp < 6){
    if(Math.random() < 0.45) issue(S, f, "rep", why);
    else if(f === S.player || v === S.player) notify(S, "Contact with " + (f === S.player ? v : f).drv.last + " — noted, no further action", 2.6);
    return;
  }
  if(imp < 10) issue(S, f, "t5", why);
  else if(imp < 15) issue(S, f, "t10", why.replace("Causing a", "Causing a serious") );
  else if(imp < 22) issue(S, f, "dt", "Causing a serious collision with " + v.drv.last);
  else issue(S, f, p.n >= 2 ? "dsq" : "sg", "Dangerous driving — " + v.drv.last + " was caught up");
}

/* ---- lights out: a car that has jumped the start ---- */
function launch(S){
  if(S.mode !== "race") return;
  for(const c of S.cars){
    if(c === S.player){ if(c.revs > 0.985) issue(S, c, "t5", "False start — you moved before the lights went out"); }
    else if(Math.random() < 0.025) issue(S, c, "t5", "False start");
  }
}

/* ---- grid penalties for a few AI cars, decided before the grid forms ---- */
function gridDrops(order, entries, myIdx){
  const out = [];
  const why = [["Gearbox change", 5], ["Power unit change", 10], ["Impeding in qualifying", 3], ["Power unit change — new element", 20]];
  const n = Math.random() < 0.55 ? (Math.random() < 0.3 ? 2 : 1) : 0;
  for(let q = 0; q < n; q++){
    const cand = order.slice(0, 15).filter(x => x !== myIdx && !out.some(o => o.idx === x));
    if(!cand.length) break;
    const idx = cand[(Math.random() * cand.length) | 0];
    const w = why[(Math.random() * why.length) | 0];
    const at = order.indexOf(idx);
    order.splice(at, 1);
    order.splice(Math.min(order.length, at + w[1]), 0, idx);
    out.push({ idx, abbr:entries[idx].d.abbr, last:entries[idx].d.last, places:w[1], why:w[0] });
  }
  return out;
}
function announceGrid(S, drops){
  S.gridDrops = drops;
  for(const d of drops){
    notify(S, "GRID PENALTY · " + d.last + " drops " + (d.places >= 20 ? "to the back of the grid" : d.places + " places") + " — " + d.why, 3.6);
  }
}

/* ---- served in the pit lane ---- */
function nextServe(c){ return c.pen && c.pen.todo.length ? c.pen.todo[0] : null; }
function served(S, c, kind){
  const p = st(c), i = p.todo.findIndex(t => t.kind === kind);
  if(i < 0) return;
  p.todo.splice(i, 1);
  for(let j = (S.penLog || []).length - 1; j >= 0; j--){ const e = S.penLog[j]; if(e.kind === kind && e.me === (c === S.player) && e.abbr === c.drv.abbr && e.conv && !e.served){ e.served = true; break; } }
  (S.penLog || (S.penLog = [])).push({ lap:Math.max(1, c.lap), abbr:c.drv.abbr, last:c.drv.last, me:c === S.player,
                                       text:K[kind].name + " served", reason:"" });
  if(c === S.player){ showMsg("PENALTY SERVED", "Back to racing", 2.2); radio("Penalty served. Push."); }
  else notify(S, "STEWARDS · " + c.drv.abbr + " " + c.drv.last + " has served the " + K[kind].short, 3);
}

/* ---- the running checks ---- */
/* Track limits are judged on time, not on the white line. When a car goes out the stewards note the clock, its
   distance round the lap and its speed; when it rejoins they work out how long a racing-speed car (the AI's own
   speed profile, accelerating from the entry speed) would have taken over that same stretch and compare it with
   the time the car actually took. Only a car that came back quicker than that gained an advantage and is punished
   (race: +5 s) or has the lap deleted (qualifying). A spin, a wreck, the pit lane or crawling speed voids it. */
const ACC = 12, LIM_GAIN = 0.2;
function refTime(T, s0, dist, v0){
  const V = aiProfile(T), n = T.n; let t = 0, x = 0;
  while(x < dist){
    const dx = Math.min(T.ds, dist - x);
    const i = Math.floor((((s0 + x) % T.length) + T.length) % T.length / T.ds) % n;
    const v = Math.max(8, Math.min(V[i], Math.sqrt(v0 * v0 + 2 * ACC * x)));
    t += dx / v; x += dx;
  }
  return t;
}
function limits(S, c, dt){
  const T = S.track, p = st(c);
  const off = Math.abs(c.off);
  const out = off > T.half + 1.9 && !c.inPit && !c.pitting;
  const free = c.spinT > 0 || c.wrecked || c.speed < 22;
  if(out){
    if(p.exT === 0){ p.exClock = S.clock; p.exS = c.lap * T.length + c.s; p.exV = c.speed; p.exVoid = free; }
    else if(free) p.exVoid = true;
    p.exT += dt;
    if(p.exT > 0.3) p.inEx = true;
  } else if(off < T.half + 0.6){
    const race = S.mode === "race";
    if(p.inEx && !p.exVoid && !c.inPit && !c.pitting && (race || S.mode === "qualy") && c.lap >= (race ? 1 : 0)){
      const dist = c.lap * T.length + c.s - p.exS, took = S.clock - p.exClock;
      const gain = dist > 5 && dist < T.length * 0.5 ? refTime(T, p.exS, dist, p.exV) - took : 0;
      const me = c === S.player;
      if(gain >= LIM_GAIN){
        if(!race){
          if(!c.lapInvalid && c.lapStart != null){
            c.lapInvalid = true;
            if(me) showMsg("LAP DELETED", "Track limits — gained " + gain.toFixed(1) + " s, that one will not count", 2.8);
          }
        } else issue(S, c, "t5", "Leaving the track and gaining an advantage (" + gain.toFixed(1) + " s)");
      } else if(me && race) notify(S, "Track limits — no advantage gained, no penalty", 2.6);
    }
    p.inEx = false; p.exT = 0; p.exVoid = false;
  }
}

/* The pit lane's own offences are called where they happen: speeding at the speed-limit
   line (car/pit.js) and an unsafe release from the box (car/pitpilot.js through session.js). */
function pitLane(S, c, dt){
  const p = st(c);
  p.lane = !!(c.pitting || c.inPit);
}
/* A stop serves any time penalty owed: the car waits that long before anyone touches it,
   and the seconds come off what will be added to its race time. Returns the wait. */
function serveAtStop(S, c){
  const p = st(c), w = p.serve || 0;
  if(w <= 0) return 0;
  p.serve = 0; p.time = Math.max(0, p.time - w);
  (S.penLog || (S.penLog = [])).push({ lap:Math.max(1, c.lap), abbr:c.drv.abbr, last:c.drv.last, me:c === S.player,
                                       text:w + " s penalty served at the stop", reason:"" });
  if(c === S.player){ showMsg("SERVING " + w + " SECONDS", "Hands off until the time is up", 2.2); }
  return w;
}

function blue(S, c, dt){
  const T = S.track, p = st(c);
  let who = null;
  for(const o of S.cars){
    if(o === c || o.dnf || o.finished || o.pitting || o.lap <= c.lap) continue;
    const d = o.prog - c.prog;
    if(d > T.length - 90 && d < T.length + 10){ who = o; break; }
  }
  if(who){
    p.blueT += dt;
    if(!p.blueSaid && p.blueT > 0.8){
      p.blueSaid = true;
      showMsg("BLUE FLAG", who.drv.last + " is lapping you — let them through", 2.6);
      radio("Blue flag. " + who.drv.last + " wants to come through.");
    }
    if(p.blueT > 11){ issue(S, c, "t5", "Ignoring blue flags"); p.blueT = -14; p.blueSaid = false; }
  } else {
    p.blueT = Math.max(p.blueT < 0 ? p.blueT : 0, p.blueT - dt * 2);
    if(p.blueT <= 0) p.blueSaid = false;
  }
}

/* the AI now and then does something the stewards notice */
function aiIncident(S, c, dt){
  if((S.penT || 0) < 12 || c.finished || c.pitting || c.lap < 1) return;
  if(Math.random() >= 0.00018 * (0.55 + c.drv.aggr) * (1 + S.wet * 0.4) * dt) return;
  const nb = S.cars.filter(o => o !== c && !o.dnf && Math.abs(o.pos - c.pos) === 1);
  const o = nb.length ? nb[(Math.random() * nb.length) | 0] : null;
  const r = Math.random();
  if(r < 0.34) issue(S, c, "t5", o ? "Forcing " + o.drv.last + " off the track" : "Forcing another driver off the track");
  else if(r < 0.60) issue(S, c, "t5", o ? "Causing a collision with " + o.drv.last : "Causing a collision");
  else if(r < 0.76) issue(S, c, "t5", "Illegal defending — moving under braking");
  else if(r < 0.86) issue(S, c, "rep", "Driving with a lack of care");
  else if(r < 0.95) issue(S, c, "dt", "Dangerous driving");
  else issue(S, c, "sg", "Serious breach of the sporting regulations");
}

function tick(S, dt){
  pump(S, dt);
  if(S.state !== "run" || S.mode === "tt") return;
  for(const c of S.cars){
    if(c.dnf || c.finished) continue;
    const p = st(c);
    limits(S, c, dt);
    if(S.mode !== "race") continue;
    const sc = !!(S.sc && S.sc.state !== "off");
    pitLane(S, c, dt);
    if(c === S.player){ if(!sc) blue(S, c, dt); }
    else {
      if(c.penServedFlag){ c.penServedFlag = false; if(c.servePen){ served(S, c, c.servePen); c.servePen = null; } }
      if(!sc) aiIncident(S, c, dt);
      // the pit wall sends a penalised car down the lane, as a visit of its own
      const n = nextServe(c);
      if(n && !c.pitReq && !c.pitting && c.lap >= 1 && c.lap < S.laps){ c.pitReq = true; c.servePen = n.kind; c.nextTyre = c.tyre; }
    }
    // three laps to serve it, then it is time instead
    for(let i = p.todo.length - 1; i >= 0; i--){
      const t = p.todo[i];
      if(c.lap > t.by){
        p.todo.splice(i, 1); const k = K[t.kind]; p.time += k.conv;
        (S.penLog || (S.penLog = [])).push({ lap:c.lap, abbr:c.drv.abbr, last:c.drv.last, me:c === S.player,
                                             text:k.name + " not served → +" + k.conv + " s", reason:"" });
        if(c === S.player) showMsg("PENALTY NOT SERVED", "+" + k.conv + " s added to your race time", 3.4);
        else notify(S, "STEWARDS · " + c.drv.abbr + " never served the " + k.short + " — +" + k.conv + " s", 3.4);
      }
    }
  }
}

/* ---- the classification: penalty seconds added, unserved stops converted ---- */
function owed(c){
  const p = c.pen; if(!p) return 0;
  let s = p.time;
  for(const t of p.todo) s += K[t.kind].conv;
  return s;
}
function classify(S, arr){
  const T = S.track, ms = S.clock * 1000;
  const est = c => c.finished ? c.finishTime : ms + Math.max(0, (S.laps + 1) * T.length - c.prog) / Math.max(30, c.speed) * 1000;
  let run = 0, any = false;
  const items = arr.map((c, i) => {
    run = Math.max(run, est(c));
    const pen = owed(c); if(pen > 0) any = true;
    return { c, pen, base:i, key:run + pen * 1000, t:run };
  });
  if(!any) return { order:arr.slice(), any:false, key:new Map(), pen:new Map() };
  items.sort((a, b) => (a.key - b.key) || (a.base - b.base));
  const key = new Map(), pen = new Map();
  for(const it of items){ key.set(it.c, it.key); pen.set(it.c, it.pen); }
  return { order:items.map(it => it.c), any:true, key, pen };
}

/* the line under the clock in the HUD */
function hudLine(S, c){
  const p = c.pen; if(!p) return "";
  const out = [];
  if(p.time) out.push("+" + p.time + " s");
  for(const t of p.todo) out.push((t.kind === "dt" ? "DRIVE-THROUGH" : "STOP-GO 10 s") + " · by lap " + Math.min(t.by, S.laps));
  if(p.points) out.push(p.points + " pts");
  return out.join("  ·  ");
}

export { K, announceGrid, classify, contact, gridDrops, hudLine, issue, launch, nextServe, notify, owed, served, serveAtStop, st, tick };
