/* The ground materials, checked in Node (no GPU):
   - eight textures, power-of-two RGBA, mipmapped, repeat-wrapped, sRGB on the albedos only, within 16 MB with mips;
   - a rebuild reuses the textures (same objects) and makes fresh materials; dispose(true) frees them;
   - every material is a MeshStandardMaterial, rough and non-metal enough that G3.applyEnv leaves it alone dry;
   - the shader patch finds every chunk it replaces in three's own standard shader, and what it leaves behind still
     names only things that exist once the chunks are expanded;
   - wet() darkens from the dry values and goes back to them exactly, without new objects;
   - roadColour: finite, in a sane range, darker on the racing line in a slow corner than at the road's edge.
   node --import ./scripts/asset-register.mjs scripts/materials-test.mjs [trackId] */
globalThis.window = globalThis;
const THREE = await import('three');
const { GMAT, roadColour } = await import('../src/render3d/ground/materials.js');
const { TRACKS } = await import('../src/tracks/index.js');
const { buildTrack } = await import('../src/tracks/build.js');

let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.log('FAIL', msg); } else console.log('ok  ', msg); };
const G = { rend: { capabilities: { getMaxAnisotropy: () => 16 } }, col: c => new THREE.Color(c).convertSRGBToLinear() };
const id = process.argv[2] || 'suzuka';
const T = buildTrack(TRACKS.find(t => t.id === id));
const P = T.pal;

const t0 = performance.now();
const M = GMAT.build(G, T, P);
const gen = performance.now() - t0;
const tex = [...GMAT.textures.values()];
const b = GMAT.budget();
console.log('generated in', gen.toFixed(0), 'ms;', b.textures, 'textures,', b.mb.toFixed(2), 'MB with mips');
ok(b.textures <= 8, 'at most 8 textures (' + b.textures + ')');
ok(b.bytes <= 16 * 1048576, 'within 16 MB (' + b.mb.toFixed(2) + ')');
for (const [k, t] of GMAT.textures) {
  const N = t.image.width, pot = (N & (N - 1)) === 0 && t.image.height === N;
  ok(pot && t.image.data.length === N * N * 4 && t.format === THREE.RGBAFormat, k + ' is ' + N + '^2 RGBA');
  ok(t.generateMipmaps && t.minFilter === THREE.LinearMipmapLinearFilter && t.magFilter === THREE.LinearFilter && t.wrapS === THREE.RepeatWrapping && t.wrapT === THREE.RepeatWrapping && t.anisotropy === 16, k + ' mipmapped, trilinear, repeat, anisotropy 16');
  ok((t.encoding === THREE.sRGBEncoding) === k.endsWith('.a'), k + (k.endsWith('.a') ? ' sRGB' : ' linear'));
}
// rebuild: same textures, new materials
const M2 = GMAT.build(G, T, P);
ok([...GMAT.textures.values()].every((t, i) => t === tex[i]), 'a rebuild reuses the textures');
ok(M2.road !== M.road, 'a rebuild makes fresh materials');
const t1 = performance.now(); GMAT.build(G, T, P); ok(performance.now() - t1 < 20, 'a rebuild is cheap (' + (performance.now() - t1).toFixed(1) + ' ms)');
const Mx = GMAT.mats;

for (const [k, m] of Object.entries(Mx)) {
  ok(m.isMeshStandardMaterial && m.roughness > 0.55 && m.metalness < 0.25, k + ': Standard, roughness ' + m.roughness + ', metalness ' + m.metalness + ' (no PMREM in the dry)');
  ok(!!m.normalMap, k + ': has the normal map the macro field lives in');
}
ok(Mx.road.vertexColors === true && Mx.kerb.vertexColors === true && !Mx.tarmac.vertexColors, 'vertex colours on road and kerb only');
ok(GMAT.build(G, T, P, { roadVertexColours: false }).road.vertexColors === false, 'roadVertexColours:false turns them off');
GMAT.build(G, T, P);

// the shader patch against three's real standard shader
const SL = THREE.ShaderLib.standard;
const expand = s => s.replace(/^[ \t]*#include +<([\w\d./]+)>/gm, (_, n) => expand(THREE.ShaderChunk[n] || ('MISSING_' + n)));
for (const [k, m] of Object.entries(GMAT.mats)) {
  const sh = { uniforms: THREE.UniformsUtils.clone(SL.uniforms), vertexShader: SL.vertexShader, fragmentShader: SL.fragmentShader };
  m.onBeforeCompile(sh, null);
  const fs = sh.fragmentShader, vs = sh.vertexShader;
  for (const c of ['map_fragment', 'roughnessmap_fragment', 'normal_fragment_maps']) ok(!fs.includes('#include <' + c + '>'), k + ': replaced ' + c);
  ok(fs.includes('uniform float gScale'), k + ': declares its uniforms');
  for (const u of ['gScale', 'gMacroK', 'gMacro', 'gDust', 'gStripe', 'gRoughK']) if (!sh.uniforms[u]) ok(false, k + ': uniform ' + u + ' handed over');
  const stripe = m.userData.gmat.U.gStripe.value.x > 0;
  ok(stripe === vs.includes('gAcross = uv2.x'), k + ': ' + (stripe ? 'reads uv2 for its stripes' : 'no uv2'));
  const ex = expand(fs);
  ok(!ex.includes('MISSING_'), k + ': every chunk resolves');
  // what the replacement code names must exist in the expanded shader (or three's prefix: mapTexelToLinear)
  for (const name of ['perturbNormal2Arb', 'faceDirection', 'vViewPosition', 'normalScale', 'vUv', 'diffuseColor']) ok(new RegExp('\\b' + name + '\\b').test(ex.replace(/gUv|gM\b/g, '')), k + ': ' + name + ' is there');
  ok(/float faceDirection\s*=/.test(ex), k + ': faceDirection is declared before use');
  ok(ex.indexOf('vec2 gUv') < ex.indexOf('texture2D( normalMap, gUv )'), k + ': gUv set before the normal map reads it');
  ok(typeof m.customProgramCacheKey === 'function' && m.customProgramCacheKey().startsWith('gmat|'), k + ': program cache key ' + m.customProgramCacheKey());
}

// wet and back
const dry = Object.fromEntries(Object.entries(GMAT.mats).map(([k, m]) => [k, { c: m.color.clone(), r: m.roughness, o: m.color }]));
GMAT.wet(1);
for (const k of ['tarmac', 'gravel', 'astro', 'grass', 'concrete', 'kerb']) {
  const m = GMAT.mats[k];
  ok(m.color === dry[k].o && m.color.r < dry[k].c.r && m.roughness >= 0.55 && m.roughness <= dry[k].r, k + ' wet: darker (' + (m.color.r / dry[k].c.r).toFixed(2) + 'x), roughness ' + m.roughness.toFixed(2));
}
ok(GMAT.mats.road.color.equals(dry.road.c) && GMAT.mats.road.roughness === dry.road.r, 'the road is left to weather.js');
ok(GMAT.mats.tarmac.userData.gmat.U.gMacro.value.y === 0, 'the dust is washed off');
GMAT.wet(0);
ok(Object.entries(GMAT.mats).every(([k, m]) => m.color.equals(dry[k].c) && m.roughness === dry[k].r), 'dry again: exactly the dry values');

// roadColour
let lo = 9, hi = -9, bad = 0;
for (let i = 0; i < T.n; i++) for (const f of [-1, -0.5, 0, 0.5, 1]) {
  const v = roadColour(T, i, f * T.half, i * T.ds).r;
  if (!Number.isFinite(v)) bad++; lo = Math.min(lo, v); hi = Math.max(hi, v);
}
ok(bad === 0 && lo > 0.5 && hi < 1.25, 'roadColour finite and in range: ' + lo.toFixed(2) + '..' + hi.toFixed(2));
let ic = 0; for (let i = 0; i < T.n; i++) if (Math.abs(T.curv[i]) > Math.abs(T.curv[ic])) ic = i;
const onLine = roadColour(T, ic, T.line[ic], ic * T.ds).r, atEdge = roadColour(T, ic, -Math.sign(T.line[ic] || 1) * (T.half - 0.3), ic * T.ds).r;
ok(onLine < atEdge - 0.15, 'rubbered line at the slowest corner (node ' + ic + ') ' + onLine.toFixed(2) + ' vs edge ' + atEdge.toFixed(2));
const f3 = GMAT.roadColourOf(T); ok(f3(ic, T.line[ic], ic * T.ds).r === onLine, 'roadColourOf(T) is the (i, off, s) form FIELD.ribbon calls');

GMAT.dispose(true);
ok(GMAT.textures.size === 0, 'dispose(true) frees the textures');
console.log(fails ? fails + ' FAILED' : 'all passed');
process.exit(fails ? 1 : 0);
