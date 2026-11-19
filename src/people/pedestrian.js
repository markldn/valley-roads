function approaching(box,x,z,lookahead) {
  const dx=x-box.cx, dz=z-box.cz;
  const along=dx*box.fx+dz*box.fz, across=dx*box.rx+dz*box.rz;
  const vf=(box.vx||0)*box.fx+(box.vz||0)*box.fz;
  const vr=(box.vx||0)*box.rx+(box.vz||0)*box.rz;
  const front=box.hl+.65, side=box.hw+.65;
  let entry=0, exit=lookahead;
  for(const [position,velocity,extent] of [[along,vf,front],[across,vr,side]]){
    if(Math.abs(velocity)<.001){
      if(Math.abs(position)>extent) return null;
      continue;
    }
    const a=(position-extent)/velocity, b=(position+extent)/velocity;
    entry=Math.max(entry,Math.min(a,b));
    exit=Math.min(exit,Math.max(a,b));
    if(entry>exit) return null;
  }
  return {entry,along,across,vf,vr};
}

export function pedestrianPose(person,x,z,yaw,pace,phase,dt,vehicles,height) {
  const state=person.dodge ??= {x:0,z:0,hold:0,jump:0,phase:0};
  let px=x+state.x, pz=z+state.z;
  const y=height(px,pz);
  let threat=null, closest=Infinity, horn=false, upset=null;
  for(const box of vehicles){
    const range=Math.hypot(px-box.cx,pz-box.cz);
    if(box.crash&&Math.hypot(px-box.crash.x,pz-box.crash.z)<15)
      upset=box.crash;
    if(range>58 || (box.y!=null && Math.abs(box.y-y)>2.7)) continue;
    const path=approaching(box,px,pz,1.45);
    if(path && path.entry<closest){
      threat={box,...path};
      closest=path.entry;
      horn=false;
    } else if(!threat && box.horn && range<28){
      const dx=px-box.cx, dz=pz-box.cz;
      threat={box,across:dx*box.rx+dz*box.rz,vr:0};
      horn=true;
    }
  }

  const oldX=px, oldZ=pz;
  state.jump=Math.max(0,state.jump-dt);
  state.hold=Math.max(0,state.hold-dt);
  if(threat){
    const {box,across,vr}=threat;
    const side=Math.sign(across-vr*(horn?0:closest)) || state.side || 1;
    state.side=side;
    state.hold=horn?.85:1.35;
    state.yaw=Math.atan2(box.rx*side,box.rz*side);
    const stride=Math.min((horn?3.4:5.8)*dt,Math.max(0,box.hw+(horn?2.6:2.15)-Math.abs(across)));
    px+=box.rx*side*stride;
    pz+=box.rz*side*stride;
    if(!horn && closest<.29 && state.jump===0) state.jump=.48;
  } else if(!state.hold){
    const recovery=Math.min(1,dt*2.1/Math.max(.001,Math.hypot(state.x,state.z)));
    px-=state.x*recovery;
    pz-=state.z*recovery;
  }

  // Project out of a car's imminent swept footprint if there is no time for a full stride.
  for(const box of vehicles){
    if(Math.hypot(px-box.cx,pz-box.cz)>14 ||
      (box.y!=null && Math.abs(box.y-y)>2.7)) continue;
    const contact=approaching(box,px,pz,dt+.025);
    if(!contact) continue;
    const side=Math.sign(contact.across-contact.vr*contact.entry) || state.side || 1;
    const edge=box.hw+.78+Math.abs(contact.vr)*(dt+.025);
    const offset=side*edge-contact.across;
    px+=box.rx*offset;
    pz+=box.rz*offset;
    state.hold=1.35;
    if(!state.jump) state.jump=.48;
  }
  state.x=px-x;
  state.z=pz-z;
  const speed=Math.min(5.8,Math.hypot(px-oldX,pz-oldZ)/Math.max(.001,dt));
  if(speed>.05){
    yaw=Math.atan2(px-oldX,pz-oldZ);
    state.phase+=speed*dt*4.4;
  } else if(state.hold) yaw=state.yaw ?? yaw;
  const displaced=state.hold>0 || Math.hypot(state.x,state.z)>.06;
  const jump=.38*Math.sin(Math.PI*state.jump/.48);
  const reacting=upset&&!displaced&&pace<1.6;
  if(reacting)yaw=Math.atan2(upset.x-px,upset.z-pz);
  return {x:px,z:pz,y:height(px,pz)+jump,yaw,speed:reacting?0:displaced?speed:pace,
    phase:displaced?state.phase:phase,reaction:reacting?16:0};
}
