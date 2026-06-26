/**
 * GestureOverlay.js — Overlay holográfico de mano sobre el canvas 3D
 * ====================================================================
 * Dibuja un esqueleto sutil sobre un canvas 2D posicionado encima del
 * canvas de Three.js. Estilo: skeleton blanco con holograma azul tenue.
 *
 * Diseño minimalista:
 *   - Skeleton blanco fino con glow azul muy sutil
 *   - Punto acentuado en dedo activo (no rayo)
 *   - Sin panel de gestos permanente — solo tutorial que se desvanece
 *
 * Uso:
 *   import { GestureOverlay } from './GestureOverlay.js';
 *   const overlay = new GestureOverlay(canvasEl);
 *   overlay.draw(smoothedLandmarks, 'pinch');
 *   overlay.clear();
 */

const HAND_CONNECTIONS = [
    [0,1],[1,2],[2,3],[3,4],       // pulgar
    [0,5],[5,6],[6,7],[7,8],       // índice
    [0,9],[9,10],[10,11],[11,12],   // medio
    [0,13],[13,14],[14,15],[15,16], // anular
    [0,17],[17,18],[18,19],[19,20], // meñique
    [5,9],[9,13],[13,17],           // nudillos
];

const TIPS = new Set([4, 8, 12, 16, 20]);

// Colores del holograma — blanco + azul tenue
const COL_BONE     = 'rgba(200, 220, 255, 0.35)';
const COL_BONE_GLOW = 'rgba(80, 140, 255, 0.06)';
const COL_JOINT    = 'rgba(200, 220, 255, 0.5)';
const COL_TIP      = 'rgba(180, 210, 255, 0.6)';
const COL_ACTIVE   = 'rgba(0, 200, 255, 0.8)';   // dedo activo
const COL_PALM_IDLE  = 'rgba(60, 120, 255, 0.03)';
const COL_PALM_PINCH = 'rgba(0, 255, 180, 0.05)';

export class GestureOverlay {

    /**
     * @param {HTMLCanvasElement} canvas — canvas overlay (position:absolute, pointer-events:none)
     */
    constructor(canvas) {
        this._canvas = canvas;
        this._ctx    = canvas.getContext('2d');
        this._tutorialTimer = null;
        this._showTutorial  = false;
        this.resize();
    }

    // ── API pública ──────────────────────────────────────────────────────

    /**
     * Dibuja el skeleton holográfico.
     * @param {Array} lm — 21 landmarks suavizados (coordenadas normalizadas 0-1)
     * @param {string} gesture — 'pinch' | 'point' | 'peace' | 'open' | 'idle'
     */
    draw(lm, gesture) {
        const W = this._canvas.width;
        const H = this._canvas.height;
        const ctx = this._ctx;

        // Espejo horizontal — natural como toda app de cámara selfie
        const sx = p => (1 - p.x) * W;
        const sy = p => p.y * H;

        ctx.clearRect(0, 0, W, H);

        // Glow difuso en palma
        const px = sx(lm[9]), py = sy(lm[9]);
        const pg = ctx.createRadialGradient(px, py, 0, px, py, 80);
        pg.addColorStop(0, gesture === 'pinch' ? COL_PALM_PINCH : COL_PALM_IDLE);
        pg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = pg;
        ctx.fillRect(0, 0, W, H);

        // Conexiones
        for (const [a, b] of HAND_CONNECTIONS) {
            const x1 = sx(lm[a]), y1 = sy(lm[a]);
            const x2 = sx(lm[b]), y2 = sy(lm[b]);
            ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
            ctx.strokeStyle = COL_BONE_GLOW; ctx.lineWidth = 8; ctx.lineCap = 'round'; ctx.stroke();
            ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
            ctx.strokeStyle = COL_BONE; ctx.lineWidth = 1.2; ctx.stroke();
        }

        // Articulaciones
        for (let i = 0; i < lm.length; i++) {
            const x = sx(lm[i]), y = sy(lm[i]);
            ctx.beginPath();
            ctx.arc(x, y, TIPS.has(i) ? 3 : 2, 0, Math.PI * 2);
            ctx.fillStyle = TIPS.has(i) ? COL_TIP : COL_JOINT;
            ctx.fill();
        }

        // Indicador de gesto activo
        if (gesture === 'pinch') {
            this._drawActiveDot(ctx, (sx(lm[4])+sx(lm[8]))/2, (sy(lm[4])+sy(lm[8]))/2);
        } else if (gesture === 'point') {
            this._drawActiveDot(ctx, sx(lm[8]), sy(lm[8]));
        } else if (gesture === 'peace') {
            this._drawActiveDot(ctx, sx(lm[8]), sy(lm[8]));
            this._drawActiveDot(ctx, sx(lm[12]), sy(lm[12]));
        }
    }

    /**
     * Limpia el overlay.
     */
    clear() {
        this._ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
    }

    /**
     * Redimensiona el canvas al tamaño de la ventana.
     */
    resize() {
        this._canvas.width  = window.innerWidth;
        this._canvas.height = window.innerHeight;
    }

    /**
     * Muestra tutorial de gestos que se desvanece en 20 segundos.
     */
    showTutorial() {
        this._showTutorial = true;
        this._tutorialStart = performance.now();

        if (this._tutorialTimer) clearTimeout(this._tutorialTimer);
        this._tutorialTimer = setTimeout(() => {
            this._showTutorial = false;
        }, 20000);
    }

    /**
     * Dibuja el tutorial si está activo (llamar después de draw).
     */
    drawTutorial() {
        if (!this._showTutorial) return;

        const elapsed = performance.now() - this._tutorialStart;
        // Fade out en los últimos 3 segundos
        const alpha = elapsed > 17000
            ? Math.max(0, 1 - (elapsed - 17000) / 3000)
            : 1.0;

        if (alpha <= 0) { this._showTutorial = false; return; }

        const ctx = this._ctx;
        const W = this._canvas.width;
        const H = this._canvas.height;

        ctx.save();
        ctx.globalAlpha = alpha * 0.7;
        ctx.font = '11px monospace';
        ctx.fillStyle = 'rgba(150, 200, 255, 0.8)';
        ctx.textAlign = 'center';

        const y = this._canvas.height - 60;
        const isPortrait = W < H;
        if (isPortrait) {
            ctx.fillText('🤏 pinch → agarrar    ☝️ point → rotar', W / 2, y - 14);
            ctx.fillText('✌️ peace → mover    🖐️ palm → soltar', W / 2, y + 6);
        } else {
            ctx.fillText('🤏 pinch → agarrar    ☝️ point → rotar    ✌️ peace → mover    🖐️ palm → soltar', W / 2, y);
        }
        ctx.restore();
    }

    // ── Privado ──────────────────────────────────────────────────────────

    /**
     * Punto sutil azul-cyan para indicar gesto activo.
     */
    _drawActiveDot(ctx, x, y) {
        const g = ctx.createRadialGradient(x, y, 0, x, y, 10);
        g.addColorStop(0, COL_ACTIVE);
        g.addColorStop(1, 'rgba(0, 200, 255, 0)');
        ctx.beginPath();
        ctx.arc(x, y, 10, 0, Math.PI * 2);
        ctx.fillStyle = g;
        ctx.fill();

        // Centro brillante
        ctx.beginPath();
        ctx.arc(x, y, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(200, 240, 255, 0.9)';
        ctx.fill();
    }
}
