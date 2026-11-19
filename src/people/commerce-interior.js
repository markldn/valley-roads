// Walk-in interiors: a mall concourse with shops and a food court, supermarket aisles,
// a restaurant dining room and a small shop fitted out for its trade.
import * as T from '../vendor/three.module.js';
import { walkingMeshes } from '../traffic/population.js';
import { surface } from '../render/visuals.js';

function sign(text,color,width,height) {
  const art=document.createElement('canvas');
  art.width=768;art.height=Math.round(768*height/width);
  const ctx=art.getContext('2d');
  ctx.fillStyle='#'+color.toString(16).padStart(6,'0');ctx.fillRect(0,0,art.width,art.height);
  ctx.fillStyle='#fff6e2';ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.font=`700 ${Math.round(art.height*.56)}px Georgia,serif`;
  ctx.fillText(text,art.width/2,art.height*.54,art.width*.9);
  const map=new T.CanvasTexture(art);map.colorSpace=T.SRGBColorSpace;
  return new T.Mesh(new T.PlaneGeometry(width,height),new T.MeshBasicMaterial({map,toneMapped:false}));
}

const STORES=[['Mode & Co',0xc83f5a],['Sport Alpin',0x1f7a4d],['Électro Plus',0x1f4f9a],['Parfums Iris',0x7a4f9a],
  ['Maison Verte',0x4f7a2a],['Librairie Mille Pages',0xa8551e],['Bijoux Lumière',0xa8862a],['Jouets & Cie',0xd8503a],
  ['Chaussures Lucas',0x5a3a28],['Optique Moreau',0x1f5f86]];
const STOCK=[0xc85070,0x3f8fe0,0xe8c040,0x4f9a58,0xe8e2d4,0x8a4a30,0x7a4f9a,0xd86a30];

export function enterCommerce(scene,site) {
  const group=new T.Group();
  group.position.set(site.x,1400,site.z);
  scene.add(group);
  const made=new Map();
  const mat=(color,options={})=>{
    const key=color+JSON.stringify(options);
    if(!made.has(key))made.set(key,surface(color,options));
    return made.get(key);
  };
  const box=(material,w,h,d,x,y,z)=>{
    const mesh=new T.Mesh(new T.BoxGeometry(w,h,d),material);
    mesh.position.set(x,y,z);group.add(mesh);
    return mesh;
  };
  const solid=[];
  const fixture=(material,w,h,d,x,y,z)=>{solid.push({x,z,w,d});return box(material,w,h,d,x,y,z);};
  const glass=new T.MeshStandardMaterial({color:0xa8ccd4,roughness:.06,metalness:.3,transparent:true,opacity:.26,depthWrite:false});
  const light=new T.MeshStandardMaterial({color:0xffffff,emissive:0xfff4dc,emissiveIntensity:1.6});
  group.add(new T.HemisphereLight(0xfff6e8,0x8a8078,2.7));
  const kind=site.kind;
  let halfX=6, halfZ=7, height=3.3, eye=new T.Vector3(0,1.66,-halfZ+1.2), crowd=3;
  const routes=[];
  function room(wall,floor,w,d,h) {
    halfX=w/2;halfZ=d/2;height=h;
    box(floor,w,.2,d,0,-.1,0);
    box(mat(0xefece4),w,.15,d,0,h,0);
    box(wall,.2,h,d,-w/2,h/2,0);box(wall,.2,h,d,w/2,h/2,0);
    box(wall,w,h,.2,0,h/2,-d/2);box(wall,w,h,.2,0,h/2,d/2);
  }
  function title(text,color,w,h,x,y,z,yaw=0) {
    const mesh=sign(text,color,w,h);
    mesh.position.set(x,y,z);mesh.rotation.y=yaw;group.add(mesh);
  }
  if(kind==='mall'){
    room(mat(0xe6e2d8,{pattern:'plaster'}),mat(0xd8d2c4,{pattern:'concrete',roughness:.28}),24,84,9);
    eye.set(0,1.66,-38);
    // Skylight, upper gallery and balustrades.
    for(let z=-36;z<=36;z+=8)box(light,9,.08,5,0,8.9,z);
    for(const side of [-1,1]){
      box(mat(0xd8d4ca),6,.3,84,side*9,4.5,0);
      box(glass,.05,1,84,side*5.98,5.15,0);
      box(mat(0x70767a,{metalness:.6,roughness:.3}),.08,.06,84,side*5.98,5.66,0);
    }
    // Two levels of shop units along both sides.
    STORES.forEach(([name,color],i)=>{
      const side=i%2?1:-1, z=-32+Math.floor(i/2)*16, x=side*11.9;
      for(const level of [0,4.65]){
        const label=level?STORES[(i+3)%STORES.length]:[name,color];
        box(mat(0xfff4e0,{emissive:0xfff0d8,emissiveIntensity:.5}),.1,3.4,13,x,level+1.8,z);
        box(glass,.06,3.2,12.6,side*11.2,level+1.7,z);
        for(let m=-6;m<=6;m+=3)box(mat(0x30343a,{metalness:.5,roughness:.4}),.1,3.3,.08,side*11.17,level+1.7,z+m);
        for(let shelf=0;shelf<3;shelf++)for(let n=0;n<14;n++)
          box(mat(STOCK[(n+shelf+i)%STOCK.length]),.3,.42,.5,side*11.65,level+.65+shelf*.82,z-5.6+n*.86);
        title(label[0],label[1],9.6,.86,side*11.14,level+3.8,z,side>0?-Math.PI/2:Math.PI/2);
      }
    });
    // Escalators, planters, benches and a fountain down the middle.
    for(const z of [-22,14]){
      fixture(mat(0x50565c,{metalness:.5,roughness:.35}),1.4,.5,10,-1.6,.25,z);
      const ramp=box(mat(0xa8aeb2,{metalness:.6,roughness:.35}),1.1,.1,11.4,-1.6,2.5,z);ramp.rotation.x=-.44;
      const back=box(mat(0xa8aeb2,{metalness:.6,roughness:.35}),1.1,.1,11.4,1.6,2.5,z);back.rotation.x=.44;
      fixture(mat(0x50565c,{metalness:.5,roughness:.35}),1.4,.5,10,1.6,.25,z);
    }
    for(const z of [-6,6]){
      fixture(mat(0x8a8478,{pattern:'concrete'}),2.8,.62,2.8,0,.31,z);
      for(let i=0;i<7;i++){const leaf=box(mat(0x4f7a3a,{pattern:'foliage'}),.8,.8,.8,Math.cos(i)*.8,1.1+i*.13,z+Math.sin(i)*.8);leaf.rotation.y=i;}
      for(const side of [-1,1])fixture(mat(0x8a6a48),2.2,.46,.56,side*3.6,.23,z);
    }
    // Food court at the far end.
    title('Food Court',0xa8331f,8,1,0,6.6,41.7,Math.PI);
    ['Pizzeria Napoli','Sushi des Rives','Le Grill','Crêpes & Café'].forEach((name,i)=>{
      const x=-9+i*6;
      fixture(mat(0xe8e0d0),5,1.1,1.1,x,.55,39);
      title(name,[0x2c6b3f,0x20242a,0xa8331f,0x1f5a86][i],4.6,.7,x,3.3,41.6,Math.PI);
      box(mat(0xfff0d8,{emissive:0xffe8c8,emissiveIntensity:.6}),4.8,1.5,.1,x,2.1,41.7);
    });
    for(let i=0;i<8;i++){
      const x=-7.5+(i%4)*5, z=26+Math.floor(i/4)*5;
      fixture(mat(0xe8e2d4),1.3,.05,1.3,x,.74,z);box(mat(0x30343a),.08,.74,.08,x,.37,z);
      for(const s of [-1,1])box(mat(0xa8331f),.42,.45,.42,x+s*1,.23,z);
    }
    crowd=22;
    for(let i=0;i<crowd;i++){const x=(i%2?1:-1)*(3+(i%4)*1.5), z0=-36+(i*7)%20;routes.push([[x,z0],[x+(i%3-1)*.8,z0+50]]);}
  }else if(kind==='market'){
    room(mat(0xeeeae0,{pattern:'plaster'}),mat(0xd6d2c8,{pattern:'concrete',roughness:.3}),38,46,6);
    eye.set(0,1.66,-21);
    for(let z=-18;z<=18;z+=6)for(let x=-14;x<=14;x+=7)box(light,3.4,.07,.5,x,5.9,z);
    ['Fruits & Légumes','Épicerie','Boissons','Surgelés','Hygiène'].forEach((name,i)=>{
      const x=-14+i*7;
      title(name,[0x3f8a48,0xb5261e,0x1f5f9a,0x2f7fb0,0x7a4f9a][i],5,.7,x,4.7,4,0);
      const fixtureBody=mat(0xe2e0d8);
      fixture(fixtureBody,1.5,2.1,24,x,1.05,3);
      for(const side of [-1,1])for(let level=0;level<5;level++){
        box(mat(0xc8c6be),.5,.04,24,x+side*.97,.32+level*.45,3);
        for(let n=0;n<40;n++){
          const tall=.18+((n*7+level)%4)*.05;
          box(mat(STOCK[(n+level*3+i)%STOCK.length]),.3,tall,.44,x+side*.97,.34+level*.45+tall/2,-8.6+n*.59);
        }
      }
    });
    for(let i=0;i<6;i++){
      const x=-15+i*6;
      fixture(mat(0x3f464c,{metalness:.4,roughness:.4}),1,.92,3.2,x,.46,-14.5);
      box(mat(0x20242a),.8,.03,2.6,x,.94,-14.5);
      box(light,.08,1.5,.08,x+.5,1.7,-16);
      box(mat(0xb5261e,{emissive:0xb5261e,emissiveIntensity:.5}),.3,.3,.04,x+.5,2.5,-16);
    }
    crowd=10;
    for(let i=0;i<crowd;i++){const x=-10.5+(i%5)*7;routes.push([[x,-7+(i%3)],[x,12-(i%4)]]);}
  }else if(kind==='restaurant'||kind==='diner'){
    room(mat(kind==='diner'?0xd8c49c:0xc8b090,{pattern:'plaster'}),mat(0x7a5a3e,{roughness:.5}),16,18,3.4);
    eye.set(0,1.66,-7.4);
    title(site.name,site.color,6,.8,0,2.6,8.85,Math.PI);
    fixture(mat(0x5a3a28),9,1.1,.9,0,.55,7);
    box(mat(0xd8d2c0,{roughness:.3}),9.2,.06,1.1,0,1.13,7);
    for(let i=0;i<14;i++)box(mat(STOCK[i%STOCK.length]),.14,.36,.14,-4+i*.62,2.1,8.6);
    box(mat(0x4a3024),9,.06,.3,0,1.9,8.6);
    for(let i=0;i<4;i++)box(light,.4,.3,.4,-4.5+i*3,2.7,7);
    for(let row=0;row<3;row++)for(let col=-1;col<=1;col++){
      const x=col*4.6, z=-3.6+row*3.8;
      fixture(mat(0xf0ece2),1.4,.05,1.4,x,.76,z);
      box(mat(0x30343a),.08,.76,.08,x,.38,z);
      for(const [px,pz] of [[.28,.2],[-.3,-.22]]){box(mat(0xffffff,{roughness:.3}),.26,.03,.26,x+px,.8,z+pz);box(mat(0xa8c0c8,{roughness:.1}),.08,.2,.08,x+px*.2,.88,z+pz*.2);}
      for(const s of [-1,1]){box(mat(0x6f4a30),.46,.05,.46,x,.46,z+s*1);box(mat(0x6f4a30),.46,.54,.05,x,.75,z+s*1.23);box(mat(0x4a3024),.05,.46,.05,x,.23,z+s*1);solid.push({x,z:z+s*1,w:.5,d:.5});}
      box(light,.3,.24,.3,x,2.75,z);box(mat(0x30343a),.02,.5,.02,x,3.1,z);
    }
    crowd=8;
    for(let i=0;i<crowd;i++)routes.push({seat:[(i%3-1)*4.6,-3.6+(i%3)*3.8+(i%2?1:-1)]});
    routes[0]={path:[[-6.6,6],[6.6,6]]};
  }else{
    room(mat(0xe8e2d4,{pattern:'plaster'}),mat(0xc3aa89,{pattern:'concrete'}),10,12,3.2);
    eye.set(0,1.66,-4.8);
    title(site.name,site.color,5,.6,0,2.7,5.85,Math.PI);
    fixture(mat(site.color),4.4,1,.8,0,.5,4);
    box(mat(0xe8e0d0),4.6,.05,1,0,1.03,4);
    const goods=site.goods??STOCK;
    for(const side of [-1,1]){
      fixture(mat(0x8a6a48),.5,2.6,8,side*4.6,1.3,-.6);
      for(let level=0;level<5;level++)for(let n=0;n<16;n++){
        const tall=.16+((n+level)%3)*.07;
        box(mat(goods[(n+level)%goods.length]),.32,tall,.34,side*4.2,.45+level*.48+tall/2,-4.1+n*.47);
      }
    }
    if(['bakery','grocer','florist','butcher'].includes(kind)){
      fixture(glass,3.8,.9,1,0,.95,1.8);
      fixture(mat(0xe8e0d0),3.8,.5,1,0,.25,1.8);
      if(kind==='bakery'){
        const crust=mat(0xbb672c,{roughness:.86}), flour=mat(0xe8bf81);
        const bread=new T.SphereGeometry(1,12,8);
        const loaf=(material,x,y,z,w,h,d)=>{
          const mesh=new T.Mesh(bread,material);mesh.position.set(x,y,z);mesh.scale.set(w,h,d);group.add(mesh);
        };
        for(let i=0;i<8;i++){
          const x=-1.55+i*.43;
          loaf(crust,x,.63,1.62,.135,.12,.28);
          for(const z of [1.53,1.63,1.73])loaf(flour,x,.735,z,.077,.011,.021);
          loaf(flour,x,.61,2.02,.13,.085,.12);
        }
        const steel=mat(0x889296,{metalness:.55}), dark=mat(0x253039);
        fixture(steel,1.38,1.95,.76,3.85,.975,4.82);
        for(const y of [.59,1.14,1.66]){
          box(dark,1.17,.37,.055,3.85,y,4.41);
          box(steel,.69,.045,.075,3.85,y+.23,4.37);
        }
        title('Pain · Viennoiseries',site.color,3,.32,0,2.35,5.84,Math.PI);
      }else for(let n=0;n<18;n++)box(mat(goods[n%goods.length]),.22,.14,.22,-1.7+(n%9)*.42,.62,1.55+Math.floor(n/9)*.5);
    }else{
      fixture(mat(0x8a6a48),1.8,.8,3.2,0,.4,-1.2);
      for(let n=0;n<12;n++)box(mat(goods[n%goods.length]),.34,.24,.42,-.45+(n%3)*.45,.92,-2.5+Math.floor(n/3)*.85);
    }
    if(kind==='barber'){
      const chair=mat(0x67485f), metal=mat(0xaeb7bc,{metalness:.65});
      for(const z of [-2.5,-.25,2]){
        box(metal,.04,1.16,1.19,4.21,1.75,z);
        fixture(chair,.61,.10,.61,3.33,.57,z);
        box(chair,.10,.55,.57,3.05,.85,z);
        box(metal,.23,.52,.23,3.33,.27,z);
      }
    }else if(kind==='pharmacy'||kind==='optician'){
      title(kind==='pharmacy'?'Ordonnances':'Examen de la vue',site.color,2.75,.35,0,1.92,5.84,Math.PI);
      box(mat(0xf2f3e9),.93,.63,.07,-3.46,1.6,5.81);
      for(let i=0;i<3;i++)box(mat(site.color),.42-i*.09,.025,.08,-3.46,1.75-i*.15,5.77);
    }else if(kind==='fashion'){
      const metal=mat(0x565f68,{metalness:.5});
      fixture(metal,.08,.08,2.75,2.77,1.65,0);
      for(const z of [-1.33,1.33])box(metal,.06,1.64,.06,2.77,.82,z);
      for(let i=0;i<8;i++)box(mat(goods[i%goods.length]),.66,.62,.10,2.77,1.25,-1.1+i*.31);
      solid.push({x:2.77,z:0,w:.72,d:2.75});
    }else if(kind==='florist'){
      const pot=mat(0x8d573e), stem=mat(0x3f7844);
      const bloom=new T.SphereGeometry(.095,10,6);
      for(let i=0;i<6;i++){
        const x=i%2?3.45:-3.45,z=-2.6+Math.floor(i/2)*2.1;
        fixture(pot,.32,.30,.32,x,.15,z);
        for(let j=-1;j<=1;j++){
          const h=.62+.085*(j+1);
          box(stem,.021,h,.022,x+j*.083,h*.5,z);
          const flower=new T.Mesh(bloom,mat(goods[(i+j+goods.length)%goods.length]));
          flower.position.set(x+j*.083,h,z);group.add(flower);
        }
      }
    }
    box(light,4,.05,.4,0,3.1,-2);box(light,4,.05,.4,0,3.1,2);
    crowd=2;routes.push([[3,4.6],[-3,4.6]],[[-2.8,-3.2],[-2.8,2.4]]);
  }
  const people=walkingMeshes(Math.max(1,routes.length));
  group.add(people.mesh);
  const attrs=people.mesh.geometry.attributes;
  routes.forEach((_,i)=>{attrs.aLook.setXYZ(i,(i*.37)%1,(i*.61)%1,(i*.23)%1);attrs.aVar.setXYZW(i,.88+(i%5)*.05,i*7%64,1.2,0);});
  people.mesh.geometry.instanceCount=routes.length;
  let yaw=0,pitch=0;const target=new T.Vector3();
  return {
    site,
    look(dx,dy){yaw-=dx*.004;pitch=T.MathUtils.clamp(pitch-dy*.004,-1.1,1.1);},
    step(dt,pressed,camera) {
      people.time.value+=dt;
      const t=people.time.value;
      routes.forEach((route,i)=>{
        if(route.seat){
          const [x,z]=route.seat;
          attrs.aInst.setXYZW(i,x,z,z>0?Math.PI:0,t+i);attrs.aPose.setXY(i,.05,2);return;
        }
        const path=route.path??route, [a,b]=path, span=Math.hypot(b[0]-a[0],b[1]-a[1])||1;
        const wave=((t*1.15/span+i*.37)%2), out=wave<1, f=out?wave:2-wave;
        const x=a[0]+(b[0]-a[0])*f, z=a[1]+(b[1]-a[1])*f;
        attrs.aInst.setXYZW(i,x,z,Math.atan2((b[0]-a[0])*(out?1:-1),(b[1]-a[1])*(out?1:-1)),t*4.4+i);
        attrs.aPose.setXY(i,0,0);
      });
      for(const name of ['aInst','aLook','aPose','aVar'])attrs[name].needsUpdate=true;
      yaw+=(Number(pressed('ArrowLeft'))-Number(pressed('ArrowRight')))*dt*1.72;
      const advance=Number(pressed('w','ArrowUp'))-Number(pressed('s','ArrowDown'));
      const side=Number(pressed('a'))-Number(pressed('d'));
      const speed=kind==='mall'?3.4:2.4;
      const nx=T.MathUtils.clamp(eye.x+(Math.sin(yaw)*advance+Math.cos(yaw)*side)*dt*speed,-halfX+.5,halfX-.5);
      const nz=T.MathUtils.clamp(eye.z+(Math.cos(yaw)*advance-Math.sin(yaw)*side)*dt*speed,-halfZ+.5,halfZ-.5);
      if(!solid.some(o=>Math.abs(o.x-nx)<o.w/2+.25&&Math.abs(o.z-nz)<o.d/2+.25)){eye.x=nx;eye.z=nz;}
      camera.up.set(0,1,0);
      camera.position.copy(group.position).add(eye);
      target.set(Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),Math.cos(yaw)*Math.cos(pitch)).add(camera.position);
      camera.lookAt(target);
    },
    dispose(){
      group.removeFromParent();
      const materials=new Set();
      group.traverse(item=>{item.geometry?.dispose();if(item.material)materials.add(item.material);});
      for(const material of materials){material.map?.dispose();material.dispose();}
    },
  };
}
