// Speed limit signs on every road, fixed radar cabins and portable speed cameras.
import * as T from '../vendor/three.module.js';
import { instances, terrainSurfaceSampler } from '../world/scenery.js';
import { inscription } from '../people/district.js';
import { random } from '../world/world.js';
import { SPEED, fineFor, isMainRoad } from './speed-limits.js';
import { walkingMeshes } from './population.js';

const REPEAT={[SPEED.town]:280,[SPEED.taper]:9999,[SPEED.country]:850,[SPEED.main]:1000,[SPEED.motorway]:1400};
const TOLERANCE=5;

function roundel(limit) {
  const art=document.createElement('canvas');
  art.width=art.height=256;
  const ctx=art.getContext('2d');
  ctx.fillStyle='#d3d6d4';ctx.fillRect(0,0,256,256);
  ctx.beginPath();ctx.arc(128,128,126,0,Math.PI*2);ctx.fillStyle='#c5161d';ctx.fill();
  ctx.beginPath();ctx.arc(128,128,94,0,Math.PI*2);ctx.fillStyle='#fbfaf4';ctx.fill();
  ctx.fillStyle='#14161a';ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.font=`900 ${limit>=100?92:122}px system-ui,sans-serif`;
  ctx.fillText(String(limit),128,136,168);
  const texture=new T.CanvasTexture(art);
  texture.colorSpace=T.SRGBColorSpace;
  texture.anisotropy=8;
  return texture;
}

// Lamp posts bend and fall when hit hard, and stop a slow car.
export function solidStreetFurniture(region,obstacles,debris) {
  const hidden=new T.Matrix4().makeScale(0,0,0);
  const conceal=([mesh,index])=>{mesh.setMatrixAt(index,hidden);mesh.instanceMatrix.needsUpdate=true;};
  for(const {post,lantern} of region.lampFixtures){
    const [x,y,z]=post;
    obstacles.addBreakableProp(x,z,.11,(car,impulse)=>{
      conceal(post.instance);conceal(lantern.instance);
      const [mesh]=post.instance;
      const fallen=new T.Mesh(new T.CylinderGeometry(.053,.053,3.8,7),mesh.material);
      fallen.position.set(x,y,z);
      fallen.userData.ownGeometry=true;
      const push=Math.min(7,impulse/500);
      debris.add(fallen,{kind:'box',mass:95,h:[.06,1.9,.06],
        v:new T.Vector3(car.v[0]*.32,1+push*.2,car.v[2]*.32),w:new T.Vector3(car.v[2]*.3,0,-car.v[0]*.3),owner:region.group});
    },{mass:95,threshold:1500,bottom:y-2,top:y+2});
  }
}

export function createRoadControls(world,ground,obstacles,debris) {
  const group=new T.Group(), rng=random(world.seed^0x51a7e);
  const terrain=terrainSurfaceSampler(world);
  const faces=new Map(), backs=[], posts=[], sites=[];
  const zoneAt=(road,along)=>{
    const [u,v]=road.alongX?[along,road.cross]:[road.cross,along];
    if(road.highway){
      const [x,z]=world.point(u,v);
      return ground.motorway(x,z)?.speedLimit??SPEED.taper;
    }
    if(world.towns.some(town=>Math.hypot(town.u-u,town.v-v)<town.radius))return SPEED.town;
    return isMainRoad(road)?SPEED.main:SPEED.country;
  };
  const townAt=(road,along)=>{
    const [u,v]=road.alongX?[along,road.cross]:[road.cross,along];
    return world.towns.find(town=>Math.hypot(town.u-u,town.v-v)<town.radius);
  };
  // A verge point on the driver's right, or null when something else occupies it.
  function verge(road,along,direction,extra=0) {
    const half=road.highway?world.motorwayWidth(road,along)*.5:road.width*.5;
    const across=road.cross+(road.alongX?1:-1)*direction*(half+1.5+extra);
    const [u,v]=road.alongX?[along,across]:[across,along];
    const [x,z]=world.point(u,v);
    if(world.land(x,z)>=3||world.riverEdge(x,z)<7)return null;
    if(world.roadDistance(u,v,true)<.8||(world.nearestStreet(u,v)?.edge??9)<.9)return null;
    const [ax,az]=road.alongX?world.point(along+direction,across):world.point(across,along+direction);
    return {x,z,y:terrain(x,z),yaw:Math.atan2(ax-x,az-z)};
  }
  function plant(road,along,direction,limit,town) {
    for(const shift of [0,-7,7,-14,14]){
      const spot=verge(road,along+shift*direction,direction);
      if(!spot)continue;
      const {x,y,z,yaw}=spot, big=limit===SPEED.motorway||road.highway;
      const height=big?2.9:2.35, radius=big?.62:.44;
      const index=(faces.get(limit)||faces.set(limit,[]).get(limit)).length;
      faces.get(limit).push([x,y+height,z,radius*2,radius*2,1,yaw+Math.PI,0xffffff]);
      const backIndex=backs.length;
      backs.push([x+Math.sin(yaw)*.012,y+height,z+Math.cos(yaw)*.012,radius*2,radius*2,1,yaw,0x8d9193]);
      const postIndex=posts.length;
      const stemHeight=height-radius+.045;
      posts.push([x+Math.sin(yaw)*.055,y+stemHeight*.5,z+Math.cos(yaw)*.055,.04,stemHeight,.04,0,0x8e9496]);
      planted.push({limit,index,backIndex,postIndex,x,y,z,yaw,height,radius});
      if(town){
        const panel=inscription(town.name,'#191919','#f6f3e8');
        panel.scale.setScalar(.62);
        panel.position.set(x,y+height-radius-.34,z);
        panel.rotation.y=yaw+Math.PI;
        group.add(panel);
        planted.at(-1).panel=panel;
      }
      return true;
    }
    return false;
  }
  const planted=[];
  for(const road of world.roads)for(const [start,end] of road.spans)for(const direction of [-1,1]){
    const first=direction>0?start+30:end-30, last=direction>0?end-20:start+20;
    let zone=null, lastSign=-Infinity, travelled=0;
    for(let along=first;(last-along)*direction>0;along+=direction*12,travelled+=12){
      const limit=zoneAt(road,along);
      const entering=limit!==zone;
      if(entering||travelled-lastSign>=REPEAT[limit]){
        const town=entering&&limit===SPEED.town&&zone!==null?townAt(road,along):null;
        if(plant(road,along,direction,limit,town)){zone=limit;lastSign=travelled;}
      }
      if(travelled%180===0){
        const spot=verge(road,along,direction,.9);
        if(spot&&limit!==SPEED.taper&&Math.abs(along-first)>60)
          sites.push({...spot,limit,dx:Math.sin(spot.yaw),dz:Math.cos(spot.yaw)});
      }
    }
  }
  // Off-ramps announce their own limit at the point where they leave the motorway.
  for(const path of world.ramps){
    if(!path.offRamp||path.points.length<12)continue;
    const i=Math.min(8,path.points.length-3), [px,pz]=path.points[i], [qx,qz]=path.points[i+1];
    const length=Math.hypot(qx-px,qz-pz)||1,dx=(qx-px)/length,dz=(qz-pz)/length;
    const x=px+dz*(path.width*.5+.8),z=pz-dx*(path.width*.5+.8),y=path.elevations[i];
    const yaw=Math.atan2(dx,dz);
    const index=(faces.get(SPEED.ramp)||faces.set(SPEED.ramp,[]).get(SPEED.ramp)).length;
    faces.get(SPEED.ramp).push([x,y+2.3,z,.88,.88,1,yaw+Math.PI,0xffffff]);
    backs.push([x+dx*.012,y+2.3,z+dz*.012,.88,.88,1,yaw,0x8d9193]);
    posts.push([x+dx*.055,y+.9525,z+dz*.055,.04,1.905,.04,0,0x8e9496]);
    planted.push({limit:SPEED.ramp,index,backIndex:backs.length-1,postIndex:posts.length-1,x,y,z,yaw,height:2.3,radius:.44});
  }

  const disc=new T.CircleGeometry(.5,28), pole=new T.CylinderGeometry(1,1,1,8), box=new T.BoxGeometry();
  const textures=[], materials=[];
  const faceMeshes=new Map();
  for(const [limit,records] of faces){
    const map=roundel(limit);
    const material=new T.MeshStandardMaterial({map,emissiveMap:map,emissive:0xffffff,emissiveIntensity:.34,roughness:.55});
    textures.push(map);materials.push(material);
    const mesh=instances(disc,records,material,false);
    faceMeshes.set(limit,mesh);
    group.add(mesh);
  }
  const steel=new T.MeshStandardMaterial({color:0xffffff,roughness:.5,metalness:.5});
  materials.push(steel);
  const backMesh=instances(disc,backs,steel,false), postMesh=instances(pole,posts,steel);
  group.add(backMesh,postMesh);
  const hidden=new T.Matrix4().makeScale(0,0,0);
  obstacles.beginOwner('road-signs');
  for(const sign of planted){
    obstacles.addBreakableProp(sign.x,sign.z,.07,(car,impulse)=>{
      const face=faceMeshes.get(sign.limit);
      face.setMatrixAt(sign.index,hidden);face.instanceMatrix.needsUpdate=true;
      backMesh.setMatrixAt(sign.backIndex,hidden);backMesh.instanceMatrix.needsUpdate=true;
      postMesh.setMatrixAt(sign.postIndex,hidden);postMesh.instanceMatrix.needsUpdate=true;
      sign.panel?.removeFromParent();
      const wreck=new T.Group();
      wreck.position.set(sign.x,sign.y+sign.height*.5,sign.z);
      wreck.rotation.y=sign.yaw+Math.PI;
      const plate=new T.Mesh(disc,face.material);
      plate.position.y=sign.height*.5;plate.scale.setScalar(sign.radius*2);
      const stem=new T.Mesh(pole,steel);
      stem.scale.set(.04,sign.height-sign.radius+.045,.04);
      stem.position.set(0,-(sign.radius-.045)*.5,-.055);
      wreck.add(plate,stem);
      const push=Math.min(13,impulse/60);
      debris.add(wreck,{kind:'box',mass:14,h:[sign.radius,sign.height*.5,.05],
        v:new T.Vector3(car.v[0]*.75+Math.sign(car.v[0])*push*.2,3+push*.25,car.v[2]*.75+Math.sign(car.v[2])*push*.2),
        w:new T.Vector3(5+push*.4,2,-4),owner:group});
    },{mass:14,threshold:260,bottom:sign.y-.2,top:sign.y+sign.height+.5});
  }
  obstacles.endOwner();

  // ---- Fixed radar cabins. Each one is switched on and off at random, like the real ones.
  const usable=[...sites];
  for(let i=usable.length-1;i>0;i--){
    const j=Math.floor(rng()*(i+1));
    [usable[i],usable[j]]=[usable[j],usable[i]];
  }
  const cabins=[], roving=[];
  for(const site of usable){
    const apart=list=>list.every(other=>Math.hypot(other.x-site.x,other.z-site.z)>520);
    if(cabins.length<20&&apart(cabins))cabins.push({...site,active:rng()<.6,next:40+rng()*200,cooldown:0});
    else if(roving.length<40&&apart(roving))roving.push(site);
  }
  const cabinRecords=[],lensRecords=[],stemRecords=[];
  for(const cabin of cabins){
    const {x,y,z,yaw}=cabin, sx=Math.sin(yaw), sz=Math.cos(yaw);
    stemRecords.push([x,y+.85,z,.13,1.7,.13,0,0x6d7477]);
    cabinRecords.push([x,y+2.25,z,.56,1.25,.62,yaw,0x8c9499]);
    lensRecords.push([x-sx*.33,y+2.45,z-sz*.33,.3,.3,.05,yaw,0x15181b]);
    lensRecords.push([x-sx*.33,y+2.05,z-sz*.33,.3,.2,.05,yaw,0xe9e4c8]);
  }
  const housing=new T.MeshStandardMaterial({color:0xffffff,roughness:.45,metalness:.35});
  materials.push(housing);
  if(cabins.length)group.add(instances(box,cabinRecords,housing),instances(box,lensRecords,housing,false),instances(pole,stemRecords,housing));
  obstacles.beginOwner('radar-cabins');
  obstacles.addPosts(cabins.map(({x,z})=>[x,z]),.32);
  obstacles.endOwner();

  const workSites=[], cones=[], workBoxes=[];
  for(const site of usable){
    if(workSites.length>=8)break;
    if(site.limit===SPEED.motorway||cabins.some(c=>Math.hypot(c.x-site.x,c.z-site.z)<45)||
      workSites.some(c=>Math.hypot(c.x-site.x,c.z-site.z)<650))continue;
    const {x,z,dx,dz,yaw}=site, rx=dz, rz=-dx;
    if([-9,9].some(d=>world.roadDistance(...world.grid(x+dx*d,z+dz*d),true)<.7))continue;
    workSites.push({...site,x:x-rx*.8,z:z-rz*.8});
    for(let d=-9;d<=9;d+=3){
      const cx=x+dx*d,cz=z+dz*d,y=terrain(cx,cz);
      cones.push([cx,y+.23,cz,.16,.46,.16,0,0xf37c24]);
      workBoxes.push([cx,y+.025,cz,.39,.05,.39,yaw,0x383432]);
      workBoxes.push([cx,y+.23,cz,.18,.11,.18,yaw,0xf6eee0]);
    }
    const sign=inscription('ROAD WORKS','#29251c','#f5b840');
    sign.position.set(x-dx*13,terrain(x-dx*13,z-dz*13)+1.15,z-dz*13);
    sign.rotation.y=yaw+Math.PI;sign.scale.setScalar(.65);
    group.add(sign);
    workBoxes.push([sign.position.x,sign.position.y-.62,sign.position.z,.10,1.18,.10,yaw,0x45413a]);
  }
  const portableSites=roving.filter(site=>workSites.every(work=>Math.hypot(site.x-work.x,site.z-work.z)>35));
  const cone=new T.ConeGeometry(1,1,10);
  if(workSites.length)group.add(instances(cone,cones,housing),instances(box,workBoxes,housing));
  const workers=walkingMeshes(workSites.length);
  group.add(workers.mesh);
  materials.push(workers.mesh.material);
  const workerAttrs=workers.mesh.geometry.attributes;

  const cameraDark=new T.MeshStandardMaterial({color:0x202630,roughness:.55});
  const cameraYellow=new T.MeshStandardMaterial({color:0xe7af29,roughness:.5});
  materials.push(cameraDark,cameraYellow);
  const units=[0,1].map(()=>{
    const model=new T.Group();
    const part=(geometry,material,x,y,z,w,h,d)=>{
      const mesh=new T.Mesh(geometry,material);
      mesh.position.set(x,y,z);mesh.scale.set(w,h,d);
      mesh.castShadow=true;model.add(mesh);
    };
    part(box,cameraDark,0,.10,0,.66,.20,.55);
    part(pole,housing,0,.86,0,.075,1.55,.075);
    part(box,cameraYellow,0,1.68,0,.44,.40,.36);
    part(box,cameraDark,0,1.72,.19,.25,.19,.03);
    part(box,housing,0,1.53,.19,.19,.07,.03);
    model.visible=false;group.add(model);
    return {model,site:null,next:0,cooldown:0,box:null};
  });
  function park(unit,site) {
    const {x,y,z,yaw,dx,dz}=site;
    unit.site=site;
    unit.model.position.set(x,y,z);
    unit.model.rotation.y=yaw+Math.PI;
    unit.model.visible=true;
    unit.box={cx:x,cz:z,fx:dx,fz:dz,rx:dz,rz:-dx,y,hl:.28,hw:.33,mass:95,vx:0,vz:0};
    unit.next=150+rng()*240;
  }
  units.forEach((unit,i)=>{if(portableSites[i])park(unit,portableSites[i]);});

  const flash=new T.Mesh(new T.SphereGeometry(.26,10,8),new T.MeshBasicMaterial({color:0xfdfdf4,toneMapped:false}));
  flash.visible=false;
  group.add(flash);
  let flashTime=0, fines=0, tickets=0;

  function caught(site,player,speed) {
    const dx=site.x-player.cx, dz=site.z-player.cz;
    const ahead=dx*site.dx+dz*site.dz, side=Math.abs(dx*site.dz-dz*site.dx);
    if(ahead<0||ahead>32||side>15||Math.abs(site.y-player.y)>5)return false;
    return (player.vx*site.dx+player.vz*site.dz)>speed/3.6*.75&&speed>site.limit+TOLERANCE;
  }
  function update(dt,player,hour=8.5) {
    workers.time.value+=dt;
    let count=0;
    if(hour>=7&&hour<18)for(const [i,site] of workSites.entries()){
      if(Math.hypot(site.x-player.cx,site.z-player.cz)>160)continue;
      const step=Math.sin(workers.time.value*.48+i)*3;
      const x=site.x+site.dx*step,z=site.z+site.dz*step;
      workerAttrs.aInst.setXYZW(count,x,z,site.yaw+(Math.cos(workers.time.value*.48+i)<0?Math.PI:0),workers.time.value*4);
      workerAttrs.aLook.setXYZ(count,.05,.12,.22+i*.05);
      workerAttrs.aPose.setXY(count,terrain(x,z),0);
      workerAttrs.aVar.setXYZW(count++,1,32,1.3*Math.abs(Math.cos(workers.time.value*.48+i)),0);
    }
    workers.mesh.geometry.instanceCount=count;
    for(const name of ['aInst','aLook','aPose','aVar'])workerAttrs[name].needsUpdate=true;
    flashTime=Math.max(0,flashTime-dt);
    flash.visible=flashTime>0;
    const speed=Math.round(Math.hypot(player.vx,player.vz)*3.6);
    let event=null;
    const record=(site,mobile)=>{
      const excess=speed-site.limit, fine=fineFor(excess);
      fines+=fine;tickets++;
      flash.position.set(site.x-site.dx*.21,site.y+(mobile?1.53:2.1),site.z-site.dz*.21);flashTime=.16;
      flash.visible=true;
      event={speed,limit:site.limit,excess,fine,mobile,total:fines,tickets};
    };
    for(const cabin of cabins){
      cabin.next-=dt;cabin.cooldown=Math.max(0,cabin.cooldown-dt);
      if(cabin.next<=0){cabin.active=rng()<.6;cabin.next=45+rng()*240;}
      if(cabin.active&&!cabin.cooldown&&!event&&caught(cabin,player,speed)){cabin.cooldown=9;record(cabin,false);}
    }
    for(const unit of units){
      if(!unit.site)continue;
      unit.next-=dt;unit.cooldown=Math.max(0,unit.cooldown-dt);
      const away=site=>Math.hypot(site.x-player.cx,site.z-player.cz)>420;
      if(unit.next<=0&&away(unit.site)){
        const free=portableSites.filter(site=>away(site)&&units.every(other=>other.site!==site));
        if(free.length)park(unit,free[Math.floor(rng()*free.length)]);
        else unit.next=30;
      }
      if(!unit.cooldown&&!event&&caught(unit.site,player,speed)){unit.cooldown=9;record(unit.site,true);}
    }
    return event;
  }
  return {group,update,workSites,boxes:()=>units.map(unit=>unit.box).filter(Boolean),
    signCount:planted.length,radarCount:cabins.length,cabins,signs:planted,
    get fines(){return fines;},reset(){fines=tickets=0;},dispose(){
      obstacles.removeOwner('road-signs');obstacles.removeOwner('radar-cabins');
      for(const texture of textures)texture.dispose();
      for(const material of materials)material.dispose();
      for(const geometry of [disc,pole,box,cone,workers.mesh.geometry,flash.geometry])geometry.dispose();
      flash.material.dispose();
    }};
}
