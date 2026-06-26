# ShaderML — Guía de implementación exacta
## Dónde va cada cosa y por qué

---

## El flujo completo

```
elementData (JSON) 
    → ShaderML.extractFeatures()   [22 features]
    → ShaderML.inferParams()       [forward pass, ~0.1ms]
    → ShaderML.buildPipeline()     [vector → nodos ShaderLab]
    → compilePipeline()            [nodos → GLSL]
    → THREE.ShaderMaterial         [en GPU]
```

---

## 1. Atom.js — Fallback inteligente con ML

**Dónde:** `Atom._createMaterial()` — ya existe, línea 259.
**Cuándo:** al crear el átomo si `MaterialLibrary` no tiene preset manual.

El flujo actual es:
```
preset manual → fallback genérico (blanco sin personalidad)
```

Con ML queda:
```
preset manual → ML inferido → fallback genérico de emergencia
```

**Patch exacto en `_createMaterial()`:**

```js
// Atom.js — _createMaterial() — después de intentar MaterialLibrary
// (línea ~265, después del bloque if (preset?.vert && preset?.frag))

async _createMaterial(r_pm = 100) {
    const uniforms = _makeUniforms(this._color, r_pm);

    // 1. Preset manual del ShaderLab (prioridad máxima)
    const matName = this.meta?.material || null;
    const group   = this.meta?.group    || null;
    const preset  = await MaterialLibrary.getForElement(matName, group);

    if (preset?.vert && preset?.frag) {
        console.log(`[Atom #${this.id}] ${this.symbol} ← preset manual: ${preset.meta?.name}`);
        return this._buildShaderMat(uniforms, preset.vert, preset.frag);
    }

    // 2. ★ NUEVO — Preset ML inferido desde propiedades del elemento
    if (this.elementData && window.ShaderML) {
        try {
            const pipeline       = window.ShaderML.generate(this.elementData);
            const { vert, frag } = compilePipeline(pipeline, 'sphere');
            console.log(`[Atom #${this.id}] ${this.symbol} ← ML generado`);
            return this._buildShaderMat(uniforms, vert, frag);
        } catch (e) {
            console.warn(`[Atom #${this.id}] ML falló, usando fallback:`, e.message);
        }
    }

    // 3. Fallback genérico (sin cambios)
    console.warn(`[Atom #${this.id}] ${this.symbol} — fallback genérico`);
    return new THREE.ShaderMaterial({
        uniforms,
        vertexShader:   FALLBACK_VERT,
        fragmentShader: FALLBACK_FRAG,
        transparent: true, depthWrite: false, depthTest: false, toneMapped: false,
    });
}

// Helper para no repetir el bloque de ShaderMaterial + inyección de uSelected
_buildShaderMat(uniforms, vert, frag) {
    const fragWithSel = frag
        .replace('void main(){', 'uniform float uSelected;\nvoid main(){')
        .replace('gl_FragColor=vec4(col,',
                 'col=mix(col,vec3(0.3,0.75,1.0),uSelected*0.5);gl_FragColor=vec4(col,');
    return new THREE.ShaderMaterial({
        uniforms,
        vertexShader:   vert,
        fragmentShader: fragWithSel,
        transparent: true, depthWrite: false, depthTest: false, toneMapped: false,
    });
}
```

**Notas:**
- `compilePipeline` viene del mismo import que ya usa el ShaderLab.
- `window.ShaderML` es el módulo generado. Usar window es la forma más simple
  de evitar imports circulares. Si prefieres import directo, hazlo al tope del archivo.
- El try/catch garantiza que el ML nunca rompe el átomo.

---

## 2. Bond.js — Material del cuello generado por ML

**Dónde:** `Bond._createMaterial()` — línea 283.
**Cuándo:** al crear el enlace.

El `Bond` actual tiene un `MeshStandardMaterial` plano por tipo.
Con ML, el material del cilindro se infiere del PAR de elementos.

**Patch exacto en `Bond._createMaterial()`:**

```js
// Bond.js — _createMaterial() — reemplazar el método completo

_createMaterial() {
    // 1. ★ Material ML inferido del par de elementos
    if (window.ShaderML && this.atomA.elementData && this.atomB.elementData) {
        try {
            const pipeline = window.ShaderML.generateBondMaterial(
                this.atomA.elementData,
                this.atomB.elementData
            );
            const { vert, frag } = compilePipeline(pipeline, 'sphere');

            // Uniforms del cuello — mezcla de colores de ambos átomos
            const colorA = new THREE.Color(this.atomA._color ?? 0xffffff);
            const colorB = new THREE.Color(this.atomB._color ?? 0xffffff);
            const mixed  = colorA.clone().lerp(colorB, 0.5);

            const uScale = 200 * Math.min(window.devicePixelRatio || 1, 2);

            return new THREE.ShaderMaterial({
                uniforms: {
                    uTime:    { value: 0 },
                    uScale:   { value: uScale },
                    uLevel:   { value: 1.0 },
                    uPmScale: { value: 1.0 },
                    uSpeed:   { value: 0.8 },
                    uAmp:     { value: 0.12 },
                    uSize:    { value: 1.5 },
                    uColor:   { value: mixed },
                    uBright:  { value: 1.8 },
                    uEdge:    { value: 0.18 },
                    uLodFade: { value: 1.0 },
                },
                vertexShader:   vert,
                fragmentShader: frag,
                transparent: true, depthWrite: false,
                depthTest: false, toneMapped: false,
            });
        } catch (e) {
            console.warn(`[Bond #${this.id}] ML material falló:`, e.message);
        }
    }

    // 2. Fallback: MeshStandardMaterial por tipo (igual que antes)
    const configs = {
        covalent: { color: 0xffffff, metalness: 0.0, roughness: 0.5, opacity: 1.0 },
        ionic:    { color: 0xffdd88, metalness: 0.0, roughness: 0.6, opacity: 0.9 },
        metallic: { color: 0xaaddff, metalness: 0.8, roughness: 0.2, opacity: 0.7 },
        vdw:      { color: 0x8888ff, metalness: 0.0, roughness: 0.8, opacity: 0.4 },
    };
    const cfg = configs[this.type] ?? configs.covalent;
    return new THREE.MeshStandardMaterial({
        color: cfg.color, metalness: cfg.metalness,
        roughness: cfg.roughness,
        transparent: cfg.opacity < 1.0, opacity: cfg.opacity,
    });
}
```

**Notas:**
- El Bond usa `CylinderGeometry`, no `THREE.Points`. El ShaderLab fue diseñado
  para Points. Tienes dos opciones:
  a) **Cambiar el cilindro por un tubo de Points** (recomendado para consistencia visual).
  b) **Dejar el cilindro con MeshStandard** y usar ML solo para el color/metalness
     extrayendo los parámetros del resultado.
- Si quieres opción b), la función sería más simple:

```js
// Opción b: extraer solo color y brillo del ML para el cilindro
_createMaterialFromML() {
    if (!window.ShaderML || !this.atomA.elementData) return null;
    const pipeline = window.ShaderML.generateBondMaterial(
        this.atomA.elementData, this.atomB.elementData
    );
    // Extraer color_grade del pipeline para colorear el cilindro
    const cg = pipeline.find(n => n.key === 'color_grade')?.params;
    const br = pipeline.find(n => n.key === 'brightness')?.params;
    if (!cg) return null;

    const colorA = new THREE.Color(this.atomA._color ?? 0xffffff);
    colorA.r *= cg.r; colorA.g *= cg.g; colorA.b *= cg.b;

    const isIonic    = this.type === 'ionic';
    const isMetallic = this.type === 'metallic';
    return new THREE.MeshStandardMaterial({
        color:       colorA,
        metalness:   isMetallic ? 0.8 : 0.1,
        roughness:   isIonic    ? 0.3 : 0.5,
        emissive:    colorA.clone().multiplyScalar(0.15),
        transparent: true,
        opacity:     br?.base ?? 0.85,
    });
}
```

---

## 3. World.js — Actualizar uTime en el loop

**Dónde:** `World._syncMeshes()` — línea 512.
**Por qué:** el ShaderLab usa `uTime` para animaciones. Sin actualizarlo, 
los materiales ML estarán congelados.

```js
// World.js — _syncMeshes() — agregar tick de uTime

_syncMeshes() {
    const t = this.clock.getElapsedTime(); // ★ tiempo acumulado

    for (const atom of this.atoms.values()) {
        atom.syncMesh();
        if (atom.sphereMesh) atom.sphereMesh.position.copy(atom.position);

        // ★ Tick uTime en el material del átomo (necesario para ShaderLab)
        const u = atom.mesh?.material?.uniforms;
        if (u?.uTime) u.uTime.value = t;
    }

    for (const bond of this.bonds.values()) {
        bond.updateMesh();

        // ★ Tick uTime en el material del bond si es ShaderMaterial ML
        const u = bond.mesh?.material?.uniforms;
        if (u?.uTime) u.uTime.value = t;
    }
}
```

---

## 4. World.js — Registrar ShaderML al init

**Dónde:** `World.init()` — línea 179.
**Por qué:** asegurarse de que ShaderML esté disponible antes del primer átomo.

```js
// World.js — init() — agregar import y registro

// Al tope del archivo, junto con los otros imports:
import { ShaderML } from '../ShaderLab/shader_ml.js';   // ← el JS generado por el script Python

// En World.init():
async init() {
    await ElementLoader.init();

    // ★ Registrar ShaderML globalmente para que Atom y Bond lo consuman
    // sin imports circulares.
    window.ShaderML = ShaderML;
    console.log('[World] 🧠 ShaderML registrado');

    this._running = true;
    this.clock.start();
    console.log('[World] Inicializado ✅');
    return this;
}
```

---

## 5. Bond.js — Actualizar material cuando cambia el tipo

**Dónde:** si en algún momento cambias `bond.type` en runtime (transición 
covalente → iónico por temperatura, por ejemplo), necesitas regenerar el material.

```js
// Bond.js — agregar método público

/**
 * Regenera el material del bond.
 * Llamar si cambia el tipo en runtime (ej: transición térmica).
 */
refreshMaterial() {
    if (!this.mesh) return;
    const oldMat = this.mesh.material;
    this.mesh.material = this._createMaterial();
    oldMat?.dispose();
}
```

---

## Orden de implementación recomendado

**Paso 1** — Generar `shader_ml.js` con el script Python:
```bash
uv run --python 3.12 --with numpy generate_materials_ml.py \
    --elements  src/elements \
    --presets   src/materials \
    --modules   src/ShaderLab/shader_modules \
    --js        src/ShaderLab/shader_ml.js
```

**Paso 2** — Patch `World.init()` para registrar `window.ShaderML`.
  Verificar en consola: `[World] 🧠 ShaderML registrado`.

**Paso 3** — Patch `World._syncMeshes()` para el tick de `uTime`.
  Verificar: los átomos existentes animan correctamente.

**Paso 4** — Patch `Atom._createMaterial()` con el fallback ML.
  Verificar: agregar un átomo sin preset manual → consola dice `← ML generado`.

**Paso 5** — Patch `Bond._createMaterial()`.
  Verificar: enlace entre Fe y O tiene visual distinto a H y H.

**Paso 6** — Reentrenar el modelo con más presets y regenerar `shader_ml.js`.
  Cuantos más presets manuales tengas en `src/materials/`, mejor el resultado.

---

## Lo que NO hay que tocar

- `QuantumRenderer.js` — el ML es solo para la esfera LOD-far y el cuello.
  Los orbitales reales bakeados tienen sus materiales propios y no cambian.
- `OrbitalBuilder.js` / `OrbitalCache.js` — sin cambios.
- `MaterialLibrary.js` — sin cambios. Los presets manuales siguen teniendo
  prioridad máxima sobre ML.
