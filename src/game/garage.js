/* The garage's saved setups: a list of named slider sets and which one is fitted to the player's car.
   Persisted under store("garage"). The sliders themselves and what they do live in car/tune.js. */
import { store } from '../config/util.js';
import { DEFAULT, SLIDERS, tune } from '../car/tune.js';

const MAX = 8;
const KEYS = SLIDERS.map(s => s.key);
const clean = v => Math.round(Math.min(1, Math.max(0, +v)) * 100) / 100;

function fresh(){ return { sel: "std", list: [{ id: "std", name: "Standard", ...DEFAULT }] }; }
function load(){
  const g = store("garage");
  if(!g || !Array.isArray(g.list) || !g.list.length) return fresh();
  g.list = g.list.filter(x => x && x.id).slice(0, MAX).map(x => {
    const o = { id: String(x.id), name: String(x.name || "Setup").slice(0, 18) };
    for(const k of KEYS) o[k] = clean(x[k] == null || isNaN(+x[k]) ? 0.5 : x[k]);
    return o;
  });
  if(!g.list.length) return fresh();
  if(!g.list.some(x => x.id === g.sel)) g.sel = g.list[0].id;
  return g;
}
const save = g => { store("garage", g); return g; };

const selected = g => (g || load()).list.find(x => x.id === (g || load()).sel);
function select(id){ const g = load(); if(g.list.some(x => x.id === id)) g.sel = id; return save(g); }
function upsert(setup){
  const g = load(), i = g.list.findIndex(x => x.id === setup.id);
  const o = { id: setup.id, name: String(setup.name || "Setup").slice(0, 18) };
  for(const k of KEYS) o[k] = clean(setup[k]);
  if(i >= 0) g.list[i] = o; else if(g.list.length < MAX) g.list.push(o); else return g;
  return save(g);
}
function add(name, from){
  const g = load();
  if(g.list.length >= MAX) return g;
  const id = "s" + Date.now().toString(36) + Math.floor(Math.random() * 1e3).toString(36);
  const o = { id, name: String(name || "Setup " + (g.list.length + 1)).slice(0, 18) };
  for(const k of KEYS) o[k] = clean(from && from[k] != null ? from[k] : 0.5);
  g.list.push(o); g.sel = id;
  return save(g);
}
function remove(id){
  const g = load();
  if(g.list.length <= 1) return g;
  g.list = g.list.filter(x => x.id !== id);
  if(!g.list.some(x => x.id === g.sel)) g.sel = g.list[0].id;
  return save(g);
}
// the multipliers Car.step reads, for whichever setup is fitted
const fitted = () => tune(selected());

export { MAX, add, fitted, load, remove, save, select, selected, upsert };
