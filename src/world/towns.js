import { random } from './world.js';

// Town roles and travel demand. Everything here is a pure function of the world
// (and therefore the seed): no Math.random, no clock reads, no scene objects.

export const ROLES = Object.freeze(['market','industrial','resort','farming']);

const inWindow = (hour, start, width) => ((hour - start) % 24 + 24) % 24 < width;

// Stable id from the seed and grid position, which is unique per settlement.
export const townId = (world, town) => `${world.seed.toString(16)}:${town.u},${town.v}`;

export function assignRoles(world) {
  const {towns} = world;
  if (towns[0].role) return towns.map(t => ({id: t.id, name: t.name, role: t.role}));
  const hubs = towns.filter(t => t.tier === 'hub');
  const elevation = t => world.height(...world.point(t.u, t.v));
  const exits = world.exits ?? [];
  const exitPoints = exits.flatMap(e => e.streets.slice(0, 1).map(s => world.point(...s.points.at(-1))));
  const exitDistance = t => {
    const [tx, tz] = world.point(t.u, t.v);
    return exitPoints.length ? Math.min(...exitPoints.map(([x, z]) => Math.hypot(x - tx, z - tz))) : Infinity;
  };

  for (const t of towns) { t.id = townId(world, t); t.role = 'farming'; t.elevation = elevation(t); }

  // Markets: the main town always; larger cities too.
  hubs.forEach((t, i) => { t.role = i === 0 ? 'market' : 'industrial'; });

  const small = towns.filter(t => t.tier !== 'hub');
  // Resorts need real altitude over the main town, so lowland seeds get none.
  if (world.terrain !== 'lowland' && small.length) {
    const base = towns[0].elevation;
    const ranked = [...small].sort((a, b) => b.elevation - a.elevation);
    const need = world.terrain === 'upland' ? 28 : 40;
    ranked.slice(0, 2).filter(t => t.elevation - base > need).forEach(t => { t.role = 'resort'; });
  }
  // With no second city, the village best placed for motorway access becomes industrial.
  if (!towns.some(t => t.role === 'industrial')) {
    const village = small.filter(t => t.tier === 'village' && t.role === 'farming')
      .sort((a, b) => exitDistance(a) - exitDistance(b) || a.u - b.u || a.v - b.v)[0];
    if (village) village.role = 'industrial';
  }
  return towns.map(t => ({id: t.id, name: t.name, role: t.role}));
}

const byDistance = from => (a, b) =>
  Math.hypot(a.u - from.u, a.v - from.v) - Math.hypot(b.u - from.u, b.v - from.v) || a.u - b.u || a.v - b.v;

/**
 * Plan every scheduled vehicle for a seed. `network.route(from, to)` must return
 * {path} or null. A plan is two legs: out (depart, window) then back.
 * Only trips whose route exists survive, so every plan is drivable.
 */
export function planDemand(world, network) {
  const rng = random(world.seed ^ 0x7a11d3f1);
  const markets = world.towns.filter(t => t.role === 'market');
  const jobs = world.towns.filter(t => t.role === 'market' || t.role === 'industrial');
  const plans = [];
  const nearest = (from, set) => set.filter(t => t !== from).sort(byDistance(from))
    .find(t => network.route(from, t));
  const add = (kind, vehicle, home, work, out, back, window) => {
    const forward = network.route(home, work), reverse = network.route(work, home);
    if (!forward || !reverse) return;
    plans.push({
      id: `${home.id}>${work.id}#${kind}${plans.filter(p => p.kind === kind && p.home === home).length}`,
      kind, vehicle, home, work, out: {depart: out, window}, back: {depart: back, window},
    });
  };
  for (const town of world.towns) {
    if (town.role === 'farming') {
      const market = nearest(town, markets);
      if (market) for (let i = 0, n = town.tier === 'village' ? 2 : 1; i < n; i++)
        add('delivery', 'van', town, market, 5.5 + rng() * 2.5, 12.5 + rng() * 2.5, 2.5);
    }
    if (town !== world.towns[0] && town.role !== 'market') {
      const center = nearest(town, jobs);
      const n = town.tier === 'village' ? 3 : town.tier === 'hamlet' ? 2 : 1;
      if (center) for (let i = 0; i < n; i++)
        add('commute', 'car', town, center, 6.6 + rng() * 1.8, 16.4 + rng() * 1.8, 2);
    }
    if (town.role === 'resort') {
      const market = nearest(town, markets);
      // Visitors travel the other way: market to resort in the morning, back at dusk.
      if (market) for (let i = 0; i < 3; i++)
        add('resort', 'car', market, town, 8.8 + rng() * 2, 16 + rng() * 2, 2.5);
    }
  }
  return plans;
}

/** Trips whose departure window is open at `hour`, as {plan, leg:'out'|'back', from, to}. */
export function departuresAt(plans, hour) {
  const trips = [];
  for (const plan of plans) for (const leg of ['out', 'back']) {
    const {depart, window} = plan[leg];
    if (!inWindow(hour, depart, window)) continue;
    const forward = leg === 'out';
    trips.push({plan, leg, from: forward ? plan.home : plan.work, to: forward ? plan.work : plan.home});
  }
  return trips;
}

/** Index of the plan leg a parked vehicle should launch (or null) given where it is. */
export function launchLeg(plan, at, hour) {
  for (const leg of ['out', 'back']) {
    const from = leg === 'out' ? plan.home : plan.work;
    if (from === at && inWindow(hour, plan[leg].depart, plan[leg].window)) return leg;
  }
  return null;
}

/** Where a vehicle starts parked at `hour`: the end of the latest leg that began before it. */
export function locationAt(plan, hour) {
  const since = leg => ((hour - plan[leg].depart) % 24 + 24) % 24;
  return since('out') < since('back') ? plan.work : plan.home;
}
