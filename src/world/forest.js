import * as T from '../vendor/three.module.js';
import { mergeGeometries } from '../vendor/jsm/utils/BufferGeometryUtils.js';
import { instances } from './scenery.js';
import { surface } from '../render/visuals.js';
import { cellSeed, random } from './world.js';
import { createSmallWildlife } from '../animals/wildlife.js';

const CELL=250;
const UP=new T.Vector3(0,1,0);
const transform=new T.Matrix4();

function merge(parts) {
  const geometry=mergeGeometries(parts);
  for(const part of parts) part.dispose();
  return geometry;
}

function crown(x,y,z,sx,sy,sz,detail,tint) {
  const g=new T.IcosahedronGeometry(1,detail).scale(sx,sy,sz).translate(x,y,z);
  const color=new T.Color(tint), values=[];
  for(let i=0;i<g.attributes.position.count;i++) values.push(color.r,color.g,color.b);
  g.setAttribute('color',new T.Float32BufferAttribute(values,3));
  return g;
}

function branch(a,b,bottom,top,segments=6) {
  const start=new T.Vector3(...a), end=new T.Vector3(...b);
  const delta=end.clone().sub(start);
  const g=new T.CylinderGeometry(top,bottom,delta.length(),segments);
  const rotation=new T.Quaternion().setFromUnitVectors(UP,delta.normalize());
  transform.compose(start.lerp(end,.5),rotation,new T.Vector3(1,1,1));
  return g.applyMatrix4(transform);
}

function proxyTrunk(height,radius) {
  const trunk=branch([0,0,0],[0,height,0],radius,radius*.52);
  const geometry=trunk.toNonIndexed();
  trunk.dispose();
  const colors=[];
  for(let i=0;i<geometry.attributes.position.count;i++) colors.push(.31,.27,.19);
  geometry.setAttribute('color',new T.Float32BufferAttribute(colors,3));
  return geometry;
}

// ---- Foliage as alpha-tested cards ---------------------------------------------
// Each tree is built from hundreds of small cards carrying a procedurally drawn
// twig (leaves with midribs and veins, or needle sprigs), on real branches. Card
// shading normals point out from the crown so the canopy reads as soft volumes.

function drawn(width,height,paint,seed) {
  if(typeof document==='undefined') return null;
  const canvas=document.createElement('canvas');
  canvas.width=width;canvas.height=height;
  const ctx=canvas.getContext('2d'), rng=random(seed);
  paint(ctx,rng,width,height);
  const texture=new T.CanvasTexture(canvas);
  texture.colorSpace=T.SRGBColorSpace;
  texture.anisotropy=4;
  texture.generateMipmaps=true;
  texture.minFilter=T.LinearMipmapLinearFilter;
  return texture;
}

function leafTexture() {
  return drawn(256,256,(ctx,rng,w,h)=>{
    ctx.clearRect(0,0,w,h);
    const leaf=(x,y,angle,length,tone)=>{
      ctx.save();ctx.translate(x,y);ctx.rotate(angle);
      const width=length*(.4+rng()*.1);
      const gradient=ctx.createLinearGradient(0,0,length,0);
      gradient.addColorStop(0,`hsl(${84+rng()*14},${34+rng()*10}%,${tone-8}%)`);
      gradient.addColorStop(1,`hsl(${74+rng()*18},${40+rng()*12}%,${tone+4}%)`);
      ctx.fillStyle=gradient;
      ctx.beginPath();ctx.moveTo(0,0);
      ctx.bezierCurveTo(length*.18,-width*.62,length*.62,-width*.58,length,0);
      ctx.bezierCurveTo(length*.62,width*.58,length*.18,width*.62,0,0);
      ctx.fill();
      ctx.strokeStyle=`hsla(80,30%,${tone-26}%,.75)`;ctx.lineWidth=.8;ctx.stroke();
      ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(length*.95,0);ctx.stroke();
      ctx.restore();
    };
    ctx.strokeStyle='hsl(60,22%,52%)';ctx.lineCap='round';
    // A main shoot and two side shoots, each carrying alternating leaves.
    const shoot=(x0,y0,x1,y1,count,size)=>{
      ctx.lineWidth=2.2;ctx.beginPath();ctx.moveTo(x0,y0);ctx.lineTo(x1,y1);ctx.stroke();
      const heading=Math.atan2(y1-y0,x1-x0);
      for(let i=0;i<count;i++){
        const t=(i+.5)/count, x=x0+(x1-x0)*t, y=y0+(y1-y0)*t, side=i%2?1:-1;
        leaf(x,y,heading+side*(.85+rng()*.4),size*(1-t*.25)*(.8+rng()*.4),64+rng()*24);
      }
      leaf(x1,y1,heading+(rng()-.5)*.3,size*.85,72+rng()*14);
    };
    shoot(128,250,126,34,10,50);
    shoot(127,170,52,96,6,42);
    shoot(127,140,206,76,6,42);
    shoot(126,96,84,40,4,34);
  },0x1eaf);
}

function needleTexture() {
  return drawn(256,128,(ctx,rng,w,h)=>{
    ctx.clearRect(0,0,w,h);
    const mid=h/2;
    ctx.strokeStyle='hsl(30,30%,52%)';ctx.lineWidth=3;ctx.lineCap='round';
    ctx.beginPath();ctx.moveTo(4,mid);ctx.lineTo(w-6,mid+(rng()-.5)*6);ctx.stroke();
    for(let i=0;i<150;i++){
      const t=Math.pow(rng(),.85), x=8+t*(w-24), side=rng()<.5?-1:1;
      const length=(h*.46)*(1-t*.55)*(.65+rng()*.45);
      const angle=side*(.7+rng()*.45);
      ctx.strokeStyle=`hsl(${105+rng()*30},${28+rng()*14}%,${52+rng()*30}%)`;
      ctx.lineWidth=1.5+rng()*.9;
      ctx.beginPath();ctx.moveTo(x,mid);
      ctx.lineTo(x+Math.cos(angle)*length*.7,mid+Math.sin(angle)*length);ctx.stroke();
    }
  },0x91f5);
}

const norm=v=>{const l=Math.hypot(...v)||1;return [v[0]/l,v[1]/l,v[2]/l];};
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];

class Cards {
  constructor(){this.p=[];this.n=[];this.uv=[];this.c=[];this.i=[];}
  // axisU: direction of the card's width; facing: card plane normal; shade: lighting normal.
  add(center,axisU,facing,w,h,shade,tone) {
    const u=norm(axisU), n=norm(facing);
    let v=norm(cross(n,u));
    const flat=norm(cross(v,n));
    const base=this.p.length/3;
    for(const [su,sv] of [[-.5,-.5],[.5,-.5],[.5,.5],[-.5,.5]]){
      this.p.push(center[0]+flat[0]*su*w+v[0]*sv*h,center[1]+flat[1]*su*w+v[1]*sv*h,center[2]+flat[2]*su*w+v[2]*sv*h);
      this.n.push(...shade);this.uv.push(su+.5,sv+.5);this.c.push(tone,tone,tone);
    }
    this.i.push(base,base+1,base+2,base,base+2,base+3);
  }
  build() {
    const g=new T.BufferGeometry();
    g.setAttribute('position',new T.Float32BufferAttribute(this.p,3));
    g.setAttribute('normal',new T.Float32BufferAttribute(this.n,3));
    g.setAttribute('uv',new T.Float32BufferAttribute(this.uv,2));
    g.setAttribute('color',new T.Float32BufferAttribute(this.c,3));
    g.setIndex(this.i);
    return g;
  }
}

function beech(seed) {
  const rng=random(seed), cards=new Cards();
  const wood=[
    branch([0,-.01,0],[.004,.05,.002],.047,.03,10),
    branch([0,.04,0],[.012,.3,.01],.03,.021,9),
    branch([.012,.3,.01],[.017,.62,.013],.021,.011,8),
  ];
  const core=[],far=[proxyTrunk(.58,.023)];
  const clusters=[];
  for(let i=0;i<6;i++){
    const a=i*2.39996+rng()*.4, x=Math.cos(a), z=Math.sin(a);
    const r=.2-(i%3)*.021+rng()*.03, y=.66+(i%3)*.1+rng()*.03;
    const start=[.01,.30+i*.035,.012], tip=[x*r,y,z*r];
    wood.push(branch(start,tip,.014,.005,7));
    for(let k=0;k<3;k++){
      const t=.5+rng()*.4, from=start.map((s,j)=>s+(tip[j]-s)*t);
      const to=[from[0]+(rng()-.5)*.14,from[1]+.03+rng()*.07,from[2]+(rng()-.5)*.14];
      wood.push(branch(from,to,.006,.0016,5));
      clusters.push({c:to,r:.085+rng()*.04,n:26});
    }
    clusters.push({c:tip,r:.15+rng()*.03,n:62});
    core.push(crown(x*r*.72,y-.01,z*r*.72,.105,.09,.105,0,0x354629));
    if(i%2===0) far.push(crown(x*r*.87,y,z*r*.87,.18,.169,.181,0,0x9bad82));
  }
  clusters.push({c:[0,.93,0],r:.16,n:84},{c:[.02,.84,-.02],r:.14,n:52});
  core.push(crown(0,.8,0,.15,.13,.15,0,0x2f3f24),crown(0,.9,0,.12,.09,.12,0,0x334527));
  far.push(crown(0,.91,0,.179,.15,.172,0,0xb0c79b));
  const centre=[0,.78,0];
  for(const {c,r,n} of clusters) for(let k=0;k<n;k++){
    const d=norm([rng()-.5,(rng()-.5)*.8+.08,rng()-.5]);
    const radius=r*(.45+.55*Math.sqrt(rng()));
    const p=[c[0]+d[0]*radius,c[1]+d[1]*radius*.85,c[2]+d[2]*radius];
    const out=norm([p[0]-centre[0],p[1]-centre[1]+.18,p[2]-centre[2]]);
    const facing=norm([out[0]*.7+(rng()-.5)*.9,out[1]*.5+.55+(rng()-.5)*.5,out[2]*.7+(rng()-.5)*.9]);
    const size=.1+rng()*.045;
    const tone=.8+.3*(.5+.5*out[1])*(.6+.4*rng());
    cards.add(p,[rng()-.5,(rng()-.5)*.4,rng()-.5],facing,size,size*1.05,out,tone);
  }
  return {wood:merge(wood),canopy:cards.build(),core:merge(core),far:merge(far)};
}

function fir(seed) {
  const rng=random(seed), cards=new Cards();
  const wood=[
    branch([0,-.01,0],[.002,.06,0],.04,.026,9),
    branch([0,.05,0],[.009,.91,-.015],.024,.003,8),
  ];
  const core=[],far=[proxyTrunk(.47,.019)];
  for(let layer=0;layer<8;layer++){
    const t=layer/7, y=.27+layer*.092, reach=.255-layer*.027;
    const limbs=8-Math.floor(layer/3);
    for(let limb=0;limb<limbs;limb++){
      const angle=limb*Math.PI*2/limbs+layer*.7+rng()*.3;
      const dx=Math.cos(angle), dz=Math.sin(angle);
      const length=reach*(.82+rng()*.3), droop=.05+rng()*.025;
      const from=[0,y+.03,0], tip=[dx*length,y-droop,dz*length];
      if(layer<6) wood.push(branch(from,tip,.007,.0018,5));
      // Short needle sprigs along the limb, crossed in pairs so they read as volume.
      for(const t of [.3,.58,.86]) for(const roll of [0,1]){
        const centre=[dx*length*t,y-droop*t*.8+.012,dz*length*t];
        const facing=roll?[0,1,0]:norm([-dz*.4,1,dx*.4]);
        const sprig=length*(.5-t*.12);
        cards.add(centre,[dx,-.2,dz],facing,sprig,sprig*.62,norm([dx*.5,.85,dz*.5]),.82+.28*rng());
        for(const side of [-1,1]){
          const sdx=dx*.55-dz*side*.8, sdz=dz*.55+dx*side*.8;
          cards.add([centre[0]+sdx*sprig*.3,centre[1]-.004,centre[2]+sdz*sprig*.3],[sdx,-.2,sdz],[0,1,.15],sprig*.7,sprig*.45,norm([sdx*.5,.85,sdz*.5]),.8+.25*rng());
        }
      }
    }
    core.push(crown(0,y,0,reach*.5,.06,reach*.5,0,0x2a3b2c));
    if(layer%2===0) far.push(crown(0,y+.039,0,reach*1.05,.15,reach*1.05,0,0x819e87));
  }
  for(let k=0;k<6;k++){
    const a=k*1.05+rng();
    cards.add([Math.cos(a)*.02,.93+rng()*.04,Math.sin(a)*.02],[Math.cos(a),.9,Math.sin(a)],[Math.sin(a),.2,-Math.cos(a)],.16,.09,[0,1,0],.95);
  }
  core.push(crown(0,.965,0,.05,.09,.05,0,0x3b5239));
  far.push(crown(0,.96,0,.074,.117,.074,0,0x9bb697));
  return {wood:merge(wood),canopy:cards.build(),core:merge(core),far:merge(far)};
}

function fern() {
  const rows=[];
  for(let limb=0;limb<6;limb++){
    const a=limb*2.39996, x=Math.cos(a),z=Math.sin(a);
    for(let j=0;j<7;j++){
      const s=j/7, t=(j+1)/7, y=v=>Math.sin(v*2.1)*.49+v*.24-.5;
      const span=Math.sin((j+.35)/7*Math.PI)*.135;
      for(const side of [-1,1]){
        rows.push(x*s,y(s),z*s,x*t,y(t),z*t,
          x*s-z*side*span,y(s)+.062,z*s+x*side*span);
      }
    }
  }
  const geometry=new T.BufferGeometry();
  geometry.setAttribute('position',new T.Float32BufferAttribute(rows,3));
  geometry.computeVertexNormals();
  return geometry;
}

export function createWoodland(world,obstacles) {
  const group=new T.Group(), tiles=new Map();
  const types=[beech(0xbee1),beech(0xbee2),beech(0xbee3),fir(0xf121),fir(0xf122)];
  const broadleaf=3;
  const wildlife=createSmallWildlife(world);
  const understorey=fern();
  const log=new T.CylinderGeometry(.63,1,1,9).rotateX(Math.PI/2);
  const boulder=new T.IcosahedronGeometry(1,0);
  const bark=surface(0xa99c85,{pattern:'bark'});
  const leafMap=leafTexture(), needleMap=needleTexture();
  const cardMaterial=map=>surface(0xffffff,{pattern:'canopy',vertexColors:true,roughness:.86,side:T.DoubleSide,
    ...(map?{map,alphaTest:.42}:{})});
  const leafMaterial=cardMaterial(leafMap), needleMaterial=cardMaterial(needleMap);
  const shadowOf=map=>map?new T.MeshDepthMaterial({depthPacking:T.RGBADepthPacking,map,alphaTest:.42,side:T.DoubleSide}):null;
  const leafShadow=shadowOf(leafMap), needleShadow=shadowOf(needleMap);
  const canopy=surface(0xffffff,{pattern:'canopy',vertexColors:true,roughness:.91,side:T.DoubleSide});
  const fernMaterial=surface(0xffffff,{pattern:'grass',side:T.DoubleSide});
  const stone=surface(0xffffff,{pattern:'gravel'});
  let queue=[], center='';

  function add(column,row) {
    const id=column+':'+row;
    if(tiles.has(id)) return;
    const rng=random(cellSeed(world.seed^0x15d7d,column,row));
    const records=types.map(()=>[]), shrubs=[], posts=[], fallen=[], stones=[];
    const node=new T.Group(), occupied=new Set();
    function plant(x,z) {
      if(x<column*CELL||x>=(column+1)*CELL||z<row*CELL||z>=(row+1)*CELL) return false;
      const cell=Math.floor(x/4.4)+':'+Math.floor(z/4.4);
      if(occupied.has(cell)||world.land(x,z)!==2) return false;
      const [u,v]=world.grid(x,z);
      if(world.roadDistance(u,v,true)<4.6 ||
         world.towns.some(town=>Math.hypot(town.u-u,town.v-v)<town.radius+9)) return false;
      const y=world.height(x,z);
      if(Math.abs(y-world.height(x+2,z))>2.2 || Math.abs(y-world.height(x,z+2))>2.2) return false;
      occupied.add(cell);
      const conifer=rng()<(y>105?.79:.33)?1:0;
      const tall=(conifer?7:4.8)+rng()*(conifer?14.5:12.5), spread=tall*(.79+rng()*.53);
      const tint=conifer?[0x5a7b60,0x6b8b69,0x7d9c7a]:[0x526e36,0x6b8046,0x73894a,0x7d8244];
      const kind=conifer?broadleaf+Math.floor(rng()*(types.length-broadleaf)):Math.floor(rng()*broadleaf);
      records[kind].push([x,y,z,spread,tall,spread,rng()*6.283,tint[Math.floor(rng()*tint.length)]]);
      posts.push([x,z,Math.min(.43,spread*(conifer?.018:.024))]);
      if(rng()<.087) {
        const px=x+2.4,pz=z+1.8;
        if(world.roadDistance(...world.grid(px,pz),true)>3){
          const base=world.height(px,pz);
          fallen.push([px,base+.29,pz,.29+rng()*.19,.32,2.5+rng()*3,rng()*6.28,0x695e46]);
          stones.push([px+1,world.height(px+1,pz)+.13,pz,.68,.49,.73,rng()*6.28,0x7f7d67]);
        }
      }
      if(rng()<.68) for(let fern=0;fern<4;fern++){
        const a=rng()*6.283, r=1+rng()*3;
        const px=x+Math.cos(a)*r,pz=z+Math.sin(a)*r;
        if(world.roadDistance(...world.grid(px,pz),true)<2) continue;
        const h=.56+rng()*.53;
        shrubs.push([px,world.height(px,pz)+h*.48,pz,h,h,h,rng()*6.283,0x6b843e]);
      }
      return true;
    }
    for(let i=0,count=Math.round(155*world.forestDensity);i<count;i++){
      const x=(column+rng())*CELL,z=(row+rng())*CELL;
      if(!plant(x,z)||rng()>.56) continue;
      const pattern=rng()*6.283;
      for(let j=0;j<3;j++){
        const angle=pattern+j*2.39996,distance=5+rng()*6;
        plant(x+Math.cos(angle)*distance,z+Math.sin(angle)*distance);
      }
    }
    const near=new T.Group(),detail=new T.Group(),far=new T.Group();
    near.add(detail);
    node.userData.renderTile='woodland:'+id;
    records.forEach((list,i)=>{
      if(list.length) far.add(instances(types[i].far,list,canopy,false));
    });
    function buildDetail(){
      records.forEach((list,i)=>{
        if(!list.length) return;
        const {wood,canopy:leaves,core}=types[i];
        const trunks=list.map(([x,y,z,w,h,d,r])=>[x,y,z,w,h,d,r,0x8e826d]);
        const cards=instances(leaves,list,i<broadleaf?leafMaterial:needleMaterial);
        const shadow=i<broadleaf?leafShadow:needleShadow;
        if(shadow) cards.customDepthMaterial=shadow;
        detail.add(instances(wood,trunks,bark),cards,instances(core,list,canopy));
      });
      if(shrubs.length) detail.add(instances(understorey,shrubs,fernMaterial,false));
      if(fallen.length) detail.add(instances(log,fallen,bark),instances(boulder,stones,stone));
    }
    const animals=records.some(list=>list.length)?wildlife.populate(column*CELL,row*CELL,CELL,
      random(cellSeed(world.seed^0x632d9,column,row))):[];
    for(const animal of animals){
      animal.root.userData.renderCategory='wildlife';
      near.add(animal.root);
    }
    if(records.some(list=>list.length)) {
      node.add(near,far);group.add(node);
      obstacles.beginOwner('wood:'+id);
      for(const [x,z,r] of posts) obstacles.addPosts([[x,z]],r);
      obstacles.endOwner();
    }
    tiles.set(id,{column,row,node,near,detail,far,animals,buildDetail,
      beech:records.slice(0,broadleaf).reduce((n,list)=>n+list.length,0),
      fir:records.slice(broadleaf).reduce((n,list)=>n+list.length,0), ferns:shrubs.length});
  }

  function drop(id,tile) {
    obstacles.removeOwner('wood:'+id);
    tile.node.removeFromParent();
    tile.node.traverse(object=>{if(object.isInstancedMesh)object.dispose();});
    tiles.delete(id);
  }

  function census(x,z,aerial) {
    const column=Math.floor(x/CELL), row=Math.floor(z/CELL), radius=aerial?6:4;
    const counts={tiles:0,beech:0,fir:0,ferns:0,rabbits:0,groundBirds:0};
    for(const tile of tiles.values()){
      if(Math.hypot(tile.column-column,tile.row-row)>radius) continue;
      counts.tiles++;
      counts.beech+=tile.beech;
      counts.fir+=tile.fir;
      counts.ferns+=tile.ferns;
      for(const animal of tile.animals) counts[animal.bird?'groundBirds':'rabbits']++;
    }
    return counts;
  }

  let lowDetail=false;
  let animalBoxes=[];
  return {group,census,animalBoxes:()=>animalBoxes,setLowDetail(value){lowDetail=value;},update(x,z,aerial=false,dt=0,tileBudget=aerial?5:2,horn=false) {
    const col=Math.floor(x/CELL), row=Math.floor(z/CELL), radius=aerial?6:4;
    const key=col+':'+row+':'+radius;
    if(key!==center){
      center=key;
      for(const [id,tile] of tiles) if(Math.hypot(tile.column-col,tile.row-row)>radius+1) drop(id,tile);
      queue=[];
      for(let dz=-radius;dz<=radius;dz++) for(let dx=-radius;dx<=radius;dx++){
        const weight=Math.hypot(dx,dz);
        if(weight>radius || tiles.has((col+dx)+':'+(row+dz))) continue;
        queue.push([col+dx,row+dz,weight]);
      }
      queue.sort((a,b)=>a[2]-b[2]);
      const nearPlayer=(column,row)=>{
        const dx=Math.max(column*CELL-x,x-(column+1)*CELL,0);
        const dz=Math.max(row*CELL-z,z-(row+1)*CELL,0);
        return Math.hypot(dx,dz)<32;
      };
      if(!aerial) queue=queue.filter(([column,row])=>{
        if(!nearPlayer(column,row)) return true;
        add(column,row);
        return false;
      });
    }
    for(let i=0;i<tileBudget&&queue.length;i++) add(...queue.shift());
    for(const box of animalBoxes)if(box.hit&&!box.animal.knock)
      wildlife.knockAnimal(box.animal,box.hit,box.mass,box.cx,box.y,box.cz,Math.atan2(box.fx,box.fz));
    animalBoxes=[];
    let nextDetail=null, nextDistance=Infinity;
    for(const tile of tiles.values()){
      const distance=Math.hypot(x-(tile.column+.5)*CELL,z-(tile.row+.5)*CELL);
      tile.near.visible=!aerial&&distance<320;
      tile.detail.visible=!lowDetail;
      if(tile.near.visible&&!lowDetail&&tile.buildDetail&&distance<nextDistance){
        nextDetail=tile;
        nextDistance=distance;
      }
      tile.far.visible=!tile.near.visible||lowDetail||Boolean(tile.buildDetail);
      if(tile.near.visible)wildlife.update(tile.animals,dt,x,z,animalBoxes,horn);
    }
    if(nextDetail){
      nextDetail.buildDetail();
      nextDetail.buildDetail=null;
      nextDetail.far.visible=false;
    }
  },dispose(){
    for(const [id,tile] of tiles) drop(id,tile);
    for(const type of types) for(const g of Object.values(type))g.dispose();
    wildlife.dispose();
    understorey.dispose();log.dispose();boulder.dispose();
    bark.dispose();canopy.dispose();fernMaterial.dispose();stone.dispose();
    for(const m of [leafMaterial,needleMaterial,leafShadow,needleShadow])m?.dispose();
    for(const t of [leafMap,needleMap])t?.dispose();
  }};
}
