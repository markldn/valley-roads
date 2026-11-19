const lerp=(a,b,t)=>a+(b-a)*t;
const tau=2*Math.PI;
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const smooth=t=>{t=clamp(t,0,1);return t*t*(3-2*t);};

export function cubic(a,b,c,d,segments=24) {
  return Array.from({length:segments+1},(_,i)=>{
    const t=i/segments,s=1-t;
    return a.map((value,j)=>s*s*s*value+3*s*s*t*b[j]+3*s*t*t*c[j]+t*t*t*d[j]);
  });
}

// Fit a tangent circular arc, reducing its radius only when an adjacent
// straight is too short. Trim limits leave a straight between neighboring arcs.
export function smoothCorners(points, radius) {
  const result=[points[0]];
  for(let i=1;i<points.length-1;i++){
    const a=points[i-1],b=points[i],c=points[i+1];
    const inLength=Math.hypot(b[0]-a[0],b[1]-a[1]),outLength=Math.hypot(c[0]-b[0],c[1]-b[1]);
    if(inLength<.001||outLength<.001) continue;
    const dx=(b[0]-a[0])/inLength,dz=(b[1]-a[1])/inLength;
    const ex=(c[0]-b[0])/outLength,ez=(c[1]-b[1])/outLength;
    const turn=Math.atan2(dx*ez-dz*ex,dx*ex+dz*ez);
    if(Math.abs(turn)<.01||Math.abs(turn)>Math.PI-.01){result.push(b);continue;}
    const tangent=Math.tan(Math.abs(turn)*.5);
    const trim=Math.min(radius*tangent,inLength*.46,outLength*.46);
    const r=trim/tangent, sign=Math.sign(turn);
    const start=[b[0]-dx*trim,b[1]-dz*trim];
    const center=[start[0]-dz*r*sign,start[1]+dx*r*sign];
    const bearing=Math.atan2(start[1]-center[1],start[0]-center[0]);
    const steps=Math.max(3,Math.ceil(Math.abs(turn)/.10),Math.ceil(Math.abs(turn)*r/2.4));
    for(let j=0;j<=steps;j++){
      const angle=bearing+turn*j/steps;
      result.push([center[0]+r*Math.cos(angle),center[1]+r*Math.sin(angle)]);
    }
  }
  return [...result,points.at(-1)];
}

// Grow a connected set of loops from the hub. A shared edge becomes one
// road, and only adjacent edges on the same corridor are merged.
export function regionalNetwork(u, v, limit, random, terrainCost) {
  const cells=[];
  for(let j=0;j<v.length-1;j++) for(let i=0;i<u.length-1;i++){
    const bounds=[u[i],v[j],u[i+1],v[j+1]];
    const [x,z,X,Z]=bounds;
    const cost=(terrainCost(x,z,X,z)+terrainCost(X,z,X,Z)+
      terrainCost(X,Z,x,Z)+terrainCost(x,Z,x,z))*.25;
    cells.push({i,j,bounds,cost:cost+random()*.8});
  }
  const selected=[];
  const hub=cells.filter(({bounds:[x,z,X,Z]})=>x<=0&&X>=0&&z<=0&&Z>=0);
  const count=8+Math.floor(random()*6);
  while(selected.length<count){
    const frontier=selected.length?cells.filter(cell=>!selected.includes(cell)&&
      selected.some(other=>Math.abs(other.i-cell.i)+Math.abs(other.j-cell.j)===1)):hub;
    selected.push(frontier.reduce((best,cell)=>cell.cost<best.cost?cell:best));
  }

  const corridors=[new Map(),new Map()];
  function edge(axis,cross,start,end){
    const lines=corridors[axis];
    if(!lines.has(cross)) lines.set(cross,[]);
    lines.get(cross).push([start,end]);
  }
  for(const {bounds:[x,z,X,Z]} of selected){
    edge(0,z,x,X); edge(0,Z,x,X);
    edge(1,x,z,Z); edge(1,X,z,Z);
  }
  // These two approaches meet the existing streamed roads at the region seam.
  edge(0,0,-limit,limit);
  edge(1,0,-limit,limit);
  const roads=[];
  for(const [axis,lines] of corridors.entries()) for(const [cross,ranges] of lines){
    const merged=[];
    for(const [start,end] of ranges.sort((a,b)=>a[0]-b[0])){
      const last=merged.at(-1);
      if(last&&start<=last[1]) last[1]=Math.max(last[1],end);
      else merged.push([start,end]);
    }
    for(const [start,end] of merged)
      roads.push({alongX:axis===0,cross,start,end,width:cross===0?9:7.4});
  }
  return {roads,circuits:selected.map(cell=>cell.bounds)};
}

// A local road that ends against a motorway (or any other line it cannot join)
// is a gap: cars drive up to the barrier and stop. Cut such roads back to the
// nearest local road they actually cross, repeating until nothing dangles.
export function pruneDeadEnds(roads, limit) {
  // A motorway only joins at its own end (an L-corner); never mid-length.
  const joins=(road,t)=>roads.some(r=>r!==road&&r.alongX!==road.alongX&&r.cross===t&&
    (r.highway?road.cross===r.start||road.cross===r.end:road.cross>=r.start&&road.cross<=r.end));
  for(let changed=true;changed;){
    changed=false;
    for(const road of [...roads]){
      if(road.highway)continue;
      for(const side of ['start','end']){
        const t=road[side];
        if(Math.abs(t)>=limit||joins(road,t))continue;
        const inward=roads.filter(r=>!r.highway&&r.alongX!==road.alongX&&
          road.cross>=r.start&&road.cross<=r.end&&r.cross>road.start&&r.cross<road.end)
          .map(r=>r.cross).sort((a,b)=>side==='start'?a-b:b-a);
        if(inward.length)road[side]=inward[0]; else roads.splice(roads.indexOf(road),1);
        changed=true;
        break;
      }
    }
  }
  return roads;
}

function makeCircle(u,v,size=18) {
  const width=7.2, cut=size+18;
  const at=(angle,r=size)=>[u+Math.cos(angle)*r,v+Math.sin(angle)*r];
  const ring=Array.from({length:97},(_,i)=>at(-i*tau/96));
  ring[96]=ring[0];
  const arms=Array.from({length:4},(_,i)=>{
    const angle=i*Math.PI/2, outer=at(angle,cut+3);
    function ramp(sign){
      const θ=angle+sign*.52,k=at(θ), middle=at(angle,cut-13);
      const handle=[k[0]-sign*Math.sin(θ)*9,k[1]+sign*Math.cos(θ)*9];
      return cubic(outer,middle,handle,k,15);
    }
    return {inbound:ramp(1),outbound:ramp(-1).reverse(),angle};
  });
  const streets=[{points:ring,width,surface:7,roundabout:true}];
  for(const arm of arms) for(const points of [arm.inbound,arm.outbound])
    streets.push({points,width:5,surface:7,roundabout:true});
  return {u,v,size,cut,at,arms,streets};
}

export function buildJunctions(roads,towns,level,rng) {
  const circles=[];
  const rows=roads.filter(road=>road.alongX&&!road.highway);
  const columns=roads.filter(road=>!road.alongX&&!road.highway);
  const hasRoom=(road,at)=>at-road.start>=54&&road.end-at>=54;
  for(const town of towns){
    if(!town.scale && circles.length)continue;
    const candidates=[];
    for(const row of rows)for(const column of columns){
      const u=column.cross,v=row.cross;
      const distance=Math.hypot(u-town.u,v-town.v);
      if(distance>town.radius||!hasRoom(row,u)||!hasRoom(column,v))continue;
      if(roads.some(road=>road.highway&&Math.abs((road.alongX?v:u)-road.cross)<65))continue;
      if(circles.some(circle=>Math.hypot(u-circle.u,v-circle.v)<105))continue;
      candidates.push({u,v,distance});
    }
    candidates.sort((a,b)=>a.distance-b.distance);
    const choice=candidates[Math.floor(rng()*Math.min(4,candidates.length))];
    if(!choice)continue;
    circles.push(makeCircle(choice.u,choice.v,16+Math.floor(rng()*10)));
    if(circles.length===3)break;
  }
  const exits=[],links=[],overpasses=[];
  for(const motorway of roads.filter(road=>road.highway)){
    const crossings=roads.filter(road=>road.alongX!==motorway.alongX&&!road.highway&&
      road.cross>motorway.start+30 && road.cross<motorway.end-30 &&
      motorway.cross>road.start+35 && motorway.cross<road.end-35);
    for(const road of crossings){
      const center=motorway.cross;
      const bridge={road,motorway,center,halfSpan:motorway.width*.5+4,
        start:Math.max(road.start,center-142),end:Math.min(road.end,center+142)};
      (road.overpasses??=[]).push(bridge);
      overpasses.push(bridge);
    }
    const toGrid=(along,across)=>motorway.alongX?[along,across]:[across,along];
    const candidates=crossings.filter(road=>road.cross>motorway.start+185 &&
      road.cross<motorway.end-185 && motorway.cross>road.start+88 && motorway.cross<road.end-88);
    const design=candidates.map(road=>{
      const center=level(...toGrid(road.cross,motorway.cross));
      const legs=[-1,1].flatMap(sign=>[-1,1].map(side=>{
        const turn=sign>0?72:85;
        const end=level(...toGrid(road.cross,motorway.cross+side*turn));
        const deck=end+Math.max(0,center+6.75-end)*.5;
        const room=(sign>0?motorway.end-road.cross:road.cross-motorway.start)-94;
        const lengths=[Math.min(176,room),176,215,255,295,335,380,425];
        const choices=lengths.filter(length=>length<=room).map(length=>{
          const start=level(...toGrid(road.cross+sign*length,motorway.cross));
          return {length,cost:Math.abs(deck-start)/Math.hypot(length,turn)+Math.abs(length-176)*.00008};
        });
        const best=choices.reduce((a,b)=>a.cost<=b.cost?a:b);
        return {...best,sign,side,turn};
      }));
      return {road,legs,grade:Math.max(...legs.map(leg=>leg.cost))};
    }).sort((a,b)=>a.grade-b.grade)[0];
    const sideRoad=design?.road;
    if(!sideRoad)continue;
    const interchange={name:motorway.name,u:motorway.alongX?sideRoad.cross:motorway.cross,
      v:motorway.alongX?motorway.cross:sideRoad.cross,streets:[],road:sideRoad,motorway};
    for(const {sign,side:direction,turn,length} of design.legs){
      const at=(along,across)=>motorway.alongX?[interchange.u+along,interchange.v+across]:
        [interchange.u+across,interchange.v+along];
      const merge=motorway.width*.5-motorway.outerShoulder-motorway.laneWidth*.5;
      const points=cubic(at(sign*length,direction*merge),at(sign*length*.57,direction*merge),
        at(sign*length*.24,direction*turn),at(0,direction*turn),Math.ceil(length/2.45));
      const offRamp=direction===sign*(motorway.alongX?-1:1);
      interchange.streets.push({points,width:5.5,surface:7,exit:true,offRamp});
    }
    exits.push(interchange);
  }
  for(const road of roads){
    for(const terminal of [road.start,road.end]){
      const connection=roads.find(r=>r.alongX!==road.alongX&&!r.highway&&r.cross===terminal&&
        road.cross>=r.start&&road.cross<=r.end);
      const u=road.alongX?terminal:road.cross,v=road.alongX?road.cross:terminal;
      if(!connection||circles.some(circle=>Math.hypot(u-circle.u,v-circle.v)<64)||
        !road.highway&&towns.some(town=>Math.hypot(u-town.u,v-town.v)<town.radius+40))continue;
      const inSign=terminal===road.start?1:-1;
      const outSign=connection.end-road.cross>road.cross-connection.start?1:-1;
      const at=(a,b)=>road.alongX?[u+a,v+b]:[u+b,v+a];
      const reach=Math.min(road.highway?82:52,(road.end-road.start)*.24,
        (outSign>0?connection.end-road.cross:road.cross-connection.start)*.85);
      if(reach<23)continue;
      const handle=reach*(1-.55228475);
      const points=cubic(at(inSign*reach,0),at(inSign*handle,0),
        at(0,outSign*handle),at(0,outSign*reach),Math.ceil(reach/1.5));
      links.push({points,width:road.highway?8.4:6.8,surface:7,connector:true});
    }
  }
  for(const row of rows) for(const column of columns){
    const u=column.cross,v=row.cross;
    if(u<row.start||u>row.end||v<column.start||v>column.end||
      circles.some(circle=>circle.u===u&&circle.v===v)) continue;
    for(const sx of [-1,1]) for(const sz of [-1,1]){
      const radius=11;
      if(u+sx*radius<row.start||u+sx*radius>row.end||
        v+sz*radius<column.start||v+sz*radius>column.end) continue;
      const points=Array.from({length:17},(_,i)=>{
        const angle=i*Math.PI/32;
        return [u+sx*radius*(1-Math.sin(angle)),v+sz*radius*(1-Math.cos(angle))];
      });
      links.push({points,width:Math.min(row.width,column.width),surface:7,connector:true});
    }
  }
  for(const road of roads){
    const splits=circles.filter(circle=>(road.alongX?circle.v:circle.u)===road.cross)
      .map(circle=>[(road.alongX?circle.u:circle.v)-circle.cut,(road.alongX?circle.u:circle.v)+circle.cut]);
    if(!road.highway)for(const motorway of roads.filter(item=>item.highway&&item.alongX!==road.alongX)){
      if(road.cross<=motorway.start+30||road.cross>=motorway.end-30||
        motorway.cross<road.start||motorway.cross>road.end||
        road.overpasses?.some(bridge=>bridge.motorway===motorway)) continue;
      const cut=motorway.width*.5+8;
      splits.push([motorway.cross-cut,motorway.cross+cut]);
    }
    splits.sort((a,b)=>a[0]-b[0]);
    let start=road.start;
    road.spans=[];
    for(const [a,b] of splits){
      if(b<start||a>road.end)continue;
      if(start<a)road.spans.push([start,a]);
      start=Math.max(start,b);
    }
    if(start<road.end)road.spans.push([start,road.end]);
  }
  return {roundabouts:circles,exits,links,overpasses};
}

export function routeAroundJunctions(world,knots) {
  let result=knots;
  for(const circle of world.roundabouts){
    const limit=circle.cut+7;
    const grid=result.map(p=>world.grid(...p));
    const inside=p=>Math.hypot(p[0]-circle.u,p[1]-circle.v)<limit;
    const start=grid.findIndex(p=>!inside(p));
    if(start<0||!grid.some(inside))continue;
    const ordered=[...grid.slice(start),...grid.slice(0,start)];
    const rerouted=[];
    const indexFor=([x,z])=>(Math.round(Math.atan2(z-circle.v,x-circle.u)/(Math.PI/2))+4)%4;
    for(let i=0;i<ordered.length;i++){
      if(!inside(ordered[i])){rerouted.push(ordered[i]);continue;}
      const first=i;
      while(i+1<ordered.length&&inside(ordered[i+1]))i++;
      const a=circle.arms[indexFor(ordered[first-1])],b=circle.arms[indexFor(ordered[(i+1)%ordered.length])];
      if(a===b)continue;
      const startAngle=a.angle+.52, endAngle=b.angle-.52;
      const sweep=(startAngle-endAngle+tau)%tau;
      const count=Math.max(4,Math.ceil(sweep*circle.size/1.7));
      rerouted.push(...a.inbound,...Array.from({length:count-1},(_,j)=>circle.at(startAngle-sweep*(j+1)/count)),...b.outbound);
    }
    result=rerouted.map(p=>world.point(...p));
  }
  return result;
}

export function corridor(points,width,kind) {
  const length=[0];
  for(let i=1;i<points.length;i++)length.push(length.at(-1)+Math.hypot(points[i][0]-points[i-1][0],points[i][1]-points[i-1][1]));
  return {points,width,kind,length,total:length.at(-1)};
}

export function mountainNetwork(summits,roads,point,height,riverEdge) {
  if(!summits.length)return [];
  const usable=summits.filter(m=>riverEdge(m.x,m.z)>160);
  const mountain=[...usable,...summits].find(m=>height(m.x,m.z)-height(...point(m.u-m.su,m.v))>45);
  if(!mountain)return [];
  const {u,v,su,sv}=mountain;
  const rim=roads.filter(r=>!r.alongX&&!r.highway&&v>r.start+35&&v<r.end-35)
    .sort((a,b)=>Math.abs(a.cross-u)-Math.abs(b.cross-u))[0];
  if(!rim)return [];
  const side=Math.sign(rim.cross-u), theta=side>0?0:Math.PI;
  const top=height(mountain.x,mountain.z)+.24;
  const start=point(rim.cross,v-side*36);
  const startHeight=height(...start);
  const spiral=[];
  const revolutions=clamp(Math.ceil((top-startHeight)/(Math.min(su,sv)*.58)),2,4);
  const count=revolutions*190;
  for(let i=0;i<=count;i++){
    const f=i/count,angle=theta+f*Math.PI*2*revolutions;
    const radius=.94-.79*f;
    spiral.push(point(u+Math.cos(angle)*su*radius,v+Math.sin(angle)*sv*radius));
  }
  const first=spiral[0], next=spiral[3];
  const tangent=[next[0]-first[0],next[1]-first[1]];
  const tangentLength=Math.hypot(...tangent)||1;
  const approach=cubic(start,point(rim.cross,v-side*15),first.map((value,i)=>value-17*tangent[i]/tangentLength),first,20);
  const end=spiral.at(-1), penultimate=spiral.at(-5), center=point(u,v);
  const finalControl=end.map((value,i)=>value+.94*(value-penultimate[i]));
  const turnout=cubic(end,finalControl,center.map((value,i)=>lerp(value,end[i],.22)),center,19);
  const summit=corridor([...approach.slice(0,-1),...spiral,...turnout.slice(1)],6.1,'summit');
  summit.elevations=summit.length.map(distance=>lerp(startHeight,top,smooth(distance/summit.total)));

  const second=usable.find(m=>m!==mountain&&height(m.x,m.z)>90)||mountain;
  const {u:tu,v:tv,su:tw}=second;
  const connects=roads.filter(road=>!road.alongX&&tv>road.start+18&&tv<road.end-18);
  const west=connects.filter(road=>road.cross<tu-tw*.87).sort((a,b)=>b.cross-a.cross)[0];
  const east=connects.filter(road=>road.cross>tu+tw*.87).sort((a,b)=>a.cross-b.cross)[0];
  const a=point(west?.cross??tu-tw*1.18,tv),b=point(east?.cross??tu+tw*1.18,tv);
  const tunnel=corridor(Array.from({length:125},(_,i)=>[lerp(a[0],b[0],i/124),lerp(a[1],b[1],i/124)]),7.8,'tunnel');
  const low=height(...a),high=height(...b);
  tunnel.elevations=tunnel.length.map(distance=>lerp(low,high,distance/tunnel.total));
  const covered=tunnel.points.map((p,i)=>height(...p)>tunnel.elevations[i]+6.3);
  tunnel.portalStart=covered.indexOf(true);
  tunnel.portalEnd=covered.lastIndexOf(true);
  if(tunnel.portalStart<3||tunnel.portalEnd>tunnel.points.length-4||
    tunnel.portalEnd-tunnel.portalStart<12)return [summit];
  return [summit,tunnel];
}

export function engineeredIndex(paths) {
  const cellSize=32,index=new Map();
  for(const path of paths)for(let i=1;i<path.points.length;i++){
    const a=path.points[i-1],b=path.points[i],dx=b[0]-a[0],dz=b[1]-a[1];
    const l2=dx*dx+dz*dz;
    if(l2<.00001)continue;
    const margin=path.kind==='ramp'?32:path.kind==='summit'?24:11;
    const segment={path,i,a,dx,dz,l2};
    for(let x=Math.floor((Math.min(a[0],b[0])-margin)/cellSize);x<=Math.floor((Math.max(a[0],b[0])+margin)/cellSize);x++)
      for(let z=Math.floor((Math.min(a[1],b[1])-margin)/cellSize);z<=Math.floor((Math.max(a[1],b[1])+margin)/cellSize);z++){
        const key=x+':'+z;
        if(!index.has(key))index.set(key,[]);
        index.get(key).push(segment);
      }
  }
  return (x,z,kind)=>{
    let candidate=null,best=Infinity;
    for(const s of index.get(Math.floor(x/cellSize)+':'+Math.floor(z/cellSize))||[]){
      if(kind&&s.path.kind!==kind)continue;
      const f=clamp(((x-s.a[0])*s.dx+(z-s.a[1])*s.dz)/s.l2,0,1);
      const d=Math.hypot(x-s.a[0]-s.dx*f,z-s.a[1]-s.dz*f);
      if(d>=best)continue;
      best=d;
      const y=lerp(s.path.elevations[s.i-1],s.path.elevations[s.i],f);
      const covered=s.path.kind==='tunnel'&&s.i>=s.path.portalStart&&s.i<=s.path.portalEnd;
      candidate={y,edge:d-s.path.width*.5,covered,path:s.path,segment:s.i};
    }
    return candidate;
  };
}

export function cutForScenicRoad(height,hit) {
  if(!hit||hit.edge>=19)return height;
  return lerp(hit.y,height,smooth((hit.edge-.45)/18));
}
