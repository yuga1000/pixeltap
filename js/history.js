/**
 * History - undo/redo system for pixel art editor.
 * Stores snapshots of the pixel grid state.
 */
export class History {
  constructor(maxSize = 50) {
    this.stack = [];
    this.index = -1;
    this.maxSize = maxSize;
    this.onChangeCallbacks = [];
  }

  /**
   * Push a new state snapshot onto the history stack.
   * Clears any redo states beyond current position.
   */
  push(snapshot) {
    // Remove any states ahead of current position (redo history)
    this.stack = this.stack.slice(0, this.index + 1);

    // Add new snapshot
    this.stack.push(snapshot);

    // Enforce max size - remove oldest entries
    if (this.stack.length > this.maxSize) {
      this.stack.shift();
    }

    this.index = this.stack.length - 1;
    this._notifyChange();
  }

  /**
   * Undo - go back one step
   * Returns the previous snapshot, or null if at the beginning
   */
  undo() {
    if (!this.canUndo()) return null;
    this.index--;
    this._notifyChange();
    return this.current();
  }

  /**
   * Redo - go forward one step
   * Returns the next snapshot, or null if at the end
   */
  redo() {
    if (!this.canRedo()) return null;
    this.index++;
    this._notifyChange();
    return this.current();
  }

  /**
   * Get the current snapshot
   */
  current() {
    if (this.index >= 0 && this.index < this.stack.length) {
      return this.stack[this.index];
    }
    return null;
  }

  /**
   * Can we undo?
   */
  canUndo() {
    return this.index > 0;
  }

  /**
   * Can we redo?
   */
  canRedo() {
    return this.index < this.stack.length - 1;
  }

  /**
   * Clear all history
   */
  clear() {
    this.stack = [];
    this.index = -1;
    this._notifyChange();
  }

  /**
   * Register a callback for when history state changes
   */
  onChange(callback) {
    this.onChangeCallbacks.push(callback);
  }

  _notifyChange() {
    for (const cb of this.onChangeCallbacks) {
      cb(this.canUndo(), this.canRedo());
    }
  }
}
