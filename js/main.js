/**
 * PixelTap - Main application controller.
 * Terminal aesthetic, pixel icons, animation timeline, GIF export,
 * layer thumbnails, background layer, 20 layers max.
 */
import { PixelCanvas } from './PixelCanvas.js';
import { History } from './history.js';
import { Tools, colorReplace, magicWandFill } from './tools.js';
import { GIFEncoder } from './gif-encoder.js';
import {
  ICON_PENCIL, ICON_ERASER, ICON_FILL, ICON_EYEDROPPER,
  ICON_SELECT, ICON_WAND, ICON_LINE, ICON_SHAPE, ICON_ELLIPSE,
  ICON_UNDO, ICON_REDO, ICON_GRID, ICON_LAYERS,
  ICON_CLEAR, ICON_EXPORT, ICON_ONION, ICON_PLAY, ICON_STOP,
  ICON_SYM_OFF, ICON_SYM_V, ICON_SYM_H, ICON_SYM_BOTH,
  ICON_PHOTO, ICON_TEMPLATES, ICON_GALLERY,
} from './icons.js';
import { TEMPLATE_CATEGORIES, TEMPLATES, parseTemplate, renderTemplatePreview } from './templates.js';

// --- Default palette (Sweetie 16 + basics) ---
const DEFAULT_PALETTE = [
  '#1a1c2c', '#5d275d', '#b13e53', '#ef7d57',
  '#ffcd75', '#a7f070', '#38b764', '#257179',
  '#29366f', '#3b5dc9', '#41a6f6', '#73eff7',
  '#f4f4f4', '#94b0c2', '#566c86', '#333c57',
  '#000000', '#ffffff', '#ff0000', '#00ff00',
  '#0000ff', '#ffff00', '#ff00ff', '#00ffff',
];

// --- Grid presets ---
const GRID_PRESETS = {
  square: [
    { w: 8, h: 8, label: '8 x 8' },
    { w: 16, h: 16, label: '16 x 16' },
    { w: 32, h: 32, label: '32 x 32' },
    { w: 64, h: 64, label: '64 x 64' },
    { w: 128, h: 128, label: '128 x 128' },
  ],
  phone: [
    { w: 18, h: 32, label: '18 x 32' },
    { w: 36, h: 64, label: '36 x 64' },
    { w: 72, h: 128, label: '72 x 128' },
    { w: 108, h: 192, label: '108 x 192' },
  ],
  wide: [
    { w: 32, h: 18, label: '32 x 18' },
    { w: 64, h: 36, label: '64 x 36' },
    { w: 128, h: 72, label: '128 x 72' },
  ],
};

class PixelPaintApp {
  constructor() {
    // State
    this.currentColor = '#000000';
    this.currentTool = 'pencil';
    this.previousTool = 'pencil';
    this.brushSize = 1; // 1-8 px
    this.fillReplace = false; // false = flood fill, true = color replace

    // Shape tool state
    this.shapeMode = 'rect';      // 'rect' or 'ellipse'
    this.shapeFilled = false;
    this._shapeStart = null;
    this._shapeEnd = null;

    // Touch state
    this.isDrawing = false;
    this.lastGridPos = null;

    // Pinch zoom
    this.isPinching = false;
    this.initialPinchDist = 0;
    this.initialZoom = 1;
    this.initialPanX = 0;
    this.initialPanY = 0;
    this.pinchMidX = 0;
    this.pinchMidY = 0;

    // Selection state
    this.selection = null;
    this._selectStart = null;
    this._selectEnd = null;
    this._selectionDragging = false;
    this._selectionDragStart = null;

    // Wand highlight (before cut)
    this._wandHighlight = null;

    // Animation
    this.animFrames = [];         // Array of snapshot objects { layers, activeLayerIndex, bgColor }
    this.currentFrameIndex = 0;
    this.isPlaying = false;
    this._playInterval = null;
    this.fps = 8;
    this.liveDrawMode = false;    // Live draw: draw while animation plays

    // Auto-save
    this._saveTimeout = null;
    this._zoomTimeout = null;

    // PRO status
    this.isPro = localStorage.getItem('pixeltap-pro') === '1';

    // Gallery — current project
    this._currentProjectId = localStorage.getItem('pixeltap-current-project') || null;

    this._init();
  }

  // ============================================================
  // INIT
  // ============================================================
  _init() {
    // Telegram Mini App integration
    this._initTelegram();

    const canvasEl = document.getElementById('pixel-canvas');
    this.pixelCanvas = new PixelCanvas(canvasEl);
    this.history = new History(50);

    // Load saved project (project-specific slot if available, else default)
    const projKey = this._currentProjectId ? 'pixeltap-proj-' + this._currentProjectId : 'pixelpaint-project';
    const loaded = this.pixelCanvas.loadFromStorage(projKey);

    // Load saved animation frames
    if (this._currentProjectId) {
      this._loadAnimFromStorage('pixeltap-anim-' + this._currentProjectId);
    } else {
      this._loadAnimFromStorage();
    }

    requestAnimationFrame(() => {
      this.pixelCanvas.fitToScreen();
      this.history.push(this.pixelCanvas.getSnapshot());
      if (loaded) {
        this._syncGridSizeUI();
        document.getElementById('btn-grid').classList.toggle(
          'active', this.pixelCanvas.showGrid
        );
      }
    });

    this._injectIcons();
    this._setupPalette();
    this._setupTools();
    this._setupTopBar();
    this._setupTouchEvents();
    this._setupMouseEvents();
    this._setupKeyboard();
    this._setupHistory();
    this._setupExport();
    this._setupLayersPanel();
    this._setupGridSizeModal();
    this._setupAutoSave();
    this._setupTimeline();
    this._setupBgColor();
    this._setupSymmetry();
    this._setupOnionSettings();
    this._addZoomIndicator();

    // Init first frame if no animation data exists
    if (this.animFrames.length === 0) {
      this.animFrames.push(this.pixelCanvas.getSnapshot());
      this.currentFrameIndex = 0;
    }
    this._refreshTimeline();
    this._updateOnionSkin();

    // Apply PRO state to UI
    this._applyProState();
  }

  // ============================================================
  // TELEGRAM MINI APP
  // ============================================================
  _initTelegram() {
    const tg = window.Telegram?.WebApp;
    if (!tg) return; // Not running inside Telegram

    this.tg = tg;
    tg.ready();
    tg.expand();     // Fullscreen

    // Disable vertical swipe to close (so drawing works)
    if (tg.disableVerticalSwipes) tg.disableVerticalSwipes();

    // Apply Telegram safe areas to CSS
    const safeTop = tg.safeAreaInset?.top || 0;
    const safeBottom = tg.safeAreaInset?.bottom || 0;
    if (safeTop > 0) {
      document.documentElement.style.setProperty('--tg-safe-top', safeTop + 'px');
    }
    if (safeBottom > 0) {
      document.documentElement.style.setProperty('--safe-bottom', safeBottom + 'px');
    }

    // Set Telegram header color to match our dark theme
    if (tg.setHeaderColor) tg.setHeaderColor('#0a0a0a');
    if (tg.setBackgroundColor) tg.setBackgroundColor('#0a0a0a');
  }

  // ============================================================
  // PRO FEATURE GATING
  // ============================================================
  _requirePro(featureName) {
    if (this.isPro) return true;
    this._showProPrompt(featureName);
    return false;
  }

  _showProPrompt(featureName) {
    const msg = featureName
      ? `"${featureName}" is a PRO feature.\nUnlock PixelTap Pro for 50 Stars to get:\n• Animation & timeline\n• Up to 20 layers\n• Canvas up to 256×256\n• Onion skin\n• Symmetry\n• GIF & sprite sheet export`
      : 'This is a PRO feature. Tap PRO to unlock!';

    if (this.tg) {
      // Inside Telegram — offer to open shop
      if (confirm(msg + '\n\nOpen shop?')) {
        document.getElementById('btn-shop')?.click();
      }
    } else {
      alert(msg);
    }
  }

  _unlockPro() {
    this.isPro = true;
    localStorage.setItem('pixeltap-pro', '1');
    this._applyProState();
  }

  _applyProState() {
    const shopBtn = document.getElementById('btn-shop');
    if (shopBtn) {
      if (this.isPro) {
        // Hide PRO button entirely — everything is unlocked
        shopBtn.style.display = 'none';
      } else {
        shopBtn.style.display = '';
      }
    }

    // Show/hide lock indicators
    document.querySelectorAll('.pro-lock').forEach(el => {
      el.style.display = this.isPro ? 'none' : '';
    });
  }

  // ============================================================
  // PIXEL ICON INJECTION
  // ============================================================
  _injectIcons() {
    const set = (id, src) => {
      const el = document.getElementById(id);
      if (el) el.src = src;
    };

    // Top bar
    set('icon-undo', ICON_UNDO);
    set('icon-redo', ICON_REDO);
    set('icon-onion', ICON_ONION);
    set('icon-grid', ICON_GRID);
    set('icon-layers', ICON_LAYERS);
    set('icon-clear', ICON_CLEAR);
    set('icon-export', ICON_EXPORT);
    set('icon-templates', ICON_TEMPLATES);
    set('icon-gallery', ICON_GALLERY);

    // Bottom bar tools
    set('icon-tool-pencil', ICON_PENCIL);
    set('icon-tool-eraser', ICON_ERASER);
    set('icon-tool-fill', ICON_FILL);
    set('icon-tool-eyedropper', ICON_EYEDROPPER);
    set('icon-tool-line', ICON_LINE);
    set('icon-tool-shape', ICON_SHAPE);
    set('icon-tool-wand', ICON_WAND);
    set('icon-tool-select', ICON_SELECT);

    // Timeline
    set('icon-play', ICON_PLAY);

    // Symmetry
    set('icon-symmetry', ICON_SYM_OFF);

    // Photo import
    set('icon-photo', ICON_PHOTO);
  }

  // ============================================================
  // AUTO-SAVE
  // ============================================================
  _setupAutoSave() {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this._autoSave();
    });
    window.addEventListener('beforeunload', () => this._autoSave());
  }

  _scheduleAutoSave() {
    clearTimeout(this._saveTimeout);
    this._saveTimeout = setTimeout(() => this._autoSave(), 1000);
  }

  _autoSave() {
    // Save to default slot
    this.pixelCanvas.saveToStorage();
    this._saveAnimToStorage();
    // Also save to project-specific slot if we have a current project
    if (this._currentProjectId) {
      this.pixelCanvas.saveToStorage('pixeltap-proj-' + this._currentProjectId);
      try {
        const animData = {
          frames: this.animFrames,
          currentFrameIndex: this.currentFrameIndex,
          fps: this.fps,
        };
        localStorage.setItem('pixeltap-anim-' + this._currentProjectId, JSON.stringify(animData));
      } catch (e) { /* ignore */ }
    }
  }

  // ============================================================
  // ANIMATION SAVE/LOAD (localStorage)
  // ============================================================
  _saveAnimToStorage() {
    try {
      const data = {
        frames: this.animFrames,
        currentFrameIndex: this.currentFrameIndex,
        fps: this.fps,
      };
      localStorage.setItem('pixeltap-anim', JSON.stringify(data));
    } catch (e) {
      console.warn('Anim save failed:', e);
    }
  }

  _loadAnimFromStorage(key = 'pixeltap-anim') {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data.frames && data.frames.length > 0) {
        this.animFrames = data.frames;
        this.currentFrameIndex = data.currentFrameIndex || 0;
        this.fps = data.fps || 8;
        document.getElementById('fps-input').value = this.fps;
      }
    } catch (e) {
      console.warn('Anim load failed:', e);
    }
  }

  // ============================================================
  // PALETTE
  // ============================================================
  _setupPalette() {
    const bar = document.getElementById('palette-bar');

    DEFAULT_PALETTE.forEach(color => {
      const swatch = document.createElement('div');
      swatch.className = 'palette-color';
      swatch.style.background = color;
      swatch.dataset.color = color;
      if (color === this.currentColor) swatch.classList.add('selected');
      swatch.addEventListener('click', () => this.setColor(color));
      bar.appendChild(swatch);
    });

    const picker = document.getElementById('color-picker');
    picker.addEventListener('input', (e) => this.setColor(e.target.value));
  }

  setColor(color) {
    this.currentColor = color;
    document.getElementById('current-color').style.background = color;
    document.getElementById('color-picker').value = color;
    document.querySelectorAll('.palette-color').forEach(s => {
      s.classList.toggle('selected', s.dataset.color === color);
    });
  }

  previewColor(color) {
    document.getElementById('current-color').style.background = color;
  }

  // ============================================================
  // TOOLS
  // ============================================================
  _setupTools() {
    document.querySelectorAll('.tool-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const tool = btn.dataset.tool;
        if (!tool) return;
        // If shape tool already active, show shape picker popup
        if (tool === 'shape' && this.currentTool === 'shape') {
          this._showShapePicker();
          return;
        }
        // If fill tool already active, toggle flood fill / color replace
        if (tool === 'fill' && this.currentTool === 'fill') {
          this._toggleFillMode();
          return;
        }
        this.setTool(tool);
      });
    });

    // Brush size: tap cycles 1→2→3→4→5→1
    const SIZES = [1, 2, 3, 4, 5];
    const sizeBtn = document.getElementById('btn-brush-size');
    if (sizeBtn) {
      sizeBtn.addEventListener('click', () => {
        const idx = SIZES.indexOf(this.brushSize);
        this.brushSize = SIZES[(idx + 1) % SIZES.length];
        document.getElementById('brush-size-label').textContent = this.brushSize;
      });
    }
  }

  /**
   * Show shape picker popup with outline (left) and filled (right) options.
   */
  _showShapePicker() {
    // Remove existing popup if any
    const existing = document.getElementById('shape-picker');
    if (existing) { existing.remove(); return; }

    const shapes = [
      { mode: 'rect', label: '[ ]', labelFill: '[#]', name: 'Rect' },
      { mode: 'ellipse', label: '( )', labelFill: '(#)', name: 'Oval' },
      { mode: 'triangle', label: '/\\', labelFill: '/^\\', name: 'Tri' },
      { mode: 'diamond', label: '<>', labelFill: '<#>', name: 'Dia' },
    ];

    const popup = document.createElement('div');
    popup.id = 'shape-picker';
    popup.style.cssText = `
      position: fixed; bottom: 60px; left: 50%; transform: translateX(-50%);
      background: #161616; border: 1px solid #39ff14; padding: 6px;
      display: grid; grid-template-columns: 1fr 1fr; gap: 3px;
      z-index: 50; min-width: 160px;
    `;

    // Header
    const hOutline = document.createElement('div');
    hOutline.style.cssText = 'font-size:8px;color:#666;text-align:center;text-transform:uppercase;letter-spacing:1px;padding:2px;';
    hOutline.textContent = 'Outline';
    const hFill = document.createElement('div');
    hFill.style.cssText = hOutline.style.cssText;
    hFill.textContent = 'Filled';
    popup.appendChild(hOutline);
    popup.appendChild(hFill);

    for (const shape of shapes) {
      // Outline button
      const btnOut = document.createElement('button');
      btnOut.style.cssText = `
        padding: 6px 8px; border: 1px solid #2a2a2a; background: ${this.shapeMode === shape.mode && !this.shapeFilled ? '#1a5a0a' : '#0a0a0a'};
        color: ${this.shapeMode === shape.mode && !this.shapeFilled ? '#39ff14' : '#ccc'};
        font-family: var(--font); font-size: 11px; cursor: pointer; font-weight: bold;
      `;
      btnOut.textContent = `${shape.label} ${shape.name}`;
      btnOut.addEventListener('click', () => {
        this.shapeMode = shape.mode;
        this.shapeFilled = false;
        this._updateShapeBtn();
        popup.remove();
      });

      // Filled button
      const btnFill = document.createElement('button');
      btnFill.style.cssText = `
        padding: 6px 8px; border: 1px solid #2a2a2a; background: ${this.shapeMode === shape.mode && this.shapeFilled ? '#1a5a0a' : '#0a0a0a'};
        color: ${this.shapeMode === shape.mode && this.shapeFilled ? '#39ff14' : '#ccc'};
        font-family: var(--font); font-size: 11px; cursor: pointer; font-weight: bold;
      `;
      btnFill.textContent = `${shape.labelFill} ${shape.name}`;
      btnFill.addEventListener('click', () => {
        this.shapeMode = shape.mode;
        this.shapeFilled = true;
        this._updateShapeBtn();
        popup.remove();
      });

      popup.appendChild(btnOut);
      popup.appendChild(btnFill);
    }

    document.body.appendChild(popup);

    // Close on outside tap
    const closeHandler = (e) => {
      if (!popup.contains(e.target) && !e.target.closest('[data-tool="shape"]')) {
        popup.remove();
        document.removeEventListener('pointerdown', closeHandler);
      }
    };
    setTimeout(() => document.addEventListener('pointerdown', closeHandler), 50);
  }

  _updateShapeBtn() {
    const labels = { rect: 'Rect', ellipse: 'Oval', triangle: 'Tri', diamond: 'Dia' };
    const btn = document.querySelector('[data-tool="shape"]');
    if (btn) {
      const span = btn.querySelector('span');
      if (span) span.textContent = (this.shapeFilled ? '■' : '□') + labels[this.shapeMode];
      const img = btn.querySelector('img');
      if (img) img.src = this.shapeMode === 'ellipse' ? ICON_ELLIPSE : ICON_SHAPE;
    }
  }

  /**
   * Toggle fill mode between flood fill and color replace.
   */
  _toggleFillMode() {
    this.fillReplace = !this.fillReplace;
    const btn = document.querySelector('[data-tool="fill"]');
    if (btn) {
      const span = btn.querySelector('span');
      if (span) span.textContent = this.fillReplace ? 'Repl' : 'Fill';
    }
  }

  setTool(toolName) {
    const selTools = ['select', 'wand'];
    if (selTools.includes(this.currentTool) && !selTools.includes(toolName) && this.selection) {
      this._commitSelection();
    }
    // Clear wand highlight when switching away
    if (this._wandHighlight) {
      this._wandHighlight = null;
      this.pixelCanvas.render();
    }
    // Cancel in-progress line/shape preview
    if ((this.currentTool === 'line' || this.currentTool === 'shape') && this._shapeStart) {
      this._shapeStart = null;
      this._shapeEnd = null;
      this.pixelCanvas.render();
    }
    if (toolName !== 'eyedropper') {
      this.previousTool = this.currentTool;
    }
    this.currentTool = toolName;
    document.querySelectorAll('.tool-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tool === toolName);
    });
  }

  switchToPreviousTool() {
    this.setTool(this.previousTool || 'pencil');
  }

  get activeTool() {
    return Tools[this.currentTool] || Tools.pencil;
  }

  // ============================================================
  // SYMMETRY DRAWING
  // ============================================================
  /**
   * Paint with brush size + symmetry. Tools call this for pencil/eraser strokes.
   */
  paintBrush(x, y, color) {
    const s = this.brushSize;
    const offset = Math.floor((s - 1) / 2);
    for (let dy = 0; dy < s; dy++) {
      for (let dx = 0; dx < s; dx++) {
        this.setPixel(x - offset + dx, y - offset + dy, color);
      }
    }
  }

  /**
   * Set single pixel with symmetry support.
   */
  setPixel(x, y, color) {
    this.pixelCanvas.setPixel(x, y, color);
    const mode = this.pixelCanvas.symmetryMode;
    if (mode === 'none') return;

    const gw = this.pixelCanvas.gridWidth;
    const gh = this.pixelCanvas.gridHeight;

    if (mode === 'vertical' || mode === 'both') {
      this.pixelCanvas.setPixel(gw - 1 - x, y, color);
    }
    if (mode === 'horizontal' || mode === 'both') {
      this.pixelCanvas.setPixel(x, gh - 1 - y, color);
    }
    if (mode === 'both') {
      this.pixelCanvas.setPixel(gw - 1 - x, gh - 1 - y, color);
    }
  }

  _setupSymmetry() {
    const btn = document.getElementById('btn-symmetry');
    if (!btn) return;

    const modes = ['none', 'vertical', 'horizontal', 'both'];
    const icons = {
      none: ICON_SYM_OFF,
      vertical: ICON_SYM_V,
      horizontal: ICON_SYM_H,
      both: ICON_SYM_BOTH,
    };

    btn.addEventListener('click', () => {
      if (!this._requirePro('Symmetry')) return;
      const currentIdx = modes.indexOf(this.pixelCanvas.symmetryMode);
      const nextIdx = (currentIdx + 1) % modes.length;
      this.pixelCanvas.symmetryMode = modes[nextIdx];

      const icon = document.getElementById('icon-symmetry');
      if (icon) icon.src = icons[modes[nextIdx]];

      btn.classList.toggle('active', modes[nextIdx] !== 'none');
      this.pixelCanvas.render();
    });
  }

  // ============================================================
  // SELECTION helpers
  // ============================================================
  _isInsideSelection(gx, gy) {
    if (!this.selection) return false;
    const s = this.selection;
    return gx >= s.x && gx < s.x + s.w && gy >= s.y && gy < s.y + s.h;
  }

  _commitSelection() {
    if (!this.selection) return;
    this.pixelCanvas.pasteRegion(this.selection, this.selection.x, this.selection.y);
    this.selection = null;
    this.pixelCanvas.render();
    this._saveState();
  }

  _renderSelectionPreview() {
    if (!this._selectStart || !this._selectEnd) return;
    const ctx = this.pixelCanvas.ctx;
    const size = this.pixelCanvas.cellSize;
    const dpr = this.pixelCanvas.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const x0 = Math.min(this._selectStart.x, this._selectEnd.x);
    const y0 = Math.min(this._selectStart.y, this._selectEnd.y);
    const x1 = Math.max(this._selectStart.x, this._selectEnd.x);
    const y1 = Math.max(this._selectStart.y, this._selectEnd.y);

    const px = this.pixelCanvas.panX + x0 * size;
    const py = this.pixelCanvas.panY + y0 * size;
    const pw = (x1 - x0 + 1) * size;
    const ph = (y1 - y0 + 1) * size;

    ctx.strokeStyle = '#39ff14';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(px, py, pw, ph);
    ctx.setLineDash([]);
  }

  _renderSelectionOverlay() {
    if (!this.selection) return;
    const ctx = this.pixelCanvas.ctx;
    const size = this.pixelCanvas.cellSize;
    const dpr = this.pixelCanvas.dpr;
    const s = this.selection;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    for (let dy = 0; dy < s.h; dy++) {
      for (let dx = 0; dx < s.w; dx++) {
        const color = s.pixels[dy][dx];
        if (color) {
          const px = this.pixelCanvas.panX + (s.x + dx) * size;
          const py = this.pixelCanvas.panY + (s.y + dy) * size;
          ctx.fillStyle = color;
          ctx.fillRect(px, py, size + 0.5, size + 0.5);
        }
      }
    }

    const bx = this.pixelCanvas.panX + s.x * size;
    const by = this.pixelCanvas.panY + s.y * size;
    ctx.strokeStyle = '#39ff14';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(bx, by, s.w * size, s.h * size);
    ctx.setLineDash([]);
  }

  // ============================================================
  // WAND HIGHLIGHT helpers
  // ============================================================
  _isInsideWandHighlight(gx, gy) {
    if (!this._wandHighlight) return false;
    const h = this._wandHighlight;
    return h.matchedCoords.some(p => p.x === gx && p.y === gy);
  }

  _renderWandHighlight() {
    if (!this._wandHighlight) return;
    const ctx = this.pixelCanvas.ctx;
    const size = this.pixelCanvas.cellSize;
    const dpr = this.pixelCanvas.dpr;
    const h = this._wandHighlight;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Draw semi-transparent overlay on matched pixels
    ctx.fillStyle = 'rgba(57, 255, 20, 0.25)';
    for (const p of h.matchedCoords) {
      const px = this.pixelCanvas.panX + p.x * size;
      const py = this.pixelCanvas.panY + p.y * size;
      ctx.fillRect(px, py, size + 0.5, size + 0.5);
    }

    // Draw dashed border around bounding box
    const bx = this.pixelCanvas.panX + h.x * size;
    const by = this.pixelCanvas.panY + h.y * size;
    ctx.strokeStyle = '#39ff14';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(bx, by, h.w * size, h.h * size);
    ctx.setLineDash([]);
  }

  // ============================================================
  // TOP BAR
  // ============================================================
  _setupTopBar() {
    document.getElementById('btn-grid-size').addEventListener('click', () => {
      document.getElementById('grid-size-modal').classList.add('visible');
    });

    document.getElementById('btn-grid').addEventListener('click', () => {
      this.pixelCanvas.showGrid = !this.pixelCanvas.showGrid;
      document.getElementById('btn-grid').classList.toggle(
        'active', this.pixelCanvas.showGrid
      );
      this.pixelCanvas.render();
      this._scheduleAutoSave();
    });

    document.getElementById('btn-clear').addEventListener('click', () => {
      if (this.pixelCanvas.isEmpty()) return;
      if (confirm('Clear the entire canvas?')) {
        this.pixelCanvas.clear();
        this._saveState();
      }
    });

    document.getElementById('btn-layers').addEventListener('click', () => {
      const panel = document.getElementById('layers-panel');
      panel.classList.toggle('open');
      this._refreshLayersList();
    });

    const onionBtn = document.getElementById('btn-onion');
    if (onionBtn) {
      onionBtn.addEventListener('click', () => {
        this._toggleOnionSkin();
      });
    }

    // Photo import
    const photoBtn = document.getElementById('btn-photo');
    if (photoBtn) {
      photoBtn.addEventListener('click', () => {
        this._importPhoto();
        document.getElementById('more-menu')?.classList.remove('visible');
      });
    }

    // More menu (…)
    const moreBtn = document.getElementById('btn-more');
    const moreMenu = document.getElementById('more-menu');
    if (moreBtn && moreMenu) {
      moreBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        moreMenu.classList.toggle('visible');
      });
      // Close on tap outside
      document.addEventListener('click', () => {
        moreMenu.classList.remove('visible');
      });
      // Close on clear button click
      document.getElementById('btn-clear')?.addEventListener('click', () => {
        moreMenu.classList.remove('visible');
      });
    }

    // Shop / PRO button
    this._setupShop();

    // Template library
    this._setupTemplateModal();

    // Gallery
    this._setupGallery();
  }

  // ============================================================
  // SHOP / STARS PAYMENTS
  // ============================================================
  _setupShop() {
    const BOT_API = 'https://pixeltap-bot-production.up.railway.app';

    const shopBtn = document.getElementById('btn-shop');
    const shopModal = document.getElementById('shop-modal');
    const closeBtn = document.getElementById('btn-close-shop');
    if (!shopBtn || !shopModal) return;

    // Only show shop inside Telegram
    if (!this.tg) {
      shopBtn.style.display = 'none';
      return;
    }

    shopBtn.addEventListener('click', () => {
      if (this.isPro) {
        // Already unlocked — no need to show shop
        return;
      }

      shopModal.classList.add('visible');
      const container = document.getElementById('shop-items');
      container.innerHTML = `
        <div class="pro-promo">
          <div class="pro-promo-title">PixelTap Pro</div>
          <div class="pro-promo-features">
            <div>Animation & timeline</div>
            <div>Up to 20 layers</div>
            <div>Canvas up to 256×256</div>
            <div>Onion skin</div>
            <div>Symmetry drawing</div>
            <div>GIF & sprite sheet export</div>
          </div>
          <button class="pro-buy-btn" id="btn-buy-pro">50 Stars</button>
          <div class="promo-section">
            <div class="promo-divider">or</div>
            <div class="promo-row">
              <input type="text" id="promo-input" class="promo-input" placeholder="Promo code" maxlength="10" autocomplete="off" autocapitalize="characters">
              <button class="promo-btn" id="btn-redeem">OK</button>
            </div>
            <div class="promo-msg" id="promo-msg"></div>
          </div>
        </div>
      `;

      // Redeem promo code
      document.getElementById('btn-redeem').addEventListener('click', async () => {
        const input = document.getElementById('promo-input');
        const msg = document.getElementById('promo-msg');
        const code = input.value.trim();
        if (!code) return;

        const userId = this.tg?.initDataUnsafe?.user?.id || 'unknown';
        msg.textContent = '...';
        msg.className = 'promo-msg';

        try {
          const res = await fetch(`${BOT_API}/api/redeem`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code, userId }),
          });
          const data = await res.json();
          if (data.ok) {
            msg.textContent = 'PRO unlocked!';
            msg.className = 'promo-msg success';
            this._unlockPro();
            setTimeout(() => shopModal.classList.remove('visible'), 800);
          } else {
            msg.textContent = data.error || 'Invalid code';
            msg.className = 'promo-msg error';
          }
        } catch (e) {
          msg.textContent = 'Network error';
          msg.className = 'promo-msg error';
        }
      });

      document.getElementById('btn-buy-pro').addEventListener('click', async (e) => {
        const btn = e.target;
        const userId = this.tg.initDataUnsafe?.user?.id;
        btn.textContent = '...';

        try {
          const res = await fetch(`${BOT_API}/api/invoice`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ productId: 'pro_pack', userId }),
          });
          const data = await res.json();
          if (data.ok && data.invoiceLink) {
            this.tg.openInvoice(data.invoiceLink, (status) => {
              if (status === 'paid') {
                this._unlockPro();
                shopModal.classList.remove('visible');
              } else {
                btn.textContent = '50 Stars';
              }
            });
          } else {
            btn.textContent = 'Error';
          }
        } catch (e) {
          console.error('Invoice error:', e);
          btn.textContent = 'Error';
        }
      });
    });

    closeBtn.addEventListener('click', () => {
      shopModal.classList.remove('visible');
    });

    shopModal.addEventListener('click', (e) => {
      if (e.target === shopModal) shopModal.classList.remove('visible');
    });
  }

  // ============================================================
  // TEMPLATE LIBRARY
  // ============================================================
  _setupTemplateModal() {
    const modal = document.getElementById('template-modal');
    const closeBtn = document.getElementById('btn-close-templates');
    const openBtn = document.getElementById('btn-templates');
    if (!modal || !openBtn) return;

    openBtn.addEventListener('click', () => {
      this._renderTemplateModal('all');
      modal.classList.add('visible');
    });

    closeBtn.addEventListener('click', () => modal.classList.remove('visible'));
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.classList.remove('visible');
    });
  }

  _renderTemplateModal(activeCategory) {
    const tabsContainer = document.getElementById('template-categories');
    const grid = document.getElementById('template-grid');
    tabsContainer.innerHTML = '';
    grid.innerHTML = '';

    // Category tabs
    for (const cat of TEMPLATE_CATEGORIES) {
      if (cat.pro && !this.isPro) continue;
      const tab = document.createElement('button');
      tab.className = `template-tab${cat.id === activeCategory ? ' active' : ''}`;
      tab.textContent = cat.name;
      tab.addEventListener('click', () => this._renderTemplateModal(cat.id));
      tabsContainer.appendChild(tab);
    }

    // Template cards
    const filtered = activeCategory === 'all'
      ? TEMPLATES
      : TEMPLATES.filter(t => t.category === activeCategory);

    for (const template of filtered) {
      const card = document.createElement('div');
      card.className = 'template-card';

      const preview = renderTemplatePreview(template, 64);
      card.appendChild(preview);

      const name = document.createElement('div');
      name.className = 'template-card-name';
      name.textContent = template.name;
      card.appendChild(name);

      if (template.pro && !this.isPro) {
        const badge = document.createElement('div');
        badge.className = 'pro-badge';
        badge.textContent = 'PRO';
        card.appendChild(badge);
      }

      card.addEventListener('click', () => {
        if (template.pro && !this._requirePro('PRO Templates')) return;
        this._loadTemplate(template);
        document.getElementById('template-modal').classList.remove('visible');
      });

      grid.appendChild(card);
    }
  }

  _loadTemplate(template) {
    const { pixels, width, height } = parseTemplate(template);

    // Commit any existing selection first
    if (this.selection) this._commitSelection();

    // Center template on canvas as a floating selection
    const offsetX = Math.max(0, Math.floor((this.pixelCanvas.gridWidth - width) / 2));
    const offsetY = Math.max(0, Math.floor((this.pixelCanvas.gridHeight - height) / 2));

    this.selection = {
      x: offsetX,
      y: offsetY,
      w: width,
      h: height,
      pixels,
    };

    // Switch to select tool so user can drag it
    this.setTool('select');
    this.pixelCanvas.render();
    this._renderSelectionOverlay();
  }

  // ============================================================
  // GALLERY — save/load multiple projects
  // ============================================================
  _setupGallery() {
    const modal = document.getElementById('gallery-modal');
    const closeBtn = document.getElementById('btn-close-gallery');
    const openBtn = document.getElementById('btn-gallery');
    const newBtn = document.getElementById('btn-gallery-new');
    if (!modal || !openBtn) return;

    // Current project ID (null = default unnamed project)
    if (!this._currentProjectId) {
      this._currentProjectId = localStorage.getItem('pixeltap-current-project') || null;
    }

    openBtn.addEventListener('click', () => {
      this._renderGallery();
      modal.classList.add('visible');
    });

    closeBtn.addEventListener('click', () => modal.classList.remove('visible'));
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.classList.remove('visible');
    });

    newBtn.addEventListener('click', () => {
      const name = prompt('Project name:');
      if (!name || !name.trim()) return;
      this._gallerySaveCurrentProject();
      this._galleryCreateNew(name.trim());
      modal.classList.remove('visible');
    });
  }

  _getGalleryIndex() {
    try {
      const raw = localStorage.getItem('pixeltap-gallery');
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  }

  _saveGalleryIndex(index) {
    localStorage.setItem('pixeltap-gallery', JSON.stringify(index));
  }

  _gallerySaveCurrentProject() {
    // Save current canvas + animation to a project slot
    const id = this._currentProjectId || ('proj_' + Date.now());
    this._currentProjectId = id;
    localStorage.setItem('pixeltap-current-project', id);

    // Save canvas data
    this.pixelCanvas.saveToStorage('pixeltap-proj-' + id);

    // Save animation data
    const animData = {
      frames: this.animFrames,
      currentFrameIndex: this.currentFrameIndex,
      fps: this.fps,
    };
    try {
      localStorage.setItem('pixeltap-anim-' + id, JSON.stringify(animData));
    } catch (e) { console.warn('Gallery anim save failed:', e); }

    // Generate thumbnail
    const thumb = this._galleryThumbnail();

    // Update gallery index
    const index = this._getGalleryIndex();
    const existing = index.find(p => p.id === id);
    if (existing) {
      existing.thumb = thumb;
      existing.updatedAt = Date.now();
      existing.w = this.pixelCanvas.gridWidth;
      existing.h = this.pixelCanvas.gridHeight;
    } else {
      index.unshift({
        id,
        name: 'Untitled',
        thumb,
        w: this.pixelCanvas.gridWidth,
        h: this.pixelCanvas.gridHeight,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }
    this._saveGalleryIndex(index);
  }

  _galleryThumbnail() {
    // Render a small thumbnail data URL from current canvas
    const src = this.pixelCanvas.canvas;
    const size = 80;
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, size, size);
    // Fit proportionally
    const gw = this.pixelCanvas.gridWidth;
    const gh = this.pixelCanvas.gridHeight;
    const scale = Math.min(size / gw, size / gh);
    const dw = gw * scale;
    const dh = gh * scale;
    const dx = (size - dw) / 2;
    const dy = (size - dh) / 2;
    // Render layers composited to a temp canvas first
    const tmp = document.createElement('canvas');
    tmp.width = gw; tmp.height = gh;
    const tctx = tmp.getContext('2d');
    for (const layer of this.pixelCanvas.layers) {
      if (!layer.visible) continue;
      tctx.globalAlpha = layer.opacity;
      for (let y = 0; y < gh; y++) {
        for (let x = 0; x < gw; x++) {
          const px = layer.pixels[y]?.[x];
          if (px) {
            tctx.fillStyle = px;
            tctx.fillRect(x, y, 1, 1);
          }
        }
      }
    }
    tctx.globalAlpha = 1;
    ctx.drawImage(tmp, dx, dy, dw, dh);
    return c.toDataURL('image/png');
  }

  _galleryCreateNew(name) {
    const id = 'proj_' + Date.now();
    this._currentProjectId = id;
    localStorage.setItem('pixeltap-current-project', id);

    // Reset canvas
    this.pixelCanvas.setGridSize(32, 32);
    this.pixelCanvas.layers.forEach(l => {
      l.pixels = l.pixels.map(row => row.map(() => null));
    });
    // Keep only one layer
    while (this.pixelCanvas.layers.length > 1) {
      this.pixelCanvas.layers.pop();
    }
    this.pixelCanvas.layers[0].name = 'Layer 1';
    this.pixelCanvas.activeLayerIndex = 0;
    this.pixelCanvas.bgColor = null;

    // Reset animation
    this.animFrames = [this.pixelCanvas.getSnapshot()];
    this.currentFrameIndex = 0;
    this.fps = 8;
    document.getElementById('fps-input').value = this.fps;

    this.pixelCanvas.render();
    this.pixelCanvas.fitToScreen();
    this._syncGridSizeUI();
    this._refreshTimeline();
    this._refreshLayersList();
    this.history.clear();
    this.history.push(this.pixelCanvas.getSnapshot());

    // Save to gallery index
    const thumb = this._galleryThumbnail();
    const index = this._getGalleryIndex();
    index.unshift({
      id, name, thumb,
      w: 32, h: 32,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    this._saveGalleryIndex(index);

    // Auto-save
    this._autoSave();
  }

  _galleryLoadProject(id) {
    const loaded = this.pixelCanvas.loadFromStorage('pixeltap-proj-' + id);
    if (!loaded) return false;

    this._currentProjectId = id;
    localStorage.setItem('pixeltap-current-project', id);

    // Load animation
    try {
      const raw = localStorage.getItem('pixeltap-anim-' + id);
      if (raw) {
        const data = JSON.parse(raw);
        if (data.frames && data.frames.length > 0) {
          this.animFrames = data.frames;
          this.currentFrameIndex = data.currentFrameIndex || 0;
          this.fps = data.fps || 8;
          document.getElementById('fps-input').value = this.fps;
        }
      } else {
        this.animFrames = [this.pixelCanvas.getSnapshot()];
        this.currentFrameIndex = 0;
      }
    } catch (e) {
      this.animFrames = [this.pixelCanvas.getSnapshot()];
      this.currentFrameIndex = 0;
    }

    this.pixelCanvas.render();
    this.pixelCanvas.fitToScreen();
    this._syncGridSizeUI();
    this._refreshTimeline();
    this._refreshLayersList();
    this._updateOnionSkin();
    this.history.clear();
    this.history.push(this.pixelCanvas.getSnapshot());

    return true;
  }

  _galleryDeleteProject(id) {
    localStorage.removeItem('pixeltap-proj-' + id);
    localStorage.removeItem('pixeltap-anim-' + id);
    const index = this._getGalleryIndex().filter(p => p.id !== id);
    this._saveGalleryIndex(index);

    // If deleting current project, switch to blank
    if (id === this._currentProjectId) {
      this._currentProjectId = null;
      localStorage.removeItem('pixeltap-current-project');
    }
  }

  _galleryRenameProject(id, newName) {
    const index = this._getGalleryIndex();
    const proj = index.find(p => p.id === id);
    if (proj) {
      proj.name = newName;
      this._saveGalleryIndex(index);
    }
  }

  _renderGallery() {
    // Save current project first so thumbnail is up-to-date
    this._gallerySaveCurrentProject();

    const grid = document.getElementById('gallery-grid');
    grid.innerHTML = '';

    const index = this._getGalleryIndex();
    if (index.length === 0) {
      grid.innerHTML = '<div class="gallery-empty">No saved projects yet</div>';
      return;
    }

    for (const proj of index) {
      const card = document.createElement('div');
      card.className = 'gallery-card';
      if (proj.id === this._currentProjectId) card.classList.add('active');

      // Thumbnail
      const canvas = document.createElement('canvas');
      canvas.width = 80; canvas.height = 80;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      if (proj.thumb) {
        const img = new Image();
        img.onload = () => ctx.drawImage(img, 0, 0, 80, 80);
        img.src = proj.thumb;
      } else {
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(0, 0, 80, 80);
      }
      card.appendChild(canvas);

      // Info
      const info = document.createElement('div');
      info.className = 'gallery-card-info';
      const nameEl = document.createElement('div');
      nameEl.className = 'gallery-card-name';
      nameEl.textContent = proj.name;
      info.appendChild(nameEl);
      const sizeEl = document.createElement('div');
      sizeEl.className = 'gallery-card-size';
      sizeEl.textContent = `${proj.w}x${proj.h}`;
      info.appendChild(sizeEl);
      card.appendChild(info);

      // Actions
      const actions = document.createElement('div');
      actions.className = 'gallery-card-actions';

      const loadBtn = document.createElement('button');
      loadBtn.textContent = proj.id === this._currentProjectId ? 'current' : 'open';
      if (proj.id === this._currentProjectId) loadBtn.disabled = true;
      loadBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (proj.id === this._currentProjectId) return;
        this._gallerySaveCurrentProject();
        if (this._galleryLoadProject(proj.id)) {
          document.getElementById('gallery-modal').classList.remove('visible');
        }
      });
      actions.appendChild(loadBtn);

      const renBtn = document.createElement('button');
      renBtn.textContent = 'rename';
      renBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const newName = prompt('New name:', proj.name);
        if (newName && newName.trim()) {
          this._galleryRenameProject(proj.id, newName.trim());
          this._renderGallery();
        }
      });
      actions.appendChild(renBtn);

      const delBtn = document.createElement('button');
      delBtn.className = 'danger';
      delBtn.textContent = 'del';
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!confirm(`Delete "${proj.name}"?`)) return;
        this._galleryDeleteProject(proj.id);
        this._renderGallery();
      });
      actions.appendChild(delBtn);

      card.appendChild(actions);

      // Click card to open
      card.addEventListener('click', () => {
        if (proj.id === this._currentProjectId) return;
        this._gallerySaveCurrentProject();
        if (this._galleryLoadProject(proj.id)) {
          document.getElementById('gallery-modal').classList.remove('visible');
        }
      });

      grid.appendChild(card);
    }
  }

  // ============================================================
  // PHOTO IMPORT (as reference background)
  // ============================================================
  _importPhoto() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (ev) => {
        const img = new Image();
        img.onload = () => {
          this._setReferenceImage(img);
        };
        img.src = ev.target.result;
      };
      reader.readAsDataURL(file);
    });
    input.click();
  }

  _setReferenceImage(img) {
    // Store reference image on pixelCanvas for rendering behind pixels
    this.pixelCanvas.referenceImage = img;
    this.pixelCanvas.referenceOpacity = 0.3;
    this.pixelCanvas.render();

    // Show controls to adjust/remove reference
    this._showRefControls();
  }

  _showRefControls() {
    // Remove existing
    const existing = document.getElementById('ref-controls');
    if (existing) existing.remove();

    const bar = document.createElement('div');
    bar.id = 'ref-controls';
    bar.style.cssText = `
      display: flex; align-items: center; height: 28px; padding: 0 8px;
      background: #0f0f0f; border-top: 1px solid rgba(0, 180, 255, 0.3);
      gap: 6px; flex-shrink: 0;
    `;

    const label = document.createElement('span');
    label.style.cssText = 'font-size:8px;font-weight:bold;color:rgba(0,180,255,0.8);text-transform:uppercase;letter-spacing:1px;white-space:nowrap;font-family:var(--font);';
    label.textContent = 'REF';

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0.05';
    slider.max = '0.8';
    slider.step = '0.05';
    slider.value = '0.3';
    slider.style.cssText = 'flex:1;height:3px;-webkit-appearance:none;appearance:none;background:#2a2a2a;outline:none;';

    const valLabel = document.createElement('span');
    valLabel.style.cssText = 'font-size:9px;color:#00d4ff;font-weight:bold;min-width:28px;text-align:right;font-family:var(--font);';
    valLabel.textContent = '30%';

    slider.addEventListener('input', () => {
      this.pixelCanvas.referenceOpacity = parseFloat(slider.value);
      valLabel.textContent = Math.round(slider.value * 100) + '%';
      this.pixelCanvas.render();
    });

    // Scale slider
    const scaleLabel = document.createElement('span');
    scaleLabel.style.cssText = 'font-size:8px;font-weight:bold;color:rgba(0,180,255,0.8);text-transform:uppercase;letter-spacing:1px;white-space:nowrap;font-family:var(--font);margin-left:4px;';
    scaleLabel.textContent = 'SIZE';

    const scaleSlider = document.createElement('input');
    scaleSlider.type = 'range';
    scaleSlider.min = '0.2';
    scaleSlider.max = '3';
    scaleSlider.step = '0.1';
    scaleSlider.value = String(this.pixelCanvas.referenceScale || 1);
    scaleSlider.style.cssText = 'width:50px;height:3px;-webkit-appearance:none;appearance:none;background:#2a2a2a;outline:none;';

    const scaleVal = document.createElement('span');
    scaleVal.style.cssText = 'font-size:9px;color:#00d4ff;font-weight:bold;min-width:28px;text-align:right;font-family:var(--font);';
    scaleVal.textContent = Math.round((this.pixelCanvas.referenceScale || 1) * 100) + '%';

    scaleSlider.addEventListener('input', () => {
      this.pixelCanvas.referenceScale = parseFloat(scaleSlider.value);
      scaleVal.textContent = Math.round(scaleSlider.value * 100) + '%';
      this.pixelCanvas.render();
    });

    // Move toggle button
    const moveBtn = document.createElement('button');
    moveBtn.style.cssText = 'padding:2px 5px;border:1px solid #2a2a2a;background:#161616;color:#00b4ff;font-family:var(--font);font-size:9px;cursor:pointer;font-weight:bold;';
    moveBtn.textContent = 'MOVE';
    moveBtn.addEventListener('click', () => {
      this._refMoveMode = !this._refMoveMode;
      moveBtn.style.background = this._refMoveMode ? '#00b4ff' : '#161616';
      moveBtn.style.color = this._refMoveMode ? '#000' : '#00b4ff';
    });

    const removeBtn = document.createElement('button');
    removeBtn.style.cssText = 'padding:2px 5px;border:1px solid #2a2a2a;background:#161616;color:#ff3333;font-family:var(--font);font-size:9px;cursor:pointer;font-weight:bold;';
    removeBtn.textContent = 'X';
    removeBtn.addEventListener('click', () => {
      this.pixelCanvas.referenceImage = null;
      this.pixelCanvas.referenceOffsetX = 0;
      this.pixelCanvas.referenceOffsetY = 0;
      this.pixelCanvas.referenceScale = 1;
      this._refMoveMode = false;
      this.pixelCanvas.render();
      bar.remove();
    });

    bar.appendChild(label);
    bar.appendChild(slider);
    bar.appendChild(valLabel);
    bar.appendChild(scaleLabel);
    bar.appendChild(scaleSlider);
    bar.appendChild(scaleVal);
    bar.appendChild(moveBtn);
    bar.appendChild(removeBtn);

    // Insert before onion-bar
    const onionBar = document.getElementById('onion-bar');
    onionBar.parentNode.insertBefore(bar, onionBar);
  }

  _syncGridSizeUI() {
    const label = document.getElementById('grid-size-label');
    if (label) {
      label.textContent = `${this.pixelCanvas.gridWidth}x${this.pixelCanvas.gridHeight}`;
    }
  }

  // ============================================================
  // GRID SIZE MODAL
  // ============================================================
  _setupGridSizeModal() {
    const modal = document.getElementById('grid-size-modal');
    if (!modal) return;

    const buildPresets = (container, presets) => {
      presets.forEach(p => {
        const btn = document.createElement('button');
        btn.className = 'preset-btn';
        btn.textContent = p.label;
        btn.addEventListener('click', () => this._applyGridSize(p.w, p.h));
        container.appendChild(btn);
      });
    };

    buildPresets(document.getElementById('presets-square'), GRID_PRESETS.square);
    buildPresets(document.getElementById('presets-phone'), GRID_PRESETS.phone);
    buildPresets(document.getElementById('presets-wide'), GRID_PRESETS.wide);

    document.getElementById('btn-apply-custom-size').addEventListener('click', () => {
      const maxSize = this.isPro ? 256 : 64;
      const w = parseInt(document.getElementById('custom-width').value) || 32;
      const h = parseInt(document.getElementById('custom-height').value) || 32;
      this._applyGridSize(
        Math.max(2, Math.min(maxSize, w)),
        Math.max(2, Math.min(maxSize, h))
      );
    });

    document.getElementById('btn-close-grid-modal').addEventListener('click', () => {
      modal.classList.remove('visible');
    });

    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.classList.remove('visible');
    });
  }

  _applyGridSize(w, h) {
    if (w === this.pixelCanvas.gridWidth && h === this.pixelCanvas.gridHeight) {
      document.getElementById('grid-size-modal').classList.remove('visible');
      return;
    }

    if (!this.isPro && (w > 64 || h > 64)) {
      this._requirePro('Canvas > 64×64');
      return;
    }

    if (!this.pixelCanvas.isEmpty()) {
      if (!confirm(`Change to ${w}x${h}? Drawing may be cropped.`)) return;
    }

    this.pixelCanvas.setGridSize(w, h);
    this.history.clear();
    this.history.push(this.pixelCanvas.getSnapshot());

    // Reset animation frames since grid changed
    this.animFrames = [this.pixelCanvas.getSnapshot()];
    this.currentFrameIndex = 0;
    this._refreshTimeline();

    this._syncGridSizeUI();
    this._scheduleAutoSave();
    document.getElementById('grid-size-modal').classList.remove('visible');
  }

  // ============================================================
  // BACKGROUND COLOR
  // ============================================================
  _setupBgColor() {
    const picker = document.getElementById('bg-color-picker');
    const toggleBtn = document.getElementById('btn-bg-toggle');

    // Sync UI from pixelCanvas state
    if (this.pixelCanvas.bgColor) {
      picker.value = this.pixelCanvas.bgColor;
      toggleBtn.textContent = 'on';
      toggleBtn.classList.add('active');
    }

    picker.addEventListener('input', (e) => {
      if (this.pixelCanvas.bgColor !== null) {
        this.pixelCanvas.bgColor = e.target.value;
        this.pixelCanvas.render();
        this._scheduleAutoSave();
      }
    });

    toggleBtn.addEventListener('click', () => {
      if (this.pixelCanvas.bgColor) {
        this.pixelCanvas.bgColor = null;
        toggleBtn.textContent = 'off';
        toggleBtn.classList.remove('active');
      } else {
        this.pixelCanvas.bgColor = picker.value;
        toggleBtn.textContent = 'on';
        toggleBtn.classList.add('active');
      }
      this.pixelCanvas.render();
      this._scheduleAutoSave();
    });
  }

  // ============================================================
  // ONION SKIN SETTINGS
  // ============================================================
  _toggleOnionSkin() {
    if (!this.pixelCanvas.onionSkin && !this._requirePro('Onion Skin')) return;
    this.pixelCanvas.onionSkin = !this.pixelCanvas.onionSkin;
    this._syncOnionUI();
    this._updateOnionSkin();
    this.pixelCanvas.render();
  }

  _syncOnionUI() {
    const on = this.pixelCanvas.onionSkin;
    // Top bar icon button
    const topBtn = document.getElementById('btn-onion');
    if (topBtn) topBtn.classList.toggle('active', on);
    // Onion settings bar visibility
    const bar = document.getElementById('onion-bar');
    if (bar) bar.classList.toggle('visible', on);
  }

  _setupOnionSettings() {
    // Frame count — tap buttons instead of number input
    const countContainer = document.getElementById('onion-count-btns');
    if (countContainer) {
      for (let i = 1; i <= 5; i++) {
        const btn = document.createElement('button');
        btn.className = 'sm-btn onion-count-btn' + (i === this.pixelCanvas.onionCount ? ' active' : '');
        btn.textContent = i;
        btn.dataset.count = i;
        btn.addEventListener('click', () => {
          this.pixelCanvas.onionCount = i;
          countContainer.querySelectorAll('.onion-count-btn').forEach(b => {
            b.classList.toggle('active', parseInt(b.dataset.count) === i);
          });
          this._updateOnionSkin();
          this.pixelCanvas.render();
        });
        countContainer.appendChild(btn);
      }
    }

    // Direction buttons
    const dirBtns = {
      'btn-onion-prev': 'prev',
      'btn-onion-both': 'both',
      'btn-onion-next': 'next',
    };

    this._syncOnionDirButtons();

    for (const [btnId, dir] of Object.entries(dirBtns)) {
      const btn = document.getElementById(btnId);
      if (btn) {
        btn.addEventListener('click', () => {
          this.pixelCanvas.onionDirection = dir;
          this._syncOnionDirButtons();
          this._updateOnionSkin();
          this.pixelCanvas.render();
        });
      }
    }
  }

  _syncOnionDirButtons() {
    const dir = this.pixelCanvas.onionDirection;
    document.querySelectorAll('.onion-dir').forEach(btn => {
      const btnDir = btn.id.replace('btn-onion-', '');
      btn.classList.toggle('active', btnDir === dir);
    });
  }

  // ============================================================
  // LAYERS PANEL
  // ============================================================
  _setupLayersPanel() {
    document.getElementById('btn-add-layer').addEventListener('click', () => {
      if (!this.isPro && this.pixelCanvas.layers.length >= 1) {
        this._requirePro('Layers');
        return;
      }
      const layer = this.pixelCanvas.addLayer();
      if (layer) {
        this._saveState();
        this._refreshLayersList();
      }
    });

    document.getElementById('btn-delete-layer').addEventListener('click', () => {
      if (this.pixelCanvas.layers.length <= 1) return;
      if (confirm('Delete this layer?')) {
        this.pixelCanvas.removeLayer(this.pixelCanvas.activeLayerIndex);
        this._saveState();
        this._refreshLayersList();
      }
    });

    document.getElementById('btn-merge-layer').addEventListener('click', () => {
      if (this.pixelCanvas.mergeDown(this.pixelCanvas.activeLayerIndex)) {
        this._saveState();
        this._refreshLayersList();
      }
    });

    document.getElementById('btn-dup-layer').addEventListener('click', () => {
      if (!this.isPro && this.pixelCanvas.layers.length >= 1) {
        this._requirePro('Layers');
        return;
      }
      const dup = this.pixelCanvas.duplicateLayer(this.pixelCanvas.activeLayerIndex);
      if (dup) {
        this._saveState();
        this._refreshLayersList();
      }
    });

    document.getElementById('btn-layer-up').addEventListener('click', () => {
      const i = this.pixelCanvas.activeLayerIndex;
      if (i < this.pixelCanvas.layers.length - 1) {
        this.pixelCanvas.moveLayer(i, i + 1);
        this._saveState();
        this._refreshLayersList();
      }
    });

    document.getElementById('btn-layer-down').addEventListener('click', () => {
      const i = this.pixelCanvas.activeLayerIndex;
      if (i > 0) {
        this.pixelCanvas.moveLayer(i, i - 1);
        this._saveState();
        this._refreshLayersList();
      }
    });

    document.getElementById('layer-opacity').addEventListener('input', (e) => {
      const layer = this.pixelCanvas.activeLayer;
      layer.opacity = parseFloat(e.target.value);
      document.getElementById('opacity-value').textContent = Math.round(layer.opacity * 100) + '%';
      this.pixelCanvas.render();
    });

    document.getElementById('layer-opacity').addEventListener('change', () => {
      this._saveState();
    });
  }

  _refreshLayersList() {
    const list = document.getElementById('layers-list');
    list.innerHTML = '';

    for (let i = this.pixelCanvas.layers.length - 1; i >= 0; i--) {
      const layer = this.pixelCanvas.layers[i];
      const isActive = i === this.pixelCanvas.activeLayerIndex;

      const row = document.createElement('div');
      row.className = `layer-row${isActive ? ' active' : ''}`;

      // Visibility toggle
      const eyeBtn = document.createElement('button');
      eyeBtn.className = `layer-eye${layer.visible ? ' on' : ''}`;
      eyeBtn.textContent = layer.visible ? '[o]' : '[x]';
      eyeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        layer.visible = !layer.visible;
        this.pixelCanvas.render();
        this._refreshLayersList();
        this._scheduleAutoSave();
      });

      // Layer thumbnail
      const thumbCanvas = layer.getThumbnail(24);
      if (thumbCanvas) {
        thumbCanvas.className = 'layer-preview';
        row.appendChild(eyeBtn);
        row.appendChild(thumbCanvas);
      } else {
        row.appendChild(eyeBtn);
      }

      const nameSpan = document.createElement('span');
      nameSpan.className = 'layer-name';
      nameSpan.textContent = layer.name;
      row.appendChild(nameSpan);

      row.addEventListener('click', () => {
        this.pixelCanvas.setActiveLayer(i);
        this._refreshLayersList();
        const slider = document.getElementById('layer-opacity');
        slider.value = layer.opacity;
        document.getElementById('opacity-value').textContent = Math.round(layer.opacity * 100) + '%';
      });

      list.appendChild(row);
    }

    const activeLayer = this.pixelCanvas.activeLayer;
    document.getElementById('layer-opacity').value = activeLayer.opacity;
    document.getElementById('opacity-value').textContent = Math.round(activeLayer.opacity * 100) + '%';
  }

  // ============================================================
  // ANIMATION TIMELINE
  // ============================================================
  _setupTimeline() {
    // Collapsible timeline toggle
    const toggleBtn = document.getElementById('timeline-toggle');
    const timelineBar = document.getElementById('timeline-bar');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => {
        const collapsed = timelineBar.classList.toggle('collapsed');
        toggleBtn.classList.toggle('active', !collapsed);
      });
    }

    document.getElementById('btn-add-frame').addEventListener('click', () => {
      if (!this._requirePro('Animation')) return;
      this._saveCurrentFrame();
      // New empty frame = copy current layers structure but clear pixels
      const snapshot = this.pixelCanvas.getSnapshot();
      const emptyFrame = {
        ...snapshot,
        layers: snapshot.layers.map(l => ({
          ...l,
          pixels: l.pixels.map(row => row.map(() => null))
        }))
      };
      this.animFrames.splice(this.currentFrameIndex + 1, 0, emptyFrame);
      this.currentFrameIndex++;
      this._loadFrame(this.currentFrameIndex);
      this._refreshTimeline();
      this._scheduleAutoSave();
    });

    document.getElementById('btn-dup-frame').addEventListener('click', () => {
      if (!this._requirePro('Animation')) return;
      this._saveCurrentFrame();
      const copy = JSON.parse(JSON.stringify(this.animFrames[this.currentFrameIndex]));
      this.animFrames.splice(this.currentFrameIndex + 1, 0, copy);
      this.currentFrameIndex++;
      this._loadFrame(this.currentFrameIndex);
      this._refreshTimeline();
      this._scheduleAutoSave();
    });

    document.getElementById('btn-del-frame').addEventListener('click', () => {
      if (this.animFrames.length <= 1) return;
      this.animFrames.splice(this.currentFrameIndex, 1);
      if (this.currentFrameIndex >= this.animFrames.length) {
        this.currentFrameIndex = this.animFrames.length - 1;
      }
      this._loadFrame(this.currentFrameIndex);
      this._refreshTimeline();
      this._scheduleAutoSave();
    });

    document.getElementById('btn-play').addEventListener('click', () => {
      this._togglePlay();
    });

    document.getElementById('fps-input').addEventListener('change', (e) => {
      this.fps = Math.max(1, Math.min(30, parseInt(e.target.value) || 8));
      e.target.value = this.fps;
      if (this.isPlaying) {
        this._stopPlay();
        this._startPlay();
      }
      this._scheduleAutoSave();
    });

    document.getElementById('btn-export-gif').addEventListener('click', () => {
      if (!this._requirePro('GIF Export')) return;
      this._exportGIF();
    });

    const sheetBtn = document.getElementById('btn-export-sheet');
    if (sheetBtn) {
      sheetBtn.addEventListener('click', () => {
        if (!this._requirePro('Sprite Sheet Export')) return;
        this._exportSpriteSheet();
      });
    }

    // Live Draw button
    const liveBtn = document.getElementById('btn-live-draw');
    if (liveBtn) {
      liveBtn.addEventListener('click', () => {
        this.liveDrawMode = !this.liveDrawMode;
        liveBtn.classList.toggle('active', this.liveDrawMode);
        liveBtn.classList.toggle('live-active', this.liveDrawMode);
      });
    }
  }

  _saveCurrentFrame() {
    if (this.currentFrameIndex >= 0 && this.currentFrameIndex < this.animFrames.length) {
      this.animFrames[this.currentFrameIndex] = this.pixelCanvas.getSnapshot();
    }
  }

  _loadFrame(index) {
    if (index < 0 || index >= this.animFrames.length) return;
    this.currentFrameIndex = index;
    // Preserve global bgColor across frame switches
    const bg = this.pixelCanvas.bgColor;
    this.pixelCanvas.loadSnapshot(this.animFrames[index]);
    this.pixelCanvas.bgColor = bg;
    this.history.clear();
    this.history.push(this.pixelCanvas.getSnapshot());
    this._refreshLayersList();
    this._updateOnionSkin();
  }

  _refreshTimeline() {
    // Auto-expand timeline when multiple frames exist
    if (this.animFrames.length > 1) {
      const tBar = document.getElementById('timeline-bar');
      const tToggle = document.getElementById('timeline-toggle');
      if (tBar?.classList.contains('collapsed')) {
        tBar.classList.remove('collapsed');
        tToggle?.classList.add('active');
      }
    }

    // Update frame counter
    const counter = document.getElementById('frame-counter');
    if (counter) {
      counter.textContent = `${this.currentFrameIndex + 1}/${this.animFrames.length}`;
    }

    const container = document.getElementById('frames-container');
    container.innerHTML = '';

    this.animFrames.forEach((frame, i) => {
      const thumb = document.createElement('div');
      thumb.className = `frame-thumb${i === this.currentFrameIndex ? ' active' : ''}`;

      // Render mini preview
      const miniCanvas = this.pixelCanvas.renderFrameToCanvas(frame, 32, 32);
      thumb.appendChild(miniCanvas);

      const num = document.createElement('span');
      num.className = 'frame-number';
      num.textContent = i + 1;
      thumb.appendChild(num);

      thumb.addEventListener('click', () => {
        if (this.isPlaying) return;
        this._saveCurrentFrame();
        this._loadFrame(i);
        this._refreshTimeline();
      });

      container.appendChild(thumb);
    });

    // Scroll active frame into view
    const activeThumb = container.querySelector('.frame-thumb.active');
    if (activeThumb) {
      activeThumb.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }

  _updateOnionSkin() {
    if (!this.pixelCanvas.onionSkin) {
      this.pixelCanvas.onionPrevFrames = [];
      this.pixelCanvas.onionNextFrames = [];
      return;
    }
    this._saveCurrentFrame();
    const dir = this.pixelCanvas.onionDirection;
    const count = this.pixelCanvas.onionCount;

    // Previous frames (closest first)
    const prev = [];
    if (dir === 'prev' || dir === 'both') {
      for (let i = this.currentFrameIndex - 1; i >= 0 && prev.length < count; i--) {
        prev.push(this.animFrames[i].layers);
      }
    }
    this.pixelCanvas.onionPrevFrames = prev;

    // Next frames (closest first)
    const next = [];
    if (dir === 'next' || dir === 'both') {
      for (let i = this.currentFrameIndex + 1; i < this.animFrames.length && next.length < count; i++) {
        next.push(this.animFrames[i].layers);
      }
    }
    this.pixelCanvas.onionNextFrames = next;
  }

  _togglePlay() {
    if (this.isPlaying) {
      this._stopPlay();
    } else {
      this._startPlay();
    }
  }

  _startPlay() {
    if (this.animFrames.length <= 1) return;
    this._saveCurrentFrame();
    this.isPlaying = true;
    document.getElementById('icon-play').src = ICON_STOP;
    document.getElementById('btn-play').classList.add('active');
    // Show live indicator if live draw mode is on
    const liveInd = document.getElementById('live-indicator');
    if (liveInd) liveInd.classList.toggle('visible', this.liveDrawMode);

    const delay = Math.round(1000 / this.fps);
    this._playInterval = setInterval(() => {
      // In live draw mode, save current frame's live edits before advancing
      if (this.liveDrawMode) {
        this._saveCurrentFrame();
      }
      this.currentFrameIndex = (this.currentFrameIndex + 1) % this.animFrames.length;
      const bg = this.pixelCanvas.bgColor;
      this.pixelCanvas.loadSnapshot(this.animFrames[this.currentFrameIndex]);
      this.pixelCanvas.bgColor = bg;
      this._highlightActiveFrame();
    }, delay);
  }

  _stopPlay() {
    // Save any live edits on the current frame before stopping
    if (this.liveDrawMode) {
      this._saveCurrentFrame();
    }
    this.isPlaying = false;
    clearInterval(this._playInterval);
    document.getElementById('icon-play').src = ICON_PLAY;
    document.getElementById('btn-play').classList.remove('active');
    const liveInd = document.getElementById('live-indicator');
    if (liveInd) liveInd.classList.remove('visible');
    this._refreshTimeline();
    this._refreshLayersList();
    // Reload current frame to ensure history is clean
    if (this.liveDrawMode) {
      this.history.clear();
      this.history.push(this.pixelCanvas.getSnapshot());
    }
  }

  _highlightActiveFrame() {
    const container = document.getElementById('frames-container');
    container.querySelectorAll('.frame-thumb').forEach((el, i) => {
      el.classList.toggle('active', i === this.currentFrameIndex);
    });
    const counter = document.getElementById('frame-counter');
    if (counter) {
      counter.textContent = `${this.currentFrameIndex + 1}/${this.animFrames.length}`;
    }
  }

  // ============================================================
  // GIF EXPORT
  // ============================================================
  _exportGIF() {
    if (this.animFrames.length < 2) {
      alert('Add at least 2 frames to export a GIF.');
      return;
    }

    this._saveCurrentFrame();

    const scale = 8;
    const w = this.pixelCanvas.gridWidth * scale;
    const h = this.pixelCanvas.gridHeight * scale;

    const encoder = new GIFEncoder(w, h);
    encoder.setDelay(Math.round(1000 / this.fps));
    encoder.setRepeat(0); // infinite loop
    encoder.start();

    for (const frame of this.animFrames) {
      const canvas = this.pixelCanvas.renderFrameToCanvas(frame, w, h);
      encoder.addFrame(canvas.getContext('2d'));
    }

    encoder.finish();
    const blob = encoder.toBlob();
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.download = `pixeltap-${Date.now()}.gif`;
    link.href = url;
    link.click();

    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  // ============================================================
  // SPRITE SHEET EXPORT
  // ============================================================
  _exportSpriteSheet() {
    if (this.animFrames.length < 2) {
      alert('Add at least 2 frames to export a sprite sheet.');
      return;
    }

    this._saveCurrentFrame();

    const scale = 4;
    const frameW = this.pixelCanvas.gridWidth * scale;
    const frameH = this.pixelCanvas.gridHeight * scale;
    const cols = Math.ceil(Math.sqrt(this.animFrames.length));
    const rows = Math.ceil(this.animFrames.length / cols);
    const sheetW = cols * frameW;
    const sheetH = rows * frameH;

    const canvas = document.createElement('canvas');
    canvas.width = sheetW;
    canvas.height = sheetH;
    const ctx = canvas.getContext('2d');

    // Transparent background
    ctx.clearRect(0, 0, sheetW, sheetH);

    this.animFrames.forEach((frame, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const frameCanvas = this.pixelCanvas.renderFrameToCanvas(frame, frameW, frameH);
      ctx.drawImage(frameCanvas, col * frameW, row * frameH);
    });

    canvas.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.download = `pixeltap-sheet-${cols}x${rows}-${Date.now()}.png`;
      link.href = url;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    }, 'image/png');
  }

  // ============================================================
  // HISTORY
  // ============================================================
  _setupHistory() {
    const undoBtn = document.getElementById('btn-undo');
    const redoBtn = document.getElementById('btn-redo');

    this.history.onChange((canUndo, canRedo) => {
      undoBtn.disabled = !canUndo;
      redoBtn.disabled = !canRedo;
    });

    undoBtn.addEventListener('click', () => this._undo());
    redoBtn.addEventListener('click', () => this._redo());
  }

  _undo() {
    const snapshot = this.history.undo();
    if (snapshot) {
      this.pixelCanvas.loadSnapshot(snapshot);
      this._refreshLayersList();
      this._scheduleAutoSave();
    }
  }

  _redo() {
    const snapshot = this.history.redo();
    if (snapshot) {
      this.pixelCanvas.loadSnapshot(snapshot);
      this._refreshLayersList();
      this._scheduleAutoSave();
    }
  }

  _saveState() {
    this.history.push(this.pixelCanvas.getSnapshot());
    // Also update current animation frame
    this._saveCurrentFrame();
    this._scheduleAutoSave();
  }

  // ============================================================
  // EXPORT PNG
  // ============================================================
  _setupExport() {
    const overlay = document.createElement('div');
    overlay.id = 'export-preview';
    const hasMultiFrames = () => this.animFrames.length >= 2;
    overlay.innerHTML = `
      <img id="export-img" alt="Preview">
      <div class="export-options">
        <label class="toggle-label">
          <input type="checkbox" id="export-alpha" checked>
          <span>Transparent BG</span>
        </label>
      </div>
      <div class="export-actions">
        <button class="modal-btn primary" id="btn-download">PNG</button>
        <button class="modal-btn primary" id="btn-download-gif" style="display:none">GIF</button>
        <button class="modal-btn primary" id="btn-download-sheet" style="display:none">SHEET</button>
        <button class="modal-btn secondary" id="btn-export-close">Close</button>
      </div>
    `;
    document.body.appendChild(overlay);

    const alphaCheckbox = document.getElementById('export-alpha');
    const exportImg = document.getElementById('export-img');
    const gifBtn = document.getElementById('btn-download-gif');
    const sheetBtn = document.getElementById('btn-download-sheet');

    const refreshPreview = () => {
      const includeAlpha = alphaCheckbox.checked;
      exportImg.src = this.pixelCanvas.exportPNG(16, includeAlpha);
      // Show GIF/Sheet buttons if multi-frame
      const multi = hasMultiFrames();
      gifBtn.style.display = multi ? '' : 'none';
      sheetBtn.style.display = multi ? '' : 'none';
    };

    document.getElementById('btn-export').addEventListener('click', () => {
      if (this.pixelCanvas.isEmpty()) return;
      refreshPreview();
      overlay.classList.add('visible');
    });

    alphaCheckbox.addEventListener('change', refreshPreview);

    document.getElementById('btn-download').addEventListener('click', () => {
      const link = document.createElement('a');
      link.download = `pixeltap-${Date.now()}.png`;
      link.href = exportImg.src;
      link.click();
    });

    gifBtn.addEventListener('click', () => {
      overlay.classList.remove('visible');
      this._exportGIF();
    });

    sheetBtn.addEventListener('click', () => {
      overlay.classList.remove('visible');
      this._exportSpriteSheet();
    });

    document.getElementById('btn-export-close').addEventListener('click', () => {
      overlay.classList.remove('visible');
    });

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.classList.remove('visible');
    });
  }

  // ============================================================
  // TOUCH EVENTS
  // ============================================================
  _setupTouchEvents() {
    const container = document.getElementById('canvas-container');
    container.addEventListener('touchstart', (e) => this._onTouchStart(e), { passive: false });
    container.addEventListener('touchmove', (e) => this._onTouchMove(e), { passive: false });
    container.addEventListener('touchend', (e) => this._onTouchEnd(e), { passive: false });
    container.addEventListener('touchcancel', (e) => this._onTouchEnd(e), { passive: false });
  }

  _onTouchStart(e) {
    e.preventDefault();
    // Close layers panel on canvas tap
    const layersPanel = document.getElementById('layers-panel');
    if (layersPanel?.classList.contains('open')) {
      layersPanel.classList.remove('open');
    }
    if (e.touches.length === 2) {
      this._startPinch(e);
      this.isDrawing = false;
      return;
    }
    // REF move mode — drag photo reference
    if (this._refMoveMode && this.pixelCanvas.referenceImage && e.touches.length === 1) {
      this._refDragging = true;
      this._refDragStartX = e.touches[0].clientX;
      this._refDragStartY = e.touches[0].clientY;
      this._refDragInitOX = this.pixelCanvas.referenceOffsetX;
      this._refDragInitOY = this.pixelCanvas.referenceOffsetY;
      return;
    }
    // Block drawing during playback unless live draw mode is on (pencil/eraser/line only)
    if (this.isPlaying && !(this.liveDrawMode && ['pencil', 'eraser', 'line'].includes(this.currentTool))) return;
    if (e.touches.length === 1 && !this.isPinching) {
      const touch = e.touches[0];
      const grid = this.pixelCanvas.screenToGrid(touch.clientX, touch.clientY);
      const selTools = this.currentTool === 'select' || this.currentTool === 'wand';
      if (this.pixelCanvas.isInBounds(grid.x, grid.y) || selTools) {
        this.isDrawing = true;
        this.lastGridPos = grid;
        this.activeTool.onStart(this, grid.x, grid.y);
      }
    }
  }

  _onTouchMove(e) {
    e.preventDefault();
    if (e.touches.length === 2 && this.isPinching) {
      this._updatePinch(e);
      return;
    }
    // REF move drag
    if (this._refDragging && e.touches.length === 1) {
      const dx = e.touches[0].clientX - this._refDragStartX;
      const dy = e.touches[0].clientY - this._refDragStartY;
      const size = this.pixelCanvas.cellSize;
      this.pixelCanvas.referenceOffsetX = this._refDragInitOX + dx / size;
      this.pixelCanvas.referenceOffsetY = this._refDragInitOY + dy / size;
      this.pixelCanvas.render();
      return;
    }
    if (e.touches.length === 1 && this.isDrawing && !this.isPinching) {
      const touch = e.touches[0];
      const grid = this.pixelCanvas.screenToGrid(touch.clientX, touch.clientY);
      if (this.lastGridPos && (grid.x !== this.lastGridPos.x || grid.y !== this.lastGridPos.y)) {
        this.activeTool.onMove(this, grid.x, grid.y, this.lastGridPos.x, this.lastGridPos.y);
        this.lastGridPos = grid;
      }
    }
  }

  _onTouchEnd(e) {
    if (e.touches.length < 2) this.isPinching = false;
    if (e.touches.length === 0) {
      this._refDragging = false;
      if (this.isDrawing) {
        this.isDrawing = false;
        this.activeTool.onEnd(this);
        if (this.isPlaying && this.liveDrawMode) {
          // In live draw mode, just save to current frame (no history)
          this._saveCurrentFrame();
        } else if (this.currentTool !== 'select' && this.currentTool !== 'wand') {
          this._saveState();
        }
      }
      this.lastGridPos = null;
    }
  }

  // ============================================================
  // PINCH ZOOM / PAN
  // ============================================================
  _startPinch(e) {
    this.isPinching = true;
    const t0 = e.touches[0];
    const t1 = e.touches[1];
    this.initialPinchDist = this._touchDist(t0, t1);
    this.initialZoom = this.pixelCanvas.zoom;
    this.initialPanX = this.pixelCanvas.panX;
    this.initialPanY = this.pixelCanvas.panY;
    const rect = this.pixelCanvas.canvas.getBoundingClientRect();
    this.pinchMidX = (t0.clientX + t1.clientX) / 2 - rect.left;
    this.pinchMidY = (t0.clientY + t1.clientY) / 2 - rect.top;
  }

  _updatePinch(e) {
    const t0 = e.touches[0];
    const t1 = e.touches[1];
    const currentDist = this._touchDist(t0, t1);
    const scale = currentDist / this.initialPinchDist;
    const newZoom = Math.max(0.3, Math.min(15, this.initialZoom * scale));
    const zoomRatio = newZoom / this.initialZoom;
    const newPanX = this.pinchMidX - (this.pinchMidX - this.initialPanX) * zoomRatio;
    const newPanY = this.pinchMidY - (this.pinchMidY - this.initialPanY) * zoomRatio;
    const rect = this.pixelCanvas.canvas.getBoundingClientRect();
    const currentMidX = (t0.clientX + t1.clientX) / 2 - rect.left;
    const currentMidY = (t0.clientY + t1.clientY) / 2 - rect.top;
    this.pixelCanvas.zoom = newZoom;
    this.pixelCanvas.panX = newPanX + (currentMidX - this.pinchMidX);
    this.pixelCanvas.panY = newPanY + (currentMidY - this.pinchMidY);
    this.pixelCanvas.render();
    this._showZoomIndicator(newZoom);
  }

  _touchDist(t0, t1) {
    const dx = t0.clientX - t1.clientX;
    const dy = t0.clientY - t1.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  _addZoomIndicator() {
    const zi = document.createElement('div');
    zi.id = 'zoom-indicator';
    document.getElementById('canvas-container').appendChild(zi);

    // Live draw recording indicator
    const li = document.createElement('div');
    li.id = 'live-indicator';
    li.innerHTML = '<span class="live-dot"></span> LIVE';
    document.getElementById('canvas-container').appendChild(li);
  }

  _showZoomIndicator(zoom) {
    const el = document.getElementById('zoom-indicator');
    if (!el) return;
    el.textContent = `${Math.round(zoom * 100)}%`;
    el.classList.add('visible');
    clearTimeout(this._zoomTimeout);
    this._zoomTimeout = setTimeout(() => el.classList.remove('visible'), 1000);
  }

  // ============================================================
  // MOUSE EVENTS (desktop)
  // ============================================================
  _setupMouseEvents() {
    const container = document.getElementById('canvas-container');
    let mouseDown = false;

    container.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      // Block drawing during playback unless live draw mode is on (pencil/eraser/line only)
      if (this.isPlaying && !(this.liveDrawMode && ['pencil', 'eraser', 'line'].includes(this.currentTool))) return;
      mouseDown = true;
      const grid = this.pixelCanvas.screenToGrid(e.clientX, e.clientY);
      const selTools = this.currentTool === 'select' || this.currentTool === 'wand';
      if (this.pixelCanvas.isInBounds(grid.x, grid.y) || selTools) {
        this.isDrawing = true;
        this.lastGridPos = grid;
        this.activeTool.onStart(this, grid.x, grid.y);
      }
    });

    container.addEventListener('mousemove', (e) => {
      if (!mouseDown || !this.isDrawing) return;
      const grid = this.pixelCanvas.screenToGrid(e.clientX, e.clientY);
      if (this.lastGridPos && (grid.x !== this.lastGridPos.x || grid.y !== this.lastGridPos.y)) {
        this.activeTool.onMove(this, grid.x, grid.y, this.lastGridPos.x, this.lastGridPos.y);
        this.lastGridPos = grid;
      }
    });

    const endMouse = () => {
      if (mouseDown && this.isDrawing) {
        this.isDrawing = false;
        this.activeTool.onEnd(this);
        if (this.isPlaying && this.liveDrawMode) {
          this._saveCurrentFrame();
        } else if (this.currentTool !== 'select' && this.currentTool !== 'wand') {
          this._saveState();
        }
      }
      mouseDown = false;
      this.lastGridPos = null;
    };

    container.addEventListener('mouseup', endMouse);
    container.addEventListener('mouseleave', endMouse);

    // Scroll zoom
    container.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      const oldZoom = this.pixelCanvas.zoom;
      const newZoom = Math.max(0.3, Math.min(15, oldZoom * delta));
      const rect = this.pixelCanvas.canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const zr = newZoom / oldZoom;
      this.pixelCanvas.panX = mx - (mx - this.pixelCanvas.panX) * zr;
      this.pixelCanvas.panY = my - (my - this.pixelCanvas.panY) * zr;
      this.pixelCanvas.zoom = newZoom;
      this.pixelCanvas.render();
      this._showZoomIndicator(newZoom);
    }, { passive: false });

    // Double-click = fit to screen
    container.addEventListener('dblclick', () => this.pixelCanvas.fitToScreen());
  }

  // ============================================================
  // KEYBOARD
  // ============================================================
  _setupKeyboard() {
    document.addEventListener('keydown', (e) => {
      // Don't capture if user is typing in an input
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); this._undo(); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && e.shiftKey) { e.preventDefault(); this._redo(); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'y') { e.preventDefault(); this._redo(); }
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); document.getElementById('btn-export').click(); }

      if (!e.ctrlKey && !e.metaKey) {
        switch (e.key.toLowerCase()) {
          case 'b': case 'p': this.setTool('pencil'); break;
          case 'e': this.setTool('eraser'); break;
          case 'g': this.setTool('fill'); break;
          case 'i': this.setTool('eyedropper'); break;
          case 'l': this.setTool('line'); break;
          case 'u':
            if (this.currentTool === 'shape') this._showShapePicker();
            else this.setTool('shape');
            break;
          case 'w': this.setTool('wand'); break;
          case 'm': this.setTool('select'); break;
          case 'escape':
            if (this.selection) this._commitSelection();
            break;
          case ' ':
            e.preventDefault();
            this._togglePlay();
            break;
          case 'arrowleft':
            if (this.currentFrameIndex > 0 && !this.isPlaying) {
              this._saveCurrentFrame();
              this._loadFrame(this.currentFrameIndex - 1);
              this._refreshTimeline();
            }
            break;
          case 'arrowright':
            if (this.currentFrameIndex < this.animFrames.length - 1 && !this.isPlaying) {
              this._saveCurrentFrame();
              this._loadFrame(this.currentFrameIndex + 1);
              this._refreshTimeline();
            }
            break;
        }
      }
    });
  }
}

// ============================================================
// LAUNCH
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  window.app = new PixelPaintApp();
});
