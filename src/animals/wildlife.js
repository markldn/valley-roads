import * as T from '../vendor/three.module.js';
import { surface } from '../render/visuals.js';
import { animalBox, knockAnimal, stepKnock } from './animal-impact.js';
import { createFauna } from './fauna.js';

// Small animals share meshes and materials. Each keeps its own feeding and
// shelter points so a streamed tile can recreate its population from the seed.
export function createSmallWildlife(world) {
  const fauna=createFauna();
  const ellipsoid = new T.SphereGeometry(1,12,8);
  const coat = surface(0x927054,{pattern:'fur'});
  const light = surface(0xcbb28e,{pattern:'fur'});
  const ear = surface(0xba846e);
  const eye = surface(0x1d140f,{roughness:.19});
  const feather = surface(0x796d5b,{pattern:'fur'});
  const beak = surface(0xc4914d);

  function part(group, material, x,y,z, sx,sy,sz) {
    const mesh = new T.Mesh(ellipsoid,material);
    mesh.position.set(x,y,z);
    mesh.scale.set(sx,sy,sz);
    group.add(mesh);
    return mesh;
  }

  function make(bird, home, feeding, rng) {
    const root=new T.Group(), head=new T.Group();
    const ears=[],legs=[];
    root.add(head);
    if(bird){
      part(root,feather,0,.102,0,.073,.071,.128);
      for(const side of [-1,1])part(root,coat,side*.053,.116,-.022,.032,.041,.103);
      part(root,feather,0,.111,-.13,.029,.017,.088).rotation.x=.14;
      head.position.set(0,.146,.068);
      part(head,light,0,.026,.018,.053,.054,.060);
      part(head,beak,0,.012,.074,.021,.018,.035);
      for(const side of [-1,1]){
        part(head,eye,side*.044,.036,.049,.012,.012,.013);
        const foot=new T.Group();
        foot.position.set(side*.026,.094,.018);root.add(foot);legs.push(foot);
        part(foot,beak,0,-.04,0,.008,.045,.009);
        part(foot,beak,0,-.081,.014,.014,.01,.029);
        part(root,eye,side*.05,.044,-.055,.034,.041,.095);
      }
    } else {
      part(root,coat,0,.169,-.071,.13,.134,.224);
      part(root,light,0,.108,.034,.103,.085,.137);
      part(root,light,0,.15,-.275,.065,.057,.068);
      head.position.set(0,.23,.108);
      part(head,coat,0,.012,.047,.087,.09,.112);
      part(head,light,0,-.031,.129,.058,.048,.054);
      part(head,eye,0,-.017,.172,.026,.017,.016);
      for(const side of [-1,1]){
        part(head,eye,side*.078,.038,.103,.020,.019,.018);
        const rotate=new T.Group();
        rotate.position.set(side*.041,.066,.038);
        rotate.rotation.z=side*.17;
        head.add(rotate);
        part(rotate,coat,0,.103,0,.032,.117,.031);
        part(rotate,ear,0,.114,.021,.020,.085,.012);
        ears.push(rotate);
        const hind=new T.Group(), fore=new T.Group();
        hind.position.set(side*.108,.123,-.10);
        fore.position.set(side*.073,.11,.104);
        root.add(hind,fore);legs.push(hind,fore);
        part(hind,coat,0,-.048,0,.052,.065,.104);
        part(fore,light,0,-.076,0,.034,.028,.076);
      }
    }
    root.scale.setScalar(.77+rng()*.45);
    root.name=bird?'Ground bird':'Rabbit';
    return {root,head,ears,legs,bird,home,feeding,x:home[0],z:home[1],yaw:rng()*6.283,
      phase:rng()*6.283,wait:2+rng()*9,atHome:true};
  }

  const clear=(x,z)=>world.land(x,z)<3&&world.roadDistance(...world.grid(x,z),true)>3.8;

  function populate(x,z,size,rng) {
    const result=[];
    for(let i=0;i<9 && result.length<3;i++){
      const px=x+12+rng()*(size-24), pz=z+12+rng()*(size-24);
      if(!clear(px,pz)||world.land(px,pz)===1&&rng()<.75)continue;
      const theta=rng()*6.283, distance=4+rng()*8;
      const tx=px+Math.sin(theta)*distance,tz=pz+Math.cos(theta)*distance;
      if(!clear(tx,tz)||!clear((px+tx)*.5,(pz+tz)*.5)) continue;
      const animal=make(result.length===1,[px,pz],[tx,tz],rng);
      result.push(animal);
    }
    // Larger game keeps to its own patch of wood.
    for(let i=0;i<3;i++){
      if(rng()>.6)continue;
      const px=x+14+rng()*(size-28), pz=z+14+rng()*(size-28);
      if(world.land(px,pz)!==2||!clear(px,pz))continue;
      const roll=rng(), kind=roll<.3?'bear':roll<.7?'deer':'boar', count=kind==='bear'?1:kind==='deer'?2+Math.floor(rng()*3):2+Math.floor(rng()*4);
      for(let n=0;n<count;n++){
        const ax=px+(rng()-.5)*9, az=pz+(rng()-.5)*9, beast=fauna.build(kind,rng);
        result.push({...beast,big:true,x:ax,z:az,home:[ax,az],goal:[ax,az],yaw:rng()*6.283,wait:rng()*8,stride:0,rear:0,alarm:0});
      }
    }
    return result;
  }

  // Deer bolt early, boar trot off, and a bear rears up to look at you before it walks away.
  function stepBig(a,dt,x,z,boxes,horn) {
    const range=Math.hypot(a.x-x,a.z-z), alert={deer:38,boar:20,bear:26}[a.kind];
    a.root.visible=range<150;
    if(!a.root.visible)return;
    if(range<(horn?alert+25:alert)&&!a.alarm)a.alarm=a.kind==='bear'?6:5;
    a.alarm=Math.max(0,a.alarm-dt);
    const rearing=a.kind==='bear'&&a.alarm>3.4;
    let speed=0;
    if(a.alarm&&!rearing){
      const away=Math.atan2(a.x-x,a.z-z);
      a.goal=[a.x+Math.sin(away)*20,a.z+Math.cos(away)*20];
      speed={deer:10,boar:6,bear:3.2}[a.kind];
    }else if(!rearing){
      a.wait-=dt;
      if(a.wait<=0){
        const turn=Math.random()*6.283, reach=4+Math.random()*22;
        a.goal=[a.home[0]+Math.sin(turn)*reach,a.home[1]+Math.cos(turn)*reach];
        a.wait=7+Math.random()*16;
      }
      if(Math.hypot(a.goal[0]-a.x,a.goal[1]-a.z)>.6)speed=a.kind==='deer'?1.2:.9;
    }
    const dx=a.goal[0]-a.x,dz=a.goal[1]-a.z,left=Math.hypot(dx,dz)||1;
    const wanted=rearing?Math.atan2(x-a.x,z-a.z):Math.atan2(dx,dz), delta=Math.atan2(Math.sin(wanted-a.yaw),Math.cos(wanted-a.yaw));
    if(speed||rearing)a.yaw+=Math.max(-4*dt,Math.min(4*dt,delta));
    const nx=a.x+dx/left*speed*dt,nz=a.z+dz/left*speed*dt;
    if(speed&&world.land(nx,nz)<3){a.x=nx;a.z=nz;}
    a.stride+=dt*speed*(a.kind==='deer'?2.4:3.6);
    a.rear+=((rearing?1:0)-a.rear)*Math.min(1,dt*5);
    const y=world.height(a.x,a.z);
    a.root.position.set(a.x,y+a.rear*.5,a.z);
    a.root.rotation.set(-a.rear*1.05,a.yaw,0);
    a.head.rotation.x=speed?.05:.35+.2*Math.sin(a.phase+=dt*.8);
    for(const {joint,phase} of a.legs)joint.rotation.x=speed?Math.sin(a.stride)*phase*Math.min(.75,.28+speed*.08):a.rear*-.5;
    if(range<40)boxes.push(animalBox(a,a.x,y,a.z,a.yaw,a.box[0]*a.scale,a.box[1]*a.scale,a.mass));
  }

  function update(animals, dt, x,z, boxes=[],horn=false) {
    for(const a of animals){
      if(a.knock){
        a.root.visible=Math.hypot(a.knock.x-x,a.knock.z-z)<112;
        if(!stepKnock(a,dt,world.height))continue;
        a.x=a.knock.x;a.z=a.knock.z;a.knock=null;a.root.rotation.set(0,a.yaw,0);
      }
      if(a.big){stepBig(a,dt,x,z,boxes,horn);continue;}
      const distance=Math.hypot(a.x-x,a.z-z);
      a.root.visible=distance<112;
      if(!a.root.visible)continue;
      const threatened=distance<(horn?37:15);
      const fartherFromPlayer=Math.hypot(a.home[0]-x,a.home[1]-z)>Math.hypot(a.feeding[0]-x,a.feeding[1]-z)
        ?a.home:a.feeding;
      const target=threatened?fartherFromPlayer:a.atHome?a.feeding:a.home;
      const dx=target[0]-a.x,dz=target[1]-a.z,left=Math.hypot(dx,dz);
      if(!threatened)a.wait=Math.max(0,a.wait-dt);
      let travel=0;
      if((threatened||a.wait===0)&&left>.12){
        const desired=Math.atan2(dx,dz);
        const delta=Math.atan2(Math.sin(desired-a.yaw),Math.cos(desired-a.yaw));
        a.yaw+=Math.max(-6*dt,Math.min(6*dt,delta));
        travel=Math.min(left,dt*(threatened?(a.bird?2.9:4.6):(a.bird?.72:1.05)));
        a.x+=dx/left*travel;
        a.z+=dz/left*travel;
      }else if (left<=.12&&!threatened){
        a.wait=(a.bird?3:6)+Math.sin(a.phase)*1.4;
        a.atHome=!a.atHome;
      }
      a.phase+=dt*(travel?(threatened?18:9):1.7);
      const hop=travel?Math.max(0,Math.sin(a.phase))*(threatened?.16:.051):0;
      a.root.position.set(a.x,world.height(a.x,a.z)+hop,a.z);
      a.root.rotation.set(travel?.08*Math.cos(a.phase):0,a.yaw,0);
      if(distance<30)boxes.push(animalBox(a,a.x,a.root.position.y,a.z,a.yaw,a.bird?.16:.3,a.bird?.09:.14,a.bird?1:2.6,true));
      a.head.rotation.x=travel?.10:.38+.30*Math.sin(a.phase*2.1);
      for(const [i,leg] of a.legs.entries())
        leg.rotation.x=travel?Math.sin(a.phase+(i%2)*Math.PI)*(a.bird?.58:.65):0;
      for(const ear of a.ears)ear.rotation.x=(threatened?-.69:.04)+.15*Math.sin(a.phase);
    }
  }
  return {populate,update,knockAnimal,dispose(){
    fauna.dispose();
    ellipsoid.dispose();
    for(const material of [coat,light,ear,eye,feather,beak])material.dispose();
  }};
}
