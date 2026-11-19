const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];

// Game thresholds in equivalent impact speed (m/s).
const INJURY=11, FATAL=24;

export function createOccupantImpact(){
  const offset=[0,0,0], rate=[0,0,0];
  let outcome='okay', slump=0;
  return {
    offset,
    get outcome(){return outcome;},
    get slump(){return slump;},
    reset(){offset.fill(0);rate.fill(0);outcome='okay';slump=0;},
    step(dt,vehicle,before){
      const hit=vehicle.lastHit;
      const change=vehicle.v.map((value,i)=>value-before[i]);
      if(hit&&outcome!=='fatal'){
        const impulse=hit.j/vehicle.spec.mass;
        // Landings use closing speed. Suspension can spread the actual
        // change in cabin velocity across several physics steps.
        const severity=hit.terrain?impulse*.8:impulse;
        if(severity>=FATAL)outcome='fatal';
        else if(severity>=INJURY)outcome='injured';
        if(impulse>1.5&&Math.hypot(...change)<impulse*.5)
          for(let i=0;i<3;i++)change[i]=hit.n[i]*impulse*.65;
      }
      const axes=[vehicle.right,vehicle.up,vehicle.forward];
      const limits=[.17,.11,.23];
      for(let i=0;i<3;i++){
        rate[i]-=clamp(dot(change,axes[i]),-22,22)*.53;
        for(let remaining=dt;remaining>0;remaining-=1/240){
          const h=Math.min(remaining,1/240);
          rate[i]+=(-85*offset[i]-13*rate[i])*h;
          offset[i]=clamp(offset[i]+rate[i]*h,-limits[i],limits[i]);
        }
      }
      if(outcome==='fatal')slump+=(1-slump)*Math.min(1,dt*3);
    }
  };
}
