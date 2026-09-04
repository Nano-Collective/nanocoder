import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import type {Subscription} from '@/events/types';
import type {SubagentResult, SubagentTask} from '@/subagents/types';
import {isGhAvailable} from '@/tools/git/utils';
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
	'ciWatch.enabled: true registers the builtin subscription and constructs the source iff gh is available',
	async t => {
		const root = await tempProject();
		const stub = noopCiEventSourceFactory();
		try {
			const handle = await startDaemon({
				projectRoot: root,
				buildExecutor: stubBuildExecutor,
				ciWatch: {enabled: true},
				ciEventSourceFactory: stub.factory,
				fileWatcherFactory: noopFileWatcherFactory(),
			});
			try {
				const subs = await listSubscriptions(root);
				const ciSub = subs.find(s => s.id === 'builtin:ci-investigator');
				if (isGhAvailable()) {
					t.truthy(ciSub, 'gh is available in this environment, subscription should be registered');
					t.is(ciSub?.target.kind, 'agent');
					t.is(ciSub?.target.name, 'verify-ci-investigator');
					t.is(stub.calls.length, 1);
				} else {
					t.falsy(ciSub, 'gh is not available in this environment, subscription should be skipped');
					t.is(stub.calls.length, 0);
				}
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
			fileWatcherFactory: noopFileWatcherFactory(),
		});
		await handle.stop();
		t.pass();
	} finally {
		await rm(root, {recursive: true, force: true});
	}
});
