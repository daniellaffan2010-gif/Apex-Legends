/* The safety car in Node: forced deployments in whole AI races (does the field bunch, is nobody passing, does it come in, does the
   green flag come), natural deployments over several races, the player's limiter and the overtaking penalty.
   node --import ./scripts/asset-register.mjs scripts/safetycar-test.mjs [track] [races] */
globalThis.window = globalThis;
const els = new Map();
const el = id => { if (!els.has(id)) els.set(id, new Proxy({ textContent: '', hidden: false, style: { setProperty() {} }, dataset: {}, children: [], classList: { toggle() {}, add() {}, remove() {} }, appendChild() {}, setAttribute() {}, addEventListener() {}, querySelector() { return null; } }, { get: (t, k) => (k in t ? t[k] : () => el('x')), set: (t, k, v) => ((t[k] = v), true) })); return els.get(id); };
globalThis.document = { getElementById: el, querySelector: s => el(s), querySelectorAll: () => [], createElement: () => el('n' + Math.random()), body: { appendChild() {} }, addEventListener() {} };
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.addEventListener = () => {}; globalThis.innerWidth = 1280; globalThis.innerHeight = 720; globalThis.devicePixelRatio = 1;
globalThis.requestAnimationFrame = () => 0; globalThis.Image = class { set src(v) {} };
const SS = await import('../src/game/session.js');
const SC = await import('../src/game/safetycar.js');
const PEN = await import('../src/game/penalties.js');
const { CFG } = await import('../src/config/settings.js');
const { R } = await import('../src/render2d/view.js'); R.cv = { clientWidth: 1280, clientHeight: 720, style: {} }; R.ctx = { setTransform() {} }; R.W = 1280; R.H = 720;

const id = process.argv[2] || 'monza', races = +(process.argv[3] || 4);
CFG.trackId = id; CFG.lapsIdx = 1; CFG.weather = 'dry'; CFG.damage = true; CFG.sc = 1;
let fail = 0; const ok = (c, m) => { if (!c) { fail++; console.log('FAIL', m); } };
const say = () => el('#msg-b').textContent + ' | ' + el('#msg-s').textContent;
const T0 = Date.now();

// ---------- 1. a forced deployment, everybody on AI ----------
for (let r = 0; r < 2; r++) {
  SS.startSession('race', null);
  let S = SS.S; S.player.ai = true; S.sc.plan = null;
  console.log(`race ${r + 1}: ${S.track.name}, ${S.laps} laps`);
  let steps = 0, deployedAt = null, swaps = 0, nan = 0, maxOff = -99, minV = 1e9, maxV = 0, outT = 0, states = [];
  let prevOrder = null, closest = 1e9, pitSeen = 0, dnfs0 = 0, maxGapQueue = 0;
  const L = S.track.length;
  while (!S.ended && steps < 60 * 60 * 25) {
    SS.update(1 / 60, 1 / 60); steps++;
    if (deployedAt == null && S.clock > 30 && S.cars.every(c => !c.dnf)) { ok(SC.deploy(S, 'Debris on the track'), 'deploy accepted'); deployedAt = S.clock; dnfs0 = S.cars.filter(c => c.dnf).length; console.log('  deployed:', say(), '| from', S.sc.car.inLane ? 'the pit exit' : 'the road'); }
    if (S.sc.state !== states[states.length - 1]) { states.push(S.sc.state); console.log('  ', S.clock.toFixed(0) + 's', 'state →', S.sc.state, 'lap', S.sc.leaderLap, say()); }
    const k = S.sc.car;
    if (k) { if (!isFinite(k.x + k.y + k.v)) nan++; if (!k.inLane) maxOff = Math.max(maxOff, Math.abs(k.off) - S.track.half); minV = Math.min(minV, k.v); maxV = Math.max(maxV, k.v); }
    for (const c of S.cars) if (!isFinite(c.x + c.y + c.vx + c.vy)) nan++;
    if (S.sc.state === 'out') {
      outT += 1 / 60;
      const live = S.cars.filter(c => !c.dnf && !c.pitting && !c.inPit).sort((a, b) => b.prog - a.prog);
      const order = live.map(c => c.idx);
      if (prevOrder) {
        // a swap between two cars that were both on the track last frame and now
        const pos = new Map(prevOrder.map((x, i) => [x, i]));
        for (let i = 0; i < order.length; i++) for (let j = i + 1; j < order.length; j++)
          if (pos.has(order[i]) && pos.has(order[j]) && pos.get(order[i]) > pos.get(order[j]) && live[i].prog - live[j].prog > 2) swaps++;   // nose-to-tail ties in a hairpin flip with the line, they are not passes
      }
      prevOrder = order;
      // once the field has settled behind the car: the nearest any two cars on the road get to each other
      if (k && !k.inLane && outT > 60 && (steps % 6) === 0) {
        for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
          const dd = Math.hypot(live[i].x - live[j].x, live[i].y - live[j].y);
          if (process.env.DBG && dd < 4.5) console.log('   close', S.clock.toFixed(1), live[i].drv.abbr, live[j].drv.abbr, dd.toFixed(1), 'ds', (live[i].s - live[j].s).toFixed(1), 'doff', (live[i].off - live[j].off).toFixed(1), 'v', live[i].speed.toFixed(0), live[j].speed.toFixed(0), 'stops', live[i].stops, live[j].stops);
          closest = Math.min(closest, dd);
        }
      }
    } else prevOrder = null;
    if (S.cars.filter(c => c.dnf).length > dnfs0) { dnfs0 = S.cars.filter(c => c.dnf).length; }
    if (S.sc.state === 'off' && deployedAt != null && S.clock > deployedAt + 20 && !S.sc.car) break;
  }
  console.log(`  states ${states.join(' → ')} · out ${outT.toFixed(0)} s · SC speed ${minV.toFixed(0)}-${maxV.toFixed(0)} m/s · max overshoot of the edge ${maxOff.toFixed(1)} m · swaps while out ${swaps} · closest gap ${closest.toFixed(1)} m`);
  ok(states.join() === 'off,out,in,off'.replace('off,', '') || states.join() === 'out,in,off' || states.join() === 'off,out,in,off', 'states ran out → in → off: ' + states);
  ok(nan === 0, 'no NaN'); ok(maxOff < 0, 'the safety car stays on the road');
  ok(swaps <= 6, 'almost no passing behind the safety car: ' + swaps);
  ok(minV > 15 && maxV < 70, 'sensible speed');
  ok(closest > 2.4, 'cars never overlap more than in normal racing (the contact circle is 3.4 m): ' + closest);
  ok(S.sc.state === 'off' && !S.sc.car, 'green flag and the car is gone');
  // race goes on and finishes
  let more = 0; while (!S.ended && more < 60 * 60 * 10) { SS.update(1 / 60, 1 / 60); more++; if (S.player.finished) break; }
  ok(S.player.finished || S.ended, `the race finishes after the restart (clock ${S.clock.toFixed(0)}, lap ${S.player.lap}/${S.laps}, ended ${S.ended})`);
}

// ---------- 2. natural deployments ----------
let natural = 0, byReason = {};
for (let r = 0; r < races; r++) {
  SS.startSession('race', null); const S = SS.S; S.player.ai = true;
  let seen = 0;
  for (let i = 0; i < 60 * 60 * 25 && !S.ended; i++) { SS.update(1 / 60, 1 / 60); if (S.sc.count > seen) { seen = S.sc.count; byReason[S.sc.reason.replace(/^\S+ is/, 'X is')] = (byReason[S.sc.reason.replace(/^\S+ is/, 'X is')] || 0) + 1; }
    if (S.player.finished) break; }
  natural += S.sc.count;
  ok(S.sc.state === 'off' || S.player.finished, 'race ' + r + ' ends with the field released');
}
console.log('natural deployments in', races, 'races:', natural, JSON.stringify(byReason));

// ---------- 3. the player's limiter and the overtaking penalty ----------
SS.startSession('race', null); let S = SS.S; const p = S.player; S.state = 'run'; S.clock = 40; p.lap = 1; p.lapStart = 100; p.finished = false;
SC.deploy(S, 'Test'); const k = S.sc.car; k.inLane = false;
// the car 60 m ahead of the player, the player at 80 m/s
p.s = k.s - 60; p.off = k.off; p.vx = Math.cos(p.h) * 80; p.vy = Math.sin(p.h) * 80; p.thr = 1; p.brk = 0; p.boost = 1;
SC.limitPlayer(S, p); ok(p.thr === 0 && p.brk > 0.2 && p.boost === 0, 'the limiter lifts and brakes a player closing fast: thr ' + p.thr + ' brk ' + p.brk.toFixed(2));
p.vx = Math.cos(p.h) * (k.v + 1); p.vy = Math.sin(p.h) * (k.v + 1); p.thr = 1; p.brk = 0; SC.limitPlayer(S, p); ok(p.thr === 1, 'no limiting at the safety car\'s own pace');
// overtaking the safety car
p.spinT = 0; p.inPit = false; p.pitting = 0; p.dnf = false; p.vx = Math.cos(p.h) * 40; p.vy = Math.sin(p.h) * 40;
S.penQ = []; const t0 = (p.pen && p.pen.todo.length) || 0;
p.s = k.s - 3; p.off = k.off; SC.tick(S, 0.016);
p.s = k.s + 3; SC.tick(S, 0.016);
ok(p.pen && p.pen.todo.length === t0 + 1 && /safety car/i.test(PEN.hudLine(S, p) + JSON.stringify(S.penLog)), 'overtaking the safety car costs a drive-through: ' + say());
console.log('overtaking message:', say());
// pit lane spawn / road spawn both seen? both modes
console.log('ran', ((Date.now() - T0) / 1000).toFixed(0), 's');
console.log(fail ? fail + ' FAILED' : 'all checks passed');
process.exit(fail ? 1 : 0);
