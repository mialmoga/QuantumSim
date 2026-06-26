/**
 * WorldBridge.js — Puente entre World.js y PhysicsWorker
 *
 * Reemplaza world.update(dt) en el loop de app.js.
 * Cuando la física corre en el worker, el hilo principal solo:
 *   1. Envía cambios de topología (addAtom/addBond) al worker vía sync()
 *   2. Llama tick(dt) cada frame — el worker responde con posiciones
 *   3. Aplica posiciones a atom.position + meshes (syncMeshes)
 *
 * World.js sigue funcionando para:
 *   - Gestión de átomos/bonds (addAtom, addBond, removeAtom, removeBond)
 *   - Detección automática de bonds (_detectBonds)
 *   - Limpieza de bonds rotos (_cleanBrokenBonds)
 *   - Sync visual (updateMesh, flash de enlace, pelitos)
 *
 * El worker solo hace el número-crunch: fuerzas, integración, superficies.
 *
 * Uso en app.js:
 *   import { WorldBridge } from './src/physics/WorldBridge.js';
 *   const bridge = new WorldBridge(world, './src/physics/PhysicsWorker.js');
 *   bridge.start();
 *
 *   // En el loop (reemplaza world.update(dt)):
 *   bridge.tick(dt);
 *
 *   // En modo diseño (física pausada):
 *   world.syncMeshes();
 */

export class WorldBridge {

    /**
     * @param {import('../core/World.js').World} world
     * @param {string} workerUrl — ruta al PhysicsWorker.js
     */
    constructor(world, workerUrl) {
        this._world     = world;
        this._workerUrl = workerUrl;
        this._worker    = null;
        this._dirty     = false;   // topología cambió, necesita sync
        this._pending   = false;   // tick en vuelo
        this._dt        = 0;       // dt acumulado mientras hay tick en vuelo
        this._enabled   = false;
    }

    // ── API pública ────────────────────────────────────────────────────────

    start() {
        if (this._worker) return;

        this._worker = new Worker(this._workerUrl, { type: 'module' });
        this._worker.onmessage = e => this._onWorkerMessage(e.data);
        this._worker.onerror   = e => console.error('[Bridge] Worker error:', e);

        // Enviar params iniciales
        this._worker.postMessage({
            type:   'params',
            params: this._world.params,
        });

        // Hookar World para detectar cambios de topología
        this._hookWorld();

        this._enabled = true;
        console.log('[Bridge] 🚀 Physics Worker iniciado');
    }

    stop() {
        this._worker?.terminate();
        this._worker  = null;
        this._enabled = false;
    }

    /**
     * Llamar cada frame DESDE EL ANIMATION LOOP en vez de world.update(dt).
     * Si la física está en el worker, solo hace sync si es necesario y dispara tick.
     * Si el worker no está activo, hace fallback a world.update(dt).
     */
    tick(dt) {
        if (!this._enabled || !this._worker) {
            // Fallback — física en hilo principal
            this._world.update(dt);
            return;
        }

        const world = this._world;

        // Sincronizar topología si cambió
        if (this._dirty) {
            this._syncTopology();
            this._dirty = false;
        }

        // Sincronizar params si cambiaron
        if (world._paramsDirty) {
            this._worker.postMessage({ type: 'params', params: world.params });
            world._paramsDirty = false;
        }

        // Si hay un tick en vuelo, acumular dt y esperar
        if (this._pending) {
            this._dt += dt;
            return;
        }

        // Enviar tick al worker
        this._pending = true;
        this._worker.postMessage({ type: 'tick', dt: dt + this._dt });
        this._dt = 0;

        // Mientras el worker procesa, hacer el trabajo visual en el main thread:
        // detección de bonds, limpieza, visual sync — todo lo que no es física pura.
        world._elapsed += dt;
        world._frame++;

        if (world.params.autoBond)  world._detectBonds?.();
        world._cleanBrokenBonds?.();
        world._processDelayedAlignments?.();

        // Sync visual de bonds (meshes, materiales) — átomos se sincronizan
        // cuando llegan las posiciones del worker en _onWorkerMessage
        world._syncBondMeshes?.();

        if (world._frame % 300 === 0) {
            console.log(`[Bridge] Frame ${world._frame} | átomos: ${world.atoms.size} | bonds: ${world.bonds.size}`);
        }
    }

    /**
     * Notificar que la topología cambió (átomos o bonds añadidos/eliminados).
     * Se llama automáticamente desde los hooks en World.
     */
    markDirty() {
        this._dirty = true;
    }

    /**
     * Mover un átomo directamente (joystick/diseño) — se envía al worker
     * para que no lo sobreescriba con física.
     */
    moveAtom(atomId, x, y, z) {
        this._worker?.postMessage({ type: 'move', atomId, x, y, z });
    }

    // ── Privado ────────────────────────────────────────────────────────────

    _onWorkerMessage(msg) {
        if (msg.type !== 'positions') return;

        this._pending = false;
        const buf  = msg.buffer;   // Float32Array [id,x,y,z, ...]
        const world = this._world;

        // Aplicar posiciones a los átomos del world
        for (let i = 0; i < buf.length; i += 4) {
            const id   = buf[i];
            const atom = world.atoms.get(id);
            if (!atom) continue;
            atom.position.set(buf[i+1], buf[i+2], buf[i+3]);
        }

        // Sync visual de átomos y bonds en el main thread
        world._syncMeshes?.();

        // Devolver el buffer al worker para reutilizarlo (zero-copy round trip)
        this._worker?.postMessage({ type: 'reclaim', buffer: buf }, [buf.buffer]);
    }

    _syncTopology() {
        const world = this._world;

        const atomList = [];
        for (const atom of world.atoms.values()) {
            const idealAngle = atom.elementData?.reactivity?.ideal_bond_angle ?? null;
            atomList.push({
                id:                atom.id,
                symbol:            atom.symbol,
                x:                 atom.position.x,
                y:                 atom.position.y,
                z:                 atom.position.z,
                mass:              atom.mass,
                radius:            atom.radius,
                frozen:            atom.frozen,
                electronegativity: atom.electronegativity ?? 0,
                idealAngle,
                bondIds:           [...atom.bonds].map(b => b.id),
            });
        }

        const bondList = [];
        for (const bond of world.bonds.values()) {
            if (bond.broken) continue;
            bondList.push({
                id:            bond.id,
                atomA:         bond.atomA.id,
                atomB:         bond.atomB.id,
                equilibrium:   bond.equilibriumLength,
                stiffness:     bond.stiffness,
                morseA:        bond.morseA,
                morseDe:       bond.morseDe,
                ruptureLength: bond.ruptureLength,
                order:         bond.order,
                type:          bond.type,
                progress:      bond.progress,
                targetProgress:bond.targetProgress,
                progressSpeed: bond.progressSpeed,
                _framesAlive:  bond._framesAlive ?? 999,
            });
        }

        this._worker.postMessage({ type: 'sync', atoms: atomList, bonds: bondList });
    }

    _hookWorld() {
        const world   = this._world;
        const bridge  = this;

        // Hookar addAtom/addBond/removeAtom/removeBond para detectar cambios
        const origAddAtom    = world.addAtom.bind(world);
        const origAddBond    = world.addBond.bind(world);
        const origRemoveAtom = world.removeAtom.bind(world);
        const origRemoveBond = world.removeBond.bind(world);

        world.addAtom = async (...args) => {
            const result = await origAddAtom(...args);
            bridge.markDirty();
            return result;
        };
        world.addBond = (...args) => {
            const result = origAddBond(...args);
            if (result) bridge.markDirty();
            return result;
        };
        world.removeAtom = (...args) => {
            origRemoveAtom(...args);
            bridge.markDirty();
        };
        world.removeBond = (...args) => {
            origRemoveBond(...args);
            bridge.markDirty();
        };

        // Interceptar setParams para notificar al worker
        const origSetParams = world.setParams.bind(world);
        world.setParams = (p) => {
            origSetParams(p);
            world._paramsDirty = true;
        };

        // Interceptar joystick moves (WorldBridge.moveAtom debe llamarse desde app.js
        // cuando el joystick mueve un átomo en modo diseño)
        world._bridge = bridge;
    }
}
