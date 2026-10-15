export function startupMuted(argv = process.argv, qaProfile = process.env.BRICKS_DESKTOP_QA_PROFILE) {
  return Boolean(qaProfile) || argv.some(argument => argument === '-muted');
}

export function gameUrl(origin, muted) {
  const url = new URL('/', origin);
  if (muted) url.searchParams.set('muted', '1');
  return url.toString();
}
