import * as THREE from 'three';

/**
 * FPSJoystick.js — Joystick táctil FPS + manipulación de átomo seleccionado.
 *
 * Modo cámara (sin átomo seleccionado):
 *   - Joystick: adelante/atrás/strafe relativo a la cámara
 *   - Botones ▲▼: subir/bajar en Y
 *
 * Modo átomo (con átomo seleccionado):
 *   - Joystick: mueve el átomo en el plano XZ relativo a la cámara
 *   - Botones ▲▼: mueve el átomo en Y
 *   - La cámara sigue al átomo suavemente
 */

const JOY_SIZE   = 88;
const KNOB_SIZE  = 36;
const JOY_MARGIN = 20;
const MOVE_SPEED = 280;   // wu/s — cámara
const ATOM_SPEED = 180;   // wu/s — átomo
const BTN_SIZE   = 44;

export class FPSJoystick {

    constructor(camera, controls) {
        this._camera   = camera;
        this._controls = controls;
        this._atom     = null;   // átomo actualmente seleccionado (o null)

        this._joyActive  = false;
        this._joyTouchId = null;
        this._joyOrigin  = { x: 0, y: 0 };
        this._joyDelta   = { x: 0, y: 0 };
        this._upPressed   = false;
        this._downPressed = false;

        this._fwd   = new THREE.Vector3();
        this._right = new THREE.Vector3();
        this._move  = new THREE.Vector3();

        this._buildDOM();
        this._bindEvents();
    }

    /** Átomo seleccionado actualmente. null = modo cámara. */
    setAtom(atom) {
        this._atom = atom;
        // Cambiar apariencia del joystick para indicar el modo
        const accent = atom ? 'rgba(100,200,255,0.35)' : 'rgba(255,255,255,0.06)';
        this._joyArea.style.background = accent;
        this._joyArea.style.borderColor = atom ? 'rgba(100,200,255,0.5)' : 'rgba(255,255,255,0.15)';
    }

    update(dt) {
        const cam  = this._camera;
        const ctrl = this._controls;
        if (!cam || !ctrl) return;

        const dx = this._joyDelta.x;
        const dy = this._joyDelta.y;
        const hasJoy = Math.abs(dx) > 0.05 || Math.abs(dy) > 0.05;
        const hasBtn = this._upPressed || this._downPressed;
        if (!hasJoy && !hasBtn) return;

        cam.getWorldDirection(this._fwd);
        this._fwd.y = 0;
        if (this._fwd.lengthSq() < 0.001) this._fwd.set(0, 0, -1);
        this._fwd.normalize();
        this._right.crossVectors(this._fwd, new THREE.Vector3(0, 1, 0)).normalize();

        this._move.set(0, 0, 0);
        const speed = this._atom ? ATOM_SPEED : MOVE_SPEED;

        if (hasJoy) {
            this._move.addScaledVector(this._fwd,  -dy * speed * dt);
            this._move.addScaledVector(this._right,  dx * speed * dt);
        }
        if (this._upPressed)   this._move.y += speed * dt;
        if (this._downPressed) this._move.y -= speed * dt;

        if (this._atom) {
            // Mover átomo — physics lo sincronizará
            this._atom.position.add(this._move);
            this._atom.velocity?.set(0, 0, 0);   // cancelar inercia mientras se arrastra
            // Cámara sigue al átomo
            ctrl.target.copy(this._atom.position);
            ctrl.update();
        } else {
            // Mover cámara
            cam.position.add(this._move);
            ctrl.target.add(this._move);
            ctrl.update();
        }
    }

    setVisible(visible) { this._root.style.display = visible ? 'flex' : 'none'; }
    dispose() { this._root.remove(); }

    _buildDOM() {
        // En landscape con pantalla corta, mover a la derecha para evitar solapar botones de selección
        const isLandscape = window.innerWidth > window.innerHeight && window.innerHeight < 500;
        const joyLeft = isLandscape ? 65 : JOY_MARGIN;

        const root = document.createElement('div');
        root.id = 'fps-joystick';
        root.style.cssText = `
            position:fixed; bottom:${JOY_MARGIN + 64}px; left:${joyLeft}px;
            display:flex; flex-direction:column; align-items:center; gap:10px;
            z-index:25; pointer-events:none; user-select:none; -webkit-user-select:none;
        `;

        const btnUp   = this._makeBtn('▲', 'joy-up');
        const btnDown = this._makeBtn('▼', 'joy-down');

        const joyArea = document.createElement('div');
        joyArea.id = 'joy-area';
        joyArea.style.cssText = `
            width:${JOY_SIZE}px; height:${JOY_SIZE}px; border-radius:50%;
            background:rgba(255,255,255,0.06); border:1.5px solid rgba(255,255,255,0.15);
            position:relative; pointer-events:all; touch-action:none;
            backdrop-filter:blur(4px); -webkit-backdrop-filter:blur(4px);
            transition: background 0.2s, border-color 0.2s;
        `;

        const knob = document.createElement('div');
        knob.id = 'joy-knob';
        knob.style.cssText = `
            width:${KNOB_SIZE}px; height:${KNOB_SIZE}px; border-radius:50%;
            background:rgba(255,255,255,0.25); border:1.5px solid rgba(255,255,255,0.4);
            position:absolute; top:50%; left:50%; transform:translate(-50%,-50%);
            transition:background 0.1s; pointer-events:none;
        `;
        joyArea.appendChild(knob);

        root.appendChild(btnUp);
        root.appendChild(joyArea);
        root.appendChild(btnDown);
        document.body.appendChild(root);

        this._root    = root;
        this._joyArea = joyArea;
        this._knob    = knob;
        this._btnUp   = btnUp;
        this._btnDown = btnDown;

        // Reposicionar en cambio de orientación
        window.addEventListener('resize', () => {
            const landscape = window.innerWidth > window.innerHeight && window.innerHeight < 500;
            root.style.left = (landscape ? 65 : JOY_MARGIN) + 'px';
        });
    }

    _makeBtn(label, id) {
        const b = document.createElement('div');
        b.id = id; b.textContent = label;
        b.style.cssText = `
            width:${BTN_SIZE}px; height:${BTN_SIZE}px; border-radius:50%;
            background:rgba(255,255,255,0.06); border:1.5px solid rgba(255,255,255,0.15);
            display:flex; align-items:center; justify-content:center;
            font-size:16px; color:rgba(255,255,255,0.5); pointer-events:all;
            touch-action:none; cursor:pointer; backdrop-filter:blur(4px);
            -webkit-backdrop-filter:blur(4px); transition:background 0.1s, color 0.1s;
        `;
        return b;
    }

    _bindEvents() {
        this._joyArea.addEventListener('touchstart', e => this._joyStart(e), { passive: false });
        document.addEventListener('touchmove',   e => this._joyMove(e),  { passive: false });
        document.addEventListener('touchend',    e => this._joyEnd(e),   { passive: false });
        document.addEventListener('touchcancel', e => this._joyEnd(e),   { passive: false });

        this._joyArea.addEventListener('mousedown', e => this._joyStartMouse(e));
        document.addEventListener('mousemove', e => this._joyMoveMouse(e));
        document.addEventListener('mouseup',   () => this._joyEndMouse());

        const hold = (btn, flagFn) => {
            btn.addEventListener('touchstart',  e => { e.preventDefault(); flagFn(true);  this._btnStyle(btn, true);  }, { passive: false });
            btn.addEventListener('mousedown',   () => { flagFn(true);  this._btnStyle(btn, true);  });
        };
        document.addEventListener('touchend', () => {
            this._upPressed = false; this._downPressed = false;
            this._btnStyle(this._btnUp, false); this._btnStyle(this._btnDown, false);
        });
        document.addEventListener('mouseup', () => {
            this._upPressed = false; this._downPressed = false;
            this._btnStyle(this._btnUp, false); this._btnStyle(this._btnDown, false);
        });
        hold(this._btnUp,   v => this._upPressed   = v);
        hold(this._btnDown, v => this._downPressed = v);
    }

    _joyStart(e) {
        e.preventDefault();
        if (this._joyActive) return;
        const t = e.changedTouches[0];
        this._joyActive = true; this._joyTouchId = t.identifier;
        const r = this._joyArea.getBoundingClientRect();
        this._joyOrigin = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        this._knob.style.background = 'rgba(255,255,255,0.4)';
    }

    _joyMove(e) {
        if (!this._joyActive) return;
        for (const t of e.changedTouches) {
            if (t.identifier !== this._joyTouchId) continue;
            e.preventDefault();
            this._applyDelta(t.clientX - this._joyOrigin.x, t.clientY - this._joyOrigin.y);
        }
    }

    _joyEnd(e) {
        for (const t of e.changedTouches) {
            if (t.identifier === this._joyTouchId) this._joyReset();
        }
    }

    _joyStartMouse(e) {
        this._joyActive = true;
        const r = this._joyArea.getBoundingClientRect();
        this._joyOrigin = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        this._knob.style.background = 'rgba(255,255,255,0.4)';
    }

    _joyMoveMouse(e) {
        if (!this._joyActive) return;
        this._applyDelta(e.clientX - this._joyOrigin.x, e.clientY - this._joyOrigin.y);
    }

    _joyEndMouse() { if (this._joyActive) this._joyReset(); }

    _applyDelta(dx, dy) {
        const maxR = JOY_SIZE / 2 - KNOB_SIZE / 2;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const c    = Math.min(dist, maxR);
        const a    = Math.atan2(dy, dx);
        const nx   = Math.cos(a) * c, ny = Math.sin(a) * c;
        this._knob.style.transform = `translate(calc(-50% + ${nx}px), calc(-50% + ${ny}px))`;
        this._joyDelta.x = nx / maxR;
        this._joyDelta.y = ny / maxR;
    }

    _joyReset() {
        this._joyActive = false; this._joyTouchId = null;
        this._joyDelta = { x: 0, y: 0 };
        this._knob.style.transform = 'translate(-50%,-50%)';
        this._knob.style.background = 'rgba(255,255,255,0.25)';
    }

    _btnStyle(btn, active) {
        btn.style.background = active ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.06)';
        btn.style.color      = active ? 'rgba(255,255,255,0.9)'  : 'rgba(255,255,255,0.5)';
    }
}
