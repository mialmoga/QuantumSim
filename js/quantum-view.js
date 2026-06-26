/**
 * quantum-view.js
 * Lógica de QuantumView — standalone viewer de orbitales
 * Extraído de QuantumView.html para mantenibilidad
 */

import { QuantumRenderer } from '../src/renderer/QuantumRenderer.js';
import { ElementLoader }   from '../src/data/ElementLoader.js';
import { initI18n, t, updateDOM, getLanguage } from '../src/data/i18n.js';

// ── Estado ────────────────────────────────────────────────────────────────────
let loading = false;

// Colores canónicos por subcapa
const SUBSHELL_COLORS = {
    s:'#00ffff', p:'#ff4fff', d:'#ffa500', f:'#66ff66',
};

function subshellColor(subshell) {
    const m = subshell.match(/^(\d)([spdf])/);
    if (!m) return '#aaaaaa';
    const n = parseInt(m[1]), l = m[2];
    const base = SUBSHELL_COLORS[l] ?? '#aaaaaa';
    const fade  = Math.max(0.3, 1 - (n - 1) * 0.12);
    const r = parseInt(base.slice(1,3),16), g = parseInt(base.slice(3,5),16), b = parseInt(base.slice(5,7),16);
    return `rgb(${Math.round(r*fade)},${Math.round(g*fade)},${Math.round(b*fade)})`;
}

function orbitalLabel(key) {
    const m = key.match(/^(.+)_m([+-]?\d+)$/);
    if (!m) return key;
    const mval = parseInt(m[2]);
    return `${m[1]}&thinsp;<span class="orb-m">m${mval >= 0 ? '+' : ''}${mval}</span>`;
}

function layerLabel(l) {
    const MAP = {
        valence: t('quantum.layer_valence'),
        semi:    t('quantum.layer_semi'),
        core:    t('quantum.layer_core'),
        inner:   t('quantum.layer_inner'),
        nucleus: t('quantum.nucleus_label'),
    };
    if (MAP[l]) return MAP[l];
    if (l.startsWith('shell_')) return t('quantum.layer_shell').replace('{n}', l.split('_')[1]);
    return l;
}

const LAYER_ORDER = ['nucleus','valence','semi','core','inner'];

// ── DOM ───────────────────────────────────────────────────────────────────────
const isMobile   = () => window.innerWidth < 768;
const selector   = document.getElementById('qv-selector');
const handle     = document.getElementById('qv-sel-handle');
const tunePanel  = document.getElementById('tune-panel');
const tuneHeader = document.getElementById('tune-header');
const overlay    = document.getElementById('qv-overlay');
const layersList = document.getElementById('layers-list');

// ── i18n ──────────────────────────────────────────────────────────────────────
await initI18n();
updateDOM();
document.addEventListener('languageChanged', updateDOM);

// ── Renderer ──────────────────────────────────────────────────────────────────
const qr = new QuantumRenderer(document.getElementById('qv-canvas'), { eagerLoad: true });
window._qr = qr; // DEBUG — quitar antes de producción
await qr.init();

// ── Datos ─────────────────────────────────────────────────────────────────────
await ElementLoader.init();
buildSelector();

// ── Selector de elementos (bottom sheet) ─────────────────────────────────────
let sheetOpen = false, swipeStartY = 0;
const openSheet  = () => { sheetOpen = true;  selector.classList.add('open'); };
const closeSheet = () => { sheetOpen = false; selector.classList.remove('open'); };

handle.addEventListener('click', () => sheetOpen ? closeSheet() : openSheet());
handle.addEventListener('touchstart', e => { swipeStartY = e.touches[0].clientY; }, { passive: true });
handle.addEventListener('touchend',   e => {
    const dy = swipeStartY - e.changedTouches[0].clientY;
    if (dy > 20) openSheet(); else if (dy < -20) closeSheet();
}, { passive: true });

if (!isMobile()) {
    selector.classList.remove('collapsed');
}
// Collapse siempre registrado — el botón solo es visible en desktop via CSS
document.getElementById('qv-collapse-btn')
    ?.addEventListener('click', () => selector.classList.toggle('collapsed'));

window.addEventListener('resize', () => {
    if (!isMobile()) selector.classList.remove('collapsed');
});

// ── Tune panel ────────────────────────────────────────────────────────────────
const tuneSlot   = document.getElementById('qv-tune-slot');
const tuneHandle = document.getElementById('qv-tune-handle');
const tuneBody   = document.getElementById('tune-body');

function applyTuneLayout() {
    if (isMobile()) {
        if (tuneBody.parentElement !== tuneSlot) tuneSlot.appendChild(tuneBody);
        tunePanel.style.display = 'none';
    } else {
        if (tuneBody.parentElement !== tunePanel) tunePanel.appendChild(tuneBody);
        tunePanel.style.display = 'flex';
        tunePanel.classList.add('open');
    }
}
applyTuneLayout();
window.addEventListener('resize', applyTuneLayout);

const openTune  = () => { tuneSlot.classList.add('open'); };
const closeTune = () => { tuneSlot.classList.remove('open'); overlay?.classList.remove('visible'); };

if (tuneHandle) tuneHandle.addEventListener('click', () => tuneSlot.classList.toggle('open'));
document.getElementById('tune-close').addEventListener('click', closeTune);

tuneHeader.addEventListener('click', e => {
    if (isMobile()) return;
    if (e.target.id === 'tune-close') return;
    tunePanel.classList.toggle('collapsed');
});

document.getElementById('qv-group-filter').addEventListener('wheel', e => {
    e.preventDefault();
    document.getElementById('qv-group-filter').scrollLeft += e.deltaY || e.deltaX;
}, { passive: false });

// ── Sliders globales ──────────────────────────────────────────────────────────
[
    ['sl-bloom',  'bloom'],
    ['sl-thresh', 'thresh'],
    ['sl-bright', 'bright'],
    ['sl-size',   'size'],
    ['sl-speed',  'speed'],
    ['sl-amp',    'amp'],
    ['sl-edge',   'edge'],
].forEach(([id, key]) => {
    const sl = document.getElementById(id);
    const vl = document.getElementById(id.replace('sl-','vl-'));
    if (!sl) return;
    sl.addEventListener('input', () => {
        const v = parseFloat(sl.value);
        qr.setTuning(key, v, 'all');
        if (vl) vl.textContent = v.toFixed(key === 'edge' ? 3 : 2);
    });
});

document.getElementById('btn-save-profile')?.addEventListener('click', () => {
    if (!qr.currentSymbol) { alert(t('messages.load_element_first')); return; }

    const tuning     = qr.getTuning();
    const visibility = qr.getLayerVisibility();

    const profile = {
        version:   '1.0',
        created:   new Date().toISOString(),
        element:   qr.currentSymbol,
        materials: {
            sphere:  _activeMaterials.sphere  ?? null,
            core:    _activeMaterials.core    ?? null,
            semi:    _activeMaterials.semi    ?? null,
            valence: _activeMaterials.valence ?? null,
        },
        tuning: {
            global:     tuning.global,
            perOrbital: tuning.perOrbital,
        },
        layers: {
            orbitals: visibility.orbitals,
            layers:   visibility.layers,
        },
        bloom: {
            strength:  tuning.global.bloom,
            threshold: tuning.global.thresh,
        },
    };

    const slug = qr.currentSymbol.toLowerCase();
    const a = Object.assign(document.createElement('a'), {
        href:     URL.createObjectURL(new Blob([JSON.stringify(profile, null, 2)], { type: 'application/json' })),
        download: `profile_${slug}_${Date.now()}.json`,
    });
    a.click();
    URL.revokeObjectURL(a.href);

    const btn = document.getElementById('btn-save-profile');
    btn.textContent = t('quantum.profile_saved');
    setTimeout(() => btn.textContent = '💾 ' + t('quantum.save_profile'), 1500);
});

// ── Modal de materiales ───────────────────────────────────────────────────────

// Materiales activos por capa — se guardan en el perfil
const _activeMaterials = { sphere: null, core: null, semi: null, valence: null };

// Materiales base — cargados desde /src/materials/index.json
let BASE_MATERIAL_IDS = [];
try {
    const res = await fetch('../src/materials/index.json');
    if (res.ok) {
        const idx = await res.json();
        BASE_MATERIAL_IDS = idx.materials ?? [];
        console.log(`[QV] ${BASE_MATERIAL_IDS.length} materiales disponibles`);
    }
} catch (e) {
    console.warn('[QV] No se pudo cargar materials/index.json:', e);
}

const matOverlay = document.getElementById('mat-modal-overlay');
const matModal   = document.getElementById('mat-modal');

document.getElementById('btn-materials')?.addEventListener('click', () => {
    matOverlay.classList.add('open');
});
document.getElementById('mat-modal-close')?.addEventListener('click', () => {
    matOverlay.classList.remove('open');
});
matOverlay.addEventListener('click', e => {
    if (e.target === matOverlay) matOverlay.classList.remove('open');
});

// Poblar desplegables con materiales base
async function populateMatSelects() {
    const selects = document.querySelectorAll('.mat-select');
    for (const sel of selects) {
        const layer = sel.dataset.layer;
        // Limpiar opciones previas excepto "Sin material"
        while (sel.options.length > 1) sel.remove(1);

        for (const id of BASE_MATERIAL_IDS) {
            // Para sphere: todos los materiales base
            // Para capas orbital: solo los que no son sphere (target=orbital)
            try {
                const res = await fetch(`../src/materials/${id}.json`);
                if (!res.ok) continue;
                const preset = await res.json();
                // Sphere solo acepta target=sphere, capas solo target=orbital
                const targetOk = layer === 'sphere'
                    ? (preset.target === 'sphere')
                    : (preset.target === 'orbital' || !preset.target);
                if (!targetOk) continue;
                const opt = document.createElement('option');
                opt.value       = id;
                opt.textContent = preset.name ?? id;
                sel.appendChild(opt);
            } catch { /* silencioso */ }
        }
    }
}
populateMatSelects();

// Aplicar material seleccionado desde desplegable
document.querySelectorAll('.mat-select').forEach(sel => {
    sel.addEventListener('change', async () => {
        const layer = sel.dataset.layer;
        const id    = sel.value;
        if (!id) {
            _activeMaterials[layer] = null;
            _updateActiveLabel(layer, '—');
            // TODO: revertir shader al default
            return;
        }
        try {
            const res    = await fetch(`../src/materials/${id}.json`);
            const preset = await res.json();
            _applyMaterialPreset(layer, preset);
        } catch (e) {
            console.error('Error cargando material:', e);
        }
    });
});

// Cargar material desde archivo
document.querySelectorAll('.mat-load-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const layer = btn.dataset.layer;
        document.querySelector(`.mat-file-input[data-layer="${layer}"]`)?.click();
    });
});

document.querySelectorAll('.mat-file-input').forEach(input => {
    input.addEventListener('change', async e => {
        const file  = e.target.files[0];
        const layer = input.dataset.layer;
        if (!file) return;
        try {
            const preset = JSON.parse(await file.text());
            _applyMaterialPreset(layer, preset);
            // Marcar en el select como "personalizado"
            const sel = document.querySelector(`.mat-select[data-layer="${layer}"]`);
            if (sel) {
                // Agregar opción temporal si no existe
                let customOpt = sel.querySelector('option[value="__custom__"]');
                if (!customOpt) {
                    customOpt = document.createElement('option');
                    customOpt.value = '__custom__';
                    sel.appendChild(customOpt);
                }
                customOpt.textContent = `📂 ${preset.name ?? file.name}`;
                sel.value = '__custom__';
            }
        } catch (e) {
            alert(t('messages.file_load_error') + ': ' + e.message);
        }
        e.target.value = '';
    });
});

function _applyMaterialPreset(layer, preset) {
    if (!preset.compiled?.vert || !preset.compiled?.frag) {
        alert(t('messages.preset_no_shaders').replace('{name}', preset.name ?? '?'));
        return;
    }
    _activeMaterials[layer] = preset;
    _updateActiveLabel(layer, preset.name ?? layer);

    // Aplicar al renderer via loadShaderJSON
    // Para sphere el target es 'sphere', para capas el target es la capa
    const target = layer === 'sphere' ? 'sphere' : layer;
    qr.loadShaderJSON(preset, target);
}

function _updateActiveLabel(layer, text) {
    const el = document.getElementById(`mat-active-${layer}`);
    if (el) el.textContent = text;
}

// ── Panel de capas ────────────────────────────────────────────────────────────
function buildLayerPanel() {
    layersList.innerHTML = '';
    const tree = qr.getLayerTree();
    const hasNucleus = qr.getLayerKeys().includes('nucleus');

    // Fila "Todo"
    const allRow = document.createElement('div');
    allRow.className = 'lyr lyr-all';
    allRow.innerHTML = `<label>
        <input type="checkbox" id="chk-all" checked>
        <span class="dot" style="color:#fff">◈</span>
        <span>${t('controls.all')}</span>
    </label>`;
    layersList.appendChild(allRow);

    // ── Esfera (LOD) ── forzada siempre visible para preview de material
    const sphereRow = document.createElement('div');
    sphereRow.className = 'lyr lyr-sphere';
    sphereRow.innerHTML = `
        <div class="orb-main">
            <input type="checkbox" id="chk-sphere" checked>
            <span class="dot" style="color:#64c8ff">◉</span>
            <span class="orb-label">${t('quantum.sphere_lod')}</span>
            <button class="btn-sphere-color" id="btn-sphere-cpk" title="Color shader (default)">⬤</button>
        </div>`;

    sphereRow.querySelector('#chk-sphere').addEventListener('change', e => {
        qr.setSphereVisible(e.target.checked);
    });

    // Botón color — cicla entre: color shader / color del elemento / CPK
    const btnColor = sphereRow.querySelector('#btn-sphere-cpk');
    let colorMode = 0;
    btnColor.addEventListener('click', () => {
        const meta     = qr._meta?.identity ?? {};
        const elColor  = meta.color     ? parseInt(String(meta.color).replace('0x',''), 16)     : null;
        const cpkColor = meta.cpk_color ? parseInt(String(meta.cpk_color).replace('0x',''), 16) : null;
        colorMode = (colorMode + 1) % 3;
        const mat = qr.sphereGroup?.children[0]?.material;
        if (!mat?.uniforms?.uColor) return;
        if (colorMode === 0) {
            mat.uniforms.uColor.value.set(elColor ?? 0xaaaaaa);
            btnColor.title = t('quantum.color_mode_shader');
        } else if (colorMode === 1 && elColor) {
            mat.uniforms.uColor.value.set(elColor);
            btnColor.title = t('quantum.color_mode_element');
        } else if (colorMode === 2 && cpkColor) {
            mat.uniforms.uColor.value.set(cpkColor);
            btnColor.title = t('quantum.color_mode_cpk');
        }
    });

    layersList.appendChild(sphereRow);

    // Núcleo
    if (hasNucleus) layersList.appendChild(makeSingleRow('nucleus', t('quantum.nucleus_label'), '#ffffff'));

    // Layers ordenados
    const layers = Object.keys(tree).sort((a, b) => {
        const ai = LAYER_ORDER.indexOf(a), bi = LAYER_ORDER.indexOf(b);
        return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });

    layers.forEach(layer => {
        const subshells = tree[layer];
        const subKeys   = Object.keys(subshells).sort();
        const grpEl     = document.createElement('div');
        grpEl.className = 'lyr-group';

        const grpHeader = document.createElement('div');
        grpHeader.className = 'lyr-group-header';
        grpHeader.innerHTML = `
            <input type="checkbox" class="grp-chk" data-layer="${layer}" checked>
            <span class="lyr-group-toggle">▾</span>
            <span class="lyr-group-label">${layerLabel(layer)}</span>
            <span class="lyr-group-count">${subKeys.reduce((s,k) => s + subshells[k].length, 0)}</span>`;
        grpEl.appendChild(grpHeader);

        const grpBody = document.createElement('div');
        grpBody.className = 'lyr-group-body';

        grpHeader.querySelector('.lyr-group-toggle').addEventListener('click', () => grpEl.classList.toggle('collapsed'));
        grpHeader.querySelector('.grp-chk').addEventListener('change', e => {
            grpBody.querySelectorAll('.orb-chk').forEach(c => {
                c.checked = e.target.checked;
                qr.setOrbitalVisible(c.dataset.key, e.target.checked);
            });
            syncChkAll();
        });

        subKeys.forEach(subshell => {
            const orbitals = subshells[subshell];
            const color    = subshellColor(subshell);

            if (orbitals.length === 1) {
                grpBody.appendChild(makeOrbitalRow(orbitals[0].key, color, true));
            } else {
                const subEl = document.createElement('div');
                subEl.className = 'lyr-subshell';

                const subHeader = document.createElement('div');
                subHeader.className = 'lyr-sub-header';
                subHeader.innerHTML = `
                    <input type="checkbox" class="sub-chk" data-sub="${subshell}" checked>
                    <span class="dot" style="color:${color}">●</span>
                    <span class="lyr-sub-label">${subshell}</span>
                    <span class="lyr-group-toggle sub-toggle">▾</span>`;
                subEl.appendChild(subHeader);

                const subBody = document.createElement('div');
                subBody.className = 'lyr-sub-body';
                orbitals.forEach(orb => subBody.appendChild(makeOrbitalRow(orb.key, color, false)));
                subEl.appendChild(subBody);

                subHeader.querySelector('.sub-toggle').addEventListener('click', () => subEl.classList.toggle('collapsed'));
                subHeader.querySelector('.sub-chk').addEventListener('change', e => {
                    subBody.querySelectorAll('.orb-chk').forEach(c => {
                        c.checked = e.target.checked;
                        qr.setOrbitalVisible(c.dataset.key, e.target.checked);
                    });
                    syncGrpChk(grpHeader);
                    syncChkAll();
                });

                grpBody.appendChild(subEl);
            }
        });

        grpEl.appendChild(grpBody);
        layersList.appendChild(grpEl);
    });

    document.getElementById('chk-all')?.addEventListener('change', e => {
        layersList.querySelectorAll('.orb-chk').forEach(c => {
            c.checked = e.target.checked;
            qr.setOrbitalVisible(c.dataset.key, e.target.checked);
        });
        if (hasNucleus) qr.setLayerVisible('nucleus', e.target.checked);
        layersList.querySelectorAll('.grp-chk,.sub-chk,.single-chk').forEach(c => c.checked = e.target.checked);
    });
}

function makeOrbitalRow(key, color, showDot) {
    const el = document.createElement('div');
    el.className = 'lyr-orbital';
    const m = key.match(/^(.+)_m([+-]?\d+)$/);
    const sub   = m ? m[1] : key;
    const mval  = m ? parseInt(m[2]) : null;
    const mLabel = mval !== null ? `m${mval >= 0 ? '+' : ''}${mval}` : '';

    el.innerHTML = `
        <div class="orb-main">
            <input type="checkbox" class="orb-chk" data-key="${key}" checked>
            ${showDot ? `<span class="dot" style="color:${color}">●</span>` : ''}
            <span class="orb-label">${sub}</span>
            ${mLabel ? `<span class="orb-m">${mLabel}</span>` : ''}
            <button class="orb-expand-btn" title="Tune individual">⋯</button>
        </div>
        <div class="orb-tune" hidden>
            <div class="orb-trow">
                <span class="orb-tlabel">Brillo</span>
                <input type="range" class="orb-sl" data-param="bright" data-key="${key}" min="0" max="15" step="0.1" value="5.0">
                <span class="orb-tval">5.0</span>
            </div>
            <div class="orb-trow">
                <span class="orb-tlabel">Tamaño</span>
                <input type="range" class="orb-sl" data-param="size" data-key="${key}" min="0.1" max="4" step="0.05" value="1.0">
                <span class="orb-tval">1.0</span>
            </div>
            <div class="orb-trow">
                <span class="orb-tlabel">Vel.</span>
                <input type="range" class="orb-sl" data-param="speed" data-key="${key}" min="0" max="4" step="0.05" value="1.0">
                <span class="orb-tval">1.0</span>
            </div>
        </div>`;

    el.querySelector('.orb-chk').addEventListener('change', e => {
        qr.setOrbitalVisible(key, e.target.checked);
        syncChkAll();
    });
    el.querySelector('.orb-expand-btn').addEventListener('click', () => {
        const tuneDiv = el.querySelector('.orb-tune');
        tuneDiv.hidden = !tuneDiv.hidden;
        el.classList.toggle('orb-expanded', !tuneDiv.hidden);
    });
    el.querySelectorAll('.orb-sl').forEach(sl => {
        const vl = sl.nextElementSibling;
        sl.addEventListener('input', () => {
            const v = parseFloat(sl.value);
            qr.setTuning(sl.dataset.param, v, sl.dataset.key);
            if (vl) vl.textContent = v.toFixed(1);
        });
    });

    return el;
}

function makeSingleRow(key, label, color) {
    const el = document.createElement('div');
    el.className = 'lyr lyr-single';
    el.innerHTML = `
        <input type="checkbox" class="single-chk" checked>
        <span class="dot" style="color:${color}">●</span>
        <span>${label}</span>`;
    el.querySelector('.single-chk').addEventListener('change', e => {
        qr.setLayerVisible(key, e.target.checked);
        syncChkAll();
    });
    return el;
}

function syncGrpChk(grpHeader) {
    const body = grpHeader.nextElementSibling;
    const all  = [...body.querySelectorAll('.orb-chk')];
    const chk  = grpHeader.querySelector('.grp-chk');
    if (chk && all.length) chk.checked = all.every(c => c.checked);
}

function syncChkAll() {
    const all = [...layersList.querySelectorAll('.orb-chk,.single-chk')];
    const chk = document.getElementById('chk-all');
    if (chk && all.length) chk.checked = all.every(c => c.checked);
}

// ── Selector de elementos ─────────────────────────────────────────────────────
function buildSelector() {
    const grid    = document.getElementById('qv-grid');
    const search  = document.getElementById('qv-search');
    const grpBtns = document.querySelectorAll('.grp-btn');
    const all     = ElementLoader.getAllMeta();
    let   group   = 'all';

    function render(list) {
        grid.innerHTML = '';
        list.forEach(el => {
            const hex = parseInt((el.color ?? '0xaaaaaa').replace('0x',''), 16);
            const btn = document.createElement('button');
            btn.className   = 'el-btn';
            btn.dataset.sym = el.symbol;
            btn.innerHTML   = `<span class="el-num">${el.number}</span>
                               <span class="el-sym" style="color:#${hex.toString(16).padStart(6,'0')}">${el.symbol}</span>
                               <span class="el-name-small">${getLanguage() === 'en' ? (el.name_eng ?? el.symbol) : (el.name_es ?? el.symbol)}</span>`;
            btn.addEventListener('click', () => {
                selectElement(el.symbol);
            });
            grid.appendChild(btn);
        });
    }

    function filter() {
        const q = search.value.trim().toLowerCase();
        let list = group === 'all' ? all : all.filter(e => e.group === group);
        if (q) list = list.filter(e =>
            e.symbol.toLowerCase().includes(q) ||
            (e.name_es  ?? '').toLowerCase().includes(q) ||
            (e.name_eng ?? '').toLowerCase().includes(q) ||
            String(e.number).includes(q)
        );
        render(list);
    }

    search.addEventListener('input', filter);
    grpBtns.forEach(b => b.addEventListener('click', () => {
        grpBtns.forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        group = b.dataset.group;
        filter();
    }));
    render(all);
}

// ── Cargar elemento ───────────────────────────────────────────────────────────
async function selectElement(symbol) {
    if (loading) return;
    loading = true;
    document.getElementById('qv-load-sym').textContent = symbol;
    document.getElementById('qv-loading').classList.add('visible');
    document.querySelectorAll('.el-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.sym === symbol)
    );
    try {
        // Guardar estado ANTES de buildLayerPanel — recrea el DOM con checked=true por defecto
        const sphereWasVisible = document.getElementById('chk-sphere')?.checked ?? true;
        await qr.loadElement(symbol);
        buildLayerPanel();
        // Restaurar estado previo del usuario, no el default del DOM recién creado
        const chkSphere = document.getElementById('chk-sphere');
        if (chkSphere) chkSphere.checked = sphereWasVisible;
        if (sphereWasVisible) qr.showSphere();
        else { qr._lodFade = 0.0; qr._orbitFade = 1.0; qr._applyFades(); }
        // Panel: no se abre automáticamente — el usuario decide
    } finally {
        document.getElementById('qv-loading').classList.remove('visible');
        loading = false;
    }
}

// ── Fullscreen ────────────────────────────────────────────────────────────────
const fsBtn = document.getElementById('qv-fullscreen-btn');
if (fsBtn) {
    const updateFsIcon = () => {
        const isFull = !!(document.fullscreenElement || document.webkitFullscreenElement);
        fsBtn.textContent = isFull ? '✕' : '⛶';
        fsBtn.title = isFull ? t('tooltips.fullscreen_exit') : t('tooltips.fullscreen');
    };
    fsBtn.addEventListener('click', () => {
        const el = document.documentElement;
        if (document.fullscreenElement || document.webkitFullscreenElement) {
            (document.exitFullscreen || document.webkitExitFullscreen).call(document);
        } else {
            (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
        }
    });
    document.addEventListener('fullscreenchange',       updateFsIcon);
    document.addEventListener('webkitfullscreenchange', updateFsIcon);
}

window._qr = qr;
