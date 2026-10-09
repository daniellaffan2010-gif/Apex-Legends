/* The stewards in Node: whole AI-only races through the real update loop (spins, penalties, serving, classification), plus
   unit checks of every penalty type, the player's pit-lane serving and the results ordering.   node --import ./scripts/asset-register.mjs scripts/penalty-test.mjs [track] [races] */
globalThis.window = globalThis;
const els = new Map();
const el = id => { if (!els.has(id)) els.set(id, new Proxy({ textContent: '', hidden: false, style: { setProperty() {} }, dataset: {}, children: [], classList: { toggle() {}, add() {}, remove() {} }, appendChild() {}, setAttribute() {}, addEventListener() {}, querySelector() { return null; } }, { get: (t, k) => (k in t ? t[k] : () => el('x')), set: (t, k, v) => ((t[k] = v), true) })); return els.get(id); };
globalThis.document = { getElementById: el, querySelector: s => el(s), querySelectorAll: () => [], createElement: () => el('n' + Math.random()), body: { appendChild() {} }, addEventListener() {} };
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.addEventListener = () => {}; globalThis.innerWidth = 1280; globalThis.innerHeight = 720; globalThis.devicePixelRatio = 1;

globalThis.requestAnimationFrame = () => 0; globalThis.Image = class { set src(v) {} };
let toasts = [], msgs = [];
const SC = await import('../src/ui/screens.js');
const SS = await import('../src/game/session.js');
const PEN = await import('../src/game/penalties.js');
const { CFG } = await import('../src/config/settings.js');
const { R } = await import('../src/render2d/view.js'); R.cv = { clientWidth: 1280, clientHeight: 720, style: {} }; R.ctx = { setTransform() {} }; R.W = 1280; R.H = 720;

const id = process.argv[2] || 'monza', races = +(process.argv[3] || 3);
CFG.trackId = id; CFG.lapsIdx = 0; CFG.weather = 'dry'; CFG.damage = true;
let fail = 0; const ok = (c, m) => { if (!c) { fail++; console.log('FAIL', m); } };

// ---------- 1. whole races, everybody on AI ----------
const tot = { spins: 0, pens: 0, byKind: {}, serves: 0, notServed: 0, dsq: 0, reorder: 0, nan: 0, notices: 0, grid: 0 };
for (let r = 0; r < races; r++) {
  SS.startSession('race', null);
  let S = SS.S; S.player.ai = true;                     // the player drives as an AI so the race runs on its own
  tot.grid += (S.gridDrops || []).length;
  const spinCount = new Map();
  let steps = 0; const t0 = Date.now();
  while (!S.ended && steps < 60 * 60 * 14) {
    S.cars.forEach(c => { c._sp = c.spinT > 0; });
    SS.update(1 / 60, 1 / 60); steps++;
    for (const c of S.cars) { if (c.spinT > 0 && !c._sp && c.ai) tot.spins++; if (!isFinite(c.x + c.y + c.vx + c.vy)) tot.nan++; }
    if (S.state === 'run' && S.cars.every(c => c.dnf || c.finished)) break;
    if (S.cars.filter(c => c.finished).length >= 3 && S.player.finished && !S.ended) break;
  }
  S.cars.forEach(c => { if (c.pen) { tot.pens += c.pen.n; } });
  for (const e of S.penLog || []) { const k = e.text.replace(/ \(.*/, ''); tot.byKind[k] = (tot.byKind[k] || 0) + 1; if (/served$/.test(e.text)) tot.serves++; if (/not served/.test(e.text)) tot.notServed++; }
  tot.dsq += S.cars.filter(c => c.pen && c.pen.dsq).length;
  tot.notices += S.penQ ? S.penQ.length : 0;
  // endSession for whoever is still running, to check the classification
  if (!S.ended) SS.endSession();
  const res = S.results; ok(res && res.length === S.cars.length, 'results has every car');
  const posOk = res.every((x, i) => x.pos === i + 1); ok(posOk, 'positions are 1..n');
  const pen = res.filter(x => x.pen);
  const gaps = res.filter(x => !x.dnf && !x.dq && x.gap != null).map(x => x.gap); ok(gaps.every(g => isFinite(g)), 'finite gaps');
  console.log(`race ${r + 1}: ${steps} steps in ${((Date.now() - t0) / 1000).toFixed(1)}s · log ${(S.penLog || []).length} · penalised ${pen.length} ${pen.map(x => x.car.drv.abbr + '+' + x.pen).join(' ')} · dsq ${res.filter(x => x.dq).length}`);
}
console.log('TOTAL', JSON.stringify(tot));
ok(tot.nan === 0, 'no NaN');
ok(tot.spins > 0, 'the AI spun at least once over the races');

// ---------- 2. every penalty on the player, with its message ----------
SS.startSession('race', null);
let S = SS.S, p = S.player; S.state = 'run'; S.clock = 20; p.lap = 2; p.lapStart = 1000;
const say = () => el('#msg-b').textContent + ' | ' + el('#msg-s').textContent;
const cases = [['warn', 'Track limits — warning 1 of 3', /WARNING/], ['rep', 'Driving with a lack of care', /REPRIMAND/], ['t5', 'Causing a collision', /5 SECOND/],
  ['t10', 'Causing a serious collision', /10 SECOND/], ['dt', 'Dangerous driving', /DRIVE-THROUGH/], ['sg', 'Serious breach', /STOP-AND-GO/]];
for (const [k, why, re] of cases) { PEN.issue(S, p, k, why); ok(re.test(say()), k + ' message: ' + say()); console.log(k.padEnd(5), '→', say()); }
ok(p.pen.time === 15, 'time penalties add up (5+10): ' + p.pen.time); ok(p.pen.todo.length === 2, 'dt and sg waiting');
console.log('HUD line:', PEN.hudLine(S, p));
// reprimand escalation
const q = S.cars.find(c => c.ai); PEN.issue(S, q, 'rep', 'a'); PEN.issue(S, q, 'rep', 'b'); PEN.issue(S, q, 'rep', 'c'); ok(q.pen.todo.some(t => t.kind === 'dt'), 'third reprimand is a drive-through');
// no time to serve → time
const late = S.cars.filter(c => c.ai)[1]; late.lap = S.laps; PEN.issue(S, late, 'dt', 'x'); ok(late.pen.time === 20 && !late.pen.todo.length, 'drive-through on the last lap becomes +20 s');
// ---------- 3. serving through the real player pit code: the call, the lane driving itself, the exit ----------
const PIT = await import('../src/car/pit.js');
const laneRun = (v0, maxT) => {           // put the player on the entry road 30 m before the speed-limit line, in the lane, and run the lane
  const T = S.track, aS = Math.max(3, T.pitLimA - 30), f = T.pitFOf(T.pitSOf(T.pitIn) + aS), i = Math.floor(f) % T.n;
  p.place(i, T.pitFast(f)); p.vx = Math.cos(p.h) * v0; p.vy = Math.sin(p.h) * v0; p.inPit = true; p.pitVisit = false;
  let held = 0, stopped = false;
  for (let k = 0; k < 60 * (maxT || 60); k++) {
    SS.update(1 / 60, 1 / 60);
    if (p.pp && p.pp.phase === 'stopped') { stopped = true; held = p.pp.st.t; }
    if (!p.pitVisit && !p.pitting && k > 30 && T.pitU(p.node) < 0) break;
  }
  return { held, stopped };
};
p.lap = 2; S.state = 'run';
PIT.callPit(p, S); ok(p.pitPlan && p.pitPlan.pen === 'dt' && p.pitPlan.none && !S.menuOpen && p.pitReq, 'a penalty visit opens no menu and does not stop (dt)');
const tyreA = p.tyre, stopsA = p.stops;
let r = laneRun(S.track.pitLimit);
ok(!r.stopped && !p.pen.todo.some(t => t.kind === 'dt'), 'drive-through served at pit exit, without stopping'); console.log('after serving:', say());
PIT.callPit(p, S); ok(p.pitPlan && p.pitPlan.pen === 'sg' && !p.pitPlan.none, 'stop-go plan');
r = laneRun(S.track.pitLimit);
ok(r.held >= 9.9 && r.held <= 10.6, 'stop-go holds the car for 10 s: ' + r.held.toFixed(2));
ok(!p.pen.todo.length && p.stops === stopsA && p.tyre === tyreA, 'stop-go touches nothing and counts no stop');
// ---------- 4. classification ----------
SS.startSession('race', null); S = SS.S; S.state = 'run'; S.clock = 300;
S.cars.forEach((c, i) => { c.finished = true; c.finishTime = 280000 + i * 700; c.lap = S.laps + 1; });
S.cars[0].pen = null; PEN.issue(S, S.cars[0], 't10', 'test');           // winner gets 10 s: drops behind cars 1..~14
S.player.finished = true; const abbrW = S.cars[0].drv.abbr;
SS.endSession(); const R2 = S.results; const wi = R2.findIndex(x => x.car === S.cars[0]);
ok(wi >= 10 && wi <= 20, 'a 10 s penalty on the winner drops him ~14 places: ' + wi); ok(R2[0].car !== S.cars[0], 'new winner'); ok(R2[0].total != null, 'winner has a total');
const DSQ = S.cars[5]; 
console.log('winner', abbrW, 'dropped to P' + (wi + 1), '· new winner', R2[0].car.drv.abbr, 'time', R2[0].total);
// ---------- 5. an AI car serves a drive-through and a stop-and-go through the real pit-lane code ----------
SS.startSession('race', null); S = SS.S; S.player.ai = true;
for (let i = 0; i < 60 * 70; i++) SS.update(1 / 60, 1 / 60);
const vic = S.cars.filter(c => c.ai && !c.dnf && c.lap >= 1 && c.lap < S.laps - 1);
const A1 = vic[2], A2 = vic[6]; const st1 = A1.stops, st2 = A2.stops;
PEN.issue(S, A1, 'dt', 'test dt'); PEN.issue(S, A2, 'sg', 'test sg');
let t1 = null, t2 = null, hold = 0;
for (let i = 0; i < 60 * 200 && !S.ended; i++) {
  SS.update(1 / 60, 1 / 60);
  if (A2.pp && A2.pp.phase === 'stopped') hold = Math.max(hold, A2.pp.st.t);
  if (!A1.pen.todo.length && t1 == null) t1 = i / 60; if (!A2.pen.todo.length && t2 == null) t2 = i / 60;
  if (t1 != null && t2 != null) break;
}
if (t2 == null) console.log('A2 at the end:', A2.drv.abbr, 'lap', A2.lap, 'of', S.laps, 'pitReq', A2.pitReq, 'servePen', A2.servePen, 'pitting', A2.pitting, A2.pp && A2.pp.phase, 'dnf', A2.dnf, 'aiFree', A2.aiFree, 'node', A2.node, 'u', S.track.pitU(A2.node).toFixed(2), 'ended', S.ended, 'todo', JSON.stringify(A2.pen.todo));
ok(t1 != null, 'AI drive-through served (' + t1 + ' s)'); ok(t2 != null, 'AI stop-go served (' + t2 + ' s)');
console.log('stops', st1, A1.stops, st2, A2.stops, 'time', A1.pen.time, A2.pen.time, (S.penLog||[]).filter(e => e.abbr === A1.drv.abbr || e.abbr === A2.drv.abbr).map(e => e.text).join(' / '));
ok(A1.stops - st1 <= 1 && A2.stops - st2 <= 1, 'penalty visits count as no stop'); ok(hold > 9, 'stop-go held ~10 s: ' + hold.toFixed(1));
ok(!(S.penLog||[]).some(e => /not served/.test(e.text)), 'served penalties are not converted to time');
console.log('AI served dt after', t1 && t1.toFixed(0), 's, sg after', t2 && t2.toFixed(0), 's');
// ---------- 6. track limits, collision fault, blue flags, pit speeding on the player ----------
// one stop on the same compound is legal now: the rule is only that you pit
SS.startSession('race', null); S = SS.S; p = S.player; p.finished = true; p.finishTime = 300000; p.lap = S.laps + 1; p.stops = 1; p.used = new Set(['medium']); S.state = 'run'; SS.endSession();
{ const row = S.results.find(r => r.car === p); ok(row && !row.dq, 'a stop on the same compound is not disqualified: ' + (row && row.dqReason)); }
SS.startSession('race', null); S = SS.S; p = S.player; PEN.st(p); S.state = 'run'; S.clock = 30; p.lap = 2; p.lapStart = 1000; p.vx = 50; p.vy = 0;
// leaving the track only costs a penalty when the game measures a gain: time out vs the AI reference over the same distance
const excursion = (dist, secs, speed) => {
  S.penQ = []; S.penNext = 1e9; p.vx = speed; p.vy = 0; p.spinT = 0; p.wrecked = false; p.inPit = false; p.pitting = 0; p.s = 500; p.off = S.track.half + 3.5;
  const n = Math.round(secs * 10);
  for (let i = 0; i < n; i++) { p.s += dist / n; S.clock += 0.1; PEN.tick(S, 0.1); }
  p.off = 0; for (let i = 0; i < 3; i++) { S.clock += 0.1; PEN.tick(S, 0.1); }
};
const qtxt = () => (S.penQ || []).map(m => m.text).join(' | ');
let t0p = p.pen ? p.pen.time : 0;
excursion(160, 0.8, 70); ok(p.pen.time === t0p + 5, 'a shortcut that gains time is a 5 s penalty: ' + qtxt() + ' / time ' + p.pen.time);
ok(S.penLog.some(e => e.me && /gaining an advantage \(\d+\.\d s\)/.test(e.reason || '')), 'the penalty reason states the time gained: ' + JSON.stringify(S.penLog.slice(-1)));
t0p = p.pen.time; excursion(25, 1.2, 30); ok(p.pen.time === t0p && /no advantage/.test(qtxt()), 'a slow trip over the gravel gains nothing, no penalty: ' + qtxt());
t0p = p.pen.time; S.penQ = []; S.penNext = 1e9; p.vx = 60; p.vy = 0; p.s = 500; p.off = S.track.half + 3.5;
for (let i = 0; i < 6; i++) { p.s += 20; S.clock += 0.1; if (i === 2) p.spinT = 1; PEN.tick(S, 0.1); }
p.spinT = 0; p.off = 0; for (let i = 0; i < 3; i++) { S.clock += 0.1; PEN.tick(S, 0.1); }
ok(p.pen.time === t0p, 'spinning off is never an advantage: ' + qtxt());
t0p = p.pen.time; excursion(160, 0.1, 70); ok(p.pen.time === t0p, 'a brief touch of the white line is ignored');
ok(!/LIMITS/.test(PEN.hudLine(S, p) || ''), 'no LIMITS n/3 counter any more');
// qualifying: the lap is deleted only when time was gained
SS.startSession('qualy', null); S = SS.S; p = S.player; S.state = 'run'; S.clock = 30; p.lap = 0; p.lapStart = 1000; p.lapInvalid = false;
excursion(25, 1.2, 30); ok(!p.lapInvalid, 'qualy: a slow excursion keeps the lap');
excursion(160, 0.8, 70); ok(p.lapInvalid && /LAP DELETED/.test(say()), 'qualy: a gaining excursion deletes the lap: ' + say());
// the black flag carries its reason, in the results row and in the finish message
SS.startSession('race', null); S = SS.S; p = S.player; PEN.issue(S, p, 'dsq', 'Ignoring the black flag');
ok(p.pen.dsq && p.pen.dsqReason === 'Ignoring the black flag', 'dsq stores its reason: ' + p.pen.dsqReason);
p.finished = true; p.finishTime = 300000; p.lap = S.laps + 1; S.state = 'run'; SS.endSession();
{ const row = S.results.find(r => r.car === p); ok(row && row.dq && row.dqReason === 'Ignoring the black flag', 'results row carries dqReason: ' + (row && row.dqReason)); ok(/Ignoring the black flag/.test(say()), 'finish message gives the reason: ' + say()); }
// the no-stop DSQ explains itself too
SS.startSession('race', null); S = SS.S; p = S.player; p.finished = true; p.finishTime = 300000; p.lap = S.laps + 1; p.stops = 0; p.used = new Set(['medium']); S.state = 'run'; SS.endSession();
{ const row = S.results.find(r => r.car === p); ok(row && row.dq && /pit stop|compound/.test(row.dqReason), 'tyre-rule DSQ has a reason: ' + (row && row.dqReason)); ok(/BLACK FLAG/.test(say()), 'tyre-rule DSQ shows the black flag message: ' + say()); }
SS.startSession('race', null); S = SS.S; p = S.player; PEN.st(p); S.state = 'run'; S.clock = 30; p.lap = 2; p.lapStart = 1000; p.vx = 50; p.vy = 0;
// a light tap is "noted", a hard shunt from behind is a penalty on the car behind
const B1 = S.cars.find(c => c !== p && c.ai), B2 = S.cars.find(c => c !== p && c !== B1 && c.ai);
for (const c of [B1, B2]) { c.spinT = 0; c.wrecked = false; c.pitting = 0; c.inPit = false; c.vx = c.vy = 0; }
B1.vx = 60; PEN.contact(S, B1, B2, 1, 0, 8, 6);               // B1 is behind B2 (B2.s - B1.s = +6), 8 m/s impact
ok(B1.pen && B1.pen.time === 5, 'the car behind is penalised for a shunt: ' + (B1.pen && B1.pen.time)); ok(!(B2.pen && B2.pen.n), 'the car in front is not');
// lapping car right behind a lapped player: blue flag, then a penalty for ignoring it
const lead = S.cars.find(c => c !== p && c.ai && c !== B1); lead.lap = p.lap + 1; lead.prog = p.prog + S.track.length - 40; lead.dnf = false; lead.finished = false; lead.pitting = 0;
const keepProg = lead.prog; p.prog = keepProg - S.track.length + 40;
const tP = p.pen.time; for (let i = 0; i < 40; i++) { lead.prog = keepProg; PEN.tick(S, 0.1); if (i === 12) ok(/BLUE FLAG/.test(say()), 'blue flag shown: ' + say()); }
for (let i = 0; i < 100; i++) { lead.prog = keepProg; p.prog = keepProg - S.track.length + 40; PEN.tick(S, 0.1); }
ok(p.pen.time >= tP + 5, 'ignoring the blue flag costs 5 s');
// pit-lane speeding: across the speed-limit line 30 km/h too fast
{ const T = S.track, tS = p.pen.time; p.pitReq = true; p.pitPlan = { tyre:'none', repairs:[], none:true };
  const aS = Math.max(3, T.pitLimA - 12), f = T.pitFOf(T.pitSOf(T.pitIn) + aS), i = Math.floor(f) % T.n;
  p.place(i, T.pitFast(f)); const v0 = T.pitLimit + 8.5; p.vx = Math.cos(p.h) * v0; p.vy = Math.sin(p.h) * v0; p.inPit = true; p.pitVisit = false;
  for (let k = 0; k < 60 && !p.pitting; k++) SS.update(1 / 60, 1 / 60);
  ok(p.pen.time === tS + 5, 'pit-lane speeding is 5 s: ' + (p.pen.time - tS)); }
// qualifying: track limits delete the lap
SS.startSession('qualy', null); S = SS.S; p = S.player; PEN.st(p); S.state = 'run'; S.clock = 30; p.lap = 2; p.lapStart = 1000; p.vx = 70; p.vy = 0; p.spinT = 0; p.s = 500;
p.off = S.track.half + 3.5; for (let i = 0; i < 8; i++) { p.s += 20; S.clock += 0.1; PEN.tick(S, 0.1); }
p.off = 0; for (let i = 0; i < 3; i++) { S.clock += 0.1; PEN.tick(S, 0.1); } ok(p.lapInvalid === true && /LAP DELETED/.test(say()), 'qualifying lap deleted: ' + say());
console.log('player checks done');
console.log(fail ? fail + ' FAILED' : 'all checks passed');
process.exit(fail ? 1 : 0);
