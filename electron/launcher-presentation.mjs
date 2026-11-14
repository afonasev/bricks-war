import {normalizeReleaseDate} from './release-date.mjs';
const copy = {
  en: {
    current: 'Latest version installed', checkFailed: 'Could not check for updates', offer: 'New version available',
    historical: 'Previous update was not applied', working: 'Could not install the update',
    failure: 'Could not prepare the update', unavailable: 'This update requires a newer launcher',
    blocked: 'Could not verify the installed game', manual: 'Windows installer available',
    progress: 'Downloading update', verifying: 'Verifying update', installing: 'Installing update', cancelling: 'Cancelling update',
    currentTag: 'Ready to play', checkTag: 'Game available', offerTag: 'Update available',
    progressTag: 'Getting ready', blockedTag: 'Installation needs attention',
    checkFailedBody: 'The launcher could not load or verify release data from GitHub. Reopen it to check again, or play the installed version.',
    checkTimeoutBody: 'GitHub did not respond in time. Reopen the launcher to check again, or play the installed version.',
    checkAbortedBody: 'The update check was interrupted. Reopen the launcher to check again, or play the installed version.',
    historicalBody: 'The installed version is ready to play. The check found no update the launcher could offer.',
    historicalNotice: 'The previous update was not applied.',
    workingBody: 'The launcher verified the installed game. Choose Play to start it.',
    failureBody: 'The launcher could not download or prepare the update files. Try again or play the installed version.',
    failureDiskBody: 'There is not enough free disk space for the update. Free some space and try again, or play the installed version.',
    failurePermissionBody: 'The launcher could not save the update files. Check folder permissions and try again, or play the installed version.',
    failureIntegrityBody: 'The downloaded files did not pass verification. Try downloading them again or play the installed version.',
    unavailableBody: 'No compatible installer was found for this update. You can still play the installed version.',
    blockedBody: 'The launcher could not verify a working copy after the update failed. Exit and run the official Bricks War installer.',
    manualBody: 'Download the EXE from GitHub, close Bricks War, then run the installer.',
    installerFailed: 'Could not open the installer link. Try again or visit Bricks War Releases on GitHub.',
    notesFailed: 'Could not open release notes in the browser. Try again or open Bricks War Releases on GitHub.',
    progressBody: 'When the update is ready, the game will start automatically.',
    installingBody: 'Please wait while the verified update is installed.',
    cancellingBody: 'Stopping the download before starting the installed game.',
    play: 'Play', update: 'Update', quit: 'Exit', retry: 'Try again', cancel: 'Cancel', installer: 'Download installer',
    notes: 'What’s new', installed: 'Installed', unknownDate: 'Version date unavailable', noUpdates: 'No updates available',
  },
  ru: {
    current: 'Установлена последняя версия', checkFailed: 'Не удалось проверить обновления', offer: 'Найдена новая версия',
    historical: 'Предыдущее обновление не применилось', working: 'Не удалось установить обновление',
    failure: 'Не удалось подготовить обновление', unavailable: 'Для обновления нужен новый лаунчер',
    blocked: 'Не удалось проверить установленную игру', manual: 'Доступен установщик для Windows',
    progress: 'Загружаем обновление', verifying: 'Проверяем обновление', installing: 'Устанавливаем обновление', cancelling: 'Отменяем обновление',
    currentTag: 'Всё готово к игре', checkTag: 'Игра доступна', offerTag: 'Доступно обновление',
    progressTag: 'Готовимся к игре', blockedTag: 'Нужна проверка установки',
    checkFailedBody: 'Лаунчер не смог получить или проверить данные с GitHub. Откройте его снова, чтобы повторить проверку, или нажмите «Играть».',
    checkTimeoutBody: 'GitHub не ответил вовремя. Перезапустите лаунчер для новой проверки или нажмите «Играть».',
    checkAbortedBody: 'Проверка обновлений прервалась. Перезапустите лаунчер для новой проверки или нажмите «Играть».',
    historicalBody: 'Установленная версия готова к запуску. Проверка не нашла обновления, которое лаунчер может предложить.',
    historicalNotice: 'Предыдущее обновление не применилось.',
    workingBody: 'Лаунчер проверил установленную версию. Нажмите «Играть», чтобы её запустить.',
    failureBody: 'Лаунчер не смог скачать или подготовить файлы обновления. Нажмите «Повторить» или запустите установленную версию.',
    failureDiskBody: 'Для обновления не хватает места на диске. Освободите место и нажмите «Повторить» или запустите установленную версию.',
    failurePermissionBody: 'Лаунчер не смог записать файлы обновления. Проверьте права доступа к папке и нажмите «Повторить» или запустите установленную версию.',
    failureIntegrityBody: 'Скачанные файлы не прошли проверку. Нажмите «Повторить», чтобы загрузить их заново, или запустите установленную версию.',
    unavailableBody: 'Для этого обновления не нашлось совместимого установщика. Можно запустить установленную версию.',
    blockedBody: 'После сбоя обновления лаунчер не смог подтвердить, что игра работает. Закройте лаунчер и запустите официальный установщик Bricks War.',
    manualBody: 'Скачайте EXE с GitHub, закройте Bricks War и запустите установщик.',
    installerFailed: 'Не удалось открыть ссылку на установщик. Повторите попытку или откройте Releases на GitHub.',
    notesFailed: 'Не удалось открыть список изменений в браузере. Попробуйте ещё раз или откройте раздел Releases на GitHub.',
    progressBody: 'Когда обновление будет готово, игра откроется сама.',
    installingBody: 'Подождите, применяем проверенное обновление.',
    cancellingBody: 'Останавливаем загрузку перед запуском установленной игры.',
    play: 'Играть', update: 'Обновить', quit: 'Выйти', retry: 'Повторить', cancel: 'Отменить', installer: 'Скачать установщик',
    notes: 'Что нового', installed: 'Установлена', unknownDate: 'Дата версии неизвестна', noUpdates: 'Обновлений нет',
  },
};
export function launcherPresentation(view){
 const locale=view.locale?.startsWith('ru')?'ru':'en',t=copy[locale],state=view.state??{};
 const datedVersion=(version,date)=>{
  const known=normalizeReleaseDate(date);
  const formatted=known?new Intl.DateTimeFormat(locale,{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(known+'T12:00:00Z')):t.unknownDate;
  return [version,formatted].filter(Boolean).join(' · ');
 };
  const current = ['current','installed'].includes(state.checkOutcome);
  let kind = view.kind;
  if (kind === 'status') kind = current ? (view.historical ? 'historical' : 'current') : 'checkFailed';
  if (kind === 'failure') kind = view.playable === false ? 'blocked' : view.unavailable ? 'unavailable'
    : view.confirmedWorking || view.recovery ? 'working' : 'failure';
  const title = kind === 'progress' && state.phase === 'verifying' ? t.verifying : t[kind];
  let description = t[kind + 'Body'];
  if (kind === 'checkFailed') {
    if (state.checkOutcome === 'timeout') description = t.checkTimeoutBody;
    if (state.checkOutcome === 'aborted') description = t.checkAbortedBody;
  }
  if (kind === 'failure') description = {
    disk: t.failureDiskBody, permission: t.failurePermissionBody, integrity: t.failureIntegrityBody,
  }[state.failureReason] ?? description;
  if (kind === 'current') description = datedVersion(state.currentVersion, state.currentDate);
  const candidate = ['offer', 'manual', 'unavailable'].includes(kind) && state.version
    ? datedVersion(state.version, state.versionDate) : '';
  if (candidate) description = [candidate, description].filter(Boolean).join(' — ');
  const notice = [view.historical && kind !== 'historical' && t.historicalNotice,
    view.installerOpenFailed && t.installerFailed, view.notesOpenFailed && t.notesFailed].filter(Boolean).join(' ');
  const version = kind === 'current' ? t.noUpdates : `${t.installed} ${datedVersion(state.currentVersion,state.currentDate)}`;
  const eyebrow = kind === 'current' ? t.currentTag : ['offer', 'manual', 'unavailable'].includes(kind) ? t.offerTag
    : kind === 'blocked' ? t.blockedTag : ['progress','installing','cancelling'].includes(kind) ? t.progressTag : t.checkTag;
  return {kind,copy:t,title,description,version,eyebrow,locale,notice};
}
