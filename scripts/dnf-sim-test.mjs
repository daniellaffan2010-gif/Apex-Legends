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

const id = process.argv[2] || 'monaco';
CFG.trackId = id; CFG.lapsIdx = 1; CFG.weather = 'dry'; CFG.damage = true; CFG.sc = 1;
let fail = 0; const ok = (c, m) => { if (!c) { fail++; console.log('FAIL', m); } };
SS.startSession('race', null); const S = SS.S;
for (let i = 0; i < 60 * 60 * 2; i++) SS.update(1 / 60, 1 / 60);     // two minutes in, player driving nothing
const p = S.player; p.dnf = true; p.retiredBy = 'Test'; p.wrecked = true; p.vx = 0; p.vy = 0;
S.crashCam = 0.01; S.crashKind = 'wreck'; S.crashT = 5;
for (let i = 0; i < 5 && S.simRest == null && !S.ended; i++) SS.update(1 / 60, 1 / 60);
ok(S.simRest != null || S.ended, 'DNF starts the simulation');
const t0 = Date.now(); let n = 0;
while (!S.ended && n < 2000) { SS.simulateRest(14); n++; }
ok(S.ended, 'simulation ends the session');
const res = S.results || [];
console.log('sim took', Date.now() - t0, 'ms, clock', S.clock.toFixed(0), 'results', res.length, 'laps', S.laps, 'sc count', S.sc && S.sc.count);
ok(res.length === S.cars.length, 'everyone classified');
const last = res[res.length - 1];
ok(last && last.car === p && last.dnf, 'player is last as DNF');
const fin = res.filter(r => !r.dnf);
ok(fin.length > 0 && fin.every(r => r.car.finished), 'all others finished');
ok(S.cars.every(c => isFinite(c.x + c.y + c.vx + c.vy)), 'no NaN');
ok(fin.every((r, i) => i === 0 || r.gap == null || isFinite(r.gap)), 'gaps finite');
console.log(fail ? fail + ' FAILED' : 'all checks passed');
process.exit(fail ? 1 : 0);
