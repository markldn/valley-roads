// Real ground around the car: furrows, ruts and swells as geometry, from the same height function
// the wheels drive on. Built in small tiles that follow the player.
import * as T from '../vendor/three.module.js';
import { soilRelief } from '../player/driving.js';
import { terrainPaintSampler } from './scenery.js';
import { surface } from '../render/visuals.js';

const TILE=24, QUADS=40, COARSE=12;

export function createFieldRelief(world) {
  const group=new T.Group(), tiles=new Map(), spare=[];
  const material=surface(0xffffff,{vertexColors:true,pattern:'meadow'});
  const paintAt=terrainPaintSampler(world);
  // One extra ring of vertices forms a hidden skirt, so a tile never shows an open edge.
  const SIDE=QUADS+3, indices=[];
  for(let j=0;j<SIDE-1;j++)for(let i=0;i<SIDE-1;i++){
    const a=j*SIDE+i,b=a+1,c=a+SIDE,d=c+1;
    indices.push(a,c,b,b,c,d);
  }
  const count=SIDE*SIDE;
  function makeGeometry() {
    const geometry=new T.BufferGeometry();
    geometry.setAttribute('position',new T.BufferAttribute(new Float32Array(count*3),3));
    geometry.setAttribute('normal',new T.BufferAttribute(new Float32Array(count*3),3));
    geometry.setAttribute('color',new T.BufferAttribute(new Float32Array(count*3),3));
    for(const name of ['farmland','rockFace','woodlandCover'])
      geometry.setAttribute(name,new T.BufferAttribute(new Float32Array(count),1));
    geometry.setIndex(indices);
    return geometry;
  }
  // Soil only exists away from roads, towns and water.
  function coverAt(x,z) {
    const cover=world.land(x,z);
    if(cover>2)return {cover,gain:0};
    const [u,v]=world.grid(x,z);
    if(world.towns.some(town=>Math.hypot(town.u-u,town.v-v)<town.radius+4))return {cover,gain:0};
    const edge=Math.min(world.roadDistance(u,v,true),world.nearestStreet(u,v)?.edge??99);
    return {cover,gain:Math.max(0,Math.min(1,(edge-1.2)/1.8))};
  }
  function build(column,row) {
    const x0=column*TILE,z0=row*TILE,step=TILE/QUADS,coarse=[];
    let soil=false;
    for(let j=0;j<=COARSE;j++)for(let i=0;i<=COARSE;i++){
      const sample=coverAt(x0+i*TILE/COARSE,z0+j*TILE/COARSE);
      soil||=sample.gain>0;
      coarse.push(sample);
    }
    if(!soil)return null;
    const geometry=spare.pop()||makeGeometry();
    const {position,normal,color,farmland,rockFace,woodlandCover}=geometry.attributes;
    const reliefAt=(i,j)=>{
      const x=x0+i*step,z=z0+j*step,cover=world.land(x,z);
      if(cover>2)return 0;
      const gx=Math.max(0,Math.min(COARSE-1e-6,i/QUADS*COARSE)),gz=Math.max(0,Math.min(COARSE-1e-6,j/QUADS*COARSE));
      const a=Math.floor(gx),b=Math.floor(gz),f=gx-a,g=gz-b,at=(p,q)=>coarse[q*(COARSE+1)+p].gain;
      const gain=(at(a,b)*(1-f)+at(a+1,b)*f)*(1-g)+(at(a,b+1)*(1-f)+at(a+1,b+1)*f)*g;
      return gain>.001?soilRelief(x,z,cover)*gain:0;
    };
    const relief=new Float32Array(SIDE*SIDE);
    for(let j=0;j<SIDE;j++)for(let i=0;i<SIDE;i++)relief[j*SIDE+i]=reliefAt(i-1,j-1);
    for(let j=0;j<SIDE;j++)for(let i=0;i<SIDE;i++){
      const n=j*SIDE+i, ci=Math.max(1,Math.min(SIDE-2,i)), cj=Math.max(1,Math.min(SIDE-2,j));
      const x=x0+(ci-1)*step,z=z0+(cj-1)*step, base=paintAt(x,z), skirt=ci!==i||cj!==j;
      position.setXYZ(n,x,base.y+.03+relief[cj*SIDE+ci]-(skirt?.7:0),z);
      const sx=base.dx+(relief[cj*SIDE+ci+1]-relief[cj*SIDE+ci-1])/(2*step);
      const sz=base.dz+(relief[(cj+1)*SIDE+ci]-relief[(cj-1)*SIDE+ci])/(2*step);
      const scale=1/Math.hypot(sx,1,sz);
      normal.setXYZ(n,-sx*scale,scale,-sz*scale);
      color.setXYZ(n,...base.color);
      farmland.setX(n,base.farmland);rockFace.setX(n,base.rock);woodlandCover.setX(n,base.wood);
    }
    for(const attribute of Object.values(geometry.attributes))attribute.needsUpdate=true;
    geometry.computeBoundingSphere();
    const tile=new T.Mesh(geometry,material);
    tile.receiveShadow=true;
    tile.userData.renderCategory='terrain';
    group.add(tile);
    return tile;
  }
  let center='', queue=[];
  return {group,update(x,z,lowDetail=false) {
    const column=Math.floor(x/TILE),row=Math.floor(z/TILE),key=column+':'+row+':'+lowDetail;
    const reach=lowDetail?2:4;
    if(key!==center){
      center=key;
      for(const [id,tile] of tiles){
        const [c,r]=id.split(':').map(Number);
        if(Math.hypot(c-column,r-row)<=reach+1)continue;
        if(tile){group.remove(tile);spare.push(tile.geometry);}
        tiles.delete(id);
      }
      queue=[];
      for(let j=-reach;j<=reach;j++)for(let i=-reach;i<=reach;i++)
        if(Math.hypot(i,j)<=reach&&!tiles.has((column+i)+':'+(row+j)))queue.push([column+i,row+j,Math.hypot(i,j)]);
      queue.sort((a,b)=>a[2]-b[2]);
    }
    for(let built=0;built<2&&queue.length;built++){
      const [c,r]=queue.shift();
      tiles.set(c+':'+r,build(c,r));
    }
  },dispose(){
    for(const tile of tiles.values())tile?.geometry.dispose();
    for(const geometry of spare)geometry.dispose();
    material.dispose();
  }};
}
