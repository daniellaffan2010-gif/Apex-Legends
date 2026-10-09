/* The grass, checked without a browser: drive a camera round each lap at racing
   speed and measure what GRASS.frame costs and draws, then check every tuft it put
   down against FIELD: on grass or astro only, rooted at FIELD's height, never past
   ro + VERGE, never on another part of the lap.
   node --import ./scripts/asset-register.mjs scripts/grass-test.mjs [track ...] */
globalThis.window = globalThis;
const THREE = await import('three');
const { TRACKS } = await import('../src/tracks/index.js');
const { buildTrack } = await import('../src/tracks/build.js');
const { GRASS } = await import('../src/render3d/ground/grass.js');
const { FIELD, VERGE } = await import('../src/render3d/ground/field.js');

/* (f, off) on the segment k -> k+1 whose chord point is (x, y): Newton on the two
   unknowns, from the nearest node's own projection */
function chord(T, k, x, y, off0) {
  const j = (k + 1) % T.n;
  let f = ((x - T.x[k]) * T.tx[k] + (y - T.y[k]) * T.ty[k]) / T.ds, o = off0;
  for (let it = 0; it < 12; it++) {
    const px = (T.x[k] + T.nx[k] * o) * (1 - f) + (T.x[j] + T.nx[j] * o) * f, py = (T.y[k] + T.ny[k] * o) * (1 - f) + (T.y[j] + T.ny[j] * o) * f;
    const ex = px - x, ey = py - y;
    if (ex * ex + ey * ey < 1e-10) break;
    const dfx = (T.x[j] + T.nx[j] * o) - (T.x[k] + T.nx[k] * o), dfy = (T.y[j] + T.ny[j] * o) - (T.y[k] + T.ny[k] * o);
    const dox = T.nx[k] * (1 - f) + T.nx[j] * f, doy = T.ny[k] * (1 - f) + T.ny[j] * f;
    const det = dfx * doy - dfy * dox; if (Math.abs(det) < 1e-9) return null;
    f -= (ex * doy - ey * dox) / det; o -= (dfx * ey - dfy * ex) / det;
  }
  return { k, f, off: o };
}
// which chunk put a tuft at p: node, side, band and its own offset there
function who(p) {
  for (const [key, ch] of GRASS.chunks) for (let k = 0; k < ch.n; k++) {
    const o = k * 10;
    if (Math.abs(ch.d[o + 3] - p.x) < 1e-3 && Math.abs(ch.d[o + 5] - p.z) < 1e-3) {
      const i = Math.floor(key / 16), s = Math.floor(key / 8) % 2, T = GRASS.T;
      const off = (p.x - T.x[i]) * T.nx[i] + (p.z - T.y[i]) * T.ny[i];
      return `node ${i} side ${s} band ${key % 8} (off there ${off.toFixed(2)}, ro ${(s ? T.roR[i] : T.roL[i]).toFixed(1)}/${(s ? T.roR[(i + 1) % T.n] : T.roL[(i + 1) % T.n]).toFixed(1)})`;
    }
  }
  return '?';
}
const ids = process.argv.slice(2).length ? process.argv.slice(2) : TRACKS.map(t => t.id);
let fails = 0;
for (const id of ids) {
  const def = TRACKS.find(t => t.id === id); if (!def) { console.log('no track', id); continue; }
  const T = buildTrack(def);
  const G = { world: new THREE.Group(), col: c => new THREE.Color(c).convertSRGBToLinear() };
  const S = { track: T, clock: 0 };
  const tb = performance.now();
  GRASS.build(G, S);
  const buildMs = performance.now() - tb;
  if (!GRASS.mesh) { console.log(id.padEnd(12), 'no grass (street circuit)', 'build', buildMs.toFixed(1), 'ms'); continue; }
  const m = GRASS.mesh;
  if (G.world.children.filter(o => o.isMesh).length !== 1) { console.log('  FAIL more than one mesh'); fails++; }
  if (!m.instanceColor) { console.log('  FAIL no instanceColor'); fails++; }
  if (m.material === undefined || m.material.userData.shared) { console.log('  FAIL material'); fails++; }
  // the shader hooks find what they replace in r128's standard material
  {
    const sh = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
    m.material.onBeforeCompile(sh);
    const okV = sh.vertexShader.includes('attribute float aRank') && sh.vertexShader.includes('transformed *= gFade'), okF = sh.fragmentShader.includes('normal = normal * faceDirection');
    if (!okV || !okF || !sh.uniforms.uTime || m.material.customProgramCacheKey() !== 'groundGrass') { console.log('  FAIL shader hooks', okV, okF); fails++; }
  }
  // the overhead camera: nothing drawn
  GRASS.frame(G, S, { fp: false, x: T.x[0], y: T.y[0], z: T.z[0], hx: 1, hy: 0, dt: 1 / 60 });
  if (m.visible) { console.log('  FAIL visible in the overhead view'); fails++; }
  // round the lap at 80 m/s, the camera on the racing line 0.74 m up, looking along the road
  const times = [], counts = [], restT = []; let genT = 0, worstAt = '', maxCount = 0, bad = 0, checked = 0, worstZ = 0, gens = 0;
  const step = 80 / 60, lap = T.n * T.ds, frames = Math.ceil(lap / step);
  const p = new THREE.Vector3();
  for (let f = 0; f < frames; f++) {
    const s = f * step, k = Math.floor(s / T.ds) % T.n, fr = s / T.ds - Math.floor(s / T.ds), j = (k + 1) % T.n;
    const off = T.line ? T.line[k] : 0;
    const x = T.x[k] + (T.x[j] - T.x[k]) * fr + T.nx[k] * off, y = T.y[k] + (T.y[j] - T.y[k]) * fr + T.ny[k] * off;
    S.clock = f / 60;
    const g0 = GRASS.stats.gen, t0 = performance.now();
    GRASS.frame(G, S, { fp: true, x, y, z: T.z[k] + 0.74, hx: T.tx[k], hy: T.ty[k], dt: 1 / 60 });
    const dt = performance.now() - t0;
    if (f > 30) { times.push(dt); genT += GRASS.stats.genMs; restT.push(dt - GRASS.stats.genMs); }
    gens += GRASS.stats.gen - g0;
    counts.push(m.count); maxCount = Math.max(maxCount, m.count);
    // every 97th frame, check every tuft in the buffer
    if (f % 97 === 0) {
      const e = m.instanceMatrix.array;
      for (let q = 0; q < m.count; q++) {
        const o = q * 16;
        if (e[o + 15] === 0) continue;                    // a blank slot
        p.set(e[o + 12], e[o + 13], e[o + 14]);
        const L = FIELD.locate(T, p.x, p.z); checked++;
        /* The ground is laid as straight chords from node to node at each offset, so
           find the tuft's place the same way: the segment either side of the nearest
           node, and the (f, off) on it that lands on the tuft. */
        let at = null;
        for (const k of [L.i, (L.i - 1 + T.n) % T.n]) { const c = chord(T, k, p.x, p.z, L.off); if (c && c.f >= -0.01 && c.f <= 1.01) { at = c; break; } }
        if (!at) continue;
        const k1 = (at.k + 1) % T.n, off = at.off, a = Math.abs(off) - T.half;
        const ok = (k, o2) => { const f2 = FIELD.kindAt(T, k, o2); return f2 === 'grass' || f2 === 'astro' || GRASS.kind(T, k, o2) > 0; };
        // 3 cm of slack for the bisection that found the edges
        const okKind = [0, 0.03, -0.03].some(dd => ok(at.k, off + dd) && ok(k1, off + dd));
        const ro = FIELD.roAt(T, at.k, off);
        if (!okKind || a > ro + VERGE) {
          // where the lap folds back the other part's ground is checked by the generator itself
          if (!GRASS.others[at.k]) { if (bad < 5) console.log('  BAD tuft on', FIELD.kindAt(T, at.k, off), 'at node', at.k, 'f', at.f.toFixed(2), 'off', off.toFixed(2), 'a', a.toFixed(2), 'ro', ro.toFixed(2), '| made by', who(p)); bad++; }
        } else if (!GRASS.others[at.k]) {
          const z = FIELD.zAt(T, at.k, off) * (1 - at.f) + FIELD.zAt(T, k1, off) * at.f, dz = Math.abs(p.y - z);
          if (dz > worstZ) { worstZ = dz; worstAt = `node ${at.k} off ${off.toFixed(1)} tuft ${p.y.toFixed(3)} field ${z.toFixed(3)} made by ${who(p)}`; }
        }
      }
    }
  }
  times.sort((a, b) => a - b);
  const mean = times.reduce((a, b) => a + b, 0) / times.length, p95 = times[Math.floor(times.length * 0.95)], p99 = times[Math.floor(times.length * 0.99)], mx = times[times.length - 1];
  const avgCount = counts.reduce((a, b) => a + b, 0) / counts.length;
  let mem = 0; for (const ch of GRASS.chunks.values()) mem += ch.d.byteLength + ch.rank.byteLength;
  console.log(id.padEnd(12), `build ${buildMs.toFixed(0)} ms | frame mean ${mean.toFixed(3)} p95 ${p95.toFixed(3)} p99 ${p99.toFixed(3)} max ${mx.toFixed(2)} ms | tufts avg ${avgCount.toFixed(0)} max ${maxCount} (${(maxCount * 8 / 1000).toFixed(1)}k tris) | chunks gen ${gens}, kept ${GRASS.chunks.size} (${(mem / 1e6).toFixed(1)} MB) | checked ${checked} bad ${bad} worst dz ${(worstZ * 100).toFixed(2)} cm`);
  if (worstZ > 0.03) console.log('  worst dz at', worstAt);
  restT.sort((a, b) => a - b);
  console.log(' '.repeat(12), `making chunks ${(genT / times.length).toFixed(3)} ms a frame on average | the rest: mean ${(restT.reduce((a, b) => a + b, 0) / restT.length).toFixed(3)} p95 ${restT[Math.floor(restT.length * 0.95)].toFixed(3)} ms`);
  if (bad || worstZ > 0.03 || p95 > 0.4) fails++;
  GRASS.dispose();
}
console.log(fails ? `FAIL ${fails}` : 'ok');
process.exit(fails ? 1 : 0);
