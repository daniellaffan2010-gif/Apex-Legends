/* The pit lane in Node, through the real session loop: rivals and the player down the lane, their own boxes,
   double stacking, release holds, stop times, what a stop costs, and the player's own visit (call, entry,
   speed-limit line, the lane driving itself, the stop, the hand-back), including a speeding run.
   node --import ./scripts/asset-register.mjs scripts/pit-test.mjs [track ...] */
globalThis.window = globalThis;
const els = new Map();
const mk = () => new Proxy(function () {}, { get: (t, k) => (k === 'canvas' ? { width: 1, height: 1 } : k === 'measureText' ? () => ({ width: 10 }) : k === 'data' ? new Uint8ClampedArray(1 << 20) : (k === 'width' || k === 'height') ? 1 : mk()), set: () => true, apply: () => mk() });
const el = id => { if (!els.has(id)) els.set(id, new Proxy({ textContent: '', innerHTML: '', hidden: false, style: { setProperty() {} }, dataset: {}, children: [], classList: { toggle() {}, add() {}, remove() {} }, appendChild() {}, setAttribute() {}, addEventListener() {}, querySelector() { return null; }, getContext: () => mk(), width: 1, height: 1 }, { get: (t, k) => (k in t ? t[k] : () => el('x')), set: (t, k, v) => ((t[k] = v), true) })); return els.get(id); };
globalThis.document = { getElementById: el, querySelector: s => el(s), querySelectorAll: () => [], createElement: () => el('n' + Math.random()), body: { appendChild() {}, classList: { toggle() {} } }, addEventListener() {} };
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.addEventListener = () => {}; globalThis.innerWidth = 1280; globalThis.innerHeight = 720; globalThis.devicePixelRatio = 1;
globalThis.requestAnimationFrame = () => 0; globalThis.Image = class { set src(v) {} };
const SS = await import('../src/game/session.js');
const { KEY } = await import('../src/input/input.js');
const { CFG } = await import('../src/config/settings.js');
const PIT = await import('../src/car/pit.js');
const { R } = await import('../src/render2d/view.js'); R.cv = { clientWidth: 1280, clientHeight: 720, style: {} }; R.ctx = { setTransform() {} }; R.W = 1280; R.H = 720;
const { TYRES } = await import('../src/car/parts.js');

const tracks = process.argv.slice(2).length ? process.argv.slice(2) : ['monza', 'monaco', 'spa', 'silverstone', 'zandvoort', 'interlagos'];
let fails = 0; const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fails++; };
const dt = 1 / 60;
const wrap = (d, L) => { d %= L; if (d > L / 2) d -= L; if (d < -L / 2) d += L; return d; };

for (const id of tracks) {
  CFG.trackId = id; CFG.lapsIdx = 1; CFG.weather = 'dry'; CFG.damage = true; CFG.sc = 0;
  console.log(`\n=== ${id}`);
  /* ---------- A: rivals ---------- */
  SS.startSession('race', null);
  let S = SS.S, T = S.track;
  S.player.ai = true; S.state = 'run'; S.lights = 5;
  // a lap and a bit to spread out, then call in a third of the field at once, both cars of one team among them
  for (let k = 0; k < 60 * 60 && S.cars.some(c => c.lap < 2); k++) SS.update(dt, dt);
  const byTeam = new Map(); for (const c of S.cars) { if (!byTeam.has(c.team.id)) byTeam.set(c.team.id, []); byTeam.get(c.team.id).push(c); }
  const both = [...byTeam.values()].find(v => v.length === 2 && v.every(c => !c.dnf));
  // the pair arrive nose to tail, so the second has to wait for the first
  { const iP = (T.pitIn - Math.round(500 / T.ds) + T.n) % T.n;
    both.forEach((c, q) => { const ii = (iP - q * 3 + T.n) % T.n; c.place(ii, T.line[ii]); c.railS = null; c.railV = 60; c.vx = Math.cos(c.h) * 60; c.vy = Math.sin(c.h) * 60; c.aiFree = false; c.spinT = 0; }); }
  const called = new Set([...both, ...S.cars.filter((c, k) => k % 3 === 0 && !c.dnf)]);
  for (const c of called) { c.pitReq = true; c.nextTyre = TYRES.hard; }
  const rec = new Map(); let minGap = 1e9, minGapPair = '', lurch = 0, sideJump = 0, holds = 0, stacks = 0, stopsSeen = 0, unsafe = 0;
  const penBefore = (S.penLog || []).length;
  for (let k = 0; k < 60 * 240; k++) {
    const prev = new Map(S.cars.map(c => [c, { x: c.x, y: c.y, off: c.off, sp: c.speed, pit: !!c.pitting, phase: c.pp && c.pp.phase }]));
    SS.update(dt, dt);
    const lane = S.cars.filter(c => c.pitting && c.pp && !c.dnf);
    for (let a = 0; a < lane.length; a++) for (let b = a + 1; b < lane.length; b++) {
      const A = lane[a], B = lane[b];
      if (Math.abs(A.pp.off - B.pp.off) > 1.9) continue;                  // different lanes
      if (A.pp.phase === 'entry' && B.pp.phase === 'entry' && Math.min(A.pp.a, B.pp.a) < 20) continue;   // still as close as they were on the track
      const d = Math.hypot(A.x - B.x, A.y - B.y);
      if (d < minGap) { minGap = d; minGapPair = A.drv.abbr + '/' + B.drv.abbr + ' ' + A.pp.phase + '/' + B.pp.phase + ' a ' + A.pp.a.toFixed(1) + '/' + B.pp.a.toFixed(1) + ' off ' + A.pp.off.toFixed(2) + '/' + B.pp.off.toFixed(2) + ' boxes ' + A.pp.box.a.toFixed(0) + '/' + B.pp.box.a.toFixed(0) + ' stopA ' + (A.pp.stopA || 0).toFixed(1) + '/' + (B.pp.stopA || 0).toFixed(1); }
    }
    for (const c of S.cars) {
      const p = prev.get(c);
      if (c.pp && c.pp.phase === 'stopped' && p.phase !== 'stopped') {
        stopsSeen++;
        const b = c.pp.box, f = b.f, i = Math.floor(f), j = (i + 1) % T.n, u = f - i;
        const bx = T.x[i] + (T.x[j] - T.x[i]) * u + T.nx[i] * T.pitWork(f), by = T.y[i] + (T.y[j] - T.y[i]) * u + T.ny[i] * T.pitWork(f);
        rec.set(c, { err: Math.hypot(c.x - bx, c.y - by), team: c.team.id, t0: S.clock, pen: c.pp.pen });
      }
      if (c.pp && c.pp.stacked && !c.pp._st) { c.pp._st = true; stacks++; }
      if (c.pp && c.pp.held > 0 && !c.pp._counted) { c.pp._counted = true; holds++; }
      if (p.phase === 'stopped' && c.pp && c.pp.phase === 'out') { const r = rec.get(c); if (r) r.stat = c.pp.st.t; }
      // hand-back: the speed must carry on, not jump to the old racing speed
      if (p.pit && !c.pitting && c.ai) { const jump = Math.abs(c.speed - p.sp); lurch = Math.max(lurch, jump); }
      if (c.pitting || p.pit) { const sj = Math.hypot(c.x - p.x, c.y - p.y) - Math.max(c.speed, p.sp) * dt; if (sj > 0.5 && process.env.DBG) console.log('    JUMP', c.drv.abbr, sj.toFixed(2), p.phase, '->', c.pp && c.pp.phase, 'pit', p.pit, '->', !!c.pitting, 'off', p.off.toFixed(2), '->', c.off.toFixed(2), c.pp && JSON.stringify({ a:c.pp.a.toFixed(1), stopA:c.pp.stopA, relA:c.pp.relA, inWork:c.pp.inWork, box:c.pp.box.a.toFixed(1), v:c.pp.v.toFixed(1) })); sideJump = Math.max(sideJump, sj); }
    }
    if (![...called].some(c => c.pitReq || c.pitting) && k > 600) break;
  }
  unsafe = (S.penLog || []).slice(penBefore).filter(e => /Unsafe/.test(e.text)).length;
  for (const c of called) if (c.pitting && c.pp) console.log('    STILL IN', c.drv.abbr, c.pp.phase, 'a', c.pp.a.toFixed(1), 'v', c.pp.v.toFixed(1), 'box', c.pp.box.a.toFixed(0), 'stopA', c.pp.stopA, 'lead', c.pp.lead && c.pp.lead.drv.abbr, c.pp.st && ('t ' + c.pp.st.t.toFixed(1) + ' hold ' + c.pp.st.hold.toFixed(1)));
  const stats = [...rec.values()].filter(r => r.stat != null);
  const errs = stats.map(r => r.err), stat = stats.map(r => r.stat).sort((a, b) => a - b);
  console.log(`  ${called.size} called in: ${stopsSeen} stopped, ${stacks} double-stacked, ${holds} held for traffic, ${unsafe} unsafe releases`);
  console.log(`  stationary s: min ${stat[0]?.toFixed(2)} median ${stat[stat.length >> 1]?.toFixed(2)} max ${stat[stat.length - 1]?.toFixed(2)}`);
  ok(stopsSeen >= called.size - 1, `every called car stopped (${stopsSeen} of ${called.size})`);
  ok(errs.length && Math.max(...errs) < 0.35, `each stopped on its own team's mark (worst ${Math.max(...errs).toFixed(2)} m)`);
  ok(minGap > 5.4, `cars in the same lane never closer than a car length (closest ${minGap.toFixed(2)} m, ${minGapPair})`);
  ok(stacks >= 1, 'the team-mates double-stacked (one waited behind the other)');
  ok(lurch < 3, `no speed jump at the hand-back to racing (worst ${lurch.toFixed(2)} m/s)`);
  ok(sideJump < 0.6, `no sideways jump in or out of the lane (worst ${sideJump.toFixed(2)} m beyond the car's own travel)`);
  const penVisits = [...called].filter(c => !c.dnf && c.tyre.key !== 'hard' && (c.pen && (c.pen.n || 0) > 0));
  ok([...called].every(c => c.dnf || c.tyre.key === 'hard' || penVisits.includes(c)), `new tyres fitted on every car that stopped for them (${penVisits.length} penalty visits without work)`);

  /* ---------- B: the player's own visit, and what it costs ---------- */
  for (const run of ['clean', 'fast']) {
    SS.startSession('race', null); S = SS.S; T = S.track; const p = S.player; S.state = 'run'; S.lights = 5;
    for (const c of S.cars) if (c !== p) { c.dnf = true; }                // an empty lane, for timing
    // on the entry road, in the lane, 40 m before the speed-limit line, at the limit (or 30 km/h over it)
    const aStart = Math.max(3, T.pitLimA - 40), fS = T.pitFOf(T.pitSOf(T.pitIn) + aStart), iS = Math.floor(fS) % T.n;
    const v0 = T.pitLimit + (run === 'fast' ? 9 : 0);
    p.pitReq = true;
    p.place(iS, T.pitFast(fS)); p.vx = Math.cos(p.h) * v0; p.vy = Math.sin(p.h) * v0; p.inPit = true;
    const ccw = T.nx[iS] * -T.ty[iS] + T.ny[iS] * T.tx[iS] > 0 ? 1 : -1;      // +offset is to the left of the direction of travel
    p.lap = 2; p.tyre = TYRES.medium;
    PIT.callPit(p, S); p.pitPlan.tyre = 'hard'; PIT.closePitMenu(S, 'box');
    ok(p.pitReq && !S.menuOpen, `${run}: the call and the menu (pit requested, race running)`);
    const pens0 = (S.penLog || []).length;
    let t = 0, entered = -1, stopped = -1, released = -1, back = -1, maxLine = 0;
    const L = T.length, sStart = p.s;
    for (let k = 0; k < 60 * 120; k++) {
      // the driver: get to the pit side, then brake so as to reach the limit at the line (or not, on the fast run)
      const a = T.pitAlong(p.s), u = T.pitU(p.node);
      const toLine = u >= 0 ? T.pitLimA - a : (((T.pitIn - p.node) % T.n + T.n) % T.n) * T.ds + T.pitLimA;
      const want = T.pitFast(T.pitFOf(p.s));
      const err = want - p.off;
      const vT = v0;                                                          // hold the speed it arrived at
      KEY['arrowup'] = p.speed < vT - 1; KEY['arrowdown'] = p.speed > vT + 1;
      // a driver: aim a little across the road towards the wanted offset, and steer for that heading
      const ang = T.ang[p.node], hWant = ang + ccw * Math.atan2(Math.max(-6, Math.min(6, err)), 22);
      let he = hWant - p.h; while (he > Math.PI) he -= 2 * Math.PI; while (he < -Math.PI) he += 2 * Math.PI;
      KEY['arrowright'] = he > 0.012; KEY['arrowleft'] = he < -0.012;         // the right key turns the heading up
      SS.update(dt, dt); t += dt;
      if (process.env.DBG && k % 30 === 0) console.log('    t', t.toFixed(1), 'node', p.node, 'u', T.pitU(p.node).toFixed(3), 'a', T.pitAlong(p.s).toFixed(0), 'limA', T.pitLimA.toFixed(0), 'off', p.off.toFixed(2), 'want', want.toFixed(2), 'spd', (p.speed * 3.6).toFixed(0), 'inPit', p.inPit, 'req', p.pitReq, 'pitting', p.pitting, 'visit', p.pitVisit);
      if (p.pitting && entered < 0) { entered = t; maxLine = p.speed * 3.6; }
      if (p.pp && p.pp.phase === 'stopped' && stopped < 0) stopped = t;
      if (p.pp && p.pp.phase === 'out' && released < 0) released = t;
      if (entered >= 0 && !p.pitting && back < 0) back = t;
      if (back >= 0 && !p.inPit && T.pitU(p.node) < 0 && t > back + 1) break;
    }
    const pens = (S.penLog || []).slice(pens0).map(e => e.text + (e.reason ? ' (' + e.reason + ')' : ''));
    console.log(`  player ${run}: line crossed at ${maxLine.toFixed(0)} km/h, stopped ${stopped >= 0 ? (released - stopped).toFixed(2) + ' s' : 'never'}, back at ${back.toFixed(1)} s, penalties: ${pens.join('; ') || 'none'}`);
    if (run === 'clean') {
      ok(entered >= 0 && stopped >= 0 && released > stopped && back > released, 'the lane took the car at the line, stopped it in its box, released it and handed it back');
      ok(p.tyre.key === 'hard' && p.stops === 1, `hards fitted and the stop counted (${p.tyre.key}, stops ${p.stops})`);
      ok(!pens.some(x => /Speeding/.test(x)), 'no speeding penalty at the limit');
      ok(!p.pitReq && !p.pitVisit, 'the visit closed once back on the track');
    } else ok(pens.some(x => /Speeding/.test(x)), 'arriving 30 km/h over the limit is a speeding penalty');
  }
  KEY['arrowup'] = KEY['arrowdown'] = KEY['arrowleft'] = KEY['arrowright'] = false;

  /* ---------- C: what a stop costs: the same stretch with and without it, rival on its rail ---------- */
  {
    const run = stop => {
      SS.startSession('race', null); const S2 = SS.S, T2 = S2.track; S2.state = 'run'; S2.lights = 5; S2.player.ai = true;
      const c = S2.cars.find(x => x !== S2.player); for (const o of S2.cars) if (o !== c) o.dnf = true;
      const i0 = (T2.pitIn - Math.round(600 / T2.ds) + T2.n) % T2.n; c.place(i0, T2.line[i0]); c.railV = 65; c.vx = Math.cos(c.h) * 65; c.vy = Math.sin(c.h) * 65; c.lap = 2;
      c.railS = null;
      if (stop) { c.pitReq = true; c.nextTyre = TYRES.hard; }
      const end = (T2.pitOut + Math.round(400 / T2.ds)) % T2.n; let t = 0;
      for (let k = 0; k < 60 * 150; k++) { SS.update(dt, dt); t += dt; if (!c.pitting && !c.inPit && ((c.node - end + T2.n) % T2.n) < 6 && t > 5) break; }
      return t;
    };
    const tStop = run(true), tNo = run(false);
    console.log(`  pit loss (a rival, empty lane): ${(tStop - tNo).toFixed(1)} s (stretch ${tNo.toFixed(1)} s without, ${tStop.toFixed(1)} s with)`);
    ok(tStop - tNo > 12 && tStop - tNo < 34, 'the loss is in the real range (about 14-29 s)');
  }
}
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
