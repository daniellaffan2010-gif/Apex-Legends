/* What the grass thinks is where across a node: FIELD's kinds every half metre and
   the grass runs, both sides.
   node --import ./scripts/asset-register.mjs scripts/grass-runs.mjs <track> <node> */
globalThis.window = globalThis;
const THREE = await import('three');
const { TRACKS } = await import('../src/tracks/index.js');
const { buildTrack } = await import('../src/tracks/build.js');
const { GRASS } = await import('../src/render3d/ground/grass.js');
const { FIELD } = await import('../src/render3d/ground/field.js');
const [id = 'spa', nd = '0'] = process.argv.slice(2);
const T = buildTrack(TRACKS.find(t => t.id === id)), i = +nd;
GRASS.build({ world: new THREE.Group() }, { track: T });
for (const s of [0, 1]) {
  const sd = s ? 1 : -1, ro = s ? T.roR[i] : T.roL[i];
  const ks = [];
  for (let a = 0; a <= ro + 6; a += 0.5) ks.push(a.toFixed(1) + FIELD.kindAt(T, i, sd * (T.half + a))[0] + GRASS.kind(T, i, sd * (T.half + a)));
  console.log(s ? 'R' : 'L', 'ro', ro.toFixed(1), 'rs', (s ? T.rsR : T.rsL || [])[i], 'astro', T.astro, '\n ', ks.join(' '));
  console.log('  runs', Array.from(GRASS.runs(i, s)).map(v => +v.toFixed(2)).join(' '));
}
process.exit(0);
