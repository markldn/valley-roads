/** a parameter ramp that skips a non-finite value: one bad number must not stop the sound, or the game */
const _ramp = (p, v, t, tc) => { if (Number.isFinite(v)) p.setTargetAtTime(v, t, tc); };
// Speech-like voices without samples: a source-filter (formant) synthesiser driven by hand-written
// French phoneme sequences.  A glottal pulse train (sawtooth with a pitch contour: declination, accent,
// question rise) goes through three parallel resonators whose centre frequencies glide between the
// formants of each vowel (Peterson & Barney style values, adapted to French vowels); consonants are
// short bursts / hisses of band-passed noise or voiced buzz.  It is not text-to-speech of arbitrary text:
// people say a few dozen everyday phrases, which is what a street needs.
//
// Phoneme codes: a e E i o u y O(eu) @(schwa) A(an) 5(in) 3(on)   consonants: b d g p t k m n l R v z Z f s S j w

const V = {   // F1, F2, F3 (Hz), relative loudness
  a: [750, 1300, 2500, 1], e: [400, 2200, 2800, 0.9], E: [560, 1850, 2600, 1], i: [280, 2300, 3000, 0.8], o: [450, 850, 2500, 0.95],
  u: [320, 800, 2300, 0.85], y: [290, 1800, 2200, 0.8], O: [420, 1500, 2400, 0.9], '@': [500, 1450, 2500, 0.7],
  A: [620, 1050, 2500, 1], 5: [560, 1750, 2500, 0.95], 3: [450, 900, 2500, 0.95],
};
// consonants: [type, F1, F2, noise centre Hz, noise width, duration s]
const C = {
  m: ['nasal', 250, 1100, 0, 0, 0.07], n: ['nasal', 250, 1500, 0, 0, 0.065], l: ['liquid', 360, 1300, 0, 0, 0.06], R: ['liquid', 480, 1250, 1500, 0.4, 0.07],
  v: ['vfric', 300, 1400, 4000, 0.5, 0.07], z: ['vfric', 300, 1700, 5500, 0.5, 0.08], Z: ['vfric', 300, 1700, 3000, 0.5, 0.085],
  f: ['fric', 300, 1400, 5000, 0.2, 0.09], s: ['fric', 300, 1700, 6200, 0.35, 0.1], S: ['fric', 300, 1700, 3200, 0.4, 0.1],
  b: ['vstop', 250, 1100, 700, 0.5, 0.06], d: ['vstop', 250, 1700, 3000, 0.4, 0.055], g: ['vstop', 250, 1500, 1800, 0.4, 0.06],
  p: ['stop', 250, 1100, 900, 0.5, 0.07], t: ['stop', 250, 1800, 4000, 0.3, 0.065], k: ['stop', 250, 1500, 2200, 0.4, 0.075],
  j: ['glide', 280, 2300, 0, 0, 0.055], w: ['glide', 320, 800, 0, 0, 0.06],
};

// phrase -> phonemes ('!' exclamation, '?' question rise handled by the prosody flags)
export const PHRASES = {
  greet: [['b3ZuR', 0], ['saly', 0], ['bE', 0], ['salyt', 0], ['kuku', 0]],
  how: [['savA', 1], ['savabj5', 1], ['kEskEtyfE', 1], ['komA5Elvu', 1]],
  fine: [['5pEdbj5', 0], ['5pEsava', 0], ['5kOmdabitud', 0]],
  weather: [['kElt3', 2], ['5leskEfrE', 2], ['bOlt3pu', 0], ['5nOrazO', 0]],
  thanks: [['mERsi', 0], ['mERsibOkup', 0], ['dEri5', 0]],
  bye: [['b3nZuRne', 0], ['alOtR', 0], ['aby5to', 0], ['ARvwaR', 0]],
  sorry: [['paRd3', 0], ['dEzole', 0], ['E5ekyze', 0]],
  angry: [['amasasyfi', 2], ['kEtepaRmwa', 2]],
  hey: [['e', 2], ['E', 2], ['O', 2]],
  oh: [['olala', 2], ['o', 2], ['OnO3', 2], ['ala', 2]],
  yes: [['wi', 0], ['wiwi', 0], ['dakOR', 0]],
  no: [['n3', 0], ['n3n3', 0]],
  watch: [['atAsj3', 2], ['atA', 2], ['dORtwa', 2]],
  police: [['pOlis', 2], ['pOlis', 2]],
  halt: [['aREte', 2], ['aREtevu', 2]],
  hands: [['lemE5zAlER', 2], ['lemE5', 2]],
  go: [['ale', 2], ['alEvit', 2], ['dEpEsvu', 2]],
  welcome: [['b3ZuRmadam', 0], ['b3ZuRmOsjO', 0], ['b3ZuRbj5vny', 0]],
  next: [['osyivA', 2], ['lEsyivA', 2]],
  please: [['silvuplE', 0], ['sElvuplE', 0]],
  want: [['ZvudREb', 0], ['ZvudREdypE5', 0], ['b3ZuRZvudRE', 0]],
  here: [['vwala', 0], ['vwalamadam', 0], ['vwalamOsjO', 0]],
  nice: [['bOnZuRne', 0], ['bOnZuRne', 0], ['bOnapRemidi', 0]],
};

function phones(str) {
  const out = [];
  for (const ch of str) {
    if (V[ch]) out.push({ v: true, c: V[ch] });
    else if (C[ch]) out.push({ v: false, c: C[ch] });
  }
  return out;
}

const waves = new WeakMap();
// glottal-like source: harmonics falling at about -13 dB/octave (a sawtooth's -6 sounds like a buzzer)
function glottal(ctx) {
  let w = waves.get(ctx);
  if (w) return w;
  const N = 48, re = new Float32Array(N + 1), im = new Float32Array(N + 1);
  for (let n = 1; n <= N; n++) { im[n] = 1 / Math.pow(n, 1.9) * (n % 2 ? 1 : 0.9); re[n] = 0.0; }
  w = ctx.createPeriodicWave(re, im, { disableNormalization: false });
  waves.set(ctx, w);
  return w;
}

/**
 * Build and start one utterance.  ctx: AudioContext, dest: AudioNode, white: noise AudioBuffer.
 * opts: { f0 (Hz), rate (1 = normal), gain, mode 0 statement / 1 question / 2 exclamation, tract (vocal
 * tract scale: 1 man, ~1.17 woman, ~1.35 child), breath 0..1 }
 * Returns the duration in seconds.
 *
 * What keeps it from sounding like a machine: a smooth glottal source with pitch jitter and slow drift;
 * phoneme durations that vary and stretch at the end of the phrase; word-final stress; formants that glide
 * exponentially towards the next vowel while the previous one is still sounding (coarticulation); a
 * fourth resonator and breath noise; a voice-specific vocal tract length.
 */
export function speak(ctx, dest, white, str, opts = {}) {
  const ph = phones(str);
  if (!ph.length) return 0;
  const t0 = ctx.currentTime + 0.03;
  const f0 = opts.f0 || 120, rate = opts.rate || 1, mode = opts.mode || 0, amp = opts.gain ?? 0.5;
  const tract = opts.tract || (f0 < 150 ? 1 : f0 < 240 ? 1.16 : 1.34);
  const breath = opts.breath ?? 0.05 + Math.random() * 0.06;
  const rnd = (a) => 1 + (Math.random() - 0.5) * 2 * a;

  const src = ctx.createOscillator(); src.setPeriodicWave(glottal(ctx));
  const voiced = ctx.createGain(); voiced.gain.value = 0;
  src.connect(voiced);
  const nz = ctx.createBufferSource(); nz.buffer = white; nz.loop = true;
  const nzF = ctx.createBiquadFilter(); nzF.type = 'bandpass'; nzF.Q.value = 1;
  const nzG = ctx.createGain(); nzG.gain.value = 0;
  nz.connect(nzF).connect(nzG);
  const asp = ctx.createGain(); asp.gain.value = breath;     // aspiration noise riding on the voiced signal
  const aspF = ctx.createBiquadFilter(); aspF.type = 'highpass'; aspF.frequency.value = 700;
  nz.connect(aspF).connect(asp).connect(voiced);
  const out = ctx.createGain(); out.gain.value = amp * 1.6;
  // four resonators in parallel (bandwidths grow with frequency)
  const Q = [6.5, 10, 13, 16], GAIN = [1.0, 0.8, 0.45, 0.22];
  const fm = Q.map((q, k) => {
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = q;
    const g = ctx.createGain(); g.gain.value = GAIN[k];
    voiced.connect(f); f.connect(g).connect(out);
    return f;
  });
  fm[3].frequency.value = 3500 * tract;
  nzG.connect(out);
  out.connect(dest);

  // ---- timeline: durations with natural variation, phrase-final lengthening, word-final stress ----
  const n = ph.length;
  const T = [];
  let t = t0;
  ph.forEach((p, i) => {
    let d = (p.v ? 0.105 : p.c[5]) * rnd(0.18) / rate;
    const last = i >= n - 2;
    if (p.v && last) d *= i === n - 1 ? 1.75 : 1.25;
    T.push({ p, t, d, i, stressed: p.v && (i === n - 1 || i === n - 2) });
    t += d;
  });
  const total = t - t0;

  // ---- pitch: contour sampled every 10 ms with jitter and drift ----
  const contour = (u) => {          // u 0..1 over the utterance
    let f = f0 * (1.07 - 0.17 * u);
    if (mode === 1) f *= 1 + 0.38 * Math.pow(u, 3);
    if (mode === 2) f *= 1.12 + 0.2 * Math.sin(Math.min(1, u * 1.8) * Math.PI);
    return f;
  };
  let drift = 0;
  src.frequency.setValueAtTime(contour(0), t0);
  for (let tt = 0.01; tt < total + 0.05; tt += 0.01) {
    const u = Math.min(1, tt / total);
    // stress: a pitch peak on the stressed (last) vowels; consonants dip it a little
    let k = 1;
    const seg = T.find((q) => tt >= q.t - t0 && tt < q.t - t0 + q.d);
    if (seg) {
      if (seg.stressed) k *= 1.07 + (mode === 1 ? 0.1 : 0);
      if (!seg.p.v) k *= 0.985;
    }
    drift += (Math.random() - 0.5) * 0.004; drift *= 0.97;
    const jit = (Math.random() - 0.5) * 0.012;
    src.frequency.linearRampToValueAtTime(contour(u) * k * (1 + drift + jit), t0 + tt);
  }

  // ---- articulation ----
  const set = (param, v, at, tau) => _ramp(param, v, at, tau);
  voiced.gain.setValueAtTime(0, t0);
  let prevVowel = null;
  for (const { p, t: ts, d, i } of T) {
    const tau = 0.022;
    if (p.v) {
      const [F1, F2, F3, L] = p.c;
      const jit = rnd(0.04);
      // glide towards this vowel from the moment it starts
      set(fm[0].frequency, F1 * tract * jit, ts, tau); set(fm[1].frequency, F2 * tract * jit, ts, tau); set(fm[2].frequency, F3 * tract, ts, tau);
      const loud = L * (mode === 2 ? 1.3 : 1) * rnd(0.12) * (i >= n - 2 ? 1.05 : 1);
      set(voiced.gain, loud, ts, 0.02);
      set(voiced.gain, loud * 0.72, ts + d * 0.7, 0.04);
      set(nzG.gain, 0, ts, 0.02);
      prevVowel = p.c;
    } else {
      const [type, F1, F2, nc, nw] = p.c;
      // consonants pull the formants towards their locus
      set(fm[0].frequency, F1 * tract, ts, tau); set(fm[1].frequency, F2 * tract, ts, tau);
      nzF.frequency.setValueAtTime(Math.max(300, nc * (tract > 1.1 ? 1.1 : 1)), ts);
      nzF.Q.setValueAtTime(nc ? Math.max(0.7, 2.0 / Math.max(0.15, nw)) : 1, ts);
      if (type === 'nasal') { set(voiced.gain, 0.34, ts, 0.015); set(nzG.gain, 0, ts, 0.015); }
      else if (type === 'liquid' || type === 'glide') { set(voiced.gain, 0.55, ts, 0.015); set(nzG.gain, type === 'liquid' && nc ? 0.1 : 0, ts, 0.015); }
      else if (type === 'vfric') { set(voiced.gain, 0.3, ts, 0.012); set(nzG.gain, 0.5, ts, 0.012); }
      else if (type === 'fric') { set(voiced.gain, 0, ts, 0.01); set(nzG.gain, 0.85, ts, 0.012); set(nzG.gain, 0, ts + d * 0.85, 0.01); }
      else if (type === 'vstop') {
        set(voiced.gain, 0.1, ts, 0.01); set(nzG.gain, 0, ts, 0.008);
        nzG.gain.setValueAtTime(0.65, ts + d * 0.6); set(nzG.gain, 0, ts + d * 0.7, 0.01);
      } else {
        set(voiced.gain, 0, ts, 0.006); set(nzG.gain, 0, ts, 0.006);
        nzG.gain.setValueAtTime(0.95, ts + d * 0.62); set(nzG.gain, 0, ts + d * 0.72, 0.012);
      }
    }
  }
  const end = t;
  set(voiced.gain, 0, end, 0.03); set(nzG.gain, 0, end, 0.02);
  src.start(t0); nz.start(t0);
  src.stop(end + 0.25); nz.stop(end + 0.25);
  void prevVowel;
  return end + 0.25 - t0;
}
