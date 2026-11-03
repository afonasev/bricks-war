import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
GUARD = ROOT / 'tools/qa_artifacts.py'
SPEC = importlib.util.spec_from_file_location('artifact_guard', GUARD)
guard = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(guard)


class ArtifactGuardTests(unittest.TestCase):
    def test_generated_outputs_are_blocked_and_source_inputs_remain_allowed(self):
        for path in ['evidence/run/report.json', 'evidence/run/screen.png', 'evidence/log.tap', 'artifacts/qa/trace.zip', 'test-results/test.txt', 'build/package.js']:
            with self.subTest(path=path):
                self.assertTrue(guard.is_raw_qa(path))
        for path in ['src/game.ts', 'docs/release-notes/1.15.0/image.png', 'evidence/run/capture.mjs', 'evidence/run/summary.md', 'artifacts/ui-prototype/index.html', *guard.FIXTURES]:
            with self.subTest(path=path):
                self.assertFalse(guard.is_raw_qa(path))

    def test_installed_hook_blocks_forced_add_in_linked_worktree_and_allows_source(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'repo'
            root.mkdir()
            env = {**os.environ, 'GIT_CONFIG_GLOBAL': os.devnull, 'GIT_CONFIG_NOSYSTEM': '1'}
            def run(*args, cwd=root, check=True):
                result = subprocess.run(args, cwd=cwd, env=env, capture_output=True, text=True)
                if check and result.returncode:
                    raise AssertionError(f'{args}: {result.stdout} {result.stderr}')
                return result
            run('git', 'init', '-q')
            run('git', 'config', 'user.email', 'qa@example.test')
            run('git', 'config', 'user.name', 'QA')
            (root / '.gitignore').write_text('/evidence/\n')
            run('git', 'add', '.gitignore')
            run('git', 'commit', '-qm', 'baseline')
            run('python3', str(GUARD), 'install')
            other = Path(directory) / 'worktree'
            run('git', 'worktree', 'add', '-qb', 'work', str(other))
            raw = other / 'evidence/run/report.json'
            raw.parent.mkdir(parents=True)
            raw.write_text('{}')
            run('git', 'add', '-f', str(raw), cwd=other)
            result = run('git', 'commit', '-qm', 'must fail', cwd=other, check=False)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('Raw QA artifacts', result.stderr)
            run('git', 'reset', '-q', cwd=other)
            script = other / 'evidence/run/capture.mjs'
            script.write_text('export const capture = true;\n')
            run('git', 'add', '-f', str(script), cwd=other)
            run('git', 'commit', '-qm', 'source retained', cwd=other)
            # Existing tracked raw files are checked too, so .gitignore cannot mask overwrites.
            run('git', '-c', 'core.hooksPath=/dev/null', 'add', '-f', str(raw), cwd=other)
            run('git', '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'legacy raw fixture', cwd=other)
            raw.write_text('{"changed":true}')
            run('git', 'add', '-u', cwd=other)
            self.assertNotEqual(run('python3', str(GUARD), 'check-staged', cwd=other, check=False).returncode, 0)

    def test_custom_hook_is_never_overwritten(self):
        with tempfile.TemporaryDirectory() as directory:
            subprocess.run(['git', 'init', '-q', directory], check=True)
            hook = Path(directory) / '.git/hooks/pre-commit'
            hook.write_text('#!/bin/sh\nexit 0\n')
            result = subprocess.run(['python3', str(GUARD), 'install'], cwd=directory, capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(hook.read_text(), '#!/bin/sh\nexit 0\n')


class ExternalPathTests(unittest.TestCase):
    def test_python_and_node_defaults_match_and_worktrees_are_isolated(self):
        spec = importlib.util.spec_from_file_location('qa_storage', ROOT / 'tools/qa.py')
        qa = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(qa)
        script = f"import {{ qaArtifactRoot }} from {json.dumps((ROOT / 'tools/qa-artifact-paths.mjs').as_uri())}; console.log(qaArtifactRoot());"
        actual = subprocess.check_output(['node', '--input-type=module', '-e', script], cwd=ROOT, text=True).strip()
        self.assertEqual(qa.artifact_parent().parent, Path(actual))
        self.assertFalse(Path(actual).is_relative_to(ROOT))

    def test_legacy_raw_paths_ignored_but_required_fixture_and_prototype_are_not(self):
        for path in ['evidence/new/run.json', 'artifacts/qa/screen.png', 'artifacts/playtest/test.png']:
            self.assertEqual(subprocess.run(['git', 'check-ignore', '--no-index', '-q', path], cwd=ROOT).returncode, 0)
        for path in [*guard.FIXTURES, 'artifacts/ui-prototype/index.html', 'docs/release-notes/new/image.png']:
            self.assertEqual(subprocess.run(['git', 'check-ignore', '--no-index', '-q', path], cwd=ROOT).returncode, 1)
