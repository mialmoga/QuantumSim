/**
 * MoleculeFactory.js — Crea moléculas predefinidas en el World
 *
 * Carga moleculas.json (posiciones ya en pm = wu) y usa
 * World.addAtom() + World.addBond() para colocar moléculas completas.
 *
 * Uso:
 *   import { MoleculeFactory } from './src/structures/MoleculeFactory.js';
 *   const factory = new MoleculeFactory(world);
 *   await factory.init();                    // carga JSON
 *   factory.getList();                       // [{name, formula, icon}, ...]
 *   await factory.create(index, position);   // coloca molécula en la escena
 */

import * as THREE from 'three';

const MOLECULES_URL = 'data/moleculas.json';
const LCAO_URL      = 'data/LCAO.json';

export class MoleculeFactory {

    /**
     * @param {import('../core/World.js').World} world
     */
    constructor(world) {
        this._world     = world;
        this._molecules = null;  // se carga en init()
        this._lcao      = null;  // datos LCAO por molécula
    }

    /**
     * Cargar el JSON de moléculas y datos LCAO. Llamar una vez al inicio.
     */
    async init() {
        try {
            const [molResp, lcaoResp] = await Promise.all([
                fetch(MOLECULES_URL),
                fetch(LCAO_URL).catch(() => null),  // LCAO es opcional — no bloquea
            ]);
            this._molecules = await molResp.json();

            if (lcaoResp?.ok) {
                const lcaoData = await lcaoResp.json();
                // Indexar por múltiples claves para matching cross-idioma:
                //   "H2O" (LCAO.molecule) + "H₂O" (moleculas.formula, normalizada)
                this._lcao = new Map();
                for (const mol of (lcaoData.molecules ?? lcaoData)) {
                    this._lcao.set(mol.molecule, mol);
                    // También indexar por fórmula para matching cross-idioma
                    // LCAO dice "H2O", moleculas.json dice "H₂O" → normalizado "H2O"
                    if (mol.formula) this._lcao.set(mol.formula, mol);
                }
                console.log(`[MoleculeFactory] ✅ ${this._molecules.length} moléculas + ${this._lcao.size} LCAO cargadas`);
            } else {
                console.log(`[MoleculeFactory] ✅ ${this._molecules.length} moléculas (sin LCAO — fallback estético)`);
            }
        } catch (err) {
            console.error('[MoleculeFactory] ❌ Error cargando:', err);
            this._molecules = [];
        }
    }

    /**
     * Lista para la UI — nombre, fórmula, ícono.
     * @returns {Array<{name, formula, icon, atomCount}>}
     */
    getList() {
        if (!this._molecules) return [];
        return this._molecules.map((m, i) => ({
            index:     i,
            name:      m.name,
            name_en:   m.name_en,
            formula:   m.formula,
            icon:      m.icon,
            atomCount: m.atoms.length,
        }));
    }

    /**
     * Crear una molécula en la escena.
     *
     * @param {number} index — índice en el array de moléculas
     * @param {THREE.Vector3} [offset] — posición central (default: frente a la cámara)
     * @returns {Promise<{atoms: Atom[], bonds: Bond[]}>}
     */
    async create(index, offset) {
        const mol = this._molecules?.[index];
        if (!mol) {
            console.warn(`[MoleculeFactory] Molécula #${index} no encontrada`);
            return { atoms: [], bonds: [] };
        }

        const world = this._world;
        const off   = offset ?? new THREE.Vector3(0, 0, 0);

        // Paso 1: crear todos los átomos (sin auto-bonding)
        // Guardamos el autoBond original y lo desactivamos temporalmente
        const prevAutoBond = world.params.autoBond;
        world.params.autoBond = false;

        const atoms = [];
        for (const atomData of mol.atoms) {
            const pos = {
                x: atomData.position[0] + off.x,
                y: atomData.position[1] + off.y,
                z: atomData.position[2] + off.z,
            };
            const atom = await world.addAtom(atomData.element, pos);
            atoms.push(atom);
        }

        // Paso 2: crear bonds explícitos del JSON
        const bonds = [];
        if (mol.bonds) {
            // Buscar datos LCAO para esta molécula
            // Intentar por nombre, por fórmula normalizada, y por fórmula original
            const lcaoMol = this._findLcaoForMolecule(mol);

            for (const bondData of mol.bonds) {
                const a1 = atoms[bondData.from];
                const a2 = atoms[bondData.to];
                if (a1 && a2) {
                    // Buscar MOs LCAO para este par de átomos
                    const lcaoMOs = this._findLcaoForBond(lcaoMol, a1, a2);

                    const bond = world.addBond(a1, a2, {
                        order:       bondData.order ?? 1,
                        equilibrium: a1.position.distanceTo(a2.position), // distancia real del JSON → Morse en reposo
                        lcao:        lcaoMOs,
                    });
                    if (bond) {
                        bond.snapFormed(); // progress = 1 instantáneo — sin fade-in en moléculas precargadas
                        bonds.push(bond);
                    }
                }
            }
        }

        // Restaurar auto-bonding
        world.params.autoBond = prevAutoBond;

        console.log(`[MoleculeFactory] ${mol.icon} ${mol.name} — ${atoms.length} átomos, ${bonds.length} bonds`);
        return { atoms, bonds };
    }

    // ── LCAO lookup ─────────────────────────────────────────────────────────

    /**
     * Busca datos LCAO para una molécula, intentando múltiples estrategias:
     *   1. Nombre exacto (mol.name → "Agua")
     *   2. Fórmula normalizada (mol.formula "H₂O" → "H2O")
     *   3. Fórmula original (mol.formula "H₂O")
     *
     * @param {Object} mol — entrada de moleculas.json
     * @returns {Object|null} — entrada LCAO o null
     */
    _findLcaoForMolecule(mol) {
        if (!this._lcao) return null;

        // 1. Nombre exacto
        if (this._lcao.has(mol.name)) return this._lcao.get(mol.name);

        // 2. Fórmula normalizada: "H₂O" → "H2O", "CO₂" → "CO2"
        const normalized = (mol.formula ?? '').replace(/[₀₁₂₃₄₅₆₇₈₉]/g, c =>
            '₀₁₂₃₄₅₆₇₈₉'.indexOf(c).toString()
        );
        if (this._lcao.has(normalized)) return this._lcao.get(normalized);

        // 3. Fórmula original
        if (mol.formula && this._lcao.has(mol.formula)) return this._lcao.get(mol.formula);

        return null;
    }

    /**
     * Busca los MOs LCAO relevantes para un par de átomos.
     *
     * Prioridad:
     *   1. scope="bond" — busca entrada con los mismos símbolos atómicos
     *   2. scope="molecule" — devuelve los MOs de la molécula completa
     *   3. null — no hay datos LCAO para esta molécula
     *
     * @param {Object|null} lcaoMol — entrada LCAO de la molécula
     * @param {Atom} a1
     * @param {Atom} a2
     * @returns {Array|null} — array de MOs o null
     */
    _findLcaoForBond(lcaoMol, a1, a2) {
        if (!lcaoMol) return null;

        // Caso 1: molécula con bonds individuales (H₂, N₂, O₂, HF, CO)
        if (lcaoMol.bonds) {
            for (const bondEntry of lcaoMol.bonds) {
                const bondAtoms = bondEntry.atoms ?? [];
                const syms = [a1.symbol, a2.symbol].sort().join('-');
                // Comparar por símbolos base (sin números: "H1" → "H")
                const entrySorted = bondAtoms
                    .map(a => a.replace(/[0-9]/g, ''))
                    .sort()
                    .join('-');
                if (syms === entrySorted) return bondEntry.MOs;
            }
        }

        // Caso 2: molécula con MOs a nivel molecular (H₂O, adenina)
        if (lcaoMol.MOs) return lcaoMol.MOs;

        // Caso 3: sistemas deslocalizados (adenina π)
        if (lcaoMol.systems) {
            for (const sys of lcaoMol.systems) {
                if (sys.MOs) return sys.MOs;
            }
        }

        return null;
    }
}
