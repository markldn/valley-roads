// A human figure for instancing: one smooth indexed mesh (lofted torso, tapered limbs, head with nose,
// eyes and hair, shoes, optional skirt / long hair / coat / backpack / cap) and the GLSL that poses it.
//
// The skeleton is evaluated in the vertex shader from the gait phase, with joint angles taken from
// published gait kinematics (Winter, "The Biomechanics and Motor Control of Human Gait"; Perry, "Gait
// Analysis"): hip flexion -10..+30 deg, knee flexion peaking ~60 deg in swing with a small loading-
// response flexion, plantar-flexed push-off, 4-5 cm vertical pelvis excursion (lowest in double
// support), counter-rotating pelvis and shoulders, opposite arm swing with elbow flexion, and a head
// that stays facing forward.  Running, sitting (driver / passenger), cycling and stepping out of /
// into a car are further poses of the same skeleton.
//
// segment tags: 0 pelvis, 1 upper body, 2 head, 3 thigh, 4 shin, 5 foot, 6 upper arm, 7 forearm + hand
// colour slots: 0 shirt, 1 trousers, 2 skin, 3 shoes / eyes, 4 hair, 5 accent (skirt, coat, bag, cap)
// optional parts: 0 always, 1 long hair, 2 skirt, 3 cap, 4 coat skirts, 5 backpack
import * as THREE from 'three';

const parts = [];
let curTag = 0, curCol = 0, curPart = 0;

function addGeo(g) {
  const ng = g.index ? g : g.toNonIndexed();
  if (!ng.attributes.normal) ng.computeVertexNormals();
  parts.push({ g: ng, tag: curTag, col: curCol, part: curPart });
}

// rings: [y, cx, cz, rx, rz]; closed with a fan at both ends
function loft(rings, seg = 12, cap = true) {
  const pos = [], idx = [];
  for (const [y, cx, cz, rx, rz] of rings) {
    for (let s = 0; s < seg; s++) {
      const a = s / seg * Math.PI * 2;
      pos.push(cx + Math.cos(a) * rx, y, cz + Math.sin(a) * rz);
    }
  }
  for (let r = 0; r + 1 < rings.length; r++) {
    for (let s = 0; s < seg; s++) {
      const a = r * seg + s, b = r * seg + (s + 1) % seg, c = (r + 1) * seg + s, d = (r + 1) * seg + (s + 1) % seg;
      idx.push(a, c, b, b, c, d);
    }
  }
  if (cap) {
    for (const [ri, flip] of [[0, true], [rings.length - 1, false]]) {
      const ci = pos.length / 3;
      const [y, cx, cz] = rings[ri];
      pos.push(cx, y, cz);
      for (let s = 0; s < seg; s++) {
        const a = ri * seg + s, b = ri * seg + (s + 1) % seg;
        if (flip) idx.push(ci, b, a); else idx.push(ci, a, b);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
const mirrorX = (g) => { const c = g.clone(); const p = c.attributes.position; for (let i = 0; i < p.count; i++) p.setX(i, -p.getX(i)); c.index && flipIndex(c); c.computeVertexNormals(); return c; };
function flipIndex(g) { const a = g.index.array; for (let i = 0; i < a.length; i += 3) { const t = a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = t; } }
const ellipsoid = (rx, ry, rz, x, y, z, ws = 12, hs = 9) => new THREE.SphereGeometry(1, ws, hs).scale(rx, ry, rz).translate(x, y, z);

function add(g, tag, col, part = 0) { curTag = tag; curCol = col; curPart = part; addGeo(g); }

let _geo = null;
export function humanGeometry() {
  if (_geo) return _geo;
  // ---- pelvis (trousers) and torso (shirt) ----
  add(loft([[0.84, 0, 0, 0.13, 0.095], [0.88, 0, 0, 0.158, 0.11], [0.96, 0, 0, 0.165, 0.116], [1.03, 0, 0, 0.152, 0.108]], 24, true), 0, 1);
  add(loft([[1.03, 0, 0, 0.152, 0.108], [1.12, 0, 0.004, 0.148, 0.106], [1.22, 0, 0.01, 0.162, 0.118], [1.31, 0, 0.014, 0.182, 0.128],
    [1.37, 0, 0.006, 0.205, 0.122], [1.42, 0, -0.004, 0.196, 0.1], [1.46, 0, -0.006, 0.12, 0.075], [1.48, 0, 0, 0.065, 0.06]], 24, true), 1, 0);
  // chest (female variants get it from the instance width scale; the sleeves are the upper arms)
  add(loft([[1.44, 0, 0, 0.058, 0.056], [1.5, 0, 0.005, 0.05, 0.052], [1.56, 0, 0.01, 0.046, 0.048]], 16, false), 1, 2);   // neck
  // ---- head ----
  add(ellipsoid(.089,.111,.094,0,1.652,.009,24,18),2,2);
  add(ellipsoid(.069,.061,.071,0,1.601,.022,18,12),2,2);
  add(ellipsoid(.015,.024,.019,0,1.639,.103,10,8),2,2);
  add(ellipsoid(.023,.003,.004,0,1.604,.096,10,6),2,6);
  for(const side of [-1,1]){
    add(ellipsoid(.015,.025,.017,side*.085,1.644,.005,10,8),2,2);
    add(ellipsoid(.015,.0065,.006,side*.036,1.669,.092,10,8),2,7);
    add(ellipsoid(.006,.006,.003,side*.036,1.669,.098,8,6),2,3);
    add(ellipsoid(.017,.004,.005,side*.037,1.687,.091,10,6),2,4);
  }
  // hair: a cap over the top and back with the face left open
  add(new THREE.SphereGeometry(1, 28, 16, Math.PI / 2 + 0.75, Math.PI * 2 - 1.5, 0, Math.PI * 0.72).scale(0.096, 0.122, 0.108).translate(0, 1.668, -0.004), 2, 4);
  add(loft([[1.28, 0, -0.07, 0.07, 0.04], [1.45, 0, -0.09, 0.09, 0.05], [1.62, 0, -0.1, 0.105, 0.05], [1.74, 0, -0.07, 0.1, 0.05]], 8, true), 2, 4, 1);   // long hair
  add(new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.5).scale(0.1, 0.07, 0.11).translate(0, 1.74, 0.0), 2, 5, 3);                  // cap crown
  add(new THREE.BoxGeometry(0.15, 0.012, 0.09).translate(0, 1.72, 0.12), 2, 5, 3);                                                                    // brim
  // ---- arms (left = +x) ----
  for (const sx of [1, -1]) {
    const m = (g) => (sx > 0 ? g : mirrorX(g));
    add(m(loft([[1.13, 0.222, 0, 0.046, 0.046], [1.25, 0.222, 0, 0.054, 0.056], [1.35, 0.218, 0, 0.062, 0.064], [1.42, 0.21, 0, 0.068, 0.068]], 16, true)), 6, 0);
    add(m(ellipsoid(0.07, 0.066, 0.068, 0.206, 1.4, 0, 16, 12)), 6, 0);
    add(m(ellipsoid(0.047, 0.047, 0.047, 0.222, 1.13, 0, 14, 10)), 7, 0);      // elbow
    add(m(loft([[0.9, 0.224, 0.012, 0.03, 0.026], [0.98, 0.223, 0.008, 0.038, 0.034], [1.06, 0.222, 0.004, 0.044, 0.041], [1.13, 0.222, 0, 0.045, 0.044]], 16, true)), 7, 2);
    add(m(ellipsoid(0.03, 0.06, 0.022, 0.224, 0.84, 0.016, 12, 10)), 7, 2);
    add(m(ellipsoid(0.014, 0.03, 0.012, 0.236, 0.865, 0.04, 6, 5)), 7, 2);              // thumb
  }
  // ---- legs ----
  for (const sx of [1, -1]) {
    const m = (g) => (sx > 0 ? g : mirrorX(g));
    add(m(loft([[0.5, 0.097, 0.01, 0.062, 0.064], [0.62, 0.097, 0.01, 0.074, 0.078], [0.76, 0.098, 0.006, 0.088, 0.092], [0.9, 0.099, 0, 0.096, 0.1], [0.97, 0.097, 0, 0.094, 0.098]], 18, true)), 3, 1);
    add(m(loft([[0.1, 0.097, 0, 0.04, 0.043], [0.2, 0.097, -0.004, 0.046, 0.05], [0.32, 0.097, -0.012, 0.058, 0.066], [0.42, 0.097, -0.006, 0.063, 0.07], [0.5, 0.097, 0.01, 0.062, 0.064]], 18, true)), 4, 1);
    add(m(ellipsoid(0.065, 0.068, 0.068, 0.097, 0.5, 0.01, 16, 12)), 4, 1);        // knee
    add(m(ellipsoid(0.042, 0.045, 0.045, 0.097, 0.09, 0, 8, 6)), 5, 1);           // ankle
    // shoe: a loft along z (built on y, laid down)
    const shoe = loft([[-0.07, 0.05, 0, 0.034, 0.045], [0.0, 0.05, 0, 0.042, 0.05], [0.07, 0.042, 0, 0.048, 0.046], [0.15, 0.035, 0, 0.047, 0.036], [0.21, 0.028, 0, 0.034, 0.026]], 10, true);
    // rotate: y axis -> z axis
    const sp = shoe.attributes.position;
    for (let i = 0; i < sp.count; i++) { const x = sp.getX(i), y = sp.getY(i), z = sp.getZ(i); sp.setXYZ(i, x + 0.097, z, y); }
    sp.needsUpdate = true;
    flipIndex(shoe);   // the axis swap is a reflection
    shoe.computeVertexNormals();
    add(m(shoe), 5, 3);
  }
  // ---- optional clothing ----
  add(loft([[0.6, 0, 0, 0.29, 0.235], [0.74, 0, 0, 0.25, 0.2], [0.9, 0, 0, 0.2, 0.15], [1.0, 0, 0, 0.158, 0.114]], 16, false), 0, 5, 2);   // skirt
  add(loft([[0.7, 0, 0, 0.2, 0.15], [0.9, 0, 0, 0.19, 0.14], [1.04, 0, 0, 0.152, 0.108]], 16, false), 0, 5, 4);                              // long coat
  add(new THREE.BoxGeometry(0.27, 0.36, 0.13).translate(0, 1.24, -0.15), 1, 5, 5);                                                         // backpack
  // ---- merge ----
  const P = [], N = [], T = [], C = [], Q = [], I = [];
  let base = 0;
  for (const p of parts) {
    const g = p.g, n = g.attributes.position.count;
    P.push(...g.attributes.position.array);
    N.push(...g.attributes.normal.array);
    for (let i = 0; i < n; i++) { T.push(p.tag); C.push(p.col); Q.push(p.part); }
    if (g.index) for (const i of g.index.array) I.push(base + i); else for (let i = 0; i < n; i++) I.push(base + i);
    base += n;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  geo.setAttribute('aTag', new THREE.Float32BufferAttribute(T, 1));
  geo.setAttribute('aCol', new THREE.Float32BufferAttribute(C, 1));
  geo.setAttribute('aPart', new THREE.Float32BufferAttribute(Q, 1));
  geo.setIndex(I);
  _geo = geo;
  return geo;
}

// ---- GLSL ------------------------------------------------------------------------------------------
// Declarations: attributes aTag aCol aPart (geometry) and per instance aInst (x, z, yaw, phase),
// aLook (shirt hue, trousers, skin), aPose (absolute y or -1e4, mode), aVar (height, variant bits, speed, anim t).
// Modes: 0 walk / stand, 1 driver, 2 passenger, 3 run / dodge, 4 cyclist, 5 stepping out of a car, 6 stepping in,
// 15 reaching forward for a door (aVar.w = how far the arm is out).
export const HUMAN_PARS = /* glsl */ `
attribute vec4 aInst; attribute vec3 aLook; attribute vec2 aPose; attribute vec4 aVar;
attribute float aTag; attribute float aCol; attribute float aPart;
varying vec3 vCol;
float hb(float v, float k) { return mod(floor(v / k), 2.0); }
float gau(float x, float c, float w) { float d = mod(x - c + 3.14159265, 6.2831853) - 3.14159265; return exp(-(d * d) / (w * w)); }
// positive angle = forward swing about the x axis through c (a hanging limb moves towards +z)
void swx(inout vec3 p, inout vec3 n, vec3 c, float a) {
  float s = sin(a), co = cos(a); vec3 d = p - c;
  p = c + vec3(d.x, d.y * co + d.z * s, -d.y * s + d.z * co);
  n = vec3(n.x, n.y * co + n.z * s, -n.y * s + n.z * co);
}
void swy(inout vec3 p, inout vec3 n, vec3 c, float a) {
  float s = sin(a), co = cos(a); vec3 d = p - c;
  p = c + vec3(d.x * co + d.z * s, d.y, -d.x * s + d.z * co);
  n = vec3(n.x * co + n.z * s, n.y, -n.x * s + n.z * co);
}
void swz(inout vec3 p, inout vec3 n, vec3 c, float a) {
  float s = sin(a), co = cos(a); vec3 d = p - c;
  p = c + vec3(d.x * co - d.y * s, d.x * s + d.y * co, d.z);
  n = vec3(n.x * co - n.y * s, n.x * s + n.y * co, n.z);
}
`;

export const HUMAN_VERT = /* glsl */ `
  vec3 lp = position;
  vec3 objectNormal = normal;
  float tag = aTag;
  float md = aPose.y;
  float variant = aVar.y;
  float spd = aVar.z;
  // ---- optional parts ----
  float vis = 1.0;
  if (aPart > 0.5) {
    vis = aPart < 1.5 ? hb(variant, 1.0) : aPart < 2.5 ? hb(variant, 4.0) : aPart < 3.5 ? hb(variant, 32.0) : aPart < 4.5 ? hb(variant, 16.0) : hb(variant, 8.0);
  }
  float child = hb(variant, 64.0);
  float side = lp.x >= 0.0 ? 1.0 : -1.0;
  float skirt = hb(variant, 4.0), shortSleeve = hb(variant, 2.0), shorts = hb(variant, 128.0);   // bits: 256 police uniform, 1 long hair, 2 short sleeve, 4 skirt, 8 pack, 16 coat, 32 cap, 64 child, 128 shorts
  float ph = aInst.w;
  float t = uTime + aInst.x * 0.37 + aInst.y * 0.21;

  // ---- joint angles ----
  float hipL = 0.0, kneeL = 0.0, ankL = 0.0, hipR = 0.0, kneeR = 0.0, ankR = 0.0;
  float shL = 0.0, shR = 0.0, elL = 0.1, elR = 0.1, shAbd = 0.05;
  float lean = 0.03, shYaw = 0.0, pelYaw = 0.0, pelRoll = 0.0, headYaw = 0.0, headPitch = 0.0;
  float bounce = 0.0, sway = 0.0, drop = 0.0, fwd = 0.0, armUp = 0.0;
  float seated = 0.0;
  bool cyc = md > 3.5 && md < 4.5;
  bool seat = md > 0.5 && md < 2.5;
  bool swim = md > 9.5 && md < 10.5;
  float w = smoothstep(0.12, 1.2, spd);              // walking blend (0 = standing)
  float rn = smoothstep(2.2, 4.2, spd);              // running blend
  if (md > 2.5 && md < 3.5) { rn = max(rn, 0.0); w = max(w, 1.0); }
  if (swim) { w = 1.0; rn = 0.0; }
  float stride = 1.40 * pow(max(spd, 0.3) / 1.4, 0.5);
  float amp = asin(clamp(stride / 3.68, 0.05, 0.85));
  if (!seat && !cyc) {
    // standing: breathing, slow weight shift, looking around
    float br = sin(t * 1.6);
    float idleSway = 0.012 * sin(t * 0.45);
    // walking cycle (zero phase = heel strike of the left leg)
    float pL = ph, pR = ph + 3.14159265;
    float aW = amp * (1.0 + 0.35 * rn);
    float h0 = mix(0.15, 0.35, rn);
    hipL = w * (h0 * 0.3 + aW * cos(pL - 0.05)); hipR = w * (h0 * 0.3 + aW * cos(pR - 0.05));
    float kw = 1.0 + 0.62 * rn;
    kneeL = w * kw * (0.05 + 0.2 * gau(pL, 0.9, 0.5) + 0.5 * gau(pL, 3.2, 0.55) + 0.8 * gau(pL, 4.5, 0.55));
    kneeR = w * kw * (0.05 + 0.2 * gau(pR, 0.9, 0.5) + 0.5 * gau(pR, 3.2, 0.55) + 0.8 * gau(pR, 4.5, 0.55));
    kneeL += rn * w * 0.45 * gau(pL, 4.3, 0.9); kneeR += rn * w * 0.45 * gau(pR, 4.3, 0.9);
    ankL = w * (0.03 - 0.17 * gau(pL, 0.9, 0.35) + 0.1 * gau(pL, 2.0, 0.5) - 0.5 * gau(pL, 3.4, 0.4));
    ankR = w * (0.03 - 0.17 * gau(pR, 0.9, 0.35) + 0.1 * gau(pR, 2.0, 0.5) - 0.5 * gau(pR, 3.4, 0.4));
    // arms swing against the legs; elbows bend more when running
    float asw = w * mix(0.32,0.68,rn);
    shL = -asw * cos(pL - 0.1); shR = -asw * cos(pR - 0.1);
    elL = 0.12 + w * (0.25 + 0.2 * (1.0 - cos(pL - 0.1)) * 0.5) + rn * 1.1;
    elR = 0.12 + w * (0.25 + 0.2 * (1.0 - cos(pR - 0.1)) * 0.5) + rn * 1.1;
    elL += 0.06 * br * (1.0 - w); elR += 0.06 * br * (1.0 - w);
    // trunk
    pelYaw = w * 0.075 * (1.0 + rn) * cos(ph - 0.05);
    shYaw = -w * 0.11 * (1.0 + rn) * cos(ph - 0.05);
    pelRoll = w * 0.035 * sin(ph);
    lean = 0.03 + 0.04 * w + 0.16 * rn;
    bounce = -w * 0.07 * cos(ph) * cos(ph) * (1.0 - 0.4 * rn) + w * 0.03 * rn;     // lowest in double support
    sway = w * 0.022 * sin(ph) + (1.0 - w) * idleSway;
    // head stays facing forward and looks about when still
    headYaw = -shYaw - pelYaw * 0.5 + (1.0 - w) * 0.5 * sin(t * 0.33 + aInst.x) * smoothstep(0.0, 1.0, sin(t * 0.11 + aInst.y));
    headPitch = 0.03 * sin(2.0 * ph) * w - 0.02 * rn - lean * 0.3;
    // standing: a slight contrapposto
    hipL += (1.0 - w) * 0.03; hipR -= (1.0 - w) * 0.02;
    kneeL += (1.0 - w) * 0.03;
    // stepping out of / into a car: pose blended between seated and standing (aVar.w = progress 0..1)
    if (md > 6.5) { shL = shR = 2.55; elL = elR = 0.5; shAbd = 0.3; headPitch = 0.1; lean = 0.0; }   // hands up: arrested
    if (md > 7.5 && md < 8.5) {
      // At the shower: arms raised to wash hair and shoulders, with a small
      // alternating scrub motion and a lowered, relaxed head.
      shL = 1.75 + 0.12 * sin(t * 2.4); shR = 1.72 + 0.12 * sin(t * 2.4 + 1.1);
      elL = 1.25 + 0.12 * sin(t * 3.1); elR = 1.2 + 0.12 * sin(t * 3.1 + 1.4);
      shAbd = 0.08; headPitch = 0.16; lean = 0.02; sway = 0.008 * sin(t * 1.1);
    }
    if (md > 10.5 && md < 11.5) {
      // Talking with someone: one hand gestures in turn with the speech, a nod, a shift of weight.
      float sp = 0.5 + 0.5 * sin(t * 2.3 + aInst.x * 1.7);
      float g2 = smoothstep(0.35, 0.8, sin(t * 1.1 + aInst.y * 2.0));
      shR = 0.45 + 0.55 * g2 * sp; elR = 1.0 + 0.4 * g2 * sin(t * 5.0 + aInst.x);
      shL = 0.1 + 0.3 * (1.0 - g2) * sp; elL = 0.5 + 0.3 * g2;
      shAbd = 0.12; headPitch = 0.04 + 0.07 * sin(t * 2.6 + aInst.y); headYaw *= 0.15;
      sway += 0.012 * sin(t * 0.9);
    }
    if (md > 8.5 && md < 9.5) {
      // At the kitchen counter: hands forward, making a small stirring motion.
      shL = 0.82 + 0.08 * sin(t * 2.1); shR = 0.94 + 0.12 * sin(t * 2.1 + 0.7);
      elL = 1.05; elR = 1.18 + 0.12 * sin(t * 2.1);
      shAbd = 0.02; headPitch = 0.12; lean = 0.04;
    }
    if (md > 11.5 && md < 12.5) {
      float beat = t * 6.5 + aInst.x;
      hipL = .21*sin(beat); hipR = -.21*sin(beat);
      kneeL = .21 + .15*sin(beat); kneeR = .21 - .15*sin(beat);
      shL = .78 + .42*sin(beat); shR = .78 - .42*sin(beat);
      elL = .83; elR = .83; shAbd = .32;
      lean = .04; sway = .16*sin(beat*.5); bounce = .09*abs(sin(beat));
      pelYaw = .21*sin(beat*.5); shYaw = -.25*sin(beat*.5);
    }
    if (md > 12.5 && md < 13.5) {
      shL = shR = 1.4; elL = elR = .61; shAbd = .14;
      hipL = .13; hipR = -.09; kneeL = kneeR = .13; lean = .13;
      bounce = .015*sin(ph*3.5); sway = .022*sin(t*1.8);
    }
    if (md > 13.5 && md < 14.5) {
      shL = shR = 1.0; elL = elR = .79; shAbd = .18;
      hipL = hipR = .83; kneeL = kneeR = .94; ankL = ankR = .08;
      lean = .27; drop = -.16;
    }
    if (md > 14.5 && md < 15.5) {
      // One arm goes out to the door handle, the body leaning after it.
      float reach = aVar.w;
      shL = 0.05; elL = 0.16;
      shR = mix(0.05, 1.32, reach); elR = mix(0.16, 0.28, reach);
      shAbd = 0.05; lean = 0.03 + 0.1 * reach; headPitch = 0.14 * reach;
    }
    if (swim) {
      float stroke = sin(ph * 1.25 + t * 0.3);
      shL = 0.95 + 0.55 * stroke; shR = 0.95 - 0.55 * stroke;
      elL = 1.0 + 0.25 * sin(ph * 1.25 - 0.8); elR = 1.0 + 0.25 * sin(ph * 1.25 + 0.8);
      hipL = 0.35 * sin(ph * 1.8); hipR = -0.35 * sin(ph * 1.8 + 1.1);
      kneeL = 0.38 + 0.28 * sin(ph * 1.8 + 1.2); kneeR = 0.38 + 0.28 * sin(ph * 1.8 + 2.3);
      lean = 0.78; headPitch = -0.28; shAbd = 0.02; bounce = 0.025 * sin(ph * 0.9);
    }
    if (md > 4.5 && md < 6.5) {
      float u = md > 5.5 ? 1.0 - aVar.w : aVar.w;          // 0 seated .. 1 standing
      float lift = smoothstep(0.25, 0.8, u);
      float legs = 1.0 - smoothstep(0.0, 0.5, u);
      float swing = sin(clamp(u, 0.0, 1.0) * 3.14159265);
      hipL = mix(hipL, 1.5 - 0.5 * swing, legs); hipR = mix(hipR, 1.35, legs);
      kneeL = mix(kneeL, 1.35 - 0.4 * swing, legs); kneeR = mix(kneeR, 1.45, legs);
      ankL = mix(ankL, 0.1, legs); ankR = mix(ankR, 0.1, legs);
      drop = -0.40 * (1.0 - lift);
      lean = mix(lean, 0.55 * swing + 0.03, 1.0);
      shL = mix(shL, 0.5 * (1.0 - u), 1.0 - u); shR = mix(shR, 0.2, 1.0 - u);
      elL = mix(elL, 0.9, 1.0 - u);
      fwd = 0.0; bounce = 0.0;
    }
  } else if (cyc) {
    // pedalling: crank phase from the wheel spin
    float pL = ph, pR = ph + 3.14159265;
    hipL = 0.95 + 0.38 * cos(pL); hipR = 0.95 + 0.38 * cos(pR);
    kneeL = 1.0 + 0.55 * cos(pL + 2.2); kneeR = 1.0 + 0.55 * cos(pR + 2.2);
    ankL = 0.1 * sin(pL); ankR = 0.1 * sin(pR);
    shL = 0.95; shR = 0.95; elL = 0.5; elR = 0.5; lean = 0.55;
    drop = -0.18; sway = 0.01 * sin(ph);
    headPitch = -0.45; pelRoll = 0.03 * sin(ph);
  } else {
    // seated: thighs level, shins down; driver hands on the wheel, passenger resting
    hipL = hipR = 1.5; kneeL = kneeR = 1.5; ankL = ankR = 0.0;
    drop = -0.4;
    bool driver = md < 1.5;
    shL = shR = driver ? 0.75 : 0.2;
    elL = elR = driver ? 0.95 : 0.55;
    lean = driver ? 0.12 : -0.05;
    headYaw = 0.35 * sin(t * 0.2 + aInst.x) * smoothstep(0.2, 1.0, sin(t * 0.07 + aInst.y));
    // the driver glances at the road and turns the head a little with the wheel
    shAbd = 0.12;
    if(driver){
      float impact=clamp(aVar.w,0.0,1.0);
      lean+=impact*.19;
      headPitch+=impact*.38;
      shL=mix(shL,.28,impact);
      shR=mix(shR,.42,impact);
      elL=mix(elL,.31,impact);
      elR=mix(elR,.22,impact);
    }
    seated = 1.0;
  }
  if(md>15.5 && md<17.5){
    bool upset=md<16.5;
    shL=upset?.7:1.30;
    shR=upset?1.08+.35*sin(t*7.0+aInst.x):1.48+.25*sin(t*5.0);
    elL=.75;elR=upset?.54:1.05;
    shAbd=upset?.47:.22;headYaw=.11*sin(t*3.0);
    headPitch=upset?.16:-.12;lean=upset?.09:.02;
  }
  if(skirt>0.5){
    hipL=mix(hipL,clamp(hipL,-.32,.32),1.0-seated);
    hipR=mix(hipR,clamp(hipR,-.32,.32),1.0-seated);
    if(aPart>1.5 && aPart<2.5){
      lp.z*=1.0+w*.28;
      swx(lp,objectNormal,vec3(0.0,.94,0.0),seated*.88);
    }
  }

  // ---- pose the skeleton: leg chain, arm chain, spine, head ----
  vec3 p = lp, n = objectNormal;
  float sd = side;
  bool leftLeg = sd > 0.0;
  if (tag > 4.5 && tag < 5.5) swx(p, n, vec3(sd * 0.097, 0.09, 0.0), leftLeg ? ankL : ankR);
  if (tag > 3.5 && tag < 5.5) swx(p, n, vec3(sd * 0.097, 0.5, 0.01), -(leftLeg ? kneeL : kneeR));
  if (tag > 2.5 && tag < 5.5) swx(p, n, vec3(sd * 0.097, 0.93, 0.0), leftLeg ? hipL : hipR);
  if (tag > 6.5) swx(p, n, vec3(sd * 0.216, 1.13, 0.0), leftLeg ? elL : elR);
  if (tag > 5.5) {
    swx(p, n, vec3(sd * 0.2, 1.4, 0.0), leftLeg ? shL : shR);
    swz(p, n, vec3(sd * 0.2, 1.4, 0.0), -sd * shAbd);
  }
  // spine: twist and lean about the waist, everything above it
  if (tag > 0.5 && tag < 2.5 || tag > 5.5) {
    swy(p, n, vec3(0.0, 1.03, 0.0), shYaw - pelYaw);
    swx(p, n, vec3(0.0, 1.03, 0.0), -lean);
  }
  if (tag > 1.5 && tag < 2.5) {
    swy(p, n, vec3(0.0, 1.55, 0.0), headYaw);
    swx(p, n, vec3(0.0, 1.55, 0.0), -headPitch);
    if (child > 0.5) p = vec3(0.0, 1.55, 0.0) + (p - vec3(0.0, 1.55, 0.0)) * 1.3;     // children: bigger head
  }
  // whole body: pelvis rotation, sway, bounce
  swy(p, n, vec3(0.0, 0.95, 0.0), pelYaw);
  swz(p, n, vec3(0.0, 0.95, 0.0), pelRoll);
  p.x += sway;
  p.y += bounce + drop;
  // body proportions per instance
  float hgt = aVar.x;
  float wid = mix(0.94, 1.1, fract(aLook.y * 7.1)) * (child > 0.5 ? 0.9 : 1.0);
  p = vec3(p.x * wid, p.y, p.z * mix(0.95, 1.08, fract(aLook.z * 5.3))) * hgt;
  p = mix(vec3(0.0, p.y, 0.0), p, vis);      // an absent part collapses to the body axis
  lp = p;
  objectNormal = n;
  // colours
  float legSkin = skirt > 0.5 || shorts > 0.5 ? 1.0 : 0.0;
  float col = aCol;
  if (tag > 6.5 && tag < 7.5 && col > 1.5 && col < 2.5 && shortSleeve < 0.5 && position.y > 0.905) col = 0.0;   // long sleeves: forearm, not hand
  if (tag > 3.5 && tag < 4.5 && shorts > 0.5) col = 2.0;
  if (tag > 2.5 && tag < 3.5 && skirt > 0.5) col = 2.0;
  if (tag > 3.5 && tag < 4.5 && skirt > 0.5) col = 2.0;
  vec3 shirt = 0.5 + 0.4 * cos(6.2831 * (aLook.x + vec3(0.0, 0.33, 0.67)));
  vec3 trous = mix(vec3(0.08, 0.1, 0.16), vec3(0.32, 0.28, 0.22), aLook.y);
  float uni = hb(variant, 256.0);          // uniform: police navy
  if (uni > 0.5) { shirt = vec3(0.16, 0.22, 0.42) / 0.7; trous = vec3(0.07, 0.09, 0.17); }
  float firefighter = hb(variant, 512.0), medical = hb(variant, 1024.0);
  if (firefighter > 0.5) { shirt = vec3(0.78, 0.51, 0.19); trous = vec3(0.13, 0.17, 0.21); }
  if (medical > 0.5) { shirt = vec3(0.27, 0.72, 0.66); trous = vec3(0.12, 0.35, 0.32); }
  vec3 skin = mix(vec3(0.95, 0.78, 0.65), vec3(0.38, 0.25, 0.17), aLook.z);
  vec3 hair = mix(vec3(0.05, 0.04, 0.035), vec3(0.62, 0.45, 0.24), fract(aLook.x * 3.7 + aLook.y * 2.1));
  vec3 accent = 0.5 + 0.4 * cos(6.2831 * (aLook.y * 1.7 + 0.2 + vec3(0.0, 0.33, 0.67)));
  if (uni > 0.5) accent = vec3(0.11, 0.16, 0.32) / 0.7;
  if (firefighter > 0.5) accent = vec3(0.94, 0.77, 0.24);
  vCol = col < 0.5 ? shirt * 0.7 : col < 1.5 ? trous : col < 2.5 ? skin : col < 3.5 ? vec3(0.04) : col < 4.5 ? hair : col < 5.5 ? accent * 0.7 : col < 6.5 ? skin*vec3(.61,.42,.42) : vec3(.71,.68,.61);
  float c = cos(aInst.z), s = sin(aInst.z);
  lp.xz = mat2(c, -s, s, c) * lp.xz;
  objectNormal.xz = mat2(c, -s, s, c) * objectNormal.xz;
`;
