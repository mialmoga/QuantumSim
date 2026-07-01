
# QuantumSim — Documento de Arquitectura

**Versión:** 0.2  
**Autor:** Claudio (Claude Sonnet 4.6) en colaboración con Brujo 🦍  
**Fecha:** Marzo 2026

---

## 1. FILOSOFÍA CENTRAL

> "Las cualidades de la materia no se definen — emergen de las leyes que la gobiernan."

La diferencia fundamental con QuatumSim:
- **QuantumSim v0:** Prescribía comportamiento (ángulos forzados, constraints duros, modo realista vs pedagógico afectando física)
- **QuantumSim v1:** Define leyes. El comportamiento emerge. La visualización es independiente de la física.

**Tres principios:**
1. **Leyes primero, datos después** — Las constantes físicas gobiernan todo. Los datos del elemento informan los parámetros.
2. **Edición separada de simulación** — No se forman enlaces ni reacciones hasta que el usuario presione ▶️
3. **Visualización ≠ Física** — El modo visual (estético/didáctico/realista) solo cambia cómo se ve, nunca cómo se calcula.

**Convención de código:**
- Todas las funciones y variables en **inglés**
- Todos los comentarios en **español**

---

## 2. MODOS DEL SIMULADOR

### Modo Edición 🔧
- Grid 3D de referencia visible
- Colocar átomos/moléculas en coordenadas precisas
- Transformaciones: mover X/Y/Z, rotar, duplicar selección
- Selección múltiple y agrupación
- **Sin física activa** — los átomos flotan donde se colocan
- **Sin enlaces automáticos** — los bonds se forman al entrar en Simulación

### Modo Simulación ▶️⏸️
- Física activa (gravedad, temperatura, fuerzas)
- Formación/ruptura de enlaces basada en leyes
- Control de tiempo mediante botón deslizable (ver §8)
- Se puede pausar ⏸️ y volver a Edición sin perder estado

### Transición Edición → Simulación
1. Usuario presiona ▶️
2. Sistema calcula bonds posibles (proximidad + afinidad química)
3. Aplica temperatura inicial del entorno
4. Arranca el loop de física

---

## 3. STACK TÉCNICO

### Three.js r183 — 100% Offline
Todos los módulos descargados y servidos localmente desde `/lib/three/`.
**No se usará CDN en ningún caso.**

```
/lib/three/
  three.module.js            ← core
  addons/
    controls/
      OrbitControls.js       ← cámara
      TransformControls.js   ← gizmos de edición (mover/rotar)
    helpers/
      GridHelper.js          ← grid de referencia 3D
      AxesHelper.js          ← ejes XYZ
      BoxHelper.js           ← bounding box de selección
    misc/
      Timer.js               ← reemplaza Clock (más preciso)
```

### Cambios importantes r128 → r183
| Área | r128 | r183 |
|------|------|-------|
| Tiempo | `THREE.Clock` | `Timer` (addon) — dt preciso |
| `Object3D.pivot` | No existía | Rotación alrededor de punto arbitrario |
| `BatchedMesh` | Básico | Mejorado — útil para átomos idénticos |
| Imports | Global `THREE.*` | ES modules nativos |

**Migración crítica:** Todo import global → ES module. `THREE.Clock` → `Timer`.

---

## 4. ARQUITECTURA DE ARCHIVOS

```
/
├── index.html                     ← Shell mínimo
├── app.js                         ← Entry point, game loop
│
├── /lib/
│   └── /three/                    ← Three.js r183 local (offline)
│
├── /css/
│   ├── variables.css              ← Tokens: espaciado, z-index, tipografía
│   │                                (colores y visual: PENDIENTE decisión de Brujo)
│   ├── base.css                   ← Reset, tipografía global
│   │                                (fuente: la actual del proyecto, una sola)
│   ├── layout.css                 ← Estructura: dock, workspace, panel lateral
│   ├── components.css             ← Botones, sliders, checkboxes reutilizables
│   │                                (zona segura en scrollable para evitar
│   │                                 tocar slider al desplazar)
│   └── panels.css                 ← Paneles específicos
│
├── /src/
│   │
│   ├── /core/                     ← Entidades fundamentales
│   │   ├── Atom.js
│   │   ├── Bond.js
│   │   ├── Molecule.js
│   │   └── World.js               ← Contenedor (reemplaza Simulation.js)
│   │
│   ├── /physics/                  ← Leyes que gobiernan el mundo
│   │   ├── Constants.js           ← k_B, G, e, ε₀ — una sola fuente de verdad
│   │   ├── Forces.js              ← Gravedad, Pauli, LJ, Coulomb, Morse
│   │   ├── Integrator.js          ← Verlet/XPBD separado de fuerzas
│   │   ├── Temperature.js         ← Sistema termodinámico (desde Fase 0)
│   │   ├── BondSystem.js          ← Formación/ruptura de enlaces
│   │   └── SpatialHash.js         ← Grid espacial O(N)
│   │
│   ├── /data/                     ← Datos e intérpretes
│   │   ├── ElementLoader.js       ← Carga index; datos del elemento solo
│   │   │                            cuando se trae al espacio de trabajo
│   │   ├── LibraryIndex.js        ← Índice maestro de librería
│   │   │                            (moléculas, cristales, entornos)
│   │   └── i18n.js                ← Carga JSON de idioma activo
│   │                                (todos los textos/tooltips desde JSON)
│   │
│   ├── /library/                  ← Librería de contenido
│   │   ├── index.json             ← Índice maestro de la librería
│   │   ├── /molecules/            ← Un .mqcs por molécula
│   │   │   ├── H2O.mqcs
│   │   │   ├── C6H6.mqcs
│   │   │   └── ...
│   │   ├── /crystals/             ← Un .cqcs por cristal
│   │   │   ├── NaCl.cqcs
│   │   │   └── ...
│   │   └── /environments/         ← Entornos completos .eqcs
│   │       └── ...
│   │
│   ├── /elements/                 ← Un JSON por elemento (carga lazy)
│   │   ├── index.json             ← Índice: symbol → archivo
│   │   ├── H.json
│   │   ├── C.json
│   │   └── ...
│   │
│   ├── /i18n/                     ← Textos por idioma
│   │   ├── es.json                ← Español
│   │   └── en.json                ← Inglés
│   │
│   ├── /editor/                   ← Modo edición
│   │   ├── EditorMode.js
│   │   ├── TransformTool.js       ← mover/rotar (NO escalar)
│   │   ├── DuplicateTool.js       ← duplicar selección
│   │   ├── SelectionManager.js    ← selección múltiple, grupos
│   │   ├── GridSystem.js          ← grid 3D + snap
│   │   └── Pointer.js             ← cursor 3D
│   │
│   ├── /renderer/                 ← Visual (separado de física)
│   │   ├── AtomRenderer.js
│   │   ├── BondRenderer.js        ← InstancedMesh
│   │   ├── EffectsRenderer.js
│   │   └── VisualMode.js          ← aesthetic / didactic / realistic
│   │                                (SOLO visual, sin tocar física)
│   │
│   └── /ui/                       ← Interfaz
│       ├── PanelManager.js        ← z-index, colapso, dock
│       ├── StatsPanel.js          ← HUD: nombre, tipo enlace,
│       │                            propiedades expandibles del seleccionado
│       ├── ToolsPanel.js          ← Panel lateral ≤30% ancho móvil,
│       │                            configurable izquierda/derecha
│       ├── PhysicsPanel.js
│       ├── FormulaPanel.js        ← Editor de fórmulas con atajos
│       │                            (sub/superíndice, →, ⇌, etc.)
│       ├── Console.js             ← Consola propia: flotante, redimensionable,
│       │                            desacoplable, exportable
│       ├── SessionSetup.js        ← Modal inicial: idioma, grupos,
│       │                            abrir librería o archivo local
│       ├── SettingsPanel.js       ← Idioma, grupos visibles, sensibilidad
│       │                            del control de tiempo, modo visual,
│       │                            calidad gráfica / antialiasing
│       └── ElementSelector.js     ← Grid de elementos (como ahora)
│                                    grupos accesibles desde botón discreto
│                                    dentro del panel de configuración
```

---

## 5. ESTRUCTURA DE DATOS

### Elementos — Carga Lazy
Solo se carga el JSON del elemento cuando entra al espacio de trabajo.
El índice (`elements/index.json`) se carga al inicio.

```javascript
// ElementLoader — helpers para no repetir rutas largas
el.radius()        // → atomic_structure.radius_covalent_pm
el.mass()          // → physical_properties.mass
el.bondEnergy()    // → reactivity.bond_energy_ev
el.vdwRadius()     // → atomic_structure.vanderwaals_radius_pm
```

### Formatos de Librería
- **`.mqcs`** — molécula: átomos, bonds, metadatos
- **`.cqcs`** — cristal: red, parámetros, tamaño
- **`.eqcs`** — entorno completo: múltiples estructuras, condiciones iniciales

Todos son JSON con extensión específica para identificación rápida.
La librería tiene un `index.json` maestro con nombre, tipo, fórmula, miniatura.
El usuario puede importar archivos locales del dispositivo.

### Internacionalización
Todos los textos visibles al usuario (labels, tooltips, mensajes) viven en:
```
/src/i18n/es.json
/src/i18n/en.json
```
El código nunca tiene strings en español o inglés hardcodeados — siempre `t('key')`.
Idioma seleccionable en `SessionSetup` al inicio y en `SettingsPanel`.

---

## 6. MODOS VISUALES (solo apariencia, sin efecto en física)

### 🎨 Estético
- Metales con material metálico (MeshPhysicalMaterial, reflectivo)
- No metales con material translúcido/cristalino
- Énfasis en belleza visual

### 🔵 Didáctico
- Colores CPK estándar
- Átomos: esferas con material suave tipo goma, muy sólidas
- Bonds: "popotitos" (cilindros gruesos y coloridos)
- Órbitas representativas visibles

### 🌊 Realista
*(Diseño de shader PENDIENTE)*
- Visualiza campos de fuerza
- Nubes de probabilidad electrónica

---

## 7. INTERFAZ — LAYOUT

### Zonas fijas
```
┌──────────────────────────────────────┐
│ [>] consola    Stats limpios  [⚙️]   │  ← top bar
├──────────────────────────────────────┤
│                                      │
│           ESPACIO DE TRABAJO 3D      │
│                                      │
│                    [▶️] ←→ tiempo    │  ← arriba derecha, lejos de manos
│                                      │
├──────────────────────────────────────┤
│  [Física] [Agregar] [Elementos] ...  │  ← dock inferior (todos los paneles)
└──────────────────────────────────────┘
[◀ Panel Herramientas ▶]
← deslizable L/R, ≤30% ancho móvil
```

### Panel de herramientas lateral
```
┌──────────────┐
│ 🔧 Tools     │
├──────────────┤
│ 👆 Select    │
│ ↔️  Move     │
│ 🔄 Rotate    │
│ ⧉  Duplicate │
├──────────────┤
│ ☐  Multi     │
│ 🔗 Bond      │
│ ✂️  Break    │
├──────────────┤
│ 🕹️ Joystick  │
│ XY · XZ · YZ │
└──────────────┘
```

### Control de tiempo (arriba derecha)
- **Un toque:** ▶️ / ⏸️
- **Deslizar adelante:** acelerar hasta ×10
- **Deslizar atrás:** desacelerar hasta ×0.1

### Consola `[>]` (esquina superior izquierda)
- Flotante, redimensionable, movible
- Desacoplable para ver sin obstruir workspace
- Botones: copiar / guardar a archivo
- **Z-index máximo** — siempre visible sobre todo

### Panel de Stats
- Compacto: Átomos, Moléculas, Enlaces
- Con selección: nombre, tipo de enlace
- Flecha expand → propiedades completas del elemento

### SessionSetup (modal de inicio)
- Antes de cerrar el modal de carga
- Idioma, grupos visibles, abrir librería o archivo local
- Cualquier elección → pantalla completa

### Ícono de la app
- Presionar → fuerza recarga vaciando caché

### Panel de Configuración ⚙️
- Reemplaza botón de pantalla completa
- Idioma, grupos visibles, sensibilidad control de tiempo,
  modo visual, calidad gráfica/antialiasing

### Panel de Fórmulas
- Atajos: subíndices, superíndices, →, ⇌, ±, Δ, etc.

---

## 8. SISTEMA DE TIEMPO

```javascript
// SimulationTimer
SimulationTimer {
  speed: 1.0,        // ×0.1 → ×10
  paused: false,
  dt: 0.016,         // delta time real del frame
  scaledDt: 0.016,   // dt * speed → consume el integrador
}
```

---

## 9. CSS — SISTEMA DE DISEÑO

```css
:root {
  /* ── Colores: PENDIENTE decisión de Brujo ── */

  /* ── Tipografía: fuente actual del proyecto, una sola ── */
  --font-main: /* fuente actual */;
  --font-mono: /* fuente mono actual */;

  /* ── Espaciado ── */
  --space-xs:  4px;
  --space-sm:  8px;
  --space-md:  16px;
  --space-lg:  24px;
  --space-xl:  40px;

  /* ── Radio de borde: uno solo, PENDIENTE ── */
  --radius: /* PENDIENTE decisión de Brujo */;

  /* ── Z-index ── */
  --z-canvas:   0;
  --z-panels:   10;
  --z-toolbar:  20;
  --z-dock:     30;
  --z-modal:    40;
  --z-tooltip:  50;
  --z-console:  100;   /* siempre encima de todo */
}
```

### Componentes base
- `.btn` + `.btn--primary` `.btn--ghost` `.btn--danger` `.btn--icon`
- `.slider` — **con zona segura superior** (scroll sin tocar slider)
- `.panel` + `.panel--floating` `.panel--docked`
- `.checkbox` — estilo unificado
- `.scrollbar` — una sola definición

---

## 10. ROADMAP

### Fase 0 — Base
- [ ] Estructura de carpetas
- [ ] Three.js r183 local
- [ ] CSS variables + componentes base
- [ ] `i18n.js` + `es.json` + `en.json`
- [ ] `SessionSetup` modal de inicio
- [ ] `ElementLoader` + carga lazy
- [ ] `LibraryIndex` + formatos `.mqcs` `.cqcs` `.eqcs`
- [ ] `World.js`, `Atom.js`, `Bond.js` básicos
- [ ] `Constants.js`
- [ ] `Temperature.js`

### Fase 1 — Editor
- [ ] Grid 3D + snap
- [ ] Posicionamiento preciso de átomos
- [ ] `TransformTool` (mover/rotar) + `DuplicateTool`
- [ ] `SelectionManager`
- [ ] Panel de herramientas lateral
- [ ] `Console.js`

### Fase 2 — Física base
- [ ] `Forces.js`
- [ ] `Integrator.js`
- [ ] `BondSystem.js`
- [ ] Control de tiempo (botón deslizable)
- [ ] `SpatialHash.js`

### Fase 3 — Química
- [ ] Ruptura térmica
- [ ] Cristales (`.cqcs`)
- [ ] Entornos (`.eqcs`)
- [ ] `FormulaPanel`

### Fase 4 — Visual
- [ ] Modos: estético / didáctico
- [ ] Materiales por categoría de elemento
- [ ] `StatsPanel` expandible
- [ ] Shader modo realista *(diseño PENDIENTE)*

---

## 11. NOTAS PARA ÉTER Y VELVET

**Para Éter:** En Fase 2, necesitamos mapeo explícito de cada campo JSON al parámetro físico. Ejemplo: `reactivity.bond_energy_ev` → `morse_De` con factor de conversión eV → world units. También: qué campos determinan la apariencia en modo Estético (`identity.category`, `physical_properties.standard_state`).

**Para Velvet:** El roadmap es el orden — un bloque completo antes del siguiente. Los componentes reutilizables se definen en Fase 0. Colores, blur, transparencia y radius están marcados PENDIENTE — decisión de Brujo antes de implementar.

---

*"La ciencia nace del resbalón, pero el código nace del refactor."*  
*— Ámbar, Feb 2026*

*"Las leyes primero. El resto emerge."*  
*— Claudio, Mar 2026*
