/**
 * app.js — Orquestador principal de ShaderLab
 *
 * Modos: current | custom | dev
 * Target: orbital | sphere
 */

import { compilePipeline, SH_CURRENT, PIPELINE_MINIMAL, makeUniforms } from './compiler.js';
import { Preview } from './preview.js';
import { renderPipeline, renderParams, renderModeInfo, openAddModal, toast } from './ui.js';
import { MATERIALS, MAT_KEYS, FAM_COLOR, FAM_ICON,
         buildMatJSON, buildIndex, tryLoadExisting,
         downloadZip, saveToDir, buildPipelineFromParams } from './devMode.js';

const $ = id => document.getElementById(id);

// ── 118 Elementos ─────────────────────────────────────────────
const ALL_ELEMENTS = [
  {n:1,sym:'H',name:'Hidrógeno'},{n:2,sym:'He',name:'Helio'},{n:3,sym:'Li',name:'Litio'},
  {n:4,sym:'Be',name:'Berilio'},{n:5,sym:'B',name:'Boro'},{n:6,sym:'C',name:'Carbono'},
  {n:7,sym:'N',name:'Nitrógeno'},{n:8,sym:'O',name:'Oxígeno'},{n:9,sym:'F',name:'Flúor'},
  {n:10,sym:'Ne',name:'Neón'},{n:11,sym:'Na',name:'Sodio'},{n:12,sym:'Mg',name:'Magnesio'},
  {n:13,sym:'Al',name:'Aluminio'},{n:14,sym:'Si',name:'Silicio'},{n:15,sym:'P',name:'Fósforo'},
  {n:16,sym:'S',name:'Azufre'},{n:17,sym:'Cl',name:'Cloro'},{n:18,sym:'Ar',name:'Argón'},
  {n:19,sym:'K',name:'Potasio'},{n:20,sym:'Ca',name:'Calcio'},{n:21,sym:'Sc',name:'Escandio'},
  {n:22,sym:'Ti',name:'Titanio'},{n:23,sym:'V',name:'Vanadio'},{n:24,sym:'Cr',name:'Cromo'},
  {n:25,sym:'Mn',name:'Manganeso'},{n:26,sym:'Fe',name:'Hierro'},{n:27,sym:'Co',name:'Cobalto'},
  {n:28,sym:'Ni',name:'Níquel'},{n:29,sym:'Cu',name:'Cobre'},{n:30,sym:'Zn',name:'Zinc'},
  {n:31,sym:'Ga',name:'Galio'},{n:32,sym:'Ge',name:'Germanio'},{n:33,sym:'As',name:'Arsénico'},
  {n:34,sym:'Se',name:'Selenio'},{n:35,sym:'Br',name:'Bromo'},{n:36,sym:'Kr',name:'Kriptón'},
  {n:37,sym:'Rb',name:'Rubidio'},{n:38,sym:'Sr',name:'Estroncio'},{n:39,sym:'Y',name:'Itrio'},
  {n:40,sym:'Zr',name:'Circonio'},{n:41,sym:'Nb',name:'Niobio'},{n:42,sym:'Mo',name:'Molibdeno'},
  {n:43,sym:'Tc',name:'Tecnecio'},{n:44,sym:'Ru',name:'Rutenio'},{n:45,sym:'Rh',name:'Rodio'},
  {n:46,sym:'Pd',name:'Paladio'},{n:47,sym:'Ag',name:'Plata'},{n:48,sym:'Cd',name:'Cadmio'},
  {n:49,sym:'In',name:'Indio'},{n:50,sym:'Sn',name:'Estaño'},{n:51,sym:'Sb',name:'Antimonio'},
  {n:52,sym:'Te',name:'Teluro'},{n:53,sym:'I',name:'Yodo'},{n:54,sym:'Xe',name:'Xenón'},
  {n:55,sym:'Cs',name:'Cesio'},{n:56,sym:'Ba',name:'Bario'},{n:57,sym:'La',name:'Lantano'},
  {n:58,sym:'Ce',name:'Cerio'},{n:59,sym:'Pr',name:'Praseodimio'},{n:60,sym:'Nd',name:'Neodimio'},
  {n:61,sym:'Pm',name:'Prometio'},{n:62,sym:'Sm',name:'Samario'},{n:63,sym:'Eu',name:'Europio'},
  {n:64,sym:'Gd',name:'Gadolinio'},{n:65,sym:'Tb',name:'Terbio'},{n:66,sym:'Dy',name:'Disprosio'},
  {n:67,sym:'Ho',name:'Holmio'},{n:68,sym:'Er',name:'Erbio'},{n:69,sym:'Tm',name:'Tulio'},
  {n:70,sym:'Yb',name:'Iterbio'},{n:71,sym:'Lu',name:'Lutecio'},{n:72,sym:'Hf',name:'Hafnio'},
  {n:73,sym:'Ta',name:'Tántalo'},{n:74,sym:'W',name:'Wolframio'},{n:75,sym:'Re',name:'Renio'},
  {n:76,sym:'Os',name:'Osmio'},{n:77,sym:'Ir',name:'Iridio'},{n:78,sym:'Pt',name:'Platino'},
  {n:79,sym:'Au',name:'Oro'},{n:80,sym:'Hg',name:'Mercurio'},{n:81,sym:'Tl',name:'Talio'},
  {n:82,sym:'Pb',name:'Plomo'},{n:83,sym:'Bi',name:'Bismuto'},{n:84,sym:'Po',name:'Polonio'},
  {n:85,sym:'At',name:'Astato'},{n:86,sym:'Rn',name:'Radón'},{n:87,sym:'Fr',name:'Francio'},
  {n:88,sym:'Ra',name:'Radio'},{n:89,sym:'Ac',name:'Actinio'},{n:90,sym:'Th',name:'Torio'},
  {n:91,sym:'Pa',name:'Protactinio'},{n:92,sym:'U',name:'Uranio'},{n:93,sym:'Np',name:'Neptunio'},
  {n:94,sym:'Pu',name:'Plutonio'},{n:95,sym:'Am',name:'Americio'},{n:96,sym:'Cm',name:'Curio'},
  {n:97,sym:'Bk',name:'Berkelio'},{n:98,sym:'Cf',name:'Californio'},{n:99,sym:'Es',name:'Einsteinio'},
  {n:100,sym:'Fm',name:'Fermio'},{n:101,sym:'Md',name:'Mendelevio'},{n:102,sym:'No',name:'Nobelio'},
  {n:103,sym:'Lr',name:'Laurencio'},{n:104,sym:'Rf',name:'Rutherfordio'},{n:105,sym:'Db',name:'Dubnio'},
  {n:106,sym:'Sg',name:'Seaborgio'},{n:107,sym:'Bh',name:'Bohrio'},{n:108,sym:'Hs',name:'Hasio'},
  {n:109,sym:'Mt',name:'Meitnerio'},{n:110,sym:'Ds',name:'Darmstadtio'},{n:111,sym:'Rg',name:'Roentgenio'},
  {n:112,sym:'Cn',name:'Copernicio'},{n:113,sym:'Nh',name:'Nihonio'},{n:114,sym:'Fl',name:'Flerovio'},
  {n:115,sym:'Mc',name:'Moscovio'},{n:116,sym:'Lv',name:'Livermorio'},{n:117,sym:'Ts',name:'Teneso'},
  {n:118,sym:'Og',name:'Oganesón'},
];

const MINIMAL_KEYS = ['point_size', 'disc_shape', 'brightness'];

// ── Estado global ─────────────────────────────────────────────
const APP = {
  mode:         'current',
  target:       'orbital',
  element:      'Fe',
  layer:        'all',
  pipeline:     [],
  selected:     null,
  moduleDefs:   [],
  elementsIndex: {},
  activePreset:  null,   // preset activo en modo current — se re-aplica tras loadElement
  onPipelineChange: null,
};

// ── Módulos ───────────────────────────────────────────────────
async function loadModules() {
  const ids = [
    'blink','point_size','turbulence',
    'disc_shape','brightness','color_grade',
    'glow','phase_color','alpha_curve','sphere_pulse','fresnel_fake',
  ];
  const defs = [];
  for (const id of ids) {
    try {
      const res = await fetch(`shader_modules/${id}.json`);
      if (res.ok) defs.push(await res.json());
    } catch { console.warn('module not found:', id); }
  }
  APP.moduleDefs = defs;
  return defs;
}

// ── Selector de elemento (dropdown) ──────────────────────────
async function buildElemSelect() {
  const sel = $('elemSelect');

  // Cargar desde elements-index.json — fuente de verdad con campo material
  try {
    const res = await fetch('../src/elements-index.json');
    if (res.ok) {
      const data = await res.json();
      // El index es { version, elements: { H: {...}, He: {...}, ... } }
      APP.elementsIndex = data.elements ?? {};
    }
  } catch { console.warn('[ShaderLab] No se pudo cargar elements-index.json, usando fallback'); }

  // Fallback a ALL_ELEMENTS si el fetch falla
  const source = Object.keys(APP.elementsIndex).length
    ? Object.values(APP.elementsIndex)
    : ALL_ELEMENTS;

  source.forEach(el => {
    const opt = document.createElement('option');
    opt.value = el.symbol ?? el.sym;
    opt.textContent = `${el.number ?? el.n}. ${el.symbol ?? el.sym} — ${el.name_es ?? el.name}`;
    if ((el.symbol ?? el.sym) === APP.element) opt.selected = true;
    sel.appendChild(opt);
  });
  sel.addEventListener('change', () => loadElement(sel.value));
}

// ── Preview instance ──────────────────────────────────────────
let preview;

function initPreview() {
  preview = new Preview($('glCanvas'), $('prevCont'));
  preview.onFps    = fps  => { $('fpsEl').textContent = fps + ' fps'; };
  preview.onStatus = (type, msg) => setCst(type, msg);
}

// ── Shaders activos ───────────────────────────────────────────
function getShaders() {
  if (APP.mode === 'current') return SH_CURRENT[APP.target] ?? SH_CURRENT.orbital;
  try {
    return compilePipeline(APP.pipeline, APP.target);
  } catch (e) {
    setCst('err', '✗ ' + e.message.slice(0, 60));
    return SH_CURRENT[APP.target];
  }
}

// ── Recompile debounced ───────────────────────────────────────
let schedT = null;
function scheduleRecompile() {
  setCst('busy', '⟳ Compilando…');
  clearTimeout(schedT);
  schedT = setTimeout(() => {
    try {
      const { vert, frag } = getShaders();
      preview.applyShaders(vert, frag);
      setCst('ok', '✓ Shader compilado');
    } catch (e) {
      setCst('err', '✗ ' + e.message.slice(0, 60));
    }
  }, 350);
}

APP.onPipelineChange = scheduleRecompile;

// ── Cargar elemento en preview ────────────────────────────────
async function loadElement(symbol) {
  APP.element = symbol;
  const sel = $('elemSelect');
  if (sel) sel.value = symbol;

  $('elemLabel').textContent = symbol + '…';
  const { vert, frag } = getShaders();
  const result = await preview.loadElement(symbol, APP.layer, vert, frag, APP.target);
  $('elemLabel').textContent = result.ok
    ? (APP.target === 'sphere'
        ? `${symbol} · esfera · ${result.pts}pts`
        : `${symbol} · ${result.loaded}/${result.total} orb · ${result.pts}pts`)
    : `${symbol} (gen) · ${result.pts}pts`;

  // En modo current — seleccionar tarjeta del material asignado
  if (APP.mode === 'current') {
    const elemMeta = APP.elementsIndex[symbol];
    const matName  = elemMeta?.material ?? null;
    if (matName) {
      selectPresetCardByName(matName);
    }
    // Re-aplicar el shader del preset activo DESPUÉS de que la geometría cargó
    if (APP.activePreset?.compiled?.vert) {
      preview.applyShaders(APP.activePreset.compiled.vert, APP.activePreset.compiled.frag);
    }
  }
}

// ── Modo (current / custom) ───────────────────────────────────
async function setMode(mode) {
  APP.mode = mode;
  document.querySelectorAll('.mode-tab:not(.dev-tab)').forEach(t =>
    t.classList.toggle('active', t.dataset.mode === mode));
  $('modeLabel').textContent = { current: 'Current', custom: 'Custom ✦' }[mode] ?? mode;

  const isCustom = mode === 'custom';

  // Pipeline controls: solo en custom
  $('pipelineControls').style.display = isCustom ? '' : 'none';
  $('nodesList').style.display = isCustom ? '' : 'none';

  // Galería de presets: solo en current
  $('presetGallery').style.display = isCustom ? 'none' : '';

  if (isCustom) {
    if (APP.pipeline.length === 0) buildMinimalPipeline();
    renderPipeline(APP);
    renderParams(APP, null);
    scheduleRecompile();
  } else {
    // current
    renderPipeline(APP);  // mostrará mensaje en panel derecho via renderModeInfo
    renderModeInfo(APP.target);
    preview.applyShaders(SH_CURRENT[APP.target].vert, SH_CURRENT[APP.target].frag);
    setCst('ok', '✓ Shader listo');
    await renderPresetGallery(); // await para que las tarjetas estén listas antes de selectPresetCardByName
  }
}

// ── Target ────────────────────────────────────────────────────
async function setTarget(target) {
  APP.target = target;
  document.querySelectorAll('.tgt-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.tgt === target));
  $('targetLabel').textContent = target;
  // En current re-renderizar galería filtrada por el nuevo target
  if (APP.mode === 'current') await renderPresetGallery();
  loadElement(APP.element);
}

// ── Layer ─────────────────────────────────────────────────────
function setLayer(layer) {
  APP.layer = layer;
  document.querySelectorAll('.layer-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.layer === layer));
  loadElement(APP.element);
}

// ── Pipeline minimal ──────────────────────────────────────────
function buildMinimalPipeline() {
  APP.pipeline = MINIMAL_KEYS.map(key => {
    const def = APP.moduleDefs.find(d => d.id === key);
    if (!def) return null;
    return {
      id:      Math.random().toString(36).slice(2),
      key:     def.id, def,
      params:  Object.fromEntries(Object.entries(def.params ?? {}).map(([k, p]) => [k, p.val])),
      enabled: true, custom: false,
    };
  }).filter(Boolean);
}

function resetPipeline() {
  buildMinimalPipeline();
  APP.selected = null;
  renderPipeline(APP);
  renderParams(APP, null);
  scheduleRecompile();
  toast('Pipeline reiniciado al minimal', 'ok');
}

// ══════════════════════════════════════════════════════════════
// MODO DEV
// ══════════════════════════════════════════════════════════════

let devPreview = null;
let devState = {
  activeKey:      null,
  activeFam:      null,
  filterByElem:   false,   // toggle: mostrar solo el material del elemento seleccionado
  previewElement: 'Fe',
  checked:        new Set(),            // se llena con símbolos al cargar elementsIndex
  overrides:      {},                   // key → pipeline hidratado custom
  dirHandle:      null,
};

function setDevMode(on) {
  $('bodyNormal').style.display = on ? 'none'  : '';
  $('bodyDev').style.display    = on ? ''      : 'none';
  $('btnDevMode').classList.toggle('active', on);
  // Ocultar mode-tabs y target-toggle en modo dev (no aplican)
  document.querySelector('.mode-tabs').style.visibility    = on ? 'hidden' : '';
  document.querySelector('.target-toggle').style.visibility = on ? 'hidden' : '';
  document.querySelector('.h-actions').style.visibility     = on ? 'hidden' : '';

  if (on && !devPreview) initDevPreview();
  if (on) buildDevUI();

  // Forzar resize en ambos previews — el cambio de layout mueve los canvas
  // y el renderer no lo detecta automáticamente
  requestAnimationFrame(() => {
    window.dispatchEvent(new Event('resize'));
  });
}

function initDevPreview() {
  devPreview = new Preview($('devCanvas'), $('devPrevCont'));
  devPreview.onFps    = fps => { $('devFpsEl').textContent = fps + ' fps'; };
  devPreview.onStatus = (type, msg) => {
    const el = $('devCst');
    el.className = 'cst ' + type;
    el.textContent = msg;
  };
}

function buildDevUI() {
  // Inicializar checked con todos los elementos si está vacío
  if (devState.checked.size === 0 && APP.elementsIndex) {
    Object.keys(APP.elementsIndex).forEach(s => devState.checked.add(s));
  }

  // Sincronizar selector de elemento si no está poblado
  const devSel = $('devElemSelect');
  if (devSel && devSel.options.length === 0) {
    const source = APP.elementsIndex
      ? Object.values(APP.elementsIndex)
      : ALL_ELEMENTS;
    source.forEach(el => {
      const opt = document.createElement('option');
      opt.value = el.symbol ?? el.sym;
      opt.textContent = `${el.number ?? el.n}. ${el.symbol ?? el.sym} — ${el.name_es ?? el.name}`;
      devSel.appendChild(opt);
    });
    devSel.value = devState.previewElement ?? 'Fe';
    devSel.addEventListener('change', () => {
      devState.previewElement = devSel.value;
      buildDevMatList();
      if (devState.activeKey) selectDevMat(devState.activeKey);
    });
  }

  // Toggle "solo este elemento" — si no existe el botón, créalo
  if (!$('devFilterElemBtn')) {
    const btn = document.createElement('div');
    btn.id = 'devFilterElemBtn';
    btn.className = 'fchip' + (devState.filterByElem ? ' on' : '');
    btn.style.cssText = 'color:#00e5ff;border-color:#00e5ff;margin-top:4px;cursor:pointer';
    btn.textContent = '⬡ Solo elemento';
    btn.onclick = () => {
      devState.filterByElem = !devState.filterByElem;
      btn.classList.toggle('on', devState.filterByElem);
      buildDevMatList();
    };
    $('devFamFilter')?.after(btn);
  } else {
    $('devFilterElemBtn').classList.toggle('on', devState.filterByElem);
  }

  buildDevFamFilter();
  buildDevMatList();
  const totalElems = Object.keys(APP.elementsIndex ?? {}).length || 118;
  $('devCount').textContent = `${devState.checked.size}/${totalElems}`;
}

function buildDevFamFilter() {
  const wrap = $('devFamFilter');
  wrap.innerHTML = '';

  // Grupos del elements-index en lugar de familias hardcodeadas
  const groups = [...new Set(
    Object.values(APP.elementsIndex ?? {}).map(e => e.group).filter(Boolean)
  )].sort();

  const groupColors = {
    nonmetal: '#60b0ff', noble_gas: '#c084fc', halogen: '#38bdf8',
    alkali_metal: '#fb923c', alkaline_earth_metal: '#fbbf24',
    transition_metal: '#a0c0e0', post_transition_metal: '#94a3b8',
    metalloid: '#86efac', lanthanide: '#f9a8d4',
    actinide: '#4ade80', superheavy: '#f87171',
  };

  const all = document.createElement('div');
  all.className = 'fchip' + (devState.activeFam === null ? ' on' : '');
  all.textContent = 'todos';
  all.onclick = () => { devState.activeFam = null; buildDevUI(); };
  wrap.appendChild(all);

  groups.forEach(g => {
    const c = document.createElement('div');
    c.className = 'fchip' + (devState.activeFam === g ? ' on' : '');
    c.textContent = g.replace(/_/g, ' ').replace('metal', 'met.');
    c.style.borderColor = groupColors[g] || 'var(--border)';
    c.style.fontSize = '9px';
    c.onclick = () => { devState.activeFam = g; buildDevUI(); };
    wrap.appendChild(c);
  });
}

function buildDevMatList() {
  const list = $('devMatList');
  list.innerHTML = '';

  const idx = APP.elementsIndex ?? {};
  const selElem = devState.previewElement ?? 'Fe';

  // Obtener lista de símbolos filtrada por grupo
  let syms = Object.keys(idx);
  if (devState.activeFam) {
    syms = syms.filter(s => idx[s].group === devState.activeFam);
  }
  if (devState.filterByElem) {
    syms = syms.filter(s => s === selElem);
  }

  const groupColors = {
    nonmetal: '#60b0ff', noble_gas: '#c084fc', halogen: '#38bdf8',
    alkali_metal: '#fb923c', alkaline_earth_metal: '#fbbf24',
    transition_metal: '#a0c0e0', post_transition_metal: '#94a3b8',
    metalloid: '#86efac', lanthanide: '#f9a8d4',
    actinide: '#4ade80', superheavy: '#f87171',
  };

  syms.forEach(sym => {
    const el  = idx[sym];
    const row = document.createElement('div');
    const isSelected = sym === devState.activeKey;
    const isCurrent  = sym === selElem;
    row.className = 'node dev-mat-row'
      + (isSelected ? ' selected' : '')
      + (isCurrent  ? ' dev-mat-assigned' : '');

    const chk = document.createElement('input');
    chk.type    = 'checkbox';
    chk.checked = devState.checked.has(sym);
    chk.className = 'dev-mat-chk';
    chk.onclick = e => {
      e.stopPropagation();
      if (chk.checked) devState.checked.add(sym);
      else             devState.checked.delete(sym);
      $('devCount').textContent = `${devState.checked.size}/${syms.length}`;
    };

    // Dot con color del grupo
    const dot = document.createElement('span');
    dot.className = 'node-stage';
    const gc = groupColors[el.group] || '#aaa';
    dot.style.cssText = `background:${gc};color:#000;font-size:7px;padding:1px 4px`;
    dot.textContent = (el.number ?? '?');

    // Label: símbolo + nombre
    const lbl = document.createElement('span');
    lbl.className = 'node-name';
    lbl.textContent = `${sym} — ${el.name_es ?? el.name ?? sym}`;
    lbl.style.fontSize = '10px';

    row.appendChild(chk); row.appendChild(dot); row.appendChild(lbl);

    // Badge si es el elemento de preview o tiene override
    if (isCurrent && !isSelected) {
      const tag = document.createElement('span');
      tag.style.cssText = 'font-size:8px;color:#00e5ff;margin-left:auto';
      tag.textContent = '◉';
      row.appendChild(tag);
    } else if (devState.overrides[sym]) {
      const tag = document.createElement('span');
      tag.style.cssText = 'font-size:8px;color:var(--accent2);margin-left:auto';
      tag.textContent = '✦';
      row.appendChild(tag);
    }

    row.onclick = () => selectDevMat(sym);
    list.appendChild(row);
  });

  if (list.children.length === 0)
    list.innerHTML = '<p style="padding:8px;font-size:10px;color:rgba(255,255,255,0.3)">Sin elementos</p>';
}

async function selectDevMat(sym) {
  devState.activeKey = sym;
  buildDevMatList();

  const el = APP.elementsIndex?.[sym] ?? {};
  $('devMatLabel').textContent = el.name_es ?? el.name ?? sym;
  $('devFamLabel').textContent = el.group?.replace(/_/g, ' ') ?? '';
  $('devEditorTitle').textContent = sym;

  // Prioridad:
  // 1. Override manual del usuario (en memoria)
  // 2. Preset guardado en /src/materials/{sym}.json
  // 3. Params físicos de /src/material_params/{sym}_params.json
  // 4. Pipeline hardcodeado del MATERIALS viejo (fallback final)
  let pipeline = devState.overrides[sym] ?? null;

  if (!pipeline) {
    const existing = await tryLoadExisting(sym);
    if (existing) pipeline = hydrateFromJSON(existing);
  }

  if (!pipeline) {
    const fromParams = await buildPipelineFromParams(sym);
    if (fromParams) pipeline = hydrateRaw(fromParams);
  }

  if (!pipeline) {
    // Buscar en MATERIALS por el nombre viejo del material si existe
    const oldMatName = Object.keys(MATERIALS).find(k =>
      MATERIALS[k].name?.toLowerCase().includes(sym.toLowerCase())
    );
    pipeline = oldMatName ? hydrateBuiltin(oldMatName) : hydrateRaw(buildMinimalRaw());
  }

  devState.overrides[sym] = pipeline;

  const compiled = compileSafely(pipeline, 'sphere');
  devPreview.applyShaders(compiled.vert, compiled.frag);
  const devElem = devState.previewElement ?? sym;
  await devPreview.loadElement(devElem, 'all', compiled.vert, compiled.frag, 'sphere');

  renderDevEditor(sym, pipeline);
}

function hydrateBuiltin(key) {
  return MATERIALS[key].pipeline.map(node => {
    const def = APP.moduleDefs.find(d => d.id === node.key);
    return { ...node, def, id: Math.random().toString(36).slice(2) };
  });
}

/** Hidrata un array de nodos raw (sin def) — para pipelines generados desde params */
function hydrateRaw(rawNodes) {
  return rawNodes.map(node => {
    const def = APP.moduleDefs.find(d => d.id === node.key);
    return { ...node, def, id: Math.random().toString(36).slice(2) };
  });
}

/** Pipeline mínimo de emergencia — point_size + disc_shape + brightness */
function buildMinimalRaw() {
  return [
    { key: 'point_size', enabled: true, params: { sz: 1.0, bAmp: 0.0, persp: 50.0 }, custom: false },
    { key: 'disc_shape',  enabled: true, params: { radius: 0.46, soft: 0.25, ring: 0.0 }, custom: false },
    { key: 'brightness',  enabled: true, params: { bright: 1.5, base: 0.35, vari: 0.0 }, custom: false },
    { key: 'alpha_curve', enabled: true, params: { curve: 1.0, opacity: 0.7, floor: 0.0 }, custom: false },
  ];
}

function hydrateFromJSON(json) {
  return (json.pipeline ?? []).map(node => {
    const def = APP.moduleDefs.find(d => d.id === node.key);
    return {
      id:      Math.random().toString(36).slice(2),
      key:     node.key, def,
      params:  { ...node.params },
      enabled: node.enabled ?? true,
      custom:  false,
    };
  });
}

function compileSafely(pipeline, target) {
  try { return compilePipeline(pipeline, target); }
  catch { return SH_CURRENT.orbital; }
}

function renderDevEditor(key, pipeline) {
  const body = $('devEditorBody');
  body.innerHTML = '';

  // Renderizar nodos inline (sin drag, sin select — solo parámetros)
  pipeline.forEach((node, idx) => {
    if (!node.def) return;
    const card = document.createElement('div');
    card.className = 'pg';

    const head = document.createElement('div');
    head.className = 'pg-head';
    head.style.color = node.def.color ?? 'var(--accent)';
    head.innerHTML = `${node.def.name || node.key}
      <span style="color:var(--text3);font-size:8px">${node.def.stage?.toUpperCase()}</span>
      <label style="margin-left:auto;font-size:9px;color:var(--text2)">
        <input type="checkbox" ${node.enabled ? 'checked' : ''}
          onchange="this.closest('.pg').dispatchEvent(new CustomEvent('toggleNode',{bubbles:true,detail:${idx}}))">
        ON
      </label>`;
    card.appendChild(head);

    Object.entries(node.def.params ?? {}).forEach(([pname, pd]) => {
      const val = node.params[pname] ?? pd.val;
      const row = document.createElement('div');
      row.className = 'pr';
      row.innerHTML = `<div class="plbl">${pname} <small>[${pd.min}…${pd.max}]</small></div>
        <div class="pctrl">
          <input type="range" min="${pd.min}" max="${pd.max}" step="${pd.step}" value="${val}" class="psl">
          <input type="text" value="${val}" class="ptx" style="width:52px">
        </div>`;
      const sl = row.querySelector('.psl');
      const tx = row.querySelector('.ptx');
      const upd = v => {
        const c = Math.min(pd.max, Math.max(pd.min, parseFloat(v)));
        if (isNaN(c)) return;
        node.params[pname] = c;
        sl.value = c; tx.value = c.toFixed(3);
        const compiled = compileSafely(pipeline, 'sphere');
        devPreview.applyShaders(compiled.vert, compiled.frag);
      };
      sl.addEventListener('input', () => upd(sl.value));
      tx.addEventListener('change', () => upd(tx.value));
      card.appendChild(row);
    });

    card.addEventListener('toggleNode', e => {
      pipeline[e.detail].enabled = !pipeline[e.detail].enabled;
      const compiled = compileSafely(pipeline, 'sphere');
      devPreview.applyShaders(compiled.vert, compiled.frag);
    });

    body.appendChild(card);
  });
}

// ── Dev: cargar .json personalizado para el material activo ──
function devLoadJSON(file) {
  file.text().then(txt => {
    try {
      const json = JSON.parse(txt);
      const key  = devState.activeKey;
      if (!key) { toast('Selecciona un material primero', 'err'); return; }
      devState.overrides[key] = hydrateFromJSON(json);
      selectDevMat(key);
      toast(`✦ Override cargado para ${key}`, 'ok');
    } catch (e) { toast('JSON inválido: ' + e.message, 'err'); }
  });
}

// ── Dev: exportar seleccionados ───────────────────────────────
async function devExport() {
  const keys = [...devState.checked];
  if (!keys.length) { toast('Ningún material seleccionado', 'err'); return; }
  toast(`⟳ Cargando params para ${keys.length} materiales…`, 'inf');

  // Asegurar que todos los elementos tienen su pipeline antes de exportar
  // Los que no tienen override se cargan desde params físicos
  for (const sym of keys) {
    if (devState.overrides[sym]) continue; // ya tiene pipeline

    // Intentar params físicos
    const fromParams = await buildPipelineFromParams(sym);
    if (fromParams) {
      devState.overrides[sym] = hydrateRaw(fromParams);
      continue;
    }

    // Fallback: pipeline mínimo
    devState.overrides[sym] = hydrateRaw(buildMinimalRaw());
  }

  toast(`⟳ Compilando ${keys.length} materiales…`, 'inf');
  const overrides = {};
  for (const k of keys)
    overrides[k] = devState.overrides[k] ?? null;

  if (devState.dirHandle) {
    const { ok, err } = await saveToDir(devState.dirHandle, keys, APP.moduleDefs, overrides, APP.elementsIndex);
    toast(`✓ ${ok} guardados${err ? ` · ${err} errores` : ''}`, ok > 0 ? 'ok' : 'err');
  } else {
    await downloadZip(keys, APP.moduleDefs, overrides, APP.elementsIndex);
    toast(`✓ ZIP con ${keys.length} materiales + index.json`, 'ok');
  }
}

// ── Presets ───────────────────────────────────────────────────
const BUILTIN_PRESETS = ['fe_nebula', 'fe_3d_rings'];
let BASE_MATERIALS = [];
fetch('../src/materials/index.json')
  .then(r => r.ok ? r.json() : { materials: [] })
  .then(idx => { BASE_MATERIALS = idx.materials ?? []; })
  .catch(() => {});
const LS_KEY = 'qsim_shaderlab_presets';

function getUserPresets() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch { return []; }
}
function saveUserPreset(p) {
  const list = getUserPresets().filter(x => x.name !== p.name);
  list.unshift(p);
  localStorage.setItem(LS_KEY, JSON.stringify(list));
}
function deleteUserPreset(name) {
  localStorage.setItem(LS_KEY, JSON.stringify(getUserPresets().filter(p => p.name !== name)));
}
function downloadPreset(preset) {
  const slug = preset.name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([JSON.stringify(preset, null, 2)], { type: 'application/json' })),
    download: `shader_${slug}.json`,
  });
  a.click(); URL.revokeObjectURL(a.href);
}

function applyPreset(preset) {
  APP.layer  = preset.layer  ?? 'all';
  APP.target = preset.target ?? 'orbital';
  APP.pipeline = (preset.pipeline ?? []).map(n => {
    const def = APP.moduleDefs.find(d => d.id === n.key);
    return {
      id: Math.random().toString(36).slice(2), key: n.key, def,
      params: { ...n.params }, enabled: n.enabled ?? false,
      custom: n.custom ?? false, customName: n.customName, customGlsl: n.customGlsl,
    };
  });
  setMode('custom');
  setTarget(APP.target);
  document.querySelectorAll('.layer-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.layer === APP.layer));
  if (preset.element) loadElement(preset.element);
  toast(`"${preset.name}" cargado ✓`, 'ok');
}

// Previsualizas un preset en el viewport sin cambiar modo ni pipeline
function previewPreset(preset) {
  const vert = preset.compiled?.vert;
  const frag = preset.compiled?.frag;
  if (vert && frag) {
    APP.activePreset = preset;  // guardar para re-aplicar después de loadElement
    preview.applyShaders(vert, frag);
    // Cargar el elemento del preset si es distinto al actual
    const sym = preset.element ?? APP.element;
    if (sym !== APP.element) loadElement(sym);
    setCst('ok', `👁 ${preset.name}`);
  } else {
    // Sin compiled — construir desde pipeline si es posible
    try {
      const hydratedPipeline = (preset.pipeline ?? []).map(n => ({
        ...n, def: APP.moduleDefs.find(d => d.id === n.key), id: Math.random().toString(36).slice(2)
      }));
      const { vert: v, frag: f } = compilePipeline(hydratedPipeline, preset.target ?? 'orbital');
      preview.applyShaders(v, f);
      setCst('ok', `👁 ${preset.name}`);
    } catch { setCst('err', 'Sin shader compilado'); }
  }
}

function renderPresetCard(preset, isUser = false) {
  const card = document.createElement('div');
  card.className = 'preset-card';
  card.dataset.name = preset.name ?? '';
  const badge = isUser
    ? '<span class="preset-badge user">💾 caché</span>'
    : '<span class="preset-badge builtin">⚗ built-in</span>';
  const layerLabel = { all:'All', core:'Core', semi:'Semi', valence:'Valencia' }[preset.layer] ?? preset.layer;
  const nodes = (preset.pipeline ?? []).filter(n => n.enabled).map(n => n.key).join(' · ');
  card.innerHTML = `
    <div class="preset-card__top">
      <span class="preset-card__name">${preset.name}</span>${badge}
    </div>
    <div class="preset-card__meta">${preset.element ?? '?'} · ${layerLabel}${preset.author ? ' · ' + preset.author : ''}</div>
    ${preset.description ? `<div class="preset-card__desc">${preset.description}</div>` : ''}
    <div class="preset-card__nodes">${nodes}</div>
    <div class="preset-card__actions">
      <button class="preset-btn edit">✦ Editar</button>
      <button class="preset-btn dl" title="Descargar JSON">⬇</button>
      ${isUser ? '<button class="preset-btn del" title="Borrar del caché">✕</button>' : ''}
    </div>`;
  // Click en la tarjeta → preview inmediato sin cambiar de modo
  card.addEventListener('click', e => {
    if (e.target.closest('.preset-card__actions')) return; // los botones manejan su propio evento
    previewPreset(preset);
  });
  card.querySelector('.edit').addEventListener('click', () => applyPreset(preset));
  card.querySelector('.dl').addEventListener('click',   () => downloadPreset(preset));
  if (isUser) {
    card.querySelector('.del').addEventListener('click', () => {
      deleteUserPreset(preset.name);
      renderPresetGallery();
      toast(`"${preset.name}" borrado del caché`, 'ok');
    });
  }
  return card;
}

async function renderPresetGallery() {
  const list = $('presetList');
  if (!list) return;
  list.innerHTML = '';

  // Filtrar por target activo — sphere muestra materiales de esfera, orbital los de orbital
  const matchesTarget = p => !p.target || p.target === APP.target || p.target === 'all';

  for (const p of getUserPresets().filter(matchesTarget))
    list.appendChild(renderPresetCard(p, true));
  for (const id of BUILTIN_PRESETS) {
    try {
      const res = await fetch(`shader_modules/presets/${id}.json`);
      if (res.ok) {
        const p = await res.json();
        if (matchesTarget(p)) list.appendChild(renderPresetCard(p, false));
      }
    } catch { /* silencioso */ }
  }
  const hasBase = BASE_MATERIALS.length > 0;
  if (hasBase) {
    const sep = document.createElement('div');
    sep.className = 'preset-separator';
    sep.textContent = '⚛ Materiales base';
    list.appendChild(sep);
  }
  for (const id of BASE_MATERIALS) {
    try {
      const res = await fetch(`../src/materials/${id}.json`);
      if (res.ok) {
        const p = await res.json();
        if (matchesTarget(p)) list.appendChild(renderPresetCard(p, false));
      }
    } catch { /* silencioso */ }
  }
  if (list.children.length === 0)
    list.innerHTML = '<p class="preset-empty">No hay presets aún.<br>Guarda uno desde Custom ✦</p>';
}

// ── Save / Load preset ────────────────────────────────────────
// Selecciona y previsualizea la tarjeta de la galería cuyo nombre coincide
// con el material asignado al elemento en elements-index.json
function selectPresetCardByName(matName) {
  const list = $('presetList');
  if (!list || !matName) return;

  // Quitar selección anterior
  list.querySelectorAll('.preset-card').forEach(c => c.classList.remove('preset-card--active'));

  // Buscar por data-name (más robusto que buscar en el DOM del texto)
  const normalize = s => s.trim().toLowerCase().replace(/[\s_-]/g, '');
  const target    = normalize(matName);

  const card = [...list.querySelectorAll('.preset-card')]
    .find(c => normalize(c.dataset.name ?? '') === target);

  if (card) {
    card.classList.add('preset-card--active');
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    card.click(); // previsualizea el shader automáticamente
  }
}

function savePreset() {
  const { vert, frag } = getShaders();
  const out = {
    version: '3.0', created: new Date().toISOString(),
    mode: APP.mode, target: APP.target, layer: APP.layer, element: APP.element,
    pipeline: APP.pipeline.map(n => ({
      key: n.key, enabled: n.enabled, params: { ...n.params },
      custom: n.custom ?? false, customName: n.customName, customGlsl: n.customGlsl,
    })),
    compiled: { vert, frag },
  };
  if (APP.mode === 'custom') {
    const name = prompt('Nombre del preset:', `${APP.element} ${APP.layer}`);
    if (name === null) return;
    out.name = name.trim() || `Preset ${Date.now()}`;
    saveUserPreset(out);
    downloadPreset(out);
    renderPresetGallery();
    toast(`"${out.name}" guardado ✓`, 'ok');
  } else {
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' })),
      download: `shader_current_${APP.target}_${Date.now()}.json`,
    });
    a.click(); URL.revokeObjectURL(a.href);
    toast('Shader current descargado ✓', 'ok');
  }
}

async function loadPreset(file) {
  try {
    const p = JSON.parse(await file.text());
    applyPreset(p);
    if (p.name && !getUserPresets().find(u => u.name === p.name)) {
      if (confirm(`¿Guardar "${p.name}" en la galería?`)) {
        saveUserPreset(p); renderPresetGallery();
        toast(`"${p.name}" guardado en caché ✓`, 'ok');
      }
    }
  } catch (e) { toast('Error: ' + e.message, 'err'); }
}

// ── UI helpers ────────────────────────────────────────────────
function setCst(type, msg) {
  const el = $('cst');
  el.className = 'cst ' + type;
  el.textContent = msg;
}

// ── Eventos ───────────────────────────────────────────────────
function bindEvents() {
  // Botón Dev
  $('btnDevMode').addEventListener('click', () => {
    const on = $('bodyDev').style.display === 'none';
    setDevMode(on);
  });

  // Mode tabs
  document.querySelectorAll('.mode-tab:not(.dev-tab)').forEach(t =>
    t.addEventListener('click', () => {
      if ($('bodyDev').style.display !== 'none') setDevMode(false);
      setMode(t.dataset.mode);
    }));

  // Target toggle
  document.querySelectorAll('.tgt-btn').forEach(b =>
    b.addEventListener('click', () => setTarget(b.dataset.tgt)));

  // Layer bar
  document.querySelectorAll('.layer-btn').forEach(b =>
    b.addEventListener('click', () => setLayer(b.dataset.layer)));

  // Pipeline controls
  $('btnAdd').addEventListener('click', () => openAddModal(APP, APP.moduleDefs));
  $('btnReset').addEventListener('click', resetPipeline);

  // Modal close
  $('modalClose').addEventListener('click', () => $('modalOverlay').classList.remove('open'));
  $('modalOverlay').addEventListener('click', e => {
    if (e.target === $('modalOverlay')) $('modalOverlay').classList.remove('open');
  });

  // Save / Load
  $('btnSave').addEventListener('click', savePreset);
  $('btnLoad').addEventListener('click', () => $('fileInput').click());
  $('fileInput').addEventListener('change', e => {
    if (e.target.files[0]) loadPreset(e.target.files[0]);
    e.target.value = '';
  });

  // Dev: cargar JSON personalizado
  $('devBtnLoadJSON').addEventListener('click', () => $('devFileInput').click());
  $('devFileInput').addEventListener('change', e => {
    if (e.target.files[0]) devLoadJSON(e.target.files[0]);
    e.target.value = '';
  });

  // Dev: recompilar y actualizar preview
  $('devBtnRecompile').addEventListener('click', () => {
    const key = devState.activeKey;
    if (!key) { toast('Selecciona un material', 'err'); return; }
    const pipeline = devState.overrides[key];
    if (!pipeline) return;
    const compiled = compileSafely(pipeline, 'sphere');
    devPreview.applyShaders(compiled.vert, compiled.frag);
    toast('Compilado ✓', 'ok');
  });

  // Dev: seleccionar carpeta
  $('devBtnPickDir').addEventListener('click', async () => {
    try {
      devState.dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
      toast(`📁 ${devState.dirHandle.name}`, 'ok');
      $('devBtnPickDir').textContent = `📁 ${devState.dirHandle.name.slice(0,10)}`;
    } catch (e) { if (e.name !== 'AbortError') toast('Error', 'err'); }
  });

  // Dev: exportar ZIP / guardar en carpeta
  $('devBtnExport').addEventListener('click', devExport);

  // Dev: check all / none
  $('devChkAll').addEventListener('change', e => {
    const allSyms = Object.keys(APP.elementsIndex ?? {});
    if (e.target.checked) allSyms.forEach(s => devState.checked.add(s));
    else devState.checked.clear();
    buildDevMatList();
    $('devCount').textContent = `${devState.checked.size}/${allSyms.length}`;
  });
}

// ── Init ──────────────────────────────────────────────────────
async function init() {
  initPreview();
  await loadModules();
  await buildElemSelect();
  bindEvents();
  await setMode('current');  // espera que la galería cargue
  setTarget('sphere');       // Current muestra materiales de esfera — más honesto
  setLayer('all');
  await loadElement(APP.element);
}

init();

