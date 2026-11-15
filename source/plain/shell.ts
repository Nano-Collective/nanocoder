import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {appendToolDefinitionsToPrompt} from '@/ai-sdk-client/tools/system-prompt-assembler';
import {
	type ArtifactManager,
	artifactManager,
} from '@/artifacts/artifact-manager';
import {getAppConfig} from '@/config/index';
import {
	loadPreferences,
	resolveProjectContextPreferences,
	savePreferences,
} from '@/config/preferences';
import {
	ensureDirectoryTrust,
	untrustedDirectoryMessage,
} from '@/config/trust/directory-trust';
import {resolveTune} from '@/config/tune';
import {
	TOOL_APPROVAL_REQUIRED_KIND,
	TOOL_APPROVAL_REQUIRED_PREFIX,
} from '@/constants';
import {applyTuneCompaction} from '@/conversation/compaction/auto-compact';
import {
	buildSystemPrompt,
	setLastBuiltPrompt,
} from '@/conversation/prompt-builder';
import {appendRelevantProjectContextWithCount} from '@/memory/project-context';
import {SemanticMemoryManager} from '@/memory/semantic-memory-manager';
import {
	type PlainConversationOutcome,
	runPlainConversation,
} from '@/plain/conversation';
import {initializePlain} from '@/plain/initialize';
import {
	color,
	writeBoot,
	writeError,
	writeLine,
	writeStatus,
	writeWarning,
} from '@/plain/writer';
import {loadPlugins} from '@/plugins/host';
import {
	beginSessionStartHooks,
	runLifecycleHooks,
	SESSION_END_HOOK_HANDLER,
	takePendingHookContext,
} from '@/services/lifecycle-hooks';
import {fileMutationPaths} from '@/tools/file-ops/file-mutating-tools';
import {getTuneToolMode} from '@/types/config';
import type {DevelopmentMode, Message} from '@/types/core';
import {formatError} from '@/utils/error-formatter';
import {setMessageQueueSink} from '@/utils/message-queue-core';
import {getShutdownManager} from '@/utils/shutdown';

export interface RunPlainShellOptions {
	prompt: string;
	developmentMode: DevelopmentMode;
	cliProvider?: string;
	cliModel?: string;
	trustDirectory: boolean;
	outputFormat: 'text' | 'json';
	/**
	 * Injectable seams for testing. Each defaults to the real implementation,
	 * so production call sites never need to pass this. Mirrors the pattern
	 * `runPlainConversation` already uses for `client`/`toolManager` — here
	 * the seams are the module-level singletons (`initializePlain`,
	 * `getShutdownManager`, preference I/O) that `runPlainShell` otherwise
	 * calls directly and that a unit test has no other way to intercept.
	 */
	deps?: Partial<RunPlainShellDeps>;
}

export interface RunPlainShellDeps {
	initializePlain: typeof initializePlain;
	runPlainConversation: typeof runPlainConversation;
	getShutdownManager: typeof getShutdownManager;
	loadPreferences: typeof loadPreferences;
	savePreferences: typeof savePreferences;
	appendRelevantProjectContextWithCount: typeof appendRelevantProjectContextWithCount;
	artifacts: Pick<
		ArtifactManager,
		| 'cleanupStaleEphemeralSessions'
		| 'markEphemeralSession'
		| 'deleteSessionArtifacts'
	>;
}

const defaultDeps: RunPlainShellDeps = {
	initializePlain,
	runPlainConversation,
	getShutdownManager,
	loadPreferences,
	savePreferences,
	appendRelevantProjectContextWithCount,
	artifacts: artifactManager,
};

/**
 * Headless equivalent of `nanocoder run "..."`. Skips Ink entirely:
 * the LLM, tool, MCP, and subagent stacks all initialize without React,
 * and the conversation loop streams to stdout via plain process.stdout.
 *
 * Exit codes:
 * 0  conversation completed naturally
 * 1  initialization or generation error
 * 2  tool approval was required (matches the Ink `run` behavior in
 * `useNonInteractiveMode`)
 */
export async function runPlainShell(
	options: RunPlainShellOptions,
): Promise<void> {
	const {
		prompt,
		developmentMode,
		cliProvider,
		cliModel,
		trustDirectory,
		outputFormat,
	} = options;

	const deps: RunPlainShellDeps = {...defaultDeps, ...options.deps};

	const isJson = outputFormat === 'json';
	const collectedWarnings: string[] = [];
	setMessageQueueSink((type, message) => {
		if (type === 'error') {
			collectedWarnings.push(message);
			writeError(message);
		} else if (type === 'warning') {
			collectedWarnings.push(message);
			writeWarning(message);
		}
	});

	const trust = ensureDirectoryTrust(process.cwd(), trustDirectory, {
		loadPreferences: deps.loadPreferences,
		savePreferences: deps.savePreferences,
	});
	if (trust.persisted) {
		writeStatus(
			`Marked ${path.resolve(process.cwd())} as trusted (NANOCODER_TRUST_DIRECTORY=1).`,
		);
	}
	if (!trust.trusted) {
		const message = untrustedDirectoryMessage(
			path.resolve(process.cwd()),
			trust.recheck,
		);
		if (isJson) {
			emitJsonReport({
				kind: 'error',
				exitCode: 1,
				finalText: '',
				reasoning: null,
				toolCalls: [],
				steps: 0,
				filesChanged: [],
				message,
				warnings: collectedWarnings,
			});
		} else {
			writeError(message);
		}
		setMessageQueueSink(null);
		await deps.getShutdownManager().gracefulShutdown(1);
		return;
	}

	let init;
	try {
		init = await deps.initializePlain({cliProvider, cliModel, developmentMode});
	} catch (error) {
		const formattedErr = formatError(error);
		if (isJson) {
			emitJsonReport({
				kind: 'error',
				exitCode: 1,
				finalText: '',
				reasoning: null,
				toolCalls: [],
				steps: 0,
				filesChanged: [],
				message: formattedErr,
				warnings: collectedWarnings,
			});
		} else {
			writeError(formattedErr);
		}
		setMessageQueueSink(null);
		await deps.getShutdownManager().gracefulShutdown(1);
		return;
	}

	const {client, toolManager, provider, model} = init;

	// Traditional status writes go to stderr via plain/writer, leaving stdout clean
	writeBoot(provider, model, developmentMode);

	const tune = resolveTune(
		getAppConfig(),
		client.getProviderConfig(),
		deps.loadPreferences(),
	);
	applyTuneCompaction(tune);
	const tuneToolMode = getTuneToolMode(tune);
	const toolsDisabled =
		tuneToolMode !== 'native' || isToolCallingDisabled(provider, model);
	const fallbackToolFormat: 'xml' | 'json' =
		tuneToolMode === 'json' ? 'json' : 'xml';
	const availableNames = toolManager.getAvailableToolNames(
		tune,
		developmentMode,
		undefined,
		model,
	);
	const basePrompt = buildSystemPrompt(
		developmentMode,
		tune,
		availableNames,
		toolsDisabled,
		getAppConfig().systemPrompt,
		model,
		undefined,
		toolManager,
	);
	const toolsForPrompt = toolsDisabled
		? toolManager.getFilteredTools(availableNames)
		: {};
	const toolPrompt = appendToolDefinitionsToPrompt(
		basePrompt,
		toolsDisabled,
		fallbackToolFormat,
		toolsForPrompt,
	);

	const projectContext = await deps.appendRelevantProjectContextWithCount(
		toolPrompt,
		prompt,
		new SemanticMemoryManager(),
		resolveProjectContextPreferences(deps.loadPreferences()),
	);
	const systemContent = projectContext.systemPrompt;
	if (projectContext.memoryCount > 0) {
		writeStatus(
			`Recalling ${projectContext.memoryCount} project memor${projectContext.memoryCount === 1 ? 'y' : 'ies'}...`,
		);
	}
	setLastBuiltPrompt(systemContent);

	const systemMessage: Message = {role: 'system', content: systemContent};

	// `run` / --plain is a session too, so it fires the same lifecycle points
	// as the TUI. session-end goes through the shutdown manager (priority -5)
	// so it runs on every exit path, including SIGINT.
	deps.getShutdownManager().register({
		name: SESSION_END_HOOK_HANDLER,
		priority: -5,
		handler: async () => {
			await runLifecycleHooks('session-end');
		},
	});

	await loadPlugins(true);
	await beginSessionStartHooks();

	const promptGate = await runLifecycleHooks('user-prompt-submit', {prompt});
	if (promptGate.blocked) {
		const message = promptGate.reason ?? 'Prompt blocked by a hook.';
		if (isJson) {
			emitJsonReport({
				kind: 'error',
				exitCode: 1,
				finalText: '',
				reasoning: null,
				toolCalls: [],
				steps: 0,
				filesChanged: [],
				message,
				warnings: collectedWarnings,
			});
		} else {
			writeError(message);
		}
		setMessageQueueSink(null);
		await deps.getShutdownManager().gracefulShutdown(1);
		return;
	}

	const hookContext = [await takePendingHookContext(), promptGate.output]
		.filter(Boolean)
		.join('\n\n');
	const initialMessages: Message[] = [
		{
			role: 'user',
			content: hookContext
				? `<hook-context>\n${hookContext}\n</hook-context>\n\n${prompt}`
				: prompt,
		},
	];

	const abortController = new AbortController();
	const sigint = () => abortController.abort();
	process.on('SIGINT', sigint);
	const sessionId = randomUUID();
	await deps.artifacts.cleanupStaleEphemeralSessions();
	await deps.artifacts.markEphemeralSession(sessionId);

	const shutdownManager = deps.getShutdownManager();
	shutdownManager.register({
		name: 'plain-shell-message-sink-cleanup',
		priority: 100,
		handler: async () => {
			setMessageQueueSink(null);
		},
	});
	const cleanupHandlerName = `plain-artifacts-${sessionId}`;
	let conversationPromise:
		| ReturnType<typeof deps.runPlainConversation>
		| undefined;
	let cleaned = false;
	const cleanupArtifacts = async () => {
		if (cleaned) return;
		await deps.artifacts.deleteSessionArtifacts(sessionId);
		cleaned = true;
		shutdownManager.unregister(cleanupHandlerName);
	};
	// Resolved just before the run asks to shut down with its own exit code.
	// A shutdown started by SIGTERM/SIGINT waits for it, so the aborted run
	// still prints its report and the process exits with the run's code (1)
	// rather than the signal's 0. It must resolve before gracefulShutdown is
	// called: on a normal finish that call runs this handler itself.
	let markReported: () => void = () => undefined;
	const reported = new Promise<void>(resolve => {
		markReported = resolve;
	});
	shutdownManager.register({
		name: cleanupHandlerName,
		priority: 10,
		handler: async () => {
			abortController.abort();
			if (conversationPromise) {
				await conversationPromise.catch(() => undefined);
				await reported;
			}
			await cleanupArtifacts();
		},
	});
	const finish = async (code: number) => {
		markReported();
		await shutdown(code, deps);
	};

	const nonInteractiveAlwaysAllow = getAppConfig().alwaysAllow ?? [];

	if (!isJson) {
		writeLine();
	}

	let outcome: PlainConversationOutcome;
	try {
		conversationPromise = deps.runPlainConversation({
			client,
			toolManager,
			systemMessage,
			initialMessages,
			developmentMode,
			nonInteractiveAlwaysAllow,
			abortSignal: abortController.signal,
			tune,
			model,
			outputFormat,
			sessionId,
			workingDirectory: process.cwd(),
		});
		outcome = await conversationPromise;
	} catch (error) {
		// runPlainConversation returns provider failures as an `error` outcome
		// itself. This backstop covers anything else it throws, so the run
		// still reports and exits through graceful shutdown (session-end).
		outcome = {
			kind: 'error',
			message: formatError(error),
			finalText: '',
			reasoning: null,
			toolCalls: [],
			steps: 0,
		};
	} finally {
		process.off('SIGINT', sigint);
		await cleanupArtifacts();
	}

	if (isJson) {
		const exitCode =
			outcome.kind === 'success' ? 0 : outcome.kind === 'error' ? 1 : 2;

		const filesChangedSet = new Set<string>();

		const formattedToolCalls = (outcome.toolCalls || []).map(tc => {
			// A failed or refused call changed nothing. The paths are reported as
			// the model gave them and the tool accepted them, `../x` included:
			// the tool's own path checks already decided they were allowed.
			if (tc.error === null) {
				for (const filePath of fileMutationPaths(tc.name, tc.arguments)) {
					filesChangedSet.add(filePath);
				}
			}
			return {
				name: tc.name,
				arguments: tc.arguments || {},
				result: tc.result ?? null,
				error: tc.error ?? null,
			};
		});

		// Build report with validated fields
		const report = {
			kind: outcome.kind,
			exitCode,
			finalText: outcome.finalText || '',
			reasoning: outcome.reasoning || null,
			toolCalls: formattedToolCalls,
			steps: outcome.steps,
			filesChanged: Array.from(filesChangedSet),
			warnings: collectedWarnings,
			...(outcome.usage && {
				usage: outcome.usage,
			}),
			...(outcome.kind === 'error' && {
				message: outcome.message,
			}),
			...(outcome.kind === TOOL_APPROVAL_REQUIRED_KIND && {
				toolNames: outcome.toolNames,
				autoAcceptWouldRun: outcome.autoAcceptWouldRun,
			}),
		};

		emitJsonReport(report);

		markReported();
		setMessageQueueSink(null);
		await deps.getShutdownManager().gracefulShutdown(exitCode);
		return;
	}

	switch (outcome.kind) {
		case 'success':
			await finish(0);
			return;
		case TOOL_APPROVAL_REQUIRED_KIND:
			writeError(
				formatToolApprovalRequired(
					outcome.toolNames,
					outcome.autoAcceptWouldRun,
				),
			);
			await finish(2);
			return;
		case 'error':
			writeError(outcome.message);
			await finish(1);
			return;
	}
}

/**
 * Only suggests what would change the result. Auto-accept still asks before
 * bash and irreversible file ops, so it is offered only when it would have run
 * every blocked call. `alwaysAllow` is read only from inside the `nanocoder`
 * object, so the hint spells out that shape.
 */
function formatToolApprovalRequired(
	toolNames: string[],
	autoAcceptWouldRun: boolean,
): string {
	const uniqueNames = [...new Set(toolNames)];
	const modes = autoAcceptWouldRun
		? '--mode auto-accept or --mode yolo'
		: '--mode yolo';
	const quotedNames = uniqueNames.map(name => JSON.stringify(name)).join(', ');
	return (
		`${TOOL_APPROVAL_REQUIRED_PREFIX}${uniqueNames.join(', ')}. ` +
		`Re-run with ${modes}, or allow ${uniqueNames.length === 1 ? 'it' : 'them'} ` +
		`in agents.config.json: {"nanocoder": {"alwaysAllow": [${quotedNames}]}}`
	);
}

function isToolCallingDisabled(provider: string, model: string): boolean {
	const config = getAppConfig();
	const providerConfig = config.providers?.find(p => p.name === provider);
	if (!providerConfig) return false;
	return providerConfig.disableToolModels?.includes(model) ?? false;
}

function emitJsonReport(report: unknown): void {
	try {
		// Validate report structure before serialization
		if (!report || typeof report !== 'object') {
			process.stderr.write('Error: Invalid report structure\n');
			return;
		}
		const serialized = JSON.stringify(report, null, 2);
		process.stdout.write(serialized + '\n');
	} catch (err) {
		process.stderr.write(
			`Error: Failed to serialize JSON report: ${err instanceof Error ? err.message : String(err)}\n`,
		);
	}
}

async function shutdown(code: number, deps: RunPlainShellDeps): Promise<void> {
	setMessageQueueSink(null);
	if (code === 0) {
		writeLine();
		writeStatus(color('green', 'done'));
	}
	await deps.getShutdownManager().gracefulShutdown(code);
}
