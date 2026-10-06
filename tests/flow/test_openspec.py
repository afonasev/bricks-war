"""Integration smoke against installed OpenSpec; skips if CLI is unavailable."""
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

@unittest.skipUnless(shutil.which('openspec'),'OpenSpec CLI not installed')
class OpenSpecSmoke(unittest.TestCase):
    def test_all_routes_create_validate_apply(self):
        project=Path(__file__).resolve().parents[2]
        source=project/'openspec'
        with tempfile.TemporaryDirectory(prefix='flow-openspec-') as t:
            root=Path(t);shutil.copytree(source,root/'openspec')
            def run(*args):
                result=subprocess.run(['openspec',*args],cwd=root,capture_output=True,text=True)
                self.assertEqual(result.returncode,0,result.stdout+result.stderr)
                return result.stdout
            for route in ['quick','standard','initiative']:
                with self.subTest(route=route):
                    name='test-'+route
                    run('schema','validate','flow-'+route,'--json')
                    run('new','change',name,'--schema','flow-'+route)
                    d=root/'openspec/changes'/name
                    (d/'proposal.md').write_text('# Why\nA reproducible fixture.\n\n# What Changes\nAdd a status indicator.\n\n# Impact\nTest fixture only.\n')
                    (d/'tasks.md').write_text('# Tasks\n- [ ] 1.1 Verify the agreed outcome.\n')
                    if route=='standard':(d/'design.md').write_text('# Design\nUse the existing indicator.\n')
                    if route!='initiative':
                        sp=d/'specs/status';sp.mkdir(parents=True)
                        (sp/'spec.md').write_text('## Purpose\nProvide a clear visible status indicator so users can identify the current state.\n\n## ADDED Requirements\n\n### Requirement: Status indicator\nThe system SHALL display the current status.\n\n#### Scenario: Current status\n- **WHEN** the user opens the view\n- **THEN** the current status is displayed\n')
                    json.loads(run('status','--change',name,'--json'))
                    instructions=json.loads(run('instructions','apply','--change',name,'--json'))
                    self.assertEqual(instructions['state'],'ready')
                    run('validate',name,'--strict')
