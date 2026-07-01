
# directory

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
