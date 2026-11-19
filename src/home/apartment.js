// Procedural interiors for the player's home and houses for sale.  Layouts follow the programs of real
// small-town listings (period flat: parquet, mouldings, beams, separate kitchen and WC; village
// house: two levels, three bedrooms upstairs, fireplace), but no listing photo is copied.
// Everything is MeshBasicMaterial + baked per-face shading, so the world's sun cannot leak in.
// Coordinates: x east, z south, y up, metres; a level is 2.95 m high.
import * as THREE from '../vendor/three.module.js';

// Everything here is procedural: boxes, prisms and canvas textures drawn by the code.
const hasProp = () => false;

export const LEVEL_H = 2.95, CEIL = 2.7;

const shadeN = { top: 1.0, bot: 0.45, xp: 0.84, xn: 0.74, zp: 0.92, zn: 0.78 };

class Mesher {
  constructor() { this.pos = []; this.col = []; this.uv = []; }
  quad(p0, p1, p2, p3, c, shade, y0, uvs = null) {
    const r = ((c >> 16) & 255) / 255, g = ((c >> 8) & 255) / 255, b = (c & 255) / 255;
    for (const p of [p0, p1, p2, p0, p2, p3]) {
      const ao = 0.58 + 0.42 * Math.min(1, Math.max(0, (p[1] - y0) / 1.3));        // darker near the floor
      const k = shade * ao;
      this.pos.push(p[0], p[1], p[2]);
      this.col.push(r * k, g * k, b * k);
    }
    if (!uvs) {
      // metres projected along the face's dominant axis, so any surface can carry a texture
      const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2], vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
      const nx = Math.abs(uy * vz - uz * vy), ny = Math.abs(uz * vx - ux * vz), nz = Math.abs(ux * vy - uy * vx);
      const flat = ny >= nx && ny >= nz ? (p) => [p[0], p[2]] : nx >= nz ? (p) => [p[2], p[1]] : (p) => [p[0], p[1]];
      uvs = [flat(p0), flat(p1), flat(p2), flat(p3)];
    }
    for (const i of [0, 1, 2, 0, 2, 3]) this.uv.push(uvs[i][0], uvs[i][1]);
  }
  geometry() {
    if (!this.pos.length) { this.pos.push(0, 0, 0, 0, 0, 0, 0, 0, 0); this.col.push(0, 0, 0, 0, 0, 0, 0, 0, 0); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    if (this.uv.length) g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeBoundingSphere();
    return g;
  }
}

function canvasTex(draw, w = 512, h = 512) {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
// Hash noise so the textures are the same every time.
const grain = (x, y, k) => { const v = Math.sin(x * 12.9898 + y * 78.233 + k * 37.719) * 43758.5453; return v - Math.floor(v); };
const TEX = {
  // painted plaster: faint mottling and roller streaks, centred near white so the wall colour comes through
  plaster: () => canvasTex((x, w, h) => {
    x.fillStyle = '#e4e4e4'; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) {
      const v = 214 + Math.floor(grain(i, 1, 3) * 40), a = 0.1 + grain(i, 2, 5) * 0.14;
      x.fillStyle = `rgba(${v},${v},${v},${a})`;
      x.fillRect(grain(i, 3, 7) * w, grain(i, 4, 9) * h, 2 + grain(i, 5, 2) * 9, 2 + grain(i, 6, 4) * 7);
    }
    for (let i = 0; i < 26; i++) { x.fillStyle = `rgba(255,255,255,${0.04 + grain(i, 8, 1) * 0.05})`; x.fillRect(0, grain(i, 7, 6) * h, w, 3 + grain(i, 9, 8) * 8); }
  }, 256, 256),
  // wood: long grain lines, darker rings and the odd knot
  timber: () => canvasTex((x, w, h) => {
    x.fillStyle = '#e6e0d6'; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 70; i++) {
      const y = grain(i, 1, 4) * h, th = 1 + grain(i, 2, 6) * 3.5, v = 150 + Math.floor(grain(i, 3, 8) * 70);
      x.fillStyle = `rgba(${v - 40},${v - 55},${v - 80},${0.12 + grain(i, 4, 3) * 0.22})`;
      x.beginPath(); x.moveTo(0, y);
      for (let t = 0; t <= 8; t++) x.lineTo(t * w / 8, y + Math.sin(t * 0.9 + i) * (1 + grain(i, 5, 2) * 3));
      for (let t = 8; t >= 0; t--) x.lineTo(t * w / 8, y + th + Math.sin(t * 0.9 + i) * (1 + grain(i, 5, 2) * 3));
      x.fill();
    }
    for (let k = 0; k < 3; k++) {
      const cx = grain(k, 11, 3) * w, cy = grain(k, 12, 5) * h;
      x.strokeStyle = 'rgba(90,60,40,.28)'; x.lineWidth = 1.2;
      for (let r = 3; r < 14; r += 3) { x.beginPath(); x.ellipse(cx, cy, r * 1.7, r * 0.75, 0, 0, 7); x.stroke(); }
    }
  }, 256, 256),
  // woven fabric: a fine over-under grid with thread variation
  cloth: () => canvasTex((x, w, h) => {
    x.fillStyle = '#ece9e4'; x.fillRect(0, 0, w, h);
    const n = 32, c = w / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const over = (i + j) % 2, v = 196 + Math.floor(grain(i, j, 5) * 34);
      x.fillStyle = `rgb(${v},${v},${v})`;
      if (over) x.fillRect(i * c, j * c + 0.5, c - 0.6, c - 1.2); else x.fillRect(i * c + 0.5, j * c, c - 1.2, c - 0.6);
    }
  }, 128, 128),
  // glazed wall tiles: a grout grid, a soft sheen on each tile and a few slightly off ones
  walltile: () => canvasTex((x, w, h) => {
    x.fillStyle = '#b9b5ac'; x.fillRect(0, 0, w, h);
    const n = 4, c = w / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const v = 238 - Math.floor(grain(i, j, 2) * 18);
      x.fillStyle = `rgb(${v},${v},${v - 2})`; x.fillRect(i * c + 2, j * c + 2, c - 4, c - 4);
      const g = x.createLinearGradient(i * c, j * c, i * c + c, j * c + c); g.addColorStop(0, 'rgba(255,255,255,.45)'); g.addColorStop(0.5, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(0,0,0,.08)');
      x.fillStyle = g; x.fillRect(i * c + 2, j * c + 2, c - 4, c - 4);
    }
  }, 256, 256),
  parquet: () => canvasTex((x, w, h) => {                       // 2 m x 2 m of oak planks
    const pl = 16;
    for (let r = 0; r < pl; r++) {
      const y = r * h / pl; let off = (r % 2) * 0.5 * w / 4;
      for (let i = -1; i < 5; i++) {
        const t = 0.55 + ((r * 7 + i * 13) % 10) / 40;
        x.fillStyle = `rgb(${Math.round(150 * t)},${Math.round(104 * t)},${Math.round(62 * t)})`;
        x.fillRect(i * w / 4 + off, y, w / 4 - 1.5, h / pl - 1.5);
      }
    }
  }),
  tile: () => canvasTex((x, w, h) => {                          // beige tiles, 0.5 m
    x.fillStyle = '#9a948a'; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      const t = 205 + ((i * 3 + j * 5) % 5) * 4;
      x.fillStyle = `rgb(${t},${t - 8},${t - 22})`; x.fillRect(i * w / 4 + 2, j * h / 4 + 2, w / 4 - 4, h / 4 - 4);
    }
  }),
  checker: () => canvasTex((x, w, h) => {                       // black and white tiles, 0.5 m
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { x.fillStyle = (i + j) % 2 ? '#e8e6df' : '#2b2b2e'; x.fillRect(i * w / 4, j * h / 4, w / 4, h / 4); }
  }),
  concrete: () => canvasTex((x, w, h) => {
    x.fillStyle = '#8d8e8f'; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) { const t = 120 + (i * 37 % 40); x.fillStyle = `rgba(${t},${t},${t + 2},0.35)`; x.fillRect((i * 97) % w, (i * 53) % h, 3 + i % 6, 2 + i % 4); }
    x.strokeStyle = '#6f7071'; x.lineWidth = 2; x.strokeRect(1, 1, w - 2, h - 2);
    x.fillStyle = 'rgba(40,40,40,.35)'; x.beginPath(); x.ellipse(w * 0.3, h * 0.6, 60, 28, 0.4, 0, 7); x.fill();   // an oil stain
  }),
  lino: () => canvasTex((x, w, h) => { x.fillStyle = '#d9d6cc'; x.fillRect(0, 0, w, h); for (let i = 0; i < 6; i++) { x.fillStyle = i % 2 ? '#cfcbbf' : '#e1ded4'; x.fillRect(0, i * h / 6, w, h / 6); } }),
  tomette: () => canvasTex((x, w, h) => {                       // terracotta hexagon-ish tomettes
    x.fillStyle = '#6a3d28'; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) {
      const t = 0.8 + ((i * 7 + j * 3) % 6) / 25;
      x.fillStyle = `rgb(${Math.round(190 * t)},${Math.round(98 * t)},${Math.round(64 * t)})`;
      x.fillRect(i * w / 8 + 2, j * h / 8 + 2, w / 8 - 4, h / 8 - 4);
    }
  }),
};

export const PAL = {
  wall: [0xcdb77f, 0xa9b78f, 0xc79a7c, 0xbf9f62],
  beam: 0x4a3322, wood: 0x8a5a36, woodDark: 0x4d3322, white: 0xf3f1ea, steel: 0xb9bcc0, black: 0x1b1c1f,
  fabric: [0x6d7f8f, 0x8a5f4f, 0x6e7d5c, 0x5d5f78],
};

export class Interior {
  /** kind: 'apartment' | 'house'; seed picks palette variants */
  constructor(kind = 'apartment', seed = 1, opts = {}) {
    this.kind = kind; this.seed = seed;
    this.solid = new Mesher();
    this.timber = new Mesher();       // wood: grain texture
    this.cloth = new Mesher();        // fabric: weave texture
    this.tiles = new Mesher();        // glazed wall tiles
    this.ceilings = new Mesher();
    this.floors = {};                 // texture key -> Mesher
    this.glass = new Mesher();
    this.lamps = new Mesher();
    this.pools = new Mesher();
    this.colliders = [];              // { x0, z0, x1, z1, lvl }
    this.interacts = [];              // { id, label, x, z, r, lvl }
    this.stairs = [];                 // { x, z, r, lvl, toLvl, tx, tz }
    // things the game brings to life (src/interior/homelife.js): where one sits, TV screens, mirror glass, toilets
    this.seats = [];                  // { x, z, yaw, lvl, h, kind }   yaw: Walker convention (0 faces +z)
    this.screens = [];                // { x, y, z, yaw, lvl, w, h }   centre of the screen, facing yaw
    this.mirrors = [];                // { x, y, z, yaw, lvl, w, h }
    this.toilets = [];                // { x, z, lvl }
    this.realCars = typeof document !== 'undefined';   // the game places real car models at carSpots (garage)
    this.props = [];                  // real models (src/interior/props.js): { id, x, y, z, yaw, lvl, fit, turn, hang, stretch }
    this.rooms = [];
    this.lights = [];
    this.levels = 1;
    this.rng = (() => { let s = seed * 9301 + 49297; return () => ((s = (s * 9301 + 49297) % 233280) / 233280); })();
    this.wallCol = PAL.wall[seed % PAL.wall.length];
    this.fabric = PAL.fabric[(seed >> 1) % PAL.fabric.length];
    this.staff = new Mesher(); this.crowd = new Mesher();
    this.opts = opts;
    this._apartment();
  }

  // ------------------------------------------------------------------ primitives
  box(x0, y0, z0, x1, y1, z1, c, lvl = 0, o = {}) {
    const m = this._mesh(c, o), by = lvl * LEVEL_H;
    const Y0 = y0 + by, Y1 = y1 + by, b = Y0 - (o.base ?? 0);
    const base = lvl * LEVEL_H;
    const q = (p0, p1, p2, p3, sh) => m.quad(p0, p1, p2, p3, c, sh, base);
    if (!o.noTop) q([x0, Y1, z0], [x1, Y1, z0], [x1, Y1, z1], [x0, Y1, z1], shadeN.top);
    if (!o.noBottom) q([x0, Y0, z0], [x0, Y0, z1], [x1, Y0, z1], [x1, Y0, z0], shadeN.bot);
    q([x0, Y0, z1], [x0, Y1, z1], [x1, Y1, z1], [x1, Y0, z1], shadeN.zp);
    q([x1, Y0, z0], [x1, Y1, z0], [x0, Y1, z0], [x0, Y0, z0], shadeN.zn);
    q([x1, Y0, z1], [x1, Y1, z1], [x1, Y1, z0], [x1, Y0, z0], shadeN.xp);
    q([x0, Y0, z0], [x0, Y1, z0], [x0, Y1, z1], [x0, Y0, z1], shadeN.xn);
    void b;
  }

  /** which surface a colour is drawn on: wood and fabric colours get their own textures, the rest is plaster/paint */
  _mesh(c, o = {}) {
    if (o.mesher) return o.mesher;
    const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255, f = this.fabric;
    if (Math.abs(r - ((f >> 16) & 255)) < 36 && Math.abs(g - ((f >> 8) & 255)) < 36 && Math.abs(b - (f & 255)) < 36 && Math.abs(r - b) < 70) return this.cloth;
    if (c === 0xf2efe8 || c === 0xf4f1e8 || c === 0xfaf8f2) return this.cloth;
    if (r - g >= 12 && r - g <= 62 && g - b >= 12 && g - b <= 72 && r <= 0xe2) return this.timber;
    return this.solid;
  }

  solidBox(x0, y0, z0, x1, y1, z1, c, lvl = 0, o = {}) {
    this.box(x0, y0, z0, x1, y1, z1, c, lvl, o);
    if (y0 < 1.0 && !o.noCollide) this.colliders.push({ x0, z0, x1, z1, lvl });
  }

  floorQuad(x0, z0, x1, z1, tex, lvl, tint = 0xffffff) {
    const m = this.floors[tex] || (this.floors[tex] = new Mesher());
    const y = lvl * LEVEL_H + 0.001;
    m.quad([x0, y, z0], [x0, y, z1], [x1, y, z1], [x1, y, z0], 0xffffff, 1, y, [[x0 / 2, z0 / 2], [x0 / 2, z1 / 2], [x1 / 2, z1 / 2], [x1 / 2, z0 / 2]]);
    void tint;
  }

  ceiling(x0, z0, x1, z1, lvl, c = 0xd2cbba) {
    const y = lvl * LEVEL_H + CEIL;
    this.ceilings.quad([x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1], c, 0.95, lvl * LEVEL_H + 2.0);
    // cornice
    const t = 0.1;
    this.box(x0, CEIL - t, z0, x1, CEIL, z0 + t, 0xd5cdbc, lvl, { noBottom: false });
    this.box(x0, CEIL - t, z1 - t, x1, CEIL, z1, 0xd5cdbc, lvl);
    this.box(x0, CEIL - t, z0, x0 + t, CEIL, z1, 0xd5cdbc, lvl);
    this.box(x1 - t, CEIL - t, z0, x1, CEIL, z1, 0xd5cdbc, lvl);
  }

  beams(x0, z0, x1, z1, lvl, alongZ = true, step = 1.1) {
    if (alongZ) for (let x = x0 + 0.7; x < x1 - 0.2; x += step) this.box(x, CEIL - 0.2, z0, x + 0.14, CEIL, z1, PAL.beam, lvl, { mesher: this.timber });
    else for (let z = z0 + 0.7; z < z1 - 0.2; z += step) this.box(x0, CEIL - 0.2, z, x1, CEIL, z + 0.14, PAL.beam, lvl, { mesher: this.timber });
  }

  /** a wall along 'x' at z=at (from..to) or along 'z' at x=at; openings [{a,b,kind}] in the running coordinate */
  wall(ax, at, from, to, o = {}) {
    const th = o.th ?? 0.12, lvl = o.lvl ?? 0, ops = (o.openings || []).slice().sort((p, q) => p.a - q.a);
    const cA = o.cA ?? this.wallCol, cB = o.cB ?? this.wallCol;
    const half = th / 2, P = { mesher: this.solid };
    const seg = (a, b, y0, y1, solid = true) => {
      if (b - a < 0.005 || y1 - y0 < 0.005) return;
      if (ax === 'x') { this.box(a, y0, at - half, b, y1, at, cA, lvl, P); this.box(a, y0, at, b, y1, at + half, cB, lvl, P); if (solid && y0 < 0.5) this.colliders.push({ x0: a, z0: at - half, x1: b, z1: at + half, lvl }); }
      else { this.box(at - half, y0, a, at, y1, b, cA, lvl, P); this.box(at, y0, a, at + half, y1, b, cB, lvl, P); if (solid && y0 < 0.5) this.colliders.push({ x0: at - half, z0: a, x1: at + half, z1: b, lvl }); }
    };
    let cur = from;
    for (const op of ops) {
      seg(cur, op.a, 0, CEIL);
      const kind = op.kind || 'door';
      if (kind === 'window') {
        const sill = op.sill ?? 0.9, head = op.head ?? 2.1;
        seg(op.a, op.b, 0, sill, true); seg(op.a, op.b, head, CEIL, false);
        this._window(ax, at, op.a, op.b, sill, head, lvl, half);
      } else {
        const head = kind === 'arch' ? 2.25 : 2.08;
        seg(op.a, op.b, head, CEIL, false);
        this._doorFrame(ax, at, op.a, op.b, head, lvl, th, kind);
        if (kind === 'door' && !o.noLeaf) this._doorLeaf(ax, at, op.a, op.b, lvl);
      }
      cur = op.b;
    }
    seg(cur, to, 0, CEIL);
    // skirting board on both faces
    const sk = (a, b) => {
      if (ax === 'x') { this.box(a, 0, at - half - 0.015, b, 0.09, at - half, 0xc6bfae, lvl); this.box(a, 0, at + half, b, 0.09, at + half + 0.015, 0xc6bfae, lvl); }
      else { this.box(at - half - 0.015, 0, a, at - half, 0.09, b, 0xc6bfae, lvl); this.box(at + half, 0, a, at + half + 0.015, 0.09, b, 0xc6bfae, lvl); }
    };
    let c2 = from;
    for (const op of ops) { if (op.a > c2) sk(c2, op.a); c2 = op.b; }
    if (to > c2) sk(c2, to);
  }

  _window(ax, at, a, b, sill, head, lvl, half) {
    const f = 0.05, c = 0xc9c2b2;
    const P = (u, y, d) => (ax === 'x' ? [u, y + lvl * LEVEL_H, at + d] : [at + d, y + lvl * LEVEL_H, u]);
    // frame
    const bx = (u0, y0, u1, y1) => (ax === 'x' ? this.box(u0, y0, at - half - 0.02, u1, y1, at + half + 0.02, c, lvl) : this.box(at - half - 0.02, y0, u0, at + half + 0.02, y1, u1, c, lvl));
    bx(a, sill - f, b, sill); bx(a, head, b, head + f); bx(a, sill, a + f, head); bx(b - f, sill, b, head);
    bx((a + b) / 2 - f / 2, sill, (a + b) / 2 + f / 2, head);                 // mullion
    // Keep pane geometry separate so a shop can show a live view of the street.
    (this._windows || (this._windows = [])).push({ ax, at, a, b, sill, head, lvl });
  }

  _doorFrame(ax, at, a, b, head, lvl, th, kind) {
    const c = kind === 'arch' ? 0xc6bfae : 0xc9c2b2, f = 0.05, half = th / 2 + 0.02;
    if (ax === 'x') { this.box(a - f, 0, at - half, a, head, at + half, c, lvl); this.box(b, 0, at - half, b + f, head, at + half, c, lvl); this.box(a - f, head, at - half, b + f, head + f, at + half, c, lvl); }
    else { this.box(at - half, 0, a - f, at + half, head, a, c, lvl); this.box(at - half, 0, b, at + half, head, b + f, c, lvl); this.box(at - half, head, a - f, at + half, head + f, b + f, c, lvl); }
  }

  /** front door: a closed leaf in an opening of an exterior wall */
  frontDoor(ax, at, a, b, lvl = 0) {
    const th = 0.08;
    if (ax === 'x') this.box(a, 0, at - th / 2, b, 2.05, at + th / 2, 0x3b4a5c, lvl);
    else this.box(at - th / 2, 0, a, at + th / 2, 2.05, b, 0x3b4a5c, lvl);
    const m = (a + b) / 2 + (b - a) * 0.36;
    if (ax === 'x') this.box(m - 0.03, 0.95, at - 0.07, m + 0.03, 1.0, at + 0.07, PAL.steel, lvl, { noCollide: true });
    else this.box(at - 0.07, 0.95, m - 0.03, at + 0.07, 1.0, m + 0.03, PAL.steel, lvl, { noCollide: true });
  }

  room(name, x0, z0, x1, z1, floor, lvl = 0, o = {}) {
    this.rooms.push({ name, x0, z0, x1, z1, lvl });
    this.floorQuad(x0, z0, x1, z1, floor, lvl);
    this.ceiling(x0, z0, x1, z1, lvl, o.ceil);
    if (o.beams) this.beams(x0, z0, x1, z1, lvl, o.beams !== 'x');
  }

  // rotate a local AABB (about the furniture origin) by quarter turns and translate
  _rot(b, rot, x, z) {
    const [lx0, lz0, lx1, lz1] = b;
    const r = ((rot % 4) + 4) % 4;
    const pts = [[lx0, lz0], [lx1, lz1]].map(([a, c]) => (r === 0 ? [a, c] : r === 1 ? [-c, a] : r === 2 ? [-a, -c] : [c, -a]));
    return [Math.min(pts[0][0], pts[1][0]) + x, Math.min(pts[0][1], pts[1][1]) + z, Math.max(pts[0][0], pts[1][0]) + x, Math.max(pts[0][1], pts[1][1]) + z];
  }
  /** a local point (furniture coords, front = +z) in room coords, and the furniture's facing as a Walker yaw */
  _pt(x, z, rot, lx, lz) {
    const r = ((rot % 4) + 4) % 4;
    const [a, c] = r === 0 ? [lx, lz] : r === 1 ? [-lz, lx] : r === 2 ? [-lx, -lz] : [lz, -lx];
    return [x + a, z + c];
  }
  _yaw(rot) { const [fx, fz] = this._pt(0, 0, rot, 0, 1); return Math.atan2(fx, fz); }
  /** a real model in place of the box furniture (src/interior/props.js); true when there is one, the caller then
   *  draws nothing more.  fit: { w, d, h } in the furniture's frame; o.col: local collider box; o.lx/lz/y: offset */
  canModel(id) { return !this.noModels && hasProp(id); }
  model(id, x, z, rot, lvl, fit, o = {}) {
    if (this.noModels || !hasProp(id)) return false;
    const [px, pz] = o.lx !== undefined ? this._pt(x, z, rot, o.lx, o.lz) : [x, z];
    this.props.push({ id, x: px, z: pz, y: o.y || 0, yaw: this._yaw(rot), lvl, fit, turn: o.turn || 0, hang: !!o.hang, stretch: !!o.stretch });
    if (o.col) { const [a, b, c, d] = this._rot(o.col, rot, x, z); this.colliders.push({ x0: a, z0: b, x1: c, z1: d, lvl }); }
    return true;
  }
  /** add a furniture box in local coords (front = +z) */
  fb(x, z, rot, lvl, l, y0, y1, c, o = {}) {
    const [a, b, c2, d] = this._rot([l[0], l[1], l[2], l[3]], rot, x, z);
    if (o.solid) this.solidBox(a, y0, b, c2, y1, d, c, lvl, o); else this.box(a, y0, b, c2, y1, d, c, lvl, o);
  }

  // ------------------------------------------------------------------ more primitives
  /** prism / cone of `seg` sides around (x, z): radius r0 at y0 to r1 at y1 */
  prism(x, z, r0, r1, y0, y1, c, lvl = 0, o = {}) {
    const seg = o.seg || 10, m = this._mesh(c, o), base = lvl * LEVEL_H, Y0 = y0 + base, Y1 = y1 + base;
    for (let i = 0; i < seg; i++) {
      const a0 = i / seg * Math.PI * 2, a1 = (i + 1) / seg * Math.PI * 2;
      const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      const sh = 0.78 + 0.2 * Math.cos((a0 + a1) / 2 - 0.8);
      m.quad([x + c0 * r0, Y0, z + s0 * r0], [x + c0 * r1, Y1, z + s0 * r1], [x + c1 * r1, Y1, z + s1 * r1], [x + c1 * r0, Y0, z + s1 * r0], c, sh, base);
      if (!o.noTop && r1 > 0) m.quad([x, Y1, z], [x + c1 * r1, Y1, z + s1 * r1], [x + c0 * r1, Y1, z + s0 * r1], [x, Y1, z], c, 1.0, base);
    }
    if (o.solid && y0 < 1.0) this.colliders.push({ x0: x - r0, z0: z - r0, x1: x + r0, z1: z + r0, lvl });
  }
  /** horizontal cylinder along 'x' or 'z' (wheels, pipes, rolls, bottles lying) */
  hprism(axis, cx, cy, cz, r0, r1, len, c, lvl = 0, o = {}) {
    const seg = o.seg || 10, m = this._mesh(c, o), base = lvl * LEVEL_H, Y = cy + base;
    const h = len / 2;
    for (let i = 0; i < seg; i++) {
      const a0 = i / seg * Math.PI * 2, a1 = (i + 1) / seg * Math.PI * 2;
      const P = (a, r, t) => (axis === 'x' ? [cx + t, Y + Math.sin(a) * r, cz + Math.cos(a) * r] : [cx + Math.cos(a) * r, Y + Math.sin(a) * r, cz + t]);
      const sh = 0.7 + 0.3 * Math.max(0, Math.sin((a0 + a1) / 2 + 0.6));
      m.quad(P(a0, r0, -h), P(a0, r1, h), P(a1, r1, h), P(a1, r0, -h), c, sh, base);
      const Cc = (t, r) => (axis === 'x' ? [cx + t, Y, cz] : [cx, Y, cz + t]);
      m.quad(Cc(-h), P(a1, r0, -h), P(a0, r0, -h), Cc(-h), c, 0.8, base);
      m.quad(Cc(h), P(a0, r1, h), P(a1, r1, h), Cc(h), c, 0.9, base);
    }
    if (o.solid) this.colliders.push(axis === 'x' ? { x0: cx - h, z0: cz - r0, x1: cx + h, z1: cz + r0, lvl } : { x0: cx - r0, z0: cz - h, x1: cx + r0, z1: cz + h, lvl });
  }
  /** prism in a furniture's local frame */
  fp(x, z, rot, lvl, lx, lz, r0, r1, y0, y1, c, o = {}) {
    const r = ((rot % 4) + 4) % 4;
    const [a, b] = r === 0 ? [lx, lz] : r === 1 ? [-lz, lx] : r === 2 ? [-lx, -lz] : [lz, -lx];
    this.prism(x + a, z + b, r0, r1, y0, y1, c, lvl, o);
  }
  /** flat piece on a floor-standing furniture's top (a thin box, no collision) */
  top(x, z, rot, lvl, lx, lz, w, d, y, h, c) { this.fb(x, z, rot, lvl, [lx - w / 2, lz - d / 2, lx + w / 2, lz + d / 2], y, y + h, c, { noCollide: true }); }

  /** a collision box without drawing anything (the furniture draws itself in detail) */
  collide(x, z, rot, lvl, l) { const [a, b, c, d] = this._rot(l, rot, x, z); this.colliders.push({ x0: a, z0: b, x1: c, z1: d, lvl }); }
  /** the room axis a wall-hung round object's axle runs along */
  _axle(rot) { return ((rot % 2) + 2) % 2 === 0 ? 'z' : 'x'; }

  // ------------------------------------------------------------------ small things
  mug(x, z, rot, lvl, lx, lz, y, c = 0xd9d4c4) {
    this.fp(x, z, rot, lvl, lx, lz, 0.04, 0.04, y, y + 0.09, c, { seg: 8 });
    this.top(x, z, rot, lvl, lx + 0.055, lz, 0.025, 0.012, y + 0.04, 0.035, c);
  }
  plate(x, z, rot, lvl, lx, lz, y) { this.fp(x, z, rot, lvl, lx, lz, 0.115, 0.1, y, y + 0.018, 0xc9c2b2, { seg: 12 }); }
  glassCup(x, z, rot, lvl, lx, lz, y) { this.fp(x, z, rot, lvl, lx, lz, 0.032, 0.036, y, y + 0.11, 0xcfe0e6, { seg: 8 }); }
  laptop(x, z, rot, lvl, lx, lz, y) {
    const n = { noCollide: true }, al = 0xb9bdc4, dark = 0x1d1f24;
    // aluminium base, a recessed keyboard of 4 rows of keys, a trackpad
    this.top(x, z, rot, lvl, lx, lz, 0.34, 0.235, y, 0.016, al);
    this.top(x, z, rot, lvl, lx, lz - 0.02, 0.3, 0.12, y + 0.016, 0.002, dark);
    for (let r = 0; r < 4; r++) for (let i = 0; i < 12; i++) this.top(x, z, rot, lvl, lx - 0.13 + i * 0.0236, lz - 0.065 + r * 0.03, 0.019, 0.022, y + 0.018, 0.004, 0x3a3d44);
    this.top(x, z, rot, lvl, lx, lz + 0.075, 0.1, 0.06, y + 0.016, 0.002, 0xa4a8b0);
    // hinge and a lid leaning back in five steps
    this.fb(x, z, rot, lvl, [lx - 0.16, lz - 0.125, lx + 0.16, lz - 0.108], y + 0.012, y + 0.03, dark, n);
    for (let k = 0; k < 5; k++) {
      const yy = y + 0.03 + k * 0.052, zz = lz - 0.118 - k * 0.012;
      this.fb(x, z, rot, lvl, [lx - 0.17, zz - 0.012, lx + 0.17, zz + 0.004], yy, yy + 0.052, al, n);
      this.fb(x, z, rot, lvl, [lx - 0.155, zz + 0.004, lx + 0.155, zz + 0.008], yy + (k === 0 ? 0.012 : 0), yy + 0.052 - (k === 4 ? 0.012 : 0), k % 2 ? 0x6d98cc : 0x4f7bb0, n);
    }
  }
  books(x, z, rot, lvl, lx, lz, y) {
    const cs = [0x8a2b2b, 0x2b4d8a, 0xc9a23a];
    for (let i = 0; i < 3; i++) this.top(x, z, rot, lvl, lx, lz, 0.24 - i * 0.02, 0.17, y + i * 0.03, 0.03, cs[i]);
  }
  bowl(x, z, rot, lvl, lx, lz, y, fruit = true) {
    this.fp(x, z, rot, lvl, lx, lz, 0.1, 0.16, y, y + 0.07, 0xd8cdb8, { seg: 10 });
    if (fruit) for (const [dx, dz, c] of [[-0.05, 0, 0xd9482b], [0.05, 0.03, 0xe9b23a], [0, -0.05, 0x7fb04a]]) this.fp(x, z, rot, lvl, lx + dx, lz + dz, 0.045, 0.04, y + 0.06, y + 0.12, c, { seg: 6 });
  }
  vase(x, z, rot, lvl, lx, lz, y) {
    this.fp(x, z, rot, lvl, lx, lz, 0.05, 0.035, y, y + 0.22, 0x7aa0b8, { seg: 8 });
    for (const [dx, dz, c] of [[0, 0, 0xe9c34a], [-0.03, 0.02, 0xd9604a], [0.03, -0.02, 0xf2eee0]]) this.fp(x, z, rot, lvl, lx + dx, lz + dz, 0.035, 0.05, y + 0.22, y + 0.34, c, { seg: 6 });
  }
  clockOnWall(x, y, z, rot, lvl) {
    const n = { noCollide: true }, cy = y + 0.14, ax = this._axle(rot);
    const [fx, fz] = this._pt(x, z, rot, 0, 0.026), [gx, gz] = this._pt(x, z, rot, 0, 0.034);
    // a dark rim, a white face, twelve ticks, an hour hand, a minute hand and a centre pin
    this.hprism(ax, fx, cy, fz, 0.15, 0.15, 0.05, 0x2a2a2a, lvl, { seg: 20 });
    this.hprism(ax, gx, cy, gz, 0.132, 0.132, 0.012, 0xf4f1e6, lvl, { seg: 20 });
    for (let i = 0; i < 12; i++) {
      const a = i * Math.PI / 6, major = i % 3 === 0, r = 0.112;
      const [tx, tz] = this._pt(x, z, rot, Math.sin(a) * r, 0.042);
      this.fb(tx, tz, rot, lvl, major ? [-0.006, -0.002, 0.006, 0.002] : [-0.003, -0.002, 0.003, 0.002], cy + Math.cos(a) * r - (major ? 0.014 : 0.008), cy + Math.cos(a) * r + (major ? 0.014 : 0.008), 0x2a2a2a, n);
    }
    this.fb(x, z, rot, lvl, [-0.0045, 0.043, 0.0045, 0.047], cy, cy + 0.1, 0x1a1a1a, n);
    this.fb(x, z, rot, lvl, [0, 0.043, 0.075, 0.047], cy - 0.0045, cy + 0.0045, 0x1a1a1a, n);
    this.fb(x, z, rot, lvl, [-0.008, 0.043, 0.008, 0.05], cy - 0.008, cy + 0.008, 0xc94a3a, n);
  }
  mirrorOnWall(x, y, z, rot, lvl, w = 0.6, h = 0.9) {
    this.fb(x, z, rot, lvl, [-w / 2 - 0.03, -0.015, w / 2 + 0.03, 0.015], y - 0.03, y + h + 0.03, 0x5a4630, { noCollide: true });
    this.fb(x, z, rot, lvl, [-w / 2, 0.015, w / 2, 0.02], y, y + h, 0xb9d3e0, { noCollide: true });
    const [mx, mz] = this._pt(x, z, rot, 0, 0.024);
    this.mirrors.push({ x: mx, y: y + h / 2, z: mz, yaw: this._yaw(rot), lvl, w, h });
  }
  switchOn(x, y, z, rot, lvl) { this.fb(x, z, rot, lvl, [-0.04, -0.01, 0.04, 0.012], y, y + 0.08, 0xf6f6f2, { noCollide: true }); }

  // ------------------------------------------------------------------ living
  sofa(x, z, rot, lvl, w = 2.0) {
    const f = this.fabric, h = w / 2, d = 0.46, arm = 0.2, seats = w > 1.5 ? 3 : 1;
    if (this.model(w > 1.5 ? 'Sofa_01' : 'ArmChair_01', x, z, rot, lvl, { w, d: 0.95, h: 0.95 }, { col: [-h, -d, h, d] })) {
      const sw = (w - 2 * arm) / seats;
      for (let i = 0; i < seats; i++) { const [sx, sz] = this._pt(x, z, rot, -h + arm + (i + 0.5) * sw, 0.02); this.seats.push({ x: sx, z: sz, yaw: this._yaw(rot), lvl, h: 0.47, kind: w > 1.5 ? 'sofa' : 'armchair' }); }
      return;
    }
    this.fb(x, z, rot, lvl, [-h, -d, h, d], 0.1, 0.42, f, { solid: true });
    this.fb(x, z, rot, lvl, [-h, -d, h, -d + 0.2], 0.42, 0.88, f);
    this.fb(x, z, rot, lvl, [-h, -d, -h + arm, d], 0.42, 0.66, f);
    this.fb(x, z, rot, lvl, [h - arm, -d, h, d], 0.42, 0.66, f);
    const sw = (w - 2 * arm) / seats;
    for (let i = 0; i < seats; i++) {
      const [sx, sz] = this._pt(x, z, rot, -h + arm + (i + 0.5) * sw, 0.02);
      this.seats.push({ x: sx, z: sz, yaw: this._yaw(rot), lvl, h: 0.5, kind: w > 1.5 ? 'sofa' : 'armchair' });
      this.fb(x, z, rot, lvl, [-h + arm + i * sw + 0.01, -d + 0.2, -h + arm + (i + 1) * sw - 0.01, d - 0.02], 0.42, 0.52, f + 0x0c0c0c, { noCollide: true });
      this.fb(x, z, rot, lvl, [-h + arm + i * sw + 0.03, -d + 0.2, -h + arm + (i + 1) * sw - 0.03, -d + 0.34], 0.52, 0.8, f + 0x060606, { noCollide: true });
    }
    for (const sx of [-1, 1]) this.fb(x, z, rot, lvl, [sx * (h - 0.06) - 0.03, -d + 0.05, sx * (h - 0.06) + 0.03, -d + 0.1], 0, 0.1, PAL.woodDark, { noCollide: true });
    if (w > 1.5) { this.fb(x, z, rot, lvl, [-h + arm + 0.05, -d + 0.3, -h + arm + 0.4, -d + 0.42], 0.52, 0.82, 0xd9b36a, { noCollide: true }); this.fb(x, z, rot, lvl, [h - arm - 0.4, -d + 0.3, h - arm - 0.05, -d + 0.42], 0.52, 0.8, 0x9a3b34, { noCollide: true }); this.fb(x, z, rot, lvl, [h - arm - 0.7, 0.0, h - arm - 0.1, d - 0.05], 0.52, 0.55, 0xc9c0ae, { noCollide: true }); }
  }
  armchair(x, z, rot, lvl) { this.sofa(x, z, rot, lvl, 0.95); }
  table(x, z, rot, lvl, w = 1.4, d = 0.85, h = 0.75, c = PAL.wood) {
    if (this.model(w >= 1.1 ? 'dining_table' : 'WoodenTable_01', x, z, rot, lvl, { w, d, h }, { stretch: true, col: [-w / 2, -d / 2, w / 2, d / 2] })) return;
    this.fb(x, z, rot, lvl, [-w / 2, -d / 2, w / 2, d / 2], h - 0.05, h, c, { solid: true });
    this.fb(x, z, rot, lvl, [-w / 2 + 0.06, -d / 2 + 0.06, w / 2 - 0.06, d / 2 - 0.06], h - 0.12, h - 0.05, PAL.woodDark, { noCollide: true });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) this.fb(x, z, rot, lvl, [sx * (w / 2 - 0.08) - 0.035, sz * (d / 2 - 0.08) - 0.035, sx * (w / 2 - 0.08) + 0.035, sz * (d / 2 - 0.08) + 0.035], 0, h - 0.12, PAL.woodDark);
  }
  chair(x, z, rot, lvl) {
    { const [sx, sz] = this._pt(x, z, rot, 0, 0.02); this.seats.push({ x: sx, z: sz, yaw: this._yaw(rot), lvl, h: 0.5, kind: 'chair' }); }
    this.collide(x, z, rot, lvl, [-0.21, -0.21, 0.21, 0.21]);
    const n = { noCollide: true }, W = PAL.wood, D = PAL.woodDark;
    // seat frame with a padded cushion, turned legs that taper to the floor
    this.fb(x, z, rot, lvl, [-0.21, -0.2, 0.21, 0.2], 0.42, 0.455, W, n);
    this.fb(x, z, rot, lvl, [-0.19, -0.18, 0.19, 0.19], 0.455, 0.485, this.fabric, n);
    this.fb(x, z, rot, lvl, [-0.175, -0.165, 0.175, 0.175], 0.485, 0.495, this.fabric, n);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      this.fp(x, z, rot, lvl, sx * 0.175, sz * 0.175, 0.014, 0.022, 0, 0.42, D, { seg: 6 });
    }
    // stretchers between the legs
    for (const sz of [-1, 1]) this.fb(x, z, rot, lvl, [-0.175, sz * 0.175 - 0.008, 0.175, sz * 0.175 + 0.008], 0.17, 0.19, D, n);
    for (const sx of [-1, 1]) this.fb(x, z, rot, lvl, [sx * 0.175 - 0.008, -0.175, sx * 0.175 + 0.008, 0.175], 0.17, 0.19, D, n);
    // back: two posts, a curved top rail, a lower rail and four spindles
    for (const sx of [-1, 1]) this.fb(x, z, rot, lvl, [sx * 0.175 - 0.018, -0.2, sx * 0.175 + 0.018, -0.165], 0.455, 0.94, W, n);
    this.fb(x, z, rot, lvl, [-0.2, -0.205, 0.2, -0.16], 0.84, 0.92, W, n);
    this.fb(x, z, rot, lvl, [-0.14, -0.21, 0.14, -0.165], 0.92, 0.95, W, n);
    this.fb(x, z, rot, lvl, [-0.175, -0.19, 0.175, -0.175], 0.6, 0.64, D, n);
    for (let i = 0; i < 4; i++) this.fb(x, z, rot, lvl, [-0.105 + i * 0.07 - 0.009, -0.19, -0.105 + i * 0.07 + 0.009, -0.175], 0.64, 0.84, D, n);
  }
  stool(x, z, lvl) {
    this.seats.push({ x, z, yaw: Math.PI, lvl, h: 0.62, kind: 'stool' });
    this.colliders.push({ x0: x - 0.2, z0: z - 0.2, x1: x + 0.2, z1: z + 0.2, lvl });
    const D = PAL.woodDark;
    // a round padded seat on a ring, four tapered legs and a foot rail
    this.prism(x, z, 0.19, 0.19, 0.56, 0.585, PAL.wood, lvl, { seg: 14 });
    this.prism(x, z, 0.18, 0.15, 0.585, 0.64, this.fabric, lvl, { seg: 14 });
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + Math.PI / 4;
      this.prism(x + Math.cos(a) * 0.14, z + Math.sin(a) * 0.14, 0.02, 0.014, 0, 0.56, D, lvl, { seg: 6 });
    }
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + Math.PI / 4;
      this.prism(x + Math.cos(a) * 0.14, z + Math.sin(a) * 0.14, 0.014, 0.014, 0.25, 0.28, D, lvl, { seg: 4 });
    }
    this.prism(x, z, 0.145, 0.145, 0.25, 0.265, D, lvl, { seg: 12 });
  }
  officeChair(x, z, rot, lvl) {
    { const [sx, sz] = this._pt(x, z, rot, 0, 0.0); this.seats.push({ x: sx, z: sz, yaw: this._yaw(rot), lvl, h: 0.52, kind: 'chair' }); }
    this.fp(x, z, rot, lvl, 0, 0, 0.26, 0.26, 0.02, 0.07, PAL.black, { seg: 6 });
    this.fp(x, z, rot, lvl, 0, 0, 0.03, 0.03, 0.07, 0.45, PAL.steel, { seg: 6 });
    this.fb(x, z, rot, lvl, [-0.23, -0.22, 0.23, 0.22], 0.45, 0.52, PAL.black, { solid: true });
    this.fb(x, z, rot, lvl, [-0.21, -0.24, 0.21, -0.19], 0.52, 0.98, PAL.black);
  }
  shelf(x, z, rot, lvl, w = 0.9) {
    this.collide(x, z, rot, lvl, [-w / 2, -0.17, w / 2, 0.17]);
    const n = { noCollide: true }, W = PAL.wood, S = 0x6d4a2c, H = 1.9;
    // side panels, plinth, a back panel, a top cap with an overhang, five shelves
    for (const sx of [-1, 1]) this.fb(x, z, rot, lvl, [sx * (w / 2 - 0.0125) - 0.0125, -0.17, sx * (w / 2 - 0.0125) + 0.0125, 0.17], 0.05, H, W, n);
    this.fb(x, z, rot, lvl, [-w / 2 + 0.025, -0.165, w / 2 - 0.025, -0.15], 0.05, H - 0.02, 0x4d3322, n);
    this.fb(x, z, rot, lvl, [-w / 2, -0.15, w / 2, 0.17], 0, 0.05, 0x4d3322, n);
    this.fb(x, z, rot, lvl, [-w / 2 - 0.015, -0.185, w / 2 + 0.015, 0.185], H, H + 0.03, 0x7d5430, n);
    const ys = [0.2, 0.62, 1.04, 1.46, H - 0.02];
    for (const yy of ys) this.fb(x, z, rot, lvl, [-w / 2 + 0.025, -0.15, w / 2 - 0.025, 0.172], yy - 0.022, yy, S, n);
    const cols = [0x8a2b2b, 0x2b4d8a, 0x2f7a4a, 0xc9a23a, 0x5a3a7a, 0xe2ddd0, 0x3a3a3a, 0xa8552f];
    const inner = w - 0.07;
    for (let r = 0; r < 4; r++) {
      const base = ys[r], rowH = ys[r + 1] - 0.022 - base;
      let cursor = -inner / 2;
      for (let i = 0; i < 14 && cursor < inner / 2 - 0.05; i++) {
        const k = (i * 7 + r * 5) % 11;
        if (k === 3 && r < 3) { cursor += 0.07; continue; }           // a gap
        const bw = 0.022 + (k % 4) * 0.008, bh = Math.min(rowH - 0.05, 0.2 + ((i * 3 + r) % 5) * 0.035);
        if (cursor + bw > inner / 2) break;
        this.fb(x, z, rot, lvl, [cursor, -0.12, cursor + bw, 0.16], base, base + bh, cols[(i + r * 3) % cols.length], n);
        cursor += bw + 0.002;
      }
      // on the right of some shelves: a stack of flat books with a small object on top
      if (r % 2 === 0) {
        const sx = inner / 2 - 0.19;
        for (let b = 0; b < 3; b++) this.fb(x, z, rot, lvl, [sx, -0.1, sx + 0.17 - b * 0.012, 0.14], base + b * 0.032, base + (b + 1) * 0.032, cols[(b + r) % cols.length], n);
        if (r === 0) this.fp(x, z, rot, lvl, sx + 0.08, 0.02, 0.04, 0.035, base + 0.096, base + 0.19, 0x7aa0b8, { seg: 8 });
        else this.fp(x, z, rot, lvl, sx + 0.08, 0.02, 0.05, 0.035, base + 0.096, base + 0.15, 0xb9674a, { seg: 8 });
      }
    }
    // a small plant on top
    this.fp(x, z, rot, lvl, w / 2 - 0.2, 0, 0.06, 0.045, H + 0.03, H + 0.12, 0xb9674a, { seg: 8 });
    for (const [dx, dz, c] of [[0, 0, 0x4f8a3f], [-0.03, 0.02, 0x3f7a35], [0.03, -0.02, 0x62a04a]]) this.fp(x, z, rot, lvl, w / 2 - 0.2 + dx, dz, 0.05, 0.02, H + 0.12, H + 0.28, c, { seg: 5 });
  }
  sideboard(x, z, rot, lvl, w = 1.4) {
    this.collide(x, z, rot, lvl, [-w / 2, -0.22, w / 2, 0.22]);
    const n = { noCollide: true }, body = 0xd0b88e, door = 0xdcc59c, D = PAL.woodDark;
    // carcass, a top slab with an overhang, a recessed plinth, tapered legs
    this.fb(x, z, rot, lvl, [-w / 2 + 0.02, -0.21, w / 2 - 0.02, 0.2], 0.16, 0.78, body, n);
    this.fb(x, z, rot, lvl, [-w / 2 - 0.01, -0.235, w / 2 + 0.01, 0.235], 0.78, 0.815, 0xb89a68, n);
    this.fb(x, z, rot, lvl, [-w / 2 + 0.04, -0.19, w / 2 - 0.04, 0.18], 0.1, 0.16, 0x4d3322, n);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) this.fp(x, z, rot, lvl, sx * (w / 2 - 0.07), sz * 0.16, 0.022, 0.014, 0, 0.1, D, { seg: 6 });
    // doors with raised panels and bar handles, a drawer row above
    const doors = Math.max(2, Math.round(w / 0.5)), dw = (w - 0.04) / doors;
    for (let i = 0; i < doors; i++) {
      const x0 = -w / 2 + 0.02 + i * dw;
      this.fb(x, z, rot, lvl, [x0 + 0.006, 0.2, x0 + dw - 0.006, 0.214], 0.17, 0.62, door, n);
      this.fb(x, z, rot, lvl, [x0 + 0.04, 0.214, x0 + dw - 0.04, 0.22], 0.21, 0.58, 0xc8af84, n);
      const hx = i % 2 ? x0 + 0.05 : x0 + dw - 0.05;
      this.fb(x, z, rot, lvl, [hx - 0.008, 0.214, hx + 0.008, 0.245], 0.34, 0.5, PAL.steel, n);
      this.fb(x, z, rot, lvl, [x0 + 0.006, 0.2, x0 + dw - 0.006, 0.214], 0.635, 0.77, door, n);
      this.fb(x, z, rot, lvl, [x0 + dw / 2 - 0.05, 0.214, x0 + dw / 2 + 0.05, 0.226], 0.69, 0.71, PAL.steel, n);
    }
  }
  tv(x, z, rot, lvl) {
    this.sideboard(x, z, rot, lvl, 1.5);
    this.fb(x, z, rot, lvl, [-0.55, -0.05, 0.55, 0.0], 0.84, 1.45, PAL.black, { noCollide: true });
    this.fb(x, z, rot, lvl, [-0.52, 0.0, 0.52, 0.006], 0.87, 1.42, 0x23324a, { noCollide: true });
    { const [sx, sz] = this._pt(x, z, rot, 0, 0.012); this.screens.push({ x: sx, y: 1.145, z: sz, yaw: this._yaw(rot), lvl, w: 1.04, h: 0.55 }); }
    this.fb(x, z, rot, lvl, [-0.05, -0.1, 0.05, 0.0], 0.82, 0.88, PAL.black, { noCollide: true });
    this.top(x, z, rot, lvl, 0.62, 0, 0.1, 0.1, 0.82, 0.3, 0x2a2a2e);       // speaker
    this.top(x, z, rot, lvl, -0.62, 0, 0.1, 0.1, 0.82, 0.3, 0x2a2a2e);
  }
  rug(x0, z0, x1, z1, lvl, c) { this.box(x0, 0.002, z0, x1, 0.014, z1, c, lvl, { noBottom: true, mesher: this.cloth }); this.box(x0 + 0.08, 0.014, z0 + 0.08, x1 - 0.08, 0.016, z1 - 0.08, c + 0x141414, lvl, { noBottom: true, noCollide: true, mesher: this.cloth }); }
  plant(x, z, lvl, big = false) {
    if (this.model(big ? 'potted_plant_01' : 'potted_plant_02', x, z, (Math.floor(x * 7 + z * 3) % 4 + 4) % 4, lvl, { h: big ? 1.55 : 1.0 }, { col: [-0.2, -0.2, 0.2, 0.2] })) return;
    this.prism(x, z, 0.16, 0.12, 0, 0.32, 0xb8613f, lvl, { solid: true });
    this.prism(x, z, 0.28, 0.2, 0.3, 0.7, 0x3f7a3a, lvl);
    this.prism(x, z, 0.22, 0.12, 0.7, 1.05, 0x4a8a42, lvl);
    this.prism(x, z, 0.12, 0.02, 1.05, 1.3 + (big ? 0.5 : 0), 0x5a9a4e, lvl);
  }
  radiator(x, z, rot, lvl, w = 0.9) {
    this.fb(x, z, rot, lvl, [-w / 2, -0.05, w / 2, -0.02], 0.15, 0.7, 0xf4f2ee, { noCollide: true });
    for (let i = 0; i < Math.floor(w / 0.1); i++) this.fb(x, z, rot, lvl, [-w / 2 + 0.04 + i * 0.1, -0.05, -w / 2 + 0.04 + i * 0.1 + 0.015, 0.01], 0.15, 0.7, 0xdedbd2, { noCollide: true });
  }
  towelRail(x, z, rot, lvl) {
    this.fb(x, z, rot, lvl, [-0.25, -0.05, 0.25, -0.03], 0.3, 1.3, 0xf4f2ee, { noCollide: true });
    for (let i = 0; i < 5; i++) this.fb(x, z, rot, lvl, [-0.25, -0.07, 0.25, -0.04], 0.4 + i * 0.2, 0.43 + i * 0.2, 0xe4e1d8, { noCollide: true });
    this.fb(x, z, rot, lvl, [-0.22, -0.1, 0.22, -0.06], 0.7, 1.15, 0x3d6f8f, { noCollide: true });       // a towel
  }
  picture(x, y, z, rot, lvl, c) {
    const n = { noCollide: true };
    // a wooden frame with a cream mat and a small painted landscape: sky, far hills, a field, a sun
    this.fb(x, z, rot, lvl, [-0.32, -0.012, 0.32, 0.012], y, y + 0.46, 0x4a3a2a, n);
    this.fb(x, z, rot, lvl, [-0.3, 0.012, 0.3, 0.016], y + 0.02, y + 0.44, 0xece4d0, n);
    this.fb(x, z, rot, lvl, [-0.26, 0.016, 0.26, 0.019], y + 0.06, y + 0.4, c, n);
    this.fb(x, z, rot, lvl, [-0.26, 0.019, 0.26, 0.021], y + 0.06, y + 0.17, 0x6f8f5a, n);
    this.fb(x, z, rot, lvl, [-0.26, 0.019, -0.02, 0.021], y + 0.17, y + 0.22, 0x587a4c, n);
    this.fb(x, z, rot, lvl, [-0.08, 0.019, 0.26, 0.021], y + 0.17, y + 0.205, 0x7a9a68, n);
    this.fb(x, z, rot, lvl, [-0.26, 0.019, 0.26, 0.021], y + 0.06, y + 0.085, 0x4f7040, n);
    const [sx, sz] = this._pt(x, z, rot, 0.14, 0.02);
    this.hprism(this._axle(rot), sx, y + 0.33, sz, 0.035, 0.035, 0.003, 0xf4d27a, lvl, { seg: 10 });
  }
  lamp(x, z, lvl, y0, y1) {
    this.prism(x, z, 0.07, 0.07, y0, y0 + 0.06, 0x4a4036, lvl, { seg: 8 });
    this.prism(x, z, 0.014, 0.014, y0 + 0.06, y1 - 0.2, 0xb8aa8c, lvl, { seg: 5 });
    this.prism(x, z, 0.16, 0.1, y1 - 0.22, y1, 0xfff1cf, lvl, { seg: 10, mesher: this.lamps });
    this.lights.push({ x, z, y: y1 + lvl * LEVEL_H, lvl });
  }
  floorLamp(x, z, lvl) { this.prism(x, z, 0.14, 0.14, 0, 0.03, PAL.black, lvl, { seg: 10 }); this.prism(x, z, 0.015, 0.015, 0.03, 1.5, PAL.black, lvl, { seg: 5 }); this.prism(x, z, 0.24, 0.14, 1.4, 1.72, 0xfff1cf, lvl, { seg: 10, mesher: this.lamps }); this.lights.push({ x, z, y: 1.7 + lvl * LEVEL_H, lvl, pool: 1.3 }); }
  pendant(x, z, lvl, r = 0.2) {
    const cord = CEIL - 0.6;
    // ceiling rose, a braided cord, a shade built from three rings, a bulb glowing under it
    this.prism(x, z, 0.055, 0.045, CEIL - 0.025, CEIL, 0xf2ecde, lvl, { seg: 10 });
    this.prism(x, z, 0.009, 0.009, cord, CEIL - 0.025, PAL.black, lvl, { seg: 5 });
    this.prism(x, z, 0.03, 0.03, cord - 0.03, cord, PAL.steel, lvl, { seg: 8 });
    this.prism(x, z, r * 0.3, r * 0.55, cord - 0.1, cord - 0.03, 0xe4dccb, lvl, { seg: 14, noTop: true });
    this.prism(x, z, r * 0.55, r * 0.85, cord - 0.18, cord - 0.1, 0xefe8d8, lvl, { seg: 14, noTop: true });
    this.prism(x, z, r * 0.85, r * 1.05, cord - 0.25, cord - 0.18, 0xf6f0e2, lvl, { seg: 14, noTop: true });
    this.prism(x, z, r * 0.1, r * 0.34, cord - 0.255, cord - 0.18, 0xfff1cf, lvl, { seg: 8, mesher: this.lamps });
    this.lights.push({ x, z, y: cord - 0.24 + lvl * LEVEL_H, lvl, pool: 1.8 });
  }
  nightstand(x, z, rot, lvl) {
    if (this.model('ClassicNightstand_01', x, z, rot, lvl, { w: 0.46, d: 0.4, h: 0.56 }, { stretch: true, col: [-0.23, -0.2, 0.23, 0.2] })) return;
    this.fb(x, z, rot, lvl, [-0.23, -0.2, 0.23, 0.2], 0.05, 0.52, PAL.wood, { solid: true });
    this.fb(x, z, rot, lvl, [-0.2, 0.2, 0.2, 0.208], 0.12, 0.28, PAL.woodDark, { noCollide: true });
    this.fb(x, z, rot, lvl, [-0.2, 0.2, 0.2, 0.208], 0.3, 0.46, PAL.woodDark, { noCollide: true });
    this.lamp(x, z, lvl, 0.52, 0.8);
    this.top(x, z, rot, lvl, 0.12, 0.08, 0.1, 0.05, 0.52, 0.06, 0x30333a); this.top(x, z, rot, lvl, 0.12, 0.08, 0.06, 0.005, 0.54, 0.02, 0xd9302a);       // alarm clock
  }
  bed(x, z, rot, lvl, w = 1.6, l = 2.0) {
    this.fb(x, z, rot, lvl, [-w / 2, -l / 2, w / 2, l / 2], 0.1, 0.34, PAL.woodDark, { solid: true });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) this.fb(x, z, rot, lvl, [sx * (w / 2 - 0.06) - 0.03, sz * (l / 2 - 0.06) - 0.03, sx * (w / 2 - 0.06) + 0.03, sz * (l / 2 - 0.06) + 0.03], 0, 0.1, PAL.woodDark, { noCollide: true });
    this.fb(x, z, rot, lvl, [-w / 2 + 0.03, -l / 2 + 0.06, w / 2 - 0.03, l / 2 - 0.02], 0.34, 0.56, 0xf2efe8, { noCollide: true });
    this.fb(x, z, rot, lvl, [-w / 2 + 0.01, -0.35, w / 2 - 0.01, l / 2 - 0.0], 0.52, 0.64, this.fabric + 0x0a0a0a, { noCollide: true });
    this.fb(x, z, rot, lvl, [-w / 2 + 0.01, 0.35, w / 2 - 0.01, 0.55], 0.62, 0.66, 0xf4f1e8, { noCollide: true });       // turned-down sheet
    this.fb(x, z, rot, lvl, [-w / 2 - 0.02, -l / 2 - 0.1, w / 2 + 0.02, -l / 2 + 0.05], 0.1, 1.15, 0x6a5a48, { noCollide: false });
    this.fb(x, z, rot, lvl, [-w / 2 + 0.05, -l / 2 + 0.05, w / 2 - 0.05, -l / 2 + 0.1], 0.6, 1.05, this.fabric - 0x101010 > 0 ? this.fabric - 0x101010 : this.fabric, { noCollide: true });
    const n = w > 1.2 ? 2 : 1;
    for (let i = 0; i < n; i++) { const cx = (i - (n - 1) / 2) * w * 0.45; this.fb(x, z, rot, lvl, [cx - 0.27, -l / 2 + 0.12, cx + 0.27, -l / 2 + 0.52], 0.62, 0.74, 0xfaf8f2, { noCollide: true }); }
  }
  wardrobe(x, z, rot, lvl, w = 1.6) {
    this.fb(x, z, rot, lvl, [-w / 2, -0.3, w / 2, 0.3], 0, 2.2, 0xd8d0c0, { solid: true });
    const n = Math.max(2, Math.round(w / 0.6));
    for (let i = 1; i < n; i++) this.fb(x, z, rot, lvl, [-w / 2 + i * w / n - 0.008, 0.3, -w / 2 + i * w / n + 0.008, 0.312], 0.03, 2.17, 0x8f8878, { noCollide: true });
    for (let i = 0; i < n; i++) { const cx = -w / 2 + (i + (i % 2 ? 0.12 : 0.88)) * w / n; this.fb(x, z, rot, lvl, [cx - 0.015, 0.312, cx + 0.015, 0.34], 0.95, 1.25, PAL.steel, { noCollide: true }); }
  }
  dresser(x, z, rot, lvl, w = 1.0) {
    this.fb(x, z, rot, lvl, [-w / 2, -0.25, w / 2, 0.25], 0, 0.9, PAL.wood, { solid: true });
    for (let i = 0; i < 3; i++) { this.fb(x, z, rot, lvl, [-w / 2 + 0.03, 0.25, w / 2 - 0.03, 0.258], 0.06 + i * 0.28, 0.3 + i * 0.28, 0x7a5030, { noCollide: true }); this.fb(x, z, rot, lvl, [-0.06, 0.258, 0.06, 0.28], 0.17 + i * 0.28, 0.2 + i * 0.28, PAL.steel, { noCollide: true }); }
  }
  desk(x, z, rot, lvl, w = 1.2) {
    this.collide(x, z, rot, lvl, [-w / 2, -0.32, w / 2, 0.32]);
    const n = { noCollide: true }, steel = 0x8d9298;
    // a laminate top with an edge band, steel tube legs and rails, a drawer pedestal with three drawers
    this.fb(x, z, rot, lvl, [-w / 2, -0.32, w / 2, 0.32], 0.725, 0.75, 0xe0d6c0, n);
    this.fb(x, z, rot, lvl, [-w / 2 - 0.004, 0.318, w / 2 + 0.004, 0.328], 0.72, 0.752, 0xb8ab90, n);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) this.fp(x, z, rot, lvl, sx * (w / 2 - 0.04), sz * 0.28, 0.017, 0.017, 0, 0.725, steel, { seg: 6 });
    for (const sz of [-1, 1]) this.fb(x, z, rot, lvl, [-w / 2 + 0.04, sz * 0.28 - 0.012, w / 2 - 0.04, sz * 0.28 + 0.012], 0.66, 0.725, steel, n);
    this.fb(x, z, rot, lvl, [-w / 2 + 0.04, -0.285, w / 2 - 0.04, -0.27], 0.35, 0.72, 0xcfc6b0, n);     // modesty panel
    const px0 = w / 2 - 0.44, px1 = w / 2 - 0.05;
    this.fb(x, z, rot, lvl, [px0, -0.27, px1, 0.29], 0.09, 0.725, 0xd8d3c6, n);
    for (let i = 0; i < 3; i++) {
      const y0 = 0.1 + i * 0.2;
      this.fb(x, z, rot, lvl, [px0 + 0.01, 0.29, px1 - 0.01, 0.3], y0, y0 + 0.19, 0xe9e5da, n);
      this.fb(x, z, rot, lvl, [(px0 + px1) / 2 - 0.06, 0.3, (px0 + px1) / 2 + 0.06, 0.318], y0 + 0.14, y0 + 0.155, steel, n);
    }
    this.prism(...this._pt(x, z, rot, -w / 2 + 0.16, -0.15), 0.03, 0.03, 0.75, 0.752, 0x2a2c30, lvl, { seg: 8 });   // cable grommet
    this.laptop(x, z, rot, lvl, 0, 0, 0.75); this.mug(x, z, rot, lvl, 0.38, 0.08, 0.75, 0xc94a3a);
    // a desk lamp: round base, jointed arm, cone shade
    this.fp(x, z, rot, lvl, -0.45, -0.15, 0.07, 0.06, 0.75, 0.765, PAL.black, { seg: 10 });
    this.fb(x, z, rot, lvl, [-0.46, -0.16, -0.44, -0.14], 0.765, 1.02, PAL.black, n);
    this.fb(x, z, rot, lvl, [-0.46, -0.16, -0.32, -0.14], 1.0, 1.02, PAL.black, n);
    this.fp(x, z, rot, lvl, -0.32, -0.15, 0.08, 0.035, 0.94, 1.0, 0xd0c8b0, { seg: 10 });
  }
  slippers(x, z, lvl) { this.fb(x, z, 0, lvl, [-0.2, -0.05, -0.1, 0.12], 0.0, 0.07, 0xa04a3a, { noCollide: true }); this.fb(x, z, 0, lvl, [0.0, -0.05, 0.1, 0.12], 0.0, 0.07, 0xa04a3a, { noCollide: true }); }

  // ------------------------------------------------------------------ kitchen
  kitchenRun(x0, z, x1, rot, lvl, o = {}) {      // base cabinets + worktop from x0..x1 along a wall, front toward +z (rot 0)
    const w = x1 - x0, cx = (x0 + x1) / 2;
    this.fb(cx, z, rot, lvl, [-w / 2, -0.3, w / 2, 0.3], 0.1, 0.88, 0x82a07f, { solid: true });
    this.fb(cx, z, rot, lvl, [-w / 2, -0.27, w / 2, 0.28], 0, 0.1, 0x3a3a38, { noCollide: true });
    this.fb(cx, z, rot, lvl, [-w / 2 - 0.01, -0.31, w / 2 + 0.01, 0.33], 0.88, 0.92, 0x8a5a36, { noCollide: true });
    const n = Math.round(w / 0.6);
    for (let i = 1; i < n; i++) this.fb(cx, z, rot, lvl, [-w / 2 + i * 0.6 - 0.005, 0.3, -w / 2 + i * 0.6 + 0.005, 0.312], 0.12, 0.86, 0x9c968a, { noCollide: true });
    for (let i = 0; i < n; i++) this.fb(cx, z, rot, lvl, [-w / 2 + i * 0.6 + 0.4, 0.312, -w / 2 + i * 0.6 + 0.45, 0.33], 0.62, 0.8, PAL.steel, { noCollide: true });
    // wall cabinets
    const wc = o.wall ?? w - 0.8;
    if (wc > 0.5) {
      this.fb(cx - (w - wc) / 2, z, rot, lvl, [-wc / 2, -0.3, wc / 2, -0.03], 1.45, 2.15, 0xe9e0c6, { noCollide: true });
      const m = Math.round(wc / 0.6);
      for (let i = 1; i < m; i++) this.fb(cx - (w - wc) / 2, z, rot, lvl, [-wc / 2 + i * wc / m - 0.005, -0.03, -wc / 2 + i * wc / m + 0.005, -0.02], 1.47, 2.13, 0x9c968a, { noCollide: true });
    }
  }
  fridge(x, z, rot, lvl) {
    this.fb(x, z, rot, lvl, [-0.3, -0.32, 0.3, 0.32], 0.02, 1.85, 0xdfe9e4, { solid: true });
    this.fb(x, z, rot, lvl, [-0.3, 0.32, 0.3, 0.325], 1.2, 1.2 + 0.005, 0x8a8a88, { noCollide: true });       // door seam
    this.fb(x, z, rot, lvl, [0.22, 0.325, 0.255, 0.36], 1.28, 1.7, PAL.steel, { noCollide: true });
    this.fb(x, z, rot, lvl, [0.22, 0.325, 0.255, 0.36], 0.55, 1.1, PAL.steel, { noCollide: true });
    this.top(x, z, rot, lvl, -0.1, 0.33, 0.1, 0.01, 1.5, 0.08, 0xd9482b);   // magnets
  }
  oven(x, z, rot, lvl) {       // freestanding oven + hob, 0.6 wide, replaces a cabinet
    this.fb(x, z, rot, lvl, [-0.3, -0.3, 0.3, 0.3], 0, 0.9, 0xd8d8d4, { solid: true });
    this.fb(x, z, rot, lvl, [-0.26, 0.3, 0.26, 0.312], 0.08, 0.62, 0x222428, { noCollide: true });
    this.fb(x, z, rot, lvl, [-0.22, 0.312, 0.22, 0.34], 0.64, 0.68, PAL.steel, { noCollide: true });
    this.fb(x, z, rot, lvl, [-0.24, 0.3, 0.24, 0.31], 0.7, 0.86, 0x111214, { noCollide: true });
    for (let i = 0; i < 4; i++) this.fp(x, z, rot, lvl, -0.18 + i * 0.12, 0.31, 0.02, 0.02, 0.76, 0.8, PAL.black, { seg: 6 });
    for (const [a, b] of [[-0.14, -0.12], [0.14, -0.12], [-0.14, 0.1], [0.14, 0.1]]) this.fp(x, z, rot, lvl, a, b, 0.075, 0.075, 0.9, 0.915, PAL.black, { seg: 10 });
    this.fb(x, z, rot, lvl, [-0.3, -0.31, 0.3, -0.1], 1.5, 1.6, 0xb9bcc0, { noCollide: true });          // extractor hood
    this.fb(x, z, rot, lvl, [-0.12, -0.31, 0.12, -0.2], 1.6, 2.15, 0xb9bcc0, { noCollide: true });
  }
  sinkUnit(x, z, rot, lvl) {
    this.fb(x, z, rot, lvl, [-0.3, -0.2, 0.3, 0.2], 0.89, 0.93, PAL.steel, { noCollide: true });
    this.fb(x, z, rot, lvl, [-0.25, -0.15, -0.02, 0.15], 0.9, 0.92, 0x7f8388, { noCollide: true });
    this.fb(x, z, rot, lvl, [0.02, -0.15, 0.25, 0.15], 0.9, 0.92, 0x7f8388, { noCollide: true });
    this.fp(x, z, rot, lvl, 0, -0.22, 0.018, 0.018, 0.93, 1.12, PAL.steel, { seg: 6 });
    this.fb(x, z, rot, lvl, [-0.015, -0.22, 0.015, -0.1], 1.1, 1.13, PAL.steel, { noCollide: true });
    this.fb(x, z, rot, lvl, [0.34, -0.18, 0.62, 0.15], 0.93, 0.95, 0xd8d4c8, { noCollide: true });          // drying rack
    for (let i = 0; i < 4; i++) this.plate(x, z, rot, lvl, 0.36 + i * 0.06, 0.0, 0.95);
    this.fp(x, z, rot, lvl, -0.4, -0.15, 0.035, 0.035, 0.93, 1.07, 0x4ea36a, { seg: 8 });                   // soap
  }
  coffeeMachine(x, z, rot, lvl, lx, lz, y) {       // capsule machine with a cup
    this.fb(x, z, rot, lvl, [lx - 0.1, lz - 0.2, lx + 0.1, lz - 0.1], y, y + 0.3, 0x2a2b30, { noCollide: true });
    this.fb(x, z, rot, lvl, [lx - 0.1, lz - 0.2, lx + 0.1, lz + 0.02], y + 0.22, y + 0.32, 0x2a2b30, { noCollide: true });
    this.fb(x, z, rot, lvl, [lx - 0.09, lz - 0.09, lx + 0.09, lz + 0.1], y, y + 0.03, 0x1c1d20, { noCollide: true });
    this.fb(x, z, rot, lvl, [lx - 0.09, lz - 0.2, lx - 0.03, lz - 0.1], y + 0.06, y + 0.2, 0xd9302a, { noCollide: true });
    this.fb(x, z, rot, lvl, [lx + 0.03, lz - 0.2, lx + 0.09, lz - 0.1], y + 0.05, y + 0.3, 0x9aa3ab, { noCollide: true });
    this.mug(x, z, rot, lvl, lx, lz + 0.03, y + 0.03, 0xf4f1e6);
  }
  kettle(x, z, rot, lvl, lx, lz, y) {
    const n = { noCollide: true }, steel = 0xc9d0d6;
    // a power base, a body that narrows to the shoulder, a lid with a knob, a spout and a handle
    this.fp(x, z, rot, lvl, lx, lz, 0.1, 0.1, y, y + 0.015, PAL.black, { seg: 14 });
    this.fp(x, z, rot, lvl, lx, lz, 0.088, 0.072, y + 0.015, y + 0.17, steel, { seg: 14 });
    this.fp(x, z, rot, lvl, lx, lz, 0.072, 0.05, y + 0.17, y + 0.19, steel, { seg: 14 });
    this.fp(x, z, rot, lvl, lx, lz, 0.05, 0.045, y + 0.19, y + 0.205, PAL.black, { seg: 12 });
    this.fp(x, z, rot, lvl, lx, lz, 0.014, 0.014, y + 0.205, y + 0.225, PAL.black, { seg: 6 });
    this.fb(x, z, rot, lvl, [lx - 0.025, lz - 0.115, lx + 0.025, lz - 0.065], y + 0.15, y + 0.185, steel, n);     // spout
    this.fb(x, z, rot, lvl, [lx + 0.085, lz - 0.014, lx + 0.1, lz + 0.014], y + 0.03, y + 0.18, PAL.black, n);     // handle
    this.fb(x, z, rot, lvl, [lx + 0.06, lz - 0.014, lx + 0.1, lz + 0.014], y + 0.165, y + 0.18, PAL.black, n);
    this.fb(x, z, rot, lvl, [lx + 0.07, lz - 0.014, lx + 0.1, lz + 0.014], y + 0.03, y + 0.043, PAL.black, n);
    this.fb(x, z, rot, lvl, [lx - 0.075, lz + 0.065, lx - 0.045, lz + 0.075], y + 0.07, y + 0.15, 0x7fb4d8, n);     // water gauge
  }
  toaster(x, z, rot, lvl, lx, lz, y) { this.top(x, z, rot, lvl, lx, lz, 0.28, 0.17, y, 0.18, 0xc9ccd0); this.top(x, z, rot, lvl, lx - 0.06, lz, 0.1, 0.14, y + 0.18, 0.005, 0x1a1a1a); this.top(x, z, rot, lvl, lx + 0.06, lz, 0.1, 0.14, y + 0.18, 0.005, 0x1a1a1a); }
  microwave(x, z, rot, lvl, lx, lz, y) {
    const n = { noCollide: true };
    // feet, a shell, a vented top, a dark glass door with a frame and a steel handle, a control panel with a display, buttons and a dial
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) this.top(x, z, rot, lvl, lx + sx * 0.2, lz + sz * 0.13, 0.03, 0.03, y, 0.012, 0x3a3a3c);
    this.top(x, z, rot, lvl, lx, lz, 0.46, 0.32, y + 0.012, 0.268, 0xdedcd6);
    for (let i = 0; i < 6; i++) this.top(x, z, rot, lvl, lx - 0.15 + i * 0.06, lz - 0.05, 0.04, 0.003, y + 0.28, 0.002, 0x6a6c70);
    const f = lz + 0.16;
    this.fb(x, z, rot, lvl, [lx - 0.215, f, lx + 0.045, f + 0.008], y + 0.025, y + 0.265, 0xc9c8c2, n);           // door frame
    this.fb(x, z, rot, lvl, [lx - 0.195, f + 0.008, lx + 0.025, f + 0.012], y + 0.045, y + 0.245, 0x15191e, n);    // glass
    this.fb(x, z, rot, lvl, [lx - 0.17, f + 0.012, lx - 0.15, f + 0.014], y + 0.1, y + 0.23, 0x2d3640, n);          // reflection
    this.fb(x, z, rot, lvl, [lx + 0.03, f + 0.008, lx + 0.038, f + 0.03], y + 0.05, y + 0.24, PAL.steel, n);       // handle
    this.fb(x, z, rot, lvl, [lx + 0.06, f, lx + 0.215, f + 0.006], y + 0.025, y + 0.265, 0xcfcdc7, n);            // panel
    this.fb(x, z, rot, lvl, [lx + 0.075, f + 0.006, lx + 0.2, f + 0.01], y + 0.2, y + 0.24, 0x10281b, n);         // display
    this.fb(x, z, rot, lvl, [lx + 0.085, f + 0.01, lx + 0.14, f + 0.012], y + 0.212, y + 0.228, 0x39d98a, n);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) this.fb(x, z, rot, lvl, [lx + 0.08 + c * 0.04, f + 0.006, lx + 0.108 + c * 0.04, f + 0.016], y + 0.16 - r * 0.026, y + 0.178 - r * 0.026, 0x8a8e92, n);
    this.fp(x, z, rot, lvl, lx + 0.14, f + 0.01, 0.026, 0.026, y + 0.045, y + 0.075, 0x4a4c50, { seg: 10 });
  }
  bin(x, z, lvl) { this.prism(x, z, 0.15, 0.17, 0, 0.55, 0x8a8f94, lvl, { seg: 10, solid: true }); this.prism(x, z, 0.175, 0.175, 0.55, 0.58, 0x3a3d40, lvl, { seg: 10 }); }
  breadBin(x, z, rot, lvl, lx, lz, y) { this.top(x, z, rot, lvl, lx, lz, 0.36, 0.2, y, 0.17, 0xb8794a); this.top(x, z, rot, lvl, lx, lz + 0.101, 0.3, 0.005, y + 0.06, 0.07, 0xe9e0c8); }
  knifeBlock(x, z, rot, lvl, lx, lz, y) { this.top(x, z, rot, lvl, lx, lz, 0.1, 0.14, y, 0.22, 0x5a3a24); for (const dx of [-0.03, 0, 0.03]) this.top(x, z, rot, lvl, lx + dx, lz - 0.02, 0.012, 0.03, y + 0.22, 0.05, PAL.black); }

  // ------------------------------------------------------------------ bathroom
  bathtub(x, z, rot, lvl, l = 1.7) {
    this.fb(x, z, rot, lvl, [-l / 2, -0.37, l / 2, 0.37], 0, 0.58, PAL.white, { solid: true });
    this.fb(x, z, rot, lvl, [-l / 2 + 0.07, -0.3, l / 2 - 0.07, 0.3], 0.5, 0.585, 0xc6d3da, { noCollide: true });
    this.fp(x, z, rot, lvl, -l / 2 + 0.08, 0, 0.02, 0.02, 0.58, 0.72, PAL.steel, { seg: 6 });
    this.fb(x, z, rot, lvl, [-l / 2 + 0.06, -0.015, -l / 2 + 0.2, 0.015], 0.7, 0.73, PAL.steel, { noCollide: true });
    this.fb(x, z, rot, lvl, [-l / 2 + 0.01, -0.37, -l / 2 + 0.04, 0.37], 0.58, 0.64, PAL.steel, { noCollide: true });
    // wall mixer with a shower head on a rail, and a glass screen over half of the bath
    this.fb(x, z, rot, lvl, [-l / 2 + 0.03, -0.32, -l / 2 + 0.05, -0.30], 0.9, 1.95, PAL.steel, { noCollide: true });
    this.fp(x, z, rot, lvl, -l / 2 + 0.07, -0.3, 0.06, 0.05, 1.75, 1.82, PAL.steel, { seg: 10 });
    const [a, b, c2, d] = this._rot([-l / 2, 0.36, -l / 2 + 0.8, 0.38], rot, x, z);
    this.box(a, 0.58, b, c2, 1.85, d, 0xffffff, lvl, { mesher: this.glass, noCollide: true });
    const [a2, b2, c3, d2] = this._rot([-l / 2 + 0.78, 0.35, -l / 2 + 0.82, 0.39], rot, x, z);
    this.box(a2, 0.58, b2, c3, 1.85, d2, PAL.steel, lvl, { noCollide: true });
  }
  shower(x, z, rot, lvl) {         // 0.9 m cabin in a corner: tray, glass, rail, head, mixer
    this.fb(x, z, rot, lvl, [-0.45, -0.45, 0.45, 0.45], 0, 0.07, PAL.white, { solid: true });
    this.fb(x, z, rot, lvl, [-0.4, -0.4, 0.4, 0.4], 0.07, 0.075, 0xc6d3da, { noCollide: true });
    for (const [a, b, c2, d] of [[-0.45, 0.43, 0.45, 0.45], [0.43, -0.45, 0.45, 0.45]]) {
      const [p, q, r, s] = this._rot([a, b, c2, d], rot, x, z);
      this.box(p, 0.07, q, r, 2.0, s, 0xffffff, lvl, { mesher: this.glass, noCollide: true });
    }
    this.fp(x, z, rot, lvl, -0.4, -0.4, 0.015, 0.015, 0.9, 1.95, PAL.steel, { seg: 6 });
    this.fp(x, z, rot, lvl, -0.3, -0.4, 0.09, 0.09, 1.95, 1.99, PAL.steel, { seg: 12 });
    this.fb(x, z, rot, lvl, [-0.4, -0.41, -0.2, -0.38], 1.0, 1.05, PAL.steel, { noCollide: true });
  }
  toilet(x, z, rot, lvl) {         // facing +z in local coordinates, cistern at the back
    this.toilets.push({ x, z, lvl });
    this.fb(x, z, rot, lvl, [-0.19, -0.1, 0.19, 0.26], 0, 0.4, PAL.white, { solid: true });
    this.fp(x, z, rot, lvl, 0, 0.12, 0.2, 0.2, 0.3, 0.42, PAL.white, { seg: 12 });
    this.fp(x, z, rot, lvl, 0, 0.13, 0.17, 0.17, 0.42, 0.44, 0xe9e6dc, { seg: 12 });
    this.fb(x, z, rot, lvl, [-0.2, -0.3, 0.2, -0.1], 0.0, 0.82, PAL.white, { solid: true });
    this.fb(x, z, rot, lvl, [-0.19, -0.29, 0.19, -0.11], 0.82, 0.86, 0xe9e6dc, { noCollide: true });
    this.fp(x, z, rot, lvl, 0, -0.2, 0.025, 0.025, 0.86, 0.89, PAL.steel, { seg: 8 });
    this.fp(x, z, rot, lvl, 0.33, -0.1, 0.06, 0.06, 0.6, 0.72, 0xf3f1ea, { seg: 8 });                   // paper roll
    this.fb(x, z, rot, lvl, [0.26, -0.11, 0.3, -0.09], 0.62, 0.72, PAL.steel, { noCollide: true });
    this.fp(x, z, rot, lvl, -0.28, -0.15, 0.1, 0.11, 0, 0.35, 0x8a8f94, { seg: 8 });                      // brush
  }
  washbasin(x, z, rot, lvl) {      // vanity with a basin, tap, mirror cabinet and a glass with toothbrushes
    this.fb(x, z, rot, lvl, [-0.35, -0.24, 0.35, 0.24], 0.0, 0.84, 0xe8e4da, { solid: true });
    this.fb(x, z, rot, lvl, [-0.36, -0.25, 0.36, 0.25], 0.84, 0.88, PAL.white, { noCollide: true });
    this.fb(x, z, rot, lvl, [-0.2, -0.15, 0.2, 0.15], 0.875, 0.885, 0xd0dde4, { noCollide: true });
    this.fp(x, z, rot, lvl, 0, -0.2, 0.015, 0.015, 0.88, 1.0, PAL.steel, { seg: 6 });
    this.fb(x, z, rot, lvl, [-0.012, -0.2, 0.012, -0.1], 0.99, 1.01, PAL.steel, { noCollide: true });
    this.fb(x, z, rot, lvl, [-0.36, -0.27, 0.36, -0.22], 1.05, 1.95, 0xf0ede4, { noCollide: true });
    this.fb(x, z, rot, lvl, [-0.33, -0.22, 0.33, -0.215], 1.1, 1.9, 0xb9d3e0, { noCollide: true });
    { const [mx, mz] = this._pt(x, z, rot, 0, -0.211); this.mirrors.push({ x: mx, y: 1.5, z: mz, yaw: this._yaw(rot), lvl, w: 0.66, h: 0.8 }); }
    this.fb(x, z, rot, lvl, [-0.38, -0.225, 0.38, -0.2], 1.93, 1.97, 0xfff1cf, { mesher: this.lamps, noCollide: true });
    this.fp(x, z, rot, lvl, 0.26, -0.1, 0.03, 0.03, 0.88, 0.98, 0xd7e3ea, { seg: 8 });
    this.fb(x, z, rot, lvl, [0.25, -0.11, 0.265, -0.09], 0.98, 1.08, 0x2f9a6a, { noCollide: true });
    this.fb(x, z, rot, lvl, [-0.3, 0.1, -0.1, 0.24], 0.88, 0.93, 0xeee0c8, { noCollide: true });         // soap & towel
  }
  washer(x, z, rot, lvl) {
    this.fb(x, z, rot, lvl, [-0.3, -0.3, 0.3, 0.3], 0, 0.85, PAL.white, { solid: true });
    this.fp(x, z, rot, lvl, 0, 0.3, 0.19, 0.19, 0.2, 0.2 + 0.0, 0x3a4a5c, { seg: 14, noTop: true });
    this.fb(x, z, rot, lvl, [-0.14, 0.3, 0.14, 0.312], 0.32, 0.62, 0x2d3d52, { noCollide: true });
    this.fb(x, z, rot, lvl, [-0.28, 0.3, 0.28, 0.31], 0.72, 0.82, 0xdadad4, { noCollide: true });
    this.fp(x, z, rot, lvl, 0.18, 0.31, 0.025, 0.025, 0.74, 0.8, 0x404040, { seg: 8 });
  }
  boiler(x, z, lvl) { this.prism(x, z, 0.22, 0.22, 0, 1.5, 0xe9e9e4, lvl, { solid: true, seg: 12 }); this.prism(x, z, 0.1, 0.1, 1.5, 1.6, 0xc9ccd0, lvl, { seg: 8 }); }
  ironingBoard(x, z, rot, lvl) { this.fb(x, z, rot, lvl, [-0.2, -0.65, 0.2, 0.0], 0.0, 1.0, 0x6a8fb0, { noCollide: true }); }

  // ------------------------------------------------------------------ hall
  coatRack(x, z, rot, lvl) {
    this.fb(x, z, rot, lvl, [-0.6, -0.02, 0.6, 0.02], 1.6, 1.68, PAL.wood, { noCollide: true });
    for (let i = 0; i < 4; i++) this.fb(x, z, rot, lvl, [-0.45 + i * 0.3 - 0.015, 0.02, -0.45 + i * 0.3 + 0.015, 0.1], 1.58, 1.62, PAL.steel, { noCollide: true });
    this.fb(x, z, rot, lvl, [-0.52, 0.03, -0.3, 0.12], 0.75, 1.58, 0x3a4a6a, { noCollide: true });     // jacket
    this.fb(x, z, rot, lvl, [-0.08, 0.03, 0.12, 0.1], 0.95, 1.58, 0x8a5a3a, { noCollide: true });
    this.fb(x, z, rot, lvl, [0.22, 0.03, 0.46, 0.12], 0.8, 1.58, 0x4a5a3a, { noCollide: true });
  }
  shoeRack(x, z, rot, lvl) {
    this.fb(x, z, rot, lvl, [-0.4, -0.11, 0.4, 0.11], 0, 0.45, PAL.woodDark, { solid: true });
    for (let r = 0; r < 3; r++) for (let i = 0; i < 2; i++) this.fb(x, z, rot, lvl, [-0.3 + i * 0.35, -0.05, -0.12 + i * 0.35, 0.11], 0.03 + r * 0.14, 0.1 + r * 0.14, i ? 0x2a2a2a : 0x7a4a2a, { noCollide: true });
  }
  doormat(x, z, rot, lvl) { this.fb(x, z, rot, lvl, [-0.4, -0.25, 0.4, 0.25], 0.002, 0.02, 0x5a4a3a, { noCollide: true }); }
  console(x, z, rot, lvl) {
    this.fb(x, z, rot, lvl, [-0.5, -0.15, 0.5, 0.15], 0.72, 0.76, PAL.wood, { solid: true });
    for (const sx of [-1, 1]) this.fb(x, z, rot, lvl, [sx * 0.45 - 0.025, -0.12, sx * 0.45 + 0.025, 0.12], 0, 0.72, PAL.woodDark);
    this.bowl(x, z, rot, lvl, -0.25, 0, 0.76, false);
    this.fb(x, z, rot, lvl, [0.15, -0.05, 0.4, 0.1], 0.76, 0.8, 0x6a4a3a, { noCollide: true });
  }

  // ------------------------------------------------------------------ fireplace, stairs, curtains
  fireplace(x, z, rot, lvl) {
    this.fb(x, z, rot, lvl, [-0.9, -0.3, 0.9, 0.3], 0, 1.25, 0xb8ae98, { solid: true });
    this.fb(x, z, rot, lvl, [-0.5, 0.29, 0.5, 0.31], 0.1, 0.9, PAL.black, { noCollide: true });
    this.fb(x, z, rot, lvl, [-0.4, 0.15, 0.4, 0.3], 0.1, 0.16, 0x3a3a3a, { noCollide: true });
    for (const [a, b] of [[-0.2, 0.05], [0.0, 0.1], [0.18, 0.0]]) this.fp(x, z, rot, lvl, a, 0.2 + b, 0.05, 0.05, 0.16, 0.26, 0x6a4326, { seg: 6 });
    this.fb(x, z, rot, lvl, [-1.0, -0.35, 1.0, 0.35], 1.25, 1.32, PAL.woodDark, { noCollide: true });
    this.fb(x, z, rot, lvl, [-0.6, -0.3, 0.6, -0.1], 1.32, CEIL, 0xb8ae98, { noCollide: true });
    this.clockOnWall(x, 1.5, 0.31, rot, lvl);
  }
  stairsRun(x0, z0, steps, rise, run, lvl, c = PAL.wood) {   // rising toward +x
    for (let i = 0; i < steps; i++) this.box(x0 + i * run, 0, z0, x0 + (i + 1) * run, rise * (i + 1), z0 + 0.95, c, lvl);
    this.box(x0, 0.9, z0 - 0.03, x0 + steps * run, 0.94, z0, PAL.woodDark, lvl, { noCollide: true });          // handrail
    this.colliders.push({ x0, z0: z0 - 0.04, x1: x0 + steps * run, z1: z0 + 0.04, lvl }, { x0, z0: z0 + 0.91, x1: x0 + steps * run, z1: z0 + 1.0, lvl });
  }
  _curtains() {
    const cx = this.size.x / 2, cz = this.size.z / 2;
    for (const w of this._windows || []) {
      if (w.b - w.a < 1.15 || w.sill > 1.0) continue;
      const side = w.ax === 'x' ? Math.sign(cz - w.at) : Math.sign(cx - w.at);
      const o0 = side * 0.2, o1 = side * 0.27, lo = Math.min(o0, o1), hi = Math.max(o0, o1);
      const c = this.fabric + 0x1a1410;      // curtains hang in cloth
      const put = (u0, u1) => {
        if (w.ax === 'x') this.box(u0, 0.08, w.at + lo, u1, 2.4, w.at + hi, c, w.lvl, { noCollide: true });
        else this.box(w.at + lo, 0.08, u0, w.at + hi, 2.4, u1, c, w.lvl, { noCollide: true });
      };
      put(w.a - 0.3, w.a + 0.12); put(w.b - 0.12, w.b + 0.3);
      if (w.ax === 'x') this.box(w.a - 0.35, 2.4, w.at + lo - 0.01, w.b + 0.35, 2.45, w.at + hi + 0.01, PAL.black, w.lvl, { noCollide: true });
      else this.box(w.at + lo - 0.01, 2.4, w.a - 0.35, w.at + hi + 0.01, 2.45, w.b + 0.35, PAL.black, w.lvl, { noCollide: true });
    }
  }
  _doorLeaf(ax, at, a, b, lvl) {
    const t = 0.04, c = 0xf0ece2;
    if (ax === 'x') { this.box(a, 0, at + 0.07, a + t, 2.05, at + 0.07 + (b - a) * 0.96, c, lvl, { noCollide: true }); this.box(a - 0.01, 0.98, at + 0.07 + (b - a) * 0.9, a + t + 0.01, 1.02, at + 0.07 + (b - a) * 0.96, PAL.steel, lvl, { noCollide: true }); }
    else { this.box(at + 0.07, 0, a, at + 0.07 + (b - a) * 0.96, 2.05, a + t, c, lvl, { noCollide: true }); this.box(at + 0.07 + (b - a) * 0.9, 0.98, a - 0.01, at + 0.07 + (b - a) * 0.96, 1.02, a + t + 0.01, PAL.steel, lvl, { noCollide: true }); }
  }
  _fixtures() {
    // smoke detectors and thermostats: the small things that make a flat look lived in
    for (const r of this.rooms) {
      if (r.name === 'Séjour' || r.name === 'Chambre' || r.name === 'Palier') this.prism((r.x0 + r.x1) / 2 + 0.7, (r.z0 + r.z1) / 2 + 0.5, 0.06, 0.05, CEIL - 0.04, CEIL, 0xf4f4f0, r.lvl, { seg: 8 });
    }
  }

  // ------------------------------------------------------------------ the layouts
  _apartment() {
    const W = this.wallCol, ext = { th: 0.3, cA: 0xd9d1c0, cB: W };
    const X1 = 5.0, X2 = 7.4, X3 = 9.6, Z1 = 3.2, Z2 = 4.4, Z3 = 7.2;
    const win = (a, b, o = {}) => ({ a, b, kind: 'window', ...o });
    this.size = { x: X3, z: Z3 };
    // rotations: 0 = front toward +z (south), 1 = toward -x (west), 2 = toward -z (north), 3 = toward +x (east)
    this.wall('x', 0, 0, X3, { ...ext, openings: [win(0.7, 1.9), win(3.0, 4.2), win(6.6, 8.0, { sill: 1.1 })] });
    this.wall('x', Z3, 0, X3, { ...ext, cA: W, cB: 0xd9d1c0, openings: [win(1.4, 3.0), win(5.7, 6.5, { sill: 1.3, head: 2.0 })] });
    this.wall('z', 0, 0, Z3, { ...ext, openings: [win(1.4, 2.8), win(5.2, 6.4)] });
    this.wall('z', X3, 0, Z3, { ...ext, cA: W, cB: 0xd9d1c0, openings: [win(0.8, 2.2, { sill: 1.1 }), { a: 3.4, b: 4.2, kind: 'front' }] });
    this.frontDoor('z', X3, 3.4, 4.2);
    this.wall('z', X1, 0, Z1, { openings: [{ a: 1.2, b: 2.4, kind: 'arch' }], cB: 0xe3e6dc });
    this.wall('z', X1, Z1, Z2, { openings: [{ a: 3.35, b: 4.35, kind: 'arch' }] });
    this.wall('x', Z1, X1, X3, { openings: [{ a: 5.55, b: 6.55, kind: 'door' }], cA: 0xe3e6dc });
    this.wall('x', Z2, 0, X1, { openings: [{ a: 3.6, b: 4.5, kind: 'door' }], cB: 0xb6c3d2 });
    this.wall('x', Z2, X1, X3, { openings: [{ a: 5.6, b: 6.5, kind: 'door' }, { a: 7.9, b: 8.7, kind: 'door' }], cB: 0x9fc7cf });
    this.wall('z', X1, Z2, Z3, { cA: 0xb6c3d2, cB: 0x9fc7cf });
    this.wall('z', X2, Z2, Z3, { openings: [{ a: 5.85, b: 6.75, kind: 'door' }], cA: 0x9fc7cf, cB: 0xb9cfa8 });
    this.wall('x', 5.6, X2, X3, { cA: 0xb9cfa8, cB: 0x9fc7cf });
    this.room('Séjour', 0, 0, X1, Z2, 'parquet', 0, { beams: 'z' });
    this.room('Cuisine', X1, 0, X3, Z1, 'tile');
    this.room('Entrée', X1, Z1, X3, Z2, 'parquet');
    this.room('Chambre', 0, Z2, X1, Z3, 'parquet', 0, { beams: 'z' });
    this.room('Salle de bains', X1, Z2, X2, Z3, 'tile');
    this.room('WC', X2, Z2, X3, 5.6, 'tile');
    this.room('Buanderie', X2, 5.6, X3, Z3, 'tile');

    // --- séjour : salon at the south, dining at the middle, TV on the north wall between the windows
    this.rug(0.7, 2.25, 3.1, 3.75, 0, 0xa8553f);
    this.sofa(1.9, 3.95, 2, 0, 2.1);
    // Keep a clear walking gap between this low table and the sofa behind it.
    this.fb(1.9, 2.55, 0, 0, [-0.5, -0.28, 0.5, 0.28], 0.38, 0.42, PAL.woodDark, { solid: true });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) this.fb(1.9, 2.55, 0, 0, [sx * 0.44 - 0.025, sz * 0.22 - 0.025, sx * 0.44 + 0.025, sz * 0.22 + 0.025], 0, 0.38, PAL.woodDark);
    this.books(1.9, 2.55, 0, 0, -0.2, 0, 0.42); this.mug(1.9, 2.55, 0, 0, 0.2, 0.05, 0.42, 0xc94a3a); this.top(1.9, 2.55, 0, 0, 0.0, 0.12, 0.05, 0.16, 0.42, 0.02, 0x222222);   // remote
    this.tv(2.45, 0.3, 0, 0); this.plant(0.45, 0.45, 0);
    this.shelf(0.22, 3.55, 3, 0, 1.0);
    this.armchair(4.4, 1.0, 1, 0); this.floorLamp(4.55, 0.35, 0);
    this.sideboard(4.78, 2.55, 1, 0, 1.2); this.vase(4.78, 2.55, 1, 0, 0, 0.0, 0.82); this.clockOnWall(4.93, 1.7, 2.2, 1, 0);
    this.table(3.65, 2.35, 0, 0, 1.4, 0.85, 0.75);
    for (const [dx, dz, r] of [[-0.4, -0.65, 0], [0.4, -0.65, 0], [-0.4, 0.65, 2], [0.4, 0.65, 2]]) this.chair(3.65 + dx, 2.35 + dz, r, 0);
    for (const dx of [-0.4, 0.4]) for (const dz of [-0.28, 0.28]) { this.plate(3.65, 2.35, 0, 0, dx, dz, 0.75); this.glassCup(3.65, 2.35, 0, 0, dx + 0.14, dz, 0.75); }
    this.vase(3.65, 2.35, 0, 0, 0, 0, 0.75);
    this.pendant(3.65, 2.35, 0, 0.26); this.pendant(1.9, 3.0, 0, 0.2);
    this.radiator(1.3, 0.14, 0, 0); this.radiator(3.6, 0.14, 0, 0); this.radiator(0.14, 2.1, 3, 0);
    this.picture(1.0, 1.4, 4.34, 2, 0, 0x5b7fa5); this.picture(2.9, 1.5, 4.34, 2, 0, 0xc98a4a); this.picture(0.6, 1.4, 4.0, 3, 0, 0x88a070);
    this.mirrorOnWall(4.93, 1.15, 2.85, 1, 0, 0.4, 0.5);
    this.switchOn(4.9, 1.1, 3.12, 1, 0);
    this.interacts.push({ id: 'desk', label: 'Table : mes finances', x: 3.65, z: 2.35, r: 1.25, lvl: 0 });
    this.interacts.push({ id: 'tv', label: 'Regarder la télévision', x: 2.45, z: 1.15, r: 1.1, lvl: 0 });
    this.interacts.push({ id: 'sofa', label: 'Canapé : se reposer', x: 1.9, z: 3.35, r: 0.95, lvl: 0 });

    // --- chambre : the bed's head against the east wall, desk under the window, wardrobe by the door
    this.bed(3.95, 5.75, 1, 0, 1.6, 2.0);
    this.nightstand(4.78, 4.85, 1, 0); this.nightstand(4.78, 6.65, 1, 0);
    this.wardrobe(1.15, 4.75, 0, 0, 1.8); this.dresser(2.7, 4.75, 0, 0, 1.0);
    this.mirrorOnWall(2.7, 1.1, 4.45, 0, 0, 0.5, 0.7);
    this.desk(0.4, 5.8, 3, 0, 1.2); this.officeChair(1.05, 5.8, 3, 0);
    this.rug(1.7, 5.0, 3.4, 6.6, 0, 0x7d8da0); this.slippers(3.0, 5.2, 0);
    this.radiator(0.14, 6.7, 3, 0, 0.7);
    this.picture(2.2, 1.5, 7.14, 2, 0, 0xb5c9a4); this.pendant(2.2, 5.8, 0, 0.22);
    this.interacts.push({ id: 'bed', label: 'Lit : dormir', x: 3.5, z: 5.75, r: 1.5, lvl: 0 });
    this.interacts.push({ id: 'desk', label: 'Bureau : mes finances', x: 1.0, z: 5.8, r: 0.9, lvl: 0 });
    this.interacts.push({ id: 'wardrobe', label: 'Armoire : se changer', x: 1.15, z: 5.15, r: 0.9, lvl: 0 });

    // --- cuisine
    this.kitchenRun(5.1, 0.3, 8.3, 0, 0, { wall: 2.0 });
    this.sinkUnit(6.1, 0.3, 0, 0);
    this.oven(7.45, 0.3, 0, 0);
    this.fridge(9.2, 0.38, 0, 0);
    this.kitchenRun(8.3, 0.3, 8.6, 0, 0, { wall: 0 });
    this.coffeeMachine(0, 0.0, 0, 0, 8.05, 0.2, 0.92);                // on the worktop right of the oven
    this.kettle(0, 0, 0, 0, 5.45, 0.3, 0.92); this.toaster(0, 0, 0, 0, 5.62, 0.15, 0.92);
    this.microwave(0, 0, 0, 0, 6.85, 0.2, 0.92);
    this.breadBin(0, 0, 0, 0, 5.45, 0.5, 0.92); this.knifeBlock(0, 0, 0, 0, 7.0, 0.45, 0.92);
    this.bowl(0, 0, 0, 0, 8.45, 0.35, 0.92);
    this.bin(9.3, 1.3, 0);
    this.table(7.2, 2.0, 0, 0, 1.0, 0.75, 0.75);
    this.chair(6.8, 2.7, 2, 0); this.chair(7.6, 2.7, 2, 0); this.chair(7.2, 1.33, 0, 0); this.chair(6.5, 2.0, 3, 0);
    this.mug(7.2, 2.0, 0, 0, 0.1, 0.1, 0.75, 0x3a6ea5); this.plate(7.2, 2.0, 0, 0, -0.25, 0.15, 0.75); this.bowl(7.2, 2.0, 0, 0, 0.1, -0.1, 0.75);
    this.pendant(7.2, 2.0, 0, 0.18); this.radiator(9.5, 2.9, 1, 0, 0.6);
    this.clockOnWall(8.1, 1.95, 0.16, 0, 0); this.switchOn(5.1, 1.1, 2.7, 3, 0);
    this.interacts.push({ id: 'coffee', label: 'Machine à café : faire un café', x: 8.05, z: 0.95, r: 0.85, lvl: 0 });
    this.interacts.push({ id: 'fridge', label: 'Réfrigérateur : manger quelque chose', x: 9.0, z: 1.0, r: 0.8, lvl: 0 });

    // --- entrée
    // Keep the route from the front door through the entry and into the living room clear.
    this.mirrorOnWall(6.1, 1.2, 3.28, 0, 0, 0.55, 0.7);
    this.coatRack(7.4, 4.33, 2, 0); this.shoeRack(8.45, 4.23, 2, 0); this.doormat(9.1, 3.8, 3, 0);
    this.pendant(7.4, 3.8, 0, 0.15); this.picture(8.5, 1.5, 3.26, 0, 0, 0xd0b060);
    this.interacts.push({ id: 'exit', label: 'Porte d\'entrée : sortir', x: 9.2, z: 3.8, r: 0.95, lvl: 0 });

    // --- salle de bains / WC / buanderie
    this.bathtub(6.15, 6.75, 0, 0, 1.7);
    this.washbasin(5.52, 5.2, 3, 0); this.towelRail(7.35, 5.5, 3, 0); this.towelRail(5.05, 4.9, 3, 0);
    this.rug(5.5, 5.6, 6.5, 6.15, 0, 0x6aa0b8); this.pendant(6.2, 5.6, 0, 0.12); this.bin(7.15, 4.65, 0);
    this.toilet(9.2, 5.0, 1, 0); this.washbasin(8.45, 4.55, 2, 0);
    this.washer(8.0, 6.85, 2, 0); this.boiler(9.3, 6.65, 0); this.ironingBoard(9.05, 5.95, 0, 0);
    this.fb(9.45, 6.15, 1, 0, [-0.15, -0.5, 0.15, 0.5], 0, 1.7, PAL.wood, { solid: true });
    this.interacts.push({ id: 'shower', label: 'Baignoire : prendre une douche', x: 6.15, z: 6.1, r: 0.9, lvl: 0 });
    this.interacts.push({ id: 'toilet', label: 'WC : utiliser les toilettes', x: 8.8, z: 5.0, r: 0.75, lvl: 0 });
    this.interacts.push({ id: 'basin', label: 'Lavabo : se laver les mains', x: 5.9, z: 5.2, r: 0.7, lvl: 0 });

    // --- glazed tiles: a splashback over the kitchen worktop and a half-height lining in the bathroom
    const tile = (x0, y0, z0, x1, y1, z1, c) => this.box(x0, y0, z0, x1, y1, z1, c, 0, { mesher: this.tiles, noCollide: true, noBottom: true });
    const cream = 0xf3e8c8, aqua = 0xcfe8e6, edge = 0x4f8d98;
    tile(5.0, 0.92, 0.15, 6.6, 1.5, 0.162, cream); tile(6.6, 0.92, 0.15, 8.0, 1.08, 0.162, cream); tile(8.0, 0.92, 0.15, 9.6, 1.5, 0.162, cream);
    tile(5.0, 1.5, 0.15, 6.6, 1.53, 0.165, 0xb8553f); tile(8.0, 1.5, 0.15, 9.6, 1.53, 0.165, 0xb8553f);
    const wcTile = 0xf1ecd6, wcEdge = 0x6f9a62, HW = 1.2;
    tile(7.46, 0.09, 4.46, 7.9, HW, 4.472, wcTile); tile(8.7, 0.09, 4.46, 9.45, HW, 4.472, wcTile);
    tile(9.438, 0.09, 4.46, 9.45, HW, 5.54, wcTile);
    tile(7.46, 0.09, 4.46, 7.472, HW, 5.54, wcTile);
    tile(7.46, 0.09, 5.528, 9.45, HW, 5.54, wcTile);
    for (const [x0, z0, x1, z1] of [[7.46, 4.46, 7.9, 4.475], [8.7, 4.46, 9.45, 4.475], [9.435, 4.46, 9.45, 5.54], [7.46, 4.46, 7.475, 5.54], [7.46, 5.525, 9.45, 5.54]])
      this.box(x0, HW, z0, x1, HW + 0.035, z1, wcEdge, 0, { mesher: this.solid, noCollide: true });
    const H = 1.45;
    tile(5.06, 0.09, 4.46, 5.072, H, 7.05, aqua);
    tile(7.328, 0.09, 4.46, 7.34, H, 5.85, aqua); tile(7.328, 0.09, 6.75, 7.34, H, 7.05, aqua);
    tile(5.06, 0.09, 4.46, 5.6, H, 4.472, aqua); tile(6.5, 0.09, 4.46, 7.34, H, 4.472, aqua);
    tile(5.06, 0.09, 7.038, 7.34, 1.25, 7.05, aqua);
    for (const [x0, z0, x1, z1] of [[5.06, 4.46, 5.075, 7.05], [7.325, 4.46, 7.34, 5.85], [7.325, 6.75, 7.34, 7.05], [5.06, 4.46, 5.6, 4.475], [6.5, 4.46, 7.34, 4.475]])
      this.box(x0, H, z0, x1, H + 0.035, z1, edge, 0, { mesher: this.solid, noCollide: true });
    this._curtains(); this._fixtures();
    this.spawn = { x: 3.9, z: 3.75, yaw: -Math.PI / 2, lvl: 0 };
    this.size = { x: X3, z: Z3 };
    this.home = true;
  }

  person(x, z, rot, lvl, o = {}, mesher = this.staff) {
    // rounded, tapered segments (legs, hips, chest, shoulders, arms, neck, head, hair) instead of boxes
    const shirt = o.shirt ?? 0x3a5a8a, pants = o.pants ?? 0x2b2f3a, skin = o.skin ?? 0xd9b08c, hair = o.hair ?? 0x3a2a1c;
    const mo = { mesher, noCollide: true };
    const R = (lx, lz, r0, r1, y0, y1, c, seg = 12) => this.fp(x, z, rot, lvl, lx, lz, r0, r1, y0, y1, c, { seg, mesher });
    for (const sx of [-0.095, 0.095]) {
      this.fb(x, z, rot, lvl, [sx - 0.05, -0.03, sx + 0.05, 0.13], 0, 0.07, 0x1c1c1e, mo);       // shoe
      R(sx, 0, 0.045, 0.062, 0.07, 0.48, pants);                                                  // calf
      R(sx, 0.005, 0.064, 0.088, 0.48, 0.9, pants);                                               // thigh
    }
    R(0, 0, 0.16, 0.165, 0.84, 1.0, pants, 16);                                                   // hips
    R(0, 0, 0.152, 0.185, 1.0, 1.3, shirt, 16);                                                   // waist to chest
    R(0, 0, 0.19, 0.12, 1.3, 1.46, shirt, 16);                                                    // shoulders
    if (o.apron) this.fb(x, z, rot, lvl, [-0.16, 0.13, 0.16, 0.145], 0.5, 1.35, o.apron, mo);
    for (const sx of [-0.215, 0.215]) {
      R(sx, 0, 0.05, 0.064, 1.12, 1.42, shirt);                                                   // upper arm
      R(sx, 0.01, 0.034, 0.046, 0.86, 1.12, o.longSleeve === false ? skin : shirt);               // forearm
      R(sx, 0.012, 0.03, 0.034, 0.76, 0.86, skin, 8);                                             // hand
    }
    R(0, 0, 0.05, 0.055, 1.44, 1.53, skin, 10);                                                   // neck
    R(0, 0.01, 0.085, 0.07, 1.5, 1.58, skin, 14);                                                 // jaw
    R(0, 0.01, 0.095, 0.085, 1.58, 1.74, skin, 14);                                               // head
    R(0, -0.01, 0.1, 0.07, 1.66, 1.79, hair, 14);                                                 // hair
    this.fb(x, z, rot, lvl, [-0.012, 0.09, 0.012, 0.115], 1.6, 1.66, skin, mo);                   // nose
    if (o.hat) R(0, 0, 0.11, 0.105, 1.74, 1.86, o.hat, 14);
  }
  /** free floor points (no collider within `margin`), for work stations and dirty spots */
  freePoints(margin = 0.5, step = 0.5) {
    const out = [];
    const W = this.size.x, D = this.size.z;
    for (let x = 0.7; x < W - 0.5; x += step) for (let z = 0.7; z < D - 0.5; z += step) {
      let ok = true;
      for (const c of this.colliders) if (c.lvl === 0 && x > c.x0 - margin && x < c.x1 + margin && z > c.z0 - margin && z < c.z1 + margin) { ok = false; break; }
      if (ok && this.shopDoor && z > D - 1.2 && x > this.shopDoor.x0 - 0.6 && x < this.shopDoor.x1 + 0.6) ok = false;
      if (ok) out.push([Math.round(x * 100) / 100, Math.round(z * 100) / 100]);
    }
    return out;
  }
  nearestFree(free, x, z) {
    let b = null, bd = 1e9;
    for (const p of free) { const d = (p[0] - x) ** 2 + (p[1] - z) ** 2; if (d < bd) { bd = d; b = p; } }
    return b;
  }
  /** work stations of a shop: counter (customer side), bench, oven, storage, shelves, dirty spots */
  computeStations(over = {}) {
    this.buildNav(0.35, 0.28);
    const inMain = this.mainComponent();
    const free = this.freePoints(0.45).filter((p) => inMain(p[0], p[1]));
    this.walkable = free;
    // the spawn must be in the main area too
    const sp = this.nearestFree(free, this.spawn.x, this.spawn.z);
    if (sp && !inMain(this.spawn.x, this.spawn.z)) { this.spawn.x = sp[0]; this.spawn.z = sp[1]; }
    const W = this.size.x, D = this.size.z, near = (x, z) => this.nearestFree(free, x, z) || [W / 2, D / 2];
    for (const k of Object.keys(over)) { const v = over[k]; if (Array.isArray(v) && typeof v[0] === 'number') over[k] = inMain(v[0], v[1]) ? v : near(v[0], v[1]); }
    const ctr = this.interacts.find((i) => i.id === 'counter');
    const st = {
      counter: ctr ? [ctr.x, ctr.z] : near(W / 2, D * 0.55),
      bench: near(W * 0.2, D * 0.25),
      oven: near(W * 0.15, D * 0.2),
      storage: near(W * 0.85, D * 0.2),
      shelves: [near(W * 0.12, D * 0.55), near(W * 0.88, D * 0.55), near(W * 0.5, D * 0.8)],
      spots: [near(W * 0.25, D * 0.6), near(W * 0.5, D * 0.45), near(W * 0.75, D * 0.65), near(W * 0.35, D * 0.8)],
      ...over,
    };
    this.stations = st;
    return st;
  }
  // ------------------------------------------------------------------ walking around furniture
  buildNav(cs = 0.35, r = 0.24) {
    const nx = Math.ceil(this.size.x / cs), nz = Math.ceil(this.size.z / cs);
    const blocked = new Uint8Array(nx * nz);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const x = (i + 0.5) * cs, z = (j + 0.5) * cs;
      let b = x < 0.2 || z < 0.2 || x > this.size.x - 0.2 || z > this.size.z - 0.2;
      if (!b) for (const c of this.colliders) if (c.lvl === 0 && x > c.x0 - r && x < c.x1 + r && z > c.z0 - r && z < c.z1 + r) { b = true; break; }
      blocked[j * nx + i] = b ? 1 : 0;
    }
    this.nav = { cs, nx, nz, blocked };
    return this.nav;
  }
  _cell(x, z) {
    const n = this.nav;
    return [Math.max(0, Math.min(n.nx - 1, Math.floor(x / n.cs))), Math.max(0, Math.min(n.nz - 1, Math.floor(z / n.cs)))];
  }
  /** navigation for the people on the payroll: they can step through the counter */
  buildStaffNav() {
    const ctr = this.interacts.find((i) => i.id === 'counter');
    const saved = this.colliders, nav = this.nav;
    if (ctr) this.colliders = saved.filter((c) => !(c.lvl === 0 && c.x0 < ctr.x + 3.2 && c.x1 > ctr.x - 3.2 && c.z0 < ctr.z + 0.2 && c.z1 > ctr.z - 1.2 && (c.z1 - c.z0) < 1.0));
    this.staffNav = this.buildNav(0.35, 0.22);
    this.colliders = saved; this.nav = nav;
    return this.staffNav;
  }
  /** a path for staff (same API as navPath, over the staff grid) */
  staffPath(x0, z0, x1, z1) {
    const keep = this.nav;
    this.nav = this.staffNav || this.buildStaffNav();
    const r = this.navPath(x0, z0, x1, z1);
    this.nav = keep;
    return r;
  }

  /** the nearest walkable cell centre to a point */
  snapFree(x, z) {
    const n = this.nav || this.buildNav();
    const [ci, cj] = this._cell(x, z);
    if (!n.blocked[cj * n.nx + ci]) return [x, z];
    for (let r = 1; r < 14; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
      const i = ci + di, j = cj + dj;
      if (i < 0 || j < 0 || i >= n.nx || j >= n.nz || n.blocked[j * n.nx + i]) continue;
      return [(i + 0.5) * n.cs, (j + 0.5) * n.cs];
    }
    return [x, z];
  }
  _los(a, b) {
    const n = this.nav, d = Math.hypot(b[0] - a[0], b[1] - a[1]), steps = Math.ceil(d / (n.cs * 0.5));
    for (let k = 1; k < steps; k++) {
      const t = k / steps, [i, j] = this._cell(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t);
      if (n.blocked[j * n.nx + i]) return false;
    }
    return true;
  }
  /** a path around furniture and walls: list of [x, z] waypoints (A* on the grid, then straightened) */
  navPath(x0, z0, x1, z1) {
    const n = this.nav || this.buildNav();
    const s = this.snapFree(x0, z0), g = this.snapFree(x1, z1);
    if (this._los(s, g)) return [g];
    const [si, sj] = this._cell(s[0], s[1]), [gi, gj] = this._cell(g[0], g[1]);
    const idx = (i, j) => j * n.nx + i;
    const dist = new Float32Array(n.nx * n.nz).fill(1e9), prev = new Int32Array(n.nx * n.nz).fill(-1), done = new Uint8Array(n.nx * n.nz);
    dist[idx(si, sj)] = 0;
    const open = [[0, idx(si, sj)]];
    const h = (i, j) => Math.hypot(i - gi, j - gj);
    let found = false, guard = 0, best = idx(si, sj), bestH = h(si, sj);
    while (open.length && guard++ < 6000) {
      let bi = 0;
      for (let k = 1; k < open.length; k++) if (open[k][0] < open[bi][0]) bi = k;
      const [, c] = open.splice(bi, 1)[0];
      if (done[c]) continue;
      done[c] = 1;
      const ci = c % n.nx, cj = (c / n.nx) | 0;
      const hc = h(ci, cj);
      if (hc < bestH) { bestH = hc; best = c; }
      if (ci === gi && cj === gj) { found = true; break; }
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const i = ci + di, j = cj + dj;
        if (i < 0 || j < 0 || i >= n.nx || j >= n.nz || n.blocked[idx(i, j)]) continue;
        if (di && dj && (n.blocked[idx(ci + di, cj)] || n.blocked[idx(ci, cj + dj)])) continue;
        const nd = dist[c] + (di && dj ? 1.414 : 1);
        if (nd < dist[idx(i, j)]) { dist[idx(i, j)] = nd; prev[idx(i, j)] = c; open.push([nd + h(i, j), idx(i, j)]); }
      }
    }
    // If furniture divides the room or the requested point is unreachable,
    // finish at the closest reachable cell instead of steering straight
    // through the blocking wall toward the unsnapped goal.
    const end = found ? idx(gi, gj) : best;
    const [ei, ej] = [end % n.nx, (end / n.nx) | 0];
    const cells = [];
    for (let c = end; c !== -1; c = prev[c]) cells.push([(c % n.nx + 0.5) * n.cs, (((c / n.nx) | 0) + 0.5) * n.cs]);
    cells.reverse();
    // straighten: keep a waypoint only when the line of sight from the previous kept one is blocked
    const out = [];
    let a = s;
    for (let k = 1; k < cells.length; k++) {
      if (!this._los(a, cells[k])) { out.push(cells[k - 1]); a = cells[k - 1]; }
    }
    out.push(found ? g : [(ei + 0.5) * n.cs, (ej + 0.5) * n.cs]);
    return out;
  }

  /** the biggest connected walkable area (where a customer or the player can actually go) */
  mainComponent() {
    const n = this.nav || this.buildNav();
    const lab = new Int32Array(n.nx * n.nz).fill(-1), sizes = [];
    for (let s0 = 0; s0 < lab.length; s0++) {
      if (n.blocked[s0] || lab[s0] >= 0) continue;
      const id = sizes.length; let cnt = 0; const st = [s0]; lab[s0] = id;
      while (st.length) {
        const c = st.pop(); cnt++;
        const i = c % n.nx, j = (c / n.nx) | 0;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const a = i + di, b = j + dj;
          if (a < 0 || b < 0 || a >= n.nx || b >= n.nz) continue;
          const k = b * n.nx + a;
          if (n.blocked[k] || lab[k] >= 0) continue;
          lab[k] = id; st.push(k);
        }
      }
      sizes.push(cnt);
    }
    const best = sizes.indexOf(Math.max(...sizes));
    return (x, z) => { const [i, j] = this._cell(x, z); return lab[j * n.nx + i] === best && !n.blocked[j * n.nx + i]; };
  }

  /** flood fill from a point over the walkable grid */
  reachable(x, z) {
    const n = this.nav || this.buildNav();
    const seen = new Uint8Array(n.nx * n.nz);
    const [sx, sz] = this.snapFree(x, z), [si, sj] = this._cell(sx, sz);
    const q = [[si, sj]];
    seen[sj * n.nx + si] = 1;
    while (q.length) {
      const [i, j] = q.pop();
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const a = i + di, b = j + dj;
        if (a < 0 || b < 0 || a >= n.nx || b >= n.nz || seen[b * n.nx + a] || n.blocked[b * n.nx + a]) continue;
        seen[b * n.nx + a] = 1; q.push([a, b]);
      }
    }
    return (px, pz) => {
      const [fx, fz] = this.snapFree(px, pz), [i, j] = this._cell(fx, fz);
      return !!seen[j * n.nx + i] && Math.hypot(fx - px, fz - pz) < 0.7;
    };
  }

  /** a figure made of separate parts so that legs and arms can swing: { group, legL, legR, armL, armR } */
  spawnRig(o = {}) {
    if (!this.group || !this.mats) return null;
    const shirt = o.shirt ?? 0x3a5a8a, pants = o.pants ?? 0x2b2f3a, skin = o.skin ?? 0xd9b08c, hair = o.hair ?? 0x3a2a1c;
    const mk = (fn) => { const m = new Mesher(); fn(m); const mesh = new THREE.Mesh(m.geometry(), this.mats.solid); mesh.frustumCulled = false; return mesh; };
    const B = (m, x0, y0, z0, x1, y1, z1, c) => this.box(x0, y0, z0, x1, y1, z1, c, 0, { mesher: m, noCollide: true });
    const group = new THREE.Group();
    const body = mk((m) => {
      B(m, -0.2, 0.82, -0.11, 0.2, 1.4, 0.11, shirt);
      if (o.apron) B(m, -0.17, 0.5, 0.11, 0.17, 1.35, 0.125, o.apron);
      B(m, -0.05, 1.4, -0.05, 0.05, 1.48, 0.05, skin);
      this.prism(0, 0, 0.1, 0.1, 1.46, 1.68, skin, 0, { seg: 8, mesher: m });
      this.prism(0, -0.01, 0.105, 0.1, 1.6, 1.72, hair, 0, { seg: 8, mesher: m });
      if (o.hat) this.prism(0, 0, 0.12, 0.1, 1.7, 1.84, o.hat, 0, { seg: 8, mesher: m });
    });
    const legL = mk((m) => B(m, -0.12, -0.82, -0.07, -0.01, 0, 0.07, pants)); legL.position.y = 0.82;
    const legR = mk((m) => B(m, 0.01, -0.82, -0.07, 0.12, 0, 0.07, pants)); legR.position.y = 0.82;
    const armL = mk((m) => { B(m, -0.1, -0.52, -0.06, 0, 0, 0.06, shirt); B(m, -0.1, -0.6, -0.05, 0, -0.52, 0.05, skin); }); armL.position.set(-0.2, 1.38, 0);
    const armR = mk((m) => { B(m, 0, -0.52, -0.06, 0.1, 0, 0.06, shirt); B(m, 0, -0.6, -0.05, 0.1, -0.52, 0.05, skin); }); armR.position.set(0.2, 1.38, 0);
    group.add(body, legL, legR, armL, armR);
    group.scale.setScalar(o.scale || 1);
    this.group.add(group);
    return { group, legL, legR, armL, armR };
  }
  removeRig(r) { if (r) { this.group.remove(r.group); r.group.traverse((c) => c.geometry?.dispose?.()); } }

  /** a figure built at the origin facing +z: move it with mesh.position / mesh.rotation.y */
  spawnLocalFigure(o = {}) {
    if (!this.group || !this.mats) return null;
    const m = new Mesher();
    this.person(0, 0, 0, 0, o, m);
    const mesh = new THREE.Mesh(m.geometry(), this.mats.solid);
    mesh.frustumCulled = false;
    this.group.add(mesh);
    return mesh;
  }
  /** a temporary figure (customer) that can be removed again */
  spawnFigure(x, z, rot, o = {}) {
    if (!this.group || !this.mats) return null;
    const m = new Mesher();
    this.person(x, z, rot, 0, o, m);
    const mesh = new THREE.Mesh(m.geometry(), this.mats.solid);
    mesh.frustumCulled = false;
    this.group.add(mesh);
    return mesh;
  }
  removeFigure(mesh) { if (mesh) { this.group.remove(mesh); mesh.geometry.dispose(); } }
  /** a glowing marker on the floor, for the current task's station */
  addMarker(x, z, color = 0xffc400) {
    if (!this.group) return null;
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 1.7, 14, 1, true),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false }));
    mesh.position.set(x, 0.85, z);
    mesh.frustumCulled = false;
    this.group.add(mesh);
    return mesh;
  }
  removeMarker(mesh) { if (mesh) { this.group.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose(); } }

  /** staff and customers are shown when the business is open */
  setOpen(open, seed = 0) {
    this.open = !!open;
    if (this.realPeople) {
      if (this.staffMesh) this.staffMesh.visible = false;
      if (this.crowdMesh) this.crowdMesh.visible = false;
    } else {
      if (this.staffMesh) this.staffMesh.visible = !!open;
      if (this.crowdMesh) this.crowdMesh.visible = !!open && (seed % 3 !== 0);
    }
    this.update(this.hour ?? 14);
  }

  // ------------------------------------------------------------------ scene
  /** THREE group at the origin (move it where you want); call update(hour) as the day goes */
  build() {
    const g = new THREE.Group();
    g.name = 'interior';
    this.mats = {};
    const add = (geom, mat) => { const m = new THREE.Mesh(geom, mat); m.frustumCulled = false; g.add(m); return m; };
    this.mats.solid = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, fog: false });
    add(this.solid.geometry(), this.mats.solid);
    this.mats.solid.map = TEX.plaster();
    this.mats.solid.map?.repeat.set(0.5, 0.5);
    this.mats.timber = new THREE.MeshBasicMaterial({ vertexColors: true, map: TEX.timber(), side: THREE.DoubleSide, fog: false });
    this.mats.cloth = new THREE.MeshBasicMaterial({ vertexColors: true, map: TEX.cloth(), side: THREE.DoubleSide, fog: false });
    this.mats.tiles = new THREE.MeshBasicMaterial({ vertexColors: true, map: TEX.walltile(), side: THREE.DoubleSide, fog: false });
    if (this.mats.timber.map) this.mats.timber.map.repeat.set(1, 1);
    if (this.mats.cloth.map) this.mats.cloth.map.repeat.set(5, 5);
    if (this.mats.tiles.map) this.mats.tiles.map.repeat.set(2, 2);
    this.mats.solid.needsUpdate = true;
    add(this.timber.geometry(), this.mats.timber);
    add(this.cloth.geometry(), this.mats.cloth);
    add(this.tiles.geometry(), this.mats.tiles);
    this.ceilingMesh = add(this.ceilings.geometry(), this.mats.solid);
    this.ceilingMesh.userData.interiorCeiling = true;
    this.mats.floors = [];
    for (const [k, m] of Object.entries(this.floors)) {
      const mat = new THREE.MeshBasicMaterial({ map: TEX[k] ? TEX[k]() : null, color: 0xffffff, side: THREE.DoubleSide, fog: false });
      if (!mat.map) mat.color.set(k === 'tile' ? 0xd8d2c0 : k === 'tomette' ? 0xa4573a : 0x96683e);
      this.mats.floors.push(mat);
      const gm = m.geometry();
      // floors are not vertex-coloured: strip colours so the texture shows through
      gm.deleteAttribute('color');
      add(gm, mat);
    }
    this.staffMesh = add(this.staff.geometry(), this.mats.solid);
    this.crowdMesh = add(this.crowd.geometry(), this.mats.solid);
    this.mats.glass = new THREE.MeshBasicMaterial({ color: 0xcfe6ff, side: THREE.DoubleSide, fog: false, transparent: true, opacity: 0.3, depthWrite: false });
    add(this.glass.geometry(), this.mats.glass);
    this.windowPanes = [];
    for (const w of this._windows || []) {
      // The storefront is the south wall (local +z); side/back windows keep
      // their normal frosted glass until they have a matching exterior view.
      if (!this.shop || w.ax !== 'x' || Math.abs(w.at - this.size.z) > 0.01) continue;
      const width = w.b - w.a - 0.1, height = w.head - w.sill - 0.08;
      if (width <= 0 || height <= 0) continue;
      const geo = new THREE.PlaneGeometry(width, height);
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, fog: false });
      const pane = new THREE.Mesh(geo, mat);
      pane.position.set((w.a + w.b) / 2, w.sill + height / 2 + w.lvl * LEVEL_H, w.at - 0.005);
      pane.userData.window = w;
      g.add(pane); this.windowPanes.push(pane);
    }
    this.mats.lamp = new THREE.MeshBasicMaterial({ vertexColors: true, color: 0xffffff, fog: false });
    add(this.lamps.geometry(), this.mats.lamp);
    // light pools under the pendants (additive, fake)
    const pool = new Mesher();
    const poolTex = typeof document !== 'undefined' ? canvasTex((x, w, h) => { const gr = x.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2); gr.addColorStop(0, 'rgba(255,225,160,0.55)'); gr.addColorStop(1, 'rgba(255,225,160,0)'); x.fillStyle = gr; x.fillRect(0, 0, w, h); }, 128, 128) : null;
    for (const l of this.lights) {
      if (!l.pool) continue;
      const y = l.lvl * LEVEL_H + 0.02, r = l.pool;
      pool.quad([l.x - r, y, l.z - r], [l.x - r, y, l.z + r], [l.x + r, y, l.z + r], [l.x + r, y, l.z - r], 0xffffff, 1, y, [[0, 0], [0, 1], [1, 1], [1, 0]]);
    }
    this.mats.pool = new THREE.MeshBasicMaterial({ map: poolTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xffffff, fog: false });
    const pg = pool.geometry(); pg.deleteAttribute('color');
    add(pg, this.mats.pool);
    // the view outside: a dome with a skyline, day and night
    this.dome = this._dome();
    this.dome.position.set(this.size.x / 2, 1.2, this.size.z / 2);
    g.add(this.dome);
    this.group = g;
    this.update(14);
    return g;
  }

  _dome() {
    const mk = (night) => canvasTex((x, w, h) => {
      const gr = x.createLinearGradient(0, 0, 0, h);
      if (night) { gr.addColorStop(0, '#05080f'); gr.addColorStop(0.55, '#14203a'); gr.addColorStop(1, '#2a2f3a'); } else { gr.addColorStop(0, '#5f97d6'); gr.addColorStop(0.55, '#a9cdf0'); gr.addColorStop(1, '#d8e4e8'); }
      x.fillStyle = gr; x.fillRect(0, 0, w, h);
      // hills and roofs along the horizon
      x.fillStyle = night ? '#0c1018' : '#6c8a66';
      x.beginPath(); x.moveTo(0, h * 0.62);
      for (let i = 0; i <= 64; i++) x.lineTo(i * w / 64, h * (0.56 + 0.05 * Math.sin(i * 0.55) + 0.03 * Math.sin(i * 1.9)));
      x.lineTo(w, h); x.lineTo(0, h); x.fill();
      let s = 7;
      const r = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
      for (let i = 0; i < 70; i++) {
        const bw = 20 + r() * 40, bh = 30 + r() * 60, bx = r() * w, by = h * 0.66 - bh * 0.2;
        x.fillStyle = night ? '#10131a' : `rgb(${150 + r() * 40},${135 + r() * 30},${120 + r() * 30})`;
        x.fillRect(bx, by, bw, h - by);
        x.fillStyle = night ? '#0a0c12' : '#8b3f2f';
        x.beginPath(); x.moveTo(bx - 3, by); x.lineTo(bx + bw / 2, by - 14 - r() * 10); x.lineTo(bx + bw + 3, by); x.fill();
        if (night) { x.fillStyle = '#ffd98a'; for (let k = 0; k < 3; k++) if (r() < 0.5) x.fillRect(bx + 4 + r() * (bw - 10), by + 6 + r() * 30, 4, 5); }
      }
    }, 1024, 512);
    const t = [mk(false), mk(true)];
    this._domeTex = t;
    const m = new THREE.Mesh(new THREE.SphereGeometry(45, 24, 12), new THREE.MeshBasicMaterial({ map: t[0], side: THREE.BackSide, fog: false, depthWrite: true }));
    m.renderOrder = -10;
    return m;
  }

  /** time of day in hours: daylight tint, lamps, window glass, the view */
  update(hour) {
    if (!this.mats) return;
    const sun = Math.max(0, Math.sin((hour - 6) / 12 * Math.PI));          // 0 at night, 1 at noon
    const day = Math.min(1, sun * 1.6);
    const shopClosed = this.shop && this.open === false;
    const k = (shopClosed ? 0.06 : 0.22 + 0.34 * day) * (this.dim ?? 1);   // closed shops go dark; cinema dim is separate
    this.mats.solid.color.setScalar(k);
    for (const key of ['timber', 'cloth', 'tiles']) this.mats[key].color.setScalar(k);
    for (const m of this.mats.floors) m.color.setScalar(k);
    this.mats.glass.color.setRGB(shopClosed ? 0.035 : 0.14 + 0.46 * day, shopClosed ? 0.045 : 0.18 + 0.46 * day, shopClosed ? 0.075 : 0.3 + 0.46 * day);
    this.mats.pool.opacity = shopClosed ? 0 : 1;
    this.mats.pool.color.setScalar(day < 0.5 ? 1 : 0.15 + 0.85 * (1 - day) * 2);
    this.mats.lamp.color.setScalar(day < 0.5 ? 1.0 : 0.82);
    this.mats.pool.visible = !shopClosed;
    this.mats.lamp.visible = !shopClosed;
    if (this.dome) { this.dome.material.map = this._domeTex[day > 0.25 ? 0 : 1]; this.dome.material.needsUpdate = true; }
    this.hour = hour;
  }

  dispose() {
    this.group?.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
  }
}

/** First-person walker with circle-vs-box collisions, two levels and stair triggers. */
export class Walker {
  constructor(interior) {
    this.it = interior;
    this.x = interior.spawn.x; this.z = interior.spawn.z; this.yaw = interior.spawn.yaw; this.pitch = 0; this.lvl = interior.spawn.lvl;
    this.r = 0.27; this.bob = 0; this.stairCool = 0; this.y = this.lvl * LEVEL_H;
  }
  /** move: forward / right in [-1,1]; look: delta yaw / pitch (radians) */
  update(dt, fwd, right, run, dyaw, dpitch) {
    this.yaw += dyaw; this.pitch = Math.max(-1.2, Math.min(1.2, this.pitch + dpitch));
    const sp = (run ? 3.2 : 1.7) * dt;
    const sx = Math.sin(this.yaw), cz = Math.cos(this.yaw);
    // yaw 0 faces +z (south); with x east and z south the right-hand vector is (-cos, sin)
    let dx = (sx * fwd - cz * right) * sp, dz = (cz * fwd + sx * right) * sp;
    const n = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.1));
    dx /= n; dz /= n;
    for (let i = 0; i < n; i++) { this._try(dx, 0); this._try(0, dz); }
    // inside the footprint
    this.x = Math.max(0.15, Math.min(this.it.size.x - 0.15, this.x));
    this.z = Math.max(0.15, Math.min(this.it.size.z - 0.15, this.z));
    if (fwd || right) this.bob += dt * (run ? 11 : 7.5);
    this.stairCool = Math.max(0, this.stairCool - dt);
    if (this.stairCool <= 0) for (const s of this.it.stairs) {
      if (s.lvl === this.lvl && Math.hypot(s.x - this.x, s.z - this.z) < s.r) {
        this.lvl = s.toLvl; this.x = s.tx; this.z = s.tz; this.stairCool = 1.0; break;
      }
    }
    this.y += (this.lvl * LEVEL_H - this.y) * Math.min(1, dt * 8);
  }
  _try(dx, dz) {
    const nx = this.x + dx, nz = this.z + dz, r = this.r;
    for (const c of this.it.colliders) {
      if (c.lvl !== this.lvl) continue;
      if (nx > c.x0 - r && nx < c.x1 + r && nz > c.z0 - r && nz < c.z1 + r) return;
    }
    this.x = nx; this.z = nz;
  }
  eye() { return [this.x, this.y + 1.62 + Math.sin(this.bob) * 0.02, this.z]; }
  nearInteract() {
    let best = null, bd = 1e9, bp = -1;
    for (const it of this.it.interacts) {
      if (it.lvl !== this.lvl) continue;
      const d = Math.hypot(it.x - this.x, it.z - this.z), pr = it.prio || 0;
      if (d < it.r && (pr > bp || (pr === bp && d < bd))) { bd = d; bp = pr; best = it; }
    }
    return best;
  }
}
