import { junctionFillets, fillTriangles } from './fillets.js';
import * as T from '../vendor/three.module.js';
import { LIMIT, OUTER_SPACING, ROAD_WIDTH, cellSeed, random } from './world.js';

import { surface, windowSurface } from '../render/visuals.js';
import { edgeOffset, vergeMaterial, vergeMesh } from './verge.js';

export const TERRAIN_EXTENT = LIMIT + 150;
export const TERRAIN_SIZE = TERRAIN_EXTENT / 3;

const terrainCuts = new WeakMap();

// Keep open pavement above the triangles of the coarse terrain grid, not just
// above the analytic height function. All neighboring tiles share the grid.
function clearanceRaster(world, segments) {
  const step = TERRAIN_SIZE / segments;
  const raw = new Map(), caps = new Map();
  const key = (u,v) => u + ':' + v;
  const position = i => i*step - TERRAIN_EXTENT;
  const height = (u,v) => {
    const id = key(u,v);
    if (!raw.has(id)) raw.set(id, world.height(position(u),position(v)));
    return raw.get(id);
  };
  function constrain(x,z,deck) {
    const gx=(x+TERRAIN_EXTENT)/step, gz=(z+TERRAIN_EXTENT)/step;
    const u=Math.floor(gx),v=Math.floor(gz),f=gx-u,g=gz-v;
    const corners=f+g<=1?[[u,v,1-f-g],[u+1,v,f],[u,v+1,g]]:
      [[u+1,v+1,f+g-1],[u+1,v,1-g],[u,v+1,1-f]];
    if(corners.reduce((y,[i,j,w])=>y+height(i,j)*w,0)<=deck-.025) return;
    for(const [i,j] of corners){
      const id=key(i,j),limit=deck-.06;
      const tunnel=world.engineeredAt(position(i),position(j),'tunnel');
      if(tunnel?.covered && tunnel.edge < 1 && limit<tunnel.y+6.15) continue;
      if(limit<Math.min(caps.get(id)??Infinity,height(i,j))) caps.set(id,limit);
    }
  }
  function strip(a,b,width,elevation,clip) {
    const dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);
    if(length<.001) return;
    const sections=Math.ceil(length/2);
    for(let i=0;i<=sections;i++){
      const t=i/sections;
      for(const lane of [-.48,-.24,0,.24,.48]){
        const x=a[0]+dx*t+dz/length*width*lane, z=a[1]+dz*t-dx/length*width*lane;
        if(!clip || clip(x,z)) constrain(x,z,elevation(x,z,t));
      }
    }
  }
  function gridRoad(road,start,end,clip) {
    const at=s=>road.alongX?world.point(s,road.cross):world.point(road.cross,s);
    for(let s=start;s<end;s+=5){
      const next=Math.min(end,s+5);
      strip(at(s),at(next),world.motorwayWidth(road,(s+next)*.5),
        (x,z)=>world.roadDeck(road,...world.grid(x,z),x,z)+.16,clip);
    }
  }
  return {caps,strip,gridRoad};
}

function regionalClearance(world,segments) {
  let rasters=terrainCuts.get(world);
  if(!rasters) terrainCuts.set(world,rasters=new Map());
  if(rasters.has(segments)) return rasters.get(segments);
  const raster=clearanceRaster(world,segments);
  for(const road of world.roads) for(const [start,end] of road.spans) raster.gridRoad(road,start,end);
  for(const street of world.streets){
    if(street.ramp) continue;
    const points=street.points.map(p=>world.point(...p));
    for(let i=1;i<points.length;i++) raster.strip(points[i-1],points[i],street.width,
      (x,z)=>world.roadHeight(x,z)+.16,(x,z)=>!world.highwayAt(...world.grid(x,z)));
  }
  for(const path of [...world.ramps,...world.mountainRoads]){
    for(let i=1;i<path.points.length;i++){
      if(path.kind==='tunnel'&&i>=path.portalStart&&i<=path.portalEnd) continue;
      raster.strip(path.points[i-1],path.points[i],path.width,(x,z,t)=>{
        const y=T.MathUtils.lerp(path.elevations[i-1],path.elevations[i],t);
        return (path.kind==='ramp'?world.rampDeck(path,x,z,y):y)+.153;
      });
    }
  }
  cutRiver(world,raster,-Infinity,Infinity);
  // Terrain stays below the tarmac of car parks and their driveways.
  for(const pad of world.pads){
    for(let depth=-4;depth<=pad.d+4;depth+=6){
      const a=[pad.x+pad.bx*depth-pad.ax*(pad.w*.5+3),pad.z+pad.bz*depth-pad.az*(pad.w*.5+3)];
      const b=[pad.x+pad.bx*depth+pad.ax*(pad.w*.5+3),pad.z+pad.bz*depth+pad.az*(pad.w*.5+3)];
      raster.strip(a,b,7,()=>pad.y-.04);
    }
  }
  const result=raster.caps;
  rasters.set(segments,result);
  return result;
}

// Keeps the coarse terrain under the detailed river bed and banks.
function cutRiver(world,raster,zMin,zMax,clip) {
  for(let z=Math.max(-3240,zMin);z<Math.min(3240,zMax);z+=12){
    const width=world.riverWidth(z);
    if(width<.3)continue;
    const cx=world.riverX(z),nx=world.riverX(z+12);
    for(const share of [-1,-.5,0,.5,1]){
      const offset=share*(width+7);
      raster.strip([cx+offset,z],[nx+offset,z+12],14,(x,pz)=>world.height(x,pz)-.3,clip);
    }
  }
}

function streamedClearance(world,column,row,segments) {
  const raster=clearanceRaster(world,segments);
  const x=TERRAIN_SIZE*column-TERRAIN_EXTENT,z=TERRAIN_SIZE*row-TERRAIN_EXTENT;
  const pad=2*TERRAIN_SIZE/segments;
  const clip=(px,pz)=>px>=x-pad&&px<=x+TERRAIN_SIZE+pad&&pz>=z-pad&&pz<=z+TERRAIN_SIZE+pad;
  cutRiver(world,raster,z-40,z+TERRAIN_SIZE+40,clip);
  for(const alongX of [true,false]){
    const low=alongX?x:z, crossMin=alongX?z:x;
    const first=Math.floor((crossMin-260)/OUTER_SPACING),last=Math.ceil((crossMin+TERRAIN_SIZE+260)/OUTER_SPACING);
    const apply=(cross,width,start,end)=>{
      if(cross<crossMin-220||cross>crossMin+TERRAIN_SIZE+220) return;
      const a=Math.max(start,Math.floor((low-220)/5)*5), b=Math.min(end,low+TERRAIN_SIZE+220);
      if(a<b) raster.gridRoad({alongX,cross,width},a,b,clip);
    };
    for(let i=first;i<=last;i++){
      const cross=world.outerLine(i,alongX),width=i?7.2:9;
      if(Math.abs(cross)>=LIMIT) apply(cross,width,-Infinity,Infinity);
      else {
        apply(cross,width,-Infinity,-LIMIT);
        apply(cross,width,LIMIT,Infinity);
      }
    }
    apply(-LIMIT,7.2,-LIMIT,LIMIT);
    apply(LIMIT,7.2,-LIMIT,LIMIT);
  }
  return raster.caps;
}

const tileHeightCache=new WeakMap();
// Terrain heights for a tile are needed by both its mesh and its road verges, so keep the last few.
function terrainTileHeights(world,column,row,segments) {
  let cache=tileHeightCache.get(world);
  if(!cache)tileHeightCache.set(world,cache=new Map());
  const key=column+':'+row+':'+segments;
  if(cache.has(key)){const hit=cache.get(key);cache.delete(key);cache.set(key,hit);return hit;}
  const made=computeTileHeights(world,column,row,segments);
  cache.set(key,made);
  if(cache.size>24)cache.delete(cache.keys().next().value);
  return made;
}
function computeTileHeights(world,column,row,segments) {
  const regional=regionalClearance(world,segments), streamed=streamedClearance(world,column,row,segments);
  const cutHeight=(u,v)=>Math.min(regional.get(u+':'+v)??Infinity,streamed.get(u+':'+v)??Infinity);
  const spacing=TERRAIN_SIZE/segments;
  const terrainAt=(u,v)=>Math.min(world.height(-TERRAIN_EXTENT+u*spacing,-TERRAIN_EXTENT+v*spacing),cutHeight(u,v));
  return {cutHeight,terrainAt,spacing};
}

export function terrainSurfaceSampler(world,segments=62) {
  const tiles=new Map();
  return (x,z)=>{
    const gx=(x+TERRAIN_EXTENT)/TERRAIN_SIZE, gz=(z+TERRAIN_EXTENT)/TERRAIN_SIZE;
    const column=Math.floor(gx),row=Math.floor(gz), key=column+':'+row;
    let tile=tiles.get(key);
    if(!tile)tiles.set(key,tile={terrainAt:terrainTileHeights(world,column,row,segments).terrainAt,heights:new Map()});
    // Grid heights are reused by many nearby samples, so each is worked out once per tile.
    const u=Math.floor(gx*segments),v=Math.floor(gz*segments);
    const at=(i,j)=>{
      const id=i*100003+j;
      let y=tile.heights.get(id);
      if(y===undefined)tile.heights.set(id,y=tile.terrainAt(i,j));
      return y;
    };
    const f=gx*segments-u,g=gz*segments-v;
    return f+g<=1 ? (1-f-g)*at(u,v)+f*at(u+1,v)+g*at(u,v+1) :
      (f+g-1)*at(u+1,v+1)+(1-g)*at(u+1,v)+(1-f)*at(u,v+1);
  };
}

const paintColor=new T.Color(), paintStone=new T.Color(0x888274), paintSnow=new T.Color(0xc6c4b8);
function terrainPaint(world,x,z,y,dx,dz) {
  const rock=Math.max(0,Math.min(1,(y-95)/150 + (Math.hypot(dx,dz)-.38)*.82));
  const fields=Math.sin(x*.024)*Math.cos(z*.019);
  const broad=Math.sin(x/135+z/170), cover=world.land(x,z);
  paintColor.setHSL(.217+broad*.022,.32+fields*.09,.36+fields*.025);
  paintColor.lerp(paintStone,rock);
  paintColor.lerp(paintSnow,Math.max(0,Math.min(.8,(y-355)/140))*(1-Math.min(.75,Math.hypot(dx,dz))));
  return {rock,farmland:Number(cover===1)*(1-rock),wood:Number(cover===2),color:[paintColor.r,paintColor.g,paintColor.b]};
}

// Height, colour and normal of the coarse terrain mesh at any point, exactly as it is drawn.
export function terrainPaintSampler(world,segments=62) {
  const tiles=new Map(), cache=new Map(), spacing=TERRAIN_SIZE/segments;
  const vertex=(u,v)=>{
    const key=u*100003+v;
    let item=cache.get(key);
    if(item)return item;
    const column=Math.floor(u/segments),row=Math.floor(v/segments),id=column+':'+row;
    if(!tiles.has(id))tiles.set(id,terrainTileHeights(world,column,row,segments));
    const {cutHeight,terrainAt}=tiles.get(id);
    const x=-TERRAIN_EXTENT+u*spacing,z=-TERRAIN_EXTENT+v*spacing,y=terrainAt(u,v),capped=Number.isFinite(cutHeight(u,v));
    const dx=capped?(terrainAt(u+1,v)-terrainAt(u-1,v))/(2*spacing):(world.height(x+1,z)-world.height(x-1,z))/2;
    const dz=capped?(terrainAt(u,v+1)-terrainAt(u,v-1))/(2*spacing):(world.height(x,z+1)-world.height(x,z-1))/2;
    item={y,dx,dz,...terrainPaint(world,x,z,y,dx,dz)};
    cache.set(key,item);
    return item;
  };
  return (x,z)=>{
    const gx=(x+TERRAIN_EXTENT)/spacing,gz=(z+TERRAIN_EXTENT)/spacing,u=Math.floor(gx),v=Math.floor(gz),f=gx-u,g=gz-v;
    const [a,b,c,wa,wb,wc]=f+g<=1?[vertex(u,v),vertex(u+1,v),vertex(u,v+1),1-f-g,f,g]:
      [vertex(u+1,v+1),vertex(u+1,v),vertex(u,v+1),f+g-1,1-g,1-f];
    const mix=key=>a[key]*wa+b[key]*wb+c[key]*wc;
    return {y:mix('y'),dx:mix('dx'),dz:mix('dz'),rock:mix('rock'),farmland:mix('farmland'),wood:mix('wood'),
      color:[0,1,2].map(i=>a.color[i]*wa+b.color[i]*wb+c.color[i]*wc)};
  };
}

export function terrainTile(world,column,row,material,segments=62) {
  const geometry=new T.PlaneGeometry(TERRAIN_SIZE,TERRAIN_SIZE,segments,segments);
  geometry.rotateX(-Math.PI/2);
  geometry.deleteAttribute('uv');
  const {cutHeight,terrainAt,spacing}=terrainTileHeights(world,column,row,segments);
  const positions=geometry.attributes.position;
  const normals=geometry.attributes.normal;
  const colors=new Float32Array(positions.count*3);
  const farmland=new Float32Array(positions.count), rockFace=new Float32Array(positions.count), woodlandCover=new Float32Array(positions.count);
  for(let i=0;i<positions.count;i++) {
    const u=column*segments+i%(segments+1), v=row*segments+Math.floor(i/(segments+1));
    const x=-TERRAIN_EXTENT+u*TERRAIN_SIZE/segments, z=-TERRAIN_EXTENT+v*TERRAIN_SIZE/segments;
    const capped=Number.isFinite(cutHeight(u,v));
    positions.setXYZ(i,x,terrainAt(u,v),z);
    const dx=capped?(terrainAt(u+1,v)-terrainAt(u-1,v))/(2*spacing):(world.height(x+1,z)-world.height(x-1,z))/2;
    const dz=capped?(terrainAt(u,v+1)-terrainAt(u,v-1))/(2*spacing):(world.height(x,z+1)-world.height(x,z-1))/2;
    const scale=1/Math.hypot(dx,1,dz);
    normals.setXYZ(i,-dx*scale,scale,-dz*scale);
    const paint=terrainPaint(world,x,z,positions.getY(i),dx,dz);
    rockFace[i]=paint.rock;
    farmland[i]=paint.farmland;
    woodlandCover[i]=paint.wood;
    colors.set(paint.color,i*3);
  }
  geometry.setAttribute('color',new T.BufferAttribute(colors,3));
  geometry.setAttribute('farmland',new T.BufferAttribute(farmland,1));
  geometry.setAttribute('rockFace',new T.BufferAttribute(rockFace,1));
  geometry.setAttribute('woodlandCover',new T.BufferAttribute(woodlandCover,1));
  const mesh=new T.Mesh(geometry,material);
  mesh.receiveShadow=true;
  mesh.userData.renderCategory='terrain';
  mesh.userData.renderTile='terrain:'+column+':'+row;
  return mesh;
}

function terrain(world) {
  const group=new T.Group();
  const material=surface(0xffffff,{vertexColors:true,pattern:'meadow'});
  for(let row=0;row<6;row++) for(let column=0;column<6;column++)
    group.add(terrainTile(world,column,row,material));
  return group;
}

function roads(world) {
  const group = new T.Group();
  const layers = [
    { width: 12.4, lift: 0.10, color: 0xa39777, pattern: 'cobbles' },
    { width: 2.55, offset: 6.15, lift: 0.22, color: 0xc9bdad, pattern: 'cobbles', sidewalk: true },
    { width: 2.55, offset: -6.15, lift: 0.22, color: 0xc9bdad, pattern: 'cobbles', sidewalk: true },
    { width:.25, offset: ROAD_WIDTH/2+.25, lift:.225, color:0xc1beb4, pattern:'concrete', sidewalk:true, kerb:true },
    { width:.25, offset:-ROAD_WIDTH/2-.25, lift:.225, color:0xc1beb4, pattern:'concrete', sidewalk:true, kerb:true },
    { width: ROAD_WIDTH, lift: 0.16, color: 0x55585b, pattern: 'asphalt' },
    { width: 0.13, lift: 0.20, color: 0xf3eac9, offset: ROAD_WIDTH / 2 - 0.45 },
    { width: 0.13, lift: 0.20, color: 0xf3eac9, offset: -ROAD_WIDTH / 2 + 0.45 },
    { width: 0.17, lift: 0.21, color: 0xf3eac9, dashed: true },
    { width:.16,lift:.213,color:0xf3eddf,highway:true,dashed:true,terminal:true },
    ...[-1,1].flatMap(side=>[
      { width:.16,lift:.213,color:0xf3eddf,highway:true,side,lane:0 },
      { width:.15,lift:.213,color:0xf3eddf,highway:true,side,lane:1,dashed:true },
      { width:.15,lift:.213,color:0xf3eddf,highway:true,side,lane:2,dashed:true,minLanes:3 },
      { width:.20,lift:.213,color:0xf3eddf,highway:true,side,shoulder:true },
    ]),
  ];
  for (const layer of layers) {
    const vertices = [];
    for (const road of world.roads) {
      const { alongX, cross: center, start, end, width } = road;
      if(layer.highway&&!road.highway||road.highway&&!layer.highway&&layer.pattern!=='asphalt') continue;
      if(layer.minLanes&&road.lanes<layer.minLanes)continue;
      const offset=layer.terminal?0:layer.highway?layer.side*(layer.shoulder?width*.5-road.outerShoulder:
        road.innerShoulder+layer.lane*road.laneWidth):
        (layer.offset||0)+Math.sign(layer.offset||0)*(width-ROAD_WIDTH)/2;
      const vertex = (along, fraction) => {
        const localWidth=world.motorwayWidth(road,along);
        const scale=localWidth/width;
        // Ordinary roads wander: the asphalt edges and the kerbs, pavements and
        // edge lines beside them move together, so nothing runs ruled-straight.
        const wobble=edgeOffset(world,road.alongX,center,along);
        const extra=(layer.shoulder?layer.side*(localWidth*.5-.45-(road.outerShoulder-.45)*scale):
          offset*(road.highway?scale:1)) + (!road.highway && !layer.shoulder && offset ? Math.sign(offset)*wobble*.5 : 0);
        const edgeSway=!road.highway && !layer.highway && layer.pattern==='asphalt' ? fraction*wobble : 0;
        const cross = center + extra + edgeSway + fraction*(layer.width>7?layer.width+localWidth-ROAD_WIDTH:layer.width);
        const [x, z] = alongX ? world.point(along, cross) : world.point(cross, along);
        const bevel=layer.kerb&&fraction*offset<0?.067:0;
        return [x, world.roadDeck(road,alongX?along:cross,alongX?cross:along,x,z) +
          layer.lift-bevel + (alongX ? 0 : .012) + (road.highway && layer.pattern==='asphalt' ? .016 : 0), z];
      };
      const junctions = world.roads.filter(other => other.alongX !== alongX &&
        other.spans.some(([a,b])=>center>=a&&center<=b) &&
        !world.overpasses.some(bridge=>bridge.road===road&&bridge.motorway===other||
          bridge.motorway===road&&bridge.road===other));
      for(const [start,end] of road.spans) for (let s = start; s < end; s += 5) {
        const midpoint = (s + Math.min(s+5,end))/2;
        const remaining=Math.min(midpoint-road.start,road.end-midpoint);
        const taper=road.tapers?.[midpoint-road.start<road.end-midpoint?0:1]??0;
        if(layer.terminal&&remaining>taper*.35)continue;
        if(layer.highway&&!layer.terminal&&!layer.shoulder&&remaining<taper*(layer.lane===2?.82:layer.lane===1?.60:.35))continue;
        const mid=alongX?world.point(midpoint,center):world.point(center,midpoint);
        if((layer.sidewalk||layer.lift===.10) && world.riverEdge(...mid)<7) continue;
        if (layer.sidewalk && !world.towns.some(town => (alongX ? town.v : town.u) === center &&
            Math.abs(midpoint - (alongX ? town.u : town.v)) < town.radius)) continue;
        if (layer.lift >= 0.20 && junctions.some(junction => Math.abs(midpoint - junction.cross) < junction.width/2+8.5)) continue;
        if (layer.dashed && Math.round((s - start) / 5) % (road.highway?4:3) !== 0) continue;
        if(layer.shoulder){
          const u=alongX?midpoint:center+offset,v=alongX?center+offset:midpoint;
          if((world.nearestStreet(u,v)?.edge??Infinity)<.4) continue;
        }
        const bands = layer.pattern === 'asphalt' ? Math.ceil(width/2.5) : 1;
        for(let band=0;band<bands;band++){
          const left=band/bands-.5, right=(band+1)/bands-.5;
          const a=vertex(s,left), b=vertex(s,right);
          const c=vertex(Math.min(s+5,end),left), d=vertex(Math.min(s+5,end),right);
          if(alongX)vertices.push(...a,...b,...c,...b,...d,...c);
          else vertices.push(...a,...c,...b,...b,...c,...d);
        }
      }
    }
    if (layer.pattern === 'asphalt' && !layer.highway) {
      const plain = world.roads.filter(road => !road.highway).map(road => ({
        alongX: road.alongX, cross: road.cross, width: road.width, ranges: road.spans}));
      const circles = world.roundabouts;
      const fillets = junctionFillets(plain.filter(r => r.alongX), plain.filter(r => !r.alongX), {
        radius: 7,
        skip: (u, v) => circles.some(circle => Math.abs(circle.u - u) < 1 && Math.abs(circle.v - v) < 1) ||
          world.overpasses.some(bridge => Math.abs(bridge.road.cross - u) < 1 || Math.abs(bridge.road.cross - v) < 1),
      });
      vertices.push(...fillTriangles(fillets, world, layer.lift + .004));
    }
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute(vertices, 3));
    geometry.computeVertexNormals();
    const mesh = new T.Mesh(geometry, surface(layer.color, { pattern: layer.pattern || 'markings' }));
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  const drains=[], slots=[];
  for(const road of world.roads){
    if(road.highway)continue;
    const at=(along,offset)=>road.alongX?world.point(along,road.cross+offset):world.point(road.cross+offset,along);
    for(const [start,end] of road.spans)for(let along=start+18;along<end-18;along+=31){
      if(!world.towns.some(town=>(road.alongX?town.v:town.u)===road.cross&&
        Math.abs(along-(road.alongX?town.u:town.v))<town.radius))continue;
      for(const side of [-1,1]){
        const off=side*(road.width/2-.31),[x,z]=at(along,off),[a,b]=at(along+1,off);
        if(world.riverEdge(x,z)<6)continue;
        const yaw=Math.atan2(a-x,b-z),y=world.roadHeight(x,z)+(road.alongX?.175:.187);
        drains.push([x,y,z,.37,.018,.49,yaw,0x323638]);
        for(let i=-2;i<=2;i++){
          const dx=Math.sin(yaw)*i*.079,dz=Math.cos(yaw)*i*.079;
          slots.push([x+dx,y+.012,z+dz,.33,.013,.024,yaw,0x75726a]);
        }
      }
    }
  }
  const detailBox=new T.BoxGeometry();
  if(drains.length)group.add(instances(detailBox,drains,surface(0xffffff,{roughness:.76}),false),
    instances(detailBox,slots,surface(0xffffff,{metalness:.42,roughness:.43}),false));
  const verges=[];
  for(const road of world.roads){
    if(road.highway)continue;
    for(const [start,end] of road.spans) verges.push({alongX:road.alongX,cross:road.cross,width:road.width,s:start,n:end});
  }
  const sampler=terrainSurfaceSampler(world);
  group.add(vergeMesh(world,verges,vergeMaterial(),sampler,(x,z)=>world.riverEdge(x,z)<7).mesh);
  return group;
}

function urbanStreets(world) {
  const group = new T.Group();
  const layers = [
    { sidewalk: true, lift: .226, pattern: 'concrete', color: 0xaba69c },
    { lift: .170, pattern: 'asphalt', color: 0x55585b, type: 7 },
    { lift: .164, pattern: 'cobbles', color: 0x847871, type: 8 },
    { lift: .161, pattern: 'gravel', color: 0xa99a82, type: 9 },
  ];
  for (const layer of layers) {
    const vertices = [];
    for (const street of world.streets) {
      if(street.ramp) continue;
      if ((layer.type && layer.type !== street.surface) || (layer.sidewalk && !street.urban)) continue;
      for (const side of layer.sidewalk ? [-1,1] : [0]) {
        const half = street.width/2;
        const offsets=side < 0 ? [-half-1.8,-half] : side > 0 ? [half,half+1.8] : [-half,half];
        const outline = street.points.map((point,i,points)=>{
          const closed=points[0]===points.at(-1);
          const previous=points[i-1] || (closed?points.at(-2):point);
          const next=points[i+1] || (closed?points[1]:point);
          const du=next[0]-previous[0],dv=next[1]-previous[1], length=Math.hypot(du,dv);
          return offsets.map(offset=>{
            const [x,z]=world.point(point[0]-dv*offset/length,point[1]+du*offset/length);
            return [x,world.roadHeight(x,z)+layer.lift,z];
          });
        });
        for (let i=1;i<outline.length;i++) {
          const [u,v]=street.points[i-1], [U,V]=street.points[i];
          if (world.highwayAt((u+U)/2,(v+V)/2,layer.sidewalk?2:0)) continue;
          if (layer.sidewalk && (world.roadDistance((u+U)/2,(v+V)/2,true,false)<3 ||
            world.riverEdge(...world.point((u+U)/2,(v+V)/2))<7)) continue;
          const [a,b]=outline[i-1], [c,d]=outline[i];
          if(layer.sidewalk && [0,.5,1].some(t=>{
            const x=((a[0]+b[0])*(1-t)+(c[0]+d[0])*t)/2;
            const z=((a[2]+b[2])*(1-t)+(c[2]+d[2])*t)/2;
            return (world.nearestStreet(...world.grid(x,z),street)?.edge??Infinity)<.8;
          })) continue;
          // Preserve the outline while adding enough samples to follow crests
          // and dips between the original street knots.
          const length=Math.max(Math.hypot(c[0]-a[0],c[2]-a[2]),Math.hypot(d[0]-b[0],d[2]-b[2]));
          const steps=Math.max(1,Math.ceil(length/3));
          const bands=layer.sidewalk?1:2;
          const sample=(along,across)=>{
            const x=T.MathUtils.lerp(T.MathUtils.lerp(a[0],b[0],across),T.MathUtils.lerp(c[0],d[0],across),along);
            const z=T.MathUtils.lerp(T.MathUtils.lerp(a[2],b[2],across),T.MathUtils.lerp(c[2],d[2],across),along);
            return [x,world.roadHeight(x,z)+layer.lift,z];
          };
          for(let band=0;band<bands;band++){
            const left=band/bands,right=(band+1)/bands;
            let p=sample(0,left),q=sample(0,right);
            for(let step=1;step<=steps;step++){
              const r=sample(step/steps,left),s=sample(step/steps,right);
              vertices.push(...p,...q,...r,...q,...s,...r);
              p=r;q=s;
            }
          }
        }
      }
    }
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute(vertices,3));
    geometry.computeVertexNormals();
    const mesh = new T.Mesh(geometry, surface(layer.color, {
      pattern: layer.pattern, side: T.DoubleSide,
    }));
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}

// Stable pseudo-random value for a vertex position, so faces sharing a corner stay joined.
function vertexNoise(x,y,z,variant) {
  const value=Math.sin(x*127.1+y*311.7+z*74.7+variant*53.3)*43758.5453;
  return value-Math.floor(value);
}

// A unit wall block whose faces are slightly out of true: walls settle, lean and bow inward.
export function houseShell(variant=0) {
  const shell=new T.BoxGeometry(1,1,1,3,2,3), position=shell.attributes.position;
  const leanX=(vertexNoise(1,2,3,variant)-.5)*.016, leanZ=(vertexNoise(4,5,6,variant)-.5)*.016;
  for(let i=0;i<position.count;i++){
    const x=position.getX(i),y=position.getY(i),z=position.getZ(i);
    const key=[Math.round(x*6),Math.round(y*4),Math.round(z*6)];
    const bow=1-.018*vertexNoise(...key,variant), rise=y+.5;
    position.setXYZ(i,x*bow+leanX*rise*Math.abs(x)*2-Math.sign(x)*Math.abs(leanX)*rise,
      y+(y>.4?(vertexNoise(...key,variant+7)-.5)*.018:0),
      z*bow+leanZ*rise*Math.abs(z)*2-Math.sign(z)*Math.abs(leanZ)*rise);
  }
  shell.computeVertexNormals();
  return shell;
}

// Roofs in three builds: a sagging gable, a half-hipped roof and an off-centre ridge.
export function roofShape(kind=0) {
  const steps=7, vertices=[], ridgeZ=kind===2?.13:0, hip=kind===1?.17:0;
  const wave=(t,seed,size)=>Math.sin(t*9.1+seed)*size+Math.sin(t*23.7+seed*2.3)*size*.45;
  const ridge=t=>{
    const x=-.5+hip+t*(1-hip*2);
    return [x,1-.075*Math.sin(t*Math.PI)+wave(t,kind+1,.012),ridgeZ+wave(t,kind+4,.008)];
  };
  const eave=(t,side)=>[-.5+t,wave(t,kind+side*2,.012),side*(.5+wave(t,kind+side*5,.007))];
  const face=(a,b,c)=>vertices.push(...a,...b,...c);
  for(let i=0;i<steps;i++){
    const t=i/steps,u=(i+1)/steps;
    face(eave(t,-1),ridge(t),eave(u,-1));face(eave(u,-1),ridge(t),ridge(u));
    face(eave(t,1),eave(u,1),ridge(t));face(eave(u,1),ridge(u),ridge(t));
  }
  for(const [t,flip] of [[0,false],[1,true]]){
    const top=ridge(t), a=eave(t,-1), b=eave(t,1);
    if(flip)face(a,top,b);else face(a,b,top);
  }
  const roof=new T.BufferGeometry();
  roof.setAttribute('position',new T.Float32BufferAttribute(vertices,3));
  roof.computeVertexNormals();
  return roof;
}

export function instances(geometry, records, material, castsShadow = true) {
  const mesh = new T.InstancedMesh(geometry, material, records.length);
  mesh.castShadow = castsShadow;
  mesh.receiveShadow = true;
  const transform = new T.Object3D();
  const color = new T.Color();
  records.forEach(([x, y, z, sx, sy, sz, rotation, tint, tilt=0], index) => {
    transform.position.set(x, y, z);
    transform.scale.set(sx, sy, sz);
    transform.rotation.set(0,rotation,tilt,'YXZ');
    transform.updateMatrix();
    mesh.setMatrixAt(index, transform.matrix);
    mesh.setColorAt(index, color.set(tint));
  });
  mesh.computeBoundingSphere();
  return mesh;
}

function motorwayFurniture(world,group) {
  const barriers=[], positions=[], indices=[], reflectors=[];
  const section=[[-.26,0],[-.26,.11],[-.14,.43],[-.115,.52],[.115,.52],[.14,.43],[.26,.11],[.26,0]];
  const cap=(ring,reverse)=>{
    for(let i=1;i<section.length-1;i++){
      if(reverse)indices.push(ring,ring+i+1,ring+i);
      else indices.push(ring,ring+i,ring+i+1);
    }
  };
  for(const road of world.highways){
    const {alongX,cross,start,end}=road;
    const at=(along,offset=0)=>alongX?world.point(along,cross+offset):world.point(cross+offset,along);
    const intersections=world.roads.filter(other=>other.alongX!==alongX&&other.spans.some(([a,b])=>cross>=a&&cross<=b)&&
      !world.overpasses.some(bridge=>bridge.motorway===road&&bridge.road===other));
    let previous=null;
    for(let along=start+20;along<=end-20;along+=3){
      if(along-road.start<road.tapers[0]*.35||road.end-along<road.tapers[1]*.35||
        intersections.some(other=>Math.abs(along-other.cross)<other.width/2+20)){
        if(previous)cap(previous.ring,false);
        previous=null;
        continue;
      }
      const [x,z]=at(along), [ax,az]=at(along+1), [bx,bz]=at(along-1);
      const dx=ax-bx,dz=az-bz,len=Math.hypot(dx,dz)||1;
      const y=world.roadHeight(x,z)+.16;
      const ring=positions.length/3;
      for(const [side,height] of section)positions.push(x+side*dz/len,y+height,z-side*dx/len);
      if(previous){
        const n=section.length;
        for(let k=1;k<=n;k++){
          const j=k%n, i=k-1;
          indices.push(previous.ring+i,ring+i,previous.ring+j,previous.ring+j,ring+i,ring+j);
        }
        barriers.push([previous.x,previous.z,x,z,Math.min(previous.y,y)-.10,Math.max(previous.y,y)+.52]);
      } else cap(ring,true);
      if(Math.round((along-start-20)/3)%4===0)
        reflectors.push([x,y+.55,z,.10,.12,.15,Math.atan2(dx,dz),0xe0d7b3]);
      previous={x,y,z,ring};
    }
    if(previous)cap(previous.ring,false);
  }
  if(indices.length){
    const geometry=new T.BufferGeometry();
    geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const median=new T.Mesh(geometry,surface(0x8b8c85,{pattern:'concrete',side:T.DoubleSide}));
    median.receiveShadow=true; median.castShadow=true;
    group.add(median);
  }
  if(reflectors.length) group.add(instances(new T.BoxGeometry(),reflectors,
    surface(0xffffff,{emissive:0x8c7742,emissiveIntensity:.12}),false));
  return barriers;
}

export function batchInstances(group, geometry, material, records, size, castsShadow, category) {
  const cells = new Map();
  for (const record of records) {
    const [x, , z] = record;
    const key = `${Math.floor(x / size)},${Math.floor(z / size)}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(record);
  }
  const batches = [];
  for (const [cell,records] of cells) {
    const mesh = instances(geometry, records, material, castsShadow);
    records.forEach((record,index)=>{record.instance=[mesh,index];});
    mesh.userData.renderCategory=category;
    mesh.userData.renderTile=category+':'+size+':'+cell;
    group.add(mesh);
    batches.push(mesh);
  }
  return batches;
}

export function buildScenery(world) {
  const group = new T.Group();
  const landscape=terrain(world), regionalRoads=roads(world), streets=urbanStreets(world);
  regionalRoads.userData.renderCategory=streets.userData.renderCategory='roads';
  group.add(landscape,regionalRoads,streets);
  const roadBarriers=motorwayFurniture(world,group);
  const rng = random(world.seed ^ 0x643e1);
  const houses = [], roofs = [], doors = [], quoins=[], ruins=[], boards=[], chimneys=[], grasses = [], obstacles = [], brick = [], lamps = [], lanterns = [], panes = [];
  const railings=[], pipework=[], annexWalls=[];
  const walls = [0xf3dcad, 0xd0bb9e, 0xefdfc8, 0xe2bb96, 0xd9c7a3, 0xc9b79c, 0xe8d3b8];
  const aged=new T.Color(), weather=(color,spread=.07)=>{
    aged.set(color).offsetHSL((rng()-.5)*.018,(rng()-.5)*.08,(rng()-.62)*spread);
    return aged.getHex();
  };
  const roofing = [0x724437, 0xa3583e, 0x555257];
  const occupied=new Map();
  function lot(u,v,du,dv,side,roadWidth,floors,urban) {
    const [px,pz]=world.point(u,v);
    const [ax,az]=world.point(u+du,v+dv);
    const length=Math.hypot(ax-px,az-pz);
    const roadX=(ax-px)/length, roadZ=(az-pz)/length;
    const angle=(rng()-.5)*(urban?.105:.29);
    const tx=roadX*Math.cos(angle)-roadZ*Math.sin(angle), tz=roadZ*Math.cos(angle)+roadX*Math.sin(angle);
    const nx=-tz, nz=tx;
    const width=8.5+rng()*5.4, depth=7.6+rng()*6.4;
    const roughSetback = urban ? 1.95 + rng()*.7 : 3.7 + rng()*2.6;
    const setback=roadWidth/2+depth/2+roughSetback;
    const x=px-roadZ*side*setback,z=pz+roadX*side*setback;
    const rotation=Math.atan2(-tz,tx);
    const local=(along,across)=>[x+tx*along+nx*across,z+tz*along+nz*across];
    const corners=[local(-width/2,-depth/2),local(width/2,-depth/2),
      local(width/2,depth/2),local(-width/2,depth/2)];
    if(world.land(x,z)>=3||corners.some(point=>world.land(...point)>=3)||
      world.roadCutsFootprint(x,z,tx,tz,width/2,depth/2))return;
    const column=Math.floor(x/14),row=Math.floor(z/14);
    for(let dx=-1;dx<=1;dx++) for(let dz=-1;dz<=1;dz++){
      const block=occupied.get((column+dx)+':'+(row+dz));
      if(block?.some(other=>Math.hypot(other.x-x,other.z-z)<9.3)) return;
    }
    const y=world.height(x,z);
    const floorHeight=2.72+rng()*.66;
    const height=floors*floorHeight+.24;
    const abandoned=rng()<(urban?.08:.17);
    const baked=rng()<.27;
    const detailed=abandoned||baked||rng()<.4;
    const tint=weather(walls[rng()*walls.length|0]);
    const wall=[x,y+height/2-.72,z,width,height+1.44,depth,rotation,tint];
    if(abandoned){wall[7]=0xaaa08d;ruins.push(wall);}
    else if(baked){ wall[7]=[0x965139,0xa46943,0x9e644d][rng()*3|0];brick.push(wall); }
    else houses.push(wall);
    const flat=urban && floors>3 && rng()<(floors>=8?.85:.26);
    const roofTint=abandoned?roofing[2]:roofing[rng()*roofing.length|0];
    if (!flat) roofs.push([x,y+height-.04,z,width+.45+rng()*.75,1.15+rng()*2.55,depth+.5+rng()*.7,rotation,
      roofTint===roofing[2]?roofTint:weather(roofTint,.1)]);
    if(!flat && rng()<.72){
      const [px,pz]=local(width*(rng()-.5)*.6,(rng()-.5)*depth*.48);
      chimneys.push([px,y+height+1.23,pz,.54+rng()*.38,2.5,.58,rotation,weather(0x886453),(rng()-.5)*.05]);
      chimneys.push([px,y+height+2.53,pz,.78,.16,.72,rotation,0x645d50]);
    }
    const front=-side*depth/2;
    // Lean-to built on over the years, at the back of the plot.
    if(!flat&&floors<4&&rng()<.62){
      const wide=3.2+rng()*Math.min(3.4,width-4), deep=2.3+rng()*2, high=2.3+rng()*.8;
      const along=(rng()-.5)*(width-wide), back=side*(depth/2+deep/2-.08);
      const [ax,az]=local(along,back);
      const outline=[local(along-wide/2,back-deep/2),local(along+wide/2,back-deep/2),
        local(along+wide/2,back+deep/2),local(along-wide/2,back+deep/2)];
      const free=outline.every(point=>world.land(...point)<3)&&
        !world.roadCutsFootprint(ax,az,tx,tz,wide/2,deep/2);
      const crowded=[...occupied.values()].length&&[-1,0,1].some(i=>[-1,0,1].some(j=>
        occupied.get((Math.floor(ax/14)+i)+':'+(Math.floor(az/14)+j))?.some(other=>
          Math.hypot(other.x-ax,other.z-az)<other.halfX+other.halfZ*.5+wide*.5)));
      if(free&&!crowded){
        const shade=weather(wall[7],.12), ground=world.height(ax,az);
        (baked?brick:abandoned?ruins:houses).push([ax,ground+high/2-.5,az,wide,high+1,deep,rotation,shade]);
        roofs.push([ax,ground+high-.03,az,wide+.32,.42+rng()*.42,deep+.34,rotation,weather(roofTint,.12)]);
        outline.forEach((point,i)=>annexWalls.push([...point,...outline[(i+1)%4]]));
      }
    }
    // Damp, repairs and rain marks break up the plain plaster.
    for(let mark=0,marks=1+Math.floor(rng()*4);mark<marks;mark++){
      const w=.5+rng()*2.6, h=.35+rng()*Math.min(2,height*.4);
      const [mx,mz]=local((rng()-.5)*(width-w),front-side*.018);
      quoins.push([mx,y+(rng()<.5?h/2+.05:.6+rng()*(height-1.4)),mz,w,h,.03,rotation,weather(wall[7],.2)]);
    }
    function facade(along,elevation,w,h,relief,color,batch=doors,tilt=0) {
      const [px,pz]=local(along,front-side*relief/2);
      batch.push([px,y+elevation,pz,w,h,relief,rotation,color,tilt]);
    }
    const columns=width>11.45?[-.34,-.115,.115,.34]:[-.32,0,.32];
    const porchColor=abandoned?0x7c7468:baked?0xb7aa90:0xdbccae;
    const detail=random(cellSeed(world.seed^0x5892,Math.round(x*4),Math.round(z*4)));
    const hasBalconies=!abandoned&&urban&&floors>=3&&detail()<.46;
    const hasSideWindows=!abandoned&&floors>=2&&detail()<.65;
    const pipeSide=detail()<.5?-1:1;
    const pipeX=pipeSide*(width*.455);
    facade(pipeX,height*.50,.072,height,.21,abandoned?0x615246:0x575853,pipework);
    facade(pipeX,.35,.084,.18,.28,0x494e48,pipework);
    if(detailed){
      for(let row=0;row<Math.ceil(height/.48);row++) for(const side of [-1,1]){
        const wide=(row+Number(side>0))%2===0;
        facade(side*(width/2-(wide?.21:.13)),row*.48+.06,wide?.55:.38,.41,.15,
          row%3===0?0x948577:0xa99b87,quoins);
      }
      facade(0,.24,width+.15,.48,.23,0x918679,quoins);
    }
    for (let floor=0;floor<floors;floor++) {
      const level=floor*floorHeight+1.66;
      for (const column of columns) {
        if (floor===0 && column===0) continue;
        // Hand-built: no two windows line up exactly or share one size.
        const w=width*column+(detail()-.5)*.42, center=level+(detail()-.5)*.2, tall=.9+detail()*.2;
        for(const edge of [-1,1])facade(w+edge*.68,center,.16,1.85*tall,.29,porchColor,quoins,(detail()-.5)*.014);
        facade(w,center+.85*tall,1.50,.146,.32,porchColor,quoins,(detail()-.5)*.03);
        facade(w,center-.83*tall,1.54,.16,.39,porchColor,quoins,(detail()-.5)*.03);
        if(abandoned){
          facade(w,center,1.2,1.62,.13,0x403d37);
          if(rng()<.76) for(let row=-1;row<=1;row++) facade(w,center+row*.49,1.29,.24,.22,
            row===0?0x756251:0x8c7860,boards,(rng()-.52)*.26);
        } else {
          facade(w,center,1.20,1.60*tall,.069,0xffffff,panes);
          facade(w,center,.053,1.60*tall,.127,0x817564,pipework);
          if(detailed && column!==0){
            const closed=detail()<.2, paint=weather(baked?0x728176:[0x756357,0x5f7468,0x7a5a48,0x6a7480][Math.floor(detail()*4)],.14);
            for(const edge of [-1,1]) facade(w+edge*(closed?.3:.83),center,closed?.59:.28,1.46*tall,.21,
              paint,boards,edge*(.02+detail()*.04));
          }
          if(hasBalconies&&floor>0&&floor%2===1&&(Math.abs(column)<.2||floors<5)){
            facade(w,center-.78,1.91,.155,.67,porchColor,quoins);
            const ledge=(along,elevation,sw,sh,sd)=>{
              const [px,pz]=local(along,front-side*.62);
              railings.push([px,y+elevation,pz,sw,sh,sd,rotation,0x454843]);
            };
            ledge(w,center-.20,1.77,.062,.053);
            for(let j=-3;j<=3;j++)ledge(w+j*.263,center-.46,.031,.53,.039);
          }
        }
      }
      if(hasSideWindows&&floor>0)for(const flank of [-1,1])for(const depthOffset of [-.26,.25]){
        const [px,pz]=local(flank*(width/2+.04),depth*depthOffset);
        panes.push([px,y+level,pz,.86,1.40,.105,rotation+Math.PI*.5,0xf2eee0]);
      }
    }
    facade(0,1.13,1.45,2.3,.19,0x53423c);
    facade(0,height-.22,width,.26,.34,abandoned?0xa2947c:0xded0b7,quoins);
    const [sx,sz]=local(0,front-side*.36);
    quoins.push([sx,y+.095,sz,1.8,.19,.68,rotation,0x9e9280]);
    const entry=local(0,front-side*.32);
    const building={x,z,halfX:width/2,halfZ:depth/2,corners,entry:abandoned?null:entry,front:[-side*nx,-side*nz],rotation, floors,
      kind:abandoned?"ruin":baked?"brick":"house", roof:flat?"flat":"pitched"};
    obstacles.push(building);
    const bucket=column+':'+row;
    if(!occupied.has(bucket)) occupied.set(bucket,[]);
    occupied.get(bucket).push(building);
  }

  for (const town of world.towns) {
    for (const alongX of [true,false]) {
      const origin=alongX?town.u:town.v;
      const road=world.roads.find(road=>road.alongX===alongX && road.cross===(alongX?town.v:town.u) &&
        origin>=road.start&&origin<=road.end);
      if(!road) continue;
      const frontage=Math.min(245,town.radius-6);
      for (let location=-Math.floor(frontage/14)*14+3;location<frontage;location+=14) {
        if (Math.abs(location)<16 || origin+location<road.start || origin+location>road.end || rng()<.08) continue;
        const core=town.tier==='hub' && Math.abs(location)<frontage*.75;
        for (const side of [-1,1]) {
          const floors=core?town.floors-Math.floor(rng()*3):1+Math.floor(rng()*town.floors);
          const taller=core&&world.urbanDensity>1.25&&rng()<.22?3+Math.floor(rng()*5):0;
          lot(town.u+(alongX?location:0),town.v+(alongX?0:location),alongX?1:0,alongX?0:1,
            side,road.width,floors+taller,town.tier==='hub');
        }
      }
    }
  }

  for (const street of world.streets.filter(road=>road.urban)) {
    let distance=0,nextLot=9,nextLamp=17;
    for (let i=1;i<street.points.length;i++) {
      const [u,v]=street.points[i-1], [U,V]=street.points[i];
      const length=Math.hypot(U-u,V-v);
      const du=(U-u)/length,dv=(V-v)/length;
      while (nextLot<distance+length) {
        const along=nextLot-distance;
        const r=Math.hypot(u-street.town.u,v-street.town.v);
        for (const side of [-1,1]) {
          if (rng()<.22/world.urbanDensity) continue;
          const extra=r<190&&world.urbanDensity>1.25&&rng()<.23?3+Math.floor(rng()*5):0;
          lot(u+along*du,v+along*dv,du,dv,side,street.width,2+Math.floor(rng()*(r<215?street.town.floors:4))+extra,true);
        }
        nextLot+=13+rng()*3;
      }
      while (nextLamp<distance+length) {
        const along=nextLamp-distance;
        const offset=(Math.round(nextLamp/28)%2?1:-1)*(street.width/2+1.2);
        const [x,z]=world.point(u+du*along-dv*offset,v+dv*along+du*offset);
        // Where streets meet, the offset can land on the next carriageway: no post there.
        const [lu,lv]=world.grid(x,z);
        if((world.nearestStreet(lu,lv)?.edge??9)>.45&&world.roadDistance(lu,lv,true)>.45){
          const y=world.height(x,z);
          lamps.push([x,y+1.94,z,.053,3.8,.053,0,0x474c49]);
          lanterns.push([x,y+3.88,z,.25,.23,.25,0,0xe1c793]);
        }
        nextLamp+=28;
      }
      distance+=length;
    }
  }
  for (const { alongX, cross: center, start, end, width } of world.roads) {
      for (let along = start; along < end; along += 2.7) {
        for (const side of [-1, 1]) {
          const cross = center + side * (Math.max(6.8,width*.5+1.15) + rng() * 7);
          const [u, v] = alongX ? [along, cross] : [cross, along];
          if (world.highwayAt(u,v,.7) || world.distanceToRoad(u, v) < 6.6 ||
              world.towns.some(town => Math.hypot(u - town.u, v - town.v) < town.radius)) continue;
          const [x, z] = world.point(u, v);
          if(world.land(x,z)>=3) continue;
          const height = .22 + rng() * .43;
          grasses.push([x, world.height(x, z) + height * .4, z, .32 + rng() * .46, height, .42,
            rng() * 6.28, [0x65764b, 0x778349, 0x889454, 0x617440][rng() * 4 | 0]]);
        }
      }
  }
  const roof = new T.BufferGeometry();
  const a = [-0.5, 0, -0.5], b = [0.5, 0, -0.5], c = [-0.5, 0, 0.5], d = [0.5, 0, 0.5];
  const e = [-0.5, 1, 0], f = [0.5, 1, 0];
  roof.setAttribute('position', new T.Float32BufferAttribute([
    ...a, ...e, ...b, ...b, ...e, ...f, ...e, ...c, ...f, ...f, ...c, ...d,
    ...a, ...c, ...e, ...b, ...f, ...d,
  ], 3));
  roof.computeVertexNormals();
  const blades = new T.BufferGeometry();
  const bladeVertices = [];
  for (const angle of [0, Math.PI / 3, 2 * Math.PI / 3]) {
    const x = Math.cos(angle), z = Math.sin(angle);
    for (const offset of [-.3, 0, .3]) {
      bladeVertices.push(x * (offset - .09), -.5, z * (offset - .09),
        x * (offset + .09), -.5, z * (offset + .09),
        x * offset * 1.65, .42 - Math.abs(offset) * .6, z * offset * 1.65);
    }
  }
  blades.setAttribute('position', new T.Float32BufferAttribute(bladeVertices, 3));
  blades.computeVertexNormals();
  const wallGeometry = new T.BoxGeometry();
  const shells=[houseShell(0),houseShell(1)], roofBuilds=[roof,roofShape(1),roofShape(2),roofShape(0)];
  const batches=(geometry,material,records,size,shadow,category)=>
    batchInstances(group,geometry,material,records,size,shadow,category);
  const structure=(geometry,material,records)=>
    batches(geometry,material,records,360,true,'buildings');
  const walled=(material,records)=>shells.forEach((shell,build)=>
    structure(shell,material,records.filter((_,i)=>i%shells.length===build)));
  const roofed=(material,records)=>roofBuilds.slice(1).forEach((shape,build)=>
    structure(shape,material,records.filter((_,i)=>i%3===build)));
  walled(surface(0xffffff,{pattern:'plaster'}),houses.filter((_,i)=>i%5!==0));
  walled(surface(0xffffff,{pattern:'sandstone'}),houses.filter((_,i)=>i%5===0));
  walled(surface(0xffffff,{pattern:'masonry'}),brick);
  walled(surface(0xffffff,{pattern:'derelict'}),ruins);
  roofed(surface(0xffffff,{pattern:'tiles'}),roofs.filter(record=>record[7]!==roofing[2]));
  roofed(surface(0xffffff,{pattern:'slate'}),roofs.filter(record=>record[7]===roofing[2]));
  const basicFacade=[
    ...batches(wallGeometry,surface(0xffffff),doors,160,false,'building façades'),
    ...batches(wallGeometry,windowSurface(),panes,160,false,'building façades'),
  ];
  const decoratedFacade=[
    ...batches(wallGeometry,surface(0xffffff,{pattern:'plaster'}),quoins,160,false,'building trim'),
    ...batches(wallGeometry,surface(0xffffff,{pattern:'masonry'}),chimneys,160,true,'building trim'),
    ...batches(wallGeometry,surface(0xffffff,{pattern:'bark'}),boards,160,false,'building trim'),
    ...batches(wallGeometry,surface(0xffffff,{roughness:.52,metalness:.26}),pipework,160,false,'building trim'),
    ...batches(wallGeometry,surface(0xffffff,{roughness:.43,metalness:.44}),railings,160,false,'building trim'),
  ];
  batches(new T.CylinderGeometry(1,1,1,7),surface(0xffffff),lamps,360,false,'street lights');
  batches(wallGeometry,surface(0xffffff,{emissive:0x856537,emissiveIntensity:.22}),lanterns,360,false,'street lights');
  const grassBatches=batches(blades,surface(0xffffff,{pattern:'grass',side:T.DoubleSide}),grasses,80,false,'grass');

  function updateDetail(x,z,lowDetail=false,aerial=false){
    const show=(meshes,distance)=>{
      for(const mesh of meshes){
        const {center,radius}=mesh.boundingSphere;
        mesh.visible=distance>0 && Math.hypot(x-center.x,z-center.z)<distance+radius;
      }
    };
    show(basicFacade,lowDetail?160:aerial?640:450);
    show(decoratedFacade,lowDetail?0:aerial?400:320);
    show(grassBatches,lowDetail||aerial?0:145);
  }
  const lampFixtures=lamps.map((post,index)=>({post,lantern:lanterns[index]}));
  return { group, obstacles, roadBarriers, annexWalls, lampFixtures, updateDetail, lampPosts:lamps.length };
}
