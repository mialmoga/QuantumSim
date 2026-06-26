/**
 * i18n.js — Sistema de internacionalización
 *
 * Carga el JSON de idioma y expone la función t() para obtener textos.
 * Ningún texto visible al usuario debe estar hardcodeado en el código.
 *
 * Uso:
 *   import { t, setLanguage, getLanguage } from './i18n.js';
 *   t('app.title')           // → "Quantum Chemistry Simulator"
 *   t('groups.halogen')      // → "Halógenos" (si idioma es 'es')
 *   t('missing.key')         // → "[missing.key]" (no falla silenciosamente)
 */

// Idiomas disponibles
export const LANGUAGES = Object.freeze({
    es: { label: 'Español', flag: '🇲🇽' },
    en: { label: 'English', flag: '🇺🇸' },
});

// Estado interno
let _currentLang = 'es';
let _strings = {};

/**
 * Inicializa el sistema cargando el idioma guardado o el del sistema.
 * Debe llamarse una vez al arrancar, antes de renderizar la UI.
 *
 * @param {string} [lang] - Forzar idioma específico (opcional)
 */
export async function initI18n(lang) {
    // Prioridad: parámetro → localStorage → idioma del navegador → 'es'
    const preferred = lang
        || localStorage.getItem('qsim_lang')
        || navigator.language?.slice(0, 2)
        || 'es';

    await setLanguage(preferred);
}

/**
 * Cambia el idioma activo y recarga los strings.
 *
 * @param {string} lang - Código de idioma ('es' | 'en')
 */
export async function setLanguage(lang) {
    // Caer a 'es' si el idioma no está disponible
    const target = LANGUAGES[lang] ? lang : 'es';

    try {
        const response = await fetch(`/src/i18n/${target}.json`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        _strings = await response.json();
        _currentLang = target;
        localStorage.setItem('qsim_lang', target);

        // Notificar a la UI para que se actualice
        document.dispatchEvent(new CustomEvent('languageChanged', {
            detail: { lang: target }
        }));
    } catch (err) {
        console.error(`[i18n] No se pudo cargar idioma '${target}':`, err);
        // Si falla, _strings queda como estaba — no se rompe la app
    }
}

/**
 * Obtiene el código del idioma activo.
 *
 * @returns {string}
 */
export function getLanguage() {
    return _currentLang;
}

/**
 * Obtiene un texto por su clave anidada con notación de punto.
 *
 * @param {string} key - Clave del texto (ej: 'app.title', 'groups.halogen')
 * @param {Object} [vars] - Variables para interpolación (ej: {name: 'H2O'})
 * @returns {string}
 *
 * @example
 * t('stats.atoms')          // → "Átomos"
 * t('messages.bond_created') // → "Enlace creado"
 */
export function t(key, vars) {
    // Navegar el objeto anidado por partes de la clave
    const parts = key.split('.');
    let value = _strings;

    for (const part of parts) {
        if (value === undefined || value === null) break;
        value = value[part];
    }

    // Si no se encontró, devolver la clave marcada para detectar fácilmente
    if (typeof value !== 'string') {
        console.warn(`[i18n] Clave no encontrada: '${key}'`);
        return `[${key}]`;
    }

    // Interpolación de variables: {{name}} → valor
    if (vars) {
        return value.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? `{{${k}}}`);
    }

    return value;
}

/**
 * Actualiza todos los elementos del DOM que tienen [data-i18n].
 * Útil al cambiar de idioma sin recargar.
 *
 * @example
 * // En HTML:
 * <span data-i18n="stats.atoms"></span>
 * // Después de llamar updateDOM(), el span mostrará "Átomos" o "Atoms"
 */
export function updateDOM() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        el.textContent = t(key);
    });

    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const key = el.getAttribute('data-i18n-placeholder');
        el.placeholder = t(key);
    });

    document.querySelectorAll('[data-i18n-title]').forEach(el => {
        const key = el.getAttribute('data-i18n-title');
        el.title = t(key);
    });
}

// Actualizar DOM automáticamente cuando cambie el idioma
document.addEventListener('languageChanged', updateDOM);
