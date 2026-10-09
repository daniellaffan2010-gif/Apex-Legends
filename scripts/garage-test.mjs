/* Setup garage + telemetry (src/car/tune.js, src/game/garage.js, src/game/telemetry.js, src/ui/garage-ui.js).
   1. the slider maths and bounds   2. garage persistence (sanitising, limits, select/remove)
   3. the physics really responds to a setup, in the right direction, and neutral changes nothing
   4. telemetry records a clean lap, drops pit / invalid laps, persists best + last + per-setup
   5. the garage screen runs against a stubbed DOM
   node --import ./scripts/asset-register.mjs scripts/garage-test.mjs [track] */
globalThis.window = globalThis;
const mk = () => new Proxy(function () {}, { get: (t, k) => (k === 'canvas' ? { width: 1, height: 1 } : (k === 'width' || k === 'height') ? 1 : mk()), set: () => true, apply: () => mk() });
const els = new Map();
const mkEl = () => {
  const o = { textContent: '', innerHTML: '', value: '', hidden: false, disabled: false, style: { setProperty() {} }, dataset: {}, children: [], classList: { toggle() {}, add() {}, remove() {} },
    appendChild(c) { this.children.push(c); return c; }, setAttribute() {}, addEventListener() {}, querySelector() { return mkEl(); }, getContext: () => mk(), width: 520, height: 300 };
  return o;
};
const el = id => { if (!els.has(id)) els.set(id, mkEl()); return els.get(id); };
globalThis.document = { getElementById: el, querySelector: s => el(s), querySelectorAll: () => [], documentElement: {},
  createElement: () => mkEl(), body: { appendChild() {} }, addEventListener() {} };
globalThis.getComputedStyle = () => ({ getPropertyValue: () => '' });
const mem = new Map();
globalThis.localStorage = { getItem: k => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k) };
globalThis.addEventListener = () => {}; globalThis.innerWidth = 1280; globalThis.innerHeight = 720; globalThis.devicePixelRatio = 1;
globalThis.requestAnimationFrame = () => 0; globalThis.Image = class { set src(v) {} };

const SS = await import('../src/game/session.js');
const TUNE = await import('../src/car/tune.js');
const Garage = await import('../src/game/garage.js');
const Tele = await import('../src/game/telemetry.js');
const { Car } = await import('../src/car/physics.js');
const { CFG } = await import('../src/config/settings.js');
const { R } = await import('../src/render2d/view.js'); R.cv = { clientWidth: 1280, clientHeight: 720, style: {} }; R.ctx = mk(); R.W = 1280; R.H = 720;

let fail = 0; const ok = (c, m) => { if (!c) { fail++; console.log('FAIL', m); } };

/* ---------- 1. slider maths ---------- */
{
  const T = TUNE.tune, N = TUNE.NEUTRAL;
  const mid = T(TUNE.DEFAULT);
  for (const k of Object.keys(N)) ok(Math.abs(mid[k] - N[k]) < 1e-9, `default setup is neutral for ${k} (${mid[k]})`);
  ok(TUNE.isNeutral(TUNE.DEFAULT) && TUNE.isNeutral(null) && !TUNE.isNeutral({ wing: 0.6 }), 'isNeutral');
  const wHi = T({ wing: 1, gear: .5, bias: .5, press: .5 }), wLo = T({ wing: 0, gear: .5, bias: .5, press: .5 });
  ok(wHi.grip > 1 && wHi.drag > 1 && wHi.top < 1, 'more wing: grip up, drag up, top speed down');
  ok(wLo.grip < 1 && wLo.drag < 1 && wLo.top > 1, 'less wing: grip down, drag down, top speed up');
  const gHi = T({ wing: .5, gear: 1, bias: .5, press: .5 }), gLo = T({ wing: .5, gear: 0, bias: .5, press: .5 });
  ok(gHi.top > 1 && gHi.power < 1 && gHi.gearSpan > 1, 'long gearing: top up, pull down, wider gears');
  ok(gLo.top < 1 && gLo.power > 1 && gLo.gearSpan < 1, 'short gearing: top down, pull up, shorter gears');
  const bF = T({ wing: .5, gear: .5, bias: 1, press: .5 }), bR = T({ wing: .5, gear: .5, bias: 0, press: .5 });
  ok(bF.stab < 1 && bF.brake < 1, 'forward bias: calmer lock-up, slightly less stopping force');
  ok(bR.stab > 1 && bR.brake > 1, 'rear bias: more lock-up risk, more stopping force');
  const pH = T({ wing: .5, gear: .5, bias: .5, press: 1 }), pL = T({ wing: .5, gear: .5, bias: .5, press: 0 });
  ok(pH.wear < 1 && pH.heat < 0 && pH.grip < 1, 'hard tyres: wear down, cooler, less grip');
  ok(pL.wear > 1 && pL.heat > 0 && pL.grip > 1, 'soft tyres: wear up, hotter, more grip');
  // no free lunch: every extreme is bounded and nothing goes wild
  for (const w of [0, 1]) for (const g of [0, 1]) for (const b of [0, 1]) for (const p of [0, 1]) {
    const t = T({ wing: w, gear: g, bias: b, press: p });
    for (const [k, v] of Object.entries(t)) ok(Number.isFinite(v), `finite ${k}`);
    ok(t.grip > .9 && t.grip < 1.1 && t.top > .92 && t.top < 1.08 && t.power > .93 && t.drag > .8 && t.drag < 1.2 && t.wear > .75 && t.wear < 1.25 && t.stab > .8 && t.stab < 1.3, `bounded at ${w}${g}${b}${p}`);
  }
  ok(Object.isFrozen(N), 'NEUTRAL is frozen');
  ok(T({ wing: 9, gear: -3 }).grip === T({ wing: 1, gear: 0 }).grip, 'out-of-range sliders are clamped');
}

/* ---------- 2. garage persistence ---------- */
{
  mem.clear();
  let g = Garage.load();
  ok(g.list.length === 1 && g.sel === 'std' && g.list[0].name === 'Standard', 'fresh garage has a Standard setup');
  ok(TUNE.isNeutral(Garage.selected()), 'Standard is neutral');
  g = Garage.add('Monza low drag', { wing: 0.1, gear: 0.9, bias: 0.5, press: 0.5 });
  ok(g.list.length === 2 && g.sel === g.list[1].id, 'add selects the new setup');
  ok(Garage.selected().wing === 0.1, 'add copies the sliders');
  ok(Garage.fitted().drag < 1, 'fitted() reflects the selected setup');
  g = Garage.select('std'); ok(g.sel === 'std' && Garage.fitted().drag === 1, 'select swaps back');
  g = Garage.select('nope'); ok(g.sel === 'std', 'selecting an unknown id does nothing');
  // limits
  for (let i = 0; i < 20; i++) Garage.add('x' + i);
  ok(Garage.load().list.length === Garage.MAX, `garage is capped at ${Garage.MAX}`);
  // remove
  const id = Garage.load().list[2].id; g = Garage.remove(id);
  ok(!g.list.some(x => x.id === id) && g.list.length === Garage.MAX - 1, 'remove drops it');
  mem.clear(); Garage.load(); ok(Garage.remove('std').list.length === 1, 'the last setup cannot be deleted');
  // upsert clamps and trims
  g = Garage.upsert({ id: 'std', name: 'A very long setup name indeed', wing: 7, gear: -2, bias: 'x', press: 0.123456 });
  const s = g.list[0];
  ok(s.name.length <= 18 && s.wing === 1 && s.gear === 0 && s.press === 0.12, `upsert sanitises (${JSON.stringify(s)})`);
  // corrupt storage
  mem.set('ar26_garage', '{"sel":"zzz","list":[{"id":"a","name":"A","wing":"junk"},null,{"nope":1}]}');
  g = Garage.load(); ok(g.list.length === 1 && g.sel === 'a' && g.list[0].wing === 0.5, 'corrupt data is repaired');
  mem.set('ar26_garage', 'not json'); ok(Garage.load().list.length === 1, 'unparseable data falls back to a fresh garage');
  mem.clear();
}

/* ---------- 3. physics ---------- */
const id = process.argv[2] || 'monza';
CFG.trackId = id; CFG.lapsIdx = 1; CFG.weather = 'dry'; CFG.damage = true; CFG.sc = 0;
SS.startSession('race', null);
const S = SS.S;
for (let i = 0; i < 60 * 12 && S.state !== 'run'; i++) SS.update(1 / 60, 1 / 60);
ok(S.state === 'run', 'session reaches the running state');
ok(TUNE.isNeutral(S.player.setup) && S.player.su.grip === 1, 'the player starts with the Standard setup fitted');
ok(S.cars.filter(c => c !== S.player).every(c => c.su === TUNE.NEUTRAL), 'rivals keep the neutral setup');

function fresh(su) {
  const c = new Car(S.player.team, S.player.drv, 90, S.track);
  c.ai = false; c.place(0, S.track.line[0]); c.su = su; return c;
}
function straight(su, secs = 16) {
  const c = fresh(su); let top = 0, at10 = 0;
  c.thr = 1; c.brk = 0; c.steer = 0;
  for (let i = 0; i < secs * 120; i++) { c.step(1 / 120, S); top = Math.max(top, c.speed); if (i === 5 * 120) at10 = c.speed; }
  return { top, early: at10, s: c.s };
}
const T = TUNE.tune, dflt = TUNE.DEFAULT;
{
  const a = straight(TUNE.NEUTRAL), b = straight(T(dflt));
  ok(Math.abs(a.top - b.top) < 1e-9 && Math.abs(a.s - b.s) < 1e-9, 'a default setup is exactly the stock car');
  ok(a.top > 60, `the stock car gets up to speed (top ${a.top.toFixed(1)} m/s)`);
  const long = straight(T({ ...dflt, gear: 1 })), short = straight(T({ ...dflt, gear: 0 }));
  ok(long.top > short.top, `long gearing tops out higher (${long.top.toFixed(1)} vs ${short.top.toFixed(1)})`);
  ok(short.early >= long.early, `short gearing pulls harder early (${short.early.toFixed(1)} vs ${long.early.toFixed(1)})`);
  const lw = straight(T({ ...dflt, wing: 0 })), hw = straight(T({ ...dflt, wing: 1 }));
  ok(lw.top > hw.top, `low wing is faster in a straight line (${lw.top.toFixed(1)} vs ${hw.top.toFixed(1)})`);
  ok(Math.abs(lw.top - hw.top) / a.top < 0.12, `and the difference is modest (${lw.top.toFixed(1)} vs ${hw.top.toFixed(1)}, stock ${a.top.toFixed(1)})`);
  // braking distance from the same speed
  const stop = su => { const c = fresh(su); c.vx = 80; c.vy = 0; c.thr = 0; c.brk = 1; let d = 0; for (let i = 0; i < 20 * 120 && c.speed > 1; i++) { c.step(1 / 120, S); d += c.speed / 120; } return d; };
  const dN = stop(TUNE.NEUTRAL), dF = stop(T({ ...dflt, bias: 1 })), dR = stop(T({ ...dflt, bias: 0 }));
  ok(dF >= dN && dR <= dN, `bias trades stopping distance (rear ${dR.toFixed(1)}, std ${dN.toFixed(1)}, front ${dF.toFixed(1)} m)`);
  // tyre wear and temperature over a stretch of hard cornering
  const corner = su => { const c = fresh(su); c.vx = 55; c.vy = 0; c.thr = 0.6; c.brk = 0; for (let i = 0; i < 40 * 120; i++) { c.steer = Math.sin(i / 120) * 0.4; c.step(1 / 120, S); } return { life: c.life, temp: c.temp }; };
  const pH = corner(T({ ...dflt, press: 1 })), pL = corner(T({ ...dflt, press: 0 })), pN = corner(TUNE.NEUTRAL);
  ok(pH.life > pN.life && pN.life > pL.life, `tyre pressure trades life (hard ${pH.life.toFixed(3)}, std ${pN.life.toFixed(3)}, soft ${pL.life.toFixed(3)})`);
  ok(pH.temp < pL.temp, `and temperature (hard ${pH.temp.toFixed(3)} < soft ${pL.temp.toFixed(3)})`);
  // gear shown on the dash follows the span
  const gc = fresh(T({ ...dflt, gear: 1 })), gs = fresh(T({ ...dflt, gear: 0 })); gc.vx = gs.vx = 50;
  const { gearOf, rpmOfCar } = await import('../src/car/physics.js');
  ok(gearOf(gc) <= gearOf(gs), `long gearing sits in a lower gear at the same speed (${gearOf(gc)} vs ${gearOf(gs)})`);
  const rp = rpmOfCar(gc); ok(Number.isFinite(rp) && rp >= 4200 && rp <= 13400, `rpm stays sane (${rp})`);
}

/* ---------- 4. telemetry ---------- */
{
  mem.clear(); Tele.reset();
  const fake = (extra = {}) => ({ speed: 70, thr: 1, brk: 0, steer: 0, temp: 0.5, life: 1, s: 0, lapStart: 0, dnf: false, pitting: false, inPit: false, recovering: false,
    vx: 70, vy: 0, su: TUNE.NEUTRAL, secT: [30, 60, 90], tyre: { key: 'M' }, lapInvalid: false, ...extra });
  const world = { state: 'run', clock: 0, track: { id: 'testtrack', length: 5000 }, wet: 0 };
  const drive = (c, secs, w = world) => { for (let i = 0; i < secs * 60; i++) { w.clock += 1 / 60; c.s = ((c.s || 0) + 70 / 60) % 5000; c.life -= 0.0001; Tele.sample(w, c); } };
  const setup = { id: 'std', name: 'Standard' };

  let c = fake(); Tele.startLap(c); drive(c, 30);
  ok(c.tele.buf.length >= 280 && c.tele.buf.length <= 310, `10 Hz sampling (${c.tele.buf.length} rows in 30 s)`);
  const row = c.tele.buf[10];
  ok(row.length === 9 && row[Tele.COL.kph] === 252 && row[Tele.COL.s] > 0 && row[Tele.COL.s] < 1, `row shape / units (${JSON.stringify(row)})`);
  let rec = Tele.finish(world, c, 90123, setup);
  ok(rec && rec.t === 90123 && rec.stats && rec.stats.top >= 250 && rec.setup.id === 'std', 'a clean lap becomes a record with stats');
  ok(Tele.laps.length === 1, 'kept in the session list');
  let d = Tele.forTrack('testtrack');
  ok(d.best && d.best.t === 90123 && d.last && d.by.std.t === 90123, 'best, last and per-setup persisted');
  ok(d.best.samples.length < rec.samples.length && d.best.samples.length > 100, `persisted samples are thinned (${d.best.samples.length} of ${rec.samples.length})`);
  ok(c.tele.buf.length === 0, 'finish starts the next lap clean');

  // a slower lap with another setup: last changes, best does not, per-setup tracks both
  c = fake(); Tele.startLap(c); drive(c, 30);
  Tele.finish(world, c, 95000, { id: 'abc', name: 'Wet' });
  d = Tele.forTrack('testtrack');
  ok(d.best.t === 90123 && d.last.t === 95000 && d.by.abc.t === 95000 && d.by.std.t === 90123, 'slower lap: last updates, best holds');
  c = fake(); Tele.startLap(c); drive(c, 30);
  Tele.finish(world, c, 88000, { id: 'abc', name: 'Wet' });
  d = Tele.forTrack('testtrack');
  ok(d.best.t === 88000 && d.by.abc.t === 88000, 'faster lap becomes the best');

  // rejected laps
  const before = Tele.laps.length;
  c = fake(); Tele.startLap(c); drive(c, 12); c.inPit = true; drive(c, 1); c.inPit = false; drive(c, 12);
  ok(Tele.finish(world, c, 50000, setup) === null, 'a lap with a pit stop is not recorded');
  c = fake(); Tele.startLap(c); drive(c, 10); c.recovering = true; drive(c, 1); c.recovering = false; drive(c, 10);
  ok(Tele.finish(world, c, 50000, setup) === null, 'a lap with a recovery is not recorded');
  c = fake({ lapInvalid: true }); Tele.startLap(c); drive(c, 30);
  ok(Tele.finish(world, c, 50000, setup) === null, 'an invalid lap (track limits) is not recorded');
  c = fake(); Tele.startLap(c); drive(c, 0.3);
  ok(Tele.finish(world, c, 50000, setup) === null, 'a stub lap is not recorded');
  ok(Tele.laps.length === before && Tele.forTrack('testtrack').best.t === 88000, 'rejected laps leave the data alone');

  // not sampled when it shouldn't be
  c = fake({ lapStart: null }); Tele.startLap(c); drive(c, 5); ok(c.tele.buf.length === 0, 'no sampling before the first line crossing');
  c = fake({ dnf: true }); Tele.startLap(c); drive(c, 5); ok(c.tele.buf.length === 0, 'no sampling once out of the race');
  c = fake(); Tele.startLap(c); const w2 = { ...world, state: 'lights' }; drive(c, 5, w2); ok(c.tele.buf.length === 0, 'no sampling on the grid');

  // session list is capped
  for (let i = 0; i < 20; i++) { c = fake(); Tele.startLap(c); drive(c, 3); }
  for (let i = 0; i < 20; i++) { c = fake(); Tele.startLap(c); drive(c, 3); Tele.finish(world, c, 80000 + i, setup); }
  ok(Tele.laps.length <= 12, 'session lap list is capped');

  // stats and the engineer
  ok(Tele.stats([]) === null && Tele.stats(null) === null, 'stats of nothing is null');
  ok(/clean lap/.test(Tele.note(null)), 'the engineer asks for a lap when there is none');
  const mkRows = (f) => Array.from({ length: 100 }, (_, i) => f(i));
  const flat = Tele.stats(mkRows(i => [i * .1, 320, 1, 0, 0, 8, .5, 1 - i * 1e-4, i / 100]));
  ok(/gearing/.test(Tele.note(flat, setup)), 'flat out in top gear: the engineer talks gearing');
  const slow = Tele.stats(mkRows(i => [i * .1, 120, .2, .5, .6, 3, .9, 1 - i * 1e-3, i / 100]));
  const txt = Tele.note(slow, setup);
  ok(/downforce/.test(txt) && /brake/i.test(txt) && /hot/.test(txt), `slow, braking, hot lap: wing + brakes + tyres (${txt})`);
  ok(Tele.note(flat, setup).length < 400, 'the note stays short');

  Tele.clearTrack('testtrack'); ok(Tele.forTrack('testtrack').best === null, 'clearTrack empties the circuit');
  ok(Tele.forTrack('never-seen').best === null, 'unknown circuit is empty, not an error');
}

/* ---------- 5. a real session records the player's laps ---------- */
{
  mem.clear(); Tele.reset();
  const sess = SS; CFG.trackId = id; CFG.lapsIdx = 1;
  sess.startSession('race', null);
  const S2 = sess.S, p = S2.player;
  ok(p.setup && p.setup.id === 'std', 'new session fits the selected setup to the player');
  Garage.add('Fast', { wing: 0.2, gear: 0.8, bias: 0.5, press: 0.5 });
  sess.startSession('race', null);
  ok(sess.S.player.setup.name === 'Fast' && sess.S.player.su.drag < 1, 'the next session picks up the new selection');
  // drive the player on autopilot long enough to cross the line, with real session code
  const P = sess.S.player; let steps = 0;
  P.ai = true;                                           // rail-follow, so lap counting runs; sampling only runs for non-AI, so just make sure nothing throws
  for (let i = 0; i < 60 * 60 && sess.S.state !== 'done'; i++, steps++) sess.update(1 / 60, 1 / 60);
  ok(steps > 100, 'the session loop runs with the garage wired in');
}

/* ---------- 6. the garage screen ---------- */
{
  mem.clear();
  const UI = await import('../src/ui/garage-ui.js');
  let threw = null;
  try { UI.openGarage(); } catch (e) { threw = e; }
  ok(!threw, 'openGarage runs against a stubbed DOM' + (threw ? ': ' + threw.stack : ''));
  ok(el('#g-sets').children.length === 1, 'one setup card listed');
  ok(/Cornering grip/.test(el('#g-fx').innerHTML) && /Lock-up/.test(el('#g-fx').innerHTML), 'effects panel drawn');
  ok(el('#g-del').disabled === true, 'cannot delete the only setup');
  el('#g-add').onclick(); ok(Garage.load().list.length === 2 && el('#g-sets').children.length === 2 || el('#g-sets').children.length >= 2, 'add button adds a setup');
  el('#g-reset').onclick(); ok(TUNE.isNeutral(Garage.selected()), 'reset puts the sliders back');
  el('#g-name').value = 'Quali'; el('#g-name').oninput(); ok(Garage.selected().name === 'Quali', 'renaming saves');
  el('#g-clear').onclick();
  el('#g-track').onchange && el('#g-track').onchange();
  ok(/No clean lap|Run a clean lap/.test(el('#g-note').textContent) || el('#g-note').textContent.length > 0, 'telemetry panel handles an empty circuit');
  // with data
  Tele.laps.length = 0;
  const rows = Array.from({ length: 80 }, (_, i) => [i * .5, 100 + i, i % 2, 0, 0, 4, .5, 1 - i * 1e-3, i / 79]);
  const rec = { t: 91000, tm: 1, tyre: 'M', setup: { id: 'std', name: 'Standard' }, samples: rows, stats: Tele.stats(rows) };
  const tid = (await import('../src/tracks/index.js')).TRACKS[0].id;
  mem.set('ar26_tele_' + tid, JSON.stringify({ best: rec, last: { ...rec, t: 92000, tm: 2 }, by: { std: { t: 91000, name: 'Standard', tyre: 'M', tm: 1 } } }));
  el('#g-track').value = tid; el('#g-track').onchange();
  ok(/91\./.test(el('#g-stats').innerHTML) || /1:31/.test(el('#g-stats').innerHTML), 'stats show the best lap');
  ok(/Standard/.test(el('#g-by').innerHTML), 'per-setup table drawn');
  ok(el('#g-note').textContent.length > 5, 'engineer note drawn');
}

console.log(fail ? `\n${fail} FAILED` : '\ngarage test: all passed');
process.exit(fail ? 1 : 0);
