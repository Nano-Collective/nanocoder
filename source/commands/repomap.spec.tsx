import {mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import React from 'react';

import {DEFAULT_REPO_MAP_TOKENS, type RepoMap} from '@/repo-map/index';
import {renderWithTheme} from '@/test-utils/render-with-theme';
import {parseRepoMapArgs, RepoMapView, repomapCommand} from './repomap';

console.log('\nrepomap.spec.tsx');

const metadata = {
	provider: 'test',
	model: 'test',
	tokens: 0,
	getMessageTokens: () => 0,
};

function frameOf(map: RepoMap): string {
	const {lastFrame, unmount} = renderWithTheme(<RepoMapView map={map} />);
	const output = lastFrame() ?? '';
	unmount();
	return output;
}

test('repomapCommand exposes matching name and description', t => {
	t.is(repomapCommand.name, 'repomap');
	t.true(repomapCommand.description.includes('--tokens'));
});

test('parseRepoMapArgs defaults to the standard budget', t => {
	t.deepEqual(parseRepoMapArgs([]), {maxTokens: DEFAULT_REPO_MAP_TOKENS});
});

test('parseRepoMapArgs accepts separated and inline token values', t => {
	t.deepEqual(parseRepoMapArgs(['--tokens', '2048']), {maxTokens: 2048});
	t.deepEqual(parseRepoMapArgs(['--tokens=2048']), {maxTokens: 2048});
});

test('parseRepoMapArgs floors fractional values and clamps the maximum', t => {
	t.is(parseRepoMapArgs(['--tokens', '512.9']).maxTokens, 512);
	t.is(parseRepoMapArgs(['--tokens', '999999']).maxTokens, 32_000);
});

test('parseRepoMapArgs rejects values below the minimum', t => {
	const result = parseRepoMapArgs(['--tokens', '10']);
	t.truthy(result.error);
	t.is(result.maxTokens, DEFAULT_REPO_MAP_TOKENS);
});

test('parseRepoMapArgs rejects missing and non-numeric values', t => {
	t.truthy(parseRepoMapArgs(['--tokens']).error);
	t.truthy(parseRepoMapArgs(['--tokens', 'lots']).error);
	t.truthy(parseRepoMapArgs(['--tokens=']).error);
});

test('parseRepoMapArgs rejects unknown arguments', t => {
	t.is(parseRepoMapArgs(['--depth', '3']).error, 'Unknown argument: --depth');
	t.is(
		parseRepoMapArgs(['--tokensmax', '3']).error,
		'Unknown argument: --tokensmax',
	);
});

test('RepoMapView renders the ranked files, their symbols and the summary', t => {
	const output = frameOf({
		files: [
			{path: 'source/core.ts', rank: 0.4, symbols: ['alpha', 'beta']},
			{path: 'source/leaf.ts', rank: 0.1, symbols: ['gamma']},
		],
		scannedFiles: 12,
		totalSymbols: 30,
		truncated: false,
	});

	t.true(output.includes('source/core.ts'));
	t.true(output.includes('alpha, beta'));
	t.true(output.includes('source/leaf.ts'));
	t.true(output.includes('gamma'));
	t.true(output.includes('Top 2 of 12 files'));
	t.true(output.includes('30 symbols'));
	t.false(output.includes('truncated'));
});

test('RepoMapView flags a truncated map', t => {
	const output = frameOf({
		files: [{path: 'a.ts', rank: 1, symbols: ['only']}],
		scannedFiles: 900,
		totalSymbols: 900,
		truncated: true,
	});

	t.true(output.includes('truncated'));
});

test('RepoMapView renders an empty state when nothing is indexable', t => {
	const output = frameOf({
		files: [],
		scannedFiles: 0,
		totalSymbols: 0,
		truncated: false,
	});

	t.true(output.includes('No indexable source files found'));
});

test('repomapCommand handler renders a map for the current directory', async t => {
	const root = join(
		tmpdir(),
		`nanocoder-repomap-command-${process.pid}-${Date.now()}`,
	);
	mkdirSync(root, {recursive: true});
	writeFileSync(
		join(root, 'core.ts'),
		'export function sharedHelper() {\n\treturn 1;\n}\n',
	);
	writeFileSync(
		join(root, 'user.ts'),
		'import {sharedHelper} from "./core";\nsharedHelper();\n',
	);

	const previousCwd = process.cwd();
	process.chdir(root);

	try {
		const result = await repomapCommand.handler([], [], metadata);
		t.true(React.isValidElement(result));

		const {lastFrame, unmount} = renderWithTheme(result as React.ReactElement);
		const output = lastFrame() ?? '';
		unmount();
		t.true(output.includes('/repomap'));
		t.true(output.includes('files'));
		t.true(output.includes('core.ts'));
	} finally {
		process.chdir(previousCwd);
		rmSync(root, {recursive: true, force: true});
	}
});

test('repomapCommand handler renders usage for a bad argument', async t => {
	const result = await repomapCommand.handler(['--nope'], [], metadata);
	const {lastFrame, unmount} = renderWithTheme(result as React.ReactElement);
	const output = lastFrame() ?? '';
	unmount();
	t.true(output.includes('Unknown argument: --nope'));
	t.true(output.includes('Usage: /repomap [--tokens <n>]'));
});
