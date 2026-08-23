import {mkdirSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';

import {
	findMatchingPaths,
	matchesGlob,
	searchProjectContents,
	SearchTimeoutError,
} from './file-search';

function createTempDir(name: string): string {
	return join(tmpdir(), `nanocoder-${name}-${process.pid}-${Date.now()}`);
}

test('matchesGlob handles supported file discovery patterns', t => {
	t.true(matchesGlob('src/index.ts', '**/*.ts'));
	t.true(matchesGlob('src/components/Button.tsx', 'src/**/*.tsx'));
	t.true(matchesGlob('Button.tsx', '*.{ts,tsx}', true));
	t.true(matchesGlob('package.json', 'package.json', true));
	t.true(matchesGlob('src/app-config.ts', '*config*', true));
	t.false(matchesGlob('src/index.js', '**/*.ts'));
});

test('matchesGlob normalizes Windows-style separators in path and pattern', t => {
	t.true(matchesGlob('src\\components\\Button.tsx', 'src/**/*.tsx'));
	t.true(matchesGlob('src/components/Button.tsx', 'src\\**\\*.tsx'));
	t.true(matchesGlob('src\\components\\Button.tsx', 'src\\**\\*.tsx'));
});

test('matchesGlob handles glob edge cases found during the regex-to-DP rewrite', t => {
	// Leading '**/' can vanish entirely (zero directories).
	t.true(matchesGlob('index.ts', '**/*.ts'));
	t.true(matchesGlob('a/b/c/index.ts', '**/*.ts'));
	// Embedded '**/' (mid-pattern) can also vanish entirely.
	t.true(matchesGlob('a/index.ts', 'a/**/index.ts'));
	t.true(matchesGlob('a/b/c/index.ts', 'a/**/index.ts'));
	// Trailing '/**' requires the literal '/' to actually be present - it
	// does NOT match the bare directory name with nothing after it.
	t.false(matchesGlob('a', 'a/**'));
	t.true(matchesGlob('a/', 'a/**'));
	t.true(matchesGlob('a/b', 'a/**'));
	// A '**' with no adjacent '/' anywhere (embedded inside what looks like
	// one path segment) still has slash-crossing power, same as the old
	// regex engine's '.*' construct.
	t.true(matchesGlob('x/xx/xxx', '*x**x'));
	t.false(matchesGlob('a', '*a**a')); // needs two 'a's, only has one
	t.true(matchesGlob('a/a', '*a**a'));
	// Single '*' never crosses '/', even directly adjacent to '**'.
	t.false(matchesGlob('a', 'a*/**'));
	t.true(matchesGlob('ab/', 'a*/**'));
});

test('matchesGlob stays fast on a pattern shape that hangs a naive regex engine', t => {
	// Many alternating wildcard/literal segments cause catastrophic regex
	// backtracking on a non-matching input if compiled into a regex naively
	// (confirmed separately: this exact shape hung for 20+ seconds against
	// the old regex-based implementation). The DP-table matcher has no
	// backtracking to exploit, so this must complete near-instantly.
	const pathologicalPattern = `${'*a'.repeat(25)}b`;
	const start = Date.now();
	const result = matchesGlob('a'.repeat(2000), pathologicalPattern);
	t.true(Date.now() - start < 100);
	t.false(result);
});

test('matchesGlob rejects a pattern longer than the sanity length cap', t => {
	const error = t.throws(() => matchesGlob('a.ts', 'a'.repeat(1001)));
	t.true(error instanceof Error);
	t.regex(error?.message ?? '', /too long/);
});

test.serial('findMatchingPaths returns files and directories cross-platform', async t => {
	const testDir = createTempDir('test-file-search-find-temp');

	try {
		mkdirSync(join(testDir, 'src', 'components'), {recursive: true});
		mkdirSync(join(testDir, 'build'), {recursive: true});
		writeFileSync(join(testDir, 'src', 'index.ts'), 'export const index = true;');
		writeFileSync(
			join(testDir, 'src', 'components', 'Button.tsx'),
			'export const Button = () => null;',
		);
		writeFileSync(join(testDir, 'build', 'ignored.ts'), 'ignored');

		const recursiveMatches = await findMatchingPaths('src/**/*.ts*', testDir, 50);
		t.true(recursiveMatches.files.includes('src/index.ts'));
		t.true(recursiveMatches.files.includes('src/components/Button.tsx'));
		t.false(recursiveMatches.files.includes('build/ignored.ts'));

		const directoryMatches = await findMatchingPaths('components', testDir, 50);
		t.deepEqual(directoryMatches.files, ['src/components']);
	} finally {
		rmSync(testDir, {recursive: true, force: true});
	}
});

test.serial('findMatchingPaths finds an empty, nested directory', async t => {
	const testDir = createTempDir('test-file-search-empty-dir-temp');

	try {
		mkdirSync(join(testDir, 'src', 'emptydir', 'nested', 'deeper'), {
			recursive: true,
		});
		writeFileSync(join(testDir, 'src', 'placeholder.ts'), 'export {};');

		const shallow = await findMatchingPaths('emptydir', testDir, 50);
		t.true(shallow.files.includes('src/emptydir'));

		const deep = await findMatchingPaths('deeper', testDir, 50);
		t.true(deep.files.includes('src/emptydir/nested/deeper'));
	} finally {
		rmSync(testDir, {recursive: true, force: true});
	}
});

test.serial(
	'findMatchingPaths hides an empty directory ignored by a nested .gitignore',
	async t => {
		const testDir = createTempDir('test-file-search-nested-gitignore-empty-temp');

		try {
			mkdirSync(join(testDir, 'pkg'), {recursive: true});
			writeFileSync(join(testDir, 'pkg', '.gitignore'), 'should-be-hidden\n');
			mkdirSync(join(testDir, 'pkg', 'should-be-hidden'), {recursive: true});
			mkdirSync(join(testDir, 'pkg', 'sub', 'should-be-hidden'), {
				recursive: true,
			});
			mkdirSync(join(testDir, 'pkg', 'still-visible'), {recursive: true});
			writeFileSync(join(testDir, 'pkg', 'kept.ts'), 'export {};');

			const hidden = await findMatchingPaths('should-be-hidden', testDir, 50);
			t.deepEqual(hidden.files, []);

			const visible = await findMatchingPaths('still-visible', testDir, 50);
			t.true(visible.files.includes('pkg/still-visible'));
		} finally {
			rmSync(testDir, {recursive: true, force: true});
		}
	},
);

// Symlinks are deliberately never followed - a symlink checked into a
// project can point anywhere on disk, and this tool must stay scoped to the
// project directory. These tests lock in the safe (non-following) behavior;
// the one after them proves the actual escape it prevents.

test.serial(
	'findMatchingPaths does not descend into a symlinked directory',
	async t => {
		const testDir = createTempDir('test-file-search-symlink-dir-temp');

		try {
			mkdirSync(join(testDir, 'real-target'), {recursive: true});
			writeFileSync(join(testDir, 'real-target', 'inner.ts'), 'export {};');
			symlinkSync(
				join(testDir, 'real-target'),
				join(testDir, 'linked-dir'),
				'junction',
			);

			const result = await findMatchingPaths('linked-dir', testDir, 50);
			t.deepEqual(result.files, []);
		} finally {
			rmSync(testDir, {recursive: true, force: true});
		}
	},
);

test.serial(
	'findMatchingPaths tolerates a symlink near an ancestor without hanging',
	async t => {
		const testDir = createTempDir('test-file-search-symlink-cycle-temp');

		try {
			mkdirSync(join(testDir, 'a', 'b'), {recursive: true});
			writeFileSync(join(testDir, 'normal.ts'), 'export {};');
			symlinkSync(testDir, join(testDir, 'a', 'b', 'loop'), 'junction');

			const result = await findMatchingPaths('normal.ts', testDir, 50);
			t.true(result.files.includes('normal.ts'));
		} finally {
			rmSync(testDir, {recursive: true, force: true});
		}
	},
);

test.serial(
	'searchProjectContents does not read content behind a symlinked file',
	async t => {
		const testDir = createTempDir('test-file-search-symlink-file-temp');
		const targetDir = createTempDir('test-file-search-symlink-target-temp');

		try {
			mkdirSync(testDir, {recursive: true});
			mkdirSync(targetDir, {recursive: true});
			writeFileSync(join(targetDir, 'real.ts'), 'searchTarget here');
			symlinkSync(join(targetDir, 'real.ts'), join(testDir, 'linked.ts'), 'file');

			const result = await searchProjectContents('searchTarget', testDir, 10, false);
			t.deepEqual(result.matches, []);
		} finally {
			rmSync(testDir, {recursive: true, force: true});
			rmSync(targetDir, {recursive: true, force: true});
		}
	},
);

test.serial(
	'a symlink pointing outside the project directory cannot leak content or paths',
	async t => {
		const projectDir = createTempDir('test-file-search-sandbox-project-temp');
		const outsideDir = createTempDir('test-file-search-sandbox-outside-temp');

		try {
			mkdirSync(join(projectDir, 'src'), {recursive: true});
			mkdirSync(outsideDir, {recursive: true});
			writeFileSync(
				join(outsideDir, 'secret.txt'),
				'SECRET_OUTSIDE_CONTENT findme_outside',
			);
			symlinkSync(outsideDir, join(projectDir, 'src', 'escape'), 'junction');

			const contentResult = await searchProjectContents(
				'SECRET_OUTSIDE_CONTENT',
				projectDir,
				10,
				false,
			);
			t.deepEqual(contentResult.matches, []);

			const fileResult = await findMatchingPaths('secret.txt', projectDir, 50);
			t.deepEqual(fileResult.files, []);
		} finally {
			rmSync(projectDir, {recursive: true, force: true});
			rmSync(outsideDir, {recursive: true, force: true});
		}
	},
);

test.serial('findMatchingPaths enforces maxResults and truncation', async t => {
	const testDir = createTempDir('test-file-search-max-temp');

	try {
		mkdirSync(testDir, {recursive: true});
		for (let index = 0; index < 5; index++) {
			writeFileSync(join(testDir, `file${index}.ts`), 'content');
		}

		const result = await findMatchingPaths('*.ts', testDir, 3);
		t.is(result.files.length, 3);
		t.true(result.truncated);
	} finally {
		rmSync(testDir, {recursive: true, force: true});
	}
});

test.serial(
	'findMatchingPaths and searchProjectContents return nothing for a non-positive maxResults',
	async t => {
		const testDir = createTempDir('test-file-search-nonpositive-max-temp');

		try {
			mkdirSync(testDir, {recursive: true});
			writeFileSync(join(testDir, 'file.ts'), 'searchTarget');

			for (const maxResults of [0, -1, -5]) {
				const findResult = await findMatchingPaths('*.ts', testDir, maxResults);
				t.deepEqual(
					findResult,
					{files: [], truncated: false},
					`findMatchingPaths maxResults=${maxResults}`,
				);

				const searchResult = await searchProjectContents(
					'searchTarget',
					testDir,
					maxResults,
					false,
				);
				t.deepEqual(
					searchResult,
					{matches: [], truncated: false},
					`searchProjectContents maxResults=${maxResults}`,
				);
			}
		} finally {
			rmSync(testDir, {recursive: true, force: true});
		}
	},
);

test.serial('searchProjectContents rejects an empty or whitespace-only query', async t => {
	const testDir = createTempDir('test-file-search-empty-query-temp');

	try {
		mkdirSync(testDir, {recursive: true});
		writeFileSync(join(testDir, 'a.ts'), 'content');

		await t.throwsAsync(() => searchProjectContents('', testDir, 10, false));
		await t.throwsAsync(() => searchProjectContents('   ', testDir, 10, false));
	} finally {
		rmSync(testDir, {recursive: true, force: true});
	}
});

test.serial(
	'searchProjectContents stops early instead of buffering every match before truncating',
	async t => {
		const testDir = createTempDir('test-file-search-maxcount-temp');

		try {
			mkdirSync(testDir, {recursive: true});
			// One file with far more matches than maxResults - the child rg
			// process should be killed once enough matches have streamed in,
			// not left to finish producing output that gets thrown away.
			const lines = Array.from({length: 500}, (_, i) => `searchTarget line ${i}`);
			writeFileSync(join(testDir, 'big.ts'), lines.join('\n'));

			const result = await searchProjectContents('searchTarget', testDir, 5, false);
			t.is(result.matches.length, 5);
			t.true(result.truncated);
		} finally {
			rmSync(testDir, {recursive: true, force: true});
		}
	},
);

test.serial(
	'searchProjectContents stays bounded when context lines themselves also match (rg --max-count overshoot case)',
	async t => {
		const testDir = createTempDir('test-file-search-dense-context-temp');

		try {
			mkdirSync(testDir, {recursive: true});
			// Every line matches, so with --context every "context" line for a
			// match is itself also a match - the documented rg behavior
			// (BurntSushi/ripgrep#2843 et al) that makes rg's own --max-count
			// overshoot. The JS-side stream count must still bound this.
			const lines = Array.from({length: 5000}, (_, i) => `searchTarget line ${i}`);
			writeFileSync(join(testDir, 'dense.ts'), lines.join('\n'));

			const start = Date.now();
			const result = await searchProjectContents(
				'searchTarget',
				testDir,
				5,
				false,
				undefined,
				undefined,
				undefined,
				3,
			);
			const elapsed = Date.now() - start;

			t.is(result.matches.length, 5);
			t.true(result.truncated);
			t.true(elapsed < 5000, `expected a fast bounded search, took ${elapsed}ms`);
		} finally {
			rmSync(testDir, {recursive: true, force: true});
		}
	},
);

test.serial('searchProjectContents respects include, path, wholeWord and context', async t => {
	const testDir = createTempDir('test-file-search-search-temp');

	try {
		mkdirSync(join(testDir, 'src'), {recursive: true});
		mkdirSync(join(testDir, 'notes'), {recursive: true});
		writeFileSync(
			join(testDir, 'src', 'app.ts'),
			[
				'const alpha = 1;',
				'const targetWord = alpha + 1;',
				'const targetWordExtra = alpha + 2;',
				'export {targetWord};',
			].join('\n'),
		);
		writeFileSync(
			join(testDir, 'notes', 'app.txt'),
			'targetWord should not be included when include=*.ts',
		);

		const result = await searchProjectContents(
			'targetWord',
			testDir,
			10,
			false,
			'*.ts',
			join(testDir, 'src'),
			true,
			1,
		);

		t.is(result.matches.length, 2);
		t.true(result.matches.every(match => match.file === 'src/app.ts'));
		t.true(result.matches[0]?.content.includes('1: const alpha = 1;'));
		t.true(result.matches[0]?.content.includes('2: const targetWord = alpha + 1;'));
		t.is(result.matches[0]?.line, 2);
		t.is(result.matches[1]?.line, 4);
	} finally {
		rmSync(testDir, {recursive: true, force: true});
	}
});

test.serial(
	'searchProjectContents gives each nearby match its own context block even when windows overlap',
	async t => {
		const testDir = createTempDir('test-file-search-context-overlap-temp');

		try {
			mkdirSync(testDir, {recursive: true});
			const lines = Array.from({length: 12}, (_, i) => `line${i}`);
			lines[4] = 'TARGET one';
			lines[6] = 'TARGET two';
			writeFileSync(join(testDir, 'a.txt'), lines.join('\n'));

			const result = await searchProjectContents(
				'TARGET',
				testDir,
				10,
				false,
				undefined,
				undefined,
				undefined,
				2,
			);

			t.is(result.matches.length, 2);
			t.is(result.matches[0]?.line, 5);
			t.is(result.matches[1]?.line, 7);
			// Both blocks share lines 5-7, which rg streams only once - each
			// match must still get its own independent block built from it.
			t.true(result.matches[0]?.content.includes('5: TARGET one'));
			t.true(result.matches[0]?.content.includes('7: TARGET two'));
			t.true(result.matches[1]?.content.includes('5: TARGET one'));
			t.true(result.matches[1]?.content.includes('7: TARGET two'));
		} finally {
			rmSync(testDir, {recursive: true, force: true});
		}
	},
);

test.serial('searchProjectContents skips ignored and binary files', async t => {
	const testDir = createTempDir('test-file-search-ignore-temp');

	try {
		mkdirSync(join(testDir, 'src'), {recursive: true});
		mkdirSync(join(testDir, 'dist'), {recursive: true});
		writeFileSync(join(testDir, '.gitignore'), '*.log\n');
		writeFileSync(join(testDir, 'src', 'main.ts'), 'const searchTarget = true;');
		writeFileSync(join(testDir, 'dist', 'bundle.ts'), 'const searchTarget = true;');
		writeFileSync(join(testDir, 'debug.log'), 'searchTarget');
		writeFileSync(join(testDir, 'image.png'), 'searchTarget');

		const result = await searchProjectContents(
			'searchTarget',
			testDir,
			10,
			false,
		);

		t.deepEqual(
			result.matches.map(match => match.file),
			['src/main.ts'],
		);
	} finally {
		rmSync(testDir, {recursive: true, force: true});
	}
});

test.serial(
	'searchProjectContents respects a .gitignore nested in a subdirectory',
	async t => {
		const testDir = createTempDir('test-file-search-nested-gitignore-temp');

		try {
			mkdirSync(join(testDir, 'pkg'), {recursive: true});
			writeFileSync(join(testDir, 'pkg', '.gitignore'), 'ignored.ts\n');
			writeFileSync(join(testDir, 'pkg', 'ignored.ts'), 'searchTarget');
			writeFileSync(join(testDir, 'pkg', 'kept.ts'), 'searchTarget');

			const result = await searchProjectContents('searchTarget', testDir, 10, false);

			t.deepEqual(
				result.matches.map(match => match.file),
				['pkg/kept.ts'],
			);
		} finally {
			rmSync(testDir, {recursive: true, force: true});
		}
	},
);

test.serial(
	'searchProjectContents keeps binary excludes even under a broad include pattern',
	async t => {
		const testDir = createTempDir('test-file-search-include-order-temp');

		try {
			mkdirSync(testDir, {recursive: true});
			writeFileSync(join(testDir, 'code.ts'), 'searchTarget');
			writeFileSync(join(testDir, 'image.png'), 'searchTarget');

			const result = await searchProjectContents(
				'searchTarget',
				testDir,
				10,
				false,
				'**/*',
			);

			t.deepEqual(
				result.matches.map(match => match.file),
				['code.ts'],
			);
		} finally {
			rmSync(testDir, {recursive: true, force: true});
		}
	},
);

test.serial(
	'searchProjectContents skips a file with NUL bytes even without a matching extension',
	async t => {
		const testDir = createTempDir('test-file-search-nul-temp');

		try {
			mkdirSync(testDir, {recursive: true});
			writeFileSync(
				join(testDir, 'weird.log'),
				Buffer.from('searchTarget\0garbage\0bytes'),
			);
			writeFileSync(join(testDir, 'clean.log'), 'searchTarget in a clean file');

			const result = await searchProjectContents('searchTarget', testDir, 10, false);

			t.deepEqual(
				result.matches.map(match => match.file),
				['clean.log'],
			);
		} finally {
			rmSync(testDir, {recursive: true, force: true});
		}
	},
);

test.serial('searchProjectContents throws SearchTimeoutError when timeout elapses', async t => {
	const testDir = createTempDir('test-file-search-timeout-temp');

	try {
		mkdirSync(testDir, {recursive: true});
		// Many files with a query that never matches — walker keeps going,
		// giving the abort timer a chance to fire between async I/O yields.
		for (let i = 0; i < 500; i++) {
			writeFileSync(join(testDir, `file${i}.ts`), 'line a\nline b\nline c\n');
		}

		await t.throwsAsync(
			() =>
				searchProjectContents(
					'no-such-thing-anywhere',
					testDir,
					10,
					true,
					undefined,
					undefined,
					undefined,
					undefined,
					1,
				),
			{instanceOf: SearchTimeoutError},
		);
	} finally {
		rmSync(testDir, {recursive: true, force: true});
	}
});

test.serial(
	'searchProjectContents rejects with the caller-supplied abort reason, not a generic AbortError',
	async t => {
		const testDir = createTempDir('test-file-search-abort-reason-temp');

		try {
			mkdirSync(testDir, {recursive: true});
			for (let i = 0; i < 2000; i++) {
				writeFileSync(
					join(testDir, `file${i}.ts`),
					'line a\nline b\nline c\n'.repeat(20),
				);
			}

			const controller = new AbortController();
			const customReason = new Error('custom-abort-reason');
			setTimeout(() => controller.abort(customReason), 5);

			const error = await t.throwsAsync(() =>
				searchProjectContents(
					'no-such-thing-anywhere',
					testDir,
					100000,
					false,
					undefined,
					undefined,
					undefined,
					undefined,
					30000,
					controller.signal,
				),
			);
			t.is(error, customReason);
		} finally {
			rmSync(testDir, {recursive: true, force: true});
		}
	},
);

test.serial(
	'searchProjectContents still throws on a genuinely invalid regex',
	async t => {
		const testDir = createTempDir('test-file-search-badregex-temp');

		try {
			mkdirSync(testDir, {recursive: true});
			writeFileSync(join(testDir, 'f.ts'), 'content');

			// rg exits 2 for this too, same as a recoverable --follow symlink
			// loop warning - must still reject, not silently return no matches.
			await t.throwsAsync(() =>
				searchProjectContents('[invalid(regex', testDir, 10, false),
			);
		} finally {
			rmSync(testDir, {recursive: true, force: true});
		}
	},
);
