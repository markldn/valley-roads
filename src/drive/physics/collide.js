// Static obstacles (BD TOPO building footprints, tree trunks, bridge parapets,
// map edge) and car-car contacts.  2D (plan view) geometry with impulse
// response applied at the contact point, so glancing blows yaw the car.

const CELL = 24;

function key(gx, gz) { return gx * 73856093 ^ gz * 19349663; }

export class Obstacles {
  /** world: a single-map world (adds it at once), or null for an empty set that sectors add themselves to */
  constructor(world = null) {
    this.segs = new Map();   // cell -> [x0, z0, x1, z1, kind]
    this.circles = new Map();
    this.parapets = [];
    this.ground = world ? world.ground : null;
    this._owner = null;
    this._owned = new Map();     // owner id -> [[map, key, item]]
    if (world) this.addWorld(world, 'world');
  }

  /** everything static of one loaded world / sector, removable with removeOwner(id) */
  addWorld(world, id) {
    this.beginOwner(id);
    this._addFootprints(world.buffers.footprints);
    this._addTrees(world);
    this._addBridges(world.roads);
    this.endOwner();
  }

  beginOwner(id) { this._owner = id; if (!this._owned.has(id)) this._owned.set(id, []); }
  endOwner() { this._owner = null; }

  removeOwner(id) {
    const rec = this._owned.get(id);
    if (!rec) return;
    for (const [map, k, item] of rec) {
      const l = map.get(k);
      if (!l) continue;
      const i = l.indexOf(item);
      if (i >= 0) { l[i] = l[l.length - 1]; l.pop(); }
      if (!l.length) map.delete(k);
    }
    this._owned.delete(id);
    // parapets listed for the bridge-deck logic
    this.parapets = this.parapets.filter((q) => q.owner !== id);
  }

  _put(map, x0, z0, x1, z1, item) {
    const rec = this._owner !== null ? this._owned.get(this._owner) : null;
    for (let gx = Math.floor(Math.min(x0, x1) / CELL); gx <= Math.floor(Math.max(x0, x1) / CELL); gx++) {
      for (let gz = Math.floor(Math.min(z0, z1) / CELL); gz <= Math.floor(Math.max(z0, z1) / CELL); gz++) {
        const k = key(gx, gz);
        let l = map.get(k);
        if (!l) map.set(k, (l = []));
        l.push(item);
        if (rec) rec.push([map, k, item]);
      }
    }
  }

  _addFootprints(buf) {
    const dv = new DataView(buf);
    const n = dv.getUint32(0, true);
    const offs = new Uint32Array(buf, 4, n + 1);
    const xy = new Float32Array(buf, 4 + 4 * (n + 1));
    this.nBuildings = n;
    for (let b = 0; b < n; b++) {
      const s = offs[b], e = offs[b + 1];
      for (let i = s; i < e; i++) {
        const j = i + 1 < e ? i + 1 : s;
        // data frame (x, north) -> world (x, z = -north); CCW in data = CW in world
        const x0 = xy[i * 2], z0 = -xy[i * 2 + 1], x1 = xy[j * 2], z1 = -xy[j * 2 + 1];
        this._put(this.segs, x0, z0, x1, z1, [x0, z0, x1, z1, 0]);
      }
    }
  }

  _addTrees(world) {
    const { tiles, buffers } = world;
    const lay = tiles.layers.trees;
    const U = lay.unit || 0.01;
    for (const [k, [off, n]] of Object.entries(lay.tiles)) {
      const [ti, tj] = k.split(',').map(Number);
      const ox = tiles.x0 + ti * tiles.tile, oy = tiles.y0 + tj * tiles.tile;
      const dv = new DataView(buffers.trees, off, n * 6);
      for (let i = 0; i < n; i++) {
        const kind = dv.getUint8(i * 6 + 5);
        if (kind === 5) continue; // hedges are soft: they slow you, not stop you
        const x = ox + dv.getUint16(i * 6, true) * U, z = -(oy + dv.getUint16(i * 6 + 2, true) * U);
        const s = dv.getUint8(i * 6 + 4) / 100;
        const r = (kind === 1 ? 0.25 : 0.3) * s * (kind === 4 ? 0.6 : 1);
        this._put(this.circles, x - r, z - r, x + r, z + r, [x, z, r]);
      }
    }
  }

  _addBridges(roads) {
    for (const r of roads.roads) {
      if (!r.br) continue;
      const P = r.pts;
      for (let i = 0; i + 1 < P.length; i++) {
        const ax = P[i][0], az = -P[i][1], bx = P[i + 1][0], bz = -P[i + 1][1];
        const L = Math.hypot(bx - ax, bz - az) || 1;
        const nx = -(bz - az) / L, nz = (bx - ax) / L;
        const off = (r.deckHW || r.w / 2 + 0.6) - 0.15;
        for (const s of [-1, 1]) {
          const seg = [ax + nx * off * s, az + nz * off * s, bx + nx * off * s, bz + nz * off * s, 1, P[i][2], P[i + 1][2]];
          this._put(this.segs, seg[0], seg[1], seg[2], seg[3], seg);
          seg.owner = this._owner;
          this.parapets.push(seg);
        }
      }
    }
  }

  // temporary segments (race barriers) that can be cleared between sessions
  setTrackSegs(list) {
    this.trackSegs = new Map();
    for (const [x0, z0, x1, z1] of list || []) this._put(this.trackSegs, x0, z0, x1, z1, [x0, z0, x1, z1, 2]);
  }

  // permanent thin walls (prison perimeter): [[x0, z0, x1, z1], ...], solid from both sides
  addBarriers(list) {
    this.barriers = this.barriers || new Map();
    for (const [x0, z0, x1, z1, bottom, top] of list)
      this._put(this.barriers, x0, z0, x1, z1, [x0, z0, x1, z1, 2, bottom, top]);
  }

  addPosts(list, r) {
    for (const [x, z] of list) this._put(this.circles, x - r, z - r, x + r, z + r, [x, z, r]);
  }

  addBreakableProp(x, z, r, onBreak, {mass=0,threshold=1800,bottom=-Infinity,top=Infinity}={}) {
    const c = [x, z, r]; Object.assign(c,{onBreak,mass,threshold,bottom,top});
    this._put(this.circles, x - r, z - r, x + r, z + r, c);
    return c;
  }

  // distance from (x, z) to the nearest wall segment or tree trunk (capped at 8 m)
  clearance(x, z) {
    let best = 8;
    const gx0 = Math.floor((x - 8) / CELL), gx1 = Math.floor((x + 8) / CELL);
    const gz0 = Math.floor((z - 8) / CELL), gz1 = Math.floor((z + 8) / CELL);
    for (let gx = gx0; gx <= gx1; gx++) for (let gz = gz0; gz <= gz1; gz++) {
      const segs = this.segs.get(key(gx, gz));
      if (segs) for (const s of segs) {
        if (s[4] === 1) continue;
        const dx = s[2] - s[0], dz = s[3] - s[1];
        const t = Math.max(0, Math.min(1, ((x - s[0]) * dx + (z - s[1]) * dz) / (dx * dx + dz * dz || 1e-9)));
        best = Math.min(best, Math.hypot(s[0] + dx * t - x, s[1] + dz * t - z));
      }
      const circ = this.circles.get(key(gx, gz));
      if (circ) for (const c of circ) if(c[2]>0) best = Math.min(best, Math.hypot(c[0] - x, c[1] - z) - c[2]);
    }
    return best;
  }

  // A ball (loose wheel, panel, ragdoll point) against walls, barriers, parapets,
  // trunks and posts, in plan view. Contacts work from either side of a segment.
  // Returns [nx, nz, penetration] for the deepest contact or null.
  queryBall(x, z, y, r) {
    let best = null, bp = 0;
    const gx0 = Math.floor((x - r) / CELL), gx1 = Math.floor((x + r) / CELL);
    const gz0 = Math.floor((z - r) / CELL), gz1 = Math.floor((z + r) / CELL);
    const test = (px, pz, nx, nz, thick) => {
      // Orient the contact normal toward the ball. A fixed segment winding
      // otherwise lets a fast body keep its velocity when it hits the back face.
      const side = (x - px) * nx + (z - pz) * nz;
      if (side < 0) { nx = -nx; nz = -nz; }
      const pen = r + thick - Math.abs(side);
      if (pen > 0 && pen > bp) { bp = pen; best = [nx, nz, pen]; }
    };
    for (let gx = gx0; gx <= gx1; gx++) for (let gz = gz0; gz <= gz1; gz++) {
      const segs = this.segs.get(key(gx, gz));
      if (segs) for (const s of segs) {
        if (s[4] === 1 && y < Math.max(s[5], s[6]) - 0.3) continue;      // parapet only up on the deck
        const dx = s[2] - s[0], dz = s[3] - s[1], L2 = dx * dx + dz * dz || 1e-9;
        const t = ((x - s[0]) * dx + (z - s[1]) * dz) / L2;
        if (t < -0.02 || t > 1.02) continue;
        const l = Math.sqrt(L2);
        test(s[0], s[1], -dz / l, dx / l, 0.05);
      }
      const ts = this.trackSegs && this.trackSegs.get(key(gx, gz));
      if (ts) for (const s of ts) {
        const dx = s[2] - s[0], dz = s[3] - s[1], L2 = dx * dx + dz * dz || 1e-9;
        const t = ((x - s[0]) * dx + (z - s[1]) * dz) / L2;
        if (t < 0 || t > 1) continue;
        const l = Math.sqrt(L2);
        let nx = -dz / l, nz = dx / l;
        const side = (x - s[0]) * nx + (z - s[1]) * nz;
        if (side < 0) { nx = -nx; nz = -nz; }
        const sd = Math.abs(side);
        const pen = r + 0.12 - sd;
        if (pen > 0 && pen > bp) { bp = pen; best = [nx, nz, pen]; }
      }
      const walls = this.barriers && this.barriers.get(key(gx, gz));
      if (walls) for (const s of walls) {
        if (s[5] != null && (y + r < s[5] || y - r > s[6])) continue;
        const dx = s[2] - s[0], dz = s[3] - s[1], L2 = dx * dx + dz * dz || 1e-9;
        const t = ((x - s[0]) * dx + (z - s[1]) * dz) / L2;
        if (t < 0 || t > 1) continue;
        const l = Math.sqrt(L2);
        let nx = -dz / l, nz = dx / l;
        const side = (x - s[0]) * nx + (z - s[1]) * nz;
        if (side < 0) { nx = -nx; nz = -nz; }
        const pen = r + 0.1 - Math.abs(side);
        if (pen > 0 && pen > bp) { bp = pen; best = [nx, nz, pen]; }
      }
      const circ = this.circles.get(key(gx, gz));
      if (circ) for (const c of circ) {
        if(c[2]<=0 || y-r>c.top || y+r<c.bottom) continue;
        const dx = x - c[0], dz = z - c[1], d = Math.hypot(dx, dz) || 1e-6;
        const pen = r + c[2] - d;
        if (pen > 0 && pen > bp) { bp = pen; best = [dx / d, dz / d, pen]; }
      }
    }
    return best;
  }

  // Nearest building wall to a point (for shop signs): closest point on the wall, its outward normal
  // (towards the side the point is on) and the distance; null if none within maxD metres.
  nearestWall(x, z, maxD = 25) {
    let best = null, bd = maxD;
    const r = Math.ceil(maxD / CELL);
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    for (let gx = cx - r; gx <= cx + r; gx++) for (let gz = cz - r; gz <= cz + r; gz++) {
      const segs = this.segs.get(key(gx, gz));
      if (!segs) continue;
      for (const s of segs) {
        if (s[4] !== 0) continue;                       // buildings only
        const dx = s[2] - s[0], dz = s[3] - s[1], L2 = dx * dx + dz * dz || 1e-9;
        const t = Math.max(0, Math.min(1, ((x - s[0]) * dx + (z - s[1]) * dz) / L2));
        const qx = s[0] + dx * t, qz = s[1] + dz * t;
        const d = Math.hypot(qx - x, qz - z);
        if (d >= bd) continue;
        const l = Math.sqrt(L2);
        if (l < 2.5) continue;                          // ignore stubs
        let nx = -dz / l, nz = dx / l;                  // outward normal of the footprint edge
        bd = d; best = { x: qx, z: qz, nx, nz, d, len: l, t };
      }
    }
    return best;
  }

  // car footprint in plan: centre, axes and half-extents
  static footprint(car) {
    const f = car.forward, r = car.right, d = car.spec.dims;
    const fl = Math.hypot(f[0], f[2]) || 1, rl = Math.hypot(r[0], r[2]) || 1;
    const fx = f[0] / fl, fz = f[2] / fl, rx = r[0] / rl, rz = r[2] / rl;
    const a = car.spec.wheelbase * (1 - car.spec.frontWeight);
    const front = a + d.overF, rear = d.len - front;
    const cz = (front - rear) / 2;
    return {
      cx: car.p[0] + fx * cz, cz: car.p[2] + fz * cz, fx, fz, rx, rz,
      hl: d.len / 2, hw: d.wid / 2,
    };
  }

  // resolve contacts for one car; returns the largest normal impulse (N s)
  /** vehicles without a physics body of their own (buses): oriented boxes {cx, cz, fx, fz, rx, rz, hl, hw, y}, set each frame */
  setMovingBoxes(list) { this.movingBoxes = list || []; }

  resolve(car) {
    const F = Obstacles.footprint(car);
    let maxJ = 0;
    for (const B of this.movingBoxes || []) maxJ = Math.max(maxJ, this._boxContact(car, F, B));
    const gx0 = Math.floor((F.cx - 4) / CELL), gx1 = Math.floor((F.cx + 4) / CELL);
    const gz0 = Math.floor((F.cz - 4) / CELL), gz1 = Math.floor((F.cz + 4) / CELL);
    const seen = new Set();
    const corners = [];
    for (const [sl, sw] of [[1, 1], [1, -1], [-1, 1], [-1, -1], [1, 0], [-1, 0], [0.5, 1], [0.5, -1], [-0.5, 1], [-0.5, -1], [0, 1], [0, -1]]) {
      corners.push([F.cx + F.fx * F.hl * sl + F.rx * F.hw * sw, F.cz + F.fz * F.hl * sl + F.rz * F.hw * sw]);
    }
    const carY = car.p[1];
    for (let gx = gx0; gx <= gx1; gx++) {
      for (let gz = gz0; gz <= gz1; gz++) {
        const segs = this.segs.get(key(gx, gz));
        if (segs) for (const s of segs) {
          if (seen.has(s)) continue;
          seen.add(s);
          if (s[4] === 1) {
            // parapet: only when the car is up on the deck
            const deck = Math.max(s[5], s[6]);
            if (carY < deck - 0.3) continue;
          }
          maxJ = Math.max(maxJ, this._segContact(car, F, corners, s));
        }
        const ts = this.trackSegs && this.trackSegs.get(key(gx, gz));
        if (ts) for (const s of ts) {
          if (seen.has(s)) continue;
          seen.add(s);
          maxJ = Math.max(maxJ, this._barrierContact(car, F, corners, s));
        }
        const fb = this.barriers && this.barriers.get(key(gx, gz));
        if (fb) for (const s of fb) {
          if (seen.has(s)) continue;
          seen.add(s);
          maxJ = Math.max(maxJ, this._barrierContact(car, F, corners, s));
        }
        const circ = this.circles.get(key(gx, gz));
        if (circ) for (const c of circ) {
          if (seen.has(c)) continue;
          seen.add(c);
          const j = this._circleContact(car, F, c);
          if (j > c.threshold && c.onBreak) {
            const fn=c.onBreak;
            c.onBreak=null; c[2]=0;
            fn(car,j);
          }
          maxJ = Math.max(maxJ, j);
        }
      }
    }
    // map edge: soft invisible wall
    const g = this.ground;
    if (!g) return maxJ;
    for (const [px, pz] of corners) {
      const m = 30;
      let nx = 0, nz = 0, pen = 0;
      if (px < g.minX + m) { nx = 1; pen = g.minX + m - px; }
      else if (px > g.maxX - m) { nx = -1; pen = px - (g.maxX - m); }
      else if (pz < g.minZ + m) { nz = 1; pen = g.minZ + m - pz; }
      else if (pz > g.maxZ - m) { nz = -1; pen = pz - (g.maxZ - m); }
      if (pen > 0) maxJ = Math.max(maxJ, this._impulse(car, [px, car.p[1], pz], nx, nz, pen, 0.2, 0.3));
    }
    return maxJ;
  }

  _segContact(car, F, corners, s) {
    const [x0, z0, x1, z1] = s;
    const dx = x1 - x0, dz = z1 - z0;
    const L2 = dx * dx + dz * dz || 1e-9;
    let best = 0;
    // 1) car corners against the wall segment (wall treated as a thick line, 0.15 m)
    for (const [px, pz] of corners) {
      let t = ((px - x0) * dx + (pz - z0) * dz) / L2;
      if (t < 0 || t > 1) continue;
      const qx = x0 + dx * t, qz = z0 + dz * t;
      // outward wall normal: footprints are CCW in (x, north), i.e. CW in world (x, z = -north),
      // so the outward normal of edge (dx, dz) is (-dz, dx)
      let nx = -dz, nz = dx;
      const nl = Math.hypot(nx, nz) || 1;
      nx /= nl; nz /= nl;
      const side = (px - qx) * nx + (pz - qz) * nz;
      // inside the building (behind the wall) by up to 1.2 m, or within the wall thickness
      if (side < 0.05 && side > -1.2) {
        const pen = 0.05 - side;
        best = Math.max(best, this._impulse(car, [px, car.p[1], pz], nx, nz, pen, 0.12, 0.45));
      }
    }
    // 2) wall endpoints (building corners) poking into the car rectangle
    for (const [qx, qz] of [[x0, z0]]) {
      const rx = qx - F.cx, rz = qz - F.cz;
      const lf = rx * F.fx + rz * F.fz, lr = rx * F.rx + rz * F.rz;
      const pf = F.hl - Math.abs(lf), pr = F.hw - Math.abs(lr);
      if (pf > 0 && pr > 0) {
        let nx, nz, pen;
        if (pf < pr) { nx = -F.fx * Math.sign(lf); nz = -F.fz * Math.sign(lf); pen = pf; }
        else { nx = -F.rx * Math.sign(lr); nz = -F.rz * Math.sign(lr); pen = pr; }
        best = Math.max(best, this._impulse(car, [qx, car.p[1], qz], nx, nz, Math.min(pen, 0.6), 0.12, 0.45));
      }
    }
    return best;
  }

  // a barrier is a thin wall that can be hit from either side
  _barrierContact(car, F, corners, s) {
    if(s[5]!=null && (car.p[1]+car.spec.dims.hgt-car.spec.cg<s[5] || car.p[1]-car.spec.cg>s[6])) return 0;
    const [x0, z0, x1, z1] = s;
    const dx = x1 - x0, dz = z1 - z0, L2 = dx * dx + dz * dz || 1e-9;
    let best = 0;
    // which side is the car centre on? push corners back to that side
    let nx = -dz, nz = dx;
    const nl = Math.hypot(nx, nz) || 1; nx /= nl; nz /= nl;
    const cs = (F.cx - x0) * nx + (F.cz - z0) * nz;
    const sgn = cs >= 0 ? 1 : -1;
    for (const [px, pz] of corners) {
      const t = ((px - x0) * dx + (pz - z0) * dz) / L2;
      if (t < -0.02 || t > 1.02) continue;
      const side = ((px - x0) * nx + (pz - z0) * nz) * sgn;
      const half = 0.3;
      if (side < half) {
        best = Math.max(best, this._impulse(car, [px, car.p[1], pz], nx * sgn, nz * sgn, Math.min(half - side, 0.8), 0.18, 0.35));
      }
    }
    return best;
  }

  // car footprint against an oriented box (SAT in plan); the car is pushed out along the least-penetration axis
  _boxContact(car, F, B) {
    if (B.dynamic) {
      const impulse=collideCars(car,B.dynamic);
      car.trafficHit=Math.max(car.trafficHit||0,impulse);
      return impulse;
    }
    if (Math.abs(car.p[1] - B.y) > 2.5) return 0;
    const hit = boxSat(F, B);
    if (!hit) return 0;
    if (B.light) {          // a rabbit or a bird is thrown aside and cannot move the car
      B.hit ||= { P: [hit.P[0], car.p[1], hit.P[1]], n: [-hit.n[0], 0, -hit.n[1]], j: 1,
        J: [car.v[0] * B.mass, 0, car.v[2] * B.mass] };
      return 0;
    }
    const j = this._impulse(car, [hit.P[0], car.p[1], hit.P[1]], hit.n[0], hit.n[1], hit.pen, 0.15, 0.4, null, B);
    B.hitJ = Math.max(B.hitJ || 0, j);
    car.trafficHit=Math.max(car.trafficHit||0,j);
    return j;
  }

  _circleContact(car, F, c) {
    const [x, z, r] = c;
    if(r<=0 || car.p[1]-car.spec.cg>c.top || car.p[1]+car.spec.dims.hgt-car.spec.cg<c.bottom) return 0;
    const rx = x - F.cx, rz = z - F.cz;
    const lf = rx * F.fx + rz * F.fz, lr = rx * F.rx + rz * F.rz;
    const cf = Math.max(-F.hl, Math.min(F.hl, lf)), cr = Math.max(-F.hw, Math.min(F.hw, lr));
    const qx = F.cx + F.fx * cf + F.rx * cr, qz = F.cz + F.fz * cf + F.rz * cr;
    const d = Math.hypot(qx - x, qz - z);
    if (d >= r) return 0;
    let nx, nz;
    if (d > 1e-4) { nx = (qx - x) / d; nz = (qz - z) / d; }
    else { nx = -rx; nz = -rz; const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l; }
    return this._impulse(car, [qx, car.p[1], qz], nx, nz, r - d, 0.1, 0.5, { c: [x, z], r },
      c.mass ? {mass:c.mass} : null);
  }

  // push the car out along (nx, nz) and remove approaching velocity at the point
  _impulse(car, P, nx, nz, pen, e, mu, extra = null, moving = null) {
    // A body much lighter than the car gives way instead of pushing the car out of it.
    const k = Math.min(pen, 0.5) * 0.9 * (moving?.mass ? Math.min(1, 3 * moving.mass / car.spec.mass) : 1);
    car.p[0] += nx * k; car.p[2] += nz * k;
    const n = [nx, 0, nz];
    const v = car.velocityAt(P);
    const vx = v[0] - (moving?.vx || 0), vz = v[2] - (moving?.vz || 0);
    const vn = vx * nx + vz * nz;
    if (vn >= 0) return 0;
    // The harder the hit, the more of it goes into crushing metal rather than bouncing back.
    e *= Math.max(0.12, 1 + vn / 16);
    const carInv = car.invMassAt(P,n), otherInv = moving?.mass ? 1/moving.mass : 0;
    const im = carInv+otherInv;
    const j = -(1 + e) * vn / im;
    // A hard hit lands low on the structure, so the nose dives and the tail kicks up.
    if (j > car.spec.mass * 4) P = [P[0], car.p[1] - 0.1, P[2]];
    // friction along the wall
    const tx = vx - vn * nx, tz = vz - vn * nz;
    const tl = Math.hypot(tx, tz);
    let J = [nx * j, 0, nz * j];
    if (tl > 1e-3) {
      const t = [tx / tl, 0, tz / tl];
      const jt = Math.min(mu * j, tl / car.invMassAt(P, t));
      J = [J[0] - t[0] * jt, 0, J[2] - t[2] * jt];
    }
    car.applyImpulse(P, J);
    const lostEnergy = -.5 * j * vn * (1-e);
    if (moving && (!moving.hit || moving.hit.j < j)) {
      moving.hit={ P:[...P], n:[-nx,0,-nz], J:J.map(value=>-value), j, energy:lostEnergy*otherInv/im };
    }
    if (!car.lastHit || j > car.lastHit.j) car.lastHit = {
      P:[...P],n:[nx,0,nz],j,energy:lostEnergy*carInv/im,...extra,
    };
    return j;
  }
}

// car-car contacts: oriented rectangles in plan, separating-axis test.
// The contact point is the deepest corner of one car inside the other; each car
// receives its impulse at its own CG height, so a side swipe yaws the cars
// without inventing a rolling moment (real bumpers meet at about CG height).
function corners(F) {
  const out = [];
  for (const [sl, sw] of [[1, 1], [1, -1], [-1, 1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
    out.push([F.cx + F.fx * F.hl * sl + F.rx * F.hw * sw, F.cz + F.fz * F.hl * sl + F.rz * F.hw * sw]);
  }
  return out;
}
function inside(F, x, z) {
  const rx = x - F.cx, rz = z - F.cz;
  const lf = rx * F.fx + rz * F.fz, lr = rx * F.rx + rz * F.rz;
  return Math.min(F.hl - Math.abs(lf), F.hw - Math.abs(lr));
}

/**
 * Plan-view separating-axis test of footprint F (car-like: cx, cz, fx, fz, rx, rz, hl, hw) against box B.
 * Returns null when they do not overlap, else { pen, n: [nx, nz] pushing F out of B, P: [x, z] the contact corner }.
 */
export function boxSat(F, B) {
  const dx = B.cx - F.cx, dz = B.cz - F.cz, reach = F.hl + F.hw + B.hl + B.hw;
  if (dx * dx + dz * dz > reach * reach) return null;
  const axes = [[F.fx, F.fz], [F.rx, F.rz], [B.fx, B.fz], [B.rx, B.rz]];
  let minPen = 1e9, nAx = null;
  for (const [ax, az] of axes) {
    const ra = F.hl * Math.abs(F.fx * ax + F.fz * az) + F.hw * Math.abs(F.rx * ax + F.rz * az);
    const rb = B.hl * Math.abs(B.fx * ax + B.fz * az) + B.hw * Math.abs(B.rx * ax + B.rz * az);
    const d = dx * ax + dz * az;
    const pen = ra + rb - Math.abs(d);
    if (pen <= 0) return null;
    if (pen < minPen) { minPen = pen; nAx = [ax * (d >= 0 ? 1 : -1), az * (d >= 0 ? 1 : -1)]; }
  }
  // the deepest corner of F inside B is the contact point; nAx points from F to B, so the push is its opposite
  let px = F.cx, pz = F.cz, best = -1;
  for (const [x, z] of corners(F)) { const d = inside(B, x, z); if (d > best) { best = d; px = x; pz = z; } }
  return { pen: minPen, n: [-nAx[0], -nAx[1]], P: [px, pz] };
}

export function collideCars(a, b) {
  if (Math.abs(a.p[1] - b.p[1]) > 2) return 0;
  if ((a.ghostT || 0) > 0 || (b.ghostT || 0) > 0) return 0;
  const A = Obstacles.footprint(a), B = Obstacles.footprint(b);
  const dx = B.cx - A.cx, dz = B.cz - A.cz;
  if (dx * dx + dz * dz > 49) return 0;
  const axes = [[A.fx, A.fz], [A.rx, A.rz], [B.fx, B.fz], [B.rx, B.rz]];
  let minPen = 1e9, nAx = null;
  for (const [ax, az] of axes) {
    const ra = A.hl * Math.abs(A.fx * ax + A.fz * az) + A.hw * Math.abs(A.rx * ax + A.rz * az);
    const rb = B.hl * Math.abs(B.fx * ax + B.fz * az) + B.hw * Math.abs(B.rx * ax + B.rz * az);
    const d = dx * ax + dz * az;
    const pen = ra + rb - Math.abs(d);
    if (pen <= 0) return 0;
    if (pen < minPen) { minPen = pen; nAx = [ax * Math.sign(d || 1), az * Math.sign(d || 1)]; }
  }
  // deepest corner of either car inside the other
  let px = (A.cx + B.cx) / 2, pz = (A.cz + B.cz) / 2, best = -1;
  for (const [x, z] of corners(B)) { const d = inside(A, x, z); if (d > best) { best = d; px = x; pz = z; } }
  for (const [x, z] of corners(A)) { const d = inside(B, x, z); if (d > best) { best = d; px = x; pz = z; } }
  const n = [nAx[0], 0, nAx[1]]; // from a to b
  const k = Math.min(minPen, 0.4) * 0.5;
  a.p[0] -= n[0] * k; a.p[2] -= n[2] * k; b.p[0] += n[0] * k; b.p[2] += n[2] * k;
  const Pa = [px, a.p[1], pz], Pb = [px, b.p[1], pz];
  const va = a.velocityAt(Pa), vb = b.velocityAt(Pb);
  const vn = (vb[0] - va[0]) * n[0] + (vb[2] - va[2]) * n[2];
  if (vn >= 0) return 0;
  const e = 0.2 * Math.max(0.12, 1 + vn / 16);
  const invA=a.invMassAt(Pa,n),invB=b.invMassAt(Pb,n);
  const j = -(1 + e) * vn / (invA+invB);
  const lostEnergy = -.5*j*vn*(1-e)/(invA+invB);
  a.applyImpulse(Pa, [-n[0] * j, 0, -n[2] * j]);
  b.applyImpulse(Pb, [n[0] * j, 0, n[2] * j]);
  if (!a.lastHit || j > a.lastHit.j) a.lastHit = { P: Pa, n: [-n[0], 0, -n[2]], j, energy:lostEnergy*invA };
  if (!b.lastHit || j > b.lastHit.j) b.lastHit = { P: Pb, n: [n[0], 0, n[2]], j, energy:lostEnergy*invB };
  // a little friction between the bodies
  const tx = (vb[0] - va[0]) - vn * n[0], tz = (vb[2] - va[2]) - vn * n[2];
  const tl = Math.hypot(tx, tz);
  if (tl > 0.05) {
    const jt = Math.min(0.3 * j, tl / (a.invMassAt(Pa, [tx / tl, 0, tz / tl]) + b.invMassAt(Pb, [tx / tl, 0, tz / tl])));
    a.applyImpulse(Pa, [tx / tl * jt, 0, tz / tl * jt]);
    b.applyImpulse(Pb, [-tx / tl * jt, 0, -tz / tl * jt]);
  }
  return j;
}
