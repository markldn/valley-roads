import { cubic, corridor } from '../world/network.js';

const cross=([x,y],[u,v])=>x*v-y*u;
const delta=(a,b)=>[a[0]-b[0],a[1]-b[1]];

function intersection(a,b,c,d) {
  const ab=delta(b,a), cd=delta(d,c), ac=delta(c,a);
  const area=cross(ab,cd);
  if(Math.abs(area)<.00001)return null;
  const t=cross(ac,cd)/area, u=cross(ac,ab)/area;
  if(t< -1e-7||t>1+1e-7||u< -1e-7||u>1+1e-7)return null;
  return [Math.max(0,Math.min(1,t)),Math.max(0,Math.min(1,u))];
}

export function cityTraffic(world, connectRoad) {
  const streets=world.streets.filter(s=>s.urban||s.surface===9&&!s.connector)
    .map(s=>({...corridor(s.points,s.width,'street'),town:s.town,marks:[]}));
  const junctions=new Map(), segments=[], cells=new Map(), size=48;
  function mark(street,along,junction) {
    const at=street.total-along<.001&&street.points[0]===street.points.at(-1)?0:along;
    if(!street.marks.some(m=>Math.abs(m.along-at)<.001))street.marks.push({along:at,junction});
  }
  function join(p) {
    const key=p.map(v=>Math.round(v*1000)).join(',');
    if(!junctions.has(key))junctions.set(key,{p,arms:[]});
    return junctions.get(key);
  }
  for(const street of streets)for(let i=1;i<street.points.length;i++){
    const a=street.points[i-1],b=street.points[i];
    const segment={street,i,a,b}, seen=new Set();
    for(let x=Math.floor(Math.min(a[0],b[0])/size);x<=Math.floor(Math.max(a[0],b[0])/size);x++)
      for(let y=Math.floor(Math.min(a[1],b[1])/size);y<=Math.floor(Math.max(a[1],b[1])/size);y++){
        const key=x+','+y;
        if(!cells.has(key))cells.set(key,[]);
        const bucket=cells.get(key);
        for(const other of bucket){
          if(other.street===street||seen.has(other))continue;
          seen.add(other);
          const hit=intersection(a,b,other.a,other.b);
          if(!hit)continue;
          const p=a.map((v,k)=>v+(b[k]-v)*hit[0]);
          const junction=join(p);
          mark(street,atSegment(segment,hit[0]),junction);
          mark(other.street,atSegment(other,hit[1]),junction);
        }
        bucket.push(segment);
      }
    segments.push(segment);
  }
  function atSegment({street,i},t) {
    return street.length[i-1]+(street.length[i]-street.length[i-1])*t;
  }
  const arterials=new Map();
  for(const {street,i,a,b} of segments)for(const road of world.roads){
    if(road.highway)continue;
    const axis=road.alongX?0:1, other=1-axis;
    const span=b[other]-a[other];
    if(!span)continue;
    const t=(road.cross-a[other])/span;
    if(t<0||t>1)continue;
    const station=a[axis]+(b[axis]-a[axis])*t;
    const p=road.alongX?[station,road.cross]:[road.cross,station];
    const key=p.map(v=>Math.round(v*1000)).join(',');
    let junction=arterials.get(key);
    if(!junction){
      const arms=connectRoad(road,station,p);
      if(!arms)continue;
      junction=join(p);
      junction.road=arms;
      arterials.set(key,junction);
    }
    mark(street,atSegment({street,i},t),junction);
  }

  function point(street,s,sign) {
    const {length,points,total}=street;
    const along=(s+total)%total;
    let i=1;
    while(length[i]<along)i++;
    const a=points[i-1], b=points[i], d=length[i]-length[i-1];
    const t=(along-length[i-1])/d;
    return [a[0]+(b[0]-a[0])*t-sign*(b[1]-a[1])/d*1.35,
      a[1]+(b[1]-a[1])*t+sign*(b[0]-a[0])/d*1.35];
  }
  function drivable(path,clearance) {
    const legal=p=>!world.highwayAt(...p,clearance)&&world.roadDistance(...p,true)<=0;
    return path.every((p,i)=>{
      if(!legal(p))return false;
      const last=path[i-1];
      return !last||legal(p.map((v,k)=>(v+last[k])*.5));
    });
  }
  function direction(a,b) {
    const d=delta(b,a), length=Math.hypot(...d)||1;
    return d.map(v=>v/length);
  }
  function connect(add,node,roadPort) {
    for(const street of streets){
      const ordered=street.marks.sort((a,b)=>a.along-b.along);
      const closed=street.points[0]===street.points.at(-1);
      for(let i=0;i<ordered.length-(closed?0:1);i++){
        const a=ordered[i], b=ordered[(i+1)%ordered.length];
        const end=i+1<ordered.length?b.along:b.along+street.total;
        const length=end-a.along;
        if(length<.5)continue;
        const inset=Math.min(5,length*.23);
        const low=a.along+inset, high=end-inset;
        const count=Math.ceil((high-low)/2);
        const sampled=Array.from({length:count+1},(_,j)=>low+(high-low)*j/count);
        const forward=sampled.map(s=>point(street,s,1));
        const backward=sampled.slice().reverse().map(s=>point(street,s,-1));
        if([forward,backward].some(path=>!drivable(path,3)))continue;
        const left={in:node(backward.at(-1)),out:node(forward[0]),
          arrival:direction(backward.at(-2),backward.at(-1)),departure:direction(forward[0],forward[1])};
        const right={in:node(forward.at(-1)),out:node(backward[0]),
          arrival:direction(forward.at(-2),forward.at(-1)),departure:direction(backward[0],backward[1])};
        a.junction.arms.push(left);
        b.junction.arms.push(right);
        for(const [from,to,path] of [[left.out,right.in,forward],[right.out,left.in,backward]]){
          const edge=add(from,to,path);
          edge.street=street;
          edge.cost=edge.length/(street.town?13.5:12);
        }
      }
    }
    for(const j of junctions.values()){
      const arms=[...j.arms,...(j.road??[]).map(roadPort)];
      for(const a of arms)for(const b of arms){
        if(a===b)continue;
        const from=a.in.p,to=b.out.p;
        const handle=(p,heading,sign)=>p.map((v,k)=>v+sign*heading[k]*Math.hypot(...delta(j.p,p))*.77);
        let curve=cubic(from,handle(from,a.arrival,1),handle(to,b.departure,-1),to,10);
        if(!drivable(curve,2)){
          const towardCenter=p=>p.map((v,k)=>v+(j.p[k]-v)*.82);
          curve=cubic(from,towardCenter(from),towardCenter(to),to,10);
          if(!drivable(curve,2))continue;
        }
        const edge=add(a.in,b.out,curve);
        edge.turn=a.arrival[0]*b.departure[0]+a.arrival[1]*b.departure[1]<.88;
        edge.street=true;
        edge.cost=edge.length/(edge.turn?5.5:13.5);
      }
    }
  }
  return connect;
}
