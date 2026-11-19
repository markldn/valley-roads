import * as T from '../vendor/three.module.js';
import { walkingMeshes } from '../traffic/population.js';
import { surface } from '../render/visuals.js';
import { random } from '../world/world.js';

const SERVICES=[
  ['École des Rives','school',0x426977,55,12],
  ['Centre de secours','clinic',0x963a42,-65,15],
  ['Alder Valley Hospital','hospital',0x34778b,-82,34],
  ['Valmont Fire Station','fire',0xaa3830,-65,-46],
  ['Alder Valley Museum','museum',0x684c78,48,69],
  ['La Poste','post',0xcd9b2f,-16,-60],
  ['Café du Marché','cafe',0x646749,12,65],
  ['Boulangerie du Village','bakery',0x936143,-12,70],
  ['Marché des Rives','supermarket',0x456e42,71,48],
];

function box(parent,material,w,h,d,x,y,z) {
  const mesh=new T.Mesh(new T.BoxGeometry(w,h,d),material);
  mesh.position.set(x,y,z);
  mesh.receiveShadow=true;
  parent.add(mesh);
  return mesh;
}

function label(text,color) {
  const canvas=document.createElement('canvas');
  canvas.width=512; canvas.height=100;
  const ctx=canvas.getContext('2d');
  ctx.fillStyle='#'+color.toString(16).padStart(6,'0');
  ctx.fillRect(0,0,512,100);
  ctx.strokeStyle='#fff1d1';
  ctx.lineWidth=4;
  ctx.strokeRect(9,9,494,82);
  ctx.fillStyle='#fff6df';
  ctx.textAlign='center';
  ctx.textBaseline='middle';
  ctx.font='bold 43px system-ui';
  ctx.fillText(text,256,53,468);
  const map=new T.CanvasTexture(canvas);
  map.colorSpace=T.SRGBColorSpace;
  const mesh=new T.Mesh(new T.PlaneGeometry(3.8,.74),
    new T.MeshBasicMaterial({map,side:T.DoubleSide,toneMapped:false}));
  return mesh;
}

function crossingMesh(world) {
  const vertices=[];
  for(const [u,v,alongX] of world.crossings) {
    for(let across=-3.9;across<=3.9;across+=.84){
      const at=(lateral,along)=>{
        const [x,z]=world.point(u+(alongX?along:lateral),v+(alongX?lateral:along));
        return [x,world.height(x,z)+.181,z];
      };
      const a=at(across,-1.65),b=at(across+.47,-1.65);
      const c=at(across,1.65),d=at(across+.47,1.65);
      vertices.push(...a,...b,...c,...b,...d,...c);
    }
  }
  const geometry=new T.BufferGeometry();
  geometry.setAttribute('position',new T.Float32BufferAttribute(vertices,3));
  geometry.computeVertexNormals();
  const mesh=new T.Mesh(geometry,new T.MeshStandardMaterial({
    color:0xeee9d8,roughness:.8,side:T.DoubleSide,
  }));
  mesh.receiveShadow=true;
  return mesh;
}

export function throwFragments(debris,hit,owner) {
  if(!hit || hit.j<3000) return;
  const count=Math.min(10,2+Math.floor(hit.j/1900));
  for(let i=0;i<count;i++){
    const glass=i%3!==0;
    const extent=.076+Math.random()*(glass?.13:.25);
    const color=glass?0x9dbac2:i%2?0x5f6b71:0x343235;
    const mesh=new T.Mesh(new T.BoxGeometry(extent,.024,extent*.85),
      new T.MeshStandardMaterial({color,metalness:glass?.28:.65,roughness:glass?.22:.5}));
    mesh.userData.ownGeometry=true;
    mesh.userData.ownMaterial=true;
    const [px,py,pz]=hit.P;
    const [nx,,nz]=hit.n;
    mesh.position.set(px+nx*.12,py+.19,pz+nz*.12);
    const launch=Math.min(11,2+hit.j/1500);
    debris.add(mesh,{kind:'box',mass:.15+extent*1.9,h:[extent/2,.012,extent*.425],owner,
      v:new T.Vector3(nx*launch+(Math.random()-.5)*7,2+Math.random()*launch,nz*launch+(Math.random()-.5)*7),
      w:new T.Vector3(Math.random()*23-11,Math.random()*19-9,Math.random()*21-10),
    });
  }
}

export function createCivic(world, region, obstacles, debris) {
  const group=new T.Group();
  const sites=[], assigned=new Set();
  group.add(crossingMesh(world));
  const wood=surface(0x6b4331,{roughness:.77});
  const trim=surface(0xb29373);
  const glazing=new T.MeshPhysicalMaterial({color:0x38545a,roughness:.26,metalness:.15,clearcoat:.6});
  const planter=surface(0xa67858,{pattern:'gravel'});
  const green=surface(0x5f7949,{pattern:'foliage'});
  const rng=random(world.seed^0x37346c25);
  const stations=world.towns.filter(town=>town.tier==='hub').map(town=>{
    const angle=rng()*Math.PI*2, distance=town.radius*(.18+.23*rng());
    return [town.name+' police station','police',0x355689,
      town.u+Math.cos(angle)*distance,town.v+Math.sin(angle)*distance];
  });
  for(const [name,kind,color,u,v] of [...stations,...SERVICES]){
    const [sourceX,sourceZ]=world.point(u,v);
    const eligible=region.obstacles.filter(b=>b.entry && !assigned.has(b));
    const lot=eligible.reduce((best,b)=>!best || Math.hypot(b.x-sourceX,b.z-sourceZ)<
      Math.hypot(best.x-sourceX,best.z-sourceZ)?b:best,null);
    if(!lot) continue;
    assigned.add(lot);
    const [x,z]=lot.entry,[nx,nz]=lot.front;
    const y=world.height(x,z);
    const doorway=new T.Group();
    doorway.position.set(x,y,z);
    doorway.rotation.y=Math.atan2(nx,nz);
    const sign=label(name,color);
    sign.position.set(0,3.12,.18);
    doorway.add(sign);
    box(doorway,trim,1.74,2.53,.17,0,1.26,.04);
    box(doorway,wood,1.47,2.30,.16,0,1.15,.14);
    box(doorway,glazing,.99,.72,.025,0,1.71,.229);
    box(doorway,trim,1.14,.065,.04,0,1.3,.246);
    box(doorway,trim,.06,.76,.04,0,1.72,.246);
    for(const side of [-1,1]){
      box(doorway,trim,.40,.38,.026,side*.268,.64,.234);
      box(doorway,trim,.40,.38,.026,side*.268,.22,.234);
    }
    box(doorway,trim,.10,.27,.06,.51,1.05,.245);
    group.add(doorway);
    sites.push({name,kind,color,x,z,y,nx,nz});
    for(const side of [-1,1]){
      const px=x+nz*side*2.1+nx*.65,pz=z-nx*side*2.1+nz*.65;
      const py=world.height(px,pz);
      const pot=new T.Group();
      pot.position.set(px,py+.23,pz);
      box(pot,planter,.53,.46,.54,0,0,0);
      const leaves=new T.Mesh(new T.IcosahedronGeometry(.44,1),green);
      leaves.position.y=.57;
      leaves.scale.set(1,1.2,1);
      pot.add(leaves);
      group.add(pot);
      obstacles.addBreakableProp(px,pz,.28,()=>{
        pot.removeFromParent();
        debris.add(pot,{kind:'box',mass:7,h:[.265,.36,.27],v:new T.Vector3(nx*4,3,nz*4),
          w:new T.Vector3(nz*6,5,-nx*6),owner:group});
      });
    }
  }

  function nearby(x,z,speed) {
    if(Math.abs(speed)>2.6) return null;
    let best=null, distance=10.5;
    for(const site of sites) {
      const d=Math.hypot(site.x-x,site.z-z);
      if(d<distance){distance=d;best=site;}
    }
    return best;
  }
  const policeStations=sites.filter(site=>site.kind==='police');
  function nearestStation(x,z){
    let station=null,distance=Infinity;
    for(const site of policeStations){
      const range=Math.hypot(site.x-x,site.z-z);
      if(range<distance){station=site;distance=range;}
    }
    return station;
  }
  return {group,sites,nearby,nearestStation};
}

export function enterInterior(scene,site) {
  const group=new T.Group();
  group.position.set(site.x,1200,site.z);
  scene.add(group);
  const walls=surface(0xe3d7be,{pattern:'plaster'});
  const floor=surface(0xc3aa89,{pattern: 'concrete'});
  const timber=surface(0x896449);
  const feature=surface(site.color);
  const fabric=surface(0xdadcdc);
  const lamp=new T.HemisphereLight(0xffefd5,0x827788,2.5);
  group.add(lamp);
  box(group,floor,12,.18,14,0,-.09,0);
  box(group,walls,12,.15,14,0,3.2,0);
  box(group,walls,.2,3.4,14,-6,1.6,0);
  box(group,walls,.2,3.4,14,6,1.6,0);
  box(group,walls,12,3.4,.2,0,1.6,-7);
  box(group,walls,12,3.4,.2,0,1.6,7);
  const title=label(site.name,site.color);
  title.rotation.y=Math.PI;
  title.position.set(0,2.45,6.88);
  group.add(title);
  const furniture=[];
  function desk(x,z,width=1.6,depth=.7){
    box(group,timber,width,.085,depth,x,.82,z);
    for(const xx of [-1,1]) for(const zz of [-1,1])
      box(group,timber,.09,.78,.09,x+xx*(width/2-.11),.39,z+zz*(depth/2-.10));
    furniture.push({x,z,w:width,d:depth});
  }
  if(site.kind==='supermarket'){
    const stock=[0xbd6642,0xc5a24b,0x6f9b64,0x705b87].map(color=>surface(color));
    for(const x of [-3.6,-.7,2.15]){
      for(let level=0;level<3;level++){
        const y=.46+level*.47;
        box(group,timber,1.04,.08,4.9,x,y,1.6);
        for(const side of [-1,1]) for(let i=0;i<10;i++){
          const h=.16+(i%3)*.057;
          box(group,stock[(i+level+Math.round(x)+4)%4],.32,h,.25,x+side*.27,y+h/2+.04,-.54+i*.45);
        }
      }
      box(group,feature,.09,1.5,4.9,x,.75,1.6);
      furniture.push({x,z:1.6,w:1.04,d:4.9});
    }
    desk(4.05,-3.35,1.36,2.1);
    box(group,feature,.26,.31,.38,3.83,1.02,-3.72);
  } else if(site.kind==='school'){
    box(group,feature,5,.95,.07,0,1.9,6.85);
    for(const z of [-1,1.5,4]) for(const x of [-3,0,3]){
      desk(x,z);
      box(group,timber,.51,.10,.39,x,.39,z-.65);
      box(group,feature,.49,.41,.09,x,.60,z-.85);
      for(const side of [-1,1]) box(group,timber,.066,.39,.075,x+side*.20,.20,z-.69);
      furniture.push({x,z:z-.65,w:.51,d:.50});
      box(group,fabric,.39,.055,.27,x+.09,.885,z-.06);
    }
    desk(0,5.7,2.2);
  } else if(site.kind==='hospital'||site.kind==='clinic'){
    for(const x of [-3,0,3]){
      box(group,feature,1.27,.51,2.35,x,.34,4);
      box(group,fabric,1.27,.16,2.35,x,.67,4);
      box(group,fabric,.98,.14,.46,x,.8,4.75);
      furniture.push({x,z:4,w:1.27,d:2.35});
    }
    desk(0,-.7,3.2,1.1);
    if(site.kind==='hospital'){
      const steel=surface(0xacb4bb,{metalness:.42});
      const screen=surface(0x253e48,{emissive:0x275364,emissiveIntensity:.62});
      for(const x of [-3,0,3]){
        box(group,steel,.34,.96,.43,x+.88,.5,4.73);
        box(group,screen,.40,.30,.15,x+.88,1.08,4.73);
        box(group,steel,.045,1.67,.045,x-.84,.85,4.79);
        box(group,fabric,.16,.26,.09,x-.84,1.48,4.79);
      }
      for(const x of [-4.7,-3.9,3.9,4.7]){
        box(group,feature,.66,.10,.57,x,.48,-3.45);
        box(group,feature,.66,.43,.08,x,.72,-3.69);
        furniture.push({x,z:-3.45,w:.66,d:.57});
      }
    }
  } else if(site.kind==='fire'){
    const dark=surface(0x252b30), yellow=surface(0xeac75c), glass=surface(0x49646b);
    const x=2.5,z=1.3;
    box(group,feature,2.1,1.3,5.0,x,1.14,z);
    box(group,feature,2.02,.65,1.64,x,2.08,z-1.57);
    box(group,glass,1.71,.49,.06,x,2.10,z-2.40);
    box(group,yellow,2.13,.13,4.96,x,1.27,z);
    for(const side of [-1,1])for(const end of [-1,1.4]){
      const wheel=new T.Mesh(new T.CylinderGeometry(.45,.45,.29,18),dark);
      wheel.rotation.z=Math.PI/2;wheel.position.set(x+side*.91,.45,z+end);group.add(wheel);
    }
    furniture.push({x,z,w:2.35,d:5.2});
    for(let i=0;i<5;i++){
      box(group,dark,.58,1.85,.58,-5.53,.96,i*.72-1.12);
      box(group,yellow,.05,.27,.28,-5.22,1.48,i*.72-1.12);
    }
    desk(-3.25,4.9,2.12,.85);
    box(group,dark,4.55,2.46,.08,x,1.33,-6.85);
    for(let i=0;i<9;i++)box(group,fabric,4.49,.04,.04,x,.29+i*.255,-6.79);
  } else if(site.kind==='museum'){
    const kinds=[new T.DodecahedronGeometry(.38),new T.TorusKnotGeometry(.21,.075,54,9),new T.ConeGeometry(.27,.76,24)];
    const exhibit=surface(0x9b8055,{metalness:.34,roughness:.52});
    for(const [i,geometry] of kinds.entries()){
      const x=(i-1)*3.4,z=3.05;
      box(group,timber,1.28,.96,1.28,x,.48,z);
      furniture.push({x,z,w:1.28,d:1.28});
      const piece=new T.Mesh(geometry,exhibit);
      piece.rotation.y=i*.7;piece.position.set(x,1.35,z);group.add(piece);
      const caption=label(['Valley stone','Ironwork and craft','River trade'][i],site.color);
      caption.scale.setScalar(.47);caption.position.set(x,2.17,z);caption.rotation.y=Math.PI;group.add(caption);
    }
    for(const x of [-3.4,0,3.4]){
      box(group,timber,1.56,.10,.44,x,.49,-3.35);
      box(group,timber,1.4,.43,.22,x,.23,-3.35);
      furniture.push({x,z:-3.35,w:1.56,d:.44});
    }
  } else {
    desk(0,3.25,7.8,1.25);
    box(group,feature,7.7,.69,.16,0,.46,2.67);
    for(let i=0;i<3;i++){
      const z=0.2-i*1.8;
      desk(-3.8,z,1.4,1.15);
      if(site.kind==='cafe') desk(3.8,z,1.4,1.15);
    }
    for(let level=0;level<4;level++){
      box(group,timber,7,.065,.49,0,.54+level*.56,6.65);
      for(let j=0;j<8;j++) box(group,j%3?feature:fabric,.34,.28,.32,j*.74-2.65,.70+level*.56,6.65);
    }
  }
  const school=site.kind==='school';
  const staff=walkingMeshes(school?10:['hospital','museum','supermarket'].includes(site.kind)?4:2);
  const attributes=staff.mesh.geometry.attributes;
  group.add(staff.mesh);
  const eye=new T.Vector3(0,1.66,-5.6), target=new T.Vector3();
  let yaw=0,pitch=0;
  return {
    site,
    look(dx,dy){yaw-=dx*.004;pitch=T.MathUtils.clamp(pitch-dy*.004,-1.1,1.1);},
    step(dt,pressed,camera,hour) {
      staff.time.value+=dt;
      const t=staff.time.value;
      const hospital=site.kind==='hospital',fire=site.kind==='fire',museum=site.kind==='museum';
      const tour=museum&&Math.floor(hour)%2===0;
      const open=hospital||fire||(school?hour>=8&&hour<16.5:hour>=7&&hour<(site.kind==='cafe'?23:19.5));
      const market=site.kind==='supermarket';
      const lesson=hour>=8.65&&hour<10.05||hour>=10.65&&hour<12.15||
        hour>=13.5&&hour<15.1||hour>=15.55&&hour<16.1;
      const visitors=school?(lesson?9:0):market||hospital||tour?3:1;
      staff.mesh.geometry.instanceCount=open?visitors+1:0;
      if(open) for(let i=0;i<=visitors;i++){
        const phase=t*.40+i*2.17;
        const workers={
          supermarket:[4.05,-1.96,Math.PI],school:[0,6.2,Math.PI],
          clinic:[0,.09,Math.PI],cafe:[0,4.26,Math.PI],
          hospital:[0,.09,Math.PI],fire:[-3.25,5.44,Math.PI],museum:[0,4.6,Math.PI],
        };
        const [sx,sz,angle]=workers[site.kind] || [0,4.26,Math.PI];
        const guideOffset=tour?3.4*Math.sin(t*.115):0;
        const z=i===0?sz+(school&&lesson?.24*Math.sin(phase):0):market?1.5+Math.sin(phase)*1.72:school?[-1.65,.85,3.35][Math.floor((i-1)/3)]:hospital?4.1:museum?1.25:-.4;
        const x=i===0?sx+(school&&lesson?1.45*Math.sin(phase):0):market?[-4.62,-1.88,.82][i-1]:school?[-3,0,3][(i-1)%3]:hospital?(i-2)*3:museum?(i-2)*.76:fire?-3.2:1.24;
        attributes.aInst.setXYZW(i,x+guideOffset,z,i===0?angle:market?Math.atan2(.16,Math.cos(phase)):school||museum?0:.14,t*4.4);
        attributes.aLook.setXYZ(i,.31+i*.18,.4+i*.13,.29+i*.12);
        const pupil=school&&i>0;
        attributes.aPose.setXY(i,pupil?.056:hospital&&i>0?.25:0,i===0?(school||museum?11:9):market?0:pupil||hospital?2:11);
        const uniform=fire?544:hospital&&i===0?1024:0;
        attributes.aVar.setXYZW(i,pupil?.63+(i%4)*.033:1-i*.025,pupil?64+(i%3?0:1):i+uniform,
          market&&i>0?.78*Math.abs(Math.cos(phase)):0,0);
      }
      for(const name of ['aInst','aLook','aPose','aVar']) attributes[name].needsUpdate=true;
      yaw+=(Number(pressed('ArrowLeft'))-Number(pressed('ArrowRight')))*dt*1.72;
      const advance=Number(pressed('w','ArrowUp'))-Number(pressed('s','ArrowDown'));
      const side=Number(pressed('a'))-Number(pressed('d'));
      const nx=T.MathUtils.clamp(eye.x+(Math.sin(yaw)*advance+Math.cos(yaw)*side)*dt*2.3,-5.65,5.65);
      const nz=T.MathUtils.clamp(eye.z+(Math.cos(yaw)*advance-Math.sin(yaw)*side)*dt*2.3,-6.65,6.65);
      if(!furniture.some(o=>Math.abs(o.x-nx)<o.w/2+.2&&Math.abs(o.z-nz)<o.d/2+.2)){
        eye.x=nx; eye.z=nz;
      }
      camera.position.copy(group.position).add(eye);
      target.set(Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),Math.cos(yaw)*Math.cos(pitch)).add(camera.position);
      camera.lookAt(target);
    },
    dispose(){
      group.removeFromParent();
      const materials=new Set();
      group.traverse(o=>{
        o.geometry?.dispose();
        if(o.material) materials.add(o.material);
      });
      for(const material of materials){material.map?.dispose();material.dispose();}
    },
  };
}
