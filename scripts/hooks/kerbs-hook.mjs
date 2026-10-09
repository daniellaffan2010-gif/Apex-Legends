/* The 3D kerbs in the render scripts before they are wired into the game: takes the old
   flat kerb strips out of G3.world and puts KERBS3D in their place.
   HOOKS=scripts/hooks/kerbs-hook.mjs node --import ./scripts/asset-register.mjs scripts/cockpit-render.mjs <track> <node> <out.png>
   The old strips are the meshes with G3.mat(P.kerbA) / G3.mat(P.kerbB) laid at G3.roadLift + 0.02
   over the road's own surface; the street circuits' painted kerb at the wall foot uses the same
   material at a lower lift and stays. */
import { KERBS3D } from '../../src/render3d/ground/kerbs3d.js';
import { FIELD } from '../../src/render3d/ground/field.js';

export function oldKerbs(G3, T){
  const P = T.pal, mats = new Set([G3.mat(P.kerbA), G3.mat(P.kerbB)]), want = (G3.roadLift || 0.07) + 0.02, out = [];
  for(const o of G3.world.children){
    if(!o.isMesh || !mats.has(o.material)) continue;
    const p = o.geometry.attributes.position; if(!p || !p.count) continue;
    const x = p.getX(0), y = p.getZ(0), z = p.getY(0), L = FIELD.locate(T, x, y);
    const lift = z - FIELD.baseZ(T, L.i, L.off);
    if(Math.abs(lift - want) < 0.004) out.push(o);
  }
  return out;
}

export function install(G3, S){
  const T = S.track, old = oldKerbs(G3, T);
  for(const o of old){ G3.world.remove(o); o.geometry.dispose(); }
  const t0 = performance.now(), g = KERBS3D.build(G3, T, T.pal), ms = performance.now() - t0;
  G3.world.add(g);
  console.log('kerbs3d: removed', old.length, 'old strips;', JSON.stringify(KERBS3D.stats), ms.toFixed(0) + ' ms');
}

/* KCAM=node,off,height,ahead,lookOff[,lookH]: a free camera for looking at a kerb up close,
   standing at a track node and lateral offset, height metres over the surface there, looking
   at the point `ahead` metres along the lap at lookOff (the player's car is hidden).
   WET=0..1 renders the kerbs wet. */
export function frame(G3, S, THREE){
  KERBS3D.wet(process.env.WET ? +process.env.WET : (G3.wetVis || 0));
  if(!process.env.KCAM) return;
  const T = S.track, [nd, off, h, ahead, lo, lh = 0] = process.env.KCAM.split(',').map(Number);
  const i = ((nd % T.n) + T.n) % T.n, j = (i + Math.round(ahead / T.ds) + T.n) % T.n;
  const cam = G3.camFP;
  cam.position.set(T.x[i] + T.nx[i] * off, FIELD.zAt(T, i, off) + h, T.y[i] + T.ny[i] * off);
  cam.lookAt(new THREE.Vector3(T.x[j] + T.nx[j] * lo, FIELD.zAt(T, j, lo) + lh, T.y[j] + T.ny[j] * lo));
  cam.fov = 50; cam.updateProjectionMatrix();
  const me = G3.cars.find(e => e.c === S.player); if(me) me.g.visible = false;
  // the render script draws a transparent ShaderMaterial (Zandvoort's drifting sand) as opaque white: leave those out
  if(process.env.NOSHADER) G3.world.traverse(o => { if(o.isMesh && o.material && o.material.isShaderMaterial && o.material.transparent) o.visible = false; });
}
