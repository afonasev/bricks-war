import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
from contextlib import redirect_stdout


ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('qa_tools', ROOT / 'tools' / 'qa.py')
qa = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(qa)


class VitestReportTests(unittest.TestCase):
    files = ['tests/menuSelect.test.ts']

    def report(self):
        return {
            'success': True,
            'numTotalTests': 1,
            'numPassedTests': 1,
            'numFailedTests': 0,
            'numPendingTests': 0,
            'numTodoTests': 0,
            'testResults': [{
                'name': str(ROOT / self.files[0]),
                'status': 'passed',
                'assertionResults': [{'status': 'passed', 'duration': 2, 'fullName': 'menu opens'}],
            }],
        }

    def test_accepts_valid_nonempty_report(self):
        self.assertEqual(qa.validate_vitest(self.report(), self.files)['passed'], 1)

    def test_enforces_required_assertion_manifest(self):
        required = {'tests/menuSelect.test.ts': ['menu opens']}
        self.assertEqual(qa.validate_vitest(self.report(), self.files, required)['passed'], 1)
        for missing_name in ['renamed test', '']:
            report = self.report()
            report['testResults'][0]['assertionResults'][0]['fullName'] = missing_name
            with self.subTest(fullName=missing_name):
                with self.assertRaises(ValueError):
                    qa.validate_vitest(report, self.files, required)

    def test_rejects_empty_or_missing_selected_unit_file(self):
        for report in ({**self.report(), 'testResults': []},
                       {**self.report(), 'testResults': [dict(self.report()['testResults'][0], assertionResults=[])]}):
            with self.subTest(report=report):
                with self.assertRaises(ValueError):
                    qa.validate_vitest(report, self.files)

    def test_rejects_failed_pending_todo_and_mismatched_counts(self):
        bad_reports = []
        for key, value in [('success', False), ('numFailedTests', 1),
                           ('numPendingTests', 1), ('numTodoTests', 1),
                           ('numTotalTests', 2), ('numPassedTests', 0)]:
            bad_reports.append({**self.report(), key: value})
        for status in ['failed', 'pending', 'todo']:
            base = self.report()
            suite = dict(base['testResults'][0])
            suite['assertionResults'] = [{'status': status}]
            bad_reports.append({**base, 'testResults': [suite]})
        other_file = dict(self.report()['testResults'][0], name=str(ROOT / 'tests/screenRouter.test.ts'))
        bad_reports.append({**self.report(), 'testResults': [other_file]})
        for report in bad_reports:
            with self.subTest(report=report):
                with self.assertRaises(ValueError):
                    qa.validate_vitest(report, self.files)


class PlaywrightReportTests(unittest.TestCase):
    expected = [('desktop-fit.spec.ts', 'all desktop screens fit 1440x960')]

    def report(self):
        return {
            'suites': [{
                'specs': [{
                    'file': 'tests/e2e/desktop-fit.spec.ts',
                    'title': self.expected[0][1],
                    'ok': True,
                    'tests': [{
                        'expectedStatus': 'passed',
                        'status': 'expected',
                        'results': [{'status': 'passed'}],
                    }],
                }],
                'suites': [],
            }],
            'stats': {'expected': 1, 'unexpected': 0, 'skipped': 0, 'flaky': 0, 'duration': 12},
            'errors': [],
        }

    def test_accepts_valid_required_scenario(self):
        self.assertEqual(qa.validate_playwright(self.report(), self.expected)['passed'], 1)

    def test_rejects_empty_and_missing_required_scenario(self):
        for report in ({**self.report(), 'suites': []}, self.report()):
            with self.subTest(report=report):
                with self.assertRaises(ValueError):
                    qa.validate_playwright(report, [('desktop-fit.spec.ts', 'other scenario')])

    def test_rejects_skipped_failed_flaky_retried_interrupted_and_errors(self):
        bad_reports = []
        for stats_key in ['skipped', 'unexpected', 'flaky']:
            bad_reports.append({**self.report(), 'stats': {**self.report()['stats'], stats_key: 1}})
        bad_reports.append({**self.report(), 'errors': [{'message': 'collection error'}]})
        for status, results in [
            ('skipped', [{'status': 'skipped'}]),
            ('unexpected', [{'status': 'failed'}]),
            ('interrupted', [{'status': 'interrupted'}]),
            ('expected', [{'status': 'passed'}, {'status': 'passed'}]),
        ]:
            spec = dict(self.report()['suites'][0]['specs'][0])
            spec['tests'] = [dict(spec['tests'][0], status=status, results=results)]
            bad_reports.append({**self.report(), 'suites': [{'specs': [spec], 'suites': []}]})
        for report in bad_reports:
            with self.subTest(report=report):
                with self.assertRaises(ValueError):
                    qa.validate_playwright(report, self.expected)


class LoadReportTests(unittest.TestCase):
    def test_rejects_missing_and_invalid_json(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'report.json'
            with self.assertRaises(OSError):
                qa.load_report(path)
            path.write_text('{invalid json')
            with self.assertRaises(json.JSONDecodeError):
                qa.load_report(path)

    def test_main_rejects_exit_zero_without_fresh_report_despite_stale_parent_report(self):
        with tempfile.TemporaryDirectory() as directory:
            output_parent = Path(directory)
            (output_parent / 'unit.json').write_text(json.dumps({'success': True}))
            args = ['qa.py', 'unit-ui', '--reason', 'contract', '--output', str(output_parent)]
            with patch.object(sys, 'argv', args), patch.object(
                    qa, 'run_command', return_value={'exit_code': 0, 'wall_seconds': 0.01}):
                with redirect_stdout(io.StringIO()):
                    self.assertEqual(qa.main(), 1)
            run_dirs = [path for path in output_parent.iterdir() if path.is_dir()]
            self.assertEqual(len(run_dirs), 1)
            result = json.loads((run_dirs[0] / 'result.json').read_text())
            self.assertFalse(result['passed'])
            self.assertIn('error', result)
            self.assertIn('unit.json', result['error'])


if __name__ == '__main__':
    unittest.main()
