/* The gravel traps in the cockpit picture (scripts/cockpit-render.mjs, HOOKS=scripts/hooks/gravel-hook.mjs).
   install: builds GRAVEL into the world and finds a gravel trap. frame: on the first call, puts the player in that trap
   (GRAVEL_IN=0 leaves the car where the script put it), sliding into it at speed and slowing as gravel slows a car,
   and runs a second of the trap on its own so the spray is already up; then one GRAVEL.frame per frame, with the
   cockpit's view centre. Env: GNODE=<node> picks the trap nearest that node, GSPEED=<m/s> (default 34),
   GANG=<degrees> how sharply the car turns into the trap (default 14), GVIEW=iso for the overhead view's settings. */
import { GRAVEL } from '../../src/render3d/ground/gravel.js';
import { FIELD } from '../../src/render3d/ground/field.js';

let T = null, trap = null, first = true, last = 0, dbg = 0;
const view = { fp: true, x: 0, y: 0, z: 0, hx: 1, hy: 0, dt: 0 };

export function install(G3, S, THREE) {
  T = S.track;
  /* For the picture only: the rasteriser cannot blend, so the cloud-shadow overlay (a multiply pass 11 cm over the
     run-off at Silverstone and Zandvoort, depth-write off) comes out as an opaque white sheet over the trap. Hide it. */
  G3.world.traverse(o => { const m = o.material; if (o.isMesh && m && m.blending === THREE.MultiplyBlending) o.visible = false; });
  GRAVEL.build(G3, S);
  if (!GRAVEL.on) { console.log('gravel-hook: no gravel on', T.def.id); return; }
  // the trap: a node whose gravel runs on for 6 nodes, nearest GNODE (or the first)
  const want = process.env.GNODE != null ? +process.env.GNODE : 0, n = T.n;
  let best = null, bd = 1e9;
  for (let i = 0; i < n; i++) for (const sg of [-1, 1]) {
    let ok = true;
    for (let k = 0; k < 6 && ok; k++) ok = FIELD.kindAt(T, (i + k) % n, sg * (T.half + 6)) === 'gravel';
    if (!ok) continue;
    const d = Math.min(Math.abs(i - want), n - Math.abs(i - want));
    if (d < bd) { bd = d; best = { i, sg }; }
  }
  trap = best;
  console.log('gravel-hook: trap at node', best && best.i, 'side', best && best.sg, '| patches', GRAVEL.pa.length, '| segments', GRAVEL.segN.length);
}

export function move(S, c, dt) {
  // a car ploughing through gravel: about 1.3 g of drag
  const sp = Math.hypot(c.vx, c.vy), dec = Math.min(sp, 13 * dt);
  if (sp > 0) { c.vx -= c.vx / sp * dec; c.vy -= c.vy / sp * dec; }
  c.x += c.vx * dt; c.y += c.vy * dt;
  const L = FIELD.locate(T, c.x, c.y, c.node);
  c.node = L.i; c.off = L.off;
  c.z = FIELD.zAtXY(T, c.x, c.y, c.node);
}

export function frame(G3, S) {
  if (!GRAVEL.on) return;
  const c = S.player;
  const fp = process.env.GVIEW !== 'iso';
  const run = dt => {
    const hx = Math.cos(c.h), hy = Math.sin(c.h);
    view.fp = fp; view.hx = hx; view.hy = hy; view.dt = dt;
    view.x = fp ? c.x + hx * GRAVEL.AHEAD : c.x; view.y = fp ? c.y + hy * GRAVEL.AHEAD : c.y; view.z = c.z;
    GRAVEL.frame(G3, S, view);
  };
  if (first) {
    first = false; last = S.clock;
    if (trap && process.env.GRAVEL_IN !== '0') {
      // into the trap: start on its near edge, angled out across it
      const i = trap.i, sg = trap.sg, ang = (+(process.env.GANG || 14)) * Math.PI / 180, sp = +(process.env.GSPEED || 34);
      const off = sg * (T.half + (+(process.env.GOFF || 3)));
      c.x = T.x[i] + T.nx[i] * off; c.y = T.y[i] + T.ny[i] * off;
      c.h = T.ang[i] + sg * ang;                                      // + turns to the left (nx is the left normal)
      c.vx = Math.cos(c.h) * sp; c.vy = Math.sin(c.h) * sp; c.node = i; c.off = off; c.steer = 0;
      for (let k = 0; k < 60; k++) { S.clock += 1 / 60; move(S, c, 1 / 60); run(1 / 60); }
      last = S.clock;
    }
    return;
  }
  const dt = S.clock - last; last = S.clock;
  if (trap && process.env.GRAVEL_IN !== '0') move(S, c, dt);
  run(dt);
  // GDEBUG=1: what is live, every ten frames
  if (process.env.GDEBUG && (++dbg % 10) === 0) console.log('frame', dbg, '| car', c.x.toFixed(1), c.y.toFixed(1), 'node', c.node, 'off', c.off.toFixed(1),
    FIELD.kindAt(T, c.node, c.off), 'v', Math.hypot(c.vx, c.vy).toFixed(1), '| bed', GRAVEL.bed.count, 'near segs', GRAVEL.nNear,
    '| stones', GRAVEL.S.n, 'grains', GRAVEL.G.n, '(thrown', GRAVEL.nGS, 'blown', GRAVEL.nGW + ') dust', GRAVEL.D.n);
}
