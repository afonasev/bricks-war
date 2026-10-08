import out from '../assets/audio/board-events/out-1.wav?url';
import warning from '../assets/audio/board-events/in-3.wav?url';
import charge from '../assets/audio/board-events/charge-1.wav?url';
import shield from '../assets/audio/board-events/shield-1.wav?url';
import block from '../assets/audio/board-events/block-1.wav?url';
import anomaly from '../assets/audio/board-events/anomaly-3.wav?url';
import fire from '../assets/audio/board-events/fire-3.wav?url';
export const BOARD_EVENT_ASSETS = {out, warning, charge, shield, block, anomaly, fire};
export type BoardEventSound = keyof typeof BOARD_EVENT_ASSETS;
