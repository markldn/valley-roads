import { cubic } from '../world/network.js';
import { cityTraffic } from './city-traffic.js';
import { assignRoles } from '../world/towns.js';

function stations(a,b,step) {
  const count=Math.max(1,Math.ceil(Math.abs(b-a)/step));
  return Array.from({length:count+1},(_,i)=>i===count?b:a+(b-a)*i/count);
}

const axis=road=>road.alongX?0:1;
const gridPoint=(road,along,across)=>road.alongX?[along,across]:[across,along];
const right=road=>road.alongX?1:-1;

export function regionalTraffic(world) {
  assignRoles(world);
  const nodes=[], edges=[], byRoad=new Map(), links=[];
  function add(from,to,knots,road=null,ramp=null) {
    const points=knots.map(p=>world.point(...p)), distance=[0];
    for(let i=1;i<points.length;i++)
      distance.push(distance.at(-1)+Math.hypot(points[i][0]-points[i-1][0],points[i][1]-points[i-1][1]));
    const length=distance.at(-1);
    const edge={from,to,knots:points,distance,length,road,ramp,direct:true,open:true,
      motorway:road?.highway?road:null, cost:length/(road?.highway?30.5:ramp?14:20)};
    from.edges.push(edge);
    edges.push(edge);
    return edge;
  }
  function lane(road,along,sign) {
    const local=1.75, width=world.motorwayWidth(road,along);
    const t=road.highway?Math.min(1,Math.max(0,(width-9)/(road.width-9))):0;
    const outer=road.highway?road.width*.5-road.outerShoulder-road.laneWidth*.5:local;
    return gridPoint(road,along,road.cross+right(road)*sign*(local+(outer-local)*t*t*(3-2*t)));
  }
  for(const road of world.roads) byRoad.set(road,{
    spans:road.spans.map(([start,end])=>({start,end,cuts:[],directions:new Map()}))
  });
  function cut(road,station,inset,atStart=station,atEnd=station) {
    const entry=byRoad.get(road);
    const arm=[];
    for(const sign of [-1,1]){
      const sample=sign<0?atStart:atEnd;
      const span=entry.spans.find(({start,end})=>sample>=start&&sample<=end);
      if(!span)continue;
      const along=sample+sign*inset;
      if(sign<0?along<=span.start:along>=span.end)continue;
      span.cuts.push({along,break:sign<0?'after':'before'});
      arm.push({road,along,sign});
    }
    return arm;
  }
  const rows=world.roads.filter(road=>road.alongX), columns=world.roads.filter(road=>!road.alongX);
  for(const row of rows)for(const column of columns){
    const u=column.cross,v=row.cross;
    if(u<row.start||u>row.end||v<column.start||v>column.end)continue;
    const circle=world.roundabouts.find(circle=>circle.u===u&&circle.v===v);
    if((row.highway||column.highway)&&
      !(row.highway?(u===row.start||u===row.end):(v===column.start||v===column.end)))continue;
    const arms=circle?[
      ...cut(row,u,3,u-circle.cut,u+circle.cut),...cut(column,v,3,v-circle.cut,v+circle.cut)
    ]:[...cut(row,u,10),...cut(column,v,10)];
    if(arms.length<2)continue;
    links.push({arms,circle});
  }
  function mark(road,along) {
    byRoad.get(road).spans.find(({start,end})=>along>=start&&along<=end)?.cuts.push({along});
  }
  const ramps=[];
  for(const exit of world.exits)for(const street of exit.streets){
    const road=exit.motorway, local=exit.road, points=street.points;
    const merge=points[0][axis(road)], end=points.at(-1);
    const sign=Math.sign(end[axis(road)]-merge);
    const motorwaySign=street.offRamp?sign:-sign;
    const span=byRoad.get(local).spans.find(({start,end:finish})=>end[axis(local)]>=start&&end[axis(local)]<=finish);
    if(!span)continue;
    mark(road,merge);
    for(const localSign of [-1,1]){
      const stop=end[axis(local)]+localSign*(street.offRamp?10:-10);
      if(stop<=span.start||stop>=span.end)continue;
      mark(local,stop);
      ramps.push({road,local,points,street,merge,motorwaySign,localSign,stop});
    }
  }
  const connectCity=cityTraffic(world,(road,station,p)=>{
    if(world.highwayAt(...p,12))return null;
    const span=byRoad.get(road).spans.find(s=>station>s.start+12&&station<s.end-12);
    if(!span||span.cuts.some(c=>Math.abs(c.along-station)<17))return null;
    if(links.some(link=>link.arms.some(a=>a.road===road&&Math.abs(a.along-station)<22)))return null;
    return cut(road,station,6);
  });
  function makeNode(p) {
    const node={p,edges:[]};
    nodes.push(node);
    return node;
  }
  for(const [road,{spans}] of byRoad)for(const span of spans){
    const {start,end,cuts}=span;
    const cutsAt=new Map();
    for(const cut of cuts){
      if(!cutsAt.has(cut.along))cutsAt.set(cut.along,new Set());
      cutsAt.get(cut.along).add(cut.break);
    }
    const ordered=[...new Set([start,end,...cutsAt.keys()])].sort((a,b)=>a-b);
    for(const sign of [-1,1]){
      const direction=new Map();
      span.directions.set(sign,direction);
      for(const along of ordered){
        const node=makeNode(lane(road,along,sign));
        direction.set(along,node);
      }
      for(let i=1;i<ordered.length;i++){
        const a=ordered[i-1],b=ordered[i];
        if(cutsAt.get(a)?.has('after')||cutsAt.get(b)?.has('before'))continue;
        const [from,to]=sign>0?[a,b]:[b,a];
        add(direction.get(from),direction.get(to),stations(from,to,4).map(s=>lane(road,s,sign)),road);
      }
    }
  }
  function node(road,along,sign) {
    return byRoad.get(road).spans.find(span=>span.directions.get(sign).has(along))
      ?.directions.get(sign).get(along);
  }
  for(const {arms,circle} of links)for(const a of arms)for(const b of arms){
    if(a===b)continue;
    const from=node(a.road,a.along,-a.sign), to=node(b.road,b.along,b.sign);
    if(circle){
      const armIndex=arm=>arm.road.alongX?(arm.sign>0?0:2):(arm.sign>0?1:3);
      const entry=circle.arms[armIndex(a)], leave=circle.arms[armIndex(b)];
      const start=entry.angle+.52, end=leave.angle-.52;
      const sweep=(start-end+2*Math.PI)%(2*Math.PI), steps=Math.ceil(sweep*circle.size/1.7);
      const arc=Array.from({length:steps-1},(_,i)=>circle.at(start-sweep*(i+1)/steps));
      add(from,to,[from.p,...entry.inbound.slice(1),...arc,...leave.outbound.slice(0,-1),to.p]).turn=true;
    }else{
      const control=(port,arm)=>port.p.map((value,i)=>value-(i===axis(arm.road)?arm.sign*5.5:0));
      // Both control points face the junction. This also preserves straight-through lanes.
      const edge=add(from,to,cubic(from.p,control(from,a),control(to,b),to.p,12));
      edge.turn=a.road!==b.road;
      edge.motorwayLink=Boolean(a.road.highway||b.road.highway);
    }
  }
  for(const {road,local,points,street,merge,motorwaySign,localSign,stop} of ramps){
    const main=node(road,merge,motorwaySign), side=node(local,stop,localSign);
    const end=points.at(-1), before=points.at(-5), tangent=[...side.p];
    tangent[axis(local)]-=localSign*(street.offRamp?5.5:-5.5);
    const path=[main.p,...points.slice(1,-5),...cubic(before,end,tangent,side.p,12)];
    if(street.offRamp)add(main,side,path,local,street.ramp);
    else {
      const entry=add(side,main,path.reverse(),local,street.ramp);
      entry.merging=road;
    }
  }

  connectCity(add,makeNode,arm=>({
    in:node(arm.road,arm.along,-arm.sign),out:node(arm.road,arm.along,arm.sign),
    arrival:gridPoint(arm.road,-arm.sign,0),departure:gridPoint(arm.road,arm.sign,0)
  }));

  // Remove dead ends. An ambient trip must always have a legal continuation.
  let changed=true;
  while(changed){
    changed=false;
    for(const n of nodes){
      const available=n.edges.filter(edge=>edge.to.edges.length);
      if(available.length!==n.edges.length){n.edges=available;changed=true;}
    }
  }
  // Keep street trips connected to the regional lanes in both directions.
  const core=new Set(), incoming=new Map();
  for(const n of nodes)for(const edge of n.edges){
    if(!incoming.has(edge.to))incoming.set(edge.to,[]);
    incoming.get(edge.to).push(edge.from);
    if(edge.road&&!edge.ramp){core.add(n);core.add(edge.to);}
  }
  function reachable(neighbors) {
    const seen=new Set(core), queue=[...core];
    for(const n of queue)for(const next of neighbors(n)){
      if(seen.has(next))continue;
      seen.add(next);
      queue.push(next);
    }
    return seen;
  }
  const fromCore=reachable(n=>n.edges.map(edge=>edge.to));
  const toCore=reachable(n=>incoming.get(n)??[]);
  for(const n of nodes)
    n.edges=n.edges.filter(edge=>!edge.street||fromCore.has(n)&&toCore.has(edge.to));

  const starts=edges.filter(edge=>edge.length>50&&edge.from.edges.includes(edge));
  const streetStarts=edges.filter(edge=>edge.street?.town&&edge.length>12&&edge.from.edges.includes(edge));
  const townEdges=starts.filter(edge=>!edge.motorway&&edge.road);
  const destinations=world.towns.map(town=>{
    const nearest=townEdges.map(edge=>{
      const targets=[edge.from,edge.to].map(n=>({node:n,distance:Math.hypot(n.p[0]-town.u,n.p[1]-town.v)}));
      return targets[0].distance<targets[1].distance?targets[0]:targets[1];
    }).sort((a,b)=>a.distance-b.distance).slice(0,4);
    const inner=streetStarts.filter(edge=>edge.street.town===town);
    const stops=inner.filter((_,i)=>i%Math.max(1,Math.floor(inner.length/8))===0).slice(0,8);
    return {name:town.name,town,nodes:[...new Set([...stops.map(e=>e.to),
      ...nearest.filter(n=>n.distance<town.radius+90).map(n=>n.node)])]};
  }).filter(goal=>goal.nodes.length);
  const farmEdges=new Map(nodes.map(n=>[n,n.edges.filter(e=>!e.motorway&&!e.ramp&&!e.motorwayLink)]));
  do {
    changed=false;
    for(const [n,edges] of farmEdges){
      const valid=edges.filter(edge=>farmEdges.get(edge.to).length);
      if(valid.length!==edges.length){farmEdges.set(n,valid);changed=true;}
    }
  } while(changed);
  const farmStarts=starts.filter(edge=>edge.road&&farmEdges.get(edge.from).includes(edge));
  const cache=new Map(), farmCache=new Map();
  function search(from,farm) {
    const costs=new Map([[from,0]]), previous=new Map(), pending=new Set([from]);
    while(pending.size){
      let next=null;
      for(const n of pending)if(!next||costs.get(n)<costs.get(next))next=n;
      pending.delete(next);
      for(const edge of farm?farmEdges.get(next):next.edges){
        const cost=costs.get(next)+edge.cost;
        if(cost>=(costs.get(edge.to)??Infinity))continue;
        costs.set(edge.to,cost);
        previous.set(edge.to,edge);
        pending.add(edge.to);
      }
    }
    return {costs,previous};
  }
  const routeCache=new Map();
  // Cheapest legal path between two settlements: {path,cost,length}, or null.
  // farm:true restricts to surface roads (tractors).
  function route(origin,destination,farm=false) {
    const key=origin.id+'>'+destination.id+(farm?'f':'');
    if(routeCache.has(key))return routeCache.get(key);
    const goals=destinations.find(goal=>goal.town===destination)?.nodes??[];
    const starts=destinations.find(goal=>goal.town===origin)?.nodes??[];
    let best=null;
    for(const from of starts){
      const {costs,previous}=search(from,farm);
      for(const target of goals){
        if(!previous.has(target)||best&&costs.get(target)>=best.cost)continue;
        const path=[];
        for(let n=target;n!==from;){const edge=previous.get(n);path.push(edge);n=edge.from;}
        best={path:path.reverse(),cost:costs.get(target)};
      }
    }
    if(best)best.length=best.path.reduce((sum,edge)=>sum+edge.length,0);
    routeCache.set(key,best?.path.length?best:null);
    return routeCache.get(key);
  }
  // Cheapest path from the node a vehicle is already heading for, so a trip starts where it stands.
  const nodeSearches=new Map();
  function routeFrom(node,destination) {
    if(!nodeSearches.has(node))nodeSearches.set(node,search(node,false));
    const {costs,previous}=nodeSearches.get(node);
    const goals=destinations.find(goal=>goal.town===destination)?.nodes??[];
    const target=goals.filter(n=>previous.has(n)).sort((a,b)=>costs.get(a)-costs.get(b))[0];
    if(!target)return null;
    const path=[];
    for(let n=target;n!==node;){const edge=previous.get(n);path.push(edge);n=edge.from;}
    return {path:path.reverse()};
  }
  function trip(from,rng,currentName,farm=false) {
    const plans=farm?farmCache:cache;
    let options=plans.get(from);
    if(!options){
      const {costs,previous}=search(from,farm);
      options=[];
      for(const goal of destinations){
        const reachable=goal.nodes.filter(n=>previous.has(n)).sort((a,b)=>costs.get(a)-costs.get(b));
        for(const target of reachable.slice(0,4)){
          const path=[];
          for(let n=target;n!==from;){
            const edge=previous.get(n);
            path.push(edge);
            n=edge.from;
          }
          options.push({name:goal.name,path:path.reverse()});
        }
      }
      plans.set(from,options);
    }
    const alternatives=options.filter(goal=>goal.name!==currentName);
    const choices=alternatives.length?alternatives:options;
    const onward=farm?farmEdges.get(from):from.edges;
    return choices[Math.floor(rng()*choices.length)]??{
      name:'Regional road',path:[onward[Math.floor(rng()*onward.length)]]
    };
  }
  return {edges,starts:starts.filter(e=>!e.street),streetStarts,farmStarts,trip,route,routeFrom};
}
