# QCS ROADMAP — VALIDACIÓN v3
*Actualizado tras sesión: Metátesis, Disociación Térmica, Temperatura, UX fixes*

---

## ✅ FASE 0: LIMPIEZA — COMPLETA

---

## ✅ FASE 1: ORBITAL CACHE + PERFORMANCE — COMPLETA (sin OIT)

### Completado:
- OrbitalCache + atlas + molecular baking
- QuantumRendererPool: LOD dinámico 3 estados
- Toggle LOD en settings (🔬 LOD Orbitales)
- Núcleo visual honesto: rMax 4wu → 1wu, size 10 → 3
- Gap orbital dinámico: min(rNucleoWU + 0.3, minOrbRmax * 0.25)
- pauseLoop() / resumeLoop() en QuantumRenderer
- clear() antes de loadElement() — sin acumulación de materiales

### Pendiente:
- OIT (transparencia ordenada) — no bloqueante

---

## ✅ FASE 2: QUÍMICA COMPLETA — COMPLETA

### 2.1 bond_progress ✅
- Float 0→1, fade in/out, snapFormed(), _framesAlive

### 2.2 Potencial de Morse ✅
- F = 2·De·a·(1-e^(-ax))·e^(-ax)
- De desde bond_energy_ev (media geométrica, EV_TO_GAME=300)
- get De() alias en Bond.js
- Ruptura natural: re + 4/a

### 2.3 Fuerzas angulares VSEPR (Éter) ✅
- Gradiente de energía angular puro — reemplaza XPBD
- Lee ideal_bond_angle de elementData.reactivity
- Guard len < 5pm, dt*60, deadzone 0.01rad

### 2.4 Pauli inter-molecular ✅
- Pares enlazados excluidos

### 2.5 VSEPR pelitos ✅
- orientPelitoToward() multi-bond best-fit
- _orientPelitosOnly() en ambos modos
- Guard baricentro cero

### 2.6 MoleculeFactory ✅
- equilibrium: actual_distance
- snapFormed()
- moleculas.json: 14 H corregidos

### 2.7 Metátesis ✅ NUEVO
- _detectMetathesis() en World.js — O(bonds²), una por frame
- Fade out bonds viejos, fade in bonds nuevos
- _pendingMetathesis queue
- Toggle: metathesisEnabled + checkbox UI

### 2.8 Disociación Térmica ✅ NUEVO
- checkThermalDissociation(kBT) en Bond.js
- P = exp(-De_eV / kBT) por frame — Boltzmann puro
- Guard ratio > 30
- _applyThermalDissociation() en World.js
- setTemperature(K) setter — PhysicsPanel lo llama cada frame
- Toggle: thermalDissociation + checkbox UI

---

## ✅ FASE 3.5: QV PANEL — COMPLETA

- Sphere toggle OFF por defecto
- Cargar perfil JSON + _elementProfiles map
- Shader stagger (uno por rAF)
- LOD toggle global
- pauseLoop/resumeLoop — cero GPU cuando cerrado

---

## 🔄 FASE 3: EXPRESIÓN — EN PROGRESO

### Sistema de Temperatura ✅ MEJORADO
- _applyThermalForce() reemplaza _blendVelocityToTemp()
- EMA α=0.05 en medición de _tempCurrent
- setTemperature(K) propaga T al World cada frame
- Toggles independientes por superficie (OFF por defecto):
  floorTempToggle, ceilingTempToggle, sphereTempToggle
- _tmpSpherePos pre-alloc

### Pendiente:
- LVM dinámico, LSM extendido, OIT

---

## UX ✅ FIXES ESTA SESIÓN

- Zoom involuntario al soltar touch: _wasRotating flag
  re-anclar target solo en rotación (state===0)
- Tutorial hint: 30s primera sesión, fade 1.5s, localStorage
- HUD temperatura: top-left, z-index 90

---

## ⚙️ PERFORMANCE

### Completado:
- Hash numérico SpatialHashGrid (sin string allocation)
- _moleculeCount reactivo
- Panel QV pausado cuando cerrado
- _applyThermalForce sin velocity mutation directa
- Pre-allocs en hot paths (15 vectores módulo)

### Guardado para después:
- Physics Web Worker (PhysicsWorker.js + WorldBridge.js)
  Revertido — sync issues. Retomar con sleep/wake.

### Pendiente:
- Dormir átomos inactivos

---

## 📊 ESTADO GLOBAL

| Fase | Nombre | Estado |
|------|--------|--------|
| 0 | Limpieza | COMPLETA |
| 1 | Orbital Cache + LOD | COMPLETA (sin OIT) |
| 2 | Química Completa | COMPLETA |
| 3 | Expresión | 60% |
| 3.5 | QV Panel | COMPLETA |
| 4 | Plataforma | PENDIENTE |
| 5 | Vida / AMI.GO | PENDIENTE |

---

## PRÓXIMAS PRIORIDADES

1. Dormir átomos — mayor impacto en performance, base para el Worker
2. OIT — transparencia correcta para orbitales superpuestos
3. Physics Worker — retomar con sleep/wake implementado
4. LVM dinámico — materiales en bonds con propagación
