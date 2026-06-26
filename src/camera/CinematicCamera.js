/**
 * CinematicCamera.js — Cámara cinematográfica para QuantumSim
 *
 * Modos:
 *   'free'  — OrbitControls libre, el usuario navega el workspace
 *   'focus' — Orbita suavemente alrededor de un átomo/punto de interés
 *
 * Features:
 *   - Transiciones suaves (easing) entre modos y targets
 *   - Feed de distancia al QuantumRenderer para LOD
 *   - Zoom adaptativo según el tamaño del átomo
 *   - Shake sutil opcional en modo simulación
 *   - API limpia: focus(target), free(), setMode('design'|'sim')
 *
 * Uso:
 *   const cam = new CinematicCamera(camera, renderer, { onDistUpdate });
 *   cam.init();
 *
 *   cam.focus(atom.mesh.position, { radius: atom.radius });
 *   cam.free();
 *
 *   // En el animation loop:
 *   cam.update(dt);
 */

import * as THREE        from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ── Constantes ──────────────────────────────────────────────────────────────

// Duración de la transición libre ↔ foco (segundos)
const TRANSITION_DURATION = 0.75;

// Easing — suavizado cuártico
const ease = t => t < 0.5
    ? 8 * t * t * t * t
    : 1 - Math.pow(-2 * t + 2, 4) / 2;

// Distancia de foco por defecto (world units) — escala simulador (átomos ~0.5–2wu)
const DEFAULT_FOCUS_DIST = 6;

// Rango libre: el usuario puede orbitar el workspace
const FREE_MIN_DIST  = 0.001;
const FREE_MAX_DIST  = 500;

// Rango foco: orbitamos el átomo seleccionado
// LOD_IN activa a ~2.5wu, queremos poder llegar ahí
const FOCUS_MIN_DIST = 0.001;
const FOCUS_MAX_DIST = 30;

// Velocidad de rotación auto en modo foco (rad/s)
const AUTO_ORBIT_SPEED = 0.04;

// Shake — amplitud máxima en modo simulación (wu)
const SHAKE_MAX_AMP = 0.015;

// LOD thresholds (world units) — deben coincidir con los del app.js
const LOD_IN_DIST  = 2.5;   // activa orbitales cuánticos
const LOD_OUT_DIST = 4.0;   // vuelve a esfera

// ── CinematicCamera ─────────────────────────────────────────────────────────

export class CinematicCamera {

    /**
     * @param {THREE.PerspectiveCamera} camera
     * @param {THREE.WebGLRenderer}     renderer
     * @param {Object} opts
     * @param {Function} [opts.onDistUpdate]  — callback(distWU) cada frame en modo foco
     * @param {boolean}  [opts.autoOrbit]     — rotar automáticamente en modo foco
     */
    constructor(camera, renderer, opts = {}) {
        this.camera   = camera;
        this.renderer = renderer;

        this._onDistUpdate = opts.onDistUpdate ?? null;
        this._autoOrbit    = opts.autoOrbit    ?? true;

        // OrbitControls
        this.controls = null;

        // Estado
        this._mode        = 'free';   // 'free' | 'focus'
        this._simMode     = 'design'; // 'design' | 'sim'

        // Target actual y anterior para interpolación
        this._focusTarget    = new THREE.Vector3();
        this._focusTargetRef = null;  // THREE.Object3D o Vector3 vivo — se sigue cada frame

        // Transición
        this._transitioning  = false;
        this._transitionT    = 0;
        this._transFrom      = { pos: new THREE.Vector3(), target: new THREE.Vector3() };
        this._transTo        = { pos: new THREE.Vector3(), target: new THREE.Vector3() };

        // Auto-orbita
        this._orbitAngle  = 0;
        this._orbitRadius = DEFAULT_FOCUS_DIST;
        this._orbitY      = 0;

        // Shake
        this._shakeAmp    = 0;
        this._shakeTime   = 0;
        this._shakeVec    = new THREE.Vector3();

        // Último frame de distancia reportada
        this._lastDist    = 0;

        console.log('[CinematicCamera] Instancia creada 🎬');
    }

    // ── Init ────────────────────────────────────────────────────────────────

    init() {
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping      = true;
        this.controls.dampingFactor      = 0.05;
        this.controls.screenSpacePanning = true;
        this.controls.minDistance        = FREE_MIN_DIST;
        this.controls.maxDistance        = FREE_MAX_DIST;
        this.controls.target.set(0, 0, 0);

        // Posición inicial cinematográfica — ligeramente elevada, alejada
        this.camera.position.set(0, 8, 20);
        this.camera.lookAt(0, 0, 0);

        console.log('[CinematicCamera] Inicializada ✅');
        return this;
    }

    // ── API pública ─────────────────────────────────────────────────────────

    /**
     * Enfocar un objeto o posición.
     * @param {THREE.Vector3|THREE.Object3D} target — qué mirar
     * @param {Object} opts
     * @param {number} [opts.radius]    — radio del objeto para calcular distancia
     * @param {number} [opts.distScale] — multiplicador de distancia (default 1)
     */
    focus(target, opts = {}) {
        const pos = target.isVector3 ? target : (target.position ?? new THREE.Vector3());

        // Guardar ref viva si es Object3D (para seguirlo si se mueve)
        this._focusTargetRef = target.isVector3 ? null : target;
        this._focusTarget.copy(pos);

        // Calcular distancia óptima basada en el radio del objeto
        // Para átomos del simulador el radio está en wu (0.15–2wu)
        const radius = opts.radius ?? 0.5;
        this._orbitRadius = Math.max(
            FOCUS_MIN_DIST,
            Math.min(radius * 5 + DEFAULT_FOCUS_DIST * 0.9, FOCUS_MAX_DIST)
        ) * (opts.distScale ?? 1);

        // Preservar ángulo Y actual de la cámara para que la transición sea natural
        const camDir = new THREE.Vector3()
            .subVectors(this.camera.position, this.controls.target)
            .normalize();
        this._orbitAngle = Math.atan2(camDir.x, camDir.z);
        this._orbitY     = pos.y + this._orbitRadius * 0.25;

        this.controls.minDistance = FOCUS_MIN_DIST;
        this.controls.maxDistance = FOCUS_MAX_DIST;
        this._startTransition('focus');
        console.log(`[CinematicCamera] 🔭 Foco en ${pos.toArray().map(v=>v.toFixed(1))} | r=${this._orbitRadius.toFixed(0)}wu`);
    }

    /**
     * Volver a modo libre — el usuario controla la cámara.
     */
    free() {
        if (this._mode === 'free' && !this._transitioning) return;
        this._focusTargetRef = null;
        this._startTransition('free');
        console.log('[CinematicCamera] 🕊️ Modo libre');
    }

    /**
     * Cambiar entre modo diseño y simulación.
     * Diseño: controles libres habilitados, sin shake.
     * Sim:    controles más restringidos, shake sutil si hay acción.
     * @param {'design'|'sim'} mode
     */
    setSimMode(mode) {
        this._simMode = mode;
        if (mode === 'design') {
            this._shakeAmp = 0;
            this.controls.enabled = true;
        } else {
            // En sim, los controles siguen activos pero el auto-orbit toma el relevo
            // cuando hay un foco activo
        }
        console.log(`[CinematicCamera] Modo simulador: ${mode}`);
    }

    /**
     * Activar shake de cámara (para eventos de colisión, etc.)
     * @param {number} intensity — 0..1
     * @param {number} duration  — segundos
     */
    shake(intensity = 0.5, duration = 0.4) {
        this._shakeAmp  = SHAKE_MAX_AMP * intensity;
        this._shakeTime = duration;
    }

    /**
     * Actualizar cada frame — llamar desde el animation loop.
     * @param {number} dt — delta time en segundos
     */
    update(dt) {
        // Actualizar target si es un objeto vivo que se mueve
        if (this._focusTargetRef?.position) {
            this._focusTarget.copy(this._focusTargetRef.position);
        }

        if (this._transitioning) {
            this._updateTransition(dt);
        } else if (this._mode === 'focus') {
            this._updateFocus(dt);
        } else {
            this.controls.update();
        }

        // Shake
        this._updateShake(dt);

        // Reportar distancia al QuantumRenderer para LOD — cada frame
        if (this._mode === 'focus' || this._transitioning) {
            const dist = this.camera.position.distanceTo(this._focusTarget);
            this._lastDist = dist;
            this._onDistUpdate?.(dist);
        } else {
            this._lastDist = Infinity;
        }
    }

    // ── Getters ─────────────────────────────────────────────────────────────

    get mode()          { return this._mode; }
    get distToFocus()   { return this._lastDist; }
    get isInsideLOD()   { return this._lastDist < LOD_IN_DIST && this._mode === 'focus'; }
    get lodInDist()     { return LOD_IN_DIST; }
    get lodOutDist()    { return LOD_OUT_DIST; }

    /** Qué tan dentro del LOD estamos — 0=afuera 1=completamente dentro */
    get lodAlpha() {
        if (this._mode !== 'focus') return 0;
        const d = this._lastDist;
        // Fade zone: LOD_OUT_DIST → LOD_IN_DIST
        return 1 - Math.max(0, Math.min(1, (d - LOD_IN_DIST) / (LOD_OUT_DIST - LOD_IN_DIST)));
    }

    // ── Privado — Transición ────────────────────────────────────────────────

    _startTransition(toMode) {
        this._transFrom.pos.copy(this.camera.position);
        this._transFrom.target.copy(this.controls.target);

        if (toMode === 'focus') {
            // Calcular posición destino en la órbita
            const dest = this._orbitPos(this._orbitAngle);
            this._transTo.pos.copy(dest);
            this._transTo.target.copy(this._focusTarget);
        } else {
            // Volver al modo libre — retroceder un poco y apuntar al origen
            const dir = new THREE.Vector3()
                .subVectors(this.camera.position, this._focusTarget)
                .normalize();
            this._transTo.pos.copy(this.camera.position).addScaledVector(dir, 4);
            this._transTo.target.set(0, 0, 0);
        }

        this._transitioning  = true;
        this._transitionT    = 0;
        this._toMode         = toMode;

        // Deshabilitar controles durante la transición (solo en sim)
        if (this._simMode === 'sim') {
            this.controls.enabled = false;
        }
    }

    _updateTransition(dt) {
        this._transitionT += dt / TRANSITION_DURATION;

        if (this._transitionT >= 1) {
            this._transitionT   = 1;
            this._transitioning = false;
            this._mode          = this._toMode;

            this.controls.enabled = true;
            if (this._mode === 'free') {
                this.controls.target.copy(this._transTo.target);
                this.controls.minDistance = FREE_MIN_DIST;
                this.controls.maxDistance = FREE_MAX_DIST;
            } else {
                // foco — mantener límites cercanos
                this.controls.minDistance = FOCUS_MIN_DIST;
                this.controls.maxDistance = FOCUS_MAX_DIST;
            }
        }

        const t = ease(Math.min(this._transitionT, 1));

        // Interpolar posición y target
        this.camera.position.lerpVectors(this._transFrom.pos, this._transTo.pos, t);
        const lookAt = new THREE.Vector3().lerpVectors(this._transFrom.target, this._transTo.target, t);
        this.camera.lookAt(lookAt);
        this.controls.target.copy(lookAt);
    }

    // ── Privado — Modo foco ─────────────────────────────────────────────────

    _updateFocus(dt) {
        if (this._simMode === 'design') {
            // Modo diseño: OrbitControls tiene el control total.
            // Solo mantenemos el target en el átomo para que el usuario
            // pueda orbitar a su alrededor libremente.
            this.controls.target.lerp(this._focusTarget, 12 * dt);
            this.controls.update();
            return;
        }

        // Modo sim: auto-orbita cinematográfica
        if (this._autoOrbit) {
            this._orbitAngle += AUTO_ORBIT_SPEED * dt;
        }
        const targetPos = this._orbitPos(this._orbitAngle);
        this.camera.position.lerp(targetPos, 6 * dt);
        this.controls.target.lerp(this._focusTarget, 10 * dt);
        this.camera.lookAt(this.controls.target);
    }

    _orbitPos(angle) {
        return new THREE.Vector3(
            this._focusTarget.x + Math.sin(angle) * this._orbitRadius,
            this._orbitY,
            this._focusTarget.z + Math.cos(angle) * this._orbitRadius,
        );
    }

    // ── Privado — Shake ─────────────────────────────────────────────────────

    _updateShake(dt) {
        if (this._shakeTime <= 0) {
            this._shakeVec.set(0, 0, 0);
            return;
        }
        this._shakeTime -= dt;
        const decay = Math.max(this._shakeTime, 0);
        const amp   = this._shakeAmp * decay;
        this._shakeVec.set(
            (Math.random() - 0.5) * amp,
            (Math.random() - 0.5) * amp,
            0
        );
        this.camera.position.add(this._shakeVec);
    }

    // ── Dispose ─────────────────────────────────────────────────────────────

    dispose() {
        this.controls?.dispose();
    }
}
