#!/usr/bin/env python3
"""
bake_orbitals_v8.py — Horneador universal de orbitales cuánticos
================================================================
CAMBIOS vs v7:
  - Nuevo modo --mode mo_atlas: atlas genérico de orbitales moleculares LCAO
    → 12 MOs base cubren >95% de los bonds en la tabla periódica completa
    → independiente de molécula específica — un solo bake para todos los elementos
    → coordenadas normalizadas (A en z=-0.5, B en z=+0.5, separación=1.0)
    → en runtime: escalar por distancia real del bond, rotar al eje A→B
    → output: orbital_cache/_mo_atlas/{key}.bin + metadata.json + atlas_map.json
  - bake_molecular() legacy intacto como --mode molecular (por molécula específica)
  - Nueva función valence_type(): clasifica orbital de Valencia desde
    electron_configuration_string → 's1' | 's2' | 'p' | 'd' | 'f'
  - MO_ATLAS_MAP: tabla de lookup (valence_typeA, valence_typeB, bond_order) → key
    para que OrbitalCache seleccione el MO correcto en runtime sin lógica extra

Uso:
  uv run --python 3.12 --with numpy --with scipy bake_orbitals_v8.py --elements all --mode mo_atlas
  uv run --python 3.12 --with numpy --with scipy bake_orbitals_v8.py --elements all --mode mo_atlas --dry-run
  uv run --python 3.12 --with numpy --with scipy bake_orbitals_v8.py --elements Fe
  uv run --python 3.12 --with numpy --with scipy bake_orbitals_v8.py --elements Fe --points 5000
  uv run --python 3.12 --with numpy --with scipy bake_orbitals_v8.py --elements all
  uv run --python 3.12 --with numpy --with scipy bake_orbitals_v8.py --elements Fe --dry-run

v7 vs v6:
  - r_max calculado via física real: Slater + radio del JSON
    r(n,l) = r_atomic × (Z_eff_valence / Z_eff(n,l)) × (n/n_max)²
    → el orbital de valencia reproduce exactamente r_atomic del JSON (esfera LOD)
    → capas internas escalan correctamente (Z_eff mayor → más contraídas)
  - r_sample separado de r_max: el bakeo samplea hasta r_95_coverage (físico)
    → la esfera LOD usa r_cov (radio químico)
    → los puntos cubren el 95% real de la densidad de probabilidad
    → no se necesitan threshold/concentrate/boost para compensar
  - Slater corregido: nivel n-1 completo (incluyendo d) da 0.85 para s/p
  - radio_atomic leído del JSON del elemento (covalente > atómico > VdW)

"""

import json, math, os, re, struct, sys, time, argparse
import numpy as np
from pathlib import Path
from scipy.special import eval_genlaguerre, sph_harm_y

# ── Rutas ─────────────────────────────────────────────────────────────────────
ELEMENTS_DIR = Path('src/elements')
INDEX_PATH   = Path('src/elements-index.json')
OUTPUT_BASE  = Path('orbital_cache')
A0_PM        = 52.9177   # radio de Bohr en pm

L_LABELS     = {0: 's', 1: 'p', 2: 'd', 3: 'f'}

# ── Radio orbital via Slater + radio del JSON ─────────────────────────────────

def slater_zeff(n, l, subshells):
    """
    Carga nuclear efectiva Z_eff para el orbital (n,l) via reglas de Slater (1930).
    subshells: lista de (n, l, electrons) del elemento completo.

    Reglas de apantallamiento:
      Para orbitales s/p:
        - Mismo [ns, np]:               0.35 por electrón (0.30 si 1s)
        - Nivel n-1 (cualquier subcapa): 0.85 por electrón
        - Nivel n-2 o menor:             1.00 por electrón
        - nd/nf del mismo nivel n:       no apantalla (exterior energético)
      Para orbitales d/f:
        - Misma subcapa (n,l):          0.35 por electrón
        - Todo lo demás interior:        1.00 por electrón
    """
    Z_total = sum(e for _, _, e in subshells)
    sigma   = 0.0

    for ni, li, ei in subshells:
        if l <= 1:   # orbital s o p
            if ni == n and li <= 1:
                # mismo grupo [ns, np] — incluye el propio orbital
                same = (ei - 1) if (li == l) else ei
                sigma += same * (0.30 if n == 1 else 0.35)
            elif ni == n - 1:
                # nivel n-1 completo (s, p, d) → 0.85
                sigma += ei * 0.85
            elif ni < n - 1:
                # nivel n-2 o menor → 1.00
                sigma += ei * 1.00
            # ni == n con li > 1 (nd/nf): no apantalla a s/p
        else:        # orbital d o f
            if ni == n and li == l:
                sigma += (ei - 1) * 0.35
            elif ni < n or (ni == n and li < l):
                sigma += ei * 1.00
            # capas exteriores: no apantallan

    return max(Z_total - sigma, 0.1)


def r_max_orbital(n, l, subshells, r_atomic_pm):
    """
    Radio máximo del orbital (n,l) en pm, anclado al radio atómico del JSON.

    Fórmula:  r(n,l) = r_atomic × (Z_eff(n_max,l_outer) / Z_eff(n,l)) × (n / n_max)²

    - r_atomic_pm  — del JSON (covalente > atómico > VdW)
    - Z_eff via Slater puro para todas las capas — consistente internamente
    - El orbital (n_max, l_outer) reproduce exactamente r_atomic del JSON
      porque zeff_v/zeff_v = 1 y (n_max/n_max)² = 1
    - Las capas internas escalan físicamente: mayor Z_eff → más contraídas

    Mínimo: A0_PM * 0.3 para capas muy internas (1s de metales pesados).

    Nota: effective_nuclear_charge del JSON NO se usa aquí porque apunta
    al orbital de mayor energía (ej. 3d en Fe) mientras que l_outer apunta
    al de mayor n (4s en Fe) — mezclarlos rompe la escala.
    """
    n_max   = max(ni for ni, _, _ in subshells)
    l_outer = max(li for ni, li, _ in subshells if ni == n_max)
    zeff_v  = slater_zeff(n_max, l_outer, subshells)
    zeff_nl = slater_zeff(n, l, subshells)
    r = r_atomic_pm * (zeff_v / zeff_nl) * (n / n_max) ** 2
    return max(r, A0_PM * 0.3)

def r_sample_orbital(n, l, z_eff, coverage=0.95, n_pts=2000):
    """
    Radio en pm que contiene 'coverage' fracción de la densidad de probabilidad
    del orbital (n,l) con carga nuclear efectiva z_eff.

    Usa integración numérica de |R_nl(r)|² × r² (densidad radial real).
    Separado de r_max_orbital (radio químico para la esfera LOD) porque
    el radio de enlace covalente captura solo ~12% de la densidad del 1s de H
    pero queremos que los puntos representen la función de onda completa.

    Valores típicos: H 1s ≈166pm (5.4× r_cov), Fe 3d ≈150pm (1.3× r_cov)
    """
    from scipy.special import assoc_laguerre

    a_eff = A0_PM / z_eff   # radio de Bohr efectivo en pm

    # Rango amplio: hasta 10n² radios de Bohr efectivos
    r_max_bohr = 10 * n**2
    r = np.linspace(0.001, r_max_bohr, n_pts)

    rho = 2 * r / n   # variable adimensional
    R   = rho**l * np.exp(-rho / 2) * assoc_laguerre(rho, n - l - 1, 2*l+1)
    density = R**2 * r**2
    density = np.maximum(density, 0)

    cumulative = np.cumsum(density)
    total = cumulative[-1]
    if total <= 0:
        return a_eff * n**2 * 3   # fallback seguro

    idx = np.searchsorted(cumulative / total, coverage)
    idx = min(idx, n_pts - 1)
    return r[idx] * a_eff   # convertir a pm


# ── Cadena de decaimiento U-238 (fallback si el JSON no la tiene) ─────────────
U238_DECAY_CHAIN = [
    {"isotope":"U-238",  "Z":92,"A":238,"decay_mode":"alpha",      "half_life_s":1.41e17, "half_life_human":"4.47×10⁹ años",   "daughter":"Th-234",  "alpha_energy_mev":4.267,  "gamma_energy_kev":None},
    {"isotope":"Th-234", "Z":90,"A":234,"decay_mode":"beta_minus", "half_life_s":2.08e6,  "half_life_human":"24.1 días",        "daughter":"Pa-234m", "beta_energy_mev":0.273,   "gamma_energy_kev":92.8},
    {"isotope":"Pa-234m","Z":91,"A":234,"decay_mode":"beta_minus", "half_life_s":72,      "half_life_human":"1.17 minutos",     "daughter":"U-234",   "beta_energy_mev":2.194,   "gamma_energy_kev":1001.0},
    {"isotope":"U-234",  "Z":92,"A":234,"decay_mode":"alpha",      "half_life_s":7.74e12, "half_life_human":"245,500 años",     "daughter":"Th-230",  "alpha_energy_mev":4.858,  "gamma_energy_kev":53.2},
    {"isotope":"Th-230", "Z":90,"A":230,"decay_mode":"alpha",      "half_life_s":2.37e12, "half_life_human":"75,400 años",      "daughter":"Ra-226",  "alpha_energy_mev":4.687,  "gamma_energy_kev":68.0},
    {"isotope":"Ra-226", "Z":88,"A":226,"decay_mode":"alpha",      "half_life_s":5.05e10, "half_life_human":"1,600 años",       "daughter":"Rn-222",  "alpha_energy_mev":4.871,  "gamma_energy_kev":186.2},
    {"isotope":"Rn-222", "Z":86,"A":222,"decay_mode":"alpha",      "half_life_s":330307,  "half_life_human":"3.82 días",        "daughter":"Po-218",  "alpha_energy_mev":5.590,  "gamma_energy_kev":510.0},
    {"isotope":"Po-218", "Z":84,"A":218,"decay_mode":"alpha",      "half_life_s":185,     "half_life_human":"3.05 minutos",     "daughter":"Pb-214",  "alpha_energy_mev":6.115,  "gamma_energy_kev":None},
    {"isotope":"Pb-214", "Z":82,"A":214,"decay_mode":"beta_minus", "half_life_s":1608,    "half_life_human":"26.8 minutos",     "daughter":"Bi-214",  "beta_energy_mev":0.671,   "gamma_energy_kev":351.9},
    {"isotope":"Bi-214", "Z":83,"A":214,"decay_mode":"beta_minus", "half_life_s":1194,    "half_life_human":"19.9 minutos",     "daughter":"Po-214",  "beta_energy_mev":1.506,   "gamma_energy_kev":609.3},
    {"isotope":"Po-214", "Z":84,"A":214,"decay_mode":"alpha",      "half_life_s":1.643e-4,"half_life_human":"164.3 μs",         "daughter":"Pb-210",  "alpha_energy_mev":7.833,  "gamma_energy_kev":799.7},
    {"isotope":"Pb-210", "Z":82,"A":210,"decay_mode":"beta_minus", "half_life_s":7.03e8,  "half_life_human":"22.3 años",        "daughter":"Bi-210",  "beta_energy_mev":0.061,   "gamma_energy_kev":46.5},
    {"isotope":"Bi-210", "Z":83,"A":210,"decay_mode":"beta_minus", "half_life_s":433036,  "half_life_human":"5.01 días",        "daughter":"Po-210",  "beta_energy_mev":1.161,   "gamma_energy_kev":None},
    {"isotope":"Po-210", "Z":84,"A":210,"decay_mode":"alpha",      "half_life_s":1.196e7, "half_life_human":"138.4 días",       "daughter":"Pb-206",  "alpha_energy_mev":5.307,  "gamma_energy_kev":803.1},
    {"isotope":"Pb-206", "Z":82,"A":206,"decay_mode":"stable",     "half_life_s":None,    "half_life_human":"ESTABLE",          "daughter":None,      "alpha_energy_mev":None,   "gamma_energy_kev":None},
]

# ── Física ────────────────────────────────────────────────────────────────────

def radial_wavefunction_vec(n, l, r_bohr_arr):
    """R_nl(r) vectorizada en unidades de Bohr (Z=1, hydrogen-like)."""
    from math import factorial
    rho  = 2.0 * r_bohr_arr / n
    rho  = np.maximum(rho, 1e-12)
    norm = math.sqrt(
        (2.0/n)**3 * factorial(n-l-1) / (2*n * factorial(n+l)**3)
    )
    lag = eval_genlaguerre(n-l-1, 2*l+1, rho)
    return norm * np.exp(-rho/2) * (rho**l) * lag

def real_sph_harm_vec(l, m, theta, phi):
    """Armónico esférico real Y_l^m vectorizado."""
    if m == 0:
        return sph_harm_y(l, 0, theta, phi).real.astype(np.float32)
    elif m > 0:
        return (sph_harm_y(l,  m, theta, phi) * np.sqrt(2)).real.astype(np.float32)
    else:
        return (sph_harm_y(l, -m, theta, phi) * np.sqrt(2)).imag.astype(np.float32)

def sample_orbital(n, l, m, r_max_pm, n_points,
                   threshold=0.0, concentrate=0.0, boost=0.3,
                   batch=80_000, seed=None):
    """
    Rejection sampling vectorizado con filtrado de ruido e importance sampling.

    --threshold  (0.0 – 0.1)
        Poda colas: descarta puntos donde psi2 < psi_max * threshold.
        0.0  -> sin filtrado (original)
        0.02 -> "punto dulce" — lobulos definidos, colas limpias
        0.05 -> muy solido, sin penumbra

    --concentrate  (0.0 – 1.0)
        Zona de alta densidad: fraccion de psi_max que define el "nucleo" del orbital.
        0.0  -> desactivado
        0.6  -> satura las zonas donde psi2 >= 60% del maximo
        0.7  -> solo las crestas mas densas reciben puntos extra

    --boost  (0.0 – 1.0, default 0.3)
        Fraccion del presupuesto total dedicada al pool de concentracion.
        0.3 = 30% de los puntos van al nucleo, 70% a la distribucion normal.
        Solo tiene efecto si --concentrate > 0.

    Comportamiento combinado tipico:
        -t 0.02 --concentrate 0.6 --boost 0.3
        → colas podadas + 30% extra en zonas de maximo

    Fallback honesto: si threshold deja sin puntos despues de MAX_FALLBACK
    intentos, rellena el resto sin umbral y avisa. No baja silenciosamente.
    """
    if seed is not None:
        np.random.seed(seed)

    r_max_bohr = r_max_pm / A0_PM

    # ── Estimar psi_max con grid multi-angular ────────────────────────────────
    # Un solo angulo (como en v3 original) subestima el maximo para p/d/f.
    # Barremos 12 polares x 8 azimutales para encontrar el pico real.
    r_g  = np.linspace(0.01, r_max_bohr, 80)
    th_g = np.linspace(0.05, np.pi - 0.05, 12)
    ph_g = np.linspace(0, 2*np.pi, 8, endpoint=False)

    psi_max = 1e-30
    for th_val in th_g:
        for ph_val in ph_g:
            th_arr  = np.full(len(r_g), th_val)
            ph_arr  = np.full(len(r_g), ph_val)
            R_g     = np.abs(radial_wavefunction_vec(n, l, r_g))
            Y_g     = np.abs(real_sph_harm_vec(l, m, th_arr, ph_arr))
            # FIX Jacobiano (Éter audit): densidad radial real = |ψ|² · r²
            # Sin r², el grid sobreestima el pico en r≈0 y el rejection
            # sampling llena el centro en lugar de los lóbulos exteriores.
            psi_max = max(psi_max, float(np.max((R_g * Y_g)**2 * r_g**2)))

    psi_max  *= 2.0
    min_psi2  = psi_max * threshold           # umbral inferior (poda colas)
    high_psi2 = psi_max * concentrate         # umbral superior (nucleo denso)

    # Presupuesto: si concentrate activo, reservar boost_n puntos para el pool
    # de alta densidad; el resto va al pool normal.
    use_concentrate = (concentrate > 0.0) and (boost > 0.0)
    boost_n  = int(n_points * boost) if use_concentrate else 0
    normal_n = n_points - boost_n

    collected_pts   = []
    collected_phase = []
    MAX_FALLBACK    = 12

    def _collect_pool(target, extra_filter=None):
        """Llena 'target' puntos aplicando threshold + extra_filter opcional."""
        pts_pool   = []
        phase_pool = []
        done       = 0
        fb         = 0
        while done < target:
            need = target - done
            sz   = min(batch, need * 10)

            r     = np.random.uniform(0.001, r_max_bohr, sz)
            theta = np.arccos(np.random.uniform(-1.0, 1.0, sz))
            phi   = np.random.uniform(0, 2*np.pi, sz)

            R    = radial_wavefunction_vec(n, l, r)
            Y    = real_sph_harm_vec(l, m, theta, phi)
            # FIX Jacobiano (Eter audit): |psi|^2 * r^2 da la densidad radial real
            psi2 = (R * Y)**2 * r**2

            base_ok   = np.random.uniform(0, psi_max, sz) < psi2
            thresh_ok = psi2 >= min_psi2
            accept    = base_ok & thresh_ok
            if extra_filter is not None:
                accept &= extra_filter(psi2)

            idx = np.where(accept)[0][:need]

            if len(idx) == 0:
                fb += 1
                if fb >= MAX_FALLBACK and threshold > 0 and extra_filter is None:
                    remaining = target - done
                    print(f"\n    WARNING threshold demasiado alto para "
                          f"n={n} l={l} m={m} -- rellenando {remaining} pts sin umbral",
                          flush=True)
                    idx_fb = np.where(base_ok)[0][:remaining]
                    if len(idx_fb) > 0:
                        r_pm = r[idx_fb] * A0_PM
                        pts_pool.append(np.column_stack([
                            r_pm * np.sin(theta[idx_fb]) * np.cos(phi[idx_fb]),
                            r_pm * np.sin(theta[idx_fb]) * np.sin(phi[idx_fb]),
                            r_pm * np.cos(theta[idx_fb])
                        ]).astype(np.float32))
                        phase_pool.append((r_pm / r_max_pm).astype(np.float32))
                        done += len(idx_fb)
                    else:
                        # psi_max no es local — ajuste solo si el base falla
                        pass
                elif fb >= MAX_FALLBACK and extra_filter is not None:
                    # El pool de concentracion no puede llenarse con este threshold;
                    # simplemente salimos con menos puntos (no es critico)
                    break
                continue

            r_pm = r[idx] * A0_PM
            pts_pool.append(np.column_stack([
                r_pm * np.sin(theta[idx]) * np.cos(phi[idx]),
                r_pm * np.sin(theta[idx]) * np.sin(phi[idx]),
                r_pm * np.cos(theta[idx])
            ]).astype(np.float32))
            phase_pool.append((r_pm / r_max_pm).astype(np.float32))
            done += len(idx)

        if not pts_pool:
            return np.zeros((0,3), dtype=np.float32), np.zeros(0, dtype=np.float32)
        return (np.concatenate(pts_pool,   axis=0)[:target],
                np.concatenate(phase_pool, axis=0)[:target])

    # Pool normal: distribucion completa del orbital (con threshold si aplica)
    pts_normal, phs_normal = _collect_pool(normal_n)
    collected_pts.append(pts_normal)
    collected_phase.append(phs_normal)

    # Pool de concentracion: solo puntos en el nucleo denso del orbital
    if use_concentrate:
        pts_boost, phs_boost = _collect_pool(
            boost_n,
            extra_filter=lambda p: p >= high_psi2
        )
        if len(pts_boost):
            collected_pts.append(pts_boost)
            collected_phase.append(phs_boost)

    pts = np.concatenate(collected_pts,   axis=0)[:n_points]
    phs = np.concatenate(collected_phase, axis=0)[:n_points]
    # Barajar para que los puntos del boost no queden todos al final del buffer
    idx_shuffle = np.random.permutation(len(pts))
    return pts[idx_shuffle], phs[idx_shuffle]

def write_bin(path, positions, phase):
    """Formato ORBL: magic(4) + n_points(4) + has_phase(4) + xyz(n×3×4) + phase(n×4)"""
    n = len(positions)
    with open(path, 'wb') as f:
        f.write(b'ORBL')
        f.write(struct.pack('<I', n))
        f.write(struct.pack('<I', 1))
        f.write(positions.astype('<f4').tobytes())
        f.write(phase.astype('<f4').tobytes())

# ── Configuración electrónica ─────────────────────────────────────────────────

NOBLE_CONFIGS = {
    'He': [(1,0,2)],
    'Ne': [(1,0,2),(2,0,2),(2,1,6)],
    'Ar': [(1,0,2),(2,0,2),(2,1,6),(3,0,2),(3,1,6)],
    'Kr': [(1,0,2),(2,0,2),(2,1,6),(3,0,2),(3,1,6),(3,2,10),(4,0,2),(4,1,6)],
    'Xe': [(1,0,2),(2,0,2),(2,1,6),(3,0,2),(3,1,6),(3,2,10),(4,0,2),(4,1,6),(4,2,10),(5,0,2),(5,1,6)],
    'Rn': [(1,0,2),(2,0,2),(2,1,6),(3,0,2),(3,1,6),(3,2,10),(4,0,2),(4,1,6),(4,2,10),(4,3,14),(5,0,2),(5,1,6),(5,2,10),(6,0,2),(6,1,6)],
}

def parse_config(config_str):
    """'[Ar] 3d6 4s2' → lista de (n, l, electrons)"""
    result = []
    core_match = re.match(r'\[(\w+)\]', config_str)
    if core_match:
        noble = core_match.group(1)
        result.extend(NOBLE_CONFIGS.get(noble, []))
        config_str = config_str[core_match.end():].strip()
    l_map = {'s':0,'p':1,'d':2,'f':3}
    for match in re.finditer(r'(\d)([spdf])(\d+)', config_str):
        result.append((int(match.group(1)), l_map[match.group(2)], int(match.group(3))))
    return result

def classify_layer(n, l, subshells):
    """core / semi / valence"""
    n_max = max(s[0] for s in subshells)
    if n == n_max:
        return 'valence'
    elif n == n_max - 1:
        return 'semi'
    elif n == n_max - 2 and l == 3:
        return 'semi'   # 5f en actínidos, 4f en lantánidos
    else:
        return 'core'

# ── Helpers de decay chain ────────────────────────────────────────────────────

def gamma_to_color(kev):
    if kev is None: return None
    e = float(kev)
    if e < 100:   r,g,b = 1.0, e/100*0.5, 0.0
    elif e < 500: t=(e-100)/400; r,g,b = 1.0-t, 0.8, t*0.3
    else:         t=min((e-500)/1000,1.0); r,g,b = 0.0, 0.8-t*0.6, 0.4+t*0.6
    return f"0x{int(r*255):02X}{int(g*255):02X}{int(b*255):02X}"

def enrich_decay_chain(chain):
    out = []
    for step in chain:
        s = dict(step)
        s['gamma_color_hex']    = gamma_to_color(s.get('gamma_energy_kev'))
        s['particle_color_hex'] = ('0xFFCC44' if s.get('decay_mode')=='alpha'
                                   else '0x44AAFF' if 'beta' in s.get('decay_mode','')
                                   else None)
        out.append(s)
    return out

# ── Bake principal ────────────────────────────────────────────────────────────

def bake_element(symbol, element_data, n_points=5000, threshold=0.0, concentrate=0.0, boost=0.3, out_base=None, dry_run=False):
    if out_base is None:
        out_base = OUTPUT_BASE

    ident  = element_data.get('identity', {})
    atomic = element_data.get('atomic_structure', {})

    Z          = ident.get('number', 1)
    name_es    = ident.get('name_es', symbol)
    config_str = atomic.get('electron_configuration_string', '1s1')
    # Radio atómico: preferir covalent > atomic > vanderwaals, con fallback
    radius_pm  = (atomic.get('radius_covalent_pm')
               or atomic.get('radius_atomic_pm')
               or atomic.get('vanderwaals_radius_pm')
               or 100)

    print(f"\n{'='*60}")
    print(f"  {symbol} — {name_es}  Z={Z}  r={radius_pm}pm")
    print(f"  Config: {config_str}")
    print(f"  Puntos/orbital: {n_points}  threshold={threshold}  concentrate={concentrate}  boost={boost}")
    print(f"{'='*60}")

    subshells = parse_config(config_str)
    if not subshells:
        print(f"  ERROR: No se pudo parsear '{config_str}'")
        return None

    n_max = max(s[0] for s in subshells)

    # Mostrar plan
    print(f"  Subcapas: {len(subshells)}")
    total_orbitals = 0
    for n, l, e in subshells:
        lname = L_LABELS[l]
        layer = classify_layer(n, l, subshells)
        n_orbs = 2*l+1
        total_orbitals += n_orbs
        print(f"    {n}{lname} e={e:2d} [{layer}] → {n_orbs} orbitales × {n_points} pts")

    print(f"  Total: {total_orbitals} orbitales × {n_points} = {total_orbitals*n_points:,} puntos")

    if dry_run:
        print("  [dry-run] No se generan archivos.")
        return None

    out_dir = out_base / symbol
    out_dir.mkdir(parents=True, exist_ok=True)

    orbitals_meta = []
    t0_total = time.time()

    for n, l, electrons in subshells:
        lname = L_LABELS[l]
        layer = classify_layer(n, l, subshells)

        # r_max: radio químico para la esfera LOD (anclado a r_cov del JSON)
        r_max   = r_max_orbital(n, l, subshells, radius_pm)

        # r_sample: radio físico que captura el 95% de la densidad de probabilidad
        # Slater Z_eff para este orbital — determina el tamaño real de la función de onda
        z_eff_nl = slater_zeff(n, l, subshells)
        r_sample = r_sample_orbital(n, l, z_eff_nl, coverage=0.95)

        # Distribuir electrones entre los 2l+1 orbitales
        ms      = list(range(-l, l+1))
        e_per_m = electrons / len(ms) if ms else 0

        for m in ms:
            m_str = f"+{m}" if m >= 0 else str(m)
            fname = f"{n}{lname}_m{m_str}.bin"
            fpath = out_dir / fname

            # orbital_key único para acceso individual en el renderer
            orbital_key = f"{n}{lname}_m{m_str}"

            t0 = time.time()
            print(f"  {fname} (r_max={r_max:.0f}pm)...", end='', flush=True)

            positions, phase = sample_orbital(
                n, l, m,
                r_max_pm    = r_sample,   # sampleo hasta r_95 — cobertura real
                n_points    = n_points,
                threshold   = threshold,
                concentrate = concentrate,
                boost       = boost,
                seed        = (n*100 + l*10 + abs(m)) % 9999
            )

            write_bin(str(fpath), positions, phase)

            elapsed = time.time() - t0
            size_kb = fpath.stat().st_size / 1024
            print(f" {elapsed:.1f}s  {size_kb:.0f}KB")

            orbitals_meta.append({
                "file":        fname,
                "orbital_key": orbital_key,   # acceso individual
                "subshell":    f"{n}{lname}", # acceso por subcapa
                "layer":       layer,          # acceso por capa
                "n":           n,
                "l":           l,
                "m":           m,
                "electrons":   round(e_per_m, 3),
                "is_valence":  (n == n_max),
                "r_max_pm":    round(r_max, 1),     # radio químico (esfera LOD)
                "r_sample_pm": round(r_sample, 1),  # radio de sampleo (95% densidad)
                "n_points":    n_points,
            })

    # Cadena de decaimiento
    decay_chain_raw = element_data.get('decay_chain', [])
    if not decay_chain_raw and symbol == 'U':
        decay_chain_raw = U238_DECAY_CHAIN
    decay_chain = enrich_decay_chain(decay_chain_raw)

    total_time = time.time() - t0_total
    total_pts  = sum(o['n_points'] for o in orbitals_meta)

    metadata = {
        "format_version":          "3.1",
        "symbol":                  symbol,
        "name_es":                 name_es,
        "Z":                       Z,
        "electron_configuration":  config_str,
        "radius_pm":               radius_pm,
        "n_max":                   n_max,
        "points_per_orbital":      n_points,
        "clean_threshold":         threshold,
        "concentrate":             concentrate,
        "boost":                   boost,
        "total_orbitals_baked":    len(orbitals_meta),
        "total_points":            total_pts,
        "bake_time_s":             round(total_time, 1),
        "bin_format": {
            "magic":        "ORBL",
            "header_bytes": 12,
            "layout":       "float32_xyz_interleaved + float32_phase",
            "endian":       "little",
            "units":        "pm"
        },
        "orbitals":     orbitals_meta,
        "decay_chain":  decay_chain,
    }

    meta_path = out_dir / 'metadata.json'
    with open(meta_path, 'w') as f:
        json.dump(metadata, f, indent=2)

    total_mb = sum((out_dir / o['file']).stat().st_size for o in orbitals_meta) / 1e6
    print(f"\n  ✓ {len(orbitals_meta)} orbitales | {total_pts:,} puntos | {total_mb:.1f}MB | {total_time:.1f}s")

    return metadata

# ── Carga de elemento desde JSON ──────────────────────────────────────────────

def load_element(symbol):
    """Carga src/elements/<Symbol>.json"""
    for name in [symbol, symbol.capitalize(), symbol.upper(), symbol.lower()]:
        p = ELEMENTS_DIR / f"{name}.json"
        if p.exists():
            with open(p) as f:
                return json.load(f)
    # Fallback: buscar en índice para obtener el path
    if INDEX_PATH.exists():
        with open(INDEX_PATH) as f:
            idx = json.load(f).get('elements', {})
        if symbol in idx:
            p = Path(idx[symbol].get('file', ''))
            if p.exists():
                with open(p) as f:
                    return json.load(f)
    return None

def get_all_symbols():
    if INDEX_PATH.exists():
        with open(INDEX_PATH) as f:
            return list(json.load(f).get('elements', {}).keys())
    return []

# ── CLI ───────────────────────────────────────────────────────────────────────


# ── Modo --spec: listar y bakear orbitales individuales ───────────────────────

def list_orbitals(symbol, element_data, out_base=None):
    """
    Muestra la lista numerada de orbitales disponibles para un elemento,
    indicando si el .bin ya existe en orbital_cache.
    Retorna la lista de dicts para selección posterior.
    """
    if out_base is None:
        out_base = OUTPUT_BASE

    ident  = element_data.get('identity', {})
    atomic = element_data.get('atomic_structure', {})
    name_es    = ident.get('name_es', symbol)
    Z          = ident.get('number', '?')
    config_str = atomic.get('electron_configuration_string', '1s1')
    radius_pm  = (atomic.get('radius_covalent_pm')
               or atomic.get('radius_atomic_pm')
               or atomic.get('vanderwaals_radius_pm') or 100)

    subshells = parse_config(config_str)
    if not subshells:
        print(f"  ERROR: no se pudo parsear config '{config_str}'")
        return []

    n_max   = max(s[0] for s in subshells)
    out_dir = out_base / symbol

    # Leer metadata existente si hay
    meta_path = out_dir / 'metadata.json'
    existing_meta = {}
    if meta_path.exists():
        try:
            with open(meta_path) as f:
                md = json.load(f)
            for orb in md.get('orbitals', []):
                existing_meta[orb['orbital_key']] = orb
        except Exception:
            pass

    orbital_list = []
    for n, l, electrons in subshells:
        lname = L_LABELS[l]
        layer = classify_layer(n, l, subshells)
        r_max = r_max_orbital(n, l, subshells, radius_pm)
        for m in range(-l, l+1):
            m_str = f"+{m}" if m >= 0 else str(m)
            key   = f"{n}{lname}_m{m_str}"
            fname = f"{key}.bin"
            fpath = out_dir / fname
            exists  = fpath.exists()
            size_kb = fpath.stat().st_size / 1024 if exists else 0
            # Parámetros con los que fue bakeado (si hay metadata)
            prev = existing_meta.get(key, {})
            orbital_list.append({
                'idx':      len(orbital_list) + 1,
                'key':      key,
                'file':     fname,
                'n': n, 'l': l, 'm': m,
                'layer':    layer,
                'r_max_pm': round(r_max, 1),
                'electrons': round(electrons / (2*l+1), 3),
                'exists':   exists,
                'size_kb':  round(size_kb, 1),
                'prev_pts': prev.get('n_points', '—'),
            })

    # ── Imprimir tabla ────────────────────────────────────────────────────────
    print(f"\n{'='*66}")
    print(f"  {symbol} — {name_es}  Z={Z}  |  {config_str}")
    print(f"  Orbitales disponibles ({len(orbital_list)} total)")
    print(f"{'='*66}")

    layer_order = ['valence', 'semi', 'core']
    current_layer = None
    for orb in sorted(orbital_list, key=lambda o: (layer_order.index(o['layer']), o['n'], o['l'], o['m'])):
        if orb['layer'] != current_layer:
            current_layer = orb['layer']
            labels = {'valence': 'VALENCIA', 'semi': 'SEMICENTRAL', 'core': 'NÚCLEO'}
            print(f"\n  [ {labels[current_layer]} ]")

        status = f"✓ {orb['size_kb']:.0f}KB  pts={orb['prev_pts']}" if orb['exists'] else "✗ sin bakear"
        print(f"  {orb['idx']:>3}.  {orb['key']:<14}  r_max={orb['r_max_pm']:>5.0f}pm  "
              f"e={orb['electrons']:.3f}  {status}")

    print(f"\n{'='*66}")
    print(f"  Uso: --spec {symbol} --pick 1,3,5   o   --pick 1-5   o   --pick all")
    print(f"{'='*66}\n")
    return orbital_list


def bake_single(symbol, element_data, orbital_key, n_points=5000,
                threshold=0.0, concentrate=0.0, boost=0.3, out_base=None):
    """
    Bakea un único orbital y reemplaza solo ese .bin + actualiza metadata.json.
    """
    if out_base is None:
        out_base = OUTPUT_BASE

    ident  = element_data.get('identity', {})
    atomic = element_data.get('atomic_structure', {})
    name_es   = ident.get('name_es', symbol)
    config_str = atomic.get('electron_configuration_string', '1s1')
    radius_pm  = (atomic.get('radius_covalent_pm')
               or atomic.get('radius_atomic_pm')
               or atomic.get('vanderwaals_radius_pm') or 100)

    subshells = parse_config(config_str)
    if not subshells:
        print(f"  ERROR: no se pudo parsear config '{config_str}'")
        return False

    n_max = max(s[0] for s in subshells)

    # Buscar el orbital solicitado en la config
    target = None
    for n, l, electrons in subshells:
        lname = L_LABELS[l]
        for m in range(-l, l+1):
            m_str = f"+{m}" if m >= 0 else str(m)
            key   = f"{n}{lname}_m{m_str}"
            if key == orbital_key:
                layer = classify_layer(n, l, subshells)
                r_max = r_max_orbital(n, l, subshells, radius_pm)
                e_per_m = round(electrons / (2*l+1), 3)
                target = dict(n=n, l=l, m=m, lname=lname, layer=layer,
                              r_max=r_max, e_per_m=e_per_m)
                break
        if target:
            break

    if not target:
        print(f"  ERROR: orbital '{orbital_key}' no existe en {symbol} ({config_str})")
        return False

    out_dir = out_base / symbol
    out_dir.mkdir(parents=True, exist_ok=True)
    fname = f"{orbital_key}.bin"
    fpath = out_dir / fname

    print(f"\n  Bakeando {symbol}/{orbital_key}")
    print(f"  n={target['n']} l={target['l']} m={target['m']}  "
          f"layer={target['layer']}  r_max={target['r_max']:.0f}pm")
    print(f"  puntos={n_points}  threshold={threshold}  "
          f"concentrate={concentrate}  boost={boost}")

    if fpath.exists():
        old_kb = fpath.stat().st_size / 1024
        print(f"  Reemplazando {fname}  (anterior: {old_kb:.0f}KB)")

    t0 = time.time()
    positions, phase = sample_orbital(
        target['n'], target['l'], target['m'],
        r_max_pm    = target['r_max'],
        n_points    = n_points,
        threshold   = threshold,
        concentrate = concentrate,
        boost       = boost,
        seed        = (target['n']*100 + target['l']*10 + abs(target['m'])) % 9999,
    )
    write_bin(str(fpath), positions, phase)
    elapsed = time.time() - t0
    new_kb  = fpath.stat().st_size / 1024
    print(f"  ✓ {fname}  {new_kb:.0f}KB  {elapsed:.1f}s")

    # ── Actualizar metadata.json (solo el registro de este orbital) ───────────
    meta_path = out_dir / 'metadata.json'
    if meta_path.exists():
        try:
            with open(meta_path) as f:
                meta = json.load(f)
            # Actualizar o insertar la entrada de este orbital
            updated = False
            for orb in meta.get('orbitals', []):
                if orb['orbital_key'] == orbital_key:
                    orb['n_points']    = n_points
                    orb['r_max_pm']    = round(target['r_max'], 1)
                    orb['rebaked_threshold']   = threshold
                    orb['rebaked_concentrate'] = concentrate
                    orb['rebaked_boost']       = boost
                    updated = True
                    break
            if not updated:
                meta.setdefault('orbitals', []).append({
                    'file':        fname,
                    'orbital_key': orbital_key,
                    'subshell':    f"{target['n']}{target['lname']}",
                    'layer':       target['layer'],
                    'n': target['n'], 'l': target['l'], 'm': target['m'],
                    'electrons':   target['e_per_m'],
                    'r_max_pm':    round(target['r_max'], 1),
                    'n_points':    n_points,
                    'rebaked_threshold':   threshold,
                    'rebaked_concentrate': concentrate,
                    'rebaked_boost':       boost,
                })
            with open(meta_path, 'w') as f:
                json.dump(meta, f, indent=2)
            print(f"  metadata.json actualizado")
        except Exception as e:
            print(f"  WARNING: no se pudo actualizar metadata.json: {e}")
    else:
        print(f"  WARNING: metadata.json no encontrado — bakea el elemento completo primero")

    return True


def parse_pick(pick_str, max_idx):
    """
    Parsea --pick: acepta '1,3,5', '1-5', 'all', o combinaciones '1,3-5,8'.
    Retorna set de índices (1-based).
    """
    if pick_str.strip().lower() == 'all':
        return set(range(1, max_idx + 1))
    indices = set()
    for part in pick_str.split(','):
        part = part.strip()
        if '-' in part:
            a, b = part.split('-', 1)
            indices.update(range(int(a), int(b) + 1))
        else:
            indices.add(int(part))
    return indices


def bake_molecular(lcao_path, n_points=20000, threshold=0.0, concentrate=0.0,
                   boost=0.3, out_base=None, dry_run=False):
    """
    Modo Molecular: bakea orbitales moleculares (LCAO) como nubes de puntos.
    Cada MO es la superposicion de dos orbitales atomicos centrados en cada nucleo.

    Coordenadas normalizadas:
      - Atomo A en z = -0.5, Atomo B en z = +0.5 (separacion unitaria)
      - En runtime: escalar por distancia real del enlace y rotar al eje A→B

    Input:  data/LCAO.json
    Output: orbital_cache/_molecular/{bond_key}/
              sigma_1s.bin, sigma_star_1s.bin, pi_2px.bin, etc.
              metadata.json — info de cada MO + bond
    """
    if out_base is None:
        out_base = OUTPUT_BASE

    mol_base = out_base / '_molecular'

    # Cargar LCAO
    with open(lcao_path) as f:
        lcao_data = json.load(f)

    molecules = lcao_data.get('molecules', lcao_data)

    print(f"\n{'='*60}")
    print(f"  MOLECULAR ORBITAL BAKE")
    print(f"  LCAO source: {lcao_path}")
    print(f"  Moleculas: {len(molecules)}")
    print(f"  Puntos/MO: {n_points}")
    print(f"{'='*60}")

    total_mos = 0
    t0_global = time.time()

    for mol in molecules:
        mol_name = mol['molecule']
        scope    = mol.get('scope', 'bond')

        # Recolectar todos los MOs de esta molecula
        all_mos = []
        bond_keys = []

        if 'bonds' in mol:
            for bond in mol['bonds']:
                bond_key = bond['bond'].replace('≡','-').replace('=','-')
                bond_keys.append(bond_key)
                for mo in bond.get('MOs', []):
                    all_mos.append((bond_key, mo, bond.get('atoms', [])))
        elif 'MOs' in mol:
            bond_key = mol_name
            bond_keys.append(bond_key)
            for mo in mol['MOs']:
                atoms = [o['atom'] for o in mo.get('orbitals', [])]
                all_mos.append((bond_key, mo, atoms))
        elif 'systems' in mol:
            for sys in mol['systems']:
                bond_key = sys.get('system', mol_name)
                bond_keys.append(bond_key)
                for mo in sys.get('MOs', []):
                    atoms = [o['atom'] for o in mo.get('orbitals', [])]
                    all_mos.append((bond_key, mo, atoms))

        if not all_mos:
            continue

        print(f"\n  {mol_name} — {len(all_mos)} MOs")

        for bond_key, mo, atoms in all_mos:
            label = mo.get('label', mo['type']).replace('*', '_star')
            label = label.replace(' ', '_')
            is_anti = mo.get('antibonding', False)
            electrons = mo.get('electrons', 0)
            orbitals = mo.get('orbitals', [])

            if len(orbitals) < 2:
                # MOs con un solo centro (lone pairs, etc) — skip para molecular atlas
                print(f"    {label}: solo 1 centro — skip (non-bonding)")
                continue

            # Tomar los dos primeros orbitales (para bonds diatomicos)
            orbA = orbitals[0]
            orbB = orbitals[1]
            nA, lA, mA = _parse_ao(orbA['ao'])
            nB, lB, mB = _parse_ao(orbB['ao'])
            cA = orbA['coeff']
            cB = orbB['coeff']

            out_dir = mol_base / bond_key.replace(' ', '_')
            out_dir.mkdir(parents=True, exist_ok=True)
            fname = f"{label}.bin"
            fpath = out_dir / fname

            print(f"    {label} ({orbA['ao']}×{cA:.3f} + {orbB['ao']}×{cB:.3f})"
                  f"{'  [anti]' if is_anti else ''}"
                  f"  e={electrons}...", end='', flush=True)

            if dry_run:
                print(" [dry-run]")
                total_mos += 1
                continue

            t0 = time.time()
            positions, phase = sample_molecular_orbital(
                nA, lA, mA, cA,
                nB, lB, mB, cB,
                n_points  = n_points,
                threshold = threshold,
                batch     = 100_000,
            )
            write_bin(str(fpath), positions, phase)
            elapsed = time.time() - t0
            size_kb = fpath.stat().st_size / 1024
            print(f" {elapsed:.1f}s  {size_kb:.0f}KB  ({len(positions)//3} pts)")
            total_mos += 1

        # Metadata por bond
        if not dry_run:
            _write_molecular_meta(mol_base, bond_key, mol, all_mos, n_points)

    total_time = time.time() - t0_global
    print(f"\n{'='*60}")
    print(f"  Molecular atlas: {total_mos} MOs bakeados | {total_time:.1f}s")
    print(f"{'='*60}\n")
    return total_mos


def _parse_ao(ao_str):
    """'2px' → (2, 1, +1),  '1s' → (1, 0, 0),  '2pz' → (2, 1, 0)"""
    l_map = {'s': 0, 'p': 1, 'd': 2, 'f': 3}
    n = int(ao_str[0])
    l = l_map[ao_str[1]]
    if l == 0:
        return n, 0, 0
    # p orbitals: pz→m=0, px→m=+1, py→m=-1 (real spherical harmonics convention)
    axis = ao_str[2] if len(ao_str) > 2 else 'z'
    m_map = {'z': 0, 'x': 1, 'y': -1}
    return n, l, m_map.get(axis, 0)


def sample_molecular_orbital(nA, lA, mA, cA, nB, lB, mB, cB,
                              n_points=20000, threshold=0.0, batch=100_000):
    """
    Rejection sampling de un orbital molecular LCAO.

    Coordenadas normalizadas:
      Atomo A en (0, 0, -0.5)
      Atomo B en (0, 0, +0.5)
      Separacion = 1.0 (escalar por distancia real en runtime)

    psi(r) = cA * phi_A(r - RA) + cB * phi_B(r - RB)
    densidad = |psi|^2

    Las funciones de onda usan Z_eff=1 (hydrogen-like).
    El tamanio real se controla via escalado en runtime.
    """
    RA = np.array([0.0, 0.0, -0.5])
    RB = np.array([0.0, 0.0,  0.5])

    # Radio de sampleo en Bohr — cuanto espacio cubrir alrededor de cada nucleo
    # Para orbitales normalizados a separacion=1, usamos n^2 * 1.5 como radio
    r_extent = max(nA, nB)**2 * 1.5

    # Bounding box: centrado en origen, extiende r_extent en cada direccion
    box_half = r_extent + 0.5  # +0.5 para cubrir desde cada nucleo

    # Estimar psi_max con grid
    _grid_1d = np.linspace(-box_half, box_half, 40)
    _z_grid  = np.linspace(-box_half, box_half, 80)  # mas resolucion en eje del bond
    psi_max = 1e-30

    for xv in _grid_1d[::4]:
        for yv in _grid_1d[::4]:
            zv = _z_grid
            pts_test = np.column_stack([
                np.full(len(zv), xv),
                np.full(len(zv), yv),
                zv
            ])
            psi_test = _eval_lcao(pts_test, RA, RB, nA, lA, mA, cA, nB, lB, mB, cB)
            psi_max = max(psi_max, float(np.max(psi_test**2)))

    psi_max *= 1.5  # margen de seguridad

    # Rejection sampling
    collected_pts   = []
    collected_phase = []
    done = 0
    max_iters = 50

    for _ in range(max_iters):
        if done >= n_points:
            break

        need = n_points - done
        sz   = min(batch, need * 12)

        # Puntos aleatorios en la bounding box
        x = np.random.uniform(-box_half, box_half, sz)
        y = np.random.uniform(-box_half, box_half, sz)
        z = np.random.uniform(-box_half, box_half, sz)
        pts = np.column_stack([x, y, z])

        psi = _eval_lcao(pts, RA, RB, nA, lA, mA, cA, nB, lB, mB, cB)
        density = psi**2

        # Rejection sampling
        accept = np.random.uniform(0, psi_max, sz) < density

        # Threshold: podar colas
        if threshold > 0:
            accept &= (density >= psi_max * threshold)

        idx = np.where(accept)[0][:need]
        if len(idx) == 0:
            continue

        accepted_pts = pts[idx].astype(np.float32)
        # Phase: signo de psi para colorear bonding/antibonding en el shader
        accepted_phase = (0.5 + 0.5 * np.sign(psi[idx])).astype(np.float32)

        collected_pts.append(accepted_pts)
        collected_phase.append(accepted_phase)
        done += len(idx)

    if not collected_pts:
        return np.zeros((0, 3), dtype=np.float32), np.zeros(0, dtype=np.float32)

    pts_out = np.concatenate(collected_pts, axis=0)[:n_points]
    phs_out = np.concatenate(collected_phase, axis=0)[:n_points]

    # Shuffle
    idx_shuf = np.random.permutation(len(pts_out))
    return pts_out[idx_shuf], phs_out[idx_shuf]


def _eval_lcao(pts, RA, RB, nA, lA, mA, cA, nB, lB, mB, cB):
    """
    Evalua psi = cA * phi_A(r-RA) + cB * phi_B(r-RB)
    pts: (N, 3) array
    Retorna: (N,) array de valores psi
    """
    psiA = _eval_atomic(pts, RA, nA, lA, mA)
    psiB = _eval_atomic(pts, RB, nB, lB, mB)
    return cA * psiA + cB * psiB


def _eval_atomic(pts, center, n, l, m):
    """
    Evalua phi_nlm en coordenadas esfericas relativas a 'center'.
    pts: (N, 3), center: (3,)
    Retorna: (N,) array
    """
    rel = pts - center[np.newaxis, :]
    x, y, z = rel[:, 0], rel[:, 1], rel[:, 2]

    r = np.sqrt(x**2 + y**2 + z**2)
    r = np.maximum(r, 1e-12)

    theta = np.arccos(np.clip(z / r, -1, 1))
    phi   = np.arctan2(y, x)

    # Funcion de onda radial (Z_eff=1, en unidades de la separacion normalizada)
    # Convertir r a "Bohr efectivos" — con separacion=1, usamos r directamente
    # escalado para que n=1 tenga extension razonable (~1 unidad de separacion)
    r_bohr = r * 2.0  # factor para que el orbital se extienda bien

    R = radial_wavefunction_vec(n, l, r_bohr)
    Y = real_sph_harm_vec(l, m, theta, phi).astype(np.float64)

    return R * Y


def _write_molecular_meta(mol_base, bond_key, mol, all_mos, n_points):
    """Escribe metadata.json para un bond molecular bakeado."""
    clean_key = bond_key.replace(' ', '_')
    out_dir = mol_base / clean_key
    out_dir.mkdir(parents=True, exist_ok=True)

    mos_meta = []
    for bk, mo, atoms in all_mos:
        if bk.replace(' ', '_') != clean_key:
            continue
        label = mo.get('label', mo['type']).replace('*', '_star').replace(' ', '_')
        orbs = mo.get('orbitals', [])
        if len(orbs) < 2:
            continue
        mos_meta.append({
            'file':        f"{label}.bin",
            'label':       mo.get('label', mo['type']),
            'type':        mo['type'],
            'antibonding': mo.get('antibonding', False),
            'energy_rank': mo.get('energy_rank', 0),
            'electrons':   mo.get('electrons', 0),
            'coeffA':      orbs[0]['coeff'],
            'coeffB':      orbs[1]['coeff'],
            'aoA':         orbs[0]['ao'],
            'aoB':         orbs[1]['ao'],
            'n_points':    n_points,
        })

    metadata = {
        'format_version': '1.0',
        'mode':           'molecular',
        'molecule':       mol.get('molecule', bond_key),
        'bond':           bond_key,
        'description':    f"Molecular orbitals for {bond_key}, normalized to unit separation",
        'coordinate_system': {
            'atomA': [0, 0, -0.5],
            'atomB': [0, 0,  0.5],
            'separation': 1.0,
            'usage': 'Scale by actual bond length, rotate to bond axis',
        },
        'bin_format': {
            'magic':   'ORBL',
            'layout':  'float32_xyz_interleaved + float32_phase',
            'endian':  'little',
            'units':   'normalized (separation=1.0)',
            'phase':   '0.0 = negative psi (antibonding lobe), 1.0 = positive psi (bonding lobe)',
        },
        'MOs': mos_meta,
    }

    meta_path = out_dir / 'metadata.json'
    with open(meta_path, 'w') as f:
        json.dump(metadata, f, indent=2)




# ═══════════════════════════════════════════════════════════════════════════════
#  MOLECULAR ORBITAL ATLAS — genérico, independiente de molécula
#  bake_molecular_atlas(): genera ~12 MOs base que cubren la tabla completa.
#  El legacy bake_molecular() queda intacto como modo 'molecular'.
# ═══════════════════════════════════════════════════════════════════════════════

# ── Definición del atlas MO ────────────────────────────────────────────────────
# Cada entrada: (key, label, nA, lA, mA, cA, nB, lB, mB, cB, is_anti, electrons)
# Coordenadas normalizadas: A en z=-0.5, B en z=+0.5, separación=1.0
# En runtime: escalar por distancia real del bond, rotar al eje A→B
# Mapping en runtime: (valence_type_A, valence_type_B, bond_order) → key
#
# Tipos de Valencia cubiertos:
#   s-block:  H(1s), Li-Be(2s), Na-Mg(3s)
#   p-block:  B-Ne(2p), Al-Ar(3p)
#   d-block:  metales de transición (3d, 4d, 5d) — aproximado con d-d
#   f-block:  lantánidos/actínidos (4f/5f) — aproximado con f-p (enlace típico O)
#
# 12 archivos .bin cubren >95% de los bonds en la tabla periódica

MO_ATLAS = [
    # key              label           nA lA mA  cA     nB lB mB  cB    anti  e
    # ── s-s bonds ──────────────────────────────────────────────────────────
    ('sigma_1s-1s',    'σ(1s-1s)',     1, 0, 0, +0.7071, 1, 0, 0, +0.7071, False, 2),
    ('sigma_s_1s-1s',  'σ*(1s-1s)',    1, 0, 0, +0.7071, 1, 0, 0, -0.7071, True,  0),
    ('sigma_2s-2s',    'σ(2s-2s)',     2, 0, 0, +0.7071, 2, 0, 0, +0.7071, False, 2),
    ('sigma_s_2s-2s',  'σ*(2s-2s)',    2, 0, 0, +0.7071, 2, 0, 0, -0.7071, True,  0),

    # ── s-p bonds (heteronuclear, e.g. C-H, N-H, O-H) ─────────────────────
    # θ ≈ 32° mixing angle para electronegativity típica
    ('sigma_2s-1s',    'σ(2s-1s)',     2, 0, 0, +0.8480, 1, 0, 0, +0.5300, False, 2),
    ('sigma_s_2s-1s',  'σ*(2s-1s)',    2, 0, 0, +0.5300, 1, 0, 0, -0.8480, True,  0),

    # ── p-p bonds ──────────────────────────────────────────────────────────
    # σ(2pz-2pz) — enlace sigma entre orbitales p axiales (N₂, O₂, CO)
    ('sigma_2p-2p',    'σ(2p-2p)',     2, 1, 0, +0.7071, 2, 1, 0, +0.7071, False, 2),
    ('sigma_s_2p-2p',  'σ*(2p-2p)',   2, 1, 0, +0.7071, 2, 1, 0, -0.7071, True,  0),

    # π(2px-2px) — enlace pi (doble/triple enlace, m=1 lateral)
    ('pi_2p-2p',       'π(2p-2p)',     2, 1, 1, +0.7071, 2, 1, 1, +0.7071, False, 2),
    ('pi_s_2p-2p',     'π*(2p-2p)',   2, 1, 1, +0.7071, 2, 1, 1, -0.7071, True,  0),

    # ── d-p bonds (metales transición con no-metales, e.g. Fe-O) ───────────
    # cA/cB del mixing angle típico metal-ligando (θ ≈ 40°)
    ('sigma_3d-2p',    'σ(3d-2p)',     3, 2, 0, +0.7660, 2, 1, 0, +0.6430, False, 2),
    ('sigma_s_3d-2p',  'σ*(3d-2p)',   3, 2, 0, +0.6430, 2, 1, 0, -0.7660, True,  0),
]

# ── Mapping: (valence_orbital_A, valence_orbital_B, bond_order) → atlas key ──
# Usado por OrbitalCache en runtime para seleccionar el MO correcto
MO_ATLAS_MAP = {
    # Elementos s-block con H
    ('s1', 's1', 1): 'sigma_1s-1s',      # H-H
    ('s2', 's1', 1): 'sigma_2s-1s',      # Li-H, Na-H
    ('p',  's1', 1): 'sigma_2s-1s',      # C-H, N-H, O-H (sp³ approx s-like)
    # s-s homonuclear
    ('s2', 's2', 1): 'sigma_2s-2s',      # Li-Li
    # p-p
    ('p',  'p',  1): 'sigma_2p-2p',      # single C-C, N-O, O-O
    ('p',  'p',  2): 'pi_2p-2p',         # double bond π component
    ('p',  'p',  3): 'pi_2p-2p',         # triple bond π component
    # d-block con p-block
    ('d',  'p',  1): 'sigma_3d-2p',      # Fe-O, Cu-O, Zn-N
    ('d',  's1', 1): 'sigma_3d-2p',      # Fe-H (approx)
    # f-block — aproximar con d-p (similar mixing)
    ('f',  'p',  1): 'sigma_3d-2p',
    ('f',  's1', 1): 'sigma_3d-2p',
}


def valence_type(electron_config_string):
    """
    Devuelve el tipo de orbital de Valencia ('s1','s2','p','d','f')
    a partir de la electron_configuration_string del JSON del elemento.
    """
    import re
    cfg = electron_config_string
    # Strip noble gas core
    cfg = re.sub(r'\[.*?\]', '', cfg).strip()
    if not cfg:
        return 's1'  # noble gas core only → inert
    # Find last subshell
    tokens = cfg.split()
    tokens = [t for t in tokens if t]
    if not tokens:
        return 's1'
    last = tokens[-1]
    m = re.match(r'(\d+)([spdf])(\d+)', last)
    if not m:
        return 's2'
    n, l_char = int(m.group(1)), m.group(2)
    if l_char == 's' and n == 1:
        return 's1'
    if l_char == 's':
        return 's2'
    if l_char == 'p':
        return 'p'
    if l_char == 'd':
        return 'd'
    if l_char == 'f':
        return 'f'
    return 's2'


def bake_molecular_atlas(n_points=20000, out_base=None, dry_run=False):
    """
    Modo MO Atlas: bakea los ~12 orbitales moleculares base genéricos.

    Son independientes de molécula específica — en runtime el OrbitalCache
    los escala por la distancia real del bond y los rota al eje A→B.

    Output: orbital_cache/_mo_atlas/
      sigma_1s-1s.bin, sigma_2p-2p.bin, pi_2p-2p.bin, ...
      metadata.json  — mapping (valence_typeA, valence_typeB, bond_order) → file
      atlas_map.json — tabla de lookup para OrbitalCache en runtime

    Uso:
      uv run --python 3.12 --with numpy --with scipy \\
        bake_orbitals_v8.py --elements all --mode mo_atlas
      uv run --python 3.12 --with numpy --with scipy \\
        bake_orbitals_v8.py --elements all --mode mo_atlas --dry-run
    """
    if out_base is None:
        out_base = OUTPUT_BASE

    mo_dir = out_base / '_mo_atlas'
    mo_dir.mkdir(parents=True, exist_ok=True)

    print(f"\n{'='*60}")
    print(f"  MOLECULAR ORBITAL ATLAS (genérico)")
    print(f"  {len(MO_ATLAS)} MOs base  |  {n_points} pts/MO")
    print(f"  Output: {mo_dir}")
    print(f"{'='*60}")

    t0_global = time.time()
    ok = 0

    for (key, label, nA, lA, mA, cA, nB, lB, mB, cB, is_anti, electrons) in MO_ATLAS:
        fname = f"{key}.bin"
        fpath = mo_dir / fname

        print(f"\n  [{key}]  {label}", end='')
        print(f"  ({nA}{L_LABELS[lA]}×{cA:+.4f}  {nB}{L_LABELS[lB]}×{cB:+.4f})", end='')
        print(f"{'  [anti]' if is_anti else ''}  e={electrons}...", end='', flush=True)

        if dry_run:
            print(" [dry-run]")
            ok += 1
            continue

        t0 = time.time()
        positions, phase = sample_molecular_orbital(
            nA, lA, mA, cA,
            nB, lB, mB, cB,
            n_points  = n_points,
            threshold = 0.0,
            batch     = 100_000,
        )

        if len(positions) == 0:
            print(" ERROR: sin puntos generados")
            continue

        write_bin(str(fpath), positions, phase)
        elapsed = time.time() - t0
        size_kb = fpath.stat().st_size / 1024
        print(f" {elapsed:.1f}s  {size_kb:.0f}KB  ({len(positions)//3} pts)")
        ok += 1

    # ── Escribir metadata.json ─────────────────────────────────────────────
    if not dry_run:
        mos_meta = []
        for (key, label, nA, lA, mA, cA, nB, lB, mB, cB, is_anti, electrons) in MO_ATLAS:
            mos_meta.append({
                'key':        key,
                'file':       f"{key}.bin",
                'label':      label,
                'aoA':        f"{nA}{L_LABELS[lA]}",
                'aoB':        f"{nB}{L_LABELS[lB]}",
                'mA':         mA,
                'mB':         mB,
                'coeffA':     cA,
                'coeffB':     cB,
                'antibonding': is_anti,
                'electrons':  electrons,
            })

        metadata = {
            'format_version': '2.0',
            'mode':           'mo_atlas',
            'description':    'Generic molecular orbital atlas — scale+rotate in runtime',
            'n_points':       n_points,
            'coordinate_system': {
                'atomA':     [0, 0, -0.5],
                'atomB':     [0, 0,  0.5],
                'separation': 1.0,
                'usage':     'Scale by actual bond_length_pm, rotate to bond axis A→B',
            },
            'bin_format': {
                'magic':  'ORBL',
                'layout': 'float32_xyz_interleaved + float32_phase',
                'endian': 'little',
                'units':  'normalized (separation=1.0)',
                'phase':  '0.0=negative lobe (antibonding), 1.0=positive lobe (bonding)',
            },
            'MOs': mos_meta,
        }

        # atlas_map.json — lookup table para OrbitalCache en runtime
        # Serializar keys de MO_ATLAS_MAP como strings "typeA|typeB|order"
        atlas_map = {}
        for (typeA, typeB, order), mo_key in MO_ATLAS_MAP.items():
            map_key = f"{typeA}|{typeB}|{order}"
            atlas_map[map_key] = mo_key
            # También agregar el reverso (typeB|typeA|order) para simetría
            map_key_rev = f"{typeB}|{typeA}|{order}"
            if map_key_rev not in atlas_map:
                atlas_map[map_key_rev] = mo_key

        with open(mo_dir / 'metadata.json', 'w') as f:
            json.dump(metadata, f, indent=2)
        with open(mo_dir / 'atlas_map.json', 'w') as f:
            json.dump(atlas_map, f, indent=2)

        print(f"\n  metadata.json + atlas_map.json escritos")

    total_time = time.time() - t0_global
    print(f"\n{'='*60}")
    print(f"  MO Atlas: {ok}/{len(MO_ATLAS)} MOs  |  {total_time:.1f}s total")
    print(f"{'='*60}\n")
    return ok


def bake_atlas(elements_symbols, n_points=20000, threshold=0.0, concentrate=0.0,
               boost=0.3, out_base=None, dry_run=False):
    """
    Modo Atlas: bakea formas canónicas (n, l, |m|) a radio unitario (Z_eff=1).
    Genera una tabla de escalado por elemento basada en r_sample_pm real.

    Output: orbital_cache/_atlas/
      {n}{l}_m{|m|}.bin   — geometría canónica, 20k pts, r normalizado
      metadata.json       — tabla de escalado + info de cada forma

    En runtime OrbitalCache escala: position * scale_table[sym][orbital]
    """
    if out_base is None:
        out_base = OUTPUT_BASE

    atlas_dir = out_base / '_atlas'
    atlas_dir.mkdir(parents=True, exist_ok=True)

    # ── Paso 1: Determinar todas las formas canónicas necesarias ──────────
    # Recorrer todos los elementos para encontrar las combinaciones (n, l, |m|)
    all_forms   = set()   # (n, l, abs_m)
    scale_table = {}      # sym → { orbital_key: { r_sample_pm, r_max_pm } }

    print(f"\n{'='*60}")
    print(f"  ATLAS MODE — Escaneando {len(elements_symbols)} elementos")
    print(f"  Puntos/forma: {n_points}")
    print(f"{'='*60}")

    for sym in elements_symbols:
        data = load_element(sym)
        if not data:
            continue

        atomic     = data.get('atomic_structure', {})
        config_str = atomic.get('electron_configuration_string', '1s1')
        radius_pm  = (atomic.get('radius_covalent_pm')
                   or atomic.get('radius_atomic_pm')
                   or atomic.get('vanderwaals_radius_pm') or 100)

        subshells = parse_config(config_str)
        if not subshells:
            continue

        sym_scales = {}
        for n, l, electrons in subshells:
            lname   = L_LABELS[l]
            z_eff   = slater_zeff(n, l, subshells)
            r_samp  = r_sample_orbital(n, l, z_eff, coverage=0.95)
            r_max   = r_max_orbital(n, l, subshells, radius_pm)
            layer   = classify_layer(n, l, subshells)
            e_per_m = electrons / (2*l + 1)

            for m in range(-l, l+1):
                abs_m = abs(m)
                all_forms.add((n, l, abs_m))

                m_str = f"+{m}" if m >= 0 else str(m)
                key   = f"{n}{lname}_m{m_str}"
                sym_scales[key] = {
                    'r_sample_pm': round(r_samp, 1),
                    'r_max_pm':    round(r_max, 1),
                    'layer':       layer,
                    'electrons':   round(e_per_m, 3),
                    'n': n, 'l': l, 'm': m,
                }

        if sym_scales:
            scale_table[sym] = sym_scales

    # Ordenar formas canónicas
    canonical = sorted(all_forms, key=lambda f: (f[0], f[1], f[2]))

    print(f"\n  Formas canónicas encontradas: {len(canonical)}")
    for n, l, abs_m in canonical:
        lname = L_LABELS[l]
        print(f"    {n}{lname} |m|={abs_m}")

    print(f"  Elementos en tabla de escalado: {len(scale_table)}")

    if dry_run:
        print("\n  [dry-run] No se generan archivos.")
        return None

    # ── Paso 2: Bakear cada forma canónica a Z_eff=1 ─────────────────────
    # Radio unitario: usamos r_sample con Z_eff=1 → hydrogen-like puro
    # Los puntos salen en pm (con Z_eff=1), luego se escalan por elemento

    forms_meta = []
    t0_total   = time.time()

    for n, l, abs_m in canonical:
        lname = L_LABELS[l]
        m_str = f"+{abs_m}"
        fname = f"{n}{lname}_m{m_str}.bin"
        fpath = atlas_dir / fname

        # Radio de sampleo canónico: Z_eff=1, coverage=0.95
        r_sample_canonical = r_sample_orbital(n, l, z_eff=1.0, coverage=0.95)

        t0 = time.time()
        print(f"  {fname} (r_canon={r_sample_canonical:.0f}pm)...", end='', flush=True)

        positions, phase = sample_orbital(
            n, l, abs_m,
            r_max_pm    = r_sample_canonical,
            n_points    = n_points,
            threshold   = threshold,
            concentrate = concentrate,
            boost       = boost,
            seed        = (n*100 + l*10 + abs_m) % 9999,
        )

        # Normalizar posiciones: dividir por r_sample_canonical → radio ~1.0
        # En runtime: position * r_sample_pm_del_elemento = posición real
        if r_sample_canonical > 0:
            positions /= r_sample_canonical

        write_bin(str(fpath), positions, phase)

        elapsed = time.time() - t0
        size_kb = fpath.stat().st_size / 1024
        print(f" {elapsed:.1f}s  {size_kb:.0f}KB")

        forms_meta.append({
            'file':               fname,
            'canonical_key':      f"{n}{lname}_|m|{abs_m}",
            'n': n, 'l': l, 'abs_m': abs_m,
            'r_sample_canonical': round(r_sample_canonical, 1),
            'n_points':           n_points,
        })

    # ── Paso 3: Escribir metadata con tabla de escalado ───────────────────
    total_time = time.time() - t0_total

    metadata = {
        'format_version':    '1.0',
        'mode':              'atlas',
        'description':       'Formas canonicas normalizadas a radio unitario. Escalar por r_sample_pm del elemento.',
        'total_forms':       len(forms_meta),
        'points_per_form':   n_points,
        'bake_time_s':       round(total_time, 1),
        'bin_format': {
            'magic':        'ORBL',
            'header_bytes': 12,
            'layout':       'float32_xyz_interleaved + float32_phase',
            'endian':       'little',
            'units':        'normalized (multiply by r_sample_pm)',
        },
        'usage': 'position_pm = position_normalized × scale_table[symbol][orbital_key].r_sample_pm',
        'forms':       forms_meta,
        'scale_table': scale_table,
    }

    meta_path = atlas_dir / 'metadata.json'
    with open(meta_path, 'w') as f:
        json.dump(metadata, f, indent=2)

    total_mb = sum((atlas_dir / f['file']).stat().st_size for f in forms_meta) / 1e6
    print(f"\n  ✓ Atlas: {len(forms_meta)} formas | {n_points:,} pts/forma | {total_mb:.1f}MB | {total_time:.1f}s")
    print(f"  ✓ Tabla de escalado: {len(scale_table)} elementos")
    print(f"  ✓ Metadata: {meta_path}")

    return metadata


if __name__ == '__main__':
    parser = argparse.ArgumentParser(
        description='bake_orbitals_v7 — Bakeo de orbitales cuanticos',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog='''
Modos de uso:
  Bakeo completo (per-element):
    bake_orbitals_v7.py --elements Fe Cu --points 5000 -t 0.02 -c 0.6

  Atlas de formas canonicas (escalables):
    bake_orbitals_v7.py --mode atlas --elements all --points 20000
    bake_orbitals_v7.py --mode atlas --elements all --dry-run

  Atlas de orbitales moleculares (LCAO):
    bake_orbitals_v7.py --mode molecular --elements H --points 20000
    bake_orbitals_v7.py --mode molecular --elements H --dry-run

  Listar orbitales de un elemento:
    bake_orbitals_v7.py --elements Fe --spec

  Bakear orbital(es) especificos:
    bake_orbitals_v7.py --elements Fe --spec --pick 3
    bake_orbitals_v7.py --elements Fe --spec --pick 1,4,7
    bake_orbitals_v7.py --elements Fe --spec --pick 3-7
    bake_orbitals_v7.py --elements Fe --spec --pick all --points 10000 -t 0.02
''')
    parser.add_argument('--elements', nargs='+', required=True,
                        help='Simbolos: Fe Cu Au  |  all = todos')
    parser.add_argument('--mode',    choices=['full', 'atlas', 'molecular', 'mo_atlas'], default='full',
                        help='full=per-element | atlas=formas canónicas | molecular=LCAO legacy | mo_atlas=atlas MO genérico')
    parser.add_argument('--points',   type=int, default=5000,
                        help='Puntos por orbital (default: 5000, atlas recomienda 20000)')
    parser.add_argument('--threshold',    '-t', type=float, default=0.0,
                        help='Poda de colas (default: 0.0 — sin filtro, r_sample cubre el 95%%)')
    parser.add_argument('--concentrate', '-c', type=float, default=0.0,
                        help='Importance sampling zona densa (default: 0.0 — innecesario con r_sample)')
    parser.add_argument('--boost',             type=float, default=0.0,
                        help='Fraccion presupuesto para importance sampling (default 0.3)')
    parser.add_argument('--out',      default='orbital_cache',
                        help='Directorio de salida (default: orbital_cache)')
    parser.add_argument('--dry-run',  action='store_true',
                        help='Solo mostrar plan, sin generar archivos')
    parser.add_argument('--spec',     action='store_true',
                        help='Modo selectivo: lista orbitales numerados del elemento')
    parser.add_argument('--pick',     type=str, default=None,
                        help='Con --spec: indices a bakear. Ej: 3  |  1,4,7  |  3-7  |  all')
    args = parser.parse_args()

    out_base = Path(args.out)

    # ── Modo atlas ────────────────────────────────────────────────────────────
    if args.mode == 'atlas':
        symbols = get_all_symbols() if 'all' in args.elements else args.elements
        # Atlas necesita escanear todos los elementos para la tabla de escalado
        # Si el usuario pidió específicos, solo esos entran en la tabla
        # pero recomendamos 'all' para tabla completa
        if 'all' not in args.elements:
            print(f"  NOTA: --mode atlas con elementos específicos genera tabla parcial.")
            print(f"  Para tabla completa: --mode atlas --elements all")
        pts = args.points if args.points != 5000 else 20000  # default alto para atlas
        result = bake_atlas(
            symbols,
            n_points    = pts,
            threshold   = args.threshold,
            concentrate = args.concentrate,
            boost       = args.boost,
            out_base    = out_base,
            dry_run     = args.dry_run,
        )
        sys.exit(0 if result or args.dry_run else 1)

    # ── Modo molecular ────────────────────────────────────────────────────────
    if args.mode == 'molecular':
        lcao_path = Path('data/LCAO.json')
        if not lcao_path.exists():
            print(f"  ERROR: {lcao_path} no encontrado")
            print(f"  Genera LCAO.json primero (ver LCAO_Bond_Data)")
            sys.exit(1)
        pts = args.points if args.points != 5000 else 20000
        result = bake_molecular(
            lcao_path   = str(lcao_path),
            n_points    = pts,
            threshold   = args.threshold,
            concentrate = args.concentrate,
            boost       = args.boost,
            out_base    = Path(args.out),
            dry_run     = args.dry_run,
        )
        sys.exit(0 if result else 1)

    # ── Modo mo_atlas ─────────────────────────────────────────────────────────
    if args.mode == 'mo_atlas':
        pts = args.points if args.points != 5000 else 20000
        result = bake_molecular_atlas(
            n_points = pts,
            out_base = Path(args.out),
            dry_run  = args.dry_run,
        )
        sys.exit(0 if result else 1)
    if args.spec:
        if len(args.elements) != 1 or args.elements[0] == 'all':
            print("ERROR: --spec requiere exactamente un elemento. Ej: --elements Fe --spec")
            sys.exit(1)

        sym  = args.elements[0]
        data = load_element(sym)
        if not data:
            print(f"ERROR: {sym}.json no encontrado en {ELEMENTS_DIR}")
            sys.exit(1)

        orbital_list = list_orbitals(sym, data, out_base)
        if not orbital_list:
            sys.exit(1)

        # Solo listar — sin --pick
        if args.pick is None:
            sys.exit(0)

        # Bakear los seleccionados
        indices = parse_pick(args.pick, len(orbital_list))
        selected = [o for o in orbital_list if o['idx'] in indices]

        if not selected:
            print(f"ERROR: ningún índice válido en '{args.pick}' (rango 1-{len(orbital_list)})")
            sys.exit(1)

        print(f"  Orbitales seleccionados: {len(selected)}")
        for o in selected:
            print(f"    {o['idx']:>3}. {o['key']}")

        if args.dry_run:
            print("\n  [dry-run] No se generan archivos.")
            sys.exit(0)

        print()
        ok, fail = 0, 0
        for o in selected:
            success = bake_single(
                sym, data,
                orbital_key = o['key'],
                n_points    = args.points,
                threshold   = args.threshold,
                concentrate = args.concentrate,
                boost       = args.boost,
                out_base    = out_base,
            )
            if success: ok += 1
            else:       fail += 1

        print(f"\n  Completado: {ok} OK  |  {fail} fallidos\n")
        sys.exit(0)

    # ── Modo normal: bakeo completo ───────────────────────────────────────────
    symbols  = get_all_symbols() if 'all' in args.elements else args.elements

    print(f"\n{'='*60}")
    print(f"  bake_orbitals_v7  |  {len(symbols)} elemento(s)  |  {args.points} pts/orbital")
    print(f"{'='*60}")

    ok, fail = 0, 0
    for sym in symbols:
        data = load_element(sym)
        if not data:
            print(f"\n  WARNING {sym}: JSON no encontrado, saltando")
            fail += 1
            continue
        result = bake_element(sym, data,
                              n_points    = args.points,
                              threshold   = args.threshold,
                              concentrate = args.concentrate,
                              boost       = args.boost,
                              out_base    = out_base,
                              dry_run     = args.dry_run)
        if result:
            ok += 1
        else:
            fail += 1 if not args.dry_run else 0

    print(f"\n{'='*60}")
    print(f"  Completado: {ok} OK  |  {fail} fallidos")
    print(f"{'='*60}\n")
