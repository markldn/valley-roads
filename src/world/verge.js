import * as T from '../vendor/three.module.js';
import { surface } from '../render/visuals.js';

// Smooth, deterministic wander in metres for a road edge, from its own along
// coordinate, so every layer of one road moves together and tiles still join.
export function edgeWobble(along, cross) {
  return .24 * Math.sin(along * .047 + cross * .61) +
    .13 * Math.sin(along * .163 + cross * 1.7 + 1.3) +
    .07 * Math.sin(along * .41 + 2.2 - cross * .9);
}

const spanIndex = new WeakMap();
function roadFor(world, alongX, cross) {
  if (!spanIndex.has(world)) {
    const index = new Map();
    for (const road of world.roads) index.set(`${road.alongX}:${road.cross}`, road);
    spanIndex.set(world, index);
  }
  return spanIndex.get(world).get(`${alongX}:${cross}`);
}

// The wobble for one road edge at one along position. It tapers to zero within
// 10 m of a span end, so the edges still meet the straight-edged junction fillets.
export function edgeOffset(world, alongX, cross, along) {
  const road = roadFor(world, alongX, cross);
  if (!road || road.highway) return 0;
  const span = road.spans.find(([a, b]) => along >= a - 1 && along <= b + 1);
  if (!span) return 0;
  const t = Math.min(1, Math.max(0, Math.min(along - span[0], span[1] - along) / 10));
  return edgeWobble(along, cross) * t * t * (3 - 2 * t);
}

// Irregular bare earth beside a road: the outer edge varies in width and wanders
// sideways in short steps, so it never reads as a ruled line.
export function vergeMaterial() {
  return surface(0x7a6548, { pattern: 'earth' });
}

// Vertex storage that grows as needed, so triangles are written without building throwaway arrays.
function writer() {
  let data = new Float32Array(3 * 3 * 2048), length = 0;
  const reserve = () => {
    if (length + 9 <= data.length) return;
    const grown = new Float32Array(data.length * 2);
    grown.set(data);
    data = grown;
  };
  // Adds a triangle with its winding fixed so the face points up, whichever side of the road it is on.
  const up = (ax, ay, az, bx, by, bz, cx, cy, cz) => {
    reserve();
    const nY = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    if (nY < 0) { [bx, by, bz, cx, cy, cz] = [cx, cy, cz, bx, by, bz]; }
    data[length++] = ax; data[length++] = ay; data[length++] = az;
    data[length++] = bx; data[length++] = by; data[length++] = bz;
    data[length++] = cx; data[length++] = cy; data[length++] = cz;
  };
  return { up, result: () => data.slice(0, length) };
}

// `sampler` returns the height of the rendered terrain mesh, so the verge sits on
// the ground that is actually drawn, not on the analytic height it was built from.
export function* vergeSteps(world, segments, material, sampler, skip = () => false) {
  const out = writer();
  const STEP = 1.6;
  const ring = new Float64Array(6), before = new Float64Array(6);
  for (const { alongX, cross, width, s, n } of segments) {
    const phase = Math.sin(cross * .37) * 9;
    const half = width / 2;
    for (const side of [-1, 1]) {
      const fill = (position, into) => {
        const wander = .5 * Math.sin(position * .7 + phase + side) + .3 * Math.sin(position * 2.3 + phase * 1.7 - side);
        const outer = side * (half + .55 + .85 * (.5 + .5 * Math.sin(position * .19 + phase)) + .45 * wander);
        const inner = side * (half - .6); // tucked under the asphalt edge, which sits higher
        for (let k = 0; k < 2; k++) {
          const offset = k ? outer : inner;
          const [x, z] = alongX ? world.point(position, cross + offset) : world.point(cross + offset, position);
          into[k * 3] = x; into[k * 3 + 1] = sampler(x, z) + .05; into[k * 3 + 2] = z;
        }
      };
      let havePrevious = false, previousSkipped = true;
      for (let position = s; position <= n + 1e-6; position += STEP) {
        fill(Math.min(position, n), ring);
        const skipped = skip(ring[0], ring[2]);
        if (havePrevious && !skipped && !previousSkipped) {
          out.up(before[0], before[1], before[2], before[3], before[4], before[5], ring[0], ring[1], ring[2]);
          out.up(before[3], before[4], before[5], ring[3], ring[4], ring[5], ring[0], ring[1], ring[2]);
        }
        before.set(ring);
        havePrevious = true;
        previousSkipped = skipped;
      }
      yield 'verge';
    }
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.BufferAttribute(out.result(), 3));
  geometry.computeVertexNormals();
  const mesh = new T.Mesh(geometry, material);
  mesh.receiveShadow = true;
  return { mesh };
}

// The whole mesh at once, for callers that cannot spread the work over frames.
export function vergeMesh(world, segments, material, sampler, skip) {
  const run = vergeSteps(world, segments, material, sampler, skip);
  for (let step = run.next(); ; step = run.next()) if (step.done) return step.value;
}
