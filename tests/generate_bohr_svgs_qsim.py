"""
generate_bohr_svgs.py — Generador de diagramas de Bohr SVG para todos los elementos
=====================================================================================
Lee los JSONs de elementos desde src/elements/ y genera un SVG por elemento
con el diagrama de Bohr clásico: órbitas concéntricas con electrones por capa.

Los SVGs se resaltan dinámicamente desde el panel QV del QSim cuando el usuario
activa/desactiva capas — cada órbita tiene un id="shell-N" para CSS/JS targeting.

Uso:
    python generate_bohr_svgs.py --elements-dir /ruta/src/elements \
                                  --index /ruta/src/elements-index.json \
                                  --out /ruta/src/bohr

    # Solo un elemento de prueba:
    python generate_bohr_svgs.py --elements-dir /ruta/src/elements \
                                  --index /ruta/src/elements-index.json \
                                  --out /ruta/src/bohr \
                                  --only Fe,H,O,C,N

Output: src/bohr/Fe.svg, H.svg, O.svg ... (118 archivos)
"""

import json
import math
import re
import argparse
from pathlib import Path

# ── Configuraciones de gases nobles para expandir cores ───────────────────────
NOBLE_CORES = {
    'He': '1s2',
    'Ne': '1s2 2s2 2p6',
    'Ar': '1s2 2s2 2p6 3s2 3p6',
    'Kr': '1s2 2s2 2p6 3s2 3p6 3d10 4s2 4p6',
    'Xe': '1s2 2s2 2p6 3s2 3p6 3d10 4s2 4p6 4d10 5s2 5p6',
    'Rn': '1s2 2s2 2p6 3s2 3p6 3d10 4s2 4p6 4d10 4f14 5s2 5p6 5d10 6s2 6p6',
}

# ── Colores por subshell (coherentes con SUBSHELL_COLORS del QSim) ────────────
SUBSHELL_COLORS_HEX = {
    's': '#00ffff',  # cyan
    'p': '#ff4fff',  # magenta
    'd': '#ffa500',  # naranja
    'f': '#66ff66',  # verde
}

def subshell_color(l_char, n, fade=True):
    base = SUBSHELL_COLORS_HEX.get(l_char, '#aaaaaa')
    if not fade:
        return base
    f = max(0.35, 1.0 - (n - 1) * 0.1)
    r = int(base[1:3], 16)
    g = int(base[3:5], 16)
    b = int(base[5:7], 16)
    return f'rgb({int(r*f)},{int(g*f)},{int(b*f)})'

def expand_config(cfg_string):
    """Expande [Ar] 3d6 4s2 → configuración completa."""
    m = re.match(r'\[(\w+)\](.*)', cfg_string.strip())
    if m:
        core_sym, rest = m.group(1), m.group(2).strip()
        core_cfg = NOBLE_CORES.get(core_sym, '')
        return f'{core_cfg} {rest}'.strip()
    return cfg_string.strip()

def parse_subshells(cfg_string):
    """
    Parsea config → dict {n: [(l, count), ...]} agrupado por capa principal.
    Ejemplo: Fe → {1:[('s',2)], 2:[('s',2),('p',6)], 3:[('s',2),('p',6),('d',6)], 4:[('s',2)]}
    """
    from collections import defaultdict
    full = expand_config(cfg_string)
    by_shell = defaultdict(list)
    for tok in full.split():
        m = re.match(r'(\d+)([spdf])(\d+)', tok)
        if m:
            n, l, count = int(m[1]), m[2], int(m[3])
            by_shell[n].append((l, count))
    return dict(sorted(by_shell.items()))

def nucleus_color(group):
    """Color del núcleo según el grupo del elemento."""
    palette = {
        'noble_gas':        '#00e5ff',
        'halogen':          '#c77dff',
        'nonmetal':         '#aaffaa',
        'alkali':           '#ff6b35',
        'alkaline':         '#ffaa00',
        'transition_metal': '#ff6b9d',
        'post_transition':  '#90e0ef',
        'metalloid':        '#b5e48c',
        'lanthanide':       '#66ff66',
        'actinide':         '#ff4d6d',
    }
    return palette.get(group, '#ff6b35')


# ── Orden de Aufbau para llenar orbitales ─────────────────────────────────────
AUFBAU_ORDER = [
    (1,'s'), (2,'s'), (2,'p'), (3,'s'), (3,'p'), (4,'s'), (3,'d'), (4,'p'),
    (5,'s'), (4,'d'), (5,'p'), (6,'s'), (4,'f'), (5,'d'), (6,'p'),
    (7,'s'), (5,'f'), (6,'d'), (7,'p'),
]

L_DEGENERACY = {'s': 1, 'p': 3, 'd': 5, 'f': 7}  # número de cajas por subshell

def fill_spins(subshell_data):
    """
    Dada la configuración por capa, devuelve los orbitales en orden Aufbau
    con sus espines: [(n, l, [spins...]), ...]
    donde spins es lista de 'up', 'down', o None (vacío).
    """
    # Aplanar todos los subshells con sus conteos
    counts = {}
    for n, subs in subshell_data.items():
        for l_char, count in subs:
            counts[(n, l_char)] = count

    result = []
    for (n, l_char) in AUFBAU_ORDER:
        count = counts.get((n, l_char), 0)
        if count == 0:
            continue
        degen = L_DEGENERACY[l_char]
        # Regla de Hund: primero un ↑ en cada caja, luego ↓
        spins = [None] * degen
        # Primera pasada — ↑
        for i in range(min(count, degen)):
            spins[i] = 'up'
        # Segunda pasada — ↓
        for i in range(max(0, count - degen)):
            spins[i] = 'down_up'  # caja con par
        result.append((n, l_char, spins, count))
    return result


def generate_bohr_svg_classic(symbol, number, shells, group, W=320, H=320,
                               cpk_color=None, el_color=None):
    """Vista 1 — Bohr clásico por capas (un anillo por capa, color por índice)."""
    SHELL_COLORS = ['#00e5ff','#00b4d8','#c77dff','#9b5de5','#ff9a00','#ff6b35','#66ff66']
    cx, cy = W // 2, H // 2
    n_shells  = len(shells)
    nucleus_r = max(10, min(18, 20 - n_shells))
    max_r     = (min(W, H) // 2) - 22
    gap       = (max_r - nucleus_r) / max(n_shells, 1)
    e_r       = max(2.5, min(5, 6 - n_shells // 2))

    if cpk_color:
        nuc_color = f'#{int(str(cpk_color).replace("0x",""), 16):06x}'
    elif el_color:
        nuc_color = f'#{int(str(el_color).replace("0x",""), 16):06x}'
    else:
        nuc_color = nucleus_color(group)

    lines = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" '
             f'width="{W}" height="{H}" style="background:#060d1a" '
             f'data-symbol="{symbol}" data-view="classic">']
    lines.append('''<defs>
  <filter id="glow"><feGaussianBlur stdDeviation="2" result="b"/>
  <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  <filter id="ng"><feGaussianBlur stdDeviation="4" result="b"/>
  <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
</defs>''')

    for i, count in enumerate(shells):
        r     = nucleus_r + gap * (i + 1)
        color = SHELL_COLORS[min(i, len(SHELL_COLORS)-1)]
        lines.append(f'<g id="shell-{i}" class="bohr-shell" data-shell="{i}">')
        lines.append(f'  <circle cx="{cx}" cy="{cy}" r="{r:.1f}" fill="none" '
                     f'stroke="{color}" stroke-width="0.7" opacity="0.3"/>')
        for j in range(count):
            angle = (2 * math.pi * j / count) - math.pi / 2
            ex, ey = cx + r * math.cos(angle), cy + r * math.sin(angle)
            lines.append(f'  <circle cx="{ex:.2f}" cy="{ey:.2f}" r="{e_r:.1f}" '
                         f'fill="{color}" filter="url(#glow)" opacity="0.85"/>')
        lines.append('</g>')

    # Núcleo
    fs = max(8, min(12, nucleus_r))
    lines.append(f'<g id="nucleus"><circle cx="{cx}" cy="{cy}" r="{nucleus_r}" '
                 f'fill="{nuc_color}" filter="url(#ng)" opacity="0.9"/>'
                 f'<text x="{cx}" y="{cy + fs*0.38:.1f}" text-anchor="middle" '
                 f'font-family="monospace" font-size="{fs}" font-weight="bold" '
                 f'fill="#fff">{symbol}</text></g>')
    lines.append(f'<text x="{cx}" y="{cy - nucleus_r - 5:.1f}" text-anchor="middle" '
                 f'font-family="monospace" font-size="8" fill="#334" opacity="0.6">{number}</text>')
    shell_str = ' · '.join(str(s) for s in shells)
    lines.append(f'<text x="{cx}" y="{H-6}" text-anchor="middle" '
                 f'font-family="monospace" font-size="7" fill="#334" opacity="0.4">{shell_str}</text>')
    lines.append('</svg>')
    return '\n'.join(lines)


def generate_orbital_box_svg(symbol, number, shells, group, electron_config='',
                              W=320, H=320, cpk_color=None, el_color=None):
    """Vista 3 — Diagrama de cajas de orbitales con espines (Aufbau + Hund).
    Layout en dos pasadas: primero calcula filas con wrap, luego dibuja."""
    if electron_config:
        subshell_data = parse_subshells(electron_config)
    else:
        subshell_data = {i+1: [('s', count)] for i, count in enumerate(shells)}

    orbital_list = fill_spins(subshell_data)
    if not orbital_list:
        return f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}"/>'

    if cpk_color:
        nuc_color = f'#{int(str(cpk_color).replace("0x",""), 16):06x}'
    elif el_color:
        nuc_color = f'#{int(str(el_color).replace("0x",""), 16):06x}'
    else:
        nuc_color = nucleus_color(group)

    pad_x     = 10
    pad_top   = 20
    pad_bot   = 14
    box_w     = 13
    box_h     = 15
    box_gap   = 1
    sub_gap   = 5
    n_label_w = 22
    usable_w  = W - pad_x * 2 - n_label_w

    # ── Primera pasada: calcular filas con wrap ───────────────────────────────
    by_n = defaultdict(list)
    for (n, l_char, spins, count) in orbital_list:
        by_n[n].append((l_char, spins, count))

    rows = []  # [(n_label, [(l_char, spins, color, label), ...]), ...]

    for n in sorted(by_n.keys()):
        row_items = []
        row_w     = 0
        is_first  = True

        for (l_char, spins, count) in by_n[n]:
            degen  = len(spins)
            item_w = degen * (box_w + box_gap) + sub_gap
            color  = SUBSHELL_COLORS_HEX.get(l_char, '#aaaaaa')

            if not is_first and row_w + item_w > usable_w:
                rows.append((f'n={n}' if is_first else '', row_items))
                row_items = []
                row_w     = 0

            row_items.append((l_char, spins, color, f'{n}{l_char}'))
            row_w    += item_w
            is_first  = False

        if row_items:
            rows.append((f'n={n}', row_items))

    n_rows  = len(rows)
    row_h   = max((H - pad_top - pad_bot) / max(n_rows, 1), box_h + 14)
    # Ajustar H si hace falta
    need_h  = int(pad_top + pad_bot + n_rows * row_h) + 4
    if need_h > H:
        H = need_h

    lines = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" '
             f'width="{W}" height="{H}" style="background:#060d1a" '
             f'data-symbol="{symbol}" data-view="orbital">']
    lines.append(f'''<defs>
  <marker id="arr" markerWidth="5" markerHeight="5" refX="2.5" refY="2.5" orient="auto">
    <path d="M0,0 L5,2.5 L0,5 Z" fill="#888"/>
  </marker>
  <marker id="arr-dn" markerWidth="5" markerHeight="5" refX="2.5" refY="2.5" orient="auto-start-reverse">
    <path d="M0,0 L5,2.5 L0,5 Z" fill="#888"/>
  </marker>
</defs>''')

    lines.append(f'<text x="{W//2}" y="13" text-anchor="middle" '
                 f'font-family="monospace" font-size="9" fill="{nuc_color}" '
                 f'opacity="0.9">{symbol} — orbitales</text>')

    # ── Segunda pasada: dibujar ───────────────────────────────────────────────
    for ri, (n_label, items) in enumerate(rows):
        cy_row = pad_top + ri * row_h + row_h / 2

        if n_label:
            lines.append(f'<text x="{pad_x}" y="{cy_row + 3:.1f}" '
                         f'font-family="monospace" font-size="7" '
                         f'fill="#446" opacity="0.7">{n_label}</text>')

        x_cur = pad_x + n_label_w

        for (l_char, spins, color, label) in items:
            degen = len(spins)
            lines.append(f'<text x="{x_cur}" y="{cy_row - box_h/2 - 2:.1f}" '
                         f'font-family="monospace" font-size="6.5" '
                         f'fill="{color}" opacity="0.8">{label}</text>')

            for bi, spin in enumerate(spins):
                bx = x_cur + bi * (box_w + box_gap)
                by = cy_row - box_h / 2
                lines.append(f'<rect x="{bx:.1f}" y="{by:.1f}" '
                             f'width="{box_w}" height="{box_h}" '
                             f'fill="none" stroke="{color}" '
                             f'stroke-width="0.6" opacity="0.4" rx="1"/>')
                mx = bx + box_w / 2
                if spin == 'down_up':
                    _arrow(lines, mx - 2.5, by, box_h, color, up=True)
                    _arrow(lines, mx + 2.5, by, box_h, color, up=False)
                elif spin == 'up':
                    _arrow(lines, mx, by, box_h, color, up=True)

            x_cur += degen * (box_w + box_gap) + sub_gap

    lines.append(f'<text x="{W - pad_x}" y="{H - 4}" text-anchor="end" '
                 f'font-family="monospace" font-size="7" fill="#334" '
                 f'opacity="0.5">Z={number}</text>')
    lines.append('</svg>')
    return '\n'.join(lines)


def _arrow(lines, x, by, box_h, color, up=True):
    """Dibuja una flecha de espín dentro de una caja orbital."""
    margin = 3
    x1, y1 = x, by + (margin if up else box_h - margin)
    x2, y2 = x, by + (box_h - margin if up else margin)
    lines.append(f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" '
                 f'stroke="{color}" stroke-width="1.2" opacity="0.85" '
                 f'marker-{"end" if up else "start"}="url(#arr)"/>')



def generate_bohr_svg(symbol, number, shells, group, electron_config='', W=320, H=320,
                      cpk_color=None, el_color=None):
    """
    Vista QSim experimental.
    Mantiene compatibilidad con data-shell/data-n/data-l/data-count.
    """

    cx, cy = W // 2, H // 2

    if electron_config:
        subshell_data = parse_subshells(electron_config)
    else:
        subshell_data = {i+1: [('s', count)] for i, count in enumerate(shells)}

    n_shells = len(subshell_data)
    total_rings = sum(len(v) for v in subshell_data.values())

    nucleus_r = max(10, min(18, 20 - n_shells))
    max_orbit_r = (min(W, H) // 2) - 22
    electron_r = max(2.0, min(4.5, 5.5 - n_shells // 2))

    available = max_orbit_r - nucleus_r
    total_weight = n_shells * 3 + total_rings
    unit = available / max(total_weight, 1)

    gap_shell = unit * 3
    gap_sub = unit

    if cpk_color:
        nuc_color = f'#{int(str(cpk_color).replace("0x",""),16):06x}'
    elif el_color:
        nuc_color = f'#{int(str(el_color).replace("0x",""),16):06x}'
    else:
        nuc_color = nucleus_color(group)

    max_n = max(subshell_data.keys())

    lines = [f'<svg xmlns="http://www.w3.org/2000/svg" '
             f'viewBox="0 0 {W} {H}" width="{W}" height="{H}" '
             f'data-symbol="{symbol}" '
             f'data-shells="{",".join(str(s) for s in shells)}">']

    lines.append("""
<defs>
<radialGradient id="bg">
  <stop offset="0%" stop-color="#0d1730"/>
  <stop offset="100%" stop-color="#060d1a"/>
</radialGradient>

<filter id="glow">
  <feGaussianBlur stdDeviation="2" result="b"/>
  <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
</filter>

<filter id="strongGlow">
  <feGaussianBlur stdDeviation="4" result="b"/>
  <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
</filter>
</defs>
""")

    lines.append(f'<rect width="{W}" height="{H}" fill="url(#bg)"/>')

    shell_idx = 0
    current_r = nucleus_r

    for n, subshells in subshell_data.items():
        current_r += gap_shell

        for si, (l_char, count) in enumerate(subshells):

            if si > 0:
                current_r += gap_sub

            r = current_r
            color = subshell_color(l_char, n)
            label = f"{n}{l_char}"

            is_outer = n >= (max_n - 1)

            lines.append(
                f'<g id="shell-{shell_idx}" class="bohr-shell" '
                f'data-shell="{shell_idx}" data-n="{n}" data-l="{l_char}" '
                f'data-label="{label}" data-count="{count}">'
            )

            lines.append(
                f'<circle cx="{cx}" cy="{cy}" r="{r:.1f}" '
                f'fill="none" stroke="{color}" '
                f'stroke-width="{1.8 if is_outer else 0.7}" '
                f'stroke-dasharray="3 6" '
                f'opacity="{0.55 if is_outer else 0.12}" '
                f'filter="url(#glow)"/>'
            )

            for j in range(count):
                angle = (2 * math.pi * j / count) - math.pi / 2
                ex = cx + r * math.cos(angle)
                ey = cy + r * math.sin(angle)

                lines.append(
                    f'<circle cx="{ex:.2f}" cy="{ey:.2f}" '
                    f'r="{electron_r*2.4:.1f}" fill="{color}" '
                    f'opacity="0.10" filter="url(#strongGlow)"/>'
                )

                lines.append(
                    f'<circle cx="{ex:.2f}" cy="{ey:.2f}" '
                    f'r="{electron_r:.1f}" fill="{color}" '
                    f'opacity="0.95" filter="url(#glow)" class="electron"/>'
                )

            lines.append('</g>')
            shell_idx += 1

    font_size = max(8, min(12, nucleus_r))

    lines.append('<g id="nucleus">')
    lines.append(f'<circle cx="{cx}" cy="{cy}" r="{nucleus_r*2.2:.1f}" fill="{nuc_color}" opacity="0.06" filter="url(#strongGlow)"/>')
    lines.append(f'<circle cx="{cx}" cy="{cy}" r="{nucleus_r*1.5:.1f}" fill="{nuc_color}" opacity="0.15" filter="url(#glow)"/>')
    lines.append(f'<circle cx="{cx}" cy="{cy}" r="{nucleus_r:.1f}" fill="{nuc_color}" filter="url(#strongGlow)"/>')
    lines.append(
        f'<text x="{cx}" y="{cy + font_size*0.38:.1f}" text-anchor="middle" '
        f'font-family="monospace" font-size="{font_size}" font-weight="bold" fill="#fff">{symbol}</text>'
    )
    lines.append('</g>')

    lines.append('</svg>')
    return "\n".join(lines)



def main():
    parser = argparse.ArgumentParser(description='Generador de SVGs de Bohr para QSim')
    parser.add_argument('--elements-dir', default='./src/elements',
                        help='Carpeta con los JSONs de elementos (default: ./src/elements)')
    parser.add_argument('--index',        default='./src/elements-index.json',
                        help='Ruta al elements-index.json')
    parser.add_argument('--out',          default='./src/bohr',
                        help='Carpeta de salida para los SVGs (default: ./src/bohr)')
    parser.add_argument('--size',         type=int, default=320,
                        help='Tamaño del SVG en px (default: 320)')
    parser.add_argument('--skip-existing', action='store_true',
                        help='No sobreescribir SVGs que ya existen')
    parser.add_argument('--only', default='',
                        help='Generar solo estos elementos (ej: Fe,H,O,C)')
    args = parser.parse_args()

    elements_dir = Path(args.elements_dir)
    index_path   = Path(args.index)
    out_dir      = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    only = set(args.only.split(',')) if args.only else set()

    # Leer índice
    with open(index_path) as f:
        idx = json.load(f)
    elements = idx['elements']

    ok = 0
    skipped = 0
    errors = []

    for sym, meta in elements.items():
        if only and sym not in only:
            continue

        json_path = elements_dir / f'{sym}.json'
        if not json_path.exists():
            skipped += 1
            continue

        try:
            with open(json_path) as f:
                data = json.load(f)

            shells = data.get('atomic_structure', {}).get('shells', [])
            if not shells:
                skipped += 1
                continue

            number  = meta.get('number', 0)
            group   = meta.get('group', '')
            cfg_str = data.get('atomic_structure', {}).get('electron_configuration_string', '')
            identity = data.get('identity', {})
            cpk_color = identity.get('cpk_color', None)
            el_color  = identity.get('color', None)

            svg = generate_bohr_svg(sym, number, shells, group, cfg_str,
                                    args.size, args.size, cpk_color, el_color)

            out_path = out_dir / f'{sym}.svg'          # Vista 2 — subshells
            out_classic = out_dir / f'{sym}_classic.svg' # Vista 1 — clásico
            out_orbital = out_dir / f'{sym}_orbital.svg' # Vista 3 — cajas

            if args.skip_existing and out_path.exists() and out_classic.exists() and out_orbital.exists():
                skipped += 1
                continue

            svg_sub = generate_bohr_svg(sym, number, shells, group, cfg_str,
                                        args.size, args.size, cpk_color, el_color)
            svg_cls = generate_bohr_svg_classic(sym, number, shells, group,
                                                args.size, args.size, cpk_color, el_color)
            svg_orb = generate_orbital_box_svg(sym, number, shells, group, cfg_str,
                                               args.size, args.size, cpk_color, el_color)

            out_path.write_text(svg_sub, encoding='utf-8')
            out_classic.write_text(svg_cls, encoding='utf-8')
            out_orbital.write_text(svg_orb, encoding='utf-8')
            ok += 1
            print(f'  ✓ {sym:3s} — {len(shells)} shells')

        except Exception as e:
            errors.append((sym, str(e)))
            print(f'  ✗ {sym}: {e}')

    print(f'\n{"="*50}')
    print(f'  Generados: {ok} | Saltados: {skipped} | Errores: {len(errors)}')
    print(f'  Output: {out_dir}')
    if errors:
        print(f'  Errores: {errors}')
    print(f'{"="*50}')


if __name__ == '__main__':
    main()
