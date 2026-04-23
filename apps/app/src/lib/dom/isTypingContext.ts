const isEditable = (el: Element | null): boolean => {
  if (!el || !(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    el.isContentEditable === true
  );
};

/** True when a keydown event originates in (or targets) an editable context —
 *  an input, textarea, select, or contenteditable element. Callers short-circuit
 *  global keyboard shortcuts so typing doesn't accidentally trigger them. */
export function isTypingContext(e: KeyboardEvent): boolean {
  if (isEditable(document.activeElement)) return true;
  const target = e.target instanceof Element ? e.target : null;
  if (isEditable(target)) return true;
  if (
    target?.closest(
      '.highlight-input, input, textarea, [contenteditable="true"]',
    )
  )
    return true;
  return false;
}
