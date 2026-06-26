/**
 * compiler.js — Compilador de pipeline custom
 *
 * Contrato de variables del bus (declaradas UNA VEZ en el template):
 *   VERT: vBlink (float), vPhase (float), wpos (vec3), mvP (vec4)
 *   FRAG: col (vec3), alpha (float), d (float)
 *
 * Los nodos solo MODIFICAN estas variables — nunca las redeclaran.
 * Las plantillas de nodo usan {{param}} como token de sustitución.
 *
 * SH_CURRENT: fuente de verdad = QuantumRenderer.js
 *   — No hardcodeamos aquí, importamos las constantes del renderer.
 *   — Si el renderer cambia sus shaders, el ShaderLab refleja el cambio.
 */

// Fuente única de verdad — todos los shaders viven en shaders.js,
// el renderer los re-exporta y el compiler los consume desde ahí.
import {
    BASE_VERT, CORE_FRAG,
    SEMI_VERT, SEMI_FRAG,
    VALENCE_VERT, VALENCE_FRAG,
    SPHERE_VERT, SPHERE_FRAG,
    NUCLEUS_VERT, NUCLEUS_FRAG,
    SHADER_INTERFACE,
} from '../../src/renderer/QuantumRenderer.js';

// Re-exportar SHADER_INTERFACE para que ui.js lo consuma
export { SHADER_INTERFACE };

export const SH_CURRENT = {
  // 'current' orbital → shader de valencia del renderer (el más completo)
  // Incluye todos los uniforms de enlace — ideal para diseñar shaders reactivos
  orbital: {
    vert: VALENCE_VERT,
    frag: VALENCE_FRAG,
  },
  // Para diseñar shaders de capas internas
  orbital_core: {
    vert: BASE_VERT,
    frag: CORE_FRAG,
  },
  orbital_semi: {
    vert: SEMI_VERT,
    frag: SEMI_FRAG,
  },
  sphere: {
    // Referencia las constantes importadas — fuente de verdad única
    vert: SPHERE_VERT,
    frag: SPHERE_FRAG,
  },
};

// Re-exportar shaders del renderer para que ui.js pueda mostrarlos en modo current
export { BASE_VERT, CORE_FRAG, SEMI_VERT, SEMI_FRAG, VALENCE_VERT, VALENCE_FRAG, SPHERE_VERT, SPHERE_FRAG };

// Pipeline minimal — punto de partida para reset
// Orden: point_size (vert) → disc_shape (frag) → brightness (frag)
export const PIPELINE_MINIMAL = ['point_size', 'disc_shape', 'brightness'];

/**
 * Sustituye {{token}} por el valor formateado del parámetro.
 * Garantiza que los floats GLSL siempre tengan punto decimal.
 */
function subst(template, params) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const v = params[key];
    if (v === undefined) return '0.0';
    const n = Number(v);
    if (Number.isInteger(n)) return n.toFixed(1);
    // Mantener suficiente precisión
    return n.toFixed(Math.abs(n) < 0.01 ? 4 : Math.abs(n) < 0.1 ? 3 : 2);
  });
}

/**
 * Compila el pipeline de nodos en un par vert/frag GLSL válido.
 * @param {Array}  pipeline - [{id, def, params, enabled, custom?}]
 * @param {string} target   - 'orbital' | 'sphere'
 */
/**
 * validatePipeline — analiza dependencias nodo a nodo.
 * Devuelve el pipeline anotado con { active: bool, reason: string|null }
 * por cada nodo. Los nodos inactivos son saltados en compilePipeline.
 *
 * Reglas:
 *  - Un nodo disabled siempre → active:false
 *  - Un nodo enabled cuyos requires NO están en el set satisfied → active:false, reason='falta X'
 *  - Un nodo enabled con requires satisfechos → active:true, agrega sus provides al set
 *
 * @param {Array} pipeline — nodos del APP.pipeline
 * @returns {Array} — mismos nodos con .active y .reason añadidos
 */
export function validatePipeline(pipeline) {
  // Set de tokens disponibles — el bus siempre provee estos desde el shader base
  const satisfied = new Set(['vPhase', 'vBlink', 'uTime', 'uColor']);

  return pipeline.map(node => {
    if (!node.enabled || !node.def) {
      return { ...node, active: false, reason: null };
    }

    const requires = node.def.requires ?? [];
    const missing  = requires.filter(r => !satisfied.has(r));

    if (missing.length > 0) {
      return {
        ...node,
        active: false,
        reason: `Necesita: ${missing.join(', ')}`,
      };
    }

    // Nodo activo — agregar sus provides al set para los siguientes
    for (const p of (node.def.provides ?? [])) satisfied.add(p);
    // También agregar el propio key para que otros puedan depender de él por nombre
    satisfied.add(node.key);

    return { ...node, active: true, reason: null };
  });
}

export function compilePipeline(pipeline, target = 'orbital') {
  // Validar dependencias — solo los nodos active:true entran al shader
  const validated = validatePipeline(pipeline);
  const enabled   = validated.filter(n => n.active && n.def);

  // Filtrar por target — los nodos que no son para este target se saltan
  const applicable = enabled.filter(n => {
    if (!n.def.target) return true;
    return n.def.target.includes(target);
  });

  const vertNodes = applicable.filter(n => n.def.stage === 'vert');
  const fragNodes = applicable.filter(n => n.def.stage === 'frag');

  // Nodos custom tienen su propio GLSL raw (sin template)
  const vertBody = vertNodes.map(n =>
    n.custom ? n.customGlsl || '' : subst(n.def.glsl, n.params)
  ).join('\n  ');

  const fragBody = fragNodes.map(n =>
    n.custom ? n.customGlsl || '' : subst(n.def.glsl, n.params)
  ).join('\n  ');

  if (target === 'sphere') {
    // Bus idéntico al orbital — mismos varying/uniform para que todos
    // los nodos del pipeline funcionen igual en sphere y orbital.
    // aPhase = latitud Fibonacci (0 polo sur → 1 polo norte)
    const vert = `// ShaderLab Custom — Sphere
uniform float uTime,uScale,uLevel,uPmScale,uSpeed,uAmp,uSize;
uniform float uLodFade, uAspect;
attribute float aPhase;
varying float vBlink;
varying float vPhase;
void main(){
  vBlink=0.0;
  vPhase=aPhase;
  vec3 wpos=position*uPmScale;
  vec4 mvP=modelViewMatrix*vec4(wpos,1.0);
  gl_PointSize=0.0;
  ${vertBody}
  if(gl_PointSize<=0.0)
    gl_PointSize=uScale*uSize*(1.0+vBlink*uAmp*3.0)/-mvP.z;
  gl_PointSize*=uLodFade;
  gl_Position=projectionMatrix*mvP;
}`;
    const frag = `// ShaderLab Custom — Sphere
uniform vec3  uColor;
uniform float uBright,uEdge;
uniform float uLodFade;
varying float vBlink;
varying float vPhase;
void main(){
  vec3  col=uColor*uBright;
  float alpha=1.0;
  float d=0.0;
  {vec2 _uv=gl_PointCoord-0.5;d=dot(_uv,_uv);if(d>0.25)discard;alpha=1.0-smoothstep(uEdge,0.25,d);}
  ${fragBody}
  if(alpha<=0.0)discard;
  gl_FragColor=vec4(col,clamp(alpha,0.0,1.0)*uLodFade);
}`;
    return { vert, frag };
  }

  if (target === 'bond') {
    // Bus para bond shaders — GPU-side positioning incluido como boilerplate.
    // Nodos custom modifican: neckProfile (perfil del cuello), vAlpha, gl_PointSize.
    // El VERT_HEADER calcula wpos en world space — los nodos lo reciben ya posicionado.
    //
    // Bus variables disponibles para nodos:
    //   t         — float 0→1 posición a lo largo del eje del enlace
    //   neckR     — float perfil del cuello (sin(πt) por defecto)
    //   wpos      — vec3 posición world del punto (ya calculada)
    //   vAlpha    — float opacidad del punto
    //   vNeckR    — varying para fragment
    //   uCoeffA/B — float coeficientes LCAO (0.7071 por defecto)
    const vert = `// ShaderLab Custom — Bond
uniform vec3  uPosA, uPosB;
uniform float uRadA, uRadB, uNeckMin, uNeckMax;
uniform float uTime, uScale, uBondT, uAspect;
uniform vec3  uPiOff;
uniform float uCoeffA, uCoeffB, uAntibonding;
attribute float aPhase, aT;
varying float vT, vAlpha, vNeckR;
void main(){
  float t=position.z;
  vT=t;
  vec3 axis=uPosB-uPosA;
  float dist=length(axis);
  axis=dist>0.001?axis/dist:vec3(0.0,1.0,0.0);
  vec3 up=abs(axis.y)<0.9?vec3(0.0,1.0,0.0):vec3(1.0,0.0,0.0);
  vec3 tang=normalize(cross(axis,up));
  vec3 bin=cross(axis,tang);
  float scl=(uRadA+uRadB)>dist*0.92?(dist*0.92)/(uRadA+uRadB):1.0;
  vec3 startP=uPosA+axis*uRadA*scl;
  float bondLen=max(dist-(uRadA+uRadB)*scl,1.0);
  // Perfil cacahuate por defecto — nodos pueden reemplazar neckProfile
  float sp=pow(sin(3.14159*t),0.35);
  float neckProfile=1.0-sp*sp;
  vNeckR=sin(3.14159*t);
  vAlpha=1.0;
  ${vertBody}
  float r=uNeckMin+(uNeckMax-uNeckMin)*neckProfile;
  float ang=aPhase+uTime*0.25;
  vec3 wpos=startP+axis*bondLen*t+tang*cos(ang)*r+bin*sin(ang)*r+uPiOff;
  vec4 mvP=modelViewMatrix*vec4(wpos,1.0);
  if(gl_PointSize<=0.0)
    gl_PointSize=uScale*0.22*vNeckR*(0.7+vAlpha*0.3)*uAspect/-mvP.z;
  gl_Position=projectionMatrix*mvP;
}`;
    const frag = `// ShaderLab Custom — Bond
uniform vec3  uColorA, uColorB;
uniform float uBondT;
uniform float uCoeffA, uCoeffB, uAntibonding;
varying float vT, vAlpha, vNeckR;
void main(){
  vec2  uv=gl_PointCoord-0.5;
  float d=dot(uv,uv);
  if(d>0.25)discard;
  float s=1.0-smoothstep(0.06,0.25,d);
  vec3 col=mix(uColorA,uColorB,vT);
  float alpha=s*vAlpha*uBondT;
  ${fragBody}
  if(alpha<=0.0)discard;
  gl_FragColor=vec4(col,clamp(alpha,0.0,1.0));
}`;
    return { vert, frag };
  }

  // Orbital mode — bus completo
  const vert = `// ShaderLab Custom — Orbital
uniform float uTime,uScale,uLevel,uPmScale,uSpeed,uAmp,uSize;
uniform float uLodFade, uAspect;
attribute float aPhase;
varying float vBlink;
varying float vPhase;
void main(){
  vBlink=0.0;
  vPhase=aPhase;
  vec3 wpos=position*uPmScale;
  vec4 mvP=modelViewMatrix*vec4(wpos,1.0);
  gl_PointSize=0.0;
  ${vertBody}
  if(gl_PointSize<=0.0)
    gl_PointSize=uScale*uSize*(1.1+vBlink*4.0)*350.0/-mvP.z;
  gl_PointSize*=uLodFade;
  gl_Position=projectionMatrix*mvP;
}`;

  const frag = `// ShaderLab Custom — Orbital
uniform vec3 uColor;
uniform float uBright,uEdge;
uniform float uLodFade;
varying float vBlink;
varying float vPhase;
void main(){
  vec3  col=uColor*uBright;
  float alpha=1.0;
  float d=0.0;
  // Disc base — siempre activo como fallback
  {vec2 _uv=gl_PointCoord-0.5;d=dot(_uv,_uv);if(d>0.25)discard;alpha=1.0-smoothstep(uEdge,0.25,d);}
  ${fragBody}
  if(alpha<=0.0)discard;
  gl_FragColor=vec4(col,clamp(alpha,0.0,1.0)*uLodFade);
}`;

  return { vert, frag };
}

/**
 * Genera los uniforms por defecto para un ShaderMaterial.
 * @param {THREE.Color|number} color
 */
/**
 * Genera el set completo de uniforms compatible con QuantumRenderer v2.
 * Incluye los uniforms de enlace para que los shaders de valence funcionen
 * sin errores en el preview aunque no haya BondReactor activo.
 *
 * @param {THREE.Color|number} color
 * @param {THREE.constructor}  THREE
 * @param {string}  [layer='valence']  — 'core'|'semi'|'valence' ajusta defaults
 */
export function makeUniforms(color, THREE, layer = 'valence') {
  const c = color instanceof THREE.Color ? color : new THREE.Color(color);

  // Defaults por capa — mismos que QuantumRenderer._buildOrbitalMat
  const layerDefaults = {
    core:    { speed: 0.3,  amp: 0.04, size: 0.5,  bright: 1.0, edge: 0.20 },
    semi:    { speed: 0.6,  amp: 0.12, size: 0.8,  bright: 2.0, edge: 0.17 },
    valence: { speed: 0.9,  amp: 0.18, size: 0.9,  bright: 3.0, edge: 0.14 },
  };
  const d = layerDefaults[layer] ?? layerDefaults.valence;

  const base = {
    uTime:    { value: 0 },
    uScale:   { value: 3000 * Math.min(devicePixelRatio, 2) * 0.03 },
    uLevel:   { value: 2.0 },
    uPmScale: { value: 1.0 },
    uSpeed:   { value: d.speed },
    uAmp:     { value: d.amp },
    uSize:    { value: d.size },
    uColor:   { value: c },
    uBright:  { value: d.bright },
    uEdge:    { value: d.edge },
    uLodFade: { value: 1.0 },    // siempre visible en preview
    uAspect:  { value: 1.0 },    // aspect ratio — actualizado en resize para que point_size sea consistente
    // Semi: turbulencia
    uTurbFreq: { value: 0.005 },
    uTurbAmp:  { value: 1.5 },
  };

  // Uniforms de enlace — presentes en todos los materiales del preview
  // para que el shader de valence compile sin errores aunque no haya bond activo.
  // Controlables con preview.setBondState()
  const bondUniforms = {
    uBondState:     { value: 0 },
    uBondProgress:  { value: 0.0 },
    uBondStrength:  { value: 0.0 },
    uBondDir:       { value: new THREE.Vector3(1, 0, 0) },
    uBondColor:     { value: new THREE.Color(0xffffff) },
    uExchangePhase: { value: 0.0 },
  };

  return { ...base, ...bondUniforms };
}
