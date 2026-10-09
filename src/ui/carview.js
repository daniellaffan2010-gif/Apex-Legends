import { planStop } from '../car/pitstop.js';
import * as THREE from 'three';
import { clamp } from '../config/util.js';
import { TEAMS } from '../config/teams.js';
import { TYRES } from '../car/parts.js';
import { PP } from '../render3d/pipeline.js';
import { G3 } from '../render3d/g3.js';
import { CFG } from '../config/settings.js';
import { setS } from '../game/session.js';
import { show } from './screens.js';

/* ---------- the car viewer: open the game with #carview ----------------
   One car on a plain grey floor under a neutral light, for checking it against
   drawings: top, side, front, rear and three-quarter views, any team, any
   compound, and every state the car can show. */
const CARVIEW = {
  on:false,
  open(){
    if(this.on || !G3.ok) return;
    this.on = true; setS(null); show(null);
    const sc = this.scene = new THREE.Scene();
    sc.background = new THREE.Color(0xD9DCDF);
    sc.add(new THREE.HemisphereLight(0xFFFFFF, 0x9A9EA4, 0.55));
    sc.add(new THREE.AmbientLight(0xFFFFFF, 0.15));
    const sun = new THREE.DirectionalLight(0xFFFFFF, 1.1); sun.position.set(6, 12, 8); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left:-5, right:5, top:5, bottom:-5, near:1, far:40 });
    sun.shadow.camera.updateProjectionMatrix(); sun.shadow.bias = -0.0004; sc.add(sun);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshStandardMaterial({ color:0xC9CCD0, roughness:0.95 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; sc.add(floor);
    // a 1 m grid, to read sizes off
    const grid = new THREE.GridHelper(12, 12, 0x8A9098, 0xAEB3B9); grid.position.y = 0.002; sc.add(grid);
    this.persp = new THREE.PerspectiveCamera(30, 1, 0.1, 200);
    this.ortho = new THREE.OrthographicCamera(-4, 4, 3, -3, 0.1, 200);
    this.state = { team:0, tyre:"soft", steer:0, boost:false, brake:false, wear:0, pit:0, spin:0, damage:new Set(), view:"q34", az:0.8, el:0.35, dist:9 };
    this.ui(); this.rebuild(); this.setView("q34");
    const tick = () => { if(!this.on) return; requestAnimationFrame(tick); this.render(); };
    requestAnimationFrame(tick);
  },
  close(){ this.on = false; if(this.panel) this.panel.remove(); this.panel = null; show("screen-title"); },
  fakeCar(){
    const st = this.state, t = TEAMS[st.team];
    const c = { team:t, drv:t.drivers[0], idx:0, ai:false, broken:new Set(st.damage), tyre:TYRES[st.tyre], steer:st.steer,
                boost:st.boost ? 1 : 0, batt:1, brk:st.brake ? 1 : 0, x:0, y:0, z:0, h:0, vx:st.spin, vy:0,
                life:1 - st.wear, stopT:st.pit > 0 ? (1 - st.pit) * 3 + 0.001 : 0, stopTotal:3, pitT:0, pitStopTime:0 };
    return c;
  },
  rebuild(){
    if(this.car){ this.scene.remove(this.car); }
    G3.mats.clear();
    this.c = this.fakeCar();
    this.car = G3.car(this.c);
    this.scene.add(this.car);
    this.clock = 0;
  },
  setView(v){
    const st = this.state; st.view = v;
    const dirs = { top:[0, 1, 0.0001], side:[0, 0, 1], front:[1, 0, 0], rear:[-1, 0, 0] };
    if(v === "q34"){ this.cam = this.persp; return; }
    this.cam = this.ortho;
    const d = dirs[v], k = 20;
    this.ortho.position.set(d[0] * k, 0.5 + d[1] * k, d[2] * k);
    if(v === "top") this.ortho.up.set(0, 0, -1); else this.ortho.up.set(0, 1, 0);
    this.ortho.lookAt(0, 0.45, 0);
  },
  render(){
    const cv = G3.cv, w = cv.clientWidth || 800, h = cv.clientHeight || 600, asp = w / h, st = this.state;
    const c = this.c; c.steer = st.steer; c.boost = st.boost ? 1 : 0; c.brk = st.brake ? 1 : 0; c.vx = st.spin; c.life = 1 - st.wear;
    // the pit-stop preview plays a real stop's timeline (car/pitstop.js): jacks, each wheel off and on
    if(st.pit > 0){ if(!this.fakeStop) this.fakeStop = planStop(c, { tyre:"soft" }); this.fakeStop.t = (1 - st.pit) * this.fakeStop.go; c.pp = { phase:"stopped", st:this.fakeStop }; }
    else { c.pp = null; this.fakeStop = null; }
    this.clock += 1 / 60;
    G3.carAnim(this.car, c, { clock:this.clock, wet:0, track:null }, 1 / 60);
    this.car.position.y = (this.car.userData.lift || 0);
    if(this.cam === this.persp){
      this.persp.aspect = asp; this.persp.updateProjectionMatrix();
      this.persp.position.set(Math.cos(st.az) * Math.cos(st.el) * st.dist, 0.4 + Math.sin(st.el) * st.dist, Math.sin(st.az) * Math.cos(st.el) * st.dist);
      this.persp.lookAt(0, 0.4, 0);
    } else {
      const hh = st.view === "front" || st.view === "rear" ? 1.3 : 1.9; this.ortho.left = -hh * asp; this.ortho.right = hh * asp; this.ortho.top = hh; this.ortho.bottom = -hh;
      this.ortho.updateProjectionMatrix();
    }
    const grade = { exposure:1.0, strength:0.25, radius:0.4, threshold:1.3, knee:0.3 };
    if(PP.ready && CFG.fx !== 0) PP.render(this.scene, this.cam, grade);
    else { G3.rend.setRenderTarget(null); G3.rend.render(this.scene, this.cam); }
  },
  ui(){
    const P = this.panel = document.createElement("div");
    P.style.cssText = "position:fixed;left:12px;top:12px;z-index:99;background:rgba(14,16,20,.86);color:#E8EDF3;padding:10px 12px;" +
      "font:12px/1.5 'Roboto Mono',monospace;border-radius:4px;max-width:300px;display:flex;flex-direction:column;gap:6px";
    const st = this.state, row = () => { const d = document.createElement("div"); d.style.cssText = "display:flex;flex-wrap:wrap;gap:4px;align-items:center"; P.appendChild(d); return d; };
    const btn = (r, label, fn) => { const b = document.createElement("button"); b.textContent = label;
      b.style.cssText = "font:inherit;padding:2px 7px;background:#2A3038;color:inherit;border:1px solid #3A424C;border-radius:3px;cursor:pointer";
      b.onclick = fn; r.appendChild(b); return b; };
    const title = document.createElement("b"); title.textContent = "CAR VIEWER"; P.appendChild(title);
    const r1 = row(); for(const [k, l] of [["top", "Top"], ["side", "Side"], ["front", "Front"], ["rear", "Rear"], ["q34", "3/4"]]) btn(r1, l, () => this.setView(k));
    const r2 = row(); const sel = document.createElement("select"); sel.style.cssText = "font:inherit;background:#2A3038;color:inherit";
    TEAMS.forEach((t, i) => { const o = document.createElement("option"); o.value = i; o.textContent = t.short; sel.appendChild(o); });
    sel.onchange = () => { st.team = +sel.value; this.rebuild(); }; r2.appendChild(sel);
    const ty = document.createElement("select"); ty.style.cssText = sel.style.cssText;
    for(const k of Object.keys(TYRES)){ const o = document.createElement("option"); o.value = k; o.textContent = TYRES[k].name; ty.appendChild(o); }
    ty.onchange = () => { st.tyre = ty.value; this.c.tyre = TYRES[st.tyre]; }; r2.appendChild(ty);
    const r3 = row();
    btn(r3, "Steer L", () => { st.steer = -1; }); btn(r3, "Straight", () => { st.steer = 0; }); btn(r3, "Steer R", () => { st.steer = 1; });
    const r4 = row();
    const tog = (r, label, get, set) => { const b = btn(r, label, () => { set(!get()); b.style.background = get() ? "#FF8A1F" : "#2A3038"; }); return b; };
    tog(r4, "Boost", () => st.boost, v => st.boost = v); tog(r4, "Brake", () => st.brake, v => st.brake = v);
    tog(r4, "Spin", () => st.spin > 0, v => st.spin = v ? 12 : 0);
    const r5 = row(); r5.appendChild(document.createTextNode("Damage:"));
    for(const k of ["wing", "rear", "floor", "susp", "punct", "brakes"])
      tog(r5, k, () => st.damage.has(k), v => { v ? st.damage.add(k) : st.damage.delete(k); this.c.broken = new Set(st.damage); });
    const r5b = row(); r5b.appendChild(document.createTextNode("Tyre wear:"));
    const wear = document.createElement("input"); wear.type = "range"; wear.id = "cv-wear"; wear.min = 0; wear.max = 100; wear.value = 0; wear.style.width = "140px";
    wear.oninput = () => { st.wear = wear.value / 100; }; r5b.appendChild(wear);
    const r6 = row(); r6.appendChild(document.createTextNode("Pit stop:"));
    const pit = document.createElement("input"); pit.type = "range"; pit.min = 0; pit.max = 100; pit.value = 0; pit.style.width = "140px";
    pit.oninput = () => { st.pit = pit.value / 100; }; r6.appendChild(pit);
    const r7 = row(); btn(r7, "Close", () => { history.replaceState(null, "", location.pathname); this.close(); });
    // drag to turn the three-quarter view
    let drag = null;
    G3.cv.addEventListener("pointerdown", e => { drag = [e.clientX, e.clientY]; });
    addEventListener("pointerup", () => { drag = null; });
    addEventListener("pointermove", e => { if(!drag || !this.on || this.cam !== this.persp) return;
      st.az += (e.clientX - drag[0]) * 0.008; st.el = clamp(st.el + (e.clientY - drag[1]) * 0.006, 0.02, 1.5); drag = [e.clientX, e.clientY]; });
    G3.cv.addEventListener("wheel", e => { if(this.on) st.dist = clamp(st.dist * Math.exp(e.deltaY * 0.001), 3, 30); }, { passive:true });
    document.body.appendChild(P);
  },
};


export { CARVIEW };
