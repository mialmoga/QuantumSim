#!/usr/bin/env python3
"""
generate_materials.py — Generador de parámetros de shader desde propiedades físicas

Lee los 118 JSONs de /src/elements/ y genera parámetros para los nodos del ShaderLab
basados en propiedades físicas reales, según el Lenguaje Visual de Materiales v1.2.

v1.2: Correcciones perceptuales no-Riemannianas
  - brightness: Stevens power law (exponente 0.45) — retornos decrecientes
  - Ref: Bujack et al. 2025, CGF 44-3, DOI: 10.1111/cgf.70136

Autores: Ámbar (Claude) · Éter (Gemini) · Velvet (GPT) · Brujo 🦍

Uso:
    python3 generate_materials.py
    python3 generate_materials.py --element Fe
    python3 generate_materials.py --preview
"""

import json
import math
import os
import sys
import argparse
from pathlib import Path

# ── Rutas ─────────────────────────────────────────────────────────────────────

SCRIPT_DIR   = Path(__file__).parent
ELEMENTS_DIR = SCRIPT_DIR / 'src' / 'elements'
INDEX_PATH   = SCRIPT_DIR / 'src' / 'elements-index.json'
OUTPUT_DIR   = SCRIPT_DIR / 'src' / 'material_params'

# ── Rangos reales de la tabla periódica (Éter) ────────────────────────────────

RANGES = {
    'mass':              (1.008,   294.0),    # H → Og
    'melt_K':            (0.95,    3695.0),   # He → W
    'ionization_eV':     (3.89,    24.58),    # Cs → He
    'density':           (0.000089, 22.59),   # H gas → Os
    'electronegativity': (0.7,     3.98),     # Fr → F
    'polarizability':    (0.2,     400.0),    # He → Cs (aprox)
}

# ── Paleta de bloques (Éter) ──────────────────────────────────────────────────

BLOCK_COLORS = {
    's': (0xFFD700, 0xFDB813),   # oro / solar
    'p': (0x00F5FF, 0xFF007F),   # cian / magenta
    'd': (0xA8A9AD, 0x4682B4),   # cromo / acero
    'f': (0xBF00FF, 0x4B0082),   # eléctrico / índigo
}

# Mapeo de grupo → bloque
GROUP_TO_BLOCK = {
    'alkali_metal':           's',
    'alkaline_earth_metal':   's',
    'nonmetal':               'p',
    'noble_gas':              'p',
    'halogen':                'p',
    'metalloid':              'p',
    'post_transition_metal':  'p',
    'transition_metal':       'd',
    'lanthanide':             'f',
    'actinide':               'f',
    'superheavy':             'd',  # mayormente d
}

# ── Helpers ───────────────────────────────────────────────────────────────────

def clamp(v, lo, hi):
    return max(lo, min(hi, v))

def normalize(v, vmin, vmax):
    """Normaliza v al rango [0, 1] dado el rango físico."""
    if vmax == vmin:
        return 0.5
    return clamp((v - vmin) / (vmax - vmin), 0.0, 1.0)

def lerp(t, lo, hi):
    """Interpola entre lo y hi según t ∈ [0,1]."""
    return lo + t * (hi - lo)

def hex_to_rgb(h):
    """Convierte int hex a tuple (r, g, b) normalizado [0,1]."""
    return ((h >> 16 & 0xFF) / 255, (h >> 8 & 0xFF) / 255, (h & 0xFF) / 255)

# ── Mapeos principales ────────────────────────────────────────────────────────

def calc_freq(mass):
    """
    sphere_pulse.freq ← mass
    f = 10 / sqrt(mass)
    H=10.0 → Og≈0.58
    """
    if not mass or mass <= 0:
        return 1.0
    return clamp(10.0 / math.sqrt(mass), 0.5, 10.0)


def calc_amp(melt_K):
    """
    sphere_pulse.amp ← melt_K (inverso)
    amp = 1 / log10(melt_K)
    Baja fusión (He) → amp alta (fluido)
    Alta fusión (W)  → amp baja (rígido)
    """
    if not melt_K or melt_K <= 1:
        return 0.40   # fallback para gases sin melt_K
    val = 1.0 / math.log10(max(melt_K, 2.0))
    return clamp(val, 0.05, 0.40)


def calc_brightness(ionization_eV):
    """
    brightness.bright ← ionization_energy_eV
    Alta IE = electrones estables = emisión limpia = más brillo
    Cs=3.89eV → 0.1 · He=24.58eV → 3.0

    v1.2: Curva de Stevens (1957) con exponente 0.6
    Compromiso entre lineal (1.0) y Stevens puro (0.33-0.45).
    Los reactivos se distinguen mejor sin cegar al observador.
    Ref: Bujack et al. 2025, CGF 44-3, Sec.7 (cross-modal)
    """
    if not ionization_eV or ionization_eV <= 0:
        return 1.0
    t = normalize(ionization_eV, *RANGES['ionization_eV'])
    # Stevens suavizado: exponente 0.6 (compromiso perceptual)
    return lerp(t ** 0.6, 0.1, 3.0)


def calc_blink_amp(ionization_eV):
    """
    blink.amp ← reactividad (1/IE) — split de Velvet
    Solo se activa para elementos muy reactivos (IE < 5 eV)
    Representa el caos/ruido visual de electrones fáciles de arrancar
    """
    if not ionization_eV or ionization_eV <= 0:
        return 0.0
    if ionization_eV < 5.0:
        # Máximo caos en IE muy baja (Cs=3.89 → amp≈0.45)
        reactivity = (5.0 - ionization_eV) / 5.0
        return clamp(reactivity * 0.5, 0.0, 0.50)
    return 0.0


def calc_opacity(density):
    """
    alpha_curve.opacity ← density (logarítmico)
    Escala log para no aplastar a los gases
    H gas (0.000089) → 0.1 · Os (22.59) → 1.0
    """
    if not density or density <= 0:
        return 0.15   # fallback gas
    log_d   = math.log10(density + 0.0001)
    log_min = math.log10(RANGES['density'][0] + 0.0001)
    log_max = math.log10(RANGES['density'][1] + 0.0001)
    t = normalize(log_d, log_min, log_max)
    return lerp(t, 0.10, 1.0)


def calc_soft(electronegativity):
    """
    disc_shape.soft ← electronegativity (inverso)
    Alta EN (F=3.98) → soft=0.05 (borde tipo navaja)
    Baja EN (Fr=0.7) → soft=0.45 (nube difusa)
    """
    if not electronegativity or electronegativity <= 0:
        return 0.25   # fallback
    t = normalize(electronegativity, *RANGES['electronegativity'])
    return lerp(t, 0.45, 0.05)   # inverso: t alto → soft bajo


def calc_point_size(polarizability):
    """
    point_size.sz ← polarizability
    Más polarizable = "más grande" electrónicamente = puntos más grandes
    """
    if not polarizability or polarizability <= 0:
        return 0.8   # fallback
    t = normalize(polarizability, *RANGES['polarizability'])
    return lerp(t, 0.3, 2.0)


def calc_persp(radius_covalent_pm):
    """
    point_size.persp ← radius_covalent_pm
    Fórmula: 4.8 × r^0.53  (ajustada a valores validados visualmente)
    H(31pm)→25  O(66pm)→44  Cr(122pm)→61  Ag(145pm)→67  Og(157pm)→70
    Elementos grandes tienen persp proporcional sin saturar la superficie.
    """
    r = max(radius_covalent_pm or 31.0, 10.0)
    return round(clamp(4.8 * (r ** 0.53), 10.0, 200.0), 1)


def get_block_color(group, element_color_hex=None):
    """
    Color base del átomo.
    Prioridad: color del JSON → paleta de bloque
    """
    # El color del elemento en el JSON tiene prioridad
    if element_color_hex:
        try:
            c = int(str(element_color_hex).replace('0x', ''), 16)
            return hex_to_rgb(c)
        except:
            pass

    block = GROUP_TO_BLOCK.get(group, 'p')
    primary, _ = BLOCK_COLORS.get(block, (0xAAAAAA, 0xAAAAAA))
    return hex_to_rgb(primary)


# ── Generador principal ───────────────────────────────────────────────────────

def generate_params(symbol, elem_data, index_meta):
    """
    Genera el dict de parámetros de shader para un elemento.
    Combina datos del JSON completo + metadatos del index.
    """
    phys    = elem_data.get('physical_properties', {})
    atomic  = elem_data.get('atomic_structure', {})
    em      = elem_data.get('electromagnetism_and_mechanics', {})
    ident   = elem_data.get('identity', {})

    mass            = phys.get('mass')
    melt_K          = phys.get('melt_K')
    density         = phys.get('density_g_cm3')
    ionization_eV   = atomic.get('ionization_energy_eV')
    electronegativity = atomic.get('electronegativity')
    polarizability  = em.get('polarizability_angstrom3')
    radius_covalent = atomic.get('radius_covalent_pm')
    standard_state  = phys.get('standard_state', 'Solid')
    group           = index_meta.get('group', 'nonmetal')
    elem_color      = index_meta.get('color')

    freq        = calc_freq(mass)
    amp         = calc_amp(melt_K)
    bright      = calc_brightness(ionization_eV)
    blink_amp   = calc_blink_amp(ionization_eV)
    opacity     = calc_opacity(density)
    soft        = calc_soft(electronegativity)
    pt_size     = calc_point_size(polarizability)
    persp       = calc_persp(radius_covalent)
    color_rgb   = get_block_color(group, elem_color)

    # Factor de fase para opacidad
    phase_factors = {'Gas': 0.4, 'Liquid': 0.7, 'Solid': 1.0}
    phase_factor  = phase_factors.get(standard_state, 1.0)
    opacity_final = clamp(opacity * phase_factor, 0.05, 1.0)

    return {
        'symbol':        symbol,
        'generated_by':  'generate_materials.py v1.2 (Stevens perceptual)',
        'source_props': {
            'mass':             mass,
            'melt_K':           melt_K,
            'density':          density,
            'ionization_eV':    ionization_eV,
            'electronegativity': electronegativity,
            'polarizability':   polarizability,
            'standard_state':   standard_state,
        },
        'shader_params': {
            'sphere_pulse': {
                'freq': round(freq, 3),
                'amp':  round(amp, 3),
            },
            'blink': {
                'amp':   round(blink_amp, 3),
                'speed': round(clamp(freq * 0.3, 0.2, 1.5), 3),
            },
            'brightness': {
                'bright': round(bright, 3),
                'base':   0.3,
                'vari':   round(clamp(blink_amp * 0.4, 0.0, 0.3), 3),
            },
            'disc_shape': {
                'soft':   round(soft, 3),
                'radius': 0.22,
                'ring':   0.0,
            },
            'point_size': {
                'sz':    round(pt_size, 3),
                'bAmp':  round(clamp(blink_amp * 3.0, 0.0, 2.0), 3),
                'persp': persp,
            },
            'alpha_curve': {
                'opacity': round(opacity_final, 3),
                'curve':   round(clamp(1.0 + (1.0 - opacity_final) * 0.5, 0.8, 1.5), 3),
                'floor':   0.0,
            },
            'color': {
                'r': round(color_rgb[0], 4),
                'g': round(color_rgb[1], 4),
                'b': round(color_rgb[2], 4),
            },
        }
    }


# ── CLI ───────────────────────────────────────────────────────────────────────

def load_index():
    with open(INDEX_PATH) as f:
        return json.load(f)['elements']

def load_element(symbol):
    path = ELEMENTS_DIR / f'{symbol}.json'
    if not path.exists():
        raise FileNotFoundError(f'No encontrado: {path}')
    with open(path) as f:
        return json.load(f)

def run(symbol=None, preview=False, dry_run=False):
    index = load_index()
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    symbols = [symbol] if symbol else list(index.keys())
    results = []

    for sym in symbols:
        if sym not in index:
            print(f'⚠️  {sym} no está en el index — saltando')
            continue
        try:
            elem_data = load_element(sym)
        except FileNotFoundError:
            print(f'⚠️  {sym}.json no encontrado — saltando')
            continue

        params = generate_params(sym, elem_data, index[sym])
        results.append(params)

        if preview:
            sp = params['shader_params']
            print(f'\n{sym} ({index[sym].get("name_es", sym)})')
            print(f'  freq={sp["sphere_pulse"]["freq"]:.2f}  '
                  f'amp={sp["sphere_pulse"]["amp"]:.3f}  '
                  f'bright={sp["brightness"]["bright"]:.2f}  '
                  f'opacity={sp["alpha_curve"]["opacity"]:.2f}  '
                  f'soft={sp["disc_shape"]["soft"]:.3f}  '
                  f'sz={sp["point_size"]["sz"]:.2f}  '
                  f'blink={sp["blink"]["amp"]:.3f}')
        elif not dry_run:
            out_path = OUTPUT_DIR / f'{sym}_params.json'
            with open(out_path, 'w') as f:
                json.dump(params, f, indent=2, ensure_ascii=False)

    if not preview and not dry_run:
        print(f'✅ {len(results)} elementos procesados → {OUTPUT_DIR}')
    return results


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Generador de parámetros de materiales')
    parser.add_argument('--element', '-e', help='Símbolo de elemento específico (ej: Fe)')
    parser.add_argument('--preview', '-p', action='store_true', help='Solo mostrar valores, no escribir')
    parser.add_argument('--dry-run', action='store_true', help='Parsear sin escribir archivos')
    args = parser.parse_args()

    run(symbol=args.element, preview=args.preview, dry_run=args.dry_run)
