export type AppScreen =
  | 'network'
  | 'main-menu'
  | 'survival'
  | 'battle'
  | 'team-battle'
  | 'settings'
  | 'controls'
  | 'rules'
  | 'laboratory'
  | 'arena'
  | 'pause'
  | 'results';

const DEFAULT_PARENTS: Partial<Record<AppScreen, AppScreen>> = {
  network: 'main-menu',
  survival: 'main-menu',
  battle: 'main-menu',
  'team-battle': 'main-menu',
  settings: 'main-menu',
  controls: 'settings',
  rules: 'settings',
  laboratory: 'settings',
  pause: 'arena',
  results: 'main-menu',
};

export class ScreenRouter {
  private active: AppScreen = 'main-menu';
  private readonly parents = new Map<AppScreen, AppScreen>();
  private readonly selections = new Map<AppScreen, number>();

  current(): AppScreen {
    return this.active;
  }

  open(screen: AppScreen, parent?: AppScreen): AppScreen {
    const resolvedParent = parent ?? DEFAULT_PARENTS[screen];
    if (resolvedParent && resolvedParent !== screen) this.parents.set(screen, resolvedParent);
    this.active = screen;
    return screen;
  }

  back(): AppScreen | null {
    const parent = this.parents.get(this.active) ?? DEFAULT_PARENTS[this.active];
    if (!parent) return null;
    this.active = parent;
    return parent;
  }

  rememberSelection(screen: AppScreen, index: number): void {
    this.selections.set(screen, Math.max(0, Math.floor(index)));
  }

  selectionFor(screen: AppScreen, itemCount: number): number {
    if (itemCount <= 0) return -1;
    return Math.min(this.selections.get(screen) ?? 0, itemCount - 1);
  }
}
