// Physical crush for a car shell.  A node/beam lattice (15 cm grid) is built from the shell's own
// vertices: thin sheet skin, platform floor + side rails, firewall, engine block, bumper beams,
// roll-cage pillars, hubs.  On impact the lattice is thrown at the obstacle at the real closing
// speed and the XPBD solver (softbody.js) crushes it - beams yield, fold, densify - so crush depth
// and shape come from impact energy, not from a painted dent.  The shell rides the nodes by
// displacement skinning; the deformed shape then becomes the new rest shape, so crashes accumulate.
// Pure arrays in, arrays out (no THREE) so test/crush.mjs can calibrate it headless.
import { World, addNode, addBeam, step, kineticEnergy } from './softbody.js';

export const GH = 0.19;

// materials: k (N/m), compression / tension yield (N), break strain, damping
// Calibrated by test/crush.mjs: hatch into a rigid wall: 30 km/h ~0.3 m, 50 km/h ~0.45 m, 100 km/h ~1.1 m of crush.
export const MATS = {
  SHEET: { k: 3e6, fyc: 1500, fyt: 4500, brk: 0.6, damp: 0.6 },
  PILLAR: { k: 5e6, fyc: 4200, fyt: 9000, brk: 0.7, damp: 0.6 },
  FLOOR: { k: 6e6, fyc: 4200, fyt: 9000, brk: 0.8, damp: 0.6 },
  RAIL: { k: 9e6, fyc: 7000, fyt: 14000, brk: 0.8, damp: 0.6 },
  ENG: { k: 3e7, fyc: 4e5, fyt: 4e5, brk: 9, damp: 0.8 },
  MOUNT: { k: 8e6, fyc: 9000, fyt: 9000, brk: 0.7, damp: 0.6 },
  BUMPER: { k: 5e6, fyc: 3000, fyt: 6000, brk: 0.6, damp: 0.6 },
  BULK: { k: 6e6, fyc: 3500, fyt: 7000, brk: 0.7, damp: 0.6 },
  HUB: { k: 8e6, fyc: 2700, fyt: 5400, brk: 0.42, damp: 0.8 },
};
export const STRENGTH = { scale: 1.4 };   // one knob for the whole structure (calibration)
const CLS = { SHEET: 0, PILLAR: 1, FLOOR: 2, RAIL: 3, ENG: 4, BUMPER: 5, BULK: 6, HUB: 7 };
const MASSW = [1, 1.5, 2.2, 3.0, 0, 1.6, 1.3, 0];

export function powertrainLayout(shape,spec) {
  const front=spec.engine.layout==='front' || (!spec.engine.layout && spec.frontWeight>.5);
  const z=front?shape.a+.15:-shape.b+.55;
  return {z,halfWidth:Math.min(.34,shape.W*.23),halfLength:.42,lower:.30,upper:.72,front};
}

/**
 * @param pos Float32Array xyz of every shell vertex (shell-local: x left, y up, z forward, ground at y=0)
 * @param S   body shape ({a,b,zf,zr,wsBase,H,W,roofF,roofR,coupe}), spec car spec (mass, wheel, wheelbase, frontWeight, trackF/R)
 */
export function buildCrush(pos, S, spec) {
  const nv = pos.length / 3;
  // unique vertices (the shell mesh is non-indexed)
  const map = new Map(), uniq = [], vmap = new Uint32Array(nv);
  for (let i = 0; i < nv; i++) {
    const key = (Math.round(pos[i * 3] * 400) + 4000) * 64000000 + (Math.round(pos[i * 3 + 1] * 400) + 4000) * 8000 + (Math.round(pos[i * 3 + 2] * 400) + 4000);
    let u = map.get(key);
    if (u === undefined) { u = uniq.length; map.set(key, u); uniq.push(i); }
    vmap[i] = u;
  }
  const nu = uniq.length;
  const up = new Float32Array(nu * 3);
  for (let u = 0; u < nu; u++) { up.set(pos.subarray(uniq[u] * 3, uniq[u] * 3 + 3), u * 3); }
  // spatial hash of shell vertices
  const cell = GH, inv = 1 / cell;
  const vh = new Map();
  const ck = (i, j, k) => (i + 512) * 1048576 + (j + 512) * 1024 + (k + 512);
  for (let u = 0; u < nu; u++) {
    const key = ck(Math.floor(up[u * 3] * inv), Math.floor(up[u * 3 + 1] * inv), Math.floor(up[u * 3 + 2] * inv));
    let a = vh.get(key); if (!a) vh.set(key, a = []); a.push(u);
  }
  const nearestShell = (x, y, z) => {
    const ci = Math.floor(x * inv), cj = Math.floor(y * inv), ck2 = Math.floor(z * inv);
    let best = 1e9;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
      const l = vh.get(ck(ci + a, cj + b, ck2 + c)); if (!l) continue;
      for (const u of l) {
        const d = Math.hypot(up[u * 3] - x, up[u * 3 + 1] - y, up[u * 3 + 2] - z);
        if (d < best) best = d;
      }
    }
    return best;
  };
  // grid over the shell's bounding box
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (let u = 0; u < nu; u++) {
    const x = up[u * 3], y = up[u * 3 + 1], z = up[u * 3 + 2];
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
  }
  if (!(x1 - x0 < 12 && y1 - y0 < 8 && z1 - z0 < 20)) throw new Error(`crush lattice: implausible body bounds ${(x1 - x0).toFixed(1)} x ${(y1 - y0).toFixed(1)} x ${(z1 - z0).toFixed(1)} m`);
  const nx = Math.ceil((x1 - x0) / GH) + 1, ny = Math.ceil((y1 - y0) / GH) + 1, nz = Math.ceil((z1 - z0) / GH) + 1;
  const hw = S.W / 2, belt = 0.95;
  const engine=powertrainLayout(S,spec);
  const nodes = [], idx = new Map();
  const key = (i, j, k) => i + ',' + j + ',' + k;
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const x = x0 + i * GH - ((nx - 1) * GH - (x1 - x0)) / 2, y = y0 + j * GH, z = z0 + k * GH;
    const ax = Math.abs(x);
    let cls = -1;
    const eng = ax < engine.halfWidth && y > engine.lower && y < engine.upper && Math.abs(z-engine.z)<engine.halfLength;
    const floor = y < y0 + 0.36 && y > y0 + 0.06 && ax < hw - 0.05 && z > S.zr + 0.15 && z < S.zf - 0.15;
    const bulk = Math.abs(z - (S.wsBase - 0.2)) < 0.08 && y > 0.25 && y < belt + 0.1 && ax < hw - 0.1;
    const shell = nearestShell(x, y, z) < GH * 0.62;
    if (eng) cls = CLS.ENG;
    else if (floor && shell === false) cls = ax > 0.35 && ax < 0.66 ? CLS.RAIL : CLS.FLOOR;
    else if (bulk) cls = CLS.BULK;
    else if (shell) {
      if (z > S.zf - 0.28 || z < S.zr + 0.28) cls = CLS.BUMPER;
      else if (y > belt && z > S.zr + 0.5 && z < S.wsBase - 0.15) cls = CLS.PILLAR;
      else cls = CLS.SHEET;
    }
    if (cls < 0) continue;
    idx.set(key(i, j, k), nodes.length);
    nodes.push({ p: [x, y, z], cls, g: [i, j, k] });
  }
  const W = World(nodes.length + 16, nodes.length * 20 + 64);
  const wsum=nodes.reduce((sum,n)=>sum+(n.cls===CLS.ENG?0:MASSW[n.cls]),0);
  const engN = nodes.filter((n) => n.cls === CLS.ENG).length;
  const engMass = engN ? Math.min(190, spec.mass * 0.12) : 0;
  const wheelMass=Math.min(25,spec.mass*.025);
  const rest = spec.mass - engMass - wheelMass*4;
  for (const n of nodes) {
    const m = n.cls === CLS.ENG ? engMass / Math.max(1, engN) : MASSW[n.cls] / wsum * rest;
    n.id = addNode(W, n.p, m);
  }
  // hubs: one heavy node per wheel braced into the floor/rails
  const hubs = [];
  const trackF = spec.trackF / 2, trackR = spec.trackR / 2;
  for (const [hx, hz] of [[trackF, S.a], [-trackF, S.a], [trackR, -S.b], [-trackR, -S.b]]) {
    const id = addNode(W, [hx, spec.wheel.radius, hz], wheelMass);
    hubs.push(id);
    nodes.push({ p: [hx, spec.wheel.radius, hz], cls: CLS.HUB, g: null, id });
  }
  const scale = STRENGTH.scale;
  const mat = (a, b) => {
    if (a === CLS.ENG && b === CLS.ENG) return 'ENG';
    if (a === CLS.ENG || b === CLS.ENG) return 'MOUNT';
    if (a === CLS.RAIL && b === CLS.RAIL) return 'RAIL';
    if (a === CLS.RAIL || b === CLS.RAIL || a === CLS.FLOOR || b === CLS.FLOOR) return 'FLOOR';
    if (a === CLS.BUMPER || b === CLS.BUMPER) return 'BUMPER';
    if (a === CLS.BULK || b === CLS.BULK) return 'BULK';
    if (a === CLS.PILLAR && b === CLS.PILLAR) return 'PILLAR';
    return 'SHEET';
  };
  // the cabin cell is stronger than the crumple zones
  const zoneK = (z) => {
    const frontEdge = S.wsBase - 0.15, rearEdge = S.zr + 0.9;
    if (z > frontEdge + 0.5 || z < rearEdge - 0.0) return 1;
    return 1 + 1.6 * Math.min(1, Math.min((frontEdge + 0.5 - z) / 0.5, (z - rearEdge) / 0.5));
  };
  const addScaled = (a, b, m, f = 1) => {
    const z = (W.x[a * 3 + 2] + W.x[b * 3 + 2]) / 2, zk = zoneK(z) * (m.fyt > 1e5 ? 1 : scale) * f;
    return addBeam(W, a, b, { ...m, fyc: m.fyc * zk, fyt: m.fyt * zk });
  };
  for (const n of nodes) {
    if (!n.g) continue;
    const [i, j, k] = n.g;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
      const m = idx.get(key(i + a, j + b, k + c)); if (m === undefined) continue;
      const o = nodes[m];
      if (o.id <= n.id) continue;
      addScaled(n.id, o.id, MATS[mat(n.cls, o.cls)]);
    }
    for (const [a, b, c] of [[1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 0], [1, -1, 0], [0, 1, 1], [0, 1, -1], [1, 0, 1], [1, 0, -1]]) {
      const m = idx.get(key(i + a, j + b, k + c)), o2 = idx.get(key(i + 2 * a, j + 2 * b, k + 2 * c));
      if (m === undefined || o2 === undefined) continue;
      const o = nodes[o2], M = MATS[mat(n.cls, o.cls)];
      addScaled(n.id, o.id, { ...M, k: M.k * 0.5 }, 0.6);   // bending: resists the folding mechanism
    }
  }
  // hubs braced to the nearest platform nodes
  for (const h of hubs) {
    const hp = [W.x[h * 3], W.x[h * 3 + 1], W.x[h * 3 + 2]];
    const near = nodes.filter((o) => o.g && (o.cls === CLS.FLOOR || o.cls === CLS.RAIL || o.cls === CLS.SHEET || o.cls === CLS.ENG))
      .map((o) => [Math.hypot(o.p[0] - hp[0], o.p[1] - hp[1], o.p[2] - hp[2]), o])
      .sort((p, q) => p[0] - q[0]).slice(0, 8);
    for (const [, o] of near) addBeam(W, h, o.id, { ...MATS.HUB, fyc: MATS.HUB.fyc * scale, fyt: MATS.HUB.fyt * scale });
  }
  // skin: 4 nearest nodes per unique vertex (inverse-square weights); hubs excluded from skinning
  const nk = (i, j, k) => i * 1000003 + j * 1009 + k;
  const ics = 1 / (GH * 1.2);
  function makeBinder(basis) {
    const nh = new Map();
    nodes.forEach((n, ni) => {
      if (!n.g) return;
      const j = n.id * 3;
      const key = nk(Math.floor(basis[j] * ics), Math.floor(basis[j+1] * ics), Math.floor(basis[j+2] * ics));
      let list = nh.get(key);
      if (!list) nh.set(key, list = []);
      list.push(ni);
    });
    return function bind(points) {
      const count = points.length / 3;
      const SJ = new Int32Array(count * 4), SW = new Float32Array(count * 4);
      for (let u = 0; u < count; u++) {
        const px = points[u * 3], py = points[u * 3 + 1], pz = points[u * 3 + 2];
        const ci = Math.floor(px * ics), cj = Math.floor(py * ics), ckk = Math.floor(pz * ics);
        let cand = [];
        for (let R = 1; R <= 3 && cand.length < 4; R++) {
          cand = [];
          for (let a = -R; a <= R; a++) for (let b = -R; b <= R; b++) for (let c = -R; c <= R; c++) {
            const l = nh.get(nk(ci + a, cj + b, ckk + c)); if (!l) continue;
            for (const ni of l) {
              const j = nodes[ni].id * 3;
              const d = Math.hypot(basis[j] - px, basis[j+1] - py, basis[j+2] - pz);
              cand.push([d, ni]);
            }
          }
        }
        cand.sort((p, q) => p[0] - q[0]);
        const use = cand.slice(0, 4);
        let s = 0;
        use.forEach(([d, ni], k) => {
          const w = 1 / (d * d + 0.0025);
          SJ[u * 4 + k] = nodes[ni].id; SW[u * 4 + k] = w; s += w;
        });
        for (let k = 0; k < 4; k++) SW[u * 4 + k] /= s || 1;
      }
      return { SJ, SW };
    };
  }
  const rest0 = Float64Array.from(W.rest.subarray(0, W.n * 3));
  const { SJ, SW } = makeBinder(rest0)(up);
  return {
    W, nodes, hubs, nu, nv, vmap, up, SJ, SW, rest0, makeStructureBinder: () => makeBinder(rest0),
    burst: null, mass: spec.mass, pristine: Float32Array.from(pos), S,
    restUnique: Float32Array.from(up),
  };
}

/** Throw the car at a half-space: contact point P and outward obstacle normal n (obstacle -> car), shell-local. */
export function beginCrush(C, P, n, speed, cyl = null) {
  const W = C.W;
  const nl = Math.hypot(n[0], n[1], n[2]) || 1;
  const nn = [n[0] / nl, n[1] / nl, n[2] / nl];
  if (cyl) {
    // narrow obstacle (tree, pole): a vertical cylinder of radius cyl.r centred at cyl.c = [x, z] (shell-local).
    // Move it back until no node starts inside, so the solver does not eject the lattice violently.
    let offset = 0;
    const horizontal = Math.hypot(nn[0], nn[2]) || 1;
    const nx = nn[0] / horizontal, nz = nn[2] / horizontal;
    const radius = cyl.r + .053;
    for (let i = 0; i < W.n; i++) {
      const k = i * 3, dx = W.x[k] - cyl.c[0], dz = W.x[k + 2] - cyl.c[1];
      const lateral = dx * nz - dz * nx;
      if (Math.abs(lateral) >= radius) continue;
      const longitudinal = dx * nx + dz * nz;
      offset = Math.max(offset, Math.sqrt(radius * radius - lateral * lateral) - longitudinal);
    }
    const cx = cyl.c[0] - nx * offset, cz = cyl.c[1] - nz * offset;
    W.planes = [{ cyl: cyl.r, p: [cx, 0, cz], n: nn }];
    for (let i = 0; i < W.n; i++) { W.v[i * 3] = -nn[0] * speed; W.v[i * 3 + 1] = -nn[1] * speed; W.v[i * 3 + 2] = -nn[2] * speed; }
    C.dir = [-nn[0], -nn[1], -nn[2]]; C.nn = nn;
    const order = [];
    for (const nd of C.nodes) { if (!nd.g) continue; const k = nd.id * 3; order.push([C.rest0[k] * C.dir[0] + C.rest0[k + 1] * C.dir[1] + C.rest0[k + 2] * C.dir[2], nd.id]); }
    order.sort((p, q) => p[0] - q[0]);
    C.refNodes = order.slice(0, Math.max(6, Math.floor(order.length * 0.12))).map((o) => o[1]);
    // a pole loads one column of structure and none of the side rails: weaker than the wall it was tuned on
    C.poleMul = 0.62;
    for (let j = 0; j < W.nb; j++) { W.fyc[j] *= C.poleMul; W.fyt[j] *= C.poleMul; }
    C.burst = { t: 0, e0: kineticEnergy(W), speed, depth: 0, peakG: 0, maxT: 0.2 };
    C.skinLimit = Math.min(1.7, 0.5 + 0.045 * speed);
    return;
  }
  // the obstacle is a half-space whose outward normal is n (towards the car); its face passes through P
  // the contact point comes from a 2-D footprint test, so the plane can cut through the lattice:
  // slide it back until no node starts inside the obstacle (else the solver ejects them violently)
  let dmin = 0;
  for (let i = 0; i < W.n; i++) {
    const k = i * 3;
    const d = (W.x[k] - P[0]) * nn[0] + (W.x[k + 1] - P[1]) * nn[1] + (W.x[k + 2] - P[2]) * nn[2];
    if (d < dmin) dmin = d;
  }
  W.planes = [{ p: [P[0] + nn[0] * dmin, P[1] + nn[1] * dmin, P[2] + nn[2] * dmin], n: nn }];
  // the car moves INTO the wall, i.e. against n
  for (let i = 0; i < W.n; i++) {
    W.v[i * 3] = -nn[0] * speed; W.v[i * 3 + 1] = -nn[1] * speed; W.v[i * 3 + 2] = -nn[2] * speed;
  }
  C.dir = [-nn[0], -nn[1], -nn[2]];
  C.nn = nn;
  // far side of the car (away from the impact): its mean displacement is rigid drift, removed from the skin
  const order = [];
  for (const nd of C.nodes) {
    if (!nd.g) continue;
    const k = nd.id * 3;
    order.push([C.rest0[k] * C.dir[0] + C.rest0[k + 1] * C.dir[1] + C.rest0[k + 2] * C.dir[2], nd.id]);
  }
  order.sort((p, q) => p[0] - q[0]);
  C.refNodes = order.slice(0, Math.max(6, Math.floor(order.length * 0.12))).map((o) => o[1]);
  C.burst = { t: 0, e0: kineticEnergy(W), speed, depth: 0, peakG: 0, maxT: 0.16 };
  C.skinLimit = Math.min(1.3, 0.5 + 0.03 * speed);
}

/** Advance an active crush by dt (s) of simulated time; returns true while still moving. */
export function stepCrush(C, dt = 0.004, sub = 4) {
  const B = C.burst; if (!B) return false;
  const W = C.W;
  const v0 = vAlong(W, C.dir);
  step(W, dt, sub);
  B.t += dt;
  const v1 = vAlong(W, C.dir);
  const g = Math.abs(v1 - v0) / dt / 9.81; if (g > B.peakG) B.peakG = g;
  const ke = kineticEnergy(W);
  // done when the car has stopped or is leaving the obstacle (rebound), or the time budget is spent
  if (B.t >= B.maxT || ke < B.e0 * 0.004 || (B.t > 0.012 && vAlong(W, C.dir) <= 0.02 * B.speed)) {
    // freeze: take the rigid drift out, the deformed shape becomes the rest shape, nodes at rest
    const r = refDrift(C);
    let depth = 0;
    for (let i = 0; i < W.n; i++) {
      const k = i * 3;
      let dx=W.x[k]-r[0]-C.rest0[k], dy=W.x[k+1]-r[1]-C.rest0[k+1], dz=W.x[k+2]-r[2]-C.rest0[k+2];
      const displacement=Math.hypot(dx,dy,dz);
      const limit=C.skinLimit||.8;
      if(displacement>limit){
        const fraction=limit/displacement;
        dx*=fraction;dy*=fraction;dz*=fraction;
      }
      W.x[k]=C.rest0[k]+dx; W.x[k+1]=C.rest0[k+1]+dy; W.x[k+2]=C.rest0[k+2]+dz;
      W.v[k] = W.v[k + 1] = W.v[k + 2] = 0;
      const d = (W.x[k] - C.rest0[k]) * C.nn[0] + (W.x[k + 1] - C.rest0[k + 1]) * C.nn[1] + (W.x[k + 2] - C.rest0[k + 2]) * C.nn[2];
      if (d > depth) depth = d;
    }
    C.lastDepth = depth;
    // wheel mounts: how far each hub moved, and how much of the structure bracing it yielded or tore
    C.hubResults = C.hubs.map((h) => {
      const k = h * 3;
      const offset=[0,1,2].map(axis=>W.x[k+axis]-C.rest0[k+axis]);
      const disp = Math.hypot(...offset);
      let n = 0, sum = 0, torn=0;
      for (let j = 0; j < W.nb; j++) {
        if (W.ba[j] !== h && W.bb[j] !== h) continue;
        n++; sum += W.alive[j] ? Math.min(1, W.pl[j] * 2.5) : 1;
        if(!W.alive[j]) torn++;
      }
      return {offset,damage:Math.min(1,Math.max(disp/.4,n?(sum/n)*1.3:0)),
        failed:n>0&&(torn/n>=.62 || (torn/n>=.34&&disp>.22))};
    });
    let engineTravel=0,engineNodes=0;
    for(const node of C.nodes){
      if(node.cls!==CLS.ENG) continue;
      const k=node.id*3;
      engineTravel+=Math.hypot(W.x[k]-C.rest0[k],W.x[k+1]-C.rest0[k+1],W.x[k+2]-C.rest0[k+2]);
      engineNodes++;
    }
    C.engineDamage=Math.min(1,engineTravel/(Math.max(1,engineNodes)*.30));
    W.rest.set(W.x.subarray(0, W.n * 3));
    W.planes = [];
    if (C.poleMul) { const m = 1 / C.poleMul; for (let j = 0; j < W.nb; j++) { W.fyc[j] *= m; W.fyt[j] *= m; } C.poleMul = 0; }
    C.burst = null;
    return false;
  }
  return true;
}

function vmean(W) { return vAlong(W, [1, 0, 0]); }
// mass-weighted mean velocity along dir
function vAlong(W, d) {
  let s = 0, m = 0;
  for (let i = 0; i < W.n; i++) {
    const w = W.w[i]; if (!w) continue;
    const k = i * 3;
    s += (W.v[k] * d[0] + W.v[k + 1] * d[1] + W.v[k + 2] * d[2]) / w; m += 1 / w;
  }
  return m ? s / m : 0;
}

/**
 * Write current node displacement into unique-vertex positions (out: Float32Array nu*3) and return
 * a per-unique-vertex damage 0..1 (displacement from the pristine shape).
 */
function refDrift(C) {
  const { W, rest0, refNodes } = C;
  let x = 0, y = 0, z = 0;
  for (const i of refNodes) { const k = i * 3; x += W.x[k] - rest0[k]; y += W.x[k + 1] - rest0[k + 1]; z += W.x[k + 2] - rest0[k + 2]; }
  const n = refNodes.length || 1;
  return [x / n, y / n, z / n];
}

// per-node damage from the plastic strain of the beams meeting there (broken beams count fully)
function nodeStrain(C) {
  const { W } = C;
  const acc = C.strainAcc || (C.strainAcc = new Float32Array(W.n)), cnt = C.strainCnt || (C.strainCnt = new Float32Array(W.n));
  acc.fill(0); cnt.fill(0);
  for (let j = 0; j < W.nb; j++) {
    const s = W.alive[j] ? Math.min(1, W.pl[j] * 2.5) : 1;
    const a = W.ba[j], b = W.bb[j];
    acc[a] += s; cnt[a]++; acc[b] += s; cnt[b]++;
  }
  for (let i = 0; i < W.n; i++) if (cnt[i]) acc[i] /= cnt[i];
  return acc;
}

export function skinStructure(C, binding, rest, out) {
  const {W, rest0} = C;
  const {SJ, SW} = binding;
  const drift = C.refNodes ? refDrift(C) : [0,0,0];
  for (let i = 0; i < rest.length / 3; i++) {
    for (let axis = 0; axis < 3; axis++) {
      let displacement = 0;
      for (let k = 0; k < 4; k++) {
        const j = SJ[i * 4 + k] * 3 + axis;
        displacement += SW[i * 4 + k] * (W.x[j] - rest0[j] - drift[axis]);
      }
      const limit = C.skinLimit || .8;
      out[i * 3 + axis] = rest[i * 3 + axis] + Math.max(-limit, Math.min(limit, displacement));
    }
  }
}

export function skin(C, out, dmgOut) {
  const { W, SJ, SW, nu, restUnique, rest0 } = C;
  const r = C.refNodes ? refDrift(C) : [0, 0, 0];
  const strain = nodeStrain(C);
  for (let u = 0; u < nu; u++) {
    let dx = 0, dy = 0, dz = 0, dm = 0;
    for (let k = 0; k < 4; k++) {
      const w = SW[u * 4 + k]; if (!w) continue;
      const n = SJ[u * 4 + k] * 3;
      const ex = W.x[n] - rest0[n] - r[0], ey = W.x[n + 1] - rest0[n + 1] - r[1], ez = W.x[n + 2] - rest0[n + 2] - r[2];
      dx += w * ex; dy += w * ey; dz += w * ez;
      dm += w * strain[SJ[u * 4 + k]];
    }
    // a skin point never travels further than the crash can explain: torn lattices must not drag the
    // shell into spikes, but a 100 km/h pole crash folds the whole nose back (1.6 m)
    const dl = Math.hypot(dx, dy, dz), lim = C.skinLimit || 0.8;
    if (dl > lim) { const k = lim / dl; dx *= k; dy *= k; dz *= k; }
    // a wreck rests on the road, it does not sink into it: the skin never goes down more than a few
    // centimetres, and never below the ground plane of the shell frame
    if (dy < -0.12) dy = -0.12;
    out[u * 3] = restUnique[u * 3] + dx; out[u * 3 + 1] = Math.max(restUnique[u * 3 + 1] + dy, Math.min(restUnique[u * 3 + 1], 0.04)); out[u * 3 + 2] = restUnique[u * 3 + 2] + dz;
    if (dmgOut) dmgOut[u] = Math.min(0.9, dm * 1.3);
  }
}

/** Make the current deformation the new rest shape (so crashes accumulate). `cur` = unique positions. */
export function commit(C, cur) {
  C.restUnique.set(cur);
  C.rest0.set(C.W.x.subarray(0, C.W.n * 3));
}
