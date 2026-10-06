export const RESOLUTIONS = [[960, 540], [1280, 720], [1440, 900], [1600, 900], [1920, 1080]];
export function windowPreferences(value = {}) {
  const resolution = RESOLUTIONS.find(([w, h]) => w === value.width && h === value.height) ?? RESOLUTIONS[1];
  return { width: resolution[0], height: resolution[1], fullscreen: value.fullscreen === true };
}
export function fitWindow(preferences, area) {
  return { width: Math.min(preferences.width, area.width), height: Math.min(preferences.height, Math.max(480, area.height - 40)) };
}
