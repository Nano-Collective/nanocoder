import type {AgentCapabilities, SessionModeId} from '@agentclientprotocol/sdk';
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
		sessionCapabilities: {
			close: {},
		},
	};
}

export function getAvailableModes(): SessionModeId[] {
	return ACP_MODES;
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
