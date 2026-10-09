/* A picture of the cockpit view without a browser: the real G3.build and G3.frame (stubbed DOM, no GPU), then a small
   software rasteriser (z-buffer, flat Lambert shading from the sun, linear fog, sRGB out) over the player's car and the
   world's meshes near the camera, written as a PNG.
   node --import ./scripts/asset-register.mjs scripts/cockpit-render.mjs <track> <node> <out.png> [steer -1..1] [width] */
globalThis.window = globalThis;
const mk = () => new Proxy(function () {}, { get: (t, k) => (k === 'canvas' ? { width: 1, height: 1 } : k === 'measureText' ? () => ({ width: 10 }) : k === 'data' ? new Uint8ClampedArray(1 << 20) : (k === 'width' || k === 'height') ? 1 : mk()), set: () => true, apply: () => mk() });
const canvas = () => ({ width: 1, height: 1, getContext: () => mk(), style: {}, addEventListener() {}, toDataURL: () => '' });
globalThis.document = { createElement: canvas, body: { appendChild() {}, classList: { toggle() {} } }, getElementById: () => canvas(), addEventListener() {} };
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.addEventListener = () => {}; globalThis.innerWidth = 1280; globalThis.innerHeight = 720; globalThis.devicePixelRatio = 1;
globalThis.Image = class { set src(v) {} };
globalThis.requestAnimationFrame = () => 0;
const fs = await import('node:fs'), zlib = await import('node:zlib');
const THREE = await import('three');
const { G3 } = await import('../src/render3d/g3.js');
for (const f of ['build', 'frame', 'scenery', 'surfaces', 'car', 'cine', 'crash', 'weather']) { try { await import('../src/render3d/' + f + '.js'); } catch (e) {} }
const { R } = await import('../src/render2d/view.js'); R.ctx = mk();
const { TRACKS } = await import('../src/tracks/index.js');
const { buildTrack } = await import('../src/tracks/build.js');
const { CFG } = await import('../src/config/settings.js');
const { TEAMS } = await import('../src/config/teams.js');
const { Car } = await import('../src/car/physics.js');

const [id = 'zandvoort', nodeArg = '10', out = 'cockpit.png', steerArg = '0', wArg = '960'] = process.argv.slice(2);
CFG.detail = 1;
const T = buildTrack(TRACKS.find(t => t.id === id));
G3.scene = new THREE.Scene(); G3.texes = G3.texes || new Map(); G3.dyn = []; G3.occluders = [];
G3.rend = { renderLists: { dispose() {} }, capabilities: { getMaxAnisotropy: () => 8 }, domElement: canvas(), setRenderTarget() {}, render() {} };
G3.cv = { clientWidth: 1280, clientHeight: 720 };
const W = +wArg, H = Math.round(W * 9 / 16);
G3.camIso = new THREE.OrthographicCamera(-50, 50, 50, -50, 0.5, 6000);
G3.camTV = new THREE.PerspectiveCamera(38, W / H, 0.5, 6000);
G3.camFP = new THREE.PerspectiveCamera(52, W / H, 0.15, 8000);
const team = TEAMS.find(t => t.id === 'mcl') || TEAMS[0], car = new Car(team, team.drivers[0], 0, T);
const S = { track: T, uid: 1, cars: [car], clock: 0, player: car, weather: { wet: 0 }, wet: 0, rain: 0, state: 'run', mode: 'race', laps: 5 };
G3.build(S);
/* HOOKS=a.mjs,b.mjs: modules exporting install(G3, S, THREE) (after the build) and frame(G3, S, THREE) (every frame),
   to try a ground system in the picture before it is wired into the game */
const HOOKS = [];
for (const h of (process.env.HOOKS || '').split(',').filter(Boolean)) { const m = await import(new URL('file://' + (await import('node:path')).resolve(h)).href); HOOKS.push(m); if (m.install) await m.install(G3, S, THREE); }
const i0 = process.env.PIT ? ((T.pitBox + +nodeArg) % T.n + T.n) % T.n : +nodeArg % T.n;
if (process.env.PIT) { car.place(i0, T.pitCentre(i0)); car.inPit = true; } else car.place(i0, T.line[i0]); car.vx = Math.cos(car.h) * 70; car.vy = Math.sin(car.h) * 70; car.ai = false; car.steer = +steerArg; car.pos = 7; car.lap = 2; car.lapStart = 0;
G3.view = 'cockpit';
for (let k = 0; k < 40; k++) { S.clock += 1 / 60; G3.frame(S); for (const m of HOOKS) if (m.frame) m.frame(G3, S, THREE); }
const cam = G3.camFP;
// TILT=deg: look further down (or up, negative) from the cockpit, to inspect the well and the floor
if (process.env.TILT) cam.rotateX(-(+process.env.TILT) * Math.PI / 180);
/* CAM=front|rear: stand outside, low, at the front-left or rear-left corner, looking at the suspension instead */
if (process.env.CAM) {
  const g0 = G3.cars.find(e => e.c === car).g; g0.updateMatrixWorld(true);
  const rear = process.env.CAM === 'rear', far = process.env.CAM === 'far', at = new THREE.Vector3(far ? 0 : rear ? -1.4 : 1.4, far ? 0.3 : 0.35, 0).applyMatrix4(g0.matrixWorld);
  cam.position.copy(new THREE.Vector3(far ? -8 : rear ? -3.4 : 3.4, far ? 6.5 : 1.1, far ? -7 : -2.2).applyMatrix4(g0.matrixWorld)); cam.fov = far ? 45 : 40; cam.lookAt(at);
  for (const o of g0.children) if (o.name === 'cockpit') o.visible = false;
}
cam.updateMatrixWorld(); cam.updateProjectionMatrix();

/* ---- the rasteriser ---- */
const col = new Float32Array(W * H * 3), zb = new Float32Array(W * H).fill(1e9);
const fog = G3.scene.fog, fogC = fog ? fog.color : new THREE.Color(0.7, 0.8, 0.9), bg = G3.scene.background && G3.scene.background.isColor ? G3.scene.background : fogC;
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const o = (y * W + x) * 3; const k = y / H; col[o] = bg.r * (1.1 - k * 0.2); col[o + 1] = bg.g * (1.1 - k * 0.2); col[o + 2] = bg.b * (1.1 - k * 0.2); }
const sunDir = G3.sun ? G3.sun.position.clone().sub(G3.sun.target.position).normalize() : new THREE.Vector3(0.3, 1, 0.2).normalize();
const VP = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
const camPos = cam.position;
const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
const ca = new THREE.Vector4(), cb = new THREE.Vector4(), cc = new THREE.Vector4();
let tris = 0;
const CULL = !!process.env.CULL; let cullThis = false;
function drawTri(A, B, C, rgb, alpha) {
  e1.subVectors(B, A); e2.subVectors(C, A); n.crossVectors(e1, e2); const L = n.length(); if (L < 1e-12) return; n.divideScalar(L);
  const mid = A.clone().add(B).add(C).divideScalar(3), toCam = camPos.clone().sub(mid);
  if (n.dot(toCam) < 0) { if (CULL && cullThis) return; n.negate(); }   // two-sided, lit on the side we see (CULL=1: drop back faces as WebGL does)
  const lam = 0.42 + 0.75 * Math.max(0, n.dot(sunDir));
  const dist = toCam.length();
  let f = 0; if (fog) f = Math.min(1, Math.max(0, (dist - fog.near) / (fog.far - fog.near)));
  const r = (rgb.r * lam) * (1 - f) + fogC.r * f, g = (rgb.g * lam) * (1 - f) + fogC.g * f, bl = (rgb.b * lam) * (1 - f) + fogC.b * f;
  ca.set(A.x, A.y, A.z, 1).applyMatrix4(VP); cb.set(B.x, B.y, B.z, 1).applyMatrix4(VP); cc.set(C.x, C.y, C.z, 1).applyMatrix4(VP);
  // clip against the near plane (w > near) by splitting; simple: drop triangles with any vertex behind it, unless all in front
  const P = [ca.clone(), cb.clone(), cc.clone()];
  const poly = clipNear(P); if (poly.length < 3) return;
  const S2 = poly.map(v => [(v.x / v.w * 0.5 + 0.5) * W, (1 - (v.y / v.w * 0.5 + 0.5)) * H, v.z / v.w]);
  for (let k = 1; k < S2.length - 1; k++) raster(S2[0], S2[k], S2[k + 1], r, g, bl, alpha);
  tris++;
}
function clipNear(P) {
  const out = [], inside = v => v.w > 0.1;
  for (let i = 0; i < P.length; i++) {
    const p = P[i], q = P[(i + 1) % P.length];
    if (inside(p)) out.push(p);
    if (inside(p) !== inside(q)) { const t = (0.1 - p.w) / (q.w - p.w); out.push(p.clone().lerp(q, t)); }
  }
  return out;
}
function raster(p0, p1, p2, r, g, bl, alpha) {
  const minX = Math.max(0, Math.floor(Math.min(p0[0], p1[0], p2[0]))), maxX = Math.min(W - 1, Math.ceil(Math.max(p0[0], p1[0], p2[0])));
  const minY = Math.max(0, Math.floor(Math.min(p0[1], p1[1], p2[1]))), maxY = Math.min(H - 1, Math.ceil(Math.max(p0[1], p1[1], p2[1])));
  if (minX > maxX || minY > maxY) return;
  const area = (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p2[0] - p0[0]) * (p1[1] - p0[1]); if (Math.abs(area) < 1e-9) return;
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
    const px = x + 0.5, py = y + 0.5;
    const w0 = ((p1[0] - px) * (p2[1] - py) - (p2[0] - px) * (p1[1] - py)) / area;
    const w1 = ((p2[0] - px) * (p0[1] - py) - (p0[0] - px) * (p2[1] - py)) / area;
    const w2 = 1 - w0 - w1;
    if (w0 < 0 || w1 < 0 || w2 < 0) continue;
    const z = w0 * p0[2] + w1 * p1[2] + w2 * p2[2], i = y * W + x;
    if (z >= zb[i]) continue;
    const o = i * 3;
    if (alpha < 1) { col[o] = col[o] * (1 - alpha) + r * alpha; col[o + 1] = col[o + 1] * (1 - alpha) + g * alpha; col[o + 2] = col[o + 2] * (1 - alpha) + bl * alpha; continue; }
    zb[i] = z; col[o] = r; col[o + 1] = g; col[o + 2] = bl;
  }
}
const frustum = new THREE.Frustum().setFromProjectionMatrix(VP);
const sph = new THREE.Sphere(), tmpC = new THREE.Color(), M = new THREE.Matrix4(), IM = new THREE.Matrix4();
const glass = [];
function drawMesh(o, mat4, matCol) {
  const g = o.geometry, pos = g.attributes.position, cl = g.attributes.color, idx = g.index;
  const m = Array.isArray(o.material) ? o.material[0] : o.material;
  if (!m || m.visible === false) return;
  const base = (m.color || new THREE.Color(1, 1, 1)).clone();
  if (matCol) base.multiply(matCol);
  if (m.map && m.map.image && m.map.image.width === 256 && m.toneMapped === false) base.setRGB(0.05, 0.06, 0.08);   // the wheel's display
  else if (m.map) base.multiplyScalar(0.3);                      // a texture this can't read: a mid tone instead of white
  const alpha = m.transparent ? (m.opacity == null ? 1 : m.opacity) : 1;
  if (alpha < 0.05) return;
  cullThis = m.side === THREE.FrontSide;
  const N = idx ? idx.count : pos.count;
  for (let t = 0; t < N; t += 3) {
    const i0 = idx ? idx.getX(t) : t, i1 = idx ? idx.getX(t + 1) : t + 1, i2 = idx ? idx.getX(t + 2) : t + 2;
    a.fromBufferAttribute(pos, i0).applyMatrix4(mat4); b.fromBufferAttribute(pos, i1).applyMatrix4(mat4); c.fromBufferAttribute(pos, i2).applyMatrix4(mat4);
    const rgb = tmpC.copy(base);
    if (m.vertexColors && cl) rgb.multiply(new THREE.Color(cl.getX(i0), cl.getY(i0), cl.getZ(i0)));
    if (m.emissive && !(m.vertexColors && cl)) rgb.add(m.emissive.clone().multiplyScalar(m.emissiveIntensity || 1));
    if (alpha < 1) glass.push([a.clone(), b.clone(), c.clone(), rgb.clone(), alpha]); else drawTri(a, b, c, rgb, 1);
  }
}
G3.scene.updateMatrixWorld(true);
const pl = G3.cars.find(e => e.c === car).g;
const mine = new Set(); pl.traverse(o => mine.add(o));
// CARONLY=1: draw nothing but the player's car, on magenta, so any hole in it shows as magenta
if (process.env.CARONLY) { for (let q = 0; q < col.length; q += 3) { col[q] = 1; col[q + 1] = 0; col[q + 2] = 1; } }
G3.scene.traverse(o => {
  if (process.env.CARONLY) return;
  if (!(o.isMesh) || !o.visible || mine.has(o)) return;
  let p = o; while (p) { if (!p.visible) return; p = p.parent; }
  const g = o.geometry; if (!g || !g.attributes.position) return;
  if (!g.boundingSphere) g.computeBoundingSphere();
  if (o.isInstancedMesh) {
    for (let k = 0; k < o.count; k++) {
      o.getMatrixAt(k, IM); M.multiplyMatrices(o.matrixWorld, IM);
      sph.copy(g.boundingSphere).applyMatrix4(M);
      if (sph.center.distanceTo(camPos) - sph.radius > 450 || !frustum.intersectsSphere(sph)) continue;
      let ic = null; if (o.instanceColor) { ic = new THREE.Color(); o.getColorAt(k, ic); }
      drawMesh(o, M, ic);
    }
    return;
  }
  sph.copy(g.boundingSphere).applyMatrix4(o.matrixWorld);
  if (sph.center.distanceTo(camPos) - sph.radius > 900 || !frustum.intersectsSphere(sph)) return;
  drawMesh(o, o.matrixWorld);
});
// the player's car last, over everything (its own z-buffer pass works the same)
pl.updateMatrixWorld(true);
pl.traverse(o => { if (!o.isMesh) return; let p = o; while (p) { if (!p.visible) return; p = p.parent; } drawMesh(o, o.matrixWorld); });
for (const [A2, B2, C2, rgb, al] of glass) drawTri(A2, B2, C2, rgb, al);

/* ---- PNG, with a filmic-ish curve and sRGB ---- */
const raw = Buffer.alloc((W * 3 + 1) * H);
const tone = v => { v = v * 0.6 * 1.0; v = (v * (2.51 * v + 0.03)) / (v * (2.43 * v + 0.59) + 0.14) / 0.6 * 0.6; v = Math.min(1, Math.max(0, v * 1.4)); return Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055)); };
for (let y = 0; y < H; y++) { raw[y * (W * 3 + 1)] = 0; for (let x = 0; x < W; x++) { const o = (y * W + x) * 3, q = y * (W * 3 + 1) + 1 + x * 3; raw[q] = tone(col[o]); raw[q + 1] = tone(col[o + 1]); raw[q + 2] = tone(col[o + 2]); } }
const crcT = new Int32Array(256).map((_, nn) => { let cc2 = nn; for (let k = 0; k < 8; k++) cc2 = cc2 & 1 ? 0xEDB88320 ^ (cc2 >>> 1) : cc2 >>> 1; return cc2; });
const crc = buf => { let cc2 = -1; for (const by of buf) cc2 = crcT[(cc2 ^ by) & 255] ^ (cc2 >>> 8); return (cc2 ^ -1) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const cr = Buffer.alloc(4); cr.writeUInt32BE(crc(td)); return Buffer.concat([len, td, cr]); };
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = ihdr[11] = ihdr[12] = 0;
fs.writeFileSync(out, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
console.log('wrote', out, W + 'x' + H, '| triangles drawn', tris, '| fov', cam.fov.toFixed(1));
process.exit(0);
