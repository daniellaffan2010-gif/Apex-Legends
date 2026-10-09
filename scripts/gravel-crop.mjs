/* Cut a piece out of a picture from cockpit-render.mjs and blow it up, to look at things a few pixels big.
   node scripts/gravel-crop.mjs <in.png> <out.png> <x> <y> <w> <h> [zoom]
   Reads only what that script writes: 8-bit RGB, unfiltered rows. */
import fs from 'node:fs';
import zlib from 'node:zlib';
const [inp, out, X, Y, Wc, Hc, Z = '2'] = process.argv.slice(2);
const buf = fs.readFileSync(inp);
let o = 8, W = 0, H = 0; const idat = [];
while (o < buf.length) {
  const len = buf.readUInt32BE(o), type = buf.toString('ascii', o + 4, o + 8), data = buf.subarray(o + 8, o + 8 + len);
  if (type === 'IHDR') { W = data.readUInt32BE(0); H = data.readUInt32BE(4); }
  if (type === 'IDAT') idat.push(data);
  o += 12 + len;
}
const raw = zlib.inflateSync(Buffer.concat(idat));
const x0 = +X, y0 = +Y, w = +Wc, h = +Hc, z = +Z, OW = w * z, OH = h * z;
const outRaw = Buffer.alloc((OW * 3 + 1) * OH);
for (let y = 0; y < OH; y++) {
  outRaw[y * (OW * 3 + 1)] = 0;
  for (let x = 0; x < OW; x++) {
    const sx = Math.min(W - 1, x0 + Math.floor(x / z)), sy = Math.min(H - 1, y0 + Math.floor(y / z));
    const s = sy * (W * 3 + 1) + 1 + sx * 3, d = y * (OW * 3 + 1) + 1 + x * 3;
    outRaw[d] = raw[s]; outRaw[d + 1] = raw[s + 1]; outRaw[d + 2] = raw[s + 2];
  }
}
const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc = b => { let c = -1; for (const v of b) c = crcT[(c ^ v) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
const ih = Buffer.alloc(13); ih.writeUInt32BE(OW, 0); ih.writeUInt32BE(OH, 4); ih[8] = 8; ih[9] = 2;
fs.writeFileSync(out, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(outRaw)), chunk('IEND', Buffer.alloc(0))]));
console.log('wrote', out, OW + 'x' + OH);
