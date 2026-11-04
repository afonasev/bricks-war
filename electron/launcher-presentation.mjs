import {normalizeReleaseDate} from './release-date.mjs';
const copy={
 en:{current:'Latest version installed',checkFailed:'Could not check for updates',offer:'New version available',
  historical:'Installed game is ready',working:'Working game is ready',failure:'Update interrupted',unavailable:'Update unavailable',blocked:'Unable to start the game',
  progress:'Downloading update',verifying:'Verifying update',installing:'Installing update',cancelling:'Cancelling update',
  currentTag:'Ready to play',checkTag:'Game available',offerTag:'Update available',progressTag:'Getting ready',blockedTag:'Installation needs attention',
  currentBody:'',checkFailedBody:'You can play the installed version.',offerBody:'',
  historicalBody:'The previous update was not applied. You can play the installed version.',workingBody:'The working game was verified. You can start playing.',
  failureBody:'You can retry or start the installed game.',unavailableBody:'This update cannot be installed automatically. You can play the installed version.',
  blockedBody:'The working version could not be confirmed. Close the launcher and repair the installation.',
  progressBody:'The game will start automatically when the update is ready.',installingBody:'Please wait while the verified update is applied.',cancellingBody:'Stopping the download before starting the installed game.',
  play:'Play',update:'Update',quit:'Exit',retry:'Try again',cancel:'Cancel',notes:'What’s new',installed:'Installed',unknownDate:'Version date unavailable',noUpdates:'No updates available'},
 ru:{current:'Установлена последняя версия',checkFailed:'Не удалось проверить обновления',offer:'Найдена новая версия',
  historical:'Установленная игра готова',working:'Рабочая игра готова',failure:'Обновление прервалось',unavailable:'Обновление недоступно',blocked:'Не удалось запустить игру',
  progress:'Загружаем обновление',verifying:'Проверяем обновление',installing:'Устанавливаем обновление',cancelling:'Отменяем обновление',
  currentTag:'Всё готово к игре',checkTag:'Игра доступна',offerTag:'Доступно обновление',progressTag:'Готовимся к игре',blockedTag:'Нужна проверка установки',
  currentBody:'',checkFailedBody:'Можно запустить установленную игру',offerBody:'',
  historicalBody:'Предыдущее обновление не применено. Можно играть в установленную версию.',workingBody:'Рабочая игра проверена. Можно начать играть.',
  failureBody:'Можно повторить обновление или запустить установленную игру.',unavailableBody:'Это обновление нельзя установить автоматически. Можно играть в установленную версию.',
  blockedBody:'Не удалось подтвердить рабочую версию. Закройте лаунчер и восстановите установку.',
  progressBody:'Когда обновление будет готово, игра откроется сама.',installingBody:'Подождите, применяем проверенное обновление.',cancellingBody:'Останавливаем загрузку перед запуском установленной игры.',
  play:'Играть',update:'Обновить',quit:'Выйти',retry:'Повторить',cancel:'Отменить',notes:'Что нового',installed:'Установлена',unknownDate:'Дата версии неизвестна',noUpdates:'Обновлений нет'}
};
export function launcherPresentation(view){
 const locale=view.locale?.startsWith('ru')?'ru':'en',t=copy[locale],state=view.state??{};
 const datedVersion=(version,date)=>{
  const known=normalizeReleaseDate(date);
  const formatted=known?new Intl.DateTimeFormat(locale,{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(known+'T12:00:00Z')):t.unknownDate;
  return [version,formatted].filter(Boolean).join(' · ');
 };
 let kind=view.kind;
 if(kind==='status')kind=['current','installed'].includes(state.checkOutcome)?'current':'checkFailed';
 if(kind==='failure')kind=view.playable===false?'blocked':view.unavailable?'unavailable':view.historical?'historical':view.confirmedWorking||view.recovery?'working':'failure';
 const title=kind==='progress'&&state.phase==='verifying'?t.verifying:t[kind];
 const description=['current','offer'].includes(kind)?datedVersion(kind==='offer'?state.version:state.currentVersion,kind==='offer'?state.versionDate:state.currentDate):t[kind+'Body'];
 const version=kind==='current'?t.noUpdates:`${t.installed} ${datedVersion(state.currentVersion,state.currentDate)}`;
 const eyebrow=kind==='current'?t.currentTag:kind==='offer'?t.offerTag:kind==='blocked'?t.blockedTag:['progress','installing','cancelling'].includes(kind)?t.progressTag:t.checkTag;
 return{kind,copy:t,title,description,version,eyebrow,locale};
}
