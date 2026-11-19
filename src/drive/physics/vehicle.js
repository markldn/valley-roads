// Vehicle dynamics, independent of rendering (runs headless in Node for tests).
//
// Rigid body (6 DOF, full inertia) + 4 suspension/tyre corners:
//  - wheel-disc vs ground contact (multi-sample, so kerbs are climbed, not teleported)
//  - spring + bump/rebound damper + bump stop + anti-roll bars
//  - tyre: transient deflection states (relaxation length) -> equivalent slip,
//    Pacejka magic formula, combined slip by the similarity method (friction
//    ellipse), load sensitivity, surface friction
//  - engine torque map with turbo lag, viscous auto-clutch, gearbox, open/LSD/AWD diff
//  - brakes with ABS, traction control, aero drag + downforce, rolling resistance
// World interface: world.height(x, z, yHint) -> metres, world.surface(x, z) -> {mu, rough, id}
// Coordinates: world x east, y up, z south (three.js); body frame (x, y, z) = (left, up, forward),
// right-handed.  Driver input steer is +1 = full RIGHT lock; internally steerAngle > 0 turns left.

const G = 9.81, RHO = 1.2;

function interp(table, x) {
  if (x <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) {
    if (x <= table[i][0]) {
      const [x0, y0] = table[i - 1], [x1, y1] = table[i];
      return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
    }
  }
  return table[table.length - 1][1];
}

function mf(B, C, E, x) {
  const bx = B * x;
  return Math.sin(C * Math.atan(bx - E * (bx - Math.atan(bx))));
}

// peak position of the normalised magic formula, found numerically once
function mfPeak(B, C, E) {
  let best = 0, bx = 0;
  for (let x = 0.001; x < 1.5; x += 0.0005) {
    const y = mf(B, C, E, x);
    if (y > best) { best = y; bx = x; }
  }
  return bx;
}

// --- tiny quaternion / vector helpers on plain arrays -----------------------
function qRotate(q, v, out) {
  const [x, y, z, w] = q;
  const ix = w * v[0] + y * v[2] - z * v[1];
  const iy = w * v[1] + z * v[0] - x * v[2];
  const iz = w * v[2] + x * v[1] - y * v[0];
  const iw = -x * v[0] - y * v[1] - z * v[2];
  out[0] = ix * w + iw * -x + iy * -z - iz * -y;
  out[1] = iy * w + iw * -y + iz * -x - ix * -z;
  out[2] = iz * w + iw * -z + ix * -y - iy * -x;
  return out;
}
function qInvRotate(q, v, out) { return qRotate([-q[0], -q[1], -q[2], q[3]], v, out); }
function cross(a, b, out) {
  const x = a[1] * b[2] - a[2] * b[1], y = a[2] * b[0] - a[0] * b[2], z = a[0] * b[1] - a[1] * b[0];
  out[0] = x; out[1] = y; out[2] = z; return out;
}
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function norm(a) { const l = Math.hypot(a[0], a[1], a[2]) || 1; a[0] /= l; a[1] /= l; a[2] /= l; return a; }
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

export class Vehicle {
  constructor(spec, world) {
    this.spec = spec;
    this.world = world;
    this.p = [0, 0, 0];
    this.q = [0, 0, 0, 1];
    this.v = [0, 0, 0];
    this.w = [0, 0, 0];
    this.input = { throttle: 0, brake: 0, steer: 0, handbrake: 0, clutch: 0, shiftUp: false, shiftDown: false };
    this.aids = { abs: spec.brakes.abs, tc: true, autoGear: true };
    this.gear = 2; // index into spec.gears: 0 = R, 1 = N, 2 = 1st
    this.shiftTimer = 0;
    this.pendingGear = null;
    this.engineW = spec.engine.idle * Math.PI / 30;
    this.boost = 0;
    this.clutchEng = 1;
    this.rpm = spec.engine.idle;
    this.steerAngle = 0;
    this.time = 0;
    this.odometer = 0;
    this.contactsBody = 0;
    this.airTime = 0;
    this.groundDamageCooldown = 0;
    this.impact = 0;          // peak collision impulse this frame (for audio/damage)
    this.damage = { engine: 0, toe: 0, total: 0 };
    this.revCut = false;
    this.tc = 0; this.absActive = 0;

    const s = spec, L = s.wheelbase;
    const a = L * (1 - s.frontWeight), b = L * s.frontWeight; // CG to front / rear axle
    const W = s.mass * G;
    const loadF = W * s.frontWeight / 2, loadR = W * (1 - s.frontWeight) / 2;
    this.wheels = [];
    const mk = (side, front) => {
      const k = front ? s.susp.kF : s.susp.kR;
      const load = front ? loadF : loadR;
      const xs = load / k;
      const R = s.wheel.radius;
      const hp = [side * (front ? s.trackF : s.trackR) / 2, -s.cg + R + s.susp.restLen - xs, front ? a : -b];
      return {
        front, side, hp, mountHome: hp.slice(), k, load0: load, R,
        cBump: front ? s.susp.cBumpF : s.susp.cBumpR,
        cReb: front ? s.susp.cRebF : s.susp.cRebR,
        x: xs, xPrev: xs, xdot: 0, Fz: load,
        omega: 0, yd: 0, xd: 0, slipRatio: 0, slipAngle: 0, Fx: 0, Fy: 0,
        grounded: true, surf: 0, mu: 1, rough: 0, steer: 0, driveT: 0, brakeT: 0,
        contact: [0, 0, 0], normal: [0, 1, 0], spinAngle: 0, skid: 0, center: [0, 0, 0],
        rcH: front ? 0.07 : 0.11, locked: false, temp: 55,
      };
    };
    this.wheels.push(mk(-1, true), mk(1, true), mk(-1, false), mk(1, false));
    const t = s.tyre;
    this.pk = {
      lat: Math.atan(mfPeak(t.lat.B, t.lat.C, t.lat.E)),   // slip angle (rad) at peak
      lon: mfPeak(t.lon.B, t.lon.C, t.lon.E),              // slip ratio at peak
    };
    this.tmp = { a: [0, 0, 0], b: [0, 0, 0], c: [0, 0, 0], d: [0, 0, 0] };
    this.Fsum = [0, 0, 0];
    this.Tsum = [0, 0, 0];
    this.accel = [0, 0, 0];
    this.vPrev = [0, 0, 0];
    this.torqueCurveMax = Math.max(...spec.engine.torque.map((r) => r[1]));
  }

  // place the car at rest on the ground at (x, z) heading `yaw` (radians, 0 = facing -z/north)
  reset(x, z, yaw) {
    const h = this.world.height(x, z, 1e9);
    // body forward (+z body) must point to world direction (sin(yaw)*?, ...): yaw 0 -> north (-z)
    const half = (Math.PI - yaw) / 2; // rotate +z body to -z world when yaw = 0
    this.q = [0, Math.sin(half), 0, Math.cos(half)];
    this.p = [x, h + this.spec.cg + 0.02, z];
    this.v = [0, 0, 0];
    this.w = [0, 0, 0];
    this.airTime = this.groundDamageCooldown = 0;
    this.flood = 0; this.drowned = false; this.submerged = 0;
    for (const wh of this.wheels) { wh.omega = 0; wh.yd = 0; wh.xd = 0; wh.x = wh.load0 / wh.k; wh.xPrev = wh.x; }
    this.gear = 2;
    this.engineW = this.spec.engine.idle * Math.PI / 30;
    this.shiftTimer = 0; this.pendingGear = null;
  }

  get speed() { return Math.hypot(this.v[0], this.v[1], this.v[2]); }
  get forward() { return qRotate(this.q, [0, 0, 1], [0, 0, 0]); }
  get up() { return qRotate(this.q, [0, 1, 0], [0, 0, 0]); }
  get right() { return qRotate(this.q, [1, 0, 0], [0, 0, 0]); }
  get yaw() { const f = this.forward; return Math.atan2(f[0], -f[2]); }
  forwardSpeed() { return dot(this.v, this.forward); }

  gearRatio() { return this.spec.gears[this.gear] * this.spec.final; }
  gearLabel() { return this.gear === 0 ? 'R' : this.gear === 1 ? 'N' : String(this.gear - 1); }

  requestGear(g) {
    g = clamp(g, 0, this.spec.gears.length - 1);
    if (g === this.gear || this.pendingGear !== null) return;
    this.pendingGear = g;
    this.shiftTimer = this.spec.shiftTime;
  }

  step(dt) {
    const s = this.spec, inp = this.input, eng = s.engine;
    this.time += dt;
    if (this.ghostT > 0) this.ghostT -= dt;
    const R = this.q;
    const up = qRotate(R, [0, 1, 0], [0, 0, 0]);
    const fwdB = qRotate(R, [0, 0, 1], [0, 0, 0]);
    const vF = dot(this.v, fwdB);
    const speed = this.speed;

    // ---------------- driver aids / gear logic ------------------------------
    let throttle = clamp(inp.throttle, 0, 1), brake = clamp(inp.brake, 0, 1);
    if (this.wrecked || this.drowned || this.fuel <= 0) throttle = 0;   // destroyed cell / engine / running gear: it rolls to a stop
    if (this.aids.autoGear) {
      // arcade-style reverse: brake held at standstill selects R, throttle selects 1st
      // brake held while truly stationary selects reverse; throttle selects 1st
      // unless the car is already reversing quickly (then it brakes first)
      if (this.gear >= 2 && Math.abs(vF) < 0.3 && brake > 0.5 && throttle < 0.05 && !inp.handbrake) this._revHold = (this._revHold || 0) + dt;
      else this._revHold = 0;
      if (this._revHold > 0.6) { this.gear = 0; this._revHold = 0; }
      if (this.gear === 0) {
        if (throttle > 0.05 && vF > -2.5) { this.gear = 2; }
        else { const t = throttle; throttle = brake; brake = t; }
      }
      if (this.gear >= 2 && this.pendingGear === null) {
        const rpm = this.rpm;
        const top = s.gears.length - 1;
        const slip = Math.max(...this.wheels.map((w) => (w.driven && !w.broken ? w.slipRatio : 0)));
        // Wheelspin can delay a shift at low road speed, but it must not hold
        // the engine on the limiter once the next ratio can carry the load.
        const roadRPM = Math.abs(vF) * Math.abs(this.gearRatio()) / s.wheel.radius * 30 / Math.PI;
        this.shiftHold = Math.max(0, (this.shiftHold || 0) - dt);
        // Part throttle changes up early, as a driver or a gearbox controller would.
        const upAt = eng.redline * (.56 + .425 * Math.min(1, throttle * 1.15));
        if (roadRPM > upAt && rpm > upAt * .97 && this.gear < top && !this.shiftHold &&
          (slip < .3 || roadRPM > eng.redline * .8)) { this.requestGear(this.gear + 1); this.shiftHold = 1.1; }
        else if (this.gear > 2 && !this.shiftHold) {
          const lower = s.gears[this.gear - 1] / s.gears[this.gear];
          // Kick down only when the lower ratio lands well below the point where it would shift up again.
          const down = throttle > 0.6 ? eng.redline * 0.46 : (brake > 0.2 ? 2300 : 1350);
          if (roadRPM < down && roadRPM * lower < eng.redline * 0.8) { this.requestGear(this.gear - 1); this.shiftHold = .9; }
        }
      }
    } else {
      if (inp.shiftUp) { this.requestGear(this.gear + 1); inp.shiftUp = false; }
      if (inp.shiftDown) { this.requestGear(this.gear - 1); inp.shiftDown = false; }
    }
    if (this.pendingGear !== null) {
      this.shiftTimer -= dt;
      if (this.shiftTimer <= 0) { this.gear = this.pendingGear; this.pendingGear = null; }
    }
    const shifting = this.pendingGear !== null;

    // ---------------- steering ---------------------------------------------
    const target = -clamp(inp.steer, -1, 1) * s.steer.maxAngle;
    this.steerAngle = target + (this.damage.toe || 0); // bent steering arm pulls to one side
    const L = s.wheelbase, track = s.trackF;
    const wheelDmg = this.damage.wheel;
    this.wheels.forEach((w, i) => { w.toeDmg = wheelDmg ? (wheelDmg[i] || 0) * 0.12 * (w.hp[0] > 0 ? 1 : -1) : 0; });
    for (const w of this.wheels) {
      if (!w.front) { w.steer = w.toeDmg; continue; }
      const d = this.steerAngle;
      if (Math.abs(d) < 1e-4) { w.steer = w.toeDmg; continue; }
      // Ackermann: inner wheel turns more
      const r = L / Math.tan(Math.abs(d));
      const inner = Math.atan(L / (r - track / 2)), outer = Math.atan(L / (r + track / 2));
      const isInner = (d > 0) === (w.side > 0);
      const ack = s.steer.ackermann;
      const ang = isInner ? inner * ack + Math.abs(d) * (1 - ack) : outer * ack + Math.abs(d) * (1 - ack);
      w.steer = Math.sign(d) * ang + w.toeDmg;
    }

    // ---------------- engine + clutch --------------------------------------
    const G_ = this.gearRatio();
    const driven = this.wheels.filter((w) => w.driven && !w.broken);
    let wd = 0;
    for (const w of driven) wd += w.omega;
    wd /= driven.length || 1;
    const rpm = this.engineW * 30 / Math.PI;
    this.revCut = rpm > eng.limiter;
    // traction control: trim throttle while driven wheels exceed the slip peak
    let thEff = throttle;
    if (this.aids.tc && !shifting) {
      const slip = Math.max(...driven.map((w) => w.slipRatio));
      // Loose ground needs more wheel slip to bite than tarmac does.
      const loose = Math.max(...driven.map((w) => w.drag || 0)) > .02;
      const lim = this.pk.lon * (loose ? 4.5 : 1.6);
      if (slip > lim && Math.abs(wd * s.wheel.radius - vF) > 2.4) { this.tc = Math.min(1, this.tc + dt * 8 * Math.min(4, slip / lim)); }
      else this.tc = Math.max(0, this.tc - dt * 3);
      // At walking pace, cutting most of the engine torque can strand a car
      // with one driven wheel on a kerb and the other on grass.
      const crawl = clamp((Math.abs(vF) - 1.5) / 3.5, 0, 1);
      const maxCut = .40 + .45 * crawl * crawl * (3 - 2 * crawl);
      thEff *= 1 - maxCut * this.tc;
    }
    if (this.revCut || shifting) thEff = 0;
    this.boost += ((thEff > 0.3 ? thEff : 0) - this.boost) * Math.min(1, dt / eng.turboLag);
    const boostF = rpm < 1300 || eng.na ? 1 : 0.62 + 0.38 * this.boost;
    const fric = eng.friction[0] + eng.friction[1] * rpm;
    const Tfull = interp(eng.torque, rpm) * boostF * (this.tuneT || 1) * (1 - 0.25 * Math.min(1, this.damage.engine || 0))   // a wrecked car limps, it does not stop;
    let Te = thEff * Tfull - (1 - thEff) * fric;
    if (rpm < eng.idle) Te = Math.max(Te, (eng.idle - rpm) * 0.35 + 20); // idle governor
    // clutch engagement: open in neutral / mid-shift, slips for launch and near stall
    let eng_ = 1;
    if (this.gear === 1 || shifting) eng_ = 0;
    else {
      // signed gearbox-input speed: rolling backwards in a forward gear (or
      // forwards in reverse) is a launch situation, not an engaged clutch
      const wheelRpm = wd * G_ * Math.sign(G_) * 30 / Math.PI * Math.sign(G_);
      // A driver holds the revs up on the clutch until the road speed has caught up with the engine,
      // instead of dropping it and bogging down below the torque band.
      const launch = eng.idle + Math.min(3400, eng.redline * .55) * Math.min(1, throttle * 1.25);
      if (wheelRpm < launch) {
        const bite = eng.idle * 1.2;
        eng_ = clamp((rpm - bite) / Math.max(300, launch - bite), 0, 1) * clamp(throttle * 3, 0.0, 1);
        if (throttle < 0.05) eng_ = wheelRpm < eng.idle * 1.05 ? 0 : 1;
      }
    }
    eng_ = clamp(eng_ + inp.clutch * -1, 0, 1);
    this.clutchEng = eng_;
    const Tcmax = this.torqueCurveMax * 1.7 * eng_;
    // Implicit clutch: the torque that makes engine and gearbox input speeds equal
    // after this step (using last step's tyre torques), clamped to the clutch
    // capacity - beyond that the clutch slips.  An explicit viscous coupling is
    // unstable here because the driveline inertia is reflected through G^2 ~ 180.
    let Tc = 0;
    if (Tcmax > 0 && Math.abs(G_) > 1e-6) {
      let Iw = 0, Tt = 0;
      for (const w of driven) { Iw += this.spec.wheel.inertia; Tt += -w.Fx * w.R; }
      const a = dt / eng.inertia + G_ * G_ * s.eff * dt / Iw;
      const b = (this.engineW - G_ * wd) + dt * Te / eng.inertia - G_ * dt * Tt / Iw;
      Tc = clamp(b / a, -Tcmax, Tcmax);
    }
    // Petrol holds about 34 MJ per litre and an engine turns roughly 30% of it into work.
    // Distances in this region are compressed, so consumption is scaled to match.
    if (this.fuel > 0) this.fuel = Math.max(0, this.fuel - dt * 9 * (Math.max(0, thEff * Tfull * this.engineW) / (.3 * 34e6) + .00022));
    this.engineW += (Te - Tc) * dt / eng.inertia;
    this.engineW = Math.max(this.engineW, eng.idle * 0.5 * Math.PI / 30);
    this.rpm = this.engineW * 30 / Math.PI;
    // torque to the axles through the diff(s)
    const Tdrive = Tc * G_ * s.eff;
    for (const w of this.wheels) w.driveT = 0;
    const split = (pair, T, lsd) => {
      const [l, r] = pair;
      if(l.broken || r.broken){
        if(l.broken!==r.broken) (l.broken?r:l).driveT+=T*lsd*.5;
        return;
      }
      // viscous/torque-biasing LSD: move torque from the faster to the slower wheel
      const bias = clamp((l.omega - r.omega) * 40 * lsd, -Math.abs(T) * lsd, Math.abs(T) * lsd);
      l.driveT += T / 2 - bias / 2;
      r.driveT += T / 2 + bias / 2;
    };
    const [FL, FR, RL, RR] = this.wheels;
    if (s.drive === 'fwd') split([FL, FR], Tdrive, s.lsd);
    else if (s.drive === 'rwd') split([RL, RR], Tdrive, s.lsd);
    else {
      const fF = s.awdFront ?? 0.5;
      const front = (FL.omega + FR.omega) / 2, rear = (RL.omega + RR.omega) / 2;
      const cbias = clamp((front - rear) * 30, -Math.abs(Tdrive) * 0.3, Math.abs(Tdrive) * 0.3);
      split([FL, FR], Tdrive * fF - cbias / 2, s.lsd);
      split([RL, RR], Tdrive * (1 - fF) + cbias / 2, s.lsd);
    }

    // ---------------- suspension + tyres ----------------------------------
    const F = this.Fsum, T = this.Tsum;
    F[0] = 0; F[1] = -s.mass * G; F[2] = 0;
    T[0] = 0; T[1] = 0; T[2] = 0;
    const tmp = this.tmp;
    const hpW = [0, 0, 0], c = [0, 0, 0], r = [0, 0, 0], vP = [0, 0, 0], fw = [0, 0, 0], sd = [0, 0, 0], frc = [0, 0, 0];
    const world = this.world;
    for (const w of this.wheels) {
      qRotate(R, w.hp, hpW);
      hpW[0] += this.p[0]; hpW[1] += this.p[1]; hpW[2] += this.p[2];
      // wheel heading in world
      qRotate(R, [Math.sin(w.steer), 0, Math.cos(w.steer)], fw);
      const fh = Math.hypot(fw[0], fw[2]) || 1;
      const fx = fw[0] / fh, fz = fw[2] / fh;
      // find suspension length so that the wheel disc rests on the ground.
      // The disc test runs on the height *relative to the local slope*, so only
      // real steps (kerbs, potholes) move the contact point off-centre.
      let len = s.susp.restLen, gh = 0, dBest = 0, centerHeight = 0;
      for (let it = 0; it < 2; it++) {
        c[0] = hpW[0] - up[0] * len; c[1] = hpW[1] - up[1] * len; c[2] = hpW[2] - up[2] * len;
        const e = 0.6;
        centerHeight = world.height(c[0],c[2],c[1]);
        const slope = stepSafeGrad(world.height(c[0]-fx*e,c[2]-fz*e,c[1]),centerHeight,
          world.height(c[0]+fx*e,c[2]+fz*e,c[1]),e);
        let rel = -1e9;
        dBest = 0;
        for (let k = -2; k <= 2; k++) {
          const d = k * 0.11 * w.R / 0.32;
          const r = k===0 ? centerHeight : world.height(c[0]+fx*d,c[2]+fz*d,c[1])-slope*d-(w.R-Math.sqrt(w.R*w.R-d*d));
          if (r > rel + 0.004) { rel = r; dBest = d; }
        }
        gh = rel; // support height under the centre, measured along the slope
        len = (hpW[1] - (gh + w.R)) / Math.max(up[1], 0.2);
      }
      let x = s.susp.restLen - len;
      w.grounded = x > 0 && up[1] > .2 && !w.broken;   // a torn-off wheel carries nothing: that corner drags on the body
      const lc = clamp(len, s.susp.restLen - s.susp.travel, s.susp.restLen);
      w.center[0] = hpW[0] - up[0] * lc; w.center[1] = hpW[1] - up[1] * lc; w.center[2] = hpW[2] - up[2] * lc;
      if (!w.grounded) {
        w.x = 0; w.xdot = 0; w.xPrev = 0; w.Fz = 0; w.Fx = 0; w.Fy = 0;
        w.xd *= 0.9; w.yd *= 0.9;
        w.omega += dt * (w.driveT) / s.wheel.inertia;
        const bt = this._brakeTorque(w, brake, inp.handbrake);
        const dw = dt * bt / s.wheel.inertia;
        w.omega = Math.abs(w.omega) <= dw ? 0 : w.omega - Math.sign(w.omega) * dw;
        w.skid = 0;
        continue;
      }
      // ground normal: the terrain slope, tilted towards the wheel centre when the
      // support is a step edge (kerb) ahead of or behind the contact patch
      const n = w.normal;
      {
        const e = 0.5, cx = c[0], cz = c[2];
        const hx1 = world.height(cx + e, cz, c[1]), hx0 = world.height(cx - e, cz, c[1]);
        const hz1 = world.height(cx, cz + e, c[1]), hz0 = world.height(cx, cz - e, c[1]);
        const hc = centerHeight;
        n[0] = -stepSafeGrad(hx0, hc, hx1, e); n[1] = 1; n[2] = -stepSafeGrad(hz0, hc, hz1, e);
        // never lean the contact normal beyond ~60 degrees: a cliff is not a wall the tyre can push off
        const tl = Math.hypot(n[0], n[2]);
        if (tl > 1.7) { n[0] *= 1.7 / tl; n[2] *= 1.7 / tl; }
        norm(n);
        if (Math.abs(dBest) > 0.01) {
          const vert = Math.sqrt(w.R * w.R - dBest * dBest);
          const t = [-fx * dBest, vert, -fz * dBest];
          norm(t);
          n[0] = n[0] * 0.3 + t[0] * 0.7; n[1] = n[1] * 0.3 + t[1] * 0.7; n[2] = n[2] * 0.3 + t[2] * 0.7;
          norm(n);
        }
      }
      const surf = world.surface(c[0], c[2], c[1]);
      w.surf = surf.id; w.mu = surf.mu; w.rough = surf.rough; w.drag = surf.drag || 0;
      // bump stop + spring + damper
      const travel = s.susp.travel;
      x = Math.min(x, travel + .12);
      const bump = s.susp.bumpK * Math.max(0, x - travel);   // bounded: a bottomed-out wheel hits the chassis, it does not become a catapult
      w.x = x;
      w.xdot = clamp((x - w.xPrev) / dt,-3.4,5);
      w.xPrev = x;
      w.Fs = w.k * Math.min(x, travel + 0.05) + (w.xdot > 0 ? w.cBump : w.cReb) * w.xdot + bump;
    }
    // anti-roll bars
    const arb = (l, r_, k) => {
      if (!l.grounded && !r_.grounded) return;
      const f = k * ((l.grounded ? l.x : 0) - (r_.grounded ? r_.x : 0));
      if (l.grounded) l.Fs += f;
      if (r_.grounded) r_.Fs -= f;
    };
    arb(FL, FR, s.susp.arbF);
    arb(RL, RR, s.susp.arbR);

    this._water(dt);

    // aero
    const vv = speed;
    F[0] -= 0.5 * RHO * s.aero.cdA * vv * this.v[0];
    F[1] -= 0.5 * RHO * s.aero.cdA * vv * this.v[1];
    F[2] -= 0.5 * RHO * s.aero.cdA * vv * this.v[2];
    const q2 = 0.5 * RHO * vF * vF;
    for (const [axle, cl] of [[FL.hp[2], s.aero.clA_f], [RL.hp[2], s.aero.clA_r]]) {
      const Fd = q2 * cl;
      qRotate(R, [0, -s.cg + 0.3, axle], r);
      this._applyAt(r, [-up[0] * Fd, -up[1] * Fd, -up[2] * Fd]);
    }

    this.absActive = 0;
    let skidMax = 0;
    for (const w of this.wheels) {
      if (!w.grounded) continue;
      const n = w.normal;
      const Fs = Math.max(0, w.Fs);
      w.Fz = Fs;
      // contact point and its velocity
      const cp = w.contact;
      cp[0] = w.center[0] - n[0] * w.R; cp[1] = w.center[1] - n[1] * w.R; cp[2] = w.center[2] - n[2] * w.R;
      r[0] = cp[0] - this.p[0]; r[1] = cp[1] - this.p[1]; r[2] = cp[2] - this.p[2];
      cross(this.w, r, vP);
      vP[0] += this.v[0]; vP[1] += this.v[1]; vP[2] += this.v[2];
      qRotate(R, [Math.sin(w.steer), 0, Math.cos(w.steer)], fw);
      const fn = dot(fw, n);
      fw[0] -= n[0] * fn; fw[1] -= n[1] * fn; fw[2] -= n[2] * fn;
      norm(fw);
      cross(n, fw, sd); // side axis (+right)
      const vx = dot(vP, fw), vy = dot(vP, sd);
      const avx = Math.abs(vx);
      // tyre deflection (relaxation length) states, integrated implicitly
      const t = s.tyre;
      w.yd = (w.yd + dt * vy) / (1 + dt * avx / t.sigmaY);
      w.yd = clamp(w.yd, -t.sigmaY * 3, t.sigmaY * 3);
      const vs = w.omega * w.R - vx;
      w.xd = (w.xd + dt * vs) / (1 + dt * avx / t.sigmaX);
      w.xd = clamp(w.xd, -t.sigmaX * 1.5, t.sigmaX * 1.5);
      const alpha = Math.atan(w.yd / t.sigmaY);
      const kappa = w.xd / t.sigmaX;
      w.slipAngle = alpha;
      w.slipRatio = avx > 0.5 ? vs / avx : kappa;
      // combined slip, similarity method
      const sx = kappa / this.pk.lon, sy = Math.tan(alpha) / Math.tan(this.pk.lat);
      const sn = Math.hypot(sx, sy);
      const muLoad = 1 - t.loadSens * (Fs / w.load0 - 1);
      // tyre temperature: grip peaks around 90 C, cold or overheated rubber gives less
      const tg = clamp(1 - 0.00006 * (w.temp - 90) * (w.temp - 90), 0.86, 1.0);
      const muS = w.mu * clamp(muLoad, 0.7, 1.25) * tg * (this.tuneGrip || 1);   // tuneT / tuneGrip: garage upgrades and nitro (src/events)
      let Fx = 0, Fy = 0;
      if (sn > 1e-6) {
        const shear = mf(t.lon.B, t.lon.C, t.lon.E, sn * this.pk.lon);
        const fLon = t.lon.mu * muS * Fs * (w.drag > .02 && sn > 1 ? Math.max(shear, .95) : shear);
        const fLat = t.lat.mu * muS * Fs * mf(t.lat.B, t.lat.C, t.lat.E, sn * this.pk.lat);
        Fx = fLon * sx / sn;
        Fy = -fLat * sy / sn;
      }
      // low-speed damping so a parked car does not jitter
      const ls = clamp(1 - avx / 2.5, 0, 1);
      if (ls > 0) {
        Fy -= ls * clamp(vy * 2.0, -1, 1) * 0.4 * muS * Fs;
      }
      w.Fx = Fx; w.Fy = Fy;
      // heat: sliding power in the contact patch + carcass flexing; cooling grows with speed
      const slidePow = Math.abs(Fx * vs) + Math.abs(Fy * vy) + 0.012 * Fs * avx;
      const amb = this.ambient ?? 15;
      w.temp += dt * (slidePow / 3300 - (w.temp - amb) * (0.012 + 0.0016 * avx) * (1 + 2 * (this.world.wet || 0)));
      w.skid = Math.max(0, Math.hypot(sx, sy) - 0.8);
      skidMax = Math.max(skidMax, w.skid);
      // apply suspension (body up at hardpoint) and tyre forces (at roll-centre height)
      const Fsus = [up[0] * Fs, up[1] * Fs, up[2] * Fs];
      qRotate(R, w.hp, r);
      this._applyAt(r, Fsus);
      frc[0] = fw[0] * Fx + sd[0] * Fy;
      frc[1] = fw[1] * Fx + sd[1] * Fy;
      frc[2] = fw[2] * Fx + sd[2] * Fy;
      r[0] = cp[0] - this.p[0] + up[0] * w.rcH;
      r[1] = cp[1] - this.p[1] + up[1] * w.rcH;
      r[2] = cp[2] - this.p[2] + up[2] * w.rcH;
      this._applyAt(r, frc);
      // rolling resistance
      const rr = (t.rollRes * (1 + 2 * w.rough) + w.drag * (1 + Math.min(.8, Math.abs(vx) / 25))) * Fs * clamp(vx / 0.5, -1, 1);
      F[0] -= fw[0] * rr; F[1] -= fw[1] * rr; F[2] -= fw[2] * rr;
      // wheel spin
      w.omega += dt * (w.driveT - Fx * w.R) / s.wheel.inertia;
      let bt = this._brakeTorque(w, brake, inp.handbrake);
      if (this.aids.abs && bt > 0 && w.slipRatio < -this.pk.lon * 1.3 && avx > 3) {
        bt *= 0.35; this.absActive = 1;
      }
      const dw = dt * bt / s.wheel.inertia;
      if (Math.abs(w.omega) <= dw) { w.omega = 0; w.locked = bt > 0 && avx > 0.5; }
      else { w.omega -= Math.sign(w.omega) * dw; w.locked = false; }
      w.brakeT = bt;
    }
    this.skid = skidMax;

    // ---------------- body contacts (rollover, bottoming) ------------------
    this._bodyGround(dt);
    const support=this.wheels.filter(wheel=>wheel.grounded);
    this.groundDamageCooldown=Math.max(0,this.groundDamageCooldown-dt);
    if(!support.length && !this.contactsBody){
      this.airTime+=dt;
      if(this.airTime>.055){
        const damping=Math.exp(-dt*1.3);
        this.w[0]*=damping;
        this.w[2]*=damping;
      }
    } else {
      if(this.airTime>.095 && support.length){
        const wheel=support[0], n=wheel.normal;
        const closing=-(this.v[0]*n[0]+this.v[1]*n[1]+this.v[2]*n[2]);
        if(this.v[1]<-2.5 && closing>3.15) this._groundImpact(wheel.contact,closing);
      }
      this.airTime=0;
    }

    // ---------------- integrate --------------------------------------------
    const im = 1 / s.mass;
    this.vPrev[0] = this.v[0]; this.vPrev[1] = this.v[1]; this.vPrev[2] = this.v[2];
    this.v[0] += F[0] * im * dt; this.v[1] += F[1] * im * dt; this.v[2] += F[2] * im * dt;
    // angular: body frame with gyroscopic term
    const wb = qInvRotate(R, this.w, tmp.a);
    const tb = qInvRotate(R, T, tmp.b);
    const I = s.inertia;
    const Iw = [I[0] * wb[0], I[1] * wb[1], I[2] * wb[2]];
    const gyro = cross(wb, Iw, tmp.c);
    wb[0] += (tb[0] - gyro[0]) / I[0] * dt;
    wb[1] += (tb[1] - gyro[1]) / I[1] * dt;
    wb[2] += (tb[2] - gyro[2]) / I[2] * dt;
    qRotate(R, wb, this.w);
    // runaway guard: nothing a road car does produces these; clamp rather than let one bad contact catapult it
    const vm = Math.hypot(this.v[0], this.v[1], this.v[2]);
    if (vm > 110) { const k = 110 / vm; this.v[0] *= k; this.v[1] *= k; this.v[2] *= k; }
    const wm = Math.hypot(this.w[0], this.w[1], this.w[2]);
    if (wm > 18) { const k = 18 / wm; this.w[0] *= k; this.w[1] *= k; this.w[2] *= k; }
    this.p[0] += this.v[0] * dt; this.p[1] += this.v[1] * dt; this.p[2] += this.v[2] * dt;
    // quaternion integration
    const [qx, qy, qz, qw] = this.q, [wx, wy, wz] = this.w;
    const h = dt * 0.5;
    this.q = [qx + h * (wx * qw + wy * qz - wz * qy), qy + h * (wy * qw + wz * qx - wx * qz),
      qz + h * (wz * qw + wx * qy - wy * qx), qw + h * (-wx * qx - wy * qy - wz * qz)];
    const ql = Math.hypot(...this.q);
    this.q = this.q.map((x) => x / ql);
    for (const w of this.wheels) w.spinAngle += w.omega * dt;
    this.accel[0] = (this.v[0] - this.vPrev[0]) / dt;
    this.accel[1] = (this.v[1] - this.vPrev[1]) / dt + G;
    this.accel[2] = (this.v[2] - this.vPrev[2]) / dt;
    this.odometer += speed * dt;
  }

  _brakeTorque(w, brake, hand) {
    const b = this.spec.brakes;
    let t = brake * (w.front ? b.front : b.rear);
    if (!w.front) t += hand * b.hand;
    return t;
  }

  // Buoyancy, water drag, the current and water coming in. The sealed cabin floats the car at first.
  // As it fills the car settles, tips towards the heavy engine and goes down.
  _water(dt) {
    const here = this.world.water?.(this.p[0], this.p[2]);
    this.submerged = 0;
    if (!here) return;
    const s = this.spec, d = s.dims, up = this.up, m = s.mass / 4;
    const floor = 0.2 - s.cg, roof = d.hgt - s.cg, cells = 0.62 * d.len * d.wid * d.hgt / 4;
    const lx = d.wid * .4, lz = d.len * .4;
    const r = [0, 0, 0], vp = [0, 0, 0];
    let wet = 0;
    for (const [bx, bz] of [[lx, lz], [-lx, lz], [lx, -lz], [-lx, -lz]]) {
      qRotate(this.q, [bx, 0, bz], r);
      const low = this.p[1] + r[1] + up[1] * floor, high = this.p[1] + r[1] + up[1] * roof;
      const share = clamp((here.level - low) / Math.max(.2, high - low), 0, 1);
      if (share <= 0) continue;
      wet += share / 4;
      // The front takes on water first and the engine keeps it heavy.
      const air = 1 - .9 * clamp(this.flood * (bz > 0 ? 1.12 : .94), 0, 1);
      const lift = 1000 * G * cells * air * share;
      cross(this.w, r, vp);
      const rx = vp[0] + this.v[0] - here.flowX, ry = vp[1] + this.v[1], rz = vp[2] + this.v[2] - here.flowZ;
      const rel = Math.hypot(rx, ry, rz) || 1e-6;
      const side = d.wid * d.hgt * share * .25, top = d.len * d.wid * share * .25;
      const drag = Math.min(500 * (1.05 * side + .9 * top * Math.abs(ry) / rel) * rel * rel, .55 * rel * m / dt);
      this._applyAt(r, [-rx / rel * drag, lift - ry / rel * drag, -rz / rel * drag]);
    }
    this.submerged = wet;
    if (wet > .04) this.flood = Math.min(1, this.flood + dt * (.014 + .05 * wet));
    // Water at the air intake stops the engine for good.
    if (here.level > this.p[1] - s.cg + .82) { this.drowned = true; this.damage.engine = 1; }
    for (const wheel of this.wheels) wheel.omega *= 1 - Math.min(.9, 2.4 * wet * dt);
  }

  _applyAt(r, f) {
    this.Fsum[0] += f[0]; this.Fsum[1] += f[1]; this.Fsum[2] += f[2];
    this.Tsum[0] += r[1] * f[2] - r[2] * f[1];
    this.Tsum[1] += r[2] * f[0] - r[0] * f[2];
    this.Tsum[2] += r[0] * f[1] - r[1] * f[0];
  }

  _groundImpact(point, speed) {
    if(this.groundDamageCooldown>0) return;
    this.groundDamageCooldown=.24;
    const j=this.spec.mass*1.25*speed;
    if(!this.lastHit || j>this.lastHit.j) this.lastHit={P:[...point],n:[0,1,0],j,terrain:true};
  }

  // penalty contacts for body corners / roof touching the ground
  _bodyGround(dt) {
    const d = this.spec.dims, cg = this.spec.cg;
    if (!this._bodyPts) {
      const hl = d.len / 2, hw = d.wid / 2 - 0.05, zf = d.overF + this.spec.wheelbase * (1 - this.spec.frontWeight), zr = -(d.len - zf);
      const yb = -cg + 0.14, yt = -cg + d.hgt;
      this._bodyPts = [[-hw, yb, zf - 0.1], [hw, yb, zf - 0.1], [-hw, yb, zr + 0.1], [hw, yb, zr + 0.1],
        [0, yb - 0.02, 0.2], [-hw, yt - 0.05, 0.1], [hw, yt - 0.05, 0.1], [-hw, yt - 0.05, -0.9], [hw, yt - 0.05, -0.9],
        [-hw - 0.03, -cg + 0.6, 0], [hw + 0.03, -cg + 0.6, 0]];
      void hl;
    }
    const r = [0, 0, 0], pw = [0, 0, 0], vP = [0, 0, 0];
    this.contactsBody = 0;
    let normalLoad = 0;
    let contacts;
    for (const bp of this._bodyPts) {
      qRotate(this.q, bp, r);
      pw[0] = this.p[0] + r[0]; pw[1] = this.p[1] + r[1]; pw[2] = this.p[2] + r[2];
      const h = this.world.height(pw[0], pw[2], pw[1]);
      const pen = Math.min(h - pw[1], 0.3);   // capped: a point deep inside terrain must not fire the car out of it
      if (pen <= 0) continue;
      this.contactsBody++;
      cross(this.w, r, vP);
      vP[0] += this.v[0]; vP[1] += this.v[1]; vP[2] += this.v[2];
      // A deeply embedded chassis needs to separate from the surface without
      // storing enough spring energy to throw it back into the air.
      const Fn = Math.max(0, 7400 * (Math.min(3.5, 205000 / 7400 * pen) - vP[1]));
      if(vP[1]<-4.3) this._groundImpact(pw,-vP[1]);
      const vt = Math.hypot(vP[0], vP[2]) || 1;
      const Ff = Math.min(0.6 * Fn, 8000 * vt);
      (contacts ??= []).push({point:[...r],force:[-vP[0] / vt * Ff, Fn, -vP[2] / vt * Ff]});
      normalLoad += Fn;
      this.scrape = Math.min(1, (this.scrape || 0) + vt * 0.02);
    }
    if (!contacts) return;
    const loadScale = Math.min(1, this.spec.mass * G * 7 / Math.max(1, normalLoad));
    for (const {point,force} of contacts) this._applyAt(point,force.map(value=>value*loadScale));
  }

  // --- external impulses (collisions) ------------------------------------
  applyImpulse(point, J) {
    const s = this.spec;
    const r = [point[0] - this.p[0], point[1] - this.p[1], point[2] - this.p[2]];
    this.v[0] += J[0] / s.mass; this.v[1] += J[1] / s.mass; this.v[2] += J[2] / s.mass;
    const tw = cross(r, J, [0, 0, 0]);
    const tb = qInvRotate(this.q, tw, [0, 0, 0]);
    const I = s.inertia;
    const dwb = [tb[0] / I[0], tb[1] / I[1], tb[2] / I[2]];
    const dw = qRotate(this.q, dwb, [0, 0, 0]);
    this.w[0] += dw[0]; this.w[1] += dw[1]; this.w[2] += dw[2];
  }

  // effective inverse mass along direction n at point (for impulse solving)
  invMassAt(point, n) {
    const s = this.spec;
    const r = [point[0] - this.p[0], point[1] - this.p[1], point[2] - this.p[2]];
    const rn = cross(r, n, [0, 0, 0]);
    const rb = qInvRotate(this.q, rn, [0, 0, 0]);
    const I = s.inertia;
    return 1 / s.mass + rb[0] * rb[0] / I[0] + rb[1] * rb[1] / I[1] + rb[2] * rb[2] / I[2];
  }

  velocityAt(point, out = [0, 0, 0]) {
    const r = [point[0] - this.p[0], point[1] - this.p[1], point[2] - this.p[2]];
    cross(this.w, r, out);
    out[0] += this.v[0]; out[1] += this.v[1]; out[2] += this.v[2];
    return out;
  }
}

// mark driven wheels once per spec
const _origCtor = Vehicle.prototype.constructor;
void _origCtor;
// Height gradient from three samples (back, centre, front) spaced `e` apart.  Across a real step
// (cliff, bridge end, kerb edge) the central difference invents a steep slope that is nowhere
// under the wheel; use the side the sample sits on instead (the flatter one).
function stepSafeGrad(hb, hc, hf, e) {
  const gb = (hc - hb) / e, gf = (hf - hc) / e;
  if (Math.abs(gf - gb) > 1.0) return Math.abs(gb) < Math.abs(gf) ? gb : gf;
  return (hf - hb) / (2 * e);
}

export function makeVehicle(spec, world) {
  const v = new Vehicle(spec, world);
  for (const w of v.wheels) {
    w.driven = spec.drive === 'awd' || (spec.drive === 'fwd' ? w.front : !w.front);
  }
  return v;
}

export { qRotate, qInvRotate };
