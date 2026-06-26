/**
 * GroupPanel.js — Panel lateral de grupos
 * Usa clases: .group-panel, .group-item, .group-item--off, .group-panel__header, .btn-sm
 */

import { ElementSelector } from './ElementSelector.js';
import { t } from '../data/i18n.js';

const GROUPS = [
    { key: 'nonmetals',         elemKey: 'nonmetal',         name_es: 'No Metales',            name_en: 'Nonmetals',         color: '#00d2ff' },
    { key: 'noble_gases',       elemKey: 'noble_gas',        name_es: 'Gases Nobles',          name_en: 'Noble Gases',       color: '#c471f5' },
    { key: 'halogens',          elemKey: 'halogen',          name_es: 'Halógenos',             name_en: 'Halogens',          color: '#f093fb' },
    { key: 'alkali_metals',     elemKey: 'alkali_metal',     name_es: 'Metales Alcalinos',     name_en: 'Alkali Metals',     color: '#ff6b6b' },
    { key: 'alkaline_earth',    elemKey: 'alkaline_earth',   name_es: 'Alcalinotérreos',       name_en: 'Alkaline Earth',    color: '#ffd93d' },
    { key: 'transition_metals', elemKey: 'transition_metal', name_es: 'Metales de Transición', name_en: 'Transition Metals', color: '#95e1d3' },
    { key: 'post_transition',   elemKey: 'post_transition',  name_es: 'Post-Transición',       name_en: 'Post-Transition',   color: '#a8e6cf' },
    { key: 'metalloids',        elemKey: 'metalloid',        name_es: 'Metaloides',            name_en: 'Metalloids',        color: '#dcedc1' },
    { key: 'lanthanides',       elemKey: 'lanthanide',       name_es: 'Lantánidos',            name_en: 'Lanthanides',       color: '#fa709a' },
    { key: 'actinides',         elemKey: 'actinide',         name_es: 'Actínidos',             name_en: 'Actinides',         color: '#fee140' },
    { key: 'superheavy',        elemKey: 'superheavy',       name_es: 'Superpesados',          name_en: 'Superheavy',        color: '#ff1493' },
];

const STORAGE_KEY = 'qsim_groups';

class _GroupPanel {

    constructor() {
        this._container = null;
        this._state     = {};
        this._lang      = 'es';
    }

    init() {
        this._container = document.getElementById('groupPanel');
        if (!this._container) return;
        this._loadState();
        this._render();
        this._applyAll();
        document.addEventListener('languageChanged', e => this.setLang(e.detail.lang));
    }

    setLang(lang) {
        this._lang = lang;
        this._render();
    }

    _loadState() {
        try {
            const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
            GROUPS.forEach(g => {
                this._state[g.key] = saved[g.key] !== undefined ? saved[g.key] : true;
            });
        } catch {
            GROUPS.forEach(g => { this._state[g.key] = true; });
        }
    }

    _saveState() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this._state));
    }

    _toggle(key) {
        this._state[key] = !this._state[key];
        this._saveState();
        ElementSelector.setGroupActive(key, this._state[key]);
        // Actualizar visual del item
        const item = this._container.querySelector(`[data-group-key="${key}"]`);
        if (item) {
            item.classList.toggle('group-item--off', !this._state[key]);
            item.querySelector('.group-item__toggle').textContent = this._state[key] ? '●' : '○';
        }
    }

    _applyAll() {
        GROUPS.forEach(g => ElementSelector.setGroupActive(g.key, this._state[g.key]));
    }

    _setAll(active) {
        GROUPS.forEach(g => { this._state[g.key] = active; });
        this._saveState();
        this._applyAll();
        this._render();
    }

    _render() {
        if (!this._container) return;
        this._container.innerHTML = '';

        // Header
        const header = document.createElement('div');
        header.className = 'group-panel__header';
        header.innerHTML = `
            <span class="group-panel__title" data-i18n="groups.title">Grupos</span>
            <div class="group-panel__actions">
                <button class="btn-sm" id="gpAll">${t('controls.all')}</button>
                <button class="btn-sm" id="gpNone">${t('controls.none')}</button>
            </div>
        `;
        this._container.appendChild(header);

        header.querySelector('#gpAll')?.addEventListener('click',  () => this._setAll(true));
        header.querySelector('#gpNone')?.addEventListener('click', () => this._setAll(false));

        // Lista
        const list = document.createElement('div');
        list.className = 'group-panel__list';

        GROUPS.forEach(g => {
            const active = this._state[g.key];
            const name   = this._lang === 'en' ? g.name_en : g.name_es;

            const item = document.createElement('button');
            item.className = `group-item${active ? '' : ' group-item--off'}`;
            item.dataset.groupKey = g.key;
            item.innerHTML = `
                <span class="group-item__dot" style="background:${g.color}"></span>
                <span class="group-item__name">${name}</span>
                <span class="group-item__toggle">${active ? '●' : '○'}</span>
            `;
            item.addEventListener('click', () => this._toggle(g.key));
            list.appendChild(item);
        });

        this._container.appendChild(list);
    }
}

export const GroupPanel = new _GroupPanel();
