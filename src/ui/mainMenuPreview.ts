import { text } from '../i18n/locale';
import survivalUrl from '../assets/menu/survival.webp';
import battleUrl from '../assets/menu/battle.webp';
import teamBattleUrl from '../assets/menu/team-battle.webp';
import networkUrl from '../assets/menu/network.webp';
import settingsUrl from '../assets/menu/settings.webp';
import exitUrl from '../assets/menu/exit.webp';

export type MainMenuDestination = 'play' | 'survival' | 'battle' | 'team-battle' | 'network' | 'settings' | 'exit';

export const MAIN_MENU_PREVIEWS: Record<MainMenuDestination, { label: string; image: string }> = {
  play: { get label() { return text('previewPlay'); }, image: battleUrl },
  survival: { get label() { return text('previewSurvival'); }, image: survivalUrl },
  battle: { get label() { return text('previewBattle'); }, image: battleUrl },
  'team-battle': { get label() { return text('previewTeam'); }, image: teamBattleUrl },
  network: { get label() { return text('previewNetwork'); }, image: networkUrl },
  exit: { get label() { return text('previewExit'); }, image: exitUrl },
  settings: { get label() { return text('previewSettings'); }, image: settingsUrl },
};

export function mainMenuPreviewMarkup(destination: MainMenuDestination): string {
  const preview = MAIN_MENU_PREVIEWS[destination];
  return `<div class="menu-workshop-scene" style="--menu-art: url('${preview.image}')"><img class="menu-workshop-art" src="${preview.image}" alt="" width="1122" height="1402" decoding="async" /></div>`;
}
