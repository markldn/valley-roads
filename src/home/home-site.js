import * as T from '../vendor/three.module.js';

// Your flat, as a place in the world: a doorway beside a street in the main town, marked on both maps and by a
// blue light and a HOME sign at the kerb. Drive there, stop, and press F to go in (the flat is home.js).
function signTexture() {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 128;
  const c = canvas.getContext('2d');
  c.fillStyle = '#1f5fa8'; c.fillRect(0, 0, 256, 128);
  c.strokeStyle = '#e8eef7'; c.lineWidth = 6; c.strokeRect(6, 6, 244, 116);
  c.fillStyle = '#e8eef7';
  c.beginPath(); c.moveTo(54, 74); c.lineTo(86, 40); c.lineTo(118, 74); c.closePath(); c.fill();
  c.fillRect(62, 74, 48, 34);
  c.fillStyle = '#1f5fa8'; c.fillRect(80, 88, 12, 20);
  c.fillStyle = '#e8eef7'; c.font = 'bold 44px system-ui, sans-serif'; c.textAlign = 'left'; c.textBaseline = 'middle';
  c.fillText('HOME', 128, 66);
  const texture = new T.CanvasTexture(canvas);
  texture.colorSpace = T.SRGBColorSpace;
  return texture;
}

export function homeSpot(world) {
  const main = world.towns[0], [cx, cz] = world.point(main.u, main.v);
  const streets = (world.streets || []).filter(street => street.urban && street.points?.length >= 2).map(street => {
    const a = world.point(...street.points[0]), b = world.point(...street.points.at(-1));
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    return {street, a, b, mid, distance: Math.hypot(mid[0] - cx, mid[1] - cz)};
  }).sort((p, q) => p.distance - q.distance);
  for (const {street, a, b, mid} of streets.slice(0, 6)) {
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, dx = (b[0] - a[0]) / length, dz = (b[1] - a[1]) / length;
    for (const side of [1, -1]) {
      const offset = (street.width ?? 7) / 2 + 3.2;
      const x = mid[0] - dz * offset * side, z = mid[1] + dx * offset * side;
      if (world.land(x, z) < 3 && world.riverEdge(x, z) > 12) return {x, z, faceX: dz * side, faceZ: -dx * side};
    }
  }
  return {x: cx + 14, z: cz, faceX: -1, faceZ: 0};
}

export function createHomeSite({scene, world, ground}) {
  const spot = homeSpot(world), {x, z} = spot;
  const y = ground.height(x, z);
  const group = new T.Group();
  group.position.set(x, y, z);
  const post = new T.Mesh(new T.CylinderGeometry(.07, .07, 3.2, 8), new T.MeshBasicMaterial({color: 0x2a3140}));
  post.position.y = 1.6;
  const sign = new T.Mesh(new T.PlaneGeometry(1.6, .8), new T.MeshBasicMaterial({map: signTexture(), color: 0xffffff, side: T.DoubleSide, toneMapped: false}));
  sign.position.y = 3.0;
  sign.rotation.y = Math.atan2(spot.faceX, spot.faceZ);
  const beam = new T.Mesh(new T.CylinderGeometry(1.1, 1.1, 60, 18, 1, true),
    new T.MeshBasicMaterial({color: 0x4aa3ff, transparent: true, opacity: .26, side: T.DoubleSide, depthWrite: false, toneMapped: false}));
  beam.position.y = 30;
  group.add(post, sign, beam);
  scene.add(group);

  return {
    x, z, face: [spot.faceX, spot.faceZ],
    // The doorway is in reach when you are close and nearly stopped, like any other building.
    nearby(px, pz, speed = 0) {
      return Math.hypot(px - x, pz - z) < 17 && Math.abs(speed) < 3 ? {home: true, name: 'your flat', x, z} : null;
    },
    drawMap(map, point, local, size) {
      let [px, pz] = point(x, z);
      if (local) {
        const dx = px - size / 2, dz = pz - size / 2;
        const f = Math.min(1, (size / 2 - 12) / Math.max(Math.abs(dx), Math.abs(dz), 1));
        px = size / 2 + dx * f; pz = size / 2 + dz * f;
      }
      map.save();
      map.fillStyle = '#1f5fa8'; map.strokeStyle = '#e8eef7'; map.lineWidth = 2;
      map.beginPath(); map.arc(px, pz, 8, 0, Math.PI * 2); map.fill(); map.stroke();
      map.fillStyle = '#e8eef7';
      map.beginPath(); map.moveTo(px - 4.5, pz + .5); map.lineTo(px, pz - 4.5); map.lineTo(px + 4.5, pz + .5); map.closePath(); map.fill();
      map.fillRect(px - 3, pz + .5, 6, 4);
      map.restore();
    },
    dispose() {
      group.removeFromParent();
      group.traverse(item => { item.geometry?.dispose(); item.material?.map?.dispose(); item.material?.dispose(); });
    },
  };
}
