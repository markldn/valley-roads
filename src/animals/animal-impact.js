// A struck animal is thrown, tumbles and lands. After a light knock it gets back up.
const GRAVITY=9.8;

export function knockAnimal(animal,hit,mass,x,y,z,yaw) {
  const scale=1/mass;
  let vx=(hit.J?.[0]??0)*scale, vz=(hit.J?.[2]??0)*scale;
  const speed=Math.hypot(vx,vz), top=Math.min(1,17/(speed||1));
  vx*=top;vz*=top;
  const thrown=speed*top;
  animal.knock={x,y,z,vx,vz,vy:1+thrown*.3,yaw,tumble:0,spin:thrown*.8,down:thrown>3.6,rest:0,lie:0};
}

// Returns true once the animal is standing again.
export function stepKnock(animal,dt,height) {
  const k=animal.knock;
  const floor=height(k.x,k.z);
  if(k.y>floor+.01||k.vy>0){
    k.vy-=GRAVITY*dt;
    k.x+=k.vx*dt;k.z+=k.vz*dt;k.y+=k.vy*dt;
    k.tumble+=k.spin*dt;
    if(k.y<=floor){
      k.y=floor;
      k.vy=k.vy<-2?-k.vy*.28:0;
      k.vx*=.55;k.vz*=.55;k.spin*=.5;
    }
  }else{
    k.y=floor;
    k.rest+=dt;
    k.lie=Math.min(1,k.lie+dt*3);
    if(!k.down&&k.rest>4.5)return true;
  }
  const settled=k.tumble+(Math.round(k.tumble/Math.PI)*Math.PI+Math.PI/2-k.tumble)*k.lie;
  animal.root.position.set(k.x,k.y+Math.abs(Math.sin(settled))*.16,k.z);
  animal.root.rotation.set(0,k.yaw,settled);
  return false;
}

// Oriented box for the car to collide with.
export const animalBox=(animal,x,y,z,yaw,hl,hw,mass,light=false)=>{
  const fx=Math.sin(yaw),fz=Math.cos(yaw);
  return {cx:x,cz:z,fx,fz,rx:fz,rz:-fx,y,hl,hw,mass,vx:0,vz:0,animal,light};
};
