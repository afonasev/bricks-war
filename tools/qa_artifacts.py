#!/usr/bin/env python3
"""Prevent generated QA outputs from entering Git; install a shared worktree hook."""
import argparse
import os
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import sys

QA_PREFIXES = ('evidence/', 'artifacts/', 'test-results/', 'playwright-report/', 'coverage/', 'build/', 'dist/')
SOURCE_SUFFIXES = {'.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.sh', '.html', '.css', '.scss', '.glsl', '.vert', '.frag', '.yml', '.yaml', '.toml', '.ini', '.cfg', '.svg', '.md', '.m', '.mm', '.c', '.h', '.cpp', '.cs', '.swift', '.rs', '.go', '.rb', '.java'}
FIXTURES = {'evidence/toy-workshop-arena/concepts/workshop.png'}
MARKER = '# bricks-war-qa-artifact-guard'


def is_raw_qa(path):
    if not path.startswith(QA_PREFIXES) or path in FIXTURES:
        return False
    source_area = path.startswith(('evidence/', 'artifacts/ui-prototype/'))
    name = PurePosixPath(path)
    if source_area and (name.suffix.lower() in SOURCE_SUFFIXES or name.name in {'package.json', 'package-lock.json', 'tsconfig.json', 'LICENSE', 'LICENSES'}):
        return False
    return True


def check_staged():
    paths = subprocess.check_output(['git', 'diff', '--cached', '--name-only', '--diff-filter=ACMR', '--no-renames', '-z']).split(b'\0')
    rejected = [os.fsdecode(p) for p in paths if p and is_raw_qa(os.fsdecode(p))]
    if rejected:
        print('Raw QA artifacts must stay outside Git. Commit compact results with external paths/hashes instead:', file=sys.stderr)
        for path in rejected:
            print('  ' + path, file=sys.stderr)
        return 1
    return 0


def install():
    configured = subprocess.run(['git', 'config', '--get', 'core.hooksPath'], capture_output=True, text=True)
    if configured.returncode == 0:
        raise ValueError('Custom core.hooksPath is configured; chain check-staged into that hook without overriding it')
    common = Path(subprocess.check_output(['git', 'rev-parse', '--path-format=absolute', '--git-common-dir'], text=True).strip())
    hook = common / 'hooks/pre-commit'
    if hook.exists() and MARKER not in hook.read_text():
        raise ValueError('Existing pre-commit hook preserved; chain check-staged into it explicitly')
    hook.parent.mkdir(parents=True, exist_ok=True)
    guard = common / 'qa-artifact-guard.py'
    shutil.copyfile(Path(__file__).resolve(), guard)
    hook.write_text('#!/bin/sh\n' + MARKER + '\nexec python3 "$(git rev-parse --git-common-dir)/qa-artifact-guard.py" check-staged\n')
    hook.chmod(0o755)
    print('Installed shared QA artifact guard: ' + str(hook))
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['check-staged', 'install'])
    args = parser.parse_args()
    try:
        return install() if args.command == 'install' else check_staged()
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        print(str(error), file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
