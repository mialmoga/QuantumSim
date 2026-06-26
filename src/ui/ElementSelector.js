/**
 * ElementSelector.js — Grid de elementos con filtro por grupo
 * Usa las clases CSS de panels.css: .element-btn, .element-number,
 * .element-symbol, .element-name, .element-search
 */

import { ElementLoader } from '../data/ElementLoader.js';
import { getLanguage }  from '../data/i18n.js';

const GROUP_KEY_MAP = {
    nonmetals:         'nonmetal',
    alkali_metals:     'alkali_metal',
    alkaline_earth:    'alkaline_earth',
    transition_metals: 'transition_metal',
    post_transition:   'post_transition',
    metalloids:        'metalloid',
    halogens:          'halogen',
    noble_gases:       'noble_gas',
    lanthanides:       'lanthanide',
    actinides:         'actinide',
    superheavy:        'superheavy',
};

class _ElementSelector {

    constructor() {
        this._grid            = null;
        this._search          = null;
        this._activeGroup     = 'all';
        this._disabledGroups  = new Set();
    }

    init() {
        this._grid   = document.getElementById('elementGrid');
        this._search = document.getElementById('elementSearch');
        if (!this._grid) return;

        this._search?.addEventListener('input', () => this._render(this._getFiltered()));
        document.addEventListener('languageChanged', () => this._render(this._getFiltered()));
        this._render(this._getFiltered());
    }

    // ── API para GroupPanel ───────────────────────────────────────────────────

    setGroupActive(groupKey, active) {
        const elemKey = GROUP_KEY_MAP[groupKey] ?? groupKey;
        active ? this._disabledGroups.delete(elemKey) : this._disabledGroups.add(elemKey);
        this._render(this._getFiltered());
    }

    filterByGroup(group) {
        this._activeGroup = group;
        this._render(this._getFiltered());
    }

    // ── Internos ──────────────────────────────────────────────────────────────

    _getFiltered() {
        const q   = this._search?.value.trim().toLowerCase() ?? '';
        const all = ElementLoader.getAllMeta();

        let list = this._activeGroup === 'all'
            ? all
            : all.filter(e => e.group === this._activeGroup);

        list = list.filter(e => !this._disabledGroups.has(e.group));

        if (q) list = list.filter(e =>
            e.symbol.toLowerCase().includes(q) ||
            (e.name_es  ?? '').toLowerCase().includes(q) ||
            (e.name_eng ?? '').toLowerCase().includes(q) ||
            String(e.number).includes(q)
        );

        return list;
    }

    _render(list) {
        if (!this._grid) return;
        this._grid.innerHTML = '';

        list.forEach(el => {
            const hex   = parseInt((el.color ?? '0xaaaaaa').replace('0x', ''), 16);
            const color = '#' + hex.toString(16).padStart(6, '0');

            const btn = document.createElement('button');
            btn.className   = 'element-btn';
            btn.dataset.sym = el.symbol;
            const elName    = getLanguage() === 'en' ? (el.name_eng ?? el.symbol) : (el.name_es ?? el.symbol);
            btn.title       = elName;
            btn.innerHTML   = `
                <span class="element-number">${el.number}</span>
                <span class="element-symbol" style="color:${color}">${el.symbol}</span>
                <span class="element-name">${elName}</span>
            `;

            btn.addEventListener('click', () => {
                this._grid.querySelectorAll('.element-btn').forEach(b =>
                    b.classList.toggle('selected', b.dataset.sym === el.symbol)
                );
                document.getElementById('elementSelector')?.classList.add('hidden');
                document.getElementById('dockElements')?.classList.remove('active');

                document.dispatchEvent(new CustomEvent('element:selected', {
                    detail: { symbol: el.symbol }
                }));
            });

            this._grid.appendChild(btn);
        });
    }
}

export const ElementSelector = new _ElementSelector();
