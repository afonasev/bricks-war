#!/usr/bin/env python3
"""Explicit QA commands with nonempty, fail-closed, per-run evidence. See qa-scope.md."""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time
import uuid

ROOT = Path(__file__).resolve().parent.parent
UI_FILES = ['tests/menuSelect.test.ts', 'tests/screenRouter.test.ts',
            'tests/arenaLayout.test.ts', 'tests/arenaCardPalette.test.ts',
            'tests/hudIdentity.test.ts', 'tests/mobileSettings.test.ts']
UI_BROWSER = [
    ('desktop-fit.spec.ts', 'all desktop screens fit 1440x960'),
    ('desktop-fit.spec.ts', 'all desktop screens fit 1280x480'),
    ('mobile-release-parity.spec.ts', 'keeps the supported phone release flow touch-accessible'),
    ('mobile-release-parity.spec.ts', 'explains phone controls and omits desktop-only fullscreen settings'),
]


def validate_vitest(report, expected_files, required_assertions=None):
    suites = report.get('testResults', [])
    assertions = [a for s in suites for a in s.get('assertionResults', [])]
    actual = {Path(s['name']).resolve() for s in suites if s.get('assertionResults')}
    expected = {(ROOT / f).resolve() for f in expected_files}
    if (report.get('success') is not True or not assertions or actual != expected
            or any(s.get('status') != 'passed' for s in suites)
            or any(a.get('status') != 'passed' for a in assertions)
            or report.get('numTotalTests') != len(assertions)
            or report.get('numPassedTests') != len(assertions)
            or any(report.get(k, 0) for k in ['numFailedTests', 'numPendingTests', 'numTodoTests'])):
        raise ValueError('Vitest report is empty, failed, skipped or missing selected files')
    if required_assertions is not None:
        observed = {str(Path(s['name']).resolve().relative_to(ROOT)): {a['fullName'] for a in s['assertionResults']} for s in suites}
        if any(not set(names) <= observed.get(f, set()) for f, names in required_assertions.items()):
            raise ValueError('Missing mandatory UI assertion; review manifest before changing coverage')
    return {'files': len(actual), 'passed': len(assertions),
            'assertion_duration_sum_ms': sum(a.get('duration', 0) or 0 for a in assertions)}


def validate_playwright(report, expected=None):
    found = []
    def visit(suite):
        for spec in suite.get('specs', []):
            found.append((Path(spec['file']).name, spec['title']))
            tests = spec.get('tests', [])
            if not tests or spec.get('ok') is not True:
                raise ValueError('Browser scenario did not pass')
            for test in tests:
                results = test.get('results', [])
                if (test.get('expectedStatus') != 'passed' or test.get('status') != 'expected'
                        or len(results) != 1 or results[0].get('status') != 'passed'):
                    raise ValueError('Browser scenario failed, skipped, interrupted or retried')
        for child in suite.get('suites', []):
            visit(child)
    for suite in report.get('suites', []):
        visit(suite)
    stats = report.get('stats', {})
    if (not found or report.get('errors') or any(stats.get(k, 0) for k in ['unexpected', 'skipped', 'flaky'])
            or stats.get('expected') != len(found)
            or (expected is not None and sorted(found) != sorted(expected))):
        raise ValueError('Browser report is empty or missing required scenarios')
    return {'passed': len(found), 'scenarios': found, 'report_duration_ms': stats.get('duration')}


def load_report(path):
    return json.loads(path.read_text())  # Fresh directory per invocation; no stale report reuse.


def run_command(command, directory, label, env=None):
    started = time.monotonic()
    with (directory / (label + '.log')).open('w') as log:
        result = subprocess.run(command, cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT)
    return {'command': command, 'exit_code': result.returncode,
            'wall_seconds': round(time.monotonic() - started, 4), 'log': label + '.log'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('route', choices=['unit-ui', 'ui', 'focused', 'full'])
    parser.add_argument('--reason', required=True, help='Behavior, dependencies and why this scope is sufficient')
    parser.add_argument('--output', default='test-results/qa', help='Parent directory; every run creates a unique child')
    parser.add_argument('files', nargs='*', help='focused: explicit tests/*.test.ts; not an integration gate alone')
    args = parser.parse_intermixed_args()
    files = args.files if args.route == 'focused' else (sorted(str(p.relative_to(ROOT)) for p in (ROOT / 'tests').rglob('*.test.ts')) if args.route == 'full' else UI_FILES)
    if not args.reason.strip() or (args.route != 'focused' and args.files) or not files:
        parser.error('Nonempty reason and explicit focused files required; other routes have fixed selection')
    if any(not f.startswith('tests/') or not f.endswith('.test.ts') or '..' in Path(f).parts or not (ROOT / f).is_file() for f in files):
        parser.error('Use existing explicit tests/*.test.ts paths, no globs or options')
    directory = Path(args.output).resolve() / (datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S') + '-' + uuid.uuid4().hex[:8])
    directory.mkdir(parents=True)
    diff = subprocess.check_output(['git', 'diff', 'HEAD', '--binary'], cwd=ROOT)
    state = {'route': args.route, 'reason': args.reason, 'cwd': str(ROOT),
             'revision': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
             'git_status': subprocess.check_output(['git', 'status', '--porcelain'], cwd=ROOT, text=True),
             'tracked_diff_sha256': hashlib.sha256(diff).hexdigest(),
             'untracked_source_sha256': {f: hashlib.sha256((ROOT / f).read_bytes()).hexdigest() for f in subprocess.check_output(['git', 'ls-files', '--others', '--exclude-standard'], cwd=ROOT, text=True).splitlines() if not f.startswith('evidence/') and (ROOT / f).is_file()},
             'node_version': subprocess.check_output(['node', '--version'], text=True).strip(),
             'package_versions': {k: json.loads((ROOT / 'node_modules' / k / 'package.json').read_text())['version'] for k in ['vitest', '@playwright/test', 'vite']},
             'selected_files': files, 'checks': [], 'passed': False,
             'host_wait_seconds': None}
    (directory / 'plan.json').write_text(json.dumps(state, indent=2))
    started = time.monotonic()
    try:
        report_path = directory / 'unit.json'
        cmd = ['node', 'node_modules/vitest/vitest.mjs', 'run', '--config', 'vitest.config.ts', *files,
               '--reporter=default', '--reporter=json', '--outputFile=' + str(report_path)]
        check = run_command(cmd, directory, 'unit'); state['checks'].append(check)
        if check['exit_code'] != 0:
            raise ValueError('Unit command failed')
        check['results'] = validate_vitest(load_report(report_path), files, load_report(ROOT / "tools/qa-ui-manifest.json") if args.route in ["ui", "unit-ui"] else None)
        if args.route == 'full':
            check = run_command(['npm', 'run', 'build'], directory, 'build'); state['checks'].append(check)
            if check['exit_code'] != 0:
                raise ValueError('Build failed')
        if args.route in ['ui', 'full']:
            report_path = directory / 'browser.json'
            env = {**os.environ, 'PLAYWRIGHT_JSON_OUTPUT_FILE': str(report_path)}
            config = 'playwright.smoke.config.ts' if args.route == 'ui' else 'playwright.config.ts'
            cmd = ['node', 'node_modules/@playwright/test/cli.js', 'test', '-c', config, '--reporter=list,json']
            check = run_command(cmd, directory, 'browser', env); state['checks'].append(check)
            state['browser_origin'] = f"http://127.0.0.1:{int(os.environ.get('BRICKS_LOCAL_QA_PORT', '4187'))}"
            if check['exit_code'] != 0:
                raise ValueError('Browser command failed')
            check['results'] = validate_playwright(load_report(report_path), UI_BROWSER if args.route == 'ui' else None)
            check['cli_outside_report_seconds'] = round(check['wall_seconds'] - (check['results']['report_duration_ms'] or 0) / 1000, 4)
        state['passed'] = True
    except (ValueError, OSError, KeyError, TypeError) as error:
        state['error'] = str(error)
    finally:
        state['wall_seconds'] = round(time.monotonic() - started, 4)
        (directory / 'result.json').write_text(json.dumps(state, indent=2))
    print(json.dumps({'passed': state['passed'], 'evidence': str(directory), 'wall_seconds': state['wall_seconds'], 'error': state.get('error')}, indent=2))
    return 0 if state['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
