/**
 * Drawing tools for the pixel art editor.
 * Tools call app.setPixel() for symmetry support.
 */

/**
 * Bresenham line - fills gaps between touch events for smooth drawing
 */
export function bresenhamLine(x0, y0, x1, y1) {
  const points = [];
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;

  while (true) {
    points.push({ x: x0, y: y0 });
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x0 += sx; }
    if (e2 < dx) { err += dx; y0 += sy; }
  }
  return points;
}

/**
 * Flood fill using BFS on active layer
 */
export function floodFill(pixelCanvas, startX, startY, fillColor) {
  if (!pixelCanvas.isInBounds(startX, startY)) return;

  const targetColor = pixelCanvas.getPixel(startX, startY);
  if (targetColor === fillColor) return;
  if (targetColor === null && fillColor === null) return;

  const width = pixelCanvas.gridWidth;
  const height = pixelCanvas.gridHeight;
  const visited = new Uint8Array(width * height);
  const queue = [startX + startY * width];

  while (queue.length > 0) {
    const idx = queue.shift();
    if (visited[idx]) continue;

    const x = idx % width;
    const y = (idx - x) / width;

    if (!pixelCanvas.isInBounds(x, y)) continue;
    if (pixelCanvas.getPixel(x, y) !== targetColor) continue;

    visited[idx] = 1;
    pixelCanvas.setPixel(x, y, fillColor);

    if (x + 1 < width)  queue.push(idx + 1);
    if (x - 1 >= 0)     queue.push(idx - 1);
    if (y + 1 < height)  queue.push(idx + width);
    if (y - 1 >= 0)     queue.push(idx - width);
  }
}

/**
 * Parse hex color (#rrggbb) to {r, g, b}
 */
function hexToRGB(hex) {
  if (!hex || hex.length < 7) return null;
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

/**
 * Color distance (0-441). Returns max if either is null.
 */
function colorDistance(hex1, hex2) {
  if (hex1 === null || hex2 === null) return 999;
  if (hex1 === hex2) return 0;
  const a = hexToRGB(hex1);
  const b = hexToRGB(hex2);
  if (!a || !b) return 999;
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

/**
 * Magic wand - BFS to find all connected pixels of the same/similar color.
 * tolerance: 0 = exact match, higher = more similar colors (default 32).
 * Returns { pixels, x, y, w, h, matchedCoords } selection region.
 * If cut=true, pixels are removed from canvas (old behavior for move).
 * If cut=false, pixels stay on canvas (for highlight/fill).
 */
export function magicWandSelect(pixelCanvas, startX, startY, cut = true, tolerance = 32) {
  if (!pixelCanvas.isInBounds(startX, startY)) return null;

  const targetColor = pixelCanvas.getPixel(startX, startY);
  // Don't select empty/transparent pixels
  if (targetColor === null) return null;
  const width = pixelCanvas.gridWidth;
  const height = pixelCanvas.gridHeight;
  const visited = new Uint8Array(width * height);
  const matched = []; // list of {x, y}
  const queue = [startX + startY * width];

  while (queue.length > 0) {
    const idx = queue.shift();
    if (visited[idx]) continue;

    const x = idx % width;
    const y = (idx - x) / width;

    if (!pixelCanvas.isInBounds(x, y)) continue;
    const px = pixelCanvas.getPixel(x, y);
    if (px === null || colorDistance(px, targetColor) > tolerance) continue;

    visited[idx] = 1;
    matched.push({ x, y });

    if (x + 1 < width)  queue.push(idx + 1);
    if (x - 1 >= 0)     queue.push(idx - 1);
    if (y + 1 < height)  queue.push(idx + width);
    if (y - 1 >= 0)     queue.push(idx - width);
  }

  if (matched.length === 0) return null;

  // Compute bounding box
  let minX = width, minY = height, maxX = 0, maxY = 0;
  for (const p of matched) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }

  const w = maxX - minX + 1;
  const h = maxY - minY + 1;

  // Build pixel grid (only matched pixels, rest null)
  const pixels = Array.from({ length: h }, () => new Array(w).fill(null));
  for (const p of matched) {
    pixels[p.y - minY][p.x - minX] = pixelCanvas.activeLayer.pixels[p.y][p.x];
  }

  // Only cut pixels from canvas if requested
  if (cut) {
    for (const p of matched) {
      pixelCanvas.activeLayer.pixels[p.y][p.x] = null;
    }
  }

  return { pixels, x: minX, y: minY, w, h, matchedCoords: matched };
}

/**
 * Fill matched wand coordinates with a new color.
 */
export function magicWandFill(pixelCanvas, matchedCoords, color) {
  for (const p of matchedCoords) {
    pixelCanvas.activeLayer.pixels[p.y][p.x] = color;
  }
}

/**
 * Generate rectangle outline or filled points.
 */
export function rectPoints(x0, y0, x1, y1, filled = false) {
  const points = [];
  const minX = Math.min(x0, x1), maxX = Math.max(x0, x1);
  const minY = Math.min(y0, y1), maxY = Math.max(y0, y1);
  if (filled) {
    for (let y = minY; y <= maxY; y++)
      for (let x = minX; x <= maxX; x++)
        points.push({ x, y });
  } else {
    for (let x = minX; x <= maxX; x++) {
      points.push({ x, y: minY });
      if (minY !== maxY) points.push({ x, y: maxY });
    }
    for (let y = minY + 1; y < maxY; y++) {
      points.push({ x: minX, y });
      if (minX !== maxX) points.push({ x: maxX, y });
    }
  }
  return points;
}

/**
 * Generate ellipse points using midpoint ellipse algorithm.
 * Fixed: no gaps at region transitions by plotting boundary point in both regions.
 */
export function ellipsePoints(x0, y0, x1, y1, filled = false) {
  const points = [];
  const cx = Math.round((x0 + x1) / 2);
  const cy = Math.round((y0 + y1) / 2);
  const rx = Math.abs(Math.round((x1 - x0) / 2));
  const ry = Math.abs(Math.round((y1 - y0) / 2));
  if (rx === 0 && ry === 0) { points.push({ x: cx, y: cy }); return points; }
  if (rx === 0) {
    for (let y = cy - ry; y <= cy + ry; y++) points.push({ x: cx, y });
    return points;
  }
  if (ry === 0) {
    for (let x = cx - rx; x <= cx + rx; x++) points.push({ x, y: cy });
    return points;
  }

  // Collect edge pixels per scanline
  const edgeMap = {};
  const addEdge = (ex, ey) => {
    if (!edgeMap[ey]) edgeMap[ey] = { min: ex, max: ex };
    else { edgeMap[ey].min = Math.min(edgeMap[ey].min, ex); edgeMap[ey].max = Math.max(edgeMap[ey].max, ex); }
  };

  // Use parametric sampling to avoid gaps
  // Sample enough points to cover every pixel
  const steps = Math.max(rx, ry) * 8;
  for (let i = 0; i <= steps; i++) {
    const angle = (2 * Math.PI * i) / steps;
    const ex = Math.round(cx + rx * Math.cos(angle));
    const ey = Math.round(cy + ry * Math.sin(angle));
    addEdge(ex, ey);
  }

  // Also ensure top/bottom/left/right extremes are included
  addEdge(cx, cy - ry); addEdge(cx, cy + ry);
  addEdge(cx - rx, cy); addEdge(cx + rx, cy);

  // Fill gaps between adjacent scanlines by connecting with bresenham-like fill
  const sortedYs = Object.keys(edgeMap).map(Number).sort((a, b) => a - b);
  for (let i = 0; i < sortedYs.length - 1; i++) {
    const y1e = sortedYs[i];
    const y2e = sortedYs[i + 1];
    if (y2e - y1e > 1) {
      // Fill missing scanlines by interpolation
      const e1 = edgeMap[y1e];
      const e2 = edgeMap[y2e];
      for (let yy = y1e + 1; yy < y2e; yy++) {
        const t = (yy - y1e) / (y2e - y1e);
        const minX = Math.round(e1.min + (e2.min - e1.min) * t);
        const maxX = Math.round(e1.max + (e2.max - e1.max) * t);
        addEdge(minX, yy);
        addEdge(maxX, yy);
      }
    }
  }

  for (const [yStr, edge] of Object.entries(edgeMap)) {
    const yi = parseInt(yStr);
    if (filled) {
      for (let xi = edge.min; xi <= edge.max; xi++) points.push({ x: xi, y: yi });
    } else {
      points.push({ x: edge.min, y: yi });
      if (edge.min !== edge.max) points.push({ x: edge.max, y: yi });
    }
  }
  return points;
}

/**
 * Generate triangle points (isosceles, pointing up).
 */
export function trianglePoints(x0, y0, x1, y1, filled = false) {
  const points = [];
  const minX = Math.min(x0, x1), maxX = Math.max(x0, x1);
  const minY = Math.min(y0, y1), maxY = Math.max(y0, y1);
  const w = maxX - minX;
  const h = maxY - minY;
  if (w === 0 || h === 0) {
    // Degenerate - just a line
    for (const p of bresenhamLine(x0, y0, x1, y1)) points.push(p);
    return points;
  }

  // Top center, bottom-left, bottom-right
  const topX = Math.round(minX + w / 2);
  const topY = minY;
  const blX = minX, blY = maxY;
  const brX = maxX, brY = maxY;

  if (filled) {
    // Fill scanlines
    for (let y = topY; y <= blY; y++) {
      const t = h === 0 ? 1 : (y - topY) / h;
      const leftX = Math.round(topX + (blX - topX) * t);
      const rightX = Math.round(topX + (brX - topX) * t);
      for (let x = Math.min(leftX, rightX); x <= Math.max(leftX, rightX); x++) {
        points.push({ x, y });
      }
    }
  } else {
    // Three edges
    for (const p of bresenhamLine(topX, topY, blX, blY)) points.push(p);
    for (const p of bresenhamLine(topX, topY, brX, brY)) points.push(p);
    for (const p of bresenhamLine(blX, blY, brX, brY)) points.push(p);
  }
  return points;
}

/**
 * Generate diamond (rhombus) points.
 */
export function diamondPoints(x0, y0, x1, y1, filled = false) {
  const points = [];
  const cx = Math.round((x0 + x1) / 2);
  const cy = Math.round((y0 + y1) / 2);
  const minX = Math.min(x0, x1), maxX = Math.max(x0, x1);
  const minY = Math.min(y0, y1), maxY = Math.max(y0, y1);

  // Four corners: top, right, bottom, left
  const top = { x: cx, y: minY };
  const right = { x: maxX, y: cy };
  const bottom = { x: cx, y: maxY };
  const left = { x: minX, y: cy };

  if (filled) {
    // Fill by scanlines
    const halfH = cy - minY;
    const halfW = cx - minX;
    for (let y = minY; y <= maxY; y++) {
      let t;
      if (y <= cy) {
        t = halfH === 0 ? 1 : (y - minY) / halfH;
      } else {
        t = halfH === 0 ? 1 : (maxY - y) / halfH;
      }
      const hw = Math.round(halfW * t);
      for (let x = cx - hw; x <= cx + hw; x++) {
        points.push({ x, y });
      }
    }
  } else {
    for (const p of bresenhamLine(top.x, top.y, right.x, right.y)) points.push(p);
    for (const p of bresenhamLine(right.x, right.y, bottom.x, bottom.y)) points.push(p);
    for (const p of bresenhamLine(bottom.x, bottom.y, left.x, left.y)) points.push(p);
    for (const p of bresenhamLine(left.x, left.y, top.x, top.y)) points.push(p);
  }
  return points;
}

/**
 * Replace ALL pixels of targetColor on active layer with newColor.
 */
export function colorReplace(pixelCanvas, targetColor, newColor) {
  if (targetColor === newColor) return;
  const layer = pixelCanvas.activeLayer;
  for (let y = 0; y < pixelCanvas.gridHeight; y++) {
    for (let x = 0; x < pixelCanvas.gridWidth; x++) {
      if (layer.pixels[y][x] === targetColor) {
        layer.pixels[y][x] = newColor;
      }
    }
  }
}

// ============================================================
// Tool definitions
// ============================================================
export const Tools = {

  pencil: {
    name: 'pencil',
    onStart(app, gx, gy) {
      app.paintBrush(gx, gy, app.currentColor);
      app.pixelCanvas.render();
    },
    onMove(app, gx, gy, lastX, lastY) {
      for (const p of bresenhamLine(lastX, lastY, gx, gy)) {
        app.paintBrush(p.x, p.y, app.currentColor);
      }
      app.pixelCanvas.render();
    },
    onEnd() {}
  },

  eraser: {
    name: 'eraser',
    onStart(app, gx, gy) {
      app.paintBrush(gx, gy, null);
      app.pixelCanvas.render();
    },
    onMove(app, gx, gy, lastX, lastY) {
      for (const p of bresenhamLine(lastX, lastY, gx, gy)) {
        app.paintBrush(p.x, p.y, null);
      }
      app.pixelCanvas.render();
    },
    onEnd() {}
  },

  fill: {
    name: 'fill',
    onStart(app, gx, gy) {
      if (!app.pixelCanvas.isInBounds(gx, gy)) return;
      if (app.fillReplace) {
        // Color replace mode: replace ALL pixels of clicked color
        const target = app.pixelCanvas.getPixel(gx, gy);
        if (target === null) return; // don't replace transparent
        colorReplace(app.pixelCanvas, target, app.currentColor);
      } else {
        floodFill(app.pixelCanvas, gx, gy, app.currentColor);
      }
      app.pixelCanvas.render();
    },
    onMove() {},
    onEnd() {}
  },

  eyedropper: {
    name: 'eyedropper',
    onStart(app, gx, gy) {
      if (!app.pixelCanvas.isInBounds(gx, gy)) return;
      const color = app.pixelCanvas.getCompositePixel(gx, gy);
      if (color) app.setColor(color);
    },
    onMove(app, gx, gy) {
      if (!app.pixelCanvas.isInBounds(gx, gy)) return;
      const color = app.pixelCanvas.getCompositePixel(gx, gy);
      if (color) app.previewColor(color);
    },
    onEnd(app) {
      app.switchToPreviousTool();
    }
  },

  // ----------------------------------------------------------
  // Selection + Move tool
  // ----------------------------------------------------------
  select: {
    name: 'select',

    onStart(app, gx, gy) {
      if (app.selection && app._isInsideSelection(gx, gy)) {
        app._selectionDragging = true;
        app._selectionDragStart = { x: gx, y: gy };
        return;
      }

      if (app.selection) {
        app._commitSelection();
      }

      app._selectStart = { x: gx, y: gy };
      app._selectEnd = { x: gx, y: gy };
      app._selectionDragging = false;
      app.selection = null;
      app._renderSelectionPreview();
    },

    onMove(app, gx, gy) {
      if (app._selectionDragging && app.selection) {
        const dx = gx - app._selectionDragStart.x;
        const dy = gy - app._selectionDragStart.y;
        app.selection.x += dx;
        app.selection.y += dy;
        app._selectionDragStart = { x: gx, y: gy };
        app.pixelCanvas.render();
        app._renderSelectionOverlay();
        return;
      }

      if (app._selectStart) {
        app._selectEnd = { x: gx, y: gy };
        app.pixelCanvas.render();
        app._renderSelectionPreview();
      }
    },

    onEnd(app) {
      if (app._selectionDragging) {
        app._selectionDragging = false;
        return;
      }

      if (app._selectStart && app._selectEnd) {
        const x0 = Math.min(app._selectStart.x, app._selectEnd.x);
        const y0 = Math.min(app._selectStart.y, app._selectEnd.y);
        const x1 = Math.max(app._selectStart.x, app._selectEnd.x);
        const y1 = Math.max(app._selectStart.y, app._selectEnd.y);
        const w = x1 - x0 + 1;
        const h = y1 - y0 + 1;

        if (w > 0 && h > 0) {
          const region = app.pixelCanvas.getRegion(x0, y0, w, h);
          app.pixelCanvas.clearRegion(x0, y0, w, h);
          app.selection = { ...region };
          app.pixelCanvas.render();
          app._renderSelectionOverlay();
        }
      }
      app._selectStart = null;
      app._selectEnd = null;
    }
  },

  // ----------------------------------------------------------
  // Magic Wand - select connected same-color region
  // Tap once = highlight selection (marching ants)
  // Tap again inside = fill with current color
  // Drag selection = move it
  // ----------------------------------------------------------
  wand: {
    name: 'wand',

    onStart(app, gx, gy) {
      // If we have a wand highlight (not cut yet), tapping inside fills it
      if (app._wandHighlight && app._isInsideWandHighlight(gx, gy)) {
        // Fill the highlighted area with current color
        magicWandFill(app.pixelCanvas, app._wandHighlight.matchedCoords, app.currentColor);
        app._wandHighlight = null;
        app.pixelCanvas.render();
        app._saveState();
        return;
      }

      // If clicking inside existing cut selection → drag it
      if (app.selection && app._isInsideSelection(gx, gy)) {
        app._selectionDragging = true;
        app._selectionDragStart = { x: gx, y: gy };
        return;
      }

      // Commit any existing selection first
      if (app.selection) {
        app._commitSelection();
      }

      // Clear old wand highlight
      app._wandHighlight = null;

      // Perform magic wand BFS - first just highlight, don't cut
      if (!app.pixelCanvas.isInBounds(gx, gy)) return;
      const region = magicWandSelect(app.pixelCanvas, gx, gy, false);
      if (region) {
        app._wandHighlight = region;
        app.pixelCanvas.render();
        app._renderWandHighlight();
      }
    },

    onMove(app, gx, gy) {
      // Only handle dragging existing cut selection
      if (app._selectionDragging && app.selection) {
        const dx = gx - app._selectionDragStart.x;
        const dy = gy - app._selectionDragStart.y;
        app.selection.x += dx;
        app.selection.y += dy;
        app._selectionDragStart = { x: gx, y: gy };
        app.pixelCanvas.render();
        app._renderSelectionOverlay();
      }
    },

    onEnd(app) {
      if (app._selectionDragging) {
        app._selectionDragging = false;
        return;
      }
    }
  },

  // ----------------------------------------------------------
  // Line tool - drag to draw straight lines with live preview
  // ----------------------------------------------------------
  line: {
    name: 'line',

    onStart(app, gx, gy) {
      app._shapeStart = { x: gx, y: gy };
    },

    onMove(app, gx, gy) {
      if (!app._shapeStart) return;
      app._shapeEnd = { x: gx, y: gy };
      const pts = bresenhamLine(app._shapeStart.x, app._shapeStart.y, gx, gy);
      app.pixelCanvas.render();
      app.pixelCanvas.renderPreview(pts, app.currentColor);
    },

    onEnd(app) {
      if (!app._shapeStart) return;
      const end = app._shapeEnd || app._shapeStart;
      const pts = bresenhamLine(app._shapeStart.x, app._shapeStart.y, end.x, end.y);
      for (const p of pts) {
        app.paintBrush(p.x, p.y, app.currentColor);
      }
      app._shapeStart = null;
      app._shapeEnd = null;
      app.pixelCanvas.render();
    }
  },

  // ----------------------------------------------------------
  // Shape tool - supports rect, ellipse, triangle, diamond
  // ----------------------------------------------------------
  shape: {
    name: 'shape',

    _getShapePoints(app, sx, sy, ex, ey) {
      const mode = app.shapeMode || 'rect';
      const filled = app.shapeFilled || false;
      switch (mode) {
        case 'rect': return rectPoints(sx, sy, ex, ey, filled);
        case 'ellipse': return ellipsePoints(sx, sy, ex, ey, filled);
        case 'triangle': return trianglePoints(sx, sy, ex, ey, filled);
        case 'diamond': return diamondPoints(sx, sy, ex, ey, filled);
        default: return rectPoints(sx, sy, ex, ey, filled);
      }
    },

    onStart(app, gx, gy) {
      app._shapeStart = { x: gx, y: gy };
    },

    onMove(app, gx, gy) {
      if (!app._shapeStart) return;
      app._shapeEnd = { x: gx, y: gy };
      const pts = this._getShapePoints(app, app._shapeStart.x, app._shapeStart.y, gx, gy);
      app.pixelCanvas.render();
      app.pixelCanvas.renderPreview(pts, app.currentColor);
    },

    onEnd(app) {
      if (!app._shapeStart) return;
      const end = app._shapeEnd || app._shapeStart;
      const pts = this._getShapePoints(app, app._shapeStart.x, app._shapeStart.y, end.x, end.y);
      for (const p of pts) {
        app.paintBrush(p.x, p.y, app.currentColor);
      }
      app._shapeStart = null;
      app._shapeEnd = null;
      app.pixelCanvas.render();
    }
  },
};
