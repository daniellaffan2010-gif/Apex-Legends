/* A batch of materials-render.mjs pictures, four at a time, with the materials hook installed.
   node scripts/materials-shots.mjs <outdir> "<track> <node> <tag> [ENV=v ...]" ...
   e.g. node scripts/materials-shots.mjs $TMPDIR "spa 18 c" "spa 18 h CAM=high" "monza 10 w WET=1" */
import { spawn } from 'node:child_process';
const [out, ...jobs] = process.argv.slice(2);
const run = job => new Promise(res => {
  const [tr, nd, tag, ...envs] = job.split(/\s+/);
  const env = { ...process.env, HOOKS: 'scripts/hooks/materials-hook.mjs' };
  for (const e of envs) { const [k, v] = e.split('='); env[k] = v; }
  const file = `${out}/m_${tr}_${tag}.png`;
  const p = spawn(process.execPath, ['--import', './scripts/asset-register.mjs', 'scripts/materials-render.mjs', tr, nd, file, env.STEER || '0', env.WIDTH || '960'], { env });
  let log = '';
  p.stdout.on('data', d => (log += d)); p.stderr.on('data', d => (log += d));
  p.on('close', code => { console.log(job, '->', code, log.split('\n').filter(l => /materials-hook|wrote|wetVis|Error|error/.test(l)).join(' | ')); res(); });
});
const q = [...jobs];
await Promise.all([0, 1, 2, 3].map(async () => { while (q.length) await run(q.shift()); }));
