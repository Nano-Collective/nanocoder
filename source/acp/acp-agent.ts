import type {
	Agent,
	AgentSideConnection,
	AuthenticateRequest,
	AuthenticateResponse,
	CancelNotification,
	ClientCapabilities,
	InitializeRequest,
	InitializeResponse,
	LoadSessionRequest,
	LoadSessionResponse,
	ModelInfo,
	NewSessionRequest,
	NewSessionResponse,
	PromptRequest,
	PromptResponse,
	SessionModelState,
	SessionModeState,
	SetSessionModelRequest,
	SetSessionModelResponse,
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
import {acpContentToUserText} from '@/acp/acp-content';
import {runAcpConversation} from '@/acp/acp-conversation';
import {AcpSession} from '@/acp/acp-session';
import type {AcpInitContext} from '@/acp/acp-types';
import {appendToolDefinitionsToPrompt} from '@/ai-sdk-client/tools/system-prompt-assembler';
import {getAppConfig} from '@/config/index';
import {loadPreferences, updateLastUsed} from '@/config/preferences';
import {resolveTune} from '@/config/tune';
import {getTuneToolMode} from '@/types/config';
import {getLogger} from '@/utils/logging';
import {buildSystemPrompt, setLastBuiltPrompt} from '@/utils/prompt-builder';

const logger = getLogger();

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

		return {
			sessionId,
			modes: this.buildModeState(session),
			models: await this.buildModelState(),
		};
	}

	async loadSession(params: LoadSessionRequest): Promise<LoadSessionResponse> {
		const existing = this.sessions.get(params.sessionId);
		const session =
			existing ?? this.registerSession(params.sessionId, params.cwd);
		logger.info(
			`ACP loadSession: ${params.sessionId} cwd=${params.cwd} restored=${Boolean(existing)}`,
		);

		// Replay whatever history we hold so the client can rebuild the thread.
		// Note: sessions are in-memory, so history only survives within a single
		// agent process - a reload after restart yields an empty but usable
		// session rather than an error.
		await this.replaySessionHistory(session);

		return {
			modes: this.buildModeState(session),
			models: await this.buildModelState(),
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

		const userText = await acpContentToUserText(params.prompt, {
			conn: this.conn,
			sessionId: params.sessionId,
			canReadTextFile: this.clientCapabilities?.fs?.readTextFile ?? false,
		});
		logger.info(
			`ACP prompt: session=${params.sessionId} text=${userText.slice(0, 100)}`,
		);

		session.messages = [...session.messages, {role: 'user', content: userText}];

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
		} finally {
			session.turnActive = false;
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

	async unstable_setSessionModel(
		params: SetSessionModelRequest,
	): Promise<SetSessionModelResponse> {
		const session = this.sessions.get(params.sessionId);
		if (!session) {
			throw new Error(`Session not found: ${params.sessionId}`);
		}

		const {client, provider} = this.initContext;
		const available = await client.getAvailableModels();
		if (!available.includes(params.modelId)) {
			throw new Error(`Unknown model: ${params.modelId}`);
		}

		// Note: the LLM client is shared across all sessions, so the selected
		// model is effectively process-global. This matches single-session ACP
		// usage (Zed); a future multi-session client would see one shared model.
		client.setModel(params.modelId);
		updateLastUsed(provider, params.modelId);
		logger.info(
			`ACP setSessionModel: session=${params.sessionId} model=${params.modelId}`,
		);

		return {};
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
			if (typeof message.content !== 'string' || message.content.length === 0) {
				continue;
			}
			if (message.role === 'user') {
				await this.conn.sessionUpdate({
					sessionId: session.sessionId,
					update: {
						sessionUpdate: 'user_message_chunk',
						content: {type: 'text', text: message.content},
					},
				});
			} else if (message.role === 'assistant') {
				await this.conn.sessionUpdate({
					sessionId: session.sessionId,
					update: {
						sessionUpdate: 'agent_message_chunk',
						content: {type: 'text', text: message.content},
					},
				});
			}
		}
	}

	private async buildModelState(): Promise<SessionModelState> {
		const {client} = this.initContext;
		const available = await client.getAvailableModels();
		const currentModelId = client.getCurrentModel();

		const availableModels: ModelInfo[] = available.map(id => ({
			modelId: id,
			name: id,
		}));

		// Ensure the active model is always present in the list so clients can
		// render the current selection even if it is not in the provider's list.
		if (!available.includes(currentModelId) && currentModelId.length > 0) {
			availableModels.unshift({modelId: currentModelId, name: currentModelId});
		}

		return {availableModels, currentModelId};
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
}

function isToolCallingDisabled(provider: string, model: string): boolean {
	const config = getAppConfig();
	const providerConfig = config.providers?.find(p => p.name === provider);
	if (!providerConfig) return false;
	return providerConfig.disableToolModels?.includes(model) ?? false;
}
