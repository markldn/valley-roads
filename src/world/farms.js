import * as T from '../vendor/three.module.js';
import { instances } from './scenery.js';
import { cellSeed, FIELD_ROW_NORMAL, FIELD_ROW_SPACING, random } from './world.js';
import { createLivestock } from '../animals/livestock.js';
import { knockAnimal } from '../animals/animal-impact.js';
import { surface } from '../render/visuals.js';

const CELL = 140;
const FIELD_NORMAL = new T.Vector2(...FIELD_ROW_NORMAL);
const FIELD_FORWARD = new T.Vector2(-FIELD_NORMAL.y, FIELD_NORMAL.x);
const TUFT_SPACING = 1.2;
const CROP_TINTS = [0x858948, 0x7d8d3f, 0x9a9650];
const MEADOW_TINTS = [0x728046, 0x859442, 0x9c9a57];
// Stable per 40 m block value in [0, 1), so a field keeps one crop state across cells.
function fieldBlock(x, z) {
  const s = Math.sin(Math.floor(x / 40) * 127.1 + Math.floor(z / 40) * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
const HALF_PASS = 24;
const TURN_RADIUS = 4 * FIELD_ROW_SPACING;
const TURN_LENGTH = Math.PI * TURN_RADIUS;
const LOOP_LENGTH = 4 * HALF_PASS + 2 * TURN_LENGTH;

function shiftToRow(x,z) {
  const across=x*FIELD_NORMAL.x+z*FIELD_NORMAL.y;
  return Math.round(across/FIELD_ROW_SPACING)*FIELD_ROW_SPACING-across;
}

function fieldPose(x, z, distance) {
  const half = LOOP_LENGTH / 2;
  const reverse = distance >= half;
  const d = distance % half;
  const sign = reverse ? -1 : 1;
  const angle = Math.max(0, d - 2 * HALF_PASS) / TURN_RADIUS;
  const along = sign * (Math.min(d, 2 * HALF_PASS) - HALF_PASS + TURN_RADIUS * Math.sin(angle));
  const across = sign * TURN_RADIUS * Math.cos(angle);
  return {
    cx: x + FIELD_FORWARD.x * along + FIELD_NORMAL.x * across,
    cz: z + FIELD_FORWARD.y * along + FIELD_NORMAL.y * across,
    fx: sign * (FIELD_FORWARD.x * Math.cos(angle) - FIELD_NORMAL.x * Math.sin(angle)),
    fz: sign * (FIELD_FORWARD.y * Math.cos(angle) - FIELD_NORMAL.y * Math.sin(angle)),
  };
}

function plantGeometry(flowers = false) {
  const geometry = new T.BufferGeometry(), vertices = [], colors = [];
  for (let i = 0; i < 9; i++) {
    const a = i * 2.39996, x = Math.cos(a), z = Math.sin(a);
    const r = .075 + i * .026, h = .49 - i * .034;
    vertices.push(x*r-z*.028,-.5,z*r+x*.028, x*r+z*.028,-.5,z*r-x*.028,
      x*(r+.23),h,z*(r+.23));
    colors.push(.49,.57,.38, .67,.72,.49, 1,1,.84);
    if(!flowers || i%2) continue;
    const cx=x*(r+.20), cz=z*(r+.20);
    const petals=i%4 ? [.94,.88,.64] : [.76,.46,.20];
    for(let petal=0;petal<5;petal++){
      const a=petal*Math.PI*.4, b=a+Math.PI*.24;
      vertices.push(cx,h,cz,cx+Math.cos(a)*.09,h+.018,cz+Math.sin(a)*.09,
        cx+Math.cos(b)*.09,h+.016,cz+Math.sin(b)*.09);
      colors.push(.53,.29,.08,...petals,...petals);
    }
  }
  geometry.setAttribute('position', new T.Float32BufferAttribute(vertices,3));
  geometry.setAttribute('color', new T.Float32BufferAttribute(colors,3));
  geometry.computeVertexNormals();
  return geometry;
}

export function createFarms(world, obstacles, debris) {
  const group = new T.Group();
  const cells = new Map();
  const livestock=createLivestock(world);
  const movedBales=new Set();
  const hiddenBale=new T.Matrix4().makeScale(0,0,0);
  const plants = plantGeometry();
  const wildflowers = plantGeometry(true);
  const strawRoll = new T.CylinderGeometry(1,1,1,16).rotateZ(Math.PI / 2);
  const stone = new T.DodecahedronGeometry(1,0);
  const block = new T.BoxGeometry();
  const tire = new T.CylinderGeometry(1,1,1,22).rotateZ(Math.PI/2);
  const vegetation = surface(0xffffff,{pattern:'grass',vertexColors:true,side:T.DoubleSide});
  const straw = surface(0xffffff,{pattern:'straw'});
  const rock = surface(0xffffff,{pattern:'gravel'});
  const paint = [0x45762d,0x9c3624,0x365c80].map(color=>surface(color,{pattern:'machinery',roughness:.58}));
  const rubber = surface(0x252524,{pattern:'machinery'});
  const metal = surface(0x9a9984,{pattern:'machinery',metalness:.4});
  const glass = surface(0x44666b,{roughness:.23,metalness:.38});
  const lamps = surface(0xf4d99e,{roughness:.3,emissive:0xb77d43,emissiveIntensity:.25});
  const treads = [false,true].map(rear=>{
    const radius = rear ? .83 : .51, width = rear ? .49 : .31;
    const records = [];
    for(let i=0;i<22;i++){
      const a=i*Math.PI/11;
      for(const side of [-1,1]) records.push([side*width*.22,Math.cos(a)*radius,Math.sin(a)*radius,
        width*.52,.10,.15,side*.34,0x362e24]);
    }
    const tread = instances(block,records,rubber);
    const transform = new T.Object3D();
    records.forEach(([x,y,z,sx,sy,sz,yaw],i)=>{
      transform.position.set(x,y,z);
      transform.scale.set(sx,sy,sz);
      transform.rotation.set(Math.atan2(z,y),yaw,0,'XYZ');
      transform.updateMatrix();
      tread.setMatrixAt(i,transform.matrix);
    });
    tread.computeBoundingSphere();
    return tread;
  });

  function tractor(index, road=false) {
    const model = new T.Group(), body = paint[index%paint.length], wheels = [];
    function part(material,x,y,z,w,h,l,geometry=block,parent=model) {
      const mesh = new T.Mesh(geometry,material);
      mesh.position.set(x,y,z);
      mesh.scale.set(w,h,l);
      mesh.castShadow = mesh.receiveShadow = true;
      parent.add(mesh);
      return mesh;
    }
    part(rubber,0,.66,.15,.96,.42,2.85);
    part(body,0,1.29,.99,.87,.61,1.64);
    part(rubber,0,1.27,1.83,.69,.42,.06);
    for(let row=0;row<6;row++) part(metal,0,1.09+row*.067,1.87,.65,.021,.027);
    part(body,0,1.08,-.59,1.36,.29,1.42);
    part(glass,0,1.96,-.53,1.09,1.12,1.17);
    part(body,0,2.59,-.53,1.28,.17,1.38);
    part(rubber,.36,1.85,.53,.10,.96,.12);
    for(const side of [-1,1]){
      part(body,side*.91,1.64,-1.03,.42,.14,1.46);
      part(lamps,side*.34,1.49,1.833,.17,.12,.07);
      part(metal,side*.72,2.28,.035,.27,.05,.06);
      part(rubber,side*.85,2.29,.035,.13,.22,.08);
      for(const z of [-1.16,.05]) part(rubber,side*.55,1.96,z,.09,1.19,.082);
      for(const rear of [false,true]){
        const radius=rear?.83:.51, width=rear?.49:.31;
        const wheel=new T.Group();
        wheel.position.set(side*(rear?.92:.75),radius+.035,rear?-1.05:1.18);
        part(rubber,0,0,0,width,radius*1.87,radius*1.87,tire,wheel);
        part(metal,0,0,0,width+.035,radius*.92,radius*.92,tire,wheel);
        part(body,side*(width/2+.026),0,0,.07,radius*.47,radius*.47,tire,wheel);
        wheel.add(treads[Number(rear)].clone());
        model.add(wheel);
        wheels.push({wheel,radius});
      }
    }
    part(metal,0,.54,-1.86,1.34,.12,.17);
    if(!road){
      part(body,0,.47,-2.39,2.64,.20,.64);
      for(let i=-4;i<=4;i++) part(metal,i*.29,.25,-2.63,.075,.49,.16).rotation.x=.29;
      return {model,wheels};
    }
    const trailer=new T.Group();
    trailer.position.set(0,0,-1.78);
    model.add(trailer);
    part(metal,0,.46,-.47,.19,.16,.94,block,trailer);
    part(body,0,.73,-2.47,2.18,.23,3.17,block,trailer);
    for(const side of [-1,1]){
      part(rubber,side*1.08,.45,-2.56,.31,.94,.94,tire,trailer);
      part(metal,side*1.08,.45,-2.56,.33,.45,.45,tire,trailer);
      part(body,side*1.03,.91,-2.47,.12,.18,3.19,block,trailer);
    }
    part(metal,0,.75,-4.08,2.15,.13,.12,block,trailer);
    for(const [x,y,z,r] of [[0,1.51,-1.69,.69],[0,1.51,-3.25,.69],[0,2.67,-2.47,.60]]){
      part(straw,x,y+(.025*(index%3)),z,1.65,r,r,strawRoll,trailer);
    }
    return {model,wheels,trailer};

  }

  function openCell(column,row) {
    const cell=new T.Group();
    const owner='field:'+column+':'+row;
    const rng=random(cellSeed(world.seed ^ 0x4f157,column,row));
    const grass=[], flowers=[], bales=[], stones=[];
    function clear(x,z,margin) {
      const [u,v]=world.grid(x,z);
      return world.roadDistance(u,v,true)>margin &&
        !world.towns.some(town=>Math.hypot(town.u-u,town.v-v)<town.radius+margin);
    }
    function point() {
      return [(column+rng())*CELL,(row+rng())*CELL];
    }
    // Tufts cover the whole cell on a jittered grid, so fields read as planted
    // rather than as a few scattered patches on bare ground.
    for(let gu=0;gu<CELL;gu+=TUFT_SPACING) for(let gv=0;gv<CELL;gv+=TUFT_SPACING){
      let x=column*CELL+gu+rng()*TUFT_SPACING, z=row*CELL+gv+rng()*TUFT_SPACING;
      const cover=world.land(x,z);
      if(cover>=2) continue;
      const crop=cover===1;
      if(!crop && rng()<.4) continue; // meadow is sparser than crops
      if(crop){
        const shift=shiftToRow(x,z);
        x+=shift*FIELD_NORMAL.x;
        z+=shift*FIELD_NORMAL.y;
      }
      if(world.land(x,z)!==cover || !clear(x,z,3)) continue;
      const dry=crop && fieldBlock(x,z)<.5;
      const height=dry?.2+rng()*.2:crop?.3+rng()*.3:.22+rng()*.46;
      const tint=dry?0xae904d:crop?CROP_TINTS[rng()*CROP_TINTS.length|0]:MEADOW_TINTS[rng()*MEADOW_TINTS.length|0];
      const flower=!crop && rng()<.05;
      (flower?flowers:grass).push([x,world.height(x,z)+height*.46,z,.52+rng()*.38,height,.59,rng()*6.28,
        flower?0xd1c879:tint]);
    }
    for(let patch=0;patch<38;patch++){
      const [px,pz]=point();
      const cover=world.land(px,pz);
      if(cover!==0 || !clear(px,pz,4.5)) continue;
      if(rng()<.6){
        const y=world.height(px,pz);
        stones.push([px,y+.09,pz,.44+rng()*.68,.23+rng()*.25,.31+rng()*.51,rng()*6.28,0x827d6b]);
      }
    }
    const hasBales=rng()<.68;
    if(hasBales){
      for(let i=0;i<12;i++){
        const [x,z]=point();
        if(world.land(x,z)!==1 || !clear(x,z,6)) continue;
        const radius=.61+rng()*.22;
        bales.push([x,world.height(x,z)+radius*.96,z,1.12,radius,radius,rng()*6.28,0xc1a461]);
      }
    }
    if(grass.length) cell.add(instances(plants,grass,vegetation,false));
    if(flowers.length) cell.add(instances(wildflowers,flowers,vegetation,false));
    if(bales.length){
      const stack=instances(strawRoll,bales,straw);
      cell.add(stack);
      if(obstacles && debris){
        obstacles.beginOwner(owner);
        bales.forEach(([x,y,z,w,r,,yaw],i)=>{
          const key=owner+':'+i;
          if(movedBales.has(key)){
            stack.setMatrixAt(i,hiddenBale);
            return;
          }
          obstacles.addBreakableProp(x,z,r*.9,(car,j)=>{
            movedBales.add(key);
            stack.setMatrixAt(i,hiddenBale);
            stack.instanceMatrix.needsUpdate=true;
            const bale=new T.Mesh(strawRoll,straw);
            bale.position.set(x,y,z);
            bale.scale.set(w,r,r);
            bale.rotation.y=yaw;
            const direction=new T.Vector3(x-car.p[0],0,z-car.p[2]).normalize();
            const spin=new T.Vector3(direction.z,0,-direction.x);
            const speed=Math.min(9,j/185);
            const momentum=direction.multiplyScalar(speed);
            momentum.y=Math.min(1.8,speed*.20);
            debris.add(bale,{kind:'cyl',mass:185,R:r,W:w,v:momentum,w:spin.multiplyScalar(speed/r),owner:cell});
          },{mass:185,threshold:110,bottom:y-r,top:y+r});
        });
        obstacles.endOwner();
      }
    }
    if(stones.length){
      const field=instances(stone,stones,rock,false);
      cell.add(field);
      if(obstacles&&debris){
        obstacles.beginOwner(owner);
        stones.forEach(([x,y,z,sx,sy,sz,yaw],i)=>{
          const key=owner+':stone:'+i;
          if(movedBales.has(key)){field.setMatrixAt(i,hiddenBale);return;}
          obstacles.addBreakableProp(x,z,Math.max(sx,sz)*.72,(car,j)=>{
            movedBales.add(key);
            field.setMatrixAt(i,hiddenBale);
            field.instanceMatrix.needsUpdate=true;
            const rockMesh=new T.Mesh(stone,rock);
            rockMesh.position.set(x,y,z);rockMesh.scale.set(sx,sy,sz);rockMesh.rotation.y=yaw;
            const away=new T.Vector3(x-car.p[0],0,z-car.p[2]).normalize().multiplyScalar(Math.min(7,j/320));
            away.y=Math.min(2.4,j/900);
            debris.add(rockMesh,{kind:'box',mass:190,h:[sx,sy,sz],v:away,w:new T.Vector3(away.z,1,-away.x),owner:cell});
          },{mass:190,threshold:900,bottom:y-sy,top:y+sy});
        });
        obstacles.endOwner();
      }
    }
    let worker=null;
    for(let i=0;!hasBales && i<5 && !worker;i++){
      let x=(column+.27+rng()*.46)*CELL, z=(row+.27+rng()*.46)*CELL;
      const shift=shiftToRow(x,z);
      x+=shift*FIELD_NORMAL.x;
      z+=shift*FIELD_NORMAL.y;
      if(world.land(x,z)!==1 || !clear(x,z,12)) continue;
      const valid=Array.from({length:24},(_,j)=>fieldPose(x,z,j*LOOP_LENGTH/24)).every(({cx,cz})=>
        world.land(cx,cz)===1 && clear(cx,cz,9));
      if(!valid) continue;
      worker={...tractor(Math.floor(rng()*30)),x,z,phase:rng()*LOOP_LENGTH,speed:1.65+rng()*.55};
      cell.add(worker.model);
    }
    const herdRng=random(cellSeed(world.seed ^ 0xa0c76,column,row));
    let herd=[];
    if(herdRng()<.67){
      for(let i=0;i<6 && !herd.length;i++){
        const x=(column+.16+herdRng()*.68)*CELL, z=(row+.16+herdRng()*.68)*CELL;
        const pasture=(x,z)=>world.land(x,z)===0 && clear(x,z,8);
        if(!pasture(x,z)) continue;
        herd=livestock.herd(x,z,['cow','sheep','horse','pig'][Math.floor(herdRng()*4)],herdRng,pasture);
      }
    }
    for(const animal of herd) cell.add(animal.root);
    group.add(cell);
    return {cell,worker,herd,column,row,owner};
  }

  let time=0, center='', animalBoxes=[];
  function update(dt,player,hour=8.5) {
    time+=dt;
    for(const box of animalBoxes)if(box.hit&&!box.animal.knock)
      knockAnimal(box.animal,box.hit,box.mass,box.cx,box.y,box.cz,Math.atan2(box.fx,box.fz));
    animalBoxes=[];
    const column=Math.floor(player.cx/CELL), row=Math.floor(player.cz/CELL);
    const key=column+':'+row;
    if(key!==center){
      center=key;
      for(const [id,entry] of cells){
        if(Math.max(Math.abs(column-entry.column),Math.abs(row-entry.row))<=1) continue;
        group.remove(entry.cell);
        obstacles?.removeOwner(entry.owner);
        debris?.clear(entry.cell);
        entry.cell.traverse(object=>{ if(object.isInstancedMesh) object.dispose(); });
        cells.delete(id);
      }
      for(let i=column-1;i<=column+1;i++) for(let j=row-1;j<=row+1;j++){
        const id=i+':'+j;
        if(!cells.has(id)) cells.set(id,openCell(i,j));
      }
    }
    const boxes=[];
    for(const {worker,herd} of cells.values()){
      livestock.step(herd,time,player,dt,animalBoxes);
      if(!worker) continue;
      const {model,wheels,x,z,speed,phase}=worker;
      model.visible=hour>=6&&hour<21;
      if(!model.visible)continue;
      const traveled=worker.traveled=(worker.traveled??0)+dt*speed;
      const {cx,cz,fx,fz}=fieldPose(x,z,(traveled+phase)%LOOP_LENGTH);
      const y=world.height(cx,cz), rx=fz, rz=-fx;
      const pitch=Math.atan2(world.height(cx+fx,cz+fz)-world.height(cx-fx,cz-fz),2);
      const roll=Math.atan2(world.height(cx+rx,cz+rz)-world.height(cx-rx,cz-rz),2);
      model.position.set(cx,y,cz);
      model.rotation.set(-pitch,Math.atan2(fx,fz),roll,'YXZ');
      for(const {wheel,radius} of wheels) wheel.rotation.x=traveled/radius%(2*Math.PI);
      boxes.push({cx:cx-fx*.42,cz:cz-fz*.42,fx,fz,rx,rz,y,hl:2.3,hw:1.18,mass:4850,vx:fx*speed,vz:fz*speed});
    }
    return boxes;
  }
  function census() {
    const counts={cells:cells.size,cows:0,sheep:0,fieldTractors:0};
    for(const {column,row,herd,worker} of cells.values()){
      for(const animal of herd)counts[animal.kind==='sheep'?'sheep':animal.kind==='cow'?'cows':animal.kind]=(counts[animal.kind==='sheep'?'sheep':animal.kind==='cow'?'cows':animal.kind]||0)+1;
      counts.fieldTractors+=Number(Boolean(worker));
    }
    return counts;
  }

  return {group,update,tractor,census,animalBoxes:()=>animalBoxes,dispose(){
    for(const {owner,cell} of cells.values()){
      obstacles?.removeOwner(owner);
      debris?.clear(cell);
    }
    livestock.dispose();
    group.traverse(object=>{ if(object.isInstancedMesh) object.dispose(); });
    for(const mesh of treads) mesh.dispose();
    for(const geometry of [plants,wildflowers,strawRoll,stone,block,tire]) geometry.dispose();
    for(const material of [vegetation,straw,rock,...paint,rubber,metal,glass,lamps]) material.dispose();
  }};
}
