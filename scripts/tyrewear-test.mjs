/* The tyre wear curve (src/car/tyrewear.js) and the wheel's zone attribute.
   node scripts/tyrewear-test.mjs
   Samples the curve at 10,001 values of life: every weight in 0..1, no step bigger than 0.01 between neighbours,
   each weight moves one way only, each stage's own feature is strong at its middle and the next stage's is not yet
   there. The bar colour has no jumps either. Then builds a wheel and checks its per-vertex zone. */
import { STAGES, wearLook, stageOf, barRGB, barColour } from '../src/car/tyrewear.js';
let fails = 0;
const ok = (c, m) => { if(!c){ fails++; console.log('FAIL', m); } };

const N = 10000, keys = ['gloss', 'scuff', 'fade', 'grain', 'heat', 'marbles', 'cords', 'w'];
const dir = { gloss: 1, scuff: -1, fade: -1, grain: -1, heat: -1, marbles: -1, cords: -1, w: -1 }; // sign of d(weight)/d(life)
let prev = null, maxJump = 0, maxBar = 0, pb = null;
for(let i = 0; i <= N; i++){
  const life = 1 - i / N, o = wearLook(life);
  for(const k of keys){
    ok(o[k] >= 0 && o[k] <= 1, k + ' in 0..1 at ' + life);
    if(prev){
      const d = o[k] - prev[k];
      maxJump = Math.max(maxJump, Math.abs(d));
      // life is falling: a weight that rises as life falls must not drop, and the other way round
      ok(dir[k] > 0 ? d <= 1e-12 : d >= -1e-12, k + ' moves one way at ' + life);
    }
  }
  prev = Object.assign({}, o);
  const b = barRGB(life);
  if(pb) for(let k = 0; k < 3; k++) maxBar = Math.max(maxBar, Math.abs(b[k] - pb[k]));
  pb = b.slice();
}
ok(maxJump < 0.01, 'largest weight step ' + maxJump);
ok(maxBar < 1.5, 'largest bar colour step ' + maxBar);
console.log('max weight step', maxJump.toFixed(5), '· max bar colour step', maxBar.toFixed(3));

// stages: signature feature per stage, at its middle
const sig = ['gloss', 'scuff', 'grain', 'marbles', 'cords'];
const mids = [0.925, 0.725, 0.45, 0.21, 0.06];
mids.forEach((m, i) => {
  const o = wearLook(m);
  ok(o[sig[i]] >= 0.5, STAGES[i].name + ' mid: ' + sig[i] + ' ' + o[sig[i]].toFixed(2));
  if(i < 4) ok(o[sig[i + 1]] <= 0.15, STAGES[i].name + ' mid: ' + sig[i + 1] + ' not there yet ' + o[sig[i + 1]].toFixed(2));
  ok(stageOf(m) === i, 'stageOf(' + m + ') = ' + stageOf(m));
});
for(const [l, s] of [[1, 0], [0.85, 0], [0.8499, 1], [0.6, 1], [0.5999, 2], [0.3, 2], [0.2999, 3], [0.12, 3], [0.1199, 4], [0, 4]]) ok(stageOf(l) === s, 'stageOf(' + l + ') = ' + stageOf(l) + ', want ' + s);
ok(wearLook(NaN).w === 0 && wearLook(5).gloss === 1 && wearLook(-3).cords === 1, 'out of range life is clamped');
ok(/^rgb\(\d+,\d+,\d+\)$/.test(barColour(0.5)), 'barColour is a css colour: ' + barColour(0.5));

// the wheel's zone attribute (needs the geometry module, which needs three)
globalThis.window = globalThis;
const THREE = await import('three');
const { CARGEO } = await import('../src/render3d/car.js');
const G = { col: c => new THREE.Color(c) };
const g = CARGEO.wheel(G, 0.36, 0.36, '#FF3B30', '#2A2D31');
const z = g.attributes.zone, p = g.attributes.position;
ok(!!z, 'wheel has a zone attribute');
if(z){
  ok(z.count === p.count && z.itemSize === 1, 'zone has one value per vertex');
  const seen = new Set(); for(let i = 0; i < z.count; i++) seen.add(z.getX(i));
  ok([...seen].every(v => v >= 0 && v <= 3 && Number.isInteger(v)), 'zone values are 0..3: ' + [...seen]);
  ok(seen.has(0) && seen.has(1) && seen.has(2) && seen.has(3), 'all four zones present: ' + [...seen]);
}
console.log(fails ? fails + ' FAILED' : 'tyrewear: all ok');
process.exit(fails ? 1 : 0);
