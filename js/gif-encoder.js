/**
 * Minimal GIF89a encoder for PixelPaint animation export.
 * Pure JS, no dependencies. Supports animated GIFs with configurable delay.
 *
 * Usage:
 *   const encoder = new GIFEncoder(width, height);
 *   encoder.setDelay(100); // ms per frame
 *   encoder.setRepeat(0);  // 0 = loop forever
 *   encoder.start();
 *   for (const canvas of frameCanvases) {
 *     encoder.addFrame(canvas.getContext('2d'));
 *   }
 *   encoder.finish();
 *   const blob = encoder.toBlob();
 */

export class GIFEncoder {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.delay = 100;     // ms per frame
    this.repeat = 0;      // 0 = infinite loop, -1 = no repeat
    this.colorDepth = 8;  // bits per pixel (256 colors)
    this.palSize = 7;     // 2^(palSize+1) = 256
    this.dispose = 0;     // disposal method
    this.transparent = -1;
    this.out = [];
    this.started = false;
    this.firstFrame = true;
  }

  setDelay(ms) { this.delay = Math.max(10, ms); }
  setRepeat(n) { this.repeat = n; }
  setDispose(d) { this.dispose = d; }
  setTransparent(color) { this.transparent = color; }

  start() {
    this.out = [];
    this.started = true;
    this.firstFrame = true;
    // GIF Header
    this._writeUTF('GIF89a');
  }

  addFrame(ctx) {
    if (!this.started) this.start();

    const imageData = ctx.getImageData(0, 0, this.width, this.height);
    const pixels = imageData.data;

    // Quantize to 256 colors using median-cut-like approach
    const { palette, indexed } = this._quantize(pixels);

    if (this.firstFrame) {
      // Logical Screen Descriptor
      this._writeLSD(palette);
      // Netscape Extension for looping
      if (this.repeat >= 0) {
        this._writeNetscapeExt();
      }
    }

    // Graphic Control Extension
    this._writeGraphicCtrlExt(palette);

    // Image Descriptor
    this._writeImageDesc();

    // Local Color Table
    this._writePalette(palette);

    // Pixel data (LZW)
    this._writeLZW(indexed);

    this.firstFrame = false;
  }

  finish() {
    if (!this.started) return;
    this.out.push(0x3B); // GIF Trailer
    this.started = false;
  }

  toBlob() {
    return new Blob([new Uint8Array(this.out)], { type: 'image/gif' });
  }

  toDataURL() {
    const blob = this.toBlob();
    return URL.createObjectURL(blob);
  }

  // --- Internal methods ---

  _writeUTF(str) {
    for (let i = 0; i < str.length; i++) {
      this.out.push(str.charCodeAt(i));
    }
  }

  _writeByte(b) { this.out.push(b & 0xFF); }

  _writeShort(v) {
    this.out.push(v & 0xFF);
    this.out.push((v >> 8) & 0xFF);
  }

  _writeLSD(palette) {
    this._writeShort(this.width);
    this._writeShort(this.height);
    // GCT flag=0 (using local color tables), color resolution, sort, size
    this._writeByte(0x00); // No GCT
    this._writeByte(0);    // Background color index
    this._writeByte(0);    // Pixel aspect ratio
  }

  _writeNetscapeExt() {
    this._writeByte(0x21); // Extension
    this._writeByte(0xFF); // App extension
    this._writeByte(11);   // Block size
    this._writeUTF('NETSCAPE2.0');
    this._writeByte(3);    // Sub-block size
    this._writeByte(1);    // Loop indicator
    this._writeShort(this.repeat); // Loop count
    this._writeByte(0);    // Block terminator
  }

  _writeGraphicCtrlExt(palette) {
    this._writeByte(0x21); // Extension
    this._writeByte(0xF9); // GCE
    this._writeByte(4);    // Block size

    let transp = 0;
    let transpIndex = 0;
    if (this.transparent >= 0) {
      transp = 1;
      transpIndex = this._findClosest(palette, this.transparent);
    }

    const dispose = (this.dispose & 7) << 2;
    this._writeByte(dispose | transp);
    this._writeShort(Math.round(this.delay / 10)); // Delay in 1/100s
    this._writeByte(transpIndex);
    this._writeByte(0); // Block terminator
  }

  _writeImageDesc() {
    this._writeByte(0x2C); // Image separator
    this._writeShort(0);   // Left
    this._writeShort(0);   // Top
    this._writeShort(this.width);
    this._writeShort(this.height);
    // Local color table, not interlaced, not sorted, size = 2^(7+1) = 256
    this._writeByte(0x80 | this.palSize);
  }

  _writePalette(palette) {
    for (let i = 0; i < 256; i++) {
      if (i < palette.length) {
        this._writeByte(palette[i][0]);
        this._writeByte(palette[i][1]);
        this._writeByte(palette[i][2]);
      } else {
        this._writeByte(0);
        this._writeByte(0);
        this._writeByte(0);
      }
    }
  }

  /**
   * Quantize RGBA pixels to 256-color palette + indexed array.
   * Uses a simple popularity-based approach (good enough for pixel art).
   */
  _quantize(pixels) {
    const colorCount = {};
    const n = pixels.length / 4;

    // Count unique colors
    for (let i = 0; i < n; i++) {
      const r = pixels[i * 4];
      const g = pixels[i * 4 + 1];
      const b = pixels[i * 4 + 2];
      const a = pixels[i * 4 + 3];
      // Treat nearly-transparent as transparent
      if (a < 128) continue;
      const key = (r << 16) | (g << 8) | b;
      colorCount[key] = (colorCount[key] || 0) + 1;
    }

    // Sort by popularity, take top 255 (reserve index 0 for transparent)
    const sorted = Object.entries(colorCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 255);

    // Build palette: index 0 = transparent (black)
    const palette = [[0, 0, 0]]; // Index 0 = transparent placeholder
    const colorToIndex = {};

    for (const [keyStr] of sorted) {
      const key = parseInt(keyStr);
      const r = (key >> 16) & 0xFF;
      const g = (key >> 8) & 0xFF;
      const b = key & 0xFF;
      colorToIndex[key] = palette.length;
      palette.push([r, g, b]);
    }

    // Build indexed pixels
    const indexed = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const r = pixels[i * 4];
      const g = pixels[i * 4 + 1];
      const b = pixels[i * 4 + 2];
      const a = pixels[i * 4 + 3];
      if (a < 128) {
        indexed[i] = 0; // transparent
      } else {
        const key = (r << 16) | (g << 8) | b;
        indexed[i] = colorToIndex[key] !== undefined ? colorToIndex[key] : this._findClosestIdx(palette, r, g, b);
      }
    }

    // If we used transparency, set it up
    if (this.transparent < 0) {
      // Auto-detect: if any pixel is transparent, use index 0
      let hasTransp = false;
      for (let i = 0; i < n; i++) {
        if (pixels[i * 4 + 3] < 128) { hasTransp = true; break; }
      }
      if (hasTransp) {
        this.transparent = 0;
      }
    }

    return { palette, indexed };
  }

  _findClosest(palette, color) {
    const r = (color >> 16) & 0xFF;
    const g = (color >> 8) & 0xFF;
    const b = color & 0xFF;
    return this._findClosestIdx(palette, r, g, b);
  }

  _findClosestIdx(palette, r, g, b) {
    let minDist = Infinity;
    let idx = 0;
    for (let i = 0; i < palette.length; i++) {
      const dr = palette[i][0] - r;
      const dg = palette[i][1] - g;
      const db = palette[i][2] - b;
      const dist = dr * dr + dg * dg + db * db;
      if (dist < minDist) { minDist = dist; idx = i; }
    }
    return idx;
  }

  /**
   * LZW encoder for GIF
   */
  _writeLZW(indexed) {
    const minCodeSize = this.colorDepth;
    this._writeByte(minCodeSize);

    const clearCode = 1 << minCodeSize;
    const eoiCode = clearCode + 1;

    let codeSize = minCodeSize + 1;
    let nextCode = eoiCode + 1;
    const maxCode = 4096;

    // Sub-block buffer
    let subBlock = [];
    let bitBuf = 0;
    let bitCount = 0;

    const flushBits = () => {
      while (bitCount >= 8) {
        subBlock.push(bitBuf & 0xFF);
        bitBuf >>= 8;
        bitCount -= 8;
        if (subBlock.length === 255) {
          this._writeByte(255);
          for (const b of subBlock) this._writeByte(b);
          subBlock = [];
        }
      }
    };

    const writeBits = (code, size) => {
      bitBuf |= (code << bitCount);
      bitCount += size;
      flushBits();
    };

    // Initialize code table
    let codeTable = {};
    const resetTable = () => {
      codeTable = {};
      for (let i = 0; i < clearCode; i++) {
        codeTable[String(i)] = i;
      }
      codeSize = minCodeSize + 1;
      nextCode = eoiCode + 1;
    };

    // Start with clear code
    resetTable();
    writeBits(clearCode, codeSize);

    let prefix = String(indexed[0]);

    for (let i = 1; i < indexed.length; i++) {
      const k = String(indexed[i]);
      const combined = prefix + ',' + k;

      if (codeTable[combined] !== undefined) {
        prefix = combined;
      } else {
        // Output the code for prefix
        writeBits(codeTable[prefix], codeSize);

        // Add new entry
        if (nextCode < maxCode) {
          codeTable[combined] = nextCode++;
          if (nextCode > (1 << codeSize) && codeSize < 12) {
            codeSize++;
          }
        } else {
          // Table full, reset
          writeBits(clearCode, codeSize);
          resetTable();
        }

        prefix = k;
      }
    }

    // Output remaining
    writeBits(codeTable[prefix], codeSize);
    writeBits(eoiCode, codeSize);

    // Flush remaining bits
    if (bitCount > 0) {
      subBlock.push(bitBuf & 0xFF);
    }

    // Write final sub-block
    if (subBlock.length > 0) {
      this._writeByte(subBlock.length);
      for (const b of subBlock) this._writeByte(b);
    }

    this._writeByte(0); // Block terminator
  }
}
