// Procedural lorries: articulated curtain-siders, tankers and rigid box trucks.
// Geometry is merged per material, so a truck costs about a dozen draw calls.
import * as T from '../vendor/three.module.js';
import { mergeGeometries } from '../vendor/jsm/utils/BufferGeometryUtils.js';

const CABS=[0xc8d2d8,0x1f4f8f,0xa8231f,0xe8e6df,0x20654a,0xdd8a1c];
const LOADS=[0xe9e7df,0x2e5f96,0x8f2a26,0x5b6a58,0xd4b13f,0x3b3f46];

function mesh(parts,material) {
  const result=new T.Mesh(mergeGeometries(parts),material);
  result.castShadow=result.receiveShadow=true;
  return result;
}
const block=(w,h,d,x,y,z)=>new T.BoxGeometry(w,h,d).translate(x,y,z);
const barrel=(r,l,x,y,z,sides=14)=>new T.CylinderGeometry(r,r,l,sides).rotateZ(Math.PI/2).translate(x,y,z);
const tank=(r,l,x,y,z)=>new T.CylinderGeometry(r,r,l,18).rotateX(Math.PI/2).translate(x,y,z);

export function createTruckFactory() {
  const materials={
    chassis:new T.MeshStandardMaterial({color:0x202224,roughness:.7,metalness:.3}),
    rubber:new T.MeshStandardMaterial({color:0x151617,roughness:.92}),
    rim:new T.MeshStandardMaterial({color:0xb5b9ba,roughness:.4,metalness:.6}),
    glass:new T.MeshStandardMaterial({color:0x22343c,roughness:.16,metalness:.5}),
    steel:new T.MeshStandardMaterial({color:0xbfc4c6,roughness:.34,metalness:.72}),
    lamp:new T.MeshStandardMaterial({color:0xfff4d8,emissive:0xffe6b0,emissiveIntensity:.5}),
    amber:new T.MeshStandardMaterial({color:0xe88a1a,emissive:0xb85a08,emissiveIntensity:.5}),
  };
  const paints=new Map();
  const paint=color=>{
    if(!paints.has(color))paints.set(color,new T.MeshStandardMaterial({color,roughness:.46,metalness:.12}));
    return paints.get(color);
  };
  // One axle: two sets of wheels around its own origin, so it can spin as a single mesh.
  function axle(x,z,radius,track,twin) {
    const tyres=[],rims=[];
    for(const side of [-1,1]){
      const offset=side*track*.5;
      tyres.push(barrel(radius,twin?.62:.34,offset,0,0,20));
      rims.push(barrel(radius*.56,(twin?.62:.34)+.03,offset,0,0,10));
      for(let spoke=0;spoke<4;spoke++)
        rims.push(block((twin?.64:.36),radius*.9,.07,offset,0,0).rotateX(spoke*Math.PI/4));
    }
    const group=new T.Group();
    group.position.set(x,radius,z);
    group.add(mesh(tyres,materials.rubber),mesh(rims,materials.rim));
    return group;
  }
  function cabin(root,color,length=2.35) {
    const body=[], front=1.05;
    body.push(block(2.48,1.62,length,0,2.05,front-length/2));
    body.push(block(2.36,.92,length-.42,0,3.3,front-length/2-.2));
    body.push(block(2.5,.32,length+.04,0,1.14,front-length/2));
    body.push(block(2.1,.34,1.5,0,3.92,front-length*.62));
    root.add(mesh(body,paint(color)));
    root.add(mesh([
      block(2.14,.86,.05,0,3.2,front+.015).rotateX(0),
      block(.05,.62,.92,1.245,3.22,front-.62),block(.05,.62,.92,-1.245,3.22,front-.62),
    ],materials.glass));
    root.add(mesh([block(1.7,.62,.05,0,1.86,front+.02),block(2.44,.2,.12,0,.98,front+.02)],materials.chassis));
    root.add(mesh([block(.38,.2,.05,.93,1.32,front+.03),block(.38,.2,.05,-.93,1.32,front+.03)],materials.lamp));
    root.add(mesh([block(.1,.34,.16,1.42,3.28,front-.18),block(.1,.34,.16,-1.42,3.28,front-.18)],materials.chassis));
    root.add(mesh([block(.26,.1,.06,1.1,4.1,front-.5),block(.26,.1,.06,-1.1,4.1,front-.5)],materials.amber));
  }
  function tail(root,z,width=2.5) {
    const brake=new T.MeshStandardMaterial({color:0x7d1410,emissive:0xff2a14,emissiveIntensity:.12});
    root.add(mesh([block(.42,.16,.05,width*.38,1.08,z),block(.42,.16,.05,-width*.38,1.08,z)],brake));
    root.add(mesh([block(width,.1,.05,0,.82,z)],materials.amber));
    return brake;
  }

  function build(kind,rng) {
    const color=CABS[Math.floor(rng()*CABS.length)], load=LOADS[Math.floor(rng()*LOADS.length)];
    const model=new T.Group(), cab=new T.Group(), axles=[];
    model.add(cab);
    cabin(cab,color);
    const wheel=(parent,z,twin)=>{const part=axle(0,z,.52,1.98,twin);parent.add(part);axles.push(part);};
    if(kind==='rigid'){
      const length=9.6;
      cab.add(mesh([block(.86,.3,length-1.2,.0,.86,-3.7),block(2.3,.12,6.9,0,1.06,-5)],materials.chassis));
      cab.add(mesh([block(2.5,2.7,6.9,0,2.5,-5.1)],paint(load)));
      cab.add(mesh([block(2.54,.12,6.96,0,1.22,-5.1),block(2.54,.12,6.96,0,3.8,-5.1)],paint(color)));
      wheel(cab,0,false);wheel(cab,-6.1,true);
      const brake=tail(cab,-8.57);
      return {model,cab,trailer:null,axles,brake,bodyLength:length,
        spec:{mass:14500,dims:{len:length,wid:2.55,hgt:3.9},wheel:{radius:.52},cg:1.1}};
    }
    cab.add(mesh([block(.86,.3,5.2,0,.86,-1.5),block(.9,.2,.9,0,1.14,-3.1),
      block(.5,.5,1.05,1.05,.86,-1.3),block(.5,.5,1.05,-1.05,.86,-1.3)],materials.chassis));
    cab.add(mesh([tank(.3,.08,1.05,.86,-.76).rotateY(0),block(.08,1.7,.16,1.1,3.3,-1.45)],materials.steel));
    wheel(cab,-.05,false);wheel(cab,-3.15,true);
    const trailer=new T.Group();
    model.add(trailer);
    let brake;
    const length=13.6, nose=1.45, back=nose-length;
    trailer.add(mesh([block(1.1,.3,length-.3,0,1.08,nose-length/2),block(2.5,.14,length,0,1.28,nose-length/2)],materials.chassis));
    if(kind==='tanker'){
      trailer.add(mesh([tank(1.14,length-1.1,0,2.55,nose-length/2)],materials.steel));
      trailer.add(mesh([new T.SphereGeometry(1.14,18,10).scale(1,1,.42).translate(0,2.55,nose-.55),
        new T.SphereGeometry(1.14,18,10).scale(1,1,.42).translate(0,2.55,back+.55)],materials.steel));
      trailer.add(mesh([block(.5,.14,length-2.4,0,3.74,nose-length/2)],paint(load)));
    }else{
      trailer.add(mesh([block(2.5,2.62,length,0,2.68,nose-length/2)],paint(load)));
      trailer.add(mesh([block(2.54,.14,length+.04,0,4.02,nose-length/2),
        block(2.54,.12,length+.04,0,1.42,nose-length/2)],paint(color)));
      const ribs=[];
      for(let z=nose-1.2;z>back;z-=1.36)ribs.push(block(2.53,2.5,.04,0,2.72,z));
      trailer.add(mesh(ribs,paint(0x75797c)));
    }
    trailer.add(mesh([block(.1,.5,.1,.5,.6,-1.2),block(.1,.5,.1,-.5,.6,-1.2)],materials.steel));
    for(const z of [-7.2,-8.5,-9.8])wheel(trailer,z,false);
    brake=tail(trailer,back-.03);
    return {model,cab,trailer,axles,brake,bodyLength:16.5,
      spec:{mass:kind==='tanker'?32000:26000,dims:{len:16.5,wid:2.55,hgt:4.1},wheel:{radius:.52},cg:1.3}};
  }
  return {build,dispose(){
    for(const material of [...Object.values(materials),...paints.values()])material.dispose();
  }};
}
