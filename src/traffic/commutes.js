import * as T from '../vendor/three.module.js';
import { walkingMeshes } from './population.js';
import { pedestrianPose } from '../people/pedestrian.js';
import { random } from '../world/world.js';

const CELL=5, REACH=84, SIDE=REACH*2+1;
const neighbors=[[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
const index=(x,z)=>(z+REACH)*SIDE+x+REACH;
const coords=id=>[id%SIDE-REACH,Math.floor(id/SIDE)-REACH];
const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);

function navigation(world,buildings){
  const origin=world.point(0,0);
  const cells=new Map();
  for(const house of buildings){
    if(distance(origin,[house.x,house.z])>REACH*CELL*1.48) continue;
    const [x,z]=[Math.floor(house.x/18),Math.floor(house.z/18)];
    const key=x+':'+z;
    if(!cells.has(key))cells.set(key,[]);
    cells.get(key).push(house);
  }
  const blocked=(x,z)=>{
    if(world.land(x,z)===3)return true;
    const u=Math.floor(x/18),v=Math.floor(z/18);
    for(let i=-1;i<=1;i++)for(let j=-1;j<=1;j++)for(const house of cells.get((u+i)+':'+(v+j))||[]){
      const dx=x-house.x,dz=z-house.z,c=Math.cos(house.rotation),s=Math.sin(house.rotation);
      if(Math.abs(dx*c-dz*s)<house.halfX+.55&&Math.abs(dx*s+dz*c)<house.halfZ+.55)return true;
    }
    return false;
  };
  const costs=new Float32Array(SIDE*SIDE);
  const cost=(id)=>{
    if(costs[id])return costs[id];
    const [u,v]=coords(id),x=origin[0]+u*CELL,z=origin[1]+v*CELL;
    if(blocked(x,z))return costs[id]=Infinity;
    const [s,t]=world.grid(x,z);
    if(world.highwayAt(s,t,.7))return costs[id]=Infinity;
    const edge=world.roadDistance(s,t,true);
    // The carriageway can only be crossed at a zebra crossing.
    const zebra=world.crossings.some(([cu,cv])=>Math.hypot(cu-s,cv-t)<7);
    if(edge<.8&&!zebra)return costs[id]=Infinity;
    return costs[id]=edge<3.1?1:edge<9?1.25:1.7;
  };

  const point=id=>coords(id).map((v,i)=>origin[i]+v*CELL);
  const clear=(a,b)=>[.25,.5,.75].every(f=>!blocked(a[0]+(b[0]-a[0])*f,a[1]+(b[1]-a[1])*f));
  function closest(p) {
    const [gx,gz]=p.map((v,i)=>Math.round((v-origin[i])/CELL));
    let best=-1, length=Infinity;
    for(let x=gx-3;x<=gx+3;x++)for(let z=gz-3;z<=gz+3;z++){
      if(Math.abs(x)>REACH||Math.abs(z)>REACH)continue;
      const id=index(x,z), area=point(id), d=distance(p,area);
      if(d>=length||cost(id)===Infinity||!clear(p,area))continue;
      best=id;length=d;
    }
    return best;
  }

  // The neighborhood graph is small and trips are short. The agenda remains deterministic.
  function route(a,b){
    const start=closest(a), goal=closest(b);
    if(start<0||goal<0)return null;
    const agenda=[start], first=new Map([[start,0]]), previous=new Map(), end=coords(goal);
    let budget=1800;
    while(agenda.length&&budget-->0){
      let next=0,min=Infinity;
      for(let i=0;i<agenda.length;i++){
        const id=agenda[i],[x,z]=coords(id);
        const h=first.get(id)+Math.hypot(x-end[0],z-end[1]);
        if(h<min){min=h;next=i;}
      }
      const current=agenda.splice(next,1)[0];
      if(current===goal){
        const result=[];
        for(let id=goal;id!=null;id=previous.get(id))result.push(point(id));
        return [a,...result.reverse(),b];
      }
      const [x,z]=coords(current), here=point(current);
      for(const [dx,dz] of neighbors){
        if(Math.abs(x+dx)>REACH||Math.abs(z+dz)>REACH)continue;
        const id=index(x+dx,z+dz);
        const n=cost(id)*Math.hypot(dx,dz)+first.get(current);
        if(n>=(first.get(id)??Infinity)||!clear(here,point(id)))continue;
        first.set(id,n);
        previous.set(id,current);
        if(!agenda.includes(id))agenda.push(id);
      }
    }
    return null;
  }
  return {route};
}

function timedRoute(points,arrival,speed) {
  const edges=[0];
  for(let i=1;i<points.length;i++)edges.push(edges.at(-1)+distance(points[i-1],points[i]));
  const length=edges.at(-1), hours=length/(speed*24);
  return {points,edges,length,start:arrival-hours,end:arrival,speed};
}

function sample(trip,hour,lag=0) {
  const {points,edges,length,start,end}=trip;
  const progress=T.MathUtils.clamp((hour-start)/(end-start)*length-lag,0,length);
  let i=1;
  while(i<edges.length-1&&edges[i]<progress)i++;
  const a=points[i-1],b=points[i],span=Math.max(.001,edges[i]-edges[i-1]);
  const t=(progress-edges[i-1])/span;
  return {x:T.MathUtils.lerp(a[0],b[0],t),z:T.MathUtils.lerp(a[1],b[1],t),
    facing:Math.atan2(b[0]-a[0],b[1]-a[1])};
}

export function createCommuters(world,sites,ground,region){
  const group=new T.Group(), rng=random(world.seed^0x6de39), residents=[];
  const homes=region.obstacles.filter(house=>house.entry && sites.every(site=>distance(house.entry,[site.x,site.z])>4));
  const graph=navigation(world,homes.length?region.obstacles:[]);
  const porch=site=>[site.x+site.nx*1.08,site.z+site.nz*1.08];
  const door=site=>[site.x-site.nx*.5,site.z-site.nz*.5];
  for(const site of sites){
    const work=porch(site);
    const potential=homes.filter(h=>distance(h.entry,work)>19&&distance(h.entry,work)<83);
    for(let i=0;i<Math.round((site.kind==='school'?4:3)*world.peopleScale)&&potential.length;i++){
      const homeLot=potential.splice(Math.floor(rng()*potential.length),1)[0];
      const home=[homeLot.entry[0]+homeLot.front[0]*1.03,homeLot.entry[1]+homeLot.front[1]*1.03];
      const walked=graph.route(home,work);
      if(!walked)continue;
      const inside=[homeLot.entry[0]-homeLot.front[0]*.5,homeLot.entry[1]-homeLot.front[1]*.5];
      const path=[inside,...walked,door(site)];
      const pace=1.36+rng()*.51, arrival=(site.kind==='school'?8.12:8.0)+rng()*.77;
      const there=timedRoute(path,arrival,pace);
      const returnPath=[...path].reverse();
      const back=timedRoute(returnPath,site.kind==='school'?17.7+rng()*.58:18.3+rng()*1.2,pace);
      const trips=[there];
      const errands=sites.filter(other=>other!==site&&['cafe','supermarket','shop'].includes(other.kind)&&
        distance(porch(other),work)<106);
      if(site.kind!=='school' && errands.length && i%2===1){
        const shop=errands[Math.floor(rng()*errands.length)], stop=porch(shop);
        const lunch=graph.route(work,stop), leave=graph.route(stop,work);
        if(lunch&&leave){
          const outgoing=timedRoute([door(site),...lunch,door(shop)],12.6+rng()*.68,pace);
          const incoming=timedRoute([door(shop),...leave,door(site)],15.35+rng()*.44,pace);
          if(incoming.start>outgoing.end+.16&&outgoing.start>there.end&&back.start>incoming.end)
            trips.push(outgoing,incoming);
        }
      }
      trips.push(back);
      const identity=()=>({hue:rng(),trousers:rng(),skin:rng(),
        height:.84+rng()*.25,variant:Math.floor(rng()*49),phase:rng()*25});
      residents.push({...identity(),trips,lag:0});
      if(site.kind==='school'){
        const child=identity();
        residents.push({...child,skin:(residents.at(-1).skin+child.skin)*.5,trips,
          height:.61+rng()*.13,variant:64+(i%2?1:32),lag:1.2});
      }
    }
  }
  const walkers=walkingMeshes(Math.max(1,residents.length));
  walkers.mesh.name='Household commutes';
  group.add(walkers.mesh);
  const attrs=walkers.mesh.geometry.attributes;

  function step(dt,hour,observer,vehicles){
    walkers.time.value+=dt;
    let visible=0, nearby=0;
    for(const person of residents){
      const trip=person.trips.find(item=>hour>=item.start&&hour<item.end);
      if(!trip)continue;
      const state=sample(trip,hour,person.lag);
      const {x,z,facing}=state;
      if(Math.hypot(x-observer.cx,z-observer.cz)>260)continue;
      const pose=pedestrianPose(person,x,z,facing,trip.speed,
        walkers.time.value*5.1+person.phase,dt,vehicles,ground.height);
      attrs.aInst.setXYZW(visible,pose.x,pose.z,pose.yaw,pose.phase);
      attrs.aLook.setXYZ(visible,person.hue,person.trousers,person.skin);
      attrs.aPose.setXY(visible,pose.y,pose.reaction);
      attrs.aVar.setXYZW(visible,person.height,person.variant,pose.speed,0);
      if(Math.hypot(pose.x-observer.cx,pose.z-observer.cz)<32)nearby++;
      visible++;
    }
    walkers.mesh.geometry.instanceCount=visible;
    for(const attr of ['aInst','aLook','aPose','aVar'])attrs[attr].needsUpdate=true;
    return nearby;
  }
  return {group,step,residentCount:residents.length};
}
