/* The ground materials in the picture, before they are wired into build.js (for scripts/materials-render.mjs
   or cockpit-render.mjs, HOOKS=scripts/hooks/materials-hook.mjs):
   - the road is re-laid with FIELD.ribbon (world-metre UVs, a vertex colour from GMAT.roadColour) in GMAT's road
     material, which becomes G3.roadMat, and the old see-through rubber strip is hidden (roadColour does that now);
   - every run-off band build.js laid with a bandTex material (tarmac, gravel, astro, the grass under it all, the
     street circuits' escape roads) gets GMAT's material for its kind, with its UVs rewritten to world metres and a
     uv2 (metres out from the road edge, metres along) so the astro and grass stripes run along the track;
   - a street circuit's run-off base becomes concrete;
   - the old flat kerbs get GMAT's kerb paint, their colour moved into a vertex colour.
   No draw calls are added: every mesh keeps its place, only its material (and the road's geometry) changes.
   frame() hands the wetness to GMAT.wet. */
import { GMAT } from '../../src/render3d/ground/materials.js';
import { FIELD, LIFT } from '../../src/render3d/ground/field.js';
import { TEX } from '../../src/render2d/textures.js';
import { shade } from '../../src/config/util.js';
import { WEATHER } from '../../src/render3d/weather.js';

export const STATS = {};

export function install(G3, S, THREE) {
  const T = S.track, P = T.pal, w = T.half;
  const M = GMAT.build(G3, T, P);
  // which bandTex texture is which kind: build.js's own colour/kind pairs
  const img = (col, kind) => TEX.ground(col, kind).img;
  const runCol = T.id === 'zandvoort' || T.id === 'baku' ? '#C9B78E' : shade(P.road, 0.22);
  const byImg = new Map([
    [img(shade(P.grass, -0.05), 'grass'), M.grass],
    [img('#6E7176', 'asphalt'), M.tarmac],
    [img('#ADA38C', 'gravel'), M.gravel],
    [img('#3E8A4A', 'grass'), M.astro],
    [img(runCol, 'asphalt'), M.tarmac],
    [img(shade(P.road, 0.34), 'asphalt'), M.tarmac],
    [img(shade(P.road, 0.26), 'asphalt'), M.tarmac],
  ]);
  const roadImg = img(P.road, 'asphalt');
  const wallBase = T.barrier === 'wall' ? G3.mats.get(shade(P.wall, -0.30) + '|') : null;
  const kerbA = G3.mats.get(P.kerbA + '|'), kerbB = G3.mats.get(P.kerbB + '|');
  // uv = world metres; uv2 = metres out from the road edge, metres along (as FIELD.ribbon lays them)
  const reUV = g => GMAT.worldUV(g, T);
  const counts = { road: 0, runoff: 0, concrete: 0, kerb: 0, hidden: 0 };
  let roadTris0 = 0, roadTris1 = 0;
  for (const o of [...G3.world.children]) {
    if (!o.isMesh || o.isInstancedMesh) continue;
    const m = o.material;
    if (!m || Array.isArray(m)) continue;
    if (m.map && m.map.image === roadImg && m === G3.roadMat) {
      roadTris0 += o.geometry.index ? o.geometry.index.count / 3 : o.geometry.attributes.position.count / 3;
      o.geometry.dispose();
      o.geometry = FIELD.ribbon(T, -w, w, { lift: G3.roadLift != null ? G3.roadLift : LIFT.road, colour: GMAT.roadColourOf(T), lane: 1.5, sub: 2 });
      roadTris1 += o.geometry.index.count / 3;
      o.material = M.road; counts.road++;
      continue;
    }
    if (m.map && byImg.has(m.map.image)) { reUV(o.geometry); o.material = byImg.get(m.map.image); counts.runoff++; continue; }
    if (wallBase && m === wallBase) { reUV(o.geometry); o.material = M.concrete; counts.concrete++; continue; }
    if ((m === kerbA || m === kerbB) && kerbA !== kerbB) {
      reUV(o.geometry);
      const c = m.color, n = o.geometry.attributes.position.count, cc = new Float32Array(n * 3);
      for (let k = 0; k < n; k++) { cc[k * 3] = c.r; cc[k * 3 + 1] = c.g; cc[k * 3 + 2] = c.b; }
      o.geometry.setAttribute('color', new THREE.BufferAttribute(cc, 3));
      o.material = M.kerb; counts.kerb++; continue;
    }
    // the old rubber line: a see-through dark strip, which roadColour replaces
    if (m.transparent && Math.abs(m.opacity - 0.18) < 1e-6 && Math.abs(m.roughness - 0.72) < 1e-6) { o.visible = false; counts.hidden++; }
  }
  G3.roadMat = M.road;
  // weather.js read the road's dry state when it was built; tell it about the new one
  if (WEATHER.rain) WEATHER.road0 = { c: M.road.color.clone(), r: M.road.roughness, m: M.road.metalness };
  Object.assign(STATS, counts, { roadTris0, roadTris1, budget: GMAT.budget() });
  console.log('materials-hook', JSON.stringify(counts), '| road triangles', roadTris0, '->', roadTris1, '| textures', STATS.budget.textures, STATS.budget.mb.toFixed(2) + ' MB');
}

export function frame(G3) { GMAT.wet(G3.wetVis || 0); }
