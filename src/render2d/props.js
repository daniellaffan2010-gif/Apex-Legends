import { TAU, clamp, shade } from '../config/util.js';
import { NEARP, R, poly } from './view.js';
import { TEX, texQuad } from './textures.js';
import { BP, BR } from './car.js';

let TEXBUDGET = 0;

// when set, box()/pyramid()/groundEllipse() build meshes into B3.g instead of painting
let B3 = null;
// depth of one face of a solid, in whichever projection is running
function fkey(mx, my, mz){
  if(R.persp) return -((mx - R.fx) * (mx - R.fx) + (my - R.fy) * (my - R.fy));
  return mx + my + mz * 0.9;
}
/* a square pyramid — the Luxor, and the tops of a few other things */
function pyramid(ctx, cx, cy, cz, half, h, ang, col, sunDir){
  if(B3){ B3.self.coneAt(B3.g, cx, cy, cz, half, h, ang, col, 4); return; }
  const c = Math.cos(ang), s = Math.sin(ang);
  const loc = [[half, half], [half, -half], [-half, -half], [-half, half]];
  const wc = loc.map(q => [cx + q[0] * c - q[1] * s, cy + q[0] * s + q[1] * c]);
  const sp = wc.map(q => R.P(q[0], q[1], cz));
  const apex = R.P(cx, cy, cz + h);
  const faces = [];
  for(let i = 0; i < 4; i++){
    const j = (i + 1) % 4;
    const mx = (wc[i][0] + wc[j][0]) / 2, my = (wc[i][1] + wc[j][1]) / 2;
    faces.push({ d:fkey(mx, my, cz + h * 0.3), pts:[sp[i], sp[j], apex],
                 sh:0.5 + 0.5 * Math.cos(Math.atan2(my - cy, mx - cx) - (sunDir ?? 0.9)) });
  }
  faces.sort((a, b) => a.d - b.d);
  for(const f of faces) poly(ctx, f.pts, shade(col, -0.36 + f.sh * 0.36));
}
function box(ctx, cx, cy, cz, l, w, h, ang, top, side, sunDir, tex){
  if(B3){ B3.self.boxAt(B3.g, cx, cy, cz, l, w, h, ang, side, tex); return [[0,0],[0,0],[0,0],[0,0]]; }
  const hl = l / 2, hw = w / 2;
  const cA = Math.cos(ang), sA = Math.sin(ang);
  const cR = Math.cos(BR), sR = Math.sin(BR);
  const cP = Math.cos(BP), sP = Math.sin(BP);
  const V = (a, b, c2) => {
    const y1 = b * cR - c2 * sR, z1 = b * sR + c2 * cR;
    const x1 = a * cP + z1 * sP, z2 = -a * sP + z1 * cP;
    return [cx + x1 * cA - y1 * sA, cy + x1 * sA + y1 * cA, cz + z2];
  };
  const LOC = [[hl, hw, 0], [hl, -hw, 0], [-hl, -hw, 0], [-hl, hw, 0],
               [hl, hw, h], [hl, -hw, h], [-hl, -hw, h], [-hl, hw, h]];
  const WP = LOC.map(p => V(p[0], p[1], p[2]));
  const SP2 = WP.map(p => R.P(p[0], p[1], p[2]));
  const FACES = [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]];
  const list = [];
  for(let f = 0; f < 6; f++){
    const q = FACES[f];
    let mx = 0, my = 0, mz = 0;
    for(const k of q){ mx += WP[k][0]; my += WP[k][1]; mz += WP[k][2]; }
    mx /= 4; my /= 4; mz /= 4;
    const light = 0.5 + 0.5 * Math.cos(Math.atan2(my - cy, mx - cx) - (sunDir ?? 0.9));
    list.push({ d:fkey(mx, my, mz), pts:q.map(k => SP2[k]), f, sh:light });
  }
  list.sort((a, b) => a.d - b.d);
  for(const fc of list){
    if(fc.f === 1){ poly(ctx, fc.pts, top); continue; }
    if(fc.f === 0){ poly(ctx, fc.pts, shade(side, -0.42)); continue; }
    if(tex && TEXBUDGET > 0){
      // a textured wall, if it is big enough on screen to be worth it
      const q = fc.pts;
      let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
      for(const pt of q){ x0 = Math.min(x0, pt[0]); x1 = Math.max(x1, pt[0]); y0 = Math.min(y0, pt[1]); y1 = Math.max(y1, pt[1]); }
      const area = (x1 - x0) * (y1 - y0);
      // a wall filling the screen gains little from its tiling and costs the most
      const tooBig = area > R.W * R.H * 0.30;
      if(x1 - x0 > 9 && y1 - y0 > 9 && !tooBig && !(R.persp && q.some(pt => pt[2] != null && pt[2] < NEARP))){
        TEXBUDGET--;
        const wm = (fc.f === 2 || fc.f === 4) ? w : l;
        // face order is [bottomA, bottomB, topB, topA]
        texQuad(ctx, tex, q[0], q[1], q[2], q[3], wm, h);
        const t = -0.34 + fc.sh * 0.34;
        poly(ctx, q, t < 0 ? "rgba(0,0,0," + (-t * 0.9).toFixed(3) + ")" : "rgba(255,255,255," + (t * 0.5).toFixed(3) + ")");
        continue;
      }
    }
    poly(ctx, fc.pts, shade(side, -0.34 + fc.sh * 0.34));
  }
  return [SP2[4], SP2[5], SP2[6], SP2[7]];
}
// an ellipse lying flat in the world (a lake, a lawn, a fountain basin)
function groundEllipse(ctx, cx, cy, cz, rx, ry, ang, col){
  if(B3){ B3.self.discAt(B3.g, cx, cy, cz, rx, ry, -ang, col); return; }
  const pts = [], c = Math.cos(ang), sn = Math.sin(ang);
  for(let q = 0; q < 18; q++){
    const th = q / 18 * TAU, lx = Math.cos(th) * rx, ly = Math.sin(th) * ry;
    pts.push(R.P(cx + lx * c - ly * sn, cy + lx * sn + ly * c, cz));
  }
  poly(ctx, pts, col);
}
function boxCol(ctx, cx, cy, cz, l, w, h, ang, col, sunDir, topLift, tex){
  return box(ctx, cx, cy, cz, l, w, h, ang, shade(col, (topLift ?? 0.12)), col, sunDir, tex);
}
// a building: its walls carry the facade texture of the place it is in
function boxFacade(ctx, cx, cy, cz, l, w, h, ang, col, sunDir, style, night){
  return box(ctx, cx, cy, cz, l, w, h, ang, shade(col, 0.16), col, sunDir, TEX.facade(style, col, night));
}

/* ---- set dressing ---- */
function drawProp(ctx, p, T, S){
  const z = p.z, sun = T.sun, night = T.night;
  switch(p.t){
    case "tree": {
      boxCol(ctx, p.x, p.y, z, 0.7, 0.7, p.h * 0.42, 0, "#4A3A28", sun);
      const [sx, sy] = R.P(p.x, p.y, z + p.h * 0.42), rr = p.h * 0.40 * R.zoom;
      ctx.fillStyle = shade(p.col, -0.16); ctx.beginPath(); ctx.ellipse(sx, sy - rr * 0.45, rr * 0.95, rr * 0.78, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = p.col; ctx.beginPath(); ctx.ellipse(sx - rr * 0.22, sy - rr * 0.68, rr * 0.66, rr * 0.55, 0, 0, TAU); ctx.fill();
      break; }
    case "palm": {
      boxCol(ctx, p.x, p.y, z, 0.42, 0.42, p.h, 0, "#7A6247", sun);
      const [sx, sy] = R.P(p.x, p.y, z + p.h), rr = 3.4 * R.zoom;
      ctx.strokeStyle = p.col; ctx.lineWidth = Math.max(1.4, R.zoom * 0.34); ctx.lineCap = "round";
      for(let a = 0; a < 7; a++){ const th = a / 7 * TAU + p.r;
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.quadraticCurveTo(sx + Math.cos(th) * rr * 0.6, sy + Math.sin(th) * rr * 0.32 - rr * 0.35,
          sx + Math.cos(th) * rr, sy + Math.sin(th) * rr * 0.5 + rr * 0.12); ctx.stroke(); }
      break; }
    case "dune": {
      // a dune is a long mound lying with the wind, not a disc: body, sunlit
      // flank, then the crest, each one shorter than the last
      const [sx, sy] = R.P(p.x, p.y, z), rr = p.h * 2.1 * R.zoom;
      const a2 = p.r * TAU;
      ctx.fillStyle = shade(p.col, -0.15);
      ctx.beginPath(); ctx.ellipse(sx, sy, rr * 1.55, rr * 0.44, a2, 0, TAU); ctx.fill();
      ctx.fillStyle = shade(p.col, 0.05);
      ctx.beginPath(); ctx.ellipse(sx - rr * 0.16, sy - rr * 0.19, rr * 1.18, rr * 0.29, a2, 0, TAU); ctx.fill();
      ctx.fillStyle = shade(p.col, 0.18);
      ctx.beginPath(); ctx.ellipse(sx - rr * 0.30, sy - rr * 0.33, rr * 0.70, rr * 0.14, a2, 0, TAU); ctx.fill();
      // marram grass along the crest
      ctx.strokeStyle = "#7E9052"; ctx.lineWidth = Math.max(1, R.zoom * 0.12);
      for(let g = 0; g < 7; g++){
        const t2 = (g / 6 - 0.5) * 1.7 * rr;
        const gx = sx - rr * 0.3 + Math.cos(a2) * t2, gy = sy - rr * 0.36 + Math.sin(a2) * t2 * 0.4;
        ctx.beginPath(); ctx.moveTo(gx, gy);
        ctx.lineTo(gx + (g % 2 ? 1.6 : -1.6), gy - rr * 0.16);
        ctx.stroke();
      }
      break; }
    case "grandstand": {
      const w = p.wid || (26 + p.r * 16);
      boxCol(ctx, p.x, p.y, z, w, 11, p.h * 0.78, p.rot, p.col, sun, 0.12, TEX.seats(p.col, night));
      boxCol(ctx, p.x, p.y, z + p.h * 0.78, w, 12, 0.7, p.rot, shade(p.col, -0.28), sun);
      break; }
    case "hotel": case "tower": {
      const w = p.t === "tower" ? 14 + p.r * 16 : 16 + p.r * 22;
      const style = p.t === "tower" ? "glass" : (T.def.facade || "hotel");
      boxFacade(ctx, p.x, p.y, z, w, w * 0.8, p.h, p.rot * 0.2 + p.r, p.col, sun, style, night);
      break; }
    case "yacht": {
      const [a] = [R.P(p.x, p.y, z)];
      boxCol(ctx, p.x, p.y, z - 1.2, 26 + p.r * 18, 7, 3.4, p.rot, p.col, sun, 0.18);
      boxCol(ctx, p.x - 2, p.y, z + 2.2, 11, 5.2, 3.0, p.rot, shade(p.col, -0.06), sun, 0.2);
      boxCol(ctx, p.x - 4, p.y, z + 5.2, 5, 3.4, 2.2, p.rot, "#DCE3E8", sun, 0.2);
      ctx.fillStyle = "rgba(255,255,255,.5)"; ctx.fillRect(a[0] - 1, a[1] - 1, 2, 2);
      break; }
    case "pylon": {
      boxCol(ctx, p.x, p.y, z, 0.6, 0.6, p.h, 0, p.col, sun);
      const [sx, sy] = R.P(p.x, p.y, z + p.h);
      ctx.fillStyle = night ? "#FFF3CE" : "#C9CED4";
      ctx.fillRect(sx - R.zoom * 1.1, sy - R.zoom * 0.5, R.zoom * 2.2, R.zoom * 0.8);
      if(night){ const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, R.zoom * 9);
        g.addColorStop(0, "rgba(255,240,200,.30)"); g.addColorStop(1, "rgba(255,240,200,0)");
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx, sy, R.zoom * 9, 0, TAU); ctx.fill(); }
      break; }
    case "ferris": {
      boxCol(ctx, p.x, p.y, z, 3, 3, p.h * 0.45, 0, "#8A9199", sun);
      const [sx, sy] = R.P(p.x, p.y, z + p.h * 0.72), rr = p.h * 0.40 * R.zoom;
      ctx.strokeStyle = p.col; ctx.lineWidth = Math.max(1.6, R.zoom * 0.4);
      ctx.beginPath(); ctx.ellipse(sx, sy, rr, rr * 0.94, 0, 0, TAU); ctx.stroke();
      const t = S.clock * 0.25;
      for(let a = 0; a < 14; a++){ const th = a / 14 * TAU + t;
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + Math.cos(th) * rr, sy + Math.sin(th) * rr * 0.94); ctx.stroke();
        ctx.fillStyle = a % 2 ? "#F2F2F2" : p.col;
        ctx.beginPath(); ctx.arc(sx + Math.cos(th) * rr, sy + Math.sin(th) * rr * 0.94, Math.max(1.6, R.zoom * 0.42), 0, TAU); ctx.fill(); }
      break; }
    case "stadium": {
      // a ring of seating blocks around the section of track it wraps, tallest
      // at the back, with a gap where the circuit runs in and out
      const rx = 150, ry = 62, segs = 30, ca3 = Math.cos(p.rot), sa3 = Math.sin(p.rot);
      const list = [];
      for(let q = 0; q < segs; q++){
        const th = q / segs * TAU;
        if(Math.abs(Math.sin(th)) < 0.3) continue;                        // open where the track runs in and out
        const lx = Math.cos(th) * rx, ly = Math.sin(th) * ry;
        const cx2 = p.x + lx * ca3 - ly * sa3, cy2 = p.y + lx * sa3 + ly * ca3;
        list.push({ d:fkey(cx2, cy2, z), th, cx2, cy2 });
      }
      list.sort((a, b) => a.d - b.d);
      for(const it of list){
        const tall = p.h * (0.55 + 0.45 * Math.abs(Math.sin(it.th)));
        const rot2 = p.rot + Math.atan2(Math.sin(it.th) * rx, Math.cos(it.th) * ry) + Math.PI / 2;
        boxCol(ctx, it.cx2, it.cy2, z, 30, 16, tall, rot2, p.col, sun, 0.14);
        boxCol(ctx, it.cx2, it.cy2, z + tall, 30, 17, 1.2, rot2, shade(p.col, -0.3), sun, 0.1);
      }
      break; }
    case "neon": {                       // a lit sign column, Strip style
      boxCol(ctx, p.x, p.y, z, 2.2, 2.2, p.h, p.rot, "#22252B", sun, 0.1);
      const cols = ["#FF3D92", "#37D6E8", "#FFC63D", "#B14BF0", "#39FF88"];
      const glows = ["rgba(255,61,146,.30)", "rgba(55,214,232,.30)", "rgba(255,198,61,.30)",
                     "rgba(177,75,240,.30)", "rgba(57,255,136,.28)"];
      const ci = clamp((p.r * cols.length) | 0, 0, cols.length - 1);
      const hue = cols[ci];
      const panels = Math.max(2, Math.round(p.h / 9));
      for(let q = 0; q < panels; q++){
        const zz = z + p.h * 0.25 + q * (p.h * 0.62 / panels);
        boxCol(ctx, p.x, p.y, zz, 8 + p.r * 5, 1.1, p.h * 0.40 / panels, p.rot, hue, sun, 0.5);
      }
      const [nx2, ny2] = R.P(p.x, p.y, z + p.h * 0.62);
      const g = ctx.createRadialGradient(nx2, ny2, 0, nx2, ny2, R.zoom * 16);
      g.addColorStop(0, glows[ci]); g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(nx2, ny2, R.zoom * 16, 0, TAU); ctx.fill();
      break; }
    case "sphere": {                     // the Sphere: the 112m ball, and what it is showing
      if(B3) break;                      // the 3D renderer gives it a real ball
      const [sx2, sy2] = R.P(p.x, p.y, z + p.h * 0.5), rr = p.h * 0.5 * R.zoom;
      const [bx2, by2] = R.P(p.x, p.y, z);
      ctx.fillStyle = "#1A1622"; ctx.beginPath(); ctx.ellipse(bx2, by2, rr * 0.7, rr * 0.3, 0, 0, TAU); ctx.fill();
      const shp = ctx.createRadialGradient(sx2 - rr * 0.35, sy2 - rr * 0.35, rr * 0.1, sx2, sy2, rr);
      shp.addColorStop(0, "#5C5670"); shp.addColorStop(0.7, "#2A2438"); shp.addColorStop(1, "#14111C");
      ctx.fillStyle = shp; ctx.beginPath(); ctx.arc(sx2, sy2, rr, 0, TAU); ctx.fill();
      // the screen wraps the whole surface, so the face fills the disc
      const mode = Math.floor(S.clock / 9) % 3, t2 = S.clock % 9;
      const fade = S.clock < 0.8 ? 1 : t2 < 0.8 ? t2 / 0.8 : t2 > 8.2 ? (9 - t2) / 0.8 : 1;
      ctx.save(); ctx.beginPath(); ctx.arc(sx2, sy2, rr * 0.985, 0, TAU); ctx.clip();
      ctx.globalAlpha = 0.92 * fade;
      if(mode === 0){
        // the yellow emoji
        const yg = ctx.createRadialGradient(sx2 - rr * 0.3, sy2 - rr * 0.3, rr * 0.1, sx2, sy2, rr);
        yg.addColorStop(0, "#FFE566"); yg.addColorStop(0.75, "#FFC400"); yg.addColorStop(1, "#E39A00");
        ctx.fillStyle = yg; ctx.fillRect(sx2 - rr, sy2 - rr, rr * 2, rr * 2);
        const blink = (S.clock % 4) > 3.82;
        ctx.fillStyle = "#3A2A08";
        for(const ex of [-0.34, 0.34]){
          ctx.beginPath();
          if(blink) ctx.ellipse(sx2 + ex * rr, sy2 - rr * 0.18, rr * 0.13, rr * 0.03, 0, 0, TAU);
          else ctx.ellipse(sx2 + ex * rr, sy2 - rr * 0.22, rr * 0.12, rr * 0.17, 0, 0, TAU);
          ctx.fill();
        }
        if(!blink){ ctx.fillStyle = "#FFFFFF"; for(const ex of [-0.34, 0.34]){ ctx.beginPath(); ctx.arc(sx2 + ex * rr - rr * 0.04, sy2 - rr * 0.29, rr * 0.04, 0, TAU); ctx.fill(); } }
        ctx.strokeStyle = "#3A2A08"; ctx.lineWidth = Math.max(2, rr * 0.075); ctx.lineCap = "round";
        ctx.beginPath(); ctx.arc(sx2, sy2 + rr * 0.05, rr * 0.5, 0.25, Math.PI - 0.25); ctx.stroke();
        ctx.fillStyle = "rgba(255,120,120,.5)";
        for(const ex of [-0.6, 0.6]){ ctx.beginPath(); ctx.ellipse(sx2 + ex * rr, sy2 + rr * 0.1, rr * 0.15, rr * 0.09, 0, 0, TAU); ctx.fill(); }
      } else if(mode === 1){
        // the Earth
        const eg = ctx.createRadialGradient(sx2 - rr * 0.3, sy2 - rr * 0.3, rr * 0.1, sx2, sy2, rr);
        eg.addColorStop(0, "#5EB3E8"); eg.addColorStop(0.8, "#1D6FB8"); eg.addColorStop(1, "#0E3E70");
        ctx.fillStyle = eg; ctx.fillRect(sx2 - rr, sy2 - rr, rr * 2, rr * 2);
        const spin = (S.clock * 0.06) % 1;
        ctx.fillStyle = "#3E8A3E";
        for(const [cx5, cy5, w5, h5, rot5] of [[-0.35, -0.25, 0.42, 0.34, 0.4], [0.05, 0.02, 0.22, 0.44, -0.3], [0.45, -0.2, 0.34, 0.26, 0.2], [-0.15, 0.48, 0.26, 0.2, 0.5], [0.4, 0.42, 0.2, 0.14, 0]]){
          const px5 = ((cx5 + spin * 2 + 1) % 2) - 1;
          ctx.beginPath(); ctx.ellipse(sx2 + px5 * rr, sy2 + cy5 * rr, w5 * rr, h5 * rr, rot5, 0, TAU); ctx.fill();
        }
        ctx.fillStyle = "rgba(255,255,255,.55)";
        for(let q19 = 0; q19 < 6; q19++){ const a7 = q19 * 1.1 + S.clock * 0.1;
          ctx.beginPath(); ctx.ellipse(sx2 + Math.cos(a7) * rr * 0.55, sy2 + Math.sin(a7) * rr * 0.55, rr * 0.22, rr * 0.06, a7, 0, TAU); ctx.fill(); }
      } else {
        // fireworks over the Strip's colours
        ctx.fillStyle = "#0B0A1E"; ctx.fillRect(sx2 - rr, sy2 - rr, rr * 2, rr * 2);
        const cols3 = ["#FF3D92", "#37D6E8", "#FFC63D", "#B14BF0", "#39FF88"];
        for(let b = 0; b < 4; b++){
          const life = ((S.clock * 0.7 + b * 0.37) % 1), bx3 = sx2 + Math.sin(b * 2.1) * rr * 0.45, by3 = sy2 + Math.cos(b * 1.7) * rr * 0.4;
          ctx.fillStyle = cols3[b % 5]; ctx.globalAlpha = 0.92 * fade * (1 - life);
          for(let q20 = 0; q20 < 12; q20++){ const a8 = q20 / 12 * TAU; const rad8 = life * rr * 0.55;
            ctx.beginPath(); ctx.arc(bx3 + Math.cos(a8) * rad8, by3 + Math.sin(a8) * rad8, Math.max(1.2, rr * 0.035), 0, TAU); ctx.fill(); }
        }
      }
      ctx.restore(); ctx.globalAlpha = 1;
      const rim = ctx.createRadialGradient(sx2, sy2, rr * 0.8, sx2, sy2, rr);
      rim.addColorStop(0, "rgba(0,0,0,0)"); rim.addColorStop(1, "rgba(0,0,0,.45)");
      ctx.fillStyle = rim; ctx.beginPath(); ctx.arc(sx2, sy2, rr, 0, TAU); ctx.fill();
      const gcol = mode === 0 ? "rgba(255,200,60,.28)" : mode === 1 ? "rgba(80,160,255,.26)" : "rgba(200,90,255,.24)";
      const g2 = ctx.createRadialGradient(sx2, sy2, rr * 0.9, sx2, sy2, rr * 2.4);
      g2.addColorStop(0, gcol); g2.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g2; ctx.beginPath(); ctx.arc(sx2, sy2, rr * 2.4, 0, TAU); ctx.fill();
      break; }
    case "lm": {
      const sc = p.h / 100;
      const LM_STYLE = { casino:"stone", hotelparis:"stone", fairmont:"stone", rascasse:"stucco", fullerton:"stone",
        govhouse:"sand", flame:"glass", mbs:"glass", cosmopolitan:"glass", aria:"glass", wynn:"glass", planethollywood:"glass",
        venetian:"stucco", palazzo:"stucco", caesars:"stone", bellagio:"stucco", mgm:"glass", nyny:"concrete", excalibur:"stone",
        harrahs:"glass", horseshoe:"concrete", flamingo:"hotel", treasure:"hotel", villareale:"stucco", brdc:"concrete",
        resorts:"led", circus:"hotel", strat:"concrete", pitbuilding:"concrete", vegaspit:"concrete", mirage:"glass" };                                  // every one is authored at 100m tall
      const A = p.rot + (p.k === "eiffel" ? 0 : 0);
      // lit windows on a slab, the way the generic hotels get them
      // a landmark's wall: its own facade style, or the circuit's
      const win = (bx, by, bz, l, w, hh, rot, col, dens, style) => {
        boxFacade(ctx, bx, by, bz, l, w, hh, rot, col, sun, style || LM_STYLE[p.k] || T.def.facade || "hotel", night);
      };
      const glow = (gx, gy, gz, rad, col) => {
        if(!night) return;
        const [ax, ay] = R.P(gx, gy, gz), rr = rad * R.zoom;
        const g = ctx.createRadialGradient(ax, ay, 0, ax, ay, rr);
        g.addColorStop(0, col); g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(ax, ay, rr, 0, TAU); ctx.fill();
      };
      const off = (fx, fy) => [p.x + fx * Math.cos(A) - fy * Math.sin(A),
                               p.y + fx * Math.sin(A) + fy * Math.cos(A)];
      // unit vector from the building towards the circuit, and the one across it
      const T3 = S.track, nj = T3.near(p.x, p.y);
      let rdx = T3.x[nj] - p.x, rdy = T3.y[nj] - p.y;
      const rl = Math.hypot(rdx, rdy) || 1; rdx /= rl; rdy /= rl;
      // front(d, l): d metres towards the road, l metres along the frontage
      const front = (d, l) => [p.x + rdx * d - rdy * l, p.y + rdy * d + rdx * l];
      const frontAng = Math.atan2(rdy, rdx);
      switch(p.k){

      case "luxor": {           // the black glass pyramid, the sphinx, and the beam
        pyramid(ctx, p.x, p.y, z, 52 * sc, p.h, A, "#171A22", sun);
        const [sxp, syp] = R.P(p.x, p.y, z + p.h);
        if(night){
          const [bxp, byp] = R.P(p.x, p.y, z + p.h + 420 * sc);
          const g = ctx.createLinearGradient(sxp, syp, bxp, byp);
          g.addColorStop(0, "rgba(220,240,255,.55)"); g.addColorStop(1, "rgba(220,240,255,0)");
          ctx.strokeStyle = g; ctx.lineWidth = Math.max(2, 5 * sc * R.zoom); ctx.lineCap = "round";
          ctx.beginPath(); ctx.moveTo(sxp, syp); ctx.lineTo(bxp, byp); ctx.stroke();
          glow(p.x, p.y, z + p.h, 30 * sc, "rgba(210,235,255,.30)");
        }
        boxCol(ctx, ...front(64 * sc, 0), z, 26 * sc, 16 * sc, 20 * sc, frontAng, "#C9A76A", sun, 0.18);
        boxCol(ctx, ...front(72 * sc, 0), z + 20 * sc, 9 * sc, 9 * sc, 12 * sc, frontAng, "#D8B879", sun, 0.2);
        break; }

      case "excalibur": {       // the castle, turrets in red, blue and gold
        win(p.x, p.y, z, 58 * sc, 44 * sc, p.h * 0.62, A, "#E6E2D6", 0.5);
        const tc = ["#D8352A", "#2B6FD8", "#E8B33D", "#D8352A"];
        let q = 0;
        for(const [dx, dy] of [[26, 20], [26, -20], [-26, -20], [-26, 20]]){
          const [tx, ty] = off(dx * sc, dy * sc);
          boxCol(ctx, tx, ty, z, 13 * sc, 13 * sc, p.h * 0.78, A, "#EFEBE0", sun, 0.2);
          pyramid(ctx, tx, ty, z + p.h * 0.78, 8 * sc, p.h * 0.34, A, tc[q++], sun);
        }
        const [cx2, cy2] = off(0, 0);
        boxCol(ctx, cx2, cy2, z + p.h * 0.62, 18 * sc, 18 * sc, p.h * 0.26, A, "#EFEBE0", sun, 0.2);
        pyramid(ctx, cx2, cy2, z + p.h * 0.88, 11 * sc, p.h * 0.40, A, "#2B6FD8", sun);
        break; }

      case "nyny": {            // the skyline cluster and the red coaster
        const spec = [[-30,-16,0.82,"#8E9AA8"], [-8,-22,0.66,"#7E8A98"], [14,-12,1.0,"#96A2AE"],
                      [30,10,0.58,"#8894A2"], [4,18,0.74,"#8E9AA8"], [-26,22,0.50,"#7E8A98"]];
        for(const [dx, dy, hh, c2] of spec){
          const [tx, ty] = off(dx * sc, dy * sc);
          win(tx, ty, z, 20 * sc, 20 * sc, p.h * hh, A, c2, 0.42);
        }
        const [ax, ay] = off(14 * sc, -12 * sc);
        boxCol(ctx, ax, ay, z + p.h, 3 * sc, 3 * sc, p.h * 0.22, A, "#C8D0D8", sun, 0.2);
        // the Statue of Liberty on the corner, torch up
        boxCol(ctx, ...front(52 * sc, 20 * sc), z, 10 * sc, 10 * sc, 14 * sc, frontAng, "#8A9AA8", sun, 0.16);
        boxCol(ctx, ...front(52 * sc, 20 * sc), z + 14 * sc, 4.6 * sc, 4.6 * sc, 22 * sc, frontAng, "#5FA48E", sun, 0.26);
        boxCol(ctx, ...front(53.5 * sc, 21.5 * sc), z + 34 * sc, 1.2 * sc, 1.2 * sc, 9 * sc, frontAng, "#5FA48E", sun, 0.26);
        glow(...front(53.5 * sc, 21.5 * sc), z + 44 * sc, 8 * sc, "rgba(255,210,120,.5)");
        // the rollercoaster, looped round the outside
        const [lx, ly] = R.P(...front(40 * sc, 0), z + p.h * 0.34);
        ctx.strokeStyle = "#E03C31"; ctx.lineWidth = Math.max(1.4, R.zoom * 0.34 * sc * 3);
        ctx.beginPath(); ctx.ellipse(lx, ly, 26 * sc * R.zoom * 0.9, 17 * sc * R.zoom * 0.9, 0.25, 0, TAU); ctx.stroke();
        break; }

      case "eiffel": {          // the half-scale tower, with the arch under it
        // the legs splay out from the first platform and land on four corners
        const IR = "#6E5F48", IL = "#8A7A5E";
        for(const [ex, ey] of [[1,1],[1,-1],[-1,-1],[-1,1]]){
          // a stack of short members, each overlapping the one below, so the
          // staircase reads as one leaning leg
          for(let seg = 0; seg < 10; seg++){
            const t0 = seg / 10;
            const rm = 24 - 17.5 * t0;                          // 24m out at the foot, 6.5m at the platform
            const [gx2, gy2] = off(ex * rm * sc, ey * rm * sc);
            const thick = (5.6 - 1.8 * t0) * sc;
            boxCol(ctx, gx2, gy2, z + p.h * 0.30 * t0, thick, thick,
                   p.h * 0.30 / 10 * 2.0, A + 0.78 * ex * ey, IR, sun, 0.16);
          }
        }
        // the arches between the feet
        for(const [ax2, ay2, rot2] of [[0, 24, 0], [0, -24, 0], [24, 0, 1], [-24, 0, 1]]){
          const [bx3, by3] = off(ax2 * sc, ay2 * sc);
          boxCol(ctx, bx3, by3, z + p.h * 0.155, rot2 ? 4 * sc : 40 * sc, rot2 ? 40 * sc : 4 * sc,
                 p.h * 0.035, A, IR, sun, 0.16);
        }
        win(p.x, p.y, z + p.h * 0.285, 20 * sc, 20 * sc, p.h * 0.055, A, IL, 0.62);
        // the shaft, narrowing all the way up
        for(let seg = 0; seg < 7; seg++){
          const t0 = seg / 7;
          const wdt = (13 - 8.4 * t0) * sc;
          boxCol(ctx, p.x, p.y, z + p.h * (0.34 + 0.30 * t0), wdt, wdt, p.h * 0.30 / 7 * 1.2, A, IR, sun, 0.16);
        }
        win(p.x, p.y, z + p.h * 0.645, 11 * sc, 11 * sc, p.h * 0.045, A, IL, 0.58);
        for(let seg = 0; seg < 6; seg++){
          const t0 = seg / 6;
          const wdt = (6.4 - 3.6 * t0) * sc;
          boxCol(ctx, p.x, p.y, z + p.h * (0.69 + 0.22 * t0), wdt, wdt, p.h * 0.22 / 6 * 1.2, A, IR, sun, 0.16);
        }
        win(p.x, p.y, z + p.h * 0.912, 6.4 * sc, 6.4 * sc, p.h * 0.038, A, "#9A8A66", 0.32);
        boxCol(ctx, p.x, p.y, z + p.h * 0.95, 1.5 * sc, 1.5 * sc, p.h * 0.09, A, "#9A8A66", sun, 0.2);
        glow(p.x, p.y, z + p.h * 1.03, 15 * sc, "rgba(255,206,120,.5)");
        // the little Arc de Triomphe out front, and the balloon sign
        const [gx, gy] = front(56 * sc, 22 * sc);
        boxCol(ctx, gx, gy, z, 20 * sc, 20 * sc, 22 * sc, frontAng, "#D8C8A4", sun, 0.2);
        const [bpx, bpy] = front(52 * sc, -30 * sc);
        boxCol(ctx, bpx, bpy, z, 1.4 * sc, 1.4 * sc, 26 * sc, frontAng, "#8A8A8A", sun, 0.2);
        const [bsx, bsy] = R.P(bpx, bpy, z + 40 * sc), brr = 13 * sc * R.zoom;
        for(let q24 = 0; q24 < 6; q24++){ ctx.fillStyle = q24 % 2 ? "#2B4C9B" : "#E8B33D";
          ctx.beginPath(); ctx.ellipse(bsx, bsy, brr * (1 - q24 * 0.15), brr * 1.15 * (1 - q24 * 0.15), 0, 0, TAU); ctx.fill(); }
        ctx.fillStyle = "#D8352A"; ctx.beginPath(); ctx.ellipse(bsx, bsy + brr * 1.3, brr * 0.5, brr * 0.28, 0, 0, TAU); ctx.fill();
        glow(bpx, bpy, z + 40 * sc, 22 * sc, "rgba(255,200,120,.3)");
        break; }

      case "bellagio": {        // the curved tower above the fountain lake
        groundEllipse(ctx, ...front(62 * sc, 0), z + 0.05, 60 * sc, 25 * sc, frontAng, night ? "#16304A" : "#2E6E9E");
        // the fountains, going up
        ctx.strokeStyle = night ? "rgba(220,240,255,.75)" : "rgba(255,255,255,.7)";
        for(let q2 = 0; q2 < 9; q2++){
          const t2 = (S.clock * 0.9 + q2 * 0.7) % 3;
          const hgt = Math.sin(Math.min(t2, 1.6) / 1.6 * Math.PI) * 34 * sc;
          if(hgt <= 0.5) continue;
          const [jx, jy] = front((58 + (q2 % 2 ? 8 : -8)) * sc, (q2 - 4) * 13 * sc);
          const [j0x, j0y] = R.P(jx, jy, z);
          const [j1x, j1y] = R.P(jx, jy, z + hgt);
          ctx.lineWidth = Math.max(1, R.zoom * 0.3);
          ctx.beginPath(); ctx.moveTo(j0x, j0y); ctx.lineTo(j1x, j1y); ctx.stroke();
        }
        for(const dy of [-34, 0, 34]){
          const [tx, ty] = off(0, dy * sc);
          win(tx, ty, z, 26 * sc, 20 * sc, p.h * (dy === 0 ? 1 : 0.86), A + dy * 0.004, "#DCD3BE", 0.4);
        }
        break; }

      case "caesars": {         // white towers over a columned frontage
        for(const [dx, dy, hh] of [[0, -30, 0.92], [6, 0, 1.0], [0, 30, 0.88]]){
          const [tx, ty] = off(dx * sc, dy * sc);
          win(tx, ty, z, 22 * sc, 26 * sc, p.h * hh, A, "#EDE8DC", 0.42);
        }
        const [fx2, fy2] = front(46 * sc, 0);
        boxCol(ctx, fx2, fy2, z, 16 * sc, 76 * sc, 16 * sc, frontAng, "#F2EEE4", sun, 0.22);
        for(let q3 = -3; q3 <= 3; q3++){
          const [cx3, cy3] = front(54 * sc, q3 * 11 * sc);
          boxCol(ctx, cx3, cy3, z, 3.4 * sc, 3.4 * sc, 20 * sc, frontAng, "#FAF7EF", sun, 0.24);
        }
        glow(fx2, fy2, z + 18 * sc, 26 * sc, "rgba(255,225,170,.34)");
        // the fountain on the forecourt and the statues round it
        groundEllipse(ctx, ...front(74 * sc, 0), z + 0.05, 16 * sc, 7 * sc, frontAng, night ? "#16304A" : "#2E6E9E");
        boxCol(ctx, ...front(74 * sc, 0), z, 3 * sc, 3 * sc, 9 * sc, frontAng, "#EDE9E0", sun, 0.3);
        for(let q23 = -2; q23 <= 2; q23++){ if(!q23) continue;
          boxCol(ctx, ...front(66 * sc, q23 * 9 * sc), z, 2.2 * sc, 2.2 * sc, 3 * sc, frontAng, "#EDE9E0", sun, 0.3);
          boxCol(ctx, ...front(66 * sc, q23 * 9 * sc), z + 3 * sc, 1.4 * sc, 1.4 * sc, 4 * sc, frontAng, "#F6F4EC", sun, 0.34); }
        break; }

      case "venetian": {        // the campanile beside the hotel
        win(p.x, p.y, z, 40 * sc, 30 * sc, p.h * 0.80, A, "#E4D8BE", 0.42);
        const [tx, ty] = off(-44 * sc, -18 * sc);
        boxCol(ctx, tx, ty, z, 12 * sc, 12 * sc, p.h * 0.92, A, "#C9A36E", sun, 0.2);
        boxCol(ctx, tx, ty, z + p.h * 0.92, 14 * sc, 14 * sc, p.h * 0.07, A, "#DCC08E", sun, 0.24);
        pyramid(ctx, tx, ty, z + p.h * 0.99, 7 * sc, p.h * 0.26, A, "#2E6E5E", sun);
        const [bx2, by2] = front(40 * sc, 0);
        boxCol(ctx, bx2, by2, z, 14 * sc, 52 * sc, 11 * sc, frontAng, "#E4D8BE", sun, 0.2);
        // the canal with the Rialto bridge over it
        groundEllipse(ctx, ...front(52 * sc, 0), z + 0.05, 5 * sc, 30 * sc, frontAng, night ? "#16304A" : "#2E6E9E");
        boxCol(ctx, ...front(52 * sc, 0), z + 2.5 * sc, 14 * sc, 6 * sc, 1.2 * sc, frontAng, "#F2ECDC", sun, 0.3);
        for(const ex2 of [-6, 6]) boxCol(ctx, ...front(52 * sc, ex2 * sc), z, 3 * sc, 3 * sc, 2.5 * sc, frontAng, "#E4DCC8", sun, 0.24);
        // the canal arcade along the front
        for(let q5 = -2; q5 <= 2; q5++){
          const [ax3, ay3] = front(33 * sc, q5 * 12 * sc);
          boxCol(ctx, ax3, ay3, z, 3 * sc, 3 * sc, 13 * sc, frontAng, "#EFE6CF", sun, 0.24);
        }
        break; }

      case "wynn": {            // two bronze curves, side by side
        for(const dy of [-26, 26]){
          const [tx, ty] = off(dy * 0.18 * sc, dy * sc);
          win(tx, ty, z, 18 * sc, 46 * sc, p.h * (dy < 0 ? 1 : 0.9), A + dy * 0.006, "#8E6A2E", 0.4);
        }
        glow(p.x, p.y, z + p.h * 0.5, 40 * sc, "rgba(255,190,90,.22)");
        break; }

      case "mgm": {             // the green box and its gold crown
        win(p.x, p.y, z, 54 * sc, 44 * sc, p.h * 0.9, A, "#1E6E4A", 0.5);
        boxCol(ctx, p.x, p.y, z + p.h * 0.9, 58 * sc, 48 * sc, p.h * 0.12, A, "#D8B33D", sun, 0.26);
        const [lx2, ly2] = front(44 * sc, 0);
        boxCol(ctx, lx2, ly2, z, 10 * sc, 10 * sc, 16 * sc, A, "#C9A227", sun, 0.24);
        boxCol(ctx, lx2, ly2, z + 16 * sc, 13 * sc, 8 * sc, 9 * sc, A, "#E8C64F", sun, 0.26);
        glow(lx2, ly2, z + 20 * sc, 20 * sc, "rgba(255,210,90,.34)");
        break; }

      case "flamingo": {        // pink slab, neon plume up the side
        win(p.x, p.y, z, 40 * sc, 26 * sc, p.h, A, "#D8547E", 0.46);
        if(night){
          const [nx2, ny2] = off(-22 * sc, 0);
          ctx.strokeStyle = "#FF5FA8"; ctx.lineWidth = Math.max(1.6, R.zoom * 0.5 * sc * 3);
          for(let q4 = 0; q4 < 4; q4++){
            const [a0x, a0y] = R.P(nx2, ny2, z + 6 * sc + q4 * 18 * sc);
            const [a1x, a1y] = R.P(nx2, ny2, z + 20 * sc + q4 * 18 * sc);
            ctx.beginPath(); ctx.moveTo(a0x, a0y); ctx.lineTo(a1x + q4 * 3, a1y); ctx.stroke();
          }
          glow(nx2, ny2, z + p.h * 0.5, 26 * sc, "rgba(255,95,168,.34)");
        }
        break; }

      case "strat": {           // the needle, and the pod near the top
        boxCol(ctx, p.x, p.y, z, 16 * sc, 16 * sc, p.h * 0.12, A, "#C9C3B4", sun, 0.2);
        boxCol(ctx, p.x, p.y, z + p.h * 0.12, 7 * sc, 7 * sc, p.h * 0.62, A, "#DCD6C6", sun, 0.18);
        win(p.x, p.y, z + p.h * 0.74, 17 * sc, 17 * sc, p.h * 0.10, A, "#E6E0D0", 0.2);
        boxCol(ctx, p.x, p.y, z + p.h * 0.84, 11 * sc, 11 * sc, p.h * 0.05, A, "#D0CABA", sun, 0.2);
        boxCol(ctx, p.x, p.y, z + p.h * 0.89, 2.6 * sc, 2.6 * sc, p.h * 0.18, A, "#B8B2A2", sun, 0.16);
        glow(p.x, p.y, z + p.h * 0.78, 26 * sc, "rgba(255,225,170,.4)");
        break; }

      case "circus": {          // the big top
        win(p.x, p.y, z, 46 * sc, 34 * sc, p.h * 0.5, A, "#D8547E", 0.5);
        const [tx2, ty2] = front(44 * sc, 0);
        boxCol(ctx, tx2, ty2, z, 34 * sc, 34 * sc, 14 * sc, frontAng, "#F0E6E9", sun, 0.2);
        pyramid(ctx, tx2, ty2, z + 14 * sc, 21 * sc, 34 * sc, A, "#E0456F", sun);
        glow(tx2, ty2, z + 30 * sc, 24 * sc, "rgba(255,120,170,.3)");
        break; }

      case "resorts": {         // the enormous LED frontage
        win(p.x, p.y, z, 40 * sc, 58 * sc, p.h, A, "#2A2438", 0.6);
        if(night){
          const [ex, ey] = off(-21 * sc, 0);
          const cyc = ["#E03C5A", "#37D6E8", "#B14BF0", "#FFC63D"][Math.floor(S.clock * 0.5) % 4];
          boxCol(ctx, ex, ey, z + p.h * 0.28, 1.5 * sc, 54 * sc, p.h * 0.62, A, cyc, sun, 0.3);
          glow(ex, ey, z + p.h * 0.6, 46 * sc, "rgba(224,60,90,.26)");
        }
        break; }

      case "aria": {            // dark glass, two curved slabs
        for(const [dx, dy, hh, rr] of [[0, -22, 1.0, 0.05], [10, 16, 0.84, -0.06]]){
          const [tx, ty] = off(dx * sc, dy * sc);
          win(tx, ty, z, 20 * sc, 40 * sc, p.h * hh, A + rr, "#2E3A48", 0.5);
        }
        break; }


      case "casino": {          // Casino de Monte-Carlo: cream belle-époque, green copper roofs
        win(p.x, p.y, z, 62 * sc, 34 * sc, p.h * 0.55, A, "#EADFC8", 0.7);
        for(const dy of [-22, 22]){
          const [tx, ty] = off(6 * sc, dy * sc);
          boxCol(ctx, tx, ty, z + p.h * 0.55, 14 * sc, 14 * sc, p.h * 0.22, A, "#EADFC8", sun, 0.24);
          pyramid(ctx, tx, ty, z + p.h * 0.77, 8.5 * sc, p.h * 0.20, A, "#3E8A6E", sun);
        }
        boxCol(ctx, p.x, p.y, z + p.h * 0.55, 18 * sc, 18 * sc, p.h * 0.10, A, "#EADFC8", sun, 0.24);
        pyramid(ctx, p.x, p.y, z + p.h * 0.65, 11 * sc, p.h * 0.30, A, "#3E8A6E", sun);
        // Place du Casino: the oval garden and the fountain
        groundEllipse(ctx, ...front(48 * sc, 0), z + 0.05, 30 * sc, 14 * sc, frontAng, "#6E9A52");
        groundEllipse(ctx, ...front(48 * sc, 0), z + 0.08, 8 * sc, 4 * sc, frontAng, "#3E8CC4");
        break; }

      case "hotelparis": {      // the Hôtel de Paris: cream, mansard roof, flags
        win(p.x, p.y, z, 54 * sc, 30 * sc, p.h * 0.8, A, "#F0E7D2", 0.6);
        boxCol(ctx, p.x, p.y, z + p.h * 0.8, 50 * sc, 26 * sc, p.h * 0.18, A, "#4A4E58", sun, 0.16);
        for(const dy of [-18, 0, 18]){
          const [fx3, fy3] = off(24 * sc, dy * sc);
          boxCol(ctx, fx3, fy3, z + p.h * 0.98, 0.6 * sc, 0.6 * sc, 8 * sc, A, "#C8C8C8", sun, 0.2);
          boxCol(ctx, fx3 + 1, fy3, z + p.h * 0.98 + 5.5 * sc, 4 * sc, 0.3 * sc, 2.4 * sc, A, dy ? "#D8352A" : "#F2F2F2", sun, 0.3);
        }
        break; }

      case "fairmont": {        // the Fairmont: broad terraces stepping down to the sea
        win(p.x, p.y, z, 96 * sc, 54 * sc, p.h * 0.5, A, "#E8DCC4", 0.6);
        win(...off(-8 * sc, 0), z + p.h * 0.5, 74 * sc, 40 * sc, p.h * 0.32, A, "#E0D2B8", 0.6);
        boxCol(ctx, ...off(-8 * sc, 0), z + p.h * 0.82, 60 * sc, 30 * sc, p.h * 0.05, A, "#E8DCC4", sun, 0.26);
        const [px2, py2] = R.P(...off(-10 * sc, 0), z + p.h * 0.87);
        ctx.fillStyle = "#3E9CD8"; ctx.beginPath(); ctx.ellipse(px2, py2, 16 * sc * R.zoom, 7 * sc * R.zoom, A, 0, TAU); ctx.fill();
        break; }

      case "palace": {          // the Prince's Palace up on the Rock
        pyramid(ctx, p.x, p.y, z - 2, 90 * sc, p.h * 0.55, A, "#B6A88E", sun);
        boxCol(ctx, p.x, p.y, z + p.h * 0.52, 70 * sc, 40 * sc, p.h * 0.30, A, "#E9D7B8", sun, 0.22);
        boxCol(ctx, ...off(22 * sc, 12 * sc), z + p.h * 0.82, 12 * sc, 12 * sc, p.h * 0.22, A, "#E2CFAE", sun, 0.24);
        for(let q6 = 0; q6 < 4; q6++) boxCol(ctx, ...off((22 + (q6 % 2 ? 4 : -4)) * sc, (12 + (q6 < 2 ? 4 : -4)) * sc), z + p.h * 1.04, 2.4 * sc, 2.4 * sc, 2.2 * sc, A, "#E2CFAE", sun, 0.24);
        boxCol(ctx, ...off(22 * sc, 12 * sc), z + p.h * 1.04, 0.5 * sc, 0.5 * sc, 9 * sc, A, "#C8C8C8", sun, 0.2);
        boxCol(ctx, ...off(23 * sc, 12 * sc), z + p.h * 1.04 + 6 * sc, 4 * sc, 0.3 * sc, 2.6 * sc, A, "#D8352A", sun, 0.3);
        break; }

      case "piscine": {         // the Rainier III pool, and the stand looking over it
        groundEllipse(ctx, p.x, p.y, z + 0.03, 34 * sc, 22 * sc, A, "#EDE9E0");
        poly(ctx, [[-25, -11], [25, -11], [25, 11], [-25, 11]].map(q => R.P(...off(q[0] * sc, q[1] * sc), z + 0.05)), "#2E8CD0");
        poly(ctx, [[-25, 6], [25, 6], [25, 11], [-25, 11]].map(q => R.P(...off(q[0] * sc, q[1] * sc), z + 0.08)), "#5AB0E8");
        boxCol(ctx, ...off(0, -30 * sc), z, 60 * sc, 12 * sc, 10 * sc, A, "#B9BFC6", sun, 0.14);
        boxCol(ctx, ...off(0, -36 * sc), z + 10 * sc, 60 * sc, 6 * sc, 6 * sc, A, "#A3AAB2", sun, 0.14);
        break; }

      case "rascasse": {        // the restaurant on the corner, awnings out
        win(p.x, p.y, z, 22 * sc, 16 * sc, p.h * 0.7, A, "#E2C8A6", 0.7);
        boxCol(ctx, p.x, p.y, z + p.h * 0.7, 20 * sc, 14 * sc, p.h * 0.1, A, "#B85A3C", sun, 0.2);
        boxCol(ctx, ...front(10 * sc, 0), z + p.h * 0.36, 4 * sc, 18 * sc, 0.6 * sc, frontAng, "#D8352A", sun, 0.3);
        break; }

      case "mbs": {             // Marina Bay Sands: three towers, the SkyPark on top
        for(const dy of [-66, 0, 66]){
          const [tx, ty] = off(dy * 0.08 * sc, dy * sc);
          win(tx, ty, z, 26 * sc, 46 * sc, p.h * 0.9, A + dy * 0.0012, "#C8CDD6", 0.35);
        }
        boxCol(ctx, ...off(-2 * sc, 0), z + p.h * 0.9, 34 * sc, 200 * sc, p.h * 0.05, A, "#E8E3D4", sun, 0.3);
        boxCol(ctx, ...off(-2 * sc, 0), z + p.h * 0.95, 30 * sc, 190 * sc, p.h * 0.02, A, "#3E9CD8", sun, 0.3);
        glow(...off(0, 0), z + p.h * 0.97, 60 * sc, "rgba(255,230,190,.28)");
        break; }

      case "esplanade": {       // the two spiked domes
        for(const dy of [-30, 30]){
          const [tx, ty] = off(0, dy * sc);
          boxCol(ctx, tx, ty, z, 50 * sc, 46 * sc, 10 * sc, A, "#6B7078", sun, 0.16);
          const [dx2, dy2] = R.P(tx, ty, z + 10 * sc), rr2 = 24 * sc * R.zoom;
          for(let q7 = 0; q7 < 4; q7++){
            ctx.fillStyle = shade("#8A9AA8", -0.05 + q7 * 0.07);
            ctx.beginPath(); ctx.ellipse(dx2, dy2 - rr2 * 0.32 * q7 * 0.7, rr2 * (1 - q7 * 0.22), rr2 * 0.42 * (1 - q7 * 0.22), 0, 0, TAU); ctx.fill();
          }
          ctx.fillStyle = "#3A4048";
          for(let q8 = 0; q8 < 34; q8++){
            const a3 = q8 / 34 * TAU, rr3 = rr2 * (0.55 + 0.35 * ((q8 * 7) % 3) / 2);
            ctx.fillRect(dx2 + Math.cos(a3) * rr3 - 1, dy2 - rr2 * 0.3 + Math.sin(a3) * rr3 * 0.42 - 2, 2, 3);
          }
        }
        break; }

      case "fullerton": {       // the old GPO: white, colonnaded, flat roof
        win(p.x, p.y, z, 86 * sc, 44 * sc, p.h * 0.85, A, "#EEEBE2", 0.7);
        for(let q9 = -5; q9 <= 5; q9++) boxCol(ctx, ...front(24 * sc, q9 * 7.5 * sc), z + p.h * 0.18, 2.6 * sc, 2.6 * sc, p.h * 0.6, frontAng, "#F6F4EC", sun, 0.26);
        boxCol(ctx, ...front(24 * sc, 0), z + p.h * 0.78, 4 * sc, 84 * sc, p.h * 0.1, frontAng, "#E4E0D4", sun, 0.24);
        glow(p.x, p.y, z + p.h * 0.5, 40 * sc, "rgba(255,225,170,.28)");
        break; }

      case "merlion": {         // the Merlion, spouting into the bay
        boxCol(ctx, p.x, p.y, z, 6 * sc, 6 * sc, 4 * sc, A, "#C8CDD3", sun, 0.2);
        boxCol(ctx, p.x, p.y, z + 4 * sc, 3.2 * sc, 3.2 * sc, p.h * 0.8, A, "#F0F0EC", sun, 0.3);
        boxCol(ctx, ...front(1.6 * sc, 0), z + p.h * 0.72, 3.4 * sc, 3.0 * sc, 2.8 * sc, frontAng, "#F0F0EC", sun, 0.3);
        const [s0x, s0y] = R.P(...front(3.2 * sc, 0), z + p.h * 0.76), [s1x, s1y] = R.P(...front(11 * sc, 0), z + 1);
        ctx.strokeStyle = "rgba(220,240,255,.8)"; ctx.lineWidth = Math.max(1, R.zoom * 0.25);
        ctx.beginPath(); ctx.moveTo(s0x, s0y); ctx.quadraticCurveTo((s0x + s1x) / 2, s0y - R.zoom * 3 * sc, s1x, s1y); ctx.stroke();
        break; }

      case "artscience": {      // the lotus: a dish with petals standing up out of it
        boxCol(ctx, p.x, p.y, z, 40 * sc, 40 * sc, 6 * sc, A, "#B8C2CC", sun, 0.18);
        for(let q10 = 0; q10 < 10; q10++){
          const a4 = q10 / 10 * TAU, rr4 = 15 * sc;
          pyramid(ctx, p.x + Math.cos(a4) * rr4, p.y + Math.sin(a4) * rr4, z + 6 * sc, 5 * sc, p.h * (0.5 + 0.5 * (q10 % 2)), a4, "#E8ECF0", sun);
        }
        break; }

      case "floatstand": {      // the Float at Marina Bay: the platform and the stand behind it
        boxCol(ctx, ...front(36 * sc, 0), z - 0.6, 70 * sc, 110 * sc, 1.2, frontAng, "#6E7680", sun, 0.1);
        boxCol(ctx, p.x, p.y, z, 40 * sc, 150 * sc, p.h * 0.7, A, p.col, sun, 0.14);
        boxCol(ctx, ...off(4 * sc, 0), z + p.h * 0.7, 46 * sc, 156 * sc, p.h * 0.06, A, shade(p.col, -0.3), sun, 0.1);
        glow(p.x, p.y, z + p.h * 0.5, 50 * sc, "rgba(255,235,200,.22)");
        break; }

      case "flame": {           // the Flame Towers, three glass flames up on the hill
        for(const [dx, dy, hh] of [[0, 0, 1.0], [-30, 34, 0.86], [28, 38, 0.82]]){
          const [tx, ty] = off(dx * sc, dy * sc);
          win(tx, ty, z, 26 * sc, 22 * sc, p.h * hh * 0.8, A + 0.4, "#4F7FB0", 0.5);
          pyramid(ctx, tx, ty, z + p.h * hh * 0.8, 12 * sc, p.h * hh * 0.28, A + 0.4, "#6A96C4", sun);
          if(night) glow(tx, ty, z + p.h * hh * 0.6, 34 * sc, "rgba(255,120,40,.35)");
        }
        break; }

      case "maiden": {          // the Maiden Tower and the wall it stands in
        boxCol(ctx, p.x, p.y, z, 13 * sc, 13 * sc, p.h * 0.9, A + 0.4, "#CDB994", sun, 0.16);
        boxCol(ctx, p.x, p.y, z, 11 * sc, 11 * sc, p.h * 0.94, A + 0.8, "#C6B28C", sun, 0.16);
        boxCol(ctx, p.x, p.y, z + p.h * 0.94, 14 * sc, 14 * sc, 2 * sc, A + 0.4, "#B8A47E", sun, 0.16);
        break; }

      case "citywall": {        // a run of the old city wall, crenellated
        boxCol(ctx, p.x, p.y, z, 70 * sc, 4 * sc, p.h * 0.8, A, "#D3C09C", sun, 0.16);
        for(let q11 = -6; q11 <= 6; q11++) boxCol(ctx, ...off(q11 * 5.2 * sc, 0), z + p.h * 0.8, 2.4 * sc, 4.4 * sc, p.h * 0.2, A, "#D3C09C", sun, 0.16);
        boxCol(ctx, ...off(34 * sc, 0), z, 9 * sc, 9 * sc, p.h * 1.25, A, "#C9B58E", sun, 0.16);
        break; }

      case "govhouse": {        // Government House: the long arcaded front
        win(p.x, p.y, z, 40 * sc, 170 * sc, p.h * 0.75, A, "#D9C9A5", 0.75);
        for(let q12 = -7; q12 <= 7; q12++) boxCol(ctx, ...front(21 * sc, q12 * 11 * sc), z + p.h * 0.05, 2 * sc, 4 * sc, p.h * 0.5, frontAng, "#8A7452", sun, 0.1);
        for(let q13 = -3; q13 <= 3; q13++) boxCol(ctx, ...off(0, q13 * 26 * sc), z + p.h * 0.75, 12 * sc, 12 * sc, p.h * 0.2, A, "#D9C9A5", sun, 0.2);
        boxCol(ctx, p.x, p.y, z + p.h * 0.95, 14 * sc, 14 * sc, p.h * 0.18, A, "#D9C9A5", sun, 0.2);
        pyramid(ctx, p.x, p.y, z + p.h * 1.13, 8 * sc, p.h * 0.16, A, "#6E7C86", sun);
        break; }

      case "carpet": {          // the Carpet Museum, rolled up on the seafront
        boxCol(ctx, p.x, p.y, z, 70 * sc, 26 * sc, p.h * 0.5, A, "#C8A25A", sun, 0.16);
        const [cx4, cy4] = R.P(p.x, p.y, z + p.h * 0.5);
        for(let q14 = 0; q14 < 3; q14++){
          ctx.fillStyle = shade("#D8B46A", q14 * 0.06);
          ctx.beginPath(); ctx.ellipse(cx4, cy4 - q14 * R.zoom * 5 * sc, (34 - q14 * 3) * sc * R.zoom, (11 - q14 * 2) * sc * R.zoom, A, 0, TAU); ctx.fill();
        }
        break; }

      case "wing": {            // the Silverstone Wing: a low sweep of roof over the garages
        for(let q15 = 0; q15 < 12; q15++){
          const t2 = q15 / 11;
          const [tx, ty] = off((t2 - 0.5) * 300 * sc, 0);
          boxCol(ctx, tx, ty, z, 26 * sc, 40 * sc, (8 + 20 * Math.pow(t2, 1.6)) * sc, A, "#DCE1E6", sun, 0.24);
        }
        boxCol(ctx, ...off(-150 * sc, 0), z, 12 * sc, 44 * sc, 34 * sc, A, "#C4CAD0", sun, 0.2);
        boxCol(ctx, ...off(150 * sc, 0), z + 28 * sc, 12 * sc, 52 * sc, 2 * sc, A, "#9AA3AC", sun, 0.2);
        break; }

      case "brdc": {            // the old control tower and clubhouse
        win(p.x, p.y, z, 34 * sc, 22 * sc, p.h * 0.5, A, "#EDEBE4", 0.6);
        boxCol(ctx, ...off(10 * sc, 0), z + p.h * 0.5, 10 * sc, 10 * sc, p.h * 0.55, A, "#E4E2DA", sun, 0.24);
        boxCol(ctx, ...off(10 * sc, 0), z + p.h * 1.05, 14 * sc, 14 * sc, p.h * 0.12, A, "#2E3A48", sun, 0.16);
        break; }

      case "cotatower": {       // the observation tower with the red ramp spiralling up it
        boxCol(ctx, p.x, p.y, z, 8 * sc, 8 * sc, p.h * 0.9, A, "#E8ECF0", sun, 0.26);
        for(let q16 = 0; q16 < 16; q16++){
          const t3 = q16 / 15, a5 = t3 * TAU * 1.5, rr5 = 12 * sc;
          boxCol(ctx, p.x + Math.cos(a5) * rr5, p.y + Math.sin(a5) * rr5, z + p.h * 0.05 + t3 * p.h * 0.72, 7 * sc, 3.6 * sc, 2 * sc, a5 + Math.PI / 2, "#D8352A", sun, 0.3);
        }
        const [ox, oy] = R.P(p.x, p.y, z + p.h * 0.9), orr = 18 * sc * R.zoom;
        ctx.fillStyle = "#D8352A"; ctx.beginPath(); ctx.ellipse(ox, oy, orr, orr * 0.5, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = "#F4F6F8"; ctx.beginPath(); ctx.ellipse(ox, oy - R.zoom * 1.2 * sc, orr * 0.8, orr * 0.4, 0, 0, TAU); ctx.fill();
        boxCol(ctx, p.x, p.y, z + p.h * 0.92, 1.2 * sc, 1.2 * sc, p.h * 0.12, A, "#C8CDD3", sun, 0.2);
        break; }

      case "amphitheatre": {    // the white shells of the amphitheatre
        boxCol(ctx, p.x, p.y, z, 60 * sc, 90 * sc, 3 * sc, A, "#9A9288", sun, 0.1);
        for(const [dx, dy, hh] of [[-16, -26, 0.8], [0, 0, 1.0], [-16, 26, 0.8]])
          pyramid(ctx, ...off(dx * sc, dy * sc), z + 3 * sc, 22 * sc, p.h * hh, A + 0.3, "#F0F2F4", sun);
        break; }

      case "villareale": {      // the royal villa at Monza, wings either side, gardens in front
        win(p.x, p.y, z, 40 * sc, 60 * sc, p.h * 0.9, A, "#E4CFA4", 0.75);
        boxCol(ctx, p.x, p.y, z + p.h * 0.9, 38 * sc, 58 * sc, p.h * 0.12, A, "#8E5A46", sun, 0.16);
        for(const dy of [-70, 70]){
          win(...off(-4 * sc, dy * sc), z, 32 * sc, 80 * sc, p.h * 0.62, A, "#DCC79C", 0.75);
          boxCol(ctx, ...off(-4 * sc, dy * sc), z + p.h * 0.62, 30 * sc, 78 * sc, p.h * 0.1, A, "#8E5A46", sun, 0.16);
        }
        poly(ctx, [[-30, -90], [-100, -90], [-100, 90], [-30, 90]].map(q => R.P(...front(-q[0] * sc, q[1] * sc), z + 0.05)), "#6E8C4E");
        break; }

      case "pitbuilding": {     // a modern pit complex: garages, the deck above, the tower
        boxCol(ctx, p.x, p.y, z, 30 * sc, 230 * sc, 9 * sc, A, p.col, sun, 0.2);
        for(let q17 = -10; q17 <= 10; q17++) boxCol(ctx, ...front(15.2 * sc, q17 * 10.5 * sc), z, 0.8 * sc, 7 * sc, 5 * sc, frontAng, "#1E232A", sun, 0.1);
        boxCol(ctx, ...off(-2 * sc, 0), z + 9 * sc, 40 * sc, 236 * sc, 1.6 * sc, A, shade(p.col, -0.25), sun, 0.18);
        boxCol(ctx, ...front(-6 * sc, 0), z + 10.6 * sc, 16 * sc, 220 * sc, 5 * sc, frontAng, "#5E86B0", sun, 0.3);
        boxCol(ctx, ...off(-12 * sc, 60 * sc), z + 10.6 * sc, 14 * sc, 14 * sc, p.h * 0.7, A, shade(p.col, 0.05), sun, 0.22);
        boxCol(ctx, ...off(-12 * sc, 60 * sc), z + 10.6 * sc + p.h * 0.7, 18 * sc, 18 * sc, 4 * sc, A, "#2E3A48", sun, 0.16);
        break; }

      case "chalet": {          // an Ardennes farmhouse: dark stone, steep slate roof
        boxCol(ctx, p.x, p.y, z, 18 * sc, 11 * sc, p.h * 0.5, A, p.col, sun, 0.16);
        pyramid(ctx, p.x, p.y, z + p.h * 0.5, 9.5 * sc, p.h * 0.5, A, "#4A4E58", sun);
        boxCol(ctx, ...off(4 * sc, 0), z + p.h * 0.9, 1.6 * sc, 1.6 * sc, p.h * 0.2, A, "#6E6A64", sun, 0.16);
        break; }

      case "hangar": {          // an old airfield hangar
        boxCol(ctx, p.x, p.y, z, 60 * sc, 40 * sc, p.h * 0.55, A, p.col, sun, 0.16);
        pyramid(ctx, p.x, p.y, z + p.h * 0.55, 26 * sc, p.h * 0.32, A, shade(p.col, -0.12), sun);
        break; }

      case "funfair": {         // Motopia: the fairground beside the S/F straight
        const cols2 = ["#E8377F", "#37D6E8", "#FFC63D", "#39FF88", "#B14BF0", "#FF7A00"];
        for(let q18 = 0; q18 < 6; q18++){
          const a6 = q18 / 6 * TAU;
          boxCol(ctx, p.x + Math.cos(a6) * 26 * sc, p.y + Math.sin(a6) * 26 * sc, z, 12 * sc, 12 * sc, (8 + (q18 % 3) * 5) * sc, a6, cols2[q18], sun, 0.24);
        }
        boxCol(ctx, p.x, p.y, z, 3 * sc, 3 * sc, p.h, A, "#C8CDD3", sun, 0.2);
        boxCol(ctx, p.x, p.y, z + p.h * (0.35 + 0.5 * Math.abs(Math.sin(S.clock * 0.7))), 9 * sc, 9 * sc, 3 * sc, A, "#D8352A", sun, 0.3);
        break; }

      case "baseball": {        // the diamond inside the stadium section
        poly(ctx, [[-60, -60], [60, -60], [60, 60], [-60, 60]].map(q => R.P(...off(q[0] * sc, q[1] * sc), z + 0.03)), "#5E8A46");
        poly(ctx, [[0, -26], [26, 0], [0, 26], [-26, 0]].map(q => R.P(...off(q[0] * sc, q[1] * sc), z + 0.06)), "#C9A46E");
        poly(ctx, [[0, -14], [14, 0], [0, 14], [-14, 0]].map(q => R.P(...off(q[0] * sc, q[1] * sc), z + 0.09)), "#6E9A52");
        break; }


      case "palazzo": {
        win(p.x, p.y, z, 44 * sc, 34 * sc, p.h * 0.94, A, "#E8DCC0", 0.4);
        boxCol(ctx, p.x, p.y, z + p.h * 0.94, 30 * sc, 24 * sc, p.h * 0.06, A, "#C9A36E", sun, 0.24);
        break; }
      case "treasure": {        // Treasure Island, and the pirate ship in its lagoon
        win(p.x, p.y, z, 40 * sc, 62 * sc, p.h * 0.9, A, "#C7A98C", 0.42);
        groundEllipse(ctx, ...front(48 * sc, 0), z + 0.05, 40 * sc, 16 * sc, frontAng, night ? "#16304A" : "#2E6E9E");
        boxCol(ctx, ...front(46 * sc, -8 * sc), z + 1, 26 * sc, 7 * sc, 5 * sc, frontAng + 0.3, "#4A3020", sun, 0.16);
        boxCol(ctx, ...front(46 * sc, -8 * sc), z + 6 * sc, 1.2 * sc, 1.2 * sc, 22 * sc, frontAng, "#7A6244", sun, 0.16);
        boxCol(ctx, ...front(46 * sc, -8 * sc), z + 14 * sc, 0.6 * sc, 12 * sc, 9 * sc, frontAng, "#EDE6D6", sun, 0.3);
        break; }
      case "harrahs": {
        win(p.x, p.y, z, 34 * sc, 60 * sc, p.h * 0.9, A, "#6E4E9E", 0.42);
        boxCol(ctx, ...front(18 * sc, 0), z + p.h * 0.3, 2 * sc, 40 * sc, p.h * 0.3, frontAng, "#E8B33D", sun, 0.3);
        glow(...front(20 * sc, 0), z + p.h * 0.45, 30 * sc, "rgba(255,200,80,.3)");
        break; }
      case "horseshoe": {
        for(const dy of [-22, 22]) win(...off(0, dy * sc), z, 30 * sc, 36 * sc, p.h * (dy < 0 ? 0.9 : 0.8), A, "#8E8E96", 0.42);
        boxCol(ctx, ...front(20 * sc, 0), z, 4 * sc, 70 * sc, 12 * sc, frontAng, "#B0202A", sun, 0.24);
        break; }
      case "cosmopolitan": {    // two dark towers and the huge marquee
        for(const dy of [-28, 28]) win(...off(dy * 0.1 * sc, dy * sc), z, 26 * sc, 44 * sc, p.h * (dy < 0 ? 1 : 0.94), A, "#2C3440", 0.5);
        if(night){
          const cyc = ["#E03C5A", "#37D6E8", "#FFC63D", "#B14BF0"][Math.floor(S.clock * 0.4) % 4];
          boxCol(ctx, ...front(16 * sc, 0), z + p.h * 0.55, 1.4 * sc, 60 * sc, p.h * 0.3, frontAng, cyc, sun, 0.3);
          glow(...front(18 * sc, 0), z + p.h * 0.7, 44 * sc, "rgba(224,60,90,.25)");
        }
        break; }
      case "planethollywood": {
        win(p.x, p.y, z, 34 * sc, 74 * sc, p.h * 0.88, A, "#3A5068", 0.45);
        boxCol(ctx, ...front(24 * sc, 0), z, 30 * sc, 90 * sc, 14 * sc, frontAng, "#4A5568", sun, 0.2);
        if(night) glow(...front(40 * sc, 0), z + 14 * sc, 40 * sc, "rgba(255,120,200,.28)");
        break; }
      case "f1sign": {          // the big lit Grand Prix sign by the paddock, facing the road
        boxCol(ctx, p.x, p.y, z, 40 * sc, 3 * sc, 8 * sc, A, "#1E232A", sun, 0.16);
        boxCol(ctx, p.x, p.y, z + 8 * sc, 36 * sc, 2 * sc, 14 * sc, A, "#E10600", sun, 0.34);
        boxCol(ctx, ...front(1.4 * sc, 4 * sc), z + 11 * sc, 18 * sc, 0.6 * sc, 6 * sc, A, "#F6F6F6", sun, 0.4);
        boxCol(ctx, ...front(1.4 * sc, -8 * sc), z + 10 * sc, 9 * sc, 0.6 * sc, 9 * sc, A, "#F6F6F6", sun, 0.4);
        glow(p.x, p.y, z + 15 * sc, 36 * sc, "rgba(255,40,30,.4)");
        break; }
      case "vegaspit": {        // the paddock building along the pit straight: garages, the deck, the lit rim
        boxCol(ctx, p.x, p.y, z, 300 * sc, 30 * sc, 12 * sc, A, "#2E3138", sun, 0.16);
        for(let q21 = -13; q21 <= 13; q21++) boxCol(ctx, ...front(15.2 * sc, q21 * 10.8 * sc), z, 7.5 * sc, 0.8 * sc, 6 * sc, A, "#0E1114", sun, 0.1);
        boxCol(ctx, ...front(-4 * sc, 0), z + 12 * sc, 310 * sc, 46 * sc, 3 * sc, A, "#3A3E48", sun, 0.2);
        boxCol(ctx, ...front(-10 * sc, 0), z + 15 * sc, 300 * sc, 30 * sc, 10 * sc, A, "#20242B", sun, 0.16);
        for(let q22 = 0; q22 < 5; q22++) boxCol(ctx, ...front((-22 + q22 * 4) * sc, 0), z + (25 + q22 * 2.2) * sc, 290 * sc, 3.6 * sc, 2.2 * sc, A, q22 % 2 ? "#3EA0FF" : "#2C7BD8", sun, 0.3);
        boxCol(ctx, ...front(14 * sc, 0), z + 15 * sc, 306 * sc, 1.2 * sc, 1.2 * sc, A, "#37D6E8", sun, 0.4);
        if(night){ glow(...front(-8 * sc, -90 * sc), z + 28 * sc, 70 * sc, "rgba(60,160,255,.22)"); glow(...front(-8 * sc, 90 * sc), z + 28 * sc, 70 * sc, "rgba(60,160,255,.22)"); }
        break; }
      case "mirage": {          // gold curve with the volcano out front
        win(p.x, p.y, z, 22 * sc, 56 * sc, p.h, A, "#A07C34", 0.42);
        const [vx, vy] = front(48 * sc, 0);
        pyramid(ctx, vx, vy, z, 22 * sc, 16 * sc, A, "#3A3026", sun);
        glow(vx, vy, z + 16 * sc, 24 * sc, "rgba(255,120,40,.34)");
        break; }

      }
      break; }
    case "billboard": {
      boxCol(ctx, p.x, p.y, z, 0.5, 0.5, p.h * 0.55, p.rot, "#5A6069", sun);
      boxCol(ctx, p.x, p.y, z + p.h * 0.55, 9 + p.r * 4, 0.6, p.h * 0.42, p.rot, p.col, sun, 0.25);
      break; }
    case "arch": {                       // gantry over the road
      const T2 = S.track, w2 = T2.half + T2.runoff + 3;
      const nxp = Math.cos(p.rot + Math.PI / 2), nyp = Math.sin(p.rot + Math.PI / 2);
      for(const sg of [-1, 1])
        boxCol(ctx, p.x + nxp * w2 * sg, p.y + nyp * w2 * sg, z, 1.4, 1.4, p.h, p.rot, "#3C434C", sun, 0.16);
      boxCol(ctx, p.x, p.y, z + p.h, 1.8, w2 * 2 + 2, 1.7, p.rot, p.col, sun, 0.28);
      break; }
    case "marshal": {
      boxCol(ctx, p.x, p.y, z, 2.6, 2.0, 2.4, p.rot, "#D8DCE0", sun, 0.2);
      boxCol(ctx, p.x, p.y, z + 2.4, 3.0, 2.4, 0.4, p.rot, "#C8102E", sun, 0.2);
      break; }
    case "fence": {
      const [f1x, f1y] = R.P(p.x, p.y, z), [f2x, f2y] = R.P(p.x, p.y, z + p.h);
      ctx.strokeStyle = "rgba(190,200,210,.38)"; ctx.lineWidth = Math.max(1, R.zoom * 0.12);
      for(let q = 0; q <= 4; q++){
        const yy = f1y + (f2y - f1y) * q / 4;
        ctx.beginPath(); ctx.moveTo(f1x - R.zoom * 6, yy); ctx.lineTo(f1x + R.zoom * 6, yy); ctx.stroke();
      }
      boxCol(ctx, p.x, p.y, z, 0.35, 0.35, p.h, p.rot, "#6E757D", sun);
      break; }
    case "garage": {
      boxCol(ctx, p.x, p.y, z, p.w || 22, 9, p.h, p.rot, p.col, sun, 0.22, TEX.garage(p.col));
      const [gx, gy] = R.P(p.x, p.y, z + p.h);
      ctx.fillStyle = "rgba(255,165,31,.75)";
      ctx.fillRect(gx - R.zoom * 4.5, gy + R.zoom * 1.0, R.zoom * 9, R.zoom * 0.6);
      boxCol(ctx, p.x, p.y, z + p.h, (p.w || 22) + 2, 10, 0.7, p.rot, shade(p.col, -0.28), sun);
      break; }
    case "banking": {
      boxCol(ctx, p.x, p.y, z, 90, 9, 9, p.rot, p.col, sun, 0.1);
      break; }
  }
}

/* ---- the car ---- */

function setTEXBUDGET(v){ TEXBUDGET = v; }
function setB3(v){ B3 = v; }
export { box, boxCol, drawProp, setB3, setTEXBUDGET };
