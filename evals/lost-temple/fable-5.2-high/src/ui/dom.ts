/** Tiny DOM helper: el('div', 'cls', parent, 'text'). */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', parent?: HTMLElement | null, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

export const fmtGold = (n: number): string => Math.round(n).toLocaleString('en-US');
