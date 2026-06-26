#!/usr/bin/env python3
"""
update_real_colors.py — Actualiza el campo 'color' (color real) en:
  1. elements-index.json  →  elements.{SYM}.color
  2. elements/{SYM}.json  →  identity.color

NO toca cpk_color — ese ya es correcto.

Uso:
  python3 update_real_colors.py

Ejecutar desde la raíz del proyecto (donde están elements-index.json y elements/).
El script modifica los archivos IN PLACE. Haz backup antes si quieres.
"""

import json
import os

# ── Colores reales de los 118 elementos ──────────────────────────────────
# Hex sin 0x. Basados en apariencia real de muestra pura a 293K, 1atm.
# Gases: color de descarga o del líquido. Sintéticos: gris neutro.

REAL = {
    'H':  'E8E8F0', 'He': 'FFF5D4',
    'Li': 'C8C8C8', 'Be': 'A8A8A0', 'B':  '6B4C3B', 'C':  '2A2A2A',
    'N':  'D0D8E8', 'O':  'C8D8E8', 'F':  'D8E8D0', 'Ne': 'FF6030',
    'Na': 'C8C8D0', 'Mg': 'B0B0B0', 'Al': 'C0C0C8', 'Si': '788090',
    'P':  'E8E0D0', 'S':  'E8D020', 'Cl': 'C8E8A0', 'Ar': 'C0A8E0',
    'K':  'C0C0C8', 'Ca': 'D0D0C8', 'Sc': 'C8C8C8', 'Ti': 'B0B0B8',
    'V':  'A8A8B0', 'Cr': 'C0C8D0', 'Mn': 'B0A8A0', 'Fe': 'A0A0A0',
    'Co': 'A0A0B0', 'Ni': 'B0B0A8', 'Cu': 'D08050', 'Zn': 'B8C0C8',
    'Ga': 'C8C8D0', 'Ge': '909098', 'As': '808080', 'Se': 'A86840',
    'Br': 'A04020', 'Kr': 'E0E8F0', 'Rb': 'B8B8C0', 'Sr': 'C8C8B0',
    'Y':  'C8C8C8', 'Zr': 'C0C0C0', 'Nb': 'A8A8B0', 'Mo': 'B0B0B0',
    'Tc': 'B0B0B0', 'Ru': 'B0B0B0', 'Rh': 'C0C0C0', 'Pd': 'C8C8C0',
    'Ag': 'D0D0D8', 'Cd': 'D0D0C8', 'In': 'C8C8C8', 'Sn': 'C8C8C0',
    'Sb': 'A0A0A8', 'Te': 'C0B8A0', 'I':  '584068', 'Xe': '90B0E8',
    'Cs': 'C8B850', 'Ba': 'C0C0A0', 'La': 'C8C8C8', 'Ce': 'C8C8B0',
    'Pr': 'C8D0B0', 'Nd': 'C0C0B0', 'Pm': 'B0B0B0', 'Sm': 'B8B8B0',
    'Eu': 'B8B8B0', 'Gd': 'C0C0C0', 'Tb': 'C0C0C0', 'Dy': 'C0C0C0',
    'Ho': 'C0C0C0', 'Er': 'C0C0B0', 'Tm': 'C0C0C0', 'Yb': 'C0C0C0',
    'Lu': 'C0C0C0', 'Hf': 'B8B8C0', 'Ta': 'A8A8B0', 'W':  'A8A8A8',
    'Re': 'B0B0B0', 'Os': 'A0A8B8', 'Ir': 'C0C0C0', 'Pt': 'D0D0D0',
    'Au': 'E8C840', 'Hg': 'D0D0D8', 'Tl': 'B0B0B0', 'Pb': 'A0A0A8',
    'Bi': 'D0C0C8', 'Po': 'A8A8A0', 'At': '908060', 'Rn': 'A0A0A0',
    'Fr': 'B0B0B0', 'Ra': 'A8A8A8', 'Ac': 'C0C0C8', 'Th': 'B8B8B8',
    'Pa': 'B0B0B0', 'U':  'B0B0A0', 'Np': 'A8A8A8', 'Pu': 'A0A0A0',
    'Am': 'A8A8A0', 'Cm': 'A8A8A8', 'Bk': 'A8A8A0', 'Cf': 'A8A8A0',
    'Es': 'A0A0A0', 'Fm': 'A0A0A0', 'Md': 'A0A0A0', 'No': 'A0A0A0',
    'Lr': 'A0A0A0', 'Rf': 'A0A0A0', 'Db': 'A0A0A0', 'Sg': 'A0A0A0',
    'Bh': 'A0A0A0', 'Hs': 'A0A0A0', 'Mt': 'A0A0A0', 'Ds': 'A0A0A0',
    'Rg': 'A0A0A0', 'Cn': 'A0A0A0', 'Nh': 'A0A0A0', 'Fl': 'A0A0A0',
    'Mc': 'A0A0A0', 'Lv': 'A0A0A0', 'Ts': 'A0A0A0', 'Og': 'A0A0A0',
}

def main():
    # ── Rutas ────────────────────────────────────────────────────────────
    index_path   = 'src/elements-index.json'
    elements_dir = 'src/elements'

    if not os.path.exists(index_path):
        print(f'❌ No encontré {index_path}')
        print('   Ejecuta este script desde la raíz del proyecto.')
        return

    # ── 1. Actualizar elements-index.json ────────────────────────────────
    with open(index_path, 'r', encoding='utf-8') as f:
        index = json.load(f)

    idx_changed = 0
    for sym, el in index.get('elements', {}).items():
        if sym in REAL:
            new_color = f'0x{REAL[sym]}'
            if el.get('color') != new_color:
                el['color'] = new_color
                idx_changed += 1

    with open(index_path, 'w', encoding='utf-8') as f:
        json.dump(index, f, indent=2, ensure_ascii=False)

    print(f'✅ elements-index.json — {idx_changed} colores actualizados')

    # ── 2. Actualizar cada elements/{SYM}.json ───────────────────────────
    if not os.path.isdir(elements_dir):
        print(f'⚠️  Carpeta {elements_dir} no encontrada — solo se actualizó el index')
        return

    json_changed = 0
    json_skipped = 0

    for filename in sorted(os.listdir(elements_dir)):
        if not filename.endswith('.json'):
            continue

        filepath = os.path.join(elements_dir, filename)
        sym = filename.replace('.json', '')

        if sym not in REAL:
            json_skipped += 1
            continue

        with open(filepath, 'r', encoding='utf-8') as f:
            data = json.load(f)

        # El color vive en identity.color
        identity = data.get('identity', {})
        new_color = f'0x{REAL[sym]}'

        if identity.get('color') != new_color:
            identity['color'] = new_color
            data['identity'] = identity

            with open(filepath, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=2, ensure_ascii=False)

            json_changed += 1

    print(f'✅ elements/*.json  — {json_changed} archivos actualizados, {json_skipped} sin cambio')
    print(f'\n🎨 Total: {idx_changed + json_changed} cambios de color aplicados')
    print(f'   CPK colors intactos — solo se modificó el campo "color" (color real)')

if __name__ == '__main__':
    main()
