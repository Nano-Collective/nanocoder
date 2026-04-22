import {mkdirSync, rmSync, writeFileSync} from 'node:fs';
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
