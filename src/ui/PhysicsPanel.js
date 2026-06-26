/**
 * PhysicsPanel.js — Conecta los paneles de UI con World.js
 *
 * Este módulo da vida a todos los controles del panel izquierdo
 * (Física, Geometría, Lab, Temperatura) y al header de stats.
 *
 * NO crea HTML — todo el HTML ya existe en index.html.
 * Solo conecta eventos de input a world.setParams() y actualiza readouts.
 *
 * Uso:
 *   import { PhysicsPanel } from './src/ui/PhysicsPanel.js';
 *   PhysicsPanel.init(world, qr);
 *
 * En el loop (cada frame):
 *   PhysicsPanel.tick(dt);
 */

import * as THREE from 'three';
import { t } from '../data/i18n.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Busca un elemento, conecta input→callback, y retorna el elemento */
function _wire(id, event, cb) {
    const el = document.getElementById(id);
    if (!el) return null;
    el.addEventListener(event, cb);
    return el;
}

/** Conecta un slider + su label de valor */
function _wireSlider(sliderId, valueId, cb, fmt) {
    const slider = document.getElementById(sliderId);
    const label  = document.getElementById(valueId);
    if (!slider) return null;
    slider.addEventListener('input', () => {
        const v = parseFloat(slider.value);
        if (label) label.textContent = fmt ? fmt(v) : v;
        cb(v);
    });
    return slider;
}

/** Conecta un checkbox → callback(checked) */
function _wireCheck(id, cb) {
    const el = document.getElementById(id);
    if (!el) return null;
    el.addEventListener('change', () => cb(el.checked));
    return el;
}

// ── Estado local ────────────────────────────────────────────────────────────

let _world  = null;
let _qr     = null;
let _scene  = null;

// Elementos de stats del header
let _elAtomCount     = null;
let _elMoleculeCount = null;
let _elBondCount     = null;

// Temperatura
let _tempEnabled    = false;
let _tempTarget     = 300;    // K — objetivo del termostato
let _tempCurrent    = 300;    // K — temperatura actual (lerp)
let _tempTau        = 60;     // velocidad del termostato (frames)
let _tempMode       = 'didactic';  // 'didactic' | 'realistic'
let _tempColorEnabled = true;
let _tempBondBreak    = false;
let _floorTemp        = 0;
let _ceilingTemp      = 0;
let _floorTempEnabled   = false;  // toggle independiente — suelo irradia calor
let _ceilingTempEnabled = false;  // toggle independiente — techo irradia calor
let _sphereTempEnabled  = false;  // toggle independiente — esfera irradia calor
const _tmpSpherePos   = new THREE.Vector3(); // pre-alloc — evita new() en hot path
let _sphereTopTemp    = 0;     // Polo norte de la esfera (arriba) — K
let _sphereBottomTemp = 0;     // Polo sur de la esfera (abajo) — K

// Geometría — contenedores
let _floorMesh   = null;  // referencia al piso que ya existe en la escena
let _ceilingMesh = null;
let _sphereMesh  = null;
let _ceilingEnabled = false;
let _sphereEnabled  = false;

// ── Módulo público ──────────────────────────────────────────────────────────

export const PhysicsPanel = {

    /**
     * Inicializa todas las conexiones UI ↔ World.
     * Llamar una vez después de crear World y QR.
     *
     * @param {import('../core/World.js').World} world
     * @param {import('../renderer/QuantumRenderer.js').QuantumRenderer} qr
     */
    init(world, qr) {
        _world = world;
        _qr    = qr;
        _scene = qr?.scene ?? null;

        // ── Header stats ────────────────────────────────────────────────
        _elAtomCount     = document.getElementById('atomCount');
        _elMoleculeCount = document.getElementById('moleculeCount');
        _elBondCount     = document.getElementById('bondCount');

        // ── TAB FÍSICA ──────────────────────────────────────────────────
        _initPhysicsTab();

        // ── TAB GEOMETRÍA ───────────────────────────────────────────────
        _initGeometryTab();

        // ── TAB LABORATORIO ─────────────────────────────────────────────
        _initLabTab();

        // ── TAB TEMPERATURA ─────────────────────────────────────────────
        _initTemperatureTab();

        // ── Visor óptico (filtro de brillo) ─────────────────────────────
        _initVisor();

        // Nota: la consola (toggle, clear, close, run) la maneja Console.js

        console.log('[PhysicsPanel] ✅ Conectado');
    },

    /**
     * Actualizar cada frame — stats, temperatura, readouts.
     * Llamar desde el animation loop.
     * @param {number} dt — delta time en segundos
     */
    tick(dt) {
        if (!_world) return;

        // ── Stats del header ────────────────────────────────────────────
        _updateStats();

        // ── Sistema de temperatura ──────────────────────────────────────
        if (_tempEnabled) {
            _tickTemperature(dt);
        }
    },

    /** Acceso externo al estado de temperatura */
    get temperature()    { return _tempCurrent; },
    get tempEnabled()    { return _tempEnabled; },
    get tempMode()       { return _tempMode; },
};


// ═══════════════════════════════════════════════════════════════════════════
//  TAB: FÍSICA
// ═══════════════════════════════════════════════════════════════════════════

/** Aplica o revierte el color CPK a un átomo individual */
function _applyCpkToAtom(atom, cpkEnabled) {
    if (!atom.sphereMesh?.material?.uniforms?.uColor) return;
    const colorHex = cpkEnabled
        ? (atom.meta?.cpk_color
            ? parseInt(String(atom.meta.cpk_color).replace('0x', ''), 16)
            : atom._color)
        : atom._color;
    atom.sphereMesh.material.uniforms.uColor.value.setHex(colorHex);
}

function _initPhysicsTab() {

    // Gravedad — toggle + slider
    // La gravedad real (9.807e12 wu/s²) es imperceptible a escala atómica.
    // El toggle la enciende, el slider controla el multiplicador de exageración.
    const gravCheck = document.getElementById('gravityToggle');
    if (gravCheck) {
        gravCheck.checked = _world.params.gravityEnabled;
        gravCheck.addEventListener('change', () => {
            _world.setParams({ gravityEnabled: gravCheck.checked });
        });
    }

    // Slider de multiplicador — rango 0 a 10 (UI), mapeado a 0..1e-10 (real)
    // x1 en slider = 1e-11 de multiplicador → caída suave en ~3s
    // x10 en slider = 1e-10 → caída rápida en ~1s
    _wireSlider('gravitySlider', 'gravityValue', v => {
        // Mapear slider 0-10 a multiplicador 0..1e-10
        const mult = v * 1e-11;
        _world.setParams({ gravityMultiplier: mult });
    }, v => v > 0 ? `x${v}` : 'OFF');

    // Sincronizar slider con el valor actual
    const gs = document.getElementById('gravitySlider');
    if (gs) {
        // Valor inverso: multiplier → slider
        const sliderVal = _world.params.gravityMultiplier / 1e-11;
        gs.value = sliderVal;
        const gv = document.getElementById('gravityValue');
        if (gv) gv.textContent = sliderVal > 0 ? `x${sliderVal}` : 'OFF';
    }

    // Repulsión atómica (Pauli)
    const pauliCheck = document.getElementById('repulsionToggle');
    if (pauliCheck) {
        pauliCheck.checked = _world.params.pauliEnabled;
        pauliCheck.addEventListener('change', () => {
            _world.setParams({ pauliEnabled: pauliCheck.checked });
        });
    }

    // Mostrar enlaces
    const bondsCheck = document.getElementById('bondsToggle');
    if (bondsCheck) {
        bondsCheck.checked = _world.params.bondsVisible;
        bondsCheck.addEventListener('change', () => {
            _world.setBondsVisible(bondsCheck.checked);
        });
    }

    // Ángulos de enlace — XPBD angular post-integración
    const anglesCheck = document.getElementById('bondAnglesToggle');
    if (anglesCheck) {
        anglesCheck.checked = _world.params.bondAnglesEnabled;
        anglesCheck.addEventListener('change', () => {
            _world.setParams({ bondAnglesEnabled: anglesCheck.checked });
        });
    }

    // Lennard-Jones toggle
    _wireCheck('lennardJonesToggle', checked => {
        _world.setParams({ ljEnabled: checked });
    });

    // Modo de física estricto (valencia)
    _wireCheck('strictBondingToggle', checked => {
        _world.setParams({ strictBonding: checked });
    });

    // Modo realista vs pedagógico
    _wireCheck('physicsModeToggle', checked => {
        _world.setParams({ realisticMode: checked });
    });

    // Colores CPK — alterna entre color del material (ShaderLab) y CPK estándar
    _wireCheck('cpkColorToggle', checked => {
        _world.setParams({ cpkColors: checked });
        // Actualizar uColor de todas las esferas visuales en la escena
        for (const atom of _world.atoms.values()) {
            _applyCpkToAtom(atom, checked);
        }
    });

    // Aplicar CPK a átomos que se agreguen mientras el toggle esté activo
    _world._onAtomAdded = (atom) => {
        if (_world.params.cpkColors) _applyCpkToAtom(atom, true);
    };

    // Nubes electrónicas / Mostrar electrones
    _wireCheck('toggleVisualization', checked => {
        _world.setParams({ electronClouds: checked });
    });
    _wireCheck('toggleElectrons', checked => {
        _world.setParams({ showElectrons: checked });
    });
}


// ═══════════════════════════════════════════════════════════════════════════
//  TAB: GEOMETRÍA
// ═══════════════════════════════════════════════════════════════════════════

function _initGeometryTab() {

    // ── Piso ────────────────────────────────────────────────────────────
    const floorCheck = document.getElementById('floorToggle');
    if (floorCheck) {
        floorCheck.checked = _world.params.floorEnabled;
        floorCheck.addEventListener('change', () => {
            _world.setParams({ floorEnabled: floorCheck.checked });
        });
    }

    // Visibilidad del piso (visual, no física)
    _wire('floorVisibilityBtn', 'click', () => {
        _world.params.floorVisible = !_world.params.floorVisible;
        const vis = _world.params.floorVisible;
        // Buscar el piso en la escena y togglear
        _scene?.traverse(obj => {
            if (obj.isMesh && obj.geometry?.type === 'PlaneGeometry' &&
                Math.abs(obj.position.y - _world.params.floorY) < 10) {
                obj.visible = vis;
            }
        });
        // También el grid
        _scene?.traverse(obj => {
            if (obj.isGridHelper) obj.visible = vis;
        });
        const btn = document.getElementById('floorVisibilityBtn');
        if (btn) btn.textContent = vis ? '👁 Visible' : '🚫 Oculto';
    });

    // Rebote del piso
    _wireSlider('bounceSlider', 'bounceValue', v => {
        _world.setParams({ restitution: v });
    }, v => v.toFixed(1));

    // ── Techo ───────────────────────────────────────────────────────────
    _wireCheck('ceilingToggle', checked => {
        _ceilingEnabled = checked;
        _world.setParams({ ceilingEnabled: checked });
        if (checked && !_ceilingMesh && _scene) {
            _createCeiling();
        }
        if (_ceilingMesh) _ceilingMesh.visible = checked;
    });

    _wire('ceilingVisibilityBtn', 'click', () => {
        if (!_ceilingMesh) return;
        _ceilingMesh.visible = !_ceilingMesh.visible;
        const btn = document.getElementById('ceilingVisibilityBtn');
        if (btn) btn.textContent = _ceilingMesh.visible ? '👁 Visible' : '🚫 Oculto';
    });

    _wireSlider('ceilingYSlider', 'ceilingYValue', v => {
        _world.setParams({ ceilingY: v * 100 }); // slider en unidades "visuales", convertir a wu
        if (_ceilingMesh) _ceilingMesh.position.y = v * 100;
    });

    _wireSlider('ceilingBounceSlider', 'ceilingBounceValue', v => {
        _world.setParams({ ceilingRestitution: v });
    }, v => v.toFixed(1));

    _wireSlider('ceilingOpacitySlider', 'ceilingOpacityValue', v => {
        if (_ceilingMesh?.material) _ceilingMesh.material.opacity = v;
    }, v => v.toFixed(2));

    // ── Esfera recipiente ───────────────────────────────────────────────
    _wireCheck('sphereToggle', checked => {
        _sphereEnabled = checked;
        _world.setParams({ sphereEnabled: checked });
        if (checked && !_sphereMesh && _scene) {
            _createSphere();
        }
        if (_sphereMesh) _sphereMesh.visible = checked;
    });

    _wire('sphereVisibilityBtn', 'click', () => {
        if (!_sphereMesh) return;
        _sphereMesh.visible = !_sphereMesh.visible;
        const btn = document.getElementById('sphereVisibilityBtn');
        if (btn) btn.textContent = _sphereMesh.visible ? '👁 Visible' : '🚫 Oculto';
    });

    _wireSlider('sphereRadiusSlider', 'sphereRadiusValue', v => {
        const r = v * 100; // convertir a wu
        _world.setParams({ sphereRadius: r });
        if (_sphereMesh) {
            _sphereMesh.geometry.dispose();
            _sphereMesh.geometry = new THREE.SphereGeometry(r, 32, 24);
        }
    });

    _wireSlider('sphereOpacitySlider', 'sphereOpacityValue', v => {
        if (_sphereMesh?.material) _sphereMesh.material.opacity = v;
    }, v => v.toFixed(2));

    _wireSlider('sphereCenterYSlider', 'sphereCenterYValue', v => {
        const y = v * 100;
        _world.setParams({ sphereCenterY: y });
        if (_sphereMesh) _sphereMesh.position.y = y;
    });

    // Polos térmicos de la esfera
    _wireSlider('sphereBottomTempSlider', 'sphereBottomTempValue', v => {
        _sphereBottomTemp = v;
    }, v => `${v} K`);

    _wireSlider('sphereTopTempSlider', 'sphereTopTempValue', v => {
        _sphereTopTemp = v;
    }, v => `${v} K`);
}


// ── Contenedores geométricos — lazy creation ────────────────────────────

function _createCeiling() {
    if (_ceilingMesh) return;
    const size = 8000; // mismo que GRID_SIZE en app.js
    const geo  = new THREE.PlaneGeometry(size, size);
    const mat  = new THREE.MeshBasicMaterial({
        color: 0x1a2040,
        transparent: true,
        opacity: 0.15,
        side: THREE.DoubleSide,
        depthWrite: false,
    });
    _ceilingMesh = new THREE.Mesh(geo, mat);
    _ceilingMesh.rotation.x = Math.PI / 2;
    _ceilingMesh.position.y = 1500; // default: 15 * 100 wu
    _ceilingMesh.visible = _ceilingEnabled;
    _ceilingMesh.renderOrder = -1; // detrás de átomos
    _scene.add(_ceilingMesh);
}

function _createSphere() {
    if (_sphereMesh) return;
    const r   = 2000; // default: 20 * 100 wu
    const geo = new THREE.SphereGeometry(r, 32, 24);
    const mat = new THREE.MeshStandardMaterial({
        color: 0x4488ff,
        transparent: true,
        opacity: 0.08,
        side: THREE.BackSide,
        metalness: 0.2,
        roughness: 0.7,
        depthWrite: false,
    });
    _sphereMesh = new THREE.Mesh(geo, mat);
    _sphereMesh.position.y = 0;
    _sphereMesh.visible = _sphereEnabled;
    _scene.add(_sphereMesh);
}


// ═══════════════════════════════════════════════════════════════════════════
//  TAB: LABORATORIO
// ═══════════════════════════════════════════════════════════════════════════

function _initLabTab() {

    // Gravedad fina — multiplicador directo sobre g_real
    // Rango 0 a 1e-10 (a 1e-10 → ~980 wu/s² efectivos → caída ~1s)
    _wireSlider('gravityLabSlider', 'gravityLabValue', v => {
        _world.setParams({ gravityMultiplier: v });
        // Sincronizar el slider del panel Física
        const gs = document.getElementById('gravitySlider');
        if (gs) {
            gs.value = v / 1e-11;
            const gv = document.getElementById('gravityValue');
            if (gv) {
                const sv = v / 1e-11;
                gv.textContent = sv > 0 ? `x${sv.toFixed(1)}` : 'OFF';
            }
        }
    }, v => v.toExponential(1));

    // Pauli
    _wireSlider('pauliStrengthSlider', 'pauliStrengthValue', v => {
        _world.setParams({ pauliStrength: v });
    }, v => v.toFixed(2));

    _wireSlider('pauliFactorSlider', 'pauliFactorValue', v => {
        _world.setParams({ pauliFactor: v });
    }, v => v.toFixed(1));

    // Fricción (damping)
    _wireSlider('frictionSlider', 'frictionValue', v => {
        _world.setParams({ damping: v });
    }, v => v.toFixed(2));

    // Velocidad terminal — todavía no implementada en World, pero guardamos el param
    _wireSlider('terminalVelSlider', 'terminalVelValue', v => {
        _world.setParams({ terminalVelocity: v });
    }, v => v.toFixed(1));

    // Spring de enlace — multiplica stiffness de todos los bonds
    _wireSlider('bondSpringSlider', 'bondSpringValue', v => {
        _world.setParams({ bondStiffnessMultiplier: v });
    }, v => v.toFixed(1));

    // Fuerza de ángulos de enlace
    _wireSlider('bondAnglesSlider', 'bondAnglesValue', v => {
        _world.setParams({ bondAngleStrength: v });
    }, v => v.toFixed(2));

    // Lennard-Jones strength
    _wireSlider('lennardJonesSlider', 'lennardJonesValue', v => {
        _world.setParams({ ljStrength: v });
    }, v => v.toFixed(2));

    // Irradiancia de superficie
    _wireSlider('surfaceRadRangeSlider', 'surfaceRadRangeValue', v => {
        _world.setParams({ surfaceRadRange: v });
    }, v => v.toFixed(1));

    _wireSlider('surfaceRadStrengthSlider', 'surfaceRadStrengthValue', v => {
        _world.setParams({ surfaceRadStrength: v });
    }, v => v.toFixed(2));

    // Botones Reset y Random
    _wire('resetPhysicsDefaults', 'click', () => {
        _world.setParams({
            gravity:          9.807e12,    // valor real — no tocar
            damping:           0.98,
            restitution:       0.3,
            pauliStrength:     500.0,
            pauliFactor:       2.0,
            gravityMultiplier: 0,          // OFF — honesto
            gravityEnabled:    false,
            floorEnabled:      true,
            pauliEnabled:      true,
            autoBond:          true,
            bondsVisible:      true,
        });
        _syncLabSliders();
        console.log('[PhysicsPanel] ♻️ Parámetros reseteados');
    });

    _wire('randomizePhysics', 'click', () => {
        _world.setParams({
            gravityMultiplier: Math.random() * 1e-10,
            gravityEnabled:    true,
            damping:           0.85 + Math.random() * 0.15,
            pauliStrength:     Math.random() * 2,
            pauliFactor:       1.0 + Math.random() * 2.0,
            restitution:       Math.random(),
        });
        _syncLabSliders();
        console.log('[PhysicsPanel] 🎲 Parámetros randomizados');
    });
}

/** Sincroniza los sliders del Lab con los valores actuales de world.params */
function _syncLabSliders() {
    const p = _world.params;

    _setSlider('gravityLabSlider',       'gravityLabValue',       p.gravityMultiplier,      v => v.toExponential(1));
    _setSlider('pauliStrengthSlider',    'pauliStrengthValue',    p.pauliStrength,          v => v.toFixed(2));
    _setSlider('pauliFactorSlider',      'pauliFactorValue',      p.pauliFactor,            v => v.toFixed(1));
    _setSlider('frictionSlider',         'frictionValue',         p.damping,                v => v.toFixed(2));
    _setSlider('bounceSlider',           'bounceValue',           p.restitution,            v => v.toFixed(1));

    // Slider de gravedad del panel Física — mapear multiplier a 0-10
    const sv = p.gravityMultiplier / 1e-11;
    _setSlider('gravitySlider',          'gravityValue',          sv,                       v => v > 0 ? `x${v.toFixed(1)}` : 'OFF');

    // Checkboxes
    _setCheck('gravityToggle',    p.gravityEnabled);
    _setCheck('repulsionToggle',  p.pauliEnabled);
    _setCheck('bondsToggle',      p.bondsVisible);
    _setCheck('floorToggle',      p.floorEnabled);
    _setCheck('bondAnglesToggle', p.autoBond);
}

function _setSlider(sliderId, valueId, val, fmt) {
    const s = document.getElementById(sliderId);
    const l = document.getElementById(valueId);
    if (s) s.value = val;
    if (l) l.textContent = fmt ? fmt(val) : val;
}

function _setCheck(id, val) {
    const el = document.getElementById(id);
    if (el) el.checked = !!val;
}


// ═══════════════════════════════════════════════════════════════════════════
//  TAB: TEMPERATURA
// ═══════════════════════════════════════════════════════════════════════════

function _initTemperatureTab() {

    // Toggle principal
    _wireCheck('tempEnabledToggle', checked => {
        _tempEnabled = checked;
        // Mostrar/ocultar temp HUD
        document.getElementById('temp-hud')?.classList.toggle('hidden', !checked);
    });

    // Slider de temperatura objetivo
    _wireSlider('tempSlider', 'tempTargetValue', v => {
        _tempTarget = v;
    }, v => `${v} K`);

    // Velocidad del termostato
    _wireSlider('tempTauSlider', 'tempTauValue', v => {
        _tempTau = v;
    });

    // Color de ambiente por temperatura
    _wireCheck('tempColorToggle', checked => {
        _tempColorEnabled = checked;
        if (!checked) {
            // Restaurar color por defecto
            document.documentElement.style.setProperty('--ambient-temp-rgb', '5, 7, 14');
        }
    });

    // Ruptura de enlaces por calor
    _wireCheck('tempBondBreakToggle', checked => {
        _tempBondBreak = checked;
    });

    // 🔥 Disociación Térmica — Boltzmann P = exp(-De/kBT) por frame
    _wireCheck('thermalDissociationToggle', checked => {
        _world.setParams({ thermalDissociation: checked });
    });

    // ⚗️ Metátesis — intercambio de bonds A-B + C-D → A-C + B-D
    _wireCheck('metathesisToggle', checked => {
        _world.setParams({ metathesisEnabled: checked });
    });

    // Temperatura del suelo
    _wireSlider('floorTempSlider', 'floorTempValue', v => {
        _floorTemp = v;
    }, v => `${v} K`);

    // Toggle independiente — el slider define la T, pero el toggle decide si irradia
    _wireCheck('floorTempToggle',   checked => { _floorTempEnabled   = checked; });
    _wireCheck('ceilingTempToggle', checked => { _ceilingTempEnabled = checked; });
    _wireCheck('sphereTempToggle',  checked => { _sphereTempEnabled  = checked; });

    // Temperatura del techo
    _wireSlider('ceilingTempSlider', 'ceilingTempValue', v => {
        _ceilingTemp = v;
    }, v => `${v} K`);

    // Modo didáctico vs realista
    _wire('tempModeDidactic', 'click', () => {
        _tempMode = 'didactic';
        document.getElementById('tempModeDidactic')?.classList.add('seg-btn--active');
        document.getElementById('tempModeRealistic')?.classList.remove('seg-btn--active');
        const desc = document.getElementById('tempModeDesc');
        if (desc) desc.textContent = t('temperature.mode_didactic_desc');
    });

    _wire('tempModeRealistic', 'click', () => {
        _tempMode = 'realistic';
        document.getElementById('tempModeRealistic')?.classList.add('seg-btn--active');
        document.getElementById('tempModeDidactic')?.classList.remove('seg-btn--active');
        const desc = document.getElementById('tempModeDesc');
        if (desc) desc.textContent = t('temperature.mode_realistic_desc');
    });
}


// ── Sistema de temperatura — tick cada frame ────────────────────────────

function _tickTemperature(dt) {
    // ── Berendsen thermostat — convergencia suave ─────────────────────
    // λ = sqrt(1 + (1/τ) × (T_target/T_actual - 1))
    // Clamp λ a ±5% por frame para evitar explosiones
    if (_tempCurrent > 0.1) {
        const ratio    = _tempTarget / _tempCurrent;
        const lambdaSq = 1 + (1 / Math.max(_tempTau, 1)) * (ratio - 1);
        if (lambdaSq > 0) {
            const lambda = Math.max(0.95, Math.min(1.05, Math.sqrt(lambdaSq)));
            for (const atom of _world.atoms.values()) {
                if (atom.frozen) continue;
                atom.velocity.multiplyScalar(lambda);
            }
        }
    }

    // ── Agitación térmica — impulso Maxwell-Boltzmann ─────────────────
    // IMPORTANTE: usar _tempTarget (el objetivo), NO _tempCurrent (medida)
    // Si usamos _tempCurrent, el kick amplifica la T medida → feedback loop → millones de K
    const k_B_sim = 8.617e-5; // eV/K
    for (const atom of _world.atoms.values()) {
        if (atom.frozen) continue;

        const thermalV = Math.sqrt(2 * k_B_sim * _tempTarget / Math.max(atom.mass, 0.1));
        const kick = thermalV * dt * 0.5;

        atom.applyForce(new THREE.Vector3(
            (Math.random() - 0.5) * kick * atom.mass,
            (Math.random() - 0.5) * kick * atom.mass,
            (Math.random() - 0.5) * kick * atom.mass,
        ));

        // ── Irradiación del suelo ─────────────────────────────────────
        if (_floorTemp > 0 && _world.params.floorEnabled && _floorTempEnabled) {
            const distToFloor = atom.position.y - _world.params.floorY;
            const range = atom.radius * 6;
            if (distToFloor < range) {
                const influence = (1 - distToFloor / range) * 0.3;
                _applyThermalForce(atom, _floorTemp, influence, dt);
            }
        }

        // ── Irradiación del techo ─────────────────────────────────────
        if (_ceilingTemp > 0 && _world.params.ceilingEnabled && _ceilingTempEnabled) {
            const distToCeil = _world.params.ceilingY - atom.position.y;
            const range = atom.radius * 6;
            if (distToCeil < range) {
                const influence = (1 - distToCeil / range) * 0.3;
                _applyThermalForce(atom, _ceilingTemp, influence, dt);
            }
        }

        // ── Polos de la esfera contenedora ────────────────────────────
        if (_world.params.sphereEnabled && _sphereTempEnabled &&
            (_sphereTopTemp > 0 || _sphereBottomTemp > 0)) {
            const cy = _world.params.sphereCenterY;
            const R  = _world.params.sphereRadius;
            const dy = atom.position.y - cy;
            // Pre-alloc: reutilizar vector temporal sin new()
            _tmpSpherePos.set(0, cy, 0);
            const distToSurface = R - atom.position.distanceTo(_tmpSpherePos);

            if (distToSurface < R * 0.2 && distToSurface > 0) {
                const surfaceInfluence = (1 - distToSurface / (R * 0.2)) * 0.25;
                const normalizedY = Math.max(-1, Math.min(1, dy / R));
                const t = normalizedY * 0.5 + 0.5;
                const T_local = _sphereBottomTemp * (1 - t) + _sphereTopTemp * t;
                if (T_local > 0) _applyThermalForce(atom, T_local, surfaceInfluence, dt);
            }
        }
    }

    // ── Medir temperatura real desde velocidades ──────────────────────
    // Restamos la velocidad del centro de masa (movimiento coherente)
    // para que la gravedad no se confunda con temperatura.
    // T = solo la componente ALEATORIA (browniana) de la velocidad.
    let totalEk = 0, count = 0;
    const vCOM = new THREE.Vector3(); // velocidad del centro de masa
    for (const atom of _world.atoms.values()) {
        if (atom.frozen) continue;
        vCOM.add(atom.velocity);
        count++;
    }
    if (count > 0) {
        vCOM.divideScalar(count); // velocidad media del sistema
        for (const atom of _world.atoms.values()) {
            if (atom.frozen) continue;
            // Velocidad térmica = velocidad total - velocidad coherente
            const vTherm = atom.velocity.clone().sub(vCOM);
            totalEk += 0.5 * atom.mass * vTherm.lengthSq();
        }
        const T_raw = (2 / 3) * (totalEk / count) / k_B_sim;
        const T_clamped = Math.min(T_raw, Math.max(_tempTarget * 10, 5000));

        // EMA — suavizar la medición para evitar fluctuaciones por colisiones/kicks
        // α=0.05: ventana efectiva de ~20 frames (~0.33s a 60fps)
        // Sin esto: cada pico de Pauli o kick aleatorio aparece como spike de temperatura
        const alpha = 0.05;
        _tempCurrent = _tempCurrent * (1 - alpha) + T_clamped * alpha;
    }

    // Propagar temperatura medida al World — usada por _applyThermalDissociation (Boltzmann)
    _world.setTemperature?.(_tempCurrent);

    // ── Ruptura de enlaces por calor ──────────────────────────────────
    // _tempBondBreak: heurística simple por estiramiento (legacy, mantener)
    // thermalDissociation en World: Boltzmann físico real (nuevo)
    if (_tempBondBreak && _tempCurrent > 500) {
        for (const bond of _world.bonds.values()) {
            if (bond.broken) continue;
            const stretch = Math.abs(bond.stretch()) / bond.equilibriumLength;
            const breakProb = stretch * _tempCurrent * 1e-6 * dt;
            if (Math.random() < breakProb) {
                bond._breakBond();
            }
        }
    }

    // Actualizar readouts
    _updateTempReadouts();

    // Color de ambiente
    if (_tempColorEnabled) {
        _updateAmbientColor(_tempCurrent);
    }
}

/**
 * Aplica calor de una superficie como fuerza aleatoria (Maxwell-Boltzmann).
 * Usa applyForce en vez de modificar velocity directamente — así el integrador
 * resuelve todas las fuerzas juntas y Berendsen no compite frame a frame.
 */
function _applyThermalForce(atom, targetT, influence, dt) {
    if (influence <= 0 || targetT <= 0) return;
    const k_B_sim = 8.617e-5;
    // Velocidad objetivo a esa temperatura
    const targetSpeed = Math.sqrt(2 * k_B_sim * targetT / Math.max(atom.mass, 0.1));
    const currentSpeed = atom.velocity.length();
    // Delta de velocidad necesario — escalado por influencia y dt
    const dv = (targetSpeed - currentSpeed) * influence * dt * 30;
    if (Math.abs(dv) < 0.0001) return;
    // Dirección aleatoria (browniano) — no sesgamos el movimiento
    const fx = (Math.random() - 0.5);
    const fy = (Math.random() - 0.5);
    const fz = (Math.random() - 0.5);
    const len = Math.sqrt(fx*fx + fy*fy + fz*fz) || 1;
    atom.applyForce(new THREE.Vector3(
        (fx/len) * dv * atom.mass,
        (fy/len) * dv * atom.mass,
        (fz/len) * dv * atom.mass,
    ));
}

function _updateTempReadouts() {
    // Panel readout
    const elCurrent = document.getElementById('tempCurrentValue');
    const elPhase   = document.getElementById('tempPhaseValue');
    if (elCurrent) elCurrent.textContent = `${_tempCurrent.toFixed(0)} K`;

    // Fase del primer átomo (o genérica)
    if (elPhase && _world.atoms.size > 0) {
        const firstAtom = _world.atoms.values().next().value;
        const phase = firstAtom?.phaseAt?.(_tempCurrent) ?? '—';
        elPhase.textContent = phase;

        // Color de la fase
        const colors = { solid: '#88ccff', liquid: '#4fc3f7', gas: '#ff9933', plasma: '#ff4444' };
        elPhase.style.color = colors[phase] ?? 'var(--text-dim)';
    }

    // HUD flotante
    const hudAmb   = document.getElementById('hudAmbientTemp');
    const hudPhase = document.getElementById('hudPhase');
    const hudFloor = document.getElementById('hudFloorTemp');
    const hudCeil  = document.getElementById('hudCeilingTemp');

    if (hudAmb)   hudAmb.textContent   = `${_tempCurrent.toFixed(0)} K`;
    if (hudFloor) hudFloor.textContent = _floorTemp > 0 ? `${_floorTemp} K` : '— K';
    if (hudCeil)  hudCeil.textContent  = _ceilingTemp > 0 ? `${_ceilingTemp} K` : '— K';
    if (hudPhase && _world.atoms.size > 0) {
        const firstAtom = _world.atoms.values().next().value;
        hudPhase.textContent = firstAtom?.phaseAt?.(_tempCurrent) ?? '—';
    }
}

/**
 * Cambia el color de fondo del body según la temperatura.
 * Azul profundo → naranja cálido → ámbar plasma
 */
function _updateAmbientColor(tempK) {
    let r, g, b;
    if (tempK < 300) {
        // Frío: azul profundo
        const t = tempK / 300;
        r = Math.round(5 + t * 5);
        g = Math.round(7 + t * 10);
        b = Math.round(14 + t * 20);
    } else if (tempK < 1500) {
        // Cálido: hacia naranja
        const t = (tempK - 300) / 1200;
        r = Math.round(10 + t * 60);
        g = Math.round(17 + t * 20);
        b = Math.round(34 - t * 20);
    } else {
        // Plasma: ámbar/rojo
        const t = Math.min((tempK - 1500) / 1500, 1);
        r = Math.round(70 + t * 50);
        g = Math.round(37 - t * 15);
        b = Math.round(14 - t * 10);
    }
    document.documentElement.style.setProperty('--ambient-temp-rgb', `${r}, ${g}, ${b}`);
}


// ═══════════════════════════════════════════════════════════════════════════
//  VISOR ÓPTICO — filtro de brillo para observar átomos brillantes
// ═══════════════════════════════════════════════════════════════════════════

let _visorActive     = false;
let _visorLevel      = 0.25;   // 0.05 = muy oscuro, 1.0 = sin filtro
let _savedBright     = null;   // brillo original antes de activar visor
let _savedBloom      = null;   // bloom original

function _initVisor() {
    const btn    = document.getElementById('visorBtn');
    const slider = document.getElementById('visorSlider');
    const label  = document.getElementById('visorValue');
    const sliderWrap = document.getElementById('visorSliderWrap');
    if (!btn) return;

    btn.addEventListener('click', () => {
        _visorActive = !_visorActive;

        if (_visorActive) {
            _savedBright = _qr?._tuning?.bright ?? 1.2;
            _savedBloom  = _qr?.bloomPass?.strength ?? 0.066;
            _applyVisor(_visorLevel);
            btn.classList.add('active');
            sliderWrap?.classList.add('visible');
        } else {
            _restoreVisor();
            btn.classList.remove('active');
            sliderWrap?.classList.remove('visible');
        }
    });

    if (slider) {
        slider.addEventListener('input', () => {
            _visorLevel = parseFloat(slider.value);
            if (label) label.textContent = Math.round(_visorLevel * 100) + '%';
            if (_visorActive) _applyVisor(_visorLevel);
        });
    }
}

function _applyVisor(level) {
    if (!_world || !_qr) return;

    // 1. Bajar uBright de todas las esferas
    for (const atom of _world.atoms.values()) {
        const u = atom.sphereMesh?.material?.uniforms;
        if (u?.uBright) u.uBright.value = (_savedBright ?? 1.2) * level;
    }

    // 2. Bajar bloom
    if (_qr.bloomPass) {
        _qr.bloomPass.strength = (_savedBloom ?? 0.066) * level;
    }

    // 3. A niveles muy bajos, cambiar blending a Normal para ver estructura
    for (const atom of _world.atoms.values()) {
        if (!atom.sphereMesh?.material) continue;
        if (level < 0.3) {
            atom.sphereMesh.material.blending = THREE.NormalBlending;
        } else {
            atom.sphereMesh.material.blending = THREE.AdditiveBlending;
        }
    }
}

function _restoreVisor() {
    if (!_world || !_qr) return;

    // Restaurar brillo original
    for (const atom of _world.atoms.values()) {
        const u = atom.sphereMesh?.material?.uniforms;
        if (u?.uBright) u.uBright.value = _savedBright ?? 1.2;
        if (atom.sphereMesh?.material) {
            atom.sphereMesh.material.blending = THREE.AdditiveBlending;
        }
    }

    // Restaurar bloom
    if (_qr.bloomPass) {
        _qr.bloomPass.strength = _savedBloom ?? 0.066;
    }
}


// ═══════════════════════════════════════════════════════════════════════════
//  STATS
// ═══════════════════════════════════════════════════════════════════════════

function _updateStats() {
    if (_elAtomCount)     _elAtomCount.textContent = _world.atoms.size;
    if (_elBondCount)     _elBondCount.textContent  = _world.bonds.size;
    // Contador reactivo — World lo mantiene actualizado en addBond/removeBond/removeAtom.
    // Sin BFS en el hot path.
    if (_elMoleculeCount) _elMoleculeCount.textContent = _world._moleculeCount ?? 0;
}


// ═══════════════════════════════════════════════════════════════════════════
//  CONSOLA toggle
// ═══════════════════════════════════════════════════════════════════════════

// Nota: la consola (toggle, clear, close, run, historial, autocomplete)
// la maneja completamente Console.js — no duplicar listeners aquí.
