# Informe: Strings hardcodeados vs. archivos de idioma (i18n)

**Fecha:** 2026-06-14
**Sistema i18n:** `src/data/i18n.js` (claves vía `t('clave.anidada')`, atributos `data-i18n`, `data-i18n-title`, `data-i18n-placeholder`)
**Archivos de idioma:** `src/i18n/es.json` (223 claves) / `src/i18n/en.json` (224 claves)

## Metodología

Se revisaron los archivos **no** `.js` / `.css` y fuera de las carpetas excluidas
(`components`, `data`, `Importante`, `lib`, `ShaderLab/shader_modules`,
`ShaderLab/exports`, `ShaderLab/assets`, `src/material_params`, `src/elements`,
`src/library`, `src/materials`, `src/materials_ml`, `src/orbital_cache`, `src/Bohr`):

- `index.html`
- `QuantumView.html`
- `ShaderLab/index.html`
- `site.webmanifest`

Para cada string visible en la UI se verificó si existe una clave equivalente en
`es.json` / `en.json`. Se marca el estado como:

- ❌ **Falta** — no existe clave equivalente, hay que crearla en ambos JSON y enlazarla con `data-i18n` / `t()`.
- ⚠️ **Existe similar** — hay una clave parecida pero el texto no coincide exactamente (abreviaturas, mayúsculas, separadores), conviene unificar.
- ✅ **Ya mapeado** — ya usa `data-i18n` y la clave existe correctamente.
- 🐞 **Bug de mapeo** — usa `data-i18n` pero apunta a una clave que no corresponde al texto.

---

## 0. Inconsistencia entre `es.json` y `en.json`

| Clave | es.json | en.json |
|---|---|---|
| `tooltips.tune_panel` | ❌ No existe | ✅ "Orbital panel" |

`en.json` tiene 224 claves y `es.json` 223. Falta agregar `tooltips.tune_panel` en `es.json` (valor sugerido: `"Panel de orbitales"`).

---

## 1. `index.html`

### 1.1 Header

| Texto hardcodeado | Ubicación | Clave propuesta | Estado |
|---|---|---|---|
| "Forzar recarga" (title) | `#forceReloadBtn` | `tooltips.force_reload` | ❌ Falta |
| "Diseño" | `.mode-toggle__label` (modo diseño) | `modes.design` | ❌ Falta (existe `modes.edit`="Edición" pero no coincide) |
| "Sim" | `.mode-toggle__label` (modo sim) | `modes.sim_short` | ⚠️ Existe similar (`modes.simulation`="Simulación", pero aquí es abreviado) |
| "Modo: seleccionar átomos" (title) | `#modeAtom` | `tooltips.mode_atoms` | ❌ Falta |
| "Modo: seleccionar moléculas" (title) | `#modeMolecule` | `tooltips.mode_molecules` | ❌ Falta |
| "Enlaces" (title) | `.hstat` | `stats.bonds` | ⚠️ Existe similar (`stats.bonds`="Enlaces", solo falta usarla como `data-i18n-title`) |
| "Configuración" (title) | `#settingsBtn` | `panels.settings` | ⚠️ Existe similar (`panels.settings`="Configuración", falta enlazar) |
| "Modo Raw — shader sin bloom" (title) | `#rawModeBtn` | `tooltips.raw_mode` | ❌ Falta |
| "Raw Mode" | `#rawModeBtn` span | `settings.raw_mode` | ❌ Falta |
| "Sonido atómico" (title) | `#soundBtn` | `tooltips.sound` | ❌ Falta |
| "Audio" | `#soundBtn` span | `settings.audio` | ❌ Falta |
| "Filtro óptico — atenuar brillo" (title) | `#visorBtn` | `tooltips.visor` | ❌ Falta |
| "Visor" | `#visorBtn` span | `settings.visor` | ❌ Falta |
| "Control gestual — webcam" (title) | `#gestureBtn` | `tooltips.gestures` | ❌ Falta |
| "Gestos" | `#gestureBtn` span | `settings.gestures` | ❌ Falta |
| "LOD Orbitales — renderizar orbitales en escena (desactivar = solo esfera)" (title) | `#lodBtn` | `tooltips.lod_orbitals` | ❌ Falta |
| "LOD Orbitales" | `#lodBtn` span | `settings.lod_orbitals` | ❌ Falta |
| "Pantalla completa" (title) | `#fullscreenBtn` | `tooltips.fullscreen` | ❌ Falta (se repite también en QuantumView.html y ShaderLab) |
| "Mostrar paneles" (title) | `#ui-restore-btn` | `tooltips.show_panels` | ❌ Falta |
| "Tap para agregar · Arrastra para rotar · Pinch para zoom" | `#canvasHint` | `app.canvas_hint` | ❌ Falta |

### 1.2 Panel izquierdo — Tabs

| Texto hardcodeado | Ubicación | Clave propuesta | Estado |
|---|---|---|---|
| "⚛️ Física" | `.sptab[data-tab="physics"]` | `panels.physics` | ⚠️ Existe similar ("Física" sin emoji) |
| "📐 Geo" | `.sptab[data-tab="geometry"]` | `panels.geometry_short` | ❌ Falta |
| "🧪 Lab" | `.sptab[data-tab="lab"]` | `panels.lab_short` | ⚠️ Existe similar (`lab.title`="Laboratorio de Física", aquí abreviado) |
| "🌡️ Temp" | `.sptab[data-tab="temperature"]` | `panels.temperature_short` | ⚠️ Existe similar (`panels.temperature`="Temperatura", aquí abreviado) |

### 1.3 Tab Física

| Texto hardcodeado | Clave propuesta | Estado |
|---|---|---|
| "🌍 Gravedad" | `physics.gravity` | ⚠️ Existe similar (sin emoji: "Gravedad") |
| "A escala atómica la gravedad es imperceptible — usa el multiplicador del Lab para exagerarla" | `physics.gravity_hint` | ❌ Falta |
| "⚛️ Repulsión Atómica" | `physics.atomic_repulsion` | ⚠️ Existe similar (sin emoji) |
| "Evita colapso de estructuras" | `physics.atomic_repulsion_hint` | ❌ Falta |
| "🎨 Colores CPK" | `physics.cpk_colors` | ⚠️ Existe similar (sin emoji) |
| "Estándar internacional de colores" | `physics.cpk_colors_hint` | ❌ Falta |
| "🔗 Mostrar Enlaces" | `physics.show_bonds` | ⚠️ Existe similar ("Mostrar enlaces", sin emoji) |
| "Oculta cilindros y electrones de enlace" | `physics.show_bonds_hint` | ❌ Falta |
| "📐 Ángulos de Enlace" | `physics.bond_angles` | ⚠️ Existe similar ("Ángulos de enlace", sin emoji) |
| "Geometría molecular realista (H₂O bent, CH₄ tetrahedral)" | `physics.bond_angles_hint` | ❌ Falta |
| "🌊 Fuerzas Van der Waals" | `physics.lj_toggle` | ⚠️ Existe similar (sin emoji) |
| "Lennard-Jones potential" | `physics.lj_hint` | ❌ Falta |
| "⚛️ Modo de Física" (section title) | `physics.mode_section` | ❌ Falta |
| "⚗️ Afinidad Estricta" | `physics.strict_bonding` | ❌ Falta |
| "H, F, Cl, Br, I respetan su valencia máxima" | `physics.strict_bonding_hint` | ❌ Falta |
| "🔬 Modo Realista" | `physics.realistic_mode` | ⚠️ Existe similar (sin emoji) |
| "OFF: Pedagógico (enlaces discretos)<br>ON: Realista (campos continuos)" | `physics.realistic_mode_hint` | ❌ Falta |
| "☁️ Nubes electrónicas" | `physics.electron_clouds` | ❌ Falta |
| "⚛️ Mostrar todos los e⁻" | `physics.show_all_electrons` | ❌ Falta |

### 1.4 Tab Geometría

| Texto hardcodeado | Clave propuesta | Estado |
|---|---|---|
| "🏠 Techo" (section title) | `geometry.ceiling_section` | ❌ Falta |
| "Techo (física)" | `geometry.ceiling_physics` | ❌ Falta |
| "👁 Visible" (×3: techo, piso, esfera) | `geometry.visible_btn` | ❌ Falta |
| "Opacidad" (×3) | `geometry.opacity` | ❌ Falta |
| "Brillo" (×2, techo/piso) | `geometry.brightness` | ⚠️ Existe similar (`quantum.brightness`="Brillo", otro namespace) |
| "Rebote" (×3) | `geometry.bounce` | ⚠️ Existe similar (`physics.bounce`="Rebote") |
| "Altura" | `geometry.height` | ❌ Falta |
| "Curvatura" (×2) | `geometry.curvature` | ❌ Falta |
| "← cóncavo \| plano \| convexo (cúpula) →" | `geometry.curvature_hint_ceiling` | ❌ Falta |
| "🌍 Piso" (section title) | `geometry.floor_section` | ❌ Falta |
| "Piso (física)" | `geometry.floor_physics` | ❌ Falta |
| "← cóncavo (bowl) \| plano \| convexo (dome) →" | `geometry.curvature_hint_floor` | ❌ Falta |
| "🔮 Esfera recipiente" (section title) | `geometry.sphere_section` | ❌ Falta |
| "Esfera (física)" | `geometry.sphere_physics` | ❌ Falta |
| "Centro Y" | `geometry.sphere_center_y` | ❌ Falta |
| "Radio" | `geometry.sphere_radius` | ❌ Falta |
| "🌡️ Polos térmicos" (section title) | `geometry.thermal_poles_section` | ❌ Falta |
| "🔴 Polo Sur" | `geometry.pole_south` | ❌ Falta |
| "🔵 Polo Norte" | `geometry.pole_north` | ❌ Falta |
| "Gradiente vertical: calor abajo ↔ frío arriba" | `geometry.thermal_gradient_hint` | ❌ Falta |

### 1.5 Tab Laboratorio

| Texto hardcodeado | Clave propuesta | Estado |
|---|---|---|
| "⚠️ Valores por defecto = física real<br>Experimenta bajo tu propio riesgo" | `lab.warning` + `lab.caution` | ⚠️ Existen claves separadas (`lab.warning`="Valores por defecto = física real", `lab.caution`="Experimenta bajo tu propio riesgo") pero el HTML las hardcodea juntas en un solo `<p>` |
| "🌍 Gravedad" | `lab.gravity` | ⚠️ Existe similar (sin emoji) |
| "⚛️ Pauli Strength" | `lab.pauli_strength` | ⚠️ Existe similar (sin emoji) |
| "⚛️ Pauli Factor" | `lab.pauli_factor` | ⚠️ Existe similar (sin emoji) |
| "💨 Fricción" | `lab.friction` | ⚠️ Existe similar (sin emoji) |
| "🚀 Vel. Terminal" | `lab.terminal_velocity_short` | ⚠️ Existe similar (`lab.terminal_velocity`="Velocidad Terminal", aquí abreviado) |
| "🔗 Spring Enlace" | `lab.bond_spring_short` | ⚠️ Existe similar (`lab.bond_spring`="Spring de Enlaces") |
| "📐 Fuerza Ángulos" | `lab.angle_force` | ⚠️ Existe similar (sin emoji, coincide texto) |
| "🌊 Lennard-Jones" | `lab.lennard_jones` | ⚠️ Existe similar (sin emoji) |
| "🌡️ Rango Irrad." | `lab.radiation_range_short` | ⚠️ Existe similar (`lab.radiation_range`="Rango Irradiación") |
| "🔥 Int. Irrad." | `lab.radiation_intensity_short` | ⚠️ Existe similar (`lab.radiation_intensity`="Intensidad Irradiación") |
| "🔄 Reset" | `lab.reset` | ⚠️ Existe similar (sin emoji) |
| "🎲 Random" | `lab.random` | ⚠️ Existe similar (sin emoji) |

### 1.6 Tab Temperatura

| Texto hardcodeado | Clave propuesta | Estado |
|---|---|---|
| "Modo:" | `temperature.mode_label` | ❌ Falta |
| "🎓 Didáctico" | `temperature.mode_didactic` | ⚠️ Existe similar (sin emoji) |
| "⚗️ Realista" | `temperature.mode_realistic` | ⚠️ Existe similar (sin emoji) |
| "Escala pedagógica — valores inventados para visibilidad." (`#tempModeDesc`) | `temperature.mode_didactic_desc` | ⚠️ Existe similar (versión completa es "...Ideal para clase.") |
| "Activar sistema de temperatura" | `temperature.activate` | ✅ Coincide exacto, falta enlazar |
| "🌍 Temperatura Ambiental" (section title) | `temperature.ambient_section` | ⚠️ Existe similar (`temperature.ambient`="Temperatura ambiental", sin emoji) |
| "🌡️ Objetivo" | `temperature.target_short` | ⚠️ Existe similar (`temperature.target`="Temperatura objetivo") |
| "T actual:" | `temperature.current` | ⚠️ Existe similar ("T actual", sin ":") |
| "Fase:" | `temperature.phase` | ⚠️ Existe similar ("Fase", sin ":") |
| "🎨 Color de ambiente por temperatura" | `temperature.color_by_temp` | ⚠️ Existe similar (sin emoji) |
| "azul = frío · naranja = caliente · ámbar = plasma" | `temperature.color_by_temp_desc` | ⚠️ Existe similar (versión JSON usa "•" y prefijo "Cambia el fondo —") |
| "🔥 Ruptura de enlaces por calor" | `temperature.bond_rupture` | ⚠️ Existe similar (sin emoji) |
| "⚛️ Disociación Térmica (Boltzmann)" | `temperature.thermal_dissociation` | ❌ Falta |
| "⚗️ Metátesis (A-B + C-D → A-C + B-D)" | `temperature.metathesis` | ❌ Falta |
| "⏱️ Vel. termostato" | `temperature.thermostat_speed_short` | ⚠️ Existe similar (`temperature.thermostat_speed`="Velocidad del termostato") |
| "Bajo = brusco · Alto = gradual y suave" | `temperature.thermostat_desc` | ⚠️ Existe similar (JSON usa "•") |
| "🔥 Temperatura del Suelo" (section title) | `temperature.floor_temp_section` | ⚠️ Existe similar (sin emoji, coincide texto) |
| "Irradiar calor desde el suelo" | `temperature.floor_temp_toggle` | ❌ Falta |
| "T suelo" | `temperature.floor_temp_short` | ❌ Falta |
| "❄️ Temperatura del Techo" (section title) | `temperature.ceiling_temp_section` | ⚠️ Existe similar (sin emoji, coincide texto) |
| "Irradiar calor desde el techo" | `temperature.ceiling_temp_toggle` | ❌ Falta |
| "T techo" | `temperature.ceiling_temp_short` | ❌ Falta |
| "Enfría o calienta átomos por proximidad" | `temperature.ceiling_temp_desc` | ⚠️ Existe similar (JSON dice "...por contacto y proximidad", falta "contacto y") |
| "🌐 Temperatura de la Esfera" (section title) | `temperature.sphere_temp_section` | ❌ Falta |
| "Irradiar calor desde la esfera" | `temperature.sphere_temp_toggle` | ❌ Falta |

### 1.7 Panel derecho (Quantum View / selección de átomo)

| Texto hardcodeado | Clave propuesta | Estado |
|---|---|---|
| "Sin selección" | `quantum.no_selection` | ⚠️ Existe similar (`messages.no_selection`="Nada seleccionado", contexto distinto) |
| "Selecciona un átomo<br>para ver su configuración" | `quantum.select_atom_hint` | ❌ Falta |
| "Subshells" | `quantum.subshells` | ❌ Falta |
| "Capas" | `quantum.layers` | ✅ Coincide exacto, falta enlazar |
| "Material" | `quantum.material_section` | ⚠️ Existe similar (JSON="Material · todos") |
| "Brillo" | `quantum.brightness` | ✅ Coincide exacto, falta enlazar |
| "Tamaño pt" | `quantum.pt_size_short` | ⚠️ Existe similar (`quantum.pt_size`="Tamaño punto") |
| "🎨 Materiales" | `quantum.materials_btn` | ❌ Falta |
| "📂 Cargar" | `library.load` | ⚠️ Existe similar ("Cargar", sin emoji) |
| "💾 Guardar" | `console.save` | ⚠️ Existe similar (`console.save`="Guardar", otro contexto) |

### 1.8 Bottom sheets — Selector de elementos / Panel Agregar

| Texto hardcodeado | Clave propuesta | Estado |
|---|---|---|
| "Buscar…" (placeholder `#elementSearch`) | `elements.search` | ⚠️ Existe similar (`elements.search`="Buscar elemento...", texto distinto) |
| "➕ Agregar" (`h4.bs-title`) | `add.title` | ⚠️ Existe similar (sin emoji) |
| "⚗️ Moléculas" | `add.molecules` | ⚠️ Existe similar (sin emoji) |
| "💎 Cristales" | `add.crystals` | ⚠️ Existe similar (sin emoji) |
| "❄️ Copo" | `add.snowflake` | ⚠️ Existe similar (sin emoji) |
| "🧂 NaCl" | `add.crystal_nacl` | ❌ Falta |
| "🔩 Hierro" | `add.crystal_iron` | ❌ Falta |
| "💎 Diamante" | `add.crystal_diamond` | ❌ Falta |
| "❄️ Hielo" | `add.crystal_ice` | ❌ Falta |
| "Tamaño" (slider cristal) | `add.crystal_size` | ❌ Falta |
| "Congelar estructura" | `add.freeze_structure` | ❌ Falta |
| "Complejidad" (copo) | `add.snowflake_complexity` | ❌ Falta |
| "Humedad" | `add.snowflake_humidity` | ❌ Falta |
| "Variedad ADN" | `add.snowflake_variety` | ❌ Falta |
| "❄️ Generar" | `add.snowflake_generate` | ❌ Falta |
| "💾 Guardar" | `console.save` | ⚠️ Existe similar |
| "✨ Azul Plata" | `add.snowflake_silverblue` | ❌ Falta |
| "📂 Cargar" | `library.load` | ⚠️ Existe similar |

### 1.9 Consola del motor

| Texto hardcodeado | Clave propuesta | Estado |
|---|---|---|
| "⌨️ Consola" | `console.title` | ⚠️ Existe similar (sin emoji) |
| "Limpiar" (title `#consoleClear`) | `console.clear` | ⚠️ Existe similar (`console.clear`="Limpiar consola") |
| "QSim.world.addAtom('Fe') · Tab para completar" (placeholder) | `console.input_placeholder` | ❌ Falta |
| "Run" | `console.run` | ❌ Falta |

### 1.10 Dock / barras colapsables

| Texto hardcodeado | Clave propuesta | Estado |
|---|---|---|
| "Física" (`#dockPhysics`) | `panels.physics` | ✅ Coincide exacto, falta enlazar |
| "ShaderLab" (`#dockShaderLab`) | — | ✅ No requiere traducción (nombre propio) |
| "Quantum" (`#dockQuantumView`) | — | ✅ No requiere traducción (nombre propio) |
| "Agregar" (`#dockAdd`) | `add.title` | ✅ Coincide exacto, falta enlazar |
| "◀ Grupos" (`#collapseGroups`) | `panels.groups` | ⚠️ Existe similar ("Grupos", sin flecha) |

### 1.11 Loading modal

| Texto hardcodeado | Clave propuesta | Estado |
|---|---|---|
| "Quantum Chemistry Simulator" (`.loading-modal__title`) | `app.title` | ✅ Coincide exacto, falta enlazar |
| "Iniciando..." (`#loadingStatus`) | `app.starting` | ⚠️ Existe similar (`app.loading`="Cargando...", texto distinto) |
| "Idioma" (`aria-label` config-pills) | `settings.language` | ✅ Coincide exacto, falta enlazar |
| "Iniciar simulador" (`aria-label` `#launchBtn`) | `session.continue` | ⚠️ Existe similar (`session.continue`="Continuar"/"Iniciar", texto del botón visible ya usa `data-i18n="session.continue"` pero el `aria-label` queda hardcodeado en español) |

### 1.12 Nuclear Tuner Panel

| Texto hardcodeado | Clave propuesta | Estado |
|---|---|---|
| "☢ Nuclear Tuner" | `nuclear.title` | ❌ Falta |
| "Omega" | `nuclear.omega` | ❌ Falta |
| "Confinement" | `nuclear.confinement` | ❌ Falta |
| "Densidad" | `nuclear.density` | ❌ Falta |
| "Threshold" | `nuclear.threshold` | ❌ Falta |
| "Gradiente" | `nuclear.gradient` | ❌ Falta |
| "Iridiscencia" | `nuclear.iridescence` | ❌ Falta |
| "Pulso" | `nuclear.pulse` | ❌ Falta |
| "📋 Copiar JSON" | `nuclear.copy_json` | ❌ Falta |
| "Reset" | `lab.reset` | ⚠️ Existe similar |
| "📂 Editar JSON" | `nuclear.edit_json` | ❌ Falta |
| "Aplicar" | `nuclear.apply` | ❌ Falta |
| "✅ Copiado" (texto temporal JS) | `nuclear.copied` | ❌ Falta |
| "JSON inválido" (alert JS) | `nuclear.invalid_json` | ❌ Falta |

---

## 2. `QuantumView.html`

| Texto hardcodeado | Ubicación | Clave propuesta | Estado |
|---|---|---|---|
| "Quantum View" (`<title>` y `#qv-title`) | header | — | ✅ No requiere traducción (nombre propio) |
| "← SIM" (`#qv-back`) | header | `quantum.back_short` | ❌ Falta (el `title` ya usa `data-i18n-title="tooltips.back"` ✅, pero el texto visible "← SIM" está hardcodeado) |
| "Pantalla completa" (title `#qv-fullscreen-btn`) | header | `tooltips.fullscreen` | ❌ Falta (mismo caso que index.html) |
| "Vel. parpadeo" (`.tlabel` slider `sl-speed`) | tune-panel | `quantum.blink_speed` | ❌ Falta (sin `data-i18n`) |
| "Amp. parpadeo" (`.tlabel` slider `sl-amp`) | tune-panel | `quantum.blink_amplitude` | ❌ Falta (sin `data-i18n`) |
| "Borde" (`.tlabel` slider `sl-edge`) | tune-panel | `quantum.edge` | 🐞 **Bug de mapeo**: usa `data-i18n="quantum.brightness"` (="Brillo"), pero el texto visible es "Borde" — clave incorrecta, debería ser una nueva `quantum.edge` |
| "⚗ Materiales" (`#btn-materials`) | tune-panel | `quantum.materials_btn` | ❌ Falta |
| "💾 Guardar perfil" (`#btn-save-profile`) | tune-panel | `quantum.save_profile` | ❌ Falta |
| "Colapsar panel" (title `#qv-collapse-btn`) | selector | `tooltips.collapse_panel` | ❌ Falta |
| "Todos" (`data-i18n="quantum.all_groups"`) | filtro grupos | `quantum.all_groups` | ⚠️ Existe similar (JSON="Todos los grupos", texto visible "Todos") |
| "No metales" / "Gas noble" / "Alcalino" / "Alcalinot." / "Transición" / "Metaloide" / "Halógeno" / "Lantánido" / "Actínido" (botones `.grp-btn`) | filtro grupos | `groups.*` | ⚠️ Ya usan `data-i18n="groups.*"`, pero el texto hardcodeado visible no coincide con el valor del JSON (singular/abreviado vs. plural completo en JSON, p.ej. "Gas noble" vs. "Gases Nobles", "Alcalino" vs. "Metales Alcalinos") — al cambiar de idioma el texto cambiará a la versión completa del JSON, lo cual genera inconsistencia incluso en español |
| "⚗ Materiales" (header modal) | mat-modal | `quantum.materials_btn` | ❌ Falta |
| "Átomo · Esfera LOD" (section title) | mat-modal | `quantum.mat_sphere_section` | ❌ Falta |
| "Core · Orbitales internos" | mat-modal | `quantum.mat_core_section` | ❌ Falta |
| "Semi · Orbitales medios" | mat-modal | `quantum.mat_semi_section` | ❌ Falta |
| "Valencia · Orbitales externos" | mat-modal | `quantum.mat_valence_section` | ❌ Falta |
| "— Sin material —" (×4, `<option>`) | mat-modal | `quantum.no_material` | ❌ Falta |

---

## 3. `ShaderLab/index.html`

Este módulo **no tiene integración i18n** (sin `data-i18n`, `lang="es"` fijo). Si se quiere extender la i18n a ShaderLab, los strings principales a externalizar serían:

| Texto hardcodeado | Clave propuesta | Estado |
|---|---|---|
| "Modo Dev" (title `#btnDevMode`) | `shaderlab.dev_mode` | ❌ Falta |
| "Esfera" (`.tgt-btn[data-tgt="sphere"]`) | `shaderlab.target_sphere` | ❌ Falta |
| "📂 Cargar" / "💾 Guardar" (`#btnLoad` / `#btnSave`) | `library.load` / `console.save` | ⚠️ Existen similares en otro namespace |
| "Pantalla completa" (title) | `tooltips.fullscreen` | ❌ Falta |
| "＋ Nodo" / "↺ Reset" (`#btnAdd` / `#btnReset`) | `shaderlab.add_node` / `lab.reset` | ❌ Falta / ⚠️ Existe similar |
| "Todo" / "Core" / "Semi" / "Valencia" (`.layer-btn`) | `shaderlab.layer_*` | ❌ Falta (Core/Semi son técnicos, "Todo" y "Valencia" sí traducibles) |
| "Presets" / "💾 = en caché · descarga para no perder" | `shaderlab.presets_title` / `shaderlab.presets_hint` | ❌ Falta |
| "Parámetros" (`#paramsTitle`) | `shaderlab.params_title` | ❌ Falta |
| "Selecciona un nodo para editar sus parámetros" | `shaderlab.select_node_hint` | ❌ Falta |
| "Materiales built-in" | `shaderlab.builtin_materials` | ❌ Falta |
| "Selecciona un material" / "Selecciona un material de la lista" | `shaderlab.select_material_hint` | ❌ Falta |
| "Editor" (`#devEditorTitle`) | `shaderlab.editor_title` | ❌ Falta |
| "Todos" (`#devChkAll` label) | `quantum.all_groups` / nueva | ⚠️ Existe similar |
| "＋ Añadir nodo al pipeline" (modal title) | `shaderlab.add_node_modal_title` | ❌ Falta |
| "Todos" / "Vertex" / "Fragment" (`.mf-btn`) | `shaderlab.filter_*` | ❌ Falta |

---

## 4. `site.webmanifest`

| Texto hardcodeado | Campo | Clave propuesta | Estado |
|---|---|---|---|
| "Simulador de química cuántica 3D interactivo" | `description` | — | ⚠️ Es metadata estática de PWA (no pasa por `i18n.js`); si se quiere localizar requeriría manifiestos separados por idioma (`site.es.webmanifest` / `site.en.webmanifest`) o generación dinámica del manifest |

---

## 5. Resumen de prioridades

1. **Bug de mapeo en QuantumView.html** (`data-i18n="quantum.brightness"` en el slider "Borde") — corregir cuanto antes, ya que rompe la traducción de ese control.
2. **Clave faltante entre idiomas**: agregar `tooltips.tune_panel` a `es.json`.
3. **Botones/labels con emoji y abreviaturas** en `index.html` (tabs, sliders del Lab, secciones de Temperatura/Geometría): la mayoría tiene una clave "hermana" en los JSON pero con texto sin emoji o sin abreviar — definir convención (¿el emoji va en el HTML y solo el texto en i18n, o el emoji forma parte de la clave?) antes de masificar el reemplazo.
4. **Paneles sin ninguna cobertura i18n**: pestaña Geometría completa, Panel Agregar (cristales/copo), Nuclear Tuner Panel, y todo `ShaderLab/index.html`.
5. **Filtros de grupo en QuantumView.html**: el texto hardcodeado (abreviado) no coincide con el valor real de `groups.*` en los JSON — unificar para evitar que el cambio de idioma "salte" a un texto más largo que en español.

---

## 6. Strings hardcodeados en archivos `.js`

Revisión de los archivos `.js` (excluyendo las mismas carpetas indicadas en la metodología). El patrón dominante: **paneles construidos dinámicamente vía `innerHTML`/`textContent`** (capas orbitales, grupos, materiales, perfiles) **bypassean por completo el sistema `t()`/`data-i18n`**, incluso cuando el HTML que los contiene sí está parcialmente traducido. También hay varios `alert()`/`title`/mensajes de estado con texto fijo en español (y alguno en inglés mezclado).

### 6.1 `src/renderer/LayerPanel.js` (panel de capas — compartido por `index.html` y `QuantumView.html`)

| Texto hardcodeado | Ubicación | Clave propuesta | Estado |
|---|---|---|---|
| "Todo" (línea 170, fila "Todo") | `lyr-all` | `quantum.layer_all` | ❌ Falta |
| "Esfera LOD" (línea 182) | fila esfera | `quantum.sphere_lod` | ❌ Falta |
| "Núcleo" (línea 191, vía `makeSingleRow`) | fila núcleo | `quantum.nucleus_label` | ❌ Falta |
| "Tune individual" (línea 74, title — en inglés dentro de UI en español) | botón `.orb-expand-btn` | `tooltips.tune_individual` | ❌ Falta |
| "Brillo" (línea 78) | slider tune | `quantum.brightness` | ⚠️ Existe similar (el texto coincide con `quantum.brightness`="Brillo"/"Brightness" pero está hardcodeado, no usa `t()`) |
| "Tamaño" (línea 83) | slider tune | `quantum.pt_size` | ⚠️ Existe similar (JSON="Tamaño punto", aquí abreviado a "Tamaño") |
| "Vel." (línea 88) | slider tune | `quantum.speed` (nueva) | ❌ Falta |
| `layerLabel()` — mapa `{ valence:'Valencia', semi:'Semi', core:'Core', inner:'Internas', nucleus:'Núcleo' }` (líneas 37, usado en línea 205 como `lyr-group-label`) | encabezados de grupo de capas | `quantum.layer_valence` / `quantum.layer_semi` / `quantum.layer_core` / `quantum.layer_inner` / `quantum.nucleus_label` | ❌ Falta (Core/Semi son términos técnicos, valorar si traducir) |
| `` `Capa ${n}` `` (línea 39, para `shell_N`) | encabezados de grupo | `quantum.layer_shell` con variable `{n}` (p.ej. "Capa {n}" / "Shell {n}") | ❌ Falta |

Este panel se reutiliza en **dos sitios** (panel derecho de `index.html` y tune-panel de `QuantumView.html`), así que una sola corrección aquí cubre ambos.

### 6.2 `js/quantum-view.js` (implementación standalone — duplica el panel de capas y agrega selector/materiales)

| Texto hardcodeado | Ubicación | Clave propuesta | Estado |
|---|---|---|---|
| "Todo" (línea 338) | fila "Todo" del panel de capas | `quantum.layer_all` | ❌ Falta — duplica el mismo problema de 6.1 en una segunda implementación |
| "Esfera LOD" (línea 349) | fila esfera | `quantum.sphere_lod` | ❌ Falta |
| "Núcleo" (línea 382, vía `makeSingleRow`) | fila núcleo | `quantum.nucleus_label` | ❌ Falta |
| "Tune individual" (línea 483, title en inglés) | botón `.orb-expand-btn` | `tooltips.tune_individual` | ❌ Falta |
| "Brillo" / "Tamaño" / "Vel." (líneas 487, 492, 497) | sliders tune | igual que 6.1 | ⚠️ / ⚠️ / ❌ |
| "Color shader (default)" / "Color elemento" / "Color CPK" (líneas 369, 372, 375 — title del botón de color de esfera, mezcla ES/EN) | `#btn-sphere-cpk` | `quantum.color_mode_shader` / `quantum.color_mode_element` / `quantum.color_mode_cpk` | ❌ Falta |
| 'Carga un elemento primero' (línea 147, `alert()`) | botón guardar perfil | `messages.load_element_first` (nueva) | ❌ Falta |
| "✓ Guardado" / "💾 Guardar perfil" (líneas 185-186) | botón guardar perfil | `quantum.save_profile` / `quantum.profile_saved` | ❌ Falta |
| 'Error al cargar el archivo: ' (línea 301, `alert()`) | input de preset de material | `messages.file_load_error` | ⚠️ Existe similar (`messages.file_error`="Error al cargar archivo", aquí con texto y puntuación distintos y concatena `e.message`) |
| `` `El preset "${preset.name ?? '?'}" no tiene shaders compilados` `` (línea 309, `alert()`) | aplicar preset de material | `quantum.preset_no_shaders` (nueva, con variable) | ❌ Falta |
| "Pantalla completa" / "Salir de pantalla completa" (línea 630-631, `title`) | botón fullscreen | `tooltips.fullscreen` / `tooltips.fullscreen_exit` | ❌ Falta (mismo texto ya señalado como faltante en `ShaderLab/index.html`, sección 3) |
| `el.name_es` usado siempre para el nombre del elemento en el grid del selector (línea 568), sin importar `lang` | grid de elementos | — | ⚠️ Bug de i18n: el nombre del elemento no respeta el idioma activo (debería usar `name_eng` si `lang==='en'`, como ya hace `ElementSelector.js`) |

### 6.3 `app.js`

| Texto hardcodeado | Ubicación | Clave propuesta | Estado |
|---|---|---|---|
| "Ver / Quantum View" (línea 681, `tab.title`, mezcla ES/EN) | pestaña flotante QV | `tooltips.quantum_view` (nueva) | ❌ Falta |
| "Colocando **${symbol}** — usa el joystick para posicionar" (línea 364) | barra de colocación "ghost" | `messages.placing_atom` (nueva, con variable `{symbol}`) | ❌ Falta |
| "✓ Confirmar" (línea 368) | botón `#ghost-confirm` | `controls.confirm` (nueva) | ❌ Falta |
| "✕ Cancelar" (línea 372) | botón `#ghost-cancel` | `controls.cancel` (nueva) | ❌ Falta |
| "⎘ copiar" / "✓" (líneas 845, 850) | botón copiar consola | `console.copy` | ⚠️ Existe similar (`console.copy`="Copiar", aquí en minúscula con ícono y sin usar `t()`) |
| 'El perfil no tiene elemento asociado' (línea 1088, `alert()`) | carga de perfil QV | `messages.profile_no_element` (nueva) | ❌ Falta |
| "✓ Cargado" / "📂 Cargar" (línea 1095) | botón cargar perfil | `quantum.load_profile` / `quantum.profile_loaded` (nuevas) | ❌ Falta |
| 'Error al leer perfil: ' (línea 1096, `alert()`) | carga de perfil QV | `messages.profile_read_error` (nueva, con `err.message`) | ❌ Falta |

### 6.4 `src/ui/GroupPanel.js`

| Texto hardcodeado | Ubicación | Clave propuesta | Estado |
|---|---|---|---|
| "Grupos" (línea 91, `data-i18n="groups.title"`) | header del panel | `groups.title` | ✅ Ya mapeado (correcto aunque se inyecta vía `innerHTML`, no es un `<html>` estático) |
| "Todo" (línea 93, botón `#gpAll`) | acciones del header | `quantum.layer_all` (reutilizar la misma propuesta de 6.1) o `controls.select_all` | ❌ Falta |
| "Ninguno" (línea 94, botón `#gpNone`) | acciones del header | `controls.deselect` | ⚠️ Existe similar (`controls.deselect`="Deseleccionar" — semántica equivalente pero texto distinto; valorar si conviene unificar o crear `groups.none`) |

### 6.5 `src/ui/PhysicsPanel.js`

| Texto hardcodeado | Ubicación | Clave propuesta | Estado |
|---|---|---|---|
| "Escala pedagógica — valores inventados para visibilidad." (handler de `tempModeDidactic`, `#tempModeDesc.textContent`) | toggle modo Didáctico | `temperature.mode_didactic_desc` | ⚠️ Existe similar — el JSON tiene "...para visibilidad. **Ideal para clase.**" y este texto hardcodeado omite esa frase final; al hacer clic se sobreescribe el texto inicial (correcto, con `data-i18n`) por esta versión truncada y sin traducir |
| "Escala SI — temperatura real en Kelvin." (handler de `tempModeRealistic`, `#tempModeDesc.textContent`) | toggle modo Realista | `temperature.mode_realistic_desc` | 🐞 Bug de mapeo / contenido — el JSON dice "Física real. kB = 1.38×10⁻²³ J/K, masas en kg." (texto completamente distinto); al hacer clic se reemplaza el texto correcto e inicial por este, que además nunca se traduce al inglés |

### 6.6 `src/ui/Console.js`

| Texto hardcodeado | Ubicación | Clave propuesta | Estado |
|---|---|---|---|
| `` `\n… (+${lines.length - 6} líneas)` `` (línea 178) | truncamiento de mensajes largos en consola | `console.more_lines` (nueva, con variable `{n}`, p.ej. es: "… (+{n} líneas)" / en: "… (+{n} more lines)") | ❌ Falta |

### 6.7 `ShaderLab/js/*.js`

`ShaderLab/index.html` ya fue señalado (sección 3) como **sin integración i18n alguna**; sus scripts (`app.js`, `ui.js`, `devMode.js`, `compiler.js`, `preview.js`) confirman el mismo patrón — toda la UI generada dinámicamente está en español fijo (y algún término técnico en inglés). Dado el volumen, no se detalla cada línea; ejemplos representativos:

| Texto hardcodeado | Ubicación | Estado |
|---|---|---|
| "⬡ Solo elemento" (app.js:340) | filtro dev mode | ❌ Sin i18n |
| "todos" (app.js:376) | contador dev mode | ❌ Sin i18n |
| "Sin elementos" (app.js:468) | lista vacía | ❌ Sin i18n |
| "⚛ Materiales base" (app.js:797) | separador de galería de presets | ❌ Sin i18n |
| "No hay presets aún.<br>Guarda uno desde Custom ✦" (app.js:810) | galería de presets vacía | ❌ Sin i18n |
| `` `¿Guardar "${p.name}" en la galería?` `` (app.js:871, `confirm()`) | guardar preset | ❌ Sin i18n |
| "⚠ Nodo inactivo — ${vNode.reason}" (ui.js:238) | banner de nodo inactivo | ❌ Sin i18n |
| "Variables" / "GLSL generado" (ui.js:268, 307) | secciones del editor de shaders | ❌ Sin i18n |
| "Current Shader" (ui.js:385, en inglés) | título de panel de parámetros | ❌ Sin i18n |

Si se decide localizar ShaderLab, lo más eficiente sería tratarlo como un namespace nuevo (`shaderlab.*`) y abordarlo en un esfuerzo aparte, ya que prácticamente el 100% de su UI requiere externalización.

### 6.8 Archivos `.js` revisados sin hallazgos de strings hardcodeados de UI

`src/ui/AddPanel.js` (contenido data-driven desde objetos de moléculas), `src/ui/ElementSelector.js` (usa `name_es`/`name_eng` de los datos del elemento), `src/ui/FPSJoystick.js`, `src/ui/SessionSetup.js` (ya usa `t()`), `src/ui/panels.js`, `src/audio/SoundEngine.js`, `src/camera/CinematicCamera.js`, `src/core/*.js`, `src/input/Gesture*.js`, `src/physics/*.js`, `src/renderer/MaterialLibrary.js`, `src/renderer/NucleusBuilder.js` (mapa de claves internas, no UI), `src/renderer/OrbitalBuilder.js`, `src/renderer/OrbitalCache.js`, `src/renderer/QuantumRenderer.js`, `src/renderer/QuantumRendererPool.js`, `src/renderer/shaders.js`, `src/structures/*.js` (nombres en comentarios/logs de consola, no UI), `ShaderLab/js/compiler.js`, `ShaderLab/js/devMode.js`, `ShaderLab/js/preview.js`. Los comentarios de código en español de estos archivos no se consideran strings de UI y quedan fuera del alcance del informe.

---

## 7. Resumen de prioridades — hallazgos en `.js`

6. **Bug de contenido en `PhysicsPanel.js`**: el toggle de modo Temperatura (Didáctico/Realista) sobreescribe `#tempModeDesc` con texto hardcodeado que no coincide con `temperature.mode_didactic_desc` / `mode_realistic_desc` del JSON (sección 6.5) — en el caso "Realista" el texto es completamente distinto al definido en i18n. Corregir para que el handler use `t('temperature.mode_*_desc')`.
7. **Duplicación del panel de capas**: `src/renderer/LayerPanel.js` y `js/quantum-view.js` reimplementan el mismo panel con las mismas strings hardcodeadas ("Todo", "Esfera LOD", "Núcleo", "Brillo", "Tamaño", "Vel.", "Tune individual"). Conviene unificar ambos a `LayerPanel.js` y aplicar `t()` ahí una sola vez (sección 6.1/6.2).
8. **`alert()` con mensajes fijos en español** en `app.js` y `js/quantum-view.js` (carga/guardado de perfiles, errores de archivo) — no localizados ni en inglés (sección 6.2/6.3).
9. **`el.name_es` hardcodeado en `js/quantum-view.js`** (línea 568) ignora `document.documentElement.lang`, a diferencia de `ElementSelector.js` que sí distingue `name_es`/`name_eng` — inconsistencia a corregir.
10. **`ShaderLab/js/*.js`**: confirma que ShaderLab carece totalmente de i18n (igual que su HTML, sección 3); requiere un esfuerzo de localización dedicado si se decide incluirlo.
