import * as T from '../vendor/three.module.js';
import { surface } from '../render/visuals.js';
import { animalBox, stepKnock } from './animal-impact.js';
import { createFauna } from './fauna.js';

export function createLivestock(world) {
  const fauna=createFauna();
  const smooth = new T.SphereGeometry(1,12,8);
  const wool = new T.IcosahedronGeometry(1,1);
  const leg = new T.CylinderGeometry(.67,1,1,7);
  const coats = [
    surface(0xe5dbc4,{pattern:'cowCoat'}),
    surface(0x7d4829,{pattern:'foliage'}),
    surface(0xe4d9ba,{pattern:'wool'}),
  ];
  const dark=surface(0x312722), muzzle=surface(0x926e60), horn=surface(0xa29a82);

  function animal(sheep,rng){
    const root=new T.Group(), head=new T.Group(), legs=[];
    const scale=(sheep?.65:1)*(.85+rng()*.27);
    const coat=coats[sheep?2:rng()<.68?0:1];
    function part(parent,material,x,y,z,sx,sy,sz,geometry=smooth){
      const mesh=new T.Mesh(geometry,material);
      mesh.position.set(x,y,z);
      mesh.scale.set(sx,sy,sz);
      mesh.castShadow=true;
      mesh.receiveShadow=true;
      parent.add(mesh);
      return mesh;
    }
    part(root,coat,0,1.22,-.04,.49,.52,1.03,sheep?wool:smooth);
    if(sheep){
      for(const [x,y,z] of [[-.3,1.27,.12],[.31,1.29,-.22],[0,1.46,-.48],[0,1.44,.37]])
        part(root,coat,x,y,z,.35,.29,.45,wool);
    } else {
      part(root,coat,0,1.21,.66,.41,.49,.51);
      part(root,dark,0,1.07,-1.02,.072,.38,.066).rotation.x=.18;
    }
    for(const sign of [-1,1]) for(const side of [-1,1]){
      const joint=new T.Group();
      joint.position.set(side*.29,1.02,sign*.64);
      root.add(joint);
      part(joint,sheep?dark:coat,0,-.33,0,.12,.77,.13,leg);
      part(joint,dark,0,-.83,.027,.093,.43,.105,leg);
      legs.push({joint,phase:sign*side});
    }
    root.add(head);
    head.position.set(0,1.45,.79);
    const face=sheep?dark:coat;
    part(head,face,0,.09,.27,.28,.39,.40);
    part(head,sheep?dark:muzzle,0,-.13,.52,.24,.16,.25);
    for(const side of [-1,1]){
      part(head,face,side*.30,.21,.17,.24,.076,.122).rotation.z=side*.31;
      part(head,dark,side*.224,.19,.44,.039,.042,.033);
      if(!sheep) part(head,horn,side*.18,.473,.17,.061,.14,.07).rotation.z=-side*.39;
    }
    root.scale.setScalar(scale);
    root.name=sheep?'Sheep':'Cow';
    return {root,head,legs,phase:rng()*94,sheep,kind:sheep?'sheep':'cow',scale,mass:(sheep?75:640)*scale,box:[(sheep?.82:1.28)*scale,(sheep?.36:.46)*scale]};
  }

  function herd(x,z,kind,rng,clear){
    const animals=[], sheep=kind==='sheep', count={sheep:6,cow:4,horse:4,pig:6}[kind];
    for(let i=0;i<count;i++){
      const angle=i*2.39996, radius=4+Math.sqrt(i)*4;
      const cx=x+Math.sin(angle)*radius, cz=z+Math.cos(angle)*radius;
      const roam=1.3+rng()*2.1;
      if(![0,1,2,3].every(i=>clear(cx+Math.sin(i*Math.PI/2)*roam,cz+Math.cos(i*Math.PI/2)*roam))) continue;
      animals.push({...(kind==='horse'||kind==='pig'?fauna.build(kind,rng):animal(sheep,rng)),cx,cz,roam});
    }
    return animals;
  }

  function step(animals,time,player,dt=0,boxes=[]){
    for(const a of animals){
      const t=time+a.phase, angle=t*.09+Math.sin(t*.19)*.24;
      let x=a.cx+Math.sin(angle)*a.roam, z=a.cz+Math.cos(angle)*a.roam;
      if(a.knock){
        a.root.visible=Math.hypot(a.knock.x-player.cx,a.knock.z-player.cz)<165;
        if(stepKnock(a,dt,world.height)){
          // Carry on grazing from where it stood up.
          a.cx+=a.knock.x-x;a.cz+=a.knock.z-z;
          x=a.knock.x;z=a.knock.z;
          a.knock=null;a.root.rotation.set(0,angle+Math.PI/2,0);
        }else continue;
      }
      a.root.visible=Math.hypot(x-player.cx,z-player.cz)<165;
      if(!a.root.visible) continue;
      const y=world.height(x,z), yaw=angle+Math.PI/2;
      a.root.position.set(x,y,z);
      a.root.rotation.y=yaw;
      if(Math.hypot(x-player.cx,z-player.cz)<40){
        const box=animalBox(a,x,y,z,yaw,a.box[0],a.box[1],a.mass);
        boxes.push(box);
      }
      a.head.rotation.x=.22+.58*Math.max(0,Math.sin(t*.73));
      for(const {joint,phase} of a.legs) joint.rotation.x=.075*phase*Math.sin(t*1.6);
    }
  }
  return { herd,step,dispose(){
    fauna.dispose();
    for(const g of [smooth,wool,leg]) g.dispose();
    for(const m of [...coats,dark,muzzle,horn]) m.dispose();
  }};
}
