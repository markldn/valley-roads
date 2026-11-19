// Engine configuration per car model: cylinder count, firing order, bank layout and the character
// of the exhaust, intake and block.  Read on the main thread (audio.js) and handed to the engine
// worklet as processorOptions.cfg.  Engine types follow the real cars.
//
//   cyl, firing (crank angle of each cylinder's firing in the 720 deg cycle), bank (0/1 per cylinder,
//   which header it feeds; hdrExtra > 0 makes the second header longer: boxer burble, cross-plane lope)
//   V: exhL / hdrL exhaust and header length (m), endLp exhaust brightness (Hz), srRef / endRef pipe
//   reflections, intL / intGain induction, mech block and valvetrain level, mufRes muffler resonance,
//   boomHz block boom, whine supercharger drive ratio, spread cycle-to-cycle scatter

const even = (n) => Array.from({ length: n }, (_, k) => k * 720 / n);
const alt = (n) => Array.from({ length: n }, (_, k) => k % 2);

const ARCH = {
  i3: { cyl: 3, firing: even(3), bank: [0, 0, 0] },
  i4: { cyl: 4, firing: even(4), bank: alt(4) },
  i5: { cyl: 5, firing: even(5), bank: alt(5) },
  flat4: { cyl: 4, firing: even(4), bank: alt(4) },
  flat6: { cyl: 6, firing: even(6), bank: alt(6) },
  v6: { cyl: 6, firing: even(6), bank: alt(6) },
  // 90 degree V6 on a 3-throw crank: 150 / 90 degree firing intervals
  v6odd: { cyl: 6, firing: [0, 150, 240, 390, 480, 630], bank: alt(6) },
  // cross-plane V8: even 90 degree firing, but the banks fire in a lopsided order (R L L R L R R L)
  v8cross: { cyl: 8, firing: even(8), bank: [0, 1, 1, 0, 1, 0, 0, 1] },
  v8flat: { cyl: 8, firing: even(8), bank: alt(8) },
  v10: { cyl: 10, firing: even(10), bank: alt(10) },
  v12: { cyl: 12, firing: even(12), bank: alt(12) },
};

const E = (arch, V, extra = {}) => ({ ...ARCH[arch], V, ...extra });

export const ENGINES = {
  // the three templates and the first fleet
  hatch: E('i4', { exhL: 1.9, hdrL: 0.4, endLp: 2700, srRef: 0.5, endRef: 0.9, intL: 0.5, intGain: 0.75, mech: 0.8, hdrExtra: 0.12, mufRes: 160 }),
  berlinette: E('v12', { exhL: 1.3, hdrL: 0.5, endLp: 4200, srRef: 0.42, endRef: 0.9, intL: 0.35, intGain: 1.15, mech: 1.1, mufRes: 210, boomHz: 112 }),
  rallye: E('i4', { exhL: 1.8, hdrL: 0.35, endLp: 3000, srRef: 0.5, endRef: 0.9, intL: 0.45, intGain: 0.9, mech: 0.9, hdrExtra: 0.22, mufRes: 170, whine: 1.4 }),
  mustang: E('v8cross', { exhL: 2.0, hdrL: 0.55, endLp: 1500, srRef: 0.55, endRef: 0.86, intL: 0.6, intGain: 0.8, mech: 0.9, hdrExtra: 0.08, mufRes: 110, boomHz: 70, spread: 0.09 }),
  vantage77: E('v8cross', { exhL: 2.6, hdrL: 0.6, endLp: 1300, srRef: 0.55, endRef: 0.85, intL: 0.65, intGain: 0.6, mech: 0.6, hdrExtra: 0.06, mufRes: 100, boomHz: 66, spread: 0.07 }),
  vantage98: E('v8cross', { exhL: 2.2, hdrL: 0.55, endLp: 1700, srRef: 0.5, endRef: 0.88, intL: 0.55, intGain: 0.7, mech: 0.7, hdrExtra: 0.06, mufRes: 115, boomHz: 72, whine: 2.4 }),
  monaro: E('v8cross', { exhL: 2.3, hdrL: 0.5, endLp: 1800, srRef: 0.52, endRef: 0.86, intL: 0.6, intGain: 0.85, mech: 0.85, hdrExtra: 0.1, mufRes: 120, boomHz: 74, spread: 0.1 }),
  x90: E('i4', { exhL: 2.4, hdrL: 0.45, endLp: 1750, srRef: 0.5, endRef: 0.85, intL: 0.55, intGain: 0.55, mech: 0.5, mufRes: 135, boomHz: 102 }),
  transit_l2: E('i4', { exhL: 2.6, hdrL: 0.45, endLp: 1300, srRef: 0.5, endRef: 0.84, intL: 0.6, intGain: 0.35, mech: 1.7, mufRes: 100, boomHz: 80, spread: 0.09 }),
  transit_l4: E('i4', { exhL: 3.3, hdrL: 0.45, endLp: 1200, srRef: 0.5, endRef: 0.84, intL: 0.65, intGain: 0.32, mech: 1.7, mufRes: 92, boomHz: 76, spread: 0.09 }),
  // fleet
  f40: E('v8cross', { exhL: 1.4, hdrL: 0.45, endLp: 3600, srRef: 0.45, endRef: 0.9, intL: 0.4, intGain: 0.9, mech: 1.0, hdrExtra: 0.06, mufRes: 190, boomHz: 90 }),
  f458: E('v8flat', { exhL: 1.2, hdrL: 0.4, endLp: 5200, srRef: 0.4, endRef: 0.92, intL: 0.35, intGain: 1.25, mech: 1.2, mufRes: 240, boomHz: 104, spread: 0.03 }),
  f296: E('v6', { exhL: 1.4, hdrL: 0.4, endLp: 3800, srRef: 0.45, endRef: 0.9, intL: 0.4, intGain: 0.9, mech: 0.9, mufRes: 200, boomHz: 96 }),
  outlander: E('i4', { exhL: 2.8, hdrL: 0.45, endLp: 1350, srRef: 0.52, endRef: 0.83, intL: 0.65, intGain: 0.35, mech: 0.4, mufRes: 112, boomHz: 76 }),
  jetta: E('i4', { exhL: 2.2, hdrL: 0.42, endLp: 2050, srRef: 0.5, endRef: 0.87, intL: 0.52, intGain: 0.6, mech: 0.55, mufRes: 142, boomHz: 94 }),
  scirocco: E('i4', { exhL: 2.0, hdrL: 0.4, endLp: 2000, srRef: 0.5, endRef: 0.87, intL: 0.5, intGain: 0.7, mech: 0.7, mufRes: 150, boomHz: 80 }),
  m3gtr: E('v8cross', { exhL: 1.5, hdrL: 0.45, endLp: 4200, srRef: 0.42, endRef: 0.9, intL: 0.38, intGain: 1.1, mech: 1.2, hdrExtra: 0.07, mufRes: 200, boomHz: 92, spread: 0.04 }),
  m6: E('v10', { exhL: 1.6, hdrL: 0.45, endLp: 4600, srRef: 0.42, endRef: 0.9, intL: 0.4, intGain: 1.1, mech: 1.1, mufRes: 200, boomHz: 100 }),
  golf8: E('i4', { exhL: 2.6, hdrL: 0.42, endLp: 1700, srRef: 0.5, endRef: 0.85, intL: 0.55, intGain: 0.5, mech: 0.5, mufRes: 135, boomHz: 90 }),
  golfr: E('i4', { exhL: 2.0, hdrL: 0.4, endLp: 2700, srRef: 0.48, endRef: 0.9, intL: 0.45, intGain: 0.8, mech: 0.7, hdrExtra: 0.16, mufRes: 170, boomHz: 86 }),
  golf7: E('i4', { exhL: 2.2, hdrL: 0.4, endLp: 2400, srRef: 0.5, endRef: 0.88, intL: 0.5, intGain: 0.75, mech: 0.6, hdrExtra: 0.05, mufRes: 160, boomHz: 94 }),
  polo: E('i4', { exhL: 1.9, hdrL: 0.38, endLp: 2300, srRef: 0.5, endRef: 0.87, intL: 0.42, intGain: 0.9, mech: 0.8, mufRes: 185, boomHz: 104 }),
  isf: E('v8cross', { exhL: 1.9, hdrL: 0.5, endLp: 2800, srRef: 0.48, endRef: 0.88, intL: 0.5, intGain: 0.9, mech: 0.8, hdrExtra: 0.05, mufRes: 150, boomHz: 82 }),
  solstice: E('i4', { exhL: 1.9, hdrL: 0.4, endLp: 3000, srRef: 0.5, endRef: 0.88, intL: 0.5, intGain: 0.7, mech: 0.8, mufRes: 130, boomHz: 74, spread: 0.07 }),
  dtm: E('i4', { exhL: 1.0, hdrL: 0.3, endLp: 6000, srRef: 0.35, endRef: 0.94, intL: 0.3, intGain: 1.3, mech: 1.4, mufRes: 260, boomHz: 110, spread: 0.025 }),
  cclass: E('i4', { exhL: 3.0, hdrL: 0.45, endLp: 1400, srRef: 0.52, endRef: 0.83, intL: 0.62, intGain: 0.4, mech: 0.4, mufRes: 112, boomHz: 72 }),
  mirage: E('i3', { exhL: 2.0, hdrL: 0.4, endLp: 1700, srRef: 0.5, endRef: 0.85, intL: 0.5, intGain: 0.6, mech: 0.75, mufRes: 150, boomHz: 96, spread: 0.1 }),
  delorean: E('v6odd', { exhL: 2.2, hdrL: 0.5, endLp: 1900, srRef: 0.5, endRef: 0.86, intL: 0.5, intGain: 0.7, mech: 0.8, mufRes: 130, boomHz: 80, spread: 0.08 }),
  huayra: E('v12', { exhL: 1.1, hdrL: 0.4, endLp: 5600, srRef: 0.38, endRef: 0.93, intL: 0.32, intGain: 1.0, mech: 0.9, mufRes: 240, boomHz: 124 }),
  p930: E('flat6', { exhL: 1.6, hdrL: 0.4, endLp: 2600, srRef: 0.48, endRef: 0.88, intL: 0.45, intGain: 0.8, mech: 1.5, hdrExtra: 0.12, mufRes: 150, boomHz: 95 }),
  polizei: E('flat6', { exhL: 1.7, hdrL: 0.4, endLp: 3000, srRef: 0.46, endRef: 0.9, intL: 0.42, intGain: 0.95, mech: 1.3, hdrExtra: 0.1, mufRes: 170, boomHz: 98 }),
  ranger: E('i3', { exhL: 1.8, hdrL: 0.35, endLp: 1100, srRef: 0.5, endRef: 0.82, intL: 0.4, intGain: 0.3, mech: 1.9, mufRes: 90, boomHz: 74, spread: 0.1 }),
  fortuner: E('i4', { exhL: 3.1, hdrL: 0.45, endLp: 1150, srRef: 0.5, endRef: 0.83, intL: 0.65, intGain: 0.28, mech: 1.7, mufRes: 85, boomHz: 68, spread: 0.1 }),
  crx: E('i4', { exhL: 1.7, hdrL: 0.36, endLp: 3400, srRef: 0.46, endRef: 0.9, intL: 0.4, intGain: 1.0, mech: 1.0, mufRes: 190 }),
};

// the configuration for a car (unknown keys: a generic engine from the spec)
export function engineConfig(key, spec) {
  const e = ENGINES[key];
  if (e) return e;
  const cyl = spec.cyl || (spec.engine.na ? 8 : 4);
  return { cyl, firing: even(cyl), bank: alt(cyl), V: {} };
}
