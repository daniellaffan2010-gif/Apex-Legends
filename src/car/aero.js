/* Slipstream and dirty air.
   A car running close behind another sits in its wake, and the wake does two things at once:
     tow    - less air to push through: less drag and a little more top speed down the straights
     dirty  - turbulent air: less downforce, so less grip in the corners, hotter and faster-wearing tyres
   Both are 0..1 per car (c.tow, c.dirty), measured once a frame from the car directly ahead and
   eased in and out so the effect builds and fades instead of snapping. physics.js reads them (for the
   player and for the rivals alike), and the rival driver reads them to choose its pace and its moment. */

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

const REACH = 42;                 // metres behind a car that its wake is still felt
const TOW_EFFECT = { drag: 0.42, top: 0.022 };
const DIRTY_EFFECT = { grip: 0.13, heat: 0.55, wear: 0.35 };

const speedOf = o => (o.ai && o.railV != null) ? o.railV : Math.hypot(o.vx || 0, o.vy || 0);
const running = o => !o.dnf && !o.wrecked && !o.finished && !o.pitting && !o.inPit && !(o.spinT > 0);

/* How strongly a wake of this size, this far ahead and this far to one side reaches the car behind. */
function wake(gap, lat, leaderV){
  if(gap <= 0.5 || gap >= REACH) return { tow: 0, dirty: 0 };
  const aligned = 1 - smooth(0.9, 3.8, lat);                  // a car width off the line and the wake slides past
  if(aligned <= 0) return { tow: 0, dirty: 0 };
  const sp = smooth(28, 62, leaderV);                         // no tow in the slow stuff
  // the tow is deepest in the pocket just behind the gearbox and thins out with distance
  const tow = aligned * sp * smooth(REACH, 14, gap);
  // dirty air is a closer-range problem: it bites inside ~30 m and is worst nose to tail
  const dirty = aligned * smooth(30, 8, gap) * smooth(14, 40, leaderV);
  return { tow, dirty };
}

/* The nearest running car ahead of c on track, by arc length, wrapping the lap. */
function leaderOf(S, c){
  const L = c.T.length;
  let best = null, bd = REACH;
  for(const o of S.cars){
    if(o === c || !running(o)) continue;
    let d = o.s - c.s;
    d -= Math.round(d / L) * L;                               // -L/2 .. L/2
    if(d > 0 && d < bd){ bd = d; best = o; }
  }
  return best ? { car: best, gap: bd } : null;
}

function update(S, dt){
  if(S.state === "lights") return clear(S);
  if(!(dt > 0)) return;
  for(const c of S.cars){
    let tow = 0, dirty = 0;
    if(running(c)){
      const ld = leaderOf(S, c);
      if(ld){
        const w = wake(ld.gap, Math.abs(ld.car.off - c.off), speedOf(ld.car));
        tow = w.tow; dirty = w.dirty;
        c.wakeOf = ld.car; c.wakeGap = ld.gap;
      } else { c.wakeOf = null; c.wakeGap = null; }
    } else { c.wakeOf = null; c.wakeGap = null; }
    // builds over about half a second, fades a little quicker
    const kUp = 1 - Math.exp(-dt * 2.6), kDn = 1 - Math.exp(-dt * 4.2);
    const t0 = c.tow || 0, d0 = c.dirty || 0;
    c.tow = t0 + (tow - t0) * (tow > t0 ? kUp : kDn);
    c.dirty = d0 + (dirty - d0) * (dirty > d0 ? kUp : kDn);
    if(c.tow < 0.002) c.tow = 0;
    if(c.dirty < 0.002) c.dirty = 0;
  }
}

function clear(S){
  for(const c of S.cars){ c.tow = 0; c.dirty = 0; c.wakeOf = null; c.wakeGap = null; }
}

/* What the wake costs or gives, in the multipliers the physics and the driver apply. */
const dragK = c => 1 - TOW_EFFECT.drag * (c.tow || 0);
const topK = c => 1 + TOW_EFFECT.top * (c.tow || 0);
const gripK = c => 1 - DIRTY_EFFECT.grip * (c.dirty || 0);
const heat = c => DIRTY_EFFECT.heat * (c.dirty || 0);          // extra tyre heating per second
const wearK = c => 1 + DIRTY_EFFECT.wear * (c.dirty || 0);

export { REACH, TOW_EFFECT, DIRTY_EFFECT, dragK, gripK, heat, leaderOf, topK, update, wake, wearK };
