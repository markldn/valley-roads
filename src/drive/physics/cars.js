// Vehicle definitions.  Units SI.  Body frame: +x left, +y up, +z forward (right-handed).
// Figures are for plausible road cars of each type; they are not copies of a
// specific manufacturer's data sheet.

const tyreRoad = {
  // Pacejka-style coefficients (lateral uses slip angle in rad, longitudinal slip ratio)
  lat: { B: 10.5, C: 1.32, E: -0.4, mu: 1.04 },
  lon: { B: 12.0, C: 1.62, E: 0.05, mu: 1.10 },
  loadSens: 0.09,      // mu drops 9% per +100% load over nominal
  sigmaY: 0.42,        // relaxation lengths (m)
  sigmaX: 0.18,
  rollRes: 0.012,
};

const tyreSport = {
  lat: { B: 11.5, C: 1.36, E: -0.25, mu: 1.12 },
  lon: { B: 13.5, C: 1.65, E: 0.1, mu: 1.18 },
  loadSens: 0.1, sigmaY: 0.38, sigmaX: 0.16, rollRes: 0.013,
};

export const CARS = {
  hatch: {
    name: 'Rally Hatch R4',
    desc: 'La 206 de rallye à traction : petite, vive, 200 ch, sous-vireuse à la limite.',
    mass: 1325,                          // incl. driver + fuel
    inertia: [1900, 2050, 520],          // pitch (x), yaw (y), roll (z) kg m^2
    cg: 0.52,                            // CG height above ground at rest (m)
    wheelbase: 2.54, frontWeight: 0.61,
    trackF: 1.53, trackR: 1.51,
    dims: { len: 4.05, wid: 1.74, hgt: 1.46, overF: 0.83, overR: 0.68 },
    wheel: { radius: 0.316, width: 0.205, inertia: 1.15 },
    susp: {
      restLen: 0.34, travel: 0.20,
      kF: 32000, kR: 27000,              // wheel rates N/m
      cBumpF: 2500, cRebF: 3800, cBumpR: 2100, cRebR: 3300,
      arbF: 14000, arbR: 17000,          // N/m, couples L/R compression difference
      bumpK: 220000,
    },
    steer: { maxAngle: 0.56, ratio: 14.5, ackermann: 0.9 },
    tyre: tyreRoad,
    aero: { cdA: 0.72, clA_f: 0.03, clA_r: 0.05 },
    brakes: { front: 2300, rear: 950, hand: 1600, abs: true },
    engine: {
      idle: 850, redline: 6500, limiter: 6700, inertia: 0.18,
      // rpm -> torque Nm at full throttle (turbo plateau)
      torque: [[800, 150], [1300, 220], [1700, 300], [4500, 300], [5800, 262], [6500, 222], [6900, 180]],
      friction: [18, 0.0045],            // Nm: a + b*rpm engine braking at closed throttle
      turboLag: 0.35,
    },
    drive: 'fwd', lsd: 0.25,
    gears: [-3.25, 0, 3.42, 2.14, 1.45, 1.09, 0.87, 0.73], final: 3.94, eff: 0.91,
    shiftTime: 0.16,
    color: 0xb3121b,
  },
  berlinette: {
    name: 'Classic V12 Sprint',
    desc: 'Berlinette à moteur central arrière et propulsion. Agile, exige du doigté.',
    mass: 1180,
    inertia: [1500, 1700, 420],
    cg: 0.45, wheelbase: 2.42, frontWeight: 0.44,
    trackF: 1.56, trackR: 1.55,
    dims: { len: 4.18, wid: 1.80, hgt: 1.25, overF: 0.92, overR: 0.84 },
    wheel: { radius: 0.322, width: 0.235, inertia: 1.2 },
    susp: {
      restLen: 0.30, travel: 0.17,
      kF: 36000, kR: 42000,
      cBumpF: 2400, cRebF: 3600, cBumpR: 2800, cRebR: 4200,
      arbF: 18000, arbR: 9000, bumpK: 240000,
    },
    steer: { maxAngle: 0.52, ratio: 13.0, ackermann: 0.8 },
    tyre: tyreSport,
    aero: { cdA: 0.66, clA_f: 0.08, clA_r: 0.14 },
    brakes: { front: 2400, rear: 1500, hand: 1800, abs: true },
    engine: {
      idle: 900, redline: 6800, limiter: 7000, inertia: 0.16,
      torque: [[800, 170], [1300, 260], [2000, 320], [5200, 320], [6200, 300], [6800, 270], [7100, 220]],
      friction: [20, 0.005], turboLag: 0.3,
    },
    drive: 'rwd', lsd: 0.45,
    gears: [-3.1, 0, 3.17, 2.05, 1.48, 1.14, 0.92, 0.77], final: 4.21, eff: 0.92,
    shiftTime: 0.09,
    color: 0x1d4e9e,
  },
  rallye: {
    name: 'Rally Coupe 37',
    desc: 'Quatre roues motrices de rallye, 300 ch. Motricité partout, même mouillé.',
    mass: 1450,
    inertia: [2100, 2250, 560],
    cg: 0.56, wheelbase: 2.60, frontWeight: 0.58,
    trackF: 1.55, trackR: 1.55,
    dims: { len: 4.35, wid: 1.80, hgt: 1.45, overF: 0.92, overR: 0.83 },
    wheel: { radius: 0.33, width: 0.235, inertia: 1.3 },
    susp: {
      restLen: 0.40, travel: 0.25,
      kF: 30000, kR: 30000,
      cBumpF: 2700, cRebF: 4000, cBumpR: 2600, cRebR: 3900,
      arbF: 12000, arbR: 10000, bumpK: 220000,
    },
    steer: { maxAngle: 0.58, ratio: 12.5, ackermann: 0.85 },
    tyre: { ...tyreRoad, lat: { B: 10, C: 1.32, E: -0.5, mu: 1.07 }, lon: { B: 11.5, C: 1.6, E: 0.0, mu: 1.12 } },
    aero: { cdA: 0.80, clA_f: 0.05, clA_r: 0.08 },
    brakes: { front: 2600, rear: 1400, hand: 2600, abs: true },
    engine: {
      idle: 900, redline: 6800, limiter: 7000, inertia: 0.2,
      torque: [[800, 180], [1400, 260], [2500, 400], [4500, 400], [6000, 345], [6800, 300], [7100, 240]],
      friction: [22, 0.005], turboLag: 0.45,
    },
    drive: 'awd', lsd: 0.4, awdFront: 0.45,
    gears: [-3.3, 0, 3.2, 2.13, 1.6, 1.25, 1.0, 0.82], final: 4.11, eff: 0.88,
    shiftTime: 0.12,
    color: 0xf2f2ee,
  },
};
