import survivalUrl from '../assets/menu/survival.webp';
import battleUrl from '../assets/menu/battle.webp';
import teamBattleUrl from '../assets/menu/team-battle.webp';
import networkUrl from '../assets/menu/network.webp';
import settingsUrl from '../assets/menu/settings.webp';
import exitUrl from '../assets/menu/exit.webp';

export type MainMenuDestination = 'survival' | 'battle' | 'team-battle' | 'network' | 'settings' | 'exit';

export const MAIN_MENU_PREVIEWS: Record<MainMenuDestination, { label: string; image: string }> = {
  survival: { label: 'Выживание: игровое поле и кубок за рекорд', image: survivalUrl },
  battle: { label: 'Битва: четыре отдельных игровых поля', image: battleUrl },
  'team-battle': { label: 'Командный бой: две команды по два игровых поля', image: teamBattleUrl },
  network: { label: 'Сетевая игра: одинаковые игровые поля на разных устройствах', image: networkUrl },
  exit: { label: 'Выход: дверь из мастерской со знаком выключения', image: exitUrl },
  settings: { label: 'Настройки: звук, экран, управление и раздел «Как играть»', image: settingsUrl },
};

export function mainMenuPreviewMarkup(destination: MainMenuDestination): string {
  const preview = MAIN_MENU_PREVIEWS[destination];
  return `<div class="menu-workshop-scene" style="--menu-art: url('${preview.image}')"><img class="menu-workshop-art" src="${preview.image}" alt="" width="1122" height="1402" decoding="async" /></div>`;
}
