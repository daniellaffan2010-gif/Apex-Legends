import gunUrl from './samples/gun.mp3';
import radioUrl from './samples/radio.mp3';
import { clamp, fmtTime } from '../config/util.js';
import { showToast } from '../ui/screens.js';

/* ---------- 9. sound ------------------------------------------------------
   Everything here is synthesised — no samples. Engines are exhaust-pulse trains
   fired through fixed formants, tyres and crew are filtered noise, and the radio
   is on-screen text cued by a squelch beep.
   -------------------------------------------------------------------------- */
const AUDIO = {
  ok:false, on:true, ctx:null, master:null, noiseBuf:null,
  eng:null, traf:[], squeal:null, crowd:null, wind:null,
  lastSay:0, lastCom:0, lastGap:0, lastPos:0, gunT:0, yellT:0,
  saidBox:false, saidTyre:false, saidStart:false,

  init(){
    if(this.ctx || !this.on) return;
    try{
      const AC = window.AudioContext || window.webkitAudioContext;
      if(!AC) return;
      const c = this.ctx = new AC();
      const m = this.master = c.createGain();
      m.gain.value = 0.5; m.connect(c.destination);
      const len = Math.floor(c.sampleRate * 2);
      const buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
      let last = 0;
      for(let i = 0; i < len; i++){ const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = w * 0.7 + last * 1.6; }
      this.noiseBuf = buf;
      this.ok = true;
      this.loadSamples();
    }catch(e){ this.ok = false; }
  },
  resume(){ if(this.ctx && this.ctx.state === "suspended") this.ctx.resume(); },

  /* ---- recorded samples ---------------------------------------------------
     Engines are two looping layers crossfaded by revs, each resampled with
     playbackRate so pitch tracks continuously — the standard racing-game trick.
     If anything fails to load we fall back to the synthesised engine.        */
  SRC:{ gun:gunUrl, radio:radioUrl },
  buf:{}, useSamples:false, loading:false,

  // works whether the clip is a file alongside the page or inlined as a data URI
  fetchAudio(url){
    if(url.slice(0, 5) === "data:"){
      try{
        const bin = atob(url.slice(url.indexOf(",") + 1));
        const ab = new ArrayBuffer(bin.length), v = new Uint8Array(ab);
        for(let i = 0; i < bin.length; i++) v[i] = bin.charCodeAt(i);
        return Promise.resolve(ab);
      }catch(e){ return Promise.reject(e); }
    }
    return fetch(url).then(r => r.ok ? r.arrayBuffer() : Promise.reject(r.status));
  },
  loadSamples(){
    if(this.loading || !this.ctx) return;
    this.loading = true;
    const names = Object.keys(this.SRC);
    let done = 0;
    names.forEach(nm => {
      this.fetchAudio(this.SRC[nm])
        .then(ab => new Promise((res, rej) => {
          const p = this.ctx.decodeAudioData(ab, res, rej);
          if(p && p.then) p.then(res, rej);
        }))
        .then(b => { this.buf[nm] = b; })
        .catch(() => {})
        .finally(() => { if(++done === names.length) this.samplesReady(); });
    });
  },
  samplesReady(){
    try{
      this.useSamples = true;
    }catch(e){ this.useSamples = false; }
  },
  /* one engine recording, resampled across the whole rev range */
  sVoice(buf, simple){
    const c = this.ctx, out = c.createGain(); out.gain.value = 0;
    const pan = c.createStereoPanner ? c.createStereoPanner() : null;
    const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 5000; lp.Q.value = 0.4;
    const hp = c.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 60;
    const s2 = c.createBufferSource(); s2.buffer = buf; s2.loop = true;
    // keep the loop away from the clip's own fade in and out
    s2.loopStart = Math.min(0.2, buf.duration * 0.05);
    s2.loopEnd = Math.max(s2.loopStart + 0.4, buf.duration - 0.15);
    const g = c.createGain(); g.gain.value = 0;
    s2.connect(g); g.connect(hp); hp.connect(lp); lp.connect(out);
    if(pan){ out.connect(pan); pan.connect(this.master); } else out.connect(this.master);
    s2.start(0, s2.loopStart + Math.random() * (s2.loopEnd - s2.loopStart) * 0.8);
    return { set:(rn, thr, vol, pv, dop) => {
      const t = c.currentTime, r = clamp(rn, -0.4, 1.35);
      s2.playbackRate.setTargetAtTime(clamp((0.60 + r * 1.00) * (dop || 1), 0.3, 3), t, 0.035);
      g.gain.setTargetAtTime(vol, t, 0.06);
      lp.frequency.setTargetAtTime(1200 + thr * 8500 + Math.max(0, r) * 3200, t, 0.05);
      out.gain.setTargetAtTime(vol > 0 ? 1 : 0, t, 0.05);
      if(pan) pan.pan.setTargetAtTime(pv, t, 0.07);
    } };
  },
  sLoop(b, startAt){
    const c = this.ctx;
    const s = c.createBufferSource(); s.buffer = b; s.loop = true;
    s.loopStart = Math.min(0.2, b.duration * 0.05);
    s.loopEnd = Math.max(s.loopStart + 0.5, b.duration - 0.15);
    const g = c.createGain(); g.gain.value = 0;
    const pan = c.createStereoPanner ? c.createStereoPanner() : null;
    s.connect(g);
    if(pan){ g.connect(pan); pan.connect(this.master); } else g.connect(this.master);
    s.start(0, startAt || s.loopStart);
    return { src:s, gain:g, pan, set:(v, rate, pv) => { const t = c.currentTime;
      g.gain.setTargetAtTime(v, t, 0.10);
      if(rate) s.playbackRate.setTargetAtTime(rate, t, 0.1);
      if(pan && pv != null) pan.pan.setTargetAtTime(pv, t, 0.12); } };
  },
  /* fire a slice of a sample as a one-shot */
  slice(name, off, dur, vol, pv, rate){
    const b = this.buf[name];
    if(!b || !this.ok) return false;
    const c = this.ctx, t = c.currentTime;
    const s = c.createBufferSource(); s.buffer = b; s.playbackRate.value = rate || 1;
    const g = c.createGain();
    const d = Math.min(dur, Math.max(0.05, b.duration - off));
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + Math.min(0.03, d * 0.25));
    g.gain.setTargetAtTime(0.0001, t + d * 0.7, d * 0.25);
    const pan = c.createStereoPanner ? c.createStereoPanner() : null;
    s.connect(g);
    if(pan){ pan.pan.value = pv || 0; g.connect(pan); pan.connect(this.master); } else g.connect(this.master);
    s.start(t, clamp(off, 0, Math.max(0, b.duration - 0.1)), d);
    s.stop(t + d / (rate || 1) + 0.1);
    return true;
  },
  /* An engine is a train of exhaust pulses fired through fixed resonances.
     The pulse RATE tracks revs; the resonances do NOT move — that is what stops
     it sounding like a synth sweep. Harmonic-rich periodic wave -> four fixed
     formants -> mechanical noise on top. */
  engineWave(){
    if(this._wave) return this._wave;
    const N = 24, real = new Float32Array(N), imag = new Float32Array(N);
    for(let i = 1; i < N; i++){
      const roll = Math.pow(i, -0.85);                       // spectral tilt
      const lumpy = 1 + 0.35 * Math.sin(i * 1.9) + 0.18 * Math.sin(i * 4.3);
      imag[i] = roll * lumpy * (i % 2 ? 1 : 0.72);           // uneven firing
    }
    return (this._wave = this.ctx.createPeriodicWave(real, imag, { disableNormalization:false }));
  },
  voice(simple){
    const c = this.ctx, out = c.createGain(); out.gain.value = 0;
    const pan = c.createStereoPanner ? c.createStereoPanner() : null;

    // fixed exhaust / bodyshell resonances — these never track rpm
    const mkF = (type, f, q, g) => { const b = c.createBiquadFilter(); b.type = type;
      b.frequency.value = f; b.Q.value = q; if(g != null) b.gain.value = g; return b; };
    const sum = c.createGain(); sum.gain.value = 1;
    const fm1 = mkF("bandpass", 165, 7), fm2 = mkF("bandpass", 480, 5.5),
          fm3 = mkF("bandpass", 1180, 4), fm4 = mkF("peaking", 2550, 1.6, 7);
    const gm1 = c.createGain(), gm2 = c.createGain(), gm3 = c.createGain();
    gm1.gain.value = 0.9; gm2.gain.value = 0.55; gm3.gain.value = 0.3;
    const tone = c.createGain();                              // brightness control
    const lp = mkF("lowpass", 1400, 0.7);

    const osc = c.createOscillator(); osc.setPeriodicWave(this.engineWave());
    const sub = c.createOscillator(); sub.type = "sine";
    const subg = c.createGain(); subg.gain.value = 0.32;
    osc.connect(fm1); osc.connect(fm2); osc.connect(fm3); osc.connect(fm4);
    fm1.connect(gm1); fm2.connect(gm2); fm3.connect(gm3);
    gm1.connect(sum); gm2.connect(sum); gm3.connect(sum); fm4.connect(sum);
    sub.connect(subg); subg.connect(sum);
    sum.connect(lp); lp.connect(tone); tone.connect(out);
    tone.gain.value = 1;

    // valvetrain / induction rattle, level rises with revs
    let mechG = null;
    if(!simple){
      const ns = c.createBufferSource(); ns.buffer = this.noiseBuf; ns.loop = true;
      const bp = mkF("bandpass", 2600, 1.1);
      mechG = c.createGain(); mechG.gain.value = 0;
      ns.connect(bp); bp.connect(mechG); mechG.connect(lp); ns.start();
    }
    if(pan){ out.connect(pan); pan.connect(this.master); } else out.connect(this.master);
    osc.start(); sub.start();

    let jitter = 0, jt = 0;
    return { set:(fire, thr, vol, pv, bright, dt) => {
      const t = c.currentTime;
      // combustion is never perfectly even — a touch of wander keeps it organic
      jt -= dt || 0.016;
      if(jt <= 0){ jt = 0.045 + Math.random() * 0.05; jitter = (Math.random() - 0.5) * 0.022; }
      const f = Math.max(20, fire * (1 + jitter));
      osc.frequency.setTargetAtTime(f, t, 0.012);
      sub.frequency.setTargetAtTime(f / 3, t, 0.02);
      // on throttle the upper formants open up; off throttle it goes hollow
      gm2.gain.setTargetAtTime(0.35 + thr * 0.5, t, 0.05);
      gm3.gain.setTargetAtTime(0.12 + thr * 0.42, t, 0.05);
      lp.frequency.setTargetAtTime(bright, t, 0.04);
      if(mechG) mechG.gain.setTargetAtTime(0.012 + 0.03 * clamp(fire / 600, 0, 1), t, 0.06);
      out.gain.setTargetAtTime(vol, t, 0.05);
      if(pan) pan.pan.setTargetAtTime(pv, t, 0.07);
    } };
  },
  noiseVoice(type, freq, q, g){
    const c = this.ctx;
    const src = c.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const gn = c.createGain(); gn.gain.value = g;
    const pan = c.createStereoPanner ? c.createStereoPanner() : null;
    src.connect(f); f.connect(gn);
    if(pan){ gn.connect(pan); pan.connect(this.master); } else gn.connect(this.master);
    src.start();
    return { gain:gn, filt:f, pan, set:(v, fr, pv) => { const t = c.currentTime;
      gn.gain.setTargetAtTime(v, t, 0.08);
      if(fr) f.frequency.setTargetAtTime(fr, t, 0.1);
      if(pan && pv != null) pan.pan.setTargetAtTime(pv, t, 0.1); } };
  },
  /* short one-shots */
  burst(freq, q, dur, vol, pv, type){
    if(!this.ok) return;
    const c = this.ctx, t = c.currentTime;
    const src = c.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    const f = c.createBiquadFilter(); f.type = type || "bandpass"; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + Math.min(0.02, dur * 0.3));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const pan = c.createStereoPanner ? c.createStereoPanner() : null;
    src.connect(f); f.connect(g);
    if(pan){ pan.pan.value = pv || 0; g.connect(pan); pan.connect(this.master); } else g.connect(this.master);
    src.start(t); src.stop(t + dur + 0.05);
  },
  pop(v){
    return;
    if(this.slice("backfire", 0.05 + Math.random() * 0.5, 0.35, 0.30 * v, (Math.random() - 0.5) * 0.4, 0.9 + Math.random() * 0.5)) return;
    this.burst(220 + Math.random() * 900, 3, 0.07, 0.07 * v, (Math.random() - 0.5) * 0.4);
  },
  whoosh(pv, spd){
    return;
    if(!this.ok) return;
    if(this.buf.passby && this.slice("passby", 2 + Math.random() * 25, 0.7,
        clamp(0.25 + spd * 0.02, 0.1, 0.6), pv, 1.05 + Math.random() * 0.25)) return;
    const c = this.ctx, t = c.currentTime, dur = 0.42;
    const src = c.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    const f = c.createBiquadFilter(); f.type = "bandpass"; f.Q.value = 1.1;
    f.frequency.setValueAtTime(1800, t); f.frequency.exponentialRampToValueAtTime(380, t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(clamp(0.05 + spd * 0.006, 0.02, 0.16), t + 0.10);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const pan = c.createStereoPanner ? c.createStereoPanner() : null;
    src.connect(f); f.connect(g);
    if(pan){ pan.pan.setValueAtTime(pv, t); pan.pan.linearRampToValueAtTime(-pv, t + dur); g.connect(pan); pan.connect(this.master); }
    else g.connect(this.master);
    src.start(t); src.stop(t + dur + 0.05);
  },
  gun(pv){   // wheel gun
    if(!this.ok) return;
    if(this.slice("gun", 0.1 + Math.random() * 2.8, 0.42, 0.5, pv, 0.95 + Math.random() * 0.3)) return;
    const c = this.ctx, t = c.currentTime, dur = 0.34 + Math.random() * 0.3;
    const src = c.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    const f = c.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 1500 + Math.random() * 700; f.Q.value = 2.2;
    const g = c.createGain(); g.gain.value = 0;
    const lfo = c.createOscillator(); lfo.type = "square"; lfo.frequency.value = 42 + Math.random() * 16;
    const lg = c.createGain(); lg.gain.value = 0.10;
    lfo.connect(lg); lg.connect(g.gain); lfo.start(t); lfo.stop(t + dur);
    const env = c.createGain(); env.gain.setValueAtTime(1, t);
    env.gain.setTargetAtTime(0.0001, t + dur * 0.7, 0.08);
    const pan = c.createStereoPanner ? c.createStereoPanner() : null;
    src.connect(f); f.connect(g); g.connect(env);
    if(pan){ pan.pan.value = pv || 0; env.connect(pan); pan.connect(this.master); } else env.connect(this.master);
    src.start(t); src.stop(t + dur + 0.1);
  },
  yell(){    // a crew member shouting, heard from inside a helmet
    if(!this.ok) return;
    const c = this.ctx, t = c.currentTime, dur = 0.22 + Math.random() * 0.25;
    const o = c.createOscillator(); o.type = "sawtooth";
    o.frequency.setValueAtTime(130 + Math.random() * 90, t);
    o.frequency.linearRampToValueAtTime(90 + Math.random() * 120, t + dur);
    const f = c.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 700 + Math.random() * 500; f.Q.value = 4;
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.035, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f); f.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.05);
  },
  squelch(){
    if(this.slice("radio", 0.02, 0.7, 0.45, 0, 1)) return;
    this.burst(1200, 5, 0.06, 0.05, 0, "bandpass");
  },

  /* ---- speech: race engineer and commentary box ---- */
  say(text, who, priority){
    if(!this.on) return;
    const now = performance.now() / 1000;
    const lane = who === "com" ? "lastCom2" : "lastEng2";
    const gap = who === "com" ? 5 : 7;
    if(!priority && now - (this[lane] || 0) < gap) return;
    this[lane] = now;
    this.banner(text, who);
    try{ this.squelch(); }catch(e){}
  },
  banner(text, who){
    const n = document.getElementById("h-radio");
    if(!n) return;
    n.classList.toggle("com", who === "com");
    document.getElementById("h-radio-who").textContent = who === "com" ? "Commentary" : "Race engineer";
    document.getElementById("h-radio-txt").textContent = text;
    n.hidden = false; n.style.opacity = "1";
    clearTimeout(this._bt);
    this._bt = setTimeout(() => { n.style.opacity = "0";
      this._bt2 = setTimeout(() => { n.hidden = true; }, 300); }, 4200);
  },
  silence(){
    try{
      const n = document.getElementById("h-radio"); if(n) n.hidden = true;
    }catch(e){}
  },

  /* ---- events from the simulation ---- */
  event(kind, car, S, extra){
    if(!this.ok || !this.on || !S || !car) return;
    const isMe = S.player === car, last = car.drv ? car.drv.last : "";
    const pick = arr => arr[(Math.random() * arr.length) | 0];
    if(kind === "fail"){
      if(isMe) this.say("We're seeing damage. " + extra + ". Box when you can.", "eng", true);
      else this.say(pick(["Trouble for " + last + "! That looks like " + extra.toLowerCase() + ".",
                          "Oh, " + last + " is in trouble — " + extra.toLowerCase() + " damage there.",
                          "Big problem for " + last + ", that's the " + extra.toLowerCase() + " gone."]), "com", true);
    } else if(kind === "out"){
      if(isMe) this.say("That's the end of our race. Sorry about that.", "eng", true);
      else this.say(pick(["And that is the end of " + last + "'s race!",
                          last + " is out! What a blow for them.",
                          "It's all over for " + last + "."]), "com", true);
      this.burst(140, 1.2, 0.8, 0.16, 0, "lowpass");
    } else if(kind === "moment"){
      if(isMe) return;
      this.say(pick([last + " has a huge moment there!",
                     "Lock up for " + last + "!",
                     last + " runs wide — that will cost him.",
                     "Ooh, " + last + " nearly lost that one!"]), "com");
    } else if(kind === "pitstop"){
      if(isMe) return;
      this.say(pick([last + " peels into the pit lane.",
                     "And " + last + " is coming in for service.",
                     last + " takes the pit entry — interesting strategy call."]), "com");
    } else if(kind === "pass"){
      this.say(pick(["Great move! " + last + " takes the place.",
                     last + " is through — that was brave.",
                     "Wheel to wheel, and " + last + " makes it stick!"]), "com");
    } else if(kind === "stop"){
      this.gunT = 0; this.yellT = 0;
    } else if(kind === "away"){
      if(isMe) this.say("Away you go. " + extra, "eng", true);
    }
  },

  /* ---- the engineer's own running commentary ---- */
  engineer(S, dt){
    const p = S.player, now = performance.now() / 1000;
    if(S.state === "lights" && !this.saidStart){ this.saidStart = true;
      this.say("Radio check. Lights out shortly — let's have a clean start.", "eng", true); return; }
    if(S.mode !== "race") return;
    if(!this.saidBox && S.mustPit && p.stops === 0 && p.lap >= Math.max(2, Math.floor(S.laps * 0.42))){
      this.saidBox = true;
      this.say("Box this lap, box box. Pit entry is on the " + (S.track.pitSide < 0 ? "right" : "left") + ".", "eng", true);
      return;
    }
    if(!this.saidTyre && p.life < 0.3){
      this.saidTyre = true;
      this.say("Tyres are going away now. Start thinking about a stop.", "eng", true);
      return;
    }
    if(p.damage > 0.45 && !this.saidDmg){ this.saidDmg = true;
      this.say("The car has taken a knock. Keep an eye on it.", "eng", true); return; }
    if(now - this.lastGap > 15){
      this.lastGap = now;
      const lines = [];
      if(p.pos === 1) lines.push("You're leading. Gap behind is " + ((p.gapBehind || 1500) / 1000).toFixed(1) + ".");
      else if(p.gapAhead != null) lines.push("Gap to the car ahead, " + (p.gapAhead / 1000).toFixed(1) + ".");
      if(p.life < 0.55) lines.push("Tyres at " + Math.round(p.life * 100) + " per cent.");
      if(p.batt > 0.8) lines.push("Full battery — use the override on the straight.");
      if(S.wet > 0.3 && p.tyre.key !== "wet") lines.push("It's raining and you're on slicks. Be careful out there.");
      if(p.best) lines.push("Last lap was " + fmtTime(p.last) + ". Keep it up.");
      if(lines.length) this.say(lines[(Math.random() * lines.length) | 0], "eng");
    }
    if(this.lastPos && p.pos < this.lastPos) this.say("P" + p.pos + " now. Well done.", "eng", true);
    else if(this.lastPos && p.pos > this.lastPos) this.say("We've lost a place, P" + p.pos + ". Head down.", "eng");
    this.lastPos = p.pos;
  },

  /* ---- per-frame mix: crew, crowd and radio only ---- */
  frame(S, dt){
    if(!this.ok || !this.on || !S || !S.player) return;
    const p = S.player;
    if(p.dnf || S.state === "done"){ this.silence(); return; }
    // ---- pit crew ----
    /* The guns go when the stop says they do (car/pitstop.js): each corner's nut off, then on again,
       panned to its side of the car (corners 0 and 2 are the right-hand wheels). */
    const st = p.pp && p.pp.phase === "stopped" ? p.pp.st : null;
    if(st && !st.noWork){
      const t0 = this.stopT0 == null || this.stopRef !== st ? st.t : this.stopT0;
      for(let q = 0; q < 4; q++){
        const k = st.corners[q], pan = (q % 2 === 0 ? 0.7 : -0.7);
        if(t0 < k.off && st.t >= k.off) this.gun(pan);
        if(t0 < k.on && st.t >= k.on) this.gun(pan);
      }
      this.stopT0 = st.t; this.stopRef = st;
      this.yellT -= dt;
      if(this.yellT <= 0 && st.t > 0.5){ this.yellT = 0.6 + Math.random() * 1.2; this.yell(); }
    } else { this.stopT0 = null; this.stopRef = null; }

    this.engineer(S, dt);
  },
  reset(){ this.saidBox = false; this.saidTyre = false; this.saidStart = false; this.saidDmg = false;
    this.lastPos = 0; this.lastGap = 0; this.lastEng2 = 0; this.lastCom2 = 0; },
  toggle(){
    this.on = !this.on;
    if(this.master) this.master.gain.value = this.on ? 0.5 : 0;
    showToast(this.on ? "Sound on" : "Sound muted");
  },
};
addEventListener("pointerdown", () => { AUDIO.init(); AUDIO.resume(); }, { passive:true });
addEventListener("keydown", () => { AUDIO.init(); AUDIO.resume(); });

export { AUDIO };
