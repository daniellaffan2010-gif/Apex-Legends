import { $ } from '../config/util.js';
import { S, paused, setPaused } from '../game/session.js';
import { AUDIO } from '../audio/audio.js';

/* ---------- 7. interface -------------------------------------------------- */
const SCREENS = ["screen-title", "screen-setup", "screen-results", "screen-standings", "screen-garage"];
function show(id){
  for(const s of SCREENS) document.getElementById(s).hidden = (s !== id);
  const racing = id === null;
  $("#hud").hidden = !racing || !S;
  $("#touch").hidden = !racing || !("ontouchstart" in window || navigator.maxTouchPoints > 0);
}
let msgT = 0;
function showMsg(big, small, secs){
  const m = $("#msg"); $("#msg-b").textContent = big; $("#msg-s").textContent = small || "";
  m.hidden = false; clearTimeout(msgT); msgT = setTimeout(() => { m.hidden = true; }, secs * 1000);
}
let toastT = 0;
function showToast(txt, secs){
  const t = $("#toast"); t.textContent = txt; t.classList.add("on");
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("on"), (secs || 2.6) * 1000);
}
function togglePause(){
  if(!S || S.state === "done") return;
  setPaused(!paused); $("#pause").hidden = !paused;
  if(paused) try{ AUDIO.silence(); }catch(e){}
  const eb = document.getElementById("pb-end");
  if(eb) eb.hidden = !(S && S.mode !== "race");
  if(paused) $("#pause-sub").textContent =
    `${S.track.name} · ${S.mode === "race" ? "Race" : S.mode === "qualy" ? "Qualifying" : "Time trial"} · Lap ${Math.max(1, S.player.lap)}${S.mode === "race" ? " of " + S.laps : ""}`;
}


export { show, showMsg, showToast, togglePause };
