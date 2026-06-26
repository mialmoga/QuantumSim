/**
 * CrystalFactory.js — Genera estructuras cristalinas en World
 *
 * Cristales disponibles:
 *   - NaCl (iónico, cúbico simple alternado)
 *   - BCC  (hierro, cúbico centrado en el cuerpo)
 *   - FCC  (diamante, cúbico centrado en las caras)
 *   - Hielo Ih (hexagonal, con puentes de hidrógeno)
 *
 * Todas las distancias en pm (= wu del simulador).
 * Basado en cristalografía real: lattice constants, radios covalentes,
 * posiciones de Wyckoff (hielo Ih), reglas Bernal-Fowler.
 *
 * Uso:
 *   import { CrystalFactory } from './src/structures/CrystalFactory.js';
 *   const cf = new CrystalFactory(world);
 *   const atoms = await cf.generateNaCl(3);  // 3×3×3
 */

import * as THREE from 'three';

export class CrystalFactory {

    /**
     * @param {import('../core/World.js').World} world
     */
    constructor(world) {
        this._world = world;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  NaCl — red cúbica simple con Na y Cl alternados
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @param {number} size — dimensión de la red (3 = 3×3×3 = 27 átomos)
     * @returns {Promise<Atom[]>}
     */
    async generateNaCl(size = 3) {
        // d(Na-Cl) = 282 pm (lattice constant NaCl / 2)
        const spacing = 282;
        const off = -(size - 1) * spacing / 2;
        const atoms = [];
        const grid  = {};

        // Desactivar auto-bonding durante la construcción
        const prevAuto = this._world.params.autoBond;
        this._world.params.autoBond = false;

        // 1. Crear átomos
        for (let x = 0; x < size; x++) {
            for (let y = 0; y < size; y++) {
                for (let z = 0; z < size; z++) {
                    const sym  = (x + y + z) % 2 === 0 ? 'Na' : 'Cl';
                    const pos  = {
                        x: off + x * spacing,
                        y: off + y * spacing,
                        z: off + z * spacing,
                    };
                    const atom = await this._world.addAtom(sym, pos, { frozen: true });
                    atoms.push(atom);
                    grid[`${x},${y},${z}`] = atom;
                }
            }
        }

        // 2. Bonds: solo vecinos directos (+x, +y, +z)
        for (let x = 0; x < size; x++) {
            for (let y = 0; y < size; y++) {
                for (let z = 0; z < size; z++) {
                    const a = grid[`${x},${y},${z}`];
                    for (const [dx, dy, dz] of [[1,0,0],[0,1,0],[0,0,1]]) {
                        const b = grid[`${x+dx},${y+dy},${z+dz}`];
                        if (b) this._world.addBond(a, b, { type: 'ionic' });
                    }
                }
            }
        }

        this._world.params.autoBond = prevAuto;
        this._freezeAll(atoms);

        console.log(`[CrystalFactory] 🧂 NaCl ${size}³ — ${atoms.length} átomos`);
        return atoms;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  BCC — Hierro (cúbico centrado en el cuerpo)
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @param {number} size
     * @param {string} element — default 'Fe'
     * @returns {Promise<Atom[]>}
     */
    async generateBCC(size = 3, element = 'Fe') {
        // spacing = 2 × r_covalent × 1.1 ≈ 290 pm para Fe
        const spacing = 290;
        const off = -(size - 1) * spacing / 2;
        const atoms   = [];
        const corners = {};
        const centers = {};

        const prevAuto = this._world.params.autoBond;
        this._world.params.autoBond = false;

        // 1. Corners + centers
        for (let x = 0; x < size; x++) {
            for (let y = 0; y < size; y++) {
                for (let z = 0; z < size; z++) {
                    const pos = {
                        x: off + x * spacing,
                        y: off + y * spacing,
                        z: off + z * spacing,
                    };
                    const ca = await this._world.addAtom(element, pos, { frozen: true });
                    atoms.push(ca);
                    corners[`${x},${y},${z}`] = ca;

                    // Centro de cada celda (excepto la última fila)
                    if (x < size - 1 && y < size - 1 && z < size - 1) {
                        const cenPos = {
                            x: pos.x + spacing / 2,
                            y: pos.y + spacing / 2,
                            z: pos.z + spacing / 2,
                        };
                        const cna = await this._world.addAtom(element, cenPos, { frozen: true });
                        atoms.push(cna);
                        centers[`${x},${y},${z}`] = cna;
                    }
                }
            }
        }

        // 2. Bonds: cada center se conecta con sus 8 corners
        for (let x = 0; x < size - 1; x++) {
            for (let y = 0; y < size - 1; y++) {
                for (let z = 0; z < size - 1; z++) {
                    const cen = centers[`${x},${y},${z}`];
                    if (!cen) continue;
                    for (const [dx, dy, dz] of [
                        [0,0,0],[1,0,0],[0,1,0],[1,1,0],
                        [0,0,1],[1,0,1],[0,1,1],[1,1,1]
                    ]) {
                        const cor = corners[`${x+dx},${y+dy},${z+dz}`];
                        if (cor) this._world.addBond(cen, cor, { type: 'metallic' });
                    }
                }
            }
        }

        this._world.params.autoBond = prevAuto;
        this._freezeAll(atoms);

        console.log(`[CrystalFactory] 🔩 BCC ${element} ${size}³ — ${atoms.length} átomos`);
        return atoms;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  FCC — Diamante (cúbico centrado en las caras)
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @param {number} size
     * @param {string} element — default 'C'
     * @returns {Promise<Atom[]>}
     */
    async generateFCC(size = 3, element = 'C') {
        // d(C-C) en diamante = 154 pm
        const spacing = 154;
        const off = -(size - 1) * spacing / 2;
        const atoms = [];
        const allPositions = []; // para conectar por distancia

        const prevAuto = this._world.params.autoBond;
        this._world.params.autoBond = false;

        for (let x = 0; x < size; x++) {
            for (let y = 0; y < size; y++) {
                for (let z = 0; z < size; z++) {
                    // Átomo base
                    const base = {
                        x: off + x * spacing,
                        y: off + y * spacing,
                        z: off + z * spacing,
                    };
                    const a0 = await this._world.addAtom(element, base, { frozen: true });
                    atoms.push(a0);

                    // Átomos de cara (3 por celda, compartidos)
                    const faces = [
                        [spacing / 2, spacing / 2, 0],
                        [spacing / 2, 0, spacing / 2],
                        [0, spacing / 2, spacing / 2],
                    ];
                    for (const [dx, dy, dz] of faces) {
                        if ((dx > 0 && x === size - 1) ||
                            (dy > 0 && y === size - 1) ||
                            (dz > 0 && z === size - 1)) continue;
                        const fp = {
                            x: base.x + dx,
                            y: base.y + dy,
                            z: base.z + dz,
                        };
                        const a = await this._world.addAtom(element, fp, { frozen: true });
                        atoms.push(a);
                    }
                }
            }
        }

        // Conectar vecinos más cercanos por distancia real
        this._connectByDistance(atoms, spacing * 1.15);

        this._world.params.autoBond = prevAuto;
        this._freezeAll(atoms);

        console.log(`[CrystalFactory] 💎 FCC ${element} ${size}³ — ${atoms.length} átomos`);
        return atoms;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Hielo Ih — red hexagonal con puentes de hidrógeno
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Red hexagonal P6₃/mmc del hielo Ih.
     * 4 oxígenos por celda unitaria, cada O con 2H covalentes
     * y 2 puentes de hidrógeno (reglas Bernal-Fowler).
     *
     * @param {number} size — repeticiones de celda
     * @returns {Promise<Atom[]>}
     */
    async generateIce(size = 2) {
        const d_OH = 96;     // pm — enlace covalente O-H
        const d_OO = 276;    // pm — distancia O···O total

        // Celda unitaria real del hielo Ih
        const a   = 452;     // pm
        const c   = 736;     // pm
        const sq3 = Math.sqrt(3);
        const z0  = 0.0623 * c;  // parámetro interno z

        // 4 posiciones base de O en la celda
        const unitCell = [
            [0,       a * sq3 / 3,   z0          ],
            [a / 2,   a * sq3 / 6,   c / 2 + z0  ],
            [0,       a * sq3 / 3,   c / 2 - z0  ],
            [a / 2,   a * sq3 / 6,  -z0          ],
        ];

        const nx = Math.max(1, size);
        const ny = Math.max(1, size);
        const nz = Math.max(1, Math.ceil(size * 0.6));

        const cx = (nx - 1) * a * 0.5;
        const cy = (ny - 1) * a * sq3 / 2 * 0.5;
        const cz = (nz - 1) * c * 0.5;

        const prevAuto = this._world.params.autoBond;
        this._world.params.autoBond = false;

        const allAtoms = [];
        const oList    = [];

        // 1. Crear todos los O
        for (let ix = 0; ix < nx; ix++) {
            for (let iy = 0; iy < ny; iy++) {
                for (let iz = 0; iz < nz; iz++) {
                    const tx = ix * a + iy * (-a / 2) - cx;
                    const ty = iy * (a * sq3 / 2)     - cy;
                    const tz = iz * c                  - cz;

                    for (const [bx, by, bz] of unitCell) {
                        const o = await this._world.addAtom('O', {
                            x: tx + bx, y: ty + by, z: tz + bz,
                        }, { frozen: true });
                        allAtoms.push(o);
                        oList.push(o);
                    }
                }
            }
        }

        // 2. Para cada par O-O vecino, colocar H y crear bonds
        //    Regla Bernal-Fowler: cada O dona exactamente 2H
        const donated  = new Map();
        const hbonded  = new Set();
        oList.forEach(o => donated.set(o.id, 0));

        // Ordenar O por posición para reproducibilidad
        const sortedO = [...oList].sort((a, b) => {
            return a.position.y - b.position.y ||
                   a.position.x - b.position.x ||
                   a.position.z - b.position.z;
        });

        for (const oA of sortedO) {
            // Encontrar los 4 vecinos O más cercanos
            const nbrs = oList
                .filter(o => o !== oA)
                .map(o => ({
                    o,
                    d: oA.position.distanceTo(o.position),
                }))
                .filter(({ d }) => d < d_OO * 1.15)
                .sort((a, b) => a.d - b.d)
                .slice(0, 4);

            for (const { o: oB } of nbrs) {
                const key = [oA.id, oB.id].sort().join('-');
                if (hbonded.has(key)) continue;
                hbonded.add(key);

                const dir = new THREE.Vector3()
                    .subVectors(oB.position, oA.position).normalize();

                if (donated.get(oA.id) < 2) {
                    // oA dona H hacia oB
                    donated.set(oA.id, donated.get(oA.id) + 1);
                    const hPos = oA.position.clone().addScaledVector(dir, d_OH);
                    const h = await this._world.addAtom('H', {
                        x: hPos.x, y: hPos.y, z: hPos.z,
                    }, { frozen: true });
                    allAtoms.push(h);
                    this._world.addBond(oA, h);                         // O-H covalente
                    this._world.addBond(h, oB, { type: 'vdw' });       // H···O puente H

                } else if (donated.get(oB.id) < 2) {
                    // oB dona H hacia oA
                    donated.set(oB.id, donated.get(oB.id) + 1);
                    const dirBA = dir.clone().negate();
                    const hPos = oB.position.clone().addScaledVector(dirBA, d_OH);
                    const h = await this._world.addAtom('H', {
                        x: hPos.x, y: hPos.y, z: hPos.z,
                    }, { frozen: true });
                    allAtoms.push(h);
                    this._world.addBond(oB, h);
                    this._world.addBond(h, oA, { type: 'vdw' });
                }
            }
        }

        this._world.params.autoBond = prevAuto;
        this._freezeAll(allAtoms);

        console.log(`[CrystalFactory] ❄️ Ice Ih ${size}×${size} — ${allAtoms.length} átomos (${oList.length} O)`);
        return allAtoms;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Helpers
    // ═══════════════════════════════════════════════════════════════════════

    /** Conectar átomos por distancia — para FCC donde la grid es compleja */
    _connectByDistance(atoms, maxDist) {
        for (let i = 0; i < atoms.length; i++) {
            for (let j = i + 1; j < atoms.length; j++) {
                const d = atoms[i].position.distanceTo(atoms[j].position);
                if (d < maxDist && d > 1) {
                    this._world.addBond(atoms[i], atoms[j]);
                }
            }
        }
    }

    /** Congelar todos los átomos del cristal */
    _freezeAll(atoms) {
        for (const atom of atoms) {
            atom.frozen = true;
            atom.velocity.set(0, 0, 0);
            atom.force.set(0, 0, 0);
        }
    }

    /** Descongelar un cristal */
    unfreezeAll(atoms) {
        for (const atom of atoms) {
            atom.frozen = false;
        }
    }
}
