/* The grass in the cockpit render, before it is wired into the game.
   HOOKS=scripts/hooks/grass-hook.mjs node --import ./scripts/asset-register.mjs scripts/cockpit-render.mjs <track> <node> <out.png>
   GROUND=1 also lays a stand-in verge at FIELD's grass height (LIFT.grass), as the ground
   module will, so the tufts can be judged against the surface they are rooted on where
   build.js still has its old band 35 cm down. WET=0..1 darkens them. */
import { GRASS } from '../../src/render3d/ground/grass.js';
import { FIELD, LIFT } from '../../src/render3d/ground/field.js';

let dir = null;
export function install(G3, S, THREE) {
  const T = S.track;
  if (process.env.GROUND) {
    const m = new THREE.MeshStandardMaterial({ color: G3.col('#4E7A36'), roughness: 0.95 });
    for (const sd of [-1, 1]) {
      const geo = FIELD.ribbon(T, i => sd * (T.half + 0.2), i => sd * (T.half + (sd < 0 ? T.roL[i] : T.roR[i]) + 6), {
        sub: 3, lane: 1, h: (i, o) => (FIELD.kindAt(T, i, o) === 'grass' ? LIFT.grass : -0.2),
      });
      const mesh = new THREE.Mesh(geo, m); mesh.name = 'stand-in verge'; G3.world.add(mesh);
    }
  }
  GRASS.build(G3, S);
  if (process.env.WET) GRASS.wet(+process.env.WET);
  dir = new THREE.Vector3();
}
export function frame(G3, S) {
  const cam = G3.camFP; cam.getWorldDirection(dir);
  const L = Math.hypot(dir.x, dir.z) || 1;
  GRASS.frame(G3, S, { fp: G3.view === 'cockpit', x: cam.position.x, y: cam.position.z, z: cam.position.y, hx: dir.x / L, hy: dir.z / L, dt: 1 / 60 });
  if (process.env.GSTATS && S.clock > 0.6) console.log('grass', JSON.stringify(GRASS.stats));
}
