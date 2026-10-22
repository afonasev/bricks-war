import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location('source_flow', Path(__file__).resolve().parents[2] / 'tools/flow.py')
flow = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(flow)


class SourceFinalizationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / 'openspec/changes').mkdir(parents=True)
        self.git('init', '-b', 'main')
        self.git('config', 'user.email', 'test@example.invalid')
        self.git('config', 'user.name', 'Test')
        (self.root / 'source').write_text('verified source')
        self.git('add', 'source')
        self.git('commit', '-m', 'source')
        self.sha = self.git('rev-parse', 'HEAD')
        self.f = flow.Flow(self.root)

    def git(self, *args):
        return subprocess.check_output(['git', '-C', str(self.root), *args], stderr=subprocess.DEVNULL, text=True).strip()

    def merged(self, result_type='technical', rationale='Local internal tooling, no player-visible or gameplay change'):
        p = self.root / 'openspec/changes/example'
        p.mkdir()
        (p / '.openspec.yaml').write_text('schema: flow-quick\n')
        self.f.init('example', 'quick', 'software')
        self.f.evidence('example', 'scope', {'result_type': result_type, 'acceptance_rationale': rationale})
        self.f.transition('example', 'ready')
        self.f.claim('example', 'worker')
        self.f.transition('example', 'implementing', 'worker')
        self.f.evidence('example', 'commit', self.sha)
        self.f.evidence('example', 'verification', {'result': 'pass'})
        self.f.transition('example', 'verified', 'worker')
        self.f.evidence('example', 'merge', {'repo': str(self.root), 'commit': self.sha, 'main_ref': 'main'})
        self.f.transition('example', 'merged', 'worker')

    def source_finalizing(self):
        self.f.evidence('example', 'source_finalization', {'revision': self.sha, 'status': 'not-published', 'reason': 'Deploy not requested'})
        self.f.transition('example', 'finalizing', 'worker')
        for key in ['spec_sync', 'cleanup']:
            self.f.evidence('example', key, {'result': 'verified'})
        (self.root / 'openspec/changes/example/acceptance.md').write_text('Source result, not published')
        self.f.evidence('example', 'acceptance_guide', 'acceptance.md')

    def test_technical_completion_without_fabricated_human_acceptance(self):
        self.merged()
        self.source_finalizing()
        result = self.f.finalize('example', 'worker')
        self.assertEqual(result['stage'], 'completed')
        self.assertIsNone(result['owner'])
        self.assertNotIn('acceptance', result['evidence'])
        item = self.f.inbox()[0]
        self.assertEqual(item['acceptance_status'], 'not-required')
        self.assertEqual(item['publication_status'], 'not-published')
        self.assertFalse(item['acceptance'])
        self.assertFalse(item['finalization_debt'])
        with self.assertRaises(ValueError):
            self.f.transition('example', 'accepted')

    def test_visible_source_can_finalize_but_still_requires_human_review(self):
        self.merged('visible')
        self.source_finalizing()
        self.assertEqual(self.f.finalize('example', 'worker')['stage'], 'awaiting-acceptance')
        self.assertEqual(self.f.inbox()[0]['publication_status'], 'not-published')
        self.f.accept('example', 'Reviewed visible source result', 'human message', self.sha, 'UI source')
        self.assertEqual(self.f.finalize('example')['stage'], 'accepted')
        self.assertFalse(self.f.inbox()[0]['finalization_debt'])

    def test_unknown_classification_or_missing_rationale_remains_human_reviewed(self):
        self.merged()
        for scope in [{}, {'result_type': 'technical'}, {'result_type': 'gameplay', 'acceptance_rationale': 'required'}]:
            self.f.evidence('example', 'scope', scope or {'legacy': True})
            self.assertEqual(self.f.acceptance_status(self.f.get('example')[1]), 'pending')
        p, result = self.f.get('example')
        result['kind'] = 'report'
        result['evidence']['scope'] = {'result_type': 'technical', 'acceptance_rationale': 'report cannot bypass review'}
        self.assertEqual(self.f.acceptance_status(result), 'pending')

    def test_source_finalization_requires_matching_merge_identity(self):
        self.merged()
        with self.assertRaises(ValueError):
            self.f.transition('example', 'finalizing', 'worker')
        self.f.evidence('example', 'source_finalization', {'revision': 'wrong', 'status': 'not-published', 'reason': 'No deploy'})
        with self.assertRaises(ValueError):
            self.f.transition('example', 'finalizing', 'worker')

    def test_source_completion_does_not_satisfy_deployed_dependency(self):
        self.merged()
        self.source_finalizing()
        self.f.finalize('example', 'worker')
        p = self.root / 'openspec/changes/consumer'
        p.mkdir()
        (p / '.openspec.yaml').write_text('schema: flow-quick\n')
        self.f.init('consumer', 'quick', 'report')
        self.f.dependency('consumer', 'example', 'delivered')
        self.assertIn('dependency:example', self.f.blocks(self.f.get('consumer')[1], 'ready'))

    def test_cleanup_debt_and_prior_human_review_cannot_be_bypassed(self):
        self.merged()
        self.source_finalizing()
        self.f.evidence('example', 'cleanup_pending', {'completed': False})
        with self.assertRaises(ValueError):
            self.f.finalize('example', 'worker')
        self.f.evidence('example', 'cleanup_pending', {'completed': True})
        self.f.defer_acceptance('example', 'human message', 'Review later')
        self.assertEqual(self.f.finalize('example', 'worker')['stage'], 'awaiting-acceptance')
        self.assertNotIn('acceptance', self.f.get('example')[1]['evidence'])

    def test_technical_child_must_complete_before_parent_human_acceptance(self):
        self.merged()
        p = self.root / 'openspec/changes/parent'
        p.mkdir()
        (p / '.openspec.yaml').write_text('schema: flow-initiative\n')
        self.f.init('parent', 'initiative', 'initiative')
        path, parent = self.f.get('parent')
        parent['stage'] = 'published'
        parent['children'] = ['example']
        parent['evidence'] = {'publication': {'path': 'report.md'}}
        self.f.save(path, parent, 'fixture-parent')
        with self.assertRaises(ValueError):
            self.f.accept('parent', 'Reviewed', 'human message', 'report.md', 'Initiative')
        self.source_finalizing()
        self.f.finalize('example', 'worker')
        self.assertEqual(self.f.accept('parent', 'Reviewed', 'human message', 'report.md', 'Initiative')['stage'], 'published')
