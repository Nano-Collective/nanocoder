import {useEffect, useRef} from 'react';
import {getAppConfig} from '@/config/index';
import {sessionManager} from '@/session/session-manager';
import type {Message} from '@/types/core';

interface UseSessionAutosaveProps {
	messages: Message[];
	currentProvider: string;
	currentModel: string;
}

/**
 * Hook to handle automatic session saving
 * Saves the current conversation session periodically
 */
export function useSessionAutosave({
	messages,
	currentProvider,
	currentModel,
}: UseSessionAutosaveProps) {
	const initializedRef = useRef(false);
	const timeoutRef = useRef<NodeJS.Timeout | null>(null);
	const lastSaveRef = useRef<number>(0);

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

		// Cleanup timeout on unmount
		return () => {
			if (timeoutRef.current) {
				clearTimeout(timeoutRef.current);
			}
		};
	}, []);

	// Auto-save when messages change
	useEffect(() => {
		const config = getAppConfig();
		const sessionConfig = config.sessions;
		const autoSave = sessionConfig?.autoSave ?? true;
		const saveInterval = sessionConfig?.saveInterval ?? 30000; // 30 seconds default

		if (!autoSave || !initializedRef.current || messages.length === 0) {
			return;
		}

		// Clear existing timeout
		if (timeoutRef.current) {
			clearTimeout(timeoutRef.current);
		}

		// Throttle saves to respect saveInterval
		const now = Date.now();
		const timeSinceLastSave = now - lastSaveRef.current;

		const saveSession = async () => {
			try {
				// Generate title from first user message or fallback
				const firstUserMessage = messages.find(msg => msg.role === 'user');
				const title = firstUserMessage
					? firstUserMessage.content.substring(0, 50) +
						(firstUserMessage.content.length > 50 ? '...' : '')
					: `Session ${new Date().toLocaleDateString()}`;

				await sessionManager.createSession({
					title,
					messageCount: messages.length,
					provider: currentProvider,
					model: currentModel,
					workingDirectory: process.cwd(),
					messages,
				});

				lastSaveRef.current = Date.now();
			} catch (error) {
				// Silently fail autosave - don't interrupt user experience
				console.warn('Failed to auto-save session:', error);
			}
		};

		if (timeSinceLastSave >= saveInterval) {
			// Save immediately if enough time has passed
			void saveSession();
		} else {
			// Schedule save for later
			const delay = saveInterval - timeSinceLastSave;
			timeoutRef.current = setTimeout(() => {
				void saveSession();
			}, delay);
		}
	}, [messages, currentProvider, currentModel]);
}
