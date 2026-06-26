/**
 * Constants.js — Constantes físicas del simulador
 *
 * Fuente única de verdad para todas las constantes.
 * Ningún otro archivo debe definir estas valores — solo importarlos.
 *
 * Dos espacios de trabajo:
 *   - SI:      Sistema Internacional (valores reales, para cálculos internos)
 *   - WU:      World Units (escala del simulador, 1 wu = 100 pm)
 *
 * Factor de conversión: 1 wu = 1e-10 m = 100 pm = 1 Å
 */

// ─── Sistema Internacional ────────────────────────────────────────────────────

export const SI = Object.freeze({

    // Mecánica
    G:          6.674e-11,      // Constante gravitacional (N·m²/kg²)
    g:          9.807,          // Gravedad terrestre (m/s²)

    // Termodinámica
    k_B:        1.380649e-23,   // Constante de Boltzmann (J/K)
    N_A:        6.02214076e23,  // Número de Avogadro (mol⁻¹)
    R:          8.314462,       // Constante de gas ideal (J/mol·K)
    T_room:     298.15,         // Temperatura ambiente estándar (K)

    // Electromagnetismo
    e:          1.602176634e-19, // Carga del electrón (C)
    epsilon_0:  8.8541878e-12,  // Permitividad del vacío (F/m)
    k_e:        8.9875517e9,    // Constante de Coulomb (N·m²/C²)

    // Cuántica
    h:          6.62607015e-34, // Constante de Planck (J·s)
    hbar:       1.054571817e-34,// h / 2π (J·s)
    m_e:        9.1093837e-31,  // Masa del electrón (kg)
    m_p:        1.6726219e-27,  // Masa del protón (kg)
    m_u:        1.6605390e-27,  // Unidad de masa atómica (kg)

    // Óptica
    c:          2.99792458e8,   // Velocidad de la luz (m/s)

});

// ─── World Units (escala del simulador) ──────────────────────────────────────
//
// El simulador usa unidades propias para mantener valores numéricos
// manejables en el integrador.
//
//   1 wu (distancia) = 1 pm  (misma escala que QuantumRenderer/QuantumView)
//   1 wu (masa)      = 1 u   (unidad de masa atómica)
//   1 wu (tiempo)    = 1 frame (~16ms a 60fps)
//   1 wu (energía)   = 1 eV
//
// Los factores de conversión permiten pasar SI ↔ WU cuando sea necesario.

export const WU = Object.freeze({

    // Conversiones de distancia
    PM_PER_WU:      1,              // 1 wu = 1 pm
    M_PER_WU:       1e-12,          // 1 wu = 1 pm = 1e-12 m
    WU_PER_PM:      1.0,            // 1 pm = 1 wu
    WU_PER_ANGSTROM: 100.0,         // 1 Å = 100 wu

    // Conversiones de energía
    J_PER_EV:       1.602176634e-19, // 1 eV en Joules
    EV_PER_J:       6.241509074e18,  // 1 J en eV

    // k_B en unidades del simulador (eV/K) — muy útil para temperatura
    k_B_eV:         8.617333262e-5,  // Constante de Boltzmann (eV/K)

    // Gravedad escalada al simulador
    // g_SI = 9.807 m/s²  →  en wu/s² con 1wu = 1pm = 1e-12m:
    //   g = 9.807 / 1e-12 = 9.807e12 wu/s²
    //
    // A escala atómica la gravedad es ~10³⁹ veces más débil que las
    // fuerzas electromagnéticas — imperceptible sin multiplicador.
    // El slider del Lab controla el factor de exageración.
    g_sim:          9.807e12,        // Gravedad REAL en wu/s² (1wu=1pm)

    // Temperatura de referencia en el simulador
    T_room:         298.15,          // K — mismo que SI, la temperatura es absoluta

});

// ─── Parámetros de Lennard-Jones por defecto ──────────────────────────────────
//
// Se usan cuando el elemento no tiene datos de polarizabilidad o radio VDW.
// Los valores reales se calculan en Forces.js usando los datos del elemento.

export const LJ_DEFAULTS = Object.freeze({
    sigma:      340,    // pm = wu — distancia equilibrio C-C tipica
    epsilon:    0.01,   // eV — sin cambio
    cutoff:     800,    // pm = wu — radio de corte ~8Å
});

// ─── Parámetros de Morse por defecto ─────────────────────────────────────────
//
// Potencial de Morse para enlaces covalentes en modo realista.
// Los valores reales se mapean desde reactivity.bond_energy_ev del elemento.

export const MORSE_DEFAULTS = Object.freeze({
    De:         0.05,   // eV — profundidad del pozo (calibrado para integrador sin dt)
    a:          0.025,  // pm⁻¹ = wu⁻¹ — rigidez del pozo
    a_rigid:    0.08,   // pm⁻¹ = wu⁻¹ — rigidez inicial al formar enlace
});

// ─── Parámetros de Pauli (repulsión) ─────────────────────────────────────────

export const PAULI_DEFAULTS = Object.freeze({
    strength:   0.5,    // Factor de escala
    factor:     1.6,    // Exponente de caída
});

// ─── Rangos válidos (para sliders y validación) ───────────────────────────────

export const RANGES = Object.freeze({
    temperature:    { min: 0,    max: 10000, default: 298.15 }, // K
    gravity:        { min: 0,    max: 1e-10, default: 0     }, // multiplicador sobre g_real
    lj_strength:    { min: 0,    max: 1,     default: 0.02   },
    lj_cutoff:      { min: 100,  max: 2000,  default: 800    }, // wu (pm)
    pauli_strength: { min: 0,    max: 2,     default: 0.5    },
    pauli_factor:   { min: 1,    max: 4,     default: 1.6    },
    friction:       { min: 0,    max: 1,     default: 0.82   },
    time_speed:     { min: 0.1,  max: 10,    default: 1.0    }, // multiplicador
    bond_stiffness: { min: 0,    max: 1,     default: 0.8    },
});
