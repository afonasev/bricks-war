export type MenuSelectCommand = 'open' | 'previous' | 'next' | 'commit' | 'cancel' | null;

export const MENU_SELECT_COMMAND_EVENT = 'menu-select-command';

let menuSelectId = 0;

export function menuSelectCommandForKey(key: string, expanded: boolean): MenuSelectCommand {
  if (!expanded && (key === 'Enter' || key === ' ')) return 'open';
  if (!expanded) return null;
  if (key === 'ArrowUp' || key === 'ArrowLeft' || key.toLowerCase() === 'w' || key.toLowerCase() === 'a') return 'previous';
  if (key === 'ArrowDown' || key === 'ArrowRight' || key.toLowerCase() === 's' || key.toLowerCase() === 'd') return 'next';
  if (key === 'Enter' || key === ' ') return 'commit';
  if (key === 'Escape' || key === 'Backspace') return 'cancel';
  return null;
}

export function nextEnabledOptionIndex(disabled: readonly boolean[], current: number, direction: -1 | 1): number {
  if (disabled.length === 0 || disabled.every(Boolean)) return -1;
  let index = Math.min(disabled.length - 1, Math.max(0, current));
  for (let checked = 0; checked < disabled.length; checked += 1) {
    index = (index + direction + disabled.length) % disabled.length;
    if (!disabled[index]) return index;
  }
  return current;
}

export function isExpandedMenuSelectTrigger(element: HTMLElement | null): boolean {
  return element?.matches('[data-menu-select-trigger][aria-expanded="true"]') ?? false;
}

export function sendMenuSelectCommand(trigger: HTMLElement, command: Exclude<MenuSelectCommand, null>): void {
  trigger.dispatchEvent(new CustomEvent(MENU_SELECT_COMMAND_EVENT, { detail: { command } }));
}

function selectLabel(select: HTMLSelectElement): string {
  const explicit = select.getAttribute('aria-label')?.trim();
  if (explicit) return explicit;
  const label = select.closest('label');
  const caption = label?.querySelector(':scope > span, :scope > small')?.textContent?.trim();
  return caption || 'Выбор';
}

export function enhanceMenuSelects(root: HTMLElement): void {
  root.querySelectorAll<HTMLSelectElement>('select:not([data-menu-select-enhanced])').forEach((select) => {
    select.dataset.menuSelectEnhanced = 'true';
    select.hidden = true;
    select.tabIndex = -1;
    select.setAttribute('aria-hidden', 'true');
    select.removeAttribute('data-ui-focus');

    const id = `menu-select-${menuSelectId += 1}`;
    const label = selectLabel(select);
    const wrapper = document.createElement('span');
    wrapper.className = 'menu-select';
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.disabled = select.disabled;
    trigger.className = 'menu-select-trigger';
    trigger.dataset.menuSelectTrigger = '';
    trigger.setAttribute('data-ui-focus', '');
    trigger.setAttribute('role', 'combobox');
    trigger.setAttribute('aria-label', label);
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-controls', `${id}-options`);
    const value = document.createElement('span');
    value.className = 'menu-select-value';
    const chevron = document.createElement('span');
    chevron.className = 'menu-select-chevron';
    chevron.setAttribute('aria-hidden', 'true');
    chevron.textContent = '⌄';
    trigger.append(value, chevron);

    const listbox = document.createElement('span');
    listbox.className = 'menu-select-options';
    listbox.id = `${id}-options`;
    listbox.setAttribute('role', 'listbox');
    listbox.setAttribute('aria-label', label);
    listbox.hidden = true;
    const options = Array.from(select.options).map((option, index) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'menu-select-option';
      item.id = `${id}-option-${index}`;
      item.dataset.menuSelectOption = String(index);
      item.setAttribute('role', 'option');
      item.tabIndex = -1;
      item.disabled = option.disabled;
      const name = option.textContent ?? option.label;
      const description = option.dataset.menuSelectDescription?.trim();
      const copy = document.createElement('span');
      copy.className = 'menu-select-option-copy';
      const title = document.createElement('strong');
      title.textContent = name;
      copy.append(title);
      if (description) {
        const hint = document.createElement('small');
        hint.textContent = description;
        copy.append(hint);
        item.setAttribute('aria-label', `${name}. ${description}`);
      }
      item.append(copy);
      listbox.append(item);
      return item;
    });
    wrapper.append(trigger, listbox);
    select.insertAdjacentElement('afterend', wrapper);

    let highlighted = select.selectedIndex;
    let suppressKeyboardClick = false;
    const desktop = (): boolean => root.dataset.layout === 'desktop';
    const pageSize = (): number => 6;
    const pager = document.createElement('span');
    pager.className = 'menu-select-pages';
    const previousPage = document.createElement('button');
    const nextPage = document.createElement('button');
    const pageLabel = document.createElement('output');
    previousPage.type = nextPage.type = 'button';
    previousPage.textContent = '← Предыдущие';
    nextPage.textContent = 'Следующие →';
    pager.append(previousPage, pageLabel, nextPage);
    listbox.append(pager);
    const disabled = Array.from(select.options, (option) => option.disabled);

    const render = (): void => {
      const selected = select.options[select.selectedIndex];
      value.textContent = selected?.textContent ?? selected?.label ?? '';
      const size = pageSize();
      const page = Math.floor(Math.max(0, highlighted) / size);
      const pages = Math.ceil(options.length / size);
      const rows = Math.ceil(Math.min(size, options.length) / 2);
      if (desktop()) {
        listbox.style.gridTemplateRows = `repeat(${rows}, 80px)${pages > 1 ? ' 32px' : ''}`;
        pager.style.gridRow = String(rows + 1);
      } else { listbox.style.removeProperty('grid-template-rows'); pager.style.removeProperty('grid-row'); }
      pager.hidden = !desktop() || pages <= 1;
      previousPage.disabled = page === 0;
      nextPage.disabled = page >= pages - 1;
      pageLabel.textContent = `${page + 1} / ${pages}`;
      options.forEach((item, index) => {
        item.hidden = desktop() && Math.floor(index / size) !== page;
        item.classList.toggle('is-highlighted', !listbox.hidden && index === highlighted);
        item.classList.toggle('is-current', index === select.selectedIndex);
        item.setAttribute('aria-selected', String(index === select.selectedIndex));
      });
      if (listbox.hidden) trigger.removeAttribute('aria-activedescendant');
      else trigger.setAttribute('aria-activedescendant', options[highlighted]?.id ?? '');
    };
    const close = (): void => {
      listbox.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
      wrapper.classList.remove('is-open');
      wrapper.classList.remove('opens-upward');
      listbox.style.removeProperty('--menu-select-available-height');
      highlighted = select.selectedIndex;
      render();
    };
    const positionListbox = (): void => {
      if (desktop()) {
        wrapper.classList.remove('opens-upward');
        listbox.style.removeProperty('--menu-select-available-height');
        return;
      }
      const rootBounds = root.getBoundingClientRect();
      const triggerBounds = trigger.getBoundingClientRect();
      const gap = 8;
      const spaceAbove = Math.max(0, triggerBounds.top - rootBounds.top - gap);
      const spaceBelow = Math.max(0, rootBounds.bottom - triggerBounds.bottom - gap);
      const opensUpward = spaceAbove > spaceBelow;
      wrapper.classList.toggle('opens-upward', opensUpward);
      listbox.style.setProperty('--menu-select-available-height', `${Math.floor(opensUpward ? spaceAbove : spaceBelow)}px`);
    };
    const open = (): void => {
      root.querySelectorAll<HTMLElement>('.menu-select.is-open [data-menu-select-trigger]').forEach((other) => {
        if (other !== trigger) sendMenuSelectCommand(other, 'cancel');
      });
      highlighted = select.selectedIndex;
      listbox.hidden = false;
      trigger.setAttribute('aria-expanded', 'true');
      wrapper.classList.add('is-open');
      positionListbox();
      render();
      if (!desktop()) options[highlighted]?.scrollIntoView({ block: 'nearest' });
    };
    const step = (direction: -1 | 1): void => {
      const next = nextEnabledOptionIndex(disabled, highlighted, direction);
      if (next < 0) return;
      highlighted = next;
      render();
      if (!desktop()) options[highlighted]?.scrollIntoView({ block: 'nearest' });
    };
    const commit = (index = highlighted): void => {
      if (disabled[index] || index < 0) return;
      const changed = select.selectedIndex !== index;
      select.selectedIndex = index;
      close();
      if (changed) select.dispatchEvent(new Event('change', { bubbles: true }));
      trigger.focus({ preventScroll: true });
    };
    const command = (next: Exclude<MenuSelectCommand, null>): void => {
      if (next === 'open') open();
      else if (next === 'previous') step(-1);
      else if (next === 'next') step(1);
      else if (next === 'commit') commit();
      else close();
    };

    trigger.addEventListener('click', (event) => {
      if (suppressKeyboardClick) {
        suppressKeyboardClick = false;
        return;
      }
      if (event.detail === 0) return;
      command(listbox.hidden ? 'open' : 'cancel');
    });
    trigger.addEventListener('keydown', (event) => {
      const next = menuSelectCommandForKey(event.key, !listbox.hidden);
      if (!next) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Enter' || event.key === ' ') {
        suppressKeyboardClick = true;
        window.setTimeout(() => { suppressKeyboardClick = false; }, 160);
      }
      command(next);
    });
    trigger.addEventListener(MENU_SELECT_COMMAND_EVENT, (event) => {
      command((event as CustomEvent<{ command: Exclude<MenuSelectCommand, null> }>).detail.command);
    });
    options.forEach((item, index) => {
      item.addEventListener('click', () => commit(index));
    });
    const changePage = (direction: -1 | 1): void => {
      const first = (Math.floor(highlighted / pageSize()) + direction) * pageSize();
      const end = Math.min(options.length, first + pageSize());
      for (let index = Math.max(0, first); index < end; index += 1) {
        if (!disabled[index]) { highlighted = index; render(); return; }
      }
    };
    previousPage.addEventListener('click', () => changePage(-1));
    nextPage.addEventListener('click', () => changePage(1));
    const onResize = (): void => {
      if (!select.isConnected) { window.removeEventListener('resize', onResize); return; }
      if (!listbox.hidden) { positionListbox(); render(); }
    };
    window.addEventListener('resize', onResize);
    select.addEventListener('change', render);
    document.addEventListener('pointerdown', (event) => {
      if (!wrapper.contains(event.target as Node)) close();
    });
    document.addEventListener('focusin', (event) => {
      if (!wrapper.contains(event.target as Node)) close();
    });
    render();
  });
}
