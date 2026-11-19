// The river as a body of water: a moving transparent surface over a real bed, light from above,
// fish and plants below it, and what a driver sees and hears once the car goes under.
import * as T from '../vendor/three.module.js';
import { mergeGeometries } from '../vendor/jsm/utils/BufferGeometryUtils.js';
import { batchInstances, terrainPaintSampler } from './scenery.js';
import { surface, underwater } from '../render/visuals.js';
import { random } from './world.js';

const REACH=3240, STEP=5;
const clock={value:0};
const smooth=(a,b,v)=>{const t=Math.max(0,Math.min(1,(v-a)/(b-a)));return t*t*(3-2*t);};

function surfaceMesh(world) {
  const across=12, positions=[], depth=[], indices=[];
  let rows=0;
  for(let z=-REACH;z<=REACH;z+=STEP,rows++){
    const x=world.riverX(z), width=world.riverWidth(z), level=world.riverHeight(z);
    for(let i=0;i<=across;i++){
      const px=x+width*(i/across*2-1);
      positions.push(px,level,z);
      depth.push(Math.max(0,level-world.height(px,z)));
    }
    if(rows)for(let i=0;i<across;i++){
      const a=(rows-1)*(across+1)+i,b=a+1,c=a+across+1,d=c+1;
      indices.push(a,c,b,b,c,d);
    }
  }
  const geometry=new T.BufferGeometry();
  geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));
  geometry.setAttribute('waterDepth',new T.Float32BufferAttribute(depth,1));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const material=new T.MeshStandardMaterial({color:0x2f6068,roughness:.1,metalness:.25,transparent:true,depthWrite:false,side:T.DoubleSide});
  material.customProgramCacheKey=()=>'river-surface';
  material.onBeforeCompile=shader=>{
    shader.uniforms.flowTime=clock;
    shader.vertexShader=`uniform float flowTime; attribute float waterDepth; varying float vDepth; varying vec3 vWater;\n`+shader.vertexShader
      .replace('#include <begin_vertex>',`#include <begin_vertex>
        vDepth=waterDepth; vWater=position;
        float swell=smoothstep(.1,1.6,waterDepth);
        transformed.y+=swell*(sin(position.x*.9+position.z*.6+flowTime*1.3)*.03+sin(position.x*.37-position.z*.8+flowTime*.9)*.045);`);
    shader.fragmentShader=`uniform float flowTime; varying float vDepth; varying vec3 vWater;
      float rippleNoise(vec2 p){vec2 c=floor(p),f=fract(p);f=f*f*(3.-2.*f);
        vec2 h=vec2(127.1,311.7);float a=fract(sin(dot(c,h))*43758.5),b=fract(sin(dot(c+vec2(1,0),h))*43758.5),
        d=fract(sin(dot(c+vec2(0,1),h))*43758.5),e=fract(sin(dot(c+1.,h))*43758.5);return mix(mix(a,b,f.x),mix(d,e,f.x),f.y);}
      float ripples(vec2 p){return rippleNoise(p*.9+vec2(0,flowTime*.75))*.55+rippleNoise(p*2.3+vec2(flowTime*.2,flowTime*1.15))*.3+rippleNoise(p*5.7-vec2(0,-flowTime*1.6))*.15;}
      `+shader.fragmentShader
      .replace('#include <color_fragment>',`#include <color_fragment>
        float deep=smoothstep(0.,4.5,vDepth);
        float foam=(1.-smoothstep(.05,.42,vDepth))*smoothstep(.42,.72,rippleNoise(vWater.xz*1.7+vec2(0,flowTime*.5)));
        diffuseColor.rgb=mix(vec3(.17,.27,.2),vec3(.035,.13,.14),deep);
        diffuseColor.a=mix(.3,.86,deep);
        diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.86,.9,.86),foam*.8);
        diffuseColor.a=max(diffuseColor.a,foam*.85);
        if(!gl_FrontFacing){diffuseColor.rgb=vec3(.22,.46,.44)+vec3(.3,.34,.28)*smoothstep(.45,.7,ripples(vWater.xz));diffuseColor.a=.96;}`)
      .replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
        float e=.08, r0=ripples(vWater.xz), rx=ripples(vWater.xz+vec2(e,0.)), rz=ripples(vWater.xz+vec2(0.,e));
        normal=normalize(normal+(viewMatrix*vec4((r0-rx)/e*.42,0.,(r0-rz)/e*.42,0.)).xyz);`);
  };
  const mesh=new T.Mesh(geometry,material);
  mesh.frustumCulled=false;mesh.receiveShadow=true;mesh.renderOrder=4;
  return mesh;
}

// The bed and the banks, from the same height function the wheels use.
function bedMesh(world) {
  const offsets=[];
  for(let i=-16;i<=16;i++)offsets.push(i/16);
  const bank=[6,12,20,30];
  const positions=[],colors=[],farm=[],rock=[],wood=[],indices=[];
  const paint=new T.Color(), sand=new T.Color(0x9a8a62), silt=new T.Color(0x4f4a36), pebble=new T.Color(0x77705f), mud=new T.Color(0x5a4a34), grass=new T.Color();
  const noise=(x,z)=>Math.sin(x*.71+z*.33)*.5+Math.sin(x*.23-z*.61)*.5;
  const groundPaint=terrainPaintSampler(world);
  let rows=0;
  for(let z=-REACH;z<=REACH;z+=4,rows++){
    const cx=world.riverX(z), width=world.riverWidth(z), level=world.riverHeight(z);
    const stations=[...bank.slice().reverse().map(d=>-(width+d)),...offsets.map(f=>f*width),...bank.map(d=>width+d)];
    for(const s of stations){
      const x=cx+s, under=world.height(x,z), depth=level-under;
      const texture=(noise(x,z)*.05+noise(x*3.1,z*2.7)*.025)*smooth(.2,1.5,depth);
      const rim=Math.abs(s)>=width+29;
      positions.push(x,under+.025+texture-(rim?.7:0),z);
      if(depth<0&&Math.abs(x)<2590&&Math.abs(z)<2590)grass.fromArray(groundPaint(x,z).color);
      else grass.setHSL(.217+Math.sin(x/135+z/170)*.022,.32,.36);
      if(depth>0){
        const n=noise(x*.4,z*.4)*.5+.5;
        paint.copy(sand).lerp(pebble,smooth(.45,.8,n)).lerp(silt,smooth(1.5,6,depth));
      }else paint.copy(mud).lerp(grass,smooth(.15,1.8,-depth));
      paint.toArray(colors,colors.length);
      farm.push(0);rock.push(0);wood.push(0);
    }
    const count=stations.length;
    if(rows)for(let i=0;i<count-1;i++){
      const a=(rows-1)*count+i,b=a+1,c=a+count,d=c+1;
      indices.push(a,c,b,b,c,d);
    }
  }
  const geometry=new T.BufferGeometry();
  geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));
  geometry.setAttribute('color',new T.Float32BufferAttribute(colors,3));
  geometry.setAttribute('farmland',new T.Float32BufferAttribute(farm,1));
  geometry.setAttribute('rockFace',new T.Float32BufferAttribute(rock,1));
  geometry.setAttribute('woodlandCover',new T.Float32BufferAttribute(wood,1));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const material=surface(0xffffff,{vertexColors:true,pattern:'meadow'});
  const base=material.onBeforeCompile;
  material.customProgramCacheKey=()=>'river-bed';
  material.onBeforeCompile=(shader,renderer)=>{
    base(shader,renderer);
    shader.uniforms.flowTime=clock;
    shader.fragmentShader='uniform float flowTime;\n'+shader.fragmentShader.replace('#include <emissivemap_fragment>',`#include <emissivemap_fragment>
      float waterDepth=-12.+positionOnSurface.z*.0032-positionOnSurface.y;
      if(waterDepth>0.){
        vec2 q=positionOnSurface.xz*1.15;
        float c1=abs(sin(q.x+sin(q.y*1.3+flowTime*.9)*1.4+flowTime*.5));
        float c2=abs(sin(q.y*1.2+sin(q.x*1.1-flowTime*.7)*1.5-flowTime*.4));
        float caustic=pow(1.-min(c1,c2),5.)*exp(-waterDepth*.28);
        diffuseColor.rgb*=exp(-vec3(.42,.13,.16)*waterDepth);
        totalEmissiveRadiance+=vec3(.34,.42,.33)*caustic*.42;
      }`);
  };
  const mesh=new T.Mesh(geometry,material);
  mesh.frustumCulled=false;mesh.receiveShadow=true;
  mesh.userData.renderCategory='water';
  return mesh;
}

// Water plants lean with the current and sway from their roots.
function swaying(material) {
  material.customProgramCacheKey=()=>'river-plant';
  material.onBeforeCompile=shader=>{
    shader.uniforms.flowTime=clock;
    shader.vertexShader='uniform float flowTime;\n'+shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
      #ifdef USE_INSTANCING
        float rise=max(0.,position.y+.5), seed=instanceMatrix[3].x*1.7+instanceMatrix[3].z*2.3;
        transformed.x+=sin(flowTime*1.3+seed+rise*2.6)*.14*rise*rise;
        transformed.z-=(.16+.1*sin(flowTime*.8+seed))*rise*rise;
      #endif`);
  };
  return material;
}

function plantLife(world,group) {
  const rng=random(world.seed^0x7d1a3);
  const blades=[];
  for(let i=0;i<9;i++){
    const a=i*2.4,r=.04+i*.03,x=Math.cos(a)*r,z=Math.sin(a)*r,side=.035;
    const tall=.62+(i%4)*.13-.5;
    for(let s=0;s<4;s++){
      const y0=-.5+s/4*(tall+.5),y1=-.5+(s+1)/4*(tall+.5),w0=side*(1-s/4),w1=side*(1-(s+1)/4);
      blades.push(x-w0,y0,z,x+w0,y0,z,x+w1,y1,z, x-w0,y0,z,x+w1,y1,z,x-w1,y1,z);
    }
  }
  const grass=new T.BufferGeometry();
  grass.setAttribute('position',new T.Float32BufferAttribute(blades,3));
  grass.computeVertexNormals();
  const pad=new T.CircleGeometry(.5,14,.35,Math.PI*2-.7).rotateX(-Math.PI/2);
  const bloom=new T.ConeGeometry(.5,.7,7);
  const stone=new T.DodecahedronGeometry(1,0), log=new T.CylinderGeometry(1,.8,1,8).rotateZ(Math.PI/2), tyre=new T.TorusGeometry(.5,.17,8,16).rotateX(Math.PI/2);
  const lists={weed:[],tall:[],lily:[],flower:[],rock:[],wood:[],junk:[]};
  for(let z=-REACH+10;z<REACH-10;z+=3.5){
    const cx=world.riverX(z), width=world.riverWidth(z), level=world.riverHeight(z);
    if(width<3)continue;
    for(let n=0;n<5;n++){
      const across=(rng()*2-1)*width*.97, x=cx+across, pz=z+rng()*3.5, floor=world.height(x,pz), depth=level-floor;
      if(depth<.2)continue;
      const roll=rng();
      if(roll<.5&&depth<6.5){
        const tall=Math.min(depth*.85,.5+rng()*1.8);
        lists.weed.push([x,floor+tall*.5,pz,.9+rng()*.9,tall,.9+rng()*.9,rng()*6.28,[0x3f6e3a,0x55803c,0x2f5e40,0x6b8a3a][Math.floor(rng()*4)]]);
      }else if(roll<.62&&depth>1.5){
        const tall=Math.min(depth*.9,1.8+rng()*2.6);
        lists.tall.push([x,floor+tall*.5,pz,.55,tall,.55,rng()*6.28,0x4a7a44]);
      }else if(roll<.76&&depth<2.4&&Math.abs(across)>width*.55){
        for(let k=0,count=2+Math.floor(rng()*5);k<count;k++){
          const lx=x+(rng()-.5)*2.6,lz=pz+(rng()-.5)*2.6,size=.42+rng()*.5;
          lists.lily.push([lx,level+.05,lz,size,1,size,rng()*6.28,[0x3f7a3a,0x4f8a42,0x356e38][Math.floor(rng()*3)]]);
          if(rng()<.2)lists.flower.push([lx,level+.14,lz,.2,.2,.2,rng()*6.28,rng()<.6?0xf4f0ea:0xe8a0b8]);
        }
      }else if(roll<.9){
        const size=.14+rng()*rng()*.75;
        lists.rock.push([x,floor+size*.25,pz,size*1.3,size,size,rng()*6.28,[0x6a665a,0x7f7a6a,0x57544a][Math.floor(rng()*3)]]);
      }else if(roll<.925&&depth>1){
        const length=2.4+rng()*4,r=.14+rng()*.18;
        lists.wood.push([x,floor+r*.8,pz,length,r,r,rng()*6.28,0x4a3a2a]);
      }else if(roll<.932&&depth>1.2){
        lists.junk.push([x,floor+.14,pz,1.1,1.1,1.1,rng()*6.28,0x1c1c1e]);
      }
    }
  }
  const leaf=swaying(new T.MeshStandardMaterial({color:0xffffff,roughness:.7,side:T.DoubleSide}));
  const lilyMaterial=new T.MeshStandardMaterial({color:0xffffff,roughness:.4,side:T.DoubleSide});
  const pale=new T.MeshStandardMaterial({color:0xffffff,roughness:.6});
  const stoneMaterial=surface(0xffffff,{pattern:'gravel'}), bark=surface(0xffffff,{pattern:'bark'});
  const meshes=[
    ...batchInstances(group,grass,leaf,lists.weed,70,false,'water'),
    ...batchInstances(group,grass,leaf,lists.tall,70,false,'water'),
    ...batchInstances(group,pad,lilyMaterial,lists.lily,70,false,'water'),
    ...batchInstances(group,bloom,pale,lists.flower,70,false,'water'),
    ...batchInstances(group,stone,stoneMaterial,lists.rock,70,false,'water'),
    ...batchInstances(group,log,bark,lists.wood,70,false,'water'),
    ...batchInstances(group,tyre,pale,lists.junk,70,false,'water'),
  ];
  return {meshes,dispose(){
    for(const geometry of [grass,pad,bloom,stone,log,tyre])geometry.dispose();
    for(const material of [leaf,lilyMaterial,pale,stoneMaterial,bark])material.dispose();
  }};
}

function fishGeometry() {
  const tint=(geometry,color)=>{
    const flat=geometry.index?geometry.toNonIndexed():geometry, count=flat.attributes.position.count;
    flat.deleteAttribute('uv');
    const values=[];
    for(let i=0;i<count;i++){
      const y=flat.attributes.position.getY(i), shade=color??(y>.03?[.42,.48,.42]:y<-.04?[1,1,.94]:[.82,.84,.74]);
      values.push(...shade);
    }
    flat.setAttribute('color',new T.Float32BufferAttribute(values,3));
    return flat;
  };
  const body=new T.SphereGeometry(1,10,7).scale(.075,.13,.5);
  const shape=new T.BufferGeometry();
  shape.setAttribute('position',new T.Float32BufferAttribute([0,0,-.44,0,.16,-.72,0,-.16,-.72, 0,.1,.1,0,.23,-.1,0,.1,-.28, .05,-.05,.16,.2,-.12,.02,.05,-.08,.0, -.05,-.05,.16,-.2,-.12,.02,-.05,-.08,.0],3));
  shape.computeVertexNormals();
  const eyes=[-1,1].map(side=>new T.SphereGeometry(.022,6,5).translate(side*.066,.035,.33));
  return mergeGeometries([tint(body),tint(shape,[.46,.42,.32]),...eyes.map(eye=>tint(eye,[.02,.02,.02]))]);
}

const SPECIES=[
  {name:'trout',color:0xa8b090,size:.42,count:7,depth:.45},{name:'perch',color:0x8a9a58,size:.3,count:10,depth:.6},
  {name:'roach',color:0xc4c8c0,size:.2,count:18,depth:.3},{name:'pike',color:0x6a7a4a,size:.85,count:2,depth:.8},
  {name:'carp',color:0xb08a48,size:.62,count:5,depth:.88},
];

function fishLife(world,group) {
  const rng=random(world.seed^0x2c9e1);
  const schools=[];
  for(let i=0;i<16;i++){
    const species=SPECIES[i%SPECIES.length];
    schools.push({species,z:0,across:rng()*1.5-.75,heading:rng()<.5?1:-1,phase:rng()*50,flee:0,placed:false,
      fish:Array.from({length:species.count},()=>({x:(rng()-.5)*3.4,y:(rng()-.5)*.9,z:(rng()-.5)*4.2,phase:rng()*6.28,size:.8+rng()*.4}))});
  }
  const total=schools.reduce((sum,school)=>sum+school.fish.length,0);
  const geometry=fishGeometry();
  const material=new T.MeshStandardMaterial({vertexColors:true,roughness:.32,metalness:.35});
  material.customProgramCacheKey=()=>'river-fish';
  material.onBeforeCompile=shader=>{
    shader.uniforms.flowTime=clock;
    shader.vertexShader='uniform float flowTime;\n'+shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
      #ifdef USE_INSTANCING
        float back=max(0.,.3-position.z), beat=instanceMatrix[3].x*3.1+instanceMatrix[3].z*2.2;
        transformed.x+=sin(flowTime*11.+beat+position.z*5.)*back*back*.22;
      #endif`);
  };
  const mesh=new T.InstancedMesh(geometry,material,total);
  mesh.frustumCulled=false;mesh.count=0;
  group.add(mesh);
  const pose=new T.Object3D(), tint=new T.Color();
  function step(dt,player,carInWater) {
    let n=0;
    const near=Math.abs(world.riverEdge(player.x,player.z))<170;
    if(!near){mesh.count=0;return;}
    for(const school of schools){
      if(!school.placed||Math.abs(school.z-player.z)>110){
        school.z=player.z+(school.placed?-Math.sign(school.z-player.z)*(70+rng()*35):(rng()-.5)*170);
        school.placed=true;
      }
      const width=world.riverWidth(school.z);
      if(width<3)continue;
      let cx=world.riverX(school.z)+school.across*width;
      if(carInWater){
        const dx=cx-player.x,dz=school.z-player.z,range=Math.hypot(dx,dz);
        if(range<11){school.flee=2.2;school.heading=dz>=0?1:-1;school.across=Math.max(-.82,Math.min(.82,school.across+Math.sign(dx||1)*dt*.4));}
      }
      school.flee=Math.max(0,school.flee-dt);
      school.phase+=dt;
      school.z+=school.heading*(school.flee?6:.55+Math.sin(school.phase*.4)*.3)*dt;
      school.across=Math.max(-.82,Math.min(.82,school.across+Math.sin(school.phase*.23)*dt*.05));
      if(Math.sin(school.phase*.11)>.985)school.heading*=-1;
      cx=world.riverX(school.z)+school.across*width;
      const level=world.riverHeight(school.z), floor=world.height(cx,school.z), depth=level-floor;
      if(depth<.7){school.across*=.98;continue;}
      const cy=floor+Math.max(.25,depth*(1-school.species.depth));
      tint.set(school.species.color);
      for(const fish of school.fish){
        fish.phase+=dt*1.4;
        const x=cx+fish.x+Math.sin(fish.phase)*.28, z=school.z+fish.z*school.heading+Math.cos(fish.phase*.7)*.3;
        const y=Math.min(level-.12,Math.max(floor+.12,cy+fish.y*Math.min(1,depth*.3)+Math.sin(fish.phase*1.3)*.1));
        pose.position.set(x,y,z);
        pose.rotation.set(0,(school.heading>0?0:Math.PI)+Math.sin(fish.phase)*.22,0);
        pose.scale.setScalar(school.species.size*fish.size*2.1);
        pose.updateMatrix();
        mesh.setMatrixAt(n,pose.matrix);mesh.setColorAt(n,tint);n++;
      }
    }
    mesh.count=n;mesh.instanceMatrix.needsUpdate=true;
    if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;
  }
  return {step,dispose(){geometry.dispose();material.dispose();mesh.dispose();}};
}

// Spray, bubbles and drifting specks, all as round points.
function particleCloud(count,color,additive=false) {
  const positions=new Float32Array(count*3), sizes=new Float32Array(count).fill(0);
  const geometry=new T.BufferGeometry();
  geometry.setAttribute('position',new T.BufferAttribute(positions,3).setUsage(T.DynamicDrawUsage));
  geometry.setAttribute('size',new T.BufferAttribute(sizes,1).setUsage(T.DynamicDrawUsage));
  const material=new T.ShaderMaterial({transparent:true,depthWrite:false,blending:additive?T.AdditiveBlending:T.NormalBlending,
    uniforms:{tint:{value:new T.Color(color)}},
    vertexShader:`attribute float size;void main(){vec4 m=modelViewMatrix*vec4(position,1.);gl_PointSize=size*520./max(.3,-m.z);gl_Position=projectionMatrix*m;}`,
    fragmentShader:`uniform vec3 tint;void main(){float d=length(gl_PointCoord-.5);if(d>.5)discard;gl_FragColor=vec4(tint,smoothstep(.5,.2,d)*.8);}`});
  const points=new T.Points(geometry,material);
  points.frustumCulled=false;
  return {points,positions,sizes,geometry,material};
}

export function createRiverWater(world) {
  const group=new T.Group();
  const water=surfaceMesh(world), bed=bedMesh(world);
  group.add(bed,water);
  const plants=plantLife(world,group), fish=fishLife(world,group);
  // Spray thrown up when a car hits the water.
  const spray=particleCloud(260,0xe8f0ee), sprayState=Array.from({length:260},()=>({life:0,vx:0,vy:0,vz:0}));
  const specks=particleCloud(170,0xcfe0c8), bubbles=particleCloud(90,0xd8f2f2);
  group.add(spray.points,specks.points,bubbles.points);
  specks.points.visible=bubbles.points.visible=false;
  const speckSeeds=Array.from({length:170},(_,i)=>[(i*.754877)%1,(i*.569840)%1,(i*.438289)%1]);
  const bubbleState=Array.from({length:90},()=>({life:0,x:0,y:0,z:0}));
  let nextSpray=0, wasIn=false;
  function burst(x,y,z,power,count) {
    for(let i=0;i<count;i++){
      const p=sprayState[nextSpray], angle=Math.random()*6.283, out=power*(.25+Math.random()*.6);
      p.life=.9+Math.random()*.9;p.vx=Math.cos(angle)*out;p.vz=Math.sin(angle)*out;p.vy=power*(.4+Math.random()*.8);
      spray.positions.set([x+Math.cos(angle)*1.1,y+.1,z+Math.sin(angle)*1.6],nextSpray*3);
      spray.sizes[nextSpray]=.05+Math.random()*.11;
      nextSpray=(nextSpray+1)%sprayState.length;
    }
  }
  // Screen layers for being under the surface.
  const tint=document.createElement('div'), cabin=document.createElement('div');
  tint.id='underwater';cabin.id='cabin-water';
  Object.assign(tint.style,{position:'fixed',inset:'0',pointerEvents:'none',zIndex:'1',opacity:'0',
    background:'radial-gradient(ellipse at 50% 20%,rgba(70,140,130,.1) 0%,rgba(6,44,48,.62) 100%)'});
  Object.assign(cabin.style,{position:'fixed',left:'0',right:'0',bottom:'0',height:'0',pointerEvents:'none',zIndex:'1',
    background:'linear-gradient(180deg,rgba(150,205,200,.62) 0,rgba(40,96,96,.55) 8px,rgba(14,58,60,.74) 100%)'});
  document.getElementById('view').after(tint,cabin);
  let submergedView=false;
  return {group,
    // Follows the player's car: splashes, wake and bubbles.
    track(dt,vehicle) {
      const [x,y,z]=vehicle.p, wet=(vehicle.submerged||0)>.02, speed=Math.hypot(vehicle.v[0],vehicle.v[2]);
      const level=world.riverHeight(z);
      if(wet&&!wasIn&&speed>2)burst(x,level,z,Math.min(11,2+speed*.42),Math.min(240,Math.round(50+speed*9)));
      if(wet&&speed>1.5&&y>level-1.6&&Math.random()<dt*speed*5)burst(x+vehicle.forward[0]*2,level,z+vehicle.forward[2]*2,1.4+speed*.14,3);
      wasIn=wet;
      for(let i=0;i<sprayState.length;i++){
        const p=sprayState[i];
        if(p.life<=0){spray.sizes[i]=0;continue;}
        p.life-=dt;p.vy-=9.8*dt;
        spray.positions[i*3]+=p.vx*dt;spray.positions[i*3+1]+=p.vy*dt;spray.positions[i*3+2]+=p.vz*dt;
        if(spray.positions[i*3+1]<world.riverHeight(spray.positions[i*3+2]))p.life=0;
      }
      spray.geometry.attributes.position.needsUpdate=true;spray.geometry.attributes.size.needsUpdate=true;
      // Air escaping from a sinking car.
      const leaking=(vehicle.flood||0)>.02&&(vehicle.flood||0)<.98&&wet;
      bubbles.points.visible=leaking||bubbleState.some(b=>b.life>0);
      for(let i=0;i<bubbleState.length;i++){
        const b=bubbleState[i];
        if(b.life<=0&&leaking&&Math.random()<dt*14){b.life=4;b.x=x+(Math.random()-.5)*1.6;b.y=y+.4;b.z=z+(Math.random()-.5)*3;bubbles.sizes[i]=.025+Math.random()*.06;}
        if(b.life>0){
          b.life-=dt;b.y+=dt*(1+bubbles.sizes[i]*14);b.x+=Math.sin(b.life*9+i)*dt*.2;
          if(b.y>world.riverHeight(b.z))b.life=0;
        }
        if(b.life<=0)bubbles.sizes[i]=0;
        bubbles.positions.set([b.x,b.y,b.z],i*3);
      }
      bubbles.geometry.attributes.position.needsUpdate=true;bubbles.geometry.attributes.size.needsUpdate=true;
    },
    update(dt,focus,carInWater=false) {
      clock.value+=dt;
      fish.step(dt,focus,carInWater);
      for(const mesh of plants.meshes){
        const {center,radius}=mesh.boundingSphere;
        mesh.visible=Math.hypot(focus.x-center.x,focus.z-center.z)<190+radius;
      }
    },
    // Runs after the camera has been placed.
    view(camera,vehicle,cockpit,audio) {
      const {x,y,z}=camera.position, inside=world.riverEdge(x,z)<0&&world.riverWidth(z)>.3;
      const depth=inside?world.riverHeight(z)-y:-1, under=depth>.02;
      underwater.value=under?Math.min(1,.45+depth*.09):0;
      tint.style.opacity=under?String(Math.min(.92,.5+depth*.07)):'0';
      if(under!==submergedView){submergedView=under;audio?.submerge?.(under);}
      specks.points.visible=under;
      if(under){
        speckSeeds.forEach(([a,b,c],i)=>{
          const t=clock.value*.05;
          specks.positions.set([x+((a+t*.3)%1-.5)*16,y+((b+t*.12)%1-.5)*9,z+((c-t)%1+1)%1*16-8],i*3);
          specks.sizes[i]=.012+a*.022;
        });
        specks.geometry.attributes.position.needsUpdate=true;specks.geometry.attributes.size.needsUpdate=true;
      }
      // Water climbing up inside the cabin.
      const flood=vehicle.flood||0;
      cabin.style.height=cockpit&&flood>.01&&!under?`${Math.min(100,flood*118).toFixed(1)}%`:'0';
    },
    reset(){underwater.value=0;tint.style.opacity='0';cabin.style.height='0';wasIn=false;},
    dispose(){
      for(const item of [water,bed]){item.geometry.dispose();item.material.dispose();}
      plants.dispose();fish.dispose();
      for(const cloud of [spray,specks,bubbles]){cloud.geometry.dispose();cloud.material.dispose();}
      tint.remove();cabin.remove();underwater.value=0;
    }};
}
