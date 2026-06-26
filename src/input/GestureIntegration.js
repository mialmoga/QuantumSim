/**
 * GestureIntegration.js — Conecta GestureController con QuantumSim
 * ==================================================================
 * Este módulo traduce eventos de gesto en acciones del simulador:
 *   pinch → agarrar/mover átomo en plano de cámara + eje Z por profundidad
 *   point → rotar cámara (OrbitControls)
 *   open  → soltar átomo suavemente
 *
 * Se activa/desactiva desde el ⚙️ de configuración.
 * Cuando está inactivo, no hay costo de CPU ni acceso a webcam.
 *
 * Uso en app.js:
 *   import { GestureIntegration } from './src/input/GestureIntegration.js';
 *   const gesture = new GestureIntegration(qr, world, state);
 *   // Toggle desde UI:
 *   gesture.toggle();
 */

import * as THREE from 'three';
import { GestureController } from './GestureController.js';
import { GestureOverlay }    from './GestureOverlay.js';

export class GestureIntegration {

    /**
     * @param {QuantumRenderer} qr     — renderer principal
     * @param {World}           world  — mundo de átomos
     * @param {Object}          state  — estado compartido de app.js (focusedAtom, etc)
     */
    constructor(qr, world, state) {
        this._qr     = qr;
        this._world  = world;
        this._state  = state;

        // Elementos DOM (se crean lazy al primer toggle)
        this._video   = null;
        this._canvas  = null;

        // Módulos
        this._ctrl    = null;
        this._overlay = null;

        // Estado de drag gestual
        this._dragged   = null;
        this._dragPlane = new THREE.Plane();
        this._dragHit   = new THREE.Vector3();
        this._dragOff   = new THREE.Vector3();
        this._baseDepth = 0;  // profundidad Z al inicio del pinch

        // Estado de rotación por point
        this._pointPrev = null;

        // Estado de pan por peace ✌️
        this._peacePrev = null;

        // Deltas suavizados para rotación y pan (anti-jitter)
        this._smoothDelta = { x: 0, y: 0 };
        this._smoothDeltaPan = { x: 0, y: 0 };
        this._deltaSmooth = 0.3;  // 0 = sin suavizado, 1 = congelado

        // Raycaster para pick gestual
        this._raycaster = new THREE.Raycaster();

        this._active = false;
    }

    // ── API pública ──────────────────────────────────────────────────────

    /**
     * Toggle on/off. Crea elementos DOM la primera vez.
     */
    async toggle() {
        if (this._active) {
            this.stop();
        } else {
            await this.start();
        }
        return this._active;
    }

    async start() {
        if (this._active) return;

        // Crear elementos DOM lazy
        if (!this._video) this._createDOM();

        this._ctrl    = new GestureController(this._video);
        this._overlay = new GestureOverlay(this._canvas);

        // Suscribir eventos
        this._ctrl.addEventListener('gesture', e => {
            this._canvas.style.opacity = '1';
            this._onGesture(e.detail);
        });
        this._ctrl.addEventListener('lost', () => {
            this._canvas.style.opacity = '0';
            this._onLost();
        });

        await this._ctrl.start();
        this._overlay.showTutorial();
        this._active = true;

        window.addEventListener('resize', this._onResize);
        console.log('[Gesture] ✅ Activo');
    }

    stop() {
        if (!this._active) return;
        this._ctrl?.stop();
        this._overlay?.clear();
        this._release();
        this._active = false;
        this._pointPrev = null;

        window.removeEventListener('resize', this._onResize);
        console.log('[Gesture] ⏹ Detenido');
    }

    get isActive() { return this._active; }

    // ── Eventos ──────────────────────────────────────────────────────────

    /** @private */
    _onGesture({ type, smoothed, depth }) {
        const lm = smoothed;

        // Coordenadas del índice (espejado horizontal)
        const nx = 1 - lm[8].x;
        const ny = lm[8].y;

        // Dibujar overlay — coordenadas naturales de MediaPipe
        this._overlay.draw(lm, type);
        this._overlay.drawTutorial();

        // Despachar por gesto
        switch (type) {
            case 'pinch':
                this._handlePinch(nx, ny, depth);
                this._pointPrev = null;
                this._peacePrev = null;
                break;

            case 'point':
                this._handlePoint(nx, ny);
                this._peacePrev = null;
                break;

            case 'peace':
                this._handlePeace(nx, ny);
                this._pointPrev = null;
                break;

            case 'open':
                this._handleOpen();
                this._pointPrev = null;
                this._peacePrev = null;
                break;

            default:
                this._pointPrev = null;
                this._peacePrev = null;
                break;
        }
    }

    /** @private */
    _onLost() {
        this._overlay?.clear();
        this._release();
        this._pointPrev = null;
    }

    // ── Gestos → acciones ────────────────────────────────────────────────

    /** Pinch: agarrar átomo y moverlo + seleccionarlo */
    _handlePinch(nx, ny, handSize) {
        if (!this._dragged) {
            // Intentar pick
            const atom = this._pickAtom(nx, ny);
            if (atom) {
                this._dragged = atom;
                this._baseDepth = handSize;  // tamaño de mano al inicio del drag

                // Seleccionar el átomo — pero NO centrar cámara (se siente antinatural con gestos)
                if (this._state?._selectAtom) {
                    const controls = this._qr.controls;
                    const savedTarget = controls?.target.clone();
                    this._state._selectAtom(atom);
                    // Restaurar target para que la cámara no salte al átomo
                    if (controls && savedTarget) {
                        controls.target.copy(savedTarget);
                        controls.update();
                    }
                }

                // Plano de cámara para drag XY
                const camDir = new THREE.Vector3();
                this._qr.camera.getWorldDirection(camDir);
                this._dragPlane.setFromNormalAndCoplanarPoint(camDir, atom.position);

                // Offset inicial
                this._raycaster.setFromCamera(
                    new THREE.Vector2(nx * 2 - 1, -(ny * 2 - 1)),
                    this._qr.camera
                );
                this._raycaster.ray.intersectPlane(this._dragPlane, this._dragHit);
                this._dragOff.subVectors(atom.position, this._dragHit);

                // Desactivar OrbitControls durante drag
                if (this._qr.controls) this._qr.controls.enabled = false;
            }
        } else {
            // Mover átomo en plano de cámara
            this._raycaster.setFromCamera(
                new THREE.Vector2(nx * 2 - 1, -(ny * 2 - 1)),
                this._qr.camera
            );
            if (this._raycaster.ray.intersectPlane(this._dragPlane, this._dragHit)) {
                this._dragged.position.copy(this._dragHit).add(this._dragOff);

                // Eje Z: tamaño de mano como proxy de profundidad
                // Invertido: mano cerca de cámara (grande) = objeto viene hacia ti
                //            mano lejos de cámara (chica)  = objeto se aleja
                const dSize = handSize - this._baseDepth;
                const camDir = new THREE.Vector3();
                this._qr.camera.getWorldDirection(camDir);
                this._dragged.position.addScaledVector(camDir, -dSize * 4000);
            }
        }
    }

    /** Point: rotar cámara con dedo índice (suavizado) */
    _handlePoint(nx, ny) {
        if (this._dragged) this._release();

        if (this._pointPrev) {
            const rawDx = nx - this._pointPrev.x;
            const rawDy = ny - this._pointPrev.y;

            // Suavizar deltas para eliminar jitter
            const s = this._deltaSmooth;
            this._smoothDelta.x = this._smoothDelta.x * s + rawDx * (1 - s);
            this._smoothDelta.y = this._smoothDelta.y * s + rawDy * (1 - s);

            if (this._qr.controls) {
                this._qr.controls.rotateLeft(-this._smoothDelta.x * 4.5);
                this._qr.controls.rotateUp(-this._smoothDelta.y * 4.5);
                this._qr.controls.update();
            }
        } else {
            this._smoothDelta.x = 0;
            this._smoothDelta.y = 0;
        }
        this._pointPrev = { x: nx, y: ny };
    }

    /** Open palm: soltar átomo suavemente */
    _handleOpen() {
        this._release();
    }

    /** Peace ✌️: desplazar cámara (pan) — suavizado */
    _handlePeace(nx, ny) {
        if (this._dragged) this._release();

        if (this._peacePrev) {
            const rawDx = nx - this._peacePrev.x;
            const rawDy = ny - this._peacePrev.y;

            // Suavizar deltas
            const s = this._deltaSmooth;
            this._smoothDeltaPan.x = this._smoothDeltaPan.x * s + rawDx * (1 - s);
            this._smoothDeltaPan.y = this._smoothDeltaPan.y * s + rawDy * (1 - s);

            const cam = this._qr.camera;
            const controls = this._qr.controls;
            if (cam && controls) {
                const right = new THREE.Vector3();
                const up    = new THREE.Vector3();
                cam.getWorldDirection(up);
                right.crossVectors(up, cam.up).normalize();
                up.crossVectors(right, up).normalize();

                const panScale = 3000;
                const offset = new THREE.Vector3()
                    .addScaledVector(right, -this._smoothDeltaPan.x * panScale)
                    .addScaledVector(up,     this._smoothDeltaPan.y * panScale);

                cam.position.add(offset);
                controls.target.add(offset);
                controls.update();
            }
        } else {
            this._smoothDeltaPan.x = 0;
            this._smoothDeltaPan.y = 0;
        }
        this._peacePrev = { x: nx, y: ny };
    }

    // ── Helpers ──────────────────────────────────────────────────────────

    /** Pick del átomo más cercano al rayo gestual */
    _pickAtom(nx, ny) {
        this._raycaster.setFromCamera(
            new THREE.Vector2(nx * 2 - 1, -(ny * 2 - 1)),
            this._qr.camera
        );

        let best = Infinity;
        let bestAtom = null;

        for (const atom of this._world.atoms.values()) {
            const d = this._raycaster.ray.distanceToPoint(atom.position);
            const hitR = atom.radius * 2.0;
            if (d < hitR && d < best) {
                best = d;
                bestAtom = atom;
            }
        }
        return bestAtom;
    }

    /** Soltar átomo y restaurar controls */
    _release() {
        if (!this._dragged) return;
        this._dragged = null;
        if (this._qr.controls) this._qr.controls.enabled = true;
    }

    /** Crear <video> y <canvas> overlay (lazy, solo al primer start) */
    _createDOM() {
        // Video invisible para webcam
        this._video = document.createElement('video');
        this._video.autoplay = true;
        this._video.playsInline = true;
        this._video.muted = true;
        Object.assign(this._video.style, {
            position: 'absolute', opacity: '0',
            pointerEvents: 'none', width: '1px', height: '1px',
        });
        document.body.appendChild(this._video);

        // Canvas overlay fullscreen
        this._canvas = document.createElement('canvas');
        Object.assign(this._canvas.style, {
            position: 'fixed', top: '0', left: '0',
            width: '100%', height: '100%',
            pointerEvents: 'none', zIndex: '50',
            opacity: '0', transition: 'opacity 0.4s',
        });
        document.body.appendChild(this._canvas);
    }

    /** @private — bound resize handler */
    _onResize = () => {
        this._overlay?.resize();
    };
}
