#!/usr/bin/env python3
"""
mapear_folder.py
Genera un archivo .md o .txt con el árbol completo de carpetas y archivos
del directorio donde se encuentra este script.

Uso:
    python mapear_folder.py              → genera árbol.md
    python mapear_folder.py --txt        → genera árbol.txt
    python mapear_folder.py --salida mi_proyecto.md
    python mapear_folder.py --ignorar node_modules .git __pycache__
"""

import os
import argparse
from datetime import datetime
from pathlib import Path

# ── Ignorados por defecto ────────────────────────────────────────────────────
IGNORADOS_DEFAULT = {
    ".git", ".svn", ".hg",
    "node_modules", "__pycache__", ".venv", "venv", "env",
    ".DS_Store", "Thumbs.db",
    "dist", "build", ".cache", ".next", ".nuxt",
    ".idea", ".vscode",
}

# ── Caracteres del árbol ─────────────────────────────────────────────────────
TEE   = "├── "
LAST  = "└── "
PIPE  = "│   "
BLANK = "    "


def construir_arbol(
    ruta: Path,
    prefijo: str = "",
    ignorados: set = None,
    solo_dirs: bool = False,
    max_profundidad: int = None,
    profundidad_actual: int = 0,
) -> list[str]:
    if ignorados is None:
        ignorados = IGNORADOS_DEFAULT

    if max_profundidad is not None and profundidad_actual >= max_profundidad:
        return []

    try:
        entradas = sorted(
            ruta.iterdir(),
            key=lambda e: (e.is_file(), e.name.lower()),  # carpetas primero
        )
    except PermissionError:
        return [prefijo + "  [sin permiso de lectura]"]

    entradas = [e for e in entradas if e.name not in ignorados]

    if solo_dirs:
        entradas = [e for e in entradas if e.is_dir()]

    lineas = []
    for i, entrada in enumerate(entradas):
        es_ultimo = i == len(entradas) - 1
        conector  = LAST if es_ultimo else TEE
        extension = BLANK if es_ultimo else PIPE

        if entrada.is_dir():
            lineas.append(f"{prefijo}{conector}📁 {entrada.name}/")
            lineas += construir_arbol(
                entrada,
                prefijo=prefijo + extension,
                ignorados=ignorados,
                solo_dirs=solo_dirs,
                max_profundidad=max_profundidad,
                profundidad_actual=profundidad_actual + 1,
            )
        else:
            lineas.append(f"{prefijo}{conector}{entrada.name}")

    return lineas


def contar(ruta: Path, ignorados: set) -> tuple[int, int]:
    """Devuelve (n_carpetas, n_archivos) de forma recursiva."""
    carpetas = archivos = 0
    for entrada in ruta.rglob("*"):
        if any(p in ignorados for p in entrada.parts):
            continue
        if entrada.is_dir():
            carpetas += 1
        else:
            archivos += 1
    return carpetas, archivos


def generar(args):
    raiz      = Path(__file__).resolve().parent
    ignorados = IGNORADOS_DEFAULT | set(args.ignorar)
    extension = ".txt" if args.txt else ".md"
    nombre_salida = args.salida or f"árbol{extension}"
    ruta_salida   = raiz / nombre_salida

    # ── Construir árbol ──────────────────────────────────────────────────────
    lineas_arbol = construir_arbol(
        raiz,
        ignorados=ignorados,
        solo_dirs=args.solo_dirs,
        max_profundidad=args.profundidad,
    )

    n_carpetas, n_archivos = contar(raiz, ignorados)
    ahora = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    # ── Componer contenido ───────────────────────────────────────────────────
    if extension == ".md":
        cabecera = [
            f"# 📂 {raiz.name}",
            "",
            f"> Generado el {ahora}  ",
            f"> Ruta: `{raiz}`",
            "",
            "```",
            f"📁 {raiz.name}/",
        ]
        pie = [
            "```",
            "",
            "---",
            "",
            f"**{n_carpetas}** carpetas · **{n_archivos}** archivos",
        ]
    else:
        cabecera = [
            f"Árbol de: {raiz.name}",
            f"Generado: {ahora}",
            f"Ruta:     {raiz}",
            "",
            f"📁 {raiz.name}/",
        ]
        pie = [
            "",
            f"{n_carpetas} carpetas · {n_archivos} archivos",
        ]

    contenido = "\n".join(cabecera + lineas_arbol + pie)

    # ── Escribir archivo ─────────────────────────────────────────────────────
    ruta_salida.write_text(contenido, encoding="utf-8")
    print(f"✅  Archivo generado: {ruta_salida}")
    print(f"   {n_carpetas} carpetas · {n_archivos} archivos")


def main():
    parser = argparse.ArgumentParser(
        description="Genera un árbol de carpetas/archivos en .md o .txt"
    )
    parser.add_argument(
        "--txt", action="store_true",
        help="Guardar como .txt en lugar de .md (default)",
    )
    parser.add_argument(
        "--salida", metavar="NOMBRE",
        help="Nombre del archivo de salida (incluye extensión si quieres)",
    )
    parser.add_argument(
        "--ignorar", nargs="*", default=[],
        metavar="PATRON",
        help="Nombres extra a ignorar además de los predeterminados",
    )
    parser.add_argument(
        "--solo-dirs", action="store_true",
        help="Mostrar solo carpetas, sin archivos",
    )
    parser.add_argument(
        "--profundidad", type=int, default=None, metavar="N",
        help="Profundidad máxima del árbol (default: ilimitada)",
    )

    args = parser.parse_args()
    generar(args)


if __name__ == "__main__":
    main()
