import {useEffect, useRef} from 'react';
import {getAppConfig} from '@/config/index';
import {sessionManager} from '@/session/session-manager';
import type {Message} from '@/types/core';
import {logWarning} from '@/utils/message-queue';

interface UseSessionAutosaveProps {
	messages: Message[];
	currentProvider: string;
	currentModel: string;
	currentSessionId: string | null;
	setCurrentSessionId: (id: string | null) => void;
}

/**
 * Hook to handle automatic session saving.
 * Updates the current session when currentSessionId is set; otherwise creates a new session.
 * Clears currentSessionId when messages are cleared.
 */
export function useSessionAutosave({
	messages,
	currentProvider,
	currentModel,
	currentSessionId,
	setCurrentSessionId,
}: UseSessionAutosaveProps) {
	const initPromiseRef = useRef<Promise<boolean> | null>(null);
	const timeoutRef = useRef<NodeJS.Timeout | null>(null);
	const lastSaveRef = useRef<number>(0);

	// Clear current session when conversation is cleared
	useEffect(() => {
		if (messages.length === 0 && currentSessionId !== null) {
			setCurrentSessionId(null);
		}
	}, [messages.length, currentSessionId, setCurrentSessionId]);

	// Initialize session manager only when autosave is enabled (avoids creating
	// sessions dir/index and running retention when user has autosave off).
	// /resume initializes the manager when the user explicitly runs it.
	useEffect(() => {
		const config = getAppConfig();
		const autoSave = config.sessions?.autoSave ?? true;
		if (!autoSave) {
			return;
		}

		if (!initPromiseRef.current) {
			initPromiseRef.current = sessionManager
				.initialize()
				.then(() => true)
				.catch(error => {
					logWarning(
						`Session autosave disabled: failed to initialize session storage. ${error instanceof Error ? error.message : String(error)}`,
					);
					return false;
				});
		}

		return () => {
			if (timeoutRef.current) {
				clearTimeout(timeoutRef.current);
			}
		};
	}, []);

	// Auto-save when messages change (debounced by saveInterval)
	useEffect(() => {
		const config = getAppConfig();
		const sessionConfig = config.sessions;
		const autoSave = sessionConfig?.autoSave ?? true;
		const saveInterval = sessionConfig?.saveInterval ?? 30000;
		const maxMessages = sessionConfig?.maxMessages ?? 1000;

		if (!autoSave || !initPromiseRef.current || messages.length === 0) {
			return;
		}

		if (timeoutRef.current) {
			clearTimeout(timeoutRef.current);
		}

		const now = Date.now();
		const timeSinceLastSave = now - lastSaveRef.current;

		const saveSession = async () => {
			try {
				// Wait for initialization to complete before saving
				const initialized = await initPromiseRef.current;
				if (!initialized) return;

				// Truncate to most recent messages to prevent unbounded session sizes
				const messagesToSave =
					messages.length > maxMessages
						? messages.slice(-maxMessages)
						: messages;

				const userMessages = messagesToSave.filter(msg => msg.role === 'user');
				const lastUserMessage = userMessages[userMessages.length - 1];
				const title = lastUserMessage
					? lastUserMessage.content.substring(0, 50) +
						(lastUserMessage.content.length > 50 ? '...' : '')
					: `Session ${new Date().toLocaleDateString()}`;

				if (currentSessionId) {
					const session = await sessionManager.readSession(currentSessionId);
					if (session) {
						session.messages = messagesToSave;
						session.messageCount = messagesToSave.length;
						session.title = title;
						session.provider = currentProvider;
						session.model = currentModel;
						// Don't set lastAccessedAt here — saveSession() handles
						// the timestamp in both the file and index consistently.
						await sessionManager.saveSession(session);
					} else {
						const newSession = await sessionManager.createSession({
							title,
							messageCount: messagesToSave.length,
							provider: currentProvider,
							model: currentModel,
							workingDirectory: process.cwd(),
							messages: messagesToSave,
						});
						setCurrentSessionId(newSession.id);
					}
				} else {
					const newSession = await sessionManager.createSession({
						title,
						messageCount: messagesToSave.length,
						provider: currentProvider,
						model: currentModel,
						workingDirectory: process.cwd(),
						messages: messagesToSave,
					});
					setCurrentSessionId(newSession.id);
				}

				lastSaveRef.current = Date.now();
			} catch (error) {
				console.warn('Failed to auto-save session:', error);
			}
		};

		if (timeSinceLastSave >= saveInterval) {
			void saveSession();
		} else {
			const delay = saveInterval - timeSinceLastSave;
			timeoutRef.current = setTimeout(() => {
				void saveSession();
			}, delay);
		}
	}, [
		messages,
		currentProvider,
		currentModel,
		currentSessionId,
		setCurrentSessionId,
	]);
}
