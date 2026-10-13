import type * as Phaser from 'phaser';

export interface CanvasViewport {
  width: number;
  height: number;
  pixelWidth: number;
  pixelHeight: number;
}

export function canvasViewport(width: number, height: number, density: number): CanvasViewport {
  const ratio = Number.isFinite(density) && density > 0 ? density : 1;
  return { width, height, pixelWidth: Math.max(1, Math.round(width * ratio)), pixelHeight: Math.max(1, Math.round(height * ratio)) };
}

/** Phaser 3.90 has no renderer-wide resolution option. Keep the world in CSS
 * pixels and magnify its camera into a physical-pixel canvas, displayed at 1/DPR.
 * This is shared by local and network arenas; phone rendering keeps its policy.
 */
export function installCanvasViewport(scene: Phaser.Scene, enabled: boolean, changed: () => void): { size: () => CanvasViewport; refreshDensity: () => void; destroy: () => void } {
  const parent = scene.game.canvas.parentElement!;
  let size = canvasViewport(scene.scale.width, scene.scale.height, 1);
  let density = 1;
  let observer: ResizeObserver | undefined;
  let initialized = false;
  const sync = (): void => {
    if (!enabled || !parent.clientWidth || !parent.clientHeight) return;
    const next = canvasViewport(parent.clientWidth, parent.clientHeight, window.devicePixelRatio);
    if (Object.keys(next).every(key => next[key as keyof CanvasViewport] === size[key as keyof CanvasViewport])) return;
    size = next;
    density = window.devicePixelRatio;
    // NONE is intentionally owned here: automatic RESIZE would overwrite the
    // physical buffer with CSS dimensions on the next browser resize.
    scene.scale.setZoom(size.width / size.pixelWidth);
    scene.scale.resize(size.pixelWidth, size.pixelHeight);
    const canvas = scene.game.canvas;
    canvas.style.width = `${size.width}px`;
    canvas.style.height = `${size.height}px`;
    scene.scale.updateBounds();
    scene.cameras.main.setOrigin(0, 0).setScroll(0, 0).setZoom(size.pixelWidth / size.width, size.pixelHeight / size.height);
    if (initialized) changed();
  };
  if (enabled) {
    scene.scale.scaleMode = 0; // Phaser.Scale.NONE; type-only import avoids a second Phaser bundle.
    observer = new ResizeObserver(sync);
    observer.observe(parent);
    window.addEventListener('resize', sync);
    sync();
    // Also take ownership at DPR 1 when the initial size already matches.
    if (scene.game.canvas.style.width === '') {
      scene.game.canvas.style.width = `${size.width}px`;
      scene.game.canvas.style.height = `${size.height}px`;
    }
  }
  initialized = true;
  return {
    size: () => enabled ? size : canvasViewport(scene.scale.width, scene.scale.height, 1),
    refreshDensity: () => { if (enabled && window.devicePixelRatio !== density) sync(); },
    destroy: () => {
      observer?.disconnect();

      window.removeEventListener('resize', sync);
    },
  };
}
