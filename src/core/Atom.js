/**
 * Atom.js — Átomo individual del simulador
 *
 * Visual: nube de puntos (THREE.Points) con ShaderMaterial de ShaderLab.
 * - Posiciones internas en pm → vertex shader aplica uPmScale (pm→wu)
 * - uPmScale = PM_TO_WU = 0.01 → misma escala física que Constants.js
 * - Material viene de MaterialLibrary (presets ShaderLab target=sphere)
 * - Fallback: ShaderMaterial propio si el preset no existe
 *
 * Raycasting: hitMesh (esfera invisible, hija de Points) resuelve
 * la limitación de THREE.Points con el raycaster.
 */

import * as THREE from 'three';
import { ElementLoader } from '../data/ElementLoader.js';
import { MaterialLibrary } from '../renderer/MaterialLibrary.js';

// ── Constantes ─────────────────────────────────────────────────────────────

const PM_TO_WU      = 1.0;    // 1 wu = 1 pm — misma escala que QuantumRenderer
const MIN_RADIUS_WU = 15;     // pm = wu — mínimo visual ~15pm
const POINT_COUNT   = 800;

// Cache de geometrías por símbolo (posiciones en pm + aPhase)
const _geoCache = new Map();

let _nextId = 0;

// ── Uniforms base del bus ShaderLab ───────────────────────────────────────

function _makeUniforms(color, r_pm) {
    const c      = new THREE.Color(color);
    const uScale = 200 * Math.min(window.devicePixelRatio || 1, 2);
    const uSize  = Math.max(1.2, Math.min(4.5, r_pm * 0.008));  // sin cambio — r_pm mismo

    return {
        uTime:     { value: 0 },
        uScale:    { value: uScale },
        uLevel:    { value: 1.0 },
        uPmScale:  { value: PM_TO_WU },   // 1.0 — geometría ya en pm=wu
        uSpeed:    { value: 0.6 },
        uAmp:      { value: 0.08 },
        uSize:     { value: uSize },
        uColor:    { value: c },
        uBright:   { value: 1.2 },
        uEdge:     { value: 0.20 },
        uSelected: { value: 0.0 },
        uAlpha:    { value: 1.0 },   // fade LOD — 1=visible 0=invisible
    };
}

// ── Shader fallback ────────────────────────────────────────────────────────

const FALLBACK_VERT = `
uniform float uTime, uScale, uPmScale, uSize, uAmp, uLevel, uSpeed;
attribute float aPhase;
varying float vBlink;
varying float vPhase;
void main() {
    vBlink = 0.0;
    vPhase = aPhase;
    vec3 wpos   = position * uPmScale;
    vec4 mvP    = modelViewMatrix * vec4(wpos, 1.0);
    gl_Position = projectionMatrix * mvP;
    gl_PointSize = uScale * uSize / -mvP.z;
}`;

const FALLBACK_FRAG = `
uniform vec3  uColor;
uniform float uBright, uEdge, uSelected, uAlpha;
varying float vBlink;
varying float vPhase;
void main() {
    vec2  uv    = gl_PointCoord - 0.5;
    float d     = dot(uv, uv);
    if (d > 0.25) discard;
    float alpha = 1.0 - smoothstep(uEdge, 0.25, d);
    vec3  col   = uColor * uBright;
    col = mix(col, vec3(0.3, 0.75, 1.0), uSelected * 0.55);
    gl_FragColor = vec4(col, alpha * 0.88 * uAlpha);
}`;

// ── Clase Atom ─────────────────────────────────────────────────────────────

export class Atom {

    constructor(symbol, position = { x: 0, y: 0, z: 0 }, opts = {}) {
        this.id     = _nextId++;
        this.symbol = symbol;

        this.elementData = null;
        this.meta        = null;

        this.position     = new THREE.Vector3(position.x, position.y, position.z);
        this.velocity     = new THREE.Vector3();
        this.acceleration = new THREE.Vector3();
        this.force        = new THREE.Vector3();

        this.mass              = 1.0;
        this.radius            = 0.5;
        this.valence           = 0;
        this.electronegativity = 0;
        this.maxBonds          = 1;

        this.frozen      = opts.frozen ?? false;
        this.selected    = false;
        this.highlighted = false;
        this.bonds       = new Set();

        this.visualMode = opts.visualMode || 'didactic';
        this.mesh       = null;
        this._hitMesh   = null;
        this._color     = 0xaaaaaa;
        this._ready     = false;

        console.log(`[Atom #${this.id}] Creado: ${symbol}`);
    }

    // ── Inicialización ─────────────────────────────────────────────────────

    async init() {
        this.meta = ElementLoader.getMeta(this.symbol);
        if (!this.meta) {
            console.warn(`[Atom #${this.id}] '${this.symbol}' desconocido — usando defaults`);
        }

        if (this.meta) {
            this._color = parseInt(this.meta.color?.replace('0x', '') || 'aaaaaa', 16);
        }

        this.elementData = await ElementLoader.load(this.symbol);

        if (this.elementData) {
            this.mass              = ElementLoader.mass(this.elementData);
            this.radius            = this._calcRadius();
            this.valence           = ElementLoader.valence(this.elementData);
            this.electronegativity = ElementLoader.electronegativity(this.elementData);
            this.maxBonds          = ElementLoader.maxBonds(this.elementData);
            console.log(`[Atom #${this.id}] ${this.symbol} — r: ${this.radius.toFixed(3)}wu, masa: ${this.mass}u`);
        }

        await this._buildMesh();
        this._ready = true;
        return this;
    }

    // ── Física ─────────────────────────────────────────────────────────────

    applyForce(force) {
        if (this.frozen) return;
        this.force.add(force);
    }

    integrate(dt) {
        if (this.frozen || !this._ready) return;
        this.acceleration.copy(this.force).divideScalar(this.mass);
        this.velocity.addScaledVector(this.acceleration, dt);
        this.position.addScaledVector(this.velocity, dt);
        this.force.set(0, 0, 0);
    }

    resetForce() { this.force.set(0, 0, 0); }

    setFrozen(frozen) {
        this.frozen = frozen;
        if (frozen) { this.velocity.set(0, 0, 0); this.force.set(0, 0, 0); }
    }

    // ── Visual ─────────────────────────────────────────────────────────────

    syncMesh() {
        // Sincronizar hitMesh con la posición física
        if (this.mesh) this.mesh.position.copy(this.position);
    }

    setSelected(selected) {
        this.selected = selected;
        this._updateMaterial();
        console.log(`[Atom #${this.id}] ${this.symbol} ${selected ? '🔵 seleccionado' : 'deseleccionado'}`);
    }

    setHighlighted(highlighted) {
        this.highlighted = highlighted;
        this._updateMaterial();
    }

    /**
     * Fade de la esfera para transición LOD.
     * @param {number} alpha 0=invisible 1=opaco
     */
    setLODAlpha(alpha) {
        if (!this.mesh) return;
        const u = this.mesh.material?.uniforms;
        if (u?.uAlpha) u.uAlpha.value = alpha;
    }

    // ── Bonds ──────────────────────────────────────────────────────────────

    addBond(bond)    { this.bonds.add(bond); }
    removeBond(bond) { this.bonds.delete(bond); }
    canBond()        { return this.bonds.size < this.maxBonds; }

    // ── Helpers ────────────────────────────────────────────────────────────

    getName(lang = 'es') { return ElementLoader.getName(this.symbol, lang); }

    get isRadioactive() {
        return this.elementData ? ElementLoader.isRadioactive(this.elementData) : false;
    }

    phaseAt(tempK) {
        return this.elementData ? ElementLoader.phaseAt(this.elementData, tempK) : 'unknown';
    }

    serialize() {
        return {
            id:       this.id,
            symbol:   this.symbol,
            position: this.position.toArray(),
            velocity: this.velocity.toArray(),
            frozen:   this.frozen,
        };
    }

    dispose() {
        if (this.mesh) {
            this.mesh.material?.dispose();
            this._hitMesh?.geometry?.dispose();
            this._hitMesh?.material?.dispose();
            this.mesh.parent?.remove(this.mesh);
            this.mesh     = null;
            this._hitMesh = null;
        }
        this.bonds.clear();
        console.log(`[Atom #${this.id}] ${this.symbol} eliminado 🗑️`);
    }

    // ── Privado ────────────────────────────────────────────────────────────

    _calcRadius() {
        const r_pm = ElementLoader.radius(this.elementData);
        return Math.max(r_pm * PM_TO_WU, MIN_RADIUS_WU);
    }

    async _buildMesh() {
        // El visual del átomo lo maneja 100% el QuantumRenderer.
        // Atom solo crea un _hitMesh invisible para raycasting.
        const hitRadius = Math.max(this.radius, 40);  // pm = wu — mismo tamaño que la esfera visual
        const hitGeo = new THREE.SphereGeometry(hitRadius, 8, 6);
        const hitMat = new THREE.MeshBasicMaterial({ visible: false });
        this._hitMesh = new THREE.Mesh(hitGeo, hitMat);
        this._hitMesh.position.copy(this.position);
        this._hitMesh.userData.atomId  = this.id;
        this._hitMesh.userData.symbol  = this.symbol;
        this._hitMesh.userData.atomRef = this;
        this.mesh = this._hitMesh; // mesh = hitMesh para compatibilidad con World/raycaster

        // Jaula de detección — indicadores de enlace visibles en modo Diseño
        this._buildDetectionCage();
    }

    async _createMaterial(r_pm = 100) {
        const uniforms = _makeUniforms(this._color, r_pm);

        // ── Cargar preset ShaderLab via MaterialLibrary ────────────────
        const matName = this.meta?.material || null;
        const group   = this.meta?.group    || null;
        const preset  = await MaterialLibrary.getForElement(matName, group);

        if (preset?.vert && preset?.frag) {
            console.log(`[Atom #${this.id}] ${this.symbol} ← preset: ${preset.meta?.name ?? matName}`);

            // Inyectar uSelected en el frag del preset
            // El frag compilado no lo tiene — lo añadimos antes de gl_FragColor
            const frag = preset.frag
                .replace(
                    'void main(){',
                    'uniform float uSelected;\nvoid main(){'
                )
                .replace(
                    'gl_FragColor=vec4(col,',
                    'col=mix(col,vec3(0.3,0.75,1.0),uSelected*0.5);gl_FragColor=vec4(col,'
                );

            return new THREE.ShaderMaterial({
                uniforms,
                vertexShader:   preset.vert,
                fragmentShader: frag,
                transparent:    true,
                depthWrite:     false,
            depthTest:      false,
            toneMapped:     false,
            });
        }

        // ── Fallback ───────────────────────────────────────────────────
        console.warn(`[Atom #${this.id}] ${this.symbol} — sin preset, usando fallback`);
        return new THREE.ShaderMaterial({
            uniforms,
            vertexShader:   FALLBACK_VERT,
            fragmentShader: FALLBACK_FRAG,
            transparent:    true,
            depthWrite:     false,
            depthTest:      false,
            toneMapped:     false,
        });
    }

    _updateMaterial() {
        const u = this.mesh?.material?.uniforms;
        if (!u?.uSelected) return;
        u.uSelected.value = this.selected ? 1.0 : (this.highlighted ? 0.35 : 0.0);
    }

    // ── Pelitos de Valencia — sensores locales con identidad química ─────

    // Geometrías VSEPR: las direcciones reales donde un átomo busca enlace
    static VSEPR_DIRS = {
        1: [  // H, F, Cl — terminal
            [1, 0, 0],
        ],
        2: [  // O, S — bent (104.5° / 2 ≈ 52.25° desde eje)
            [0.612, 0.791, 0],
            [0.612, -0.791, 0],
        ],
        3: [  // N, B — trigonal planar (120°)
            [1, 0, 0],
            [-0.5, 0.866, 0],
            [-0.5, -0.866, 0],
        ],
        4: [  // C, Si — tetraédrico (109.5°)
            [0.577, 0.577, 0.577],
            [0.577, -0.577, -0.577],
            [-0.577, 0.577, -0.577],
            [-0.577, -0.577, 0.577],
        ],
        5: [  // P expandido — bipiramidal trigonal
            [0, 1, 0], [0, -1, 0],
            [1, 0, 0], [-0.5, 0, 0.866], [-0.5, 0, -0.866],
        ],
        6: [  // S expandido — octaédrico
            [1,0,0], [-1,0,0], [0,1,0], [0,-1,0], [0,0,1], [0,0,-1],
        ],
    };

    /**
     * Construye la cage de detección basada en geometría VSEPR.
     *
     * Cada punto ("pelito") tiene:
     *  - Dirección: orientación del orbital de valencia
     *  - Radio de detección: 1.55 × radio atómico (zona de solapamiento)
     *  - Estado: libre o ocupado (por un bond)
     *  - Identidad: índice del orbital dentro de la geometría VSEPR
     *
     * Los pelitos libres son los que buscan enlace.
     * Los ocupados dejan de ser sensores activos.
     */
    _buildDetectionCage() {
        const maxB = this.maxBonds || 1;
        const vsepKey = Math.min(maxB, 6);
        const rawDirs = Atom.VSEPR_DIRS[vsepKey] || Atom.VSEPR_DIRS[1];

        // Usar solo maxBonds direcciones (ej: O tiene maxBonds=2, usa 2 de las 2 bent)
        const numPelitos = Math.min(maxB, rawDirs.length);
        const R = this.radius * 1.55;  // zona de detección — justo fuera de la esfera

        // Datos de cada pelito
        this._pelitos = [];
        const dirs = [];
        for (let i = 0; i < numPelitos; i++) {
            const [dx, dy, dz] = rawDirs[i];
            const dir = new THREE.Vector3(dx, dy, dz).normalize();
            dirs.push(dir);
            this._pelitos.push({
                index:         i,
                direction:     dir.clone(),
                baseDirection: dir.clone(),       // FIX 2: referencia original — nunca se muta
                worldPos:      new THREE.Vector3(),
                radius:        R,
                occupied:      false,
                bondRef:       null,
            });
        }
        this._cageDirs = dirs;

        // ── Visual: puntos del shader ─────────────────────────────────────
        const N = numPelitos;
        const pos = new Float32Array(N * 3);
        const idx = new Float32Array(N);
        const isV = new Float32Array(N);
        for (let i = 0; i < N; i++) {
            pos[i*3]   = dirs[i].x * R;
            pos[i*3+1] = dirs[i].y * R;
            pos[i*3+2] = dirs[i].z * R;
            idx[i] = i;
            isV[i] = 1;  // todos son puntos de valencia
        }

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position',  new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('aIdx',      new THREE.BufferAttribute(idx, 1));
        geo.setAttribute('aIsVertex', new THREE.BufferAttribute(isV, 1));

        const DETECT_VERT = /* glsl */`
            uniform float uActiveIdx, uTime, uScale;
            uniform vec3  uHighColor;
            attribute float aIdx, aIsVertex;
            varying vec3  vColor;
            varying float vAlpha, vIsActive, vIsVertex;
            void main() {
                bool isActive = abs(aIdx - uActiveIdx) < 0.5;
                vIsActive = isActive ? 1.0 : 0.0;
                vIsVertex = aIsVertex;
                float pulse = isActive ? 0.55 + 0.45*sin(uTime*8.0) : 0.0;
                vColor = isActive
                    ? uHighColor + vec3(0.3)*pulse
                    : vec3(0.20,0.52,0.36);
                vAlpha = isActive ? 0.9+0.1*pulse : 0.45;
                vec4 mvP = modelViewMatrix * vec4(position, 1.0);
                float sz = isActive ? uScale*3.4 : uScale*2.0;
                gl_PointSize = sz;
                gl_Position  = projectionMatrix * mvP;
            }`;

        const DETECT_FRAG = /* glsl */`
            varying vec3  vColor;
            varying float vAlpha, vIsActive, vIsVertex;
            void main() {
                vec2  uv = gl_PointCoord - 0.5;
                float d  = dot(uv, uv);
                if (d > 0.25) discard;
                float alpha;
                if (vIsActive > 0.5) {
                    float core = 1.0 - smoothstep(0.10, 0.20, d);
                    float halo = (1.0 - smoothstep(0.18, 0.25, d)) * 0.4;
                    alpha = (core + halo) * vAlpha;
                } else {
                    alpha = (1.0 - smoothstep(0.08, 0.22, d)) * vAlpha * 0.7;
                }
                gl_FragColor = vec4(vColor, alpha);
            }`;

        this._cageMat = new THREE.ShaderMaterial({
            uniforms: {
                uActiveIdx: { value: -1 },
                uTime:      { value: 0 },
                uScale:     { value: 4 * Math.min(window.devicePixelRatio || 1, 2) },
                uHighColor: { value: new THREE.Color(0x00f5ff) },
            },
            vertexShader:   DETECT_VERT,
            fragmentShader: DETECT_FRAG,
            transparent:    true,
            blending:       THREE.NormalBlending,
            depthWrite:     false,
            depthTest:      true,
            toneMapped:     false,
        });

        this._cagePts = new THREE.Points(geo, this._cageMat);
        this._cagePts.visible = false;
        return this._cagePts;
    }

    /** Muestra/oculta la jaula de detección */
    setCageVisible(visible) {
        if (this._cagePts) this._cagePts.visible = visible;
    }

    /** Actualiza uTime + posiciones mundo de los pelitos */
    tickCage(t) {
        if (this._cageMat?.uniforms?.uTime) this._cageMat.uniforms.uTime.value = t;
        // Actualizar posición mundo de cada pelito
        if (this._pelitos) {
            for (const p of this._pelitos) {
                p.worldPos.copy(p.direction).multiplyScalar(p.radius).add(this.position);
            }
        }
    }

    /**
     * Ilumina el punto de la jaula más cercano a una dirección dada.
     * @param {THREE.Vector3} dir — dirección normalizada hacia el vecino
     */
    setActiveCagePoint(dir) {
        if (!this._cageMat || !this._cageDirs) return;
        let best = -Infinity, bestIdx = -1;
        for (let i = 0; i < this._cageDirs.length; i++) {
            const d = this._cageDirs[i].dot(dir);
            if (d > best) { best = d; bestIdx = i; }
        }
        this._cageMat.uniforms.uActiveIdx.value = bestIdx;
    }

    /** Apaga todos los puntos activos */
    clearActiveCagePoint() {
        if (this._cageMat?.uniforms?.uActiveIdx)
            this._cageMat.uniforms.uActiveIdx.value = -1;
    }

    // ── Pelitos API — para World y otros sistemas ────────────────────────

    /** Devuelve los pelitos libres (no ocupados por un bond) */
    getFreePelitos() {
        return this._pelitos?.filter(p => !p.occupied) ?? [];
    }

    /** Marca un pelito como ocupado por un bond */
    occupyPelito(index, bond) {
        if (!this._pelitos?.[index]) return;
        this._pelitos[index].occupied = true;
        this._pelitos[index].bondRef  = bond;
    }

    /** Libera un pelito cuando un bond se rompe */
    freePelito(index) {
        if (!this._pelitos?.[index]) return;
        this._pelitos[index].occupied = false;
        this._pelitos[index].bondRef  = null;
    }

    /** ¿Tiene pelitos libres? (puede formar más bonds) */
    hasFreePelitos() {
        return this._pelitos?.some(p => !p.occupied) ?? false;
    }

    /**
     * Encuentra el pelito libre más cercano a una dirección.
     * Retorna { pelito, dot } o null si no hay libres.
     */
    closestFreePelito(direction) {
        if (!this._pelitos) return null;
        let best = -Infinity, bestP = null;
        for (const p of this._pelitos) {
            if (p.occupied) continue;
            const d = p.direction.dot(direction);
            if (d > best) { best = d; bestP = p; }
        }
        return bestP ? { pelito: bestP, dot: best } : null;
    }

    /**
     * Rota TODOS los pelitos (y la cage visual) para que el pelito libre
     * más cercano quede alineado con la dirección del vecino.
     *
     * Solo rota si es el primer bond (sin bonds previos).
     * Con bonds existentes, los pelitos restantes ya tienen orientación
     * fijada por el primer enlace — la geometría VSEPR se respeta.
     *
     * @param {THREE.Vector3} targetPos — posición del átomo vecino
     * @returns {Object|null} — el pelito que se alineó, o null
     */
    /**
     * Rota TODOS los pelitos para que el pelito libre más cercano
     * quede alineado con la dirección del vecino.
     *
     * FIX Velvet:
     *  - Usa baseDirection como referencia (no direction acumulada)
     *  - Aplica slerp para suavizar el snap
     *  - Solo rota en el primer bond (los demás respetan la geometría)
     *
     * @param {THREE.Vector3} targetPos — posición del átomo vecino
     * @returns {Object|null} — el pelito que se alineó, o null
     */
    orientPelitoToward(targetPos) {
        if (!this._pelitos || this._pelitos.length === 0) return null;

        const dir = new THREE.Vector3().subVectors(targetPos, this.position).normalize();
        const match = this.closestFreePelito(dir);
        if (!match) return null;

        const occupiedPelitos = this._pelitos.filter(p => p.occupied);
        const occupiedCount   = occupiedPelitos.length;

        let quat;

        if (occupiedCount === 0) {
            // ── Primer bond: rotar desde baseDirection (comportamiento original) ──
            // Usa baseDirection como referencia para evitar error acumulativo.
            const from = match.pelito.baseDirection.clone().normalize();
            const to   = dir.clone().normalize();
            const dot  = Math.max(-1, Math.min(1, from.dot(to)));
            if (dot > 0.999) return match.pelito;

            const fullQuat = new THREE.Quaternion().setFromUnitVectors(from, to);
            quat = new THREE.Quaternion().slerp(fullQuat, 0.7); // 70% suavizado

            // Aplicar a TODOS los pelitos desde baseDirection
            for (const p of this._pelitos) {
                p.direction.copy(p.baseDirection).applyQuaternion(quat).normalize();
            }

        } else {
            // ── Bonds adicionales: best-fit rotation del conjunto ──────────────
            // El conjunto de pelitos es un cuerpo rígido (ángulos VSEPR fijos).
            // Buscamos la rotación R que alinea el baricentro direccional del conjunto
            // con el baricentro de los targets reales (bond partners + nuevo bond).
            //
            // Esto garantiza que todos los pelitos queden lo más cerca posible
            // de sus partners sin distorsionar los ángulos VSEPR entre ellos.

            // Recopilar pares (pelito.direction actual, targetDir real)
            const pairs = [];

            // Pelitos ocupados → posición real de su partner
            for (const p of occupiedPelitos) {
                if (!p.bondRef) continue;
                const bond    = p.bondRef;
                const partner = bond.atomA === this ? bond.atomB : bond.atomA;
                if (!partner) continue;
                const t = new THREE.Vector3()
                    .subVectors(partner.position, this.position).normalize();
                pairs.push({ current: p.direction.clone(), target: t });
            }

            // Pelito libre que va a recibir el nuevo bond
            pairs.push({ current: match.pelito.direction.clone(), target: dir });

            if (pairs.length < 2) return match.pelito; // no hay suficiente info

            // Baricentro de direcciones actuales y targets
            // (promedio vectorial normalizado → bisectriz del conjunto)
            const currentMean = new THREE.Vector3();
            const targetMean  = new THREE.Vector3();
            for (const { current, target } of pairs) {
                currentMean.add(current);
                targetMean.add(target);
            }
            currentMean.normalize();
            targetMean.normalize();

            const dot = Math.max(-1, Math.min(1, currentMean.dot(targetMean)));
            if (dot > 0.9995) return match.pelito; // ya alineado

            const fullQuat = new THREE.Quaternion()
                .setFromUnitVectors(currentMean, targetMean);
            quat = new THREE.Quaternion().slerp(fullQuat, 0.85); // 85% — más decisivo

            // Aplicar a TODOS los pelitos desde su dirección ACTUAL
            // (no baseDirection — ya incorpora la orientación del primer bond)
            for (const p of this._pelitos) {
                p.direction.applyQuaternion(quat).normalize();
            }
        }

        // Actualizar _cageDirs y visual
        if (this._cageDirs) {
            for (let i = 0; i < this._cageDirs.length && i < this._pelitos.length; i++) {
                this._cageDirs[i].copy(this._pelitos[i].direction);
            }
        }
        this._updateCageVisual();
        return match.pelito;
    }

    /** Actualiza las posiciones de los puntos del visual de la cage */
    _updateCageVisual() {
        if (!this._cagePts || !this._pelitos) return;
        const posAttr = this._cagePts.geometry.getAttribute('position');
        if (!posAttr) return;
        const R = this.radius * 1.55;
        for (let i = 0; i < this._pelitos.length; i++) {
            const d = this._pelitos[i].direction;
            posAttr.setXYZ(i, d.x * R, d.y * R, d.z * R);
        }
        posAttr.needsUpdate = true;
    }
}
