import * as T from '../vendor/three.module.js';
import { instances } from './scenery.js';
import { surface } from '../render/visuals.js';
import { random } from './world.js';
import { createRiverWater } from './river-water.js';

export function riverScene(world) {
  const path=new Path2D();
  for(let z=-3250,i=0;z<=3250;z+=5,i++){
    if(i) path.lineTo(world.riverX(z),z);
    else path.moveTo(world.riverX(z),z);
  }
  const water=createRiverWater(world);
  const group=new T.Group();
  group.add(water.group);
  const reedGeometry=new T.BufferGeometry();
  const blades=[];
  for(let i=0;i<9;i++){
    const angle=i*2.4, x=Math.cos(angle), z=Math.sin(angle), r=.05+i*.036;
    blades.push(x*r-z*.022,-.5,z*r+x*.022,x*r+z*.022,-.5,z*r-x*.022,
      x*(r+.11),.47-i*.052,z*(r+.11));
  }
  reedGeometry.setAttribute('position',new T.Float32BufferAttribute(blades,3));
  reedGeometry.computeVertexNormals();
  const reeds=surface(0xffffff,{pattern:'grass',side:T.DoubleSide});
  const rng=random(world.seed ^ 0x89643);
  const records=[];
  for(let z=-3190;z<3190;z+=6){
    for(const side of [-1,1]){
      if(rng()<.27) continue;
      const bank=world.riverX(z)+side*world.riverWidth(z);
      for(let i=0;i<4;i++){
        const px=bank+side*(.8+rng()*5.8), pz=z+(rng()-.5)*7;
        if(world.riverEdge(px,pz)<.2 || world.roadDistance(...world.grid(px,pz),true)<4) continue;
        const height=.55+rng()*1.05;
        records.push([px,world.height(px,pz)+height*.46,pz,.74,height,.79,rng()*6.28,
          i%3?0x6c783f:0x8a8451]);
      }
    }
  }
  for(let start=-3200;start<3200;start+=320){
    const batch=records.filter(record=>record[2]>=start && record[2]<start+320);
    if(batch.length) group.add(instances(reedGeometry,batch,reeds,false));
  }
  return { group,path,water };
}

function crossesCarriageway(world, road, street, x, z, height) {
  const [u,v]=world.grid(x,z);
  const sameLevel=y=>Math.abs(height-y)<1.25;
  for(const other of world.roads){
    if(other===road) continue;
    const along=other.alongX?u:v, across=other.alongX?v:u;
    if(Math.abs(across-other.cross)>=world.motorwayWidth(other,along)/2) continue;
    if(other.spans.some(([start,end])=>along>=start&&along<=end) &&
      sameLevel(world.roadDeck(other,u,v,x,z))) return true;
  }
  const ramp=world.rampAt(x,z);
  if(ramp?.edge<=0 && sameLevel(world.rampDeck(ramp.path,x,z,ramp.y))) return true;
  return world.nearestStreet(u,v,street)?.edge<=0 && sameLevel(world.roadHeight(x,z));
}

export function bridges(world, segments, group, barriers, geometry, material) {
  const concrete=[], posts=[], deck=[], railFaces=[];
  const joins=new Map();
  for(const {a,b,width,road,street} of segments){
    const dx=b[0]-a[0], dz=b[1]-a[1], length=Math.hypot(dx,dz);
    if(length<.15) continue;
    const owner=road??street??(Math.abs(dx)>Math.abs(dz)?'east-west':'north-south');
    if(!joins.has(owner)) joins.set(owner,new Map());
    const ends=joins.get(owner);
    for(const point of [a,b]){
      const key=point.join(',');
      const join=ends.get(key)??{rx:0,rz:0,width:0,count:0};
      join.rx+=dz/length;join.rz-=dx/length;
      join.width+=width;join.count++;
      ends.set(key,join);
    }
  }
  const quad=(a,b,c,d)=>railFaces.push(...a,...b,...c,...a,...c,...d);
  for(const {a,b,width,road,street,viaduct,support} of segments){
    const dx=b[0]-a[0], dz=b[1]-a[1];
    const length=Math.hypot(dx,dz);
    if(length<.15) continue;
    const x=(a[0]+b[0])/2, z=(a[1]+b[1])/2;
    if(!viaduct&&(world.riverWidth(z)<4 || world.riverEdge(x,z)>5)) continue;
    const level=(x,z)=>road?world.roadDeck(road,...world.grid(x,z),x,z):world.roadHeight(x,z);
    const y=level(x,z);
    const yaw=Math.atan2(dx,dz), rx=dz/length, rz=-dx/length;
    const ends=joins.get(road??street??(Math.abs(dx)>Math.abs(dz)?'east-west':'north-south'));
    const edge=(point,side,offset=0)=>{
      const join=ends.get(point.join(','));
      const normal=Math.hypot(join.rx,join.rz)||1;
      const distance=(join.width/join.count*.5+offset)*side;
      const px=point[0]+join.rx/normal*distance,pz=point[1]+join.rz/normal*distance;
      return [px,level(px,pz)-.08,pz];
    };
    const lower=([x,y,z])=>[x,y-(viaduct?1.02:.73),z];
    const al=edge(a,-1), ar=edge(a,1), bl=edge(b,-1), br=edge(b,1);
    for(const [p,q] of [[al,bl],[br,ar]])
      deck.push(...p,...lower(p),...q,...q,...lower(p),...lower(q));
    deck.push(...lower(al),...lower(ar),...lower(bl),...lower(ar),...lower(br),...lower(bl));
    for(const side of [-1,1]){
      const ra=edge(a,side,.11), rb=edge(b,side,.11);
      const rail=[ra[0],ra[2],rb[0],rb[2]];
      const samples=Math.ceil(length/.7);
      let crossing=false;
      for(let i=0;i<=samples&&!crossing;i++){
        const px=T.MathUtils.lerp(rail[0],rail[2],i/samples),pz=T.MathUtils.lerp(rail[1],rail[3],i/samples);
        crossing=crossesCarriageway(world,road,street,px,pz,level(px,pz));
      }
      if(crossing) continue;
      for(const height of [.58,.98]){
        const ring=point=>[[.057,-.043],[.162,-.043],[.162,.043],[.057,.043]]
          .map(([offset,lift])=>{
            const p=edge(point,side,offset);
            p[1]+=height+.08+lift;
            return p;
          });
        const from=ring(a), to=ring(b);
        for(let i=0;i<4;i++){
          const j=(i+1)%4;
          if(side===1) quad(from[i],from[j],to[j],to[i]);
          else quad(from[j],from[i],to[i],to[j]);
        }
      }
      posts.push([(ra[0]+rb[0])*.5,(ra[1]+rb[1])*.5+.62,(ra[2]+rb[2])*.5,.14,1.05,.14,yaw,0x59696c]);
      barriers.push([...rail,Math.min(ra[1],rb[1])-.07,Math.max(ra[1],rb[1])+1.13]);
    }
    if(!viaduct&&Math.round(z/11)%3===0 && world.riverEdge(x,z)<-6){
      const bottom=world.height(x,z);
      if(y>bottom+1) concrete.push([x,(bottom+y-.60)/2,z,width*.55,y-bottom-.60,1.05,yaw,0xa19d92]);
    }
    if(support&&!world.highwayAt(...world.grid(x,z),2.5)){
      const bottom=world.height(x,z);
      if(y>bottom+1.2) for(const side of [-1,1]){
        concrete.push([x+rx*side*width*.25,(bottom+y-.76)*.5,z+rz*side*width*.25,
          1.05,y-bottom-.76,1.35,yaw,0xaaa59a]);
      }
    }
  }
  if(deck.length){
    const girder=new T.BufferGeometry();
    girder.setAttribute('position',new T.Float32BufferAttribute(deck,3));
    girder.computeVertexNormals();
    const beam=new T.Mesh(girder,material);
    beam.castShadow=beam.receiveShadow=true;
    group.add(beam);
  }
  if(concrete.length) group.add(instances(geometry,concrete,material));
  if(posts.length) group.add(instances(geometry,posts,material));
  if(railFaces.length){
    const rails=new T.BufferGeometry();
    rails.setAttribute('position',new T.Float32BufferAttribute(railFaces,3));
    rails.computeVertexNormals();
    const mesh=new T.Mesh(rails,surface(0x48585a,{side:T.DoubleSide}));
    mesh.castShadow=mesh.receiveShadow=true;
    group.add(mesh);
  }
}

export function coreBridgeSegments(world) {
  const segments=[];
  for(const road of world.roads){
    const point=along=>road.alongX?world.point(along,road.cross):world.point(road.cross,along);
    for(const [start,end] of road.spans)for(let s=start;s<end;s+=5){
      const next=Math.min(s+5,end),middle=(s+next)*.5;
      const viaduct=road.overpasses?.some(bridge=>middle>bridge.start&&middle<bridge.end);
      const support=viaduct&&Math.floor((s-start)/5)%5===0;
      segments.push({a:point(s),b:point(next),width:world.motorwayWidth(road,middle),road,viaduct,support});
    }
  }
  for(const street of world.streets){
    if(street.ramp)continue;
    for(let i=1;i<street.points.length;i++){
      const a=world.point(...street.points[i-1]), b=world.point(...street.points[i]);
      const n=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/5));
      const at=t=>[T.MathUtils.lerp(a[0],b[0],t),T.MathUtils.lerp(a[1],b[1],t)];
      for(let j=0;j<n;j++) segments.push({a:at(j/n),b:at((j+1)/n),width:street.width,street});
    }
  }
  return segments;
}
