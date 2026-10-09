/* ---- kerbs: where they are, what kind, and how high --------------------------
   One answer for every part of the game: the 3D kerbs are built from it, the car
   body is lifted by it, the physics rattles on it and the 2D painter can read it.
   Before this, the drawn kerbs (corners only) and the physics' kerb band (every
   node, half-0.4 .. half+1.6) disagreed, so cars rattled on kerbs nobody could see.

   Per node and side (R = positive offsets, L = negative), T.kerbR / T.kerbL hold:
     0 none
     1 flat: a painted kerb, a centimetre proud (fast sweepers)
     2 ridged: the serrated F1 kerb, rising to 25 mm with 12 mm ribs across it
     3 ridged, with a sausage kerb behind it: a 10 cm yellow hump at the back of
       the kerb at the slowest apexes, there to stop cars cutting further
   Presence follows the old drawn rule exactly: the inside of a corner (the side
   its curvature points to) where |curv| > 0.0032, the outside where |curv| > 0.010,
   never on the pit side where the lane opens, never in a tunnel. A one-node gap in
   a run is filled so a kerb does not stutter.

   Lateral profile, u metres out from the road edge (T.half):
     u 0 .. 1.5    the kerb (KW)
     u 1.55 .. 2.05  the sausage, where kind 3 (SAUS0 .. SAUS1)            */
const KW = 1.5, SAUS0 = 1.55, SAUS1 = 2.05;
const FLAT_H = 0.012, RIDGE_H = 0.025, RIB_H = 0.012, RIB_P = 0.6, SAUS_H = 0.10;

function smooth01(x){ x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); }

/* the kerb's smooth height (no ribs) at u metres out from the road edge, for a kind */
function kerbProfile(kind, u){
  if(!kind || u < -0.02) return 0;
  if(kind === 1) return u <= KW ? FLAT_H * smooth01((u + 0.02) / 0.05) * smooth01((KW + 0.03 - u) / 0.05) : 0;
  let h = 0;
  if(u <= KW + 0.05) h = RIDGE_H * smooth01(u / 0.35) * smooth01((KW + 0.05 - u) / 0.12);
  if(kind === 3 && u >= SAUS0 && u <= SAUS1){
    const t = (u - SAUS0) / (SAUS1 - SAUS0);
    h = Math.max(h, SAUS_H * Math.sqrt(Math.max(0, 1 - (2 * t - 1) ** 2)));      // a half-round hump
  }
  return h;
}
/* the ribs across a ridged kerb: s is metres along the lap; 0..1, a sawtooth with a short back */
function rib(s){ const f = ((s / RIB_P) % 1 + 1) % 1; return f < 0.7 ? f / 0.7 : (1 - f) / 0.3; }

function addKerbs(T){
  const n = T.n, def = T.def || {};
  const L = new Uint8Array(n), R = new Uint8Array(n);
  const pitOn = i => T.pitRamp && T.pitRamp(i) > 0.02;
  const tunnel = i => T.inTunnel && T.inTunnel(i);
  const ac = i => Math.abs(T.curv[i]);
  for(let i = 0; i < n; i++){
    if(tunnel(i)) continue;
    const s = Math.sign(T.curv[i]) || 1;
    for(const [arr, sd] of [[R, 1], [L, -1]]){
      const inside = sd === s;
      const on = inside ? ac(i) > 0.0032 : ac(i) > 0.010;
      if(!on) continue;
      if(pitOn(i) && sd === T.pitSide) continue;
      arr[i] = ac(i) > 0.0065 ? 2 : 1;
    }
  }
  // fill one-node gaps so a kerb run does not stutter
  for(const arr of [L, R]){
    for(let i = 0; i < n; i++){
      const a = arr[(i - 1 + n) % n], b = arr[(i + 1) % n];
      if(!arr[i] && a && b && !tunnel(i)) arr[i] = Math.min(a, b);
    }
  }
  // sausage kerbs behind the inside kerb at the slowest apexes (|curv| > 0.016 is under ~60 m radius),
  // at the node of greatest curvature within +-4 and its neighbours; not on the street circuits
  if(T.barrier !== "wall"){
    for(let i = 0; i < n; i++){
      if(ac(i) <= 0.016) continue;
      let peak = true;
      for(let o = -4; o <= 4 && peak; o++) if(o && ac((i + o + n) % n) > ac(i)) peak = false;
      if(!peak) continue;
      const arr = T.curv[i] > 0 ? R : L;
      for(let o = -1; o <= 1; o++){ const k = (i + o + n) % n; if(arr[k] >= 2) arr[k] = 3; }
    }
  }
  T.kerbL = L; T.kerbR = R;
  T.kerbKind = (i, off) => (off >= 0 ? R : L)[i];
  // the smooth height of the kerb above the road plane at a node and offset (0 off the kerb)
  T.kerbH = (i, off) => kerbProfile((off >= 0 ? R : L)[i], Math.abs(off) - T.half);
  // the same with the ribs, at s metres along the lap (for the shake and the drawn shape)
  T.kerbHr = (i, off, s) => {
    const k = (off >= 0 ? R : L)[i], u = Math.abs(off) - T.half;
    let h = kerbProfile(k, u);
    if(k >= 2 && u > 0.25 && u < KW - 0.05) h += RIB_H * rib(s) * smooth01((u - 0.25) / 0.2) * smooth01((KW - 0.05 - u) / 0.2);
    return h;
  };
  return T;
}

export { addKerbs, kerbProfile, rib, KW, SAUS0, SAUS1, FLAT_H, RIDGE_H, RIB_H, RIB_P, SAUS_H };
