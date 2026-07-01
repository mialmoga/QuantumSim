"""
extract_comments.py — Extractor de comentarios del proyecto QSim
=================================================================
Recorre toda la carpeta del proyecto y extrae comentarios de archivos
.js, .py, .glsl, .json (solo top-level keys) con referencia de archivo
y línea. Genera un único archivo estructurado por carpeta.

Uso:
    python extract_comments.py --root /ruta/al/proyecto --out project_comments.md
    python extract_comments.py --root . --out project_comments.md
    python extract_comments.py --root . --out project_comments.md --min-len 20
"""

import os
import re
import argparse
from pathlib import Path
from datetime import datetime

# ── Extensiones a procesar ────────────────────────────────────────────────────
EXTENSIONS = {'.js', '.py', '.glsl', '.mjs', '.html', '.css', '.json'}

# ── Carpetas a ignorar por defecto ────────────────────────────────────────────
IGNORE_DIRS = {
    'node_modules', '.git', 'dist', 'build', '__pycache__',
    '.vscode', 'coverage', '.cache', 'vendor', 'orbital_cache',
}

# ── Patrones separados por tipo: (patron, flags, es_bloque) ──────────────────
# es_bloque=True → re.DOTALL (multilínea)
# es_bloque=False → sin DOTALL (solo una línea)
PATTERNS = {
    '.js': [
        (r'/\*\*(.*?)\*/',   re.DOTALL, True),   # JSDoc
        (r'/\*(.*?)\*/',     re.DOTALL, True),   # bloque
        (r'(?m)^[ \t]*//([^\n]+)', 0,     False),  # línea
    ],
    '.mjs': [
        (r'/\*\*(.*?)\*/',   re.DOTALL, True),
        (r'/\*(.*?)\*/',     re.DOTALL, True),
        (r'(?m)^[ \t]*//([^\n]+)', 0,     False),
    ],
    '.glsl': [
        (r'/\*(.*?)\*/',     re.DOTALL, True),
        (r'(?m)^[ \t]*//([^\n]+)', 0,     False),
    ],
    '.py': [
        (r'"""(.*?)"""',     re.DOTALL, True),   # docstring doble
        (r"'''(.*?)'''",     re.DOTALL, True),   # docstring simple
        (r'(?m)^[ \t]*#([^\n]+)', 0,      False),  # línea
    ],
    '.html': [
        (r'<!--(.*?)-->',    re.DOTALL, True),   # bloque HTML
    ],
    '.css': [
        (r'/\*(.*?)\*/',     re.DOTALL, True),   # bloque CSS
    ],
    '.json': [],  # JSON no tiene comentarios — se omite
}

def extract_comments(filepath, min_len=10):
    """
    Extrae comentarios de un archivo con número de línea aproximado.
    Retorna lista de (line_no, comment_text).
    """
    ext = Path(filepath).suffix.lower()
    if ext not in PATTERNS or not PATTERNS[ext]:
        return []

    try:
        with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
            content = f.read()
    except Exception:
        return []

    results = []

    for (pat, flags, is_block) in PATTERNS[ext]:
        for m in re.finditer(pat, content, flags):
            text = m.group(1).strip()
            # Limpiar asteriscos iniciales de cada línea (JSDoc style)
            text = re.sub(r'\n[ \t]*\*[ \t]?', '\n', text).strip()
            # Filtrar comentarios muy cortos o vacíos
            if len(text) < min_len:
                continue
            # Filtrar separadores visuales ─────────────────
            if re.fullmatch(r'[-=─━*#/\s]+', text):
                continue
            # Filtrar líneas que son solo URLs
            if re.fullmatch(r'https?://\S+', text):
                continue
            # Calcular número de línea aproximado
            line_no = content[:m.start()].count('\n') + 1
            results.append((line_no, text))

    # Ordenar por línea y deduplicar
    results.sort(key=lambda x: x[0])
    seen = set()
    deduped = []
    for ln, txt in results:
        key = (ln, txt[:60])
        if key not in seen:
            seen.add(key)
            deduped.append((ln, txt))

    return deduped


def build_tree(root, min_len=10, extra_ignore=None):
    """
    Recorre el proyecto y agrupa comentarios por carpeta → archivo.
    Retorna dict: { 'carpeta/relativa': { 'archivo.js': [(line, text), ...] } }
    """
    root = Path(root).resolve()
    ignore = IGNORE_DIRS | (extra_ignore or set())
    tree = {}

    for dirpath, dirnames, filenames in os.walk(root):
        # Filtrar carpetas ignoradas
        dirnames[:] = [d for d in dirnames if d not in ignore]

        for fname in sorted(filenames):
            ext = Path(fname).suffix.lower()
            if ext not in EXTENSIONS:
                continue

            fpath = Path(dirpath) / fname
            rel_dir = str(Path(dirpath).relative_to(root)) or '.'
            comments = extract_comments(fpath, min_len=min_len)

            if not comments:
                continue

            if rel_dir not in tree:
                tree[rel_dir] = {}
            tree[rel_dir][fname] = comments

    return tree


def render_markdown(tree, root, min_len):
    """Renderiza el árbol de comentarios como Markdown."""
    lines = []
    lines.append(f"# QSim — Mapa de Comentarios del Proyecto")
    lines.append(f"")
    lines.append(f"> Generado: {datetime.now().strftime('%Y-%m-%d %H:%M')}  ")
    lines.append(f"> Raíz: `{root}`  ")
    lines.append(f"> Longitud mínima de comentario: {min_len} chars")
    lines.append(f"")
    lines.append(f"---")
    lines.append(f"")

    # Índice de carpetas
    lines.append(f"## Índice de carpetas")
    lines.append(f"")
    for folder in sorted(tree.keys()):
        anchor = folder.replace('/', '').replace('.', '').replace(' ', '-').lower()
        file_count = len(tree[folder])
        comment_count = sum(len(v) for v in tree[folder].values())
        lines.append(f"- [`{folder}`](#{anchor}) — {file_count} archivos, {comment_count} comentarios")
    lines.append(f"")
    lines.append(f"---")
    lines.append(f"")

    # Contenido por carpeta
    for folder in sorted(tree.keys()):
        anchor = folder.replace('/', '').replace('.', '').replace(' ', '-').lower()
        total = sum(len(v) for v in tree[folder].values())
        lines.append(f"## `{folder}`")
        lines.append(f"")

        for fname in sorted(tree[folder].keys()):
            comments = tree[folder][fname]
            lines.append(f"### {fname} ({len(comments)} comentarios)")
            lines.append(f"")
            for line_no, text in comments:
                # Multilínea → mostrar como bloque
                if '\n' in text:
                    lines.append(f"**L{line_no}:**")
                    lines.append(f"```")
                    lines.append(text)
                    lines.append(f"```")
                else:
                    # Una línea → inline
                    lines.append(f"- **L{line_no}:** {text}")
            lines.append(f"")

    return '\n'.join(lines)


def main():
    parser = argparse.ArgumentParser(description='Extractor de comentarios QSim')
    parser.add_argument('--root',    default='.', help='Carpeta raíz del proyecto')
    parser.add_argument('--out',     default='project_comments.md', help='Archivo de salida')
    parser.add_argument('--exclude', nargs='*', default=[],
                        help='Carpetas adicionales a excluir (ej: --exclude three mediapipe libs)')
    parser.add_argument('--min-len', type=int, default=15,
                        help='Longitud mínima de comentario para incluir (default: 15)')
    args = parser.parse_args()

    root = Path(args.root).resolve()
    print(f"[extract_comments] Escaneando: {root}")
    print(f"[extract_comments] Longitud mínima: {args.min_len} chars")

    tree = build_tree(root, min_len=args.min_len, extra_ignore=set(args.exclude))

    total_files    = sum(len(v) for v in tree.values())
    total_comments = sum(len(c) for files in tree.values() for c in files.values())
    print(f"[extract_comments] Carpetas: {len(tree)} | Archivos: {total_files} | Comentarios: {total_comments}")

    md = render_markdown(tree, root, args.min_len)

    out = Path(args.out)
    out.write_text(md, encoding='utf-8')
    print(f"[extract_comments] ✅ Escrito: {out} ({out.stat().st_size // 1024} KB)")


if __name__ == '__main__':
    main()
