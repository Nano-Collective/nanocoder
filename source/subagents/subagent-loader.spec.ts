import test from 'ava';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {resolveBuiltInAgentsDir, SubagentLoader} from './subagent-loader.js';

console.log('\nsubagent-loader.spec.ts');

test.serial('loads built-in subagents', async t => {
	const loader = new SubagentLoader();
	await loader.initialize();

	const exploreAgent = await loader.getSubagent('explore');
	t.true(exploreAgent !== null, 'Research agent should exist');
	t.is(exploreAgent?.name, 'explore');
	t.is(exploreAgent?.model, 'inherit');
	t.true(exploreAgent?.tools?.includes('read_file'));
	t.true(exploreAgent?.tools?.includes('search_file_contents'));
});

test.serial('lists all available subagents', async t => {
	const loader = new SubagentLoader();
	await loader.initialize();

	const agents = await loader.listSubagents();

	t.true(agents.length >= 1, 'Should have at least 1 built-in agent');

	const agentNames = agents.map((a) => a.name);
	t.true(agentNames.includes('explore'), 'Should include explore agent');
});

test.serial('returns null for non-existent agent', async t => {
	const loader = new SubagentLoader();
	await loader.initialize();

	const agent = await loader.getSubagent('non-existent');
	t.is(agent, null);
});

test.serial('checks if agent exists', async t => {
	const loader = new SubagentLoader();
	await loader.initialize();

	t.true(await loader.hasSubagent('explore'), 'Research agent should exist');
	t.false(await loader.hasSubagent('non-existent'));
});

test.serial('reloads agent definitions', async t => {
	const loader = new SubagentLoader();
	await loader.initialize();

	const initialCount = (await loader.listSubagents()).length;

	await loader.reload();

	const reloadedCount = (await loader.listSubagents()).length;
	t.is(reloadedCount, initialCount, 'Agent count should remain the same after reload');
});

// ============================================================================
// Project-level agent without permissionMode loads correctly
// ============================================================================

test.serial('loads project-level agent without permissionMode', async t => {
	const tempDir = join(tmpdir(), `nanocoder-test-${Date.now()}`);
	const agentsDir = join(tempDir, '.nanocoder', 'agents');
	mkdirSync(agentsDir, {recursive: true});

	writeFileSync(
		join(agentsDir, 'simple-agent.md'),
		`---
name: simple-agent
description: A simple agent
---
I am simple.`,
		'utf-8',
	);

	try {
		const loader = new SubagentLoader(tempDir);
		await loader.initialize();

		const agent = await loader.getSubagent('simple-agent');
		t.truthy(agent, 'Agent should be loaded');
		t.is(agent?.name, 'simple-agent');
		t.is(agent?.systemPrompt, 'I am simple.');
	} finally {
		rmSync(tempDir, {recursive: true, force: true});
	}
});

// ============================================================================
// Gap #7: Project-level agent loading from .nanocoder/agents/
// ============================================================================

test.serial('loads project-level agents from .nanocoder/agents/', async t => {
	const tempDir = join(tmpdir(), `nanocoder-test-${Date.now()}`);
	const agentsDir = join(tempDir, '.nanocoder', 'agents');
	mkdirSync(agentsDir, {recursive: true});

	writeFileSync(
		join(agentsDir, 'custom-agent.md'),
		`---
name: custom-agent
description: A custom test agent
model: inherit
tools:
  - read_file
---
You are a custom agent.`,
		'utf-8',
	);

	try {
		const loader = new SubagentLoader(tempDir);
		await loader.initialize();

		const agent = await loader.getSubagent('custom-agent');
		t.truthy(agent, 'Custom agent should be loaded');
		t.is(agent?.name, 'custom-agent');
		t.is(agent?.description, 'A custom test agent');
		t.deepEqual(agent?.tools, ['read_file']);
		t.is(agent?.systemPrompt, 'You are a custom agent.');
		t.false(agent?.source.isBuiltIn, 'Should not be marked as built-in');
	} finally {
		rmSync(tempDir, {recursive: true, force: true});
	}
});

test.serial('project-level agent overrides built-in', async t => {
	const tempDir = join(tmpdir(), `nanocoder-test-${Date.now()}`);
	const agentsDir = join(tempDir, '.nanocoder', 'agents');
	mkdirSync(agentsDir, {recursive: true});

	writeFileSync(
		join(agentsDir, 'explore.md'),
		`---
name: explore
description: My custom explore agent
model: inherit
---
Custom explore prompt.`,
		'utf-8',
	);

	try {
		const loader = new SubagentLoader(tempDir);
		await loader.initialize();

		const agent = await loader.getSubagent('explore');
		t.truthy(agent, 'Research agent should exist');
		t.is(agent?.description, 'My custom explore agent', 'Project version should override built-in');
		t.is(agent?.systemPrompt, 'Custom explore prompt.');
		t.false(agent?.source.isBuiltIn, 'Should not be marked as built-in');
	} finally {
		rmSync(tempDir, {recursive: true, force: true});
	}
});

// ---------------------------------------------------------------------------
// Candidate-layout resolution tests
//
// resolveBuiltInAgentsDir() is the find(p => existsSync(p)) logic that lets the
// built-in .md definitions be found from source, tsc, and flat-rolldown module
// directories. The .md files are never compiled, so a wrong relative depth
// silently drops the built-in `explore` agent from the TUI.
// ---------------------------------------------------------------------------

/** Build a repo-shaped tree with source/subagents/built-in/explore.md. */
function makeBuiltInTree(base: string): {builtInDir: string} {
	const builtInDir = join(base, 'source', 'subagents', 'built-in');
	mkdirSync(builtInDir, {recursive: true});
	writeFileSync(
		join(builtInDir, 'explore.md'),
		'---\nname: explore\ndescription: x\nmodel: inherit\n---\nbody',
		'utf8',
	);
	return {builtInDir};
}

test('resolveBuiltInAgentsDir: prefers ./built-in when running from source', (t) => {
	const base = mkdtempSync(join(tmpdir(), 'nanocoder-agents-src-'));
	try {
		const {builtInDir} = makeBuiltInTree(base);
		t.is(resolveBuiltInAgentsDir(join(base, 'source', 'subagents')), builtInDir);
	} finally {
		rmSync(base, {recursive: true, force: true});
	}
});

test('resolveBuiltInAgentsDir: finds source/ from the nested tsc dist layout', (t) => {
	const base = mkdtempSync(join(tmpdir(), 'nanocoder-agents-tsc-'));
	try {
		const {builtInDir} = makeBuiltInTree(base);
		t.is(resolveBuiltInAgentsDir(join(base, 'dist', 'subagents')), builtInDir);
	} finally {
		rmSync(base, {recursive: true, force: true});
	}
});

test('resolveBuiltInAgentsDir: finds source/ from the flat rolldown dist layout', (t) => {
	const base = mkdtempSync(join(tmpdir(), 'nanocoder-agents-rolldown-'));
	try {
		const {builtInDir} = makeBuiltInTree(base);
		t.is(resolveBuiltInAgentsDir(join(base, 'dist')), builtInDir);
	} finally {
		rmSync(base, {recursive: true, force: true});
	}
});

test('resolveBuiltInAgentsDir: falls back to the first candidate when missing', (t) => {
	const base = mkdtempSync(join(tmpdir(), 'nanocoder-agents-empty-'));
	try {
		const moduleDir = join(base, 'dist');
		mkdirSync(moduleDir, {recursive: true});

		t.is(resolveBuiltInAgentsDir(moduleDir), join(moduleDir, 'built-in'));
	} finally {
		rmSync(base, {recursive: true, force: true});
	}
});
