#!/usr/bin/env python3
"""Fail when the authored sources no longer reproduce the committed page."""
import difflib
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'index.html'
checks = 0


def check(value, label):
    global checks
    checks += 1
    if not value:
        raise AssertionError(label)


before = OUT.read_bytes()
run = subprocess.run([sys.executable, str(ROOT / 'build.py')], capture_output=True, text=True)
check(run.returncode == 0, 'build.py succeeds: ' + run.stderr[-500:])
after = OUT.read_bytes()
if before != after:
    diff = ''.join(difflib.unified_diff(
        before.decode('utf-8').splitlines(True), after.decode('utf-8').splitlines(True),
        fromfile='committed index.html', tofile='rebuilt index.html', n=2))
    Path('/tmp/quiz-deck-audit/build-test-failure.diff').write_text(diff)
    raise AssertionError('committed index.html differs from the source rebuild; see build-test-failure.diff')
checks += 1
html = after.decode('utf-8')
check('<link rel="canonical" href="https://tekideki.github.io/Quiz-Deck/">' in html, 'canonical is reproduced')
check('<style id="ecran-mic">' in html and '<style id="tinte-44">' in html, 'small-screen and touch rules are reproduced')
check('regula casei: tinte de atingere pe mobil' in html, 'coarse-pointer rules are reproduced')
check('id="td-install-button"' in html and 'id="td-install-dialog"' in html, 'honest install component is reproduced')
check('cannot force installation' in html, 'install limitation is reproduced')
check(':not(.cell):not(.tile):not(.slot):not(.key):not([hidden])' in html, 'touch display override excludes hidden controls')
check('window.TD_BANK = ' in html and 'window.TD_LOCALES = ' in html, 'bank and locales are inlined')
check('<link rel="stylesheet"' not in html and '<script src="core.js">' not in html, 'no local code assets remain external')
first = after
run2 = subprocess.run([sys.executable, str(ROOT / 'build.py')], capture_output=True, text=True)
check(run2.returncode == 0 and OUT.read_bytes() == first, 'a second build is deterministic')
print('build tests: %d checks passed' % checks)
