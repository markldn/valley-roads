// The driver as a character: sits at the wheel, opens the door, swings out, stands, shuts the door,
// walks and runs with feet that match the ground speed, and gets into any car the same way.
import * as T from '../vendor/three.module.js';
import { walkingMeshes } from '../traffic/population.js';
import { doorSeat, setDoor } from '../drive/car/door.js';

const local=new T.Vector3(), eye=new T.Vector3(), aim=new T.Vector3();
const ease=T.MathUtils.smoothstep, TAU=Math.PI*2;
const MODE={walk:0,driver:1,out:5,in:6,swim:10,reach:15};
const HEIGHT=.98, EXIT_TIME=3.4, ENTER_TIME=3.75;
const turnTo=(from,to,rate)=>from+T.MathUtils.clamp(Math.atan2(Math.sin(to-from),Math.cos(to-from)),-rate,rate);
// One full gait cycle covers this many metres at a given speed, as the walking rig is built.
const gaitRate=speed=>TAU*speed/(1.40*Math.pow(Math.max(speed,.3)/1.4,.5));
const bell=(t,a,b,c,d)=>ease(t,a,b)*(1-ease(t,c,d));

export function createOnFoot(ctx) {
  const crowd=walkingMeshes(2);
  crowd.mesh.frustumCulled=false;crowd.mesh.geometry.instanceCount=0;
  ctx.scene.add(crowd.mesh);
  const occupant=new T.Group(), driver=walkingMeshes(1);
  const driverAttrs=driver.mesh.geometry.attributes;
  driver.mesh.frustumCulled=false;
  driver.mesh.geometry.instanceCount=1;
  driverAttrs.aInst.setXYZW(0,0,0,0,0);
  driverAttrs.aPose.setXY(0,0,MODE.driver);
  driverAttrs.aLook.setXYZ(0,.57,.32,.31);
  driverAttrs.aVar.setXYZW(0,HEIGHT,0,0,0);
  occupant.userData.replayArticulation={
    get value(){return driverAttrs.aVar.getW(0);},
    set value(value){
      if(driverAttrs.aVar.getW(0)===Math.fround(value))return;
      driverAttrs.aVar.setW(0,value);
      driverAttrs.aVar.needsUpdate=true;
    },
  };
  driver.mesh.position.y=-.53*HEIGHT;
  occupant.add(driver.mesh);
  occupant.visible=false;
  ctx.scene.add(occupant);
  const cabinTilt=new T.Quaternion(), lean=new T.Euler();
  const attrs=crowd.mesh.geometry.attributes;
  attrs.aLook.setXYZ(0,.57,.32,.31);attrs.aLook.setXYZ(1,.1,.7,.35);
  let phase='driving', t=0, x=0, z=0, y=0, yaw=0, speed=0, stride=0, model=null, target=null, runner=null, nearby=null;
  let cameraPitch=0, scan=0, swimming=false, facing=0, route=[], evicted=false, cut=false, pose={mode:0,progress:0,gait:0};

  // ---- Where things are on a car, in its own coordinates ----
  function layout(car) {
    const ud=car.userData, spec=ctx.specOf(car);
    if(ud.busBody){
      const hw=spec.dims.wid/2, z=ud.busBody.position.z+spec.dims.len/2-1.35;
      return {hw,side:-1,seat:[ud.cockpit.x,ud.cockpit.z-.1],sill:[-hw-.05,z],
        exit:[-hw-.62,z],clear:[-hw-1.02,z],len:spec.dims.len/2};
    }
    const door=doorSeat(car,1);
    const hw=door?.hw??spec.dims.wid/2, rear=door?.zR??-.2;
    const seatX=ud.cockpit?.x??hw*.45, seatZ=(ud.cockpit?.z??rear+.3)-.1;
    return {hw,side:1,seat:[seatX,seatZ],sill:[hw+.05,rear+.22],exit:[hw+.62,rear+.12],clear:[hw+1.02,rear-.05],len:spec.dims.len/2};
  }
  function openDoor(car,amount){
    const bus=car.userData.busBody;
    if(!bus){setDoor(car,1,amount);return;}
    for(const leaf of bus.userData.doors.slice(0,2))
      leaf.position.z=leaf.userData.closedZ+leaf.userData.direction*.62*amount;
  }
  function toWorld(car,lx,lz) {
    car.updateWorldMatrix(true,false);
    local.set(lx,0,lz).applyMatrix4(car.matrixWorld);
    return [local.x,local.z];
  }
  function toLocal(car,wx,wz) {
    car.updateWorldMatrix(true,false);
    local.set(wx,car.position.y,wz);
    car.worldToLocal(local);
    return [local.x,local.z];
  }
  const carYaw=car=>{local.set(0,0,1).transformDirection(car.matrixWorld);return Math.atan2(local.x,local.z);};
  // Height that puts the hips of a seated figure on the seat cushion.
  const seatHeight=car=>car.userData.busBody?car.userData.busBody.getWorldPosition(local).y+.29:
    car.position.y+(car.userData.cockpit?.y??.6)-.67-.53*HEIGHT;
  const mix2=(a,b,f)=>[a[0]+(b[0]-a[0])*f,a[1]+(b[1]-a[1])*f];

  function draw() {
    attrs.aInst.setXYZW(0,phase==='driving'?1e7:x,z,yaw,stride);
    attrs.aPose.setXY(0,y,pose.mode);
    attrs.aVar.setXYZW(0,HEIGHT,0,pose.gait,pose.progress);
    let count=1;
    if(runner){
      attrs.aInst.setXYZW(1,runner.x,runner.z,runner.yaw,runner.stride);
      attrs.aPose.setXY(1,ctx.ground().height(runner.x,runner.z)+.02,0);
      attrs.aVar.setXYZW(1,.95,17,4.6,0);
      count=2;
    }
    crowd.mesh.geometry.instanceCount=count;
    for(const name of ['aInst','aLook','aPose','aVar'])attrs[name].needsUpdate=true;
  }
  function park() {
    attrs.aInst.setXYZW(0,1e7,1e7,0,0);
    attrs.aInst.needsUpdate=true;
    crowd.mesh.geometry.instanceCount=runner?2:0;
  }
  function stepRunner(dt) {
    if(!runner)return;
    const dx=runner.gx-runner.x,dz=runner.gz-runner.z,left=Math.hypot(dx,dz);
    runner.yaw=Math.atan2(dx,dz);runner.stride+=dt*gaitRate(4.6);
    const move=Math.min(left,4.6*dt);runner.x+=dx/(left||1)*move;runner.z+=dz/(left||1)*move;
    if(left<.3)runner=null;
  }

  // ---- Getting out: door, swing, stand, step clear, turn back and push the door shut ----
  function exiting(dt) {
    const car=model, spot=layout(car), base=carYaw(car);
    openDoor(car,ease(t,.2,.8)*(1-ease(t,2.55,3.05)));
    const leave=mix2(spot.seat,spot.exit,ease(t,.95,1.6)), [px,pz]=mix2(leave,spot.clear,ease(t,1.65,2.2));
    [x,z]=toWorld(car,px,pz);
    const floor=ctx.ground().height(x,z,car.position.y);
    y=seatHeight(car)+(floor-seatHeight(car))*ease(t,1,1.6);
    // Faces the windscreen, then the door opening, then back at the car to close it.
    const out=Math.PI/2*ease(t,.6,1.15), back=Math.PI*ease(t,2.2,2.6), away=Math.PI/2*ease(t,3.05,3.4);
    yaw=base+spot.side*(out+back+away);
    const stepping=t>1.65&&t<2.2;
    if(stepping)stride+=dt*gaitRate(1.1);
    if(t<.25)pose={mode:MODE.driver,progress:0,gait:0};
    else if(t<1.65)pose={mode:MODE.out,progress:ease(t,.55,1.6),gait:0};
    else if(t>2.45&&t<3.1)pose={mode:MODE.reach,progress:bell(t,2.45,2.7,2.95,3.1),gait:0};
    else pose={mode:MODE.walk,progress:0,gait:stepping?1.1:0};
    if(t>=EXIT_TIME){openDoor(car,0);yaw=base;facing=base;phase='walking';speed=0;pose={mode:MODE.walk,progress:0,gait:0};}
  }

  // ---- Walking up to the driver's door, going round the car if it is on the other side ----
  function plan(car) {
    const spot=layout(car), [lx,lz]=toLocal(car,x,z), margin=.75, sideX=spot.hw+margin, endZ=spot.len+margin;
    const signedX=lx*spot.side;
    const points=[];
    if(signedX<spot.hw+.25){
      const end=Math.abs(lz-endZ)<Math.abs(lz+endZ)?endZ:-endZ;
      if(signedX<-spot.hw||Math.abs(lz)<spot.len)points.push([(lx<0?-1:1)*sideX,end]);
      points.push([sideX*spot.side,end]);
    }
    points.push(spot.exit);
    return points;
  }
  function approaching(dt) {
    const car=model, goal=toWorld(car,...route[0]), dx=goal[0]-x, dz=goal[1]-z, left=Math.hypot(dx,dz);
    yaw=turnTo(yaw,Math.atan2(dx,dz),dt*7);
    speed+=(Math.min(2.2,.8+left*1.6)-speed)*Math.min(1,dt*7);
    // Heads straight for the spot on the last steps, so the walker can never circle around it.
    const move=Math.min(left,speed*dt), direct=left<.9;
    x+=(direct?dx/(left||1):Math.sin(yaw))*move;z+=(direct?dz/(left||1):Math.cos(yaw))*move;
    stride+=dt*gaitRate(speed);
    y+=(ctx.ground().height(x,z,y+.6)-y)*Math.min(1,dt*14);
    pose={mode:MODE.walk,progress:0,gait:speed};
    if(left<.14){
      route.shift();
      if(!route.length){[x,z]=goal;phase='boarding';t=0;speed=0;evicted=false;}
    }
  }

  // ---- Getting in: pull the handle, turn, sit down backwards, swing the legs in, close the door ----
  function boarding(dt) {
    const car=model, spot=layout(car), base=carYaw(car);
    openDoor(car,ease(t,.3,.9)*(1-ease(t,3,3.55)));
    if(!evicted&&t>.85){
      evicted=true;
      const out=target.evict?.();
      if(out){const [rx,rz]=toWorld(car,spot.exit[0]+.5,spot.exit[1]-1.1);runner={x:rx,z:rz,gx:out.gx,gz:out.gz,yaw:0,stride:0};}
    }
    const [px,pz]=mix2(mix2(spot.exit,spot.sill,ease(t,1.25,1.75)),spot.seat,ease(t,1.85,2.6));
    [x,z]=toWorld(car,px,pz);
    const floor=ctx.ground().height(x,z,car.position.y);
    y=floor+(seatHeight(car)-floor)*ease(t,1.85,2.55);
    const inward=Math.PI*1.5, turned=inward-Math.PI*ease(t,1,1.55);
    yaw=base+spot.side*(turned-(Math.PI/2)*ease(t,2.45,3.05));
    const shuffling=t>1&&t<1.6;
    if(shuffling)stride+=dt*gaitRate(.8);
    if(t<1)pose={mode:MODE.reach,progress:bell(t,0,.42,.8,1),gait:0};
    else if(t<1.7)pose={mode:MODE.walk,progress:0,gait:shuffling?.8:0};
    else if(t<3.1)pose={mode:MODE.in,progress:ease(t,1.7,3.05),gait:0};
    else pose={mode:MODE.driver,progress:0,gait:0};
    if(t>=ENTER_TIME){openDoor(car,0);phase='driving';ctx.enter(target);target=null;park();return true;}
    return false;
  }

  // ---- On foot ----
  function walking(dt,pressed) {
    const ground=ctx.ground(), obstacles=ctx.obstacles();
    const turn=Number(pressed('ArrowRight','d'))-Number(pressed('ArrowLeft','a'));
    const advance=Number(pressed('ArrowUp','w'))-Number(pressed('ArrowDown','s'));
    yaw-=turn*dt*2.5;
    const water=ground.water(x,z), floor=ground.height(x,z,y+.6);
    swimming=Boolean(water&&water.level-floor>1.25);
    const wanted=advance*(swimming?1.3:pressed('Shift')?5.4:1.75)*(advance<0?.6:1);
    speed+=T.MathUtils.clamp(wanted-speed,-11*dt,7*dt);
    let nx=x+Math.sin(yaw)*speed*dt, nz=z+Math.cos(yaw)*speed*dt;
    const hit=obstacles.queryBall(nx,nz,y+.9,.3);
    if(hit){nx+=hit[0]*hit[2];nz+=hit[1]*hit[2];}
    for(const box of ctx.vehicleBoxes()){
      const dx=nx-box.cx,dz=nz-box.cz, along=dx*box.fx+dz*box.fz, across=dx*box.rx+dz*box.rz;
      const inL=box.hl+.32-Math.abs(along), inW=box.hw+.32-Math.abs(across);
      if(inL<=0||inW<=0||Math.abs(box.y-y)>2.6)continue;
      if(inL<inW){const s=Math.sign(along)||1;nx+=box.fx*s*inL;nz+=box.fz*s*inL;}
      else{const s=Math.sign(across)||1;nx+=box.rx*s*inW;nz+=box.rz*s*inW;}
    }
    // Feet follow the distance really covered, so walking into a wall does not slide on the spot.
    const moved=Math.hypot(nx-x,nz-z)/Math.max(dt,1e-4);
    if(Math.abs(ground.height(nx,nz,y+.6)-y)<1.2||swimming){x=nx;z=nz;}else speed=0;
    const level=ground.height(x,z,y+.6);
    y=swimming?(ground.water(x,z)?.level??level)-1.15:y+(level-y)*Math.min(1,dt*14);
    // Turning on the spot takes small steps instead of spinning on the heels.
    const shuffle=Math.abs(speed)<.25&&turn?.62:0, gait=Math.max(moved,shuffle);
    stride+=dt*(swimming?3.4:gaitRate(gait)*(speed<0?-1:1));
    pose={mode:swimming?MODE.swim:MODE.walk,progress:0,gait};
    scan-=dt;
    if(scan<=0){scan=.2;nearby=ctx.findCar(x,z,yaw);}
  }

  return {
    occupant,
    get debug(){return {phase,t:+t.toFixed(2),route:route.length,x:+x.toFixed(1),z:+z.toFixed(1),yaw:+yaw.toFixed(2),speed:+speed.toFixed(2),nearby:nearby?.name||null,target:target?.kind||null};},
    get active(){return phase!=='driving';},
    get walking(){return phase==='walking';},
    get x(){return x;},get z(){return z;},get y(){return y;},
    get prompt(){return phase==='walking'&&nearby?`G · Get in ${nearby.name}`:'';},
    leave(car,inside=false) {
      if(phase!=='driving')return false;
      occupant.visible=occupant.userData.replayVisible=false;
      model=car;cameraPitch=0;phase='exiting';t=0;speed=0;nearby=null;cut=inside;
      return true;
    },
    board() {
      if(phase!=='walking'||!nearby)return false;
      target=nearby;model=target.model;target.hold?.();
      route=plan(model);phase='approach';t=0;
      return true;
    },
    look(dx,dy){
      if(phase!=='walking')return;
      yaw-=dx*.004;
      cameraPitch=T.MathUtils.clamp(cameraPitch+dy*.004,-.50,.65);
    },
    reset(){occupant.visible=occupant.userData.replayVisible=false;cameraPitch=0;phase='driving';runner=null;target=null;nearby=null;park();},
    hide:park,
    // The driver at the wheel. Runs after the car has moved, so the figure never lags behind it.
    atWheel(car,visible,impact) {
      if(phase!=='driving')return;
      occupant.visible=visible;
      occupant.userData.replayVisible=true;
      const spot=layout(car);
      const [side,vertical,longitudinal]=impact.offset, slump=impact.slump;
      const hip=car.userData.busBody?car.userData.busBody.position.y+.29+.53*HEIGHT:car.userData.cockpit.y-.67;
      occupant.position.set(spot.seat[0]+side*.24,hip+vertical*.62-slump*.08,spot.seat[1]+longitudinal*.22);
      car.localToWorld(occupant.position);
      lean.set(longitudinal*2.05+slump*.36,0,-side*2.5-slump*.38,'YXZ');
      occupant.quaternion.copy(car.quaternion).multiply(cabinTilt.setFromEuler(lean));
      occupant.userData.replayArticulation.value=Math.min(1,Math.hypot(side,vertical,longitudinal)*4+slump);
      if(runner)draw();
    },
    step(dt,pressed) {
      stepRunner(dt);
      if(phase==='driving'){if(runner)draw();return;}
      t+=dt;
      if(phase==='exiting')exiting(dt);
      else if(phase==='walking')walking(dt,pressed);
      else if(phase==='approach')approaching(dt);
      else if(boarding(dt))return;
      draw();
    },
    // Follows the walker. Around the door the camera stands back to show the whole movement.
    view(dt,camera) {
      const ground=ctx.ground(), obstacles=ctx.obstacles();
      aim.set(x,y+1.25,z);
      if(phase==='exiting'||phase==='boarding'){
        const spot=layout(model), [cx,cz]=toWorld(model,spot.side*(spot.hw+3.3),spot.exit[1]-2.7);
        eye.set(cx,ground.height(x,z,model.position.y)+1.7,cz);
      }else{
        aim.y=y+1.45;
        const distance=3.5*Math.cos(cameraPitch);
        eye.set(x-Math.sin(yaw)*distance,y+2.05+3.5*Math.sin(cameraPitch),z-Math.cos(yaw)*distance);
      }
      for(let i=0;i<9&&obstacles.queryBall(eye.x,eye.z,eye.y,.35);i++)eye.lerp(aim,.2);
      eye.y=Math.max(eye.y,ground.height(eye.x,eye.z,y+1)+.45);
      if(cut){camera.position.copy(eye);cut=false;}
      else camera.position.lerp(eye,1-Math.exp(-dt*6));
      if(camera.fov!==58||camera.near!==.15){camera.fov=58;camera.near=.15;camera.updateProjectionMatrix();}
      camera.up.set(0,1,0);camera.lookAt(aim);
    },
  };
}
