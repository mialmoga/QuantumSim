import { t } from '../data/i18n.js';

/**
 * LayerPanel.js — Panel de capas orbitales compartido
 * =====================================================
 * Extraído de quantum-view.js para ser reutilizado tanto en el
 * QuantumView standalone como en el panel QV del QSim.
 *
 * Uso:
 *   import { buildLayerPanel } from './LayerPanel.js';
 *   buildLayerPanel(qr, containerElement);
 *
 * El caller es responsable de:
 * - Pasar un QR que ya tiene el elemento cargado (qr.getLayerTree() disponible)
 * - Pasar un containerElement donde se renderiza el panel
 * - Limpiar el container antes si lo desea (buildLayerPanel lo limpia internamente)
 */

// ── Colores canónicos por subcapa (igual que OrbitalBuilder.SUBSHELL_COLORS) ──
const SUBSHELL_COLORS = {
    s: '#00ffff', p: '#ff4fff', d: '#ffa500', f: '#66ff66',
};

const LAYER_ORDER = ['nucleus', 'valence', 'semi', 'core', 'inner'];

function subshellColor(subshell) {
    const m = subshell.match(/^(\d)([spdf])/);
    if (!m) return '#aaaaaa';
    const n = parseInt(m[1]), l = m[2];
    const base = SUBSHELL_COLORS[l] ?? '#aaaaaa';
    const fade = Math.max(0.3, 1 - (n - 1) * 0.12);
    const r = parseInt(base.slice(1, 3), 16);
    const g = parseInt(base.slice(3, 5), 16);
    const b = parseInt(base.slice(5, 7), 16);
    return `rgb(${Math.round(r * fade)},${Math.round(g * fade)},${Math.round(b * fade)})`;
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

// ── Helpers de sincronización ─────────────────────────────────────────────────

function syncGrpChk(grpHeader) {
    const body = grpHeader.nextElementSibling;
    const all  = [...body.querySelectorAll('.orb-chk')];
    const chk  = grpHeader.querySelector('.grp-chk');
    if (chk && all.length) chk.checked = all.every(c => c.checked);
}

function syncChkAll(container) {
    const all = [...container.querySelectorAll('.orb-chk,.single-chk')];
    const chk = container.querySelector('#chk-all');
    if (chk && all.length) chk.checked = all.every(c => c.checked);
}

// ── Fila de un orbital individual ─────────────────────────────────────────────

function makeOrbitalRow(qr, container, key, color, showDot) {
    const el = document.createElement('div');
    el.className = 'lyr-orbital';
    const m     = key.match(/^(.+)_m([+-]?\d+)$/);
    const sub   = m ? m[1] : key;
    const mval  = m ? parseInt(m[2]) : null;
    const mLabel = mval !== null ? `m${mval >= 0 ? '+' : ''}${mval}` : '';

    el.innerHTML = `
        <div class="orb-main">
            <input type="checkbox" class="orb-chk" data-key="${key}" checked>
            ${showDot ? `<span class="dot" style="color:${color}">●</span>` : ''}
            <span class="orb-label">${sub}</span>
            ${mLabel ? `<span class="orb-m">${mLabel}</span>` : ''}
            <button class="orb-expand-btn" title="${t('tooltips.tune_individual')}">⋯</button>
        </div>
        <div class="orb-tune" hidden>
            <div class="orb-trow">
                <span class="orb-tlabel">${t('quantum.brightness')}</span>
                <input type="range" class="orb-sl" data-param="bright" data-key="${key}" min="0" max="15" step="0.1" value="5.0">
                <span class="orb-tval">5.0</span>
            </div>
            <div class="orb-trow">
                <span class="orb-tlabel">${t('quantum.pt_size_short')}</span>
                <input type="range" class="orb-sl" data-param="size" data-key="${key}" min="0.1" max="4" step="0.05" value="1.0">
                <span class="orb-tval">1.0</span>
            </div>
            <div class="orb-trow">
                <span class="orb-tlabel">${t('quantum.speed')}</span>
                <input type="range" class="orb-sl" data-param="speed" data-key="${key}" min="0" max="4" step="0.05" value="1.0">
                <span class="orb-tval">1.0</span>
            </div>
        </div>`;

    el.querySelector('.orb-chk').addEventListener('change', e => {
        qr.setOrbitalVisible(key, e.target.checked);
        syncChkAll(container);
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

function makeSingleRow(qr, container, key, label, color) {
    const el = document.createElement('div');
    el.className = 'lyr lyr-single';
    el.innerHTML = `
        <input type="checkbox" class="single-chk" checked>
        <span class="dot" style="color:${color}">●</span>
        <span>${label}</span>`;
    el.querySelector('.single-chk').addEventListener('change', e => {
        qr.setLayerVisible(key, e.target.checked);
        syncChkAll(container);
    });
    return el;
}

// ── API pública ───────────────────────────────────────────────────────────────

/**
 * Construye el panel de capas orbitales dentro de `container`.
 *
 * @param {QuantumRenderer} qr        — renderer con el elemento cargado
 * @param {HTMLElement}     container — elemento donde se renderiza el panel
 * @param {Object}          opts      — opciones opcionales
 * @param {boolean}         opts.showSphere  — mostrar fila esfera LOD (default: false en QSim, true en QV)
 * @param {Function}        opts.onLayerChange — callback(key, visible) cuando cambia una capa
 * @param {Function}        opts.onBohrHighlight — callback(shellIndex, visible) para resaltar SVG Bohr
 */
export function buildLayerPanel(qr, container, opts = {}) {
    if (!container || !qr) return;
    container.innerHTML = '';

    const {
        showSphere      = false,
        onLayerChange   = null,
        onBohrHighlight = null,
    } = opts;

    const tree       = qr.getLayerTree?.();
    const hasNucleus = qr.getLayerKeys?.().includes('nucleus');

    if (!tree) return;

    // Mapeo layer → índice de shell Bohr (desde afuera → adentro)
    const layerKeys = Object.keys(tree).sort((a, b) => {
        const ai = LAYER_ORDER.indexOf(a), bi = LAYER_ORDER.indexOf(b);
        return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });
    const bohrShellMap = {};
    layerKeys.forEach((l, i) => { bohrShellMap[l] = layerKeys.length - 1 - i; });

    // ── Fila "Todo" ───────────────────────────────────────────────────────────
    const allRow = document.createElement('div');
    allRow.className = 'lyr lyr-all';
    allRow.innerHTML = `<label>
        <input type="checkbox" id="chk-all" checked>
        <span class="dot" style="color:#fff">◈</span>
        <span>${t('controls.all')}</span>
    </label>`;
    container.appendChild(allRow);

    // ── Esfera LOD (opcional) ─────────────────────────────────────────────────
    if (showSphere) {
        const sphereRow = document.createElement('div');
        sphereRow.className = 'lyr lyr-sphere';
        sphereRow.innerHTML = `
            <div class="orb-main">
                <input type="checkbox" id="chk-sphere" checked>
                <span class="dot" style="color:#64c8ff">◉</span>
                <span class="orb-label">${t('quantum.sphere_lod')}</span>
            </div>`;
        sphereRow.querySelector('#chk-sphere').addEventListener('change', e => {
            qr.setSphereVisible(e.target.checked);
        });
        container.appendChild(sphereRow);
    }

    // ── Núcleo ────────────────────────────────────────────────────────────────
    if (hasNucleus) container.appendChild(makeSingleRow(qr, container, 'nucleus', t('quantum.nucleus_label'), '#ffffff'));

    // ── Layers con subshells ──────────────────────────────────────────────────
    layerKeys.forEach(layer => {
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
            <span class="lyr-group-count">${subKeys.reduce((s, k) => s + subshells[k].length, 0)}</span>`;
        grpEl.appendChild(grpHeader);

        const grpBody = document.createElement('div');
        grpBody.className = 'lyr-group-body';

        grpHeader.querySelector('.lyr-group-toggle').addEventListener('click', () => {
            grpEl.classList.toggle('collapsed');
        });

        grpHeader.querySelector('.grp-chk').addEventListener('change', e => {
            const vis = e.target.checked;
            grpBody.querySelectorAll('.orb-chk').forEach(c => {
                c.checked = vis;
                qr.setOrbitalVisible(c.dataset.key, vis);
            });
            onLayerChange?.(layer, vis);
            onBohrHighlight?.(bohrShellMap[layer], vis);
            syncChkAll(container);
        });

        subKeys.forEach(subshell => {
            const orbitals = subshells[subshell];
            const color    = subshellColor(subshell);

            if (orbitals.length === 1) {
                grpBody.appendChild(makeOrbitalRow(qr, container, orbitals[0].key, color, true));
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
                orbitals.forEach(orb => subBody.appendChild(makeOrbitalRow(qr, container, orb.key, color, false)));
                subEl.appendChild(subBody);

                subHeader.querySelector('.sub-toggle').addEventListener('click', () => {
                    subEl.classList.toggle('collapsed');
                });
                subHeader.querySelector('.sub-chk').addEventListener('change', e => {
                    const vis = e.target.checked;
                    subBody.querySelectorAll('.orb-chk').forEach(c => {
                        c.checked = vis;
                        qr.setOrbitalVisible(c.dataset.key, vis);
                    });
                    syncGrpChk(grpHeader);
                    syncChkAll(container);
                });

                grpBody.appendChild(subEl);
            }
        });

        grpEl.appendChild(grpBody);
        container.appendChild(grpEl);
    });

    // ── "Todo" listener ───────────────────────────────────────────────────────
    container.querySelector('#chk-all')?.addEventListener('change', e => {
        const vis = e.target.checked;
        container.querySelectorAll('.orb-chk').forEach(c => {
            c.checked = vis;
            qr.setOrbitalVisible(c.dataset.key, vis);
        });
        if (hasNucleus) qr.setLayerVisible('nucleus', vis);
        container.querySelectorAll('.grp-chk,.sub-chk,.single-chk').forEach(c => c.checked = vis);
        layerKeys.forEach(l => {
            onLayerChange?.(l, vis);
            onBohrHighlight?.(bohrShellMap[l], vis);
        });
    });
}
