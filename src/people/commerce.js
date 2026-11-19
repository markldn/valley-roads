// Shops and restaurants along the town streets, plus malls, supermarkets, diners and car parks.
import * as T from '../vendor/three.module.js';
import { mergeGeometries } from '../vendor/jsm/utils/BufferGeometryUtils.js';
import { batchInstances } from '../world/scenery.js';
import { padPoint } from '../world/retail-plan.js';
import { walkingMeshes } from '../traffic/population.js';
import { surface } from '../render/visuals.js';
import { cellSeed, random } from '../world/world.js';

export const SHOP_TYPES=[
  {name:'Boulangerie Martin',kind:'bakery',color:0x8a5a2e,awning:[0xe8dcc0,0x8a5a2e],goods:[0xd9a860,0xc78a42,0xefd9a8],prop:'board'},
  {name:'Boucherie Perrin',kind:'butcher',color:0x8f2a2a,awning:[0xf0ece2,0x8f2a2a],goods:[0xb0413a,0xd08070,0xe6d8c8],prop:'board'},
  {name:'Pharmacie des Rives',kind:'pharmacy',color:0x1f7a4d,awning:null,goods:[0xe9efe9,0x68b08a,0x4f8fc0],prop:'cross'},
  {name:'Tabac Presse',kind:'tabac',color:0x9c2b22,awning:[0x9c2b22,0x7c1f18],goods:[0xd8c060,0x4f6fa8,0xc85040],prop:'carrot'},
  {name:'Coiffure Élise',kind:'barber',color:0x4a3f6b,awning:null,goods:[0xd8c8e0,0x8a78b0,0xf0e8f0],prop:'pole'},
  {name:'Fleurs des Rives',kind:'florist',color:0x3f7a48,awning:[0xe6efe0,0x3f7a48],goods:[0xd8486a,0xf0c23c,0xb04fc0],prop:'flowers'},
  {name:'Librairie du Pont',kind:'books',color:0x2f4f6f,awning:[0xe6e0d0,0x2f4f6f],goods:[0x8f3a30,0x2f5f7f,0xc8a048],prop:'rack'},
  {name:'Mode & Compagnie',kind:'fashion',color:0x24262c,awning:null,goods:[0xc85070,0xe8e0d4,0x38506f],prop:'rack'},
  {name:'Chaussures Lucas',kind:'shoes',color:0x5a3a28,awning:[0xd8c8a8,0x5a3a28],goods:[0x4a3024,0xa87850,0x20242a],prop:'board'},
  {name:'Optique Moreau',kind:'optician',color:0x1f5f86,awning:null,goods:[0xdfe8ee,0x7a8a96,0x2f3f4f],prop:'none'},
  {name:'Banque des Rives',kind:'bank',color:0x20395f,awning:null,goods:[0xd8dde4,0x8a98aa,0xc0a850],prop:'atm'},
  {name:'Épicerie Fine',kind:'grocer',color:0x6b7a2a,awning:[0xefe6c0,0x6b7a2a],goods:[0xd86a30,0x9fb040,0xd8b030],prop:'crates'},
  {name:'Quincaillerie Roux',kind:'hardware',color:0xa8551e,awning:[0xe0d4bc,0xa8551e],goods:[0x7a8088,0xc06a28,0x3f5f4a],prop:'crates'},
  {name:'Le Coffre à Jouets',kind:'toys',color:0xc83f5a,awning:[0xf2e04a,0xc83f5a],goods:[0xe04040,0x3f8fe0,0xf0c030],prop:'board'},
];
export const RESTAURANT_TYPES=[
  {name:'Bistrot du Marché',kind:'restaurant',color:0x7a2f2a,awning:[0x7a2f2a,0x5e221e],goods:[0xd8b070,0x8a4a30,0xe8dcc0]},
  {name:'Pizzeria Napoli',kind:'restaurant',color:0x2c6b3f,awning:[0xefe8d8,0xb8322c],goods:[0xd86a30,0xe8c860,0x8a3a28]},
  {name:'Le Petit Zinc',kind:'restaurant',color:0x23384f,awning:[0x23384f,0x182838],goods:[0xc8a048,0x6f3a2a,0xe0d4c0]},
  {name:'Brasserie de la Gare',kind:'restaurant',color:0x5a2436,awning:[0x5a2436,0xc8a858],goods:[0xc8a048,0x703030,0xe8dcc0]},
  {name:'Crêperie Bretonne',kind:'restaurant',color:0x1f5a86,awning:[0xf0ece0,0x1f5a86],goods:[0xd8a860,0xb06a30,0xf0e0c0]},
  {name:'Sushi des Rives',kind:'restaurant',color:0x20242a,awning:[0xb8322c,0x20242a],goods:[0xe8e0d0,0xd86a50,0x2f4a3a]},
];
const PADS={
  mall:{name:'Centre Commercial Les Rives',kind:'mall',color:0x1f4f7a},
  market:{name:'Hyper des Rives',kind:'market',color:0xb5261e},
  diner:{name:'Le Relais Routier',kind:'diner',color:0xa8331f},
};
const ANCHORS=[['Mode & Co',0xc83f5a],['Sport Alpin',0x1f7a4d],['Électro Plus',0x1f4f9a],['Cinéma Le Forum',0x7a2f8a],['Maison Verte',0x4f7a2a],['Librairie Mille Pages',0xa8551e]];
const MOVERS=48;
const CAR_COLORS=[0xd9dad6,0x24272b,0x70767c,0xa8abac,0x7a1f1f,0x1f3a5f,0xe8e4da,0x3f4a3f,0x8a6a3a];

// Signs with the same wording share one texture and one material.
const signCache=new Map();
function textPanel(text,background,foreground,width,height) {
  const size=width>9?1024:512, key=[text,background,size,Math.round(width/height*4)].join('|');
  if(signCache.has(key))return new T.Mesh(new T.PlaneGeometry(width,height),signCache.get(key));
  const art=document.createElement('canvas');
  art.width=size;art.height=Math.max(48,Math.round(size*height/width));
  const ctx=art.getContext('2d');
  ctx.fillStyle='#'+background.toString(16).padStart(6,'0');ctx.fillRect(0,0,art.width,art.height);
  ctx.fillStyle=foreground;ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.font=`700 ${Math.round(art.height*.62)}px Georgia,serif`;
  ctx.fillText(text,size/2,art.height*.54,art.width*.92);
  const map=new T.CanvasTexture(art);
  map.colorSpace=T.SRGBColorSpace;map.anisotropy=6;
  const material=new T.MeshStandardMaterial({map,emissiveMap:map,emissive:0xffffff,emissiveIntensity:.5,roughness:.5});
  signCache.set(key,material);
  return new T.Mesh(new T.PlaneGeometry(width,height),material);
}

// One parked car as a single mesh: painted shell, dark glass, wheels and lamps, in unit proportions.
function parkedCarGeometry() {
  const outline=[[-.5,.2],[-.5,.5],[-.45,.58],[-.31,.61],[-.2,.93],[.1,.97],[.27,.63],[.47,.53],[.5,.44],[.5,.2]];
  const halfWidth=y=>y>.62?.39:.5;
  const positions=[], colors=[];
  const tri=(a,b,c,tint)=>{positions.push(...a,...b,...c);for(let i=0;i<3;i++)colors.push(...tint);};
  const quad=(a,b,c,d,tint)=>{tri(a,b,c,tint);tri(a,c,d,tint);};
  const white=[1,1,1], glass=[.05,.07,.08], dark=[.03,.03,.03], lamp=[1.6,1.5,1.2], red=[1.2,.08,.06];
  for(let i=1;i<outline.length;i++){
    const [z0,y0]=outline[i-1],[z1,y1]=outline[i],w0=halfWidth(y0),w1=halfWidth(y1);
    quad([-w0,y0,z0],[-w1,y1,z1],[w1,y1,z1],[w0,y0,z0],white);
  }
  for(const side of [-1,1])for(let i=1;i<outline.length;i++){
    const [z0,y0]=outline[i-1],[z1,y1]=outline[i];
    const a=[side*halfWidth(y0),y0,z0],b=[side*halfWidth(y1),y1,z1],c=[side*.5,.2,z1],d=[side*.5,.2,z0];
    if(side>0)quad(a,d,c,b,white);else quad(a,b,c,d,white);
  }
  // Windscreen, rear screen and side windows sit just proud of the shell.
  quad([-.34,.66,.25],[-.34,.92,.11],[.34,.92,.11],[.34,.66,.25],glass);
  quad([-.34,.65,-.3],[.34,.65,-.3],[.34,.9,-.2],[-.34,.9,-.2],glass);
  for(const side of [-1,1]){
    const x=side*.452;
    const a=[x,.66,-.27],b=[x,.9,-.18],c=[x,.93,.08],d=[x,.66,.22];
    if(side>0)quad(a,d,c,b,glass);else quad(a,b,c,d,glass);
  }
  for(const side of [-1,1]){
    quad([side*.42,.42,.503],[side*.2,.42,.503],[side*.2,.5,.503],[side*.42,.5,.503],lamp);
    quad([side*.2,.44,-.503],[side*.42,.44,-.503],[side*.42,.54,-.503],[side*.2,.54,-.503],red);
  }
  quad([-.36,.24,.503],[.36,.24,.503],[.36,.36,.503],[-.36,.36,.503],dark);
  const shell=new T.BufferGeometry();
  shell.setAttribute('position',new T.Float32BufferAttribute(positions,3));
  shell.setAttribute('color',new T.Float32BufferAttribute(colors,3));
  const parts=[shell];
  shell.computeVertexNormals();
  const tinted=(geometry,tint)=>{
    const flat=geometry.toNonIndexed(), count=flat.attributes.position.count;
    flat.setAttribute('color',new T.Float32BufferAttribute(Array.from({length:count},()=>tint).flat(),3));
    flat.deleteAttribute('uv');
    return flat;
  };
  for(const z of [-.3,.31])for(const side of [-1,1]){
    parts.push(tinted(new T.CylinderGeometry(1,1,.13,14).rotateZ(Math.PI/2).scale(1,.22,.077).translate(side*.44,.22,z),dark));
    parts.push(tinted(new T.CylinderGeometry(.58,.58,.14,10).rotateZ(Math.PI/2).scale(1,.22,.077).translate(side*.45,.22,z),[.55,.56,.58]));
  }
  return mergeGeometries(parts);
}

export function createCommerce(world,region,civicSites,obstacles,debris) {
  const group=new T.Group();
  const lists={};
  const put=(key,record)=>{(lists[key]??=[]).push(record);return record;};
  const sites=[], panels=[], parkedCars=[], breakables=[];
  const hidden=new T.Matrix4().makeScale(0,0,0);
  function breakable(x,z,radius,records,mass=20,threshold=140) {
    breakables.push({x,z,radius,records,mass,threshold});
  }
  // A frame with x across a frontage, z pointing out of it and y up.
  function frame(x,y,z,fx,fz) {
    const rx=fz, rz=-fx, yaw=Math.atan2(fx,fz);
    const at=(across,out)=>[x+rx*across+fx*out,z+rz*across+fz*out];
    const box=(key,across,up,out,w,h,d,tint=0xffffff)=>{
      const [px,pz]=at(across,out);
      return put(key,[px,y+up,pz,w,h,d,yaw,tint]);
    };
    return {at,box,yaw,y};
  }

  // ---- Town shopfronts --------------------------------------------------------------------
  function shopfront(house,type,rng) {
    const [ex,ez]=house.entry,[fx,fz]=house.front;
    const wx=ex-fx*.32, wz=ez-fz*.32, y=world.height(ex,ez);
    const f=frame(wx,y,wz,fx,fz), {box}=f, W=house.halfX*2-.5, half=W/2;
    box('painted',0,1.6,.1,W,3.3,.22,type.color);
    box('painted',0,3.28,.3,W+.14,.16,.62,type.color);
    box('stone',0,.3,.3,W,.6,.6,0x8d8678);
    for(const side of [-1,1]){
      const paneW=half-1.05, center=side*(1.05+paneW/2);
      if(paneW<.5)continue;
      box('lit',center,1.72,.22,paneW,1.86,.04,0xfff0d0);
      for(let shelf=0;shelf<3;shelf++){
        box('painted',center,1.0+shelf*.6,.3,paneW-.1,.04,.16,0xd8ccb4);
        for(let item=0;item<Math.floor(paneW/.26);item++){
          const h=.16+rng()*.24, tint=type.goods[Math.floor(rng()*type.goods.length)];
          box('painted',center-paneW/2+.18+item*.26,1.02+shelf*.6+h/2,.31,.2,h,.12,tint);
        }
      }
      box('glass',center,1.72,.47,paneW,1.86,.03);
      box('painted',center+paneW/2,1.72,.47,.08,1.95,.1,type.color);
      box('painted',center-paneW/2,1.72,.47,.08,1.95,.1,type.color);
    }
    box('lit',0,1.2,.2,1.5,2.3,.04,0xffe8c0);
    box('glass',0,1.2,.47,1.42,2.3,.03);
    box('painted',0,2.4,.46,1.72,.12,.14,type.color);
    for(const side of [-1,1])box('painted',side*.8,1.2,.46,.12,2.4,.14,type.color);
    box('metal',.56,1.1,.5,.04,.36,.05,0xc8c4b8);
    const [sx,sz]=f.at(0,.62);
    panels.push({text:type.name,color:type.color,x:sx,y:y+2.86,z:sz,yaw:f.yaw,w:Math.min(W-.3,5.4),h:.56});
    if(type.awning){
      const stripes=Math.max(4,Math.round(W/.62));
      for(let i=0;i<stripes;i++){
        const across=-W/2+W*(i+.5)/stripes, tint=type.awning[i%2];
        const [px,pz]=f.at(across,.62+.62);
        put('awning',[px,y+2.3,pz,W/stripes+.01,.44,1.24,f.yaw,tint]);
      }
    }
    for(const side of [-1,1])box('warm',side*(half-.5),3.0,.72,.2,.08,.2,0xffe6b8);
    const [gx,gz]=[wx,wz];
    let open=0;
    for(let out=.8;out<7;out+=.3){
      const [px,pz]=f.at(0,out),[u,v]=world.grid(px,pz);
      if(world.roadDistance(u,v,true)<.5||(world.nearestStreet(u,v)?.edge??9)<.5)break;
      open=out;
    }
    sidewalkProp(f,type,rng,open,gx,gz,y);
    return open;
  }
  function solid(f,across,out,radius,records,mass,threshold) {
    const [x,z]=f.at(across,out);
    breakable(x,z,radius,records,mass,threshold);
  }
  function sidewalkProp(f,type,rng,open,gx,gz,y) {
    const {box}=f, side=rng()<.5?-1:1, across=side*1.7;
    if(type.prop==='cross'){
      box('green',across+.4,3.75,.75,.14,.82,.28,0x2bd67a);box('green',across+.4,3.75,.75,.14,.28,.82,0x2bd67a);
      box('metal',across+.4,3.75,.42,.05,.05,.6,0x707478);
    }
    if(type.prop==='carrot'){box('warmred',across,3.72,.72,.24,.92,.24,0xe0402c);box('metal',across,3.72,.42,.05,.05,.6,0x707478);}
    if(type.prop==='pole'){box('painted',across,1.5,.68,.14,1.5,.14,0xe8e4dc);for(let i=0;i<5;i++)box('painted',across,.95+i*.28,.68,.16,.1,.16,i%2?0xc83030:0x2f5fa8);}
    if(type.prop==='atm'){box('metal',across,1,.62,.8,1.5,.14,0x8a9098);box('lit',across,1.3,.7,.42,.3,.03,0x9fd0ff);}
    if(open<2)return;
    if(type.prop==='board'){
      solid(f,across,1.2,.25,[box('wood',across,.5,1.2,.58,.95,.05,0x38322c),box('paper',across,.56,1.235,.46,.72,.02,0xe8e2d0)],6,50);
    }
    if(type.prop==='crates'||type.prop==='flowers'){
      for(let i=0;i<3;i++){
        const a=across+(i-1)*.72, records=[box('wood',a,.42,.92,.62,.42,.5,0x9a7a50)];
        for(let k=0;k<9;k++){
          const tint=type.goods[Math.floor(rng()*type.goods.length)], s=type.prop==='flowers'?.12:.085;
          const [px,pz]=f.at(a+(k%3-1)*.17,.8+Math.floor(k/3)*.14);
          records.push(put('fruit',[px,y+.7+rng()*.08,pz,s,s,s,0,tint]));
        }
        solid(f,a,.92,.32,records,10,70);
      }
    }
    if(type.prop==='rack'){
      const records=[box('metal',across,1.42,1.05,1.3,.04,.04,0x8a8e90),box('metal',across-.62,.72,1.05,.04,1.42,.04,0x8a8e90),box('metal',across+.62,.72,1.05,.04,1.42,.04,0x8a8e90)];
      for(let i=0;i<6;i++)records.push(box('painted',across-.5+i*.2,1.02,1.05,.16,.74,.06,type.goods[i%type.goods.length]));
      solid(f,across,1.05,.4,records,12,80);
    }
  }
  function terrace(f,type,rng,open) {
    const places=[];
    if(open<3)return places;
    const {box}=f, depth=Math.min(open-1.5,3.2), tables=Math.floor(depth/1.7);
    const span=4.8;
    for(let row=0;row<Math.max(1,tables);row++)for(let i=-1;i<=1;i++){
      const across=i*span/2.4, out=1.45+row*1.7;
      if(Math.abs(across)<.9&&row===0)continue;
      const [x,z]=f.at(across,out), y=f.y;
      const records=[put('round',[x,y+.74,z,.38,.04,.38,0,0xe8e2d4]),put('post',[x,y+.37,z,.035,.74,.035,0,0x2c2e30])];
      const seats=[];
      for(const s of [-1,1]){
        const [cx,cz]=f.at(across+s*.62,out);
        records.push(put('wood',[cx,y+.45,cz,.4,.05,.4,f.yaw,0x7a5a3a]),put('wood',[cx+f.at(s*.2,0)[0]-f.at(0,0)[0],y+.72,cz+f.at(s*.2,0)[1]-f.at(0,0)[1],.05,.52,.4,f.yaw,0x7a5a3a]));
        seats.push({x:cx,z:cz,yaw:Math.atan2(x-cx,z-cz),y});
      }
      if(rng()<.65){
        const tint=type.awning?type.awning[0]:type.color;
        records.push(put('parasol',[x,y+2.35,z,1.15,.42,1.15,0,tint]),put('post',[x,y+1.25,z,.03,2.1,.03,0,0xd8d4c8]));
      }
      breakable(x,z,.45,records,14,90);
      places.push(...seats);
    }
    for(const side of [-1,1]){
      const across=side*(span/2+.85), out=1.3+depth/2;
      const records=[box('wood',across,.3,out,.42,.6,depth,0x6f5238)];
      for(let i=0;i<4;i++){const [px,pz]=f.at(across,out+(i-1.5)*depth/4);records.push(put('leaf',[px,f.y+.82,pz,.3,.34,.3,0,0x4f7433]));}
      solid(f,across,out,.45,records,30,160);
    }
    return places;
  }
  const taken=house=>civicSites.some(site=>Math.hypot(site.x-house.entry[0],site.z-house.entry[1])<2.5);
  const placed=new Map();
  for(const house of region.obstacles){
    if(!house.entry||house.kind==='ruin'||house.floors<2||house.halfX<4.2||taken(house))continue;
    const [u,v]=world.grid(house.x,house.z);
    const town=world.towns.find(item=>Math.hypot(item.u-u,item.v-v)<item.radius);
    if(!town||town.tier==='hamlet')continue;
    const centre=Math.hypot(town.u-u,town.v-v)/town.radius;
    const rng=random(cellSeed(world.seed^0x2ab9d,Math.round(house.x*3),Math.round(house.z*3)));
    const share=town.tier==='hub'?(centre<.3?.36:centre<.55?.1:.012):centre<.7?.22:.03;
    const count=placed.get(town)??0;
    if(rng()>share||count>=Math.round(town.radius/11))continue;
    const eat=count%5===1;
    const list=eat?RESTAURANT_TYPES:SHOP_TYPES;
    const type=list[Math.floor(rng()*list.length)];
    placed.set(town,count+1);
    const open=shopfront(house,type,rng);
    const seats=eat?terrace(frame(house.entry[0]-house.front[0]*.32,world.height(...house.entry),house.entry[1]-house.front[1]*.32,...house.front),type,rng,open):[];
    sites.push({...type,seats,house,x:house.entry[0],z:house.entry[1],y:world.height(...house.entry),nx:house.front[0],nz:house.front[1],retail:true});
  }

  // ---- Malls, supermarkets, diners and car parks ------------------------------------------
  const paint=0xe9e6da;
  function buildPad(pad) {
    const rng=random(cellSeed(world.seed^0x91c4,Math.round(pad.x),Math.round(pad.z)));
    const yaw=Math.atan2(pad.bx,pad.bz), {y}=pad;
    const P=(a,b,h=0)=>{const [x,z]=padPoint(pad,a,b);return [x,y+h,z];};
    const flat=(key,a,b,w,d,h,height=.02,tint=paint)=>{const [x,py,z]=P(a,b,h);return put(key,[x,py,z,w,height,d,yaw,tint]);};
    const cube=(key,a,b,up,w,tall,d,tint=0xffffff)=>{const [x,py,z]=P(a,b,up);return put(key,[x,py,z,w,tall,d,yaw,tint]);};
    // Bays and aisles.
    for(const bay of pad.bays){
      flat('paint',bay.a-1.3,bay.b,.11,5,.012);
      flat('paint',bay.a+1.3,bay.b,.11,5,.012);
      const accessible=pad.building&&Math.abs(bay.a)<9&&bay.b>pad.lotEnd-16;
      if(accessible)flat('paint',bay.a,bay.b,2.2,4.6,.011,.02,0x2f5f9f);
    }
    for(const item of pad.islands){
      const w=item.a1-item.a0, d=item.b1-item.b0;
      cube('kerb',(item.a0+item.a1)/2,(item.b0+item.b1)/2,.0,w,.28,d,0xa8a498);
      if(Math.min(w,d)<=1.6)cube('grass',(item.a0+item.a1)/2,(item.b0+item.b1)/2,.145,Math.max(.1,w-.22),.02,Math.max(.1,d-.22),0x5f8240);
    }
    for(const {a,b} of pad.trees){
      const [x,py,z]=P(a,b,.14), tall=3.6+rng()*1.8;
      put('post',[x,py+tall*.32,z,.09,tall*.64,.09,0,0x5a4632]);
      put('leaf',[x,py+tall*.72,z,tall*.34,tall*.32,tall*.34,rng()*6,[0x4f7433,0x5f8240,0x3f6530][Math.floor(rng()*3)]]);
      obstacles.addPosts([[x,z]],.14);
    }
    for(const {a,b} of pad.lamps){
      const [x,py,z]=P(a,b,.14);
      put('post',[x,py+4.5,z,.075,9,.075,0,0x5c6266]);
      put('metal',[x,py+8.95,z,2.8,.08,.1,yaw,0x5c6266]);
      for(const side of [-1,1]){
        const [lx,lz]=padPoint(pad,a+side*1.3,b);
        put('warm',[lx,py+8.86,lz,.6,.08,.24,yaw,0xfff0d0]);
      }
      obstacles.addPosts([[x,z]],.13);
    }
    pad.bays.forEach(bay=>{
      const [x,py,z]=P(bay.a,bay.b);
      const bayYaw=yaw+(bay.facing>0?0:Math.PI)+(rng()-.5)*.05;
      parkedCars.push({pad,bay,x,y:py,z,yaw:bayYaw,color:CAR_COLORS[bay.tint%CAR_COLORS.length],length:4.1+(bay.tint%7)*.09,width:1.76,height:1.42+(bay.tint%5)*.05,visible:false});
    });
    if(!pad.building){
      // Pay station and the blue P that marks a public car park.
      const [px,pz]=padPoint(pad,pad.driveways[0].a+6.2,1);
      cube('metal',pad.driveways[0].a+6.2,1,.72,.42,1.45,.3,0x4a5158);
      cube('lit',pad.driveways[0].a+6.2,1.17,1.18,.26,.2,.02,0x9fd0ff);
      obstacles.addPosts([[px,pz]],.28);
      panels.push({text:'P',color:0x1f4f9a,x:P(-pad.w/2+4,.3)[0],y:y+3.1,z:P(-pad.w/2+4,.3)[2],yaw:yaw+Math.PI,w:1,h:1});
      cube('post',-pad.w/2+4,.34,1.3,.05,2.6,.05,0x70767a);
      obstacles.addPosts([P(-pad.w/2+4,.34).filter((_,i)=>i!==1)],.08);
      return;
    }
    const site=pad.kind==='fuel'?{name:pad.brand.name+' · Boutique',kind:'grocer',color:pad.brand.color,goods:[0xd86a30,0x3f8fe0,0xe8c040]}:PADS[pad.kind], b0=pad.building.b0, b1=pad.building.b1, w=pad.bw, d=b1-b0;
    const mid=(b0+b1)/2, front=b0;
    const walls=pad.kind==='diner'?5.2:pad.kind==='market'?9:13;
    const corners=[P(-w/2,b0),P(w/2,b0),P(w/2,b1),P(-w/2,b1)].map(([x,,z])=>[x,z]);
    corners.forEach((corner,i)=>wallSegments.push([...corner,...corners[(i+1)%4]]));
    cube('panel',0,mid,walls/2,w,walls,d,pad.kind==='diner'?0xd8c49c:0xc8c6be);
    cube('dark',0,mid,walls+.25,w+.5,.5,d+.5,0x4a4d50);
    for(let a=-w/2+4;a<w/2;a+=8)cube('stone',a,front-.08,walls/2,.7,walls,.28,0xa8a69c);
    cube('stone',0,front-.1,.6,w,1.2,.32,0x8d8a80);
    const door={a:0,b:front-1.8};
    const [dx,dz]=padPoint(pad,door.a,door.b);
    sites.push({...site,x:dx,z:dz,y:y+.14,nx:-pad.bx,nz:-pad.bz,retail:true,pad});
    const facing=yaw+Math.PI;
    const sign=(text,color,a,up,sw,sh,b=front-.34)=>{const [x,py,z]=P(a,b,up);panels.push({text,color,x,y:py,z,yaw:facing,w:sw,h:sh});};
    if(pad.kind==='mall'){
      // Atrium: a tall glass hall with a canopy over the doors.
      cube('glass',0,front-.7,9,26,18,.2);
      for(let a=-13;a<=13;a+=3.25)cube('metal',a,front-.82,9,.14,18,.3,0x3f464c);
      for(let h=3;h<18;h+=3)cube('metal',0,front-.82,h,26,.12,.3,0x3f464c);
      cube('lit',0,front-.3,9,25.6,17.6,.1,0xfff0d4);
      cube('panel',0,front+3,18.6,28,1.2,8,0xd8d6ce);
      cube('metal',0,front-3.4,4.6,20,.32,6,0x3f464c);
      for(const a of [-9.5,9.5])cube('metal',a,front-5.9,2.3,.3,4.6,.3,0x3f464c);
      for(let a=-6;a<=6;a+=4){cube('glass',a,front-.92,1.3,3.4,2.6,.08);cube('metal',a,front-.96,2.65,3.6,.1,.14,0x2c3034);}
      sign(site.name,site.color,0,20.2,24,2.4,front-1);
      ANCHORS.forEach(([name,color],i)=>{
        const a=(i<3?-1:1)*(19+(i%3)*14.5);
        cube('glass',a,front-.32,3.4,12.4,4.6,.12);cube('lit',a,front-.2,3.4,12,4.3,.06,0xfff2da);
        for(let m=-6;m<=6;m+=3)cube('metal',a+m,front-.38,3.4,.1,4.7,.16,0x3f464c);
        cube('metal',a,front-1.2,5.9,13,.16,2,0x3f464c);
        sign(name,color,a,8.2,11.5,1.5);
      });
      for(let i=0;i<9;i++)cube('dark',-w/2+12+i*11,mid+(i%2?7:-6),walls+1.1,4+rng()*3,1.3,3+rng()*2,0x777b7e);
      // Service yard with loading bays at the back.
      for(let a=-w/2+14;a<w/2-10;a+=16){cube('dark',a,b1+.05,2.1,4,4.2,.2,0x3a3e42);cube('stone',a,b1+.4,.65,5,1.3,.8,0x70706a);}
      // Trolley shelters.
      for(const a of [-30,30]){
        const b=pad.lotEnd-3;
        cube('glass',a,b,1.1,8,2.2,.05);cube('metal',a,b+.9,2.3,8.4,.08,2.2,0x3f464c);
        for(let i=0;i<9;i++)cube('metal',a-3.2+i*.8,b+.9,.7,.5,.9,.95,0x9aa0a4);
        const [tx,tz]=padPoint(pad,a,b+.9);obstacles.addPosts([[tx,tz]],2.1);
      }
    }else if(pad.kind==='fuel'){
      const {color,accent,name}=pad.brand;
      // Canopy on four columns, lit from underneath.
      cube('painted',0,20,5.6,62,.34,18,0xe8e8e2);
      cube('painted',0,11,5.75,62.3,.72,.3,color);cube('painted',0,29,5.75,62.3,.72,.3,color);
      cube('painted',-31,20,5.75,.3,.72,18.3,color);cube('painted',31,20,5.75,.3,.72,18.3,color);
      cube('painted',0,10.84,5.5,62.3,.14,.04,accent);
      for(let a=-24;a<=24;a+=8)cube('warm',a,20,5.41,3.2,.05,.7,0xfff4dc);
      for(const a of [-20,0,20]){
        cube('metal',a,19.5,2.8,.42,5.6,.42,0xc8ccce);
        const [cx,cz]=padPoint(pad,a,19.5);obstacles.addPosts([[cx,cz]],.3);
        sign(name,color,a,5.72,8,.62,10.82);
        for(const offset of [-3,3]){
          const pa=a+offset,[px,pz]=padPoint(pad,pa,19.5);
          cube('painted',pa,19.5,.98,1.15,1.7,.62,0xe6e6e0);
          cube('painted',pa,19.5,2.02,1.25,.42,.7,color);
          cube('painted',pa,19.5,.2,1.3,.4,.74,0x3a3d40);
          for(const face of [-1,1]){
            cube('lit',pa,19.5+face*.325,1.42,.72,.42,.02,0x8fe0a8);
            cube('dark',pa,19.5+face*.325,1.02,.72,.22,.02,0x202428);
            for(let n=-1;n<=1;n++){
              cube('painted',pa+n*.3,19.5+face*.34,.62,.2,.3,.06,[0x2f8a4c,0x1f62a8,0x202226][n+1]);
              cube('dark',pa+n*.3+.11,19.5+face*.38,.52,.03,.42,.03,0x141516);
            }
          }
          obstacles.addPosts([[px,pz]],.5);
        }
      }
      // Shop front.
      cube('painted',0,front-.2,walls-.4,w,.9,.3,color);
      cube('glass',0,front-.3,1.75,w-3,3.2,.12);cube('lit',0,front-.2,1.75,w-3.2,3,.05,0xfff2da);
      for(let a=-w/2+2;a<w/2-1;a+=3)cube('metal',a,front-.36,1.75,.09,3.3,.14,0x3f464c);
      sign(name,color,0,walls-.4,12,.72,front-.4);
      for(let i=0;i<4;i++)cube('painted',-8+i*1.3,front-1.5,.5,.9,1,.7,[0xe8eef4,0xd84a30,0x2f6fb0,0xe8c040][i]);
      // Totem with today's prices at the roadside.
      const pa=-pad.w/2+6,[qx,qz]=padPoint(pad,pa,.8);
      cube('painted',pa,.8,4.4,2.5,8.8,.5,color);
      obstacles.addPosts([[qx,qz]],1.1);
      const front2=P(pa,.5), priceRow=(label,price,up)=>panels.push({text:`${label}  ${price.toFixed(3)}`,color:0x121416,x:front2[0],y:y+up,z:front2[2],yaw:yaw+Math.PI,w:2.2,h:.62});
      panels.push({text:name,color:accent===0xe9f0f6?color:accent,x:front2[0],y:y+7.9,z:front2[2],yaw:yaw+Math.PI,w:2.3,h:.8});
      priceRow('SP95',1.76+pad.priceShift,6.8);priceRow('SP98',1.89+pad.priceShift,6.05);priceRow('Gazole',1.68+pad.priceShift,5.3);
      // Air and water point, litter bins and a jet wash bay at the side.
      const air=pad.w/2-8;
      cube('painted',air,pad.lotEnd-6,.8,.5,1.6,.4,0x2f6fb0);cube('lit',air,pad.lotEnd-6.22,1.25,.3,.2,.02,0x9fd0ff);
      const [ax,az]=padPoint(pad,air,pad.lotEnd-6);obstacles.addPosts([[ax,az]],.32);
      const wash=-pad.w/2+9;
      for(const side of [-1,1]){cube('metal',wash+side*2.2,pad.lotEnd-8,1.8,.14,3.6,6,0xc8ccce);}
      cube('painted',wash,pad.lotEnd-8,3.7,4.8,.2,6.4,color);
      for(const side of [-1,1]){const [wx,wz]=padPoint(pad,wash+side*2.2,pad.lotEnd-8);obstacles.addPosts([[wx,wz]],.3);}
    }else if(pad.kind==='market'){
      cube('painted',0,front-.2,walls-1,w,2,.3,site.color);
      cube('glass',0,front-.3,2.2,24,4.4,.14);cube('lit',0,front-.2,2.2,23.6,4.1,.06,0xfff2da);
      for(let a=-12;a<=12;a+=3)cube('metal',a,front-.38,2.2,.1,4.5,.16,0x3f464c);
      cube('metal',0,front-2.6,4.5,28,.22,5,0xd9d6cc);
      for(const a of [-13,13])cube('metal',a,front-4.9,2.2,.22,4.4,.22,0x70767a);
      sign(site.name,site.color,0,walls-1,18,1.7,front-.5);
      for(let i=0;i<14;i++)cube('metal',-w/2+7+i*3.1,front-3.8,.5,.5,1,.9,0x9aa0a4);
      // Recycling bins and a pylon by the road.
      for(let i=0;i<3;i++)cube('painted',w/2+3+i*1.8,pad.d-8,1,1.5,2,1.5,[0x2f6e3d,0xd6b52c,0x2f5f9f][i]);
      const pa=-pad.w/2+5, [qx,qz]=padPoint(pad,pa,.75);
      cube('painted',pa,.75,5,1.5,10,.5,site.color);
      panels.push({text:'Hyper',color:site.color,x:P(pa,.48)[0],y:y+7.7,z:P(pa,.48)[2],yaw:yaw+Math.PI,w:1.4,h:.8});
      obstacles.addPosts([[qx,qz]],.8);
    }else{
      cube('tile',0,mid,1.1,w+.02,.36,d+.02,0xa8331f);
      cube('glass',0,front-.1,1.75,w-3,2.1,.1);cube('lit',0,front-.02,1.75,w-3.2,2,.05,0xffe8c4);
      for(let a=-w/2+2;a<w/2-1;a+=2.4)cube('metal',a,front-.16,1.75,.09,2.2,.14,0x2a2c2e);
      cube('painted',0,front-1.1,3.65,w+1,.3,2.4,0xa8331f);
      sign(site.name,site.color,0,4.5,13,1.1,front-.4);
      const pa=pad.w/2-5, [qx,qz]=padPoint(pad,pa,.75);
      cube('post',pa,.75,4,.14,8,.14,0x5c6266);
      panels.push({text:'Restaurant',color:site.color,x:P(pa,.6)[0],y:y+7.2,z:P(pa,.6)[2],yaw:yaw+Math.PI,w:3.6,h:1});
      obstacles.addPosts([[qx,qz]],.18);
      for(let i=-1;i<=1;i++){
        const a=i*4.2, b=front-2.3, [x,,z]=P(a,b), records=[put('round',[x,y+.88,z,.42,.04,.42,0,0xe8e2d4]),put('post',[x,y+.5,z,.04,.74,.04,0,0x2c2e30]),put('parasol',[x,y+2.6,z,1.2,.42,1.2,0,0xa8331f])];
        breakable(x,z,.45,records,14,90);
      }
    }
    pad.front=front;
  }
  const wallSegments=[];
  for(const pad of world.pads)buildPad(pad);
  obstacles.addBarriers(wallSegments);

  // ---- Tarmac -------------------------------------------------------------------------------
  const tarmac=[];
  const tile=(a,b,c,d)=>tarmac.push(...a,...b,...c,...a,...c,...d);
  for(const pad of world.pads){
    const at=(a,b,y)=>{const [x,z]=padPoint(pad,a,b);return [x,y,z];};
    const W=pad.w/2,D=pad.d,y=pad.y;
    tile(at(-W,0,y),at(-W,D,y),at(W,D,y),at(W,0,y));
    // Retaining edge down to the ground around the slab.
    const low=y-3;
    tile(at(-W,0,low),at(-W,0,y),at(W,0,y),at(W,0,low));
    tile(at(W,D,low),at(W,D,y),at(-W,D,y),at(-W,D,low));
    tile(at(-W,D,low),at(-W,D,y),at(-W,0,y),at(-W,0,low));
    tile(at(W,0,low),at(W,0,y),at(W,D,y),at(W,D,low));
    for(const {a,width} of pad.driveways)for(let i=0;i<8;i++){
      const b0=-pad.gap*(1-i/8), b1=-pad.gap*(1-(i+1)/8), half=width/2;
      const level=(p,b)=>{const [x,z]=padPoint(pad,p,b);return (world.padLevel(x,z)??world.roadHeight(x,z)+.16)+.025;};
      tile(at(a-half,b0,level(a-half,b0)),at(a-half,b1,level(a-half,b1)),at(a+half,b1,level(a+half,b1)),at(a+half,b0,level(a+half,b0)));
    }
  }
  const tarmacGeometry=new T.BufferGeometry();
  tarmacGeometry.setAttribute('position',new T.Float32BufferAttribute(tarmac,3));
  tarmacGeometry.computeVertexNormals();
  const tarmacMesh=new T.Mesh(tarmacGeometry,surface(0x55585b,{pattern:'asphalt',pavementWear:false,side:T.DoubleSide}));
  tarmacMesh.receiveShadow=true;
  group.add(tarmacMesh);

  // ---- Geometry -----------------------------------------------------------------------------
  const unit=new T.BoxGeometry();
  const awning=new T.BoxGeometry(1,1,1,1,1,1);
  {
    const p=awning.attributes.position;
    for(let i=0;i<p.count;i++)if(p.getZ(i)>0)p.setY(i,p.getY(i)-.75);
    awning.computeVertexNormals();
  }
  const ball=new T.IcosahedronGeometry(1,1), rod=new T.CylinderGeometry(1,1,1,10), disc=new T.CylinderGeometry(1,1,1,18), cone=new T.ConeGeometry(1,1,10);
  const geometries=[unit,awning,ball,rod,disc,cone,tarmacGeometry];
  const glow=[];
  const lit=(color,intensity)=>{const material=surface(color,{emissive:color,emissiveIntensity:intensity,roughness:.5});glow.push([material,intensity]);return material;};
  const spec={
    painted:[unit,surface(0xffffff,{roughness:.62}),true],stone:[unit,surface(0xffffff,{pattern:'concrete'}),true],
    panel:[unit,surface(0xffffff,{pattern:'concrete'}),true],kerb:[unit,surface(0xffffff,{pattern:'concrete'}),false],
    paint:[unit,surface(0xffffff,{roughness:.8}),false],grass:[unit,surface(0xffffff,{pattern:'foliage'}),false],
    wood:[unit,surface(0xffffff,{roughness:.72}),true],paper:[unit,surface(0xffffff),false],tile:[unit,surface(0xffffff,{pattern:'tiles'}),true],
    metal:[unit,surface(0xffffff,{roughness:.36,metalness:.62}),true],dark:[unit,surface(0xffffff,{roughness:.7}),true],
    glass:[unit,new T.MeshStandardMaterial({color:0x9fc0c8,roughness:.08,metalness:.3,transparent:true,opacity:.34,depthWrite:false}),false],
    lit:[unit,lit(0xffffff,.55),false],warm:[unit,lit(0xffe6b8,.3),false],green:[unit,lit(0x2bd67a,1.2),false],warmred:[unit,lit(0xe0402c,.9),false],
    awning:[awning,surface(0xffffff,{roughness:.8,side:T.DoubleSide}),true],fruit:[ball,surface(0xffffff,{roughness:.6}),false],
    leaf:[ball,surface(0xffffff,{pattern:'foliage'}),true],post:[rod,surface(0xffffff,{roughness:.55}),true],
    round:[disc,surface(0xffffff,{roughness:.5}),false],parasol:[cone,surface(0xffffff,{roughness:.8}),true],
  };
  const near=[], far=[];
  for(const [key,records] of Object.entries(lists)){
    const [geometry,material,shadow]=spec[key];
    const big=['panel','dark','glass','lit','metal','stone'].includes(key);
    const meshes=batchInstances(group,geometry,material,records,big?260:140,shadow,'commerce');
    (big?far:near).push(...meshes);
  }
  // Fascia signs.
  const signs=panels.map(({text,color,x,y,z,yaw,w,h})=>{
    const mesh=textPanel(text,color,'#fff6e2',w,h);
    mesh.position.set(x,y,z);mesh.rotation.y=yaw;
    group.add(mesh);
    return mesh;
  });
  obstacles.beginOwner('commerce');
  for(const {x,z,radius,records,mass,threshold} of breakables){
    const y=world.height(x,z);
    obstacles.addBreakableProp(x,z,radius,car=>{
      for(const record of records){const [mesh,index]=record.instance;mesh.setMatrixAt(index,hidden);mesh.instanceMatrix.needsUpdate=true;}
      const main=records[0], piece=new T.Mesh(unit,spec.wood[1]);
      piece.position.set(main[0],main[1],main[2]);piece.scale.set(Math.min(1,main[3]),Math.min(1,main[4]),Math.min(1,main[5]));
      debris.add(piece,{kind:'box',mass,h:[.25,.25,.25],v:new T.Vector3(car.v[0]*.7,2.4,car.v[2]*.7),w:new T.Vector3(4,3,-5),owner:group});
    },{mass,threshold,bottom:y-.3,top:y+3});
  }
  obstacles.endOwner();

  // ---- Parked cars ---------------------------------------------------------------------------
  const carShape=parkedCarGeometry();
  const carBodies=new T.InstancedMesh(carShape,new T.MeshStandardMaterial({vertexColors:true,roughness:.34,metalness:.35,side:T.DoubleSide}),parkedCars.length+MOVERS);
  geometries.push(carShape);
  carBodies.frustumCulled=false;carBodies.castShadow=true;group.add(carBodies);
  const pose=new T.Object3D(), tint=new T.Color();
  const demand=hour=>hour<7?.04:hour<9?.25:hour<11?.6:hour<13?.8:hour<17?.72:hour<19.5?.9:hour<21.5?.45:.08;
  let shown=-1, staticCars=0;
  function refreshCars(hour,player) {
    const level=demand(hour);
    let count=0;
    for(const car of parkedCars){
      const away=Math.hypot(car.x-player.cx,car.z-player.cz)>190;
      // Bays only fill or empty while the player is too far away to see the change.
      if(!car.held&&(away||shown<0))car.visible=car.bay.rank<level*(car.pad.kind==='parking'?.75:1);
      if(!car.visible)continue;
      pose.position.set(car.x,car.y,car.z);pose.rotation.set(0,car.yaw,0);pose.scale.set(car.width,car.height,car.length);pose.updateMatrix();
      carBodies.setMatrixAt(count,pose.matrix);
      carBodies.setColorAt(count,tint.set(car.color));
      count++;
    }
    staticCars=count;
    shown=hour;
  }

  const openAt=(site,hour)=>site.kind==='restaurant'||site.kind==='diner'?hour>=11.5&&hour<14.6||hour>=18.5&&hour<23:
    site.pad?.kind==='fuel'?true:site.kind==='mall'?hour>=9&&hour<21:site.kind==='market'?hour>=8.5&&hour<21:hour>=8.5&&hour<19.5;

  // ---- Customers on foot: from their own front door to a shop or a restaurant table ----------
  const crowdRng=random(world.seed^0x55c21);
  const footprints=new Map();
  for(const house of region.obstacles){
    const key=Math.floor(house.x/40)+':'+Math.floor(house.z/40);
    if(!footprints.has(key))footprints.set(key,[]);
    footprints.get(key).push(house);
  }
  const nearbyHouses=(x,z)=>{
    const out=[],column=Math.floor(x/40),row=Math.floor(z/40);
    for(let i=-2;i<=2;i++)for(let j=-2;j<=2;j++)out.push(...(footprints.get((column+i)+':'+(row+j))||[]));
    return out;
  };
  const indoors=(x,z)=>nearbyHouses(x,z).some(house=>{
    const dx=x-house.x,dz=z-house.z,c=Math.cos(house.rotation),s=Math.sin(house.rotation);
    return Math.abs(dx*c-dz*s)<house.halfX+.3&&Math.abs(dx*s+dz*c)<house.halfZ+.3;
  });
  // A walk stays on pavement and gardens: it never crosses a carriageway or a building.
  function walkable(a,b) {
    const steps=Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/2.5);
    for(let i=0;i<=steps;i++){
      const x=a[0]+(b[0]-a[0])*i/steps,z=a[1]+(b[1]-a[1])*i/steps,[u,v]=world.grid(x,z);
      if(indoors(x,z)||world.land(x,z)===3||world.roadDistance(u,v,true)<.15)return false;
    }
    return true;
  }
  const lengthsOf=route=>route.reduce((list,point,i)=>{
    list.push(i?list[i-1]+Math.hypot(point[0]-route[i-1][0],point[1]-route[i-1][1]):0);
    return list;
  },[]);
  const person=rng=>({hue:rng(),trousers:rng(),skin:rng(),height:.86+rng()*.24,variant:Math.floor(rng()*64),pace:1.05+rng()*.45,mood:rng()});
  const walkers=[];
  for(const site of sites){
    if(site.pad||walkers.length>=1100)continue;
    const wanted=Math.round((site.kind==='restaurant'?Math.max(3,site.seats.length):3)*world.peopleScale);
    const door=[site.x+site.nx*2,site.z+site.nz*2];
    const homes=nearbyHouses(site.x,site.z).filter(house=>house.entry&&house!==site.house&&
      Math.hypot(house.entry[0]-site.x,house.entry[1]-site.z)>14&&Math.hypot(house.entry[0]-site.x,house.entry[1]-site.z)<85);
    let seat=0;
    for(let tries=0,found=0;tries<14&&found<wanted&&homes.length;tries++){
      const home=homes[Math.floor(crowdRng()*homes.length)];
      const porch=[home.entry[0]+home.front[0]*2,home.entry[1]+home.front[1]*2];
      if(!walkable(porch,door))continue;
      const place=site.seats[seat++];
      const end=place?[place.x,place.z]:[site.x-site.nx*.6,site.z-site.nz*.6];
      const route=[[home.entry[0]-home.front[0]*.5,home.entry[1]-home.front[1]*.5],porch,door,end];
      const roll=crowdRng();
      walkers.push({...person(crowdRng),type:'foot',site,seat:place,route,lengths:lengthsOf(route),total:0,
        state:roll<.3?'there':'home',wait:crowdRng()*(roll<.3?60:25),at:0,y:null});
      found++;
    }
  }
  for(const walker of walkers){walker.total=walker.lengths.at(-1);if(walker.state==='there')walker.at=walker.total;}

  // ---- Car park shoppers: they get out of a parked car, go in, come back and drive off ---------
  const padSite=pad=>sites.find(site=>site.pad===pad);
  function lotTrip(walker,bayCar) {
    const {pad}=bayCar, {bay}=bayCar;
    const side=padPoint(pad,bay.a+1.75,bay.b), aisle=padPoint(pad,bay.a+1.75,pad.lotEnd-.5);
    const mouth=padPoint(pad,0,pad.lotEnd+1), door=padPoint(pad,0,pad.front-1.2), inside=padPoint(pad,0,pad.front-.1);
    walker.route=[side,aisle,mouth,door,inside];
    walker.lengths=lengthsOf(walker.route);walker.total=walker.lengths.at(-1);walker.y=pad.y+.03;
    walker.bayCar=bayCar;
  }
  const lotWalkers=[];
  for(const pad of world.pads){
    if(!pad.building||pad.kind==='fuel')continue;
    const site=padSite(pad), count=Math.round((pad.kind==='mall'?26:pad.kind==='market'?14:6)*world.peopleScale);
    for(let i=0;i<count;i++)lotWalkers.push({...person(crowdRng),type:'lot',site,pad,state:'home',wait:crowdRng()*70,at:0,route:null,lengths:[0],total:0});
  }
  walkers.push(...lotWalkers);

  // ---- Cars that arrive from the road, park, wait for their driver and leave ------------------
  const chaikin=points=>{
    let out=points;
    for(let pass=0;pass<3;pass++){
      const next=[out[0]];
      for(let i=1;i<out.length;i++){
        const [a,b]=[out[i-1],out[i]];
        if(i>1)next.push([a[0]*.75+b[0]*.25,a[1]*.75+b[1]*.25]);
        if(i<out.length-1)next.push([a[0]*.25+b[0]*.75,a[1]*.25+b[1]*.75]);
      }
      next.push(out.at(-1));out=next;
    }
    return out;
  };
  function lanes(pad) {
    const {road,along,span}=pad.road, right=road.alongX?1:-1;
    const test=sign=>{const [x,z]=road.alongX?world.point(along,road.cross+sign*1.75):world.point(road.cross+sign*1.75,along);return Math.hypot(x-pad.cx,z-pad.cz);};
    const lateral=test(1)<test(-1)?1.75:-1.75, direction=Math.sign(lateral)*right;
    const at=s=>road.alongX?world.point(s,road.cross+lateral):world.point(road.cross+lateral,s);
    const clamp=s=>Math.max(span[0]+8,Math.min(span[1]-8,s));
    return {at,direction,clamp};
  }
  const movers=[];
  for(const pad of world.pads){
    if(!pad.road||!pad.building||pad.kind==='fuel')continue;
    const site=padSite(pad), count=Math.round((pad.kind==='mall'?5:pad.kind==='market'?3:2)*Math.min(2,world.trafficScale));
    for(let i=0;i<count&&movers.length<MOVERS;i++)movers.push({pad,site,state:'away',wait:crowdRng()*60,at:0,path:null,lengths:null,total:0,speed:0,
      color:CAR_COLORS[Math.floor(crowdRng()*CAR_COLORS.length)],length:4.2+crowdRng()*.5,height:1.45+crowdRng()*.2,box:null,bayCar:null,driver:null});
  }
  const AISLE_OFFSET=5.8;
  function lotPath(pad,bay) {
    const drive=pad.driveways[0].a, aisle=bay.b-bay.facing*AISLE_OFFSET, cross=Math.sign(bay.a||1)*(pad.w/2-4.5);
    return [[drive,-pad.gap],[drive,4.9],[cross,4.9],[cross,aisle],[bay.a,aisle]].map(([a,b])=>padPoint(pad,a,b));
  }
  function setPath(mover,points,lot) {
    mover.path=points;mover.lengths=lengthsOf(points);mover.total=mover.lengths.at(-1);mover.at=0;mover.lotFrom=lot;
  }
  function arrive(mover) {
    const {pad}=mover, free=parkedCars.filter(car=>car.pad===pad&&!car.visible&&!car.held&&Math.abs(car.bay.a)<pad.w*.36);
    if(!free.length)return false;
    const bayCar=free[Math.floor(crowdRng()*free.length)], lane=lanes(pad), entry=pad.road.along+pad.driveways[0].a;
    const road=[];
    for(let k=26;k>=1;k--)road.push(lane.at(lane.clamp(entry-lane.direction*k*14)));
    const lot=lotPath(pad,bayCar.bay);
    const points=[...road,...chaikin([lane.at(entry),...lot,padPoint(pad,bayCar.bay.a,bayCar.bay.b)])];
    bayCar.held=true;mover.bayCar=bayCar;mover.color=mover.color;
    setPath(mover,points,road.length);mover.state='in';mover.speed=11;mover.reverse=0;
    return true;
  }
  function depart(mover) {
    const {pad,bayCar}=mover, lane=lanes(pad), entry=pad.road.along+pad.driveways[0].a;
    const lot=lotPath(pad,bayCar.bay).reverse();
    const back=padPoint(pad,bayCar.bay.a,bayCar.bay.b);
    const road=[];
    for(let k=2;k<=28;k++)road.push(lane.at(lane.clamp(entry+lane.direction*k*14)));
    const forward=chaikin([...lot,lane.at(entry+lane.direction*10)]);
    setPath(mover,[back,...forward,...road],forward.length+1);
    mover.reverse=Math.hypot(back[0]-lot[0][0],back[1]-lot[0][1]);
    bayCar.visible=false;bayCar.held=false;mover.bayCar=null;mover.state='out';mover.speed=0;
    if(mover.driver){mover.driver.owner=null;mover.driver.done=false;mover.driver.wait=60+mover.driver.mood*200;mover.driver=null;}
    refreshCars(clock,lastPlayer);
  }
  const carPose=new T.Object3D(), moverTint=new T.Color();
  let lastPlayer={cx:0,cz:0}, activeMovers=[];
  function stepMovers(dt,hour,player,traffic) {
    activeMovers=[];
    for(const mover of movers){
      const near=Math.hypot(mover.pad.cx-player.cx,mover.pad.cz-player.cz)<760;
      if(mover.state==='away'){
        mover.wait-=dt;
        if(mover.wait<=0&&near&&openAt(mover.site,hour)){
          mover.wait=15;
          const lane=lanes(mover.pad),[sx,sz]=lane.at(lane.clamp(mover.pad.road.along-lane.direction*364));
          if(Math.hypot(sx-player.cx,sz-player.cz)>300)arrive(mover);
        }
        continue;
      }
      if(mover.state==='parked'){
        const driver=mover.driver;
        if(driver.state==='home'&&driver.done)depart(mover);
        continue;
      }
      let i=1;while(i<mover.lengths.length-1&&mover.lengths[i]<mover.at)i++;
      const a=mover.path[i-1],b=mover.path[i],span=Math.max(.01,mover.lengths[i]-mover.lengths[i-1]),f=T.MathUtils.clamp((mover.at-mover.lengths[i-1])/span,0,1);
      const x=a[0]+(b[0]-a[0])*f,z=a[1]+(b[1]-a[1])*f;
      let j=i;while(j<mover.lengths.length-1&&mover.lengths[j]<mover.at+3)j++;
      const aim=mover.path[j];
      const backing=mover.state==='out'&&mover.at<mover.reverse;
      const dx=(aim[0]-x)*(backing?-1:1),dz=(aim[1]-z)*(backing?-1:1),norm=Math.hypot(dx,dz)||1,fx=dx/norm,fz=dz/norm;
      const onLot=mover.state==='in'?i>=mover.lotFrom:i<mover.lotFrom;
      const left=mover.total-mover.at;
      let target=backing?1.6:onLot?3.6:12.5;
      if(mover.state==='in'&&!onLot)target=Math.min(target,Math.max(3.6,Math.sqrt(3.2*Math.max(0,mover.lengths[mover.lotFrom]-mover.at))+3.6));
      if(mover.state==='in')target=Math.min(target,Math.sqrt(Math.max(.1,2.4*left)));
      // Give way to anything in front, the player included.
      for(const other of [player,...traffic]){
        const ox=other.cx-x,oz=other.cz-z,ahead=ox*fx+oz*fz,side=Math.abs(ox*fz-oz*fx);
        if(ahead>0&&ahead<(other.hl||2)+4+mover.speed*1.3&&side<1.9)target=0;
      }
      mover.speed+=T.MathUtils.clamp(target-mover.speed,-5*dt,2.2*dt);
      mover.at+=mover.speed*dt;
      if(mover.at>=mover.total){
        if(mover.state==='in'){
          mover.bayCar.visible=true;mover.bayCar.color=mover.color;mover.bayCar.length=mover.length;mover.bayCar.height=mover.height;
          refreshCars(hour,player);
          mover.state='parked';
          const driver=mover.driver=lotWalkers.find(item=>!item.owner&&item.pad===mover.pad&&item.state==='home');
          if(!driver){depart(mover);continue;}
          driver.owner=mover;driver.done=false;lotTrip(driver,mover.bayCar);driver.state='out';driver.at=0;
          continue;
        }
        const end=mover.path.at(-1);
        if(Math.hypot(end[0]-player.cx,end[1]-player.cz)<300){mover.at=mover.total;mover.speed=0;}
        else{mover.state='away';mover.wait=25+crowdRng()*90;continue;}
      }
      const y=(world.padLevel(x,z)??world.roadHeight(x,z)+.16);
      activeMovers.push({mover,x,y,z,fx,fz});
      mover.box={cx:x,cz:z,fx,fz,rx:fz,rz:-fx,y,hl:mover.length/2,hw:.9,mass:1350,vx:fx*mover.speed*(backing?-1:1),vz:fz*mover.speed*(backing?-1:1)};
    }
    let n=staticCars;
    for(const {mover,x,y,z,fx,fz} of activeMovers){
      carPose.position.set(x,y,z);carPose.rotation.set(0,Math.atan2(fx,fz),0);carPose.scale.set(1.76,mover.height,mover.length);carPose.updateMatrix();
      carBodies.setMatrixAt(n,carPose.matrix);carBodies.setColorAt(n,moverTint.set(mover.color));n++;
    }
    carBodies.count=n;carBodies.instanceMatrix.needsUpdate=true;
    if(carBodies.instanceColor)carBodies.instanceColor.needsUpdate=true;
  }

  const crowd=walkingMeshes(Math.max(1,walkers.length));
  group.add(crowd.mesh);
  const attrs=crowd.mesh.geometry.attributes;
  function stepCrowd(dt,hour,player) {
    crowd.time.value+=dt;
    let n=0;
    for(const w of walkers){
      const open=openAt(w.site,hour);
      if(w.state==='home'){
        w.wait-=dt;
        if(w.owner){if(!w.done&&w.at<=0&&w.returning){w.done=true;w.owner.driver=w;w.returning=false;}continue;}
        if(w.wait>0||!open)continue;
        if(w.type==='lot'){
          const cars=parkedCars.filter(car=>car.pad===w.pad&&car.visible&&!car.held&&Math.abs(car.bay.a)<w.pad.w*.36);
          if(!cars.length){w.wait=20;continue;}
          lotTrip(w,cars[Math.floor(crowdRng()*cars.length)]);
          w.bayCar.held=true;
        }
        w.state='out';w.at=0;
      }
      if(w.state==='there'){
        w.wait-=dt;
        if(w.wait<=0||!open){w.state='back';w.returning=true;}
        else if(!w.seat)continue;
      }
      if(w.state==='out'){
        w.at+=w.pace*dt;
        if(w.at>=w.total){w.at=w.total;w.state='there';w.wait=w.seat?75+w.mood*170:w.type==='lot'?50+w.mood*150:30+w.mood*110;if(!w.seat)continue;}
      }else if(w.state==='back'){
        w.at-=w.pace*dt;
        if(w.at<=0){
          w.at=0;w.state='home';w.wait=20+w.mood*70;
          if(w.type==='lot'&&!w.owner&&w.bayCar){w.bayCar.held=false;w.bayCar=null;}
          continue;
        }
      }
      let i=1;while(i<w.lengths.length-1&&w.lengths[i]<w.at)i++;
      const a=w.route[i-1],b=w.route[i],span=Math.max(.01,w.lengths[i]-w.lengths[i-1]),f=T.MathUtils.clamp((w.at-w.lengths[i-1])/span,0,1);
      const x=a[0]+(b[0]-a[0])*f,z=a[1]+(b[1]-a[1])*f;
      if(Math.hypot(x-player.cx,z-player.cz)>230||n>=walkers.length)continue;
      const seated=w.state==='there'&&w.seat, y=w.y??world.height(x,z)+(world.padLevel(x,z)===null?.12:0);
      const dir=w.state==='back'?-1:1;
      attrs.aInst.setXYZW(n,x,z,seated?w.seat.yaw:Math.atan2((b[0]-a[0])*dir,(b[1]-a[1])*dir),seated?crowd.time.value+w.mood*9:w.at*4.2);
      attrs.aLook.setXYZ(n,w.hue,w.trousers,w.skin);
      attrs.aPose.setXY(n,seated?w.seat.y+.05:y,seated?2:0);
      attrs.aVar.setXYZW(n,w.height,w.variant,seated?0:w.pace,0);
      n++;
    }
    crowd.mesh.geometry.instanceCount=n;
    for(const name of ['aInst','aLook','aPose','aVar'])attrs[name].needsUpdate=true;
  }

  let timer=0, clock=8.5;
  return {group,sites,shopCount:sites.length,padCount:world.pads.length,
    // The pump bay a car has stopped at, if any.
    pumpAt(x,z) {
      for(const pad of world.pads){
        if(pad.kind!=='fuel'||Math.hypot(pad.cx-x,pad.cz-z)>pad.radius)continue;
        for(const stop of pad.stops){
          const [sx,sz]=padPoint(pad,stop.a,stop.b);
          if(Math.hypot(sx-x,sz-z)<3.4)return {pad,number:stop.number};
        }
      }
      return null;
    },
    nearby(x,z,speed) {
      if(Math.abs(speed)>2.6)return null;
      let best=null,range=10.5;
      for(const site of sites){
        const d=Math.hypot(site.x-x,site.z-z);
        if(d<range&&openAt(site,clock)){range=d;best=site;}
      }
      return best;
    },
    // Cars standing in the bays within reach of a walker, and the way to take one: the bay empties for good.
    parkedNear(x,z,range) {
      return parkedCars.filter(car=>car.visible&&!car.held&&Math.hypot(car.x-x,car.z-z)<range);
    },
    takeParked(car) {
      car.held=true;car.visible=false;
      refreshCars(clock,lastPlayer||{cx:car.x,cz:car.z});
    },
    // Parked cars near the player are solid.
    boxes(player) {
      const out=[];
      for(const {mover} of activeMovers)if(mover.box&&Math.hypot(mover.box.cx-player.cx,mover.box.cz-player.cz)<60)out.push(mover.box);
      for(const car of parkedCars){
        if(!car.visible||Math.abs(car.x-player.cx)>45||Math.abs(car.z-player.cz)>45)continue;
        const fx=Math.sin(car.yaw),fz=Math.cos(car.yaw);
        out.push({cx:car.x,cz:car.z,fx,fz,rx:fz,rz:-fx,y:car.y,hl:car.length/2,hw:car.width/2,mass:1300,vx:0,vz:0});
      }
      return out;
    },
    get visitors(){return {onFoot:walkers.filter(w=>w.state!=='home').length,cars:activeMovers.length,parked:movers.filter(m=>m.state==='parked').length,walkers:walkers.length};},
    update(dt,hour,player,lowDetail=false,traffic=[]) {
      clock=hour;lastPlayer=player;
      timer-=dt;
      if(timer<=0||shown<0){timer=6;refreshCars(hour,player);}
      stepMovers(dt,hour,player,traffic);
      stepCrowd(dt,hour,player);
      const dusk=hour<7.2||hour>18.2?1:.28;
      for(const [material,base] of glow)material.emissiveIntensity=base*dusk*2;
      for(const mesh of near){const {center,radius}=mesh.boundingSphere;mesh.visible=Math.hypot(player.cx-center.x,player.cz-center.z)<(lowDetail?120:300)+radius;}
      for(const mesh of far){const {center,radius}=mesh.boundingSphere;mesh.visible=Math.hypot(player.cx-center.x,player.cz-center.z)<1500+radius;}
      for(const sign of signs)sign.visible=Math.hypot(player.cx-sign.position.x,player.cz-sign.position.z)<(lowDetail?120:260);
    },
    dispose(){
      for(const geometry of geometries)geometry.dispose();
      for(const sign of signs)sign.geometry.dispose();
      for(const material of signCache.values()){material.map.dispose();material.dispose();}
      signCache.clear();
      tarmacMesh.material.dispose();carBodies.material.dispose();carBodies.dispose();
      for(const [,material] of Object.values(spec).map(item=>item))material.dispose();
    }};
}
