import * as T from '../vendor/three.module.js';
import { buildCar } from '../drive/car/model.js';
import { ALL_CARS } from '../drive/physics/cars_extra.js';
import { walkingMeshes } from './population.js';

const spec=ALL_CARS.cclass;
const half={hl:spec.dims.len/2,hw:spec.dims.wid/2};

export function arrestWalk(box, targetX, targetZ) {
  const width=box.hw+.42, length=box.hl+.42, doorZ=box.hl*.17;
  const fromLocal=(across,along)=>[
    box.cx+box.rx*across+box.fx*along,
    box.cz+box.rz*across+box.fz*along,
  ];
  const dx=targetX-box.cx, dz=targetZ-box.cz;
  let across=dx*box.rx+dz*box.rz, along=dx*box.fx+dz*box.fz;
  if(Math.abs(across)<width&&Math.abs(along)<length){
    if(width-Math.abs(across)<=length-Math.abs(along)) across=across<0?-width:width;
    else along=along<0?-length:length;
  }
  const door=fromLocal(width,doorZ), target=fromLocal(across,along);
  if(across>=width) return [door,target];
  const paths=[];
  for(const end of [-length,length]){
    const corner=fromLocal(width,end);
    if(Math.sign(end)*along>=length) paths.push([door,corner,target]);
    if(across<=-width) paths.push([door,corner,fromLocal(-width,end),target]);
  }
  const distance=path=>path.slice(1).reduce((sum,[x,z],i)=>
    sum+Math.hypot(x-path[i][0],z-path[i][1]),0);
  return paths.reduce((best,path)=>distance(path)<distance(best)?path:best);
}

export function createPolice(world,ground,nearestStation) {
  const group=new T.Group();
  const model=buildCar(spec,{color:0xeaeceb,plate:'HV-017-PN',bodySections:44});
  const roof=new T.Mesh(new T.BoxGeometry(.9,.095,.29),new T.MeshStandardMaterial({
    color:0x214fb7,emissive:0x144cfa,emissiveIntensity:0,
  }));
  roof.position.set(0,spec.dims.hgt-spec.cg+.035,-.14);
  model.add(roof);
  model.visible=false;
  group.add(model);
  const officer=walkingMeshes(1);
  officer.mesh.visible=false;
  const uniform=officer.mesh.geometry.attributes;
  uniform.aLook.setXYZ(0,.67,.1,.44);
  group.add(officer.mesh);
  const {shape,wheels}=model.userData;
  wheels.forEach((wheel,i)=>{
    wheel.position.set((i%2?1:-1)*(i<2?spec.trackF:spec.trackR)/2,
      spec.wheel.radius-spec.cg,i<2?shape.a:-shape.b);
    wheel.scale.x=i%2?1:-1;
  });

  let state='quiet', notice='', elapsed=0, speeding=0, unseen=0, stopped=0, hold=0;
  let station=null;
  let x=0,z=0,fx=0,fz=1,speed=0,angle=0, box=null;
  let officerX=0,officerZ=0;
  const trail=[], route=[], officerRoute=[];

  function fallback(player) {
    const [u,v]=world.grid(player.cx,player.cz);
    let best=null, distance=Infinity;
    for(const road of world.roads){
      const along=road.alongX?u:v;
      const at=(off)=>road.alongX?world.point(Math.max(road.start,Math.min(road.end,along+off)),road.cross):
        world.point(road.cross,Math.max(road.start,Math.min(road.end,along+off)));
      const direction=road.alongX?Math.sign(player.fx):Math.sign(player.fz);
      const steps=[-69,-51,-35,-18,0].map(off=>at(off*(direction||1)));
      const end=steps.at(-1);
      const d=Math.hypot(player.cx-end[0],player.cz-end[1]);
      if(d<distance){distance=d;best=steps;}
    }
    return best;
  }

  function start(player, reason) {
    if(state!=='quiet') return;
    state='chase';
    notice=reason;
    unseen=stopped=0;
    const anchor=trail.findIndex(([px,pz])=>{
      const range=Math.hypot(px-player.cx,pz-player.cz);
      return range>44&&range<105;
    });
    const points=anchor>=0?trail.slice(anchor):fallback(player);
    route.push(...points);
    [x,z]=route.shift();
    const aim=route.find(([px,pz])=>Math.hypot(px-x,pz-z)>2) || [player.cx,player.cz];
    const heading=Math.atan2(aim[0]-x,aim[1]-z);
    fx=Math.sin(heading);fz=Math.cos(heading);speed=17;
  }

  function reset() {
    state='quiet'; notice=''; speeding=unseen=stopped=hold=0;
    station=null;
    model.visible=false; box=null;
    officer.mesh.visible=false;
    route.length=trail.length=officerRoute.length=0;
  }

  function step(dt,player,inTown,traffic) {
    elapsed+=dt;
    const point=[player.cx,player.cz];
    const last=trail.at(-1);
    if(!last||Math.hypot(last[0]-point[0],last[1]-point[1])>3.8){
      trail.push(point);
      if(trail.length>80) trail.shift();
      if(state==='chase' && route.length<96) route.push(point);
    }
    const playerSpeed=Math.hypot(player.vx,player.vz);
    if(state==='quiet'){
      speeding=inTown && playerSpeed>17.4?speeding+dt:Math.max(0,speeding-1.8*dt);
      if(speeding>=2) start(player,'Speeding');
      if(state==='quiet'){
        hold=Math.max(0,hold-dt);
        if(hold===0) notice='';
        return null;
      }
    }
    if(state==='arrest'){
      hold-=dt;
      if(hold<=0){
        const release={released:true,station};
        reset();
        return release;
      }
      const [targetX,targetZ]=officerRoute[0];
      const dx=targetX-officerX, dz=targetZ-officerZ;
      const distance=Math.hypot(dx,dz), stoppingDistance=officerRoute.length===1?.85:0;
      const stride=Math.min(2.45*dt,Math.max(0,distance-stoppingDistance));
      if(officerRoute.length>1&&distance<=stride) officerRoute.shift();
      officerX+=dx/(distance||1)*stride;
      officerZ+=dz/(distance||1)*stride;
      officer.time.value+=dt;
      uniform.aInst.setXYZW(0,officerX,officerZ,Math.atan2(dx,dz),officer.time.value*8);
      uniform.aPose.setXY(0,ground.height(officerX,officerZ),stride>0?0:11);
      uniform.aVar.setXYZW(0,1.02,256+32,stride/dt,0);
      officer.mesh.geometry.instanceCount=1;
      officer.mesh.visible=true;
      for(const attr of ['aInst','aPose','aVar']) uniform[attr].needsUpdate=true;
      return box;
    }

    const range=Math.hypot(player.cx-x,player.cz-z);
    if(range>138) unseen+=dt; else unseen=Math.max(0,unseen-dt*.8);
    if(unseen>6){
      reset();
      notice='Police lost you';
      hold=4;
      return null;
    }
    if(range<9 && playerSpeed<1.8) stopped+=dt; else stopped=Math.max(0,stopped-dt*2);
    if(stopped>1.45){
      state='arrest';
      station=nearestStation(player.cx,player.cz);
      const path=arrestWalk(box,player.cx+player.rx*1.42,player.cz+player.rz*1.42);
      [officerX,officerZ]=path[0];
      officerRoute.push(...path.slice(1));
      const distance=officerRoute.reduce((sum,[x,z],i)=>sum+Math.hypot(x-path[i][0],z-path[i][1]),0);
      hold=Math.max(3.8,distance/2.45+.65);
      speed=0;
      if(box){box.vx=0;box.vz=0;}
      return box;
    }

    while(route.length>1 && Math.hypot(route[0][0]-x,route[0][1]-z)<3.1) route.shift();
    const goal=route[0] || point;
    const gap=Math.hypot(goal[0]-x,goal[1]-z);
    const targetYaw=Math.atan2(goal[0]-x,goal[1]-z);
    const heading=Math.atan2(fx,fz);
    const turn=Math.atan2(Math.sin(targetYaw-heading),Math.cos(targetYaw-heading));
    let limit=range<6.8?0:Math.min(inTown?26:35,Math.max(7,gap*1.9));
    limit*=1-.72*Math.min(1,Math.abs(turn)/1.5);
    for(const other of traffic){
      const dx=other.cx-x,dz=other.cz-z;
      const ahead=dx*fx+dz*fz;
      if(ahead>0&&ahead<18&&Math.abs(dx*fz-dz*fx)<1.9)
        limit=Math.min(limit,Math.max(0,(ahead-other.hl-2.75)*1.55));
    }
    speed+=T.MathUtils.clamp(limit-speed,-10*dt,6.2*dt);
    const turnLimit=dt*Math.min(1.55,.64+9/Math.max(2,speed));
    const yaw=heading+T.MathUtils.clamp(turn,-turnLimit,turnLimit);
    fx=Math.sin(yaw);fz=Math.cos(yaw);
    const travel=Math.min(speed*dt,gap);
    x+=fx*travel;z+=fz*travel;
    if(route.length===1 && gap<2.2 && range>9 && Math.hypot(goal[0]-player.cx,goal[1]-player.cz)>5)
      route.shift();
    const y=ground.height(x,z);
    box={cx:x,cz:z,fx,fz,rx:fz,rz:-fx,y,mass:spec.mass,vx:fx*speed,vz:fz*speed,...half};
    model.visible=range<440;
    model.position.set(x-fx*(shape.zf+shape.zr)*.5,y+spec.cg,z-fz*(shape.zf+shape.zr)*.5);
    model.rotation.set(-Math.atan2(ground.height(x+fx,z+fz)-ground.height(x-fx,z-fz),2),yaw,0,'YXZ');
    angle+=travel/spec.wheel.radius;
    for(const wheel of wheels) wheel.userData.spin.rotation.x=angle;
    roof.material.emissiveIntensity=Math.floor(elapsed*9)%2?3.6:.08;
    model.userData.bodyU.uLamps.value=1;
    model.userData.bodyU.uBrake.value=limit<speed-.4?1:0;
    return box;
  }

  return {
    group,model,step,reset,
    reportCrash(player){start(player,'Traffic collision');},
    reportSpeed(player){start(player,'Mobile speed camera');},
    reportHeat(player){start(player,'Reckless driving');},
    detained:()=>state==='arrest',
    status:()=>state==='arrest'?(station?`Arrested · Being taken to ${station.name}`:'Arrested'):
      state==='chase'?`Police pursuit · ${notice}`:notice,
    sirens:()=>state==='chase'&&box?[{x:box.cx,y:box.y,z:box.cz,vx:box.vx,vz:box.vz,id:'pursuit'}]:[],
  };
}
