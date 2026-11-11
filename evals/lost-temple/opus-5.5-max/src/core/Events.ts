/** Tiny typed event bus. */
export class Emitter<M extends Record<string, unknown>> {
  private handlers: { [K in keyof M]?: ((p: M[K]) => void)[] } = {};

  on<K extends keyof M>(type: K, fn: (p: M[K]) => void): () => void {
    (this.handlers[type] ??= []).push(fn);
    return () => this.off(type, fn);
  }

  off<K extends keyof M>(type: K, fn: (p: M[K]) => void) {
    const arr = this.handlers[type];
    if (!arr) return;
    const i = arr.indexOf(fn);
    if (i >= 0) arr.splice(i, 1);
  }

  emit<K extends keyof M>(type: K, payload: M[K]) {
    const arr = this.handlers[type];
    if (!arr) return;
    for (const fn of [...arr]) fn(payload);
  }

  clear() {
    this.handlers = {};
  }
}
