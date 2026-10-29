import type {
	AgentCapabilities,
	ProtocolVersion,
	SessionModeId,
} from '@agentclientprotocol/sdk';
import {PROTOCOL_VERSION} from '@agentclientprotocol/sdk';
import type {DevelopmentMode} from '@/types/core';

const ACP_MODES: SessionModeId[] = [
	'normal',
	'auto-accept',
	'yolo',
	'plan',
	'architect',
];

const MODE_MAP: Record<SessionModeId, DevelopmentMode> = {
	normal: 'normal',
	'auto-accept': 'auto-accept',
	yolo: 'yolo',
	plan: 'plan',
	architect: 'architect',
};

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
export const ACP_EXT_METHODS = [...ACP_EXT_ALIASES, 'cancelSubagent'] as const;

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
	return MODE_MAP[modeId] ?? 'auto-accept';
}

export function developmentModeToAcpMode(mode: DevelopmentMode): SessionModeId {
	if (mode === 'headless') return 'auto-accept';
	return mode;
}
