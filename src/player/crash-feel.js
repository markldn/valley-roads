// What the driver feels: the head moves against the car's acceleration, and hard impacts bring
// airbags, a cracked windscreen, blurred vision, ringing ears and, at worst, a blackout.
import * as T from '../vendor/three.module.js';

const JOLT=3.2, CRACK=5, AIRBAG=6.5, STUN=9, REPLAY=10, BLACKOUT=16; // change of speed in m/s
const clamp=T.MathUtils.clamp;
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];

export function createCrashFeel(view,audio) {
  const cracks=document.createElement('canvas'), shade=document.createElement('div');
  cracks.id='crash-cracks';shade.id='crash-shade';
  for(const element of [cracks,shade])
    Object.assign(element.style,{position:'fixed',inset:'0',width:'100%',height:'100%',pointerEvents:'none',zIndex:'1'});
  cracks.hidden=true;
  view.after(cracks,shade);
  const fractures=[];
  function paintFracture({x,y,size,seed}) {
    const ctx=cracks.getContext('2d'), w=cracks.width, h=cracks.height;
    let state=seed;
    const next=()=>{state=(state*16807)%2147483647;return state/2147483647;};
    const ox=x*w, oy=y*h, reach=size*Math.min(w,h);
    ctx.lineCap='round';
    const line=(ax,ay,bx,by,width,alpha)=>{
      ctx.strokeStyle=`rgba(232,240,240,${alpha})`;ctx.lineWidth=width;
      ctx.beginPath();ctx.moveTo(ax,ay);ctx.lineTo(bx,by);ctx.stroke();
    };
    const arms=9+Math.floor(next()*7), rings=[];
    for(let arm=0;arm<arms;arm++){
      let angle=arm/arms*Math.PI*2+next()*.4, px=ox, py=oy;
      const steps=5+Math.floor(next()*5), points=[];
      for(let step=0;step<steps;step++){
        const length=reach/steps*(.6+next()*.8);
        angle+=(next()-.5)*.5;
        const qx=px+Math.cos(angle)*length, qy=py+Math.sin(angle)*length;
        line(px,py,qx,qy,Math.max(.6,2.1-step*.26),.78-step*.05);
        if(next()<.42){
          const fork=angle+(next()<.5?-1:1)*(.45+next()*.6), run=length*(.5+next()*.7);
          line(qx,qy,qx+Math.cos(fork)*run,qy+Math.sin(fork)*run,.7,.5);
        }
        points.push([qx,qy]);px=qx;py=qy;
      }
      rings.push(points);
    }
    for(let ring=0;ring<3;ring++)for(let arm=0;arm<arms;arm++){
      const a=rings[arm][ring], b=rings[(arm+1)%arms][ring];
      if(a&&b&&next()<.72)line(a[0],a[1],b[0],b[1],.7,.42);
    }
    ctx.fillStyle='rgba(235,242,242,.5)';
    ctx.beginPath();ctx.arc(ox,oy,reach*.035,0,Math.PI*2);ctx.fill();
  }
  function resize() {
    cracks.width=innerWidth;cracks.height=innerHeight;
    fractures.forEach(paintFracture);
  }
  addEventListener('resize',resize);
  resize();

  const head=[0,0,0], headRate=[0,0,0], last=[0,0,0];
  let shake=0, roll=0, rollRate=0, stun=0, black=0, haze=0, recent=0, recentTime=0, peak=0;
  let severe=false, bag=null, bagAge=-1, time=0, note='', noteTime=0, primed=false;

  function fitAirbag(model) {
    const ud=model?.userData;
    if(!ud?.steerPivot||!ud.cockpit||!ud.body)return null;
    if(ud.airbag)return ud.airbag;
    const mesh=new T.Mesh(new T.SphereGeometry(1,20,14),new T.MeshStandardMaterial({color:0xece9df,roughness:.92}));
    const eye=ud.cockpit.clone(); eye.y-=ud.body.position.y;
    mesh.position.copy(ud.steerPivot.position).lerp(eye,.3);
    mesh.visible=false;
    ud.body.add(mesh);
    ud.airbag=mesh;
    return mesh;
  }
  function clear() {
    head.fill(0);headRate.fill(0);
    shake=roll=rollRate=stun=black=haze=recent=peak=0;
    bagAge=-1;
    if(bag)bag.visible=false;
    fractures.length=0;
    cracks.getContext('2d').clearRect(0,0,cracks.width,cracks.height);
    view.style.removeProperty('--impact-blur');view.style.removeProperty('--impact-saturation');shade.style.background='';shade.style.opacity='0';
    note='';primed=false;severe=false;
  }
  function impact(dv,vehicle,hit,model) {
    shake=Math.max(shake,clamp(dv*.02,.02,.32));
    rollRate+=(Math.random()<.5?-1:1)*clamp(dv*.09,.1,1.6);
    const local=[hit.P[0]-vehicle.p[0],hit.P[1]-vehicle.p[1],hit.P[2]-vehicle.p[2]];
    const frontal=-dot(hit.n,vehicle.forward)>.45;
    if(dv>=CRACK){
      const side=clamp(dot(local,vehicle.right)/(vehicle.spec.dims.wid*.5),-1,1);
      fractures.push({x:.5+side*.26+(Math.random()-.5)*.1,y:.16+Math.random()*.26,
        size:clamp(.16+dv*.022,.2,.62),seed:1+Math.floor(Math.random()*2e9)});
      paintFracture(fractures.at(-1));
    }
    if(dv>=AIRBAG&&frontal&&bagAge<0){
      bag=fitAirbag(model);
      if(bag){bag.visible=true;bagAge=0;haze=Math.max(haze,.72);note='Airbag deployed';noteTime=3;}
    }
    if(dv>=STUN){stun=Math.max(stun,clamp(dv/20,.45,1));audio?.daze?.(clamp(dv/22,.4,1),3+dv*.22);}
    if(dv>=BLACKOUT){note='Severe impact';noteTime=4;}
    if(dv>=REPLAY)severe=true;
    const pad=navigator.getGamepads?.()&&Array.from(navigator.getGamepads()).find(device=>device?.vibrationActuator);
    pad?.vibrationActuator.playEffect('dual-rumble',{duration:clamp(dv*40,120,900),strongMagnitude:clamp(dv/14,.3,1),weakMagnitude:.8}).catch?.(()=>{});
  }

  return {
    clear,
    get note(){return noteTime>0?note:'';},
    // Share of the driver's input that still reaches the car.
    get control(){return clamp(1-stun*.42,0,1);},
    // True once after an impact worth watching again.
    takeSevere(){const value=severe;severe=false;return value;},
    conceal(){cracks.hidden=true;view.style.removeProperty('--impact-blur');view.style.removeProperty('--impact-saturation');shade.style.opacity='0';shade.style.background='';},
    update(dt,vehicle,model,cockpit) {
      time+=dt;
      if(!primed){last[0]=vehicle.v[0];last[1]=vehicle.v[1];last[2]=vehicle.v[2];primed=true;}
      const change=[vehicle.v[0]-last[0],vehicle.v[1]-last[1],vehicle.v[2]-last[2]];
      last[0]=vehicle.v[0];last[1]=vehicle.v[1];last[2]=vehicle.v[2];
      const body=[dot(change,vehicle.right),dot(change,vehicle.up),dot(change,vehicle.forward)];
      for(let axis=0;axis<3;axis++)headRate[axis]-=clamp(body[axis],-14,14)*(axis===1?.42:.62);
      for(let left=Math.min(dt,.1);left>0;left-=1/240){
        const h=Math.min(left,1/240);
        for(let axis=0;axis<3;axis++){
          headRate[axis]+=(-105*head[axis]-15*headRate[axis])*h;
          head[axis]+=headRate[axis]*h;
        }
        rollRate+=(-70*roll-11*rollRate)*h;
        roll+=rollRate*h;
      }
      head[0]=clamp(head[0],-.2,.2);head[1]=clamp(head[1],-.09,.11);head[2]=clamp(head[2],-.12,.27);
      // Crash forces arrive over several frames, so they are summed over a short window.
      recentTime=vehicle.lastHit?.12:Math.max(0,recentTime-dt);
      const hit=vehicle.lastHit;
      if(recentTime>0){
        recent+=Math.hypot(...change);
        if(hit?.terrain)recent=Math.max(recent,hit.j/vehicle.spec.mass*.8);
      }else recent=peak=0;
      if(hit&&recent>=JOLT&&recent>peak+1.4){peak=recent;impact(recent,vehicle,hit,model);}
      shake=Math.max(0,shake-dt*.55);
      stun=Math.max(0,stun-dt*.2);black=Math.max(0,black-dt*.42);haze=Math.max(0,haze-dt*.3);
      noteTime=Math.max(0,noteTime-dt);
      if(bagAge>=0&&bag){
        bagAge+=dt;
        const inflated=Math.min(1,bagAge/.035), sag=T.MathUtils.smoothstep(bagAge,.22,2.4);
        bag.scale.set(.27*inflated*(1-sag*.34),.26*inflated*(1-sag*.55),.21*inflated*(1-sag*.7));
        bag.position.y=bag.userData.y??=bag.position.y;
        bag.position.y=bag.userData.y-sag*.11;
      }
      cracks.hidden=!cockpit||!fractures.length;
      const blur=stun*2.2;
      view.style.setProperty('--impact-blur',`${blur>.04?blur.toFixed(2):0}px`);
      view.style.setProperty('--impact-saturation',(1-stun*.55).toFixed(2));
      const dark=0, red=clamp(stun*.42,0,.42), pale=cockpit?haze*.55:0;
      if(dark>.002||red>.002||pale>.002){
        shade.style.opacity='1';
        shade.style.background=`radial-gradient(ellipse at center,rgba(${pale?'235,232,222':'60,0,0'},${(pale*.8).toFixed(3)}) 0%,`+
          `rgba(70,4,4,${(red*.75).toFixed(3)}) 62%,rgba(20,0,0,${Math.min(1,red+.15*Number(red>0)).toFixed(3)}) 100%),`+
          `rgba(0,0,0,${dark.toFixed(3)})`;
      }else if(shade.style.opacity!=='0'){shade.style.opacity='0';shade.style.background='';}
    },
    // Moves the camera for the head position. Call after the eye and target are known.
    view(eye,target,vehicle,inside) {
      const wobble=shake*(inside?1:.55);
      const dx=Math.sin(time*71)*wobble, dy=Math.sin(time*83+1.3)*wobble, dz=Math.sin(time*67+2.1)*wobble;
      const scale=inside?1:.35;
      for(const point of [eye,target]){
        const k=point===eye?1:.55;
        point.x+=(vehicle.right[0]*head[0]+vehicle.up[0]*head[1]+vehicle.forward[0]*head[2])*scale*k+dx;
        point.y+=(vehicle.right[1]*head[0]+vehicle.up[1]*head[1]+vehicle.forward[1]*head[2])*scale*k+dy;
        point.z+=(vehicle.right[2]*head[0]+vehicle.up[2]*head[1]+vehicle.forward[2]*head[2])*scale*k+dz;
      }
    },
    get roll(){return roll+head[0]*.32;},
    get pitch(){return -head[2]*.38;},
  };
}
