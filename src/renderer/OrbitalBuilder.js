/**
 * OrbitalBuilder.js — Carga de orbitales (bakeado + procedural)
 * ==============================================================
 * Maneja dos modos:
 *   BAKEADO    — geometrías desde OrbitalCache (elementos con datos reales)
 *   PROCEDURAL — fallback O(n) sin rejection sampling para elementos sin cache
 */

import * as THREE from 'three';
import { OrbitalCache }  from './OrbitalCache.js';
import { ORBITAL_VERT, ORBITAL_FRAG } from './shaders.js';

// ── Escala visual ─────────────────────────────────────────────────────────────
//
// Un solo pmScale por elemento, derivado del metadata del baker.
// El orbital más externo (r_max_pm mayor) se mapea a TARGET_WU —
// todos los demás orbitales del elemento conservan sus proporciones reales.
//
//   pmScale = TARGET_WU / max(orbital.r_max_pm)
//
// El baker calcula r_max = radius_pm × (n/n_max) × 2.5 por orbital,
// así que este scale respeta la física sin necesidad de tablas hardcodeadas.

// Radio de referencia en pm — define "tamaño normal" visualmente
// Elementos con r_max_outer > REF se ven más grandes, menores se ven más chicos
// H(~53pm) → ~0.5x  |  Ne(~38pm) → ~0.4x  |  Cs(~298pm) → ~3x
const TARGET_WU  = 100; // world units para el elemento de referencia (≈180pm)
const RADIUS_REF = 180; // pm — tamaño promedio tabla periódica

const SUBSHELL_COLORS = {
    s: 0x00ffff,
    p: 0xff4fff,
    d: 0xffa500,
    f: 0x66ff66,
};

export class OrbitalBuilder {

    /**
     * @param {boolean}          isMobile
     * @param {THREE.Material[]} materialsRef  — array del renderer para tick uTime
     * @param {Object}           tuningRef     — referencia al objeto _tuning del renderer
     */
    constructor(isMobile, materialsRef, tuningRef) {
        this._isMobile     = isMobile;
        this._materialsRef = materialsRef;
        this._tuning       = tuningRef;
    }

    /**
     * Carga orbitales bakeados desde OrbitalCache.
     * Retorna los índices para los mapas del renderer.
     *
     * @param {string}       symbol
     * @param {Object}       orbMeta   — metadata del cache
     * @param {number}       baseScale — _baseScale() del renderer
     * @param {THREE.Group}  group     — shellsGroup
     * @returns {{ byKey, bySubshell, byLayer, matByKey }}
     */
    async loadBaked(symbol, orbMeta, baseScale, group) {
        const byKey      = new Map();
        const bySubshell = new Map();
        const byLayer    = new Map();
        const matByKey   = new Map();

        // Nada que cargar para esta capa (ej. H no tiene semi ni core)
        if (!orbMeta?.orbitals?.length) {
            return { byKey, bySubshell, byLayer, matByKey, rMaxOuter: 0, pmScale: 1.0 };
        }

        await OrbitalCache.preloadAll(symbol, (loaded, total) => {
            console.log(`[OrbitalBuilder] ${symbol}: ${loaded}/${total}`);
        });

        // pmScale = 1.0 siempre — los binarios están en pm, 1wu = 1pm.
        // Los shaders están calibrados para radios reales, escalar rompe la apariencia.
        const rMaxOuter = orbMeta.orbitals.reduce((mx, o) => Math.max(mx, o.r_max_pm ?? 0), 0) || 180;
        const pmScale   = 1.0;
        console.log(`[OrbitalBuilder] ${symbol}: r_max_outer=${rMaxOuter}pm  pmScale=1.0 (1wu=1pm)`);

        // Hueco nuclear en wu — proporcional al núcleo pero acotado por el orbital más pequeño.
        // Fórmula del núcleo: misma que NucleusBuilder para consistencia visual.
        // El gap NO puede tragarse ningún orbital: se calcula el r_max mínimo de todos
        // los orbitales y se asegura que innerRadius ≤ minOrbitalRmax * 0.25.
        const z            = orbMeta.Z ?? 1;
        const A            = Math.round(z * 2.5);
        const rNucleoWU    = Math.min(0.3 + Math.pow(A, 1/3) * 0.08, 1.0);
        const minOrbRmax   = orbMeta.orbitals.reduce((mn, o) => Math.min(mn, o.r_max_pm ?? Infinity), Infinity);
        const safeMinRmax  = Number.isFinite(minOrbRmax) ? minOrbRmax : rNucleoWU * 4;
        // Gap = núcleo + margen pequeño, pero nunca más del 25% del orbital más compacto
        const innerRadiusWU = Math.min(rNucleoWU + 0.3, safeMinRmax * 0.25);

        for (const orb of orbMeta.orbitals) {
            const geo = await OrbitalCache.getGeometry(symbol, orb.n, orb.l, orb.m);
            if (!geo) continue;

            const lKey    = 'spdf'[orb.l] ?? 's';
            const color   = new THREE.Color(SUBSHELL_COLORS[lKey] ?? 0xffffff);
            const bright  = orb.layer === 'valence' ? 5.0
                          : orb.layer === 'semi'    ? 3.0 : 1.5;
            const mStr    = orb.m >= 0 ? `+${orb.m}` : `${orb.m}`;
            const orbKey  = orb.orbital_key ?? `${orb.n}${lKey}_m${mStr}`;
            const subshell = orb.subshell   ?? `${orb.n}${lKey}`;
            const layer    = orb.layer      ?? 'inner';

            const mat = this._makeMat(color, baseScale, orb.n, pmScale, bright, innerRadiusWU);
            mat.userData = { orbKey, subshell, layer };

            const points = new THREE.Points(geo, mat);
            group.add(points);
            this._materialsRef.push(mat);

            byKey.set(orbKey, points);
            matByKey.set(orbKey, mat);
            this._addToMap(bySubshell, subshell, points);
            this._addToMap(byLayer,    layer,    points);
        }

        console.log(`[OrbitalBuilder] ${symbol} — ${orbMeta.orbitals.length} orbitales bakeados`);
        return { byKey, bySubshell, byLayer, matByKey, rMaxOuter, pmScale };
    }

    /**
     * Fallback procedural — O(n), sin rejection sampling, instantáneo.
     * Para elementos sin cache de orbitales.
     *
     * @param {Object}      meta      — datos del elemento
     * @param {number}      baseScale
     * @param {THREE.Group} group
     * @returns {{ byKey, bySubshell, byLayer, matByKey }}
     */
    loadProcedural(meta, baseScale, group) {
        const byKey      = new Map();
        const bySubshell = new Map();
        const byLayer    = new Map();
        const matByKey   = new Map();

        const identity = meta.identity        ?? {};
        const atomic   = meta.atomic_structure ?? {};
        const shells   = atomic.shells ?? [identity.number ?? 1];

        // Posiciones generadas directamente en wu — mismo espacio que TARGET_WU
        const maxR = TARGET_WU;

        const orbColors = [0xff6060, 0xffaa00, 0x00ffaa, 0x4488ff];
        const orbCounts = [1, 3, 5, 7];
        const pCount    = this._isMobile ? 3000 : 11000;

        shells.forEach((_, i) => {
            const level  = i + 1;
            const rOut   = (level / shells.length) * maxR;
            const color  = new THREE.Color(orbColors[Math.min(level - 1, 3)]);
            const nOrbs  = orbCounts[Math.min(level - 1, 3)];
            const bright = level === shells.length     ? 5.0
                         : level === shells.length - 1 ? 3.0 : 1.5;

            for (let o = 0; o < nOrbs; o++) {
                const pos   = this._genPos(level, o, rOut, pCount);
                const phase = this._genPhase(pos, rOut, pCount);

                const geo = new THREE.BufferGeometry();
                geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
                geo.setAttribute('aPhase',   new THREE.BufferAttribute(phase, 1));

                const layer   = `shell_${level}`;
                const orbKey  = `shell_${level}_${o}`;

                const mat = this._makeMat(color, baseScale, level, 1.0, bright);
                mat.userData = { orbKey, subshell: layer, layer };

                const points = new THREE.Points(geo, mat);
                group.add(points);
                this._materialsRef.push(mat);

                byKey.set(orbKey, points);
                matByKey.set(orbKey, mat);
                this._addToMap(bySubshell, layer, points);
                this._addToMap(byLayer,    layer, points);
            }
        });

        return { byKey, bySubshell, byLayer, matByKey, rMaxOuter: TARGET_WU, pmScale: 1.0 };
    }

    // ── Privados ──────────────────────────────────────────────────────────────

    _makeMat(color, baseScale, n, pmScale, bright, innerRadiusWU = 0) {
        return new THREE.ShaderMaterial({
            uniforms: {
                uTime:        { value: 0 },
                uColor:       { value: color.clone() },
                uScale:       { value: baseScale },
                uLevel:       { value: n },
                uPmScale:     { value: pmScale },
                uBright:      { value: bright },
                uEdge:        { value: this._tuning.edge },
                uSpeed:       { value: this._tuning.speed },
                uAmp:         { value: this._tuning.amp },
                uSize:        { value: this._tuning.size },
                uLodFade:     { value: 1.0 },
                uInnerRadius: { value: innerRadiusWU },  // hueco nuclear en wu
                uNuclearFade: { value: 0.0 },            // 0=normal, 1=modo nuclear (puntos se apagan)
                uStrobeBlend: { value: 0.0 },            // reservado ShaderLab
            },
            vertexShader:   ORBITAL_VERT,
            fragmentShader: ORBITAL_FRAG,
            transparent:    true,
            blending:       THREE.AdditiveBlending,
            depthWrite:     false,
            depthTest:      false,
            toneMapped:     false,
        });
    }

    _addToMap(map, key, value) {
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(value);
    }

    _genPos(level, o, rOut, pCount) {
        const pos    = new Float32Array(pCount * 3);
        const TWO_PI = Math.PI * 2;
        const phiOff = (o / 7) * Math.PI;

        for (let i = 0; i < pCount; i++) {
            const rMin = rOut * (0.6 + level * 0.04);
            const r    = rMin + (rOut - rMin) * Math.cbrt(Math.random());
            const cosT = Math.random() * 2 - 1;
            const sinT = Math.sqrt(1 - cosT * cosT);
            const phi  = Math.random() * TWO_PI + phiOff;
            pos[i * 3]     = r * sinT * Math.cos(phi);
            pos[i * 3 + 1] = r * sinT * Math.sin(phi);
            pos[i * 3 + 2] = r * cosT;
        }
        return pos;
    }

    _genPhase(pos, rOut, pCount) {
        const phase = new Float32Array(pCount);
        for (let k = 0; k < pCount; k++) {
            const px = pos[k*3], py = pos[k*3+1], pz = pos[k*3+2];
            phase[k] = Math.sqrt(px*px + py*py + pz*pz) / rOut;
        }
        return phase;
    }
}
