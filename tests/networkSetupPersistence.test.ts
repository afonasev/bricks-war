import {describe,it,expect} from 'vitest';
import {loadCreator,loadCreatorRules,saveCreatorRules,saveCreatorBots,saveCreatorRoom,loadPersonal,savePersonal,NETWORK_SETUP_KEY} from '../src/network/setupPersistence';
import {defaultRoomRules} from '../src/network/rules';
const storage=()=>{const data=new Map<string,string>();return {getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{data.set(k,v);}};};
describe('isolated network setup preferences',()=>{
  it('defaults new Battle profiles and retains independent explicit timed/off/leader values',()=>{
    const s=storage();for(const mode of ['battle','team-battle'] as const)expect(loadCreatorRules(mode,s)).toMatchObject({conflictEnabled:true,conflictTargeting:'all-opponents',battleTimeMode:'until-victory'});
    saveCreatorRules({...defaultRoomRules('battle'),battleTimeMode:'timed',durationMinutes:9,conflictEnabled:false,conflictTargeting:'hunt-leader',softDrop:'fast',pressure:'extended'},s);
    saveCreatorRules({...defaultRoomRules('team-battle'),battleDifficulty:'sport'},s);
    expect(loadCreatorRules('battle',s)).toMatchObject({battleTimeMode:'timed',durationMinutes:9,conflictEnabled:false,conflictTargeting:'hunt-leader',softDrop:'fast',pressure:'extended'});
    expect(loadCreatorRules('team-battle',s).battleDifficulty).toBe('sport');
  });
  it('roundtrips personal controls/name/style/team and creator bot templates without runtime state',()=>{
    const s=storage();savePersonal({name:'Анна',tileStyle:'classic',controls:'gamepad-3',teamId:'team-2'},s);saveCreatorRoom('Друзья',s);
    saveCreatorBots([{kind:'ai',difficulty:'expert',tileStyle:'random',teamId:'team-2',retained:true,id:'runtime',name:'Bot',ready:true,connected:true,seatOrder:4,absence:null}],s);
    expect(loadPersonal('touch',s)).toEqual({name:'Анна',tileStyle:'classic',controls:'gamepad-3',teamId:'team-2'});expect(loadCreator(s).bots).toEqual([{difficulty:'expert',tileStyle:'random',teamId:'team-2'}]);
    expect(s.getItem(NETWORK_SETUP_KEY)).not.toMatch(/runtime|ready|connected|password/);
  });
  it('validates corrupted fields independently and works when storage throws',()=>{
    const s=storage();s.setItem(NETWORK_SETUP_KEY,JSON.stringify({profiles:{battle:{battleTimeMode:'bad',conflictEnabled:false,durationMinutes:10,softDrop:'fast'}},personal:{name:42,controls:'bad'},bots:[{}]}));
    expect(loadCreatorRules('battle',s)).toMatchObject({battleTimeMode:'until-victory',conflictEnabled:false,durationMinutes:10,softDrop:'fast'});expect(loadCreator(s).bots).toEqual([]);expect(loadPersonal('touch',s).controls).toBe('touch');
    const denied={getItem:()=>{throw Error();},setItem:()=>{throw Error();}};expect(()=>savePersonal({name:'Anna'},denied)).not.toThrow();expect(loadCreatorRules('battle',denied).battleTimeMode).toBe('until-victory');
  });
});
