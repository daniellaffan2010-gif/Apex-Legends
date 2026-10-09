/* Which grass frames cost more than a millisecond, and why: two laps at 80 m/s,
   the second one over chunks already made.
   node --import ./scripts/asset-register.mjs scripts/grass-spikes.mjs [track ...] */
globalThis.window = globalThis;
const THREE = await import('three');
const { TRACKS } = await import('../src/tracks/index.js');
const { buildTrack } = await import('../src/tracks/build.js');
const { GRASS } = await import('../src/render3d/ground/grass.js');
const ids = process.argv.slice(2).length ? process.argv.slice(2) : ['zandvoort', 'spa'];
for (const id of ids) {
  const T = buildTrack(TRACKS.find(t => t.id === id));
  const G = { world: new THREE.Group(), col: c => new THREE.Color(c).convertSRGBToLinear() }, S = { track: T, clock: 0 };
  GRASS.build(G, S);
  for (let lap = 0; lap < 2; lap++) {
    const step = 80 / 60, frames = Math.ceil(T.n * T.ds / step), sp = [];
    for (let f = 0; f < frames; f++) {
      const s = f * step, k = Math.floor(s / T.ds) % T.n, fr = s / T.ds - Math.floor(s / T.ds), j = (k + 1) % T.n;
      const x = T.x[k] + (T.x[j] - T.x[k]) * fr, y = T.y[k] + (T.y[j] - T.y[k]) * fr;
      S.clock = f / 60; GRASS.stats.written = 0;
      const t0 = performance.now();
      GRASS.frame(G, S, { fp: true, x, y, z: T.z[k] + 0.74, hx: T.tx[k], hy: T.ty[k], dt: 1 / 60 });
      const d = performance.now() - t0;
      if (d > 1) sp.push(`${f}:${d.toFixed(1)}ms(gen ${GRASS.stats.genMs.toFixed(2)}, wrote ${GRASS.stats.written})`);
    }
    console.log(id, 'lap', lap, 'frames', frames, 'over 1 ms:', sp.length, sp.slice(0, 10).join(' '));
  }
  GRASS.dispose();
}
process.exit(0);
