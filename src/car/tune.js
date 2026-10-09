/* Car setup: four sliders (0..1, 0.5 = the standard car) turned into the multipliers Car.step reads from `c.su`.
   Only the player's car gets a non-neutral setup; the rivals keep NEUTRAL, so their physics never change.
     wing     low = skinny wings (fast on straights, loose in corners)   high = downforce (grip, drag)
     gear     short = punchy acceleration, low top speed                 long = slow pull, high top speed
     bias     rear = a touch more stopping force, but the back locks and spins you sooner
              forward = stable braking, slightly longer stops
     press    low = more grip, hotter, faster wear                       high = less grip, cooler, longer life
   Every effect is small and two-sided, so no slider is free lunch. */
import { clamp } from '../config/util.js';

const NEUTRAL = Object.freeze({ grip: 1, top: 1, power: 1, drag: 1, brake: 1, stab: 1, wear: 1, heat: 0, gearSpan: 1 });
const SLIDERS = [
  { key: "wing",  label: "Wing angle",     lo: "Low drag",       hi: "High downforce" },
  { key: "gear",  label: "Gearing",        lo: "Short · punchy", hi: "Long · top speed" },
  { key: "bias",  label: "Brake bias",     lo: "Rear",           hi: "Front" },
  { key: "press", label: "Tyre pressure",  lo: "Soft · grippy",  hi: "Hard · durable" }
];
const DEFAULT = Object.freeze({ wing: 0.5, gear: 0.5, bias: 0.5, press: 0.5 });
const w1 = v => (clamp(v == null ? 0.5 : +v, 0, 1) - 0.5) * 2;     // 0..1 -> -1..1

function tune(s){
  s = s || DEFAULT;
  const wing = w1(s.wing), gear = w1(s.gear), bias = w1(s.bias), pr = w1(s.press);
  return {
    grip:  (1 + 0.06 * wing) * (1 - 0.035 * pr),
    top:   (1 - 0.012 * wing) * (1 + 0.04 * gear),
    power: 1 - 0.06 * gear,
    drag:  (1 + 0.18 * wing) * (1 - 0.015 * pr),
    brake: 1 - 0.035 * bias,                                      // forward bias gives away a little stopping force
    stab:  bias > 0 ? 1 - 0.18 * bias : 1 + 0.25 * -bias,         // brake-lock demand: rearward bias spins you sooner
    wear:  1 - 0.22 * pr,
    heat:  -0.08 * pr,
    gearSpan: 1 + 0.12 * gear
  };
}

const isNeutral = s => !s || ["wing", "gear", "bias", "press"].every(k => Math.abs((s[k] == null ? 0.5 : s[k]) - 0.5) < 1e-6);
export { DEFAULT, NEUTRAL, SLIDERS, isNeutral, tune };
