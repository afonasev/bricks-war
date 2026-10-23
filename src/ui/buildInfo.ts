import { getLocale, text } from '../i18n/locale';
export const BUILD_VERSION = __BRICKS_WAR_VERSION__;
export const BUILD_DEPLOYED_AT = __BRICKS_WAR_DEPLOYED_AT__;

export function formatBuildInfo(version = BUILD_VERSION, deployedAt = BUILD_DEPLOYED_AT, locale = getLocale() === 'en' ? 'en-GB' : getLocale()): string {
  if (!deployedAt) return `${text('version')} ${version}`;
  const date = new Date(deployedAt);
  const timestamp = Number.isNaN(date.getTime())
    ? deployedAt
    : new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date);
  return `${text('version')} ${version} · ${timestamp}`;
}
