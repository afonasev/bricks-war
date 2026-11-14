import test from 'node:test';
import assert from 'node:assert/strict';
import {launcherPresentation} from '../../electron/launcher-presentation.mjs';
import {normalizeReleaseDate,manifestReleaseDate} from '../../electron/release-date.mjs';
import {UpdateCoordinator,TransferGate} from '../../electron/update-coordinator.mjs';
test('dates come from valid calendar metadata or plausible signed historical sequence, never arbitrary counters',()=>{
 assert.equal(normalizeReleaseDate('2026-11-03T23:30:00Z'),'2026-11-03');
 for(const invalid of ['2026-02-30','2026-13-01','yesterday','<script>',null,123])assert.equal(normalizeReleaseDate(invalid),null);
 assert.equal(manifestReleaseDate({sequence:1}),null);assert.equal(manifestReleaseDate({sequence:Date.parse('2026-11-03T23:30:00Z')}),'2026-11-03');
 assert.equal(manifestReleaseDate({releaseDate:'2026-11-04',sequence:Date.parse('2026-11-03')}),'2026-11-04');
});
test('failed/expired discovery cannot render latest; update dates and installed dates remain distinct',()=>{
 const state={currentVersion:'1.16.3',currentDate:'2026-11-03',version:'1.16.4',versionDate:'2026-11-04'};
 for(const checkOutcome of ['failed','timeout','aborted',undefined])assert.equal(launcherPresentation({kind:'status',state:{...state,checkOutcome}}).title,'Could not check for updates');
 const current=launcherPresentation({kind:'status',locale:'ru',state:{...state,checkOutcome:'current'}});assert.equal(current.title,'Установлена последняя версия');assert.match(current.description,/3 ноября 2026/);
 const update=launcherPresentation({kind:'offer',locale:'ru',state});assert.match(update.description,/4 ноября 2026/);assert.match(update.version,/3 ноября 2026/);
 assert.match(launcherPresentation({kind:'status',state:{currentVersion:'1.0.0',checkOutcome:'current'}}).description,/Version date unavailable/);
});
test('the launcher explains a GitHub check failure and timeout in both languages', () => {
 for (const locale of ['ru', 'en']) {
  const state = { currentVersion: '1.16.6' };
  const failed = launcherPresentation({ kind: 'status', locale, state: { ...state, checkOutcome: 'failed' } });
  const timeout = launcherPresentation({ kind: 'status', locale, state: { ...state, checkOutcome: 'timeout' } });
  assert.match(failed.description, /GitHub/);
  assert.match(timeout.description, /GitHub/);
  assert.notEqual(failed.description, timeout.description);
  assert.match(failed.version, /1\.16\.6/);
  assert.match(timeout.version, /1\.16\.6/);
 }
});
test('failure marker is neutral and cannot claim rollback, while unverified copy remains blocked',()=>{
 const marker=launcherPresentation({kind:'status',historical:true,state:{currentVersion:'1.0.0',checkOutcome:'current'}});assert.equal(marker.kind,'historical');assert.doesNotMatch(marker.title,/restored/i);
 assert.equal(launcherPresentation({kind:'failure',playable:false,recovery:true,state:{}}).kind,'blocked');
});
test('coordinator snapshot keeps installed signed date and matching selected published date without affecting eligibility',async()=>{
 const store={manifest:{gameVersion:'1.0.0',releaseDate:'2026-11-03'},ready:null};const c=new UpdateCoordinator({store,gate:new TransferGate(),discover:async()=>({manifest:{gameVersion:'2.0.0'},publishedAt:'2026-11-04T05:00:00Z'})});await c.check();assert.equal(c.snapshot().currentDate,'2026-11-03');assert.equal(c.snapshot().versionDate,'2026-11-04');assert.equal(c.snapshot().currentVersion,'1.0.0');
});


test('prior failure is secondary to the current outcome and recovery guidance', () => {
  const state = {currentVersion:'1.16.4',version:'1.16.8',versionDate:'2026-11-14'};
  const manual = launcherPresentation({kind:'manual',locale:'ru',historical:true,state,installerOpenFailed:true});
  assert.equal(manual.copy.installer, 'Скачать установщик');
  assert.match(manual.description, /1\.16\.8.*EXE с GitHub/);
  assert.match(manual.notice, /Предыдущее обновление.*Не удалось открыть ссылку/);
  const check = launcherPresentation({kind:'status',historical:true,state:{...state,checkOutcome:'timeout'}});
  assert.equal(check.kind, 'checkFailed');
  assert.match(check.notice, /previous update/);
  for (const [failureReason, message] of [['disk', /disk space/], ['permission', /permissions/], ['integrity', /verification/]]) {
    assert.match(launcherPresentation({kind:'failure',retry:true,state:{...state,failureReason}}).description, message);
  }
});
