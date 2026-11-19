// Where shopping malls, supermarkets, roadside restaurants and car parks go, and the shape of their
// tarmac. It has no rendering, because the terrain, the wheels and the buildings all depend on it.

const SIZES={
  mall:{w:156,d:116,bw:108,bd:46,apron:8,drives:[-.28,.28]},
  market:{w:88,d:74,bw:54,bd:30,apron:6,drives:[-.27,.27]},
  diner:{w:50,d:40,bw:22,bd:12,apron:3.5,drives:[-.28]},
  parking:{w:40,d:32,bw:0,bd:0,apron:0,drives:[0]},
  fuel:{w:76,d:56,bw:24,bd:11,apron:3,drives:[-.34,.34]},
};
export const FUEL_BRANDS=[{name:'Soléa',color:0xe8a818,accent:0xc8281e},{name:'Verdis',color:0x1f8a4c,accent:0xf0d83a},
  {name:'Azur Énergie',color:0x1c62b4,accent:0xe9f0f6},{name:'Rouge & Or',color:0xb51d2a,accent:0xecc24a}];
const GAP=7, AISLE=6.6, BAY_DEPTH=5, BAY_WIDTH=2.6, ISLAND=1.5;

function layout(pad) {
  const {w,d,bw,bd,apron}=pad;
  const lotEnd=bd?d-bd-apron-1:d-1.6, door=0;
  const bays=[], islands=[], lamps=[], trees=[];
  const edge=w/2-7.5;
  // Rows back to back, with a planted island between each pair and an aisle either side.
  let b=1.6+AISLE;
  if(pad.kind==='fuel'){
    // Three pump islands under the canopy, with a stopping place on each side of every pump.
    pad.stops=[];
    [-20,0,20].forEach((a,island)=>{
      islands.push({a0:a-6.2,a1:a+6.2,b0:18.6,b1:20.4});
      [-3,3].forEach((offset,pump)=>{
        pad.stops.push({a:a+offset,b:15.9,number:island*4+pump*2+1,pumpA:a+offset,pumpB:19.5},{a:a+offset,b:24.1,number:island*4+pump*2+2,pumpA:a+offset,pumpB:19.5});
      });
    });
    for(let a=-9;a<=9;a+=BAY_WIDTH)bays.push({a,b:lotEnd-2.5,facing:1,rank:0});
    b=Infinity;
  }
  while(b+BAY_DEPTH<=lotEnd-AISLE*.8){
    const pair=b+BAY_DEPTH*2+ISLAND+AISLE*.8<=lotEnd;
    for(let a=-edge+BAY_WIDTH/2;a<edge;a+=BAY_WIDTH){
      if(bd&&Math.abs(a-door)<3.2)continue;
      bays.push({a,b:b+BAY_DEPTH/2,facing:1,rank:0});
      if(pair)bays.push({a,b:b+BAY_DEPTH+ISLAND+BAY_DEPTH/2,facing:-1,rank:0});
    }
    if(pair){
      islands.push({a0:-edge,a1:edge,b0:b+BAY_DEPTH,b1:b+BAY_DEPTH+ISLAND});
      for(let a=-edge+6;a<edge;a+=13)trees.push({a,b:b+BAY_DEPTH+ISLAND/2});
      for(let a=-edge+12.5;a<edge;a+=26)lamps.push({a,b:b+BAY_DEPTH+ISLAND/2});
    }
    b+=(pair?BAY_DEPTH*2+ISLAND:BAY_DEPTH)+AISLE;
  }
  if(!lamps.length)lamps.push({a:-w/2+1,b:d/2},{a:w/2-1,b:d/2});
  islands.push({a0:-w/2,a1:-w/2+1.5,b0:0,b1:d},{a0:w/2-1.5,a1:w/2,b0:0,b1:d});
  // The kerb along the road is broken only by the driveways.
  const openings=pad.driveways.map(({a,width})=>[a-width/2,a+width/2]).sort((p,q)=>p[0]-q[0]);
  let from=-w/2;
  for(const [a0,a1] of [...openings,[w/2,w/2]]){
    if(a0>from)islands.push({a0:from,a1:a0,b0:0,b1:1.5});
    from=a1;
  }
  if(bd)islands.push({a0:-bw/2-3,a1:bw/2+3,b0:d-bd-apron,b1:d-bd});
  pad.bays=bays;pad.islands=islands;pad.lamps=lamps;pad.trees=trees;pad.lotEnd=lotEnd;
  pad.building=bd?{a0:-bw/2,a1:bw/2,b0:d-bd,b1:d-1}:null;
}

export function padLocal(pad,x,z) {
  const dx=x-pad.x, dz=z-pad.z;
  return [dx*pad.ax+dz*pad.az,dx*pad.bx+dz*pad.bz];
}
export function padPoint(pad,a,b) {
  return [pad.x+pad.ax*a+pad.bx*b,pad.z+pad.az*a+pad.bz*b];
}

function reach(pad,x,z) {
  const dx=x-pad.cx, dz=z-pad.cz;
  return dx*dx+dz*dz<pad.radius*pad.radius;
}

// True on tarmac belonging to a pad, driveways included.
export function padCover(pads,x,z) {
  for(const pad of pads){
    if(!reach(pad,x,z))continue;
    const [a,b]=padLocal(pad,x,z);
    if(Math.abs(a)<=pad.w/2&&b>=0&&b<=pad.d)return true;
    if(b<0&&b>=-GAP&&pad.driveways.some(drive=>Math.abs(a-drive.a)<=drive.width/2))return true;
  }
  return false;
}

// Height of the tarmac at a point, or null off the pads. Kerbed islands stand 14 cm proud.
export function padLevel(pads,x,z,roadHeight) {
  for(const pad of pads){
    if(!reach(pad,x,z))continue;
    const [a,b]=padLocal(pad,x,z);
    if(Math.abs(a)<=pad.w/2&&b>=0&&b<=pad.d){
      const kerb=pad.islands.some(item=>a>=item.a0&&a<=item.a1&&b>=item.b0&&b<=item.b1);
      return pad.y+(kerb?.14:0);
    }
    if(b<0&&b>=-GAP+.6&&pad.driveways.some(drive=>Math.abs(a-drive.a)<=drive.width/2)){
      const t=1+b/(GAP-.6), blend=t*t*(3-2*t);
      return roadHeight(x,z)+.16+(pad.y-roadHeight(x,z)-.16)*blend;
    }
  }
  return null;
}

export function planRetail(world,rng) {
  const pads=[];
  const {roads,streets,towns,point,grid,height,roadHeight,land,riverEdge,roadDistance,nearestStreet,highwayAt,engineeredAt,rampAt}=world;
  function fit(kind,px,pz,tx,tz,side,roadHalf,town) {
    const size=SIZES[kind], bx=tz*side, bz=-tx*side;
    const x=px+bx*(roadHalf+GAP), z=pz+bz*(roadHalf+GAP);
    const radius=Math.hypot(size.w/2,size.d)+GAP;
    const cx=x+bx*size.d/2, cz=z+bz*size.d/2;
    if(pads.some(pad=>Math.hypot(pad.cx-cx,pad.cz-cz)<pad.radius+radius))return null;
    let low=Infinity, high=-Infinity;
    for(let i=0;i<=8;i++)for(let j=0;j<=6;j++){
      const a=(i/8-.5)*size.w, b=j/6*size.d;
      const sx=x+tx*a+bx*b, sz=z+tz*a+bz*b;
      if(land(sx,sz)>=3||riverEdge(sx,sz)<14)return null;
      const [u,v]=grid(sx,sz);
      if(roadDistance(u,v,true)<(j===0?.8:2.5)||(nearestStreet(u,v)?.edge??9)<(j===0?.8:2.5))return null;
      if(highwayAt(u,v,8)||engineeredAt(sx,sz)||(rampAt(sx,sz)?.edge??9)<4)return null;
      const y=height(sx,sz);
      low=Math.min(low,y);high=Math.max(high,y);
    }
    if(high-low>2.6)return null;
    if(size.bd){
      const buildingDepth=size.bd-1, center=size.d-(size.bd+1)/2;
      if(world.roadCutsFootprint(x+bx*center,z+bz*center,tx,tz,size.bw/2,buildingDepth/2))return null;
    }
    const y=high+.12, shoulder=roadHeight(px+bx*roadHalf,pz+bz*roadHalf)+.16;
    if(Math.abs(y-shoulder)>1.5)return null;
    const pad={kind,town,x,z,ax:tx,az:tz,bx,bz,y,cx,cz,radius,gap:GAP,...size,
      driveways:size.drives.map(share=>({a:share*size.w,width:kind==='parking'?7:9}))};
    layout(pad);
    pad.bays.forEach(bay=>{bay.rank=rng();bay.tint=Math.floor(rng()*1e6);});
    if(kind==='fuel'){pad.brand=FUEL_BRANDS[Math.floor(rng()*FUEL_BRANDS.length)];pad.priceShift=Math.round((rng()-.5)*14)/100;}
    pads.push(pad);
    return pad;
  }
  // Tries stations along the regional roads, at a chosen distance band from a town.
  function alongRoads(kind,town,near,far) {
    const options=[];
    for(const road of roads){
      if(road.highway)continue;
      for(const [start,end] of road.spans)for(let along=start+90;along<end-90;along+=30){
        const [u,v]=road.alongX?[along,road.cross]:[road.cross,along];
        const range=Math.hypot(u-town.u,v-town.v);
        if(range>=near&&range<=far)options.push({road,along,rank:rng()});
      }
    }
    options.sort((p,q)=>p.rank-q.rank);
    for(const {road,along} of options.slice(0,320)){
      const at=s=>road.alongX?point(s,road.cross):point(road.cross,s);
      const [px,pz]=at(along),[qx,qz]=at(along+4),length=Math.hypot(qx-px,qz-pz)||1;
      for(const side of rng()<.5?[1,-1]:[-1,1]){
        const pad=fit(kind,px,pz,(qx-px)/length,(qz-pz)/length,side,road.width/2,town);
        if(pad){
          const span=road.spans.find(([start,end])=>along>=start&&along<=end);
          pad.road={road,along,span};
          return pad;
        }
      }
    }
    return null;
  }
  function alongStreets(kind,town,wanted) {
    const urban=streets.filter(street=>street.urban&&street.town===town).map(street=>({street,rank:rng()})).sort((p,q)=>p.rank-q.rank);
    let placed=0;
    for(const {street} of urban){
      if(placed>=wanted)break;
      for(let i=1;i<street.points.length-1&&placed<wanted;i+=2){
        const [px,pz]=point(...street.points[i]),[qx,qz]=point(...street.points[i+1]);
        const length=Math.hypot(qx-px,qz-pz);
        if(length<3)continue;
        for(const side of [1,-1])if(fit(kind,px,pz,(qx-px)/length,(qz-pz)/length,side,street.width/2+1.8,town)){placed++;break;}
      }
    }
  }
  for(const town of towns.filter(item=>item.tier==='hub')){
    alongRoads('mall',town,town.radius*.72,town.radius*1.5);
    if(town.radius>950)alongRoads('mall',town,town.radius*.6,town.radius*1.4);
    alongRoads('market',town,town.radius*.45,town.radius*1.3);
    alongRoads('diner',town,town.radius*.9,town.radius*1.7);
    alongRoads('fuel',town,town.radius*.5,town.radius*1.25);
    alongRoads('fuel',town,town.radius*.95,town.radius*1.8);
    alongStreets('parking',town,Math.round(2+town.radius/190));
  }
  for(const town of towns.filter(item=>item.tier==='village')){
    if(rng()<.75)alongRoads('market',town,town.radius+10,town.radius+170);
    if(rng()<.6)alongRoads('diner',town,town.radius+30,town.radius+320);
    if(rng()<.7)alongRoads('fuel',town,town.radius+10,town.radius+420);
  }
  return pads;
}
