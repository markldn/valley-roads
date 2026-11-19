// Node/beam soft body solved with small-step XPBD (after ~/scripts/crashtest/src/soft.js, the
// BeamNG-style crash model calibrated against a real 1976 test).  Beams are force-limited: past
// their yield force they flow plastically - the rest length moves - which is where a crash's
// energy goes.  Compression yields before tension (thin sheet buckles), folded metal densifies,
// stretched metal tears.  Only what a car shell needs: no gravity, no friction, no node-node
// contact; obstacles are half-spaces or vertical cylinders (trunks, posts).
export function World(cap = 3000, bcap = 40000) {
  return {
    n: 0, nb: 0, t: 0,
    x: new Float64Array(cap * 3), v: new Float64Array(cap * 3), w: new Float64Array(cap), rest: new Float64Array(cap * 3),
    ba: new Int32Array(bcap), bb: new Int32Array(bcap), L0: new Float32Array(bcap), Lr: new Float32Array(bcap),
    bk: new Float32Array(bcap), fyc: new Float32Array(bcap), fyt: new Float32Array(bcap), brk: new Float32Array(bcap),
    bd: new Float32Array(bcap), alive: new Uint8Array(bcap), pl: new Float32Array(bcap),
    planes: [], energy: 0,
  };
}

export function addNode(W, p, mass) {
  const i = W.n++, k = i * 3;
  W.x[k] = W.rest[k] = p[0]; W.x[k + 1] = W.rest[k + 1] = p[1]; W.x[k + 2] = W.rest[k + 2] = p[2];
  W.w[i] = mass > 0 ? 1 / mass : 0;
  return i;
}

export function addBeam(W, a, b, m) {
  const j = W.nb++;
  const dx = W.x[a * 3] - W.x[b * 3], dy = W.x[a * 3 + 1] - W.x[b * 3 + 1], dz = W.x[a * 3 + 2] - W.x[b * 3 + 2];
  const L = Math.hypot(dx, dy, dz);
  W.ba[j] = a; W.bb[j] = b; W.L0[j] = W.Lr[j] = L;
  W.bk[j] = m.k; W.fyc[j] = m.fyc; W.fyt[j] = m.fyt; W.brk[j] = m.brk; W.bd[j] = m.damp ?? 0.6;
  W.alive[j] = 1; W.pl[j] = 0;
  return j;
}

// folded sheet stiffens as it compacts
const densify = (r) => (r > 0.45 ? 1 : 1 + (0.45 - r) * (0.45 - r) * 120);

function solveBeams(W, h2, rev) {
  const { x, w, ba, bb, L0, Lr, bk, fyc, fyt, brk, alive, pl } = W, nb = W.nb;
  for (let q = 0; q < nb; q++) {
    const j = rev ? nb - 1 - q : q;
    if (!alive[j]) continue;
    const a = ba[j] * 3, b = bb[j] * 3, wa = w[ba[j]], wb = w[bb[j]], ws = wa + wb;
    if (!ws) continue;
    let dx = x[a] - x[b], dy = x[a + 1] - x[b + 1], dz = x[a + 2] - x[b + 2];
    const L = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-9;
    let C = L - L0[j];
    const k = bk[j], comp = C < 0, Fy = comp ? fyc[j] * densify(L0[j] / Lr[j]) : fyt[j], ey = Fy / k;
    if (C > ey || C < -ey) {
      const flow = C > 0 ? C - ey : C + ey;
      let nl = L0[j] + flow;
      if (nl < Lr[j] * 0.22) nl = Lr[j] * 0.22;
      pl[j] += Math.abs(nl - L0[j]) / Lr[j];
      L0[j] = nl; C = L - nl;
      if (nl > Lr[j] * (1 + brk[j]) || pl[j] > brk[j] * 3) { alive[j] = 0; continue; }
    }
    const at = 1 / (k * h2);
    let dl = -C / (ws + at);
    const lim = Fy * h2 * 1.0001;
    if (dl > lim) dl = lim; else if (dl < -lim) dl = -lim;
    const s = dl / L;
    dx *= s; dy *= s; dz *= s;
    x[a] += dx * wa; x[a + 1] += dy * wa; x[a + 2] += dz * wa;
    x[b] -= dx * wb; x[b + 1] -= dy * wb; x[b + 2] -= dz * wb;
  }
}

function dampBeams(W, h) {
  const { x, v, w, ba, bb, bd, alive } = W;
  for (let j = 0; j < W.nb; j++) {
    if (!alive[j] || !bd[j]) continue;
    const a = ba[j] * 3, b = bb[j] * 3, wa = w[ba[j]], wb = w[bb[j]], ws = wa + wb;
    if (!ws) continue;
    let dx = x[a] - x[b], dy = x[a + 1] - x[b + 1], dz = x[a + 2] - x[b + 2];
    const L = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    dx /= L; dy /= L; dz /= L;
    const vr = (v[a] - v[b]) * dx + (v[a + 1] - v[b + 1]) * dy + (v[a + 2] - v[b + 2]) * dz;
    const c = vr * Math.min(1, bd[j] * h * 400) / ws;
    v[a] -= dx * c * wa; v[a + 1] -= dy * c * wa; v[a + 2] -= dz * c * wa;
    v[b] += dx * c * wb; v[b + 1] += dy * c * wb; v[b + 2] += dz * c * wb;
  }
}

// half-space obstacles: {p:[x,y,z], n:[nx,ny,nz]} (n points out of the solid); nodes of radius r are pushed out
function collide(W, r) {
  const { x, w } = W;
  for (const P of W.planes) {
    const [px, py, pz] = P.p, [nx, ny, nz] = P.n;
    if (P.cyl) {
      // a vertical post / trunk: nodes within its radius are pushed out radially (infinite height)
      const R = P.cyl + r;
      for (let i = 0; i < W.n; i++) {
        if (!w[i]) continue;
        const k = i * 3, dx = x[k] - px, dz = x[k + 2] - pz, d2 = dx * dx + dz * dz;
        if (d2 >= R * R) continue;
        const d = Math.sqrt(d2) || 1e-6, f = R / d;
        x[k] = px + dx * f; x[k + 2] = pz + dz * f;
      }
      continue;
    }
    for (let i = 0; i < W.n; i++) {
      if (!w[i]) continue;
      const k = i * 3;
      const d = (x[k] - px) * nx + (x[k + 1] - py) * ny + (x[k + 2] - pz) * nz - r;
      if (d < 0) { x[k] -= nx * d; x[k + 1] -= ny * d; x[k + 2] -= nz * d; }
    }
  }
}

export function step(W, dt, sub, nodeR = 0.05) {
  const h = dt / sub, h2 = h * h, n = W.n, x = W.x, v = W.v, w = W.w;
  const prev = step._p && step._p.length >= n * 3 ? step._p : (step._p = new Float64Array(n * 3));
  for (let s = 0; s < sub; s++) {
    for (let i = 0; i < n; i++) {
      if (!w[i]) continue;
      const k = i * 3;
      prev[k] = x[k]; prev[k + 1] = x[k + 1]; prev[k + 2] = x[k + 2];
      x[k] += v[k] * h; x[k + 1] += v[k + 1] * h; x[k + 2] += v[k + 2] * h;
    }
    solveBeams(W, h2, s & 1);
    collide(W, nodeR);
    for (let i = 0; i < n; i++) {
      if (!w[i]) continue;
      const k = i * 3;
      v[k] = (x[k] - prev[k]) / h; v[k + 1] = (x[k + 1] - prev[k + 1]) / h; v[k + 2] = (x[k + 2] - prev[k + 2]) / h;
    }
    dampBeams(W, h);
    // A positional contact correction can otherwise launch light, detached
    // nodes at several hundred m/s. Debris is simulated separately.
    for(let i=0;i<n;i++){
      const k=i*3;
      const speedSquared=v[k]*v[k]+v[k+1]*v[k+1]+v[k+2]*v[k+2];
      if(speedSquared>45*45){
        const factor=45/Math.sqrt(speedSquared);
        v[k]*=factor;v[k+1]*=factor;v[k+2]*=factor;
      }
    }
    W.t += h;
  }
}

export function kineticEnergy(W) {
  let e = 0;
  for (let i = 0; i < W.n; i++) {
    if (!W.w[i]) continue;
    const k = i * 3;
    e += 0.5 / W.w[i] * (W.v[k] * W.v[k] + W.v[k + 1] * W.v[k + 1] + W.v[k + 2] * W.v[k + 2]);
  }
  return e;
}
