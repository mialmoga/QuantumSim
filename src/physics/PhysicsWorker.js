/**
 * PhysicsWorker.js — Motor de física en hilo separado
 *
 * Recibe estado de átomos/bonds del hilo principal cuando cambia la topología.
 * Corre integración + Pauli + Morse + Angular cada frame.
 * Devuelve posiciones como Float32Array transferible (zero-copy).
 *
 * Protocolo de mensajes:
 *
 *   Main → Worker:
 *     { type:'sync',   atoms:[AtomState], bonds:[BondState] }
 *     { type:'tick',   dt: number }
 *     { type:'params', params: PhysicsParams }
 *     { type:'wake',   atomId: number }       — despertar un átomo
 *     { type:'move',   atomId, x, y, z }      — mover átomo (joystick/diseño)
 *
 *   Worker → Main:
 *     { type:'positions', buffer: Float32Array([id,x,y,z, ...]) }
 *       → transferido (zero-copy), main thread lo devuelve con 'reclaim'
 *     { type:'reclaim', buffer }              — main devuelve el buffer
 */

'use strict';

// ── Tipos internos ─────────────────────────────────────────────────────────
//
// AtomState:  { id, x, y, z, vx, vy, vz, mass, radius, frozen,
//               maxBonds, electronegativity, bondIds: number[] }
// BondState:  { id, atomA, atomB, equilibrium, stiffness,
//               morseA, morseDe, ruptureLength, order, type,
//               progress, targetProgress, progressSpeed }
// PhysicsParams: ver DEFAULT_PARAMS abajo

const DEFAULT_PARAMS = {
    gravity:           9.807e12,
    gravityEnabled:    false,
    gravityMultiplier: 0,
    damping:           0.98,
    floorEnabled:      true,
    floorY:           -500,
    restitution:       0.3,
    ceilingEnabled:    false,
    ceilingY:          1500,
    ceilingRestitution:0.6,
    sphereEnabled:     false,
    sphereRadius:      2000,
    sphereCenterY:     0,
    sphereRestitution: 0.6,
    pauliEnabled:      true,
    pauliStrength:     500,
    pauliFactor:       2.0,
    bondAnglesEnabled: true,
    bondAngleStrength: 0.5,
    autoBond:          false,   // detección en worker off — la hace el main thread
};

// ── SpatialHashGrid (puro, sin Three.js) ──────────────────────────────────

const GRID_CELL = 400;

class Grid {
    constructor() { this.cells = new Map(); }

    _key(cx, cy, cz) {
        const x = (cx + 8192) & 0x3FFF;
        const y = (cy + 8192) & 0x3FFF;
        const z = (cz + 8192) & 0x3FFF;
        return x * 268435456 + y * 16384 + z;
    }

    clear() { this.cells.clear(); }

    insert(a) {
        const key = this._key(
            Math.floor(a.x / GRID_CELL),
            Math.floor(a.y / GRID_CELL),
            Math.floor(a.z / GRID_CELL)
        );
        if (!this.cells.has(key)) this.cells.set(key, []);
        this.cells.get(key).push(a);
    }

    nearby(x, y, z) {
        const cx = Math.floor(x / GRID_CELL);
        const cy = Math.floor(y / GRID_CELL);
        const cz = Math.floor(z / GRID_CELL);
        const out = [];
        for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
            const c = this.cells.get(this._key(cx+dx, cy+dy, cz+dz));
            if (c) for (const a of c) out.push(a);
        }
        return out;
    }
}

// ── Estado del worker ──────────────────────────────────────────────────────

const atoms  = new Map();   // id → AtomState (mutable)
const bonds  = new Map();   // id → BondState (mutable)
let   params = { ...DEFAULT_PARAMS };
const grid   = new Grid();

// Buffer de salida — se alterna con el que devuelve el main thread
let _outBuffer = null;

// ── Helpers matemáticos inline (sin objetos) ───────────────────────────────

function dot3(ax,ay,az, bx,by,bz)             { return ax*bx + ay*by + az*bz; }
function len3sq(x,y,z)                         { return x*x + y*y + z*z; }
function len3(x,y,z)                           { return Math.sqrt(x*x + y*y + z*z); }
function cross3(ax,ay,az, bx,by,bz) {
    return [ay*bz - az*by, az*bx - ax*bz, ax*by - ay*bx];
}

// ── Integración de átomos ──────────────────────────────────────────────────

const MORSE_A = { covalent:0.0193, ionic:0.0130, metallic:0.0090, vdw:0.0060 };

function applyForce(a, fx, fy, fz) {
    if (a.frozen) return;
    a.fx += fx; a.fy += fy; a.fz += fz;
}

function integrate(a, dt) {
    if (a.frozen) { a.fx = a.fy = a.fz = 0; return; }
    const m = Math.max(a.mass, 0.001);
    a.vx += (a.fx / m) * dt;
    a.vy += (a.fy / m) * dt;
    a.vz += (a.fz / m) * dt;
    a.x  += a.vx * dt;
    a.y  += a.vy * dt;
    a.z  += a.vz * dt;
    a.vx *= params.damping;
    a.vy *= params.damping;
    a.vz *= params.damping;
    a.fx = a.fy = a.fz = 0;
}

// ── Fuerzas de Pauli ───────────────────────────────────────────────────────

function applyPauli() {
    if (!params.pauliEnabled) return;
    const strength = params.pauliStrength;
    const factor   = params.pauliFactor;

    for (const a of atoms.values()) {
        if (a.frozen) continue;
        for (const b of grid.nearby(a.x, a.y, a.z)) {
            if (b.id <= a.id) continue;

            // Skip pares enlazados — Morse maneja su interacción
            let bonded = false;
            for (const bid of a.bondIds) {
                const bond = bonds.get(bid);
                if (bond && (bond.atomA === b.id || bond.atomB === b.id)) { bonded = true; break; }
            }
            if (bonded) continue;

            const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
            const dist = len3(dx, dy, dz);
            if (dist < 0.1) continue;

            const minDist = a.radius + b.radius;
            if (dist < minDist) {
                const overlap   = minDist - dist;
                const forceMag  = strength * Math.pow(overlap, factor) / minDist;
                const nx = dx/dist, ny = dy/dist, nz = dz/dist;
                applyForce(a,  nx*forceMag,  ny*forceMag,  nz*forceMag);
                applyForce(b, -nx*forceMag, -ny*forceMag, -nz*forceMag);
            }
        }
    }
}

// ── Fuerzas de Morse ───────────────────────────────────────────────────────

function applyBondForces(dt) {
    for (const b of bonds.values()) {
        if (b.broken) continue;
        if (b.type === 'vdw') continue;
        if (b.progress < 0.01) continue;

        // tick bond_progress
        b._framesAlive = (b._framesAlive ?? 0) + 1;
        const delta = b.targetProgress - b.progress;
        b.progress += delta * Math.min(b.progressSpeed * dt, 1.0);
        b.progress  = Math.max(0, Math.min(1, b.progress));

        if (b.targetProgress <= 0 && b.progress < 0.01) {
            b.broken = true; continue;
        }

        const a1 = atoms.get(b.atomA);
        const a2 = atoms.get(b.atomB);
        if (!a1 || !a2) continue;

        const dx = a2.x - a1.x, dy = a2.y - a1.y, dz = a2.z - a1.z;
        const dist = len3(dx, dy, dz);
        if (dist < 0.0001) continue;

        if (dist > b.ruptureLength && b.targetProgress > 0) {
            b.targetProgress = 0; continue;
        }

        const x       = dist - b.equilibrium;
        const expTerm = Math.exp(-b.morseA * x);
        const inner   = 1.0 - expTerm;
        const forceMag = 2.0 * b.morseDe * b.morseA * inner * expTerm * b.progress;

        const nx = dx/dist, ny = dy/dist, nz = dz/dist;
        applyForce(a1,  nx*forceMag,  ny*forceMag,  nz*forceMag);
        applyForce(a2, -nx*forceMag, -ny*forceMag, -nz*forceMag);
    }
}

// ── Fuerzas angulares (Éter) ───────────────────────────────────────────────

function applyAngularForces(dt) {
    if (!params.bondAnglesEnabled) return;
    const k = params.bondAngleStrength * 500;

    for (const a of atoms.values()) {
        if (a.frozen || a.bondIds.length < 2) continue;

        const activeBonds = a.bondIds
            .map(id => bonds.get(id))
            .filter(b => b && !b.broken && b.progress >= 0.5);
        if (activeBonds.length < 2) continue;

        const idealDeg = a.idealAngle ?? _idealAngle(activeBonds.length, a);
        const idealRad = idealDeg * Math.PI / 180;

        for (let i = 0; i < activeBonds.length; i++) {
            for (let j = i + 1; j < activeBonds.length; j++) {
                const b1 = activeBonds[i], b2 = activeBonds[j];
                const n1id = b1.atomA === a.id ? b1.atomB : b1.atomA;
                const n2id = b2.atomA === a.id ? b2.atomB : b2.atomA;
                const n1 = atoms.get(n1id), n2 = atoms.get(n2id);
                if (!n1 || !n2) continue;

                const r1x = n1.x - a.x, r1y = n1.y - a.y, r1z = n1.z - a.z;
                const r2x = n2.x - a.x, r2y = n2.y - a.y, r2z = n2.z - a.z;
                const len1 = len3(r1x, r1y, r1z);
                const len2 = len3(r2x, r2y, r2z);
                if (len1 < 5 || len2 < 5) continue;

                const d1x = r1x/len1, d1y = r1y/len1, d1z = r1z/len1;
                const d2x = r2x/len2, d2y = r2y/len2, d2z = r2z/len2;

                const dotv = Math.max(-1, Math.min(1, dot3(d1x,d1y,d1z, d2x,d2y,d2z)));
                const currentRad = Math.acos(dotv);
                const diff = currentRad - idealRad;
                if (Math.abs(diff) < 0.01) continue;

                const [nx, ny, nz] = cross3(d1x,d1y,d1z, d2x,d2y,d2z);
                const nlen = len3(nx, ny, nz);
                if (nlen < 0.0001) continue;
                const nnx = nx/nlen, nny = ny/nlen, nnz = nz/nlen;

                const [f1dx, f1dy, f1dz] = cross3(d1x,d1y,d1z, nnx,nny,nnz);
                const [f2dx, f2dy, f2dz] = cross3(nnx,nny,nnz, d2x,d2y,d2z);

                const f1l = len3(f1dx,f1dy,f1dz) || 1;
                const f2l = len3(f2dx,f2dy,f2dz) || 1;

                const forceMag = -k * diff;
                const s = dt * 60;

                const f1x = (f1dx/f1l) * (forceMag/len1) * s;
                const f1y = (f1dy/f1l) * (forceMag/len1) * s;
                const f1z = (f1dz/f1l) * (forceMag/len1) * s;
                const f2x = (f2dx/f2l) * (forceMag/len2) * s;
                const f2y = (f2dy/f2l) * (forceMag/len2) * s;
                const f2z = (f2dz/f2l) * (forceMag/len2) * s;

                if (!n1.frozen) applyForce(n1, f1x, f1y, f1z);
                if (!n2.frozen) applyForce(n2, f2x, f2y, f2z);
                if (!a.frozen)  applyForce(a, -(f1x+f2x), -(f1y+f2y), -(f1z+f2z));
            }
        }
    }
}

function _idealAngle(n, a) {
    const sym = a.symbol ?? '';
    if (sym === 'O' && n === 2) return 104.5;
    if (sym === 'N' && n === 3) return 107;
    if (sym === 'S' && n === 2) return 104.5;
    switch (n) {
        case 2: return 180; case 3: return 120;
        case 4: return 109.5; default: return 120;
    }
}

// ── Superficies ────────────────────────────────────────────────────────────

function resolveFloor() {
    if (!params.floorEnabled) return;
    for (const a of atoms.values()) {
        if (a.frozen) continue;
        const contact = params.floorY + a.radius;
        if (a.y < contact) {
            a.y = contact;
            if (a.vy < 0) {
                a.vy *= -params.restitution;
                a.vx *= 0.85; a.vz *= 0.85;
            }
        }
    }
}

function resolveCeiling() {
    if (!params.ceilingEnabled) return;
    for (const a of atoms.values()) {
        if (a.frozen) continue;
        const contact = params.ceilingY - a.radius;
        if (a.y > contact) {
            a.y = contact;
            if (a.vy > 0) {
                a.vy *= -params.ceilingRestitution;
                a.vx *= 0.85; a.vz *= 0.85;
            }
        }
    }
}

function resolveSphere() {
    if (!params.sphereEnabled) return;
    const R = params.sphereRadius, cy = params.sphereCenterY, res = params.sphereRestitution;
    for (const a of atoms.values()) {
        if (a.frozen) continue;
        const dx = a.x, dy = a.y - cy, dz = a.z;
        const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
        const limit = R - a.radius;
        if (dist > limit && dist > 0.001) {
            const nx = dx/dist, ny = dy/dist, nz = dz/dist;
            a.x = nx*limit; a.y = cy + ny*limit; a.z = nz*limit;
            const vDot = a.vx*nx + a.vy*ny + a.vz*nz;
            if (vDot > 0) {
                const b = -(1 + res) * vDot;
                a.vx += nx*b; a.vy += ny*b; a.vz += nz*b;
            }
        }
    }
}

// ── Tick principal ─────────────────────────────────────────────────────────

function tick(dt) {
    // 1. Reconstruir grid
    grid.clear();
    for (const a of atoms.values()) grid.insert(a);

    // 2. Gravedad + damping
    const gEff = params.gravityEnabled
        ? -params.gravity * params.gravityMultiplier : 0;
    for (const a of atoms.values()) {
        if (a.frozen) continue;
        if (params.gravityEnabled) {
            a.fy += gEff * a.mass;
        }
        a.vx *= params.damping;
        a.vy *= params.damping;
        a.vz *= params.damping;
    }

    // 3. Pauli
    applyPauli();

    // 4. Morse + bond_progress
    applyBondForces(dt);

    // 4b. Angular
    applyAngularForces(dt);

    // 5. Integrar
    for (const a of atoms.values()) integrate(a, dt);

    // 6. Superficies
    resolveFloor();
    resolveCeiling();
    resolveSphere();

    // 7. Limpiar bonds rotos (marcados por Morse)
    for (const [id, b] of bonds.entries()) {
        if (b.broken) bonds.delete(id);
    }
}

// ── Serializar posiciones → Float32Array ──────────────────────────────────
// Layout: [id, x, y, z,  id, x, y, z, ...]  (4 floats por átomo)

function serializePositions() {
    const count = atoms.size;
    // Reutilizar buffer si el tamaño coincide
    if (!_outBuffer || _outBuffer.length !== count * 4) {
        _outBuffer = new Float32Array(count * 4);
    }
    let i = 0;
    for (const a of atoms.values()) {
        _outBuffer[i++] = a.id;
        _outBuffer[i++] = a.x;
        _outBuffer[i++] = a.y;
        _outBuffer[i++] = a.z;
    }
    return _outBuffer;
}

// ── Sincronizar desde main thread ─────────────────────────────────────────

function syncAtoms(atomList) {
    // Preservar velocidades de átomos que ya existían
    for (const s of atomList) {
        const existing = atoms.get(s.id);
        const a = {
            id: s.id, symbol: s.symbol,
            x: s.x, y: s.y, z: s.z,
            vx: existing?.vx ?? 0,
            vy: existing?.vy ?? 0,
            vz: existing?.vz ?? 0,
            fx: 0, fy: 0, fz: 0,
            mass: s.mass, radius: s.radius,
            frozen: s.frozen,
            electronegativity: s.electronegativity ?? 0,
            idealAngle: s.idealAngle ?? null,
            bondIds: s.bondIds ?? [],
        };
        atoms.set(a.id, a);
    }
    // Eliminar átomos que ya no existen
    const incoming = new Set(atomList.map(a => a.id));
    for (const id of atoms.keys()) {
        if (!incoming.has(id)) atoms.delete(id);
    }
}

function syncBonds(bondList) {
    bonds.clear();
    for (const s of bondList) {
        bonds.set(s.id, {
            id: s.id, atomA: s.atomA, atomB: s.atomB,
            equilibrium: s.equilibrium,
            stiffness: s.stiffness,
            morseA: s.morseA ?? 0.0193,
            morseDe: s.morseDe ?? 20,
            ruptureLength: s.ruptureLength,
            order: s.order ?? 1,
            type: s.type ?? 'covalent',
            progress: s.progress ?? 1.0,
            targetProgress: s.targetProgress ?? 1.0,
            progressSpeed: s.progressSpeed ?? 4.0,
            broken: false,
            _framesAlive: s._framesAlive ?? 999,
        });
    }
}

// ── Message handler ───────────────────────────────────────────────────────

self.onmessage = function(e) {
    const msg = e.data;

    switch (msg.type) {

        case 'sync':
            syncAtoms(msg.atoms ?? []);
            syncBonds(msg.bonds ?? []);
            break;

        case 'tick': {
            tick(msg.dt ?? 0.016);
            const buf = serializePositions();
            // Transferir el buffer (zero-copy) — main thread lo devuelve con 'reclaim'
            self.postMessage({ type: 'positions', buffer: buf }, [buf.buffer]);
            _outBuffer = null; // se transfirió, crear nuevo en el próximo tick
            break;
        }

        case 'reclaim':
            // Main thread devuelve el buffer para reutilizarlo
            _outBuffer = msg.buffer;
            break;

        case 'params':
            params = { ...DEFAULT_PARAMS, ...msg.params };
            break;

        case 'move': {
            const a = atoms.get(msg.atomId);
            if (a) { a.x = msg.x; a.y = msg.y; a.z = msg.z; a.vx = 0; a.vy = 0; a.vz = 0; }
            break;
        }

        case 'wake': {
            const a = atoms.get(msg.atomId);
            if (a) { a.vx = 0; a.vy = 0; a.vz = 0; }
            break;
        }
    }
};
