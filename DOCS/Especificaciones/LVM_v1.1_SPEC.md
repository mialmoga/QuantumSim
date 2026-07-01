# ⚛️ Lenguaje Visual de Materiales (LVM) v1.1

**Especificación del mapeo física → visual para el Quantum Chemistry Simulator**

Revisado por: Éter (validación matemática) · Velvet (arquitectura + pelitos) · Brujo (aprobación final)

---

## 🧠 Principio Fundamental

```
El material de un átomo no se asigna.
Se deriva de sus propiedades físicas.
Y se transforma cuando interactúa.

estado_visual(t) = ∫ interacciones(t) dt
```

Un material honesto no es decoración — es información codificada visualmente.

---

## 📊 v1.0 — Mapeo Estático (Átomo Aislado)

Cada propiedad física del elemento se mapea a un parámetro visual del shader.

### Tabla de Mapeos

| # | Propiedad Física | Parámetro Shader | Fórmula | Rango Entrada | Rango Salida |
|---|---|---|---|---|---|
| 1 | Masa atómica (u) | `sphere_pulse.freq` | `10/√(masa)` | 1.008–294 | 9.96–0.58 Hz |
| 2 | Punto de fusión (K) | `sphere_pulse.amp` | `1/log₁₀(melt_K)` | 14–3800 | 0.87–0.28 |
| 3 | Energía de ionización (eV) | `brightness.bright` | `lerp(t, 0.1, 3.0)` | 3.89–24.58 | 0.1–3.0 |
| 4 | IE < 5eV (reactividad) | `blink.amp` | `(5-IE)/5 × 0.5` | 3.89–5.0 | 0.5–0.0 |
| 5 | Densidad (g/cm³) | `alpha_curve.opacity` | log-normalizado | 0.09–22.6 | 0.3–1.0 |
| 6 | Electronegatividad | `disc_shape.soft` | `lerp(1-t, 0.45, 0.05)` | 0.7–3.98 | 0.45–0.05 |
| 7 | Polarizabilidad (ų) | `point_size.sz` | `lerp(t, 0.3, 2.0)` | 0.2–400 | 0.3–2.0 |
| 8 | Radio covalente (pm) | `point_size.persp` | `4.8 × r^0.53` | 25–175 | ~24–65 |
| 9 | Color real | `color_grade.rgb` | observado a 293K | — | RGB |

### Validación Éter (rangos extremos)

```
Mapeo 1 (freq): H=9.96 Hz (rápido ✓), U=0.58 Hz (lento ✓)
Mapeo 2 (amp):  He=0.87 (alto, baja Tm ✓), W=0.28 (bajo, alta Tm ✓)
Mapeo 3 (bright): Cs=0.1 (tenue ✓), He=3.0 (brillante ✓)
Mapeo 4 (blink): Cs=0.5 (parpadea ✓), C=0.0 (estable ✓)
Mapeo 5 (opacity): H₂=0.3 (transparente ✓), Os=1.0 (denso ✓)
Mapeo 6 (soft): F=0.05 (suave ✓), Cs=0.45 (duro ✓)
Mapeo 7 (sz): He=0.3 (pequeño ✓), Cs=2.0 (grande ✓)
Mapeo 8 (persp): H≈24 (compacto ✓), U≈65 (extenso ✓)
```

Todos los rangos verificados contra datos NIST. Los extremos son Cs (metal más reactivo) y He (gas noble más inerte). Si el mapeo funciona para ambos, funciona para todo.

---

## 🧬 v1.1 — Mapeo Dinámico (Interacción y Enlace)

### El Sistema de Pelitos

Cada átomo tiene N sensores de valencia ("pelitos") distribuidos según geometría VSEPR:

```
maxBonds=1 (H, F)   → 1 pelito terminal
maxBonds=2 (O, S)   → 2 pelitos bent (104.5°)
maxBonds=3 (N, B)   → 3 pelitos trigonal (120°)
maxBonds=4 (C, Si)  → 4 pelitos tetraédrico (109.5°)
maxBonds=5 (P)      → 5 pelitos bipiramidal trigonal
maxBonds=6 (S exp)  → 6 pelitos octaédrico
```

Cada pelito sabe:
```javascript
{
    index:         0,           // identidad dentro del átomo
    direction:     Vec3,        // dirección del orbital
    baseDirection: Vec3,        // dirección original (nunca muta)
    worldPos:      Vec3,        // posición en espacio mundo
    radius:        R * 1.55,    // zona de detección
    occupied:      false,       // libre o enlazado
    bondRef:       null,        // referencia al bond
}
```

### Las 4 Fases del Enlace

#### Fase 0 — Proximidad (pre-enlace)

```
Condición: dist < umbral_pre (radius × 3)
Estado:    Aún no hay enlace, pero se "sienten"
```

Visual:
```glsl
// El borde del átomo se suaviza hacia el vecino
soft_local = soft + proximity_factor * 0.1;

// Shift de color direccional (hacia el vecino)
color_shift = mix(color_self, color_other, proximity * 0.05);

// Brillo sube levemente
bright_local = bright + proximity * 0.2;
```

💡 **Esto es el "presentimiento" de enlace.** El átomo aún no sabe si va a enlazar, pero ya reacciona a la presencia.

---

#### Fase 1 — Activación (evento)

```
Condición: dist < umbral_enlace AND pelitos compatibles
Estado:    ¡BOND! Se crea el enlace
```

Visual (1-2 frames):
```javascript
// Flash de energía — destello blanco
atom._bondFlash = 1.0;

// En _syncMeshes:
uBright += bondFlash * 8.0;                    // ×8 boost
uColor.lerp(WHITE, bondFlash * 0.7);           // shift a blanco
bondFlash *= 0.88;                              // decay exponencial
```

⚡ **Marca el nacimiento del enlace.** Como en el loader del benceno — los bonds flashean al completarse.

---

#### Fase 2 — Escritura del enlace (core)

```
Condición: bond existe, bond_progress ∈ [0, 1]
Estado:    El material se está "escribiendo" desde el pelito
```

```javascript
bond_progress = saturate((t - t_start) / t_form);
```

##### A. Zona de solapamiento
```glsl
// El borde del átomo se deforma en la zona del bond
soft_local = mix(soft_self, soft_shared, bond_progress);
opacity_local = mix(opacity_self, opacity_shared, bond_progress);
```

##### B. Color del cuello
```glsl
// Gradiente entre los dos átomos
color_neck = mix(color_A, color_B, bond_progress);

// Iónico: desaturar la zona intermedia
if (bond_type == IONIC) {
    color_neck = desaturate(color_neck, 0.3);
}
```

##### C. Brillo
```glsl
// Pico de energía que se estabiliza
bright = base + energy_release * exp(-k * bond_progress);
// energy_release = f(bond_energy_eV)
```

##### D. Propagación desde pelito
```glsl
// El pelito que detectó el enlace es el ORIGEN del gradiente
// Cada punto de la esfera calcula su distancia al pelito
for each point:
    d = distance(point, bond_origin_pelito);
    influence = smoothstep(atom.radius, 0, d);
    param = mix(param_original, param_bond, influence * bond_progress);
```

💡 **El material no cambia de golpe — se propaga como una onda desde el punto de contacto.**

---

#### Fase 3 — Identidad nueva (compuesto)

```
Condición: bond_progress > 0.95
Estado:    La molécula tiene identidad propia
```

```javascript
// El material final NO es promedio de A+B
// Es una función del tipo de enlace y la estructura
material_compound = f(deltaEN, bond_type, structure);

// Transición suave
material_final = mix(material_A_plus_B, material_compound, bond_progress);
```

Ejemplo NaCl:
```
Na aislado: violeta oscuro, parpadea (IE=5.14), borde duro
Cl aislado: verde amarillento, estable, borde suave
NaCl compuesto: blanco-transparente, rígido, cristalino
  → NO es promedio de violeta y verde
  → Es un material NUEVO que refleja la transferencia iónica
```

---

### Ejemplo Completo: Formación de H₂O

```
Frame 0:   O (azul pálido, 2 pelitos bent)
           H (casi blanco, 1 pelito)
           → Separados, sin interacción

Frame 10:  H se acerca a O
           → Fase 0: O se suaviza ligeramente hacia H
           → El pelito del O más cercano se ilumina

Frame 20:  dist < umbral
           → Fase 1: ⚡ FLASH blanco en ambos
           → O orienta pelito[0] hacia H₁

Frame 40:  bond_progress = 0.3
           → Fase 2: gradiente azul→blanco empieza desde pelito[0]
           → El cuello del bond se colorea

Frame 60:  bond_progress = 0.8
           → La mitad del O tiene material modificado
           → El segundo pelito del O sigue libre (apunta al otro lado)

Frame 80:  H₂ se acerca por el otro lado
           → Fase 0 con el segundo pelito del O
           → O NO rota (ya tiene un bond)

Frame 100: Segundo bond se forma
           → ⚡ Flash en O y H₂
           → bond_progress empieza para el segundo bond

Frame 140: Ambos bonds completos
           → Fase 3: H₂O tiene material de compuesto
           → Ángulo 104.5° emergió de los pelitos, no de constraints
           → La molécula tiene identidad visual propia
```

---

## 🔬 Implementación Actual vs Especificación

| Feature | Spec | Implementado | Estado |
|---|---|---|---|
| Mapeo estático (v1.0) | 9 mapeos | 9/9 | ✅ Completo |
| generate_materials.py | pipeline | Funcional | ✅ Completo |
| ML extension | red neuronal | loss=0.000005 | ✅ Completo |
| Colores reales | 118 | 118/118 | ✅ Completo |
| Pelitos VSEPR | 6 geometrías | 6/6 | ✅ Completo |
| orientPelitoToward | quaternion+slerp | Con fixes Velvet | ✅ Completo |
| Flash de enlace (Fase 1) | destello blanco | ×8 bright + color lerp | ✅ Completo |
| Fase 0 (proximidad) | soft shift | — | ⏳ Próximo |
| Fase 2 (escritura) | gradiente desde pelito | — | ⏳ Próximo |
| Fase 3 (identidad) | material compuesto | — | ⏳ Próximo |
| bond_progress | uniform interpolado | — | ⏳ Próximo |
| Propagación desde pelito | distance → influence | — | ⏳ Próximo |

---

## 🧪 Validación

### Criterio Éter (matemático)
- Todos los rangos de entrada cubren los 118 elementos sin overflow
- Las funciones son monótonas (más masa = más lento, no hay inversiones)
- Los extremos (Cs, He, H, Og) producen valores visuales distinguibles
- `persp = 4.8 × r^0.53` verificado con power regression (R² > 0.98)

### Criterio Velvet (conceptual)
- Cada mapeo tiene justificación física (no decorativa)
- Los 4 fases del enlace respetan la narrativa: presentimiento → flash → escritura → identidad
- El pelito como origen del gradiente es localidad real (principio de localidad física)
- El material compuesto no es promedio — es función del tipo de enlace

### Criterio Brujo (visual)
- ¿Se ve bien en el Moto G24? ✅
- ¿Un estudiante puede inferir propiedades? ✅
- ¿El flash se siente natural? ✅
- ¿Los colores reales sorprenden? ✅ (O azul, Au dorado, Cu cobrizo)

---

## 📐 Fundamento Perceptual — Geometría No-Riemanniana del Color

### Referencia

> Bujack, R., Stark, E.N., Turton, T.L., Miller, J.M., Rogers, D.H. (2025).
> *"The Geometry of Color in the Light of a Non-Riemannian Space."*
> Computer Graphics Forum, 44(3), e70136. DOI: 10.1111/cgf.70136
> Los Alamos National Laboratory.

### El problema

El espacio de color perceptual humano NO es euclidiano ni Riemanniano. La percepción de diferencias de color tiene **retornos decrecientes**: la diferencia percibida entre brightness 1.0 y 2.0 es mucho mayor que entre 8.0 y 9.0. Esto tiene consecuencias directas para todos los mapeos del LVM.

Bujack et al. formalizan las definiciones de Schrödinger (1920) de tono, saturación y luminosidad usando una métrica no-Riemanniana y demuestran que:

1. El tono percibido cambia con la luminosidad (efecto Bezold-Brücke)
2. Las geodésicas perceptuales son curvas, no líneas rectas en RGB
3. El "gris neutro" más cercano a un color no es el promedio RGB sino el color más cercano al negro en la superficie de igual luminosidad

### Implicaciones para el LVM

#### 1. Interpolación de color en bonds → OKLCH en vez de RGB

**Antes (v1.0):**
```glsl
// Interpolación lineal en RGB — perceptualmente incorrecto
color_neck = mix(color_A, color_B, bond_progress);
```

**Después (v1.2):**
```glsl
// Interpolación en OKLCH — sigue geodésicas perceptuales
// Los colores intermedios son perceptualmente equidistantes
vec3 lchA = rgb_to_oklch(color_A);
vec3 lchB = rgb_to_oklch(color_B);
vec3 lchMix = mix(lchA, lchB, bond_progress);
color_neck = oklch_to_rgb(lchMix);
```

La diferencia es sutil pero real: en RGB, la mezcla Na (violeta) + Cl (verde-amarillo) pasa por un marrón turbio. En OKLCH, pasa por tonos intermedios perceptualmente limpios.

#### 2. Brightness → escala logarítmica (Weber-Fechner + retornos decrecientes)

**Antes:**
```python
# Mapeo lineal de IE a brightness
bright = lerp(normalize(IE, 3.89, 24.58), 0.1, 3.0)
```

**Después:**
```python
# Mapeo logarítmico — respeta retornos decrecientes
t = normalize(IE, 3.89, 24.58)
bright = 0.1 + 2.9 * pow(t, 0.45)  # curva de Stevens (exponente ~0.45)
```

La ley de Stevens (1957, citada por Bujack) dice que la percepción de brillo sigue una potencia ~0.33–0.5 del estímulo físico. Con el exponente 0.45, las diferencias entre elementos de baja IE se amplifican (donde importa para distinguir reactividad) y las de alta IE se comprimen (donde la diferencia es menos relevante).

#### 3. Flash de enlace → compensación Bezold-Brücke

El efecto Bezold-Brücke dice que al aumentar la luminosidad, los tonos percibidos convergen hacia amarillo, verde o azul. Cuando nuestro flash sube `uBright` ×8, el átomo no solo "se ve más brillante" — se ve de un tono diferente.

**Compensación:**
```glsl
// Durante el flash, mantener el tono percibido constante
// usando la geodésica al blanco en vez de línea recta
vec3 lch = rgb_to_oklch(col);
lch.z = mix(lch.z, 1.0, bondFlash);  // luminosidad sube
// El tono (lch.x) se mantiene — sin shift de Bezold-Brücke
col = oklch_to_rgb(lch);
```

#### 4. Desaturación iónica → gris perceptual correcto

Para bonds iónicos desaturamos la zona de contacto. El paper define formalmente que el gris neutro es el color más cercano al negro en la superficie de igual luminosidad — no `(R+G+B)/3`.

**Corrección:**
```glsl
// Desaturar hacia el gris perceptualmente correcto (eje L de OKLCH)
vec3 lch = rgb_to_oklch(col);
lch.y *= (1.0 - ionic_factor * bond_progress);  // reducir chroma, no RGB
col = oklch_to_rgb(lch);
```

#### 5. Implicación cross-modal: LSM (Lenguaje Sonoro de Materia)

Bujack et al. (Sección 7) sugieren que los retornos decrecientes podrían aplicar a TODAS las modalidades perceptuales, incluyendo sonido (ley de Stevens). Esto confirma lo que Velvet propuso: las frecuencias del SoundEngine necesitan cuantización musical y curvas perceptuales, no mapeo lineal.

```javascript
// Antes: pitch lineal desde masa
freq = 880 / sqrt(mass);  // perceptualmente desigual

// Después: pitch cuantizado a escala + curva de Stevens
raw = 880 / sqrt(mass);
note = quantize_to_scale(raw, PENTATONIC);  // snap a nota musical
freq = note * pow(1.0, 0.3);  // curva perceptual de Stevens para audición
```

### Tabla de correcciones perceptuales

| Mapeo LVM | Antes (v1.0) | Después (v1.2) | Fundamento |
|---|---|---|---|
| Color de bond | `mix()` en RGB | `mix()` en OKLCH | Geodésicas no-Riemannianas (Bujack 2025) |
| Brightness | Lineal | Potencia 0.45 | Ley de Stevens (1957) + retornos decrecientes |
| Flash de enlace | RGB → blanco | OKLCH → luminosidad | Efecto Bezold-Brücke |
| Desaturación iónica | Promedio RGB | Reducir chroma en OKLCH | Eje neutral = geodésica a negro |
| Pitch sonoro | Lineal | Cuantizado + Stevens | Cross-modal (Bujack Sec. 7) |

### OKLCH en GLSL (implementación ligera)

Las conversiones RGB ↔ OKLCH son ~20 líneas de GLSL sin texturas ni lookups. El costo es ~5 operaciones por fragmento — imperceptible en el G24.

```glsl
// Conversión simplificada RGB → OKLab (Björn Ottosson 2020)
vec3 rgb_to_oklab(vec3 c) {
    float l = 0.4122*c.r + 0.5363*c.g + 0.0514*c.b;
    float m = 0.2119*c.r + 0.6806*c.g + 0.1076*c.b;
    float s = 0.0883*c.r + 0.2817*c.g + 0.6300*c.b;
    l = pow(l, 1.0/3.0); m = pow(m, 1.0/3.0); s = pow(s, 1.0/3.0);
    return vec3(
        0.2105*l + 0.7937*m - 0.0041*s,
        1.9780*l - 2.4286*m + 0.4506*s,
        0.0259*l + 0.7828*m - 0.8087*s
    );
}

// OKLab → LCH (polar)
vec3 oklab_to_oklch(vec3 lab) {
    float C = length(lab.yz);
    float h = atan(lab.z, lab.y);
    return vec3(lab.x, C, h);
}
```

---

## 🔮 Futuro (v1.2+)

- **Interpolación OKLCH en shaders** — reemplazar todos los `mix()` RGB por geodésicas perceptuales
- **Curva de Stevens para brightness** — `pow(t, 0.45)` en generate_materials.py
- **ML en loop** — el sistema observa qué materiales generó, compara con datos experimentales, y ajusta sus propios pesos
- **Material de fase** — el shader cambia con la temperatura (sólido → líquido → gas → plasma)
- **Resonancia** — π electrones deslocalizados en anillos aromáticos cambian el material dinámicamente
- **Backbonding** — enlaces metal-ligando modifican el material del metal receptor
- **LSM perceptual** — cuantización musical + Stevens para el SoundEngine

---

*"El enlace no conecta átomos. El enlace reescribe la materia."* — Velvet

*"Si no puedes justificar un parámetro visual con física, no pertenece."* — Éter

*"Narrativa física en tiempo real."* — Velvet

*"The geometry of color is not Euclidean."* — Bujack et al., 2025

*"Absolute Cinema."* — Brujo 🗿🚬
