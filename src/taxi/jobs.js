import { random } from '../world/world.js';
import { pickType } from './passengers.js';

// Taxi fares come from the commuter and resort plans in towns.js, so every fare
// has a drivable route between two towns. Pure functions of (world, network, time slot).

export const SLOT_HOURS = 4;
export const slotOf = hour => Math.floor((((hour % 24) + 24) % 24) / SLOT_HOURS);

/** Lane points along a route, in world x/z. */
export function routePoints(path) {
  const points = [];
  for (const edge of path) for (const k of edge.knots) {
    const last = points.at(-1);
    if (!last || Math.hypot(k[0] - last[0], k[1] - last[1]) > 1) points.push([k[0], k[1]]);
  }
  return points;
}

/** Up to four fares for a time slot: stable ids, reachable stops, reward from road distance. */
export function jobOffers(world, network, plans, slot) {
  const rng = random(world.seed ^ 0x5eed10b ^ Math.imul(slot + 1, 0x9e3779b1));
  const deliveries = plans.filter(p => p.kind === 'commute' || p.kind === 'resort');
  const order = deliveries.map(p => ({p, k: rng()})).sort((a, b) => a.k - b.k).map(o => o.p);
  const seen = new Set(), offers = [];
  for (const plan of order) {
    if (offers.length >= 4) break;
    if (seen.has(plan.home.id)) continue;
    const route = network.route(plan.home, plan.work);
    if (!route) continue;
    seen.add(plan.home.id);
    const points = routePoints(route.path);
    if (points.length < 2) continue;
    const km = route.length / 1000, type = pickType(rng);
    offers.push({
      id: `${plan.home.id}>${plan.work.id}@${slot}`,
      passenger: type.noun, type: type.id,
      from: plan.home.name, to: plan.work.name,
      pickup: points[0], dropoff: points.at(-1), route: points,
      length: route.length, reward: Math.round(40 + km * 55 + rng() * 15),
    });
  }
  return offers;
}
