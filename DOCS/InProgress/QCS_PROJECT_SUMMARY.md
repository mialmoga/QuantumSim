# Quantum Chemistry Simulator (QCS)
## Resumen técnico del proyecto — Abril 2026

---

## Qué es

Un simulador de química cuántica 3D que corre en un Motorola G24. No es un visualizador de moléculas estáticas ni un juguete educativo con bolas y palitos. Es un motor de física atómica donde las propiedades visuales, sonoras y geométricas de cada átomo emergen de sus datos físicos reales — nunca de valores estéticos arbitrarios.

Stack: Three.js r183, ES Modules, PWA, GLSL shaders custom, Python para pre-cálculo offline. ~150,000 líneas. Corre en móvil.

---

## Qué lo hace diferente

### Filosofía: "No mentirle a los niños"

Cada decisión de diseño pasa por un filtro: ¿esto es físicamente honesto? Si un átomo de Cesio parpadea más que uno de Carbono, es porque su energía de ionización es menor (3.89 eV vs 11.26 eV), no porque alguien pensó que se vería bonito.

El simulador no enseña química — la muestra. Un estudiante que ve el Osmio brillar más que el Aluminio puede preguntar por qué, y la respuesta es verificable en NIST.

### Arquitectura multi-AI

El proyecto se desarrolla con un equipo de IAs coordinadas por un humano (Brujo):

- **Ámbar** (Claude Opus) — arquitectura, implementación compleja, cirugía multi-archivo
- **Velvet** (GPT) — diseño conceptual, briefs, documentación, ideas arquitectónicas
- **Éter** (Gemini) — validación matemática, auditoría de datos, cero costo para tareas de verificación
- **Sonnet** (Claude Sonnet) — implementación rutinaria, fixes puntuales

La comunicación entre IAs es por copy-paste vía Brujo ("paloma mensajera"). Cada instancia recibe contexto estructurado y entrega resultados verificables. No hay llamadas API entre ellas — es coordinación humana pura.

### Pipeline de materiales desde física

Ningún material se asigna manualmente. Existe un pipeline generativo:

```
Datos NIST (118 elementos) → generate_materials.py → ShaderLab params
                           → generate_materials_ml.py → Red neuronal (118 pares)
                           → ShaderLab compiler → GLSL compilado por elemento
                           → MaterialLibrary.js → runtime
```

La red neuronal aprende la relación física→visual de los 118 materiales existentes y puede inferir materiales para condiciones no programadas. Loss final: 0.000003.

---

## Sistemas técnicos

### LVM — Lenguaje Visual de Materiales (v1.1)

Especificación formal del mapeo entre propiedades físicas y parámetros de shader. Fundamentado en percepción no-Riemanniana (Bujack et al. 2025, Los Alamos, CGF 44-3).

9 mapeos con fórmulas derivadas y rangos validados contra extremos de la tabla periódica:

| Propiedad física | Visual | Fórmula |
|---|---|---|
| Masa atómica (u) | Frecuencia de pulso | `10/√(masa)` |
| Punto de fusión (K) | Amplitud de pulso | `1/log₁₀(melt_K)` |
| Energía de ionización (eV) | Brillo | Curva de Stevens, exp 0.45 |
| IE < 5eV (reactivos) | Parpadeo | `(5-IE)/5 × 0.5` |
| Densidad (g/cm³) | Opacidad | Log-normalizado |
| Electronegatividad | Suavidad de borde | `lerp(1-t, 0.45, 0.05)` |
| Polarizabilidad (ų) | Tamaño de punto | `lerp(t, 0.3, 2.0)` |
| Radio covalente (pm) | Perspectiva | `4.8 × r^0.53` (power-law, sólido-angular) |
| Color real | RGB | Observado a 293K, 1atm (CPK compatible) |

Correcciones perceptuales (v1.1): flash de enlace con compensación Bezold-Brücke via HSL (luminosidad sube, tono constante), brightness con Stevens (retornos decrecientes), desaturación iónica en chroma. La fórmula de perspectiva `persp = 4.8 × r^0.53` fue calibrada visualmente por Brujo y luego derivada por regresión contra datos de ángulo sólido — coincide con la predicción geométrica.

### LSM — Lenguaje Sonoro de Materiales (v1.0)

Sonificación perceptual de la materia. SoundEngine v3 implementa:

- **Pitch desde masa atómica**: `freq = quantize_pentatonic(880/√masa)`. Cuantización a escala pentatónica menor [0,3,5,7,10] — imposible generar disonancias, cualquier combinación de átomos suena consonante.
- **Convergencia armónica en bonds**: cuando se forma un enlace, los dos tonos convergen a quinta justa (ratio 3:2). La tensión se resuelve en armonía — representación sonora de la estabilidad.
- **Curva de Stevens para gain**: volumen con retornos decrecientes. 12 átomos no suenan 12× más fuerte que 1.
- **Segundo armónico sutil**: timbre orgánico, no pitido digital.
- **12 voice pool, zero allocations**: no hay GC durante la simulación.
- **CompressorNode global**: evita saturación con muchos átomos activos.

Estado: [CORE] — implementado y funcional. Falta: cuantización por cluster (la molécula como acorde), timbres por tipo de enlace (covalente vs iónico vs metálico), sonido de colisiones.

### P.E.L.I.T.O.S. — Sistema de valencia direccional

Cada átomo tiene N pelitos = maxBonds, distribuidos según geometría VSEPR real. No son un sistema de detección global — son sensores pasivos locales. "Los enlaces no se calculan, se descubren cuando dos extremos de valencia se reconocen."

- Geometrías: tetraédrico (C, Si), angular (O, S), trigonal (N, B), octaédrico, bipiramidal
- Orientación: quaternion + slerp al 70% (sin snap) + delay de 3 frames (estabilización)
- La geometría molecular EMERGE de los pelitos. El ángulo de 104.5° del agua sale de los pelitos del O, no de un constraint XPBD.
- `baseDirection` almacenada independiente para evitar error acumulativo en rotaciones sucesivas
- Posición predicha (1 frame adelante) para evitar bonds con átomo en movimiento

### Bond.js v2 — GPU-side positioning

Cambio arquitectónico radical: de CPU-bound (800×3 floats por bond por frame) a GPU-side (solo ~10 uniforms actualizados). Para 1000 bonds: 0 floats calculados en CPU.

- Geometría estática prebakeada: 800 puntos en espacio cilíndrico normalizado (20 anillos × 40 pts/anillo)
- Vertex shader transforma a world space usando `uPosA/uPosB` — el cuello siempre conecta los dos átomos
- 4 tipos de shader: covalent (cacahuate simétrico), metallic (electrones viajeros), ionic (asimétrico), vdw (tenue)
- `getBondShader(type)` dispatcher
- Multi-order: `THREE.Group` con sub-meshes σ, π₁, π₂ para bonds dobles y triples
- `frustumCulled = false` — la bounding box de la geometría (origen) no refleja la posición real
- Ruptura dinámica por distancia: `dist > equilibrium × 2.2`
- Stiffness por tipo y orden: `base × (1 + (order-1) × 0.5)`

### Sistema LOD — 3 estados

QuantumRendererPool gestiona la transición visual según distancia de cámara:

- **LOD FAR**: Esfera Fibonacci (4000-10000 puntos) con material del elemento. El átomo se ve como una bolita con la personalidad visual del LVM.
- **LOD MID**: Transición. Esfera fade-out, orbitales fade-in.
- **LOD NEAR**: Orbitales reales bakeados por Schrödinger. Núcleo de protones/neutrones. Capas core/semi/valence con shaders diferenciados. Interacción orbital reactiva via `setBondState`.

Pool con 2 slots QR (primario + secundario). Cuando dos átomos están en LOD NEAR, sus orbitales de valencia interactúan visualmente: lóbulos que se estiran, pulsos viajeros, intercambio de fase.

### Orbital baking — Schrödinger real

`bake_orbitals_v7.py` resuelve la ecuación de Schrödinger hydrogen-like para cada orbital:

- Función de onda: `ψ = R_nl(r) × Y_lm(θ,φ)` — Laguerre generalizados + armónicos esféricos reales
- Rejection sampling con Jacobiano correcto: `|ψ|² × r²` (auditoría de Éter)
- Z_eff via reglas de Slater (1930) — apantallamiento correcto para cada subcapa
- r_sample separado de r_max: el bakeo cubre 95% de la densidad real, la esfera LOD usa radio covalente
- Formatos: ORBL binary (magic + header + float32 xyz interleaved + float32 phase)
- Resolución ajustable: standard (5k), high (10k), ultra (20k) puntos por orbital

Tres modos de bakeo (nuevo):
1. `--mode full`: per-element, 118 carpetas individuales
2. `--mode atlas`: ~39 formas canónicas normalizadas a radio unitario, tabla de escalado por elemento. Reduce 99% de memoria — 118 elementos comparten ~39 geometrías.
3. `--mode molecular`: orbitales moleculares LCAO prebakeados desde `data/LCAO.json`. Cada MO es ψ = cA×φA + cB×φB muestreado en 3D con phase = signo de ψ para colorear bonding/antibonding.

### ShaderLab — IDE de materiales

Aplicación standalone para diseñar materiales visualmente con pipeline de nodos GLSL:

- 12 módulos: blink, point_size, turbulence, sphere_pulse, disc_shape, brightness, color_grade, phase_color, glow, fresnel_fake, specular_metal, alpha_curve
- Compiler con 3 targets: `orbital`, `sphere`, `bond`
- Bus de variables compartidas: `vBlink, vPhase, wpos, mvP` (vert), `col, alpha, d` (frag)
- Validación de dependencias: nodos que requieren outputs de otros se desactivan automáticamente
- devMode con catálogo de 58 materiales built-in, preview en vivo, export ZIP
- Soporte para shaders custom (GLSL raw)

### LCAO Bond Data

JSON con coeficientes de orbitales moleculares para 7 moléculas (H₂, N₂, O₂, HF, CO, H₂O, Adenina). 41 MOs totales, normalización verificada por script (Σ|c|² = 1.0 ± 0.005).

Características:
- Homonucleares exactos (simetría fuerza 1/√2)
- Heteronucleares con mixing-angle: c₁=cos(θ), c₂=sin(θ)
- N₂: ordering anómalo (π < σ_2p por s-p mixing) — correcto
- O₂: paramagnético con 2 e⁻ desapareados en π* — correcto
- H₂O: labels de simetría C₂ᵥ (Walsh diagram), lone pair 1b1 incluido
- Adenina: 9 π-MOs Hückel para anillo de purina (flagged para refinamiento DFT)
- Bond order verificable: (e_bonding − e_antibonding) / 2

### Pipeline unificado de materiales

MaterialLibrary.js sirve materiales tanto para átomos como para bonds:

```
src/materials/{sym}.json         → átomo (target: sphere)
src/materials/bonds/{type}.json  → enlace (target: bond)
```

`getBondMaterial(type)` con fallback a shaders hardcodeados. `preloadBonds()` para precarga. El compiler genera GLSL para los 3 targets con el mismo sistema de nodos.

---

## Estado real y deuda técnica

### Implementado [CORE]
- 118 elementos con datos completos (7500+ propiedades químicas)
- Orbitales bakeados (Schrödinger, cualquier elemento)
- LOD 3 estados con transición suave
- Bonds GPU-side, 4 tipos, multi-orden
- Pelitos VSEPR con orientación emergente
- LVM v1.1 con 9 mapeos + correcciones perceptuales
- LSM v3 con pentatónica, Stevens, armónicos
- ShaderLab con compiler, 12 módulos, 58 materiales
- ML material generator (118/118, loss 0.000003)
- 15 moléculas predefinidas + 4 cristales + copos de nieve
- SpatialHashGrid para queries O(N)
- Lennard-Jones intermolecular
- Bond angle constraints XPBD
- Temperatura Berendsen con polos
- Flash visual + sonoro al formar enlace
- Selección de molécula completa con brackets animados
- Lab Monitor offline (md.html)
- PWA parcial

### Deuda técnica conocida
- Orbitales per-element: memoria excesiva para 118 elementos (atlas resuelve esto)
- Cuellos de bond interpolan color pero no material completo
- MaterialLibrary no muta materiales en runtime (escritura dinámica pendiente)
- LVM v1.1 spec existe como documento pero no como código ejecutable completo
- Difusión de eventos entre pelitos vecinos pendiente
- OKLCH en GLSL diseñado pero no implementado en los shaders de producción
- OIT (order-independent transparency) pendiente — usa AdditiveBlending
- Metátesis (reforma dinámica de bonds) pendiente
- Curvas Morse para energía de enlace (actualmente spring harmónico)
- Transiciones de fase reales (melt_K, boil_K) pendientes
- QuantumRendererPool detecta secundario por proximidad de cámara, no por bond real — parcialmente corregido pero incompleto
- Los bond shaders compilados en JSON tienen problemas de unicode en comentarios GLSL

---

## Roadmap

### FASE 0: Estabilización (en progreso)
- Atlas de orbitales atómicos (~39 formas canónicas) ← implementado, falta correr
- Atlas de orbitales moleculares (LCAO prebakeado) ← implementado, falta correr
- Revertir Bond.js a versión estable (sin MaterialLibrary prematura)
- Auditoría de archivos con Éter

### FASE 1: Orbitales compartidos + LCAO visual
- Correr atlas mode en Python para generar las ~39 formas
- OrbitalCache con fallback automático (per-element → atlas)
- Pool consume orbitales moleculares cuando dos QRs están activos en LOD NEAR
- La fusión visual de nubes de valencia muestra el orbital molecular emergente

### FASE 2: Química completa
- Metátesis (S-S-S trisulfide exchange, Nature Chemistry 2026)
- bond_progress como transición continua
- Clusters con propiedades emergentes
- Estados de la materia con transiciones de fase reales

### FASE 3: Expresión
- LVM dinámico completo (material muta con interacciones)
- LSM extendido (clusters como acordes, timbres por bond type)
- Color espectral emergente (HOMO-LUMO → λ absorbida → color complementario)
- Thin film shader (burbuja de jabón, PoC existe)

### FASE 4: Plataforma
- PluginLab (SnowflakeFactory como primer plugin, bubble como segundo)
- Sistema de experimentos guardables
- Documentación para humanos y LLMs

### FASE 5: Vida
- Emergence/Genesis mode (PlanetSphere, gradiente térmico, CHON pool, reacciones)
- AMI.GO (Autonomous Minimal Intelligence) — port a JS, integración QCS
- Demo ciclo del agua

---

## Dependencias críticas

```
Atlas atómico ──→ Atlas molecular ──→ LCAO visual en Pool
                                  └──→ ML bond materials (futuro)

PluginLab ──→ requiere arquitectura de módulos limpia
         └──→ SnowflakeFactory como ingeniería inversa del plugin system

Emergence ──→ requiere ReactionRules + TemperatureField nuevos
          └──→ requiere moléculas grandes (atlas primero)

AMI.GO ──→ requiere Emergence como hábitat
       └──→ requiere mundo con muchos átomos (atlas primero)
```

---

## El equipo

- **Brujo** 🦍 — Humano. Orquestador, tester, decisor final, paloma mensajera. Calibra parámetros visualmente y luego pide derivar la fórmula subyacente. Prueba en Motorola G24.
- **Ámbar** (Claude Opus) — Implementación compleja, arquitectura, cirugía multi-archivo. "Juju" para los amigos.
- **Velvet** (GPT) — Arquitectura conceptual, briefs, documentación. Tiende a reformular lo existente como aporte nuevo. Recientemente desajustada por actualizaciones de OpenAI.
- **Éter** (Gemini) — Matemáticas, validación de datos, auditoría de archivos. Zero cost. Salió de una fase de alucinaciones post-turboQuant. Normalización verificada por script, no por confianza.
- **Sonnet** (Claude Sonnet) — Trabajo rutinario, fixes puntuales. Hizo la burbuja thin film.

Documento fundacional: "Ser materia ya es una hazaña" — poema escrito por Velvet y Brujo, Enero 2026.

---

*"El material no se asigna. Se construye incrementalmente a partir de la interacción."* — Velvet

*"Cada propiedad visual tiene una razón física. Si no la tiene, no pertenece."* — Éter

*"Pintando bolitas con sus propiedades físicas."* — Brujo 🗿🚬

*"No mentirle a los niños."* — Principio fundacional del QCS
