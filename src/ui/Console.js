/**
 * DevConsole.js — Consola del motor de simulación
 *
 * Panel flotante con:
 *   - Log coloreado por tipo (INFO / WARN / ERROR / CMD / RESULT / SYS)
 *   - Input para ejecutar JS arbitrario contra window.QSim
 *   - Historial de comandos (↑↓)
 *   - Intercepta console.log / warn / error del motor (opcional)
 *   - API pública: DevConsole.log(), .warn(), .error(), .sys()
 *
 * Uso desde cualquier módulo:
 *   import { DevConsole } from './src/ui/DevConsole.js';
 *   DevConsole.log('World inicializado', 'INFO');
 */

import { t } from '../data/i18n.js';

const MAX_ENTRIES = 300;
const BADGE_LABELS = {
    info:   'INFO',
    warn:   'WARN',
    error:  'ERR',
    cmd:    'CMD',
    result: '←',
    sys:    'SYS',
};

class _DevConsole {
    constructor() {
        this._log    = null;   // #consoleLog
        this._input  = null;   // #consoleInput
        this._panel  = null;   // #devConsole
        this._history = [];
        this._histIdx = -1;
        this._entryCount = 0;
        this._intercepting = false;
        this._ready = false;
    }

    /** Inicializar — llamar después de DOMContentLoaded */
    init() {
        this._panel = document.getElementById('devConsole');
        this._log   = document.getElementById('consoleLog');
        this._input = document.getElementById('consoleInput');

        if (!this._panel || !this._log || !this._input) {
            console.warn('[DevConsole] DOM no encontrado — ¿falta el HTML?');
            return;
        }

        this._bindUI();
        this._ready = true;

        this.sys('DevConsole lista · escribe QSim para acceder al motor');
    }

    // ── Bind de UI ──────────────────────────────────────────────────────

    _bindUI() {
        // Botón Run
        document.getElementById('consoleRun')?.addEventListener('click', () => this._run());

        // Enter para ejecutar, ↑↓ para historial, Tab para completar
        this._input.addEventListener('keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); this._run(); return; }
            if (e.key === 'ArrowUp')   { e.preventDefault(); this._historyNav(-1); return; }
            if (e.key === 'ArrowDown') { e.preventDefault(); this._historyNav(+1); return; }
            if (e.key === 'Tab')       { e.preventDefault(); this._autocomplete(); return; }
        });

        // Limpiar
        document.getElementById('consoleClear')?.addEventListener('click', () => this.clear());

        // Cerrar
        document.getElementById('consoleClose')?.addEventListener('click', () => this.hide());

        // Toggle desde botón lateral
        document.getElementById('collapseConsole')?.addEventListener('click', () => this.toggle());
    }

    // ── Ejecutar comando ────────────────────────────────────────────────

    _run() {
        const raw = this._input.value.trim();
        if (!raw) return;

        this._addEntry('cmd', raw);
        this._historyPush(raw);
        this._input.value = '';
        this._histIdx = -1;

        try {
            // eslint-disable-next-line no-new-func
            const result = new Function('QSim', `"use strict"; return (${raw})`)(window.QSim);

            if (result instanceof Promise) {
                result
                    .then(v  => this._addEntry('result', this._serialize(v)))
                    .catch(e => this._addEntry('error',  String(e)));
            } else {
                this._addEntry('result', this._serialize(result));
            }
        } catch (err) {
            this._addEntry('error', err.message || String(err));
        }
    }

    _serialize(v) {
        if (v === undefined) return 'undefined';
        if (v === null)      return 'null';
        if (typeof v === 'function') return `[Function: ${v.name || 'anonymous'}]`;
        try {
            return JSON.stringify(v, null, 2);
        } catch {
            return String(v);
        }
    }

    // ── Historial ───────────────────────────────────────────────────────

    _historyPush(cmd) {
        if (this._history[0] !== cmd) this._history.unshift(cmd);
        if (this._history.length > 80) this._history.pop();
    }

    _historyNav(dir) {
        const len = this._history.length;
        if (!len) return;
        this._histIdx = Math.max(-1, Math.min(len - 1, this._histIdx + dir));
        this._input.value = this._histIdx < 0 ? '' : this._history[this._histIdx];
        // Cursor al final
        requestAnimationFrame(() => {
            this._input.setSelectionRange(this._input.value.length, this._input.value.length);
        });
    }

    // ── Autocompletado básico ───────────────────────────────────────────

    _autocomplete() {
        const v = this._input.value;
        if (!v) { this._input.value = 'QSim.'; return; }

        // Resolver el objeto raíz para listar propiedades
        const parts = v.split('.');
        if (parts.length < 2) return;

        const objPath = parts.slice(0, -1).join('.');
        const prefix  = parts[parts.length - 1].toLowerCase();

        try {
            // eslint-disable-next-line no-new-func
            const obj = new Function('QSim', `"use strict"; return ${objPath}`)(window.QSim);
            if (!obj) return;

            const keys = Object.getOwnPropertyNames(Object.getPrototypeOf(obj) || {})
                .concat(Object.keys(obj))
                .filter(k => k.toLowerCase().startsWith(prefix));

            if (keys.length === 1) {
                this._input.value = objPath + '.' + keys[0];
            } else if (keys.length > 1) {
                this._addEntry('result', keys.join('  '));
            }
        } catch { /* no-op */ }
    }

    // ── DOM: agregar entrada ────────────────────────────────────────────

    _addEntry(type, msg) {
        if (!this._log) return;

        const now  = new Date();
        const time = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}:${now.getSeconds().toString().padStart(2,'0')}`;

        const row = document.createElement('div');
        row.className = `log-entry log-entry--${type}`;

        const lines = String(msg).split('\n');
        const preview = lines.length > 6
            ? lines.slice(0, 6).join('\n') + `\n… (+${lines.length - 6} ${t('console.more_lines')})`
            : msg;

        row.innerHTML = `
            <span class="log-entry__time">${time}</span>
            <span class="log-entry__badge">${BADGE_LABELS[type] ?? type.toUpperCase()}</span>
            <span class="log-entry__msg">${this._escapeHtml(String(preview))}</span>
        `;

        this._log.appendChild(row);
        this._entryCount++;

        // Purgar entradas viejas
        while (this._log.children.length > MAX_ENTRIES) {
            this._log.removeChild(this._log.firstChild);
        }

        // Scroll al fondo
        this._log.scrollTop = this._log.scrollHeight;
    }

    _escapeHtml(s) {
        return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    // ── API pública ─────────────────────────────────────────────────────

    log(msg)   { if (this._ready) this._addEntry('info',  msg); }
    warn(msg)  { if (this._ready) this._addEntry('warn',  msg); }
    error(msg) { if (this._ready) this._addEntry('error', msg); }
    sys(msg)   { if (this._ready) this._addEntry('sys',   msg); }
    clear()    { if (this._log) this._log.innerHTML = ''; this._entryCount = 0; }

    show()   { this._panel?.classList.remove('hidden'); this._input?.focus(); }
    hide()   { this._panel?.classList.add('hidden'); }
    toggle() { this._panel?.classList.contains('hidden') ? this.show() : this.hide(); }

    /**
     * Interceptar console.log/warn/error del motor y mostrarlos en la consola.
     * Llamar con DevConsole.interceptConsole() después de init().
     */
    interceptConsole() {
        if (this._intercepting) return;
        this._intercepting = true;

        const _log   = console.log.bind(console);
        const _warn  = console.warn.bind(console);
        const _error = console.error.bind(console);

        console.log = (...args) => {
            _log(...args);
            // Solo mostrar logs del motor (que empiecen con [)
            const s = args.map(String).join(' ');
            if (s.startsWith('[')) this.log(s);
        };
        console.warn = (...args) => {
            _warn(...args);
            this.warn(args.map(String).join(' '));
        };
        console.error = (...args) => {
            _error(...args);
            this.error(args.map(String).join(' '));
        };
    }
}

export const DevConsole = new _DevConsole();
