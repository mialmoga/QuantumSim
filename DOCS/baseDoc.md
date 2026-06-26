{
  // --- IDENTIDAD ---
  "symbol": "Símbolo químico (Key única)",
  "identity": {
    "name": "Nombre en español",
    "number": "Número atómico",
    "category": "Familia química (transition_metal, noble_gas, etc.)",
    "color": "Color para UI del simulador",
    "cpk_color": "Color estándar de modelado molecular",
    "discovery_year": "Año de descubrimiento (negativo para A.C.)"
  },

  // --- FÍSICA Y CRISTALOGRAFÍA ---
  "physical_properties": {
    "mass": "Masa atómica (u)",
    "density_g_cm3": "Densidad (g/cm³)",
    "standard_state": "Estado a 25°C",
    "melt_K": "Punto de fusión (K)",
    "boil_K": "Punto de ebullición (K)",
    "allotropes": "Lista de formas alotrópicas",
    "lattice_structure": "Estructura de la red cristalina (ej. bcc, fcc, hcp)"
  },

  // --- ESTRUCTURA ATÓMICA ---
  "atomic_structure": {
    "electronegativity": "Escala de Pauling",
    "valence": "Valencia principal",
    "ionization_energy_eV": "1ra Energía de ionización (eV)",
    "electron_affinity_ev": "Afinidad electrónica (eV)",
    "electron_affinity_kj_mol": "Afinidad electrónica (kJ/mol)",
    "radius_atomic_pm": "Radio atómico (pm)",
    "radius_covalent_pm": "Radio covalente (pm)",
    "vanderwaals_radius_pm": "Radio de Van der Waals (pm)",
    "ionic_radius_pm": "Radio iónico (pm)",
    "effective_nuclear_charge": "Carga nuclear efectiva (Zeff)",
    "electron_configuration_string": "Configuración electrónica",
    "shells": "Electrones por capa (Array)",
    "quantum_numbers": { "s": "e- en orbital s", "p": "e- en orbital p", "d": "e- en orbital d", "f": "e- en orbital f" },
    "work_function_ev": "Función de trabajo (eV)"
  },

  // --- TERMODINÁMICA ---
  "thermodynamics": {
    "enthalpy_formation_kj_mol": "Entalpía de formación",
    "entropy_j_molk": "Entropía estándar",
    "heat_capacity_j_molk": "Capacidad calorífica molar",
    "specific_heat_j_gK": "Calor específico por gramo",
    "latent_heat_fusion_kj_mol": "Calor latente de fusión",
    "latent_heat_vaporization_kj_mol": "Calor latente de vaporización",
    "fusion_heat_kj_mol": "Calor de fusión (kJ/mol)",
    "evaporation_heat_kj_mol": "Calor de evaporación (kJ/mol)"
  },

  // --- FASES Y CINÉTICA ---
  "kinetics_and_phase": {
    "vapor_pressure_constants": { "A": "Antoin A", "B": "Antoin B", "C": "Antoin C" },
    "vapor_pressure_pa": "Presión de vapor (Pa)",
    "viscosity_liquid_pas": "Viscosidad líquida",
    "viscosity_pa_s": "Viscosidad dinámica",
    "critical_temp_K": "Temperatura crítica (K)",
    "critical_press_MPa": "Presión crítica (MPa)",
    "surface_tension_nm": "Tensión superficial (N/m)"
  },

  // --- ELECTROMAGNETISMO Y MECÁNICA ---
  "electromagnetism_and_mechanics": {
    "thermal_conductivity_wmk": "Conductividad térmica (W/m·K)",
    "electrical_conductivity_sm": "Conductividad eléctrica (S/m)",
    "magnetic_susceptibility": "Susceptibilidad magnética",
    "thermal_expansion_coefficient": "Coeficiente de expansión térmica (K⁻¹)",
    "polarizability_angstrom3": "Polarizabilidad (Å³)",
    "refractive_index": "Índice de refracción (n)",
    "youngs_modulus_gba": "Módulo de Young (GPa)",
    "poisson_ratio": "Relación de Poisson",
    "brinell_hardness_m_pa": "Dureza Brinell (MPa)"
  },

  // --- REACTIVIDAD ---
  "reactivity": {
    "max_bonds": "Capacidad máxima de enlaces",
    "geometry_preference": "Geometría molecular preferida",
    "ideal_bond_angle": "Ángulo ideal (°)",
    "bond_energy_ev": "Energía de enlace (eV)",
    "dissociation_energy_kj_mol": "Energía de disociación",
    "standard_potential_v": "Potencial estándar (V)",
    "oxidation_states": "Estados de oxidación (Array)",
    "common_ions": "Iones comunes (Array)"
  },

  // --- NUCLEAR Y AMBIENTAL ---
  "nuclear_and_environmental": {
    "isotopes": "Array de objetos {mass, abundance, stable, half_life_s, name}",
    "neutron_cross_section_barns": "Sección eficaz de neutrones (Barns)",
    "nuclear_binding_energy_mev": "Energía de enlace nuclear (MeV)",
    "abundance_crust_mg_kg": "Abundancia en la corteza terrestre (mg/kg)",
    "toxicity_level": "Nivel de toxicidad (Escala 1-5)"
  },

  // --- DATOS EXTREMOS (CRIOGENIA) ---
  "cryogenic_data": {
    "critical_solidification_pressure_mpa": "Presión de solidificación (Helio)",
    "lambda_point_k": "Punto de transición superfluida",
    "superfluid_viscosity_pas": "Viscosidad en estado superfluido"
  }
}
