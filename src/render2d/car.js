import { TAU, clamp, shade } from '../config/util.js';
import { CAR_SPEC } from '../car/spec.js';
import { ISX, ISY, R } from './view.js';
import { box, boxCol } from './props.js';
import { stopPose } from '../car/pitstop.js';

/* a box in world space with full orientation — yaw, plus the body roll and pitch
   of whichever car is being drawn, so a tumbling car reads properly */
let BR = 0, BP = 0;

function drawCar(ctx, c, T, S, isPlayer){
  const sun = T.sun, ang = c.h, ca = Math.cos(ang), sa = Math.sin(ang);
  BR = c.roll || 0; BP = c.pitch || 0;
  const gone = c.broken || new Set();
  const t = c.team, lean = clamp(c.steer * 0.05 + c.slide * 0.04, -0.09, 0.09);
  const L = (fx, fy) => [c.x + fx * ca - fy * sa, c.y + fx * sa + fy * ca];

  // ---- pit stop: jacked up, wheels off, crew round the car (the same timeline as the 3D stop, car/pitstop.js) ----
  const st = c.pp && c.pp.phase === "stopped" ? c.pp.st : null;
  let stopping = 0, stotal = 1, lift = 0, wheelOut = 0, sp = 0, green = false;
  if(st){
    const po = stopPose(st, R._po || (R._po = {}));
    stotal = st.go + st.hold; stopping = Math.max(0.001, stotal - st.t); sp = clamp(st.t / stotal, 0, 1);
    lift = 0.06 * Math.max(po.jackF, po.jackR);
    wheelOut = [po.c0, po.c1, po.c2, po.c3].some(q => q >= 1 && q < 2) ? 0.55 : 0;
    green = po.light > 0;
  }

  // shadow
  const air = c.air || 0;
  const skipShadow = R.persp && R.fwdOf(c.x, c.y) < 3;
  const [sx0, sy0] = R.P(c.x, c.y, c.z - air);
  ctx.fillStyle = T.night ? "rgba(0,0,0,.42)" : "rgba(16,20,14,.30)";
  ctx.globalAlpha = skipShadow ? 0 : clamp(1 - air / 6, 0.15, 1);
  ctx.save(); ctx.translate(sx0, sy0 + R.zoom * 0.2);
  ctx.rotate(Math.atan2(Math.sin(ang) * ISY, Math.cos(ang) * ISX) * 0 + 0);
  const shK = clamp(1 + air / 9, 1, 1.5);
  let shRX = R.zoom * 2.7 * shK, shRY = R.zoom * 1.25 * shK;
  if(R.persp){
    // the ground is nearly edge-on through a lens, so a shadow is a thin sliver,
    // not the near-circle that works from overhead
    const f2 = Math.max(R.fwdOf(c.x, c.y), 2.5);
    shRX = R.zoom * 1.5 * shK;
    shRY = shRX * clamp(Math.max(R.fz - c.z, 0.4) / f2, 0.04, 0.6);
  }
  ctx.beginPath(); ctx.ellipse(0, 0, shRX, shRY, 0, 0, TAU); ctx.fill(); ctx.restore();
  ctx.globalAlpha = 1;

  const z = c.z + 0.02 + lift;
  const wheelCol = "#15181C", CS = CAR_SPEC, X = CS.X, Zh = CS.Z, Yw = CS.Y;
  // rear + front wheels, in the same places as the 3D car's (rear right, rear left, front right, front left)
  const bentWheel = gone.has("susp") ? (c.idx % 4) : -1;
  let wheelIdx = -1;
  for(const [ax, sdw] of [[CS.rear, 1], [CS.rear, -1], [CS.front, 1], [CS.front, -1]]){
    wheelIdx++;
    const bent = wheelIdx === bentWheel, fx = ax.x, fy = ax.y * sdw;
    const [wx, wy] = L(fx, fy + Math.sign(fy) * (wheelOut + (bent ? 0.34 : 0)));
    const flatTyre = gone.has("punct") && wheelIdx === ((c.idx + 1) % 4);
    const saveR = BR; if(bent) BR += 0.42;
    box(ctx, wx, wy, z - (flatTyre ? 0.12 : 0), ax.r * 2, ax.w, ax.r * 2 * (flatTyre ? 0.7 : 1),
        ang + (bent ? 0.3 : 0), shade(t.wheel, 0.05), wheelCol, sun);
    BR = saveR;
  }
  // floor, then the tub from the nose back
  const bodyTopLift = t.finish === "matte" ? 0.07 : t.finish === "satin" ? 0.13 : 0.2;
  const seg = (d0, d1) => [(X(d0) + X(d1)) / 2, X(d0) - X(d1)];
  { const [fx, l] = seg(0.35, 3.30); boxCol(ctx, ...L(fx, 0), z, l, Yw(1.46), Zh(0.05), ang, "#17191D", sun, 0.05); }
  { const [fx, l] = seg(0.35, 1.62); boxCol(ctx, ...L(fx, 0), z + Zh(0.07), l, Yw(0.62), Zh(0.52), ang, t.body, sun, bodyTopLift); }
  // sidepods: a full inlet section and a tapering tail
  for(const sd of [-1, 1]){
    const [f1, l1] = seg(1.18, 2.20), [f2, l2] = seg(2.20, 3.10);
    boxCol(ctx, ...L(f1, sd * Yw(0.46)), z + Zh(0.10), l1, Yw(0.46), Zh(0.46), ang, shade(t.body, -0.06), sun, bodyTopLift);
    boxCol(ctx, ...L(f2, sd * Yw(0.34)), z + Zh(0.08), l2, Yw(0.30), Zh(0.32), ang, t.accent2 || t.accent, sun, bodyTopLift);
  }
  // the nose: a wide root and a low, narrow tip in the contrast colour
  { const [fx, l] = seg(-0.30, 0.40); boxCol(ctx, ...L(fx, 0), z + Zh(0.17), l, Yw(0.38), Zh(0.34), ang, t.body, sun, bodyTopLift); }
  { const [fx, l] = seg(-0.98, -0.30); boxCol(ctx, ...L(fx, 0), z + Zh(0.14), l, Yw(0.24), Zh(0.20), ang, t.accent, sun, bodyTopLift); }
  if(!gone.has("wing")){
    const [fx, l] = seg(-1.05, -0.50), sp = CS.fw.span;
    boxCol(ctx, ...L(fx, 0), z + Zh(0.06), l, sp, Zh(0.10), ang, t.accent, sun, 0.16);
    boxCol(ctx, ...L(X(-0.62), 0), z + Zh(0.16), Zh(0.14), sp * 0.96, Zh(0.08), ang, t.body, sun, 0.16);
    for(const sd of [-1, 1]) boxCol(ctx, ...L(fx, sd * sp / 2), z + Zh(0.05), l + 0.04, 0.05, Zh(0.30), ang, t.accent2 || t.accent, sun, 0.2);
  } else {
    // stub and a dangling endplate
    boxCol(ctx, ...L(X(-0.85), 0), z + 0.04, 0.30, 0.70, 0.09, ang, shade(t.carbon, -0.1), sun, 0.05);
    boxCol(ctx, ...L(X(-0.78), -0.52), z - 0.02, 0.44, 0.08, 0.24, ang, t.accent2 || t.accent, sun, 0.1);
  }
  // engine cover, airbox and T-cam
  { const [fx, l] = seg(1.62, 3.45); boxCol(ctx, ...L(fx, 0), z + Zh(0.08), l, Yw(0.44), Zh(0.52), ang, t.body, sun, bodyTopLift); }
  boxCol(ctx, ...L(X(1.95), 0), z + Zh(0.58), 0.46, Yw(0.36), Zh(0.34), ang, t.body, sun, bodyTopLift);
  boxCol(ctx, ...L(X(1.80), 0), z + Zh(0.93), 0.10, Yw(0.20), Zh(0.05), ang, c.drv.cam, sun, 0.24);   // T-cam
  boxCol(ctx, ...L(X(2.7), 0), z + Zh(0.60), 1.1, 0.06, Zh(0.14), ang, t.accent, sun, 0.2);          // spine stripe / fin
  // suspension wishbones, from the tub to each wheel
  for(const [ax, sd] of [[CS.front, 1], [CS.front, -1], [CS.rear, 1], [CS.rear, -1]]){
    const ax2 = ax.x + (ax === CS.front ? -0.35 : 0.33), ay2 = sd * 0.35, bx2 = ax.x, by2 = sd * (ax.y - ax.w / 2);
    const mxl = (ax2 + bx2) / 2, myl = (ay2 + by2) / 2, len = Math.hypot(bx2 - ax2, by2 - ay2);
    const armAng = ang + Math.atan2(by2 - ay2, bx2 - ax2);
    boxCol(ctx, ...L(mxl, myl), z + 0.18, len, 0.06, 0.06, armAng, "#1E2228", sun, 0.1);
    boxCol(ctx, ...L(mxl, myl), z + 0.38, len * 0.9, 0.05, 0.05, armAng, "#1E2228", sun, 0.1);
  }
  // mirrors
  for(const sd of [-1, 1]) boxCol(ctx, ...L(X(1.03), sd * Yw(0.57)), z + Zh(0.58), 0.10, 0.16, 0.08, ang, t.body, sun, 0.18);
  // diffuser
  { const [fx, l] = seg(3.25, 3.95); boxCol(ctx, ...L(fx, 0), z + 0.02, l, Yw(1.0), Zh(0.26), ang, shade(t.carbon, -0.12), sun, 0.06); }
  // cockpit, helmet and halo
  boxCol(ctx, ...L(X(1.30), 0), z + Zh(0.56), 0.56, Yw(0.50), Zh(0.08), ang, "#0C0E11", sun, 0.05);
  boxCol(ctx, ...L(CS.helmet.x, 0), z + Zh(0.66), 0.24, 0.24, Zh(0.25), ang, c.drv.cam, sun, 0.2);     // helmet
  boxCol(ctx, ...L(X(1.00), 0), z + Zh(0.64), 0.08, 0.08, Zh(0.30), ang, "#1A1D21", sun, 0.1);         // halo pillar
  for(const sd of [-1, 1]) boxCol(ctx, ...L(X(1.30), sd * Yw(0.26)), z + Zh(0.84), 0.62, 0.07, Zh(0.10), ang, "#1A1D21", sun, 0.1);
  // 2026 active aero: the flap lies flat under override
  const flat = c.boost > 0 && c.batt > 0.01;
  if(!gone.has("rear")){
    const [fx, l] = seg(3.93, 4.45), sp = CS.rw.span, top = CS.rw.top;
    boxCol(ctx, ...L(X(4.05), 0), z + Zh(0.30), 0.14, 0.12, Zh(0.44), ang, t.carbon, sun, 0.12);            // swan neck
    boxCol(ctx, ...L(X(4.05), 0), z + Zh(0.70), Zh(0.30), sp, Zh(0.07), ang, t.accent, sun, 0.2);          // main plane
    boxCol(ctx, ...L(X(4.30), 0), z + (flat ? Zh(0.80) : Zh(0.82)), flat ? Zh(0.25) : Zh(0.12), sp, flat ? Zh(0.04) : Zh(0.16), ang, t.accent, sun, 0.2);
    for(const sd of [-1, 1]) boxCol(ctx, ...L(fx, sd * sp / 2), z + Zh(0.34), l, 0.05, top - Zh(0.34), ang, t.accent2 || t.accent, sun, 0.16);
  } else {
    boxCol(ctx, ...L(X(4.05), 0), z + 0.30, 0.18, 0.5, 0.30, ang, shade(t.carbon, -0.15), sun, 0.05);
  }
  // rain light + override glow
  const [rx, ry] = R.P(...L(X(4.21), 0), z + Zh(0.28));
  if(S.wet > 0.2 || T.night){ ctx.fillStyle = "rgba(255,60,40,.9)";
    ctx.beginPath(); ctx.arc(rx, ry, Math.max(1.4, R.zoom * 0.30), 0, TAU); ctx.fill(); }
  if(flat){ const g = ctx.createRadialGradient(rx, ry, 0, rx, ry, R.zoom * 4);
    g.addColorStop(0, "rgba(55,214,232,.55)"); g.addColorStop(1, "rgba(55,214,232,0)");
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(rx, ry, R.zoom * 4, 0, TAU); ctx.fill(); }

  // crew, jacks and the release light
  if(stopping > 0){
    const jackDrop = lift > 0.02 ? 0 : 0.2;
    boxCol(ctx, ...L(3.35, 0), c.z, 1.5, 0.30, 0.28 + lift, ang, "#3A424C", sun, 0.2);
    boxCol(ctx, ...L(-3.35, 0), c.z, 1.5, 0.30, 0.28 + lift, ang, "#3A424C", sun, 0.2);
    const crew = [[1.75, 1.85], [1.75, -1.85], [-1.75, 1.85], [-1.75, -1.85],
                  [2.9, 1.1], [2.9, -1.1], [-0.2, 2.3], [-0.2, -2.3]];
    for(let q = 0; q < crew.length; q++){
      const bob = Math.sin(S.clock * 14 + q) * 0.06 * (wheelOut > 0.1 ? 1 : 0.2);
      const [mx, my] = L(crew[q][0], crew[q][1] + (wheelOut > 0.1 ? Math.sign(crew[q][1]) * 0.15 : 0));
      boxCol(ctx, mx, my, c.z, 0.52, 0.46, 1.62 + bob, ang, q % 2 ? t.body : t.carbon, sun, 0.24);
      boxCol(ctx, mx, my, c.z + 1.62 + bob, 0.44, 0.40, 0.34, ang, t.accent, sun, 0.26);
    }
    const [lx, ly] = R.P(c.x, c.y, c.z + 4.4);
    boxCol(ctx, ...L(0, 2.9), c.z, 0.26, 0.26, 4.2, ang, "#2C333B", sun, 0.2);

    ctx.fillStyle = green ? "#2FD07A" : "#FF4B3E";
    ctx.beginPath(); ctx.arc(lx, ly, Math.max(2.6, R.zoom * 0.62), 0, TAU); ctx.fill();
    const glow = ctx.createRadialGradient(lx, ly, 0, lx, ly, R.zoom * 4);
    glow.addColorStop(0, green ? "rgba(47,208,122,.5)" : "rgba(255,75,62,.45)");
    glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(lx, ly, R.zoom * 4, 0, TAU); ctx.fill();
    if(isPlayer){
      ctx.font = "700 13px 'Roboto Mono',ui-monospace,monospace";
      ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
      ctx.fillStyle = "#E8EDF3";
      ctx.fillText(st.t.toFixed(1) + "s", lx, ly - R.zoom * 1.6);
    }
  }

  BR = 0; BP = 0;
  // number tag
  if(R.zoom > 4.2){
    const [tx, ty] = R.P(c.x, c.y, c.z + 2.6);
    const w = 17, h = 13;
    ctx.globalAlpha = isPlayer ? 1 : 0.82;
    ctx.fillStyle = isPlayer ? "#FFA51F" : "rgba(11,14,18,.82)";
    ctx.fillRect(tx - w / 2, ty - h, w, h);
    ctx.fillStyle = t.body === "#E4E7EA" || t.body === "#B9C2CA" ? "#1C1F24" : t.body;
    ctx.fillRect(tx - w / 2, ty - h, 3, h);
    ctx.fillStyle = isPlayer ? "#1A1200" : "#E8EDF3";
    ctx.font = "700 10px 'Saira Condensed',sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(c.drv.abbr, tx + 1.5, ty - h / 2 + 0.5);
    ctx.globalAlpha = 1;
  }
}

export { BP, BR, drawCar };
