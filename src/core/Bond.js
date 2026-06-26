/**
 * Bond.js v3 — Química dinámica: bond_progress + Morse + ruptura gradual
 *
 * CAMBIOS vs v2:
 *   1. bond_progress (float 0→1): todos los enlaces nacen en 0 y animan a 1.
 *      La ruptura es gradual (targetProgress = 0) en vez de instantánea.
 *      uBondT *= progress → visual/audio emergente sin cambios de shader.
 *
 *   2. Potencial de Morse reemplaza spring armónico en applyForces():
 *      V(r) = De·(1 - e^(-a·(r-re)))²
 *      F(r) = 2·De·a·(1 - e^(-a·(r-re)))·e^(-a·(r-re))
 *      De_game = stiffness / (2·a²) → misma rigidez cerca del equilibrio,
 *      disociación natural a distancia (sin ruptura abrupta por threshold).
 *
 *   3. _breakBond() ahora setea targetProgress = 0 en vez de broken = true.
 *      El enlace muere visualmente primero, se elimina cuando progress < 0.01.
 *
 * INTEGRACIÓN World.js:
 *   En el loop de física, añadir:  bond.tick(dt)
 *   ADEMÁS de:                     bond.applyForces()
 *   El tick() maneja progress y detecta muerte real del enlace.
 *
 * Tipos de enlace:
 *   'covalent'  → cacahuate clásico, densidad compartida
 *   'ionic'     → asimétrico, cargado hacia anión
 *   'metallic'  → nube difusa, electrones viajeros
 *   'vdw'       → tenue, fuerzas de dispersión (sin Morse, solo visual)
 */

import * as THREE from 'three';

// ── Helpers ────────────────────────────────────────────────────────────────

function _valenceRadius(atom) {
    const vdw = atom.elementData?.atomic_structure?.vanderwaals_radius_pm;
    if (vdw && vdw > 0) return vdw;
    return (atom.radius ?? 80) * 2.5;
}

// ── Parámetros de Morse por tipo de enlace ─────────────────────────────────
// a: pm⁻¹ — curvatura del pozo. Más alto = enlace más rígido y corto alcance.
// De_game se calcula desde stiffness para preservar rigidez cerca del equilibrio.
// Ruptura natural: fuerza → 0 cuando r > re + 3/a (no hay threshold abrupto).
//
// Valores derivados de datos reales (NIST Morse parameters) escalados a pm⁻¹:
//   covalent  ≈ C-C:  a=0.0193 pm⁻¹  (re~154pm, ruptura natural ~re+155pm)
//   ionic     ≈ NaCl: a=0.0130 pm⁻¹  (más suave, largo alcance)
//   metallic  ≈ Fe:   a=0.0090 pm⁻¹  (muy suave, electrones deslocalizados)

const MORSE_A = {
    covalent: 0.0193,
    ionic:    0.0130,
    metallic: 0.0090,
    vdw:      0.0060,  // no se usa en física, solo referencia
};

// Umbral de ruptura: cuando la fuerza Morse es < 2% del máximo.
// Para Morse: F_max está en r = re + ln(2)/a. F→0 asintóticamente.
// Usamos progress para la transición visual; aquí solo para triggear targetProgress=0.
// Equivale a r > re + 4/a aproximadamente (fuerza ~1.8% del máximo).
const MORSE_RUPTURE_FACTOR = 4; // múltiplo de (1/a) sobre el equilibrio

// ── Geometría ESTÁTICA prebakeada ──────────────────────────────────────────
// (sin cambios vs v2 — el cacahuate es correcto)

const BOND_NECK_PTS   = 800;
const BOND_NECK_RINGS = 20;

let _bondGeoCache = null;
function _getSharedGeo() {
    if (_bondGeoCache) return _bondGeoCache;

    const pos   = new Float32Array(BOND_NECK_PTS * 3);
    const phase = new Float32Array(BOND_NECK_PTS);
    const tArr  = new Float32Array(BOND_NECK_PTS);
    const PR    = Math.floor(BOND_NECK_PTS / BOND_NECK_RINGS);

    for (let r = 0; r < BOND_NECK_RINGS; r++) {
        const tr = (r + 0.5) / BOND_NECK_RINGS;
        for (let p = 0; p < PR; p++) {
            const i = r * PR + p;
            if (i >= BOND_NECK_PTS) break;

            const ang = (p / PR) * Math.PI * 2 + (Math.random() - 0.5) * 0.3;
            const t   = Math.max(0.01, Math.min(0.99,
                        tr + (Math.random() - 0.5) * 0.8 / BOND_NECK_RINGS));

            pos[i * 3]     = Math.cos(ang);
            pos[i * 3 + 1] = Math.sin(ang);
            pos[i * 3 + 2] = t;

            phase[i] = ang;
            tArr[i]  = t;
        }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aPhase',   new THREE.BufferAttribute(phase, 1));
    geo.setAttribute('aT',       new THREE.BufferAttribute(tArr, 1));

    _bondGeoCache = geo;
    return geo;
}

// ── Vertex Shader Común — GPU-side positioning ────────────────────────────
// (sin cambios — uBondT ya lleva el valor combinado bondStrength * progress)

const VERT_HEADER = /* glsl */`
    uniform vec3  uPosA, uPosB;
    uniform float uRadA, uRadB, uNeckMin, uNeckMax;
    uniform float uTime, uScale, uBondT, uAspect;
    uniform vec3  uPiOff;
    attribute float aPhase, aT;
    varying float vT, vAlpha, vNeckR;

    void main() {
        float t = position.z;
        vT = t;

        vec3 axis = uPosB - uPosA;
        float dist = length(axis);
        axis = dist > 0.001 ? axis / dist : vec3(0.0, 1.0, 0.0);
        vec3 up   = abs(axis.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
        vec3 tang = normalize(cross(axis, up));
        vec3 bin  = cross(axis, tang);

        float scl = (uRadA + uRadB) > dist * 0.92 ? (dist * 0.92) / (uRadA + uRadB) : 1.0;
        vec3 startP = uPosA + axis * uRadA * scl;
        float bondLen = max(dist - (uRadA + uRadB) * scl, 1.0);

        float sp = pow(sin(3.14159 * t), 0.35);
        float neckProfile = 1.0 - sp * sp;
        vNeckR = sin(3.14159 * t);
        float r = uNeckMin + (uNeckMax - uNeckMin) * neckProfile;

        float ang = aPhase + uTime * 0.25;
        float tx = cos(ang) * r;
        float ty = sin(ang) * r;

        vec3 wpos = startP
                  + axis * bondLen * t
                  + tang * tx
                  + bin  * ty
                  + uPiOff;
`;

// ── Shaders por tipo ──────────────────────────────────────────────────────
// (sin cambios — uBondT ya soporta valores < 1 para fade)

const VERT_COVALENT = VERT_HEADER + /* glsl */`
        float b = sin(uTime * 2.2 + aPhase * 6.28) * 0.4 + 0.6;
        vAlpha = b;
        vec4 mvP = modelViewMatrix * vec4(wpos, 1.0);
        gl_PointSize = uScale * 0.22 * vNeckR * (0.7 + b * 0.3) * uAspect / -mvP.z;
        gl_Position = projectionMatrix * mvP;
    }
`;
const FRAG_COVALENT = /* glsl */`
    uniform vec3  uColorA, uColorB;
    uniform float uBondT;
    varying float vT, vAlpha, vNeckR;
    void main() {
        vec2  uv = gl_PointCoord - 0.5;
        float d  = dot(uv, uv);
        if (d > 0.25) discard;
        float s   = 1.0 - smoothstep(0.06, 0.25, d);
        vec3  col = mix(uColorA, uColorB, vT);
        col = mix(col, vec3(0.6, 0.85, 1.0), vNeckR * uBondT * 0.25);
        gl_FragColor = vec4(col, s * vAlpha * uBondT * 0.85);
    }
`;

const VERT_METALLIC = VERT_HEADER + /* glsl */`
        vNeckR = 0.5;
        float travel = mod(aT + uTime * (0.3 + aPhase * 0.024), 1.0);
        float b = sin(uTime * 4.0 + aPhase * 6.28) * 0.5 + 0.5;
        vAlpha = b * smoothstep(0.0, 0.1, travel) * smoothstep(1.0, 0.9, travel);
        vec4 mvP = modelViewMatrix * vec4(wpos, 1.0);
        gl_PointSize = uScale * 0.14 * (0.5 + b * 0.5) * uAspect / -mvP.z;
        gl_Position = projectionMatrix * mvP;
    }
`;
const FRAG_METALLIC = /* glsl */`
    uniform vec3  uColorA, uColorB;
    uniform float uBondT;
    varying float vT, vAlpha, vNeckR;
    void main() {
        vec2  uv = gl_PointCoord - 0.5;
        float d  = dot(uv, uv);
        if (d > 0.25) discard;
        float s  = 1.0 - smoothstep(0.0, 0.25, d);
        vec3 col = mix(uColorA, uColorB, vT);
        col = mix(col, vec3(0.9, 0.95, 1.0), 0.4 * uBondT);
        gl_FragColor = vec4(col, s * vAlpha * uBondT * 0.6);
    }
`;

const VERT_IONIC = VERT_HEADER + /* glsl */`
        vNeckR = sin(3.14159 * aT * 0.7 + 0.3);
        float b = sin(uTime * 1.8 + aPhase * 6.28) * 0.35 + 0.65;
        vAlpha = b;
        vec4 mvP = modelViewMatrix * vec4(wpos, 1.0);
        gl_PointSize = uScale * 0.18 * vNeckR * (0.6 + b * 0.4) * uAspect / -mvP.z;
        gl_Position = projectionMatrix * mvP;
    }
`;
const FRAG_IONIC = /* glsl */`
    uniform vec3  uColorA, uColorB;
    uniform float uBondT;
    varying float vT, vAlpha, vNeckR;
    void main() {
        vec2  uv = gl_PointCoord - 0.5;
        float d  = dot(uv, uv);
        if (d > 0.25) discard;
        float s  = 1.0 - smoothstep(0.04, 0.25, d);
        vec3 col = mix(uColorA, uColorB, vT * vT);
        col = mix(col, vec3(1.0, 0.95, 0.7), (1.0 - vT) * 0.2 * uBondT);
        gl_FragColor = vec4(col, s * vAlpha * uBondT * 0.80);
    }
`;

const VERT_VDW = VERT_HEADER + /* glsl */`
        float b = sin(uTime * 1.2 + aPhase * 6.28) * 0.3 + 0.4;
        vAlpha = b;
        vec4 mvP = modelViewMatrix * vec4(wpos, 1.0);
        gl_PointSize = uScale * 0.10 * (0.5 + b * 0.5) * uAspect / -mvP.z;
        gl_Position = projectionMatrix * mvP;
    }
`;
const FRAG_VDW = /* glsl */`
    uniform vec3  uColorA, uColorB;
    uniform float uBondT;
    varying float vT, vAlpha, vNeckR;
    void main() {
        vec2  uv = gl_PointCoord - 0.5;
        if (dot(uv,uv) > 0.25) discard;
        float s  = 1.0 - smoothstep(0.0, 0.25, dot(uv,uv));
        vec3 col = mix(uColorA, uColorB, vT);
        gl_FragColor = vec4(col, s * vAlpha * uBondT * 0.30);
    }
`;

const BOND_SHADERS = {
    covalent: { vert: VERT_COVALENT, frag: FRAG_COVALENT },
    metallic: { vert: VERT_METALLIC, frag: FRAG_METALLIC },
    ionic:    { vert: VERT_IONIC,    frag: FRAG_IONIC    },
    vdw:      { vert: VERT_VDW,      frag: FRAG_VDW      },
};
function getBondShader(type) {
    return BOND_SHADERS[type] ?? BOND_SHADERS.covalent;
}

// ── Vectores prealloc para física ─────────────────────────────────────────
const _tmpAB    = new THREE.Vector3();
const _tmpForce = new THREE.Vector3();
const _tmpTang  = new THREE.Vector3();
const _tmpBin   = new THREE.Vector3();
const _tmpAxis  = new THREE.Vector3();

let _nextBondId = 0;

// ── Clase Bond ─────────────────────────────────────────────────────────────
export class Bond {

    constructor(atomA, atomB, opts = {}) {
        this.id    = _nextBondId++;
        this.atomA = atomA;
        this.atomB = atomB;
        this.order = opts.order ?? 1;
        this.type  = opts.type  ?? 'covalent';
        this.equilibriumLength = opts.equilibrium ?? (atomA.radius + atomB.radius) * 1.1;
        this.stiffness = opts.stiffness ?? this._defaultStiffness();

        // ── Morse: parámetro de curvatura del pozo ───────────────────────
        this.morseA  = opts.morseA  ?? (MORSE_A[this.type] ?? MORSE_A.covalent);

        // De: profundidad del pozo de disociación.
        // Prioridad: opts.morseDe → bond_energy_ev de la base de datos → stiffness-derivado.
        //
        // bond_energy_ev (reactivity.bond_energy_ev) es la energía real del enlace en eV.
        // Media geométrica de los dos átomos → De del par.
        // EV_TO_GAME = 300: calibrado para que C-C (3.6eV) → stiffness ~0.8 (coincide).
        const EV_TO_GAME = 300;
        const deA = atomA.elementData?.reactivity?.bond_energy_ev;
        const deB = atomB.elementData?.reactivity?.bond_energy_ev;
        const deFromData = (deA && deB)
            ? Math.sqrt(deA * deB) * EV_TO_GAME
            : (deA || deB)
                ? (deA || deB) * EV_TO_GAME
                : null;

        this.morseDe = opts.morseDe
            ?? deFromData
            ?? (this.stiffness / (2 * this.morseA * this.morseA));

        // Ruptura natural: cuando r > re + MORSE_RUPTURE_FACTOR/a,
        // la fuerza es negligible y el progress comienza a caer.
        this.ruptureLength = this.equilibriumLength + MORSE_RUPTURE_FACTOR / this.morseA;

        // ── bond_progress ────────────────────────────────────────────────
        // 0 = no existe (naciendo o muriendo), 1 = completamente formado.
        // targetProgress: adónde tiende (1 = formar, 0 = romper).
        // progressSpeed: velocidad del lerp (frames-independiente por dt).
        this.progress       = opts.progress       ?? 0.0;   // empieza invisible
        this.targetProgress = opts.targetProgress ?? 1.0;   // objetivo: formado
        this.progressSpeed  = opts.progressSpeed  ?? 4.0;   // ~0.25s para formar
        this.broken  = false;
        this.visible = true;
        this.mesh    = null;
        atomA.addBond(this);
        atomB.addBond(this);
        console.log(`[Bond #${this.id}] ${atomA.symbol}—${atomB.symbol} | tipo: ${this.type} | orden: ${this.order} | eq: ${this.equilibriumLength.toFixed(1)}pm | k: ${this.stiffness.toFixed(4)} | a: ${this.morseA.toFixed(4)} | ruptureAt: ${this.ruptureLength.toFixed(1)}pm`);
    }

    init() {
        this._buildMesh();
        this.updateMesh();
        return this;
    }

    // ── tick(dt) — bond_progress y detección de muerte real ───────────────
    // Llamar CADA FRAME desde World.js, junto con applyForces().
    // dt en segundos (típico: 1/60 ≈ 0.0167).
    //
    // Ciclo de vida:
    //   Formación: progress 0→1 (targetProgress=1, atomos dentro del rango)
    //   Ruptura:   targetProgress=0 → progress cae a 0 → broken=true → dispose
    //
    // El enlace es "químicamente activo" cuando progress > 0.5 (configurable).

    tick(dt) {
        if (this.broken) return;

        // Contador de frames de vida — usado por World._relaxPelitoOrientations
        // para limitar XPBD a bonds recién formados (XPBD_SETTLE_FRAMES)
        this._framesAlive = (this._framesAlive ?? 0) + 1;

        // Lerp suave hacia el target (frame-rate independent)
        const delta = this.targetProgress - this.progress;
        this.progress += delta * Math.min(this.progressSpeed * dt, 1.0);

        // Clamp para evitar drift numérico
        this.progress = Math.max(0.0, Math.min(1.0, this.progress));

        // Muerte real: cuando el fade de salida termina
        if (this.targetProgress <= 0 && this.progress < 0.01) {
            this._finalizeBreak();
        }
    }

    // ── Física: Potencial de Morse ─────────────────────────────────────────
    // Reemplaza el spring armónico V=k(r-r0)²/2 con V=De·(1-e^(-a(r-re)))²
    //
    // Ventajas vs spring:
    //   1. Disociación natural: F→0 cuando r >> re (el spring tira infinito)
    //   2. Asimetría: más duro en compresión, más suave en extensión (real)
    //   3. Sin threshold abrupto: la ruptura emerge de la física
    //
    // La fuerza se aplica solo si progress > 0 (enlace activo).
    // Para vdw no hay fuerza Morse (como en v2).

    applyForces() {
        if (this.broken || this.type === 'vdw') return;
        if (this.progress < 0.01) return;   // aún naciendo, no transmite fuerza

        _tmpAB.subVectors(this.atomB.position, this.atomA.position);
        const dist = _tmpAB.length();
        if (dist < 0.0001) return;

        // Detectar ruptura por distancia → iniciar fade de salida
        if (dist > this.ruptureLength && this.targetProgress > 0) {
            this._breakBond();
            return;
        }

        // Fuerza de Morse: F(r) = 2·De·a·(1-e^(-a·x))·e^(-a·x)  donde x = r - re
        // Signo: positivo = repulsión (r < re), negativo = atracción (r > re)
        const x      = dist - this.equilibriumLength;
        const expTerm = Math.exp(-this.morseA * x);
        const inner   = 1.0 - expTerm;
        // forceMag > 0: fuerza apunta de B→A (se acercan, atracción)
        // forceMag < 0: fuerza apunta de A→B (se alejan, repulsión — r < re)
        const forceMag = 2.0 * this.morseDe * this.morseA * inner * expTerm;

        // Escalar por progress: un enlace naciendo transmite menos fuerza
        const scaledForce = forceMag * this.progress;

        _tmpAB.normalize();
        _tmpForce.copy(_tmpAB).multiplyScalar(scaledForce);
        this.atomA.applyForce(_tmpForce);
        _tmpForce.copy(_tmpAB).multiplyScalar(-scaledForce);
        this.atomB.applyForce(_tmpForce);
    }

    // ── Visual — GPU-side: solo uniforms ───────────────────────────────────
    // uBondT = bondStrength * progress
    // → opacity y tamaño de puntos reflejan ambos: estiramiento Y estado de formación

    updateMesh() {
        if (!this.mesh || this.broken) return;

        const posA = this.atomA.position;
        const posB = this.atomB.position;
        if (posA.distanceTo(posB) < 0.001) return;

        const t = performance.now() * 0.001;
        const stretch      = Math.abs(this.stretch());
        const bondStrength = Math.max(0.05, 1.0 - stretch / this.equilibriumLength);
        const rRef  = Math.min(this.atomA.radius, this.atomB.radius);
        const nMax  = rRef * 0.75;
        const nMin  = rRef * 0.18 * bondStrength;

        // Base ortonormal para pi offsets
        _tmpAxis.subVectors(posB, posA).normalize();
        const upComp = Math.abs(_tmpAxis.y) < 0.9;
        _tmpTang.set(upComp ? 0 : 1, upComp ? 1 : 0, 0);
        _tmpTang.crossVectors(_tmpAxis, _tmpTang).normalize();
        _tmpBin.crossVectors(_tmpAxis, _tmpTang);

        const piOff = rRef * 0.55;
        const piData = [
            [0, 0, 0],
            [_tmpTang.x * piOff, _tmpTang.y * piOff, _tmpTang.z * piOff],
            [_tmpBin.x * piOff,  _tmpBin.y * piOff,  _tmpBin.z * piOff],
        ];

        const aspect = window.innerHeight / window.innerWidth;
        const subs   = [this._sigma, this._pi1, this._pi2];

        // ── KEY CHANGE: uBondT = bondStrength × progress ──────────────────
        // Cuando progress=0: invisible. Cuando progress=1: comportamiento v2.
        // Fade de formación y ruptura son automáticos sin cambios de shader.
        const uBondT = bondStrength * this.progress;

        for (let i = 0; i < 3; i++) {
            const sb = subs[i];
            if (!sb) continue;
            const u = sb.mat.uniforms;
            const p = piData[i];
            u.uPosA.value.copy(posA);
            u.uPosB.value.copy(posB);
            u.uRadA.value    = this.atomA.radius;
            u.uRadB.value    = this.atomB.radius;
            u.uNeckMin.value = nMin;
            u.uNeckMax.value = nMax;
            u.uTime.value    = t;
            u.uBondT.value   = uBondT;
            u.uAspect.value  = aspect;
            u.uPiOff.value.set(p[0], p[1], p[2]);
            u.uColorA.value.set(this.atomA._color ?? 0xffffff);
            u.uColorB.value.set(this.atomB._color ?? 0xffffff);
        }

        this.mesh.visible = this.visible && (this.progress > 0.005);
    }

    // ── Estado ──────────────────────────────────────────────────────────────

    setVisible(v) { this.visible = v; if (this.mesh) this.mesh.visible = v && this.progress > 0.005; }
    isBroken()      { return this.broken; }
    isForming()     { return !this.broken && this.progress < 0.99 && this.targetProgress > 0; }
    isActive()      { return !this.broken && this.progress > 0.5;  } // "cuenta" químicamente
    isDying()       { return this.targetProgress <= 0 && !this.broken; }
    currentLength() { return this.atomA.position.distanceTo(this.atomB.position); }
    stretch()       { return this.currentLength() - this.equilibriumLength; }

    // Fuerza a completar la formación instantáneamente (útil al cargar escena)
    snapFormed()    { this.progress = 1.0; this.targetProgress = 1.0; }

    // Alias legible para la profundidad del pozo de Morse (usado en disociación térmica)
    get De() { return this.morseDe; }

    /**
     * Verifica si la energía térmica es suficiente para romper este bond.
     * Distribución de Boltzmann: P = exp(-De / kBT) por frame.
     * @param {number} kBT — energía térmica en eV (kB × T_Kelvin)
     * @returns {boolean}
     */
    checkThermalDissociation(kBT) {
        if (this.broken || this.progress < 0.5) return false;
        if (this.targetProgress <= 0) return false; // ya se está rompiendo
        if (kBT < 0.001) return false;              // ~0K → nunca

        // De en game units → convertir a eV para comparar con kBT
        // EV_TO_GAME = 300 (mismo factor que en el constructor)
        const De_eV = this.morseDe / 300;
        const ratio = De_eV / kBT;
        if (ratio > 30) return false; // exp(-30) ≈ 0 — skip cálculo

        return Math.random() < Math.exp(-ratio);
    }

    // Fuerza ruptura con fade (llamar externamente para romper sin física)
    forceBreak()    { this._breakBond(); }

    serialize() {
        return {
            id: this.id, atomA: this.atomA.id, atomB: this.atomB.id,
            order: this.order, type: this.type,
            equilibrium: this.equilibriumLength, stiffness: this.stiffness,
            morseA: this.morseA, morseDe: this.morseDe,
            progress: this.progress,
        };
    }

    dispose() {
        if (this.mesh) {
            [this._sigma, this._pi1, this._pi2].filter(Boolean).forEach(sb => {
                // No disponer geo — es compartida entre todos los bonds
                sb.mat.dispose();
            });
            this.mesh.parent?.remove(this.mesh);
            this.mesh = null;
        }
        this.atomA.removeBond(this);
        this.atomB.removeBond(this);
    }

    // ── Privado ────────────────────────────────────────────────────────────

    _defaultStiffness() {
        const base = { covalent: 0.8, ionic: 0.4, metallic: 0.15, vdw: 0.01 }[this.type] ?? 0.5;
        return base * (1 + (this.order - 1) * 0.5);
    }

    // v3: _breakBond() inicia el fade en vez de cortar inmediatamente.
    // La remoción real de átomos y dispose() ocurre en _finalizeBreak(),
    // llamado desde tick() cuando progress < 0.01.
    _breakBond() {
        if (this.broken || this.targetProgress <= 0) return;
        this.targetProgress = 0;
        console.log(`[Bond #${this.id}] ${this.atomA.symbol}—${this.atomB.symbol} rompiendo (fade out)`);
    }

    // Muerte real: llamado por tick() cuando el fade termina.
    _finalizeBreak() {
        if (this.broken) return;
        this.broken = true;
        this.progress = 0;
        this.atomA.removeBond(this);
        this.atomB.removeBond(this);
        if (this.mesh) this.mesh.visible = false;
        console.log(`[Bond #${this.id}] ${this.atomA.symbol}—${this.atomB.symbol} roto (final)`);
        // World.js detectará broken=true y hará dispose() en su cleanup loop
    }

    _buildMesh() {
        this.mesh = new THREE.Group();
        this.mesh.userData.bondId  = this.id;
        this.mesh.userData.bondRef = this;
        this._sigma = this._buildBondPoints(0);
        this.mesh.add(this._sigma.pts);
        if (this.order >= 2) { this._pi1 = this._buildBondPoints(1); this.mesh.add(this._pi1.pts); }
        if (this.order >= 3) { this._pi2 = this._buildBondPoints(2); this.mesh.add(this._pi2.pts); }
        this._bondMat = this._sigma.mat;
    }

    _buildBondPoints(orbitalIndex) {
        const geo = _getSharedGeo();
        const shader = getBondShader(this.type);
        const dpr = Math.min(window.devicePixelRatio || 1, 2);

        const mat = new THREE.ShaderMaterial({
            uniforms: {
                uTime:    { value: 0 },
                uScale:   { value: 3000 * dpr * 0.035 },
                uBondT:   { value: 0.0 },     // empieza en 0 (invisible al nacer)
                uAspect:  { value: window.innerHeight / window.innerWidth },
                uColorA:  { value: new THREE.Color(this.atomA._color ?? 0xffffff) },
                uColorB:  { value: new THREE.Color(this.atomB._color ?? 0xffffff) },
                uPosA:    { value: new THREE.Vector3() },
                uPosB:    { value: new THREE.Vector3() },
                uRadA:    { value: this.atomA.radius },
                uRadB:    { value: this.atomB.radius },
                uNeckMin: { value: 0 },
                uNeckMax: { value: 10 },
                uPiOff:   { value: new THREE.Vector3() },
            },
            vertexShader:   shader.vert,
            fragmentShader: shader.frag,
            transparent: true,
            blending: this.type === 'metallic' ? THREE.AdditiveBlending : THREE.NormalBlending,
            depthWrite: false,
            depthTest:  true,
            toneMapped: false,
        });

        const pts = new THREE.Points(geo, mat);
        pts.frustumCulled = false;
        return { pts, mat };
    }

    _createMaterial() { return null; }
}
