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
 * Custom requests, by the bare name clients sent before they were prefixed.
 * Those bare names still work as deprecated aliases; the prefixed names are
 * advertised in `agentCapabilities._meta.nanocoder.extMethods`.
 */
export const ACP_EXT_METHODS = [
	'renameSession',
	'timeline/list',
	'timeline/revert',
	'retryTurn',
] as const;

/** Custom notifications the agent sends, by their full names. */
const ACP_EXT_NOTIFICATIONS = ['_nanocoder/sessionTitleChanged'];

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
				extNotifications: ACP_EXT_NOTIFICATIONS,
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
