// Public transport and taxi ranks for a streamed sector: bus, tram and train stops, the rail
// and tram tracks, and taxi ranks. Vehicles (bus, tram, train) carry a full interior with a
// driver and passengers. Positions come from OSM (tools/hs/extract_transit.py); the model
// dimensions are estimates of typical French vehicles, not survey data.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const mat = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: .7, metalness: 0, ...o });
export const MAT = {
  ballast: mat(0x8c8a84), rail: mat(0x7d838a, { roughness: .45, metalness: .75 }), tie: mat(0x5a4632),
  pole: mat(0x6f7780, { roughness: .5, metalness: .6 }), sign: mat(0x0a6ebd), signWhite: mat(0xf4f4f4),
  shelter: mat(0x9fb7c4, { transparent: true, opacity: .35, roughness: .2 }), concrete: mat(0xb9b5ad),
  taxi: mat(0xf2b705), taxiDark: mat(0x1d1d1d), tram: mat(0xd8dde2), tramStripe: mat(0x2b6cb0),
  bus: mat(0xe6e9ec), busStripe: mat(0xc0392b), train: mat(0xf1f1ee), trainStripe: mat(0xd35400),
  glass: mat(0x9cc7d6, { transparent: true, opacity: .32, roughness: .15 }),
  seat: mat(0x2e3d52), floor: mat(0x3b3b3b), handrail: mat(0xb8bec4, { metalness: .7, roughness: .35 }),
  cabin: mat(0x222831), wheel: mat(0x151515), skin: mat(0xe0b08a), hair: mat(0x3a2a20),
  shirtBlue: mat(0x2f5e9e), shirtRed: mat(0xa23a33), shirtGreen: mat(0x3f7a4f), coat: mat(0x4a4f58),
  trousers: mat(0x2a2f38), uniform: mat(0x1f3b6f), cap: mat(0x14233f),
};

/** Collects geometries per material and merges each material into one mesh (few draw calls). */
class Bucket {
  constructor() { this.parts = new Map(); }
  add(geometry, material, matrix) {
    if (matrix) geometry.applyMatrix4(matrix);
    if (!this.parts.has(material)) this.parts.set(material, []);
    this.parts.get(material).push(geometry);
    return this;
  }
  box(w, h, d, x, y, z, material, yaw = 0) {
    const g = new THREE.BoxGeometry(w, h, d);
    return this.add(g, material, new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(1, 1, 1)));
  }
  cyl(r, h, x, y, z, material) {
    return this.add(new THREE.CylinderGeometry(r, r, h, 8), material, new THREE.Matrix4().makeTranslation(x, y, z));
  }
  group(name) {
    const group = new THREE.Group(); group.name = name;
    for (const [material, list] of this.parts) {
      const merged = mergeGeometries(list, false);
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, material);
      mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh);
    }
    return group;
  }
}

/** A figure seated (or standing) at a point: torso, head, hair. Enough to read as a person from the seat. */
function person(b, x, y, z, shirt, { seated = false, yaw = 0, hair = MAT.hair } = {}) {
  const h = seated ? .95 : 1.7;
  b.box(.36, seated ? .5 : .62, .22, x, y + (seated ? .75 : .95), z, shirt, yaw);
  b.box(.14, seated ? .45 : .8, .16, x, y + (seated ? .35 : .45), z, MAT.trousers, yaw);
  b.cyl(.12, .2, x, y + h - .1, z, MAT.skin);
  b.box(.27, .09, .24, x, y + h - .02, z, hair, yaw);
}

/** Spec per vehicle kind. Lengths and heights are typical values, used only for layout. */
const SPEC = {
  bus: { length: 12, width: 2.5, height: 3.2, floorY: .36, body: MAT.bus, stripe: MAT.busStripe, seatRows: 9, doors: [4.65, -.6] },
  tram: { length: 30, width: 2.65, height: 3.4, floorY: .35, body: MAT.tram, stripe: MAT.tramStripe, seatRows: 16, doors: [-6, 2, 10] },
  train: { length: 24, width: 3, height: 3.6, floorY: .5, body: MAT.train, stripe: MAT.trainStripe, seatRows: 12, doors: [-10, 10] },
};

/**
 * A vehicle with its interior, built at the origin and facing +z (the driver is at the front).
 * Callers place and orient it with position and rotation.y.
 */
export function buildVehicle(kind, { passengers = 6, rng = Math.random, models = null, dimensions, wheels = true, driver = true, route } = {}) {
  const model = models?.[kind] || null;   // a downloaded body, if one exists for this kind (not for buses)
  const s = { ...(SPEC[kind] || SPEC.bus), ...dimensions };
  const L = s.length, W = s.width, H = s.height, half = L / 2;
  const ext = new Bucket(), inn = new Bucket();

  // Exterior shell: body, roof, bumpers, stripe, wheels. Lower body is opaque, upper is glazed.
  ext.box(W, H * .55, L, 0, H * .275 + .3, 0, s.body);
  ext.box(W - .05, H * .3, L - .6, 0, H * .85 + .3, 0, MAT.glass);
  ext.box(W + .02, .22, L, 0, H * .58 + .3, 0, s.stripe);
  ext.box(W + .04, .4, .28, 0, .35, half - .1, MAT.cabin);
  ext.box(W + .04, .4, .28, 0, .35, -half + .1, MAT.cabin);
  for (const wz of [-half + 2.2, half - 2.6]) for (const wx of [-W / 2 + .1, W / 2 - .1]) {
    ext.add(new THREE.CylinderGeometry(.45, .45, .3, 10).rotateZ(Math.PI / 2), MAT.wheel, new THREE.Matrix4().makeTranslation(wx, .45, wz));
  }

  // Interior: floor, ceiling, side-facing bench seats in pairs down the aisle, handrails, poles.
  inn.box(W - .15, .05, L - .3, 0, s.floorY, 0, MAT.floor);
  inn.box(W - .15, .05, L - .3, 0, H - .15, 0, MAT.concrete);
  for (const sx of [-1, 1]) inn.box(.07, .028, L - .55, sx * .34, H - .18, 0, MAT.signWhite);
  for (const sx of [-1, 1]) inn.box(.05, .08, L - .4, sx * (W / 2 - .18), 1.45, 0, MAT.handrail);
  const rowZ0 = -half + 2.6, rowZ1 = half - 2.2, step = (rowZ1 - rowZ0) / (s.seatRows - 1);
  const seats = [];
  for (let r = 0; r < s.seatRows; r++) {
    const z = rowZ0 + r * step;
    for (const sx of [-1, 1]) {
      if (sx < 0 && s.doors.some(d => Math.abs(d - z) < .83)) continue;
      const x = sx * (W / 2 - .42);
      inn.box(.5, .42, .6, x, s.floorY + .25, z, MAT.seat);
      inn.box(.50, .63, .09, x, s.floorY + .58, z - .27, MAT.seat);
      inn.box(.05, .13, .32, x - sx * .25, s.floorY + .49, z, MAT.handrail);
      seats.push({ x, z, r, sx });
    }
    if (r % 3 === 0) inn.cyl(.029, H - .54, .36, (H - .18 + s.floorY) / 2, z, MAT.handrail);
  }
  // Doors (visual) on the body.
  for (const dz of s.doors) {
    inn.box(.45, .035, 1.22, -W / 2 + .24, s.floorY + .02, dz, MAT.signWhite);
    inn.cyl(.032, 2.1, -W / 2 + .23, s.floorY + 1.05, dz - .76, MAT.handrail);
  }   // doors on the right (-x when facing +z)

  // Driver cab at the front: seat, wheel, dashboard, and a driver in uniform.
  const dz = half - 1.5;
  inn.box(.55, .42, .55, W / 4, s.floorY + .25, dz, MAT.cabin);                // the driver sits on the left
  inn.box(.55, .6, .10, W / 4, s.floorY + .65, dz - .25, MAT.cabin);
  inn.box(.055, .93, .77, .23, s.floorY + .48, dz - .10, MAT.cabin);
  inn.box(.18, .16, .24, -.14, s.floorY + .93, dz + .54, MAT.sign);
  inn.box(W - .5, .55, .35, 0, s.floorY + .4, dz + .6, MAT.cabin);
  inn.add(new THREE.TorusGeometry(.2, .03, 6, 12).rotateX(Math.PI / 2), MAT.wheel, new THREE.Matrix4().makeTranslation(W / 4, s.floorY + 1.05, dz + .3));
  if (driver) person(inn, W / 4, s.floorY + .25, dz - .05, MAT.uniform, { seated: true, hair: MAT.cap });

  // Passengers, placed on free seats first, then standing near the poles. Deterministic per call with rng.
  const crowd = [MAT.shirtBlue, MAT.shirtRed, MAT.shirtGreen, MAT.coat];
  const free = seats.filter((_, i) => i % 3 !== 0);
  const picked = [];
  for (let i = 0; i < Math.min(passengers, free.length); i++) {
    const k = Math.floor(rng() * free.length); picked.push(free.splice(k, 1)[0]);
  }
  for (const seat of picked) {
    person(inn, seat.x, s.floorY, seat.z, crowd[Math.floor(rng() * crowd.length)], { seated: true, yaw: 0 });
  }
  for (let i = 0; i < Math.max(0, passengers - picked.length); i++) {
    const x = (rng() - .5) * (W - 1), z = rowZ0 + rng() * (rowZ1 - rowZ0);
    person(inn, x, s.floorY, z, crowd[Math.floor(rng() * crowd.length)]);
  }

  const group = new THREE.Group();
  group.name = `${kind}-vehicle`;
  group.add(model ? bodyFromModel(model, W, H, L) : kind === 'bus' ? buildBusBody({ W, H, L, wheels, route }) : ext.group('exterior'));
  const interior = inn.group('interior');
  interior.visible = true;
  group.add(interior);
  group.userData = { kind, length: L, width: W, height: H, floorY: s.floorY, seats, doors: group.children[0].userData.doors, driverSeat: new THREE.Vector3(W / 4, s.floorY + .5, dz) };
  return group;
}

// ---------------------------------------------------------------- city bus body
const BUS = {
  white: mat(0xf2f4f5, { roughness: .35, metalness: .1 }), skirt: mat(0x1f5fa8, { roughness: .4 }), accent: mat(0x37b24d, { roughness: .4 }),
  trim: mat(0x15171b, { roughness: .6 }), glass: mat(0x1d2a33, { transparent: true, opacity: .30, roughness: .08, metalness: .3 }),
  door: mat(0x24343e, { transparent: true, opacity: .32, roughness: .1, metalness: .3 }), rubber: mat(0x111111, { roughness: .9 }),
  hub: mat(0xb7bcc2, { roughness: .35, metalness: .7 }), roofUnit: mat(0xd9dcdf, { roughness: .5 }),
  head: new THREE.MeshStandardMaterial({ color: 0xfff6e0, emissive: 0xfff2cc, emissiveIntensity: .6 }),
  tail: new THREE.MeshStandardMaterial({ color: 0x9a1010, emissive: 0xc01010, emissiveIntensity: .5 }),
  amber: new THREE.MeshStandardMaterial({ color: 0xd88a10, emissive: 0xd88a10, emissiveIntensity: .3 }),
};
const busSigns = new Map();
/** the LED destination display: line number and destination (displayed on the front of the bus) */
export function busSign(ref = '', to = 'Local') {
  const key = `${ref}|${to}`;
  if (busSigns.has(key)) return busSigns.get(key);
  const c = document.createElement('canvas'); c.width = 512; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#0b0b0b'; g.fillRect(0, 0, 512, 64);
  g.fillStyle = '#ffb21e'; g.textBaseline = 'middle';
  g.font = 'bold 44px monospace';
  if (ref) g.fillText(String(ref).slice(0, 6), 14, 34);
  const x0 = ref ? 22 + g.measureText(String(ref).slice(0, 6)).width + 18 : 14;
  let size = 40;
  const text = String(to).toUpperCase();
  do { g.font = `bold ${size}px monospace`; size -= 2; } while (g.measureText(text).width > 500 - x0 && size > 16);
  g.fillText(text, x0, 34);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.MeshStandardMaterial({ map: t, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: .9 });
  m.userData.sign = true;
  busSigns.set(key, m);
  return m;
}

/**
 * A 12 m low-floor city bus body facing +z, base at y = 0: white body with a blue skirt and a green accent,
 * a raked windscreen with the destination display, side glazing between black pillars, two double doors on the
 * right (-x), rubber-edged wheel arches, an air-conditioning pod and mirror arms.  `wheels: false` leaves the
 * wheels to the caller (the drivable bus uses the physics car's own wheels).
 */
export function buildBusBody({ W = 2.55, H = 3.05, L = 12, wheels = true, route = [] } = {}) {
  const b = new Bucket(), half = L / 2, hw = W / 2;
  const sill = .38, belt = 1.18, top = H - .28;
  const axF = half - 2.7, axR = -half + 3.4, R = .5;
  const doors = [half - 1.35, -.6];
  const bands = (start, end, gaps, paint) => {
    for (const [low, high] of gaps.sort((a,b)=>a[0]-b[0])) {
      if (low > start) paint(start, Math.min(low,end));
      start = Math.max(start,high);
      if (start >= end) return;
    }
    if (start < end) paint(start,end);
  };
  for (const side of [-1,1]) {
    const doorGaps = side < 0 ? doors.map(z=>[z-.64,z+.64]) : [];
    const panel = (y,h,material,gaps) => bands(-half+.1,half-.12,gaps,(a,z)=>{
      b.box(.06,h,z-a,side*(hw-.03),y,(a+z)/2,material);
    });
    panel((sill+belt)/2,belt-sill,BUS.white,[...doorGaps]);
    panel(sill+.14,.28,BUS.skirt,[...doorGaps,...[axR,axF].map(z=>[z-.58,z+.58])]);
    panel(belt-.1,.09,BUS.accent,[...doorGaps]);
    panel((belt+top)/2,top-belt,BUS.glass,[...doorGaps]);
    for (let z=-half+.7; z<half-1.2; z+=1.45)
      if (!doorGaps.some(([a,b])=>z>a-.06&&z<b+.06))
        b.box(.075,top-belt,.09,side*(hw-.025),(belt+top)/2,z,BUS.trim);
  }
  b.box(W, H - top, L - .2, 0, (top + H) / 2, -.05, BUS.white);
  b.box(W - .3, .06, L - .5, 0, H + .03, -.05, BUS.roofUnit);
  b.box(1.7, .3, 3.0, 0, H + .18, -1.2, BUS.roofUnit);
  b.box(1.1, .22, 1.2, 0, H + .14, -half + 1.4, BUS.roofUnit);
  // front: raked windscreen, destination display, headlights, black bumper, mirror arms
  const fz = half - .12;
  const ws = new THREE.BoxGeometry(W - .1, top - .95, .05);
  b.add(ws, BUS.glass, new THREE.Matrix4().compose(new THREE.Vector3(0, (top + .95) / 2, fz - .08), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -.08), new THREE.Vector3(1, 1, 1)));
  b.box(W - .2, .3, .06, 0, top - .02, fz + .02, busSign(...route));
  b.box(W, H - top + .02, .1, 0, (top + H) / 2, fz - .05, BUS.white);
  b.box(W, .55, .12, 0, sill + .27, fz + .02, BUS.trim);
  for (const sx of [-1, 1]) {
    b.box(.38, .14, .05, sx * (hw - .3), .72, fz + .05, BUS.head);
    b.box(.12, .1, .05, sx * (hw - .08), .72, fz + .05, BUS.amber);
    b.box(.05, .05, .65, sx * (hw + .3), top - .1, fz - .2, BUS.trim);                        // mirror arm
    b.box(.08, .42, .22, sx * (hw + .3), top - .4, fz + .1, BUS.trim);
  }
  // rear: window, engine grille, lights
  const rz = -half + .1;
  b.box(W, .92, .11, 0, .84, rz, BUS.white);
  b.box(W - .3, .7, .05, 0, top - .45, rz - .02, BUS.glass);
  b.box(W - .5, .5, .05, 0, .75, rz - .02, BUS.trim);
  for (const sx of [-1, 1]) { b.box(.22, .5, .05, sx * (hw - .2), 1.1, rz - .03, BUS.tail); b.box(.18, .12, .05, sx * (hw - .2), .78, rz - .03, BUS.amber); }
  for (const z of doors) b.box(.09,.085,1.36,-hw,2.66,z,BUS.trim);
  b.box(.02, .2, .9, hw + .02, top - .15, half - 2.2, busSign(...route));
  if (wheels) for (const az of [axR, axF]) for (const sx of [-1, 1]) {
    b.add(new THREE.CylinderGeometry(R, R, .32, 18).rotateZ(Math.PI / 2), BUS.rubber, new THREE.Matrix4().makeTranslation(sx * (hw - .22), R, az));
    b.add(new THREE.CylinderGeometry(.3, .3, .34, 12).rotateZ(Math.PI / 2), BUS.hub, new THREE.Matrix4().makeTranslation(sx * (hw - .22), R, az));
  }
  const body=b.group('exterior');
  const leaves=[];
  for (const z of doors) for (const side of [-1,1]) {
    const door=new Bucket();
    door.box(.06,2.25,.61,0,1.47,0,BUS.door);
    door.box(.068,2.28,.04,0,1.47,side*.28,BUS.trim);
    door.box(.07,.3,.61,0,.51,0,BUS.skirt);
    const leaf=door.group('Sliding door');
    leaf.position.set(-hw,0,z+side*.31);
    leaf.userData.closedZ=leaf.position.z;
    leaf.userData.direction=side;
    body.add(leaf);leaves.push(leaf);
  }
  body.userData.doors=leaves;
  return body;
}

/** A body made of the downloaded segment, repeated to the vehicle's length and scaled to its width and height. */
function bodyFromModel(model, W, H, L) {
  const exterior = new THREE.Group();
  exterior.name = 'exterior';
  const { x: sw, y: sh, z: sl } = model.userData.size;
  const n = Math.max(1, Math.round(L / sl)), seg = L / n;
  for (let i = 0; i < n; i++) {
    const piece = model.clone(true);
    piece.scale.set(W / sw, H / sh, seg / sl);
    piece.position.z = -L / 2 + (i + .5) * seg;
    piece.traverse((c) => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
    exterior.add(piece);
  }
  return exterior;
}

/** Track ribbons for one polyline, following the ground in short pieces. */
function trackPieces(b, line, ground, kind) {
  const tram = kind === 'tram';
  const lift = tram ? .04 : .18;
  for (let i = 0; i < line.length - 1; i++) {
    const [x0, z0] = line[i], [x1, z1] = line[i + 1];
    const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz);
    if (len < .2) continue;
    const yaw = Math.atan2(dx, dz), n = Math.max(1, Math.ceil(len / 20));
    for (let k = 0; k < n; k++) {
      const t0 = k / n, t1 = (k + 1) / n;
      const mx = x0 + dx * (t0 + t1) / 2, mz = z0 + dz * (t0 + t1) / 2;
      const y = ground.height(mx, mz) + lift;
      const seg = len / n;
      if (tram) {
        b.box(2.4, .08, seg, mx, y, mz, MAT.ballast, yaw);
        for (const side of [-.72, .72]) b.box(.07, .1, seg, mx + Math.cos(yaw) * side, y + .04, mz - Math.sin(yaw) * side, MAT.rail, yaw);
      } else {
        b.box(3.4, .14, seg, mx, y - .04, mz, MAT.ballast, yaw);
        for (const side of [-.72, .72]) b.box(.07, .14, seg, mx + Math.cos(yaw) * side, y + .07, mz - Math.sin(yaw) * side, MAT.rail, yaw);
        if (k % 2 === 0) b.box(2.8, .08, .22, mx, y + .02, mz, MAT.tie, yaw);
      }
    }
  }
}

/** Stop furniture: pole, sign, shelter for bus and tram, a platform and canopy for trains. */
function stopFurniture(b, stop, ground, obstacles) {
  const y = ground.height(stop.x, stop.z);
  if (stop.kind === 'train') {
    b.box(40, .5, 6, stop.x, y + .25, stop.z, MAT.concrete);
    for (const dx of [-17, 17]) for (const dz of [-2.6, 2.6]) b.cyl(.15, 4, stop.x + dx, y + 2.5, stop.z + dz, MAT.pole);
    b.box(38, .22, 6.4, stop.x, y + 4.6, stop.z, MAT.shelter);
    return;
  }
  if (stop.kind === 'tram') b.box(7, .2, 2.2, stop.x, y + .1, stop.z, MAT.concrete);
  b.cyl(.06, 2.7, stop.x, y + 1.35, stop.z, MAT.pole);
  b.box(.55, .55, .06, stop.x, y + 2.8, stop.z, stop.kind === 'tram' ? MAT.signWhite : MAT.sign);
  b.box(.5, .1, .04, stop.x, y + 2.8, stop.z + .04, MAT.signWhite);
  if (stop.kind === 'bus') {
    const yaw=stop.yaw??0, rx=Math.cos(yaw), rz=-Math.sin(yaw);
    const sx=stop.x-rx*.9, sz=stop.z-rz*.9;
    b.box(1.30,.075,2.8,sx,y+2.38,sz,MAT.pole,yaw);
    b.box(.045,1.94,2.65,sx-rx*.58,y+1.27,sz-rz*.58,MAT.shelter,yaw);
    for(const side of [-1,1])
      b.cyl(.045,2.38,sx+Math.sin(yaw)*side*1.3,y+1.19,sz+Math.cos(yaw)*side*1.3,MAT.pole);
    b.box(.38,.11,1.92,sx-rx*.31,y+.51,sz-rz*.31,MAT.tie,yaw);
    b.box(.3,.48,.32,sx-rx*.31,y+.24,sz-rz*.31,MAT.pole,yaw);
    const bx=sx+Math.sin(yaw)*1.85,bz=sz+Math.cos(yaw)*1.85;
    b.cyl(.24,.75,bx,y+.38,bz,MAT.cabin);
    b.cyl(.26,.085,bx,y+.79,bz,MAT.pole);
  }
  obstacles?.addPosts?.([[stop.x, stop.z]], .12);
}

/** Taxi rank: a sign and two yellow cars nose to tail. With a downloaded taxi model, the cars are clones of it. */
function taxiRank(b, rank, ground, obstacles, taxi = null) {
  const cars = [];
  const y = ground.height(rank.x, rank.z);
  b.cyl(.07, 3, rank.x, y + 1.5, rank.z, MAT.pole);
  b.box(.8, .45, .1, rank.x, y + 2.9, rank.z, MAT.taxi);
  for (const dz of [-3.2, 1.8]) {
    if (taxi) {
      const car = taxi.clone(true);
      car.position.set(rank.x, y, rank.z + dz);
      car.traverse((c) => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
      cars.push(car);
      continue;
    }
    b.box(1.9, .55, 4.2, rank.x, y + .65, rank.z + dz, MAT.taxi);
    b.box(1.6, .5, 2.1, rank.x, y + 1.15, rank.z + dz - .3, MAT.taxiDark);
    b.box(.4, .12, .25, rank.x, y + 1.42, rank.z + dz, MAT.taxi);
  }
  obstacles?.addPosts?.([[rank.x, rank.z]], .2);
  return cars;
}

/**
 * Builds the transit scenery for a sector.
 * @param {object} data  { stops, rail, taxis, routes } already filtered to the sector
 * @param {object} ground ground with height(x, z)
 * @param {object} obstacles obstacle index (addPosts)
 */
export function buildTransit(data, ground, obstacles, models = null) {
  const b = new Bucket(), cars = [];
  for (const r of data.rail || []) trackPieces(b, r.line, ground, r.kind);
  for (const stop of data.stops || []) stopFurniture(b, stop, ground, obstacles);
  for (const rank of data.taxis || []) cars.push(...taxiRank(b, rank, ground, obstacles, models?.taxi || null));
  const group = b.group('transit');
  // three.js logs an error for add() with no arguments, so only add when there are taxis
  if (cars.length) group.add(...cars);
  group.userData.stops = data.stops || [];
  return group;
}

export { SPEC as VEHICLE_SPEC };
