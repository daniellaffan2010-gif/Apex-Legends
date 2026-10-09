/* The grass hook, plus a check of what the tufts actually stand on in the built world:
   for a sample of the tufts on show, a ray straight down from 3 m above each one
   through every world mesh (not the grass), and how far the root is above (+) or
   below (-) the top surface it hits. Printed once, after the last frame.
   HOOKS=scripts/hooks/grass-ground-hook.mjs node --import ./scripts/asset-register.mjs scripts/cockpit-render.mjs <track> <node> <out.png> */
import * as base from './grass-hook.mjs';
import { GRASS } from '../../src/render3d/ground/grass.js';
import { FIELD } from '../../src/render3d/ground/field.js';

let n = 0;
export function install(G3, S, THREE) { base.install(G3, S, THREE); }
export function frame(G3, S, THREE) {
  base.frame(G3, S, THREE);
  if (++n !== 40) return;
  const m = GRASS.mesh; if (!m) { console.log('grass: none'); return; }
  const meshes = [];
  G3.scene.updateMatrixWorld(true);
  // what a tuft can stand on or be buried in: opaque meshes (not the cloud-shadow and other multiply overlays)
  G3.scene.traverse(o => {
    if (!o.isMesh || o.isInstancedMesh || o === m || !o.visible || !o.geometry || !o.geometry.attributes.position) return;
    const mt = Array.isArray(o.material) ? o.material[0] : o.material;
    if (mt.transparent || mt.depthWrite === false) return;
    meshes.push(o);
  });
  // the ground is seen from above: make every face catch the ray whichever way it was wound
  const sides = meshes.map(o => { const mt = Array.isArray(o.material) ? o.material[0] : o.material; const s = mt.side; mt.side = THREE.DoubleSide; return [mt, s]; });
  const rc = new THREE.Raycaster(), e = m.instanceMatrix.array, down = new THREE.Vector3(0, -1, 0), o3 = new THREE.Vector3();
  const live = []; for (let q = 0; q < m.count; q++) if (e[q * 16 + 15]) live.push(q);
  const step = Math.max(1, Math.floor(live.length / 250)), d = [];
  const cam = G3.camFP.position;
  for (let k = 0; k < live.length; k += step) {
    const q = live[k] * 16; o3.set(e[q + 12], e[q + 13] + 3, e[q + 14]);
    if (Math.hypot(o3.x - cam.x, o3.z - cam.z) > 45) continue;
    rc.set(o3, down); rc.far = 8;
    const hit = rc.intersectObjects(meshes, false)[0];
    if (hit) {
      const ob = hit.object, mt = Array.isArray(ob.material) ? ob.material[0] : ob.material;
      const L = FIELD.locate(S.track, o3.x, o3.z), a = Math.abs(L.off) - S.track.half, ro = FIELD.roAt(S.track, L.i, L.off);
      const what = `${ob.name || (ob.parent && ob.parent.name) || mt.type}${mt.color ? ' #' + mt.color.getHexString() : ''}${mt.map ? ' tex' : ''} [${ob.geometry.attributes.position.count}v] node ${L.i} off ${L.off.toFixed(1)} a ${a.toFixed(1)} ro ${ro.toFixed(1)}`;
      d.push([e[q + 13] - hit.point.y, what, live[k]]);
    }
  }
  d.sort((a, b) => a[0] - b[0]);
  // the worst float, ray by ray: everything under it
  if (process.env.GDEBUG && d.length) {
    const w = d[d.length - 1], q = w[2] * 16; o3.set(e[q + 12], e[q + 13] + 3, e[q + 14]); rc.set(o3, down); rc.far = 8;
    console.log('  worst', (w[0] * 100).toFixed(1), w[1], 'at', o3.x.toFixed(2), o3.z.toFixed(2));
    console.log('  under the worst one (root y', e[q + 13].toFixed(2), '):');
    for (const h of rc.intersectObjects(meshes, false).slice(0, 6)) { const mt = Array.isArray(h.object.material) ? h.object.material[0] : h.object.material; console.log('   ', h.point.y.toFixed(2), h.object.name || (h.object.parent && h.object.parent.name), mt.type, mt.map ? 'tex' : '', h.object.geometry.attributes.position.count + 'v', 'visible', h.object.visible); }
  }
  for (const [mt, s] of sides) mt.side = s;
  d.sort((a, b) => a[0] - b[0]);
  const pct = p => d.length ? (d[Math.min(d.length - 1, Math.floor(d.length * p))][0] * 100).toFixed(1) : '-';
  console.log(`grass on the ground: ${d.length} tufts sampled, root above the top surface (cm): min ${pct(0)} p5 ${pct(0.05)} median ${pct(0.5)} p95 ${pct(0.95)} max ${pct(0.999)}`);
  const off = d.filter(v => Math.abs(v[0]) > 0.03);
  console.log(`  more than 3 cm off: ${off.length}`);
  for (const v of [...off.slice(0, 3), ...off.slice(-3)]) console.log(`    ${(v[0] * 100).toFixed(1)} cm on ${v[1]}`);
}
