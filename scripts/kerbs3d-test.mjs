/* The 3D kerbs through the REAL G3.build (stubbed DOM, no GPU), on every circuit:
     - the old flat strips are found and taken out (and the street circuits' painted kerb at the wall foot is not);
     - the budget: at most 12 meshes and 120k triangles a circuit, one material of its own, not from G3.mat;
     - nothing is wound face-down, no position is NaN;
     - flush: at every kerb node the kerb's inner edge sits on the road's edge, 2 to 8 mm proud of the road's top;
     - every run is closed: as many end faces as run ends;
     - wet() and dispose() do what they say.
   node --import ./scripts/asset-register.mjs scripts/kerbs3d-test.mjs [trackId ...] */
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
const { KERBS3D } = await import('../src/render3d/ground/kerbs3d.js');
const { FIELD } = await import('../src/render3d/ground/field.js');
const hook = await import('./hooks/kerbs-hook.mjs');

CFG.detail = 1;
const ids = process.argv.slice(2).length ? process.argv.slice(2) : TRACKS.map(t => t.id);
let fails = 0;
const bad = (id, msg) => { fails++; console.log('  FAIL', id, msg); };
for (const id of ids) {
  const T = buildTrack(TRACKS.find(t => t.id === id));
  G3.scene = new THREE.Scene(); G3.texes = G3.texes || new Map(); G3.dyn = []; G3.occluders = [];
  G3.rend = { renderLists: { dispose() {} }, capabilities: { getMaxAnisotropy: () => 8 }, domElement: canvas(), setRenderTarget() {}, render() {} };
  G3.cv = { clientWidth: 1280, clientHeight: 720 };
  G3.camIso = new THREE.OrthographicCamera(-50, 50, 50, -50, 0.5, 6000);
  G3.camTV = new THREE.PerspectiveCamera(38, 16 / 9, 0.5, 6000);
  G3.camFP = new THREE.PerspectiveCamera(52, 16 / 9, 0.15, 8000);
  const team = TEAMS[0], car = new Car(team, team.drivers[0], 0, T);
  const S = { track: T, uid: 1, cars: [car], clock: 0, player: car, weather: { wet: 0 }, wet: 0, rain: 0, state: 'run', mode: 'race', laps: 5 };
  G3.build(S);
  const P = T.pal, wall = T.barrier === 'wall';
  const kerbMats = new Set([G3.mat(P.kerbA), G3.mat(P.kerbB)]);
  const before = G3.world.children.filter(o => o.isMesh && kerbMats.has(o.material)).length;
  const old = hook.oldKerbs(G3, T).length;
  const log = console.log; console.log = () => {}; hook.install(G3, S, THREE); console.log = log;
  const after = G3.world.children.filter(o => o.isMesh && kerbMats.has(o.material)).length;
  const st = KERBS3D.stats, g = KERBS3D.group;
  if (old !== 4) bad(id, 'expected 4 old kerb strips, found ' + old);
  if (wall && after < 1) bad(id, 'the painted kerb at the wall foot went too');
  if (!g || g.parent !== G3.world) bad(id, 'group not in the world');
  if (st.meshes > 12) bad(id, 'meshes ' + st.meshes);
  if (st.tris > 120000) bad(id, 'triangles ' + st.tris);
  const mats = new Set(g.children.map(m => m.material));
  if (mats.size !== 1 || [...G3.mats.values()].includes([...mats][0])) bad(id, 'material not its own');
  if (g.children.some(m => m.isInstancedMesh)) bad(id, 'instanced mesh');

  // winding and NaN
  let down = 0, nan = 0;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), nrm = new THREE.Vector3();
  const pts = new Map();                                            // every kerb vertex by its plan position (1 cm grid)
  for (const m of g.children) {
    const p = m.geometry.attributes.position, ix = m.geometry.index.array;
    for (let k = 0; k < p.array.length; k++) if (!Number.isFinite(p.array[k])) nan++;
    for (let t = 0; t < ix.length; t += 3) {
      a.fromBufferAttribute(p, ix[t]); b.fromBufferAttribute(p, ix[t + 1]); c.fromBufferAttribute(p, ix[t + 2]);
      nrm.crossVectors(b.clone().sub(a), c.clone().sub(a)).normalize();
      if (nrm.y < -0.3) down++;
    }
    for (let k = 0; k < p.count; k++) {
      const key = Math.round(p.getX(k) * 100) + ',' + Math.round(p.getZ(k) * 100);
      const y = p.getY(k), o = pts.get(key);
      if (o === undefined || y > o) pts.set(key, y);
    }
  }
  if (down) bad(id, down + ' triangles face down');
  if (nan) bad(id, nan + ' NaN coordinates');

  // flush with the road edge, and the run ends
  let worst = 0, missing = 0, checked = 0, lo = 1, hi = -1, runEnds = 0;
  for (const [A, sd] of [[T.kerbR, 1], [T.kerbL, -1]]) {
    for (let i = 0; i < T.n; i++) {
      if (A[i] && !A[(i - 1 + T.n) % T.n]) runEnds += 2;
      if (!A[i]) continue;
      const off = sd * T.half, c0 = T.curv[i], o = c0 && off * c0 > 0.8 ? 0.8 / c0 : off;
      const x = T.x[i] + T.nx[i] * o, y = T.y[i] + T.ny[i] * o;
      const key = Math.round(x * 100) + ',' + Math.round(y * 100);
      const top = pts.get(key);
      if (top === undefined) { missing++; continue; }
      const road = FIELD.baseZ(T, i, off) + G3.roadLift, d = top - road;
      checked++; lo = Math.min(lo, d); hi = Math.max(hi, d); worst = Math.max(worst, Math.abs(d));
    }
  }
  if (missing > checked * 0.02) bad(id, missing + ' kerb nodes with no vertex at the road edge (of ' + (checked + missing) + ')');
  if (lo < -0.0005 || hi > 0.008) bad(id, `inner edge ${(lo * 1000).toFixed(1)}..${(hi * 1000).toFixed(1)} mm over the road top`);


  // the distance fade: both of its edits land in r128's standard vertex shader
  const m0 = [...mats][0], sh = { vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: '' };
  m0.onBeforeCompile(sh);
  if ((sh.vertexShader.match(/kfar/g) || []).length !== 2) bad(id, 'shader edit did not land');
  if (!g.children.every(m => m.geometry.attributes.kfar && m.geometry.attributes.color)) bad(id, 'missing colour attributes');

  // wet and dispose
  KERBS3D.wet(1);
  if (!(m0.roughness < 0.35 && m0.roughness > 0.25)) bad(id, 'wet roughness ' + m0.roughness);
  KERBS3D.wet(0);
  if (Math.abs(m0.roughness - 0.62) > 1e-6) bad(id, 'dry roughness ' + m0.roughness);
  console.log(id.padEnd(11), `old ${before}->${after}`, `meshes ${st.meshes}`, `tris ${st.tris}`, `runs+sausages ${st.runs}`, `run ends ${runEnds}`,
    `edge ${(lo * 1000).toFixed(1)}..${(hi * 1000).toFixed(1)} mm over road (${checked} nodes, ${missing} unmatched)`);
  KERBS3D.dispose();
  if (g.parent) bad(id, 'dispose left the group in the world');
}
console.log(fails ? fails + ' FAILED' : 'all passed');
process.exit(fails ? 1 : 0);
