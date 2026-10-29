import type {
	AgentCapabilities,
	McpServer,
	ProtocolVersion,
	SessionModeId,
} from '@agentclientprotocol/sdk';
import {PROTOCOL_VERSION, RequestError} from '@agentclientprotocol/sdk';
import type {DevelopmentMode} from '@/types/core';
import type {MCPServer} from '@/types/index';

const MODE_MAP: Record<SessionModeId, DevelopmentMode> = {
	normal: 'normal',
	'auto-accept': 'auto-accept',
	yolo: 'yolo',
	plan: 'plan',
	architect: 'architect',
};

// Own keys only, so the advertised modes and the mapping cannot drift apart.
const ACP_MODES = Object.keys(MODE_MAP) as SessionModeId[];

/** ACP reserves `_`-prefixed method names for custom methods. */
export const ACP_EXT_PREFIX = '_nanocoder/';

/**
 * Custom requests older clients send by their bare name. Those names still
 * work as deprecated aliases; methods added since are only answered under
 * their prefixed name.
 */
export const ACP_EXT_ALIASES = [
	'renameSession',
	'timeline/list',
	'timeline/revert',
	'retryTurn',
] as const;

/** Every custom request, advertised in `agentCapabilities._meta.nanocoder`. */
export const ACP_EXT_METHODS = [
	...ACP_EXT_ALIASES,
	'timeline/read',
	'cancelSubagent',
] as const;

/** Sent when a session is titled in the background. */
export const ACP_SESSION_TITLE_NOTIFICATION = '_nanocoder/sessionTitleChanged';

/** Sent as each subagent run starts, progresses and ends. */
export const ACP_SUBAGENT_NOTIFICATION = '_nanocoder/subagent';

/** Custom notifications the agent sends, by their full names. */
const ACP_EXT_NOTIFICATIONS = [
	ACP_SESSION_TITLE_NOTIFICATION,
	ACP_SUBAGENT_NOTIFICATION,
];

export function getAgentCapabilities(): AgentCapabilities {
	return {
		loadSession: true,
		// stdio is always supported; Nanocoder has no SSE transport.
		mcpCapabilities: {http: true},
		providers: {},
		sessionCapabilities: {
			close: {},
			list: {},
			delete: {},
			resume: {},
		},
		_meta: {
			nanocoder: {
				extMethods: ACP_EXT_METHODS.map(name => `${ACP_EXT_PREFIX}${name}`),
				extNotifications: [...ACP_EXT_NOTIFICATIONS],
			},
		},
	};
}

/**
 * The MCP servers a client sent, as Nanocoder's own server config. Stdio and
 * HTTP map across; the rest (SSE, MCP-over-ACP) are returned by name in
 * `skipped` so the caller can say they were left out.
 */
export function acpMcpServersToConfig(servers: McpServer[] = []): {
	servers: MCPServer[];
	skipped: string[];
} {
	const toRecord = (pairs: Array<{name: string; value: string}> = []) =>
		Object.fromEntries(pairs.map(({name, value}) => [name, value]));
	const mapped: MCPServer[] = [];
	const skipped: string[] = [];

	for (const server of servers) {
		if (!('type' in server)) {
			mapped.push({
				name: server.name,
				transport: 'stdio',
				command: server.command,
				args: server.args ?? [],
				env: toRecord(server.env),
			});
		} else if (server.type === 'http') {
			mapped.push({
				name: server.name,
				transport: 'http',
				url: server.url,
				headers: toRecord(server.headers),
			});
		} else {
			skipped.push(`${server.name} (${server.type})`);
		}
	}

	return {servers: mapped, skipped};
}

/**
 * `_meta` key a client sets on session/new, session/load and session/resume to
 * turn tools off for that session, and under which the response reports the
 * list in effect.
 */
export const ACP_DISABLED_TOOLS_META = 'nanocoder/disabledTools';

/** The tool names a client asked to disable; anything but a list of strings is ignored. */
export function parseDisabledTools(meta: unknown): string[] {
	const requested = (meta as Record<string, unknown> | null | undefined)?.[
		ACP_DISABLED_TOOLS_META
	];
	return Array.isArray(requested)
		? requested.filter((name): name is string => typeof name === 'string')
		: [];
}

/** The user's own disabledTools plus the session's; the session never replaces them. */
export function mergeDisabledTools(
	userDisabled: readonly string[] = [],
	sessionDisabled: readonly string[] = [],
): string[] {
	return [...new Set([...userDisabled, ...sessionDisabled])];
}

export function getAvailableModes(): SessionModeId[] {
	return ACP_MODES;
}

/**
 * Resolve the protocol version to report back to the client. We must never
 * claim support for a newer protocol than this SDK implements, so clamp the
 * client's requested version down to ours.
 */
export function negotiateProtocolVersion(
	requested: ProtocolVersion,
): ProtocolVersion {
	if (typeof requested === 'number' && requested < PROTOCOL_VERSION) {
		return requested;
	}
	return PROTOCOL_VERSION;
}

export function acpModeToDevelopmentMode(
	modeId: SessionModeId,
): DevelopmentMode {
	// Checked against the list, not MODE_MAP, which also answers to inherited
	// keys such as "constructor".
	if (!ACP_MODES.includes(modeId)) {
		throw RequestError.invalidParams(
			{modeId},
			`Unknown session mode: ${modeId}`,
		);
	}
	return MODE_MAP[modeId];
}

export function developmentModeToAcpMode(mode: DevelopmentMode): SessionModeId {
	if (mode === 'headless') return 'auto-accept';
	return mode;
}
