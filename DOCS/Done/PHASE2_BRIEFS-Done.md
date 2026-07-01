# FASE 2 — Briefs para Sonnet
## De: Ámbar (Opus) · Para: Sonnet · Abril 2026

---

## BRIEF 1: METÁTESIS (Bond Exchange)

### Qué es
A-B + C-D → A-C + B-D. Dos bonds se rompen y reforman simultáneamente.
Caso estrella: trisulfide S-S-S exchange (Nature Chemistry 2026, Flinders Univ).

### Archivos a tocar
- `src/core/World.js` — nueva función `_detectMetathesis()`
- `src/core/Bond.js` — ya tiene `progress` 0→1, usarlo para transición

### Implementación paso a paso

**1. En World.js, agregar después de `_detectBonds()`:**

```js
_detectMetathesis() {
    if (!this.params.metathesisEnabled) return;
    
    // Buscar pares de bonds cercanos que podrían intercambiar
    for (const bond1 of this.bonds.values()) {
        if (bond1.progress < 0.9 || bond1.broken) continue;
        
        for (const bond2 of this.bonds.values()) {
            if (bond2.id <= bond1.id) continue; // evitar duplicados
            if (bond2.progress < 0.9 || bond2.broken) continue;
            
            // ¿Comparten un átomo? Si sí, no es metátesis (es el mismo enlace)
            if (bond1.atomA === bond2.atomA || bond1.atomA === bond2.atomB ||
                bond1.atomB === bond2.atomA || bond1.atomB === bond2.atomB) continue;
            
            // ¿Los átomos terminales están cerca?
            // Checar las 4 combinaciones posibles de intercambio
            const pairs = [
                [bond1.atomA, bond2.atomA, bond1.atomB, bond2.atomB],
                [bond1.atomA, bond2.atomB, bond1.atomB, bond2.atomA],
            ];
            
            for (const [newA1, newA2, newB1, newB2] of pairs) {
                const dist1 = newA1.position.distanceTo(newA2.position);
                const dist2 = newB1.position.distanceTo(newB2.position);
                const threshold = (newA1.radius + newA2.radius) * BOND_OVERLAP_FACTOR;
                const threshold2 = (newB1.radius + newB2.radius) * BOND_OVERLAP_FACTOR;
                
                if (dist1 < threshold && dist2 < threshold2) {
                    // ¿Químicamente viable?
                    if (!this._canBond(newA1, newA2)) continue;
                    if (!this._canBond(newB1, newB2)) continue;
                    
                    // Ejecutar intercambio via progress fade
                    bond1.targetProgress = 0; // fade out
                    bond2.targetProgress = 0;
                    
                    // Crear nuevos bonds con fade in
                    // (se crearán cuando los viejos terminen de morir,
                    //  o inmediatamente con progress=0 que sube)
                    this._pendingMetathesis = this._pendingMetathesis || [];
                    this._pendingMetathesis.push({
                        a1: newA1, a2: newA2,
                        b1: newB1, b2: newB2,
                        oldBond1: bond1.id, oldBond2: bond2.id,
                    });
                    
                    console.log(`[World] ⚗️ Metátesis: ${bond1.atomA.symbol}-${bond1.atomB.symbol} + ${bond2.atomA.symbol}-${bond2.atomB.symbol}`);
                    return; // una por frame máximo
                }
            }
        }
    }
    
    // Procesar pendientes: crear nuevos bonds cuando los viejos murieron
    if (this._pendingMetathesis?.length) {
        const pending = this._pendingMetathesis;
        this._pendingMetathesis = [];
        for (const { a1, a2, b1, b2, oldBond1, oldBond2 } of pending) {
            // Solo crear si los viejos ya se fueron
            if (this.bonds.has(oldBond1) || this.bonds.has(oldBond2)) {
                this._pendingMetathesis.push({ a1, a2, b1, b2, oldBond1, oldBond2 });
                continue;
            }
            if (!this._bondExists(a1, a2)) this.addBond(a1, a2);
            if (!this._bondExists(b1, b2)) this.addBond(b1, b2);
        }
    }
}
```

**2. En Bond.js, agregar `targetProgress`:**

El Bond.js v3 ya tiene `progress`. Agregar en `updateMesh()` o en un nuevo `tickProgress(dt)`:

```js
// En constructor:
this.targetProgress = 1.0;

// En un nuevo método llamado cada frame desde World.update():
tickProgress(dt) {
    if (Math.abs(this.progress - this.targetProgress) < 0.001) return;
    const speed = 3.0; // ~0.3s para transición completa
    this.progress += (this.targetProgress - this.progress) * speed * dt;
    if (this.targetProgress === 0 && this.progress < 0.02) {
        this._breakBond();
    }
}
```

**3. En World.update(), agregar al loop:**

```js
// Después de _detectBonds():
if (this.params.metathesisEnabled) this._detectMetathesis();

// Después de _applyBondForces():
for (const bond of this.bonds.values()) bond.tickProgress?.(dt);
```

**4. En World.params, agregar:**

```js
metathesisEnabled: false,  // toggle desde PhysicsPanel
```

**5. En PhysicsPanel.js, agregar toggle:**

Mismo patrón que `ljEnabled` — checkbox "⚗️ Metátesis".

### Validación
- Poner 4 átomos: A-B y C-D. Acercar B y C. Si B-C < threshold → A-B y C-D mueren, A-D y B-C nacen.
- El `progress` de los bonds viejos baja a 0 (fade out visual) antes de romperse.
- Los bonds nuevos nacen con `progress` 0 y suben a 1 (fade in).

### NO hacer
- No tocar el shader del bond
- No crear animaciones especiales — el fade de progress ya es visual
- No optimizar — es O(bonds²) pero bonds raramente pasan de 50

---

## BRIEF 2: DISOCIACIÓN TÉRMICA (kBT > De)

### Qué es
Cuando la energía cinética media de un átomo supera la energía de disociación del bond, el bond tiene probabilidad de romperse espontáneamente. Es la base de la química térmica.

### Archivos a tocar
- `src/core/Bond.js` — nuevo método `checkThermalDissociation(kBT)`
- `src/core/World.js` — llamar en el loop de física

### Implementación paso a paso

**1. En Bond.js, agregar método:**

```js
/**
 * Verifica si la energía térmica es suficiente para romper el bond.
 * Probabilidad basada en distribución de Boltzmann:
 *   P = exp(-De / kBT) por frame
 * 
 * @param {number} kBT — energía térmica media en eV (de World.temperature)
 * @returns {boolean} true si el bond debe romperse
 */
checkThermalDissociation(kBT) {
    if (this.broken || this.progress < 0.5) return false;
    if (kBT < 0.001) return false; // temperatura ~0 → nunca rompe
    
    // De en eV — ya existe en Bond.js como this.De (del potencial de Morse)
    const De = this.De ?? 3.0; // fallback 3 eV (bond covalente típico)
    
    // Boltzmann: probabilidad de tener energía >= De
    // P = exp(-De / kBT) — por frame, no por segundo
    // A 60fps, multiplicamos por dt para ser frame-rate independent
    const ratio = De / kBT;
    if (ratio > 30) return false; // exp(-30) ≈ 0 — skip math
    
    const P = Math.exp(-ratio);
    return Math.random() < P;
}
```

**2. En World.js, agregar en el loop de física:**

```js
// Después de _cleanBrokenBonds(), agregar:
_applyThermalDissociation() {
    if (!this.params.thermalDissociation) return;
    
    // kBT desde temperatura actual del sistema
    // kB = 8.617e-5 eV/K
    const kB = 8.617e-5;
    const T = this._measuredTemp ?? 300; // Kelvin
    const kBT = kB * T;
    
    for (const bond of this.bonds.values()) {
        if (bond.checkThermalDissociation(kBT)) {
            bond.targetProgress = 0; // fade out antes de romper
            console.log(`[World] 🔥 Disociación térmica: ${bond.atomA.symbol}-${bond.atomB.symbol} (T=${T.toFixed(0)}K, De=${bond.De?.toFixed(1)}eV)`);
        }
    }
}
```

**3. En World.update(), agregar:**

```js
// Después de _cleanBrokenBonds():
this._applyThermalDissociation();
```

**4. En World.params:**

```js
thermalDissociation: false,  // toggle desde PhysicsPanel
```

**5. PhysicsPanel — toggle "🔥 Disociación térmica"**

### Validación
- Temperatura baja (300K): bonds estables, ninguno se rompe
- Subir temperatura a 3000K: bonds débiles (vdw, De~0.01eV) se rompen primero
- Subir a 5000K+: bonds covalentes empiezan a romperse
- H₂O a 3500K debería perder los H (De O-H ≈ 4.8 eV, kBT@3500K ≈ 0.3 eV, P ≈ exp(-16) ≈ muy bajo pero no cero)
- A 10000K+ todo se disocia — átomos libres

### NO hacer
- No romper bonds instantáneamente — usar `targetProgress = 0` para fade visual
- No hacer la probabilidad por segundo — por frame es suficiente y más simple
- No tocar el potencial de Morse — la disociación térmica es un check ADICIONAL, no reemplaza Morse

### Dependencia
- `Bond.De` debe existir (viene del potencial de Morse ya implementado)
- `World._measuredTemp` debe existir (viene del sistema Berendsen ya implementado)
- `bond.targetProgress` de Brief 1 (metátesis) — implementar ese primero

---

## ORDEN DE EJECUCIÓN

1. **Primero**: agregar `targetProgress` + `tickProgress()` a Bond.js (necesario para ambos)
2. **Segundo**: Disociación térmica (más simple, valida que progress funcione)
3. **Tercero**: Metátesis (más complejo, usa progress + detección de pares)

Con estos dos, Fase 2 pasa de 70% a 100% ✅
