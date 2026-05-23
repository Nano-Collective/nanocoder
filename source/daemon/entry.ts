#!/usr/bin/env node
/**
 * Daemon process entry point.
 *
 * Spawned by `nanocoder daemon start`. Reads the project root from
 * `NANOCODER_PROJECT_ROOT` (set by the spawn) or falls back to cwd, then
 * stands up the full skill / event pipeline via `startDaemon`.
 *
 * stdio is redirected to `.nanocoder/daemon.log` by the launcher, so
 * `console.log` / `console.error` calls here end up in the log file
 * `nanocoder daemon logs` tails.
 */

import {createLLMClient} from '@/client-factory';
import {CheckpointManager} from '@/services/checkpoint-manager';
import type {Checkpointer} from '@/skills/dispatcher';
import {SubagentExecutor} from '@/subagents/subagent-executor';
import type {SubagentResult, SubagentTask} from '@/subagents/types';
import {ToolManager} from '@/tools/tool-manager';
import type {DevelopmentMode} from '@/types/core';
import {getShutdownManager} from '@/utils/shutdown';
import {startDaemon} from './daemon';

async function main(): Promise<void> {
	const projectRoot = process.env.NANOCODER_PROJECT_ROOT || process.cwd();

	// Change cwd so relative paths (cron tickers, file snapshots, etc.)
	// resolve against the project root.
	try {
		process.chdir(projectRoot);
	} catch (err) {
		console.error(
			`Failed to chdir into ${projectRoot}:`,
			err instanceof Error ? err.message : err,
		);
		process.exit(1);
	}

	// Bring up the LLM client. Without a configured provider the daemon
	// cannot dispatch triggered runs — fail loudly with a clear message.
	const {client} = await createLLMClient().catch(err => {
		console.error(
			'Daemon could not create an LLM client. Configure a provider in agents.config.json before starting the daemon.',
		);
		console.error(err instanceof Error ? err.message : err);
		process.exit(1);
	});

	const toolManager = new ToolManager();

	const buildExecutor = (mode: DevelopmentMode) => {
		const executor = new SubagentExecutor(
			toolManager,
			client,
			projectRoot,
			mode,
		);
		return {
			execute: (task: SubagentTask): Promise<SubagentResult> =>
				executor.execute(task),
		};
	};

	const checkpointManager = new CheckpointManager(projectRoot);
	const checkpointer: Checkpointer = {
		async create(reason: string): Promise<string> {
			const meta = await checkpointManager.saveCheckpoint(
				undefined,
				[],
				'trigger',
				reason,
			);
			return meta.name;
		},
	};

	const handle = await startDaemon({
		projectRoot,
		buildExecutor,
		checkpointer,
	});

	// Wire shutdown through the existing ShutdownManager rather than
	// registering our own signal handler. Otherwise the SM's default
	// SIGTERM handler (auto-registered when ToolManager / the
	// shutdown manager initialize) calls process.exit(0) on its own
	// 5s timeout - racing our cleanup and leaving the socket file behind.
	getShutdownManager({timeoutMs: 30_000}).register({
		name: 'skill-daemon',
		priority: 10,
		handler: async () => {
			console.log('Daemon shutdown handler running...');
			const t0 = Date.now();
			await handle.stop();
			console.log(`Daemon stop completed in ${Date.now() - t0}ms.`);
		},
	});

	console.log(`Daemon started for ${projectRoot} (pid ${process.pid}).`);
}

main().catch(err => {
	console.error('Daemon failed to start:', err);
	process.exit(1);
});
