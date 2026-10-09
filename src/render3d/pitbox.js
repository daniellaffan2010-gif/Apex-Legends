import * as THREE from 'three';
import { clamp, lerp, shade } from '../config/util.js';
import { FIELD } from './ground/field.js';

/* ---- the pit boxes, as the lane shows them --------------------------------------
   Laid out from the same table the cars stop by (tracks/pitlane.js), so the paint, the
   board, the light and the crew are all exactly where each car's centre stops:

   - every team's box painted in the working lane: a tinted fill, an outline in the team's
     colour, a white stop line just ahead of the front wheels, wheel marks and jack spots;
   - a team board over the box on the garage side, the name and the drivers' numbers;
   - a release light on a boom over the front of each box: red while they work, green to go;
   - the speed-limit lines across the lane, with the limit painted after the first;
   - and for the player's own box: the paint lit and pulsing, yellow chevrons in the fast
     lane for the last 60 m leading in, and a lit BOX sign with the car's number high over
     it, readable from the cockpit and from the overhead camera. */
const PITBOX = {
  // a point on the lane: a metres down it from the entry, lat across (signed, as T.pitWork gives), lift above the surface
  pt(T, a, lat, lift, out){
    const L = T.length, s = ((T.pitSOf(T.pitIn) + a) % L + L) % L, f = s / T.ds;
    const j = ((Math.floor(f) % T.n) + T.n) % T.n, k = (j + 1) % T.n, u = f - Math.floor(f);
    const x = lerp(T.x[j], T.x[k], u) + lerp(T.nx[j], T.nx[k], u) * lat;
    const y = lerp(T.y[j], T.y[k], u) + lerp(T.ny[j], T.ny[k], u) * lat;
    // lifts are from the pit lane's own surface, which build.js lays 0.074 over the heights' surface
    const z = FIELD.baseZ(T, j, lat) * (1 - u) + FIELD.baseZ(T, k, lat) * u + 0.074 + lift;
    const o = out || new THREE.Vector3(); o.set(x, z, y);
    return o;
  },
  // the lane's heading at a (game radians), for things that have to face along it
  ang(T, a){
    const L = T.length, s = ((T.pitSOf(T.pitIn) + a) % L + L) % L, f = s / T.ds;
    const j = ((Math.floor(f) % T.n) + T.n) % T.n, k = (j + 1) % T.n, u = f - Math.floor(f);
    let d = T.ang[k] - T.ang[j]; while(d > Math.PI) d -= 2 * Math.PI; while(d < -Math.PI) d += 2 * Math.PI;
    return T.ang[j] + d * u;
  },
  // box-local x (along, forward) and y (across, + towards the garages) to a lane point
  boxPt(T, b, x, y, lift, out){
    const f = T.pitFOf(T.pitSOf(T.pitIn) + b.a + x);
    return this.pt(T, b.a + x, T.pitWork(f) + T.pitSide * y, lift, out);
  },

  build(G, S){
    this.dispose();
    const T = S.track; if(!T.pitBoxes) return;
    const me = S.player && S.player.team, root = new THREE.Group(); root.name = "pitboxes";
    this.root = root; this.T = T; this.lights = new Map(); this.me = me;
    const P = T.pal, nite = !!T.night;
    const road = G.col(nite ? "#2A2F3D" : shade(P.road, 0.18));
    const white = G.col("#F2F3F5"), yellow = G.col("#F4C22B");
    const pos = [], col = [], mePos = [], meCol = [];
    const v = new THREE.Vector3();
    // a painted rectangle in box coordinates, cut along its length so it follows a curving lane
    const rect = (b, x0, x1, y0, y1, c, lift, P2, C2) => {
      const n = Math.max(1, Math.ceil((x1 - x0) / 1.5)), pp = P2 || pos, cc = C2 || col;
      for(let q = 0; q < n; q++){
        const xa = x0 + (x1 - x0) * q / n, xb = x0 + (x1 - x0) * (q + 1) / n;
        const p = [[xa, y0], [xb, y0], [xb, y1], [xa, y1]].map(([x, y]) => this.boxPt(T, b, x, y, lift, new THREE.Vector3()));
        // wound so it faces up whichever side of the track the lane is on
        const up = T.pitSide > 0 ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3];
        for(const k of up){ pp.push(p[k].x, p[k].y, p[k].z); cc.push(c.r, c.g, c.b); }
      }
    };
    for(const b of T.pitBoxes){
      const mine = me && b.id === me.id, tc = G.col(b.team.body), tc2 = G.col(b.team.accent || b.team.body);
      const P2 = mine ? mePos : pos, C2 = mine ? meCol : col;
      const fill = road.clone().lerp(tc, mine ? 0.55 : 0.32);
      rect(b, -3.4, 3.4, -1.95, 1.95, fill, 0.012, P2, C2);
      const ow = 0.22;                                                            // the outline
      rect(b, -3.4, 3.4, -1.95, -1.95 + ow, tc, 0.016, P2, C2); rect(b, -3.4, 3.4, 1.95 - ow, 1.95, tc, 0.016, P2, C2);
      rect(b, -3.4, -3.4 + ow, -1.95, 1.95, tc, 0.016, P2, C2); rect(b, 3.4 - ow, 3.4, -1.95, 1.95, tc, 0.016, P2, C2);
      rect(b, 2.05, 2.3, -1.5, 1.5, white, 0.02, P2, C2);                          // the stop line, just ahead of the front wheels
      for(const x of [1.55, -1.58]) for(const sd of [-1, 1]){                    // wheel marks
        rect(b, x - 0.38, x + 0.38, sd * 0.83 - 0.06, sd * 0.83 + 0.06, white, 0.02, P2, C2);
        rect(b, x - 0.06, x + 0.06, sd * 0.83 - 0.38, sd * 0.83 + 0.38, white, 0.02, P2, C2);
      }
      rect(b, 3.6, 4.2, -0.3, 0.3, mine ? yellow : tc2, 0.02, P2, C2);            // the jack spots
      rect(b, -4.2, -3.6, -0.3, 0.3, mine ? yellow : tc2, 0.02, P2, C2);
      // the board over the box, and the release light on its boom
      root.add(this.board(G, T, b, mine, S));
      const L = this.light(G, T, b); root.add(L.group); this.lights.set(b.id, L);
    }
    // the player's box: chevrons pointing in, over the last 60 m of fast lane before it
    const mb = me ? T.boxOf(me) : null;
    if(mb){
      for(let k = 1; k <= 8; k++){
        const x = -k * 7.0, w = 0.5;
        const ax = (T.pitFast(T.pitFOf(T.pitSOf(T.pitIn) + mb.a + x)) - T.pitWork(T.pitFOf(T.pitSOf(T.pitIn) + mb.a + x))) * T.pitSide;
        // a chevron: two bars meeting at a point, sitting in the fast lane and leaning in towards the box
        for(const sd of [-1, 1]){
          const p0 = [x - 1.6, ax + sd * 1.1], p1 = [x, ax];
          const q = (a, b2) => this.boxPt(T, mb, a, b2, 0.022, new THREE.Vector3());
          const nx = -(p1[1] - p0[1]), ny = p1[0] - p0[0], nl = Math.hypot(nx, ny) || 1, ox = nx / nl * w / 2, oy = ny / nl * w / 2;
          const c4 = [q(p0[0] + ox, p0[1] + oy), q(p1[0] + ox, p1[1] + oy), q(p1[0] - ox, p1[1] - oy), q(p0[0] - ox, p0[1] - oy)];
          for(const kk of [0, 1, 2, 0, 2, 3, 0, 2, 1, 0, 3, 2]){ mePos.push(c4[kk].x, c4[kk].y, c4[kk].z); meCol.push(yellow.r, yellow.g, yellow.b); }
        }
      }
      root.add(this.boxSign(G, T, mb, S));
    }
    // the speed-limit lines across the lane, and the limit painted just past the first
    for(const a of [T.pitLimA, T.pitLimB]){
      const f = T.pitFOf(T.pitSOf(T.pitIn) + a), lo = T.pitSide * (T.half + 0.4), hi = T.pitSide * (T.half + T.pitW * T.pitRampF(f) - 0.2);
      const q = [[a - 0.25, lo], [a + 0.25, lo], [a + 0.25, hi], [a - 0.25, hi]].map(([aa, l]) => this.pt(T, aa, l, 0.02, new THREE.Vector3()));
      for(const kk of [0, 1, 2, 0, 2, 3, 0, 2, 1, 0, 3, 2]){ pos.push(q[kk].x, q[kk].y, q[kk].z); col.push(white.r, white.g, white.b); }
    }
    root.add(this.limitText(G, T));
    const mk = (p, c, mat) => {
      if(!p.length) return null;
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
      g.setAttribute("color", new THREE.Float32BufferAttribute(c, 3));
      g.computeVertexNormals(); g.computeBoundingSphere();
      const m = new THREE.Mesh(g, mat); m.receiveShadow = true; root.add(m); return m;
    };
    this.paintMat = new THREE.MeshStandardMaterial({ vertexColors:true, roughness:0.62, metalness:0, polygonOffset:true, polygonOffsetFactor:-2, polygonOffsetUnits:-2 });
    this.meMat = new THREE.MeshStandardMaterial({ vertexColors:true, roughness:0.55, metalness:0, emissive:new THREE.Color(1, 1, 1), emissiveIntensity:0.15,
                                                  polygonOffset:true, polygonOffsetFactor:-3, polygonOffsetUnits:-3 });
    mk(pos, col, this.paintMat);
    this.meMesh = mk(mePos, meCol, this.meMat);
    if(this.meMesh) this.meMat.emissiveMap = null;
    G.world.add(root);
  },

  // a canvas for a sign: the team's colours, a big word and a small line
  canvas(w, h, draw){
    const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
    const g = cv.getContext("2d"); if(g && g.fillRect) draw(g, w, h);
    const t = new THREE.CanvasTexture(cv); t.encoding = THREE.sRGBEncoding; t.anisotropy = 4;
    return t;
  },
  board(G, T, b, mine, S){
    const grp = new THREE.Group(), t = b.team;
    const nums = t.drivers ? t.drivers.map(d => d.n).join(" · ") : "";
    const tex = this.canvas(512, 128, (g, w, h) => {
      g.fillStyle = t.body; g.fillRect(0, 0, w, h);
      g.fillStyle = t.accent || "#FFFFFF"; g.fillRect(0, h - 14, w, 14);
      g.fillStyle = "#FFFFFF"; g.textAlign = "left"; g.textBaseline = "middle";
      g.font = "800 italic 62px 'Saira Condensed',sans-serif"; g.fillText((t.short || t.name).toUpperCase(), 22, 58);
      g.textAlign = "right"; g.font = "700 38px 'Roboto Mono',monospace"; g.fillText(nums, w - 20, 60);
    });
    const mat = new THREE.MeshBasicMaterial({ map:tex, toneMapped:true, side:THREE.DoubleSide });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 1.1), mat);
    // on the garage side of the box, high, facing the lane and leaning towards cars coming down it
    const p = this.boxPt(T, b, 0, 2.55, 3.9), h = this.ang(T, b.a);
    grp.position.copy(p);
    grp.rotation.set(0, -h, 0, "YXZ");
    // facing the lane (towards -pitSide z), turned a little back towards the cars coming down it
    const beta = 0.35; sign.rotation.set(0, T.pitSide > 0 ? Math.PI + beta : -beta, 0);
    grp.add(sign);
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 3.9, 0.12), G.mat("#2C333B"));
    post.position.y = -1.95; grp.add(post);
    return grp;
  },
  light(G, T, b){
    const grp = new THREE.Group();
    const p = this.boxPt(T, b, 3.4, 2.4, 0), h = this.ang(T, b.a);
    grp.position.copy(p); grp.rotation.set(0, -h, 0, "YXZ");
    const dark = G.mat("#20242B");
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, 2.9, 0.14), dark); post.position.y = 1.45; grp.add(post);
    /* In a group turned to the lane's heading, local +z is the side positive offsets lie on, so the garages are
       +pitSide z and the boom reaches back over the car towards the fast lane, -pitSide z. */
    const reach = 2.4, zIn = -T.pitSide;
    const boom = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, reach), dark);
    boom.position.set(0, 2.85, zIn * reach / 2); grp.add(boom);
    const lampMat = new THREE.MeshBasicMaterial({ color:new THREE.Color(0xFF3B30).multiplyScalar(0.35) });
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.34), lampMat);
    lamp.position.set(0, 2.62, zIn * reach); grp.add(lamp);
    return { group:grp, lampMat, state:-1 };
  },
  boxSign(G, T, b, S){
    const grp = new THREE.Group(), num = S.player && S.player.drv ? S.player.drv.n : "";
    const tex = this.canvas(256, 160, (g, w, h) => {
      g.fillStyle = "#F4C22B"; g.fillRect(0, 0, w, h);
      g.fillStyle = "#14161A"; g.fillRect(8, 8, w - 16, h - 16);
      g.fillStyle = "#F4C22B"; g.textAlign = "center"; g.textBaseline = "middle";
      g.font = "900 italic 76px 'Saira Condensed',sans-serif"; g.fillText("BOX", w / 2, 62);
      g.font = "800 44px 'Roboto Mono',monospace"; g.fillText(String(num), w / 2, 122);
    });
    const mat = new THREE.MeshBasicMaterial({ map:tex, toneMapped:false, side:THREE.DoubleSide });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.6), mat);
    const p = this.boxPt(T, b, 0, 0, 7.0), h = this.ang(T, b.a);
    grp.position.copy(p); grp.rotation.set(0, -h, 0, "YXZ");
    // facing back down the lane, at the cars coming in (and so legible from the overhead camera's corner too)
    sign.rotation.set(-0.25, -Math.PI / 2, 0, "YXZ");
    grp.add(sign);
    // a pin down to the box, so from above it reads as marking that box
    const pin = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.2, 4), new THREE.MeshBasicMaterial({ color:new THREE.Color("#F4C22B").multiplyScalar(1.6), toneMapped:false }));
    pin.rotation.x = Math.PI; pin.position.y = -1.6; grp.add(pin);
    this.signGrp = grp; this.signY = p.y;
    return grp;
  },
  limitText(G, T){
    const grp = new THREE.Group(), lim = Math.round(T.pitLimit * 3.6);
    const mk = (word, a) => {
      const tex = this.canvas(256, 256, (g, w, h) => {
        g.clearRect(0, 0, w, h); g.fillStyle = "rgba(242,243,245,0.92)"; g.textAlign = "center"; g.textBaseline = "middle";
        g.font = "900 150px 'Saira Condensed',sans-serif"; g.fillText(word, w / 2, h / 2);
      });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 3.2), new THREE.MeshStandardMaterial({ map:tex, transparent:true, roughness:0.6,
        polygonOffset:true, polygonOffsetFactor:-3, polygonOffsetUnits:-3, depthWrite:false }));
      const f = T.pitFOf(T.pitSOf(T.pitIn) + a), p = this.pt(T, a, T.pitFast(f), 0.025), h = this.ang(T, a);
      m.position.copy(p);
      // flat on the lane, reading the right way up for a car driving over it
      m.rotation.set(-Math.PI / 2, -h, -Math.PI / 2, "YXZ");
      grp.add(m);
    };
    mk(String(lim), T.pitLimA + 6);
    mk(String(lim), T.pitLimB - 2);
    return grp;
  },

  /* once a frame: each box's light from the car stopped in it, and the player's box breathing */
  frame(G, S){
    if(!this.root || !this.T) return;
    const T = this.T, t = S.clock || 0;
    for(const [id, L] of this.lights){
      let st = 0;                                      // 0 off (dim red), 1 red, 2 green
      for(const c of S.cars){
        const P = c.pp; if(!P || P.box.id !== id) continue;
        if(P.phase === "stopped" && P.st){ st = P.st.t >= P.st.green + P.st.hold ? 2 : 1; break; }
        if(P.phase === "out" && P.relA != null && P.a - P.relA < 6){ st = 2; break; }
        if(P.stop && P.relA == null && P.box.a - P.a < 120) st = Math.max(st, 1);
      }
      if(st !== L.state){
        L.state = st;
        L.lampMat.color.set(st === 2 ? 0x2FD07A : 0xFF3B30).multiplyScalar(st === 0 ? 0.35 : 2.2);
      }
    }
    if(this.meMat){
      const p = S.player, coming = p && p.pitReq && !p.pitVisit || (p && p.pp && p.pp.relA == null);
      this.meMat.emissiveIntensity = coming ? 0.35 + 0.30 * (0.5 + 0.5 * Math.sin(t * 5)) : 0.12;
    }
    if(this.signGrp){ this.signGrp.position.y = this.signY + Math.sin(t * 2.2) * 0.12; }
  },
  dispose(){
    if(this.root && this.root.parent) this.root.parent.remove(this.root);
    if(this.root) this.root.traverse(o => { if(o.geometry) o.geometry.dispose(); const m = o.material; if(m && !m.userData.shared){ if(m.map) m.map.dispose(); } });
    this.root = null; this.lights = new Map(); this.meMat = null; this.signGrp = null;
  },
};

export { PITBOX };
