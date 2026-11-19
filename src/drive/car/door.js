// Doors that open.  The car body is one merged mesh, so a door is cut out of it on demand: the
// triangles of one side's door panel (and its window) are copied into a child mesh that swings about
// the front edge (hinge), and the originals are collapsed to the hinge while it is open.  Closing it
// writes the (possibly dented) triangles back.  Works with generated car bodies.
import * as THREE from 'three';

const DOOR_LEN = 1.05;
const TRIM = new THREE.MeshStandardMaterial({ color: 0x2b2c2f, roughness: 0.75, metalness: 0.05 });

// The door outline of this model: the front edge just behind the front wheel arch, the rear edge at the B-pillar
// (the back of the front side window), both snapped to the panel seams of the mesh when there are any.
export function doorRegion(model, side) {
  const ud = model.userData, S = ud.shape;
  ud._doorReg = ud._doorReg || {};
  if (ud._doorReg[side]) return ud._doorReg[side];
  const hw = S.W / 2, a = S.a ?? 1.2;
  // the front axle (the modelled wheels sit on it); the radius from the wheel mesh, which does not depend on its pose
  let r = 0.32;
  const wz = a;
  if (ud.wheels && ud.wheels[0]) {
    const b = new THREE.Box3().setFromObject(ud.wheels[0]);
    if (isFinite(b.max.y)) r = Math.max(0.24, Math.min(0.5, Math.max(b.max.y - b.min.y, b.max.x - b.min.x, b.max.z - b.min.z) / 2));
  }
  const arch = Math.min(wz - r - 0.08, S.wsBase + 0.3);
  const shell = ud.shell, geo = shell.geometry, P = geo.attributes.position.array;
  const mats = Array.isArray(shell.material) ? shell.material : [shell.material];
  const groups = geo.groups.length ? geo.groups : [{ start: 0, count: geo.attributes.position.count, materialIndex: 0 }];
  // side skin vertices in 1 cm bins: a panel seam is a vertical line (many vertices, tall), an arch lip is not
  const bins = new Map(), glassZ = [];
  for (const g of groups) {
    const isGlass = mats[g.materialIndex] && mats[g.materialIndex].userData && mats[g.materialIndex].userData.role === 'glass';
    for (let v = g.start; v < g.start + g.count; v++) {
      const x = P[v * 3] * side, y = P[v * 3 + 1], z = P[v * 3 + 2];
      if (x < hw - 0.38 || z > arch + 0.2 || z < arch - 2.6) continue;
      if (isGlass) { glassZ.push(z); continue; }
      if (x < hw - 0.2 || y < 0.3 || y > 1.05) continue;
      const k = Math.round(z * 100);
      let b = bins.get(k);
      if (!b) bins.set(k, b = { n: 0, y0: 9, y1: -9 });
      b.n++; b.y0 = Math.min(b.y0, y); b.y1 = Math.max(b.y1, y);
    }
  }
  // strongest tall seam in [lo, hi], traded against the distance from where it is expected
  const seam = (lo, hi, prefer, w = 0.9) => {
    const c = [];
    for (const [k, b] of bins) { const z = k / 100; if (z >= lo && z <= hi && b.y1 - b.y0 >= 0.35 && b.n >= 6) c.push([z, b.n * (b.y1 - b.y0)]); }
    if (!c.length) return null;
    const mx = Math.max(...c.map((x) => x[1]));
    let best = null, bs = -1e9;
    for (const [z, v] of c) { const sc = v / mx - w * Math.abs(z - prefer); if (sc > bs) { bs = sc; best = z; } }
    return best;
  };
  let zF = seam(arch - 0.8, arch + 0.05, arch - 0.05) ?? arch;
  // the rear edge: the B-pillar at the back of the front side window, or a seam 0.8-1.6 m behind
  let gR = null;
  if (glassZ.length > 6) {
    glassZ.sort((p, q) => q - p);
    let k = glassZ.findIndex((z) => z <= zF + 0.35);
    if (k >= 0) {
      let last = glassZ[k];
      for (; k < glassZ.length && last - glassZ[k] < 0.12; k++) last = glassZ[k];
      if (zF - last > 0.7 && zF - last < 1.7) gR = last;
    }
  }
  let zR = seam(zF - 1.6, zF - 0.8, gR ?? zF - DOOR_LEN, gR !== null ? 1.5 : 0.6) ?? (gR !== null ? gR - 0.02 : zF - DOOR_LEN);
  return (ud._doorReg[side] = { zF, zR, hw, side, y0: 0.24 });
}

// a vertex of a clipped polygon: position, normal, uv, damage
function vtx(a, nrm, uv, dm, vi) {
  return { p: [a[vi * 3], a[vi * 3 + 1], a[vi * 3 + 2]], n: [nrm[vi * 3], nrm[vi * 3 + 1], nrm[vi * 3 + 2]], u: uv ? [uv[vi * 2], uv[vi * 2 + 1]] : [0, 0], d: dm[vi] };
}
const lerpV = (A, B, t) => ({
  p: A.p.map((x, k) => x + (B.p[k] - x) * t), n: A.n.map((x, k) => x + (B.n[k] - x) * t), u: A.u.map((x, k) => x + (B.u[k] - x) * t), d: A.d + (B.d - A.d) * t,
});
// split a convex polygon by f(v) >= 0 (inside) / < 0 (outside)
function split(poly, f) {
  const inn = [], out = [];
  for (let i = 0; i < poly.length; i++) {
    const A = poly[i], B = poly[(i + 1) % poly.length], fa = f(A), fb = f(B);
    (fa >= 0 ? inn : out).push(A);
    if ((fa >= 0) !== (fb >= 0)) { const X = lerpV(A, B, fa / (fa - fb)); inn.push(X); out.push(X); }
  }
  return [inn.length >= 3 ? inn : null, out.length >= 3 ? out : null];
}

// geometry from polygons grouped by material, positions relative to an origin
function polyGeometry(polys, ox, oz) {
  const byMat = new Map();
  for (const [mi, poly] of polys) (byMat.get(mi) || byMat.set(mi, []).get(mi)).push(poly);
  const P = [], N = [], U = [], D = [];
  const g = new THREE.BufferGeometry();
  for (const [mi, list] of byMat) {
    const start = P.length / 3;
    for (const poly of list) for (let k = 1; k + 1 < poly.length; k++) for (const v of [poly[0], poly[k], poly[k + 1]]) {
      P.push(v.p[0] - ox, v.p[1], v.p[2] - oz); N.push(...v.n); U.push(...v.u); D.push(v.d);
    }
    const count = P.length / 3 - start;
    if (count) g.addGroup(start, count, mi);
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  g.setAttribute('aDmg', new THREE.Float32BufferAttribute(D, 1));
  g.computeBoundingSphere();
  return g;
}

/** where the driver sits and steps out, from the door opening (not from the eye point of the cockpit view):
 *  pelvis just ahead of the B-pillar, exit through the opening behind the swung door. Model-local. */
export function doorSeat(model, side = 1) {
  const S = model.userData.shape;
  if (!S) return null;
  const R = doorRegion(model, side);
  return { seat: [side * (R.hw - 0.45), R.zR + 0.3], exit: [side * (R.hw + 0.55), R.zR + 0.05], zF: R.zF, zR: R.zR, hw: R.hw };
}

function build(model, side) {
  const ud = model.userData, shell = ud.shell, geo = shell.geometry;
  const R = doorRegion(model, side);
  const pos = geo.attributes.position, a = pos.array, nrm = geo.attributes.normal.array;
  const uv = geo.attributes.uv ? geo.attributes.uv.array : null, dm = geo.attributes.aDmg.array;
  const nt = pos.count / 3;
  const groups = geo.groups.length ? geo.groups : [{ start: 0, count: pos.count, materialIndex: 0 }];
  const matOf = (t) => { for (const g of groups) if (t * 3 >= g.start && t * 3 < g.start + g.count) return g.materialIndex; return 0; };
  // the door outline: between the two pillars, above the sill, on this side's outer skin
  const planes = [(v) => R.zF - v.p[2], (v) => v.p[2] - R.zR, (v) => v.p[1] - R.y0];
  const inside = (x, y, z) => z <= R.zF && z >= R.zR && y >= R.y0;
  const doorPolys = [], patchPolys = [], tris = [];
  let hx = 0, hn = 0;
  for (let t = 0; t < nt; t++) {
    const i = t * 9;
    let nIn = 0, minSx = 1e9;
    for (let k = 0; k < 3; k++) { if (inside(a[i + k * 3], a[i + k * 3 + 1], a[i + k * 3 + 2])) nIn++; minSx = Math.min(minSx, a[i + k * 3] * side); }
    if (!nIn) continue;
    const cx = (a[i] + a[i + 3] + a[i + 6]) / 3;
    if (cx * side < R.hw - 0.24 || minSx < R.hw - 0.4) continue;
    // outward-facing side surfaces only (the sill, the roof rail and the inner panels stay)
    const nx = (nrm[i] + nrm[i + 3] + nrm[i + 6]) / 3 * side;
    if (nx < 0.25) continue;
    if (ud.hid && ud.hid[t * 3]) continue;
    const mi = matOf(t);
    const poly = [0, 1, 2].map((k) => vtx(a, nrm, uv, dm, t * 3 + k));
    if (nIn === 3) doorPolys.push([mi, poly]);
    else {
      // crossing the outline: the part inside goes with the door, the rest stays on the body as a patch
      let cur = poly;
      for (const f of planes) {
        if (!cur) break;
        const [inn, out] = split(cur, f);
        if (out) patchPolys.push([mi, out]);
        cur = inn;
      }
      if (cur) doorPolys.push([mi, cur]);
    }
    tris.push(t);
    const cz = (a[i + 2] + a[i + 5] + a[i + 8]) / 3;
    if (cz > R.zF - 0.25) { hx += cx; hn++; }
  }
  if (doorPolys.length < 20) return null;
  const hxm = hn ? hx / hn : side * R.hw;
  const hinge = new THREE.Vector3(hxm, 0, R.zF);
  const mesh = new THREE.Mesh(polyGeometry(doorPolys, hinge.x, hinge.z), shell.material);
  mesh.castShadow = true;
  const pivot = new THREE.Group();
  pivot.position.copy(hinge);
  pivot.add(mesh);
  pivot.visible = false;
  shell.add(pivot);
  // the inside of the door: a trim panel a few centimetres in, so the open door is not a hollow skin
  const mats = Array.isArray(shell.material) ? shell.material : [shell.material];
  const trimPolys = doorPolys.filter(([mi]) => !(mats[mi] && mats[mi].userData && mats[mi].userData.role === 'glass'))
    .map(([, poly]) => [0, poly.slice().reverse().map((v) => ({ p: [v.p[0] - side * 0.045, v.p[1], v.p[2]], n: [-v.n[0], -v.n[1], -v.n[2]], u: v.u, d: v.d }))]);
  if (trimPolys.length) {
    const trim = new THREE.Mesh(polyGeometry(trimPolys, hinge.x, hinge.z), TRIM);
    trim.castShadow = true;
    pivot.add(trim);
  }
  const patch = new THREE.Mesh(polyGeometry(patchPolys, 0, 0), shell.material);
  patch.castShadow = true; patch.visible = false;
  shell.add(patch);
  return { pivot, mesh, patch, tris, hinge, side, open: 0, hidden: false };
}

function hideOriginals(model, door) {
  const ud = model.userData, geo = ud.shell.geometry, a = geo.attributes.position.array, nv = geo.attributes.position.count;
  ud.hid = ud.hid || new Uint8Array(nv);
  ud.hidPos = ud.hidPos || new Float32Array(nv * 3);
  // the body as it is now (dents included), written back when the door closes
  door.orig = new Float32Array(door.tris.length * 9);
  door.tris.forEach((t, j) => {
    for (let k = 0; k < 9; k++) door.orig[j * 9 + k] = a[t * 9 + k];
    for (let k = 0; k < 3; k++) {
      const vi = t * 3 + k;
      ud.hid[vi] = 1; ud.hidPos[vi * 3] = door.hinge.x; ud.hidPos[vi * 3 + 1] = 0.5; ud.hidPos[vi * 3 + 2] = door.hinge.z;
      a[vi * 3] = door.hinge.x; a[vi * 3 + 1] = 0.5; a[vi * 3 + 2] = door.hinge.z;
    }
  });
  ud.hidAny = true;
  geo.attributes.position.needsUpdate = true;
  door.patch.visible = true;
  door.hidden = true;
}

function restoreOriginals(model, door) {
  const ud = model.userData, geo = ud.shell.geometry, a = geo.attributes.position.array;
  door.tris.forEach((t, j) => {
    for (let k = 0; k < 9; k++) a[t * 9 + k] = door.orig[j * 9 + k];
    if (ud.hid) for (let k = 0; k < 3; k++) ud.hid[t * 3 + k] = 0;
  });
  geo.attributes.position.needsUpdate = true;
  door.patch.visible = false;
  door.hidden = false;
}

/** open amount 0..1 of the door on `side` (+1 = left / driver's side in a left-hand-drive car) */
export function setDoor(model, side, amount) {
  const ud = model.userData;
  if (!ud.shell || !ud.shape) return false;
  ud.doors = ud.doors || {};
  let d = ud.doors[side];
  if (!d) {
    if (amount < 0.001) return false;
    model.userData.ownGeometry?.();
    d = ud.doors[side] = build(model, side);
    if (!d) { ud.doors[side] = { none: true }; return false; }
  }
  if (d.none) return false;
  const open = Math.max(0, Math.min(1, amount));
  if (open > 0.001 && !d.hidden) hideOriginals(model, d);
  if (open <= 0.001 && d.hidden) { restoreOriginals(model, d); d.pivot.visible = false; d.open = 0; return true; }
  d.pivot.visible = open > 0.001;
  d.pivot.rotation.y = -side * open * 1.1;   // ~63 degrees, rear edge swinging outwards
  d.open = open;
  return true;
}

/** after a repair: door state is gone with the geometry */
export function resetDoors(model) {
  const ud = model.userData;
  if (!ud.doors) return;
  for (const d of Object.values(ud.doors)) if (d.pivot) { d.pivot.removeFromParent(); d.mesh.geometry.dispose(); d.patch.removeFromParent(); d.patch.geometry.dispose(); }
  ud.doors = null;
}
