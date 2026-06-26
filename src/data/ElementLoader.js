/**
 * ElementLoader.js — Cargador de elementos con índice y lazy loading
 *
 * Flujo:
 *   1. Al inicio: carga elements-index.json (ligero, ~30kb)
 *      → tiene número, nombre, grupo, color, material, ruta
 *   2. Cuando un elemento entra al workspace: carga su JSON completo
 *      → datos físicos, termodinámicos, reactivity, etc.
 *   3. Cache en memoria: cada JSON se carga una sola vez por sesión
 *
 * Uso:
 *   import { ElementLoader } from './ElementLoader.js';
 *   await ElementLoader.init();
 *
 *   // Datos del índice (siempre disponibles después de init)
 *   const meta = ElementLoader.getMeta('Fe');
 *   meta.color      // → "0xd4a843"
 *   meta.group      // → "transition_metal"
 *   meta.material   // → "metallic_iron"
 *
 *   // Datos completos (lazy — fetch solo si no está en cache)
 *   const el = await ElementLoader.load('Fe');
 *   el.atomic_structure.electronegativity  // → 1.83
 *   el.reactivity.max_bonds                // → 6
 *
 *   // Helpers de acceso rápido
 *   ElementLoader.radius('Fe')     // → radius_covalent_pm
 *   ElementLoader.mass('Fe')       // → mass en u
 *   ElementLoader.valence('Fe')    // → valence
 */

// Ruta base — relativa a /src/
const INDEX_PATH = '/src/elements-index.json';
const BASE_PATH  = '/src/';

class _ElementLoader {

    constructor() {
        // Índice ligero: sym → { number, name_es, name_eng, group, color, cpk_color, mass, material, file }
        this._index = null;

        // Cache de JSONs completos ya cargados: sym → full data object
        this._cache = new Map();

        // Conjunto de cargas en vuelo para evitar fetch doble del mismo elemento
        this._pending = new Map();
    }

    // ── Inicialización ────────────────────────────────────────────────────────

    /**
     * Carga el índice maestro. Llamar una vez al arrancar la app.
     * Es seguro llamarlo múltiples veces — solo carga una vez.
     */
    async init() {
        if (this._index) return; // ya inicializado

        try {
            const res = await fetch(INDEX_PATH);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            this._index = data.elements || {};
            console.log(`[ElementLoader] Índice cargado — ${Object.keys(this._index).length} elementos`);
        } catch (err) {
            console.error('[ElementLoader] No se pudo cargar el índice:', err);
            this._index = {};
        }
    }

    // ── Acceso al índice (siempre síncrono después de init) ───────────────────

    /**
     * Devuelve los metadatos del índice para un símbolo.
     * No hace fetch — solo lee del índice cargado.
     *
     * @param {string} symbol - Símbolo del elemento (ej: 'Fe', 'H', 'Au')
     * @returns {Object|null}
     */
    getMeta(symbol) {
        if (!this._index) {
            console.warn('[ElementLoader] Índice no inicializado. Llama init() primero.');
            return null;
        }
        return this._index[symbol] || null;
    }

    /**
     * Devuelve todos los metadatos del índice como array.
     * Útil para renderizar el selector de elementos completo.
     *
     * @returns {Array<Object>}
     */
    getAllMeta() {
        if (!this._index) return [];
        return Object.values(this._index).sort((a, b) => a.number - b.number);
    }

    /**
     * Devuelve todos los elementos de un grupo específico.
     *
     * @param {string} group - Nombre del grupo (ej: 'transition_metal', 'halogen')
     * @returns {Array<Object>}
     */
    getByGroup(group) {
        return this.getAllMeta().filter(el => el.group === group);
    }

    /**
     * Lista todos los grupos presentes en el índice con su conteo.
     *
     * @returns {Object} { group_name: count }
     */
    getGroups() {
        const groups = {};
        this.getAllMeta().forEach(el => {
            groups[el.group] = (groups[el.group] || 0) + 1;
        });
        return groups;
    }

    // ── Carga lazy de datos completos ─────────────────────────────────────────

    /**
     * Carga y devuelve el JSON completo de un elemento.
     * Si ya está en cache, lo devuelve sin fetch.
     * Si hay un fetch en vuelo para el mismo símbolo, espera ese mismo fetch.
     *
     * @param {string} symbol
     * @returns {Promise<Object|null>}
     */
    async load(symbol) {
        // Desde cache
        if (this._cache.has(symbol)) {
            return this._cache.get(symbol);
        }

        // Fetch en vuelo — no duplicar
        if (this._pending.has(symbol)) {
            return this._pending.get(symbol);
        }

        // Buscar ruta en el índice
        const meta = this.getMeta(symbol);
        if (!meta) {
            console.error(`[ElementLoader] Símbolo desconocido: '${symbol}'`);
            return null;
        }

        // Lanzar fetch y registrar como pendiente
        const promise = this._fetchElement(symbol, meta.file);
        this._pending.set(symbol, promise);

        try {
            const data = await promise;
            this._cache.set(symbol, data);
            return data;
        } finally {
            this._pending.delete(symbol);
        }
    }

    /**
     * Pre-carga varios elementos en paralelo.
     * Útil al cargar una molécula — precarga todos sus átomos de golpe.
     *
     * @param {string[]} symbols - Array de símbolos
     * @returns {Promise<Object>} { sym: data }
     */
    async loadMany(symbols) {
        const results = await Promise.all(
            symbols.map(async sym => [sym, await this.load(sym)])
        );
        return Object.fromEntries(results.filter(([, data]) => data !== null));
    }

    /**
     * Verifica si un elemento ya está en cache (sin fetch).
     *
     * @param {string} symbol
     * @returns {boolean}
     */
    isLoaded(symbol) {
        return this._cache.has(symbol);
    }

    // ── Helpers de acceso rápido ──────────────────────────────────────────────
    // Todos aceptan datos ya cargados (object) o símbolo (string, requiere cache)
    // Para símbolos no cargados devuelven null — usa load() primero.

    /**
     * Radio covalente en pm. Si no hay dato, devuelve radio atómico o 70pm.
     * @param {string|Object} el
     */
    radius(el) {
        const d = this._resolve(el);
        return d?.atomic_structure?.radius_covalent_pm
            || d?.atomic_structure?.radius_atomic_pm
            || 70;
    }

    /**
     * Radio de Van der Waals en pm.
     * @param {string|Object} el
     */
    vdwRadius(el) {
        const d = this._resolve(el);
        return d?.atomic_structure?.vanderwaals_radius_pm || this.radius(el) * 1.5;
    }

    /**
     * Masa atómica en u.
     * @param {string|Object} el
     */
    mass(el) {
        const d = this._resolve(el);
        return d?.physical_properties?.mass || 1;
    }

    /**
     * Valencia (electrones de capa externa).
     * @param {string|Object} el
     */
    valence(el) {
        const d = this._resolve(el);
        return d?.atomic_structure?.valence ?? 0;
    }

    /**
     * Electronegatividad (escala Pauling).
     * @param {string|Object} el
     */
    electronegativity(el) {
        const d = this._resolve(el);
        return d?.atomic_structure?.electronegativity ?? 0;
    }

    /**
     * Energía de enlace en eV.
     * @param {string|Object} el
     */
    bondEnergy(el) {
        const d = this._resolve(el);
        return d?.reactivity?.bond_energy_ev ?? 0.05;
    }

    /**
     * Máximo de enlaces que puede formar.
     * @param {string|Object} el
     */
    maxBonds(el) {
        const d = this._resolve(el);
        return d?.reactivity?.max_bonds ?? 1;
    }

    /**
     * Estados de oxidación como array.
     * @param {string|Object} el
     */
    oxidationStates(el) {
        const d = this._resolve(el);
        return d?.reactivity?.oxidation_states || [];
    }

    /**
     * Nombre localizado según idioma activo.
     * @param {string} symbol
     * @param {string} lang - 'es' | 'en'
     */
    getName(symbol, lang = 'es') {
        const meta = this.getMeta(symbol);
        if (!meta) return symbol;
        return lang === 'en' ? meta.name_eng : meta.name_es;
    }

    /**
     * Color CPK en formato 0xRRGGBB (del índice, sin fetch).
     * @param {string} symbol
     * @returns {string}
     */
    getColor(symbol) {
        return this.getMeta(symbol)?.color || '0xAAAAAA';
    }

    /**
     * Nombre de material para el renderer (del índice, sin fetch).
     * @param {string} symbol
     * @returns {string}
     */
    getMaterial(symbol) {
        return this.getMeta(symbol)?.material || 'default_atom';
    }

    /**
     * Devuelve true si el elemento es radiactivo
     * (tiene isotopes con stable: false y half_life corta).
     * Requiere datos completos cargados.
     * @param {string|Object} el
     */
    isRadioactive(el) {
        const d = this._resolve(el);
        if (!d) return false;
        const isotopes = d?.nuclear_and_environmental?.isotopes || [];
        // Si todos los isótopos son inestables → radiactivo
        return isotopes.length > 0 && isotopes.every(i => !i.stable);
    }

    /**
     * Fase a temperatura dada (aprox, basado en melt_K y boil_K).
     * @param {string|Object} el
     * @param {number} tempK
     * @returns {'solid'|'liquid'|'gas'|'unknown'}
     */
    phaseAt(el, tempK) {
        const d = this._resolve(el);
        if (!d) return 'unknown';
        const melt = d.physical_properties?.melt_K;
        const boil = d.physical_properties?.boil_K;
        if (!melt || !boil) return 'unknown';
        if (tempK < melt) return 'solid';
        if (tempK < boil) return 'liquid';
        return 'gas';
    }

    // ── Privado ───────────────────────────────────────────────────────────────

    /**
     * Resuelve un símbolo o dato ya cargado a un objeto de datos.
     */
    _resolve(el) {
        if (typeof el === 'string') return this._cache.get(el) || null;
        return el || null;
    }

    /**
     * Fetch real del JSON de un elemento.
     */
    async _fetchElement(symbol, filePath) {
        try {
            const url = `${BASE_PATH}${filePath}`;
            const res = await fetch(url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            console.log(`[ElementLoader] Cargado: ${symbol}`);
            return data;
        } catch (err) {
            console.error(`[ElementLoader] Error cargando ${symbol}:`, err);
            return null;
        }
    }
}

// Singleton
export const ElementLoader = new _ElementLoader();
