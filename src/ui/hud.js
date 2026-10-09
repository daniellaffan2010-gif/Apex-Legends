import { $, clamp, el, fmtGap, fmtTime } from '../config/util.js';
import { PARTS } from '../car/parts.js';
import { LAUNCH_HI, LAUNCH_LO, gearOf, rpmOfCar } from '../car/physics.js';
import { S, updateStatus } from '../game/session.js';
import { hudLine } from '../game/penalties.js';
import { stopPose } from '../car/pitstop.js';
import { STAGES, wearLook, stageOf, barColour } from '../car/tyrewear.js';

function buildBoard(){
  const b = $("#h-board"); b.innerHTML = "";
  for(let i = 0; i < 6; i++){
    const r = el("div", "tw", `<span class="p"></span><span class="n"></span><span class="g"></span>`);
    b.appendChild(r);
  }
}
/* The pit panel under the clock: what the lane wants from you right now. Called in: your box and the limit;
   on the entry road: the line and your speed against the limit; on the limiter: metres to your box; stopped:
   the stop's own clock, a light per wheel (amber off, green done), the jacks and the release light. */
let pitHTML = "";
function pitPanel(c, S){
  const host = $("#h-lim"), T = S.track;
  let h = "";
  const lim = Math.round((T.pitLimit || 22.2) * 3.6);
  const box = T.boxOf ? T.boxOf(c.team) : null, nth = box ? box.k + 1 : 0;
  const P = c.pp;
  if(P && P.phase === "stopped" && P.st){
    const st = P.st, po = stopPose(st, pitPanel.po || (pitPanel.po = {}));
    const pip = q => { const k = po["c" + q]; return '<i class="pip ' + (st.corners[q].none ? "" : k >= 3 ? "ok" : k >= 1 ? "on" : "") + '"></i>'; };
    h = '<b>' + (st.noWork ? "STOP-GO" : po.work ? "IN THE BOX" : "SERVING") + '</b> ' + st.t.toFixed(1) + 's' +
        (st.noWork ? "" : ' <span class="pips">' + pip(3) + pip(2) + '<br>' + pip(1) + pip(0) + '</span>') +
        ' <i class="lamp ' + (po.light ? "go" : "") + '"></i>';
  } else if(P && c.pitting){
    const d = Math.max(0, (P.stopA != null && P.relA == null ? P.stopA : P.box.a) - P.a);
    h = P.relA == null && P.stop ? '<b>PIT LIMITER · ' + lim + '</b> your box ' + Math.round(d) + ' m' : '<b>PIT LIMITER · ' + lim + '</b>';
  } else if(c.pitReq && c.inPit && !c.pitVisit){
    const s = c.s, a = T.pitAlong(s), toLine = Math.max(0, T.pitLimA - a), kph = Math.round(c.speed * 3.6);
    h = '<b>LIMIT ' + lim + ' IN ' + Math.round(toLine) + ' m</b> <span class="' + (kph > lim + 4 ? "hot" : "") + '">' + kph + ' km/h</span>';
  } else if(c.pitReq && !c.pitVisit){
    h = '<b>BOX THIS LAP</b> ' + (box ? c.team.short + ' · box ' + nth + ' from the exit · ' : '') + lim + ' km/h';
  } else if(c.pitVisit && c.inPit){
    h = '<b>LIMITER OFF</b> rejoin with care';
  }
  host.hidden = !h;
  if(h !== pitHTML){ pitHTML = h; host.innerHTML = h; }
}

/* The tyre icon: wear eases down, snaps back up on a fresh set; every layer's opacity is a CSS variable fed by
   wearLook() (car/tyrewear.js), written only when it has moved, so the icon morphs with no steps. */
const TW = { life:1, t:0, set:null, stage:-1, swap:0 };
function tyreWearHud(c, tyEl){
  const now = performance.now(), dt = TW.t ? Math.min((now - TW.t) / 1000, 0.25) : 0; TW.t = now;
  const L = c.life != null ? c.life : 1;
  TW.life = L > TW.life ? L : TW.life + (L - TW.life) * (1 - Math.exp(-dt * 6));
  const look = wearLook(TW.life), keys = ["scuff", "grain", "marb", "cords", "fade", "heat"], src = [look.scuff, look.grain, look.marbles, look.cords, look.fade, look.heat];
  const last = TW.set || (TW.set = [-1, -1, -1, -1, -1, -1]);
  for(let i = 0; i < 6; i++) if(Math.abs(src[i] - last[i]) > 0.005){ last[i] = src[i]; tyEl.style.setProperty("--" + keys[i], src[i].toFixed(3)); }
  const wear = $("#h-wear"); wear.style.width = (TW.life * 100).toFixed(0) + "%"; wear.style.background = barColour(TW.life);
  const sg = stageOf(TW.life);
  if(sg !== TW.stage){
    const lab = $("#h-wstage");
    if(TW.stage < 0) lab.textContent = STAGES[sg].name;
    else { lab.classList.add("swap"); clearTimeout(TW.swap); TW.swap = setTimeout(() => { lab.textContent = STAGES[sg].name; lab.classList.remove("swap"); }, 150); }
    TW.stage = sg;
  }
}

function updateHUD(){
  if(!S || !S.player) return;
  const c = S.player, T = S.track, ms = S.clock * 1000;
  $("#h-pos").innerHTML = `${c.pos}<small>/${S.cars.length}</small>`;
  $("#h-lap").innerHTML = S.mode === "race" ? `${clamp(c.lap, 1, S.laps)}<small>/${S.laps}</small>`
    : `${Math.max(1, c.lap)}<small>/∞</small>`;
  const cur = c.lapStart == null ? 0 : ms - c.lapStart;
  $("#h-time").textContent = c.lapStart == null ? "OUT LAP" : fmtTime(cur);
  for(let i = 0; i < 3; i++){
    const n = document.getElementById("s" + (i + 1)), t = c.secT[i];
    n.style.background = t == null ? "#2B333D"
      : (S.bestSec && t <= S.bestSec[i]) ? "var(--purple)"
      : (t <= c.secBest[i]) ? "var(--green)" : "var(--yellow)";
  }
  $("#h-last").textContent = c.best ? `Best ${fmtTime(c.best)}` : c.last ? `Last ${fmtTime(c.last)}` : "No time set";
  const cond = $("#h-cond");
  if(S.wet > 0.12){
    cond.hidden = false;
    cond.textContent = (S.wet > 0.65 ? "Heavy rain" : S.wet > 0.35 ? "Rain" : "Light rain") +
      (c.tyre.key === "wet" ? "" : " · slicks");
    cond.style.color = c.tyre.key === "wet" ? "var(--cyan)" : "var(--red)";
  } else cond.hidden = true;
  const pl = S.mode === "tt" ? "" : hudLine(S, c), pn = $("#h-pen");
  pn.hidden = !pl; if(pl && pn.textContent !== pl){ pn.textContent = pl; }
  pn.classList.toggle("owed", !!(c.pen && c.pen.todo.length));
  const scEl = $("#h-sc"), scs = S.sc ? S.sc.state : "off";
  scEl.hidden = scs === "off";
  if(scs !== "off"){
    const t = scs === "out" ? "SAFETY CAR · NO OVERTAKING" : "SAFETY CAR IN THIS LAP";
    if(scEl.textContent !== t) scEl.textContent = t;
  }
  // slipstream / dirty air (aero.js): dirty air wins when both are present
  const aeEl = $("#h-aero"), live = S.state !== "lights" && !c.dnf && !c.wrecked;
  const aeK = !live ? "" : c.dirty > 0.2 ? "dirty" : c.tow > 0.15 ? "tow" : "";
  aeEl.hidden = !aeK;
  if(aeK){
    const t = aeK === "tow" ? "SLIPSTREAM" : "DIRTY AIR";
    if(aeEl.textContent !== t) aeEl.textContent = t;
    aeEl.classList.toggle("dirty", aeK === "dirty");
  }
  const ty = c.tyre;
  const cmp = $("#h-cmp"); if(cmp.textContent !== ty.label) cmp.textContent = ty.label;
  const tyEl = $("#h-tyre"); if(tyEl._col !== ty.col){ tyEl._col = ty.col; tyEl.style.setProperty("--tyc", ty.col); }
  tyreWearHud(c, tyEl);
  const dbox = $("#h-dmg"), anyD = c.damage > 0.02 || c.broken.size > 0;
  dbox.hidden = !anyD;
  if(anyD){
    const bar = $("#h-dmgbar");
    bar.style.width = (clamp(c.damage, 0, 1) * 100).toFixed(0) + "%";
    bar.style.background = c.damage > 0.6 ? "var(--red)" : c.damage > 0.3 ? "var(--yellow)" : "var(--green)";
    dbox.classList.toggle("bad", c.broken.size > 0);
    const chips = [...c.broken].map(k => "<b>" + PARTS[k].label + "</b>").join("");
    const host = $("#h-chips");
    if(host.dataset.k !== chips){ host.dataset.k = chips; host.innerHTML = chips; }
  }
  pitPanel(c, S);
  $("#h-status").hidden = false;
  updateStatus(c);
  $("#h-ebat").textContent = Math.round(c.batt * 100) + "%";
  $("#h-ebar").style.width = (c.batt * 100).toFixed(0) + "%";
  $("#h-energy").classList.toggle("on", c.boost > 0 && c.batt > 0.01);
  const kph = c.speed * 3.6;
  const launching = S.state === "lights";
  const revN = launching ? c.revs : clamp((rpmOfCar(c) - 4200) / 9200, 0, 1);
  const bar = $("#h-tachbar");
  $("#h-tach").style.width = (revN * 100).toFixed(1) + "%";
  bar.classList.toggle("good", launching && c.revs >= LAUNCH_LO && c.revs <= LAUNCH_HI);
  bar.classList.toggle("hot", launching ? c.revs > LAUNCH_HI : revN > 0.9);
  $("#h-spd").textContent = Math.round(kph);
  $("#h-gear").textContent = c.speed < 0.5 ? "N" : gearOf(c);

  const arr = S.cars.filter(x => !x.dnf).sort((a, b) => a.pos - b.pos);
  let start = clamp(c.pos - 3, 0, Math.max(0, arr.length - 6));
  const rows = $("#h-board").children;
  for(let i = 0; i < 6; i++){
    const o = arr[start + i], r = rows[i];
    if(!o){ r.style.display = "none"; continue; }
    r.style.display = "";
    r.classList.toggle("me", o === c);
    r.style.setProperty("--c", o.team.body);
    r.children[0].textContent = o.pos;
    r.children[1].textContent = o.drv.abbr;
    r.children[2].textContent = o === arr[0] ? "LEADER" : fmtGap(o.gapAhead);
  }
}


export { buildBoard, updateHUD };
