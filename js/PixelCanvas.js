/**
 * PixelCanvas v3 - core rendering engine with layers, background layer,
 * layer thumbnails, animation support, and enhanced export.
 */

// ============================================================
// Layer class
// ============================================================
export class Layer {
  constructor(width, height, name = 'Layer 1') {
    this.id = Date.now() + Math.random();
    this.name = name;
    this.visible = true;
    this.opacity = 1.0;
    this.locked = false;
    this.pixels = Layer.createGrid(width, height);
  }

  static createGrid(w, h) {
    return Array.from({ length: h }, () => new Array(w).fill(null));
  }

  resize(newW, newH) {
    const oldPixels = this.pixels;
    const oldH = oldPixels.length;
    const oldW = oldH > 0 ? oldPixels[0].length : 0;
    this.pixels = Array.from({ length: newH }, (_, y) =>
      Array.from({ length: newW }, (_, x) =>
        (y < oldH && x < oldW) ? oldPixels[y][x] : null
      )
    );
  }

  clone() {
    const copy = new Layer(0, 0, this.name + ' copy');
    copy.id = Date.now() + Math.random();
    copy.visible = this.visible;
    copy.opacity = this.opacity;
    copy.locked = this.locked;
    copy.pixels = this.pixels.map(row => [...row]);
    return copy;
  }

  isEmpty() {
    return this.pixels.every(row => row.every(px => px === null));
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      visible: this.visible,
      opacity: this.opacity,
      locked: this.locked,
      pixels: this.pixels,
    };
  }

  static fromJSON(data, width, height) {
    const layer = new Layer(width, height, data.name);
    layer.id = data.id;
    layer.visible = data.visible;
    layer.opacity = data.opacity ?? 1.0;
    layer.locked = data.locked ?? false;
    layer.pixels = Array.from({ length: height }, (_, y) =>
      Array.from({ length: width }, (_, x) =>
        data.pixels[y]?.[x] ?? null
      )
    );
    return layer;
  }

  /**
   * Generate a small thumbnail canvas of this layer.
   * Returns a canvas element or data URL.
   */
  getThumbnail(size = 24) {
    const h = this.pixels.length;
    const w = h > 0 ? this.pixels[0].length : 0;
    if (!w || !h) return null;

    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    const cellW = size / w;
    const cellH = size / h;

    // Checkerboard bg for transparency
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const px = x * cellW;
        const py = y * cellH;
        ctx.fillStyle = (x + y) % 2 === 0 ? '#2a2a2a' : '#1e1e1e';
        ctx.fillRect(px, py, cellW + 0.5, cellH + 0.5);
        const color = this.pixels[y][x];
        if (color) {
          ctx.fillStyle = color;
          ctx.fillRect(px, py, cellW + 0.5, cellH + 0.5);
        }
      }
    }
    return canvas;
  }
}

// ============================================================
// PixelCanvas
// ============================================================
export class PixelCanvas {
  constructor(canvasElement) {
    this.canvas = canvasElement;
    this.ctx = canvasElement.getContext('2d');

    // Grid
    this.gridWidth = 32;
    this.gridHeight = 32;

    // Layers
    this.layers = [new Layer(32, 32, 'Layer 1')];
    this.activeLayerIndex = 0;
    this.maxLayers = 20;

    // Background layer (not in the layers array - separate)
    this.bgColor = null;   // null = transparent (checkerboard), or '#rrggbb'

    // Reference image (photo behind pixels for tracing)
    this.referenceImage = null;
    this.referenceOpacity = 0.3;
    this.referenceScale = 1;
    this.referenceOffsetX = 0;
    this.referenceOffsetY = 0;

    // View
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this.showGrid = true;

    // Display
    this.displayWidth = 0;
    this.displayHeight = 0;
    this.dpr = window.devicePixelRatio || 1;

    // Onion skin
    this.onionSkin = false;
    this.onionPrevFrames = [];   // Previous frames (layer stacks)
    this.onionNextFrames = [];   // Next frames (layer stacks)
    this.onionDirection = 'prev'; // 'prev', 'next', 'both'
    this.onionOpacity = 0.4;
    this.onionCount = 2;

    // Symmetry
    this.symmetryMode = 'none'; // 'none', 'vertical', 'horizontal', 'both'

    this._setupResize();
  }

  // ----------------------------------------------------------
  // Active layer accessors
  // ----------------------------------------------------------
  get activeLayer() {
    return this.layers[this.activeLayerIndex] || this.layers[0];
  }

  setActiveLayer(index) {
    if (index >= 0 && index < this.layers.length) {
      this.activeLayerIndex = index;
    }
  }

  // ----------------------------------------------------------
  // Layer management
  // ----------------------------------------------------------
  addLayer(name) {
    if (this.layers.length >= this.maxLayers) return null;
    const idx = this.activeLayerIndex + 1;
    const layer = new Layer(this.gridWidth, this.gridHeight,
      name || `Layer ${this.layers.length + 1}`);
    this.layers.splice(idx, 0, layer);
    this.activeLayerIndex = idx;
    this.render();
    return layer;
  }

  removeLayer(index) {
    if (this.layers.length <= 1) return false;
    this.layers.splice(index, 1);
    if (this.activeLayerIndex >= this.layers.length) {
      this.activeLayerIndex = this.layers.length - 1;
    }
    this.render();
    return true;
  }

  moveLayer(fromIndex, toIndex) {
    if (toIndex < 0 || toIndex >= this.layers.length) return;
    const [layer] = this.layers.splice(fromIndex, 1);
    this.layers.splice(toIndex, 0, layer);
    if (this.activeLayerIndex === fromIndex) {
      this.activeLayerIndex = toIndex;
    }
    this.render();
  }

  mergeDown(index) {
    if (index <= 0 || index >= this.layers.length) return false;
    const upper = this.layers[index];
    const lower = this.layers[index - 1];
    for (let y = 0; y < this.gridHeight; y++) {
      for (let x = 0; x < this.gridWidth; x++) {
        if (upper.pixels[y][x] !== null) {
          lower.pixels[y][x] = upper.pixels[y][x];
        }
      }
    }
    this.layers.splice(index, 1);
    this.activeLayerIndex = index - 1;
    this.render();
    return true;
  }

  duplicateLayer(index) {
    if (this.layers.length >= this.maxLayers) return null;
    const clone = this.layers[index].clone();
    this.layers.splice(index + 1, 0, clone);
    this.activeLayerIndex = index + 1;
    this.render();
    return clone;
  }

  // ----------------------------------------------------------
  // Pixel operations (on active layer)
  // ----------------------------------------------------------
  isInBounds(x, y) {
    return x >= 0 && x < this.gridWidth && y >= 0 && y < this.gridHeight;
  }

  getPixel(x, y) {
    if (!this.isInBounds(x, y)) return undefined;
    return this.activeLayer.pixels[y][x];
  }

  setPixel(x, y, color) {
    const layer = this.activeLayer;
    if (layer.locked) return;
    if (this.isInBounds(x, y)) {
      layer.pixels[y][x] = color;
    }
  }

  getCompositePixel(x, y) {
    if (!this.isInBounds(x, y)) return null;
    for (let i = this.layers.length - 1; i >= 0; i--) {
      const layer = this.layers[i];
      if (layer.visible && layer.pixels[y][x] !== null) {
        return layer.pixels[y][x];
      }
    }
    return this.bgColor || null;
  }

  // ----------------------------------------------------------
  // Grid resize
  // ----------------------------------------------------------
  setGridSize(width, height) {
    for (const layer of this.layers) {
      layer.resize(width, height);
    }
    this.gridWidth = width;
    this.gridHeight = height;
    this.zoom = 1;
    this.centerView();
    this.render();
  }

  // ----------------------------------------------------------
  // View
  // ----------------------------------------------------------
  get cellSize() {
    const fitW = this.displayWidth / this.gridWidth;
    const fitH = this.displayHeight / this.gridHeight;
    return Math.min(fitW, fitH) * this.zoom * 0.9;
  }

  centerView() {
    const size = this.cellSize;
    this.panX = (this.displayWidth - this.gridWidth * size) / 2;
    this.panY = (this.displayHeight - this.gridHeight * size) / 2;
  }

  fitToScreen() {
    this.zoom = 1;
    this.centerView();
    this.render();
  }

  screenToGrid(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const size = this.cellSize;
    return {
      x: Math.floor((x - this.panX) / size),
      y: Math.floor((y - this.panY) / size)
    };
  }

  // ----------------------------------------------------------
  // Resize observer
  // ----------------------------------------------------------
  _setupResize() {
    const container = this.canvas.parentElement;
    this._resizeObserver = new ResizeObserver(() => {
      const rect = container.getBoundingClientRect();
      this.canvas.width = rect.width * this.dpr;
      this.canvas.height = rect.height * this.dpr;
      this.canvas.style.width = `${rect.width}px`;
      this.canvas.style.height = `${rect.height}px`;
      this.displayWidth = rect.width;
      this.displayHeight = rect.height;
      this.render();
    });
    this._resizeObserver.observe(container);
  }

  // ----------------------------------------------------------
  // Render
  // ----------------------------------------------------------
  render() {
    const ctx = this.ctx;
    const size = this.cellSize;
    const w = this.displayWidth;
    const h = this.displayHeight;
    if (!w || !h) return;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    // Canvas area background
    ctx.fillStyle = '#111111';
    ctx.fillRect(0, 0, w, h);

    const startX = this.panX;
    const startY = this.panY;

    // --- 1. Draw background (checkerboard or solid color) ---
    for (let gy = 0; gy < this.gridHeight; gy++) {
      for (let gx = 0; gx < this.gridWidth; gx++) {
        const px = startX + gx * size;
        const py = startY + gy * size;
        if (px + size < 0 || px > w || py + size < 0 || py > h) continue;

        if (this.bgColor) {
          ctx.fillStyle = this.bgColor;
        } else {
          ctx.fillStyle = (gx + gy) % 2 === 0 ? '#3a3a3a' : '#2e2e2e';
        }
        ctx.fillRect(px, py, size + 0.5, size + 0.5);
      }
    }

    // --- 1.5 Draw reference image (photo for tracing) ---
    if (this.referenceImage) {
      ctx.save();
      ctx.globalAlpha = this.referenceOpacity;
      const canvasW = this.gridWidth * size;
      const canvasH = this.gridHeight * size;
      // Fit image to canvas area preserving aspect ratio
      const imgRatio = this.referenceImage.width / this.referenceImage.height;
      const canvasRatio = canvasW / canvasH;
      const scale = this.referenceScale || 1;
      let drawW, drawH, drawX, drawY;
      if (imgRatio > canvasRatio) {
        drawW = canvasW * scale;
        drawH = (canvasW / imgRatio) * scale;
      } else {
        drawH = canvasH * scale;
        drawW = (canvasH * imgRatio) * scale;
      }
      drawX = startX + (canvasW - drawW) / 2 + (this.referenceOffsetX || 0) * size;
      drawY = startY + (canvasH - drawH) / 2 + (this.referenceOffsetY || 0) * size;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.referenceImage, drawX, drawY, drawW, drawH);
      ctx.restore();
    }

    // --- 2. Draw onion skin frames ---
    if (this.onionSkin) {
      // Previous frames (red tint)
      if (this.onionPrevFrames.length > 0) {
        const prevTints = ['rgba(255, 60, 60, 0.20)', 'rgba(255, 60, 60, 0.12)'];
        for (let f = 0; f < this.onionPrevFrames.length; f++) {
          const frame = this.onionPrevFrames[f];
          const alpha = this.onionOpacity * (1 - f * 0.25);
          if (!frame || alpha <= 0) continue;
          ctx.globalAlpha = alpha;
          this._renderLayerStack(ctx, frame, startX, startY, size, w, h);
          ctx.globalAlpha = 1;
          ctx.fillStyle = prevTints[Math.min(f, prevTints.length - 1)];
          this._renderLayerMask(ctx, frame, startX, startY, size, w, h);
        }
      }
      // Next frames (green tint)
      if (this.onionNextFrames.length > 0) {
        const nextTints = ['rgba(60, 255, 60, 0.20)', 'rgba(60, 255, 60, 0.12)'];
        for (let f = 0; f < this.onionNextFrames.length; f++) {
          const frame = this.onionNextFrames[f];
          const alpha = this.onionOpacity * (1 - f * 0.25);
          if (!frame || alpha <= 0) continue;
          ctx.globalAlpha = alpha;
          this._renderLayerStack(ctx, frame, startX, startY, size, w, h);
          ctx.globalAlpha = 1;
          ctx.fillStyle = nextTints[Math.min(f, nextTints.length - 1)];
          this._renderLayerMask(ctx, frame, startX, startY, size, w, h);
        }
      }
      ctx.globalAlpha = 1;
    }

    // --- 3. Draw current frame layers ---
    for (let gy = 0; gy < this.gridHeight; gy++) {
      for (let gx = 0; gx < this.gridWidth; gx++) {
        const px = startX + gx * size;
        const py = startY + gy * size;
        if (px + size < 0 || px > w || py + size < 0 || py > h) continue;

        for (const layer of this.layers) {
          if (!layer.visible) continue;
          const color = layer.pixels[gy]?.[gx];
          if (color) {
            ctx.globalAlpha = layer.opacity;
            ctx.fillStyle = color;
            ctx.fillRect(px, py, size + 0.5, size + 0.5);
          }
        }
        ctx.globalAlpha = 1;
      }
    }

    // Grid lines (two passes: dark + light so visible on any background)
    if (this.showGrid && size >= 4) {
      const gridLines = () => {
        ctx.beginPath();
        for (let gx = 0; gx <= this.gridWidth; gx++) {
          const x = startX + gx * size;
          if (x >= 0 && x <= w) {
            ctx.moveTo(x, Math.max(0, startY));
            ctx.lineTo(x, Math.min(h, startY + this.gridHeight * size));
          }
        }
        for (let gy = 0; gy <= this.gridHeight; gy++) {
          const y = startY + gy * size;
          if (y >= 0 && y <= h) {
            ctx.moveTo(Math.max(0, startX), y);
            ctx.lineTo(Math.min(w, startX + this.gridWidth * size), y);
          }
        }
        ctx.stroke();
      };
      ctx.lineWidth = 0.5;
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.18)';
      gridLines();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.10)';
      gridLines();
    }

    // Border
    ctx.strokeStyle = 'rgba(57, 255, 20, 0.2)';
    ctx.lineWidth = 1;
    ctx.strokeRect(startX, startY, this.gridWidth * size, this.gridHeight * size);

    // Symmetry guide lines
    this._renderSymmetryGuides(ctx, startX, startY, size);
  }

  /**
   * Draw temporary preview pixels on top of rendered canvas (for line/shape tools).
   * Call after render(). Points is array of {x, y}.
   */
  renderPreview(points, color, alpha = 0.6) {
    const ctx = this.ctx;
    const size = this.cellSize;
    const w = this.displayWidth;
    const h = this.displayHeight;
    ctx.fillStyle = color;
    ctx.globalAlpha = alpha;
    for (const p of points) {
      if (!this.isInBounds(p.x, p.y)) continue;
      const px = this.panX + p.x * size;
      const py = this.panY + p.y * size;
      if (px + size < 0 || px > w || py + size < 0 || py > h) continue;
      ctx.fillRect(px, py, size + 0.5, size + 0.5);
    }
    ctx.globalAlpha = 1;
  }

  /**
   * Draw a color overlay only where pixels exist in the layer stack (for onion tint)
   */
  _renderLayerMask(ctx, layersData, startX, startY, size, w, h) {
    for (let gy = 0; gy < this.gridHeight; gy++) {
      for (let gx = 0; gx < this.gridWidth; gx++) {
        const px = startX + gx * size;
        const py = startY + gy * size;
        if (px + size < 0 || px > w || py + size < 0 || py > h) continue;
        let hasPixel = false;
        for (const layerData of layersData) {
          if (!layerData.visible) continue;
          if (layerData.pixels[gy]?.[gx]) { hasPixel = true; break; }
        }
        if (hasPixel) {
          ctx.fillRect(px, py, size + 0.5, size + 0.5);
        }
      }
    }
  }

  _renderLayerStack(ctx, layersData, startX, startY, size, w, h) {
    for (let gy = 0; gy < this.gridHeight; gy++) {
      for (let gx = 0; gx < this.gridWidth; gx++) {
        const px = startX + gx * size;
        const py = startY + gy * size;
        if (px + size < 0 || px > w || py + size < 0 || py > h) continue;
        for (const layerData of layersData) {
          if (!layerData.visible) continue;
          const color = layerData.pixels[gy]?.[gx];
          if (color) {
            ctx.fillStyle = color;
            ctx.fillRect(px, py, size + 0.5, size + 0.5);
          }
        }
      }
    }
  }

  // ----------------------------------------------------------
  // Symmetry guide lines
  // ----------------------------------------------------------
  _renderSymmetryGuides(ctx, startX, startY, size) {
    const mode = this.symmetryMode;
    if (mode === 'none') return;

    const totalW = this.gridWidth * size;
    const totalH = this.gridHeight * size;

    ctx.save();
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 1.5;

    // Vertical center line
    if (mode === 'vertical' || mode === 'both') {
      const cx = startX + totalW / 2;
      ctx.strokeStyle = 'rgba(0, 212, 255, 0.6)';
      ctx.beginPath();
      ctx.moveTo(cx, startY);
      ctx.lineTo(cx, startY + totalH);
      ctx.stroke();
    }

    // Horizontal center line
    if (mode === 'horizontal' || mode === 'both') {
      const cy = startY + totalH / 2;
      ctx.strokeStyle = 'rgba(0, 212, 255, 0.6)';
      ctx.beginPath();
      ctx.moveTo(startX, cy);
      ctx.lineTo(startX + totalW, cy);
      ctx.stroke();
    }

    ctx.restore();
  }

  // ----------------------------------------------------------
  // Selection support
  // ----------------------------------------------------------
  getRegion(rx, ry, rw, rh) {
    const pixels = Array.from({ length: rh }, (_, dy) =>
      Array.from({ length: rw }, (_, dx) => {
        const sx = rx + dx;
        const sy = ry + dy;
        return this.isInBounds(sx, sy) ? this.activeLayer.pixels[sy][sx] : null;
      })
    );
    return { pixels, x: rx, y: ry, w: rw, h: rh };
  }

  clearRegion(rx, ry, rw, rh) {
    for (let dy = 0; dy < rh; dy++) {
      for (let dx = 0; dx < rw; dx++) {
        const sx = rx + dx;
        const sy = ry + dy;
        if (this.isInBounds(sx, sy)) {
          this.activeLayer.pixels[sy][sx] = null;
        }
      }
    }
  }

  pasteRegion(region, tx, ty) {
    for (let dy = 0; dy < region.h; dy++) {
      for (let dx = 0; dx < region.w; dx++) {
        const px = tx + dx;
        const py = ty + dy;
        const color = region.pixels[dy][dx];
        if (color !== null && this.isInBounds(px, py)) {
          this.activeLayer.pixels[py][px] = color;
        }
      }
    }
  }

  // ----------------------------------------------------------
  // Snapshot (for undo/redo)
  // ----------------------------------------------------------
  getSnapshot() {
    return {
      layers: this.layers.map(l => ({
        ...l.toJSON(),
        pixels: l.pixels.map(row => [...row])
      })),
      activeLayerIndex: this.activeLayerIndex,
      bgColor: this.bgColor,
    };
  }

  loadSnapshot(snapshot) {
    this.layers = snapshot.layers.map(d =>
      Layer.fromJSON(d, this.gridWidth, this.gridHeight)
    );
    this.activeLayerIndex = snapshot.activeLayerIndex;
    if (this.activeLayerIndex >= this.layers.length) {
      this.activeLayerIndex = this.layers.length - 1;
    }
    if (snapshot.bgColor !== undefined) {
      this.bgColor = snapshot.bgColor;
    }
    this.render();
  }

  // ----------------------------------------------------------
  // Export PNG
  // ----------------------------------------------------------
  exportPNG(scale = 16, includeAlpha = true) {
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = this.gridWidth * scale;
    exportCanvas.height = this.gridHeight * scale;
    const ectx = exportCanvas.getContext('2d');

    // Background
    if (!includeAlpha) {
      ectx.fillStyle = this.bgColor || '#ffffff';
      ectx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
    } else if (this.bgColor) {
      ectx.fillStyle = this.bgColor;
      ectx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
    }

    // Composite layers
    for (const layer of this.layers) {
      if (!layer.visible) continue;
      ectx.globalAlpha = layer.opacity;
      for (let y = 0; y < this.gridHeight; y++) {
        for (let x = 0; x < this.gridWidth; x++) {
          const color = layer.pixels[y][x];
          if (color) {
            ectx.fillStyle = color;
            ectx.fillRect(x * scale, y * scale, scale, scale);
          }
        }
      }
    }
    ectx.globalAlpha = 1;

    return exportCanvas.toDataURL('image/png');
  }

  /**
   * Render a single frame snapshot to a canvas (for GIF/timeline thumbnails)
   */
  renderFrameToCanvas(frameSnapshot, w, h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;

    const scaleX = Math.floor(w / this.gridWidth);
    const scaleY = Math.floor(h / this.gridHeight);

    // Background
    if (this.bgColor) {
      ctx.fillStyle = this.bgColor;
      ctx.fillRect(0, 0, w, h);
    }

    const layers = frameSnapshot.layers || frameSnapshot;
    for (const layerData of layers) {
      if (!layerData.visible) continue;
      ctx.globalAlpha = layerData.opacity ?? 1;
      for (let y = 0; y < this.gridHeight; y++) {
        for (let x = 0; x < this.gridWidth; x++) {
          const color = layerData.pixels[y]?.[x];
          if (color) {
            ctx.fillStyle = color;
            ctx.fillRect(x * scaleX, y * scaleY, scaleX, scaleY);
          }
        }
      }
    }
    ctx.globalAlpha = 1;
    return c;
  }

  // ----------------------------------------------------------
  // Save / Load project (localStorage)
  // ----------------------------------------------------------
  saveToStorage(key = 'pixelpaint-project') {
    const data = {
      version: 3,
      gridWidth: this.gridWidth,
      gridHeight: this.gridHeight,
      layers: this.layers.map(l => l.toJSON()),
      activeLayerIndex: this.activeLayerIndex,
      showGrid: this.showGrid,
      bgColor: this.bgColor,
    };
    try {
      localStorage.setItem(key, JSON.stringify(data));
      return true;
    } catch (e) {
      console.warn('Auto-save failed:', e);
      return false;
    }
  }

  loadFromStorage(key = 'pixelpaint-project') {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return false;
      const data = JSON.parse(raw);

      this.gridWidth = data.gridWidth || 32;
      this.gridHeight = data.gridHeight || 32;
      this.showGrid = data.showGrid ?? true;
      this.bgColor = data.bgColor || null;

      if (data.layers && data.layers.length > 0) {
        this.layers = data.layers.map(d =>
          Layer.fromJSON(d, this.gridWidth, this.gridHeight)
        );
      } else {
        this.layers = [new Layer(this.gridWidth, this.gridHeight, 'Layer 1')];
      }

      this.activeLayerIndex = data.activeLayerIndex || 0;
      if (this.activeLayerIndex >= this.layers.length) {
        this.activeLayerIndex = 0;
      }
      return true;
    } catch (e) {
      console.warn('Load from storage failed:', e);
      return false;
    }
  }

  // ----------------------------------------------------------
  // Utility
  // ----------------------------------------------------------
  clear() {
    for (const layer of this.layers) {
      layer.pixels = Layer.createGrid(this.gridWidth, this.gridHeight);
    }
    this.render();
  }

  isEmpty() {
    return this.layers.every(l => l.isEmpty());
  }
}
