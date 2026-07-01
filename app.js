/**
 * app.js — Entry point de QuantumSim
 *
 * Arquitectura:
 *   - QuantumRenderer en modo standalone es el motor gráfico completo.
 *     Tiene su propia escena, cámara, OrbitControls, bloom y escala (1wu = 1pm).
 *   - app.js añade a esa escena: piso, grid, luces del simulador.
 *   - World corre la física en la misma escala.
 *   - El loop lo controla app.js (externalLoop:true) para correr
 *     world.update() cada frame antes de qr.tick().
 *
 * Escala: 1 world unit = 1 pm  (misma que QuantumRenderer/QuantumView)
 *   H  radio = 31 wu
 *   Fe radio = 126 wu
 *   FLOOR_Y  = -500 wu
 *   LOD thresholds: 35 / 80 / 180 wu (funcionan directo, sin conversión)
 */

import { QuantumRenderer }            from './src/renderer/QuantumRenderer.js';
import { QuantumRendererPool, QUANTUM_RADIUS } from './src/renderer/QuantumRendererPool.js';
import { FPSJoystick }                from './src/ui/FPSJoystick.js';
import { World }                      from './src/core/World.js';
import { initI18n, t, updateDOM, getLanguage } from './src/data/i18n.js';
import { DevConsole as Console }      from './src/ui/Console.js';
import { SessionSetup }               from './src/ui/SessionSetup.js';
import { ElementSelector }            from './src/ui/ElementSelector.js';
import { GroupPanel }                 from './src/ui/GroupPanel.js';
import { PhysicsPanel }               from './src/ui/PhysicsPanel.js';
import { AddPanel }                   from './src/ui/AddPanel.js';
import { SoundEngine }                from './src/audio/SoundEngine.js';
import { buildLayerPanel }            from './src/renderer/LayerPanel.js';
import { GestureIntegration }         from './src/input/GestureIntegration.js';
import * as THREE                     from 'three';

const DevConsole = Console;

// ── Escala (1wu = 1pm) ────────────────────────────────────────────────────
const FLOOR_Y     = -500;
const SPAWN_ABOVE =   60;
const GRID_SIZE   = 8000;
const GRID_DIVS   =   80;

// Pre-allocated vectors for render loop — zero alloc per frame
const _cageDir    = new THREE.Vector3();
const _proxyDelta = new THREE.Vector3();

// ── Piso y luces ───────────────────────────────────────────────────────────

function addFloor(scene) {
    const geo = new THREE.PlaneGeometry(GRID_SIZE, GRID_SIZE);
    const mat = new THREE.MeshStandardMaterial({
        color: 0x060d1f, metalness: 0, roughness: 1.0,
        transparent: false,
    });
    const floor = new THREE.Mesh(geo, mat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = FLOOR_Y;
    floor.receiveShadow = true;
    scene.add(floor);

    const grid = new THREE.GridHelper(GRID_SIZE, GRID_DIVS, 0x1a2040, 0x1a2040);
    grid.position.y = FLOOR_Y + 5;
    scene.add(grid);
}

function addLights(scene) {
    scene.add(new THREE.AmbientLight(0x6080a0, 1.4));   // más brillante y ligeramente azulada

    const sun = new THREE.DirectionalLight(0xffffff, 1.8);
    sun.position.set(1000, 2000, 1000);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near   = 8;
    sun.shadow.camera.far    = 8000;
    sun.shadow.camera.left   = -3000;
    sun.shadow.camera.right  =  3000;
    sun.shadow.camera.top    =  3000;
    sun.shadow.camera.bottom = -3000;
    scene.add(sun);

    const fill = new THREE.DirectionalLight(0x8090ff, 0.4);
    fill.position.set(-800, -500, -1000);
    scene.add(fill);

    // Luz cenital suave — da ese look "espacio iluminado" del viejo
    const top = new THREE.DirectionalLight(0x4060ff, 0.4);
    top.position.set(0, 3000, 0);
    scene.add(top);
}

// ── Raycaster ──────────────────────────────────────────────────────────────

function _getWorldPos(event, qr) {
    const rect    = qr.renderer.domElement.getBoundingClientRect();
    const clientX = event.touches ? event.changedTouches[0].clientX : event.clientX;
    const clientY = event.touches ? event.changedTouches[0].clientY : event.clientY;
    const ndc = new THREE.Vector2(
        ((clientX - rect.left) / rect.width)  *  2 - 1,
        ((clientY - rect.top)  / rect.height) * -2 + 1,
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, qr.camera);
    const target = new THREE.Vector3();
    // Colocar a distancia fija frente a la cámara en la dirección del tap
    // (no en el piso — el átomo aparece donde el usuario está mirando)
    ray.ray.at(300, target);
    target.y = Math.max(FLOOR_Y + SPAWN_ABOVE, target.y);
    return target;
}

function initRaycaster(qr, world, state, pool, joystick) {
    const ray  = new THREE.Raycaster();
    const ptr  = new THREE.Vector2();
    let   last = 0;

    // ── Selection Brackets — esquinas tipo visor en cada átomo seleccionado ─
    const _boxes = new Map();   // atom.id → { mesh, mat }
    const BRACKET_COLOR_ATOM     = 0x44aaff;  // cyan para átomos individuales
    const BRACKET_COLOR_MOLECULE = 0x44ffaa;  // verde para moléculas

    function addBox(atom) {
        if (_boxes.has(atom.id)) return;
        const r = (atom.radius || 40) * 1.3;
        const L = r * 0.38;

        const corners = [
            [-1,-1,-1], [ 1,-1,-1], [-1, 1,-1], [ 1, 1,-1],
            [-1,-1, 1], [ 1,-1, 1], [-1, 1, 1], [ 1, 1, 1],
        ];

        const positions = [];
        for (const [sx, sy, sz] of corners) {
            const cx = sx * r, cy = sy * r, cz = sz * r;
            positions.push(cx, cy, cz, cx - sx * L, cy, cz);
            positions.push(cx, cy, cz, cx, cy - sy * L, cz);
            positions.push(cx, cy, cz, cx, cy, cz - sz * L);
        }

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));

        const isMolMode = state.selectMode === 'molecule';
        const mat = new THREE.LineBasicMaterial({
            color: isMolMode ? BRACKET_COLOR_MOLECULE : BRACKET_COLOR_ATOM,
            transparent: true,
            opacity: 0.8,
            depthTest: false,
        });
        const brackets = new THREE.LineSegments(geo, mat);
        brackets.renderOrder = 999;
        brackets.position.copy(atom.position);
        qr.scene.add(brackets);
        _boxes.set(atom.id, { mesh: brackets, mat });
    }

    function removeBox(atomId) {
        const entry = _boxes.get(atomId);
        if (!entry) return;
        qr.scene.remove(entry.mesh);
        entry.mesh.geometry?.dispose();
        entry.mat?.dispose();
        _boxes.delete(atomId);
    }

    function clearBoxes() {
        for (const [id] of _boxes) removeBox(id);
    }

    // Actualizar brackets cada frame — posición + pulso suave
    const _origTick = qr.tick.bind(qr);
    qr.tick = (t, dt) => {
        const pulse = 0.6 + 0.4 * Math.sin(t * 3.0);  // pulso suave 0.6–1.0
        for (const [id, entry] of _boxes) {
            const a = world.atoms.get(id);
            if (a) entry.mesh.position.copy(a.position);
            entry.mat.opacity = pulse * 0.8;
        }
        _origTick(t, dt);
    };

    // ── Raycasting ────────────────────────────────────────────────────────
    function atomAt(event) {
        const rect    = qr.renderer.domElement.getBoundingClientRect();
        const clientX = event.touches ? event.touches[0].clientX : event.clientX;
        const clientY = event.touches ? event.touches[0].clientY : event.clientY;
        ptr.x = ((clientX - rect.left) / rect.width)  *  2 - 1;
        ptr.y = ((clientY - rect.top)  / rect.height) * -2 + 1;
        ray.setFromCamera(ptr, qr.camera);
        const meshes = [...world.atoms.values()].map(a => a._hitMesh || a.mesh).filter(Boolean);
        const hits   = ray.intersectObjects(meshes, false);
        return hits[0]?.object.userData.atomRef ?? null;
    }

    // ── Selección ─────────────────────────────────────────────────────────
    // Modo libre: coloca el target frente a la cámara (look-around sin orbitar)
    const LOOK_DIST = 300;  // wu — distancia fija del target en modo libre
    function _setFreeTarget() {
        const dir = new THREE.Vector3();
        qr.camera.getWorldDirection(dir);
        qr.controls.target.copy(qr.camera.position).addScaledVector(dir, LOOK_DIST);
        qr.controls.update();
    }

    function selectAtom(atom) {
        // ── Modo molécula: seleccionar todo el cluster ─────────────────
        if (state.selectMode === 'molecule') {
            const molAtoms = world.getMoleculeAtoms(atom);

            // Limpiar selección anterior
            for (const a of world.atoms.values()) a.setSelected(false);
            clearBoxes();
            state.selection.clear();

            // Seleccionar todo el cluster
            for (const a of molAtoms) {
                state.selection.add(a.id);
                a.setSelected(true);
                addBox(a);
            }
            state.focusedAtom = atom;

            // Cámara al centro de masa
            const com = new THREE.Vector3();
            for (const a of molAtoms) com.add(a.position);
            com.divideScalar(molAtoms.length);
            qr.controls.target.copy(com);
            qr.controls.update();

            // Joystick mueve todo el grupo via proxy
            const moleculeProxy = {
                position: com.clone(),
                velocity: null,
                _isMoleculeProxy: true,
                _atoms: molAtoms,
                _lastPos: com.clone(),
            };
            joystick?.setAtom(moleculeProxy);

            hideQuantumPanel();  // modo molécula — QV no aplica
            showToolPanel(state, world);
            return;
        }

        // ── Modo átomo: selección individual (como antes) ──────────────
        if (state.multiSelect) {
            if (state.selection.has(atom.id)) {
                state.selection.delete(atom.id);
                atom.setSelected(false);
                removeBox(atom.id);
            } else {
                state.selection.add(atom.id);
                atom.setSelected(true);
                addBox(atom);
            }
            state.focusedAtom = state.selection.size > 0 ? atom : null;
        } else {
            // Selección simple — limpiar anterior
            for (const a of world.atoms.values()) a.setSelected(false);
            clearBoxes();
            state.selection.clear();
            state.selection.add(atom.id);
            atom.setSelected(true);
            addBox(atom);
            state.focusedAtom = atom;
            // Cámara orbita alrededor del átomo seleccionado
            qr.controls.target.copy(atom.position);
            qr.controls.update();
            showQuantumPanel(atom);
        }
        // Joystick entra en modo átomo
        joystick?.setAtom(state.focusedAtom);
        showToolPanel(state, world);
    }

    function clearSel() {
        for (const a of world.atoms.values()) a.setSelected(false);
        clearBoxes();
        state.selection.clear();
        state.focusedAtom = null;
        // Modo libre: target frente a la cámara a la misma distancia que tenía al átomo
        // → no hay salto, la cámara queda exactamente donde estaba
        _setFreeTarget();
        joystick?.setAtom(null);
        hideQuantumPanel();
        hideToolPanel();
    }

    function deleteSelected() {
        for (const id of [...state.selection]) {
            removeBox(id);
            const atom = world.atoms.get(id);
            if (atom) { pool.onAtomRemoved(id); world.removeAtom(id); }
        }
        state.selection.clear();
        state.focusedAtom = null;
        joystick?.setAtom(null);
        hideQuantumPanel();
        hideToolPanel();
    }

    state._clearSel       = clearSel;
    state._selectAtom     = selectAtom;
    state._deleteSelected = deleteSelected;
    state._world          = world;

    // ── Fantasma de colocación ────────────────────────────────────────────
    let _ghost = null;

    function showGhost(symbol) {
        removeGhost();
        const geo = new THREE.SphereGeometry(40, 12, 8);
        const mat = new THREE.MeshBasicMaterial({
            color: 0x44aaff, transparent: true, opacity: 0.35,
            wireframe: false, depthWrite: false,
        });
        _ghost = new THREE.Mesh(geo, mat);
        // Posición inicial: frente a la cámara respetando su dirección real
        // (sin aplanar dir.y — el fantasma aparece donde el usuario está mirando)
        const dir = new THREE.Vector3();
        qr.camera.getWorldDirection(dir);
        _ghost.position.copy(qr.camera.position).addScaledVector(dir, 300);
        _ghost.position.y = Math.max(FLOOR_Y + SPAWN_ABOVE, _ghost.position.y);
        qr.scene.add(_ghost);
        // Joystick mueve el fantasma, no la cámara
        joystick?.setAtom({ position: _ghost.position, velocity: null });
    }

    function removeGhost() {
        if (!_ghost) return;
        qr.scene.remove(_ghost);
        _ghost.geometry.dispose();
        _ghost.material.dispose();
        _ghost = null;
        joystick?.setAtom(state.focusedAtom ?? null);
    }

    function confirmGhost() {
        if (!_ghost || !world._pendingSymbol) return;
        const p = _ghost.position.clone();
        removeGhost();
        world.addAtom(world._pendingSymbol, p)
            .then(a => DevConsole.log(`+ ${a.symbol} @ (${p.x.toFixed(0)}, ${p.y.toFixed(0)}, ${p.z.toFixed(0)}) wu`))
            .catch(err => DevConsole.error(err.message));
        world._pendingSymbol = null;
        document.getElementById('canvas-wrap')?.classList.remove('placing');
        hideGhostUI();
    }

    function showGhostUI(symbol) {
        let bar = document.getElementById('ghost-bar');
        if (!bar) {
            bar = document.createElement('div');
            bar.id = 'ghost-bar';
            bar.style.cssText = `
                position:fixed; bottom:72px; left:50%; transform:translateX(-50%);
                background:rgba(8,14,30,0.88); border:1px solid rgba(100,180,255,0.3);
                border-radius:12px; padding:8px 16px; display:flex; align-items:center;
                gap:12px; z-index:25; backdrop-filter:blur(8px); color:rgba(255,255,255,0.8);
                font-size:13px;
            `;
            document.body.appendChild(bar);
        }
        bar.innerHTML = `
            <span>${t('messages.placing_atom').replace('{symbol}', symbol)}</span>
            <button id="ghost-confirm" style="
                background:rgba(100,200,100,0.2); border:1px solid rgba(100,200,100,0.4);
                color:#8f8; border-radius:8px; padding:4px 12px; cursor:pointer; font-size:12px;
            ">✓ ${t('controls.confirm')}</button>
            <button id="ghost-cancel" style="
                background:rgba(200,60,60,0.15); border:1px solid rgba(200,60,60,0.3);
                color:#f88; border-radius:8px; padding:4px 12px; cursor:pointer; font-size:12px;
            ">✕ ${t('controls.cancel')}</button>
        `;
        bar.style.display = 'flex';
        document.getElementById('ghost-confirm')?.addEventListener('click', confirmGhost);
        document.getElementById('ghost-cancel')?.addEventListener('click', () => {
            removeGhost();
            world._pendingSymbol = null;
            document.getElementById('canvas-wrap')?.classList.remove('placing');
            hideGhostUI();
        });
    }

    function hideGhostUI() {
        const bar = document.getElementById('ghost-bar');
        if (bar) bar.style.display = 'none';
    }

    // Exponer showGhost para que initUI lo llame al elegir elemento
    state._showGhost  = showGhost;
    state._showGhostUI = showGhostUI;

    // ── Eventos ───────────────────────────────────────────────────────────
    qr.renderer.domElement.addEventListener('click', e => {
        if (_ghost) return;   // en modo fantasma no seleccionar
        const atom = atomAt(e);
        if (atom) {
            if (!state.multiSelect && state.focusedAtom?.id === atom.id) clearSel();
            else selectAtom(atom);
        } else if (world._pendingSymbol) {
            // Fallback tap directo si no hay fantasma activo
            const p = _getWorldPos(e, qr);
            world.addAtom(world._pendingSymbol, p)
                .then(a => DevConsole.log(`+ ${a.symbol} @ (${p.x.toFixed(0)},${p.y.toFixed(0)},${p.z.toFixed(0)}) wu`))
                .catch(err => DevConsole.error(err.message));
            world._pendingSymbol = null;
            document.getElementById('canvas-wrap')?.classList.remove('placing');
        } else {
            clearSel();
        }
    });

    qr.renderer.domElement.addEventListener('dblclick', e => {
        const atom = atomAt(e);
        if (atom) {
            removeBox(atom.id);
            state.selection.delete(atom.id);
            pool.onAtomRemoved(atom.id);
            world.removeAtom(atom.id);
            if (state.focusedAtom?.id === atom.id) {
                state.focusedAtom = null;
                joystick?.setAtom(null);
                hideQuantumPanel(); hideToolPanel();
            }
        }
    });

    qr.renderer.domElement.addEventListener('touchend', e => {
        const now  = Date.now();
        const atom = atomAt(e);
        if (now - last < 300) {
            if (atom) {
                removeBox(atom.id);
                state.selection.delete(atom.id);
                pool.onAtomRemoved(atom.id);
                world.removeAtom(atom.id);
                if (state.focusedAtom?.id === atom.id) {
                    state.focusedAtom = null;
                    joystick?.setAtom(null);
                    hideQuantumPanel(); hideToolPanel();
                }
            }
        } else if (!atom && world._pendingSymbol && !_ghost) {
            const p = _getWorldPos(e, qr);
            world.addAtom(world._pendingSymbol, p).catch(err => DevConsole.error(err.message));
            world._pendingSymbol = null;
            document.getElementById('canvas-wrap')?.classList.remove('placing');
            e.preventDefault();
        }
        last = now;
    });
}

function showToolPanel(state, world) {
    window._showToolPanel = () => showToolPanel(state, world);
    let panel = document.getElementById('tool-panel');
    if (!panel) {
        panel = document.createElement('div');
        panel.id = 'tool-panel';
        panel.style.cssText = `
            position:fixed; left:0; top:50%; transform:translateY(-50%);
            background:rgba(8,14,30,0.88); border:1px solid rgba(255,255,255,0.1);
            border-radius:0 12px 12px 0; padding:8px 6px;
            display:flex; flex-direction:column; gap:6px;
            z-index:20; backdrop-filter:blur(8px); -webkit-backdrop-filter:blur(8px);
        `;
        document.body.appendChild(panel);
    }

    panel.innerHTML = '';
    const count = state.selection.size;

    const mkBtn = (icon, label, id, danger = false) => {
        const b = document.createElement('button');
        b.id = id; b.title = label;
        b.style.cssText = `
            width:40px; height:40px; border-radius:8px; border:none; cursor:pointer;
            background:${danger ? 'rgba(220,60,60,0.15)' : 'rgba(255,255,255,0.06)'};
            color:${danger ? '#f87' : 'rgba(255,255,255,0.7)'};
            font-size:18px; display:flex; align-items:center; justify-content:center;
            transition:background 0.15s;
        `;
        b.textContent = icon;
        b.addEventListener('pointerover', () => b.style.background = danger ? 'rgba(220,60,60,0.3)' : 'rgba(255,255,255,0.14)');
        b.addEventListener('pointerout',  () => b.style.background = danger ? 'rgba(220,60,60,0.15)' : 'rgba(255,255,255,0.06)');
        return b;
    };

    // Sensores de enlace toggle — punto verde encendido/apagado
    // Controla _cageSensorsEnabled independiente de design/sim mode
    if (world._cageSensorsEnabled === undefined) world._cageSensorsEnabled = world._designMode ?? true;
    const cageOn = world._cageSensorsEnabled;
    const btnCage = mkBtn(cageOn ? '🟢' : '⚫', 'Sensores de enlace', 'tool-cage');
    if (cageOn) btnCage.style.background = 'rgba(0,220,120,0.12)';
    btnCage.addEventListener('click', () => {
        world._cageSensorsEnabled = !world._cageSensorsEnabled;
        // En diseño: toggle visibilidad directa de todas las cages
        if (world._designMode) {
            for (const a of world.atoms.values()) {
                a.setCageVisible(world._cageSensorsEnabled);
            }
        }
        showToolPanel(state, world); // re-render para actualizar el ícono
    });

    // Multiselect toggle
    const btnMulti = mkBtn('⊕', 'Selección múltiple', 'tool-multi');
    if (state.multiSelect) btnMulti.style.background = 'rgba(100,180,255,0.2)';
    btnMulti.addEventListener('click', () => {
        state.multiSelect = !state.multiSelect;
        showToolPanel(state, world);
    });

    // Borrar
    const btnDel = mkBtn('🗑', 'Borrar', 'tool-del', true);
    btnDel.addEventListener('click', () => state._deleteSelected?.());

    // Enlazar — solo si hay exactamente 2 seleccionados
    if (count === 2) {
        const btnBond = mkBtn('🔗', 'Enlazar', 'tool-bond');
        btnBond.addEventListener('click', () => {
            const [id1, id2] = [...state.selection];
            const a1 = world?.atoms.get(id1);
            const a2 = world?.atoms.get(id2);
            if (a1 && a2 && world.addBond) {
                world.addBond(a1, a2);
                DevConsole.log(`Bond: ${a1.symbol}–${a2.symbol}`);
            }
        });
        panel.appendChild(btnBond);
    }

    // ⚛ Calcular MO — solo en modo molécula con selección activa
    if (state.selectMode === 'molecule' && count > 0) {
        const btnMO = mkBtn('⚛', 'Calcular Orbital Molecular', 'tool-mo');
        btnMO.style.color   = '#00ffff';
        btnMO.style.fontSize = '16px';
        btnMO.addEventListener('click', () => {
            // TODO: lanzar BondCloud para la molécula seleccionada
            DevConsole.log('[MO] Calculando orbital molecular...');
        });
        panel.appendChild(btnMO);
    }

    panel.appendChild(btnCage);
    panel.appendChild(btnMulti);
    panel.appendChild(btnDel);

    // ☢ Nuclear Tuner — solo visible en LOD nuclear
    if (_mainQR?._lodState === 'nuclear') {
        const btnNuclear = mkBtn('☢', 'Nuclear Tuner', 'tool-nuclear');
        btnNuclear.style.cssText += 'color:#0ff;';
        btnNuclear.addEventListener('click', () => {
            const p = document.getElementById('nuclear-tuner-panel');
            if (p) p.classList.toggle('hidden');
        });
        panel.appendChild(btnNuclear);
    }

    panel.style.display = 'flex';
}

function hideToolPanel() {
    const p = document.getElementById('tool-panel');
    if (p) p.style.display = 'none';
}

// ── QR embebido en el panel quantum ──────────────────────────────────────────
// Singleton lazy — se crea la primera vez que se abre el panel
let _panelSym        = null;  // símbolo actualmente mostrado en el panel
let _mainQR          = null;
let _pool            = null;  // referencia al pool — se asigna en init()

// ── Cargar SVG de Bohr en el panel ───────────────────────────────────────────
const BOHR_VIEWS  = ['', '_classic', '_orbital'];
const BOHR_LABELS = ['Subshells', 'Clásico', 'Orbitales'];
let _bohrViewIdx  = 0;

function _loadBohrSvg(sym) {
    const obj   = document.getElementById('qvBohrSvg');
    const ph    = document.getElementById('qvBohrPlaceholder');
    const nav   = document.getElementById('qvBohrNav');
    const label = document.getElementById('qvBohrLabel');
    if (!obj) return;
    const suffix = BOHR_VIEWS[_bohrViewIdx];
    obj.data         = `src/bohr/${sym}${suffix}.svg`;
    obj.style.display = 'block';
    if (ph)    ph.style.display    = 'none';
    if (nav)   nav.style.display   = 'flex';
    if (label) label.textContent   = BOHR_LABELS[_bohrViewIdx];
}

function _initBohrNav() {
    const prev = document.getElementById('qvBohrPrev');
    const next = document.getElementById('qvBohrNext');
    if (!prev || next?._navInit) return;
    next._navInit = true;
    prev.addEventListener('click', () => {
        _bohrViewIdx = (_bohrViewIdx - 1 + BOHR_VIEWS.length) % BOHR_VIEWS.length;
        if (_panelSym) _loadBohrSvg(_panelSym);
    });
    next.addEventListener('click', () => {
        _bohrViewIdx = (_bohrViewIdx + 1) % BOHR_VIEWS.length;
        if (_panelSym) _loadBohrSvg(_panelSym);
    });
}

// ── Aplicar acción a todos los QRs del pool que tienen el símbolo activo ─────
function _forEachPoolQR(sym, fn) {
    if (!_pool) return;
    if (_pool._loadedSym  === sym && _pool._qr)  fn(_pool._qr);
    if (_pool._loadedSym2 === sym && _pool._qr2) fn(_pool._qr2);
    if (_pool._loadedSym3 === sym && _pool._qr3) fn(_pool._qr3);
}

// ── Resaltar shell en el SVG de Bohr ─────────────────────────────────────────
function _highlightBohrShell(shellIndex, visible) {
    const obj = document.getElementById('qvBohrSvg');
    if (!obj) return;
    try {
        const svgDoc = obj.contentDocument;
        if (!svgDoc) return;
        const shell = svgDoc.getElementById(`shell-${shellIndex}`);
        if (!shell) return;
        shell.style.opacity = visible ? '1' : '0.1';
    } catch (e) { /* cross-origin o no cargado aún */ }
}

// ── Helper para asegurar que existe un perfil de sesión para el símbolo ──────
function _ensureProfile(sym) {
    if (!_elementProfiles.has(sym)) _elementProfiles.set(sym, { element: sym });
    return _elementProfiles.get(sym);
}

// ── Construir lista de layers del panel usando LayerPanel compartido ──────────
// pool se pasa como parámetro porque esta función vive fuera de init()
async function _buildPanelLayerList(sym) {
    const list = document.getElementById('qvLayerList');
    if (!list) return;

    // Obtener QR que tiene este símbolo
    let qr = null;
    if (_pool._loadedSym  === sym) qr = _pool._qr;
    if (_pool._loadedSym2 === sym) qr = _pool._qr2;
    if (_pool._loadedSym3 === sym) qr = _pool._qr3;

    if (!qr || !qr.getLayerTree?.()) {
        requestAnimationFrame(() => _buildPanelLayerList(sym));
        return;
    }

    buildLayerPanel(qr, list, {
        showSphere: false,
        onLayerChange: (key, vis) => {
            _forEachPoolQR(sym, r => r.setLayerVisible(key, vis));
            _ensureProfile(sym).layers = _ensureProfile(sym).layers ?? {};
            _ensureProfile(sym).layers[key] = vis;
        },
        onBohrHighlight: (shellIdx, vis) => _highlightBohrShell(shellIdx, vis),
    });
}

function showQuantumPanel(atom) {
    // ── Solo actualiza la pestaña y los datos del panel-right ─────────────
    // El panel NUNCA se abre automáticamente — solo con click en la pestaña

    // Pestaña discreta (siempre visible al seleccionar un átomo)
    let tab = document.getElementById('qv-tab');
    if (!tab) {
        tab = document.createElement('div');
        tab.id = 'qv-tab';
        tab.style.cssText = `
            position:fixed; top:56px; right:8px;
            background:rgba(8,14,30,0.82); border:1px solid rgba(255,255,255,0.12);
            border-radius:10px; padding:5px 10px; min-width:60px;
            z-index:160; backdrop-filter:blur(8px); -webkit-backdrop-filter:blur(8px);
            font-size:12px; color:rgba(255,255,255,0.75); line-height:1.5;
            cursor:pointer; user-select:none; -webkit-user-select:none;
            transition:border-color 0.2s, background 0.2s;
        `;
        tab.title = t('tooltips.quantum_view');
        tab.addEventListener('click', () => {
            const panel = document.getElementById('panel-right');
            if (!panel) return;
            panel.classList.toggle('hidden');
            const open = !panel.classList.contains('hidden');
            tab.style.borderColor = open ? 'rgba(79,195,247,0.5)' : 'rgba(255,255,255,0.12)';
            tab.style.background  = open ? 'rgba(79,195,247,0.12)' : 'rgba(8,14,30,0.82)';
            const arr = tab.querySelector('.qv-tab-arr');
            if (arr) arr.textContent = open ? '◀' : '▶';

            // Cargar SVG de Bohr y layers al abrir
            if (open && tab._atom) {
                const sym = tab._atom.symbol;
                _panelSym    = sym;
                _bohrViewIdx = 0;
                _loadBohrSvg(sym);
                _initBohrNav();
                requestAnimationFrame(() => _buildPanelLayerList(sym));
            }
        });
        document.body.appendChild(tab);
    }

    const nameStr = getLanguage() === 'en'
        ? (atom.meta?.name_eng || atom.elementData?.identity?.name_eng || atom.symbol)
        : (atom.meta?.name_es  || atom.elementData?.identity?.name_es  || atom.symbol);

    tab.innerHTML = `
        <div style="display:flex;align-items:center;gap:5px">
            <span style="font-size:15px;font-weight:bold;color:var(--accent,#4fc3f7)">${atom.symbol}</span>
            <span class="qv-tab-arr" style="font-size:9px;color:rgba(255,255,255,0.35)">▶</span>
        </div>
        <div style="font-size:10px;color:rgba(255,255,255,0.4)">${nameStr}</div>
    `;
    tab.style.display = 'block';
    tab._atom = atom; // guardar ref para el click

    // Si el panel está abierto y cambió el elemento — recargar SVG y layers
    const panel = document.getElementById('panel-right');
    if (panel && !panel.classList.contains('hidden') && _panelSym !== atom.symbol) {
        _panelSym = atom.symbol;
        _loadBohrSvg(atom.symbol);
        requestAnimationFrame(() => _buildPanelLayerList(atom.symbol));
    }

    // Actualizar los campos del panel-right existente (el QuantumView real del HTML)
    const sym  = document.getElementById('qvSymbol');
    const name = document.getElementById('qvName');
    const cfg  = document.getElementById('qvConfig');
    if (sym)  sym.textContent  = atom.symbol || '—';
    if (name) name.textContent = nameStr;
    if (cfg)  cfg.textContent  = atom.elementData?.atomic_structure?.electron_configuration_text || '';

    // El panel-right permanece en su estado actual (abierto o cerrado) — no se toca
}

function hideQuantumPanel() {
    // Al deseleccionar: cerrar panel-right si estaba abierto, y ocultar pestaña
    document.getElementById('panel-right')?.classList.add('hidden');
    const tab = document.getElementById('qv-tab');
    if (tab) {
        tab.style.display = 'none';
        tab.style.borderColor = 'rgba(255,255,255,0.12)';
        tab.style.background  = 'rgba(8,14,30,0.82)';
    }
}

function initUI(world, state, joystick) {
    const panelLeft = document.getElementById('panel-left');
    const elemSel   = document.getElementById('elementSelector');
    const addPanel  = document.getElementById('addPanel');

    function togglePanel(el, btn) {
        const open = !el.classList.contains('hidden');
        [panelLeft, elemSel, addPanel].forEach(p => p?.classList.add('hidden'));
        document.querySelectorAll('.dock-btn').forEach(b => b.classList.remove('active'));
        if (!open) { el.classList.remove('hidden'); btn?.classList.add('active'); }
    }

    document.getElementById('dockPhysics')?.  addEventListener('click', e => togglePanel(panelLeft, e.currentTarget));
    document.getElementById('dockElements')?.  addEventListener('click', e => togglePanel(elemSel,   e.currentTarget));
    document.getElementById('dockAdd')?.       addEventListener('click', e => togglePanel(addPanel,  e.currentTarget));

    document.querySelectorAll('.sptab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.sptab').forEach(t => t.classList.remove('sptab--active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.add('tab-content--hidden'));
            tab.classList.add('sptab--active');
            document.getElementById(`tab-${tab.dataset.tab}`)?.classList.remove('tab-content--hidden');
        });
    });

    document.querySelectorAll('.mode-toggle__btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const newMode = btn.dataset.mode;
            document.body.dataset.mode = newMode;
            document.querySelectorAll('.mode-toggle__btn').forEach(b =>
                b.classList.toggle('mode-toggle__btn--active', b.dataset.mode === newMode));

            const isDesign = newMode === 'design';
            if (newMode === 'sim') {
                world.setRunning(true);
                world.setDesignMode(false);
                DevConsole.sys('▶️ Modo Simulación — física activa');
            } else {
                world.setRunning(false);
                world.setDesignMode(true);
                DevConsole.sys('🔧 Modo Diseño — física pausada');
            }
            // El joystick NO se toca — sigue la selección, no el modo
        });
    });

    document.getElementById('closeQV')?.addEventListener('click', hideQuantumPanel);

    document.getElementById('fullscreenBtn')?.addEventListener('click', () => {
        if (!document.fullscreenElement)
            (document.documentElement.requestFullscreen?.() || document.documentElement.webkitRequestFullscreen?.())?.catch(() => {});
        else
            document.exitFullscreen?.();
    });

    document.getElementById('collapseGroups')?.addEventListener('click', () =>
        document.getElementById('groupPanel')?.classList.toggle('hidden'));

    ['showMolecules','showCrystals','showSnowflake'].forEach((id, i) => {
        const keys = ['molecules','crystals','snowflake'];
        document.getElementById(id)?.addEventListener('click', e => {
            ['moleculesSection','crystalsSection','snowflakeSection'].forEach(s =>
                document.getElementById(s)?.classList.add('hidden'));
            document.getElementById(keys[i] + 'Section')?.classList.remove('hidden');
            document.querySelectorAll('#addPanel .seg-btn').forEach(b => b.classList.remove('seg-btn--active'));
            e.currentTarget.classList.add('seg-btn--active');
        });
    });

    ElementSelector.init();
    GroupPanel.init();

    document.addEventListener('element:selected', e => {
        world._pendingSymbol = e.detail.symbol;
        document.getElementById('canvas-wrap')?.classList.add('placing');
        DevConsole.log(`Elemento: ${e.detail.symbol} — posiciona con el joystick y confirma`);
        // Activar fantasma de colocación si está disponible
        if (state._showGhost) {
            state._showGhost(e.detail.symbol);
            state._showGhostUI?.(e.detail.symbol);
        }
    });

    document.getElementById('forceReloadBtn')?.addEventListener('click', () => {
        if ('caches' in window)
            caches.keys().then(ns => Promise.all(ns.map(n => caches.delete(n)))).then(() => location.reload(true));
        else location.reload(true);
    });

    // Botón copiar consola — se inyecta en .dev-console__actions
    requestAnimationFrame(() => {
        const actions = document.querySelector('.dev-console__actions');
        if (actions && !actions.querySelector('.dev-console__copy-btn')) {
            const btn = document.createElement('button');
            btn.className = 'dev-console__copy-btn';
            btn.textContent = '⎘ ' + t('console.copy');
            btn.addEventListener('click', () => {
                const log = document.querySelector('.dev-console__log');
                if (!log) return;
                navigator.clipboard?.writeText(log.innerText || log.textContent)
                    .then(() => { btn.textContent = '✓'; setTimeout(() => btn.textContent = '⎘ ' + t('console.copy'), 1500); });
            });
            actions.prepend(btn);
        }
    });
    DevConsole.sys('UI ✅');
}

// ── Init ────────────────────────────────────────────────────────────────────

async function init() {
    try {
        DevConsole.init();
        DevConsole.interceptConsole();

        await initI18n();
        updateDOM();
        SessionSetup.set(t('app.loading'), '', 10);

        // ── QuantumRenderer standalone — motor gráfico completo ──────────────
        SessionSetup.set(t('app.loading'), 'Renderer y escena', 20);
        const container = document.getElementById('canvas-wrap') ?? document.body;
        const qr = new QuantumRenderer(container, {
            externalLoop: true,
            enablePan:    true,
            background:   0x0a1628,
        });
        await qr.init();
        _mainQR = qr;  // referencia global para el panel QV embebido
        
        window._mainQR = qr;  // exponer para Nuclear Tuner (index2)

        // Ajustar cámara inicial para el workspace del simulador
        qr.camera.position.set(0, 800, 2000);
        qr.camera.lookAt(0, FLOOR_Y + 200, 0);
        // Target frente a la cámara para que girar sea look-around
        { const d=new THREE.Vector3(); qr.camera.getWorldDirection(d);
          qr.controls.target.copy(qr.camera.position).addScaledVector(d,1);
          qr.controls.update(); }
        DevConsole.sys('QuantumRenderer ✅');

        // ── Piso + luces en la escena del QR ─────────────────────────────────
        SessionSetup.set(t('app.loading'), 'Escena', 40);
        addFloor(qr.scene);
        addLights(qr.scene);
        qr.scene.fog = new THREE.FogExp2(0x0a1628, 0.00028); // mismo tono que background — horizonte se disuelve suave

        // ── World ─────────────────────────────────────────────────────────────
        SessionSetup.set(t('app.loading'), 'elements-index.json', 55);
        const world = new World(qr.scene, qr);
        await world.init();
        world.setRunning(false);  // Modo Diseño por defecto — física pausada hasta ▶️
        world.setDesignMode(true);
        DevConsole.sys(`World ✅ — ${world.elements?.size ?? '?'} elementos`);

        // ── UI ────────────────────────────────────────────────────────────────
        SessionSetup.set(t('app.loading'), 'UI', 75);
        const state = { focusedAtom: null, selection: new Set(), multiSelect: false, selectMode: 'atom' };

        // ── Pool de instancias QR por símbolo ─────────────────────────────────
        const pool = new QuantumRendererPool(qr);
        _pool = pool;  // exponer al scope de módulo para funciones del panel QV
        pool.initSecondary().catch(err => DevConsole.warn('Pool QR2: ' + err.message));
        pool.initTertiary().catch(err => DevConsole.warn('Pool QR3: ' + err.message));

        // ── Joystick FPS — crear antes de initRaycaster para pasarlo ──────────
        const joystick = new FPSJoystick(qr.camera, qr.controls);

        // Modo look-around: re-anclar target frente a la cámara al soltar el drag.
        // SOLO en rotación (1 dedo / botón izq) — nunca en pinch, pan o rueda.
        // Sin este guard, OrbitControls reposicionaba el target a 1wu en cualquier
        // gesto, causando zoom involuntario al soltar el touch.
        let _wasRotating = false;
        qr.controls.addEventListener('start', () => {
            // OrbitControls.state: 0=ROTATE, 1=DOLLY, 2=PAN
            _wasRotating = (qr.controls.state === 0);
        });
        qr.controls.addEventListener('end', () => {
            if (!state.focusedAtom && _wasRotating) {
                const dir = new THREE.Vector3();
                qr.camera.getWorldDirection(dir);
                qr.controls.target.copy(qr.camera.position).addScaledVector(dir, 1);
                qr.controls.update();
            }
            _wasRotating = false;
        });

        initRaycaster(qr, world, state, pool, joystick);
        initUI(world, state, joystick);
        PhysicsPanel.init(world, qr);
        AddPanel.init(world, qr).catch(err => DevConsole.warn('AddPanel: ' + err.message));

        // ── Mode toggle: ⚛ átomos / ⬡ moléculas ─────────────────────────────
        const modeAtomBtn = document.getElementById('modeAtom');
        const modeMolBtn  = document.getElementById('modeMolecule');

        function setSelectMode(mode) {
            state.selectMode = mode;
            modeAtomBtn?.classList.toggle('hstat--active', mode === 'atom');
            modeMolBtn?.classList.toggle('hstat--active', mode === 'molecule');
            // Estilo visual del modo activo
            if (modeAtomBtn) modeAtomBtn.style.borderBottom = mode === 'atom' ? '2px solid #29b6f6' : 'none';
            if (modeMolBtn)  modeMolBtn.style.borderBottom  = mode === 'molecule' ? '2px solid #29b6f6' : 'none';
            DevConsole.sys(`Modo: ${mode === 'atom' ? '⚛ Átomos' : '⬡ Moléculas'}`);
        }

        modeAtomBtn?.addEventListener('click', () => setSelectMode('atom'));
        modeMolBtn?.addEventListener('click', () => setSelectMode('molecule'));

        // Hacer clickeables con cursor pointer
        if (modeAtomBtn) modeAtomBtn.style.cursor = 'pointer';
        if (modeMolBtn)  modeMolBtn.style.cursor = 'pointer';
        setSelectMode('atom'); // default

        // ── SoundEngine — Lenguaje Sonoro de Materia ─────────────────────────
        SoundEngine.init(world, qr.camera, { radius: pool.activeRadius });
        // Bond flash sonoro — callback desde World.addBond
        world._onBondCreated = (a, b) => SoundEngine.bondFlash(a, b);
        // Activar con primer gesto (requerido por navegadores)
        const _activateAudio = () => {
            SoundEngine.enable();
            document.removeEventListener('touchstart', _activateAudio);
            document.removeEventListener('click', _activateAudio);
        };
        document.addEventListener('touchstart', _activateAudio, { once: true });
        document.addEventListener('click', _activateAudio, { once: true });
        // Botón mute
        const soundBtn = document.getElementById('soundBtn');
        soundBtn?.addEventListener('click', () => {
            const muted = SoundEngine.toggleMute();
            if (soundBtn) soundBtn.textContent = muted ? '🔇' : '🎧';
        });

        // Botón Raw Mode — shader puro sin bloom
        const rawBtn = document.getElementById('rawModeBtn');
        rawBtn?.addEventListener('click', () => {
            const raw = !qr.rawMode;
            qr.setRawMode(raw);
            if (rawBtn) rawBtn.textContent = raw ? '✨' : '💎';
            DevConsole.sys(`Modo ${raw ? '💎 Raw (shader puro)' : '✨ Bloom ON'}`);
        });

        // ── Tutorial hint — solo primera sesión, fade out a los 30s ──────────
        const hint = document.getElementById('canvasHint');
        if (hint) {
            if (localStorage.getItem('qcs_hint_shown')) {
                hint.style.display = 'none';
            } else {
                setTimeout(() => {
                    hint.classList.add('faded');
                    setTimeout(() => {
                        hint.style.display = 'none';
                        localStorage.setItem('qcs_hint_shown', '1');
                    }, 1500);
                }, 30000);
            }
        }

        // ── Gesture Control — 🖐️ mano vía webcam ─────────────────────────
        const gesture = new GestureIntegration(qr, world, state);
        const gestureBtn = document.getElementById('gestureBtn');
        gestureBtn?.addEventListener('click', async () => {
            const active = await gesture.toggle();
            if (gestureBtn) gestureBtn.textContent = active ? '🖐️' : '✋';
            DevConsole.sys(`Gestos ${active ? '✅ ON' : '⏹ OFF'}`);
        });

        // ── LOD Toggle — activa/desactiva orbitales en escena ─────────────
        const lodBtn = document.getElementById('lodBtn');
        if (lodBtn) {
            lodBtn.classList.add('active'); // ON por defecto
            lodBtn.addEventListener('click', () => {
                pool.enabled = !pool.enabled;
                lodBtn.classList.toggle('active', pool.enabled);
                DevConsole.sys(`LOD Orbitales ${pool.enabled ? '✅ ON' : '⏹ OFF'}`);
            });
        }

        // ── Panel QV — perfiles por elemento ─────────────────────────────
        // _elementProfiles: symbol → profile JSON cargado por el usuario.
        // Se aplica automáticamente cuando el pool carga ese elemento,
        // y al abrir el panel para ese átomo.
        const _elementProfiles = new Map();

        function _applyProfileToQR(profile, targetQR) {
            if (!targetQR || !profile) return;

            // Tuning y visibilidad — sin costo GPU, aplicar inmediatamente
            const global = profile.tuning?.global ?? {};
            for (const [key, val] of Object.entries(global)) {
                if (val != null) targetQR.setTuning(key, val, 'all');
            }
            const perOrb = profile.tuning?.perOrbital ?? {};
            for (const [orbKey, params] of Object.entries(perOrb)) {
                for (const [param, val] of Object.entries(params)) {
                    targetQR.setTuning(param, val, orbKey);
                }
            }
            const layersVis = profile.layers?.layers ?? {};
            for (const [layer, vis] of Object.entries(layersVis)) {
                targetQR.setLayerVisible?.(layer, vis);
            }

            // Materiales — recompilan shaders en GPU, uno por frame para evitar freeze
            const mats = Object.entries(profile.materials ?? {})
                .filter(([, preset]) => preset?.compiled?.vert);
            if (!mats.length) return;

            let i = 0;
            function applyNext() {
                if (i >= mats.length) return;
                const [layer, preset] = mats[i++];
                targetQR.loadShaderJSON(preset, layer);
                requestAnimationFrame(applyNext);
            }
            requestAnimationFrame(applyNext);
        }

        // Aplicar perfil guardado cuando el pool carga un elemento
        pool.onElementLoaded = (symbol, targetQR) => {
            const p = _elementProfiles.get(symbol);
            if (p) { _applyProfileToQR(p, targetQR); DevConsole.log(`[QV] Perfil aplicado en pool: ${symbol}`); }
        };
        pool.onSecondaryLoaded = (symbol, targetQR) => {
            const p = _elementProfiles.get(symbol);
            if (p) _applyProfileToQR(p, targetQR);
        };

        // Botón cargar perfil
        const qvLoadBtn   = document.getElementById('qvLoadProfile');
        const qvFileInput = document.getElementById('qvProfileInput');
        qvLoadBtn?.addEventListener('click', () => qvFileInput?.click());
        qvFileInput?.addEventListener('change', async e => {
            const file = e.target.files[0];
            if (!file) return;
            try {
                const profile = JSON.parse(await file.text());
                const sym = profile.element ?? _panelSym;
                if (!sym) { alert(t('messages.profile_no_element')); return; }
                _elementProfiles.set(sym, profile);
                // Aplicar a todos los QRs del pool que tienen este símbolo
                _forEachPoolQR(sym, qr => _applyProfileToQR(profile, qr));
                // Reconstruir lista de layers si el panel muestra este elemento
                if (_panelSym === sym) requestAnimationFrame(() => _buildPanelLayerList(sym));
                DevConsole.sys(`[QV] Perfil '${profile.name ?? sym}' cargado para ${sym}`);
                if (qvLoadBtn) { qvLoadBtn.textContent = t('quantum.profile_loaded'); setTimeout(() => { qvLoadBtn.textContent = '📂 ' + t('library.load'); }, 1500); }
            } catch (err) { alert(t('messages.profile_read_error') + ': ' + err.message); }
            e.target.value = '';
        });

        // Toggle de esfera en el panel QV — no aplica en el nuevo diseño sin renderer
        // El checkbox de esfera se deja como referencia visual pero no hace nada
        const qvSphereToggle = document.getElementById('qvSphereToggle');
        if (qvSphereToggle) {
            qvSphereToggle.checked = false;
            qvSphereToggle.addEventListener('change', () => {
                if (!_panelSym) return;
                _forEachPoolQR(_panelSym, qr => {
                    if (qvSphereToggle.checked) qr.showSphere?.();
                    else { qr._lodFade = 0; qr._orbitFade = 1; qr._applyFades?.(); }
                });
            });
        }

        // Sliders — afectan directamente todos los QRs del pool con el símbolo activo
        document.getElementById('qvBrightness')?.addEventListener('input', e => {
            const v = parseFloat(e.target.value);
            const el = document.getElementById('qvBrightnessVal');
            if (el) el.textContent = v.toFixed(1);
            if (!_panelSym) return;
            _forEachPoolQR(_panelSym, qr => qr.setTuning('bright', v, 'all'));
            _ensureProfile(_panelSym).tuning = _ensureProfile(_panelSym).tuning ?? {};
            _ensureProfile(_panelSym).tuning.global = { ..._ensureProfile(_panelSym).tuning.global, bright: v };
        });

        document.getElementById('qvPtSize')?.addEventListener('input', e => {
            const v = parseFloat(e.target.value);
            const el = document.getElementById('qvPtSizeVal');
            if (el) el.textContent = v.toFixed(1);
            if (!_panelSym) return;
            _forEachPoolQR(_panelSym, qr => qr.setTuning('size', v, 'all'));
            _ensureProfile(_panelSym).tuning = _ensureProfile(_panelSym).tuning ?? {};
            _ensureProfile(_panelSym).tuning.global = { ..._ensureProfile(_panelSym).tuning.global, size: v };
        });
        window.QSim = { world, qr, pool, joystick, DevConsole, SoundEngine, gesture };
        DevConsole.sys('window.QSim ✅');
        SessionSetup.set(t('app.ready'), '', 100);

        // ── Viñeta cuántica — shader en overlay canvas 2D ─────────────────────
        const vigCanvas = document.createElement('canvas');
        vigCanvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:10;';
        document.body.appendChild(vigCanvas);
        const vigCtx = vigCanvas.getContext('2d');
        let vigAlpha = 0.0;   // 0 = invisible, 1 = máximo
        let vigTarget = 0.0;

        function resizeVig() {
            vigCanvas.width  = window.innerWidth;
            vigCanvas.height = window.innerHeight;
        }
        resizeVig();
        window.addEventListener('resize', resizeVig);

        function drawVignette(alpha) {
            if (alpha < 0.005) { vigCtx.clearRect(0, 0, vigCanvas.width, vigCanvas.height); return; }
            const w = vigCanvas.width, h = vigCanvas.height;
            const cx = w / 2, cy = h / 2;
            const r  = Math.max(w, h) * 0.5;
            vigCtx.clearRect(0, 0, w, h);
            const grad = vigCtx.createRadialGradient(cx, cy, r * (0.3 - alpha * 0.15), cx, cy, r);
            grad.addColorStop(0,   `rgba(0,0,0,0)`);
            grad.addColorStop(0.5, `rgba(0,4,16,${alpha * 0.55})`);
            grad.addColorStop(1,   `rgba(0,2,10,${alpha * 0.92})`);
            vigCtx.fillStyle = grad;
            vigCtx.fillRect(0, 0, w, h);
        }

        // ── Loop externo ──────────────────────────────────────────────────────
        const timer = new THREE.Timer();
        qr.renderer.setAnimationLoop(() => {
            timer.update();
            const elapsed = timer.getElapsed();
            const dt      = Math.min(timer.getDelta?.() ?? (1 / 60), 0.05);

            // Física solo en modo Simulación
            if (document.body.dataset.mode === 'sim') {
                world.update(dt);
            } else {
                // En Diseño: sincronizar meshes + rebuildar grid para cage detection
                world.syncMeshes();
                world._rebuildGrid();
            }

            // ── Cage detection — corre en AMBOS modos ────────────────────
            // Usa SpatialHashGrid para O(N) en vez de O(N²)
            if (world._cageSensorsEnabled) {
                for (const atom of world.atoms.values()) {
                    if (!atom._cagePts) continue;
                    const nearby = world.grid.getNearby(atom.position);
                    let closestDist = Infinity;
                    let cx = 0, cy = 0, cz = 0;
                    for (const other of nearby) {
                        if (other === atom) continue;
                        const dx = other.position.x - atom.position.x;
                        const dy = other.position.y - atom.position.y;
                        const dz = other.position.z - atom.position.z;
                        const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
                        if (dist < closestDist) {
                            closestDist = dist;
                            cx = dx; cy = dy; cz = dz;
                        }
                    }
                    const detecting = closestDist < atom.radius * 8 && closestDist < Infinity;
                    if (detecting) {
                        const len = Math.sqrt(cx*cx + cy*cy + cz*cz);
                        _cageDir.set(cx/len, cy/len, cz/len);
                        atom.setActiveCagePoint(_cageDir);
                        if (!world._designMode) atom._cagePts.visible = true;
                    } else {
                        atom.clearActiveCagePoint();
                        if (!world._designMode) atom._cagePts.visible = false;
                    }
                }
            } else if (!world._designMode) {
                for (const atom of world.atoms.values()) {
                    if (atom._cagePts) atom._cagePts.visible = false;
                }
            }
            PhysicsPanel.tick(dt);
            joystick.update(dt);

            // ── Sync proxy molecular — mover grupo completo ─────────────
            if (joystick._atom?._isMoleculeProxy) {
                const proxy = joystick._atom;
                _proxyDelta.subVectors(proxy.position, proxy._lastPos);
                if (_proxyDelta.lengthSq() > 0.001) {
                    for (const a of proxy._atoms) {
                        a.position.add(_proxyDelta);
                        a.velocity.set(0, 0, 0);
                    }
                    proxy._lastPos.copy(proxy.position);
                }
            }

            // ── LOD por proximidad de cámara — sin click ───────────────────
            const camPos  = qr.camera.position;
            const nearby  = world.getAtomsInRadius(camPos, pool.activeRadius);
            pool.tick(nearby, elapsed, dt).catch(err => DevConsole.warn('Pool: ' + err.message));

            // ── Sonido atómico — LOD sonoro con mismos nearby ────────────
            SoundEngine.tick(nearby);

            // ── Viñeta cuántica ───────────────────────────────────────────
            // Se activa suavemente cuando la cámara entra en el radio cuántico
            vigTarget = nearby.length > 0
                ? Math.min(1.0, nearby[0].dist < 80 ? 1.0 : (QUANTUM_RADIUS - nearby[0].dist) / QUANTUM_RADIUS)
                : 0.0;
            vigAlpha += (vigTarget - vigAlpha) * Math.min(dt * 1.5, 1);
            drawVignette(vigAlpha);

            qr.tick(elapsed, dt);

            // Panel QV tiene su propio loop interno — solo cargar elemento
            
        });

        DevConsole.sys('▶ Loop activo');

        // ── Config ────────────────────────────────────────────────────────────
        const { lang, quality } = await SessionSetup.show();
        DevConsole.sys(`lang=${lang} quality=${quality}`);
        try {
            const { OrbitalCache } = await import('./src/renderer/OrbitalCache.js');
            OrbitalCache.setResolution(quality);
        } catch { /* opcional */ }
        SessionSetup.done();
        // El usuario ya hizo un gesto (botón Iniciar) — activar audio ahora
        SoundEngine.enable();

    } catch (err) {
        console.error('[App] ❌', err);
        SessionSetup.set('❌ Error al iniciar', err.message, 0);
    }
}

init();
