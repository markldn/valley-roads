// Signal-controlled junctions in the towns. Opposing approaches share a green, with amber and an
// all-red gap between phases. Cars, riders and the demo driver all obey the same stop lines.
import * as T from '../vendor/three.module.js';
import { instances } from '../world/scenery.js';

const GREEN=20, AMBER=3, CLEAR=2, CYCLE=(GREEN+AMBER+CLEAR)*2;
const LAMPS=[0xff2a1c,0xffb020,0x2cff78], OFF=[0x2a0a08,0x2a1e06,0x07240f];

export function createTrafficLights(world,network,obstacles) {
  const group=new T.Group();
  const inTown=(x,z)=>{const [u,v]=world.grid(x,z);return world.towns.some(town=>town.tier==='hub'&&Math.hypot(town.u-u,town.v-v)<town.radius*.8);};
  const nearRoundabout=(x,z)=>world.roundabouts.some(circle=>{const [cx,cz]=world.point(circle.u,circle.v);return Math.hypot(cx-x,cz-z)<circle.cut+26;});
  // A stop line is the end of a road edge whose node branches into several junction movements.
  const stops=[];
  for(const edge of network.edges){
    if(edge.motorway||edge.ramp||edge.turn||edge.motorwayLink||edge.length<14)continue;
    const onward=edge.to.edges.filter(next=>next.length<46);
    if(onward.length<2)continue;
    const end=edge.knots.at(-1), before=edge.knots.at(-3)??edge.knots[0];
    const span=Math.hypot(end[0]-before[0],end[1]-before[1])||1;
    if(!inTown(end[0],end[1])||nearRoundabout(end[0],end[1]))continue;
    stops.push({x:end[0],z:end[1],fx:(end[0]-before[0])/span,fz:(end[1]-before[1])/span});
  }
  const junctions=[];
  for(const stop of stops){
    let home=junctions.find(item=>Math.hypot(item.x-stop.x,item.z-stop.z)<30);
    if(!home){home={x:stop.x,z:stop.z,stops:[],offset:junctions.length*7.3%CYCLE};junctions.push(home);}
    home.stops.push(stop);
  }
  const signals=[], cells=new Map();
  const poles=[], heads=[], plates=[], lines=[], lamps=[];
  for(const junction of junctions){
    if(junction.stops.length<3)continue;
    const first=junction.stops[0];
    for(const stop of junction.stops){
      stop.phase=Math.abs(stop.fx*first.fx+stop.fz*first.fz)>.7?0:1;
      stop.junction=junction;stop.state=0;stop.lamps=[];
      // The pole stands on the pavement to the driver's right of the stop line.
      const rx=stop.fz, rz=-stop.fx, edgeAt=d=>{const [u,v]=world.grid(stop.x+rx*d,stop.z+rz*d);return Math.min(world.roadDistance(u,v,true),world.nearestStreet(u,v)?.edge??9);};
      const side=edgeAt(4)>=edgeAt(-4)?1:-1;
      let reach=1.5;
      while(reach<9&&Math.min(edgeAt(reach*side),9)<.55)reach+=.35;
      const px=stop.x+rx*side*reach-stop.fx*.8, pz=stop.z+rz*side*reach-stop.fz*.8, y=world.roadHeight(px,pz)+.2;
      const yaw=Math.atan2(stop.fx,stop.fz)+Math.PI;
      poles.push([px,y+1.9,pz,.065,3.8,.065,0,0x30353a]);
      obstacles.addPosts([[px,pz]],.1);
      const hx=px-stop.fx*.14, hz=pz-stop.fz*.14;
      heads.push([hx,y+3.25,hz,.34,1.02,.24,yaw,0x15181a]);
      plates.push([hx+stop.fx*.05,y+3.25,hz+stop.fz*.05,.62,1.3,.03,yaw,0x0d0e0f]);
      [0,1,2].forEach(level=>{
        const record=[hx-stop.fx*.135,y+3.57-level*.32,hz-stop.fz*.135,.115,.115,.05,yaw,OFF[level]];
        record.level=level;stop.lamps.push(record);lamps.push(record);
      });
      const roadY=world.roadHeight(stop.x,stop.z)+.215;
      lines.push([stop.x,roadY,stop.z,3.3,.012,.42,Math.atan2(stop.fx,stop.fz),0xf0ede2]);
      signals.push(stop);
      const key=Math.floor(stop.x/64)+':'+Math.floor(stop.z/64);
      if(!cells.has(key))cells.set(key,[]);
      cells.get(key).push(stop);
    }
  }
  const box=new T.BoxGeometry(), pole=new T.CylinderGeometry(1,1,1,8), lens=new T.SphereGeometry(1,10,8);
  const steel=new T.MeshStandardMaterial({color:0xffffff,roughness:.55,metalness:.4}), paint=new T.MeshStandardMaterial({color:0xffffff,roughness:.8});
  const glow=new T.MeshBasicMaterial({color:0xffffff,toneMapped:false});
  let lampMesh=null;
  if(signals.length){
    group.add(instances(pole,poles,steel),instances(box,heads,steel),instances(box,plates,steel,false),instances(box,lines,paint,false));
    lampMesh=instances(lens,lamps,glow,false);
    lamps.forEach((record,index)=>{record.index=index;});
    group.add(lampMesh);
  }
  const tint=new T.Color();
  const stateOf=(stop,time)=>{
    const t=((time+stop.junction.offset)%CYCLE+CYCLE)%CYCLE, local=stop.phase?(t+CYCLE/2)%CYCLE:t;
    return local<GREEN?2:local<GREEN+AMBER?1:0;
  };
  return {group,count:signals.length,junctions:new Set(signals.map(stop=>stop.junction)).size,
    update(time) {
      let dirty=false;
      for(const stop of signals){
        const state=stateOf(stop,time);
        if(state===stop.state&&stop.painted)continue;
        stop.state=state;stop.painted=true;dirty=true;
        stop.lamps.forEach(record=>{
          const lit=record.level===(state===2?2:state===1?1:0);
          lampMesh.setColorAt(record.index,tint.set(lit?LAMPS[record.level]:OFF[record.level]));
        });
      }
      if(dirty&&lampMesh?.instanceColor)lampMesh.instanceColor.needsUpdate=true;
    },
    // Distance to the stop line a vehicle must obey, or Infinity when its way is clear.
    distance(box) {
      const column=Math.floor(box.cx/64),row=Math.floor(box.cz/64);
      let best=Infinity;
      for(let i=-1;i<=1;i++)for(let j=-1;j<=1;j++)for(const stop of cells.get((column+i)+':'+(row+j))||[]){
        if(stop.state===2||box.fx*stop.fx+box.fz*stop.fz<.8)continue;
        const dx=stop.x-box.cx,dz=stop.z-box.cz,ahead=dx*stop.fx+dz*stop.fz,side=Math.abs(dx*stop.fz-dz*stop.fx);
        if(ahead<-.5||ahead>52||side>2.6)continue;
        const room=Math.max(0,ahead-(box.hl||0)-.4);
        // On amber a car too close to stop safely carries on through.
        const speed=Math.hypot(box.vx||0,box.vz||0);
        if(stop.state===1&&room<speed*speed/7)continue;
        best=Math.min(best,room);
      }
      return best;
    },
    dispose(){for(const item of [box,pole,lens,steel,paint,glow])item.dispose();}};
}
