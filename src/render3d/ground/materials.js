import * as THREE from 'three';
import { shade } from '../../config/util.js';

/* ---- the ground's materials: road that looks like road ------------------------
   Every surface the circuit is laid in, as a MeshStandardMaterial over textures
   generated here as typed arrays (no canvas: Node has none, and a DataTexture can
   be dumped to a PNG and looked at). Eight textures in all, 6.7 MB with mips, made
   once (~0.35-0.7 s) and kept across rebuilds:

     road.a    512  asphalt: stones of every size and shade in a dark binder,
                    the tops worn smooth;  alpha = roughness
     road.n    512  the same stones as relief;  alpha = a slow, large noise field
                    (see "macro" below)
     gravel.a  512  crushed stone, beige, grey and tan, with dark gaps;  alpha = roughness
     gravel.n  512  deep relief for it;  alpha = macro
     astro.a   256  artificial grass: plastic fibres
     grass.a   256  mown turf, a little uneven in hue
     concrete.a 256 street-circuit concrete: fine sand, mottling, the odd stain
     fine.n    256  a fine grain (paint, fibres, cement) for the four above and the kerbs

   Run-off tarmac reuses the road's pair at a larger scale (bigger stones read as
   coarser) with a lighter colour and dust blown over it, so it costs nothing.

   Why the shader is patched (one customProgramCacheKey per variant, no extra fetch
   beyond one):
   - UVs are world metres (FIELD.ribbon lays them), so the tile size is a uniform,
     not texture.repeat: the textures are shared between materials at different
     scales, and texture.repeat would belong to all of them at once.
   - Tiling shows from the cockpit at 3 m and from overhead across a whole
     straight. One extra fetch, the normal map's alpha at a rotated scale ~20 times
     larger, gives a slow, irregular light/dark field that breaks the repeat; on the
     run-off it also blows dust across in drifts.
   - roughness lives in the albedo's alpha (one texture fewer than a roughnessMap),
     and is multiplied into material.roughness, so weather.js and silverstone.js,
     which write G3.roadMat's roughness every frame, still drive it.
   - astro and verge grass get stripes along the track from uv2.x (metres across,
     which FIELD.ribbon writes); without a uv2 they simply have none.

   The albedo of every texture is scaled to a known mean, and the material colour
   is the palette colour divided by that mean, so P.road, P.grass still set the
   overall tone (and Silverstone, which sets the road colour to plain white, gets
   the texture's own neutral asphalt). */

const SIZE = { road:512, gravel:512, astro:256, grass:256, concrete:256, fine:256 };
// metres per tile on the world-metre UVs
const TILE = { road:2.4, tarmac:3.4, gravel:1.6, astro:1.0, grass:2.0, concrete:2.6, kerb:0.8 };
const MACRO_M = 46;                       // metres per repeat of the macro field (it has ~3 features across)

/* ---- small tools ---- */
function rng(seed){
  let s = seed | 0;
  return () => { s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
// tileable value noise: a p x p lattice wrapped over an N x N texture, smoothly interpolated, 0..1
function vnoise(N, p, seed){
  const r = rng(seed), L = new Float32Array(p * p), out = new Float32Array(N * N);
  for(let i = 0; i < p * p; i++) L[i] = r();
  const k = p / N;
  for(let y = 0; y < N; y++){
    const fy = y * k, y0 = Math.floor(fy), ty = fy - y0, sy = ty * ty * (3 - 2 * ty), ya = (y0 % p) * p, yb = ((y0 + 1) % p) * p;
    for(let x = 0; x < N; x++){
      const fx = x * k, x0 = Math.floor(fx), tx = fx - x0, sx = tx * tx * (3 - 2 * tx), xa = x0 % p, xb = (x0 + 1) % p;
      const a = L[ya + xa] + (L[ya + xb] - L[ya + xa]) * sx, b = L[yb + xa] + (L[yb + xb] - L[yb + xa]) * sx;
      out[y * N + x] = a + (b - a) * sy;
    }
  }
  return out;
}
// octaves of it, from p cells across, each twice as fine and `g` times as strong; stretched to 0..1
function fbm(N, p, oct, seed, g){
  const out = new Float32Array(N * N); let w = 1;
  for(let o = 0; o < oct; o++, p *= 2, w *= (g || 0.5)){
    if(p > N) break;
    const v = vnoise(N, p, seed + o * 101);
    for(let i = 0; i < out.length; i++) out[i] += v[i] * w;
  }
  return stretch(out);
}
function stretch(a){
  let lo = Infinity, hi = -Infinity;
  for(const v of a){ if(v < lo) lo = v; if(v > hi) hi = v; }
  const k = 1 / Math.max(1e-6, hi - lo);
  for(let i = 0; i < a.length; i++) a[i] = (a[i] - lo) * k;
  return a;
}
// a box blur with wrap, radius r, separable
function blur(N, src, r){
  const tmp = new Float32Array(N * N), out = new Float32Array(N * N), d = 2 * r + 1;
  for(let y = 0; y < N; y++) for(let x = 0; x < N; x++){
    let s = 0; for(let k = -r; k <= r; k++) s += src[y * N + ((x + k + N) % N)];
    tmp[y * N + x] = s / d;
  }
  for(let y = 0; y < N; y++) for(let x = 0; x < N; x++){
    let s = 0; for(let k = -r; k <= r; k++) s += tmp[((y + k + N) % N) * N + x];
    out[y * N + x] = s / d;
  }
  return out;
}
const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
// sRGB <-> linear through tables: a few million Math.pow calls were most of the generation time
const LUT = 4096, S2L = new Float32Array(LUT + 1), L2S = new Float32Array(LUT + 1);
for(let i = 0; i <= LUT; i++){
  const v = i / LUT;
  S2L[i] = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  L2S[i] = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}
const s2l = v => S2L[Math.round(clamp01(v) * LUT)];
const l2s = v => L2S[Math.round(clamp01(v) * LUT)];

/* an albedo (sRGB floats, 3 per texel) and a roughness (0..1) into RGBA bytes, the
   albedo scaled so its mean linear luminance is `mean`; returns the bytes and the
   linear mean colour it ended up with */
function packAlbedo(N, alb, rough, mean){
  let lum = 0;
  for(let i = 0; i < N * N; i++) lum += 0.2126 * s2l(alb[i * 3]) + 0.7152 * s2l(alb[i * 3 + 1]) + 0.0722 * s2l(alb[i * 3 + 2]);
  const k = mean / (lum / (N * N));
  const data = new Uint8Array(N * N * 4), m = [0, 0, 0];
  for(let i = 0; i < N * N; i++){
    for(let c = 0; c < 3; c++){
      const v = clamp01(s2l(alb[i * 3 + c]) * k);
      m[c] += v; data[i * 4 + c] = Math.round(l2s(v) * 255);
    }
    data[i * 4 + 3] = Math.round(clamp01(rough[i]) * 255);
  }
  return { data, mean:new THREE.Color(m[0] / (N * N), m[1] / (N * N), m[2] / (N * N)) };
}
/* a height field into a tangent-space normal map (x along u, y along v, as three's
   perturbNormal2Arb reads them), with the macro field in alpha */
function packNormal(N, h, strength, macro){
  const data = new Uint8Array(N * N * 4);
  for(let y = 0; y < N; y++) for(let x = 0; x < N; x++){
    const i = y * N + x;
    const dx = (h[y * N + (x + 1) % N] - h[y * N + (x - 1 + N) % N]) * 0.5 * strength;
    const dy = (h[((y + 1) % N) * N + x] - h[((y - 1 + N) % N) * N + x]) * 0.5 * strength;
    const l = Math.sqrt(dx * dx + dy * dy + 1);
    data[i * 4] = Math.round((-dx / l * 0.5 + 0.5) * 255);
    data[i * 4 + 1] = Math.round((-dy / l * 0.5 + 0.5) * 255);
    data[i * 4 + 2] = Math.round((1 / l * 0.5 + 0.5) * 255);
    data[i * 4 + 3] = Math.round(clamp01(macro[i]) * 255);
  }
  return data;
}
// the macro field: a few soft features across the tile, never quite periodic-looking
function macroField(N, seed){
  const a = fbm(N, 3, 5, seed, 0.55);
  // a gentle S-curve, so most of it sits near the middle and the patches are the exception
  for(let i = 0; i < a.length; i++){ const v = a[i]; a[i] = v * v * (3 - 2 * v); }
  return a;
}

/* a disc stamped onto the field, wrapping at the edges; fn(i, d) per texel, d = 0..1 from the centre */
function disc(N, cx, cy, r, fn){
  const R = Math.ceil(r + 1);
  for(let dy = -R; dy <= R; dy++){
    const py = Math.floor(cy) + dy, yy = ((py % N) + N) % N;
    for(let dx = -R; dx <= R; dx++){
      const px = Math.floor(cx) + dx;
      const ex = (px + 0.5 - cx) / r, ey = (py + 0.5 - cy) / r, d = Math.sqrt(ex * ex + ey * ey);
      if(d < 1) fn(yy * N + (((px % N) + N) % N), d, ex, ey);
    }
  }
}

/* ---- the generators. Each returns { a: albedo RGBA bytes + mean, n: normal RGBA bytes } ---- */
const GEN = {
  /* Asphalt, 2.4 m a tile, so a texel is ~5 mm: the binder is a fine dark mortar,
     the aggregate stones 3 to 30 mm, most of them small, a few pale quartz ones that
     catch the eye; their tops are worn flat and smoother than the binder. */
  road(){
    const N = SIZE.road, r = rng(9001);
    const h = new Float32Array(N * N), alb = new Float32Array(N * N * 3), rough = new Float32Array(N * N);
    const bn = fbm(N, 32, 4, 11, 0.6), bn2 = fbm(N, 128, 2, 17, 0.5);
    for(let i = 0; i < N * N; i++){
      const t = 0.20 + 0.05 * (bn[i] - 0.5) + 0.03 * (bn2[i] - 0.5);
      alb[i * 3] = t; alb[i * 3 + 1] = t * 1.005; alb[i * 3 + 2] = t * 1.02;
      h[i] = 0.12 * bn2[i]; rough[i] = 0.96 + 0.04 * bn[i];
    }
    // the stones, until about 55% of the surface is aggregate
    let area = 0;
    while(area < N * N * 0.62){
      const u = r(), rad = 0.6 + 3.4 * Math.pow(u, 2.6);              // texels: many small, few large
      const cx = r() * N, cy = r() * N;
      const pale = r() < 0.03;
      const tone = pale ? 0.44 + 0.12 * r() : 0.25 + 0.14 * Math.pow(r(), 1.4);
      const warm = (r() - 0.4) * 0.08;
      const top = rad * (0.30 + 0.25 * r()), flat = 0.75 + 0.15 * r();
      const polish = 0.55 + 0.2 * r();
      // a stone is a little out of round: squash it along a random axis
      const sq = 0.75 + 0.25 * r(), an = r() * Math.PI, ca = Math.cos(an), sa = Math.sin(an);
      disc(N, cx, cy, rad, (i, d, ex, ey) => {
        const u2 = ex * ca + ey * sa, v2 = (-ex * sa + ey * ca) / sq, dd = Math.sqrt(u2 * u2 + v2 * v2);
        if(dd >= 1) return;
        const z = Math.min(top * flat, top * Math.pow(1 - dd * dd, 0.55));
        if(z <= h[i]) return;
        h[i] = z;
        const edge = 1 - 0.25 * dd * dd;                                 // a darker rim where it meets the binder
        alb[i * 3] = tone * edge * (1 + warm); alb[i * 3 + 1] = tone * edge; alb[i * 3 + 2] = tone * edge * (1 - warm * 0.8);
        rough[i] = z >= top * flat * 0.98 ? polish : 0.82 + 0.1 * dd;
      });
      area += Math.PI * rad * rad * sq * 0.8;
    }
    // pores in the binder: tiny dark voids
    for(let k = 0; k < N * N * 0.004; k++){
      disc(N, r() * N, r() * N, 0.6 + r() * 0.9, (i) => { if(h[i] < 0.3){ h[i] = -0.35; alb[i * 3] *= 0.55; alb[i * 3 + 1] *= 0.55; alb[i * 3 + 2] *= 0.55; rough[i] = 1; } });
    }
    // cavities darker: what sits below its neighbourhood gets less light and holds dirt
    const hb = blur(N, h, 2);
    for(let i = 0; i < N * N; i++){
      const cav = clamp01((hb[i] - h[i]) * 1.6);
      const k = 1 - 0.45 * cav;
      alb[i * 3] *= k; alb[i * 3 + 1] *= k; alb[i * 3 + 2] *= k;
    }
    return { a:packAlbedo(N, alb, rough, 0.085), n:packNormal(N, h, 1.1, macroField(N, 31)) };
  },

  /* Gravel trap stone, 1.6 m a tile (3 mm a texel): crushed, angular, 10 to 30 mm,
     in a mix of beige, grey and tan, packed with dark gaps between. Two layers of
     jittered cells: the large stones on top, smaller ones showing between. */
  gravel(){
    const N = SIZE.gravel;
    const h = new Float32Array(N * N).fill(-1), alb = new Float32Array(N * N * 3), rough = new Float32Array(N * N);
    const PAL = [[0.72, 0.67, 0.57], [0.64, 0.63, 0.60], [0.60, 0.53, 0.43], [0.50, 0.48, 0.45], [0.78, 0.75, 0.68], [0.67, 0.59, 0.48]];
    /* a layer of stones on a jittered grid, G across: each cell's stone is the region
       nearer its point than any other, shrunk back from the edge by its own margin, so
       the stones come out rounded or angular and the gaps between them uneven */
    const layer = (G, seed, hk, lift, fill) => {
      const r = rng(seed), c = N / G;
      const px = new Float32Array(G * G), py = new Float32Array(G * G), col = [], tx = new Float32Array(G * G), ty = new Float32Array(G * G), gap = new Float32Array(G * G);
      for(let k = 0; k < G * G; k++){
        px[k] = ((k % G) + 0.1 + 0.8 * r()) * c; py[k] = (Math.floor(k / G) + 0.1 + 0.8 * r()) * c;
        const p = PAL[Math.floor(r() * PAL.length)], v = 0.8 + 0.4 * r();
        col.push([p[0] * v, p[1] * v, p[2] * v]);
        tx[k] = (r() - 0.5) * 0.6; ty[k] = (r() - 0.5) * 0.6;                // each stone's facet tilt
        gap[k] = r() < fill ? 0.04 + 0.2 * r() * r() : 9;                   // 9: no stone in this cell
      }
      for(let y = 0; y < N; y++) for(let x = 0; x < N; x++){
        const gx = Math.floor(x / c), gy = Math.floor(y / c);
        let f1 = 1e9, f2 = 1e9, best = 0, bdx = 0, bdy = 0;
        for(let oy = -1; oy <= 1; oy++) for(let ox = -1; ox <= 1; ox++){
          const cxk = (gx + ox + G) % G, cyk = (gy + oy + G) % G, k = cyk * G + cxk;
          let dx = px[k] + (gx + ox - cxk) * c - (x + 0.5), dy = py[k] + (gy + oy - cyk) * c - (y + 0.5);
          const d = Math.sqrt(dx * dx + dy * dy);
          if(d < f1){ f2 = f1; f1 = d; best = k; bdx = dx; bdy = dy; } else if(d < f2) f2 = d;
        }
        const e = (f2 - f1) / c - gap[best];                              // < 0 in the gap round the stone
        if(e < 0) continue;
        const ee = Math.min(1, e / 0.3), tilt = (bdx * tx[best] + bdy * ty[best]) / c;
        const z = lift + hk * Math.sqrt(ee * Math.sqrt(ee)) + tilt * hk;   // ee^0.75: steep sides, a broad top
        const i = y * N + x;
        if(z <= h[i]) continue;
        h[i] = z;
        // a little of the light baked in: the rim darker, faces turned one way a touch lighter
        const sh = (0.74 + 0.26 * ee) * (1 + 0.25 * (tx[best] - ty[best])), cc = col[best];
        alb[i * 3] = cc[0] * sh; alb[i * 3 + 1] = cc[1] * sh; alb[i * 3 + 2] = cc[2] * sh;
        rough[i] = 0.84 + 0.12 * (1 - ee);
      }
    };
    // the gaps first: dark sandy grit
    const grit = fbm(N, 128, 2, 5, 0.5);
    for(let i = 0; i < N * N; i++){ const t = 0.24 + 0.10 * grit[i]; alb[i * 3] = t * 1.12; alb[i * 3 + 1] = t; alb[i * 3 + 2] = t * 0.82; h[i] = -0.7 + 0.25 * grit[i]; rough[i] = 1; }
    layer(110, 77, 1.8, -0.15, 0.95);                                      // small stones (4.7 px, 15 mm)
    layer(58, 78, 3.4, 0.0, 0.7);                                          // large ones (9 px, 28 mm), with holes in the layer
    // the gaps and the feet of the stones in shadow
    const hb = blur(N, h, 3);
    for(let i = 0; i < N * N; i++){
      const k = 1 - 0.35 * clamp01((hb[i] - h[i]) * 0.8);
      alb[i * 3] *= k; alb[i * 3 + 1] *= k; alb[i * 3 + 2] *= k;
    }
    return { a:packAlbedo(N, alb, rough, 0.36), n:packNormal(N, h, 1.0, macroField(N, 41)) };
  },

  /* Artificial grass, 1 m a tile (4 mm a texel): polyethylene fibres lying every
     which way, in two greens, with a sheen on some. */
  astro(){
    const N = SIZE.astro, r = rng(4242);
    const alb = new Float32Array(N * N * 3), rough = new Float32Array(N * N);
    const base = fbm(N, 16, 3, 9, 0.5);
    for(let i = 0; i < N * N; i++){ const t = 0.75 + 0.15 * base[i]; alb[i * 3] = 0.20 * t; alb[i * 3 + 1] = 0.46 * t; alb[i * 3 + 2] = 0.25 * t; rough[i] = 0.9; }
    for(let k = 0; k < N * N * 0.09; k++){
      const x0 = r() * N, y0 = r() * N, an = r() * Math.PI * 2, L = 3 + r() * 5, light = r();
      const col = light < 0.6 ? [0.22, 0.55, 0.28] : light < 0.9 ? [0.18, 0.44, 0.22] : [0.40, 0.66, 0.36];
      const v = 0.85 + 0.3 * r(), ca = Math.cos(an), sa = Math.sin(an);
      for(let s = 0; s < L; s += 0.7){
        const x = ((Math.floor(x0 + ca * s) % N) + N) % N, y = ((Math.floor(y0 + sa * s) % N) + N) % N, i = y * N + x;
        const tip = 0.8 + 0.35 * s / L;                                    // the fibres catch more light towards the tip
        alb[i * 3] = col[0] * v * tip; alb[i * 3 + 1] = col[1] * v * tip; alb[i * 3 + 2] = col[2] * v * tip;
        rough[i] = light >= 0.9 ? 0.6 : 0.78;
      }
    }
    return { a:packAlbedo(N, alb, rough, 0.18) };
  },

  /* Mown turf, 2 m a tile (8 mm a texel): blades and clumps, the hue wandering a
     little between yellow-green and blue-green, the odd bare speck. Neutralised to
     its own mean colour, so P.grass sets the green. */
  grass(){
    const N = SIZE.grass, r = rng(777);
    const alb = new Float32Array(N * N * 3), rough = new Float32Array(N * N).fill(0.97);
    const clump = fbm(N, 8, 4, 3, 0.55), hue = fbm(N, 4, 3, 13, 0.5), fine = fbm(N, 64, 2, 19, 0.5);
    for(let i = 0; i < N * N; i++){
      const l = 0.32 + 0.12 * (clump[i] - 0.5) + 0.08 * (fine[i] - 0.5), w = (hue[i] - 0.5) * 0.25;
      alb[i * 3] = l * (0.62 + w); alb[i * 3 + 1] = l * 1.0; alb[i * 3 + 2] = l * (0.42 - w * 0.6);
    }
    for(let k = 0; k < N * N * 0.25; k++){
      const x0 = r() * N, y0 = r() * N, an = r() * Math.PI * 2, L = 1.5 + r() * 3, v = r() < 0.5 ? 0.75 : 1.25 + 0.2 * r();
      const ca = Math.cos(an), sa = Math.sin(an);
      for(let s = 0; s < L; s += 0.7){
        const x = ((Math.floor(x0 + ca * s) % N) + N) % N, y = ((Math.floor(y0 + sa * s) % N) + N) % N, i = y * N + x;
        alb[i * 3] *= v; alb[i * 3 + 1] *= v; alb[i * 3 + 2] *= v;
      }
    }
    for(let k = 0; k < N * N * 0.0015; k++) disc(N, r() * N, r() * N, 0.8 + r(), (i) => { alb[i * 3] = 0.42; alb[i * 3 + 1] = 0.36; alb[i * 3 + 2] = 0.26; });
    return { a:packAlbedo(N, alb, rough, 0.12) };
  },

  /* Concrete, 2.6 m a tile (1 cm a texel): cement with fine sand in it, cloudy
     where it cured unevenly, a few pits and oil stains. */
  concrete(){
    const N = SIZE.concrete, r = rng(2024);
    const alb = new Float32Array(N * N * 3), rough = new Float32Array(N * N);
    const cloud = fbm(N, 6, 5, 23, 0.6), sand = fbm(N, 128, 2, 29, 0.5);
    for(let i = 0; i < N * N; i++){
      const t = 0.60 + 0.08 * (cloud[i] - 0.5) + 0.08 * (sand[i] - 0.5);
      alb[i * 3] = t * 1.01; alb[i * 3 + 1] = t; alb[i * 3 + 2] = t * 0.97; rough[i] = 0.86 + 0.1 * sand[i];
    }
    for(let k = 0; k < N * N * 0.03; k++){ const v = r() < 0.5 ? 0.8 : 1.15; disc(N, r() * N, r() * N, 0.5 + r() * 0.6, (i) => { alb[i * 3] *= v; alb[i * 3 + 1] *= v; alb[i * 3 + 2] *= v; }); }
    // stains: not round blots (they would repeat every tile, plain to see), but where
    // a second cloud field runs dark, a faint oily shadow that is also a little smoother
    const stain = fbm(N, 4, 4, 37, 0.6);
    for(let i = 0; i < N * N; i++){
      const s = Math.max(0, stain[i] - 0.68) / 0.32, m = 1 - 0.10 * s;
      alb[i * 3] *= m; alb[i * 3 + 1] *= m; alb[i * 3 + 2] *= m * 0.98; rough[i] -= 0.12 * s;
    }
    return { a:packAlbedo(N, alb, rough, 0.30) };
  },

  /* a fine grain, for the paint on the kerbs and under the astro, turf and concrete */
  fine(){
    const N = SIZE.fine;
    const h = fbm(N, 64, 3, 51, 0.6), g = fbm(N, 16, 2, 53, 0.5);
    for(let i = 0; i < N * N; i++) h[i] = h[i] * 0.8 + g[i] * 0.4;
    return { n:packNormal(N, h, 2.2, macroField(N, 61)) };
  },
};

/* ---- the textures, made once and kept across rebuilds ---- */
const CACHE = new Map();       // "road.a" -> THREE.DataTexture
const MEAN = new Map();        // "road.a" -> linear mean colour
function dataTex(N, data, srgb, aniso){
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true; t.anisotropy = aniso;
  if(srgb) t.encoding = THREE.sRGBEncoding;
  // shared across rebuilds: a world teardown may skip disposing it (r128 textures have no userData of their own)
  t.userData = { keep:true };
  t.needsUpdate = true;
  return t;
}
function textures(G){
  let aniso = 4;
  try{ aniso = Math.max(1, G.rend.capabilities.getMaxAnisotropy()); }catch(e){}
  for(const kind of ["road", "gravel", "astro", "grass", "concrete", "fine"]){
    if(CACHE.has(kind + (kind === "fine" ? ".n" : ".a"))) continue;
    const out = GEN[kind](), N = SIZE[kind];
    if(out.a){ CACHE.set(kind + ".a", dataTex(N, out.a.data, true, aniso)); MEAN.set(kind + ".a", out.a.mean); }
    if(out.n) CACHE.set(kind + ".n", dataTex(N, out.n, false, aniso));
  }
  // a rebuild may have disposed them (build.js disposes every map it finds in the world); that only
  // frees the GPU copy, and three uploads the same data again the next time one is drawn
  for(const t of CACHE.values()) t.anisotropy = aniso;
  return CACHE;
}

/* ---- the shader patch ----
   gScale: 1 / metres per tile.  gMacro: x strength of the light/dark field, y how much
   dust it lays (towards gDust).  gStripe: x strength, y period in metres, across the
   strip (uv2.x).  gRoughK: how much the albedo's alpha sets the roughness. */
const ROT = "mat2(0.7986, 0.6018, -0.6018, 0.7986)";      // 37 degrees, so the field never lines up with the tiles
function patch(m, o){
  const U = {
    gScale:{ value:o.scale }, gMacroK:{ value:1 / MACRO_M },
    gMacro:{ value:new THREE.Vector2(o.macro || 0, o.dust || 0) },
    gDust:{ value:o.dustCol || new THREE.Color(0.5, 0.5, 0.5) },
    gStripe:{ value:new THREE.Vector2(o.stripe || 0, o.period || 1) },
    gRoughK:{ value:o.roughK == null ? 1 : o.roughK },
  };
  m.userData.gmat = { U, kind:o.kind, tile:o.tile };
  const hasMap = !!m.map, stripe = !!o.stripe;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    if(stripe){
      sh.vertexShader = sh.vertexShader
        .replace("#include <uv2_pars_vertex>", "#include <uv2_pars_vertex>\n#if !defined( USE_LIGHTMAP ) && !defined( USE_AOMAP )\nattribute vec2 uv2;\n#endif\nvarying float gAcross;")
        .replace("#include <uv2_vertex>", "#include <uv2_vertex>\ngAcross = uv2.x;");
    }
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <map_pars_fragment>", `#include <map_pars_fragment>
uniform float gScale; uniform float gMacroK; uniform vec2 gMacro; uniform vec3 gDust; uniform vec2 gStripe; uniform float gRoughK;
${stripe ? "varying float gAcross;" : ""}`)
      .replace("#include <map_fragment>", `
vec2 gUv = vUv * gScale;
float gRough = 1.0;
${hasMap ? `vec4 gTex = texture2D( map, gUv );
gRough = mix( 1.0, gTex.a, gRoughK );
diffuseColor.rgb *= mapTexelToLinear( vec4( gTex.rgb, 1.0 ) ).rgb;` : ""}
// the slow field that breaks the tiling: the normal map's alpha, rotated and ~20x larger
float gM = texture2D( normalMap, ${ROT} * vUv * gMacroK ).a;
diffuseColor.rgb *= 1.0 + gMacro.x * ( gM - 0.5 ) * 2.0;
diffuseColor.rgb = mix( diffuseColor.rgb, gDust, gMacro.y * smoothstep( 0.42, 0.85, gM ) );
${stripe ? "diffuseColor.rgb *= 1.0 + gStripe.x * ( smoothstep( 0.42, 0.58, abs( fract( gAcross / gStripe.y ) - 0.5 ) * 2.0 ) * 2.0 - 1.0 );" : ""}`)
      .replace("#include <roughnessmap_fragment>", "float roughnessFactor = roughness * gRough;")
      .replace("#include <normal_fragment_maps>", `
vec3 mapN = texture2D( normalMap, gUv ).xyz * 2.0 - 1.0;
mapN.xy *= normalScale;
normal = perturbNormal2Arb( -vViewPosition, normal, mapN, faceDirection );`);
  };
  m.customProgramCacheKey = () => "gmat|" + (hasMap ? 1 : 0) + (stripe ? 1 : 0);
  return m;
}

/* ---- the racing surface's own colour, per vertex ----
   Rubber laid down along the racing line, heaviest where the cars brake and turn;
   the edges dustier than the middle; patches where the track was repaired, some
   lighter (old seal), some darker (fresh); and faint skid marks into the slow
   corners. For FIELD.ribbon's colour option: the road material multiplies by it. */
const hash2 = (a, b) => { let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const RC = new THREE.Color();
let busyT = null, busy = null;
// how hard the cars work the road at each node: turning now, or braking for the turn ahead
function workOf(T){
  if(busyT === T) return busy;
  const n = T.n, w = new Float32Array(n);
  for(let i = 0; i < n; i++){
    let ahead = 0;
    for(let k = 0; k <= 14; k++) ahead = Math.max(ahead, Math.abs(T.curv[(i + k) % n]) * (1 - k / 18));
    w[i] = Math.min(1, ahead / 0.014);
  }
  busyT = T; busy = w;
  return w;
}
function roadColour(T, i, off, s){
  /* FIELD.ribbon asks with i = the piece's first node even for the vertices at the
     next node, so read the line and the work at s, between the nodes: by i they
     stepped at every node, a staircase wherever the line crosses the road */
  const n = T.n, fi = s != null ? s / T.ds : i, k0 = ((Math.floor(fi) % n) + n) % n, k1 = (k0 + 1) % n, f = fi - Math.floor(fi);
  const W = workOf(T), half = T.half;
  const line = T.line ? T.line[k0] + (T.line[k1] - T.line[k0]) * f : 0;
  const work = W[k0] + (W[k1] - W[k0]) * f, curv = Math.abs(T.curv[k0] + (T.curv[k1] - T.curv[k0]) * f);
  if(s == null) s = i * T.ds;
  let k = 1;
  /* The rubber: a band a little wider than a car, darker where the work is. Nothing
     here is narrower than about two lanes of the ribbon (1.5 m): a vertex colour
     cannot draw a finer feature, it only steps along it (narrow tyre tracks were
     tried, and showed as a staircase from overhead). */
  const d = (off - line) / 1.7, rub = Math.exp(-d * d);
  k *= 1 - rub * (0.10 + 0.20 * work);
  // the edges see no cars and collect dust
  const edge = clamp01((Math.abs(off) - (half - 1.6)) / 1.6);
  k *= 1 + 0.07 * edge;
  // repair patches: cells 21 m along and 4.5 m across, about one in fourteen; kept faint,
  // because a vertex colour can only draw them as soft-edged blocks
  const cs = Math.floor(s / 21), co = Math.floor((off + 40) / 4.5), p = hash2(cs, co);
  if(p < 0.07) k *= p < 0.04 ? 1.06 : 0.94;
  // faint skid marks: in the braking zones, a long smudge where a car locked up, off the line a little
  if(work > 0.55 && curv < 0.006){
    const q = hash2(Math.floor(s / 35), 7);
    if(q < 0.6){
      const e = (off - (line + (q - 0.3) * 4)) / 1.3;
      k *= 1 - 0.07 * Math.exp(-e * e);
    }
  }
  return RC.setScalar(k);
}

/* ---- the materials ---- */
const MAT = { list:[], dry:[] };
function mk(G, o, extra){
  const m = new THREE.MeshStandardMaterial(Object.assign({ roughness:0.95, metalness:0 }, extra));
  patch(m, o);
  MAT.list.push(m);
  return m;
}

const GMAT = {
  TILE,
  /* G3, the track, its palette (P.road, P.grass; optional P.gravel, P.astro, P.concrete,
     P.dust override the defaults). opts.roadVertexColours (default true): the road then
     expects a colour attribute (FIELD.ribbon with colour:GMAT.roadColourOf(T)). Without
     one WebGL reads the missing colour as black, so pass false if the road has none.
     The kerb material always has vertexColors: its geometry must carry colours. */
  build(G, T, P, opts){
    const op = opts || {};
    this.dispose();
    const tx = textures(G);
    const meanOf = (key, css) => { const c = G.col(css), mn = MEAN.get(key); return c.setRGB(c.r / mn.r, c.g / mn.g, c.b / mn.b); };
    const nv = (x, y) => new THREE.Vector2(x, y);
    const road = mk(G, { kind:"road", tile:TILE.road, scale:1 / TILE.road, macro:0.06 },
      { map:tx.get("road.a"), normalMap:tx.get("road.n"), normalScale:nv(0.9, 0.9), roughness:0.94, color:meanOf("road.a", P.road),
        vertexColors:op.roadVertexColours !== false });
    // run-off tarmac: the same asphalt, coarser, lighter, dust blown over it in drifts
    const tarmac = mk(G, { kind:"tarmac", tile:TILE.tarmac, scale:1 / TILE.tarmac, macro:0.12, dust:0.35, dustCol:G.col(P.dust || "#A8A294") },
      { map:tx.get("road.a"), normalMap:tx.get("road.n"), normalScale:nv(1.2, 1.2), roughness:0.97, color:meanOf("road.a", shade(P.road, 0.24)) });
    const gravel = mk(G, { kind:"gravel", tile:TILE.gravel, scale:1 / TILE.gravel, macro:0.10 },
      { map:tx.get("gravel.a"), normalMap:tx.get("gravel.n"), normalScale:nv(1.5, 1.5), roughness:1.0, color:meanOf("gravel.a", P.gravel || "#ADA38C") });
    const astro = mk(G, { kind:"astro", tile:TILE.astro, scale:1 / TILE.astro, macro:0.06, stripe:0.06, period:2.0 },
      { map:tx.get("astro.a"), normalMap:tx.get("fine.n"), normalScale:nv(0.7, 0.7), roughness:0.85, color:meanOf("astro.a", P.astro || "#3E8A4A") });
    const grass = mk(G, { kind:"grass", tile:TILE.grass, scale:1 / TILE.grass, macro:0.16, dust:0.18, dustCol:G.col(shade(P.grass, 0.12)), stripe:0.05, period:6.0 },
      { map:tx.get("grass.a"), normalMap:tx.get("fine.n"), normalScale:nv(0.5, 0.5), roughness:0.97, color:meanOf("grass.a", P.grass) });
    const concrete = mk(G, { kind:"concrete", tile:TILE.concrete, scale:1 / TILE.concrete, macro:0.12 },
      { map:tx.get("concrete.a"), normalMap:tx.get("fine.n"), normalScale:nv(0.35, 0.35), roughness:0.92, color:meanOf("concrete.a", P.concrete || "#A4A29C") });
    // kerb paint: white, the colours come per vertex; a satin finish and the grain of the paint
    const kerb = mk(G, { kind:"kerb", tile:TILE.kerb, scale:1 / TILE.kerb, macro:0.05 },
      { normalMap:tx.get("fine.n"), normalScale:nv(0.3, 0.3), roughness:0.58, color:new THREE.Color(1, 1, 1), vertexColors:true });
    const out = { road, tarmac, gravel, astro, grass, concrete, kerb };
    // what each is in the dry, and how much the wet takes off: colour, roughness
    const WET = { tarmac:[0.30, 0.22], gravel:[0.35, 0.0], astro:[0.15, 0.15], grass:[0.20, 0.05], concrete:[0.35, 0.25], kerb:[0.10, 0.12] };
    MAT.dry = Object.keys(WET).map(k => ({ m:out[k], c:out[k].color.clone(), r:out[k].roughness, k:WET[k], dust:out[k].userData.gmat.U.gMacro.value.y }));
    this.mats = out;
    return out;
  },
  roadColour,
  // the same, bound to a track, in the shape FIELD.ribbon's colour option calls: (i, off, s)
  roadColourOf(T){ return (i, off, s) => roadColour(T, i, off, s); },
  /* Gives a geometry laid some other way (G3.strip, a world's own patch) the UVs these
     materials expect, from its positions: uv = world metres (game x, y), uv2 = metres
     out from the road edge, metres along the lap, as FIELD.ribbon writes them. Keeps
     the geometry and its triangle count; null passes through (G3.strip returns null
     when nothing is laid). Build time only: one T.near per vertex, with a hint. */
  worldUV(g, T){
    if(!g) return g;
    const p = g.attributes.position, uv = new Float32Array(p.count * 2), uv2 = new Float32Array(p.count * 2);
    let hint = 0;
    for(let k = 0; k < p.count; k++){
      const x = p.getX(k), y = p.getZ(k), i = T.near(x, y, hint);
      const dx = x - T.x[i], dy = y - T.y[i];
      hint = i;
      uv[k * 2] = x; uv[k * 2 + 1] = y;
      uv2[k * 2] = Math.abs(dx * T.nx[i] + dy * T.ny[i]) - T.half;
      uv2[k * 2 + 1] = i * T.ds + dx * T.tx[i] + dy * T.ty[i];
    }
    g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    g.setAttribute("uv2", new THREE.BufferAttribute(uv2, 2));
    return g;
  },
  /* the ground darkens and loses its dust as it gets wet; the road is weather.js's.
     Safe to call every frame: it writes a few numbers, allocates nothing. */
  wet(wv){
    const w = clamp01(wv || 0);
    for(const d of MAT.dry){
      d.m.color.copy(d.c).multiplyScalar(1 - d.k[0] * w);
      d.m.roughness = Math.max(0.55, d.r - d.k[1] * w);
      d.m.userData.gmat.U.gMacro.value.y = d.dust * (1 - w);
    }
  },
  /* the materials go with the world; the textures stay for the next build unless all is true */
  dispose(all){
    for(const m of MAT.list) m.dispose();
    MAT.list = []; MAT.dry = []; this.mats = null;
    if(all){ for(const t of CACHE.values()) t.dispose(); CACHE.clear(); MEAN.clear(); }
  },
  /* what the textures cost: count and bytes with mips (4/3 of the top level) */
  budget(){
    let bytes = 0;
    for(const t of CACHE.values()) bytes += t.image.width * t.image.height * 4 * 4 / 3;
    return { textures:CACHE.size, bytes, mb:bytes / 1048576 };
  },
  textures:CACHE,
};

export { GMAT, roadColour, GEN };
