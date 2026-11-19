import * as T from '../vendor/three.module.js';
import { Interior, Walker, LEVEL_H } from './apartment.js';
import { Reflector } from '../vendor/jsm/objects/Reflector.js';

// The player's flat, where a new game starts. The rooms and furniture come from apartment.js (all drawn
// by code: boxes, prisms and canvas textures); this file walks around in it, lets you use things, and
// runs the television. Same interior contract as civic.js: look(), step(), dispose().
const LABELS = {
  desk: 'Desk: your taxi career', tv: 'Television', sofa: 'Sofa: rest a while', bed: 'Bed: sleep',
  wardrobe: 'Wardrobe: get dressed', coffee: 'Coffee machine: make a coffee', fridge: 'Fridge: eat something',
  exit: 'Front door: go out to your car', shower: 'Bath: take a shower', toilet: 'Toilet', basin: 'Basin: wash your hands',
};
const CHANNELS = ['Valley TV · News', 'Weather · Alder Valley', 'Sport · Valley League', 'Film of the evening'];
const clock = hour => String(Math.floor(hour) % 24).padStart(2, '0') + ':' + String(Math.floor((hour % 1) * 60)).padStart(2, '0');

export function enterHome({scene, camera, x, z, career, hour}) {
  const interior = new Interior('apartment', 3);
  const group = interior.build();
  group.position.set(x, 1200, z);
  scene.add(group);
  // The world camera clips anything nearer than 3 m, which would erase every wall of a flat.
  const outdoors = {near: camera.near, far: camera.far};
  camera.near = .06; camera.far = 300; camera.updateProjectionMatrix();
  const walker = new Walker(interior);
  interior.buildNav?.(0.35, 0.24);
  let pitch = 0, tv = -1, near = null, drawTimer = 0, note = '', noteTime = 0, lastHour = -1, lastUse = 0;
  let pendingHour = null;

  // The television: a canvas drawn ten times a second while it is on.
  const screen = interior.screens[0];
  let tvCanvas = null, tvTexture = null, tvMesh = null;
  if (screen && typeof document !== 'undefined') {
    tvCanvas = document.createElement('canvas');
    tvCanvas.width = 512; tvCanvas.height = 272;
    tvTexture = new T.CanvasTexture(tvCanvas);
    tvTexture.colorSpace = T.SRGBColorSpace;
    tvMesh = new T.Mesh(new T.PlaneGeometry(screen.w, screen.h), new T.MeshBasicMaterial({map: tvTexture, toneMapped: false, fog: false}));
    tvMesh.position.set(screen.x, screen.lvl * LEVEL_H + screen.y, screen.z);
    tvMesh.rotation.y = screen.yaw;
    group.add(tvMesh);
  }
  function paintTv(time) {
    if (!tvCanvas) return;
    const c = tvCanvas.getContext('2d'), W = 512, H = 272;
    if (tv < 0) {
      c.fillStyle = '#05070a'; c.fillRect(0, 0, W, H);
      c.fillStyle = 'rgba(255,255,255,.05)'; c.fillRect(40, 20, 120, 230);
    } else if (tv === 0) {
      const sky = c.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, '#163a6b'); sky.addColorStop(1, '#0a1730');
      c.fillStyle = sky; c.fillRect(0, 0, W, H);
      c.fillStyle = '#1f5fa8'; c.fillRect(300, 30, 180, 110);
      c.fillStyle = '#e8eef7'; c.font = 'bold 18px system-ui'; c.fillText('VALLEY', 340, 78);
      c.font = '13px system-ui'; c.fillText('NEWS AT ' + clock(hour), 332, 104);
      c.fillStyle = '#20232a'; c.fillRect(90, 175, 200, 60);
      c.fillStyle = '#3a4a6a'; c.beginPath(); c.ellipse(190, 160, 48, 40, 0, Math.PI, 0); c.fill();
      c.fillStyle = '#e0b48c'; c.beginPath(); c.arc(190, 95 + Math.sin(time * 2) * 1.2, 26, 0, 7); c.fill();
      c.fillStyle = '#3a2a1c'; c.beginPath(); c.arc(190, 86, 27, Math.PI, 0); c.fill();
      const s = career.state;
      const headline = `Taxi driver rated ${s.rating.toFixed(1)} stars after ${s.fares} fares   ·   Roads open across Alder Valley   ·   Radar cameras active on the main roads`;
      c.fillStyle = '#c0102a'; c.fillRect(0, 238, W, 34); c.fillStyle = '#fff'; c.font = 'bold 15px system-ui';
      const span = c.measureText(headline).width + 200, off = (time * 70) % span;
      c.fillText(headline, W - off, 261); c.fillText(headline, W - off + span, 261);
    } else if (tv === 1) {
      c.fillStyle = '#7fb3d9'; c.fillRect(0, 0, W, H);
      c.fillStyle = '#9cc58a'; c.beginPath(); c.moveTo(120, 40); c.lineTo(330, 30); c.lineTo(420, 120); c.lineTo(360, 230); c.lineTo(170, 240); c.lineTo(90, 150); c.closePath(); c.fill();
      c.strokeStyle = '#4a7a3a'; c.lineWidth = 3; c.stroke();
      for (const [px, py, name, k] of [[250, 140, 'Bellecombe', 0], [170, 90, 'Valmont', .4], [330, 190, 'Les Ormes', -.3], [300, 70, 'Hautvent', .6]]) {
        c.fillStyle = '#ffd24a'; c.beginPath(); c.arc(px, py - 18, 10 + Math.sin(time * 2 + px) * 1.5, 0, 7); c.fill();
        c.fillStyle = '#123'; c.font = 'bold 16px system-ui'; c.fillText(Math.round(12 + 6 * Math.sin(hour / 24 * 6.28 - 2 + k)) + '°', px + 14, py - 12);
        c.font = '12px system-ui'; c.fillText(name, px - 20, py + 4);
      }
      c.fillStyle = '#123a'; c.fillRect(0, 0, W, 30); c.fillStyle = '#fff'; c.font = 'bold 16px system-ui'; c.fillText('WEATHER · ALDER VALLEY', 16, 21);
    } else if (tv === 2) {
      c.fillStyle = '#2f8a3a'; c.fillRect(0, 0, W, H);
      for (let i = 0; i < 8; i++) { c.fillStyle = i % 2 ? '#2f8a3a' : '#349640'; c.fillRect(i * 64, 0, 64, H); }
      c.strokeStyle = '#ffffffb0'; c.lineWidth = 2; c.strokeRect(20, 20, W - 40, H - 40);
      c.beginPath(); c.moveTo(W / 2, 20); c.lineTo(W / 2, H - 20); c.stroke();
      c.beginPath(); c.arc(W / 2, H / 2, 36, 0, 7); c.stroke();
      const bx = W / 2 + Math.sin(time * .7) * 170, by = H / 2 + Math.sin(time * 1.3) * 70;
      for (let i = 0; i < 20; i++) {
        const px = W / 2 + Math.sin(time * .5 + i * 1.7) * 140 * (i % 2 ? 1 : -1) + (bx - W / 2) * .3, py = H / 2 + Math.cos(time * .6 + i * 2.3) * 90;
        c.fillStyle = i < 10 ? '#f0e000' : '#1a3aa0'; c.beginPath(); c.arc(px, py, 5, 0, 7); c.fill();
      }
      c.fillStyle = '#fff'; c.beginPath(); c.arc(bx, by, 3.5, 0, 7); c.fill();
      c.fillStyle = '#000a'; c.fillRect(14, 10, 230, 26); c.fillStyle = '#fff'; c.font = 'bold 15px system-ui';
      c.fillText(`Bellecombe 1 - 1 Valmont  ${Math.floor(time / 2) % 90}'`, 22, 28);
    } else {
      const k = Math.floor(time / 7) % 3, u = (time % 7) / 7;
      const sky = [['#f4b26a', '#4a3a6a'], ['#9cc7e8', '#e8f2f8'], ['#0a1430', '#2a3a6a']][k];
      const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, sky[1]); g.addColorStop(1, sky[0]); c.fillStyle = g; c.fillRect(0, 0, W, H);
      c.fillStyle = k === 2 ? '#0a0f18' : '#3d5a36';
      c.beginPath(); c.moveTo(0, H); for (let i = 0; i <= 32; i++) c.lineTo(i * 16, 170 + Math.sin(i * .5 + u * 2) * 18 + Math.sin(i * 1.3) * 8); c.lineTo(W, H); c.fill();
      c.fillStyle = '#000'; c.fillRect(0, 0, W, 28); c.fillRect(0, H - 28, W, 28);
      c.fillStyle = '#fff'; c.font = 'italic 14px system-ui';
      c.fillText(['"I will be back before the snow."', '"Do you remember the river road?"', '"It is late. Go home."'][k], 120, H - 10);
    }
    if (tv >= 0) { c.fillStyle = '#ffffff99'; c.font = '11px system-ui'; c.fillText(CHANNELS[tv], W - c.measureText(CHANNELS[tv]).width - 10, 18); }
    tvTexture.needsUpdate = true;
  }
  paintTv(0);

  // Mirrors: a real reflection, drawn only for the two you are standing in front of.
  const mirrors = interior.mirrors.map(def => {
    const ratio = def.w / def.h;
    const mirror = new Reflector(new T.PlaneGeometry(def.w, def.h), {
      textureWidth: Math.round(384 * Math.max(1, ratio)), textureHeight: Math.round(384 / Math.min(1, ratio)),
      color: 0xc4ccd0, clipBias: .003,
    });
    mirror.position.set(def.x + Math.sin(def.yaw) * .004, def.lvl * LEVEL_H + def.y, def.z + Math.cos(def.yaw) * .004);
    mirror.rotation.y = def.yaw;
    mirror.userData.def = def;
    mirror.visible = false;
    group.add(mirror);
    return mirror;
  });
  function showMirrors() {
    const seen = [];
    for (const mirror of mirrors) {
      const def = mirror.userData.def, dx = walker.x - def.x, dz = walker.z - def.z, d = Math.hypot(dx, dz);
      mirror.visible = false;
      // in front of the glass and close enough to see yourself
      if (def.lvl === walker.lvl && d < 4.5 && dx * Math.sin(def.yaw) + dz * Math.cos(def.yaw) > .15) seen.push([d, mirror]);
    }
    seen.sort((a, b) => a[0] - b[0]).slice(0, 2).forEach(([, mirror]) => { mirror.visible = true; });
  }

  const setHour = value => { hour = value; pendingHour = value; interior.update(hour); };
  const tell = (text, seconds = 4) => { note = text; noteTime = seconds; };

  // What each thing in the flat does when you use it.
  const actions = {
    tv() {
      tv = tv >= CHANNELS.length - 1 ? -1 : tv + 1;
      tell(tv < 0 ? 'Television off.' : CHANNELS[tv]);
    },
    sofa() { setHour((hour + .5) % 24); tell('You rest on the sofa for half an hour. It is ' + clock(hour) + '.'); },
    bed() {
      setHour(7);
      tell('You sleep until 07:00. A new day on the road.', 5);
    },
    wardrobe() { tell('You pick out a clean jacket. Fares tip better when you look the part.'); },
    coffee() { tell('You make a coffee. Smells like a good shift.'); },
    fridge() { tell('You eat something quick from the fridge.'); },
    shower() { tell('A hot shower. You are ready for the road.'); },
    toilet() { tell('Better to go now than at a roundabout.'); },
    basin() { tell('You wash your hands.'); },
    desk() {
      const s = career.state, goal = career.goals().find(item => !item.done);
      const next = career.nextTier();
      tell(`${career.tier.name} driver · ★ ${s.rating.toFixed(1)} · ${s.fares} fares · ${Math.round(s.cash)} € ` +
        (next ? `· next: ${next.name} at ${next.fares} fares and ★ ${next.rating} ` : '') +
        (goal ? `· goal: ${goal.text} (+${goal.reward} €)` : ''), 9);
    },
  };

  return {
    kind: 'home',
    // Test hook: stand somewhere in the flat.
    place(px, pz, yaw = 0, look = 0) { walker.x = px; walker.z = pz; walker.yaw = yaw; pitch = look; },
    get interior() { return interior; },
    // The game takes an hour change (sleep, rest) once, then follows its own clock again.
    takeHour() { const value = pendingHour; pendingHour = null; return value; },
    get prompt() {
      if (noteTime > 0) return note;
      return near ? `F · ${LABELS[near.id] ?? near.label}` : 'Walk around: W A S D, drag to look. The front door is by the entrance.';
    },
    look(dx, dy) { walker.yaw -= dx * .004; pitch = T.MathUtils.clamp(pitch - dy * .004, -1.1, 1.1); },
    // F: use whatever is in reach. Returns 'exit' at the front door.
    use() {
      if (!near || performance.now() - lastUse < 250) return false;
      lastUse = performance.now();
      if (near.id === 'exit') return 'exit';
      actions[near.id]?.();
      return true;
    },
    step(dt, pressed, camera, nowHour) {
      if (pendingHour === null && Math.abs(nowHour - lastHour) > .02) { hour = nowHour; interior.update(hour); lastHour = nowHour; }
      noteTime = Math.max(0, noteTime - dt);
      const forward = Number(pressed('w', 'ArrowUp')) - Number(pressed('s', 'ArrowDown'));
      const right = Number(pressed('d')) - Number(pressed('a'));
      const turn = (Number(pressed('ArrowLeft')) - Number(pressed('ArrowRight'))) * dt * 1.8;
      walker.update(dt, forward, right, pressed('Shift'), turn, 0);
      near = walker.nearInteract();
      showMirrors();
      if (tv >= 0) { drawTimer += dt; if (drawTimer > .1) { drawTimer = 0; paintTv(performance.now() / 1000); } }
      const [ex, ey, ez] = walker.eye();
      camera.position.set(group.position.x + ex, group.position.y + ey, group.position.z + ez);
      camera.lookAt(
        camera.position.x + Math.sin(walker.yaw) * Math.cos(pitch),
        camera.position.y + Math.sin(pitch),
        camera.position.z + Math.cos(walker.yaw) * Math.cos(pitch));
    },
    dispose() {
      camera.near = outdoors.near; camera.far = outdoors.far; camera.updateProjectionMatrix();
      group.removeFromParent();
      const materials = new Set();
      group.traverse(item => { item.geometry?.dispose(); if (item.material) materials.add(item.material); });
      for (const material of materials) { material.map?.dispose(); material.dispose(); }
    },
  };
}
