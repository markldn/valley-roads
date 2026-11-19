import * as T from '../vendor/three.module.js';
import { LIMIT, OUTER_SPACING, cellSeed, random } from './world.js';
import { junctionFillets, fillTriangles } from './fillets.js';
import { TERRAIN_EXTENT, TERRAIN_SIZE, houseShell, instances, roofShape, terrainSurfaceSampler, terrainTile } from './scenery.js';
import { bridges } from './landscape.js';
import { surface } from '../render/visuals.js';
import { edgeOffset, vergeMaterial, vergeSteps } from './verge.js';
import { pedestrianPose } from '../people/pedestrian.js';
import { walkingMeshes } from '../traffic/population.js';

const SAMPLE=5;
const hamletNames=['Bois de','Fontaine de','Les Prés de','Vaux de','Mont de','Le Moulin de'];
const hamletEnds=['Roche','la Rive','Bellecombe','Clairbois','Saint-Orme','Champvert','la Saulaie','la Lande'];
const keyFor=(column,row)=>column+':'+row;
const cellAt=value=>Math.floor((value+TERRAIN_EXTENT)/TERRAIN_SIZE);

function roadSegments(world,column,row) {
  const minX=column*TERRAIN_SIZE-TERRAIN_EXTENT;
  const minZ=row*TERRAIN_SIZE-TERRAIN_EXTENT;
  const result=[];
  for(const alongX of [true,false]){
    const min=alongX?minX:minZ, crossMin=alongX?minZ:minX;
    const first=Math.floor((crossMin-240)/OUTER_SPACING);
    const last=Math.ceil((crossMin+TERRAIN_SIZE+240)/OUTER_SPACING);
    const lines=[];
    for(let i=first;i<=last;i++) lines.push({cross:world.outerLine(i,alongX),width:i?7.2:9,ring:false});
    if(crossMin-160<LIMIT && crossMin+TERRAIN_SIZE+160>LIMIT) lines.push({cross:LIMIT,width:7.2,ring:true});
    if(crossMin-160<-LIMIT && crossMin+TERRAIN_SIZE+160>-LIMIT) lines.push({cross:-LIMIT,width:7.2,ring:true});
    for(const line of lines){
      const {cross,width,ring}=line;
      const ranges=ring?[[-LIMIT,LIMIT]]:Math.abs(cross)>=LIMIT?
        [[-Infinity,Infinity]]:[[-Infinity,-LIMIT],[LIMIT,Infinity]];
      for(const [start,end] of ranges){
        const lower=Math.max(start,Math.floor((min-140)/SAMPLE)*SAMPLE);
        const upper=Math.min(end,min+TERRAIN_SIZE+140);
        for(let s=lower;s<upper;s+=SAMPLE){
          const n=Math.min(s+SAMPLE,end);
          const mid=(s+n)/2;
          const center=alongX?world.point(mid,cross):world.point(cross,mid);
          if(cellAt(center[0])!==column || cellAt(center[1])!==row) continue;
          result.push({alongX,cross,width,s,n});
        }
      }
    }
  }
  return result;
}

// Rounded asphalt corners at junctions whose centre lies in this tile.
function tileFillets(world,column,row) {
  const minX=column*TERRAIN_SIZE-TERRAIN_EXTENT, minZ=row*TERRAIN_SIZE-TERRAIN_EXTENT;
  const rows=[], columns=[];
  for(const alongX of [true,false]){
    const crossMin=alongX?minZ:minX;
    const first=Math.floor((crossMin-240)/OUTER_SPACING), last=Math.ceil((crossMin+TERRAIN_SIZE+240)/OUTER_SPACING);
    const lines=[];
    for(let i=first;i<=last;i++){
      const cross=world.outerLine(i,alongX);
      lines.push({cross,width:i?7.2:9,ranges:Math.abs(cross)>=LIMIT?[[-Infinity,Infinity]]:[[-Infinity,-LIMIT],[LIMIT,Infinity]]});
    }
    for(const cross of [LIMIT,-LIMIT]) lines.push({cross,width:7.2,ranges:[[-LIMIT,LIMIT]]});
    (alongX?rows:columns).push(...lines);
  }
  const inTile=(u,v)=>{const [x,z]=world.point(u,v);return cellAt(x)===column&&cellAt(z)===row;};
  return fillTriangles(junctionFillets(rows,columns,{accept:inTile}),world,.176);
}

function roadMesh(world,segments,material,shoulder=false,extra=[]) {
  const vertices=[], normals=[], path=new Path2D();
  for(const {alongX,cross,width,s,n} of segments){
    const half=width/2+(shoulder?1.1:0), lift=shoulder?.095:.167;
    const point=(position,offset)=>{
      const shifted=offset+Math.sign(offset)*.5*edgeOffset(world,alongX,cross,position);
      return alongX?world.point(position,cross+shifted):world.point(cross+shifted,position);
    };
    const vertex=(position,offset)=>{
      const [x,z]=point(position,offset);
      return [x,world.roadHeight(x,z)+lift+(alongX?0:.008),z];
    };
    if(shoulder && world.riverEdge(...point((s+n)/2,0))<7) continue;
    const a=vertex(s,-half),b=vertex(s,half),c=vertex(n,-half),d=vertex(n,half);
    if(alongX) vertices.push(...a,...b,...c,...b,...d,...c);
    else vertices.push(...a,...c,...b,...b,...c,...d);
    normals.push(0,1,0,0,1,0,0,1,0,0,1,0,0,1,0,0,1,0);
    if(!shoulder){path.moveTo(...point(s,0));path.lineTo(...point(n,0));}
  }
  for(let i=0;i<extra.length;i+=3){vertices.push(extra[i],extra[i+1],extra[i+2]);normals.push(0,1,0);}
  const geometry=new T.BufferGeometry();
  geometry.setAttribute('position',new T.Float32BufferAttribute(vertices,3));
  geometry.setAttribute('normal',new T.Float32BufferAttribute(normals,3));
  const mesh=new T.Mesh(geometry,material);
  mesh.receiveShadow=true;
  return {mesh,path};
}

export function createExpanse(world,obstacles) {
  const group=new T.Group(), loaded=new Map();
  const terrainMaterial=surface(0xffffff,{vertexColors:true,pattern:'meadow'});
  const asphalt=surface(0x55585b,{pattern:'asphalt'});
  const verge=vergeMaterial();
  const sampler=terrainSurfaceSampler(world);
  const plaster=surface(0xffffff,{pattern:'plaster'});
  const tiles=surface(0xffffff,{pattern:'tiles'});
  const bridgeMaterial=surface(0xffffff);
  const aged=surface(0xffffff,{pattern:'derelict'});
  const masonry=surface(0xffffff,{pattern:'masonry'});
  const windows=surface(0x435c62,{roughness:.32,metalness:.16});
  const door=surface(0x825641);
  const frames=surface(0xeadac1);
  const walkers=walkingMeshes(36);
  group.add(walkers.mesh);
  const box=new T.BoxGeometry();
  const shell=houseShell(1), roof=roofShape(0);
  const sharedGeometries=new Set([box,shell,roof]);
  let target=null, queue=[];

  // A tile is built in steps so streaming never stalls a frame for the whole tile.
  let building=null;
  function* build(column,row){
    const key=keyFor(column,row);
    if(loaded.has(key)) return;
    const cell=new T.Group(), seed=random(cellSeed(world.seed,column,row));
    cell.userData.renderTile='stream:'+key;
    const core=column>=0 && column<6 && row>=0 && row<6;
    if(!core) cell.add(terrainTile(world,column,row,terrainMaterial));
    yield 'terrain';
    sampler(column*TERRAIN_SIZE-TERRAIN_EXTENT+TERRAIN_SIZE/2,row*TERRAIN_SIZE-TERRAIN_EXTENT+TERRAIN_SIZE/2);
    yield 'heights';
    const segments=roadSegments(world,column,row);
    const road=roadMesh(world,segments,asphalt,false,segments.length?tileFillets(world,column,row):[]);
    yield 'road';
    if(segments.length) cell.add((yield* vergeSteps(world,segments,verge,sampler,(x,z)=>world.riverEdge(x,z)<7)).mesh,road.mesh);
    else road.mesh.geometry.dispose();
    yield 'verge';
    const walls=[],brick=[],vacant=[],roofs=[],barriers=[],rails=[],panes=[],entrances=[],trim=[];
    let hamlet=null;
    if(!core){
      const candidates=segments.filter(segment=>Math.abs(segment.s)%100<12);
      if(candidates.length && seed()>.21){
        const street=candidates[Math.floor(seed()*candidates.length)];
        const mix=(street.s+street.n)/2;
        const [hx,hz]=street.alongX?world.point(mix,street.cross):world.point(street.cross,mix);
        const walkerCount=3+Math.floor(seed()*3);
        hamlet={x:hx,z:hz,point:[hx,hz],tier:'hamlet',
          name:hamletNames[Math.floor(seed()*hamletNames.length)]+' '+hamletEnds[Math.floor(seed()*hamletEnds.length)],
          street,mix,phase:Array.from({length:walkerCount},()=>seed()*79),
          people:Array.from({length:walkerCount},()=>({hue:seed(),skin:seed(),trousers:seed(),
            height:.86+seed()*.22, variant:Math.floor(seed()*64)}))};

        for(let i=0;i<10;i++){
          const along=mix+(i/2|0)*16-32, off=(i%2?1:-1)*(12+seed()*4);
          const [x,z]=street.alongX?world.point(along,street.cross+off):world.point(street.cross+off,along);
          if(cellAt(x)!==column || cellAt(z)!==row || world.land(x,z)===3 || world.roadDistance(...world.grid(x,z),true)<7) continue;
          const y=world.height(x,z), h=4+seed()*5, w=8+seed()*3, d=7+seed()*3;
          const [ax,az]=street.alongX?world.point(along+1,street.cross+off):world.point(street.cross+off,along+1);
          const face=i%2?-1:1;
          const rotation=Math.atan2(z-az,ax-x)+(seed()-.5)*.23;
          const tx=Math.cos(rotation), tz=-Math.sin(rotation), nx=-tz, nz=tx;
          if(world.roadCutsFootprint(x,z,tx,tz,w/2,d/2))continue;
          const local=(along,across)=>[x+tx*along+nx*across,z+tz*along+nz*across];
          const old=seed()<.19, baked=!old && seed()<.33;
          (old?vacant:baked?brick:walls).push([x,y+h/2-.5,z,w,h+1,d,rotation,old?0xa49b84:baked?0x935d45:0xe0cba0]);
          roofs.push([x,y+h-.04,z,w+.5+seed()*.6,1.6+seed()*1.65,d+.5+seed()*.6,rotation,old?0x625e58:0x925940]);
          const front=d*.5*face;
          const facade=(along,level,width,height,thickness,tint)=>{
            const [px,pz]=local(along,front+face*thickness*.52);
            return [px,y+level,pz,width,height,thickness,rotation,tint];
          };
          const [chimneyX,chimneyZ]=local(w*.22,d*.12);
          trim.push([chimneyX,y+h+1.6,chimneyZ,.68,2.2,.67,rotation,0x825842]);
          entrances.push(facade(0,1.08,1.05,2.12,.13,0x936d4c));
          for(const level of [1.64,4.28]){
            if(h<level+.85) continue;
            for(const column of [-2.44,2.44]){
              trim.push(facade(column,level,1.42,1.35,.13,0xdfd3b7));
              if(old){
                for(const offset of [-.37,.31]) entrances.push(facade(column,level+offset,1.2,.24,.23,0x71604b));
              } else {
                panes.push(facade(column,level,1.11,1.04,.19,0x506872));
                trim.push(facade(column,level-.54,1.33,.14,.32,0xc1ad8e));
              }
            }
          }
          const corners=[local(-w/2,-d/2),local(w/2,-d/2),local(w/2,d/2),local(-w/2,d/2)];
          corners.forEach((point,i)=>barriers.push([...point,...corners[(i+1)%4]]));
        }
      }
    }
    yield 'houses';
    if(roofs.length){
      if(walls.length) cell.add(instances(shell,walls,plaster));
      if(brick.length) cell.add(instances(shell,brick,masonry));
      if(vacant.length) cell.add(instances(shell,vacant,aged));
      cell.add(instances(roof,roofs,tiles),instances(box,panes,windows,false),
        instances(box,entrances,door,false),instances(box,trim,frames,false));
    } else hamlet=null;
    yield 'meshes';
    if(segments.length) bridges(world,segments.flatMap(({alongX,cross,s,n,width})=>{
      const at=t=>alongX?world.point(t,cross):world.point(cross,t);
      const mid=(s+n)/2;
      return [{a:at(s),b:at(mid),width},{a:at(mid),b:at(n),width}];
    }),cell,rails,box,bridgeMaterial);
    obstacles.beginOwner('open:'+key);
    obstacles.addBarriers(barriers);
    obstacles.addBarriers(rails);
    obstacles.endOwner();
    loaded.set(key,{cell,path:road.path,column,row,hamlet});
    group.add(cell);
  }

  function add(column,row){
    const key=keyFor(column,row);
    if(building?.key===key){const run=building.run;building=null;while(!run.next().done);return;}
    for(const step of build(column,row));
  }

  function drop(key,tile){
    obstacles.removeOwner('open:'+key);
    group.remove(tile.cell);
    tile.cell.traverse(item=>{
      if(item.geometry && !sharedGeometries.has(item.geometry)) item.geometry.dispose();
      if(item.isInstancedMesh) item.dispose();
    });
    loaded.delete(key);
  }

  function update(x,z,dt,vehicles){
    const column=cellAt(x),row=cellAt(z),key=keyFor(column,row);
    if(key!==target){
      target=key;
      for(const [key,tile] of loaded) if(Math.max(Math.abs(tile.column-column),Math.abs(tile.row-row))>2) drop(key,tile);
      queue=[];
      for(let dx=-2;dx<=2;dx++) for(let dz=-2;dz<=2;dz++){
        const i=column+dx,j=row+dz;
        if(!loaded.has(keyFor(i,j))) queue.push({i,j,rank:Math.max(Math.abs(dx),Math.abs(dz))+.01*(dx*dx+dz*dz)});
      }
      queue.sort((a,b)=>a.rank-b.rank);
      // Only the tiles the vehicle can reach immediately need synchronous collision.
      queue=queue.filter(({i,j})=>{
        const minX=i*TERRAIN_SIZE-TERRAIN_EXTENT,minZ=j*TERRAIN_SIZE-TERRAIN_EXTENT;
        const dx=Math.max(minX-x,x-minX-TERRAIN_SIZE,0), dz=Math.max(minZ-z,z-minZ-TERRAIN_SIZE,0);
        if(Math.hypot(dx,dz)>=45) return true;
        add(i,j);
        return false;
      });
    }
    if(!building&&queue.length){
      const {i,j}=queue.shift(), key=keyFor(i,j);
      if(!loaded.has(key)) building={key,run:build(i,j)};
    }
    if(building){
      const started=performance.now();
      do{
        const result=building.run.next();
        if(result.done){building=null;break;}
      }while(performance.now()-started<3);
    }
    walkers.time.value+=dt;
    const geometry=walkers.mesh.geometry;
    let count=0;
    for(const tile of loaded.values()){
      const hamlet=tile.hamlet;
      if(!hamlet || Math.hypot(x-hamlet.x,z-hamlet.z)>245 || count+hamlet.people.length>36) continue;
      const {street,mix,phase,people}=hamlet;
      phase.forEach((start,i)=>{
        const home=-17+(i%3)*3, destination=10+(i%4)*4;
        const pace=.92+i*.10, walkTime=(destination-home)/pace;
        const t=(start+walkers.time.value)%(2*walkTime+15);
        const outward=t<walkTime+6;
        const fraction=outward?Math.min(1,t/walkTime):Math.max(0,1-(t-walkTime-6)/walkTime);
        const offset=T.MathUtils.lerp(home,destination,fraction);
        const sign=outward?1:-1;
        const walking=outward?t<walkTime:t<2*walkTime+6;
        const side=i%2?1:-1, across=street.cross+side*(street.width/2+2.35);
        const point=along=>street.alongX?world.point(mix+along,across):world.point(across,mix+along);
        people[i].destination=point(outward?destination:home);
        const [px,pz]=point(offset);
        const [qx,qz]=street.alongX?world.point(mix+offset+sign,across):world.point(across,mix+offset+sign);
        const pose=pedestrianPose(people[i],px,pz,Math.atan2(qx-px,qz-pz),walking?pace:0,t*4.4,dt,vehicles,world.height);
        geometry.attributes.aInst.setXYZW(count,pose.x,pose.z,pose.yaw,pose.phase);
        geometry.attributes.aLook.setXYZ(count,people[i].hue,people[i].trousers,people[i].skin);
        geometry.attributes.aPose.setXY(count,pose.y,0);
        geometry.attributes.aVar.setXYZW(count,people[i].height,people[i].variant,pose.speed,0);
        count++;
      });
    }
    geometry.instanceCount=count;
    for(const name of ['aInst','aLook','aPose','aVar']) geometry.attributes[name].needsUpdate=true;
  }

  return {
    group,update,loaded,
    towns:()=>Array.from(loaded.values(),tile=>tile.hamlet).filter(Boolean),
    drawMap(ctx){ for(const tile of loaded.values()) ctx.stroke(tile.path); },
    dispose(){
      for(const [key,tile] of loaded) drop(key,tile);
      for(const geometry of sharedGeometries) geometry.dispose();
      for(const material of [terrainMaterial,asphalt,verge,plaster,tiles,bridgeMaterial,masonry,aged,windows,door,frames]) material.dispose();
      walkers.mesh.geometry.dispose();
      walkers.mesh.material.dispose();
    },
  };
}
