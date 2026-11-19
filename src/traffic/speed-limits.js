// Posted limits in km/h, shared by the HUD, the radars, the road signs and the traffic.
export const SPEED=Object.freeze({town:50,ramp:70,taper:80,country:90,main:110,motorway:130});

// The wide regional axis is the "2 lane road". Every other regional road is a country road.
export const isMainRoad=road=>Boolean(road&&!road.highway&&road.width>=9);

export const inTown=(world,u,v)=>world.towns.some(town=>Math.hypot(town.u-u,town.v-v)<town.radius);

function roadAt(world,u,v) {
  for(const road of world.roads){
    if(road.highway)continue;
    const along=road.alongX?u:v,across=road.alongX?v:u;
    if(along>=road.start&&along<=road.end&&Math.abs(across-road.cross)<road.width*.5+5)return road;
  }
  return null;
}

// Limit for a point on the ground, with the zone it belongs to.
export function postedLimit(world,ground,x,z,y,hamlets=[]) {
  const motorway=ground.motorway(x,z,y);
  if(motorway)return motorway.speedLimit;
  const ramp=world.rampAt(x,z);
  if(ramp?.edge<=.18&&Math.abs(y-world.rampDeck(ramp.path,x,z,ramp.y))<2.5)return SPEED.ramp;
  const [u,v]=world.grid(x,z);
  if(inTown(world,u,v)||hamlets.some(town=>Math.hypot(town.x-x,town.z-z)<115))return SPEED.town;
  return isMainRoad(roadAt(world,u,v))?SPEED.main:SPEED.country;
}

// Limit on a traffic route edge, where the road is already known.
export function trackLimit(track,urban) {
  if(urban||track.street)return SPEED.town;
  if(track.ramp)return SPEED.ramp;
  return isMainRoad(track.road)?SPEED.main:SPEED.country;
}

// French scale, simplified: the fine grows with the excess over the limit.
export function fineFor(excess) {
  return excess<20?68:excess<50?135:1500;
}
