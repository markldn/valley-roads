import * as T from './vendor/three.module.js';
import { buildScenery } from './world/scenery.js';
import { networkLength } from './world/corridors.js';
import { createTyreEffects, createVisuals, tyrePress, wetness } from './render/visuals.js';
import { Audio as DrivingAudio } from './drive/audio/audio.js';
import { buildCar, syncCar } from './drive/car/model.js';
import { applyDamage, repair, updateDamage } from './drive/car/damage.js';
import { Debris, debrisSink } from './drive/car/debris.js';
import { Obstacles } from './drive/physics/collide.js';
import { createCrashFeel } from './player/crash-feel.js';
import { createFieldRelief } from './world/field-relief.js';
import { createRoadControls, solidStreetFurniture } from './traffic/road-controls.js';
import { postedLimit } from './traffic/speed-limits.js';
import { createTownscape } from './world/townscape.js';
import { populate } from './traffic/population.js';
import { jobOffers, slotOf } from './taxi/jobs.js';
import { createDelivery } from './taxi/delivery.js';
import { serviceStops } from './world/corridors.js';
import { createPolice } from './traffic/police.js';
import { bridges, coreBridgeSegments, riverScene } from './world/landscape.js';
import { createTownLife } from './people/life.js';
import { createFarms } from './world/farms.js';
import { createWoodland } from './world/forest.js';
import { createInfrastructure } from './world/infrastructure.js';
import { createDistrictDetails } from './people/district.js';
import { createMobility } from './traffic/mobility.js';
import { createExpanse } from './world/expanse.js';
import { createCivic, enterInterior, throwFragments } from './people/civic.js';
import { createCommerce } from './people/commerce.js';
import { enterCommerce } from './people/commerce-interior.js';
import { ALL_CARS, isDrivable } from './drive/physics/cars_extra.js';
import { createObstacles, drivingGround, PHYSICS_STEP, spawnVehicle } from './player/driving.js';
import { MAP_RADIUS, WORLD_SLIDERS, WORLD_SLIDER_MAX, createWorld, seedNumber } from './world/world.js';
import { createDemo } from './player/demo.js';
import { landShape } from './render/visuals.js';
import { createReplay } from './player/replay.js';
import { createFuel, fitTank } from './taxi/fuel.js';
import { createCareer } from './taxi/career.js';
import { enterHome } from './home/home.js';
import { createHomeSite } from './home/home-site.js';
import { attachTaxiGear } from './taxi/taxi.js';
import { createCareerUi } from './taxi/career-ui.js';
import { createOnFoot } from './player/on-foot.js';
import { createOccupantImpact } from './player/occupant-impact.js';
import { makeVehicle } from './drive/physics/vehicle.js';

const byId = id => document.getElementById(id);
const renderer = new T.WebGLRenderer({ canvas: byId('view'), antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
const scene = new T.Scene();
const visuals = createVisuals(renderer, scene);
const detailControl=byId('graphics-detail');
let lowDetail=false;
try { lowDetail=localStorage.getItem('valley-roads-graphics-detail')==='low'; } catch {}
detailControl.value=lowDetail?'low':'high';
visuals.setLowDetail(lowDetail);
detailControl.onchange=()=>{
  lowDetail=detailControl.value==='low';
  try { localStorage.setItem('valley-roads-graphics-detail',detailControl.value); } catch {}
  visuals.setLowDetail(lowDetail);
  woodland?.setLowDetail(lowDetail);
  resize();
};
const crispPicture=byId('picture-crisp');
let crispEnabled=false;
try {
  const saved=localStorage.getItem('valley-roads-picture-style');
  crispEnabled=saved==='crisp'||saved==='clear';
} catch {}
function applyPictureStyle() {
  crispPicture.setAttribute('aria-pressed',String(crispEnabled));
  document.documentElement.classList.toggle('picture-crisp',crispEnabled);
}
applyPictureStyle();
crispPicture.onclick=()=>{
  crispEnabled=!crispEnabled;
  applyPictureStyle();
  try {localStorage.setItem('valley-roads-picture-style',crispEnabled?'crisp':'default');} catch {}
};
const camera = new T.PerspectiveCamera(53, 1, 0.3, 2600);
const canvas = byId('map');
const map = canvas.getContext('2d');
let mapRoads, mapBuildings, mapTowns, mapHighways, mapStops=[];
let tour=null, freeCam=null;
let localMap = true;

function part(parent, geometry, color, x, y, z) {
  const piece = new T.Mesh(geometry, new T.MeshLambertMaterial({ color }));
  piece.position.set(x, y, z);
  piece.castShadow = true;
  piece.receiveShadow = true;
  parent.add(piece);
  return piece;
}

const carModels = new Map();
const MODEL_CACHE_LIMIT = 4;
let delivery, vehicle, car, ground, obstacles, population, farms, woodland, police, river, townLife, district, mobility, debris, expanse, civic, interior, selectedKey;
let trafficBoxes = [];
let steerInput = 0, accumulator = 0, headlightsOn = false, automatic = true;
const entrant = { isPlayer: true, car: null };
const audio = new DrivingAudio();
const crashFeel = createCrashFeel(byId('view'),audio);
const driverImpact=createOccupantImpact();
const replay=createReplay();
const career=createCareer();
const fuel=createFuel(id=>document.getElementById(id),career.wallet);
let careerUi, careerSignature='', taxiGear=null, prevHour=null, homeSite=null;
let abandoned=[];
const staticBox=(body,self=false)=>({...Obstacles.footprint(body),y:body.p[1],mass:body.spec.mass,vx:0,vz:0,self});
const keyOf=spec=>Object.keys(ALL_CARS).find(key=>ALL_CARS[key]===spec);
// Takes over a car that is standing in the world.
function driveCar(body,model,key) {
  driverImpact.reset();
  vehicle=body;car=model;selectedKey=key;
  car.userData.renderCategory='player car';
  taxiGear=attachTaxiGear(car,ALL_CARS[key]);
  scene.add(car);
  vehicle.aids.autoGear=automatic;
  entrant.car=vehicle;
  byId('vehicle').value=key;
  replay.clear();crashFeel.clear();
  snapCamera=true;
  if(soundOn)startSound();
}
// A car-park bay holds a single painted shape. When a walker comes near, it is given a real car to climb into.
const parkedModels=new Map();
const PARKED_KEYS=['mirage','polo','golf7','jetta','cclass','outlander','scirocco','crx','golf8'];
function parkedModel(item) {
  if(!parkedModels.has(item)){
    const key=PARKED_KEYS[item.bay.tint%PARKED_KEYS.length], spec=ALL_CARS[key];
    const model=buildCar(spec,{lights:true,color:item.color});
    model.rotation.y=item.yaw;
    model.position.set(item.x,item.y+spec.cg+.02,item.z);
    model.userData.footSpec=spec;model.userData.parkedKey=key;
    model.visible=false;
    parkedModels.set(item,model);
  }
  return parkedModels.get(item);
}
const foot=createOnFoot({scene,ground:()=>ground,obstacles:()=>obstacles,
  specOf:model=>model===car?vehicle.spec:model.userData.footSpec||abandoned.find(item=>item.model===model)?.vehicle.spec||vehicle.spec,
  vehicleBoxes:()=>[staticBox(vehicle),...abandoned.map(item=>staticBox(item.vehicle)),...trafficBoxes,...(commerce?.boxes({cx:foot.x,cz:foot.z})||[])],
  // The car the walker is facing wins over one that is merely closer.
  findCar(px,pz,heading) {
    // Any car within reach counts. Among several, the one being faced wins.
    const score=(cx,cz)=>{
      const d=Math.hypot(cx-px,cz-pz);
      return d>4.2?Infinity:d*(1.6-.6*((cx-px)*Math.sin(heading)+(cz-pz)*Math.cos(heading))/(d||1));
    };
    let best=null,range=Infinity;
    const own=score(vehicle.p[0],vehicle.p[2]);
    if(own<range){range=own;best={kind:'own',model:car,name:vehicle.spec.name};}
    for(const item of abandoned){
      const d=score(item.vehicle.p[0],item.vehicle.p[2]);
      if(d<range){range=d;best={kind:'left',item,model:item.model,name:item.vehicle.spec.name};}
    }
    // Cars in car-park bays are real cars too: stand by one and press G.
    for(const item of commerce?.parkedNear(px,pz,4.4)||[]){
      const d=score(item.x,item.z);
      if(d<range){
        const model=parkedModel(item);
        range=d;
        best={kind:'parked',item,model,name:ALL_CARS[model.userData.parkedKey].name,
          // Taking it swaps the bay's painted shape for the full car, standing exactly where it was.
          hold(){commerce.takeParked(item);scene.add(model);model.visible=true;}};
      }
    }
    for(const other of population.cars){
      const box=other.lastBox;
      if(!box||other.truck||other.tractor||other.dynamic||!other.model?.visible||other.speed>5)continue;
      const d=score(box.cx,box.cz);
      if(d<range){
        other.model.userData.footSpec=other.spec;
        range=d;
        best={kind:'traffic',other,model:other.model,name:other.spec.name,hold(){other.stopped=12;other.speed=0;},
          evict(){if(other.parked)return null;const [gx,gz]=population.doorFor(box.cx,box.cz);return {x:box.cx+box.rx*1.6,z:box.cz+box.rz*1.6,gx,gz};}};
      }
    }
    return best;
  },
  enter(target) {
    if(target.kind==='own'){snapCamera=true;return;}
    abandoned.push({vehicle,model:car,key:selectedKey});
    carModels.delete(selectedKey);
    if(target.kind==='left'){
      abandoned.splice(abandoned.indexOf(target.item),1);
      driveCar(target.item.vehicle,target.item.model,target.item.key);
      return;
    }
    if(target.kind==='parked'){
      const model=target.model, key=model.userData.parkedKey, body=makeVehicle(ALL_CARS[key],ground);
      trafficBoxes=[];
      body.p=model.position.toArray();body.q=model.quaternion.toArray();body.v=[0,0,0];body.w=[0,0,0];
      fitTank(body,key,.3+Math.random()*.6);
      body.input.brake=.4;
      driveCar(body,model,key);
      return;
    }
    const {other}=target, key=keyOf(other.spec), model=population.takeCar(other), body=makeVehicle(other.spec,ground);
    trafficBoxes=[];
    body.p=model.position.toArray();body.q=model.quaternion.toArray();body.v=[0,0,0];body.w=[0,0,0];
    fitTank(body,key,.3+Math.random()*.6);
    body.input.brake=.4;
    driveCar(body,model,key);
  },
});
let replayDue=0;
function startReplay() {
  if(inMenu||interior||demoRun||replay.active)return;
  const began=replay.begin({ground,car,obstacles,wheels:car.userData.wheels,mode:foot.active?0:cameraMode,lightsOn:headlightsOn,onDone(){
    document.documentElement.classList.remove('replay-mode');
    byId('replay-banner').hidden=true;
    snapCamera=true;
    if(soundOn)audio.resume();
  }});
  if(!began){
    const status=byId('repair-status');
    status.textContent='Nothing to replay yet: drive a few seconds first';
    clearTimeout(repairNotice);
    repairNotice=setTimeout(()=>{status.textContent='';},2600);
    return;
  }
  syncCar(car,vehicle,vehiclePosition.fromArray(vehicle.p),
    vehicleOrientation.fromArray(vehicle.q),{lightsOn:headlightsOn});
  replayDue=0;
  foot.hide();
  crashFeel.conceal();
  document.documentElement.classList.add('replay-mode');
  byId('replay-banner').hidden=false;
  if(soundOn)audio.suspend();
}
audio.carKeys = ALL_CARS;
let soundOn = false;
let hornTimer = 0, lastHorn = -Infinity, audioStarting;
const audioEntrants = [entrant];
const shadow = new T.Mesh(new T.CircleGeometry(1, 22), new T.MeshBasicMaterial({
  color: 0x252b20, transparent: true, opacity: 0.32, depthWrite: false,
  polygonOffset: true, polygonOffsetFactor: -1,
}));
shadow.rotation.x = -Math.PI / 2;
shadow.scale.set(1.17, 2.18, 1);
scene.add(shadow);

const trafficPreviewGeometry=new T.BoxGeometry();
const overviewBody=new T.InstancedMesh(trafficPreviewGeometry,
  new T.MeshStandardMaterial({color:0xffffff,roughness:.64}),256);
const overviewCab=new T.InstancedMesh(trafficPreviewGeometry,
  new T.MeshStandardMaterial({color:0x394448,roughness:.72}),256);
const overviewTransform=new T.Object3D(), overviewColor=new T.Color();
for(const mesh of [overviewBody,overviewCab]){
  mesh.count=0;
  mesh.frustumCulled=false;
  scene.add(mesh);
}
let demoRun=null, world, region, commerce, roadControls, townscape, fieldRelief, postedNow=50, crashNote='';
let x, z, yaw, speed, cameraMode = 0, snapCamera = true;
let inMenu=true, flyoverTime=0;
const keys = new Set();
const surfaceNames = ['Grass','Field','Forest floor','Riverbed','','','Pavement','Asphalt','Cobblestone','Gravel'];
let radarNotice='',radarTime=0,radarPulse=0;
const driveKeys = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w', 'a', 's', 'd', ' ', 'Shift']);
const pressed = (...candidates) => candidates.some(key => keys.has(key));
function buildMapPaths() {
  mapRoads = new Path2D();
  mapHighways = new Path2D();
  mapBuildings = new Path2D();
  mapStops = serviceStops(world);
  mapTowns = world.towns.map(town => ({ name: town.name, tier: town.tier, point: world.point(town.u, town.v) }));
  for (const { alongX, cross, spans, highway } of world.roads) {
    const pointAt = along => alongX ? world.point(along, cross) : world.point(cross, along);
    const network=highway?mapHighways:mapRoads;
    for(const [a,b] of spans){
      network.moveTo(...pointAt(a));
      for(let along=a+10;along<b;along+=10)network.lineTo(...pointAt(along));
      network.lineTo(...pointAt(b));
    }
  }
  for (const { points } of world.streets) {
    mapRoads.moveTo(...world.point(...points[0]));
    for (const point of points.slice(1)) mapRoads.lineTo(...world.point(...point));
  }
  for(const road of world.mountainRoads){
    mapRoads.moveTo(...road.points[0]);
    road.points.slice(1).forEach(p=>mapRoads.lineTo(...p));
  }
  for (const { corners } of region.obstacles) {
    mapBuildings.moveTo(...corners[0]);
    for (const point of corners.slice(1)) mapBuildings.lineTo(...point);
    mapBuildings.closePath();
  }
}

function drawMap() {
  if(!expanse) return;
  const radius = localMap ? 235 : MAP_RADIUS;
  const recenter = localMap || Math.max(Math.abs(x),Math.abs(z)) > MAP_RADIUS * .93;
  const centerX = recenter ? x : 0;
  const centerZ = recenter ? z : 0;
  const scale = canvas.width / (radius * 2);
  const offsetX = canvas.width / 2 - centerX * scale;
  const offsetZ = canvas.height / 2 - centerZ * scale;
  const point = (px, pz) => [px * scale + offsetX, pz * scale + offsetZ];
  map.fillStyle = localMap ? '#283c30' : '#172822';
  map.fillRect(0, 0, canvas.width, canvas.height);
  map.save();
  map.setTransform(scale, 0, 0, scale, offsetX, offsetZ);
  if (localMap) {
    map.fillStyle = '#73816b';
    map.fill(mapBuildings);
  }
  map.strokeStyle = '#6394a3';
  map.lineWidth = Math.max(40, 1.8 / scale);
  map.stroke(river.path);
  map.strokeStyle = '#9da991';
  map.lineWidth = Math.max(7, 1.2 / scale);
  map.lineJoin = 'round';
  map.stroke(mapRoads);
  expanse?.drawMap(map);
  map.strokeStyle='#c6b795';
  map.lineWidth=Math.max(18,1.25/scale);
  map.stroke(mapHighways);
  map.restore();

  map.fillStyle = '#ecdfbc';
  map.font = '11px system-ui';
  map.textAlign = 'center';
  for (const town of [...mapTowns,...expanse.towns()]) {
    const [px, py] = point(...town.point);
    if (!localMap) map.fillRect(px - 2, py - 2, 4, 4);
    if (localMap || town.tier !== 'hamlet') map.fillText(town.name, px, py - 8);
  }
  if(localMap){
    const letters={school:'É',hospital:'H',fire:'F',museum:'A',police:'P',clinic:'+',post:'L',cafe:'C',bakery:'B',supermarket:'M'};
    map.font='bold 10px system-ui';
    for(const stop of mobility.busStops){
      const [px,pz]=point(stop.x,stop.z);
      map.fillStyle='#163950';
      map.fillRect(px-6,pz-6,12,12);
      map.fillStyle='#d3edff';
      map.fillText(stop.line,px,pz+3.4);
    }
    for(const site of civic.sites){
      const [px,pz]=point(site.x,site.z);
      map.fillStyle='#10211e';
      map.fillRect(px-6,pz-6,12,12);
      map.fillStyle='#f1d68a';
      map.fillText(letters[site.kind],px,pz+3.4);
    }
    for(const pad of world.pads){
      const [px,pz]=point(pad.cx,pad.cz);
      map.fillStyle=pad.kind==='parking'?'#1f4f9a':'#a8331f';
      map.fillRect(px-6,pz-6,12,12);
      map.fillStyle='#fff6e2';
      map.fillText({mall:'C',market:'H',diner:'R',parking:'P'}[pad.kind],px,pz+3.4);
    }
    for(const marker of district.sitesOnMap){
      const [px,pz]=point(marker.x,marker.z);
      map.fillStyle='#16231e';
      map.fillRect(px-6,pz-6,12,12);
      map.fillStyle='#ecd9ba';
      map.fillText(marker.letter,px,pz+3.5);
    }

  }
  map.font='bold 10px system-ui';
  for(const stop of mapStops){
    const [px,pz]=point(stop.x,stop.z);
    map.fillStyle='#16231e';map.fillRect(px-5,pz-5,10,10);
    map.fillStyle='#8fd1ff';map.fillText('P',px,pz+3.4);
  }
  delivery?.drawMap(map,point,localMap,canvas.width);
  homeSite?.drawMap(map,point,localMap,canvas.width);
  map.save();
  map.translate(...point(x, z));
  map.rotate(-yaw + Math.PI);
  map.fillStyle = '#ffab6b';
  map.beginPath();
  map.moveTo(0, -7);
  map.lineTo(5, 5);
  map.lineTo(-5, 5);
  map.fill();
  map.restore();
}

byId('map-mode').onclick = event => {
  localMap = !localMap;
  event.currentTarget.textContent = localMap ? 'Local map' : 'Region map';
  drawMap();
};

const tyreEffects = createTyreEffects(scene,(x,z)=>ground.height(x,z,vehicle?.p[1]));
const rearPress=[{slot:0,x:Infinity,z:Infinity},{slot:0,x:Infinity,z:Infinity}];

function repairCurrentCar() {
  if (inMenu || interior || !vehicle || !car || driverImpact.outcome==='fatal') return;
  replay.clear();
  const hurt=Math.max(vehicle.damage?.total||0,car.userData.damaged?.05:0);
  const bill=career.enabled&&hurt>0?career.repairCost(hurt):0;
  if(bill)career.spend('repairs',bill);
  repair(car, vehicle);
  crashFeel.clear();
  if(vehicle.fuel<4)vehicle.fuel=8; // the breakdown service brings a can
  // A car in the river is winched out onto the nearest bank.
  if (vehicle.flood>0 || vehicle.submerged>0 || vehicle.drowned) {
    const [px,,pz]=vehicle.p, side=Math.sign(px-world.riverX(pz))||1;
    vehicle.reset(world.riverX(pz)+side*(world.riverWidth(pz)+6),pz,vehicle.yaw);
    [x,,z]=vehicle.p;
    snapCamera=true;
  }
  if (vehicle.up[1] < .35) {
    const [px, py, pz] = vehicle.p;
    const roadHeight = ground.height(px, pz, py);
    vehicle.reset(px, pz, vehicle.yaw);
    vehicle.p[1] = roadHeight + vehicle.spec.cg + .02;
    snapCamera = true;
  }
  byId('repair-status').textContent = bill?`Car repaired · ${bill} €`:'Car repaired';
  clearTimeout(repairNotice);
  repairNotice = setTimeout(() => { byId('repair-status').textContent = ''; }, 2200);
}

let repairNotice;
function reset() {
  driverImpact.reset();
  exitInterior();
  tyreEffects.clear();
  radarTime=radarPulse=0;
  crashWitness=null;
  byId('radar-flash').style.opacity='0';
  tyrePress.value.forEach(press=>{press.w=0;});
  rearPress.forEach(press=>{press.x=press.z=Infinity;});
  police?.reset();
  foot.reset();
  vehicle = spawnVehicle(ALL_CARS[selectedKey], world, ground);
  fitTank(vehicle,selectedKey,.72);
  if (car?.userData.damaged) repair(car, vehicle);
  vehicle.aids.autoGear = automatic;
  entrant.car = vehicle;
  [x, , z] = vehicle.p;
  yaw = Math.PI - vehicle.yaw;
  speed = 0;
  accumulator = 0;
  hornTimer = 0;
  steerInput = 0;
  snapCamera = true;
  replay.clear();replayDue=0;
  crashFeel.clear();
  roadControls?.reset();
  byId('fines').textContent='';
}

function generate(seed,settings=customWorld) {
  const newWorld = createWorld(seedNumber(seed),settings);
  const newRegion = buildScenery(newWorld);
  if (region) {
    farms.dispose();
    woodland.dispose();
    river?.water.dispose();
    for(const item of abandoned)scene.remove(item.model);
    abandoned=[];
    roadControls?.dispose();
    commerce?.dispose();
    townscape?.dispose();
    fieldRelief?.dispose();
    region.group.remove(farms.group,woodland.group);
    exitInterior();
    expanse?.dispose();
    expanse?.group.removeFromParent();
    scene.remove(region.group);
    const geometries=new Set(), materials=new Set(), plateTextures=new Set();
    region.group.traverse(object => {
      if (object.geometry) geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        if (!material) continue;
        materials.add(material);
        if (material.map?.isCanvasTexture) plateTextures.add(material.map);
      }
      if (object.isInstancedMesh) object.dispose();
    });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    for (const texture of plateTextures) texture.dispose();
  }
  trafficBoxes=[];
  world = newWorld;
  landShape.value.set(...world.landShape);
  region = newRegion;
  scene.add(region.group);
  ground = drivingGround(world, () => wetness.value);
  obstacles = createObstacles(world, region);
  river = riverScene(world);
  const infrastructure=createInfrastructure(world,obstacles);
  region.group.userData.renderCategory='scenery';
  river.group.userData.renderCategory='water';
  infrastructure.userData.renderCategory='infrastructure';
  region.group.add(river.group,infrastructure);
  region.roadSigns=infrastructure.userData.signCount;
  const rails=[];
  bridges(world,coreBridgeSegments(world),region.group,rails,new T.BoxGeometry(),
    new T.MeshStandardMaterial({roughness:.77}));
  obstacles.addBarriers(rails);
  debris?.clear();
  debris = new Debris(scene, ground, obstacles);
  debrisSink.current = debris;
  farms = createFarms(world,obstacles,debris);
  woodland=createWoodland(world,obstacles);
  woodland.setLowDetail(lowDetail);
  population=populate(world,ground,obstacles,farms.tractor,region.obstacles);
  const wasMissions=delivery?delivery.state.enabled:career.enabled;
  delivery?.dispose();
  delivery=createDelivery({scene,ground,world,panel:byId('job'),goal:byId('goal'),enabled:wasMissions,
    career,makeOffers:slot=>jobOffers(world,population.network,population.plans,slot)});
  delivery.reset(hour);
  homeSite?.dispose();
  homeSite=createHomeSite({scene,world,ground});
  civic = createCivic(world, region, obstacles, debris);
  police=createPolice(world,ground,civic.nearestStation);
  townLife=createTownLife(world,civic.sites,ground,region);
  district=createDistrictDetails(world,region,civic.sites,ground,obstacles);
  mobility=createMobility(world,ground,obstacles,debris,target=>{
    const range=Math.hypot(target.x-x,target.z-z);
    if(soundOn&&range<700)audio.impact(65000*(1-range/700)**2);
  });
  for(const [category,node] of [['traffic',population],['civic',civic],['farms',farms],['people',townLife],
    ['traffic',police],['woodland',woodland],['traffic',mobility],['district',district]]) {
    node.group.userData.renderCategory=category;
    region.group.add(node.group);
  }
  solidStreetFurniture(region,obstacles,debris);
  roadControls=createRoadControls(world,ground,obstacles,debris);
  townscape=createTownscape(world,region,obstacles,debris);
  commerce=createCommerce(world,region,civic.sites,obstacles,debris);
  commerce.group.userData.renderCategory='commerce';
  region.group.add(commerce.group);
  fieldRelief=createFieldRelief(world);
  roadControls.group.userData.renderCategory='infrastructure';
  townscape.group.userData.renderCategory='townscape';
  fieldRelief.group.userData.renderCategory='terrain';
  region.group.add(roadControls.group,townscape.group,fieldRelief.group);
  expanse=createExpanse(world,obstacles);
  expanse.group.userData.renderCategory='streamed';
  scene.add(expanse.group);
  buildMapPaths();
  reset();
}

function exitInterior(){
  if(!interior) return;
  interior.dispose();
  interior=null;
  snapCamera=true;
  const control=byId('interact');
  control.hidden=true;
  control.style.whiteSpace='';control.style.maxWidth='';
  document.documentElement.classList.remove('indoors');
}

// A new game starts in the flat. The front door leads out to the car.
let flatPending=true;
function enterFlat(){
  keys.clear();
  interior=enterHome({scene,camera,x,z,career,hour});
  document.documentElement.classList.add('indoors');
  const control=byId('interact');
  control.hidden=false;
  control.style.whiteSpace='normal';control.style.maxWidth='min(720px,90vw)';
}
function leaveFlat(){
  exitInterior();
  byId('repair-status').textContent='You step out to your car.';
  clearTimeout(repairNotice);
  repairNotice=setTimeout(()=>{byId('repair-status').textContent='';},3000);
}

function getOutOrIn(){
  if(interior||inMenu||demoRun||fuel.open||driverImpact.outcome==='fatal')return;
  if(foot.walking){foot.board();return;}
  if(foot.active)return;
  if(vehicle.speed>1.2){byId('repair-status').textContent='Stop the car first';return;}
  if(foot.leave(car,cameraMode===1||cameraMode===2))keys.clear();
}

function interact(){
  if(driverImpact.outcome==='fatal')return;
  if(interior){
    if(interior.use){if(interior.use()==='exit')leaveFlat();return;}
    exitInterior();return;
  }
  if(!foot.active&&!fuel.open&&Math.abs(speed)<1){
    const pump=commerce.pumpAt(x,z);
    if(pump){keys.clear();fuel.begin(pump,vehicle);return;}
  }
  const site=civic?.nearby(x,z,speed)||commerce?.nearby(x,z,speed)||homeSite?.nearby(x,z,speed);
  if(!site || police.detained()) return;
  keys.clear();
  if(site.home){enterFlat();return;}
  interior=site.retail||site.kind==='bakery'?enterCommerce(scene,site):enterInterior(scene,site);
  const control=byId('interact');
  control.hidden=false;
  document.documentElement.classList.add('indoors');
  control.textContent=`F · Leave ${site.name}`;
}
byId('interact').onclick=interact;

let fragmentCooldown=0, crashWitness=null;
const requestedHour=Number(new URLSearchParams(location.search).get('time') ?? 8.5);
let hour=Number.isFinite(requestedHour)?((requestedHour%24)+24)%24:8.5;

function tick(dt) {
  const times=profileFrames?{}:null;
  let stageStart=times?performance.now():0;
  const mark=key=>{
    if(!times) return;
    const now=performance.now();
    times[key]=now-stageStart;
    stageStart=now;
  };
  simulationStages=times;
  if(tour){
    tour.distance+=tour.speed*dt;
    const i=Math.min(tour.points.length-2,Math.floor(tour.distance/tour.step));
    const f=Math.min(1,tour.distance/tour.step-i),[a,b]=[tour.points[i],tour.points[i+1]];
    if(i>=tour.points.length-2&&f>=1){tour.done=true;tour=null;}
    else{
      const heading=Math.atan2(b[1]-a[1],b[0]-a[0]);
      vehicle.reset(a[0]+(b[0]-a[0])*f,a[1]+(b[1]-a[1])*f,heading);
    }
  }
  river.water.update(dt,{x:vehicle.p[0],z:vehicle.p[2]},(vehicle.submerged||0)>.05);
  hornTimer = Math.max(0,hornTimer-dt);
  const player = foot.active
    ? {cx:foot.x,cz:foot.z,fx:0,fz:1,rx:1,rz:0,hl:.3,hw:.3,y:foot.y,vx:0,vz:0,horn:false}
    : {...Obstacles.footprint(vehicle),y:vehicle.p[1],vx:vehicle.v[0],vz:vehicle.v[2],horn:hornTimer>0};
  const tractors = farms.update(dt,player,hour);
  mark('farms');
  tractors.push(...mobility.step(dt,player,trafficBoxes,hour,false,population.signalDistance),...roadControls.boxes(),...abandoned.map(item=>staticBox(item.vehicle)),...(foot.active?[staticBox(vehicle,true)]:[]));
  mark('mobility');
  const [u,v]=world.grid(player.cx,player.cz);
  const motorway=ground.motorway(player.cx,player.cz,player.y);
  player.highway=Boolean(motorway);
  const urban=!motorway && (world.towns.some(town=>Math.hypot(town.u-u,town.v-v)<town.radius) ||
    expanse.towns().some(town=>Math.hypot(town.x-player.cx,town.z-player.cz)<115));
  woodland.update(player.cx,player.cz,false,dt,2,player.horn);
  mark('woodlandAndFarms');
  const patrol=driverImpact.outcome==='fatal'?null:police.step(dt,player,urban,trafficBoxes);
  if(patrol?.released){
    const {station}=patrol;
    if(station)vehicle.reset(station.x+station.nx*4.4,station.z+station.nz*4.4,
      Math.atan2(station.nx,-station.nz));
    foot.reset();
    [x,,z]=vehicle.p;
    snapCamera=true;
    return;
  }
  if(patrol) tractors.push(patrol);
  fragmentCooldown=Math.max(0,fragmentCooldown-dt);
  const pad = Array.from(navigator.getGamepads?.() || []).find(device => device?.mapping === 'standard');
  const throttle = Math.max(Number(pressed('ArrowUp', 'w')), pad?.buttons[7]?.value || 0);
  const brake = Math.max(Number(pressed('ArrowDown', 's')), pad?.buttons[6]?.value || 0);
  const handbrake = pressed(' ') || !!pad?.buttons[0]?.pressed;
  const analog = pad?.axes[0] || 0;
  const stick = Math.sign(analog) * Math.max(0, (Math.abs(analog) - .11) / .89);
  const steer = Number(pressed('ArrowRight', 'd')) - Number(pressed('ArrowLeft', 'a')) || stick;
  const steerLimit = T.MathUtils.lerp(1, .23, T.MathUtils.smoothstep(vehicle.speed, 8, 44));
  steerInput = T.MathUtils.lerp(steerInput, steer * steerLimit, 1 - Math.exp(-dt * (steer ? 8 : 12)));
  // Soft ground tugs at the steering wheel, and a dazed driver has little control.
  const soil=vehicle.wheels.reduce((sum,wheel)=>sum+(wheel.grounded&&wheel.surf<6?wheel.rough:0),0)/4;
  const tug=soil*T.MathUtils.smoothstep(vehicle.speed,2,16)*(Math.sin(hour*9e3+x*1.7)*.035+Math.sin(z*2.9+x*.8)*.03);
  vehicle.input.throttle = police.detained()?0:throttle*crashFeel.control;
  vehicle.input.brake = police.detained()?1:brake*crashFeel.control;
  vehicle.input.steer = steerInput*crashFeel.control+tug;
  if(demoRun)demoRun.drive(dt,trafficBoxes,postedNow);
  foot.step(dt,pressed);
  fuel.step(dt);
  if(vehicle.misfuel>0){vehicle.misfuel+=dt;if(vehicle.misfuel>14){vehicle.damage.engine=1;vehicle.input.throttle*=.15;}}
  if(soil>.3&&vehicle.speed>4)pad?.vibrationActuator?.playEffect?.('dual-rumble',{duration:90,strongMagnitude:Math.min(.7,soil*vehicle.speed*.03),weakMagnitude:soil*.5})?.catch?.(()=>{});
  vehicle.input.handbrake = Number(handbrake);
  // Nobody at the wheel, or filling up: the handbrake stays on and the car cannot creep away.
  if(foot.active||fuel.open||driverImpact.outcome==='fatal'){
    vehicle.input.throttle=0;vehicle.input.steer=0;vehicle.input.brake=1;vehicle.input.handbrake=1;
  }
  mark('driverInput');
  if(crashWitness){
    crashWitness.time-=dt;
    if(crashWitness.time>0)player.crash=crashWitness;else crashWitness=null;
  }
  trafficBoxes = population.step(dt, player, headlightsOn, tractors, hour);
  mark('traffic');
  const streetVehicles=[player,...trafficBoxes,...tractors];
  expanse.update(x,z,dt,streetVehicles);
  mark('streaming');
  commerce.update(dt,hour,player,lowDetail,trafficBoxes);
  townLife.step(dt,hour,player,streetVehicles);
  district.step(dt,hour,player,streetVehicles);
  const posted=postedLimit(world,ground,player.cx,player.cz,player.y,expanse.towns());
  postedNow=posted;
  const caught=roadControls.update(dt,player,hour);
  if(caught){
    radarNotice=`${caught.mobile?'Portable speed camera':'Speed camera'} · ${caught.speed} km/h in a ${caught.limit} zone · ${caught.fine} € fine`;
    radarTime=3.4;radarPulse=.19;
    byId('fines').textContent=`Fines ${caught.total} €`;
    career.spend('fines',caught.fine);
    career.noteFine();
    delivery?.noteFine();
    if(caught.mobile&&caught.excess>=30)police.reportSpeed(player);
  }
  radarTime=Math.max(0,radarTime-dt);
  radarPulse=Math.max(0,radarPulse-dt);
  byId('radar-flash').style.opacity=String(radarPulse*.94);
  obstacles.setMovingBoxes([...trafficBoxes,...tractors.filter(other=>!other.self),...farms.animalBoxes(),...woodland.animalBoxes(),...commerce.boxes(player)].filter(other=>
    Math.abs(other.cx-player.cx)<115 && Math.abs(other.cz-player.cz)<115));
  for (const hit of population.drainIncidents()) {
    if (soundOn) audio.honkAt(hit.x, hit.y, hit.z, hit.mass, .24);
    if(fragmentCooldown===0 && hit.impulse>3900){
      throwFragments(debris,hit.hit,hit.model);
      fragmentCooldown=.28;
    }
  }
  mark('townLifeAndContacts');
  accumulator += dt;
  let contact = 0;
  vehicle.lastHit = null;
  vehicle.trafficHit = 0;
  const beforeImpact=vehicle.v.slice();
  while (accumulator >= PHYSICS_STEP) {
    vehicle.step(PHYSICS_STEP);
    contact = Math.max(contact, obstacles.resolve(vehicle));
    accumulator -= PHYSICS_STEP;
  }
  mark('playerPhysics');
  if(!foot.active){
    const wasFatal=driverImpact.outcome==='fatal';
    driverImpact.step(dt,vehicle,beforeImpact);
    if(!wasFatal&&driverImpact.outcome==='fatal'){
      if(demoRun)driverImpact.reset();
      else replayDue=2.2;
    }
  }
  mark('driverImpact');
  tyrePress.value.slice(4).forEach(press=>{ press.w=Math.max(0,press.w-dt*.82); });
  vehicle.wheels.forEach((wheel,index)=>{
    const [x,y,z]=wheel.contact;
    tyrePress.value[index].set(x,y,z,wheel.grounded?1:0);
    if(index<2||!wheel.grounded||wheel.surf>=6) return;
    const track=rearPress[index-2];
    if(Math.hypot(track.x-x,track.z-z)<.85) return;
    tyrePress.value[4+(index-2)*3+track.slot].set(x,y,z,.97);
    track.x=x;track.z=z;track.slot=(track.slot+1)%3;
  });
  if(driverImpact.outcome!=='fatal'&&vehicle.trafficHit>vehicle.spec.mass*1.85)police.reportCrash(player);
  contact=Math.max(contact,vehicle.lastHit?.j||0);
  if(vehicle.lastHit){career.noteImpact(vehicle.lastHit.j||0,performance.now());delivery?.noteImpact(vehicle.lastHit.j||0);}
  if (contact > 450 && soundOn) audio.impact(contact);
  if (vehicle.lastHit?.j >= 1200) {
    const [hitX,,hitZ]=vehicle.lastHit.P;
    crashWitness={x:hitX,z:hitZ,time:3.2};
    car.position.fromArray(vehicle.p);
    car.quaternion.fromArray(vehicle.q);
    car.userData.ownGeometry?.();
    const recordImpact=replay.captureHit(car,vehicle.lastHit,vehicle.forward,dt);
    const damaged=applyDamage(car, vehicle, vehicle.lastHit);
    if(damaged)recordImpact?.();
    if(damaged&&fragmentCooldown===0&&vehicle.lastHit.j>=vehicle.spec.mass*3.125){
      throwFragments(debris,vehicle.lastHit,car);
      fragmentCooldown=.28;
    }
    if(damaged) car.userData.damaged = true;
  }
  mark('tyresHit');
  updateDamage(car, vehicle);
  mark('updateDamage');
  crashFeel.update(dt,vehicle,car,cameraMode===1&&!foot.active);
  if(crashFeel.takeSevere()&&!demoRun)replayDue=2.2;
  if(replayDue>0){replayDue-=dt;if(replayDue<=0)startReplay();}
  mark('crashFeel');
  river.water.track(dt,vehicle);
  mark('waterTrack');
  debris.update(dt);
  mark('debris');
  [x, , z] = vehicle.p;
  if(foot.active){x=foot.x;z=foot.z;}
  yaw = Math.PI - vehicle.yaw;
  speed = foot.active?0:vehicle.forwardSpeed();
  const surfaceId=ground.surface(x,z,vehicle.p[1]).id;
  const paved = surfaceId === 7 || surfaceId === 8;
  const skid = vehicle.wheels.some(wheel => wheel.grounded && wheel.skid > .34);
  tyreEffects.update(dt,x,z,yaw,speed,paved,skid||handbrake,vehicle.wheels.some(wheel=>wheel.grounded));
  mark('afterPhysics');
}

const forward = new T.Vector3(), target = new T.Vector3(), eye = new T.Vector3();
const vehiclePosition = new T.Vector3(), vehicleOrientation = new T.Quaternion();
function updateView(dt) {
  vehiclePosition.fromArray(vehicle.p);
  vehicleOrientation.fromArray(vehicle.q);
  // Once the driver is getting out, the car is always drawn whole from outside.
  const cockpit = cameraMode === 1&&!foot.active, clear=cameraMode===2&&!foot.active, inside=cockpit||clear;
  const bore=world.engineeredAt(x,z,'tunnel');
  const underground=bore?.covered && bore.edge<.3 && vehiclePosition.y<bore.y+5.75;
  const fieldOfView = inside ? (clear?72:67) : cameraMode === 3 ? 61 : 53;
  const near=inside?.085:.30;
  const far=lowDetail?1800:2600;
  if (!foot.active && (camera.fov !== fieldOfView || camera.near!==near || camera.far!==far)) {
    camera.fov = fieldOfView;
    camera.near=near;
    camera.far=far;
    camera.updateProjectionMatrix();
  }
  syncCar(car, vehicle, vehiclePosition, vehicleOrientation, { cockpit,clear,lightsOn:headlightsOn });
  foot.atWheel(car,!inside,driverImpact);
  forward.fromArray(vehicle.forward);
  shadow.position.set(x,ground.height(x,z,vehiclePosition.y)+.042,z);
  shadow.visible=!inside;
  shadow.rotation.z = -yaw;
  if(foot.active)foot.view(dt,camera);
  else {
    if (inside) {
      eye.copy(car.userData.cockpit).applyQuaternion(vehicleOrientation).add(vehiclePosition);
      target.copy(eye).addScaledVector(forward, 15);
      target.y-=clear?.35:1.45;
    } else {
      const distance = underground?5.4:cameraMode === 3 ? 15 : 6.1;
      const height = underground?2.05:cameraMode === 3 ? 8.2 : 2.15;
      eye.set(x - Math.sin(yaw) * distance, vehiclePosition.y + height, z - Math.cos(yaw) * distance);
      if(underground) eye.y=Math.min(eye.y,bore.y+4.25);
      else eye.y=Math.max(eye.y,ground.height(eye.x,eye.z,vehiclePosition.y)+.8);
      target.copy(vehiclePosition).addScaledVector(forward, 13);
      target.y += cameraMode === 3 ? .34 : -1.15;
    }
    const roughness = vehicle.wheels.reduce((sum,wheel)=>sum+(wheel.grounded?wheel.rough:0),0)/4;
    const shake = roughness * T.MathUtils.smoothstep(vehicle.speed, 3, 18) *
      (.044*Math.sin(x*2.4+z*3.3)+.024*Math.sin(x*6.1-z*4.8));
    eye.y += shake * (cockpit ? .6 : 1);
    crashFeel.view(eye,target,vehicle,inside);
    if (snapCamera || inside) camera.position.copy(eye);
    else camera.position.lerp(eye, 1 - Math.exp(-dt * 9));
    // From the driver's seat the horizon tilts with the car.
    if(inside)camera.up.fromArray(vehicle.up);else camera.up.set(0,1,0);
    camera.lookAt(target);
    camera.rotateZ(crashFeel.roll*(inside?1:.3));
    camera.rotateX(crashFeel.pitch*(inside?1:.3));
    snapCamera = false;
  }
  demoRun?.view(dt,camera);
  river.water.view(camera,vehicle,cockpit,audio);
  delivery?.update(x,z,speed,hour,dt,yaw,{limit:postedNow,arrested:police.detained(),
    onHeat:()=>police.reportHeat({...Obstacles.footprint(vehicle),y:vehicle.p[1],vx:vehicle.v[0],vz:vehicle.v[2],horn:false})});
  if(taxiGear&&delivery){
    const fare=delivery.state;
    taxiGear.update(fare.enabled&&career.enabled,Boolean(fare.job)&&fare.stage==='deliver',fare.job?fare.job.reward*.013:0,performance.now()/1000);
  }
  if(freeCam){camera.position.set(freeCam.x,freeCam.y,freeCam.z);camera.up.set(0,0,-1);camera.lookAt(freeCam.x,0,freeCam.z-.001);}
}

function updateMeter() {
  const box=byId('meter'), data=delivery?.meter?.();
  const show=Boolean(data?.active&&data.aboard)&&!interior;
  box.hidden=!show;
  if(!show)return;
  byId('meter-fare').textContent=data.fare.toFixed(2)+' €';
  // the time bar empties as the fare runs past its allowed time
  const left=Math.max(0,1-data.elapsed/data.par);
  byId('meter-bar').style.width=Math.round(left*100)+'%';
  byId('meter-bar').classList.toggle('low',left<.25);
  byId('meter-heat').style.width=Math.round(data.heat*100)+'%';
}
// A new day starts at 05:00, in the car or after a night's sleep: the rent is due and the books close.
function checkDay() {
  if(prevHour!==null&&!demoRun&&((prevHour<5&&hour>=5)||(hour<prevHour&&hour>=5))){
    careerUi?.showDay(career.endDay());
  }
  prevHour=hour;
}

function updateHud() {
  updateMeter();
  careerUi?.hudTick();
  const signature=career.state.cash+'|'+career.state.fares+'|'+career.state.owned.length;
  if(signature!==careerSignature){careerSignature=signature;careerUi?.render();careerUi?.paintSelector(vehicleSelect);}
  region.updateDetail(x, z, lowDetail);
  townscape.update(x,z,lowDetail);
  fieldRelief.update(x,z,lowDetail);
  const law=byId('police-status'), status=driverImpact.outcome==='fatal'?'':radarTime>0?radarNotice:police.status();
  law.hidden=!status;
  if(law.textContent!==status) law.textContent=status;
  byId('wrong-way').hidden=!ground.wrongWay(x,z,vehicle.p[1],vehicle.v[0],vehicle.v[2]);
  byId('speed').textContent = Math.round(vehicle.speed * 3.6);
  byId('surface').textContent=surfaceNames[ground.surface(x,z,vehicle.p[1]).id];
  byId('gear').textContent = `${vehicle.gearLabel()} · ${Math.round(vehicle.rpm)} rpm`;
  const [u, v] = world.grid(x, z);
  const site=civic?.nearby(x,z,speed)||commerce?.nearby(x,z,speed)||(!foot.active?homeSite?.nearby(x,z,speed):null);
  const control=byId('interact');
  control.hidden=!site;
  if(site) control.textContent=`F · Enter ${site.name}`;
  // Filling up takes priority over the shop door when the car is standing at a pump.
  const pump=!foot.active&&Math.abs(speed)<1?commerce.pumpAt(x,z):null;
  if(pump&&!fuel.open){control.hidden=false;control.textContent=`F · Refuel at ${pump.pad.brand.name}, pump ${pump.number}`;}
  if(foot.prompt){control.hidden=false;control.textContent=foot.prompt;}
  else if(foot.walking&&!site)control.hidden=true;
  fuel.hud(vehicle);
  const mountain=world.engineeredAt(x,z);
  const trail=mountain?.edge<1&&vehicle.p[1]<mountain.y+4
    ? mountain.path.kind==='tunnel'?'Tunnel des Rives':'Route du Belvédère' : '';
  byId('location').textContent = trail || world.towns.find(town => Math.hypot(town.u - u, town.v - v) < town.radius)?.name ||
    expanse.towns().find(town=>Math.hypot(town.x-x,town.z-z)<115)?.name || world.highwayAt(u,v)?.name || 'Alder Valley';
  const limit=byId('limit');
  if(limit.textContent!==String(postedNow))limit.textContent=postedNow;
  limit.classList.toggle('over',vehicle.speed*3.6>postedNow+5);
  const wreck=driverImpact.outcome==='fatal'?'Driver did not survive · R to restart':
    vehicle.fuel<=0?'Out of fuel · K for a can of petrol':vehicle.misfuel>0?'Wrong fuel in the tank · K to drain it':vehicle.drowned?'Engine flooded · K to winch the car out':vehicle.wrecked?'Car wrecked · K to repair · R to restart':
    crashFeel.note||(driverImpact.outcome==='injured'?'Driver injured':'');
  if(wreck!==crashNote){crashNote=wreck;byId('repair-status').textContent=wreck;}
  drawMap();
}

function startSound() {
  if (!vehicle) return Promise.resolve();
  audio.ctx?.resume().catch(() => {});
  if (!audioStarting) {
    audioStarting = audio.start(audioEntrants).then(() => {
      soundOn = !inMenu && audio.ctx.state === 'running';
      if(inMenu) audio.suspend();
      audio.setRain(wetness.value > .5);
    }).catch(error => console.warn('Game audio could not start:',error))
      .finally(() => { audioStarting = null; });
  }
  return audioStarting;
}

// Browsers that require a gesture unlock the default-on mix at the first game input.
for (const event of ['pointerdown','keydown']) window.addEventListener(event,()=>{
  if (!inMenu && !soundOn) startSound();
});

async function honk() {
  const now = performance.now();
  if (!vehicle || interior || now-lastHorn < 200) return;
  lastHorn = now;
  hornTimer = .48;
  delivery?.noteHorn();
  if (!soundOn) await startSound();
  if (soundOn) audio.honkAt(...vehicle.p, vehicle.spec.mass, .28, false);
}

byId('horn').onclick = honk;
byId('replay').onclick = ()=>startReplay();
fuel.payButton.onclick=()=>fuel.pay();
byId('view').addEventListener('pointerdown',()=>{if(replay.active)replay.stop();});

function trimModelCache() {
  if (carModels.size <= MODEL_CACHE_LIMIT) return;
  const [key, model] = carModels.entries().next().value;
  carModels.delete(key);
  debris?.clear(model);
  const materials = new Set(Object.values(model.userData.mats));
  const geometries = new Set();
  model.traverse(object => {
    if (object.geometry) geometries.add(object.geometry);
    const list = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of list) if (material) materials.add(material);
    object.dispose?.();
  });
  for (const part of model.userData.structureSkin || []) geometries.add(part.original);
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  model.userData.gauges?.tex.dispose();
}

async function selectVehicle(key) {
  const control = byId('vehicle');
  control.disabled = true;
  try {
    if (!carModels.has(key)) {
      const model = buildCar(ALL_CARS[key], { lights: true });
      carModels.set(key, model);
    }
    if (car) scene.remove(car);
    selectedKey = key;
    car = carModels.get(key);
    car.userData.renderCategory='player car';
    taxiGear=attachTaxiGear(car,ALL_CARS[key]);
    carModels.delete(key);
    carModels.set(key, car);
    scene.add(car);
    trimModelCache();
    control.value = key;
    reset();
    const url = new URL(location.href);
    url.searchParams.set('car', key);
    history.replaceState(null, '', url);
    if (soundOn) await startSound();
  } finally {
    control.disabled = false;
  }
}
byId('vehicle').onchange = event => {
  selectVehicle(event.target.value).catch(error => console.error('Vehicle selection failed', error));
};

function nextCamera() {
  cameraMode = (cameraMode + 1) % 4;
  byId('camera').textContent=['Camera','Cockpit','Clear view','Wide chase'][cameraMode];
  document.body.classList.toggle('clear-view',cameraMode===2);
  snapCamera = true;
}
byId('camera').onclick = nextCamera;
function nextWeather() {
  const weather = visuals.cycleWeather();
  byId('weather').textContent = weather;
}
byId('weather').onclick = nextWeather;
function toggleTransmission() {
  automatic = !automatic;
  vehicle.aids.autoGear = automatic;
  byId('transmission').textContent = automatic ? 'Auto' : 'Manual';
  byId('transmission').title = automatic ? 'Switch to manual' : 'Q to downshift, E to upshift';
}
byId('transmission').onclick = toggleTransmission;
byId('reset').onclick = reset;
byId('repair').onclick = repairCurrentCar;
function setMenu(open) {
  inMenu=open;
  byId('main-menu').hidden=!open;
  document.documentElement.classList.toggle('menu-open',open);
  keys.clear();
  snapCamera=true;
  overviewBody.visible=overviewCab.visible=open;
  renderer.shadowMap.autoUpdate=!open;
  renderer.shadowMap.needsUpdate=true;
  resize();
  if(open){
    radarPulse=0;
    byId('radar-flash').style.opacity='0';
    soundOn=false;
    audio.suspend();
    byId('freestyle').focus();
  } else {
    byId('freestyle').blur();
    startSound();
    if(flatPending){flatPending=false;if(!demoRun&&career.state.home===true&&!new URLSearchParams(location.search).has('demo')&&!new URLSearchParams(location.search).has('race'))enterFlat();}
  }
}
byId('settings').onclick=()=>{setMenu(true);detailControl.focus();};

function flyover(dt) {
  flyoverTime+=dt;
  const [cx,cz]=world.point(60,38), y=world.height(cx,cz);
  const angle=.89+flyoverTime*.031+(world.seed%997)*.00031;
  const radius=920+Math.sin(flyoverTime*.071)*105;
  camera.position.set(cx+Math.sin(angle)*radius,y+330+40*Math.sin(flyoverTime*.095),cz+Math.cos(angle)*radius);
  camera.lookAt(cx,y+22,cz);
  const far=lowDetail?2800:5100;
  if(camera.fov!==51||camera.far!==far){
    camera.fov=51;camera.near=3;camera.far=far;
    camera.updateProjectionMatrix();
  }
  const observer={cx,cz,fx:0,fz:1,rx:1,rz:0,vx:0,vz:0,hl:0,hw:0};
  const boxes=population.step(dt,observer,headlightsOn,[],hour,true);
  let count=0;
  for(let i=0;i<boxes.length;i++){
    const {cx:x,cz:z,y,fx,fz,hl,hw}=boxes[i];
    if(Math.hypot(x-cx,z-cz)>1100 || count===overviewBody.instanceMatrix.count) continue;
    overviewTransform.rotation.y=Math.atan2(fx,fz);
    overviewTransform.position.set(x,y+.58,z);
    overviewTransform.scale.set(hw*2,.92,hl*2);
    overviewTransform.updateMatrix();
    overviewBody.setMatrixAt(count,overviewTransform.matrix);
    overviewBody.setColorAt(count,overviewColor.set(population.cars[i].color??0x6d7840));
    overviewTransform.position.y=y+1.15;
    overviewTransform.scale.set(hw*1.59,.53,hl*1.12);
    overviewTransform.updateMatrix();
    overviewCab.setMatrixAt(count++,overviewTransform.matrix);
  }
  overviewCab.count=overviewBody.count=count;
  if(overviewBody.instanceColor) overviewBody.instanceColor.needsUpdate=true;
  for(const mesh of [overviewBody,overviewCab])mesh.instanceMatrix.needsUpdate=true;
  expanse.update(camera.position.x,camera.position.z,dt,boxes);
  townLife.step(dt,hour,observer,boxes);
  district.step(dt,hour,observer,boxes);
  mobility.step(dt,observer,boxes,hour,true,population.signalDistance);
  river.water.update(dt,{x:vehicle?.p[0]??0,z:vehicle?.p[2]??0});
  woodland.update(cx,cz,true);
  region.updateDetail(camera.position.x,camera.position.z,lowDetail,true);
  const fog=scene.fog.density;
  scene.fog.density=fog*.57;
  visuals.render(camera,cx,cz,0,dt);
  scene.fog.density=fog;
}

window.addEventListener('keydown', event => {
  if(replay.active){event.preventDefault();replay.stop();return;}
  if(fuel.key(event,true))return;
  if(event.key==='Escape' && !inMenu){event.preventDefault();setMenu(true);return;}
  if(inMenu) return;
  if (event.target.matches('input, select') || (event.code === 'Space' && event.target.matches('button'))) return;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  if (driveKeys.has(key)) {
    event.preventDefault();
    keys.add(key);
  }
  if (!event.repeat && key === 'f') interact();
  if (!event.repeat && key === 'j' && !inMenu) delivery.accept(x,z);
  if (!event.repeat && key === 'm' && !inMenu) delivery.toggle();
  if(interior) return;
  if (!event.repeat && key === 'g') getOutOrIn();
  if (!event.repeat && key === 'b') startReplay();
  if (!event.repeat && key === 'h') honk();
  if (!event.repeat && key === 'c') nextCamera();
  if (!event.repeat && key === 'r') reset();
  if (!event.repeat && key === 'k') repairCurrentCar();
  if (!event.repeat && key === 'v') nextWeather();
  if (!event.repeat && key === 'n') toggleTransmission();
  if (!event.repeat && !automatic && key === 'q') vehicle.input.shiftDown = true;
  if (!event.repeat && !automatic && key === 'e') vehicle.input.shiftUp = true;
});
window.addEventListener('keyup', event => {if(fuel.key(event,false))return;});
window.addEventListener('keyup', event => keys.delete(event.key.length === 1 ? event.key.toLowerCase() : event.key));
window.addEventListener('blur', () => keys.clear());
const lookSurface=byId('view');
let lookDrag=null;
lookSurface.addEventListener('pointerdown',event=>{
  if(event.button!==0||event.pointerType!=='mouse'||inMenu||(!interior&&!foot.walking))return;
  lookDrag={id:event.pointerId,x:event.clientX,y:event.clientY};
  lookSurface.setPointerCapture(event.pointerId);
});
lookSurface.addEventListener('pointermove',event=>{
  if(lookDrag?.id!==event.pointerId||inMenu)return;
  const dx=event.clientX-lookDrag.x,dy=event.clientY-lookDrag.y;
  lookDrag.x=event.clientX;lookDrag.y=event.clientY;
  (interior??foot).look(dx,dy);
});
for(const type of ['pointerup','pointercancel','lostpointercapture'])
  lookSurface.addEventListener(type,event=>{if(lookDrag?.id===event.pointerId)lookDrag=null;});

for (const button of document.querySelectorAll('[data-key]')) {
  const key = button.dataset.key;
  button.onpointerdown = event => {
    event.preventDefault();
    button.setPointerCapture(event.pointerId);
    keys.add(key);
  };
  button.onlostpointercapture = () => keys.delete(key);
}
function resize() {
  renderer.setPixelRatio(Math.min(devicePixelRatio,lowDetail?(inMenu?.53:.67):(inMenu?.73:1.5)));
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();
const worldURL = new URL(location.href);
const randomSeed=()=>String(crypto.getRandomValues(new Uint32Array(1))[0]);
let seed=worldURL.searchParams.get('seed')?.trim().slice(0,24)||randomSeed();
// Seed and sliders live in the address, so a world can be shared as a link.
let customWorld={};
for(const {key} of WORLD_SLIDERS){
  const value=Number(worldURL.searchParams.get(key));
  if(worldURL.searchParams.has(key)&&Number.isFinite(value))customWorld[key]=Math.max(0,Math.min(WORLD_SLIDER_MAX,value));
}
const seedInput=byId('seed-input');
seedInput.value=seed;
const sliderHost=byId('world-sliders');
const sliders=WORLD_SLIDERS.map(({key,label})=>{
  const row=document.createElement('label');row.className='world-slider';
  const name=document.createElement('span');name.textContent=label;
  const input=document.createElement('input');input.type='range';input.min=0;input.max=WORLD_SLIDER_MAX;input.step=5;input.value=customWorld[key]??100;
  const shown=document.createElement('output');shown.textContent=input.value+'%';
  input.oninput=()=>{shown.textContent=input.value+'%';};
  input.onchange=queuePreview;
  row.append(name,input,shown);sliderHost.append(row);
  return {key,input};
});
const customPanel=byId('custom-world'), previewStatus=byId('preview-status');
if(Object.keys(customWorld).length)customPanel.open=true;
let previewPending=false, previewEdited=false, driveAfterPreview=false;
function queuePreview() {
  if(previewPending)return;
  previewPending=true;
  previewStatus.textContent='Updating preview…';
  // Paint the status before doing the synchronous world rebuild.
  requestAnimationFrame(()=>requestAnimationFrame(()=>{
    const nextSeed=seedInput.value.trim()||seed;
    seedInput.value=nextSeed;
    const next=new URL(location.href);
    const changed=nextSeed!==seed||sliders.some(({key,input})=>Number(input.value)!==(customWorld[key]??100));
    if(changed){
      const settings={};
      for(const {key,input} of sliders){
        if(input.value==='100')next.searchParams.delete(key);
        else{
          settings[key]=Number(input.value);
          next.searchParams.set(key,input.value);
        }
      }
      try {
        generate(nextSeed,settings);
      } catch(error) {
        previewPending=driveAfterPreview=false;
        previewStatus.textContent='Could not update preview.';
        console.error(error);
        return;
      }
      customWorld=settings;
      seed=nextSeed;
      next.searchParams.set('seed',seed);
      history.replaceState(null,'',next);
      renderer.shadowMap.needsUpdate=true;
      previewEdited=true;
    }
    previewStatus.textContent='';
    previewPending=false;
    if(driveAfterPreview){driveAfterPreview=false;setMenu(false);}
  }));
}
byId('seed-new').onclick=()=>{
  let next=randomSeed();
  while(next===seed)next=randomSeed();
  seedInput.value=next;
  queuePreview();
};
seedInput.onchange=queuePreview;
seedInput.onkeydown=event=>{
  if(event.key==='Enter'){event.preventDefault();queuePreview();}
};
byId('freestyle').onclick=()=>{
  if(previewPending)driveAfterPreview=true;
  else setMenu(false);
};
const demoRequested=worldURL.searchParams.has('demo');
const raceRequested=worldURL.searchParams.get('race')==='1';
if(demoRequested)document.documentElement.classList.add('demo-mode');
worldURL.searchParams.delete('race');
worldURL.searchParams.set('seed',seed);
history.replaceState(null,'',worldURL);
const vehicleSelect = byId('vehicle');
for (const [key, spec] of Object.entries(ALL_CARS).filter(([key]) => isDrivable(key))) {
  vehicleSelect.add(new Option(spec.name, key));
}
const requested = new URLSearchParams(location.search).get('car');
selectedKey = Object.hasOwn(ALL_CARS, requested) && isDrivable(requested) ? requested : 'hatch';
careerUi=createCareerUi({career,byId,
  cars:Object.entries(ALL_CARS).filter(([key])=>isDrivable(key)).map(([key,spec])=>({key,name:spec.name})),
  onChange:info=>{
    if(info.message)delivery?.say(info.message);
    if(info.mode)delivery?.state.enabled!==career.enabled&&delivery.toggle();
    careerUi.paintSelector(vehicleSelect);
  }});
careerUi.paintSelector(vehicleSelect);
if(!demoRequested&&!career.owns(selectedKey))selectedKey='hatch';
const paint=()=>new Promise(resolve=>requestAnimationFrame(()=>setTimeout(resolve)));
window.loadProgress?.(.34,'Building the valley');
await paint();
generate(seed);
window.loadProgress?.(.74,'Building your car');
await paint();
const initialCar=selectVehicle(selectedKey);
renderer.shadowMap.autoUpdate=false;
renderer.shadowMap.needsUpdate=true;

let previous = performance.now(), hudDelay = 0, lastMinute=-1;
let profileFrames=false, frameTimings, simulationStages;
let graphicsLost=false;
const graphicsStatus=byId('graphics-status');
renderer.domElement.addEventListener('webglcontextlost',event=>{
  event.preventDefault();
  graphicsLost=true;
  keys.clear();
  graphicsStatus.hidden=false;
});
renderer.domElement.addEventListener('webglcontextrestored',()=>{
  graphicsLost=false;
  previous=performance.now();
  renderer.shadowMap.needsUpdate=true;
  graphicsStatus.hidden=true;
});
renderer.setAnimationLoop(now => {
  if(graphicsLost)return;
  const entered=profileFrames?performance.now():0;
  const dt = Math.max(0.001, Math.min((now - previous) / 1000, 0.05));
  previous = now;
  if(!inMenu) hour=(hour+dt/24)%24;
  if(!inMenu)checkDay();
  const minute=Math.floor(hour*60);
  if(minute!==lastMinute){
    lastMinute=minute;
    const display=String(Math.floor(minute/60)).padStart(2,'0')+':'+String(minute%60).padStart(2,'0');
    byId('clock').textContent=display;
    byId('clock').dateTime=display;
  }
  const lightState=visuals.setHour(hour);
  const tunnel=vehicle&&world.engineeredAt(x,z,'tunnel');
  headlightsOn=lightState==='Night'||lightState==='Rain'||Boolean(tunnel?.covered&&tunnel.edge<0&&vehicle.p[1]<tunnel.y+5.5);
  if(inMenu){flyover(dt);return;}
  if(interior){
    interior.step(dt,pressed,camera,hour);
    if(interior.prompt!==undefined)byId('interact').textContent=interior.prompt;
    const slept=interior.takeHour?.();
    if(slept!=null)hour=slept;
    if(soundOn){
      audio.setSirens([],camera);
      audio.update(dt,audioEntrants,camera,'foot');
    }
    visuals.render(camera,x,z,0,dt,true);
    return;
  }
  if(replay.active){
    const focus=replay.step(dt,camera);
    if(focus)visuals.render(camera,focus[0],focus[2],0,dt);
    return;
  }
  const simulationStart=profileFrames?performance.now():0;
  const preTick=simulationStart-entered;
  tick(dt);
  if(replay.active)return;
  const viewStart=profileFrames?performance.now():0;
  updateView(dt);
  if(profileFrames&&simulationStages)simulationStages.view=performance.now()-viewStart;
  const recordStart=profileFrames?performance.now():0;
  if(!demoRun){
    const moving=[car,foot.occupant];
    const wheelPoses=model=>{
      for(const wheel of model.userData.wheels??[])moving.push(wheel,wheel.userData.spin);
    };
    wheelPoses(car);
    moving.push(police.model);
    if(police.model.visible)wheelPoses(police.model);
    for(const other of population.cars)if(other.model?.visible){
      moving.push(other.model);
      wheelPoses(other.model);
      if(other.truck)moving.push(other.cab,...(other.trailer?[other.trailer]:[]));
    }
    for(const item of debris.items)moving.push(item.mesh);
    replay.record(dt,moving,vehicle.wheels.reduce((mask,wheel,i)=>mask|(wheel.broken?1<<i:0),0));
  }
  if(profileFrames&&simulationStages)simulationStages.replayRecord=performance.now()-recordStart;
  const hudStart=profileFrames?performance.now():0;
  hudDelay -= dt;
  if (hudDelay <= 0) {
    updateHud();
    hudDelay = 0.10;
  }
  if (soundOn) {
    audio.setSirens([...population.sirens(),...police.sirens()],camera);
    audio.update(dt, audioEntrants, camera, cameraMode===1||cameraMode===2?'cockpit':'chase');
    const nearest = trafficBoxes.map((box, index) => {
      const v = population.cars[index].speed;
      return { x: box.cx, y: box.y, z: box.cz, v, vx: box.vx, vz: box.vz, big: box.mass > 1900 };
    }).sort((a, b) => Math.hypot(x - a.x, z - a.z) - Math.hypot(x - b.x, z - b.z));
    const inTown = byId('location').textContent !== 'Alder Valley';
    audio.ambient(dt, { dens: inTown ? .7 : .12, peds: townLife.nearby()+(inTown?3:0), party:townLife.party(), dogs: [], cars: nearest,
      night: Number(lightState==='Night'), rain: wetness.value > .5 }, camera);
  }
  if(profileFrames&&simulationStages)simulationStages.hudAudio=performance.now()-hudStart;
  const renderStart=profileFrames?performance.now():0;
  visuals.render(camera, x, z, speed, dt);
  if(profileFrames) frameTimings={simulation:renderStart-simulationStart,render:performance.now()-renderStart,pre:preTick,total:performance.now()-entered,stages:simulationStages};
});

window.loadProgress?.(.92,'Almost there');
await initialCar;
byId('freestyle').disabled=false;
window.loadProgress?.(1);
if(raceRequested || demoRequested)setMenu(false);
if(demoRequested){
  // Any input ends the demo and returns to the menu.
  demoRun=createDemo({world,ground,population,getVehicle:()=>vehicle,setCameraMode:mode=>{cameraMode=mode;snapCamera=true;}});
  for(let i=Math.floor(Math.random()*4);i>0;i--)nextWeather();
  byId('demo-banner').hidden=false;
  const leave=()=>{
    const next=new URL(location.origin+location.pathname);
    next.searchParams.set('seed',seed);
    location.href=next.href;
  };
  let startX=null,startY=null;
  addEventListener('keydown',leave);addEventListener('pointerdown',leave);addEventListener('touchstart',leave);
  addEventListener('pointermove',event=>{
    startX??=event.clientX;startY??=event.clientY;
    if(Math.hypot(event.clientX-startX,event.clientY-startY)>14)leave();
  });
}else{
  // Left alone on the menu for ten seconds, the game starts showing itself off.
  let idle=0,last=performance.now();
  for(const name of ['pointermove','pointerdown','keydown','wheel','touchstart','input'])addEventListener(name,()=>{idle=0;},{passive:true});
  setInterval(()=>{
    const now=performance.now();idle+=now-last;last=now;
    if(!inMenu||idle<10000||previewPending||previewEdited||customPanel.open||document.activeElement===seedInput)return;
    const next=new URL(location.origin+location.pathname), cars=Object.keys(ALL_CARS).filter(isDrivable);
    next.searchParams.set('seed',String(crypto.getRandomValues(new Uint32Array(1))[0]));
    next.searchParams.set('car',cars[Math.floor(Math.random()*cars.length)]);
    next.searchParams.set('time',(7+Math.random()*13).toFixed(1));
    next.searchParams.set('demo','1');
    location.href=next.href;
  },500);
}

function tally(records,key) {
  const counts={};
  for(const record of records){
    const value=key(record);
    counts[value]=(counts[value]??0)+1;
  }
  return counts;
}

function census() {
  const [cx,cz]=world.point(60,38);
  return {
    seed:world.seed,terrain:world.terrain,scope:{cx,cz,woodlandRadiusTiles:6,woodlandTileMeters:250},
    buildings:{total:region.obstacles.length,byType:tally(region.obstacles,b=>b.kind),
      byFloors:tally(region.obstacles,b=>b.floors),byRoof:tally(region.obstacles,b=>b.roof)},
    woodland:woodland.census(cx,cz,true),farms:farms.census(),
    pedestrians:{regionalRecords:population.people.length,townResidentRecords:townLife.residentCount,
      householdCommuters:townLife.commuterCount,schoolyardPupils:district.pupilCount},
    traffic:{total:population.cars.length,scheduled:population.scheduled.length,
      byKind:tally(population.cars,c=>c.plan?.kind??c.kind??'ambient'),
      byModel:tally(population.cars,c=>c.spec.name??c.kind??'unknown'),
      parked:population.cars.filter(c=>c.parked).length,
      active:population.cars.filter(c=>!c.parked).length},
    roadKm:networkLength(world),streetFurniture:{lampPosts:region.lampPosts,roadSigns:region.roadSigns,
      civicSigns:civic.sites.length},
  };
}

// Inspection hook for driving tests: scheduled traffic state and the game clock.
window.__valleyRoads={get homeSite(){return homeSite;},get renderer(){return renderer;},get interior(){return interior;},get camera(){return camera;},get scene(){return scene;},get woodlandGroup(){return woodland.group;},get foot(){return foot;},get mobility(){return mobility;},get civic(){return civic;},get fuel(){return fuel;},get abandoned(){return abandoned;},get replay(){return replay;},get commerce(){return commerce;},get obstacles(){return obstacles;},get roadControls(){return roadControls;},get townscape(){return townscape;},get farms(){return farms;},get crashNote(){return crashFeel.note;},census,get vehicle(){return vehicle;},get car(){return car;},renderStats:visuals.worldRenderStats,profileFrames(value){profileFrames=value;},frameTimings:()=>frameTimings,captureRenderBreakdown:visuals.captureRenderBreakdown,renderBreakdown:visuals.renderBreakdown,prepareCensus(){
    const [cx,cz]=world.point(60,38);
    woodland.update(cx,cz,true,0,Infinity);
    farms.update(0,{cx,cz});
  },setFreeCam(c){freeCam=c;if(!c)camera.up.set(0,1,0);},lighting:()=>({fog:scene.fog.color.getHex(),density:scene.fog.density,wet:wetness.value}),
  setWeatherIndex(n){let t;for(let i=0;i<8;i++){t=visuals.cycleWeather();if(t===n)break;}byId('weather').textContent=t;},place(px,pz,heading){vehicle.reset(px,pz,heading);[x,,z]=vehicle.p;snapCamera=true;},
  setCamera(mode){cameraMode=mode;},startTour(points,step,speed){tour={points,step,speed,distance:0};},get touring(){return Boolean(tour);},
  corridor:async()=>import('./world/corridors.js'),get delivery(){return delivery;},get population(){return population;},get world(){return world;},
  get hour(){return hour;},set hour(value){hour=((value%24)+24)%24;}};
