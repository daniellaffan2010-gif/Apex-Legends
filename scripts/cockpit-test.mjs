/* The cockpit camera through the REAL G3.build and G3.frame (stubbed DOM, no GPU).
   node scripts/cockpit-test.mjs [trackId] [detail]
   Puts a player car on the racing line, switches to the cockpit view and checks: the lens sits at the eye point and
   looks down the nose; the horizon follows the road's banking and half the chassis lean; the smoothing lag is small and
   a teleport snaps; the helmet is hidden and the slim-pillar body swapped in (and both put back on the way out);
   and, by casting rays through the view, how much of the screen the car itself fills, drawn as an ASCII picture. */
globalThis.window = globalThis;
const mk = () => new Proxy(function () {}, { get: (t, k) => (k === 'canvas' ? { width: 1, height: 1 } : k === 'measureText' ? () => ({ width: 10 }) : k === 'data' ? new Uint8ClampedArray(1 << 20) : (k === 'width' || k === 'height') ? 1 : mk()), set: () => true, apply: () => mk() });
const canvas = () => ({ width: 1, height: 1, getContext: () => mk(), style: {}, addEventListener() {}, toDataURL: () => '' });
globalThis.document = { createElement: canvas, body: { appendChild() {} }, getElementById: () => canvas(), addEventListener() {} };
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.addEventListener = () => {}; globalThis.innerWidth = 1280; globalThis.innerHeight = 720; globalThis.devicePixelRatio = 1;
globalThis.Image = class { set src(v) {} };
globalThis.requestAnimationFrame = () => 0;

const THREE = await import('three');
const { G3 } = await import('../src/render3d/g3.js');
for (const f of ['build', 'frame', 'scenery', 'surfaces', 'car', 'cine', 'crash', 'weather']) { try { await import('../src/render3d/' + f + '.js'); } catch (e) { console.log('skip', f, e.message.slice(0, 60)); } }
const { R } = await import('../src/render2d/view.js'); R.ctx = mk();
const { TRACKS } = await import('../src/tracks/index.js');
const { buildTrack } = await import('../src/tracks/build.js');
const { CFG } = await import('../src/config/settings.js');
const { TEAMS } = await import('../src/config/teams.js');
const { Car } = await import('../src/car/physics.js');

const id = process.argv[2] || 'zandvoort'; CFG.detail = process.argv[3] != null ? +process.argv[3] : 1;
const T = buildTrack(TRACKS.find(t => t.id === id));
G3.scene = new THREE.Scene(); G3.texes = G3.texes || new Map(); G3.dyn = []; G3.occluders = [];
let renders = 0;
G3.rend = { renderLists: { dispose() {} }, capabilities: { getMaxAnisotropy: () => 8 }, domElement: canvas(), setRenderTarget() {}, render() { renders++; } };
G3.cv = { clientWidth: 1280, clientHeight: 720 };
G3.camIso = new THREE.OrthographicCamera(-50, 50, 50, -50, 0.5, 6000);
G3.camTV = new THREE.PerspectiveCamera(38, 16 / 9, 0.5, 6000);
G3.camFP = new THREE.PerspectiveCamera(52, 16 / 9, 0.15, 8000);
const team = TEAMS[0], car = new Car(team, team.drivers[0], 0, T);
const S = { track: T, uid: 1, cars: [car], clock: 0, player: car, weather: { wet: 0 }, wet: 0, rain: 0, state: 'run' };
try { G3.build(S); } catch (e) { console.log('build threw:', e.stack.split('\n').slice(0, 6).join('\n')); process.exit(1); }
const e = G3.cars.find(x => x.c === car), g = e.g, P = g.userData.parts;

const fails = [];
const check = (ok, msg) => { console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) fails.push(msg); };
const put = (i, off, speed) => { car.place(i, off == null ? T.line[i] : off); car.vx = Math.cos(car.h) * speed; car.vy = Math.sin(car.h) * speed; };
const step = (dt) => { S.clock += dt; G3.frame(S); };
const fwd = new THREE.Vector3(), up = new THREE.Vector3();
const lens = () => { const c = G3.cam; fwd.set(0, 0, -1).applyQuaternion(c.quaternion); up.set(0, 1, 0).applyQuaternion(c.quaternion); return c; };

console.log(`cockpit view on ${id} (${T.n} nodes)`);
/* 1. the overhead view still works and leaves the car alone */
put(10, null, 60); step(0.016);
check(G3.cam === G3.camIso, 'overhead view by default (G3.view = "' + G3.view + '")');
check(P.drv.visible && !P.fp, 'helmet visible, normal body in the overhead view');
const normalBody = P.body.geometry;

/* 2. into the cockpit */
G3.view = 'cockpit';
let t0 = performance.now();
for (let k = 0; k < 30; k++) step(1 / 60);
const msPer = (performance.now() - t0) / 30;
let c = lens();
check(c === G3.camFP, 'cockpit lens in use');
check(!P.drv.visible && P.fp, 'helmet hidden, cockpit flag on the body');
check(P.body.geometry !== normalBody, 'open-cockpit body (no solid pillar, no visor strip) swapped in');
const eyeW = new THREE.Vector3(G3.camFP.position.x, G3.camFP.position.y, G3.camFP.position.z);
const eyeL = g.worldToLocal(eyeW.clone());
check(Math.abs(eyeL.z) < 1e-3, `eye on the centre line (lateral ${eyeL.z.toFixed(4)} m)`);
console.log(`       eye in the car's frame: ${eyeL.x.toFixed(3)} m ahead of the car's origin, ${eyeL.y.toFixed(3)} m up`);
const hd = new THREE.Vector3(Math.cos(car.h), 0, Math.sin(car.h));
const yawErr = Math.acos(Math.min(1, new THREE.Vector3(fwd.x, 0, fwd.z).normalize().dot(hd))) * 180 / Math.PI;
check(yawErr < 0.5, `looks down the nose (heading error ${yawErr.toFixed(2)} deg, pitch ${(Math.asin(fwd.y) * 180 / Math.PI).toFixed(1)} deg)`);
check(G3.camFP.fov >= 50 && G3.camFP.fov <= 90, `field of view ${G3.camFP.fov.toFixed(1)} deg vertical, ${(2 * Math.atan(Math.tan(G3.camFP.fov * Math.PI / 360) * 16 / 9) * 180 / Math.PI).toFixed(0)} deg across at 16:9`);
check(G3.scene.fog.near === 220, 'cutscene haze in the cockpit (fog near 220 m)');
console.log(`       frame() in Node: ${msPer.toFixed(2)} ms (CPU only, no GPU)`);

/* 3. what the driver sees: rays through a 72 x 30 grid; # car, . road/kerb, - everything else, ' ' sky */
{
  const carMeshes = [], seeThrough = []; g.traverse(o => { if (o.isMesh && o.visible) (o.material.transparent ? seeThrough : carMeshes).push(o); });
  const world = []; const mine = new Set(carMeshes.concat(seeThrough)); G3.world.traverse(o => { if (o.isMesh && !o.isInstancedMesh && o.visible && !mine.has(o)) world.push(o); });
  const rc = new THREE.Raycaster(); rc.near = 0.15; rc.far = 400;
  const W = 72, H = 30; let carPx = 0, centreCar = 0, centreN = 0, pillarCols = 0, rows = [];
  g.updateMatrixWorld(true); G3.world.updateMatrixWorld(true);
  for (let y = 0; y < H; y++) {
    let row = '';
    for (let x = 0; x < W; x++) {
      const nd = new THREE.Vector2((x + 0.5) / W * 2 - 1, 1 - (y + 0.5) / H * 2);
      rc.setFromCamera(nd, G3.camFP);
      const hc = rc.intersectObjects(carMeshes, false)[0];
      const hw = rc.intersectObjects(world, false)[0];
      let ch = ' ';
      if (hc && (!hw || hc.distance < hw.distance)) { ch = '#'; carPx++; }
      else if (hw) ch = hw.point.y < T.z[car.node] + 1.0 && hw.distance < 400 ? '.' : '-';
      // the road ahead, either side of the pillar: the band between the horizon and the nose
      if (Math.abs(nd.x) < 0.4 && Math.abs(nd.x) > 0.08 && nd.y < 0.12 && nd.y > -0.12) { centreN++; if (ch === '#') centreCar++; }
      if (y === Math.round(H * 0.4) && ch === '#' && Math.abs(nd.x) < 0.2) pillarCols++;
      row += ch;
    }
    rows.push(row);
  }
  console.log('  what the driver sees (# own car, . ground, - scenery, blank = sky/haze):');
  for (const r of rows) console.log('   |' + r + '|');
  const share = carPx / (W * H), mid = centreCar / centreN;
  const pillarDeg = pillarCols * 2 * Math.atan(Math.tan(G3.camFP.fov * Math.PI / 360) * 16 / 9) * 180 / Math.PI / W;
  console.log(`       own car fills ${(share * 100).toFixed(1)}% of the screen, ${(mid * 100).toFixed(1)}% of the road ahead beside the pillar; pillar about ${pillarDeg.toFixed(1)} deg wide`);
  check(share > 0.30 && share < 0.58, 'the halo, nose, front tyres, wheel and cockpit frame the view without walling it off');
  check(mid < 0.10, 'the road ahead is clear either side of the halo pillar');
  check(pillarDeg < 4.5, 'the halo pillar is a thin line');
}

/* 4. smoothing: a 25 deg/s yaw sweep lags by a few hundredths of a second, no more */
{
  put(200, null, 70);
  for (let k = 0; k < 20; k++) step(1 / 60);
  const h0 = car.h; let maxLag = 0;
  for (let k = 0; k < 60; k++) { car.h = h0 + (k + 1) * (25 * Math.PI / 180) / 60; step(1 / 60); c = lens();
    const yaw = Math.atan2(fwd.z, fwd.x); let d = Math.abs(yaw - car.h); d = Math.min(d, 2 * Math.PI - d); maxLag = Math.max(maxLag, d); }
  const lagS = maxLag / (25 * Math.PI / 180);
  check(lagS > 0.005 && lagS < 0.06, `yaw lag in a 25 deg/s sweep: ${(maxLag * 180 / Math.PI).toFixed(2)} deg (~${(lagS * 1000).toFixed(0)} ms)`);
  // a recovery to another part of the circuit snaps, no swing
  put((200 + (T.n >> 1)) % T.n, null, 10); step(1 / 60); c = lens();
  const yaw = Math.atan2(fwd.z, fwd.x); let d = Math.abs(yaw - car.h); d = Math.min(d, 2 * Math.PI - d);
  check(d < 0.01, `a teleport snaps the view (error after one frame ${(d * 180 / Math.PI).toFixed(2)} deg)`);
}

/* 5. roll: the horizon follows the road's banking/camber in full and half the chassis lean */
{
  let bi = 0, bv = 0;
  for (let i = 0; i < T.n; i++) { const b = Math.abs(T.camber[i] || 0) + (T.bankZf ? Math.abs((T.bankZf(i, 1) || 0) - (T.bankZf(i, -1) || 0)) : 0); if (b > bv) { bv = b; bi = i; } }
  put(bi, null, 50); car.roll = 0; for (let k = 0; k < 40; k++) step(1 / 60); c = lens();
  const rollCam = Math.atan2(-(new THREE.Vector3(1, 0, 0).applyQuaternion(c.quaternion).y), up.y) * 180 / Math.PI;
  const carSide = new THREE.Vector3(0, 0, 1).applyQuaternion(g.quaternion);
  const rollCar = Math.asin(carSide.y) * 180 / Math.PI;
  console.log(`       most cambered/banked node ${bi}: car tilted ${rollCar.toFixed(2)} deg, horizon ${rollCam.toFixed(2)} deg`);
  check(Math.abs(Math.abs(rollCam) - Math.abs(rollCar)) < 0.3, 'horizon tilts with the road (no chassis lean)');
  car.roll = 0.11; for (let k = 0; k < 40; k++) step(1 / 60); c = lens();
  const r2 = Math.atan2(-(new THREE.Vector3(1, 0, 0).applyQuaternion(c.quaternion).y), up.y) * 180 / Math.PI;
  console.log(`       with full 0.11 rad chassis lean: horizon ${r2.toFixed(2)} deg (road alone ${rollCam.toFixed(2)})`);
  check(Math.abs(Math.abs(r2 - rollCam) - 0.055 * 180 / Math.PI) < 0.4, 'the head takes half the chassis lean');
  car.roll = 0;
}

/* 5b. a spin from the cockpit: the view turns with the car, no snaps, no look-into-the-corner on top */
{
  put(300 % T.n, null, 60); car.ai = false; car.steer = 0;
  for (let k = 0; k < 30; k++) step(1 / 60);
  car.spinT = 2; car.spinV = 5.5;
  let maxErr = 0, maxStep = 0, maxLook = 0, prev = G3.camFP.quaternion.clone();
  for (let k = 0; k < 90; k++) {
    car.h += car.spinV / 60; car.spinV *= Math.pow(0.5, 1 / 60); step(1 / 60); c = lens();
    const yaw = Math.atan2(fwd.z, fwd.x); let d = Math.abs(yaw - Math.atan2(Math.sin(car.h), Math.cos(car.h))); d = Math.min(d, 2 * Math.PI - d);
    maxErr = Math.max(maxErr, d); maxStep = Math.max(maxStep, c.quaternion.angleTo(prev)); prev.copy(c.quaternion); maxLook = Math.max(maxLook, Math.abs(G3.fpLook || 0));
  }
  car.spinT = 0; car.spinV = 0;
  check(c === G3.camFP && maxErr < 0.2, `a 5.5 rad/s spin: the view follows the car (worst lag ${(maxErr * 57.3).toFixed(1)} deg, biggest frame-to-frame turn ${(maxStep * 57.3).toFixed(1)} deg)`);
  check(maxStep < 0.2, 'no snap in the middle of a spin');
  check(maxLook < 0.03, `no look-into-the-corner added to a spin (${(maxLook * 57.3).toFixed(1)} deg)`);
}

/* 5c. the tyres: at 300 km/h they still visibly roll forwards (no strobing past the markings' spacing) */
{
  put(100, null, 84); for (let k = 0; k < 5; k++) step(1 / 60);
  const A = g.userData.anim, s0 = A.spinF; step(1 / 60);
  let d = A.spinF - s0; if (d < 0) d += 2 * Math.PI;
  check(d > 0.05 && d <= 0.3 + 1e-9, `front tyre turns ${d.toFixed(2)} rad a frame at 300 km/h (forwards, under the 0.39 rad strobe limit of its markings)`);
}

/* 5d. the steering wheel: clockwise from the driver's seat for a right turn, less lock at speed */
{
  const K = P.cockpit;
  check(!!K && K.root.visible, 'the cockpit (wheel, gloves, well) is built and showing');
  const grip = new THREE.Vector3();
  const rightGripY = () => { K.turn.updateMatrixWorld(true); grip.set(0.13, 0, 0).applyMatrix4(K.turn.matrixWorld).applyMatrix4(G3.camFP.matrixWorldInverse); return grip.y; };
  put(150, null, 12); car.steer = 0; for (let k = 0; k < 30; k++) step(1 / 60);
  const y0 = rightGripY(), r0 = K.turn.rotation.z;
  car.steer = 1; for (let k = 0; k < 40; k++) step(1 / 60);
  const slowTurn = Math.abs(K.turn.rotation.z - r0);
  check(rightGripY() < y0 - 0.02, `steering right drops the right-hand grip (clockwise from the seat), ${(slowTurn * 57.3).toFixed(0)} deg at 43 km/h`);
  put(150, null, 85); car.steer = 1; for (let k = 0; k < 40; k++) step(1 / 60);
  const fastTurn = Math.abs(K.turn.rotation.z);
  check(fastTurn < slowTurn * 0.6, `full input at 306 km/h turns it only ${(fastTurn * 57.3).toFixed(0)} deg`);
  car.steer = 0; for (let k = 0; k < 40; k++) step(1 / 60);
}

/* 6. paused (clock still): the view holds and nothing drifts */
{
  const q0 = G3.camFP.quaternion.clone(); step(0); step(0);
  check(G3.camFP.quaternion.angleTo(q0) < 1e-6, 'paused: the view holds (no buzz either)');
}

/* 7. a cutscene or a retirement takes the camera; back to the overhead view puts the car back */
{
  car.dnf = true; step(1 / 60);
  check(G3.cam !== G3.camFP && P.drv.visible && !P.fp, 'a retired car leaves the cockpit (helmet back, normal body)');
  car.dnf = false; step(1 / 60);
  check(G3.cam === G3.camFP, 'and returns to it');
  G3.view = 'iso'; step(1 / 60);
  check(G3.cam === G3.camIso && P.drv.visible && !P.fp && P.body.geometry === normalBody, 'overhead again: helmet, normal body, iso lens');
}

/* 8. a whole lap in the cockpit at racing speed, every frame finite */
{
  G3.view = 'cockpit'; let bad = 0, n = 0;
  for (let i = 0; i < T.n; i += 2) { put(i, null, 80); step(1 / 60); n++;
    const p = G3.camFP.position, q = G3.camFP.quaternion; if (![p.x, p.y, p.z, q.x, q.y, q.z, q.w].every(Number.isFinite)) bad++; }
  check(bad === 0 && renders > 0, `a lap in the cockpit: ${n} frames, ${bad} with a bad camera`);
}
console.log(fails.length ? `\n${fails.length} FAILED` : '\nall passed');
process.exit(fails.length ? 1 : 0);
