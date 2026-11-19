import { Obstacles } from '../drive/physics/collide.js';
import { makeVehicle } from '../drive/physics/vehicle.js';
import { SPEED } from '../traffic/speed-limits.js';
import { BRIDGE_APPROACH, FIELD_ROW_NORMAL, FIELD_ROW_SPACING, random, roadRelief, roadWear } from '../world/world.js';

export const PHYSICS_STEP = 1 / 480;

function hash2(x, z) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(z | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function groundNoise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z), fx = x - xi, fz = z - zi;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash2(xi, zi), b = hash2(xi + 1, zi), c = hash2(xi, zi + 1), d = hash2(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

// Height of worked soil above the smooth terrain: clods, furrows, long swells and old ruts.
export function soilRelief(x, z, id) {
  const rough = terrainSurfaces[id]?.rough ?? 0;
  const micro = (groundNoise(x * .9, z * .9) - .5) * .13 * rough
    + (groundNoise(x * 3.1, z * 3.1) - .5) * .029 * rough;
  const across = x*FIELD_ROW_NORMAL[0] + z*FIELD_ROW_NORMAL[1];
  const furrows = id === 1 ? .046*Math.cos(across*2*Math.PI/FIELD_ROW_SPACING) : 0;
  const swell = id < 3 ? (groundNoise(x * .17 + 40, z * .17) - .5) * .30 * rough : 0;
  const ruts = id === 1 ? Math.max(0, groundNoise(x * .52, z * .52 + 9) - .62) * -.34 : 0;
  return micro + furrows + swell + ruts;
}

const terrainSurfaces = {
  // drag: share of the wheel load lost to soft ground, on top of normal rolling resistance
  0: { mu: .62, wet: .44, rough: .55, drag: .03 },
  1: { mu: .58, wet: .36, rough: .92, drag: .065 },
  3: { mu: .3, wet: .22, rough: .94, drag: .16 },
  2: { mu: .6, wet: .46, rough: .70, drag: .045 },
  6: { mu: .92, wet: .66, rough: .08, drag: 0 },
  7: { mu: 1.0, wet: .72, rough: .16, drag: 0 },
  8: { mu: .85, wet: .55, rough: .35, drag: .004 },
  9: { mu: .66, wet: .58, rough: .45, drag: .022 },
};

export function drivingGround(world, rain) {
  const surfaces = [false, true].map(wet => Object.fromEntries(
    Object.entries(terrainSurfaces).map(([id, t]) => [id, { id: Number(id), mu: wet ? t.wet : t.mu, rough: t.rough, drag: t.drag * (wet ? 1.7 : 1) }]),
  ));
  function classify(x, z) {
    const [u, v] = world.grid(x, z);
    const motorway = world.highwayAt(u,v);
    const arterial = world.roadDistance(u, v, true, false);
    const street = world.nearestStreet(u, v);
    const edge = Math.min(arterial, street?.edge ?? Infinity);
    const pavementEdge = edge > 0 && edge < 2.45 && !world.highwayAt(u,v,2.6)
      ? (world.towns.some(town => Math.abs(u-town.u)<town.radius && Math.abs(v-town.v)<town.radius)
        ? 2.45 : street?.urban ? 2.1 : 0)
      : 0;
    const sidewalk = edge < pavementEdge;
    const id = motorway || arterial <= 0 ? 7 : street?.edge <= 0 ? street.surface : world.riverEdge(x,z)<5 ?
      world.land(x,z) : sidewalk ? 6 : edge < 1.7 ? 9 : world.land(x, z);
    return { edge, id, motorway, pavementEdge };
  }
  function structure(x,z,contactY) {
    const summit=world.engineeredAt(x,z,'summit');
    const tunnel=world.engineeredAt(x,z,'tunnel');
    const scenic=tunnel?.edge<=.28&&(!tunnel.covered||contactY<tunnel.y+5.75)?tunnel:
      summit?.edge<=.24?summit:null;
    const ramp=world.rampAt(x,z);
    if(ramp?.edge<=.18) ramp.y=world.rampDeck(ramp.path,x,z,ramp.y);
    const [u,v]=world.grid(x,z);
    const upper=world.elevatedRoad(u,v,x,z);
    const motorway=world.highwayAt(u,v);
    const candidates=[upper,ramp?.edge<=.18?ramp:null,scenic].filter(Boolean);
    if(!candidates.length)return null;
    const base=motorway?world.roadHeight(x,z):world.height(x,z);
    return candidates.reduce((best,hit)=>{
      if(!Number.isFinite(contactY))return !best||hit.y>best.y?hit:best;
      if(contactY<hit.y-1.4 && !motorway && hit!==scenic)return best;
      return Math.abs(contactY-hit.y-.16)<=Math.abs(contactY-(best?.y??base)-.16)+.012?hit:best;
    },null);
  }
  return {
    motorway(x,z,contactY) {
      const [u,v]=world.grid(x,z);
      const road=world.highwayAt(u,v);
      if(!road) return null;
      if(Number.isFinite(contactY)){
        const upper=world.elevatedRoad(u,v,x,z),lower=world.roadHeight(x,z);
        if(upper&&upper.y-lower>2&&Math.abs(contactY-upper.y)<Math.abs(contactY-lower))return null;
      }
      const along=road.alongX?u:v;
      const nearStart=along-road.start<road.end-along;
      const endDistance=Math.min(along-road.start,road.end-along);
      const taper=road.tapers[nearStart?0:1];
      const speedLimit=endDistance<Math.max(15,taper*.28)?SPEED.taper:SPEED.motorway;
      return {road,width:world.motorwayWidth(road,along),endDistance,taper,speedLimit};
    },
    wrongWay(x,z,y,vx,vz) {
      const speed=Math.hypot(vx,vz);
      if(speed<2) return false;
      const motorway=this.motorway(x,z,y);
      if(motorway){
        const {road}=motorway;
        const grid=world.grid(x,z), ahead=world.grid(x+vx,z+vz);
        const axis=road.alongX?0:1;
        const side=grid[1-axis]-road.cross;
        const travel=ahead[axis]-grid[axis];
        return Math.abs(side)>1.2 && Math.abs(travel)>.7*speed &&
          travel*side*(road.alongX?1:-1)<0;
      }
      const ramp=world.rampAt(x,z);
      if(!ramp||ramp.edge>-.4) return false;
      const {path,segment}=ramp;
      if(Math.abs(y-world.rampDeck(path,x,z,ramp.y))>1.8) return false;
      if(path.length[segment]<8 || path.total-path.length[segment]<8) return false;
      const [ax,az]=path.points[segment-1],[bx,bz]=path.points[segment];
      return (vx*(bx-ax)+vz*(bz-az))*(path.offRamp?1:-1)<-.65*speed*Math.hypot(bx-ax,bz-az);
    },
    // Surface level and current of the river at a point, or null on dry land.
    water(x,z) {
      const width=world.riverWidth(z);
      if(width<.3||world.riverEdge(x,z)>=0)return null;
      const centre=world.riverX(z), share=(x-centre)/width, speed=1.5*(1-share*share);
      return {level:world.riverHeight(z),flowX:-(world.riverX(z+1)-world.riverX(z-1))*.5*speed,flowZ:-speed};
    },
    motorwayLevel: (x,z)=>world.roadHeight(x,z)+.16,
    rampLevel(x,z,path){
      const hit=world.rampAt(x,z);
      return hit?.path===path&&hit.edge<=.18?world.rampDeck(path,x,z,hit.y)+.16:null;
    },
    height(x, z, contactY=Infinity) {
      const pad=world.padLevel(x,z);
      if(pad!==null)return pad;
      const special=structure(x,z,contactY);
      if(special)return special.y+.16+roadRelief(x,z)*.46;
      const { edge, id, motorway, pavementEdge } = classify(x, z);
      const terrain = world.height(x,z);
      const riverEdge = world.riverEdge(x,z);
      const road = motorway || riverEdge<BRIDGE_APPROACH ? world.roadHeight(x,z,terrain) : terrain;
      if(world.riverEdge(x,z)<6 && road-terrain>1.3 && contactY<road-.64) return terrain;
      const base = id >= 6 && (id !== 9 || edge <= 0) ? road : terrain;
      if (id === 7) {
        const t = Math.min(1,Math.max(0,(riverEdge-8)/77));
        return base + .16 + (roadRelief(x,z) + roadWear(x,z))*t*t*(3-2*t);
      }
      if (id === 8) return base + .16 + (Math.abs(Math.sin(x * 9.5) * Math.sin(z * 9.5)) - .4) * .009;
      if (id === 9 && edge <= 0) return base + .16 + (groundNoise(x * 1.7, z * 1.7) - .5) * .05;
      const gain = Math.min(1, Math.max(0, (edge - .18) / 1.8));
      const shoulder = world.riverEdge(x,z)<5 ? 0 : Math.max(0,1-edge/1.7);
      if (id === 6) {
        const rise = Math.min(1, Math.max(0, edge / .20));
        const pavement = road + .16 + .071 * rise;
        if (edge <= pavementEdge - .60) return pavement;
        const lip = Math.min(1, Math.max(0, (pavementEdge - edge) / .60));
        const fall = lip * lip * (3 - 2 * lip);
        const verge = terrain + gain * soilRelief(x, z, world.land(x,z));
        return verge + (pavement - verge) * fall;
      }
      return base + shoulder*(road-base+.16) + gain * soilRelief(x, z, id);
    },
    surface(x, z, contactY=Infinity) {
      const special=structure(x,z,contactY);
      let id=special||world.padLevel(x,z)!==null?7:classify(x,z).id;
      if(!special && id>=6 && world.riverEdge(x,z)<6 && contactY<world.roadHeight(x,z)-.64) id=world.land(x,z);
      const wet=Number(rain());
      const dry=surfaces[0][id], soaked=surfaces[1][id];
      if(wet<=.002) return dry;
      if(wet>=.998) return soaked;
      return {id,rough:dry.rough,mu:dry.mu+(soaked.mu-dry.mu)*wet,drag:dry.drag+(soaked.drag-dry.drag)*wet};
    },
  };
}

export function createObstacles(world, scenery) {
  const obstacles = new Obstacles();
  const walls = [];
  for (const footprint of scenery.obstacles) {
    const { x, z, halfX, halfZ } = footprint;
    const corners = footprint.corners || [[x-halfX,z-halfZ],[x+halfX,z-halfZ],[x+halfX,z+halfZ],[x-halfX,z+halfZ]];
    corners.forEach((corner, i) => walls.push([...corner, ...corners[(i + 1) % 4]]));
  }
  obstacles.addBarriers(walls);
  obstacles.addBarriers(scenery.roadBarriers || []);
  obstacles.addBarriers(scenery.annexWalls || []);

  return obstacles;
}

export function spawnVehicle(spec, world, ground) {
  const car = makeVehicle(spec, ground);
  const rng=random(world.seed ^ 0x9ea7347);
  let placed=false;
  for(let attempt=0;attempt<80;attempt++){
    const road=world.roads[Math.floor(rng()*world.roads.length)];
    const along=road.start+35+rng()*(road.end-road.start-70);
    if(!road.spans.some(([a,b])=>along>a+8&&along<b-8))continue;
    const direction=rng()<.5?-1:1;
    const lane=road.highway?Math.min(road.innerShoulder+road.laneWidth*.5,
      world.motorwayWidth(road,along)*.5-1.65):road.width*.22;
    const cross=road.cross+(road.alongX?direction:-direction)*lane;
    const point=t=>road.alongX?world.point(t,cross):world.point(cross,t);
    const [x,z]=point(along), [aheadX,aheadZ]=point(along+direction*5);
    if(world.roundabouts.some(j=>Math.hypot(j.u-(road.alongX?along:cross),j.v-(road.alongX?cross:along))<j.cut+12)) continue;
    if(world.riverEdge(x,z)<22 || Math.abs(ground.height(x,z)-ground.height(aheadX,aheadZ))>1.1) continue;
    if(world.roads.some(other=>other.alongX!==road.alongX && Math.abs(other.cross-along)<18 &&
      cross>other.start && cross<other.end)) continue;
    car.reset(x,z,Math.atan2(aheadX-x,z-aheadZ));
    if(road.highway)car.p[1]+=ground.height(x,z,ground.motorwayLevel(x,z))-ground.height(x,z);
    placed=true;
    break;
  }
  if(!placed){
    const [x,z]=world.point(20,-2.1), [a,b]=world.point(25,-2.1);
    car.reset(x,z,Math.atan2(a-x,z-b));
  }
  // Settle the suspension before displaying the model.
  car.input.brake = .44;
  for (let i = 0; i < 48; i++) car.step(PHYSICS_STEP);
  car.input.brake = 0;
  return car;
}
