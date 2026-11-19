import * as T from '../vendor/three.module.js';
import { slotOf } from './jobs.js';
import { corridorGraph, guidePath } from '../world/corridors.js';
import { TYPES, remark } from './passengers.js';

// Optional taxi missions (off by default; M toggles). Take a fare (J), drive to
// the passenger's ring and stop, then to the drop-off ring. One objective at a
// time: orange arrows lie on the road ahead, an arrow floats over the car and a
// HUD arrow points at the ring. The accepted fare owns its route and stops, so it
// survives terrain streaming.
const REACH = 11, STOP_SPEED = 3.5, ARROW_SPACING = 16, ARROWS_AHEAD = 14;

function resample(points, spacing) {
  const out = [];
  let carry = 0;
  for (let i = 1; i < points.length; i++) {
    const [ax, az] = points[i - 1], [bx, bz] = points[i];
    const length = Math.hypot(bx - ax, bz - az);
    if (!length) continue;
    const dx = (bx - ax) / length, dz = (bz - az) / length;
    for (let d = carry; d < length; d += spacing) out.push({x: ax + dx * d, z: az + dz * d, dx, dz});
    carry = ((carry - length) % spacing + spacing) % spacing;
  }
  return out;
}

export function createDelivery({scene, ground, world, panel, goal, makeOffers, career, enabled = false}) {
  const beam = new T.Mesh(new T.CylinderGeometry(2.6, 2.6, 46, 20, 1, true),
    new T.MeshBasicMaterial({color: 0xffb04a, transparent: true, opacity: .32, side: T.DoubleSide, depthWrite: false, toneMapped: false}));
  beam.visible = false;
  scene.add(beam);
  // The ring on the ground, like a taxi stop: gold for the passenger, green for the drop-off.
  const ring = new T.Mesh(new T.RingGeometry(REACH - 1.6, REACH, 48).rotateX(-Math.PI / 2),
    new T.MeshBasicMaterial({color: 0xffd23a, transparent: true, opacity: .85, side: T.DoubleSide, toneMapped: false, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6}));
  ring.visible = false;
  scene.add(ring);
  // An arrow floating over the car, pointing at the ring.
  const pointer = new T.Mesh(new T.ConeGeometry(.55, 1.5, 4).rotateX(Math.PI / 2),
    new T.MeshBasicMaterial({color: 0xffa23a, toneMapped: false}));
  pointer.visible = false;
  scene.add(pointer);
  let pulse = 0, graph = null, rerouted = 0;

  // A flat chevron pointing +Z, lying on the road.
  const shape = new T.Shape();
  shape.moveTo(0, 1.5); shape.lineTo(1.45, -1.05); shape.lineTo(0, -.25); shape.lineTo(-1.45, -1.05); shape.closePath();
  const chevron = new T.ShapeGeometry(shape);
  chevron.rotateX(Math.PI / 2);
  const arrows = new T.InstancedMesh(chevron, new T.MeshBasicMaterial({
    color: 0xffa23a, side: T.DoubleSide, toneMapped: false, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
  }), ARROWS_AHEAD);
  arrows.frustumCulled = false;
  arrows.count = 0;
  arrows.visible = false;
  scene.add(arrows);
  const matrix = new T.Matrix4(), rotation = new T.Quaternion(), up = new T.Vector3(0, 1, 0), scale = new T.Vector3(1.25, 1, 1.25);

  const state = {enabled, offers: [], slot: -1, job: null, stage: null, earned: 0, done: new Set(), message: '', messageTime: 0, distance: 0, legTime: 0,
    stats: {hardBrakes: 0, overspeed: 0, horns: 0}, heat: 0, heatCool: 0, brakeCool: 0, prevSpeed: 0, said: 0};
  let trail = [], trailIndex = 0, trailFor = null;

  const typeOf = job => TYPES[job?.type] ?? TYPES.commuter;
  const resetStats = () => { state.stats = {hardBrakes: 0, overspeed: 0, horns: 0}; state.heat = 0; state.heatCool = 0; state.said = 0; state.prevSpeed = 0; };
  const target = () => !state.enabled || !state.job ? null : state.stage === 'pickup' ? state.job.pickup : state.job.dropoff;

  function refresh(slot) {
    state.slot = slot;
    const offers = makeOffers(slot).filter(o => !state.done.has(o.id));
    state.offers = career ? career.filterOffers(offers) : offers;
  }
  function reset(hour) {
    state.job = null; state.stage = null; state.done.clear(); state.earned = 0; state.message = '';
    beam.visible = false;
    refresh(slotOf(hour));
  }
  const nearestOffer = (x, z) => state.offers.map(o => ({o, d: Math.hypot(o.pickup[0] - x, o.pickup[1] - z)}))
    .sort((a, b) => a.d - b.d)[0]?.o ?? null;

  function accept(x, z) {
    if (!state.enabled || state.job) return false;
    const offer = nearestOffer(x, z);
    if (!offer) return false;
    state.job = offer; state.stage = 'pickup'; state.legTime = 0; resetStats();
    career?.beginFare();
    state.offers = state.offers.filter(o => o !== offer);
    return true;
  }
  // Shows a short message in the job panel, for news the career produces outside a fare.
  function say(text, seconds = 7) { state.message = text; state.messageTime = seconds; }
  // The passenger leaves: abandoning a fare in the back of the car costs rating.
  function fail(reason) {
    if (!state.job) return;
    const aboard = state.stage === 'deliver';
    const out = aboard || reason === 'arrested' ? career?.failFare(reason) : null;
    const who = state.job.passenger.toLowerCase();
    state.message = reason === 'arrested'
      ? `Arrested. ${who} left the car. Fine ${out?.fine ?? 0} EUR.`
      : aboard ? `You left ${who} by the road. The fare is lost.` : '';
    if (state.message) state.messageTime = 7;
    cancel();
  }
  function cancel() { state.job = null; state.stage = null; beam.visible = false; ring.visible = false; pointer.visible = false; }
  function toggle() {
    state.enabled = !state.enabled;
    if (!state.enabled) fail('abandoned');
    state.message = state.enabled ? 'Missions on. M turns them off.' : 'Missions off.';
    state.messageTime = 3;
    return state.enabled;
  }

  // Arrows lie along the road to the current stop. The pickup leg is routed from
  // wherever the car is; the drop-off leg follows the fare's own route.
  function layTrail(x, z, dt) {
    const goalPoint = target();
    const key = goalPoint && state.job.id + state.stage;
    if (!goalPoint) { trail = []; trailFor = null; return; }
    rerouted -= dt;
    if (trailFor !== key || state.stage === 'pickup' && rerouted <= 0) {
      trailFor = key; trailIndex = 0; rerouted = 1.5;
      if (state.stage === 'pickup') {
        graph ??= corridorGraph(world);
        trail = resample(guidePath(world, graph, [x, z], goalPoint), ARROW_SPACING);
      } else trail = resample(state.job.route, ARROW_SPACING);
    }
    let best = trailIndex, bestD = Infinity;
    for (let i = Math.max(0, trailIndex - 3); i < Math.min(trail.length, trailIndex + 80); i++) {
      const d = Math.hypot(trail[i].x - x, trail[i].z - z);
      if (d < bestD) { bestD = d; best = i; }
    }
    trailIndex = best;
  }

  function update(x, z, speed, hour, dt, yaw = 0, ctx = {}) {
    if (slotOf(hour) !== state.slot) refresh(slotOf(hour));
    state.messageTime = Math.max(0, state.messageTime - dt);
    if (state.job && ctx.arrested) fail('arrested');
    if (state.job && state.stage === 'deliver') {
      state.legTime += dt;
      const kmh = Math.abs(speed) * 3.6, limit = ctx.limit ?? 50, kind = typeOf(state.job);
      state.brakeCool = Math.max(0, state.brakeCool - dt);
      const slowing = dt > 0 ? (state.prevSpeed - Math.abs(speed)) / dt : 0;
      if (slowing > 6.5 && state.prevSpeed > 4 && !state.brakeCool) { state.stats.hardBrakes++; state.brakeCool = 1.6; }
      state.prevSpeed = Math.abs(speed);
      if (kmh > limit + 8) state.stats.overspeed += dt;
      // Heat: speeding hard draws the police. Hurried passengers make it build twice as fast.
      state.heatCool = Math.max(0, state.heatCool - dt);
      const excess = Math.max(0, kmh - (limit + 20));
      state.heat = Math.min(1.5, Math.max(0, state.heat + (excess / 45 * kind.heat * .5 - (excess ? 0 : .035)) * dt));
      if (state.heat >= 1 && !state.heatCool) { state.heatCool = 30; state.heat = .5; ctx.onHeat?.(); }
      // Remarks on the way: a third and two thirds of the way there.
      const length = state.job.length || 1, progress = 1 - Math.min(1, state.distance / length);
      const due = progress > .7 ? 2 : progress > .35 ? 1 : 0;
      if (due > state.said && state.messageTime <= 0) {
        state.said = due;
        const mood = career?.mood(state.job, state.legTime, state.stats);
        state.message = `${state.job.passenger}: "${remark(kind, 'mid', due + state.job.reward, (mood?.stars ?? 5) < 4)}"`;
        state.messageTime = 5;
      }
    }
    if (!state.enabled) {
      beam.visible = false; arrows.visible = false; ring.visible = false; pointer.visible = false; if (goal) goal.hidden = true;
      panel.hidden = state.messageTime <= 0;
      if (!panel.hidden) panel.textContent = state.message;
      return;
    }
    const current = target();
    if (current) {
      state.distance = Math.hypot(current[0] - x, current[1] - z);
      if (state.distance < REACH && Math.abs(speed) < STOP_SPEED) {
        if (state.stage === 'pickup') {
          state.stage = 'deliver'; state.legTime = 0; resetStats();
          state.message = `${state.job.passenger} got in: "${remark(typeOf(state.job), 'intro')}" Take them to ${state.job.to}.`;
        } else {
          const paid = career?.settle(state.job, state.legTime, world?.seed, state.stats);
          const total = paid ? paid.total : state.job.reward;
          state.earned += total;
          state.done.add(state.job.id);
          state.message = `Fare complete in ${state.job.to}: EUR ${total}`;
          if (paid) {
            state.message += ` · "${remark(typeOf(state.job), 'bye', state.job.reward + paid.stars)}" · ${paid.stars} stars` + (paid.tip ? ` · tip +${Math.round(paid.tip * 100)}%` : '') +
              (paid.notes.length ? ` (${paid.notes.join(', ')})` : '');
            const news = career.takeNotices();
            if (news.length) state.message += ' · ' + news.join(' · ');
          }
          state.job = null; state.stage = null;
        }
        state.messageTime = 9;
      }
    }
    const goalNow = target();
    beam.visible = Boolean(goalNow);
    if (goalNow) {
      const gy = world ? world.roadHeight(goalNow[0], goalNow[1]) : ground.height(goalNow[0], goalNow[1]);
      beam.position.set(goalNow[0], gy + 23, goalNow[1]);
      pulse += dt;
      ring.visible = true;
      ring.position.set(goalNow[0], gy + .32, goalNow[1]);
      ring.scale.setScalar(1 + .06 * Math.sin(pulse * 4));
      ring.material.color.set(state.stage === 'pickup' ? 0xffd23a : 0x62e08a);
      pointer.visible = true;
      const dx = goalNow[0] - x, dz = goalNow[1] - z, len = Math.hypot(dx, dz) || 1;
      pointer.position.set(x, ground.height(x, z) + 3.6 + .18 * Math.sin(pulse * 5), z);
      pointer.rotation.set(0, Math.atan2(dx / len, dz / len), 0);
    } else { ring.visible = false; pointer.visible = false; }

    layTrail(x, z, dt);
    const shown = goalNow ? trail.slice(trailIndex + 1, trailIndex + 1 + ARROWS_AHEAD) : [];
    arrows.count = shown.length;
    arrows.visible = shown.length > 0;
    shown.forEach((t, i) => {
      const y = (world ? world.roadHeight(t.x, t.z) : ground.height(t.x, t.z)) + .26;
      rotation.setFromAxisAngle(up, Math.atan2(t.dx, t.dz));
      matrix.compose(new T.Vector3(t.x, y, t.z), rotation, scale);
      arrows.setMatrixAt(i, matrix);
    });
    arrows.instanceMatrix.needsUpdate = true;

    if (goal) {
      goal.hidden = !goalNow;
      if (goalNow) {
        const bearing = Math.atan2(goalNow[0] - x, goalNow[1] - z);
        goal.querySelector('#goal-arrow').style.transform = `rotate(${yaw - bearing}rad)`;
        goal.querySelector('#goal-dist').textContent = state.distance >= 1000
          ? (state.distance / 1000).toFixed(1) + ' km' : Math.round(state.distance) + ' m';
      }
    }

    let text = '';
    if (state.job) {
      text = state.stage === 'pickup'
        ? `Pick up ${state.job.passenger.toLowerCase()} in ${state.job.from} · stop in the ring`
        : `Drop off in ${state.job.to} · stop in the ring`;
    } else if (state.messageTime > 0) text = state.message;
    else {
      const offer = nearestOffer(x, z);
      if (offer) text = `J · Take fare: ${offer.passenger}, ${offer.from} to ${offer.to}, ${(offer.length / 1000).toFixed(1)} km, EUR ${offer.reward}`;
    }
    if (state.earned && !state.job && !text) text = `Earned EUR ${state.earned}`;
    panel.hidden = !text;
    if (text) panel.textContent = state.earned ? `${text}  ·  EUR ${state.earned}` : text;
  }

  function drawMap(map, point, local, size) {
    if (!state.enabled) return;
    const current = target();
    const markers = current ? [] : state.offers.map(o => o.pickup);
    if (state.job && state.stage === 'deliver') {
      map.strokeStyle = '#ffb04a'; map.lineWidth = 2.4; map.beginPath();
      state.job.route.forEach((p, i) => map[i ? 'lineTo' : 'moveTo'](...point(p[0], p[1])));
      map.stroke();
    }
    for (const p of current ? [current] : markers) {
      let [px, pz] = point(p[0], p[1]);
      if (local) {
        const dx = px - size / 2, dz = pz - size / 2;
        const f = Math.min(1, (size / 2 - 12) / Math.max(Math.abs(dx), Math.abs(dz), 1));
        px = size / 2 + dx * f; pz = size / 2 + dz * f;
      }
      map.fillStyle = current ? '#ffb04a' : '#8fd1ff';
      map.beginPath(); map.arc(px, pz, current ? 6 : 4, 0, Math.PI * 2); map.fill();
    }
  }
  function dispose() {
    beam.removeFromParent(); arrows.removeFromParent(); ring.removeFromParent(); pointer.removeFromParent();
    arrows.geometry.dispose(); arrows.material.dispose();
  }
  // What the taxi meter and the passenger show on the HUD.
  function meter() {
    const job = state.job, aboard = Boolean(job) && state.stage === 'deliver';
    if (!job) return {active: false};
    const progress = aboard ? trail.length > 1 ? Math.min(1, trailIndex / (trail.length - 1)) : 0 : 0;
    const mood = aboard ? career?.mood(job, state.legTime, state.stats) : null;
    return {active: true, aboard, passenger: job.passenger, type: job.type, intro: typeOf(job).intro,
      fare: job.reward * progress, km: job.length * progress / 1000, stars: mood?.stars ?? 5, tip: mood?.tip ?? 0,
      heat: Math.min(1, state.heat), elapsed: state.legTime, par: (job.length / 12 + 25) * typeOf(job).par};
  }
  function noteHorn() { if (state.job && state.stage === 'deliver') state.stats.horns++; }
  function noteImpact(j) { if (state.job && j >= 1200) state.heat = Math.min(1.5, state.heat + .35 * typeOf(state.job).heat); }
  function noteFine() { if (state.job) state.heat = Math.min(1.5, state.heat + .3); }
  return {state, reset, accept, cancel, fail, toggle, update, drawMap, dispose, say, meter, noteHorn, noteImpact, noteFine, beam, arrows, refresh: () => refresh(state.slot)};
}
