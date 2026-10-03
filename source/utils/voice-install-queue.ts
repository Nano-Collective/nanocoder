import {createGlobalHandlerSlot} from '@/utils/global-handler-slot';

let declinedInstallForSession = false;

export function setDeclinedVoiceInstallForSession(declined: boolean): void {
	declinedInstallForSession = declined;
}

export function hasDeclinedVoiceInstallForSession(): boolean {
	return declinedInstallForSession;
}

export interface PendingVoiceInstall {
	missing: ('sox' | 'whisper' | 'piper')[];
	installDependencies?: (
		onProgress: (step: string, percent: number) => void,
	) => Promise<void>;
}

const installSlot = createGlobalHandlerSlot<PendingVoiceInstall, boolean>(
	() => false,
);

export const setGlobalVoiceInstallHandler = installSlot.set;
export const signalVoiceInstallPrompt = installSlot.signal;
