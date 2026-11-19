import * as T from '../vendor/three.module.js';
import { walkingMeshes } from '../traffic/population.js';
import { pedestrianPose } from './pedestrian.js';
import { random } from '../world/world.js';
import { createCommuters } from '../traffic/commutes.js';

const workshop=['school','police','clinic','hospital','fire','museum','post','supermarket','bakery','cafe'];

export function createTownLife(world,sites,ground,region) {
  const group=new T.Group(), rng=random(world.seed ^ 0xe1804);
  const commuters=createCommuters(world,sites,ground,region);
  group.add(commuters.group);
  const residents=[], cafes=sites.filter(site=>site.kind==='cafe');
  const shop=sites.find(site=>site.kind==='supermarket');
  function resident(site,shift,offset,task,front=1.46){
    const id=residents.length;
    const outward={x:site.nx,z:site.nz};
    const anchor=(along,out)=>[
      site.x+outward.z*along+outward.x*out,
      site.z-outward.x*along+outward.z*out,
    ];
    const [x,z]=anchor(offset,front);
    const home=[site.x-site.nx*.5,site.z-site.nz*.5];
    residents.push({site,shift,task,x,z,home,minutes:rng()*25,
      hue:rng(),trousers:rng(),skin:rng(),height:.86+rng()*.23,variant:Math.floor(rng()*64),phase:rng()*70});
  }
  for(const site of sites){
    if(!workshop.includes(site.kind)) continue;
    const start=7.12+rng()*1.05;
    resident(site,[start,start+8.25+rng()*.65],-1.14,'work');
    if(site.kind==='cafe'){
      resident(site,[7.7,12.4],1.1,'talk');
      resident(site,[8.0,13.3],.05,'talk');
      for(let i=0;i<7;i++)
        resident(site,[17.8+i*.11,22.8+i*.06],(i-3)*.94,i%3?'dance':'talk',i%2?1.86:1.25);
    } else {
      resident(site,[8.05+rng()*.7,10.1+rng()*1.2],.85,'visit');
      resident(site,[12.6+rng()*1.1,16+rng()*1.8],1.19,'visit');
    }
  }
  if(shop) for(let i=0;i<4;i++) resident(shop,[16.0+i*.27,19.0+i*.2],(i-1.5)*.87,'shop');
  const people=walkingMeshes(residents.length);
  const attrs=people.mesh.geometry.attributes;
  group.add(people.mesh);

  const decorations=new T.Group();
  group.add(decorations);
  const bulbGeometry=new T.SphereGeometry(.076,7,5);
  const cordGeometry=new T.CylinderGeometry(.014,.014,1,5);
  const cord=new T.MeshStandardMaterial({color:0x483b2c});
  const lamps=[0xffbf50,0xec724b,0x6fc897,0x6cacf7].map(color=>
    new T.MeshStandardMaterial({color,emissive:color,emissiveIntensity:.1}));
  for(const site of cafes){
    const front=new T.Group();
    front.position.set(site.x,site.y,site.z);
    front.rotation.y=Math.atan2(site.nx,site.nz);
    const fixtures=[];
    for(let i=0;i<11;i++){
      const x=(i-5)*.60, y=2.65+Math.pow(x/3,2)*.35;
      const light=new T.Mesh(bulbGeometry,lamps[i%lamps.length]);
      light.position.set(x,y,1.25);
      front.add(light);
      fixtures.push(light.position);
      if(i){
        const last=fixtures[i-1], cable=new T.Mesh(cordGeometry,cord);
        cable.position.copy(last).lerp(light.position,.5);
        cable.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),light.position.clone().sub(last).normalize());
        cable.scale.y=last.distanceTo(light.position);
        front.add(cable);
      }
    }
    decorations.add(front);
  }

  let countNearby=0, partyNearby=0;
  function step(dt,hour,player,vehicles) {
    people.time.value+=dt;
    const time=people.time.value;
    const party=hour>=17.8 && hour<23.3;
    lamps.forEach((lamp,i)=>{lamp.emissiveIntensity=party?1.8+.42*Math.sin(time*4+i*1.5):.08;});
    countNearby=commuters.step(dt,hour,player,vehicles);
    partyNearby=party?cafes.reduce((gain,cafe)=>Math.max(gain,1-Math.hypot(cafe.x-player.cx,cafe.z-player.cz)/32),0):0;
    let index=0;
    for(const r of residents){
      const [start,end]=r.shift, span=.25+r.minutes/239;
      if(hour<start-span || hour>end+span) continue;
      if(Math.hypot(r.x-player.cx,r.z-player.cz)>200) continue;
      const arrival=T.MathUtils.smoothstep(hour,start-span,start);
      const departure=T.MathUtils.smoothstep(hour,end,end+span);
      const progress=arrival-departure;
      let x=T.MathUtils.lerp(r.home[0],r.x,progress), z=T.MathUtils.lerp(r.home[1],r.z,progress);
      const walking=progress<.993;
      const partner=r.task==='talk' || r.task==='dance';
      const shift=r.task==='visit' || r.task==='shop' ? Math.sin(time*.56+r.phase)*.41 : 0;
      if(!walking){x+=r.site.nz*shift;z-=r.site.nx*shift;}
      const towards=hour<end?1:-1;
      const face=walking?Math.atan2((r.x-r.home[0])*towards,(r.z-r.home[1])*towards):
        Math.atan2(r.site.nx,r.site.nz)+(partner?(r.variant%2?1:-1)*1.16:Math.PI);
      const mode=walking?0:r.task==='work'?9:r.task==='talk'?(r.variant%7===0?16:r.variant%4===0?17:11):r.task==='dance'?12:0;
      const pose=pedestrianPose(r,x,z,face,walking?1.2:Math.abs(shift)*.42,
        (time+r.phase)*5.2,dt,vehicles,ground.height);
      if(Math.hypot(pose.x-player.cx,pose.z-player.cz)<33) countNearby++;
      attrs.aInst.setXYZW(index,pose.x,pose.z,pose.yaw,pose.phase);
      attrs.aLook.setXYZ(index,r.hue,r.trousers,r.skin);
      attrs.aPose.setXY(index,pose.y,pose.reaction||(r.dodge.hold>0 || pose.speed>2?0:mode));
      attrs.aVar.setXYZW(index,r.height,r.variant,pose.speed,0);
      index++;
    }
    people.mesh.geometry.instanceCount=index;
    for(const attr of ['aInst','aLook','aPose','aVar']) attrs[attr].needsUpdate=true;
  }
  return {group,step,residentCount:residents.length,commuterCount:commuters.residentCount,nearby:()=>countNearby,party:()=>partyNearby};
}
