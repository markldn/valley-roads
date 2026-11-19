import * as T from '../vendor/three.module.js';
import { surface } from '../render/visuals.js';
import { walkingMeshes } from './population.js';
import { routeAroundJunctions } from '../world/network.js';
import { random } from '../world/world.js';
import { buildTransit, buildVehicle } from '../drive/render/transit.js';
import { inscription } from '../people/district.js';

const TAU=2*Math.PI;
const clip=T.MathUtils.clamp;

export function createMobility(world,ground,obstacles,debris,onAirImpact) {
  const group=new T.Group(), rng=random(world.seed^0xacd31);
  const box=new T.BoxGeometry(), ball=new T.SphereGeometry(1,12,7);
  const chrome=surface(0xaeb0a5,{roughness:.35,metalness:.56});
  const rubber=surface(0x272727,{roughness:.91});
  const glass=surface(0x385863,{roughness:.23,metalness:.28});
  const red=surface(0xa42924,{emissive:0x7c190e,emissiveIntensity:.5});
  const white=surface(0xe4dfd0,{emissive:0xb89560,emissiveIntensity:.48});
  const paints=[0x627b91,0x875035,0x487454,0xa78d4f,0x9e4934].map(color=>surface(color,{pattern:'machinery',roughness:.49}));

  function part(root,geometry,material,position,scale){
    const mesh=new T.Mesh(geometry,material);
    mesh.position.set(...position);mesh.scale.set(...scale);
    mesh.castShadow=mesh.receiveShadow=true;root.add(mesh);
    return mesh;
  }

  const pipeGeometry=new T.CylinderGeometry(1,1,1,7), up=new T.Vector3(0,1,0);
  function tube(root,material,a,b,r){
    const pos=new T.Vector3(...a), end=new T.Vector3(...b),v=end.clone().sub(pos);
    const mesh=part(root,pipeGeometry,material,pos.lerp(end,.5).toArray(),[r,v.length(),r]);
    mesh.quaternion.setFromUnitVectors(up,v.normalize());
    return mesh;
  }

  const sizes={
    motorcycle:{tire:.32,length:2.16,width:.68,speed:16,mass:233,ride:14},
    scooter:{tire:.245,length:1.78,width:.62,speed:9.2,mass:129,ride:14},
    bicycle:{tire:.35,length:1.75,width:.48,speed:5.8,mass:83,ride:4},
    trottinette:{tire:.116,length:1.15,width:.41,speed:4.2,mass:79,ride:13},
  };
  function makeBike(type,i){
    const spec=sizes[type], root=new T.Group(), paint=paints[i%paints.length], wheels=[];
    const w=spec.length*.33, r=spec.tire;
    const tire=new T.TorusGeometry(r*.88,r*.13,8,20).rotateY(Math.PI/2);
    for(const side of [-1,1]){
      const wheel=new T.Group();
      wheel.position.set(0,r,side*w);
      part(wheel,tire,rubber,[0,0,0],[1,1,1]);
      for(let spoke=0;spoke<5;spoke++){
        const angle=spoke*Math.PI/5;
        const center=part(wheel,box,chrome,[0,0,0],[.021,r*1.62,.019]);
        center.rotation.x=angle;
      }
      part(wheel,ball,chrome,[0,0,0],[.071,r*.21,r*.21]);
      root.add(wheel);wheels.push(wheel);
    }
    const isCycle=type==='bicycle', isKick=type==='trottinette';
    if(isKick){
      part(root,box,paint,[0,.17,-.10],[.23,.067,.67]);
      tube(root,chrome,[0,.19,w],[0,.99,w+.07],.029);
      part(root,box,rubber,[0,1.01,w+.07],[.40,.055,.071]);
    } else {
      const seat=isCycle?.89:.72, steering=isCycle?1.04:.95;
      tube(root,chrome,[0,r,w],[0,steering,w-.18],.027);
      if(isCycle){
        for(const [a,b] of [[[0,.37,-.06],[0,.74,.39]],[[0,.74,.39],[0,.86,-.19]],
          [[0,.86,-.19],[0,.37,-.06]],[[0,r,-w],[0,.37,-.06]],[[0,r,-w],[0,.86,-.19]]])
          tube(root,paint,a,b,.026);
      } else {
        part(root,ball,paint,[0,.52,.04],[.28,.25,.72]);
        part(root,ball,type==='motorcycle'?chrome:paint,[0,.34,-.05],[.19,.17,.46]);
        part(root,ball,paint,[0,.69,.44],[.22,.27,.22]);
        part(root,ball,glass,[0,.87,.45],[.16,.18,.057]);
        part(root,box,white,[0,.73,.65],[.21,.12,.07]);
      }
      part(root,ball,rubber,[0,seat,-.31],[isCycle?.095:.19,.065,.25]);
      part(root,box,rubber,[0,steering,w-.16],[type==='motorcycle'?.61:.48,.06,.071]);
      part(root,box,red,[0,r+.16,-w-.06],[.15,.070,.065]);
    }
    root.name=type;
    return {root,wheels,spec};
  }

  function route(loop){
    const points=routeAroundJunctions(world,loop.slice(0,-1).map(p=>world.point(...p)));
    const distances=[0];
    for(let i=0;i<points.length;i++){
      const a=points[i],b=points[(i+1)%points.length];
      distances.push(distances.at(-1)+Math.hypot(a[0]-b[0],a[1]-b[1]));
    }
    return {points,distances,total:distances.at(-1)};
  }
  const routes=world.loops.map(route);
  function sample(path,distance) {
    const {points,distances,total}=path;
    const at=(distance+total)%total;
    let lo=0, hi=points.length;
    while(hi-lo>1){const mid=(lo+hi)>>1;if(distances[mid]>at)hi=mid;else lo=mid;}
    const a=points[lo],b=points[(lo+1)%points.length];
    const f=(at-distances[lo])/(distances[lo+1]-distances[lo]||1);
    return [T.MathUtils.lerp(a[0],b[0],f),T.MathUtils.lerp(a[1],b[1],f)];
  }
  function roadPose(path,distance,lane) {
    const [x,z]=sample(path,distance), [ax,az]=sample(path,distance+3);
    const norm=Math.hypot(ax-x,az-z)||1, fx=(ax-x)/norm, fz=(az-z)/norm;
    return {x:x-fz*lane,z:z+fx*lane,fx,fz,yaw:Math.atan2(fx,fz)};
  }
  const buses=[];
  for(const [line,path] of routes.filter(path=>path.total>220)
    .sort((a,b)=>b.total-a.total).slice(0,2).entries()){
    const stops=[];
    for(let d=38;d<path.total-35;d+=12){
      if(stops.length&&d-stops.at(-1).distance<Math.max(95,path.total/5))continue;
      const curb=roadPose(path,d,5.1), ahead=roadPose(path,d+10,0), before=roadPose(path,d-10,0);
      if(ahead.fx*before.fx+ahead.fz*before.fz<.985)continue;
      const [u,v]=world.grid(curb.x,curb.z), town=world.towns.find(t=>Math.hypot(u-t.u,v-t.v)<t.radius);
      if(!town||world.riverEdge(curb.x,curb.z)<5)continue;
      stops.push({...curb,kind:'bus',line:line+1,distance:d,town:town.name,name:town.name+' · '+(stops.length+1)});
      if(stops.length===5)break;
    }
    if(stops.length<2)continue;
    const model=buildVehicle('bus',{passengers:0,driver:false,route:[line+1,stops[0].town]});
    group.add(model);
    for(const stop of stops){
      const plate=inscription((line+1)+' · '+stop.name,'#fff','#225777');
      plate.position.set(stop.x,ground.height(stop.x,stop.z)+2.82,stop.z);
      plate.rotation.y=stop.yaw+Math.PI/2;plate.scale.setScalar(.55);
      group.add(plate);
    }
    const passengers=Array.from({length:stops.length*2},(_,i)=>({
      origin:i%stops.length, destination:(i%stops.length+1+i%2)%stops.length,
      look:[rng(),rng(),rng()],variant:i%3===0?1:0,seat:model.userData.seats[i],
      state:'waiting',phase:0,
    }));
    for(const passenger of passengers)
      if(passenger.origin===passenger.destination)passenger.destination=(passenger.origin+1)%stops.length;
    buses.push({model,path,stops,passengers,distance:stops[0].distance-18,next:0,speed:0,dwell:0});
  }
  const busStops=buses.flatMap(bus=>bus.stops);
  if(busStops.length)group.add(buildTransit({stops:busStops},ground,obstacles));
  const busPeople=walkingMeshes(buses.reduce((n,bus)=>n+bus.passengers.length+1,0));
  if(buses.length)group.add(busPeople.mesh);
  const busAttrs=busPeople.mesh.geometry.attributes;
  function stepBuses(dt,observer,traffic,hour,preview,signalDistance){
    const boxes=[];
    let count=0;
    const put=(x,y,z,yaw,mode,pace,phase,look,variant)=>{
      busAttrs.aInst.setXYZW(count,x,z,yaw,phase);
      busAttrs.aLook.setXYZ(count,...look);
      busAttrs.aPose.setXY(count,y,mode);
      busAttrs.aVar.setXYZW(count++,1,variant,pace,0);
    };
    for(const bus of buses){
      const {model,path,stops,passengers}=bus;
      if(hour<6||hour>=23){model.visible=false;continue;}
      const stop=stops[bus.next];
      const distance=(stop.distance-bus.distance+path.total)%path.total;
      const before=roadPose(path,bus.distance,2.15);
      const toSignal=signalDistance?.({cx:before.x,cz:before.z,fx:before.fx,fz:before.fz,hl:6})??Infinity;
      if(bus.dwell>0){
        bus.dwell=Math.max(0,bus.dwell-dt);
        if(!bus.dwell)bus.next=(bus.next+1)%stops.length;
      }else{
        let limit=Math.min(10,Math.sqrt(distance*4),Math.sqrt(toSignal*5));
        for(const other of preview?traffic:[observer,...traffic]){
          const dx=other.cx-before.x,dz=other.cz-before.z;
          const ahead=dx*before.fx+dz*before.fz-(other.hl??1)-6;
          if(ahead>-2&&ahead<24&&Math.abs(dx*before.fz-dz*before.fx)<2.4)
            limit=Math.min(limit,Math.sqrt(Math.max(0,(ahead-2)*4)));
        }
        bus.speed+=clip(limit-bus.speed,-4*dt,1.2*dt);
        bus.distance=(bus.distance+Math.min(distance,toSignal,bus.speed*dt))%path.total;
        if(distance<.23){
          bus.distance=stop.distance;bus.speed=0;bus.dwell=8;
          for(const p of passengers){
            if(p.state==='aboard'&&p.destination===bus.next){p.state='alighting';p.phase=0;}
            else if(p.state==='waiting'&&p.origin===bus.next){p.state='boarding';p.phase=0;}
          }
        }
      }
      const {x,z,fx,fz,yaw}=roadPose(path,bus.distance,2.15), y=ground.height(x,z);
      const near=Math.hypot(x-observer.cx,z-observer.cz)<440;
      model.visible=near;model.position.set(x,y,z);model.rotation.y=yaw;
      const open=Math.min(clip((8-bus.dwell)*2,0,1),clip(bus.dwell*2,0,1));
      for(const leaf of model.userData.doors)
        leaf.position.z=leaf.userData.closedZ+leaf.userData.direction*.62*open;
      const local=(lx,lz)=>[x+fz*lx+fx*lz,z-fx*lx+fz*lz];
      if(near){
        const seat=model.userData.driverSeat,[dx,dz]=local(seat.x,seat.z);
        put(dx,y+.29,dz,yaw,1,0,0,[.32,.53,.39],0);
        boxes.push({cx:x,cz:z,y,fx,fz,rx:fz,rz:-fx,hl:6,hw:1.25,mass:12000,vx:fx*bus.speed,vz:fz*bus.speed});
      }
      for(const [i,p] of passengers.entries()){
        if(p.state==='boarding'||p.state==='alighting'){
          p.phase+=dt;
          const boarding=p.state==='boarding';
          if(p.phase>=5.9){
            if(boarding)p.state='aboard';
            else{
              p.state='waiting';p.origin=p.destination;
              p.destination=(p.origin+1+i%2)%stops.length;
              if(p.destination===p.origin)p.destination=(p.origin+1)%stops.length;
            }
          }else if(near){
            const t=clip((p.phase-.65-i%2*.45)/4.5,0,1);
            const progress=boarding?t:1-t, door=boarding?4.65:-.6;
            const pathPoints=[[-2.95,(i%2)*1.1],[-2.35,door],[-1.28,door],
              [-.25,door],[-.18,p.seat.z],[p.seat.x,p.seat.z]];
            const scaled=progress*(pathPoints.length-1);
            const index=Math.min(pathPoints.length-2,Math.floor(scaled)), f=scaled-index;
            const [a,b]=pathPoints.slice(index,index+2);
            const [px,pz]=local(T.MathUtils.lerp(a[0],b[0],f),T.MathUtils.lerp(a[1],b[1],f));
            put(px,T.MathUtils.lerp(ground.height(px,pz),y+.36,ease(progress)),pz,
              yaw+Math.atan2(b[0]-a[0],b[1]-a[1])+(boarding?0:Math.PI),0,1.35,p.phase*6,p.look,p.variant);
          }
        }else if(p.state==='aboard'&&near){
          const [px,pz]=local(p.seat.x,p.seat.z);
          put(px,y+.29,pz,yaw,2,0,0,p.look,p.variant);
        }else if(p.state==='waiting'){
          const waiting=stops[p.origin], px=waiting.x+waiting.fx*(i%2)*1.1,pz=waiting.z+waiting.fz*(i%2)*1.1;
          if(Math.hypot(px-observer.cx,pz-observer.cz)<160)
            put(px,ground.height(px,pz),pz,waiting.yaw+Math.PI/2,0,0,0,p.look,p.variant);
        }
      }
    }
    busPeople.time.value=time;
    busPeople.mesh.geometry.instanceCount=count;
    for(const name of ['aInst','aLook','aPose','aVar'])busAttrs[name].needsUpdate=true;
    return boxes;
  }
  const ease=t=>T.MathUtils.smoothstep(t,.38,.62);
  const types=Object.keys(sizes), riders=[];
  for(let i=0,count=Math.round((10+world.urbanDensity*6)*world.peopleScale);i<count;i++){
    const kind=types[i%types.length], bike=makeBike(kind,i), path=routes[i%routes.length];
    const pace=bike.spec.speed*(.75+rng()*.30);
    riders.push({...bike,path,pace,speed:pace,distance:path.total*rng(),home:path.total*rng(),phase:0,look:[rng(),rng(),rng()],height:.90+rng()*.12,resting:false});
    group.add(bike.root);
  }
  const humans=walkingMeshes(riders.length);
  group.add(humans.mesh);
  const attrs=humans.mesh.geometry.attributes;

  const airRng=random(world.seed^0x573afb);
  function aircraft(kind,index){
    const root=new T.Group(), skin=paints[index%paints.length];
    const helicopter=kind==='helicopter', jet=kind==='jet', cargo=kind==='cargo';
    const hull=helicopter?5.4:jet?16:cargo?11:7;
    const rotor=new T.Group();
    root.add(rotor);
    if(kind==='drone'){
      part(root,box,skin,[0,0,0],[.52,.19,.68]);
      part(root,ball,glass,[0,-.13,.26],[.12,.11,.12]);
      for(const x of [-.43,.43])for(const z of [-.40,.40]){
        tube(root,rubber,[0,0,0],[x,.02,z],.046);
        part(root,box,x<0?red:white,[x,.015,z],[.10,.075,.10]);
        part(rotor,ball,rubber,[x,.09,z],[.22,.012,.22]);
      }
      root.name=kind;group.add(root);
      return {root,rotor,kind,index,phase:airRng()*TAU};
    }
    part(root,ball,skin,[0,0,0],[helicopter?1.13:.72,helicopter?.97:.71,hull*.48]);
    part(root,ball,glass,[0,.30,hull*.27],[helicopter?1.07:.62,.60,hull*.20]);
    if(helicopter){
      tube(root,skin,[0,.14,-hull*.26],[0,.53,-6.3],.24);
      part(root,box,skin,[0,.96,-5.91],[.18,1.45,1.39]);
      part(root,box,skin,[0,.35,-5.07],[2.24,.09,.72]);
      tube(root,chrome,[0,.7,0],[0,1.52,0],.11);
      rotor.position.y=1.60;
      part(rotor,box,rubber,[0,0,0],[10.9,.076,.24]);
      part(rotor,box,rubber,[0,0,0],[.24,.076,10.9]);
      for(const side of [-1,1]){
        tube(root,chrome,[side*1.02,-1.27,-1.73],[side*1.02,-1.27,1.66],.071);
        for(const x of [-1.17,1.09])tube(root,chrome,[side*.57,-.68,x],[side*1.03,-1.27,x],.052);
      }
    }else{
      const wingspan=jet?13.6:cargo?11.4:8.15;
      for(const side of [-1,1]){
        const wing=part(root,box,skin,[side*wingspan*.47,.05,-.36],[wingspan,.136,jet?2.6:1.64]);
        wing.rotation.y=side*(jet?.34:.105);
        part(root,box,side<0?red:white,[side*wingspan*.91,.08,-.30],[.2,.16,.24]);
        if(jet||cargo)part(root,ball,chrome,[side*wingspan*.25,-.41,.23],[.37,.42,1.14]);
      }
      part(root,box,skin,[0,.01,-hull*.39],[3.19,.122,.85]);
      const tail=part(root,box,skin,[0,.67,-hull*.38],[.13,jet?2.4:1.48,.93]);
      tail.rotation.x=-.32;
      if(!jet){
        rotor.position.z=hull*.46;
        part(rotor,box,rubber,[0,0,0],[2.37,.107,.072]);
        part(rotor,box,rubber,[0,0,0],[.107,2.37,.072]);
      }
    }
    root.name=kind;
    group.add(root);
    return {root,rotor,kind,phase:airRng()*TAU,index};
  }
  const aircraftKinds=['propeller','helicopter','jet','drone','cargo'];
  const flyers=Array.from({length:Math.round(5*world.airTrafficScale)},(_,i)=>aircraft(aircraftKinds[i%aircraftKinds.length],i));
  let flightTime=0, incidentTime=900+airRng()*1700, incident=null, incidentFx=null;
  function effects(){
    const root=new T.Group(), spark=new T.MeshBasicMaterial({color:0xffbd52,transparent:true,depthWrite:false});
    const plume=surface(0x474241,{transparent:true,opacity:.32,depthWrite:false});
    const flame=surface(0xff531a,{emissive:0xf55312,emissiveIntensity:2.2});
    const flash=part(root,ball,spark,[0,0,0],[1,1,1]);
    const fire=Array.from({length:6},()=>part(root,ball,flame,[0,0,0],[1,1,1]));
    const smoke=Array.from({length:13},()=>part(root,ball,plume,[0,0,0],[1,1,1]));
    for(const mesh of [flash,...fire,...smoke])mesh.castShadow=false;
    root.visible=false;group.add(root);
    return {root,spark,flash,fire,smoke};
  }
  function impactSite(flyer){
    const start=flyer.root.position;
    for(let n=0;n<12;n++){
      const a=airRng()*TAU, range=38+airRng()*100;
      const x=start.x+Math.cos(a)*range,z=start.z+Math.sin(a)*range;
      const y=ground.height(x,z);
      if(world.land(x,z)<3&&world.roadDistance(...world.grid(x,z),true)>16&&
        !obstacles?.queryBall(x,z,y+1,7))return new T.Vector3(x,y,z);
    }
    return null;
  }
  function updateAircraft(dt,observer,preview){
    flightTime+=dt;
    for(const flyer of flyers){
      if(incident?.flyer===flyer)continue;
      const drone=flyer.kind==='drone', helicopter=flyer.kind==='helicopter';
      const rate=drone?.18:helicopter?.055:flyer.kind==='jet'?.085:.046;
      const a=flyer.phase+flightTime*rate;
      const radius=(drone?138:helicopter?510:820)+flyer.index*43;
      const x=Math.cos(a)*radius+Math.sin(flyer.index*2.1)*400;
      const z=Math.sin(a)*radius*.77+Math.cos(flyer.index*1.6)*400;
      const y=ground.height(x,z)+(drone?25:helicopter?95:flyer.kind==='jet'?260:150)+Math.sin(a*2.1)*(drone?5:22);
      flyer.root.position.set(x,y,z);
      flyer.root.rotation.set(-.02,Math.atan2(-Math.sin(a),.77*Math.cos(a)),drone?.10:helicopter?.09:.24,'YXZ');
      if(helicopter)flyer.rotor.rotation.y=-(flightTime*41)%TAU;
      else if(!drone)flyer.rotor.rotation.z=(flightTime*42)%TAU;
    }
    if(!preview&&flyers.length&&!incident){
      incidentTime-=dt*Math.sqrt(world.airTrafficScale);
      if(incidentTime<=0){
        const flyer=flyers.filter(f=>f.kind!=='drone')
          .sort((a,b)=>Math.hypot(a.root.position.x-observer.cx,a.root.position.z-observer.cz)-
            Math.hypot(b.root.position.x-observer.cx,b.root.position.z-observer.cz))[0];
        const target=flyer&&impactSite(flyer);
        if(target)incident={flyer,target,start:flyer.root.position.clone(),age:0,landed:false};
        incidentTime=target?1400+airRng()*2400:60;
      }
    }
    if(!incident||preview)return;
    incident.age+=dt;
    const {flyer,target,start,age}=incident;
    if(age<4){
      const t=age/4;
      flyer.root.position.lerpVectors(start,target,t*t);
      flyer.root.rotation.x=.24+t*.52;
      flyer.root.rotation.z=.16+Math.sin(t*6)*t*.72;
      return;
    }
    if(!incident.landed){
      incident.landed=true;
      flyer.root.position.copy(target).y+=.55;
      flyer.root.rotation.set(.12,flyer.root.rotation.y,1.18);
      onAirImpact?.(target);
      incidentFx??=effects();
      incidentFx.root.position.copy(target);
      for(let i=0;i<12&&debris;i++){
        const piece=new T.Mesh(box,paints[flyer.index%paints.length]);
        piece.scale.set(.21+airRng()*.5,.12,.25+airRng()*.5);
        piece.position.copy(target).y+=1.3;
        debris.add(piece,{kind:'box',mass:8,h:[.28,.08,.26],owner:group,
          v:new T.Vector3((airRng()-.5)*18,3+airRng()*8,(airRng()-.5)*18),w:new T.Vector3(airRng()*8,2,airRng()*7)});
      }
    }
    const elapsed=age-4, {root,flash,spark,fire,smoke}=incidentFx;
    root.visible=elapsed<36;
    flash.visible=elapsed<.55;
    flash.scale.setScalar(1.5+elapsed*10);
    spark.opacity=clip(1-elapsed/.55,0,.88);
    fire.forEach((mesh,i)=>{
      mesh.visible=elapsed<23;
      mesh.position.set(Math.cos(i*2.4)*1.8,1.15,Math.sin(i*2.4)*1.6);
      mesh.scale.set(.68,1.15+.47*Math.sin(flightTime*14+i),.63);
    });
    smoke.forEach((mesh,i)=>{
      const rise=(elapsed*.36+i/smoke.length)%1;
      mesh.position.set(rise*8,1+rise*25,(i%3-1)*rise*3.4);
      mesh.scale.setScalar(.9+rise*4.4);
    });
    if(elapsed>=36)incident=null;
  }
  let time=0;
  function step(dt,observer,traffic,hour=8.5,preview=false,signalDistance){
    time+=dt;
    humans.time.value=time;
    const boxes=stepBuses(dt,observer,traffic,hour,preview,signalDistance);
    let count=0;
    for(const actor of riders){
      const [x,z]=sample(actor.path,actor.distance),[ax,az]=sample(actor.path,actor.distance+2);
      const norm=Math.hypot(ax-x,az-z)||1,fx=(ax-x)/norm,fz=(az-z)/norm;
      // After hours each rider carries on to their own home and parks the bike at the kerb.
      const onDuty=hour>=6.12&&hour<23.2;
      const toHome=(actor.home-actor.distance+actor.path.total)%actor.path.total;
      if(onDuty)actor.resting=false;
      else if(toHome<Math.max(2,actor.speed*dt*2))actor.resting=true;
      const lane=(actor.root.name==='motorcycle'?1.58:2.48)+(actor.resting?1.05:0);
      const cx=x-fz*lane,cz=z+fx*lane;
      const toSignal=signalDistance?.({cx,cz,fx,fz,hl:actor.spec.length*.5})??Infinity;
      const [u,v]=world.grid(cx,cz);
      const urban=world.towns.some(town=>Math.hypot(u-town.u,v-town.v)<town.radius);
      let limit=actor.resting?0:Math.min(actor.pace,(urban?50:90)/3.6,Math.sqrt(Math.max(0,7*toSignal)));
      if(Math.hypot(cx-observer.cx,cz-observer.cz)<245){
        const others=preview?traffic:[observer,...traffic];
        for(const other of others){
          const dx=other.cx-cx,dz=other.cz-cz,front=dx*fx+dz*fz,side=dx*fz-dz*fx;
          if(front>0&&front<16&&Math.abs(side)<1.4)limit=Math.min(limit,Math.max(0,(front-3.15)*.9));
        }
      }
      actor.speed+=clip(limit-actor.speed,-4.1*dt,1.7*dt);
      const advance=Math.min(actor.speed*dt,toSignal);
      if(advance<actor.speed*dt)actor.speed=0;
      actor.distance=(actor.distance+advance)%actor.path.total;
      actor.phase+=actor.speed*dt;
      actor.root.visible=Math.hypot(cx-observer.cx,cz-observer.cz)<420;
      if(!actor.root.visible)continue;
      const y=ground.height(cx,cz), yaw=Math.atan2(fx,fz);
      actor.root.position.set(cx,y,cz);
      actor.root.rotation.y=yaw;
      for(const wheel of actor.wheels)wheel.rotation.x=actor.phase/actor.spec.tire;
      const rear=actor.spec.ride===13?.22:.33;
      if(!actor.resting){
        attrs.aInst.setXYZW(count,cx-fx*rear,cz-fz*rear,yaw,actor.phase*2.5);
        attrs.aLook.setXYZ(count,...actor.look);
        attrs.aPose.setXY(count,y+(actor.spec.ride===13?.16:.04),actor.spec.ride);
        attrs.aVar.setXYZW(count,actor.height,32,actor.speed,0);
        count++;
      }
      boxes.push({cx,cz,y,fx,fz,rx:fz,rz:-fx,vx:fx*actor.speed,vz:fz*actor.speed,
        hl:actor.spec.length/2,hw:actor.spec.width/2,mass:actor.spec.mass});
    }
    humans.mesh.geometry.instanceCount=count;
    for(const attr of ['aInst','aLook','aPose','aVar'])attrs[attr].needsUpdate=true;
    updateAircraft(dt,observer,preview);
    return boxes;
  }
  return {group,step,buses,busStops,
    airTraffic:{flyers,step:updateAircraft,get incident(){return incident;}}};
}
