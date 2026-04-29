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
