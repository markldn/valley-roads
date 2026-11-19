// The small things that make a place lived in: gardens, fences, mailboxes, bins, sheds, washing lines,
// street furniture, drains, zebra crossings and overhead lines along the country roads.
import * as T from '../vendor/three.module.js';
import { batchInstances } from './scenery.js';
import { surface } from '../render/visuals.js';
import { cellSeed, random } from './world.js';

const FLOWERS=[0xd8486a,0xf0c23c,0xe9e3f2,0xb04fc0,0xe8743a,0x6f8fe8];
const LEAVES=[0x4f7433,0x3f6530,0x5f8240,0x6c8a3f];
const WOOD=[0x8a6a48,0x6f5238,0xa98a63,0xd8d2c2,0x5f7468];

export function createTownscape(world,region,obstacles,debris) {
  const group=new T.Group();
  const lists={box:[],soft:[],post:[],leaf:[],flat:[],metal:[]};
  const hidden=new T.Matrix4().makeScale(0,0,0);
  const chipMaterials=new Map();
  const chipGeometry=new T.BoxGeometry();
  const chip=tint=>{
    if(!chipMaterials.has(tint))chipMaterials.set(tint,new T.MeshStandardMaterial({color:tint,roughness:.8}));
    return chipMaterials.get(tint);
  };
  // Records that disappear together when the car goes through them.
  const breakables=[];
  function breakable(x,z,radius,records,mass,threshold) {
    breakables.push({x,z,radius,records,mass,threshold});
  }
  const add=(list,x,y,z,sx,sy,sz,yaw,tint,tilt=0)=>{
    const record=[x,y,z,sx,sy,sz,yaw,tint,tilt];
    lists[list].push(record);
    return record;
  };

  // Footprints, to keep everything out of the walls.
  const lots=new Map();
  for(const house of region.obstacles){
    const key=Math.floor(house.x/24)+':'+Math.floor(house.z/24);
    if(!lots.has(key))lots.set(key,[]);
    lots.get(key).push(house);
  }
  function insideHouse(x,z,margin=.35) {
    const column=Math.floor(x/24),row=Math.floor(z/24);
    for(let i=-1;i<=1;i++)for(let j=-1;j<=1;j++)for(const house of lots.get((column+i)+':'+(row+j))||[]){
      const dx=x-house.x,dz=z-house.z,c=Math.cos(house.rotation),s=Math.sin(house.rotation);
      if(Math.abs(dx*c-dz*s)<house.halfX+margin&&Math.abs(dx*s+dz*c)<house.halfZ+margin)return true;
    }
    return false;
  }
  function open(x,z,margin=.7) {
    if(world.land(x,z)>=3||insideHouse(x,z))return false;
    const [u,v]=world.grid(x,z);
    return world.roadDistance(u,v,true)>margin&&(world.nearestStreet(u,v)?.edge??9)>margin&&!world.highwayAt(u,v,4);
  }

  function garden(house) {
    const rng=random(cellSeed(world.seed^0x7711,Math.round(house.x*2),Math.round(house.z*2)));
    const {rotation:yaw,halfX:hw,halfZ:hd,front:[fx,fz]}=house;
    const tx=Math.cos(yaw),tz=-Math.sin(yaw);
    const at=(a,b)=>[house.x+tx*a+fx*b,house.z+tz*a+fz*b];
    const ground=(x,z)=>world.height(x,z);
    const pick=list=>list[Math.floor(rng()*list.length)];
    // Depth of the front garden, measured out to the road.
    let yard=0;
    for(let b=hd+.6;b<hd+11;b+=.5){if(!open(...at(0,b),1.2))break;yard=b-hd;}
    const door=at(0,hd+.34);
    add('flat',door[0],ground(...door)+.03,door[1],.9,.03,.5,yaw,0x5b4a3a);
    for(const side of [-1,1]){
      const [px,pz]=at(side*1.05,hd+.3);
      add('box',px,ground(px,pz)+.2,pz,.3,.4,.3,yaw,0xa8583a);
      add('leaf',px,ground(px,pz)+.56,pz,.22,.26,.22,0,pick(LEAVES));
      add('leaf',px+.06,ground(px,pz)+.68,pz,.08,.08,.08,0,pick(FLOWERS));
    }
    const [lx,lz]=at(.95,hd+.05);
    add('metal',lx,ground(lx,lz)+2.35,lz,.14,.22,.12,yaw,0x2b2e2f);
    const [nx,nz]=at(-.95,hd+.03);
    add('box',nx,ground(nx,nz)+1.75,nz,.26,.18,.03,yaw,0x2f5f8f);
    if(rng()<.5){
      const [ax,az]=at((rng()-.5)*hw,hd*(rng()-.5)*.6);
      const top=ground(ax,az)+house.floors*3+1.2;
      add('metal',ax,top+.7,az,.025,1.8,.025,yaw,0x777b7c);
      for(let i=0;i<4;i++)add('metal',ax,top+1.0+i*.17,az,.8-i*.15,.018,.018,yaw+.6,0x777b7c);
    }
    if(rng()<.3){
      const [ax,az]=at(hw*.72*(rng()<.5?1:-1),hd+.12);
      add('soft',ax,ground(ax,az)+house.floors*2.4,az,.34,.34,.08,yaw,0xd9d9d2,.5);
    }
    if(yard>=2.4){
      const line=hd+yard-.9;
      for(let b=hd+.9;b<line;b+=.72){
        const [sx,sz]=at((rng()-.5)*.14,b);
        add('flat',sx,ground(sx,sz)+.03,sz,.62,.04,.52,yaw+(rng()-.5)*.2,0x9a958a);
      }
      const style=rng();
      const span=hw+1.4, gate=.75;
      for(let a=-span;a<span-.01;a+=1.8){
        const mid=a+.9;
        if(Math.abs(mid)<gate+.5)continue;
        const [x,z]=at(mid,line);
        if(!open(x,z,.5))continue;
        const y=ground(x,z), records=[];
        if(style<.38){
          const paint=pick(WOOD);
          records.push(add('box',x,y+.42,z,1.78,.07,.03,yaw,paint),add('box',x,y+.74,z,1.78,.07,.03,yaw,paint));
          for(let p=-3;p<=3;p++){
            const [qx,qz]=at(mid+p*.26,line+.02);
            records.push(add('box',qx,y+.5,qz,.09,.92+(p%2)*.05,.018,yaw,paint));
          }
          breakable(x,z,.5,records,18,120);
        }else if(style<.72){
          records.push(add('leaf',x,y+.55+rng()*.1,z,1.05,.68+rng()*.14,.48,yaw,pick(LEAVES)));
          breakable(x,z,.5,records,30,160);
        }else{
          records.push(add('box',x,y+.3,z,1.8,.6,.24,yaw,0x9d9483),add('box',x,y+.63,z,1.86,.07,.3,yaw,0x7f786b));
          breakable(x,z,.55,records,240,1500);
        }
      }
      // Mailbox at the gate.
      const [mx,mz]=at(gate+.34,line);
      if(open(mx,mz,.4)){
        const y=ground(mx,mz), tint=rng()<.7?0xe8b92c:0x4c6a58;
        breakable(mx,mz,.12,[add('post',mx,y+.55,mz,.04,1.1,.04,0,0x4d4f50),
          add('box',mx,y+1.2,mz,.34,.28,.26,yaw,tint),add('box',mx,y+1.34,mz,.36,.05,.28,yaw,0x38393a)],9,70);
      }
      // Wheelie bins by the side of the house.
      const binSide=rng()<.5?1:-1;
      ['0x2f5e3d','0xd6b52c'].forEach((tint,i)=>{
        const [bx,bz]=at(binSide*(hw-.45-i*.72),hd+.62);
        if(!open(bx,bz,.5))return;
        const y=ground(bx,bz);
        breakable(bx,bz,.32,[add('box',bx,y+.5,bz,.58,1,.68,yaw,Number(tint)),add('box',bx,y+1.04,bz,.62,.07,.74,yaw,0x2a2c2d)],14,90);
      });
      // Beds under the windows and a few plants on the lawn.
      for(let a=-hw+.7;a<hw-.5;a+=.46){
        if(Math.abs(a)<1.3||rng()<.25)continue;
        const [x,z]=at(a,hd+.42+rng()*.3);
        const y=ground(x,z);
        add('leaf',x,y+.16,z,.24,.2+rng()*.14,.22,rng()*6,pick(LEAVES));
        if(rng()<.7)add('leaf',x,y+.34,z,.07,.06,.07,0,pick(FLOWERS));
      }
      for(let i=0,n=1+Math.floor(rng()*3);i<n;i++){
        const [x,z]=at((rng()<.5?-1:1)*(1.2+rng()*(hw-.8)),hd+1.1+rng()*Math.max(.2,yard-2.4));
        if(!open(x,z,.8))continue;
        const y=ground(x,z), size=.35+rng()*.5;
        add('leaf',x,y+size*.75,z,size,size*.95,size,rng()*6,pick(LEAVES));
      }
      if(rng()<.3&&yard>3.4){
        const [x,z]=at((rng()<.5?-1:1)*(hw*.6+rng()),hd+yard*.5);
        if(open(x,z,1.2))tree(x,z,2.8+rng()*2.2,rng);
      }
    }
    // Back garden.
    let back=0;
    for(let b=hd+.8;b<hd+13;b+=.8){if(!open(...at(0,-b),1))break;back=b-hd;}
    if(back>=3.5){
      if(rng()<.45){
        const [x,z]=at((rng()<.5?-1:1)*(hw*.55),-(hd+back*.7));
        if(open(x,z,1.4)){
          const y=ground(x,z), paint=pick(WOOD);
          add('box',x,y+.95,z,2.3,1.9,1.9,yaw+.05,paint);
          add('box',x,y+2.0,z,2.6,.12,2.2,yaw+.05,0x4d4a48,.14);
          add('box',x+tx*.4+fx*.96,y+.85,z+tz*.4+fz*.96,.72,1.6,.04,yaw+.05,0x4c3a2b);
          obstacles.addPosts([[x,z]],1.25);
        }
      }
      if(rng()<.4){
        const [ax,az]=at(-hw*.55,-(hd+back*.45)), [bx,bz]=at(hw*.55,-(hd+back*.45));
        if(open(ax,az,1)&&open(bx,bz,1)){
          const y=ground(ax,az), length=Math.hypot(bx-ax,bz-az);
          add('post',ax,y+1,az,.03,2,.03,0,0x8b8f90);add('post',bx,ground(bx,bz)+1,bz,.03,2,.03,0,0x8b8f90);
          add('metal',(ax+bx)/2,y+1.9,(az+bz)/2,length,.012,.012,yaw,0xc4c6c6);
          for(let i=0,n=3+Math.floor(rng()*5);i<n;i++){
            const f=(i+.5)/n,w=.4+rng()*.5,h=.5+rng()*.5;
            add('box',ax+(bx-ax)*f,y+1.88-h/2,az+(bz-az)*f,w,h,.015,yaw,pick([0xe9e6dc,0xc25050,0x4f79b8,0xe6c94d,0x74a56f]));
          }
        }
      }
      if(rng()<.4){
        const [x,z]=at(hw*.4,-(hd+back*.35));
        if(open(x,z,1.2))for(let row=0;row<4;row++)for(let i=0;i<6;i++){
          const [px,pz]=at(hw*.4-1+i*.42,-(hd+back*.35)+row*.5);
          add('leaf',px,ground(px,pz)+.13,pz,.16,.13+rng()*.1,.16,rng()*6,pick(LEAVES));
        }
      }
      if(rng()<.65){
        const [x,z]=at((rng()-.5)*hw*1.5,-(hd+back*(.6+rng()*.3)));
        if(open(x,z,1.4))tree(x,z,3.6+rng()*3,rng);
      }
    }
  }
  function tree(x,z,height,rng) {
    const y=world.height(x,z), crown=height*.42;
    add('post',x,y+height*.32,z,.09,height*.64,.09,0,0x5a4632);
    add('leaf',x,y+height*.68,z,crown,crown*.92,crown,rng()*6,LEAVES[Math.floor(rng()*LEAVES.length)]);
    add('leaf',x+crown*.3,y+height*.84,z-crown*.2,crown*.7,crown*.6,crown*.7,rng()*6,LEAVES[Math.floor(rng()*LEAVES.length)]);
    obstacles.addPosts([[x,z]],.14);
  }
  for(const house of region.obstacles)if(house.entry&&house.floors<=3)garden(house);

  // ---- Street furniture along the town streets.
  const rng=random(world.seed^0x3321c);
  for(const street of world.streets.filter(item=>item.urban)){
    let run=0;
    for(let i=1;i<street.points.length;i++){
      const [u,v]=street.points[i-1],[U,V]=street.points[i],length=Math.hypot(U-u,V-v)||1;
      const du=(U-u)/length,dv=(V-v)/length;
      for(let s=0;s<length;s+=6,run+=6){
        const spot=offset=>{
          const [x,z]=world.point(u+du*s-dv*offset,v+dv*s+du*offset);
          return [x,z,world.roadHeight(x,z)+.23];
        };
        const side=run%12?1:-1, kerb=side*(street.width/2+.42), walk=side*(street.width/2+1.45);
        const yaw=Math.atan2(du,dv);
        if(run%24===0){
          const [x,z,y]=spot(side*(street.width/2-.25));
          add('flat',x,y-.05,z,.5,.03,.32,yaw,0x2b2d2e);
        }
        if(run%48===0){
          const [x,z,y]=spot(0);
          add('flat',x,y-.055,z,.68,.03,.68,yaw+.8,0x3a3b3b);
        }
        if(world.highwayAt(u+du*s,v+dv*s,4))continue;
        const [px,pz,py]=spot(walk);
        if(insideHouse(px,pz,.2)||world.land(px,pz)>=3)continue;
        // Nothing solid may stand on a carriageway where two streets overlap.
        const [gu,gv]=world.grid(px,pz);
        if((world.nearestStreet(gu,gv)?.edge??9)<.45||world.roadDistance(gu,gv,true)<.45)continue;
        if(run%66===0){
          const records=[add('post',px,py+.43,pz,.25,.86,.25,yaw,0x3d4a44),
            add('post',px,py+.065,pz,.29,.13,.29,yaw,0x2c312f),
            add('post',px,py+.91,pz,.275,.085,.275,yaw,0x2c312f)];
          for(const band of [.21,.74])records.push(add('post',px,py+band,pz,.26,.045,.26,yaw,0x58625a));
          breakable(px,pz,.28,records,22,160);
        }else if(run%96===18){
          const records=[add('box',px,py+.46,pz,1.7,.07,.44,yaw+Math.PI/2,0x8a6a48),add('box',px,py+.76,pz,1.7,.36,.05,yaw+Math.PI/2,0x8a6a48)];
          for(const end of [-.7,.7]){const dx=Math.sin(yaw)*end,dz=Math.cos(yaw)*end;records.push(add('metal',px+dx,py+.3,pz+dz,.06,.6,.4,yaw+Math.PI/2,0x2f3233));}
          breakable(px,pz,.6,records,45,300);
        }else if(run%132===30){
          breakable(px,pz,.14,[add('post',px,py+.42,pz,.11,.84,.11,0,0xb9262b),add('post',px,py+.9,pz,.075,.14,.075,0,0xd9d2c0),
            add('metal',px,py+.56,pz,.32,.07,.07,yaw,0xb9262b)],60,520);
        }else if(run%42===12){
          const [bx,bz,by]=spot(kerb);
          const [ku,kv]=world.grid(bx,bz);
          if((world.nearestStreet(ku,kv)?.edge??9)<.3)continue;
          obstacles.addPosts([[bx,bz]],.07);
          add('post',bx,by+.45,bz,.055,.9,.055,0,0x2d3133);
          add('post',bx,by+.82,bz,.062,.04,.062,0,0xd8d8d0);
        }else if(run%84===54&&street.town?.tier==='hub'){
          tree(px,pz,5.2+rng()*2.4,rng);
          add('flat',px,py-.02,pz,1.1,.03,1.1,yaw,0x45403a);
        }
      }
    }
  }
  // Zebra crossings.
  for(const [u,v,alongX] of world.crossings){
    if(world.highwayAt(u,v,2))continue;
    for(let i=-4;i<=4;i++){
      const across=i*.95;
      const [x,z]=alongX?world.point(u+across,v):world.point(u,v+across);
      const [ax,az]=alongX?world.point(u+across+1,v):world.point(u,v+across+1);
      add('flat',x,world.roadHeight(x,z)+.215,z,.5,.012,3.2,Math.atan2(ax-x,az-z),0xefece2);
    }
  }
  // Overhead lines along the country roads.
  for(const road of world.roads){
    if(road.highway)continue;
    for(const [start,end] of road.spans){
      let previous=null;
      for(let along=start+20;along<end-20;along+=46){
        const across=road.cross+(road.width/2+3.4);
        const [u,v]=road.alongX?[along,across]:[across,along];
        const [x,z]=world.point(u,v);
        const usable=!world.towns.some(town=>Math.hypot(town.u-u,town.v-v)<town.radius+8)&&open(x,z,1.2)&&world.riverEdge(x,z)>8;
        if(!usable){previous=null;continue;}
        const y=world.height(x,z), top=y+7.4;
        const [ax,az]=road.alongX?world.point(along+1,across):world.point(across,along+1);
        const yaw=Math.atan2(ax-x,az-z);
        obstacles.addPosts([[x,z]],.13);
        add('post',x,y+3.7,z,.1,7.5,.1,0,0x5d4a38);
        add('box',x,top-.3,z,.08,.09,1.5,yaw+Math.PI/2,0x4c3c2d);
        if(previous)for(const wire of [-.62,0,.62]){
          const cx=Math.cos(yaw)*wire,cz=-Math.sin(yaw)*wire;
          const span=Math.hypot(x-previous.x,z-previous.z);
          add('metal',(x+previous.x)/2+cx,(top+previous.top)/2-.46,(z+previous.z)/2+cz,.012,.012,span,yaw,0x24262a,0);
        }
        previous={x,z,top};
      }
    }
  }

  const geometries=[new T.BoxGeometry(),new T.IcosahedronGeometry(1,1),new T.CylinderGeometry(1,1,1,8)];
  const materials=[surface(0xffffff,{roughness:.8}),surface(0xffffff,{pattern:'foliage',roughness:.9}),
    surface(0xffffff,{roughness:.42,metalness:.55})];
  const [box,leaf,post]=geometries, [matte,foliage,metal]=materials;
  const meshes=[
    ...batchInstances(group,box,matte,lists.box,160,true,'townscape'),
    ...batchInstances(group,box,matte,lists.soft,160,false,'townscape'),
    ...batchInstances(group,box,matte,lists.flat,160,false,'townscape'),
    ...batchInstances(group,leaf,foliage,lists.leaf,160,true,'townscape'),
    ...batchInstances(group,post,matte,lists.post,160,true,'townscape'),
    ...batchInstances(group,box,metal,lists.metal,160,false,'townscape'),
  ];
  obstacles.beginOwner('townscape');
  for(const {x,z,radius,records,mass,threshold} of breakables){
    const y=world.height(x,z);
    obstacles.addBreakableProp(x,z,radius,car=>{
      for(const record of records){
        const [mesh,index]=record.instance;
        mesh.setMatrixAt(index,hidden);
        mesh.instanceMatrix.needsUpdate=true;
      }
      const main=records[0], piece=new T.Mesh(chipGeometry,chip(main[7]));
      piece.position.set(main[0],main[1],main[2]);
      piece.scale.set(main[3],main[4],main[5]);
      piece.rotation.y=main[6];
      debris.add(piece,{kind:'box',mass:Math.min(40,mass),h:[main[3]/2,main[4]/2,main[5]/2],
        v:new T.Vector3(car.v[0]*.7,2+Math.hypot(car.v[0],car.v[2])*.12,car.v[2]*.7),
        w:new T.Vector3(4,3,-5),owner:group});
    },{mass,threshold,bottom:y-.3,top:y+2.5});
  }
  obstacles.endOwner();
  return {group,pieces:Object.values(lists).reduce((sum,list)=>sum+list.length,0),
    update(x,z,lowDetail=false){
      const reach=lowDetail?110:280;
      for(const mesh of meshes){
        const {center,radius}=mesh.boundingSphere;
        mesh.visible=Math.hypot(x-center.x,z-center.z)<reach+radius;
      }
    },dispose(){
      for(const geometry of geometries)geometry.dispose();
      for(const material of materials)material.dispose();
      for(const material of chipMaterials.values())material.dispose();
      chipGeometry.dispose();
    }};
}
