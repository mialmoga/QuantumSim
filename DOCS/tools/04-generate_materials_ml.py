#!/usr/bin/env python3
"""
generate_materials_ml.py — v4  — ShaderLab ML Generator
=========================================================
Generador de materiales ShaderLab usando red neuronal entrenada
con los 118 materiales honestos generados por generate_materials.py.

FUENTES DE DATOS (en orden de prioridad):
  1. ShaderLab/custom/shader_{sym}.json  — override manual (opcional)
  2. src/materials/{sym}.json            — material honesto del elemento ← FUENTE PRIMARIA
  3. src/elements/{sym}.json             — datos físicos completos del elemento
  4. src/elements-index.json             — datos básicos + grupo

ESTRUCTURA DEL PROYECTO (relativa al directorio donde se corre el script):
  src/
    elements-index.json
    materials/           ← materiales honestos — SOLO LECTURA, nunca se tocan
      H.json
      Fe.json
      ...
    materials_ml/        ← output del ML — separado de los honestos
      index-ml.json
      H.json (versión ML)
      ...
    elements/
      H.json
      ...
  ShaderLab/             ← al mismo nivel que src/ (no dentro)
    custom/
      shader_H.json      ← overrides manuales opcionales

USO:
  # Entrenamiento completo + generación para los 118 elementos:
  uv run --python 3.12 --with numpy generate_materials_ml.py

  # Solo un elemento (dry-run para ver parámetros):
  uv run --python 3.12 --with numpy generate_materials_ml.py --only Fe Au Xe --dry-run

  # Entrenar y guardar weights, sin generar presets:
  uv run --python 3.12 --with numpy generate_materials_ml.py --train-only

  # Generar con weights existentes:
  uv run --python 3.12 --with numpy generate_materials_ml.py --load model_weights.json

  # Generar módulo JS de inferencia:
  uv run --python 3.12 --with numpy generate_materials_ml.py --js ShaderLab/shader_ml.js

  # Tests:
  uv run --python 3.12 --with numpy generate_materials_ml.py --test
"""

import json, math, os, re, sys, argparse, datetime
from pathlib import Path
import numpy as np

# ═══════════════════════════════════════════════════════════════════════════════
#  RUTAS DEL PROYECTO
# ═══════════════════════════════════════════════════════════════════════════════

ELEMENTS_INDEX  = Path('src/elements-index.json')
MATERIALS_INDEX = Path('src/materials/index.json')
ELEMENTS_DIR    = Path('src/elements')
MATERIALS_DIR   = Path('src/materials')       # materiales honestos — solo lectura
SHADERLAB_DIR   = Path('ShaderLab/custom')    # corregido — ShaderLab está al nivel raíz
MODULES_DIR     = Path('ShaderLab/shader_modules')  # corregido

OUTPUT_WEIGHTS  = Path('model_weights.json')
OUTPUT_PRESETS  = Path('src/materials_ml')    # separado — nunca toca src/materials/

# ═══════════════════════════════════════════════════════════════════════════════
#  PIPELINE DEF — los 12 módulos del ShaderLab con sus rangos exactos
#  Tomados de los JSONs reales de shader_modules/
# ═══════════════════════════════════════════════════════════════════════════════

PIPELINE_DEF = [
    # ── Vertex ────────────────────────────────────────────────────────────────
    {
        'key': 'blink', 'stage': 'vert',
        'always_on': False,
        'requires': [], 'provides': ['vBlink'],
        'glsl': "vBlink = sin(uTime*({{fMul}}+uLevel)*{{speed}}+aPhase*6.2832)*{{amp}};",
        'params': {
            'speed': {'min': 0.0,  'max': 3.0,  'default': 0.5,  'step': 0.05},
            'amp':   {'min': 0.0,  'max': 1.0,  'default': 0.2,  'step': 0.01},
            'fMul':  {'min': 0.5,  'max': 4.0,  'default': 1.5,  'step': 0.05},
        }
    },
    {
        'key': 'point_size', 'stage': 'vert',
        'always_on': True,
        'requires': [], 'provides': ['gl_PointSize'],
        'glsl': "gl_PointSize=uScale*{{sz}}*(1.1+vBlink*{{bAmp}})*{{persp}}/-mvP.z;",
        'params': {
            'sz':    {'min': 0.1,   'max': 3.0,   'default': 0.45,  'step': 0.05},
            'bAmp':  {'min': 0.0,   'max': 6.0,   'default': 1.3,   'step': 0.1},
            'persp': {'min': 0.0,   'max': 400.0,  'default': 170.0, 'step': 1.0},
        }
    },
    {
        'key': 'turbulence', 'stage': 'vert',
        'always_on': False,
        'requires': [], 'provides': [],
        'glsl': "{float _tb=sin(position.x*{{freq}}+uTime*{{tMul}})*sin(position.y*{{freq}}+uTime*{{tMul}}*0.7)*{{amp}};wpos+=vec3(_tb,_tb*0.6,_tb*0.4);mvP=modelViewMatrix*vec4(wpos,1.0);}",
        'params': {
            'freq': {'min': 0.001, 'max': 0.03,  'default': 0.005, 'step': 0.001},
            'amp':  {'min': 0.0,   'max': 10.0,  'default': 0.5,   'step': 0.5},
            'tMul': {'min': 0.0,   'max': 2.0,   'default': 0.2,   'step': 0.05},
        }
    },
    {
        'key': 'sphere_pulse', 'stage': 'vert',
        'always_on': False,
        'requires': [], 'provides': ['gl_PointSize'],
        'glsl': "{float _v=sin(uTime*{{freq}}+vPhase*6.2832)*{{amp}};float _base=gl_PointSize>0.0?gl_PointSize:{{pSize}}*uScale*350.0/-mvP.z;gl_PointSize=_base*(1.0+_v);}",
        'params': {
            'freq':  {'min': 0.5,  'max': 20.0, 'default': 12.0, 'step': 0.5},
            'amp':   {'min': 0.0,  'max': 0.5,  'default': 0.15, 'step': 0.01},
            'pSize': {'min': 0.1,  'max': 3.0,  'default': 1.0,  'step': 0.05},
        }
    },
    # ── Fragment ──────────────────────────────────────────────────────────────
    {
        'key': 'disc_shape', 'stage': 'frag',
        'always_on': True,
        'requires': [], 'provides': ['d', 'alpha'],
        'glsl': "{vec2 _uv=gl_PointCoord-0.5;d=dot(_uv,_uv);if(d>{{radius}})discard;if({{ring}}>0.005&&d<{{ring}})discard;alpha=1.0-smoothstep({{soft}},{{radius}},d);}",
        'params': {
            'radius': {'min': 0.05, 'max': 0.5,  'default': 0.12, 'step': 0.01},
            'soft':   {'min': 0.0,  'max': 0.4,  'default': 0.0,  'step': 0.01},
            'ring':   {'min': 0.0,  'max': 0.22, 'default': 0.0,  'step': 0.01},
        }
    },
    {
        'key': 'brightness', 'stage': 'frag',
        'always_on': True,
        'requires': [], 'provides': ['col'],
        'glsl': "col=uColor*({{bright}}*({{base}}+vBlink*{{vari}}));",
        'params': {
            'bright': {'min': 0.0,  'max': 10.0, 'default': 1.5,  'step': 0.1},
            'base':   {'min': 0.3,  'max': 1.0,  'default': 0.5,  'step': 0.01},
            'vari':   {'min': 0.0,  'max': 0.5,  'default': 0.0,  'step': 0.01},
        }
    },
    {
        'key': 'color_grade', 'stage': 'frag',
        'always_on': True,
        'requires': ['brightness'], 'provides': [],
        'glsl': "col=pow(max(col*vec3({{r}},{{g}},{{b}}),vec3(0.0)),vec3(1.0/{{gamma}}));",
        'params': {
            'r':     {'min': 0.5,  'max': 2.0,  'default': 1.0, 'step': 0.02},
            'g':     {'min': 0.5,  'max': 2.0,  'default': 1.0, 'step': 0.02},
            'b':     {'min': 0.5,  'max': 2.0,  'default': 1.0, 'step': 0.02},
            'gamma': {'min': 0.5,  'max': 2.5,  'default': 1.0, 'step': 0.05},
        }
    },
    {
        'key': 'phase_color', 'stage': 'frag',
        'always_on': False,
        'requires': ['brightness'], 'provides': [],
        'glsl': "{float _pw=pow(clamp(vPhase,0.0,1.0),{{pow}});col*=mix({{inner}},{{outer}},_pw);}",
        'params': {
            'inner': {'min': 0.5,  'max': 4.0,  'default': 1.2, 'step': 0.05},
            'outer': {'min': 0.0,  'max': 1.0,  'default': 0.4, 'step': 0.01},
            'pow':   {'min': 0.2,  'max': 3.0,  'default': 1.0, 'step': 0.05},
        }
    },
    {
        'key': 'glow', 'stage': 'frag',
        'always_on': False,
        'requires': ['disc_shape'], 'provides': [],
        'glsl': "{float _gf=exp(-d*{{falloff}})*{{intensity}};col=mix(col,col*2.5,_gf*{{mix}});}",
        'params': {
            'intensity': {'min': 0.0,  'max': 4.0,  'default': 0.2, 'step': 0.1},
            'falloff':   {'min': 1.0,  'max': 30.0, 'default': 6.0, 'step': 0.5},
            'mix':       {'min': 0.0,  'max': 1.0,  'default': 0.15,'step': 0.01},
        }
    },
    {
        'key': 'fresnel_fake', 'stage': 'frag',
        'always_on': False,
        'requires': ['brightness'], 'provides': [],
        'glsl': "{float _f=pow(clamp(1.0-abs(vPhase-0.5)*2.0,0.0,1.0),{{pow}});col+=_f*{{rim}}*vec3({{r}},{{g}},{{b}});col+=clamp(1.0-_f,0.0,1.0)*col*{{core}};}",
        'params': {
            'rim':  {'min': 0.0,  'max': 4.0,  'default': 1.2, 'step': 0.05},
            'core': {'min': 0.0,  'max': 2.0,  'default': 0.3, 'step': 0.05},
            'pow':  {'min': 0.5,  'max': 6.0,  'default': 2.0, 'step': 0.1},
            'r':    {'min': 0.0,  'max': 2.0,  'default': 1.0, 'step': 0.05},
            'g':    {'min': 0.0,  'max': 2.0,  'default': 1.0, 'step': 0.05},
            'b':    {'min': 0.0,  'max': 2.0,  'default': 1.0, 'step': 0.05},
        }
    },
    {
        'key': 'specular_metal', 'stage': 'frag',
        'always_on': False,
        'requires': ['brightness'], 'provides': [],
        'glsl': "{ vec3 lightDir=normalize(vec3(0.5,1.0,0.5));vec3 viewDir=vec3(0.0,0.0,1.0);vec3 normal=normalize(vWorldNormal);float spec=pow(max(dot(reflect(-lightDir,normal),viewDir),0.0),{{shininess}});vec3 metalCol=vec3(0.9,0.94,1.0);col=mix(col,metalCol,spec*{{reflectivity}});col+=spec*{{intensity}}; }",
        'params': {
            'shininess':    {'min': 2.0,  'max': 128.0, 'default': 64.0, 'step': 1.0},
            'intensity':    {'min': 0.0,  'max': 5.0,   'default': 2.5,  'step': 0.1},
            'reflectivity': {'min': 0.0,  'max': 1.0,   'default': 0.8,  'step': 0.05},
        }
    },
    {
        'key': 'alpha_curve', 'stage': 'frag',
        'always_on': False,
        'requires': ['disc_shape'], 'provides': ['alpha_final'],
        'glsl': "alpha=pow(max(alpha,0.0),{{curve}})*{{opacity}}+{{floor}};",
        'params': {
            'curve':   {'min': 0.2,  'max': 3.0,  'default': 0.8, 'step': 0.05},
            'opacity': {'min': 0.0,  'max': 1.0,  'default': 0.7, 'step': 0.01},
            'floor':   {'min': 0.0,  'max': 0.2,  'default': 0.0, 'step': 0.01},
        }
    },
]

# Totales
N_PARAMS   = sum(len(n['params']) for n in PIPELINE_DEF)
N_OPTIONAL = sum(1 for n in PIPELINE_DEF if not n['always_on'])
N_OUT      = N_PARAMS + N_OPTIONAL
N_FEATURES = 22


# ═══════════════════════════════════════════════════════════════════════════════
#  CARGA DE DATOS DEL PROYECTO
# ═══════════════════════════════════════════════════════════════════════════════

def load_project_data():
    """
    Carga las tres fuentes de datos del proyecto y construye un dataset
    limpio de pares (features, target_pipeline).

    Retorna:
        elements_index  — dict sym → meta básica
        elements_data   — dict sym → JSON completo (puede ser parcial si falta el archivo)
        materials_list  — lista de nombres de materiales disponibles
        training_pairs  — lista de { sym, features, target_vec, material_name, source }
    """

    # ── 1. Cargar elements-index.json ─────────────────────────────────────────
    if not ELEMENTS_INDEX.exists():
        print(f'ERROR: No se encontró {ELEMENTS_INDEX}')
        print('  Asegúrate de correr el script desde la raíz del proyecto.')
        sys.exit(1)

    elements_index = json.loads(ELEMENTS_INDEX.read_text())['elements']
    print(f'  elements-index: {len(elements_index)} elementos')

    # ── 2. Cargar materials/index.json ────────────────────────────────────────
    materials_list = []
    if MATERIALS_INDEX.exists():
        materials_list = json.loads(MATERIALS_INDEX.read_text()).get('materials', [])
        print(f'  materials/index: {len(materials_list)} materiales')
    else:
        print(f'  WARNING: {MATERIALS_INDEX} no encontrado — escaneando directorio')
        materials_list = [f.stem for f in MATERIALS_DIR.glob('*.json')
                          if f.stem != 'index']

    # ── 3. Cargar JSONs completos de elementos ────────────────────────────────
    elements_data = {}
    missing_full  = []
    for sym in elements_index:
        path = ELEMENTS_DIR / f'{sym}.json'
        if path.exists():
            try:
                elements_data[sym] = json.loads(path.read_text())
            except Exception as e:
                print(f'  WARNING: {sym}.json malformado: {e}')
        else:
            missing_full.append(sym)

    print(f'  elements/{{}}.json: {len(elements_data)} cargados'
          + (f', {len(missing_full)} sin JSON completo' if missing_full else ''))

    # ── 4. Construir pares de entrenamiento ───────────────────────────────────
    # Fuente primaria: src/materials/{sym}.json — los 118 materiales honestos
    # Override opcional: ShaderLab/custom/shader_{sym}.json — ajustes manuales
    training_pairs = []
    skipped        = []

    for sym, meta in elements_index.items():
        preset = None
        source = None

        # Prioridad 1: override manual en ShaderLab/custom/
        sl_path = SHADERLAB_DIR / f'shader_{sym}.json'
        if sl_path.exists():
            try:
                data = json.loads(sl_path.read_text())
                if data.get('target') == 'sphere' and data.get('pipeline'):
                    preset = data
                    source = f'ShaderLab/custom/shader_{sym}.json'
            except Exception as e:
                print(f'  WARNING: shader_{sym}.json: {e}')

        # Prioridad 2: material honesto en src/materials/{sym}.json
        if not preset:
            mat_path = MATERIALS_DIR / f'{sym}.json'
            if mat_path.exists():
                try:
                    data = json.loads(mat_path.read_text())
                    if data.get('target') == 'sphere' and data.get('pipeline'):
                        preset = data
                        source = f'src/materials/{sym}.json'
                except Exception as e:
                    print(f'  WARNING: {sym}.json: {e}')

        if not preset:
            skipped.append(sym)
            continue

        # Extraer features — usar JSON completo si existe, si no usar el index
        el_full = elements_data.get(sym)
        if el_full:
            feats = extract_features_full(el_full, meta)
        else:
            feats = extract_features_index(meta)

        target = params_to_vector(preset['pipeline'])

        training_pairs.append({
            'sym':    sym,
            'features':   feats,
            'target_vec': target,
            'source':     source,
        })

    print(f'\n  Pares de entrenamiento: {len(training_pairs)}')
    if skipped:
        print(f'  Sin preset ({len(skipped)}): {", ".join(skipped[:10])}'
              + ('...' if len(skipped) > 10 else ''))

    return elements_index, elements_data, materials_list, training_pairs


# ═══════════════════════════════════════════════════════════════════════════════
#  EXTRACCIÓN DE FEATURES
#  Dos versiones: con JSON completo (22 features) o solo index (features básicas).
# ═══════════════════════════════════════════════════════════════════════════════

# Mapa de grupos del project a índice numérico
GROUP_MAP = {
    'nonmetal':         0,
    'halogen':          1,
    'noble_gas':        2,
    'alkali_metal':     3,
    'alkaline_earth':   4,
    'metalloid':        5,
    'transition_metal': 6,
    'post_transition':  7,
    'lanthanide':       8,
    'actinide':         9,
    'superheavy':       10,
    'liquid':           7,
}

METAL_GROUPS  = {3,4,6,7,8,9,10}
GAS_GROUPS    = {2}
HALOGEN_GROUPS= {0,1}


def _s(v, d=0.0):
    """Safe float con fallback."""
    try:
        f = float(v)
        return f if math.isfinite(f) else d
    except:
        return d


def extract_features_full(el, meta=None):
    """
    22 features desde el JSON completo del elemento.
    Si meta (del index) está disponible, lo usa para features básicas.
    """
    ident  = el.get('identity', {})
    atomic = el.get('atomic_structure', {})
    phys   = el.get('physical_properties', {})
    em     = el.get('electromagnetism_and_mechanics', {})
    react  = el.get('reactivity', {})
    thermo = el.get('thermodynamics', {})

    # Grupo desde el index (más fiable que el JSON completo)
    group_str = (meta or {}).get('group', '') or ident.get('category_eng', '').lower().replace(' ','_')
    gi = GROUP_MAP.get(group_str, 5)

    Z  = _s(ident.get('number') or (meta or {}).get('number'), 1)
    f  = np.zeros(N_FEATURES, dtype=np.float32)

    f[0]  = Z / 118.0
    f[1]  = _s(phys.get('mass') or (meta or {}).get('mass'), 1.0) / 300.0
    f[2]  = _s(atomic.get('electronegativity'), 0.0) / 4.0
    f[3]  = _s(atomic.get('radius_covalent_pm'), 70.0) / 250.0
    f[4]  = _s(atomic.get('vanderwaals_radius_pm') or atomic.get('radius_atomic_pm'), 150.0) / 300.0
    f[5]  = _s(atomic.get('ionic_radius_pm'), 70.0) / 200.0
    f[6]  = math.log1p(_s(em.get('polarizability_angstrom3'), 1.0)) / 6.0
    f[7]  = math.log1p(_s(phys.get('density_g_cm3'), 1.0)) / 5.0
    f[8]  = math.log1p(_s(phys.get('melt_K') or phys.get('melting_point_K'), 300.0)) / 10.0
    f[9]  = math.log1p(_s(phys.get('boil_K') or phys.get('boiling_point_K'), 1000.0)) / 10.0
    f[10] = _s(atomic.get('ionization_energy_eV'), 5.0) / 25.0
    f[11] = _s(atomic.get('electron_affinity_ev'), 0.0) / 4.0
    f[12] = _s(atomic.get('valence'), 1.0) / 8.0
    f[13] = _s(react.get('max_bonds'), 4.0) / 8.0
    f[14] = math.log1p(abs(_s(em.get('electrical_conductivity_sm'), 0.0))) / 20.0
    f[15] = math.log1p(abs(_s(em.get('magnetic_susceptibility'), 0.0))) / 6.0
    f[16] = _s(atomic.get('effective_nuclear_charge'), 1.0) / 30.0
    f[17] = math.log1p(_s(thermo.get('latent_heat_fusion_kj_mol'), 0.0)) / 8.0
    f[18] = math.log1p(_s(thermo.get('latent_heat_vaporization_kj_mol'), 0.0)) / 10.0
    f[19] = 1.0 if gi in METAL_GROUPS  else 0.0
    f[20] = 1.0 if gi in GAS_GROUPS    else 0.0
    f[21] = 1.0 if gi in HALOGEN_GROUPS else 0.0

    np.clip(f, 0.0, 1.0, out=f)
    return f


def extract_features_index(meta):
    """
    Features básicas solo desde el elements-index (fallback si no hay JSON completo).
    Menos precisas pero funcionales.
    """
    f  = np.zeros(N_FEATURES, dtype=np.float32)
    Z  = _s(meta.get('number'), 1)
    gi = GROUP_MAP.get(meta.get('group',''), 5)

    f[0]  = Z / 118.0
    f[1]  = _s(meta.get('mass'), 1.0) / 300.0
    f[19] = 1.0 if gi in METAL_GROUPS   else 0.0
    f[20] = 1.0 if gi in GAS_GROUPS     else 0.0
    f[21] = 1.0 if gi in HALOGEN_GROUPS else 0.0
    # El resto queda en 0 — la red aprenderá con menos señal para estos elementos
    return f


# ═══════════════════════════════════════════════════════════════════════════════
#  VECTORIZACIÓN pipeline ↔ red
# ═══════════════════════════════════════════════════════════════════════════════

def params_to_vector(pipeline_nodes):
    """Pipeline JSON → vector normalizado [0,1]."""
    node_map = {n['key']: n for n in pipeline_nodes if isinstance(n, dict)}
    vec, flags = [], []

    for nd in PIPELINE_DEF:
        pn = node_map.get(nd['key'])
        for pname, pdef in nd['params'].items():
            raw  = pn['params'].get(pname, pdef['default']) if pn else pdef['default']
            span = pdef['max'] - pdef['min']
            norm = (float(raw) - pdef['min']) / max(span, 1e-8)
            vec.append(float(np.clip(norm, 0.0, 1.0)))
        if not nd['always_on']:
            enabled = pn.get('enabled', False) if pn else False
            flags.append(1.0 if enabled else 0.0)

    return np.array(vec + flags, dtype=np.float32)


def vector_to_pipeline(vec):
    """Vector normalizado [0,1] → lista de nodos ShaderLab."""
    pipeline = []
    idx = 0; opt_idx = N_PARAMS

    for nd in PIPELINE_DEF:
        params = {}
        for pname, pdef in nd['params'].items():
            norm = float(np.clip(vec[idx], 0.0, 1.0))
            raw  = norm * (pdef['max'] - pdef['min']) + pdef['min']
            span = pdef['max'] - pdef['min']
            raw  = round(raw, 3 if span < 1 else (2 if span < 10 else 1))
            params[pname] = raw
            idx += 1

        if nd['always_on']:
            enabled = True
        else:
            enabled  = bool(vec[opt_idx] > 0.5)  # cast explícito — np.bool_ no es JSON serializable
            opt_idx += 1

        pipeline.append({'key': nd['key'], 'enabled': enabled,
                         'params': params, 'custom': False})
    return pipeline


# ═══════════════════════════════════════════════════════════════════════════════
#  RED NEURONAL — numpy puro
#  Input(22) → Dense(64, ReLU) → Dense(32, ReLU) → Output(N_OUT, Sigmoid)
# ═══════════════════════════════════════════════════════════════════════════════

def sigmoid(x):  return 1.0 / (1.0 + np.exp(-np.clip(x, -500, 500)))
def relu(x):     return np.maximum(0, x)
def sig_d(s):    return s * (1.0 - s)
def relu_d(x):   return (x > 0).astype(np.float32)


class TinyNet:
    def __init__(self, n_in=N_FEATURES, h1=64, h2=32, n_out=N_OUT, seed=42):
        rng = np.random.default_rng(seed)
        self.W1 = rng.standard_normal((n_in, h1)).astype(np.float32) * math.sqrt(2.0/n_in)
        self.b1 = np.zeros(h1, dtype=np.float32)
        self.W2 = rng.standard_normal((h1, h2)).astype(np.float32)  * math.sqrt(2.0/h1)
        self.b2 = np.zeros(h2, dtype=np.float32)
        self.W3 = rng.standard_normal((h2, n_out)).astype(np.float32)* math.sqrt(2.0/h2)
        self.b3 = np.zeros(n_out, dtype=np.float32)
        self._m = {k: np.zeros_like(v) for k,v in self._p().items()}
        self._v = {k: np.zeros_like(v) for k,v in self._p().items()}
        self._t = 0

    def _p(self):
        return {'W1':self.W1,'b1':self.b1,'W2':self.W2,'b2':self.b2,'W3':self.W3,'b3':self.b3}

    def forward(self, X):
        self._X  = X
        self._z1 = X @ self.W1 + self.b1;    self._a1 = relu(self._z1)
        self._z2 = self._a1 @ self.W2+self.b2; self._a2 = relu(self._z2)
        self._z3 = self._a2 @ self.W3+self.b3; self._a3 = sigmoid(self._z3)
        return self._a3

    def loss(self, p, y):  return float(np.mean((p - y) ** 2))

    def backward(self, p, y):
        N  = p.shape[0]
        d3 = 2*(p-y)/N * sig_d(p)
        gW3= self._a2.T@d3;    gb3=d3.sum(0)
        d2 = (d3@self.W3.T)*relu_d(self._z2)
        gW2= self._a1.T@d2;    gb2=d2.sum(0)
        d1 = (d2@self.W2.T)*relu_d(self._z1)
        gW1= self._X.T@d1;     gb1=d1.sum(0)
        return {'W1':gW1,'b1':gb1,'W2':gW2,'b2':gb2,'W3':gW3,'b3':gb3}

    def adam_step(self, g, lr=5e-4, b1=0.9, b2=0.999, eps=1e-8):
        self._t += 1; t=self._t; p=self._p()
        for k in p:
            self._m[k] = b1*self._m[k]+(1-b1)*g[k]
            self._v[k] = b2*self._v[k]+(1-b2)*g[k]**2
            mh = self._m[k]/(1-b1**t); vh = self._v[k]/(1-b2**t)
            p[k] -= lr*mh/(np.sqrt(vh)+eps)

    def predict(self, x):
        return self.forward(x[np.newaxis,:])[0]

    def save(self, path):
        data = {k: v.tolist() for k,v in self._p().items()}
        data['meta'] = {
            'n_in': int(self.W1.shape[0]), 'h1': int(self.W1.shape[1]),
            'h2':   int(self.W2.shape[1]), 'n_out': int(self.W3.shape[1]),
            'n_params': N_PARAMS, 'n_optional': N_OPTIONAL, 'n_out_total': N_OUT,
            'created': datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00','Z'),
            'pipeline_map': [
                {'key': n['key'], 'stage': n['stage'], 'always_on': n['always_on'],
                 'param_keys': list(n['params'].keys()),
                 'param_ranges': {k: {'min':v['min'],'max':v['max']}
                                  for k,v in n['params'].items()}}
                for n in PIPELINE_DEF
            ],
        }
        Path(path).write_text(json.dumps(data, indent=2))
        size = Path(path).stat().st_size // 1024
        print(f'  ✓ Weights → {path}  ({size}KB)')

    @classmethod
    def load(cls, path):
        data = json.loads(Path(path).read_text())
        meta = data.get('meta', {})
        net  = cls(meta.get('n_in',N_FEATURES), meta.get('h1',64),
                   meta.get('h2',32), meta.get('n_out',N_OUT))
        for k in ('W1','b1','W2','b2','W3','b3'):
            arr = np.array(data[k], dtype=np.float32)
            getattr(net, k)[:] = arr.reshape(getattr(net, k).shape)
        net._m = {k: np.zeros_like(v) for k,v in net._p().items()}
        net._v = {k: np.zeros_like(v) for k,v in net._p().items()}
        net._t = 0
        print(f'  ✓ Weights ← {path}')
        return net


# ═══════════════════════════════════════════════════════════════════════════════
#  ENTRENAMIENTO
# ═══════════════════════════════════════════════════════════════════════════════

def train(net, X, Y, epochs=5000, lr=5e-4, verbose=True):
    best_loss = float('inf')
    best_w    = None
    patience  = 400
    no_imp    = 0

    for ep in range(1, epochs+1):
        idx = np.random.permutation(len(X))
        p   = net.forward(X[idx])
        l   = net.loss(p, Y[idx])
        g   = net.backward(p, Y[idx])
        net.adam_step(g, lr=lr)

        if l < best_loss - 1e-7:
            best_loss = l
            best_w    = {k: v.copy() for k,v in net._p().items()}
            no_imp    = 0
        else:
            no_imp += 1
            if no_imp >= patience:
                if verbose: print(f'  Early stop ep {ep}  loss={best_loss:.6f}')
                break

        if verbose and ep % 500 == 0:
            print(f'  ep {ep:>5}  loss={l:.6f}')

    if best_w:
        for k,v in best_w.items(): net._p()[k][:] = v
    return best_loss


# ═══════════════════════════════════════════════════════════════════════════════
#  COMPILER Python — replica compiler.js
# ═══════════════════════════════════════════════════════════════════════════════

def _fmt(v):
    n = float(v)
    if abs(n - round(n)) < 1e-9 and abs(n) < 10000:
        s = f"{int(n)}.0"
    else:
        s = f"{n:.4f}"
        # Limpiar ceros finales pero mantener al menos un decimal
        if '.' in s:
            s = s.rstrip('0')
            if s.endswith('.'): s += '0'
    return s

def _subst(tmpl, params):
    return re.sub(r'\{\{(\w+)\}\}', lambda m: _fmt(params.get(m.group(1), 0.0)), tmpl)

def compile_pipeline(pipeline_nodes):
    """Compila lista de nodos a GLSL vert+frag — replica exacta de compiler.js."""
    # Bus base — siempre disponible desde el template
    provided = {'vBlink', 'vPhase', 'uTime', 'uColor',
                'disc_shape', 'brightness', 'col', 'd', 'alpha'}
    vert, frag = [], []

    for node in pipeline_nodes:
        if not node.get('enabled', True): continue
        key = node['key']
        nd  = next((n for n in PIPELINE_DEF if n['key'] == key), None)
        if not nd: continue
        # Verificar requires — usar el key del nodo como token satisfecho
        missing = [r for r in nd.get('requires', []) if r not in provided]
        if missing: continue
        # Marcar como satisfecho tanto los provides como el key propio
        provided.add(key)
        for p in nd.get('provides', []): provided.add(p)
        code = _subst(nd['glsl'], node.get('params', {}))
        (vert if nd['stage'] == 'vert' else frag).append(code)

    vb = '\n  '.join(vert)
    fb = '\n  '.join(frag)

    # Template exacto del compiler.js — misma estructura que los built-ins
    vert_src = (
        "// ShaderLab Custom — Sphere\n"
        "uniform float uTime,uScale,uLevel,uPmScale,uSpeed,uAmp,uSize;\n"
        "uniform float uLodFade;\n"
        "attribute float aPhase;\n"
        "varying float vBlink;\n"
        "varying float vPhase;\n"
        "void main(){\n"
        "  vBlink=0.0;\n"
        "  vPhase=aPhase;\n"
        "  vec3 wpos=position*uPmScale;\n"
        "  vec4 mvP=modelViewMatrix*vec4(wpos,1.0);\n"
        "  gl_PointSize=0.0;\n"
        f"  {vb}\n"
        "  if(gl_PointSize<=0.0)\n"
        "    gl_PointSize=uScale*uSize*(1.0+vBlink*uAmp*3.0)/-mvP.z;\n"
        "  gl_PointSize*=uLodFade;\n"
        "  gl_Position=projectionMatrix*mvP;\n"
        "}"
    )
    frag_src = (
        "// ShaderLab Custom — Sphere\n"
        "uniform vec3  uColor;\n"
        "uniform float uBright,uEdge;\n"
        "uniform float uLodFade;\n"
        "varying float vBlink;\n"
        "varying float vPhase;\n"
        "void main(){\n"
        "  vec3  col=uColor*uBright;\n"
        "  float alpha=1.0;\n"
        "  float d=0.0;\n"
        "  {vec2 _uv=gl_PointCoord-0.5;d=dot(_uv,_uv);if(d>0.25)discard;alpha=1.0-smoothstep(uEdge,0.25,d);}\n"
        f"  {fb}\n"
        "  if(alpha<=0.0)discard;\n"
        "  gl_FragColor=vec4(col,clamp(alpha,0.0,1.0)*uLodFade);\n"
        "}"
    )
    return vert_src, frag_src


# ═══════════════════════════════════════════════════════════════════════════════
#  GENERACIÓN DE PRESETS
# ═══════════════════════════════════════════════════════════════════════════════

def generate_preset(sym, meta, el_full, net, mode='custom_ml', creative=False, seed=None):
    """
    Genera un preset ShaderLab para un elemento.

    mode='built_in':
        element: null  — material compartible, va a src/materials/{sym}_ml.json
        Listo para usarse como built-in genérico por grupo.

    mode='custom_ml':
        element: sym   — preset específico del elemento, va a ShaderLab/custom/shader_{sym}.json
        Mismo formato que los presets creados manualmente en el ShaderLab.

    creative=True:
        Inyecta ruido gaussiano en el vector de salida antes de desnormalizar.
        Genera variaciones inesperadas — parámetros más extremos, combinaciones
        que la red no habría producido con features normales.
        Seed por símbolo para reproducibilidad.
    """
    feats = extract_features_full(el_full, meta) if el_full else extract_features_index(meta)
    vec   = net.predict(feats)

    if creative:
        # Ruido gaussiano moderado — suficiente para salir de lo típico
        # pero no tanto que el resultado sea completamente aleatorio.
        # sigma=0.18: ~68% de los params se mueven ±18% de su rango
        # seed externo si se pasa --seed, sino uno por símbolo para reproducibilidad
        _seed = seed if seed is not None else hash(sym) % 2**32
        rng   = np.random.default_rng(seed=_seed)
        noise = rng.normal(0, 0.18, size=vec.shape).astype(np.float32)
        vec   = np.clip(vec + noise, 0.0, 1.0)
        # Boost adicional en los flags de nodos opcionales:
        # con creative hay más probabilidad de activar nodos que normalmente estarían off
        opt_start = N_PARAMS
        for i in range(opt_start, len(vec)):
            # Sesgar hacia activar — (0.5 → 0.65) antes del threshold
            vec[i] = float(np.clip(vec[i] + 0.15, 0.0, 1.0))

    pipeline = vector_to_pipeline(vec)
    vert, frag = compile_pipeline(pipeline)

    suffix = '_creative' if creative else '_ml'
    label  = 'Creative ML' if creative else 'ML'

    base = {
        'version':      '3.0',
        'created':      datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00','Z'),
        'generated_by': f'generate_materials_ml.py v3 [{creative if creative else mode}]',
        'name':         f'{sym} {label}',
        'description':  f'Material {label.lower()} para {sym} ({meta.get("group","")})',
        'family':       _group_to_family(meta.get('group', '')),
        'mode':         'custom',
        'target':       'sphere',
        'layer':        'all',
        'pipeline':     pipeline,
        'compiled':     {'vert': vert, 'frag': frag},
    }

    if mode == 'built_in':
        # Formato built-in: sin element, con name/description en el root
        base['element'] = None
    else:
        # Formato custom ShaderLab: element específico
        base['element'] = sym

    return base, suffix


def _group_to_family(group):
    """Mapea grupo del elemento a familia del material (mismo sistema que built-ins)."""
    return {
        'noble_gas':        'gas',
        'nonmetal':         'gas',
        'halogen':          'gas',
        'alkali_metal':     'metal',
        'alkaline_earth':   'metal',
        'transition_metal': 'metal',
        'post_transition':  'metal',
        'metalloid':        'crystal',
        'lanthanide':       'lanthanide',
        'actinide':         'radioactive',
        'superheavy':       'radioactive',
    }.get(group, 'metal')


# ═══════════════════════════════════════════════════════════════════════════════
#  GENERADOR DE MÓDULO JS
# ═══════════════════════════════════════════════════════════════════════════════

def generate_js_module(weights_path, out_path):
    """Genera shader_ml.js con weights embebidos y API completa."""
    weights = json.loads(Path(weights_path).read_text())
    meta    = weights['meta']

    # Serializar pipeline_map y params compacto
    pm_json = json.dumps(meta['pipeline_map'], indent=2)

    js = f"""/**
 * shader_ml.js — Inferencia de materiales ShaderLab
 * ==================================================
 * Generado por generate_materials_ml.py v3
 * {datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00','Z')}
 *
 * API:
 *   ShaderML.generate(elementJSON)               → pipeline[]
 *   ShaderML.generateBondMaterial(elA, elB)      → pipeline[]
 *   ShaderML.extractFeatures(elementJSON)         → Float32Array({meta['n_in']})
 *   ShaderML.inferParams(features)               → Float32Array({meta['n_out_total']})
 *   ShaderML.buildPipeline(paramsVec)            → pipeline[]
 */

const _W1 = {json.dumps(weights['W1'])};
const _b1 = {json.dumps(weights['b1'])};
const _W2 = {json.dumps(weights['W2'])};
const _b2 = {json.dumps(weights['b2'])};
const _W3 = {json.dumps(weights['W3'])};
const _b3 = {json.dumps(weights['b3'])};

const _PIPELINE_MAP = {pm_json};
const _N_PARAMS   = {meta['n_params']};
const _N_OPTIONAL = {meta['n_optional']};

const _sigmoid = x => 1/(1+Math.exp(-Math.max(-500,Math.min(500,x))));
const _relu    = x => Math.max(0,x);

function _forward(x) {{
    const mv = (W,b,x,fn) => {{
        const o = new Float32Array(b.length);
        for(let j=0;j<b.length;j++){{
            let s=b[j]; for(let i=0;i<x.length;i++) s+=W[i][j]*x[i];
            o[j]=fn(s);
        }}
        return o;
    }};
    return mv(_W3,_b3, mv(_W2,_b2, mv(_W1,_b1,x,_relu),_relu), _sigmoid);
}}

const _METALS  = new Set(['alkali_metal','alkaline_earth','transition_metal','post_transition','lanthanide','actinide','superheavy','liquid']);
const _GASES   = new Set(['noble_gas']);
const _HALOGENS= new Set(['nonmetal','halogen']);

export const ShaderML = {{

    extractFeatures(el) {{
        const id=el.identity??{{}}, at=el.atomic_structure??{{}},
              ph=el.physical_properties??{{}}, em=el.electromagnetism_and_mechanics??{{}},
              re=el.reactivity??{{}}, th=el.thermodynamics??{{}};
        const s=(v,d=0)=>{{const n=parseFloat(v);return isFinite(n)?n:d;}};
        const lp=Math.log1p.bind(Math);
        const f=new Float32Array({meta['n_in']});
        const Z=s(id.number,1);
        f[0]=Z/118; f[1]=s(ph.mass,1)/300; f[2]=s(at.electronegativity,0)/4;
        f[3]=s(at.radius_covalent_pm,70)/250; f[4]=s(at.vanderwaals_radius_pm||at.radius_atomic_pm,150)/300;
        f[5]=s(at.ionic_radius_pm,70)/200; f[6]=lp(s(em.polarizability_angstrom3,1))/6;
        f[7]=lp(s(ph.density_g_cm3,1))/5; f[8]=lp(s(ph.melt_K||ph.melting_point_K,300))/10;
        f[9]=lp(s(ph.boil_K||ph.boiling_point_K,1000))/10; f[10]=s(at.ionization_energy_eV,5)/25;
        f[11]=s(at.electron_affinity_ev,0)/4; f[12]=s(at.valence,1)/8;
        f[13]=s(re.max_bonds,4)/8; f[14]=lp(Math.abs(s(em.electrical_conductivity_sm,0)))/20;
        f[15]=lp(Math.abs(s(em.magnetic_susceptibility,0)))/6;
        f[16]=s(at.effective_nuclear_charge,1)/30;
        f[17]=lp(s(th.latent_heat_fusion_kj_mol,0))/8;
        f[18]=lp(s(th.latent_heat_vaporization_kj_mol,0))/10;
        const cat=(id.category_eng||'').toLowerCase().replace(/ /g,'_');
        f[19]=_METALS.has(cat)?1:0; f[20]=_GASES.has(cat)?1:0; f[21]=_HALOGENS.has(cat)?1:0;
        for(let i=0;i<f.length;i++) f[i]=Math.max(0,Math.min(1,f[i]));
        return f;
    }},

    inferParams(features) {{ return _forward(features); }},

    buildPipeline(vec) {{
        const pipeline=[]; let idx=0, oi=_N_PARAMS;
        for(const nd of _PIPELINE_MAP) {{
            const params={{}};
            for(const [k,r] of Object.entries(nd.param_ranges)) {{
                const norm=Math.max(0,Math.min(1,vec[idx++]));
                const raw=norm*(r.max-r.min)+r.min;
                const span=r.max-r.min;
                params[k]=span<1?+raw.toFixed(3):span<10?+raw.toFixed(2):+raw.toFixed(1);
            }}
            const enabled=nd.always_on?true:vec[oi++]>0.5;
            pipeline.push({{key:nd.key,enabled,params,custom:false}});
        }}
        return pipeline;
    }},

    generate(elementJSON) {{
        return this.buildPipeline(this.inferParams(this.extractFeatures(elementJSON)));
    }},

    generateBondMaterial(elA, elB) {{
        const fA=this.extractFeatures(elA), fB=this.extractFeatures(elB);
        const fB2=new Float32Array(fA.length);
        for(let i=0;i<fA.length;i++) fB2[i]=(fA[i]+fB[i])*0.5;
        // Boost en electronegatividad diferencial — señal del tipo de enlace
        const enA=parseFloat(elA.atomic_structure?.electronegativity??2);
        const enB=parseFloat(elB.atomic_structure?.electronegativity??2);
        fB2[2]=Math.min(1,(fA[2]+fB[2])*0.5+Math.abs(enA-enB)/4*0.3);
        return this.buildPipeline(this.inferParams(fB2));
    }},
}};
"""
    p = Path(out_path)
    p.parent.mkdir(parents=True, exist_ok=True)  # crea src/ShaderLab/ si no existe
    p.write_text(js, encoding='utf-8')
    size = p.stat().st_size // 1024
    print(f'  ✓ shader_ml.js → {out_path}  ({size}KB)')


# ═══════════════════════════════════════════════════════════════════════════════
#  TESTS
# ═══════════════════════════════════════════════════════════════════════════════

def run_tests(elements_index, elements_data):
    print('\n── Tests ─────────────────────────────────────────────────────')
    ok = fail = 0

    # T1: extract_features no falla
    print('[T1] extract_features...')
    for sym, meta in elements_index.items():
        try:
            el = elements_data.get(sym)
            f  = extract_features_full(el, meta) if el else extract_features_index(meta)
            assert f.shape == (N_FEATURES,) and np.all(f >= 0) and np.all(f <= 1)
        except Exception as e:
            print(f'  ✗ {sym}: {e}'); fail += 1
    print(f'  ✓ {len(elements_index)} elementos')
    ok += 1

    # T2: forward pass
    print('[T2] Forward pass...')
    try:
        net = TinyNet()
        sym = list(elements_index.keys())[0]
        f   = extract_features_index(elements_index[sym])
        out = net.predict(f)
        assert out.shape == (N_OUT,) and np.all(out >= 0) and np.all(out <= 1)
        print(f'  ✓ output {out.shape}  [{out.min():.3f}, {out.max():.3f}]')
        ok += 1
    except Exception as e:
        print(f'  ✗ {e}'); fail += 1

    # T3: round-trip params → vector → pipeline → compile
    print('[T3] Round-trip + compile...')
    try:
        net = TinyNet()
        sym = list(elements_index.keys())[0]
        f   = extract_features_index(elements_index[sym])
        vec = net.predict(f)
        pipe= vector_to_pipeline(vec)
        v,g = compile_pipeline(pipe)
        assert 'void main' in v and 'void main' in g
        enabled = [n['key'] for n in pipe if n['enabled']]
        print(f'  ✓ nodos activos: {enabled}')
        ok += 1
    except Exception as e:
        print(f'  ✗ {e}'); fail += 1

    print(f'\n  {ok} OK  |  {fail} fallidos')
    return fail == 0


# ═══════════════════════════════════════════════════════════════════════════════
#  MAIN
# ═══════════════════════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(
        description='ShaderLab ML Generator v3',
        formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--load',        default=None,
                        help='Cargar weights existentes (omite entrenamiento)')
    parser.add_argument('--save',        default=str(OUTPUT_WEIGHTS),
                        help=f'Guardar weights (default: {OUTPUT_WEIGHTS})')
    parser.add_argument('--out',         default=str(OUTPUT_PRESETS),
                        help=f'Directorio de salida (default: {OUTPUT_PRESETS})')
    parser.add_argument('--only',        nargs='+',
                        help='Generar solo para estos símbolos')
    parser.add_argument('--skip-existing', action='store_true',
                        help='No sobreescribir presets existentes')
    parser.add_argument('--epochs',      type=int,   default=5000)
    parser.add_argument('--lr',          type=float, default=5e-4)
    parser.add_argument('--dry-run',     action='store_true',
                        help='Mostrar resultados sin guardar')
    parser.add_argument('--train-only',  action='store_true',
                        help='Solo entrenar y guardar weights, sin generar presets')
    parser.add_argument('--test',        action='store_true',
                        help='Correr suite de tests')
    parser.add_argument('--js',          default=None,
                        help='Generar módulo JS de inferencia en esta ruta')

    # ── Modo de generación ────────────────────────────────────────────────────
    mode_group = parser.add_mutually_exclusive_group()
    mode_group.add_argument('--built-in',   action='store_true',
                        help='Genera built-ins (element:null) → src/materials/{sym}_ml.json')
    mode_group.add_argument('--custom-ml',  action='store_true', default=True,
                        help='[Default] Genera presets específicos → ShaderLab/custom/shader_{sym}.json')
    parser.add_argument('--creative',       action='store_true',
                        help='Con --custom-ml: inyecta ruido para resultados inesperados 🎲')
    parser.add_argument('--seed',           type=int, default=None,
                        help='Seed global para --creative (default: hash del símbolo)')

    args = parser.parse_args()

    # Resolver modo
    if args.built_in:
        gen_mode = 'built_in'
    else:
        gen_mode = 'custom_ml'
    gen_creative = args.creative and not args.built_in
    gen_seed     = args.seed  # None = seed por símbolo

    print(f"\n{'='*60}")
    print(f"  ShaderLab ML Generator v4")
    print(f"{'='*60}\n")

    # ── Cargar datos del proyecto ─────────────────────────────────────────────
    print('[1/4] Cargando datos del proyecto...')
    elements_index, elements_data, materials_list, training_pairs = load_project_data()

    # ── Tests ─────────────────────────────────────────────────────────────────
    if args.test:
        ok = run_tests(elements_index, elements_data)
        sys.exit(0 if ok else 1)

    # ── Red neuronal ──────────────────────────────────────────────────────────
    if args.load:
        print(f'\n[2/4] Cargando weights desde {args.load}...')
        net = TinyNet.load(args.load)
    else:
        net = TinyNet()
        if training_pairs:
            X = np.stack([p['features']   for p in training_pairs])
            Y = np.stack([p['target_vec'] for p in training_pairs])
            print(f'\n[2/4] Entrenando con {len(training_pairs)} pares')
            print(f'      epochs={args.epochs}  lr={args.lr}')
            print(f'      input={N_FEATURES}  output={N_OUT}  (params={N_PARAMS} + flags={N_OPTIONAL})')
            best = train(net, X, Y, epochs=args.epochs, lr=args.lr)
            print(f'  Loss final: {best:.6f}')
            if not args.dry_run:
                net.save(args.save)
        else:
            print('\n  WARNING: Sin datos de entrenamiento — usando red sin entrenar')

    # ── Generar módulo JS ─────────────────────────────────────────────────────
    if args.js:
        weights_file = args.load or args.save
        if not Path(weights_file).exists():
            net.save(weights_file)
        print(f'\n[3/4] Generando módulo JS → {args.js}...')
        generate_js_module(weights_file, args.js)

    if args.train_only:
        print('\n  [train-only] Listo.')
        return

    # ── Generar presets ───────────────────────────────────────────────────────
    syms = args.only or list(elements_index.keys())

    # Directorio y nombre de archivo según modo
    if gen_mode == 'built_in':
        out_dir   = Path(args.out)
        mode_tag  = '🔩 built-in'
        get_fname = lambda sym, _: f'{sym}_ml.json'
    elif gen_creative:
        out_dir   = SHADERLAB_DIR
        mode_tag  = '🎲 creative'
        get_fname = lambda sym, _: f'shader_{sym}_creative.json'
    else:
        out_dir   = SHADERLAB_DIR
        mode_tag  = '🧠 custom-ml'
        get_fname = lambda sym, _: f'shader_{sym}.json'

    # Override manual con --out
    if args.out != str(OUTPUT_PRESETS):
        out_dir = Path(args.out)

    print(f'\n[4/4] Generando {len(syms)} materiales [{mode_tag}] → {out_dir}')
    if not args.dry_run:
        out_dir.mkdir(parents=True, exist_ok=True)

    ok = skip = fail = 0
    generated_fnames = []   # para el index-ml.json

    for sym in syms:
        meta = elements_index.get(sym)
        if not meta:
            print(f'  WARNING: {sym} no en el index'); fail += 1; continue

        fname    = get_fname(sym, meta)
        out_path = out_dir / fname

        if args.skip_existing and out_path.exists():
            skip += 1; continue

        preset, _ = generate_preset(sym, meta, elements_data.get(sym), net,
                                    mode=gen_mode, creative=gen_creative,
                                    seed=gen_seed)

        if args.dry_run:
            enabled = [n['key'] for n in preset['pipeline'] if n['enabled']]
            cg = next((n['params'] for n in preset['pipeline'] if n['key']=='color_grade'), {})
            print(f'  {sym:3s} [{meta.get("group","?"):20s}]  {enabled}')
            if cg:
                print(f'      color_grade: r={cg.get("r",1):.2f} g={cg.get("g",1):.2f} b={cg.get("b",1):.2f}')
        else:
            out_path.write_text(json.dumps(preset, indent=2))
            generated_fnames.append(fname.replace('.json', ''))
            ok += 1

    # ── Generar index-ml.json ─────────────────────────────────────────────────
    if not args.dry_run and generated_fnames:
        seed_tag  = f'_seed{gen_seed}' if gen_seed is not None else ''
        index_name = f'index-ml{seed_tag}.json' if not gen_creative else f'index-creative{seed_tag}.json'
        index_path = out_dir / index_name
        index_data = {
            'version':      '1.0',
            'generated_by': 'generate_materials_ml.py v4',
            'mode':         gen_mode,
            'creative':     gen_creative,
            'seed':         gen_seed,
            'created':      datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00','Z'),
            'materials':    sorted(generated_fnames),
        }
        index_path.write_text(json.dumps(index_data, indent=2))
        print(f'  ✓ {index_name}  ({len(generated_fnames)} entradas)')

    print(f"\n{'='*60}")
    if args.dry_run:
        print(f'  [dry-run] {len(syms)} procesados [{mode_tag}]')
    else:
        print(f'  OK: {ok}  |  Saltados: {skip}  |  Fallidos: {fail}')
        if ok: print(f'  Directorio: {out_dir.resolve()}')
    print(f"{'='*60}\n")


if __name__ == '__main__':
    main()
