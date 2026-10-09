import * as THREE from 'three';
import { clamp, fmtTime } from '../config/util.js';
import { CAR_SPEC } from '../car/spec.js';
import { rpmOfCar } from '../car/physics.js';
import { CARGEO } from './car.js';

/* ---- the cockpit, for the player's own car in the driver's-eye view ---------
   Only built for the player and only shown in the cockpit view. Everything is
   placed in the car's real-world frame (d = metres behind the front axle, y out,
   z up) and mapped into the car model's frame, so it sits where the body is:
     - the cockpit well under the opening in the player's body, its padded
       rim, the bulkhead and column, and the driver's legs and knees;
     - the steering wheel on its column, tilted to face the driver: grips,
       gloves, a live display (gear, speed, lap time, battery, override), a row
       of fifteen shift lights, buttons, rotaries, thumb toggles and paddles,
       turning with the steering (75 degrees at full lock slowly, 30 flat out);
     - the forearms, from the elbows to the gloves, following the wheel;
     - the halo's centre pillar, see-through: two eyes look past a real one, a
       single lens cannot, and solid it would blank out the middle of the road. */
const S0 = CAR_SPEC, SC = S0.S, LX = S0.LX;
const WHEEL = { d:0.99, z:0.615, tilt:24 * Math.PI / 180, lock:1.30 };   // centre, face tilt (top away from the driver), wheel turn at full lock
const ELBOW = { d:1.20, y:0.215, z:0.46 };   // the forearms come up out of the cockpit to the wheel

// a list of coloured pieces merged into one geometry
function Pieces(){ this.list = []; }
Pieces.prototype.add = function(geo, col, m){
  let g = geo.index ? geo.toNonIndexed() : geo;
  if(m) g.applyMatrix4(m);
  const n = g.attributes.position.count, c = new Float32Array(n * 3);
  for(let i = 0; i < n; i++){ c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b; }
  g.setAttribute("color", new THREE.BufferAttribute(c, 3));
  this.list.push(g);
};
Pieces.prototype.geometry = function(){
  let n = 0; for(const g of this.list) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  let o = 0;
  for(const g of this.list){ pos.set(g.attributes.position.array, o * 3); col.set(g.attributes.color.array, o * 3); o += g.attributes.position.count; g.dispose(); }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  out.setAttribute("color", new THREE.BufferAttribute(col, 3));
  out.computeVertexNormals(); out.computeBoundingSphere();
  return out;
};
// a point of the car's real-world frame in the model's frame
const P3 = (d, y, z) => new THREE.Vector3(S0.X(d), S0.Z(z), S0.Y(y));
// a box given in real metres (length along d, width along y, height along z) at a real-world centre
function box(pc, d, y, z, l, w, h, col, rotZ){
  const g = new THREE.BoxGeometry(l * SC, h * SC, w * SC * LX), m = new THREE.Matrix4();
  if(rotZ) m.makeRotationZ(rotZ);
  m.setPosition(P3(d, y, z));
  pc.add(g, col, m);
}
// a tube between two real-world points
function rod(pc, a, b, r, col, sides){
  const A = P3(...a), B = P3(...b), L = A.distanceTo(B);
  const g = new THREE.CylinderGeometry(r * SC, r * SC, L, sides || 8, 1);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
  pc.add(g, col, new THREE.Matrix4().compose(A.clone().add(B).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
}

const COCKPIT = {
  /* the display and the shift lights share one canvas: display above, LEDs in the bottom strip */
  canvas(){
    const cv = document.createElement("canvas"); cv.width = 256; cv.height = 160;
    const tx = new THREE.CanvasTexture(cv); tx.encoding = THREE.sRGBEncoding;
    return { cv, ctx:cv.getContext("2d"), tx };
  },
  build(G, c, g){
    const t = c.team, col = x => G.col(x);
    const carbon = col(t.carbon || "#1A1D22"), suit = col(t.body), suit2 = col(t.accent || t.body);
    const pad = col("#24272C"), black = col("#0D0F12"), rubber = col("#2A2D31");
    const root = new THREE.Group(); root.name = "cockpit";
    const mat = new THREE.MeshStandardMaterial({ vertexColors:true, flatShading:true, roughness:0.62, metalness:0.08 });

    /* The cockpit: the player's body has its top open between the bulkhead and
       the headrest (CARGEO.cockpit), so this is the well under it, its padded
       rim, the bulkhead the wheel hangs from, and the driver's knees, which are
       what you see under the wheel. */
    const pc = new Pieces(), O = 0.245, Z0 = 0.30, ZT = 0.64;   // the opening's half width and the well's floor and lip
    for(const sd of [-1, 1]){
      box(pc, 1.29, (O + 0.01) * sd, (Z0 + ZT) / 2, 0.70, 0.02, ZT - Z0, black);           // a side wall
      rod(pc, [0.95, O * sd, ZT + 0.012], [1.62, O * sd, ZT + 0.012], 0.024, pad, 8);      // the padded rim along it
      rod(pc, [1.05, 0.09 * sd, 0.46], [1.40, 0.11 * sd, 0.40], 0.055, suit, 8);           // a thigh
      rod(pc, [0.80, 0.075 * sd, 0.50], [1.05, 0.09 * sd, 0.47], 0.05, suit, 8);           // a shin, into the nose
      box(pc, 1.05, 0.09 * sd, 0.475, 0.11, 0.12, 0.10, suit2);                             // a knee pad
    }
    box(pc, 1.29, 0, Z0 - 0.01, 0.70, O * 2 + 0.04, 0.02, black);                          // the floor
    // the front of the well, floor to rim: without it you look down past the wheel and out through the nose
    box(pc, 0.945, 0, (Z0 + ZT) / 2, 0.02, O * 2 + 0.04, ZT - Z0 + 0.02, black);
    box(pc, 1.61, 0, (Z0 + ZT) / 2 + 0.02, 0.03, O * 2, ZT - Z0 + 0.04, pad);              // the seat back
    box(pc, 1.47, 0, 0.47, 0.22, 0.30, 0.30, suit);                                         // the driver's body
    rod(pc, [0.95, -O, ZT + 0.012], [0.95, O, ZT + 0.012], 0.024, pad, 8);                  // the rim across the front
    box(pc, 0.925, 0, 0.58, 0.06, O * 2, 0.12, carbon);                                     // the bulkhead the wheel hangs from
    rod(pc, [0.90, 0, 0.59], [WHEEL.d + 0.01, 0, WHEEL.z], 0.017, col("#3A3E44"), 8);       // the column
    const shell = new THREE.Mesh(pc.geometry(), mat); shell.name = "cockpit-shell";
    root.add(shell);

    /* the wheel, in its own frame: x to the driver's right, y up the face, z towards the driver */
    const w = new Pieces(), m = new THREE.Matrix4();
    const at = (x, y, z, rx) => { m.identity(); if(rx) m.makeRotationX(rx); m.setPosition(x, y, z); return m.clone(); };
    const sh = new THREE.Shape();
    const outline = [[-0.100, 0.066], [0.100, 0.066], [0.128, 0.052], [0.146, 0.010], [0.144, -0.066], [0.124, -0.094], [0.098, -0.088],
                     [0.088, -0.046], [0.056, -0.054], [-0.056, -0.054], [-0.088, -0.046], [-0.098, -0.088], [-0.124, -0.094], [-0.144, -0.066], [-0.146, 0.010], [-0.128, 0.052]];
    sh.moveTo(...outline[0]); for(let i = 1; i < outline.length; i++) sh.lineTo(...outline[i]); sh.closePath();
    const plate = new THREE.ExtrudeGeometry(sh, { depth:0.024, bevelEnabled:false });
    w.add(plate, col("#17191D"), at(0, 0, -0.012));
    w.add(new THREE.BoxGeometry(0.106, 0.062, 0.004), black, at(0, 0.020, 0.013));          // the display's bezel
    w.add(new THREE.BoxGeometry(0.166, 0.016, 0.004), black, at(0, 0.056, 0.013));          // the shift-light strip's bezel
    for(const sd of [-1, 1]){
      w.add(new THREE.CylinderGeometry(0.023, 0.021, 0.112, 10), rubber, at(0.124 * sd, -0.028, 0.0));          // a grip
      w.add(new THREE.BoxGeometry(0.004, 0.11, 0.07), col("#2E3238"), at(0.084 * sd, 0.034, -0.032));            // a paddle, peeking over the top
    }
    const buttons = [[-0.074, 0.034, "#2F7FE0"], [-0.074, 0.008, "#2FC060"], [-0.062, -0.018, "#F2F2F2"],
                     [0.074, 0.034, "#FF8A1F"], [0.074, 0.008, "#E0302A"], [0.062, -0.018, "#F6D23A"],
                     [-0.024, -0.024, "#9A5BE0"], [0.024, -0.024, "#40D0E0"]];
    for(const [x, y, c2] of buttons) w.add(new THREE.CylinderGeometry(0.0072, 0.0078, 0.006, 10), col(c2), at(x, y, 0.014, Math.PI / 2));
    const rot = [[-0.046, -0.040, "#F6D23A"], [-0.015, -0.044, "#F2F2F2"], [0.015, -0.044, "#E0302A"], [0.046, -0.040, "#2F7FE0"]];
    for(const [x, y, c2] of rot){
      w.add(new THREE.CylinderGeometry(0.0105, 0.0115, 0.013, 12), col("#30343A"), at(x, y, 0.017, Math.PI / 2));   // a rotary
      w.add(new THREE.BoxGeometry(0.0028, 0.0085, 0.002), col(c2), at(x, y + 0.004, 0.0245));                       // its index
    }
    for(const sd of [-1, 1]) w.add(new THREE.CylinderGeometry(0.0055, 0.0055, 0.016, 8), col("#C9CDD2"), at(0.036 * sd, 0.046, 0.016, Math.PI / 2));  // thumb toggles
    w.add(new THREE.CylinderGeometry(0.027, 0.027, 0.03, 12), col("#3A3E44"), at(0, 0, -0.03, Math.PI / 2));   // the quick-release hub
    // the gloves round the grips, thumbs over the face
    const glove = col("#202328"), cuff = col("#15171A");
    for(const sd of [-1, 1]){
      w.add(new THREE.BoxGeometry(0.056, 0.084, 0.060), glove, at(0.126 * sd, -0.020, 0.004));
      w.add(new THREE.BoxGeometry(0.030, 0.022, 0.020), glove, at(0.100 * sd, 0.026, 0.016));
      w.add(new THREE.BoxGeometry(0.060, 0.030, 0.064), cuff, at(0.130 * sd, -0.068, 0.020));
    }
    const wheelMesh = new THREE.Mesh(w.geometry(), mat); wheelMesh.name = "steering-wheel";
    // the live display and the lights: one canvas, two quads
    const D = this.canvas();
    const scr = new THREE.MeshBasicMaterial({ map:D.tx, toneMapped:false });
    const quad = (wd, ht, v0, v1, y) => {
      const q = new THREE.PlaneGeometry(wd, ht), uv = q.attributes.uv;
      for(let i = 0; i < uv.count; i++) uv.setY(i, v0 + uv.getY(i) * (v1 - v0));
      const mm = new THREE.Mesh(q, scr); mm.position.set(0, y, 0.0154); return mm;
    };
    const turn = new THREE.Group(); turn.name = "wheel-turn";
    turn.add(wheelMesh, quad(0.096, 0.054, 0.2, 1, 0.020), quad(0.156, 0.0105, 0, 0.12, 0.056));
    const mount = new THREE.Group();
    // the wheel's frame in the car's: x out to the driver's right (+z of the model), y up the tilted face, z back at the driver
    const tl = WHEEL.tilt;
    mount.matrix.makeBasis(new THREE.Vector3(0, 0, 1), new THREE.Vector3(Math.sin(tl), Math.cos(tl), 0), new THREE.Vector3(-Math.cos(tl), Math.sin(tl), 0));
    mount.matrix.setPosition(P3(WHEEL.d, 0, WHEEL.z));
    mount.matrixAutoUpdate = false;
    mount.add(turn); root.add(mount);

    /* the forearms: a sleeve from each elbow to the cuff, re-aimed every frame */
    const armGeo = new THREE.CylinderGeometry(0.030, 0.036, 1, 9); armGeo.rotateX(Math.PI / 2); armGeo.translate(0, 0, 0.5);
    const armMat = new THREE.MeshStandardMaterial({ color:suit, roughness:0.85, flatShading:true });
    const arms = [-1, 1].map(sd => { const a = new THREE.Mesh(armGeo, armMat); a.position.copy(P3(ELBOW.d, ELBOW.y * sd, ELBOW.z)); root.add(a); return a; });
    const wrists = [-1, 1].map(sd => { const o = new THREE.Object3D(); o.position.set(0.13 * sd, -0.08, 0.045); turn.add(o); return o; });

    /* the halo's centre pillar, see-through */
    const b = CARGEO.soup(), H = S0.R.haloTop;
    CARGEO.tube(b, [1.00, 0, H], [0.92, 0, 0.78], 0.011, carbon, 8);
    CARGEO.tube(b, [0.92, 0, 0.78], [0.86, 0, 0.64], 0.012, carbon, 8);
    const ghost = new THREE.Mesh(CARGEO.geo(b), new THREE.MeshStandardMaterial({ vertexColors:true, flatShading:true, roughness:0.5, transparent:true, opacity:0.3, depthWrite:false }));
    ghost.name = "halo-pillar-ghost"; ghost.renderOrder = 2;
    root.add(ghost);

    for(const o of [shell, wheelMesh, ...arms]) o.castShadow = o.receiveShadow = false;
    root.visible = false;
    g.add(root);
    return { root, turn, arms, wrists, D, last:-1, v:new THREE.Vector3(), q:new THREE.Quaternion(), z:new THREE.Vector3(0, 0, 1) };
  },

  /* once a frame while it shows */
  update(K, g, c, S, steer){
    /* Full input is a hairpin's worth of lock at a crawl and a fast corner's at
       speed, as a real driver's hands move: about 75 degrees down to 30. */
    const lock = WHEEL.lock * (1 - 0.58 * clamp(((c.speed || 0) - 15) / 60, 0, 1));
    K.turn.rotation.z = -clamp(steer / 0.35, -1, 1) * lock;
    // the arms reach for the cuffs wherever the wheel has taken them
    K.root.updateMatrixWorld(true);
    for(let i = 0; i < 2; i++){
      const a = K.arms[i], v = K.wrists[i].getWorldPosition(K.v);
      K.root.worldToLocal(v).sub(a.position);
      const L = v.length();
      a.quaternion.setFromUnitVectors(K.z, v.divideScalar(L || 1));
      a.scale.set(1, 1, L);
    }
    // the display at a dozen frames a second is plenty
    const t = S.clock || 0;
    if(t - K.last < 0.08 && t >= K.last) return;
    K.last = t;
    this.paint(K.D, c, S);
  },
  paint(D, c, S){
    const x = D.ctx, W = 256, kph = (c.speed || 0) * 3.6;
    const launching = S.state === "lights";
    const revN = launching ? (c.revs || 0) : clamp((rpmOfCar(c) - 4200) / 9200, 0, 1);
    const gear = (c.speed || 0) < 0.5 ? "N" : String(clamp(Math.ceil(kph / 42), 1, 8));
    x.fillStyle = "#04060A"; x.fillRect(0, 0, W, 160);
    // the display: gear in the middle, speed and lap time either side, battery and override along the bottom
    x.textAlign = "center"; x.textBaseline = "middle";
    x.fillStyle = c.inPit ? "#37D6E8" : "#FFFFFF"; x.font = "800 74px 'Saira Condensed',sans-serif";
    x.fillText(gear, W / 2, 62);
    x.font = "700 30px 'Roboto Mono',monospace"; x.fillStyle = "#E8ECF0";
    x.fillText(String(Math.round(kph)), 46, 50);
    x.font = "600 13px 'Roboto Mono',monospace"; x.fillStyle = "#8C96A3";
    x.fillText(c.inPit ? "LIMITER" : "KM/H", 46, 76);
    const lap = c.lapStart == null ? "OUT" : fmtTime((S.clock || 0) * 1000 - c.lapStart);
    x.font = "700 19px 'Roboto Mono',monospace"; x.fillStyle = "#E8ECF0"; x.fillText(lap, 208, 50);
    x.font = "600 13px 'Roboto Mono',monospace"; x.fillStyle = "#8C96A3";
    x.fillText("P" + (c.pos || "-") + " · L" + Math.max(1, c.lap || 1), 208, 76);
    const tyre = c.tyre || {}; x.fillStyle = tyre.col || "#FFD400"; x.beginPath(); x.arc(208, 100, 6, 0, Math.PI * 2); x.fill();
    const batt = clamp(c.batt == null ? 1 : c.batt, 0, 1), boost = c.boost > 0 && batt > 0.01;
    x.fillStyle = "#1A2028"; x.fillRect(20, 112, 216, 12);
    x.fillStyle = boost ? "#2FD07A" : "#37D6E8"; x.fillRect(20, 112, 216 * batt, 12);
    x.font = "700 12px 'Roboto Mono',monospace"; x.fillStyle = boost ? "#2FD07A" : "#8C96A3";
    x.fillText(boost ? "OVERRIDE" : "ERS " + Math.round(batt * 100) + "%", 48, 100);
    // the shift lights: five green, five red, five blue; all blue and flashing at the limiter
    x.fillStyle = "#000"; x.fillRect(0, 140, W, 20);
    const lit = Math.round(revN * 15 + 0.2), flash = revN > 0.95 && ((S.clock || 0) * 10 % 1) < 0.5;
    for(let k = 0; k < 15; k++){
      const on = flash ? true : k < lit, base = k < 5 ? "#2FE06A" : k < 10 ? "#FF3A2A" : "#3A7BFF";
      x.fillStyle = on ? (flash ? "#3A7BFF" : base) : "#151A20";
      x.beginPath(); x.arc(9 + k * 17.0, 150, 6, 0, Math.PI * 2); x.fill();
    }
    D.tx.needsUpdate = true;
  },
};

export { COCKPIT };
