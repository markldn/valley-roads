import * as T from '../vendor/three.module.js';
import { surface } from '../render/visuals.js';
import { walkingMeshes } from '../traffic/population.js';
import { pedestrianPose } from './pedestrian.js';
import { random } from '../world/world.js';

export function inscription(text,color,background=null) {
  const art=document.createElement('canvas');
  art.width=320;art.height=128;
  const ctx=art.getContext('2d');
  if(background){ctx.fillStyle=background;ctx.fillRect(0,0,320,128);}
  ctx.fillStyle=color;
  ctx.font=background?'bold 34px system-ui':'italic 900 58px system-ui';
  ctx.textAlign='center';ctx.textBaseline='middle';
  if(!background){
    ctx.shadowColor='#270d1f';ctx.shadowBlur=11;ctx.shadowOffsetY=5;
    ctx.rotate(-.075);ctx.lineWidth=9;ctx.strokeStyle='#2e2030';
    ctx.strokeText(text,155,75,264);
  }
  ctx.fillText(text,background?160:155,background?64:75,264);
  const tex=new T.CanvasTexture(art);
  tex.colorSpace=T.SRGBColorSpace;
  const material=new T.MeshBasicMaterial({map:tex,transparent:!background,depthWrite:Boolean(background),side:T.DoubleSide});
  return new T.Mesh(new T.PlaneGeometry(background?2.65:3.4,background?.61:1.36),material);
}

export function createDistrictDetails(world,region,sites,ground,obstacles) {
  const group=new T.Group(), rng=random(world.seed^0x94c3d);
  const stone=surface(0x9d9382,{pattern: 'sandstone'});
  const weathered=surface(0x756959,{pattern:'gravel'});
  const brass=surface(0x968653,{roughness:.49,metalness:.43});
  const rubber=surface(0x377163,{pattern:'gravel'});
  const paint=surface(0xeee4bb);
  const red=surface(0xaf573c);
  const blue=surface(0x476879);
  const metal=surface(0x565754,{roughness:.68,metalness:.25});
  const water=surface(0x3e797b,{roughness:.21,metalness:.37});
  const box=new T.BoxGeometry();
  const sitesOnMap=[];
  function piece(parent,geometry,material,x,y,z,sx=1,sy=1,sz=1){
    const mesh=new T.Mesh(geometry,material);
    mesh.position.set(x,y,z);mesh.scale.set(sx,sy,sz);
    mesh.castShadow=mesh.receiveShadow=true;parent.add(mesh);
    return mesh;
  }
  function landmark(x,z,type){
    const node=new T.Group();
    const y=world.height(x,z);
    node.position.set(x,y,z);
    group.add(node);
    if(type==='fountain'){
      piece(node,new T.CylinderGeometry(3.4,3.7,.56,32),stone,0,.28,0);
      piece(node,new T.CylinderGeometry(3.05,3.05,.035,32),water,0,.57,0);
      piece(node,new T.TorusGeometry(3.22,.13,9,48).rotateX(Math.PI/2),stone,0,.66,0);
      piece(node,new T.CylinderGeometry(.31,.75,1.8,12),stone,0,1.4,0);
      piece(node,new T.CylinderGeometry(1.03,.47,.35,18),stone,0,2.25,0);
      piece(node,new T.OctahedronGeometry(.62),brass,0,2.96,0,.68,1.19,.64);
      obstacles.addPosts([[x,z]],3.5);
    }else if(type==='memorial'){
      piece(node,box,stone,0,.15,0,3.9,.29,3.9);
      piece(node,box,stone,0,.39,0,2.8,.23,2.8);
      piece(node,box,weathered,0,.85,0,1.73,.73,1.73);
      piece(node,new T.CylinderGeometry(.36,.62,3.25,9),stone,0,2.52,0);
      piece(node,new T.SphereGeometry(.49,12,8),brass,0,4.56,0,.5,.81,.42);
      const plate=inscription('Aux bâtisseurs','#ffeece','#514531');
      plate.scale.setScalar(.46);plate.position.set(0,.91,.88);node.add(plate);
      obstacles.addPosts([[x,z]],1.16);
    }else{
      const slab=piece(node,new T.DodecahedronGeometry(1,0),weathered,0,1.7,0,.73,2.26,.49);
      slab.rotation.set(.12,.37,-.08);
      piece(node,box,stone,0,.2,0,2.0,.36,1.25);
      const plaque=inscription(type==='peak'?'Belvédère':'Pierre levée','#f1e7cf','#574b3a');
      plaque.scale.setScalar(.58);
      plaque.position.set(0,.67,.68);node.add(plaque);
      obstacles.addPosts([[x,z]],.62);
      sitesOnMap.push({x,z,letter:type==='peak'?'▲':'◆'});
    }
  }
  world.roundabouts.forEach((circle,index)=>landmark(...world.point(circle.u,circle.v),index?'memorial':'fountain'));
  for(const path of world.mountainRoads){
    if(path.kind!=='tunnel')continue;
    for(const index of [path.portalStart,path.portalEnd]){
      const [x,z]=path.points[index];
      sitesOnMap.push({x,z,letter:'T'});
    }
  }
  const summit=world.mountainRoads.find(path=>path.kind==='summit');
  if(summit){
    const [x,z]=summit.points.at(-1);
    landmark(x+7,z+2,'peak');
  }
  for(let i=0,count=0;i<90&&count<4;i++){
    const angle=rng()*6.283,r=550+rng()*1370,x=Math.cos(angle)*r,z=Math.sin(angle)*r;
    const [u,v]=world.grid(x,z),road=world.roadDistance(u,v,true);
    if(road<5||road>55||world.land(x,z)>=2||world.towns.some(t=>Math.hypot(t.u-u,t.v-v)<t.radius))continue;
    landmark(x,z,'menhir');count++;
  }
  const tags=['RIVES','LE CHAT','FLEUR','V4','LES ORMES'];
  const graffiti=new Map();
  for(const lot of region.obstacles){
    if(!lot.front||rng()>.10||Math.hypot(lot.x,lot.z)>820)continue;
    const [nx,nz]=lot.front;
    const reach=lot.halfZ+.025, side=(rng()<.5?-1:1)*(lot.halfX*.53);
    const x=lot.x+nx*reach+nz*side, z=lot.z+nz*reach-nx*side;
    const text=tags[Math.floor(rng()*tags.length)], color=['#d3934d','#74b3ab','#dfa4ac'][Math.floor(rng()*3)];
    const key=text+color;
    if(!graffiti.has(key))graffiti.set(key,inscription(text,color));
    const mark=graffiti.get(key).clone();
    mark.rotation.y=Math.atan2(nx,nz);
    mark.position.set(x,world.height(lot.x,lot.z)+.85,z);
    group.add(mark);
  }

  const school=sites.find(site=>site.kind==='school');
  const neighborhood=school?region.obstacles.filter(lot=>Math.hypot(lot.x-school.x,lot.z-school.z)<190):[];
  const awayFromBuildings=(x,z)=>neighborhood.every(lot=>{
    const dx=x-lot.x,dz=z-lot.z;
    if(Math.abs(dx)>25||Math.abs(dz)>25)return true;
    const c=Math.cos(lot.rotation),s=Math.sin(lot.rotation);
    return Math.abs(dx*c-dz*s)>lot.halfX+1.35||Math.abs(dx*s+dz*c)>lot.halfZ+1.35;
  });
  const yard=school&&Array.from({length:390},(_,i)=>{
    const angle=i*2.39996,r=18+i*.37;
    return [school.x+Math.cos(angle)*r,school.z+Math.sin(angle)*r];
  }).find(([x,z])=>{
    const y=world.height(x,z);
    return [-7,0,7].every(dx=>[-5,0,5].every(dz=>{
      const px=x+dx,pz=z+dz;
      return world.roadDistance(...world.grid(px,pz),true)>2.7 && awayFromBuildings(px,pz) &&
        obstacles.clearance(px,pz)>1.6 && world.land(px,pz)<3 && Math.abs(world.height(px,pz)-y)<1;
    }));
  });
  const children=walkingMeshes(11);
  group.add(children.mesh);
  const attrs=children.mesh.geometry.attributes;
  const pupils=Array.from({length:11},(_,i)=>({phase:rng()*6.28,hue:rng(),trousers:rng(),skin:rng(),
    height:.59+rng()*.18,variant:64+(i%3===0?32:0)+(i%4===0?1:0)}));
  let ball=null;
  if(yard){
    const [x,z]=yard;
    const node=new T.Group();
    node.position.set(x,world.height(x,z),z);
    group.add(node);
    piece(node,box,rubber,0,.13,0,13.6,.23,9.7);
    for(const side of [-1,1]){
      piece(node,box,paint,side*6.1,.264,0,.08,.026,8.3);
      piece(node,box,paint,0,.264,side*4.13,12.3,.026,.08);
      piece(node,box,metal,side*6.18,1.09,-1.27,.09,1.95,.09);
      piece(node,box,metal,side*6.18,1.09,1.27,.09,1.95,.09);
      piece(node,box,red,side*6.18,2.06,0,.095,.095,2.64);
      for(let i=0;i<6;i++)piece(node,box,metal,side*6.58,.73,i*.49-1.22,.046,1.45,.046);
    }
    piece(node,new T.TorusGeometry(1.05,.024,5,28).rotateX(-Math.PI/2),paint,0,.267,0);
    const perimeter=[[-7,-5,7,-5],[-7,5,-1.1,5],[1.1,5,7,5],[-7,-5,-7,5],[7,-5,7,5]];
    const fences=[];
    for(const [a,b,c,d] of perimeter){
      const length=Math.hypot(c-a,d-b), midX=(a+c)/2,midZ=(b+d)/2;
      for(const elevation of [.58,1.04]){
        const rail=piece(node,box,metal,midX,elevation,midZ,.062,.067,length);
        rail.rotation.y=Math.atan2(c-a,d-b);
      }
      for(let i=0;i<=Math.ceil(length/2);i++){
        const f=i/Math.ceil(length/2);
        piece(node,box,metal,a+(c-a)*f,.58,b+(d-b)*f,.079,1.16,.079);
      }
      fences.push([x+a,z+b,x+c,z+d]);
    }
    obstacles.addBarriers(fences);
    const plaque=inscription('Cour de récréation','#f4ead6','#3d4f56');
    plaque.position.set(0,1.65,-5.3);node.add(plaque);
    piece(node,box,metal,-1.03,.81,-5.3,.055,1.64,.055);
    ball=piece(node,new T.IcosahedronGeometry(.19,1),blue,0,.43,0);
    sitesOnMap.push({x,z,letter:'J'});
  }

  function step(dt,hour,player,vehicles){
    children.time.value+=dt;
    const t=children.time.value;
    const atSchool=hour>=7.65&&hour<16.85;
    const playing=(hour>=8.0&&hour<8.65)||(hour>=10.05&&hour<10.65)||(hour>=12.15&&hour<13.5)||
      (hour>=15.1&&hour<15.55)||(hour>=16.1&&hour<17.25);
    const place=playing&&yard?yard:school?[school.x+school.nx*1.24,school.z+school.nz*1.24]:null;
    if(ball){
      ball.visible=playing;
      ball.position.x=Math.sin(t*.75)*4.1;
      ball.position.z=Math.sin(t*.47)*2.5;
      ball.position.y=.38+Math.abs(Math.sin(t*3.7))*.35;
      ball.rotation.z=t*3.2;
    }
    if(!atSchool||!place||Math.hypot(place[0]-player.cx,place[1]-player.cz)>165){
      children.mesh.geometry.instanceCount=0;return;
    }
    const [x,z]=place, recess=playing&&yard;
    const count=recess?pupils.length:(hour<8||hour>16?6:0);
    for(let i=0;i<count;i++){
      const child=pupils[i],a=child.phase+t*(.54+(i%3)*.17);
      const px=x+(recess?Math.sin(a)*(2.1+i%4):school.nz*(i-2.5)*.72);
      const pz=z+(recess?Math.cos(a)*(1.25+(i%3)*.57):-school.nx*(i-2.5)*.72);
      const face=recess?Math.atan2(Math.cos(a),-Math.sin(a)):Math.atan2(school.nx,school.nz)+Math.PI;
      const pose=pedestrianPose(child,px,pz,face,recess?2.75:0,t*8+child.phase,dt,vehicles,ground.height);
      attrs.aInst.setXYZW(i,pose.x,pose.z,pose.yaw,pose.phase);
      attrs.aLook.setXYZ(i,child.hue,child.trousers,child.skin);
      const lift=recess&&Math.hypot(pose.x-x,pose.z-z)<4.6 ? .24 : 0;
      attrs.aPose.setXY(i,pose.y+lift,pose.reaction||(recess?0:11));
      attrs.aVar.setXYZW(i,child.height,child.variant,pose.speed,0);
    }
    children.mesh.geometry.instanceCount=count;
    for(const key of ['aInst','aLook','aPose','aVar'])attrs[key].needsUpdate=true;
  }
  return {group,step,sitesOnMap,pupilCount:school?pupils.length:0};
}
