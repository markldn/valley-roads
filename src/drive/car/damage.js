// Procedural damage (race.txt 7.3): impacts dent the body mesh around the
// contact point and degrade the car - front hits cost engine power (radiator,
// intake), front-corner hits bend the steering so the car pulls to one side.
import * as THREE from 'three';
import { smoothNormals } from './model.js';
import { buildCrush, beginCrush, stepCrush, skin, skinStructure, commit, powertrainLayout } from './crush.js';
import { debrisSink } from './debris.js';
import { resetDoors } from './door.js';

const _m = new THREE.Matrix4(), _v = new THREE.Vector3(), _n = new THREE.Vector3();

// cheap hashed value noise for the crumple pattern (object space, metres)
function h3(x, y, z) {
  let n = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return n - Math.floor(n);
}
function noise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  let fx = x - xi, fy = y - yi, fz = z - zi;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz);
  const l = (a, b, t) => a + (b - a) * t;
  return l(
    l(l(h3(xi, yi, zi), h3(xi + 1, yi, zi), fx), l(h3(xi, yi + 1, zi), h3(xi + 1, yi + 1, zi), fx), fy),
    l(l(h3(xi, yi, zi + 1), h3(xi + 1, yi, zi + 1), fx), l(h3(xi, yi + 1, zi + 1), h3(xi + 1, yi + 1, zi + 1), fx), fy), fz);
}

const BUMPER = 2.5, DENT_ONLY = 5.5, ABSORB = 3.5;   // m/s: no damage below, dents only below, energy the front end soaks up
export function applyDamage(model, car, hit) {
  if (model.userData.noCrush || car.invulnerable) return false;
  const j = hit.j;
  if (j < 1200) return false;
  const speed = Number.isFinite(hit.energy)
    ? Math.sqrt(2*Math.max(0,hit.energy)/car.spec.mass)
    : j/(1.25*car.spec.mass);
  // A real car takes a parking knock without a mark: bumpers and their absorbers are built for 4-8 km/h, and
  // panels only buckle well above that. Below 9 km/h nothing, up to 20 km/h shallow dents, above that the
  // crumple structure works with the energy that is left once the bumper and absorbers have taken theirs.
  if (speed < BUMPER || model.userData.crush?.burst) return false;
  model.userData.ownGeometry?.();   // shared model geometry -> this car's own copy before any write
  if (speed >= DENT_ONLY) crushHit(model, car, hit, Math.sqrt(speed * speed - ABSORB * ABSORB));
  else scuffHit(model, car, hit, j, (speed - BUMPER) / (DENT_ONLY - BUMPER));
  return true;
}

// ---- real impacts: crush the lattice, skin the shell to it ---------------------------------------
function crushHit(model, car, hit, speed) {
  const shell = model.userData.shell;
  const ud = model.userData;
  if (ud.crush && ud.crush.burst) return;          // one burst at a time; the car is already folding
  prepareCrush(model, car);
  shell.updateWorldMatrix(true, false);
  _m.copy(shell.matrixWorld).invert();
  const P = _v.set(hit.P[0], hit.P[1], hit.P[2]).applyMatrix4(_m);
  _n.set(hit.n[0], hit.n[1], hit.n[2]).transformDirection(_m);
  ud.crushHit = { P: [P.x, P.y, P.z], n: [_n.x, _n.y, _n.z] };
  // a trunk or post is a narrow cylinder, not a wall: the car wraps round it and the crush runs deeper
  let cyl = null;
  if (hit.c && hit.r < 1.2) {
    const C = _v.set(hit.c[0], hit.P[1], hit.c[1]).applyMatrix4(_m);
    cyl = { c: [C.x, C.z], r: hit.r };
  }
  // the wall passes through the nearest skin point of the lattice nodes along -n from P
  bindStructure(model);
  beginCrush(ud.crush, [P.x, P.y, P.z], [_n.x, _n.y, _n.z], Math.min(speed, 40), cyl);   // up to ~145 km/h; the lattice stays stable there (test/crush.mjs)
  ud.crushSpeed = speed;
  ud.dents = (ud.dents || 0) + 1;
}

function bindStructure(model) {
  const ud = model.userData;
  if (!ud.gauges || ud.hideBody) return;
  const point = new THREE.Vector3();
  if (!ud.structureSkin) {
    const parts = [];
    const bodyInverse = new THREE.Matrix4();
    ud.body.updateWorldMatrix(true,true);
    bodyInverse.copy(ud.body.matrixWorld).invert();
    for (const child of ud.body.children) {
      if (child === ud.shell || child.geometry === ud.shell.geometry || child === ud.steerPivot || child === ud.powertrain) continue;
      child.traverse(mesh => {
        if (!mesh.isMesh || !mesh.geometry.attributes.position) return;
        const original = mesh.geometry;
        mesh.geometry = original.clone();
        const position = mesh.geometry.attributes.position;
        const home = Float32Array.from(position.array);
        const toBody = new THREE.Matrix4().multiplyMatrices(bodyInverse,mesh.matrixWorld);
        const rest = home.slice();
        for (let i = 0; i < rest.length; i += 3)
          point.fromArray(home,i).applyMatrix4(toBody).toArray(rest,i);
        parts.push({mesh,original,rest,out:rest.slice(),inverse:toBody.invert()});
      });
    }
    ud.structureSkin = parts;
    const bindAnchor=(position, offsetY)=>{
      const home=position.clone();
      const rest=Float32Array.of(home.x,home.y+offsetY,home.z);
      return {position,home,offsetY,rest,out:rest.slice()};
    };
    ud.structureAnchors=[
      bindAnchor(ud.steerPivot.position,0),
      bindAnchor(ud.cockpit,-ud.body.position.y),
      ...(ud.powertrain?[bindAnchor(ud.powertrain.position,0)]:[]),
    ];
  }
  const bind = ud.crush.makeStructureBinder();
  for (const part of ud.structureSkin) part.binding = bind(part.rest);
  for (const anchor of ud.structureAnchors) anchor.binding = bind(anchor.rest);
}

function updateStructure(model, settled) {
  const ud = model.userData;
  const point = new THREE.Vector3();
  for (const part of ud.structureSkin || []) {
    const geometry = part.mesh.geometry;
    const position = geometry.attributes.position;
    skinStructure(ud.crush,part.binding,part.rest,part.out);
    for (let i = 0; i < part.out.length; i += 3)
      point.fromArray(part.out,i).applyMatrix4(part.inverse).toArray(position.array,i);
    position.needsUpdate = true;
    if (settled) part.rest.set(part.out);
    if (geometry.attributes.normal) geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
  }
  for (const anchor of ud.structureAnchors || []) {
    skinStructure(ud.crush,anchor.binding,anchor.rest,anchor.out);
    anchor.position.set(anchor.out[0],anchor.out[1]-anchor.offsetY,anchor.out[2]);
    if(settled)anchor.rest.set(anchor.out);
  }
}

// build the lattice ahead of the first crash (about 150 ms) so the impact itself doesn't hitch
export function prepareCrush(model, car) {
  const ud = model.userData;
  if (ud.crush) return;
  ud.crush = buildCrush(ud.pristine, ud.shape, car.spec);
  ud.crushOut = new Float32Array(ud.crush.nu * 3);
  ud.crushDmg = new Float32Array(ud.crush.nu);
}

const CRUSH_STEPS_PER_FRAME = 6;     // 6 x 1 ms of impact time per rendered frame
export function updateDamage(model, car) {
  const ud = model.userData, C = ud.crush;
  if (!C || !C.burst) return;
  let alive = true;
  for (let s = 0; s < CRUSH_STEPS_PER_FRAME && alive; s++) alive = stepCrush(C, 0.001, 2);
  skin(C, ud.crushOut, ud.crushDmg);
  const geo = ud.shell.geometry, pos = geo.attributes.position, a = pos.array, dm = geo.attributes.aDmg;
  const out = ud.crushOut, vmap = C.vmap, base = ud.dmgBase || (ud.dmgBase = Float32Array.from(dm.array));
  for (let i = 0, n = C.nv; i < n; i++) {
    const u = vmap[i] * 3;
    a[i * 3] = out[u]; a[i * 3 + 1] = out[u + 1]; a[i * 3 + 2] = out[u + 2];
    dm.array[i] = Math.min(1, base[i] + ud.crushDmg[vmap[i]]);
  }
  pos.needsUpdate = true; dm.needsUpdate = true;
  reapplyHidden(model);
  updateStructure(model, !alive);
  if (!alive) finishCrush(model, car);
}

function finishCrush(model, car) {
  const ud = model.userData, C = ud.crush, geo = ud.shell.geometry;
  const a = geo.attributes.position.array, dm = geo.attributes.aDmg.array;
  // fine crumple on top of the lattice's macro deformation, scaled by how much the skin moved
  for (let u = 0; u < C.nu; u++) {
    const d = Math.min(1, ud.crushDmg[u] * 1.2);
    if (d < 0.04) continue;
    const x = ud.crushOut[u * 3], y = ud.crushOut[u * 3 + 1], z = ud.crushOut[u * 3 + 2];
    const n1 = noise3(x * 7, y * 7, z * 7), n2 = noise3(x * 19 + 3, y * 19, z * 19);
    const ridge = 1 - Math.abs(2 * n1 - 1);
    const k = d * (0.045 * ridge * ridge + 0.02 * (n2 - 0.5));
    // inward along the hit normal (towards the car), the way a buckled panel folds
    const hn = ud.crushHit.n;
    ud.crushOut[u * 3] = x - hn[0] * k; ud.crushOut[u * 3 + 1] = y - hn[1] * k * 0.4; ud.crushOut[u * 3 + 2] = z - hn[2] * k;
  }
  for (let i = 0; i < C.nv; i++) {
    const u = C.vmap[i] * 3;
    a[i * 3] = ud.crushOut[u]; a[i * 3 + 1] = ud.crushOut[u + 1]; a[i * 3 + 2] = ud.crushOut[u + 2];
  }
  commit(C, ud.crushOut);
  ud.dmgBase = Float32Array.from(dm);
  reapplyHidden(model);
  geo.attributes.position.needsUpdate = true;
  smoothNormals(geo);
  geo.computeBoundingSphere();
  // mechanical consequences from the measured crush, not a guess
  const depth = C.lastDepth || 0;
  const S = ud.shape, D = car.damage, P = ud.crushHit.P;
  const sev = Math.min(1, depth / 0.6);
  D.total = Math.min(1, D.total + sev * 0.7);
  const engine=powertrainLayout(S,car.spec);
  const localLoad=Math.max(0,1-Math.abs(P[2]-engine.z)/1.35);
  D.engine=Math.max(D.engine,Math.min(1,(C.engineDamage??0)*localLoad));
  ud.lastCrushDepth = depth;
  // a hard crash breaks every window; the windscreen of a 100 km/h impact is a white web
  const spd = ud.crushSpeed || 0;
  if (sev >= 0.3 || spd > 13) shatterGlass(model, Math.min(0.75, 0.3 + sev * 0.35 + spd * 0.01));
  car.hotT = 40;                 // fresh wreck: radiator steam, then oil smoke (fx.js)
  // each wheel mount takes what the structure around it took
  if (C.hubResults && car.wheels) {
    D.wheel ||= [0,0,0,0];
    C.hubs.forEach((hub,k)=>{
      const home=C.nodes.find(node=>node.id===hub).p;
      const wi=car.wheels.findIndex(w=>Math.sign(w.mountHome[0])===Math.sign(home[0]) && w.front===(home[2]>0));
      if(wi<0) return;
      const result=C.hubResults[k], wheel=car.wheels[wi];
      const distance=Math.hypot(home[0]-P[0],home[1]-P[1],home[2]-P[2]);
      const near=Math.max(.2,Math.min(1,1.35-distance/2.4));
      D.wheel[wi]=Math.max(D.wheel[wi],result.damage*near);
      if(wheel.broken) return;
      const directWheelStrike=distance<.38 && Math.abs(ud.crushHit.n[0])>.42;
      const pushed=Math.hypot(...result.offset)*near;
      const separated=result.failed || pushed>.3 || (directWheelStrike && Math.hypot(...result.offset)>.31);
      if(separated && distance<1.3 && D.wheel[wi]>.4){
        wheel.broken=true;
        spawnWheel(model,car,wi);
        return;
      }
      for(let axis=0;axis<3;axis++){
        const offset=THREE.MathUtils.clamp(result.offset[axis]*near,-.13,.13);
        wheel.hp[axis]=wheel.mountHome[axis]+offset;
      }
      // The visible wheel goes where the crushed structure took it: pushed in, leaning and toed out.
      const [ox,oy,oz]=result.offset, old=wheel.bent||[0,0,0];
      wheel.bent=[THREE.MathUtils.clamp(old[0]+ox*near*1.3,-.46,.46),THREE.MathUtils.clamp(old[1]+oy*near,-.22,.16),THREE.MathUtils.clamp(old[2]+oz*near*1.3,-.5,.5)];
      wheel.bentCamber=THREE.MathUtils.clamp((wheel.bentCamber||0)+ox*near*1.5+D.wheel[wi]*.1*wheel.side,-.55,.55);
      wheel.bentToe=THREE.MathUtils.clamp((wheel.bentToe||0)+oz*near*1.2*wheel.side,-.6,.6);
    });
  }
  tearOffParts(model, car);
  const broken = car.wheels ? car.wheels.filter((w) => w.broken).length : 0;
  // a car whose cell, engine or running gear is gone does not drive away
  if (D.total >= 0.9 || D.engine >= 0.95 || broken >= 2 || depth >= 0.95) car.wrecked = true;
}

function shatterGlass(model, level) {
  const ud = model.userData, geo = ud.shell.geometry, dm = geo.attributes.aDmg;
  const mats = Array.isArray(ud.shell.material) ? ud.shell.material : [ud.shell.material];
  for (const g of geo.groups) {
    if (!mats[g.materialIndex] || mats[g.materialIndex].userData.role !== 'glass') continue;
    for (let i = g.start; i < g.start + g.count; i++) dm.array[i] = Math.max(dm.array[i], level);
  }
  dm.needsUpdate = true;
  if (ud.dmgBase) for (let i = 0; i < dm.array.length; i++) ud.dmgBase[i] = Math.max(ud.dmgBase[i], dm.array[i]);
}

// ---- light touches: scuffed paint and a shallow procedural dent ------------------------------------
function scuffHit(model, car, hit, j, sev = 1) {
  const shell = model.userData.shell;
  shell.updateWorldMatrix(true, false);
  _m.copy(shell.matrixWorld).invert();
  const P = _v.set(hit.P[0], hit.P[1], hit.P[2]).applyMatrix4(_m);
  // the hit normal points from the obstacle into the car: push the panel that way
  _n.set(hit.n[0], hit.n[1], hit.n[2]).transformDirection(_m);
  // a 9-20 km/h knock: a scuff to a ~10 cm dent, scaled by the speed of the hit
  const power = Math.min(1, (j - 1000) / 22000) * Math.max(0.15, Math.min(1, sev));
  const depth = 0.015 + 0.09 * power;
  const radius = 0.45 + 0.85 * power;
  const geo = shell.geometry;
  const pos = geo.attributes.position;
  const dmgA = geo.attributes.aDmg;
  const a = pos.array;
  const seed = (model.userData.dents || 0) * 7.31 + j * 0.0013;
  let moved = 0;
  for (let i = 0, vi = 0; i < a.length; i += 3, vi++) {
    const dx = a[i] - P.x, dy = (a[i + 1] - P.y) * 1.35, dz = a[i + 2] - P.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > radius * radius) continue;
    const f = 1 - Math.sqrt(d2) / radius;
    const base = f * f * (3 - 2 * f);
    // crumple: a smooth bowl plus ridged creases, strongest mid-way out where panels buckle
    const n1 = noise3(a[i] * 4.5 + seed, a[i + 1] * 4.5, a[i + 2] * 4.5);
    const n2 = noise3(a[i] * 10 - seed, a[i + 1] * 10, a[i + 2] * 10);
    const ridge = 1 - Math.abs(2 * n1 - 1);
    const crumple = 0.65 + 0.6 * ridge * ridge + 0.18 * (n2 - 0.5);
    const k = depth * base * Math.max(0.1, crumple);
    a[i] += _n.x * k + (n2 - 0.5) * 0.12 * k;
    a[i + 1] += _n.y * k * 0.3 + (n1 - 0.5) * 0.2 * k;
    a[i + 2] += _n.z * k + (n1 - 0.5) * 0.12 * k;
    dmgA.array[vi] = Math.min(1, dmgA.array[vi] + base * (0.25 + 0.95 * power));
    moved++;
  }
  if (moved) {
    pos.needsUpdate = true;
    dmgA.needsUpdate = true;
    smoothNormals(geo);
  }
  // mechanical consequences
  const S = model.userData.shape;
  const D = car.damage;
  const severity = j / 50000 * Math.max(0.2, Math.min(1, sev)) * 0.5;   // a dent is cosmetic: little mechanical harm
  D.total = Math.min(1, D.total + severity * 0.5);
  if (P.z > S.a * 0.4) {
    D.engine = Math.min(1, D.engine + severity * 0.7);
    if (Math.abs(P.x) > 0.35) D.toe = Math.max(-0.02, Math.min(0.02, D.toe + Math.sign(P.x) * severity * 0.01));
  }
  model.userData.dents = (model.userData.dents || 0) + 1;
  if (model.userData.dmgBase) model.userData.dmgBase = Float32Array.from(geo.attributes.aDmg.array);
}

/** a car changes hands (a traffic car taken by the player): its crushed shell, broken glass, missing parts and
 *  mechanical damage go with it; returns false when the two shells do not match */
export function transferDamage(from, to, srcCar, car) {
  const a = from.userData, b = to.userData;
  if (!a.shell || !b.shell || !srcCar || !srcCar.damage) return false;
  const pa = a.shell.geometry.attributes.position, da = a.shell.geometry.attributes.aDmg;
  b.ownGeometry?.();
  const geo = b.shell.geometry, pb = geo.attributes.position, db = geo.attributes.aDmg;
  if (!da || !db || pa.array.length !== pb.array.length) return false;
  pb.array.set(pa.array); pb.needsUpdate = true;
  db.array.set(da.array); db.needsUpdate = true;
  b.dmgBase = Float32Array.from(db.array);
  b.dents = a.dents || 0;
  b.torn = { ...(a.torn || {}) };
  if (a.hidAny) { b.hid = a.hid.slice(); b.hidPos = a.hidPos.slice(); b.hidAny = true; }
  smoothNormals(geo);
  geo.computeBoundingSphere();
  const D = srcCar.damage;
  car.damage = { engine: D.engine || 0, toe: D.toe || 0, total: D.total || 0, wheel: (D.wheel || [0, 0, 0, 0]).slice() };
  for(let i=0;i<(car.wheels?.length??0);i++){
    const src=srcCar.wheels?.[i];
    if(!src) continue;
    const wheel=car.wheels[i];
    wheel.hp=src.hp.slice();
    wheel.broken=Boolean(src.broken);
  }
  if (car.damage.total >= 0.9 || car.damage.engine >= 0.95 || srcCar.wrecked) car.wrecked = true;
  return true;
}

export function repair(model, car) {
  car.misfuel = 0;
  for (const wheel of car.wheels || []) { wheel.bent = null; wheel.bentCamber = 0; wheel.bentToe = 0; }
  resetDoors(model);
  const shell = model.userData.shell;
  shell.geometry.attributes.position.array.set(model.userData.pristine);
  shell.geometry.attributes.position.needsUpdate = true;
  shell.geometry.attributes.aDmg.array.fill(0);
  shell.geometry.attributes.aDmg.needsUpdate = true;
  smoothNormals(shell.geometry);
  shell.geometry.computeBoundingSphere();
  for (const part of model.userData.structureSkin || []) {
    part.mesh.geometry.dispose();
    part.mesh.geometry = part.original;
  }
  for (const anchor of model.userData.structureAnchors || []) anchor.position.copy(anchor.home);
  model.userData.structureSkin = null;
  model.userData.structureAnchors = null;
  model.userData.crush = null; model.userData.dmgBase = null;
  model.userData.dents = 0; model.userData.damaged = false; model.userData.lastCrushDepth = 0;
  model.userData.torn = {}; model.userData.hid = null; model.userData.hidPos = null; model.userData.hidAny = false;
  debrisSink.current?.clear(model);
  car.damage = { engine: 0, toe: 0, total: 0, wheel: [0, 0, 0, 0] };
  car.wrecked = false; car.drowned = false; car.sunk = 0;
  car.onFire = false; car.ignitionDelay = undefined; car.burnT = 0; car.exploded = false; car.explosionPartsSpawned = false;
  if (car.wheels) {
    const rollingSpeed=car.forwardSpeed?.()??0;
    for(const wheel of car.wheels){
      if(wheel.broken) wheel.omega=rollingSpeed/wheel.R;
      wheel.broken=false;
      wheel.hp=wheel.mountHome.slice();
    }
  }
}


// ---- loose parts -----------------------------------------------------------------------------------
const _wp = new THREE.Vector3(), _wq = new THREE.Quaternion();

function carVelocityAt(car, p) {
  // rigid-body velocity of the car at world point p
  const v = car.velocityAt ? car.velocityAt([p.x, p.y, p.z]) : (car.v || [0, 0, 0]);
  return new THREE.Vector3(v[0], v[1], v[2]);
}

function spawnWheel(model, car, wi) {
  const sink = debrisSink.current;
  const wg = model.userData.wheels[wi];
  if (!sink || !wg) return;
  const spin = wg.userData.spin || wg;
  wg.getWorldPosition(_wp); wg.getWorldQuaternion(_wq);
  const g = new THREE.Group();
  for (const c of spin.children) g.add(c.clone(true));
  g.position.copy(_wp);
  g.quaternion.copy(_wq);
  g.scale.x = wg.scale.x;
  const R = car.spec.wheel.radius, Wd = car.spec.wheel.width;
  // the wheel leaves with the car's velocity at that point and the angular velocity it already had
  const v = carVelocityAt(car, _wp);
  const axle = new THREE.Vector3(1, 0, 0).applyQuaternion(_wq);
  const w = axle.multiplyScalar(car.wheels[wi].omega);
  if (car.w) w.add(new THREE.Vector3(...car.w));
  // Torn off by the impact: thrown clear of the car, bouncing and tumbling.
  const away = new THREE.Vector3(_wp.x - car.p[0], 0, _wp.z - car.p[2]).normalize();
  v.addScaledVector(away, 3 + Math.random() * 5);
  v.y += 2 + Math.random() * 3;
  w.add(new THREE.Vector3((Math.random() - .5) * 16, (Math.random() - .5) * 12, (Math.random() - .5) * 16));
  sink.add(g, { kind: 'cyl', mass: Math.min(25,car.spec.mass*.025), R, W: Wd, v, w, owner: model });
}

// regions are in shell-local coordinates (x left, y up from the ground, z forward)
function partRegions(S) {
  const hw = S.W / 2, belt = 0.95;
  return [
    { name: 'bumperF', thr: 0.5, test: (x, y, z) => z > S.zf - 0.42 && y < 0.62 && Math.abs(x) < hw + 0.05 },
    { name: 'bumperR', thr: 0.5, test: (x, y, z) => z < S.zr + 0.42 && y < 0.62 && Math.abs(x) < hw + 0.05 },
    { name: 'mirrorL', thr: 0.3, test: (x, y, z) => x > hw - 0.10 && y > belt - 0.08 && y < belt + 0.4 && z > S.wsBase - 0.75 && z < S.wsBase + 0.12 },
    { name: 'mirrorR', thr: 0.3, test: (x, y, z) => x < -(hw - 0.10) && y > belt - 0.08 && y < belt + 0.4 && z > S.wsBase - 0.75 && z < S.wsBase + 0.12 },
    { name: 'hood', thr: 0.72, test: (x, y, z) => z > S.wsBase + 0.18 && z < S.zf - 0.42 && y > 0.62 && Math.abs(x) < hw - 0.12 },
  ];
}

function tearOffParts(model, car, force = false) {
  const sink = debrisSink.current;
  const ud = model.userData, shell = ud.shell;
  if (!sink || !shell) return;
  const geo = shell.geometry, pos = geo.attributes.position, dmg = geo.attributes.aDmg;
  const nv = pos.count, nt = nv / 3;
  ud.torn = ud.torn || {};
  const regions = partRegions(ud.shape).filter((r) => !ud.torn[r.name]);
  if (!regions.length) return;
  const a = pos.array, d = dmg.array;
  // per region: triangles (index list) and mean damage
  const acc = regions.map(() => ({ tris: [], dsum: 0 }));
  for (let t = 0; t < nt; t++) {
    const i = t * 9;
    const cx = (a[i] + a[i + 3] + a[i + 6]) / 3, cy = (a[i + 1] + a[i + 4] + a[i + 7]) / 3, cz = (a[i + 2] + a[i + 5] + a[i + 8]) / 3;
    for (let r = 0; r < regions.length; r++) {
      if (!regions[r].test(cx, cy, cz)) continue;
      acc[r].tris.push(t); acc[r].dsum += (d[t * 3] + d[t * 3 + 1] + d[t * 3 + 2]) / 3;
      break;
    }
  }
  const groups = geo.groups.length ? geo.groups : [{ start: 0, count: nv, materialIndex: 0 }];
  const mats = Array.isArray(shell.material) ? shell.material : [shell.material];
  const nrm = geo.attributes.normal.array, uv = geo.attributes.uv ? geo.attributes.uv.array : null;
  shell.updateWorldMatrix(true, false);
  regions.forEach((reg, r) => {
    const { tris, dsum } = acc[r];
    if (tris.length < 12) return;
    const mean = dsum / tris.length;
    if (!force && mean < reg.thr) return;
    // centroid in shell space
    let cx = 0, cy = 0, cz = 0;
    for (const t of tris) { const i = t * 9; cx += a[i] + a[i + 3] + a[i + 6]; cy += a[i + 1] + a[i + 4] + a[i + 7]; cz += a[i + 2] + a[i + 5] + a[i + 8]; }
    const inv = 1 / (tris.length * 3); cx *= inv; cy *= inv; cz *= inv;
    // build one geometry with a group per original material
    const P = [], N = [], U = [], D = [], gs = [];
    for (let gi = 0; gi < groups.length; gi++) {
      const g = groups[gi], t0 = g.start / 3, t1 = (g.start + g.count) / 3;
      const start = P.length / 3;
      for (const t of tris) {
        if (t < t0 || t >= t1) continue;
        for (let k = 0; k < 3; k++) {
          const vi = t * 3 + k;
          P.push(a[vi * 3] - cx, a[vi * 3 + 1] - cy, a[vi * 3 + 2] - cz);
          N.push(nrm[vi * 3], nrm[vi * 3 + 1], nrm[vi * 3 + 2]);
          U.push(uv ? uv[vi * 2] : 0, uv ? uv[vi * 2 + 1] : 0);
          D.push(d[vi]);
        }
      }
      const count = P.length / 3 - start;
      if (count) gs.push({ start, count, materialIndex: g.materialIndex });
    }
    if (!gs.length) return;
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    dg.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
    dg.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
    dg.setAttribute('aDmg', new THREE.Float32BufferAttribute(D, 1));
    for (const g of gs) dg.addGroup(g.start, g.count, g.materialIndex);
    dg.computeBoundingSphere();
    const mesh = new THREE.Mesh(dg, Array.isArray(shell.material) ? mats : mats[0]);
    mesh.userData.ownGeometry = true;
    const wp = new THREE.Vector3(cx, cy, cz).applyMatrix4(shell.matrixWorld);
    mesh.position.copy(wp);
    shell.getWorldQuaternion(mesh.quaternion);
    const v = carVelocityAt(car, wp);
    const out = new THREE.Vector3(Math.sign(cx) || 0, 0.4, Math.sign(cz) * 0.3).applyQuaternion(mesh.quaternion);
    v.addScaledVector(out, 1.5 + Math.random() * 2.5); v.y += 1 + Math.random() * 1.5;
    const w = new THREE.Vector3((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 8);
    dg.computeBoundingBox();
    const bb = dg.boundingBox;
    const h = [Math.max(0.04, (bb.max.x - bb.min.x) / 2), Math.max(0.04, (bb.max.y - bb.min.y) / 2), Math.max(0.04, (bb.max.z - bb.min.z) / 2)];
    const mass = { bumperF: 14, bumperR: 14, hood: 18, mirrorL: 1.5, mirrorR: 1.5 }[reg.name] || 8;
    sink.add(mesh, { kind: 'box', mass, h, v, w, owner: model });
    // collapse the originals so they no longer render (repair restores them from `pristine`)
    ud.hid = ud.hid || new Uint8Array(nv);
    ud.hidPos = ud.hidPos || new Float32Array(nv * 3);
    for (const t of tris) for (let k = 0; k < 3; k++) {
      const vi = t * 3 + k;
      ud.hid[vi] = 1; ud.hidPos[vi * 3] = cx; ud.hidPos[vi * 3 + 1] = cy; ud.hidPos[vi * 3 + 2] = cz;
      a[vi * 3] = cx; a[vi * 3 + 1] = cy; a[vi * 3 + 2] = cz;
    }
    pos.needsUpdate = true;
    ud.hidAny = true;
    ud.torn[reg.name] = true;
  });
}

/** Final fuel ignition breaks the remaining running gear and throws loose body panels. */
export function explodeVehicle(model, car) {
  if (!model || !car || car.explosionPartsSpawned || car.invulnerable) return;
  car.explosionPartsSpawned = true;
  car.wrecked = true;
  car.damage ||= { engine: 0, toe: 0, total: 0, wheel: [0, 0, 0, 0] };
  car.damage.engine = 1;
  car.damage.total = 1;
  car.damage.wheel ||= [0, 0, 0, 0];
  model.userData.ownGeometry?.();
  tearOffParts(model, car, true);
  for (let i = 0; i < (car.wheels?.length || 0); i++) {
    if (car.wheels[i].broken) continue;
    car.wheels[i].broken = true;
    car.damage.wheel[i] = 1;
    spawnWheel(model, car, i);
  }
}

/** keep torn-off triangles collapsed after the crush skin rewrote every vertex */
export function reapplyHidden(model) {
  const ud = model.userData;
  if (!ud.hidAny) return;
  const pos = ud.shell.geometry.attributes.position, a = pos.array, h = ud.hid, p = ud.hidPos;
  for (let i = 0; i < h.length; i++) if (h[i]) { a[i * 3] = p[i * 3]; a[i * 3 + 1] = p[i * 3 + 1]; a[i * 3 + 2] = p[i * 3 + 2]; }
  pos.needsUpdate = true;
}
