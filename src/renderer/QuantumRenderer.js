/**
 * QuantumRenderer.js — Renderizador de orbitales cuánticos v2.1
 * ============================================================
 *
 * MODOS:
 *   STANDALONE   new QuantumRenderer(container)
 *   INTEGRADO    new QuantumRenderer(null, { scene, camera, renderer })
 *
 * LOD (5 estados):
 *   'far'     → esfera Fibonacci, orbitales ocultos
 *   'mid'     → carga valence en background, esfera visible
 *   'near'    → orbitales visibles, esfera fade-out
 *   'quantum' → valencia reactiva activa
 *   'nuclear' → inmersión: darkshell + estrobo 25Hz + raymarching núcleo
 *
 * BOND STATES (solo valence en 'quantum'):
 *   setBondState(0) — libre
 *   setBondState(1) — atrayendo
 *   setBondState(2) — repeliendo
 *   setBondState(3) — intercambio
 *
 * SHADER HOT-SWAP (ShaderLab):
 *   loadShaderJSON(json)   — aplica shader en caliente
 *   resetShader(target)    — vuelve al built-in
 *
 * GRANULARIDAD (sin cambios):
 *   setOrbitalVisible / setSubshellVisible / setLayerVisible
 *   setTuning(param, value, target)
 *
 * Lógica de construcción en módulos separados:
 *   NucleusBuilder.js  — núcleo
 *   OrbitalBuilder.js  — orbitales bakeados y procedurales
 *   shaders.js         — GLSL fuente única
 */

import * as THREE          from 'three';
import { OrbitControls }   from 'three/addons/controls/OrbitControls.js';
import { EffectComposer }  from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass }      from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ElementLoader }   from '../data/ElementLoader.js';
import { getLanguage }    from '../data/i18n.js';
import { OrbitalCache }    from './OrbitalCache.js';
import { NucleusBuilder }  from './NucleusBuilder.js';
import { OrbitalBuilder }  from './OrbitalBuilder.js';
import { MaterialLibrary } from './MaterialLibrary.js';

// Imports internos
import { SPHERE_VERT, SPHERE_FRAG, DARKSHELL_VERT, DARKSHELL_FRAG } from './shaders.js';

// Re-exportar para compatibilidad con ShaderLab — fuente única en shaders.js
export { NUCLEUS_VERT, NUCLEUS_FRAG,
         ORBITAL_VERT, ORBITAL_FRAG,
         SPHERE_VERT,  SPHERE_FRAG,
         BASE_VERT,    CORE_FRAG,
         SEMI_VERT,    SEMI_FRAG,
         VALENCE_VERT, VALENCE_FRAG,
         SHADER_INTERFACE } from './shaders.js';

// ── Constantes LOD ────────────────────────────────────────────────────────────

const TARGET_WU = 100;  // world units para el radio máximo del orbital más externo

const LOD_DIST = {
    FAR_TO_MID:      280,   // empieza carga background
    MID_TO_NEAR:      180,   // activa orbitales
    NEAR_TO_QUANTUM:  35,   // activa valencia reactiva
};
const LOD_FADE_SPEED = 2.5; // velocidad de transición (factor/s)

const BLOOM_RES = new THREE.Vector2(512, 512);

function isMobileDevice() {
    return /Android|iPhone|iPad|iPod|Mobile|webOS/i.test(navigator.userAgent)
        || navigator.maxTouchPoints > 1
        || window.innerWidth < 900;
}

export class QuantumRenderer {

    constructor(container, opts = {}) {

        this.container = container;
        this.renderer  = opts.renderer ?? null;
        this.scene     = opts.scene    ?? null;
        this.camera    = opts.camera   ?? null;
        this.controls  = null;
        this.composer  = null;
        this.bloomPass = null;

        // Grupos de escena
        this.nucleusGroup = null;
        this.sphereGroup  = null;   // LOD far — esfera Fibonacci
        this.shellsGroup  = null;   // orbitales reales

        // Colección plana de materiales para tick uTime
        this._materials  = [];

        // Índices de acceso granular
        this._byKey      = new Map();
        this._bySubshell = new Map();
        this._byLayer    = new Map();
        this._matByKey   = new Map();

        this.currentSymbol = null;
        this.isMobile      = isMobileDevice();
        this._dpr          = Math.min(window.devicePixelRatio || 1, 2);

        // ── Tuning ────────────────────────────────────────────────────────────
        this._tuning = {
            edge:      0.150,
            bright:    5.0,
            size:      1.0,
            speed:     1.0,
            amp:       0.25,
            bloom:     0.066,
            thresh:    0.75,
            perOrbital: {},   // key → { bright, size, speed, amp, edge }
        };

        // ── Estado LOD ────────────────────────────────────────────────────────
        this._lodState     = 'far';
        this._lodFade      = 1.0;   // esfera: 1=visible, 0=oculta
        this._orbitFade    = 0.0;   // orbitales: 0=oculto, 1=visible
        this._loadedLayers = new Set();

        // ── Estado LOD Nuclear ─────────────────────────────────────────────
        this._darkshellMesh   = null;   // esfera opaca contenedora
        this._darkshellFade   = 0.0;    // 0=invisible, 1=opaco
        this._nuclearFade     = 0.0;    // 0=volumen invisible, 1=visible
        this._strobeBlend     = 0.0;    // 0=normal, 1=estrobo completo
        this._nuclearVolBuilt = false;  // flag para lazy-build del volumen

        // ── Tuning — patcheables desde index2 Nuclear Tuner ──────────────
        this._nuclearLodFraction   = 0.25;  // fracción de rMax para LOD nuclear
        this._darkFadeSpeed        = 0.3;
        this._nucFadeSpeed         = 0.2;
        this._hidePointsThreshold  = 0.85;
        this._eagerLoad       = opts.eagerLoad    ?? false;
        this._backgroundColor = opts.background  ?? 0x000508;
        this._enablePan    = opts.enablePan    ?? true;
        this._externalLoop = opts.externalLoop ?? false;
        this._meta         = null;
        this._orbMeta      = null;

        // ── Estado de enlace ──────────────────────────────────────────────────
        this._bondState = {
            state:         0,
            progress:      0.0,
            strength:      0.0,
            exchangePhase: 0.0,
            dir:           new THREE.Vector3(),
            color:         new THREE.Color(0xffffff),
        };

        // ── Shaders personalizados (ShaderLab) ────────────────────────────────
        // layer|'all' → { vert, frag, extraUniforms }
        this._customShaders = new Map();

        // Builders
        this._nucleusBuilder = new NucleusBuilder(this.isMobile, this._materials);
        this._orbitalBuilder = new OrbitalBuilder(this.isMobile, this._materials, this._tuning);

        this._onResize = this._handleResize.bind(this);
    }

    // ── Init ──────────────────────────────────────────────────────────────────

    async init() {
        await ElementLoader.init();
        this._buildRenderer();
        this._buildScene();
        this._buildCamera();
        this._buildControls();
        this._buildBloom();
        window.addEventListener('resize', this._onResize);
        if (!this._externalLoop) this._startLoop();
        console.log('[QR] ✅' + (this._externalLoop ? ' (loop externo)' : ''));
        return this;
    }

    /**
     * Init ligero para instancias del pool — solo crea grupos en la escena compartida.
     * No crea renderer/camera/bloom propios.
     */
    async _initPoolInstance() {
        await ElementLoader.init();
        this._attachGroups();
        console.log('[QR Pool] instancia lista');
        return this;
    }

    // ── API pública — Elemento ────────────────────────────────────────────────

    async loadElement(symbol) {
        this.currentSymbol = symbol;
        this._clearOrbitals();

        // Resetear tuning per-orbital — no contaminar con valores de elemento anterior
        this._tuning.perOrbital = {};

        const meta = await ElementLoader.load(symbol);
        if (!meta) { console.error(`[QR] Sin datos: ${symbol}`); return null; }

        this._meta = meta;

        // Núcleo
        await this._nucleusBuilder.build(meta, this.nucleusGroup);
        this._byLayer.set('nucleus', this.nucleusGroup.children.filter(c => c.isPoints));

        // Cargar metadata de orbitales primero — necesitamos r_max_outer para la esfera
        const orbMeta   = await OrbitalCache.loadMeta(symbol);
        this._orbMeta   = orbMeta;
        const baseScale = this._baseScale();

        // pmScale unificado — relativo al elemento real, igual que OrbitalBuilder
        // rMaxOuter del baker → TARGET_WU, esfera y orbitales en el mismo espacio
        const rMaxOuter  = orbMeta
            ? (orbMeta.orbitals.reduce((mx, o) => Math.max(mx, o.r_max_pm ?? 0), 0) || 180)
            : (meta.atomic_structure?.vanderwaals_radius_pm ?? 180);
        // pmScale = 1.0 siempre — 1wu = 1pm en todo el ecosistema.
        // Los shaders están calibrados para radios reales en pm.
        // Escalar rompe la apariencia del shader.
        // El encuadre del átomo en pantalla lo maneja la cámara, no el scale.
        const pmScale = 1.0;

        // Esfera Fibonacci para LOD far
        // color viene del JSON completo (identity.color), ok
        // material/group vienen del INDEX (getMeta) — no del JSON completo
        const identity     = meta.identity ?? {};
        const indexMeta    = ElementLoader.getMeta(symbol) ?? {};
        const color        = new THREE.Color(
            parseInt(String(identity.color ?? indexMeta.color ?? '0xaaaaaa').replace('0x',''), 16)
        );
        const materialName = indexMeta.material ?? null;
        const group        = indexMeta.group    ?? null;
        await this._buildSphere(rMaxOuter, pmScale, color, materialName, group);

        if (this._eagerLoad && orbMeta) {
            // QuantumView standalone: cargar todo de golpe y mostrar todo
            await this.preloadAll();
            this._lodFade   = 1.0;  // esfera visible
            this._orbitFade = 1.0;  // orbitales visibles
            this._applyFades();
        } else if (orbMeta) {
            // Simulador: LOD lazy
            const maps = await this._orbitalBuilder.loadBaked(symbol, orbMeta, baseScale, this.shellsGroup);
            this._mergeMaps(maps);
            // Orbitales ocultos hasta que LOD los active
            this._setOrbitalsVisible(false);
        } else {
            const maps = this._orbitalBuilder.loadProcedural(meta, baseScale, this.shellsGroup);
            this._mergeMaps(maps);
        }

        // Cámara: no se mueve automáticamente — el usuario decide su posición

        this._updateInfoUI(symbol, meta, orbMeta);
        return orbMeta;
    }

    async loadAtom(atom) { return this.loadElement(atom.symbol); }

    /**
     * Precarga todos los orbitales e ignora LOD.
     * Usar en QuantumView donde se quiere ver todo de golpe.
     */
    async preloadAll() {
        if (!this._orbMeta || !this.currentSymbol) return;
        const baseScale = this._baseScale();

        for (const layer of ['valence', 'semi', 'core']) {
            if (!this._loadedLayers.has(layer)) {
                this._loadedLayers.add(layer);
                const maps = await this._orbitalBuilder.loadBaked(
                    this.currentSymbol, { orbitals: this._orbMeta.orbitals.filter(o => o.layer === layer) },
                    baseScale, this.shellsGroup
                );
                this._mergeMaps(maps);
            }
        }

        // Respetar el estado actual de visibilidad (el checkbox del panel manda)
        // Solo aplicar fades si no han sido sobreescritos externamente
        this._applyFades();
    }

    // ── API pública — LOD ─────────────────────────────────────────────────────

    /**
     * Fuerza la esfera visible (lodFade=1) y oculta orbitales (orbitFade=0).
     * Útil en QuantumView para previsualizar materiales de esfera sin LOD.
     */
    showSphere() {
        this._lodFade   = 1.0;
        this._orbitFade = 0.0;
        this._applyFades();
    }

    setSphereVisible(visible) {
        this._sphereVisible = visible;
        if (visible) {
            // Mostrar esfera, ocultar orbitales (modo LOD far manual)
            this._lodFade   = 1.0;
            this._orbitFade = 0.0;
        } else {
            // Ocultar esfera, mostrar orbitales
            this._lodFade   = 0.0;
            this._orbitFade = 1.0;
        }
        this._applyFades();
    }

    /**
     * Llamar cada frame desde World.js o el loop standalone con la
     * distancia cámara→átomo en world units.
     *
     * @param {number} distWU — distancia cámara-átomo en wu
     * @param {number} dt     — delta time en segundos
     */
    async updateLOD(distWU, dt) {
        const prev = this._lodState;

        // Umbrales dinámicos — escalados al tamaño real del elemento
        const rMax = this._orbMeta
            ? Math.max(this._orbMeta.orbitals.reduce((m, o) => Math.max(m, o.r_max_pm ?? 0), 0), 80)
            : (this._meta?.atomic_structure?.vanderwaals_radius_pm ?? 150);

        const lod = {
            FAR_TO_MID:         rMax * 12.0,
            MID_TO_NEAR:        rMax * 6.0,
            NEAR_TO_QUANTUM:    rMax * 2.7,
            QUANTUM_TO_NUCLEAR: rMax * this._nuclearLodFraction,
        };

        // Determinar estado objetivo
        let target = 'far';
        if      (distWU < lod.QUANTUM_TO_NUCLEAR) target = 'nuclear';
        else if (distWU < lod.NEAR_TO_QUANTUM)    target = 'quantum';
        else if (distWU < lod.MID_TO_NEAR)        target = 'near';
        else if (distWU < lod.FAR_TO_MID)         target = 'mid';

        // Carga lazy en background según LOD
        if (target !== 'far' && this._orbMeta) {
            this._ensureLayer('valence');
        }
        if ((target === 'near' || target === 'quantum' || target === 'nuclear') && this._orbMeta) {
            this._ensureLayer('semi');
        }
        if ((target === 'quantum' || target === 'nuclear') && this._orbMeta) {
            this._ensureLayer('core');
        }

        this._lodState = target;

        // ── Fades suaves ──────────────────────────────────────────
        const speed      = LOD_FADE_SPEED * dt;
        const showOrbits = (target === 'near' || target === 'quantum' || target === 'nuclear');
        const isNuclear  = (target === 'nuclear');

        this._lodFade   = this._lerp(this._lodFade,   showOrbits ? 0.0 : 1.0, speed);
        this._orbitFade = this._lerp(this._orbitFade,  showOrbits ? 1.0 : 0.0, speed);

        // ── Nuclear transitions — velocidades tunables ──
        this._darkshellFade = this._lerp(this._darkshellFade, isNuclear ? 1.0 : 0.0, speed * this._darkFadeSpeed);
        this._nuclearFade   = this._lerp(this._nuclearFade,   isNuclear ? 1.0 : 0.0, speed * this._nucFadeSpeed);

        this._applyFades();
        this._applyNuclearFades();

        // Valencia reactiva en quantum y nuclear
        if ((target === 'quantum' || target === 'nuclear') && this._bondState.state > 0) {
            this._tickBondAnimation(dt);
        }

        // Lazy-build del volumen nuclear y darkshell
        if (isNuclear && !this._nuclearVolBuilt) {
            this._nuclearVolBuilt = true;
            this._nucleusBuilder.buildVolumetric(this.nucleusGroup);
            this._buildDarkshell(rMax);
            // Tint de la darkshell con color del elemento
            const color = this._meta?.identity?.color;
            if (color && this._darkshellMesh) {
                const hex = parseInt(String(color).replace('0x', ''), 16);
                this._darkshellMesh.material.uniforms.uTintColor.value.set(hex);
            }
        }

        // Actualizar cámara en el volumen y darkshell cada frame
        if (this._nuclearFade > 0.01) {
            this._nucleusBuilder.updateVolumetric(this.camera);
            if (this._darkshellMesh?.material?.uniforms?.uCameraPos) {
                this._darkshellMesh.material.uniforms.uCameraPos.value.copy(this.camera.position);
            }
        }

        if (prev !== target) {
            console.log(`[QR] ${this.currentSymbol} LOD: ${prev} → ${target} (${distWU.toFixed(0)} wu)`);
        }
    }

    // ── API pública — Bond states ─────────────────────────────────────────────

    /**
     * @param {number} state  0=libre | 1=atrayendo | 2=repeliendo | 3=intercambio
     * @param {Object} opts
     * @param {THREE.Vector3} [opts.dir]
     * @param {number}        [opts.strength]
     * @param {THREE.Color}   [opts.color]
     */
    setBondState(state, opts = {}) {
        this._bondState.state    = state;
        this._bondState.strength = opts.strength ?? 1.0;
        if (opts.dir)   this._bondState.dir.copy(opts.dir).normalize();
        if (opts.color) this._bondState.color.copy(opts.color);
        if (state === 0) this._bondState.progress = 0.0;
        this._pushBondUniforms();
    }

    // ── API pública — Shader hot-swap (ShaderLab) ─────────────────────────────

    /**
     * Carga un shader desde JSON del ShaderLab y lo aplica en caliente.
     * @param {Object} json        — salida del ShaderLab (compiled.vert + compiled.frag)
     * @param {string} [override]  — sobreescribir el target del JSON
     */
    loadShaderJSON(json, override = null) {
        const target = override ?? json.layer ?? 'all';
        const vert   = json.compiled?.vert;
        const frag   = json.compiled?.frag;

        if (!vert || !frag) {
            console.error('[QR] JSON sin shaders compilados');
            return;
        }

        // Extraer params del pipeline como uniforms extra
        const extraUniforms = {};
        for (const stage of (json.pipeline ?? [])) {
            if (!stage.enabled) continue;
            for (const [k, v] of Object.entries(stage.params ?? {})) {
                extraUniforms[`u_${stage.key}_${k}`] = { value: v };
            }
        }

        this._customShaders.set(target, { vert, frag, extraUniforms });

        if (this._byKey.size > 0) {
            this._hotSwapShader(target, vert, frag, extraUniforms);
        }

        console.log(`[QR] Shader cargado → target='${target}'`);
    }

    /**
     * Elimina shader personalizado y vuelve al built-in.
     * @param {string} target
     */
    resetShader(target) {
        this._customShaders.delete(target);
        for (const [, e] of this._byKey) {
            const ud = e.material.userData;
            if (target !== 'all' && ud.layer !== target) continue;
            // Reconstruir material con built-in
            const newMat = this._orbitalBuilder.rebuildMat(ud.layer, e.material);
            if (newMat) {
                e.material.dispose();
                e.material = newMat;
            }
        }
    }

    // ── API pública — Tick ────────────────────────────────────────────────────

    update(t, dt = 0.016) {
        if (t == null) return;
        for (const mat of this._materials) {
            if (mat.uniforms?.uTime) mat.uniforms.uTime.value = t;
        }
        // Sin rotación arbitraria — los orbitales son estáticos por defecto.
        // La única animación es el parpadeo por aPhase en el shader (función de onda)
        // y la deformación de valencia cuando hay interacción de enlace activa.
    }

    /**
     * createAtomSphere(atom) — crea una esfera Fibonacci visual para un átomo
     * y la añade directamente a la escena. Llamar desde World.addAtom().
     * Devuelve el THREE.Points para que el átomo lo guarde como atom.sphereMesh.
     */
    async createAtomSphere(atom) {
        // Atom.init() ya cargó meta (del index) y elementData (JSON completo).
        // Usamos esos datos directamente — sin recargar nada.
        const rMaxOuter = ElementLoader.radius(atom.elementData) || 100; // pm
        // En el simulador 1wu = 1pm — la esfera usa el radio real sin normalizar.
        // Así H (31pm) se ve más pequeño que Fe (132pm) que Cs (244pm).
        const pmScale   = 1.0;
        const color     = new THREE.Color(atom._color);
        const materialName = atom.meta?.material ?? null;
        const group        = atom.meta?.group    ?? null;

        // Geometría Fibonacci — igual que _buildSphere
        const rGeom = Math.max(rMaxOuter, 1);
        const N     = this.isMobile ? 4000 : 10000;
        const pos   = new Float32Array(N * 3);
        const ph    = new Float32Array(N);
        const phi   = Math.PI * (3 - Math.sqrt(5));
        for (let i = 0; i < N; i++) {
            const y = 1 - (i / (N - 1)) * 2;
            const r = Math.sqrt(1 - y * y);
            const t = phi * i;
            pos[i*3]   = Math.cos(t) * r * rGeom;
            pos[i*3+1] = y * rGeom;
            pos[i*3+2] = Math.sin(t) * r * rGeom;
            ph[i]      = 0.5 + y * 0.5;
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('aPhase',   new THREE.BufferAttribute(ph,  1));

        const matPreset = await MaterialLibrary.getForElement(materialName, group);
        const vert      = matPreset?.vert ?? SPHERE_VERT;
        const frag      = matPreset?.frag ?? SPHERE_FRAG;

        const mat = new THREE.ShaderMaterial({
            uniforms: {
                uTime:    { value: 0 },
                uColor:   { value: color.clone() },
                uScale:   { value: this._baseScale() },
                uLodFade: { value: 1.0 },
                uPulse:   { value: 0.3 },
                uBright:  { value: this._tuning.bright },
                uEdge:    { value: this._tuning.edge },
                uSize:    { value: this._tuning.size },
                uSpeed:   { value: this._tuning.speed },
                uAmp:     { value: this._tuning.amp },
                uLevel:   { value: 0 },
                uPmScale: { value: pmScale },
                uAspect:  { value: window.innerHeight / window.innerWidth },
            },
            vertexShader:   vert,
            fragmentShader: frag,
            transparent:    true,
            blending:       THREE.AdditiveBlending,
            depthWrite:     false,
            depthTest:      false,
            toneMapped:     false,
        });

        const pts = new THREE.Points(geo, mat);
        pts.position.copy(atom.position);
        pts.userData.atomId  = atom.id;
        pts.userData.atomRef = atom;

        this._materials.push(mat); // para que uTime se actualice cada frame
        this.scene.add(pts);
        return pts;
    }

    /**
     * tick() — llamado por el loop externo (simulador) cada frame.
     * Equivale a lo que haría _startLoop internamente.
     * @param {number} t  — tiempo total en segundos
     * @param {number} dt — delta desde el frame anterior
     */
    tick(t, dt) {
        this.update(t, dt);
        this.controls?.update();
        if (this.composer) this.composer.render();
        else if (this.renderer && this.scene && this.camera)
            this.renderer.render(this.scene, this.camera);
    }

    // ── API pública — Visibilidad granular (sin cambios) ─────────────────────

    setOrbitalVisible(orbitalKey, visible) {
        const pts = this._byKey.get(orbitalKey);
        if (pts) pts.visible = visible;
    }

    setSubshellVisible(subshell, visible) {
        (this._bySubshell.get(subshell) ?? []).forEach(p => p.visible = visible);
    }

    setLayerVisible(layer, visible) {
        (this._byLayer.get(layer) ?? []).forEach(p => p.visible = visible);
    }

    /**
     * Atenúa un layer sin ocultarlo — baja uLodFade de sus materiales.
     * @param {string} layer  — 'valence' | 'semi' | 'core' | 'nucleus'
     * @param {number} alpha  — 0.0 (invisible) → 1.0 (normal)
     */
    setLayerFade(layer, alpha) {
        (this._byLayer.get(layer) ?? []).forEach(p => {
            if (p.material?.uniforms?.uLodFade)
                p.material.uniforms.uLodFade.value = alpha;
        });
    }

    /** Auto-detecta tipo de key */
    setLayerVisibleAuto(key, visible) {
        if      (this._byKey.has(key))      this.setOrbitalVisible(key, visible);
        else if (this._bySubshell.has(key)) this.setSubshellVisible(key, visible);
        else if (this._byLayer.has(key))    this.setLayerVisible(key, visible);
    }

    getOrbitalKeys()  { return [...this._byKey.keys()]; }
    getSubshellKeys() { return [...this._bySubshell.keys()]; }
    getLayerKeys()    { return [...this._byLayer.keys()]; }

    getLayerTree() {
        const tree = {};
        for (const [key, pts] of this._byKey) {
            const ud    = pts.material.userData;
            const layer = ud.layer    ?? 'unknown';
            const sub   = ud.subshell ?? key;
            if (!tree[layer])      tree[layer] = {};
            if (!tree[layer][sub]) tree[layer][sub] = [];
            tree[layer][sub].push({ key, visible: pts.visible });
        }
        return tree;
    }

    // ── API pública — Tuning (sin cambios) ───────────────────────────────────

    setTuning(param, value, target = 'all') {
        if (target === 'all') {
            this._tuning[param] = value;
        } else {
            // Guardar en perOrbital para que getTuning() lo incluya
            if (!this._tuning.perOrbital[target]) this._tuning.perOrbital[target] = {};
            this._tuning.perOrbital[target][param] = value;
        }

        let mats = [];
        if (target === 'all') {
            mats = this._materials;
        } else if (this._matByKey.has(target)) {
            mats = [this._matByKey.get(target)];
        } else {
            for (const [, pts] of this._byKey) {
                const ud = pts.material.userData;
                if (ud.subshell === target || ud.layer === target)
                    mats.push(pts.material);
            }
        }

        const UNIFORM_MAP = { edge:'uEdge', bright:'uBright', size:'uSize', speed:'uSpeed', amp:'uAmp' };
        const uName = UNIFORM_MAP[param];
        for (const mat of mats) {
            if (uName && mat.uniforms?.[uName] !== undefined)
                mat.uniforms[uName].value = value;
        }

        if (param === 'bloom'  && this.bloomPass) this.bloomPass.strength  = value;
        if (param === 'thresh' && this.bloomPass) this.bloomPass.threshold = value;
    }

    /**
     * Modo Raw — muestra el shader puro como en ShaderLab.
     * Desactiva bloom y fija uAspect a 1.0 (puntos circulares).
     * Toggle: setRawMode(true) / setRawMode(false)
     */
    setRawMode(raw) {
        this._rawMode = raw;
        if (raw) {
            // Guardar estado original
            this._savedBloom = this.bloomPass?.strength ?? 0;
            if (this.bloomPass) this.bloomPass.strength = 0;
            // Aspect 1.0 = puntos perfectamente circulares
            for (const mat of this._materials) {
                if (mat.uniforms?.uAspect) mat.uniforms.uAspect.value = 1.0;
            }
        } else {
            // Restaurar bloom
            if (this.bloomPass && this._savedBloom !== undefined) {
                this.bloomPass.strength = this._savedBloom;
            }
            // Restaurar aspect real
            const w = this.renderer?.domElement?.width  || window.innerWidth;
            const h = this.renderer?.domElement?.height || window.innerHeight;
            const aspect = h / w;
            for (const mat of this._materials) {
                if (mat.uniforms?.uAspect) mat.uniforms.uAspect.value = aspect;
            }
        }
    }

    get rawMode() { return this._rawMode ?? false; }

    /**
     * Devuelve el estado completo de tuning — globales + per-orbital + bloom.
     * Suficiente para reconstruir el estado exacto al cargar un perfil.
     */
    getTuning() {
        const { perOrbital, ...globals } = this._tuning;
        return {
            global:     { ...globals },
            perOrbital: { ...perOrbital },
        };
    }

    /**
     * Devuelve visibilidad de cada orbital y capa — para guardar en perfil.
     * { orbitals: { '3d_m+0': true, '2s_m+0': false, ... },
     *   layers:   { nucleus: true, core: false, ... } }
     */
    getLayerVisibility() {
        const orbitals = {};
        for (const [key, pts] of this._byKey)
            orbitals[key] = pts.visible;

        const layers = {};
        for (const key of this._byLayer.keys()) {
            const pts = this._byLayer.get(key);
            layers[key] = pts.length > 0 ? pts[0].visible : true;
        }
        // Núcleo
        if (this.nucleusGroup)
            layers['nucleus'] = this.nucleusGroup.visible !== false;

        return { orbitals, layers };
    }

    /**
     * Aplica un perfil completo — tuning global + per-orbital + visibilidad.
     * Llamar después de loadElement().
     * @param {Object} profile — objeto exportado por QuantumView
     */
    applyProfile(profile) {
        if (!profile) return;

        // Tuning global
        const global = profile.tuning?.global ?? {};
        for (const [k, v] of Object.entries(global)) {
            if (k !== 'perOrbital') this.setTuning(k, v, 'all');
        }

        // Tuning per-orbital
        const perOrb = profile.tuning?.perOrbital ?? {};
        for (const [target, params] of Object.entries(perOrb)) {
            for (const [k, v] of Object.entries(params))
                this.setTuning(k, v, target);
        }

        // Bloom
        if (profile.bloom) {
            this.setTuning('bloom',  profile.bloom.strength,  'all');
            this.setTuning('thresh', profile.bloom.threshold, 'all');
        }

        // Visibilidad de orbitales
        const orbVis = profile.layers?.orbitals ?? {};
        for (const [key, visible] of Object.entries(orbVis))
            this.setOrbitalVisible(key, visible);

        // Visibilidad de capas
        const layVis = profile.layers?.layers ?? {};
        for (const [key, visible] of Object.entries(layVis)) {
            if (key === 'nucleus') this.nucleusGroup && (this.nucleusGroup.visible = visible);
            else this.setLayerVisible(key, visible);
        }

        console.log(`[QR] Perfil aplicado: ${profile.element ?? '?'}`);
    }

    clear() {
        // Restaurar visibilidad del mesh del átomo si LOD lo había ocultado
        this.currentSymbol = null;
        this._clearOrbitals();
    }

    dispose() {
        this._clearOrbitals();
        this.composer?.dispose();
        {
            this.renderer?.dispose();
            window.removeEventListener('resize', this._onResize);
        }
    }

    // ── Three.js setup (sin cambios) ──────────────────────────────────────────

    _buildRenderer() {
        this.renderer = new THREE.WebGLRenderer({ antialias: !this.isMobile });
        // Usar tamaño del container si está definido y es más pequeño que la ventana
        const w = (this.container?.clientWidth  > 0) ? this.container.clientWidth  : window.innerWidth;
        const h = (this.container?.clientHeight > 0) ? this.container.clientHeight : window.innerHeight;
        this.renderer.setSize(w, h);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled   = true;
        this.renderer.shadowMap.type      = THREE.PCFShadowMap;
        this.renderer.toneMapping         = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.1;
        this.container.appendChild(this.renderer.domElement);
    }

    _buildScene() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(this._backgroundColor);
        this._attachGroups();
    }

    _attachGroups() {
        this.nucleusGroup = new THREE.Group();
        this.sphereGroup  = new THREE.Group();
        this.shellsGroup  = new THREE.Group();
        this.scene.add(this.nucleusGroup, this.sphereGroup, this.shellsGroup);
    }

    _buildCamera() {
        const w = this.renderer?.domElement?.width  || window.innerWidth;
        const h = this.renderer?.domElement?.height || window.innerHeight;
        this.camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 5000);
        this.camera.position.set(350, 350, 350);
    }

    /**
     * Ajusta la cámara para que el elemento llene bien la vista.
     * @param {number} rWU — radio del elemento en world units
     */
    _fitCamera(rWU) {
        if (!this.camera || !this.controls || rWU <= 0) return;
        // Distancia para que el elemento ocupe ~60% del FOV
        const fovRad  = this.camera.fov * Math.PI / 180;
        const dist    = (rWU / Math.tan(fovRad / 2)) * 1.8;
        const clamped = Math.max(60, Math.min(1200, dist));
        // Posición diagonal igual que la inicial
        const d = clamped / Math.sqrt(3);
        this.camera.position.set(d, d, d);
        this.controls.target.set(0, 0, 0);
        this.controls.update();
        console.log(`[QR] Cámara fit: rWU=${rWU.toFixed(0)} → dist=${clamped.toFixed(0)}`);
    }

    _buildControls() {
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping  = true;
        this.controls.dampingFactor  = 0.08;
        this.controls.enablePan      = this._enablePan;
        // Modo libre: target fijo en el centro del espacio de trabajo
        // Al seleccionar un átomo app.js mueve el target al átomo
        this.controls.screenSpacePanning = false;
        this.controls.minDistance  = 5;    // permite inmersión nuclear
        this.controls.maxDistance  = 8000;
    }

    _buildBloom() {
        const factor   = this.isMobile ? 0.04 : 0.03;
        const strength = 1.1 * factor * 2;
        this.bloomPass = new UnrealBloomPass(BLOOM_RES, strength, 0.6, this._tuning.thresh);
        this._tuning.bloom = strength;
        this.composer = new EffectComposer(this.renderer);
        this.composer.addPass(new RenderPass(this.scene, this.camera));
        this.composer.addPass(this.bloomPass);
    }

    _startLoop() {
        const t0  = performance.now();
        let   tPrev = t0;
        this._loopActive = true;   // flag para pausar/reanudar sin cancelar el rAF

        const tick  = () => {
            requestAnimationFrame(tick);
            if (!this._loopActive) return;   // pausado — saltar render pero mantener el rAF vivo
            const now = performance.now();
            const t   = (now - t0)    * 0.001;
            const dt  = (now - tPrev) * 0.001;
            tPrev = now;
            this.update(t, dt);
            if (!this._eagerLoad) {
                const dist = this.camera.position.length();
                this.updateLOD(dist, dt);
            }
            this.controls.update();
            this.composer.render();
        };
        tick();
    }

    /** Pausar el loop interno — cero GPU mientras el panel está oculto */
    pauseLoop()  { this._loopActive = false; }

    /** Reanudar el loop interno */
    resumeLoop() { this._loopActive = true;  }

    /**
     * Distancia de la cámara al target de los controles (en wu).
     * Úsalo en app.js para pasar al sistema LOD.
     */
    get distToTarget() {
        if (!this.camera || !this.controls) return 9999;
        return this.camera.position.distanceTo(this.controls.target);
    }

    _handleResize() {
        if (!this.camera || !this.renderer) return;
        // Usar tamaño del container si es un elemento con dimensiones propias
        // Si el container es document.body o no tiene clientWidth, usar window
        const isEmbedded = this.container && this.container !== document.body
                        && this.container.clientWidth > 0;
        const w = isEmbedded ? this.container.clientWidth  : window.innerWidth;
        const h = isEmbedded ? this.container.clientHeight : window.innerHeight;
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(w, h);
        this.composer?.setSize(w, h);
        const aspect = h / w;
        for (const mat of this._materials) {
            if (mat.uniforms?.uAspect) mat.uniforms.uAspect.value = aspect;
        }
    }

    _baseScale() {
        const factor = this.isMobile ? 0.04 : 0.03;
        return 3000 * this._dpr * factor;
    }

    // ── Esfera Fibonacci (LOD far) ────────────────────────────────────────────

    async _buildSphere(radiusPm, pmScale, color, materialName = null, group = null) {
        // Limpiar esfera anterior
        while (this.sphereGroup.children.length) {
            const c = this.sphereGroup.children[0];
            c.geometry?.dispose(); c.material?.dispose();
            this.sphereGroup.remove(c);
        }

        // Esfera Fibonacci — posiciones en PM, igual que los orbitales bakeados.
        // Shaders ShaderLab hacen wpos = position * uPmScale → WU correcto.
        // SPHERE_VERT fallback también recibe uPmScale y lo aplica.
        const rGeom = Math.max(radiusPm, 1);
        const N     = this.isMobile ? 4000 : 10000;
        const pos   = new Float32Array(N * 3);
        const ph    = new Float32Array(N);
        const phi   = Math.PI * (3 - Math.sqrt(5)); // ángulo dorado

        for (let i = 0; i < N; i++) {
            const y     = 1 - (i / (N - 1)) * 2;
            const r     = Math.sqrt(1 - y * y);
            const theta = phi * i;
            pos[i*3]   = Math.cos(theta) * r * rGeom;
            pos[i*3+1] = y * rGeom;
            pos[i*3+2] = Math.sin(theta) * r * rGeom;
            ph[i]      = 0.5 + y * 0.5;
        }

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('aPhase',   new THREE.BufferAttribute(ph,  1));

        // Material: específico del elemento → fallback por grupo → SPHERE_VERT/FRAG
        const matPreset = await MaterialLibrary.getForElement(materialName, group);
        const vert      = matPreset?.vert ?? SPHERE_VERT;
        const frag      = matPreset?.frag ?? SPHERE_FRAG;
        if (matPreset) console.log(`[QR] Material esfera: ${matPreset.meta?.displayName ?? materialName}`);

        const mat = new THREE.ShaderMaterial({
            uniforms: {
                uTime:    { value: 0 },
                uColor:   { value: color.clone() },
                uScale:   { value: this._baseScale() },
                uLodFade: { value: 1.0 },
                uPulse:   { value: 0.3 },
                // Uniforms completos para compatibilidad con shaders ShaderLab
                uBright:  { value: this._tuning.bright },
                uEdge:    { value: this._tuning.edge },
                uSize:    { value: this._tuning.size },
                uSpeed:   { value: this._tuning.speed },
                uAmp:     { value: this._tuning.amp },
                uLevel:   { value: 0 },
                // pmScale unificado con orbitales — mismo espacio visual
                uPmScale: { value: pmScale },
                uAspect:  { value: window.innerHeight / window.innerWidth },
            },
            vertexShader:   vert,
            fragmentShader: frag,
            transparent:    true,
            blending:       THREE.AdditiveBlending,
            depthWrite:     false,
            depthTest:      false,
        });

        const pts = new THREE.Points(geo, mat);
        this.sphereGroup.add(pts);
        this._materials.push(mat);
    }

    // ── LOD — internos ────────────────────────────────────────────────────────

    async _ensureLayer(layer) {
        if (this._loadedLayers.has(layer)) return;
        this._loadedLayers.add(layer);
        const orbs = this._orbMeta.orbitals.filter(o => o.layer === layer);
        if (!orbs.length) return;
        const maps = await this._orbitalBuilder.loadBaked(
            this.currentSymbol, { orbitals: orbs },
            this._baseScale(), this.shellsGroup
        );
        this._mergeMaps(maps);
    }

    _applyFades() {
        // Esfera — respeta el flag de visibilidad del usuario
        const sphereFade = this._sphereVisible ? this._lodFade : 0.0;
        this.sphereGroup?.children.forEach(p => {
            if (p.material?.uniforms?.uLodFade)
                p.material.uniforms.uLodFade.value = sphereFade;
        });
        // Orbitales
        for (const [, pts] of this._byKey) {
            if (pts.material?.uniforms?.uLodFade)
                pts.material.uniforms.uLodFade.value = this._orbitFade;
        }
    }

    _setOrbitalsVisible(visible) {
        for (const [, pts] of this._byKey) pts.visible = visible;
    }

    // ── LOD Nuclear — Darkshell + fades ───────────────────────────────────────

    /**
     * Construye la esfera opaca que envuelve al átomo en modo nuclear.
     * BackSide rendering — la cámara está dentro.
     */
    _buildDarkshell(radiusWU) {
        if (this._darkshellMesh) {
            this._darkshellMesh.geometry.dispose();
            this._darkshellMesh.material.dispose();
            this._darkshellMesh.parent?.remove(this._darkshellMesh);
            this._darkshellMesh = null;
        }

        const geo = new THREE.SphereGeometry(radiusWU * 1.2, 32, 24);
        const mat = new THREE.ShaderMaterial({
            uniforms: {
                uDarkFade:  { value: 0.0 },
                uTintColor: { value: new THREE.Color(0x112233) },
                uCameraPos: { value: new THREE.Vector3() },
            },
            vertexShader:   DARKSHELL_VERT,
            fragmentShader: DARKSHELL_FRAG,
            transparent:    true,
            side:           THREE.BackSide,
            depthWrite:     false,
            depthTest:      true,
        });

        this._darkshellMesh = new THREE.Mesh(geo, mat);
        this._darkshellMesh.visible = false;
        this._darkshellMesh.renderOrder = 5;
        this.nucleusGroup.add(this._darkshellMesh);
    }

    /**
     * Aplica fades del modo nuclear: estrobo, darkshell, volumen, points.
     * Llamado cada frame desde updateLOD().
     */
    _applyNuclearFades() {
        // ── uNuclearFade: propagar a todos los materiales orbitales ──
        // Cuando vale 1.0, los orbitales se apagan (effectiveFade = 0)
        // dejando el protagonismo al raymarching del núcleo
        for (const [, pts] of this._byKey) {
            if (pts.material?.uniforms?.uNuclearFade !== undefined) {
                pts.material.uniforms.uNuclearFade.value = this._nuclearFade;
            }
        }

        // ── Darkshell ──
        if (this._darkshellMesh) {
            this._darkshellMesh.visible = this._darkshellFade > 0.01;
            if (this._darkshellMesh.material?.uniforms?.uDarkFade) {
                this._darkshellMesh.material.uniforms.uDarkFade.value = this._darkshellFade;
            }
        }

        // ── Volumen nuclear ──
        this._nucleusBuilder.setNuclearFade(this._nuclearFade);

        // ── Points del núcleo: ocultar solo cuando el volumen está casi completo ──
        const hidePoints = this._nuclearFade > this._hidePointsThreshold;
        this.nucleusGroup?.children.forEach(c => {
            if (c.isPoints) c.visible = !hidePoints;
        });
    }

    _lerp(a, b, t) { return a + (b - a) * Math.min(t, 1.0); }

    // ── Bond states — internos ────────────────────────────────────────────────

    _tickBondAnimation(dt) {
        const bs = this._bondState;
        if (bs.state === 0) return;
        if (bs.progress < 1.0)
            bs.progress = Math.min(1.0, bs.progress + dt * 2.0);
        if (bs.state === 3)
            bs.exchangePhase = (bs.exchangePhase + dt * 0.8) % 1.0;
        this._pushBondUniforms();
    }

    _pushBondUniforms() {
        const bs = this._bondState;
        for (const [, pts] of this._byKey) {
            const ud = pts.material.userData;
            if (ud.layer !== 'valence') continue;
            const u = pts.material.uniforms;
            if (!u) continue;
            if (u.uBondState)     u.uBondState.value     = bs.state;
            if (u.uBondProgress)  u.uBondProgress.value  = bs.progress;
            if (u.uBondStrength)  u.uBondStrength.value  = bs.strength;
            if (u.uBondDir)       u.uBondDir.value.copy(bs.dir);
            if (u.uBondColor)     u.uBondColor.value.copy(bs.color);
            if (u.uExchangePhase) u.uExchangePhase.value = bs.exchangePhase;
        }
    }

    // ── Shader hot-swap — internos ────────────────────────────────────────────

    /** Garantiza que uLodFade esté declarado y aplicado en el shader compilado */
    _patchLodFade(vert, frag) {
        // Inyectar uniform en vert si falta
        if (!vert.includes('uLodFade')) {
            vert = vert.replace(
                'void main(){',
                'uniform float uLodFade;\nvoid main(){'
            );
            // Aplicar al gl_PointSize justo antes del cierre del main
            vert = vert.replace(
                'gl_Position=projectionMatrix*mvP;',
                'gl_PointSize*=uLodFade;\ngl_Position=projectionMatrix*mvP;'
            );
        }
        // Inyectar uniform en frag si falta y multiplicar alpha final
        if (!frag.includes('uLodFade')) {
            frag = frag.replace(
                'void main(){',
                'uniform float uLodFade;\nvoid main(){'
            );
            frag = frag.replace(
                'gl_FragColor=vec4(col,clamp(alpha,0.0,1.0));',
                'gl_FragColor=vec4(col,clamp(alpha,0.0,1.0)*uLodFade);'
            );
        }
        return { vert, frag };
    }

    _hotSwapShader(target, vert, frag, extraUniforms) {
        // Garantizar uLodFade en shaders compilados externos (ShaderLab no lo inyecta)
        ({ vert, frag } = this._patchLodFade(vert, frag));

        // ── Esfera: vive en sphereGroup, no en _byKey ─────────────────────────
        if (target === 'sphere' || target === 'all') {
            this.sphereGroup?.children.forEach(pts => {
                const oldMat = pts.material;
                // Uniforms completos que los shaders de ShaderLab esperan
                const baseUniforms = {
                    uTime:    oldMat.uniforms?.uTime    ?? { value: 0 },
                    uColor:   oldMat.uniforms?.uColor   ?? { value: new THREE.Color(0xffffff) },
                    uScale:   oldMat.uniforms?.uScale   ?? { value: this._baseScale() },
                    uLodFade: oldMat.uniforms?.uLodFade ?? { value: 1.0 },
                    uBright:  oldMat.uniforms?.uBright  ?? { value: this._tuning.bright },
                    uEdge:    oldMat.uniforms?.uEdge    ?? { value: this._tuning.edge },
                    uSize:    oldMat.uniforms?.uSize    ?? { value: this._tuning.size },
                    uSpeed:   oldMat.uniforms?.uSpeed   ?? { value: this._tuning.speed },
                    uAmp:     oldMat.uniforms?.uAmp     ?? { value: this._tuning.amp },
                    uLevel:   oldMat.uniforms?.uLevel   ?? { value: 0 },
                    uPmScale: oldMat.uniforms?.uPmScale ?? { value: 1.0 }, // esfera ya en WU
                };
                const newMat = new THREE.ShaderMaterial({
                    uniforms:       { ...baseUniforms, ...extraUniforms },
                    vertexShader:   vert,
                    fragmentShader: frag,
                    transparent:    true,
                    blending:       THREE.AdditiveBlending,
                    depthWrite:     false,
                });
                newMat.userData = { ...oldMat.userData, isSphere: true };
                oldMat.dispose();
                pts.material = newMat;
            });
            if (target === 'sphere') {
                this._rebuildMaterialsList();
                console.log(`[QR] Hot-swap → target='sphere'`);
                return;
            }
        }

        // ── Orbitales: en _byKey ──────────────────────────────────────────────
        for (const [, pts] of this._byKey) {
            const ud = pts.material.userData;
            if (target !== 'all' && ud.layer !== target) continue;
            const oldMat = pts.material;
            const newMat = new THREE.ShaderMaterial({
                uniforms:       { ...oldMat.uniforms, ...extraUniforms },
                vertexShader:   vert,
                fragmentShader: frag,
                transparent:    true,
                blending:       THREE.AdditiveBlending,
                depthWrite:     false,
            });
            newMat.userData = { ...ud };
            oldMat.dispose();
            pts.material = newMat;
            this._matByKey.set(ud.orbKey, newMat);
        }
        // Reconstruir lista plana de materiales
        this._rebuildMaterialsList();
        console.log(`[QR] Hot-swap → target='${target}'`);
    }

    _rebuildMaterialsList() {
        this._materials = [
            ...this.sphereGroup.children.map(p => p.material),
            ...this.nucleusGroup.children.map(p => p.material),
            ...[...this._byKey.values()].map(p => p.material),
        ].filter(Boolean);
    }

    // ── Internos — índices ────────────────────────────────────────────────────

    _mergeMaps({ byKey, bySubshell, byLayer, matByKey }) {
        for (const [k, v] of byKey)      this._byKey.set(k, v);
        for (const [k, v] of bySubshell) this._bySubshell.set(k, v);
        for (const [k, v] of byLayer)    this._byLayer.set(k, v);
        for (const [k, v] of matByKey)   this._matByKey.set(k, v);
    }

    // ── Internos — UI ─────────────────────────────────────────────────────────

    _updateInfoUI(symbol, meta, orbMeta) {
        const identity = meta.identity ?? {};
        const nameEl   = document.getElementById('el-name');
        const symEl    = document.getElementById('el-symbol');
        if (!nameEl || !symEl) return;
        const hex = parseInt(String(identity.color ?? '0xaaaaaa').replace('0x',''), 16);
        nameEl.textContent = (getLanguage() === 'en'
            ? (identity.name_eng ?? identity.name_es ?? symbol)
            : (identity.name_es  ?? symbol)).toUpperCase();
        nameEl.style.color = `#${hex.toString(16).padStart(6,'0')}`;
        const decay = orbMeta?.decay_chain?.[0];
        const z     = identity.number ?? '?';
        symEl.textContent  = decay
            ? `${symbol} · Z:${z} · t½: ${decay.half_life_human} → ${decay.daughter}`
            : `${symbol} · Z:${z}`;
    }

    // ── Internos — Limpieza ───────────────────────────────────────────────────

    _clearOrbitals() {
        this._loadedLayers.clear();
        this._lodFade    = 1.0;
        this._orbitFade  = 0.0;
        this._lodState   = 'far';
        // currentSymbol NO se resetea aquí — loadElement lo asigna antes de llamarnos
        [this.nucleusGroup, this.sphereGroup, this.shellsGroup].forEach(group => {
            if (!group) return;
            while (group.children.length > 0) {
                const c = group.children[0];
                c.geometry?.dispose();
                c.material?.dispose();
                group.remove(c);
            }
        });
        this._materials  = [];
        this._byKey      = new Map();
        this._bySubshell = new Map();
        this._byLayer    = new Map();
        this._matByKey   = new Map();

        // Reset LOD
        this._lodState     = 'far';
        this._lodFade      = 1.0;
        this._orbitFade    = 0.0;
        this._sphereVisible = true;  // controlado por el usuario via checkbox
        this._loadedLayers = new Set();
        this._meta         = null;
        this._orbMeta      = null;

        // Reset LOD Nuclear
        this._darkshellFade   = 0.0;
        this._nuclearFade     = 0.0;
        this._strobeBlend     = 0.0;
        this._nuclearVolBuilt = false;
        if (this._darkshellMesh) {
            this._darkshellMesh.geometry?.dispose();
            this._darkshellMesh.material?.dispose();
            this._darkshellMesh.parent?.remove(this._darkshellMesh);
            this._darkshellMesh = null;
        }

        // Reconstruir builders con referencia limpia
        this._nucleusBuilder = new NucleusBuilder(this.isMobile, this._materials);
        this._orbitalBuilder = new OrbitalBuilder(this.isMobile, this._materials, this._tuning);
    }
}

