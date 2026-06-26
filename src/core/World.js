/**
 * World.js — Director de orquesta del simulador
 *
 * Responsabilidades:
 *   - Contiene todos los átomos y bonds del workspace
 *   - Ejecuta el loop de física (fuerzas → integración → sincronización)
 *   - Detecta y forma bonds automáticamente por solapamiento
 *   - Limpia bonds rotos cada frame
 *   - SpatialHashGrid para queries O(N) de vecinos cercanos
 *   - Expone API para agregar/eliminar átomos desde la UI
 *
 * Uso:
 *   import { World } from './World.js';
 *
 *   const world = new World(scene);
 *   await world.init();
 *
 *   // Agregar átomos
 *   const fe = await world.addAtom('Fe', { x: 0, y: 2, z: 0 });
 *   const o  = await world.addAtom('O',  { x: 1, y: 2, z: 0 });
 *
 *   // Loop principal (llamar desde requestAnimationFrame)
 *   world.update(dt);
 */

import * as THREE from 'three';
import { Atom } from './Atom.js';
import { Bond } from './Bond.js';
import { ElementLoader } from '../data/ElementLoader.js';

// ── Constantes ─────────────────────────────────────────────────────────────

// Tamaño de celda del SpatialHashGrid en world units
// Debe ser ~2× el radio máximo de interacción
const GRID_CELL_SIZE = 400;  // pm = wu — celda de ~4Å

// Factor de overlap para detección de bond: si dist < (rA + rB) * factor → bond
// El umbral es dinámico por elemento — no hay tope fijo en wu
const BOND_OVERLAP_FACTOR = 1.15;

// Gravedad real en wu/s² — a escala atómica es imperceptible sin multiplicador
// g = 9.807e12 wu/s² (valor real con 1wu=1pm)
// El multiplicador por defecto es 0 (OFF) — el usuario lo sube desde el Lab
const G_REAL = 9.807e12;
const DEFAULT_GRAVITY_MULTIPLIER = 0;  // OFF por defecto — honesto: a esta escala no se siente

// Amortiguamiento global de velocidad (air friction)
const DEFAULT_DAMPING = 0.98;

// Piso del mundo
const FLOOR_Y = -500;               // pm = wu

// Coeficiente de rebote en el piso
const DEFAULT_RESTITUTION = 0.3;

// ── SpatialHashGrid ────────────────────────────────────────────────────────

class SpatialHashGrid {
    constructor(cellSize) {
        this.cellSize = cellSize;
        this.cells    = new Map();
    }

    // Hash numérico — sin string allocation en el hot path.
    // Usa bit-shifting con primos grandes para minimizar colisiones.
    // Rango seguro: coordenadas en ±8192 celdas (~3.2M pm con cellSize=400).
    _key(cx, cy, cz) {
        // Desplazar a positivo (máx ±8192 → +8192 = 0..16384, 14 bits)
        const x = (cx + 8192) & 0x3FFF;
        const y = (cy + 8192) & 0x3FFF;
        const z = (cz + 8192) & 0x3FFF;
        // Empaquetar en un número de 42 bits — seguro en JS float64
        return x * 268435456 + y * 16384 + z; // x<<28 + y<<14 + z
    }

    clear() {
        this.cells.clear();
    }

    insert(atom) {
        const cx  = Math.floor(atom.position.x / this.cellSize);
        const cy  = Math.floor(atom.position.y / this.cellSize);
        const cz  = Math.floor(atom.position.z / this.cellSize);
        const key = this._key(cx, cy, cz);
        if (!this.cells.has(key)) this.cells.set(key, []);
        this.cells.get(key).push(atom);
    }

    getNearby(position) {
        const cx = Math.floor(position.x / this.cellSize);
        const cy = Math.floor(position.y / this.cellSize);
        const cz = Math.floor(position.z / this.cellSize);
        const result = [];
        for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
            const cell = this.cells.get(this._key(cx+dx, cy+dy, cz+dz));
            if (cell) result.push(...cell);
        }
        return result;
    }

    getInRadius(position, radius) {
        const cx   = Math.floor(position.x / this.cellSize);
        const cy   = Math.floor(position.y / this.cellSize);
        const cz   = Math.floor(position.z / this.cellSize);
        const span = Math.ceil(radius / this.cellSize);
        const r2   = radius * radius;
        const result = [];
        for (let dx = -span; dx <= span; dx++)
        for (let dy = -span; dy <= span; dy++)
        for (let dz = -span; dz <= span; dz++) {
            const cell = this.cells.get(this._key(cx+dx, cy+dy, cz+dz));
            if (!cell) continue;
            for (const atom of cell) {
                const d2 = position.distanceToSquared(atom.position);
                if (d2 <= r2) result.push({ atom, dist: Math.sqrt(d2) });
            }
        }
        return result;
    }
}

// ── Clase World ────────────────────────────────────────────────────────────

export class World {

    /**
     * @param {THREE.Scene} scene - Escena Three.js donde vivem los meshes
     */
    constructor(scene, qr = null) {
        this.scene  = scene;
        this.qr     = qr;    // QuantumRenderer — para crear esferas visuales

        // Colecciones principales
        this.atoms  = new Map();   // id → Atom
        this.bonds  = new Map();   // id → Bond

        // SpatialHashGrid para queries de vecinos
        this.grid   = new SpatialHashGrid(GRID_CELL_SIZE);

        // Tiempo acumulado en segundos — actualizado por el loop externo vía update(dt)
        this._elapsed = 0;

        // ── Parámetros de física (modificables desde UI) ───────────────────
        this.params = {
            gravity:          G_REAL,            // wu/s² — valor real, no tocar
            damping:          DEFAULT_DAMPING,
            floorY:           FLOOR_Y,
            restitution:      DEFAULT_RESTITUTION,
            gravityEnabled:   false,             // OFF por defecto — honesto
            floorEnabled:     true,
            floorVisible:     true,
            bondsVisible:     true,
            pauliEnabled:     true,
            autoBond:         true,       // detección automática de bonds
            thermalDissociation: false,   // 🔥 romper bonds por energía cinética (kBT > De)
            metathesisEnabled:   false,   // ⚗️ intercambio A-B + C-D → A-C + B-D
            pauliStrength:    500.0,      // fuerza cuadrática — calibrada para integrador dt-based
            pauliFactor:      2.0,        // exponente: 2=cuadrático (suave pero firme)
            gravityMultiplier: DEFAULT_GRAVITY_MULTIPLIER,

            // Lennard-Jones (Van der Waals) — atracción intermolecular
            ljEnabled:        false,      // OFF por defecto — toggle en panel Física
            ljStrength:       0.02,       // escala global (0-1)
            ljCutoff:         800,        // pm — radio de corte

            // Fuerzas angulares — geometría VSEPR emergente por potencial armónico angular
            // ON por defecto — reemplaza XPBD con física real (gradiente de energía angular)
            bondAnglesEnabled: true,
            bondAngleStrength: 0.5,       // 0-1 — escala k_theta = strength * 800

            // Techo — plano superior que confina átomos
            ceilingEnabled:     false,
            ceilingY:           1500,      // wu (15 × 100, misma escala visual que el slider)
            ceilingRestitution: 0.6,

            // Esfera recipiente — confina átomos dentro de un radio
            sphereEnabled:      false,
            sphereRadius:       2000,      // wu
            sphereCenterY:      0,         // wu
            sphereRestitution:  0.6,
        };

        // Cache de moléculas para LJ — evita comparar átomos de la misma molécula
        this._ljMoleculeCache = null;
        this._ljCacheDirty    = true;

        // Estado
        this._running = false;
        this._frame   = 0;

        // Contador reactivo de moléculas — se actualiza en addBond/removeBond/removeAtom.
        // Evita el BFS cada 30 frames que congelaba el hilo principal.
        this._moleculeCount = 0;

        console.log('[World] Instancia creada 🌍');
    }

    // ── Inicialización ─────────────────────────────────────────────────────

    /**
     * Inicializa el mundo — carga el índice de elementos.
     * Llamar una vez antes del primer update().
     * @returns {Promise<World>} this
     */
    async init() {
        await ElementLoader.init();
        this._running = true;
        this._elapsed = 0;  // tiempo acumulado en segundos, actualizado desde el loop
        console.log('[World] Inicializado ✅ — listo para simular');
        return this;
    }

    // ── API pública — Átomos ───────────────────────────────────────────────

    /**
     * Crea un átomo, lo carga y lo agrega a la escena.
     * @param {string} symbol
     * @param {Object} position - { x, y, z }
     * @param {Object} [opts]   - opciones para Atom constructor
     * @returns {Promise<Atom>}
     */
    async addAtom(symbol, position = { x: 0, y: 0, z: 0 }, opts = {}) {
        const atom = new Atom(symbol, position, opts);
        await atom.init();

        this.atoms.set(atom.id, atom);
        this.scene.add(atom.mesh);  // hitMesh invisible para raycasting

        // Jaula de detección — visible si ya estamos en modo Diseño
        if (atom._cagePts) {
            atom._cagePts.position.copy(atom.position);
            this.scene.add(atom._cagePts);
            atom.setCageVisible(this._designMode ?? false);
        }

        // Esfera visual creada por el QR (tiene el material correcto del elemento)
        if (this.qr) {
            atom.sphereMesh = await this.qr.createAtomSphere(atom);
        }

        console.log(`[World] ➕ ${symbol} #${atom.id} (total: ${this.atoms.size})`);
        // Callback para sistemas externos (e.g. PhysicsPanel CPK, QV profiles)
        this._onAtomAdded?.(atom);
        return atom;
    }

    /**
     * Elimina un átomo y todos sus bonds del mundo.
     * @param {number} atomId
     */
    removeAtom(atomId) {
        const atom = this.atoms.get(atomId);
        if (!atom) return;

        // Eliminar todos sus bonds
        for (const bond of [...atom.bonds]) {
            this.removeBond(bond.id);
        }

        this.scene.remove(atom.mesh);
        // Limpiar jaula de detección
        if (atom._cagePts) {
            this.scene.remove(atom._cagePts);
            atom._cagePts.geometry?.dispose();
            atom._cageMat?.dispose();
            atom._cagePts = null;
        }
        // Limpiar esfera visual si existe
        if (atom.sphereMesh) {
            this.scene.remove(atom.sphereMesh);
            atom.sphereMesh.geometry?.dispose();
            atom.sphereMesh.material?.dispose();
            atom.sphereMesh = null;
        }
        atom.dispose();
        this.atoms.delete(atomId);
        this._recomputeMoleculeCount();
        console.log(`[World] ➖ Átomo eliminado: ${atom.symbol} #${atomId} (total: ${this.atoms.size})`);
    }

    /**
     * Elimina todos los átomos y bonds del mundo.
     */
    clear() {
        for (const id of [...this.atoms.keys()]) this.removeAtom(id);
        console.log('[World] 🧹 Mundo limpiado');
    }

    /**
     * Devuelve todos los átomos de la misma molécula (flood-fill por bonds).
     * @param {Atom} startAtom
     * @returns {Atom[]}
     */
    getMoleculeAtoms(startAtom) {
        const visited = new Set();
        const queue   = [startAtom];
        visited.add(startAtom.id);

        while (queue.length > 0) {
            const atom = queue.shift();
            for (const bond of atom.bonds) {
                const nb = bond.atomA?.id === atom.id ? bond.atomB : bond.atomA;
                if (nb && !visited.has(nb.id)) {
                    visited.add(nb.id);
                    queue.push(nb);
                }
            }
        }

        return [...visited].map(id => this.atoms.get(id)).filter(Boolean);
    }

    // ── API pública — Bonds ────────────────────────────────────────────────

    /**
     * Crea un bond entre dos átomos manualmente.
     * @param {Atom} atomA
     * @param {Atom} atomB
     * @param {Object} [opts] - opciones para Bond constructor
     * @returns {Bond}
     */
    addBond(atomA, atomB, opts = {}) {
        // Evitar bond duplicado
        if (this._bondExists(atomA, atomB)) {
            console.warn(`[World] Bond ${atomA.symbol}—${atomB.symbol} ya existe`);
            return null;
        }

        // FIX 1 Velvet: usar posición predicha (1 frame adelante)
        const dt = 0.016;
        const predictedB = atomB.position.clone().addScaledVector(atomB.velocity, dt);
        const predictedA = atomA.position.clone().addScaledVector(atomA.velocity, dt);

        // Orientar pelitos hacia posición estabilizada del vecino
        const pelitoA = atomA.orientPelitoToward?.(predictedB);
        const pelitoB = atomB.orientPelitoToward?.(predictedA);

        const bond = new Bond(atomA, atomB, opts);
        bond.init();

        this.bonds.set(bond.id, bond);
        this.scene.add(bond.mesh);

        // Marcar pelitos como ocupados
        if (pelitoA) atomA.occupyPelito(pelitoA.index, bond);
        if (pelitoB) atomB.occupyPelito(pelitoB.index, bond);

        // FIX 3 Velvet: re-orientar después de 3 frames cuando todo se estabilizó
        bond._alignDelay = 3;
        bond._alignAtoms = [atomA, atomB];

        // ⚡ Flash de enlace — destello visual al formarse el bond (LVM v1.1)
        // Marca ambos átomos con un pulso temporal que decae en _syncMeshes
        atomA._bondFlash = 1.0;
        atomB._bondFlash = 1.0;

        // 🎧 Flash sonoro — resolución armónica (LSM)
        if (this._onBondCreated) this._onBondCreated(atomA, atomB);

        this._ljCacheDirty = true;
        this._recomputeMoleculeCount();
        return bond;
    }

    /**
     * Elimina un bond del mundo.
     * @param {number} bondId
     */
    removeBond(bondId) {
        const bond = this.bonds.get(bondId);
        if (!bond) return;

        // Liberar pelitos ocupados por este bond
        if (bond.atomA?._pelitos) {
            for (const p of bond.atomA._pelitos) {
                if (p.bondRef === bond) bond.atomA.freePelito(p.index);
            }
        }
        if (bond.atomB?._pelitos) {
            for (const p of bond.atomB._pelitos) {
                if (p.bondRef === bond) bond.atomB.freePelito(p.index);
            }
        }

        this.scene.remove(bond.mesh);
        bond.dispose();
        this.bonds.delete(bondId);
        this._ljCacheDirty = true;
        this._recomputeMoleculeCount();
    }

    // ── Loop principal ─────────────────────────────────────────────────────

    /**
     * Actualiza toda la simulación un frame.
     * Llamar desde el animation loop de Three.js.
     *
     * @param {number} [dtOverride] - delta time manual (opcional, en segundos)
     */
    update(dtOverride) {
        if (!this._running) return;

        // dt viene del loop externo (app.js usa THREE.Timer)
        // Si no se pasa, usamos un frame a 60fps como fallback
        const dt = Math.min(dtOverride ?? (1 / 60), 0.033);
        this._elapsed += dt;
        this._frame++;

        // 1. Reconstruir grid espacial
        this._rebuildGrid();

        // 2. Aplicar fuerzas externas (gravedad, Pauli)
        this._applyExternalForces();

        // 2b. Lennard-Jones (Van der Waals) — atracción/repulsión intermolecular
        if (this.params.ljEnabled) this._applyLennardJones();

        // 3. Aplicar fuerzas de bonds + tick de bond_progress
        this._applyBondForces(dt);

        // 3b. Fuerzas angulares — geometría VSEPR emergente por potencial armónico puro.
        // Corre ANTES de integrate para que todas las fuerzas se acumulen juntas.
        if (this.params.bondAnglesEnabled) this._applyAngularForces(dt);

        // 4. Integrar física
        this._integrate(dt);

        // 4d. Relajación continua de pelitos — solo visual (orienta la jaula VSEPR)
        this._relaxPelitoOrientations();
        // Después de que los átomos se estabilicen, re-orientar los pelitos
        // para alinearlos con la posición real del vecino (no la del frame del bond)
        this._processDelayedAlignments();

        // 5. Resolver colisiones con superficies
        this._resolveFloor();
        this._resolveCeiling();
        this._resolveSphere();

        // 6. Detección automática de bonds
        if (this.params.autoBond) this._detectBonds();

        // 6b. Metátesis — intercambio de bonds A-B + C-D → A-C + B-D
        if (this.params.metathesisEnabled) this._detectMetathesis();

        // 7. Limpiar bonds rotos
        this._cleanBrokenBonds();

        // 7b. Disociación térmica — kBT > De rompe bonds con probabilidad Boltzmann
        if (this.params.thermalDissociation) this._applyThermalDissociation();

        // 8. Sincronizar meshes con posiciones
        this._syncMeshes();

        // Log cada 300 frames (~5s a 60fps)
        if (this._frame % 300 === 0) {
            console.log(`[World] Frame ${this._frame} | átomos: ${this.atoms.size} | bonds: ${this.bonds.size}`);
        }
    }

    // ── Parámetros de física ───────────────────────────────────────────────

    /**
     * Actualiza uno o varios parámetros de física.
     * @param {Object} newParams
     */
    setParams(newParams) {
        Object.assign(this.params, newParams);
        console.log('[World] ⚙️ Parámetros actualizados:', Object.keys(newParams).join(', '));
    }

    /**
     * Establece la temperatura actual del sistema — llamado por PhysicsPanel cada frame.
     * Usada por _applyThermalDissociation() para calcular kBT.
     * @param {number} kelvin
     */
    setTemperature(kelvin) { this._temperature = kelvin; }

    /**
     * Pausa/reanuda la simulación.
     * @param {boolean} running
     */
    setRunning(running) {
        this._running = running;
        console.log(`[World] ${running ? '▶️ Simulación reanudada' : '⏸️ Simulación pausada'}`);
    }

    /**
     * Activa/desactiva modo Diseño — controla visibilidad de jaulas.
     * @param {boolean} design
     */
    setDesignMode(design) {
        this._designMode = design;
        for (const atom of this.atoms.values()) {
            atom.setCageVisible(design);
            if (!design) atom.clearActiveCagePoint();
        }
    }

    /**
     * Congela/descongela todos los átomos.
     * @param {boolean} frozen
     */
    setAllFrozen(frozen) {
        for (const atom of this.atoms.values()) atom.setFrozen(frozen);
        console.log(`[World] ${frozen ? '❄️ Todos los átomos congelados' : '🔥 Todos los átomos descongelados'}`);
    }

    /**
     * Muestra/oculta todos los bonds.
     * @param {boolean} visible
     */
    setBondsVisible(visible) {
        this.params.bondsVisible = visible;
        for (const bond of this.bonds.values()) bond.setVisible(visible);
    }

    /**
     * Serializa el estado completo del mundo.
     */
    serialize() {
        return {
            atoms: [...this.atoms.values()].map(a => a.serialize()),
            bonds: [...this.bonds.values()].map(b => b.serialize()),
            params: { ...this.params },
        };
    }

    /**
     * Devuelve los átomos dentro de un radio desde una posición (ej: cámara).
     * Usa el SpatialHashGrid — O(átomos en el radio), no O(N total).
     * @param {THREE.Vector3} position
     * @param {number} radius — en world units
     * @returns {Array<{atom, dist}>} ordenados de más cercano a más lejano
     */
    getAtomsInRadius(position, radius) {
        const results = this.grid.getInRadius(position, radius);
        return results.sort((a, b) => a.dist - b.dist);
    }

    // ── Privado — Loop de física ───────────────────────────────────────────

    _rebuildGrid() {
        this.grid.clear();
        for (const atom of this.atoms.values()) {
            this.grid.insert(atom);
        }
    }

    _applyExternalForces() {
        // g_effective = g_real * multiplier — por defecto 0 (imperceptible a escala atómica)
        const gEff = this.params.gravityEnabled
            ? -this.params.gravity * this.params.gravityMultiplier
            : 0;
        const gravVec = new THREE.Vector3(0, gEff, 0);

        for (const atom of this.atoms.values()) {
            if (atom.frozen) continue;

            // Gravedad: F = m * g
            if (this.params.gravityEnabled) {
                atom.applyForce(gravVec.clone().multiplyScalar(atom.mass));
            }

            // Amortiguamiento de velocidad (air friction)
            atom.velocity.multiplyScalar(this.params.damping);

            // Repulsión de Pauli con vecinos cercanos
            if (this.params.pauliEnabled) {
                this._applyPauli(atom);
            }
        }
    }

    _applyPauli(atom) {
        const nearby = this.grid.getNearby(atom.position);
        for (const other of nearby) {
            if (other.id === atom.id) continue;

            // Excluir pares enlazados — el potencial de Morse maneja su interacción.
            // Pauli es exclusivamente para contactos no-enlazados (van der Waals).
            // Sin esto: todos los bonds aromáticos (C-C 140pm < threshold 154pm)
            // y cualquier H en geometría apretada reciben repulsión masiva.
            let bonded = false;
            for (const b of atom.bonds) {
                if (b.atomA === other || b.atomB === other) { bonded = true; break; }
            }
            if (bonded) continue;

            const ab   = new THREE.Vector3().subVectors(atom.position, other.position);
            const dist = ab.length();
            if (dist < 0.1) continue;

            const minDist = atom.radius + other.radius;
            if (dist < minDist) {
                const overlap  = minDist - dist;
                const forceMag = this.params.pauliStrength
                               * Math.pow(overlap, this.params.pauliFactor)
                               / minDist;
                const force    = ab.normalize().multiplyScalar(forceMag);
                atom.applyForce(force);
            }
        }
    }

    // ── Lennard-Jones (Van der Waals) ──────────────────────────────────────
    //
    // Fuerza intermolecular: atracción a larga distancia, repulsión a corta.
    // F = 24ε/r × [2(σ/r)¹² - (σ/r)⁶]
    // Solo entre átomos de DIFERENTES moléculas (LJ es intermolecular).
    // Usa SpatialHashGrid para O(N) en lugar de O(N²).

    _applyLennardJones() {
        const atoms = [...this.atoms.values()];
        if (atoms.length < 2) return;

        // Reconstruir cache de moléculas si está sucio
        if (this._ljCacheDirty) {
            this._buildMoleculeCache(atoms);
            this._ljCacheDirty = false;
        }

        const cutoff   = this.params.ljCutoff;
        const strength = this.params.ljStrength;
        const processed = new Set();
        const _delta = new THREE.Vector3();

        for (const a of atoms) {
            if (a.frozen) continue;
            const nearby = this.grid.getNearby(a.position);

            for (const b of nearby) {
                if (a.id >= b.id) continue;           // evitar duplicados
                if (a.frozen && b.frozen) continue;

                // Clave única por par
                const pairKey = a.id < b.id ? `${a.id}-${b.id}` : `${b.id}-${a.id}`;
                if (processed.has(pairKey)) continue;
                processed.add(pairKey);

                // Skip misma molécula — LJ es solo intermolecular
                if (this._sameMolecule(a, b)) continue;

                _delta.subVectors(b.position, a.position);
                const r = _delta.length();
                if (r > cutoff || r < 1) continue;

                // Parámetros LJ combinados (Lorentz-Berthelot)
                const sigma   = this._ljSigma(a, b);
                const epsilon = this._ljEpsilon(a, b);

                // F = 24ε/r × [2(σ/r)¹² - (σ/r)⁶]
                const sr  = sigma / r;
                const sr6 = sr * sr * sr * sr * sr * sr;
                const sr12 = sr6 * sr6;
                const forceMag = (24 * epsilon / r) * (2 * sr12 - sr6) * strength;

                // Escalar para integrador dt-based (mismo factor que Pauli)
                const force = _delta.normalize().multiplyScalar(forceMag * 500);

                if (!a.frozen) a.applyForce(force);
                if (!b.frozen) b.applyForce(force.clone().negate());
            }
        }
    }

    /** σ combinado = media aritmética de radios VdW */
    _ljSigma(a, b) {
        const rA = a.elementData?.atomic_structure?.vanderwaals_radius_pm
                 ?? a.radius * 2.5;
        const rB = b.elementData?.atomic_structure?.vanderwaals_radius_pm
                 ?? b.radius * 2.5;
        return (rA + rB) / 2;
    }

    /** ε combinado = media geométrica (estimación por polarizabilidad) */
    _ljEpsilon(a, b) {
        // Estimación simple: εAB = sqrt(εA × εB)
        // ε ∝ polarizabilidad ∝ Z × 0.01 (muy simplificado)
        const zA = a.elementData?.identity?.number ?? 1;
        const zB = b.elementData?.identity?.number ?? 1;
        return Math.sqrt(zA * zB) * 0.0001;
    }

    /** Construir cache de moléculas por BFS */
    _buildMoleculeCache(atoms) {
        this._ljMoleculeCache = new Map(); // atomId → moleculeId
        const visited = new Set();
        let molId = 0;

        for (const atom of atoms) {
            if (visited.has(atom.id)) continue;
            const queue = [atom];
            visited.add(atom.id);
            while (queue.length > 0) {
                const current = queue.shift();
                this._ljMoleculeCache.set(current.id, molId);
                for (const bond of current.bonds) {
                    const nb = bond.atomA.id === current.id ? bond.atomB : bond.atomA;
                    if (!visited.has(nb.id)) {
                        visited.add(nb.id);
                        queue.push(nb);
                    }
                }
            }
            molId++;
        }
    }

    /** ¿Pertenecen al mismo cluster de bonds? */
    _sameMolecule(a, b) {
        if (!this._ljMoleculeCache) return false;
        const mA = this._ljMoleculeCache.get(a.id);
        const mB = this._ljMoleculeCache.get(b.id);
        return mA !== undefined && mA === mB;
    }

    // ── Angular Bending Potential ─────────────────────────────────────────
    //
    // Geometría emergente basada en fuerzas puras (Éter / Gemini).
    // Reemplaza XPBD: en vez de teletransportar posiciones, calcula el
    // gradiente de energía angular y lo aplica como fuerza física real.
    // El integrador de Euler produce la geometría VSEPR correcta de forma
    // natural — sin patches, sin condiciones especiales por molécula.
    //
    // F = -k_θ * (θ - θ₀) / len  → perpendicular al enlace, en el plano A1-C-A2
    // Tercera ley de Newton: el átomo central absorbe -( f1 + f2 )

    _applyAngularForces(dt) {
        const k_global = this.params.bondAngleStrength * 500;

        for (const atom of this.atoms.values()) {
            if (atom.frozen || atom.bonds.size < 2) continue;

            const bonds = [...atom.bonds];
            const idealDeg = atom.elementData?.reactivity?.ideal_bond_angle
                          ?? this._idealAngle(bonds.length, atom);
            const idealRad = idealDeg * (Math.PI / 180);

            for (let i = 0; i < bonds.length; i++) {
                for (let j = i + 1; j < bonds.length; j++) {
                    const b1 = bonds[i];
                    const b2 = bonds[j];
                    if (b1.progress < 0.5 || b2.progress < 0.5) continue;

                    const a1 = b1.atomA.id === atom.id ? b1.atomB : b1.atomA;
                    const a2 = b2.atomA.id === atom.id ? b2.atomB : b2.atomA;

                    const r1 = new THREE.Vector3().subVectors(a1.position, atom.position);
                    const r2 = new THREE.Vector3().subVectors(a2.position, atom.position);
                    const len1 = r1.length();
                    const len2 = r2.length();

                    // 🛑 Seguridad: evitar división por cero en colisiones/vibraciones rápidas
                    if (len1 < 5 || len2 < 5) continue;

                    const d1 = r1.clone().divideScalar(len1);
                    const d2 = r2.clone().divideScalar(len2);
                    const dot = Math.max(-1, Math.min(1, d1.dot(d2)));

                    if (bonds.length === 6 && dot < -0.7) continue;

                    const currentRad = Math.acos(dot);
                    const diff = currentRad - idealRad;
                    if (Math.abs(diff) < 0.01) continue;

                    const normal = new THREE.Vector3().crossVectors(d1, d2);
                    if (normal.lengthSq() < 0.0001) continue;
                    normal.normalize();

                    const f1Dir = new THREE.Vector3().crossVectors(d1, normal).normalize();
                    const f2Dir = new THREE.Vector3().crossVectors(normal, d2).normalize();

                    // Escalar por bond_energy_ev del elemento central — bonds fuertes
                    // resisten más la deformación angular (emerge de los datos reales)
                    const bondEnergyScl = atom.elementData?.reactivity?.bond_energy_ev ?? 1.0;
                    const forceMag = -k_global * bondEnergyScl * diff;

                    // Normalizar por dt*60: calibrado para 60fps, estable a cualquier framerate
                    const f1 = f1Dir.multiplyScalar((forceMag / len1) * dt * 60);
                    const f2 = f2Dir.multiplyScalar((forceMag / len2) * dt * 60);
                    const fC = new THREE.Vector3().addVectors(f1, f2).negate();

                    if (!a1.frozen)   a1.applyForce(f1);
                    if (!a2.frozen)   a2.applyForce(f2);
                    if (!atom.frozen) atom.applyForce(fC);
                }
            }
        }
    }

    /** Ángulo ideal VSEPR — fallback cuando elementData.reactivity.ideal_bond_angle no existe */
    _idealAngle(n, atom) {
        // Overrides por pares solitarios (lone pairs empujan ángulos hacia abajo)
        if (atom) {
            const sym = atom.symbol;
            if (sym === 'O' && n === 2) return 104.5;
            if (sym === 'N' && n === 3) return 107;
            if (sym === 'S' && n === 2) return 104.5;
        }
        switch (n) {
            case 2: return 180;
            case 3: return 120;
            case 4: return 109.5;
            case 5: return 90;
            case 6: return 90;
            default: return 120;
        }
    }

    // ── Orientación de pelitos (Step 1) — corre en AMBOS modos ───────────
    // Solo rota pelitos para seguir a los bond partners reales.
    // Sin corrección de posición — seguro en diseño y durante la transición.
    _orientPelitosOnly() {
        const RELAX_SPEED = 0.10;
        const _currentMean = new THREE.Vector3();
        const _targetMean  = new THREE.Vector3();

        for (const atom of this.atoms.values()) {
            if (!atom._pelitos) continue;

            const pairs = [];
            for (const p of atom._pelitos) {
                if (!p.occupied || !p.bondRef) continue;
                const bond    = p.bondRef;
                const partner = bond.atomA === atom ? bond.atomB : bond.atomA;
                if (!partner) continue;
                const target = new THREE.Vector3()
                    .subVectors(partner.position, atom.position);
                if (target.lengthSq() < 0.0001) continue;
                target.normalize();
                pairs.push({ pelito: p, target });
            }

            if (pairs.length === 0) continue;

            _currentMean.set(0, 0, 0);
            _targetMean.set(0, 0, 0);
            for (const { pelito, target } of pairs) {
                _currentMean.add(pelito.direction);
                _targetMean.add(target);
            }

            // Guard: baricentro puede ser ~0 en geometrías simétricas (3 bonds a 120°,
            // 4 bonds tetraédricos, etc.) — los vectores se anulan mutuamente.
            // En ese caso la molécula YA está en su geometría VSEPR → no rotar.
            if (_currentMean.lengthSq() < 0.001 || _targetMean.lengthSq() < 0.001) continue;

            _currentMean.normalize();
            _targetMean.normalize();

            const dot = Math.max(-1, Math.min(1, _currentMean.dot(_targetMean)));
            if (dot >= 0.9999) continue;

            const fullQuat = new THREE.Quaternion()
                .setFromUnitVectors(_currentMean, _targetMean);
            const quat = new THREE.Quaternion().slerp(fullQuat, RELAX_SPEED);
            for (const p of atom._pelitos) {
                p.direction.applyQuaternion(quat).normalize();
            }

            if (atom._cageDirs) {
                for (let i = 0; i < atom._cageDirs.length && i < atom._pelitos.length; i++) {
                    atom._cageDirs[i].copy(atom._pelitos[i].direction);
                }
            }
            atom._updateCageVisual?.();
        }
    }

    // ── Relajación continua de pelitos ────────────────────────────────────
    //
    // Cada frame, nudge suave de TODOS los pelitos ocupados hacia sus bond partners
    // reales. Esto garantiza que la geometría VSEPR se restaure siempre:
    //   - Bond recién formado → converge en ~30 frames (~0.5s a 60fps)
    //   - Átomo estirado y soltado → geometría se recupera sola
    //   - Cualquier orden de formación de bonds → resultado siempre correcto
    //
    // Algoritmo por átomo:
    //   1. Para cada pelito ocupado: target = normalize(partner.position - atom.position)
    //   2. Baricentro(directions actuales) → baricentro(targets) = rotación best-fit
    //   3. Slerp pequeño (RELAX_SPEED) → acumulación frame a frame
    //
    // La rotación es rígida → los ángulos VSEPR entre pelitos se preservan.
    // Solo mueve el conjunto, no distorsiona la geometría interna.

    _relaxPelitoOrientations() {
        // Solo visual — orienta la jaula de pelitos para feedback al usuario.
        // La geometría VSEPR real ahora emerge de _applyAngularForces() (física pura).
        // No hay corrección de posición aquí — eso era XPBD, ya eliminado.
    }

    /**
     * FIX 3 Velvet: Re-orientar pelitos después de N frames.
     * Cuando se crea un bond, los átomos aún se están moviendo.
     * Esperamos 3 frames para que se estabilicen y luego re-orientamos.
     */
    _processDelayedAlignments() {
        for (const bond of this.bonds.values()) {
            if (bond._alignDelay === undefined) continue;
            bond._alignDelay--;
            if (bond._alignDelay > 0) continue;

            // Tiempo de re-orientar con posiciones estabilizadas
            const [atomA, atomB] = bond._alignAtoms || [];
            if (atomA?.orientPelitoToward && atomB) {
                atomA.orientPelitoToward(atomB.position);
            }
            if (atomB?.orientPelitoToward && atomA) {
                atomB.orientPelitoToward(atomA.position);
            }

            // Limpiar — ya no necesita más delay
            delete bond._alignDelay;
            delete bond._alignAtoms;
        }
    }

    _applyBondForces(dt) {
        for (const bond of this.bonds.values()) {
            // tick(): avanza bond_progress y detecta muerte real del enlace (Bond v3)
            bond.tick(dt);
            bond.applyForces();
        }
    }

    _integrate(dt) {
        for (const atom of this.atoms.values()) {
            atom.integrate(dt);
        }
    }

    _resolveFloor() {
        if (!this.params.floorEnabled) return;

        for (const atom of this.atoms.values()) {
            if (atom.frozen) continue;
            const floorContact = this.params.floorY + atom.radius;
            if (atom.position.y < floorContact) {
                atom.position.y = floorContact;
                // Rebote
                if (atom.velocity.y < 0) {
                    atom.velocity.y *= -this.params.restitution;
                    // Fricción lateral en el piso
                    atom.velocity.x *= 0.85;
                    atom.velocity.z *= 0.85;
                }
            }
        }
    }

    _resolveCeiling() {
        if (!this.params.ceilingEnabled) return;

        for (const atom of this.atoms.values()) {
            if (atom.frozen) continue;
            const ceilContact = this.params.ceilingY - atom.radius;
            if (atom.position.y > ceilContact) {
                atom.position.y = ceilContact;
                if (atom.velocity.y > 0) {
                    atom.velocity.y *= -this.params.ceilingRestitution;
                    atom.velocity.x *= 0.85;
                    atom.velocity.z *= 0.85;
                }
            }
        }
    }

    _resolveSphere() {
        if (!this.params.sphereEnabled) return;

        const cx = 0;
        const cy = this.params.sphereCenterY;
        const cz = 0;
        const R  = this.params.sphereRadius;

        for (const atom of this.atoms.values()) {
            if (atom.frozen) continue;
            const limit = R - atom.radius;
            if (limit <= 0) continue;

            const dx = atom.position.x - cx;
            const dy = atom.position.y - cy;
            const dz = atom.position.z - cz;
            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

            if (dist > limit) {
                // Empujar hacia adentro — sobre la superficie de la esfera
                const nx = dx / dist;
                const ny = dy / dist;
                const nz = dz / dist;
                atom.position.x = cx + nx * limit;
                atom.position.y = cy + ny * limit;
                atom.position.z = cz + nz * limit;

                // Rebote: reflejar componente radial de la velocidad
                const vDot = atom.velocity.x * nx + atom.velocity.y * ny + atom.velocity.z * nz;
                if (vDot > 0) {
                    const bounce = -(1 + this.params.sphereRestitution) * vDot;
                    atom.velocity.x += nx * bounce;
                    atom.velocity.y += ny * bounce;
                    atom.velocity.z += nz * bounce;
                }
            }
        }
    }

    // ── Disociación Térmica ────────────────────────────────────────────────
    //
    // Cada frame, cada bond tiene probabilidad P = exp(-De/kBT) de romperse.
    // No reemplaza Morse — es un check adicional que modela la química térmica.
    // kBT viene de PhysicsPanel vía setTemperature().

    _applyThermalDissociation() {
        const kB  = 8.617e-5; // eV/K
        const kBT = kB * (this._temperature ?? 300);

        for (const bond of this.bonds.values()) {
            if (bond.checkThermalDissociation(kBT)) {
                bond.targetProgress = 0;
                console.log(`[World] 🔥 Disociación térmica: ${bond.atomA.symbol}-${bond.atomB.symbol} (T=${(this._temperature ?? 300).toFixed(0)}K)`);
            }
        }
    }

    // ── Metátesis ─────────────────────────────────────────────────────────
    //
    // A-B + C-D → A-C + B-D cuando los terminales se acercan lo suficiente.
    // Una metátesis por frame máximo para evitar cascadas.
    // Los bonds viejos mueren via targetProgress=0 (fade out visual).
    // Los bonds nuevos nacen via addBond() con progress=0 (fade in).

    _detectMetathesis() {
        // Procesar pendientes primero: crear nuevos bonds cuando los viejos murieron
        if (this._pendingMetathesis?.length) {
            const stillPending = [];
            for (const p of this._pendingMetathesis) {
                // Esperar a que ambos bonds viejos desaparezcan del mapa
                if (this.bonds.has(p.oldBond1) || this.bonds.has(p.oldBond2)) {
                    stillPending.push(p);
                    continue;
                }
                if (!this._bondExists(p.a1, p.a2)) this.addBond(p.a1, p.a2);
                if (!this._bondExists(p.b1, p.b2)) this.addBond(p.b1, p.b2);
            }
            this._pendingMetathesis = stillPending;
        }

        // Buscar nuevos candidatos — O(bonds²), aceptable (bonds < 50 típicamente)
        const bondArr = [...this.bonds.values()];
        for (let i = 0; i < bondArr.length; i++) {
            const b1 = bondArr[i];
            if (b1.progress < 0.9 || b1.broken || b1.targetProgress <= 0) continue;

            for (let j = i + 1; j < bondArr.length; j++) {
                const b2 = bondArr[j];
                if (b2.progress < 0.9 || b2.broken || b2.targetProgress <= 0) continue;

                // No comparten átomo (si comparten, es una flexión, no metátesis)
                if (b1.atomA === b2.atomA || b1.atomA === b2.atomB ||
                    b1.atomB === b2.atomA || b1.atomB === b2.atomB) continue;

                // Checar las 2 combinaciones de intercambio posibles
                const candidates = [
                    { a1: b1.atomA, a2: b2.atomA, b1: b1.atomB, b2: b2.atomB },
                    { a1: b1.atomA, a2: b2.atomB, b1: b1.atomB, b2: b2.atomA },
                ];

                for (const c of candidates) {
                    const dist1 = c.a1.position.distanceTo(c.a2.position);
                    const dist2 = c.b1.position.distanceTo(c.b2.position);
                    const thr1  = (c.a1.radius + c.a2.radius) * BOND_OVERLAP_FACTOR;
                    const thr2  = (c.b1.radius + c.b2.radius) * BOND_OVERLAP_FACTOR;

                    if (dist1 >= thr1 || dist2 >= thr2) continue;
                    if (!this._canBond(c.a1, c.a2)) continue;
                    if (!this._canBond(c.b1, c.b2)) continue;

                    // ¡Metátesis! Fade out bonds viejos, encolar nuevos
                    b1.targetProgress = 0;
                    b2.targetProgress = 0;
                    this._pendingMetathesis = this._pendingMetathesis ?? [];
                    this._pendingMetathesis.push({
                        a1: c.a1, a2: c.a2, b1: c.b1, b2: c.b2,
                        oldBond1: b1.id, oldBond2: b2.id,
                    });
                    console.log(`[World] ⚗️ Metátesis: ${b1.atomA.symbol}-${b1.atomB.symbol} + ${b2.atomA.symbol}-${b2.atomB.symbol} → ${c.a1.symbol}-${c.a2.symbol} + ${c.b1.symbol}-${c.b2.symbol}`);
                    return; // una por frame
                }
            }
        }
    }

    _detectBonds() {
        for (const atom of this.atoms.values()) {
            // Usar pelitos si existen, fallback a canBond()
            const canA = atom.hasFreePelitos?.() ?? atom.canBond();
            if (!canA) continue;

            const nearby = this.grid.getNearby(atom.position);
            for (const other of nearby) {
                if (other.id <= atom.id) continue;   // evitar duplicados
                const canB = other.hasFreePelitos?.() ?? other.canBond();
                if (!canB) continue;
                if (this._bondExists(atom, other)) continue;

                // Filtro de afinidad química — ¿estos dos elementos PUEDEN enlazarse?
                if (!this._canBond(atom, other)) continue;

                const dist    = atom.position.distanceTo(other.position);
                // Distancia de enlace = suma de radios covalentes × factor de solapamiento
                // No hay tope fijo — cada par de elementos tiene su propia distancia
                const minDist = (atom.radius + other.radius) * BOND_OVERLAP_FACTOR;

                if (dist < minDist) {
                    const type = this._detectBondType(atom, other);
                    this.addBond(atom, other, { type });
                    console.log(`[World] 🔗 Bond auto-detectado: ${atom.symbol}—${other.symbol} (${type}) dist: ${dist.toFixed(1)}wu | umbral: ${minDist.toFixed(1)}wu`);
                }
            }
        }
    }

    _cleanBrokenBonds() {
        for (const [id, bond] of this.bonds.entries()) {
            if (bond.isBroken()) {
                this.removeBond(id);
                console.log(`[World] 🧹 Bond roto eliminado #${id}`);
            }
        }
    }

    /**
     * Sincroniza posiciones de meshes con el estado físico actual.
     * Llamado automáticamente desde update() en modo Sim.
     * En modo Diseño, app.js lo llama directamente para que el joystick
     * pueda mover átomos visualmente aunque la física esté pausada.
     */
    syncMeshes() {
        this._syncMeshes();
    }

    _syncMeshes() {
        const t = this._elapsed;

        for (const atom of this.atoms.values()) {
            atom.syncMesh();
            if (atom.sphereMesh) {
                atom.sphereMesh.position.copy(atom.position);
                const u = atom.sphereMesh.material?.uniforms;
                if (u?.uTime) u.uTime.value = t;

                // ⚡ Flash de enlace — destello perceptual (anti Bezold-Brücke)
                // Sube luminosidad en HSL manteniendo tono constante
                // en vez de lerp RGB→blanco que cambia el tono percibido
                // (Bujack et al. 2025, CGF 44-3, Sec. 5.1)
                if (atom._bondFlash > 0.01) {
                    if (u?.uBright) {
                        const baseBright = atom._baseBright ?? u.uBright.value;
                        if (!atom._baseBright) atom._baseBright = baseBright;
                        // Stevens power law: percepción = estímulo^0.45
                        const perceptualFlash = Math.pow(atom._bondFlash, 0.45);
                        u.uBright.value = baseBright + perceptualFlash * 6.0;
                    }
                    // Subir luminosidad en HSL sin cambiar hue
                    if (u?.uColor && atom._baseColor === undefined) {
                        atom._baseColor = u.uColor.value.clone();
                        atom._baseHSL = {};
                        u.uColor.value.getHSL(atom._baseHSL);
                    }
                    if (u?.uColor && atom._baseHSL) {
                        const hsl = atom._baseHSL;
                        // Luminosidad sube con el flash, tono se mantiene
                        const flashL = Math.min(1.0, hsl.l + atom._bondFlash * (1.0 - hsl.l) * 0.8);
                        // Saturación baja ligeramente (energía liberada → más blanco)
                        const flashS = hsl.s * (1.0 - atom._bondFlash * 0.3);
                        u.uColor.value.setHSL(hsl.h, flashS, flashL);
                    }
                    atom._bondFlash *= 0.88;
                } else if (atom._bondFlash !== undefined && atom._bondFlash <= 0.01) {
                    if (atom._baseBright && u?.uBright) {
                        u.uBright.value = atom._baseBright;
                    }
                    if (atom._baseColor && u?.uColor) {
                        u.uColor.value.copy(atom._baseColor);
                    }
                    atom._bondFlash = 0;
                    delete atom._baseBright;
                    delete atom._baseColor;
                    delete atom._baseHSL;
                }
            }
            // Jaula de detección — sigue al átomo y anima el pulso
            if (atom._cagePts) {
                atom._cagePts.position.copy(atom.position);
                atom.tickCage(t);
            }
        }

        for (const bond of this.bonds.values()) {
            bond.updateMesh();
            const u = bond.mesh?.material?.uniforms;
            if (u?.uTime) u.uTime.value = t;
        }

        this._orientPelitosOnly();
    }

    // Bond meshes únicamente — llamado por WorldBridge mientras espera posiciones del worker
    _syncBondMeshes() {
        const t = this._elapsed;
        for (const bond of this.bonds.values()) {
            bond.updateMesh();
            const u = bond.mesh?.material?.uniforms;
            if (u?.uTime) u.uTime.value = t;
        }
    }

    // ── Privado — Helpers ──────────────────────────────────────────────────

    /**
     * ¿Ya existe un bond entre estos dos átomos?
     */
    _bondExists(atomA, atomB) {
        for (const bond of this.bonds.values()) {
            if ((bond.atomA.id === atomA.id && bond.atomB.id === atomB.id) ||
                (bond.atomA.id === atomB.id && bond.atomB.id === atomA.id)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Detecta el tipo de bond más probable entre dos átomos
     * basado en su electronegatividad y grupo.
     */
    /**
     * Filtro de afinidad química.
     * Devuelve true si dos átomos PUEDEN formar un enlace.
     *
     * Reglas (en orden de prioridad):
     *   1. Gases nobles inertes (He, Ne, Ar, Rn) — nunca se enlazan
     *   2. Gases nobles limitados (Kr, Xe) — solo con F
     *   3. Valencia saturada — bonds >= maxBonds
     *   4. Mismo elemento no-metal — solo diatómicos conocidos y sueltos
     *   5. Dos metales sueltos — no forman pares (solo redes cristalinas)
     *   6. Compatibilidad por electronegatividad — ΔEN razonable
     *   7. Modo estricto — regla del octeto para univalentes
     */
    _canBond(a1, a2) {
        const sym1 = a1.symbol;
        const sym2 = a2.symbol;

        // ── 1. Gases nobles completamente inertes ─────────────────────────
        const INERT = new Set(['He', 'Ne', 'Ar', 'Rn']);
        if (INERT.has(sym1) || INERT.has(sym2)) return false;

        // ── 2. Gases nobles de reactividad limitada ───────────────────────
        const NOBLE_LIMITED = new Set(['Kr', 'Xe']);
        if (NOBLE_LIMITED.has(sym1) || NOBLE_LIMITED.has(sym2)) {
            const other = NOBLE_LIMITED.has(sym1) ? sym2 : sym1;
            if (other !== 'F') return false;
        }

        // ── 3. Valencia saturada ──────────────────────────────────────────
        if (a1.bonds.size >= a1.maxBonds) return false;
        if (a2.bonds.size >= a2.maxBonds) return false;

        // ── 4. Mismo elemento — solo para diatómicos conocidos ────────────
        if (sym1 === sym2) {
            const DIATOMIC = new Set(['H', 'O', 'N', 'F', 'Cl', 'Br', 'I']);
            if (!DIATOMIC.has(sym1)) return false;
            // Solo si ambos están sueltos (0 bonds) — evita O-O en agua rota
            if (a1.bonds.size > 0 || a2.bonds.size > 0) return false;
        }

        // ── 5. Dos metales sueltos — no forman pares ─────────────────────
        // Metales solo se enlazan en cristales (CrystalFactory), no por auto-bond
        const en1 = a1.electronegativity || 0;
        const en2 = a2.electronegativity || 0;
        const isMetal1 = en1 > 0 && en1 < 1.8;
        const isMetal2 = en2 > 0 && en2 < 1.8;
        if (isMetal1 && isMetal2) return false;

        // ── 6. ΔEN demasiado extremo sin sentido químico ──────────────────
        // ΔEN > 3.0 es muy raro (solo CsF ≈ 3.3). Rechazar outliers absurdos.
        if (en1 > 0 && en2 > 0) {
            const delta = Math.abs(en1 - en2);
            if (delta > 3.3) return false;
        }

        // ── 7. Modo estricto (opcional) ───────────────────────────────────
        if (this.params.strictBonding) {
            const STRICT_MAX = { H: 1, F: 1, Cl: 1, Br: 1, I: 1 };
            const s1 = STRICT_MAX[sym1];
            const s2 = STRICT_MAX[sym2];
            if (s1 !== undefined && a1.bonds.size >= s1) return false;
            if (s2 !== undefined && a2.bonds.size >= s2) return false;
        }

        return true;
    }

    _detectBondType(atomA, atomB) {
        const enA   = atomA.electronegativity;
        const enB   = atomB.electronegativity;
        const delta = Math.abs(enA - enB);

        const groupA = atomA.meta?.group || '';
        const groupB = atomB.meta?.group || '';
        const bothMetal = (
            ['alkali_metal','alkaline_earth','transition_metal',
             'post_transition_metal','lanthanide','actinide'].includes(groupA) &&
            ['alkali_metal','alkaline_earth','transition_metal',
             'post_transition_metal','lanthanide','actinide'].includes(groupB)
        );

        if (bothMetal)  return 'metallic';
        if (delta > 1.7) return 'ionic';
        return 'covalent';
    }

    // ── Contador reactivo de moléculas ─────────────────────────────────────
    // BFS ligero — solo se ejecuta cuando la topología cambia (addBond/removeBond/removeAtom).
    // Jamás corre en el hot path del loop de física.
    _recomputeMoleculeCount() {
        if (this.atoms.size === 0) { this._moleculeCount = 0; return; }
        const visited = new Set();
        let count = 0;
        for (const atom of this.atoms.values()) {
            if (visited.has(atom.id)) continue;
            const queue = [atom];
            visited.add(atom.id);
            let hasBond = false;
            while (queue.length > 0) {
                const cur = queue.shift();
                for (const bond of cur.bonds) {
                    const nb = bond.atomA.id === cur.id ? bond.atomB : bond.atomA;
                    if (!visited.has(nb.id)) { visited.add(nb.id); queue.push(nb); hasBond = true; }
                    else hasBond = true;
                }
            }
            if (hasBond) count++;
        }
        this._moleculeCount = count;
    }
}
