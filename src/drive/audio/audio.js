// Audio mixer: player engine (cockpit-filtered when inside), tyres, road, wind,
// gear whine, impacts, kerb thumps, rain, and spatialised AI engines.
import { engineConfig } from './engines.js';
import { speak, PHRASES } from './speech.js';
/** a parameter ramp that skips a non-finite value: one bad number must not stop the sound, or the game */
const _ramp = (p, v, t, tc) => { if (Number.isFinite(v)) p.setTargetAtTime(v, t, tc); };

function noiseBuffer(ctx, secs, brown) {
  const n = Math.floor(ctx.sampleRate * secs);
  const b = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = b.getChannelData(0);
  let last = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.random() * 2 - 1;
    if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
  }
  return b;
}

export class Audio {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.volume = 0.8;
  }

  // one initialisation shared by every caller: a second start() while the worklet module is still
  // loading must wait for it, not run ahead and fail to construct the engine node
  init() { return this._initP || (this._initP = this._init()); }

  async _init() {
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    // Resume synchronously from the Play click. Safari can reject playback if
    // we wait for addModule() before using the gesture to unlock Web Audio.
    const unlock = this.ctx.resume().catch(() => {});
    this.engineWorklet = !!(this.ctx.audioWorklet && typeof AudioWorkletNode !== 'undefined') && !/[?&]noworklet/.test(location.search);   // ?noworklet: test the main-thread path
    if (this.engineWorklet) {
      try {
        await this.ctx.audioWorklet.addModule(new URL('./engine-worklet.js', import.meta.url));
      } catch (e) {
        // AudioWorklet is secure-context-only; run.sh is often opened over LAN HTTP.
        this.engineWorklet = false;
      }
    }
    if (!this.engineWorklet) {
      const m = await import('./engine-worklet.js');
      m.setSampleRate(this.ctx.sampleRate);
      this._EngineCore = m.EngineCore;
    }
    const c = this.ctx;
    this.master = c.createGain();
    this.master.gain.value = this.volume;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = 0.005; comp.release.value = 0.2;
    this.hearing = c.createBiquadFilter(); this.hearing.type = 'lowpass'; this.hearing.frequency.value = 20000;
    this.master.connect(this.hearing).connect(comp).connect(c.destination);
    this.analyser = c.createAnalyser();
    this.analyser.fftSize = 2048;
    comp.connect(this.analyser);
    this.white = noiseBuffer(c, 3, false);
    this.brown = noiseBuffer(c, 3, true);
    this.ready = true;
    await unlock;
  }

  _loop(buf) {
    const s = this.ctx.createBufferSource();
    s.buffer = buf; s.loop = true;
    s.loopStart = Math.random() * 2;
    s.start(0, Math.random() * 2);
    return s;
  }

  async start(entrants) {
    await this.init();
    if (this.ctx.state !== 'running') await this.ctx.resume();
    const pe = entrants.find((e) => e.isPlayer);
    // the same player and the same vehicles: keep the running graph (a rebuild restarts every loop
    // and leaves a gap, e.g. each time the player leaves a building)
    const same = this.nodes && this.player === pe && this._spec === pe.car.spec && this._sig && this._sig.length === entrants.length && entrants.every((e, i) => e === this._sig[i]);
    if (same) return;
    this._sig = entrants.slice(); this._spec = pe.car.spec;
    this.stop();
    const c = this.ctx;
    this.nodes = [];
    // player chain: engine -> cabin filter -> gain
    const mkEngine = (spec, key) => {
      if (this.engineWorklet) return new AudioWorkletNode(c, 'vr-engine', {
        numberOfInputs: 0, outputChannelCount: [2], processorOptions: { cfg: engineConfig(key, spec) },
      });
      // Insecure LAN origins don't expose AudioWorklet: run the very same engine model on the main
      // thread through a ScriptProcessorNode. 4096 frames (~85 ms at 48 kHz): a 1024-frame buffer ran dry
      // whenever the main thread stalled for a few tens of ms (street streaming, shader builds), and the
      // engine dropped out until the next buffer. The longer buffer rides out those stalls.
      const core = new this._EngineCore({ cfg: engineConfig(key, spec) });
      const sp = c.createScriptProcessor(4096, 1, 2);
      sp.onaudioprocess = (ev) => core.render(ev.outputBuffer.getChannelData(0), ev.outputBuffer.getChannelData(1));
      // a ScriptProcessor only runs while connected to the destination graph; the engine chain connects it
      return {
        connect: (d) => sp.connect(d),
        disconnect: () => { sp.onaudioprocess = null; sp.disconnect(); },
        stop: () => { sp.onaudioprocess = null; },
        port: { postMessage: (d) => core.message(d) },
      };
    };
    const pkey = Object.entries(this.carKeys || {}).find(([, s]) => s === pe.car.spec)?.[0];
    this.carBus = c.createGain(); this.carBus.gain.value = 1; this.carBus.connect(this.master);
    this.eng = mkEngine(pe.car.spec, pkey);
    this.cabin = c.createBiquadFilter(); this.cabin.type = 'lowpass'; this.cabin.frequency.value = 18000; this.cabin.Q.value = 0.5;
    this.engGain = c.createGain(); this.engGain.gain.value = 0.85;
    // cabin: the shell boom (a broad resonance near 95 Hz) and a shelf that closes the top end
    this.cabinBoom = c.createBiquadFilter(); this.cabinBoom.type = 'peaking'; this.cabinBoom.frequency.value = 95; this.cabinBoom.Q.value = 0.9; this.cabinBoom.gain.value = 0;
    this.cabinShelf = c.createBiquadFilter(); this.cabinShelf.type = 'highshelf'; this.cabinShelf.frequency.value = 1800; this.cabinShelf.gain.value = 0;
    this.eng.connect(this.cabinBoom).connect(this.cabinShelf).connect(this.cabin).connect(this.engGain).connect(this.carBus);
    // tyres: two bands of noise
    this.tyreSrc = this._loop(this.white);
    this.tyreBP = c.createBiquadFilter(); this.tyreBP.type = 'bandpass'; this.tyreBP.frequency.value = 750; this.tyreBP.Q.value = 6;
    this.tyreBP2 = c.createBiquadFilter(); this.tyreBP2.type = 'bandpass'; this.tyreBP2.frequency.value = 1450; this.tyreBP2.Q.value = 9;
    this.tyreGain = c.createGain(); this.tyreGain.gain.value = 0;
    this.tyreSrc.connect(this.tyreBP).connect(this.tyreGain);
    this.tyreSrc.connect(this.tyreBP2).connect(this.tyreGain);
    this.tyreGain.connect(this.carBus);
    // road roar
    this.roadSrc = this._loop(this.brown);
    this.roadLP = c.createBiquadFilter(); this.roadLP.type = 'lowpass'; this.roadLP.frequency.value = 300;
    this.roadAM = c.createGain(); this.roadAM.gain.value = 1;
    this.roadGain = c.createGain(); this.roadGain.gain.value = 0;
    this.roadSrc.connect(this.roadLP).connect(this.roadAM).connect(this.roadGain).connect(this.carBus);
    // wind
    this.windSrc = this._loop(this.white);
    this.windBP = c.createBiquadFilter(); this.windBP.type = 'bandpass'; this.windBP.frequency.value = 600; this.windBP.Q.value = 0.6;
    this.windGain = c.createGain(); this.windGain.gain.value = 0;
    this.windSrc.connect(this.windBP).connect(this.windGain).connect(this.carBus);
    // gearbox whine
    this.whine = c.createOscillator(); this.whine.type = 'triangle'; this.whine.frequency.value = 400;
    this.whineGain = c.createGain(); this.whineGain.gain.value = 0;
    this.whine.connect(this.whineGain).connect(this.carBus);
    this.whine.start();
    this.whine2 = c.createOscillator(); this.whine2.type = 'sine'; this.whine2.frequency.value = 800;
    this.whine2.connect(this.whineGain);
    this.whine2.start();
    // rain on the roof / road
    this.rainSrc = this._loop(this.white);
    this.rainHP = c.createBiquadFilter(); this.rainHP.type = 'highpass'; this.rainHP.frequency.value = 1800;
    this.rainGain = c.createGain(); this.rainGain.gain.value = 0;
    this.rainSrc.connect(this.rainHP).connect(this.rainGain).connect(this.master);
    // bicycle: chain ticks at the pedal rate (a square LFO gates the chain noise), quiet tyre hiss
    this.bikeOn = !!pe.car.spec.bicycle;
    this.chainSrc = this._loop(this.white);
    this.chainBP = c.createBiquadFilter(); this.chainBP.type = 'bandpass'; this.chainBP.frequency.value = 2600; this.chainBP.Q.value = 2.5;
    this.chainGain = c.createGain(); this.chainGain.gain.value = 0.5;
    this.chainLFO = c.createOscillator(); this.chainLFO.type = 'square'; this.chainLFO.frequency.value = 4;
    this.chainDepth = c.createGain(); this.chainDepth.gain.value = 0.5;
    this.chainLFO.connect(this.chainDepth).connect(this.chainGain.gain);
    this.chainLFO.start();
    this.chainLevel = c.createGain(); this.chainLevel.gain.value = 0;
    this.chainSrc.connect(this.chainBP).connect(this.chainGain).connect(this.chainLevel).connect(this.carBus);
    // AI engines, spatialised
    this.ai = [];
    for (const e of entrants) {
      if (e.isPlayer) continue;
      const key = Object.entries(this.carKeys || {}).find(([, s]) => s === e.car.spec)?.[0];
      const node = mkEngine(e.car.spec, key);
      const pan = new PannerNode(c, { panningModel: 'equalpower', distanceModel: 'inverse', refDistance: 6, maxDistance: 600, rolloffFactor: 1.3 });
      const g = c.createGain(); g.gain.value = 0.5;
      node.connect(g).connect(pan).connect(this.master);
      this.ai.push({ e, node, pan, g });
    }
    this._buildCity(c);
    // sirens (French two-tone, 435 / 580 Hz): up to three voices, each placed in the world on its vehicle
    // with inverse-distance falloff, Doppler and air absorption: loud beside you, a faint wail far away
    this.sirens = [];
    for (let i = 0; i < 3; i++) {
      const so = c.createOscillator(); so.type = 'sawtooth'; so.frequency.value = 435;
      const sf = c.createBiquadFilter(); sf.type = 'lowpass'; sf.frequency.value = 2400; sf.Q.value = 1.1;
      const sg = c.createGain(); sg.gain.value = 0;
      const pan = new PannerNode(c, { panningModel: 'equalpower', distanceModel: 'inverse', refDistance: 9, maxDistance: 900, rolloffFactor: 1.6 });
      so.connect(sf).connect(sg).connect(pan).connect(this.master); so.start();
      this.sirens.push({ so, sf, sg, pan });
    }
    this.nodes = [this.eng, this.tyreSrc, this.roadSrc, this.windSrc, this.whine, this.whine2, this.rainSrc, this.chainSrc, this.chainLFO, ...this.sirens.map((q) => q.so), ...this.ai.map((a) => a.node)];
    this.player = pe;
    this.lastX = pe.car.wheels.map((w) => w.x);
    this.rain = 0;
  }

  stop() {
    if (!this.nodes) return;
    for (const n of this.nodes) { try { n.stop?.(); } catch { /* already stopped */ } try { n.disconnect(); } catch { /* */ } }
    for (const a of this.ai || []) { a.pan.disconnect(); a.g.disconnect(); }
    this.nodes = null;
  }

  // RMS of the mixed output (tests / meters)
  level() {
    if (!this.analyser) return 0;
    const a = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(a);
    let s = 0; for (const v of a) s += v * v;
    return Math.sqrt(s / a.length);
  }

  // horn: two detuned tones (a car horn is a pair a third apart), held while the key is down
  horn(on, mass = 1300) {
    if (!this.ready || !this.nodes) return;
    const c = this.ctx, t = c.currentTime;
    if (on && !this._horn) {
      const base = mass > 1900 ? 340 : mass > 1500 ? 400 : 460;
      const g = c.createGain(); g.gain.value = 0;
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400;
      const bp = c.createBiquadFilter(); bp.type = 'peaking'; bp.frequency.value = 1100; bp.gain.value = 6;
      const os = [base, base * 1.26].map((f) => { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.connect(lp); o.start(); return o; });
      lp.connect(bp).connect(g).connect(this.master);
      _ramp(g.gain, 0.16, t, 0.01);
      this._horn = { g, os, lp, bp };
    } else if (!on && this._horn) {
      const h = this._horn; this._horn = null;
      _ramp(h.g.gain, 0, t, 0.03);
      setTimeout(() => { for (const o of h.os) { try { o.stop(); } catch { /* */ } } h.g.disconnect(); }, 250);
    }
  }

  // a person says something, placed in the world.  kind: a key of PHRASES; v 0..1 picks the voice
  // (man / woman / child, with its own pitch and tempo); mode overrides the phrase's intonation
  say(kind, x, y, z, v = 0.5, gain = 0.5) {
    if (!this.ready || !this.ctx) return 0;
    const list = PHRASES[kind];
    if (!list) return 0;
    const [str, mode] = list[Math.floor(Math.random() * list.length)];
    const c = this.ctx;
    const f0 = v < 0.5 ? 100 + v * 60 : v < 0.88 ? 170 + (v - 0.5) * 120 : 270 + (v - 0.88) * 250;
    const pan = new PannerNode(c, { panningModel: 'equalpower', distanceModel: 'inverse', refDistance: 3, maxDistance: 80, rolloffFactor: 1.7, positionX: x, positionY: y, positionZ: z });
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 4200;
    lp.connect(pan).connect(this.master);
    const dur = speak(c, lp, this.white, str, { f0, rate: 0.82 + v * 0.3 + (Math.random() - 0.5) * 0.12, mode, gain });
    setTimeout(() => { try { pan.disconnect(); lp.disconnect(); } catch { /* */ } }, (dur + 0.6) * 1000);
    return dur;
  }

  // another car's horn, placed in the world: a short beep, higher for small cars
  honkAt(x, y, z, mass = 1300, len = 0.3, spatial = true) {
    if (!this.ready) return;
    const c = this.ctx, t = c.currentTime;
    const base = mass > 1900 ? 330 : mass > 1500 ? 390 : 450 + Math.random() * 40;
    const pan = spatial ? new PannerNode(c, { panningModel: 'equalpower', distanceModel: 'inverse', refDistance: 8, rolloffFactor: 1.4, positionX: x, positionY: y, positionZ: z }) : c.createGain();
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2200;
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.18, t + 0.015); g.gain.setValueAtTime(0.18, t + len); g.gain.exponentialRampToValueAtTime(0.0001, t + len + 0.06);
    lp.connect(g).connect(pan).connect(this.master);
    for (const f of [base, base * 1.26]) { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.connect(lp); o.start(t); o.stop(t + len + 0.1); }
    setTimeout(() => { try { pan.disconnect(); } catch { /* */ } }, (len + 0.5) * 1000);
  }

  suspend() { this.ctx?.suspend(); }
  resume() { this.ctx?.resume(); }
  setRain(on) { this.rain = on ? 1 : 0; }

  // Under water the world goes dull and heavy.
  submerge(under) {
    if (!this.ready) return;
    this.hearing.frequency.setTargetAtTime(under ? 340 : 20000, this.ctx.currentTime, under ? .05 : .25);
  }

  // After a heavy impact: everything sounds muffled and a high tone fades slowly.
  daze(level, seconds) {
    if (!this.ready) return;
    const c = this.ctx, t = c.currentTime;
    this.hearing.frequency.cancelScheduledValues(t);
    this.hearing.frequency.setValueAtTime(Math.max(260, 1500 - level * 1250), t);
    this.hearing.frequency.exponentialRampToValueAtTime(20000, t + seconds);
    const tone = c.createOscillator(), gain = c.createGain();
    tone.frequency.value = 3700 + Math.random() * 500;
    gain.gain.setValueAtTime(0.09 * level, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
    tone.connect(gain).connect(c.destination);
    tone.start(t); tone.stop(t + seconds);
  }

  impact(j) {
    if (!this.ready || !this.nodes) return;
    // a bang with no energy (or a bad number from the physics) makes no sound
    if (!Number.isFinite(j) || j <= 0) return;
    const c = this.ctx, t = c.currentTime;
    const vol = Math.min(1, Math.log10(j / 800) * 0.6);
    if (!(vol > 0)) return;
    const src = c.createBufferSource(); src.buffer = this.white;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900 + vol * 1500;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.35 + vol * 0.3);
    src.connect(lp).connect(g).connect(this.master);
    src.start(t, Math.random()); src.stop(t + 0.8);
    const o = c.createOscillator(); o.type = 'square'; o.frequency.setValueAtTime(140 + Math.random() * 80, t);
    o.frequency.exponentialRampToValueAtTime(60, t + 0.2);
    const og = c.createGain(); og.gain.setValueAtTime(vol * 0.25, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    o.connect(og).connect(this.master); o.start(t); o.stop(t + 0.3);
  }

  thump(v) {
    if (!Number.isFinite(v) || v <= 0) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(); o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(35, t + 0.12);
    const g = c.createGain(); g.gain.setValueAtTime(Math.min(0.6, v * 0.35), t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    o.connect(g).connect(this.master); o.start(t); o.stop(t + 0.2);
  }

  // ---------------------------------------------------------------- city, people, traffic
  _buildCity(c) {
    // low urban rumble
    this.cityHum = c.createGain(); this.cityHum.gain.value = 0;
    const hs = this._loop(this.brown), hl = c.createBiquadFilter(); hl.type = 'lowpass'; hl.frequency.value = 240;
    hs.connect(hl).connect(this.cityHum).connect(this.master);
    // crowd murmur: noise through two vowel-like formants, amplitude wobbling at syllable rate
    this.murmur = c.createGain(); this.murmur.gain.value = 0;
    const ms = this._loop(this.white);
    const f1 = c.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.value = 520; f1.Q.value = 2.2;
    const f2 = c.createBiquadFilter(); f2.type = 'bandpass'; f2.frequency.value = 1500; f2.Q.value = 2.8;
    const wob = c.createGain(); wob.gain.value = 0.55;
    const lfo = c.createOscillator(); lfo.frequency.value = 3.7; const lg = c.createGain(); lg.gain.value = 0.4;
    lfo.connect(lg).connect(wob.gain); lfo.start();
    const lfo2 = c.createOscillator(); lfo2.frequency.value = 0.31; const lg2 = c.createGain(); lg2.gain.value = 120;
    lfo2.connect(lg2); lg2.connect(f1.frequency); lfo2.start();
    ms.connect(f1).connect(wob); ms.connect(f2).connect(wob);
    wob.connect(this.murmur).connect(this.master);
    // traffic: a pool of cheap engine voices placed on the nearest cars
    this.tv = [];
    for (let i = 0; i < 6; i++) {
      const o1 = c.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 40;
      const o2 = c.createOscillator(); o2.type = 'square'; o2.frequency.value = 40.7;
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420; lp.Q.value = 0.7;
      const og = c.createGain(); og.gain.value = 0.5;
      o1.connect(lp); o2.connect(og).connect(lp);
      const nz = c.createBufferSource(); nz.buffer = this.brown; nz.loop = true; nz.start(0, Math.random() * 2);
      const nb = c.createBiquadFilter(); nb.type = 'bandpass'; nb.frequency.value = 700; nb.Q.value = 0.8;
      const ng = c.createGain(); ng.gain.value = 0;
      nz.connect(nb).connect(ng);
      const g = c.createGain(); g.gain.value = 0;
      lp.connect(g); ng.connect(g);
      const pan = new PannerNode(c, { panningModel: 'equalpower', distanceModel: 'inverse', refDistance: 7, maxDistance: 400, rolloffFactor: 1.5 });
      g.connect(pan).connect(this.master);
      o1.start(); o2.start();
      this.tv.push({ o1, o2, lp, g, ng, nb, pan, car: null });
    }
    this._bird = 3; this._bark = 6; this._step = 0;
  }

  _chirp(x, y, z) {
    const c = this.ctx, t0 = c.currentTime;
    const pan = new PannerNode(c, { panningModel: 'equalpower', distanceModel: 'inverse', refDistance: 5, rolloffFactor: 1, positionX: x, positionY: y, positionZ: z });
    const g = c.createGain(); g.gain.value = 0.0001; pan.connect(this.master); g.connect(pan);
    const n = 2 + Math.floor(Math.random() * 4), f0 = 2300 + Math.random() * 1800, gap = 0.09 + Math.random() * 0.08;
    const o = c.createOscillator(); o.type = 'sine'; o.connect(g);
    for (let i = 0; i < n; i++) {
      const t = t0 + i * gap;
      o.frequency.setValueAtTime(f0 * (1 + 0.12 * Math.random()), t);
      o.frequency.exponentialRampToValueAtTime(f0 * (1.35 + 0.2 * Math.random()), t + gap * 0.7);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + gap * 0.85);
    }
    o.start(t0); o.stop(t0 + n * gap + 0.1);
    setTimeout(() => { try { pan.disconnect(); } catch { /* */ } }, (n * gap + 0.4) * 1000);
  }

  bark(x, y, z) {
    if (!this.ready) return;
    const c = this.ctx, t = c.currentTime;
    const pan = new PannerNode(c, { panningModel: 'equalpower', distanceModel: 'inverse', refDistance: 4, rolloffFactor: 1.2, positionX: x, positionY: y, positionZ: z });
    pan.connect(this.master);
    const k = 1 + Math.floor(Math.random() * 3), f = 420 + Math.random() * 380;
    for (let i = 0; i < k; i++) {
      const t0 = t + i * 0.27;
      const s = c.createBufferSource(); s.buffer = this.white;
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 3.5;
      bp.frequency.setValueAtTime(f * 1.5, t0); bp.frequency.exponentialRampToValueAtTime(f * 0.8, t0 + 0.14);
      const g = c.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.5, t0 + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.16);
      s.connect(bp).connect(g).connect(pan); s.start(t0, Math.random()); s.stop(t0 + 0.2);
    }
    setTimeout(() => { try { pan.disconnect(); } catch { /* */ } }, 1500);
  }

  // one footfall: a short noise tick on hard ground, a duller scuff on grass; `v` loudness 0..1
  footstep(v, soft) {
    if (!this.ready) return;
    const c = this.ctx, t = c.currentTime;
    const s = c.createBufferSource(); s.buffer = soft ? this.brown : this.white;
    const f = c.createBiquadFilter();
    if (soft) { f.type = 'lowpass'; f.frequency.value = 700; } else { f.type = 'bandpass'; f.frequency.value = 1400 + Math.random() * 500; f.Q.value = 0.9; }
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.min(0.5, 0.1 + 0.3 * v), t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + (soft ? 0.12 : 0.08));
    s.connect(f).connect(g).connect(this.master); s.start(t, Math.random() * 2); s.stop(t + 0.15);
    const th = c.createOscillator(); th.frequency.setValueAtTime(95, t); th.frequency.exponentialRampToValueAtTime(48, t + 0.06);
    const tg = c.createGain(); tg.gain.setValueAtTime(0.06 + 0.1 * v, t); tg.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    th.connect(tg).connect(this.master); th.start(t); th.stop(t + 0.09);
  }

  // car door: a dull thud with a latch click when it shuts
  door(closing) {
    if (!this.ready) return;
    const c = this.ctx, t = c.currentTime;
    const s = c.createBufferSource(); s.buffer = this.brown;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = closing ? 900 : 600;
    const g = c.createGain(); g.gain.setValueAtTime(closing ? 0.9 : 0.35, t); g.gain.exponentialRampToValueAtTime(0.001, t + (closing ? 0.22 : 0.12));
    s.connect(lp).connect(g).connect(this.master); s.start(t, Math.random()); s.stop(t + 0.3);
    const o = c.createOscillator(); o.frequency.setValueAtTime(closing ? 110 : 150, t); o.frequency.exponentialRampToValueAtTime(55, t + 0.12);
    const og = c.createGain(); og.gain.setValueAtTime(closing ? 0.4 : 0.15, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    o.connect(og).connect(this.master); o.start(t); o.stop(t + 0.2);
    if (closing) {
      const k = c.createBufferSource(); k.buffer = this.white;
      const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2800;
      const kg = c.createGain(); kg.gain.setValueAtTime(0.0001, t + 0.05); kg.gain.exponentialRampToValueAtTime(0.18, t + 0.055); kg.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
      k.connect(hp).connect(kg).connect(this.master); k.start(t + 0.05, Math.random()); k.stop(t + 0.12);
    }
  }

  /** water: a toilet flush (rush, then the cistern refilling) or a shower running for `dur` seconds */
  water(kind = 'flush', dur = 4) {
    if (!this.ready) return;
    const c = this.ctx, t = c.currentTime;
    const s = c.createBufferSource(); s.buffer = this.white; s.loop = true;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.7;
    const g = c.createGain(); g.gain.value = 0.0001;
    if (kind === 'flush') {
      bp.frequency.setValueAtTime(900, t); bp.frequency.exponentialRampToValueAtTime(380, t + 1.4); bp.frequency.linearRampToValueAtTime(1400, t + 4.5);
      g.gain.exponentialRampToValueAtTime(0.5, t + 0.15); g.gain.exponentialRampToValueAtTime(0.16, t + 1.6); g.gain.linearRampToValueAtTime(0.08, t + 4); g.gain.exponentialRampToValueAtTime(0.0001, t + 5.5);
      dur = 5.6;
      // the gurgle at the end of the rush
      const o = c.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(180, t + 1.0); o.frequency.exponentialRampToValueAtTime(70, t + 1.8);
      const og = c.createGain(); og.gain.setValueAtTime(0.0001, t + 1.0); og.gain.exponentialRampToValueAtTime(0.12, t + 1.1); og.gain.exponentialRampToValueAtTime(0.0001, t + 1.9);
      o.connect(og).connect(this.master); o.start(t + 1.0); o.stop(t + 2.0);
    } else {
      bp.frequency.value = 2600; bp.Q.value = 0.4;
      g.gain.exponentialRampToValueAtTime(0.22, t + 0.4); g.gain.setValueAtTime(0.22, t + dur - 0.5); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    }
    s.connect(bp).connect(g).connect(this.master); s.start(t, Math.random()); s.stop(t + dur + 0.1);
  }

  click() {   // seat belt buckle, indicator-like tick
    if (!this.ready) return;
    const c = this.ctx, t = c.currentTime;
    const s = c.createBufferSource(); s.buffer = this.white;
    const hp = c.createBiquadFilter(); hp.type = 'bandpass'; hp.frequency.value = 3200; hp.Q.value = 2;
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.2, t + 0.003); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.035);
    s.connect(hp).connect(g).connect(this.master); s.start(t, Math.random()); s.stop(t + 0.06);
  }

  /**
   * ambience and traffic, once per frame.  info: { dens 0..1, peds (people within ~25 m), cars [{x,y,z,v,yaw,big}],
   * dogs [{x,y,z}], night 0..1, rain, foot: {v, soft, stepped} }
   */
  ambient(dt, info, camera) {
    if (!this.ready || !this.tv) return;
    const c = this.ctx, t = c.currentTime;
    const dens = info.dens;
    _ramp(this.cityHum.gain, (0.015 + 0.09 * dens) * (1 - 0.3 * info.night), t, 0.6);
    _ramp(this.murmur.gain, Math.min(1, info.peds / 10) * (0.55 + 0.45 * dens) * 0.055 * (1 - 0.7 * info.night), t, 0.5);
    if (info.party > .04 && t >= (this.nextPartyBeat ?? 0)) {
      const beat=this.partyBeatIndex ?? 0;
      this.partyBeatIndex=(beat+1)%8;
      this.nextPartyBeat=t+.29;
      const pulse=c.createOscillator(), envelope=c.createGain();
      pulse.type=beat%2?'triangle':'sine';
      pulse.frequency.setValueAtTime(beat%2?[196,247,294,220][beat>>1]:96,t);
      if(beat%2===0) pulse.frequency.exponentialRampToValueAtTime(48,t+.11);
      envelope.gain.setValueAtTime(.001,t);
      envelope.gain.linearRampToValueAtTime(info.party*(beat%2?.019:.064),t+.012);
      envelope.gain.exponentialRampToValueAtTime(.001,t+.17);
      pulse.connect(envelope).connect(this.master);
      pulse.start(t);
      pulse.stop(t+.18);
      pulse.onended=()=>envelope.disconnect();
    }
    // birds: more of them away from the centre, by day, not in the rain
    this._bird -= dt;
    if (this._bird <= 0) {
      this._bird = (3 + Math.random() * 9) * (0.5 + dens) * (info.rain ? 4 : 1);
      if (info.night < 0.6 && !info.rain && dens < 0.9) {
        const a = Math.random() * 6.28, d = 8 + Math.random() * 30;
        this._chirp(camera.position.x + Math.cos(a) * d, camera.position.y + 3 + Math.random() * 8, camera.position.z + Math.sin(a) * d);
      }
    }
    this._bark -= dt;
    if (this._bark <= 0) {
      this._bark = 5 + Math.random() * 10;
      const d = info.dogs.find((q) => Math.hypot(q.x - camera.position.x, q.z - camera.position.z) < 28);
      if (d) this.bark(d.x, d.y, d.z);
    }
    // traffic voices: the nearest moving cars
    const cars = info.cars;
    for (let i = 0; i < this.tv.length; i++) {
      const v = this.tv[i], car = cars[i];
      if (!car) { _ramp(v.g.gain, 0, t, 0.1); continue; }
      const sp = Math.max(0.3, car.v);
      // pseudo gearbox: rpm climbs with speed and drops at each upshift
      const gear = Math.min(5, 1 + Math.floor(sp / 7));
      const rpm = 850 + (sp - (gear - 1) * 7) * (gear === 1 ? 260 : 190) + gear * 120;
      const dx = car.x - camera.position.x, dz = car.z - camera.position.z, d = Math.hypot(dx, dz) || 1;
      const vr = (car.vx * dx + car.vz * dz) / d;
      const dop = 343 / (343 + vr);
      const f = (car.big ? 0.65 : 1) * rpm / 30 * dop;     // 2nd order of a four: rpm / 30 Hz
      _ramp(v.o1.frequency, f, t, 0.05); _ramp(v.o2.frequency, f * 1.007, t, 0.05);
      _ramp(v.lp.frequency, 260 + sp * 22 + (car.big ? 0 : 120), t, 0.1);
      _ramp(v.g.gain, 0.045 * (car.big ? 1.6 : 1) * (0.5 + Math.min(1, sp / 12)), t, 0.1);
      _ramp(v.ng.gain, Math.min(1, sp / 25) * 0.25, t, 0.15);
      _ramp(v.nb.frequency, 500 + sp * 25, t, 0.2);
      _ramp(v.pan.positionX, car.x, t, 0.05); _ramp(v.pan.positionY, car.y, t, 0.05); _ramp(v.pan.positionZ, car.z, t, 0.05);
    }
  }

  // list: [{ x, y, z, vx, vz, id }] nearest emergency vehicles with their lights on (at most three are heard)
  setSirens(list, camera) {
    if (!this.sirens || !this.ctx) return;
    const t = this.ctx.currentTime;
    this.sirens.forEach((v, i) => {
      const s = list[i];
      if (!s) { _ramp(v.sg.gain, 0, t, 0.15); return; }
      const dx = s.x - camera.position.x, dz = s.z - camera.position.z, d = Math.hypot(dx, dz) || 1;
      const vr = (s.vx * dx + s.vz * dz) / d;               // > 0 receding
      const dop = 343 / (343 + vr);
      // the two tones alternate every 0.55 s; each vehicle has its own phase
      const hi = Math.floor((t + (s.id % 7) * 0.13) / 0.55) % 2;
      _ramp(v.so.frequency, (hi ? 580 : 435) * dop, t, 0.025);
      _ramp(v.sf.frequency, 500 + 2600 / (1 + d / 70), t, 0.1);    // air absorbs the highs with distance
      _ramp(v.pan.positionX, s.x, t, 0.05); _ramp(v.pan.positionY, s.y, t, 0.05); _ramp(v.pan.positionZ, s.z, t, 0.05);
      _ramp(v.sg.gain, 0.22 * (s.k ?? 1), t, 0.1);
    });
  }

  /** a parameter ramp that skips a non-finite value: one bad number must not stop the audio (or the game) */
  _set(param, value, t, tc) {
    if (Number.isFinite(value)) _ramp(param, value, t, tc);
  }

  update(dt, entrants, camera, camMode) {
    if (!this.ready || !this.nodes) return;
    const c = this.ctx, t = c.currentTime;
    const car = this.player.car;
    const inside = camMode === 'cockpit' || camMode === 'hood' || camMode === 'bumper';
    const speed = car.speed;
    const load = car.revCut ? 0 : Math.max(0, Math.min(1, car.input.throttle * (1 - car.tc * 0.8))) * (car.clutchEng > 0.1 ? 1 : 0.4);
    this.eng.port.postMessage({ rpm: car.rpm, load, boost: car.spec.engine.na ? 0 : car.boost, gain: inside ? 0.75 : 0.6 });
    // the car you are not in: its engine is off, and what it makes dies away with distance
    const away = camMode === 'foot';
    const cam = camera.position;
    const dcar = Math.hypot(cam.x - car.p[0], cam.z - car.p[2]);
    const att = inside ? 1 : dcar < 9 ? 1 : 1 / (1 + Math.pow((dcar - 9) / 10, 1.2));
    _ramp(this.carBus.gain, att, t, 0.12);
    _ramp(this.engGain.gain, away || car.drowned ? 0 : 0.85, t, away ? 0.18 : 0.4);
    _ramp(this.cabin.frequency, inside ? 3400 : 16000, t, 0.1);
    _ramp(this.cabinBoom.gain, inside ? 5 : 0, t, 0.1);
    _ramp(this.cabinShelf.gain, inside ? -9 : 0, t, 0.1);
    // tyres: squeal from combined slip beyond the peak, scrub at low speed suppressed
    let skid = 0, surfRough = 0, onTarmac = 0;
    for (const w of car.wheels) {
      if (!w.grounded) continue;
      const tarmac = w.surf === 7 || w.surf === 4 || w.surf === 6 || w.surf === 8 ? 1 : 0;
      onTarmac += tarmac / 4;
      skid += w.skid * tarmac * Math.min(1, Math.abs(w.Fz) / 3000);
      surfRough += w.rough / 4;
    }
    const sq = Math.min(1, skid * 0.9) * Math.min(1, speed / 4);
    _ramp(this.tyreGain.gain, sq * 0.33, t, 0.04);
    _ramp(this.tyreBP.frequency, 650 + 260 * Math.min(1, skid), t, 0.05);
    // road roar: speed and surface (gravel/grass crunch is louder and brighter)
    const off = 1 - onTarmac;
    _ramp(this.roadGain.gain, Math.min(0.5, speed / 45) * (0.25 + 0.75 * surfRough + 0.5 * off) * (inside ? 1.2 : 0.8), t, 0.1);
    _ramp(this.roadLP.frequency, 220 + speed * 9 + off * 1500, t, 0.1);
    // wind
    _ramp(this.windGain.gain, Math.min(0.35, speed * speed / 7000) * (inside ? 0.5 : 1), t, 0.2);
    _ramp(this.windBP.frequency, 400 + speed * 18, t, 0.2);
    // gear whine follows the driveline speed
    const wd = Math.abs(car.wheels[0].omega + car.wheels[1].omega) / 2;
    const wf = Math.max(60, Math.abs(wd * car.gearRatio()) * 4.2);
    _ramp(this.whine.frequency, wf, t, 0.03);
    _ramp(this.whine2.frequency, wf * 2.01, t, 0.03);
    _ramp(this.whineGain.gain, car.input.throttle * Math.min(1, speed / 20) * 0.012 * (inside ? 1.5 : 0.6), t, 0.05);
    // rain
    _ramp(this.rainGain.gain, this.rain * (inside ? 0.18 : 0.1), t, 0.5);
    // kerb thumps: sudden suspension compression
    car.wheels.forEach((w, i) => {
      const dx = (w.x - this.lastX[i]) / Math.max(dt, 1e-3);
      if (dx > 0.9 && w.grounded) this.thump(Math.min(1.5, dx / 2));
      this.lastX[i] = w.x;
    });
    // bicycle: the car engine and gearbox are silent; the chain ticks at the pedal rate and the tyres hiss
    if (car.spec.bicycle) {
      const rev = speed / (2 * Math.PI * car.spec.wheel.radius);     // wheel revolutions per second
      const pedal = Math.max(0, Math.min(3, rev * 0.5));              // pedal revolutions per second (a gear of about 2)
      _ramp(this.chainLFO.frequency, Math.max(0.5, pedal * 4), t, 0.05);      // four chain links per pedal turn
      const pedalling = car.input.throttle > 0.05;
      _ramp(this.chainLevel.gain, speed > 0.3 ? (pedalling ? 0.22 : 0.07) * Math.min(1, speed / 2) : 0, t, 0.08);
      _ramp(this.tyreGain.gain, Math.min(0.2, speed / 30) * 0.5, t, 0.1);
      _ramp(this.tyreBP.frequency, 1200 + speed * 30, t, 0.1);
      _ramp(this.engGain.gain, 0, t, 0.1);
      _ramp(this.whineGain.gain, 0, t, 0.05);
    }
    // listener + AI engines (with Doppler applied to the rpm we send)
    const L = c.listener;
    const fw = camera.getWorldDirection ? camera.getWorldDirection(this._v || (this._v = camera.position.clone())) : null;
    if (L.positionX) {
      _ramp(L.positionX, camera.position.x, t, 0.02); _ramp(L.positionY, camera.position.y, t, 0.02); _ramp(L.positionZ, camera.position.z, t, 0.02);
      if (fw) { _ramp(L.forwardX, fw.x, t, 0.02); _ramp(L.forwardY, fw.y, t, 0.02); _ramp(L.forwardZ, fw.z, t, 0.02); }
    }
    for (const a of this.ai) {
      const ac = a.e.car;
      _ramp(a.pan.positionX, ac.p[0], t, 0.03); _ramp(a.pan.positionY, ac.p[1], t, 0.03); _ramp(a.pan.positionZ, ac.p[2], t, 0.03);
      const dx = ac.p[0] - car.p[0], dz = ac.p[2] - car.p[2];
      const d = Math.hypot(dx, dz) || 1;
      const vr = ((ac.v[0] - car.v[0]) * dx + (ac.v[2] - car.v[2]) * dz) / d; // + = receding
      const dop = 343 / (343 + vr);
      const aload = Math.max(0, ac.input.throttle);
      a.node.port.postMessage({ rpm: ac.rpm * dop, load: aload, boost: ac.spec.engine.na ? 0 : ac.boost, gain: 0.55 });
    }
  }
}
