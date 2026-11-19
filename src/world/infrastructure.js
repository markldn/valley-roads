import * as T from '../vendor/three.module.js';
import { surface, tunnelOpenings } from '../render/visuals.js';
import { instances, terrainSurfaceSampler } from './scenery.js';
import { inscription } from '../people/district.js';

const crossSection=[[-4.04,0],[-4.04,3.65],[-3.47,4.85],[-2.30,5.6],[0,5.92],
  [2.30,5.6],[3.47,4.85],[4.04,3.65],[4.04,0]];

function meshFrom(vertices,material) {
  const geometry=new T.BufferGeometry();
  geometry.setAttribute('position',new T.Float32BufferAttribute(vertices,3));
  geometry.computeVertexNormals();
  const mesh=new T.Mesh(geometry,material);
  mesh.receiveShadow=true;
  return mesh;
}

export function createInfrastructure(world,obstacles) {
  const group=new T.Group(), asphalt=surface(0x636464,{pattern:'asphalt',pavementWear:false,side:T.DoubleSide});
  const concrete=surface(0x8e8a7f,{pattern:'plaster',side:T.DoubleSide});
  const liner=surface(0x6e6758,{pattern:'plaster',side:T.DoubleSide,emissive:0x493b28,emissiveIntensity:.07});
  const reflect=surface(0xe6cab0,{emissive:0x915822,emissiveIntensity:.43});
  const bulb=surface(0xeed8ad,{emissive:0xffb263,emissiveIntensity:3.2});
  const sign=surface(0x2e4d76);
  const geometry=new T.BoxGeometry();
  const barriers=[], fixtures=[], shoulders=[], signage=[], guardrails=[], rampPiers=[];
  const portalData=[];
  const noEntryFace=new T.CircleGeometry(.34,24), noEntryBar=new T.PlaneGeometry(.43,.10);
  const noEntryRed=new T.MeshBasicMaterial({color:0xc81d27});
  const noEntryWhite=new T.MeshBasicMaterial({color:0xfff9f0});
  let noEntryCount=0;
  const terrain=terrainSurfaceSampler(world);
  const supportSign=(x,z,top,width,yaw=0)=>{
    const bottom=Math.min(top-.25,terrain(x,z)-.04);
    shoulders.push([x,(top+bottom)*.5,z,width,top-bottom,width,yaw,0x929495]);
  };
  for(const path of [...world.mountainRoads,...world.ramps]){
    const verts=[],shell=[],rim=[],marks=[];
    const strip=(a,b,c,d,target)=>target.push(...a,...b,...c,...b,...d,...c);
    const at=(i,side,h=0)=>{
      const prev=path.points[Math.max(0,i-1)],next=path.points[Math.min(path.points.length-1,i+1)];
      const dx=next[0]-prev[0], dz=next[1]-prev[1], length=Math.hypot(dx,dz)||1;
      const [x,z]=path.points[i];
      const px=x+side*dz/length, pz=z-side*dx/length;
      const elevation=path.kind==='ramp'?world.rampDeck(path,px,pz,path.elevations[i]):path.elevations[i];
      return [px,elevation+h,pz];
    };
    const yawAt=i=>{
      const prev=path.points[Math.max(0,i-1)],next=path.points[Math.min(path.points.length-1,i+1)];
      return Math.atan2(next[0]-prev[0],next[1]-prev[1]);
    };
    const w=path.width*.5;
    const onConnectingRoad=([x,,z])=>{
      const [u,v]=world.grid(x,z);
      return [path.motorway,path.sideRoad].some(road=>{
        const along=road.alongX?u:v, across=road.alongX?v:u;
        return along>=road.start && along<=road.end &&
          Math.abs(across-road.cross)<=world.motorwayWidth(road,along)*.5;
      });
    };
    if(path.kind==='ramp'){
      const signSide=path.offRamp?-1:1;
      const candidates=path.points.map((_,i)=>i).filter(i=>
        !onConnectingRoad(at(i,0))&&!onConnectingRoad(at(i,signSide*(w+.46))));
      const i=path.offRamp?candidates.at(-1):candidates[0];
      if(i!==undefined){
        const panel=new T.Group();
        panel.position.set(...at(i,signSide*(w+.46),1.82));
        panel.rotation.y=yawAt(i)+(path.offRamp?0:Math.PI);
        panel.add(new T.Mesh(noEntryFace,noEntryRed));
        const bar=new T.Mesh(noEntryBar,noEntryWhite);
        bar.position.z=.014;
        panel.add(bar);
        group.add(panel);
        const [x,y,z]=panel.position;
        supportSign(x,z,y,.06);
        noEntryCount++;
      }
    }
    for(let i=1;i<path.points.length;i++){
      const ramp=path.kind==='ramp';
      const lift=ramp?.153:.16;
      const corners=[at(i-1,-w,lift),at(i-1,w,lift),at(i,-w,lift),at(i,w,lift)];
      const cover=ramp&&corners.every(onConnectingRoad);
      if(!cover)strip(...corners,verts);
      if(!ramp&&Math.floor(path.length[i]/6)%3===0)
        strip(at(i-1,-.07,.196),at(i-1,.07,.196),at(i,-.07,.196),at(i,.07,.196),marks);
      for(const side of [-1,1]){
        if(!cover&&(!ramp||i<path.points.length-5)){
          strip(at(i-1,side*(w-.25),.194),at(i-1,side*(w-.36),.194),
            at(i,side*(w-.25),.194),at(i,side*(w-.36),.194),marks);
        }
        if(ramp&&!cover){
          const edge=side*w;
          strip(at(i-1,edge,.153),at(i-1,edge,-1.10),at(i,edge,.153),at(i,edge,-1.10),rim);
        }
      }
      if(ramp&&!cover){
        strip(at(i-1,w,-1.10),at(i-1,-w,-1.10),at(i,w,-1.10),at(i,-w,-1.10),rim);
      }
      if((path.kind==='summit'||ramp&&!cover) && i>5 && i<path.points.length-8){
        for(const side of [-1,1]){
          const verge=at(i,side*(w+2.3));
          if(verge[1]-world.height(verge[0],verge[2])<.78)continue;
          const offset=side*(w+.19);
          const a=at(i-1,offset,.70),b=at(i,offset,.70);
          if(ramp&&(onConnectingRoad(a)||onConnectingRoad(b))) continue;
          strip(a,b,at(i-1,offset,.92),at(i,offset,.92),guardrails);
          barriers.push([a[0],a[2],b[0],b[2],Math.min(a[1],b[1])-.40,Math.max(a[1],b[1])+.24]);
          if(i%5===0){
            const [x,y,z]=at(i,offset,.35);
            shoulders.push([x,y,z,.11,.73,.13,yawAt(i),0x8d9597]);
          }
        }
      }
      if(ramp&&!cover&&i%8===0&&i<path.points.length-6){
        const [x,y,z]=at(i,0),ground=world.height(x,z);
        if(y-ground>1.1)rampPiers.push([x,(y-1.10+ground)*.5,z,1.75,y-ground-1.10,1.1,yawAt(i),0xa7a399]);
      }
      if(path.kind!=='tunnel'||i<path.portalStart||i>path.portalEnd)continue;
      for(let j=1;j<crossSection.length;j++){
        const [a,ay]=crossSection[j-1],[b,by]=crossSection[j];
        strip(at(i-1,a,ay),at(i-1,b,by),at(i,a,ay),at(i,b,by),shell);
      }
      if(i%4===0){
        const [x,y,z]=at(i,0,5.48);
        fixtures.push([x,y,z,1.35,.11,.35,yawAt(i),0xf9ddad]);
      }
      for(const side of [-1,1]){
        const [x,y,z]=at(i,4.00*side,.39);
        shoulders.push([x,y,z,.16,.36,4,yawAt(i),0xac9580]);
        const a=at(i-1,side*4.02),b=at(i,side*4.02);
        barriers.push([a[0],a[2],b[0],b[2],y-.5,y+5.4]);
      }
    }
    const paint=new T.MeshStandardMaterial({color:0xe9dda8,side:T.DoubleSide,roughness:.75});
    group.add(meshFrom(verts,asphalt),meshFrom(marks,paint));
    if(path.kind==='ramp'&&rim.length)group.add(meshFrom(rim,concrete));
    if(path.kind==='tunnel'){
      group.add(meshFrom(shell,liner));
      for(const i of [path.portalStart-1,path.portalEnd]){
        const position=at(i,0), yaw=yawAt(i);
        portalData.push(new T.Vector4(position[0],position[2],Math.sin(yaw),Math.cos(yaw)));
        portalData.push(new T.Vector4(position[1],4.3,16,9.2));
        for(let j=1;j<crossSection.length;j++){
          const [a,ay]=crossSection[j-1],[b,by]=crossSection[j];
          strip(at(i,a,ay),at(i,b,by),at(i,a*1.19,ay+.65),at(i,b*1.19,by+.65),rim);
        }
        const [x,y,z]=at(i,0,6.66);
        const title=inscription('Tunnel des Rives','#fff5df','#31536f');
        title.position.set(x,y,z);
        title.rotation.y=yaw+(i===path.portalStart-1?Math.PI:0);
        group.add(title);
      }
      group.add(meshFrom(rim,concrete));
    }
  }
  if(guardrails.length) group.add(meshFrom(guardrails,surface(0x939a9d,{metalness:.62,roughness:.54,side:T.DoubleSide})));
  tunnelOpenings.value.forEach((value,i)=>{if(portalData[i])value.copy(portalData[i]);else value.set(0,0,0,0);});

  const island=[],lanePaint=[];
  const stripe=surface(0xf0e6c9,{roughness:.72,side:T.DoubleSide});
  const decal=([x,z])=>[x,world.roadHeight(x,z)+.221,z];
  for(const circle of world.roundabouts){
    const [x,z]=world.point(circle.u,circle.v), y=world.height(x,z);
    for(let i=0;i<56;i++){
      const a=i*Math.PI/28,b=(i+1)*Math.PI/28, radius=circle.size-4.4;
      const p=world.point(...circle.at(a,radius)),q=world.point(...circle.at(b,radius));
      island.push(x,y+.28,z,p[0],world.height(...p)+.20,p[1],q[0],world.height(...q)+.20,q[1]);
      const cx=(p[0]+q[0])/2,cz=(p[1]+q[1])/2;
      shoulders.push([cx,world.height(cx,cz)+.15,cz,.29,.27,Math.hypot(q[0]-p[0],q[1]-p[1])+.08,
        Math.atan2(q[0]-p[0],q[1]-p[1]),i%2?0xb3aba0:0xa29b90]);
      const edge=circle.size-3.12;
      const [a0,a1,b0,b1]=[circle.at(a,edge),circle.at(a,edge+.12),circle.at(b,edge),circle.at(b,edge+.12)]
        .map(p=>decal(world.point(...p)));
      lanePaint.push(...a0,...a1,...b0,...a1,...b1,...b0);
    }
    for(const arm of circle.arms){
      const [u,v]=arm.inbound[9],[U,V]=arm.inbound[11];
      const length=Math.hypot(U-u,V-v)||1,dx=(U-u)/length,dz=(V-v)/length;
      for(let i=-3;i<=3;i++){
        const middle=i*.64,p=(cross,along)=>decal(world.point(u+dz*cross+dx*along,v-dx*cross+dz*along));
        lanePaint.push(...p(middle-.20,.19),...p(middle+.20,.19),...p(middle,-.58));
      }
      const [x,z]=world.point(...arm.inbound[5]);
      const yaw=Math.atan2(dx,dz), px=x+dz*3.0,pz=z-dx*3.0;
      const sy=terrain(px,pz);
      supportSign(px,pz,sy+2.22,.055,yaw);
      const panel=inscription('CÉDEZ','#fff1db','#883b30');
      panel.scale.setScalar(.54);panel.position.set(px,sy+2.16,pz);panel.rotation.y=yaw+Math.PI;
      group.add(panel);
    }
  }
  if(island.length)group.add(meshFrom(island,surface(0x6f804b,{pattern:'foliage',side:T.DoubleSide})));
  for(const road of world.highways)for(const direction of [-1,1]){
    const terminal=direction>0?road.end:road.start;
    const taper=road.tapers[direction>0?1:0];
    const side=direction*(road.alongX?1:-1);
    const notices=[[taper+65,'Rétrécissement'],[Math.max(15,taper*.28),"Fin d’autoroute  ·  80"]];
    for(const [distance,text] of notices){
      const station=terminal-direction*distance;
      const shoulder=road.cross+side*(world.motorwayWidth(road,station)*.5+1.65);
      const at=s=>road.alongX?world.point(s,shoulder):world.point(shoulder,s);
      const [x,z]=at(station),[a,b]=at(station+direction);
      const y=terrain(x,z), yaw=Math.atan2(a-x,b-z);
      const board=inscription(text,'#fff8e9','#315985');
      board.position.set(x,y+2.6,z);
      board.rotation.y=yaw+Math.PI;
      group.add(board);
      supportSign(x,z,y+2.6,.085,yaw);
    }
  }
  for(const exit of world.exits){
    for(const street of exit.streets){
      if(!street.offRamp) continue;
      const path=street.ramp;
      const road=exit.motorway,[mu,mv]=street.points[0];
      const merge=road.alongX?mu:mv;
      const direction=Math.sign((road.alongX?exit.u:exit.v)-merge);
      const side=Math.sign((road.alongX?mv:mu)-road.cross);
      const destination=world.towns.reduce((a,b)=>Math.hypot(a.u-exit.u,a.v-exit.v)<
        Math.hypot(b.u-exit.u,b.v-exit.v)?a:b);
      for(const distance of [300,100]){
        const station=merge-direction*distance;
        if(station<road.start+22||station>road.end-22)continue;
        const shoulder=road.cross+side*(world.motorwayWidth(road,station)*.5+1.8);
        const at=along=>road.alongX?world.point(along,shoulder):world.point(shoulder,along);
        const [x,z]=at(station),[ax,az]=at(station+direction);
        const y=terrain(x,z),yaw=Math.atan2(ax-x,az-z);
        const advance=inscription('Sortie  '+destination.name+'  '+distance+' m','#fff7e6','#315985');
        advance.scale.multiplyScalar(1.14);
        advance.position.set(x,y+3.0,z);
        advance.rotation.y=yaw+Math.PI;
        group.add(advance);
        for(const offset of [-.76,.76]){
          supportSign(x+Math.cos(yaw)*offset,z-Math.sin(yaw)*offset,y+3,.09,yaw);
        }
      }
      const signIndex=street.points.findIndex(([u,v])=>!world.highwayAt(u,v,street.width));
      if(signIndex<1) continue;
      const [u,v]=street.points[signIndex],[x,z]=world.point(u,v);
      const [au,av]=street.points[signIndex-1],[ax,az]=world.point(au,av);
      const yaw=Math.atan2(x-ax,z-az);
      const nx=Math.cos(yaw),nz=-Math.sin(yaw);
      const sx=x+nx*3.4,sz=z+nz*3.4,sy=world.rampDeck(path,sx,sz,path.elevations[signIndex]);
      signage.push([sx,sy+2.65,sz,2.50,.74,.11,yaw,0xc9dbff]);
      const panel=inscription('Sortie  '+exit.name+'  ↗','#fff7e6','#315985');
      panel.rotation.y=yaw+Math.PI;
      panel.position.set(sx-Math.sin(yaw)*.07,sy+2.65,sz-Math.cos(yaw)*.07);
      group.add(panel);
      supportSign(sx,sz,sy+2.65,.075,yaw);
      shoulders.push([sx,sy+2.67,sz,.45,.055,.17,yaw,0xf4f4e9]);
      const stopIndex=path.points.length-7;
      const [tx,tz]=path.points[stopIndex], [bx,bz]=path.points[stopIndex-1];
      const length=Math.hypot(tx-bx,tz-bz), fx=(tx-bx)/length,fz=(tz-bz)/length;
      const stopHeight=world.rampDeck(path,tx,tz,path.elevations[stopIndex]);
      for(let dash=-2;dash<=2;dash++){
        const a=dash*.9-.29,b=dash*.9+.29;
        const p=(across,along)=>[tx+fz*across+fx*along,stopHeight+.217,tz-fx*across+fz*along];
        lanePaint.push(...p(a,-.17),...p(b,-.17),...p(a,.17),...p(b,-.17),...p(b,.17),...p(a,.17));
      }
      const yieldPanel=inscription('CÉDEZ','#fff7e6','#923b32');
      yieldPanel.scale.setScalar(.62);
      yieldPanel.position.set(tx-fz*3.3,stopHeight+1.85,tz+fx*3.3);
      yieldPanel.rotation.y=Math.atan2(fx,fz)+Math.PI;
      group.add(yieldPanel);
      supportSign(tx-fz*3.3,tz+fx*3.3,stopHeight+1.85,.065);
    }
  }
  if(lanePaint.length)group.add(meshFrom(lanePaint,stripe));
  if(shoulders.length)group.add(instances(geometry,shoulders,reflect,false));
  if(fixtures.length)group.add(instances(geometry,fixtures,bulb,false));
  if(signage.length)group.add(instances(geometry,signage,sign,false));
  if(rampPiers.length)group.add(instances(geometry,rampPiers,concrete));
  obstacles.addBarriers(barriers);
  group.userData.signCount=signage.length+noEntryCount;
  return group;
}
