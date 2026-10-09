/* Finishing position == classified result, in Node: randomised finishing orders with every kind of penalty, DSQs, DNFs and the
   mandatory-stop rule, pushed through the real endSession(), and checked against an independently computed expected order.
   node --import ./scripts/asset-register.mjs scripts/classification-test.mjs [track] [rounds] */
globalThis.window = globalThis;
const els = new Map();
const el = id => { if (!els.has(id)) els.set(id, new Proxy({ textContent: '', hidden: false, style: { setProperty() {} }, dataset: {}, children: [], classList: { toggle() {}, add() {}, remove() {} }, appendChild() {}, setAttribute() {}, addEventListener() {}, querySelector() { return null; } }, { get: (t, k) => (k in t ? t[k] : () => el('x')), set: (t, k, v) => ((t[k] = v), true) })); return els.get(id); };
globalThis.document = { getElementById: el, querySelector: s => el(s), querySelectorAll: () => [], createElement: () => el('n' + Math.random()), body: { appendChild() {} }, addEventListener() {} };
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.addEventListener = () => {}; globalThis.innerWidth = 1280; globalThis.innerHeight = 720; globalThis.devicePixelRatio = 1;
globalThis.requestAnimationFrame = () => 0; globalThis.Image = class { set src(v) {} };
const SS = await import('../src/game/session.js');
const PEN = await import('../src/game/penalties.js');
const { CFG } = await import('../src/config/settings.js');
const { R } = await import('../src/render2d/view.js'); R.cv = { clientWidth: 1280, clientHeight: 720, style: {} }; R.ctx = { setTransform() {} }; R.W = 1280; R.H = 720;

const id = process.argv[2] || 'monza', rounds = +(process.argv[3] || 60);
CFG.trackId = id;
// each round runs a different mix of the options menu: damage, safety car, weather, grid, length, difficulty, tyre
const WX = ['dry', 'auto', 'wet'];
const setCfg = r => { CFG.damage = r & 1; CFG.sc = (r >> 1) & 1; CFG.weather = WX[(r >> 2) % 3]; CFG.grid = (r >> 3) % 3; CFG.lapsIdx = (r >> 5) % 3; CFG.diff = r % 4; CFG.tyre = ['soft', 'medium', 'hard'][(r >> 1) % 3]; };
let fail = 0, checks = 0; const ok = (c, m) => { checks++; if (!c) { fail++; if (fail < 25) console.log('FAIL', m); } };
let seed = 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;

for (let round = 0; round < rounds; round++) {
  setCfg(round); SS.startSession('race', null); const S = SS.S; S.state = 'run'; S.clock = 400;
  const cars = S.cars.slice();
  // a random finishing order with random gaps, some close enough that penalties reshuffle them
  const order = cars.slice().sort(() => rnd() - 0.5);
  let t = 280000; const raw = new Map();
  order.forEach((c, i) => { t += 200 + rnd() * 4000; c.finished = true; c.finishTime = t; c.lap = S.laps + 1; c.stops = 1; c.used = new Set(['medium', 'hard']); raw.set(c, i); });
  // retirements
  const dnfs = []; const nDnf = Math.floor(rnd() * 4);
  for (const c of order.slice().reverse().slice(0, nDnf)) { c.finished = false; c.dnf = true; c.prog = rnd() * 1e4; dnfs.push(c); }
  const run = order.filter(c => !c.dnf);
  // penalties
  const dsqs = [];
  for (const c of run) {
    const r = rnd(); c.pen = null;
    if (r < 0.15) PEN.issue(S, c, 't5', 'x');
    else if (r < 0.25) PEN.issue(S, c, 't10', 'x');
    else if (r < 0.30) { PEN.issue(S, c, 't5', 'x'); PEN.issue(S, c, 't5', 'x'); }
    else if (r < 0.36) PEN.issue(S, c, 'dt', 'x');
    else if (r < 0.40) PEN.issue(S, c, 'sg', 'x');
    else if (r < 0.43) { PEN.issue(S, c, 'dsq', 'x'); dsqs.push(c); }
    else if (r < 0.47) { PEN.issue(S, c, 'dt', 'x'); PEN.served(S, c, 'dt'); }      // served: no time
  }
  // no-stop offenders
  const twoC = [];
  for (const c of run) if (!dsqs.includes(c) && rnd() < 0.05) { c.stops = 0; c.used = new Set(['medium']); twoC.push(c); }
  SS.endSession();
  const res = S.results;
  const name = c => c.drv.abbr;
  // ---- expected, computed from scratch
  const owedOf = c => { const p = c.pen; if (!p) return 0; let s = p.time; for (const x of p.todo) s += x.kind === 'dt' ? 20 : x.kind === 'sg' ? 30 : 0; return s; };
  const bad = new Set([...dsqs, ...twoC]);
  const good = run.filter(c => !bad.has(c));
  const exp = good.map(c => ({ c, k: c.finishTime + owedOf(c) * 1000 })).sort((a, b) => a.k - b.k || raw.get(a.c) - raw.get(b.c)).map(x => x.c);
  const tag = `round ${round}`;
  ok(res.length === cars.length, `${tag}: result rows ${res.length} != ${cars.length}`);
  // order of the classified finishers
  const gotGood = res.filter(r => !r.dq && !r.dnf).map(r => r.car);
  ok(gotGood.length === exp.length && gotGood.every((c, i) => c === exp[i]),
     `${tag}: classified order differs\n   got ${gotGood.map(name).join(' ')}\n   exp ${exp.map(name).join(' ')}`);
  // disqualified and retired go below everyone classified
  const firstBad = res.findIndex(r => r.dq || r.dnf);
  ok(firstBad === -1 || res.slice(firstBad).every(r => r.dq || r.dnf), `${tag}: a DSQ/DNF sits above a classified finisher`);
  ok(res.slice(exp.length + bad.size).every(r => r.dnf) && res.slice(exp.length, exp.length + bad.size).every(r => r.dq && !r.dnf), `${tag}: DSQs not directly under the finishers, DNFs last`);
  for (const c of dsqs) ok(res.find(r => r.car === c).dq, `${tag}: ${name(c)} black-flagged but not marked DSQ`);
  for (const c of twoC) ok(res.find(r => r.car === c).dq, `${tag}: ${name(c)} made no stop but not DSQ`);
  // every disqualification says why
  for (const c of dsqs) ok(res.find(r => r.car === c).dqReason === 'x', `${tag}: ${name(c)} black flag reason lost: '${res.find(r => r.car === c).dqReason}'`);
  for (const c of twoC) ok(!!res.find(r => r.car === c).dqReason, `${tag}: ${name(c)} no-stop DSQ has no reason`);
  for (const r of res) if (!r.dq) ok(!r.dqReason, `${tag}: ${name(r.car)} not disqualified but has a reason`);
  // positions agree everywhere
  res.forEach((r, i) => { ok(r.pos === i + 1, `${tag}: row ${i} says pos ${r.pos}`); ok(r.car.pos === i + 1, `${tag}: car ${name(r.car)}.pos ${r.car.pos} != row ${i + 1}`); });
  ok(new Set(res.map(r => r.car)).size === cars.length, `${tag}: a car appears twice or not at all`);
  // the results panel's "places lost": cars that were behind on the road, are classified ahead, and are neither DSQ nor DNF
  {
    const pl = S.player, me = res.find(r => r.car === pl);
    const want = (me.dq || me.dnf) ? 0 : good.filter(c => raw.get(c) > raw.get(pl) && exp.indexOf(c) < exp.indexOf(pl)).length;
    ok(S.penPlaces === want, `${tag}: penPlaces ${S.penPlaces} != ${want}`);
  }
  // winner, total and gaps
  if (exp.length) {
    const w = res[0], k0 = exp[0].finishTime + owedOf(exp[0]) * 1000;
    ok(w.car === exp[0], `${tag}: wrong winner`);
    ok(w.total != null && Math.abs(w.total - k0) < 1, `${tag}: winner total ${w.total} != ${k0}`);
    for (const r of res) {
      if (r.dq || r.dnf || r === w) continue;
      const g = r.car.finishTime + owedOf(r.car) * 1000 - k0;
      ok(r.gap != null && Math.abs(r.gap - g) < 1, `${tag}: ${name(r.car)} gap ${r.gap} != ${g}`);
      ok(r.pen === owedOf(r.car), `${tag}: ${name(r.car)} pen shown ${r.pen} != owed ${owedOf(r.car)}`);
    }
  }
}
console.log(`${checks} checks, ${fail} failed`);
process.exit(fail ? 1 : 0);
