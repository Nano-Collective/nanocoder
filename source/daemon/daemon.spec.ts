import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import type {EventRouter} from '@/events/event-router';
import type {CiJobFailedPayload, Subscription} from '@/events/types';
import {resetSkillRegistry} from '@/skills/skill-registry';
import type {SubagentResult, SubagentTask} from '@/subagents/types';
import {startDaemon} from './daemon';
import {DaemonIpcClient} from './ipc';
import {getSocketPath} from './lockfile';

console.log('\ndaemon.spec.ts');

async function tempProject(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), 'daemon-ci-watch-'));
	await mkdir(join(root, '.nanocoder'), {recursive: true});
	return root;
}

const stubBuildExecutor = () => ({
	execute: async (_task: SubagentTask): Promise<SubagentResult> => ({
		subagentName: 'stub',
		output: 'stub output',
		success: true,
		executionTimeMs: 0,
	}),
});

function successBuildExecutor(output: string, fixApplied = false) {
	return () => ({
		execute: async (_task: SubagentTask): Promise<SubagentResult> => ({
			subagentName: 'stub',
			output,
			success: true,
			fixApplied,
			executionTimeMs: 0,
		}),
	});
}

// Never let a spec make a real `gh` network call: the fake CI source's
// start()/stop() are no-ops, so this only exercises daemon.ts's own
// enable/gh-availability wiring, not CiEventSource's poll loop (that has
// its own direct coverage in github-checkrun.spec.ts).
function noopCiEventSourceFactory() {
	const calls: unknown[] = [];
	return {
		factory: (..._args: unknown[]) => {
			calls.push(_args);
			return {start: async () => {}, stop: () => {}};
		},
		calls,
	};
}

// A fake CI source whose start() synchronously emits a `ci.job.failed`
// event into the router, simulating `CiEventSource` having detected a
// failure — used to exercise `handleCiInvestigationComplete`/
// `defaultOnActivity`'s posting logic end to end without any real `gh` call.
function detectingCiEventSourceFactory(payload: CiJobFailedPayload) {
	const calls: unknown[] = [];
	return {
		factory: (...args: unknown[]) => {
			calls.push(args);
			const router = args[0] as EventRouter;
			return {
				start: async () => {
					await router.emit({kind: 'ci.job.failed', payload, at: Date.now()});
				},
				stop: () => {},
			};
		},
		calls,
	};
}

// Never let a spec stand up a real, persistent chokidar watcher against the
// filesystem — that's file-watcher.ts's own concern (covered directly by
// file-watcher.spec.ts) and leaves handles that can keep the test process
// from exiting cleanly.
function noopFileWatcherFactory() {
	return () => ({start: async () => {}, stop: async () => {}});
}

async function listSubscriptions(root: string): Promise<Subscription[]> {
	const client = new DaemonIpcClient(getSocketPath(root));
	await client.connect();
	try {
		return await client.listSubscriptions();
	} finally {
		await client.disconnect();
	}
}

/** Flush pending microtasks — needed after triggering a `ci.job.failed`
 * event, since `defaultOnActivity` posts to the PR fire-and-forget
 * (`void handleCiInvestigationComplete(...)`), not awaited by the dispatch
 * chain `startDaemon`'s own `await ciSource?.start()` waits on. */
async function flush(): Promise<void> {
	await new Promise(r => setImmediate(r));
}

const CI_PAYLOAD: CiJobFailedPayload = {
	runId: 99,
	workflowName: 'CI',
	branch: 'feature-x',
	headSha: 'abc123',
	url: 'https://github.com/o/r/actions/runs/99',
};

test.serial('ciWatch omitted registers no builtin ci-investigator subscription', async t => {
	const root = await tempProject();
	try {
		const handle = await startDaemon({
			projectRoot: root,
			buildExecutor: stubBuildExecutor,
			fileWatcherFactory: noopFileWatcherFactory(),
		});
		try {
			const subs = await listSubscriptions(root);
			t.falsy(subs.find(s => s.id === 'builtin:ci-investigator'));
		} finally {
			await handle.stop();
		}
	} finally {
		await rm(root, {recursive: true, force: true});
	}
});

test.serial('ciWatch.enabled: false registers no builtin ci-investigator subscription', async t => {
	const root = await tempProject();
	try {
		const handle = await startDaemon({
			projectRoot: root,
			buildExecutor: stubBuildExecutor,
			ciWatch: {enabled: false},
			fileWatcherFactory: noopFileWatcherFactory(),
		});
		try {
			const subs = await listSubscriptions(root);
			t.falsy(subs.find(s => s.id === 'builtin:ci-investigator'));
		} finally {
			await handle.stop();
		}
	} finally {
		await rm(root, {recursive: true, force: true});
	}
});

test.serial(
	'ciWatch.enabled: true + gh available registers the builtin subscription and constructs the source',
	async t => {
		const root = await tempProject();
		const stub = noopCiEventSourceFactory();
		try {
			const handle = await startDaemon({
				projectRoot: root,
				buildExecutor: stubBuildExecutor,
				ciWatch: {enabled: true},
				ciEventSourceFactory: stub.factory,
				isGhAvailableFn: () => true,
				fileWatcherFactory: noopFileWatcherFactory(),
			});
			try {
				const subs = await listSubscriptions(root);
				const ciSub = subs.find(s => s.id === 'builtin:ci-investigator');
				t.truthy(ciSub);
				t.is(ciSub?.target.kind, 'agent');
				t.is(ciSub?.target.name, 'verify-ci-investigator');
				t.is(stub.calls.length, 1);
			} finally {
				await handle.stop();
			}
		} finally {
			await rm(root, {recursive: true, force: true});
		}
	},
);

test.serial(
	'ciWatch.enabled: true + gh unavailable skips the builtin subscription',
	async t => {
		const root = await tempProject();
		const stub = noopCiEventSourceFactory();
		try {
			const handle = await startDaemon({
				projectRoot: root,
				buildExecutor: stubBuildExecutor,
				ciWatch: {enabled: true},
				ciEventSourceFactory: stub.factory,
				isGhAvailableFn: () => false,
				fileWatcherFactory: noopFileWatcherFactory(),
			});
			try {
				const subs = await listSubscriptions(root);
				const ciSub = subs.find(s => s.id === 'builtin:ci-investigator');
				t.falsy(ciSub);
				t.is(stub.calls.length, 0);
			} finally {
				await handle.stop();
			}
		} finally {
			await rm(root, {recursive: true, force: true});
		}
	},
);

test.serial('startDaemon + stop is clean with ciWatch enabled', async t => {
	const root = await tempProject();
	const stub = noopCiEventSourceFactory();
	try {
		const handle = await startDaemon({
			projectRoot: root,
			buildExecutor: stubBuildExecutor,
			ciWatch: {enabled: true, pollIntervalMs: 60_000},
			ciEventSourceFactory: stub.factory,
			isGhAvailableFn: () => true,
			fileWatcherFactory: noopFileWatcherFactory(),
		});
		await handle.stop();
		t.pass();
	} finally {
		await rm(root, {recursive: true, force: true});
	}
});

test.serial('posts the CI investigation to the PR when one exists for the branch', async t => {
	const root = await tempProject();
	const ciFactory = detectingCiEventSourceFactory(CI_PAYLOAD);
	const postCalls: Array<[number, string]> = [];
	try {
		const handle = await startDaemon({
			projectRoot: root,
			buildExecutor: successBuildExecutor('diagnosis text'),
			ciWatch: {enabled: true},
			ciEventSourceFactory: ciFactory.factory,
			isGhAvailableFn: () => true,
			fileWatcherFactory: noopFileWatcherFactory(),
			getPrNumberForBranchFn: async () => 42,
			postPrCommentFn: async (pr, body) => {
				postCalls.push([pr, body]);
			},
		});
		try {
			await flush();
			t.is(postCalls.length, 1);
			t.is(postCalls[0]?.[0], 42);
			t.true(postCalls[0]?.[1].includes('diagnosis text'));
		} finally {
			await handle.stop();
		}
	} finally {
		await rm(root, {recursive: true, force: true});
	}
});

test.serial('posted report says a fix was applied when the SubagentResult says so', async t => {
	const root = await tempProject();
	const ciFactory = detectingCiEventSourceFactory(CI_PAYLOAD);
	const postCalls: Array<[number, string]> = [];
	try {
		const handle = await startDaemon({
			projectRoot: root,
			buildExecutor: successBuildExecutor('Opened draft PR: https://x/pull/1', true),
			ciWatch: {enabled: true},
			ciEventSourceFactory: ciFactory.factory,
			isGhAvailableFn: () => true,
			fileWatcherFactory: noopFileWatcherFactory(),
			getPrNumberForBranchFn: async () => 42,
			postPrCommentFn: async (pr, body) => {
				postCalls.push([pr, body]);
			},
		});
		try {
			await flush();
			t.is(postCalls.length, 1);
			t.false(postCalls[0]?.[1].includes('no auto-fix applied'));
			t.true(postCalls[0]?.[1].includes('a fix was implemented, committed, and published'));
		} finally {
			await handle.stop();
		}
	} finally {
		await rm(root, {recursive: true, force: true});
	}
});

test.serial("doesn't post when the branch has no open PR", async t => {
	const root = await tempProject();
	const ciFactory = detectingCiEventSourceFactory(CI_PAYLOAD);
	const postCalls: unknown[] = [];
	try {
		const handle = await startDaemon({
			projectRoot: root,
			buildExecutor: successBuildExecutor('diagnosis text'),
			ciWatch: {enabled: true},
			ciEventSourceFactory: ciFactory.factory,
			isGhAvailableFn: () => true,
			fileWatcherFactory: noopFileWatcherFactory(),
			getPrNumberForBranchFn: async () => undefined,
			postPrCommentFn: async (...args) => {
				postCalls.push(args);
			},
		});
		try {
			await flush();
			t.is(postCalls.length, 0);
		} finally {
			await handle.stop();
		}
	} finally {
		await rm(root, {recursive: true, force: true});
	}
});

test.serial(
	"doesn't post a non-builtin skill's output that also subscribes to ci.job.failed",
	async t => {
		resetSkillRegistry();
		const root = await tempProject();
		await mkdir(join(root, '.nanocoder', 'agents'), {recursive: true});
		await writeFile(
			join(root, '.nanocoder', 'agents', 'ci-watcher.md'),
			`---
name: ci-watcher
description: A user-authored skill also watching CI failures.
subscribe:
  - kind: ci.job.failed
---
Watch CI.`,
			'utf-8',
		);

		const ciFactory = detectingCiEventSourceFactory(CI_PAYLOAD);
		const postCalls: unknown[] = [];
		try {
			const handle = await startDaemon({
				projectRoot: root,
				buildExecutor: successBuildExecutor('user skill output'),
				ciWatch: {enabled: true},
				ciEventSourceFactory: ciFactory.factory,
				isGhAvailableFn: () => true,
				fileWatcherFactory: noopFileWatcherFactory(),
				getPrNumberForBranchFn: async () => 42,
				postPrCommentFn: async (...args) => {
					postCalls.push(args);
				},
			});
			try {
				await flush();
				// Both the builtin subscription and the user skill's subscription
				// match the emitted event, but only the builtin one should ever
				// result in a post.
				t.is(postCalls.length, 1);
			} finally {
				await handle.stop();
			}
		} finally {
			await rm(root, {recursive: true, force: true});
		}
	},
);

test.serial('swallows and logs a postPrComment failure without crashing the daemon', async t => {
	const root = await tempProject();
	const ciFactory = detectingCiEventSourceFactory(CI_PAYLOAD);
	const originalConsoleError = console.error;
	const errorLines: string[] = [];
	console.error = (...args: unknown[]) => {
		errorLines.push(args.map(String).join(' '));
	};
	try {
		const handle = await startDaemon({
			projectRoot: root,
			buildExecutor: successBuildExecutor('diagnosis text'),
			ciWatch: {enabled: true},
			ciEventSourceFactory: ciFactory.factory,
			isGhAvailableFn: () => true,
			fileWatcherFactory: noopFileWatcherFactory(),
			getPrNumberForBranchFn: async () => 42,
			postPrCommentFn: async () => {
				throw new Error('boom');
			},
		});
		try {
			await flush();
			await t.notThrowsAsync(async () => {});
			t.true(
				errorLines.some(line => line.includes('feature-x') && line.includes('boom')),
			);
		} finally {
			await handle.stop();
		}
	} finally {
		console.error = originalConsoleError;
		await rm(root, {recursive: true, force: true});
	}
});

test.serial(
	'warns at boot when a skill subscribes to ci.job.failed but CI watch is off',
	async t => {
		resetSkillRegistry();
		const root = await tempProject();
		await mkdir(join(root, '.nanocoder', 'agents'), {recursive: true});
		await writeFile(
			join(root, '.nanocoder', 'agents', 'ci-watcher.md'),
			`---
name: ci-watcher
description: A user-authored skill watching CI failures.
subscribe:
  - kind: ci.job.failed
---
Watch CI.`,
			'utf-8',
		);

		const originalConsoleWarn = console.warn;
		const warnLines: string[] = [];
		console.warn = (...args: unknown[]) => {
			warnLines.push(args.map(String).join(' '));
		};
		try {
			const handle = await startDaemon({
				projectRoot: root,
				buildExecutor: stubBuildExecutor,
				fileWatcherFactory: noopFileWatcherFactory(),
			});
			try {
				t.true(
					warnLines.some(
						line => line.includes('ci.job.failed') && line.includes('ci-watcher'),
					),
				);
			} finally {
				await handle.stop();
			}
		} finally {
			console.warn = originalConsoleWarn;
			await rm(root, {recursive: true, force: true});
		}
	},
);

test.serial(
	'does not warn when CI watch is enabled and available',
	async t => {
		resetSkillRegistry();
		const root = await tempProject();
		await mkdir(join(root, '.nanocoder', 'agents'), {recursive: true});
		await writeFile(
			join(root, '.nanocoder', 'agents', 'ci-watcher.md'),
			`---
name: ci-watcher
description: A user-authored skill watching CI failures.
subscribe:
  - kind: ci.job.failed
---
Watch CI.`,
			'utf-8',
		);

		const originalConsoleWarn = console.warn;
		const warnLines: string[] = [];
		console.warn = (...args: unknown[]) => {
			warnLines.push(args.map(String).join(' '));
		};
		const stub = noopCiEventSourceFactory();
		try {
			const handle = await startDaemon({
				projectRoot: root,
				buildExecutor: stubBuildExecutor,
				ciWatch: {enabled: true},
				ciEventSourceFactory: stub.factory,
				isGhAvailableFn: () => true,
				fileWatcherFactory: noopFileWatcherFactory(),
			});
			try {
				t.false(warnLines.some(line => line.includes('ci.job.failed')));
			} finally {
				await handle.stop();
			}
		} finally {
			console.warn = originalConsoleWarn;
			await rm(root, {recursive: true, force: true});
		}
	},
);
