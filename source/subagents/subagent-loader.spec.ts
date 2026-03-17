import test from 'ava';
import {SubagentLoader} from './subagent-loader.js';

console.log('\nsubagent-loader.spec.ts');

test.serial('loads built-in subagents', async t => {
	const loader = new SubagentLoader();
	await loader.initialize();

	const exploreAgent = await loader.getSubagent('explore');
	t.true(exploreAgent !== null, 'Explore agent should exist');
	t.is(exploreAgent?.name, 'explore');
	t.is(exploreAgent?.model, 'inherit');
	t.true(exploreAgent?.tools?.includes('Read'));
	t.true(exploreAgent?.disallowedTools?.includes('Write'));

	const planAgent = await loader.getSubagent('plan');
	t.true(planAgent !== null, 'Plan agent should exist');
	t.is(planAgent?.name, 'plan');
	t.is(planAgent?.model, 'inherit');
});

test.serial('lists all available subagents', async t => {
	const loader = new SubagentLoader();
	await loader.initialize();

	const agents = await loader.listSubagents();

	// Should have at least the built-in agents
	t.true(agents.length >= 2, 'Should have at least 2 built-in agents');

	const agentNames = agents.map((a) => a.name);
	t.true(agentNames.includes('explore'), 'Should include explore agent');
	t.true(agentNames.includes('plan'), 'Should include plan agent');
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

	t.true(await loader.hasSubagent('explore'), 'Explore agent should exist');
	t.true(await loader.hasSubagent('plan'), 'Plan agent should exist');
	t.false(await loader.hasSubagent('non-existent'));
});

test.serial('reloads agent definitions', async t => {
	const loader = new SubagentLoader();
	await loader.initialize();

	const initialCount = (await loader.listSubagents()).length;

	// Reload
	await loader.reload();

	const reloadedCount = (await loader.listSubagents()).length;
	t.is(reloadedCount, initialCount, 'Agent count should remain the same after reload');
});
