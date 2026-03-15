import React from 'react';
import {isNonInteractiveModeComplete} from '@/app/helpers';
import type {NonInteractiveModeState} from '@/app/types';
import {TIMEOUT_EXECUTION_MAX_MS, TIMEOUT_OUTPUT_FLUSH_MS} from '@/constants';
import {setCurrentMode as setCurrentModeContext} from '@/context/mode-context';
import type {DevelopmentMode, LLMClient} from '@/types';
import {getLogger} from '@/utils/logging';
import {getShutdownManager} from '@/utils/shutdown';

interface UseNonInteractiveModeProps {
	nonInteractivePrompt?: string;
	nonInteractiveMode: boolean;
	mcpInitialized: boolean;
	client: LLMClient | null;
	appState: NonInteractiveModeState;
	setDevelopmentMode: (mode: DevelopmentMode) => void;
	handleMessageSubmit: (message: string) => Promise<void>;
}

export interface NonInteractiveModeResult {
	nonInteractiveSubmitted: boolean;
	nonInteractiveLoadingMessage: string | null;
}

// Buffer factor ensures we allow enough time for the provider response plus overhead
// Doubling is used because provider timeouts often refer to individual request segments
// or initial socket connection, while this execution timeout covers the entire
// multi-step process including output flushing and initial setup.
const TIMEOUT_BUFFER_FACTOR = 2;

/**
 * Calculates the effective timeout based on provider configuration.
 *
 * @param client - The LLM client which may have provider-level timeouts
 * @returns Final timeout in milliseconds
 */
export function calculateEffectiveTimeout(client: LLMClient | null): number {
	let effectiveTimeout = TIMEOUT_EXECUTION_MAX_MS;

	if (client) {
		const configuredTimeout = client.getTimeout();

		if (configuredTimeout === -1) {
			// -1 means no timeout
			effectiveTimeout = Number.MAX_SAFE_INTEGER;
		} else if (configuredTimeout !== undefined) {
			// If the provider timeout is longer than the default 5 mins,
			// we should allow it to run for at least that long with a safety buffer.
			// We use a buffer because the overall execution includes overhead beyond
			// the raw provider request time.
			effectiveTimeout = Math.max(
				TIMEOUT_EXECUTION_MAX_MS,
				configuredTimeout * TIMEOUT_BUFFER_FACTOR,
			);
		}
	}

	return effectiveTimeout;
}

/**
 * Handles non-interactive mode logic:
 * - Automatically submits prompt when ready
 * - Sets auto-accept mode
 * - Monitors completion and exits when done
 */
export function useNonInteractiveMode({
	nonInteractivePrompt,
	mcpInitialized,
	client,
	appState,
	setDevelopmentMode,
	handleMessageSubmit,
}: UseNonInteractiveModeProps): NonInteractiveModeResult {
	const [nonInteractiveSubmitted, setNonInteractiveSubmitted] =
		React.useState(false);
	const [startTime] = React.useState(Date.now());

	// Auto-submit prompt when ready
	React.useEffect(() => {
		if (
			nonInteractivePrompt &&
			mcpInitialized &&
			client &&
			!nonInteractiveSubmitted
		) {
			setNonInteractiveSubmitted(true);
			// Set auto-accept mode for non-interactive execution
			// Sync both React state AND global context synchronously
			// to prevent race conditions where tools check global context
			// before the useEffect in App.tsx has a chance to sync it
			setDevelopmentMode('auto-accept');
			setCurrentModeContext('auto-accept');
			// Submit the prompt
			void handleMessageSubmit(nonInteractivePrompt);
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [
		nonInteractivePrompt,
		mcpInitialized,
		client,
		nonInteractiveSubmitted,
		handleMessageSubmit,
		setDevelopmentMode,
	]);

	// Exit when processing is complete
	React.useEffect(() => {
		if (nonInteractivePrompt && nonInteractiveSubmitted) {
			// Calculate timeout based on provider config if available
			const effectiveTimeout = calculateEffectiveTimeout(client);

			const {shouldExit, reason} = isNonInteractiveModeComplete(
				appState,
				startTime,
				effectiveTimeout,
			);

			if (shouldExit) {
				const logger = getLogger();
				if (reason === 'timeout') {
					logger.error('Non-interactive mode timed out');
				} else if (reason === 'error') {
					logger.error('Non-interactive mode encountered errors');
				} else if (reason === 'tool-approval') {
					// Exit with error code when tool approval is required
					// Error message already printed by useChatHandler
				}
				// Wait a bit to ensure all output is flushed
				const code = reason === 'error' || reason === 'tool-approval' ? 1 : 0;
				const timer = setTimeout(() => {
					void getShutdownManager().gracefulShutdown(code);
				}, TIMEOUT_OUTPUT_FLUSH_MS);

				return () => clearTimeout(timer);
			}
		}
	}, [
		nonInteractivePrompt,
		nonInteractiveSubmitted,
		appState,
		startTime,
		client,
	]);

	// Compute loading message
	const nonInteractiveLoadingMessage = React.useMemo(() => {
		if (!nonInteractivePrompt) {
			return null;
		}

		// Don't show loading message when conversation is complete (about to exit)
		if (appState.isConversationComplete) {
			return null;
		}

		if (!mcpInitialized || !client) {
			return 'Waiting for MCP servers...';
		}

		const pendingToolCallCount = 0; // This would need to be passed if available

		if (
			appState.isToolExecuting ||
			appState.isToolConfirmationMode ||
			pendingToolCallCount > 0
		) {
			return 'Waiting for tooling...';
		}

		return 'Waiting for chat to complete...';
	}, [
		nonInteractivePrompt,
		appState.isConversationComplete,
		mcpInitialized,
		client,
		appState.isToolExecuting,
		appState.isToolConfirmationMode,
	]);

	return {
		nonInteractiveSubmitted,
		nonInteractiveLoadingMessage,
	};
}
