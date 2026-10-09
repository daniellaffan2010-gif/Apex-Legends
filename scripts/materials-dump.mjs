/* Every ground texture GMAT makes, as PNGs to look at, plus what they cost.
   node scripts/materials-dump.mjs <outdir> [tiles]
   For each texture: <name>.png (RGB, tiled `tiles` x `tiles` so the seams show), <name>-alpha.png (its
   alpha as grey: roughness on an albedo, the macro field on a normal map). Prints the generation time and
   the memory with mips. */
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import * as THREE from 'three';
const { GMAT } = await import('../src/render3d/ground/materials.js');

const [outDir = process.env.TMPDIR || '.', tilesArg = '2'] = process.argv.slice(2);
const tiles = +tilesArg;
fs.mkdirSync(outDir, { recursive: true });
const G = { rend: { capabilities: { getMaxAnisotropy: () => 16 } }, col: c => new THREE.Color(c).convertSRGBToLinear() };
const P = { road: '#4F5258', grass: '#5C7D40', ground: '#B8AE90' };
const t0 = performance.now();
GMAT.build(G, {}, P);
const t1 = performance.now();
const t2s = performance.now(); GMAT.build(G, {}, P); const t2 = performance.now();

const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc = buf => { let c = -1; for (const b of buf) c = crcT[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const cr = Buffer.alloc(4); cr.writeUInt32BE(crc(td)); return Buffer.concat([len, td, cr]); };
function png(file, W, H, px) {             // px(x, y) -> [r, g, b] bytes
  const raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) { raw[y * (W * 3 + 1)] = 0; for (let x = 0; x < W; x++) { const c = px(x, y), q = y * (W * 3 + 1) + 1 + x * 3; raw[q] = c[0]; raw[q + 1] = c[1]; raw[q + 2] = c[2]; } }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}
for (const [name, t] of GMAT.textures) {
  const N = t.image.width, d = t.image.data, W = N * tiles;
  // PNG rows go down the image; texture row 0 is v = 0, so flip to show it the way a map is read (v up)
  const at = (x, y) => ((N - 1 - (y % N)) * N + (x % N)) * 4;
  png(path.join(outDir, name + '.png'), W, W, (x, y) => { const o = at(x, y); return [d[o], d[o + 1], d[o + 2]]; });
  png(path.join(outDir, name + '-alpha.png'), W, W, (x, y) => { const o = at(x, y); return [d[o + 3], d[o + 3], d[o + 3]]; });
  let a = 0; for (let i = 3; i < d.length; i += 4) a += d[i];
  console.log(name.padEnd(11), N + 'x' + N, 'mean alpha', (a / (N * N) / 255).toFixed(3), t.encoding === THREE.sRGBEncoding ? 'sRGB' : 'linear', 'aniso', t.anisotropy);
}
const b = GMAT.budget();
console.log('textures', b.textures, '| memory with mips', b.mb.toFixed(2), 'MB | generated in', (t1 - t0).toFixed(0), 'ms | rebuild', (t2 - t2s).toFixed(1), 'ms');
for (const [k, m] of Object.entries(GMAT.mats)) console.log(k.padEnd(9), 'colour', m.color.toArray().map(v => v.toFixed(3)).join(','), 'rough', m.roughness, 'metal', m.metalness, 'vertexColors', m.vertexColors, 'key', m.customProgramCacheKey());
