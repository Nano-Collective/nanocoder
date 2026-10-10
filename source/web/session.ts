import {getAppConfig} from '@/config/index';
import type {SessionManager} from '@/session/session-manager';
import {sessionManager} from '@/session/session-manager';

/** Reserve a persisted browser session only when autosave is enabled. */
export async function prepareWebSession(
	id: string,
	text: string,
	settings: {provider: string; model: string},
	autoSave = getAppConfig().sessions?.autoSave !== false,
	manager: Pick<
		SessionManager,
		'initialize' | 'readSession' | 'createSession'
	> = sessionManager,
): Promise<void> {
	if (!autoSave) return;
	await manager.initialize();
	if (await manager.readSession(id)) return;
	await manager.createSession({
		id,
		title: text.trim().slice(0, 50) || 'Image conversation',
		provider: settings.provider,
		model: settings.model,
		workingDirectory: process.cwd(),
		messageCount: 0,
		messages: [],
	});
}
