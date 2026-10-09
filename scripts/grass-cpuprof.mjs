/* Self time by function from a .cpuprofile: node scripts/grass-cpuprof.mjs <file> */
const fs = await import('node:fs');
const p = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const self = new Map(), byId = new Map(p.nodes.map(n => [n.id, n]));
const dt = p.timeDeltas; let tot = 0;
for (let k = 0; k < p.samples.length; k++) {
  const n = byId.get(p.samples[k]), f = n.callFrame, key = f.functionName + ' ' + f.url.split('/').pop() + ':' + f.lineNumber;
  self.set(key, (self.get(key) || 0) + dt[k]); tot += dt[k];
}
for (const [k, v] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 18)) console.log((v / tot * 100).toFixed(1).padStart(5) + '%', k);
