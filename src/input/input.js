import { clamp } from '../config/util.js';
import { R } from '../render2d/view.js';
import { S, cycleView, paused, recover, requestPit } from '../game/session.js';
import { AUDIO } from '../audio/audio.js';
import { togglePause } from '../ui/screens.js';

const KEY = {};
addEventListener("keydown", e => {
  if(["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"," "].includes(e.key)) e.preventDefault();
  KEY[e.key.toLowerCase()] = true;
  if(e.key === "Escape") togglePause();
  if(e.key.toLowerCase() === "p" && S && S.state === "run") requestPit();
  if(e.key.toLowerCase() === "r" && S && S.state === "run") recover();
  if(e.key.toLowerCase() === "c" && !e.repeat && S && !paused) cycleView();
  if(e.key.toLowerCase() === "m"){ try{ AUDIO.init(); AUDIO.toggle(); }catch(err){} }
});
addEventListener("keyup", e => { KEY[e.key.toLowerCase()] = false; });

/* The wheel pulls the camera in and pushes it out. It is a multiplier over
   whatever the automatic framing wants, not a replacement for it, so speed,
   the launch and the pit lane all still move the camera underneath you. Leave
   it alone for five seconds and it eases back to the automatic framing. */
const ZOOM_HOLD = 5;                               // seconds before it lets go
addEventListener("wheel", e => {
  if(!S || paused || S.menuOpen || S.state === "done") return;
  if(e.target.closest && e.target.closest(".screen, .panel, #pause")) return;
  e.preventDefault();
  // trackpads report pixels, mice report lines or pages
  const d = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
  R.userZoom = clamp(R.userZoom * Math.exp(-clamp(d, -240, 240) * 0.0016), 0.45, 3.2);
  R.userZoomT = 0;
}, { passive:false });
addEventListener("blur", () => { for(const k in KEY) KEY[k] = false; });

const TOUCH = { l:0, r:0, gas:0, brk:0, boost:0 };
function bindTouch(){
  const map = { "t-l":"l", "t-r":"r", "t-gas":"gas", "t-brk":"brk", "t-boost":"boost" };
  for(const id in map){
    const n = document.getElementById(id), k = map[id];
    const on = e => { e.preventDefault(); TOUCH[k] = 1; n.classList.add("act"); };
    const off = e => { e.preventDefault(); TOUCH[k] = 0; n.classList.remove("act"); };
    n.addEventListener("pointerdown", on); n.addEventListener("pointerup", off);
    n.addEventListener("pointercancel", off); n.addEventListener("pointerleave", off);
  }
  const cam = document.getElementById("t-cam");
  if(cam) cam.addEventListener("pointerdown", e => { e.preventDefault(); if(!paused) cycleView(); });
}


export { KEY, TOUCH, ZOOM_HOLD, bindTouch };
