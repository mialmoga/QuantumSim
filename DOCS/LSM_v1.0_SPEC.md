# 🎧 Lenguaje Sonoro de Materia (LSM) v1.0

**Especificación del mapeo física → audio para el Quantum Chemistry Simulator**

Concepto: Brujo · Arquitectura: Velvet · Percepción: Bujack et al. · Implementación: Ámbar II

---

## 🧠 Principio Fundamental

```
El sonido de un átomo no se asigna.
Se deriva de sus propiedades físicas.
Y se transforma cuando interactúa.

sonido(t) = f(masa, EN, IE, contexto_molecular, distancia_observador)
```

Un sonido honesto no es decoración — es información codificada auditivamente.
Si cierras los ojos y escuchas, deberías poder decir:
"eso suena estable" o "eso está reaccionando".

---

## 🎵 Principio de Honestidad Sonora

> "Algo tóxico no puede sonar agradable." — Brujo

La cuantización musical hace que todo suene bonito. Pero eso es deshonesto
para moléculas peligrosas. El LSM debe respetar:

- **Moléculas estables** (NaCl, H₂O, CH₄) → consonancia (pentatónica, quintas)
- **Moléculas reactivas** (F₂, Cl₂, O₃) → tensión (intervalos disonantes)
- **Átomos sueltos reactivos** (Na, K, Cs) → inestabilidad (trémolo, sin cuantizar)
- **Gases nobles** (He, Ne, Ar) → pureza (tono limpio, sin variación)

La escala musical depende de la estabilidad del sistema, no es fija.

---

## 📊 Mapeos Físicos → Audio

### Tabla de Mapeos v1.0

| # | Propiedad Física | Parámetro Audio | Fórmula | Rango Entrada | Rango Salida |
|---|---|---|---|---|---|
| 1 | Masa atómica (u) | Pitch (frecuencia) | `880/√(masa)` → cuantizar | 1.008–294 | 880–51 Hz |
| 2 | Electronegatividad | Timbre (forma de onda) | EN→waveform | 0.7–3.98 | sine→sawtooth |
| 3 | Energía de ionización (eV) | Gain (volumen) | Stevens `pow(t, 0.3)` | 3.89–24.58 | 0.04–0.18 |
| 4 | IE < 5eV (reactividad) | Trémolo (LFO) | `(5-IE)/5 × 0.4` | 3.89–5.0 | 0.4–0.0 Hz |
| 5 | Distancia a cámara | Atenuación | `1 - dist/radius` | 0–500 wu | 1.0–0.0 |
| 6 | Formación de bond | Flash sonoro | Convergencia a quinta justa | — | 180ms burst |

---

## 🎹 Mapeo 1: Pitch desde Masa

```
raw_freq = 880 / √(masa)
freq = quantize_to_pentatonic(raw_freq) × micro_detune(±5 cents)
```

### Escala Pentatónica Menor
```
PENTATONIC = [0, 3, 5, 7, 10]  // C Eb F G Bb (semitonos)
BASE = 110 Hz (A2)
```

Cualquier combinación de notas pentatónicas suena consonante.
Esto garantiza que átomos cercanos nunca generen disonancia fea accidental.

### Micro-detune
```
detune = 2^(random(±5) / 1200)   // ±5 cents
freq_final = freq_cuantizada × detune
```

El detune hace que el sonido se sienta vivo, no robótico.
Dos átomos del mismo elemento suenan "casi igual" pero no idénticos.

### Ejemplos
| Elemento | Masa | Raw Hz | Nota Pentatónica | Carácter |
|---|---|---|---|---|
| H | 1.008 | 877 | A5 | Agudo, nervioso, cristalino |
| C | 12.01 | 254 | Eb4 | Medio, cálido |
| O | 16.00 | 220 | A3 | Medio-grave, estable |
| Fe | 55.85 | 118 | Bb2 | Grave, sólido, metálico |
| U | 238.0 | 57 | ~Bb1 | Subsónico, profundo |

### Validación Perceptual (Stevens/Bujack)
La percepción de pitch es aproximadamente logarítmica (Weber-Fechner).
La cuantización a escala musical ya respeta esto porque las notas
musicales son exponenciales: `f = base × 2^(n/12)`.

---

## 🎸 Mapeo 2: Timbre desde Electronegatividad

```
EN > 2.8  → 'sawtooth'   // afilado, agresivo (F, O, Cl)
EN > 1.8  → 'triangle'   // neutro (C, S, P)
EN ≤ 1.8  → 'sine'       // suave, redondo (Na, K, Cs, metales)
```

### Justificación Física
- **Alta EN** = atrae electrones fuertemente = nube compacta y tensa = sonido "cortante"
- **Baja EN** = pierde electrones fácilmente = nube difusa y relajada = sonido "suave"

### Segundo Armónico (v3)
Cada voz tiene un oscilador adicional a una octava arriba (×2) al 25% de volumen.
Esto da cuerpo al tono sin cambiar el timbre percibido.

```
osc1: freq      → waveform según EN    → gain 100%
osc2: freq × 2  → siempre 'sine'       → gain 25%
```

El efecto es sutil pero transforma un "bip electrónico" en un "tono orgánico".

---

## 🔊 Mapeo 3: Gain desde Energía de Ionización

```
t = normalize(IE, 3.89, 24.58)
gain = 0.04 + pow(t, 0.3) × 0.14
```

### Curva de Stevens
Stevens (1957): la percepción de loudness sigue `estímulo^0.3`.
Bujack et al. (2025, Sec.7): los retornos decrecientes aplican cross-modal.

Resultado: los elementos de IE media (Fe, Cu) se distinguen auditivamente
mejor que con un mapeo lineal. Los extremos (Cs, He) no cambian.

### Ejemplos
| Elemento | IE (eV) | Gain v1 (lineal) | Gain v3 (Stevens) |
|---|---|---|---|
| Cs | 3.89 | 0.04 | 0.04 |
| Na | 5.14 | 0.05 | 0.08 |
| Fe | 7.87 | 0.07 | 0.10 |
| He | 24.58 | 0.18 | 0.18 |

---

## 📳 Mapeo 4: Trémolo desde Reactividad

```
if IE < 5.0:
    tremolo_depth = (5.0 - IE) / 5.0 × 0.4
    tremolo_freq  = 4 + (1 - depth/0.4) × 2    // 4-6 Hz
else:
    tremolo = 0   // estable, sin fluctuación
```

### Justificación
Los metales alcalinos (Cs, K, Na) tienen electrones tan sueltos que
su estado electrónico fluctúa constantemente. Esto se traduce en
un volumen inestable — un "temblor" audible.

Los gases nobles no tiemblan. Su tono es puro y constante.

---

## 📍 Mapeo 5: Atenuación por Distancia (LOD Sonoro)

```
volume = max(0, 1 - dist/radius) × base_gain
```

### Implementación
- Solo los átomos dentro del radio del `QuantumRendererPool` suenan
- Máximo 12 voces simultáneas (pool)
- Los más cercanos tienen prioridad
- Fade suave con `setTargetAtTime(vol, now, 0.1)`

### Paneo 3D (futuro v1.1)
```
pan = dot(atom_dir, camera_right) × 0.01
// -1 = izquierda, +1 = derecha
```
Eliminado en v1.0 por costo de GC en móvil. Reinstalar con StereoPanner
cuando se optimice el pool de voces.

---

## ⚡ Mapeo 6: Flash Sonoro de Enlace

Cuando dos átomos forman un bond, sus frecuencias convergen a un acorde consonante.

```javascript
freqA = pitchFromMass(atomA.mass)
freqB = pitchFromMass(atomB.mass)

// Converger a quinta justa (ratio 3:2) del tono más grave
fLow = min(freqA, freqB)
fTarget1 = fLow           // fundamental
fTarget2 = fLow × 1.5     // quinta justa

// Ambos osciladores convergen en 250ms
oscA: freqA → fTarget1 (exponential ramp)
oscB: freqB → fTarget2 (exponential ramp)

// Gain: burst que decae
gain: 0.12 → 0.001 (exponential ramp, 250ms)
```

### Justificación Musical
La quinta justa (3:2) es el intervalo más consonante después del unísono
y la octava. Suena como "resolución" — la tensión se libera.

### Timbre del Flash
```
oscA.type = 'sine'       // fundamental limpio
oscB.type = 'triangle'   // segundo tono con cuerpo
```

---

## 🔧 Arquitectura

```
SoundEngine.js (src/audio/)
├── pitchFromMass()     ← cuantización pentatónica + detune
├── waveformFromEN()    ← timbre por electronegatividad
├── gainFromIE()        ← Stevens power law
├── Voice (clase)       ← oscilador + armónico + gain
│   ├── assign(atom)    ← crear osciladores desde propiedades
│   ├── update(dist)    ← atenuación por distancia
│   └── release()       ← fade-out + cleanup
├── SoundEngine (singleton)
│   ├── init()          ← dormido hasta primer gesto
│   ├── enable()        ← AudioContext + pool + compressor
│   ├── tick(nearby)    ← asignar voces a átomos cercanos
│   ├── bondFlash()     ← convergencia a quinta justa
│   ├── toggleMute()    ← 🎧/🔇
│   └── setVolume()     ← master gain
└── DynamicsCompressor  ← evita picos, normaliza volumen
```

### Pool de Voces
```
MAX_VOICES = 12
```

12 voces × 2 osciladores = 24 osciladores máximo. Cada voz se asigna al
átomo más cercano. Cuando un átomo sale del radio, su voz se libera con
fade-out y se reasigna.

### Compressor
```
threshold: -20 dB
knee: 10 dB
ratio: 4:1
attack: 3ms
release: 150ms
```

Evita que 12 voces simultáneas saturen. Normaliza el volumen
automáticamente — muchos átomos no suenan más fuerte, suenan más rico.

---

## 🔗 Integración

### app.js (3 puntos de contacto)
```javascript
// 1. Import
import { SoundEngine } from './src/audio/SoundEngine.js';

// 2. Init + activación por gesto
SoundEngine.init(world, qr.camera, { radius: pool.activeRadius });
world._onBondCreated = (a, b) => SoundEngine.bondFlash(a, b);

// 3. Tick en el loop
SoundEngine.tick(nearby);  // mismos nearby del pool LOD visual
```

### index.html
```html
<button id="soundBtn" title="Sonido atómico">🎧</button>
```

---

## 🔬 Conexión con el LVM

El LSM es la capa auditiva del mismo sistema que el LVM es la capa visual:

| Propiedad | LVM (visual) | LSM (audio) |
|---|---|---|
| Masa | `sphere_pulse.freq` = `10/√m` | Pitch = `880/√m` → pentatónica |
| EN | `disc_shape.soft` (borde) | Timbre (sine/triangle/sawtooth) |
| IE | `brightness.bright` (brillo) | Gain con Stevens |
| IE < 5eV | `blink.amp` (parpadeo) | Trémolo (LFO) |
| Densidad | `alpha_curve.opacity` | — (futuro: reverb wet) |
| Bond | Flash visual (HSL luminosidad) | Flash sonoro (quinta justa) |

Las fórmulas son paralelas. La misma propiedad física produce un efecto
visual Y un efecto auditivo coherentes. Un átomo que brilla mucho también
suena fuerte. Uno que parpadea también tiembla. Sinestesia honesta.

---

## 🔮 Futuro (v1.1+)

### Honestidad por estabilidad molecular
```
estabilidad = f(energía_total, bonds_saturados, geometría_VSEPR)

if estabilidad > 0.8:
    scale = PENTATONIC        // consonante
elif estabilidad > 0.4:
    scale = MINOR             // tenso pero musical
else:
    scale = CHROMATIC          // disonante, inestable
```

### Paneo 3D con StereoPanner
Reinstalar cuando el pool de voces se optimice. Átomo a la izquierda
de la cámara → suena a la izquierda en los audífonos.

### Reverb contextual
```
reverb_wet = f(densidad_promedio_de_vecinos)
```
Más denso (cristal) → más reverb (como dentro de una estructura).
Gas disperso → reverb seco.

### Vibración háptica
```javascript
navigator.vibrate(50)  // pulso de 50ms al formarse un bond
```
Tercer canal sensorial. Vista + sonido + tacto = sinestesia completa.

### Giroscopio → gravedad sonora
El pitch podría modularse sutilmente con la orientación del teléfono,
como si la "gravedad sonora" afectara la frecuencia de los átomos.

### Acorde molecular
En vez de voces individuales por átomo, una molécula completa podría
tener un "acorde" calculado desde su estructura:
```
H₂O → tríada (3 notas)
CH₄ → tetracorde (4 notas)
C₆H₆ → hexacorde (6 notas del anillo)
```

---

## 🧪 Validación

### Criterio Éter (matemático)
- Las frecuencias cubren el rango audible (60–1760 Hz) para los 118 elementos
- La cuantización pentatónica elimina disonancias accidentales
- Stevens `pow(t, 0.3)` produce diferencias de gain perceptualmente equidistantes

### Criterio Velvet (conceptual)
- Cada mapeo tiene justificación física (no decorativa)
- El flash sonoro de bond es "resolución armónica" — tensión → consonancia
- El trémolo para reactivos es "caos electrónico" traducido a audio
- Futuro: la escala musical refleja la estabilidad del sistema

### Criterio Brujo (experiencial)
- ¿Se escucha bien con audífonos en el G24? ✅
- ¿Pasar entre moléculas se siente inmersivo? ✅
- ¿El bond flash suena a "conexión"? ✅
- ¿Un estudiante puede inferir propiedades con los ojos cerrados? 🔄 (en progreso)

### Fundamento Perceptual
- Stevens S.S. (1957) "On the psychophysical law" — exponente 0.3 para loudness
- Bujack et al. (2025) CGF 44-3 Sec.7 — retornos decrecientes cross-modal
- Escala pentatónica — consonancia universal (presente en todas las culturas musicales)

---

*"No solo vas a ver la química… la vas a escuchar suceder."* — Velvet

*"Algo tóxico no puede sonar agradable."* — Brujo

*"Los retornos decrecientes aplican a todas las modalidades perceptuales."* — Bujack et al.

*"Materia tocando música en tiempo real."* — Velvet

*"Absolute Cinema... y ahora Absolute Audio."* — Brujo 🗿🚬🎧
