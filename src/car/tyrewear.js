/* How a tyre looks at a given wear. One curve for the HUD icon and the 3D wheels.
   `life` is the car's c.life (1 new -> 0 gone). There are five named stages, but they are only labels: every visual
   feature is a smoothstep weight over its own window of life, and the windows overlap, so nothing ever steps.
   No DOM and no THREE here, so Node tests can load it.

     1 New             1.00-0.85  glossy black tread, bright compound band
     2 Scrubbed        0.85-0.60  tread goes matte and grey, faint scuffing
     3 Worn            0.60-0.30  band dulls, graining streaks across the tread
     4 Past the cliff  0.30-0.12  marbles and blisters, heat tint (the grip cliff, physics.js tyreWearK)
     5 Cords           < 0.12     carcass cords show through (the puncture risk) */
const STAGES = [
  { key: "new",    name: "New",            from: 1.00 },
  { key: "scrub",  name: "Scrubbed",       from: 0.85 },
  { key: "worn",   name: "Worn",           from: 0.60 },
  { key: "cliff",  name: "Past the cliff", from: 0.30 },
  { key: "cords",  name: "Cords",          from: 0.12 },
];

// smoothstep that also takes a > b (a window that opens as its input falls)
function ss(a, b, x){
  const t = (x - a) / (b - a);
  return t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
}

/* The weights, each 0..1. gloss falls with wear; the rest rise. Windows (life): scuff .92-.65, fade .70-.25,
   grain .70-.45, heat .40-.10, marbles .38-.20, cords .16-.04. */
function wearLook(life, out){
  const L = life > 1 ? 1 : life < 0 ? 0 : (life === life ? life : 1);
  const o = out || {};
  o.w = 1 - L;
  o.gloss = ss(0.60, 0.95, L);
  o.scuff = ss(0.92, 0.65, L);
  o.fade = ss(0.70, 0.25, L);
  o.grain = ss(0.70, 0.45, L);
  o.heat = ss(0.40, 0.10, L);
  o.marbles = ss(0.38, 0.20, L);
  o.cords = ss(0.16, 0.04, L);
  return o;
}

// 0..4, for the text label only
function stageOf(life){
  return life < STAGES[4].from ? 4 : life < STAGES[3].from ? 3 : life < STAGES[2].from ? 2 : life < STAGES[1].from ? 1 : 0;
}

// the wear bar's colour: green through yellow and orange to red, no steps
const BAR = [[0.00, 255, 75, 62], [0.20, 255, 75, 62], [0.35, 255, 140, 50], [0.55, 242, 194, 48], [0.80, 47, 208, 122], [1.00, 47, 208, 122]];
function barRGB(life, out){
  const o = out || [0, 0, 0], L = life > 1 ? 1 : life < 0 || life !== life ? 0 : life;
  let i = 1; while(i < BAR.length - 1 && L > BAR[i][0]) i++;
  const a = BAR[i - 1], b = BAR[i], t = b[0] === a[0] ? 1 : (L - a[0]) / (b[0] - a[0]);
  for(let k = 0; k < 3; k++) o[k] = a[k + 1] + (b[k + 1] - a[k + 1]) * t;
  return o;
}
function barColour(life){
  const c = barRGB(life);
  return "rgb(" + Math.round(c[0]) + "," + Math.round(c[1]) + "," + Math.round(c[2]) + ")";
}

export { STAGES, wearLook, stageOf, barRGB, barColour };
