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
import {resolveTune} from '@/config/tune';
import {
	TOOL_APPROVAL_REQUIRED_KIND,
	TOOL_APPROVAL_REQUIRED_PREFIX,
} from '@/constants';
import {appendRelevantProjectContextWithCount} from '@/memory/project-context';
import {SemanticMemoryManager} from '@/memory/semantic-memory-manager';
import {runPlainConversation} from '@/plain/conversation';
import {initializePlain} from '@/plain/initialize';
import {
	color,
	writeBoot,
	writeError,
	writeLine,
	writeStatus,
} from '@/plain/writer';
import {
	beginSessionStartHooks,
	runLifecycleHooks,
	SESSION_END_HOOK_HANDLER,
	takePendingHookContext,
} from '@/services/lifecycle-hooks';
import {getTuneToolMode} from '@/types/config';
import type {DevelopmentMode, Message} from '@/types/core';
import {formatError} from '@/utils/error-formatter';
import {buildSystemPrompt, setLastBuiltPrompt} from '@/utils/prompt-builder';
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

	if (!ensureDirectoryTrust(trustDirectory, deps)) {
		if (isJson) {
			const cwd = path.resolve(process.cwd());
			emitJsonReport({
				kind: 'error',
				exitCode: 1,
				finalText: '',
				reasoning: null,
				toolCalls: [],
				filesChanged: [],
				message: `Directory ${cwd} is not trusted. Pass --trust-directory or set NANOCODER_TRUST_DIRECTORY=1 to bypass the disclaimer for this run.`,
			});
		} else {
			const cwd = path.resolve(process.cwd());
			writeError(
				`Directory ${cwd} is not trusted. Pass --trust-directory or set ` +
					`NANOCODER_TRUST_DIRECTORY=1 to bypass the disclaimer for this run.`,
			);
		}
		await deps.getShutdownManager().gracefulShutdown(1);
		return;
	}

	let init;
	try {
		init = await deps.initializePlain({cliProvider, cliModel});
	} catch (error) {
		const formattedErr = formatError(error);
		if (isJson) {
			emitJsonReport({
				kind: 'error',
				exitCode: 1,
				finalText: '',
				reasoning: null,
				toolCalls: [],
				filesChanged: [],
				message: formattedErr,
			});
		} else {
			writeError(formattedErr);
		}
		await deps.getShutdownManager().gracefulShutdown(1);
		return;
	}

	const {client, toolManager, provider, model} = init;

	// Traditional status writes go to stderr via plain/writer, leaving stdout clean
	writeBoot(provider, model, developmentMode);

	const tune = resolveTune(getAppConfig(), undefined, deps.loadPreferences());
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
				filesChanged: [],
				message,
			});
		} else {
			writeError(message);
		}
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
	shutdownManager.register({
		name: cleanupHandlerName,
		priority: 10,
		handler: async () => {
			abortController.abort();
			await conversationPromise?.catch(() => undefined);
			await cleanupArtifacts();
		},
	});

	const nonInteractiveAlwaysAllow = getAppConfig().alwaysAllow ?? [];

	if (!isJson) {
		writeLine();
	}

	let outcome;
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
	} finally {
		process.off('SIGINT', sigint);
		await cleanupArtifacts();
	}

	if (isJson) {
		const exitCode =
			outcome.kind === 'success' ? 0 : outcome.kind === 'error' ? 1 : 2;

		// Must match the registered names in source/tools/file-ops/. Any name
		// listed here that isn't a real tool silently drops its edits from
		// `filesChanged`.
		const mutatingTools = ['write_file', 'string_replace', 'diff_edit'];
		const filesChangedSet = new Set<string>();

		const formattedToolCalls = (outcome.toolCalls || []).map(tc => {
			if (mutatingTools.includes(tc.name)) {
				const filePath = tc.arguments?.path || tc.arguments?.file_path;
				// Only include file paths that are strings (type-safe extraction)
				if (typeof filePath === 'string' && isValidFilePath(filePath)) {
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
			finalText: sanitizeOutput(outcome.finalText || ''),
			reasoning: outcome.reasoning ? sanitizeOutput(outcome.reasoning) : null,
			toolCalls: formattedToolCalls,
			filesChanged: Array.from(filesChangedSet),
			...(outcome.usage && {
				usage: outcome.usage,
			}),
			...(outcome.kind === 'error' && {
				message: sanitizeOutput(outcome.message),
			}),
			...(outcome.kind === TOOL_APPROVAL_REQUIRED_KIND && {
				toolNames: outcome.toolNames,
			}),
		};

		emitJsonReport(report);

		await deps.getShutdownManager().gracefulShutdown(exitCode);
		return;
	}

	switch (outcome.kind) {
		case 'success':
			await shutdown(0, deps);
			return;
		case TOOL_APPROVAL_REQUIRED_KIND:
			writeError(
				`${TOOL_APPROVAL_REQUIRED_PREFIX}${outcome.toolNames.join(', ')}. ` +
					`Re-run with --mode auto-accept or --mode yolo, or add the tools to ` +
					`agents.config.json "alwaysAllow".`,
			);
			await shutdown(2, deps);
			return;
		case 'error':
			writeError(outcome.message);
			await shutdown(1, deps);
			return;
	}
}

function isToolCallingDisabled(provider: string, model: string): boolean {
	const config = getAppConfig();
	const providerConfig = config.providers?.find(p => p.name === provider);
	if (!providerConfig) return false;
	return providerConfig.disableToolModels?.includes(model) ?? false;
}

function ensureDirectoryTrust(
	trustDirectoryFlag: boolean,
	deps: RunPlainShellDeps,
): boolean {
	if (trustDirectoryFlag) return true;
	const cwd = path.resolve(process.cwd());
	const preferences = deps.loadPreferences();
	const trusted = (preferences.trustedDirectories ?? []).some(
		dir => path.resolve(dir) === cwd,
	);
	if (trusted) return true;

	if (process.env.NANOCODER_TRUST_DIRECTORY === '1') {
		const updated = preferences.trustedDirectories ?? [];
		updated.push(cwd);
		deps.savePreferences({...preferences, trustedDirectories: updated});
		writeStatus(`Marked ${cwd} as trusted (NANOCODER_TRUST_DIRECTORY=1).`);
		return true;
	}

	return false;
}

/**
 * Validate file paths to prevent directory traversal and injection attacks.
 * Allows absolute paths and relative paths, but rejects null bytes and
 * excessive path traversal patterns.
 */
function isValidFilePath(filePath: string): boolean {
	// Reject null bytes
	if (filePath.includes('\0')) {
		return false;
	}
	// Allow absolute paths and relative paths, but reject paths with
	// excessive parent directory references (e.g., "../../../../../../etc/passwd")
	const parts = filePath.split('/');
	let depth = 0;
	for (const part of parts) {
		if (part === '..') {
			depth--;
			// Reject if we go above the root
			if (depth < 0) {
				return false;
			}
		} else if (part !== '.' && part !== '') {
			depth++;
		}
	}
	return true;
}

/**
 * Sanitize string output to prevent injection attacks in JSON.
 * Ensures the string doesn't contain unescaped control characters or
 * suspicious patterns that could break JSON encoding.
 */
function sanitizeOutput(value: string): string {
	// JSON.stringify handles escaping, but we add an extra layer to catch
	// any unusual control characters that could be problematic
	if (typeof value !== 'string') {
		return '';
	}
	// Allow normal strings; JSON.stringify will properly escape special chars
	return value;
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
	if (code === 0) {
		writeLine();
		writeStatus(color('green', 'done'));
	}
	await deps.getShutdownManager().gracefulShutdown(code);
}
