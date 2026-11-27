import {randomUUID} from 'node:crypto';
import {realpathSync, statSync} from 'node:fs';
import path from 'node:path';
import {Writable} from 'node:stream';
import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import type {Transport} from '@modelcontextprotocol/sdk/shared/transport.js';
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import {artifactManager} from '@/artifacts/artifact-manager';
import {getAppConfig} from '@/config/index';
import {
	loadPreferences,
	resolveProjectContextPreferences,
	savePreferences,
} from '@/config/preferences';
import {bootstrapProjectDotenv} from '@/config/project-dotenv';
import {
	ensureDirectoryTrust,
	untrustedDirectoryMessage,
} from '@/config/trust/directory-trust';
import {resolveTune} from '@/config/tune';
import {TOOL_APPROVAL_REQUIRED_KIND} from '@/constants';
import {applyTuneCompaction} from '@/conversation/compaction/auto-compact';
import {setLastBuiltPrompt} from '@/conversation/prompt-builder';
import {buildProjectContextSection} from '@/memory/project-context';
import {SemanticMemoryManager} from '@/memory/semantic-memory-manager';
import {runPlainConversation} from '@/plain/conversation';
import {initializePlain} from '@/plain/initialize';
import {
	composePlainSystemPrompt,
	isToolCallingDisabled,
	summarizeFileMutations,
} from '@/plain/runtime-helpers';
import {writeError, writeStatus, writeWarning} from '@/plain/writer';
import {appendActivePlanContext} from '@/plans/context';
import {loadPlugins} from '@/plugins/host';
import {
	type HeadlessReviewJson,
	type HeadlessReviewTier,
	runHeadlessReview,
} from '@/review/headless-review';
import {bashExecutor} from '@/services/bash-executor';
import {runLifecycleHooks} from '@/services/lifecycle-hooks';
import {
	createSessionContext,
	runInSessionContext,
} from '@/services/session-context';
import {getCliSessionId, setCliSessionId} from '@/session/cli-session-context';
import type {ToolManager} from '@/tools/tool-manager';
import {getTuneToolMode} from '@/types/config';
import type {DevelopmentMode, Message} from '@/types/core';
import {formatError} from '@/utils/error-formatter';
import {setMessageQueueSink} from '@/utils/message-queue-core';
import {getPackageVersion} from '@/utils/package-version';
import {getShutdownManager} from '@/utils/shutdown';
import {appendTurnContext} from '@/utils/turn-context';

const MCP_SERVER_VERSION = getPackageVersion();

export type McpDevelopmentMode =
	| 'normal'
	| 'auto-accept'
	| 'yolo'
	| 'plan'
	| 'architect';

export interface McpRunTaskResult {
	status: 'success' | 'tool-approval-required' | 'error' | 'cancelled';
	finalText: string;
	filesChanged: string[];
	steps: number;
	structured?: unknown;
	usage?: unknown;
	message?: string;
	toolNames?: string[];
	autoAcceptWouldRun?: boolean;
	warnings?: string[];
}

export interface McpReviewDiffResult {
	status: HeadlessReviewJson['status'];
	tier: HeadlessReviewTier;
	report: HeadlessReviewJson;
	exitCode: number;
}

export interface McpRunTaskInput {
	prompt: string;
	cwd: string;
	mode: McpDevelopmentMode;
	model?: string;
	provider?: string;
	signal: AbortSignal;
	onProgress: (message: string) => void;
}

export interface McpReviewDiffInput {
	request?: string;
	cwd: string;
	tier: HeadlessReviewTier;
	model?: string;
	provider?: string;
	signal: AbortSignal;
	onProgress: (message: string) => void;
}

export interface McpTrustResult {
	trusted: boolean;
	message?: string;
}

export interface McpServerDependencies {
	resolveTrust: (
		cwd: string,
		bypass: boolean,
	) => McpTrustResult | Promise<McpTrustResult>;
	runTask: (input: McpRunTaskInput) => Promise<McpRunTaskResult>;
	reviewDiff: (input: McpReviewDiffInput) => Promise<McpReviewDiffResult>;
}

export interface McpServerOptions {
	/** The directory passed by the CLI. In-process execution remains bound to it. */
	cwd?: string;
	/** Maximum mode allowed to per-call `run_task` requests. Defaults to plan. */
	developmentMode?: DevelopmentMode;
	cliProvider?: string;
	cliModel?: string;
	/** Explicit one-run bypass of the saved directory-trust check. */
	trustDirectory?: boolean;
	/** Test seams; production callers use the shared Nanocoder runtimes. */
	deps?: Partial<McpServerDependencies>;
}

const TOOL_DEFINITIONS = [
	{
		name: 'run_task',
		description:
			'Run a non-interactive Nanocoder task in the server launch directory. The result includes the final answer, files changed, and outcome status. The default mode is plan. A requested cwd must resolve to the launch directory.',
		inputSchema: {
			type: 'object',
			properties: {
				prompt: {
					type: 'string',
					description: 'The task for Nanocoder to perform.',
				},
				cwd: {
					type: 'string',
					description: 'Optional; must resolve to the server launch directory.',
				},
				mode: {
					type: 'string',
					enum: ['plan', 'architect', 'normal', 'auto-accept', 'yolo'],
					description:
						'Task mode. Defaults to plan and cannot exceed the server mode ceiling.',
				},
				model: {type: 'string', description: 'Optional model override.'},
			},
			required: ['prompt'],
			additionalProperties: false,
		},
	},
	{
		name: 'review_diff',
		description:
			'Review changes in the server launch directory with Nanocoder’s existing headless review path. Defaults to a grounded review of the current branch/worktree scope. A requested cwd must resolve to the launch directory.',
		inputSchema: {
			type: 'object',
			properties: {
				request: {
					type: 'string',
					description:
						'Optional review scope or focus, such as a branch or pull request.',
				},
				cwd: {
					type: 'string',
					description: 'Optional; must resolve to the server launch directory.',
				},
				tier: {
					type: 'string',
					enum: ['grounded', 'deep', 'quick'],
					description: 'Review tier. Defaults to grounded.',
				},
				model: {type: 'string', description: 'Optional model override.'},
			},
			additionalProperties: false,
		},
	},
];

const DEFAULT_TRUST_RESOLVER: McpServerDependencies['resolveTrust'] = (
	cwd,
	bypass,
) => {
	const trust = ensureDirectoryTrust(cwd, bypass, {
		loadPreferences,
		savePreferences,
	});
	return {
		trusted: trust.trusted,
		...(!trust.trusted
			? {message: untrustedDirectoryMessage(path.resolve(cwd), trust.recheck)}
			: {}),
	};
};

const MODE_CEILING: Record<McpDevelopmentMode, number> = {
	plan: 0,
	architect: 1,
	normal: 2,
	'auto-accept': 3,
	yolo: 4,
};

function isMcpMode(value: unknown): value is McpDevelopmentMode {
	return typeof value === 'string' && Object.hasOwn(MODE_CEILING, value);
}

function isReviewTier(value: unknown): value is HeadlessReviewTier {
	return value === 'grounded' || value === 'deep' || value === 'quick';
}

function canonicalDirectory(directory: string): string {
	const resolved = realpathSync.native(path.resolve(directory));
	if (!statSync(resolved).isDirectory()) {
		throw new Error(`Not a directory: ${directory}`);
	}
	return resolved;
}

function sameDirectory(left: string, right: string): boolean {
	if (process.platform === 'win32') {
		return left.toLocaleLowerCase('en-US') === right.toLocaleLowerCase('en-US');
	}
	return left === right;
}

function requestedDirectory(
	requested: unknown,
	launchDirectory: string,
): {cwd: string} | {code: 'invalid_cwd'; message: string} {
	if (requested === undefined) return {cwd: launchDirectory};
	if (typeof requested !== 'string' || requested.trim().length === 0) {
		return {
			code: 'invalid_cwd',
			message:
				'cwd must be a directory path resolving to the server launch directory.',
		};
	}
	try {
		// Do not probe caller-supplied paths: resolving a UNC path with realpath
		// can access a remote share. The project context is fixed at server start,
		// so a lexical normalization is sufficient to accept `.` and equivalent
		// paths while refusing any other directory.
		const cwd = path.resolve(launchDirectory, requested);
		if (!sameDirectory(cwd, launchDirectory)) {
			return {
				code: 'invalid_cwd',
				message: `Requested cwd normalizes to ${cwd}, but this server is bound to ${launchDirectory}. Start a separate Nanocoder MCP server in the desired directory.`,
			};
		}
		return {cwd: launchDirectory};
	} catch (error) {
		return {
			code: 'invalid_cwd',
			message: `Cannot use requested cwd: ${formatError(error)}`,
		};
	}
}

function modeForServer(options: McpServerOptions): McpDevelopmentMode {
	return isMcpMode(options.developmentMode) ? options.developmentMode : 'plan';
}

function makeProgressReporter(extra: {
	sendNotification: (notification: McpProgressNotification) => Promise<void>;
	_meta?: {progressToken?: string | number};
}): (message: string) => void {
	const progressToken = extra._meta?.progressToken;
	let progress = 0;
	return message => {
		if (progressToken === undefined) return;
		progress += 1;
		void extra
			.sendNotification({
				method: 'notifications/progress',
				params: {progressToken, progress, message},
			})
			.catch(() => undefined);
	};
}

function toolResult<T extends object>(
	result: T,
	isError = false,
): {
	content: Array<{type: 'text'; text: string}>;
	structuredContent: Record<string, unknown>;
	isError?: boolean;
} {
	return {
		content: [{type: 'text', text: JSON.stringify(result, null, 2)}],
		structuredContent: result as Record<string, unknown>,
		...(isError ? {isError: true} : {}),
	};
}

function errorResult(
	code: string,
	message: string,
): ReturnType<typeof toolResult> {
	return toolResult({status: 'error', code, message}, true);
}

function canceledTaskResult(): McpRunTaskResult {
	return {
		status: 'cancelled',
		finalText: '',
		filesChanged: [],
		steps: 0,
		message: 'Task cancelled.',
	};
}

function cancelledReviewResult(tier: HeadlessReviewTier): McpReviewDiffResult {
	return {
		status: 'cancelled',
		tier,
		exitCode: 130,
		report: {
			tier,
			status: 'cancelled',
			message: 'Review cancelled.',
			findings: [],
			dropped: [],
			unverified: [],
			incompleteReasons: [],
			notes: [],
			stats: {reported: 0, verifierRuns: 0, modelCalls: 0, toolCalls: 0},
		},
	};
}

/**
 * Run one headless task using the same prompt, trust, hooks, approval policy,
 * tools, and turn engine as `nanocoder run`, without the shell's process exit
 * or stdout report. This is intentionally launch-directory-only because
 * initializePlain and the tool stack use process.cwd() and process globals.
 */
type McpRunTaskInputWithSession = McpRunTaskInput & {sessionId: string};

async function runNanocoderTask(
	input: McpRunTaskInput,
): Promise<McpRunTaskResult> {
	const context = createSessionContext(input.cwd);
	const sessionId = randomUUID();
	context.sessionId = sessionId;
	const previousCliSessionId = getCliSessionId();
	setCliSessionId(sessionId);
	try {
		return await runInSessionContext(context, () =>
			runNanocoderTaskInContext({...input, sessionId}),
		);
	} finally {
		setCliSessionId(previousCliSessionId);
	}
}

async function runNanocoderTaskInContext(
	input: McpRunTaskInputWithSession,
): Promise<McpRunTaskResult> {
	const warnings: string[] = [];
	setMessageQueueSink((type, message) => {
		if (type === 'error') {
			warnings.push(message);
			writeError(message);
		} else if (type === 'warning') {
			warnings.push(message);
			writeWarning(message);
		}
	});

	const sessionId = input.sessionId;
	let toolManager: ToolManager | undefined;
	let sessionHooksStarted = false;
	try {
		if (input.signal.aborted) return canceledTaskResult();
		// Project environment variables are executable configuration. Load them
		// only after the caller has passed the request-time trust check.
		bootstrapProjectDotenv(input.cwd);
		const init = await initializePlain({
			cliProvider: input.provider,
			cliModel: input.model,
			developmentMode: input.mode,
			persistSelection: false,
		});
		toolManager = init.toolManager;
		if (input.signal.aborted) return canceledTaskResult();
		writeStatus(`nanocoder · ${init.provider} · ${init.model} · ${input.mode}`);

		const appConfig = getAppConfig();
		const preferences = loadPreferences();
		const tune = resolveTune(
			appConfig,
			init.client.getProviderConfig(),
			preferences,
		);
		applyTuneCompaction(tune);
		const tuneToolMode = getTuneToolMode(tune);
		const toolsDisabled =
			tuneToolMode !== 'native' ||
			isToolCallingDisabled(init.provider, init.model);
		const fallbackToolFormat: 'xml' | 'json' =
			tuneToolMode === 'json' ? 'json' : 'xml';
		const availableNames = init.toolManager.getAvailableToolNames(
			tune,
			input.mode,
			undefined,
			init.model,
		);
		const toolPrompt = composePlainSystemPrompt({
			developmentMode: input.mode,
			tune,
			availableToolNames: availableNames,
			toolsDisabled,
			fallbackToolFormat,
			systemPromptOverride: appConfig.systemPrompt,
			model: init.model,
			toolManager: init.toolManager,
		});
		const projectContext = await buildProjectContextSection(
			input.prompt,
			new SemanticMemoryManager(),
			resolveProjectContextPreferences(preferences),
		);
		const planAwarePrompt = await appendActivePlanContext(toolPrompt);
		setLastBuiltPrompt(planAwarePrompt);
		const systemMessage: Message = {role: 'system', content: planAwarePrompt};

		await loadPlugins(true);
		sessionHooksStarted = true;
		const sessionStart = await runLifecycleHooks('session-start');
		if (input.signal.aborted) return canceledTaskResult();
		const promptGate = await runLifecycleHooks('user-prompt-submit', {
			prompt: input.prompt,
		});
		if (input.signal.aborted) return canceledTaskResult();
		if (promptGate.blocked) {
			return {
				status: 'error',
				finalText: '',
				filesChanged: [],
				steps: 0,
				message: promptGate.reason ?? 'Prompt blocked by a hook.',
				warnings,
			};
		}
		const hookContext = [sessionStart.output, promptGate.output]
			.filter(Boolean)
			.join('\n\n');
		const initialMessages: Message[] = [
			{
				role: 'user',
				content: appendTurnContext(
					hookContext
						? `<hook-context>\n${hookContext}\n</hook-context>\n\n${input.prompt}`
						: input.prompt,
					[projectContext.content],
				),
			},
		];

		await artifactManager.cleanupStaleEphemeralSessions();
		await artifactManager.markEphemeralSession(sessionId);
		input.onProgress('Starting task');
		const outcome = await runPlainConversation({
			client: init.client,
			toolManager: init.toolManager,
			systemMessage,
			initialMessages,
			developmentMode: input.mode,
			nonInteractiveAlwaysAllow: appConfig.alwaysAllow ?? [],
			abortSignal: input.signal,
			tune,
			model: init.model,
			outputFormat: 'json',
			sessionId,
			workingDirectory: input.cwd,
			onProgress: event => {
				input.onProgress(
					event.type === 'model'
						? `Model turn ${event.step}`
						: `Running tool ${event.name}`,
				);
			},
		});

		const common = {
			finalText: outcome.finalText,
			filesChanged: summarizeFileMutations(outcome.toolCalls),
			steps: outcome.steps,
			...(outcome.usage ? {usage: outcome.usage} : {}),
			warnings,
		};
		if (input.signal.aborted) {
			return {
				...common,
				status: 'cancelled',
				message: 'Task cancelled.',
			};
		}
		if (outcome.kind === 'success') {
			return {
				...common,
				status: 'success',
				...(outcome.structured !== undefined
					? {structured: outcome.structured}
					: {}),
			};
		}
		if (outcome.kind === TOOL_APPROVAL_REQUIRED_KIND) {
			return {
				...common,
				status: 'tool-approval-required',
				toolNames: outcome.toolNames,
				autoAcceptWouldRun: outcome.autoAcceptWouldRun,
			};
		}
		return {
			...common,
			status: 'error',
			message: outcome.message,
		};
	} catch (error) {
		if (input.signal.aborted) return canceledTaskResult();
		return {
			status: 'error',
			finalText: '',
			filesChanged: [],
			steps: 0,
			message: formatError(error),
			warnings,
		};
	} finally {
		if (sessionHooksStarted) {
			try {
				await runLifecycleHooks('session-end');
			} catch (error) {
				writeWarning(`Session-end hook failed: ${formatError(error)}`);
			}
		}
		try {
			await artifactManager.deleteSessionArtifacts(sessionId);
		} catch (error) {
			writeWarning(`Session artifact cleanup failed: ${formatError(error)}`);
		}
		try {
			bashExecutor.killAll();
		} catch (error) {
			writeWarning(`Background job cleanup failed: ${formatError(error)}`);
		}
		try {
			await toolManager?.disconnectMCP();
		} catch (error) {
			writeWarning(`MCP tool cleanup failed: ${formatError(error)}`);
		}
		setMessageQueueSink(null);
	}
}

async function runNanocoderReview(
	input: McpReviewDiffInput,
): Promise<McpReviewDiffResult> {
	const context = createSessionContext(input.cwd);
	const sessionId = randomUUID();
	context.sessionId = sessionId;
	const previousCliSessionId = getCliSessionId();
	setCliSessionId(sessionId);
	try {
		return await runInSessionContext(context, () =>
			runNanocoderReviewInContext(input),
		);
	} finally {
		setCliSessionId(previousCliSessionId);
	}
}

async function runNanocoderReviewInContext(
	input: McpReviewDiffInput,
): Promise<McpReviewDiffResult> {
	if (input.signal.aborted) return cancelledReviewResult(input.tier);
	bootstrapProjectDotenv(input.cwd);
	let toolManager: ToolManager | undefined;
	try {
		const init = await initializePlain({
			cliProvider: input.provider,
			cliModel: input.model,
			developmentMode: 'plan',
			persistSelection: false,
		});
		toolManager = init.toolManager;
		if (input.signal.aborted) return cancelledReviewResult(input.tier);
		const preferences = loadPreferences();
		const tune = resolveTune(
			getAppConfig(),
			init.client.getProviderConfig(),
			preferences,
		);
		const review = await runHeadlessReview({
			args: input.request ? [input.request] : [],
			tier: input.tier,
			client: init.client,
			provider: init.provider,
			model: init.model,
			tune,
			outputFormat: 'json',
			signal: input.signal,
			writeProgress: input.onProgress,
		});
		const report = JSON.parse(review.stdout) as HeadlessReviewJson;
		return {
			status: report.status,
			tier: input.tier,
			report,
			exitCode: review.exitCode,
		};
	} catch (error) {
		if (input.signal.aborted) return cancelledReviewResult(input.tier);
		const report: HeadlessReviewJson = {
			tier: input.tier,
			status: 'failed',
			message: formatError(error),
			findings: [],
			dropped: [],
			unverified: [],
			incompleteReasons: [],
			notes: [],
			stats: {reported: 0, verifierRuns: 0, modelCalls: 0, toolCalls: 0},
		};
		return {status: 'failed', tier: input.tier, report, exitCode: 1};
	} finally {
		try {
			await toolManager?.disconnectMCP();
		} catch (error) {
			writeWarning(`Review MCP cleanup failed: ${formatError(error)}`);
		}
	}
}

function serialize<T>(
	previous: Promise<void>,
	work: () => Promise<T>,
): {result: Promise<T>; next: Promise<void>} {
	let release: () => void = () => {};
	const next = new Promise<void>(resolve => {
		release = resolve;
	});
	const result = previous.then(work).finally(release);
	return {result, next};
}

interface McpServerLifecycle {
	abortActive: () => void;
	drain: () => Promise<void>;
}

const SERVER_LIFECYCLE = new WeakMap<Server, McpServerLifecycle>();

class McpOperationCancelled extends Error {}

const ALLOWED_MODES_BY_CEILING: Record<
	McpDevelopmentMode,
	ReadonlySet<McpDevelopmentMode>
> = {
	plan: new Set(['plan']),
	architect: new Set(['plan', 'architect']),
	normal: new Set(['plan', 'normal']),
	'auto-accept': new Set(['plan', 'normal', 'auto-accept']),
	yolo: new Set(['plan', 'architect', 'normal', 'auto-accept', 'yolo']),
};

function hasOnlyKeys(
	args: Record<string, unknown>,
	allowed: readonly string[],
): boolean {
	const allowedSet = new Set(allowed);
	return Object.keys(args).every(key => allowedSet.has(key));
}

interface McpProgressNotification {
	method: 'notifications/progress';
	params: {
		progressToken: string | number;
		progress: number;
		message: string;
	};
}

/**
 * Create an MCP server without attaching it to stdio. This is also the seam
 * for clients/tests that provide an in-memory MCP transport.
 */
export function createNanocoderMcpServer(
	options: McpServerOptions = {},
): Server {
	const processDirectory = canonicalDirectory(process.cwd());
	const launchDirectory = canonicalDirectory(options.cwd ?? processDirectory);
	if (!sameDirectory(launchDirectory, processDirectory)) {
		throw new Error(
			`MCP server cwd must match the process launch directory (${processDirectory}). Start Nanocoder from the directory you want to expose.`,
		);
	}
	const ceiling = modeForServer(options);
	const deps: McpServerDependencies = {
		resolveTrust: options.deps?.resolveTrust ?? DEFAULT_TRUST_RESOLVER,
		runTask: options.deps?.runTask ?? runNanocoderTask,
		reviewDiff: options.deps?.reviewDiff ?? runNanocoderReview,
	};
	let queue: Promise<void> = Promise.resolve();
	const activeControllers = new Set<AbortController>();
	const server = new Server(
		{name: 'nanocoder', version: MCP_SERVER_VERSION},
		{capabilities: {tools: {}}},
	);
	SERVER_LIFECYCLE.set(server, {
		abortActive: () => {
			for (const controller of activeControllers) controller.abort();
		},
		drain: () => queue,
	});

	server.setRequestHandler(ListToolsRequestSchema, async () => ({
		tools: TOOL_DEFINITIONS,
	}));
	server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
		const args = request.params.arguments ?? {};
		const progress = makeProgressReporter(extra);
		const cwdResult = requestedDirectory(args.cwd, launchDirectory);
		if ('code' in cwdResult)
			return errorResult(cwdResult.code, cwdResult.message);
		const cwd = cwdResult.cwd;

		const invoke = async <T>(
			requestSignal: AbortSignal,
			work: (signal: AbortSignal) => Promise<T>,
		): Promise<T> => {
			const controller = new AbortController();
			const abort = () => controller.abort(requestSignal.reason);
			if (requestSignal.aborted) abort();
			else requestSignal.addEventListener('abort', abort, {once: true});
			activeControllers.add(controller);
			const queued = serialize(queue, async () => {
				if (controller.signal.aborted) throw new McpOperationCancelled();
				return work(controller.signal);
			});
			queue = queued.next;
			try {
				return await queued.result;
			} catch (error) {
				if (controller.signal.aborted) throw new McpOperationCancelled();
				throw error;
			} finally {
				requestSignal.removeEventListener('abort', abort);
				activeControllers.delete(controller);
			}
		};

		if (request.params.name === 'run_task') {
			if (!hasOnlyKeys(args, ['prompt', 'cwd', 'mode', 'model'])) {
				return errorResult(
					'invalid_arguments',
					'run_task received an unsupported argument.',
				);
			}
			if (typeof args.prompt !== 'string' || args.prompt.trim().length === 0) {
				return errorResult(
					'invalid_arguments',
					'prompt must be a non-empty string.',
				);
			}
			const mode = args.mode === undefined ? 'plan' : args.mode;
			if (!isMcpMode(mode)) {
				return errorResult(
					'invalid_mode',
					'Mode must be one of plan, architect, normal, auto-accept, or yolo.',
				);
			}
			if (!ALLOWED_MODES_BY_CEILING[ceiling].has(mode)) {
				return errorResult(
					'mode_ceiling_exceeded',
					`Requested mode "${mode}" exceeds this server's "${ceiling}" mode ceiling. Start Nanocoder with --mode ${mode} to allow it.`,
				);
			}
			if (
				args.model !== undefined &&
				(typeof args.model !== 'string' || !args.model.trim())
			) {
				return errorResult(
					'invalid_arguments',
					'model must be a non-empty string.',
				);
			}
			try {
				const execution = await invoke(extra.signal, async signal => {
					const trust = await deps.resolveTrust(
						cwd,
						options.trustDirectory ?? false,
					);
					if (!trust.trusted) {
						return {
							kind: 'untrusted' as const,
							message: trust.message ?? untrustedDirectoryMessage(cwd, null),
						};
					}
					if (signal.aborted) return {kind: 'cancelled' as const};
					progress('Starting task');
					const result = await deps.runTask({
						prompt: args.prompt as string,
						cwd,
						mode,
						model:
							typeof args.model === 'string' ? args.model : options.cliModel,
						...(options.cliProvider ? {provider: options.cliProvider} : {}),
						signal,
						onProgress: progress,
					});
					return {kind: 'complete' as const, result};
				});
				if (execution.kind === 'untrusted') {
					return errorResult('untrusted_directory', execution.message);
				}
				if (execution.kind === 'cancelled') {
					return toolResult(canceledTaskResult(), true);
				}
				const result = execution.result;
				return toolResult(
					result,
					result.status === 'error' || result.status === 'cancelled',
				);
			} catch (error) {
				if (error instanceof McpOperationCancelled) {
					return toolResult(canceledTaskResult(), true);
				}
				return errorResult('task_failed', formatError(error));
			}
		}

		if (request.params.name === 'review_diff') {
			if (!hasOnlyKeys(args, ['request', 'cwd', 'tier', 'model'])) {
				return errorResult(
					'invalid_arguments',
					'review_diff received an unsupported argument.',
				);
			}
			const tier = args.tier === undefined ? 'grounded' : args.tier;
			if (!isReviewTier(tier)) {
				return errorResult(
					'invalid_tier',
					'tier must be grounded, deep, or quick.',
				);
			}
			if (args.request !== undefined && typeof args.request !== 'string') {
				return errorResult('invalid_arguments', 'request must be a string.');
			}
			if (
				args.model !== undefined &&
				(typeof args.model !== 'string' || !args.model.trim())
			) {
				return errorResult(
					'invalid_arguments',
					'model must be a non-empty string.',
				);
			}
			try {
				const execution = await invoke(extra.signal, async signal => {
					const trust = await deps.resolveTrust(
						cwd,
						options.trustDirectory ?? false,
					);
					if (!trust.trusted) {
						return {
							kind: 'untrusted' as const,
							message: trust.message ?? untrustedDirectoryMessage(cwd, null),
						};
					}
					if (signal.aborted) return {kind: 'cancelled' as const};
					progress('Starting review');
					const result = await deps.reviewDiff({
						...(typeof args.request === 'string' && args.request.trim()
							? {request: args.request.trim()}
							: {}),
						cwd,
						tier,
						model:
							typeof args.model === 'string' ? args.model : options.cliModel,
						...(options.cliProvider ? {provider: options.cliProvider} : {}),
						signal,
						onProgress: progress,
					});
					return {kind: 'complete' as const, result};
				});
				if (execution.kind === 'untrusted') {
					return errorResult('untrusted_directory', execution.message);
				}
				if (execution.kind === 'cancelled') {
					return toolResult(cancelledReviewResult(tier), true);
				}
				const result = execution.result;
				return toolResult(
					result,
					result.status === 'failed' || result.status === 'cancelled',
				);
			} catch (error) {
				if (error instanceof McpOperationCancelled) {
					return toolResult(cancelledReviewResult(tier), true);
				}
				return errorResult('review_failed', formatError(error));
			}
		}

		return errorResult(
			'unknown_tool',
			`Unknown Nanocoder MCP tool: ${request.params.name}`,
		);
	});

	return server;
}

function redirectStdoutWritesToStderr(): () => void {
	const originalWrite = process.stdout.write;
	const stderrWrite = process.stderr.write.bind(process.stderr);
	const redirect = ((
		chunk: string | Uint8Array,
		encoding?: BufferEncoding | ((error?: Error | null) => void),
		callback?: (error?: Error | null) => void,
	) => {
		if (typeof encoding === 'function') {
			return stderrWrite(chunk, encoding);
		}
		return stderrWrite(chunk, encoding, callback);
	}) as typeof process.stdout.write;
	process.stdout.write = redirect;
	return () => {
		process.stdout.write = originalWrite;
	};
}

/** Start the MCP server over stdio (or an injected transport in protocol tests). */
export async function runMcpServer(
	options: McpServerOptions = {},
	transportOverride?: Transport,
): Promise<void> {
	const server = createNanocoderMcpServer(options);
	const lifecycle = SERVER_LIFECYCLE.get(server);
	const protocolWrite = process.stdout.write.bind(process.stdout);
	const protocolStdout = new Writable({
		write(chunk, encoding, callback) {
			protocolWrite(chunk, encoding, callback);
		},
	});
	const transport =
		transportOverride ??
		new StdioServerTransport(process.stdin, protocolStdout);
	const restoreStdout = redirectStdoutWritesToStderr();
	const shutdown = getShutdownManager();
	const shutdownHandlerName = 'nanocoder-mcp-server';
	let resolveClosed: () => void = () => undefined;
	const closed = new Promise<void>(resolve => {
		resolveClosed = resolve;
	});
	const closeAndDrain = async () => {
		lifecycle?.abortActive();
		await lifecycle?.drain();
		await server.close().catch(() => undefined);
		resolveClosed();
	};
	const onSignal = () => lifecycle?.abortActive();
	const onInputEnd = () => {
		void closeAndDrain();
	};
	shutdown.register({
		name: shutdownHandlerName,
		priority: 10,
		handler: closeAndDrain,
	});
	transport.onclose = () => {
		lifecycle?.abortActive();
		void (lifecycle?.drain() ?? Promise.resolve()).finally(resolveClosed);
	};
	transport.onerror = error => {
		process.stderr.write(`[nanocoder mcp] ${formatError(error)}\n`);
	};
	process.on('SIGINT', onSignal);
	process.on('SIGTERM', onSignal);
	process.on('SIGHUP', onSignal);
	if (!transportOverride) {
		process.stdin.once('end', onInputEnd);
		process.stdin.once('close', onInputEnd);
	}
	try {
		await server.connect(transport);
		await closed;
	} finally {
		process.off('SIGINT', onSignal);
		process.off('SIGTERM', onSignal);
		process.off('SIGHUP', onSignal);
		process.stdin.off('end', onInputEnd);
		process.stdin.off('close', onInputEnd);
		shutdown.unregister(shutdownHandlerName);
		await server.close().catch(() => undefined);
		restoreStdout();
	}
}
