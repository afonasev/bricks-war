/** Equal-seed, swapped-seat production-engine diagnostic. No renderer or audio. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { build } from 'esbuild';
import { AiController } from '../src/controllers/ai';
import { DEFAULT_GAME_TUNING, type GameTuning } from '../src/domain/gameTuning';
import { BOARD_HEIGHT, BOARD_WIDTH, type BoardState, type GameAction } from '../src/domain/types';
import { MatchEngine, FIXED_STEP_MS } from '../src/simulation/match';

const args = process.argv.slice(2);
if (!args.includes('-muted')) throw new Error('Headless game diagnostics require -muted; no audio subsystem is imported');
const option = (name: string, fallback: string) => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const output = option('output', 'evidence/strengthen-expert-ai/diagnostics');
const baselineRef = option('baseline', '1f7133da7b5a50f095567c95a9289251bbdd47a8');
const firstSeed = Number(option('first-seed', '1'));
const count = Number(option('seeds', '24'));
const variants = option('variants', 'baseline,hard-tempo,hard-aggression,candidate').split(',');
const opponent = option('opponent', 'hard');
const battleDifficulty = option('battle', 'normal') as 'normal' | 'family' | 'sport';
const conflictEnabled = option('conflict', 'true') === 'true';
if (!Number.isInteger(firstSeed) || !Number.isInteger(count) || count < 1 || count > 1000) throw new Error('Invalid seed range');
if (!['hard', 'baseline'].includes(opponent) || !['normal', 'family', 'sport'].includes(battleDifficulty)) throw new Error('Invalid matchup');
if (variants.some(v => !['baseline', 'hard-tempo', 'hard-aggression', 'candidate'].includes(v))) throw new Error('Invalid variant');
await mkdir(dirname(output), { recursive: true });
await mkdir(output); // Never overwrite an earlier experiment.
// Freeze the actual original controller, not a hand-written approximation.
const original = execFileSync('git', ['show', `${baselineRef}:src/controllers/ai.ts`], { encoding: 'utf8' });
const bundled = await build({ stdin: { contents: original, loader: 'ts', resolveDir: resolve('src/controllers') }, bundle: true, platform: 'node', format: 'esm', write: false });
const baseline = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles![0]!.text).toString('base64')}`) as { AiController: typeof AiController };
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const sourceHashes = Object.fromEntries(await Promise.all(['src/controllers/ai.ts', 'src/simulation/match.ts', 'src/simulation/board.ts', 'config/game-tuning.json', 'tools/compare-expert-ai.ts'].map(async path => [path, hash(await readFile(path, 'utf8'))])));
const metadata = { baselineRef, baselineHash: hash(original), revision, sourceHashes, firstSeed, count, variants, opponent, battleDifficulty, conflictEnabled, stepMs: FIXED_STEP_MS, durationMinutes: 5, audio: 'no renderer/audio imported; -muted required', tuning: DEFAULT_GAME_TUNING };
await writeFile(`${output}/plan.json`, JSON.stringify(metadata, null, 2));

function boardRisk(board: BoardState) {
  let height = 0, holes = 0;
  for (let x = 0; x < BOARD_WIDTH; x++) {
    let occupied = false;
    for (let y = 0; y < BOARD_HEIGHT; y++) {
      if (board.grid[y]![x]) { occupied = true; height = Math.max(height, BOARD_HEIGHT - y); }
      else if (occupied) holes++;
    }
  }
  return { height, holes };
}

function play(seed: number, swap: boolean, variant: string) {
  const tuning: GameTuning = structuredClone(DEFAULT_GAME_TUNING);
  if (variant === 'hard-tempo') {
    tuning.ai.expert.reactionMs = tuning.ai.hard.reactionMs;
    tuning.ai.expert.dropTapIntervalMs = tuning.ai.hard.dropTapIntervalMs;
  }
  if (variant === 'hard-aggression') tuning.ai.expert.conflictIntentChance = tuning.ai.hard.conflictIntentChance;
  const subjectId = swap ? 'p2' : 'p1';
  const configs = ['p1', 'p2'].map(id => ({ id, label: id, controller: 'ai' as const, difficulty: id === subjectId || opponent === 'baseline' ? 'expert' as const : 'hard' as const }));
  const engine = new MatchEngine(configs, seed, 5, { battleDifficulty, conflictEnabled }, DEFAULT_GAME_TUNING);
  const controllers = new Map(configs.map(c => {
    const subject = c.id === subjectId;
    const Controller = subject && variant === 'candidate' ? AiController : baseline.AiController;
    return [c.id, new Controller(seed, c.id, c.difficulty, conflictEnabled, subject ? tuning : DEFAULT_GAME_TUNING)];
  }));
  const metrics = Object.fromEntries(configs.map(c => [c.id, { samples: 0, height: 0, holes: 0, maxHeight: 0, attackRows: 0, defended: 0, actions: 0, decisionMs: 0 }]));
  const lastSpawn = new Map<string, number>();
  const seenAttacks = new Set<number>(), seenDefense = new Set<number>();
  const digest = createHash('sha256');
  let frames = 0;
  while (engine.state.phase !== 'results' && frames < 100_000) {
    const actions = new Map<string, GameAction[]>();
    if (engine.acceptsGameplayInput()) for (const p of engine.state.participants) {
      const start = performance.now();
      const decisions = controllers.get(p.config.id)!.actions(p.board, engine.state.elapsedMs, (engine.state.pendingConflict?.incomingRows[p.config.id] ?? 0) > 0);
      metrics[p.config.id]!.decisionMs += performance.now() - start;
      metrics[p.config.id]!.actions += decisions.length;
      actions.set(p.config.id, decisions);
      if (decisions.length) digest.update(`${frames}:${p.config.id}:${decisions.join(',')};`);
    }
    engine.step(FIXED_STEP_MS, actions); frames++;
    for (const p of engine.state.participants) {
      if (lastSpawn.get(p.config.id) === p.board.spawnSerial) continue;
      lastSpawn.set(p.config.id, p.board.spawnSerial);
      const risk = boardRisk(p.board), m = metrics[p.config.id]!;
      m.samples++; m.height += risk.height; m.holes += risk.holes; m.maxHeight = Math.max(m.maxHeight, risk.height);
    }
    for (const attack of engine.state.attackLaunchEvents) if (!seenAttacks.has(attack.serial)) {
      seenAttacks.add(attack.serial); metrics[attack.participantId]!.attackRows += attack.rows;
    }
    for (const [id, queue] of Object.entries(engine.state.attackQueues)) for (const attack of queue) if (attack.defended && !seenDefense.has(attack.serial)) {
      seenDefense.add(attack.serial); metrics[id]!.defended++;
    }
  }
  const complete = engine.state.phase === 'results';
  const participants = engine.state.participants.map(p => {
    const m = metrics[p.config.id]!;
    return { id: p.config.id, subject: p.config.id === subjectId, alive: p.board.alive, survivalMs: p.survivalMs, eliminatedAtMs: p.eliminatedAtMs, placedPieces: p.placedPieces, score: p.score, ...m, meanHeight: m.height / m.samples, meanHoles: m.holes / m.samples };
  });
  return { seed, swap, variant, opponent, status: complete ? 'PASS' : 'NotRun', winnerIds: engine.state.winnerIds, outcome: !complete ? 'NotRun' : engine.state.winnerIds.length !== 1 ? 'tie' : engine.state.winnerIds[0] === subjectId ? 'win' : 'loss', endReason: engine.state.endReason, elapsedMs: engine.state.elapsedMs, frames, digest: digest.digest('hex'), participants };
}

const results: ReturnType<typeof play>[] = [];
const started = performance.now();
for (let seed = firstSeed; seed < firstSeed + count; seed++) {
  for (const variant of variants) for (const swap of [false, true]) results.push(play(seed, swap, variant));
  // Checkpoint every complete seed; an interruption preserves partial data honestly.
  await writeFile(`${output}/matches.json`, JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ seed, matches: results.length, seconds: (performance.now() - started) / 1000 }));
}
const summaries = variants.map(variant => {
  const matches = results.filter(r => r.variant === variant);
  const subjects = matches.map(r => r.participants.find(p => p.subject)!);
  const mean = (values: number[]) => values.reduce((a,b) => a+b, 0) / values.length;
  return { variant, opponent, games: matches.length, wins: matches.filter(m => m.outcome === 'win').length, losses: matches.filter(m => m.outcome === 'loss').length, ties: matches.filter(m => m.outcome === 'tie').length, notRun: matches.filter(m => m.outcome === 'NotRun').length, meanSurvivalMs: mean(subjects.map(p => p.survivalMs)), meanHeight: mean(subjects.map(p => p.meanHeight)), meanHoles: mean(subjects.map(p => p.meanHoles)), meanAttackRows: mean(subjects.map(p => p.attackRows)), meanDefended: mean(subjects.map(p => p.defended)), meanPieces: mean(subjects.map(p => p.placedPieces)), decisionMs: subjects.reduce((a,p) => a+p.decisionMs,0) };
});
await writeFile(`${output}/summary.json`, JSON.stringify({ ...metadata, wallSeconds: (performance.now() - started) / 1000, summaries }, null, 2));
console.log(JSON.stringify(summaries, null, 2));
if (results.some(r => r.status !== 'PASS')) process.exitCode = 1;
