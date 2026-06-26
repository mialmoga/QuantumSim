/**
 * ui.js — UI del pipeline y panel de parámetros
 *
 * Responsabilidades:
 *  - renderPipeline(): dibuja los nodos arrastrables
 *  - renderParams(node): dibuja sliders/textbox del nodo seleccionado
 *  - renderModeInfo(): panel de Current mode
 *  - Modal de añadir nodo (catálogo + custom GLSL)
 */

import { SH_CURRENT, validatePipeline } from './compiler.js';

const $ = id => document.getElementById(id);

/** Formatea un número para mostrar en textbox */
function fmt(v, step) {
  if (step < 0.01)  return v.toFixed(4);
  if (step < 0.1)   return v.toFixed(3);
  if (step < 1)     return v.toFixed(2);
  return v.toFixed(1);
}

function mkEl(tag, cls) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}

// ══════════════════════════════════════════════════════════════
// PIPELINE RENDER
// ══════════════════════════════════════════════════════════════

export function renderPipeline(app) {
  const list = $('nodesList');
  list.innerHTML = '';

  if (app.mode !== 'custom') {
    // En current: lista vacía — el panel derecho muestra renderModeInfo
    return;
  }

  // Validar dependencias de todo el pipeline de una vez
  const validated = validatePipeline(app.pipeline);

  app.pipeline.forEach((node, idx) => {
    const def      = node.def;
    const vNode    = validated[idx];  // { active, reason }

    // Estado del nodo: disabled > conflict > active
    let statusDot   = '';
    let statusClass = '';
    if (!node.enabled) {
      statusDot   = '';   // el ○ ya lo indica
      statusClass = '';
    } else if (!vNode.active) {
      statusDot   = `<span class="node-status conflict" title="${vNode.reason ?? 'Dependencia no satisfecha'}">●</span>`;
      statusClass = ' conflict';
    } else {
      statusDot   = `<span class="node-status ok" title="Activo">●</span>`;
      statusClass = ' ok';
    }

    const el  = mkEl('div', 'node'
      + (node.enabled ? '' : ' disabled')
      + (app.selected === node.id ? ' selected' : '')
      + (node.custom ? ' custom-node' : '')
      + statusClass);
    el.dataset.id      = node.id;
    el.dataset.nodeIdx = idx;

    const stageCls  = def?.stage ?? 'vert';
    const nodeColor = node.custom ? 'var(--purple)' : (def?.color ?? 'var(--text2)');
    const nodeName  = node.custom ? (node.customName || 'Custom') : (def?.name ?? node.key);
    const nodeSub   = node.custom ? node.customGlsl?.slice(0, 40) + '…' : (def?.sub ?? '');

    el.innerHTML = `
      <div class="node-head">
        <span class="node-grip">⠿</span>
        <span class="node-idx">${idx + 1}</span>
        <span class="node-name" style="color:${nodeColor}">${nodeName}</span>
        ${statusDot}
        <span class="node-stage ${stageCls}">${stageCls}</span>
        <button class="node-en"  title="${node.enabled ? 'Desactivar' : 'Activar'}">${node.enabled ? '●' : '○'}</button>
        <button class="node-del" title="Eliminar">✕</button>
      </div>
      <div class="node-sub">${nodeSub}</div>`;

    // Seleccionar
    el.addEventListener('click', e => {
      if (e.target.classList.contains('node-en')) return;
      if (e.target.classList.contains('node-del')) return;
      app.selected = node.id;
      renderPipeline(app);
      renderParams(app, node);
    });

    // Toggle enable
    el.querySelector('.node-en').addEventListener('click', e => {
      e.stopPropagation();
      node.enabled = !node.enabled;
      renderPipeline(app);
      app.onPipelineChange?.();
    });

    // Eliminar
    el.querySelector('.node-del').addEventListener('click', e => {
      e.stopPropagation();
      app.pipeline = app.pipeline.filter(n => n.id !== node.id);
      if (app.selected === node.id) {
        app.selected = null;
        renderParams(app, null);
      }
      renderPipeline(app);
      app.onPipelineChange?.();
    });

    // Drag & drop — mouse
    el.setAttribute('draggable', 'true');
    el.addEventListener('dragstart', e => {
      e.dataTransfer.setData('idx', String(idx));
    });
    el.addEventListener('dragover', e => {
      e.preventDefault();
      list.querySelectorAll('.node').forEach(n => n.classList.remove('dov-top', 'dov-bot'));
      const r = el.getBoundingClientRect();
      el.classList.add(e.clientY < r.top + r.height / 2 ? 'dov-top' : 'dov-bot');
    });
    el.addEventListener('dragleave', () => el.classList.remove('dov-top', 'dov-bot'));
    el.addEventListener('drop', e => {
      e.preventDefault();
      const from = parseInt(e.dataTransfer.getData('idx'));
      if (isNaN(from) || from === idx) return;
      const r = el.getBoundingClientRect();
      const above = e.clientY < r.top + r.height / 2;
      const [mv] = app.pipeline.splice(from, 1);
      let to = above ? idx : idx + 1;
      if (from < idx) to--;
      app.pipeline.splice(Math.max(0, to), 0, mv);
      renderPipeline(app);
      app.onPipelineChange?.();
      toast('Pipeline reordenado', 'ok');
    });

    // Touch drag & drop — para móvil
    // Usamos el grip ⠿ como handle exclusivo para no interferir con scroll
    const grip = el.querySelector('.node-grip');
    let _touchDragIdx = null;
    let _touchClone   = null;

    grip.addEventListener('touchstart', e => {
      e.stopPropagation();
      _touchDragIdx = idx;
      // Clonar visualmente el nodo para arrastrar
      _touchClone = el.cloneNode(true);
      _touchClone.style.cssText = `
        position:fixed; opacity:0.85; pointer-events:none; z-index:9999;
        width:${el.offsetWidth}px; box-shadow:0 4px 20px rgba(0,0,0,0.6);
        background:var(--bg2); border:1px solid var(--accent);
      `;
      document.body.appendChild(_touchClone);
      el.classList.add('dragging');
    }, { passive: true });

    grip.addEventListener('touchmove', e => {
      if (_touchDragIdx === null || !_touchClone) return;
      e.preventDefault();
      const t = e.touches[0];
      _touchClone.style.left = (t.clientX - _touchClone.offsetWidth / 2) + 'px';
      _touchClone.style.top  = (t.clientY - 20) + 'px';

      // Highlight el nodo destino
      list.querySelectorAll('.node').forEach(n => n.classList.remove('dov-top', 'dov-bot'));
      const target = document.elementFromPoint(t.clientX, t.clientY)?.closest('.node');
      if (target && target !== el) {
        const r = target.getBoundingClientRect();
        target.classList.add(t.clientY < r.top + r.height / 2 ? 'dov-top' : 'dov-bot');
      }
    }, { passive: false });

    grip.addEventListener('touchend', e => {
      if (_touchDragIdx === null) return;
      const t = e.changedTouches[0];
      const target = document.elementFromPoint(t.clientX, t.clientY)?.closest('.node');

      // Limpiar clone y estado visual
      _touchClone?.remove(); _touchClone = null;
      el.classList.remove('dragging');
      list.querySelectorAll('.node').forEach(n => n.classList.remove('dov-top', 'dov-bot'));

      if (target && target !== el) {
        const toIdx = parseInt(target.dataset.nodeIdx ?? -1);
        if (toIdx >= 0 && toIdx !== _touchDragIdx) {
          const r = target.getBoundingClientRect();
          const above = t.clientY < r.top + r.height / 2;
          const [mv] = app.pipeline.splice(_touchDragIdx, 1);
          let to = above ? toIdx : toIdx + 1;
          if (_touchDragIdx < toIdx) to--;
          app.pipeline.splice(Math.max(0, to), 0, mv);
          renderPipeline(app);
          app.onPipelineChange?.();
          toast('Pipeline reordenado', 'ok');
        }
      }
      _touchDragIdx = null;
    }, { passive: true });

    list.appendChild(el);
  });
}

// ══════════════════════════════════════════════════════════════
// PARAMS RENDER
// ══════════════════════════════════════════════════════════════

export function renderParams(app, node) {
  const body = $('paramsBody');
  $('paramsTitle').textContent = node
    ? (node.custom ? node.customName || 'Custom' : node.def?.name ?? node.key)
    : 'Parámetros';

  if (!node) {
    body.innerHTML = `<div class="empty-msg">
      <div class="empty-icon">⚙</div>
      <div class="empty-txt">Selecciona un nodo para editar sus parámetros</div>
    </div>`;
    return;
  }

  body.innerHTML = '';

  // ── Validar este nodo en contexto del pipeline ─────────────
  const validated = validatePipeline(app.pipeline);
  const vNode     = validated.find(v => v.id === node.id);
  const isConflict = node.enabled && vNode && !vNode.active;

  if (isConflict) {
    const banner = mkEl('div', 'params-conflict-banner');
    banner.innerHTML = `⚠ Nodo inactivo — ${vNode.reason}`;
    body.appendChild(banner);
  }

  // ── Custom GLSL node ──────────────────────────────────────
  if (node.custom) {
    const wrap = mkEl('div', isConflict ? 'params-inactive-wrap' : '');
    _renderCustomParams(app, node, wrap);
    body.appendChild(wrap);
    return;
  }

  const def = node.def;
  if (!def) return;

  // Wrapper — grayed out si el nodo tiene conflicto de dependencias
  const wrap = mkEl('div', isConflict ? 'params-inactive-wrap' : '');

  // Info card
  const ic = mkEl('div', 'pg');
  ic.innerHTML = `
    <div class="pg-head" style="color:${def.color ?? 'var(--accent)'}">
      ${def.name}
      <span style="color:var(--text3);font-size:8px">${def.stage.toUpperCase()} · ${(def.target ?? []).join('/')}</span>
    </div>
    <div class="pr"><div class="plbl" style="color:var(--text3);font-style:italic">${def.desc ?? ''}</div></div>`;
  wrap.appendChild(ic);

  // Sliders
  const sg = mkEl('div', 'pg');
  sg.innerHTML = '<div class="pg-head">Variables</div>';
  const glslBox = mkEl('div', 'glsl-preview-box');

  const updateGlsl = () => {
    glslBox.textContent = def.glsl.replace(/\{\{(\w+)\}\}/g, (_, k) => {
      const v = node.params[k]; return v !== undefined ? Number(v).toFixed(3) : '?';
    });
  };
  updateGlsl();

  Object.entries(def.params ?? {}).forEach(([key, pd]) => {
    const row = mkEl('div', 'pr');
    const cur = node.params[key] ?? pd.val;
    row.innerHTML = `
      <div class="plbl">${pd.label} <small>[${pd.min}…${pd.max}]</small></div>
      <div class="pctrl">
        <input type="range" class="psl" min="${pd.min}" max="${pd.max}" step="${pd.step}" value="${cur}">
        <input type="text"  class="ptx" value="${fmt(cur, pd.step)}">
      </div>`;

    const sl = row.querySelector('.psl');
    const tx = row.querySelector('.ptx');
    const upd = v => {
      const c = Math.min(pd.max, Math.max(pd.min, parseFloat(v)));
      if (isNaN(c)) return;
      node.params[key] = c;
      sl.value = c; tx.value = fmt(c, pd.step);
      updateGlsl();
      app.onPipelineChange?.();
    };
    sl.addEventListener('input',   () => upd(sl.value));
    tx.addEventListener('change',  () => upd(tx.value));
    tx.addEventListener('keydown', e => { if (e.key === 'Enter') upd(tx.value); });
    sg.appendChild(row);
  });
  wrap.appendChild(sg);

  // GLSL preview
  const gg = mkEl('div', 'pg');
  gg.innerHTML = '<div class="pg-head">GLSL generado</div>';
  gg.appendChild(glslBox);
  wrap.appendChild(gg);

  body.appendChild(wrap);
}

function _renderCustomParams(app, node, body) {
  // Stage selector
  const sc = mkEl('div', 'pg');
  sc.innerHTML = `
    <div class="pg-head" style="color:var(--purple)">
      Custom GLSL
      <span style="color:var(--text3);font-size:8px">edición directa</span>
    </div>
    <div class="pr">
      <div class="plbl">Nombre</div>
      <input type="text" class="ptx" style="width:100%;text-align:left" id="cname" value="${node.customName || ''}">
    </div>
    <div class="pr">
      <div class="plbl">Stage</div>
      <div class="pctrl" style="gap:8px">
        <button class="pact stage-btn ${node.def.stage==='vert'?'active':''}" data-s="vert">VERT</button>
        <button class="pact stage-btn ${node.def.stage==='frag'?'active':''}" data-s="frag">FRAG</button>
      </div>
    </div>`;

  sc.querySelector('#cname').addEventListener('change', e => {
    node.customName = e.target.value;
    renderPipeline(app);
  });
  sc.querySelectorAll('.stage-btn').forEach(b => b.addEventListener('click', () => {
    node.def = { ...node.def, stage: b.dataset.s };
    sc.querySelectorAll('.stage-btn').forEach(x => x.classList.toggle('active', x === b));
    app.onPipelineChange?.();
  }));
  body.appendChild(sc);

  // Editor GLSL
  const eg = mkEl('div', 'pg');
  eg.innerHTML = `
    <div class="pg-head" style="color:var(--purple)">
      Código GLSL
      <button class="pact" id="compileCustom" style="color:var(--green)">▶ Compilar</button>
    </div>
    <div class="pr">
      <div class="plbl" style="color:var(--text3)">Variables bus disponibles:<br>
        VERT: vBlink, vPhase, wpos, mvP<br>
        FRAG: col (vec3), alpha, d</div>
    </div>
    <div class="pr">
      <textarea class="glsl-editor" id="glslEditorArea" spellcheck="false">${node.customGlsl || ''}</textarea>
    </div>`;

  eg.querySelector('#compileCustom').addEventListener('click', () => {
    node.customGlsl = eg.querySelector('#glslEditorArea').value;
    renderPipeline(app);
    app.onPipelineChange?.();
    toast('Custom compilado', 'ok');
  });
  eg.querySelector('#glslEditorArea').addEventListener('keydown', e => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const s = e.target.selectionStart;
      e.target.value = e.target.value.slice(0, s) + '  ' + e.target.value.slice(e.target.selectionEnd);
      e.target.selectionStart = e.target.selectionEnd = s + 2;
    }
  });
  body.appendChild(eg);
}

// ══════════════════════════════════════════════════════════════
// MODE INFO (Current)
// ══════════════════════════════════════════════════════════════

export function renderModeInfo(target) {
  const body = $('paramsBody');
  const sh   = SH_CURRENT[target] ?? SH_CURRENT.orbital;
  $('paramsTitle').textContent = 'Current Shader';
  body.innerHTML = `<div class="mode-info">
    <h2 style="color:var(--green);margin-bottom:6px">Current</h2>
    <p style="font-size:10px;color:var(--text2);line-height:1.7;margin-bottom:12px">
      Shader del QuantumRenderer — máxima calidad visual.<br>
      Haz clic en un preset de la lista para previsualizarlo.<br>
      Usa <b style="color:var(--accent2)">Custom ✦</b> para editar el pipeline.
    </p>
    <div class="pg-head" style="margin-bottom:6px">GLSL compilado · ${target}</div>
    <pre style="font-size:8px;line-height:1.5;overflow:auto;max-height:220px;color:var(--text2)">${sh.frag.trim()}</pre>
  </div>`;
}

// ══════════════════════════════════════════════════════════════
// MODAL — Añadir nodo
// ══════════════════════════════════════════════════════════════

export function openAddModal(app, moduleDefs) {
  const overlay = $('modalOverlay');
  const grid    = $('modalGrid');
  let   filter  = 'all';

  const render = () => {
    grid.innerHTML = '';

    // Tarjeta custom GLSL — siempre primera
    const cc = mkEl('div', 'mod-card custom-card');
    cc.innerHTML = `
      <div class="mod-card-name" style="color:var(--purple)">✦ Custom GLSL</div>
      <div class="mod-card-stage">vert / frag · tu código</div>
      <div class="mod-card-desc">Escribe GLSL directamente.\nAccede a las variables del bus.</div>`;
    cc.addEventListener('click', () => {
      _addCustomNode(app);
      overlay.classList.remove('open');
    });
    grid.appendChild(cc);

    // Módulos disponibles
    moduleDefs.forEach(def => {
      if (filter !== 'all' && def.stage !== filter) return;
      // No mostrar los que ya están en el pipeline (evitar duplicados accidentales)
      const card = mkEl('div', 'mod-card');
      card.innerHTML = `
        <div class="mod-card-name" style="color:${def.color ?? 'var(--text1)'}">${def.name}</div>
        <div class="mod-card-stage">${def.stage.toUpperCase()} · ${(def.target ?? []).join('/')}</div>
        <div class="mod-card-desc">${def.desc ?? ''}</div>`;
      card.addEventListener('click', () => {
        _addNode(app, def);
        overlay.classList.remove('open');
      });
      grid.appendChild(card);
    });
  };

  // Filter buttons
  $('modalOverlay').querySelectorAll('.mf-btn').forEach(b => {
    b.addEventListener('click', () => {
      filter = b.dataset.f;
      $('modalOverlay').querySelectorAll('.mf-btn').forEach(x => x.classList.toggle('active', x === b));
      render();
    });
  });

  render();
  overlay.classList.add('open');
}

function _addNode(app, def) {
  const node = {
    id:      Math.random().toString(36).slice(2),
    key:     def.id,
    def,
    params:  Object.fromEntries(Object.entries(def.params ?? {}).map(([k, p]) => [k, p.val])),
    enabled: false,  // apagado por defecto
    custom:  false,
  };
  app.pipeline.push(node);
  app.selected = node.id;
  renderPipeline(app);
  renderParams(app, node);
  app.onPipelineChange?.();
  toast(`+ ${def.name} añadido (apagado)`, 'inf');
}

function _addCustomNode(app) {
  const node = {
    id:         Math.random().toString(36).slice(2),
    key:        'custom',
    def:        { id: 'custom', name: 'Custom', stage: 'frag', target: ['orbital','sphere'], color: 'var(--purple)' },
    params:     {},
    enabled:    false,
    custom:     true,
    customName: 'Custom',
    customGlsl: '// Escribe tu GLSL aquí\n// Variables disponibles: col, alpha, d (frag) / vBlink, wpos (vert)\n',
  };
  app.pipeline.push(node);
  app.selected = node.id;
  renderPipeline(app);
  renderParams(app, node);
  toast('+ Custom GLSL añadido', 'inf');
}

// ══════════════════════════════════════════════════════════════
// TOAST (helper global)
// ══════════════════════════════════════════════════════════════

export function toast(msg, type = 'ok') {
  const t = $('toast');
  t.textContent = msg;
  t.className = `toast show ${type}`;
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove('show'), 2400);
}


// ── Fullscreen ────────────────────────────────────────────────────────────────
const fsBtn = document.getElementById('qv-fullscreen-btn');
if (fsBtn) {
    const updateFsIcon = () => {
        const isFull = !!(document.fullscreenElement || document.webkitFullscreenElement);
        fsBtn.textContent = isFull ? '✕' : '⛶';
        fsBtn.title = isFull ? 'Salir de pantalla completa' : 'Pantalla completa';
    };
    fsBtn.addEventListener('click', () => {
        const el = document.documentElement;
        if (document.fullscreenElement || document.webkitFullscreenElement) {
            (document.exitFullscreen || document.webkitExitFullscreen).call(document);
        } else {
            (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
        }
    });
    document.addEventListener('fullscreenchange',       updateFsIcon);
    document.addEventListener('webkitfullscreenchange', updateFsIcon);
}

