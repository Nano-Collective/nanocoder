import test from 'ava';
import React from 'react';

import {parseRepoMapArgs, repomapCommand, RepoMapView} from './repomap';
import {DEFAULT_REPO_MAP_TOKENS} from '@/repo-map/index';

console.log('\nrepomap.spec.tsx');

const metadata = {
	provider: 'test',
	model: 'test',
	tokens: 0,
	getMessageTokens: () => 0,
};

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

test('repomapCommand handler returns an element for the current directory', async t => {
	const result = await repomapCommand.handler([], [], metadata);
	t.true(React.isValidElement(result));
});

test('repomapCommand handler returns an error element for bad arguments', async t => {
	const result = await repomapCommand.handler(['--nope'], [], metadata);
	t.true(React.isValidElement(result));
});

test('RepoMapView renders both the populated and empty states', t => {
	t.true(
		React.isValidElement(
			React.createElement(RepoMapView, {
				map: {
					files: [{path: 'a.ts', rank: 0.5, symbols: ['alpha']}],
					scannedFiles: 1,
					totalSymbols: 1,
					truncated: false,
				},
			}),
		),
	);
	t.true(
		React.isValidElement(
			React.createElement(RepoMapView, {
				map: {files: [], scannedFiles: 0, totalSymbols: 0, truncated: false},
			}),
		),
	);
});
