/**
 * AddPanel.js — Conecta el panel "Agregar" con MoleculeFactory y CrystalFactory
 *
 * Genera los botones de moléculas dinámicamente desde moleculas.json.
 * Conecta los botones de cristales (NaCl, Fe, Diamante, Hielo).
 * Cada botón coloca la estructura frente a la cámara del QR.
 *
 * Uso en app.js:
 *   import { AddPanel } from './src/ui/AddPanel.js';
 *   AddPanel.init(world, qr);
 */

import * as THREE from 'three';
import { MoleculeFactory }  from '../structures/MoleculeFactory.js';
import { CrystalFactory }   from '../structures/CrystalFactory.js';
import { SnowflakeFactory }  from '../structures/SnowflakeFactory.js';
import { t, getLanguage }    from '../data/i18n.js';

let _world    = null;
let _qr       = null;
let _factory  = null;
let _crystals = null;
let _snowflake = null;
let _lastCrystalAtoms    = [];  // para freeze/unfreeze
let _lastSnowflakeAtoms  = [];  // para azul plata y export
let _silverBlueActive    = false;

export const AddPanel = {

    /**
     * Inicializar: carga moleculas.json, crea factories, genera botones.
     * @param {World} world
     * @param {QuantumRenderer} qr — para saber dónde está la cámara
     */
    async init(world, qr) {
        _world     = world;
        _qr        = qr;
        _factory   = new MoleculeFactory(world);
        _crystals  = new CrystalFactory(world);
        _snowflake = new SnowflakeFactory(world);
        await _factory.init();

        _buildMoleculeButtons();
        _connectCrystalButtons();
        _connectCrystalControls();
        _connectSnowflakeButtons();
        document.addEventListener('languageChanged', () => _buildMoleculeButtons());
        console.log('[AddPanel] ✅ Conectado (moléculas + cristales + copos)');
    },
};

// ── Generar botones de moléculas ────────────────────────────────────────

function _buildMoleculeButtons() {
    const container = document.getElementById('moleculeButtons');
    if (!container) return;
    container.innerHTML = '';

    const list = _factory.getList();
    for (const mol of list) {
        const btn = document.createElement('button');
        btn.className   = 'btn btn--panel';
        btn.textContent = `${mol.icon} ${mol.formula}`;
        const molName   = getLanguage() === 'en' ? (mol.name_en ?? mol.name) : mol.name;
        btn.title       = molName;
        btn.style.cssText = 'font-size:11px;padding:8px;';

        btn.addEventListener('click', async () => {
            const pos    = _spawnPosition();
            const result = await _factory.create(mol.index, pos);
            if (result.atoms.length > 0) {
                const name = getLanguage() === 'en' ? (mol.name_en ?? mol.name) : mol.name;
                _showHint(t('messages.molecule_added').replace('{name}', `${mol.icon} ${name}`));
            }
        });

        container.appendChild(btn);
    }
}

// ── Cristales ─────────────────────────────────────────────────────────

function _getCrystalSize() {
    return parseInt(document.getElementById('crystalSizeSlider')?.value ?? 3);
}

function _connectCrystalButtons() {
    const btn = (id, fn, label) => {
        document.getElementById(id)?.addEventListener('click', async () => {
            _showHint(t('messages.generating'));
            await new Promise(r => requestAnimationFrame(r));
            try {
                const atoms = await fn();
                _lastCrystalAtoms = atoms;
                const cb = document.getElementById('freezeCrystalToggle');
                if (cb) cb.checked = true;
                _showHint(t('messages.structure_generated').replace('{name}', label).replace('{n}', atoms.length));
            } catch (err) {
                _showHint(t('messages.load_error').replace('{msg}', err.message));
                console.error('[AddPanel]', err);
            }
        });
    };

    btn('crystalNaCl',    () => _crystals.generateNaCl(_getCrystalSize()),    `🧂 ${t('add.crystal_nacl')}`);
    btn('crystalFe',      () => _crystals.generateBCC(_getCrystalSize()),     `🔩 ${t('add.crystal_iron')}`);
    btn('crystalDiamond', () => _crystals.generateFCC(_getCrystalSize(), 'C'),`💎 ${t('add.crystal_diamond')}`);
    btn('crystalIce',     () => _crystals.generateIce(_getCrystalSize()),     `❄️ ${t('add.crystal_ice')}`);
}

function _connectCrystalControls() {
    // Slider de tamaño — actualiza los 3 labels
    const slider = document.getElementById('crystalSizeSlider');
    if (slider) {
        slider.addEventListener('input', () => {
            ['crystalSizeValue', 'crystalSizeValue2', 'crystalSizeValue3'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.textContent = slider.value;
            });
        });
    }

    // Toggle congelar/descongelar
    document.getElementById('freezeCrystalToggle')?.addEventListener('change', e => {
        if (_lastCrystalAtoms.length === 0) return;
        if (e.target.checked) {
            _crystals._freezeAll(_lastCrystalAtoms);
            _showHint(t('messages.crystal_frozen'));
        } else {
            _crystals.unfreezeAll(_lastCrystalAtoms);
            _showHint(t('messages.crystal_unfrozen'));
        }
    });
}

// ── Copos de nieve ────────────────────────────────────────────────────

function _connectSnowflakeButtons() {

    // Sliders labels
    ['Complexity', 'Humidity', 'Chaos'].forEach(name => {
        const sl = document.getElementById('sf' + name + 'Slider');
        const vl = document.getElementById('sf' + name + 'Value');
        if (sl && vl) sl.addEventListener('input', () => { vl.textContent = sl.value; });
    });

    // ❄️ Generar
    document.getElementById('sfGenerate')?.addEventListener('click', async () => {
        _showHint(t('messages.generating'));
        await new Promise(r => requestAnimationFrame(r));

        _removeSnowflakeAtoms();
        _silverBlueActive = false;

        const iter  = parseInt(document.getElementById('sfComplexitySlider')?.value ?? 2);
        const humid = parseFloat(document.getElementById('sfHumiditySlider')?.value ?? 0.7);
        const chaos = parseFloat(document.getElementById('sfChaosSlider')?.value ?? 0.4);

        try {
            _lastSnowflakeAtoms = await _snowflake.generate(iter, humid, chaos);
            _showHint(t('messages.snowflake_generated').replace('{n}', _lastSnowflakeAtoms.length));
        } catch (err) {
            _showHint(t('messages.load_error').replace('{msg}', err.message));
            console.error('[AddPanel] Snowflake error:', err);
        }
    });

    // 💾 Guardar
    document.getElementById('sfSave')?.addEventListener('click', () => {
        if (_lastSnowflakeAtoms.length === 0) { _showHint(t('messages.snowflake_first')); return; }
        const json = _snowflake.exportJSON(_lastSnowflakeAtoms);
        const blob = new Blob([json], { type: 'application/json' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href = url;
        a.download = `snowflake_${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
        _showHint(t('messages.snowflake_saved'));
    });

    // 📂 Cargar
    const fileInput = document.getElementById('sfFileInput');
    document.getElementById('sfLoad')?.addEventListener('click', () => fileInput?.click());
    fileInput?.addEventListener('change', async e => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async ev => {
            try {
                const data = JSON.parse(ev.target.result);
                _removeSnowflakeAtoms();
                _silverBlueActive = false;
                _lastSnowflakeAtoms = await _snowflake.loadJSON(data);
                _showHint(t('messages.snowflake_loaded').replace('{n}', _lastSnowflakeAtoms.length));
            } catch (err) {
                _showHint(t('messages.load_error').replace('{msg}', err.message));
            }
            fileInput.value = '';
        };
        reader.readAsText(file);
    });

    // ✨ Azul Plata
    document.getElementById('sfSilverBlue')?.addEventListener('click', () => {
        if (_lastSnowflakeAtoms.length === 0) { _showHint(t('messages.snowflake_first')); return; }

        _silverBlueActive = !_silverBlueActive;

        for (const atom of _lastSnowflakeAtoms) {
            const u = atom.sphereMesh?.material?.uniforms?.uColor;
            if (!u) continue;

            if (_silverBlueActive) {
                // Azul hielo para O, blanco puro para H
                u.value.setHex(atom.symbol === 'O' ? 0xd9e4ec : 0xffffff);
            } else {
                // Restaurar color original del elemento
                u.value.setHex(atom._color);
            }
        }

        const btn = document.getElementById('sfSilverBlue');
        if (btn) {
            btn.style.borderColor = _silverBlueActive ? 'rgba(160,200,220,0.7)' : 'rgba(160,200,220,0.4)';
            btn.style.background  = _silverBlueActive ? 'rgba(160,200,220,0.2)' : 'rgba(160,200,220,0.08)';
        }
        _showHint(_silverBlueActive ? t('messages.ice_style') : t('messages.original_colors'));
    });
}

/** Eliminar átomos del copo anterior */
function _removeSnowflakeAtoms() {
    for (const atom of _lastSnowflakeAtoms) {
        _world.removeAtom(atom.id);
    }
    _lastSnowflakeAtoms = [];
}

// ── Posición de spawn — frente a la cámara, cerca del suelo ─────────

function _spawnPosition() {
    if (!_qr?.camera) return new THREE.Vector3(0, 0, 0);

    const cam = _qr.camera;
    const dir = new THREE.Vector3();
    cam.getWorldDirection(dir);

    // Proyectar 400wu frente a la cámara
    const pos = cam.position.clone().addScaledVector(dir, 400);

    // Añadir un poco de variación para no apilar moléculas
    pos.x += (Math.random() - 0.5) * 200;
    pos.z += (Math.random() - 0.5) * 200;

    // Elevar un poco sobre el suelo
    const floorY = _world?.params?.floorY ?? -500;
    if (pos.y < floorY + 100) pos.y = floorY + 100;

    return pos;
}

// ── Hint (usa el sistema existente si existe) ────────────────────────

function _showHint(text) {
    const hint = document.getElementById('hint');
    if (!hint) return;
    hint.textContent = text;
    hint.classList.add('visible');
    setTimeout(() => hint.classList.remove('visible'), 2000);
}
