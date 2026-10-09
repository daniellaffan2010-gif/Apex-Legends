/* Slipstream and dirty air (src/car/aero.js).
   Part 1: the wake maths on synthetic cars (behind, beside, slow leader, pitting leader, lap wrap, lights).
   Part 2: in a real race with the real update loop, followers really do get quicker and lose grip in the wake,
           the tyres wear and heat faster in dirty air, and switching the effects off changes the race.
   node --import ./scripts/asset-register.mjs scripts/slipstream-test.mjs [track] */
globalThis.window = globalThis;
const mk = () => new Proxy(function () {}, { get: (t, k) => (k === 'canvas' ? { width: 1, height: 1 } : (k === 'width' || k === 'height') ? 1 : mk()), set: () => true, apply: () => mk() });
const els = new Map();
const el = id => { if (!els.has(id)) els.set(id, new Proxy({ textContent: '', hidden: false, style: { setProperty() {} }, dataset: {}, children: [], classList: { toggle() {}, add() {}, remove() {} }, appendChild() {}, setAttribute() {}, addEventListener() {}, querySelector() { return null; } }, { get: (t, k) => (k in t ? t[k] : () => el('x')), set: (t, k, v) => ((t[k] = v), true) })); return els.get(id); };
globalThis.document = { getElementById: el, querySelector: s => el(s), querySelectorAll: () => [], createElement: () => ({ width: 1, height: 1, getContext: () => mk(), style: {}, addEventListener() {} }), body: { appendChild() {} }, addEventListener() {} };
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.addEventListener = () => {}; globalThis.innerWidth = 1280; globalThis.innerHeight = 720; globalThis.devicePixelRatio = 1;
globalThis.requestAnimationFrame = () => 0; globalThis.Image = class { set src(v) {} };
const SS = await import('../src/game/session.js');
const AERO = await import('../src/car/aero.js');
const { CFG } = await import('../src/config/settings.js');
const { R } = await import('../src/render2d/view.js'); R.cv = { clientWidth: 1280, clientHeight: 720, style: {} }; R.ctx = mk(); R.W = 1280; R.H = 720;

let fail = 0; const ok = (c, m) => { if (!c) { fail++; console.log('FAIL', m); } };

/* ---------- part 1: the maths ---------- */
{
  const L = 5000;
  const car = (s, off = 0, extra = {}) => ({ s, off, T: { length: L }, ai: false, vx: 70, vy: 0, tow: 0, dirty: 0, ...extra });
  const world = cars => ({ state: 'race', cars });
  const settle = (S, n = 120) => { for (let i = 0; i < n; i++) AERO.update(S, 1 / 60); };

  // directly behind a fast car: both effects, and the closer the harder the dirty air
  let a = car(1000), b = car(1012);                     // b is 12 m ahead of a
  let S = world([a, b]); settle(S);
  ok(a.tow > 0.5, `tow 12 m behind a fast car should be strong (got ${a.tow.toFixed(2)})`);
  ok(a.dirty > 0.5, `dirty air 12 m behind should be strong (got ${a.dirty.toFixed(2)})`);
  ok(b.tow === 0 && b.dirty === 0, 'the leader feels nothing');
  ok(a.wakeOf === b && Math.abs(a.wakeGap - 12) < 1e-6, 'follower knows who it is following');

  // further back: tow lingers, dirty air has gone
  a = car(1000); b = car(1035); S = world([a, b]); settle(S);
  ok(a.tow > 0.05, `35 m back still has a little tow (got ${a.tow.toFixed(2)})`);
  ok(a.dirty < 0.02, `35 m back is out of the dirty air (got ${a.dirty.toFixed(2)})`);

  // out of reach
  a = car(1000); b = car(1060); S = world([a, b]); settle(S);
  ok(a.tow === 0 && a.dirty === 0, 'beyond the reach there is nothing');

  // alongside / off the line: the wake slides past
  a = car(1000, 0); b = car(1012, 5); S = world([a, b]); settle(S);
  ok(a.tow === 0 && a.dirty === 0, 'five metres off the line there is no wake');
  a = car(1000, 0); b = car(1012, 1.5); S = world([a, b]); settle(S);
  ok(a.tow > 0 && a.tow < car(0).tow + 1 && AERO.wake(12, 1.5, 70).tow < AERO.wake(12, 0, 70).tow, 'half-offset is weaker than dead behind');

  // car behind is never the one that gets the effect from the car that is behind it
  a = car(1012); b = car(1000); S = world([a, b]); settle(S);
  ok(a.tow === 0 && b.tow > 0.5, 'only the follower gets the tow');

  // slow leader: no tow
  a = car(1000); b = car(1012, 0, { vx: 15 }); S = world([a, b]); settle(S);
  ok(a.tow === 0, `no tow behind a slow car (got ${a.tow.toFixed(2)})`);

  // a rail-following AI leader reports its speed through railV
  a = car(1000); b = car(1012, 0, { ai: true, railV: 70, vx: 0 }); S = world([a, b]); settle(S);
  ok(a.tow > 0.5, 'AI leader speed read from railV');

  // pitting / wrecked / dnf / spinning leaders have no wake
  for (const k of [{ pitting: true }, { inPit: true }, { wrecked: true }, { dnf: true }, { finished: true }, { spinT: 1 }]) {
    a = car(1000); b = car(1012, 0, k); S = world([a, b]); settle(S);
    ok(a.tow === 0 && a.dirty === 0, `no wake from a car that is ${Object.keys(k)[0]}`);
  }
  // and a pitting follower gets nothing
  a = car(1000, 0, { pitting: true }); b = car(1012); S = world([a, b]); settle(S);
  ok(a.tow === 0 && a.dirty === 0, 'a car in the pit lane gets no wake');

  // lap wrap: follower just before the line, leader just past it
  a = car(L - 6); b = car(8); S = world([a, b]); settle(S);
  ok(a.tow > 0.5 && Math.abs(a.wakeGap - 14) < 1e-6, `wake works across the start line (gap ${a.wakeGap})`);

  // nearest of several leaders
  a = car(1000); b = car(1030); const c = car(1010); S = world([a, b, c]); settle(S);
  ok(a.wakeOf === c, 'the car directly ahead is the one that matters');

  // eased, not snapped
  a = car(1000); b = car(1012); S = world([a, b]); AERO.update(S, 1 / 60);
  ok(a.tow > 0 && a.tow < 0.15, `tow builds up over a moment (first frame ${a.tow.toFixed(3)})`);
  settle(S); const full = a.tow; b.s = 1100; AERO.update(S, 1 / 60);
  ok(a.tow > full * 0.8 && a.tow < full, 'and fades over a moment too');
  settle(S); ok(a.tow === 0, 'and then is gone');

  // nothing on the grid
  a = car(1000); b = car(1012); S = world([a, b]); S.state = 'lights'; a.tow = 0.7; AERO.update(S, 1 / 60);
  ok(a.tow === 0 && a.wakeOf === null, 'no wake during the start lights');

  // multipliers
  ok(AERO.dragK({ tow: 0 }) === 1 && AERO.gripK({ dirty: 0 }) === 1 && AERO.topK({}) === 1 && AERO.wearK({}) === 1 && AERO.heat({}) === 0, 'neutral without a wake');
  ok(AERO.dragK({ tow: 1 }) < 0.7 && AERO.topK({ tow: 1 }) > 1 && AERO.gripK({ dirty: 1 }) < 0.92 && AERO.wearK({ dirty: 1 }) > 1.2 && AERO.heat({ dirty: 1 }) > 0, 'full wake bites in the right directions');
}

/* ---------- part 2: real races ---------- */
const id = process.argv[2] || 'monza';
function race(label, seed) {
  CFG.trackId = id; CFG.lapsIdx = 1; CFG.weather = 'dry'; CFG.damage = true; CFG.sc = 0;
  let r = seed; Math.random = () => ((r = (r * 1664525 + 1013904223) >>> 0) / 4294967296);
  SS.startSession('race', null); const S = SS.S; S.player.ai = true;
  const st = { frames: 0, towF: 0, dirtyF: 0, run: 0, bothMax: 0, topTow: 0, topFree: 0, nTow: 0, nFree: 0, wearD: 0, wearN: 0, wearC: 0, wearCN: 0, fin: 0, bad: 0, maxTow: 0, maxDirty: 0, hudSteps: 0 };
  let guard = 0;
  while (!S.ended && !S.player.finished && guard++ < 60 * 60 * 25) {
    SS.update(1 / 60, 1 / 60); st.frames++;
    if (S.state === 'lights') continue;
    for (const c of S.cars) {
      if (!Number.isFinite(c.tow) || !Number.isFinite(c.dirty) || c.tow < 0 || c.tow > 1 || c.dirty < 0 || c.dirty > 1) st.bad++;
      if (c.dnf || c.pitting || c.inPit || c.wrecked) continue;
      st.run++;
      if (c.tow > 0.15) st.towF++;
      if (c.dirty > 0.2) st.dirtyF++;
      st.maxTow = Math.max(st.maxTow, c.tow); st.maxDirty = Math.max(st.maxDirty, c.dirty);
      const v = c.ai && c.railV != null ? c.railV : c.speed;
      if (v > 60) { if (c.tow > 0.4) { st.topTow += v; st.nTow++; } else if (c.tow === 0 && c.dirty === 0) { st.topFree += v; st.nFree++; } }
    }
    for (const c of S.cars) c.fin = c.finished;
  }
  const order = S.cars.slice().sort((a, b) => a.pos - b.pos).map(c => c.name || c.id).join(',');
  const res = { label, st, ended: S.ended, fin: S.player.finished, clock: S.clock, order, dnf: S.cars.filter(c => c.dnf).length, lifeAvg: S.cars.reduce((a, c) => a + c.life, 0) / S.cars.length };
  return res;
}

const on = race('on', 12345);
const T0 = AERO.TOW_EFFECT.drag, T1 = AERO.TOW_EFFECT.top, D0 = { ...AERO.DIRTY_EFFECT };
AERO.TOW_EFFECT.drag = 0; AERO.TOW_EFFECT.top = 0; AERO.DIRTY_EFFECT.grip = 0; AERO.DIRTY_EFFECT.heat = 0; AERO.DIRTY_EFFECT.wear = 0;
const off = race('off', 12345);
AERO.TOW_EFFECT.drag = T0; AERO.TOW_EFFECT.top = T1; Object.assign(AERO.DIRTY_EFFECT, D0);

for (const r of [on, off]) {
  const s = r.st;
  console.log(`${r.label.padEnd(4)} race ended=${r.ended} clock=${r.clock.toFixed(0)}s  in tow ${(100 * s.towF / s.run).toFixed(1)}%  in dirty air ${(100 * s.dirtyF / s.run).toFixed(1)}%  ` +
    `mean top speed in tow ${(s.topTow / Math.max(1, s.nTow)).toFixed(1)} vs clear ${(s.topFree / Math.max(1, s.nFree)).toFixed(1)} m/s  avg tyre life ${(r.lifeAvg * 100).toFixed(1)}%  dnf ${r.dnf}`);
}
ok(on.st.bad === 0, 'tow / dirty always finite and within 0..1');
ok(on.ended || on.fin, 'race with the wake effects finishes');
ok(on.st.towF / on.st.run > 0.03, 'cars spend a real share of the race in a tow');
ok(on.st.dirtyF / on.st.run > 0.02, 'cars spend a real share of the race in dirty air');
ok(on.st.towF / on.st.run < 0.7, 'the tow is not on all the time');
ok(on.lifeAvg < off.lifeAvg, `dirty air wears tyres faster (${(on.lifeAvg * 100).toFixed(1)}% vs ${(off.lifeAvg * 100).toFixed(1)}% left)`);
ok(Math.abs(on.clock - off.clock) < off.clock * 0.08, `race length not badly disturbed (${on.clock.toFixed(0)}s vs ${off.clock.toFixed(0)}s)`);

/* ---------- part 3: one car, same inputs, wake forced on or off ---------- */
function drive(tow, dirty, steer, frames) {
  CFG.trackId = id; CFG.lapsIdx = 1; CFG.weather = 'dry'; CFG.damage = false; CFG.sc = 0;
  SS.startSession('race', null); const S = SS.S; const c = S.player; c.ai = false;
  S.state = 'race'; c.vx = Math.cos(c.h) * 60; c.vy = Math.sin(c.h) * 60; c.thr = 1; c.brk = 0; c.steer = steer; c.tow = tow; c.dirty = dirty;
  const v0 = c.speed; let lat = 0, n = 0;
  for (let i = 0; i < frames; i++) { c.thr = 1; c.steer = steer; c.tow = tow; c.dirty = dirty; c.step(1 / 60, S); lat += Math.abs(c.vy); n++; }
  return { vx: c.vx, speed: c.speed, v0, lat: lat / n, life: c.life, temp: c.temp, yaw: c.yawRate != null ? c.yawRate : 0 };
}
const solo = drive(0, 0, 0, 240), towed = drive(1, 0, 0, 240);
console.log(`straight, flat out for 4 s from 60 m/s: solo ${solo.speed.toFixed(1)} m/s, in the tow ${towed.speed.toFixed(1)} m/s`);
ok(towed.speed > solo.speed + 0.5, 'a car in the tow pulls away from a solo car with identical inputs');
ok(towed.speed < solo.speed * 1.12, 'but the tow is not absurd');
const clean = drive(0, 0, 0.35, 240), dirtyRun = drive(0, 1, 0.35, 240);
console.log(`cornering, 4 s: clean temp ${clean.temp.toFixed(3)} life ${clean.life.toFixed(4)} lat ${clean.lat.toFixed(2)}; dirty temp ${dirtyRun.temp.toFixed(3)} life ${dirtyRun.life.toFixed(4)} lat ${dirtyRun.lat.toFixed(2)}`);
ok(dirtyRun.temp > clean.temp, 'dirty air runs the tyres hotter');
ok(dirtyRun.life < clean.life, 'dirty air wears the tyres more');
ok(dirtyRun.lat !== clean.lat || dirtyRun.speed !== clean.speed, 'dirty air changes the handling');

console.log(fail ? `\n${fail} FAILED` : '\nall slipstream checks passed');
process.exit(fail ? 1 : 0);
