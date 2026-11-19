import * as T from '../vendor/three.module.js';

// What makes the player's car a taxi: a roof light that says TAXI (with a red beacon while a passenger is aboard)
// and the passenger themselves, sitting in the back. Everything is built from boxes, spheres and one canvas
// texture, and is created once per car model.
const SKIN = [0xf0c8a0, 0xe0a878, 0xc68b5e, 0x8d5a3b, 0x6b4430];
const HAIR = [0x1d1612, 0x4a3020, 0x8a6a3a, 0xc8a050, 0x777777, 0x2a1a14];
const COATS = [0x3f5b7a, 0x7a3f3f, 0x4f6d4a, 0x6a5a8a, 0x8a7a4a, 0x2d3640, 0xa06a3a];

function signTexture() {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 96;
  const c = canvas.getContext('2d');
  c.fillStyle = '#f6c744'; c.fillRect(0, 0, 256, 96);
  c.strokeStyle = '#1d1a12'; c.lineWidth = 6; c.strokeRect(5, 5, 246, 86);
  c.fillStyle = '#15120a'; c.font = 'bold 62px system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText('TAXI', 128, 52);
  const texture = new T.CanvasTexture(canvas);
  texture.colorSpace = T.SRGBColorSpace;
  return texture;
}

function figure(look) {
  const group = new T.Group();
  const hash = n => { const v = Math.sin(look * 91.7 + n * 12.9898) * 43758.5453; return v - Math.floor(v); };
  const pick = (list, n) => list[Math.floor(hash(n) * list.length)];
  const cloth = new T.MeshBasicMaterial({color: pick(COATS, 1)});
  const skin = new T.MeshBasicMaterial({color: pick(SKIN, 2)});
  const hair = new T.MeshBasicMaterial({color: pick(HAIR, 3)});
  const torso = new T.Mesh(new T.BoxGeometry(.4, .5, .22), cloth);
  torso.position.y = .25;
  const neck = new T.Mesh(new T.CylinderGeometry(.05, .055, .08, 8), skin);
  neck.position.y = .54;
  const head = new T.Mesh(new T.SphereGeometry(.115, 12, 10), skin);
  head.position.y = .67;
  const cap = new T.Mesh(new T.SphereGeometry(.12, 12, 8, 0, Math.PI * 2, 0, Math.PI * (hash(4) > .5 ? .55 : .42)), hair);
  cap.position.y = .675;
  const arms = [-1, 1].map(side => { const arm = new T.Mesh(new T.BoxGeometry(.11, .42, .13), cloth); arm.position.set(side * .26, .26, .02); return arm; });
  group.add(torso, neck, head, cap, ...arms);
  return group;
}

export function attachTaxiGear(model, spec) {
  if (model.userData.taxi) return model.userData.taxi;
  const shape = model.userData.shape || {};
  const roofY = spec.dims.hgt - spec.cg;
  const roofZ = Number.isFinite(shape.roofF) && Number.isFinite(shape.roofR) ? (shape.roofF + shape.roofR) / 2 : -.14;
  const sign = new T.Group();
  const lettering = new T.MeshBasicMaterial({map: signTexture(), color: 0xffffff});
  const plain = new T.MeshBasicMaterial({color: 0xf6c744});
  // the light is wider across the car than along it, with TAXI on the front and back faces
  const body = new T.Mesh(new T.BoxGeometry(.5, .13, .24), plain);
  const front = new T.Mesh(new T.PlaneGeometry(.48, .12), lettering);
  front.position.set(0, 0, .121);
  const back = new T.Mesh(front.geometry, lettering);
  back.position.set(0, 0, -.121); back.rotation.y = Math.PI;
  const beacon = new T.Mesh(new T.BoxGeometry(.12, .05, .1), new T.MeshBasicMaterial({color: 0x3a0a0a}));
  beacon.position.set(0, .09, 0);
  sign.add(body, front, back, beacon);
  sign.position.set(0, roofY + .07, roofZ);
  sign.visible = false;
  model.add(sign);

  // The passenger, seated behind the front seats on the left or right.
  const rear = (shape.zr ?? -2) + ((shape.zf ?? 2) - (shape.zr ?? -2)) * .3;
  const holder = new T.Group();
  holder.visible = false;
  model.add(holder);
  let shown = null;
  const gear = {
    sign, beacon, holder,
    // on duty: the roof light shows; aboard: the passenger sits in the back and the beacon glows red
    update(duty, aboard, look = 0, time = 0) {
      sign.visible = duty;
      beacon.material.color.setHex(aboard ? (Math.floor(time * 2) % 2 ? 0xff2a1a : 0xaa1a10) : 0x3a0a0a);
      if (!aboard) { holder.visible = false; shown = null; return; }
      if (shown !== look) {
        for (const child of [...holder.children]) { holder.remove(child); child.traverse(item => { item.geometry?.dispose(); item.material?.dispose(); }); }
        const person = figure(look);
        person.position.set(0, 0, 0);
        holder.add(person);
        const side = Math.floor((Math.sin(look * 7.31) + 1) * 2) % 2 ? 1 : -1;
        // sitting: the seat is about 0.36 m above the floor, which is cg below the model origin
        holder.position.set(side * .3, -spec.cg + .3, rear);
        shown = look;
      }
      holder.visible = true;
    },
  };
  model.userData.taxi = gear;
  return gear;
}
