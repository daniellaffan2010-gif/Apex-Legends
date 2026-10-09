/* A debugging hook for the render script: which meshes lie over a track node's centre, top down,
   and how far above the road top (to tell a world's overlay from the kerbs).
   PROBE=<node> HOOKS=scripts/kerbs3d-probe.mjs node --import ./scripts/asset-register.mjs scripts/cockpit-render.mjs <track> <node> <out.png> */
import { FIELD } from '../src/render3d/ground/field.js';
export function install(G3, S, THREE){
  const T = S.track, i = +(process.env.PROBE || 0), x = T.x[i], y = T.y[i];
  const rc = new THREE.Raycaster(new THREE.Vector3(x, 500, y), new THREE.Vector3(0, -1, 0));
  G3.scene.updateMatrixWorld(true);
  for (const h of rc.intersectObject(G3.scene, true).slice(0, 8)) {
    const m = h.object.material;
    console.log('hit', h.object.name || '-', h.object.type, (h.point.y - FIELD.zAt(T, i, 0)).toFixed(3), m && m.color && m.color.getHexString(), !!(m && m.map), !!(m && m.transparent), m && m.type);
  }
}
