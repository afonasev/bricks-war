import sunlit from '../assets/arena/scenes/sunlit.webp';
import drafting from '../assets/arena/scenes/drafting.webp';
import evening from '../assets/arena/scenes/evening.webp';
import garden from '../assets/arena/scenes/garden.webp';
import paper from '../assets/arena/scenes/paper.webp';

export const MATCH_BACKGROUNDS = [
  { id: 'sunlit', image: sunlit },
  { id: 'drafting', image: drafting },
  { id: 'evening', image: evening },
  { id: 'garden', image: garden },
  { id: 'paper', image: paper },
] as const;
export type MatchBackground = typeof MATCH_BACKGROUNDS[number];

/** Cosmetic entropy never consumes the simulation seed or PRNG. */
function cosmeticRandom(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0]! / 0x100000000;
}

/** A reconnect/rebuild of the same arena must not reroll its scenery. */
export class MatchBackgroundSelection {
  private key: string | null = null;
  private background: MatchBackground = MATCH_BACKGROUNDS[0];
  constructor(private readonly random: () => number = cosmeticRandom) {}

  forMatch(key: string): MatchBackground {
    if (this.key !== key) {
      this.key = key;
      this.background = MATCH_BACKGROUNDS[Math.min(MATCH_BACKGROUNDS.length - 1,
        Math.max(0, Math.floor(this.random() * MATCH_BACKGROUNDS.length)))]!;
    }
    return this.background;
  }
}

export function applyMatchBackground(arena: HTMLElement, background: MatchBackground): void {
  arena.dataset.matchBackground = background.id;
  arena.style.setProperty('--match-background-image', `url("${background.image}")`);
}
