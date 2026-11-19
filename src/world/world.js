import { padCover, padLevel, planRetail } from './retail-plan.js';
import {buildJunctions,corridor,cutForScenicRoad,engineeredIndex,mountainNetwork,pruneDeadEnds,regionalNetwork,smoothCorners} from './network.js';

// World coordinates are in metres. Roads use a warped grid so junctions share
// the same centerline and elevation, including where two roads cross.
export const LIMIT = 2450;
export const MAP_RADIUS = 2510;
export const ROAD_WIDTH = 9;
export const BRIDGE_APPROACH = 105;
export const OUTER_SPACING = 760;
export const FIELD_ROW_SPACING = 1.4;
const fieldNormalLength = Math.hypot(.94,.34);
export const FIELD_ROW_NORMAL = Object.freeze([.94/fieldNormalLength,.34/fieldNormalLength]);
export const ROAD_WAVES = Object.freeze([
  [2.3,3.1,.017], [-5.4,2.2,.012], [12.4,-9.3,.004],
]);
export function roadRelief(x,z) {
  let y=0;
  for(const [a,b,amplitude] of ROAD_WAVES) y+=Math.sin(x*a+z*b)*amplitude;
  return y;
}

const repairCell=9;
export function roadWear(x,z) {
  const ix=Math.floor(x/repairCell),iz=Math.floor(z/repairCell);
  let hash=Math.imul(ix,73856093)^Math.imul(iz,19349663);
  hash=Math.imul(hash^(hash>>>16),2246822519);
  const salt=((hash^(hash>>>13))&65535)/65536;
  if(salt<.78)return 0;
  const cx=repairCell*(ix+.28+(salt-.78)*1.88),cz=repairCell*(iz+.40+(salt-.78)*.82);
  const u=x-cx,v=z-cz;
  const oval=(u+.43*v)**2*1.05+(v-.24*u)**2*1.82;
  const edge=Math.max(0,1-oval);
  return -.078*edge*edge;
}

export const ROAD_WEAR_GLSL=`
  float repairWear(vec2 p) {
    ivec2 cell=ivec2(floor(p/${repairCell.toFixed(1)}));
    uint hash=(uint(cell.x)*73856093u)^(uint(cell.y)*19349663u);
    hash=(hash^(hash>>16u))*2246822519u;
    float salt=float((hash^(hash>>13u))&65535u)/65536.;
    vec2 delta=p-(vec2(cell)+vec2(.28,.40)+(salt-.78)*vec2(1.88,.82))*${repairCell.toFixed(1)};
    vec2 skew=vec2(delta.x+.43*delta.y,delta.y-.24*delta.x);
    return step(.78,salt)*pow(max(0.,1.-dot(skew*skew,vec2(1.05,1.82))),2.);
  }
`;

// Settlement profile of a rural region: many hamlets, a few towns, one or two cities.
// Fictional distances are compressed so villages are a short drive apart.
export const REGIONAL_PROFILE = Object.freeze({
  settlements: 536, population: 233185, medianPopulation: 198,
  below500: 437, below2000: 522, nearestMedianKm: 2.21,
});

const villageNames = ['Les Ormes', 'Bellecombe', 'Rochebrune', 'Les Saules', 'Fontenelle',
  'Montfauvet', 'La Vignotte', 'Clairpré', 'Bois-Rond', 'Pré-des-Roches', 'Les Granges',
  'Vaux-Fleury', 'La Rosière', 'Les Prés-Neufs', 'Bois-des-Moulins', 'Haute-Croix',
  'Champ-Rond','La Bussière','Vaux-sur-Rives','Les Vernes'];
const additionalVillageNames=['Aubecourt','Clairbois','Montrive','Bellefont',
  'Hautelande','Préjoli','Bois-Fleuri','Rocheclaire','Val-des-Prés','Mont-sur-Rive',
  'Les Bruyères','Vallonnet','Chantebois','Font-Rouge','Lormontel','Vaux-des-Bois',
  'Brècheval','Villebrume','La Saulaie','Les Genêts','Riveclaire','Beaupré-le-Haut',
  'La Frênaie','Pierreval','Les Chardons','Bois-Joli','Les Hauts Prés','Ormeval',
  'Fontbrune','Rocheval','La Chênaie','Bassecombe'];

export function seedNumber(text) {
  let hash = 2166136261;
  for (const character of text) hash = Math.imul(hash ^ character.codePointAt(0), 16777619);
  return hash >>> 0;
}

export function random(seed) {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let bits = Math.imul(seed ^ seed >>> 15, 1 | seed);
    bits ^= bits + Math.imul(bits ^ bits >>> 7, 61 | bits);
    return ((bits ^ bits >>> 14) >>> 0) / 4294967296;
  };
}

function cityStreets(rng,town,scale,layers=3) {
  const rings = [];
  const phase = rng() * Math.PI * 2;
  const aspect = 1 + rng()*.37, rotation = phase*.5;
  const cos = Math.cos(rotation), sin = Math.sin(rotation);
  const lobe = 2+Math.floor(rng()*3);
  for (const base of [92,188,324,460].slice(0,layers)) {
    const radius = base*(.91+rng()*.18);
    const ring = [];
    for (let step = 0; step < 48; step++) {
      const angle = step / 48 * Math.PI * 2;
      const r = radius * (1 + .14 * Math.sin(angle * lobe + phase) + .09 * Math.cos(angle * 5 - phase));
      const x=Math.cos(angle)*r*aspect*scale,z=Math.sin(angle)*r/aspect*scale;
      ring.push([town.u+x*cos-z*sin,town.v+x*sin+z*cos]);
    }
    rings.push(ring);
  }
  const loops = rings.map(points => [...points, points[0]]);
  const streets = loops.map((points, i) => ({ points, width: i === 1 ? 7.5 : 6.5, surface: i === 0 ? 8 : 7 }));
  for (let layer = 0; layer < rings.length-1; layer++) {
    const spokes=layer===0?7+Math.floor(rng()*3):5+Math.floor(rng()*3);
    const offset=Math.floor(rng()*48);
    for (let i=0;i<spokes;i++) {
      const step=(offset+Math.floor(i*48/spokes)+Math.floor(rng()*3))%48;
      const a = rings[layer][step];
      const b = rings[layer + 1][(step + 2) % 48];
      const mid = [(a[0] + b[0]) / 2 + (rng() - .5) * 32, (a[1] + b[1]) / 2 + (rng() - .5) * 34];
      streets.push({ points: smoothCorners([a,mid,b],22), width: 5.8, surface: layer === 0 && step % 2 ? 8 : 7 });
    }
  }
  const frontage=layers===4?4:scale>1?3:2;
  const block=Math.round(43+scale*14+rng()*11);
  const extent=block*(frontage+.27);
  for(const alongX of [false,true]) for(let index=-frontage;index<=frontage;index++){
    if(index===0) continue;
    const cross=(alongX?town.v:town.u)+index*block;
    const nucleus=alongX?town.u:town.v;
    const stretch=extent+block*(rng()*.4-.12);
    const steps=Math.ceil(stretch*2/11);
    const points=Array.from({length:steps+1},(_,j)=>{
      const along=nucleus-stretch+2*stretch*j/steps;
      return alongX?[along,cross]:[cross,along];
    });
    streets.push({points,width:Math.abs(index)%2?6.6:7.2,surface:Math.abs(index)===1?8:7});
  }
  const blocks=[[-1,-1],[1,1],[-2,0],[0,-2]].map(([i,j])=>
    [town.u+i*block,town.v+j*block,town.u+(i+1)*block,town.v+(j+1)*block]);
  return { streets:streets.map(street=>({...street,urban:true,town})), loops, blocks };
}

export function cellSeed(seed,x,z) {
  return (seed ^ Math.imul(x,0x9e3779b1) ^ Math.imul(z,0x85ebca77)) >>> 0;
}

// Sliders on the menu, in percent. 100 leaves the seed as it is.
export const WORLD_SLIDERS = Object.freeze([
  {key:'mountains',label:'Mountains'},{key:'cities',label:'City size'},{key:'towns',label:'Towns and villages'},
  {key:'forest',label:'Forest'},{key:'traffic',label:'Traffic'},{key:'people',label:'People'},
  {key:'airtraffic',label:'Air traffic'},
]);
export const WORLD_SLIDER_MAX=400;
function worldShape(custom) {
  const share=key=>Math.max(0,Math.min(WORLD_SLIDER_MAX,custom[key]??100))/100;
  const m=share('mountains'),c=share('cities'),t=share('towns');
  return {terrain:m>=1.5?'upland':m<=.35?'lowland':undefined,relief:m<=1?.25+.75*m:1+(m-1)*.6,peaks:m<=1?1:1+(m-1)*.5,noPeaks:m<.2,
    urbanScale:c<=1?.45+.55*c:1+(c-1)*.5,cities:c>=1.6?3:c<=.3?1:undefined,cityScale:c<=1?.5+.5*c:1+(c-1)*.7,
    hamlets:t,villageScale:.7+.3*t,forest:share('forest'),traffic:share('traffic')*1.6,
    people:share('people'),airTraffic:share('airtraffic')};
}

export function createWorld(seed, custom={}) {
  const type=worldShape(custom);
  const rng = random(seed);
  const profile=random(seed ^ 0x19f1626d);
  const terrainDraw=profile();
  const terrain=type.terrain??(terrainDraw<.32?'lowland':terrainDraw<.73?'rolling':'upland');
  const urbanDensity=Math.max(.54,Math.min(1.95,(.54+profile()*1.38)*type.urbanScale));
  const forestDensity=(.65+profile()*.85)*(type.forest??1);
  const cityCount=type.cities??(urbanDensity>1.56?3:urbanDensity>1.0?2:1);
  const urbanAreas=[];
  let engineeredAt=()=>null;
  let rampAt=()=>null;
  const motorwayProfiles=[];
  const a = rng() * 6.28;
  const b = rng() * 6.28;
  const bends=random(seed ^ 0x682e51fb);
  const sweepX=82+bends()*35,sweepZ=78+bends()*32;
  const wavelengthX=395+bends()*100,wavelengthZ=440+bends()*120;
  const detailX=bends()*Math.PI*2,detailZ=bends()*Math.PI*2;
  const offsetX = v => sweepX*Math.sin(v/wavelengthX+a)+22*Math.sin(v/172+detailX);
  const offsetZ = u => sweepZ*Math.sin(u/wavelengthZ+b)+20*Math.cos(u/190+detailZ);
  const point = (u, v) => [u + offsetX(v), v + offsetZ(u)];
  const grid = (x, z) => {
    let u = x;
    let v = z;
    for (let i = 0; i < 8; i++) {
      u = x - offsetX(v);
      v = z - offsetZ(u);
    }
    return [u, v];
  };
  const reliefScale=(terrain==='lowland'?.52:terrain==='rolling'?.83:1)*(type.relief??1);
  const relief = (x, z) => reliefScale*(34 * Math.sin(x / 430 + a) * Math.cos(z / 570 + b)
    + 17 * Math.sin((x + z) / 325) + 5 * Math.cos(z / 131 + a)
    + 31 * Math.sin(x / 1000 - z / 1400 + b));
  const smooth = (lo,hi,value) => {
    const t=Math.max(0,Math.min(1,(value-lo)/(hi-lo)));
    return t*t*(3-2*t);
  };
  function baseHeight(x,z) {
    let mountain=0;
    let coords;
    for(const {u,v,h,su,sv,x:cx,z:cz} of summits){
      if(Math.abs(x-cx)>su+125 || Math.abs(z-cz)>sv+123) continue;
      coords??=grid(x,z);
      const dx=(coords[0]-u)/su, dz=(coords[1]-v)/sv;
      const rim=Math.max(0,1-dx*dx-dz*dz);
      if(rim>0){
        const shoulder=.88+.12*Math.cos(dx*3.2+dz*2.4+a)+.10*Math.cos(dz*5.3-dx*2.7+b);
        const bearing=Math.atan2(dz,dx);
        const slope=Math.sqrt(dx*dx+dz*dz);
        const ribs=Math.abs(Math.sin(bearing*4.5+dx*4.2+a)+.27*Math.sin(bearing*9.5+dz*3.8));
        const ravine=(1-Math.min(1,ribs*1.9))**2 * smooth(.08,.30,slope);
        const strata=.024*Math.sin(x*.082+z*.061+2*Math.sin(z*.018))+.010*Math.cos(x*.15-z*.128);
        const cityMask=urbanAreas.reduce((fade,town)=>Math.min(fade,
          smooth(town.radius*.89,town.radius+155,Math.hypot(coords[0]-town.u,coords[1]-town.v))),1);
        mountain+=h*rim**1.70*(shoulder-.19*ravine+strata)*cityMask;
      }
    }
    return relief(x,z)+mountain;
  }
  const riverProfile=random(seed ^ 0xd4a610ab);
  const riverSide=riverProfile()<.5?-1:1;
  const valleyOffset=680+riverProfile()*270, valleyBearing=(riverProfile()-.5)*.33;
  const riverX = z => riverSide*(valleyOffset + valleyBearing*z + 86*Math.sin(z/540+b) + 38*Math.sin(z/202+a));
  const riverWidth = z => (23+4*Math.sin(z/260+a))*(1-smooth(2970,3250,Math.abs(z)));
  const riverHeight = z => -12+z*.0032;
  const riverEdge = (x,z) => Math.abs(x-riverX(z))-riverWidth(z);
  function naturalHeight(x,z) {
    const base=baseHeight(x,z), width=riverWidth(z), edge=riverEdge(x,z);
    if(width<.05 || edge>380) return base;
    const taper=smooth(0,15,width);
    const channel=riverHeight(z)+Math.min(edge*.33,4+Math.max(0,edge-16)*.027);
    return base+(channel-base)*(1-smooth(15,380,edge))*taper;
  }
  function motorwayGrade(x,z,base,deck=false) {
    let coords;
    for(const {road,points,step} of motorwayProfiles){
      if(Math.abs((road.alongX?z:x)-road.cross)>160)continue;
      coords??=grid(x,z);
      const along=coords[road.alongX?0:1], across=Math.abs(coords[road.alongX?1:0]-road.cross);
      const width=motorwayWidth(road,along),edge=across-width*.5;
      if(edge>26 || along<road.start || along>road.end)continue;
      const f=(along-road.start)/step, index=Math.min(points.length-2,Math.floor(f));
      const crown=.022*Math.max(0,Math.min(width*.5,across)-road.innerShoulder);
      const bed=points[index]+(points[index+1]-points[index])*(f-index)-crown;
      const endBlend=smooth(0,225,Math.min(along-road.start,road.end-along));
      const bank=deck?1:smooth(4,45,riverEdge(x,z));
      return base+(bed-base)*endBlend*bank*(1-smooth(.4,25,edge));
    }
    return base;
  }

  function baseTerrainHeight(x,z) {
    const natural=motorwayGrade(x,z,naturalHeight(x,z));
    if(highways.length && highwayAt(...grid(x,z))) return natural;
    const tunnel=engineeredAt(x,z,'tunnel');
    const cut=tunnel&&!tunnel.covered?cutForScenicRoad(natural,tunnel):natural;
    return cutForScenicRoad(cut,engineeredAt(x,z,'summit'));
  }

  function height(x,z) {
    const terrain=baseTerrainHeight(x,z);
    const ramp=rampAt(x,z);
    if(!ramp||ramp.edge>27||riverEdge(x,z)<6) return terrain;
    const [u,v]=grid(x,z),road=ramp.path.sideRoad;
    if(highwayAt(u,v)||Math.abs((road.alongX?v:u)-road.cross)<road.width*.5)return terrain;
    const floor=rampDeck(ramp.path,x,z,ramp.y,terrain)-.42;
    return terrain+(Math.min(terrain,floor)-terrain)*(1-smooth(15,27,ramp.edge));
  }
  function roadHeight(x,z,terrain=height(x,z)) {
    const width=riverWidth(z),edge=riverEdge(x,z);
    const clearance=width>.05&&edge<BRIDGE_APPROACH?Math.max(0,riverHeight(z)+4.7-terrain):0;
    const ordinary=terrain+clearance*(1-smooth(6,BRIDGE_APPROACH,edge))*smooth(0,15,width);
    return motorwayGrade(x,z,ordinary,true);
  }
  let retailPads=[];
  const land = (x, z) => {
    if(retailPads.length&&padCover(retailPads,x,z)) return 4;
    if(riverEdge(x,z)<0 && riverWidth(z)>.3) return 3;
    const cover = Math.sin(x * .007 + a) + Math.cos(z * .009 + b) + .32 * Math.sin((x + z) * .013);
    const wooded=cover+.35*Math.sin(x*.041+a)*Math.cos(z*.033+b)+.17*Math.sin((x+z)*.073);
    return cover > .62 ? 1 : wooded < -.83+(forestDensity-1)*.53 ? 2 : 0;
  };
  const axes = scale => [-940 + rng() * 130, -610 + rng() * 240, 0,
    260 + rng() * 240, 710 + rng() * 235].map(coordinate => coordinate * scale);
  const u = axes(1.81), v = axes(1.55);
  // Keep the mountain mass between arterial lines so the roads skirt the peaks.
  const mountainCells=[[0,1],[3,0],[0,3],[3,3],[1,0]];
  const summits=mountainCells.filter((_,i)=>!type.noPeaks&&(terrain==='upland'?i<4:terrain==='rolling' && i<2))
    .map(([i,j])=>{
      const width=u[i+1]-u[i],depth=v[j+1]-v[j];
      const cu=(u[i]+u[i+1])/2, cv=(v[j]+v[j+1])/2;
      const [x,z]=point(cu,cv);
      const size=Math.min(width,depth);
      const maxH=terrain==='upland'?305:160;
      const h=Math.min(maxH,.53*size)*(1+profile()*.23)*(type.peaks??1);
      return {u:cu,v:cv,x,z,h,su:width*.48,sv:depth*.48};
    });
  function terrainCost(u,v,U,V) {
    const samples=Array.from({length:9},(_,i)=>point(u+(U-u)*i/8,v+(V-v)*i/8));
    let cost=0, previous;
    for(const [x,z] of samples){
      const y=naturalHeight(x,z);
      if(previous){
        const grade=Math.abs(y-previous.y)/Math.hypot(x-previous.x,z-previous.z);
        cost+=Math.max(0,grade-.045)*3;
        if((riverEdge(x,z)<0)!==(riverEdge(previous.x,previous.z)<0)) cost+=.11;
      }
      previous={x,z,y};
    }
    return cost;
  }
  const topology=random(seed ^ 0x1352b22b);
  const {roads,circuits}=regionalNetwork(u,v,LIMIT,topology,terrainCost);
  const eligible=roads.filter(road=>road.cross!==0 && road.end-road.start>1700 &&
    road.start<0 && road.end>0);
  const motorwayRank=eligible.map(road=>({road,rank:topology()+
    (road.alongX?terrainCost(road.start,road.cross,road.end,road.cross):
      terrainCost(road.cross,road.start,road.cross,road.end))}));
  motorwayRank.sort((a,b)=>a.rank-b.rank);
  const first=motorwayRank[0]?.road;
  const second=motorwayRank.find(({road})=>first && road.alongX===first.alongX &&
    Math.abs(road.cross-first.cross)>750)?.road;
  const highways=[first,urbanDensity>1.4?second:null].filter(Boolean);
  highways.forEach((road,index)=>{
    road.highway=true;
    road.lanes=index===0&&urbanDensity>1.45?3:2;
    road.laneWidth=3.55;
    road.innerShoulder=1.15;
    road.outerShoulder=2.65;
    road.width=2*(road.innerShoulder+road.lanes*road.laneWidth+road.outerShoulder);
    road.name=index?'A 74':'A 36';
  });
  pruneDeadEnds(roads,LIMIT);
  function motorwayWidth(road,along){
    if(!road.tapers)return road.width;
    const start=smooth(0,road.tapers[0],along-road.start);
    const end=smooth(0,road.tapers[1],road.end-along);
    return ROAD_WIDTH+(road.width-ROAD_WIDTH)*Math.min(start,end);
  }
  function highwayAt(u,v,extra=0) {
    return highways.find(road=>{
      const along=road.alongX?u:v, across=road.alongX?v:u;
      return along>=road.start && along<=road.end && Math.abs(across-road.cross)<=motorwayWidth(road,along)*.5+extra;
    });
  }
  const candidates=[];
  for(const row of roads.filter(road=>road.alongX&&!road.highway)){
    for(const column of roads.filter(road=>!road.alongX&&!road.highway)){
      const u=column.cross,v=row.cross;
      if((!u&&!v)||u<row.start||u>row.end||v<column.start||v>column.end) continue;
      const [x,z]=point(u,v),bank=riverEdge(x,z);
      if(bank<45) continue;
      const grade=Math.hypot(naturalHeight(x+22,z)-naturalHeight(x-22,z),
        naturalHeight(x,z+22)-naturalHeight(x,z-22))/44;
      candidates.push({u,v,rank:rng()+grade*3+Math.min(1,Math.abs(bank-120)/1200)*.32});
    }
  }
  candidates.sort((left, right) => left.rank - right.rank);
  const mainScale=(1.06+.42*urbanDensity)*(type.cityScale??1);
  const towns = [{name:'Valmont',u:0,v:0,radius:mainScale*(urbanDensity>1.33?500:370),
    floors:5+Math.floor(urbanDensity*1.8),tier:'hub',scale:mainScale}];
  const extraCities=candidates.filter(town=>Math.hypot(town.u,town.v)>towns[0].radius+390 &&
    Math.abs(riverEdge(...point(town.u,town.v)))>80).slice(0,cityCount-1);
  const hamlets = Math.round((11+topology()*10) * REGIONAL_PROFILE.below500 / REGIONAL_PROFILE.settlements * (type.hamlets??1));
  const names=random(seed ^ 0x5178bf81);
  const shuffledNames=list=>list.map(name=>({name,order:names()})).sort((a,b)=>a.order-b.order);
  const localNames=[...shuffledNames(villageNames),...shuffledNames(additionalVillageNames)];
  const selectedTowns=new Set(candidates.slice(0,Math.min(hamlets+2,localNames.length)-extraCities.length));
  for(const city of extraCities)selectedTowns.add(city);
  for(const candidate of candidates){
    if(selectedTowns.size>=Math.min(hamlets+2,localNames.length))break;
    selectedTowns.add(candidate);
  }
  candidates.filter(town=>selectedTowns.has(town)).forEach((candidate, index) => {
    const rising=extraCities.includes(candidate);
    const scale=rising?(.68+profile()*.25)*(type.cityScale??1):0;
    const village=index<2;
    towns.push({...candidate,name:localNames[index].name,radius:rising?scale*386:village?81*(type.villageScale??1):(30+rng()*14)*(type.villageScale??1),
      floors:rising?5+Math.floor(profile()*2):village?3:2,tier:rising?'hub':village?'village':'hamlet',scale});
  });
  urbanAreas.push(...towns.filter(town=>town.scale));

  for(const road of highways){
    const n=Math.ceil((road.end-road.start)/14), step=(road.end-road.start)/n;
    const at=along=>road.alongX?point(along,road.cross):point(road.cross,along);
    const sample=along=>naturalHeight(...at(along));
    const points=Array.from({length:n+1},(_,i)=>{
      const along=road.start+i*step;
      const native=sample(along);
      const blend=smooth(0,95,Math.min(along-road.start,road.end-along));
      const graded=(native*4+(sample(along-28)+sample(along+28))*2+
        sample(along-56)+sample(along+56))/10;
      return native+(graded-native)*blend;
    });
    const low=[...points],high=[...points];
    const clearance=points.map((_,i)=>{
      const [x,z]=at(road.start+i*step);
      return riverEdge(x,z)<road.width*.5+12?riverHeight(z)+5.2:-Infinity;
    });
    for(const direction of [1,-1]){
      for(let i=direction>0?1:n-1;i>=0&&i<=n;i+=direction){
        const previous=i-direction;
        const [x,z]=at(road.start+i*step),[X,Z]=at(road.start+previous*step);
        const rise=Math.hypot(X-x,Z-z)*.055;
        low[i]=Math.min(low[i],low[previous]+rise);
        high[i]=Math.max(high[i],high[previous]-rise);
        clearance[i]=Math.max(clearance[i],clearance[previous]-rise);
      }
    }
    for(let i=0;i<=n;i++) points[i]=Math.max((low[i]+high[i])*.5,clearance[i]);
    motorwayProfiles.push({road,points,step});
  }

  const {roundabouts,exits,links,overpasses}=buildJunctions(roads,towns,(u,v)=>roadHeight(...point(u,v)),random(seed^0x87ac329b));
  for(const road of highways){
    const ramps=exits.filter(exit=>exit.motorway===road).flatMap(exit=>exit.streets);
    const stations=ramps.map(street=>street.points[0][road.alongX?0:1]);
    const bridges=overpasses.filter(bridge=>bridge.motorway===road).map(bridge=>bridge.road.cross);
    const features=[...stations,...bridges];
    road.tapers=[Math.min(165,...features.map(station=>station-road.start)),
      Math.min(165,...features.map(station=>road.end-station))];
  }
  const mountainRoads=mountainNetwork(summits,roads,point,naturalHeight,riverEdge);
  engineeredAt=engineeredIndex(mountainRoads);
  function bridgeWeight(bridge,along){
    const distance=Math.abs(along-bridge.center);
    const length=along<bridge.center?bridge.center-bridge.start:bridge.end-bridge.center;
    return 1-smooth(bridge.halfSpan,length,distance);
  }
  for(const bridge of overpasses){
    const {road,center,halfSpan}=bridge;
    const at=along=>road.alongX?point(along,road.cross):point(road.cross,along);
    bridge.deck=Math.max(...[-halfSpan,-halfSpan/2,0,halfSpan/2,halfSpan]
      .map(offset=>roadHeight(...at(center+offset))))+6.75;
    for(const direction of [-1,1]){
      const boundary=direction<0?'start':'end';
      const neighbor=road.overpasses.filter(other=>direction*(other.center-center)>0)
        .reduce((limit,other)=>Math.min(limit,Math.abs(other.center-center)*.5),Infinity);
      const limit=Math.min(Math.abs(road[boundary]-center),neighbor,320);
      let length=Math.abs(bridge[boundary]-center);
      while(length<limit){
        let steepest=0;
        for(let distance=halfSpan;distance<length-2;distance+=3){
          const gradeAt=d=>{
            const base=roadHeight(...at(center+direction*d));
            return base+Math.max(0,bridge.deck-base)*(1-smooth(halfSpan,length,d));
          };
          steepest=Math.max(steepest,Math.abs(gradeAt(distance+2)-gradeAt(distance))*.5);
        }
        if(steepest<=.15) break;
        length=Math.min(limit,length+24);
      }
      bridge[boundary]=center+direction*length;
    }
  }
  function roadDeck(road,u,v,x,z,terrain){
    const base=roadHeight(x,z,terrain), along=road.alongX?u:v;
    const bridge=road.overpasses?.find(item=>along>item.start&&along<item.end);
    const crown=.02*Math.abs((road.alongX?v:u)-road.cross);
    return bridge?base+Math.max(0,bridge.deck-crown-base)*bridgeWeight(bridge,along):base;
  }
  function elevatedRoad(u,v,x,z){
    for(const bridge of overpasses){
      const {road,start,end}=bridge;
      const along=road.alongX?u:v, across=road.alongX?v:u;
      const edge=Math.abs(across-road.cross)-road.width*.5;
      if(edge>.18||along<=start||along>=end) continue;
      return {y:roadDeck(road,u,v,x,z),edge};
    }
    return null;
  }
  const ramps=[];
  for(const exit of exits) for(const street of exit.streets){
    const path=corridor(street.points.map(knot=>point(...knot)),street.width,'ramp');
    path.sideRoad=exit.road;
    path.motorway=exit.motorway;
    path.offRamp=street.offRamp;
    const end=roadDeck(exit.road,...street.points.at(-1),...path.points.at(-1));
    const start=roadHeight(...path.points[0]);
    const startSlope=(roadHeight(...path.points[3])-start)/path.length[3];
    const transition=.18;
    const midSlope=((end-start)/path.total-startSlope*transition*.5)/(1-transition);
    path.elevations=path.points.map(([x,z],i)=>{
      const t=path.length[i]/path.total;
      const rise=t<transition?startSlope*t+(midSlope-startSlope)*t*t/(2*transition):
        midSlope*t+(startSlope-midSlope)*transition*.5-
        midSlope*Math.max(0,t-1+transition)**2/(2*transition);
      const grade=start+rise*path.total;
      const base=roadHeight(x,z);
      return base+(grade-base)*smooth(6,24,path.length[i]);
    });
    street.ramp=path;
    ramps.push(path);
  }
  function rampDeck(path,x,z,elevation,terrain) {
    const [u,v]=grid(x,z);
    for(const road of [path.motorway,path.sideRoad]){
      const along=road.alongX?u:v, across=road.alongX?v:u;
      if(along<road.start||along>road.end) continue;
      const edge=Math.abs(across-road.cross)-motorwayWidth(road,along)*.5;
      if(edge>=8) continue;
      const deck=roadDeck(road,u,v,x,z,terrain??baseTerrainHeight(x,z));
      return deck+(elevation-deck)*smooth(0,8,edge);
    }
    return elevation;
  }
  rampAt=engineeredIndex(ramps);
  const crossings=[[-17,0,true],[17,0,true],[0,-17,false],[0,17,false],[-64,0,true],[64,0,true]]
    .filter(([u,v])=>!roundabouts.some(circle=>Math.hypot(u-circle.u,v-circle.v)<circle.cut));
  const cityLayout=random(seed^0x8f10b94c);
  const cities=urbanAreas.map((town,i)=>cityStreets(cityLayout,town,town.scale,
    i===0 && urbanDensity>1.33?4:3));
  const streets=[...cities.flatMap(city=>city.streets),...roundabouts.flatMap(circle=>circle.streets),
    ...exits.flatMap(exit=>exit.streets),...links];
  const loops=cities.flatMap(city=>city.loops).filter(loop=>!loop.some(([u,v],i)=>{
    if(!i) return false;
    const [x,z]=loop[i-1];
    return highwayAt(u,v,3)||highwayAt((u+x)*.5,(v+z)*.5,3);
  }));
  const cityBlocks=cities.flatMap(city=>city.blocks);
  const ruralLoops=[];
  const localCircuits=circuits.filter(([u,v,U,V])=>!highways.some(road=>
    road.alongX?road.cross===v||road.cross===V:road.cross===u||road.cross===U));
  const shortcuts=localCircuits.map(bounds=>({bounds,rank:topology()})).sort((a,b)=>a.rank-b.rank)
    .slice(0,2+Math.floor(topology()*3));
  for (const {bounds:[x,z,X,Z]} of shortcuts) {
    const flip=topology()<.5, startZ=flip?Z:z, endZ=flip?z:Z;
    const du=X-x, dv=endZ-startZ, length=Math.hypot(du,dv);
    const bend=(.07+rng()*.10)*length*(rng()<.5?-1:1);
    const count=Math.ceil(length/18);
    const shortcut=Array.from({length:count+1},(_,n)=>{
      const f=n/count, curve=Math.sin(Math.PI*f)*bend;
      return [x+du*f-dv/length*curve,startZ+dv*f+du/length*curve];
    });
    streets.push({points:shortcut,width:6.2,surface:9,urban:false});
    const loop=[...shortcut];
    let previous=shortcut.at(-1);
    for (const end of [[X,startZ],[x,startZ]]) {
      const count=Math.ceil(Math.hypot(end[0]-previous[0],end[1]-previous[1])/14);
      for(let n=1;n<=count;n++){
        const f=n/count;
        loop.push([previous[0]+(end[0]-previous[0])*f,previous[1]+(end[1]-previous[1])*f]);
      }
      previous=end;
    }
    ruralLoops.push(loop);
  }
  const streetCells = new Map(), cellSize = 36;
  for (const street of streets) {
    for (let index = 1; index < street.points.length; index++) {
      const [x0,z0] = street.points[index - 1], [x1,z1] = street.points[index];
      const dx=x1-x0, dz=z1-z0, lengthSquared=dx*dx+dz*dz;
      const segment={ x0,z0,dx,dz,lengthSquared,width:street.width,surface:street.surface,urban:street.urban,street };
      for (let ix=Math.floor((Math.min(x0,x1)-12)/cellSize);ix<=Math.floor((Math.max(x0,x1)+12)/cellSize);ix++) {
        for (let iz=Math.floor((Math.min(z0,z1)-12)/cellSize);iz<=Math.floor((Math.max(z0,z1)+12)/cellSize);iz++) {
          const key=ix*1024+iz;
          if (!streetCells.has(key)) streetCells.set(key,[]);
          streetCells.get(key).push(segment);
        }
      }
    }
  }
  function nearestStreet(x,z,ignore) {
    let best=null, edge=Infinity, pavedPriority=false;
    const cell=streetCells.get(Math.floor(x/cellSize)*1024+Math.floor(z/cellSize));
    if (!cell) return null;
    for (const segment of cell) {
      if(segment.street===ignore) continue;
      const {x0,z0,dx,dz,lengthSquared,width}=segment;
      const f=Math.min(1,Math.max(0,((x-x0)*dx+(z-z0)*dz)/lengthSquared));
      const distance=Math.hypot(x-x0-dx*f,z-z0-dz*f)-width/2;
      const priority=distance<=0&&Boolean(segment.street.exit||segment.street.connector||segment.street.roundabout);
      if(priority&&!pavedPriority || priority===pavedPriority&&distance<edge){
        edge=distance;best=segment;pavedPriority=priority;
      }
    }
    return best ? { edge, width:best.width, surface:best.surface, urban:best.urban } : null;
  }

  function outerLine(index,alongX) {
    if (!index) return 0;
    return index*OUTER_SPACING+(random(cellSeed(seed,index,alongX?3:5))()-.5)*245;
  }

  function outerDistance(u,v) {
    if (Math.max(Math.abs(u),Math.abs(v)) < LIMIT-7) return Infinity;
    let edge=Infinity;
    for (const alongX of [true,false]) {
      const along=alongX?u:v, across=alongX?v:u;
      const center=Math.round(across/OUTER_SPACING);
      for (let i=center-1;i<=center+1;i++) {
        const cross=outerLine(i,alongX);
        const end = Math.abs(cross)>=LIMIT ? 0 : Math.max(0,LIMIT-Math.abs(along));
        const side=Math.abs(across-cross);
        edge=Math.min(edge,(end ? Math.hypot(side,end) : side)-(i ? 3.6 : 4.5));
      }
      if (Math.abs(along) <= LIMIT+5) edge=Math.min(edge,Math.abs(Math.abs(across)-LIMIT)-3.6);
    }
    return edge;
  }

  function roadDistance(x, z, edge = false, includeCity = true) {
    let distance = Infinity;
    for (const road of roads) for(const [start,end] of road.spans){
      const {alongX,cross}=road;
      const along = alongX ? x : z;
      const across = Math.abs((alongX ? z : x) - cross);
      const outside = Math.max(start - along, along - end, 0);
      const center = outside ? Math.hypot(across, outside) : across;
      distance = Math.min(distance, edge ? center - motorwayWidth(road,along) / 2 : center);
    }
    const outer=outerDistance(x,z);
    distance=Math.min(distance,edge?outer:outer+3.6);
    const local = includeCity ? nearestStreet(x,z) : null;
    if(local) distance=Math.min(distance,edge?local.edge:local.edge+local.width/2);
    if(includeCity && mountainRoads.length){
      const special=engineeredAt(...point(x,z));
      if(special && !special.covered) distance=Math.min(distance,edge?special.edge:special.edge+special.path.width/2);
    }
    return distance;
  }

  function roadCutsFootprint(x,z,tx,tz,halfX,halfZ) {
    const acrossSteps=Math.max(1,Math.ceil(halfZ*2/2)), alongSteps=Math.max(1,Math.ceil(halfX*2/2));
    // Sample the whole footprint. A street can cross the middle while all
    // four corners stand clear. The setback also covers gaps between samples.
    for(let row=0;row<=acrossSteps;row++){
      const across=halfZ*(2*row/acrossSteps-1);
      for(let column=0;column<=alongSteps;column++){
        const along=halfX*(2*column/alongSteps-1);
        const px=x+tx*along-tz*across,pz=z+tz*along+tx*across;
        const [u,v]=grid(px,pz);
        if(roadDistance(u,v,true)<1.6||(rampAt(px,pz)?.edge??Infinity)<1.6)return true;
      }
    }
    return false;
  }

  const choices=localCircuits.length?localCircuits:circuits;
  const [x,z,X,Z]=choices[Math.floor(topology()*choices.length)];
  const corners=[[x,z],[X,z],[X,Z],[x,Z]];
  const circuit=corners.flatMap(([u,v],i)=>{
    const [U,V]=corners[(i+1)%4];
    return [.40,.72].map(t=>[u+(U-u)*t,v+(V-v)*t]);
  });
  retailPads=planRetail({roads,streets,towns,point,grid,height,roadHeight,land,riverEdge,roadDistance,roadCutsFootprint,nearestStreet,highwayAt,engineeredAt,rampAt},random(seed^0x4e7a1d));
  return {landShape:[a,b,-.83+(forestDensity-1)*.53],pads:retailPads,padLevel:(x,z)=>padLevel(retailPads,x,z,roadHeight),seed,trafficScale:type.traffic/1.6,peopleScale:type.people,terrain,urbanDensity,forestDensity,highways,highwayAt,motorwayWidth,point,grid,height,roadHeight,land,riverX,riverWidth,riverHeight,riverEdge,
    airTrafficScale:type.airTraffic,roundabouts,exits,overpasses,mountainRoads,engineeredAt,roadDeck,elevatedRoad,ramps,rampAt,rampDeck,
    roadDistance, roadCutsFootprint, nearestStreet, outerLine, roads, streets, crossings, loops, cityBlocks, ruralLoops, towns, circuits, circuit,
    distanceToRoad: (x, z) => roadDistance(x, z) };
}
