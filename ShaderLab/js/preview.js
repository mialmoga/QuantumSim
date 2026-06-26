/**
 * preview.js — Preview usando OrbitalCache + QuantumRenderer v2 shaders
 *
 * Flujo:
 *   OrbitalCache.loadMeta → getByLayer → getGeometry → Points con ShaderMaterial
 *
 * Conexión con el renderer:
 *   - makeUniforms() construye uniforms compatibles con SHADER_INTERFACE
 *   - loadShaderJSON(json) inyecta shaders del ShaderLab en los materiales vivos
 *   - SHADER_INTERFACE disponible via compiler.js para documentar el editor
 *
 * Seguridad WebGL:
 *   - Máx MAX_PTS_PER_ORBITAL puntos por orbital (submuestreo en CPU)
 *   - Máx MAX_ORBITALS_PREVIEW orbitales simultáneos
 *   - disposeElement() libera GPU al cambiar elemento
 */

import * as THREE from '/lib/three/build/three.module.js';
import { OrbitalCache }    from '../../src/renderer/OrbitalCache.js';
import { ElementLoader }   from '../../src/data/ElementLoader.js';
import { makeUniforms, SHADER_INTERFACE } from './compiler.js';

// Misma constante que QuantumRenderer — escala unificada
const TARGET_WU = 100;

// Re-exportar SHADER_INTERFACE para que app.js pueda pasárselo al editor
export { SHADER_INTERFACE };

// ── Límites de seguridad WebGL ────────────────────────────────
const MAX_PTS_PER_ORBITAL  = 3000;
const MAX_ORBITALS_PREVIEW = 6;

// Colores por subcapa (l)
const L_COLORS = {
  s: new THREE.Color(0x00ffff),
  p: new THREE.Color(0xff44ff),
  d: new THREE.Color(0xffa500),
  f: new THREE.Color(0x66ff66),
};
const L_LABELS = { 0: 's', 1: 'p', 2: 'd', 3: 'f' };

// ── Submuestreo ───────────────────────────────────────────────
/**
 * Devuelve nueva geometría con <= maxPts puntos equiespaciados.
 * Si ya cabe, devuelve la misma geometría (sin copia).
 */
function subsample(geo, maxPts) {
  const posAttr   = geo.attributes.position;
  const phaseAttr = geo.attributes.aPhase;
  const total     = posAttr.count;

  if (total <= maxPts) return { sub: geo, owned: false };

  const step = Math.ceil(total / maxPts);
  const N    = Math.ceil(total / step);
  const pos  = new Float32Array(N * 3);
  const ph   = new Float32Array(N);

  for (let i = 0, j = 0; i < total && j < N; i += step, j++) {
    pos[j * 3]     = posAttr.getX(i);
    pos[j * 3 + 1] = posAttr.getY(i);
    pos[j * 3 + 2] = posAttr.getZ(i);
    ph[j]          = phaseAttr ? phaseAttr.getX(i) : 0;
  }

  const sub = new THREE.BufferGeometry();
  sub.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  sub.setAttribute('aPhase',   new THREE.BufferAttribute(ph, 1));
  return { sub, owned: true };
}

// ── Clase Preview ─────────────────────────────────────────────
export class Preview {
  constructor(canvasEl, containerEl) {
    this.canvas    = canvasEl;
    this.container = containerEl;
    this.meshes    = []; // [{mesh, mat, subGeo, owned, orbInfo}]
    this.group     = null;
    this._currentSymbol = null;
    this._fc = 0; this._ft = 0;
    this._animId = null;
    this.onFps    = null; // callback(fps)
    this.onStatus = null; // callback(type:'ok'|'busy'|'err', msg)
    this._init();
  }

  _init() {
    const { canvas, container } = this;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setClearColor(0x07090f, 1);

    this.scene  = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 10000);
    this.camera.position.set(0, 0, 260);
    this._t0 = performance.now(); // reemplaza THREE.Clock (deprecated)

    this.group = new THREE.Group();
    this.scene.add(this.group);

    // Orbit manual — mouse
    let drag = false, px = 0, py = 0, rx = 0, ry = 0;
    canvas.addEventListener('mousedown', e => { drag = true; px = e.clientX; py = e.clientY; });
    window.addEventListener('mouseup',   () => drag = false);
    canvas.addEventListener('mousemove', e => {
      if (!drag) return;
      ry += (e.clientX - px) * 0.008;
      rx += (e.clientY - py) * 0.008;
      px = e.clientX; py = e.clientY;
      this.group.rotation.set(rx, ry, 0);
    });
    canvas.addEventListener('wheel', e => {
      this.camera.position.z = Math.max(60, Math.min(700, this.camera.position.z + e.deltaY * 0.3));
    }, { passive: true });

    // Touch — rotate con 1 dedo, pinch zoom con 2
    let touches = [], pinchDist0 = 0, camZ0 = 0;
    canvas.addEventListener('touchstart', e => {
      e.preventDefault();
      touches = [...e.touches];
      if (touches.length === 1) {
        px = touches[0].clientX; py = touches[0].clientY;
      } else if (touches.length === 2) {
        const dx = touches[0].clientX - touches[1].clientX;
        const dy = touches[0].clientY - touches[1].clientY;
        pinchDist0 = Math.hypot(dx, dy);
        camZ0 = this.camera.position.z;
      }
    }, { passive: false });

    canvas.addEventListener('touchmove', e => {
      e.preventDefault();
      touches = [...e.touches];
      if (touches.length === 1) {
        // Rotate
        ry += (touches[0].clientX - px) * 0.010;
        rx += (touches[0].clientY - py) * 0.010;
        px = touches[0].clientX; py = touches[0].clientY;
        this.group.rotation.set(rx, ry, 0);
      } else if (touches.length === 2) {
        // Pinch zoom
        const dx = touches[0].clientX - touches[1].clientX;
        const dy = touches[0].clientY - touches[1].clientY;
        const dist = Math.hypot(dx, dy);
        const scale = pinchDist0 / dist;
        this.camera.position.z = Math.max(60, Math.min(700, camZ0 * scale));
      }
    }, { passive: false });

    canvas.addEventListener('touchend', e => {
      touches = [...e.touches];
      if (touches.length === 1) {
        // Quedó un dedo — reiniciar referencia para no saltar
        px = touches[0].clientX; py = touches[0].clientY;
      }
    }, { passive: true });

    const rsz = () => {
      const w = container.clientWidth, h = container.clientHeight;
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      // Actualizar uAspect en todos los materiales vivos
      // Guardamos height/width (invertido) para que portrait amplifique los puntos
      // y landscape los mantenga — diseño base en landscape
      const aspect = w > 0 ? h / w : 1.0;
      this.meshes.forEach(({ mat }) => {
        if (mat.uniforms?.uAspect) mat.uniforms.uAspect.value = aspect;
      });
    };
    rsz();
    window.addEventListener('resize', rsz);

    this._loop();
  }

  _loop() {
    this._animId = requestAnimationFrame(() => this._loop());
    const t = (performance.now() - this._t0) * 0.001;
    this.meshes.forEach(({ mat }) => {
      if (mat.uniforms?.uTime) mat.uniforms.uTime.value = t;
    });
    this._fc++;
    if (t - this._ft > 0.5) {
      this.onFps?.(Math.round(this._fc / (t - this._ft)));
      this._fc = 0; this._ft = t;
    }
    this.renderer.render(this.scene, this.camera);
  }

  // ── Limpieza ─────────────────────────────────────────────────
  clearMeshes() {
    this.meshes.forEach(({ mesh, mat, subGeo, owned }) => {
      this.group.remove(mesh);
      mat.dispose();
      if (owned && subGeo) subGeo.dispose(); // solo si es copia nuestra
    });
    this.meshes = [];
  }

  /** Aplica nuevos shaders sin recargar geometría */
  applyShaders(vert, frag) {
    this.meshes.forEach(({ mat }) => {
      mat.vertexShader   = vert;
      mat.fragmentShader = frag;
      mat.needsUpdate    = true;
    });
  }

  /**
   * Carga un shader desde un JSON del ShaderLab (mismo formato que
   * QuantumRenderer.loadShaderJSON). Compatible con SHADER_INTERFACE.
   *
   * Inyecta el shader compilado en los materiales vivos del preview
   * sin recargar geometría — equivalente al hot-swap del renderer.
   *
   * @param {Object} json — salida del ShaderLab con compiled.vert / compiled.frag
   */
  loadShaderJSON(json) {
    const vert = json.compiled?.vert;
    const frag = json.compiled?.frag;
    if (!vert || !frag) {
      console.warn('[Preview] JSON sin compiled.vert / compiled.frag');
      return false;
    }

    // Extraer uniforms extra del pipeline (parámetros de nodos)
    const extraUniforms = {};
    for (const stage of (json.pipeline ?? [])) {
      if (!stage.enabled) continue;
      for (const [k, v] of Object.entries(stage.params ?? {})) {
        extraUniforms[`u_${stage.key}_${k}`] = { value: v };
      }
    }

    // Filtrar por target del JSON: 'valence' solo afecta meshes de valence
    const targetLayer = json.layer ?? 'all';

    this.meshes.forEach(({ mat, orbInfo }) => {
      if (targetLayer !== 'all' && orbInfo?.layer !== targetLayer) return;
      mat.vertexShader   = vert;
      mat.fragmentShader = frag;
      // Inyectar uniforms extra sin destruir los base
      Object.assign(mat.uniforms, extraUniforms);
      mat.needsUpdate = true;
    });

    console.log(`[Preview] loadShaderJSON → target='${targetLayer}' ok`);
    return true;
  }

  /**
   * Simula un bondState en el preview para ver cómo reacciona el shader.
   * Equivalente a QuantumRenderer.setBondState().
   *
   * @param {number} state   0=libre 1=atrae 2=repele 3=intercambio
   * @param {Object} opts    { dir: THREE.Vector3, strength: float, color: THREE.Color }
   */
  setBondState(state, opts = {}) {
    this.meshes.forEach(({ mat, orbInfo }) => {
      if (orbInfo?.layer !== 'valence' && orbInfo?.layer !== undefined) return;
      const u = mat.uniforms;
      if (!u) return;
      if (u.uBondState)    u.uBondState.value    = state;
      if (u.uBondStrength) u.uBondStrength.value  = opts.strength ?? 1.0;
      if (u.uBondProgress) u.uBondProgress.value  = state > 0 ? 1.0 : 0.0;
      if (u.uBondDir && opts.dir)   u.uBondDir.value.copy(opts.dir);
      if (u.uBondColor && opts.color) u.uBondColor.value.copy(opts.color);
    });
  }

  // ── Material ─────────────────────────────────────────────────
  _makeMat(color, vert, frag, orbInfo, pmScale = 1.0) {
    const uni = makeUniforms(color, THREE);
    // Propagar datos del orbital a uniforms
    if (uni.uLevel   && orbInfo?.n) uni.uLevel.value   = orbInfo.n;
    if (uni.uPmScale)               uni.uPmScale.value  = pmScale;
    // Aspect ratio real al momento de crear — se actualiza en resize
    if (uni.uAspect) {
      const w = this.container.clientWidth, h = this.container.clientHeight;
      uni.uAspect.value = w > 0 ? h / w : 1.0;  // h/w: portrait amplifica, landscape = ~0.46
    }
    return new THREE.ShaderMaterial({
      vertexShader: vert, fragmentShader: frag, uniforms: uni,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
  }

  // ── Fallback sintético (3d_m0 procedural) ────────────────────
  _syntheticGeo(N = MAX_PTS_PER_ORBITAL) {
    const pos = new Float32Array(N * 3), ph = new Float32Array(N);
    let i = 0, tries = 0, rMax = 150;
    while (i < N && tries < N * 25) {
      tries++;
      const r   = Math.random() * rMax;
      const th  = Math.acos(2 * Math.random() - 1);
      const phi = Math.random() * Math.PI * 2;
      const x = r * Math.sin(th) * Math.cos(phi);
      const y = r * Math.sin(th) * Math.sin(phi);
      const z = r * Math.cos(th);
      const c = z / (r + 0.001), rho = r / 40;
      if (Math.random() < rho * rho * (1 - c*c) * c*c * Math.exp(-rho) * 90) {
        pos[i*3]=x; pos[i*3+1]=y; pos[i*3+2]=z; ph[i]=r/rMax; i++;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos.slice(0, i*3), 3));
    geo.setAttribute('aPhase',   new THREE.BufferAttribute(ph.slice(0, i), 1));
    return geo;
  }

  // ── Carga principal ───────────────────────────────────────────
  /**
   * Carga orbitales reales usando OrbitalCache.
   *
   * Flujo:
   *  1. OrbitalCache.loadMeta(symbol) → metadata.json completo
   *  2. getByLayer() | getOrbitalList() → lista de orbitales del metadata
   *  3. Priorizar: mayor n primero, limitar a MAX_ORBITALS_PREVIEW
   *  4. getGeometry(n, l, m) → BufferGeometry real del .bin (formato ORBL)
   *  5. subsample() → reducir a MAX_PTS_PER_ORBITAL para no matar WebGL
   *  6. ShaderMaterial con los shaders del compiler.js
   *
   * @param {string} symbol
   * @param {string} layer   'all'|'core'|'semi'|'valence'
   * @param {string} vert
   * @param {string} frag
   * @returns {Promise<{ok, loaded, total, pts}>}
   */
  // ── Geometría esfera para modo átomo ─────────────────────
  /**
   * Genera una esfera de puntos distribuidos uniformemente (Fibonacci lattice).
   * Mucho mejor que SphereGeometry — sin clustering en los polos.
   * @param {number} radius  — radio en pm (coherente con escala orbital)
   * @param {number} N       — número de puntos
   */

  // Ajusta la cámara para encuadrar el elemento según su tamaño en WU
  _fitCamera(rWU) {
    if (rWU <= 0) return;
    const fovRad = this.camera.fov * Math.PI / 180;
    const dist   = (rWU / Math.tan(fovRad / 2)) * 1.8;
    const clamped = Math.max(30, Math.min(700, dist));
    this.camera.position.set(0, 0, clamped);
    this.camera.updateProjectionMatrix();
  }

  _sphereGeo(radius = 120, N = MAX_PTS_PER_ORBITAL) {
    const pos = new Float32Array(N * 3);
    const ph  = new Float32Array(N);
    const phi = Math.PI * (3 - Math.sqrt(5)); // ángulo dorado

    for (let i = 0; i < N; i++) {
      const y     = 1 - (i / (N - 1)) * 2;       // -1 a 1
      const r     = Math.sqrt(1 - y * y);
      const theta = phi * i;
      pos[i * 3]     = Math.cos(theta) * r * radius;
      pos[i * 3 + 1] = y * radius;
      pos[i * 3 + 2] = Math.sin(theta) * r * radius;
      ph[i] = 0.5 + y * 0.5; // phase de 0 a 1 de polo a polo
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aPhase',   new THREE.BufferAttribute(ph, 1));
    return geo;
  }

  async loadElement(symbol, layer, vert, frag, target = 'orbital') {
    this.clearMeshes();

    // Liberar geometrías del elemento anterior de la GPU
    if (this._currentSymbol && this._currentSymbol !== symbol) {
      OrbitalCache.disposeElement(this._currentSymbol);
    }
    this._currentSymbol = symbol;

    // ── Modo esfera (LOD far — átomo como punto) ──────────
    if (target === 'sphere') {
      this.onStatus?.('busy', `⟳ Esfera ${symbol}…`);
      try {
        // Misma lógica que QuantumRenderer.loadElement — radio real del elemento
        await ElementLoader.init();
        const orbMeta  = await OrbitalCache.loadMeta(symbol).catch(() => null);
        const elemData = await ElementLoader.load(symbol).catch(() => null);

        // Prioridad: r_max_pm orbitales → vanderwaals → 180pm fallback
        const rMaxOuter = orbMeta?.orbitals?.length
          ? orbMeta.orbitals.reduce((mx, o) => Math.max(mx, o.r_max_pm ?? 0), 0) || 180
          : (elemData?.atomic_structure?.vanderwaals_radius_pm ?? 180);

        const pmScale = 1.0;
        const geo     = this._sphereGeo(rMaxOuter, MAX_PTS_PER_ORBITAL);
        this._fitCamera(rMaxOuter);

        // Color real del elemento (no azul hardcodeado)
        const indexMeta = ElementLoader.getMeta(symbol);
        const rawColor  = elemData?.identity?.color ?? indexMeta?.color ?? '0x6699ff';
        const color     = new THREE.Color(parseInt(String(rawColor).replace('0x',''), 16));

        const mat  = this._makeMat(color, vert, frag, { n: 2 }, pmScale);
        const mesh = new THREE.Points(geo, mat);
        this.group.add(mesh);
        this.meshes.push({ mesh, mat, subGeo: geo, owned: true, orbInfo: null });
        this.onStatus?.('ok', `✓ ${symbol} esfera · r=${Math.round(rMaxOuter)}pm · ${MAX_PTS_PER_ORBITAL}pts`);
        return { ok: true, loaded: 1, total: 1, pts: MAX_PTS_PER_ORBITAL };
      } catch (err) {
        this.onStatus?.('err', '✗ ' + err.message);
        return { ok: false, loaded: 0, total: 0, pts: 0 };
      }
    }

    this.onStatus?.('busy', `⟳ Cargando ${symbol} [${layer}]…`);

    try {
      // 1. Metadata completa del elemento
      const meta = await OrbitalCache.loadMeta(symbol);
      if (!meta) throw new Error('metadata no encontrada: ' + symbol);

      // pmScale unificado — igual que QuantumRenderer y OrbitalBuilder
      const rMaxOuter = meta.orbitals?.length
        ? meta.orbitals.reduce((mx, o) => Math.max(mx, o.r_max_pm ?? 0), 0) || 180
        : (((await ElementLoader.load(symbol).catch(()=>null))?.atomic_structure?.vanderwaals_radius_pm) ?? 180);
      // pmScale = 1.0 siempre — 1wu = 1pm en todo el ecosistema
      const pmScale = 1.0;
      this._fitCamera(rMaxOuter);

      // 2. Lista de orbitales según capa
      const orbList = layer === 'all'
        ? OrbitalCache.getOrbitalList(symbol)
        : OrbitalCache.getByLayer(symbol, layer);

      if (!orbList.length) throw new Error(`sin orbitales en capa '${layer}' para ${symbol}`);

      // 3. Priorizar orbitales externos (mayor n) y limitar cantidad
      const toLoad = [...orbList]
        .sort((a, b) => b.n - a.n)
        .slice(0, MAX_ORBITALS_PREVIEW);

      // 4. Cargar geometrías en paralelo desde OrbitalCache
      //    getGeometry() lee el .bin con formato ORBL, valida magic, extrae position + aPhase
      const settled = await Promise.allSettled(
        toLoad.map(orb =>
          OrbitalCache.getGeometry(symbol, orb.n, orb.l, orb.m)
            .then(geo => ({ geo, orb }))
        )
      );

      // 5. Construir meshes
      let totalPts = 0, loaded = 0;

      for (const r of settled) {
        if (r.status !== 'fulfilled' || !r.value?.geo) continue;
        const { geo, orb } = r.value;

        // Submuestrear para seguridad WebGL
        const { sub, owned } = subsample(geo, MAX_PTS_PER_ORBITAL);

        // Color por tipo de subcapa (l)
        const lKey = L_LABELS[orb.l] ?? 's';
        const col  = (L_COLORS[lKey] ?? L_COLORS.s).clone();
        const mat  = this._makeMat(col, vert, frag, orb, pmScale);

        const mesh = new THREE.Points(sub, mat);
        this.group.add(mesh);
        this.meshes.push({ mesh, mat, subGeo: sub, owned, orbInfo: orb });

        totalPts += sub.attributes.position.count;
        loaded++;
      }

      if (loaded === 0) throw new Error('ninguna geometría cargó');

      const msg = `✓ ${symbol} · ${loaded}/${toLoad.length} orb · ${totalPts} pts`;
      this.onStatus?.('ok', msg);
      return { ok: true, loaded, total: orbList.length, pts: totalPts };

    } catch (err) {
      console.warn('[Preview] Fallback sintético:', err.message);
      const geo  = this._syntheticGeo();
      const mat  = this._makeMat(new THREE.Color(1, 0.45, 0.08), vert, frag, { n: 3 });
      const mesh = new THREE.Points(geo, mat);
      this.group.add(mesh);
      this.meshes.push({ mesh, mat, subGeo: geo, owned: true, orbInfo: null });
      const pts = geo.attributes.position.count;
      this.onStatus?.('ok', `✓ ${symbol} fallback · ${pts} pts`);
      return { ok: false, loaded: 0, total: 0, pts };
    }
  }

  dispose() {
    cancelAnimationFrame(this._animId);
    this.clearMeshes();
    this.renderer.dispose();
  }
}
