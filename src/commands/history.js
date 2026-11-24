// Undo / redo. Every change to the scene goes through history.execute(), so it can be undone.

/** @typedef {import('../types.js').Command} Command */
/** @typedef {{ kind: 'execute'|'undo'|'redo'|'clear', command: Command | null }} HistoryEvent */

/** Undo/redo stacks. Knows nothing about Three.js, so it can be unit-tested on its own. */
export class History {
  constructor(limit = 100) {
    this.limit = limit;
    /** @type {Command[]} oldest first */
    this.undoStack = [];
    /** @type {Command[]} top (last) is the next to redo */
    this.redoStack = [];
    /** @type {((e: HistoryEvent) => void)[]} */
    this.listeners = [];
  }

  /** True when there is something to undo. */
  get canUndo() {
    return this.undoStack.length > 0;
  }

  /** True when there is something to redo. */
  get canRedo() {
    return this.redoStack.length > 0;
  }

  /** Run a new command and remember it for undo. @param {Command} cmd */
  execute(cmd) {
    cmd.do();
    this.undoStack.push(cmd);
    if (this.undoStack.length > this.limit) this.undoStack.shift(); // too long: forget the oldest
    this.redoStack.length = 0; // a new action clears redo
    this.emit('execute', cmd);
  }

  /** Reverse the latest command and move it to the redo stack. */
  undo() {
    const cmd = this.undoStack.pop();
    if (!cmd) return;
    cmd.undo();
    this.redoStack.push(cmd);
    this.emit('undo', cmd);
  }

  /** Run the last undone command again. */
  redo() {
    const cmd = this.redoStack.pop();
    if (!cmd) return;
    cmd.do();
    this.undoStack.push(cmd);
    this.emit('redo', cmd);
  }

  /** Forget everything (used by New and Load). */
  clear() {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.emit('clear', null);
  }

  /** Subscribe to history changes; returns a function that unsubscribes. @param {(e: HistoryEvent) => void} fn */
  onChange(fn) {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  /** Tell every subscriber what just happened. */
  emit(kind, command) {
    for (const fn of this.listeners) fn({ kind, command });
  }
}

// the one history the whole app shares
export const history = new History(100);
