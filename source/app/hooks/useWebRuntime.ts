import React from 'react';
import {getAppConfig} from '@/config/index';
import type {AppHandlers} from '@/hooks/useAppHandlers';
import type {useAppState} from '@/hooks/useAppState';
import type {useModeHandlers} from '@/hooks/useModeHandlers';
import {sessionManager} from '@/session/session-manager';
import {loadTasks} from '@/tools/tasks/storage';
import {handleWebCommand} from '@/web/commands';
import type {WebSessionMessage, WebSessionSummary} from '@/web/protocol';
import type {WebRuntimeBridge} from '@/web/runtime-bridge';
import {prepareWebSession} from '@/web/session';
import {setWebToolLifecyclePublisher} from '@/web/tool-lifecycle';
import {getWorkspacePanel} from '@/web/workspace';

interface WebRuntimeProps {
	bridge?: WebRuntimeBridge;
	state: ReturnType<typeof useAppState>;
	handlers: AppHandlers;
	modes: ReturnType<typeof useModeHandlers>;
	isGenerating: boolean;
	trusted: boolean;
	trustError: string | null;
	flushSession: () => Promise<void>;
}

const settleRender = () => new Promise<void>(resolve => setImmediate(resolve));
const visibleMessages = (
	messages: ReturnType<typeof useAppState>['messages'],
): WebSessionMessage[] =>
	messages
		.filter(
			message =>
				(message.role === 'user' || message.role === 'assistant') &&
				(message.content.trim() || message.images?.length),
		)
		.map(message => ({
			role: message.role as 'user' | 'assistant',
			content: message.content,
			images: message.images,
		}));
const sessionSummary = (session: {
	id: string;
	title: string;
	lastAccessedAt: string;
	messageCount: number;
}): WebSessionSummary => ({
	id: session.id,
	title: session.title,
	lastAccessedAt: session.lastAccessedAt,
	messageCount: session.messageCount,
});

/** Connect the browser transport to the same live runtime used by the TUI. */
export function useWebRuntime(props: WebRuntimeProps): void {
	const {bridge, state, trusted, trustError} = props;
	const latest = React.useRef(props);
	latest.current = props;
	const snapshot = React.useCallback(() => {
		const current = latest.current.state;
		return {
			session: current.currentSessionId
				? {
						id: current.currentSessionId,
						title:
							current.sessionName ||
							current.messages
								.find(message => message.role === 'user')
								?.content.slice(0, 80) ||
							'New chat',
						lastAccessedAt: new Date().toISOString(),
						messageCount: current.messages.length,
					}
				: null,
			messages: visibleMessages(current.messages),
		};
	}, []);
	React.useEffect(
		() =>
			sessionManager.subscribeToSaves(session => {
				if (session.id === latest.current.state.currentSessionId)
					latest.current.state.setSessionName(session.title);
				if (bridge && session.workingDirectory === process.cwd())
					void bridge.refreshSessions().catch(() => {});
			}),
		[bridge],
	);
	React.useEffect(() => {
		bridge?.setRuntimeStatus(
			trustError
				? `Directory trust check failed: ${trustError}`
				: !trusted
					? 'Approve directory trust in the terminal to start web mode.'
					: !state.client || !state.toolManager
						? 'Configure a provider and model in the terminal to start web mode.'
						: 'Ready',
		);
	}, [bridge, trustError, trusted, state.client, state.toolManager]);
	React.useEffect(() => {
		// Render dependencies trigger synchronization; the stable callback is used
		// by bound handlers to read the latest state without rebinding per token.
		const current = snapshot();
		current.messages = visibleMessages(state.messages);
		if (current.session) {
			current.session.id = state.currentSessionId ?? current.session.id;
			current.session.title = state.sessionName || current.session.title;
		}
		bridge?.syncSession(current.session, current.messages);
	}, [
		bridge,
		snapshot,
		state.currentSessionId,
		state.sessionName,
		state.messages,
	]);
	React.useEffect(() => {
		bridge?.setSettings({
			provider: state.currentProvider,
			model: state.currentModel,
			mode: state.developmentMode,
			providers: (getAppConfig().providers ?? []).map(provider => ({
				name: provider.name,
				models: provider.models,
			})),
			modes: ['normal', 'auto-accept', 'yolo', 'plan', 'architect'],
		});
	}, [
		bridge,
		state.currentProvider,
		state.currentModel,
		state.developmentMode,
	]);
	React.useEffect(() => {
		if (!bridge || !trusted || !state.client || !state.toolManager) return;
		const reset = async () => {
			if (latest.current.isGenerating)
				throw new Error(
					'Cannot start a new chat while Nanocoder is processing a turn.',
				);
			await latest.current.flushSession();
			await latest.current.handlers.clearMessages();
			await settleRender();
		};
		return bridge.bindRuntimeHandlers({
			getSessionState: snapshot,
			getWorkspacePanel: async (panel, path) => {
				const current = latest.current.state;
				return getWorkspacePanel(panel, path, {
					root: process.cwd(),
					tasks:
						current.liveTaskList ??
						(current.currentSessionId
							? await loadTasks(current.currentSessionId)
							: []),
				});
			},
			submitMessage: async (text, images) => {
				if (latest.current.isGenerating)
					throw new Error('Nanocoder is already processing a turn.');
				if (
					await handleWebCommand(text, {
						resetSession: reset,
						getSettings: () => ({
							provider: latest.current.state.currentProvider,
							model: latest.current.state.currentModel,
							mode: latest.current.state.developmentMode,
						}),
						notice: bridge.publishNotice,
					})
				) {
					await settleRender();
					return;
				}
				const current = latest.current.state;
				await prepareWebSession(current.ensureCurrentSessionId(), text, {
					provider: current.currentProvider,
					model: current.currentModel,
				});
				await latest.current.handlers.handleMessageSubmit(
					text,
					undefined,
					images,
				);
				await settleRender();
			},
			cancel: () => latest.current.handlers.handleCancel(),
			resetSession: reset,
			updateSettings: async settings => {
				const provider = getAppConfig().providers?.find(
					provider => provider.name === settings.provider,
				);
				if (!provider?.models.includes(settings.model))
					throw new Error('Select a configured provider and model.');
				const mode = (
					['normal', 'auto-accept', 'yolo', 'plan', 'architect'] as const
				).find(mode => mode === settings.mode);
				if (!mode) throw new Error('Unsupported development mode.');
				if (
					!(await latest.current.modes.handleModelSelect(
						settings.provider,
						settings.model,
						true,
					))
				)
					throw new Error(
						`Unable to switch to ${settings.provider}. Check the provider configuration.`,
					);
				latest.current.state.setDevelopmentMode(mode);
				await settleRender();
			},
			listSessions: async () => {
				await sessionManager.initialize();
				return [
					...(await sessionManager.listSessions({
						workingDirectory: process.cwd(),
					})),
				]
					.sort(
						(a, b) =>
							new Date(b.lastAccessedAt).getTime() -
							new Date(a.lastAccessedAt).getTime(),
					)
					.map(sessionSummary);
			},
			deleteSession: async id => {
				await sessionManager.initialize();
				await sessionManager.deleteSession(id);
			},
			loadSession: async id => {
				if (latest.current.isGenerating)
					throw new Error(
						'Cannot switch sessions while Nanocoder is processing a turn.',
					);
				await latest.current.flushSession();
				await sessionManager.initialize();
				const session = await sessionManager.loadSession(id);
				if (!session) return null;
				latest.current.handlers.applySession(session);
				return {
					session: sessionSummary(session),
					messages: visibleMessages(session.messages),
				};
			},
		});
	}, [bridge, trusted, state.client, state.toolManager, snapshot]);
	React.useEffect(() => {
		if (!bridge) return;
		setWebToolLifecyclePublisher({
			started: bridge.publishToolStarted,
			finished: bridge.publishToolFinished,
		});
		return () => setWebToolLifecyclePublisher(null);
	}, [bridge]);
}
