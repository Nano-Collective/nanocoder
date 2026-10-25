import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import React from 'react';
import {PlanStore} from '@/plans/storage';
import {renderWithTheme} from '@/test-utils/render-with-theme';
import {createPlansCommand} from './plans';

async function withStore(
	run: (command: ReturnType<typeof createPlansCommand>, store: PlanStore) => Promise<void>,
	seed = true,
): Promise<void> {
	const root = await mkdtemp(join(tmpdir(), 'nanocoder-plans-command-'));
	try {
		const store = new PlanStore(root);
		if (seed) {
			await store.createPlan({
				title: 'Auth refactor',
				nodes: [
					{id: 'db', title: 'Set up database', status: 'done'},
					{id: 'api', title: 'Build API', dependsOn: ['db']},
					{id: 'ui', title: 'Build UI', dependsOn: ['api']},
				],
			});
		}
		await run(createPlansCommand(store), store);
	} finally {
		await rm(root, {recursive: true, force: true});
	}
}

function elementName(element: unknown): string | undefined {
	if (!React.isValidElement(element)) return undefined;
	const type = element.type;
	return typeof type === 'function' ? type.name : undefined;
}

test('plans command lists persisted graphs', async t => {
	await withStore(async command => {
		const result = await command.handler([]);
		t.is(elementName(result), 'PlanListDisplay');
		const {lastFrame} = renderWithTheme(result as React.ReactElement);
		t.true(lastFrame()?.includes('Auth refactor'));
	});
});

test('plans command shows the active plan and a specific plan', async t => {
	await withStore(async command => {
		const active = await command.handler(['show']);
		t.is(elementName(active), 'PlanGraphDisplay');
		const {lastFrame} = renderWithTheme(active as React.ReactElement);
		const output = lastFrame() ?? '';
		t.true(output.includes('1/3 done'));
		t.true(output.includes('Ready now'));
		t.true(output.includes('api'));

		const specific = await command.handler(['show', 'auth-refactor']);
		t.is(elementName(specific), 'PlanGraphDisplay');
	});
});

test('plans command reports a missing plan instead of throwing', async t => {
	await withStore(async command => {
		const result = await command.handler(['show', 'missing']);
		t.is(elementName(result), 'PlanMessage');
		const {lastFrame} = renderWithTheme(result as React.ReactElement);
		t.true(lastFrame()?.includes('not found'));
	});
});

test('plans command switches the active plan and can clear it', async t => {
	await withStore(async (command, store) => {
		await store.createPlan({
			title: 'Other work',
			nodes: [{id: 'a', title: 'A'}],
		});
		const secondId = await store.getActivePlanId();
		t.is(secondId, 'other-work');

		await command.handler(['use', 'auth-refactor']);
		t.is(await store.getActivePlanId(), 'auth-refactor');

		const cleared = await command.handler(['use', 'none']);
		t.is(await store.getActivePlanId(), null);
		const {lastFrame} = renderWithTheme(cleared as React.ReactElement);
		t.true(lastFrame()?.includes('No plan is active'));
	});
});

test('plans command deletes a graph and updates the listing', async t => {
	await withStore(async (command, store) => {
		const result = await command.handler(['delete', 'auth-refactor']);
		t.is(elementName(result), 'PlanListDisplay');
		t.deepEqual(await store.listPlans(), []);
	});
});

test('plans command explains usage for unknown subcommands', async t => {
	await withStore(async command => {
		const result = await command.handler(['wat']);
		const {lastFrame} = renderWithTheme(result as React.ReactElement);
		t.true(lastFrame()?.includes('/plans'));
	});
});

test('plans command exposes help text', async t => {
	await withStore(async command => {
		const result = await command.handler(['help']);
		const {lastFrame} = renderWithTheme(result as React.ReactElement);
		const output = lastFrame() ?? '';
		t.true(output.includes('/plans use'));
		t.true(output.includes('/plans delete'));
	});
});

test('plans command is discoverable and /plan stays retired', async t => {
	const {lazyCommands} = await import('./lazy-registry');
	t.truthy(lazyCommands.find(entry => entry.name === 'plans'));
	t.is(lazyCommands.find(entry => entry.name === 'plan'), undefined);

	const command = createPlansCommand(new PlanStore());
	t.is(command.name, 'plans');
	t.truthy(command.description);
});
