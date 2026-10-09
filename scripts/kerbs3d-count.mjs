/* How much kerb each circuit has, by kind, to size the 3D kerbs' budget.
   node --import ./scripts/asset-register.mjs scripts/kerbs3d-count.mjs */
const { TRACKS } = await import('../src/tracks/index.js');
const { buildTrack } = await import('../src/tracks/build.js');
for (const d of TRACKS) {
  const T = buildTrack(d), c = [0, 0, 0, 0];
  for (const a of [T.kerbL, T.kerbR]) for (const k of a) c[k]++;
  if (process.argv.length > 2) continue;
  console.log(d.id.padEnd(12), 'n', T.n, 'ds', T.ds.toFixed(2), 'half', T.half, T.barrier || '-', 'kinds0-3', c.join(' '));
}
// the nodes with a sausage kerb (kind 3) per circuit, to aim the render script at
for (const id of process.argv.slice(2)) {
  const T = buildTrack(TRACKS.find(t => t.id === id)), s = [];
  for (let i = 0; i < T.n; i++) if (T.kerbL[i] === 3 || T.kerbR[i] === 3) s.push(i + (T.kerbR[i] === 3 ? 'R' : 'L'));
  console.log(id, 'sausage nodes', s.join(' '));
}
