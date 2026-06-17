/* =====================================================
   Claude HUD — Webview frontend script
   Handles: rendering, canvas, drag-reorder,
            candlestick K-line chart toggle
   ===================================================== */

// ---- Theme detection & palette ----
let theme = {
  kind: 'dark',
  bg: '#18181b',
  surface: '#27272a',
  border: '#3f3f46',
  borderDim: 'rgba(63, 63, 70, 0.5)',
  accent: '#34d399',
  accentDim: 'rgba(52, 211, 153, {alpha})',
  text: '#f4f4f5',
  textDim: '#a1a1aa',
  textMuted: '#52525b',
  textMuted2: '#71717a',
  warning: '#fbbf24',
  danger: '#f87171',
  canvasBg: '#18181b',
  canvasFade: 'rgba(24, 24, 27, {alpha})',
};

function detectTheme() {
  const style = getComputedStyle(document.documentElement);
  // VS Code injects --vscode-* CSS vars into webviews; try the editor foreground
  const fg = style.getPropertyValue('--vscode-editor-foreground').trim();
  let isLight = false;
  if (fg) {
    const m = fg.match(/(\d+)/g);
    if (m) {
      const brightness = (parseInt(m[0]) * 299 + parseInt(m[1]) * 587 + parseInt(m[2]) * 114) / 1000;
      isLight = brightness > 128;
    }
  }

  theme.kind = isLight ? 'light' : 'dark';

  if (isLight) {
    const bg = style.getPropertyValue('--vscode-editor-background').trim() || '#ffffff';
    const fgColor = style.getPropertyValue('--vscode-editor-foreground').trim() || '#1a1a1a';
    theme.bg = bg;
    theme.surface = '#f4f4f5';
    theme.border = '#d4d4d8';
    theme.borderDim = 'rgba(161, 161, 170, 0.4)';
    theme.accent = '#059669';
    theme.accentDim = 'rgba(5, 150, 105, {alpha})';
    theme.text = fgColor;
    theme.textDim = '#52525b';
    theme.textMuted = '#a1a1aa';
    theme.textMuted2 = '#a1a1aa';
    theme.warning = '#d97706';
    theme.danger = '#dc2626';
    theme.canvasBg = '#fafafa';
    theme.canvasFade = 'rgba(250, 250, 250, {alpha})';
  } else {
    theme.bg = '#18181b';
    theme.surface = '#27272a';
    theme.border = '#3f3f46';
    theme.borderDim = 'rgba(63, 63, 70, 0.5)';
    theme.accent = '#34d399';
    theme.accentDim = 'rgba(52, 211, 153, {alpha})';
    theme.text = '#f4f4f5';
    theme.textDim = '#a1a1aa';
    theme.textMuted = '#52525b';
    theme.textMuted2 = '#71717a';
    theme.warning = '#fbbf24';
    theme.danger = '#f87171';
    theme.canvasBg = '#18181b';
    theme.canvasFade = 'rgba(24, 24, 27, {alpha})';
  }

  // Set data attribute for CSS overrides
  document.documentElement.setAttribute('data-theme', isLight ? 'light' : 'dark');

  // Update module surface backgrounds
  document.querySelectorAll('.hud-module').forEach(el => {
    el.style.background = theme.surface;
    el.style.borderColor = theme.borderDim;
  });
}

// Themed color helpers
function ta(color, alpha) { return color.replace('{alpha}', alpha); }
function tg(alpha) { return ta(theme.accentDim, alpha); }

/** Set theme palette directly from a known isLight value (bypasses CSS var detection) */
function setTheme(isLight) {
  theme.kind = isLight ? 'light' : 'dark';

  if (isLight) {
    theme.bg = '#ffffff';
    theme.surface = '#f4f4f5';
    theme.border = '#d4d4d8';
    theme.borderDim = 'rgba(161, 161, 170, 0.4)';
    theme.accent = '#059669';
    theme.accentDim = 'rgba(5, 150, 105, {alpha})';
    theme.text = '#18181b';
    theme.textDim = '#52525b';
    theme.textMuted = '#a1a1aa';
    theme.textMuted2 = '#a1a1aa';
    theme.warning = '#d97706';
    theme.danger = '#dc2626';
    theme.canvasBg = '#fafafa';
    theme.canvasFade = 'rgba(250, 250, 250, {alpha})';
  } else {
    theme.bg = '#18181b';
    theme.surface = '#27272a';
    theme.border = '#3f3f46';
    theme.borderDim = 'rgba(63, 63, 70, 0.5)';
    theme.accent = '#34d399';
    theme.accentDim = 'rgba(52, 211, 153, {alpha})';
    theme.text = '#f4f4f5';
    theme.textDim = '#a1a1aa';
    theme.textMuted = '#52525b';
    theme.textMuted2 = '#71717a';
    theme.warning = '#fbbf24';
    theme.danger = '#f87171';
    theme.canvasBg = '#18181b';
    theme.canvasFade = 'rgba(24, 24, 27, {alpha})';
  }

  // Set data attribute for CSS overrides
  document.documentElement.setAttribute('data-theme', isLight ? 'light' : 'dark');

  // Update module surface backgrounds
  document.querySelectorAll('.hud-module').forEach(el => {
    el.style.background = theme.surface;
    el.style.borderColor = theme.borderDim;
  });
}

// ---- State ----
const isChineseLocale = navigator.language.startsWith('zh');
let currentData = null;
let modules = {
  agentStatus: true,
  tokenFlow: true,
  contextWindow: true,
  historyChart: true,
  sessionTime: true,
  cost: true,
  todos: true,
};
let chartMode = '24h';
let displayMode = 'matrix'; // 'matrix' | 'candle' | 'balls'
let smoothedRate = 0;   // EMA-smoothed token burst rate
let ballFrameCount = 0; // frame counter for deterministic ball drift

// Drag state
let dragSrcEl = null;

// ---- Helpers ----
function formatTokens(n) {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return `${n}`;
}

// ---- i18n helper ----
function t(key, params) {
  const locale = window.__LOCALE__ || {};
  const keys = key.split('.');
  let val = locale;
  for (const k of keys) {
    if (val && typeof val === 'object' && k in val) {
      val = val[k];
    } else {
      return key; // fallback to key name
    }
  }
  if (typeof val !== 'string') return key;
  if (!params) return val;
  return val.replace(/\{(\w+)\}/g, (_, p) => params[p] !== undefined ? params[p] : `{${p}}`);
}

// ---- VSCode API ----
const vscode = acquireVsCodeApi();

// ---- DOM refs ----
const $ = (id) => document.getElementById(id);

// ---- Init ----
document.addEventListener('DOMContentLoaded', () => {
  // Detect VS Code theme
  detectTheme();

  // Listen for VS Code theme changes via postMessage from the extension (authoritative source)
  window.addEventListener('message', event => {
    const msg = event.data;
    if (msg.type === 'themeChanged') {
      setTheme(msg.isLight);
      if (currentData) renderAll(currentData);
    }
  });

  // Listen for prefers-color-scheme media query changes as a supplementary trigger
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    // Re-read CSS vars as a fallback — VS Code may or may not update them
    detectTheme();
    if (currentData) renderAll(currentData);
  });

  // Settings toggle
  $('settingsBtn').addEventListener('click', () => {
    $('settingsOverlay').classList.toggle('hidden');
  });
  $('settingsOverlay').addEventListener('click', (e) => {
    if (e.target === $('settingsOverlay')) {
      $('settingsOverlay').classList.add('hidden');
    }
  });

  // Settings checkboxes
  document.querySelectorAll('.settings-item input').forEach(cb => {
    cb.addEventListener('change', () => {
      const key = cb.dataset.key;
      modules[key] = cb.checked;
      const el = document.querySelector(`[data-module="${key}"]`);
      if (el) el.classList.toggle('hidden', !cb.checked);
    });
  });

  // Chart tabs
  document.querySelectorAll('.chart-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.chart-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      chartMode = btn.dataset.mode;
      if (currentData) drawHistoryChart(currentData);
      // Save chart mode preference
      vscode.postMessage({ type: 'saveLayout', layout: { moduleOrder: undefined, displayMode, chartMode } });
    });
  });

  // Display mode toggle (matrix rain / candlestick / bouncing balls)
  const toggleBtn = $('candleToggle');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      const modes = ['matrix', 'candle', 'balls'];
      const idx = (modes.indexOf(displayMode) + 1) % modes.length;
      displayMode = modes[idx];

      // Update button active state and icon
      toggleBtn.classList.toggle('active', displayMode !== 'matrix');
      updateToggleIcon(toggleBtn, displayMode);

      // Cancel rAF if leaving matrix mode
      if (displayMode !== 'matrix' && matrixRainAnimId) {
        cancelAnimationFrame(matrixRainAnimId);
        matrixRainAnimId = null;
      }
      // Cancel tracer rAF if leaving tracer mode
      if (displayMode !== 'balls' && tracerAnimId) {
        cancelAnimationFrame(tracerAnimId);
        tracerAnimId = null;
      }

      // Render current mode
      if (currentData) {
        if (displayMode === 'candle') {
          renderCandlesticks(currentData);
        } else if (displayMode === 'balls') {
          renderBouncingBalls(currentData);
        } else {
          renderMatrixRain(currentData);
        }
      }
      // Save display mode
      vscode.postMessage({ type: 'saveLayout', layout: { moduleOrder: undefined, displayMode, chartMode } });
    });
  }

  function updateToggleIcon(btn, mode) {
    const svg = btn.querySelector('svg');
    if (!svg) return;
    if (mode === 'matrix') {
      svg.innerHTML = `<rect x="4" y="6" width="3" height="12" rx="0.5"/>
            <rect x="10.5" y="3" width="3" height="18" rx="0.5"/>
            <rect x="17" y="8" width="3" height="8" rx="0.5"/>
            <line x1="5.5" y1="2" x2="5.5" y2="6"/>
            <line x1="5.5" y1="18" x2="5.5" y2="22"/>
            <line x1="12" y1="1" x2="12" y2="3"/>
            <line x1="12" y1="21" x2="12" y2="22"/>
            <line x1="18.5" y1="4" x2="18.5" y2="8"/>
            <line x1="18.5" y1="16" x2="18.5" y2="20"/>`;
    } else if (mode === 'candle') {
      svg.innerHTML = `<rect x="4" y="3" width="3" height="18" rx="0.5"/>
            <rect x="10.5" y="7" width="3" height="12" rx="0.5"/>
            <rect x="17" y="5" width="3" height="14" rx="0.5"/>
            <line x1="5.5" y1="1" x2="5.5" y2="3"/>
            <line x1="5.5" y1="21" x2="5.5" y2="22"/>
            <line x1="12" y1="5" x2="12" y2="7"/>
            <line x1="12" y1="19" x2="12" y2="22"/>
            <line x1="18.5" y1="3" x2="18.5" y2="5"/>
            <line x1="18.5" y1="19" x2="18.5" y2="21"/>`;
    } else {
      svg.innerHTML = `<circle cx="6" cy="12" r="3" fill="currentColor"/>
            <circle cx="12" cy="8" r="3" fill="currentColor"/>
            <circle cx="18" cy="12" r="3" fill="currentColor"/>
            <line x1="6" y1="15" x2="6" y2="20" stroke="currentColor" stroke-width="1.5"/>
            <line x1="12" y1="11" x2="12" y2="20" stroke="currentColor" stroke-width="1.5"/>
            <line x1="18" y1="15" x2="18" y2="20" stroke="currentColor" stroke-width="1.5"/>`;
    }
  }

  // ---- Drag & Drop ----
  setupDragDrop();

  // ---- Responsive canvas size (maintain 3:2 aspect ratio) ----
  const burstCanvas = $('burstCanvas');
  if (burstCanvas) {
    const ASPECT = 240 / 160;
    const resizeCanvas = () => {
      const parent = burstCanvas.parentElement;
      if (parent) {
        const w = parent.clientWidth;
        if (w > 0) {
          const newH = Math.round(w / ASPECT);
          if (burstCanvas.width !== w || burstCanvas.height !== newH) {
            burstCanvas.width = w;
            burstCanvas.height = newH;
            // Re-init matrix rain for new dimensions
            matrixRainCols = 0;
          }
        }
      }
    };

    // Initial sync
    resizeCanvas();

    // Observe container resize
    const ro = new ResizeObserver(() => {
      resizeCanvas();
      if (currentData) {
        if (displayMode === 'candle') {
          renderCandlesticks(currentData);
        } else if (displayMode === 'balls' && tracer) {
          // Re-init tracer on resize so x position stays relative to new width
          const cvs = $('burstCanvas');
          if (cvs && cvs.width >= 10 && cvs.height >= 10) {
            tracer._canvasW = -1; // force re-init in next rAF
          }
        }
      }
    });
    ro.observe(burstCanvas.parentElement);
  }

  // Request initial config
  vscode.postMessage({ type: 'getConfig' });
});

// ---- Drag & Drop setup ----
function setupDragDrop() {
  const modules = document.querySelectorAll('.hud-module[draggable="true"]');

  modules.forEach(mod => {
    mod.addEventListener('dragstart', onDragStart);
    mod.addEventListener('dragend', onDragEnd);
    mod.addEventListener('dragover', onDragOver);
    mod.addEventListener('dragleave', onDragLeave);
    mod.addEventListener('drop', onDrop);
  });
}

function onDragStart(e) {
  dragSrcEl = this;
  this.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', this.id);
}

function onDragEnd() {
  this.classList.remove('dragging');
  document.querySelectorAll('.hud-module.drag-over').forEach(el => el.classList.remove('drag-over'));
  dragSrcEl = null;
}

function onDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  if (this !== dragSrcEl) {
    this.classList.add('drag-over');
  }
}

function onDragLeave() {
  this.classList.remove('drag-over');
}

function onDrop(e) {
  e.preventDefault();
  this.classList.remove('drag-over');
  if (this === dragSrcEl) return;

  const body = document.getElementById('hudBody');
  const allModules = [...body.querySelectorAll('.hud-module[draggable="true"]')];
  const fromIdx = allModules.indexOf(dragSrcEl);
  const toIdx = allModules.indexOf(this);

  if (fromIdx < 0 || toIdx < 0) return;

  if (fromIdx < toIdx) {
    body.insertBefore(dragSrcEl, this.nextSibling);
  } else {
    body.insertBefore(dragSrcEl, this);
  }

  const newOrder = [...body.querySelectorAll('.hud-module[draggable="true"]')].map(el => el.id);
  vscode.postMessage({ type: 'saveLayout', layout: { moduleOrder: newOrder, displayMode, chartMode } });
}

// ---- Message handler ----
window.addEventListener('message', (event) => {
  const msg = event.data;
  switch (msg.type) {
    case 'update':
      currentData = msg.data;
      renderAll(msg.data);
      break;
    case 'config':
      modules = { ...modules, ...msg.modules };
      applyConfig();
      break;
    case 'layout':
      applySavedLayout(msg.layout);
      break;
  }
});

// ---- Apply config visibility ----
function applyConfig() {
  for (const [key, visible] of Object.entries(modules)) {
    const el = document.querySelector(`[data-module="${key}"]`);
    if (el) el.classList.toggle('hidden', !visible);
    const cb = document.querySelector(`.settings-item input[data-key="${key}"]`);
    if (cb) cb.checked = visible;
  }
}

// ---- Apply saved layout (module order, display mode, chart mode) ----
function applySavedLayout(layout) {
  if (!layout) return;

  // Restore display mode
  if (layout.displayMode && ['matrix', 'candle', 'balls'].includes(layout.displayMode)) {
    displayMode = layout.displayMode;
    const toggleBtn = $('candleToggle');
    if (toggleBtn) {
      toggleBtn.classList.toggle('active', displayMode !== 'matrix');
      updateToggleIcon(toggleBtn, displayMode);
    }
  }

  // Restore chart mode tab
  if (layout.chartMode && ['24h', '7d'].includes(layout.chartMode)) {
    chartMode = layout.chartMode;
    document.querySelectorAll('.chart-tab').forEach(b => {
      b.classList.toggle('active', b.dataset.mode === chartMode);
    });
  }

  // Restore module order
  if (layout.moduleOrder && layout.moduleOrder.length > 0) {
    const body = document.getElementById('hudBody');
    if (!body) return;
    const existing = [...body.querySelectorAll('.hud-module[draggable="true"]')];
    const orderMap = new Map(existing.map(el => [el.id, el]));
    // Insert modules in saved order, append any that aren't in the saved list
    for (const id of layout.moduleOrder) {
      const el = orderMap.get(id);
      if (el) {
        body.appendChild(el); // moves to end if already in DOM
        orderMap.delete(id);
      }
    }
    // Append any remaining (new modules not in saved order)
    for (const el of orderMap.values()) {
      body.appendChild(el);
    }
  }
}

// ---- Render all ----
function renderAll(data) {
  renderModelName(data);
  renderAgentTree(data);
  if (displayMode === 'candle') {
    renderCandlesticks(data);
  } else if (displayMode === 'balls') {
    renderBouncingBalls(data);
  } else {
    renderMatrixRain(data);
  }
  renderContextBar(data);
  drawHistoryChart(data);
  renderSessionTime(data);
  renderHeaderStatus(data);
  renderCost(data);
  renderTodos(data);
}

// ---- Header ----
function renderHeaderStatus(data) {
  const el = $('headerStatus');
  el.textContent = t('header.status.' + data.taskStatus, {}) || data.taskStatus;
  el.style.color =
    data.taskStatus === 'working' || data.taskStatus === 'thinking' ? theme.accent :
    data.taskStatus === 'error' ? theme.danger :
    theme.textDim;

  const planBadge = $('planBadge');
  if (planBadge) {
    planBadge.classList.toggle('hidden', !data.planMode);
  }
}

// ---- Agent Tree ----
function renderAgentTree(data) {
  const el = $('agentTree');
  if (!data.agents || data.agents.length === 0) {
    el.innerHTML = '<div style="color:' + theme.textMuted + ';font-size:10px;">' + t('agent.noAgents') + '</div>';
    return;
  }

  const mainAgent = data.agents.find(a => a.type === 'main');
  const subAgents = data.agents.filter(a => a.type === 'sub');

  let html = '';
  if (mainAgent) html += agentRowHTML(mainAgent, true);
  for (const a of subAgents) html += agentRowHTML(a, false);
  el.innerHTML = html;
}

function agentRowHTML(a, isMain) {
  const iconSVG = isMain
    ? `<svg width="8" height="8" viewBox="0 0 8 8" fill="${theme.accent}"><polygon points="4,0 8,4 4,8 0,4"/></svg>`
    : `<svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="${theme.textDim}" stroke-width="1"><polygon points="4,0 8,4 4,8 0,4"/></svg>`;

  const dotClass = `agent-dot ${a.status}`;
  const padLeft = isMain ? '0' : '14px';
  const tokens = formatTokens(a.tokensUsed || 0);
  const taskText = a.subTask ? `${a.taskName} / ${a.subTask}` : a.taskName;

  // Tool info — only shown while a tool is actively being called
  let toolHTML = '';
  if (a.currentTool) {
    let fileName = '';
    if (a.currentToolFile) {
      if (a.currentTool === 'Bash') {
        fileName = a.currentToolFile.split(/\s+/)[0]; // first word of command
      } else {
        fileName = a.currentToolFile.replace(/^.*[/\\]/, ''); // basename only
      }
    }
    const displayFile = fileName.length > 28
      ? fileName.substring(0, 25) + '...'
      : fileName;
    toolHTML = `<span class="agent-tool-name">${a.currentTool}${displayFile ? ` (${displayFile})` : ''}</span>`;
  }

  return `
    <div class="agent-row" style="padding-left:${padLeft}">
      <span class="agent-icon">${iconSVG}</span>
      <span class="agent-dot ${dotClass}"></span>
      <div class="agent-info">
        <div class="agent-name">${a.name}</div>
        <div class="agent-task">${taskText}</div>
      </div>
      <div class="agent-stats">
        ${toolHTML}
        <span class="agent-tokens">${tokens}</span>
      </div>
    </div>`;
}

// ---- Matrix Rain (Canvas) ----
// Uses requestAnimationFrame for smooth 60fps animation.
// renderAll() only pushes parameter updates; the draw loop runs independently.
let matrixRainDrops = [];
let matrixRainCols = 0;
let matrixRainFrame = 0;
let matrixRainParams = { spacing: 14, fadeAlpha: 0.06, charSize: 12 };
let matrixRainAnimId = null;
let matrixRainActiveRatio = 0.5; // 0~1, controls how many columns are rendered

function initMatrixRain(canvas, spacing) {
  matrixRainCols = Math.max(1, Math.floor(canvas.width / spacing));
  matrixRainDrops = [];
  for (let i = 0; i < matrixRainCols; i++) {
    matrixRainDrops.push({
      y: Math.random() * canvas.height,
      speed: 150.0 + Math.random() * 100,
      tailLen: 4 + Math.floor(Math.random() * 8),
    });
  }
}

/** Called from renderAll when new data arrives — just updates active ratio */
function updateMatrixRain(data) {
  const rawRate = data.tokenBurstRate || 0;
  // Smooth: EMA with alpha = 0.12
  smoothedRate = smoothedRate + (rawRate - smoothedRate) * 0.12;
  const rate = Math.round(smoothedRate);

  // Only the active column count changes with rate (capped at 55% to keep it legible)
  matrixRainActiveRatio = Math.min(0.55, Math.max(0.02, rate / 300));

  // Update label (raw value for accuracy, not smoothed)
  const history = data.burstHistory || [];
  const dir = history.length > 1 && history[history.length - 1] > history[history.length - 2] ? '▲' : '▼';
  const lbl = $('burstLabel');
  if (lbl) {
    lbl.textContent = t('tokenFlow.tokensPerSec', { rate: data.tokenBurstRate, dir });
    lbl.style.color = rate > 200 ? theme.warning : rate > 50 ? theme.accent : theme.textDim;
  }

  // Ensure animation loop is running
  if (!matrixRainAnimId && displayMode === 'matrix') {
    const canvas = $('burstCanvas');
    if (canvas) matrixRainAnimId = requestAnimationFrame(() => drawMatrixRain(canvas));
  }
}

/** 60fps render loop — runs via requestAnimationFrame */
function drawMatrixRain(canvas) {
  matrixRainAnimId = null;
  if (!canvas || !canvas.isConnected) return;

  const { spacing, fadeAlpha, charSize } = matrixRainParams;
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;

  // Re-init if column count changed (canvas resize)
  const expectedCols = Math.max(1, Math.floor(w / spacing));
  if (matrixRainCols !== expectedCols) initMatrixRain(canvas, spacing);

  // Fade trail
  ctx.fillStyle = ta(theme.canvasFade, fadeAlpha);
  ctx.fillRect(0, 0, w, h);

  // Pick charset based on locale
  const locale = window.__LOCALE__ || {};
  const isJa = locale.candlestick?.o === '始';
  const isZh = locale.candlestick?.o === '开';
  let charSet;
  if (isJa) {
    charSet = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン0123456789';
  } else if (isZh) {
    charSet = '的一是不了人我在有他这中大来上国个到说们子为和地也时要会生可年出后能下发心对成学工面明白已天道然如作方多其进动着里经长又用家化自当0到9';
  } else {
    charSet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  }

  const activeCount = Math.max(1, Math.round(matrixRainCols * matrixRainActiveRatio));
  // Pick activeCount random column indices so drops scatter across the full width
  const activeIndices = [];
  const totalCols = matrixRainDrops.length;
  if (activeCount >= totalCols) {
    for (let i = 0; i < totalCols; i++) activeIndices.push(i);
  } else {
    const picked = new Set();
    while (picked.size < activeCount) {
      picked.add(Math.floor(Math.random() * totalCols));
    }
    for (const idx of picked) activeIndices.push(idx);
  }

  matrixRainFrame++;
  for (const i of activeIndices) {
    const drop = matrixRainDrops[i];
    if (!drop) continue;

    const x = i * spacing;
    const step = drop.speed / 60; // normalize speed per frame

    // Bright head character
    const headChar = charSet[Math.floor(Math.random() * charSet.length)];
    ctx.font = `bold ${charSize}px "JetBrains Mono", monospace`;
    ctx.fillStyle = theme.accent;
    ctx.shadowColor = theme.accent;
    ctx.shadowBlur = 1.5;
    ctx.fillText(headChar, x, drop.y);
    ctx.shadowBlur = 0;

    // Trail characters (fading)
    for (let j = 1; j < drop.tailLen; j++) {
      const trailChar = charSet[Math.floor(Math.random() * charSet.length)];
      const alpha = Math.max(0.05, 0.5 - j / drop.tailLen * 0.5);
      ctx.fillStyle = tg(alpha);
      ctx.font = `${charSize}px "JetBrains Mono", monospace`;
      ctx.fillText(trailChar, x, drop.y - j * spacing);
    }

    // Move drop downward
    drop.y += step;
    if (drop.y > h + drop.tailLen * spacing) {
      drop.y = 0;
    }
  }

  // Schedule next frame
  if (displayMode === 'matrix') {
    matrixRainAnimId = requestAnimationFrame(() => drawMatrixRain(canvas));
  }
}

// ---- Chart Tracer (standalone display mode) ----
// A single ball stays at ~55% width; the trail scrolls left like an ECG.
// Token rate controls ball Y (higher rate = higher peak).
let tracer = null;
let tracerPath = [];
let tracerAnimId = null;
let particles = []; // firework particles for tool activity
const TRACER_TRAIL_LENGTH = 120; // number of trail points

function initTracer(canvasW, canvasH) {
  tracer = {
    x: (canvasW || 240) * 0.55,
    y: (canvasH || 160) * 0.5,
    _canvasW: canvasW || 240,
    _canvasH: canvasH || 160,
  };
  tracerPath = [];
}

function spawnRings(cx, cy) {
  const ringColors = ['#fbbf24', '#f97316', '#f472b6', '#a78bfa', '#f59e0b'];
  const count = 2 + Math.floor(Math.random() * 2); // 2-3 rings per burst
  for (let i = 0; i < count; i++) {
    particles.push({
      cx, cy,
      radius: 2,
      maxRadius: 30 + Math.random() * 50,
      alpha: 0.8 + Math.random() * 0.2,
      life: 1,
      growth: 0.6 + Math.random() * 0.8,   // radius per frame
      decay: 0.012 + Math.random() * 0.012, // alpha fade per frame
      lineWidth: 1.5 + Math.random() * 2.5,
      color: ringColors[Math.floor(Math.random() * ringColors.length)],
    });
  }
}

function updateParticles(ctx) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const r = particles[i];
    r.radius += r.growth;
    r.life -= r.decay;
    r.alpha = Math.max(0, r.life * 0.8);

    if (r.life <= 0 || r.radius > r.maxRadius) {
      particles.splice(i, 1);
      continue;
    }

    ctx.globalAlpha = r.alpha;
    ctx.strokeStyle = r.color;
    ctx.lineWidth = r.lineWidth * r.life;
    ctx.beginPath();
    ctx.arc(r.cx, r.cy, r.radius, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function drawTracerFrame(canvas, rate) {
  const ctx = canvas.getContext('2d');
  let w = canvas.width;
  let h = canvas.height;

  // Guard: skip frame if canvas has no valid dimensions
  if (w < 10 || h < 10) {
    return;
  }

  // Full clear each frame — clean scrolling chart look
  ctx.fillStyle = theme.canvasBg;
  ctx.fillRect(0, 0, w, h);

  if (!tracer) return;

  // Simplified bounce: activity kicks up, gravity pulls down. Just for fun.
  const rateClamped = Math.max(rate, 0);
  const bottomY = h * 0.65;
  const bouncePeakY = h * 0.30;

  // Record Y before any movement (for trail)
  const prevY = tracer.y;

  // Init state
  tracer._vy = tracer._vy ?? 0;
  tracer._activity = tracer._activity ?? 0;

  // Smooth activity
  tracer._activity += (rateClamped - tracer._activity) * 0.3;

  // Active when > 10 t/s
  const active = tracer._activity > 10;

  // When active and near the ground, kick up with fixed velocity
  // so it always reaches the same peak height regardless of rate.
  if (active && tracer.y >= bottomY - 3) {
    tracer._vy = -(bottomY - bouncePeakY) * 0.06;
  }

  // Gravity: weaker when active (floats longer), normal when idle
  const g = active ? 0.10 : 0.25;
  tracer._vy += g;
  tracer.y += tracer._vy;

  // Ground
  if (tracer.y >= bottomY) {
    tracer.y = bottomY;
    tracer._vy *= -0.05;
    if (Math.abs(tracer._vy) < 0.3) tracer._vy = 0;
  }

  // Ceiling — never above peak
  if (tracer.y < bouncePeakY) {
    tracer.y = bouncePeakY;
    tracer._vy = 0;
  }

  // Idle bob
  if (tracer._vy === 0 && !active) {
    tracer.y += Math.sin(performance.now() / 2000) * 0.5;
  }

  // Scroll speed: faster when active
  const scrollSpeed = 1 + (active ? Math.min(tracer._activity / 100, 3) : 0);

  // Shift all existing points left
  for (let i = 0; i < tracerPath.length; i++) {
    tracerPath[i].x -= scrollSpeed;
  }
  // Remove points that scrolled off the left edge
  while (tracerPath.length > 0 && tracerPath[0].x < -4) {
    tracerPath.shift();
  }

  // Record the new point at the ball's X
  tracerPath.push({ x: tracer.x, y: prevY });
  if (tracerPath.length > TRACER_TRAIL_LENGTH) {
    tracerPath.shift();
  }

  // Draw trail (old → dim, new → bright)
  for (let i = 1; i < tracerPath.length; i++) {
    const t = i / tracerPath.length; // 0..1, newer = closer to 1
    const alpha = t * 0.85;
    const width = 1 + t * 2.5;
    ctx.strokeStyle = tg(alpha);
    ctx.lineWidth = width;
    ctx.shadowColor = tg(alpha * 0.4);
    ctx.shadowBlur = width * 3;
    ctx.beginPath();
    ctx.moveTo(tracerPath[i - 1].x, tracerPath[i - 1].y);
    ctx.lineTo(tracerPath[i].x, tracerPath[i].y);
    ctx.stroke();
  }
  ctx.shadowBlur = 0;

  // Draw the ball at the head — size and glow scale with activity
  const intensity = Math.min(1, tracer._activity / 500);
  const headAlpha = 0.4 + intensity * 0.6;
  const ballRadius = 2.5 + intensity * 4;
  const glowBlur = 8 + intensity * 20;
  ctx.shadowColor = theme.accent;
  ctx.shadowBlur = glowBlur;
  ctx.fillStyle = tg(headAlpha);
  ctx.beginPath();
  ctx.arc(tracer.x, tracer.y, ballRadius, 0, Math.PI * 2);
  ctx.fill();

  // Bright center dot
  ctx.shadowBlur = 0;
  ctx.fillStyle = theme.text;
  ctx.beginPath();
  ctx.arc(tracer.x, tracer.y, Math.max(1, ballRadius * 0.4), 0, Math.PI * 2);
  ctx.fill();

  // Draw a subtle horizontal reference line at the current Y
  ctx.strokeStyle = tg(0.05 + Math.min(0.1, rate / 1000));
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 6]);
  ctx.beginPath();
  ctx.moveTo(0, tracer.y);
  ctx.lineTo(tracer.x - 4, tracer.y);
  ctx.stroke();
  ctx.setLineDash([]);

  // Draw firework particles (on top of everything)
  updateParticles(ctx);

  ballFrameCount++;
}

/** Dedicated rAF loop for tracer mode */
function drawTracerLoop(canvas) {
  tracerAnimId = null;
  if (!canvas || !canvas.isConnected) return;

  // Detect canvas resize and re-init tracer if needed
  if (tracer && (tracer._canvasW !== canvas.width || tracer._canvasH !== canvas.height)) {
    initTracer(canvas.width, canvas.height);
    tracer._canvasW = canvas.width;
    tracer._canvasH = canvas.height;
  }

  drawTracerFrame(canvas, smoothedRate);

  // Schedule next frame
  if (displayMode === 'balls') {
    tracerAnimId = requestAnimationFrame(() => drawTracerLoop(canvas));
  }
}

/** Entry point called from renderAll */
function renderBouncingBalls(data) {
  const canvas = $('burstCanvas');
  if (!canvas) return;

  // Guard: if canvas has no valid dimensions (module hidden), bail
  if (canvas.width < 10 || canvas.height < 10) {
    return;
  }

  if (!tracer) {
    initTracer(canvas.width, canvas.height);
  }

  // Update params — asymmetric smoothing: rise smooth, fall fast
  const rawRate = data.tokenBurstRate || 0;
  const emaAlpha = rawRate < smoothedRate ? 0.4 : 0.12;
  smoothedRate = smoothedRate + (rawRate - smoothedRate) * emaAlpha;

  // Update label
  const history = data.burstHistory || [];
  const dir = history.length > 1 && history[history.length - 1] > history[history.length - 2] ? '▲' : '▼';
  const lbl = $('burstLabel');
  if (lbl) {
    lbl.textContent = t('tokenFlow.tokensPerSec', { rate: data.tokenBurstRate, dir });
    lbl.style.color = smoothedRate > 200 ? theme.warning : smoothedRate > 50 ? theme.accent : theme.textDim;
  }

  // Firework particles on tool activity
  if (tracer) {
    const hasToolActivity = data.agents && data.agents.some(a => a.currentTool);
    const now = performance.now();
    const lastFire = tracer._lastToolFire || 0;
    if (hasToolActivity && now - lastFire > 800) {
      tracer._lastToolFire = now;
      spawnRings(tracer.x, tracer.y);
    }
  }

  // Start animation loop
  if (!tracerAnimId && displayMode === 'balls') {
    tracerAnimId = requestAnimationFrame(() => drawTracerLoop(canvas));
  }
}

function renderMatrixRain(data) {
  const canvas = $('burstCanvas');
  if (!canvas) return;

  if (!matrixRainDrops.length) {
    initMatrixRain(canvas, matrixRainParams.spacing);
  }
  if (!matrixRainAnimId && displayMode === 'matrix') {
    matrixRainAnimId = requestAnimationFrame(() => drawMatrixRain(canvas));
  }
  updateMatrixRain(data);
}

// ---- Candlestick K-line Chart (Canvas) ----
function renderCandlesticks(data) {
  const canvas = $('burstCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  const pad = { top: 4, bottom: 10, left: 4, right: 4 };
  const drawW = w - pad.left - pad.right;
  const drawH = h - pad.top - pad.bottom;

  ctx.clearRect(0, 0, w, h);

  const candles = (data.candleHistory || []).slice(-20);
  if (candles.length === 0) {
    ctx.fillStyle = theme.textMuted;
    ctx.font = '9px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(t('candlestick.noData'), w / 2, h / 2 + 3);
    return;
  }

  // Y-axis based on candle body (open/close) range, ignoring wick extremes
  // This prevents spike compression — long wicks won't flatten the view
  let bodyLow = Infinity;
  let bodyHigh = -Infinity;
  for (const c of candles) {
    const bMin = Math.min(c.open, c.close);
    const bMax = Math.max(c.open, c.close);
    if (bMin < bodyLow) bodyLow = bMin;
    if (bMax > bodyHigh) bodyHigh = bMax;
  }
  const range = bodyHigh - bodyLow || 1;
  const paddedLow = bodyLow - range * 0.15;
  const paddedHigh = bodyHigh + range * 0.15;
  const paddedRange = paddedHigh - paddedLow || 1;

  const count = candles.length;

  const candleW = Math.max(2, (drawW / count) * 0.6);
  const gap = (drawW / count) * 0.4;

  for (let i = 0; i < count; i++) {
    const c = candles[i];
    const x = pad.left + i * (candleW + gap) + gap / 2;
    const centerX = x + candleW / 2;

    const yHigh = pad.top + drawH - ((c.high - paddedLow) / paddedRange) * drawH;
    const yLow = pad.top + drawH - ((c.low - paddedLow) / paddedRange) * drawH;
    const yOpen = pad.top + drawH - ((c.open - paddedLow) / paddedRange) * drawH;
    const yClose = pad.top + drawH - ((c.close - paddedLow) / paddedRange) * drawH;

    const isUp = c.close >= c.open;
    const color = isUp
      ? (isChineseLocale ? theme.danger : theme.accent)
      : (isChineseLocale ? theme.accent : theme.danger);

    // Draw wick
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(centerX, yHigh);
    ctx.lineTo(centerX, yLow);
    ctx.stroke();

    // Draw body
    const bodyTop = Math.min(yOpen, yClose);
    const bodyBottom = Math.max(yOpen, yClose);
    const bodyH = Math.max(1, bodyBottom - bodyTop);

    ctx.fillStyle = color;
    ctx.fillRect(x, bodyTop, candleW, bodyH);

    ctx.strokeStyle = color;
    ctx.lineWidth = 0.5;
    ctx.strokeRect(x, bodyTop, candleW, bodyH);

    // Buy/Sell signal marker
    if (c.signal === 'buy') {
      ctx.fillStyle = isChineseLocale ? theme.danger : theme.accent;
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('▲', centerX, yLow + 10);
    } else if (c.signal === 'sell') {
      ctx.fillStyle = isChineseLocale ? theme.accent : theme.danger;
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('▼', centerX, yHigh - 4);
    }
  }

  // Midline
  ctx.strokeStyle = theme.borderDim;
  ctx.lineWidth = 0.5;
  ctx.setLineDash([2, 3]);
  ctx.beginPath();
  ctx.moveTo(pad.left, pad.top + drawH / 2);
  ctx.lineTo(pad.left + drawW, pad.top + drawH / 2);
  ctx.stroke();
  ctx.setLineDash([]);

  const last = candles[candles.length - 1];
  const latestColor = last.close >= last.open
    ? (isChineseLocale ? theme.danger : theme.accent)
    : (isChineseLocale ? theme.accent : theme.danger);
  const burstLabel = $('burstLabel');
  if (burstLabel) {
    burstLabel.style.display = '';
    burstLabel.innerHTML = `${t('candlestick.o')}:${+last.open.toFixed(1)} ${t('candlestick.h')}:${+last.high.toFixed(1)} ${t('candlestick.l')}:${+last.low.toFixed(1)} ${t('candlestick.c')}:<span style="color:${latestColor};font-weight:600;">${+last.close.toFixed(1)}</span>`;
  }
}

// ---- Context Window (progress bar) ----
function renderContextBar(data) {
  const fill = $('contextFill');
  const label = $('contextLabel');
  if (!fill || !label) return;

  const pct = Math.min(100, Math.max(0, data.contextPercentage || 0));

  const used = formatTokens(data.contextTokens || 0);
  const limit = formatTokens(data.tokenLimit || 200000);

  const color =
    pct > 85 ? theme.danger :
    pct > 70 ? theme.warning :
    theme.accent;

  fill.style.width = `${pct}%`;
  fill.style.background = color;
  label.textContent = t('context.used', { used, limit, pct: Math.round(pct) });
  label.style.color = color;
}

// ---- History Chart (Canvas) ----
function drawHistoryChart(data) {
  const canvas = $('historyCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  const pad = { top: 6, bottom: 14, left: 4, right: 4 };
  const drawW = w - pad.left - pad.right;
  const drawH = h - pad.top - pad.bottom;

  ctx.clearRect(0, 0, w, h);

  const series = chartMode === '24h' ? data.hourlyHistory : data.dailyHistory;
  if (!series || series.length === 0) return;

  const vals = series.map(s => s.tokens);
  const maxVal = Math.max(...vals, 1);
  const total = vals.reduce((a, b) => a + b, 0);

  // Draw bars
  const barCount = vals.length;
  const barW = Math.max(3, Math.min(12, (drawW / barCount) - 2));
  for (let i = 0; i < barCount; i++) {
    const x = barCount === 1
      ? pad.left + drawW / 2 - barW / 2
      : pad.left + (i / (barCount - 1)) * drawW - barW / 2;

    const val = vals[i];
    const barH = (val / maxVal) * drawH;
    const y = pad.top + drawH - barH;

    if (val > 0) {
      ctx.fillStyle = tg(0.5);
      ctx.fillRect(x, y, barW, Math.max(barH, 2));
    } else {
      // Subtle baseline for empty hours
      ctx.fillStyle = tg(0.08);
      ctx.fillRect(x, pad.top + drawH - 1, barW, 1);
    }

    // Compact label
    ctx.fillStyle = theme.textMuted;
    ctx.font = '7px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    const label = series[i].hour || series[i].day;
    const displayLabel = series[i].hour ? label.slice(-5) : label;
    ctx.fillText(displayLabel, x + barW / 2, h - 2);
  }

  const totalLabel = chartMode === '24h' ? t('chartTotal.today', { total: formatTokens(total) }) : t('chartTotal.week', { total: formatTokens(total) });
  $('chartTotal').textContent = totalLabel;
}

// ---- Session Time ----
function renderSessionTime(data) {
  const secs = Math.floor(data.sessionTime);
  const hh = String(Math.floor(secs / 3600)).padStart(2, '0');
  const mm = String(Math.floor((secs % 3600) / 60)).padStart(2, '0');
  const ss = String(secs % 60).padStart(2, '0');
  $('sessionTime').textContent = `${hh}:${mm}:${ss}`;
}

// ---- Section (Token Usage) ----

// ---- Helper: escape HTML to prevent XSS from disk data ----
function escapeHtml(str) {
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(str));
  return div.innerHTML;
}

// ---- Model Name Badge ----
function renderModelName(data) {
  const el = $('modelBadge');
  if (!el) return;
  const name = data.modelName || '--';
  el.textContent = name;
  const lower = name.toLowerCase();
  if (lower.startsWith('deepseek') || lower.startsWith('gemini')) {
    el.style.color = theme.accent;
  } else if (lower.startsWith('claude')) {
    el.style.color = theme.kind === 'dark' ? '#e4e4e7' : '#52525b';
  } else {
    el.style.color = theme.textDim;
  }
}

// ---- Cost ----
function renderCost(data) {
  const tokensEl = $('costTokens');
  const totalEl = $('costTotal');
  const inEl = $('costIn');
  const outEl = $('costOut');
  const cacheREl = $('costCacheR');
  const cacheWEl = $('costCacheW');
  if (!tokensEl || !totalEl) return;

  const used = data.tokensUsed || 0;
  tokensEl.textContent = formatTokens(used);

  const cost = data.estimatedCost || 0;
  totalEl.textContent = `$${cost.toFixed(4)}`;

  if (inEl) inEl.textContent = formatTokens(data.inputTokens || 0);
  if (outEl) outEl.textContent = formatTokens(data.outputTokens || 0);
  if (cacheREl) cacheREl.textContent = formatTokens(data.cacheHitTokens || 0);
  if (cacheWEl) cacheWEl.textContent = formatTokens(data.cacheWriteTokens || 0);
}

// ---- Todos ----
function renderTodos(data) {
  const placeholder = $('todosPlaceholder');
  const list = $('todosList');
  const progress = $('todoProgress');
  if (!placeholder || !list || !progress) return;

  const allTodos = data.todos || [];
  const activeCount = allTodos.filter(t => t.status !== 'completed').length;
  const totalCount = allTodos.length;
  progress.textContent = totalCount > 0 ? `${activeCount}/${totalCount}` : '';

  // Auto-clear completed todos: once all done, hide after 3s
  if (activeCount === 0 && totalCount > 0) {
    if (!window._todosClearTimer) {
      window._todosClearTimer = setTimeout(() => {
        window._todosClearTimer = null;
        window._todosAutoCleared = true;
        if (currentData) renderAll(currentData);
      }, 3000);
    }
    // While waiting, still show the completed list normally
  } else {
    if (window._todosClearTimer) {
      clearTimeout(window._todosClearTimer);
      window._todosClearTimer = null;
    }
    if (activeCount > 0) {
      window._todosAutoCleared = false;
    }
  }

  // If auto-cleared, show "no todos" placeholder
  if (window._todosAutoCleared || allTodos.length === 0) {
    placeholder.style.display = '';
    placeholder.textContent = t('todos.noTodos');
    list.style.display = 'none';
    return;
  }

  placeholder.style.display = 'none';
  list.style.display = '';

  // Keep original order (as written by TodoWrite — no sort by status)
  const sorted = [...allTodos];

  const items = sorted.map(t => {
    let dotHtml;
    if (t.status === 'completed') {
      dotHtml = `<span class="todo-check">✓</span>`;
    } else if (t.status === 'in_progress') {
      dotHtml = `<span class="todo-dot active"></span>`;
    } else {
      dotHtml = `<span class="todo-dot-ring"></span>`;
    }
    const textClass = t.status === 'completed' ? ' todo-done-text' : t.status === 'in_progress' ? ' todo-active-text' : '';
    return `<div class="todo-item${t.status === 'completed' ? ' todo-done' : ''}">
      ${dotHtml}
      <span class="todo-text${textClass}">${escapeHtml(t.description)}</span>
      ${t.agentId && t.agentId !== 'main' ? `<span class="todo-agent">${escapeHtml(t.agentId)}</span>` : ''}
      ${t.file ? `<span class="todo-file">${escapeHtml(t.file)}</span>` : ''}
    </div>`;
  }).join('');

  list.innerHTML = items;
}
