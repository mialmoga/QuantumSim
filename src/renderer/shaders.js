/**
 * shaders.js — Shaders GLSL del QuantumRenderer
 * ================================================
 * Fuente única de verdad para todos los shaders.
 * Importar desde QuantumRenderer.js y NucleusBuilder.js
 *
 * uLodFade — uniform compartido por orbital y esfera para transiciones LOD suaves.
 *   1.0 = completamente visible, 0.0 = invisible.
 *   El renderer hace lerp de este valor cada frame.
 */

// ── Núcleo ────────────────────────────────────────────────────────────────────
// LOD far/near/quantum: Points simples (pequeños, proporcionales al builder actual)
// LOD nuclear: reemplazados por NUCLEAR_VOL (campo ψ del AtOhmEter)

export const NUCLEUS_VERT = /* glsl */`
uniform float uTime, uType, uSize;
void main() {
    float v = (uType < 0.5) ? sin(uTime * 15.0) : cos(uTime * 12.0);
    vec4 mvP = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = uSize * (1.0 + v * 0.3) * (350.0 / -mvP.z);
    gl_Position  = projectionMatrix * mvP;
}`;

export const NUCLEUS_FRAG = /* glsl */`
uniform vec3 uColor;
void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float d = dot(uv, uv);
    if (d > 0.25) discard;
    float a = 1.0 - smoothstep(0.18, 0.25, d);
    gl_FragColor = vec4(uColor * 6.0, a);
}`;

// ── Darkshell — Esfera opaca contenedora para LOD nuclear ────────────────────
export const DARKSHELL_VERT = /* glsl */`
varying vec3 vNormal;
varying vec3 vWorldPos;
void main() {
    vNormal   = normalize(normalMatrix * normal);
    vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

export const DARKSHELL_FRAG = /* glsl */`
uniform float uDarkFade;
uniform vec3  uTintColor;
uniform vec3  uCameraPos;
varying vec3  vNormal;
varying vec3  vWorldPos;
void main() {
    vec3 viewDir = normalize(uCameraPos - vWorldPos);
    float fresnel = 1.0 - abs(dot(viewDir, vNormal));
    float edgeFade = 0.88 - fresnel * 0.25;
    vec3 col = mix(vec3(0.005, 0.008, 0.012), uTintColor * 0.04, 0.3);
    gl_FragColor = vec4(col, edgeFade * uDarkFade);
}`;

// ── LOD Nuclear — raymarching analítico con early-out ────────────────────
// Vertex: pass local position
export const NUCLEAR_VOL_VERT = /* glsl */`
varying vec3 vLocalPos;
void main() {
    vLocalPos   = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

// Fragment: FUSIÓN V2.4 + gradiente iridiscente + Laplaciano stress + space warping
export const NUCLEAR_VOL_FRAG = /* glsl */`
precision highp float;

varying vec3 vLocalPos;

uniform vec3  uLocalCamPos;
uniform float uTime;
uniform float uBoxSize;
uniform float uNuclearFade;
uniform float uOmega;

// Tunables
uniform float uConfinement;    // decay del campo (default 2.2, como V2.4)
uniform float uAlphaBase;
uniform float uDensityThresh;
uniform float uGradThresh;
uniform float uIridAlpha;
uniform float uPulseRange;

// Deformación nuclear (del JSON): 1.0 = sin deformación
uniform vec3  uNuclearScale;   // e.g. (0.88, 1.25, 0.88) para prolato

// Nucleones: xyz = posición LOCAL, w = tipo (1=protón, 0=neutrón)
uniform vec4  uNucleons[64];
uniform int   uNucleonCount;

const float CUTOFF = 2.2;
const float CUTOFF2 = 4.84;

vec2 boxIntersect(vec3 ro, vec3 rd, float bs) {
    vec3 invRd = 1.0 / rd;
    vec3 t1 = (-vec3(bs) - ro) * invRd;
    vec3 t2 = ( vec3(bs) - ro) * invRd;
    vec3 tMin = min(t1, t2);
    vec3 tMax = max(t1, t2);
    return vec2(
        max(max(tMin.x, tMin.y), tMin.z),
        min(min(tMax.x, tMax.y), tMax.z)
    );
}

// ── Space warping: deforma el punto de muestreo según geometría nuclear ──
// Cerca del centro → más deformación, lejos → se desvanece
vec3 warpPoint(vec3 p) {
    float r = length(p);
    float influence = exp(-r * r * 4.0);  // fuerte al centro, cero lejos
    vec3 scale = mix(vec3(1.0), uNuclearScale, influence);
    return p * scale;
}

// ── Campo nuclear con signo ±1, confinement tunable ──
float computeSignedField(vec3 p) {
    float field = 0.0;
    float omega = uOmega;
    for (int s = 0; s < 64; s++) {
        if (s >= uNucleonCount) break;
        vec3 delta = p - uNucleons[s].xyz;
        float d2 = dot(delta, delta);
        if (d2 > CUTOFF2) continue;
        float d = sqrt(d2);
        if (d < 0.0001) continue;
        float wave = cos(omega * 12.0 * d - uTime * omega * 3.14159)
                   * exp(-d2 * uConfinement);
        float sign = uNucleons[s].w > 0.5 ? 1.0 : -1.0;
        field += wave * sign;
    }
    return field;
}

void main() {
    if (uNucleonCount == 0 || uNuclearFade < 0.01) discard;

    vec3 rayOrigin = vLocalPos;
    vec3 rayDir    = normalize(vLocalPos - uLocalCamPos);

    vec2 tHit = boxIntersect(rayOrigin, rayDir, uBoxSize);
    float tNear = max(tHit.x, 0.0);
    float tFar  = tHit.y;
    if (tNear > tFar || tFar < 0.0) discard;

    // Adaptive steps
    int maxSteps = uNucleonCount > 16 ? 28 : (uNucleonCount > 6 ? 38 : 48);
    float baseStep = (tFar - tNear) / float(maxSteps);
    vec4 col = vec4(0.0);
    float td = tNear;
    float stepSize = baseStep;

    for (int i = 0; i < 48; i++) {
        if (td >= tFar) break;
        if (col.a >= 0.97) break;

        vec3 pRaw = rayOrigin + rayDir * (td + stepSize * 0.5);

        // ── Space warping — deformar punto de muestreo ──
        vec3 p = warpPoint(pRaw);

        // ── Campo con signo ──
        float nucField = computeSignedField(p);
        float af = abs(nucField);

        if (af > uDensityThresh) {
            stepSize = baseStep * 0.5;

            // ── Gradiente numérico (para irid + Laplaciano) ──
            float eps = uBoxSize * 0.04;
            float fX  = computeSignedField(p + vec3(eps, 0.0, 0.0));
            float fY  = computeSignedField(p + vec3(0.0, eps, 0.0));
            float fZ  = computeSignedField(p + vec3(0.0, 0.0, eps));
            vec3  grad = vec3(fX - nucField, fY - nucField, fZ - nucField);
            float gmag = length(grad);

            // ── LAPLACIANO GRATIS (de las mismas 3 muestras) ──
            // ∇²f ≈ (fX + fY + fZ - 3f) / eps²
            float laplacian = (fX + fY + fZ - 3.0 * nucField);
            float stress = abs(laplacian);

            // ── COLOR BASE por signo (V2.4) + stress del Laplaciano ──
            vec3 posCol = vec3(2.2, 0.12, 0.45);
            vec3 negCol = vec3(0.12, 1.4, 2.2);
            vec3 baseCol = mix(negCol, posCol, step(0.0, nucField));
            // Hot glow por densidad
            baseCol += vec3(3.0, 1.8, 0.3) * smoothstep(0.45, 0.88, af);
            // Stress eléctrico — Laplaciano alto = colores intensos
            vec3 stressCol = mix(
                vec3(0.0, 0.2, 1.0),   // bajo stress: azul profundo
                vec3(1.0, 0.0, 0.5),   // alto stress: magenta eléctrico
                smoothstep(0.1, 0.8, stress)
            );
            baseCol += stressCol * stress * 0.3;

            // ── Hervido por curvatura — zonas de alto stress vibran más ──
            float localPulse = (1.0 - uPulseRange) + uPulseRange * sin(uTime * (0.8 + stress * 3.0));
            float alpha = clamp((af - uDensityThresh) * uAlphaBase * localPulse * uNuclearFade, 0.0, 0.05);

            col.rgb += baseCol * alpha * (1.0 - col.a);
            col.a   += alpha * (1.0 - col.a);

            // ── IRIDISCENCIA del gradiente ──
            if (gmag > uGradThresh) {
                vec3 dir = normalize(grad);
                vec3 iridColor = abs(dir);
                iridColor *= mix(
                    vec3(0.4, 0.8, 1.2),
                    vec3(1.3, 0.6, 0.3),
                    step(0.0, nucField)
                );
                float arrowAlpha = smoothstep(uGradThresh, 0.5, gmag) * uIridAlpha * uNuclearFade;
                col.rgb += iridColor * arrowAlpha * (1.0 - col.a);
                col.a   += arrowAlpha * (1.0 - col.a);
            }

            // ── HALO en frontera de presión (Laplaciano cambia de signo) ──
            if (laplacian * nucField < 0.0) {
                float haloAlpha = 0.008 * uNuclearFade;
                vec3 haloCol = vec3(0.3, 0.6, 1.0) * 0.5;
                col.rgb += haloCol * haloAlpha * (1.0 - col.a);
                col.a   += haloAlpha * (1.0 - col.a);
            }
        } else {
            stepSize = baseStep * 1.5;
        }

        td += stepSize;
    }

    if (col.a < 0.004) discard;
    gl_FragColor = col;
}`;

// ── Orbitales ─────────────────────────────────────────────────────────────────
// aPhase bakeado por punto — parpadeo que respeta la distribución real del orbital
// uLodFade — controlado por el sistema LOD para fade in/out suave

export const ORBITAL_VERT = /* glsl */`
uniform float uTime, uScale, uLevel, uPmScale, uSpeed, uAmp, uSize, uLodFade;
uniform float uInnerRadius;
uniform float uNuclearFade;
attribute float aPhase;
varying float vBlink;
varying float vPresent;
void main() {
    vec3 wpos = position * uPmScale;
    // Hueco nuclear — descartar puntos dentro del radio mínimo
    if (length(wpos) < uInnerRadius) {
        gl_PointSize = 0.0;
        gl_Position  = projectionMatrix * modelViewMatrix * vec4(wpos, 1.0);
        vBlink   = 0.0;
        vPresent = 0.0;
        return;
    }
    float spinOffset = aPhase < 0.5 ? 0.0 : 3.14159;
    float spinPhase  = aPhase < 0.5 ? aPhase * 2.0 : (aPhase - 0.5) * 2.0;
    float raw = sin(uTime * (3.0 + uLevel) * uSpeed + spinPhase * 6.2832 + spinOffset);
    vPresent  = pow(max(0.0, raw), 2.0);
    vBlink    = vPresent * uAmp;
    // uNuclearFade: 1.0 normal, 0.0 = modo nuclear activo → puntos se apagan
    float effectiveFade = uLodFade * (1.0 - uNuclearFade);
    vec4 mvP  = modelViewMatrix * vec4(wpos, 1.0);
    gl_PointSize = uScale * uSize * (0.9 + vBlink * 4.0) / -mvP.z * effectiveFade * vPresent;
    gl_Position  = projectionMatrix * mvP;
}`;

export const ORBITAL_FRAG = /* glsl */`
uniform vec3  uColor;
uniform float uBright, uEdge, uLodFade;
uniform float uNuclearFade;
varying float vBlink;
varying float vPresent;
void main() {
    vec2  uv = gl_PointCoord - 0.5;
    float d  = dot(uv, uv);
    if (d > 0.25) discard;
    if (vPresent < 0.02) discard;
    float effectiveFade = uLodFade * (1.0 - uNuclearFade);
    float a = (1.0 - smoothstep(uEdge, 0.25, d)) * effectiveFade * vPresent;
    gl_FragColor = vec4(uColor * (uBright * (0.85 + vBlink * 0.15)), a);
}`;

// ── Esfera Fibonacci (LOD far) ────────────────────────────────────────────────
// Distribución uniforme sin clustering en polos.
// Visible cuando la cámara está lejos — fade-out al acercarse y revelar orbitales.

export const SPHERE_VERT = /* glsl */`
uniform float uTime, uScale, uLodFade, uPulse, uPmScale;
attribute float aPhase;
varying float vBlink;
void main() {
    vBlink = sin(uTime * 1.2 + aPhase * 6.2832) * 0.3;
    vec3 wpos = position * uPmScale;
    vec4 mvP  = modelViewMatrix * vec4(wpos, 1.0);
    gl_PointSize = uScale * (0.9 + vBlink * uPulse) / -mvP.z * uLodFade;
    gl_Position  = projectionMatrix * mvP;
}`;

export const SPHERE_FRAG = /* glsl */`
uniform vec3  uColor;
uniform float uLodFade;
varying float vBlink;
void main() {
    vec2  uv = gl_PointCoord - 0.5;
    float d  = dot(uv, uv);
    if (d > 0.25) discard;
    float a = (1.0 - smoothstep(0.18, 0.25, d)) * uLodFade;
    gl_FragColor = vec4(uColor * (2.5 + vBlink), a * 0.7);
}`;

// ── Interfaz de uniforms para ShaderLab ───────────────────────────────────────
// Referencia de qué uniforms debe respetar un shader compatible.
export const SHADER_INTERFACE = {
    base: [
        'uTime', 'uScale', 'uLevel', 'uPmScale',
        'uSpeed', 'uAmp', 'uSize', 'uLodFade',
        'uColor', 'uBright', 'uEdge',
        'uNuclearFade',   // 0=normal, 1=modo nuclear (puntos se apagan)
        'uStrobeBlend',   // reservado para ShaderLab — no usado en shaders base
    ],
    valenceExtra: [
        'uBondState', 'uBondProgress', 'uBondStrength',
        'uBondDir', 'uBondColor', 'uExchangePhase',
    ],
    attributes: ['aPhase'],
};

// ── Interfaz de uniforms para Bond shaders ────────────────────────────────────
// Referencia de qué uniforms debe respetar un shader de enlace compatible.
// El ShaderLab y el ML usan esto para generar bond materials compilados.
export const BOND_SHADER_INTERFACE = {
    // Uniforms geométricos — posicionamiento GPU-side del cuello
    geometry: [
        'uPosA', 'uPosB',           // vec3 — posiciones world de los dos átomos
        'uRadA', 'uRadB',           // float — radios covalentes
        'uNeckMin', 'uNeckMax',     // float — grosor mín/máx del cuello
        'uPiOff',                   // vec3 — offset para sub-bonds π
    ],
    // Uniforms visuales — apariencia y animación
    visual: [
        'uTime', 'uScale', 'uBondT', 'uAspect',
        'uColorA', 'uColorB',       // vec3 — colores de los dos átomos
    ],
    // Uniforms LCAO — coeficientes de orbitales moleculares
    // Solo presentes cuando MoleculeFactory inyecta datos de LCAO.json
    lcao: [
        'uCoeffA', 'uCoeffB',       // float — coeficientes normalizados del MO σ
        'uAntibonding',              // float — 0.0 bonding, 1.0 antibonding
    ],
    // Atributos por vértice (geometría estática prebakeada)
    attributes: ['aPhase', 'aT'],
};

// ── Shaders por capa — base para el ShaderLab ─────────────────────────────────
//
// Cada capa tiene su propia personalidad visual:
//   CORE    — casi estático, muy tenue, puntitos pequeños
//   SEMI    — turbulencia leve, más presencia, colores vivos
//   VALENCE — reactivo, incluye todos los uniforms de enlace
//
// El ShaderLab usa estos como punto de partida para diseñar variaciones.
// El usuario puede empezar desde cualquiera y modificarlo con nodos.

// ── Base vertex compartido (core y otros layers simples) ──────────────────────
export const BASE_VERT = /* glsl */`
uniform float uTime, uScale, uLevel, uPmScale, uSpeed, uAmp, uSize, uLodFade;
uniform float uInnerRadius;
uniform float uNuclearFade;
attribute float aPhase;
varying float vBlink;
varying float vPresent;

void main() {
    vec3 wpos = position * uPmScale;
    if (length(wpos) < uInnerRadius) {
        gl_PointSize = 0.0;
        gl_Position  = projectionMatrix * modelViewMatrix * vec4(wpos, 1.0);
        vBlink = 0.0; vPresent = 0.0;
        return;
    }
    float spinPhase  = aPhase < 0.5 ? aPhase * 2.0 : (aPhase - 0.5) * 2.0;
    float spinOffset = aPhase < 0.5 ? 0.0 : 3.14159;
    float raw = sin(uTime * (3.0 + uLevel) * uSpeed + spinPhase * 6.2832 + spinOffset);
    vPresent  = pow(max(0.0, raw), 2.0);
    vBlink    = vPresent * uAmp;
    float effectiveFade = uLodFade * (1.0 - uNuclearFade);
    vec4 mvP  = modelViewMatrix * vec4(wpos, 1.0);
    gl_PointSize = uScale * uSize * (0.9 + vBlink) / -mvP.z * effectiveFade * vPresent;
    gl_Position  = projectionMatrix * mvP;
}`;

// ── Core: casi estático, muy tenue, costo mínimo ──────────────────────────────
export const CORE_FRAG = /* glsl */`
uniform vec3  uColor;
uniform float uBright, uEdge, uLodFade;
varying float vBlink;
varying float vPresent;

void main() {
    vec2  uv = gl_PointCoord - 0.5;
    float d  = dot(uv, uv);
    if (d > 0.25) discard;
    // El punto desaparece completamente cuando vPresent = 0
    if (vPresent < 0.02) discard;
    float a = (1.0 - smoothstep(uEdge, 0.25, d)) * uLodFade * vPresent;
    gl_FragColor = vec4(uColor * uBright * 0.6, a * 0.45);
}`;

// ── Semi: turbulencia leve, más presencia ────────────────────────────────────
export const SEMI_VERT = /* glsl */`
uniform float uTime, uScale, uLevel, uPmScale, uSpeed, uAmp, uSize, uLodFade;
uniform float uTurbFreq, uTurbAmp;
uniform float uInnerRadius;
uniform float uNuclearFade;
attribute float aPhase;
varying float vBlink;
varying float vPresent;

void main() {
    vec3 wpos = position * uPmScale;
    if (length(wpos) < uInnerRadius) {
        gl_PointSize = 0.0;
        gl_Position  = projectionMatrix * modelViewMatrix * vec4(wpos, 1.0);
        vBlink = 0.0; vPresent = 0.0;
        return;
    }
    float spinOffset = aPhase < 0.5 ? 0.0 : 3.14159;
    float spinPhase  = aPhase < 0.5 ? aPhase * 2.0 : (aPhase - 0.5) * 2.0;
    float raw = sin(uTime * (3.0 + uLevel) * uSpeed + spinPhase * 6.2832 + spinOffset);
    vPresent  = pow(max(0.0, raw), 2.0);
    vBlink    = vPresent * uAmp;
    float tb = sin(position.x * uTurbFreq + uTime * 1.8)
             * sin(position.y * uTurbFreq + uTime * 1.26) * uTurbAmp * vPresent;
    wpos += vec3(tb, tb * 0.6, tb * 0.4) * uPmScale;
    float effectiveFade = uLodFade * (1.0 - uNuclearFade);
    vec4 mvP = modelViewMatrix * vec4(wpos, 1.0);
    gl_PointSize = uScale * uSize * (0.9 + vBlink) / -mvP.z * effectiveFade * vPresent;
    gl_Position  = projectionMatrix * mvP;
}`;

export const SEMI_FRAG = /* glsl */`
uniform vec3  uColor;
uniform float uBright, uEdge, uLodFade;
varying float vBlink;
varying float vPresent;

void main() {
    vec2  uv = gl_PointCoord - 0.5;
    float d  = dot(uv, uv);
    if (d > 0.25) discard;
    if (vPresent < 0.02) discard;
    float a = (1.0 - smoothstep(uEdge, 0.25, d)) * uLodFade * vPresent;
    gl_FragColor = vec4(uColor * uBright * (0.8 + vBlink * 0.2), a * 0.75);
}`;

// ── Valence: reactivo, incluye uniforms de enlace ────────────────────────────
// Este es el shader más completo — base ideal para diseño en el ShaderLab.
// Los uniforms uBond* solo se activan cuando el átomo está en modo 'quantum'.
export const VALENCE_VERT = /* glsl */`
uniform float uTime, uScale, uLevel, uPmScale, uSpeed, uAmp, uSize, uLodFade;
uniform float uInnerRadius;
uniform float uNuclearFade;
uniform int   uBondState;
uniform float uBondProgress, uBondStrength, uExchangePhase;
uniform vec3  uBondDir;
attribute float aPhase;
varying float vBlink;
varying float vPresent;
varying float vBondInfluence;

void main() {
    vec3 wpos = position * uPmScale;
    if (length(wpos) < uInnerRadius) {
        gl_PointSize = 0.0;
        gl_Position  = projectionMatrix * modelViewMatrix * vec4(wpos, 1.0);
        vBlink = 0.0; vPresent = 0.0; vBondInfluence = 0.0;
        return;
    }
    float spinOffset = aPhase < 0.5 ? 0.0 : 3.14159;
    float spinPhase  = aPhase < 0.5 ? aPhase * 2.0 : (aPhase - 0.5) * 2.0;
    float raw = sin(uTime * (3.0 + uLevel) * uSpeed + spinPhase * 6.2832 + spinOffset);
    vPresent  = pow(max(0.0, raw), 2.0);
    vBlink    = vPresent * uAmp;

    if (uBondState == 1) {
        float align = max(0.0, dot(normalize(wpos), uBondDir));
        wpos += uBondDir * align * uBondStrength * uBondProgress * 0.35;
        vBondInfluence = align * uBondProgress;
    } else if (uBondState == 2) {
        float repel = sin(uTime * 12.0 + aPhase * 3.14) * uBondStrength * 0.2;
        float align = max(0.0, dot(normalize(wpos), uBondDir));
        wpos -= uBondDir * align * repel * uBondProgress;
        vBondInfluence = align * 0.5;
    } else if (uBondState == 3) {
        float align = max(0.0, dot(normalize(wpos), uBondDir));
        float wave  = sin(uExchangePhase * 6.2832 + aPhase * 6.2832) * 0.5 + 0.5;
        wpos += uBondDir * align * wave * uBondStrength * 0.45;
        vBondInfluence = wave * align;
    } else {
        vBondInfluence = 0.0;
    }

    float presence = uBondState == 3 ? max(vPresent, vBondInfluence) : vPresent;
    float effectiveFade = uLodFade * (1.0 - uNuclearFade);
    vec4 mvP = modelViewMatrix * vec4(wpos, 1.0);
    gl_PointSize = uScale * uSize * (0.9 + vBlink + vBondInfluence * 0.4) / -mvP.z * effectiveFade * presence;
    gl_Position  = projectionMatrix * mvP;
}`;

export const VALENCE_FRAG = /* glsl */`
uniform vec3  uColor, uBondColor;
uniform float uBright, uEdge, uLodFade;
uniform float uBondProgress, uBondStrength;
uniform int   uBondState;
varying float vBlink;
varying float vPresent;
varying float vBondInfluence;

void main() {
    vec2  uv = gl_PointCoord - 0.5;
    float d  = dot(uv, uv);
    if (d > 0.25) discard;

    // Desaparecer completamente — el electrón no está aquí ahora
    float presence = uBondState == 3
        ? max(vPresent, vBondInfluence)
        : vPresent;
    if (presence < 0.02) discard;

    float a = (1.0 - smoothstep(uEdge, 0.25, d)) * uLodFade * presence;

    vec3 col = uColor;

    if (uBondState == 1) {
        col = mix(uColor, uBondColor, vBondInfluence * 0.5);
    } else if (uBondState == 2) {
        col = mix(uColor, vec3(0.8, 0.9, 1.0), vBondInfluence * 0.4);
    } else if (uBondState == 3) {
        col = mix(uColor, uBondColor, vBondInfluence * 0.7);
        a  *= 1.0 + vBondInfluence * 0.5;
    }

    float brightness = uBright * (0.85 + vBlink * 0.15 + vBondInfluence * 0.3);
    gl_FragColor = vec4(col * brightness, a);
}`;

// ── Molecular Orbital — replica VALENCE shader con gradiente A→B ─────────────
// Mismo comportamiento que el orbital de Valencia original.
// uColorA = color del orbital de Valencia del átomo A
// uColorB = color del orbital de Valencia del átomo B
// aPhase codifica posición 0→1 a lo largo del eje A→B del bond

export const MO_VERT = /* glsl */`
uniform float uTime, uScale, uLevel, uPmScale, uSpeed, uAmp, uSize, uLodFade;
uniform float uNuclearFade;
attribute float aPhase;
varying float vBlink;
varying float vPresent;
varying float vT;

void main() {
    vT = aPhase;  // 0=extremo A, 1=extremo B — para gradiente de color
    vec3 wpos = position * uPmScale;

    float spinOffset = aPhase < 0.5 ? 0.0 : 3.14159;
    float spinPhase  = aPhase < 0.5 ? aPhase * 2.0 : (aPhase - 0.5) * 2.0;
    float raw = sin(uTime * (3.0 + uLevel) * uSpeed + spinPhase * 6.2832 + spinOffset);
    vPresent  = pow(max(0.0, raw), 2.0);
    vBlink    = vPresent * uAmp;

    float effectiveFade = uLodFade * (1.0 - uNuclearFade);
    vec4 mvP = modelViewMatrix * vec4(wpos, 1.0);
    gl_PointSize = uScale * uSize * (0.9 + vBlink) / -mvP.z * effectiveFade * vPresent;
    gl_Position  = projectionMatrix * mvP;
}`;

export const MO_FRAG = /* glsl */`
uniform vec3  uColorA, uColorB;
uniform float uBright, uEdge, uLodFade;
varying float vBlink;
varying float vPresent;
varying float vT;

void main() {
    vec2  uv = gl_PointCoord - 0.5;
    float d  = dot(uv, uv);
    if (d > 0.25) discard;

    if (vPresent < 0.02) discard;

    float a   = (1.0 - smoothstep(uEdge, 0.25, d)) * uLodFade * vPresent;
    vec3  col = mix(uColorA, uColorB, vT);  // gradiente A→B
    float brightness = uBright * (0.85 + vBlink * 0.15);
    gl_FragColor = vec4(col * brightness, a);
}`;
