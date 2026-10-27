import {describe,it,expect} from 'vitest';
import {releaseNotesBlocks} from '../src/ui/releaseNotes';
import {localizedReleaseNotes} from '../src/ui/releaseHistory';
const image = 'https://raw.githubusercontent.com/afonasev/bricks-war/'+'a'.repeat(40)+'/docs/release-notes/1.12.1/teams-1440.png';
describe('release note image blocks',()=>{
 it('keeps category text and captions in order between multiple screenshots',()=>{
  expect(releaseNotesBlocks('### Fixed\n- Teams\n\n![Команды]('+image+')\n- Cards\n![Cards]('+image+')')).toEqual([
   {kind:'text',text:'### Fixed\n- Teams\n\n'},{kind:'image',alt:'Команды',source:image},
   {kind:'text',text:'\n- Cards\n'},{kind:'image',alt:'Cards',source:image}]);
 });
 it('recognizes adjacent images without swallowing the next markdown token',()=>{
  expect(releaseNotesBlocks('![A]('+image+')![B]('+image+')').map(block=>block.kind)).toEqual(['image','image']);
 });
 it('does not promote HTML or unsafe images to executable markup',()=>{
  const text='<img src=x onerror=alert(1)>\n![x](javascript:alert)\n![x](data:image/svg+xml;base64,PHN2Zz4=)\n![x](https://example.com/a.png)';
  expect(releaseNotesBlocks(text)).toEqual([{kind:'text',text}]);
 });
 it('uses a same-origin native image route, and keeps the selected translation only',()=>{
  const notes=localizedReleaseNotes('## Русский\n![Команды]('+image+')\n## English\n![Teams]('+image+')','ru');
  expect(releaseNotesBlocks(notes.text,true)).toEqual([{kind:'image',alt:'Команды',source:'/__release-image?url='+encodeURIComponent(image)}]);
 });
});
