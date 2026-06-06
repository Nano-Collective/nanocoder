import type {
	AgentCapabilities,
	ProtocolVersion,
	SessionModeId,
} from '@agentclientprotocol/sdk';
import {PROTOCOL_VERSION} from '@agentclientprotocol/sdk';
import type {DevelopmentMode} from '@/types/core';

const ACP_MODES: SessionModeId[] = ['normal', 'auto-accept', 'yolo', 'plan'];

const MODE_MAP: Record<SessionModeId, DevelopmentMode> = {
	normal: 'normal',
	'auto-accept': 'auto-accept',
	yolo: 'yolo',
	plan: 'plan',
};

export function getAgentCapabilities(): AgentCapabilities {
	return {
		loadSession: true,
		sessionCapabilities: {
			close: {},
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
