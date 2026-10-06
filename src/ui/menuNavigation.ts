import { ResultsInputGuard, RESULTS_INPUT_DELAY_MS } from './resultsInputGuard';
import type { AppScreen } from './screenRouter';
import { isExpandedMenuSelectTrigger, sendMenuSelectCommand } from './menuSelect';
import { isMobilePlayViewport } from './mobileSettings';

export type MenuAction = 'previous' | 'next' | 'decrease' | 'increase' | 'confirm' | 'start' | 'back' | null;

const STICK_THRESHOLD = 0.62;

function pressed(gamepad: Gamepad, index: number): boolean {
  return gamepad.buttons[index]?.pressed ?? false;
}

export function keyboardMenuAction(key: string): MenuAction {
  if (key === 'ArrowUp' || key === 'ArrowLeft' || key.toLowerCase() === 'w' || key.toLowerCase() === 'a') return 'previous';
  if (key === 'ArrowDown' || key === 'ArrowRight' || key.toLowerCase() === 's' || key.toLowerCase() === 'd') return 'next';
  if (key === 'Enter' || key === ' ') return 'confirm';
  if (key === 'Escape') return 'back';
  return null;
}

export function gamepadMenuAction(gamepad: Gamepad): MenuAction {
  if (pressed(gamepad, 0)) return 'confirm';
  if (pressed(gamepad, 1)) return 'back';
  if (pressed(gamepad, 2)) return 'start';
  const horizontal = gamepad.axes[0] ?? 0;
  const vertical = gamepad.axes[1] ?? 0;
  if (pressed(gamepad, 12) || (vertical <= -STICK_THRESHOLD && Math.abs(vertical) >= Math.abs(horizontal))) return 'previous';
  if (pressed(gamepad, 13) || (vertical >= STICK_THRESHOLD && Math.abs(vertical) >= Math.abs(horizontal))) return 'next';
  if (pressed(gamepad, 14) || horizontal <= -STICK_THRESHOLD) return 'decrease';
  if (pressed(gamepad, 15) || horizontal >= STICK_THRESHOLD) return 'increase';
  return null;
}

export class GamepadMenuLatch {
  private readonly held = new Map<number, MenuAction>();
  private latestIndex = -1;
  private readonly rosterHeld = new Map<number, string>();

  disconnect(index: number): void {
    this.held.delete(index);
    this.rosterHeld.delete(index);
  }

  read(
    gamepads: readonly (Gamepad | null)[],
    enabled: boolean,
    acceptsGamepad: (index: number) => boolean = () => true,
    onIgnoredAction?: (index: number, action: MenuAction) => void,
    onRoster?: (index: number) => void,
  ): MenuAction {
    const connected = new Set(gamepads.filter((pad) => pad?.connected).map((pad) => pad!.index));
    for (const index of this.held.keys()) if (!connected.has(index)) this.disconnect(index);
    for (const index of this.rosterHeld.keys()) if (!connected.has(index)) this.disconnect(index);
    let result: MenuAction = null;
    for (const gamepad of gamepads) {
      if (!gamepad?.connected) continue;
      const description = JSON.stringify([gamepad.id, gamepad.mapping, gamepad.buttons.length, gamepad.axes.length]);
      const rosterDown = pressed(gamepad, 3);
      const rosterPrevious = this.rosterHeld.get(gamepad.index);
      if (rosterDown) this.rosterHeld.set(gamepad.index, description);
      else this.rosterHeld.delete(gamepad.index);
      if (enabled && rosterDown && rosterPrevious !== description) onRoster?.(gamepad.index);
      const action = gamepadMenuAction(gamepad);
      const previous = this.held.get(gamepad.index) ?? null;
      this.held.set(gamepad.index, action);
      if (!enabled) continue;
      if (!acceptsGamepad(gamepad.index)) {
        if (action && action !== previous) onIgnoredAction?.(gamepad.index, action);
        continue;
      }
      if (!result && action && action !== previous) {
        this.latestIndex = gamepad.index;
        result = action;
      }
    }
    return result;
  }

  lastGamepadIndex(): number {
    return this.latestIndex;
  }
}

interface MenuFocusOptions {
  onBack: () => void;
  onInputMode?: (mode: 'pointer' | 'keyboard' | 'gamepad') => void;
  onSelectionChange?: (selected: HTMLElement | null) => void;
  onGamepadSelection?: (gamepadIndex: number, selected: HTMLElement | null) => void;
  onGamepadConfirm?: (gamepadIndex: number, selected: HTMLElement | null) => boolean;
  onIgnoredGamepadAction?: (gamepadIndex: number, action: MenuAction) => void;
  onGamepadStart?: () => void;
  onGamepadRoster?: (index: number) => void;
  onGamepadsSnapshot?: (pads: readonly (Gamepad | null)[]) => void;
  readGamepads?: () => readonly (Gamepad | null)[];
  acceptsGamepad?: (gamepadIndex: number) => boolean;
}

export class MenuFocusController {
  private readonly resultsGuard = new ResultsInputGuard();
  private resultsTimer: number | null = null;
  private screen: AppScreen | null = null;
  private index = -1;
  private selectedItem: HTMLElement | null = null;
  private frame = 0;
  private readonly latch = new GamepadMenuLatch();
  private readonly readGamepads: () => readonly (Gamepad | null)[];

  constructor(private readonly root: HTMLElement, private readonly options: MenuFocusOptions) {
    this.readGamepads = options.readGamepads ?? (() => Array.from(navigator.getGamepads?.() ?? []));
    root.ownerDocument.addEventListener('keydown', this.onDocumentKeyDown, true);
    root.ownerDocument.addEventListener('keyup', this.onDocumentKeyUp, true);
    root.addEventListener('keydown', this.onKeyDown);
    root.addEventListener('pointermove', this.onPointerMove);
    this.frame = window.requestAnimationFrame(this.pollGamepads);
  }

  activate(screen: AppScreen, preferredIndex = 0): void {
    if (screen !== 'results') this.clearResultsProtection();
    this.screen = screen;
    this.index = -1;
    this.selectedItem = null;
    this.select(preferredIndex, true);
  }

  protectResults(onReady: () => void): void {
    this.clearResultsProtection();
    this.resultsGuard.freshGamepads(this.readGamepads());
    this.resultsGuard.begin();
    this.resultsTimer = window.setTimeout(() => {
      this.resultsTimer = null;
      if (this.screen !== 'results') return;
      onReady();
      this.select(0, true);
    }, RESULTS_INPUT_DELAY_MS);
  }

  resultsInputReady(): boolean { return this.resultsGuard.ready(); }

  private clearResultsProtection(): void {
    if (this.resultsTimer !== null) window.clearTimeout(this.resultsTimer);
    this.resultsTimer = null;
    this.resultsGuard.end();
  }

  suspend(): void {
    this.clearResultsProtection();
    this.screen = null;
    this.selectedItem = null;
    this.clearSelection();
  }

  disconnectGamepad(index: number): void { this.latch.disconnect(index); }

  selectedIndex(): number {
    return this.index;
  }

  reconcileItems(): void {
    const items = this.items();
    if (items.length === 0) {
      this.index = -1;
      this.selectedItem = null;
      return;
    }

    const selected = this.root.querySelector<HTMLElement>('.is-ui-selected')
      ?? (this.root.ownerDocument.activeElement instanceof HTMLElement
        && this.root.ownerDocument.activeElement.matches('[data-ui-focus]')
        ? this.root.ownerDocument.activeElement
        : this.selectedItem);
    if (selected) {
      const selectedIndex = items.indexOf(selected);
      this.index = selectedIndex;
      if (selectedIndex < 0) this.selectedItem = null;
      return;
    }

    // Mobile navigation may have no focused or visually selected item.
    // Keep its current position valid; a removed desktop selection resets above.
    this.index = Math.min(items.length - 1, Math.max(-1, this.index));
  }

  destroy(): void {
    this.clearResultsProtection();
    this.root.ownerDocument.removeEventListener('keydown', this.onDocumentKeyDown, true);
    this.root.ownerDocument.removeEventListener('keyup', this.onDocumentKeyUp, true);
    window.cancelAnimationFrame(this.frame);
    this.root.removeEventListener('keydown', this.onKeyDown);
    this.root.removeEventListener('pointermove', this.onPointerMove);
  }

  private items(): HTMLElement[] {
    if (!this.screen) return [];
    const profileChoice = this.root.querySelector<HTMLElement>('[data-profile-choice]');
    const pauseSettings = this.screen === 'settings'
      ? this.root.querySelector<HTMLElement>('#pause-settings-panel:not([hidden])')
      : null;
    const scope = profileChoice ?? (this.screen === 'pause'
      ? this.root.querySelector<HTMLElement>('#pause-menu-panel')
      : this.screen === 'results'
        ? this.root.querySelector<HTMLElement>('.results-panel')
        : pauseSettings
          ?? this.root.querySelector<HTMLElement>(`[data-screen="${this.screen}"]`)
          ?? this.root.querySelector<HTMLElement>('.debug-lab-screen')
          ?? this.root) ?? this.root;
    return Array.from(scope.querySelectorAll<HTMLElement>('[data-ui-focus]:not([disabled])'))
      .filter((item) => !item.hidden && !item.closest('[hidden]') && item.getAttribute('aria-hidden') !== 'true');
  }

  private clearSelection(): void {
    this.root.querySelectorAll('.is-ui-selected').forEach((item) => item.classList.remove('is-ui-selected'));
  }

  private select(index: number, moveFocus = true): void {
    const items = this.items();
    this.clearSelection();
    if (items.length === 0) {
      this.index = -1;
      this.selectedItem = null;
      this.options.onSelectionChange?.(null);
      return;
    }
    this.index = (index + items.length) % items.length;
    const selected = items[this.index];
    this.selectedItem = selected ?? null;
    const mobileMenu = isMobilePlayViewport();
    if (!mobileMenu) selected?.classList.add('is-ui-selected');
    if (moveFocus && !mobileMenu) {
      selected?.focus({ preventScroll: true });
    }
    this.options.onSelectionChange?.(selected ?? null);
  }

  private perform(action: MenuAction, mode: 'keyboard' | 'gamepad'): void {
    if (!action || !this.screen || (this.screen === 'results' && !this.resultsGuard.ready())) return;
    this.options.onInputMode?.(mode);
    const selected = this.items()[this.index] ?? null;
    if (mode === 'gamepad' && action === 'start') {
      this.options.onGamepadStart?.();
      return;
    }
    if (mode === 'gamepad' && action === 'confirm' && selected?.matches('[data-menu-select-trigger][aria-expanded="false"]')) {
      sendMenuSelectCommand(selected, 'open');
      return;
    }
    if (isExpandedMenuSelectTrigger(selected)) {
      if (action === 'previous' || action === 'decrease') sendMenuSelectCommand(selected!, 'previous');
      if (action === 'next' || action === 'increase') sendMenuSelectCommand(selected!, 'next');
      if (action === 'confirm') sendMenuSelectCommand(selected!, 'commit');
      if (action === 'back') sendMenuSelectCommand(selected!, 'cancel');
      return;
    }
    if (action === 'previous') this.select(this.index - 1);
    if (action === 'next') this.select(this.index + 1);
    if (action === 'decrease' || action === 'increase') this.adjustOrMove(action === 'increase' ? 1 : -1);
    if (action === 'confirm') {
      if (mode !== 'gamepad' || !this.options.onGamepadConfirm?.(this.latch.lastGamepadIndex(), selected)) selected?.click();
    }
    if (action === 'back') this.options.onBack();
    if (mode === 'gamepad' && (['previous', 'next', 'decrease', 'increase'].includes(action) || (action === 'confirm' && selected?.matches('[data-player-name]')))) {
      this.options.onGamepadSelection?.(this.latch.lastGamepadIndex(), this.items()[this.index] ?? null);
    }
  }

  private adjustOrMove(direction: -1 | 1): void {
    const selected = this.items()[this.index];
    if (selected instanceof HTMLInputElement && selected.type === 'range') {
      const step = Number(selected.step) || 1;
      const minimum = selected.min === '' ? 0 : Number(selected.min);
      const maximum = selected.max === '' ? 100 : Number(selected.max);
      selected.valueAsNumber = Math.min(maximum, Math.max(minimum, selected.valueAsNumber + (step * direction)));
      selected.dispatchEvent(new Event('input', { bubbles: true }));
      selected.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    if (selected instanceof HTMLSelectElement) {
      const nextIndex = Math.min(selected.options.length - 1, Math.max(0, selected.selectedIndex + direction));
      if (nextIndex !== selected.selectedIndex) {
        selected.selectedIndex = nextIndex;
        selected.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return;
    }
    this.select(this.index + direction);
  }

  private readonly onDocumentKeyDown = (event: KeyboardEvent): void => {
    const allowed = this.resultsGuard.keyDown(event.code || event.key, event.repeat);
    if (this.screen !== 'results') return;
    const action = keyboardMenuAction(event.key);
    if (!action && event.key !== 'Tab') return;
    if (event.key === 'Tab' && allowed) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (allowed) this.perform(action, 'keyboard');
  };

  private readonly onDocumentKeyUp = (event: KeyboardEvent): void => {
    this.resultsGuard.keyUp(event.code || event.key);
    // A blocked Space/Enter keydown must not later trigger a native button click.
    if (this.screen === 'results' && (event.key === ' ' || event.key === 'Enter')) event.preventDefault();
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    const action = keyboardMenuAction(event.key);
    if (!action || !this.screen) return;
    const target = event.target;
    if ((target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) && action !== 'back') return;
    event.preventDefault();
    event.stopPropagation();
    this.perform(action, 'keyboard');
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (!this.screen || (this.screen === 'results' && !this.resultsGuard.ready())) return;
    if (isMobilePlayViewport()) return;
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-ui-focus]') : null;
    if (!target || target.hasAttribute('disabled')) return;
    const index = this.items().indexOf(target);
    if (index < 0) return;
    this.options.onInputMode?.('pointer');
    this.select(index, true);
  };

  private readonly pollGamepads = (): void => {
    const pads = this.readGamepads();
    this.options.onGamepadsSnapshot?.(pads);
    const freshPads = this.resultsGuard.freshGamepads(pads);
    const action = this.latch.read(
      this.screen === 'results' ? freshPads : pads,
      this.screen !== null && (this.screen !== 'results' || this.resultsGuard.ready()),
      this.options.acceptsGamepad ?? (() => true),
      this.options.onIgnoredGamepadAction,
      this.options.onGamepadRoster,
    );
    if (action) this.perform(action, 'gamepad');
    this.frame = window.requestAnimationFrame(this.pollGamepads);
  };
}
