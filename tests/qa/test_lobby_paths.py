import json
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
HELPER = (ROOT / 'tools/lobby-qa-paths.mjs').as_uri()


class LobbyPathTests(unittest.TestCase):
    def allocate(self, cwd, env=None):
        script = (f"import {{ lobbyQaPaths }} from {json.dumps(HELPER)};"
                  "const env = JSON.parse(process.argv[1]);"
                  "const paths = lobbyQaPaths(env, process.argv[2]);"
                  "console.log(JSON.stringify({paths, env}));")
        result = subprocess.run(['node', '--input-type=module', '-e', script,
                                 json.dumps(env or {}), str(cwd)],
                                capture_output=True, text=True, check=True)
        return json.loads(result.stdout)

    def test_independent_runs_preserve_prior_report_and_artifacts(self):
        with tempfile.TemporaryDirectory() as cwd:
            first = self.allocate(cwd)['paths']
            sentinels = [Path(first['report']), Path(first['runtime']) / 'screen.png',
                         Path(first['artifacts']) / 'failure.txt']
            for path in sentinels:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(b'prior evidence')
            second = self.allocate(cwd)['paths']
            for key in first:
                self.assertNotEqual(first[key], second[key])
            for path in sentinels:
                self.assertEqual(path.read_bytes(), b'prior evidence')
            self.assertEqual(Path(first['report']).parent, Path(first['runDir']))
            self.assertEqual(Path(first['runtime']).parent, Path(first['runDir']))
            self.assertEqual(Path(first['artifacts']).parent, Path(first['runDir']))

    def test_overrides_cannot_overwrite_existing_evidence(self):
        with tempfile.TemporaryDirectory() as cwd:
            hint = Path(cwd) / 'accepted.json'
            hint.write_bytes(b'accepted')
            env = {'BRICKS_LOBBY_OUTPUT': 'durable', 'BRICKS_LOBBY_REPORT': str(hint),
                   'PLAYWRIGHT_JSON_OUTPUT_FILE': str(Path(cwd) / 'global.json'),
                   'BRICKS_LOBBY_EVIDENCE': 'screens'}
            first = self.allocate(cwd, env)
            second = self.allocate(cwd, env)
            for result in [first, second]:
                paths = result['paths']
                self.assertEqual(Path(paths['runDir']).parent, Path(cwd) / 'durable')
                self.assertEqual(Path(paths['report']).name, hint.name)
                self.assertNotEqual(Path(paths['report']), hint)
                self.assertEqual(result['env']['PLAYWRIGHT_JSON_OUTPUT_FILE'], paths['report'])
                self.assertEqual(result['env']['BRICKS_LOBBY_EVIDENCE'], paths['runtime'])
                self.assertEqual(Path(paths['runtime']).parent.parent, Path(cwd) / 'screens')
            self.assertNotEqual(first['paths']['report'], second['paths']['report'])
            self.assertEqual(hint.read_bytes(), b'accepted')
            global_only = self.allocate(cwd, {'PLAYWRIGHT_JSON_OUTPUT_FILE': str(hint)})
            self.assertNotEqual(Path(global_only['paths']['report']), hint)
            self.assertEqual(hint.read_bytes(), b'accepted')

    def test_worker_inherits_run_and_new_primary_allocates_again(self):
        with tempfile.TemporaryDirectory() as cwd:
            primary = self.allocate(cwd)
            worker = self.allocate(cwd, {**primary['env'], 'TEST_WORKER_INDEX': '0'})
            self.assertEqual(worker['paths'], primary['paths'])
            self.assertEqual(len(list((Path(cwd) / 'test-results/lobby').iterdir())), 1)
            next_run = self.allocate(cwd, primary['env'])
            self.assertNotEqual(next_run['paths']['runDir'], primary['paths']['runDir'])
