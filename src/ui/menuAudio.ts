import type { GameAudio } from '../audio/GameAudio';

/** Native windows allow audio on launch; browsers retain gesture-based startup. */
export function bindMenuAudio(root: EventTarget, audio: Pick<GameAudio, 'unlock' | 'enterMenu'>, refresh: () => void, autoplay: boolean): void {
  const unlock = (): void => {
    root.removeEventListener('pointerdown', unlock);
    root.removeEventListener('keydown', unlock);
    audio.unlock();
    audio.enterMenu();
    refresh();
  };
  if (autoplay) {
    unlock();
    return;
  }
  root.addEventListener('pointerdown', unlock);
  root.addEventListener('keydown', unlock);
}
