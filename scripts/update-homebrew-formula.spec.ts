import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {
	chmodSync,
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'ava';

const updaterPath = fileURLToPath(
	new URL('./update-homebrew-formula.sh', import.meta.url),
);
const formulaPath = fileURLToPath(
	new URL('../Formula/nanocoder.rb', import.meta.url),
);

test.skipIf(process.platform === 'win32')(
	'updates the formula only after a successful download',
	t => {
		const directory = mkdtempSync(join(tmpdir(), 'nanocoder-homebrew-update-'));
		try {
			const scriptsDirectory = join(directory, 'scripts');
			const formulaDirectory = join(directory, 'Formula');
			const binDirectory = join(directory, 'bin');
			mkdirSync(scriptsDirectory);
			mkdirSync(formulaDirectory);
			mkdirSync(binDirectory);

			const temporaryUpdaterPath = join(
				scriptsDirectory,
				'update-homebrew-formula.sh',
			);
			const temporaryFormulaPath = join(formulaDirectory, 'nanocoder.rb');
			const fakeCurlPath = join(binDirectory, 'curl');
			copyFileSync(updaterPath, temporaryUpdaterPath);
			copyFileSync(formulaPath, temporaryFormulaPath);
			const originalFormula = readFileSync(temporaryFormulaPath, 'utf8');
			writeFileSync(
				fakeCurlPath,
				[
					'#!/bin/sh',
					'fail_on_http_error=0',
					'output=""',
					'url=""',
					'while [ "$#" -gt 0 ]; do',
					'  case "$1" in',
					'    --fail) fail_on_http_error=1 ;;',
					'    -o) shift; output=$1 ;;',
					'    https://*) url=$1 ;;',
					'  esac',
					'  shift',
					'done',
					'case "$url" in',
					'  *99.99.99*)',
					'    printf \'%s\\n\' \'{"error":"Not found"}\' > "$output"',
					'    [ "$fail_on_http_error" -eq 1 ] && exit 22 ;;',
					"  *) printf '%s\\n' 'test tarball' > \"$output\" ;;",
					'esac',
					'exit 0',
					'',
				].join('\n'),
			);
			chmodSync(fakeCurlPath, 0o755);

			const runUpdater = (version: string) =>
				execFileSync('bash', [temporaryUpdaterPath, version], {
					cwd: directory,
					env: {
						...process.env,
						PATH: [binDirectory, process.env.PATH ?? ''].join(':'),
					},
					stdio: 'ignore',
				});

			t.throws(() => runUpdater('99.99.99'));
			t.is(readFileSync(temporaryFormulaPath, 'utf8'), originalFormula);

			runUpdater('1.32.1');
			const updatedFormula = readFileSync(temporaryFormulaPath, 'utf8');
			t.true(
				updatedFormula.includes(
					'url "https://registry.npmjs.org/@nanocollective/nanocoder/-/nanocoder-1.32.1.tgz"',
				),
			);
			t.true(
				updatedFormula.includes(
					`sha256 "${createHash('sha256').update('test tarball\n').digest('hex')}"`,
				),
			);
		} finally {
			rmSync(directory, {recursive: true, force: true});
		}
	},
);
