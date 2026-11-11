import path from 'node:path';
import type {
	Agent,
	AgentSideConnection,
	AuthenticateRequest,
	AuthenticateResponse,
	CancelNotification,
	ClientCapabilities,
	CloseSessionRequest,
	CloseSessionResponse,
	DeleteSessionRequest,
	DeleteSessionResponse,
	DidFocusDocumentNotification,
	InitializeRequest,
	InitializeResponse,
	ListProvidersRequest,
	ListProvidersResponse,
	ListSessionsRequest,
	ListSessionsResponse,
	LoadSessionRequest,
	LoadSessionResponse,
	McpServer,
	NewSessionRequest,
	NewSessionResponse,
	PromptRequest,
	PromptResponse,
	ResumeSessionRequest,
	ResumeSessionResponse,
	SessionConfigOption,
	SessionModeState,
	SetSessionConfigOptionRequest,
	SetSessionConfigOptionResponse,
	SetSessionModeRequest,
	SetSessionModeResponse,
} from '@agentclientprotocol/sdk';
import {RequestError} from '@agentclientprotocol/sdk';
import {getAlwaysAllowedTools} from '@/acp/acp-approval';
import {
	ACP_DISABLED_TOOLS_META,
	ACP_EXT_ALIASES,
	ACP_EXT_METHODS,
	ACP_EXT_PREFIX,
	ACP_SESSION_TITLE_NOTIFICATION,
	ACP_TRUST_REQUIRED_ERROR_CODE,
	acpMcpServersToConfig,
	acpModeToDevelopmentMode,
	developmentModeToAcpMode,
	getAgentCapabilities,
	getAvailableModes,
	isVsCodeClient,
	negotiateProtocolVersion,
	parseDisabledTools,
} from '@/acp/acp-capabilities';
import {acpContentToUserMessage} from '@/acp/acp-content';
import {
	clearAcpReadStubs,
	runAcpConversation,
	settleUnansweredToolCalls,
} from '@/acp/acp-conversation';
import {
	acpCustomCommandText,
	builtinCommandReply,
} from '@/acp/acp-custom-command';
import {AcpSession} from '@/acp/acp-session';
import {resolveTruncationPoint} from '@/acp/acp-timeline';
import type {AcpInitContext} from '@/acp/acp-types';
import {appendToolDefinitionsToPrompt} from '@/ai-sdk-client/tools/system-prompt-assembler';
import {artifactManager} from '@/artifacts/artifact-manager';
import {isInternalWalkthroughMessage} from '@/artifacts/walkthrough-lifecycle';
import {createLLMClient} from '@/client-factory';
import {getAppConfig} from '@/config/index';
import {
	getLastUsedModel,
	getProjectContextPreferences,
	loadPreferences,
	updateLastUsed,
} from '@/config/preferences';
import {
	ensureDirectoryTrust,
	untrustedReason,
} from '@/config/trust/directory-trust';
import {resolveTune} from '@/config/tune';
import {resolveStartupProvider} from '@/hooks/startup-provider';
import {appendRelevantProjectContextWithCount} from '@/memory/project-context';
import {withTrustedProjectPlugins} from '@/plugins/host';
import {type HookContext, runLifecycleHooks} from '@/services/lifecycle-hooks';
import {
	createSessionContext,
	runInSessionContext,
	runOutsideSessionContext,
	type SessionContext,
} from '@/services/session-context';
import {cancelSubagentRun} from '@/services/subagent-events';
import {TimelineManager} from '@/services/timeline-manager';
import {maybeGenerateTitle} from '@/session/maybe-generate-title';
import {sessionManager} from '@/session/session-manager';
import {
	ACTIVE_FILE_PREFIX,
	deriveTitleFromFirstMessage,
} from '@/session/title-generator';
import type {ToolManager} from '@/tools/tool-manager';
import {getTuneToolMode} from '@/types/config';
import type {LLMClient} from '@/types/core';
import {getLogger} from '@/utils/logging';
import {buildSystemPrompt, setLastBuiltPrompt} from '@/utils/prompt-builder';

const logger = getLogger();

// Stable id for the model selector config option (category `model`).
const MODEL_CONFIG_ID = 'model';

async function listSessionArtifacts(sessionId: string) {
	try {
		return await artifactManager.listArtifacts(sessionId);
	} catch (error) {
		if (
			error instanceof Error &&
			error.message.startsWith('Invalid session ID:')
		) {
			return [];
		}
		throw error;
	}
}

export class AcpAgent implements Agent {
	/**
	 * The in-flight background titling run. Exposed only so tests can await
	 * work that production deliberately fires and forgets - asserting on it
	 * with a fixed sleep goes flaky the moment CI is loaded.
	 */
	private pendingTitleGeneration: Promise<void> = Promise.resolve();

	private sessions = new Map<string, AcpSession>();
	private initContext: AcpInitContext;
	private conn: AgentSideConnection;
	private appVersion: string;
	private clientCapabilities?: ClientCapabilities;
	private clientInfo?: InitializeRequest['clientInfo'];
	/** Bare extension method names already reported as deprecated. */
	private warnedExtAliases = new Set<string>();
	/**
	 * Tools of the sessions that brought MCP servers of their own. Every other
	 * session uses the shared set in `initContext`.
	 */
	private sessionToolManagers = new Map<string, ToolManager>();

	constructor(
		initContext: AcpInitContext,
		conn: AgentSideConnection,
		appVersion = '0.0.0',
	) {
		this.initContext = initContext;
		this.conn = conn;
		this.appVersion = appVersion;
	}

	async initialize(params: InitializeRequest): Promise<InitializeResponse> {
		logger.info(`ACP initialize: protocolVersion=${params.protocolVersion}`);

		// Client capabilities arrive here and nowhere else; retain them so each
		// session knows whether it may use client-side fs reads (e.g. for
		// `@`-mentioned files that carry their live editor buffer).
		this.clientCapabilities = params.clientCapabilities;
		// Which client this is decides how built-in slash commands are worded.
		this.clientInfo = params.clientInfo;

		return {
			protocolVersion: negotiateProtocolVersion(params.protocolVersion),
			agentCapabilities: getAgentCapabilities(),
			agentInfo: {
				name: 'nanocoder',
				title: 'Nanocoder',
				version: this.appVersion,
			},
			authMethods: [],
			_meta: {'nanocoder/retention': sessionManager.getRetention()},
		};
	}

	// Every request that acts on one session runs inside that session's context,
	// so the config it reads (getAppConfig and the loaders behind it) is its own
	// folder's, not the folder the agent was started in.
	async newSession(params: NewSessionRequest): Promise<NewSessionResponse> {
		this.assertDirectoryTrusted(params.cwd);
		const context = createSessionContext(params.cwd);
		return runInSessionContext(context, () =>
			this.openNewSession(params, context),
		);
	}

	private async openNewSession(
		params: NewSessionRequest,
		context: SessionContext,
	): Promise<NewSessionResponse> {
		const sessionId = crypto.randomUUID();
		logger.info(`ACP newSession: ${sessionId} cwd=${params.cwd}`);

		const session = this.registerSession(
			sessionId,
			params.cwd,
			parseDisabledTools(params._meta),
			context,
		);
		await this.startOnFolderDefault(session);
		await this.applyMcpServers(session, params.mcpServers);

		await sessionManager.initialize();
		await this.saveAcpSessionToDisk(session);

		// Emit available slash commands
		const availableCommands = (
			this.initContext.customCommandLoader?.getAllCommands() || []
		).map(c => ({
			name: `/${c.fullName}`,
			description: c.metadata.description || '',
		}));
		this.conn.sessionUpdate({
			sessionId,
			update: {
				sessionUpdate: 'available_commands_update',
				availableCommands,
			},
		});

		return {
			sessionId,
			_meta: {
				...(await this.buildApprovalMeta(session)),
				...this.buildDisabledToolsMeta(session),
			},
			modes: this.buildModeState(session),
			configOptions: await this.buildConfigOptions(session),
		};
	}

	async loadSession(params: LoadSessionRequest): Promise<LoadSessionResponse> {
		const existing = this.sessions.get(params.sessionId);
		const context = existing?.context ?? createSessionContext(params.cwd);
		return runInSessionContext(context, () =>
			this.openLoadedSession(params, existing, context),
		);
	}

	private async openLoadedSession(
		params: LoadSessionRequest,
		existing: AcpSession | undefined,
		context: SessionContext,
	): Promise<LoadSessionResponse> {
		let session = existing;
		let modelFallback: Awaited<ReturnType<typeof this.restoreSavedModel>>;

		if (!session) {
			// Try loading from disk first so history persists across process restarts.
			await sessionManager.initialize();
			const persisted = await sessionManager.loadSession(params.sessionId);
			if (!persisted) {
				// Same error as resumeSession so clients can tell a missing session apart.
				throw new Error(`Session not found on disk: ${params.sessionId}`);
			}
			this.assertDirectoryTrusted(params.cwd);
			session = this.registerSession(
				params.sessionId,
				params.cwd,
				parseDisabledTools(params._meta),
				context,
			);
			await this.startOnFolderDefault(session);
			clearAcpReadStubs(params.sessionId);
			session.messages = persisted.messages;
			modelFallback = await this.restoreSavedModel(session, persisted);
		} else {
			// The client sends the list on every load, so a live session takes the new one.
			session.disabledTools = parseDisabledTools(params._meta);
			this.buildSystemPromptForSession(session);
		}

		logger.info(
			`ACP loadSession: ${params.sessionId} cwd=${params.cwd} restored=${Boolean(existing)}`,
		);
		await this.applyMcpServers(session, params.mcpServers);

		// Replay history so the client can rebuild the thread.
		await this.replaySessionHistory(session);

		return {
			_meta: {
				...(await this.buildApprovalMeta(session)),
				...this.buildDisabledToolsMeta(session),
				'nanocoder/artifacts': await listSessionArtifacts(params.sessionId),
				...(modelFallback ? {'nanocoder/modelFallback': modelFallback} : {}),
			},
			modes: this.buildModeState(session),
			configOptions: await this.buildConfigOptions(session),
		};
	}

	async prompt(params: PromptRequest): Promise<PromptResponse> {
		const session = this.sessions.get(params.sessionId);
		if (!session) {
			throw new Error(`Session not found: ${params.sessionId}`);
		}
		return runInSessionContext(session.context, () =>
			this.runPrompt(params, session),
		);
	}

	private async runPrompt(
		params: PromptRequest,
		session: AcpSession,
	): Promise<PromptResponse> {
		// Wait for any in-flight turn. Rejecting overlap made the VS Code
		// webview toast `RequestError: Internal error` whenever a follow-up
		// was submitted mid-turn. Acquire before the first await so two
		// concurrent calls cannot both pass an idle check.
		const ticket = session.acquireTurn();
		if (ticket.immediate) {
			session.beginTurn();
		}
		await ticket.ready;
		if (!ticket.immediate) {
			session.beginTurn();
		}

		// A prompt queued behind a turn that session/close cancelled must not
		// start once the lock frees up: the client has already let go of it.
		if (session.closed) {
			session.releaseTurn();
			return {stopReason: 'cancelled'};
		}

		// Both the cancel early-return below and the rethrow after it still run
		// the finally, so a clean turn has to be tracked explicitly rather than
		// inferred from getting there.
		let turnSucceeded = false;
		const turnStart = Date.now();

		try {
			// A model picked during the previous turn applies from this one.
			if (session.promptStale) {
				session.promptStale = false;
				this.buildSystemPromptForSession(session);
			}

			const {
				text: userText,
				typedText,
				sections,
				images,
			} = await acpContentToUserMessage(params.prompt, {
				conn: this.conn,
				sessionId: params.sessionId,
				canReadTextFile: this.clientCapabilities?.fs?.readTextFile ?? false,
			});
			logger.info(
				`ACP prompt: session=${params.sessionId} text=${userText.slice(0, 100)} images=${images.length}`,
			);

			// Prepend active workspace context (e.g. the file focused in VS Code) so
			// the model always knows what the user is looking at.
			let contextualUserText = userText;

			// Slash command interception
			const trimmedUserText = userText.trim();
			if (trimmedUserText.startsWith('/')) {
				const commandName = trimmedUserText.split(/\s+/)[0].substring(1);

				// If the 'command name' contains a slash, it's likely a file path (e.g. /home/user/file.ts)
				// not a slash command. Skip command interception.
				if (!commandName.includes('/')) {
					const command =
						this.initContext.customCommandLoader?.getCommand(commandName);

					if (command) {
						contextualUserText = acpCustomCommandText(
							typedText,
							command,
							sections,
						);
					} else {
						// Check for built-in commands that have special ACP handling
						const sendBuiltinReply = (msg: string) => {
							session.messages = [
								...session.messages,
								{
									role: 'user',
									content: contextualUserText,
									displayOnly: true,
								},
								{role: 'assistant', content: msg, displayOnly: true},
							];
							this.conn.sessionUpdate({
								sessionId: params.sessionId,
								update: {
									sessionUpdate: 'agent_message_chunk',
									content: {type: 'text', text: msg},
								},
							});
							return {stopReason: 'end_turn' as const};
						};

						if (commandName === 'clear') {
							// Clear the conversation history and action timeline
							session.messages = [];
							clearAcpReadStubs(params.sessionId);
							await session.timeline.clear();
							const msg = 'Conversation cleared.';
							this.conn.sessionUpdate({
								sessionId: params.sessionId,
								update: {
									sessionUpdate: 'agent_message_chunk',
									content: {type: 'text', text: msg},
								},
							});
							return {stopReason: 'end_turn'};
						}

						const reply = builtinCommandReply(
							commandName,
							isVsCodeClient(this.clientInfo),
							this.initContext.customCommandLoader?.getAllCommands() ?? [],
						);
						if (reply) {
							return sendBuiltinReply(reply);
						}

						// Truly unrecognized command
						const errorMsg = `Unrecognized slash command: \`/${commandName}\`. Type \`/help\` to see available commands.`;
						return sendBuiltinReply(errorMsg);
					}
				}
			}

			// user-prompt-submit gates what goes to the model as the user's own
			// words, as in the TUI: a custom slash command is left alone.
			const isCommand =
				trimmedUserText.startsWith('/') &&
				!trimmedUserText.split(/\s+/)[0].substring(1).includes('/');
			if (!isCommand) {
				const gate = await this.runSessionHooks(session, 'user-prompt-submit', {
					prompt: userText,
				});
				if (gate.blocked) {
					const reason = gate.reason ?? 'Prompt blocked by a hook.';
					// Neither the prompt nor the reason ever reaches the model.
					session.messages = [
						...session.messages,
						{role: 'user', content: userText, displayOnly: true},
						{role: 'assistant', content: reason, displayOnly: true},
					];
					this.conn.sessionUpdate({
						sessionId: params.sessionId,
						update: {
							sessionUpdate: 'agent_message_chunk',
							content: {type: 'text', text: reason},
						},
					});
					return {stopReason: 'refusal'};
				}
				// Whatever session-start left for this session, plus this hook's
				// own stdout.
				const startOutput = session.startHookOutput
					? await session.startHookOutput
					: '';
				session.startHookOutput = null;
				const hookContext = [startOutput, gate.output]
					.filter(Boolean)
					.join('\n\n');
				if (hookContext) {
					contextualUserText = `<hook-context>\n${hookContext}\n</hook-context>\n\n${contextualUserText}`;
				}
			}

			if (session.activeFile) {
				contextualUserText = `[Active file: ${session.activeFile}]\n\n${contextualUserText}`;
			}

			const previousAssistant = findLastAssistantMessage(session);
			session.messages = [
				...session.messages,
				{
					role: 'user',
					content: contextualUserText,
					...(images.length > 0 ? {images} : {}),
				},
			];

			if (session.baseSystemMessage) {
				const projectContext = await appendRelevantProjectContextWithCount(
					session.baseSystemMessage.content,
					userText,
					session.getMemoryFinder(),
					getProjectContextPreferences(),
				);
				session.systemMessage = {
					role: 'system',
					content: projectContext.systemPrompt,
				};
				setLastBuiltPrompt(projectContext.systemPrompt);
				if (projectContext.memoryCount > 0) {
					logger.info(
						`ACP recall: session=${params.sessionId} count=${projectContext.memoryCount}`,
					);
				}
			}

			const config = getAppConfig();
			const nonInteractiveAlwaysAllow = config.alwaysAllow ?? [];

			// The model is offered the tools its calls will run against.
			const sessionTools = this.sessionToolManagers.get(session.sessionId);
			const response = await runAcpConversation({
				session,
				client: this.clientFor(session),
				toolManager: sessionTools ?? this.initContext.toolManager,
				sessionTools,
				conn: this.conn,
				nonInteractiveAlwaysAllow,
			});
			const turnDurationMs = Date.now() - turnStart;
			this.attachResponseUsage(
				session,
				response,
				previousAssistant,
				turnDurationMs,
			);
			// A turn cancelled part way through returns rather than throws. It is
			// still not a clean turn, so it must not be titled from.
			turnSucceeded = response.stopReason !== 'cancelled';
			return response;
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);
			// The turn keeps what it already did; only a batch it was part way
			// through needs closing off.
			session.messages = settleUnansweredToolCalls(session.messages);

			// A user-initiated cancellation isn't a failure: surface it inline in
			// the chat and resolve cleanly instead of rejecting the ACP `prompt`
			// call, otherwise the VS Code client's catch handler shows a
			// "RequestError: Internal error" toast on top of the cancel notice.
			//
			// Told by the turn's own signal, which session/cancel and close
			// abort, not by the error's wording: whatever threw once the user
			// stopped the turn (a tool, compaction, a dropped client write) is
			// the cancellation, and a timeout that happens to say "cancelled"
			// is not.
			if (session.abortController.signal.aborted) {
				const cancelNotice = '\n\n_Cancelled by user._\n';
				this.conn.sessionUpdate({
					sessionId: params.sessionId,
					update: {
						sessionUpdate: 'agent_message_chunk',
						content: {type: 'text', text: cancelNotice},
					},
				});
				session.messages.push({
					role: 'assistant',
					content: cancelNotice,
					displayOnly: true,
					durationMs: Date.now() - turnStart,
					outcome: 'cancelled',
				});
				return {stopReason: 'cancelled'};
			}

			logger.error(`Error during ACP prompt: ${errorMsg}`);

			// Relay the error to the chat UI so the user sees it inline
			const formattedError = `\n\n**Error:** ${errorMsg}\n`;

			this.conn.sessionUpdate({
				sessionId: params.sessionId,
				update: {
					sessionUpdate: 'agent_message_chunk',
					content: {type: 'text', text: formattedError},
				},
			});

			session.messages.push({
				role: 'assistant',
				content: formattedError,
				displayOnly: true,
				durationMs: Date.now() - turnStart,
				outcome: 'failed',
			});

			throw error;
		} finally {
			await this.saveAcpSessionToDisk(session).catch(err => {
				logger.error(`Failed to save ACP session ${session.sessionId}: ${err}`);
			});

			// Fire and forget: the turn must return to idle immediately, and a
			// cosmetic title landing a moment later is fine. The promise is kept
			// only so tests can await it instead of sleeping; nothing in
			// production reads it.
			if (turnSucceeded) {
				this.pendingTitleGeneration = maybeGenerateTitle({
					sessionId: session.sessionId,
					messages: session.messages,
					client: this.clientFor(session),
					onTitle: title => {
						// notify(), not the deprecated extNotification() alias.
						// The client receives it as extNotification(method, params).
						// Lands after the turn went idle, so the client may already be
						// gone; an unhandled rejection here would kill the agent.
						void this.conn
							.notify(ACP_SESSION_TITLE_NOTIFICATION, {
								sessionId: session.sessionId,
								title,
							})
							.catch(() => {});
					},
				}).catch(() => {});
			}
			session.releaseTurn();
		}
	}

	async cancel(params: CancelNotification): Promise<void> {
		const session = this.sessions.get(params.sessionId);
		if (session) {
			logger.info(`ACP cancel: session=${params.sessionId}`);
			session.cancel();
		}
	}

	/**
	 * Cancels any in-flight turn and frees the session's in-memory state. The
	 * session stays on disk, so the client can load or resume it later.
	 */
	async closeSession(
		params: CloseSessionRequest,
	): Promise<CloseSessionResponse> {
		logger.info(`ACP closeSession: session=${params.sessionId}`);
		await this.evictSession(params.sessionId, async session => {
			await session.timeline.dispose();
		});
		return {};
	}

	/**
	 * Takes a live session out of service: cancels its turn, drops it from the
	 * map, and waits for the turn (and any prompts queued behind it, which bail
	 * out on `closed`) to give up the turn lock. `whileIdle` then runs with the
	 * lock held, followed by releasing the session's MCP servers, which the
	 * turn may still have been calling.
	 *
	 * Every path that retires a session goes through here. A turn left running
	 * would save the session to disk from its finally after a delete, bringing
	 * it back, or keep writing checkpoints after its timeline lock is gone.
	 * Returns false when no live session had this id.
	 */
	private async evictSession(
		sessionId: string,
		whileIdle: (session: AcpSession) => Promise<void>,
	): Promise<boolean> {
		const session = this.sessions.get(sessionId);
		if (!session) {
			return false;
		}
		session.close();
		this.sessions.delete(sessionId);
		clearAcpReadStubs(sessionId);
		const ticket = session.acquireTurn();
		await ticket.ready;
		try {
			await whileIdle(session);
			await this.releaseMcpServers(sessionId);
		} finally {
			session.releaseTurn();
		}
		// Close, delete and a resume that replaces the live copy all end it.
		await this.endSession(session);
		return true;
	}

	/**
	 * Runs `session-end` for every session still open, for a shutdown. The
	 * hooks of each are bounded by their own short default timeout, and run
	 * side by side so a few open chats still fit the shutdown budget.
	 */
	async endAllSessions(): Promise<void> {
		const open = [...this.sessions.values()];
		this.sessions.clear();
		await Promise.all(open.map(session => this.endSession(session)));
	}

	/** Runs `session-end` for a session that is going away. Never throws. */
	private async endSession(session: AcpSession): Promise<void> {
		await this.runSessionHooks(session, 'session-end').catch(error => {
			logger.warn(
				`ACP session ${session.sessionId}: session-end hooks failed: ${String(error)}`,
			);
		});
	}

	/**
	 * Lifecycle hooks for one session run where its turns run: in its working
	 * directory, with its project's trusted plugins.
	 */
	private runSessionHooks(
		session: AcpSession,
		event: 'session-start' | 'user-prompt-submit' | 'session-end',
		context: HookContext = {},
	) {
		return runInSessionContext(session.context, () =>
			withTrustedProjectPlugins(session.cwd, () =>
				runLifecycleHooks(event, context),
			),
		);
	}

	async setSessionMode(
		params: SetSessionModeRequest,
	): Promise<SetSessionModeResponse> {
		const session = this.sessions.get(params.sessionId);
		if (!session) {
			throw new Error(`Session not found: ${params.sessionId}`);
		}
		return runInSessionContext(session.context, () =>
			this.applySessionMode(params, session),
		);
	}

	private async applySessionMode(
		params: SetSessionModeRequest,
		session: AcpSession,
	): Promise<SetSessionModeResponse> {
		session.developmentMode = acpModeToDevelopmentMode(params.modeId);
		logger.info(
			`ACP setSessionMode: session=${params.sessionId} mode=${params.modeId}`,
		);

		// Rebuild system prompt for the new mode
		this.buildSystemPromptForSession(session);

		await this.conn.sessionUpdate({
			sessionId: params.sessionId,
			update: {
				sessionUpdate: 'current_mode_update',
				currentModeId: params.modeId,
			},
		});

		return {};
	}

	async setSessionConfigOption(
		params: SetSessionConfigOptionRequest,
	): Promise<SetSessionConfigOptionResponse> {
		const session = this.sessions.get(params.sessionId);
		if (!session) {
			throw new Error(`Session not found: ${params.sessionId}`);
		}
		return runInSessionContext(session.context, () =>
			this.applySessionConfigOption(params, session),
		);
	}

	private async applySessionConfigOption(
		params: SetSessionConfigOptionRequest,
		session: AcpSession,
	): Promise<SetSessionConfigOptionResponse> {
		if (params.configId === 'provider') {
			const providerId = params.value;
			if (typeof providerId !== 'string') {
				throw new Error(`Invalid provider value: ${String(providerId)}`);
			}
			const config = getAppConfig();
			const validProviders = (config.providers ?? []).map(p => p.name);
			if (!validProviders.includes(providerId)) {
				throw new Error(`Unknown provider: ${providerId}`);
			}

			const {client: newClient} = await createLLMClient(
				providerId,
				undefined,
				undefined,
				{strictProvider: true},
			);

			// Keep the session's model when the new provider has it.
			let model = session.model;
			const availableModels = await newClient.getAvailableModels();
			if (availableModels.includes(model)) {
				newClient.setModel(model);
			} else if (availableModels.length > 0) {
				model = availableModels[0];
				newClient.setModel(model);
			} else {
				// A provider may list no models. The previous provider's model means
				// nothing there, so the session takes the model the new client has
				// (none, for such a provider) rather than keep a pair that was never
				// valid.
				model = newClient.getCurrentModel();
			}
			this.selectModel(session, providerId, model, newClient);

			logger.info(
				`ACP setSessionConfigOption: session=${params.sessionId} configId=${params.configId} value=${providerId}`,
			);
			return {configOptions: await this.buildConfigOptions(session)};
		}

		if (params.configId !== MODEL_CONFIG_ID) {
			throw new Error(`Unknown config option: ${params.configId}`);
		}

		// The model selector is a string-valued select; reject the boolean shape
		// the request union also permits.
		const modelId = params.value;
		if (typeof modelId !== 'string') {
			throw new Error(`Invalid model value: ${String(modelId)}`);
		}

		const available = await this.clientFor(session).getAvailableModels();
		if (!available.includes(modelId)) {
			throw new Error(`Unknown model: ${modelId}`);
		}

		// A client is never re-pointed: another session may still be on it, or
		// in the middle of a turn that started with it.
		const {client} = await createLLMClient(
			session.provider,
			undefined,
			undefined,
			{strictProvider: true},
		);
		client.setModel(modelId);
		this.selectModel(session, session.provider, modelId, client);
		logger.info(
			`ACP setSessionConfigOption: session=${params.sessionId} configId=${params.configId} value=${modelId}`,
		);

		return {configOptions: await this.buildConfigOptions(session)};
	}

	/**
	 * Moves one session to a provider, model and client of its own. The choice
	 * also becomes what sessions created from now on start with, and the user's
	 * last-used selection. Auto-commit in this session writes its messages with
	 * the session's client, which each turn passes to its tool calls, so it no
	 * longer follows whichever session picked a model last.
	 */
	private selectModel(
		session: AcpSession,
		provider: string,
		model: string,
		client: LLMClient,
	): void {
		session.provider = provider;
		session.model = model;
		session.client = client;
		this.initContext.provider = provider;
		this.initContext.model = model;
		this.initContext.client = client;
		// A provider with no model is not a selection worth remembering.
		if (model) {
			updateLastUsed(provider, model);
		}

		// A running turn keeps the prompt and client it started with.
		if (session.turnActive) {
			session.promptStale = true;
		} else {
			this.buildSystemPromptForSession(session);
		}
	}

	private clientFor(session: AcpSession): LLMClient {
		return session.client ?? this.initContext.client;
	}

	/**
	 * Puts a resumed session back on the provider and model it was saved with.
	 * Returns the saved choice when it can no longer be used, so the response
	 * can say the session stayed on the process default.
	 */
	private async restoreSavedModel(
		session: AcpSession,
		saved: {provider: string; model: string},
	): Promise<{provider: string; model: string} | undefined> {
		if (saved.provider === session.provider && saved.model === session.model) {
			return undefined;
		}
		// Saved with no model to name (a provider that lists none): nothing to
		// go back to, so the session stays on the default without a fallback.
		if (!saved.provider || !saved.model) {
			return undefined;
		}
		try {
			const {client} = await createLLMClient(
				saved.provider,
				undefined,
				undefined,
				{strictProvider: true},
			);
			if (!(await client.getAvailableModels()).includes(saved.model)) {
				throw new Error(`model ${saved.model} is not available`);
			}
			client.setModel(saved.model);
			session.provider = saved.provider;
			session.model = saved.model;
			session.client = client;
			this.buildSystemPromptForSession(session);
			return undefined;
		} catch (error) {
			logger.warn(
				`ACP session ${session.sessionId} stays on ${session.provider}/${session.model}: saved ${saved.provider}/${saved.model} is unavailable (${error instanceof Error ? error.message : String(error)})`,
			);
			return {provider: saved.provider, model: saved.model};
		}
	}

	async listSessions(
		params: ListSessionsRequest,
	): Promise<ListSessionsResponse> {
		await sessionManager.initialize();
		const sessions = await sessionManager.listSessions(
			params.cwd ? {workingDirectory: params.cwd} : undefined,
		);
		logger.info(`ACP listSessions: found=${sessions.length}`);
		return {
			sessions: sessions.map(s => ({
				sessionId: s.id,
				cwd: s.workingDirectory,
				title: s.title,
				updatedAt: s.lastAccessedAt,
				_meta: {'nanocoder/pinned': s.pinned === true},
			})),
		};
	}

	async deleteSession(
		params: DeleteSessionRequest,
	): Promise<DeleteSessionResponse> {
		await sessionManager.initialize();
		// The turn's own save to disk lands before the delete below, not after.
		const evicted = await this.evictSession(params.sessionId, async session => {
			await session.timeline.clear();
		});
		if (!evicted) {
			const persisted = await sessionManager.loadSession(params.sessionId);
			if (persisted) {
				await new TimelineManager(
					persisted.workingDirectory,
					params.sessionId,
				).clear();
			}
			clearAcpReadStubs(params.sessionId);
			await this.releaseMcpServers(params.sessionId);
		}
		await sessionManager.deleteSession(params.sessionId);
		logger.info(`ACP deleteSession: ${params.sessionId}`);
		return {};
	}

	async resumeSession(
		params: ResumeSessionRequest,
	): Promise<ResumeSessionResponse> {
		await sessionManager.initialize();
		const saved = await sessionManager.loadSession(params.sessionId);
		// A session is written to disk once it has something to keep, so one
		// resumed straight after session/new exists only in memory.
		const live = this.sessions.get(params.sessionId);
		const workingDirectory = saved?.workingDirectory ?? live?.cwd;
		if (workingDirectory === undefined) {
			throw new Error(`Session not found on disk: ${params.sessionId}`);
		}
		// Refused before anything is retired: a live copy keeps running.
		this.assertDirectoryTrusted(workingDirectory);
		const context = createSessionContext(workingDirectory);
		return runInSessionContext(context, () =>
			this.reopenSession(params, context, live),
		);
	}

	private async reopenSession(
		params: ResumeSessionRequest,
		context: SessionContext,
		live: AcpSession | undefined,
	): Promise<ResumeSessionResponse> {
		// Retire any live copy first, so one id never has two sessions running,
		// and read the history after its turn has saved its last messages.
		const evicted = await this.evictSession(params.sessionId, async session => {
			await session.timeline.dispose();
		});
		if (!evicted) {
			await this.releaseMcpServers(params.sessionId);
		}
		// Its turn saves on the way out, so the disk is read after the eviction.
		// Still nothing there: the live copy had nothing worth saving, and is
		// resumed as it was.
		const persisted =
			(await sessionManager.loadSession(params.sessionId)) ??
			(live && {
				workingDirectory: live.cwd,
				messages: live.messages,
				...this.savedModelOf(live),
			});
		if (!persisted) {
			throw new Error(`Session not found on disk: ${params.sessionId}`);
		}
		const session = this.registerSession(
			params.sessionId,
			persisted.workingDirectory,
			parseDisabledTools(params._meta),
			context,
		);
		await this.startOnFolderDefault(session);
		await this.applyMcpServers(session, params.mcpServers);
		session.messages = persisted.messages;
		clearAcpReadStubs(params.sessionId);
		const modelFallback = await this.restoreSavedModel(session, persisted);
		logger.info(
			`ACP resumeSession: ${params.sessionId} messages=${persisted.messages.length}`,
		);

		// Replay history so the client rebuilds the thread view.
		await this.replaySessionHistory(session);

		return {
			_meta: {
				...(await this.buildApprovalMeta(session)),
				...this.buildDisabledToolsMeta(session),
				'nanocoder/artifacts': await listSessionArtifacts(params.sessionId),
				...(modelFallback ? {'nanocoder/modelFallback': modelFallback} : {}),
			},
			modes: this.buildModeState(session),
			configOptions: await this.buildConfigOptions(session),
		};
	}

	/**
	 * ACP's core methods don't include a way for the client to rename a
	 * session (title is otherwise agent-driven, from the latest message).
	 * `extMethod` is the protocol's sanctioned escape hatch for exactly this.
	 *
	 * Methods are named `_nanocoder/<name>`. The bare `<name>` still works as a
	 * deprecated alias; anything else is "Method not found" so a client can
	 * tell an unsupported method from a failed one.
	 */
	async extMethod(
		requested: string,
		params: Record<string, unknown>,
	): Promise<Record<string, unknown>> {
		const method = requested.startsWith(ACP_EXT_PREFIX)
			? requested.slice(ACP_EXT_PREFIX.length)
			: requested;
		const known = method === requested ? ACP_EXT_ALIASES : ACP_EXT_METHODS;
		if (!(known as readonly string[]).includes(method)) {
			throw RequestError.methodNotFound(requested);
		}
		if (method === requested && !this.warnedExtAliases.has(method)) {
			this.warnedExtAliases.add(method);
			logger.warn(
				`ACP extMethod "${method}" is deprecated; use "${ACP_EXT_PREFIX}${method}"`,
			);
		}

		if (method === 'renameSession') {
			const sessionId = params.sessionId;
			const title = params.title;
			if (typeof sessionId !== 'string' || typeof title !== 'string') {
				throw new Error(
					'renameSession requires string sessionId and title params',
				);
			}

			await sessionManager.initialize();
			const updated = await sessionManager.renameSession(sessionId, title);
			if (!updated) {
				throw new Error(`Session not found on disk: ${sessionId}`);
			}
			logger.info(`ACP extMethod renameSession: ${sessionId} -> "${title}"`);
			return {title: updated.title};
		}

		if (method === 'pinSession') {
			const sessionId = params.sessionId;
			const pinned = params.pinned;
			if (typeof sessionId !== 'string' || typeof pinned !== 'boolean') {
				throw new Error(
					'pinSession requires a string sessionId and a boolean pinned',
				);
			}

			await sessionManager.initialize();
			if (!(await sessionManager.setPinned(sessionId, pinned))) {
				throw new Error(`Session not found on disk: ${sessionId}`);
			}
			logger.info(`ACP extMethod pinSession: ${sessionId} pinned=${pinned}`);
			return {pinned};
		}

		if (method === 'timeline/list') {
			const sessionId = params.sessionId;
			if (typeof sessionId !== 'string') {
				throw new Error('timeline/list requires a string sessionId');
			}
			const session = this.requireSession(sessionId);
			return {entries: await session.timeline.list()};
		}

		if (method === 'timeline/read') {
			const {sessionId, checkpointId, path} = params;
			if (
				typeof sessionId !== 'string' ||
				typeof checkpointId !== 'string' ||
				typeof path !== 'string'
			) {
				throw new Error(
					'timeline/read requires string sessionId, checkpointId and path',
				);
			}
			const session = this.requireSession(sessionId);
			return {...(await session.timeline.readBefore(checkpointId, path))};
		}

		if (method === 'timeline/revert') {
			const sessionId = params.sessionId;
			const checkpointId = params.checkpointId;
			if (typeof sessionId !== 'string' || typeof checkpointId !== 'string') {
				throw new Error(
					'timeline/revert requires string sessionId and checkpointId',
				);
			}
			const session = this.requireSession(sessionId);
			if (session.turnActive) {
				throw new Error(
					'Cannot revert the timeline while a prompt is in progress',
				);
			}

			const result = await session.timeline.revertTo(checkpointId);
			session.messages = session.messages.slice(
				0,
				resolveTruncationPoint(session.messages, result.revertedTo),
			);
			clearAcpReadStubs(sessionId);
			// Harness chrome, not model output: it tells the user what the revert
			// did. The model learns about the revert from the truncated history
			// itself, so this must never come back as its own past turn.
			session.messages.push({
				role: 'assistant',
				content: `Reverted to before step ${result.revertedTo.seq} (${result.revertedTo.toolName}). How should we proceed instead?`,
				displayOnly: true,
			});
			await this.saveAcpSessionToDisk(session);
			await this.replaySessionHistory(session);
			logger.info(
				`ACP extMethod timeline/revert: session=${sessionId} checkpoint=${checkpointId}`,
			);
			return {
				revertedTo: result.revertedTo,
				filesRestored: result.filesRestored,
			};
		}

		if (method === 'cancelSubagent') {
			const sessionId = params.sessionId;
			const childRunId = params.childRunId;
			if (typeof sessionId !== 'string' || typeof childRunId !== 'string') {
				throw new Error(
					'cancelSubagent requires string sessionId and childRunId',
				);
			}
			this.requireSession(sessionId);
			// False, not an error, when the run already ended: that race is normal.
			return {cancelled: cancelSubagentRun(sessionId, childRunId)};
		}

		if (method === 'retryTurn') {
			const sessionId = params.sessionId;
			if (typeof sessionId !== 'string') {
				throw new Error('retryTurn requires string sessionId');
			}
			const session = this.requireSession(sessionId);
			if (session.turnActive) {
				throw new Error('Cannot retry turn while a prompt is in progress');
			}
			const promptText =
				typeof params.promptText === 'string'
					? params.promptText.trim()
					: undefined;
			let targetUserIdx = -1;
			if (promptText) {
				for (let i = session.messages.length - 1; i >= 0; i--) {
					const m = session.messages[i];
					if (m.role !== 'user') continue;
					const contentStr =
						typeof m.content === 'string' ? m.content.trim() : '';
					if (contentStr === promptText) {
						targetUserIdx = i;
						break;
					}
				}
			}
			if (targetUserIdx < 0) {
				for (let i = session.messages.length - 1; i >= 0; i--) {
					if (session.messages[i].role === 'user') {
						targetUserIdx = i;
						break;
					}
				}
			}
			if (targetUserIdx >= 0) {
				session.messages = session.messages.slice(0, targetUserIdx);
				clearAcpReadStubs(sessionId);
				await this.saveAcpSessionToDisk(session);
				await session.timeline.truncateAfter(targetUserIdx);
			}
			logger.info(
				`ACP extMethod retryTurn: session=${sessionId} truncatedTo=${session.messages.length}`,
			);
			return {ok: true, messagesCount: session.messages.length};
		}

		throw RequestError.methodNotFound(requested);
	}

	async unstable_listProviders(
		_params: ListProvidersRequest,
	): Promise<ListProvidersResponse> {
		const config = getAppConfig();
		const providers = (config.providers ?? []).map(p => ({
			id: p.name,
			providerId: p.name,
			required: false,
			supported: ['openai' as const],
		}));
		return {providers};
	}

	async unstable_didFocusDocument(
		params: DidFocusDocumentNotification,
	): Promise<void> {
		const session = this.sessions.get(params.sessionId);
		if (!session) return;
		session.activeFile = params.uri;
		logger.info(
			`ACP didFocusDocument: session=${params.sessionId} uri=${params.uri}`,
		);
	}

	async authenticate(
		_params: AuthenticateRequest,
	): Promise<AuthenticateResponse> {
		return {};
	}

	/**
	 * A session's tools, bash and AGENTS.md all come from its own `cwd`, and
	 * its project plugins load from there. The server checked only the folder
	 * it was started in, so any other folder must be trusted on its own.
	 */
	private assertDirectoryTrusted(cwd: string): void {
		const {launchDirectory} = this.initContext;
		if (launchDirectory === undefined) return;
		const resolved = path.resolve(cwd);
		if (resolved === path.resolve(launchDirectory)) return;
		const trust = ensureDirectoryTrust(resolved, false);
		if (trust.trusted) return;
		const status =
			trust.recheck === 'changed'
				? 'changed'
				: trust.recheck === 'upgrade'
					? 'needs-re-approval'
					: 'not-trusted';
		logger.warn(`ACP session refused: ${resolved} is ${status}`);
		throw new RequestError(
			ACP_TRUST_REQUIRED_ERROR_CODE,
			`Directory ${resolved} ${untrustedReason(trust.recheck)}. Trust it by running nanocoder there once, or with "nanocoder trust --status" and "nanocoder trust --grant <fingerprint>" in that folder.`,
			{'nanocoder/trustRequired': {cwd: resolved, status}},
		);
	}

	private requireSession(sessionId: string): AcpSession {
		const session = this.sessions.get(sessionId);
		if (!session) {
			throw new Error(`Session not found: ${sessionId}`);
		}
		return session;
	}

	private toolManagerFor(sessionId: string): ToolManager {
		return (
			this.sessionToolManagers.get(sessionId) ?? this.initContext.toolManager
		);
	}

	/**
	 * Connect the MCP servers a client sent for this session, in place of any it
	 * had before. Their tools exist in this session only. A server that fails to
	 * connect is logged and skipped; the request still succeeds.
	 */
	private async applyMcpServers(
		session: AcpSession,
		requested: McpServer[] | undefined,
	): Promise<void> {
		const {servers, skipped} = acpMcpServersToConfig(requested);
		if (skipped.length > 0) {
			logger.warn(
				`ACP session ${session.sessionId}: unsupported MCP servers skipped: ${skipped.join(', ')}`,
			);
		}
		const existing = this.sessionToolManagers.get(session.sessionId);
		if (servers.length === 0 && !existing) return;

		if (servers.length === 0) {
			await this.releaseMcpServers(session.sessionId);
		} else {
			const manager = existing ?? this.initContext.toolManager.forSession();
			this.sessionToolManagers.set(session.sessionId, manager);
			try {
				await manager.initializeMCP(servers, result => {
					if (result.success) {
						logger.info(
							`ACP session ${session.sessionId}: MCP server connected: ${result.serverName}`,
						);
					} else {
						logger.warn(
							`ACP session ${session.sessionId}: MCP server failed: ${result.serverName} (${result.error})`,
						);
					}
				});
			} catch (error) {
				logger.error(
					`ACP session ${session.sessionId}: MCP initialization failed: ${String(error)}`,
				);
			}
		}
		// The prompt lists the tools the session has.
		this.buildSystemPromptForSession(session);
	}

	/** Disconnect the MCP servers this session brought, and only those. */
	private async releaseMcpServers(sessionId: string): Promise<void> {
		const manager = this.sessionToolManagers.get(sessionId);
		this.sessionToolManagers.delete(sessionId);
		try {
			await manager?.disconnectMCP();
		} catch (error) {
			logger.warn(
				`ACP session ${sessionId}: MCP disconnect failed: ${String(error)}`,
			);
		}
	}

	private registerSession(
		sessionId: string,
		cwd: string,
		disabledTools: string[],
		context: SessionContext,
	): AcpSession {
		const session = new AcpSession({
			sessionId,
			cwd,
			conn: this.conn,
			clientCapabilities: this.clientCapabilities,
			initialMode: this.initContext.initialMode,
			context,
		});
		session.disabledTools = disabledTools;
		// Pinned now, so a later selection in another session does not move it.
		session.provider = this.initContext.provider;
		session.model = this.initContext.model;
		session.client = this.initContext.client;
		this.sessions.set(sessionId, session);
		this.buildSystemPromptForSession(session);
		// Not awaited: a slow hook must not hold up session/new. The first prompt
		// waits for it, so its output still reaches the model on that prompt.
		session.startHookOutput = this.runSessionHooks(session, 'session-start')
			.then(({output}) => output)
			.catch(error => {
				logger.warn(
					`ACP session ${sessionId}: session-start hooks failed: ${String(error)}`,
				);
				return '';
			});
		return session;
	}

	/**
	 * A session in another project starts on the provider nanocoder started in
	 * that folder would pick, not on the launch folder's: the launch folder's
	 * provider may not be configured there, or be configured differently. Runs
	 * in the session's context, so `getAppConfig()` is the folder's config. The
	 * process default is kept when the folder configures that same provider
	 * the same way, and when the folder's choice cannot be reached.
	 */
	private async startOnFolderDefault(session: AcpSession): Promise<void> {
		const {launchDirectory} = this.initContext;
		if (launchDirectory === undefined) return;
		if (path.resolve(session.cwd) === path.resolve(launchDirectory)) return;

		const folderProviders = getAppConfig().providers ?? [];
		const launchProviders = runOutsideSessionContext(
			() => getAppConfig().providers ?? [],
		);
		const sameAsLaunch = (name: string) => {
			const folder = folderProviders.find(p => p.name === name);
			const launch = launchProviders.find(p => p.name === name);
			return (
				folder !== undefined &&
				launch !== undefined &&
				JSON.stringify(folder) === JSON.stringify(launch)
			);
		};
		if (sameAsLaunch(session.provider)) return;

		const {provider} = resolveStartupProvider(
			undefined,
			undefined,
			loadPreferences().lastProvider,
			folderProviders.map(p => p.name),
		);
		try {
			const {client, actualProvider} = await createLLMClient(provider);
			const lastUsed = getLastUsedModel(actualProvider);
			if (lastUsed && (await client.getAvailableModels()).includes(lastUsed)) {
				client.setModel(lastUsed);
			}
			session.provider = actualProvider;
			session.model = client.getCurrentModel();
			session.client = client;
			this.buildSystemPromptForSession(session);
			logger.info(
				`ACP session ${session.sessionId} starts on ${session.provider}/${session.model} from ${session.cwd}`,
			);
		} catch (error) {
			logger.warn(
				`ACP session ${session.sessionId} stays on ${session.provider}/${session.model}: no provider of ${session.cwd} could be used (${error instanceof Error ? error.message : String(error)})`,
			);
		}
	}

	/**
	 * The tools this session does not offer or run, so a client can check its
	 * request was honoured. A requested name that is not a known tool is logged
	 * and left out, so the list is what is actually in effect.
	 */
	private buildDisabledToolsMeta(session: AcpSession) {
		const toolManager = this.toolManagerFor(session.sessionId);
		for (const name of session.disabledTools) {
			if (!toolManager.hasTool(name)) {
				logger.debug(
					`ACP session ${session.sessionId}: ignoring unknown disabled tool "${name}"`,
				);
			}
		}
		return {
			[ACP_DISABLED_TOOLS_META]: session.effectiveDisabledTools(name =>
				toolManager.hasTool(name),
			),
		};
	}

	private async buildApprovalMeta(session: AcpSession) {
		return {
			'nanocoder/approval': {
				alwaysAllow: await getAlwaysAllowedTools(
					this.toolManagerFor(session.sessionId),
					session.developmentMode,
					getAppConfig().alwaysAllow ?? [],
					session.effectiveDisabledTools(),
				),
			},
		};
	}

	private buildModeState(session: AcpSession): SessionModeState {
		return {
			currentModeId: developmentModeToAcpMode(session.developmentMode),
			availableModes: getAvailableModes().map(id => ({id, name: id})),
		};
	}

	private async replaySessionHistory(session: AcpSession): Promise<void> {
		for (const message of session.messages) {
			if (isInternalWalkthroughMessage(message)) continue;
			if (message.role === 'user') {
				if (typeof message.content === 'string' && message.content.length > 0) {
					await this.conn.sessionUpdate({
						sessionId: session.sessionId,
						update: {
							sessionUpdate: 'user_message_chunk',
							content: {type: 'text', text: message.content},
						},
					});
				}
			} else if (message.role === 'assistant') {
				// runAcpConversation no longer stores whitespace-only reasoning, so
				// this guard is for sessions written before that — replaying one
				// would otherwise open a thought section that renders to nothing.
				if (message.reasoning && message.reasoning.trim().length > 0) {
					await this.conn.sessionUpdate({
						sessionId: session.sessionId,
						update: {
							sessionUpdate: 'agent_thought_chunk',
							content: {type: 'text', text: message.reasoning},
						},
					});
				}
				if (typeof message.content === 'string' && message.content.length > 0) {
					await this.conn.sessionUpdate({
						sessionId: session.sessionId,
						update: {
							sessionUpdate: 'agent_message_chunk',
							content: {type: 'text', text: message.content},
						},
					});
				}
				if (message.tool_calls && message.tool_calls.length > 0) {
					for (const tc of message.tool_calls) {
						await this.conn.sessionUpdate({
							sessionId: session.sessionId,
							update: {
								// Replay tool calls as already completed
								sessionUpdate: 'tool_call',
								toolCallId: tc.id,
								title: tc.function.name,
								rawInput: tc.function.arguments,
								status: 'completed',
							},
						});
					}
				}
				if (message.responseUsage || message.durationMs || message.outcome) {
					await this.conn.sessionUpdate({
						sessionId: session.sessionId,
						update: {
							sessionUpdate: 'agent_message_chunk',
							content: {type: 'text', text: ''},
							_meta: {
								...(message.responseUsage
									? {'nanocoder/response-usage': message.responseUsage}
									: {}),
								...(message.durationMs
									? {'nanocoder/durationMs': message.durationMs}
									: {}),
								...(message.outcome
									? {'nanocoder/outcome': message.outcome}
									: {}),
							},
						},
					});
				}
			}
		}
	}

	private attachResponseUsage(
		session: AcpSession,
		response: PromptResponse,
		previousAssistant?: (typeof session.messages)[number],
		turnDurationMs?: number,
	): void {
		const assistant = findLastAssistantMessage(session);
		if (!assistant || assistant === previousAssistant) return;

		if (turnDurationMs !== undefined) {
			assistant.durationMs = turnDurationMs;
			assistant.outcome = 'completed';
		}

		if (!response.usage) return;

		const cost = (
			response._meta as
				| {'nanocoder/usage'?: {cost?: unknown}}
				| null
				| undefined
		)?.['nanocoder/usage']?.cost;
		assistant.responseUsage = {
			inputTokens: response.usage.inputTokens,
			outputTokens: response.usage.outputTokens,
			totalTokens: response.usage.totalTokens,
			...(typeof cost === 'number' && Number.isFinite(cost) ? {cost} : {}),
		};
	}

	// 0.25.0 folded model selection into the generic session-config system: a
	// single "select" option in the `model` category, switched via
	// setSessionConfigOption rather than the removed unstable_setSessionModel.
	private async buildConfigOptions(
		session: AcpSession,
	): Promise<SessionConfigOption[]> {
		const client = this.clientFor(session);
		const available = await client.getAvailableModels();
		const currentModelId = session.model || client.getCurrentModel();

		const modelIds = [...available];
		// Ensure the active model is always present in the list so clients can
		// render the current selection even if it is not in the provider's list.
		if (!available.includes(currentModelId) && currentModelId.length > 0) {
			modelIds.unshift(currentModelId);
		}

		const config = getAppConfig();
		const providerNames = (config.providers ?? []).map(p => p.name);
		const currentProvider =
			session.provider || client.getProviderConfig().name || 'openai';

		const providerIds = [...providerNames];
		if (
			!providerNames.includes(currentProvider) &&
			currentProvider.length > 0
		) {
			providerIds.unshift(currentProvider);
		}

		return [
			{
				type: 'select',
				id: 'provider',
				name: 'Provider',
				category: 'model',
				currentValue: currentProvider,
				options: providerIds.map(id => ({name: id, value: id})),
			},
			{
				type: 'select',
				id: MODEL_CONFIG_ID,
				name: 'Model',
				category: 'model',
				currentValue: currentModelId,
				options: modelIds.map(id => ({name: id, value: id})),
			},
		];
	}

	private buildSystemPromptForSession(session: AcpSession): void {
		const toolManager = this.toolManagerFor(session.sessionId);
		const {provider, model} = session;

		const tune = resolveTune(
			getAppConfig(),
			this.clientFor(session).getProviderConfig(),
			loadPreferences(),
		);
		// This session's own preset, applied to its turns only. The process-wide
		// one would change when every other session compacts, mid-turn included.
		session.aggressiveCompact = Boolean(tune.enabled && tune.aggressiveCompact);
		const tuneToolMode = getTuneToolMode(tune);
		session.nativeToolsDisabled = tuneToolMode !== 'native';
		const toolsDisabled =
			tuneToolMode !== 'native' || isToolCallingDisabled(provider, model);
		const fallbackToolFormat: 'xml' | 'json' =
			tuneToolMode === 'json' ? 'json' : 'xml';

		const availableNames = toolManager.getAvailableToolNames(
			tune,
			session.developmentMode,
			session.effectiveDisabledTools(),
			model,
		);
		// Inside the session's scope, so the working directory the prompt reports
		// and the AGENTS.md it appends come from the session's `cwd`.
		const basePrompt = runInSessionContext(session.context, () =>
			buildSystemPrompt(
				session.developmentMode,
				tune,
				availableNames,
				toolsDisabled,
				getAppConfig().systemPrompt,
				model,
				undefined,
				toolManager,
			),
		);
		const toolsForPrompt = toolsDisabled
			? toolManager.getFilteredTools(availableNames)
			: {};
		const systemContent = appendToolDefinitionsToPrompt(
			basePrompt,
			toolsDisabled,
			fallbackToolFormat,
			toolsForPrompt,
		);
		setLastBuiltPrompt(systemContent);

		session.baseSystemMessage = {role: 'system', content: systemContent};
		session.systemMessage = session.baseSystemMessage;
	}

	/**
	 * What a saved session records as its provider and model: the session's
	 * own, else what its client says, never a made-up default. An invented
	 * pair would be restored on resume as if the user had picked it.
	 */
	private savedModelOf(session: AcpSession): {provider: string; model: string} {
		const client = this.clientFor(session);
		return {
			provider: session.provider || client.getProviderConfig().name || '',
			model: session.model || client.getCurrentModel() || '',
		};
	}

	private async saveAcpSessionToDisk(session: AcpSession): Promise<void> {
		try {
			// First, see if it already exists to preserve createdAt/title
			let existingSession = undefined;
			try {
				existingSession = await sessionManager.loadSession(session.sessionId);
			} catch (_e) {
				// Ignore if it doesn't exist yet
			}

			const timestamp = new Date().toISOString();

			// We only want user/assistant messages for the title generation/saving
			const saveableMessages = session.messages.filter(
				m => (m.role === 'user' || m.role === 'assistant') && !m.displayOnly,
			);

			if (saveableMessages.length === 0) {
				if (existingSession) {
					await sessionManager.saveSession({
						...this.savedModelOf(session),
						id: session.sessionId,
						title: existingSession.title || 'New Session',
						titleManuallySet: existingSession.titleManuallySet,
						pinned: existingSession.pinned,
						titleGenerated: existingSession.titleGenerated,
						createdAt: existingSession.createdAt || timestamp,
						lastAccessedAt: timestamp,
						messageCount: 0,
						workingDirectory: session.cwd,
						messages: [],
					});
				}
				return;
			}

			// Simple title generation if it's new. A user-renamed title is never
			// auto-derived over — the flag below is what tells the CLI's autosave
			// the same thing, so it has to be carried forward on every save.
			let title = existingSession?.title;
			if (!title || title === 'New Session') {
				const firstUserMessage = saveableMessages.find(m => m.role === 'user');
				title =
					(typeof firstUserMessage?.content === 'string'
						? deriveTitleFromFirstMessage(firstUserMessage.content)
						: null) ?? 'New Session';
			}

			await sessionManager.saveSession({
				...this.savedModelOf(session),
				id: session.sessionId,
				title,
				titleManuallySet: existingSession?.titleManuallySet,
				pinned: existingSession?.pinned,
				titleGenerated: existingSession?.titleGenerated,
				createdAt: existingSession?.createdAt || timestamp,
				lastAccessedAt: timestamp,
				messageCount: saveableMessages.length,
				workingDirectory: session.cwd,
				messages: session.messages.map(m => {
					if (m.role === 'user' && typeof m.content === 'string') {
						return {
							...m,
							content: m.content.replace(ACTIVE_FILE_PREFIX, ''),
						};
					}
					return m;
				}), // We save the raw AcpSession messages with UI prefix stripped
			});
		} catch (error) {
			logger.error(`Failed to save session to disk: ${error}`);
		}
	}
}

function findLastAssistantMessage(
	session: AcpSession,
): (typeof session.messages)[number] | undefined {
	for (let index = session.messages.length - 1; index >= 0; index--) {
		if (session.messages[index].role === 'assistant') {
			return session.messages[index];
		}
	}
	return undefined;
}

function isToolCallingDisabled(provider: string, model: string): boolean {
	const config = getAppConfig();
	const providerConfig = config.providers?.find(p => p.name === provider);
	if (!providerConfig) return false;
	return providerConfig.disableToolModels?.includes(model) ?? false;
}
