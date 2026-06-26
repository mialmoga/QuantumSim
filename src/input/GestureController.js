/**
 * GestureController.js — Control gestual via MediaPipe Hands
 * ============================================================
 * Módulo standalone — NO sabe nada de Three.js ni de átomos.
 * Solo captura webcam, clasifica gestos y emite eventos DOM.
 *
 * Gestos soportados:
 *   'pinch' — pulgar+índice juntos (agarrar)
 *   'point' — solo índice extendido (apuntar/rotar)
 *   'open'  — todos los dedos extendidos (soltar/idle)
 *   'idle'  — posición no reconocida
 *
 * Eventos emitidos:
 *   'gesture'  → { type, landmarks, smoothed, depth }
 *   'lost'     → {} (mano sale del frame)
 *
 * Uso:
 *   import { GestureController } from './GestureController.js';
 *   const gc = new GestureController(videoEl);
 *   gc.addEventListener('gesture', e => { ... });
 *   await gc.start();
 *   gc.stop();
 */

const MEDIAPIPE_BASE = '/components/mediapipe';
const SMOOTH_FACTOR  = 0.4;

export class GestureController extends EventTarget {

    /**
     * @param {HTMLVideoElement} videoEl — elemento <video> (puede ser invisible)
     */
    constructor(videoEl) {
        super();
        this._video     = videoEl;
        this._detector  = null;
        this._active    = false;
        this._smoothLM  = null;
        this._lastGesture = 'none';
    }

    // ── API pública ──────────────────────────────────────────────────────

    /**
     * Inicia webcam y carga MediaPipe. Resuelve cuando está listo.
     */
    async start() {
        if (this._active) return;

        // Cargar MediaPipe offline
        if (!this._detector) {
            await this._loadMediaPipe();
        }

        // Webcam
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { width: 320, height: 240, facingMode: 'user' }
        });
        this._video.srcObject = stream;
        await new Promise(r => { this._video.onloadedmetadata = r; });
        await this._video.play();

        this._active = true;
        this._runLoop();
        console.log('[GestureCtrl] ✅ Activo');
    }

    /**
     * Detiene webcam y limpia recursos.
     */
    stop() {
        this._active = false;
        this._smoothLM = null;
        if (this._video.srcObject) {
            this._video.srcObject.getTracks().forEach(t => t.stop());
            this._video.srcObject = null;
        }
        this.dispatchEvent(new CustomEvent('lost'));
        console.log('[GestureCtrl] ⏹ Detenido');
    }

    get isActive() { return this._active; }

    // ── Clasificación de gestos ──────────────────────────────────────────

    /**
     * Clasifica landmarks en un gesto.
     * Stateless — no guarda historia.
     * @param {Array} lm — 21 landmarks normalizados
     * @returns {string}
     */
    static classify(lm) {
        const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

        // Pinch: pulgar e índice a menos de 7% del espacio normalizado
        if (d(lm[4], lm[8]) < 0.07) return 'pinch';

        // Dedos extendidos: tip.y < pip.y (coordenadas normalizadas, Y crece hacia abajo)
        const iUp = lm[8].y  < lm[6].y;   // índice
        const mUp = lm[12].y < lm[10].y;  // medio
        const rUp = lm[16].y < lm[14].y;  // anular
        const pUp = lm[20].y < lm[18].y;  // meñique

        if (iUp && mUp && rUp && pUp) return 'open';
        if (iUp && mUp && !rUp && !pUp) return 'peace';
        if (iUp && !mUp && !rUp && !pUp) return 'point';

        return 'idle';
    }

    /**
     * Calcula el tamaño de la mano como proxy de profundidad.
     * Mano grande en pantalla = cerca de cámara, mano chica = lejos.
     * Más confiable que el z de MediaPipe que es ruidoso.
     * @param {Array} lm — landmarks
     * @returns {number} — tamaño normalizado (~0.1 lejos, ~0.4 cerca)
     */
    static handSize(lm) {
        // Distancia muñeca → base del dedo medio (palm span)
        return Math.hypot(lm[0].x - lm[9].x, lm[0].y - lm[9].y);
    }

    // ── Privado ──────────────────────────────────────────────────────────

    async _loadMediaPipe() {
        // Cargar script principal
        await this._loadScript(`${MEDIAPIPE_BASE}/hands.js`);
        await new Promise(r => setTimeout(r, 200));

        // Inicializar detector con archivos locales
        /* global Hands */
        this._detector = new Hands({
            locateFile: f => `${MEDIAPIPE_BASE}/${f}`
        });
        this._detector.setOptions({
            maxNumHands: 1,
            modelComplexity: 1,
            minDetectionConfidence: 0.7,
            minTrackingConfidence: 0.6,
        });
        this._detector.onResults(results => this._onResults(results));
        console.log('[GestureCtrl] MediaPipe cargado (offline)');
    }

    _loadScript(src) {
        return new Promise((res, rej) => {
            if (document.querySelector(`script[src="${src}"]`)) { res(); return; }
            const s = document.createElement('script');
            s.src = src; s.onload = res; s.onerror = rej;
            document.head.appendChild(s);
        });
    }

    _onResults(results) {
        if (results.multiHandLandmarks?.length > 0) {
            const raw = results.multiHandLandmarks[0];
            this._processFrame(raw);
        } else {
            this._smoothLM = null;
            this._lastGesture = 'none';
            this.dispatchEvent(new CustomEvent('lost'));
        }
    }

    _processFrame(raw) {
        // Suavizado temporal — elimina jitter de MediaPipe
        if (!this._smoothLM) {
            this._smoothLM = raw.map(p => ({ ...p }));
        }
        this._smoothLM = this._smoothLM.map((p, i) => ({
            x: p.x + (raw[i].x - p.x) * SMOOTH_FACTOR,
            y: p.y + (raw[i].y - p.y) * SMOOTH_FACTOR,
            z: p.z + (raw[i].z - p.z) * SMOOTH_FACTOR,
        }));

        const lm      = this._smoothLM;
        const gesture  = GestureController.classify(lm);
        this._lastGesture = gesture;

        // Profundidad: tamaño de mano como proxy (más confiable que z de MediaPipe)
        const handSize = GestureController.handSize(lm);

        this.dispatchEvent(new CustomEvent('gesture', {
            detail: { type: gesture, landmarks: raw, smoothed: lm, depth: handSize }
        }));
    }

    async _runLoop() {
        if (!this._active) return;
        if (this._video.readyState >= 2) {
            await this._detector.send({ image: this._video });
        }
        requestAnimationFrame(() => this._runLoop());
    }
}
