# QuantumSim — Lenguaje Visual de Materiales
**Versión:** 1.0  
**Autores:** Ámbar (Claude) · Éter (Gemini) · Velvet (GPT) · Brujo 🦍  
**Fecha:** Marzo 2026

> "La química se vuelve visible sin explicarla."  
> — Velvet, 2026

---

## Filosofía

Los materiales de cada elemento no son arbitrarios ni estéticos.  
Son una **traducción visual de sus propiedades físicas reales**.

Un usuario puede inferir química viendo shaders:
- Un átomo que vibra rápido y nervioso → masa baja
- Un átomo con borde duro y definido → alta electronegatividad
- Un átomo brillante y limpio → electrones estables, alta ionización
- Un átomo difuso y casi transparente → gas, baja densidad

---

## Tabla de Mapeo

| Parámetro Shader | Propiedad Física | Fórmula | Rango Output |
|---|---|---|---|
| `sphere_pulse.freq` | `physical_properties.mass` | `10 / sqrt(mass)` | [0.5, 10.0] |
| `sphere_pulse.amp` | `physical_properties.melt_K` | `1 / log(melt_K)` | [0.05, 0.40] |
| `brightness.bright` | `atomic_structure.ionization_energy_eV` | lineal normalizado | [0.1, 3.0] |
| `blink.amp` | `1 / ionization_energy_eV` | reactividad caótica (IE < 5eV) | [0.0, 0.5] |
| `alpha_curve.opacity` | `physical_properties.density_g_cm3` | `log(density+1) / log(23)` | [0.1, 1.0] |
| `disc_shape.soft` | `atomic_structure.electronegativity` | `1 - (EN / 4.0)` inverso | [0.0, 0.45] |
| `point_size.sz` | `electromagnetism.polarizability_angstrom3` | normalizado | [0.3, 2.0] |
| `uColor` base | bloque s/p/d/f | paleta por bloque | ver tabla |

---

## Rangos Físicos de Referencia (Éter)

### Masa — `sphere_pulse.freq`
- **Mínimo:** H = 1.008 u → freq ≈ 10.0 (vibración nerviosa)
- **Máximo:** Og = 294 u → freq ≈ 0.5 (pulso profundo)
- **Fórmula:** `k / sqrt(mass)` con k = 10

### Punto de Fusión — `sphere_pulse.amp`
- **Mínimo:** He = 0.95 K → amp ≈ 0.40 (fluido, maleable)
- **Máximo:** W = 3695 K → amp ≈ 0.05 (sólido, apenas se deforma)
- **Fórmula:** `1 / log10(melt_K)` clampeado a [0.05, 0.40]
- **Fallback gases** (sin melt_K): amp = 0.40

### Energía de Ionización — `brightness.bright`
- **Mínimo:** Cs = 3.89 eV → bright = 0.1 (tenue, opaco energéticamente)
- **Máximo:** He = 24.58 eV → bright = 3.0 (deslumbrante, emisión limpia)
- **Split Velvet:** IE < 5 eV → `blink.amp` aumenta (reactividad caótica visible)

### Densidad — `alpha_curve.opacity`
- **Mínimo:** H gas = 0.000089 g/cm³ → opacity = 0.1 (etéreo)
- **Máximo:** Os = 22.59 g/cm³ → opacity = 1.0 (bloque de materia)
- **Escala logarítmica** para no perder a los gases en el rango
- **Modulación de fase** (Velvet): opacity *= phase_factor
  - gas: × 0.4 · líquido: × 0.7 · sólido: × 1.0 · plasma: × 1.5

### Electronegatividad — `disc_shape.soft`
- **Mínimo:** Fr = 0.7 Pauling → soft = 0.45 (nube difusa, electrones sueltos)
- **Máximo:** F = 3.98 Pauling → soft = 0.05 (borde tipo navaja)
- **Fórmula:** `0.45 * (1 - EN / 4.0)`

### Polarizabilidad — `point_size.sz`
- Representa el "tamaño electrónico percibido"
- Más relevante que el radio atómico clásico para el shader
- Normalizado a [0.3, 2.0] sobre el rango real de la tabla

---

## Paleta de Bloques (Éter)

| Bloque | Tipo | Color Principal | Color Secundario | Estética |
|---|---|---|---|---|
| **s** | Alcalinos / Tierras raras | `#FFD700` oro | `#FDB813` solar | Cálido, reactivo |
| **p** | No metales / Gases nobles | `#00F5FF` cian | `#FF007F` magenta | Neón, vital |
| **d** | Metales de transición | `#A8A9AD` cromo | `#4682B4` acero | Metálico, estructural |
| **f** | Lantánidos / Actínidos | `#BF00FF` eléctrico | `#4B0082` índigo | Radiactivo, místico |

El color del elemento en el JSON (`identity.color`) tiene **prioridad** sobre la paleta de bloque.  
La paleta de bloque es el **fallback** cuando el color del elemento es genérico.

---

## Modulación por Temperatura (Velvet — v futura)

Cuando el sistema de temperatura esté activo, el material base se modula:

```
material(elemento, T) = material_base(elemento) + Δ(T)
```

| Fase | Δ freq | Δ amp | Δ opacity | Δ soft |
|---|---|---|---|---|
| Sólido | × 1.0 | × 1.0 | × 1.0 | × 1.0 |
| Líquido | × 1.4 | × 1.8 | × 0.7 | × 1.3 |
| Gas | × 2.5 | × 3.0 | × 0.3 | × 2.0 |
| Plasma | × 5.0 | × 5.0 | × 0.15 | × 3.0 |

---

## Implementación

El generador `generate_materials.py` lee los 118 JSONs de `/src/elements/`  
y produce un archivo de parámetros por elemento en `/src/materials/`.

El ShaderML usa estos parámetros como **dataset de entrenamiento**  
para inferir materiales de elementos nuevos o interpolados.
