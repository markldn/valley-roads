import {routeAroundJunctions} from '../world/network.js';
import {regionalTraffic} from './traffic-routes.js';
import {planDemand,launchLeg,locationAt} from '../world/towns.js';
import {passingLane} from './motorway-traffic.js';
import { pedestrianPose } from '../people/pedestrian.js';
import * as T from '../vendor/three.module.js';
import { HUMAN_PARS, HUMAN_VERT, humanGeometry } from '../drive/render/human.js';
import { LIMIT, OUTER_SPACING, random, cellSeed } from '../world/world.js';
import { buildCar, syncCar } from '../drive/car/model.js';
import { makeVehicle } from '../drive/physics/vehicle.js';
import { Obstacles } from '../drive/physics/collide.js';
import { applyDamage, repair, updateDamage } from '../drive/car/damage.js';
import { PHYSICS_STEP } from '../player/driving.js';
import { ALL_CARS } from '../drive/physics/cars_extra.js';
import { mergeGeometries } from '../vendor/jsm/utils/BufferGeometryUtils.js';
import { createTruckFactory } from './trucks.js';
import { trackLimit } from './speed-limits.js';
import { createTrafficLights } from './traffic-lights.js';

const FLEET = [
  { key: 'mirage', speed: 16 },
  { key: 'golf7', speed: 18 },
  { key: 'cclass', speed: 19 },
  { key: 'outlander', speed: 17 },
  { key: 'transit_l2', speed: 14 },
];

function route(world, bounds, reverse) {
  const [u, v, U, V] = bounds;
  const corners = [[u,v], [U,v], [U,V], [u,V]];
  if (reverse) corners.reverse();
  const knots = [];
  corners.forEach(([x,z], i) => {
    const before = corners[(i+3)%4];
    const after = corners[(i+1)%4];
    const plane = (point, distance) => [x + Math.sign(point[0]-x)*distance, z + Math.sign(point[1]-z)*distance];
    const highway=world.highwayAt(x,z,4);
    const curve=Math.min(Math.hypot(before[0]-x,before[1]-z)*.14,Math.hypot(after[0]-x,after[1]-z)*.14,
      highway?19:7.7);
    const a = plane(before, curve), b = plane(after, curve);
    for (let j=0; j<5; j++) {
      const f = j/4, r = 1-f;
      knots.push(world.point(r*r*a[0]+2*r*f*x+f*f*b[0], r*r*a[1]+2*r*f*z+f*f*b[1]));
    }
    const end = after.map((coordinate, axis) => coordinate + Math.sign(b[axis]-coordinate)*curve);
    const subdivisions = Math.ceil(Math.hypot(end[0]-b[0], end[1]-b[1])/4);
    for (let j=1; j<subdivisions; j++) {
      const f = j/subdivisions;
      knots.push(world.point(T.MathUtils.lerp(b[0],end[0],f), T.MathUtils.lerp(b[1],end[1],f)));
    }
  });
  return trackFromKnots(knots,world);
}

function trackFromKnots(knots,world) {
  if(world)knots=routeAroundJunctions(world,knots);
  const distance = [0];
  for (let i=0; i<knots.length; i++) {
    const [x,z] = knots[i], [px,pz] = knots[(i+1)%knots.length];
    distance.push(distance[i] + Math.hypot(px-x,pz-z));
  }
  const goals = [];
  if (world) for (const town of world.towns) {
    const [tx,tz] = world.point(town.u,town.v);
    let best = Infinity, station = 0;
    for (let i=0;i<knots.length;i+=3) {
      const separation = Math.hypot(knots[i][0]-tx,knots[i][1]-tz);
      if(separation<best){best=separation;station=distance[i];}
    }
    if(best<town.radius+35) goals.push({station,name:town.name});
  }
  if(goals.length<2) for(const fraction of [.18,.63]){
    const index=Math.min(knots.length-1,Math.floor(knots.length*fraction));
    goals.push({station:distance[index],name:'Regional road',point:knots[index]});
  }
  goals.sort((a,b)=>a.station-b.station);
  return { knots, distance, length: distance.at(-1), goals };
}

function sample(track, d) {
  const along = track.open?T.MathUtils.clamp(d,0,track.length):(d + track.length) % track.length;
  let left = 0, right = track.distance.length-1;
  while (right - left > 1) {
    const center = (left + right) >> 1;
    if (track.distance[center] > along) right = center;
    else left = center;
  }
  const [x,z] = track.knots[left], [px,pz] = track.knots[right % track.knots.length];
  const span = track.distance[right] - track.distance[left];
  const f = (along - track.distance[left]) / span;
  return [T.MathUtils.lerp(x,px,f), T.MathUtils.lerp(z,pz,f)];
}

function trackDirection(track,distance) {
  const station=track.open?Math.min(distance,Math.max(0,track.length-1.8)):distance;
  const [x,z]=sample(track,station), [px,pz]=sample(track,station+1.8);
  const span=Math.hypot(px-x,pz-z)||1;
  return [(px-x)/span,(pz-z)/span];
}

// A point on the road the given distance behind a truck's front bumper.
function trailPoint(car,back,x,z) {
  let px=x,pz=z,left=back;
  for(const [qx,qz] of car.trail){
    const span=Math.hypot(qx-px,qz-pz);
    if(span>=left&&span>0){const f=left/span;return [px+(qx-px)*f,pz+(qz-pz)*f];}
    left-=span;px=qx;pz=qz;
  }
  return [px,pz];
}

function pose(car, ground) {
  if(car.dynamic) {
    const v=car.dynamic;
    return {...Obstacles.footprint(v),y:v.p[1],mass:v.spec.mass,vx:v.v[0],vz:v.v[2],dynamic:v};
  }
  const [x,z] = sample(car.track, car.distance);
  const [fx,fz]=trackDirection(car.track,car.distance);
  const motorway=car.track.motorway?ground.motorway(x,z):null;
  const aligned=motorway?Math.abs(motorway.road.alongX?fx:fz):0;
  const blend=T.MathUtils.smoothstep(aligned,.69,.93)*
    T.MathUtils.smoothstep(motorway?.endDistance??0,0,30);
  const lane=car.track.motorway?-(car.lane??0)*car.track.motorway.laneWidth:car.track.direct?0:1.85;
  const offset=car.hitchOffset||0;
  const verge=(car.shoulder||0)*(car.shoulderSign||0)*1.9;
  const cx=x-fz*lane+fx*offset+fz*verge, cz=z+fx*lane+fz*offset-fx*verge;
  const ramp=car.track.ramp?ground.rampLevel(cx,cz,car.track.ramp):null;
  const level=ramp??(car.track.motorway?ground.motorwayLevel(cx,cz):Infinity);
  if(car.truck){
    const [bx,bz]=trailPoint(car,car.spec.dims.len,cx,cz);
    const dx=cx-bx,dz=cz-bz,length=Math.hypot(dx,dz)||1,ux=dx/length,uz=dz/length;
    return {cx:(cx+bx)*.5,cz:(cz+bz)*.5,fx:ux,fz:uz,rx:uz,rz:-ux,hl:Math.max(length,6)*.5,hw:car.spec.dims.wid/2,
      y:ground.height(cx,cz,level),destination:car.destination?.name,mass:car.spec.mass,
      vx:ux*car.speed,vz:uz*car.speed,highway:blend>.70,speedLimit:motorway?.speedLimit??null,laneIntent:0,
      frontX:cx,frontZ:cz};
  }
  return { cx, cz, fx, fz, rx:fz, rz:-fx, hl:car.spec.dims.len/2, hw:car.spec.dims.wid/2,
    y:ground.height(cx,cz,level),
    destination:car.destination?.name, mass:car.spec.mass, vx:fx*car.speed, vz:fz*car.speed,
    highway:blend>.70,speedLimit:motorway?.speedLimit??null,
    laneIntent:(car.laneTarget??0)-(car.lane??0) };
}

function activateTrafficPhysics(spec, ground, box, hit) {
  const body=makeVehicle(spec,ground);
  const {cx,cz,fx,fz,rx,rz,y,vx,vz}=box;
  const front=spec.wheelbase*(1-spec.frontWeight)+spec.dims.overF;
  const offset=front-spec.dims.len*.5;
  const x=cx-fx*offset,z=cz-fz*offset;
  body.reset(x,z,Math.atan2(fx,-fz));
  const height=(x,z)=>ground.height(x,z,y+.18);
  const slope=(dx,dz)=>T.MathUtils.clamp((height(x+dx,z+dz)-height(x-dx,z-dz))*.5,-.22,.22);
  const grade=slope(fx,fz),crossfall=slope(rx,rz);
  const attitude=new T.Quaternion().setFromEuler(new T.Euler(-Math.atan(grade),0,Math.atan(crossfall),'XYZ'));
  body.q=new T.Quaternion().fromArray(body.q).multiply(attitude).toArray();
  body.p[1]=height(x,z)+spec.cg+.02;
  body.v=[vx,grade*(vx*fx+vz*fz)+crossfall*(vx*rx+vz*rz),vz];
  for(const wheel of body.wheels) wheel.omega=(vx*fx+vz*fz)/wheel.R;
  body.applyImpulse([hit.P[0],body.p[1],hit.P[2]],hit.J || hit.n.map(component=>component*hit.j));
  return body;
}

export function walkingMeshes(count) {
  const original = humanGeometry();
  const geometry = new T.InstancedBufferGeometry();
  for (const key of ['position','normal','aTag','aCol','aPart']) geometry.setAttribute(key, original.getAttribute(key));
  geometry.setIndex(original.index);
  geometry.instanceCount = 0;
  for (const [key,size] of [['aInst',4],['aLook',3],['aPose',2],['aVar',4]]) {
    geometry.setAttribute(key,new T.InstancedBufferAttribute(new Float32Array(count*size),size).setUsage(T.DynamicDrawUsage));
  }
  const time={ value:0 };
  const material = new T.MeshStandardMaterial({ roughness:.85 });
  material.onBeforeCompile = shader => {
    shader.uniforms.uTime = time;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uTime;
        ${HUMAN_PARS}`)
      .replace('#include <beginnormal_vertex>', `${HUMAN_VERT}
        vec3 tPos = vec3(aInst.x + lp.x, aPose.x + lp.y, aInst.y + lp.z);`)
      .replace('#include <begin_vertex>', 'vec3 transformed = tPos;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCol;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = pow(vCol, vec3(2.2));');
  };
  const mesh = new T.Mesh(geometry,material);
  mesh.frustumCulled=false;
  mesh.userData.renderCategory='people';
  return { mesh, time };
}

export function populate(world, ground, obstacles, buildTractor, buildings=[]) {
  const group = new T.Group();
  const rng = random(world.seed ^ 0xc841e);
  const cars=[];
  const roundaboutCenters=world.roundabouts.map(circle=>{
    const [x,z]=world.point(circle.u,circle.v);
    return {x,z,r:circle.size};
  });
  const onRoundabout=box=>roundaboutCenters.some(({x,z,r})=>{
    const dx=box.cx-x,dz=box.cz-z,distance=Math.hypot(dx,dz);
    return Math.abs(distance-r)<4.9 && Math.abs(dx*box.fx+dz*box.fz)<distance*.42;
  });
  const palette=[0xa44b36,0x535d65,0xb6bbb9,0x496971,0x8a826d];
  function spawn(track,urban,kind=null,source=rng) {
    const type=kind==='police'?{key:'cclass',speed:20}:kind==='ambulance'?{key:'transit_l2',speed:16}:
      FLEET[Math.floor(source()*FLEET.length)];
    const spec=ALL_CARS[type.key];
    const color=kind?0xe6e8e7:palette[Math.floor(source()*palette.length)];
    const plate=`HV-${String(171+cars.length*23).padStart(3,'0')}-${urban?'VM':'HR'}`;
    const car={track,spec,model:null,color,plate,urban,kind,beacon:null,angle:0,
      distance:track.length*(.07+source()*.85),speed:8,temper:.9+source()*.14,
      limit:type.speed*(.72+source()*.27),damage:0,stopped:0,cooldown:0,response:0};
    cars.push(car);
    return car;
  }
  function buildModel(car) {
    const {spec,color,plate,kind}=car;
    const model=buildCar(spec,{bodySections:40,color,plate});
    const {shape,wheels}=model.userData;
    wheels.forEach((wheel,index)=>{
      const front=index<2, side=index%2?1:-1;
      wheel.position.set(side*(front?spec.trackF:spec.trackR)/2,spec.wheel.radius-spec.cg,front?shape.a:-shape.b);
      wheel.scale.x=side;
    });
    if(kind){
      const material=new T.MeshStandardMaterial({
        color:kind==='police'?0x3366db:0x4f78f9,emissive:0x204ad8,emissiveIntensity:.05,
      });
      const beacon=new T.Mesh(new T.BoxGeometry(.94,.11,.25),material);
      beacon.position.set(0,spec.dims.hgt-spec.cg+.08,0);
      model.add(beacon);
      car.beacon=beacon;
    }
    group.add(model);
    car.model=model;
    return model;
  }

  function dropModel(car) {
    if(!car.model||car.truck) return;
    group.remove(car.model);
    const geometries=new Set(), materials=new Set();
    car.model.traverse(object=>{
      if(object.geometry)geometries.add(object.geometry);
      if(object.material)materials.add(object.material);
    });
    for(const geometry of geometries) geometry.dispose();
    for(const material of materials){material.map?.dispose();material.dispose();}
    car.model=null;car.beacon=null;
  }
  const network=regionalTraffic(world);
  function dispatch(car) {
    const trip=network.trip(car.track.to,rng,car.destination?.name,car.tractor);
    car.destination=trip;
    car.legs=trip.path;
    car.leg=0;
  }
  function spawnTrip(track,urban,kind=null) {
    const car=spawn(track,urban,kind);
    dispatch(car);
    return car;
  }
  for(const track of network.starts){
    const count=Math.round((Math.floor(track.length/(track.motorway?570:970))+
      (rng()<Math.min(.56,track.length/850)?1:0))*world.trafficScale);
    for(let i=0;i<count;i++){
      const car=spawnTrip(track,false);
      car.distance=track.length*(i+.2+rng()*.6)/count;
    }
  }
  const streets=network.streetStarts;
  const pick=tracks=>tracks[Math.floor(rng()*tracks.length)];
  for(const town of world.towns.filter(town=>town.scale)){
    const candidates=streets.filter(edge=>edge.street.town===town&&edge.length>18);
    const count=Math.round((town.radius/24)*(1+world.urbanDensity*.22)*Math.min(2.4,world.trafficScale));
    for(let i=0;i<count&&candidates.length;i++){
      const track=pick(candidates);
      spawnTrip(track,true);
      candidates.splice(candidates.indexOf(track),1);
    }
  }
  const service=network.starts.filter(track=>track.road&&!track.motorway);
  for(const kind of ['police','police','ambulance']){
    const track=pick(streets.length?streets:service);
    if(track)spawnTrip(track,Boolean(track.street),kind);
  }
  if(buildTractor&&network.farmStarts.length)for(let i=0,count=2+Math.floor(rng()*3);i<count;i++){
    const track=pick(network.farmStarts);
    const farm=buildTractor(Math.floor(rng()*24),true);
    group.add(farm.model);
    const limit=5.8+rng()*2.4;
    const spec={mass:6800,dims:{len:7.9,wid:2.52}};
    const car={...farm,track,spec,hitchOffset:-1.96,kind:'tractor',tractor:true,angle:0,
      distance:track.length*(.1+rng()*.8),speed:limit,limit,damage:0,stopped:0,cooldown:0,response:0};
    cars.push(car);
    dispatch(car);
  }
  // Freight: every lorry drives its own chain of deliveries between towns.
  const truckFactory=createTruckFactory();
  const freight=network.starts.filter(edge=>edge.road&&edge.length>110);
  const trunk=freight.filter(edge=>edge.motorway);
  for(let i=0,count=Math.min(40,Math.round((6+freight.length/26)*world.trafficScale));i<count&&freight.length;i++){
    const lanes=trunk.length&&rng()<.55?trunk:freight, track=lanes[Math.floor(rng()*lanes.length)];
    const roll=rng(), build=truckFactory.build(roll<.56?'semi':roll<.76?'tanker':'rigid',rng);
    build.model.visible=false;
    group.add(build.model);
    const car={...build,track,truck:true,kind:'truck',color:0xd9dad6,trail:[],angle:0,temper:1,
      distance:track.length*(.1+rng()*.8),speed:15,limit:25,damage:0,stopped:0,cooldown:0,response:0};
    const [x,z]=sample(track,car.distance),[dx,dz]=trackDirection(track,car.distance);
    for(let back=1;back<=24;back++)car.trail.push([x-dx*back,z-dz*back]);
    cars.push(car);
    dispatch(car);
  }
  // Scheduled demand: delivery vans, commuters and resort visitors. They stay parked at the
  // roadside in town and drive a planned route when their departure window opens.
  const scheduled=[];
  const plans=planDemand(world,network);
  for(const plan of plans){
    const home=network.route(plan.home,plan.work);
    if(!home)continue;
    const car=spawn(home.path[0],false);
    if(plan.vehicle==='van'){
      car.spec=ALL_CARS.transit_l2;car.color=0xe9ebe6;car.limit=14*(.72+rng()*.27);
    }
    car.plan=plan;car.parked=true;car.at=null;car.launched=null;
    scheduled.push(car);
  }
  // Parked cars queue along the kerb of the road they arrived on, one length apart.
  const kerbs=new Map();
  function reserveKerb(car,track) {
    const taken=kerbs.get(track)??0;
    kerbs.set(track,taken+1);
    car.kerb=track;
    const room=Math.max(1,Math.floor((track.length-8)/6.4));
    return taken%room;
  }
  function releaseKerb(car) {
    if(!car.kerb)return;
    kerbs.set(car.kerb,Math.max(0,(kerbs.get(car.kerb)??1)-1));
    car.kerb=null;
  }
  // Which side of the lane is the outside of the road.
  function kerbSide(car) {
    const [x,z]=sample(car.track,car.distance),[fx,fz]=trackDirection(car.track,car.distance);
    const edge=sign=>world.roadDistance(...world.grid(x+fz*sign*3,z-fx*sign*3),true);
    car.shoulderSign=edge(1)>=edge(-1)?1:-1;
  }
  function settle(car,town) {
    const {plan}=car, route=network.route(town,town===plan.home?plan.work:plan.home);
    if(route)car.track=route.path[0];
    car.distance=Math.min(car.track.length-2,4+reserveKerb(car,car.track)*6.4);
    car.shoulder=1;car.speed=0;car.parkBox=null;
    kerbSide(car);
  }
  function launch(car,leg,hour) {
    const {plan}=car;
    const [from,to]=leg==='out'?[plan.home,plan.work]:[plan.work,plan.home];
    car.launched={leg,hour};
    const route=network.routeFrom(car.track.to,to);
    if(!route?.path.length)return;
    releaseKerb(car);
    car.legs=route.path;car.leg=0;car.speed=0;car.parkBox=null;
    car.destination={name:to.name,path:route.path};
    car.parked=false;car.leaving=true;car.at=from;
  }
  function approachKerb(car) {
    car.parkAt=Math.max(3,car.track.length-5-reserveKerb(car,car.track)*6.4);
    kerbSide(car);
  }
  function parkScheduled(car) {
    const {plan}=car;
    car.at=car.launched?.leg==='out'?plan.work:plan.home;
    car.parked=true;car.speed=0;car.parkAt=null;car.shoulder=1;car.parkBox=null;
  }
  function updateScheduled(hour) {
    for(const car of scheduled){
      if(car.dynamic||!car.parked)continue;
      if(!car.at){car.at=locationAt(car.plan,hour);settle(car,car.at);}
      const leg=launchLeg(car.plan,car.at,hour);
      if(leg&&!(car.launched?.leg===leg&&Math.abs(car.launched.hour-hour)<car.plan[leg].window))launch(car,leg,hour);
    }
  }
  const lights=createTrafficLights(world,network,obstacles);
  group.add(lights.group);
  // Everyone walks from a front door to another front door, and only vanishes by going inside.
  const doors=buildings.filter(house=>house.entry).map(house=>({
    x:house.entry[0],z:house.entry[1],fx:house.front[0],fz:house.front[1]}));
  const doorGrid=new Map();
  for(const door of doors){
    const key=Math.floor(door.x/32)+':'+Math.floor(door.z/32);
    if(!doorGrid.has(key))doorGrid.set(key,[]);
    doorGrid.get(key).push(door);
  }
  function doorNear(x,z,accept=()=>true,reach=30) {
    let best=null,range=reach;
    const column=Math.floor(x/32),row=Math.floor(z/32);
    for(let i=-1;i<=1;i++)for(let j=-1;j<=1;j++)for(const door of doorGrid.get((column+i)+':'+(row+j))||[]){
      const d=Math.hypot(door.x-x,door.z-z);
      if(d<range&&accept(door)){range=d;best=door;}
    }
    return best;
  }
  // Pedestrians keep off the carriageway. Zebra crossings are the only way across.
  function legClear(a,b) {
    const steps=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/1.6));
    for(let i=0;i<=steps;i++){
      const [u,v]=world.grid(a[0]+(b[0]-a[0])*i/steps,a[1]+(b[1]-a[1])*i/steps);
      if(world.roadDistance(u,v,true)<.12)return false;
    }
    return true;
  }
  const porch=door=>[door.x+door.fx*1.3,door.z+door.fz*1.3];
  function walkRoute(points) {
    const lengths=[0];
    for(let i=1;i<points.length;i++)lengths.push(lengths[i-1]+Math.hypot(points[i][0]-points[i-1][0],points[i][1]-points[i-1][1]));
    return {points,lengths,total:lengths.at(-1)};
  }
  const indoors=door=>[door.x-door.fx*.5,door.z-door.fz*.5];
  function walkAt({points,lengths},s) {
    let i=1;
    while(i<lengths.length-1&&lengths[i]<s)i++;
    const a=points[i-1],b=points[i],span=Math.max(.001,lengths[i]-lengths[i-1]),f=T.MathUtils.clamp((s-lengths[i-1])/span,0,1);
    return [a[0]+(b[0]-a[0])*f,a[1]+(b[1]-a[1])*f,(b[0]-a[0])/span,(b[1]-a[1])/span];
  }
  const people=[];
  function addWalker(person,points) {
    const route=walkRoute(points);
    people.push({...person,route,s:rng()*route.total,dir:rng()<.5?1:-1,inside:rng()<.12,wait:rng()*25,
      hue:rng(),trousers:rng(),skin:rng()});
  }
  for (const town of world.towns) {
    const count = Math.round(((town.tier === 'hub' ? 16 : town.tier === 'village' ? 7 : 3)+Math.floor(rng()*4))*world.peopleScale*2);
    for (let i=0; i<count; i++) {
      const axis = i%4 < 2;
      const origin = axis ? town.u : town.v;
      const road = world.roads.find(road => road.alongX === axis && road.cross === (axis ? town.v : town.u) &&
        origin>=road.start&&origin<=road.end);
      if(!road) continue;
      const direction = road.end - origin > origin - road.start ? 1 : -1;
      const extent = Math.max(5, Math.min(town.radius - 22, Math.max(road.end - origin, origin - road.start) - 22));
      const side=i%2?1:-1, offset=road.width/2+2.4, first=19*direction, last=(19+extent*(.45+rng()*.55))*direction;
      const at=(along,across)=>world.point(town.u+(axis?along:across),town.v+(axis?across:along));
      const a=at(first,offset*side), b=at(last,offset*side), middle=at(first,0);
      const roadside=door=>(door.x-middle[0])*(a[0]-middle[0])+(door.z-middle[1])*(a[1]-middle[1])>0;
      const home=doorNear(...a,roadside), work=doorNear(...b,door=>door!==home&&roadside(door));
      if(!home||!work||!legClear(porch(home),a)||!legClear(a,b)||!legClear(b,porch(work)))continue;
      addWalker({town,pace:.75+rng()*.65,height:.83+rng()*.27,variant:Math.floor(rng()*64)+(rng()<.10?64:0)+(rng()<.16?128:0),
        starts:6.1+rng()*1.9,ends:17.4+rng()*5},[indoors(home),porch(home),a,b,porch(work),indoors(work)]);
    }
  }
  // Town pavements: walkers go door to door along a stretch of street.
  const spacing=22/Math.max(.05,world.peopleScale*Math.min(2,world.peopleScale));
  if(world.peopleScale>0)for(const street of world.streets.filter(item=>item.urban)){
    const points=street.points, offset=street.width/2+.95;
    let travelled=0;
    for(let i=1;i<points.length-1;i++){
      travelled+=Math.hypot(points[i][0]-points[i-1][0],points[i][1]-points[i-1][1]);
      while(travelled>=spacing){
        travelled-=spacing;
        const side=rng()<.5?1:-1, reach=4+Math.floor(rng()*16), last=Math.min(points.length-1,i+reach), path=[];
        for(let k=i;k<=last;k++){
          const a=points[Math.max(0,k-1)],b=points[Math.min(points.length-1,k+1)],span=Math.hypot(b[0]-a[0],b[1]-a[1])||1;
          path.push(world.point(points[k][0]-(b[1]-a[1])/span*offset*side,points[k][1]+(b[0]-a[0])/span*offset*side));
        }
        // The walk ends before the pavement would run across another street.
        let usable=1;
        while(usable<path.length&&legClear(path[usable-1],path[usable]))usable++;
        path.length=usable;
        if(path.length<2)continue;
        const home=doorNear(...path[0],door=>legClear(porch(door),path[0]),20);
        const work=doorNear(...path.at(-1),door=>door!==home&&legClear(porch(door),path.at(-1)),20);
        if(!home||!work)continue;
        addWalker({town:street.town,pace:.85+rng()*.7,height:.8+rng()*.3,variant:Math.floor(rng()*64)+(rng()<.1?64:0)+(rng()<.16?128:0),
          starts:6+rng()*2.5,ends:19+rng()*4.5},[indoors(home),porch(home),...path,porch(work),indoors(work)]);
      }
    }
  }
  for(const [u,v,alongX] of world.crossings){
    if(world.highwayAt(u,v,2)) continue;
    const axis=!alongX, at=offset=>world.point(u+(axis?offset:0),v+(axis?0:offset));
    const a=at(-6), b=at(6);
    const home=doorNear(...a,door=>legClear(porch(door),a)), work=doorNear(...b,door=>door!==home&&legClear(porch(door),b));
    if(!home||!work)continue;
    addWalker({crossing:true,town:{u,v},pace:1.25,height:1,variant:0,starts:6.3,ends:22.5},[indoors(home),porch(home),a,b,porch(work),indoors(work)]);
  }
  const DRAWN=Math.min(people.length,360);
  const incidentDrivers=6;
  const walkers=walkingMeshes(DRAWN+incidentDrivers);
  group.add(walkers.mesh);
  const geo = walkers.mesh.geometry;
  const incidents = [];
  const position=new T.Vector3(), orientation=new T.Quaternion();
  let roamingKey='', roaming=[];

  // Cars from a region the player has left drive on until they are far out of sight.
  let retiring=[];
  function updateRoaming(player){
    retiring=retiring.filter(car=>{
      const box=car.lastBox;
      if(box&&Math.hypot(box.cx-player.cx,box.cz-player.cz)<520)return true;
      dropModel(car);
      cars.splice(cars.indexOf(car),1);
      return false;
    });
    const [u,v]=world.grid(player.cx,player.cz);
    const outside=Math.max(Math.abs(u),Math.abs(v))>LIMIT+430;
    const ix=Math.floor(u/OUTER_SPACING), iz=Math.floor(v/OUTER_SPACING);
    const key=outside?ix+':'+iz:'';
    if(key===roamingKey) return;
    roamingKey=key;
    retiring.push(...roaming);
    roaming=[];
    if(!outside) return;
    const source=random(cellSeed(world.seed,ix,iz));
    const x=Math.abs(u)>=Math.abs(v)?ix+(u>0?1:-1):ix;
    const z=Math.abs(v)>Math.abs(u)?iz+(v>0?1:-1):iz;
    const bounds=[world.outerLine(x,false),world.outerLine(z,true),
      world.outerLine(x+1,false),world.outerLine(z+1,true)];
    for(const reverse of [false,true]){
      const car=spawn(route(world,bounds,reverse),false,null,source);
      // Join the loop at a point the player cannot see.
      let farthest=-1;
      for(let f=0;f<12;f++){
        const station=car.track.length*(f+(reverse?.055:.19))/12;
        const [sx,sz]=sample(car.track,station), range=Math.hypot(sx-player.cx,sz-player.cz);
        if(range>farthest){farthest=range;car.distance=station;}
      }
      roaming.push(car);
    }
  }

  const signalDistance=box=>lights.distance(box);

  function assignDestination(car) {
    const goals=car.track.goals;
    if(!goals?.length)return;
    car.destination=goals.find(goal=>goal.station>car.distance+8)||goals[0];
  }
  // Beyond detail range every vehicle is still drawn, as one instanced low-poly shape.
  const distantShape=mergeGeometries([
    new T.BoxGeometry(1,.56,1).translate(0,.34,0),
    new T.BoxGeometry(.84,.4,.56).translate(0,.8,-.06),
  ]);
  const distant=new T.InstancedMesh(distantShape,new T.MeshStandardMaterial({roughness:.5,metalness:.2}),cars.length+24);
  distant.frustumCulled=false;distant.count=0;
  group.add(distant);
  const distantPose=new T.Object3D(), distantColor=new T.Color();
  let farCount=0, stepPlayer=null, stepLights=false, stepPreview=false;
  function drawDistant(car,box) {
    if(stepPreview||farCount>=distant.instanceMatrix.count)return;
    const {dims}=car.spec;
    distantPose.position.set(box.cx,box.y,box.cz);
    distantPose.rotation.set(0,Math.atan2(box.fx,box.fz),0);
    distantPose.scale.set(dims.wid,dims.hgt??1.5,box.hl*2);
    distantPose.updateMatrix();
    distant.setMatrixAt(farCount,distantPose.matrix);
    distant.setColorAt(farCount,distantColor.set(car.color??0x4d7a35));
    farCount++;
  }
  function placeTruck(car,box,limit,dt) {
    const {model,cab,trailer,axles,brake}=car;
    model.visible=true;
    const point=back=>trailPoint(car,back,box.frontX,box.frontZ);
    const seat=(part,near,far,pivot)=>{
      const a=point(near),b=point(far),p=point(pivot);
      const ay=ground.height(a[0],a[1],box.y+.3),by=ground.height(b[0],b[1],box.y+.3);
      part.position.set(p[0],ground.height(p[0],p[1],box.y+.3)-.16,p[1]);
      part.rotation.set(-Math.atan2(ay-by,far-near),Math.atan2(a[0]-b[0],a[1]-b[1]),0,'YXZ');
    };
    if(trailer){seat(cab,.6,3.7,1.05);seat(trailer,3.95,12.45,3.95);}
    else seat(cab,.6,7.2,1.05);
    car.angle=(car.angle+car.speed*dt/.52)%(Math.PI*2);
    for(const axle of axles)axle.rotation.x=car.angle;
    brake.emissiveIntensity=car.speed>limit+.5||car.speed<.8?2.6:.12;
  }
  function showVehicle(car,next,limit,dt) {
    const player=stepPlayer;
    const {cx,cz,fx,fz,y}=next;
    const {spec}=car;
    const range=Math.hypot(player.cx-cx,player.cz-cz);
    if(stepPreview||range>(car.truck?520:385)){
      if(car.model) car.model.visible=false;
      if(!car.tractor && range>790) dropModel(car);
      drawDistant(car,next);
      return;
    }
    if(car.truck){placeTruck(car,next,limit,dt);return;}
    const model=car.model||buildModel(car);
    model.visible=true;
    // Heading follows the real sideways drift of a lane change, so a car is straight unless it is moving across.
    const drift=T.MathUtils.clamp((car.laneTarget??0)-(car.lane??0),-.48,.48);
    const steer=drift*(car.track.motorway?.laneWidth??3.5)/Math.max(10,car.speed);
    const yaw=Math.atan2(fx,fz)+(car.track.motorway?steer:0);
    if(car.tractor){
      const ox=cx-fx*car.hitchOffset, oz=cz-fz*car.hitchOffset;
      const [tx,tz]=sample(car.track,car.distance-4.7);
      const [mx,mz]=sample(car.track,car.distance);
      const trailerYaw=Math.atan2(mx-tx,mz-tz);
      const articulation=Math.atan2(Math.sin(trailerYaw-yaw),Math.cos(trailerYaw-yaw));
      car.trailer.rotation.y=T.MathUtils.clamp(articulation,-.42,.42);
      const groundY=ground.height(ox,oz);
      const pitch=Math.atan2(ground.height(ox+fx,oz+fz)-ground.height(ox-fx,oz-fz),2);
      model.position.set(ox,groundY,oz);
      model.rotation.set(-pitch,yaw,0,'YXZ');
      car.angle=(car.angle+car.speed*dt)%100;
      for(const {wheel,radius} of car.wheels) wheel.rotation.x=car.angle/radius;
      return;
    }
    const shape=model.userData.shape;
    const offset=(shape.zf+shape.zr)/2;
    const ox=cx-fx*offset, oz=cz-fz*offset;
    // Seat the body on its four wheel contacts so slopes, crests and camber never sink a wheel.
    const hx=Math.sin(yaw), hz=Math.cos(yaw), sx=hz, sz=-hx;
    const half=(spec.trackF+spec.trackR)/4;
    const wheelAt=(along,side)=>ground.height(ox+hx*along+sx*side,oz+hz*along+sz*side,y+.2);
    const fl=wheelAt(shape.a,-half),fr=wheelAt(shape.a,half),rl=wheelAt(-shape.b,-half),rr=wheelAt(-shape.b,half);
    const wheelbase=shape.a+shape.b;
    const pitch=Math.atan(((fl+fr)-(rl+rr))/2/wheelbase);
    const roll=Math.atan(((fr+rr)-(fl+rl))/2/(half*2));
    const ride=Math.max(fl,fr,rl,rr)*.35+(fl+fr+rl+rr)/4*.65;
    model.position.set(ox,ride+spec.cg,oz);
    model.rotation.set(-pitch,yaw,roll,'YXZ');
    car.angle=(car.angle+car.speed*dt/spec.wheel.radius)%(Math.PI*2);
    const ud=model.userData;
    for (const wheel of ud.wheels) wheel.userData.spin.rotation.x=car.angle;
    ud.bodyU.uBrake.value=car.parked?0:car.speed > limit+.6 || car.speed<1.1 && limit<1.1 || car.stopped>0 && Math.floor(walkers.time.value*3.8)%2===0 ? 1 : 0;
    ud.bodyU.uLamps.value=Number(stepLights&&!car.parked);
  }
  function step(dt, player, lightsOn = false, tractors = [], hour = 8.5,preview=false) {
    stepPlayer=player;stepLights=lightsOn;stepPreview=preview;
    walkers.time.value += dt;
    lights.update(walkers.time.value);
    updateRoaming(player);
    updateScheduled(hour);
    cars.forEach(car => {
      car.cooldown = Math.max(0, car.cooldown - dt);
      car.stopped = Math.max(0, car.stopped - dt);
      car.response=Math.max(0,car.response-dt);
      if(car.beacon) car.beacon.material.emissiveIntensity=car.response>0 &&
        Math.floor(walkers.time.value*7)%2===0?3.5:.08;
      const last=car.lastBox;
      const hit=last?.hit || car.dynamic?.lastHit;
      // A wreck stays where it stopped. It is towed away once the player has driven off.
      if(car.dynamic && car.stopped<=0 && car.dynamic.speed<.6 &&
        Math.hypot(player.cx-car.dynamic.p[0],player.cz-car.dynamic.p[2])>430){
        repair(car.model,car.dynamic);
        car.dynamic=null;
        car.damage=0;
        car.speed=4;
      }
      if(!hit || hit.j<650 || car.cooldown>0) return;
      if(!car.model) buildModel(car);
      const impulse=hit.j;
      car.cooldown=.55;
      car.damage=Math.min(.9,car.damage+impulse/(car.spec.mass*16));
      if(!car.tractor && !car.truck && !car.dynamic && impulse>car.spec.mass*1.45){
        car.dynamic=activateTrafficPhysics(car.spec,ground,last,hit);
      }
      if(car.dynamic){
        car.model.position.fromArray(car.dynamic.p);
        car.model.quaternion.fromArray(car.dynamic.q);
        applyDamage(car.model,car.dynamic,hit);
        car.stopped=Math.max(car.stopped,Math.min(27,7+impulse/car.spec.mass));
        car.inspectAfter=walkers.time.value+2.2;
        car.dynamic.lastHit=null;
      } else {car.speed*=.66;if(car.tractor) car.stopped=3;if(car.truck) car.stopped=9;}
      incidents.push({x:last.cx,y:last.y,z:last.cz,mass:car.spec.mass,impulse,hit,model:car.model});
      if(impulse>car.spec.mass*2.4 && Math.hypot(last.cx,last.cz)<650){
        for(const unit of cars) if(unit.kind==='police'||unit.kind==='ambulance') unit.response=28;
      }
    });
    const farmHours=hour>=6&&hour<21;
    const boxes=cars.map(car=>{
      if(car.tractor&&!farmHours){car.model.visible=false;return {...pose(car,ground),cx:1e7,cz:1e7,vx:0,vz:0};}
      if(!car.parked||car.dynamic)return pose(car,ground);
      car.parkBox??=pose(car,ground);
      const near=Math.hypot(car.parkBox.cx-player.cx,car.parkBox.cz-player.cz)<170;
      return near?{...car.parkBox,vx:0,vz:0}:{...car.parkBox,cx:1e7,cz:1e7};
    });
    farCount=0;
    const perturbers=preview?tractors:[player,...tractors];
    const vehicles = [...boxes,...perturbers];
    for(const box of vehicles)box.circulating=onRoundabout(box);
    for(const person of people){
      if(!person.crossing || person.inside) continue;
      const {lengths}=person.route;
      if(person.s<lengths[2]||person.s>lengths[3]) continue;
      const [cx,cz]=walkAt(person.route,person.s);
      vehicles.push({cx:cx+(person.dodge?.x || 0),cz:cz+(person.dodge?.z || 0)});
    }
    const nearby=new Map(), spacing=64;
    for(const other of vehicles){
      const key=Math.floor(other.cx/spacing)+':'+Math.floor(other.cz/spacing);
      if(!nearby.has(key)) nearby.set(key,[]);
      nearby.get(key).push(other);
    }
    cars.forEach((car,i)=>{
      const box=boxes[i];
      if(car.tractor&&!farmHours)return;
      if(car.dynamic){
        const body=car.dynamic;
        body.input.brake=body.speed>1.5?.30:.78;
        body.input.handbrake=body.speed<1.5?1:0;
        const steps=Math.max(1,Math.ceil(dt/PHYSICS_STEP));
        const old=obstacles.movingBoxes;
        obstacles.setMovingBoxes([]);
        for(let j=0;j<steps;j++){
          body.step(dt/steps);
          obstacles.resolve(body);
        }
        obstacles.setMovingBoxes(old);
        updateDamage(car.model,body);
        position.fromArray(body.p);
        orientation.fromArray(body.q);
        car.model.visible=!preview&&Math.hypot(player.cx-body.p[0],player.cz-body.p[2])<440;
        if(car.model.visible) syncCar(car.model,body,position,orientation,{lightsOn});
        car.speed=body.speed;
        boxes[i]=pose(car,ground);
        return;
      }
      if(car.parked){
        showVehicle(car,car.parkBox,0,dt);
        return;
      }
      const [nextX,nextZ]=trackDirection(car.track,car.distance+Math.max(8,car.speed*1.7));
      const upcoming=car.legs?.[car.leg];
      const braking=Math.max(9,(car.speed*car.speed-30)/7+6);
      const turning=box.fx*nextX+box.fz*nextZ < .94 || upcoming &&
        car.track.length-car.distance<braking &&
        (upcoming.merging||upcoming.turn);
      const inTown = world.towns.some(town => {
        const [tx,tz] = world.point(town.u,town.v);
        return Math.hypot(box.cx-tx,box.cz-tz)<town.radius;
      });
      const posted=(box.speedLimit??trackLimit(car.track,inTown))/3.6;
      const cruising=car.tractor?Math.min(posted,car.limit):
        car.truck?Math.min(posted,box.highway?25:22.2):posted*car.temper;
      let limit=car.stopped?0:turning?Math.min(5.5,cruising):cruising;
      if(car.parkAt!=null)limit=Math.min(limit,Math.sqrt(Math.max(0,3.2*(car.parkAt-car.distance))));
      const toSignal=signalDistance(box);
      const stopping=Number.isFinite(toSignal);
      if(stopping) limit=Math.min(limit,Math.sqrt(Math.max(0,8*(toSignal-.18))));
      const mergeDistance=car.track.merging?car.track.length-car.distance:Infinity;
      const merge=mergeDistance<50?car.track.knots.at(-1):null;
      const mergeDirection=merge?trackDirection(car.track,car.track.length):null;
      const road=car.track.motorway;
      const width=road?.laneWidth;
      const neighbors=[];
      let remainingMainline=Infinity;
      if(road){
        const station=world.grid(box.cx,box.cz)[road.alongX?0:1];
        const forward=(road.alongX?box.fx:box.fz)>0;
        remainingMainline=forward?road.end-road.tapers[1]-station:station-road.start-road.tapers[0];
        let planned=car.track.length-car.distance;
        for(let leg=car.leg;leg<car.legs.length;leg++){
          const edge=car.legs[leg];
          if(edge.motorway!==road){remainingMainline=Math.min(remainingMainline,planned);break;}
          planned+=edge.length;
        }
      }
      const col=Math.floor(box.cx/spacing),row=Math.floor(box.cz/spacing);
      for(let i=-1;i<=1;i++) for(let j=-1;j<=1;j++) for(const other of nearby.get((col+i)+':'+(row+j))||[]){
        if (other===box || Math.abs(other.y-box.y)>2.5) continue;
        const dx=other.cx-box.cx, dz=other.cz-box.cz;
        const ahead=dx*box.fx+dz*box.fz;
        const across=dx*box.rx+dz*box.rz;
        const gap=(other.hl||0)+box.hl+(box.highway?7:1.1);
        if(road&&(other.highway||other.dynamic)&&other.fx!=null){
          const lane=(car.lane??0)+across/width;
          neighbors.push({lane,target:lane+(other.laneIntent??0),ahead,
            speed:Math.max(0,(other.vx??0)*box.fx+(other.vz??0)*box.fz)});
        }
        // Brakes early enough to stop behind whatever is ahead, however slowly it is moving.
        if (ahead>0 && ahead<Math.max(box.highway?51:23,car.speed*car.speed/8+gap+12) && Math.abs(across)<2.1){
          const theirs=Math.max(0,(other.vx||0)*box.fx+(other.vz||0)*box.fz);
          limit=Math.min(limit,Math.sqrt(theirs*theirs+2*4.2*Math.max(0,ahead-gap)));
        }
        if(merge && (other.highway||other.dynamic) && other.fx*mergeDirection[0]+other.fz*mergeDirection[1]>.9){
          const mx=merge[0]-other.cx,mz=merge[1]-other.cz;
          const along=mx*other.fx+mz*other.fz;
          const lateral=mx*other.fz-mz*other.fx;
          const closing=Math.hypot(other.vx,other.vz);
          const expected=lateral-(other.laneIntent??0)*car.track.merging.laneWidth;
          if((Math.abs(lateral)<3||Math.abs(expected)<3)&&along> -9&&along<15+closing*2.3)
            limit=Math.min(limit,Math.sqrt(Math.max(0,6*(mergeDistance-6))));
        }
        if(ahead<0 || ahead>22 || Math.abs(across)>21 || other.fx==null) continue;
        const cross=box.fx*other.fz-box.fz*other.fx;
        const priority=Boolean(other.circulating)!==Boolean(box.circulating) ? other.circulating :
          Boolean(other.highway)!==Boolean(box.highway) ? other.highway : across>0;
        if(!priority || Math.abs(cross)<.55) continue;
        const at=(dx*other.fz-dz*other.fx)/cross;
        const theirAt=(dx*box.fz-dz*box.fx)/cross;
        const theirSpeed=Math.hypot(other.vx||0,other.vz||0);
        if(at>0&&at<20&&theirAt>-2.5&&theirAt<24&&
          (Math.abs(theirAt)<2.5 || theirSpeed>1.8&&Math.abs(at/Math.max(3,car.speed)-theirAt/theirSpeed)<1.75))
          limit=Math.min(limit,Math.max(0,(at-box.hl-2)*1.05));
      }
      if(road){
        const lane=car.lane??0;
        if(car.truck)car.laneTarget=0;
        else if(Math.abs((car.laneTarget??0)-lane)<.015)
          car.laneTarget=passingLane({lane:Math.round(lane),laneCount:road.lanes,speed:car.speed,
            cruising,remaining:remainingMainline,neighbors});
        box.laneIntent=(car.laneTarget??0)-lane;
        car.lane=lane+T.MathUtils.clamp(box.laneIntent,-dt*.48,dt*.48);
        if(car.lane>.02)
          limit=Math.min(limit,Math.sqrt(Math.max(0,7*(remainingMainline-8))));
      }else{
        car.lane=0;
        car.laneTarget=0;
      }
      car.speed += T.MathUtils.clamp(limit-car.speed,-6*dt,2.4*dt);
      let advance=car.speed*dt;
      if(stopping && advance>toSignal){
        advance=toSignal;
        car.speed=0;
      }
      car.distance+=advance;
      if(car.leaving){
        car.shoulder=Math.max(0,car.shoulder-advance/15);
        if(!car.shoulder)car.leaving=false;
      }
      if(car.parkAt!=null){
        const left=car.parkAt-car.distance;
        car.shoulder=T.MathUtils.clamp(1-left/15,0,1);
        if(left<=.2){car.distance=car.parkAt;parkScheduled(car);}
      }
      if(car.track.open){
        while(!car.parked&&car.distance>=car.track.length){
          car.distance-=car.track.length;
          if(car.leg===car.legs.length){
            if(car.plan){car.distance=car.track.length-.5;parkScheduled(car);break;}
            dispatch(car);
          }
          car.track=car.legs[car.leg++];
          if(car.plan&&car.leg===car.legs.length)approachKerb(car);
        }
      }else{
        if(!car.destination)assignDestination(car);
        const remaining=car.destination?
          (car.destination.station-(car.distance-advance)+car.track.length)%car.track.length:Infinity;
        car.distance%=car.track.length;
        if(remaining<=advance)assignDestination(car);
      }
      const next=pose(car,ground);
      boxes[i]=next;
      if(car.truck){
        const front=[next.frontX,next.frontZ], last=car.trail[0];
        if(!last||Math.hypot(last[0]-front[0],last[1]-front[1])>.7){
          car.trail.unshift(front);
          if(car.trail.length>40)car.trail.pop();
        }
      }
      showVehicle(car,next,limit,dt);
    });
    cars.forEach((car,i)=>{car.lastBox=boxes[i];});
    distant.count=farCount;
    distant.instanceMatrix.needsUpdate=true;
    if(distant.instanceColor)distant.instanceColor.needsUpdate=true;
    const threats=[...boxes,...perturbers];
    const closeThreats=threats.filter(box=>Math.hypot(box.cx-player.cx,box.cz-player.cz)<260);
    let visiblePeople = 0;
    people.forEach(person=>{
      const open=hour>=person.starts&&hour<person.ends;
      if(!person.placed){
        person.placed=true;
        if(!open){person.inside=true;person.s=0;person.wait=0;}
      }
      if(person.inside){
        person.wait-=dt;
        // Someone at their destination always comes home again, even after hours.
        if(person.wait>0||(!open&&person.s<=0))return;
        person.inside=false;
        person.dir=person.s>0?-1:1;
        person.dodge=null;
      }
      const {lengths,total}=person.route;
      let waiting=false;
      if(person.crossing){
        const kerb=person.dir>0?person.s<lengths[2]&&person.s>lengths[2]-.7:person.s>lengths[3]&&person.s<lengths[3]+.7;
        if(kerb){
          const [cx,cz]=walkAt(person.route,(lengths[2]+lengths[3])*.5);
          waiting=threats.some(other=>{
            if(other.fx==null)return false;
            const dx=cx-other.cx,dz=cz-other.cz;
            const ahead=dx*other.fx+dz*other.fz;
            const across=Math.abs(dx*other.fz-dz*other.fx);
            const speed=Math.hypot(other.vx||0,other.vz||0);
            return across<6 && (ahead>-(other.hl||0)&&ahead<(other.hl||0)+3+speed*1.35) && speed>1.1;
          });
        }
      }
      if(!waiting)person.s+=person.dir*person.pace*dt;
      if(person.s<=0||person.s>=total){
        person.s=person.s<=0?0:total;
        person.inside=true;
        person.wait=(person.s?10:18)+person.hue*40;
        return;
      }
      const [x,z,dx,dz]=walkAt(person.route,person.s);
      if (visiblePeople>=DRAWN||Math.hypot(player.cx-x, player.cz-z) > 150) return;
      const i = visiblePeople++;
      const yaw=Math.atan2(dx*person.dir,dz*person.dir);
      const pose=pedestrianPose(person,x,z,yaw,waiting?0:person.pace,person.s*4.4,dt,closeThreats,ground.height);
      geo.attributes.aInst.setXYZW(i,pose.x,pose.z,pose.yaw,pose.phase);
      geo.attributes.aLook.setXYZ(i,person.hue,person.trousers,person.skin);
      geo.attributes.aPose.setXY(i,pose.y,pose.reaction);
      geo.attributes.aVar.setXYZW(i,person.height,person.variant,pose.speed,0);
    });
    let visibleDrivers=0;
    if(!preview)for(const [index,car] of cars.entries()){
      if(visibleDrivers>=incidentDrivers)break;
      if(!car.dynamic||!car.stopped||car.speed>1||walkers.time.value<(car.inspectAfter??Infinity))continue;
      const box=boxes[index];
      if(Math.hypot(box.cx-player.cx,box.cz-player.cz)>80)continue;
      const x=box.cx+box.rx*(box.hw+.8),z=box.cz+box.rz*(box.hw+.8);
      if(!Number.isFinite(x)||world.land(x,z)>=3)continue;
      const frame=visiblePeople++;
      visibleDrivers++;
      geo.attributes.aInst.setXYZW(frame,x,z,Math.atan2(player.cx-x,player.cz-z),0);
      geo.attributes.aLook.setXYZ(frame,.44+index%6*.08,.25,.3+index%5*.09);
      geo.attributes.aPose.setXY(frame,ground.height(x,z,box.y),16);
      geo.attributes.aVar.setXYZW(frame,.94+index%3*.04,0,0,0);
    }
    geo.instanceCount = visiblePeople;
    for (const key of ['aInst','aLook','aPose','aVar']) geo.attributes[key].needsUpdate=true;
    return boxes;
  }
  // Hands a car over to the player: it leaves the traffic for good.
  function takeCar(car) {
    if(!car.model)buildModel(car);
    const model=car.model;
    releaseKerb(car);
    cars.splice(cars.indexOf(car),1);
    const parked=scheduled.indexOf(car);
    if(parked>=0)scheduled.splice(parked,1);
    car.model=null;
    return model;
  }
  const doorFor=(x,z)=>{const door=doorNear(x,z,()=>true,90);return door?indoors(door):[x+24,z+24];};
  return {lights,takeCar,doorFor,group,step,cars,scheduled,network,plans,people,signalDistance,
    sirens:()=>cars.filter(car=>car.beacon && car.response>0 && car.lastBox).map((car,i)=>({
      x:car.lastBox.cx,y:car.lastBox.y,z:car.lastBox.cz,vx:car.lastBox.vx,vz:car.lastBox.vz,id:i,
    })),
    drainIncidents: () => incidents.splice(0) };
}
