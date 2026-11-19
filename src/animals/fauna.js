// Larger animals built from simple rounded parts: horses and pigs on the farms, bears, deer and boar in the woods.
import * as T from '../vendor/three.module.js';
import { surface } from '../render/visuals.js';

const COATS={
  horse:[0x5a3620,0x7a4526,0x2a2422,0x9a9690,0xb08a58],pig:[0xe2a999,0xd9988c,0xc9a08e],
  bear:[0x46301f,0x3a281b,0x57402b],deer:[0x8a6242,0x96704c],boar:[0x3f352c,0x4a3e32],
};
const SPECS={
  horse:{y:1.36,body:[.3,.38,.86],leg:1.05,legW:.075,spread:[.2,.62],neck:[0,1.72,.82,.17,.48,.2,-.62],head:[0,2.08,1.16],skull:[.12,.15,.34],snout:[.1,.1,.16,.3],ear:.1,tail:[.07,.5,-.98,1.0],mass:520,box:[1.2,.42]},
  pig:{y:.54,body:[.34,.34,.72],leg:.3,legW:.07,spread:[.2,.42],neck:[0,.62,.62,.2,.22,.2,-.3],head:[0,.6,.86],skull:[.2,.2,.24],snout:[.1,.09,.12,.26],ear:.12,tail:[.025,.08,-.74,.62],mass:120,box:[.85,.36]},
  bear:{y:.82,body:[.44,.5,.86],leg:.56,legW:.15,spread:[.28,.52],neck:[0,.98,.76,.28,.3,.3,-.5],head:[0,1.08,1.06],skull:[.25,.24,.28],snout:[.12,.11,.16,.3],ear:.09,tail:[.06,.08,-.86,.86],mass:200,box:[1.05,.5]},
  deer:{y:1.02,body:[.2,.27,.62],leg:.86,legW:.04,spread:[.13,.44],neck:[0,1.34,.56,.09,.36,.11,-.5],head:[0,1.66,.76],skull:[.08,.1,.2],snout:[.05,.05,.1,.2],ear:.12,tail:[.05,.1,-.62,1.04],mass:75,box:[.8,.25]},
  boar:{y:.58,body:[.27,.37,.64],leg:.34,legW:.07,spread:[.16,.4],neck:[0,.66,.55,.2,.24,.22,-.25],head:[0,.6,.78],skull:[.17,.2,.26],snout:[.08,.08,.14,.28],ear:.08,tail:[.02,.14,-.64,.66],mass:95,box:[.8,.3]},
};

export function createFauna() {
  const ball=new T.SphereGeometry(1,12,8), limb=new T.CylinderGeometry(.72,1,1,7);
  const made=new Map();
  const skin=color=>{
    if(!made.has(color))made.set(color,surface(color,{pattern:'fur',roughness:.9}));
    return made.get(color);
  };
  const shade=(color,amount)=>new T.Color(color).multiplyScalar(amount).getHex();
  function build(kind,rng) {
    const spec=SPECS[kind], coat=COATS[kind][Math.floor(rng()*COATS[kind].length)];
    const fur=skin(coat), dark=skin(kind==='pig'?shade(coat,.8):shade(coat,.45)), pale=skin(kind==='pig'?0xeab8aa:shade(coat,1.5));
    const hoof=skin(0x1c1814), root=new T.Group(), head=new T.Group(), legs=[];
    const part=(parent,material,geometry,x,y,z,sx,sy,sz)=>{
      const mesh=new T.Mesh(geometry,material);
      mesh.position.set(x,y,z);mesh.scale.set(sx,sy,sz);mesh.castShadow=true;parent.add(mesh);
      return mesh;
    };
    const [bw,bh,bl]=spec.body;
    part(root,fur,ball,0,spec.y,0,bw,bh,bl);
    part(root,fur,ball,0,spec.y+bh*.05,bl*.55,bw*1.02,bh*1.02,bl*.5);
    part(root,kind==='deer'?skin(0xe8e0d0):pale,ball,0,spec.y-bh*.42,0,bw*.72,bh*.6,bl*.8);
    for(const front of [1,-1])for(const side of [-1,1]){
      const joint=new T.Group();
      joint.position.set(side*spec.spread[0],spec.leg,front*spec.spread[1]);
      root.add(joint);
      part(joint,fur,limb,0,-spec.leg*.28,0,spec.legW*1.35,spec.leg*.58,spec.legW*1.35);
      part(joint,kind==='bear'?dark:fur,limb,0,-spec.leg*.72,0,spec.legW,spec.leg*.46,spec.legW);
      part(joint,hoof,limb,0,-spec.leg*.96,.012,spec.legW*1.1,spec.leg*.09,spec.legW*1.2);
      legs.push({joint,phase:front*side});
    }
    const [nx,ny,nz,nw,nh,nd,tilt]=spec.neck;
    part(root,fur,ball,nx,ny,nz,nw,nh,nd).rotation.x=-tilt;
    root.add(head);
    head.position.set(...spec.head);
    const [sw,sh,sl]=spec.skull;
    part(head,fur,ball,0,0,0,sw,sh,sl);
    const [mw,mh,ml,mz]=spec.snout;
    part(head,kind==='pig'?pale:kind==='bear'?skin(0x8a6c4c):dark,ball,0,-sh*.25,mz,mw,mh,ml);
    if(kind==='pig'||kind==='boar')part(head,skin(kind==='pig'?0xc98478:0x201a16),ball,0,-sh*.25,mz+ml*.86,mw*.8,mh*.75,.03);
    for(const side of [-1,1]){
      part(head,skin(0x0c0a08),ball,side*sw*.82,sh*.3,sl*.42,.022,.024,.022);
      part(head,kind==='bear'?dark:fur,ball,side*sw*.62,sh*1.02,-sl*.15,spec.ear*.6,spec.ear,spec.ear*.45);
      if(kind==='boar')part(head,skin(0xe8e0c8),limb,side*mw*.8,-sh*.3,mz+ml*.4,.014,.12,.014).rotation.x=-.3;
      if(kind==='deer'&&rng()<.7){
        const horn=skin(0x6a553c);
        part(head,horn,limb,side*.06,sh+.2,-.05,.014,.42,.014).rotation.z=-side*.3;
        part(head,horn,limb,side*.16,sh+.36,.07,.01,.26,.01).rotation.x=.8;
      }
    }
    if(kind==='horse'){
      for(let i=0;i<7;i++)part(root,dark,ball,0,1.56+i*.085,.56+i*.085,.05,.14,.1);
      part(head,dark,ball,0,sh*.9,.1,.05,.09,.16);
    }
    if(kind==='boar')for(let i=0;i<8;i++)part(root,dark,ball,0,spec.y+bh*.94,bl*.7-i*.2,.04,.09,.12);
    const [tr,tl,tz,ty]=spec.tail;
    const tail=part(root,kind==='horse'?dark:kind==='deer'?skin(0xefe8da):fur,ball,0,ty-tl*.45,tz,tr,tl,tr);
    tail.rotation.x=.14;
    root.scale.setScalar(.88+rng()*.24);
    root.name=kind;
    return {root,head,legs,kind,phase:rng()*94,sheep:false,scale:root.scale.x,mass:spec.mass*root.scale.x,box:spec.box};
  }
  return {build,dispose(){ball.dispose();limb.dispose();for(const material of made.values())material.dispose();}};
}
