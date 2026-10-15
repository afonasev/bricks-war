// Electron content sizes are logical pixels (DIP), not monitor physical pixels.
export const RESOLUTIONS = [[960, 540], [1280, 720], [1440, 900], [1600, 900], [1920, 1080], [2560, 1440], [3840, 2160]];
export function windowPreferences(value = {}) {
  const resolution = RESOLUTIONS.find(([w, h]) => w === value.width && h === value.height) ?? RESOLUTIONS[1];
  return { width: resolution[0], height: resolution[1], fullscreen: value.fullscreen === true, auto: value.auto === true };
}
export function fitWindow(preferences, area, frame = { width: 0, height: 40 }) {
  return { width: Math.max(1, Math.min(preferences.auto ? area.width : preferences.width, area.width - frame.width)),
    height: Math.max(1, Math.min(preferences.auto ? area.height : preferences.height, area.height - frame.height)) };
}
