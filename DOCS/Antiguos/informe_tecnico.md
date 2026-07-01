# Informe Técnico — Quantum Chemistry Simulator
## Análisis de codebase + datos disponibles

---

## 1. LO QUE FUNCIONA BIEN

### Arquitectura de física — sólida

El pipeline de `Simulation.update()` está bien pensado: fuerzas de campo → springs de enlace → integración → corrección XPBD angular. El orden importa y está correcto. La separación entre `PhysicsEngine` (mecánica pura) y `PhysicsModeManager` (configuración de modo) es limpia y permite cambiar de modo pedagógico a realista sin romper nada.

### XPBD + Morse — decisión correcta

Usar XPBD de distancia en modo pedagógico y potencial de Morse en modo realista es exactamente la distinción correcta. Springs clásicos `F = k·Δx` resuenan sin amortiguamiento, XPBD no. El fallback de `morse_a = 8.0 → 2.5` en la transición para evitar explosiones al cambiar de modo es un detalle de ingeniería cuidadoso.

### SpatialHashGrid para Lennard-Jones

Reducir O(N²) a O(N) en el cálculo de Van der Waals es la optimización correcta. Con 500 átomos la diferencia es ×80 más rápido. El cache de moléculas con WeakMap para evitar reconstruir el BFS cada frame también está bien.

### `_canBond()` — lógica química real

Los gases nobles inertes, la restricción Kr/Xe–F, la valencia saturada, y el modo estricto son reglas químicamente correctas y bien jerarquizadas. La distinción entre `max_bonds` (dato del JSON) y `valence` (fallback) es la jerarquía correcta.

### Sistema de temperatura — dos modos honestos

Tener `DIDACTIC` y `REALISTIC` explícitamente separados, con constantes diferentes y documentadas, es la decisión pedagógicamente correcta. El termostato Berendsen es el estándar para MD educativa. La irradiación superficial por piso/techo es un detalle que agrega mucho valor didáctico.

### Gestión de memoria

El uso de `_tempVec` / `_delta` / `_force` como objetos reutilizables en los hot paths evita presión sobre el GC. Los `remove()` con `dispose()` explícito en geometrías y materiales Three.js están bien implementados.

### Datos del JSON — excepcionalmente ricos

El U.json es representativo de cuánta información tienen disponible. La profundidad es inusual para un proyecto de este tipo.

---

## 2. PROBLEMAS REALES

### `Bond.targetDist` — la fuente de verdad está rota en auto-bonding

```js
// Bond.js línea 119
this.targetDist = atom1.group.position.distanceTo(atom2.group.position);
```

Esto está bien para moléculas cargadas desde JSON (posiciones ya correctas). Para auto-bonding, los átomos se colocan a distancias arbitrarias y el enlace hereda esa distancia como "equilibrio". Si el usuario suelta un H a 3wu de un O, `targetDist = 3.0` en vez de `~0.96wu` (distancia real O–H). El método estático `Bond._calcTargetDist()` existe y es correcto pero **nunca se llama en el constructor**. Es deuda técnica activa.

**Fix sugerido:**
```js
// En el constructor de Bond, después de calcular bondType:
if (options?.fromMolecule) {
    this.targetDist = atom1.group.position.distanceTo(atom2.group.position);
} else {
    this.targetDist = Bond._calcTargetDist(atom1, atom2, this.order);
}
```

### `applyAtomicRepulsion()` — O(N²) sin SpatialHashGrid

Lennard-Jones ya usa el grid, pero la repulsión de Pauli (llamada cada frame para todos los pares) es O(N²) puro. Con 200 átomos son 19,900 pares evaluados por frame. Debería usar el mismo `SpatialHashGrid` que LJ.

### `BondAngleConstraints` — lookup `sim.atoms.indexOf(a)` es O(N)

```js
// BondAngleConstraints.js línea 56
const key = [a1, a2].map(a => sim.atoms.indexOf(a)).sort().join('-');
```

`indexOf` en un array es O(N). En el contexto de `applyBondAngleConstraints` que se llama por cada átomo con enlaces, esto se vuelve O(N²) cuando hay muchos átomos. El índice debería precalcularse o usarse una clave basada en el objeto directamente (WeakMap o id incremental en el átomo).

### `_detectPhase()` — solo usa el primer átomo

```js
// Temperature.js línea 381
const el = atoms[0]?.element;
```

Si hay H₂O y NaCl en la misma escena, la fase se detecta según el primer átomo del array, que puede ser cualquiera. La fase debería calcularse por molécula o al menos por elemento mayoritario.

### `PhysicsMode.js` — `console.log` en producción

```js
// PhysicsMode.js línea 130
console.log(`Bond ${bond.bondType?.name}: targetDist=...`);
```

Este log se ejecuta cada vez que se activa el modo realista, iterando todos los bonds. Es un log de debug que quedó en producción.

### `MoleculeFragmentation` — `useSpatial` con distancia hardcodeada

```js
// MoleculeFragmentation.js línea 39
const maxDist = 6.0; // Same as MetallicCloud physics cutoff
```

Este `6.0` está desconectado de `MetallicCloud`'s cutoff real. Si alguien cambia el cutoff del cloud, la fragmentación no lo sabe. Debería venir del cloud como parámetro.

### `Atom._createCloudParticles()` — `particlesPerElectron = 8` hardcodeado

```js
const particlesPerElectron = 8;
const count = totalElectrons * particlesPerElectron;
```

Para el Uranio (92 electrones) esto genera 736 partículas de nube. Para el Californio (98e) son 784. No hay LOD ni límite máximo. En dispositivos móviles esto es un problema.

### `window.getBondsVisibilityState` — acoplamiento global

```js
// Bond.js línea 104
this.visible = window.getBondsVisibilityState ? window.getBondsVisibilityState() : true;
```

Dependencia directa de `window` en una clase de dominio. Imposible de testear y frágil ante refactoring.

---

## 3. TODO LO HARDCODEADO

### Physics.js
```js
this.gravityStrength = 5;          // escala 0-10, arbitraria
this.gravityConstant = 0.00001;    // "100x weaker than before" — sin base física
this.floorY = -15;                 // posición arbitraria
this.ceilingY = 15;                // posición arbitraria
this.friction = 0.98;              // sin justificación física
this.terminalVelocity = 2.0;       // world units/frame — arbitrario
this.repulsionStrength = 0.5;      // sin base en potencial real
this.repulsionFactor = 1.6;        // "punto dulce" sin documentar origen
```

### Bond.js
```js
this.stiffness = 0.8;             // XPBD stiffness — no deriva de ningún dato
this.morse_De = 0.05;             // calibrado "a ojo" para escala sin dt
this.morse_a  = 2.5;              // rigidez moderada — sin base en datos de enlace
const orderFactor = order === 3 ? 0.78 : order === 2 ? 0.87 : 1.00; // empírico
```

El JSON tiene `bond_energy_ev` y `dissociation_energy_kj_mol` — `morse_De` debería derivar de ahí.

### BondAngleConstraints.js
```js
const stiffness = bonds.length <= 2 ? strength * 0.6
                : bonds.length <= 4 ? strength * 0.4
                : strength * 0.15;  // escalones arbitrarios
const half = clamp(error * stiffness * 0.5, -0.10, 0.10); // clamp arbitrario
const VDAMP = 0.05;               // sin base física
```

### LennardJones.js
```js
const epsilon = Math.sqrt(pol1 * pol2) * 0.00001; // factor de escala inventado
this.cutoffDistance = 8.0;        // arbitrario
```

Los valores hardcodeados en `_estimateVDWRadius` y `_estimatePolarizability` son redundantes — el JSON ya tiene `vanderwaals_radius_pm` y `polarizability_angstrom3`.

### Temperature.js
```js
const K_BOLTZMANN_DIDACTIC = 0.0001;  // inventado por definición, documentado
const TIME_SCALE = 1e-13;            // ajustado para que "se vea vivo"
const PHASE_GENERIC = { SOLID_TO_LIQUID: 500, LIQUID_TO_GAS: 1800 }; // genérico
this.thermostatTau = 60;             // frames, arbitrario
this.surfaceRadiationRange = 6.0;    // wu, arbitrario
this.surfaceRadiationStrength = 0.4; // arbitrario
```

### MoleculeFragmentation.js
```js
const maxDist = 6.0;   // desacoplado del cloud real
if(dist < 4.0) { ... } // umbral de fallback bonds sin base
```

### Atom.js
```js
const particlesPerElectron = 8;          // sin LOD
radius += 0.6 + this.nucleusRadius * 0.3; // espaciado entre capas arbitrario
const visualizationMode = this.config.visualizationMode || 'clouds'; // default hardcodeado
eColorArr[index*3] = 0 * brightness;     // rojo = 0, siempre cyan puro
```

---

## 4. QUÉ MÁS APROVECHAR DEL JSON

El U.json tiene datos que el código nunca usa. Organizados por impacto:

### Alto impacto, relativamente fácil de implementar

**`bond_energy_ev` / `dissociation_energy_kj_mol` → `morse_De`**
```js
// En Bond.js, reemplazar el hardcoded 0.05:
const bde_kj = (el1.dissociation_energy_kj_mol + el2.dissociation_energy_kj_mol) / 2;
this.morse_De = bde_kj ? bde_kj * 1.036e-5 : 0.05; // kJ/mol → eV
```
Actualmente `morse_De = 0.05` para todo. Con estos datos, O=O sería más duro que C–C que sería más duro que Na–Cl.

**`melt_K` / `boil_K` → `_detectPhase()`**
El JSON tiene `physical_properties.melt_K` y `boil_K`. El código en Temperature.js busca `melting_point_K` (nombre distinto). Hay un mismatch de nombres que hace que nunca se usen los datos reales — siempre cae en `PHASE_GENERIC`.
```js
// Actualmente (nunca funciona):
const melt = el?.melting_point_K ?? PHASE_GENERIC.SOLID_TO_LIQUID;
// Fix:
const melt = el?.melt_K ?? el?.melting_point_K ?? PHASE_GENERIC.SOLID_TO_LIQUID;
```

**`lattice_structure` → `CrystalGenerator`**
El campo `physical_properties.lattice_structure` existe ("orthorhombic" para U). Si el generador de cristales usa esto, las estructuras serían correctas por elemento en vez de usar BCC/FCC genérico.

**`quantum_numbers` → visualización de orbitales**
```json
"quantum_numbers": { "s": 2, "p": 0, "d": 1, "f": 3 }
```
Estos números cuánticos de los electrones de valencia ya están disponibles. Son exactamente lo que necesita el sistema de orbitales para decidir qué tipo de orbital P/D/F dibujar y con cuántos electrones.

**`geometry_preference_eng` + `ideal_bond_angle` → `BondAngleConstraints`**
```json
"geometry_preference_eng": "Octahedral",
"ideal_bond_angle": 90
```
`BondAngleConstraints.js` ya tiene lógica para `el.ideal_bond_angle` pero usa el mismo ángulo para todos los pares. Con `geometry_preference_eng` se podría distinguir octaédrico (90°/180°) de tetraédrico (109.5°) de trigonal (120°) automáticamente.

**`oxidation_states` → detección de iones**
```json
"oxidation_states": [6, 5, 4, 3]
```
Cuando se detecta un enlace iónico, saber el estado de oxidación real permite colorear el ion correctamente y determinar cuántos electrones transfirió.

### Impacto medio, requiere más trabajo

**`polarizability_angstrom3` → `LennardJones._getLJParameters()`**
El código ya intenta usar `el.polarizability_angstrom3` pero tiene fallback a valores hardcodeados. El U.json tiene 25 Å³. Esto ya funciona parcialmente.

**`latent_heat_fusion_kj_mol` + `latent_heat_vaporization_kj_mol` → transiciones de fase**
Con el calor latente real se podría implementar que la temperatura no suba linealmente durante un cambio de fase — exactamente como ocurre en la realidad. Pedagógicamente es uno de los conceptos más difíciles de visualizar.

**`vapor_pressure_constants` (Antoine) → presión de vapor**
```json
"vapor_pressure_constants": { "A": 5.1, "B": 23000, "C": -0.5 }
```
La ecuación de Antoine `log(P) = A - B/(T+C)` daría la presión de vapor real en función de temperatura. Útil para mostrar cuándo un elemento "hierve" en la simulación.

**`thermal_conductivity_wmk` → disipación de calor entre átomos enlazados**
Si dos átomos están enlazados, el calor debería transferirse entre ellos a una tasa proporcional a la conductividad térmica del material. Actualmente todos los átomos se calientan uniformemente.

**`decay_chain` → simulación de decaimiento radiactivo**
El U.json tiene la cadena completa U-238 → Pb-206 con 15 pasos, modos de decaimiento y vidas medias. Están los datos para una visualización de decaimiento radiactivo interactiva donde puedes ver la cadena completa en tiempo real (acelerado).

**`isotopes` + `neutron_cross_section_barns` → simulación de fisión**
El U-235 tiene abundancia 0.72% y la sección eficaz de neutrones está disponible. Los datos para una demo básica de reacción en cadena están todos.

### Bajo impacto inmediato pero valor educativo

**`youngs_modulus_gba` + `poisson_ratio` → elasticidad de moléculas**
Podría usarse para calcular `morse_a` automáticamente. El módulo de Young del material macroscópico es una aproximación gruesa del potencial de enlace, pero es mejor que el hardcoded 2.5.

**`magnetic_susceptibility` → comportamiento en campo magnético**
Para una demo futura de materiales paramagnéticos/diamagnéticos.

**`work_function_ev` → emisión fotoeléctrica**
Con la función de trabajo y una fuente de luz simulada, se podría demostrar el efecto fotoeléctrico.

---

## 5. DEUDA TÉCNICA

### Crítica

1. **`Bond._calcTargetDist()` existe pero no se usa en el constructor.** Cada enlace creado por auto-bonding tiene `targetDist` incorrecto. Es la causa probable de que moléculas formadas interactivamente no tengan la geometría correcta.

2. **`melting_point_K` vs `melt_K` — mismatch de nombres.** La detección de fase nunca usa datos reales. Un grep simple lo confirma: el JSON dice `melt_K`, el código busca `melting_point_K`.

3. **`applyAtomicRepulsion()` es O(N²).** Con 100 átomos son 4,950 evaluaciones por frame. Duplicar o triplicar los átomos multiplica el costo cuadráticamente.

### Importante

4. **`window.getBondsVisibilityState` en `Bond.js`.** Acoplamiento con el DOM en una clase de dominio. Impide testing y hace frágil el sistema.

5. **`console.log` de debug en `PhysicsMode.js` línea 130.** Se ejecuta en producción en cada cambio de modo.

6. **`particlesPerElectron = 8` sin LOD.** En móvil, elementos pesados (Cf, U) generan cientos de partículas sin control.

7. **`_detectPhase()` usa `atoms[0]`.** En escenas mixtas da resultados incorrectos.

### Menor

8. **`createFallbackBonds()` en `MoleculeFragmentation.js` no se llama nunca.** Código muerto.

9. **`_idealAngles` usa `sim.atoms.indexOf(a)` — O(N).** Asignar un `id` incremental a los átomos y usar eso como clave es O(1) y trivial de implementar.

10. **`morse_De` idéntico para todos los tipos de enlace** excepto tres casos hardcodeados en `PhysicsModeManager`. Con `bond_energy_ev` en el JSON esto debería calcularse por par de elementos.

---

## 6. OPORTUNIDADES QUE NO ESTÁN EN EL CÓDIGO ACTUAL

**Hibridación como propiedad calculada.** Con `quantum_numbers` del JSON ya se puede determinar automáticamente si un elemento hace sp (lineal), sp² (trigonal), sp³ (tetraédrico). No hace falta hardcodear geometrías.

**Electronegatividad diferencial visual.** En enlaces polares, los electrones deberían estar desplazados hacia el átomo más electronegativo. Los datos de `electronegativity` están en el JSON. Visualmente sería muy informativo.

**Número de coordinación real.** El U tiene `max_bonds: 6` y geometría octaédrica. Cuando un U se enlaza a 6 átomos, el sistema debería reconocer automáticamente que está coordinativamente saturado y bloquear más enlaces.

**Colores de emisión por isótopo.** El `decay_chain` tiene `decay_mode` (alpha/beta/gamma). Cada modo tiene un color distinto. Una visualización del decaimiento con partículas coloreadas según el modo de decaimiento sería pedagógicamente poderosa y los datos ya están.
