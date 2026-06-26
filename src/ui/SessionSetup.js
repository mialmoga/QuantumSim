/**
 * SessionSetup.js — Modal inicial: idioma + calidad gráfica
 *
 * Extraído de app.js. Controla el panel #loadingConfig que aparece
 * tras completar la carga. Devuelve promesa con { lang, quality }.
 *
 * Uso:
 *   import { SessionSetup } from './src/ui/SessionSetup.js';
 *   const { lang, quality } = await SessionSetup.show();
 */

import { setLanguage, getLanguage, updateDOM } from '../data/i18n.js';

function _setQualityActive(res) {
    document.querySelectorAll('.quality-option').forEach(opt => {
        const active = opt.dataset.res === res;
        opt.classList.toggle('active', active);
        const radio = opt.querySelector('input[type=radio]');
        if (radio) radio.checked = active;
    });
}

function _applyLangPills(lang) {
    document.querySelectorAll('.config-pill[data-lang]').forEach(btn => {
        const active = btn.dataset.lang === lang;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-pressed', String(active));
    });
}

export const SessionSetup = {

    show() {
        return new Promise(resolve => {
            const panel   = document.getElementById('loadingConfig');
            const btn     = document.getElementById('launchBtn');
            const quality = localStorage.getItem('qsim_quality') || 'high';

            _applyLangPills(getLanguage());
            _setQualityActive(quality);
            updateDOM();

            document.querySelectorAll('.config-pill[data-lang]').forEach(pill => {
                pill.addEventListener('click', async () => {
                    await setLanguage(pill.dataset.lang);
                    _applyLangPills(pill.dataset.lang);
                });
            });

            document.querySelectorAll('.quality-option').forEach(opt => {
                opt.addEventListener('click', () => _setQualityActive(opt.dataset.res));
            });

            if (panel) requestAnimationFrame(() => panel.classList.add('visible'));

            if (btn) {
                btn.addEventListener('click', () => {
                    const selectedQuality = document.querySelector('.quality-option.active')?.dataset.res || 'high';
                    localStorage.setItem('qsim_quality', selectedQuality);

                    const el = document.documentElement;
                    (el.requestFullscreen?.() || el.webkitRequestFullscreen?.() || el.mozRequestFullScreen?.())
                        ?.catch(() => {});

                    resolve({ lang: getLanguage(), quality: selectedQuality });
                }, { once: true });
            } else {
                resolve({ lang: getLanguage(), quality: 'high' });
            }
        });
    },

    done() {
        const modal = document.getElementById('loading-modal');
        if (!modal) return;
        modal.style.transition = 'opacity 1.2s ease';
        modal.style.opacity    = '0';
        setTimeout(() => modal.classList.add('hidden'), 1200);
    },

    set(status, detail = '', pct = null) {
        const s = document.getElementById('loadingStatus');
        const d = document.getElementById('loadingDetail');
        const b = document.getElementById('loadingBar');
        if (s) s.textContent = status;
        if (d) d.textContent = detail;
        if (b && pct !== null) b.style.width = pct + '%';
    },
};
