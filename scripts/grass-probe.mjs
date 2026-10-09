/* Track data around a node, for chasing a grounding problem: height, bridge, deck, run-off.
   node --import ./scripts/asset-register.mjs scripts/grass-probe.mjs <track> <from> <to> */
globalThis.window = globalThis;
const { TRACKS } = await import('../src/tracks/index.js');
const { buildTrack } = await import('../src/tracks/build.js');
const [id, a = '0', b = '10'] = process.argv.slice(2);
const T = buildTrack(TRACKS.find(t => t.id === id));
for (let i = +a; i <= +b; i++) console.log(i, 'z', T.z[i].toFixed(2), 'bridge', T.bridge[i], 'deck', T.deckH[i].toFixed(2), 'roL', T.roL[i], 'roR', T.roR[i], 'rs', T.rsL && T.rsL[i], T.rsR && T.rsR[i], 'curv', T.curv[i].toFixed(4), 'camber', T.camber[i].toFixed(3), 'pit', T.pitRamp(i).toFixed(2));
process.exit(0);
