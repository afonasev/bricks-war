export const BUILD_VERSION = __BRICKS_WAR_VERSION__;
export const BUILD_DEPLOYED_AT = __BRICKS_WAR_DEPLOYED_AT__;

export function formatBuildInfo(version = BUILD_VERSION, deployedAt = BUILD_DEPLOYED_AT, locale = 'ru-RU'): string {
  if (!deployedAt) return `Версия ${version}`;
  const date = new Date(deployedAt);
  const timestamp = Number.isNaN(date.getTime())
    ? deployedAt
    : new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date);
  return `Версия ${version} · Деплой ${timestamp}`;
}
