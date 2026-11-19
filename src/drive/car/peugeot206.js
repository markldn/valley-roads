import * as T from 'three';

function mesh(group, geometry, material, x, y, z) {
  const part = new T.Mesh(geometry, material);
  part.position.set(x, y, z);
  part.castShadow = true;
  group.add(part);
  return part;
}

function bar(group, from, to, radius, material) {
  const axis = new T.Vector3().subVectors(to, from);
  const center = from.clone().lerp(to, .5);
  const tube = mesh(group, new T.CylinderGeometry(radius, radius, axis.length(), 8),
    material, center.x, center.y, center.z);
  tube.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), axis.normalize());
}

// Longitudinal corrections in metres, fitted to frontal depth samples.
const frontStations = [0, .18, .36, .54, .69, .81, .91];
const bumperWidthCorrections = [.046, .037, .009, -.044, -.050, .008, 0];
const hoodWidthCorrections = [.013, -.030, -.052, -.086, -.106, -.101, 0];

// Projected lens outlines measured across the front of the car. Both the
// shell recess and material use these stations.
const lampStations = [
  [.362, .664, .664], [.418, .613, .739], [.492, .628, .771],
  [.564, .658, .794], [.628, .680, .813], [.676, .723, .822], [.708, .798, .798],
];
export const lens206GLSL = lampStations.reduceRight((curve, [x, low, high], i) => {
  if (!i) return curve;
  const [left, lower, upper] = lampStations[i - 1];
  const mix = `mix(vec2(${lower},${upper}),vec2(${low},${high}),smoothstep(${left},${x},ax))`;
  return curve ? `(ax < ${x} ? ${mix} : ${curve})` : mix;
}, '');

function lensLimits(x) {
  let i = 1;
  while (i < lampStations.length - 1 && x > lampStations[i][0]) i++;
  const [left, lower, upper] = lampStations[i - 1];
  const [right, low, high] = lampStations[i];
  const t = T.MathUtils.smoothstep(x, left, right);
  return [T.MathUtils.lerp(lower, low, t), T.MathUtils.lerp(upper, high, t)];
}

function sampleAcrossNose(values, x) {
  let station = 1;
  while (station < frontStations.length - 1 && x > frontStations[station]) station++;
  const left = frontStations[station - 1];
  const t = T.MathUtils.clamp((x - left) / (frontStations[station] - left), 0, 1);
  return T.MathUtils.lerp(values[station - 1], values[station], t);
}

export function fit206Nose(vertices, front) {
  for (let i = 0; i < vertices.length; i += 3) {
    const x = vertices[i], y = vertices[i + 1], z = vertices[i + 2];
    const corner = T.MathUtils.smoothstep(z, front - .53, front - .29)
      * (1 - T.MathUtils.smoothstep(y, .44, .64))
      * T.MathUtils.smoothstep(Math.abs(x), .53, .78);
    const expansion = T.MathUtils.lerp(.039, .021, T.MathUtils.smoothstep(y, .29, .39));
    vertices[i] += Math.sign(x) * expansion * corner;
    vertices[i + 2] = fit206NoseDepth(vertices[i], y, z, front);
  }
}

function fit206NoseDepth(x, y, z, front) {
  const width = Math.abs(x);
  const bumper = sampleAcrossNose(bumperWidthCorrections, width);
  const hood = sampleAcrossNose(hoodWidthCorrections, width);
  const splitter = .066 * (1 - T.MathUtils.smoothstep(y, .24, .30))
    * (1 - T.MathUtils.smoothstep(width, .40, .73));
  const face = T.MathUtils.lerp(bumper, hood, T.MathUtils.smoothstep(y, .54, .66));
  const weight = T.MathUtils.smoothstep(z, front - .76, front - .18)
    * (1 - T.MathUtils.smoothstep(y, .79, .96));
  const [low, high] = lensLimits(width);
  const lens = T.MathUtils.smoothstep(y, low, low + .013)
    * (1 - T.MathUtils.smoothstep(y, high - .013, high))
    * T.MathUtils.smoothstep(z, front - .67, front - .45);
  const duct = T.MathUtils.smoothstep(width, .552, .592)
    * (1 - T.MathUtils.smoothstep(width, .70, .742))
    * T.MathUtils.smoothstep(y, .317, .354)
    * (1 - T.MathUtils.smoothstep(y, .449, .488));
  return z + weight * (face + splitter - .009 * lens - .020 * duct);
}

// Rear-depth offsets from the reference hatch and bumper, blended into the quarter panels.
export function rear206Depth(x, y, z, rear) {
  const rearFace = 1 - T.MathUtils.smoothstep(z, rear + .17, rear + .49);
  const hatch = T.MathUtils.smoothstep(y, .54, .625)
    * (1 - T.MathUtils.smoothstep(y, .80, 1.04));
  const corner = T.MathUtils.smoothstep(Math.abs(x), .35, .73);
  const bumper = 1 - T.MathUtils.smoothstep(y, .53, .62);
  return z + rearFace * (hatch * (.096 + .058 * corner) + .095 * x * x - bumper * .058 * corner);
}

export function fit206Rear(vertices, rear) {
  for (let i = 0; i < vertices.length; i += 3) {
    vertices[i + 2] = rear206Depth(vertices[i], vertices[i + 1], vertices[i + 2], rear);
  }
}

let grilleNumber;
function frontNumberTexture() {
  if (!grilleNumber) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 112;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#111214';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#d9d9d9';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'italic 900 91px sans-serif';
    ctx.fillText('206', 128, 61);
    grilleNumber = new T.CanvasTexture(canvas);
    grilleNumber.colorSpace = T.SRGBColorSpace;
  }
  return grilleNumber;
}

let tyreSidewall;
export function tyreSidewall206() {
  if (tyreSidewall) return tyreSidewall;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 512;
  const ctx = canvas.getContext('2d');
  ctx.translate(256, 256);
  ctx.strokeStyle = '#bfc0bb';
  ctx.lineWidth = 2.8;
  for (const radius of [181, 249]) {
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.font = 'italic 900 54px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#e3e2db';
  Array.from('MICHELIN').forEach((letter, i) => {
    ctx.save();
    ctx.rotate((i - 3.5) * .188 + .34);
    ctx.fillText(letter, 0, -214);
    ctx.restore();
  });
  ctx.rotate(-1.75);
  ctx.fillStyle = '#c79535';
  ctx.fillRect(-13, -206, 26, 8);
  tyreSidewall = new T.CanvasTexture(canvas);
  tyreSidewall.colorSpace = T.SRGBColorSpace;
  tyreSidewall.anisotropy = 4;
  return tyreSidewall;
}

export function rimSpoke206(rimRadius) {
  const outline = new T.Shape();
  outline.moveTo(-.038, .055);
  outline.quadraticCurveTo(-.053,.119,-.029,rimRadius-.013);
  outline.lineTo(.034,rimRadius-.012);
  outline.quadraticCurveTo(.033,.145,.046,.067);
  outline.closePath();
  const geometry = new T.ExtrudeGeometry(outline, { depth: .018, bevelEnabled: true,
    bevelThickness: .007, bevelSize: .008, bevelSegments: 3, curveSegments: 8 });
  geometry.rotateY(Math.PI / 2);
  return geometry;
}

let glassMarkings;
export function glassMarkings206() {
  if (glassMarkings) return glassMarkings;
  const make = (width, height, paint) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    paint(canvas.getContext('2d'));
    const texture = new T.CanvasTexture(canvas);
    texture.colorSpace = T.SRGBColorSpace;
    texture.anisotropy = 4;
    return texture;
  };
  glassMarkings = {
    u206Banner: { value: make(512, 128, ctx => {
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.font = 'italic bold 91px sans-serif';
      ctx.fillText('sparco', 256, 91);
      ctx.fillRect(120, 102, 272, 6);
    }) },
    u206Crew: { value: make(384, 160, ctx => {
      ctx.fillStyle = '#eee';
      ctx.fillRect(18, 44, 78, 58);
      for (const [i, color] of ['#174baa', '#fff', '#e52633'].entries()) {
        ctx.fillStyle = color;
        ctx.fillRect(21 + i * 24, 47, 24, 52);
      }
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 53px sans-serif';
      ctx.fillText('H. PANIZZI', 107, 61);
      ctx.fillText('G. PANIZZI', 107, 123);
    }) },
  };
  return glassMarkings;
}

export function add206Exterior(group, shell, shape, mats, heightAt) {
  const ray = new T.Raycaster();
  const zWing = shape.zr + .16;
  const wingY = heightAt(shape.zr + .25) + .34;
  const wingSpan = 1.30;
  const blade = mesh(group, new T.BoxGeometry(wingSpan, .064, .24, 12, 1, 1),
    mats.paint, 0, wingY, zWing - .06);
  const vertices = blade.geometry.attributes.position;
  for (let i = 0; i < vertices.count; i++) {
    const tip = Math.abs(vertices.getX(i)) / (wingSpan / 2);
    vertices.setY(i, vertices.getY(i) - .07 * tip ** 3);
    vertices.setZ(i, vertices.getZ(i) + .13 * tip ** 2);
  }
  blade.geometry.computeVertexNormals();

  for (const side of [-1, 1]) {
    const mount = new T.Shape();
    mount.moveTo(.055, -.025);
    mount.bezierCurveTo(-.075, .012, -.175, .12, -.25, .29);
    mount.quadraticCurveTo(-.265, .33, -.20, .325);
    mount.bezierCurveTo(-.147, .20, -.036, .097, .085, .026);
    mount.closePath();
    const upright = new T.ExtrudeGeometry(mount, { depth: .063, bevelSize: .012,
      bevelThickness: .012, bevelSegments: 2, steps: 1, curveSegments: 10 });
    upright.rotateY(-Math.PI / 2);
    mesh(group, upright, mats.paint, side * .57 + .032, wingY - .35, zWing + .24);

    for (const axle of [shape.a, -shape.b]) {
      mesh(group, new T.BoxGeometry(.21, .235, .024), mats.trim,
        side * .775, .266, axle - .35);
    }

    const strip = new T.BoxGeometry(.019, .036, .94, 1, 1, 12);
    const points = strip.attributes.position;
    for (let i = 0; i < points.count; i++) {
      const z = -.24 + points.getZ(i);
      const y = .58 + points.getY(i);
      ray.set(new T.Vector3(side, y, z), new T.Vector3(-side, 0, 0));
      const x = ray.intersectObject(shell, false)[0]?.point.x ?? side * .8;
      points.setXYZ(i, x + side * (points.getX(i) + .008), y, z);
    }
    strip.computeVertexNormals();
    mesh(group, strip, mats.paint, 0, 0, 0);

    const ventZ = shape.zf - .67;
    const ventX = side * .30;
    const opening = new T.Shape();
    opening.moveTo(-.093, -.042);
    opening.lineTo(.096, -.031);
    opening.lineTo(.074, .044);
    opening.quadraticCurveTo(0, .052, -.079, .029);
    opening.closePath();
    const ventSurface = new T.ShapeGeometry(opening);
    const ventPoints = ventSurface.attributes.position;
    const hoodPoint = (x, z) => {
      ray.set(new T.Vector3(x, 1.8, z), new T.Vector3(0, -1, 0));
      const y = ray.intersectObject(shell, false)[0]?.point.y ?? heightAt(z);
      return new T.Vector3(x, y + .004, z);
    };
    for (let i = 0; i < ventPoints.count; i++) {
      const x = ventPoints.getX(i), z = ventPoints.getY(i);
      const point = hoodPoint(ventX + x, ventZ - z + side * x * .11);
      ventPoints.setXYZ(i, point.x, point.y, point.z);
    }
    ventSurface.computeVertexNormals();
    mesh(group, ventSurface, mats.trim, 0, 0, 0);
    for (let i = 0; i < 3; i++) {
      const z = ventZ + (i - 1) * .020;
      bar(group, hoodPoint(ventX - .067, z - side * .008),
        hoodPoint(ventX + .069, z + side * .008), .004, mats.paint);
    }
  }

  const numberMaterial = new T.MeshStandardMaterial({ map: frontNumberTexture(), roughness: .66 });
  mesh(group, new T.PlaneGeometry(.238, .104), numberMaterial, 0, .421, fit206NoseDepth(0, .421, shape.zf, shape.zf) + .008);

  const gripZ = rear206Depth(0, .80, shape.zr, shape.zr);
  const hatchGrip = mesh(group, new T.SphereGeometry(1, 16, 8), mats.paint, 0, .80, gripZ - .020);
  hatchGrip.scale.set(.235, .023, .019);
  const lock = mesh(group, new T.SphereGeometry(1, 12, 8), mats.chrome, 0, .794, gripZ - .039);
  lock.scale.set(.016, .016, .006);

  const badge = new T.Shape();
  badge.moveTo(-.037, .041);
  badge.lineTo(.037, .041);
  badge.lineTo(.032, -.01);
  badge.quadraticCurveTo(0, -.054, -.032, -.01);
  badge.closePath();
  const emblem = mesh(group, new T.ShapeGeometry(badge), mats.chrome, 0,
    heightAt(shape.zf) - .068, fit206NoseDepth(0, .53, shape.zf, shape.zf) + .009);
  emblem.rotation.x = -.14;

  const scoopZ = shape.roofF - .17;
  const scoopY = heightAt(scoopZ);
  const scoop = mesh(group, new T.SphereGeometry(1, 20, 10), mats.paint, 0, scoopY, scoopZ);
  scoop.scale.set(.215, .058, .145);
  mesh(group, new T.BoxGeometry(.28, .023, .014), mats.trim, 0, scoopY + .014, scoopZ + .117);

  const aerialZ = shape.roofR + .53;
  const aerialY = heightAt(aerialZ);
  bar(group, new T.Vector3(0, aerialY, aerialZ), new T.Vector3(0, aerialY + .478, aerialZ - .07), .004, mats.trim);

  const cowlY = heightAt(shape.wsBase) + .013;
  for (const x of [-.39, .10]) {
    bar(group, new T.Vector3(x + .19, cowlY - .025, shape.wsBase + .04),
      new T.Vector3(x - .19, cowlY + .045, shape.wsBase - .08), .009, mats.trim);
  }
}

export function dashboard206(width, material) {
  const section = new T.Shape();
  section.moveTo(-.185, -.203);
  section.quadraticCurveTo(-.237, -.112, -.193, -.033);
  section.quadraticCurveTo(-.147, .022, -.032, .017);
  section.quadraticCurveTo(.092, .014, .191, -.026);
  section.lineTo(.196, -.157);
  section.quadraticCurveTo(.105, -.209, -.185, -.203);
  const geometry = new T.ExtrudeGeometry(section, {
    depth: width - .32, bevelThickness: .025, bevelSize: .023, bevelSegments: 3,
    curveSegments: 14, steps: 1,
  });
  geometry.translate(0, 0, -(width - .32) / 2);
  geometry.rotateY(Math.PI / 2);
  return new T.Mesh(geometry, material);
}

export function add206Cockpit(group, shape, mats, dashTop) {
  const instrumentHood = mesh(group, new T.SphereGeometry(1, 20, 10), mats.trim,
    .37, dashTop - .024, shape.wsBase - .48);
  instrumentHood.scale.set(.23,.12,.145);

  for (const x of [-.48, -.24, -.04, .53]) {
    const vent = mesh(group, new T.CylinderGeometry(.037,.036,.015,24), mats.trim,
      x, dashTop-.045, shape.wsBase-.446);
    vent.rotation.x = Math.PI * .43;
    for (let i = -1; i <= 1; i++) {
      const blade = new T.Mesh(new T.BoxGeometry(.051,.006,.005), mats.interior);
      blade.position.set(0, .011, i * .016);
      vent.add(blade);
    }
  }

  const switchPanel = mesh(group, new T.BoxGeometry(.24,.117,.044), mats.seat,
    -.065, dashTop - .104, shape.wsBase - .476);
  switchPanel.rotation.x = -.26;
  for (let i = 0; i < 6; i++) {
    const toggle = new T.Mesh(new T.BoxGeometry(.016,.030,.012),
      i === 0 ? mats.harness : mats.chrome);
    toggle.position.set((i - 2.5) * .033, .015, -.027);
    switchPanel.add(toggle);
  }
  for (const side of [-1, 1]) {
    const headrest = mesh(group, new T.SphereGeometry(1, 16, 10), mats.seat,
      side * .37, 1.085, shape.wsBase - 1.64);
    headrest.scale.set(.164,.116,.081);
    for (const bolster of [-1, 1]) {
      const support = mesh(group, new T.SphereGeometry(1, 12, 8), mats.seat,
        side * .37 + bolster * .209, .77, shape.wsBase - 1.50);
      support.scale.set(.045,.27,.098);
      support.rotation.x = -.19;
    }
  }
  const z = shape.roofF - .86;
  const height = 1.35;
  for (const side of [-1, 1]) {
    const lower = new T.Vector3(side * .69, .30, z);
    const upper = new T.Vector3(side * .56, height, z);
    bar(group, lower, upper, .028, mats.chrome);
    bar(group, upper, new T.Vector3(side * .61, .45, shape.zr + .38), .025, mats.chrome);
    bar(group, lower, new T.Vector3(side * .67, .79, shape.wsBase - .27), .025, mats.chrome);
    for (const offset of [-.085, .085]) {
      const x = side * .37 + offset;
      const harness = mesh(group, new T.BoxGeometry(.044, .42, .021),
        mats.harness, x, .85, shape.wsBase - 1.522);
      harness.rotation.x = -.2;
    }
  }
  bar(group, new T.Vector3(-.56, height, z), new T.Vector3(.56, height, z), .026, mats.chrome);
  bar(group, new T.Vector3(-.62, .43, z), new T.Vector3(.56, height, z), .024, mats.chrome);
  bar(group, new T.Vector3(.10, .52, shape.wsBase - .96),
    new T.Vector3(.10, .79, shape.wsBase - .85), .013, mats.chrome);
  mesh(group, new T.SphereGeometry(.032, 12, 8), mats.trim, .10, .79, shape.wsBase - .85);
}
