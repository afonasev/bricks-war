/** Consume browser actions without changing game input or native text editing. */
export function installBrowserInteractions(doc: Document = document): void {
  const editable = (target: EventTarget | null): boolean =>
    target instanceof Element && Boolean(target.closest('input, textarea, [contenteditable="true"]'));
  const prevent = (event: Event): void => { event.preventDefault(); };
  const outsideEditor = (event: Event): void => { if (!editable(event.target)) prevent(event); };
  for (const name of ['contextmenu', 'dragstart', 'dragover', 'drop', 'auxclick']) {
    doc.addEventListener(name, prevent, { capture: true });
  }
  for (const name of ['selectstart', 'copy', 'cut', 'paste', 'dblclick']) {
    doc.addEventListener(name, outsideEditor, { capture: true });
  }
  doc.addEventListener('keydown', (event) => {
    const key = event.key.toLowerCase();
    const shortcutKey = event.code.startsWith('Key') ? event.code.slice(3).toLowerCase() : key;
    const command = event.ctrlKey || event.metaKey;
    const zoom = command && (['+', '=', '-', '_', '0'].includes(key) || ['Equal', 'Minus', 'Digit0', 'NumpadAdd', 'NumpadSubtract', 'Numpad0'].includes(event.code));
    const browserCommand = command && (['r', 'p', 's', 'f', 'g', 'o', 'l', 'u', 'd'].includes(shortcutKey)
      || ((event.shiftKey || event.altKey) && ['i', 'j', 'c'].includes(shortcutKey)));
    const documentEditing = command && ['a', 'c', 'x', 'v'].includes(shortcutKey) && !editable(event.target);
    const browserKey = ['f5', 'f6', 'f7', 'f11', 'f12', 'browserback', 'browserforward'].includes(key)
      || (event.altKey && ['arrowleft', 'arrowright', 'home'].includes(key))
      || (key === 'backspace' && !editable(event.target));
    if (zoom || browserCommand || documentEditing || browserKey) {
      prevent(event);
      event.stopPropagation();
    }
  }, { capture: true });
  doc.addEventListener('wheel', (event) => {
    if (event.ctrlKey || event.metaKey) prevent(event);
  }, { capture: true, passive: false });
  for (const name of ['touchstart', 'touchmove'] as const) {
    doc.addEventListener(name, (event) => {
      if (event.touches.length > 1) prevent(event);
    }, { capture: true, passive: false });
  }
  for (const name of ['gesturestart', 'gesturechange', 'gestureend']) {
    doc.addEventListener(name, prevent, { capture: true, passive: false });
  }
}
