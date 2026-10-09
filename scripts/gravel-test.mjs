/* The gravel traps (src/render3d/ground/gravel.js) through the REAL G3.build (stubbed DOM, no GPU), measured.
   node --expose-gc --import ./scripts/asset-register.mjs scripts/gravel-test.mjs [trackId ...]
   For each circuit: puts the player into a gravel trap at speed and runs the trap in the cockpit view, checking
     - the bed: every stone on gravel (FIELD.kindAt where it stands), its centre at the height FIELD.zAtXY gives
       (a quarter of its own height above it), the instance budget and draw calls;
     - the spray: stones fly (how high), land, rest on the surface and are gone a few seconds after the car stops;
       nothing outlives its pool; blown grains are only ever on gravel;
     - the overhead view: no bed;
     - per-frame JS time with a car in the trap, and with nothing near (on a circuit without gravel too);
     - that frame() allocates nothing (heap before and after many frames, with --expose-gc);
     - what the drawn surface already in the world is at the stones (a ray down), so a stone under the old band shows. */
globalThis.window = globalThis;
const mk = () => new Proxy(function () {}, { get: (t, k) => (k === 'canvas' ? { width: 1, height: 1 } : k === 'measureText' ? () => ({ width: 10 }) : k === 'data' ? new Uint8ClampedArray(1 << 20) : (k === 'width' || k === 'height') ? 1 : mk()), set: () => true, apply: () => mk() });
const canvas = () => ({ width: 1, height: 1, getContext: () => mk(), style: {}, addEventListener() {}, toDataURL: () => '' });
globalThis.document = { createElement: canvas, body: { appendChild() {}, classList: { toggle() {} } }, getElementById: () => canvas(), addEventListener() {} };
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.addEventListener = () => {}; globalThis.innerWidth = 1280; globalThis.innerHeight = 720; globalThis.devicePixelRatio = 1;
globalThis.Image = class { set src(v) {} };
globalThis.requestAnimationFrame = () => 0;
const THREE = await import('three');
const { G3 } = await import('../src/render3d/g3.js');
for (const f of ['build', 'frame', 'scenery', 'surfaces', 'car', 'cine', 'crash', 'weather']) { try { await import('../src/render3d/' + f + '.js'); } catch (e) {} }
const { R } = await import('../src/render2d/view.js'); R.ctx = mk();
const { TRACKS } = await import('../src/tracks/index.js');
const { buildTrack } = await import('../src/tracks/build.js');
const { CFG } = await import('../src/config/settings.js');
const { TEAMS } = await import('../src/config/teams.js');
const { Car } = await import('../src/car/physics.js');
const { GRAVEL } = await import('../src/render3d/ground/gravel.js');
const { FIELD } = await import('../src/render3d/ground/field.js');

// where the time goes, per part of frame() (wrapping the methods; only while the car is in the trap)
const parts = ['bedFrame', 'emit', 'stepStones', 'stepGrains', 'stepDust', 'drawPool', 'drawDust'], ptime = {};
let timing = false;
for (const p of parts) { const f = GRAVEL[p]; ptime[p] = 0; GRAVEL[p] = function (...a) { if (!timing) return f.apply(this, a); const t = performance.now(); const r = f.apply(this, a); ptime[p] += performance.now() - t; return r; }; }
const ids = process.argv.slice(2).length ? process.argv.slice(2) : ['zandvoort', 'spa', 'suzuka', 'silverstone', 'cota', 'mexico', 'interlagos', 'monza', 'monaco'];
const fails = [];
const ok = (c, m) => { if (!c) fails.push(m); return c; };
const M4 = new THREE.Matrix4(), P3 = new THREE.Vector3(), Q = new THREE.Quaternion(), SC = new THREE.Vector3();
const ray = new THREE.Raycaster(), down = new THREE.Vector3(0, -1, 0);

for (const id of ids) {
  CFG.detail = 1;
  const T = buildTrack(TRACKS.find(t => t.id === id));
  G3.scene = new THREE.Scene(); G3.texes = G3.texes || new Map(); G3.dyn = []; G3.occluders = []; G3.world = null;
  G3.rend = { renderLists: { dispose() {} }, capabilities: { getMaxAnisotropy: () => 8 }, domElement: canvas(), setRenderTarget() {}, render() {} };
  G3.cv = { clientWidth: 1280, clientHeight: 720 };
  G3.camIso = new THREE.OrthographicCamera(-50, 50, 50, -50, 0.5, 6000);
  G3.camTV = new THREE.PerspectiveCamera(38, 16 / 9, 0.5, 6000);
  G3.camFP = new THREE.PerspectiveCamera(52, 16 / 9, 0.15, 8000);
  const team = TEAMS[0], car = new Car(team, team.drivers[0], 0, T);
  const S = { track: T, uid: 1, cars: [car], clock: 0, player: car, weather: { wet: 0 }, wet: 0, rain: 0, state: 'run' };
  G3.build(S);
  const before = G3.world.children.length;
  let t0 = performance.now();
  GRAVEL.build(G3, S);
  const buildMs = performance.now() - t0, added = G3.world.children.length - before;
  const view = { fp: true, x: 0, y: 0, z: 0, hx: 1, hy: 0, dt: 1 / 60 };
  const setView = (fp, dt) => { const hx = Math.cos(car.h), hy = Math.sin(car.h); view.fp = fp; view.hx = hx; view.hy = hy; view.dt = dt;
    view.x = fp ? car.x + hx * GRAVEL.AHEAD : car.x; view.y = fp ? car.y + hy * GRAVEL.AHEAD : car.y; view.z = car.z; };
  if (!GRAVEL.on) {
    // no gravel: frame must cost nothing and add nothing
    car.place(10, 0); car.vx = 60; car.vy = 0;
    t0 = performance.now(); for (let k = 0; k < 600; k++) { S.clock += 1 / 60; setView(true, 1 / 60); GRAVEL.frame(G3, S, view); }
    const ms = (performance.now() - t0) / 600;
    console.log(`${id.padEnd(12)} no gravel: meshes added ${added}, frame ${(ms * 1000).toFixed(1)} us, build ${buildMs.toFixed(1)} ms`);
    ok(added === 0, id + ': meshes added without gravel');
    continue;
  }
  // the widest trap: a node whose gravel reaches 8 m out for 6 nodes running
  let trap = null;
  for (let i = 0; i < T.n && !trap; i++) for (const sg of [-1, 1]) {
    let g = true; for (let k = 0; k < 6 && g; k++) g = FIELD.kindAt(T, (i + k) % T.n, sg * (T.half + 8)) === 'gravel';
    if (g) { trap = { i, sg }; break; }
  }
  if (!trap) for (let i = 0; i < T.n && !trap; i++) for (const sg of [-1, 1]) {
    let g = true; for (let k = 0; k < 4 && g; k++) g = FIELD.kindAt(T, (i + k) % T.n, sg * (T.half + 4)) === 'gravel';
    if (g) { trap = { i, sg }; break; }
  }
  if (!ok(trap, id + ': no trap found')) continue;
  // start 3 m out, or just inside the gravel where a trap begins behind a strip of tarmac
  const i0 = trap.i, off0 = trap.sg * Math.max(T.half + 3, GRAVEL.ua[i0 * 2 + (trap.sg > 0 ? 1 : 0)] + 0.6);
  car.x = T.x[i0] + T.nx[i0] * off0; car.y = T.y[i0] + T.ny[i0] * off0; car.h = T.ang[i0] + trap.sg * 0.10;
  car.vx = Math.cos(car.h) * 38; car.vy = Math.sin(car.h) * 38; car.node = i0; car.off = off0; car.ai = false;
  const move = dt => {
    const sp = Math.hypot(car.vx, car.vy), dec = Math.min(sp, 13 * dt);
    if (sp > 0) { car.vx -= car.vx / sp * dec; car.vy -= car.vy / sp * dec; }
    car.x += car.vx * dt; car.y += car.vy * dt;
    const L = FIELD.locate(T, car.x, car.y, car.node); car.node = L.i; car.off = L.off;
  };
  let maxS = 0, maxG = 0, maxD = 0, maxBed = 0, maxH = 0, landed = 0, blownBad = 0, blownN = 0, msIn = 0, nIn = 0, inGravel = 0; const times = [];
  const dt = 1 / 60;
  for (let k = 0; k < 150; k++) {
    S.clock += dt; move(dt); setView(true, dt);
    const inG = FIELD.kindAt(T, car.node, car.off) === 'gravel'; if (inG) inGravel++;
    GRAVEL.frame(G3, S, view);
    const Sp = GRAVEL.S, Gp = GRAVEL.G;
    maxS = Math.max(maxS, Sp.n); maxG = Math.max(maxG, Gp.n); maxD = Math.max(maxD, GRAVEL.D.n); maxBed = Math.max(maxBed, GRAVEL.bed.count);
    for (let q = 0; q < Sp.n; q++) { if (Sp.st[q] === 1) maxH = Math.max(maxH, Sp.z[q] - Sp.gz[q]); else landed++; }
    for (let q = 0; q < Gp.n; q++) if (Gp.st[q] === 3) { blownN++; const L = FIELD.locate(T, Gp.x[q], Gp.y[q], Gp.node[q]); if (FIELD.kindAt(T, L.i, L.off) !== 'gravel') { blownBad++; if (process.env.GDEBUG) console.log('   blown grain on', FIELD.kindAt(T, L.i, L.off), 'node', L.i, 'off', L.off.toFixed(2), 'gone', Gp.dd[q].toFixed(2), 'of', Gp.lim[q].toFixed(2), 'ua/ub', GRAVEL.ua[L.i * 2 + (L.off > 0 ? 1 : 0)], GRAVEL.ub[L.i * 2 + (L.off > 0 ? 1 : 0)]); } }
    ok(Sp.n <= 1200 && Gp.n <= 2400 && GRAVEL.D.n <= 400 && GRAVEL.nGW <= 400 && GRAVEL.nGS <= 2000 && GRAVEL.nGS >= 0 && GRAVEL.nGW >= 0 && GRAVEL.nGS + GRAVEL.nGW === Gp.n, id + ': pool counts out of bounds at frame ' + k);
  }
  /* the bed as it stands now: every stone on gravel; its base against FIELD.zAtXY, against a gravel ribbon laid by
     FIELD.ribbon (what the new ground will draw: it blends along the segment, zAtXY blends to the nearest node, and on
     banking the two part by centimetres), and against whatever surface the world draws there today (a ray down) */
  const bed = GRAVEL.bed, bedN = bed.count; let off = 0, zErr = 0, zMax = 0, worldGap = 0, worldN = 0, worldMax = -1e9, worldMin = 1e9;
  let ribErr = 0, ribMax = 0, ribN = 0, zWorst = '', worldHit = '';
  const ribs = [];
  for (const sd of [0, 1]) {
    const sg = sd ? 1 : -1, ua = GRAVEL.ua, ub = GRAVEL.ub;
    const g = FIELD.ribbon(T, i => sg * Math.max(0, ua[i * 2 + sd]), i => sg * Math.max(0, ub[i * 2 + sd]),
      { h: (i, o) => FIELD.zAt(T, i, o) - FIELD.baseZ(T, i, o), lane: 1, sub: 4, filter: i => ua[i * 2 + sd] >= 0 && ua[((i + 1) % T.n) * 2 + sd] >= 0 });
    ribs.push(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })));
  }
  // (not the see-through overlays: the cloud-shadow pass at Silverstone and Zandvoort multiplies over everything 11 cm up)
  const ground = []; G3.world.traverse(o => { const m = o.material; if (o.isMesh && !o.isInstancedMesh && o.geometry && o.visible && !(m && m.transparent && m.depthWrite === false)) ground.push(o); });
  G3.scene.updateMatrixWorld(true);
  for (let q = 0; q < bed.count; q++) {
    bed.getMatrixAt(q, M4); M4.decompose(P3, Q, SC);
    const sy = Math.hypot(M4.elements[4], M4.elements[5], M4.elements[6]), base = P3.y - sy * 0.25;
    const L = FIELD.locate(T, P3.x, P3.z, car.node);
    if (FIELD.kindAt(T, L.i, L.off) !== 'gravel') off++;
    const e = Math.abs(base - FIELD.zAtXY(T, P3.x, P3.z, car.node)); zErr += e;
    if (e > zMax) { zMax = e; zWorst = `node ${L.i} off ${L.off.toFixed(1)} bank ${(T.bank[L.i] || 0).toFixed(3)} curv ${T.curv[L.i].toFixed(4)}`; }
    if (q % 5 === 0) {
      ray.set(new THREE.Vector3(P3.x, P3.y + 2, P3.z), down); ray.far = 4;
      const r = ray.intersectObjects(ribs, false)[0];
      if (r) { const g = Math.abs(base - r.point.y); ribErr += g; ribN++; ribMax = Math.max(ribMax, g); }
    }
    if (q % 40 === 0) {
      const h = ray.intersectObjects(ground, false)[0];
      if (h && !worldHit) { const m = Array.isArray(h.object.material) ? h.object.material[0] : h.object.material; worldHit = `${h.object.name || h.object.type} ${m ? m.type : ""} parent ${h.object.parent && (h.object.parent.name || h.object.parent.type)} tris ${h.object.geometry.index ? h.object.geometry.index.count / 3 : h.object.geometry.attributes.position.count / 3} ${m && m.color ? '#' + m.color.getHexString() : ''}${m && m.map ? ' (textured)' : ''}`; }
      if (h) { const g = base - h.point.y; worldGap += g; worldN++; worldMax = Math.max(worldMax, g); worldMin = Math.min(worldMin, g); }
    }
  }
  /* the time: the same run into the trap five times over, the first to warm up, timing the frames with the car in
     gravel (the bed being rewritten, the spray at its thickest) */
  for (let rep = 0; rep < 5; rep++) {
    car.x = T.x[i0] + T.nx[i0] * off0; car.y = T.y[i0] + T.ny[i0] * off0; car.h = T.ang[i0] + trap.sg * 0.10;
    car.vx = Math.cos(car.h) * 38; car.vy = Math.sin(car.h) * 38; car.node = i0;
    for (let k = 0; k < 120; k++) {
      S.clock += dt; move(dt); setView(true, dt);
      const inG = FIELD.kindAt(T, car.node, car.off) === 'gravel' && rep > 0;
      timing = inG;
      const a = performance.now(); GRAVEL.frame(G3, S, view); const b = performance.now();
      timing = false;
      if (inG) { msIn += b - a; nIn++; times.push(b - a); }
    }
  }
  times.sort((p, q) => p - q); const med = times.length ? times[times.length >> 1] : 0, p90 = times.length ? times[Math.floor(times.length * 0.9)] : 0;
  const breakdown = parts.map(p => p + ' ' + (ptime[p] / Math.max(1, nIn)).toFixed(3)).join(', ');
  for (const p of parts) ptime[p] = 0;
  // the car stops: everything must settle and go within a few seconds
  car.vx = car.vy = 0;
  let restErr = 0, restN = 0;
  for (let k = 0; k < 60 * 5; k++) {
    S.clock += dt; setView(true, dt); GRAVEL.frame(G3, S, view);
    if (k === 30) for (let q = 0; q < GRAVEL.S.n; q++) if (GRAVEL.S.st[q] === 2) { restN++; restErr += Math.abs(GRAVEL.S.z[q] - GRAVEL.S.r[q] * 0.3 - FIELD.zAtXY(T, GRAVEL.S.x[q], GRAVEL.S.y[q], car.node)); }
  }
  let leftD = 0; for (let q = 0; q < GRAVEL.D.n; q++) if (GRAVEL.D.st[q] !== 4) leftD++;   // (the wind's own wisps carry on)
  const leftS = GRAVEL.S.n, leftGS = GRAVEL.nGS;
  // the overhead view: no bed
  setView(false, dt); GRAVEL.frame(G3, S, view);
  ok(GRAVEL.bed.count === 0 && !GRAVEL.bed.visible, id + ': bed shows in the overhead view');
  // allocation: frames with the car back in the trap, heap before and after
  car.x = T.x[i0] + T.nx[i0] * off0; car.y = T.y[i0] + T.ny[i0] * off0; car.vx = Math.cos(car.h) * 30; car.vy = Math.sin(car.h) * 30; car.node = i0;
  const steady = n => { for (let k = 0; k < n; k++) { S.clock += dt; setView(true, dt); car.x += Math.cos(S.clock * 3) * 0.02; GRAVEL.frame(G3, S, view); } };
  steady(300);
  let heap = 0;
  if (globalThis.gc) { gc(); const h0 = process.memoryUsage().heapUsed; steady(3000); gc(); heap = process.memoryUsage().heapUsed - h0; }
  // far from any trap: the cost of nothing
  let far = -1, fd = 0;
  for (let i = 0; i < T.n; i++) { let d = 1e9; for (let s = 0; s < GRAVEL.segN.length; s++) d = Math.min(d, Math.hypot(GRAVEL.segCx[s] - T.x[i], GRAVEL.segCy[s] - T.y[i])); if (d > fd) { fd = d; far = i; } }
  car.x = T.x[far]; car.y = T.y[far]; car.node = far; car.off = 0; car.vx = car.vy = 0;
  for (let k = 0; k < 400; k++) { S.clock += dt; setView(true, dt); GRAVEL.frame(G3, S, view); }
  t0 = performance.now(); for (let k = 0; k < 2000; k++) { S.clock += dt; setView(true, dt); GRAVEL.frame(G3, S, view); }
  const msFar = (performance.now() - t0) / 2000;

  const tri = c => c * 8;
  console.log(`${id.padEnd(12)} patches ${GRAVEL.pa.length} segs ${GRAVEL.segN.length} build ${buildMs.toFixed(0)} ms | meshes ${added} | in gravel ${inGravel}/150 frames`);
  console.log(`   bed max ${maxBed} (${tri(maxBed)} tris), now ${bedN}: off gravel ${off}, vs FIELD.zAtXY mean ${(zErr / Math.max(1, bedN) * 1000).toFixed(2)} mm max ${(zMax * 1000).toFixed(2)} mm (${zWorst})`);
  console.log(`   vs a FIELD.ribbon gravel surface (${ribN} stones): mean ${(ribErr / Math.max(1, ribN) * 1000).toFixed(2)} mm, max ${(ribMax * 1000).toFixed(2)} mm`);
  console.log(`   vs the surface already drawn (ray down, ${worldN} stones): first hit ${worldHit}; stone base minus surface mean ${(worldGap / Math.max(1, worldN) * 1000).toFixed(1)} mm, ${(worldMin * 1000).toFixed(1)} .. ${(worldMax * 1000).toFixed(1)} mm`);
  console.log(`   spray: stones max ${maxS} (${tri(maxS)} tris), grains max ${maxG} (${maxG * 4} tris), dust max ${maxD}; highest stone ${maxH.toFixed(2)} m; resting stone height err ${(restErr / Math.max(1, restN) * 1000).toFixed(2)} mm (${restN})`);
  console.log(`   blown grains seen ${blownN}, off gravel ${blownBad}; 5 s after stopping: stones ${leftS} thrown grains ${leftGS} dust ${leftD}`);
  console.log(`   frame JS in the trap: median ${med.toFixed(3)} ms, p90 ${p90.toFixed(3)} ms, mean ${(msIn / Math.max(1, nIn)).toFixed(3)} ms over ${nIn} frames (mean ${breakdown}); far (${fd.toFixed(0)} m) ${(msFar * 1000).toFixed(1)} us; heap growth over 3000 frames ${globalThis.gc ? (heap / 1024).toFixed(0) + ' KB' : 'n/a (run with --expose-gc)'}`);
  ok(added === 4, id + ': expected 4 objects, got ' + added);
  ok(maxBed > 500, id + ': bed too thin (' + maxBed + ')');
  ok(off === 0, id + ': ' + off + ' bed stones off the gravel');
  ok(ribMax < 0.01, id + ': bed stone off the ribbon surface by ' + ribMax.toFixed(3));
  // zAtXY blends to the nearest node, the ribbon along its segment: on banking they part by centimetres (reported, not failed)
  ok(zMax < 0.10, id + ': bed stone off FIELD.zAtXY by ' + zMax.toFixed(3));
  ok(maxS > 50 && maxH > 0.2, id + ': no spray');
  ok(blownBad === 0, id + ': blown grains off the gravel');
  ok(leftS === 0 && leftGS === 0 && leftD === 0, id + ': particles left 5 s after the car stopped');
  ok(nIn === 0 || med < 0.5, id + ": median frame over 0.5 ms in the trap");
  ok(msFar < 0.05, id + ': frame costs ' + msFar.toFixed(3) + ' ms with nothing near');
  ok(!globalThis.gc || heap < 256 * 1024, id + ': heap grew ' + heap + ' bytes');
}
GRAVEL.dispose();
console.log(fails.length ? 'FAIL\n  ' + fails.join('\n  ') : 'PASS');
process.exit(fails.length ? 1 : 0);
