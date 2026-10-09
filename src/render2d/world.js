import { $, TAU, clamp, lerp, shade } from '../config/util.js';
import { bankZ } from '../tracks/shared.js';
import { NEARP, R, poly } from './view.js';
import { TEX } from './textures.js';
import { boxCol, drawProp, setTEXBUDGET } from './props.js';
import { drawCar } from './car.js';
import { PART, drawPart } from './particles.js';
import { G3 } from '../render3d/g3.js';
import { showToast } from '../ui/screens.js';

/* ---------- 5b. world render ---------------------------------------------- */

function groundFill(col, kind){
  if(R.persp) return col;
  const t = TEX.ground(col, kind);
  if(!R.persp && t.pat.setTransform){
    const s = Math.max(0.5, R.zoom / 11);
    t.pat.setTransform(new DOMMatrix([s, 0, 0, s, (R.W / 2 - R.camX * R.zoom) % (64 * s), (R.H / 2 - R.camY * R.zoom) % (64 * s)]));
  } else if(t.pat.setTransform) t.pat.setTransform(new DOMMatrix([1, 0, 0, 1, 0, 0]));
  return t.pat;
}
const G3fail = { n:0, t:0, last:null };
function renderWorld(S){
  if(G3.ok){
    if(G3.lost) return;                                  // the GPU context is away; it will be back
    try{ return G3.frame(S); }
    catch(e){
      // One bad frame is not the end of 3D. Say what happened, put the renderer back in a
      // known state and rebuild the world; only if it keeps failing, fall back to 2D.
      console.warn("3D frame failed:", e && e.message, e && e.stack);
      const now = performance.now();
      G3fail.n = now - G3fail.t < 10000 ? G3fail.n + 1 : 1; G3fail.t = now; G3fail.last = e && e.message;
      let gone = false; try{ gone = G3.rend.getContext().isContextLost(); }catch(x){ gone = true; }
      if(G3fail.n <= 3 || gone){
        try{ G3.rend.setRenderTarget(null); }catch(x){}
        G3.built = null; if(gone) G3.lost = true;
        // say what broke, on screen: the console is not always to hand
        try{ showToast("Graphics hiccup, rebuilding" + (gone ? " (GPU context lost)" : ": " + String(G3fail.last || "").slice(0, 90))); }catch(x){}
        return;
      }
      console.warn("3D keeps failing, falling back to 2D");
      G3.ok = false; $("#view").style.display = ""; if(G3.cv) G3.cv.remove();
      // keep the reason where it can be read: on screen for a while, and in storage across a reload
      const why = String(G3fail.last || "unknown").slice(0, 160) + " (" + (S.track && S.track.id) + ", " + (S.clock || 0).toFixed(1) + " s)";
      try{ localStorage.setItem("apex3dFail", why); }catch(x){}
      try{ showToast("3D switched off: " + why, 12); }catch(x){}
    }
  }
  return renderWorld2D(S);
}
function renderWorld2D(S){
  const T = S.track, ctx = R.ctx, W = R.W, H = R.H, P = T.pal, n = T.n;
  setTEXBUDGET(R.persp ? 110 : 260);
  const sun = T.sun, wet = S.wet;
  // ground
  const base = wet > 0.3 ? shade(P.ground, -0.22) : P.ground;
  if(R.persp){
    // a real horizon, tilting with the camera
    const big = Math.max(W, H) * 2.2;
    ctx.save();
    ctx.translate(W / 2, H / 2 + R.shakeY); ctx.rotate(R.froll);
    const hy = -R.fpitch;
    ctx.fillStyle = base; ctx.fillRect(-big, hy, big * 2, big);
    const g2 = ctx.createLinearGradient(0, hy - big * 0.45, 0, hy);
    g2.addColorStop(0, P.skyA); g2.addColorStop(1, P.skyB);
    ctx.fillStyle = g2; ctx.fillRect(-big, hy - big, big * 2, big);
    // haze where the land meets the sky
    const hz = ctx.createLinearGradient(0, hy - H * 0.10, 0, hy + H * 0.04);
    hz.addColorStop(0, "rgba(0,0,0,0)"); hz.addColorStop(1, shade(P.skyB, -0.05));
    ctx.globalAlpha = 0.5; ctx.fillStyle = hz; ctx.fillRect(-big, hy - H * 0.10, big * 2, H * 0.14);
    ctx.globalAlpha = 1;
    ctx.restore();
  } else {
    ctx.fillStyle = base; ctx.fillRect(0, 0, W, H);
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, P.skyA); sky.addColorStop(0.55, "rgba(0,0,0,0)");
    ctx.globalAlpha = T.night ? 0.55 : 0.22; ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1;
  }

  const M = 220;
  /* the land. It goes down before anything else, largest patch first, so the
     circuit and its verges always paint over whatever runs underneath them. */
  if(T.land) for(const L of T.land){
    let fade = 1;
    if(R.persp){
      const f = (L.x - R.fx) * R.fcos + (L.y - R.fy) * R.fsin;
      if(f < -L.r * 1.6 || f > 1600 + L.r) continue;
      const lat = Math.abs(-(L.x - R.fx) * R.fsin + (L.y - R.fy) * R.fcos);
      if(lat > L.r + 300 + Math.max(f, 0) * 1.7) continue;
      const edge = Math.max(f - L.r, 0);
      if(edge > 300) fade = Math.max(0, 1 - (edge - 300) / 500);
      if(fade <= 0.02) continue;
    } else {
      const [lx, ly] = R.P(L.x, L.y, L.z);
      const pad = M + L.r * R.zoom;
      if(lx < -pad || lx > W + pad || ly < -pad || ly > H + pad) continue;
    }
    if(fade < 1) ctx.globalAlpha = fade;
    if(L.rim) poly(ctx, L.rimPts.map(q => R.P(q[0], q[1], L.z)), L.rim);
    poly(ctx, L.pts.map(q => R.P(q[0], q[1], L.z)), groundFill(L.col, L.kind || (L.drop ? "water" : "grass")));
    ctx.globalAlpha = 1;
  }

  // two passes: the road is flat ground and is laid down first, so it can never
  // paint over a car standing on it. Everything with height is depth-sorted after.
  const ground = [], items = [];
  const dkey = R.persp
    ? (x, y, z) => -((x - R.fx) * (x - R.fx) + (y - R.fy) * (y - R.fy)) - (z || 0) * 0.5
    : (x, y, z) => x + y + (z || 0) * 0.85;
  const me = S.player;
  const meD = me ? me.x + me.y : 1e9;
  const [meSX, meSY] = me ? R.P(me.x, me.y, me.z) : [-1e9, -1e9];
  // the car itself plus the road it is about to drive down
  const aheadPts = [[meSX, meSY]];
  if(me) for(const d of [18, 38, 62]){
    const j2 = (me.node + Math.round(d / T.ds)) % T.n;
    aheadPts.push(R.P(T.x[j2] + T.nx[j2] * T.line[j2], T.y[j2] + T.ny[j2] * T.line[j2], T.z[j2]));
  }
  // under the broadcast lens, cull by where things are in the world; on screen a
  // nearby segment projects far below the frame and a bounds test would drop the road
  const seen = (x, y, latPad) => {
    if(!R.persp) return null;
    const f = (x - R.fx) * R.fcos + (y - R.fy) * R.fsin;
    if(f < -26 || f > 620) return false;
    const r = -(x - R.fx) * R.fsin + (y - R.fy) * R.fcos;
    return Math.abs(r) < (latPad || 70) + Math.max(f, 0) * 1.25;
  };
  for(let i = 0; i < n; i++){
    const [px, py] = R.P(T.x[i], T.y[i], T.z[i]);
    if(R.persp){ if(!seen(T.x[i], T.y[i], 90)) continue; }
    else if(px < -M || px > W + M || py < -M || py > H + M) continue;
    if(T.bridge[i]){
      // a raised deck sorts against the road and cars underneath it — and gets
      // out of the way when you are the one driving under it
      const under = me && me.z < T.z[i] - 3 &&
        Math.abs(meSX - px) < 150 && Math.abs(meSY - py) < 150;
      items.push({ d:dkey(T.x[i], T.y[i], T.z[i]), f:() => {
        if(under) ctx.globalAlpha = 0.42;
        drawSegGround(ctx, T, S, i);
        ctx.globalAlpha = 1;
      } });
    } else ground.push({ d:dkey(T.x[i], T.y[i], T.z[i]), f:() => drawSegGround(ctx, T, S, i) });
    if(T.inTunnel(i)){
      // the tunnel roof sits above the cars, and thins out while you are in it
      const inside = me && T.inTunnel(me.node);
      const wRoof = (T.half + T.runoff) * 2 + 4;
      items.push({ d:dkey(T.x[i], T.y[i], T.z[i] + 6.2), f:() => {
        ctx.globalAlpha = inside && !R.persp ? 0.30 : 1;
        boxCol(ctx, T.x[i], T.y[i], T.z[i] + 5.4, T.ds + 0.6, wRoof, 1.4, T.ang[i], "#8C8478", T.sun, 0.12);
        if(i % 2 === 0){
          const wall = (T.half + T.runoff) + 1.5;
          for(const sd of [-1, 1])
            boxCol(ctx, T.x[i] + T.nx[i] * sd * wall, T.y[i] + T.ny[i] * sd * wall, T.z[i], T.ds * 2 + 0.6, 1.0, 5.4, T.ang[i], "#9A9284", T.sun, 0.08);
        }
        // the strip lights along the ceiling
        if(i % 3 === 0){
          const [lx, ly] = R.P(T.x[i], T.y[i], T.z[i] + 5.3);
          ctx.fillStyle = "rgba(255,225,170,.9)";
          ctx.fillRect(lx - R.zoom * 0.9, ly - R.zoom * 0.15, R.zoom * 1.8, Math.max(1, R.zoom * 0.3));
        }
        ctx.globalAlpha = 1;
      } });
    }
    for(const side of [1, -1]){
      const bo = T.half + T.roAt(i, side) + (T.barrier === "wall" ? 1.0 : 2.6);
      const bx = T.x[i] + T.nx[i] * side * bo, by = T.y[i] + T.ny[i] * side * bo;
      const bUnder = T.bridge[i] && me && me.z < T.z[i] - 3 &&
        Math.abs(meSX - px) < 150 && Math.abs(meSY - py) < 150;
      items.push({ d:dkey(bx, by, T.z[i]), f:() => {
        if(bUnder) ctx.globalAlpha = 0.42;
        drawBarrierSeg(ctx, T, S, i, side);
        ctx.globalAlpha = 1;
      } });
    }
  }
  for(const p of T.props){
    const [px, py] = R.P(p.x, p.y, p.z + p.h);
    if(R.persp){ if(R.fwdOf(p.x, p.y) < 2.5 || !seen(p.x, p.y, 160)) continue; }
    else if(px < -M || px > W + M || py < -M || py > H + M * 2) continue;
    const [bx, by] = R.P(p.x, p.y, p.z);
    const wide = (p.t === "hotel" || p.t === "tower" ? 30 : p.t === "grandstand" ? 34 : p.t === "garage" ? 20 : p.t === "neon" ? 12 : p.t === "stadium" || p.t === "arch" ? 0 : 9) * R.zoom;
    let hides = false;
    if(R.persp){
      // from the seat, a tall thing a few car lengths away fills the screen even
      // when it is properly off to the side. Fade those rather than lose the view.
      const f2 = R.fwdOf(p.x, p.y);
      const lat = Math.abs(-(p.x - R.fx) * R.fsin + (p.y - R.fy) * R.fcos);
      if(p.h > 12 && f2 < 62 && lat < 70) hides = true;
    } else if(p.x + p.y > meD && wide > 0){
      for(const pt of aheadPts){
        if(Math.abs(pt[0] - bx) < wide && pt[1] > py - 70 && pt[1] < by + 70){ hides = true; break; }
      }
    }
    items.push({ d:dkey(p.x, p.y, p.z), f:() => {
      if(hides) ctx.globalAlpha = 0.26;
      drawProp(ctx, p, T, S);
      ctx.globalAlpha = 1;
    } });
  }
  for(const c of S.cars){
    if(c.recovered || c.recovering) continue;       // on the recovery truck (drawn with it), or taken away
    // your own nose, front wheels and mirrors are in shot — the near plane
    // clip in poly() throws away the bodywork that is behind your head
    if(R.persp){ if(!seen(c.x, c.y, 40)) continue; }
    else {
      const [cpx, cpy] = R.P(c.x, c.y, c.z);
      if(cpx < -60 || cpx > W + 60 || cpy < -60 || cpy > H + 60) continue;
    }
    items.push({ d:dkey(c.x, c.y, c.z) + 0.6, f:() => drawCar(ctx, c, T, S, c === S.player) });
  }
  const sck = S.sc && S.sc.car;
  if(sck && (R.persp ? seen(sck.x, sck.y, 40) : true)) items.push({ d:dkey(sck.x, sck.y, sck.z) + 0.6, f:() => {
    // a plain green box with an amber bar: the 2D view is only the fallback
    const ca = Math.cos(sck.h), sa = Math.sin(sck.h), L = 2.4, Wd = 1.0;
    const q = (a, b) => R.P(sck.x + ca * a - sa * b, sck.y + sa * a + ca * b, sck.z + 0.5);
    poly(ctx, [q(L, Wd), q(L, -Wd), q(-L, -Wd), q(-L, Wd)], "#0E8A5C");
    poly(ctx, [q(0.6, 0.6), q(0.6, -0.6), q(-1.2, -0.6), q(-1.2, 0.6)], "#F2F4F5");
    const on = sck.lights && (S.clock * 4.2) % 1 < 0.5;
    poly(ctx, [q(-0.2, 0.9), q(-0.2, -0.9), q(-0.6, -0.9), q(-0.6, 0.9)], on ? "#FFB000" : "#6A4A00");
  } });
  // the recovery trucks: a plain flatbed, the 2D view is only the fallback
  if(S.recov) for(const j of S.recov.jobs){
    const tp = j.truck; if(!tp) continue;
    if(R.persp && !seen(tp.x, tp.y, 40)) continue;
    let z = j.car ? j.car.z : 0; try{ const g = S.track.surfZ(tp.x, tp.y, j.node); if(g === g) z = g; }catch(e){}
    items.push({ d:dkey(tp.x, tp.y, z) + 0.6, f:() => {
      const ca = Math.cos(tp.h), sa = Math.sin(tp.h);
      const q = (a, b, h) => R.P(tp.x + ca * a - sa * b, tp.y + sa * a + ca * b, z + (h || 0.6));
      poly(ctx, [q(-4.9, 1.9), q(-4.9, -1.9), q(3.6, -1.9), q(3.6, 1.9)], "#3C4148");
      poly(ctx, [q(3.6, 1.6, 1.4), q(3.6, -1.6, 1.4), q(6.1, -1.6, 1.4), q(6.1, 1.6, 1.4)], "#F2B21A");
      // the car, once the crane has it: a plain outline in its team colour on the bed
      if(j.car && j.car.recovering && !j.car.recovered)
        poly(ctx, [q(-2.6, 0.95, 1.5), q(-2.6, -0.95, 1.5), q(2.6, -0.95, 1.5), q(2.6, 0.95, 1.5)], j.car.team.body);
    } });
  }
  if(S.ghost && S.ghostCar) items.push({ d:S.ghostCar.x + S.ghostCar.y, f:() => {
    ctx.globalAlpha = 0.34; drawCar(ctx, S.ghostCar, T, S, false); ctx.globalAlpha = 1; } });
  for(const p of PART){
    if(R.persp && R.fwdOf(p.x, p.y) < 1.6) continue;
    items.push({ d:dkey(p.x, p.y, p.z) + 0.6, f:() => drawPart(ctx, p) });
  }
  if(S.marks) for(const m of S.marks){
    const [mx, my] = R.P(m.x, m.y, m.z);
    if(R.persp){ if(!seen(m.x, m.y, 60)) continue; }
    else if(mx < -M || mx > W + M || my < -M || my > H + M) continue;
    ground.push({ d:dkey(m.x, m.y, m.z) - 0.2, f:() => {
      const ca2 = Math.cos(m.a), sa2 = Math.sin(m.a), L2 = m.w * 1.6;
      poly(ctx, [R.P(m.x + ca2 * L2, m.y + sa2 * L2, m.z),
                 R.P(m.x - ca2 * L2, m.y - sa2 * L2, m.z),
                 R.P(m.x - ca2 * L2 - sa2 * 0.5, m.y - sa2 * L2 + ca2 * 0.5, m.z),
                 R.P(m.x + ca2 * L2 - sa2 * 0.5, m.y + sa2 * L2 + ca2 * 0.5, m.z)],
           "rgba(22,24,28," + m.o.toFixed(2) + ")");
    } });
  }

  ground.sort((a, b) => a.d - b.d);
  // lettering painted across the road, laid down after every segment so no
  // later piece of tarmac can cover it
  if(T.def.roadText) ground.push({ d:1e18, f:() => {
    for(const rt of T.def.roadText){
      const i = Math.round(rt.u * n) % n, j = (i + 1) % n;
      if(R.persp && !seen(T.x[i], T.y[i], 60)) continue;
      const wHalf = T.half * 0.86;
      const o0 = R.P(T.x[i] + T.nx[i] * wHalf, T.y[i] + T.ny[i] * wHalf, T.z[i]);
      const oX = R.P(T.x[j] + T.nx[j] * wHalf, T.y[j] + T.ny[j] * wHalf, T.z[j]);
      const oY = R.P(T.x[i] - T.nx[i] * wHalf, T.y[i] - T.ny[i] * wHalf, T.z[i]);
      const ax = (oX[0] - o0[0]) / T.ds, ay = (oX[1] - o0[1]) / T.ds;
      const bx = (oY[0] - o0[0]) / (wHalf * 2), by = (oY[1] - o0[1]) / (wHalf * 2);
      ctx.save();
      ctx.setTransform(R.dpr * ax, R.dpr * ay, R.dpr * bx, R.dpr * by, R.dpr * o0[0], R.dpr * o0[1]);
      ctx.fillStyle = rt.col || "#F2F2F2"; ctx.globalAlpha = 0.85;
      ctx.font = "800 " + (wHalf * 1.7).toFixed(1) + "px 'Saira Condensed',sans-serif";
      ctx.textAlign = "left"; ctx.textBaseline = "middle";
      ctx.fillText(rt.txt, 2, wHalf);
      ctx.restore();
      ctx.setTransform(R.dpr, 0, 0, R.dpr, 0, 0);
      ctx.globalAlpha = 1;
    }
  } });
  items.sort((a, b) => a.d - b.d);
  if(R.persp){
    // R.zoom is "pixels per metre", which is a constant overhead but falls off
    // with distance through a lens. The sort key is -(distance squared), so the
    // distance is already there to be read back.
    const z0 = R.zoom;
    // and far-off geometry dissolves into haze, so a piece of the lap that is
    // genuinely higher than you does not hang in the sky with nothing under it
    const run = (l) => { for(const it of l){
      const dist = Math.sqrt(Math.max(-it.d, 0.04));
      const a = dist < 230 ? 1 : 1 - (dist - 230) / 340;
      if(a <= 0.02) continue;
      R.zoom = R.focal / Math.max(dist, NEARP);
      if(a < 1) ctx.globalAlpha = a;
      it.f();
      ctx.globalAlpha = 1;
    } };
    try{ run(ground); run(items); }
    finally{ R.zoom = z0; ctx.globalAlpha = 1; }
  } else {
    for(const g of ground) g.f();
    for(const it of items) it.f();
  }

  if(wet > 0.03){
    ctx.fillStyle = "rgba(26,38,54," + (0.06 + wet * 0.20).toFixed(3) + ")";
    ctx.fillRect(0, 0, W, H);
    const drops = Math.round(90 + wet * 340), seed = (S.clock * 1100) | 0;
    ctx.strokeStyle = "#D2E6F4"; ctx.lineCap = "round";
    for(let layer = 0; layer < 2; layer++){
      const len = layer ? 34 : 18;
      ctx.globalAlpha = (layer ? 0.09 : 0.15) + wet * (layer ? 0.17 : 0.24);
      ctx.lineWidth = layer ? 1.8 : 1.0;
      ctx.beginPath();
      for(let i = layer; i < drops; i += 2){
        const x = ((i * 9973 + seed * (13 + layer * 7)) % (W + 160)) - 80;
        const y = ((i * 7919 + seed * (29 + layer * 11)) % (H + 160)) - 80;
        ctx.moveTo(x, y); ctx.lineTo(x - len * 0.3, y + len);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  // vignette
  const v = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.32, W / 2, H / 2, Math.max(W, H) * 0.78);
  v.addColorStop(0, "rgba(0,0,0,0)"); v.addColorStop(1, T.night ? "rgba(0,0,0,.62)" : "rgba(8,12,18,.34)");
  ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);

  // in the pit lane the rest of the circuit falls into shadow
  const focus = S.pitFocus || 0;
  if(focus > 0.01 && S.player){
    const [fx2, fy2] = R.P(S.player.x, S.player.y, S.player.z);
    const inner = Math.max(40, R.zoom * 7), outer = Math.max(inner + 60, R.zoom * 30);
    const g2 = ctx.createRadialGradient(fx2, fy2, inner, fx2, fy2, outer);
    g2.addColorStop(0, "rgba(4,6,9,0)");
    g2.addColorStop(1, "rgba(4,6,9," + (0.78 * focus).toFixed(3) + ")");
    ctx.fillStyle = g2; ctx.fillRect(0, 0, W, H);
  }
}

function drawSegGround(ctx, T, S, i){
  const j = (i + 1) % T.n, P = T.pal, n = T.n;
  const w = T.half, ro = Math.max(T.roL[i], T.roR[i], T.roL[j], T.roR[j]), wall = T.barrier === "wall";
  const E = (k, o) => [T.x[k] + T.nx[k] * o, T.y[k] + T.ny[k] * o,
    T.z[k] + bankZ(T, k, o)];
  const Q = (o1, o2) => [R.P(...E(i, o1)), R.P(...E(j, o1)), R.P(...E(j, o2)), R.P(...E(i, o2))];
  const far = -Math.sign(T.nx[i] + T.ny[i]) || 1;
  const wet = S.wet;

  drawSegGroundBody(ctx, T, S, i, j, P, n, w, ro, wall, E, Q, wet);
}
function drawBarrierSeg(ctx, T, S, i, side){
  const j = (i + 1) % T.n, P = T.pal;
  const w = T.half, wall = T.barrier === "wall";
  // the wall follows the run-off on this side at each end of the segment
  const ro = T.roAt(i, side), roJ = T.roAt(j, side);
  const E = (k, o) => [T.x[k] + T.nx[k] * o, T.y[k] + T.ny[k] * o,
    T.z[k] + bankZ(T, k, o)];
  const far = -Math.sign(T.nx[i] + T.ny[i]) || 1;
  // From the seat, a stretch of circuit that climbs above you would otherwise hang
  // in the sky with nothing beneath it. Drop an apron from the barrier to the
  // bottom of the circuit and it reads as the hillside it is meant to be.
  if(R.persp && T.z[i] > R.fz + 2 && R.fwdOf(T.x[i], T.y[i]) > 70){
    const o = side * (wall ? w + ro + 1.0 : w + ro + 2.6), oj = side * (wall ? w + roJ + 1.0 : w + roJ + 2.6);
    const [ax, ay, az] = E(i, o), [bx, by, bz] = E(j, oj);
    const foot = R.fz - 1;                                   // down to your own eyeline
    poly(ctx, [R.P(ax, ay, az), R.P(bx, by, bz), R.P(bx, by, foot), R.P(ax, ay, foot)],
         shade(P.ground, side === far ? -0.26 : -0.14));
  }
  {
    const o = side * (wall ? w + ro + 1.0 : w + ro + 2.6), oj = side * (wall ? w + roJ + 1.0 : w + roJ + 2.6);
    const [ax, ay, az] = E(i, o), [bx, by, bz] = E(j, oj);
    const h = wall ? 1.25 : 1.0;
    const face = [R.P(ax, ay, az), R.P(bx, by, bz), R.P(bx, by, bz + h), R.P(ax, ay, az + h)];
    if(wall){
      poly(ctx, face, shade(P.wall, side === far ? -0.16 : 0.02));
      if(i % 6 < 3) poly(ctx, face, "rgba(214,60,48,.30)");
      const cnx = T.nx[i] * side * 0.5, cny = T.ny[i] * side * 0.5;
      poly(ctx, [R.P(ax, ay, az + h), R.P(bx, by, bz + h), R.P(bx + cnx, by + cny, bz + h), R.P(ax + cnx, ay + cny, az + h)], shade(P.wall, 0.18));
    } else {
      poly(ctx, face, i % 4 < 2 ? "#C7CDD3" : "#AEB4BA");
      const cnx = T.nx[i] * side * 0.4, cny = T.ny[i] * side * 0.4;
      poly(ctx, [R.P(ax, ay, az + h), R.P(bx, by, bz + h), R.P(bx + cnx, by + cny, bz + h), R.P(ax + cnx, ay + cny, az + h)], "#8A9199");
      // posts, so the rail reads as a barrier standing on the ground rather than
      // a wire floating over the runoff
      if(i % 2 === 0)
        poly(ctx, [R.P(ax, ay, az), R.P(ax + cnx * 0.4, ay + cny * 0.4, az),
                   R.P(ax + cnx * 0.4, ay + cny * 0.4, az + h), R.P(ax, ay, az + h)], "#6E757C");
      if(i % 26 === 0){
        const [tx2, ty2] = R.P(ax + T.nx[i] * side * 1.4, ay + T.ny[i] * side * 1.4, az);
        ctx.fillStyle = "#17191C";
        for(let k = 0; k < 3; k++){ ctx.beginPath(); ctx.arc(tx2 + k * R.zoom * 0.7, ty2 - k * R.zoom * 0.25, R.zoom * 0.6, 0, TAU); ctx.fill(); }
      }
    }
  }
}
function drawSegGroundBody(ctx, T, S, i, j, P, n, w, ro, wall, E, Q, wet){
  if(T.inTunnel && T.inTunnel(i)){
    // same body, then a shadow laid over the whole width
    drawSegGroundBodyInner(ctx, T, S, i, j, P, n, w, ro, wall, E, Q, wet);
    poly(ctx, Q(-(w + ro + 1.5), (w + ro + 1.5)), "rgba(10,12,18,.42)");
    return;
  }
  drawSegGroundBodyInner(ctx, T, S, i, j, P, n, w, ro, wall, E, Q, wet);
}
function drawSegGroundBodyInner(ctx, T, S, i, j, P, n, w, ro, wall, E, Q, wet){
  // a bridge deck needs a thickness and something holding it up
  if(T.bridge[i]){
    const hDeck = 1.5;
    for(const sd of [-1, 1]){
      const a1 = E(i, sd * (w + 1.1)), b1 = E(j, sd * (w + 1.1));
      poly(ctx, [R.P(a1[0], a1[1], a1[2]), R.P(b1[0], b1[1], b1[2]),
                 R.P(b1[0], b1[1], b1[2] - hDeck), R.P(a1[0], a1[1], a1[2] - hDeck)],
           sd === (-Math.sign(T.nx[i] + T.ny[i]) || 1) ? "#4E555D" : "#656D76");
    }
    if(i % 7 === 0 && T.deckH[i] > 3.5)
      boxCol(ctx, T.x[i], T.y[i], T.z[i] - T.deckH[i] - 0.4, 2.6, w * 1.3, T.deckH[i], T.ang[i], "#79818A", T.sun, 0.14);
  }
  // verge / runoff
  if(!wall){
    poly(ctx, Q(-(w + ro + 8), (w + ro + 8)), groundFill(shade(P.grass, -0.05), "grass"));
    const runCol = T.id === "zandvoort" || T.id === "baku" ? "#C9B78E" : shade(P.road, 0.22);
    poly(ctx, Q(-(w + ro), -(w + 0.2)), runCol);
    poly(ctx, Q(w + 0.2, w + ro), runCol);
  } else {
    // painted runoff and a kerb line before the barrier
    poly(ctx, Q(-(w + ro + 1.2), (w + ro + 1.2)), shade(P.wall, -0.30));
    if(ro > 0.5){
      poly(ctx, Q(-(w + ro), -(w + 0.15)), shade(P.road, 0.26));
      poly(ctx, Q(w + 0.15, w + ro), shade(P.road, 0.26));
      if(Math.abs(T.curv[i]) > 0.004 && (Math.floor(i / 2) % 2))
        { poly(ctx, Q(-(w + ro), -(w + ro - 0.5)), P.kerbA); poly(ctx, Q(w + ro - 0.5, w + ro), P.kerbA); }
    }
  }

  // asphalt
  const road = wet > 0.05 ? shade(P.road, -0.18 * wet) : P.road;
  poly(ctx, Q(-w, w), groundFill(i % 2 ? road : shade(road, 0.018), "asphalt"));
  // rubbered-in line
  const lo = T.line[i];
  ctx.globalAlpha = 0.16; poly(ctx, Q(lo - 1.7, lo + 1.7), "#141518"); ctx.globalAlpha = 1;
  if(wet > 0.25){ ctx.globalAlpha = 0.17 * wet; poly(ctx, Q(-w, w), "#8FB6CE"); ctx.globalAlpha = 1; }
  if(wet > 0.3){
    const hsh = (i * 2654435761) >>> 0;
    if(hsh % 13 < 4){
      const o = (((hsh >>> 8) % 100) / 100) * (2 * w) - w;
      const rr = 1.1 + (((hsh >>> 16) % 100) / 100) * 2.4;
      const [ppx, ppy] = R.P(...E(i, o));
      ctx.fillStyle = "rgba(146,196,232," + (0.14 + wet * 0.30).toFixed(3) + ")";
      ctx.beginPath(); ctx.ellipse(ppx, ppy, rr * R.zoom * 1.7, rr * R.zoom * 0.85, 0, 0, TAU); ctx.fill();
    }
  }

  // kerbs
  const kk = Math.abs(T.curv[i]);
  if(kk > 0.0032){
    const side = Math.sign(T.curv[i]);
    const col = (Math.floor(i / 2) % 2) ? P.kerbA : P.kerbB;
    poly(ctx, Q(side * w, side * (w + 1.5)), col);
    if(kk > 0.010) poly(ctx, Q(-side * w, -side * (w + 1.5)), (Math.floor(i / 2) % 2) ? P.kerbB : P.kerbA);
  }
  // white lines
  poly(ctx, Q(w - 0.45, w - 0.05), P.line);
  poly(ctx, Q(-(w - 0.05), -(w - 0.45)), P.line);

  // pit lane
  const pr = T.pitRamp(i);
  if(pr > 0.02){
    const sg = T.pitSide;
    const inner = sg * (T.half - 0.05), outer = sg * (T.half + T.pitW * pr);
    const lo2 = Math.min(inner, outer), hi2 = Math.max(inner, outer);
    poly(ctx, Q(lo2, hi2), shade(P.road, 0.11));
    const ol = sg * (T.half + T.pitW * pr - 0.3);
    poly(ctx, Q(Math.min(ol, outer), Math.max(ol, outer)), "#E8EDF3");
    // dashed line separating the lane from the track, once it is fully open
    if(pr > 0.9 && i % 5 < 3){
      const d1 = sg * (T.half + 0.05), d2 = sg * (T.half + 0.45);
      poly(ctx, Q(Math.min(d1, d2), Math.max(d1, d2)), "#E8EDF3");
    }
    // every team's box in the working lane, outlined in its colour; yours filled in yellow
    if(T.pitBoxes && pr > 0.9){
      const me = S.player && S.player.team;
      for(const b of T.pitBoxes){
        let d = i - b.f; if(d > n / 2) d -= n; if(d < -n / 2) d += n;
        if(d < -1.2 || d > 0.6) continue;
        const b1 = sg * (T.half + T.pitWorkOff - 1.9), b2 = sg * (T.half + T.pitWorkOff + 1.9);
        poly(ctx, Q(Math.min(b1, b2), Math.max(b1, b2)), me && b.id === me.id ? "#F2C230" : b.team.body);
        const i1 = sg * (T.half + T.pitWorkOff - 1.4), i2 = sg * (T.half + T.pitWorkOff + 1.4);
        if(!(me && b.id === me.id)) poly(ctx, Q(Math.min(i1, i2), Math.max(i1, i2)), shade(P.road, 0.12));
      }
    }
    // the pit wall, once the lane has fully separated
    if(pr > 0.9){
      const wl = T.pitSide * (T.half + 0.35);
      const [ax3, ay3, az3] = E(i, wl), [bx3, by3, bz3] = E(j, wl);
      poly(ctx, [R.P(ax3, ay3, az3), R.P(bx3, by3, bz3),
                 R.P(bx3, by3, bz3 + 1.0), R.P(ax3, ay3, az3 + 1.0)],
           i % 8 < 4 ? "#D8DCE0" : "#C0242C");
      poly(ctx, [R.P(ax3, ay3, az3 + 1.0), R.P(bx3, by3, bz3 + 1.0),
                 R.P(bx3, by3 + 0.4, bz3 + 1.0), R.P(ax3, ay3 + 0.4, az3 + 1.0)], "#9BA3AB");
    }
    // 60 limiter boards at the lane entry
    if(T.pitU(i) > 0.02 && T.pitU(i) < 0.06 && i % 3 === 0){
      const m1 = sg * (T.half + 1.2), m2 = sg * (T.half + 2.6);
      poly(ctx, Q(Math.min(m1, m2), Math.max(m1, m2)), "#3FA9F5");
    }
  }
  // start / finish
  if(i === 0 || i === 1){
    for(let k = 0; k < 14; k++){
      const o1 = -w + (2 * w) * k / 14, o2 = -w + (2 * w) * (k + 1) / 14;
      poly(ctx, Q(o1, o2), k % 2 ? "#141518" : "#F0F0F0");
    }
  }
  if(i === 3 && S.mode !== "tt"){
    for(let k = 0; k < 11; k++){
      const o = (k % 2 ? 1 : -1) * (w * 0.45), off2 = Math.floor(k / 2) * 0;
      poly(ctx, [R.P(...E((i + k * 2) % n, o - 0.9)), R.P(...E((i + k * 2 + 1) % n, o - 0.9)),
                 R.P(...E((i + k * 2 + 1) % n, o + 0.9)), R.P(...E((i + k * 2) % n, o + 0.9))], "rgba(240,240,240,.55)");
    }
  }
  // driving-line assist
  if(S.assistLine && S.player && !S.player.dnf){
    const dd = ((i - S.player.node + n) % n);
    if(dd < 42){
      const me2 = S.player, boxing = (me2.pitReq && !me2.pitVisit) || me2.pitting;
      const r2 = T.pitRamp(i);
      let alo = lo, col;
      if(boxing && r2 > 0.02){
        alo = lerp(T.line[i], T.pitFast ? T.pitFast(i) : T.pitCentre(i), clamp(r2 * 1.7, 0, 1));
        col = "rgba(63,169,245,.62)";
      } else {
        const v0 = T.vprof[i], soon = T.vprof[(i + 12) % n];
        col = soon < v0 - 9 ? "rgba(255,75,62,.55)" : soon < v0 - 3 ? "rgba(242,194,48,.45)" : "rgba(47,208,122,.30)";
      }
      poly(ctx, Q(alo - 0.55, alo + 0.55), col);
    }
  }
}



export { renderWorld };
