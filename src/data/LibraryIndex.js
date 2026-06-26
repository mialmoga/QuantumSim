/**
 * LibraryIndex.js — Índice maestro de la librería
 *
 * Carga el index.json al inicio y provee acceso rápido a moléculas,
 * cristales y entornos. Los archivos .mqcs/.cqcs/.eqcs se cargan
 * solo cuando el usuario los solicita (lazy loading).
 *
 * Uso:
 *   import { LibraryIndex } from './LibraryIndex.js';
 *   await LibraryIndex.init();
 *   const mol = await LibraryIndex.loadMolecule('H2O');
 *   const crystal = await LibraryIndex.loadCrystal('NaCl_crystal');
 */

// Ruta base de la librería
const LIBRARY_BASE = '/src/library/';
const INDEX_PATH   = `${LIBRARY_BASE}index.json`;

class _LibraryIndex {

    constructor() {
        // Índice cargado desde index.json
        this._index = null;

        // Cache de archivos ya cargados (evita fetch repetido)
        this._cache = new Map();
    }

    /**
     * Carga el índice maestro. Debe llamarse una vez al arrancar.
     */
    async init() {
        try {
            const res = await fetch(INDEX_PATH);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            this._index = await res.json();
            console.log('[LibraryIndex] Índice cargado:', {
                moléculas: this._index.molecules?.length ?? 0,
                cristales: this._index.crystals?.length ?? 0,
                entornos:  this._index.environments?.length ?? 0,
            });
        } catch (err) {
            console.error('[LibraryIndex] No se pudo cargar el índice:', err);
            this._index = { molecules: [], crystals: [], environments: [] };
        }
    }

    /**
     * Lista todos los ítems de un tipo.
     * Útil para mostrar la galería en la UI.
     *
     * @param {'molecules'|'crystals'|'environments'} type
     * @returns {Array}
     */
    list(type) {
        if (!this._index) {
            console.warn('[LibraryIndex] Índice no inicializado. Llama init() primero.');
            return [];
        }
        return this._index[type] ?? [];
    }

    /**
     * Carga y devuelve una molécula (.mqcs) por ID.
     *
     * @param {string} id - ID de la molécula (ej: 'H2O')
     * @returns {Promise<Object|null>}
     */
    async loadMolecule(id) {
        return this._load('molecules', id);
    }

    /**
     * Carga y devuelve un cristal (.cqcs) por ID.
     *
     * @param {string} id - ID del cristal (ej: 'NaCl_crystal')
     * @returns {Promise<Object|null>}
     */
    async loadCrystal(id) {
        return this._load('crystals', id);
    }

    /**
     * Carga y devuelve un entorno (.eqcs) por ID.
     *
     * @param {string} id - ID del entorno (ej: 'earth_surface')
     * @returns {Promise<Object|null>}
     */
    async loadEnvironment(id) {
        return this._load('environments', id);
    }

    /**
     * Carga un archivo de librería desde el dispositivo del usuario.
     * Soporta .mqcs, .cqcs, .eqcs
     *
     * @param {File} file - Objeto File del input[type=file]
     * @returns {Promise<Object|null>}
     */
    async loadFromFile(file) {
        const ext = file.name.split('.').pop().toLowerCase();
        const validFormats = ['mqcs', 'cqcs', 'eqcs'];

        if (!validFormats.includes(ext)) {
            console.error(`[LibraryIndex] Formato no soportado: .${ext}`);
            return null;
        }

        try {
            const text = await file.text();
            const data = JSON.parse(text);

            // Validación básica de formato
            if (data._format !== ext) {
                console.warn(`[LibraryIndex] El archivo declara formato '${data._format}' pero tiene extensión .${ext}`);
            }

            return data;
        } catch (err) {
            console.error('[LibraryIndex] Error al leer archivo:', err);
            return null;
        }
    }

    /**
     * Busca ítems en el índice por texto o tags.
     *
     * @param {string} query - Texto a buscar
     * @param {'molecules'|'crystals'|'environments'|'all'} [type='all']
     * @returns {Array}
     */
    search(query, type = 'all') {
        if (!this._index) return [];
        const q = query.toLowerCase();

        const searchIn = (items) => items.filter(item => {
            const nameEs = item.name?.es?.toLowerCase() ?? '';
            const nameEn = item.name?.en?.toLowerCase() ?? '';
            const formula = item.formula?.toLowerCase() ?? '';
            const tags = item.tags?.join(' ').toLowerCase() ?? '';
            return nameEs.includes(q) || nameEn.includes(q)
                || formula.includes(q) || tags.includes(q);
        });

        if (type === 'all') {
            return [
                ...searchIn(this._index.molecules ?? []).map(i => ({ ...i, _type: 'molecule' })),
                ...searchIn(this._index.crystals   ?? []).map(i => ({ ...i, _type: 'crystal' })),
                ...searchIn(this._index.environments ?? []).map(i => ({ ...i, _type: 'environment' })),
            ];
        }

        return searchIn(this._index[type] ?? []);
    }

    // ─── Privado ───────────────────────────────────────────────────────────────

    /**
     * Carga un archivo de librería por tipo e ID (con cache).
     */
    async _load(type, id) {
        if (!this._index) {
            console.warn('[LibraryIndex] Índice no inicializado.');
            return null;
        }

        // Buscar en el índice
        const entry = (this._index[type] ?? []).find(item => item.id === id);
        if (!entry) {
            console.error(`[LibraryIndex] No encontrado: ${type}/${id}`);
            return null;
        }

        // Retornar desde cache si ya fue cargado
        const cacheKey = `${type}/${id}`;
        if (this._cache.has(cacheKey)) {
            return this._cache.get(cacheKey);
        }

        // Fetch del archivo
        try {
            const url = `${LIBRARY_BASE}${entry.file}`;
            const res = await fetch(url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();

            this._cache.set(cacheKey, data);
            return data;
        } catch (err) {
            console.error(`[LibraryIndex] Error al cargar ${type}/${id}:`, err);
            return null;
        }
    }
}

// Singleton — una sola instancia para toda la app
export const LibraryIndex = new _LibraryIndex();
