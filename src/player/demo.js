// The attract mode: the game drives itself through a random world while the camera cuts between shots.
// It steers, brakes and accelerates through the normal car controls, so the physics are the real ones.
import * as T from '../vendor/three.module.js';

const SHOTS=['chase','roadside','front','cockpit','side','heli','wheel','orbit','high'];
const clamp=T.MathUtils.clamp;

export function createDemo({world,ground,population,getVehicle,setCameraMode}) {
  const network=population.network;
  const starts=network.starts.filter(edge=>edge.road&&edge.length>120);
  let points=[], index=0, edge=null, destination='', stuck=0;
  let shot='chase', shotTime=0, shotLength=7, order=0, anchor=null, orbit=0;
  const eye=new T.Vector3(), target=new T.Vector3();

  function extend() {
    let ahead=0;
    for(let i=index+1;i<points.length;i++)ahead+=Math.hypot(points[i][0]-points[i-1][0],points[i][1]-points[i-1][1]);
    while(ahead<320){
      const trip=network.trip(edge.to,Math.random,destination);
      destination=trip.name;
      for(const next of trip.path){
        for(const knot of next.knots){
          const last=points.at(-1);
          const span=last?Math.hypot(knot[0]-last[0],knot[1]-last[1]):1;
          if(span>.5){points.push(knot);ahead+=last?span:0;}
        }
        edge=next;
      }
    }
    if(index>60){points=points.slice(index-20);index=20;}
  }
  function place() {
    const vehicle=getVehicle();
    edge=starts[Math.floor(Math.random()*starts.length)];
    points=edge.knots.map(knot=>[knot[0],knot[1]]);
    index=Math.floor(points.length*.3);
    extend();
    const [x,z]=points[index],[ax,az]=points[Math.min(points.length-1,index+3)];
    vehicle.reset(x,z,Math.atan2(ax-x,z-az));
    const level=ground.height(x,z,edge.motorway?ground.motorwayLevel(x,z):Infinity);
    vehicle.p[1]=level+vehicle.spec.cg+.03;
    stuck=0;
  }
  function pointAhead(distance) {
    let left=distance;
    for(let i=index+1;i<points.length;i++){
      const a=points[i-1],b=points[i],span=Math.hypot(b[0]-a[0],b[1]-a[1]);
      if(span>=left){const f=left/span;return [a[0]+(b[0]-a[0])*f,a[1]+(b[1]-a[1])*f];}
      left-=span;
    }
    return points.at(-1);
  }
  // The fastest speed that still makes every bend in the next stretch of road.
  function bendSpeed(speed) {
    let limit=40, run=0;
    for(let d=6;d<Math.max(40,speed*speed/5);d+=6){
      const a=pointAhead(d-6),b=pointAhead(d),c=pointAhead(d+6);
      const h0=Math.atan2(b[0]-a[0],b[1]-a[1]),h1=Math.atan2(c[0]-b[0],c[1]-b[1]);
      const turn=Math.abs(Math.atan2(Math.sin(h1-h0),Math.cos(h1-h0)))/6;
      run=d;
      if(turn>.002)limit=Math.min(limit,Math.sqrt(Math.max(9,3.4/turn+2*3.2*run)));
    }
    return limit;
  }
  place();
  return {
    drive(dt,traffic,posted) {
      const vehicle=getVehicle(), input=vehicle.input, [x,,z]=vehicle.p, speed=vehicle.forwardSpeed();
      extend();
      for(let i=index,best=Infinity,end=Math.min(points.length,index+40);i<end;i++){
        const range=Math.hypot(points[i][0]-x,points[i][1]-z);
        if(range<best){best=range;index=i;}
      }
      const offRoute=Math.hypot(points[index][0]-x,points[index][1]-z);
      const look=Math.max(5.5,Math.abs(speed)*.72);
      const [tx,tz]=pointAhead(look), dx=tx-x, dz=tz-z;
      const f=vehicle.forward, left=vehicle.right;
      const across=dx*left[0]+dz*left[2], reach=Math.hypot(dx,dz)||1;
      const angle=Math.atan2(2*vehicle.spec.wheelbase*across,reach*reach);
      input.steer=clamp(-angle/vehicle.spec.steer.maxAngle,-1,1);
      let wanted=Math.min(posted/3.6*.96,bendSpeed(Math.abs(speed)));
      const fl=Math.hypot(f[0],f[2])||1, fx=f[0]/fl, fz=f[2]/fl;
      let blocked=false;
      for(const box of traffic){
        const ox=box.cx-x,oz=box.cz-z,ahead=ox*fx+oz*fz,side=Math.abs(ox*fz-oz*fx);
        if(ahead<=0||ahead>10+speed*2.2||side>1.9+(box.hw||.9))continue;
        wanted=Math.min(wanted,Math.max(0,(ahead-(box.hl||2)-6.5)*.62));
        blocked=true;
      }
      const toSignal=population.signalDistance({cx:x,cz:z,fx,fz,hl:vehicle.spec.dims.len/2});
      if(Number.isFinite(toSignal)){wanted=Math.min(wanted,Math.sqrt(Math.max(0,5*(toSignal-.5))));blocked=true;}
      const error=wanted-speed;
      input.throttle=clamp(error*.42,0,1);
      input.brake=clamp(-error*.3,0,1);
      input.handbrake=0;
      stuck=Math.abs(speed)<.8&&!blocked?stuck+dt:Math.max(0,stuck-dt*2);
      // Anything that goes wrong is quietly recovered with a cut to a new stretch of road.
      if(stuck>6||offRoute>14||vehicle.wrecked||vehicle.drowned||(vehicle.submerged||0)>.1||vehicle.up[1]<.4){place();shotTime=shotLength;}
    },
    // Runs after the normal camera; custom shots replace it.
    view(dt,camera) {
      const vehicle=getVehicle();
      shotTime+=dt;
      if(shotTime>=shotLength){
        shot=SHOTS[order++%SHOTS.length];shotTime=0;shotLength=5.5+Math.random()*4;anchor=null;orbit=Math.random()*6.28;
        setCameraMode(shot==='cockpit'?1:shot==='high'?3:0);
      }
      if(shot==='chase'||shot==='cockpit'||shot==='high')return;
      const p=vehicle.p, f=vehicle.forward, r=vehicle.right;
      let fov=50;
      target.set(p[0],p[1]+.25,p[2]);
      if(shot==='roadside'){
        if(!anchor){
          const [ax,az]=pointAhead(Math.max(30,Math.abs(vehicle.forwardSpeed())*shotLength*.5));
          const side=Math.random()<.5?-1:1;
          anchor=[ax+r[0]*side*7.5,az+r[2]*side*7.5];
        }
        eye.set(anchor[0],0,anchor[1]);eye.y=ground.height(anchor[0],anchor[1])+1.25;fov=32;
      }else if(shot==='front'){
        eye.set(p[0]+f[0]*6.5+r[0]*1.6,p[1]+.25,p[2]+f[2]*6.5+r[2]*1.6);fov=46;
      }else if(shot==='side'){
        eye.set(p[0]+r[0]*6.2,p[1]+.45,p[2]+r[2]*6.2);fov=44;
      }else if(shot==='heli'){
        eye.set(p[0]-f[0]*26+r[0]*20,p[1]+21,p[2]-f[2]*26+r[2]*20);fov=38;
      }else if(shot==='wheel'){
        const side=vehicle.spec.dims.wid*.5+.65;
        eye.set(p[0]-f[0]*1.4+r[0]*side,p[1]-.12,p[2]-f[2]*1.4+r[2]*side);
        target.set(p[0]+f[0]*9,p[1]-.1,p[2]+f[2]*9);fov=58;
      }else{
        orbit+=dt*.42;
        eye.set(p[0]+Math.sin(orbit)*8.5,p[1]+1.6,p[2]+Math.cos(orbit)*8.5);fov=46;
      }
      eye.y=Math.max(eye.y,ground.height(eye.x,eye.z,p[1])+.3);
      if(camera.fov!==fov||camera.near!==.3){camera.fov=fov;camera.near=.3;camera.updateProjectionMatrix();}
      camera.up.set(0,1,0);
      camera.position.copy(eye);
      camera.lookAt(target);
    },
  };
}
