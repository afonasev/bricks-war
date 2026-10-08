import type Phaser from 'phaser';
import type {MatchState} from '../domain/types';

const RED = 0xde3046, CYAN = 0x12a6e6, YELLOW = 0xe5ac19, PURPLE = 0x9749df;
const clamp = (p: number) => Math.max(0, Math.min(1,p));
const ease = (p: number) => 1 - (1-clamp(p)) ** 3;
type Graphics = Phaser.GameObjects.Graphics;

function rim(g: Graphics,x:number,y:number,w:number,h:number,color:number,a:number,expand=0,light=false): void {
  if(a<=0)return;
  const core=Math.max(4,Math.min(8,w*.025));
  for(let j=4;j>0;j--){g.lineStyle(core+j*8,color,a*(.035+(4-j)*.025));g.strokeRoundedRect(x-expand,y-expand,w+expand*2,h+expand*2,5+expand*.15);}
  g.lineStyle(core,color,a);g.strokeRoundedRect(x-expand,y-expand,w+expand*2,h+expand*2,5+expand*.15);
  if(light){g.lineStyle(2,0xffffff,a*.9);g.strokeRoundedRect(x-expand+1,y-expand+1,w+expand*2-2,h+expand*2-2,4);}
}
function point(t:number,x:number,y:number,w:number,h:number):[number,number]{
  let d=((t%(2*(w+h)))+2*(w+h))%(2*(w+h));
  if(d<w)return[x+d,y];d-=w;if(d<h)return[x+w,y+d];d-=h;if(d<w)return[x+w-d,y+h];return[x,y+h-(d-w)];
}
function energy(g:Graphics,x:number,y:number,w:number,h:number,color:number,a:number,p:number):void{
  rim(g,x,y,w,h,color,a);
  const per=2*(w+h),length=w*.35;
  g.lineStyle(Math.max(6,Math.min(11,w*.035)),color,a);
  for(let side=0;side<2;side++)for(let d=0;d<length;d+=3){const at=p*per+side*per/2+d;const [x1,y1]=point(at,x,y,w,h),[x2,y2]=point(at+Math.min(3,length-d),x,y,w,h);g.lineBetween(x1,y1,x2,y2);}
}
function sweep(g:Graphics,x:number,y:number,w:number,h:number,color:number,p:number,a:number):void{
  const center=y+h*(1-ease(p)), band=h*.05;
  for(let i=-8;i<=8;i++){const yy=center+i*band/8;if(yy<y||yy>y+h)continue;g.fillStyle(color,a*.15*(1-Math.abs(i)/9));g.fillRect(x,yy,w,band/8+1);}
}
function reflection(g:Graphics,x:number,y:number,w:number,h:number,color:number,p:number,calm:boolean):void{
  const a=Math.sin(clamp(p)*Math.PI);
  rim(g,x,y,w,h,color,a,calm?0:a*w*.045);
  if(!calm){energy(g,x,y,w,h,color,a,p);sweep(g,x,y,w,h,color,p,a);}
}

/** Selected motion studies, driven exclusively by match active time. */
export function drawBoardEventEffects(g:Graphics,state:MatchState,id:string,x:number,y:number,w:number,h:number,calm=false):void{
  const current=state.attackQueues[id]?.[0];
  for(const launch of state.attackLaunchEvents.filter(e=>e.participantId===id)){
    const p=clamp(1-launch.remainingMs/1500),a=(1-p)**1.5;
    rim(g,x,y,w,h,RED,Math.sin(p*Math.PI),0,true);
    rim(g,x,y,w,h,RED,a,calm?0:ease(p)*w*.208,true);
  }
  if(current?.phase==='warning'){
    const elapsed=3000-current.remainingMs,p=elapsed/3000;
    const fade=Math.min(1,elapsed/120,current.remainingMs/150),a=(calm?.85:.88+.12*Math.sin(elapsed/1000*Math.PI*2))*fade;
    energy(g,x,y,w,h,RED,a,p);
  }
  const charge=state.shieldChargeEvents.find(e=>e.participantId===id&&e.kind==='full');
  if(charge){
    const elapsed=2200-charge.pulseMs,p=clamp(elapsed/1700),a=elapsed<1500?1:clamp((2200-elapsed)/700),top=y+h*(1-ease(p));
    // Clip the charge to the revealed height, keeping the playfield clean.
    const core=Math.max(4,Math.min(8,w*.025));
    for(let j=4;j>0;j--){g.lineStyle(core+j*8,CYAN,a*(.035+(4-j)*.025));g.lineBetween(x,top,x,y+h);g.lineBetween(x+w,top,x+w,y+h);g.lineBetween(x,y+h,x+w,y+h);}
    g.lineStyle(core,CYAN,a);g.lineBetween(x,top,x,y+h);g.lineBetween(x+w,top,x+w,y+h);g.lineBetween(x,y+h,x+w,y+h);
    if(!calm)sweep(g,x,y,w,h,CYAN,p,a);
  }
  const shield=state.shieldPresentations.find(e=>e.participantId===id&&e.remainingMs>0);
  if(shield)reflection(g,x,y,w,h,CYAN,1-shield.remainingMs/shield.durationMs,calm);
  if(current?.phase==='rise'&&current.defended)
    reflection(g,x,y,w,h,YELLOW,1-current.remainingMs/1100,calm);
  const cue=state.anomalyCueEvents.find(e=>e.participantId===id);
  if(cue){const p=1-cue.remainingMs/800;energy(g,x,y,w,h,PURPLE,Math.sin(p*Math.PI),p);}
}
