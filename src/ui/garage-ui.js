/* The garage screen: saved setups + four sliders on the left, lap telemetry on the right. Everything here is
   data in, DOM out; the car itself reads the fitted setup in session.js (Garage.fitted). */
import { $, el, fmtTime } from '../config/util.js';
import { CFG } from '../config/settings.js';
import { TRACKS } from '../tracks/index.js';
import { SLIDERS, tune } from '../car/tune.js';
import * as Garage from '../game/garage.js';
import * as Tele from '../game/telemetry.js';
import { show } from './screens.js';

let gid = null;            // the setup being edited (also the fitted one)
let trackId = null;

const pct = v => (v >= 0 ? "+" : "") + (v * 100).toFixed(1).replace(/\.0$/, "") + "%";

function editing(){
  const g = Garage.load();
  return g.list.find(x => x.id === gid) || Garage.selected(g);
}

function drawSets(){
  const g = Garage.load(), host = $("#g-sets"); host.innerHTML = "";
  for(const s of g.list){
    const b = el("button", "gset" + (s.id === g.sel ? " sel" : ""),
      `<b>${s.name.replace(/</g, "&lt;")}</b><small>${s.id === g.sel ? "Fitted" : "Fit"}</small>`);
    b.onclick = () => { gid = s.id; Garage.select(s.id); refresh(); };
    host.appendChild(b);
  }
  $("#g-add").disabled = $("#g-dup").disabled = g.list.length >= Garage.MAX;
  $("#g-del").disabled = g.list.length <= 1;
}

function drawSliders(){
  const s = editing(), host = $("#g-sliders"); host.innerHTML = "";
  for(const d of SLIDERS){
    const row = el("div", "gslide",
      `<div class="gs-h"><span>${d.label}</span><span class="num gs-v"></span></div>
       <input type="range" min="0" max="100" step="1">
       <div class="gs-e"><span>${d.lo}</span><span>${d.hi}</span></div>`);
    const inp = row.querySelector("input"), val = row.querySelector(".gs-v");
    const show_ = v => { val.textContent = v === 50 ? "Standard" : (v > 50 ? "+" : "") + (v - 50); };
    inp.value = Math.round(s[d.key] * 100); show_(+inp.value);
    inp.oninput = () => {
      show_(+inp.value);
      const cur = editing(); cur[d.key] = +inp.value / 100;
      Garage.upsert(cur); drawFx();
    };
    host.appendChild(row);
  }
}

function drawFx(){
  const t = tune(editing()), rows = [
    ["Cornering grip", t.grip - 1], ["Top speed", t.top - 1], ["Acceleration", t.power - 1],
    ["Drag", t.drag - 1], ["Stopping force", t.brake - 1], ["Tyre life", 1 / t.wear - 1]
  ];
  $("#g-fx").innerHTML = rows.map(([n, v]) =>
    `<div class="fx ${Math.abs(v) < 0.0005 ? "" : v > 0 ? (n === "Drag" ? "bad" : "up") : (n === "Drag" ? "up" : "bad")}"><span>${n}</span><b class="num">${Math.abs(v) < 0.0005 ? "–" : pct(v)}</b></div>`).join("")
    + `<div class="fx ${t.stab < 0.999 ? "up" : t.stab > 1.001 ? "bad" : ""}"><span>Lock-up risk</span><b class="num">${Math.abs(t.stab - 1) < 0.0005 ? "–" : pct(t.stab - 1)}</b></div>`;
}

/* ---- telemetry chart: speed (filled line) over the lap distance, throttle/brake bars under it ---- */
function trace(ctx, rows, col, w, h, top, vmax){
  if(!rows || rows.length < 2) return;
  ctx.beginPath(); ctx.strokeStyle = col; ctx.lineWidth = 2;
  rows.forEach((q, i) => {
    const x = q[Tele.COL.s] * w, y = top + h - (q[Tele.COL.kph] / vmax) * h;
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  });
  ctx.stroke();
}
function pedals(ctx, rows, col, w, y0, hh){
  if(!rows) return;
  ctx.fillStyle = col;
  for(let i = 1; i < rows.length; i++){
    const a = rows[i - 1], b = rows[i], x = a[Tele.COL.s] * w, bw = Math.max(1, (b[Tele.COL.s] - a[Tele.COL.s]) * w);
    if(bw > 40 || bw < 0) continue;
    if(b[Tele.COL.thr] > 0.05) ctx.fillRect(x, y0 + hh * (1 - b[Tele.COL.thr]), bw, hh * b[Tele.COL.thr]);
  }
}
function drawChart(d){
  const cv = $("#g-chart"), ctx = cv.getContext ? cv.getContext("2d") : null;
  if(!ctx) return;
  const W = cv.width, H = cv.height, cs = getComputedStyle(document.documentElement);
  const col = (n, f) => (cs.getPropertyValue(n) || "").trim() || f;
  ctx.clearRect(0, 0, W, H);
  const best = d.best && d.best.samples, last = d.last && d.last.samples;
  const sp = 190, vmax = Math.max(340, ...[best, last].filter(Boolean).map(r => Math.max(...r.map(q => q[Tele.COL.kph])))) ;
  ctx.strokeStyle = col("--line", "#262E38"); ctx.lineWidth = 1; ctx.font = "10px monospace"; ctx.fillStyle = col("--dimmer", "#6c7683");
  for(let v = 100; v < vmax; v += 100){
    const y = sp - (v / vmax) * sp + 6;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); ctx.fillText(v + "", 3, y - 2);
  }
  if(!best){
    ctx.fillStyle = col("--dim", "#98a2ad"); ctx.font = "13px sans-serif";
    ctx.fillText("No clean lap recorded here yet. Drive one and it appears.", 16, H / 2);
    return;
  }
  const purple = col("--purple", "#b46cff"), amber = col("--amber", "#ffb020");
  // sector marks at the best lap's section times
  trace(ctx, best, purple, W, sp, 6, vmax);
  if(last && d.last.tm !== d.best.tm) trace(ctx, last, amber, W, sp, 6, vmax);
  const y0 = sp + 22, hh = 40;
  ctx.globalAlpha = .55; pedals(ctx, best, purple, W, y0, hh);
  ctx.globalAlpha = 1;
  if(last && d.last.tm !== d.best.tm){ ctx.globalAlpha = .45; pedals(ctx, last, amber, W, y0 + hh + 8, hh); ctx.globalAlpha = 1; }
  ctx.fillStyle = col("--dimmer", "#6c7683"); ctx.font = "10px monospace";
  ctx.fillText("start", 3, H - 4); ctx.fillText("finish", W - 36, H - 4);
}

function drawStats(d){
  const rec = d.last || d.best, host = $("#g-stats");
  if(!rec){ $("#g-note").textContent = Tele.note(null); host.innerHTML = ""; return; }
  const st = rec.stats || Tele.stats(rec.samples);
  $("#g-note").textContent = Tele.note(st, rec.setup);
  const cell = (k, v) => `<div><span>${k}</span><b class="num">${v}</b></div>`;
  host.innerHTML = cell("Best lap", d.best ? fmtTime(d.best.t) : "–") + cell("Last lap", d.last ? fmtTime(d.last.t) : "–")
    + (st ? cell("Top speed", Math.round(st.top) + " km/h") + cell("Slowest", Math.round(st.min) + " km/h")
      + cell("Full throttle", Math.round(st.full * 100) + "%") + cell("Braking", Math.round(st.brake * 100) + "%") : "");
}

function drawBy(d){
  const rows = Object.values(d.by || {}).sort((a, b) => a.t - b.t), host = $("#g-by");
  host.innerHTML = rows.length ? rows.map((r, i) =>
    `<div class="by${i === 0 ? " top" : ""}"><span>${String(r.name).replace(/</g, "&lt;")}</span><span class="dim">${r.tyre || ""}</span><b class="num">${fmtTime(r.t)}</b></div>`).join("")
    : `<div class="by"><span class="dim">Nothing yet. Set a clean lap on this circuit.</span></div>`;
}

function drawTrack(){
  const d = Tele.forTrack(trackId);
  drawChart(d); drawStats(d); drawBy(d);
}

function refresh(){ drawSets(); $("#g-name").value = editing().name; drawSliders(); drawFx(); drawTrack(); }

let wired = false;
function wire(){
  if(wired) return; wired = true;
  const sel = $("#g-track");
  for(const t of TRACKS) sel.appendChild(el("option", "", t.name)).value = t.id;
  sel.onchange = () => { trackId = sel.value; drawTrack(); };
  $("#g-add").onclick = () => { const g = Garage.add("Setup " + (Garage.load().list.length + 1), editing()); gid = g.sel; refresh(); };
  $("#g-dup").onclick = () => { const cur = editing(); const g = Garage.add(cur.name.slice(0, 14) + " 2", cur); gid = g.sel; refresh(); };
  $("#g-del").onclick = () => { const g = Garage.remove(editing().id); gid = g.sel; refresh(); };
  $("#g-reset").onclick = () => { const cur = editing(); for(const d of SLIDERS) cur[d.key] = 0.5; Garage.upsert(cur); refresh(); };
  $("#g-name").oninput = () => { const cur = editing(); cur.name = $("#g-name").value.trim() || "Setup"; Garage.upsert(cur); drawSets(); };
  $("#g-clear").onclick = () => { Tele.clearTrack(trackId); drawTrack(); };
}

function openGarage(){
  wire();
  gid = Garage.selected().id;
  trackId = TRACKS.some(t => t.id === CFG.trackId) ? CFG.trackId : TRACKS[0].id;
  $("#g-track").value = trackId;
  show("screen-garage");
  refresh();
}

export { openGarage };
