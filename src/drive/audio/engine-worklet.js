// Engine sound synthesis, sample by sample, from the crank angle up.
//
//  crank angle -> per-cylinder exhaust pressure curve (blowdown spike, then the
//  piston pumping the rest out, then valve overlap suction)
//    -> exhaust waveguide: header delay, a pipe with a reflecting source end and
//       an open radiating end (lowpassed, inverting), muffler damping
//  crank angle -> intake pulses -> a second, shorter waveguide (induction growl)
//  firing impulses -> block / valvetrain resonators (mechanical clatter)
//  + turbo whistle with flutter, blow-off, overrun pops fed *into the pipe*
//
// Everything that depends on rpm does so through crank *angle*, so pulse width,
// pipe resonance sweep and harmonic structure change the way a real engine's do
// instead of a fixed-shape pulse being replayed faster.

// Runs in two places: as the 'vr-engine' AudioWorkletProcessor (secure origins), and on the main
// thread through a ScriptProcessorNode (plain-HTTP LAN origins have no AudioWorklet).  Same DSP.
let SR = typeof sampleRate !== 'undefined' ? sampleRate : 48000;
export const setSampleRate = (r) => { SR = r; };
const C_EXH = 520;   // m/s, hot exhaust gas
const C_INT = 343;

class Delay {
  constructor(n) { this.b = new Float32Array(n); this.n = n; this.w = 0; }
  write(x) { this.b[this.w] = x; this.w = this.w + 1 === this.n ? 0 : this.w + 1; }
  read(d) {
    let r = this.w - d;
    while (r < 0) r += this.n;
    const i = Math.floor(r), f = r - i, j = i + 1 === this.n ? 0 : i + 1;
    const a = this.b[i === this.n ? 0 : i];
    return a + (this.b[j] - a) * f;
  }
}

class Biquad {
  constructor() { this.b0 = 1; this.b1 = 0; this.b2 = 0; this.a1 = 0; this.a2 = 0; this.x1 = 0; this.x2 = 0; this.y1 = 0; this.y2 = 0; }
  bandpass(f, q) {
    const w = 2 * Math.PI * f / SR, al = Math.sin(w) / (2 * q), c = Math.cos(w), a0 = 1 + al;
    this.b0 = al / a0; this.b1 = 0; this.b2 = -al / a0; this.a1 = -2 * c / a0; this.a2 = (1 - al) / a0;
    return this;
  }
  lowpass(f, q = 0.7) {
    const w = 2 * Math.PI * f / SR, al = Math.sin(w) / (2 * q), c = Math.cos(w), a0 = 1 + al;
    this.b0 = (1 - c) / 2 / a0; this.b1 = (1 - c) / a0; this.b2 = this.b0; this.a1 = -2 * c / a0; this.a2 = (1 - al) / a0;
    return this;
  }
  highpass(f, q = 0.7) {
    const w = 2 * Math.PI * f / SR, al = Math.sin(w) / (2 * q), c = Math.cos(w), a0 = 1 + al;
    this.b0 = (1 + c) / 2 / a0; this.b1 = -(1 + c) / a0; this.b2 = this.b0; this.a1 = -2 * c / a0; this.a2 = (1 - al) / a0;
    return this;
  }
  run(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

// ---- exhaust pressure curve at the valve, per crank degree after firing TDC ----
// 0..130 power stroke (valve shut), EVO ~130: blowdown spike, decaying; then the
// piston sweeps the remainder out; overlap near 350..380 sucks a little back.
const CURVE = new Float32Array(720);
(() => {
  const bell = (x, c, w) => Math.exp(-(((x - c) / w) ** 2));
  for (let d = 0; d < 720; d++) {
    let p = 0;
    if (d >= 125 && d < 365) {
      const t = d - 125;
      const rise = 1 - Math.exp(-t / 5);                // 5 deg valve opening
      p = rise * (Math.exp(-t / 22) * 1.0 + 1.25 * Math.exp(-t / 6.5) + 0.2 * Math.exp(-t / 60) + 0.04);
      p *= 1 - smooth((d - 330) / 35) * 0.9;            // valve closing
    }
    p -= 0.22 * bell(d, 372, 14);                       // overlap scavenging
    p += 0.05 * bell(d, 6, 10);                         // combustion thump leaking by
    CURVE[d] = p;
  }
  function smooth(x) { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); }
})();

// intake: a smooth half-sine pulse over the 180 deg intake stroke (offset 360..540)
const INTAKE = new Float32Array(720);
for (let d = 360; d < 540; d++) INTAKE[d] = Math.sin((d - 360) / 180 * Math.PI) ** 1.5;

const VOICES = [
  // 0: hatchback, long muffled exhaust, intake at the front
  { exhL: 2.3, hdrL: 0.45, endLp: 1900, srRef: 0.5, endRef: 0.86, intL: 0.55, intGain: 0.55, mech: 0.55, hdrExtra: 0, mufRes: 135 },
  // 1: mid-engine coupe, short exhaust, intake and cams right behind the head
  { exhL: 1.5, hdrL: 0.4, endLp: 3400, srRef: 0.45, endRef: 0.9, intL: 0.4, intGain: 1.0, mech: 1.0, hdrExtra: 0, mufRes: 180 },
  // 2: rally car, unequal-length headers (the boxer burble), straight-ish pipe
  { exhL: 1.9, hdrL: 0.4, endLp: 2700, srRef: 0.5, endRef: 0.9, intL: 0.5, intGain: 0.75, mech: 0.8, hdrExtra: 0.34, mufRes: 160 },
];

export class EngineCore {
  constructor(o = {}) {
    // o.cfg (src/audio/engines.js): this model's cylinders, firing order, banks and voice parameters
    const cfg = o.cfg || {};
    this.cyl = cfg.cyl || o.cyl || 4;
    this.voice = o.voice || 0;
    const V = Object.assign({}, VOICES[this.voice] || VOICES[0], cfg.V || {});
    this.V = V;
    this.rpm = this.rpmT = o.rpm ?? 900;
    this.load = this.loadT = o.load ?? 0;
    this.boost = this.boostT = o.boost ?? 0;
    this.gain = this.gainT = o.gain ?? 0;
    this.theta = Math.random() * 720;
    // cylinders: even firing, alternating banks (bank B has the longer header)
    this.off = []; this.bank = []; this.amp = []; this.prevPhi = [];
    for (let k = 0; k < this.cyl; k++) {
      this.off.push(cfg.firing ? cfg.firing[k] : k * 720 / this.cyl); this.bank.push(cfg.bank ? cfg.bank[k] : k % 2); this.amp.push(1); this.prevPhi.push(0);
    }
    this.seed = 12345 + this.voice * 777 + this.cyl * 131 + Math.floor(Math.random() * 1000);
    // manufacturing / manifold differences: a fixed gain and timing error per cylinder.  They put
    // energy at the half and odd engine orders, the 'burble' every real engine has and a model of
    // identical cylinders lacks (that perfectly periodic train is exactly what a buzz is).
    this.stat = []; this.tOff = [];
    for (let k = 0; k < this.cyl; k++) { this.stat.push(1 + 0.07 * this.rnd()); this.tOff.push(1.6 * this.rnd()); }
    // exhaust waveguide: header delay lines per bank + main pipe
    const exhDelay = Math.round(V.exhL / C_EXH * SR);
    this.exF = new Delay(exhDelay + 4); this.exB = new Delay(exhDelay + 4); this.exD = exhDelay;
    this.hdrA = new Delay(Math.round(V.hdrL / C_EXH * SR) + 4); this.hdrAD = Math.round(V.hdrL / C_EXH * SR);
    this.hdrBD = Math.round((V.hdrL + V.hdrExtra) / C_EXH * SR);
    this.hdrB = new Delay(this.hdrBD + 4);
    this.endLp = new Biquad().lowpass(V.endLp, 0.6);
    this.mufLp = new Biquad().lowpass(1600, 0.5);   // catalyst/muffler wool
    this.mufRes = new Biquad().bandpass(V.mufRes, 2.5);
    this.dcHp = new Biquad().highpass(24, 0.7);
    const bh = V.boomHz || 88;
    this.boomF = new Biquad().bandpass(bh, 1.1);       // block / cabin boom: the body of the sound
    this.boomF2 = new Biquad().bandpass(bh * 1.7, 1.3);
    this.scPh = 0;                                      // supercharger drive phase
    this.thickLp = new Biquad().lowpass(380, 0.7);
    this.prevU = 0;
    this.srcLp = 0;
    // intake waveguide
    const inD = Math.round(V.intL / C_INT * SR);
    this.inF = new Delay(inD + 4); this.inB = new Delay(inD + 4); this.inD = inD;
    this.inLp = new Biquad().lowpass(900, 0.6);
    this.inNoise = new Biquad().bandpass(700, 0.8);
    // mechanical: block, valvetrain, injector/tick
    this.blk1 = new Biquad().bandpass(780, 5); this.blk2 = new Biquad().bandpass(2100, 6);
    this.blk3 = new Biquad().bandpass(3600, 4);
    this.rumble = new Biquad().bandpass(95, 1.6);
    this.fireHit = 0;
    this.nzA = new Biquad().bandpass(1100, 0.55); this.nzB = new Biquad().bandpass(3200, 0.8); this.nzC = new Biquad().highpass(250, 0.7);
    this.xLp = new Biquad().lowpass(150, 0.7); this.xHp = new Biquad().highpass(170, 0.7); this.xHp2 = new Biquad().highpass(170, 0.7); this.outHp = new Biquad().highpass(42, 0.7);
    this.wob = 0; this.wobT = 0; this.wobCnt = 0; this.jit = 0;
    // turbo
    this.whA = 0; this.whB = 0; this.flutter = 0;
    this.bov = 0; this.bovF = new Biquad().bandpass(3200, 1.2); this.bovF2 = new Biquad().highpass(1800);
    this.prevLoad = 0;
    this.pops = []; // pending exhaust pops [amp]
    this.popF = new Biquad().lowpass(900, 0.7);
    this.lump = 0; this.lumpT = 0; this.idleDrift = 0; this.idleDriftT = 0; this.idleCnt = 0;
  }

  message(d) {
    if (d.rpm !== undefined) this.rpmT = d.rpm;
    if (d.load !== undefined) this.loadT = d.load;
    if (d.boost !== undefined) this.boostT = d.boost;
    if (d.gain !== undefined) this.gainT = d.gain;
  }

  rnd() { this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff; return this.seed / 0x7fffffff * 2 - 1; }

  render(L, R) {
    const n = L.length, V = this.V, cyl = this.cyl;
    for (let i = 0; i < n; i++) {
      this.rpm += (this.rpmT - this.rpm) * 0.004;
      this.load += (this.loadT - this.load) * 0.003;
      this.boost += (this.boostT - this.boost) * 0.0008;
      this.gain += (this.gainT - this.gain) * 0.002;
      const ld = this.load;
      // idle lumpiness: slow governor hunting and big cycle-to-cycle spread
      const idleness = Math.max(0, 1 - this.rpm / 2400) * (1 - ld * 0.6);
      if (++this.idleCnt > 2400) { this.idleCnt = 0; this.idleDriftT = this.rnd(); }
      this.idleDrift += (this.idleDriftT - this.idleDrift) * 0.0004;
      // slow governor / driver hunting at every speed (a perfectly steady period is what a buzz is)
      if (++this.wobCnt > 3000) { this.wobCnt = 0; this.wobT = this.rnd(); }
      this.wob += (this.wobT - this.wob) * 0.0006;
      const rpm = this.rpm * (1 + 0.012 * idleness * this.idleDrift + 0.004 * this.wob);
      this.theta += rpm * 6 / SR;
      if (this.theta >= 720) this.theta -= 720;

      // throttle lift with boost: blow-off + the overrun starts popping
      if (this.prevLoad > 0.5 && ld < 0.2 && this.boost > 0.4) this.bov = 1;
      this.prevLoad += (ld - this.prevLoad) * 0.001;

      // --- exhaust pressure at the collector: sum of the cylinder curves ---
      let pA = 0, pB = 0, intake = 0, knock = 0;
      const drive = 0.16 + 0.84 * ld;
      const spread = (V.spread ?? 0.05) + 0.2 * idleness;
      for (let k = 0; k < cyl; k++) {
        let phi = this.theta - this.off[k] - this.tOff[k];
        if (phi < 0) phi += 720;
        if (phi >= 720) phi -= 720;
        if (phi < this.prevPhi[k]) {
          // new cycle for this cylinder: roll its strength (and the odd weak burn at idle)
          let a = 1 + spread * this.rnd();
          if (idleness > 0.3 && Math.random() < 0.012 * idleness) a *= 0.25;
          this.amp[k] = a;
          // overrun at speed: unburnt mixture lights in the pipe
          if (ld < 0.06 && rpm > 3200 && this.boost > 0.15 && Math.random() < 0.02) this.pops.push(1.0 + 1.6 * Math.random());
        }
        this.prevPhi[k] = phi;
        const i0 = phi | 0, fr = phi - i0, i1 = i0 === 719 ? 0 : i0 + 1;
        const e = (CURVE[i0] + (CURVE[i1] - CURVE[i0]) * fr) * this.amp[k] * this.stat[k];
        if (this.bank[k] && V.hdrExtra > 0) pB += e; else pA += e;
        const it = INTAKE[i0] + (INTAKE[i1] - INTAKE[i0]) * fr;
        intake += it * this.amp[k];
        // block/valvetrain excitation at firing TDC and valve closing
        if (phi < 12) knock += (12 - phi) / 12 * this.amp[k];
        else if (phi > 360 && phi < 368) knock += 0.35;
      }
      // pops: a short burst injected in the pipe, long enough to ring the line
      let popIn = 0;
      if (this.pops.length) {
        const pp = this.pops[0];
        popIn = pp * this.popF.run(this.rnd());
        this.pops[0] = pp * 0.9985;
        if (this.pops[0] < 0.01) this.pops.shift();
      }
      this.hdrA.write(pA); this.hdrB.write(pB);
      const src = (this.hdrA.read(this.hdrAD) + (V.hdrExtra > 0 ? this.hdrB.read(this.hdrBD) : 0)) * drive * (0.7 + 0.5 * Math.min(1, rpm / 5000)) + popIn;

      // --- exhaust pipe waveguide ---
      const bw = this.exB.read(this.exD);
      this.srcLp += (bw - this.srcLp) * 0.55;               // the collector end smooths the return
      const fin = src + V.srRef * this.mufLp.run(this.srcLp);
      this.exF.write(fin);
      const fend = this.exF.read(this.exD);
      const refl = -V.endRef * this.endLp.run(fend);
      this.exB.write(refl);
      const u = fend - refl;                                 // volume velocity at the open end
      const radiated = 0.45 * u + 1.9 * (u - this.prevU);    // radiation ~ d/dt of flow
      this.prevU = u;
      let ex = this.dcHp.run(radiated) + this.mufRes.run(radiated) * 0.7;
      // turbulence and combustion noise: broadband, gated by the pressure pulse, so it is part of
      // each firing instead of a steady hiss; it is what makes the note rough rather than a drone
      {
        const pr = Math.max(0, pA + pB) * drive;
        const nz = this.nzC.run(this.rnd());
        ex += (this.nzA.run(nz) * 0.55 + this.nzB.run(nz) * 0.3) * pr * (0.35 + 0.65 * ld) * 0.55;
      }

      // --- intake waveguide: growl follows the throttle and cylinder fill ---
      const inSrc = (intake * 0.35 * (0.25 + 0.75 * ld)) * (0.7 + 0.3 * this.rnd());
      const ib = this.inB.read(this.inD);
      this.inF.write(inSrc + 0.55 * ib);
      const ifw = this.inF.read(this.inD);
      this.inB.write(-0.8 * this.inLp.run(ifw));
      const inl = (ifw * 0.8 + this.inNoise.run(this.rnd()) * 0.12 * (0.2 + 0.8 * ld) * (0.4 + intake * 0.3)) * V.intGain;

      // --- mechanical ---
      const exc = knock * (0.3 + 0.7 * ld) * 0.35 + this.rnd() * 0.01;
      this.fireHit += (knock - this.fireHit) * 0.2;
      let mech = (this.blk1.run(exc) * 0.9 + this.blk2.run(exc) * 0.6 + this.blk3.run(this.rnd() * 0.02 * (0.2 + knock)) * 0.5) * V.mech;
      mech += this.rumble.run(this.fireHit * 0.4) * 0.5;

      // --- turbo: blade-pass whistle (+ harmonic), flutter on the lift, blow-off ---
      const spool = this.boost * this.boost;
      this.whA += (1800 + this.boost * 6200) / SR;
      this.whB += (3600 + this.boost * 12400) / SR;
      if (this.whA > 1) this.whA -= 1; if (this.whB > 1) this.whB -= 1;
      const wh = (Math.sin(this.whA * 6.2831853) * 0.5 + Math.sin(this.whB * 6.2831853) * 0.12) * 0.02 * spool * (0.5 + 0.5 * ld);
      // supercharger (Roots/screw): whine at lobe-pass frequency, loudest under load
      let sc = 0;
      if (V.whine) {
        this.scPh += rpm / 60 * V.whine * 3 / SR;
        if (this.scPh > 1) this.scPh -= 1;
        sc = (Math.sin(this.scPh * 6.2831853) + 0.3 * Math.sin(this.scPh * 12.566371)) * 0.012 * (0.25 + 0.75 * ld);
      }
      let bov = 0;
      if (this.bov > 0.001) {
        bov = (this.bovF.run(this.rnd()) * 0.55 + this.bovF2.run(this.rnd()) * 0.25) * this.bov * 0.3;
        this.bov *= 0.99987;
      }

      // body: the crank-order lumps (half-order, order 1, 2 - every real engine has them, they carry
      // the 'weight'), a boom resonance excited by the exhaust pulses, then drive/saturation
      const ang = this.theta * (Math.PI / 360);
      const lump = (Math.sin(ang) * 0.6 + Math.sin(ang * 2) * 0.9 + Math.sin(ang * 4 + 0.7) * 0.45) * (0.05 + 0.13 * ld) * (0.6 + 0.4 * Math.min(1, rpm / 3000));
      const boom = (this.boomF.run(src) * 1.1 + this.boomF2.run(src) * 0.55) * (0.5 + 0.5 * ld);
      let y = ex * 0.75 + inl * 0.55 + mech * 0.6 + lump * 0.5 + boom * 0.45 + wh + sc + bov;
      y = this.thickLp.run(y) * 0.5 + y * 0.9;            // keep the highs, add a fat low band
      // psychoacoustic bass: the low firing orders of a slow engine sit below what speakers reproduce
      // (idle of a four is 28 Hz).  Saturating the lowest band regenerates harmonics at 2x, 3x...
      // which the ear hears as the same pitch (the 'missing fundamental'); the sub itself is rolled off.
      const lb = this.xLp.run(y);
      y = this.outHp.run(y) + this.xHp2.run(this.xHp.run(Math.tanh(lb * 5.5))) * 0.55;
      y = Math.tanh(y * 2.6) * this.gain * 0.78;
      L[i] = y; R[i] = y;
    }
  }
}

if (typeof AudioWorkletProcessor !== 'undefined') {
  class EngineProcessor extends AudioWorkletProcessor {
    constructor(opts) {
      super();
      this.core = new EngineCore(opts.processorOptions || {});
      this.port.onmessage = (e) => this.core.message(e.data);
    }
    process(_in, outputs) {
      const out = outputs[0];
      this.core.render(out[0], out[1] || out[0]);
      return true;
    }
  }
  registerProcessor('vr-engine', EngineProcessor);
}
