// Additional vehicles built on the three tuned templates in cars.js.  Dimensions, wheelbase and
// track are the real ones (the car models are scaled to them); engine and chassis numbers are
// plausible for each car, not data-sheet copies.  `drivable: false` would make a vehicle traffic-only.
import { CARS } from './cars.js';
import { FLEET } from './cars_fleet.js';

const merge = (a, b) => {
  const out = Array.isArray(a) ? a.slice() : { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object' ? merge(a[k], v) : v;
  return out;
};
const variant = (base, o) => merge(CARS[base], o);
const dims = (len, wid, hgt, wb, overF) => ({ len, wid, hgt, overF, overR: +(len - wb - overF).toFixed(3) });

export const EXTRA_CARS = {
  mustang: variant('berlinette', {
    name: 'Classic 302 Fastback',
    desc: 'Muscle car américaine à moteur V8 atmosphérique, propulsion, direction lente. Beaucoup de couple, peu de grip.',
    mass: 1480, inertia: [1900, 2200, 540], cg: 0.50, wheelbase: 2.74, frontWeight: 0.55, trackF: 1.50, trackR: 1.49,
    dims: dims(4.76, 1.82, 1.30, 2.74, 0.97),
    wheel: { radius: 0.33, width: 0.225, inertia: 1.2 },
    susp: { restLen: 0.30, travel: 0.17, kF: 24000, kR: 27000, cBumpF: 2000, cRebF: 3200, cBumpR: 2200, cRebR: 3400, arbF: 9000, arbR: 5000, bumpK: 200000 },
    steer: { maxAngle: 0.50, ratio: 17, ackermann: 0.7 },
    tyre: { lat: { B: 8.5, C: 1.3, E: -0.3, mu: 0.95 }, lon: { B: 10, C: 1.55, E: 0.05, mu: 1.0 }, loadSens: 0.1, sigmaY: 0.5, sigmaX: 0.22, rollRes: 0.014 },
    aero: { cdA: 0.78, clA_f: 0.05, clA_r: 0.08 },
    brakes: { front: 1800, rear: 1000, hand: 1300, abs: false },
    engine: { idle: 850, redline: 6500, limiter: 6800, inertia: 0.28, na: true,
      torque: [[800, 190], [1500, 300], [2500, 370], [4300, 400], [5800, 385], [6500, 330], [7000, 250]], friction: [26, 0.006], turboLag: 0.01 },
    drive: 'rwd', lsd: 0.2, gears: [-3.0, 0, 2.78, 1.93, 1.36, 1.0, 0.82], final: 3.5, eff: 0.9, shiftTime: 0.2, color: 0xd9a21b, drivable: true,
  }),
  vantage77: variant('berlinette', {
    name: 'Grand Tourer V8 77',
    desc: 'Grand tourisme britannique à V8 de 5,3 L, lourd et puissant. Un paquebot qui accélère comme une fusée.',
    mass: 1730, inertia: [2100, 2500, 600], cg: 0.50, wheelbase: 2.61, frontWeight: 0.52, trackF: 1.50, trackR: 1.52,
    dims: dims(4.65, 1.83, 1.33, 2.61, 1.0),
    wheel: { radius: 0.34, width: 0.235, inertia: 1.3 },
    susp: { restLen: 0.30, travel: 0.17, kF: 30000, kR: 33000, cBumpF: 2400, cRebF: 3600, cBumpR: 2600, cRebR: 3800, arbF: 12000, arbR: 7000, bumpK: 220000 },
    steer: { maxAngle: 0.52, ratio: 15, ackermann: 0.75 },
    tyre: { lat: { B: 9.5, C: 1.32, E: -0.3, mu: 1.0 }, lon: { B: 11, C: 1.6, E: 0.05, mu: 1.05 }, loadSens: 0.1, sigmaY: 0.45, sigmaX: 0.2, rollRes: 0.013 },
    aero: { cdA: 0.8, clA_f: 0.04, clA_r: 0.06 },
    brakes: { front: 2200, rear: 1200, hand: 1500, abs: false },
    engine: { idle: 850, redline: 6000, limiter: 6300, inertia: 0.3, na: true,
      torque: [[800, 230], [1500, 390], [3000, 480], [4500, 500], [5500, 440], [6200, 360]], friction: [28, 0.006], turboLag: 0.01 },
    drive: 'rwd', lsd: 0.3, gears: [-3.3, 0, 2.9, 1.78, 1.25, 1.0, 0.8], final: 3.31, eff: 0.9, shiftTime: 0.18, color: 0x23422b, drivable: true,
  }),
  vantage98: variant('berlinette', {
    name: 'Grand Tourer V8 98',
    desc: 'La Vantage suralimentée de 600 ch : un monstre de couple à qui il faut dire non avec le pied droit.',
    mass: 1810, inertia: [2200, 2600, 620], cg: 0.50, wheelbase: 2.61, frontWeight: 0.52, trackF: 1.55, trackR: 1.56,
    dims: dims(4.70, 1.94, 1.33, 2.61, 1.0),
    wheel: { radius: 0.345, width: 0.275, inertia: 1.5 },
    susp: { restLen: 0.30, travel: 0.17, kF: 36000, kR: 40000, cBumpF: 2800, cRebF: 4200, cBumpR: 3000, cRebR: 4400, arbF: 15000, arbR: 9000, bumpK: 240000 },
    steer: { maxAngle: 0.52, ratio: 14, ackermann: 0.8 },
    tyre: { lat: { B: 10.5, C: 1.34, E: -0.3, mu: 1.08 }, lon: { B: 12, C: 1.62, E: 0.05, mu: 1.12 }, loadSens: 0.1, sigmaY: 0.4, sigmaX: 0.18, rollRes: 0.013 },
    aero: { cdA: 0.82, clA_f: 0.05, clA_r: 0.09 },
    brakes: { front: 2800, rear: 1600, hand: 1700, abs: true },
    engine: { idle: 900, redline: 6200, limiter: 6500, inertia: 0.32, na: true,
      torque: [[800, 300], [1500, 520], [2500, 760], [4000, 820], [5000, 770], [6000, 640], [6600, 520]], friction: [30, 0.006], turboLag: 0.01 },
    drive: 'rwd', lsd: 0.4, gears: [-3.4, 0, 3.1, 2.0, 1.45, 1.1, 0.88, 0.7], final: 3.46, eff: 0.9, shiftTime: 0.12, color: 0x1a1a1c, drivable: true,
  }),
  monaro: variant('berlinette', {
    name: 'Classic 327 Coupe',
    desc: 'Coupé australien à V8 de 5,4 L, sage de silhouette, rude de caractère.',
    mass: 1400, inertia: [1800, 2100, 520], cg: 0.52, wheelbase: 2.69, frontWeight: 0.54, trackF: 1.45, trackR: 1.45,
    dims: dims(4.70, 1.78, 1.37, 2.69, 0.98),
    wheel: { radius: 0.33, width: 0.215, inertia: 1.2 },
    susp: { restLen: 0.30, travel: 0.17, kF: 23000, kR: 26000, cBumpF: 1900, cRebF: 3000, cBumpR: 2100, cRebR: 3200, arbF: 8000, arbR: 4500, bumpK: 190000 },
    steer: { maxAngle: 0.50, ratio: 18, ackermann: 0.7 },
    tyre: { lat: { B: 8.5, C: 1.3, E: -0.3, mu: 0.93 }, lon: { B: 10, C: 1.55, E: 0.05, mu: 0.98 }, loadSens: 0.1, sigmaY: 0.5, sigmaX: 0.22, rollRes: 0.014 },
    aero: { cdA: 0.75, clA_f: 0.05, clA_r: 0.07 },
    brakes: { front: 1700, rear: 900, hand: 1200, abs: false },
    engine: { idle: 800, redline: 5800, limiter: 6100, inertia: 0.28, na: true,
      torque: [[800, 160], [1500, 310], [3000, 410], [4200, 435], [5000, 400], [5800, 330]], friction: [26, 0.006], turboLag: 0.01 },
    drive: 'rwd', lsd: 0.1, gears: [-3.0, 0, 2.54, 1.8, 1.4, 1.0], final: 3.36, eff: 0.88, shiftTime: 0.22, color: 0xc6c0b0, drivable: true,
  }),
  x90: variant('hatch', {
    name: 'Touring SUV 90',
    desc: 'SUV familial chinois à moteur 1,5 L turbo : haut, confortable, sous-vireur.',
    mass: 1620, inertia: [2400, 2700, 700], cg: 0.66, wheelbase: 2.75, frontWeight: 0.58, trackF: 1.61, trackR: 1.62,
    dims: dims(4.71, 1.90, 1.70, 2.75, 0.95),
    wheel: { radius: 0.36, width: 0.235, inertia: 1.6 },
    susp: { restLen: 0.36, travel: 0.22, kF: 26000, kR: 24000, cBumpF: 2400, cRebF: 3800, cBumpR: 2200, cRebR: 3600, arbF: 14000, arbR: 9000, bumpK: 200000 },
    steer: { maxAngle: 0.56, ratio: 15.5, ackermann: 0.85 },
    aero: { cdA: 0.95, clA_f: 0.02, clA_r: 0.04 },
    brakes: { front: 2400, rear: 1100, hand: 1500, abs: true },
    engine: { idle: 800, redline: 6000, limiter: 6300, inertia: 0.22,
      torque: [[800, 90], [1500, 220], [1800, 290], [4000, 290], [5200, 255], [6000, 200], [6400, 150]], friction: [20, 0.005], turboLag: 0.5 },
    drive: 'fwd', lsd: 0.1, color: 0x3b4a5c, drivable: true,
  }),
  transit_l2: variant('hatch', {
    name: 'Delivery Van', desc: 'Fourgon de livraison : 2,3 t, haut, lent à mettre en mouvement, rien ne le fait freiner vite.',
    mass: 2300, inertia: [4200, 4800, 1300], cg: 0.82, wheelbase: 3.30, frontWeight: 0.55, trackF: 1.73, trackR: 1.72,
    dims: dims(5.53, 2.06, 2.50, 3.30, 1.0), wheel: { radius: 0.34, width: 0.215, inertia: 1.6 },
    color: 0xf2f2ee, drivable: true,
  }),
  transit_l4: variant('hatch', {
    name: 'Long Cargo Van', desc: 'Grand fourgon de 6,7 m : un camion, au sens des trajectoires.',
    mass: 2700, inertia: [5500, 6500, 1700], cg: 0.9, wheelbase: 3.75, frontWeight: 0.54, trackF: 1.73, trackR: 1.72,
    dims: dims(6.70, 2.06, 2.78, 3.75, 1.0), wheel: { radius: 0.34, width: 0.215, inertia: 1.6 },
    color: 0xe9e9e4, drivable: true,
  }),
  // a 12 m low-floor city bus: rear diesel, automatic, 12 t; the body is the transit bus (render/transit.js)
  citybus: variant('hatch', {
    name: 'Bus urbain 12 m', desc: 'Autobus à plancher bas : 12 t, diesel de 300 ch à l’arrière, boîte automatique. Freinez tôt, tournez large.',
    bus: true, mass: 11800, inertia: [150000, 155000, 16000], cg: 1.05, wheelbase: 5.9, frontWeight: 0.35, trackF: 2.1, trackR: 1.85,
    dims: dims(12.0, 2.55, 3.05, 5.9, 2.7),
    wheel: { radius: 0.5, width: 0.3, inertia: 22 },
    susp: { restLen: 0.3, travel: 0.16, kF: 330000, kR: 520000, cBumpF: 20000, cRebF: 30000, cBumpR: 26000, cRebR: 40000, arbF: 120000, arbR: 90000, bumpK: 3000000 },
    steer: { maxAngle: 0.62, ratio: 20, ackermann: 0.9 },
    tyre: { lat: { B: 7, C: 1.3, E: -0.2, mu: 0.8 }, lon: { B: 9, C: 1.5, E: 0.05, mu: 0.85 }, loadSens: 0.08, sigmaY: 0.7, sigmaX: 0.3, rollRes: 0.008 },
    aero: { cdA: 5.5, clA_f: 0, clA_r: 0 },
    brakes: { front: 26000, rear: 30000, hand: 25000, abs: true },
    engine: { idle: 600, redline: 2200, limiter: 2400, inertia: 2.5, na: false,
      torque: [[500, 700], [1000, 1250], [1300, 1250], [1800, 1050], [2200, 850], [2500, 500]], friction: [120, 0.05], turboLag: 0.6 },
    drive: 'rwd', lsd: 0.1, gears: [-4.2, 0, 3.4, 1.9, 1.4, 1.0, 0.8, 0.68], final: 5.4, eff: 0.88, shiftTime: 0.5, color: 0xf2f4f5, drivable: true,
  }),
};

export const ALL_CARS = { ...CARS, ...EXTRA_CARS, ...FLEET };
export const isDrivable = (k) => ALL_CARS[k] && ALL_CARS[k].drivable !== false;
