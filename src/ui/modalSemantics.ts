/** Suspend an underlying dialog while a sibling modal owns focus. Restore its exact semantics on close. */
export function suspendOtherDialogs(root: HTMLElement, active: HTMLElement): () => void {
  const dialogs = Array.from(root.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]'))
    .filter(dialog => dialog !== active && !active.contains(dialog));
  const saved = dialogs.map(dialog => ({ dialog, hidden: dialog.getAttribute('aria-hidden'), inert: dialog.inert }));
  for (const { dialog } of saved) { dialog.removeAttribute('aria-modal'); dialog.setAttribute('aria-hidden', 'true'); dialog.inert = true; }
  return () => { for (const { dialog, hidden, inert } of saved) {
    dialog.setAttribute('aria-modal', 'true');
    if (hidden === null) dialog.removeAttribute('aria-hidden'); else dialog.setAttribute('aria-hidden', hidden);
    dialog.inert = inert;
  } };
}
