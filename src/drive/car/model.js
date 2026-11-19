// Procedural car model: a lofted body built from a side profile, plan view and
// cross-section, with real wheel-arch cut-outs, a glasshouse classified per
// triangle, light clusters, French registration plates, detailed wheels
// (tyre, 5-spoke alloy, ventilated disc, caliper) and an interior for the
// cockpit camera.  Body frame: +x LEFT, +y up, +z forward, origin at CG (left-hand drive: driver at +x).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildVehicle } from '../render/transit.js';
import { ALL_CARS } from '../physics/cars_extra.js';
import { carProfiles } from './profiles.js';
import { powertrainLayout } from './crush.js';
import { add206Exterior, add206Cockpit, dashboard206, fit206Nose, fit206Rear, rear206Depth, glassMarkings206, lens206GLSL, rimSpoke206, tyreSidewall206 } from './peugeot206.js';

const profileBySpec = new Map(Object.entries(carProfiles).map(([key, profile]) => [ALL_CARS[key], profile]));

function smooth(t) { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); }
// monotone cubic (Fritsch-Carlson) through the profile table: smooth, no
// overshoot, no plateaus at the control points
const _slopes = new WeakMap();
function lerpTable(tab, z) {
  const n = tab.length;
  if (z <= tab[0][0]) return tab[0][1];
  if (z >= tab[n - 1][0]) return tab[n - 1][1];
  let m = _slopes.get(tab);
  if (!m) {
    const d = [];
    for (let i = 0; i < n - 1; i++) d.push((tab[i + 1][1] - tab[i][1]) / (tab[i + 1][0] - tab[i][0]));
    m = [d[0]];
    for (let i = 1; i < n - 1; i++) m.push(d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2);
    m.push(d[n - 2]);
    for (let i = 0; i < n - 1; i++) {
      if (d[i] === 0) { m[i] = m[i + 1] = 0; continue; }
      const a = m[i] / d[i], b = m[i + 1] / d[i], h = a * a + b * b;
      if (h > 9) { const t = 3 / Math.sqrt(h); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
    }
    _slopes.set(tab, m);
  }
  let i = 1;
  while (tab[i][0] < z) i++;
  const [x0, y0] = tab[i - 1], [x1, y1] = tab[i];
  const h = x1 - x0, t = (z - x0) / h, t2 = t * t, t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * y0 + (t3 - 2 * t2 + t) * h * m[i - 1] + (-2 * t3 + 3 * t2) * y1 + (t3 - t2) * h * m[i];
}

function plateTexture(text, rear) {
  const c = document.createElement('canvas');
  c.width = 520; c.height = 110;
  const g = c.getContext('2d');
  g.fillStyle = '#f4f4f0'; g.fillRect(0, 0, 520, 110);
  g.fillStyle = '#1b3f9c'; g.fillRect(0, 0, 44, 110); g.fillRect(476, 0, 44, 110);
  g.fillStyle = '#ffd400';
  for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; g.beginPath(); g.arc(22 + Math.cos(a) * 12, 34 + Math.sin(a) * 12, 2, 0, 7); g.fill(); }
  g.fillStyle = '#fff'; g.font = 'bold 30px sans-serif'; g.textAlign = 'center'; g.fillText('F', 22, 92);
  g.font = 'bold 34px sans-serif'; g.fillText('70', 498, 92);
  g.fillStyle = '#ffd400'; g.fillRect(482, 12, 32, 34);
  g.fillStyle = '#111'; g.font = 'bold 76px "DejaVu Sans Mono", monospace'; g.fillText(text, 260, 84);
  g.strokeStyle = '#111'; g.lineWidth = 4; g.strokeRect(2, 2, 516, 106);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// ---------- body ------------------------------------------------------------
function bodyShape(spec) {
  const d = spec.dims, L = spec.wheelbase;
  const a = L * (1 - spec.frontWeight), b = L * spec.frontWeight;
  const zf = a + d.overF, zr = -b - d.overR;
  const H = d.hgt, W = d.wid;
  const coupe = spec.drive === 'rwd' && d.hgt < 1.35;
  const roofF = coupe ? a - 1.2 : a - 1.08;      // front edge of the roof (top of windscreen)
  const wsBase = coupe ? a - 0.3 : a - 0.36;     // base of the windscreen
  const roofR = coupe ? -b + 0.05 : -b + 0.2;    // rear edge of the roof
  const top = coupe ? [
    [zr, 0.66], [zr + 0.18, 0.9], [zr + 0.55, 0.99], [roofR - 0.3, 1.04], [roofR + 0.55, H - 0.03], [roofF, H],
    [wsBase, 0.9], [a + 0.15, 0.8], [zf - 0.3, 0.7], [zf, 0.58],
  ] : [
    [zr, 0.62], [zr + 0.1, 0.98], [zr + 0.22, 1.1], [roofR - 0.05, H - 0.08], [roofR + 0.3, H - 0.01], [roofF, H],
    [wsBase, 0.99], [a + 0.15, 0.9], [zf - 0.35, 0.83], [zf, 0.64],
  ];
  const belt = coupe ? [[zr, 0.9], [roofR, 0.93], [wsBase, 0.9], [zf, 0.6]] : [[zr, 0.98], [roofR, 1.0], [wsBase, 0.97], [zf, 0.64]];
  const bottom = [[zr, 0.34], [zr + 0.3, 0.22], [-b + 0.5, 0.16], [a - 0.5, 0.15], [zf - 0.35, 0.2], [zf, 0.3]];
  const halfW = [[zr, W / 2 - 0.08], [zr + 0.3, W / 2 - 0.02], [-b + 0.3, W / 2], [a + 0.1, W / 2], [zf - 0.35, W / 2 - 0.04], [zf, W / 2 - 0.14]];
  const roofW = coupe ? 0.56 : 0.66;
  return { a, b, zf, zr, top, belt, bottom, halfW, roofW, roofF, roofR, wsBase, coupe, H, W };
}

function loftShape(spec) {
  const S=bodyShape(spec), {H,W,a,b,zr}=S;
  const rally206 = spec === ALL_CARS.hatch;
  const zf = S.zf - (rally206 ? .04 : 0);
  const kind=H>1.9?'van':H>1.63?'utility':H<1.38?'sport':zf-zr>4.37?'saloon':'hatch';
  const profiles={
    van:{roof:[.23,.88],nose:.51,deck:.64,belt:.62,taper:.88},
    utility:{roof:[.45,1.03],nose:.55,deck:.64,belt:.67,taper:.80},
    hatch:{roof:[.43,1.04],nose:.53,deck:.66,belt:.66,taper:.70},
    saloon:{roof:[.91,1.06],nose:.55,deck:.65,belt:.65,taper:.68},
    sport:{roof:[.88,1.10],nose:.59,deck:.66,belt:.73,taper:.61},
  };
  const measured = profileBySpec.get(spec);
  if (measured) {
    const station = fraction => zr + (zf - zr) * fraction;
    const [rearGlass, rearRoof, frontRoof, frontGlass, roofW] = measured.cabin;
    const rearBase = station(rearGlass / 20);
    const roofR = station(rearRoof / 20);
    const roofF = station(frontRoof / 20);
    const wsBase = station(frontGlass / 20);
    const top = measured.height.map((height, i) => [station(i / 20), height]);
    const halfW = measured.halfWidth.map((width, i) => [station(i / 10), width]);
    const frontBelt = measured.shoulder?.[1] ?? measured.height[frontGlass] - .045;
    const rearBelt = measured.shoulder?.[0] ?? Math.min(measured.height[rearGlass] - .04, frontBelt + .11);
    const belt = [[zr, measured.height[0] - .05], [rearBase, rearBelt], [roofR, rearBelt],
      [wsBase, frontBelt], [zf, measured.height.at(-1) - .04]];
    const [roofTaper, sill, noseWidth, tailWidth] = measured.shellFit || [roofW,.16,.76,.76];
    const f40 = spec === ALL_CARS.f40;
    const bottom = rally206 ? [[zr,.29],[zr+.24,.22],[-b+.40,.19],[a-.37,.19],[zf-.26,.22],[zf,.23]] : S.bottom.map(([z,y],i)=>[z,i===2||i===3?sill:f40&&i>=4?.125:y]);
    return { ...S, zf, kind, top, belt, bottom, halfW, roofR, roofF, roofW: roofTaper, wsBase, rearBase,
      noseWidth, tailWidth: rally206 ? .68 : tailWidth, headlamp: measured.headlamp, tailLamp: measured.tailLamp,
      fasciaStyle: spec === ALL_CARS.mustang ? 'mustang' : f40 ? 'f40' : spec === ALL_CARS.p930 ? 'classicTurbo' : '',
      rally206, coupe: rally206 || kind === 'sport' || ['mustang','delorean','vantage77','vantage98','solstice','x90'].some(key => ALL_CARS[key] === spec),
      noseRound: rally206 ? .27 : .19, tailRound: rally206 ? .20 : .14, fascia: measured.fascia, wing: measured.wing };
  }
  const p=profiles[kind], tailSill=H*p.deck, noseSill=H*p.nose;
  const rearRoof=Math.min(-b+Math.max(.2,p.roof[0]-.4),a-p.roof[1]-.65);
  const frontRoof=a-p.roof[1], glassBase=a-(kind==='van'?.31:kind==='sport'?.24:.39);
  const rearBase=kind==='saloon'||kind==='sport'?zr+.55:zr+.13;
  const top=[
    [zr,tailSill*.78],[rearBase,tailSill], [rearRoof,H*.985], [frontRoof,H],
    [glassBase,H*(p.belt+.035)], [zf-.34,noseSill*1.07], [zf,noseSill*.73],
  ];
  const belt=[[zr,tailSill*.92],[rearRoof,H*p.belt],[glassBase,H*p.belt],[zf,noseSill*.75]];
  const shoulder=kind==='sport'?.026:kind==='hatch'?.018:0;
  const halfW=[[zr,W*.455],[zr+.35,W*.489],[-b,W*.5],[0,W*(.49-shoulder)],
    [a,W*.497],[zf-.37,W*.484],[zf,W*.432]];
  return {...S,kind,top,belt,halfW,roofR:rearRoof,roofF:frontRoof,wsBase:glassBase,
    rearBase,roofW:p.taper,coupe:kind==='sport',noseRound:kind==='van'?.17:kind==='sport'?.39:.26,
    tailRound:kind==='van'||kind==='hatch'?.15:.23};
}

let skyReflection;
function generatedSkyReflection(){
  if(skyReflection)return skyReflection;
  const width=192,height=96, pixels=new Float32Array(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const elevation=Math.sin((y/(height-1)-.5)*Math.PI), a=x/width*Math.PI*2;
    const haze=Math.exp(-Math.abs(elevation)*6), blue=Math.max(0,elevation);
    const light=Math.pow(Math.max(0,Math.cos(a-2.10)),22)*Math.exp(-((elevation-.43)**2)*29)*2.8;
    const clouds=elevation>0?(.5+.5*Math.cos(a*7+elevation*13))*(.5+.5*Math.sin(a*3-elevation*24))*.15:0;
    const i=(y*width+x)*4;
    pixels.set([.17+.34*haze-.06*blue+light+clouds,.183+.32*haze+.05*blue+light*.91+clouds,
      .166+.28*haze+.25*blue+light*.75+clouds,1],i);
  }
  skyReflection=new THREE.DataTexture(pixels,width,height,THREE.RGBAFormat,THREE.FloatType);
  skyReflection.mapping=THREE.EquirectangularReflectionMapping;
  skyReflection.needsUpdate=true;
  return skyReflection;
}

export function buildBody(spec, sections = 150) {
  const S = loftShape(spec);
  const R = spec.wheel.radius;
  const archR = R + (S.rally206 ? .023 : .055);
  const NZ = sections;
  // vertices per profile segment: fixed, so vertex lines run continuously along the car
  const ALLOC = [7, 3, 3, 5, 5, 4, 2, 8, 3, 4, 8];
  const NU = ALLOC.reduce((a, b) => a + b, 0);
  const roundF=S.noseRound, roundR=S.tailRound;
  const cabin0 = S.rearBase - .05, cabin1 = S.wsBase + .02;
  const section = (z) => {
    let yt = lerpTable(S.top, z), yb = lerpTable(S.bottom, z);
    let belt = Math.min(lerpTable(S.belt, z), yt - 0.005);
    let hw = lerpTable(S.halfW, z);
    // rounded nose and tail: shrink the section towards its centre
    const tf = Math.max(0, (z - (S.zf - roundF)) / roundF), tr = Math.max(0, ((S.zr + roundR) - z) / roundR);
    const t = Math.min(1, Math.max(tf, tr));
    if (t > 0) {
      const sf = Math.sqrt(Math.max(0, 1 - t * t));
      const endHeight = S.rally206 ? .82 : S.noseWidth ? .56 : .22;
      const k = endHeight + (1 - endHeight) * sf;
      const yc = (yt + yb) / 2;
      yt = yc + (yt - yc) * k; yb = yc + (yb - yc) * k; belt = Math.min(belt, yt - 0.005);
      const endWidth = (tf > tr ? S.noseWidth : S.tailWidth) ?? .30;
      hw *= endWidth + (1 - endWidth) * sf;
    }
    // wheel arches: the lower edge follows the arch near each axle
    const floorY = yb;
    let flare = 0;
    let archLip = 0;
    for (const az of [S.a, -S.b]) {
      const dz = z - az;
      if (S.rally206) {
        flare += (az < 0 ? .023 : .018) * Math.exp(-((dz / .49) ** 4));
        archLip = Math.max(archLip, smooth((archR + .045 - Math.abs(dz)) / .15));
      }
      if (Math.abs(dz) < archR) yb = Math.max(yb, R + Math.sqrt(archR * archR - dz * dz) - 0.03);
    }
    const fittedSection = Boolean(S.noseWidth) && !S.rally206;
    const lowFender = fittedSection ? Math.max(0, yb + .108 - belt) : 0;
    belt += lowFender;
    const inCabin = z > cabin0 && z < cabin1 && yt > belt + 0.04;
    const P = [], mark = {};
    const sideHeight = belt - yb;
    P.push([0, fittedSection ? floorY : yb]);
    P.push([hw * 0.82, yb]);
    P.push([hw - 0.035, yb + (fittedSection ? Math.min(.05, sideHeight*.20) : .05)]);
    P.push([hw - 0.005, yb + (fittedSection ? Math.min(.16, sideHeight*.40) : .16)]);
    P.push([hw, fittedSection ? yb + Math.min(.35, sideHeight*.62) : Math.min(belt - .1, yb + .35)]);
    P.push([hw - 0.004, belt - (fittedSection ? Math.min(.071, sideHeight*.20) : .12)]);          // shoulder line
    P.push([hw - 0.03, belt - 0.015]);
    if (S.rally206) {
      // A raised arch lip and a fuller shoulder over each rally wheel.
      const bumper = Math.max(smooth((z - S.zf + .47) / .30), smooth((S.zr + .36 - z) / .27));
      P[1][0] += .020 * bumper + .018 * archLip;
      P[2][0] += flare + .021 * archLip + .034 * bumper;
      P[3][0] += flare + .026 * bumper;
      P[4][0] += flare * .65 + .015 * bumper;
      P[5][0] += flare * .26;
      // Keep the points ordered above tight arch cutouts.
      for (let i = 2; i < P.length; i++) {
        const limit = belt - (P.length - i) * .004;
        P[i][1] = Math.min(limit, Math.max(P[i - 1][1] + .004, P[i][1]));
      }
    }
    mark.belt = P.length;
    P.push([hw - 0.06 + flare * .16, belt + 0.005]);
    if (inCabin) {
      const rw = Math.min(hw - 0.12, hw * S.roofW * (S.rally206 ? 1.02 : 1.12));
      P.push([rw + 0.07, yt - 0.07]);
      mark.roof = P.length;
      P.push([rw - 0.02, yt - (S.rally206 ? .038 : .008)]);
      P.push([rw * 0.5, yt]);
      P.push([0, yt + 0.005]);
    } else {
      mark.roof = 1e9;
      P.push([hw - 0.16, Math.max(belt + 0.01, yt - 0.04)]);
      P.push([hw * 0.75, yt - 0.014 + lowFender * .73]);
      P.push([hw * 0.5, yt - 0.006 + lowFender * .24]);
      P.push([0, yt]);
    }
    return { P, mark };
  };
  const resample = (sec) => {
    const P = sec.P;
    const out = [];
    for (let i = 0; i < ALLOC.length; i++) {
      const a = P[i], b = P[i + 1], n = ALLOC[i];
      for (let k = 0; k < n; k++) { const t = k / n; out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
    }
    out.push(P[P.length - 1]);
    const at = (idx) => ALLOC.slice(0, idx).reduce((x, y) => x + y, 0) / NU;
    return { pts: out, uBelt: at(sec.mark.belt - 1), uRoof: sec.mark.roof < P.length ? at(sec.mark.roof) : 1.5 };
  };
  const rings = [];
  for (let i = 0; i <= NZ; i++) {
    // rings bunch up towards the ends, where the rounding is
    const t0 = i / NZ;
    const t = t0 - 0.06 * Math.sin(2 * Math.PI * t0);
    const z = S.zr + (S.zf - S.zr) * Math.min(1, Math.max(0, t));
    rings.push({ z, ...resample(section(z)) });
  }
  const pos = [], mat = [];
  const vert = (r, k, side) => { pos.push(r.pts[k][0] * side, r.pts[k][1], r.z); mat.push(k / NU, r.uBelt, r.uRoof); };
  for (let i = 0; i < NZ; i++) {
    const r0 = rings[i], r1 = rings[i + 1];
    for (let k = 0; k < NU; k++) {
      for (const side of [1, -1]) {
        const triangles = [
          [[r0,k],[r1,k+1],[r1,k]],
          [[r0,k],[r0,k+1],[r1,k+1]],
        ];
        for (const triangle of triangles) {
          const [a,b,c] = triangle;
          for (const [r,kk] of side > 0 ? [a,b,c] : [a,c,b]) vert(r,kk,side);
        }
      }
    }
  }
  // The section runs from the floor outwards and back to the roof center.
  // Reverse winding on the mirrored side and on the rear cap.
  for (const [r, front] of [[rings[0], false], [rings[NZ], true]]) {
    const cy = (r.pts[0][1] + r.pts[NU][1]) / 2;
    for (let k = 0; k < NU; k++) {
      for (const side of [1, -1]) {
        const a = [r.pts[k][0] * side, r.pts[k][1], r.z];
        const b = [r.pts[k + 1][0] * side, r.pts[k + 1][1], r.z];
        const edge = front === (side > 0) ? [a,b] : [b,a];
        const center = [0, cy, r.z];
        const emit = (...vertices) => {
          for (const vertex of vertices) {
            pos.push(...vertex);
            mat.push(.3, r.uBelt, r.uRoof);
          }
        };
        if (S.rally206 && !front) {
          // The depth profile bends the hatch above the bumper, so give the cap
          // enough vertices to follow the curve through its center.
          const divisions = 10;
          const point = (end, i) => [
            end[0] * i / divisions,
            cy + (end[1] - cy) * i / divisions,
            r.z,
          ];
          emit(center, point(edge[0], 1), point(edge[1], 1));
          for (let i = 1; i < divisions; i++) {
            const left = point(edge[0], i), right = point(edge[1], i);
            const nextLeft = point(edge[0], i + 1), nextRight = point(edge[1], i + 1);
            emit(left, nextLeft, nextRight);
            emit(left, nextRight, right);
          }
        } else {
          emit(center, ...edge);
        }
      }
    }
  }
  if (S.rally206) {
    fit206Nose(pos, S.zf);
    fit206Rear(pos, S.zr);
  }
  if(S.fasciaStyle==='classicTurbo')for(let i=0;i<pos.length;i+=3){
    const x=Math.abs(pos[i]), y=pos[i+1], z=pos[i+2];
    const ridge=Math.exp(-(((x-S.W*.371)/.135)**2+((z-S.zf+.54)/.47)**2));
    pos[i+1]+=ridge*.078*THREE.MathUtils.smoothstep(y,.41,.60);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aMat', new THREE.Float32BufferAttribute(mat, 3));
  // accumulated crash damage per vertex (0 clean .. 1 destroyed), written by damage.js
  geo.setAttribute('aDmg', new THREE.Float32BufferAttribute(new Float32Array(pos.length / 3), 1));
  return { geo, S };
}

// per-fragment body materials: paint, glass, pillars, trim, lamps, grille, shut lines
function bodyMaterial(color, S, generated, pass = "solid") {
  const m = new THREE.MeshPhysicalMaterial({ color, metalness: 0.08, roughness: 0.42, clearcoat: 0.78, clearcoatRoughness: 0.11, envMapIntensity: 0.42 });
  if(generated){m.envMap=generatedSkyReflection();m.envMapIntensity=.59;}
  if (pass === 'glazing') {
    m.transparent = true;
    m.depthWrite = false;
  }
  const yHL = lerpTable(S.top, S.zf - 0.2) - 0.13;
  const yTL = lerpTable(S.top, S.zr + 0.15) - 0.13;
  const [lampHeight, lampRise, lampCount, grilleWidth] = S.fascia || [.05, 0, 1, .42 / S.W];
  const u = {
    uFascia: { value: new THREE.Vector4(lampHeight, lampRise, lampCount, grilleWidth * S.W) },
    uRearGlass: { value: S.rearBase },
    uBPost: { value: S.roofF - 1.06 },
    uAxles: { value: new THREE.Vector2(S.a, -S.b) },
    uHeadBounds: { value: new THREE.Vector4(...(S.headlamp || [0,0,0,0])) },
    uTailBounds: { value: new THREE.Vector4(...(S.tailLamp || [0,0,0,0])) },
    uLamps: { value: 0 }, uBrake: { value: 0 }, uRev: { value: 0 },
    uZ: { value: new THREE.Vector4(S.roofF, S.roofR, S.wsBase, S.coupe ? -99 : S.roofF - 1.02) },
    uZ2: { value: new THREE.Vector4(S.zf, S.zr, yHL, yTL) },
    uW: { value: new THREE.Vector3(lerpTable(S.halfW, S.zf - 0.15), lerpTable(S.halfW, S.zr + 0.1), S.coupe ? 1 : 0) },
  };
  const detailed206 = S.rally206 && pass !== 'solid';
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    if (pass === 'glazing') Object.assign(sh.uniforms, glassMarkings206());
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec3 aMat; attribute float aDmg; varying vec3 vLoc; varying vec3 vMat; varying float vDmg;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vLoc = position; vMat = aMat; vDmg = aDmg;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uLamps, uBrake, uRev, uRearGlass, uBPost;
        uniform vec4 uFascia, uHeadBounds, uTailBounds;
        uniform vec2 uAxles;
        ${pass === 'glazing' ? `
          uniform sampler2D u206Banner, u206Crew;
          vec4 glassDecal(sampler2D decal, vec2 uv) {
            vec2 bounds = step(vec2(0.), uv)*step(uv, vec2(1.));
            return texture2D(decal,clamp(uv,0.,1.))*bounds.x*bounds.y;
          }
        ` : ''}
        uniform vec4 uZ;   // roofF, roofR, wsBase, bPillar
        uniform vec4 uZ2;  // zf, zr, yHL, yTL
        uniform vec3 uW;   // half width at lamps front/rear, coupe flag
        varying vec3 vLoc; varying vec3 vMat; varying float vDmg;
        float dh(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
        float dn(vec3 x) {
          vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(dh(i), dh(i + vec3(1, 0, 0)), f.x), mix(dh(i + vec3(0, 1, 0)), dh(i + vec3(1, 1, 0)), f.x), f.y),
                     mix(mix(dh(i + vec3(0, 0, 1)), dh(i + vec3(1, 0, 1)), f.x), mix(dh(i + vec3(0, 1, 1)), dh(i + vec3(1, 1, 1)), f.x), f.y), f.z);
        }
        float band(float x, float a, float b, float w) { return smoothstep(a - w, a, x) * (1.0 - smoothstep(b, b + w, x)); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float u = vMat.x, uB = vMat.y, uR = vMat.z;
        float z = vLoc.z, y = vLoc.y, ax = abs(vLoc.x);
        float aw = max(fwidth(u), 1e-4), az = max(fwidth(z), 1e-4), ay = max(fwidth(y), 1e-4), axw = max(fwidth(ax), 1e-4);
        float sideBand = band(u, uB + 0.006, uR - 0.014, aw);
        float topBand = smoothstep(uR + 0.012, uR + 0.012 + aw, u);
        float inWS = band(z, uZ.x + 0.05, uZ.z - 0.03, az);
        float inRoof = band(z, uZ.y, uZ.x, az);
        float inRear = band(z, uRearGlass, uZ.y - 0.035, az);
        float bP = uZ.w > -50.0 ? band(z, uZ.w - 0.045, uZ.w + 0.045, az) : 0.0;
        float cP = uW.z > 0.5 ? 0.0 : 1.0 - smoothstep(uZ.y + 0.25, uZ.y + 0.25 + az, z);
        float glass = clamp(topBand * (inWS + inRear) + sideBand * (inWS + inRoof) * (1.0 - bP) * (1.0 - cP), 0.0, 1.0);
        float aPil = band(u, uR - 0.016, uR + 0.014, aw) * inWS;
        float pillar = clamp(sideBand * bP * inRoof + aPil, 0.0, 1.0);
        float sill = 1.0 - smoothstep(0.035, 0.035 + aw, u);
        float lowF = (1.0 - smoothstep(0.3, 0.3 + ay, y)) * smoothstep(uZ2.x - 0.45, uZ2.x - 0.45 + az, z);
        float lowR = (1.0 - smoothstep(0.29, 0.29 + ay, y)) * (1.0 - smoothstep(uZ2.y + 0.4, uZ2.y + 0.4 + az, z));
        float trim = clamp(max(max(sill, pillar), max(lowF, lowR)), 0.0, 1.0);
        float gr = (1.0 - smoothstep(uFascia.w, uFascia.w + axw, ax)) * smoothstep(uZ2.x - 0.12, uZ2.x - 0.12 + az, z) * band(y, 0.33, uZ2.z - 0.08, ay);
        float lensX=(ax/max(.1,uW.x)-.46)/.49;
        float lensY=y-uZ2.z-uFascia.y*(lensX-.5);
        float lensCenter=fract(lensX*uFascia.z)-.5;
        float lensEdge=sqrt(lensCenter*lensCenter+pow(lensY/max(.03,uFascia.x)*.43,2.));
        float hl = smoothstep(uZ2.x - .49, uZ2.x - .39, z)
          * band(lensX, 0., 1., axw*2.) * (1.-smoothstep(.43,.48,lensEdge));
        float tl = (1.0 - smoothstep(uZ2.y + 0.25, uZ2.y + 0.25 + az, z)) * band(y, uZ2.w - 0.06, uZ2.w + 0.06, ay) * smoothstep(uW.y * 0.42, uW.y * 0.42 + axw, ax);
        ${S.headlamp ? `
          hl = band(ax,uHeadBounds.x,uHeadBounds.y,axw)*band(y,uHeadBounds.z,uHeadBounds.w,ay)
            *smoothstep(uZ2.x-.66,uZ2.x-.53,z);
        ` : ''}
        ${S.tailLamp ? `
          tl = band(ax,uTailBounds.x,uTailBounds.y,axw)*band(y,uTailBounds.z,uTailBounds.w,ay)
            *(1.-smoothstep(uZ2.y+.44,uZ2.y+.57,z));
        ` : ''}
        ${S.fasciaStyle === 'mustang' ? `
          float mustangFront = smoothstep(uZ2.x-.38,uZ2.x-.23,z);
          float mustangLamp = length(vec2((ax-.62)/.081,(y-.61)/.073));
          hl = (1.-smoothstep(.82,1.,mustangLamp))*mustangFront;
          gr = band(y,.43,.67,ay)*(1.-smoothstep(.48,.56,ax))*mustangFront;
          float chromeBumper = band(y,.353+.040*ax,.408+.040*ax,ay)*mustangFront;
        ` : ''}
        ${S.fasciaStyle === 'f40' ? `
          float popUp = band(ax,.48,.75,axw)*band(z,uZ2.x-.86,uZ2.x-.54,az);
          float f40Nose = smoothstep(uZ2.x-.42,uZ2.x-.22,z);
          float lampPocket = band(ax,.60,.87,axw)*band(y,.33,.53,ay)*f40Nose;
          float f40Lamp = length(vec2((ax-.73)/.073,(y-.424)/.049));
          hl = (1.-smoothstep(.8,1.,f40Lamp))*lampPocket*.72;
          gr = band(y,.248,.346,ay)*(1.-smoothstep(.52,.61,ax))*f40Nose;
          trim = max(trim,lampPocket*.86);
          trim = max(trim,(1.-smoothstep(.20,.228,y))*f40Nose);
          float panelEdge = band(ax,.48,.490,axw)+band(ax,.740,.75,axw);
          panelEdge = max(panelEdge*popUp,(band(z,uZ2.x-.86,uZ2.x-.85,az)+band(z,uZ2.x-.55,uZ2.x-.54,az))*popUp);
        ` : ''}
        ${S.fasciaStyle === 'classicTurbo' ? `
          hl = 0.;
          float frontRubber = band(y,.285,.34,ay)*smoothstep(uZ2.x-.30,uZ2.x-.14,z);
          float rearRubber = band(y,.33,.39,ay)*(1.-smoothstep(uZ2.y+.18,uZ2.y+.28,z));
          trim=max(trim,max(frontRubber,rearRubber));
          tl=max(tl,band(y,.50,.555,ay)*(1.-smoothstep(uZ2.y+.10,uZ2.y+.21,z))*.84);
        ` : ''}
        float dl = uZ.z - 0.12, dl2 = uW.z > 0.5 ? uZ.x - 0.9 : uZ.w - 0.03, dl3 = uW.z > 0.5 ? -99.0 : uZ.y + 0.33;
        float shut = max(max(1.0 - smoothstep(0.0025, 0.0025 + az, abs(z - dl)), 1.0 - smoothstep(0.0025, 0.0025 + az, abs(z - dl2))),
                         1.0 - smoothstep(0.0025, 0.0025 + az, abs(z - dl3)));
        shut *= band(u, 0.07, uB - 0.01, aw);
        ${S.rally206 ? `
          float quarter = band(z, uRearGlass+.20 + .17 * (1.-smoothstep(uB+.02,uB+.17,u)), uBPost-.055, az);
          float frontDoor = band(z, uBPost+.055, uZ.z-.03, az);
          float windowInset = band(u,uB+.024,uR-.036,aw);
          float sideGlass = windowInset * max(quarter * smoothstep(uB+.02,uB+.074,u), frontDoor);
          float windowFrame = sideBand * max(quarter,frontDoor);
          float rearGlassWidth = mix(.545,.455,smoothstep(1.09,1.40,y));
          float rearGlass = band(y,1.075+.048*ax,1.407-.094*ax,ay)
            * (1.-smoothstep(rearGlassWidth-.012,rearGlassWidth,ax))
            * (1.-smoothstep(uZ.y-.08,uZ.y+.055,z));
          glass = max(max(topBand * inWS,rearGlass),sideGlass);
          trim = max(max(sill,lowF), max(lowR, windowFrame-sideGlass));
          vec2 lensBounds = ${lens206GLSL};
          float lensWidth = (ax-.362)/.346;
          float lensHeight = (y-lensBounds.x)/max(.012,lensBounds.y-lensBounds.x);
          float headPosition = abs(lensHeight-.5)*2.;
          hl = band(y,lensBounds.x,lensBounds.y,ay)
            * band(ax,.362,.708,axw) * smoothstep(uZ2.x-.69,uZ2.x-.59,z);
          float yTail = .79 + .47 * (z-uZ2.y);
          float tailPosition = length(vec2((z-uZ2.y-.165)/.237,(y-yTail)/.057));
          tl = (1.-smoothstep(.89,1.03,tailPosition)) * smoothstep(.53,.61,ax);
          float brakeCell = (1.-smoothstep(.82,1.02,
            length(vec2((z-uZ2.y-.138)/.118,(y-yTail-.012)/.028))))
            * smoothstep(.59,.65,ax);
          vec2 intakeCoord = vec2(ax/.575,abs(y-(.416+.026*ax))/.119);
          float intakeShape = length(pow(intakeCoord,vec2(1.34)));
          float intakeLip = band(intakeShape,.98,1.052,aw) * smoothstep(uZ2.x-.25,uZ2.x-.15,z);
          gr = smoothstep(uZ2.x-.25,uZ2.x-.15,z) * (1.-smoothstep(.93,1.01,intakeShape));
          float bumperVent = band(ax,.673,.742,axw)*band(y,.31,.55,ay)*smoothstep(uZ2.x-.36,uZ2.x-.29,z);
          float bumperPocket = 1.-smoothstep(.81,1.04,length(vec2((ax-.62)/.14,(y-.397)/.074)));
          bumperPocket *= smoothstep(uZ2.x-.24,uZ2.x-.12,z);
          float rearFace = 1.-smoothstep(uZ2.y+.13,uZ2.y+.24,z);
          float hatchSill = band(y,.597+.025*ax,.601+.025*ax,ay) * rearFace
            * (1.-smoothstep(.607,.638,ax));
          float hatchSide = .632 - .10 * smoothstep(.72,1.14,y);
          float hatchEdge = band(ax,hatchSide-.002,hatchSide+.002,axw)
            * band(y,.606,1.135,ay) * (1.-smoothstep(uZ2.y+.38,uZ2.y+.49,z));
          float plateWell = (1.-smoothstep(.91,1.08,length(pow(abs(vec2(ax/.325,(y-.70)/.069)),vec2(2.2))))) * rearFace;
          float wheelDistance = min(length(vec2(z-uAxles.x,y-.316)),length(vec2(z-uAxles.y,y-.316)));
          float wheelLip = band(wheelDistance,.348,.368,max(az,ay)) * smoothstep(.73,.86,ax);
          trim=max(trim,bumperVent);
          float bumperJoin = .555 + .065 * smoothstep(.25,.82,ax);
          float bumperSeam = band(y,bumperJoin-.003,bumperJoin+.003,ay)
            * smoothstep(uZ2.x-.39,uZ2.x-.23,z);
          float doorRear = uBPost-.13-.16 * (1.-smoothstep(.27,.6,y));
          shut=max(band(z,doorRear-.002,doorRear+.002,az), band(z,uZ.z-.12,uZ.z-.115,az));
          shut*=band(y,.31,1.055,ay)*smoothstep(.56,.66,ax);
          shut=max(shut,max(bumperSeam,.44*max(hatchSill,hatchEdge)));
        ` : ''}
        ${pass === 'panels' ? 'if (glass > .52) discard;' : ''}
        ${pass === 'glazing' ? `
          if (glass <= .52) discard;
          float sunStrip = topBand * band(z,uZ.x+.055,uZ.x+.17,az);
          float edgeReflection = 1.-abs(normalize(vNormal).z);
          diffuseColor.a = mix(.38 + .28 * pow(edgeReflection,3.), .90, sunStrip);
          diffuseColor.a = mix(diffuseColor.a, .92, smoothstep(.10,.70,vDmg));
        ` : ''}
        vec3 col = diffuseColor.rgb;
        float rgh = 0.38, mtl = 0.15, cc = 1.0;
        vec3 emis = vec3(0.0);
        col = mix(col, col * 0.12, shut);
        ${S.rally206 ? `
          col *= 1.-.54*intakeLip-.23*bumperPocket-.30*plateWell-.26*wheelLip;
          float hoodJoin = uZ2.x-.88 - .13*ax;
          float hoodLine = band(z,hoodJoin-.005,hoodJoin+.005,az)*smoothstep(.64,.81,ax);
          col *= 1.-.56*hoodLine;
        ` : ''}
        col = mix(col, vec3(0.012), trim); rgh = mix(rgh, 0.6, trim); mtl = mix(mtl, 0.0, trim); cc = mix(cc, 0.0, trim);
        float hex = step(0.55, fract(vLoc.x * 60.0 + step(0.5, fract(y * 50.0)) * 0.5)) * step(0.4, fract(y * 50.0));
        ${detailed206 ? `
          vec2 grilleCell = vLoc.xy*vec2(83.,115.);
          grilleCell.x += .5*mod(floor(grilleCell.y),2.);
          vec2 grilleEdge = abs(fract(grilleCell)-.5);
          float meshFocus = 1.-smoothstep(.30,.94,length(fwidth(grilleCell)));
          hex = mix(.43, smoothstep(.29,.45,max(grilleEdge.x*.93,grilleEdge.y)),meshFocus);
        ` : ''}
        col = mix(col, vec3(0.004) + 0.012 * hex, gr); rgh = mix(rgh, 0.5, gr); cc = mix(cc, 0.0, gr);
        vec3 glazing = mix(vec3(.010,.015,.020),vec3(.030,.043,.055),smoothstep(.84,1.6,y));
        ${S.rally206 ? `
          float windshieldBand = band(z,uZ.x+.055,uZ.x+.17,az)*topBand;
          glazing = mix(glazing*1.36, vec3(.013,.029,.23), windshieldBand);
        ` : ''}
        ${pass === 'glazing' ? `
          vec2 bannerUV = vec2(.5+vLoc.x/.58, (uZ.x+.17-z)/.115);
          vec4 bannerMark = glassDecal(u206Banner,bannerUV) * sunStrip;
          float crewU = (z-uBPost+.334)/.258;
          if (vLoc.x > 0.) crewU = 1.-crewU;
          vec4 crewMark = glassDecal(u206Crew,vec2(crewU,(y-1.19)/.111)) * quarter * sideGlass;
          float heater = 1.-smoothstep(.052,.125,abs(fract(y*53.)-.5));
          glazing = mix(glazing,vec3(.19,.087,.051),heater * inRear * topBand * .28);
          glazing = mix(glazing,bannerMark.rgb,bannerMark.a);
          glazing = mix(glazing,crewMark.rgb,crewMark.a);
          diffuseColor.a = max(diffuseColor.a, max(bannerMark.a,crewMark.a)*.95);
        ` : ''}
        ${S.fasciaStyle === 'mustang' ? `
          col = mix(col,vec3(.62,.65,.66),chromeBumper);
          rgh = mix(rgh,.24,chromeBumper);
          mtl = mix(mtl,.73,chromeBumper);
        ` : ''}
        ${S.fasciaStyle === 'f40' ? 'col *= 1.-.54*panelEdge*smoothstep(.38,.51,y);' : ''}
        col = mix(col, glazing, glass); rgh = mix(rgh, 0.14, glass); mtl = mix(mtl, 0.0, glass); cc = max(cc, glass);
        float internals=.57+.32*cos(ax*86.+y*23.);
        float projector=1.-smoothstep(.016,.035,abs(y-(uZ2.z+.003))-sin(ax*12.)*.018);
        ${S.rally206 ? `
          vec2 lens = vec2(2.*lensWidth-1.,2.*lensHeight-1.);
          float outerReflector = length((lens - vec2(.21,.035))*vec2(2.1,1.43));
          float innerReflector = length((lens - vec2(-.39,-.08))*vec2(3.25,1.8));
          float bowls = max(1.-smoothstep(.68,.95,outerReflector),1.-smoothstep(.67,1.,innerReflector));
          float rim = max(band(outerReflector,.69,.97,aw),band(innerReflector,.69,.98,aw));
          float lampEdge = band(headPosition,.83,.96,aw);
          vec3 headColor = mix(vec3(.27,.30,.33),vec3(.73,.75,.78),.5+.4*cos(lens.y*7.)*bowls);
          headColor = mix(headColor,vec3(.95),rim*.65);
          col = mix(col,mix(headColor,vec3(.032,.038,.045),lampEdge*.56),hl);
        ` : `
          col = mix(col,mix(vec3(.073,.089,.102),vec3(.66,.70,.76),internals*.57+projector*.35),hl);
        ` }
        rgh = mix(rgh, 0.105, hl); mtl = mix(mtl, 0.63, hl);
        emis += vec3(1.0, 0.95, 0.85) * uLamps * 6.0 * hl;
        float rev = band(ax, uW.y * 0.43, uW.y * 0.5, axw);
        float ribs=.64+.36*sin(y*195.)*sin(ax*122.);
        ${detailed206 ? `
          float lensFade = 1.-smoothstep(.26,1.5,ay*79.+axw*51.);
          vec2 prism = vec2(cos(y*497.),cos(ax*316.));
          ribs = .82+.14*prism.x*prism.y*lensFade+.08*sin(ax*80.+y*69.);
          rev = band(y,yTail-.033,yTail-.020,ay) * band(ax,.64,.71,axw);
        ` : ''}
        col = mix(col, mix(vec3(${S.rally206 ? '0.25,0.009,0.012' : '0.51,0.019,0.017'})*ribs, vec3(.66), rev), tl); rgh = mix(rgh, 0.08, tl); mtl = mix(mtl, 0.2, tl);
        emis += mix(vec3(1.0, 0.02, 0.01) * (0.1 + 0.35 * uLamps + ${S.rally206 ? '1.65 * brakeCell' : '4.0'} * uBrake), vec3(3.0 * uRev), rev) * tl;
        // ---- crash damage: scuffed/stripped paint, scratches, soot, cracked glass and lamps ----
        float dmg = clamp(vDmg, 0.0, 1.0);
        if (dmg > 0.01) {
          float scuffN = dn(vLoc * 22.0) * 0.6 + dn(vLoc * 61.0) * 0.4;
          float scuff = smoothstep(0.62 - dmg * 0.25, 0.8 - dmg * 0.2, scuffN) * smoothstep(0.02, 0.2, dmg) * 0.75;
          // long scratches: stretched noise along the car's length
          float scr = smoothstep(0.78, 0.93, dn(vec3(vLoc.x * 90.0, vLoc.y * 70.0, vLoc.z * 3.0))) * smoothstep(0.0, 0.25, dmg);
          vec3 primer = mix(vec3(0.07, 0.07, 0.075), vec3(0.14, 0.125, 0.11), dn(vLoc * 40.0));
          float rust = smoothstep(0.55, 0.9, dmg) * smoothstep(0.55, 0.85, dn(vLoc * 14.0 + 3.0));
          col = mix(col, primer, scuff * 0.85);
          col = mix(col, vec3(0.45, 0.2, 0.08), rust * 0.6);
          col = mix(col, vec3(0.30, 0.29, 0.28), scr * (1.0 - scuff) * 0.7);   // bare-metal scratches
          col *= 1.0 - 0.35 * dmg * smoothstep(0.3, 0.8, dn(vLoc * 9.0));       // soot, grime in the folds
          rgh = mix(rgh, 0.85, max(scuff, dmg * 0.5)); mtl = mix(mtl, 0.5, scuff);
          cc *= 1.0 - max(scuff, smoothstep(0.1, 0.5, dmg));
          // glass: shatter web (cells of a Voronoi-ish pattern) where hit hard
          float web = 0.0;
          vec3 q = vLoc * 11.0;
          vec3 qi = floor(q), qf = fract(q);
          float d1 = 9.0, d2 = 9.0;
          for (int a = -1; a <= 1; a++) for (int b = -1; b <= 1; b++) for (int c = -1; c <= 1; c++) {
            vec3 g = vec3(float(a), float(b), float(c));
            vec3 o = vec3(dh(qi + g), dh(qi + g + 7.1), dh(qi + g + 3.3));
            float dd = length(g + o - qf);
            if (dd < d1) { d2 = d1; d1 = dd; } else if (dd < d2) d2 = dd;
          }
          web = 1.0 - smoothstep(0.0, 0.09, d2 - d1);
          float gl = glass * smoothstep(0.12, 0.35, dmg);
          col = mix(col, vec3(0.22, 0.24, 0.26), web * gl * 0.7);
          rgh = mix(rgh, 0.35, gl * 0.6);
          col = mix(col, vec3(0.02), gl * smoothstep(0.6, 0.9, dmg) * 0.8);
          // headlamps and tail lamps: smashed, dark, no light
          float lamp = max(hl, tl);
          col = mix(col, vec3(0.05, 0.04, 0.04), lamp * smoothstep(0.2, 0.5, dmg) * 0.9);
          emis *= 1.0 - lamp * smoothstep(0.2, 0.5, dmg);
        }
        ${detailed206 ? `
          float pixelWidth = length(fwidth(vLoc));
          float fine = 1.-smoothstep(.004,.018,pixelWidth);
          float grain = dn(vLoc * 185.);
          float dirt = dn(vLoc * 37.)*.42 + dn(vLoc*12.)*.58;
          float roadFilm = (1.-smoothstep(.31,.73,y))*smoothstep(.35,.77,dirt);
          float paintMask = (1.-glass)*(1.-max(hl,tl))*(1.-gr);
          col *= 1.+(grain-.5)*fine*.093*paintMask;
          col = mix(col,vec3(.094,.063,.046),roadFilm*.115*paintMask);
          rgh = mix(rgh,rgh+.055*(grain-.5)*fine+.12*roadFilm,paintMask);
          float paintRelief = .000065*(grain-.5)*fine*paintMask;
        ` : ''}
        diffuseColor.rgb = col;`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        ${detailed206 ? `
          vec3 tangentX = cross(dFdy(-vViewPosition),normal);
          vec3 tangentY = cross(normal,dFdx(-vViewPosition));
          float normalArea = dot(dFdx(-vViewPosition),tangentX);
          vec3 paintSlope = dFdx(paintRelief)*tangentX + dFdy(paintRelief)*tangentY;
          normal = normalize(max(abs(normalArea),1.e-8)*normal-sign(normalArea)*paintSlope);
        ` : ''}
      `)
      .replace('#include <roughnessmap_fragment>',  '#include <roughnessmap_fragment>\nroughnessFactor = rgh;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mtl;')
      .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\nmaterial.clearcoat *= cc;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += emis;');
  };
  m.customProgramCacheKey = () => S.rally206 ? 'vr-carbody-206-' + pass : `vr-carbody-${S.fasciaStyle || ''}-${Boolean(S.headlamp)}-${Boolean(S.tailLamp)}`;
  m.userData.u = u;
  return m;
}

export function smoothNormals(geo) {
  const p = geo.attributes.position.array;
  const map = new Map();
  const n = new Float32Array(p.length);
  const key = (i) => (Math.round(p[i] * 1000) + 8000) * 256000000 + (Math.round(p[i + 1] * 1000) + 8000) * 16000 + (Math.round(p[i + 2] * 1000) + 8000);
  const tri = new THREE.Triangle(), nv = new THREE.Vector3();
  for (let i = 0; i < p.length; i += 9) {
    tri.set(new THREE.Vector3(p[i], p[i + 1], p[i + 2]), new THREE.Vector3(p[i + 3], p[i + 4], p[i + 5]), new THREE.Vector3(p[i + 6], p[i + 7], p[i + 8]));
    tri.getNormal(nv);
    for (let k = 0; k < 9; k += 3) {
      const kk = key(i + k);
      const acc = map.get(kk) || [0, 0, 0];
      acc[0] += nv.x; acc[1] += nv.y; acc[2] += nv.z;
      map.set(kk, acc);
    }
  }
  for (let i = 0; i < p.length; i += 3) {
    const acc = map.get(key(i));
    const l = Math.hypot(...acc) || 1;
    n[i] = acc[0] / l; n[i + 1] = acc[1] / l; n[i + 2] = acc[2] / l;
  }
  geo.setAttribute('normal', new THREE.BufferAttribute(n, 3));
}

// ---------- wheel -------------------------------------------------------------
function buildWheel(spec,mats,detailed) {
  const R = spec.wheel.radius, Wd = spec.wheel.width;
  const g = new THREE.Group();
  const spin = new THREE.Group();
  spin.userData.replaySpin=true;
  g.add(spin);
  // tyre: lathe of a rounded section around the x axis
  const [spokes, rimRatio] = (detailed && profileBySpec.get(spec)?.wheel) || [5, .68];
  const rimR = R * rimRatio;
  const rally206 = detailed && spec === ALL_CARS.hatch;
  const prof = [];
  const N = 14;
  for (let i = 0; i <= N; i++) {
    const a = -Math.PI / 2 + i / N * Math.PI;
    prof.push(new THREE.Vector2(rimR + (R - rimR) * (0.55 + 0.45 * Math.cos(a)) + 0.0, Wd / 2 * Math.sin(a)));
  }
  if (detailed) {
    prof.unshift(new THREE.Vector2(rimR - .006, -Wd * .41));
    prof.push(new THREE.Vector2(rimR - .006, Wd * .41));
  }
  const tyreGeo = new THREE.LatheGeometry(prof.map((v) => new THREE.Vector2(v.x, v.y)), 40);
  tyreGeo.rotateZ(Math.PI / 2);
  const tyre = new THREE.Mesh(tyreGeo, mats.tyre);
  tyre.castShadow = true;
  spin.add(tyre);
  // rim barrel + face
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(rimR, rimR, Wd * 0.92, 32, 1, true), mats.rimInner);
  barrel.rotation.z = Math.PI / 2;
  spin.add(barrel);
  const face = new THREE.Group();
  const lip = new THREE.Mesh(new THREE.TorusGeometry(rimR - 0.01, 0.012, 6, 40), mats.rim);
  lip.rotation.y = Math.PI / 2;
  face.add(lip);
  const centerMaterial=spec===ALL_CARS.p930?mats.trim:mats.rim;
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.05, 16), centerMaterial);
  hub.rotation.z = Math.PI / 2;
  face.add(hub);

  const spokeGeometry = rally206
    ? rimSpoke206(rimR)
    : new THREE.BoxGeometry(0.035, rimR - 0.07, spokes > 7 ? .029 : .065);
  for (let i = 0; i < spokes; i++) {
    const sp = new THREE.Mesh(spokeGeometry, centerMaterial);
    if (!rally206) sp.position.y = (rimR - 0.07) / 2 + 0.05;
    const holder = new THREE.Group();
    holder.rotation.x = i / spokes * Math.PI * 2;
    holder.add(sp);
    sp.rotation.y = 0.0;
    face.add(holder);

  }
  if(detailed){
    const lugGeo=new THREE.CylinderGeometry(.013,.014,.018,8).rotateZ(Math.PI/2);
    for(let i=0;i<5;i++){
      const a=i*Math.PI*.4, lug=new THREE.Mesh(lugGeo,mats.chrome);
      lug.position.set(.024,.045*Math.cos(a),.045*Math.sin(a));
      face.add(lug);
    }
  }
  face.position.x = Wd * 0.38;
  spin.add(face);
  // brake disc and caliper (do not spin)
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(rimR - 0.04, rimR - 0.04, 0.026, 32), mats.disc);
  disc.rotation.z = Math.PI / 2;
  disc.position.x = Wd * 0.1;
  spin.add(disc);
  const cal = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 0.09), mats.caliper);
  cal.position.set(Wd * 0.16, 0.0, -(rimR - 0.09));
  g.add(cal);
  g.userData.spin = spin;
  g.userData.face = face;
  g.userData.disc = disc;
  return g;
}

// position a pair of head-light beams (left, right) on a car of shape S
function placeBeams(beams, S, spec) {
  const yHL = lerpTable(S.top, S.zf - 0.2) - 0.13 - spec.cg;
  beams.forEach((sl, i) => {
    const side = i === 0 ? -1 : 1;
    sl.position.set(side * 0.55, yHL, S.zf - 0.1);
    sl.target.position.set(side * 0.9, -spec.cg - 0.6, S.zf + 25);
  });
}

// hand the head-light beams of one car model to another (same light count in the scene)
export function moveBeams(from, to, spec) {
  const b = from.userData.beams;
  if (!b || to.userData.beams) return;
  for (const sl of b) { from.remove(sl, sl.target); to.add(sl, sl.target); }
  placeBeams(b, to.userData.shape, spec);
  to.userData.beams = b; from.userData.beams = null;
}

function bodyFittings(shell,shape,mats) {
  const group=new THREE.Group(), ray=new THREE.Raycaster();
  const handle=shape.rally206
    ? new THREE.SphereGeometry(1, 12, 8).scale(.015, .021, .063)
    : new THREE.BoxGeometry(.017,.031,.135);
  const recess=shape.rally206
    ? new THREE.SphereGeometry(1, 12, 8).scale(.009, .026, .080)
    : new THREE.BoxGeometry(.012,.054,.173);
  const direction=new THREE.Vector3();
  const origin=new THREE.Vector3();
  for(const side of [-1,1]){
    const positions=shape.rally206?[shape.roofF-.96]:shape.kind==='sport'?[shape.roofF-.54]:[shape.roofF-.49,shape.roofR-.01];
    for(const z of positions){
      const y=lerpTable(shape.belt,z)-.143;
      ray.set(origin.set(side*(shape.W/2+.33),y,z),direction.set(-side,0,0));
      const point=ray.intersectObject(shell,false)[0]?.point;
      if(!point)continue;
      const inset=new THREE.Mesh(recess,mats.trim), grip=new THREE.Mesh(handle,shape.rally206?mats.trim:mats.paint);
      inset.position.copy(point).x+=side*.004;
      grip.position.copy(point).x+=side*.012;
      group.add(inset,grip);
    }
  }
  if (shape.rally206) {
    add206Exterior(group, shell, shape, mats, z => lerpTable(shape.top, z));
  } else if (shape.wing) {
    const [offset, rise, span, chord] = shape.wing;
    const z = shape.zr + offset;
    const deck = lerpTable(shape.top, z);
    const width = shape.W * span;
    const blade = new THREE.Mesh(new THREE.BoxGeometry(width, .044, chord), mats.trim);
    blade.rotation.x = -.105;
    blade.position.set(0, deck + rise, z);
    blade.castShadow = true;
    group.add(blade);
    for (const side of [-1, 1]) {
      const pedestal = new THREE.Mesh(new THREE.BoxGeometry(.044, rise + .055, chord * .56), mats.paint);
      pedestal.position.set(side * width * .38, deck + rise * .5 - .018, z);
      pedestal.rotation.x = .15;
      group.add(pedestal);
      const endplate = new THREE.Mesh(new THREE.BoxGeometry(.027, .065 + rise * .12, chord * 1.06), mats.trim);
      endplate.position.set(side * width * .49, deck + rise + .011, z);
      group.add(endplate);
    }
  }
  return group;
}

function addPowertrain(body, shape, spec, mats) {
  const layout=powertrainLayout(shape,spec);
  const engine=new THREE.Group();
  engine.name='Engine and gearbox';
  engine.position.set(0,(layout.lower+layout.upper)*.5,layout.z);
  const underbody=new THREE.Group();
  underbody.name='Undercarriage';
  body.add(engine,underbody);
  const cast=new THREE.MeshStandardMaterial({color:0x777c7e,metalness:.64,roughness:.58});
  const box=(group,material,w,h,l,x,y,z)=>{
    const part=new THREE.Mesh(new THREE.BoxGeometry(w,h,l),material);
    part.position.set(x,y,z);group.add(part);
  };
  const pipe=(group,material,radius,from,to)=>{
    const a=new THREE.Vector3(...from),b=new THREE.Vector3(...to),axis=b.clone().sub(a);
    const part=new THREE.Mesh(new THREE.CylinderGeometry(radius,radius,axis.length(),8),material);
    part.position.copy(a).addScaledVector(axis,.5);
    part.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),axis.normalize());
    group.add(part);
  };
  const width=layout.halfWidth*1.38;
  box(engine,cast,width,.21,.41,-.06,-.01,0);
  box(engine,mats.trim,width*.91,.072,.35,-.06,.126,0);
  box(engine,cast,width*.74,.082,.31,-.06,-.151,0);
  box(engine,cast,.22,.19,.28,width*.52,-.035,-.098);
  for(let i=0;i<4;i++){
    const x=-.25+i*.11;
    pipe(engine,cast,.017,[x,.08,-.16],[x,.014,-.27]);
    pipe(engine,mats.trim,.020,[x,.075,.17],[x,.036,.28]);
  }
  if(layout.front){
    const radiatorZ=Math.min(shape.zf-.31,layout.z+.47);
    box(underbody,mats.trim,shape.W*.56,.26,.048,0,.47,radiatorZ);
    for(let i=0;i<7;i++) box(underbody,cast,shape.W*.53,.008,.010,0,.363+i*.031,radiatorZ+.026);
  }
  const rearAxle=-shape.b;
  box(underbody,mats.trim,shape.W*.59,.095,.35,-.10,.253,rearAxle+.41);
  for(const [axle,track] of [[shape.a,spec.trackF],[rearAxle,spec.trackR]]){
    for(const sign of [-1,1])
      pipe(underbody,cast,.025,[sign*.18,.285,axle],[sign*(track*.5-.12),.30,axle]);
  }
  const exhaustEnd=shape.zr+.22, exhaustStart=layout.front?shape.a-.13:layout.z+.15;
  pipe(underbody,cast,.029,[-.16,.208,exhaustStart],[-.16,.208,exhaustEnd+.40]);
  pipe(underbody,cast,.066,[-.16,.216,exhaustEnd+.40],[-.16,.216,exhaustEnd+.12]);
  pipe(underbody,cast,.029,[-.16,.216,exhaustEnd+.12],[-.43,.23,exhaustEnd]);
  for(const assembly of [engine,underbody]){
    const byMaterial=new Map();
    for(const mesh of [...assembly.children]){
      mesh.updateMatrix();
      mesh.geometry.applyMatrix4(mesh.matrix);
      if(!byMaterial.has(mesh.material)) byMaterial.set(mesh.material,[]);
      byMaterial.get(mesh.material).push(mesh.geometry);
      assembly.remove(mesh);
    }
    for(const [material,parts] of byMaterial){
      assembly.add(new THREE.Mesh(mergeGeometries(parts),material));
      for(const geometry of parts) geometry.dispose();
    }
  }
  return engine;
}

export function buildCar(spec, opts = {}) {
  const color = opts.color ?? spec.color;
  const mats = {
    paint: new THREE.MeshPhysicalMaterial({ color, metalness: 0.2, roughness: 0.36, clearcoat: 0.72, clearcoatRoughness: 0.12 }),
    trim: new THREE.MeshStandardMaterial({ color: 0x0c0c0d, roughness: 0.55 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 1, roughness: 0.08 }),
    tyre: new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.92 }),
    rim: new THREE.MeshStandardMaterial({ color: opts.lights && spec === ALL_CARS.hatch ? 0xf4f4eb : 0xb8bcc0, metalness: opts.lights && spec === ALL_CARS.hatch ? .26 : .9, roughness: 0.28 }),
    rimInner: new THREE.MeshStandardMaterial({ color: 0x4a4c50, metalness: 0.7, roughness: 0.5, side: THREE.DoubleSide }),
    disc: new THREE.MeshStandardMaterial({ color: 0x6d6a66, metalness: 0.8, roughness: 0.45, emissive: 0x000000 }),
    caliper: new THREE.MeshStandardMaterial({ color: opts.caliper ?? 0xc0141c, roughness: 0.4 }),
    interior: new THREE.MeshStandardMaterial({ color: 0x35373c, roughness: 0.84, emissive:0x292d36, emissiveIntensity:.24 }),
    seat: new THREE.MeshStandardMaterial({ color: 0x242428, roughness: 0.95 }),
    under: new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.9, side: THREE.DoubleSide }),
  };
  if(opts.lights){
    const rally206Tyres = spec === ALL_CARS.hatch;
    mats.tyre.onBeforeCompile=shader=>{
      shader.uniforms.uTread={value:new THREE.Vector2(spec.wheel.radius,spec.wheel.width)};
      if (rally206Tyres) shader.uniforms.u206Sidewall = { value: tyreSidewall206() };
      shader.vertexShader='varying vec3 treadPoint;\n'+shader.vertexShader.replace('#include <begin_vertex>',
        '#include <begin_vertex>\ntreadPoint = position;');
      const sidewallUniform = rally206Tyres ? 'uniform sampler2D u206Sidewall; varying float treadHandedness;\n' : '';
      if (rally206Tyres) {
        shader.vertexShader = 'varying float treadHandedness;\n' + shader.vertexShader.replace(
          'treadPoint = position;',
          'treadPoint = position; treadHandedness = sign(dot(cross(modelMatrix[0].xyz, modelMatrix[1].xyz), modelMatrix[2].xyz));'
        );
      }
      shader.fragmentShader=sidewallUniform+'uniform vec2 uTread; varying vec3 treadPoint;\n'+shader.fragmentShader
        .replace('#include <color_fragment>', `
          #include <color_fragment>
          vec2 tread=vec2(treadPoint.x/uTread.y,atan(treadPoint.z,treadPoint.y)*10.);
          float fade=1.-smoothstep(.23,.64,length(fwidth(tread)));
          vec2 g=vec2(abs(fract(tread.x*7.+.5)-.5),abs(fract(tread.y+abs(tread.x)*1.5)-.5));
          float grooves=(1.-smoothstep(.055,.11,g.x))*.59+(1.-smoothstep(.062,.16,g.y))*.48;
          float shoulder=smoothstep(.84,.971,length(treadPoint.yz)/uTread.x);
          diffuseColor.rgb *= 1.-grooves*shoulder*fade*.79;
          ${rally206Tyres ? `
            vec2 sidewallUV=.5+vec2(-treadHandedness*treadPoint.z,treadPoint.y)/(2.*uTread.x);
            vec4 stamp=texture2D(u206Sidewall,sidewallUV);
            float sidewall=smoothstep(.31,.425,abs(tread.x))*(1.-smoothstep(.937,.994,length(treadPoint.yz)/uTread.x));
            diffuseColor.rgb=mix(diffuseColor.rgb,stamp.rgb,stamp.a*sidewall);
          ` : ''}
        `);
    };
    mats.tyre.customProgramCacheKey=()=> rally206Tyres ? 'player-206-tyre-tread' : 'player-tyre-tread';
  }
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const { geo, S } = buildBody(spec, opts.bodySections);
  smoothNormals(geo);
  const detailed206 = S.rally206 && opts.lights;
  const bodyMat = bodyMaterial(color, S, Boolean(opts.lights), detailed206 ? 'panels' : 'solid');
  const shell = new THREE.Mesh(geo, bodyMat);
  shell.castShadow = true;
  shell.receiveShadow = true;
  body.add(shell);
  if (detailed206) {
    // Share the shell's vertices so dents and door animation affect the panes.
    const material = bodyMaterial(color, S, true, 'glazing');
    const glazing = new THREE.Mesh(geo, material);
    glazing.receiveShadow = true;
    body.add(glazing);
  }
  const fittings=opts.lights?bodyFittings(shell,S,mats):null;
  if(fittings)body.add(fittings);
  body.position.y = -spec.cg;
  const W = spec.dims.wid;
  // underbody / wheel-well liners so the arches are dark inside
  const under = new THREE.Mesh(new THREE.PlaneGeometry(W - (S.noseWidth ? .47 : .1), S.zf - S.zr - (S.noseWidth ? .64 : .3), opts.lights ? 8 : 1, opts.lights ? 26 : 1), mats.under);
  under.rotation.x = Math.PI / 2;
  under.position.set(0, 0.2, (S.zf + S.zr) / 2);
  body.add(under);
  if (opts.lights && !spec.bus) {
    const rail = new THREE.MeshStandardMaterial({ color: 0x37373a, metalness: .58, roughness: .64 });
    mats.frame = rail;
    for (const side of [-1, 1]) {
      const member = new THREE.Mesh(new THREE.BoxGeometry(.112,.11,S.zf-S.zr-.46,1,1,30),rail);
      member.position.set(side*W*.235,.30,(S.zf+S.zr)*.5);
      body.add(member);
    }
    for (const z of [S.zr+.36,-S.b+.40,S.a-.38,S.zf-.32]) {
      const crossMember = new THREE.Mesh(new THREE.BoxGeometry(W*.52,.14,.084,8,1,1),rail);
      crossMember.position.set(0,.31,z);
      body.add(crossMember);
    }
  }
  const powertrain=opts.lights&&!spec.bus?addPowertrain(body,S,spec,mats):null;
  for (const az of [S.a, -S.b]) for (const side of [-1, 1]) {
    const liner = new THREE.Mesh(new THREE.CylinderGeometry(spec.wheel.radius + 0.06, spec.wheel.radius + 0.06, 0.32, 20, 1, true, 0, Math.PI), mats.under);
    liner.rotation.z = Math.PI / 2;
    liner.rotation.y = 0;
    liner.position.set(side * (W / 2 - 0.2), spec.wheel.radius, az);
    body.add(liner);
  }
  for (const side of [-1, 1]) {
    const zm = S.wsBase - 0.1;
    const mirrorX=lerpTable(S.halfW,zm)+(S.rally206 ? .004 : .02);
    const mirrorY=lerpTable(S.belt,zm)+(S.rally206 ? .046 : .07);
    const mir = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 8), mats.paint);
    mir.scale.set(1.1, 0.75, 0.55);
    mir.position.set(side * mirrorX, mirrorY, zm);
    body.add(mir);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.025, 0.04), mats.trim);
    arm.position.set(side * (lerpTable(S.halfW, zm) - 0.04), lerpTable(S.belt, zm) + 0.04, zm);
    body.add(arm);
    const mg = new THREE.Mesh(new THREE.CircleGeometry(0.06, 16), mats.chrome);
    mg.scale.set(1.1, 0.7, 1);
    mg.position.set(side * mirrorX, mirrorY, zm - 0.043);
    mg.rotation.y = Math.PI;
    body.add(mg);
  }
  if(S.fasciaStyle==='classicTurbo'){
    const lens=new THREE.MeshStandardMaterial({color:0x666b66,metalness:.48,roughness:.26,emissive:0x514c32,emissiveIntensity:.12});
    const z=S.zf-.41, y=lerpTable(S.top,z)-.006;
    for(const side of [-1,1]){
      const trim=new THREE.Mesh(new THREE.TorusGeometry(.108,.012,8,22),mats.trim);
      trim.position.set(side*W*.371,y,z);
      trim.rotation.x=-.69;body.add(trim);
      const light=new THREE.Mesh(new THREE.SphereGeometry(1,18,10),lens);
      light.scale.set(.107,.107,.026);light.rotation.copy(trim.rotation);
      light.position.copy(trim.position);body.add(light);
    }
  }
  const plateTxt = opts.plate || (S.rally206 ? '334 NQZ 75' : 'GZ-070-VR');
  if (!S.rally206 && S.fasciaStyle !== 'f40') {
    const plateF = new THREE.Mesh(new THREE.PlaneGeometry(0.52, 0.11),
      new THREE.MeshStandardMaterial({ map: plateTexture(plateTxt), roughness: 0.4 }));
    plateF.position.set(0, 0.37, S.zf + 0.005);
    body.add(plateF);
  }
  const plateR = new THREE.Mesh(new THREE.PlaneGeometry(0.52, 0.11), new THREE.MeshStandardMaterial({ map: plateTexture(plateTxt), roughness: 0.4 }));
  if (S.rally206) {
    const ray = new THREE.Raycaster();
    const forward = new THREE.Vector3(0, 0, 1);
    let depth = rear206Depth(0, .70, S.zr, S.zr);
    for (const x of [-.26, 0, .26]) for (const y of [.645, .70, .755]) {
      ray.set(new THREE.Vector3(x, y, S.zr - 1), forward);
      const hit = ray.intersectObject(shell, false)[0];
      if (hit) depth = Math.min(depth, hit.point.z);
    }
    plateR.position.set(0, .70, depth - .007);
  } else {
    plateR.position.set(0, lerpTable(S.top, S.zr + 0.15) - .36, S.zr - .005);
  }
  plateR.rotation.y = Math.PI;
  body.add(plateR);
  const ex = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.042, 0.16, 14), mats.chrome);
  ex.rotation.x = Math.PI / 2;
  ex.position.set(-0.45, 0.25, S.zr + 0.06);
  body.add(ex);

  // interior for the cockpit camera
  const dashTop = Math.min(lerpTable(S.belt,S.wsBase)-.07,spec.dims.hgt-.35);
  const dash = detailed206
    ? dashboard206(W, mats.interior)
    : new THREE.Mesh(new THREE.BoxGeometry(W - 0.3, 0.26, 0.42), mats.interior);
  dash.position.set(0, detailed206 ? dashTop - .025 : dashTop - .13, S.wsBase - 0.24);
  dash.userData.proceduralInterior = true;
  body.add(dash);
  const binnacle = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.08, 0.2), mats.interior);
  binnacle.position.set(0.37, dashTop + 0.02, S.wsBase - 0.5);
  binnacle.userData.proceduralInterior = true;
  body.add(binnacle);
  // instrument cluster: a canvas redrawn from the car state (only when visible)
  let gauges = null;
  if (opts.lights) {
    const gc = document.createElement('canvas'); gc.width = 512; gc.height = 200;
    const gt = new THREE.CanvasTexture(gc); gt.colorSpace = THREE.SRGBColorSpace;
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.14), new THREE.MeshBasicMaterial({ map: gt, toneMapped: false }));
    face.position.set(0.37, dashTop + 0.025, S.wsBase - 0.61);
    face.rotation.set(-0.35, Math.PI, 0);
    face.userData.proceduralInterior = true;
    body.add(face);
    gauges = { canvas: gc, tex: gt, face };
  }
  for (const side of [-1, 1]) {
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.5), mats.seat);
    seat.position.set(side * 0.37, 0.42, S.wsBase - 1.3);
    seat.userData.proceduralInterior = true;
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.68, 0.12), mats.seat);
    back.position.set(side * 0.37, 0.76, S.wsBase - 1.6);
    back.rotation.x = -0.2;
    back.userData.proceduralInterior = true;
    body.add(seat, back);
  }
  const wheelGroup = new THREE.Group();
  wheelGroup.add(new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.018, 8, 32), mats.interior));
  for (const a of [0, 2.1, -2.1]) {
    const spk = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.025, 0.02), mats.interior);
    spk.position.set(Math.cos(a + Math.PI / 2) * 0.085, Math.sin(a + Math.PI / 2) * -0.085, 0);
    spk.rotation.z = a + Math.PI / 2;
    wheelGroup.add(spk);
  }
  const steerPivot = new THREE.Group();
  steerPivot.position.set(0.37, dashTop - 0.125, S.wsBase - 0.72);
  steerPivot.rotation.x = -0.35;
  steerPivot.add(wheelGroup);
  steerPivot.userData.proceduralInterior = true;
  body.add(steerPivot);
  const cabinFrame=new THREE.Group();
  cabinFrame.visible=Boolean(detailed206);
  const roofHeight = lerpTable(S.top, S.roofF);
  const eyeY=Math.min(roofHeight-.15,dashTop+.34);
  const roofHalfWidth = lerpTable(S.halfW, S.roofF) * S.roofW;
  const windshieldHalfWidth = lerpTable(S.halfW, S.wsBase) - .08;
  if(opts.lights){
    for(const side of [-1,1]){
      const low=new THREE.Vector3(side*(windshieldHalfWidth-(detailed206 ? .125:0)),dashTop+.045,S.wsBase-.14);
      const high=new THREE.Vector3(side*(roofHalfWidth-(detailed206 ? .055:0)),roofHeight-(detailed206 ? .11:.05),S.roofF - (detailed206 ? .05 : 0));
      const pillar=new THREE.Mesh(new THREE.BoxGeometry(.077,low.distanceTo(high),.080),mats.interior);
      pillar.position.copy(low).lerp(high,.5);
      pillar.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),high.sub(low).normalize());
      cabinFrame.add(pillar);
    }
    const header=new THREE.Mesh(new THREE.BoxGeometry(roofHalfWidth*2,.065,.13),mats.interior);
    header.position.set(0,roofHeight-(detailed206 ? .11:.05),S.roofF - (detailed206 ? .05 : 0));
    cabinFrame.add(header);
    const bulkhead=new THREE.Mesh(new THREE.BoxGeometry(W-.21,dashTop-.26,.28),mats.interior);
    bulkhead.position.set(0,(dashTop+.22)*.5,S.wsBase-.24);
    cabinFrame.add(bulkhead);
    const footwell=new THREE.Mesh(new THREE.BoxGeometry(W-.18,.09,1.74),mats.seat);
    footwell.position.set(0,.24,S.wsBase-.82);
    cabinFrame.add(footwell);
    const column=new THREE.Mesh(new THREE.CylinderGeometry(.049,.062,.27,9),mats.trim);
    column.rotation.x=Math.PI/2;
    column.position.set(.37,dashTop-.13,S.wsBase-.59);
    cabinFrame.add(column);
    for(const side of [-1,1]){
      const doorWidth = detailed206 ? .075 : .19;
      const doorLength = detailed206 ? 1.30 : 1.64;
      const door=new THREE.Mesh(new THREE.BoxGeometry(doorWidth,.61,doorLength),mats.interior);
      door.position.set(side*W*(detailed206 ? .365:.47),dashTop-.23,S.wsBase-.81);
      cabinFrame.add(door);
    }
    for(const x of [-.54,-.11,.12,.56]){
      const vent=new THREE.Mesh(new THREE.BoxGeometry(.145,.035,.029),mats.trim);
      vent.position.set(x,dashTop-.055,S.wsBase-.463);
      cabinFrame.add(vent);
    }
    if(!detailed206&&!spec.bus){
      const consoleWidth=spec.dims.len>4.6?.34:.25;
      const consoleBase=new THREE.Mesh(new THREE.BoxGeometry(consoleWidth,.30,.78),mats.interior);
      consoleBase.position.set(0,.39,S.wsBase-.78);
      cabinFrame.add(consoleBase);
      const lever=new THREE.Mesh(new THREE.CylinderGeometry(.018,.024,.15,10),mats.chrome);
      lever.position.set(0,.61,S.wsBase-.70);lever.rotation.x=-.12;
      const knob=new THREE.Mesh(new THREE.SphereGeometry(.047,10,7),mats.trim);
      knob.position.set(0,.686,S.wsBase-.69);
      cabinFrame.add(lever,knob);
      for(const side of [-1,1]){
        const handle=new THREE.Mesh(new THREE.BoxGeometry(.046,.047,.22),mats.trim);
        handle.position.set(side*W*.39,dashTop-.18,S.wsBase-.71);
        cabinFrame.add(handle);
        const bolster=new THREE.Mesh(new THREE.SphereGeometry(1,10,8),mats.seat);
        bolster.scale.set(.19,.055,.22);bolster.position.set(side*.37,.49,S.wsBase-1.24);
        cabinFrame.add(bolster);
      }
    }
    if (S.rally206) {
      mats.harness = new THREE.MeshStandardMaterial({ color: 0xb81820, roughness: .88 });
      add206Cockpit(cabinFrame, S, mats, dashTop);
    }
    body.add(cabinFrame);
  }

  const wheels = [];
  for (let i = 0; i < 4; i++) {
    const w = buildWheel(spec, mats, Boolean(opts.lights));
    root.add(w); wheels.push(w);
  }
  // two spot lights per scene, not per car: every light changes the shader permutations of the whole
  // town, so cars you take over receive the previous car's beams (moveBeams) instead of making new ones
  let beams = null;
  if (opts.lights && !opts.noBeams) {
    beams = [];
    for (const side of [-1, 1]) {
      const sl = new THREE.SpotLight(0xfff1dc, 0, 90, 0.5, 0.45, 1.6);
      root.add(sl, sl.target);
      beams.push(sl);
    }
    placeBeams(beams, S, spec);
  }
  root.userData = { wheels, mats, steer: wheelGroup, body, beams, shape: S, bodyU: bodyMat.userData.u, gauges, shell, powertrain,
    pristine: geo.attributes.position.array.slice(),
    cockpit: new THREE.Vector3(Math.min(.37,W*.23),eyeY-spec.cg,S.wsBase-1.20),
    cabinFrame,fittings,steerPivot,visibleCabin:Boolean(detailed206),nativeCabin:Boolean(detailed206),cabinParts:body.children.filter(child=>child.userData.proceduralInterior) };
  if(opts.lights){
    const light=new THREE.PointLight(0xe5edff,0,2.6);
    root.userData.cabinLight=light;
    root.add(light);
  }
  // the city bus wears the transit bus body; the lofted shell stays (hidden) for the damage code
  if (spec.bus) {
    body.visible = false;
    root.userData.hideBody = true;
    const bus = buildVehicle('bus', { dimensions:{width:spec.dims.wid,height:spec.dims.hgt,length:spec.dims.len},
      passengers:0, wheels:false, driver:false });
    const a = spec.wheelbase * (1 - spec.frontWeight);                    // CG to the front axle
    bus.position.set(0, -spec.cg, a - (spec.dims.len / 2 - 2.7));
    root.add(bus);
    root.userData.busBody=bus;
    root.userData.nativeCabin=true;
    root.userData.cockpit = new THREE.Vector3(spec.dims.wid / 4, 2.0 - spec.cg, a - (spec.dims.len / 2 - 2.7) + spec.dims.len / 2 - 1.5);
    root.userData.roofY = spec.dims.hgt - spec.cg;
  }
  return root;
}

// sync the visual model to the simulated vehicle state (interpolated pose given)
/** Which parts of a car are drawn for the view: from outside, from the driver's seat, or the clear windscreen view. */
export function showCabinView(model, opts = {}) {
  const ud = model.userData;
  // Every car has a cabin to show or hide; only the lit cars have an instrument canvas.
  if(ud.cabinFrame){
    const fallback=opts.cockpit && !ud.nativeCabin;
    const hidden=opts.clear || fallback;
    ud.body.visible=!ud.hideBody && !opts.clear;
    ud.shell.visible=!hidden;
    if(ud.fittings)ud.fittings.visible=!hidden&&!ud.dents;
    if(skyReflection && ud.shell.material.envMap===skyReflection)
      ud.shell.material.envMapIntensity=opts.lightsOn?.19:.59;
    if(ud.busBody) ud.busBody.visible=!opts.clear;
    ud.cabinFrame.visible=fallback||ud.visibleCabin;
    for(const child of ud.cabinParts) child.visible=ud.cabinFrame.visible;
    for(const glass of ud.cabinGlass || []) glass.opacity=opts.cockpit?.07:.42;
    if(ud.cabinLight){
      ud.cabinLight.position.copy(ud.cockpit).add(new THREE.Vector3(-.22,.10,-.18));
      ud.cabinLight.intensity=opts.cockpit?(opts.lightsOn?.88:2.8):0;
    }
  }
}

export function syncCar(model, car, pos, quat, opts = {}) {
  model.position.copy(pos);
  model.quaternion.copy(quat);
  const ud = model.userData;
  showCabinView(model, opts);
  const inv = new THREE.Matrix4().compose(pos, quat, new THREE.Vector3(1, 1, 1)).invert();
  const wv = new THREE.Vector3();
  car.wheels.forEach((w, i) => {
    const m = ud.wheels[i];
    wv.set(w.center[0], w.center[1], w.center[2]).applyMatrix4(inv);
    m.position.copy(wv);
    if (w.bent) { m.position.x += w.bent[0]; m.position.y += w.bent[1]; m.position.z += w.bent[2]; }
    m.rotation.set(0, w.steer + (w.bentToe || 0), w.bentCamber || 0);
    m.userData.spin.rotation.x = w.spinAngle;
    m.scale.x = w.side;
    m.visible = !w.broken && !opts.clear && !(opts.cockpit && !ud.nativeCabin);
  });
  ud.steer.rotation.z = -car.steerAngle * car.spec.steer.ratio * 0.9;
  const brake = car.input.brake > 0.05 && car.gear !== 0;
  ud.bodyU.uBrake.value = brake ? 1 : 0;
  ud.bodyU.uRev.value = car.gear === 0 ? 1 : 0;
  ud.bodyU.uLamps.value = opts.lightsOn ? 1 : 0;
  if (ud.beams) for (const b of ud.beams) b.intensity = opts.lightsOn ? 160 : 0;
  if (ud.gauges && opts.cockpit) drawGauges(ud.gauges, car, opts.lightsOn);
}

function drawGauges(G, car, night) {
  const now = performance.now();
  if (G.last && now - G.last < 50) return;
  G.last = now;
  const g = G.canvas.getContext('2d');
  g.fillStyle = '#07080a'; g.fillRect(0, 0, 512, 200);
  const dial = (cx, value, max, label, red, ticks) => {
    const r = 86, a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
    g.lineWidth = 3; g.strokeStyle = '#444'; g.beginPath(); g.arc(cx, 100, r, a0, a1); g.stroke();
    for (let i = 0; i <= ticks; i++) {
      const a = a0 + (a1 - a0) * i / ticks;
      const hot = red !== null && i / ticks >= red;
      g.strokeStyle = hot ? '#e33' : (night ? '#ffb070' : '#ddd');
      g.lineWidth = i % 2 ? 1.5 : 3;
      g.beginPath(); g.moveTo(cx + Math.cos(a) * r * 0.82, 100 + Math.sin(a) * r * 0.82); g.lineTo(cx + Math.cos(a) * r, 100 + Math.sin(a) * r); g.stroke();
    }
    const a = a0 + (a1 - a0) * Math.min(1.02, value / max);
    g.strokeStyle = '#ff5a2a'; g.lineWidth = 4;
    g.beginPath(); g.moveTo(cx, 100); g.lineTo(cx + Math.cos(a) * r * 0.9, 100 + Math.sin(a) * r * 0.9); g.stroke();
    g.fillStyle = '#ccc'; g.font = '16px sans-serif'; g.textAlign = 'center'; g.fillText(label, cx, 160);
  };
  dial(130, car.rpm, 8000, 'tr/min x1000', car.spec.engine.redline / 8000, 16);
  dial(382, Math.abs(car.forwardSpeed()) * 3.6, 260, 'km/h', null, 13);
  g.fillStyle = '#fff'; g.font = 'bold 30px monospace'; g.textAlign = 'center';
  g.fillText(String(Math.round(Math.abs(car.forwardSpeed()) * 3.6)), 382, 112);
  g.fillStyle = '#ffd23f'; g.fillText(car.gearLabel(), 130, 112);
  if (car.absActive) { g.fillStyle = '#fa0'; g.font = 'bold 14px sans-serif'; g.fillText('ABS', 256, 60); }
  if (car.tc > 0.05) { g.fillStyle = '#fa0'; g.font = 'bold 14px sans-serif'; g.fillText('TC', 256, 80); }
  G.tex.needsUpdate = true;
}
