import type {
	AgentCapabilities,
	ProtocolVersion,
	SessionModeId,
} from '@agentclientprotocol/sdk';
import {PROTOCOL_VERSION, RequestError} from '@agentclientprotocol/sdk';
import type {DevelopmentMode} from '@/types/core';

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
 * Custom requests, by the bare name clients sent before they were prefixed.
 * Those bare names still work as deprecated aliases; the prefixed names are
 * advertised in `agentCapabilities._meta.nanocoder.extMethods`.
 */
export const ACP_EXT_METHODS = [
	'renameSession',
	'pinSession',
	'timeline/list',
	'timeline/revert',
	'retryTurn',
] as const;

/** Sent when a session is titled in the background. */
export const ACP_SESSION_TITLE_NOTIFICATION = '_nanocoder/sessionTitleChanged';

/** Custom notifications the agent sends, by their full names. */
const ACP_EXT_NOTIFICATIONS = [ACP_SESSION_TITLE_NOTIFICATION];

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
