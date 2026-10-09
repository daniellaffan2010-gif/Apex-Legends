/* Where to look at the grass from: nodes with grass close to the road on both sides
   (or on one side, with SIDE=1), for the cockpit renders.
   node --import ./scripts/asset-register.mjs scripts/grass-nodes.mjs [track ...] */
globalThis.window = globalThis;
const THREE = await import('three');
const { TRACKS } = await import('../src/tracks/index.js');
const { buildTrack } = await import('../src/tracks/build.js');
const { GRASS } = await import('../src/render3d/ground/grass.js');
const ids = process.argv.slice(2).length ? process.argv.slice(2) : ['spa', 'suzuka', 'monza', 'silverstone', 'cota', 'zandvoort'];
for (const id of ids) {
  const T = buildTrack(TRACKS.find(t => t.id === id));
  GRASS.build({ world: new THREE.Group() }, { track: T });
  const out = [];
  for (let i = 0; i < T.n; i += 3) {
    const a = GRASS.runs(i, 0), b = GRASS.runs(i, 1), l = a.length ? a[0] : 99, r = b.length ? b[0] : 99;
    if (process.env.SIDE ? Math.min(l, r) < 2.5 : (l < 4 && r < 4)) out.push(i + ':' + l.toFixed(1) + '/' + r.toFixed(1));
  }
  console.log(id, 'n', T.n, '|', out.length, 'nodes |', out.filter((_, k) => k % Math.max(1, Math.floor(out.length / 12)) === 0).join(' '));
  GRASS.dispose();
}
process.exit(0);
