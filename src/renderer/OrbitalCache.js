/**
 * OrbitalCache.js — Loader de caché de orbitales bakeados para Three.js r183
 * ============================================================================
 * Consume los .bin generados por bake_orbitals.py
 *
 * Formato .bin:
 *   [0..3]  magic 'ORBL'
 *   [4..7]  uint32 n_points
 *   [8..11] uint32 has_phase (1 = sí)
 *   [12..]  float32 × n_points × 3  (XYZ interleaved)
 *   [+...]  float32 × n_points       (phase, si has_phase=1)
 *
 * Uso básico:
 *   import { OrbitalCache } from './OrbitalCache.js';
 *
 *   await OrbitalCache.loadMeta('U');
 *   const geo = await OrbitalCache.getGeometry('U', 5, 3, -2); // 5f m=-2
 *   scene.add(new THREE.Points(geo, myMaterial));
 *
 * Uso con decaimiento:
 *   const chain = OrbitalCache.getDecayChain('U');
 *   // chain[0] = { isotope:'U-238', decay_mode:'alpha', half_life_s:..., ... }
 */

import * as THREE from 'three';

// ── Rutas ─────────────────────────────────────────────────────────────────────
const CACHE_BASE = '../QuantumSim/src/orbital_cache';

// ── Helpers ───────────────────────────────────────────────────────────────────
const L_LABELS = { 0: 's', 1: 'p', 2: 'd', 3: 'f' };

function orbitalFilename(n, l, m) {
    const sign = m >= 0 ? '+' : '-';
    return `${n}${L_LABELS[l]}_m${sign}${Math.abs(m)}.bin`;
}

// ── Clase principal ────────────────────────────────────────────────────────────
class _OrbitalCache {

    constructor() {
        // metadata por símbolo: sym → { orbitals, decay_chain, ... }
        this._meta    = new Map();
        // geometrías cacheadas: 'U/5f_m-2@5000' → THREE.BufferGeometry
        // La key incluye la resolución para que cambiar resolución invalide cache
        this._geoCache = new Map();
        // fetches en vuelo
        this._pending  = new Map();

        // ── Atlas de formas canónicas ────────────────────────────────────
        // Geometrías normalizadas a radio unitario, escalables por elemento
        this._atlas      = null;   // metadata del atlas (null = no cargado/no existe)
        this._atlasReady = false;

        // ── Source detection ────────────────────────────────────────────
        // Determinado una sola vez por probe() al init.
        //   'per-element' → buscar en orbital_cache/{sym}/
        //   'atlas'       → solo atlas, no intentar per-element
        //   'none'        → ni atlas ni per-element
        //   null          → no probeado aún
        this._sourceMode = null;
        this._probePromise = null;  // lock para evitar probes concurrentes
        // Elementos con per-element confirmado (Set de símbolos)
        this._perElementAvailable = new Set();

        // ── MO Atlas (orbitales moleculares genéricos) ───────────────────
        // Generado por bake_orbitals_v8.py --mode mo_atlas
        this._moAtlas      = null;   // metadata.json del _mo_atlas
        this._moAtlasMap   = null;   // atlas_map.json — lookup (typeA|typeB|order) → key
        this._moAtlasReady = false;
        // Cache de geometrías MO: 'sigma_1s-1s@5000' → THREE.BufferGeometry (normalizada)
        this._moGeoCache   = new Map();

        // ── Resolución de orbitales ────────────────────────────────────────
        // Cuántos puntos máximo cargar por orbital del .bin (que tiene 20k)
        // 'standard' → 5000  |  'high' → 10000  |  'ultra' → 20000
        this._resolution    = 'standard';
        this._maxPts        = 5_000;
    }

    // ══════════════════════════════════════════════════════════════════════
    //  MOLECULAR ORBITAL ATLAS
    //  Generado por bake_orbitals_v8.py --mode mo_atlas
    //  12 MOs base, coordenadas normalizadas. Escalar + rotar en runtime.
    // ══════════════════════════════════════════════════════════════════════

    /**
     * Carga el MO Atlas. Llamar una vez al init — falla silenciosamente.
     * @returns {Promise<boolean>}
     */
    async loadMOAtlas() {
        if (this._moAtlasReady) return !!this._moAtlas;
        this._moAtlasReady = true;
        try {
            const [metaRes, mapRes] = await Promise.all([
                fetch(`${CACHE_BASE}/_mo_atlas/metadata.json`),
                fetch(`${CACHE_BASE}/_mo_atlas/atlas_map.json`),
            ]);
            if (!metaRes.ok || !mapRes.ok) throw new Error('MO Atlas no disponible');
            this._moAtlas    = await metaRes.json();
            this._moAtlasMap = await mapRes.json();
            console.log(`[OrbitalCache] MO Atlas: ${this._moAtlas.MOs.length} MOs`);
            return true;
        } catch (err) {
            console.debug('[OrbitalCache] MO Atlas no disponible:', err.message);
            return false;
        }
    }

    /**
     * Resuelve el key del MO para un bond dado.
     * @param {string} valenceTypeA — 's1'|'s2'|'p'|'d'|'f'
     * @param {string} valenceTypeB
     * @param {number} bondOrder    — 1|2|3
     * @returns {string|null}
     */
    resolveMOKey(valenceTypeA, valenceTypeB, bondOrder = 1) {
        if (!this._moAtlasMap) return null;
        return this._moAtlasMap[`${valenceTypeA}|${valenceTypeB}|${bondOrder}`]
            ?? this._moAtlasMap[`${valenceTypeB}|${valenceTypeA}|${bondOrder}`]
            ?? null;
    }

    /**
     * Geometría normalizada del MO (separación=1.0 en z). Cacheada.
     * @param {string} moKey
     * @returns {Promise<THREE.BufferGeometry|null>}
     */
    async getMOGeometryRaw(moKey) {
        const cacheKey = `mo:${moKey}@${this._maxPts}`;
        if (this._moGeoCache.has(cacheKey)) return this._moGeoCache.get(cacheKey);
        if (!this._moAtlas) return null;

        const moMeta = this._moAtlas.MOs.find(m => m.key === moKey);
        if (!moMeta) { console.warn(`[OrbitalCache] MO no encontrado: ${moKey}`); return null; }

        const result = await this._loadBin(`${CACHE_BASE}/_mo_atlas/${moMeta.file}`);
        if (!result) return null;

        const geo = this._buildGeometry(result.positions, result.phase);
        this._moGeoCache.set(cacheKey, geo);
        return geo;
    }

    /**
     * Carga un MO escalado y rotado al eje del bond real.
     * Cada llamada devuelve una copia nueva — el caller hace dispose cuando termine.
     *
     * @param {string} moKey
     * @param {number} bondLengthPm  — distancia A-B en picómetros
     * @param {THREE.Vector3} posA   — posición world átomo A
     * @param {THREE.Vector3} posB   — posición world átomo B
     * @param {number} pmToWU        — pm → world units (default 0.01)
     * @returns {Promise<THREE.BufferGeometry|null>}
     */
    async getMolecularOrbital(moKey, bondLengthPm, posA, posB, pmToWU = 0.01) {
        const raw = await this.getMOGeometryRaw(moKey);
        if (!raw) return null;

        const geo = raw.clone();
        const wuLen = bondLengthPm * pmToWU;

        // Escalar separación normalizada → longitud real del bond
        const posAttr = geo.getAttribute('position');
        const arr = posAttr.array;
        for (let i = 0; i < arr.length; i++) arr[i] *= wuLen;
        posAttr.needsUpdate = true;

        // Rotar eje z → eje A→B
        const dir  = new THREE.Vector3().subVectors(posB, posA).normalize();
        const quat = new THREE.Quaternion().setFromUnitVectors(
            new THREE.Vector3(0, 0, 1), dir
        );
        geo.applyQuaternion(quat);

        // Trasladar al midpoint del bond
        const mid = new THREE.Vector3().addVectors(posA, posB).multiplyScalar(0.5);
        geo.translate(mid.x, mid.y, mid.z);

        geo.computeBoundingSphere();
        return geo;
    }

    /** Limpia el cache de geometrías MO */
    disposeMOAtlas() {
        for (const geo of this._moGeoCache.values()) geo.dispose();
        this._moGeoCache.clear();
    }

    /**
     * Probe de sistema de datos — llamar UNA vez al init del app.
     * Detecta si hay per-element bakes, atlas, o nada.
     * Evita N fetches fallidos por frame durante la vida del simulador.
     * Usa lock de Promise para que llamadas concurrentes esperen la misma.
     *
     * @returns {Promise<'per-element'|'atlas'|'none'>}
     */
    async probe() {
        if (this._sourceMode) return this._sourceMode;
        // Si ya hay un probe en vuelo, esperar a que termine
        if (this._probePromise) return this._probePromise;
        this._probePromise = this._doProbe();
        return this._probePromise;
    }

    async _doProbe() {

        // 1. Intentar cargar atlas primero (es el sistema más eficiente)
        await this._tryLoadAtlas();
        const hasAtlas = !!this._atlas;

        // 2. Probar si existe al menos un per-element (H es el canario)
        let hasPerElement = false;
        try {
            const res = await fetch(`${CACHE_BASE}/H/metadata.json`, { method: 'HEAD' });
            hasPerElement = res.ok;
        } catch { /* red/network error → no hay per-element */ }

        if (hasPerElement && hasAtlas) {
            this._sourceMode = 'per-element';  // per-element con atlas fallback
            console.log('[OrbitalCache] Probe: per-element + atlas disponibles');
        } else if (hasAtlas) {
            this._sourceMode = 'atlas';
            console.log('[OrbitalCache] Probe: solo atlas — skip per-element fetches');
        } else if (hasPerElement) {
            this._sourceMode = 'per-element';
            console.log('[OrbitalCache] Probe: solo per-element (sin atlas)');
        } else {
            this._sourceMode = 'none';
            console.warn('[OrbitalCache] Probe: sin datos de orbitales');
        }

        return this._sourceMode;
    }

    /**
     * Cambia la resolución global de orbitales.
     * Invalida el cache de geometrías — hay que recargar los elementos.
     * @param {'standard'|'high'|'ultra'} level
     */
    setResolution(level) {
        const map = { standard: 5_000, high: 10_000, ultra: 20_000 };
        if (!map[level]) { console.warn(`[OrbitalCache] Resolución inválida: ${level}`); return; }
        if (this._resolution === level) return;
        this._resolution = level;
        this._maxPts     = map[level];
        // Invalidar geometrías — la metadata no cambia
        for (const geo of this._geoCache.values()) geo.dispose();
        this._geoCache.clear();
        console.log(`[OrbitalCache] Resolución → ${level} (${this._maxPts.toLocaleString()} pts/orbital)`);
    }

    getResolution() { return this._resolution; }

    // ── Metadata ──────────────────────────────────────────────────────────────

    /**
     * Carga el metadata.json de un elemento.
     * Seguro llamarlo múltiples veces — solo carga una vez.
     * @param {string} symbol
     */
    async loadMeta(symbol) {
        if (this._meta.has(symbol)) return this._meta.get(symbol);

        // Asegurar que el probe se hizo (lazy probe si nadie llamó probe() al init)
        if (!this._sourceMode) await this.probe();

        // ── Modo atlas-only: ir directo al atlas, no intentar per-element ──
        if (this._sourceMode === 'atlas') {
            if (!this._atlasReady) await this._tryLoadAtlas();
            if (this._atlas && this._atlas.scale_table?.[symbol]) {
                const synth = this._synthesizeMetaFromAtlas(symbol);
                if (synth) {
                    this._meta.set(symbol, synth);
                    return synth;
                }
            }
            return null;
        }

        // ── Modo per-element (con posible fallback a atlas) ──
        const url = `${CACHE_BASE}/${symbol}/metadata.json`;
        try {
            const res  = await fetch(url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            this._meta.set(symbol, data);
            this._perElementAvailable.add(symbol);
            console.log(`[OrbitalCache] Meta cargada: ${symbol} — ${data.total_orbitals_baked} orbitales`);
            return data;
        } catch (err) {
            // Per-element falló para este símbolo — intentar atlas
            if (!this._atlasReady) await this._tryLoadAtlas();
            if (this._atlas && this._atlas.scale_table?.[symbol]) {
                const synth = this._synthesizeMetaFromAtlas(symbol);
                if (synth) {
                    this._meta.set(symbol, synth);
                    console.log(`[OrbitalCache] Meta sintetizada desde atlas: ${symbol} — ${synth.total_orbitals_baked} orbitales`);
                    return synth;
                }
            }
            console.error(`[OrbitalCache] Error cargando meta de ${symbol}:`, err);
            return null;
        }
    }

    /**
     * Carga el atlas de formas canónicas.
     * Llamar una vez al init — falla silenciosamente si no existe.
     */
    async loadAtlas() {
        return this._tryLoadAtlas();
    }

    /** @private */
    async _tryLoadAtlas() {
        if (this._atlasReady) return this._atlas;
        this._atlasReady = true;  // marcar como intentado (aunque falle)

        const url = `${CACHE_BASE}/_atlas/metadata.json`;
        try {
            const res = await fetch(url);
            if (!res.ok) return null;
            this._atlas = await res.json();
            console.log(`[OrbitalCache] Atlas cargado: ${this._atlas.total_forms} formas canónicas, ${Object.keys(this._atlas.scale_table).length} elementos`);
            return this._atlas;
        } catch (err) {
            console.debug('[OrbitalCache] Atlas no disponible — usando modo per-element');
            return null;
        }
    }

    /**
     * Sintetiza metadata compatible desde la tabla de escalado del atlas.
     * Permite que loadElement/getOrbitalList/etc funcionen igual.
     * @private
     */
    _synthesizeMetaFromAtlas(symbol) {
        const scales = this._atlas?.scale_table?.[symbol];
        if (!scales) return null;

        const orbitals = [];
        for (const [key, info] of Object.entries(scales)) {
            orbitals.push({
                file:         `${key}.bin`,  // no existe per-element, pero getGeometry sabe redirigir
                orbital_key:  key,
                subshell:     `${info.n}${L_LABELS[info.l]}`,
                layer:        info.layer,
                n:            info.n,
                l:            info.l,
                m:            info.m,
                electrons:    info.electrons,
                r_max_pm:     info.r_max_pm,
                r_sample_pm:  info.r_sample_pm,
                n_points:     this._atlas.points_per_form,
                _atlas:       true,  // flag interno — geometría viene del atlas
            });
        }

        return {
            format_version:       'atlas-synth',
            symbol:               symbol,
            mode:                 'atlas',
            total_orbitals_baked: orbitals.length,
            orbitals:             orbitals,
            decay_chain:          [],
        };
    }

    /**
     * Lista los orbitales disponibles para un elemento.
     * Requiere loadMeta() previo.
     * @param {string} symbol
     * @returns {Array<Object>} lista de { n, l, m, label, electrons, file, energy_ev, is_valence }
     */
    getOrbitalList(symbol) {
        return this._meta.get(symbol)?.orbitals ?? [];
    }

    /**
     * Solo los orbitales de valencia.
     * Compatible con v1 (valence_orbitals) y v2 (layer === 'valence').
     * @param {string} symbol
     */
    getValenceOrbitals(symbol) {
        const meta = this._meta.get(symbol);
        if (!meta) return [];
        // v1: campo explícito
        if (meta.valence_orbitals?.length) return meta.valence_orbitals;
        // v2: filtrar por layer
        return (meta.orbitals ?? []).filter(o => o.layer === 'valence');
    }

    /**
     * Orbitales semi-valencia (3d en Fe, 5f/6d en U).
     * Solo disponible en metadata v2.
     * @param {string} symbol
     */
    getSemiOrbitals(symbol) {
        return (this._meta.get(symbol)?.orbitals ?? []).filter(o => o.layer === 'semi');
    }

    /**
     * Orbitales core (capas internas).
     * @param {string} symbol
     */
    getCoreOrbitals(symbol) {
        return (this._meta.get(symbol)?.orbitals ?? []).filter(o => o.layer === 'core');
    }

    /**
     * Orbitales filtrados por layer: 'core' | 'semi' | 'valence'
     * @param {string} symbol
     * @param {string} layer
     */
    getByLayer(symbol, layer) {
        return (this._meta.get(symbol)?.orbitals ?? []).filter(o => o.layer === layer);
    }

    /**
     * Cadena de decaimiento completa con energías y colores.
     * @param {string} symbol
     * @returns {Array<Object>}
     */
    getDecayChain(symbol) {
        return this._meta.get(symbol)?.decay_chain ?? [];
    }

    // ── Geometrías ────────────────────────────────────────────────────────────

    /**
     * Carga y devuelve una THREE.BufferGeometry lista para usar con Points.
     * Atributos en la geometría:
     *   position → Float32Array (n × 3) en pm, centrado en origen
     *   aPhase   → Float32Array (n)     rango [0,1] para animación en shader
     *
     * Fallback automático:
     *   1. Busca per-element: orbital_cache/{sym}/{n}{l}_m{m}.bin
     *   2. Si no existe → atlas: orbital_cache/_atlas/{n}{l}_m{|m|}.bin × r_sample_pm
     *
     * @param {string} symbol
     * @param {number} n  — número cuántico principal
     * @param {number} l  — momento angular (0=s,1=p,2=d,3=f)
     * @param {number} m  — momento magnético
     * @returns {Promise<THREE.BufferGeometry|null>}
     */
    async getGeometry(symbol, n, l, m) {
        const key = `${symbol}/${n}${L_LABELS[l]}_m${m > 0 ? '+' : ''}${m}@${this._maxPts}`;

        if (this._geoCache.has(key)) return this._geoCache.get(key);
        if (this._pending.has(key))  return this._pending.get(key);

        const promise = this._loadGeometryWithFallback(symbol, n, l, m, key);
        this._pending.set(key, promise);
        try {
            return await promise;
        } finally {
            this._pending.delete(key);
        }
    }

    /** @private — intenta per-element, fallback a atlas */
    async _loadGeometryWithFallback(symbol, n, l, m, cacheKey) {
        // ── Decidir si intentar per-element ──
        // Skip si: sourceMode es 'atlas', o la meta de este elemento vino del atlas
        const meta = this._meta.get(symbol);
        const isAtlasSourced = this._sourceMode === 'atlas'
                            || meta?.mode === 'atlas'
                            || !this._perElementAvailable.has(symbol);

        if (!isAtlasSourced) {
            // 1. Intentar per-element
            const fname = orbitalFilename(n, l, m);
            const url   = `${CACHE_BASE}/${symbol}/${fname}`;

            const result = await this._loadBin(url);
            if (result) {
                const geo = this._buildGeometry(result.positions, result.phase);
                this._geoCache.set(cacheKey, geo);
                return geo;
            }
        }

        // 2. Atlas directo (sin intentar per-element que sabemos no existe)
        if (!this._atlasReady) await this._tryLoadAtlas();
        if (!this._atlas) return null;

        const absM    = Math.abs(m);
        const sign    = absM >= 0 ? '+' : '-';
        const atlFname = `${n}${L_LABELS[l]}_m${sign}${absM}.bin`;
        const atlUrl   = `${CACHE_BASE}/_atlas/${atlFname}`;

        const result = await this._loadBin(atlUrl);
        if (!result) return null;

        // Escalar por r_sample_pm del elemento
        const mSign  = m >= 0 ? '+' : '-';
        const orbKey = `${n}${L_LABELS[l]}_m${mSign}${Math.abs(m)}`;
        const scale  = this._atlas.scale_table?.[symbol]?.[orbKey]?.r_sample_pm ?? 100;

        // Posiciones atlas están normalizadas — multiplicar por r_sample_pm
        const positions = result.positions;
        for (let i = 0; i < positions.length; i++) {
            positions[i] *= scale;
        }

        // Para m negativo: rotar 90° alrededor del eje z (m=-1 es m=+1 rotado)
        if (m < 0 && l > 0) {
            this._rotateZ90(positions);
        }

        const geo = this._buildGeometry(positions, result.phase);
        this._geoCache.set(cacheKey, geo);
        return geo;
    }

    /**
     * Rota posiciones 90° alrededor del eje Z.
     * Para obtener m negativo desde m positivo del atlas.
     * @private
     */
    _rotateZ90(positions) {
        for (let i = 0; i < positions.length; i += 3) {
            const x = positions[i];
            const y = positions[i + 1];
            positions[i]     = -y;
            positions[i + 1] =  x;
        }
    }

    /**
     * Precarga en paralelo todos los orbitales de valencia de un elemento.
     * @param {string} symbol
     * @returns {Promise<Map<string, THREE.BufferGeometry>>}
     */
    async preloadValence(symbol) {
        return this.preloadLayer(symbol, 'valence');
    }

    /**
     * Precarga en paralelo todos los orbitales de una capa específica.
     * @param {string} symbol
     * @param {string} layer — 'core' | 'semi' | 'valence'
     * @returns {Promise<Map<string, THREE.BufferGeometry>>}
     */
    async preloadLayer(symbol, layer) {
        const orbitals = this.getByLayer(symbol, layer);
        if (!orbitals.length) {
            console.warn(`[OrbitalCache] No hay orbitales '${layer}' para ${symbol}. ¿Llamaste loadMeta()?`);
            return new Map();
        }
        const results = await Promise.all(
            orbitals.map(async o => {
                const geo = await this.getGeometry(symbol, o.n, o.l, o.m);
                return [`${o.n}${L_LABELS[o.l]}_m${o.m}`, geo];
            })
        );
        return new Map(results.filter(([, g]) => g !== null));
    }

    /**
     * Precarga todos los orbitales de un elemento (incluyendo capas internas).
     * Puede tardar — úsalo en un loading screen.
     *
     * @param {string} symbol
     * @param {Function} onProgress — callback(loaded, total)
     */
    async preloadAll(symbol, onProgress = null) {
        const list = this.getOrbitalList(symbol);
        let loaded = 0;

        await Promise.all(
            list.map(async o => {
                await this.getGeometry(symbol, o.n, o.l, o.m);
                loaded++;
                onProgress?.(loaded, list.length);
            })
        );
    }

    /**
     * Libera todas las geometrías de un elemento de la caché y de la GPU.
     * @param {string} symbol
     */
    disposeElement(symbol) {
        for (const [key, geo] of this._geoCache.entries()) {
            if (key.startsWith(`${symbol}/`)) {
                geo.dispose();
                this._geoCache.delete(key);
            }
        }
    }

    // ── Helpers para Three.js ─────────────────────────────────────────────────

    /**
     * Escala las posiciones de pm a unidades de Three.js.
     * El simulador usa 1 unidad = 1 pm por defecto, pero puedes ajustar.
     *
     * @param {THREE.BufferGeometry} geo
     * @param {number} scale — multiplicador (default 1.0)
     */
    static scaleGeometry(geo, scale = 1.0) {
        if (scale === 1.0) return geo;
        const pos = geo.attributes.position.array;
        for (let i = 0; i < pos.length; i++) pos[i] *= scale;
        geo.attributes.position.needsUpdate = true;
        return geo;
    }

    /**
     * Convierte energía de fotón gamma (keV) a color THREE.Color.
     * Útil para visualizar emisiones en la cadena de decaimiento.
     *
     * @param {number|null} energyKeV
     * @returns {THREE.Color}
     */
    static gammaToColor(energyKeV) {
        if (!energyKeV) return new THREE.Color(0x888888);
        const e = energyKeV;
        if (e < 100)  return new THREE.Color(1.0, e/100*0.5, 0.0);
        if (e < 500) {
            const t = (e - 100) / 400;
            return new THREE.Color(1.0 - t, 0.8, t * 0.3);
        }
        const t = Math.min((e - 500) / 1000, 1.0);
        return new THREE.Color(0.0, 0.8 - t*0.6, 0.4 + t*0.6);
    }

    // ── Privado ───────────────────────────────────────────────────────────────

    async _loadBin(url) {
        try {
            const res = await fetch(url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const buf = await res.arrayBuffer();

            const view = new DataView(buf);

            // Validar magic
            const magic = String.fromCharCode(
                view.getUint8(0), view.getUint8(1),
                view.getUint8(2), view.getUint8(3)
            );
            if (magic !== 'ORBL') throw new Error(`Magic inválido: ${magic}`);

            const nPoints  = view.getUint32(4, true);   // little-endian
            const hasPhase = view.getUint32(8, true);

            const headerBytes = 12;
            const posBytes    = nPoints * 3 * 4;         // float32 × 3

            const positions = new Float32Array(buf, headerBytes, nPoints * 3);
            const phase     = hasPhase
                ? new Float32Array(buf, headerBytes + posBytes, nPoints)
                : new Float32Array(nPoints).fill(0);

            // ── Downsampling por resolución ────────────────────────────────
            // El .bin tiene hasta 20k pts — tomamos step uniforme para no
            // perder la distribución espacial del orbital.
            if (this._maxPts < nPoints) {
                const step    = Math.floor(nPoints / this._maxPts);
                const outN    = Math.min(this._maxPts, Math.floor(nPoints / step));
                const posOut  = new Float32Array(outN * 3);
                const phsOut  = new Float32Array(outN);
                for (let i = 0; i < outN; i++) {
                    const src = i * step;
                    posOut[i*3]   = positions[src*3];
                    posOut[i*3+1] = positions[src*3+1];
                    posOut[i*3+2] = positions[src*3+2];
                    phsOut[i]     = phase[src];
                }
                return { positions: posOut, phase: phsOut, nPoints: outN };
            }

            return { positions, phase, nPoints };

        } catch (err) {
            console.error(`[OrbitalCache] Error cargando bin: ${url}`, err);
            return null;
        }
    }

    _buildGeometry(positions, phase) {
        const geo = new THREE.BufferGeometry();

        // Copiar para evitar referencias al ArrayBuffer original (que puede ser GC'd)
        const posCopy   = new Float32Array(positions);
        const phaseCopy = new Float32Array(phase);

        geo.setAttribute('position', new THREE.BufferAttribute(posCopy, 3));
        geo.setAttribute('aPhase',   new THREE.BufferAttribute(phaseCopy, 1));

        geo.computeBoundingSphere();
        return geo;
    }
}

// Singleton
export const OrbitalCache = new _OrbitalCache();

/**
 * Determina el tipo de orbital de Valencia desde electron_configuration_string.
 * Función libre exportada — usar en Bond.js y otros módulos.
 * @param {string} cfg — e.g. '[Ar] 3d6 4s2'
 * @returns {'s1'|'s2'|'p'|'d'|'f'}
 */
export function valenceType(cfg) {
    const clean = (cfg ?? '').replace(/\[.*?\]/g, '').trim();
    if (!clean) return 's1';
    const last = clean.split(/\s+/).filter(Boolean).pop() ?? '';
    const m = last.match(/^(\d+)([spdf])/);
    if (!m) return 's2';
    if (m[2] === 's') return +m[1] === 1 ? 's1' : 's2';
    return m[2];  // 'p' | 'd' | 'f'
}

// ── Resolución rápida desde fuera ──────────────────────────────────────────────
// OrbitalCache.setResolution('standard') // 5k pts/orbital — móvil, carga rápida
// OrbitalCache.setResolution('high')     // 10k pts/orbital — desktop casual
// OrbitalCache.setResolution('ultra')    // 20k pts/orbital — Realidad Procedural Cuántica™


// ── ShaderMaterial recomendado para orbitales ─────────────────────────────────
/**
 * Crea un ShaderMaterial optimizado para Points con orbitales bakeados.
 * Usa aPhase del BufferAttribute — sin length(position) en GPU.
 *
 * @param {THREE.Color} color
 * @param {number} scale  — uScale = (3000 * devicePixelRatio * factor)
 * @param {number} level  — capa (1–7) para variación de parpadeo
 */
export function createOrbitalMaterial(color, scale, level = 1) {
    return new THREE.ShaderMaterial({

        uniforms: {
            uTime:  { value: 0 },
            uColor: { value: color.clone() },
            uScale: { value: scale },
            uLevel: { value: level },
        },

        vertexShader: /* glsl */`
            uniform float uTime, uScale, uLevel;
            attribute float aPhase;
            varying float vBlink;

            void main() {
                // aPhase pre-calculado en CPU — cero length() en GPU
                vBlink = sin(uTime * (2.0 + uLevel) + aPhase * 6.2832);

                vec4 mvP = modelViewMatrix * vec4(position, 1.0);
                gl_PointSize = uScale * (1.1 + vBlink * 0.25) / -mvP.z;
                gl_Position  = projectionMatrix * mvP;
            }
        `,

        fragmentShader: /* glsl */`
            uniform vec3 uColor;
            varying float vBlink;

            void main() {
                // Discard antes de cualquier cálculo — early-out en GPU
                vec2 uv = gl_PointCoord - 0.5;
                float d = dot(uv, uv);
                if (d > 0.25) discard;

                float alpha      = 1.0 - smoothstep(0.15, 0.25, d);
                float brightness = 4.0 * (0.85 + vBlink * 0.15);
                gl_FragColor = vec4(uColor * brightness, alpha);
            }
        `,

        transparent: true,
        blending:    THREE.AdditiveBlending,
        depthWrite:  false,
    });
}


// ── Ejemplo de uso comentado ──────────────────────────────────────────────────
/*

// ── Carga básica ──────────────────────────────────────────────────────────────
await OrbitalCache.loadMeta('Fe');
await OrbitalCache.loadMeta('U');

// ── Precargar por capas ───────────────────────────────────────────────────────
await OrbitalCache.preloadLayer('Fe', 'semi');    // 3d, 3s, 3p del Fe
await OrbitalCache.preloadLayer('Fe', 'valence'); // 4s del Fe
await OrbitalCache.preloadValence('U');           // 7s del U (shorthand)

// ── Iterar orbitales de una capa ──────────────────────────────────────────────
const semiOrbs = OrbitalCache.getSemiOrbitals('Fe'); // 3d, 3s, 3p
for (const orb of semiOrbs) {
    const geo = await OrbitalCache.getGeometry('Fe', orb.n, orb.l, orb.m);
    if (!geo) continue;

    // orb.layer     → 'core' | 'semi' | 'valence'
    // orb.z_eff     → Z efectivo usado en el bake (Slater)
    // orb.electrons → electrones en este orbital
    // orb.n_points  → puntos bakeados
    // orb.subshell  → '3d', '4s', '5f', etc.

    const color    = new THREE.Color(orbitalColors[orb.l]);
    const scale    = 2400 * devicePixelRatio * currentFactor;
    const material = createOrbitalMaterial(color, scale, orb.n);

    const points = new THREE.Points(geo, material);
    shellsGroup.add(points);
}

// ── Escalar de pm a unidades del simulador ────────────────────────────────────
// El simulador usa PM_TO_WU = 0.01 (1 wu = 100 pm)
const geo = await OrbitalCache.getGeometry('Fe', 3, 2, 0);
OrbitalCache.scaleGeometry(geo, 0.01); // pm → world units

// ── LOD: solo cargar lo que está cerca de la cámara ───────────────────────────
// Lejos  → no cargar nada (esfera simple)
// Medio  → preloadLayer('Fe', 'valence')   — solo 4s, 1 orbital
// Cerca  → preloadLayer('Fe', 'semi')      — 3d×5 + 3s + 3p×3
// Muy cerca (enlace) → preloadLayer('Fe', 'core') también

// ── Limpieza al salir del átomo del LOD ──────────────────────────────────────
OrbitalCache.disposeElement('Fe');

// ── Cadena de decaimiento (solo elementos radiactivos con metadata v1) ────────
const chain = OrbitalCache.getDecayChain('U');
chain.forEach(step => {
    // step.isotope, step.daughter, step.decay_mode
    // step.half_life_human, step.alpha_energy_mev
    // step.particle_color_hex, step.gamma_color_hex
});

*/
