// Lanes are indexed from the shoulder toward the median.
export function passingLane({lane, laneCount, speed, cruising, remaining, neighbors}) {
  const changingRoom=Math.max(35,speed*2.8);
  const mustReturn=remaining<changingRoom*(lane+1)+30;
  const safe=target=>{
    const front=Math.max(13,speed*1.1);
    return !neighbors.some(other=>{
      if(Math.abs(other.lane-target)>.64&&Math.abs(other.target-target)>.64)return false;
      const rear=Math.max(12,other.speed*1.15+Math.max(0,other.speed-speed)*2.3);
      return other.ahead> -rear&&other.ahead<front+Math.max(0,speed-other.speed)*2;
    });
  };
  const impeded=(index,range)=>neighbors.some(other=>Math.abs(other.lane-index)<.62&&
    other.ahead>0&&other.ahead<range&&other.speed+2<cruising);
  if(lane>0&&(mustReturn||!impeded(lane-1,Math.max(45,speed*3.2)))&&safe(lane-1))return lane-1;
  const blocked=impeded(lane,Math.max(42,speed*3));
  if(!mustReturn&&remaining>Math.max(135,speed*7)&&blocked&&lane+1<laneCount&&safe(lane+1))return lane+1;
  return lane;
}
