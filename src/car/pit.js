import { $, el } from '../config/util.js';
import { PARTS, TYRES } from './parts.js';
import { showMsg } from '../ui/screens.js';
import { nextServe, served, issue, serveAtStop } from '../game/penalties.js';
import { pilotStart, laneS } from './pitpilot.js';

/* ---------- the player's pit stop ----------
   P calls the car in and opens the service menu (the race pauses while you choose).
   Then you drive it to the pit entry yourself and brake for the speed-limit line; from
   the line the pit lane drives itself (car/pitpilot.js): your box, the stop, the release,
   all at the limiter, and hands the car back to you at the second line. */
function playerPit(c, S, dt){
  const T = S.track;
  if(c.pitting) return;                                              // the lane has it
  // back out on the track after a visit: the visit is over
  if(c.pitVisit && !c.inPit && T.pitRampF(c.node) <= 0.04){
    c.pitVisit = false; c.pitPlan = null; c.pitReq = false; c.pitWarned = false;
    return;
  }
  if(!c.pitReq || c.pitVisit) return;
  const s = laneS(c), a = T.pitAlong(s), u = T.pitU(c.node);
  // approaching the entry
  if(u < 0){
    const toEntry = (((T.pitIn - c.node) % T.n + T.n) % T.n) * T.ds;
    if(toEntry < 260 && !c.pitWarned){
      c.pitWarned = true;
      showMsg("PIT ENTRY AHEAD", "Move to the " + (T.pitSide > 0 ? "right" : "left") + " · brake for " + Math.round(T.pitLimit * 3.6) + " km/h at the line", 2.4);   // + is the right-hand side
    }
    return;
  }
  // in the zone: at the speed-limit line, the lane takes the car (or, if it is not in the lane, it missed it)
  if(a >= T.pitLimA && a < T.pitLimB){
    if(!c.inPit){
      c.pitReq = false; c.pitWarned = false; c.pitPlan = null;
      showMsg("PIT ENTRY MISSED", "Stay out — call it again next lap", 2.2);
      return;
    }
    const kph = c.speed * 3.6, lim = T.pitLimit * 3.6;
    if(S.mode === "race" && kph > lim + 5) issue(S, c, "t5", "Speeding in the pit lane — " + Math.round(kph) + " km/h at the line");
    const plan = c.pitPlan || defaultPlan(c, S);
    if(!plan.pen && !plan.none && S.mode === "race") plan.wait = serveAtStop(S, c);
    c.pitPlan = plan; c.pitVisit = true;
    pilotStart(c, S, "player", plan);
  }
}

function defaultPlan(c, S){
  return { tyre:(S.wet > 0.45 ? "wet" : c.tyre.key === "soft" ? "hard" : "soft"),
           repairs:[...c.broken].filter(k => !PARTS[k].tyre), none:false };
}
function pitJobTime(c, plan){
  // the tyres take a crew about two and a half seconds; repairs are done alongside, so the longest decides
  let t = plan.tyre && plan.tyre !== "none" ? 2.4 : 0.6;
  for(const k of plan.repairs) t = Math.max(t, PARTS[k].fix + 0.6);
  return t;
}
/* the call: a penalty to serve takes the visit (no work, no menu); otherwise choose the service */
function callPit(c, S){
  const owe = S.mode === "race" ? nextServe(c) : null;
  if(owe){
    c.pitPlan = { tyre:"none", repairs:[], none:owe.kind === "dt", pen:owe.kind };
    c.pitReq = true; c.pitWarned = false;
    showMsg(owe.kind === "dt" ? "DRIVE-THROUGH" : "STOP-AND-GO",
            owe.kind === "dt" ? "Through the lane on the limiter — no stop" : "Ten seconds in your box — no work allowed", 3.2);
    return;
  }
  openPitMenu(c, S);
}
function openPitMenu(c, S){
  S.menuOpen = true;
  const p = defaultPlan(c, S);
  c.pitPlan = { tyre:p.tyre, repairs:new Set(p.repairs), none:false, draft:true };
  $("#pitmenu").hidden = false;
  const box = S.track.boxOf(c.team);
  $("#pit-sub").textContent = (S.mode === "race" ? "Lap " + c.lap + " of " + S.laps + " · P" + c.pos + " · " : "") +
    c.team.short + " box, " + (box.k + 1) + (box.k === 0 ? "st" : box.k === 1 ? "nd" : box.k === 2 ? "rd" : "th") + " from the pit exit";
  renderPitMenu(c, S);
}
function renderPitMenu(c, S){
  const plan = c.pitPlan, host = $("#pit-tyres"); host.innerHTML = "";
  const opts = [["Soft", "soft"], ["Medium", "medium"], ["Hard", "hard"], ["Wet", "wet"], ["Keep", "none"]];
  for(const o of opts){
    const b = el("button", plan.tyre === o[1] ? "on" : "", o[0]);
    b.onclick = () => { plan.tyre = o[1]; renderPitMenu(c, S); };
    host.appendChild(b);
  }
  const rep2 = $("#pit-repairs"); rep2.innerHTML = "";
  const fixable = [...c.broken].filter(k => !PARTS[k].tyre);
  if(!fixable.length){
    rep2.appendChild(el("div", "fixrow clean",
      c.broken.size ? "Puncture — fixed with the tyre change" : "Nothing broken"));
  } else for(const k of fixable){
    const on = plan.repairs.has(k);
    const row = el("button", "fixrow" + (on ? " on" : ""),
      '<span class="tick"></span><span class="nm2">' + PARTS[k].name +
      '</span><span class="t2">' + PARTS[k].fix.toFixed(1) + 's</span>');
    row.onclick = () => { plan.repairs.has(k) ? plan.repairs.delete(k) : plan.repairs.add(k); renderPitMenu(c, S); };
    rep2.appendChild(row);
  }
  $("#pit-time").textContent = "about " + pitJobTime(c, { tyre:plan.tyre, repairs:[...plan.repairs] }).toFixed(1) + "s";
}
/* the menu's buttons: box (with the service chosen), or a drive-through, or stay out */
function closePitMenu(S, how){
  S.menuOpen = false; $("#pitmenu").hidden = true;
  const c = S.player; if(!c || !c.pitPlan) return;
  if(how === "out"){ c.pitPlan = null; c.pitReq = false; S.toast && S.toast("Staying out"); return; }
  const plan = c.pitPlan;
  c.pitPlan = { tyre:plan.tyre, repairs:[...plan.repairs], none:how === "through" };
  c.pitReq = true; c.pitWarned = false;
  const T = S.track;
  S.toast && S.toast(how === "through" ? "Drive-through — no stop" : "Box, box — " + (plan.tyre === "none" ? "no tyres" : TYRES[plan.tyre].name.toLowerCase() + "s") +
    " · " + Math.round(T.pitLimit * 3.6) + " km/h in the lane");
}

export { callPit, closePitMenu, playerPit, pitJobTime };
