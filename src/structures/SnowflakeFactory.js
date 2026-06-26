/**
 * SnowflakeFactory.js — Generador fractal de copos de nieve
 *
 * Simetría C₆ del hielo Ih: 6 brazos fractales idénticos, rotados 60°.
 * Cada nodo es un O de H₂O con sus 2 H covalentes.
 * Sistema DNA: variaciones aleatorias compartidas entre los 6 brazos.
 *
 * Diseñado por Éter (Gemini), portado por Ámbar (Claude Opus).
 * Distancias en pm (1wu = 1pm).
 *
 * Uso:
 *   import { SnowflakeFactory } from './src/structures/SnowflakeFactory.js';
 *   const sf = new SnowflakeFactory(world);
 *   const atoms = await sf.generate(2, 0.7, 0.4);
 */

import * as THREE from 'three';

// Distancia O-O en hielo Ih: 276 pm
const D_OO = 276;
// Distancia O-H covalente: 96 pm
const D_OH = 96;

export class SnowflakeFactory {

    /**
     * @param {import('../core/World.js').World} world
     */
    constructor(world) {
        this._world = world;
    }

    /**
     * Generar copo único con sistema DNA.
     * @param {number} iterations  Complejidad (1-5)
     * @param {number} humidity    Probabilidad sub-ramas (0-1)
     * @param {number} chaos       Variación longitud (0-1)
     * @returns {Promise<Atom[]>} átomos generados
     */
    async generate(iterations, humidity, chaos) {
        const DNA   = this._generateDNA(iterations, humidity, chaos);
        const atoms = [];

        const prevAuto = this._world.params.autoBond;
        this._world.params.autoBond = false;

        // Centro
        const coreO = await this._addAtom({ x: 0, y: 0, z: 0 }, 'O');
        atoms.push(coreO);
        await this._addH2O(coreO, atoms);

        // 6 brazos — simetría C₆
        for (let i = 0; i < 6; i++) {
            const angle = (i * Math.PI * 2) / 6;
            const dir = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
            await this._buildBranch(coreO, dir, iterations, atoms, 1.0, DNA, 0);
        }

        // Congelar todo
        this._freezeAll(atoms);
        this._world.params.autoBond = prevAuto;

        console.log(`[SnowflakeFactory] ❄️ Copo generado — ${atoms.length} átomos`);
        return atoms;
    }

    // ── DNA ─────────────────────────────────────────────────────────────────

    _generateDNA(iterations, humidity, chaos) {
        const dna = [];
        for (let i = 0; i < iterations + 2; i++) {
            dna.push({
                hasSubBranches: Math.random() < humidity,
                lengthMod:      1.0 + (Math.random() - 0.5) * chaos,
                angle:          Math.PI / 3,
            });
        }
        return dna;
    }

    // ── Recursión fractal ───────────────────────────────────────────────────

    async _buildBranch(parent, dir, depth, atoms, scale, DNA, step) {
        if (depth <= 0 || step >= DNA.length) return;

        const gene     = DNA[step];
        const stepDist = D_OO * scale * gene.lengthMod;
        const newPos   = parent.position.clone().addScaledVector(dir, stepDist);

        const newO = await this._addAtom({ x: newPos.x, y: newPos.y, z: newPos.z }, 'O');
        atoms.push(newO);
        this._world.addBond(parent, newO, { type: 'vdw' }); // puente H entre nodos
        await this._addH2O(newO, atoms);

        // Sub-ramas ±60°
        if (gene.hasSubBranches && depth > 1) {
            const subScale = scale * 0.65;
            const leftDir  = dir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0),  gene.angle);
            const rightDir = dir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), -gene.angle);
            await this._buildBranch(newO, leftDir,  depth - 1, atoms, subScale, DNA, step + 1);
            await this._buildBranch(newO, rightDir, depth - 1, atoms, subScale, DNA, step + 1);
        }

        // Continuar brazo principal
        await this._buildBranch(newO, dir, depth - 1, atoms, scale * 0.9, DNA, step + 1);
    }

    // ── H₂O — dos H por cada O ─────────────────────────────────────────────

    async _addH2O(oAtom, atoms) {
        const pos = oAtom.position;
        // H ligeramente arriba y a los lados (plano XZ + offset Y)
        const h1 = await this._addAtom({
            x: pos.x + D_OH * 0.52,
            y: pos.y + D_OH * 0.40,
            z: pos.z + D_OH * 0.10,
        }, 'H');
        const h2 = await this._addAtom({
            x: pos.x - D_OH * 0.52,
            y: pos.y + D_OH * 0.40,
            z: pos.z - D_OH * 0.10,
        }, 'H');
        atoms.push(h1, h2);
        this._world.addBond(oAtom, h1); // O-H covalente
        this._world.addBond(oAtom, h2);
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    async _addAtom(pos, symbol) {
        const atom = await this._world.addAtom(symbol, pos, { frozen: true });
        return atom;
    }

    _freezeAll(atoms) {
        for (const atom of atoms) {
            atom.frozen = true;
            atom.velocity.set(0, 0, 0);
            atom.force.set(0, 0, 0);
        }
    }

    // ── Export/Import JSON ───────────────────────────────────────────────────

    exportJSON(atoms) {
        const atomSet = new Set(atoms.map(a => a.id));
        const bondList = [];
        for (const bond of this._world.bonds.values()) {
            if (atomSet.has(bond.atomA.id) && atomSet.has(bond.atomB.id)) {
                bondList.push(bond);
            }
        }
        const atomArr = [...atoms];
        return JSON.stringify({
            name:    'Copo Diseñado',
            formula: 'H2O_Snow',
            icon:    '❄️',
            atoms: atomArr.map(a => ({
                element:  a.symbol,
                position: [
                    parseFloat(a.position.x.toFixed(1)),
                    parseFloat(a.position.y.toFixed(1)),
                    parseFloat(a.position.z.toFixed(1)),
                ],
            })),
            bonds: bondList.map(b => ({
                from: atomArr.findIndex(a => a.id === b.atomA.id),
                to:   atomArr.findIndex(a => a.id === b.atomB.id),
                order: 1,
            })),
        }, null, 2);
    }

    async loadJSON(data) {
        const prevAuto = this._world.params.autoBond;
        this._world.params.autoBond = false;

        const atoms = [];
        for (const ad of data.atoms) {
            const pos = { x: ad.position[0], y: ad.position[1], z: ad.position[2] };
            const atom = await this._addAtom(pos, ad.element);
            atoms.push(atom);
        }
        for (const bd of data.bonds) {
            const a1 = atoms[bd.from];
            const a2 = atoms[bd.to];
            if (a1 && a2) this._world.addBond(a1, a2);
        }
        this._freezeAll(atoms);
        this._world.params.autoBond = prevAuto;
        return atoms;
    }
}
