import type {
	Agent,
	AgentSideConnection,
	AuthenticateRequest,
	AuthenticateResponse,
	CancelNotification,
	InitializeRequest,
	InitializeResponse,
	NewSessionRequest,
	NewSessionResponse,
	PromptRequest,
	PromptResponse,
	SetSessionModeRequest,
	SetSessionModeResponse,
} from '@agentclientprotocol/sdk';
import {
	acpModeToDevelopmentMode,
	getAgentCapabilities,
	getAvailableModes,
} from '@/acp/acp-capabilities';
import {acpContentToUserText} from '@/acp/acp-content';
import {runAcpConversation} from '@/acp/acp-conversation';
import {AcpSession} from '@/acp/acp-session';
import type {AcpInitContext} from '@/acp/acp-types';
import {appendToolDefinitionsToPrompt} from '@/ai-sdk-client/tools/system-prompt-assembler';
import {getAppConfig} from '@/config/index';
import {loadPreferences} from '@/config/preferences';
import {getTuneToolMode} from '@/types/config';
import {getLogger} from '@/utils/logging';
import {buildSystemPrompt, setLastBuiltPrompt} from '@/utils/prompt-builder';

const logger = getLogger();

export class AcpAgent implements Agent {
	private sessions = new Map<string, AcpSession>();
	private initContext: AcpInitContext;
	private conn: AgentSideConnection;

	constructor(initContext: AcpInitContext, conn: AgentSideConnection) {
		this.initContext = initContext;
		this.conn = conn;
	}

	async initialize(params: InitializeRequest): Promise<InitializeResponse> {
		logger.info(`ACP initialize: protocolVersion=${params.protocolVersion}`);

		return {
			protocolVersion: params.protocolVersion,
			agentCapabilities: getAgentCapabilities(),
			agentInfo: {
				name: 'nanocoder',
				title: 'Nanocoder',
				version: '1.0.0',
			},
			authMethods: [],
		};
	}

	async newSession(params: NewSessionRequest): Promise<NewSessionResponse> {
		const sessionId = crypto.randomUUID();
		logger.info(`ACP newSession: ${sessionId} cwd=${params.cwd}`);

		const session = new AcpSession({
			sessionId,
			cwd: params.cwd,
			conn: this.conn,
			clientCapabilities: undefined, // params doesn't carry client caps; they come from initialize
			initialMode: 'auto-accept',
		});

		this.sessions.set(sessionId, session);
		this.buildSystemPromptForSession(session);

		return {
			sessionId,
			modes: {
				currentModeId: 'auto-accept',
				availableModes: getAvailableModes().map(id => ({id, name: id})),
			},
		};
	}

	async prompt(params: PromptRequest): Promise<PromptResponse> {
		const session = this.sessions.get(params.sessionId);
		if (!session) {
			throw new Error(`Session not found: ${params.sessionId}`);
		}

		const userText = acpContentToUserText(params.prompt);
		logger.info(
			`ACP prompt: session=${params.sessionId} text=${userText.slice(0, 100)}`,
		);

		session.messages = [...session.messages, {role: 'user', content: userText}];

		const config = getAppConfig();
		const nonInteractiveAlwaysAllow = config.alwaysAllow ?? [];

		return runAcpConversation({
			session,
			client: this.initContext.client,
			toolManager: this.initContext.toolManager,
			conn: this.conn,
			nonInteractiveAlwaysAllow,
		});
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

	async authenticate(
		_params: AuthenticateRequest,
	): Promise<AuthenticateResponse> {
		return {};
	}

	private buildSystemPromptForSession(session: AcpSession): void {
		const {toolManager} = this.initContext;
		const {provider, model} = this.initContext;

		const tunePrefs = loadPreferences().tune;
		const tuneToolMode = getTuneToolMode(tunePrefs);
		const toolsDisabled =
			tuneToolMode !== 'native' || isToolCallingDisabled(provider, model);
		const fallbackToolFormat: 'xml' | 'json' =
			tuneToolMode === 'json' ? 'json' : 'xml';

		const availableNames = toolManager.getAvailableToolNames(
			undefined,
			session.developmentMode,
		);
		const basePrompt = buildSystemPrompt(
			session.developmentMode,
			undefined,
			availableNames,
			toolsDisabled,
			getAppConfig().systemPrompt,
		);
		const toolsForPrompt = toolsDisabled
			? toolManager.getFilteredToolsWithoutExecute(availableNames)
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
