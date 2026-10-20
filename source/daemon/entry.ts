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
import {getAppConfig} from '@/config/index';
import {validateProjectConfigSecurity} from '@/config/validation';
import {runCiAutoFixFlow} from '@/daemon/ci-fix-orchestrator';
import {CheckpointManager} from '@/services/checkpoint-manager';
import type {Checkpointer} from '@/skills/dispatcher';
import {
	recordSubagentApiCallForStats,
	SubagentExecutor,
} from '@/subagents/subagent-executor';
import type {SubagentResult, SubagentTask} from '@/subagents/types';
import {describeSkippedMCPTools, ToolManager} from '@/tools/tool-manager';
import type {DevelopmentMode} from '@/types/core';
import {formatError} from '@/utils/error-formatter';
import {setNotificationsConfig} from '@/utils/notifications';
import {getShutdownManager} from '@/utils/shutdown';
import {
	getAllowedToolNames,
	getHeadlessAutoApproveToolNames,
	isTrustLevel,
} from '@/verify/trust';
import {startDaemon} from './daemon';

// The daemon's own `verify-ci-investigator` subagent must be pinned to a
// trust-level tool allowlist at execution time rather than trusting its
// frontmatter `tools:` list alone — see `source/verify/trust.ts`. Mirrors
// the same `toolOverride` use `verify/cli.ts` makes for `verify-pr-review`.
// `trustLevel` makes the executor deny any `git_pr` action the level doesn't
// allow, and `alwaysAllow` replaces the user/project config's list: it holds
// `git_commit` at `auto-fix`/`full-commit` (see
// `getHeadlessAutoApproveToolNames`) but never `git_pr` — GitHub-mutating
// calls stay harness-mediated (`ci-fix-orchestrator.ts`'s push/PR step)
// even at the most-trusted level.
const trustLevel = isTrustLevel(process.env.NANOCODER_CI_TRUST_LEVEL)
	? process.env.NANOCODER_CI_TRUST_LEVEL
	: 'comment-only';

const ciInvestigatorOverride = {
	tools: getAllowedToolNames(trustLevel),
	alwaysAllow: getHeadlessAutoApproveToolNames(trustLevel),
	trustLevel,
};

async function main(): Promise<void> {
	const projectRoot = process.env.NANOCODER_PROJECT_ROOT || process.cwd();

	// Change cwd so relative paths (cron tickers, file snapshots, etc.)
	// resolve against the project root.
	try {
		process.chdir(projectRoot);
	} catch (err) {
		// Build the line ourselves rather than letting console.error consume
		// `projectRoot` as a util.format template (a `%s` in the path would
		// otherwise be interpreted as a format specifier against the second
		// argument). This is cosmetic - the path is from our own spawn env -
		// but the rewrite costs nothing and silences the format-string warning.
		const detail = formatError(err);
		console.error(`Failed to chdir into ${projectRoot}: ${detail}`);
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

	// Mirror the TUI's notifications wiring: without this, the daemon's
	// `sendNotification` calls (from defaultOnActivity etc.) hit the default
	// `enabled: false` config and never fire, no matter what the user set.
	const notificationsConfig = getAppConfig().notifications;
	if (notificationsConfig) {
		setNotificationsConfig(notificationsConfig);
	}

	const toolManager = new ToolManager();

	const buildExecutor = (mode: DevelopmentMode) => {
		const executor = new SubagentExecutor(
			toolManager,
			client,
			projectRoot,
			mode,
			recordSubagentApiCallForStats,
		);
		return {
			execute: (
				task: SubagentTask,
				signal?: AbortSignal,
			): Promise<SubagentResult> => {
				if (task.subagent_type !== 'verify-ci-investigator') {
					return executor.execute(task, signal);
				}
				if (trustLevel !== 'comment-only') {
					return runCiAutoFixFlow(task, trustLevel, projectRoot, {}, signal);
				}
				return executor.execute(
					task,
					signal,
					0,
					undefined,
					undefined,
					ciInvestigatorOverride,
				);
			},
		};
	};

	const checkpointManager = new CheckpointManager(projectRoot);
	const checkpointer: Checkpointer = {
		async create(reason: string): Promise<string> {
			try {
				const meta = await checkpointManager.saveCheckpoint(
					undefined,
					[],
					'trigger',
					reason,
				);
				return meta.name;
			} catch (err) {
				// Log before re-throwing. The dispatcher's catch will swallow
				// it and proceed with the triggered run (checkpoint failure is
				// non-fatal), but without this log the failure is silent.
				console.error(
					`Checkpoint creation failed (reason="${reason}"): ${formatError(err)}`,
				);
				throw err;
			}
		},
	};

	const handle = await startDaemon({
		projectRoot,
		buildExecutor,
		checkpointer,
		ciWatch: getAppConfig().ciWatch,
		// Shared with buildExecutor: the skill pipeline fills this registry,
		// and triggered runs have to see what it registered.
		toolManager,
	});

	// Connect the project's MCP servers so triggered runs can use MCP tools,
	// as the TUI and --plain do. A server that fails to connect is logged and
	// skipped rather than taking the daemon down.
	const {mcpServers} = getAppConfig();
	if (mcpServers && mcpServers.length > 0) {
		validateProjectConfigSecurity(mcpServers);
		try {
			const results = await toolManager.initializeMCP(mcpServers, result => {
				if (!result.success) {
					console.error(
						`MCP server failed: ${result.serverName} (${result.error})`,
					);
				}
			});
			for (const result of results) {
				const warning = describeSkippedMCPTools(result);
				if (warning) console.error(warning);
			}
		} catch (err) {
			console.error(`MCP initialization error: ${formatError(err)}`);
		}
	}

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
