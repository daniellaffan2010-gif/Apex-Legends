/* A picture of the cockpit view without a browser: the real G3.build and G3.frame (stubbed DOM, no GPU), then a small
   software rasteriser (z-buffer, flat Lambert shading from the sun, linear fog, sRGB out) over the player's car and the
   world's meshes near the camera, written as a PNG.
   This copy of cockpit-render.mjs also SAMPLES the ground materials' DataTextures (materials with
   userData.gmat, from src/render3d/ground/materials.js) at each pixel's world UV, so the asphalt, gravel and
   grass can actually be seen. Use it with HOOKS=scripts/hooks/materials-hook.mjs.
   HOOKS=scripts/hooks/materials-hook.mjs node --import ./scripts/asset-register.mjs scripts/materials-render.mjs <track> <node> <out.png> [steer -1..1] [width]
   CAM=front|rear stands outside the car; CAM=high looks down from 12 m behind and above; WET=0..1 sets the wetness. */
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
const i0 = +nodeArg % T.n;
car.place(i0, T.line[i0]); car.vx = Math.cos(car.h) * 70; car.vy = Math.sin(car.h) * 70; car.ai = false; car.steer = +steerArg; car.pos = 7; car.lap = 2; car.lapStart = 0;
// CAM=iso: the game's own overhead orthographic camera, as G3.frame places it
const ISO = process.env.CAM === 'iso';
G3.view = ISO ? 'iso' : 'cockpit';
// WET: the weather eases towards it at 0.8 a second, so give it time to get there
if (process.env.WET) { S.wet = +process.env.WET; S.weather.wet = S.wet; }
const FR = process.env.WET ? 420 : 40;
for (let k = 0; k < FR; k++) { S.clock += 1 / 60; G3.frame(S); for (const m of HOOKS) if (m.frame) m.frame(G3, S, THREE); }
const cam = ISO ? G3.camIso : G3.camFP;
if (ISO) { delete process.env.CAM; console.log('iso camera', cam.isOrthographicCamera, 'span', (cam.right - cam.left).toFixed(0), 'x', (cam.top - cam.bottom).toFixed(0), 'zoom', cam.zoom); }
if (process.env.WET) console.log('wetVis', (G3.wetVis || 0).toFixed(2), 'road colour', G3.roadMat.color.toArray().map(v => v.toFixed(3)).join(','), 'rough', G3.roadMat.roughness.toFixed(2));
/* CAM=high: 12 m behind and 7 m up, looking 25 m ahead, to see the surfaces side by side */
if (process.env.CAM === 'high') {
  const ch = Math.cos(car.h), sh = Math.sin(car.h), z0 = T.z[i0], side = +(process.env.SIDE || 0);
  // game (x, y, z-up) -> three (x, z, y); SIDE=metres moves the eye to the left (+) or right (-) of the car
  cam.position.set(car.x - ch * 12 - sh * side, z0 + 7, car.y - sh * 12 + ch * side); cam.fov = 60;
  cam.lookAt(car.x + ch * 25 - sh * side * 0.5, z0, car.y + sh * 25 + ch * side * 0.5);
  delete process.env.CAM;
}
/* CAM=front|rear: stand outside, low, at the front-left or rear-left corner, looking at the suspension instead */
if (process.env.CAM) {
  const g0 = G3.cars.find(e => e.c === car).g; g0.updateMatrixWorld(true);
  const rear = process.env.CAM === 'rear', at = new THREE.Vector3(rear ? -1.4 : 1.4, 0.35, 0).applyMatrix4(g0.matrixWorld);
  cam.position.copy(new THREE.Vector3(rear ? -3.4 : 3.4, 1.1, -2.2).applyMatrix4(g0.matrixWorld)); cam.fov = 40; cam.lookAt(at);
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
function drawTri(A, B, C, rgb, alpha) {
  e1.subVectors(B, A); e2.subVectors(C, A); n.crossVectors(e1, e2); const L = n.length(); if (L < 1e-12) return; n.divideScalar(L);
  const mid = A.clone().add(B).add(C).divideScalar(3), toCam = camPos.clone().sub(mid);
  if (n.dot(toCam) < 0) n.negate();                              // two-sided, lit on the side we see
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
    zb[i] = z; col[o] = r; col[o + 1] = g; col[o + 2] = bl; if (PROBE && x === PROBE[0] && y === PROBE[1]) PROBE[2] = CUR;
  }
}
/* ---- textured triangles, for the ground's own materials (GMAT, userData.gmat) ----
   Perspective-correct UVs per pixel, a mip level from the UV footprint (with 8x anisotropy, roughly the
   way a GPU picks it), trilinear sampling, and the same arithmetic as the material's shader patch:
   albedo x colour x vertex colour, the macro field and its dust, the stripes across, and the normal map
   bending the Lambert term. */
/* PROBE=x,y (fractions of the frame): print which mesh ended up on top at that pixel */
let CUR = null;
const PROBE = process.env.PROBE ? [...process.env.PROBE.split(',').map((v, k) => Math.round(+v * (k ? H : W))), null] : null;
const MIPS = new Map();
function mips(t) {
  let L = MIPS.get(t); if (L) return L;
  const N = t.image.width, d = t.image.data; L = [];
  let cur = new Float32Array(N * N * 4); for (let i = 0; i < cur.length; i++) cur[i] = d[i] / 255;
  let n = N; L.push({ n, a: cur });
  while (n > 1) {
    const m = n >> 1, nx = new Float32Array(m * m * 4);
    for (let y = 0; y < m; y++) for (let x = 0; x < m; x++) for (let c = 0; c < 4; c++)
      nx[(y * m + x) * 4 + c] = (cur[((2 * y) * n + 2 * x) * 4 + c] + cur[((2 * y) * n + 2 * x + 1) * 4 + c] + cur[((2 * y + 1) * n + 2 * x) * 4 + c] + cur[((2 * y + 1) * n + 2 * x + 1) * 4 + c]) / 4;
    L.push({ n: m, a: nx }); cur = nx; n = m;
  }
  MIPS.set(t, L); return L;
}
const SMP = [0, 0, 0, 0];
function bil(lv, u, v, out, w) {
  const n = lv.n, a = lv.a, x = u * n - 0.5, y = v * n - 0.5, x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const X0 = ((x0 % n) + n) % n, X1 = (X0 + 1) % n, Y0 = ((y0 % n) + n) % n, Y1 = (Y0 + 1) % n;
  for (let c = 0; c < 4; c++) {
    const p = a[(Y0 * n + X0) * 4 + c] * (1 - fx) + a[(Y0 * n + X1) * 4 + c] * fx, q = a[(Y1 * n + X0) * 4 + c] * (1 - fx) + a[(Y1 * n + X1) * 4 + c] * fx;
    out[c] += (p * (1 - fy) + q * fy) * w;
  }
}
/* (xu, xv), (yu, yv): how far the UV (in tiles) moves per pixel across and down the screen. Anisotropic the
   way a GPU does it: up to 8 trilinear taps spread along the long axis of the footprint, at the mip level of
   the long axis over the tap count */
function sample(t, u, v, xu, xv, yu, yv, out) {
  const L = mips(t), N = L[0].n;
  const lx = Math.hypot(xu, xv) * N, ly = Math.hypot(yu, yv) * N;
  const pmax = Math.max(lx, ly), pmin = Math.max(1e-6, Math.min(lx, ly));
  const taps = Math.max(1, Math.min(8, Math.ceil(pmax / pmin)));
  const lod = Math.max(0, Math.min(L.length - 1, Math.log2(Math.max(pmax / taps, 1e-6))));
  const l0 = Math.floor(lod), f = lod - l0, l1 = Math.min(L.length - 1, l0 + 1);
  const au = lx > ly ? xu : yu, av = lx > ly ? xv : yv;
  out[0] = out[1] = out[2] = out[3] = 0;
  for (let k = 0; k < taps; k++) {
    const s = taps === 1 ? 0 : (k + 0.5) / taps - 0.5, su = u + au * s, sv = v + av * s;
    bil(L[l0], su, sv, out, (1 - f) / taps); if (f > 0) bil(L[l1], su, sv, out, f / taps);
  }
  return out;
}
const s2l = v => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
const sm = (a, b, x) => { x = Math.min(1, Math.max(0, (x - a) / (b - a))); return x * x * (3 - 2 * x); };
const TA = [0, 0, 0, 0], TN = [0, 0, 0, 0], TM = [0, 0, 0, 0];
let texPx = 0;
function drawMeshTex(o, mat4, m) {
  const o0 = o;
  const g = o.geometry, pos = g.attributes.position, uvA = g.attributes.uv, uv2A = g.attributes.uv2, cl = g.attributes.color, idx = g.index;
  if (!uvA) return;
  const U = m.userData.gmat.U, scale = U.gScale.value, mk = U.gMacroK.value, macro = U.gMacro.value, dust = U.gDust.value, stripe = U.gStripe.value, rk = U.gRoughK.value;
  const base = m.color, ns = m.normalScale ? m.normalScale.x : 1, useVC = m.vertexColors && cl;
  const N = idx ? idx.count : pos.count;
  const vs = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  for (let t = 0; t < N; t += 3) {
    const ii = [idx ? idx.getX(t) : t, idx ? idx.getX(t + 1) : t + 1, idx ? idx.getX(t + 2) : t + 2];
    for (let k = 0; k < 3; k++) vs[k].fromBufferAttribute(pos, ii[k]).applyMatrix4(mat4);
    e1.subVectors(vs[1], vs[0]); e2.subVectors(vs[2], vs[0]); n.crossVectors(e1, e2); const L = n.length(); if (L < 1e-12) continue; n.divideScalar(L);
    const mid = vs[0].clone().add(vs[1]).add(vs[2]).divideScalar(3), toCam = camPos.clone().sub(mid);
    if (n.dot(toCam) < 0) n.negate();
    const dist = toCam.length(); if (dist > 900) continue;
    let fogF = 0; if (fog) fogF = Math.min(1, Math.max(0, (dist - fog.near) / (fog.far - fog.near)));
    // tangent frame for world-metre UVs: u along three +x, v along three +z, projected into the face
    const Tg = new THREE.Vector3(1, 0, 0).addScaledVector(n, -n.x).normalize(), Bg = new THREE.Vector3(0, 0, 1).addScaledVector(n, -n.z).normalize();
    const P = ii.map((vi, k) => {
      const c4 = new THREE.Vector4(vs[k].x, vs[k].y, vs[k].z, 1).applyMatrix4(VP);
      const at = [uvA.getX(vi), uvA.getY(vi), uv2A ? uv2A.getX(vi) : 0, useVC ? cl.getX(vi) : 1, useVC ? cl.getY(vi) : 1, useVC ? cl.getZ(vi) : 1];
      return { c: c4, at };
    });
    // clip at the near plane, carrying the attributes
    const poly = [], inside = v => v.c.w > 0.1;
    for (let i = 0; i < 3; i++) {
      const p = P[i], q = P[(i + 1) % 3];
      if (inside(p)) poly.push(p);
      if (inside(p) !== inside(q)) { const s = (0.1 - p.c.w) / (q.c.w - p.c.w); poly.push({ c: p.c.clone().lerp(q.c, s), at: p.at.map((v, j) => v + (q.at[j] - v) * s) }); }
    }
    if (poly.length < 3) continue;
    const S2 = poly.map(v => ({ x: (v.c.x / v.c.w * 0.5 + 0.5) * W, y: (1 - (v.c.y / v.c.w * 0.5 + 0.5)) * H, z: v.c.z / v.c.w, iw: 1 / v.c.w, at: v.at }));
    for (let k = 1; k < S2.length - 1; k++) rasterTex(S2[0], S2[k], S2[k + 1]);
    tris++;
    function rasterTex(p0, p1, p2) {
      const minX = Math.max(0, Math.floor(Math.min(p0.x, p1.x, p2.x))), maxX = Math.min(W - 1, Math.ceil(Math.max(p0.x, p1.x, p2.x)));
      const minY = Math.max(0, Math.floor(Math.min(p0.y, p1.y, p2.y))), maxY = Math.min(H - 1, Math.ceil(Math.max(p0.y, p1.y, p2.y)));
      if (minX > maxX || minY > maxY) return;
      const area = (p1.x - p0.x) * (p2.y - p0.y) - (p2.x - p0.x) * (p1.y - p0.y); if (Math.abs(area) < 1e-9) return;
      const bary = (px, py) => {
        const w0 = ((p1.x - px) * (p2.y - py) - (p2.x - px) * (p1.y - py)) / area, w1 = ((p2.x - px) * (p0.y - py) - (p0.x - px) * (p2.y - py)) / area;
        return [w0, w1, 1 - w0 - w1];
      };
      const attr = (w, j) => { const a = w[0] * p0.iw, b = w[1] * p1.iw, c = w[2] * p2.iw, s = a + b + c; return (a * p0.at[j] + b * p1.at[j] + c * p2.at[j]) / s; };
      for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5, py = y + 0.5, w = bary(px, py);
        if (w[0] < 0 || w[1] < 0 || w[2] < 0) continue;
        const z = w[0] * p0.z + w[1] * p1.z + w[2] * p2.z, i = y * W + x;
        if (z >= zb[i]) continue;
        const u = attr(w, 0), v = attr(w, 1), wx = bary(px + 1, py), wy = bary(px, py + 1);
        const dux = attr(wx, 0) - u, dvx = attr(wx, 1) - v, duy = attr(wy, 0) - u, dvy = attr(wy, 1) - v;
        const fx = Math.hypot(dux, dvx) * scale;
        const gu = u * scale, gv = v * scale, sx = dux * scale, sxv = dvx * scale, sy = duy * scale, syv = dvy * scale;
        let r = base.r, gg = base.g, b = base.b, rough = 1;
        if (m.map) { sample(m.map, gu, gv, sx, sxv, sy, syv, TA); r *= s2l(TA[0]); gg *= s2l(TA[1]); b *= s2l(TA[2]); rough = 1 + (TA[3] - 1) * rk; }
        // the macro field: rotated 37 degrees, ~20x larger
        const mu = (0.7986 * u - 0.6018 * v) * mk, mv = (0.6018 * u + 0.7986 * v) * mk;
        sample(m.normalMap, mu, mv, dux * mk, dvx * mk, duy * mk, dvy * mk, TM);
        const gM = TM[3], kM = 1 + macro.x * (gM - 0.5) * 2;
        r *= kM; gg *= kM; b *= kM;
        const dk = macro.y * sm(0.42, 0.85, gM);
        r += (dust.r - r) * dk; gg += (dust.g - gg) * dk; b += (dust.b - b) * dk;
        if (stripe.x && uv2A) { const ac = attr(w, 2), f = ac / stripe.y - Math.floor(ac / stripe.y); const ks = 1 + stripe.x * (sm(0.42, 0.58, Math.abs(f - 0.5) * 2) * 2 - 1); r *= ks; gg *= ks; b *= ks; }
        if (useVC) { r *= attr(w, 3); gg *= attr(w, 4); b *= attr(w, 5); }
        sample(m.normalMap, gu, gv, sx, sxv, sy, syv, TN);
        const mx = (TN[0] * 2 - 1) * ns, my = (TN[1] * 2 - 1) * ns, mz = TN[2] * 2 - 1;
        const nxp = Tg.x * mx + Bg.x * my + n.x * mz, nyp = Tg.y * mx + Bg.y * my + n.y * mz, nzp = Tg.z * mx + Bg.z * my + n.z * mz;
        const nl = Math.hypot(nxp, nyp, nzp) || 1;
        const lam = 0.42 + 0.75 * Math.max(0, (nxp * sunDir.x + nyp * sunDir.y + nzp * sunDir.z) / nl);
        // a hint of the sheen a smooth stone top or wet road gives, so roughness shows at all
        const spec = Math.max(0, 1 - (m.roughness * rough)) * 0.06;
        if (process.env.DBG && x === W >> 1 && y === Math.round(H * +process.env.DBG)) console.log('px', x, y, m.userData.gmat.kind, 'base', base.toArray().map(v => v.toFixed(3)), 'tex', TA.map(v => v.toFixed(3)), 'rgb', [r, gg, b].map(v => v.toFixed(3)), 'lam', lam.toFixed(2), 'n', [nxp, nyp, nzp].map(v => (v / nl).toFixed(2)), 'vc', useVC ? [attr(w, 3), attr(w, 4)].map(v => v.toFixed(2)) : '-', 'uv', u.toFixed(1), v.toFixed(1), 'fx', fx.toFixed(4));
        zb[i] = z; const o = i * 3; if (PROBE && x === PROBE[0] && y === PROBE[1]) PROBE[2] = o0;
        col[o] = (r * lam + spec) * (1 - fogF) + fogC.r * fogF; col[o + 1] = (gg * lam + spec) * (1 - fogF) + fogC.g * fogF; col[o + 2] = (b * lam + spec) * (1 - fogF) + fogC.b * fogF;
        texPx++;
      }
    }
  }
}
const frustum = new THREE.Frustum().setFromProjectionMatrix(VP);
const sph = new THREE.Sphere(), tmpC = new THREE.Color(), M = new THREE.Matrix4(), IM = new THREE.Matrix4();
const glass = [];
function drawMesh(o, mat4, matCol) {
  CUR = o;
  const g = o.geometry, pos = g.attributes.position, cl = g.attributes.color, idx = g.index;
  const m = Array.isArray(o.material) ? o.material[0] : o.material;
  if (!m || m.visible === false) return;
  if (m.isShaderMaterial) return;                                 // a sky, haze or water shader this cannot run: leave it out rather than paint it white
  if (m.userData && m.userData.gmat && !o.isInstancedMesh) return drawMeshTex(o, mat4, m);
  const base = (m.color || new THREE.Color(1, 1, 1)).clone();
  if (matCol) base.multiply(matCol);
  if (m.map && m.map.image && m.map.image.width === 256 && m.toneMapped === false) base.setRGB(0.05, 0.06, 0.08);   // the wheel's display
  else if (m.map) base.multiplyScalar(0.3);                      // a texture this can't read: a mid tone instead of white
  const alpha = m.transparent ? (m.opacity == null ? 1 : m.opacity) : 1;
  if (alpha < 0.05) return;
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
G3.scene.traverse(o => {
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
if (PROBE) { const p = PROBE[2]; console.log('probe', PROBE[0], PROBE[1], p ? [p.name, p.type, p.material.type, p.material.color ? p.material.color.getHexString() : '-', 'map', !!p.material.map, 'gmat', !!(p.material.userData && p.material.userData.gmat), 'parent', p.parent && p.parent.name, 'tris', (p.geometry.index ? p.geometry.index.count : p.geometry.attributes.position.count) / 3, 'y', p.geometry.boundingSphere && p.geometry.boundingSphere.center.y.toFixed(2)].join(' ') : 'background'); }
console.log('wrote', out, W + 'x' + H, '| triangles drawn', tris, '| textured pixels', texPx, '| fov', (cam.fov || 0).toFixed(1));
process.exit(0);
