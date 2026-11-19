import * as T from '../vendor/three.module.js';
import { FIELD_ROW_NORMAL, FIELD_ROW_SPACING, ROAD_WAVES, ROAD_WEAR_GLSL } from '../world/world.js';

const noise = `
float detailHash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * .1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
float grain(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f*f*(3.-2.*f);
  return mix(mix(detailHash(i),detailHash(i+vec2(1,0)),f.x),
             mix(detailHash(i+vec2(0,1)),detailHash(i+1.),f.x),f.y);
}
`;

export const wetness = { value: 0 };
export const vegetationTime = { value: 0 };
export const windStrength = { value: .65 };
export const tunnelOpenings={value:Array.from({length:4},()=>new T.Vector4())};
export const tyrePress = {value:Array.from({length:10},()=>new T.Vector4())};
const windowLights={value:0};

export function windowSurface(){
  const material=new T.MeshPhysicalMaterial({
    color:0xffffff,roughness:.31,metalness:.13,clearcoat:.55,clearcoatRoughness:.23,
  });
  material.customProgramCacheKey=()=> 'rives-window';
  material.onBeforeCompile=shader=>{
    shader.uniforms.windowLights=windowLights;
    shader.vertexShader=shader.vertexShader
      .replace('#include <common>','#include <common>\nvarying vec2 paneUV; varying vec3 paneCenter;')
      .replace('#include <begin_vertex>',`
        #include <begin_vertex>
        paneUV=uv;
        vec4 center=vec4(0.,0.,0.,1.);
        #ifdef USE_INSTANCING
          center=instanceMatrix*center;
        #endif
        paneCenter=(modelMatrix*center).xyz;
      `);
    shader.fragmentShader=shader.fragmentShader
      .replace('#include <common>',`#include <common>
        varying vec2 paneUV;
        varying vec3 paneCenter;
        uniform float windowLights;
      `)
      .replace('#include <color_fragment>',`
        #include <color_fragment>
        vec2 q=clamp(paneUV,0.,1.);
        float border=1.-smoothstep(.025,.055,min(min(q.x,1.-q.x),min(q.y,1.-q.y)));
        float mullion=max(1.-smoothstep(.016,.031,abs(q.x-.5)),
          (1.-smoothstep(.011,.023,abs(q.y-.68)))*.82);
        float frame=max(border,mullion);
        float choice=fract(sin(dot(floor(paneCenter*2.9),vec3(91.2,31.6,57.1)))*14853.871);
        float glow=windowLights*step(.39,choice);
        float curtain=(1.-smoothstep(.19,.27,min(q.x,1.-q.x))) *
          (.52+.28*sin(q.x*107.)+.16*sin(q.y*12.));
        float roomEdge=smoothstep(.17,.7,q.y);
        vec3 day=mix(vec3(.04,.072,.085),vec3(.16,.23,.25),roomEdge);
        vec3 room=mix(vec3(.37,.24,.13),vec3(.66,.49,.28),roomEdge);
        room=mix(room,vec3(.22,.12,.069),curtain*.8);
        diffuseColor.rgb=mix(mix(day,room,glow),vec3(.44,.36,.27),frame);
      `)
      .replace('#include <emissivemap_fragment>',`
        #include <emissivemap_fragment>
        totalEmissiveRadiance+=room*glow*(1.-frame)*.44;
      `);
  };
  return material;
}


const patterns = {
  meadow: `
    float coverNoise = grain(p*.046);
    float soil = smoothstep(.28,.64,grain(p*.012+24.));
    float landCover = sin(p.x*.007+landShape.x)+cos(p.y*.009+landShape.y)+.32*sin((p.x+p.y)*.013);
    float wandering = (grain(p*.035)-.5)*.1+(grain(p*.19)-.5)*.022;
    float field = smoothstep(.6,.64,landCover+wandering)*smoothstep(.02,.5,vFarmland+.5)*(1.-smoothstep(.3,.8,vRockFace));
    float wooded = landCover+.35*sin(p.x*.041+landShape.x)*cos(p.y*.033+landShape.y)+.17*sin((p.x+p.y)*.073);
    float woodland = (1.-field)*(1.-smoothstep(landShape.z-.05,landShape.z+.05,wooded+wandering));
    float rowCoord = dot(p,vec2(${FIELD_ROW_NORMAL.join(',')}));
    float furrow = cos(rowCoord*6.2831853/${FIELD_ROW_SPACING}) * mix(.42,1.,smoothstep(.18,.73,grain(p*.12)));
    float rowFade = 1.-smoothstep(.12,.65,fwidth(rowCoord));
    float stubble = grain(p*7.);
    vec3 meadow = color * vec3(.83,1.12,.79) * mix(.48,1.48,coverNoise);
    meadow = mix(meadow, meadow*vec3(1.43,1.16,.70), smoothstep(.38,.82,grain(p*.23)));
    meadow *= 1. + (stubble-.5)*.67*detail;
    float humus=grain(p*.19+.6*grain(p*1.53));
    float leaves=grain(p*vec2(6.2,9.4));
    vec3 forestBed=mix(vec3(.083,.073,.044),vec3(.164,.129,.072),humus);
    forestBed=mix(forestBed,vec3(.092,.141,.055),smoothstep(.42,.71,grain(p*.31)));
    meadow=mix(meadow,forestBed*(1.+(leaves-.4)*.72*detail),woodland*.89);
    vec3 canopy = mix(vec3(.19,.24,.075),vec3(.33,.31,.12),grain(p*.21));
    vec3 bareSoil = mix(vec3(.34,.28,.105),vec3(.153,.083,.038),soil);
    vec3 crop = mix(canopy,bareSoil,.35*smoothstep(.3,.8,grain(p*.6)));
    crop *= (.62+.72*coverNoise)*(1.+furrow*rowFade*.31+(stubble-.5)*detail*.54);
    vec2 rockUV=vec2(dot(p,vec2(.66,.75)),positionOnSurface.y + dot(p,vec2(.13,-.11)));
    float bands=grain(rockUV*vec2(.032,.29)+grain(p*.071)*2.);
    float scree=grain(p*.69)*.53+grain(rockUV*2.5)*.47;
    float outcrop=smoothstep(.31,.76,vRockFace+.31*(bands-.5));
    float bedding = grain(rockUV*vec2(.044,1.25)+grain(rockUV*.136)*2.3);
    float fissures = smoothstep(.52,.82,grain(rockUV*vec2(.29,3.3)+grain(rockUV*.31)*.7));
    vec3 outcropColor=mix(vec3(.095,.089,.073),vec3(.29,.267,.22),bands)*(.72+.57*scree);
    outcropColor *= 1.+(.23*bedding-.25*fissures)*(1.-smoothstep(.27,2.2,length(fwidth(rockUV))));

    color = mix(mix(meadow,crop,field),outcropColor,outcrop);
    float groundRelief = ((.042*field*furrow*rowFade + .018*(stubble-.5))*(1.-outcrop) +
      outcrop*(.064*bands+.033*scree+.026*bedding-.028*fissures))*detail;
  `,
  asphalt: `
    float aggregate = grain(p*38.)*.67 + grain(p*15.)*.33;
    float patches = grain(p*.65);
    vec2 seam = vec2(p.x+.27*p.y,p.y-.13*p.x);
    float fissure = abs(grain(seam*.88 + grain(seam*5.)*.18)-.5);
    float cracks = (1.-smoothstep(.009,.033,fissure))*smoothstep(.52,.73,grain(p*.22+13.));
    float repair = smoothstep(.57,.66,grain(seam*vec2(.48,.13)+7.));
    color *= (.69 + .52*patches) * (1.+(aggregate-.5)*.86*detail);
    color *= 1.-.23*repair-.37*cracks*detail;
    float pocket=pavementWear ? repairWear(p) : 0.;
    float patched=smoothstep(.003,.094,pocket)*detail;
    color=mix(color,color*(.58+.28*aggregate)+vec3(.016,.013,.011),patched*.84);
    float groundRelief = ((${ROAD_WAVES.map(([x,z,h])=>`sin(dot(p,vec2(${x},${z})))*${h}`).join('+')})-.078*pocket+.003*(aggregate-.5))*detail;
    float puddle=smoothstep(.27,.54,wet*grain(p*.47));
    vec3 viewDir=normalize(cameraPosition-positionOnSurface);
    float standingWater=smoothstep(.15,.60,pocket)*smoothstep(.22,.79,wet);
    float sheen=max(puddle,standingWater)*pow(1.-max(viewDir.y,0.),2.3);
    color=mix(color,color*.55+vec3(.065,.087,.10),sheen*.8);
  `,
  gravel: `
    color *= (.58 + grain(p*.75)*.65) * (.8 + grain(p*12.)*.43*detail);
  `,
  earth: `
    float clods = grain(p*2.1)*.55 + grain(p*8.5)*.45;
    float wet = smoothstep(.5,.85,grain(p*.33+.4*grain(p*1.1)));
    color *= (.5 + .8*clods) * mix(1.,.62,wet);
    color = mix(color, color*vec3(.86,1.1,.55), smoothstep(.55,.8,grain(p*.9))*.4*detail);
    float groundRelief = (clods-.5)*.06*detail;
  `,
  markings: `
    color *= .76 + grain(p*2.)*.27;
    color *= 1.-.68*smoothstep(.52,.83,grain(p*47.))*detail;
  `,
  straw: `
    vec3 strand = materialPosition;
    float angle = atan(strand.z,strand.y);
    float reel = cos(length(strand.yz)*68.+angle);
    float fibers = grain(vec2(strand.x*26.+strand.z*31.,strand.y*37.));
    float cutEnd = smoothstep(.46,.497,abs(strand.x));
    float bands = smoothstep(.033,.048,abs(abs(strand.x)-.29));
    color *= mix(.72 + .25*bands,.84+.12*reel*detail,cutEnd) + fibers*.36*detail;
  `,
  cowCoat: `
    vec2 hide = materialPosition.xz*2.7+vec2(materialPosition.y*1.4,-materialPosition.y*2.1);
    float patches = smoothstep(.49,.56,grain(hide));
    color = mix(color,vec3(.047,.032,.023),patches*.94);
    color *= .85+.23*grain(hide*23.);
  `,
  fur: `
    vec2 fibres=vec2(materialPosition.x+materialPosition.z*.52,materialPosition.y);
    float hairs=grain(fibres*vec2(49.,12.));
    color *= .80+.34*grain(fibres*5.) + .16*(hairs-.5)*detail;
  `,
  wool: `
    vec2 fleece = materialPosition.xz+materialPosition.y*vec2(.78,.59);
    color *= .77+.22*grain(fleece*12.)+.18*grain(fleece*37.)*detail;
  `,
  machinery: `
    vec2 panel = vec2(materialPosition.x+materialPosition.z*.67,materialPosition.y+materialPosition.z*.17);
    float dirt = (1.-smoothstep(.12,.5,materialPosition.y)) *
      smoothstep(.24,.76,grain(panel*8.));
    color = mix(color*(.82+.33*grain(panel*30.)),vec3(.14,.088,.04),dirt*.68*detail);
  `,
  plaster: `
    vec2 wall = vec2(positionOnSurface.x+positionOnSurface.z,positionOnSurface.y);
    float worn = grain(wall*1.3)*.7 + grain(wall*9.)*.3;
    float damp = grain(wall*vec2(8.,.44))*smoothstep(.44,.75,grain(wall*.27+7.));
    float fracture = abs(grain(wall*vec2(.54,.41)+grain(wall*3.)*.21)-.5);
    float crack = (1.-smoothstep(.009,.032,fracture))*smoothstep(.49,.76,grain(wall*.28+8.));
    color *= (.72+.51*worn-.39*damp-.63*crack*detail) * (1.+(grain(wall*53.)-.5)*.27*detail);
    float groundRelief = (.022*worn-.035*crack)*detail;
  `,
  masonry: `
    vec2 wall=vec2(materialPosition.x+materialPosition.z,materialPosition.y);
    vec2 grid = wall/vec2(.32,.135);
    grid.x += .5*mod(floor(grid.y),2.);
    vec2 unit = abs(fract(grid)-.5);
    float joint=max(unit.x,unit.y*.97+.015);
    float bevel=1.-smoothstep(.407,.48,joint);
    float brickTone=detailHash(floor(grid));
    float bone=grain(wall*vec2(4.3,.68));
    float fracture = abs(grain(wall*.86+grain(wall*5.)*.2)-.5);
    float cracks=(1.-smoothstep(.009,.027,fracture))*smoothstep(.49,.79,grain(wall*.29+3.));
    vec3 fired=color*(.64+.49*brickTone+.27*bone);
    color=mix(vec3(.195,.174,.134),fired,mix(.84,bevel,detail));
    color*=1.-cracks*.66*detail;
    float groundRelief=(.028*bevel+.008*bone-.022*cracks)*detail;
  `,
  derelict: `
    vec2 wall=vec2(materialPosition.x+materialPosition.z,materialPosition.y);
    float flake=smoothstep(.48,.58,grain(wall*1.6)+.22*grain(wall*7.)-.14);
    vec2 grid=wall/vec2(.31,.13);
    grid.x+=.5*mod(floor(grid.y),2.);
    float joint=max(abs(fract(grid.x)-.5),abs(fract(grid.y)-.5));
    float brick=1.-smoothstep(.414,.485,joint);
    float fracture=abs(grain(wall*vec2(.38,.51)+grain(wall*4.)*.17)-.5);
    float crack=(1.-smoothstep(.01,.038,fracture))*smoothstep(.30,.71,grain(wall*.45+7.));
    color=mix(color*(.74+.46*grain(wall*.91)),mix(vec3(.148,.134,.101),vec3(.26,.101,.058)*
      (.69+.55*detailHash(floor(grid))),mix(.8,brick,detail)),flake*.87);
    color*=1.-.60*crack*detail-.34*grain(wall*vec2(9.,.52));
    float groundRelief=(-.027*flake+.02*flake*brick-.037*crack)*detail;
  `,
  sandstone: `
    vec2 wall = vec2(materialPosition.x+materialPosition.z,materialPosition.y);
    vec2 grid = wall/vec2(.61,.27);
    grid.x += .5*mod(floor(grid.y),2.);
    grid += vec2(grain(wall*6.),grain(wall*6.+19.))*.11;
    vec2 edge = .5-abs(fract(grid)-.5);
    float block = smoothstep(.024,.10,min(edge.x,edge.y));
    float strata = grain(wall*vec2(3.,27.));
    float tone = detailHash(floor(grid));
    color *= mix(.60,.78+.35*tone+.20*strata,mix(.9,block,detail));
    float groundRelief=(.015*block+.003*strata)*detail;
  `,
  cobbles: `
    vec2 grid=p/vec2(.19,.16);
    grid.x+=.5*mod(floor(grid.y),2.);
    grid+=vec2(grain(p*11.),grain(p*11.+8.))*.16;
    vec2 edge=abs(fract(grid)-.5)*2.;
    float crown=1.-smoothstep(.55,.96,length(pow(edge,vec2(2.5))));
    float speckle=grain(p*42.);
    color*=mix(.60,.87+.26*detailHash(floor(grid))+.14*speckle,mix(.8,crown,detail));
    float grime=smoothstep(.5,.8,grain(p*.7+grain(p*2.3)*1.5));
    color=mix(color,color*vec3(.9,.74,.55),grime*.55*detail);
    color*=1.-.25*grime;
    float groundRelief=(.013*crown+.002*speckle)*detail;
  `,
  concrete: `
    float pores=grain(p*48.);
    float mottling=grain(p*2.1);
    color *= .89+.23*mottling+(pores-.5)*.20*detail;
    float grime=smoothstep(.52,.82,grain(p*.9+grain(p*2.7)*1.2));
    color=mix(color,color*vec3(.86,.78,.62),grime*.45*detail);
    float groundRelief=.002*(pores-.5)*detail;
  `,
  tiles: `
    vec2 uv=vec2(positionOnSurface.x+positionOnSurface.z*.54,positionOnSurface.y);
    vec2 grid=uv*vec2(4.8,4.1);
    grid.x+=mod(floor(grid.y),2.)*.5;
    vec2 tile=fract(grid);
    float overlap=smoothstep(.04,.23,tile.y);
    float ridge=sin(tile.x*3.14159);
    float seam=smoothstep(.01,.12,ridge)*overlap;
    float tint=detailHash(floor(grid));
    color*=mix(1.,.63+.23*seam+.22*tint+.12*ridge,detail);
    float groundRelief=(.018*ridge+.009*overlap)*detail;
  `,
  slate: `
    vec2 uv=vec2(positionOnSurface.x+positionOnSurface.z*.54,positionOnSurface.y);
    vec2 grid=uv*vec2(5.8,5.2);
    grid.x+=mod(floor(grid.y),2.)*.5;
    vec2 tile=fract(grid);
    float edge=smoothstep(.01,.09,min(tile.x,1.-tile.x));
    float overlap=edge*smoothstep(.02,.16,tile.y);
    float flake=grain(uv*vec2(19.,42.));
    color*=mix(1.,.56+.32*overlap+.23*detailHash(floor(grid))+.13*flake,detail);
    float groundRelief=(.007*overlap+.002*flake)*detail;
  `,
  foliage: `color *= .65 + .54*grain(p*2.7) + .25*grain(p*12.)*detail;`,
  canopy: `
    vec3 leaf = positionOnSurface;
    float broad = grain(p*.61+leaf.y*.19);
    float specks = grain(vec2(p.x+p.y*.81,leaf.y)*15.);
    float twigs = grain(vec2(dot(p,vec2(3.6,4.1)),leaf.y*13.));
    color *= (.63+.61*broad+.09*twigs)*(1.+(specks-.42)*.56*detail);
  `,
  grass: `color *= .74 + .43*grain(p*1.4) + .24*grain(p*11.)*detail;`,
  bark: `
    vec2 ridges = vec2(p.x*29.+p.y*24.,positionOnSurface.y*1.9);
    float barkFurrow = grain(ridges+vec2(grain(ridges*.17)*1.9,0.));
    float barkFlakes = grain(ridges*2.4);
    color *= .72+.39*barkFurrow+(barkFlakes-.5)*.31*detail;
    float groundRelief = .003*barkFurrow*detail;
  `,
};

// How far the camera is under water, from 0 (dry) to 1.
export const underwater={value:0};
// Phase of the land-use pattern (a, b) and the forest threshold of the current world.
export const landShape={value:new T.Vector3()};

export function surface(color, { pattern, pavementWear = true, ...options } = {}) {
  const material = new T.MeshStandardMaterial({ color, roughness: .88, ...options });
  if (!pattern) return material;
  const blockWall=pattern==='masonry'||pattern==='derelict'||pattern==='sandstone';
  const local = blockWall || ['machinery','straw','cowCoat','wool','fur'].includes(pattern);
  material.customProgramCacheKey = () => pattern;
  material.onBeforeCompile = shader => {
    shader.uniforms.wet = wetness;
    if (pattern === 'grass') {
      shader.uniforms.vegetationTime = vegetationTime;
      shader.uniforms.windStrength = windStrength;
      shader.uniforms.tyrePress = tyrePress;
      shader.vertexShader = 'uniform float vegetationTime, windStrength; uniform vec4 tyrePress[10];\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
        #include <begin_vertex>
        vec2 anchor = instanceMatrix[3].xz;
        float swell = sin(dot(anchor,vec2(.021,.013))-vegetationTime*.8);
        float gust = sin(dot(anchor,vec2(.12,.067))-vegetationTime*1.9);
        float flutter = sin(anchor.x*.56+anchor.y*.42-vegetationTime*4.3);
        float tip = clamp(position.y+.5,0.,1.);
        float bend = windStrength*(gust*.6+flutter*.22+swell*.55+.3);
        transformed.xz += vec2(.46,.22)*bend*tip*tip;
        transformed.y -= abs(bend)*.07*tip*tip;
        vec3 plantOrigin = (modelMatrix * instanceMatrix[3]).xyz;
        float flattened = 0.;
        for(int i=0;i<10;i++){
          vec3 delta = tyrePress[i].xyz - plantOrigin;
          flattened = max(flattened,(1.-smoothstep(.21,.9,length(delta.xz)))*
             (1.-smoothstep(.6,1.0,abs(delta.y)))*tyrePress[i].w);
        }
        transformed.y -= tip*flattened*.84;
        transformed.x += tip*flattened*.26;
      `);
    }
    if (pattern === 'canopy') {
      shader.uniforms.vegetationTime = vegetationTime;
      shader.uniforms.windStrength = windStrength;
      shader.vertexShader = 'uniform float vegetationTime, windStrength; varying float vShimmer;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
        #include <begin_vertex>
        vShimmer = 1.;
        #ifdef USE_INSTANCING
          vec2 anchor = instanceMatrix[3].xz;
          // Gusts travel across the land in bands: a slow swell, a gust and a fast flutter.
          float swell = sin(dot(anchor,vec2(.013,.009))-vegetationTime*.55);
          float gust = sin(dot(anchor,vec2(.041,.028))-vegetationTime*1.27);
          float height = max(0.,position.y);
          float power = windStrength*(.42+.5*gust+.3*swell);
          vec2 worldWind = vec2(.036,.02)*power*height*height;
          // Every leaf cluster rustles on its own phase, most at the crown's edge and tip.
          float phase = dot(position,vec3(23.,31.,17.))+anchor.x*.7;
          float edge = clamp(length(position.xz)*5.5,0.,1.);
          float rustle = (.45+windStrength)*(.3+.7*power)*edge*(.4+height);
          transformed += vec3(sin(vegetationTime*5.3+phase),sin(vegetationTime*4.1+phase*1.7)*.6,cos(vegetationTime*5.9+phase*.8))*.0085*rustle;
          vec2 axisX = normalize(instanceMatrix[0].xz);
          vec2 axisZ = normalize(instanceMatrix[2].xz);
          transformed.xz += vec2(dot(worldWind,axisX),dot(worldWind,axisZ));
          // Leaves turn toward and away from the light as they move.
          vShimmer = 1.+.13*rustle*sin(vegetationTime*3.7+phase*.6)+.05*power;
        #endif
      `);
      shader.fragmentShader = 'varying float vShimmer;\n' + shader.fragmentShader;
    }
    shader.vertexShader = 'varying vec3 positionOnSurface;\n' + shader.vertexShader;
    if (pattern === 'meadow') shader.vertexShader =
      'attribute float farmland, rockFace, woodlandCover; varying float vFarmland, vRockFace, vWoodlandCover;\n' + shader.vertexShader;
    if (local) shader.vertexShader = 'varying vec3 materialPosition;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `
      vec4 detailPosition = vec4(transformed, 1.);
      #ifdef USE_INSTANCING
        detailPosition = instanceMatrix * detailPosition;
      #endif
      positionOnSurface = (modelMatrix * detailPosition).xyz;
      ${pattern === 'meadow' ? 'vFarmland = farmland; vRockFace = rockFace; vWoodlandCover = woodlandCover;' : ''}
      ${local && !blockWall && pattern !== 'machinery' ? 'materialPosition = transformed;' : ''}
      ${blockWall ? `
        materialPosition=transformed;
        #ifdef USE_INSTANCING
          materialPosition*=vec3(length(instanceMatrix[0].xyz),length(instanceMatrix[1].xyz),length(instanceMatrix[2].xyz));
        #endif
      ` : ''}
      ${pattern === 'machinery' ? 'materialPosition = detailPosition.xyz * vec3(length(modelMatrix[0].xyz),length(modelMatrix[1].xyz),length(modelMatrix[2].xyz));' : ''}
      #include <project_vertex>
    `);
    shader.fragmentShader = 'varying vec3 positionOnSurface; uniform float wet;\n' + noise + shader.fragmentShader;
    if (pattern === 'asphalt') {
      shader.uniforms.pavementWear = { value: pavementWear };
      shader.fragmentShader = 'uniform bool pavementWear;\n' + ROAD_WEAR_GLSL + shader.fragmentShader;
    }
    if (pattern === 'meadow') {
      shader.uniforms.tunnelOpenings=tunnelOpenings;
      shader.uniforms.landShape=landShape;
      shader.fragmentShader='uniform vec3 landShape; uniform vec4 tunnelOpenings[4]; varying float vFarmland, vRockFace, vWoodlandCover;\n'+shader.fragmentShader;
      shader.fragmentShader=shader.fragmentShader.replace('#include <alphatest_fragment>', `
        #include <alphatest_fragment>
        for(int i=0;i<4;i+=2){
          vec4 base=tunnelOpenings[i], cut=tunnelOpenings[i+1];
          vec2 delta=positionOnSurface.xz-base.xy;
          float longitudinal=dot(delta,base.zw), lateral=dot(delta,vec2(base.w,-base.z));
          if(cut.z>0. && abs(longitudinal)<cut.z && abs(lateral)<cut.y &&
            positionOnSurface.y<cut.x+cut.w) discard;
        }
      `);
    }
    if (local) shader.fragmentShader = 'varying vec3 materialPosition;\n' + shader.fragmentShader;
    if (patterns[pattern].includes('float groundRelief')) {
      shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `
        #include <normal_fragment_maps>
        vec3 groundDx = dFdx(-vViewPosition), groundDy = dFdy(-vViewPosition);
        vec3 groundT = cross(groundDy,normal), groundB = cross(normal,groundDx);
        float groundArea = dot(groundDx,groundT);
        vec3 groundGradient = dFdx(groundRelief)*groundT + dFdy(groundRelief)*groundB;
        normal = normalize(max(abs(groundArea),1e-8)*normal-sign(groundArea)*groundGradient);
      `);
    }
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
      #include <color_fragment>
      vec2 p = positionOnSurface.xz;
      float detail = 1.-smoothstep(.03,.26,length(fwidth(positionOnSurface)));
      vec3 color = diffuseColor.rgb;
      ${patterns[pattern]}
      ${pattern === 'canopy' ? 'color *= vShimmer;' : ''}
      diffuseColor.rgb = color * mix(1., ${pattern === 'asphalt' ? '.56' : '.83'}, wet);
    `);
    if (pattern === 'asphalt') {
      shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', `
        #include <roughnessmap_fragment>
        roughnessFactor = mix(.72,.98,aggregate);
        roughnessFactor = mix(mix(roughnessFactor,.32,wet),.13,standingWater);
      `);
    }
  };
  return material;
}

const states = [
  { title: 'Clear', sky: 0x648cbb, haze: 0xc9d7c9, sun: 0xffdfab, power: 2.8, ambient: 1.5, fog: .00105, clouds: .37, wet: 0, direction: [-.67,.48,.26] },
  { title: 'Rain', sky: 0x505e73, haze: 0x87959b, sun: 0xc7cedd, power: .55, ambient: 1.65, fog: .0027, clouds: .94, wet: 1, direction: [-.67,.48,.26] },
  { title: 'Dusk', sky: 0x484f85, haze: 0xd89976, sun: 0xffaa63, power: 2.1, ambient: 1.0, fog: .00165, clouds: .49, wet: 0, direction: [-.8,.15,.39] },
  { title: 'Night', sky: 0x0d1731, haze: 0x344663, sun: 0x8ca5ef, power: .42, ambient: .45, fog: .00165, clouds: .25, wet: 0, direction: [-.67,.48,.26] },
  { title: 'Overcast', sky: 0x777f88, haze: 0xacb6ae, sun: 0xe8e2d8, power: .85, ambient: 1.55, fog: .00165, clouds: .97, wet: 0, direction: [-.67,.48,.26] },
  { title: 'Fog', sky: 0x8e9b9e, haze: 0xadb8b5, sun: 0xe2e9e6, power: .52, ambient: 1.65, fog: .005, clouds: 1, wet: 0, direction: [-.67,.48,.26] },
];

export function createVisuals(renderer, scene) {
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFShadowMap;

  const hemi = new T.HemisphereLight(0xe0eaff, 0x59553b, 1);
  const sun = new T.DirectionalLight();
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -76, right: 76, top: 76, bottom: -76, near: 1, far: 420 });
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.normalBias = .18;
  sun.shadow.bias = -.0002;
  scene.add(hemi, sun, sun.target);
  scene.fog = new T.FogExp2(0xc9d7c9, .001);

  const sky = new T.Mesh(new T.SphereGeometry(1600, 28, 16), new T.ShaderMaterial({
    side: T.BackSide, depthWrite: false,
    uniforms: {
      zenith: { value: new T.Color() }, horizon: { value: new T.Color() },
      solar: { value: new T.Color() }, heading: { value: new T.Vector3() },
      cloud: { value: 0 }, clock: { value: 0 }, sunlight: { value: 1 },
    },
    vertexShader: `
      varying vec3 ray;
      void main() {
        ray = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.);
        gl_Position.z = gl_Position.w * .99999;
      }
    `,
    fragmentShader: noise + `
      varying vec3 ray;
      uniform vec3 zenith,horizon,solar,heading;
      uniform float cloud,clock,sunlight;
      void main(){
        vec3 d = normalize(ray);
        float altitude = max(d.y,0.);
        vec3 color = mix(horizon,zenith,smoothstep(0.,.75,altitude));
        float glow = max(dot(d,heading),0.);
        color += solar * sunlight * (.32*pow(glow,16.)+2.*smoothstep(.9995,.99984,glow));
        vec2 p = d.xz/(altitude+.23)*3.8 + vec2(clock*.011,clock*.004);
        float layer = grain(p)*.58+grain(p*2.1)*.27+grain(p*6.2)*.15;
        float opacity = smoothstep(.65-cloud*.34,.81-cloud*.3,layer)*smoothstep(.01,.20,altitude);
        color = mix(color,mix(horizon*.73,vec3(.82,.84,.85),sunlight*.48),opacity*.93);
        gl_FragColor = vec4(color,1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  }));
  sky.renderOrder = -100;
  sky.frustumCulled = false;
  scene.add(sky);

  const drops = new Float32Array(750 * 6);
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.BufferAttribute(drops, 3).setUsage(T.DynamicDrawUsage));
  const rain = new T.LineSegments(geometry, new T.LineBasicMaterial({
    color: 0xcedbe6, transparent: true, opacity: .32, depthWrite: false,
  }));
  rain.frustumCulled = false;
  scene.add(rain);

  const target = new T.WebGLRenderTarget(1, 1, { depthBuffer: true, type: T.HalfFloatType, samples: 2 });
  const screen = new T.Scene();
  const grade = new T.ShaderMaterial({
    uniforms: { image: { value: target.texture }, velocity: { value: 0 } },
    vertexShader: 'varying vec2 uv0; void main(){uv0=uv;gl_Position=vec4(position.xy,0.,1.);}',
    fragmentShader: `
      uniform sampler2D image;
      uniform float velocity;
      varying vec2 uv0;
      void main() {
        vec2 center = uv0-.5;
        vec3 color = texture2D(image,uv0).rgb;
        if (velocity>.01) {
          vec3 blur = color;
          for (int i=1;i<5;i++) blur += texture2D(image,uv0-center*velocity*.009*float(i)).rgb;
          color = mix(color,blur*.2,smoothstep(.17,.64,length(center)));
        }
        float luma = dot(color,vec3(.2126,.7152,.0722));
        color = mix(vec3(luma),color,1.06);
        color *= 1.-.23*dot(center,center)*1.6;
        gl_FragColor = vec4(max(color,0.),1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  screen.add(new T.Mesh(new T.PlaneGeometry(2, 2), grade));
  const screenCamera = new T.Camera();
  const size = new T.Vector2();
  let index = 0;
  let time = 0;
  let wetTarget=0;
  let daylightState=0;
  let shadowX = Infinity, shadowZ = Infinity;
  const direction = new T.Vector3();

  // Lighting is continuous: the hour blends keyed time-of-day looks, and each
  // weather (or forced dusk/night) fades in and out over about ten seconds.
  const byTitle=title=>states.find(state=>state.title===title);
  const dayKeys=[[0,'Night'],[5.2,'Night'],[6.3,'Dusk'],[7.8,'Clear'],[17,'Clear'],[18.4,'Dusk'],[20.4,'Night'],[24,'Night']];
  const smooth=t=>t*t*(3-2*t);
  const mixState=(a,b,t)=>({
    sky:a.sky.clone().lerp(b.sky,t),haze:a.haze.clone().lerp(b.haze,t),sun:a.sun.clone().lerp(b.sun,t),
    power:a.power+(b.power-a.power)*t,ambient:a.ambient+(b.ambient-a.ambient)*t,
    fog:a.fog+(b.fog-a.fog)*t,clouds:a.clouds+(b.clouds-a.clouds)*t,
    direction:a.direction.clone().lerp(b.direction,t).normalize(),
  });
  const pure=title=>{
    const s=byTitle(title);
    return {sky:new T.Color(s.sky),haze:new T.Color(s.haze),sun:new T.Color(s.sun),power:s.power,ambient:s.ambient,
      fog:s.fog,clouds:s.clouds,direction:new T.Vector3(...s.direction).normalize()};
  };
  const looks=Object.fromEntries(states.map(s=>[s.title,pure(s.title)]));
  function timeOfDay(hour) {
    let i=1;
    while(i<dayKeys.length-1&&hour>=dayKeys[i][0])i++;
    const [h0,n0]=dayKeys[i-1],[h1,n1]=dayKeys[i];
    return mixState(looks[n0],looks[n1],smooth(Math.min(1,Math.max(0,(hour-h0)/(h1-h0)))));
  }
  function overlay(base,title,w) {
    if(w<=.0005)return base;
    const weather=looks[title], ratio=Math.min(1.2,Math.max(.2,base.ambient/1.5));
    const tint=color=>weather[color].clone().multiplyScalar(ratio);
    return {...base,
      sky:base.sky.clone().lerp(tint('sky'),w),haze:base.haze.clone().lerp(tint('haze'),w),
      sun:base.sun.clone().lerp(weather.sun,w),
      power:base.power*(1+(weather.power/2.8-1)*w),ambient:base.ambient*(1+(weather.ambient/1.5-1)*w),
      fog:base.fog+(Math.max(base.fog,weather.fog)-base.fog)*w,clouds:base.clouds+(weather.clouds-base.clouds)*w};
  }
  const weights={Rain:0,Dusk:0,Night:0,Overcast:0,Fog:0};
  let currentHour=8.5, darkness=0;
  function approach(timeStep) {
    const step=timeStep*.1;
    for(const title of Object.keys(weights)){
      const goal=states[index]?.title===title?1:0;
      weights[title]+=Math.max(-step,Math.min(step,goal-weights[title]));
    }
  }
  function apply() {
    let state=timeOfDay(currentHour);
    state=mixState(state,looks.Dusk,smooth(weights.Dusk));
    state=mixState(state,looks.Night,smooth(weights.Night));
    darkness=1-Math.min(1,Math.max(0,(state.ambient-.45)/1.05));
    for(const title of ['Rain','Overcast','Fog'])state=overlay(state,title,smooth(weights[title]));
    const u=sky.material.uniforms, rainy=smooth(weights.Rain);
    const moved=direction.distanceToSquared(state.direction)>1e-6;
    direction.copy(state.direction);
    u.zenith.value.copy(state.sky);
    u.horizon.value.copy(state.haze);
    u.solar.value.copy(state.sun);
    u.heading.value.copy(direction);
    u.cloud.value=state.clouds;
    u.sunlight.value=state.power/2.8;
    wetTarget=rainy;
    windowLights.value=Math.max(.12+.88*smooth(Math.min(1,Math.max(0,(darkness-.25)/.65))),.44*rainy);
    scene.fog.color.copy(state.haze);
    scene.fog.density=state.fog;
    sun.color.copy(state.sun);
    sun.intensity=state.power;
    hemi.intensity=state.ambient;
    rain.material.opacity=.32*rainy;
    if(moved)shadowX=Infinity;
    return states[index].title;
  }
  apply();
  let worldRenderStats, lowDetail=false, captureRequested=false, renderBreakdown;
  function renderWorld(camera) {
    if(!captureRequested){
      renderer.render(scene,camera);
      return;
    }
    captureRequested=false;
    const categories={},tiles={}, draw=renderer.renderBufferDirect;
    const count=(table,key,calls,triangles)=>{
      const entry=table[key]??={calls:0,triangles:0};
      entry.calls+=calls;entry.triangles+=triangles;
    };
    renderer.renderBufferDirect=function(drawCamera,scene,geometry,material,object,group){
      const stats=renderer.info.render, calls=stats.calls, triangles=stats.triangles;
      draw.call(this,drawCamera,scene,geometry,material,object,group);
      if(drawCamera!==camera){
        count(categories,'shadow and secondary passes',stats.calls-calls,stats.triangles-triangles);
        return;
      }
      let category,tile;
      for(let node=object;node&&(!category||!tile);node=node.parent){
        category??=node.userData.renderCategory;
        tile??=node.userData.renderTile;
      }
      count(categories,category??'other',stats.calls-calls,stats.triangles-triangles);
      if(tile) count(tiles,tile,stats.calls-calls,stats.triangles-triangles);
    };
    try {
      renderer.render(scene,camera);
      renderBreakdown={categories,tiles};
    } finally {
      renderer.renderBufferDirect=draw;
    }
  }
  function render(camera,x,z,speed,timeStep,indoors=false) {
    time+=timeStep;
    approach(timeStep);
    apply();
    if(underwater.value>0){
      scene.fog.color.setRGB(.035,.15,.15);
      scene.fog.density=.07+underwater.value*.05;
    }
    vegetationTime.value=time;
    windStrength.value=.55+.78*wetTarget+.20*Math.sin(time*.53)+.12*Math.sin(time*1.16);
    rain.visible=!lowDetail && wetTarget>.02 && !indoors;
    wetness.value=T.MathUtils.lerp(wetness.value,wetTarget,1-Math.exp(-timeStep*(wetTarget?.26:.047)));
    sky.position.copy(camera.position);
    sky.material.uniforms.clock.value = time;
    if (Math.hypot(x - shadowX, z - shadowZ) > 7) {
      shadowX = x;
      shadowZ = z;
      sun.target.position.set(x, camera.position.y - 4, z);
      sun.position.copy(sun.target.position).addScaledVector(direction, 190);
    }
    if (rain.visible) {
      for (let i = 0; i < drops.length; i += 6) {
        const id = i / 6;
        const fall = (id * .618 + time * 1.23) % 1;
        const px = x + ((id * .75487766) % 1 - .5) * 54 + fall * 3;
        const pz = z + ((id * .56984029) % 1 - .5) * 54;
        const py = camera.position.y + 16 - fall * 29;
        drops.set([px, py, pz, px + .11, py - .69, pz], i);
      }
      geometry.attributes.position.needsUpdate = true;
    }
    if(!lowDetail){
      renderer.getDrawingBufferSize(size);
      if(target.width!==size.x||target.height!==size.y) target.setSize(size.x,size.y);
      grade.uniforms.velocity.value=T.MathUtils.smoothstep(Math.abs(speed),24,52);
      renderer.setRenderTarget(target);
    }
    renderWorld(camera);
    worldRenderStats={calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,
      width:renderer.domElement.width,height:renderer.domElement.height};
    if(!lowDetail){
      renderer.setRenderTarget(null);
      renderer.render(screen,screenCamera);
    }
  }

  return {
    worldRenderStats:()=>worldRenderStats,
    captureRenderBreakdown(){captureRequested=true;renderBreakdown=null;},
    renderBreakdown:()=>renderBreakdown,
    setLowDetail(value){
      if(value&&!lowDetail) target.dispose();
      lowDetail=value;
      renderer.shadowMap.enabled=!value;
      renderer.shadowMap.needsUpdate=true;
    },
    setHour(hour) {
      currentHour=((hour%24)+24)%24;
      return darkness>.7?'Night':weights.Rain>.5?'Rain':'Clear';
    },
    render,
    cycleWeather() {
      index = (index + 1) % states.length;
      return states[index].title;
    },
  };
}

// The particle ring stays bounded even during long drives.
export function createTyreEffects(scene, worldHeight) {
  const count = 320;
  const positions = new Float32Array(count * 3);
  const ages = new Float32Array(count).fill(1);
  const kinds = new Float32Array(count);
  const velocity = new Float32Array(count * 3);
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.BufferAttribute(positions, 3).setUsage(T.DynamicDrawUsage));
  geometry.setAttribute('age', new T.BufferAttribute(ages, 1).setUsage(T.DynamicDrawUsage));
  geometry.setAttribute('kind', new T.BufferAttribute(kinds, 1).setUsage(T.DynamicDrawUsage));
  const material = new T.ShaderMaterial({
    transparent: true, depthWrite: false,
    vertexShader: `
      attribute float age,kind;
      varying float life, spray;
      void main(){
        life=1.-age; spray=kind;
        vec4 view=modelViewMatrix*vec4(position,1.);
        gl_PointSize=clamp((22.+age*155.)/max(-view.z,.3),1.,45.);
        gl_Position=projectionMatrix*view;
      }
    `,
    fragmentShader: `
      varying float life, spray;
      void main(){
        float shape=1.-smoothstep(.1,.49,length(gl_PointCoord-.5));
        gl_FragColor=vec4(mix(vec3(.36,.27,.17),vec3(.68,.73,.78),spray),shape*life*.28);
      }
    `,
  });
  const cloud = new T.Points(geometry, material);
  cloud.frustumCulled = false;
  scene.add(cloud);

  const markCount = 420;
  const vertices = new Float32Array(markCount * 18);
  const marks = new T.BufferGeometry();
  marks.setAttribute('position', new T.BufferAttribute(vertices, 3).setUsage(T.DynamicDrawUsage));
  marks.setDrawRange(0, 0);
  const strips = new T.Mesh(marks, new T.MeshBasicMaterial({
    color: 0x292523, transparent: true, opacity: .34, depthWrite: false,
    side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2,
  }));
  strips.frustumCulled = false;
  scene.add(strips);
  let slot = 0, mark = 0, produced = 0, budget = 0;

  function dust(x, z, dx, dz, side, spray) {
    const offset = slot * 3;
    const px = x - dx * 1.4 + dz * side * .78;
    const pz = z - dz * 1.4 - dx * side * .78;
    positions.set([px, worldHeight(px, pz) + .30, pz], offset);
    velocity.set([-dx + dz * side, .32 + Math.random(), -dz - dx * side], offset);
    kinds[slot] = Number(spray);
    ages[slot] = 0;
    slot = (slot + 1) % count;
  }

  function skid(x, z, dx, dz, length) {
    for (const side of [-1, 1]) {
      const px = x - dx * 1.4 + dz * side * .78;
      const pz = z - dz * 1.4 - dx * side * .78;
      const point = (forward, across) => {
        const wx = px + dx * forward + dz * across;
        const wz = pz + dz * forward - dx * across;
        return [wx, worldHeight(wx, wz) + .045, wz];
      };
      const a = point(0, -.11), b = point(0, .11);
      const c = point(length, -.11), d = point(length, .11);
      vertices.set([...a, ...b, ...c, ...b, ...d, ...c], mark * 18);
      mark = (mark + 1) % markCount;
      produced = Math.min(markCount, produced + 1);
    }
    marks.setDrawRange(0, produced * 6);
    marks.attributes.position.needsUpdate = true;
  }

  return {
    clear() {
      ages.fill(1);
      geometry.attributes.age.needsUpdate = true;
      mark = produced = budget = 0;
      marks.setDrawRange(0, 0);
    },
    update(dt, x, z, yaw, speed, paved, braking, grounded=true) {
      const spray = paved && wetness.value > .5;
      const dx = Math.sin(yaw), dz = Math.cos(yaw);
      if (grounded && Math.abs(speed) > 5 && (!paved || spray || braking)) {
        budget += dt * Math.min(32, Math.abs(speed) * 1.7);
        while (budget >= 1) {
          budget--;
          dust(x, z, dx, dz, -1, spray);
          dust(x, z, dx, dz, 1, spray);
        }
      }
      if (grounded && paved && braking && Math.abs(speed) > 8) skid(x, z, dx, dz, -speed * dt);
      for (let i = 0; i < count; i++) {
        if (ages[i] >= 1) continue;
        ages[i] += dt * (kinds[i] ? 1.36 : .65);
        const offset = i * 3;
        for (let axis = 0; axis < 3; axis++) positions[offset + axis] += velocity[offset + axis] * dt;
      }
      for (const attribute of Object.values(geometry.attributes)) attribute.needsUpdate = true;
    },
  };
}
