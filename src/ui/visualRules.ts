import { RULE_EXAMPLES as E, SCORE_EXAMPLES, RISING_EXAMPLE } from './visualRulesExamples';
interface RuleCard {
  topic: string; mode: string; title: string; lead: string;
  notes: readonly string[]; art: string; alt: string;
}
const ink = '#f7f3ff', cyan = '#64e4f2', gold = '#ffd17c', purple = '#b8a1ec';
type Cell = readonly [number, number];
function text(x:number,y:number,value:string,size=24,color=ink,anchor='start'):string {
  return `<text x="${x}" y="${y}" fill="${color}" font-size="${size}" font-weight="750" text-anchor="${anchor}">${value}</text>`;
}
function block(x:number,y:number,u:number,color:string,ghost=false):string {
  return `<rect x="${x+1}" y="${y+1}" width="${u-2}" height="${u-2}" rx="4" fill="${ghost?'#203a48':color}" stroke="${ghost?cyan:color}" stroke-width="${ghost?2:1}" ${ghost?'stroke-dasharray="5 3"':''}/>${ghost?'':`<path d="M${x+5} ${y+6}h${u-11}" stroke="white" stroke-opacity=".4" stroke-width="2"/>`}`;
}
function piece(x:number,y:number,u:number,shape:readonly Cell[],color=cyan,ghost=false):string {
  return shape.map(([c,r])=>block(x+c*u,y+r*u,u,color,ghost)).join('');
}
function board(x:number,y:number,rows:readonly string[],u=30,mark:readonly number[]=[],burn=false):string {
  return `<rect x="${x-4}" y="${y-4}" width="${u*10+8}" height="${u*rows.length+8}" rx="8" fill="#16192a" stroke="#776e97" stroke-width="2"/>`+
    rows.map((row,r)=>[...row].map((v,c)=>v==='.'?`<rect x="${x+c*u}" y="${y+r*u}" width="${u}" height="${u}" fill="none" stroke="#34364e"/>`:block(x+c*u,y+r*u,u,v==='#'?'#8592a6':v==='X'?(burn?'#ffaf56':cyan):purple)).join('')).join('')+
    mark.map(r=>`<rect x="${x-2}" y="${y+r*u-2}" width="${10*u+4}" height="${u+4}" rx="5" fill="${burn?'#ff9129':'#ffe2a0'}" fill-opacity=".13" stroke="${burn?'#ffaf56':gold}" stroke-width="3"/><path d="M${x+8} ${y+r*u+u/2}h${10*u-16}" stroke="${gold}" stroke-width="2" stroke-dasharray="8 5"/>`).join('');
}
function scene(content:string):string { return `<svg viewBox="0 0 600 510" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg"><rect width="600" height="510" rx="22" fill="#25213f"/><g font-family="system-ui,sans-serif">${content}</g></svg>`; }
function panel(y:number,n:string,label:string,sub:string,art:string):string {
  return `<rect x="12" y="${y}" width="576" height="148" rx="14" fill="#302b49"/>${text(28,y+35,n,23,gold)}${text(28,y+71,label,23)}${text(28,y+103,sub,21,'#cec4e4')}${art}`;
}
function step(y:number,n:string,label:string,sub:string,rows:readonly string[],mark:readonly number[]=[],burn=false,extra=''):string {
  return panel(y,n,label,sub,board(266,y+14,rows,30,mark,burn)+extra);
}
function down(y:number):string {return text(416,y,'↓',24,gold,'middle');}
function shield(x:number,y:number,size=1,full=true):string {
 return `<g transform="translate(${x} ${y}) scale(${size})"><path d="M0 0l26 9v22q0 23-26 37-26-14-26-37V9z" fill="${full?cyan:'#34344b'}" stroke="${full?'#c1f8ff':'#867f9d'}" stroke-width="3"/>${full?text(0,43,'✓',25,'#155365','middle'):''}</g>`;
}
const fullRows=(n:number)=>Array.from({length:n},(_,i)=>4-n+i);
export const RULE_CARDS: readonly RuleCard[] = [
 {topic:'Основа',mode:'ВСЕ РЕЖИМЫ',title:'Собери полный ряд',lead:'Двигай и поворачивай фигуру, чтобы закрыть пробелы.',notes:['Полный ряд исчезает. Всё над ним опускается на одну клетку.'],art:scene(
  panel(10,'1 · ПОДГОТОВЬ','Вставь в пробел','',board(266,24,E.basic.before)+piece(386,84,30,E.basic.shape,cyan,true)+piece(32,95,14,[[0,0],[0,1],[1,1],[0,2]])+text(79,125,'↻ →',27,gold)+piece(146,103,14,E.basic.shape))+
  down(176)+step(181,'2 · РЯД ЗАПОЛНЕН','Все 10 клеток','Этот ряд исчезнет',E.basic.locked,[3])+down(347)+
  step(352,'3 · ГОТОВО','Блоки сверху','упали на 1 клетку',E.basic.cleared,[],false,text(431,415,'↓',31,gold))
 ),alt:'Т-образная фигура повёрнута и вставлена в точный вырез нижнего ряда. Полный ряд отмечен золотой линией. После удаления два левых блока и верхушка Т опустились ровно на одну клетку.'},
 {topic:'Очки',mode:'ВСЕ РЕЖИМЫ',title:'Больше рядов — больше очков',lead:'Считаются ряды, закрытые одной фигурой за один раз.',notes:[],art:scene(
  SCORE_EXAMPLES.map((rows,i)=>{const y=12+i*125;return `<rect x="12" y="${y}" width="576" height="112" rx="14" fill="#302b49"/>`+board(27,y+10,rows,23,fullRows(i+1))+text(287,y+40,`${i+1} ${i===0?'ряд':'ряда'} →`,25)+text(436,y+74,String([100,300,500,800][i]),48,gold)+text(437,y+100,'очков',20,'#cec4e4');}).join('')
 ),alt:'Четыре отдельных примера: голубая I, O, J или I заполняет выделенные ряды. Один ряд даёт 100 очков, два одновременно 300, три 500, четыре 800.'},
 {topic:'Серые ряды',mode:'АТАКИ И ДАВЛЕНИЕ ВРЕМЕНИ',title:'Серые ряды растут снизу',lead:'Их добавляет атака соперника или давление времени, когда игра затягивается.',notes:['Каждый новый ряд поднимает всё поле на одну клетку.'],art:scene(
  panel(10,'ОТКУДА ОНИ','Атака соперника','или время',text(374,66,'⚔ / ◷',35,gold,'middle')+text(481,65,'→ +1',28,gold)+board(276,102,['##########'],28))+
  step(181,'ДО','Твоё поле','',RISING_EXAMPLE.before)+down(347)+step(352,'ПОСЛЕ','Всё поднялось','на 1 клетку',RISING_EXAMPLE.after,[],false,text(548,408,'↑',33,gold))
 ),alt:'Два источника: атака соперника или давление времени. Показано одно и то же поле до и после: снизу вставлен серый ряд, вся фиолетовая постройка поднялась ровно на клетку.'},
 {topic:'Атака',mode:'БИТВА · ПРИ ВКЛЮЧЁННЫХ АТАКАХ',title:'Очищай ряды — атакуй',lead:'Закрой два ряда за раз — отправь сопернику один серый.',notes:['3 ряда → 3 серых. 4 ряда → 4 серых.'],art:scene(
  step(10,'1 · ТВОЁ ПОЛЕ','Квадрат закрыл','сразу 2 ряда',E.attack.locked,[2,3])+down(176)+
  panel(181,'2 · АТАКА ЛЕТИТ','2 ряда исчезли','Сопернику +1',text(277,240,'ТЫ',25,cyan)+text(357,246,'→',44,gold)+text(437,240,'СОПЕРНИК',21)+board(296,276,['##########'],25))+
  step(352,'3 · У СОПЕРНИКА','Серый ряд','поднял его поле',RISING_EXAMPLE.after)
 ),alt:'Голубой квадрат заполняет два нижних ряда твоего поля. Из их очистки получается атака в один ряд, направленная от тебя к сопернику. На его поле снизу появляется серый ряд.'},
 {topic:'Активный блок',mode:'БИТВА · ЗАЩИТА ОТ АТАКИ',title:'Успей очистить ряд до удара',lead:'Во время предупреждения закрой хотя бы один ряд — входящий удар отменится.',notes:['Это активный блок: весь удар отменяется без расхода щитов.'],art:scene(
  panel(10,'1 · ИДЁТ АТАКА','Соперник → ты','Удар ещё не дошёл',text(408,69,'+3 РЯДА',36,'#ffaf7a','middle')+`<rect x="278" y="100" width="276" height="16" rx="8" fill="#51475e"/><rect x="278" y="100" width="174" height="16" rx="8" fill="#ffaf7a"/>`)+
  step(181,'2 · УСПЕЙ','Закрой 1 ряд','пока идёт отсчёт',E.block.locked,[3])+down(347)+
  panel(352,'3 · БЛОК!','Весь удар','отменён',text(414,414,'+3 → 0',42,cyan,'middle')+text(414,459,'СЕРЫХ РЯДОВ НЕТ',23,ink,'middle'))
 ),alt:'Соперник отправил три ряда, идёт отсчёт предупреждения. Голубая I закрывает один ряд до удара. Вся входящая атака плюс три отменена, серых рядов не вставляется.'},
 {topic:'Щиты',mode:'ВЫЖИВАНИЕ / БИТВА',title:'Две очистки подряд дают щит',lead:'Со второй подходящей очистки подряд получай по щиту. Можно накопить три.',notes:['Выживание: очисти 1+ ряд. Битва: ровно 1.','Без очистки или с Аномалией серия обрывается.'],art:scene(
  text(300,40,'ОБЫЧНЫЕ ОЧИСТКИ ПОДРЯД',25,ink,'middle')+
  [0,1,2].map((n)=>{const x=28+n*196;return text(x+76,86,`${n+1}-я`,26,gold,'middle')+board(x+5,106,['0000000000'],14,[0])+(n===2?shield(x+55,153,.75)+shield(x+97,153,.75):shield(x+75,153,.75,n>0))+text(x+75,236,`${n} ${n===0?'щитов':n===1?'щит':'щита'}`,25,n>0?cyan:ink,'middle')+(n<2?text(x+166,185,'→',28,gold):'');}).join('')+
  `<path d="M26 264h548" stroke="#76668f" stroke-width="2"/>`+text(300,308,'ЩИТ СРАБОТАЕТ САМ',27,ink,'middle')+
  board(34,357,['##########'],16)+text(228,382,'→',35,gold)+shield(300,339,.9)+text(358,382,'→',35,gold)+text(473,367,'0 рядов',27,cyan,'middle')+text(473,405,'0 щитов',24,ink,'middle')+text(300,477,'1 щит поглотил 1 ряд и исчез',25,gold,'middle')
 ),alt:'Три обычные очистки подряд дают соответственно ноль, один и два щита. Отдельно показано расходование: один входящий серый ряд сталкивается с одним щитом, оба исчезают, на поле не приходит ни одного ряда.'},
 {topic:'Аномалия',mode:'НА НОВОМ УРОВНЕ',title:'Аномалия — необычная фигура',lead:'На новом уровне вместо следующей фигуры приходит Аномалия.',notes:['6–8 соединённых блоков. Двигай и поворачивай её как обычную фигуру.'],art:scene(
  text(151,62,'ОБЫЧНАЯ',26,ink,'middle')+text(445,62,'АНОМАЛИЯ',26,gold,'middle')+
  piece(68,138,64,[[0,0],[1,0],[0,1],[1,1]],purple)+text(286,227,'→',49,gold,'middle')+
  piece(352,113,58,[[0,0],[1,0],[0,1],[1,1]],purple)+piece(352,113,58,[[2,1],[2,2]],'#ffaf56')+
  text(132,339,'4 блока',29,ink,'middle')+text(440,339,'6 блоков',29,gold,'middle')+
  text(300,416,'К обычной форме добавились',25,ink,'middle')+text(300,458,'ещё 2–4 блока',29,gold,'middle')
 ),alt:'Крупный обычный квадрат из четырёх фиолетовых блоков. Справа тот же квадрат с двумя оранжевыми блоками сбоку и снизу: одна связная Аномалия из шести блоков, не прямоугольник.'},
 {topic:'Ожог Аномалии',mode:'ОЧИСТКА АНОМАЛИЕЙ',title:'Аномалия сжигает низ поля',lead:'Сколько рядов закрыла Аномалия — столько нижних рядов сгорит дополнительно.',notes:['Сгорают любые нижние ряды, даже серые. Без очистки ожога нет.'],art:scene(
  step(10,'1 · ПОСТАВЬ','Аномалия','закрыла 1 ряд',E.anomaly.locked,[1],true)+down(176)+
  step(181,'2 · ОЧИСТКА','Полный ряд исчез','Нижний — горит',E.anomaly.cleared,[3],true)+down(347)+
  step(352,'3 · ОЖОГ','Нижний ряд сгорел','Всё опустилось',E.anomaly.burned,[],true)
 ),alt:'Одна и та же Аномалия в трёх последовательных состояниях. Сначала она заполняет один обычный ряд над серым. После обычной очистки блоки опускаются, серый нижний ряд отмечен для ожога. После ожога серый ряд исчез, оставшиеся блоки опустились ещё на клетку.'},
];

export function rulesScreenMarkup(): string {
  return `<main class="rules-screen" data-screen="rules"><header class="rules-heading"><button class="screen-back" id="rules-back" type="button">← Настройки</button><div><p class="eyebrow">BRICKS WAR · ИЛЛЮСТРИРОВАННЫЙ ГИД</p><h1>Правила игры</h1></div><output id="rules-progress" aria-label="Номер карточки"></output></header><article id="rules-card" class="rules-card" aria-live="polite" aria-atomic="true"></article><nav class="rules-topics" aria-label="Темы правил">${RULE_CARDS.map((card,index)=>`<button type="button" data-rule-topic="${index}" aria-label="${index+1}. ${card.topic}">${index+1}</button>`).join('')}</nav><footer class="rules-navigation"><button id="rules-prev" type="button" aria-label="Предыдущая подсказка">← Назад</button><span>← → переключить · Esc выйти</span><button id="rules-next" type="button" aria-label="Следующая подсказка">Далее →</button></footer></main>`;
}

export function bindRulesScreen(screen: HTMLElement, back: () => void): () => void {
  let index = 0;
  const prev = screen.querySelector<HTMLButtonElement>('#rules-prev')!;
  const next = screen.querySelector<HTMLButtonElement>('#rules-next')!;
  const topics = Array.from(screen.querySelectorAll<HTMLButtonElement>('[data-rule-topic]'));
  const show = (target: number) => {
    index = Math.max(0, Math.min(RULE_CARDS.length-1, target));
    const card = RULE_CARDS[index]!;
    screen.querySelector('#rules-card')!.innerHTML = `<figure class="rules-art" role="img" aria-label="${card.alt}">${card.art}</figure><div class="rules-copy"><p class="rules-mode">${card.mode}</p><h2>${card.title}</h2><p class="rules-lead">${card.lead}</p><ul>${card.notes.map(note=>`<li>${note}</li>`).join('')}</ul></div>`;
    screen.querySelector('#rules-progress')!.textContent = `${index+1} / ${RULE_CARDS.length}`;
    prev.disabled = index === 0; next.disabled = index === RULE_CARDS.length-1;
    topics.forEach((button,i)=>button.setAttribute('aria-current',i===index ? 'step' : 'false'));
    if (document.activeElement === prev && prev.disabled) next.focus();
    if (document.activeElement === next && next.disabled) prev.focus();
  };
  prev.addEventListener('click',()=>show(index-1)); next.addEventListener('click',()=>show(index+1));
  topics.forEach((button,i)=>button.addEventListener('click',()=>show(i)));
  screen.querySelector('#rules-back')!.addEventListener('click',back);
  const onKey = (event: KeyboardEvent) => {
    if (!screen.isConnected) return;
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Escape') return;
    event.preventDefault(); event.stopPropagation();
    if (event.key === 'Escape') back(); else show(index + (event.key === 'ArrowLeft' ? -1 : 1));
  };
  document.addEventListener('keydown', onKey, true); show(0);
  return () => document.removeEventListener('keydown', onKey, true);
}
