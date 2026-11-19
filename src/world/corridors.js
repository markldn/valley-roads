import { LIMIT, OUTER_SPACING } from './world.js';

// Road network measurement and the lightweight corridor graph. Everything is a
// pure function of the world: streamed roads beyond the region come from the same
// outerLine() the expanse draws, so both agree on alignment.

export const TARGET_KM = 100;
export const MEASURE_HALF = LIMIT + OUTER_SPACING; // region, the ring road, and the first streamed band

const poly = pts => pts.reduce((s, p, i) => i ? s + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0, 0);

/** Stable id of a grid road: the same for the region and for streamed chunks. */
export const roadId = (alongX, cross) => `${alongX ? 'x' : 'z'}${Math.round(cross * 10)}`;

/** Streamed lines outside the region, clipped to |coordinate| <= half. */
export function streamedRoads(world, half = MEASURE_HALF) {
  const lines = [];
  for (const alongX of [true, false]) {
    const last = Math.ceil(half / OUTER_SPACING) + 1;
    for (let i = -last; i <= last; i++) {
      const cross = world.outerLine(i, alongX);
      if (Math.abs(cross) > half) continue;
      const ranges = Math.abs(cross) >= LIMIT ? [[-half, half]] : [[-half, -LIMIT], [LIMIT, half]];
      for (const [start, end] of ranges)
        lines.push({id: roadId(alongX, cross), alongX, cross, start, end, ring: false, width: i ? 7.2 : 9});
    }
    for (const cross of [-LIMIT, LIMIT])
      lines.push({id: roadId(alongX, cross) + 'r', alongX, cross, start: -LIMIT, end: LIMIT, ring: true, width: 7.2});
  }
  return lines;
}

/** Kilometres of centerline, each road counted once, by class. */
export function networkLength(world, half = MEASURE_HALF) {
  let motorway = 0, regional = 0;
  for (const road of world.roads) {
    const length = road.spans.reduce((a, [s, e]) => a + (e - s), 0);
    if (road.highway) motorway += length; else regional += length;
  }
  const streets = world.streets.reduce((a, s) => a + poly(s.points), 0);
  const mountain = world.mountainRoads.reduce((a, r) => a + poly(r.points), 0);
  const streamed = streamedRoads(world, half).reduce((a, r) => a + (r.end - r.start), 0);
  const km = {motorway, regional, streets, mountain, streamed};
  for (const k of Object.keys(km)) km[k] /= 1000;
  km.total = Object.values(km).reduce((a, b) => a + b, 0);
  return km;
}

const SPEED = {motorway: 30.5, regional: 20, ramp: 14, outer: 20};

export function boundaryPoint(world, alongX, cross, along) {
  // One definition for every area that touches this road: alignment, elevation,
  // lanes and speed all derive from the road's stable id and the station.
  const [x, z] = alongX ? world.point(along, cross) : world.point(cross, along);
  const road = world.roads.find(r => r.alongX === alongX && r.cross === cross && along >= r.start && along <= r.end);
  return {id: roadId(alongX, cross), x, z, y: world.roadHeight(x, z), lanes: road?.highway ? road.lanes : 1,
    limit: road?.highway ? SPEED.motorway : road ? SPEED.regional : SPEED.outer};
}

/**
 * Lightweight long-distance graph: towns, interchanges and junctions joined by
 * corridor segments. Undirected edges carry length, class and speed.
 */
export function corridorGraph(world, half = MEASURE_HALF) {
  const nodes = new Map(), edges = [];
  const node = (key, p, extra = {}) => {
    if (!nodes.has(key)) nodes.set(key, {key, p, edges: [], ...extra});
    return nodes.get(key);
  };
  const link = (a, b, length, cls, road) => {
    if (a === b) return null;
    const speed = SPEED[cls];
    const edge = {a, b, length, cls, road, speed, cost: length / speed, along: []};
    a.edges.push(edge); b.edges.push(edge); edges.push(edge);
    return edge;
  };
  const lines = [
    ...world.roads.flatMap(road => road.spans.map(([start, end]) => ({
      id: roadId(road.alongX, road.cross), alongX: road.alongX, cross: road.cross, start, end,
      cls: road.highway ? 'motorway' : 'regional', highway: Boolean(road.highway), road}))),
    ...streamedRoads(world, half).map(r => ({...r, cls: 'outer', highway: false})),
  ];
  const at = (line, along) => line.alongX ? world.point(along, line.cross) : world.point(line.cross, along);
  const stations = new Map(lines.map(line => [line, new Map()]));
  const eps = .01;
  const addStation = (line, along, key, extra) => {
    const m = stations.get(line);
    for (const [a, n] of m) if (Math.abs(a - along) < 1) return n;
    const n = node(key, at(line, along), extra);
    m.set(along, n);
    return n;
  };
  for (const line of lines) {
    addStation(line, line.start, `e:${line.id}:${Math.round(line.start)}`);
    addStation(line, line.end, `e:${line.id}:${Math.round(line.end)}`);
  }
  const rows = lines.filter(l => l.alongX), columns = lines.filter(l => !l.alongX);
  for (const row of rows) for (const column of columns) {
    const u = column.cross, v = row.cross;
    if (u < row.start - eps || u > row.end + eps || v < column.start - eps || v > column.end + eps) continue;
    // Motorways meet other roads only at their ends and at interchanges.
    if (row.highway && u > row.start + eps && u < row.end - eps) continue;
    if (column.highway && v > column.start + eps && v < column.end - eps) continue;
    const key = `j:${Math.round(u)},${Math.round(v)}`;
    const a = addStation(row, u, key), b = addStation(column, v, key);
    if (a !== b) { // same physical point reached through two station maps
      for (const e of b.edges) { e.a === b ? e.a = a : e.b = a; a.edges.push(e); }
      nodes.delete(b.key); stations.get(column).set(v, a);
    }
  }
  // Roundabouts cut their roads: all arms meeting a circle become one junction.
  for (const circle of world.roundabouts) {
    const [cx, cz] = world.point(circle.u, circle.v);
    const near = [...nodes.values()].filter(n => Math.hypot(n.p[0] - cx, n.p[1] - cz) < circle.cut + 8);
    if (near.length < 2) continue;
    const hub = near[0];
    for (const other of near.slice(1)) {
      for (const m of stations.values()) for (const [along, n] of m) if (n === other) m.set(along, hub);
      nodes.delete(other.key);
    }
  }
  // Interchanges: each ramp joins a motorway station to a local-road station.
  const ramps = [];
  world.exits.forEach((exit, i) => exit.streets.forEach((street, k) => {
    const hw = lines.find(l => l.road === exit.motorway && street.points[0][exit.motorway.alongX ? 0 : 1] >= l.start && street.points[0][exit.motorway.alongX ? 0 : 1] <= l.end);
    const local = lines.find(l => l.road === exit.road && street.points.at(-1)[exit.road.alongX ? 0 : 1] >= l.start && street.points.at(-1)[exit.road.alongX ? 0 : 1] <= l.end);
    if (!hw || !local) return;
    const main = addStation(hw, street.points[0][exit.motorway.alongX ? 0 : 1], `x:${i}:${k}:m`, {interchange: i});
    const side = addStation(local, street.points.at(-1)[exit.road.alongX ? 0 : 1], `x:${i}:${k}:l`, {interchange: i});
    main.interchange = side.interchange = i;
    link(main, side, poly(street.points), 'ramp', null);
    ramps.push({main, side});
  }));
  for (const line of lines) {
    const ordered = [...stations.get(line)].sort((x, y) => x[0] - y[0]);
    for (let i = 1; i < ordered.length; i++)
      link(ordered[i - 1][1], ordered[i][1], ordered[i][0] - ordered[i - 1][0], line.cls, line.id)
        ?.along?.push(ordered[i - 1][0], ordered[i][0], line);
  }
  // Settlements hang off the grid node at their position.
  const townNodes = new Map();
  for (const town of world.towns) {
    const [x, z] = world.point(town.u, town.v);
    let hub = null, best = 60;
    for (const n of nodes.values()) {
      const d = Math.hypot(n.p[0] - x, n.p[1] - z);
      if (d < best) { best = d; hub = n; }
    }
    if (hub) { hub.town = town.id ?? town.name; townNodes.set(town, hub); }
  }
  return {nodes: [...nodes.values()], edges, townNodes, ramps, lines, route: (a, b, options) => route(a, b, options)};
}

/** Dijkstra over the corridor graph. avoid: set of classes to refuse. */
export function route(from, to, {avoid = []} = {}) {
  const cost = new Map([[from, 0]]), prev = new Map(), open = new Set([from]);
  while (open.size) {
    let n = null;
    for (const c of open) if (!n || cost.get(c) < cost.get(n)) n = c;
    open.delete(n);
    if (n === to) break;
    for (const e of n.edges) {
      if (avoid.includes(e.cls)) continue;
      const m = e.a === n ? e.b : e.a, c = cost.get(n) + e.cost;
      if (c >= (cost.get(m) ?? Infinity)) continue;
      cost.set(m, c); prev.set(m, e); open.add(m);
    }
  }
  if (!prev.has(to) && from !== to) return null;
  const path = [];
  for (let n = to; n !== from;) { const e = prev.get(n); path.push(e); n = e.a === n ? e.b : e.a; }
  return {edges: path.reverse(), cost: cost.get(to), length: path.reduce((s, e) => s + e.length, 0)};
}

/** Places to stop: one service area midway along every motorway interchange gap, plus road ends. */
export function serviceStops(world) {
  const stops = [];
  for (const road of world.roads.filter(r => r.highway)) {
    const at = road.exits ?? [];
    const marks = world.exits.filter(e => e.motorway === road)
      .flatMap(e => e.streets.slice(0, 1).map(s => s.points[0][road.alongX ? 0 : 1])).sort((a, b) => a - b);
    const bounds = [road.start, ...marks, road.end];
    for (let i = 1; i < bounds.length; i++) {
      if (bounds[i] - bounds[i - 1] < 900) continue;
      const along = (bounds[i] + bounds[i - 1]) / 2;
      const [x, z] = road.alongX ? world.point(along, road.cross) : world.point(road.cross, along);
      stops.push({id: `${roadId(road.alongX, road.cross)}@${Math.round(along)}`, road: road.name, alongX: road.alongX,
        cross: road.cross, along, x, z, kind: 'service'});
    }
  }
  return stops;
}

/** World x/z samples along a route that starts at `from`, every `step` metres. */
export function routePolyline(world, found, from, step = 40) {
  const points = [];
  let here = from;
  for (const e of found.edges) {
    const forward = e.a === here, next = forward ? e.b : e.a;
    if (e.along.length) {
      const [s, t, line] = e.along;
      const [first, last] = forward ? [s, t] : [t, s];
      const n = Math.max(1, Math.ceil(Math.abs(last - first) / step));
      for (let i = 0; i <= n; i++) {
        const along = first + (last - first) * i / n;
        points.push(line.alongX ? world.point(along, line.cross) : world.point(line.cross, along));
      }
    } else points.push(here.p, next.p);
    here = next;
  }
  return points;
}

/** Road-following guide from a free position to a target: straight to the nearest
 *  graph node, along the corridor graph, then straight to the target. */
export function guidePath(world, graph, from, to) {
  const near = ([x, z]) => graph.nodes.filter(n => n.edges.length)
    .reduce((best, n) => { const d = Math.hypot(n.p[0] - x, n.p[1] - z); return d < best.d ? {n, d} : best; }, {n: null, d: Infinity}).n;
  const a = near(from), b = near(to);
  if (!a || !b) return [from, to];
  const found = a === b ? {edges: []} : route(a, b);
  if (!found) return [from, to];
  return [from, ...routePolyline(world, found, a), to];
}
