/* What one grass chunk costs to generate, and how many tufts it holds.
   node --import ./scripts/asset-register.mjs scripts/grass-prof.mjs <track> */
globalThis.window = globalThis;
const THREE = await import('three');
const { TRACKS } = await import('../src/tracks/index.js');
const { buildTrack } = await import('../src/tracks/build.js');
const { GRASS } = await import('../src/render3d/ground/grass.js');
const T = buildTrack(TRACKS.find(t => t.id === (process.argv[2] || 'spa')));
GRASS.build({ world: new THREE.Group() }, { track: T });
for (let i = 0; i < T.n; i++) { GRASS.runs(i, 0); GRASS.runs(i, 1); }
let tot = 0, nt = 0, worst = 0, wk = null;
const t0 = performance.now();
for (let i = 0; i < T.n; i++) for (let s = 0; s < 2; s++) {
  const ro = Math.max(s ? T.roR[i] : T.roL[i], s ? T.roR[(i + 1) % T.n] : T.roL[(i + 1) % T.n]);
  for (let b = 0; b < Math.ceil((ro + 6) / 8); b++) {
    const a = performance.now(), c = GRASS.chunk(i, s, b), d = performance.now() - a;
    if (d > worst) { worst = d; wk = [i, s, b, c.n, !!(GRASS.others[i] || GRASS.others[(i + 1) % T.n])]; } tot += c.n; nt++;
  }
}
console.log(T.id, 'chunks', nt, 'mean', ((performance.now() - t0) / nt).toFixed(3), 'ms, worst', worst.toFixed(2), 'ms, tufts per chunk', (tot / nt).toFixed(0), ', whole lap', tot, 'tufts');
// the worst one again, to tell its own cost from a collector pause that landed in it
const again = []; for (let r = 0; r < 5; r++) { const a = performance.now(); GRASS.chunk(wk[0], wk[1], wk[2]); again.push((performance.now() - a).toFixed(2)); }
console.log('  worst chunk node', wk[0], 'side', wk[1], 'band', wk[2], 'tufts', wk[3], 'fold', wk[4], '| again:', again.join(' '), 'ms');
process.exit(0);
