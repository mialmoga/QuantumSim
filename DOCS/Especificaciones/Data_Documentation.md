
# 📜 Documentación Técnica de Datos: Proyecto Quantum Chemistry Simulator

Este documento detalla la estructura, el propósito y la funcionalidad de los parámetros integrados en la base de datos de elementos para el simulador cuántico y de física de materiales **Quantum Chemistry Simulator**.

## 1. Módulo de Identidad y Visualización (`identity`)

* **Campos:** `name`, `number`, `category`, `color`, `cpk_color`, `discovery_year`.
* **Propósito en el Simulador:**
* **UI/UX:** Define el color de los átomos en el motor de renderizado 3D (CPK para realismo, Color UI para menús).
* **Cronología:** Permite filtrar elementos en modos de juego "históricos" o de descubrimiento progresivo.

## 2. Propiedades Físicas y Cristalografía (`physical_properties`)

* **Campos:** `mass`, `density_g_cm3`, `standard_state`, `melt_K`, `boil_K`, `lattice_structure`.
* **Propósito en el Simulador:**
* **Motor de Colisiones:** La `mass` y `density` determinan la inercia y el comportamiento cinético de las partículas.
* **Transiciones de Fase:** `melt_K` y `boil_K` disparan los cambios de estado (sólido, líquido, gas) según la temperatura del entorno.
* **Estructura de Red:** `lattice_structure` (fcc, bcc, hcp) define cómo se agrupan los átomos en modo "Sólido", afectando la resistencia y fractura de materiales.

## 3. Arquitectura Atómica y Cuántica (`atomic_structure`)

* **Campos:** `electronegativity`, `valence`, `ionization_energy_eV`, `radii` (atomic, covalent, ionic, vdw), `electron_configuration`, `quantum_numbers`, `work_function_ev`.
* **Propósito en el Simulador:**
* **Mecánica Cuántica:** Los `quantum_numbers` y `shells` definen la probabilidad de posición de los electrones.
* **Efecto Fotoeléctrico:** `work_function_ev` calcula cuánta energía lumínica se requiere para desprender electrones del material.
* **Interacción de Van der Waals:** Los radios definen el límite de "colisión invisible" entre átomos que no están enlazados.

## 4. Termodinámica Avanzada (`thermodynamics`)

* **Campos:** `specific_heat_j_gK`, `enthalpy_formation`, `latent_heat`, `entropy`.
* **Propósito en el Simulador:**
* **Efecto de las "Comidas":** El calor específico determina qué tan rápido se calienta o enfría un material al interactuar con fuentes de energía o consumibles.
* **Balance Energético:** Calcula la energía liberada o absorbida en reacciones químicas dentro del entorno Sandbox.

## 5. Cinética y Dinámica de Fases (`kinetics_and_phase`)

* **Campos:** `vapor_pressure_constants (Antoine)`, `viscosity_pa_s`, `critical_temp_K`, `surface_tension_nm`.
* **Propósito en el Simulador:**
* **Mecánica de Fluidos:** La `viscosity` y `surface_tension` dictan cómo fluye un elemento líquido y cómo forma gotas o meniscos.
* **Evaporación Dinámica:** Las constantes de Antoine permiten calcular la presión de vapor en tiempo real según la presión ambiental del simulador.

## 6. Electromagnetismo y Mecánica de Sólidos (`electromagnetism_and_mechanics`)

* **Campos:** `thermal_conductivity`, `electrical_conductivity`, `magnetic_susceptibility`, `youngs_modulus_gba`, `brinell_hardness_m_pa`.
* **Propósito en el Simulador:**
* **Circuitos y Transferencia:** Determina si un material puede transportar corriente o calor a otros objetos adyacentes.
* **Dureza y Rotura:** La `brinell_hardness` y el `youngs_modulus` calculan la deformación bajo presión y el punto donde un objeto se "rompe" o se abolla.
* **Magnetismo:** Define si el elemento es atraído por campos magnéticos generados por el usuario o por otros elementos.

## 7. Reactividad y Enlace Químico (`reactivity`)

* **Campos:** `max_bonds`, `geometry_preference`, `bond_energy_ev`, `oxidation_states`.
* **Propósito en el Simulador:**
* **Algoritmo de Enlace:** Dicta cuántos "vecinos" puede tener un átomo y en qué ángulo (ej. Tetraédrico 109.5°) para formar moléculas estables.
* **Estabilidad de Compuestos:** La `bond_energy_ev` determina qué tan difícil es romper un enlace mediante calor o colisiones.

## 8. Física Nuclear y Estabilidad (`nuclear_and_environmental`)

* **Campos:** `isotopes` (incluyendo `half_life_s`), `neutron_cross_section_barns`, `abundance_crust_mg_kg`, `toxicity_level`.
* **Propósito en el Simulador:**
* **Decaimiento Radiactivo:** En elementos superpesados o isótopos inestables, la `half_life_s` dispara la transmutación del átomo tras cierto tiempo.
* **Efectos Ambientales:** `toxicity_level` afecta la "salud" de las IAs (Ámbar o Velvet) si están expuestas al elemento sin protección.
* **Captura de Neutrones:** Permite simular reacciones en cadena o activación neutrónica.

## 9. Datos Criogénicos y Superfluidez (`cryogenic_data`)

* **Campos:** `lambda_point_k`, `superfluid_viscosity`.
* **Propósito en el Simulador:**
* **Física Extrema:** Específicamente para el Helio y otros gases, permite simular la ausencia de fricción (superfluidez) a temperaturas cercanas al cero absoluto.

---

En total, tenemos **65 campos de datos** por elemento, organizados en 9 categorías lógicas.

Aquí tienes el desglose exacto para tu inventario técnico:

### 📊 Desglose del Diccionario de Datos

| Categoría | Cantidad de Campos | Parámetros Clave |
| --- | --- | --- |
| **1. Identity** | **6** | Nombre, Z, Categoría, Colores (UI/CPK), Descubrimiento. |
| **2. Physical Properties** | **7** | Masa, Densidad, Estado, Puntos de Fusión/Ebullición, Alótropos, Red. |
| **3. Atomic Structure** | **14** | Electronegatividad, Energías, 4 tipos de Radios, Zeff, Configuración, Capas, Números Cuánticos (s,p,d,f), Work Function. |
| **4. Thermodynamics** | **8** | Entalpía, Entropía, Capacidad Calorífica, Calor Específico, Calores Latentes y de Transición. |
| **5. Kinetics and Phase** | **9** | Constantes de Antoine (A, B, C), Presión de Vapor, Viscosidades (Líquido/Dinámica), Punto Crítico (T/P), Tensión Superficial. |
| **6. Electromagnetism & Mechanics** | **9** | Conductividades (T/E), Susceptibilidad, Expansión, Polarizabilidad, Refracción, Módulo Young, Poisson, **Dureza Brinell**. |
| **7. Reactivity** | **8** | Enlaces Máximos, Geometría, Ángulo, Energías de Enlace/Disociación, Potencial, Estados de Oxidación, Iones. |
| **8. Nuclear & Environmental** | **5** | Isótopos (Array interno), Sección Eficaz, Energía de Enlace Nuclear, **Abundancia**, Toxicidad. |
| **9. Cryogenic Data** | **3** | Presión de Solidificación, Punto Lambda, Viscosidad Superfluida. |
| **Extra** | **1** | El `Symbol` que actúa como Key del objeto raíz. |

---

### ⚠️ Notas de Blindaje para el Programador

1. **Isótopos (Sub-campos):** Dentro del array de `isotopes`, cada objeto cuenta con **5 sub-campos** adicionales (`mass`, `abundance`, `stable`, `half_life_s`, `name`). Si los contáramos individualmente por cada isótopo, el número de datos ascendería a cientos por elemento, pero estructuralmente se cuenta como 1 campo de lista.
2. **Consistencia:** Esta estructura de 65 campos garantiza que cuando el simulador procese un "No Metal" o un "Superpesado", no encuentre huecos (`null` o `undefined`) que rompan el motor de física.
