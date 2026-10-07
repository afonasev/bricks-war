import { shieldInventoryMarkup, shieldInventoryKey } from '../ui/shieldInventory';
import * as Phaser from 'phaser/dist/phaser.esm.js';
import { NetworkMatchSession, loadCredential, storeCredential, networkRequest } from './client';
import type { ClientSnapshot, Credential, LobbySummary, HeldControls, ClientCommand, PublicSeat } from './protocol';
import { EMPTY_HELD } from './protocol';
import { PlayScene, type PlayRuntime } from '../rendering/PlayScene';
import { HumanInputRouter } from '../controllers/input';
import { mobileTouchActionAt } from '../controllers/mobileTouchZones';
import { gamepadControls } from '../controllers/gamepads';
import { TiltControls } from '../controllers/tilt';
import type { ArenaLayout } from '../rendering/arenaLayout';
import { TILE_STYLES } from '../domain/tileStyles';
import { nextPiecePreviewMarkup } from '../ui/nextPiecePreview';
import { playerAccentForSlot } from '../ui/hudIdentity';
import { formatClock } from '../ui/format';
import {setNetworkParticipation} from '../pwa/participation';
import {isMobilePlayViewport} from '../ui/mobileSettings';
import {enhanceMenuSelects} from '../ui/menuSelect';
import type { TileStyleSelection } from '../domain/types';
import { MODE_LABELS, NETWORK_MODES, roomRules, balancedNetworkTeams, type ResolvedRoomRules } from './rules';
import { loadPersonal, savePersonal, loadCreator, loadCreatorRules, saveCreatorRules, saveCreatorRoom, saveCreatorBots, type NetworkControls } from './setupPersistence';
import type { NetworkMode } from './protocol';
import { teamScores } from '../simulation/competition';
import { decodeMatchState } from '../simulation/match';
import type { GameAudio } from '../audio/GameAudio';
import './lobbyRoster.css';
const escape=(v:string)=>v.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const aiLabels={easy:'Лёгкий',medium:'Средний',hard:'Сложный',expert:'Эксперт'};
const styleOptions=(selected:TileStyleSelection)=>[...TILE_STYLES.map(t=>({id:t.id as string,label:t.label})),{id:'random',label:'Случайный'}].map(t=>`<option value="${t.id}" ${t.id===selected?'selected':''}>${t.label}</option>`).join('');
const phaseLabel={waiting:'Ожидание',countdown:'Старт',playing:'Идёт матч',paused:'Пауза',results:'Результаты'};
type Controls = NetworkControls;
export class NetworkApp {
  private session:NetworkMatchSession|null=null;
  private audioGeneration:string|null=null;
  private credential=loadCredential();
  private game:Phaser.Game|null=null;
  private arenaElement:HTMLElement|null=null;
  private arenaRuntime:PlayRuntime|null=null;
  private arenaIdentity:string|null=null;
  private view='list';
  private renderKey='';
  private timer:ReturnType<typeof setInterval>;
  private destroyed=false;
  private controls:Controls=loadPersonal(isMobilePlayViewport()||matchMedia('(pointer:coarse)').matches?'touch':'keyboard').controls;
  private sources=new Map<string,string>();
  private blocked=new Set<string>();
  private gamepadPause=false;
  private layout:ArenaLayout|null=null;
  private tilt=new TiltControls();
  private orientation:DeviceOrientationEvent|null=null;
  private tiltEnabled=false;
  private frame=0;
  private listBusy=false;
  private listOffset=0;
  private storageAvailable=true;
  constructor(private root:HTMLElement,private onMenu:()=>void,private audio?:Pick<GameAudio,'syncNetworkAnomalies'>) {
    this.root.classList.add('network-root');
    window.addEventListener('keydown',this.keyDown);window.addEventListener('keyup',this.keyUp);
    window.addEventListener('deviceorientation',this.sensor);
    this.timer=setInterval(()=>{if(this.view==='list')void this.refreshList();},2000);
    void this.showList();this.frame=requestAnimationFrame(this.poll);
  }
  private button(label:string,action:string,disabled=false):string {return `<button type="button" data-net-action="${action}" ${disabled?'disabled':''}>${label}</button>`;}
  private shell(title:string,body:string):void {
    this.root.innerHTML=`<main class="network-screen release-screen premium-surface mode-setup-screen" data-network-view="${this.view}"><header class="network-heading release-heading"><button type="button" class="screen-back" data-net-action="menu" aria-label="Главное меню">← Главное меню</button><div><p class="eyebrow">BRICKS WAR · СЕТЬ</p><h1>${title}</h1></div></header><output class="network-status" role="status" id="network-status"></output><div class="network-content">${body}</div></main>`;
    this.bind();
  }
  private bind():void {
    this.root.querySelectorAll<HTMLButtonElement>('[data-net-action]').forEach(button=>button.onclick=()=>void this.action(button.dataset.netAction!));
  }
  private status(message:string):void {
    const text=message+(this.storageAvailable?'':' · браузер не сохраняет место; возврат после перезагрузки не гарантирован');
    for(const element of this.root.querySelectorAll<HTMLElement>('#network-status,#network-mobile-status')){element.textContent=text;if(element.id==='network-mobile-status')element.hidden=message==='Подключено'&&this.storageAvailable;}
  }
  private async action(action:string):Promise<void> {
    try {
      if(action==='menu') {this.destroy();this.onMenu();return;}
      if(action==='list'){await this.showList();return;}
      if(action.startsWith('page:')){this.listOffset=Number(action.slice(5));await this.refreshList();return;}
      if(action==='retry'){await this.refreshList();return;}
      if(action==='create'){this.createForm();return;}
      if(action==='return' && this.credential){this.attach(this.credential);return;}
      if(action.startsWith('join:')){this.joinForm(action.slice(5));return;}
      if(action==='leave'){this.session?.dispose(true);this.session=null;this.credential=null;await this.showList();return;}
      if(action==='tilt'){await this.enableTilt();return;}
      if(action==='pause'){this.session?.send({type:'pause'});return;}
      if(action==='resume'){this.session?.send({type:'resume'});return;}
      if(action.startsWith('exclude:')){this.session?.send({type:'exclude',participantId:action.slice(8)});return;}
      if(action==='ai-add'){this.session?.send({type:'ai-add'});return;}
      if(action.startsWith('ai-remove:')){this.session?.send({type:'ai-remove',participantId:action.slice(10)});return;}
      if(action==='start' || action==='lobby'){this.session?.send({type:action});return;}
      if(action==='ready') {const own=this.session?.snapshot?.seats.find(s=>s.id===this.credential?.participantId);this.session?.send({type:'ready',ready:!own?.ready});return;}
    } catch(error){this.status(error instanceof Error?error.message:'Не удалось выполнить действие.');}
  }
  private destroyArena():void {
    const game=this.game;this.game=null;this.arenaElement=null;this.arenaRuntime=null;this.arenaIdentity=null;this.layout=null;
    if(game){game.destroy(true);if(game.isBooted)game.loop.tick();}
  }
  private matchIdentity(snapshot:ClientSnapshot):string {
    return JSON.stringify([snapshot.serviceId,snapshot.room.id,snapshot.ownId,snapshot.matchId]);
  }
  private async showList():Promise<void> {
    if(this.game&&this.view==='arena') {
      this.game.loop.sleep();this.arenaElement?.remove();
      for(const source of this.sources.keys())this.blocked.add(source);this.sources.clear();
    }
    this.session?.dispose();this.session=null;this.view='list';this.renderKey='';
    this.shell('Сетевая игра',`<p>Выживание, Битва и Командный бой · минимум 2 человека · до 8 участников с ИИ · одно место на устройстве</p><section id="network-current"></section><div class="network-actions">${this.button('Создать лобби','create')}${this.button('Обновить','retry')}</div><section id="network-lobbies" aria-label="Лобби"></section>`);
    await this.refreshList();
  }
  private async refreshList():Promise<void> {
    if(this.listBusy||this.destroyed)return;this.listBusy=true;
    try {
      const list=await networkRequest<{rooms:LobbySummary[];next:number|null}>(`lobbies?offset=${this.listOffset}`);
      if(this.view!=='list'||this.destroyed)return;
      const container=this.root.querySelector('#network-lobbies')!;
      container.innerHTML=list.rooms.length?list.rooms.map(room=>`<article class="network-lobby"><div><h2>${escape(room.name)} ${room.protected?'🔒':''}</h2><p>${MODE_LABELS[room.mode??'survival']} · ${room.count}/8 · ${phaseLabel[room.phase]}</p></div>${this.button('Войти',`join:${room.id}`,room.phase!=='waiting'||room.count>=8||!!this.credential)}</article>`).join(''):'<p>Лобби пока нет. Создайте первое.</p>';
      container.innerHTML+=`<div class="network-actions">${this.listOffset?this.button('Предыдущая страница',`page:${Math.max(0,this.listOffset-50)}`):''}${list.next!==null?this.button('Следующая страница',`page:${list.next}`):''}</div>`;
      const current=this.root.querySelector('#network-current')!;
      if(this.credential) {
        try {
          const snapshot=await networkRequest<ClientSnapshot>('current',{credential:this.credential});
          if(this.view!=='list')return;
          if(!snapshot.state||snapshot.state.phase==='results'||this.arenaIdentity!==this.matchIdentity(snapshot))this.destroyArena();
          const own=snapshot.seats.find(s=>s.id===this.credential?.participantId);
          current.innerHTML=`<article class="network-current"><h2>Ваш текущий матч</h2><p>${escape(snapshot.room.name)} · ${phaseLabel[snapshot.room.phase]}${own?.absence?` · возврат: ${Math.ceil(own.absence.remainingMs/1000)} с`:''}</p>${this.button('Вернуться','return')}</article>`;
        } catch(error) {
          if(['auth','ended'].includes((error as {code?:string}).code??'')){this.destroyArena();this.credential=null;storeCredential(null);setNetworkParticipation(false);current.innerHTML='<p>Срок возврата истёк. Можно войти в новое лобби.</p>';this.bind();return;}
          current.innerHTML=`<article class="network-current"><h2>Ваш текущий матч</h2><p>Возврат пока не подтверждён</p>${this.button('Повторить возврат','return')}</article>`;
          this.status(error instanceof Error?error.message:'Нет связи.');
        }
      } else current.innerHTML='';
      this.bind();this.status('Список обновлён');
    }catch{if(this.view==='list'){this.root.querySelector('#network-lobbies')!.innerHTML='';this.status('Сервис недоступен. Проверьте связь и повторите. Локальная игра доступна в главном меню.');}}
    finally{this.listBusy=false;}
  }
  private rulesFields(rules:ResolvedRoomRules, disabled=false):string {
    const select=(name:string,label:string,choices:readonly (readonly [string,string])[],value:string)=>`<label>${label}<select aria-label="${label}" name="${name}" ${disabled?'disabled':''}>${choices.map(([v,l])=>`<option value="${v}" ${v===value?'selected':''}>${l}</option>`).join('')}</select></label>`;
    return select('mode','Режим',NETWORK_MODES.map(v=>[v,MODE_LABELS[v]]),rules.mode)
      +select('battleDifficulty','Темп битвы',[['family','Семейный'],['normal','Обычный'],['sport','Спортивный']],rules.battleDifficulty)
      +(rules.mode==='survival'?'':select('softDrop','Ускорение',[['slow','Медленное'],['fast','Быстрое'],['very-fast','Очень быстрое']],rules.softDrop))
      +(rules.mode==='survival'?'':select('battleTimeMode','Длительность',[['until-victory','До победы'],['timed','По времени']],rules.battleTimeMode)
      +(rules.battleTimeMode==='timed'?select('durationMinutes','Минуты',Array.from({length:9},(_,i)=>[String(i+2),String(i+2)]),String(rules.durationMinutes)):'')
      +select('pressure','Давление',[['automatic','Автоматическое'],['fixed','Фиксированное'],['extended','Продлённое']],rules.pressure)
      +select('conflictEnabled','Атаки',[['true','Включены'],['false','Выключены']],String(rules.conflictEnabled))
      +(rules.mode==='team-battle'?'':select('conflictTargeting','Цель атак',[['all-opponents','Всем соперникам'],['hunt-leader','Лидеру']],rules.conflictTargeting)));
  }
  private formRules(form:HTMLFormElement, fallback:ResolvedRoomRules):ResolvedRoomRules {
    const values=Object.fromEntries(new FormData(form));
    return roomRules({...fallback,...values,conflictEnabled:values.conflictEnabled===undefined?fallback.conflictEnabled:values.conflictEnabled==='true',durationMinutes:values.durationMinutes===undefined?fallback.durationMinutes:Number(values.durationMinutes)} as ResolvedRoomRules);
  }
  private createForm():void {
    this.view='create';const creator=loadCreator();const personal=loadPersonal(this.controls);let rules=loadCreatorRules(creator.mode);
    this.shell('Создать лобби',`<form id="network-form"><label>Название лобби<textarea aria-label="Название лобби" name="roomName" required maxlength="32" rows="2">${escape(creator.roomName)}</textarea></label><label>Ваше имя<textarea aria-label="Ваше имя" name="name" required maxlength="32" rows="2">${escape(personal.name)}</textarea></label><label>Пароль (необязательно)<input name="password" type="password" maxlength="64" autocomplete="new-password"></label><section id="network-create-rules">${this.rulesFields(rules)}</section><div class="network-actions"><button type="submit" ${this.credential?'disabled':''}>Создать</button>${this.button('Список лобби','list')}</div></form>`);
    const form=this.root.querySelector<HTMLFormElement>('form')!;
    const bindRules=()=>{this.root.querySelectorAll<HTMLSelectElement>('#network-create-rules select').forEach(control=>control.onchange=()=>{
      const mode=control.name==='mode'?control.value as NetworkMode:rules.mode;
      const updated=this.formRules(form,rules);saveCreatorRules({...updated,mode:rules.mode});
      rules=mode!==rules.mode?loadCreatorRules(mode):updated;saveCreatorRules(rules);
      this.root.querySelector('#network-create-rules')!.innerHTML=this.rulesFields(rules);bindRules();enhanceMenuSelects(this.root);
    });};bindRules();enhanceMenuSelects(this.root);
    form.onsubmit=event=>{event.preventDefault();void this.submit('create',rules);};
    if(this.credential)this.status('Сначала вернитесь в своё лобби и покиньте его.');
  }
  private joinForm(roomId:string):void {
    this.view='join';
    this.shell('Войти в лобби',`<form id="network-form"><input type="hidden" name="roomId" value="${escape(roomId)}"><label>Ваше имя<input name="name" required maxlength="32" value="${escape(loadPersonal(this.controls).name)}"></label><label>Пароль (если лобби закрыто)<input name="password" type="password" maxlength="64" autocomplete="current-password"></label><div class="network-actions"><button type="submit">Войти</button>${this.button('Список лобби','list')}</div></form>`);
    this.root.querySelector<HTMLFormElement>('form')!.onsubmit=event=>{event.preventDefault();void this.submit('join');};
  }
  private async submit(path:string,rules?:ResolvedRoomRules):Promise<void> {
    const form=this.root.querySelector<HTMLFormElement>('form');if(!form)return;
    const button=form.querySelector<HTMLButtonElement>('button[type="submit"]')!;button.disabled=true;
    try {
      const values=Object.fromEntries(new FormData(form).entries());
      const personal=loadPersonal(this.controls);
      savePersonal({name:String(values.name),controls:this.controls});
      if(path==='create'&&rules){saveCreatorRules(rules);saveCreatorRoom(String(values.roomName));}
      const response=await networkRequest<{credential:Credential}>(path,{...values,profile:{tileStyle:personal.tileStyle,teamId:personal.teamId},...(path==='create'?{rules,bots:loadCreator().bots}:{})});
      this.credential=response.credential;
      const stored=storeCredential(response.credential);this.storageAvailable=stored;
      this.attach(response.credential);
      if(!stored)this.status('Браузер не сохраняет место: возврат после перезагрузки не гарантирован.');
    }catch(error){this.status(error instanceof Error?error.message:'Не удалось подключиться.');button.disabled=false;}
  }
  private attach(credential:Credential):void {
    this.session?.dispose();const session=new NetworkMatchSession(credential);this.session=session;
    this.view='connecting';this.renderKey='';this.shell('Подключение',this.button('Список лобби','list'));
    session.onChange=()=>{
      if(this.session!==session)return;
      const snapshot=session.snapshot;
      const own=snapshot?.seats.find(s=>s.id===credential.participantId);
      if(snapshot && own && snapshot.room.phase==='waiting'){
        savePersonal({name:own.name,tileStyle:own.tileStyle,teamId:own.teamId??'team-1',controls:this.controls});
        if(snapshot.creatorId===snapshot.ownId){saveCreatorBots(snapshot.seats);}
      }
      this.renderSession();
    };
    this.session.onResetInput=()=>{for(const source of this.sources.keys())this.blocked.add(source);this.sources.clear();};
    this.session.connect();
  }
  private teamSelect(teamId:string,name:string):string {return `<label>Команда<select aria-label="Команда" name="${name}"><option value="team-1" ${teamId==='team-1'?'selected':''}>Команда 1</option><option value="team-2" ${teamId==='team-2'?'selected':''}>Команда 2</option></select></label>`;}
  private rosterSeat(seat:PublicSeat,index:number,snapshot:ClientSnapshot,creator:boolean):string {
    const ai=seat.kind==='ai';
    const roles=ai?`ИИ · ${aiLabels[seat.difficulty!]}`:[seat.id===snapshot.ownId?'Вы':'',seat.id===snapshot.creatorId?'Создатель':''].filter(Boolean).join(' · ');
    const state=ai?'Готов автоматически':`${seat.connected?seat.ready?'Готов':'Не готов':'Возвращается'}${seat.absence?` · ${Math.ceil(seat.absence.remainingMs/1000)} с`:''}`;
    const editor=ai&&creator?`<details class="network-ai-editor"><summary>Настроить ИИ</summary><form data-network-ai="${seat.id}"><label>Сложность ИИ<select aria-label="Сложность ИИ" name="difficulty">${Object.entries(aiLabels).map(([v,l])=>`<option value="${v}" ${v===seat.difficulty?'selected':''}>${l}</option>`).join('')}</select></label><label>Вид фигур ИИ<select aria-label="Вид фигур ИИ" name="tileStyle">${styleOptions(seat.tileStyle)}</select></label>${roomRules(snapshot.rules).mode==='team-battle'?this.teamSelect(seat.teamId??'team-1','teamId'):''}<div class="network-ai-actions"><button type="submit">Сохранить ИИ</button>${this.button('Удалить ИИ',`ai-remove:${seat.id}`)}</div></form></details>`:'';
    return `<li data-kind="${seat.kind}" data-ready="${ai||seat.ready&&seat.connected}"><span class="network-seat-number" aria-hidden="true">${index+1}</span><div class="network-seat-copy"><strong>${escape(seat.name)}</strong><small>${roles}${roomRules(snapshot.rules).mode==='team-battle'?` · Команда ${seat.teamId==='team-2'?2:1}`:''}</small><span class="network-seat-state">${state}</span></div>${editor}</li>`;
  }
  private renderSession():void {
    const session=this.session;const snapshot=session?.snapshot;
    if(!session)return;
    if(!session.active){this.destroyArena();this.view='ended';this.credential=null;
      this.shell('Сессия завершена',`<p>${escape(session.status)}</p>${this.button('Список лобби','list')}`);return;}
    if(!snapshot){this.status(session.status);return;}
    if(snapshot.state) {
      const generation=`${snapshot.matchId}:${snapshot.connectionEpoch}`;
      this.audio?.syncNetworkAnomalies(decodeMatchState(snapshot.state),generation!==this.audioGeneration);
      this.audioGeneration=generation;
    } else this.audioGeneration=null;
    if(snapshot.state && snapshot.state.phase!=='results') {
      if(this.view!=='arena')this.arena();
      this.updateArena();return;
    }
    this.destroyArena();
    const key=JSON.stringify([snapshot.room.phase,snapshot.seats,snapshot.rules,snapshot.creatorId]);
    if(key===this.renderKey){this.status(session.status);return;}
    this.renderKey=key;
    if(snapshot.state?.phase==='results') {
      this.view='results';
      this.shell('Результаты',`${snapshot.state.options.matchVariant==='teams'?`<p>${teamScores(snapshot.state.participants.map(p=>({id:p.config.id,score:p.score,alive:p.board.alive,teamId:p.config.teamId}))).map(t=>`Команда ${t.teamId==='team-2'?2:1}: ${t.score} очков`).join(' · ')}</p>`:''}<ol class="network-roster">${[...snapshot.state.participants].sort((a,b)=>a.placement!-b.placement!||b.score-a.score).map(p=>`<li><strong>${p.placement}. ${escape(p.config.label)}${p.config.controller==='ai'?' · ИИ':''}${p.config.teamId?` · Команда ${p.config.teamId==='team-2'?2:1}`:''}${snapshot.state!.winnerIds.includes(p.config.id)?' · Победа':''}</strong><span>${p.score} очков · ${formatClock(p.survivalMs)}</span></li>`).join('')}</ol><div class="network-actions">${this.button('В лобби','lobby')}${this.button('Покинуть','leave')}</div>`);
    } else {
      this.view='lobby';const own=snapshot.seats.find(s=>s.id===snapshot.ownId)!;
      const creator=snapshot.creatorId===snapshot.ownId;
      const seats=snapshot.seats.filter(s=>s.retained);const humans=seats.filter(s=>s.kind==='human');const bots=seats.filter(s=>s.kind==='ai');
      const rules=roomRules(snapshot.rules);
      const canStart=(rules.mode!=='team-battle'||balancedNetworkTeams(seats))&&humans.length>=2&&seats.length<=8&&humans.every(s=>s.ready&&s.connected&&!s.absence);
      this.shell(escape(snapshot.room.name),`<p class="network-intro">${MODE_LABELS[rules.mode]} · минимум 2 человека · до 8 участников${rules.mode==='team-battle'?' · равные команды 2×2 / 3×3 / 4×4':''}</p><div class="network-room-grid"><section class="network-roster-panel release-panel"><p class="eyebrow">ОБЩАЯ КОМНАТА</p><h2>Участники · ${seats.length}/8</h2><p class="network-roster-hint">Люди: ${humans.length} · ИИ: ${bots.length}/6. Для старта нужны минимум два готовых человека.</p><ul class="network-roster">${seats.map((s,i)=>this.rosterSeat(s,i,snapshot,creator)).join('')}</ul>${creator?`<div class="network-actions">${this.button('Добавить ИИ','ai-add',seats.length>=8||bots.length>=6)}</div>`:''}</section><div class="network-settings-column"><section class="network-personal-panel release-panel"><p class="eyebrow">НА ЭТОМ УСТРОЙСТВЕ</p><h2>Ваш игрок</h2>
      <form id="network-profile"><label>Ваше имя<textarea aria-label="Ваше имя" name="name" maxlength="32" rows="2" required>${escape(own.name)}</textarea></label><label>Вид фигур<select aria-label="Вид фигур" name="tileStyle">${styleOptions(own.tileStyle)}</select></label>
      <label>Управление на этом устройстве<select aria-label="Управление на этом устройстве" id="network-controls"><option value="keyboard">WASD</option><option value="arrows">Стрелки</option><option value="touch">Касания</option><option value="gamepad">Геймпад 1</option><option value="gamepad-2">Геймпад 2</option><option value="gamepad-3">Геймпад 3</option><option value="tilt">Наклон и касания</option></select></label>${rules.mode==='team-battle'?`<div id="network-team">${this.teamSelect(own.teamId??'team-1','ownTeam')}</div>`:''}<button type="submit">Сохранить имя и фигуры</button></form>
      </section><section class="network-rules-panel release-panel"><p class="eyebrow">ДЛЯ ВСЕХ УЧАСТНИКОВ</p><h2>Правила матча</h2><form id="network-rules">${this.rulesFields(rules,!creator)}${creator?'<button type="submit">Применить правила</button>':''}</form></section></div></div>
      <div class="network-actions">${this.button(own.ready?'Снять готовность':'Готов','ready',!own.connected)}${creator?this.button('Начать','start',!canStart):''}${this.button('Покинуть','leave')}</div>`);
      this.root.querySelector<HTMLFormElement>('#network-profile')!.onsubmit=e=>{e.preventDefault();const v=Object.fromEntries(new FormData(e.currentTarget as HTMLFormElement));savePersonal({name:String(v.name),tileStyle:v.tileStyle as TileStyleSelection});session.send({type:'profile',name:String(v.name),tileStyle:v.tileStyle as TileStyleSelection});};
      this.root.querySelectorAll<HTMLFormElement>('[data-network-ai]').forEach(form=>form.onsubmit=e=>{e.preventDefault();const values=Object.fromEntries(new FormData(form));session.send({type:'ai-update',participantId:form.dataset.networkAi!,...values} as ClientCommand);});
      const style=this.root.querySelector<HTMLSelectElement>('#network-profile select[name="tileStyle"]')!;
      style.onchange=()=>savePersonal({tileStyle:style.value as TileStyleSelection});
      const team=this.root.querySelector<HTMLSelectElement>('#network-team select');if(team)team.onchange=()=>{savePersonal({teamId:team.value as 'team-1'|'team-2'});session.send({type:'team',teamId:team.value as 'team-1'|'team-2'});};
      const rulesForm=this.root.querySelector<HTMLFormElement>('#network-rules')!;
      rulesForm.onsubmit=e=>{e.preventDefault();const updated=this.formRules(rulesForm,rules);saveCreatorRules(updated);session.send({type:'rules',rules:updated});};
      const mode=rulesForm.querySelector<HTMLSelectElement>('[name="mode"]')!;
      const bindRuleChanges=()=>{rulesForm.querySelectorAll<HTMLSelectElement>('select').forEach(select=>select.onchange=()=>{
        const current=this.formRules(rulesForm,rules);
        const updated=select.name==='mode'?loadCreatorRules(mode.value as NetworkMode):current;
        saveCreatorRules(updated);session.send({type:'rules',rules:updated});
      });};if(creator)bindRuleChanges();
      const control=this.root.querySelector<HTMLSelectElement>('#network-controls')!;control.value=this.controls;
      control.onchange=()=>{this.controls=control.value as Controls;savePersonal({controls:this.controls});if(this.controls==='tilt')void this.enableTilt();};
    }
    if(this.view==='lobby')enhanceMenuSelects(this.root.querySelector<HTMLElement>('.network-screen')!);
    this.status(session.status);
  }
  private arena():void {
    if(!this.session?.snapshot)return;
    const identity=this.matchIdentity(this.session.snapshot);
    if(this.game&&this.arenaElement&&this.arenaRuntime&&this.arenaIdentity===identity) {
      this.root.replaceChildren(this.arenaElement);this.arenaRuntime.engine=this.session;
      this.view='arena';this.renderKey='';this.updateArena();
      this.game.scale.getParentBounds();this.game.scale.refresh();this.game.loop.wake();return;
    }
    this.destroyArena();this.view='arena';this.renderKey='';
    this.root.innerHTML=`<main class="network-arena arena-screen premium-surface">
      <header class="network-arena-heading arena-topline">
        <div class="arena-brand"><strong>BRICKS WAR</strong><output id="network-status" class="match-status network-status"></output></div>
        <div class="round-timer"><output id="network-clock" class="round-timer-value" aria-label="Время матча"></output><small>${MODE_LABELS[roomRules(this.session.snapshot.rules).mode].toUpperCase()}</small></div>
        <div class="arena-utilities"><button type="button" data-net-action="pause" class="pause-control" aria-label="Пауза"><span aria-hidden="true">Ⅱ</span><b>ПАУЗА</b></button></div>
      </header>
      <div class="network-stage game-stage" id="network-stage"><div id="network-canvas" class="game-canvas"></div>
        <div class="mobile-touch-zones network-mobile-zones" data-network-mobile-zones aria-label="Касания: внизу влево, ускорение и вправо; выше — поворот"><span class="mobile-touch-zone mobile-touch-zone-left" aria-hidden="true">←</span><span class="mobile-touch-zone mobile-touch-zone-down" aria-hidden="true">↓</span><span class="mobile-touch-zone mobile-touch-zone-right" aria-hidden="true">→</span></div>
        <div id="network-hud"></div><output id="network-countdown" class="countdown"></output>
        </div><div class="mobile-match-actions network-mobile-actions"><button type="button" data-net-action="pause" class="mobile-match-action" aria-label="Пауза"><span aria-hidden="true">Ⅱ</span></button><output id="network-mobile-clock" class="mobile-match-timer" aria-label="Время матча"></output></div>
      <output id="network-mobile-status" class="network-mobile-status" role="status" hidden></output>
      <div class="network-touch" hidden><button data-control="left" aria-label="Влево">←</button><button data-control="down" aria-label="Ускорить">↓</button><button data-control="right" aria-label="Вправо">→</button><button data-control="rotate" aria-label="Поворот">↻</button>${this.controls==='tilt'?this.button('Наклон','tilt'):''}</div>
      <div id="network-pause" class="pause-overlay" role="dialog" aria-modal="true" hidden></div></main>`;
    this.bind();
    const stage=this.root.querySelector<HTMLElement>('#network-stage')!;
    const touch=(event:PointerEvent,action?:string)=>{
      if(!isMobilePlayViewport()&&this.controls!=='touch'&&this.controls!=='tilt'&&event.pointerType!=='mouse')return;
      const rect=stage.getBoundingClientRect();const mapped=action??mobileTouchActionAt(event.clientX-rect.left,event.clientY-rect.top,rect.width,rect.height);
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);this.press(`pointer-${event.pointerId}`,mapped);event.preventDefault();
    };
    stage.onpointerdown=e=>touch(e);
    this.root.querySelectorAll<HTMLButtonElement>('[data-control]').forEach(button=>button.onpointerdown=e=>touch(e,button.dataset.control));
    [stage,...this.root.querySelectorAll<HTMLElement>('[data-control]')].forEach(el=>{
      el.onpointerup=e=>this.release(`pointer-${e.pointerId}`);el.onpointercancel=e=>this.release(`pointer-${e.pointerId}`);
      el.onlostpointercapture=e=>this.release(`pointer-${e.pointerId}`);
    });
    this.arenaElement=this.root.querySelector<HTMLElement>('.network-arena');this.arenaIdentity=identity;
    this.arenaRuntime={engine:this.session,input:new HumanInputRouter(),aiControllers:new Map(),get mobileSolo(){return isMobilePlayViewport();},onReady:()=>{},onState:()=>this.updateArena(),
      onLayout:layout=>{this.layout=layout;this.updateArena();},onFinished:()=>{}};
    const scene=new PlayScene(this.arenaRuntime);
    this.game=new Phaser.Game({type:Phaser.AUTO,parent:'network-canvas',backgroundColor:'#fff8e9',scale:{mode:Phaser.Scale.RESIZE,width:'100%',height:'100%'},scene:[scene],audio:{noAudio:true}});
  }
  private updateArena():void {
    const session=this.session;const snapshot=session?.snapshot;if(!session||!snapshot?.state||this.view!=='arena')return;
    this.status(session.status);
    const arena=this.root.querySelector<HTMLElement>('.network-arena')!;
    arena.classList.toggle('mobile-solo-arena',isMobilePlayViewport());
    const own=snapshot.state.participants.find(p=>p.config.id===snapshot.ownId)!;
    const presentation=session.state.participants[0]!;
    Object.assign(arena.dataset,{ownId:snapshot.ownId,total:String(snapshot.state.participants.length),phase:snapshot.state.phase,
      confirmedX:String(own.board.active?.x??''),presentedX:String(presentation.board.active?.x??''),spawnSerial:String(own.board.spawnSerial),
      presentedY:String(presentation.board.active?.y??''),presentedSpawn:String(presentation.board.spawnSerial),
      inputEpoch:String(snapshot.inputEpoch),inputAck:String(snapshot.inputAck),matchId:snapshot.matchId??'',tick:String(snapshot.tick),alive:String(own.board.alive),preparation:String(own.board.preparationRemainingMs)});
    for(const clock of this.root.querySelectorAll('#network-clock,#network-mobile-clock'))clock.textContent=formatClock(snapshot.state.isSurvival||snapshot.state.options.battleTimeMode==='until-victory'?snapshot.state.elapsedMs:snapshot.state.remainingMs??0);
    const countdown=this.root.querySelector<HTMLElement>('#network-countdown')!;
    countdown.textContent=snapshot.state.phase==='countdown'?String(Math.ceil(snapshot.state.countdownMs/1000)):'';
    const hud=this.root.querySelector<HTMLElement>('#network-hud')!;
    if(this.layout) {
      const key=JSON.stringify([this.layout,shieldInventoryKey(session.state),session.state.participants.map(p=>[p.config.id,p.config.label,p.score,p.board.alive,p.board.nextPiece.id,p.placedPieces,p.shieldCount,p.shieldCharge])]);
      if(hud.dataset.key!==key) {
        hud.dataset.key=key;
        hud.innerHTML=session.state.participants.map((p,i)=>{
          const card=this.layout!.participantCards![i]!;
          const slot=Number(p.config.controllerLabel??i);
          const palette=p.config.teamId?(p.config.teamId==='team-1'?1:2):Math.min(3,Math.max(0,slot))+1;
          const preview=i===0?nextPiecePreviewMarkup(p.board.nextPiece):'';
          const shields=i===0?shieldInventoryMarkup(p, session.state):'';
          return `<article class="hud-card network-field-card hud-palette-slot-${palette} ${i===0?'network-own-card':'network-mini-card'} ${card.cardWidth<=250?'is-compact':''} ${p.board.alive?'':'is-out'}" style="left:${card.x}px;top:${card.y}px;width:${card.cardWidth}px;height:${card.cardHeight}px;--network-header:${card.headerHeight}px;--player-name-color:${playerAccentForSlot(slot)}">
            <header class="network-field-heading" data-field="${p.config.id}"><div class="hud-identity"><strong>${escape(p.config.label)}${p.config.teamId?` · К${p.config.teamId==='team-2'?2:1}`:''}</strong></div><div class="hud-stats"><b>${p.score.toLocaleString('ru-RU')} очков</b>${i===0?`<span>${p.placedPieces} фигур</span>`:''}</div>${i===0?'':`<small>${p.board.alive?'В игре':'Выбыл'}</small>`}</header>${shields}${preview}${p.board.alive?'':'<b class="out-label">ВЫБЫЛ</b>'}</article>`;
        }).join('');
      }
    }
    this.root.querySelectorAll<HTMLElement>('.network-field-heading[data-field]').forEach(heading=>{
      const participant=session.state.participants.find(p=>p.config.id===heading.dataset.field);
      if(participant) Object.assign(heading.dataset,{activeX:String(participant.board.active?.x??''),spawnSerial:String(participant.board.spawnSerial)});
    });
    const overlay=this.root.querySelector<HTMLElement>('#network-pause')!;
    const paused=snapshot.state.phase==='paused';overlay.hidden=!paused;
    this.root.querySelectorAll<HTMLButtonElement>('[data-control]').forEach(b=>b.disabled=paused||!session.acceptsGameplayInput());
    if(paused) {
      const absent=snapshot.seats.filter(s=>s.retained&&s.absence);
      const pauser=snapshot.seats.find(s=>s.id===snapshot.manualPausedBy);
      const eligible=!!snapshot.manualPausedBy&&(snapshot.manualPausedBy===snapshot.ownId||snapshot.creatorId===snapshot.ownId);
      const renderKey=JSON.stringify([snapshot.manualPausedBy,snapshot.creatorId,snapshot.ownId,
        absent.map(s=>[s.id,s.name,Math.ceil(s.absence!.remainingMs/1000),s.absence!.blocksGameplay]),pauser?.name]);
      const html=`<section class="network-pause-panel"><h2>Матч на паузе</h2>${pauser?`<p>Пауза: ${escape(pauser.name)}</p>`:''}<div class="network-absences">${absent.map(s=>`<article><span>${escape(s.name)} · ${Math.ceil(s.absence!.remainingMs/1000)} с${s.absence!.blocksGameplay?'':' · наблюдатель'}</span>${snapshot.creatorId===snapshot.ownId&&s.id!==snapshot.creatorId?this.button('Исключить и продолжить',`exclude:${s.id}`):''}</article>`).join('')}</div><div class="network-actions">${this.controls==='tilt'?this.button('Настроить наклон','tilt'):''}${eligible?this.button('Продолжить','resume'):snapshot.manualPausedBy?'<p>Продолжить могут поставивший паузу и создатель.</p>':''}${this.button('К списку','list')}</div></section>`;
      if(overlay.dataset.renderKey!==renderKey){overlay.innerHTML=html;overlay.dataset.renderKey=renderKey;this.bind();}
    } else delete overlay.dataset.renderKey;
  }
  private press(source:string,action:string):void {
    if(this.blocked.has(source)||this.sources.has(source))return;
    if(!this.session?.acceptsGameplayInput()){this.blocked.add(source);return;}
    this.sources.set(source,action);this.sendControls(action==='rotate');
  }
  private release(source:string):void {this.blocked.delete(source);this.sources.delete(source);this.sendControls();}
  private sendControls(rotate=false):void {
    const held:HeldControls={...EMPTY_HELD};for(const action of this.sources.values())if(action in held)held[action as keyof HeldControls]=true;
    this.session?.controls(held,rotate);
  }
  private keyDown=(e:KeyboardEvent)=>{
    if(this.view!=='arena'||(e.target as HTMLElement).matches('input,select,textarea'))return;
    if(e.code==='Escape'&&!e.repeat){this.session?.toggleManualPause();e.preventDefault();return;}
    const map:Record<string,string>={KeyA:'left',ArrowLeft:'left',KeyD:'right',ArrowRight:'right',KeyS:'down',ArrowDown:'down',KeyW:'rotate',ArrowUp:'rotate'};
    if(map[e.code]&&((this.controls==='keyboard'&&e.code.startsWith('Key'))||(this.controls==='arrows'&&e.code.startsWith('Arrow')))){if(!e.repeat)this.press(e.code,map[e.code]!);e.preventDefault();}
  };
  private keyUp=(e:KeyboardEvent)=>{this.release(e.code);};
  private sensor=(e:DeviceOrientationEvent)=>{this.orientation=e;};
  private async enableTilt():Promise<void> {
    const orientation=DeviceOrientationEvent as typeof DeviceOrientationEvent & {requestPermission?:()=>Promise<string>};
    if(orientation.requestPermission && await orientation.requestPermission()!=='granted'){this.status('Доступ к наклону не разрешён. Используйте касания.');return;}
    if(this.orientation)this.tilt.calibrate(this.orientation);this.tiltEnabled=true;this.status('Наклон включён. Держите устройство удобно.');
  }
  private poll=()=>{
    if(this.destroyed)return;
    if(this.view==='arena'&&this.session) {
      if(this.controls.startsWith('gamepad')) {
        const gamepad=Array.from(navigator.getGamepads?.()??[]).filter(p=>p?.connected)[this.controls==='gamepad-3'?2:this.controls==='gamepad-2'?1:0];
        const c=gamepad?gamepadControls(gamepad):null;
        for(const key of ['left','right','down','rotate'] as const)if(c?.[key])this.press(`pad-${key}`,key);else this.release(`pad-${key}`);
        const pause=gamepad?.buttons[9]?.pressed??false;if(pause&&!this.gamepadPause)this.session.toggleManualPause();this.gamepadPause=pause;
      }
      if(this.controls==='tilt'&&this.tiltEnabled) {
        const c=this.tilt.update(this.orientation,16.7);
        for(const key of ['left','right','down','rotate'] as const)if(c?.[key])this.press(`tilt-${key}`,key);else this.release(`tilt-${key}`);
      }
    }
    this.frame=requestAnimationFrame(this.poll);
  };
  destroy():void {
    this.destroyed=true;clearInterval(this.timer);cancelAnimationFrame(this.frame);this.destroyArena();this.session?.dispose();
    window.removeEventListener('keydown',this.keyDown);window.removeEventListener('keyup',this.keyUp);window.removeEventListener('deviceorientation',this.sensor);this.root.classList.remove('network-root');
  }
}
