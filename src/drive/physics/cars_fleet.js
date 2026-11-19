// The fleet: real vehicles with real dimensions and power, physics generated from them.
// fleetCar() derives engine curve, gearing (top gear reaches the redline at the aero-limited top
// speed), brakes, springs, inertia and tyres from a handful of numbers, on top of the three tuned
// templates in cars.js.  Numbers are approximate real-world figures.
import { CARS } from './cars.js';

const merge = (a, b) => {
  const out = Array.isArray(a) ? a.slice() : { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object' ? merge(a[k], v) : v;
  return out;
};

const LAYOUT = {   // front weight share, template
  front: { fw: 0.54, base: 'berlinette' }, mid: { fw: 0.43, base: 'berlinette' }, rear: { fw: 0.38, base: 'berlinette' },
  fwd: { fw: 0.60, base: 'hatch' }, awd: { fw: 0.56, base: 'rallye' },
};

export function fleetCar(o) {
  const { name, len, wid, hgt, wb, mass, hp, redline = 6500, turbo = false, drive = 'rwd', layout, cd = 0.33, rim = 0.32, down = 0, color = 0x888888, desc = '', suv = false, tyreMu } = o;
  const lay = LAYOUT[layout || (drive === 'fwd' ? 'fwd' : drive === 'awd' ? 'awd' : 'front')];
  const base = CARS[lay.base];
  const fw = o.frontWeight ?? lay.fw;
  const A = wid * hgt * 0.78;
  const cdA = +(cd * A).toFixed(2);
  // aero-limited top speed from power (drivetrain eff 0.88, rolling resistance ~ 0.013 m g)
  const P = hp * 745.7 * 0.88;
  let v = 30;
  for (let i = 0; i < 40; i++) { const f = 0.5 * 1.2 * cdA * v * v + 0.013 * mass * 9.81; v = Math.max(5, v + (P / v - f) * 0.002); }
  const vmax = Math.min(v, o.vmax || 99);
  // torque curve from peak power at 0.88 of the redline
  const rpmP = redline * 0.88, wP = rpmP * Math.PI / 30;
  const Tp = hp * 745.7 / wP;                                   // torque at peak power
  const pk = turbo ? 1.28 : 1.14;                               // peak-to-peak-power torque ratio
  const idle = o.idle || 850;
  const torque = turbo
    ? [[idle - 50, 0.45 * Tp * pk], [1300, 0.75 * Tp * pk], [1900, Tp * pk], [rpmP * 0.78, Tp * pk], [rpmP, Tp], [redline, 0.84 * Tp], [redline * 1.04, 0.66 * Tp]]
    : [[idle - 50, 0.6 * Tp * pk], [1500, 0.8 * Tp * pk], [rpmP * 0.55, 0.97 * Tp * pk], [rpmP * 0.72, Tp * pk], [rpmP, Tp], [redline, 0.9 * Tp], [redline * 1.04, 0.72 * Tp]];
  const gearsN = o.gears || 6;
  const ratios = { 4: [2.8, 1.8, 1.3, 1.0], 5: [3.4, 2.1, 1.5, 1.15, 0.9], 6: [3.5, 2.2, 1.6, 1.2, 0.95, 0.76], 7: [3.6, 2.3, 1.7, 1.3, 1.05, 0.85, 0.7] }[gearsN];
  const R = o.wheelR || rim;
  const topRatio = ratios[ratios.length - 1];
  const final = +((redline * 0.97 * Math.PI / 30) * R / (vmax * topRatio)).toFixed(2);
  const first = ratios[0] * final;
  const cg = +(0.36 * hgt).toFixed(2);
  const k = mass / 1325;
  const heavyFront = fw > 0.5;
  const spec = merge(base, {
    name, desc, mass, cg: suv ? +(0.4 * hgt).toFixed(2) : cg,
    inertia: [Math.round(1900 * k * (len / 4.05)), Math.round(2050 * k * (len / 4.05)), Math.round(520 * k * (wid / 1.74))],
    wheelbase: wb, frontWeight: fw, trackF: +(wid - 0.2).toFixed(2), trackR: +(wid - 0.21).toFixed(2),
    dims: { len, wid, hgt, overF: +(heavyFront ? (len - wb) * 0.52 : (len - wb) * 0.48).toFixed(2), overR: 0 },
    wheel: { radius: R, width: o.wheelW || (hp > 350 ? 0.30 : 0.215), inertia: +(1.1 + R * 1.2).toFixed(2) },
    susp: {
      restLen: suv ? 0.38 : 0.31, travel: suv ? 0.24 : 0.18, kF: Math.round(24 * mass * (hp > 400 ? 1.5 : 1)), kR: Math.round(22 * mass * (hp > 400 ? 1.6 : 1)),
      cBumpF: Math.round(1.9 * mass), cRebF: Math.round(2.8 * mass), cBumpR: Math.round(1.7 * mass), cRebR: Math.round(2.6 * mass),
      arbF: Math.round(10 * mass), arbR: Math.round(7 * mass), bumpK: Math.round(165 * mass),
    },
    steer: { maxAngle: suv ? 0.56 : 0.55, ratio: o.steerRatio || (hp > 400 ? 12.5 : 14.5), ackermann: 0.85 },
    aero: { cdA, clA_f: +(down * 0.4).toFixed(2), clA_r: +(down * 0.6).toFixed(2) },
    brakes: { front: Math.round(1.75 * mass), rear: Math.round(0.75 * mass), hand: Math.round(1.1 * mass), abs: true },
    engine: { idle, redline, limiter: redline + 250, inertia: +(0.14 + hp / 2500).toFixed(2), na: !turbo, torque, friction: [18 + Math.round(hp / 40), 0.005], turboLag: turbo ? 0.4 : 0.01 },
    drive, lsd: drive === 'awd' ? 0.4 : 0.3, awdFront: 0.45,
    gears: [-3.3, 0, ...ratios.map((r) => r)], final, eff: 0.9, shiftTime: hp > 450 ? 0.08 : 0.14,
    tyre: hp > 250 ? base.tyre : CARS.hatch.tyre,
    color, drivable: true, fleet: true,
  });
  spec.dims.overR = +(len - wb - spec.dims.overF).toFixed(2);
  if (tyreMu) { spec.tyre = merge(spec.tyre, { lat: { mu: tyreMu }, lon: { mu: tyreMu + 0.06 } }); }
  void first;
  return spec;
}

const C = fleetCar;
export const FLEET = {
  f40: C({ name: 'Widebody V8 Twin Turbo', desc: 'Coupé en kit large préparée : biturbo, légère, brutale. Aucune aide à l’origine.', len: 4.48, wid: 2.0, hgt: 1.12, wb: 2.45, mass: 1250, hp: 650, redline: 7700, turbo: true, layout: 'mid', cd: 0.34, down: 0.12, color: 0xb30f12, vmax: 90 }),
  f458: C({ name: 'Track V8 605', desc: 'V8 atmosphérique de 605 ch qui tourne à 9 000 tr/min.', len: 4.53, wid: 1.94, hgt: 1.2, wb: 2.65, mass: 1395, hp: 605, redline: 9000, layout: 'mid', cd: 0.33, down: 0.22, color: 0xd3151b, gears: 7, vmax: 91.7 }),
  f296: C({ name: 'Hybrid V6 860', desc: 'Hybride rechargeable V6 biturbo : plus de 850 ch.', len: 4.57, wid: 1.96, hgt: 1.19, wb: 2.6, mass: 1500, hp: 860, redline: 8500, turbo: true, layout: 'mid', cd: 0.33, down: 0.35, color: 0xf0c000, gears: 7, vmax: 91.7 }),
  outlander: C({ name: 'Family SUV 180', desc: 'SUV familial 4x4, 2,5 L atmosphérique.', len: 4.71, wid: 1.86, hgt: 1.74, wb: 2.7, mass: 1650, hp: 180, redline: 6200, drive: 'awd', suv: true, cd: 0.36, color: 0x7a8088, gears: 6 }),
  jetta: C({ name: 'Sport Saloon 228', desc: 'Berline sportive à traction, 2,0 TSI de 228 ch.', len: 4.78, wid: 1.8, hgt: 1.46, wb: 2.69, mass: 1450, hp: 228, redline: 6500, turbo: true, drive: 'fwd', cd: 0.29, color: 0x1b2433 }),
  scirocco: C({ name: 'Sport Coupe 200', desc: 'Coupé compact à traction, 200 ch.', len: 4.26, wid: 1.81, hgt: 1.4, wb: 2.58, mass: 1330, hp: 200, redline: 6500, turbo: true, drive: 'fwd', cd: 0.31, color: 0xe5e5e5 }),
  m3gtr: C({ name: 'Touring Racer V8', desc: 'Berline de course à V8 de 4 L, propulsion, mécanique sauvage.', len: 4.49, wid: 1.78, hgt: 1.33, wb: 2.73, mass: 1350, hp: 380, redline: 8000, cd: 0.34, down: 0.1, color: 0x2a5ea8, vmax: 85 }),
  m6: C({ name: 'Grand Tourer V10', desc: 'GT à V10 atmosphérique de 507 ch, 1 700 kg de classe.', len: 4.87, wid: 1.85, hgt: 1.37, wb: 2.78, mass: 1710, hp: 507, redline: 8250, cd: 0.31, color: 0x6a7a8c, vmax: 72 }),
  golf8: C({ name: 'Sport Hatch 265', desc: 'La compacte sportive de référence : 265 ch, traction.', len: 4.29, wid: 1.79, hgt: 1.46, wb: 2.63, mass: 1400, hp: 265, redline: 6500, turbo: true, drive: 'fwd', cd: 0.3, color: 0xc4c8cc }),
  golfr: C({ name: 'AWD Sport Estate', desc: 'Break familial à transmission intégrale, 333 ch.', len: 4.63, wid: 1.79, hgt: 1.46, wb: 2.67, mass: 1600, hp: 333, redline: 6700, turbo: true, drive: 'awd', cd: 0.3, color: 0x2a5fb0 }),
  golf7: C({ name: 'Club Sport Hatch', desc: 'Compacte sportive, 265 ch en overboost, traction.', len: 4.27, wid: 1.8, hgt: 1.44, wb: 2.63, mass: 1380, hp: 265, redline: 6500, turbo: true, drive: 'fwd', cd: 0.3, color: 0xf0f0f0 }),
  polo: C({ name: 'Sport Hatch 180', desc: 'Petite GTI de 180 ch, vive et facile.', len: 3.98, wid: 1.68, hgt: 1.45, wb: 2.47, mass: 1210, hp: 180, redline: 6500, turbo: true, drive: 'fwd', cd: 0.32, color: 0xa31621 }),
  isf: C({ name: 'Sport Saloon V8', desc: 'Berline à V8 atmosphérique de 416 ch.', len: 4.66, wid: 1.82, hgt: 1.41, wb: 2.73, mass: 1690, hp: 416, redline: 6800, cd: 0.31, color: 0x8a8c90, vmax: 75 }),
  solstice: C({ name: 'Turbo Roadster', desc: 'Roadster américain turbo de 260 ch, propulsion.', len: 4.07, wid: 1.81, hgt: 1.27, wb: 2.41, mass: 1380, hp: 260, redline: 6500, turbo: true, cd: 0.35, color: 0x5d6f7d }),
  dtm: C({ name: 'Track Coupe 610', desc: 'Voiture de course DTM : 610 ch, 1 120 kg, appui aérodynamique.', len: 4.78, wid: 1.95, hgt: 1.15, wb: 2.75, mass: 1120, hp: 610, redline: 9000, turbo: true, cd: 0.42, down: 0.5, color: 0x2f3338, gears: 6, steerRatio: 11, vmax: 83 }),
  cclass: C({ name: 'Touring Saloon 204', desc: 'Berline premium à propulsion, 204 ch.', len: 4.8, wid: 1.82, hgt: 1.46, wb: 2.87, mass: 1700, hp: 204, redline: 6000, turbo: true, cd: 0.25, color: 0x20252b }),
  mirage: C({ name: 'City Hatch 78', desc: 'Citadine légère de 78 ch : économique, pas rapide.', len: 3.88, wid: 1.67, hgt: 1.51, wb: 2.55, mass: 940, hp: 78, redline: 6200, drive: 'fwd', cd: 0.3, gears: 5, color: 0x16171a }),
  delorean: C({ name: 'Stainless Wedge', desc: 'Moteur arrière V6 de 130 ch, caisse inox. Le 88 mph reste à vérifier.', len: 4.27, wid: 1.99, hgt: 1.14, wb: 2.41, mass: 1230, hp: 130, redline: 5800, layout: 'rear', cd: 0.35, gears: 5, color: 0xb9bcc0 }),
  huayra: C({ name: 'Carbon V12 Track', desc: 'V12 atmosphérique de 850 ch, 1 050 kg, fibre de carbone.', len: 4.78, wid: 2.05, hgt: 1.17, wb: 2.79, mass: 1050, hp: 850, redline: 9000, layout: 'mid', cd: 0.4, down: 0.6, color: 0x1b5b9c, gears: 6, steerRatio: 11, vmax: 103 }),
  p930: C({ name: 'Classic Rear Turbo 75', desc: 'Coupé classique : moteur en porte-à-faux arrière, turbo à retard de légende.', len: 4.29, wid: 1.78, hgt: 1.32, wb: 2.27, mass: 1195, hp: 260, redline: 6500, turbo: true, layout: 'rear', cd: 0.39, gears: 4, color: 0x2c4a2a, tyreMu: 0.95 }),
  polizei: C({ name: 'Motorway Patrol Coupe', desc: 'Coupé de la police des autoroutes allemande.', len: 4.43, wid: 1.8, hgt: 1.3, wb: 2.35, mass: 1350, hp: 320, redline: 7200, layout: 'rear', cd: 0.34, color: 0xf2f2f2 }),
  ranger: C({ name: 'Utility Crew Diesel', desc: 'Utilitaire tout-terrain diesel : 30 ch, 4 places, 60 km/h.', len: 3.9, wid: 1.57, hgt: 2.0, wb: 2.6, mass: 1000, hp: 30, redline: 3800, idle: 900, drive: 'awd', suv: true, cd: 0.7, rim: 0.30, gears: 4, color: 0x8da58a, vmax: 17 }),
  fortuner: C({ name: 'Diesel 4x4 204', desc: 'SUV tout-chemin diesel, 204 ch, 2,1 t.', len: 4.8, wid: 1.86, hgt: 1.84, wb: 2.75, mass: 2100, hp: 204, redline: 4800, turbo: true, drive: 'awd', suv: true, cd: 0.38, rim: 0.38, gears: 6, color: 0x2f353b }),
  crx: C({ name: 'Light Sport Hatch 160', desc: 'Petite sportive légère à traction, 160 ch atmosphériques à 8 000 tr/min.', len: 3.76, wid: 1.65, hgt: 1.27, wb: 2.3, mass: 950, hp: 160, redline: 8200, drive: 'fwd', cd: 0.32, gears: 5, color: 0xd2d2d2 }),
};
