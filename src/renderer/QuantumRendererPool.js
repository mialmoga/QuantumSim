/**
 * QuantumRendererPool.js
 *
 * Gestiona el LOD multi-átomo usando el QuantumRenderer principal.
 * No instancia QRs adicionales — reutiliza el QR principal reposicionando
 * sus grupos cada frame según el átomo más cercano a la cámara.
 *
 * Interacción orbital reactiva:
 *   Los orbitales de valencia del primario reaccionan a cualquier vecino
 *   en función de la distancia entre sus r_sample_pm — mucho antes de que
 *   se forme el bond real. El bond real (en atom.bonds) sube el estado
 *   a intercambio (3). El tipo de bond determina el comportamiento visual.
 *
 *   Estados setBondState:
 *     0 — libre       (sin vecino en rango orbital)
 *     1 — atracción   (vecino en rango r_sample, sin bond real aún)
 *     2 — repulsión   (no usado aquí por ahora — reservado)
 *     3 — intercambio (bond real formado)
 */

import * as THREE from 'three';

export const QUANTUM_RADIUS = 800;  // wu = pm — radio inicial, se ajusta por elemento

// Fallback de r_sample si el metadata no lo tiene
const R_SAMPLE_FALLBACK = 150;  // pm — conservador

export class QuantumRendererPool {

    /** @param {QuantumRenderer} qr — instancia principal ya inicializada */
    constructor(qr) {
        this._qr           = qr;
        this._qr2          = null;
        this._qr3          = null;
        this._active       = new Map();
        this._loadedSym    = null;
        this._loadedSym2   = null;
        this._loadedSym3   = null;
        this._primary      = null;
        this._secondary    = null;
        this._tertiary     = null;
        this._activeRadius = QUANTUM_RADIUS;
        this._rSamplePrimary = R_SAMPLE_FALLBACK;

        // Callbacks externos — se pueden setear desde app.js
        // onElementLoaded(symbol, qr): llamado cuando el QR primario carga un elemento
        // onSecondaryLoaded(symbol, qr): ídem para el secundario
        this.onElementLoaded   = null;
        this.onSecondaryLoaded = null;

        // LOD habilitado — cuando es false el pool no procesa (solo esferas)
        this.enabled = true;
    }

    /**
     * Inicializar el segundo QR compartiendo escena/renderer/cámara del primario.
     * Llamar después de que el QR principal esté inicializado.
     */
    async initSecondary() {
        const qr = this._qr;
        const { QuantumRenderer } = await import('./QuantumRenderer.js');
        this._qr2 = new QuantumRenderer(null, {
            renderer:     qr.renderer,
            scene:        qr.scene,
            camera:       qr.camera,
            externalLoop: true,
        });
        await this._qr2._initPoolInstance();
        console.log('[Pool] QR secundario listo 🔬');
    }

    /**
     * Inicializar el tercer QR — para quantum mode de 3 átomos.
     * Llamar después de initSecondary.
     */
    async initTertiary() {
        const qr = this._qr;
        const { QuantumRenderer } = await import('./QuantumRenderer.js');
        this._qr3 = new QuantumRenderer(null, {
            renderer:     qr.renderer,
            scene:        qr.scene,
            camera:       qr.camera,
            externalLoop: true,
        });
        await this._qr3._initPoolInstance();
        console.log('[Pool] QR terciario listo 🔬');
    }

    /**
     * Llamar cada frame con los átomos cercanos a la cámara.
     * @param {Array<{atom, dist}>} nearAtoms — salida de world.getAtomsInRadius()
     * @param {number} elapsed
     * @param {number} dt
     */
    async tick(nearAtoms, elapsed, dt) {
        const qr = this._qr;

        // LOD desactivado — restaurar esferas y salir
        if (!this.enabled) {
            for (const [, atom] of this._active) {
                if (atom.sphereMesh) atom.sphereMesh.visible = true;
            }
            if (this._loadedSym)  { qr.clear();         this._loadedSym  = null; this._primary   = null; }
            if (this._loadedSym2) { this._qr2?.clear();  this._loadedSym2 = null; this._secondary = null; }
            this._active.clear();
            return;
        }

        const activeIds = new Set(nearAtoms.map(({ atom }) => atom.id));

        // Átomos que salieron del radio — restaurar sphereMesh
        for (const [id, atom] of this._active) {
            if (!activeIds.has(id)) {
                if (atom.sphereMesh) atom.sphereMesh.visible = true;
                this._active.delete(id);
            }
        }

        // Restaurar visibilidad de átomos que perdieron prioridad.
        // Excluir primary y secondary (se gestionan más abajo en el tick).
        for (const [id, atom] of this._active) {
            if (atom !== this._primary && atom !== this._secondary && atom !== this._tertiary) {
                if (atom.sphereMesh) atom.sphereMesh.visible = true;
            }
        }

        if (nearAtoms.length === 0) {
            if (this._loadedSym)  { qr.clear();         this._loadedSym  = null; this._primary   = null; }
            if (this._loadedSym2) { this._qr2?.clear();  this._loadedSym2 = null; this._secondary = null; }
            return;
        }

        // Átomo primario = más cercano
        const { atom: primary, dist: primaryDist } = nearAtoms[0];
        this._primary = primary;

        // Cargar elemento primario si cambió
        if (this._loadedSym !== primary.symbol) {
            await qr.loadElement(primary.symbol);
            this._loadedSym = primary.symbol;
            this.onElementLoaded?.(primary.symbol, qr);

            const orbMeta = qr._orbMeta;
            this._rSamplePrimary = orbMeta
                ? _valenceRSample(orbMeta)
                : (qr._meta?.atomic_structure?.vanderwaals_radius_pm ?? R_SAMPLE_FALLBACK);
            this._activeRadius = this._rSamplePrimary * 4.0;
            console.log(`[Pool] ${primary.symbol} r_sample=${this._rSamplePrimary.toFixed(0)}pm activeRadius=${this._activeRadius.toFixed(0)}wu`);
        }

        // Posicionar grupos del primario
        if (qr.nucleusGroup) qr.nucleusGroup.position.copy(primary.position);
        if (qr.sphereGroup)  qr.sphereGroup.position.copy(primary.position);
        if (qr.shellsGroup)  qr.shellsGroup.position.copy(primary.position);

        await qr.updateLOD(primaryDist, dt);
        const lodState = qr._lodState;

        // ── Modo nuclear: inmersión exclusiva — solo un átomo ─────────────
        if (lodState === 'nuclear') {
            if (this._loadedSym2) {
                this._qr2?.clear();
                this._loadedSym2 = null;
                this._secondary  = null;
            }
            if (this._loadedSym3) {
                this._qr3?.clear();
                this._loadedSym3 = null;
                this._tertiary   = null;
            }
            for (const { atom } of nearAtoms) {
                if (atom.id !== primary.id && atom.sphereMesh) {
                    atom.sphereMesh.visible = false;
                }
            }
        }

        if (primary.sphereMesh) primary.sphereMesh.visible = (lodState === 'far');
        this._active.set(primary.id, primary);

        // ── Vecinos más cercanos (hasta 2) ────────────────────────────────
        const [neighbor1, neighbor2] = _closestNeighbors(nearAtoms, primary);

        if (!neighbor1) {
            if (this._loadedSym2) { this._qr2?.clear(); this._loadedSym2 = null; this._secondary = null; }
            if (this._loadedSym3) { this._qr3?.clear(); this._loadedSym3 = null; this._tertiary  = null; }
            if (lodState === 'far' || lodState === 'mid') {
                if (qr._bondState?.state > 0) qr.setBondState(0, {});
            }
            qr.update(elapsed, dt);
            return;
        }

        // ── Secundario ────────────────────────────────────────────────────
        const { atom: sec, dist: secDist } = neighbor1;
        this._secondary = sec;
        this._active.set(sec.id, sec);

        const rSampleSec     = _rSampleFromAtom(sec);
        const interactionDist = this._rSamplePrimary + rSampleSec;
        const inOrbitalRange  = secDist < interactionDist;

        if (this._qr2 && inOrbitalRange && lodState !== 'far') {
            if (this._loadedSym2 !== sec.symbol) {
                await this._qr2.loadElement(sec.symbol);
                this._loadedSym2 = sec.symbol;
                this.onSecondaryLoaded?.(sec.symbol, this._qr2);
                console.log(`[Pool] QR2 → ${sec.symbol}`);
            }
            if (this._qr2.nucleusGroup) this._qr2.nucleusGroup.position.copy(sec.position);
            if (this._qr2.sphereGroup)  this._qr2.sphereGroup.position.copy(sec.position);
            if (this._qr2.shellsGroup)  this._qr2.shellsGroup.position.copy(sec.position);

            const cam = qr.camera;
            const distSec = cam ? cam.position.distanceTo(sec.position) : secDist;
            await this._qr2.updateLOD(distSec, dt);
            const hideSphereSec = this._qr2._orbitFade > 0.01;
            this._qr2.sphereGroup?.children.forEach(p => {
                if (p.material?.uniforms?.uLodFade)
                    p.material.uniforms.uLodFade.value = hideSphereSec ? 0.0 : this._qr2._lodFade;
            });
            if (sec.sphereMesh) sec.sphereMesh.visible = false;
            this._qr2.update(elapsed, dt);
        } else {
            if (this._loadedSym2) { this._qr2?.clear(); this._loadedSym2 = null; }
            if (sec.sphereMesh) sec.sphereMesh.visible = true;
        }

        // ── Terciario — solo si hay segundo vecino y ninguno está en nuclear ──
        if (neighbor2 && lodState !== 'nuclear' && this._qr2?._lodState !== 'nuclear') {
            const { atom: ter, dist: terDist } = neighbor2;
            this._tertiary = ter;
            this._active.set(ter.id, ter);

            const rSampleTer    = _rSampleFromAtom(ter);
            const interactDist3 = this._rSamplePrimary + rSampleTer;
            const inRange3      = terDist < interactDist3;

            if (this._qr3 && inRange3 && lodState !== 'far') {
                if (this._loadedSym3 !== ter.symbol) {
                    await this._qr3.loadElement(ter.symbol);
                    this._loadedSym3 = ter.symbol;
                    console.log(`[Pool] QR3 → ${ter.symbol}`);
                }
                if (this._qr3.nucleusGroup) this._qr3.nucleusGroup.position.copy(ter.position);
                if (this._qr3.sphereGroup)  this._qr3.sphereGroup.position.copy(ter.position);
                if (this._qr3.shellsGroup)  this._qr3.shellsGroup.position.copy(ter.position);

                const cam = qr.camera;
                const distTerCam = cam ? cam.position.distanceTo(ter.position) : terDist;
                await this._qr3.updateLOD(distTerCam, dt);
                // Si los orbitales están visibles, apagar la esfera Fibonacci
                const hideSphereTer = this._qr3._orbitFade > 0.01;
                this._qr3.sphereGroup?.children.forEach(p => {
                    if (p.material?.uniforms?.uLodFade)
                        p.material.uniforms.uLodFade.value = hideSphereTer ? 0.0 : this._qr3._lodFade;
                });
                if (ter.sphereMesh) ter.sphereMesh.visible = false;
                this._qr3.update(elapsed, dt);
            } else {
                // Fuera de rango orbital o qr3 no listo — limpiar y restaurar esfera
                if (this._loadedSym3) { this._qr3?.clear(); this._loadedSym3 = null; }
                // Solo mostrar la esfera si el terciario está lejos de la cámara
                // Si está cerca pero qr3 no está listo aún, ocultar esfera para evitar
                // el flash de la esfera sobre los orbitales que se están cargando
                const cam = qr.camera;
                const distTerCam = cam ? cam.position.distanceTo(ter.position) : terDist;
                const farFromCam = distTerCam > (this._activeRadius * 0.5);
                if (ter.sphereMesh) ter.sphereMesh.visible = farFromCam;
            }
        } else {
            // Sin terciario — limpiar qr3 y restaurar esfera
            if (this._tertiary) {
                if (this._tertiary.sphereMesh) this._tertiary.sphereMesh.visible = true;
                this._tertiary = null;
            }
            if (this._loadedSym3) {
                this._qr3?.clear();
                this._loadedSym3 = null;
            }
        }

        // ── Bond state del primario ───────────────────────────────────────────
        if (lodState !== 'far' && lodState !== 'mid') {
            const dir = new THREE.Vector3()
                .subVectors(sec.position, primary.position)
                .normalize();
            const secColor = sec.sphereMesh?.material?.uniforms?.uColor?.value ?? null;
            const realBond = _findBond(primary, sec);

            if (realBond) {
                const exchangeStrength = { covalent: 1.0, ionic: 0.7, metallic: 0.5 }[realBond.type] ?? 0.8;
                qr.setBondState(3, { dir, strength: exchangeStrength, color: secColor });
            } else if (inOrbitalRange) {
                const raw      = 1.0 - (secDist / interactionDist);
                const strength = Math.pow(Math.max(0, raw), 1.5);
                qr.setBondState(1, { dir, strength, color: secColor });
            } else {
                if (qr._bondState?.state > 0) qr.setBondState(0, {});
            }
        } else {
            if (qr._bondState?.state > 0) qr.setBondState(0, {});
        }

        qr.update(elapsed, dt);
    }

    /**
     * Llamar desde app.js cuando se borra un átomo.
     */
    onAtomRemoved(atomId) {
        this._active.delete(atomId);
        if (this._primary?.id === atomId) {
            this._primary = null;
            this._loadedSym = null;
            this._qr.clear();
        }
        if (this._secondary?.id === atomId) {
            this._secondary  = null;
            this._loadedSym2 = null;
            this._qr2?.clear();
        }
        if (this._tertiary?.id === atomId) {
            this._tertiary   = null;
            this._loadedSym3 = null;
            this._qr3?.clear();
        }
    }

    get activeRadius() { return this._activeRadius; }
    get primaryAtom()  { return this._primary; }

    dispose() {
        for (const [, atom] of this._active) {
            if (atom.sphereMesh) atom.sphereMesh.visible = true;
        }
        this._active.clear();
        this._loadedSym  = null;
        this._loadedSym2 = null;
        this._loadedSym3 = null;
        this._primary    = null;
        this._secondary  = null;
        this._tertiary   = null;
        this._qr2?.dispose?.();
        this._qr3?.dispose?.();
    }
}

// ── Helpers privados ──────────────────────────────────────────────────────────

/**
 * r_sample_pm del orbital de valencia del metadata.
 * Usa el mayor r_sample entre todos los orbitales de capa valence.
 * Fallback: r_max_pm si no hay r_sample.
 */
function _valenceRSample(orbMeta) {
    const valence = orbMeta.orbitals.filter(o => o.layer === 'valence');
    if (!valence.length) {
        // Sin capa valence explícita — usar el mayor r_sample de todos
        return orbMeta.orbitals.reduce((mx, o) =>
            Math.max(mx, o.r_sample_pm ?? o.r_max_pm ?? R_SAMPLE_FALLBACK), R_SAMPLE_FALLBACK);
    }
    return valence.reduce((mx, o) =>
        Math.max(mx, o.r_sample_pm ?? o.r_max_pm ?? R_SAMPLE_FALLBACK), R_SAMPLE_FALLBACK);
}

/**
 * Estima r_sample del vecino sin tener su metadata orbital.
 * Usa vanderwaals_radius si está disponible, sino radio covalente * 1.5.
 * Es una aproximación — suficiente para la zona de interacción visual.
 */
function _rSampleFromAtom(atom) {
    const vdw = atom.elementData?.atomic_structure?.vanderwaals_radius_pm;
    if (vdw) return vdw * 1.5;  // r_sample ≈ 1.5× vdw es una buena aproximación
    return (atom.radius ?? 80) * 2.0;
}

/**
 * Busca si hay un bond real entre dos átomos en atom.bonds del primario.
 */
function _findBond(atomA, atomB) {
    for (const bond of atomA.bonds) {
        if (bond.atomA?.id === atomB.id || bond.atomB?.id === atomB.id) return bond;
    }
    return null;
}

/**
 * Los dos vecinos más cercanos al primario (excluye al primario mismo).
 * Retorna [neighbor1, neighbor2] — alguno puede ser null si no hay suficientes.
 */
function _closestNeighbors(nearAtoms, primary) {
    const neighbors = nearAtoms.filter(e => e.atom.id !== primary.id);
    return [neighbors[0] ?? null, neighbors[1] ?? null];
}
