import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {CustomCommandLoader} from '@/custom-commands/loader';
import {EventRouter} from '@/events/event-router';
import {SubagentLoader} from '@/subagents/subagent-loader';
import {ToolManager} from '@/tools/tool-manager';
import {bootSkillPipeline} from './bootstrap';
import {resetSkillRegistry, getLoadedSkills} from './skill-registry';

console.log(`\nbootstrap.spec.ts`);

function noopRouter(): EventRouter {
	return new EventRouter({dispatch: () => {}});
}

async function tempProject(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), 'boot-spec-'));
	await mkdir(join(root, '.nanocoder'), {recursive: true});
	return root;
}

test.serial('loads bundle skills and writes to the global registry', async t => {
	resetSkillRegistry();
	const root = await tempProject();
	try {
		const bundleRoot = join(root, '.nanocoder', 'skills', 'docs');
		await mkdir(bundleRoot, {recursive: true});
		await writeFile(
			join(bundleRoot, 'skill.yaml'),
			'name: docs\ndescription: docs.',
			'utf-8',
		);

		const result = await bootSkillPipeline({
			projectRoot: root,
			toolManager: new ToolManager(),
			commandLoader: new CustomCommandLoader(root),
			subagentLoader: new SubagentLoader(root),
			eventRouter: noopRouter(),
		});
		// Bundle skill is present alongside any built-in flat skills that
		// the legacy loaders picked up (e.g. shipped built-in subagents).
		t.true(
			result.skills.some(s => s.name === 'docs' && s.source.shape === 'bundle'),
		);
		t.deepEqual(result.deprecations, []);
		t.is(getLoadedSkills().length, result.skills.length);
	} finally {
		await rm(root, {recursive: true, force: true});
	}
});

test.serial('reports schedules.json deprecation warning when present', async t => {
	resetSkillRegistry();
	const root = await tempProject();
	try {
		await writeFile(
			join(root, '.nanocoder', 'schedules.json'),
			'[]',
			'utf-8',
		);
		const result = await bootSkillPipeline({
			projectRoot: root,
			toolManager: new ToolManager(),
			commandLoader: new CustomCommandLoader(root),
			subagentLoader: new SubagentLoader(root),
			eventRouter: noopRouter(),
			bundleOnly: true,
		});
		t.is(result.deprecations.length, 1);
		t.regex(result.deprecations[0] ?? '', /schedules\.json is deprecated/);
	} finally {
		await rm(root, {recursive: true, force: true});
	}
});

test.serial(
	'cross-kind flat skills sharing a name (command "foo" + tool "foo") both survive',
	async t => {
		resetSkillRegistry();
		const root = await tempProject();
		try {
			await mkdir(join(root, '.nanocoder', 'commands'), {recursive: true});
			await mkdir(join(root, '.nanocoder', 'tools'), {recursive: true});
			await writeFile(
				join(root, '.nanocoder', 'commands', 'foo.md'),
				`---\ndescription: foo command\n---\nbody`,
				'utf-8',
			);
			await writeFile(
				join(root, '.nanocoder', 'tools', 'foo.md'),
				`---\nname: foo\ndescription: foo tool\napproval: never\nread_only: true\nparameters: {}\n---\necho hi`,
				'utf-8',
			);

			const result = await bootSkillPipeline({
				projectRoot: root,
				toolManager: new ToolManager(),
				commandLoader: new CustomCommandLoader(root),
				subagentLoader: new SubagentLoader(root),
				eventRouter: noopRouter(),
			});

			// Different kinds are different members: both stay in /skills, and
			// neither loses its subscriptions.
			const fooSkills = result.skills.filter(s => s.name === 'foo');
			t.is(fooSkills.length, 2);
			t.truthy(fooSkills.some(s => s.commands && s.commands.length > 0));
			t.truthy(fooSkills.some(s => s.tools && s.tools.length > 0));
			t.is(
				result.registration.collisions.filter(c => c.name === 'foo').length,
				0,
			);
		} finally {
			await rm(root, {recursive: true, force: true});
		}
	},
);

test.serial(
	'flat-dir commands are picked up via the legacy loader and surfaced as skills',
	async t => {
		resetSkillRegistry();
		const root = await tempProject();
		try {
			await mkdir(join(root, '.nanocoder', 'commands'), {recursive: true});
			await writeFile(
				join(root, '.nanocoder', 'commands', 'flat-test.md'),
				`---\ndescription: a flat command\n---\nbody`,
				'utf-8',
			);
			const result = await bootSkillPipeline({
				projectRoot: root,
				toolManager: new ToolManager(),
				commandLoader: new CustomCommandLoader(root),
				subagentLoader: new SubagentLoader(root),
				eventRouter: noopRouter(),
			});
			// `flat-test` should show up as a single-file skill.
			t.true(
				result.skills.some(
					s => s.name === 'flat-test' && s.source.shape === 'single-file',
				),
			);
		} finally {
			await rm(root, {recursive: true, force: true});
		}
	},
);
