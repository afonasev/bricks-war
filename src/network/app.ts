import { WORKSHOP_THEME_TEXTURES } from '../rendering/workshopSprites';
import { gamepadFooterHintsMarkup } from '../ui/gamepadFooterHints';
import {MenuFocusController} from '../ui/menuNavigation';
import {loadReleaseSettings} from '../ui/releaseSettings';
import { clientUpdate } from '../pwa/clientUpdate';
import { MatchLoading } from '../ui/matchLoading';
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
import { NETWORK_MODES, roomRules, balancedNetworkTeams, type ResolvedRoomRules } from './rules';
import { loadPersonal, savePersonal, loadCreator, loadCreatorRules, saveCreatorRules, saveCreatorRoom, saveCreatorBots, type NetworkControls } from './setupPersistence';
import type { NetworkMode } from './protocol';
import { teamScores } from '../simulation/competition';
import { decodeMatchState } from '../simulation/match';
import type { GameAudio } from '../audio/GameAudio';
import { html as tr, text as localeText, getLocale } from '../i18n/locale';
import { localizedNetworkMessage, networkText, networkUiText, networkAiName, networkAiDifficulty } from './presentationCopy';
import type { NetworkUiKey } from '../i18n/networkUiCatalogs';
import './lobbyRoster.css';
import './workshopMenus.css';
import logo from '../assets/brand/concept-logo.webp';
import { MAIN_MENU_PREVIEWS } from '../ui/mainMenuPreview';
const escape=(v:string)=>v.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const u=(key:NetworkUiKey,values?:Record<string,string|number>)=>networkUiText(key,getLocale(),values);
const h=(key:NetworkUiKey,values?:Record<string,string|number>)=>escape(u(key,values));
const aiLabels=()=>({easy:networkAiDifficulty('easy'),medium:networkAiDifficulty('medium'),hard:networkAiDifficulty('hard'),expert:networkAiDifficulty('expert')});
const seatName=(s:PublicSeat)=>networkAiName(s.kind,s.name,s.difficulty??undefined);
const tileStyleKeys={random:'tileRandom',classic:'tileClassic','sea-crystals':'tileClassic','construction-bricks':'tileBricks','pixel-adventure':'tilePixel','stone-fortress':'tileStone',marmalade:'tileMarmalade','forest-mosaic':'tileForest'} as const;
const modeLabels={survival:'survival',battle:'battle','team-battle':'team'} as const;
const styleOptions=(selected:TileStyleSelection)=>[...TILE_STYLES.map(t=>({id:t.id as string,label:localeText(tileStyleKeys[t.id])})),{id:'random',label:localeText('tileRandom')}].map(t=>`<option value="${t.id}" ${t.id===selected?'selected':''}>${escape(t.label)}</option>`).join('');
const phaseLabels={waiting:'waiting',countdown:'countdown',playing:'playing',paused:'networkPaused',results:'networkResults'} as const;
type Controls = NetworkControls;
export class NetworkApp {
  private menuFocus:MenuFocusController;
  private session:NetworkMatchSession|null=null;
  private audioGeneration:string|null=null;
  private credential=loadCredential();
  private game:Phaser.Game|null=null;
  private matchLoading:MatchLoading|null=null;
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
  private arenaLanguage=getLocale();
  constructor(private root:HTMLElement,private onMenu:()=>void,private audio?:Pick<GameAudio,'syncNetworkAnomalies'|'syncMusic'|'enterMenu'>,private preferences?:(onClose:()=>void)=>void) {
    this.root.classList.add('network-root');
    this.menuFocus=new MenuFocusController(root,{onBack:()=>{const displayCancel=this.root.querySelector<HTMLButtonElement>('[data-display-no]');if(displayCancel){displayCancel.click();return;}const close=this.root.querySelector<HTMLButtonElement>('[data-network-prefs-back]');if(close)close.click();else void this.action(this.view==='list'?'menu':'list');},onInputMode:mode=>{this.root.dataset.inputMode=mode;}});
    window.addEventListener('keydown',this.keyDown);window.addEventListener('keyup',this.keyUp);
    window.addEventListener('deviceorientation',this.sensor);
    this.timer=setInterval(()=>{if(this.view==='list')void this.refreshList();},2000);
    void this.showList();this.frame=requestAnimationFrame(this.poll);
  }
  private button(label:string,action:string,disabled=false):string {return `<button type="button" data-net-action="${action}" ${disabled?'disabled':''}>${escape(label)}</button>`;}
  private shell(title:string,body:string):void {
    this.root.innerHTML=`<main class="network-screen network-workshop release-screen premium-surface mode-setup-screen" data-network-view="${this.view}"><header class="network-heading release-heading"><button type="button" class="screen-back" data-net-action="${this.view==='list'?'menu':'list'}" aria-label="${this.view==='list'?tr('menu'):escape(networkText('backToRooms'))}">← ${this.view==='list'?tr('menu'):escape(networkText('backToRooms'))}</button><img class="network-brand" src="${logo}" alt="Bricks War"><div><p class="eyebrow">${h('networkMark')}</p><h1>${title}</h1></div></header><output class="network-status" role="status" id="network-status"></output><div class="network-content">${body}</div><footer class="menu-metadata-footer">${gamepadFooterHintsMarkup()}</footer></main>`;
    this.bind();
  }
  private bind():void {
    this.root.querySelectorAll<HTMLButtonElement>('[data-net-action]').forEach(button=>button.onclick=()=>void this.action(button.dataset.netAction!));
    this.activateNavigation();
  }
  activateNavigation():void {
    this.root.querySelectorAll<HTMLElement>('button,input,select,textarea,summary').forEach(el=>el.dataset.uiFocus='');
    if(this.view!=='arena'||this.root.querySelector('#network-pause:not([hidden]),[data-network-preferences],[data-display-confirm]'))this.menuFocus.activate('network');else this.menuFocus.suspend();
  }
  private status(message:string):void {
    const text=localizedNetworkMessage(message)+(this.storageAvailable?'':` · ${networkText('browserStorageWarning')}`);
    for(const element of this.root.querySelectorAll<HTMLElement>('#network-status,#network-mobile-status')){element.textContent=text;if(element.id==='network-mobile-status')element.hidden=message==='Подключено'&&this.storageAvailable;}
  }
  private async action(action:string):Promise<void> {
    try {
      if(action==='preferences'){const language=getLocale();this.sources.clear();this.sendControls();this.preferences?.(()=>{if(this.view==='list'&&language!==getLocale())void this.showList();else this.activateNavigation();});this.activateNavigation();return;}
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
    } catch(error){this.status(error instanceof Error?error.message:networkText('actionFailed'));}
  }
  private destroyArena():void {
    this.matchLoading?.cancel();this.matchLoading=null;
    const game=this.game;this.game=null;this.arenaElement=null;this.arenaRuntime=null;this.arenaIdentity=null;this.layout=null;
    if(game){game.destroy(true);if(game.isBooted)game.loop.tick();}
  }
  private matchIdentity(snapshot:ClientSnapshot):string {
    return JSON.stringify([snapshot.serviceId,snapshot.room.id,snapshot.ownId,snapshot.matchId]);
  }
  private async showList():Promise<void> {
    await clientUpdate.setActivity(true);
    this.matchLoading?.cancel();this.matchLoading=null;
    if(this.game&&this.view==='arena') {
      this.game.loop.sleep();this.arenaElement?.remove();
      for(const source of this.sources.keys())this.blocked.add(source);this.sources.clear();
    }
    this.session?.dispose();this.session=null;this.view='list';this.renderKey='';
    this.shell(networkText('online'),`<section id="network-current"></section><section class="network-list-toolbar release-panel"><div><h2>${h('roomsHeading')}</h2><p>${h('modeList')} · ${networkText('upToEight')}</p></div><div class="network-actions">${this.button(networkText('createRoom'),'create')}${this.button(networkText('refresh'),'retry')}${this.button(networkText('networkSettings'),'preferences')}</div></section><section id="network-lobbies" aria-label="${escape(networkText('lobbyList'))}"></section>`);
    await this.refreshList();
  }
  private async refreshList():Promise<void> {
    if(this.listBusy||this.destroyed)return;this.listBusy=true;
    try {
      const list=await networkRequest<{rooms:LobbySummary[];next:number|null}>(`lobbies?offset=${this.listOffset}`);
      if(this.view!=='list'||this.destroyed)return;
      const container=this.root.querySelector<HTMLElement>('#network-lobbies')!;
      const roomsMarkup=(list.rooms.length?list.rooms.map(room=>this.roomRow(room)).join(''):`<p class="network-empty release-panel">${escape(networkText('noRooms'))}</p>`)
        +`<div class="network-actions network-pagination">${this.listOffset?this.button(u('previousPage'),`page:${Math.max(0,this.listOffset-50)}`):''}${list.next!==null?this.button(u('nextPage'),`page:${list.next}`):''}</div>`;
      // Do not detach the focused room button on an unchanged polling response.
      if(container.dataset.markup!==roomsMarkup){container.innerHTML=roomsMarkup;container.dataset.markup=roomsMarkup;this.bind();}
      const current=this.root.querySelector<HTMLElement>('#network-current')!;
      if(this.credential) {
        try {
          const snapshot=await networkRequest<ClientSnapshot>('current',{credential:this.credential});
          if(this.view!=='list')return;
          if(!snapshot.state||snapshot.state.phase==='results'||this.arenaIdentity!==this.matchIdentity(snapshot))this.destroyArena();
          const own=snapshot.seats.find(s=>s.id===this.credential?.participantId);
          this.currentRoomMarkup(current,`<article class="network-current"><h2>${escape(networkText('statusCurrent'))}</h2><p>${escape(snapshot.room.name)} · ${networkText(phaseLabels[snapshot.room.phase])}${own?.absence?` · ${h('returnCountdown',{seconds:Math.ceil(own.absence.remainingMs/1000)})}`:''}</p>${this.button(u('returnButton'),'return')}</article>`);
        } catch(error) {
          if(['auth','ended'].includes((error as {code?:string}).code??'')){this.destroyArena();this.credential=null;storeCredential(null);setNetworkParticipation(false);this.currentRoomMarkup(current,`<p>${escape(networkText('returnExpired'))}</p>`);this.bind();return;}
          this.currentRoomMarkup(current,`<article class="network-current"><h2>${escape(networkText('statusCurrent'))}</h2><p>${escape(networkText('returnPending'))}</p>${this.button(networkText('retryReturn'),'return')}</article>`);
          this.status(error instanceof Error?error.message:networkText('noConnection'));
        }
      } else this.currentRoomMarkup(current,'');
      this.status(networkText('listUpdated'));
    }catch{if(this.view==='list'){const rooms=this.root.querySelector<HTMLElement>('#network-lobbies')!;rooms.innerHTML='';delete rooms.dataset.markup;this.status(networkText('serviceUnavailable'));}}
    finally{this.listBusy=false;}
  }
  private currentRoomMarkup(element:HTMLElement,markup:string):void {
    if(element.dataset.markup===markup)return;
    const focused=element.contains(document.activeElement);
    element.innerHTML=markup;element.dataset.markup=markup;
    element.querySelectorAll<HTMLButtonElement>('[data-net-action]').forEach(button=>{
      button.dataset.uiFocus='';button.onclick=()=>void this.action(button.dataset.netAction!);
    });
    if(focused)element.querySelector<HTMLButtonElement>('button')?.focus({preventScroll:true});
  }
  private roomRow(room:LobbySummary):string {
    const mode=room.mode??'survival';
    const unavailable=room.phase!=='waiting'||room.count>=room.capacity;
    const state=room.phase!=='waiting'?networkText(phaseLabels[room.phase]):room.count>=room.capacity?u('roomFullLabel'):networkText('waiting');
    return `<article class="network-lobby"><div class="network-mode-art" style="--network-mode-art:url('${MAIN_MENU_PREVIEWS[mode].image}')" aria-hidden="true"><span>${localeText(modeLabels[mode])}</span></div><div class="network-room-copy"><h2>${escape(room.name)}</h2><p>${room.protected?h('roomProtected'):h('roomOpen')}</p></div><div class="network-room-state"><b>${escape(state)}</b><span>${room.count}/${room.capacity}</span></div><button type="button" data-net-action="join:${room.id}" ${unavailable||!!this.credential?'disabled':''}>${escape(unavailable?state:networkText('networkJoin'))}</button></article>`;
  }
  private piecePreview(style:TileStyleSelection):string {
    const texture=WORKSHOP_THEME_TEXTURES[style==='random'?'classic':style];
    return `<div class="network-piece-well" aria-hidden="true"><span class="network-piece" style="--network-atlas:url('${texture.url}')">${[0,1,2,4].map((i,n)=>`<i style="left:${i%3*33.333}%;top:${Math.floor(i/3)*50}%;background-position:${[0,100,0,50][n]}% ${[0,0,50,50][n]}%"></i>`).join('')}${style==='random'?'<b>?</b>':''}</span></div><p class="network-piece-label">${localeText(tileStyleKeys[style])}</p>`;
  }
  private personalFields(own:PublicSeat,rules:ResolvedRoomRules):string {
    return `<details class="network-personal-panel"><summary>${h('configurePlayer')}</summary><form id="network-profile"><label>${escape(networkText('yourName'))}<textarea aria-label="${escape(networkText('yourName'))}" name="name" maxlength="32" rows="2" required>${escape(own.name)}</textarea></label><label>${h('pieceStyle')}<select data-menu-select-layout="style-list" aria-label="${h('pieceStyle')}" name="tileStyle">${styleOptions(own.tileStyle)}</select></label><label>${h('deviceControls')}<select aria-label="${h('deviceControls')}" id="network-controls"><option value="keyboard">WASD</option><option value="arrows">${h('arrows')}</option><option value="touch">${h('touch')}</option><option value="gamepad">${h('gamepad',{number:1})}</option><option value="gamepad-2">${h('gamepad',{number:2})}</option><option value="gamepad-3">${h('gamepad',{number:3})}</option><option value="tilt">${h('tiltTouch')}</option></select></label>${rules.mode==='team-battle'?`<div id="network-team">${this.teamSelect(own.teamId??'team-1','ownTeam')}</div>`:''}<button type="submit">${h('saveProfile')}</button></form></details>`;
  }
  private rulesFields(rules:ResolvedRoomRules, disabled=false):string {
    const select=(name:string,label:string,choices:readonly (readonly [string,string])[],value:string)=>`<label>${escape(label)}<select aria-label="${escape(label)}" name="${name}" ${disabled?'disabled':''}>${choices.map(([v,l])=>`<option value="${v}" ${v===value?'selected':''}>${escape(l)}</option>`).join('')}</select></label>`;
    return select('mode',u('mode'),NETWORK_MODES.map(v=>[v,localeText(modeLabels[v])]),rules.mode)
      +select('battleDifficulty',u('battleTempo'),[['family',u('family')],['normal',u('normal')],['sport',u('sport')]],rules.battleDifficulty)
      +(rules.mode==='survival'?'':select('softDrop',u('softDrop'),[['slow',u('slow')],['fast',u('fast')],['very-fast',u('veryFast')]],rules.softDrop))
      +(rules.mode==='survival'?'':select('battleTimeMode',u('duration'),[['until-victory',u('untilVictory')],['timed',u('timed')]],rules.battleTimeMode)
      +(rules.battleTimeMode==='timed'?select('durationMinutes',u('minutes'),Array.from({length:9},(_,i)=>[String(i+2),String(i+2)]),String(rules.durationMinutes)):'')
      +select('pressure',u('pressure'),[['automatic',u('automatic')],['fixed',u('fixed')],['extended',u('extended')]],rules.pressure)
      +select('conflictEnabled',u('attacks'),[['true',u('enabled')],['false',u('disabled')]],String(rules.conflictEnabled))
      +(rules.mode==='team-battle'?'':select('conflictTargeting',u('attackTarget'),[['all-opponents',u('allOpponents')],['hunt-leader',u('leader')]],rules.conflictTargeting)));
  }
  private formRules(form:HTMLFormElement, fallback:ResolvedRoomRules):ResolvedRoomRules {
    const values=Object.fromEntries(new FormData(form));
    return roomRules({...fallback,...values,conflictEnabled:values.conflictEnabled===undefined?fallback.conflictEnabled:values.conflictEnabled==='true',durationMinutes:values.durationMinutes===undefined?fallback.durationMinutes:Number(values.durationMinutes)} as ResolvedRoomRules);
  }
  private createForm():void {
    this.view='create';const creator=loadCreator();const personal=loadPersonal(this.controls);let rules=loadCreatorRules(creator.mode);
    this.shell(networkText('createRoom'),`<form id="network-form"><label>${escape(networkText('roomName'))}<textarea aria-label="${escape(networkText('roomName'))}" name="roomName" required maxlength="32" rows="2">${escape(creator.roomName)}</textarea></label><label>${escape(networkText('yourName'))}<textarea aria-label="${escape(networkText('yourName'))}" name="name" required maxlength="32" rows="2">${escape(personal.name)}</textarea></label><label>${escape(networkText('passwordOptional'))}<input name="password" type="password" maxlength="64" autocomplete="new-password"></label><section id="network-create-rules">${this.rulesFields(rules)}</section><div class="network-actions"><button type="submit" ${this.credential?'disabled':''}>${h('createSubmit')}</button>${this.button(networkText('backToRooms'),'list')}</div></form>`);
    const form=this.root.querySelector<HTMLFormElement>('form')!;
    const bindRules=()=>{this.root.querySelectorAll<HTMLSelectElement>('#network-create-rules select').forEach(control=>control.onchange=()=>{
      const mode=control.name==='mode'?control.value as NetworkMode:rules.mode;
      const updated=this.formRules(form,rules);saveCreatorRules({...updated,mode:rules.mode});
      rules=mode!==rules.mode?loadCreatorRules(mode):updated;saveCreatorRules(rules);
      this.root.querySelector('#network-create-rules')!.innerHTML=this.rulesFields(rules);bindRules();enhanceMenuSelects(this.root);
    });};bindRules();enhanceMenuSelects(this.root);
    form.onsubmit=event=>{event.preventDefault();void this.submit('create',rules);};
    if(this.credential)this.status(u('leaveFirst'));
  }
  private joinForm(roomId:string):void {
    this.view='join';
    this.shell(networkText('networkJoin'),`<form id="network-form"><input type="hidden" name="roomId" value="${escape(roomId)}"><label>${escape(networkText('yourName'))}<input name="name" required maxlength="32" value="${escape(loadPersonal(this.controls).name)}"></label><label>${escape(networkText('passwordClosed'))}<input name="password" type="password" maxlength="64" autocomplete="current-password"></label><div class="network-actions"><button type="submit">${escape(networkText('networkJoin'))}</button>${this.button(networkText('backToRooms'),'list')}</div></form>`);
    this.root.querySelector<HTMLFormElement>('form')!.onsubmit=event=>{event.preventDefault();void this.submit('join');};
  }
  private async submit(path:string,rules?:ResolvedRoomRules):Promise<void> {
    await clientUpdate.setActivity(false);
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
      if(!stored)this.status(u('storageWarning'));
    }catch(error){this.status(error instanceof Error?error.message:networkText('connectFailed'));button.disabled=false;}
  }
  private attach(credential:Credential):void {
    this.session?.dispose();const session=new NetworkMatchSession(credential);this.session=session;
    this.view='connecting';this.renderKey='';this.shell(u('connectingTitle'),this.button(networkText('backToRooms'),'list'));
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
  private teamSelect(teamId:string,name:string):string {return `<label>${h('team')}<select aria-label="${h('team')}" name="${name}"><option value="team-1" ${teamId==='team-1'?'selected':''}>${h('teamNumber',{number:1})}</option><option value="team-2" ${teamId==='team-2'?'selected':''}>${h('teamNumber',{number:2})}</option></select></label>`;}
  private seatState(seat:PublicSeat):string {
    return seat.kind==='ai'?u('autoReady'):`${seat.connected?seat.ready?u('ready'):u('notReady'):u('returning')}${seat.absence?` · ${h('seconds',{seconds:Math.ceil(seat.absence.remainingMs/1000)})}`:''}`;
  }
  private rosterSeat(s:PublicSeat,index:number,snapshot:ClientSnapshot,creator:boolean):string {
    const ai=s.kind==='ai';
    const roles=ai?`${tr('aiLabel')} · ${escape(aiLabels()[s.difficulty!])}`:[s.id===snapshot.ownId?u('you'):'',s.id===snapshot.creatorId?u('creator'):''].filter(Boolean).join(' · ');
    const state=this.seatState(s);
    const editor=ai&&creator?`<details class="network-ai-editor"><summary>${h('configureAi')}</summary><form data-network-ai="${s.id}"><label>${h('aiDifficulty')}<select aria-label="${h('aiDifficulty')}" name="difficulty">${Object.entries(aiLabels()).map(([v,l])=>`<option value="${v}" ${v===s.difficulty?'selected':''}>${escape(l)}</option>`).join('')}</select></label><label>${h('aiStyle')}<select data-menu-select-layout="style-list" aria-label="${h('aiStyle')}" name="tileStyle">${styleOptions(s.tileStyle)}</select></label>${roomRules(snapshot.rules).mode==='team-battle'?this.teamSelect(s.teamId??'team-1','teamId'):''}<div class="network-ai-actions"><button type="submit">${h('saveAi')}</button>${this.button(u('removeAi'),`ai-remove:${s.id}`)}</div></form></details>`:'';
    const own=s.id===snapshot.ownId;
    return `<li data-seat-id="${s.id}" data-kind="${s.kind}" data-own="${own}" data-team="${s.teamId??''}" data-ready="${ai||s.ready&&s.connected}"><div class="network-seat-heading"><span class="network-seat-number" aria-hidden="true">${index+1}</span><span>${ai?tr('aiLabel'):own?h('you'):''}</span></div><div class="network-seat-copy"><strong>${escape(seatName(s))}</strong><small>${[roles,roomRules(snapshot.rules).mode==='team-battle'?h('teamNumber',{number:s.teamId==='team-2'?2:1}):''].filter(Boolean).join(' · ')}</small><span class="network-seat-state">${state}</span></div>${own?`<button type="button" class="network-card-ready" data-net-action="ready" aria-pressed="${s.ready}" aria-label="${s.ready?h('unready'):h('ready')}" ${!s.connected?'disabled':''}>${s.ready?'✓ '+h('youReady'):h('ready')}${s.ready?`<small>${h('cancelReadyHint')}</small>`:''}</button>`:''}${this.piecePreview(s.tileStyle)}${own?this.personalFields(s,roomRules(snapshot.rules)):''}${editor}</li>`;

  }
  private rosterMarkup(seats:PublicSeat[],snapshot:ClientSnapshot,creator:boolean,rules:ResolvedRoomRules):string {
    const list=(group:PublicSeat[])=>`<ul class="network-roster" data-mode="${rules.mode}">${group.map(s=>this.rosterSeat(s,seats.indexOf(s),snapshot,creator)).join('')}</ul>`;
    const roster=rules.mode==='team-battle'?['team-1','team-2'].map((id,i)=>`<section class="network-team-group" data-team="${id}"><h3>${h('teamNumber',{number:i+1})}</h3>${list(seats.filter(s=>s.teamId===id))}</section>`).join(''):list(seats);
    return `<div class="network-roster-area" data-teams="${rules.mode==='team-battle'}">${roster}${creator?`<div class="network-empty-seat"><span aria-hidden="true">＋</span>${this.button(u('addAi'),'ai-add',seats.length>=8||seats.filter(s=>s.kind==='ai').length>=6)}<p>${h('freeSeat')}</p></div>`:''}</div>`;
  }
  private renderSession():void {
    const session=this.session;const snapshot=session?.snapshot;
    if(!session)return;
    if(!session.active){this.destroyArena();this.view='ended';this.credential=null;
      this.shell(networkText('sessionEnded'),`<p>${escape(localizedNetworkMessage(session.status))}</p>${this.button(networkText('backToRooms'),'list')}`);return;}
    if(!snapshot){this.status(session.status);return;}
    if(snapshot.state) {
      const generation=`${snapshot.matchId}:${snapshot.connectionEpoch}`;
      const decodedState=decodeMatchState(snapshot.state);
      this.audio?.syncNetworkAnomalies(decodedState,generation!==this.audioGeneration);
      if(snapshot.matchId)this.audio?.syncMusic(decodedState,snapshot.matchId,decodedState.seed);
      this.audioGeneration=generation;
    } else { this.audioGeneration=null; this.audio?.enterMenu(); }
    if(snapshot.state && snapshot.state.phase!=='results') {
      if(this.view!=='arena'&&this.view!=='preparing')this.arena();
      if(snapshot.state.phase==='paused'||session.status!=='Подключено')this.matchLoading?.suppress();
      this.updateArena();return;
    }
    this.destroyArena();
    // Countdown samples change at publication frequency; preserve open menus and unsaved forms.
    const seatsKey=snapshot.seats.map(seat=>({...seat,absence:seat.absence?{episodeId:seat.absence.episodeId,blocksGameplay:seat.absence.blocksGameplay}:null}));
    const key=JSON.stringify([snapshot.room.phase,seatsKey,snapshot.rules,snapshot.creatorId]);
    if(key===this.renderKey){
      for(const seat of snapshot.seats){
        const text=this.root.querySelector<HTMLElement>(`[data-seat-id="${seat.id}"] .network-seat-state`);
        if(text && text.textContent!==this.seatState(seat))text.textContent=this.seatState(seat);
      }
      this.status(session.status);return;
    }
    this.renderKey=key;
    const lobbyPresentation=this.view==='lobby'?{profileOpen:this.root.querySelector('.network-personal-panel')?.hasAttribute('open')??false,scrollTop:this.root.querySelector('.network-content')?.scrollTop??0}:null;
    if(snapshot.state?.phase==='results') {
      this.view='results';
      this.shell(networkText('networkResults'),`${snapshot.state.options.matchVariant==='teams'?`<p>${teamScores(snapshot.state.participants.map(p=>({id:p.config.id,score:p.score,alive:p.board.alive,teamId:p.config.teamId}))).map(t=>`${h('teamNumber',{number:t.teamId==='team-2'?2:1})}: ${h('points',{count:t.score})}`).join(' · ')}</p>`:''}<ol class="network-roster">${[...snapshot.state.participants].sort((a,b)=>a.placement!-b.placement!||b.score-a.score).map(p=>`<li><strong>${p.placement}. ${escape(networkAiName(p.config.controller==='ai'?'ai':'human',p.config.label,p.config.difficulty))}${p.config.controller==='ai'?` · ${tr('aiLabel')}`:''}${p.config.teamId?` · ${h('teamNumber',{number:p.config.teamId==='team-2'?2:1})}`:''}${snapshot.state!.winnerIds.includes(p.config.id)?` · ${h('victory')}`:''}</strong><span>${h('points',{count:p.score})} · ${formatClock(p.survivalMs)}</span></li>`).join('')}</ol><div class="network-actions">${this.button(u('toLobby'),'lobby')}${this.button(networkText('leave'),'leave')}</div>`);
    } else {
      this.view='lobby';
      const creator=snapshot.creatorId===snapshot.ownId;
      const seats=snapshot.seats.filter(s=>s.retained);const humans=seats.filter(s=>s.kind==='human');const bots=seats.filter(s=>s.kind==='ai');
      const rules=roomRules(snapshot.rules);
      const canStart=(rules.mode!=='team-battle'||balancedNetworkTeams(seats))&&humans.length>=2&&seats.length<=8&&humans.every(s=>s.ready&&s.connected&&!s.absence);
      const pending=humans.filter(s=>!s.ready||!s.connected||s.absence);
      const startReason=humans.length<2?networkText('minTwo'):rules.mode==='team-battle'&&!balancedNetworkTeams(seats)?u('equalTeams'):pending.length?u('waitReady',{names:pending.map(s=>s.name).join(', ')}):u('startReady');
      this.shell(escape(snapshot.room.name),`<section class="network-rules-panel release-panel"><div class="network-mode-art" style="--network-mode-art:url('${MAIN_MENU_PREVIEWS[rules.mode].image}')" aria-hidden="true"><span>${localeText(modeLabels[rules.mode])}</span></div><div class="network-shared-rules"><p class="eyebrow">${h('allParticipants')}</p><form id="network-rules">${this.rulesFields(rules,!creator)}${creator?`<button type="submit">${h('applyRules')}</button>`:''}</form><p class="network-rules-owner">${h('rulesOwner')}</p></div></section><div class="network-roster-heading"><h2>${h('participants',{count:seats.length})}</h2><p>${h('rosterHint',{humans:humans.length,bots:bots.length})}</p></div>${this.rosterMarkup(seats,snapshot,creator,rules)}<footer class="network-lobby-footer"><p class="network-start-reason" role="status">${escape(startReason)}</p><div class="network-actions">${this.button(networkText('leave'),'leave')}${creator?this.button(u('start'),'start',!canStart):''}</div></footer>`);
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
    if(this.view==='lobby'){
      const profile=this.root.querySelector<HTMLDetailsElement>('.network-personal-panel');
      if(profile&&lobbyPresentation?.profileOpen)profile.open=true;
      enhanceMenuSelects(this.root.querySelector<HTMLElement>('.network-screen')!);
      const content=this.root.querySelector('.network-content');
      if(content&&lobbyPresentation)content.scrollTop=lobbyPresentation.scrollTop;
    }
    this.status(session.status);
  }
  private arena():void {
    const session=this.session;if(!session?.snapshot)return;
    const identity=this.matchIdentity(session.snapshot);
    if(this.game&&this.arenaIdentity===identity){this.buildArena();return;}
    this.destroyArena();this.view='preparing';
    const loading=new MatchLoading(this.root,()=>this.destroyArena());this.matchLoading=loading;
    void clientUpdate.setActivity(false).then(() => loading.painted()).then(painted=>{
      if(!painted||this.matchLoading!==loading||this.session!==session||!session.snapshot)return;
      if(this.matchIdentity(session.snapshot)!==identity){this.destroyArena();this.view='lobby';this.renderSession();return;}
      this.buildArena();this.updateArena();
    }).catch(error=>{
      if(this.matchLoading!==loading)return;
      this.destroyArena();this.view='ended';
      this.shell(networkText('gamePreparingFailed'), `<p>${escape(networkText('tryRoomAgain'))}</p>${this.button(u('toList'),'list')}`);
      this.status(error instanceof Error?error.message:u('prepareError'));
    });
  }
  private buildArena():void {
    if(!this.session?.snapshot)return;
    const identity=this.matchIdentity(this.session.snapshot);
    if(this.game&&this.arenaElement&&this.arenaRuntime&&this.arenaIdentity===identity) {
      this.root.replaceChildren(this.arenaElement);this.arenaRuntime.engine=this.session;
      this.view='arena';this.menuFocus.suspend();this.renderKey='';this.updateArena();
      this.game.scale.getParentBounds();this.game.scale.refresh();this.game.loop.wake();return;
    }
    this.view='arena';this.menuFocus.suspend();this.renderKey='';
    this.root.innerHTML=`<main class="network-arena arena-screen premium-surface">
      <header class="network-arena-heading arena-topline">
        <div class="arena-brand"><strong>BRICKS WAR</strong><output id="network-status" class="match-status network-status"></output></div>
        <div class="round-timer"><output id="network-clock" class="round-timer-value" aria-label="${h('matchTime')}"></output><small>${localeText(modeLabels[roomRules(this.session.snapshot.rules).mode]).toLocaleUpperCase(getLocale())}</small></div>
        <div class="arena-utilities"><button type="button" data-net-action="pause" class="pause-control" aria-label="${h('pause')}"><span aria-hidden="true">Ⅱ</span><b>${h('pauseCaps')}</b></button></div>
      </header>
      <div class="network-stage game-stage" id="network-stage"><div id="network-canvas" class="game-canvas"></div>
        <div class="mobile-touch-zones network-mobile-zones" data-network-mobile-zones aria-label="${tr('mobileTouchAria')}"><span class="mobile-touch-zone mobile-touch-zone-left" aria-hidden="true">←</span><span class="mobile-touch-zone mobile-touch-zone-down" aria-hidden="true">↓</span><span class="mobile-touch-zone mobile-touch-zone-right" aria-hidden="true">→</span></div>
        <div id="network-hud"></div><output id="network-countdown" class="countdown"></output>
        </div><div class="mobile-match-actions network-mobile-actions"><button type="button" data-net-action="pause" class="mobile-match-action" aria-label="${h('pause')}"><span aria-hidden="true">Ⅱ</span></button><output id="network-mobile-clock" class="mobile-match-timer" aria-label="${h('matchTime')}"></output></div>
      <output id="network-mobile-status" class="network-mobile-status" role="status" hidden></output>
      <div class="network-touch" hidden><button data-control="left" aria-label="${h('left')}">←</button><button data-control="down" aria-label="${h('down')}">↓</button><button data-control="right" aria-label="${h('right')}">→</button><button data-control="rotate" aria-label="${h('rotate')}">↻</button>${this.controls==='tilt'?this.button(u('tilt'),'tilt'):''}</div>
      <div id="network-pause" class="pause-overlay" role="dialog" aria-modal="true" aria-labelledby="network-pause-title" hidden></div></main>`;
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
    this.arenaRuntime={engine:this.session,input:new HumanInputRouter(),aiControllers:new Map(),get mobileSolo(){return isMobilePlayViewport();},onReady:()=>{
        const loading=this.matchLoading;
        if(loading)void loading.ready().then(ready=>{
          if(!ready||this.matchLoading!==loading)return;
          this.matchLoading=null;this.updateArena();
        });
      },onState:()=>this.updateArena(),
      onLayout:layout=>{this.layout=layout;this.updateArena();},onFinished:()=>{}};
    const scene=new PlayScene(this.arenaRuntime);
    const preferences=loadReleaseSettings();this.game=new Phaser.Game({type:Phaser.AUTO,antialias:preferences.antialias,fps:{limit:preferences.fpsLimit},parent:'network-canvas',backgroundColor:'#fff8e9',transparent:true,scale:{mode:Phaser.Scale.RESIZE,width:'100%',height:'100%'},scene:[scene],audio:{noAudio:true}});
  }
  private updateArena():void {
    const session=this.session;const snapshot=session?.snapshot;if(!session||!snapshot?.state||this.view!=='arena'||!this.arenaElement)return;
    this.status(session.status);
    const arena=this.root.querySelector<HTMLElement>('.network-arena')!;
    if(this.arenaLanguage!==getLocale()) {
      this.arenaLanguage=getLocale();
      this.root.querySelectorAll('#network-clock,#network-mobile-clock').forEach(e=>e.setAttribute('aria-label',u('matchTime')));
      const mode=this.root.querySelector('.round-timer small');if(mode)mode.textContent=localeText(modeLabels[roomRules(snapshot.rules).mode]).toLocaleUpperCase(getLocale());
      this.root.querySelectorAll('[data-net-action="pause"]').forEach(e=>e.setAttribute('aria-label',u('pause')));
      const caption=this.root.querySelector('.pause-control b');if(caption)caption.textContent=u('pauseCaps');
      this.root.querySelector('[data-network-mobile-zones]')?.setAttribute('aria-label',localeText('mobileTouchAria'));
      for(const [action,key] of [['left','left'],['down','down'],['right','right'],['rotate','rotate']] as const)this.root.querySelector(`[data-control="${action}"]`)?.setAttribute('aria-label',u(key));
      const tilt=this.root.querySelector('[data-net-action="tilt"]');if(tilt)tilt.textContent=u('tilt');
      const hud=this.root.querySelector<HTMLElement>('#network-hud');if(hud)delete hud.dataset.key;
      const pause=this.root.querySelector<HTMLElement>('#network-pause');if(pause)delete pause.dataset.renderKey;
    }
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
          const preview=i===0?nextPiecePreviewMarkup(p.board.nextPiece,getLocale()):'';
          const shields=i===0?shieldInventoryMarkup(p, session.state,getLocale()):'';
          return `<article class="hud-card network-field-card hud-palette-slot-${palette} ${i===0?'network-own-card':'network-mini-card'} ${card.cardWidth<=250?'is-compact':''} ${p.board.alive?'':'is-out'}" style="--preview-atlas:url('${WORKSHOP_THEME_TEXTURES[p.resolvedTileStyle].url}');left:${card.x}px;top:${card.y}px;width:${card.cardWidth}px;height:${card.cardHeight}px;--network-header:${card.headerHeight}px;--player-name-color:${playerAccentForSlot(slot)}">
            <div class="wood-panel-shell" aria-hidden="true"></div><div class="wood-panel-foot" aria-hidden="true"></div><header class="network-field-heading" data-field="${p.config.id}"><div class="hud-identity"><strong>${escape(networkAiName(p.config.controller==='ai'?'ai':'human',p.config.label,p.config.difficulty))}${p.config.teamId?` · ${h('teamShort',{number:p.config.teamId==='team-2'?2:1})}`:''}</strong></div><div class="hud-stats"><b>${h('points',{count:p.score.toLocaleString(getLocale())})}</b>${i===0?`<span>${h('pieces',{count:p.placedPieces})}</span>`:''}</div>${i===0?'':`<small>${p.board.alive?u('inGame'):u('out')}</small>`}</header>${shields}${preview}${p.board.alive?'':`<b class="out-label">${h('outCaps')}</b>`}</article>`;
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
      const html=`<section class="network-pause-panel"><h2 id="network-pause-title">${h('paused')}</h2>${pauser?`<p>${h('pausedBy',{name:pauser.name})}</p>`:''}<div class="network-absences">${absent.map(s=>`<article><span>${escape(seatName(s))} · ${h('seconds',{seconds:Math.ceil(s.absence!.remainingMs/1000)})}${s.absence!.blocksGameplay?'':` · ${h('spectator')}`}</span>${snapshot.creatorId===snapshot.ownId&&s.id!==snapshot.creatorId?this.button(u('excludeContinue'),`exclude:${s.id}`):''}</article>`).join('')}</div><div class="network-actions">${this.controls==='tilt'?this.button(u('configureTilt'),'tilt'):''}${eligible?this.button(u('resume'),'resume'):snapshot.manualPausedBy?`<p>${h('resumePermission')}</p>`:''}${this.button(networkText('networkSettings'),'preferences')}${this.button(u('toList'),'list')}</div></section>`;
      if(overlay.dataset.renderKey!==renderKey){overlay.innerHTML=html;overlay.dataset.renderKey=renderKey;this.bind();}
    } else if(overlay.dataset.renderKey){delete overlay.dataset.renderKey;this.activateNavigation();}
  }
  private press(source:string,action:string):void {
    if(this.root.querySelector('[data-network-preferences],[data-display-confirm],[data-virtual-keyboard]')||this.matchLoading?.visible||this.blocked.has(source)||this.sources.has(source))return;
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
    if(orientation.requestPermission && await orientation.requestPermission()!=='granted'){this.status(u('tiltDenied'));return;}
    if(this.orientation)this.tilt.calibrate(this.orientation);this.tiltEnabled=true;this.status(u('tiltEnabled'));
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
    this.menuFocus.destroy();
    window.removeEventListener('keydown',this.keyDown);window.removeEventListener('keyup',this.keyUp);window.removeEventListener('deviceorientation',this.sensor);this.root.classList.remove('network-root');
  }
}
