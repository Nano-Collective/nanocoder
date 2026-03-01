import {useEffect, useRef} from 'react';
import {getAppConfig} from '@/config/index';
import {sessionManager} from '@/session/session-manager';
import type {Message} from '@/types/core';

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
	const initializedRef = useRef(false);
	const timeoutRef = useRef<NodeJS.Timeout | null>(null);
	const lastSaveRef = useRef<number>(0);

	// Clear current session when conversation is cleared
	useEffect(() => {
		if (messages.length === 0 && currentSessionId !== null) {
			setCurrentSessionId(null);
		}
	}, [messages.length, currentSessionId, setCurrentSessionId]);

	// Initialize session manager
	useEffect(() => {
		const initialize = async () => {
			if (!initializedRef.current) {
				try {
					await sessionManager.initialize();
					initializedRef.current = true;
				} catch (error) {
					console.warn('Failed to initialize session manager:', error);
				}
			}
		};

		void initialize();

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

		if (!autoSave || !initializedRef.current || messages.length === 0) {
			return;
		}

		if (timeoutRef.current) {
			clearTimeout(timeoutRef.current);
		}

		const now = Date.now();
		const timeSinceLastSave = now - lastSaveRef.current;

		const saveSession = async () => {
			try {
				const firstUserMessage = messages.find(msg => msg.role === 'user');
				const title = firstUserMessage
					? firstUserMessage.content.substring(0, 50) +
						(firstUserMessage.content.length > 50 ? '...' : '')
					: `Session ${new Date().toLocaleDateString()}`;

				if (currentSessionId) {
					const session = await sessionManager.loadSession(currentSessionId);
					if (session) {
						session.messages = messages;
						session.messageCount = messages.length;
						session.title = title;
						session.provider = currentProvider;
						session.model = currentModel;
						session.lastAccessedAt = new Date().toISOString();
						await sessionManager.saveSession(session);
					} else {
						const newSession = await sessionManager.createSession({
							title,
							messageCount: messages.length,
							provider: currentProvider,
							model: currentModel,
							workingDirectory: process.cwd(),
							messages,
						});
						setCurrentSessionId(newSession.id);
					}
				} else {
					const newSession = await sessionManager.createSession({
						title,
						messageCount: messages.length,
						provider: currentProvider,
						model: currentModel,
						workingDirectory: process.cwd(),
						messages,
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
