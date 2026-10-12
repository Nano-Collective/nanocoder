import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import React from 'react';
import {creditsCommand, resolveContributorsPath} from './credits';

test('creditsCommand has correct name and description', (t) => {
	t.is(creditsCommand.name, 'credits');
	t.is(
		creditsCommand.description,
		'Show project contributors and dependencies',
	);
});

test('creditsCommand handler returns a valid React element', async (t) => {
	const result = await creditsCommand.handler([], [], {
		provider: 'test',
		model: 'test',
		tokens: 0,
		getMessageTokens: () => 0,
	});
	t.true(React.isValidElement(result));
});

test('creditsCommand handler resolves contributors and dependencies', async (t) => {
	const result = await creditsCommand.handler([], [], {
		provider: 'test',
		model: 'test',
		tokens: 0,
		getMessageTokens: () => 0,
	});

	const props = result.props as {
		contributors: string[];
		dependencies: Array<{name: string; version: string}>;
	};

	// Both reads are swallowed by `catch { return [] }` in production, so an
	// empty array is exactly the silent failure this guards against.
	t.true(props.contributors.length > 0, 'contributors.json should resolve');
	t.true(props.dependencies.length > 0, 'package.json should resolve');
});

// ---------------------------------------------------------------------------
// Candidate-layout resolution tests
//
// resolveContributorsPath() is the find(p => existsSync(p)) logic that lets the
// data file be found from either build layout. A regression in the candidates
// (wrong relative depth, misordering) makes /credits silently render "No
// contributor data available." instead of failing loudly.
// ---------------------------------------------------------------------------

/** Build a dist-shaped tree with contributors.json under dist/commands/. */
function makeCreditsLayout(
	base: string,
	layout: 'rolldown' | 'tsc',
): {moduleDir: string; contributorsPath: string} {
	const moduleDir =
		layout === 'rolldown'
			? join(base, 'dist')
			: join(base, 'dist', 'commands');
	const contributorsDir = join(base, 'dist', 'commands');
	mkdirSync(contributorsDir, {recursive: true});
	const contributorsPath = join(contributorsDir, 'contributors.json');
	writeFileSync(
		contributorsPath,
		JSON.stringify({contributors: ['ada']}),
		'utf8',
	);
	return {moduleDir, contributorsPath};
}

test('resolveContributorsPath: uses ./contributors.json for the tsc layout', (t) => {
	const base = mkdtempSync(join(tmpdir(), 'nanocoder-credits-tsc-'));
	try {
		const {moduleDir, contributorsPath} = makeCreditsLayout(base, 'tsc');
		t.is(resolveContributorsPath(moduleDir), contributorsPath);
	} finally {
		rmSync(base, {recursive: true, force: true});
	}
});

test('resolveContributorsPath: uses ./commands/contributors.json for the flat layout', (t) => {
	const base = mkdtempSync(join(tmpdir(), 'nanocoder-credits-rolldown-'));
	try {
		const {moduleDir, contributorsPath} = makeCreditsLayout(base, 'rolldown');
		t.is(resolveContributorsPath(moduleDir), contributorsPath);
	} finally {
		rmSync(base, {recursive: true, force: true});
	}
});

test('resolveContributorsPath: falls back to the first candidate when missing', (t) => {
	const base = mkdtempSync(join(tmpdir(), 'nanocoder-credits-empty-'));
	try {
		const moduleDir = join(base, 'dist');
		mkdirSync(moduleDir, {recursive: true});

		t.is(
			resolveContributorsPath(moduleDir),
			join(moduleDir, 'contributors.json'),
		);
	} finally {
		rmSync(base, {recursive: true, force: true});
	}
});
