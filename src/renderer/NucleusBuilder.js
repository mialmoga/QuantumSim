/**
 * NucleusBuilder.js — Construcción del núcleo atómico v2.0
 * =========================================================
 * Genera los Points de protones y neutrones (LOD far/near/quantum)
 * Y el volumen raymarching (LOD nuclear).
 *
 * Geometría honesta:
 *   - Nucleones distribuidos por equilibrio electrostático (Thomson problem)
 *   - Deformación según JSON de data/deformaciones_nucleares_qcs.json
 *   - Neutrones intercalados (Z≤20) o con piel periférica (Z>20)
 *   - 3 quarks por nucleón (visibles en raymarching)
 *
 * El caller (QuantumRenderer) decide cuándo mostrar Points vs volumen
 * según el estado LOD.
 */

import * as THREE from 'three';
import {
    NUCLEUS_VERT, NUCLEUS_FRAG,
    NUCLEAR_VOL_VERT, NUCLEAR_VOL_FRAG
} from './shaders.js';

// ── Deformaciones nucleares ────────────────────────────────────────────────
// Mapa de string del JSON → código numérico para el shader
const DEFORM_MAP = {
    'Esférico (Número Mágico)':              0,
    'Casi Esférico (Vibracional)':           1,
    'Esferoide Prolato (Común)':             2,
    'Esferoide Prolato (Lantánido)':         2,
    'Esferoide Prolato (Actínido)':          2,
    'Esferoide Oblato / Deformación Triaxial': 3,
    'Deformación Triaxial / Prolato':        4,
    'Forma de Pera (Octupolar)':             5,
};

// Cache del JSON — cargado lazy
let _deformData = null;

async function _loadDeformData() {
    if (_deformData) return _deformData;
    try {
        const resp = await fetch('data/deformaciones_nucleares_qcs.json');
        const arr  = await resp.json();
        _deformData = new Map(arr.map(e => [e.Z, e]));
    } catch (e) {
        console.warn('[NucleusBuilder] Sin datos de deformación nuclear:', e.message);
        _deformData = new Map();
    }
    return _deformData;
}

// ═══════════════════════════════════════════════════════════════════════════
//  GEOMETRÍA DE NUCLEONES — Thomson equilibrium + deformación
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Radio nuclear honesto: r = r₀ × A^(1/3)
 * r₀ ≈ 1.2 fm, pero en world units usamos la misma escala proporcional
 * que el NucleusBuilder original para mantener la proporción orbital-núcleo.
 */
function nuclearRadius(A) {
    if (A <= 0) return 0.1;
    return Math.min(0.3 + Math.pow(A, 1 / 3) * 0.08, 1.0);
}

/**
 * Aplica deformación a una posición (x,y,z) dentro de la esfera nuclear.
 * @param {THREE.Vector3} pos — posición a deformar (se modifica in-place)
 * @param {number} deformType — código numérico de deformación
 * @param {number} R — radio nuclear
 */
function applyDeformation(pos, deformType, R) {
    switch (deformType) {
        case 0: // Esférico — sin cambio
            break;
        case 1: // Casi esférico — vibración leve
            // Perturbación ~5% del radio
            pos.x *= 1.0 + 0.03 * Math.sin(pos.y * 8.0);
            pos.z *= 1.0 - 0.02 * Math.cos(pos.x * 6.0);
            break;
        case 2: // Prolato — alargado en Y (eje polar)
            pos.y *= 1.25;
            pos.x *= 0.88;
            pos.z *= 0.88;
            break;
        case 3: // Oblato/triaxial — achatado en Y
            pos.y *= 0.78;
            pos.x *= 1.12;
            pos.z *= 1.08;
            break;
        case 4: // Triaxial/prolato — tres ejes diferentes
            pos.x *= 1.15;
            pos.y *= 1.08;
            pos.z *= 0.80;
            break;
        case 5: // Pera (octupolar) — asimétrico
            {
                const frac = (pos.y / R + 1.0) * 0.5; // 0..1 de polo sur a norte
                const pearScale = 0.85 + frac * 0.30;  // más masa arriba
                pos.x *= pearScale;
                pos.z *= pearScale;
                pos.y *= 1.10;
            }
            break;
    }
}

/**
 * Genera posiciones de protones en equilibrio electrostático
 * sobre/dentro de la esfera nuclear deformada.
 *
 * Para N≤4 usa geometrías exactas (punto, dipolo, triángulo, tetraedro).
 * Para N≥5 usa iteración de repulsión de Thomson (50 iteraciones).
 *
 * @param {number} count — número de protones
 * @param {number} R — radio nuclear
 * @param {number} deformType — tipo de deformación
 * @returns {THREE.Vector3[]}
 */
function protonPositions(count, R, deformType) {
    if (count <= 0) return [];
    if (count === 1) {
        const p = new THREE.Vector3(0, 0, 0);
        applyDeformation(p, deformType, R);
        return [p];
    }
    if (count === 2) {
        const a = new THREE.Vector3(-R * 0.4, 0, 0);
        const b = new THREE.Vector3( R * 0.4, 0, 0);
        applyDeformation(a, deformType, R);
        applyDeformation(b, deformType, R);
        return [a, b];
    }
    if (count === 3) {
        const r = R * 0.5;
        const pts = [0, 1, 2].map(i => {
            const p = new THREE.Vector3(
                r * Math.cos(i * Math.PI * 2 / 3),
                r * Math.sin(i * Math.PI * 2 / 3),
                0
            );
            applyDeformation(p, deformType, R);
            return p;
        });
        return pts;
    }
    if (count === 4) {
        // Tetraedro
        const s = R * 0.45;
        const pts = [
            new THREE.Vector3( s,  s,  s),
            new THREE.Vector3(-s, -s,  s),
            new THREE.Vector3(-s,  s, -s),
            new THREE.Vector3( s, -s, -s),
        ];
        pts.forEach(p => applyDeformation(p, deformType, R));
        return pts;
    }

    // ≥5: Thomson problem — iteración de repulsión
    // Inicializar con Fibonacci en esfera
    const pts = [];
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < count; i++) {
        const y     = 1 - (i / Math.max(count - 1, 1)) * 2;
        const rr    = Math.sqrt(Math.max(0, 1 - y * y));
        const theta = golden * i;
        pts.push(new THREE.Vector3(
            R * rr * Math.cos(theta),
            R * y,
            R * rr * Math.sin(theta)
        ));
    }

    // 50 iteraciones de repulsión coulombiana
    const force = new THREE.Vector3();
    const diff  = new THREE.Vector3();
    for (let iter = 0; iter < 50; iter++) {
        const stepSize = 0.02 * R / (1 + iter * 0.1);
        for (let i = 0; i < count; i++) {
            force.set(0, 0, 0);
            for (let j = 0; j < count; j++) {
                if (i === j) continue;
                diff.subVectors(pts[i], pts[j]);
                const d2 = diff.lengthSq();
                if (d2 < 1e-10) continue;
                force.addScaledVector(diff, 1.0 / (d2 * Math.sqrt(d2)));
            }
            // Proyectar fuerza tangente a la esfera
            const n = pts[i].clone().normalize();
            const tangent = force.clone().addScaledVector(n, -force.dot(n));
            pts[i].addScaledVector(tangent, stepSize);
            // Renormalizar a la esfera
            pts[i].normalize().multiplyScalar(R * 0.85); // 85% del radio para dejar espacio
        }
    }

    // Aplicar deformación
    pts.forEach(p => applyDeformation(p, deformType, R));
    return pts;
}

/**
 * Genera posiciones de neutrones.
 * - Z ≤ 20: intercalados con protones (equilibrio compartido)
 * - Z > 20: neutrones extra en periferia ("piel de neutrones")
 *
 * @param {number} nCount — número de neutrones
 * @param {number} Z — número atómico (para decidir modo)
 * @param {THREE.Vector3[]} protonPos — posiciones de protones ya calculadas
 * @param {number} R — radio nuclear
 * @param {number} deformType
 * @returns {THREE.Vector3[]}
 */
function neutronPositions(nCount, Z, protonPos, R, deformType) {
    if (nCount <= 0) return [];

    const pts = [];

    if (Z <= 20) {
        // ── Modo intercalado: neutrones en equilibrio con protones ──
        // Se colocan en los "huecos" entre protones
        const allPos = [...protonPos];
        const golden = Math.PI * (3 - Math.sqrt(5));

        // Inicializar con Fibonacci desplazado
        for (let i = 0; i < nCount; i++) {
            const y     = 1 - (i / Math.max(nCount - 1, 1)) * 2;
            const rr    = Math.sqrt(Math.max(0, 1 - y * y));
            const theta = golden * (i + 0.5); // offset de medio paso
            pts.push(new THREE.Vector3(
                R * 0.8 * rr * Math.cos(theta),
                R * 0.8 * y,
                R * 0.8 * rr * Math.sin(theta)
            ));
        }

        // Iterar repulsión con TODOS los nucleones (protones + neutrones)
        const force = new THREE.Vector3();
        const diff  = new THREE.Vector3();
        for (let iter = 0; iter < 30; iter++) {
            const step = 0.015 * R / (1 + iter * 0.1);
            for (let i = 0; i < nCount; i++) {
                force.set(0, 0, 0);
                // Repulsión con otros neutrones
                for (let j = 0; j < nCount; j++) {
                    if (i === j) continue;
                    diff.subVectors(pts[i], pts[j]);
                    const d2 = diff.lengthSq();
                    if (d2 < 1e-10) continue;
                    force.addScaledVector(diff, 1.0 / (d2 * Math.sqrt(d2)));
                }
                // Repulsión (más suave) con protones — neutrones no los empujan igual
                for (const pp of protonPos) {
                    diff.subVectors(pts[i], pp);
                    const d2 = diff.lengthSq();
                    if (d2 < 1e-10) continue;
                    force.addScaledVector(diff, 0.5 / (d2 * Math.sqrt(d2)));
                }
                const n = pts[i].clone().normalize();
                const tangent = force.clone().addScaledVector(n, -force.dot(n));
                pts[i].addScaledVector(tangent, step);
                pts[i].normalize().multiplyScalar(R * 0.82);
            }
        }

    } else {
        // ── Modo piel de neutrones: Z primeros intercalados, resto en periferia ──
        const nInner = Math.min(nCount, Z);     // neutrones internos ≈ 1:1 con protones
        const nSkin  = nCount - nInner;          // exceso → periferia

        // Internos: misma lógica de intercalado
        const golden = Math.PI * (3 - Math.sqrt(5));
        for (let i = 0; i < nInner; i++) {
            const y     = 1 - (i / Math.max(nInner - 1, 1)) * 2;
            const rr    = Math.sqrt(Math.max(0, 1 - y * y));
            const theta = golden * (i + 0.5);
            const p = new THREE.Vector3(
                R * 0.8 * rr * Math.cos(theta),
                R * 0.8 * y,
                R * 0.8 * rr * Math.sin(theta)
            );
            pts.push(p);
        }

        // Piel: en esfera exterior (R × 0.95–1.0)
        for (let i = 0; i < nSkin; i++) {
            const y     = 1 - (i / Math.max(nSkin - 1, 1)) * 2;
            const rr    = Math.sqrt(Math.max(0, 1 - y * y));
            const theta = golden * (i + nInner + 0.3);
            const rSkin = R * (0.95 + Math.random() * 0.05);
            const p = new THREE.Vector3(
                rSkin * rr * Math.cos(theta),
                rSkin * y,
                rSkin * rr * Math.sin(theta)
            );
            pts.push(p);
        }
    }

    // Aplicar deformación
    pts.forEach(p => applyDeformation(p, deformType, R));
    return pts;
}


// ═══════════════════════════════════════════════════════════════════════════
//  NUCLEUS BUILDER
// ═══════════════════════════════════════════════════════════════════════════

export class NucleusBuilder {

    /**
     * @param {boolean} isMobile
     * @param {THREE.Material[]} materialsRef — array del renderer para tick de uTime
     */
    constructor(isMobile, materialsRef) {
        this._isMobile     = isMobile;
        this._materialsRef = materialsRef;

        // Referencia al mesh volumétrico (creado en buildVolumetric)
        this._volMesh = null;
        this._volUniforms = null;

        // Cache de posiciones calculadas (para reutilizar en el shader)
        this._protonPos  = [];
        this._neutronPos = [];
    }

    /**
     * Construye el grupo del núcleo con Points (LOD far/near/quantum).
     * El caller es responsable de añadirlo a la escena.
     *
     * @param {Object} meta — datos del elemento (ElementLoader)
     * @param {THREE.Group} group — grupo existente a reutilizar
     * @returns {THREE.Group}
     */
    async build(meta, group) {
        this._clear(group);

        const identity = meta.identity ?? {};
        const z        = identity.number ?? 1;
        const mass     = Math.round(meta.physical_properties?.mass ?? z * 2);
        const nCount   = Math.max(0, mass - z);

        // Cargar datos de deformación
        const deformMap = await _loadDeformData();
        const deformEntry = deformMap.get(z);
        const deformStr   = deformEntry?.Geometria_Nuclear ?? 'Casi Esférico (Vibracional)';
        const deformType  = DEFORM_MAP[deformStr] ?? 1;

        const R    = nuclearRadius(z + nCount);
        const size = this._isMobile ? 3 : 2;

        // Calcular posiciones con geometría honesta
        this._protonPos  = protonPositions(z, R, deformType);
        this._neutronPos = neutronPositions(nCount, z, this._protonPos, R, deformType);

        // Crear Points para LOD normal
        const pMesh = this._mkPointsFromPositions(this._protonPos,  0xff3344, 0, size);
        const nMesh = this._mkPointsFromPositions(this._neutronPos, 0x00f5ff, 1, size);

        group.add(pMesh, nMesh);

        // Guardar metadata para buildVolumetric
        this._lastZ = z;
        this._lastN = nCount;
        this._lastR = R;
        this._lastDeformType = deformType;
        this._lastSymbol = identity.symbol ?? `Z${z}`;

        return group;
    }

    /**
     * Construye el mesh de raymarching volumétrico para LOD nuclear.
     * Se crea una sola vez y se reutiliza (hide/show).
     *
     * @param {THREE.Scene|THREE.Group} parent — dónde añadir el mesh
     * @returns {THREE.Mesh} — el volMesh para que el renderer lo posicione
     */
    buildVolumetric(parent) {
        // Limpiar anterior
        if (this._volMesh) {
            this._volMesh.geometry.dispose();
            this._volMesh.material.dispose();
            this._volMesh.parent?.remove(this._volMesh);
            this._volMesh = null;
        }

        const R = this._lastR ?? 0.5;
        const boxSize = R * 2.5;

        // Deformación nuclear → vec3 scale
        const nuclearScale = this._deformToScale(this._lastDeformType);

        // Preparar array completo de nucleones
        this._allNucleonVec4 = [];
        for (const p of this._protonPos) {
            this._allNucleonVec4.push(new THREE.Vector4(p.x, p.y, p.z, 1.0));
        }
        for (const n of this._neutronPos) {
            this._allNucleonVec4.push(new THREE.Vector4(n.x, n.y, n.z, 0.0));
        }

        // Array de uniforms — siempre 64 slots
        const shaderNucleons = [];
        for (let i = 0; i < 64; i++) {
            shaderNucleons.push(new THREE.Vector4(999, 999, 999, 0));
        }

        const total = this._allNucleonVec4.length;
        // Si caben todos, copiarlos directamente
        if (total <= 64) {
            for (let i = 0; i < total; i++) {
                shaderNucleons[i].copy(this._allNucleonVec4[i]);
            }
        }

        const uniforms = {
            uTime:          { value: 0 },
            uLocalCamPos:   { value: new THREE.Vector3() },
            uBoxSize:       { value: boxSize },
            uNuclearFade:   { value: 0.0 },
            uOmega:         { value: 3.0 },
            uNucleons:      { value: shaderNucleons },
            uNucleonCount:  { value: Math.min(total, 64) },
            // Deformación
            uNuclearScale:  { value: new THREE.Vector3().copy(nuclearScale) },
            // Tunables
            uConfinement:   { value: 2.2 },
            uAlphaBase:     { value: 0.14 },
            uDensityThresh: { value: 0.12 },
            uGradThresh:    { value: 0.08 },
            uIridAlpha:     { value: 0.04 },
            uPulseRange:    { value: 0.3 },
        };

        const mat = new THREE.ShaderMaterial({
            uniforms,
            vertexShader:   NUCLEAR_VOL_VERT,
            fragmentShader: NUCLEAR_VOL_FRAG,
            transparent:    true,
            side:           THREE.DoubleSide,
            depthWrite:     false,
            blending:       THREE.NormalBlending,
        });

        const geo = new THREE.BoxGeometry(boxSize * 2, boxSize * 2, boxSize * 2);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.visible = false;
        mesh.renderOrder = 10;

        parent.add(mesh);

        this._volMesh = mesh;
        this._volUniforms = uniforms;
        this._materialsRef.push(mat);

        return mesh;
    }

    /**
     * Actualiza uniforms del volumen cada frame.
     * Si hay más de 64 nucleones, selecciona los que están del lado
     * de la cámara (camera-facing) para el raymarching.
     * Los traseros se quedan como dots.
     * @param {THREE.Camera} camera
     */
    updateVolumetric(camera) {
        if (!this._volUniforms || !this._volMesh || !camera) return;

        // Cámara en local space
        const localCam = this._volMesh.worldToLocal(camera.position.clone());
        this._volUniforms.uLocalCamPos.value.copy(localCam);

        // Si caben todos (≤64), no hay que filtrar cada frame
        if (!this._allNucleonVec4 || this._allNucleonVec4.length <= 64) return;

        // ── Camera-facing culling para >64 nucleones ──
        const camDir = localCam.clone().normalize();
        const all    = this._allNucleonVec4;
        const arr    = this._volUniforms.uNucleons.value;

        // Calcular dot product con la dirección de la cámara
        // Positivo = cara a la cámara, negativo = detrás
        const scored = all.map((v, i) => ({
            vec: v,
            dot: v.x * camDir.x + v.y * camDir.y + v.z * camDir.z,
            idx: i
        }));

        // Ordenar por dot descendente (los más de frente primero)
        scored.sort((a, b) => b.dot - a.dot);

        // Copiar los primeros 64 al array del shader
        for (let i = 0; i < 64; i++) {
            if (i < scored.length) {
                arr[i].copy(scored[i].vec);
            } else {
                arr[i].set(999, 999, 999, 0);
            }
        }
        this._volUniforms.uNucleonCount.value = Math.min(all.length, 64);
    }

    /**
     * Convierte tipo de deformación a vec3 de escala para el shader.
     * @private
     */
    _deformToScale(deformType) {
        switch (deformType) {
            case 0: return new THREE.Vector3(1.0, 1.0, 1.0);     // esférico
            case 1: return new THREE.Vector3(1.02, 1.02, 0.96);  // casi esférico
            case 2: return new THREE.Vector3(0.88, 1.25, 0.88);  // prolato
            case 3: return new THREE.Vector3(1.12, 0.78, 1.08);  // oblato/triaxial
            case 4: return new THREE.Vector3(1.15, 1.08, 0.80);  // triaxial/prolato
            case 5: return new THREE.Vector3(0.92, 1.15, 0.92);  // pera
            default: return new THREE.Vector3(1.0, 1.0, 1.0);
        }
    }

    /**
     * Fade del volumen nuclear.
     * @param {number} fade — 0=invisible, 1=visible
     */
    setNuclearFade(fade) {
        if (this._volUniforms) {
            this._volUniforms.uNuclearFade.value = fade;
        }
        if (this._volMesh) {
            this._volMesh.visible = fade > 0.01;
        }
    }

    /** Acceso a posiciones calculadas (para debug o UI) */
    get protonPositions()  { return this._protonPos; }
    get neutronPositions() { return this._neutronPos; }
    get volumetricMesh()   { return this._volMesh; }

    // ── Privados ────────────────────────────────────────────────────────────

    /**
     * Crea Points desde posiciones precalculadas.
     */
    _mkPointsFromPositions(positions, color, type, size) {
        if (!positions.length) return new THREE.Object3D();

        const count = positions.length;
        const pos = new Float32Array(count * 3);
        for (let i = 0; i < count; i++) {
            pos[i * 3]     = positions[i].x;
            pos[i * 3 + 1] = positions[i].y;
            pos[i * 3 + 2] = positions[i].z;
        }

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));

        const mat = new THREE.ShaderMaterial({
            uniforms: {
                uTime:  { value: 0 },
                uColor: { value: new THREE.Color(color) },
                uType:  { value: type },
                uSize:  { value: size },
            },
            vertexShader:   NUCLEUS_VERT,
            fragmentShader: NUCLEUS_FRAG,
            transparent:    true,
            blending:       THREE.AdditiveBlending,
            depthWrite:     false,
            depthTest:      false,
            toneMapped:     false,
        });

        this._materialsRef.push(mat);

        const pts = new THREE.Points(geo, mat);
        pts.isPoints = true;
        return pts;
    }

    _clear(group) {
        while (group.children.length > 0) {
            const c = group.children[0];
            c.geometry?.dispose();
            c.material?.dispose();
            group.remove(c);
        }
        // No limpiamos volMesh aquí — lo gestiona buildVolumetric
    }
}
