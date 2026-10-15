import test from 'node:test';
import assert from 'node:assert/strict';
import {releaseNotes} from '../../scripts/desktop/release-notes.mjs';
test('Git inventory produces matching grouped bilingual player notes and omits explicit internal work',()=>{
 const commits=[{hash:'a',subject:'feat: technical subject',body:'Release-Note-RU: Можно менять громкость\nRelease-Note-EN: Volume can be adjusted'},{hash:'b',subject:'chore: internal',body:'Release-Internal: true'},{hash:'c',subject:'fix: issue',body:''}];
 const notes=releaseNotes(commits,{c:{ru:'Исправлен возврат',en:'Fixed returning',category:'Fixed'}});
 assert.match(notes,/## Русский\n### Новое/);assert.match(notes,/## English\n### Added/);assert.match(notes,/### Исправления/);assert.doesNotMatch(notes,/technical subject|internal|issue/);
});
test('missing translation or unknown commit refuses release rather than inventing player claims',()=>{
 assert.throws(()=>releaseNotes([{hash:'x',subject:'feat: x',body:'Release-Note-RU: Только русский'}]),/Bilingual/);
 assert.throws(()=>releaseNotes([{hash:'x',subject:'fix: unknown',body:''}]),/Bilingual/);
});
