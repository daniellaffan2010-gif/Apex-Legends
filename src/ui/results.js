import { $, el, fmtGap, fmtTime, store } from '../config/util.js';
import { TRACKS } from '../tracks/index.js';
import { CFG } from '../config/settings.js';
import { S, setS, startSession } from '../game/session.js';
import { show } from './screens.js';
import { buildSetup } from './setup.js';
import { showStandings, startChampWeekend } from './championship.js';

/* ---------- results ---------- */
function showResults(res){
  if(S.mode === "qualy"){
    res.sort((a, b) => (a.best == null) - (b.best == null) || (a.best - b.best));
    res.forEach((r, i) => r.pos = i + 1);
  }
  const winner = res[0];
  $("#res-title").innerHTML = S.mode === "qualy" ? `Qualifying <i>result</i>` : S.mode === "tt" ? `Time <i>trial</i>` : `Race <i>result</i>`;
  $("#res-sub").textContent = `${S.track.name} · ${S.track.loc}${S.mode === "race" ? " · " + S.laps + " laps" : ""}`;
  const t = $("#res-tbl");
  t.innerHTML = `<thead><tr><th class="r">Pos</th><th>Driver</th><th>Team</th>
    <th class="r">${S.mode === "qualy" ? "Best lap" : "Gap"}</th><th class="r">Best lap</th><th class="r">Stops</th><th>Tyre</th></tr></thead>`;
  const body = el("tbody");
  for(const r of res){
    const c = r.car, me = c === S.player;
    const gapCell = r.dnf ? "DNF" : S.mode === "qualy" ? fmtTime(r.best)
      : r.dq ? `<span title="${(r.dqReason || "Disqualified").replace(/"/g, "&quot;")}">DSQ</span>` : r.pos === 1 ? (S.mode === "race" ? (r.total != null ? fmtTime(r.total) : c.finished ? fmtTime(c.finishTime) : "—") : fmtTime(r.best)) : fmtGap(r.gap);
    const row = el("tr", me ? "me" : "");
    row.innerHTML = `<td class="r pos">${r.pos}</td>
      <td class="nm"><span class="bar" style="background:${c.team.body}"></span>${c.drv.abbr} ${c.drv.last}</td>
      <td class="tm">${c.team.short}</td>
      <td class="r num" style="color:${r.dnf ? "var(--red)" : "inherit"}">${gapCell}${r.pen ? `<span class="res-pen">+${r.pen}s</span>` : ""}</td>
      <td class="r num" style="color:${S.fastestBy === c ? "var(--purple)" : "inherit"}">${fmtTime(r.best)}</td>
      <td class="r num">${S.mode === "race" ? r.stops : "—"}</td>
      <td class="tm" style="color:${r.dnf ? "var(--dim)" : r.tyre.col}">${r.dnf ? (c.retiredBy || "Retired") : r.tyre.name}</td>`;
    body.appendChild(row);
  }
  t.appendChild(body);
  const old = t.parentNode.querySelector(".pennotes"); if(old) old.remove();
  const mine = S.mode === "race" ? (S.penLog || []).filter(e => e.me && !/ served$/.test(e.text)) : [];
  const myRow = S.mode === "race" ? res.find(r => r.car === S.player) : null;
  if(myRow && myRow.dq && !mine.length){
    t.after(el("div", "pennotes", `<b>You were disqualified</b><div>${myRow.dqReason || "Black flag"}</div>`));
  } else if(mine.length){
    const n = el("div", "pennotes", "<b>Your penalties</b>");
    let total = 0;
    for(const e of mine){
      const sec = e.sec || (e.conv && !e.served ? e.conv : 0);
      total += sec;
      const tail = sec ? ` · +${sec} s` : e.served ? " · served in the pit lane" : "";
      n.appendChild(el("div", "", `Lap ${e.lap} · ${e.text}${e.reason ? " — " + e.reason : ""}${tail}`));
    }
    const pl = S.penPlaces || 0;
    if(myRow && myRow.dq) n.appendChild(el("div", "", `<b>Disqualified — ${myRow.dqReason || "black flag"}</b>`));
    else n.appendChild(el("div", "", `<b>Total +${total} s · ${pl ? pl + (pl === 1 ? " place" : " places") + " lost" : "no places lost"}</b>`));
    t.after(n);
  }

  const acts = $("#res-actions"); acts.innerHTML = "";
  const add = (label, cls, fn) => { const b = el("button", "btn " + cls, label); b.onclick = fn; acts.appendChild(b); };
  if(S.mode === "qualy" && S.champ){
    add("Go to the race", "primary", () => {
      const grid = res.map(r => r.car.drv.abbr);
      startSession("race", { grid });
    });
  } else if(S.champ){
    const ch = store("champ");
    if(ch && ch.round < TRACKS.length) add(`Next round · ${TRACKS[ch.round].name}`, "primary", () => startChampWeekend());
    else add("Season complete — standings", "primary", () => showStandings());
    add("Standings", "", () => showStandings());
  } else {
    add("Race again", "primary", () => startSession(S.mode === "tt" ? "tt" : S.mode, null));
    add("Change setup", "", () => buildSetup(CFG.mode));
  }
  add("Paddock", "ghost", () => { setS(null); show("screen-title"); });
  show("screen-results");
}


export { showResults };
