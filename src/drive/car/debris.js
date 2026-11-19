// Loose parts: wheels, bumpers, mirrors, hoods that tear off in a crash.  Each is a real rigid body
// (mass, inertia tensor, quaternion orientation, Euler's equations) that falls, bounces, slides and
// rolls on the road and collides with walls, barriers, trunks and posts:
//  - a wheel is a cylinder (solid disc inertia): thrown with its spin it rolls without slip, wanders
//    as the contact torque precesses it, slows, wobbles and finally falls flat;
//  - a panel is a box that tumbles and scrapes to a stop.
// Contacts are impulse based (restitution + Coulomb friction), several points per body.
import * as THREE from 'three';

export const debrisSink = { current: null };

const G = 9.81;
const _m = new THREE.Matrix4(), _v = new THREE.Vector3(), _q = new THREE.Quaternion();

class Body {
  constructor(mesh, o) {
    this.mesh = mesh;
    this.owner = o.owner || null;
    this.m = o.mass;
    this.kind = o.kind;               // 'cyl' | 'box'
    this.R = o.R; this.W = o.W;       // cylinder radius, width
    this.h = o.h || null;             // box half extents (x, y, z)
    // principal moments (body frame) and their inverses
    if (this.kind === 'cyl') {
      const Ia = 0.5 * this.m * this.R * this.R;                       // about the axle (local x)
      const Ip = this.m * (3 * this.R * this.R + this.W * this.W) / 12;
      this.I = new THREE.Vector3(Ia, Ip, Ip);
    } else {
      const [a, b, c] = this.h;
      this.I = new THREE.Vector3(this.m * (b * b + c * c) / 3, this.m * (a * a + c * c) / 3, this.m * (a * a + b * b) / 3);
    }
    this.v = (o.v || new THREE.Vector3()).clone();
    this.w = (o.w || new THREE.Vector3()).clone();
    this.rest = 0;
    this.pts = this._contactPoints();
    this.bound = this.kind === 'cyl' ? this.R : Math.hypot(...this.h) * 0.6;
  }

  _contactPoints() {
    const P = [];
    if (this.kind === 'cyl') {
      // a tyre has a crowned tread: contact on the centre line, rounded shoulders a little inside the
      // radius - so it is only unstable-upright (a flat-edged cylinder would stand forever)
      for (let i = 0; i < 16; i++) {
        const a = i / 16 * Math.PI * 2;
        P.push(new THREE.Vector3(0, Math.cos(a) * this.R, Math.sin(a) * this.R));
        for (const s of [-1, 1]) P.push(new THREE.Vector3(s * this.W * 0.44, Math.cos(a) * this.R * 0.9, Math.sin(a) * this.R * 0.9));
      }
    } else {
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) P.push(new THREE.Vector3(sx * this.h[0], sy * this.h[1], sz * this.h[2]));
    }
    return P;
  }

  // inverse inertia tensor in world frame
  invIworld(out) {
    const Rm = _m.makeRotationFromQuaternion(this.mesh.quaternion).elements;
    const d = [1 / this.I.x, 1 / this.I.y, 1 / this.I.z];
    // R diag(d) R^T
    const R = [[Rm[0], Rm[4], Rm[8]], [Rm[1], Rm[5], Rm[9]], [Rm[2], Rm[6], Rm[10]]];
    const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { let s = 0; for (let k = 0; k < 3; k++) s += R[i][k] * d[k] * R[j][k]; M[i][j] = s; }
    return M;
  }
}

const mul = (M, v) => new THREE.Vector3(M[0][0] * v.x + M[0][1] * v.y + M[0][2] * v.z, M[1][0] * v.x + M[1][1] * v.y + M[1][2] * v.z, M[2][0] * v.x + M[2][1] * v.y + M[2][2] * v.z);

export class Debris {
  constructor(scene, ground, obstacles = null) {
    this.scene = scene;
    this.ground = ground;
    this.obstacles = obstacles;
    this.items = [];
    this.max = 60;
  }

  /** mesh already at its world pose; o: { kind:'cyl'|'box', mass, R, W, h, v, w, owner } */
  add(mesh, o) {
    this.scene.add(mesh);
    mesh.traverse((c) => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
    const b = new Body(mesh, o);
    this.items.push(b);
    if (this.items.length > this.max) this.remove(this.items[0]);
    return b;
  }

  remove(it) {
    this.scene.remove(it.mesh);
    it.mesh.traverse(o=>{
      if(o.isMesh && o.userData.ownGeometry) o.geometry.dispose();
      if(o.isMesh && o.userData.ownMaterial) o.material.dispose();
    });
    const i = this.items.indexOf(it);
    if (i >= 0) this.items.splice(i, 1);
  }

  clear(owner = null) { for (const it of [...this.items]) if (!owner || it.owner === owner) this.remove(it); }

  update(dt) {
    dt = Math.min(dt, 0.05);
    const n = Math.max(1, Math.ceil(dt / (1 / 240)));
    const h = dt / n;
    for (let s = 0; s < n; s++) for (const b of this.items) if (b.rest < 0.8) this._step(b, h);
  }

  _step(b, dt) {
    const mesh = b.mesh, pos = mesh.position, q = mesh.quaternion;
    b.v.y -= G * dt;
    // gyroscopic term: I dw/dt = -w x (I w), done in the body frame
    _q.copy(q).invert();
    const wb = b.w.clone().applyQuaternion(_q);
    const Iw = new THREE.Vector3(b.I.x * wb.x, b.I.y * wb.y, b.I.z * wb.z);
    const gyro = new THREE.Vector3().crossVectors(wb, Iw);
    wb.x -= gyro.x / b.I.x * dt; wb.y -= gyro.y / b.I.y * dt; wb.z -= gyro.z / b.I.z * dt;
    b.w.copy(wb).applyQuaternion(q);
    // contacts: ground
    const Iinv = b.invIworld();
    let touching = false, maxPen = 0;
    for (let iter = 0; iter < 2; iter++) {
      for (const p of b.pts) {
        const r = _v.copy(p).applyQuaternion(q);
        const wx = pos.x + r.x, wy = pos.y + r.y, wz = pos.z + r.z;
        const gy = this.ground.height(wx, wz);
        const pen = gy - wy;
        if (pen <= 0) continue;
        touching = true;
        if (pen > maxPen) maxPen = pen;
        const rr = r.clone();
        const vp = b.v.clone().add(new THREE.Vector3().crossVectors(b.w, rr));
        const vn = vp.y;
        const kn = this._eff(b, Iinv, rr, new THREE.Vector3(0, 1, 0));
        if (vn < 0) {
          const e = vn < -2 ? 0.28 : 0;
          const jn = -(1 + e) * vn / kn;
          this._impulse(b, Iinv, rr, new THREE.Vector3(0, jn, 0));
          // Coulomb friction at the contact (tyre rubber grips more than a plastic panel)
          const vt = new THREE.Vector3(vp.x, 0, vp.z);
          const vtl = vt.length();
          if (vtl > 1e-4) {
            const dir = vt.clone().divideScalar(vtl);
            const kt = this._eff(b, Iinv, rr, dir);
            const mu = b.kind === 'cyl' ? 0.9 : 0.55;
            const jt = Math.min(vtl / kt, mu * jn);
            this._impulse(b, Iinv, rr, dir.multiplyScalar(-jt));
          }
        } else {
          // resting contact: still bleed tangential slip a little so things do not skate forever
        }
      }
    }
    // one positional correction for the deepest contact (several simultaneous points must not add up)
    if (maxPen > 0.002) pos.y += Math.min(maxPen - 0.002, 0.05) * 0.8;
    // obstacles: walls, barriers, trunks, posts (a ball of the body's bounding radius, centre height)
    if (this.obstacles) {
      const hit = this.obstacles.queryBall(pos.x, pos.z, pos.y, b.kind === 'cyl' ? Math.max(b.R, 0.2) : b.bound);
      if (hit) {
        const [nx, nz, pen] = hit;
        pos.x += nx * pen; pos.z += nz * pen;
        const vn = b.v.x * nx + b.v.z * nz;
        if (vn < 0) {
          b.v.x -= (1 + 0.3) * vn * nx; b.v.z -= (1 + 0.3) * vn * nz;
          b.v.multiplyScalar(0.92);
          // a glancing blow sets it spinning
          b.w.y += (nx * b.v.z - nz * b.v.x) * 0.3;
        }
      }
    }
    // integrate
    pos.addScaledVector(b.v, dt);
    const wl = b.w.length();
    if (wl > 1e-6) {
      _q.setFromAxisAngle(_v.copy(b.w).divideScalar(wl), wl * dt);
      q.premultiply(_q).normalize();
    }
    // air drag and slow decay of spin when the body is on the ground (rolling resistance / scrubbing)
    if (touching) {
      if (b.kind === 'cyl') {
        // rolling resistance of a tyre on asphalt (~0.7 m/s^2): speed and spin fall together
        const sp = Math.hypot(b.v.x, b.v.z);
        if (sp > 1e-3) { const k = Math.max(0, 1 - 0.7 * dt / sp); b.v.x *= k; b.v.z *= k; b.w.multiplyScalar(k); }
      } else {
        const k = Math.exp(-0.35 * dt); b.w.multiplyScalar(k);
      }
    }
    // a tyre standing on its tread is only gyroscopically stable while it rolls fast: when it slows
    // it topples sideways and finally lies flat
    if (b.kind === 'cyl' && touching && !b.toppled && Math.hypot(b.v.x, b.v.z) < 1.8) {
      const a = _v.set(1, 0, 0).applyQuaternion(q);
      if (Math.abs(a.y) < 0.6) {
        const hdir = new THREE.Vector3().crossVectors(a, new THREE.Vector3(0, 1, 0)).normalize();
        b.topple = hdir.multiplyScalar(Math.random() < 0.5 ? -1 : 1);
        b.toppled = true;
      }
    }
    if (b.topple) {
      // gravity tipping the slightly leaning tyre over its rim edge
      b.w.addScaledVector(b.topple, 7 * dt);
      const a2 = _v.set(1, 0, 0).applyQuaternion(q);
      if (Math.abs(a2.y) > 0.9) b.topple = null;
    }
    // rest detection
    if (touching && !b.topple && b.v.length() < 0.12 && b.w.length() < 0.25) b.rest += dt; else b.rest = Math.max(0, b.rest - dt * 4);
    if (!Number.isFinite(pos.y)) b.rest = 9;
  }

  // 1 / (1/m + (r x n) . Iinv (r x n))
  _eff(b, Iinv, r, n) {
    const rn = new THREE.Vector3().crossVectors(r, n);
    const t = mul(Iinv, rn);
    return 1 / b.m + rn.dot(t);
  }

  _impulse(b, Iinv, r, J) {
    b.v.addScaledVector(J, 1 / b.m);
    const L = new THREE.Vector3().crossVectors(r, J);
    b.w.add(mul(Iinv, L));
  }
}
