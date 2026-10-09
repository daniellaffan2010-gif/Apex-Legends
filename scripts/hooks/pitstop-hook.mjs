/* For cockpit-render.mjs: the player's car stopped in its own box, the stop frozen at PT seconds (default 0.9),
   the crew out at their stations. PHASE=approach puts the car 40 m short of its box instead, on its way in.
   HOOKS=scripts/hooks/pitstop-hook.mjs PT=0.9 CAM=front node --import ./scripts/asset-register.mjs scripts/cockpit-render.mjs monza 0 out.png */
let st = null, H = null;
export async function install(G3, S){
  const { planStop } = await import('../../src/car/pitstop.js');
  const { pilotStart } = await import('../../src/car/pitpilot.js');
  const { PITCREW } = await import('../../src/render3d/pitcrew.js');
  const p = S.player, T = S.track, box = T.boxOf(p.team);
  p.ai = false;
  // REP=wing,susp: those parts broken on the car, and their repair planned for this stop
  const reps = (process.env.REP || '').split(',').filter(Boolean);
  for (const k of reps) p.broken.add(k);
  pilotStart(p, S, 'player', { tyre: 'soft', repairs: reps });
  const P = p.pp;
  if (process.env.PHASE === 'approach') { P.phase = 'box'; P.stopA = box.a; P.a = box.a - 40; P.v = 18; }
  else { P.phase = 'stopped'; P.a = box.a; P.stopA = box.a; P.v = 0; st = P.st = planStop(p, { tyre: 'soft', repairs: reps }); if (reps.length) console.log('repair windows', JSON.stringify(P.st.rep), 'drop', P.st.drop.toFixed(2)); P.st.t = +(process.env.PT || 0.9); }
  H = { p, P, PITCREW };
  frame(G3, S);
}
export function frame(G3, S){
  const { p, P, PITCREW } = H, T = S.track;
  // pose the car where the lane puts it (the render loop does not run the session)
  const L = T.length, s = ((T.pitSOf(T.pitIn) + P.a) % L + L) % L, f = s / T.ds, j = Math.floor(f) % T.n, k = (j + 1) % T.n, u = f - Math.floor(f);
  const lat = P.phase === 'stopped' ? T.pitWork(f) : T.pitFast(f);
  p.node = j; p.x = T.x[j] + (T.x[k] - T.x[j]) * u + T.nx[j] * lat; p.y = T.y[j] + (T.y[k] - T.y[j]) * u + T.ny[j] * lat; p.off = lat; p.s = s;
  p.h = T.ang[j]; p.vx = p.vy = 0; p.pitting = 1; p.inPit = true; P.off = lat;
  if (st) st.t = +(process.env.PT || 0.9);
  for (const C of PITCREW.crews.values()) if (C.box.id === p.team.id) C.u = 1;
}
