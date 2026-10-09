/* GMAT.roadColour unrolled: the lap along x (one pixel per metre), the road across y (10 px a metre), as a PNG,
   with the racing line and the node's "work" drawn under it, to see the rubber, patches and skid marks.
   node --import ./scripts/asset-register.mjs scripts/materials-roadmap.mjs <track> <fromNode> <toNode> <out.png> */
globalThis.window = globalThis;
import fs from 'node:fs';
import zlib from 'node:zlib';
const { roadColour } = await import('../src/render3d/ground/materials.js');
const { TRACKS } = await import('../src/tracks/index.js');
const { buildTrack } = await import('../src/tracks/build.js');
const [id = 'silverstone', a = '700', b = '842', out = 'roadmap.png'] = process.argv.slice(2);
const T = buildTrack(TRACKS.find(t => t.id === id));
const i0 = +a, i1 = +b, W = Math.round((i1 - i0) * T.ds), H = Math.round(T.half * 2 * 10);
const raw = Buffer.alloc((W * 3 + 1) * H);
for (let y = 0; y < H; y++) {
  raw[y * (W * 3 + 1)] = 0;
  for (let x = 0; x < W; x++) {
    const s = i0 * T.ds + x, i = Math.min(T.n - 1, Math.floor(s / T.ds)), off = T.half - y / 10;
    let v = roadColour(T, i, off, s).r * 0.55;
    if (Math.abs(off - T.line[i]) < 0.05) v = 1;
    const q = y * (W * 3 + 1) + 1 + x * 3, c = Math.round(Math.min(1, v) * 255);
    raw[q] = c; raw[q + 1] = c; raw[q + 2] = c;
  }
}
const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc = buf => { let c = -1; for (const by of buf) c = crcT[(c ^ by) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const cr = Buffer.alloc(4); cr.writeUInt32BE(crc(td)); return Buffer.concat([len, td, cr]); };
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
fs.writeFileSync(out, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
console.log('wrote', out, W + 'x' + H);
