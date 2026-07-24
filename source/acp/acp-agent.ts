import type {
	Agent,
	AgentSideConnection,
	AuthenticateRequest,
	AuthenticateResponse,
	CancelNotification,
	ClientCapabilities,
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
import {
	acpModeToDevelopmentMode,
	developmentModeToAcpMode,
	getAgentCapabilities,
	getAvailableModes,
	negotiateProtocolVersion,
} from '@/acp/acp-capabilities';
import {acpContentToUserMessage} from '@/acp/acp-content';
import {runAcpConversation} from '@/acp/acp-conversation';
import {AcpSession} from '@/acp/acp-session';
import type {AcpInitContext} from '@/acp/acp-types';
import {appendToolDefinitionsToPrompt} from '@/ai-sdk-client/tools/system-prompt-assembler';
import {createLLMClient} from '@/client-factory';
import {getAppConfig} from '@/config/index';
import {loadPreferences, updateLastUsed} from '@/config/preferences';
import {resolveTune} from '@/config/tune';
import {sessionManager} from '@/session/session-manager';
import {getTuneToolMode} from '@/types/config';
import {getLogger} from '@/utils/logging';
import {buildSystemPrompt, setLastBuiltPrompt} from '@/utils/prompt-builder';

const logger = getLogger();

// Stable id for the model selector config option (category `model`).
const MODEL_CONFIG_ID = 'model';

export class AcpAgent implements Agent {
	private sessions = new Map<string, AcpSession>();
	private initContext: AcpInitContext;
	private conn: AgentSideConnection;
	private appVersion: string;
	private clientCapabilities?: ClientCapabilities;

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

		return {
			protocolVersion: negotiateProtocolVersion(params.protocolVersion),
			agentCapabilities: getAgentCapabilities(),
			agentInfo: {
				name: 'nanocoder',
				title: 'Nanocoder',
				version: this.appVersion,
			},
			authMethods: [],
		};
	}

	async newSession(params: NewSessionRequest): Promise<NewSessionResponse> {
		const sessionId = crypto.randomUUID();
		logger.info(`ACP newSession: ${sessionId} cwd=${params.cwd}`);

		const session = this.registerSession(sessionId, params.cwd);

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
			} as any,
		});

		return {
			sessionId,
			modes: this.buildModeState(session),
			configOptions: await this.buildConfigOptions(),
		};
	}

	async loadSession(params: LoadSessionRequest): Promise<LoadSessionResponse> {
		const existing = this.sessions.get(params.sessionId);
		let session = existing;

		if (!session) {
			// Try loading from disk first so history persists across process restarts.
			await sessionManager.initialize();
			const persisted = await sessionManager.loadSession(params.sessionId);
			session = this.registerSession(params.sessionId, params.cwd);
			if (persisted) {
				session.messages = persisted.messages;
			}
		}

		logger.info(
			`ACP loadSession: ${params.sessionId} cwd=${params.cwd} restored=${Boolean(existing)}`,
		);

		// Replay history so the client can rebuild the thread.
		await this.replaySessionHistory(session);

		return {
			modes: this.buildModeState(session),
			configOptions: await this.buildConfigOptions(),
		};
	}

	async prompt(params: PromptRequest): Promise<PromptResponse> {
		const session = this.sessions.get(params.sessionId);
		if (!session) {
			throw new Error(`Session not found: ${params.sessionId}`);
		}

		// ACP clients drive one turn per session at a time; reject overlap rather
		// than letting two turns interleave mutations of session.messages.
		if (session.turnActive) {
			throw new Error(
				`Prompt already in progress for session: ${params.sessionId}`,
			);
		}

		const {text: userText, images} = await acpContentToUserMessage(
			params.prompt,
			{
				conn: this.conn,
				sessionId: params.sessionId,
				canReadTextFile: this.clientCapabilities?.fs?.readTextFile ?? false,
			},
		);
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
					// Custom user-defined command — expand its instructions into the prompt
					const commandInstruction = `### ${command.fullName}\n\n${command.content}`;
					contextualUserText = `${contextualUserText}\n\n## Included Command Instructions\n\n${commandInstruction}\n\nPlease follow these instructions for the user's request above.`;
				} else {
					// Check for built-in commands that have special ACP handling
					const sendBuiltinReply = (msg: string) => {
						session.messages = [
							...session.messages,
							{role: 'user', content: contextualUserText},
							{role: 'assistant', content: msg},
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
						// Clear the conversation history
						session.messages = [];
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

					if (commandName === 'help') {
						const customCmds =
							this.initContext.customCommandLoader?.getAllCommands() ?? [];
						const customList =
							customCmds.length > 0
								? customCmds
										.map(
											c =>
												`- \`/${c.fullName}\` — ${c.metadata.description || 'custom command'}`,
										)
										.join('\n')
								: '';
						const msg = [
							'**Available slash commands in VS Code GUI:**',
							'',
							'- `/clear` — Clear the current conversation',
							'- `/help` — Show this help message',
							'',
							'**Not available in VS Code GUI** (CLI-only):',
							'- `/init`, `/theme`, `/context-max`, `/compact`, `/usage`, and other interactive commands',
							'',
							customList ? `**Your custom commands:**\n${customList}` : '',
						]
							.filter(Boolean)
							.join('\n');
						return sendBuiltinReply(msg);
					}

					if (
						[
							'init',
							'theme',
							'compact',
							'context-max',
							'usage',
							'model',
							'settings',
						].includes(commandName)
					) {
						const msg = `The \`/${commandName}\` command is only available in the interactive CLI (\`nanocoder\` in a terminal). It is not supported in the VS Code GUI.`;
						return sendBuiltinReply(msg);
					}

					// Truly unrecognized command
					const errorMsg = `Unrecognized slash command: \`/${commandName}\`. Type \`/help\` to see available commands.`;
					return sendBuiltinReply(errorMsg);
				}
			}
		}

		if (session.activeFile) {
			contextualUserText = `[Active file: ${session.activeFile}]\n\n${contextualUserText}`;
		}

		session.messages = [
			...session.messages,
			{
				role: 'user',
				content: contextualUserText,
				...(images.length > 0 ? {images} : {}),
			},
		];

		const config = getAppConfig();
		const nonInteractiveAlwaysAllow = config.alwaysAllow ?? [];

		session.turnActive = true;
		try {
			return await runAcpConversation({
				session,
				client: this.initContext.client,
				toolManager: this.initContext.toolManager,
				conn: this.conn,
				nonInteractiveAlwaysAllow,
			});
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);
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
			});

			throw error;
		} finally {
			session.turnActive = false;
			await this.saveAcpSessionToDisk(session).catch(err => {
				logger.error(`Failed to save ACP session ${session.sessionId}: ${err}`);
			});
		}
	}

	async cancel(params: CancelNotification): Promise<void> {
		const session = this.sessions.get(params.sessionId);
		if (session) {
			logger.info(`ACP cancel: session=${params.sessionId}`);
			session.cancel();
		}
	}

	async setSessionMode(
		params: SetSessionModeRequest,
	): Promise<SetSessionModeResponse> {
		const session = this.sessions.get(params.sessionId);
		if (!session) {
			throw new Error(`Session not found: ${params.sessionId}`);
		}

		session.developmentMode = acpModeToDevelopmentMode(params.modeId);
		logger.info(
			`ACP setSessionMode: session=${params.sessionId} mode=${params.modeId}`,
		);

		// Rebuild system prompt for the new mode
		this.buildSystemPromptForSession(session);

		return {};
	}

	async setSessionConfigOption(
		params: SetSessionConfigOptionRequest,
	): Promise<SetSessionConfigOptionResponse> {
		const session = this.sessions.get(params.sessionId);
		if (!session) {
			throw new Error(`Session not found: ${params.sessionId}`);
		}

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

			this.initContext.provider = providerId;
			const {client: newClient} = await createLLMClient(providerId);
			this.initContext.client = newClient;

			const availableModels = await newClient.getAvailableModels();
			if (availableModels.includes(this.initContext.model)) {
				newClient.setModel(this.initContext.model);
			} else if (availableModels.length > 0) {
				this.initContext.model = availableModels[0];
				newClient.setModel(availableModels[0]);
			}
			updateLastUsed(providerId, this.initContext.model);

			logger.info(
				`ACP setSessionConfigOption: session=${params.sessionId} configId=${params.configId} value=${providerId}`,
			);
			return {configOptions: await this.buildConfigOptions()};
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

		const {client, provider} = this.initContext;
		const available = await client.getAvailableModels();
		if (!available.includes(modelId)) {
			throw new Error(`Unknown model: ${modelId}`);
		}

		// Note: the LLM client is shared across all sessions, so the selected
		// model is effectively process-global. This matches single-session ACP
		// usage (Zed); a future multi-session client would see one shared model.
		client.setModel(modelId);
		this.initContext.model = modelId;
		updateLastUsed(provider, modelId);
		logger.info(
			`ACP setSessionConfigOption: session=${params.sessionId} configId=${params.configId} value=${modelId}`,
		);

		return {configOptions: await this.buildConfigOptions()};
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
			})),
		};
	}

	async deleteSession(
		params: DeleteSessionRequest,
	): Promise<DeleteSessionResponse> {
		await sessionManager.initialize();
		await sessionManager.deleteSession(params.sessionId);
		// Evict from in-memory map if present
		this.sessions.delete(params.sessionId);
		logger.info(`ACP deleteSession: ${params.sessionId}`);
		return {};
	}

	async resumeSession(
		params: ResumeSessionRequest,
	): Promise<ResumeSessionResponse> {
		await sessionManager.initialize();
		const persisted = await sessionManager.loadSession(params.sessionId);
		if (!persisted) {
			throw new Error(`Session not found on disk: ${params.sessionId}`);
		}

		// Evict any stale in-memory session first
		this.sessions.delete(params.sessionId);
		const session = this.registerSession(
			params.sessionId,
			persisted.workingDirectory,
		);
		session.messages = persisted.messages;
		logger.info(
			`ACP resumeSession: ${params.sessionId} messages=${persisted.messages.length}`,
		);

		// Replay history so the client rebuilds the thread view.
		await this.replaySessionHistory(session);

		return {
			modes: this.buildModeState(session),
			configOptions: await this.buildConfigOptions(),
		};
	}

	async unstable_listProviders(
		_params: ListProvidersRequest,
	): Promise<ListProvidersResponse> {
		const config = getAppConfig();
		const providers = (config.providers ?? []).map(p => ({
			id: p.name,
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

	private registerSession(sessionId: string, cwd: string): AcpSession {
		const session = new AcpSession({
			sessionId,
			cwd,
			conn: this.conn,
			clientCapabilities: this.clientCapabilities,
			initialMode: 'auto-accept',
		});
		this.sessions.set(sessionId, session);
		this.buildSystemPromptForSession(session);
		return session;
	}

	private buildModeState(session: AcpSession): SessionModeState {
		return {
			currentModeId: developmentModeToAcpMode(session.developmentMode),
			availableModes: getAvailableModes().map(id => ({id, name: id})),
		};
	}

	private async replaySessionHistory(session: AcpSession): Promise<void> {
		for (const message of session.messages) {
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
				if (message.reasoning && message.reasoning.length > 0) {
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
			}
		}
	}

	// 0.25.0 folded model selection into the generic session-config system: a
	// single "select" option in the `model` category, switched via
	// setSessionConfigOption rather than the removed unstable_setSessionModel.
	private async buildConfigOptions(): Promise<SessionConfigOption[]> {
		const {client} = this.initContext;
		const available = await client.getAvailableModels();
		const currentModelId = client.getCurrentModel();

		const modelIds = [...available];
		// Ensure the active model is always present in the list so clients can
		// render the current selection even if it is not in the provider's list.
		if (!available.includes(currentModelId) && currentModelId.length > 0) {
			modelIds.unshift(currentModelId);
		}

		const config = getAppConfig();
		const providerNames = (config.providers ?? []).map(p => p.name);
		const currentProvider =
			this.initContext.provider || client.getProviderConfig().name || 'openai';

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
		const {toolManager} = this.initContext;
		const {provider, model} = this.initContext;

		const tune = resolveTune(getAppConfig(), undefined, loadPreferences());
		const tuneToolMode = getTuneToolMode(tune);
		const toolsDisabled =
			tuneToolMode !== 'native' || isToolCallingDisabled(provider, model);
		const fallbackToolFormat: 'xml' | 'json' =
			tuneToolMode === 'json' ? 'json' : 'xml';

		const availableNames = toolManager.getAvailableToolNames(
			tune,
			session.developmentMode,
			undefined,
			model,
		);
		const basePrompt = buildSystemPrompt(
			session.developmentMode,
			tune,
			availableNames,
			toolsDisabled,
			getAppConfig().systemPrompt,
			model,
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

		session.systemMessage = {role: 'system', content: systemContent};
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
				m => m.role === 'user' || m.role === 'assistant',
			);

			if (saveableMessages.length === 0) {
				return;
			}

			// Simple title generation if it's new
			let title = existingSession?.title;
			if (!title || title === 'New Session') {
				const firstUserMessage = saveableMessages.find(m => m.role === 'user');
				if (firstUserMessage && typeof firstUserMessage.content === 'string') {
					title = firstUserMessage.content.split('\n')[0].substring(0, 50);
				} else {
					title = 'New Session';
				}
			}

			await sessionManager.saveSession({
				id: session.sessionId,
				title,
				createdAt: existingSession?.createdAt || timestamp,
				lastAccessedAt: timestamp,
				messageCount: saveableMessages.length,
				provider: this.initContext.client.getProviderConfig().name || 'openai',
				model: this.initContext.client.getCurrentModel() || 'gpt-4o',
				workingDirectory: session.cwd,
				messages: session.messages.map(m => {
					if (m.role === 'user' && typeof m.content === 'string') {
						return {
							...m,
							content: m.content.replace(/^\[Active file: [^\]]+\]\n\n/, ''),
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

function isToolCallingDisabled(provider: string, model: string): boolean {
	const config = getAppConfig();
	const providerConfig = config.providers?.find(p => p.name === provider);
	if (!providerConfig) return false;
	return providerConfig.disableToolModels?.includes(model) ?? false;
}
