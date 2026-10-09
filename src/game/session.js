import { $, TAU, clamp, fmtTime, lerp, store } from '../config/util.js';
import { TEAMS } from '../config/teams.js';
import { PARTS, TYRES } from '../car/parts.js';
import { TRACKS } from '../tracks/index.js';
import { buildTrack } from '../tracks/build.js';
import { Car, LAUNCH_HI, LAUNCH_LO } from '../car/physics.js';
import { contactTorque } from '../car/damage.js';
import { CINE } from '../render3d/cine.js';
import { G3 } from '../render3d/g3.js';
import { driveAI, wearMulFor } from '../ai/driver.js';
import { CAM_LOW, ISX, ISY, R, ZS } from '../render2d/view.js';
import { renderWorld } from '../render2d/world.js';
import { PART, spawn, stepParts } from '../render2d/particles.js';
import { drawMini } from '../ui/minimap.js';
import { KEY, TOUCH, ZOOM_HOLD } from '../input/input.js';
import { AI_SCALE, CFG, COMBAT } from '../config/settings.js';
import { playerPit, callPit } from '../car/pit.js';
import { pilotStart, aiPlan } from '../car/pitpilot.js';
import * as PEN from './penalties.js';
import * as SC from './safetycar.js';
import * as AERO from '../car/aero.js';
import * as Garage from './garage.js';
import * as Tele from './telemetry.js';
import * as REC from './recovery.js';
import { AUDIO } from '../audio/audio.js';
import { show, showMsg, showToast } from '../ui/screens.js';
import { buildBoard, updateHUD } from '../ui/hud.js';
import { showResults } from '../ui/results.js';
import { applyChampionship, saveRecord } from '../ui/championship.js';

/* ---------- 6. session ---------------------------------------------------- */

let S = null, paused = false, lastT = 0, hudT = 0;

let SESSION_N = 0;
/* What the pit lane tells the rest of the game (car/pitpilot.js calls these) */
const PIT_HOOKS = {
  stopped(c, S, P){
    try{ AUDIO.event(c.ai ? "pitstop" : "stop", c, S); }catch(e){}
    if(!c.ai) showToast(P.pen === "sg" ? "Stop-and-go — ten seconds, hands off" : "Stopped — crew working");
  },
  released(c, S, P){
    const t = P.st ? P.st.t : 0;
    c.lastStop = t;
    if(P.pen === "sg"){ PEN.served(S, c, "sg"); c.servePen = null; }
    if(!c.ai){
      try{ AUDIO.event("away", c, S, t.toFixed(1) + " seconds, P" + c.pos + "."); }catch(e){}
      const slow = P.st && P.st.slowBy > 1.5 ? " — a wheel stuck" : P.st && P.st.slowBy > 0 ? " — a slow corner" : "";
      showToast("Away · " + t.toFixed(1) + "s" + (P.held > 0.3 ? " · held for traffic" : "") + slow);
    }
  },
  unsafe(c, S, o){ if(S.mode === "race") PEN.issue(S, c, "t5", "Unsafe release into the path of " + o.drv.last); },
  ended(c, S, P){ if(P.pen === "dt"){ PEN.served(S, c, "dt"); c.servePen = null; } },
};

function startSession(mode, champ){
  Tele.reset();
  if(S && S.cine) CINE.end(G3, S);
  $("#cine").hidden = true;
  const def = TRACKS.find(t => t.id === CFG.trackId) || TRACKS[0];
  const T = buildTrack(def);
  const laps = mode === "race" ? def.laps[CFG.lapsIdx] : mode === "qualy" ? 4 : 99;
  const rnd = Math.random();
  const wetTarget = CFG.weather === "wet" ? 1 : CFG.weather === "dry" ? 0 : (rnd < def.rain ? 0.55 + Math.random() * 0.45 : 0);

  S = { track:T, mode, laps, cars:[], clock:0, state:"lights", lights:0, wet:0, wetTarget,
        uid:T.id + "#" + (++SESSION_N),
        // tyres last the same share of a race on every circuit and at every length
        wearMul:wearMulFor(T, mode === "race" ? laps : 12),
        aiScale:AI_SCALE[CFG.diff], combat:COMBAT[CFG.diff], shake:0, champ:!!champ,
        mustPit:mode === "race", assistLine:!!CFG.line, damage:!!CFG.damage,
        finishOrder:[], ended:false, ghost:null, ghostCar:null, rec:[], bestRec:null,
        toast:msg => showToast(msg), pitHooks:PIT_HOOKS };

  // field
  const entries = [];
  for(const t of TEAMS) for(const d of t.drivers) entries.push({ t, d });
  const myIdx = entries.findIndex(e => e.t.id === CFG.teamId && e.d === (TEAMS.find(t => t.id === CFG.teamId).drivers[CFG.drvIdx]));
  // grid order: pace-based with a shuffle, then the player's chosen slot
  const order = entries.map((e, i) => ({ i, k:e.t.pace * e.d.skill + Math.random() * 0.011 }))
                       .sort((a, b) => b.k - a.k).map(o => o.i);
  if(mode === "race" && !champ){
    const want = CFG.grid === 0 ? 0 : CFG.grid === 1 ? 10 : 20;
    const at = order.indexOf(myIdx); order.splice(at, 1); order.splice(want, 0, myIdx);
  }
  if(champ && champ.grid){
    const g = champ.grid.map(a => entries.findIndex(e => e.d.abbr === a));
    order.length = 0; for(const x of g) if(x >= 0) order.push(x);
    for(let i = 0; i < entries.length; i++) if(!order.includes(i)) order.push(i);
  }
  const drops = mode === "race" ? PEN.gridDrops(order, entries, myIdx) : [];
  S.gridAbbr = order.map(x => entries[x].d.abbr);
  const single = mode === "tt";
  const list = single ? [myIdx] : order;

  list.forEach((ei, slot) => {
    const e = entries[ei], c = new Car(e.t, e.d, slot, T);
    c.ai = ei !== myIdx;
    // every car finds a slightly different window each weekend
    c.pace = e.t.pace * (0.985 + e.d.skill * 0.015) * (0.9955 + Math.random() * 0.009);
    c.tyre = wetTarget > 0.4 ? TYRES.wet : (c.ai ? (slot % 3 === 0 ? TYRES.soft : slot % 3 === 1 ? TYRES.medium : TYRES.hard) : TYRES[CFG.tyre]);
    c.nextTyre = c.tyre.key === "soft" ? TYRES.hard : TYRES.soft;
    c.used.add(c.tyre.key);
    const back = single ? 0 : slot * 8.6;
    const node = single ? 0
      : mode === "race" ? (((T.n - Math.round((14 + back) / T.ds)) % T.n) + T.n) % T.n
      : Math.round(T.n * slot / list.length) % T.n;
    c.place(node, (single || mode !== "race") ? T.line[node] : (slot % 2 ? 2.7 : -2.7) * (T.half > 6 ? 1 : 0.7));
    if(mode !== "race"){ const vv = T.vprof[node] * 0.8; c.railV = vv;
      c.vx = Math.cos(c.h) * vv; c.vy = Math.sin(c.h) * vv; }
    c.pos = slot + 1;
    if(!c.ai){ c.su = Garage.fitted(); c.setup = Garage.selected(); S.player = c; }
    S.cars.push(c);
  });
  if(mode !== "race"){ S.state = "run"; S.lights = 5; }
  S.endNow = endSession;
  SC.init(S);
  if(drops.length) PEN.announceGrid(S, drops);
  PART.length = 0;
  S.marks = [];
  try{ AUDIO.init(); AUDIO.resume(); AUDIO.reset(); }catch(e){}
  R.camX = 0; R.camY = 0;
  R.userZoom = 1; R.userZoomT = 99;
  S.launchCam = mode === "race" ? 1 : 0;
  R.isx = lerp(ISX, CAM_LOW.isx, S.launchCam);
  R.isy = lerp(ISY, CAM_LOW.isy, S.launchCam);
  R.zs  = lerp(ZS,  CAM_LOW.zs,  S.launchCam);
  const [cx, cy] = isoOf(S.player);
  R.camX = cx; R.camY = cy;
  $("#hud").hidden = false;
  $("#touch").hidden = !("ontouchstart" in window || navigator.maxTouchPoints > 0);
  show(null);
  buildBoard();
  hudT = 0;
  showMsg(mode === "race" ? T.name.toUpperCase() : mode === "qualy" ? "QUALIFYING" : "TIME TRIAL",
          mode === "race" ? `${laps} laps · ${(T.length / 1000).toFixed(3)} km · pit stop required` : T.loc, 2.2);
}
function isoOf(c){ return [(c.x - c.y) * R.isx, (c.x + c.y) * R.isy - c.z * R.zs]; }

function partColor(h, broken){
  if(broken) return "#FF4B3E";
  h = clamp(h, 0, 1);
  const mix = (a, b, t) => "rgb(" + Math.round(a[0] + (b[0] - a[0]) * t) + "," +
    Math.round(a[1] + (b[1] - a[1]) * t) + "," + Math.round(a[2] + (b[2] - a[2]) * t) + ")";
  return h > 0.5 ? mix([242, 194, 48], [47, 208, 122], (h - 0.5) * 2)
                 : mix([255, 75, 62], [242, 194, 48], h * 2);
}
function updateStatus(c){
  const paint = (sel, k) => { const col = partColor(c.health[k], c.broken.has(k));
    document.querySelectorAll(sel).forEach(n => n.setAttribute("fill", col)); };
  paint("#sv-wing, #sv-nose", "wing");
  paint("#sv-rear", "rear");
  paint("#sv-gbox", "gearbox");
  paint("#sv-eng", "engine");
  paint("#sv-floor, #sv-podL, #sv-podR", "floor");
  paint(".sv-susp", "susp");
  paint(".sv-brake", "brakes");
  const tyreCol = c.broken.has("punct") ? "#FF4B3E" : partColor(c.life, false);
  document.querySelectorAll(".sv-tyre").forEach(n => n.setAttribute("fill", tyreCol));
  const pod = document.querySelector("#sv-pod");
  if(pod) pod.setAttribute("fill", "#0E1217");
}
function requestPit(){
  const c = S.player; if(!c || c.pitting || c.pitVisit || c.inPit || S.mode === "tt") return;
  if(c.pitReq){ c.pitReq = false; c.pitWarned = false; c.pitPlan = null; showToast("Pit call cancelled — stay out"); return; }
  const u = S.track.pitU(c.node);
  if(u > 0.05 && u < 0.88){ showToast("Too late — the pit entry is behind you"); return; }
  callPit(c, S);
}

function recover(){
  const c = S.player; if(!c) return;
  const T = S.track, i = c.node;
  // back on the road, but the car is as broken as it was: only the pit crew fix damage
  c.place(i, T.line[i]); c.vx = Math.cos(c.h) * 12; c.vy = Math.sin(c.h) * 12;
  showToast("Recovered to the track");
}

/* C (or the CAM pad): the overhead view or the driver's eye. The cockpit needs
   the 3D renderer; the choice is remembered between sessions. */
G3.view = store("view") === "cockpit" ? "cockpit" : "iso";
function cycleView(){
  if(!S) return;
  if(!G3.ok || G3.lost){ showToast("The cockpit view needs the 3D renderer"); return; }
  G3.view = G3.view === "cockpit" ? "iso" : "cockpit";
  store("view", G3.view);
  showToast(G3.view === "cockpit" ? "Cockpit view" : "Overhead view", 1.4);
}

function playerInput(c, dt){
  if(S.state === "lights"){ c.thr = 0; c.brk = 1; c.steer = 0; return; }
  const left = KEY["arrowleft"] || KEY["a"] || TOUCH.l, right = KEY["arrowright"] || KEY["d"] || TOUCH.r;
  const up = KEY["arrowup"] || KEY["w"] || TOUCH.gas, down = KEY["arrowdown"] || KEY["s"] || TOUCH.brk;
  const target = (right ? 1 : 0) - (left ? 1 : 0);
  const rate = 6.6 - clamp(c.speed / 40, 0, 3.2);
  c.steer += clamp(target - c.steer, -rate * dt, rate * dt);
  if(!left && !right) c.steer *= Math.pow(0.02, dt);
  c.thr = up ? 1 : 0; c.brk = down ? 1 : 0;
  c.hand = (KEY[" "] ? 1 : 0);
  c.boost = ((KEY["shift"] || TOUCH.boost) && c.batt > 0.01) ? 1 : 0;
}


function crossLine(c){
  const T = S.track, n = T.n;
  if(c.prevNode == null){ c.prevNode = c.node; return false; }
  const a = c.prevNode, b = c.node; c.prevNode = b;
  return a > n * 0.75 && b < n * 0.25;
}

function updateTiming(c){
  const T = S.track, n = T.n, ms = S.clock * 1000;
  // sectors
  const sec = c.node < T.sec[1] ? 0 : c.node < T.sec[2] ? 1 : 2;
  if(sec !== c.curSec && !((c.curSec === 2) && sec === 0)){
    const t = ms - c.secStart;
    if(c.lapStart != null && t > 1000){ c.secT[c.curSec] = t;
      if(c.secBest[c.curSec] == null || t < c.secBest[c.curSec]) c.secBest[c.curSec] = t;
      if(S.bestSec == null) S.bestSec = [null, null, null];
      if(S.bestSec[c.curSec] == null || t < S.bestSec[c.curSec]){ S.bestSec[c.curSec] = t; c.purple = c.purple || {}; } }
    c.secStart = ms; c.curSec = sec;
  }
  if(crossLine(c)){
    if(c.lapStart != null){
      const t = ms - c.lapStart;
      if(t > 8000 && c.lapInvalid && S.mode === "qualy"){ c.last = t; }
      else if(t > 8000){
        c.last = t; c.laps.push(t); c.total += t;
        if(c.best == null || t < c.best) c.best = t;
        if(S.fastest == null || t < S.fastest){ S.fastest = t; S.fastestBy = c;
          if(!c.ai) showToast(`Fastest lap — ${fmtTime(t)}`); }
        if(!c.ai){
          if(S.mode === "tt" && (S.bestRec == null || t < (S.bestTT ?? 1e9))){ S.bestTT = t; S.bestRec = c.recBuf.slice(); }
          saveRecord(S.track.id, t, c);
          c.teleLap = Tele.finish(S, c, t, c.setup);
        }
      }
      c.lap++;
    } else { c.lap = 1; }
    c.lapStart = ms; c.secStart = ms; c.curSec = 0; c.lapInvalid = false;
    if(!c.ai){ c.recBuf = []; if(c.lapStart != null) Tele.startLap(c); }
    if(S.mode === "race" && c.lap > S.laps && !c.finished){
      c.finished = true; c.finishTime = ms; S.finishOrder.push(c);
      if(!c.ai) endSession();
      if(S.finishOrder.length === 1 && c.ai && S.player && !S.player.finished) showToast(`${c.drv.last} takes the win`);
    }
    if(S.mode === "qualy" && c.lap > S.laps && !c.finished){ c.finished = true; if(!c.ai) endSession(); }
    // pit release
    if(c.pitReq && !c.pitting && S.mode === "race" && c.lap <= S.laps) { /* entry handled below */ }
  }
  // pit entry: a rival is taken down the lane by the pit pilot (car/pitpilot.js) from the entry
  const pu = T.pitU(c.node);
  if(c.ai && !c.dnf && !c.aiFree && c.spinT <= 0 && c.pitReq && !c.pitting && S.mode === "race" && pu >= 0 && pu < 0.10 && c.lap <= S.laps){
    const plan = c.servePen ? { tyre:"none", repairs:[], none:c.servePen === "dt", pen:c.servePen } : aiPlan(c);
    if(!plan.pen) plan.wait = PEN.serveAtStop(S, c);
    pilotStart(c, S, "ai", plan);
    // the race leader diving in is news; so is anyone just ahead or behind you
    c.pitNews = c.pos === 1 ? "lead" : (S.player && !S.player.dnf && Math.abs(c.pos - S.player.pos) === 1) ? "near" : null;
    if(c.pitNews === "lead") showMsg("LEADER PITS", `${c.drv.last} is in — ${c.tyre.name.toLowerCase()}s off, ${(c.nextTyre || TYRES.medium).name.toLowerCase()}s on`, 2.4);
    else if(c.pitNews) showToast(`${c.drv.last} (P${c.pos}) is pitting`);
  }
  // and where they come back out
  if(c.ai && c.wasPitting && !c.pitting && c.pitNews){
    showToast(`${c.drv.last} rejoins P${c.pos} on ${c.tyre.name.toLowerCase()}s` +
      (S.player && !S.player.dnf && S.player.stops === 0 && S.mustPit ? " · you still have to stop" : ""));
    c.pitNews = null;
  }
  c.wasPitting = !!c.pitting;
  // your own tyres: a word from the pit wall when they start to go
  if(!c.ai && S.mode === "race" && !c.pitting && !c.inPit){
    if(c.life < 0.32 && !c.tyreCall && c.lap < S.laps){ c.tyreCall = true; showToast("Tyres are going off — box soon (P)"); }
    if(c.life > 0.6) c.tyreCall = false;
    if(S.mustPit && c.stops === 0 && c.lap === S.laps - 1 && !c.stopCall){ c.stopCall = true; showToast("Mandatory stop — box this lap (P)"); }
  }
}

function positions(){
  const T = S.track;
  const arr = S.cars.filter(c => !c.dnf);
  for(const c of arr) c.prog = c.lap * T.length + c.s;
  arr.sort((a, b) => (b.finished - a.finished) || (a.finished ? a.finishTime - b.finishTime : b.prog - a.prog));
  arr.forEach((c, i) => { c.pos = i + 1; });
  const leader = arr[0];
  for(const c of arr){
    const d = leader.prog - c.prog;
    c.gap = c === leader ? null : d / Math.max(18, c.speed) * 1000;
    const ahead = arr[c.pos - 2], chaser = arr[c.pos];
    c.gapAhead = ahead ? (ahead.prog - c.prog) / Math.max(18, c.speed) * 1000 : null;
    c.gapBehind = chaser ? (c.prog - chaser.prog) / Math.max(18, c.speed) * 1000 : null;
  }
  return arr;
}

function update(dt, rdt){
  rdt = rdt || dt;
  S.clock += dt;
  // lights
  if(S.state === "lights"){
    S.lights = Math.min(5, Math.floor(S.clock / 0.85));
    $("#lights").hidden = false;
    [...$("#lights").children].forEach((n, i) => n.classList.toggle("on", i < S.lights && S.clock < 5.1));
    if(S.clock > 5.1 + Math.random() * 0.0){
      S.state = "run"; S.clock = 0; $("#lights").hidden = true;
      for(const c of S.cars){
        c.lapStart = null; c.lap = 0; c.secStart = 0; c.prevNode = c.node;
        // in the window = drive; under it = bogged down; over it = wheelspin
        if(c.revs < LAUNCH_LO){ c.launchGrade = "bog"; c.launchMul = lerp(0.42, 0.9, c.revs / LAUNCH_LO); c.launchT = 2.2; }
        else if(c.revs > LAUNCH_HI){ c.launchGrade = "spin"; c.launchMul = lerp(0.85, 0.5, (c.revs - LAUNCH_HI) / (1 - LAUNCH_HI)); c.launchT = 2.0; }
        else { c.launchGrade = "good"; c.launchMul = 1.10; c.launchT = 1.6; }
      }
      PEN.launch(S);
      const g = S.player.launchGrade;
      showMsg(g === "good" ? "GREAT START" : g === "bog" ? "BOGGED DOWN" : "WHEELSPIN",
              g === "good" ? "Perfect launch" : g === "bog" ? "Not enough revs" : "Too many revs", 1.5);
    }
  }
  // weather drift
  S.wet = lerp(S.wet, S.wetTarget, dt * 0.15);
  if(S.wetTarget > 0 && S.wet > 0.25 && !S.wetToast){ S.wetToast = true; showToast("Rain — the track is going wet"); }

  AERO.update(S, dt);                                   // slipstream and dirty air, once a frame, before anyone moves

  for(const c of S.cars){
    if(S.state === "lights"){
      // engines running, brakes on, nobody moves — and no creeping backwards
      c.thr = 0; c.brk = 1; c.steer = 0; c.boost = 0; c.slide = 0;
      c.vx = 0; c.vy = 0; c.railV = 0; c.aiTargetV = 0;
      if(c.ai) c.revs = clamp(LAUNCH_LO + (LAUNCH_HI - LAUNCH_LO) * (0.2 + c.drv.skill * 0.7) +
                              (Math.random() - 0.5) * 0.10, 0.15, 1);
      else {
        const gas = KEY["arrowup"] || KEY["w"] || TOUCH.gas;
        c.revs = clamp(c.revs + (gas ? 0.55 : -0.9) * dt, 0, 1);
      }
      continue;
    }
    if(c.ai){ if(!c.dnf) driveAI(c, S, dt); }          // a retired car has nobody driving it: it stays where it stopped
    else { playerPit(c, S, dt); if(!c.pitting){ playerInput(c, dt); SC.limitPlayer(S, c); } }
    c.step(dt, S);
    if(c === S.player) Tele.sample(S, c);
    if(S.state === "run") updateTiming(c);
    // particles
    const spd = c.speed;
    if(c.slide > 0.3 && spd > 12 && Math.random() < 0.6){
      const bx = c.x - Math.cos(c.h) * 1.6, by = c.y - Math.sin(c.h) * 1.6;
      spawn(bx, by, c.z + 0.2, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3, 0.4, 0.8,
            S.wet > 0.2 ? "#C9DCE8" : "#B9BEC4", 0.45, "smoke");
    }
    if(S.wet > 0.2 && spd > 14){
      const puffs = S.wet > 0.6 ? 2 : 1;
      for(let q = 0; q < puffs; q++){
        const bx = c.x - Math.cos(c.h) * (2.0 + q * 0.9), by = c.y - Math.sin(c.h) * (2.0 + q * 0.9);
        spawn(bx, by, c.z + 0.3,
              -Math.cos(c.h) * (5 + spd * 0.10) + (Math.random() - 0.5) * 6,
              -Math.sin(c.h) * (5 + spd * 0.10) + (Math.random() - 0.5) * 6,
              1.8 + Math.random() * 1.6, 0.55 + S.wet * 0.5, "#DCEAF4", 0.36 + S.wet * 0.45, "smoke");
      }
    }
    if(c.kerbShake > 0.5 && spd > 25 && Math.random() < 0.5)
      spawn(c.x, c.y, c.z + 0.1, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, 3 + Math.random() * 4, 0.35, "#FFC46B", 0.16, "spark");
    // the plank grounding out — more often on a battered or heavily loaded car
    if(spd > 30 && !c.wrecked){
      const bottoming = 0.10 + c.damage * 0.9 + (c.broken.has("floor") ? 1.2 : 0) +
                        Math.abs(c.roll || 0) * 2.2 + c.kerbShake * 0.6;
      if(Math.random() < bottoming * dt * 4){
        const bx = c.x - Math.cos(c.h) * 1.3, by = c.y - Math.sin(c.h) * 1.3;
        for(let q = 0; q < 2 + (Math.random() * 3 | 0); q++)
          spawn(bx, by, c.z + 0.06,
                -Math.cos(c.h) * (4 + Math.random() * 7) + (Math.random() - 0.5) * 4,
                -Math.sin(c.h) * (4 + Math.random() * 7) + (Math.random() - 0.5) * 4,
                1.4 + Math.random() * 3.4, 0.30 + Math.random() * 0.25,
                Math.random() < 0.75 ? "#FFC46B" : "#FFF0C0", 0.15, "spark");
      }
    }
    if(Math.abs(c.off) > S.track.half + 1.5 && spd > 14 && S.track.barrier !== "wall" && Math.random() < 0.7)
      spawn(c.x, c.y, c.z + 0.1, (Math.random() - 0.5) * 5, (Math.random() - 0.5) * 5, 1.5, 0.6,
            S.track.pal.ground, 0.5, "smoke");
    // a battered car trails smoke, and a dead engine pours it out
    if(c.recovering || c.recovered) continue;           // on the truck, or gone: no smoke from where it was
    const hurt = Math.max(c.damage > 0.45 ? (c.damage - 0.4) * 1.4 : 0, c.broken.has("engine") ? 0.8 : 0, c.dnf ? 0.7 : 0);
    if(hurt > 0 && !c.pitting && Math.random() < dt * (3 + hurt * 14))
      spawn(c.x - Math.cos(c.h) * 0.7, c.y - Math.sin(c.h) * 0.7, c.z + 0.55, (Math.random() - 0.5) * 1.4, (Math.random() - 0.5) * 1.4,
            1.6 + Math.random() * 1.8, 1.0 + hurt * 1.2, hurt > 0.7 ? "#3E4147" : "#8A8F96", 0.4 + hurt * 0.3, "smoke");
    if(c.dnf && !c.wrecked && Math.random() < dt * 3)
      spawn(c.x, c.y, c.z + 0.4, (Math.random() - 0.5) * 1.5, (Math.random() - 0.5) * 1.5,
            1.2 + Math.random(), 1.6, "#6E757D", 0.5, "smoke");
    if(c === S.player && S.mode === "tt"){ c.recBuf = c.recBuf || [];
      if(S.clock - (c.recT || 0) > 0.05){ c.recT = S.clock; c.recBuf.push([c.x, c.y, c.h, c.z]); } }
  }
  // car-to-car contact
  for(let a = 0; a < S.cars.length; a++) for(let b = a + 1; b < S.cars.length; b++){
    const A = S.cars[a], B = S.cars[b];
    if(A.dnf || B.dnf || A.pitting || B.pitting) continue;
    // only cars on the same stretch of road can touch — some circuits pass close to themselves
    let ds2 = B.s - A.s, halfL = S.track.length / 2;
    if(ds2 > halfL) ds2 -= S.track.length; else if(ds2 < -halfL) ds2 += S.track.length;
    if(Math.abs(ds2) > 22) continue;
    const dx = B.x - A.x, dy = B.y - A.y, d = Math.hypot(dx, dy);
    if(d < 3.4 && d > 0.001){
      const ux = dx / d, uy = dy / d, push = (3.4 - d) / 2;
      A.x -= ux * push; A.y -= uy * push; B.x += ux * push; B.y += uy * push;
      const rel = (B.vx - A.vx) * ux + (B.vy - A.vy) * uy;
      if(rel < 0){
        const imp = -rel * 0.68;
        PEN.contact(S, A, B, ux, uy, imp, ds2);
        A.vx -= ux * imp; A.vy -= uy * imp; B.vx += ux * imp; B.vy += uy * imp;
        // wheels touching throws the cars sideways, and a tap on a rear corner spins the car in front
        if(imp > 4){
          const tA = contactTorque(A, ux, uy, imp), tB = contactTorque(B, -ux, -uy, imp);
          A.spinV = (A.spinV || 0) + tA; B.spinV = (B.spinV || 0) + tB;
          const kick = clamp(imp * 0.10, 0.2, 2.6);
          A.spinV -= kick * Math.sign(ds2 || 1) * 0.4; B.spinV += kick * Math.sign(ds2 || 1) * 0.4;
          if(imp > 9 && Math.abs(tA) > 1.5 && A.spinT <= 0 && !A.wrecked) { A.lastSpinWhy = "contact"; A.startSpin(S, clamp(A.spinV, -7, 7) || tA); }
          if(imp > 9 && Math.abs(tB) > 1.5 && B.spinT <= 0 && !B.wrecked) { B.lastSpinWhy = "contact"; B.startSpin(S, clamp(B.spinV, -7, 7) || tB); }
          if(imp > 15){
            if(A.spinT <= 0 && !A.wrecked){ A.lastSpinWhy = "contact"; A.startSpin(S, (tA || kick) * 1.2); }
            if(B.spinT <= 0 && !B.wrecked){ B.lastSpinWhy = "contact"; B.startSpin(S, (tB || -kick) * 1.2); }
          }
          const mx2 = (A.x + B.x) / 2, my2 = (A.y + B.y) / 2;
          for(let q = 0; q < Math.min(12, 3 + imp | 0); q++)
            spawn(mx2, my2, A.z + 0.3, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14,
                  2 + Math.random() * 7, 0.3 + Math.random() * 0.4,
                  q % 3 ? "#FFC46B" : "#C9CED4", 0.2, "spark");
          if(imp > 9){ A.scuff(S, imp * 0.7); }
        }
        if(imp > 3){
          A.hurt(imp * 0.75, "front", S, { dx:ux, dy:uy }); B.hurt(imp * 0.75, "rear", S, { dx:-ux, dy:-uy });
        }
        if(A === S.player || B === S.player) S.shake = Math.min(1, S.shake + imp * 0.04);
        
      }
    }
  }
  // a stopped wreck and a parked recovery truck do not move: whoever drives into them stops
  const obs = REC.obstacles(S);
  if(obs.length) for(let pass = 0; pass < 2; pass++) for(const C of S.cars){
    if(C.dnf || C.pitting || C.inPit) continue;
    for(const o of obs){
      const dx = C.x - o.x, dy = C.y - o.y, d = Math.hypot(dx, dy), lim = o.r + 1.7;
      if(d >= lim || d < 0.001) continue;
      const ux = dx / d, uy = dy / d;
      C.x += ux * (lim - d); C.y += uy * (lim - d);
      const rel = C.vx * ux + C.vy * uy;
      if(rel < 0){
        const imp = -rel;
        C.vx -= ux * rel * 1.4; C.vy -= uy * rel * 1.4;
        if(C.ai){ C.railV = Math.min(C.railV || 0, 6); }
        // an AI car cannot react to a car tumbling to a stop right in front of it: it is damaged, not put out (you are not spared)
        if(imp > 3) C.hurt(C.ai ? Math.min(imp * 0.75, 14) : imp * 0.75, "front", S, { dx:-ux, dy:-uy });
        if(imp > 9 && C.spinT <= 0 && !C.wrecked && !C.dnf){ C.lastSpinWhy = "wreck"; } if(imp > 9 && C.spinT <= 0 && !C.wrecked && !C.dnf) C.startSpin(S, (Math.random() < 0.5 ? -1 : 1) * clamp(imp * 0.3, 2, 6));
        if(C === S.player) S.shake = Math.min(1, S.shake + imp * 0.05);
      }
    }
  }
  stepParts(dt);
  positions();
  PEN.tick(S, dt);
  SC.tick(S, dt);
  REC.tick(S, dt);

  // ghost playback
  if(S.mode === "tt" && S.bestRec && S.player.lapStart != null){
    const t = (S.clock * 1000 - S.player.lapStart) / 50 | 0;
    const f = S.bestRec[Math.min(t, S.bestRec.length - 1)];
    if(f){ if(!S.ghostCar){ S.ghostCar = new Car(S.player.team, S.player.drv, 99, S.track); }
      S.ghostCar.x = f[0]; S.ghostCar.y = f[1]; S.ghostCar.h = f[2]; S.ghostCar.z = f[3]; S.ghost = true; }
  }
  S.shake = Math.max(0, S.shake - dt * 2.6);
  try{ AUDIO.frame(S, dt); }catch(e){}
  // your own accident plays out, in slow motion from a cinematic camera, before the classification comes up
  if(S.crashCam > 0){
    S.crashCam -= rdt; S.crashT = (S.crashT || 0) + rdt;
    if(G3.ok && S.crashKind === "wreck" && !S.cine && S.crashT < 0.5){ CINE.begin(G3, S, "crash"); $("#hud").hidden = true; }
    const want = S.crashKind === "wreck" ? (S.crashT < 4.6 ? 0.2 : 0.55) : 1;
    S.slow = lerp(S.slow == null ? 1 : S.slow, want, 1 - Math.exp(-rdt * 7));
    const settled = !S.player.wrecked && S.player.speed < 1.2;
    if(S.crashCam <= 0 || (settled && S.crashT > 3.0)){
      S.crashCam = 0; S.slow = 1;
      if(S.mode === "race" && S.player.dnf && !S.ended){
        // the truck and crane lift the wreck away (world frozen), then the rest of the race is simulated behind a plain screen
        const sess = S;
        const startSim = () => { if(S !== sess || S.ended) return; S.dnfScene = false; S.simRest = 0; $("#hud").hidden = false; $("#simrest").hidden = false; };
        if(G3.ok && !G3.lost){ S.dnfScene = true; CINE.begin(G3, S, "dnf", startSim); }
        else { S.cine = null; startSim(); }
      }
      else endSession();
    }
  }

  // camera
  const p = S.player;
  // real accelerations, for the way the camera leans
  const ax = ((p.vx - (p.pvx == null ? p.vx : p.pvx)) / Math.max(dt, 1e-4));
  const ay = ((p.vy - (p.pvy == null ? p.vy : p.pvy)) / Math.max(dt, 1e-4));
  p.pvx = p.vx; p.pvy = p.vy;
  const gLat = clamp((-ax * Math.sin(p.h) + ay * Math.cos(p.h)) / 30, -1.4, 1.4);
  const gFwd = clamp((ax * Math.cos(p.h) + ay * Math.sin(p.h)) / 30, -1.4, 1.4);
  S.gLat = lerp(S.gLat || 0, gLat, 1 - Math.pow(0.02, dt));
  S.gFwd = lerp(S.gFwd || 0, gFwd, 1 - Math.pow(0.02, dt));
  if(S.tv){
    S.tv.t -= dt;
    if(S.tv.t <= 0 || S.crashCam || p.dnf){ R.persp = false; R.tv = false; S.tv = null; R.froll = 0; R.fpitch = 0; }
    else {
      R.persp = true; R.tv = true; R.focal = R.W * 0.78;
      const tx3 = p.x + p.vx * 0.12, ty3 = p.y + p.vy * 0.12, tz3 = p.z + 0.7;
      R.fx = S.tv.x; R.fy = S.tv.y; R.fz = S.tv.z;
      const look = Math.atan2(ty3 - R.fy, tx3 - R.fx);
      R.fcos = Math.cos(look); R.fsin = Math.sin(look);
      const f = Math.max((tx3 - R.fx) * R.fcos + (ty3 - R.fy) * R.fsin, 1);
      R.fpitch = -(tz3 - R.fz) * (R.focal / f) + R.H * 0.06;
      R.froll = 0; R.shakeY = 0;
      return;
    }
  }
  R.froll = 0; R.fpitch = 0;
  const wantLow = S.state === "lights" ? 1 : 0;
  S.launchCam = wantLow ? 1 : Math.max(0, (S.launchCam || 0) - dt * 0.5);
  const lc = S.launchCam * S.launchCam * (3 - 2 * S.launchCam);      // ease out
  R.isx = lerp(ISX, CAM_LOW.isx, lc);
  R.isy = lerp(ISY, CAM_LOW.isy, lc);
  R.zs  = lerp(ZS,  CAM_LOW.zs,  lc);
  const lead = lerp(0.55, 0, lc);
  const ahead = lc * 20;                                             // look up the road
  const [tx, ty0] = isoOf({ x:p.x + p.vx * lead + Math.cos(p.h) * ahead,
                            y:p.y + p.vy * lead + Math.sin(p.h) * ahead, z:p.z });
  const ty = ty0 - lc * 0.17 * R.H / Math.max(R.zoom, 1);            // sit the car low in frame
  R.camX = lerp(R.camX, tx, 1 - Math.pow(0.0008, dt));
  R.camY = lerp(R.camY, ty, 1 - Math.pow(0.0008, dt));
  const inLane = p.inPit || p.pitting;
  S.pitFocus = lerp(S.pitFocus || 0, inLane ? 1 : 0, 1 - Math.pow(0.05, dt));
  // the zoom is sized to the view: never work it out from a view that measured nothing
  if(!(R.W > 0) || !(R.H > 0)) R.resize();
  R.targZoom = lerp(clamp(Math.min(R.W, R.H) / (46 + p.speed * 0.50), 4.4, 14),
                    clamp(Math.min(R.W, R.H) / 27, 7, 19), S.pitFocus);
  R.targZoom = lerp(R.targZoom, clamp(Math.min(R.W, R.H) / 32, 6.5, 15), lc);
  if(S.crashCam > 0) R.targZoom = lerp(R.targZoom, clamp(Math.min(R.W, R.H) / 56, 5, 10), 0.7);
  R.targZoom *= S.track.def.zoomK || 1;                              // a street circuit wants the camera in close
  R.userZoomT += dt;
  if(R.userZoomT > ZOOM_HOLD) R.userZoom = lerp(R.userZoom, 1, 1 - Math.pow(0.22, dt));
  if(Math.abs(R.userZoom - 1) < 0.004) R.userZoom = 1;
  R.targZoom = clamp(R.targZoom * R.userZoom, 2.2, 34);
  // a deliberate nudge should land quickly; the drift back should not
  R.zoom = lerp(R.zoom, R.targZoom, 1 - Math.pow(R.userZoomT < ZOOM_HOLD ? 0.0006 : 0.02, dt));
  R.shakeY = (Math.random() - 0.5) * S.shake * 9 + (p.kerbShake > 0.5 ? (Math.random() - 0.5) * 2.2 : 0);
}

/* ---------- end of session ---------- */
function endSession(){
  if(S.ended) return; S.ended = true; S.state = "done";
  $("#simrest").hidden = true;
  try{ AUDIO.silence(); }catch(e){}
  const arr = positions();
  const T = S.track;
  const cl = PEN.classify(S, arr);
  const first = cl.order[0], key0 = first ? cl.key.get(first) : 0;
  const res = cl.order.map(c => {
    const gap = c === first ? null
      : cl.any ? cl.key.get(c) - key0
      : (c.finished && first.finished ? c.finishTime - first.finishTime : c.gap);
    return { car:c, pos:c.pos, gap, best:c.best, stops:c.stops, tyre:c.tyre,
             pen:cl.any ? cl.pen.get(c) : 0, dq:!!(c.pen && c.pen.dsq), dqReason:(c.pen && c.pen.dsq && c.pen.dsqReason) || "",
             total:cl.any && c === first && c.finished ? key0 : null };
  });
  cl.order.forEach((c, i) => { c.pos = i + 1; });
  const out = S.cars.filter(c => c.dnf).sort((a, b) => (b.prog || 0) - (a.prog || 0));
  for(const c of out) res.push({ car:c, pos:res.length + 1, gap:null, best:c.best, stops:c.stops, tyre:c.tyre, dnf:true });
  res.forEach((r, i) => r.pos = i + 1);
  // mandatory stop: every finisher must have pitted at least once (any tyre will do); anyone who ran wets is exempt
  if(S.mode === "race" && S.mustPit){
    for(const r of res) if(!r.dnf && !r.dq && r.car.stops === 0 && !r.car.used.has("wet")){
      r.dq = true;
      r.dqReason = "Made no pit stop — mandatory pit stop rule";
    }
    res.sort((a, b) => (a.dnf - b.dnf) || (a.dq - b.dq) || (a.pos - b.pos));
    res.forEach((r, i) => r.pos = i + 1);
  }
  // gaps and the winner's total are measured from the car that actually won: if the car that crossed the line first was
  // disqualified, the new P1 inherits the total and everyone's gap is re-based on them
  const win = res.find(r => !r.dq && !r.dnf);
  if(win && win.car !== first){
    const wc = win.car, wk = cl.any ? cl.key.get(wc) : wc.finishTime;
    for(const r of res){
      if(r.dnf || r.dq) continue;
      const c = r.car;
      r.gap = c === wc ? null
        : cl.any ? cl.key.get(c) - wk
        : (c.finished && wc.finished ? c.finishTime - wc.finishTime : (c.gap != null && wc.gap != null ? c.gap - wc.gap : c.gap));
      r.total = c === wc && c.finished && cl.any ? wk : null;
    }
  }
  for(const r of res) r.car.pos = r.pos;
  S.results = res;
  // places lost to the player's own penalties: cars that were behind on the road and are classified ahead (retirements and disqualified cars don't count)
  if(S.mode === "race"){
    const mine = res.find(r => r.car === S.player), a = arr.indexOf(S.player);
    S.penPlaces = (!mine || mine.dq || mine.dnf || a < 0) ? 0
      : res.filter(r => r.pos < mine.pos && !r.dq && !r.dnf && arr.indexOf(r.car) > a).length;
  }
  if(S.champ && S.mode === "race") applyChampionship(res);
  const sess = S;
  // a retirement and a win each get a cutscene; everything else goes straight to the results
  const kind = (G3.ok && !G3.lost && S.mode === "race")
    ? (S.player.dnf ? null : (res[0] && res[0].car === S.player && !res[0].dq && !res[0].dnf) ? "win" : null) : null;
  if(kind){
    setTimeout(() => { if(S === sess) CINE.begin(G3, S, kind, () => { if(S === sess) showResults(res); }); }, kind === "win" ? 1800 : 200);
  } else setTimeout(() => { if(S === sess) showResults(res); }, 900);
  if(kind !== "dnf"){
    const mineRow = res.find(r => r.car === S.player), black = !!(mineRow && mineRow.dq);
    showMsg(S.player.dnf ? "DNF" : black ? "BLACK FLAG" : S.mode === "qualy" ? "CHEQUERED FLAG" : "FINISH",
      S.player.dnf ? (S.player.retiredBy || "Retired") : black ? "Disqualified" + (mineRow.dqReason ? " — " + mineRow.dqReason : "") : S.mode !== "race" ? "Session over"
        : PEN.owed(S.player) > 0 ? `P${S.player.pos} · +${PEN.owed(S.player)} s in penalties`
        : S.player.pos === 1 ? "Race win" : `P${S.player.pos}`, 2.4);
    $("#flag").classList.add("on"); setTimeout(() => $("#flag").classList.remove("on"), 1400);
  }
}

/* the player is out: run the rest of the race without drawing it, then classify with the simulated times */
function restDone(){ return S.cars.every(c => c.dnf || c.finished); }
function simulateRest(budgetMs){
  const t0 = Date.now(), CAP = 60 * 60 * 40;
  while(!S.ended && S.simRest != null){
    for(let i = 0; i < 120; i++){
      update(1 / 60, 1 / 60); S.simRest++;
      if(S.ended || restDone() || S.simRest > CAP){ S.simRest = null; endSession(); return; }
    }
    if(Date.now() - t0 > budgetMs) return;
  }
}

function loop(t){
  requestAnimationFrame(loop);
  const dt = Math.min(0.033, (t - lastT) / 1000 || 0.016); lastT = t;
  if(!S){ return; }
  if(S.simRest != null && !S.ended && !paused){ simulateRest(24); }
  else if(S.dnfScene){ if(!paused){ S.clock += dt; stepParts(dt); } }      // the retirement cutscene: the race stands still
  else if(!paused && !S.menuOpen && S.state !== "done") update(dt * (S.slow == null ? 1 : S.slow), dt);
  else if(!paused && S.state === "done") { S.clock += dt; stepParts(dt); }
  if(S.cine && !paused) CINE.update(G3, S, dt);
  if(S.simRest == null || S.ended) renderWorld(S);                        // the simulated rest of the race is never drawn
  if(R.tv && S.tv){
    const ctx = R.ctx; ctx.save(); ctx.setTransform(R.dpr, 0, 0, R.dpr, 0, 0);
    ctx.fillStyle = "rgba(10,12,16,.72)"; ctx.fillRect(18, R.H - 54, 190, 34);
    ctx.fillStyle = "#FF3B30"; ctx.beginPath(); ctx.arc(34, R.H - 37, 6, 0, TAU); ctx.fill();
    ctx.fillStyle = "#F2F2F2"; ctx.font = "700 15px 'Saira Condensed',sans-serif"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
    ctx.fillText("LIVE · " + S.tv.name, 48, R.H - 37);
    ctx.restore();
  }
  hudT += dt;
  if(hudT > 0.07){ hudT = 0; updateHUD(); drawMini(S); }
}

function setPaused(v){ paused = v; }
function setS(v){ S = v; }
export { S, cycleView, endSession, loop, simulateRest, paused, recover, requestPit, setPaused, setS, startSession, update, updateStatus };
