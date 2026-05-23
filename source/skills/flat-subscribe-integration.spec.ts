/**
 * End-to-end check that frontmatter `subscribe:` blocks on flat-form
 * single-file skills fire through the unified pipeline. Issue #515's
 * exact UX is: drop one `.md` into `.nanocoder/agents/` with a
 * `subscribe:` block; events route to it.
 */

import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {CustomCommandLoader} from '@/custom-commands/loader';
import {EventRouter} from '@/events/event-router';
import type {Event, Subscription, SubscriptionDispatcher} from '@/events/types';
import {SubagentLoader} from '@/subagents/subagent-loader';
import {ToolManager} from '@/tools/tool-manager';
import {bootSkillPipeline} from './bootstrap';
import {resetSkillRegistry} from './skill-registry';

console.log(`\nflat-subscribe-integration.spec.ts`);

function captureRouter(): {
	router: EventRouter;
	calls: Array<{sub: Subscription; event: Event}>;
} {
	const calls: Array<{sub: Subscription; event: Event}> = [];
	const dispatcher: SubscriptionDispatcher = {
		dispatch(sub, event) {
			calls.push({sub, event});
		},
	};
	return {router: new EventRouter(dispatcher), calls};
}

async function withTempProject(
	fn: (root: string) => Promise<void>,
): Promise<void> {
	const wrapper = await mkdtemp(join(tmpdir(), 'flat-sub-'));
	const root = join(wrapper, 'project');
	const personalRoot = join(wrapper, 'personal');
	await mkdir(join(root, '.nanocoder'), {recursive: true});
	await mkdir(personalRoot, {recursive: true});
	const prev = process.env.NANOCODER_CONFIG_DIR;
	process.env.NANOCODER_CONFIG_DIR = personalRoot;
	try {
		await fn(root);
	} finally {
		if (prev === undefined) delete process.env.NANOCODER_CONFIG_DIR;
		else process.env.NANOCODER_CONFIG_DIR = prev;
		await rm(wrapper, {recursive: true, force: true});
	}
}

test.serial(
	'flat-form subagent with frontmatter subscribe fires file.changed events',
	async t => {
		await withTempProject(async root => {
			resetSkillRegistry();
			await mkdir(join(root, '.nanocoder', 'agents'), {recursive: true});
			await writeFile(
				join(root, '.nanocoder', 'agents', 'docs-agent.md'),
				`---
name: docs-agent
description: Watches docs.
subscribe:
  - kind: file.changed
    paths: ["docs/**"]
---
You watch docs.`,
				'utf-8',
			);

			const {router, calls} = captureRouter();
			const result = await bootSkillPipeline({
				projectRoot: root,
				toolManager: new ToolManager(),
				commandLoader: new CustomCommandLoader(root),
				subagentLoader: new SubagentLoader(root),
				eventRouter: router,
			});

			t.true(
				result.registration.subscriptionIds.some(id =>
					id.includes('docs-agent'),
				),
			);

			await router.emit({
				kind: 'file.changed',
				payload: {file: 'docs/intro.md', eventKind: 'change'},
				at: Date.now(),
			});

			const docsCalls = calls.filter(c => c.sub.target.name === 'docs-agent');
			t.is(docsCalls.length, 1);
			t.is(docsCalls[0]?.sub.target.kind, 'agent');
		});
	},
);

test.serial(
	'flat-form command with schedule.cron fires through the router',
	async t => {
		await withTempProject(async root => {
			resetSkillRegistry();
			await mkdir(join(root, '.nanocoder', 'commands'), {recursive: true});
			await writeFile(
				join(root, '.nanocoder', 'commands', 'weekly-report.md'),
				`---
description: Monday summary.
subscribe:
  - kind: schedule.cron
    cron: "0 9 * * MON"
---
Summarize last week.`,
				'utf-8',
			);

			const {router, calls} = captureRouter();
			await bootSkillPipeline({
				projectRoot: root,
				toolManager: new ToolManager(),
				commandLoader: new CustomCommandLoader(root),
				subagentLoader: new SubagentLoader(root),
				eventRouter: router,
			});

			await router.emit({
				kind: 'schedule.cron',
				payload: {cron: '0 9 * * MON'},
				at: Date.now(),
			});

			const weeklyCalls = calls.filter(
				c => c.sub.target.name === 'weekly-report',
			);
			t.is(weeklyCalls.length, 1);
			t.is(weeklyCalls[0]?.sub.target.kind, 'command');
		});
	},
);

test.serial(
	'flat-form custom tool with frontmatter subscribe also wires through',
	async t => {
		await withTempProject(async root => {
			resetSkillRegistry();
			await mkdir(join(root, '.nanocoder', 'tools'), {recursive: true});
			await writeFile(
				join(root, '.nanocoder', 'tools', 'gh_pr_diff.md'),
				`---
name: gh_pr_diff
description: Fetch a PR diff.
approval: never
read_only: true
parameters: {}
subscribe:
  - kind: schedule.cron
    cron: "*/15 * * * *"
---
echo hi`,
				'utf-8',
			);

			const {router} = captureRouter();
			const result = await bootSkillPipeline({
				projectRoot: root,
				toolManager: new ToolManager(),
				commandLoader: new CustomCommandLoader(root),
				subagentLoader: new SubagentLoader(root),
				eventRouter: router,
			});

			// Tool targets are deferred in the dispatcher (plan step 8), but
			// the subscription itself should still register cleanly through
			// the bootstrap.
			t.true(
				result.registration.subscriptionIds.some(id =>
					id.includes('gh_pr_diff'),
				),
			);
		});
	},
);
