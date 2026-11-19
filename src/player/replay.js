// Instant replay: the last seconds are recorded as object poses and shown again from new camera angles,
// slowing down around the moment of impact while the body visibly crumples.
import * as T from '../vendor/three.module.js';
import { showCabinView } from '../drive/car/model.js';

const KEEP=14, RATE=1/30, POSE_SIZE=10;
const DAMAGE_ATTRIBUTES=['position','aDmg','normal'];

function snapshotGeometry(geometry){
  const arrays={};
  for(const name of DAMAGE_ATTRIBUTES){
    const attribute=geometry.attributes[name];
    if(attribute)arrays[name]=attribute.array.slice();
  }
  return arrays;
}

function snapshotDamage(model){
  const {shell,structureSkin,fittings,dents}=model.userData;
  const parts=new Map();
  for(const {mesh,original} of structureSkin??[])
    parts.set(mesh,{geometry:mesh.geometry,original,arrays:snapshotGeometry(mesh.geometry)});
  return {shell:snapshotGeometry(shell.geometry),parts,fittingsVisible:Boolean(fittings&&!dents)};
}

function applyGeometry(geometry,from,to,blend){
  for(const name of DAMAGE_ATTRIBUTES){
    const attribute=geometry.attributes[name], start=from[name], finish=to?.[name];
    if(!attribute||!start)continue;
    if(!finish||blend===0)attribute.array.set(start);
    else if(blend===1)attribute.array.set(finish);
    else for(let i=0;i<start.length;i++)attribute.array[i]=T.MathUtils.lerp(start[i],finish[i],blend);
    attribute.needsUpdate=true;
  }
}

function applyDamageFrame(model,before,after,blend,live){
  const {shell,fittings}=model.userData;
  applyGeometry(shell.geometry,before.shell,after?.shell,blend);
  if(fittings)fittings.visible=blend>0&&after?after.fittingsVisible:before.fittingsVisible;
  for(const [mesh,final] of live.parts){
    const old=before.parts.get(mesh), next=after?.parts.get(mesh);
    if(!old&&(!next||blend===0)){
      mesh.geometry=final.original;
      continue;
    }
    mesh.geometry=(next??old).geometry;
    const start=old?.arrays??Object.fromEntries(DAMAGE_ATTRIBUTES
      .filter(name=>final.original.attributes[name]).map(name=>[name,final.original.attributes[name].array]));
    applyGeometry(mesh.geometry,start,next?.arrays,blend);
  }
}

export function createReplay() {
  let frames=[], clock=0, gap=0, hits=[];
  let obstacles=null, active=false, time=0, start=0, end=0, impact=null, seen=new Map(), live=new Map(), onDone=null, ground=null, car=null, wheelList=[];
  let orbit=0, anchor=null, anchorShot=-1;
  let liveDamage=null, appliedHit=null, appliedBlend=-1, damageStart=0;
  const eye=new T.Vector3(), aim=new T.Vector3(), q0=new T.Quaternion(), q1=new T.Quaternion();
  const seatEye=new T.Vector3(), seatAim=new T.Vector3(), seatUp=new T.Vector3();
  let view=null;
  const readPose=(object,data,i)=>{
    data[i]=object.position.x;data[i+1]=object.position.y;data[i+2]=object.position.z;
    data[i+3]=object.quaternion.x;data[i+4]=object.quaternion.y;data[i+5]=object.quaternion.z;data[i+6]=object.quaternion.w;
    data[i+7]=object.visible?1:0;
    if(object.userData.replaySpin)data[i+8]=object.rotation.x;
    if(object.userData.replayArticulation)data[i+9]=object.userData.replayArticulation.value;
  };
  function frameAt(t) {
    let lo=0,hi=frames.length-1;
    while(hi-lo>1){const mid=(lo+hi)>>1;if(frames[mid].t<=t)lo=mid;else hi=mid;}
    return [frames[lo],frames[hi]];
  }
  function focusAt(t) {
    const [a,b]=frameAt(t), f=T.MathUtils.clamp((t-a.t)/Math.max(1e-4,b.t-a.t),0,1);
    return [a.data[0]+(b.data[0]-a.data[0])*f,a.data[1]+(b.data[1]-a.data[1])*f,a.data[2]+(b.data[2]-a.data[2])*f];
  }
  function showFrame(t) {
    const [a,b]=frameAt(t), f=T.MathUtils.clamp((t-a.t)/Math.max(1e-4,b.t-a.t),0,1);
    for(const object of seen.keys())object.visible=false;
    const later=new Map(b.objects.map((object,i)=>[object,i]));
    a.objects.forEach((object,i)=>{
      const p=i*POSE_SIZE, j=later.get(object), n=j===undefined?p:j*POSE_SIZE, other=j===undefined?a.data:b.data;
      object.position.set(a.data[p]+(other[n]-a.data[p])*f,a.data[p+1]+(other[n+1]-a.data[p+1])*f,a.data[p+2]+(other[n+2]-a.data[p+2])*f);
      if(object.userData.replaySpin)object.rotation.x=T.MathUtils.lerp(a.data[p+8],other[n+8],f);
      else{
        q0.set(a.data[p+3],a.data[p+4],a.data[p+5],a.data[p+6]);q1.set(other[n+3],other[n+4],other[n+5],other[n+6]);
        object.quaternion.copy(q0).slerp(q1,f);
      }
      object.visible=a.data[p+7]>.5;
      if(object.userData.replayArticulation)
        object.userData.replayArticulation.value=T.MathUtils.lerp(a.data[p+9],other[n+9],f);
    });
    wheelList.forEach((wheel,i)=>{wheel.visible=!(a.broken&(1<<i));});
    if(hits.length){
      let i=hits.length-1;
      while(i>0&&hits[i].t>t)i--;
      const hit=hits[i], fold=T.MathUtils.clamp((t-hit.t)/.16,0,1);
      if(hit!==appliedHit||fold!==appliedBlend){
        applyDamageFrame(hit.model,hit.before,hits[i+1]?.before??liveDamage,fold,liveDamage);
        appliedHit=hit;
        appliedBlend=fold;
      }
    }
  }
  // From the driver's seat, looking where the car is pointing, with the same cabin the live view shows.
  function seatCamera(camera) {
    showCabinView(car,view);
    car.updateMatrixWorld();
    seatEye.copy(car.userData.cockpit).applyQuaternion(car.quaternion).add(car.position);
    seatAim.set(0,0,15).applyQuaternion(car.quaternion).add(seatEye);
    seatAim.y-=view.clear?.35:1.45;
    seatUp.set(0,1,0).applyQuaternion(car.quaternion);
    const fov=view.clear?72:67;
    if(camera.fov!==fov||camera.near!==.085){camera.fov=fov;camera.near=.085;camera.updateProjectionMatrix();}
    camera.up.copy(seatUp);camera.position.copy(seatEye);camera.lookAt(seatAim);
  }
  function aimCamera(camera,dt) {
    const [x,y,z]=focusAt(time), hitAt=impact?.t??end;
    aim.set(x,y+.2,z);
    let fov=40;
    if(time<hitAt-2.3){
      // A spectator further down the road watches the car come past.
      const shot=Math.floor((time-start)/3);
      if(anchorShot!==shot){
        anchorShot=shot;
        const [ax,,az]=focusAt(Math.min(end,time+2.2)), [bx,,bz]=focusAt(Math.min(end,time+2.4));
        const dx=bx-ax,dz=bz-az,len=Math.hypot(dx,dz)||1,side=shot%2?1:-1;
        anchor=[ax+dz/len*side*8.5,az-dx/len*side*8.5];
      }
      eye.set(anchor[0],ground.height(anchor[0],anchor[1])+1.3,anchor[1]);fov=30;
    }else if(time<hitAt+.9){
      // Low and close to the point of impact.
      const [px,py,pz]=impact?.P??[x,y,z], [nx,nz]=impact?.side??[1,0];
      eye.set(px+nx*7+nz*4.5,Math.max(py-.1,ground.height(px+nx*7+nz*4.5,pz+nz*7-nx*4.5)+.45),pz+nz*7-nx*4.5);fov=38;
    }else{
      orbit+=dt*.55;
      eye.set(x+Math.sin(orbit)*7.5,y+1.5,z+Math.cos(orbit)*7.5);fov=44;
    }
    for(let i=0;i<12&&obstacles?.queryBall(eye.x,eye.z,eye.y,.8);i++)eye.lerp(aim,.16);
    eye.y=Math.max(eye.y,ground.height(eye.x,eye.z,y)+.35);
    if(camera.fov!==fov||camera.near!==.3){camera.fov=fov;camera.near=.3;camera.updateProjectionMatrix();}
    camera.up.set(0,1,0);camera.position.copy(eye);camera.lookAt(aim);
  }
  function stop() {
    if(!active)return;
    active=false;
    for(const [object,pose] of live){
      object.position.set(pose[0],pose[1],pose[2]);object.quaternion.set(pose[3],pose[4],pose[5],pose[6]);object.visible=pose[7]>.5;
      if(object.userData.replaySpin)object.rotation.x=pose[8];
      if(object.userData.replayArticulation)object.userData.replayArticulation.value=pose[9];
    }
    const last=hits.at(-1);
    if(last&&liveDamage)applyDamageFrame(last.model,liveDamage,liveDamage,0,liveDamage);
    liveDamage=null;
    if(view&&(view.cockpit||view.clear))showCabinView(car,{lightsOn:view.lightsOn});
    view=null;
    onDone?.();
  }
  return {
    get active(){return active;},
    get ready(){return frames.length>30;},
    clear(){frames=[];hits=[];damageStart=0;},
    // objects[0] must be the player's car.
    record(dt,objects,brokenMask) {
      clock+=dt;gap+=dt;
      if(gap<RATE)return;
      gap=0;
      const data=new Float32Array(objects.length*POSE_SIZE);
      objects.forEach((object,i)=>{
        const start=i*POSE_SIZE;
        readPose(object,data,start);
        if(object.userData.replayVisible!==undefined)data[start+7]=Number(object.userData.replayVisible);
      });
      frames.push({t:clock,objects,data,broken:brokenMask});
      while(frames.length&&frames[0].t<clock-KEEP)frames.shift();
      while(hits.length&&hits[0].t<clock-KEEP)hits.shift();
    },
    // Capture before applying damage, and keep the snapshot only when it changed the car.
    captureHit(model,hit,forward,dt=0) {
      if(hits.length&&clock-hits.at(-1).t<.5)return;
      const n=hit.n, side=Math.abs(n[0]*forward[2]-n[2]*forward[0])>.5?[n[0],n[2]]:[forward[2],-forward[0]];
      const event={t:clock+dt,model,before:snapshotDamage(model),P:hit.P,side,strength:hit.j};
      return ()=>{
        hits.push(event);
        if(hits.length>4)damageStart=hits.shift().t+.16;
      };
    },
    begin(setup) {
      if(active||frames.length<12)return false;
      ({ground,car,wheels:wheelList=[],onDone,obstacles}=setup);
      // The replay is filmed the way you were driving: from the seat in Cockpit and Clear view, from outside otherwise.
      view={cockpit:setup.mode===1,clear:setup.mode===2,lightsOn:Boolean(setup.lightsOn)};
      impact=hits.reduce((best,hit)=>!best||hit.strength>best.strength?hit:best,null);
      const last=frames.at(-1).t, first=frames[0].t;
      const centre=impact?impact.t:last-3;
      start=Math.max(first,centre-6,damageStart);end=Math.min(last,centre+3.6);time=start;
      liveDamage=hits.length?snapshotDamage(hits.at(-1).model):null;
      appliedHit=null;
      seen=new Map();live=new Map();
      for(const frame of frames)for(const object of frame.objects)seen.set(object,true);
      for(const object of seen.keys()){const pose=new Float32Array(POSE_SIZE);readPose(object,pose,0);live.set(object,pose);}
      anchorShot=-1;orbit=Math.random()*6.28;active=true;
      return true;
    },
    step(dt,camera) {
      const hitAt=impact?.t;
      const slow=hitAt!==undefined&&Math.abs(time-hitAt)<1?.28:1;
      time+=dt*slow;
      if(time>=end){stop();return null;}
      showFrame(time);
      if(view&&(view.cockpit||view.clear))seatCamera(camera);else aimCamera(camera,dt);
      return focusAt(time);
    },
    stop,
  };
}
