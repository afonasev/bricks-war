import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UpdateCoordinator, TransferGate, STARTUP_DISCOVERY_BUDGET_MS } from '../../electron/update-coordinator.mjs';
import { GithubUpdates } from '../../electron/github-updates.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
function controlledClock() {
  let now = 0, next = 0;
  const timers = new Map();
  return {
    now: () => now,
    setTimeout(callback, milliseconds) { const id = ++next; timers.set(id, { at: now + milliseconds, callback }); return id; },
    clearTimeout(id) { timers.delete(id); },
    advance(milliseconds, runTimers = true) {
      now += milliseconds;
      if (runTimers) for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.callback(); }
    },
    pending: () => timers.size,
  };
}
function coordinator(discover, extras = {}) {
  const clock = controlledClock(), gate = new TransferGate();
  const store = { manifest: { gameVersion: '1.0.0', sequence: 1 }, state: { highWater: 1 }, shellVersion: 3, ready: null };
  return { clock, gate, store, update: new UpdateCoordinator({ store, gate, discover, clock, ...extras }) };
}

test('one 3000-ms preflight settles even when discovery ignores abort; late target cannot become downloadable', async () => {
  let finish, signal, calls = 0;
  const f = coordinator(options => { calls++; signal = options.signal; return new Promise(resolve => { finish = resolve; }); });
  assert.equal(STARTUP_DISCOVERY_BUDGET_MS, 3000);
  const first = f.update.check(); assert.equal(f.update.check(), first);
  await tick(); f.clock.advance(2999);
  assert.equal(f.update.phase, 'checking'); assert.equal(signal.aborted, false);
  f.clock.advance(1);
  assert.equal((await first).checkOutcome, 'timeout'); assert.equal(signal.aborted, true);
  finish({ component: 'content', manifest: { gameVersion: '9.0.0' }, envelope: {} });
  await tick();
  assert.equal(f.update.candidate, null); assert.equal(f.update.phase, 'check-error');
  assert.equal((await f.update.check()).available, false); await f.update.download();
  assert.equal(calls, 1); assert.equal(f.clock.pending(), 0);
});

test('absolute deadline rejects a boundary result before the delayed timer gets CPU time', async () => {
  let finish;
  const f = coordinator(() => new Promise(resolve => { finish = resolve; }));
  const check = f.update.check(); await tick(); f.clock.advance(3000, false);
  finish({ component: 'content', manifest: { gameVersion: '2.0.0' } });
  assert.equal((await check).checkOutcome, 'timeout'); assert.equal(f.update.candidate, null);
});

test('completed checks clear their deadline, do not claim offline is current, and retain prepared packages', async () => {
  const current = coordinator(async () => null);
  assert.equal((await current.update.check()).checkOutcome, 'current'); assert.equal(current.clock.pending(), 0);
  const offline = coordinator(async () => { throw Error('offline'); });
  assert.equal((await offline.update.check()).checkOutcome, 'failed'); assert.equal(offline.clock.pending(), 0);
  const ready = coordinator(() => new Promise(() => {}), { readyShell: () => ({ version: '2.0.0' }) });
  const check = ready.update.check(); await tick(); ready.clock.advance(3000);
  assert.equal((await check).phase, 'ready'); assert.equal(ready.update.snapshot().version, '2.0.0');
});

test('pre-aborted discovery starts no network work and late rejection is observed', async () => {
  let calls = 0, reject;
  const f = coordinator(() => { calls++; return Promise.resolve(null); });
  const abort = new AbortController(); abort.abort();
  assert.equal((await f.update.check({ signal: abort.signal })).checkOutcome, 'aborted'); assert.equal(calls, 0);
  const late = coordinator(() => new Promise((_resolve, fail) => { reject = fail; }));
  const check = late.update.check(); await tick(); late.clock.advance(3000); await check;
  reject(Error('late transport failure')); await tick();
  assert.equal(late.update.phase, 'check-error');
});

async function githubFixture(t, fetcher) {
  const root = await mkdtemp(join(tmpdir(), 'bricks-launcher-check-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const f = coordinator(null);
  f.source = new GithubUpdates({ gate: f.gate, store: f.store, fetcher, cachePath: join(root, 'cache.json') });
  f.update.discover = options => f.source.discover(options);
  return f;
}
for (const stage of ['headers', 'body', 'manifest']) test(`expiry drains production discovery activity with an uncooperative ${stage} transport`, async t => {
  let requested = 0, bodyCancelled = false;
  const never = () => new Promise(() => {});
  const hungResponse = () => ({ status: 200, ok: true, headers: new Headers(), body: {
    getReader: () => ({ read: never, cancel: async () => { bodyCancelled = true; } }),
  } });
  const f = await githubFixture(t, async url => {
    requested++;
    if (stage === 'headers') return never();
    if (stage === 'body') return hungResponse();
    if (url.includes('api.github.com')) return Response.json([{ tag_name: 'content-2', assets: [{ name: 'manifest.json' }] }]);
    return hungResponse();
  });
  const check = f.update.check();
  for (let i = 0; i < 20 && requested < (stage === 'manifest' ? 2 : 1); i++) await tick();
  assert.equal(requested, stage === 'manifest' ? 2 : 1);
  assert.equal(f.gate.active.size, 1);
  f.clock.advance(3000); assert.equal((await check).checkOutcome, 'timeout'); await tick();
  assert.equal(f.gate.active.size, 0); await f.gate.setAllowed(false);
  assert.equal(f.update.candidate, null);
  if (stage === 'manifest') assert.equal(f.source.releases[0].tag_name, 'content-2');
  else assert.equal(f.source.releases, null);
  if (stage !== 'headers') assert.equal(bodyCancelled, true);
});

test('all production API pages share the original deadline rather than receiving three seconds each', async t => {
  let pages = 0, f;
  f = await githubFixture(t, async () => {
    pages++; f.clock.advance(pages === 1 ? 2000 : 1000);
    return Response.json(pages === 1 ? Array.from({ length: 100 }, () => ({ tag_name: 'other', assets: [] })) : []);
  });
  const result = await f.update.check(); await tick();
  assert.equal(pages, 2); assert.equal(result.checkOutcome, 'timeout');
  assert.equal(f.source.releases, null); assert.equal(f.update.candidate, null); assert.equal(f.gate.active.size, 0);
});

const { StartupLauncherSession } = await import('../../electron/startup-launcher.mjs');
function launcherFixture({ candidate = { component: 'content', manifest: { gameVersion: '2.0.0' }, envelope: {} }, choices = ['update'], failures = ['play'] } = {}) {
  const counts = { offers: 0, statuses: 0, progress: 0, failures: 0, installs: 0, launches: 0, quits: 0, prepares: 0, discovery: 0 };
  const f = coordinator(async () => { counts.discovery++; return candidate; });
  f.store.prepare = async () => { counts.prepares++; f.store.ready = { gameVersion: '2.0.0' }; };
  f.store.cancel = () => {};
  f.store.discardPrepared = async () => { f.store.ready = null; };
  const ui = {
    status: async () => { counts.statuses++; return choices.shift() ?? 'play'; },
    offer: async () => { counts.offers++; return choices.shift(); },
    progress: async (_state, cancel) => { counts.progress++; ui.cancel = cancel; },
    failure: async () => { counts.failures++; return failures.shift(); },
    installing: async () => { counts.installs++; }, close: async () => {},
  };
  const session = new StartupLauncherSession({ coordinator: f.update, ui,
    activate: async () => { f.store.manifest = f.store.ready; f.store.ready = null; return { activated: true }; }, recoverWorking: async () => true,
    launchGame: async () => { counts.launches++; }, quit: async () => { counts.quits++; } });
  return { ...f, session, ui, counts };
}

test('current/offline startup presents one status choice before a single game launch', async () => {
  for (const offline of [false, true]) {
    const f = launcherFixture({ candidate: null, choices:['play'] });
    if (offline) f.update.discover = async () => { throw Error('offline'); };
    const run = f.session.run(); assert.equal(f.session.run(), run); assert.equal(await run, 'play');
    assert.equal(f.counts.launches, 1); assert.equal(f.counts.offers, 0); assert.equal(f.counts.statuses, 1); assert.equal(f.counts.progress, 0);
    const reused = await f.update.check();
    assert.equal(reused.phase, 'idle'); assert.equal(reused.error, false);
    assert.equal(reused.checkOutcome, offline ? 'failed' : 'current');
  }
});

test('a declined offer launches the installed game without requesting package bytes', async () => {
  const f = launcherFixture({ choices: ['play'] });
  assert.equal(await f.session.run(), 'play');
  assert.equal(f.counts.offers, 1); assert.equal(f.counts.prepares, 0); assert.equal(f.counts.launches, 1);
});

test('one consent prepares and activates before exactly one game launch', async () => {
  const f = launcherFixture(); let activated = false;
  const activate = f.session.activate;
  f.session.activate = async () => { assert.equal(f.counts.launches, 0); const result = await activate(); activated = true; return result; };
  const originalLaunch = f.session.launchGame;
  f.session.launchGame = async () => { assert.equal(activated, true); await originalLaunch(); };
  assert.equal(await f.session.run(), 'play');
  assert.deepEqual(f.counts, { offers: 1, statuses: 0, progress: 1, failures: 0, installs: 1, launches: 1, quits: 0, prepares: 1, discovery: 1 });
  for (const state of [f.update.snapshot(), await f.update.check()]) {
    assert.equal(state.currentVersion, '2.0.0'); assert.equal(state.available, false); assert.equal(state.phase, 'idle');
    assert.equal(state.version, undefined); assert.equal(state.progress, 0); assert.equal(state.checkOutcome, 'installed');
  }
});

test('download retry reuses the frozen target and consent, without a second discovery or offer', async () => {
  const f = launcherFixture({ failures: ['retry'] });
  f.store.prepare = async () => { if (++f.counts.prepares === 1) throw Error('connection lost'); f.store.ready = { gameVersion: '2.0.0' }; };
  assert.equal(await f.session.run(), 'play');
  assert.equal(f.counts.prepares, 2); assert.equal(f.counts.offers, 1); assert.equal(f.counts.discovery, 1); assert.equal(f.counts.launches, 1);
});

test('cancelling preparation drains the real coordinator operation before the game can start', async () => {
  const f = launcherFixture(); let finish, drained = false;
  f.store.prepare = async () => { f.counts.prepares++; await new Promise(resolve => { finish = resolve; }); drained = true; };
  f.store.cancel = () => { setImmediate(() => finish()); };
  const originalLaunch = f.session.launchGame;
  f.session.launchGame = async () => { assert.equal(drained, true); assert.equal(f.update.operation, null); await originalLaunch(); };
  const running = f.session.run(); await tick();
  const a = f.ui.cancel(), b = f.ui.cancel(); assert.equal(a, b);
  assert.equal(f.counts.launches, 0); assert.equal(await running, 'play'); assert.equal(f.counts.launches, 1); assert.equal(f.counts.installs, 0);
});

test('cancel before preparation begins requests zero bytes and incompatible targets cannot be downloaded', async () => {
  const f = launcherFixture(); f.ui.progress = async (_state, cancel) => { await cancel(); };
  assert.equal(await f.session.run(), 'play'); assert.equal(f.counts.prepares, 0);
  const blocked = launcherFixture({ candidate: { component: 'shell-required', manifest: { gameVersion: '3.0.0' } }, failures: ['play'] });
  assert.equal(await blocked.session.run(), 'play'); assert.equal(blocked.counts.prepares, 0); assert.equal(blocked.counts.offers, 0);
});

test('acknowledged shell handoff quits the old process and never launches its old game renderer', async () => {
  const f = launcherFixture(); f.session.activate = async () => ({ handoff: true });
  assert.equal(await f.session.run(), 'handoff'); assert.equal(f.counts.launches, 0); assert.equal(f.counts.quits, 1);
});

test('activation failure requires confirmed recovery before offering the installed game', async () => {
  for (const playable of [true, false]) {
    const f = launcherFixture();
    f.session.activate = async () => { throw Error('replacement denied'); };
    f.session.recoverWorking = async () => playable;
    f.ui.failure = async (_state, options) => { assert.equal(options.playable, playable); return 'play'; };
    assert.equal(await f.session.run(), playable ? 'play' : 'quit');
    assert.equal(f.counts.launches, playable ? 1 : 0); assert.equal(f.counts.quits, playable ? 0 : 1);
  }
});

test('real monotonic startup timer reaches failed-check choice without an offer when discovery never settles', { timeout: 5000 }, async () => {
  const f = launcherFixture({ candidate: null, choices:['play'] });
  f.update.clock = { now: () => performance.now(), setTimeout, clearTimeout };
  let signal;
  f.update.discover = options => { signal = options.signal; return new Promise(() => {}); };
  const began = performance.now();
  assert.equal(await f.session.run(), 'play');
  const elapsed = performance.now() - began;
  assert.ok(elapsed >= 2950, `unexpected early check completion: ${elapsed}ms`);
  assert.ok(elapsed < 3500, `startup check exceeded its timer scheduling allowance: ${elapsed}ms`);
  assert.equal(signal.aborted, true); assert.equal(f.counts.launches, 1); assert.equal(f.counts.offers, 0);
  assert.equal((await f.update.check()).checkOutcome, 'timeout');
});

test('failed cancellation cleanup cannot skip recovery or launch an unconfirmed working copy', async () => {
  const f = launcherFixture(); let recovered = false;
  f.ui.progress = async (_state, cancel) => { await cancel(); };
  f.store.discardPrepared = async () => { throw Error('staging cleanup denied'); };
  f.session.recoverWorking = async error => { assert.match(error.message, /cleanup denied/); recovered = true; return true; };
  f.ui.failure = async (_state, options) => { assert.equal(recovered, true); assert.equal(options.playable, true); return 'play'; };
  assert.equal(await f.session.run(), 'play'); assert.equal(f.counts.prepares, 0); assert.equal(f.counts.launches, 1);
  const unknown = launcherFixture(); unknown.session.activate = async () => { throw Error('install failed'); };
  unknown.session.recoverWorking = async () => { throw Error('working copy unavailable'); };
  unknown.ui.failure = async (_state, options) => { assert.equal(options.playable, false); return 'quit'; };
  assert.equal(await unknown.session.run(), 'quit'); assert.equal(unknown.counts.launches, 0);
});

test('previously consented ready B owns startup over compatible or unavailable newer C without discovery', async () => {
  for (const component of ['content', 'shell-required']) for (const prepared of ['content', 'shell']) {
    const f = launcherFixture({ candidate: { component, manifest: { gameVersion: '3.0.0' } } });
    if (prepared === 'content') f.store.ready = { gameVersion: '2.0.0' };
    else f.update.readyShell = () => ({ version: '2.0.0' });
    let installedVersion;
    f.ui.installing = async state => { installedVersion = state.version; };
    if (prepared === 'shell') f.session.activate = async () => ({ handoff: true });
    assert.equal(await f.session.run(), prepared === 'shell' ? 'handoff' : 'play');
    assert.equal(installedVersion, '2.0.0'); assert.equal(f.counts.discovery, 0); assert.equal(f.counts.offers, 0); assert.equal(f.counts.prepares, 0);
  }
});

test('current status waits for Play or Exit; an acknowledged candidate resumes game without another choice',async()=>{
 const f=launcherFixture({candidate:null});let choose;f.ui.status=async()=>new Promise(resolve=>choose=resolve);const run=f.session.run();await tick();assert.equal(f.counts.launches,0);choose('quit');assert.equal(await run,'quit');assert.equal(f.counts.launches,0);assert.equal(f.counts.quits,1);
 const resumed=launcherFixture({candidate:null});resumed.session.resumeLaunch=true;assert.equal(await resumed.session.run(),'play');assert.equal(resumed.counts.statuses,0);assert.equal(resumed.counts.launches,1);
});

test('historical failure is not presented as a newly confirmed rollback',async()=>{
 const f=launcherFixture({candidate:null});f.update.startupError=true;f.ui.failure=async(_state,options)=>{assert.equal(options.historical,true);assert.equal(options.recovery,undefined);return 'play';};assert.equal(await f.session.run(),'play');
});
