/**
 * MaterialLibrary.js — Librería de materiales para la esfera LOD-far
 * ===================================================================
 * Carga presets de ShaderLab (target=sphere) desde /src/materials/
 * y los expone como {vert, frag} listos para usar en _buildSphere.
 *
 * Paradigma v2.0 — materiales por elemento (no por familia):
 *   /src/materials/H.json    ← material del Hidrógeno
 *   /src/materials/Fe.json   ← material del Hierro
 *   /src/materials/Au.json   ← material del Oro
 *
 * Generados por:
 *   generate_materials.py    → src/material_params/{sym}_params.json  (física pura)
 *   ShaderLab devMode        → src/materials/{sym}.json               (compilado)
 *   generate_materials_ml.py → especialización ML sobre los params    (futuro)
 *
 * Fallback: si un elemento no tiene su material, usa el elemento
 * representativo de su grupo (Fe para metales de transición, etc.)
 *
 * Uso básico:
 *   import { MaterialLibrary } from './MaterialLibrary.js';
 *
 *   // En _buildSphere — materialName es el símbolo del elemento:
 *   const shaders = await MaterialLibrary.get('Fe');
 *   // shaders → { vert, frag }   (o null si no existe → usar fallback)
 *
 * Uso con getForElement:
 *   const mat = await MaterialLibrary.getForElement('Fe', 'transition_metal');
 */

const MATERIALS_BASE = '/src/materials';

// Mapa grupo → elemento representativo como fallback
// Si un elemento no tiene su propio material, usa el del elemento más representativo del grupo
const GROUP_MATERIAL_MAP = {
    nonmetal:               'O',   // Oxígeno — no metal típico
    halogen:                'F',   // Flúor — halógeno típico
    noble_gas:              'Ne',  // Neón — gas noble típico
    alkali_metal:           'Na',  // Sodio — alcalino típico
    alkaline_earth_metal:   'Ca',  // Calcio — alcalinotérreo típico
    metalloid:              'Si',  // Silicio — metaloide típico
    transition_metal:       'Fe',  // Hierro — metal de transición típico
    post_transition_metal:  'Al',  // Aluminio — post-transición típico
    lanthanide:             'La',  // Lantano — lantánido típico
    actinide:               'U',   // Uranio — actínido típico
    superheavy:             'Og',  // Oganesón — superpesado
    liquid:                 'Hg',  // Mercurio — líquido a T ambiente
};

class _MaterialLibrary {

    constructor() {
        // cache: nombre → { vert, frag, meta } | null (null = no existe)
        this._cache   = new Map();
        // fetches en vuelo — evita doble fetch del mismo material
        this._pending = new Map();
    }

    // ── API pública ───────────────────────────────────────────────────────────

    /**
     * Devuelve los shaders compilados de un material.
     * Carga el JSON si no está en cache.
     * Devuelve null si el material no existe — el caller aplica su fallback.
     *
     * @param {string} name — nombre del material (ej: 'magnetic_iron')
     * @returns {Promise<{vert:string, frag:string, meta:Object}|null>}
     */
    async get(name) {
        if (!name) return null;

        if (this._cache.has(name)) return this._cache.get(name);
        if (this._pending.has(name)) return this._pending.get(name);

        const promise = this._load(name);
        this._pending.set(name, promise);
        try {
            const result = await promise;
            this._cache.set(name, result);
            return result;
        } finally {
            this._pending.delete(name);
        }
    }

    /**
     * Precarga una lista de materiales en paralelo.
     * Útil al arrancar — precarga las 7 familias base.
     *
     * @param {string[]} names
     */
    async preload(names) {
        await Promise.all(names.map(n => this.get(n)));
        console.log(`[MaterialLibrary] Precargados: ${names.join(', ')}`);
    }

    /**
     * Precarga materiales de elementos representativos de cada grupo.
     * Llamar una vez al init del renderer principal.
     * Cuando el material específico no existe, estos sirven de fallback.
     */
    async preloadBase() {
        return this.preload([
            'H',   // no metal ligero
            'O',   // no metal
            'Ne',  // gas noble
            'Fe',  // metal de transición
            'Na',  // alcalino
            'Si',  // metaloide
            'La',  // lantánido
            'U',   // actínido
        ]);
    }

    /**
     * Devuelve true si el material ya está en cache (sin fetch).
     * @param {string} name
     */
    has(name) {
        return this._cache.has(name) && this._cache.get(name) !== null;
    }

    /**
     * Devuelve el material desde cache SIN fetch.
     * Retorna null si no está cargado aún.
     * Útil para acceso sincrónico desde Bond.js (que no es async).
     *
     * @param {string} name
     * @returns {{vert:string, frag:string, meta:Object}|null}
     */
    getCached(name) {
        if (!name) return null;
        const entry = this._cache.get(name);
        return entry ?? null;
    }

    /**
     * Devuelve el material apropiado para un grupo de elementos.
     * Prioridad: materialName explícito → fallback por grupo → null
     *
     * @param {string|null} materialName  — identity.material del elemento
     * @param {string|null} group         — identity.group del elemento
     * @returns {Promise<{vert,frag,meta}|null>}
     */
    async getForElement(materialName, group) {
        // 1. Material específico del elemento
        if (materialName) {
            const mat = await this.get(materialName);
            if (mat) return mat;
        }
        // 2. Fallback por grupo
        const fallback = GROUP_MATERIAL_MAP[group] ?? 'metallic_base';
        return this.get(fallback);
    }

    // ── Bond Materials ────────────────────────────────────────────────────────

    /**
     * Devuelve el material compilado para un tipo de enlace.
     * Busca en /src/materials/bonds/{type}.json
     * Devuelve null si no existe → Bond.js usa su fallback hardcodeado.
     *
     * @param {string} type — 'covalent' | 'ionic' | 'metallic' | 'vdw'
     * @returns {Promise<{vert:string, frag:string, meta:Object}|null>}
     */
    async getBondMaterial(type) {
        if (!type) return null;
        const key = `bonds/${type}`;
        return this.get(key);
    }

    /**
     * Precarga los bond materials (estándar + LCAO).
     * Llamar una vez al init — falla silenciosamente si no existen aún.
     */
    async preloadBonds() {
        const types = ['covalent', 'metallic', 'ionic', 'vdw'];
        const keys  = [
            ...types.map(t => `bonds/${t}`),
            ...types.map(t => `bonds/${t}_lcao`),
        ];
        await Promise.all(keys.map(k => this.get(k)));
        console.log('[MaterialLibrary] Bond materials precargados');
    }

    /**
     * Limpia el cache completo.
     * Útil en desarrollo para recargar materiales en caliente.
     */
    clear() {
        this._cache.clear();
        console.log('[MaterialLibrary] Cache vaciado');
    }

    // ── Privado ───────────────────────────────────────────────────────────────

    async _load(name) {
        const url = `${MATERIALS_BASE}/${name}.json`;
        try {
            const res = await fetch(url);
            if (!res.ok) {
                // 404 esperado para materiales derivados no creados aún
                if (res.status === 404) {
                    console.debug(`[MaterialLibrary] '${name}' no encontrado — usando fallback`);
                } else {
                    console.warn(`[MaterialLibrary] HTTP ${res.status} para '${name}'`);
                }
                return null;
            }

            const preset = await res.json();

            // Validar que es un preset ShaderLab con shaders compilados
            if (!preset.compiled?.vert || !preset.compiled?.frag) {
                console.warn(`[MaterialLibrary] '${name}' no tiene shaders compilados`);
                return null;
            }

            // Solo aceptar presets target=sphere o target=bond
            const validTargets = ['sphere', 'bond'];
            if (preset.target && !validTargets.includes(preset.target)) {
                console.warn(`[MaterialLibrary] '${name}' es target='${preset.target}', se esperaba sphere|bond`);
                return null;
            }

            console.log(`[MaterialLibrary] Cargado: ${name} (${preset.pipeline?.length ?? 0} nodos)`);

            return {
                vert: preset.compiled.vert,
                frag: preset.compiled.frag,
                meta: {
                    name:        name,
                    displayName: preset.name ?? name,
                    description: preset.description ?? '',
                    family:      preset.family ?? null,
                    pipeline:    preset.pipeline ?? [],
                    created:     preset.created ?? null,
                },
            };

        } catch (err) {
            console.error(`[MaterialLibrary] Error cargando '${name}':`, err);
            return null;
        }
    }
}

// Singleton
export const MaterialLibrary = new _MaterialLibrary();

/*

// ── Ejemplo de uso en _buildSphere ────────────────────────────────────────────

import { MaterialLibrary } from './MaterialLibrary.js';
import { SPHERE_VERT, SPHERE_FRAG } from './shaders.js';

async _buildSphere(radiusPm, color, materialName) {
    // ...geometría Fibonacci igual que antes...

    // Intentar cargar material del elemento
    const mat = await MaterialLibrary.get(materialName);
    const vert = mat?.vert ?? SPHERE_VERT;
    const frag = mat?.frag ?? SPHERE_FRAG;

    const shaderMat = new THREE.ShaderMaterial({
        uniforms: { ... },
        vertexShader:   vert,
        fragmentShader: frag,
        // ...
    });
}

// ── Precargar familias base al arrancar ───────────────────────────────────────

// En QuantumRenderer.init():
await MaterialLibrary.preloadBase();

*/
