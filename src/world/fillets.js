// Rounded corners where roads meet. Roads are axis-aligned strips in grid
// space, so a junction leaves square notches at its corners; each fillet is a
// small asphalt fan that rounds one corner into a curve of the given radius.
// Everything is in grid coordinates (u,v); callers map to world space.

const STEPS = 8;
const covers = (ranges, from, to) => {
  const [lo, hi] = from < to ? [from, to] : [to, from];
  return ranges.some(([s, e]) => s <= lo + 1e-6 && e >= hi - 1e-6);
};

/**
 * rows: [{cross, width, ranges}] for roads along u; columns: same for roads along v.
 * Returns triangles as [[u,v],[u,v],[u,v]].
 */
export function junctionFillets(rows, columns, {radius = 10, skip = () => false, accept = () => true} = {}) {
  const triangles = [];
  for (const row of rows) for (const column of columns) {
    const u = column.cross, v = row.cross;
    if (!covers(row.ranges, u, u) || !covers(column.ranges, v, v)) continue;
    if (skip(u, v) || !accept(u, v)) continue;
    const wa = row.width / 2, wb = column.width / 2;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      // Both roads must continue away from the junction on this corner's side.
      if (!covers(row.ranges, u, u + sx * (wb + radius)) || !covers(column.ranges, v, v + sz * (wa + radius))) continue;
      const cx = u + sx * wb, cz = v + sz * wa;
      const ox = cx + sx * radius, oz = cz + sz * radius;
      let previous = [ox, oz - sz * radius];
      for (let i = 1; i <= STEPS; i++) {
        const phi = Math.PI / 2 * i / STEPS;
        const point = [ox - sx * radius * Math.sin(phi), oz - sz * radius * Math.cos(phi)];
        triangles.push([[cx, cz], previous, point]);
        previous = point;
      }
    }
  }
  return triangles;
}

/** Map grid triangles to flat vertex data with upward-facing winding. */
export function fillTriangles(triangles, world, lift, heightOf = (x, z) => world.roadHeight(x, z)) {
  const out = [];
  for (const tri of triangles) {
    const p = tri.map(([u, v]) => {
      const [x, z] = world.point(u, v);
      return [x, heightOf(x, z) + lift, z];
    });
    const nx = (p[1][2] - p[0][2]) * (p[2][1] - p[0][1]) - (p[1][1] - p[0][1]) * (p[2][2] - p[0][2]);
    const ny = (p[1][0] - p[0][0]) * (p[2][2] - p[0][2]) - (p[1][2] - p[0][2]) * (p[2][0] - p[0][0]);
    void nx;
    const ordered = ny >= 0 ? p : [p[0], p[2], p[1]];
    for (const q of ordered) out.push(...q);
  }
  return out;
}
