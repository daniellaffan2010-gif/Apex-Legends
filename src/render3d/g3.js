import * as THREE from 'three';
import { $, shade } from '../config/util.js';
import { bankZ } from '../tracks/shared.js';
import { TEX } from '../render2d/textures.js';
import { PTEX } from './surfaces.js';
import { PP } from './pipeline.js';
import { CFG } from '../config/settings.js';

/* ---------- 10. the 3D renderer ------------------------------------------
   The world is built once per session as a Three.js scene: the circuit as
   ribbon meshes, the scenery as solids, the cars as little assemblies that get
   moved each frame. Physics, AI and the track builder are untouched — this
   only replaces what was being painted onto a 2D canvas.

   Game space is x,y along the ground with z up. Three is y-up, so everything
   goes through V3(x, y, z) -> (x, z, y).
   ------------------------------------------------------------------------ */
const V3 = (x, y, z) => new THREE.Vector3(x, z || 0, y);
function cssOf(c){ return (typeof c === "string") ? c : "#888888"; }

const G3 = {
  ok:false, scene:null, rend:null, cv:null, camIso:null, camTV:null, camFP:null,
  view:"iso",              // the player's chosen view: "iso" overhead or "cockpit"
  world:null, cars:[], sun:null, built:null, wet:0, sparks:null, sparkN:0,
  mats:new Map(), texes:new Map(), dyn:[],

  srgb(t){ t.encoding = THREE.sRGBEncoding; return t; },
  col(c){ return new THREE.Color(cssOf(c)).convertSRGBToLinear(); },
  // Lambert cannot see an environment map, so every surface is Standard now.
  // Anything that does not say otherwise is a rough dielectric.
  mat(col, opts){
    const key = cssOf(col) + "|" + (opts ? JSON.stringify(opts) : "");
    let m = this.mats.get(key);
    if(!m){
      const o = Object.assign({ color:this.col(col), roughness:0.88, metalness:0.0 }, opts || {});
      if(o.emissive) o.emissive = this.col(o.emissive);
      m = new THREE.MeshStandardMaterial(o);
      this.mats.set(key, m);
    }
    return m;
  },
  /* A surface described the way the landmarks want to describe one: a facade
     style, a colour, and whether the windows are alight. The window grid,
     the mullion relief and the roughness break-up all come from generated
     canvases, so detail costs texture memory rather than triangles. */
  faceMat(style, col, night, opts){
    const key = "f|" + style + "|" + cssOf(col) + "|" + (night ? 1 : 0) + "|" + (opts ? JSON.stringify(opts) : "");
    let m = this.mats.get(key);
    if(m) return m;
    const S2 = PTEX.STYLE[style] || PTEX.STYLE.stucco;
    const o = {
      color:this.col(S2.tint ? shade(col, S2.tint) : col),
      roughness:S2.rough, metalness:S2.metal,
      envMapIntensity:S2.env == null ? 1 : S2.env,
    };
    const nm = PTEX.normalTex(style);
    if(nm){ o.normalMap = nm; o.normalScale = new THREE.Vector2(S2.nrm || 0.6, S2.nrm || 0.6); }
    const rg = PTEX.roughTex(style);
    if(rg) o.roughnessMap = rg;
    if(night && S2.lit){
      o.emissiveMap = PTEX.windowTex(style, col);
      o.emissive = new THREE.Color(1, 1, 1);
      o.emissiveIntensity = S2.glow == null ? 1.15 : S2.glow;
    }
    Object.assign(o, opts || {});
    m = new THREE.MeshStandardMaterial(o);
    m.userData.face = true;
    this.mats.set(key, m);
    return m;
  },
  // the pool a streetlight leaves on the tarmac. Additive and unlit, so it is
  // one cheap quad instead of a real light with a shadow budget.
  poolMat(col, inten){
    const key = "pool|" + cssOf(col) + "|" + inten;
    let m = this.mats.get(key);
    if(m) return m;
    m = new THREE.MeshBasicMaterial({ color:this.col(col), transparent:true, opacity:inten,
      blending:THREE.AdditiveBlending, depthWrite:false, map:PTEX.pool() });
    this.mats.set(key, m); return m;
  },
  /* a media facade: a canvas of moving colour, shared by everything that wants
     one in that hue, and stepped on in G3.frame rather than per building */
  screen(col){
    const key = "scr|" + cssOf(col);
    let m = this.mats.get(key);
    if(m) return m;
    const cv = document.createElement("canvas"); cv.width = 256; cv.height = 128;
    const t = G3.srgb(new THREE.CanvasTexture(cv));
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
    m = new THREE.MeshStandardMaterial({ map:t, emissiveMap:t, emissive:new THREE.Color(1, 1, 1),
      emissiveIntensity:1.9, roughness:0.5, metalness:0.0, side:THREE.DoubleSide });
    this.mats.set(key, m);
    this.dyn.push({ kind:"screen", ctx:cv.getContext("2d"), tx:t, col:cssOf(col), t:Math.random() * 9 });
    return m;
  },
  // a surface that is its own light: signs, screens, neon, lit crowns
  glowMat(col, inten, opts){
    const key = "g|" + cssOf(col) + "|" + inten + "|" + (opts ? JSON.stringify(opts) : "");
    let m = this.mats.get(key);
    if(m) return m;
    m = new THREE.MeshStandardMaterial(Object.assign({
      color:this.col("#000000"), roughness:1, metalness:0,
      emissive:this.col(col), emissiveIntensity:inten,
    }, opts || {}));
    this.mats.set(key, m);
    return m;
  },
  // a generated canvas turned into one shared repeating material
  texMat(tex){
    const key = "t|" + (tex.id || (tex.id = "tex" + (this.texes.size + Math.random())));
    let m = this.mats.get(key);
    if(!m){
      let t = this.texes.get(tex);
      if(!t){ t = G3.srgb(new THREE.CanvasTexture(tex.img)); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; this.texes.set(tex, t); }
      m = new THREE.MeshStandardMaterial({ map:t, roughness:0.9, metalness:0.0 });
      this.mats.set(key, m);
    }
    return m;
  },
  // BoxGeometry lays its UVs 0..1 on every face; stretch each one so the tile
  // repeats at its real size in metres
  tileBoxUV(g, l, h, w, tex){
    const uv = g.attributes.uv, sx = tex.sx, sy = tex.sy;
    const face = [[w, h], [w, h], [l, w], [l, w], [l, h], [l, h]];
    for(let f = 0; f < 6; f++){
      const ru = Math.max(0.25, face[f][0] / sx), rv = Math.max(0.25, face[f][1] / sy);
      for(let k = 0; k < 4; k++){
        const i = f * 4 + k;
        uv.setXY(i, uv.getX(i) * ru, uv.getY(i) * rv);
      }
    }
    uv.needsUpdate = true;
  },

  init(){
    if(this.ok || typeof THREE === "undefined") return this.ok;
    const host = $("#view").parentNode;
    this.cv = document.createElement("canvas");
    this.cv.id = "view3";
    this.cv.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block";
    host.insertBefore(this.cv, $("#view"));
    $("#view").style.display = "none";
    try{
      this.rend = new THREE.WebGLRenderer({ canvas:this.cv, antialias:true, powerPreference:"high-performance" });
    }catch(e){ $("#view").style.display = ""; this.cv.remove(); return false; }
    this.rend.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    // these two are what the renderer does on its own when the composer is off.
    // With it on, PP.render turns both off for the scene pass and does the work
    // itself at the end, so the image is tone mapped and encoded exactly once.
    this.rend.outputEncoding = THREE.sRGBEncoding;
    this.rend.toneMapping = THREE.ACESFilmicToneMapping;
    this.rend.toneMappingExposure = 1.0;
    this.rend.shadowMap.enabled = true;
    this.rend.shadowMap.type = THREE.PCFSoftShadowMap;
    /* The browser takes the GPU's context away when it is short of memory (a few
       heavy circuits in a row can do it). That is not a reason to give up on 3D:
       wait, and when it comes back rebuild the world, which re-creates everything
       that lived on the GPU. */
    this.cv.addEventListener("webglcontextlost", e => { e.preventDefault(); this.lost = true; console.warn("WebGL context lost; waiting for it to come back"); });
    this.cv.addEventListener("webglcontextrestored", () => { this.lost = false; this.built = null; console.warn("WebGL context restored; rebuilding the world"); });
    try{ if(CFG.fx !== 0) PP.init(this.rend); }catch(e){ console.warn("post-processing unavailable", e); PP.ready = false; }
    this.scene = new THREE.Scene();
    // the true isometric angle: 45 degrees round, 35.26 up
    this.camIso = new THREE.OrthographicCamera(-50, 50, 50, -50, 0.5, 6000);
    this.camTV = new THREE.PerspectiveCamera(38, 1, 0.5, 6000);
    // the driver's eye: the halo is a quarter of a metre away, the sky domes up to seven kilometres
    this.camFP = new THREE.PerspectiveCamera(52, 1, 0.15, 8000);
    this.resize();
    addEventListener("resize", () => this.resize());
    this.ok = true;
    return true;
  },
  resize(){
    if(!this.rend) return;
    const w = this.cv.clientWidth || 1, h = this.cv.clientHeight || 1;
    this.rend.setSize(w, h, false);
    this.camTV.aspect = w / h; this.camTV.updateProjectionMatrix();
    this.camFP.aspect = w / h; this.camFP.updateProjectionMatrix();
  },

  /* ---- geometry helpers ---- */
  // a flat ribbon along the circuit between two lateral offsets
  // true when a lateral offset reaches past the corner's own centre of curvature
  inverts(T, k, o){ const c = T.curv[k]; return !!c && o * c > 0.80; },
  safeOff(T, k, o){ const c = T.curv[k]; return (c && o * c > 0.80) ? 0.80 / c : o; },
  strip(T, fa, fb, lift, uvRepeat, filter){
    const pos = [], uv = [], idx = [];
    const n = T.n, E = (k, o0) => {
      const o = this.safeOff(T, k, o0);
      const bz = bankZ(T, k, o) + o * T.camber[k];
      return [T.x[k] + T.nx[k] * o, T.y[k] + T.ny[k] * o, T.z[k] + bz + lift];
    };
    let v = 0;
    for(let i = 0; i < n; i++){
      if(filter && !filter(i)) continue;
      const j = (i + 1) % n;
      const a0 = typeof fa === "function" ? fa(i) : fa, b0 = typeof fb === "function" ? fb(i) : fb;
      const a1 = typeof fa === "function" ? fa(j) : fa, b1 = typeof fb === "function" ? fb(j) : fb;
      if(Math.abs(a0 - a1) > 6 || Math.abs(b0 - b1) > 6) continue;   // the offset flipped sides
      // past the centre of curvature the ribbon would turn inside out
      if(this.inverts(T, i, a0) || this.inverts(T, i, b0) ||
         this.inverts(T, j, a1) || this.inverts(T, j, b1)) continue;
      const u0 = (i * T.ds) / (uvRepeat || 8), u1 = ((i + 1) * T.ds) / (uvRepeat || 8);
      // a banked or cambered cross-section is curved, so cut the ribbon across into
      // narrow lanes there; a flat one stays the single quad it always was
      const curved = T.bankZf && ((T.bankW && (T.bankW[i] || T.bankW[j])) || T.camber[i] || T.camber[j] || T.bankCamber && (T.bankCamber[i] || T.bankCamber[j]));
      const K = curved ? Math.max(1, Math.ceil(Math.max(Math.abs(b0 - a0), Math.abs(b1 - a1)) / 1.5)) : 1;
      for(let q = 0; q < K; q++){
        const f0 = q / K, f1 = (q + 1) / K;
        const p0 = E(i, a0 + (b0 - a0) * f0), p1 = E(i, a0 + (b0 - a0) * f1), p2 = E(j, a1 + (b1 - a1) * f1), p3 = E(j, a1 + (b1 - a1) * f0);
        for(const p of [p0, p1, p2, p3]) pos.push(p[0], p[2], p[1]);
        uv.push(f0, u0, f1, u0, f1, u1, f0, u1);
        idx.push(v, v + 1, v + 2, v, v + 2, v + 3); v += 4;
      }
    }
    if(!pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    return g;
  },
  // a vertical wall standing on the circuit at one lateral offset
  wall(T, off, hgt, filter, drop){
    const dropOf = typeof drop === "function" ? drop : (() => drop || 0);
    const pos = [], uv = [], idx = [];
    const n = T.n, E = (k) => {
      const o = this.safeOff(T, k, typeof off === "function" ? off(k) : off);
      return [T.x[k] + T.nx[k] * o, T.y[k] + T.ny[k] * o, T.z[k] + bankZ(T, k, o)];
    };
    let v = 0;
    for(let i = 0; i < n; i++){
      if(filter && !filter(i)) continue;
      const j = (i + 1) % n, a = E(i), b = E(j);
      const lo = -dropOf(i);
      pos.push(a[0], a[2] + lo, a[1], b[0], b[2] + lo, b[1], b[0], b[2] + hgt, b[1], a[0], a[2] + hgt, a[1]);
      const u0 = (i * T.ds) / 8, u1 = ((i + 1) * T.ds) / 8;
      uv.push(u0, 0, u1, 0, u1, 1, u0, 1);
      idx.push(v, v + 1, v + 2, v, v + 2, v + 3);
      v += 4;
    }
    if(!pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    return g;
  },
  // walls are seen from both sides, so the material says so rather than the
  // geometry carrying two windings — that cancelled the normals and went black
  // a clone loses any shader hook, so carry it across
  twoSided(m){ const c = m.clone(); c.side = THREE.DoubleSide;
    if(m.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile){ c.onBeforeCompile = m.onBeforeCompile; c.customProgramCacheKey = m.customProgramCacheKey; }
    return c; },
  /* A material that fades by discarding pixels in a 4x4 Bayer pattern rather
     than by blending. It stays in the opaque pass, writes depth, and never needs
     sorting, so a tunnel roof can go see-through without flickering against the
     road under it. All of them share one uniform, so one number fades the lot;
     edge pieces use a second one that never drops as far, so the tunnel's shape
     is still there when its roof is not. */
  fadeU:{ value:1 }, fadeEdgeU:{ value:1 },
  ditherMat(base, edge){
    const m = base.clone();
    const U = edge ? this.fadeEdgeU : this.fadeU;
    const prev = base.onBeforeCompile;
    m.onBeforeCompile = (sh, r) => {
      if(prev && prev !== THREE.Material.prototype.onBeforeCompile) prev(sh, r);
      sh.uniforms.uFade = U;
      sh.fragmentShader = "uniform float uFade;\n" +
        "float bayer2(vec2 a){ a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }\n" +
        "float bayer4(vec2 a){ return bayer2(0.5 * a) * 0.25 + bayer2(a); }\n" +
        sh.fragmentShader.replace("void main() {", "void main() {\n  if(uFade < 0.995 && bayer4(gl_FragCoord.xy) >= uFade) discard;");
    };
    m.customProgramCacheKey = () => "dither|" + (edge ? 1 : 0) + "|" + (base.customProgramCacheKey ? base.customProgramCacheKey() : "");
    m.userData.dither = true;
    return m;
  },
  /* A tyre that shows its wear. `base` is the shared tyre material; each wheel gets its own clone with its own
     uniforms, but they all compile to one program (fixed cache key). The wheel geometry carries a `zone` per vertex
     (0 rim, 1 sidewall, 2 compound band, 3 tread). The marks are worked out in the wheel's own space, so they turn
     with it. Weights come from wearLook() in car/tyrewear.js; setTyreWear() pushes them in when they have moved. */
  tyreWearMat(base){
    const m = base.clone();
    const U = { uGloss:{ value:1 }, uScuff:{ value:0 }, uFade:{ value:0 }, uGrain:{ value:0 }, uMarb:{ value:0 }, uCords:{ value:0 }, uHeat:{ value:0 } };
    const prev = base.onBeforeCompile;
    m.onBeforeCompile = (sh, r) => {
      if(prev && prev !== THREE.Material.prototype.onBeforeCompile) prev(sh, r);
      for(const k in U) sh.uniforms[k] = U[k];
      sh.vertexShader = "attribute float zone;\nvarying float vTwZone;\nvarying vec3 vTwP;\n" +
        sh.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\n  vTwZone = zone; vTwP = position;");
      sh.fragmentShader = "uniform float uGloss; uniform float uScuff; uniform float uFade; uniform float uGrain; uniform float uMarb; uniform float uCords; uniform float uHeat;\n" +
        "varying float vTwZone; varying vec3 vTwP;\n" +
        "float twH(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\n" +
        sh.fragmentShader
          .replace("#include <color_fragment>", "#include <color_fragment>\n" +
            "  float twRub = step(0.5, vTwZone), twTrd = step(2.5, vTwZone), twBnd = step(1.5, vTwZone) * (1.0 - twTrd);\n" +
            "  float twU = (abs(vTwP.x) + abs(vTwP.y) > 1e-4 ? atan(vTwP.y, vTwP.x) : 0.0) * 0.15915 + 0.5;\n" +
            "  float twZ = clamp(vTwP.z, -2.0, 2.0);\n" +
            "  vec3 twC = diffuseColor.rgb;\n" +
            "  twC = mix(twC, vec3(0.30, 0.31, 0.32), uScuff * 0.5 * twTrd);\n" +
            "  float twS = twH(vec2(floor(twU * 90.0), 3.0));\n" +
            "  twC += uGrain * 0.12 * twTrd * step(0.55, twS) * (0.5 + 0.5 * sin(twZ * 40.0 + twS * 6.0));\n" +
            "  vec2 twQ = vec2(twU * 60.0, twZ * 30.0);\n" +
            "  float twB = step(0.8, twH(floor(twQ))) * smoothstep(0.5, 0.2, length(fract(twQ) - 0.5));\n" +
            "  twC = mix(twC, vec3(0.045, 0.04, 0.04), twB * uMarb * twTrd);\n" +
            "  float twN = twH(vec2(floor(twZ * 8.0), floor(twU * 18.0)));\n" +
            "  float twM = smoothstep(1.0 - uCords * 1.15, 1.2 - uCords * 1.15, twN);\n" +
            "  float twK = smoothstep(0.18, 0.06, abs(fract(twU * 70.0) - 0.5));\n" +
            "  twC = mix(twC, vec3(0.78, 0.74, 0.62), twK * twM * twTrd * 0.9);\n" +
            "  twC = mix(twC, twC * vec3(1.15, 0.8, 0.65), uHeat * 0.6 * twRub);\n" +
            "  float twL = dot(twC, vec3(0.299, 0.587, 0.114));\n" +
            "  twC = mix(twC, vec3(twL * 0.8 + 0.08), uFade * 0.85 * twBnd);\n" +
            "  diffuseColor.rgb = twC;")
          .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\n  roughnessFactor = mix(roughnessFactor, mix(0.55, 0.95, 1.0 - uGloss), step(0.5, vTwZone));");
    };
    m.customProgramCacheKey = () => "tyrewear|" + (base.customProgramCacheKey ? base.customProgramCacheKey() : "");
    m.wearU = U; m.wearLast = null;
    return m;
  },
  // push a wearLook() result into a tyreWearMat; returns true if anything moved
  setTyreWear(m, o){
    const U = m.wearU; if(!U) return false;
    const L = m.wearLast, e = 0.002;
    if(L && Math.abs(o.gloss - L.gloss) < e && Math.abs(o.scuff - L.scuff) < e && Math.abs(o.fade - L.fade) < e && Math.abs(o.grain - L.grain) < e &&
       Math.abs(o.marbles - L.marbles) < e && Math.abs(o.cords - L.cords) < e && Math.abs(o.heat - L.heat) < e) return false;
    U.uGloss.value = o.gloss; U.uScuff.value = o.scuff; U.uFade.value = o.fade; U.uGrain.value = o.grain;
    U.uMarb.value = o.marbles; U.uCords.value = o.cords; U.uHeat.value = o.heat;
    m.wearLast = { gloss:o.gloss, scuff:o.scuff, fade:o.fade, grain:o.grain, marbles:o.marbles, cords:o.cords, heat:o.heat };
    return true;
  },
  /* Cut-away for whatever stands between the overhead camera and your car.
     The camera looks down a straight line, so an occluder is anything nearer the
     lens than the car, close to that line, and clearly above the car (the road
     and the ground beside it are never above it, so they stay). Those pixels
     are dropped in a Bayer pattern, thinning out toward the middle of the hole:
     it stays in the opaque pass and there is nothing to sort. One set of
     uniforms serves every patched material. */
  cutU:{ uCutP:{ value:new THREE.Vector3() }, uCutD:{ value:new THREE.Vector3(0, 0, 1) },
         uCutV:{ value:new THREE.Matrix4() }, uCutR:{ value:9 }, uCutOn:{ value:0 } },
  cutMat(m){
    if(!m || !m.userData || m.userData.cut) return;
    if(!(m.isMeshStandardMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial || m.isMeshBasicMaterial)) return;
    m.userData.cut = true;
    const prev = m.onBeforeCompile, U = this.cutU;
    const key = (typeof m.customProgramCacheKey === "function" ? m.customProgramCacheKey() : "") + "|cut";
    m.onBeforeCompile = (sh, r) => {
      if(prev && prev !== THREE.Material.prototype.onBeforeCompile) prev(sh, r);
      for(const k in U) sh.uniforms[k] = U[k];
      sh.vertexShader = "varying vec3 vCutView;\n" +
        sh.vertexShader.replace("#include <project_vertex>", "#include <project_vertex>\n  vCutView = mvPosition.xyz;");
      sh.fragmentShader = "uniform vec3 uCutP; uniform vec3 uCutD; uniform mat4 uCutV; uniform float uCutR; uniform float uCutOn;\n" +
        "varying vec3 vCutView;\n" +
        "float cutB2(vec2 a){ a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }\n" +
        "float cutB4(vec2 a){ return cutB2(0.5 * a) * 0.25 + cutB2(a); }\n" +
        sh.fragmentShader.replace("void main() {", "void main() {\n" +
          "  if(uCutOn > 0.5){\n" +
          "    vec3 cq = (uCutV * vec4(vCutView, 1.0)).xyz - uCutP;\n" +
          "    float ca = dot(cq, uCutD);\n" +
          "    float cp = length(cq - ca * uCutD);\n" +
          "    float cm = smoothstep(uCutR, uCutR * 0.5, cp) * smoothstep(1.0, 3.5, ca) * smoothstep(1.2, 3.0, cq.y);\n" +
          "    if(cm > 0.01 && cm * 0.92 > cutB4(gl_FragCoord.xy)) discard;\n" +
          "  }");
    };
    m.customProgramCacheKey = () => key;
    m.needsUpdate = true;
  },
  cutAll(objs){
    for(const o of objs) o.traverse(x => {
      if(!x.isMesh) return;
      for(const mm of (Array.isArray(x.material) ? x.material : [x.material])) this.cutMat(mm);
    });
  },
  /* Every solid was its own draw call — two thousand of them, twice over for
     the shadow pass. The scenery never moves, so bake it down: bucket the
     meshes by material and by a coarse grid square, and merge each bucket into
     one geometry. Draw calls collapse, and chunking keeps frustum culling
     useful. r128's UMD build has no merge helper, so this is it. */
  bake(group, cell){
    const buckets = new Map();
    const strays = [];
    group.updateMatrixWorld(true);
    group.traverse(o => {
      if(!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
      if(o.userData.dynamic) { strays.push(o); return; }
      const p = new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);
      const gx = Math.floor(p.x / cell), gz = Math.floor(p.z / cell);
      const key = o.material.uuid + "|" + gx + "|" + gz + "|" + (o.castShadow ? 1 : 0);
      let b = buckets.get(key);
      if(!b){ b = { mat:o.material, cast:o.castShadow, list:[] }; buckets.set(key, b); }
      b.list.push(o);
    });
    const out = new THREE.Group();
    for(const b of buckets.values()){
      if(b.list.length === 1){ out.add(b.list[0].clone()); continue; }
      let n = 0;
      const parts = [];
      for(const m of b.list){
        let g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
        g = g.clone(); g.applyMatrix4(m.matrixWorld);
        if(!g.attributes.uv){
          const c = g.attributes.position.count;
          g.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(c * 2), 2));
        }
        if(!g.attributes.normal) g.computeVertexNormals();
        parts.push(g); n += g.attributes.position.count;
      }
      const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
      let o1 = 0, o2 = 0;
      for(const g of parts){
        pos.set(g.attributes.position.array, o1);
        nor.set(g.attributes.normal.array, o1);
        uv.set(g.attributes.uv.array, o2);
        o1 += g.attributes.position.count * 3; o2 += g.attributes.position.count * 2;
        g.dispose();
      }
      const merged = new THREE.BufferGeometry();
      merged.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      merged.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
      merged.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
      const mesh = new THREE.Mesh(merged, b.mat);
      mesh.castShadow = b.cast; mesh.receiveShadow = true;
      out.add(mesh);
    }
    /* The strays keep their own materials so they can be faded, but moving them
       to a new parent drops whatever transform their old parents were applying.
       Bake the world matrix into each one before it moves, or anything built
       inside a nested group lands somewhere else entirely. */
    for(const st of strays){
      st.matrixWorld.decompose(st.position, st.quaternion, st.scale);
      st.updateMatrix();
      out.add(st);
    }
    return out;
  },
  add(parent, geom, mat, shadow){
    if(!geom) return null;
    const m = new THREE.Mesh(geom, mat);
    m.receiveShadow = true; m.castShadow = false;
    parent.add(m); return m;
  },
  // a solid, given the way the 2D renderer describes one
  boxAt(parent, cx, cy, cz, l, w, h, ang, col, tex){
    const g = new THREE.BoxGeometry(l, h, w);
    if(tex) this.tileBoxUV(g, l, h, w, tex);
    const m = new THREE.Mesh(g, tex ? this.texMat(tex) : this.mat(col));
    m.position.set(cx, cz + h / 2, cy); m.rotation.y = -ang;
    m.castShadow = h > 5 || Math.max(l, w) > 8; m.receiveShadow = true;
    parent.add(m); return m;
  },
  coneAt(parent, cx, cy, cz, half, h, ang, col, seg){
    const g = new THREE.ConeGeometry(half * (seg === 4 ? Math.SQRT2 : 1), h, seg || 4);
    const m = new THREE.Mesh(g, this.mat(col));
    m.position.set(cx, cz + h / 2, cy); m.rotation.y = -ang + (seg === 4 ? Math.PI / 4 : 0);
    m.castShadow = h > 5; m.receiveShadow = true;
    parent.add(m); return m;
  },
  discAt(parent, cx, cy, cz, rx, ry, ang, col){
    const g = new THREE.CircleGeometry(1, 28);
    const m = new THREE.Mesh(g, this.mat(col));
    m.rotation.x = -Math.PI / 2; m.rotation.z = ang;
    m.scale.set(rx, ry, 1);
    m.position.set(cx, cz, cy); m.receiveShadow = true;
    parent.add(m); return m;
  },
  // a patch of ground from a world-space polygon
  patch(parent, pts, z, col, kind){
    const shape = new THREE.Shape();
    pts.forEach((p, i) => i ? shape.lineTo(p[0], p[1]) : shape.moveTo(p[0], p[1]));
    const g = new THREE.ShapeGeometry(shape);
    g.rotateX(Math.PI / 2);                              // shape is XY, lay it flat
    const t = TEX.ground(col, kind);
    let tt = this.texes.get(t);
    if(!tt){ tt = G3.srgb(new THREE.CanvasTexture(t.img)); tt.wrapS = tt.wrapT = THREE.RepeatWrapping; this.texes.set(t, tt); }
    const key = "p|" + cssOf(col) + "|" + kind;
    let mat = this.mats.get(key);
    if(!mat){ const c = tt.clone(); c.needsUpdate = true; c.encoding = THREE.sRGBEncoding; c.wrapS = c.wrapT = THREE.RepeatWrapping; c.repeat.set(0.06, 0.06);
      mat = new THREE.MeshStandardMaterial({ map:c, roughness:0.96, metalness:0.0 }); this.mats.set(key, mat); }
    const m = new THREE.Mesh(g, mat);
    m.position.y = z; m.receiveShadow = true;
    // ShapeGeometry's UVs are the raw world coords, which is what we want
    parent.add(m); return m;
  },
};


export { G3 };
