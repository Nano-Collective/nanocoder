import {useEffect} from 'react';
import type {ToolManager} from '@/tools/tool-manager';
import type {LLMClient, MCPConnectionStatus} from '@/types/core';
import type {UpdateInfo} from '@/types/utils';
import {
	generateCorrelationId,
	withNewCorrelationContext,
} from '@/utils/logging';
import type {Logger} from '@/utils/logging/types';

interface UseAppLoggingProps {
	logger: Logger;
	vscodeMode: boolean;
	vscodePort: number | undefined;
	developmentMode: string;
	client: LLMClient | null;
	currentProvider: string;
	currentModel: string;
	toolManager: ToolManager | null;
	mcpInitialized: boolean;
	mcpServersStatus: MCPConnectionStatus[] | undefined;
	updateInfo: UpdateInfo | null;
	activeMode: string | null;
	isToolExecuting: boolean;
	isToolConfirmationMode: boolean;
	pendingToolCallsLength: number;
	isGenerating: boolean;
}

/**
 * Side-effect-only hook that emits structured log events as App.tsx state
 * changes. Splits the noisy logging out of App.tsx so the orchestrator stays
 * focused on render/state composition.
 */
export function useAppLogging({
	logger,
	vscodeMode,
	vscodePort,
	developmentMode,
	client,
	currentProvider,
	currentModel,
	toolManager,
	mcpInitialized,
	mcpServersStatus,
	updateInfo,
	activeMode,
	isToolExecuting,
	isToolConfirmationMode,
	pendingToolCallsLength,
	isGenerating,
}: UseAppLoggingProps): void {
	// Application startup
	useEffect(() => {
		logger.info('Nanocoder application starting', {
			vscodeMode,
			vscodePort,
			nodeEnv: process.env.NODE_ENV || 'development',
			platform: process.platform,
			pid: process.pid,
		});
	}, [logger, vscodeMode, vscodePort]);

	// Development mode changes
	useEffect(() => {
		logger.info('Development mode changed', {
			newMode: developmentMode,
			previousMode: undefined,
		});
	}, [developmentMode, logger]);

	// LLM client init
	useEffect(() => {
		if (client) {
			logger.info('AI client initialized', {
				provider: currentProvider,
				model: currentModel,
				hasToolManager: !!toolManager,
			});
		}
	}, [client, currentProvider, currentModel, toolManager, logger]);

	// MCP servers init
	useEffect(() => {
		if (mcpInitialized) {
			logger.info('MCP servers initialized', {
				serverCount: mcpServersStatus?.length || 0,
				status: 'connected',
			});
		}
	}, [mcpInitialized, mcpServersStatus, logger]);

	// Update info available
	useEffect(() => {
		if (updateInfo) {
			logger.info('Update information available', {
				hasUpdate: updateInfo.hasUpdate,
				currentVersion: updateInfo.currentVersion,
				latestVersion: updateInfo.latestVersion,
			});
		}
	}, [updateInfo, logger]);

	// Application interface ready
	useEffect(() => {
		if (
			mcpInitialized &&
			client &&
			!isToolExecuting &&
			!isToolConfirmationMode &&
			activeMode !== 'configWizard' &&
			activeMode !== 'mcpWizard' &&
			pendingToolCallsLength === 0
		) {
			const correlationId = generateCorrelationId();

			withNewCorrelationContext(() => {
				logger.info('Application interface ready for user interaction', {
					correlationId,
					interfaceState: {
						developmentMode,
						hasPendingToolCalls: pendingToolCallsLength > 0,
						clientInitialized: !!client,
						mcpServersConnected: mcpInitialized,
						inputDisabled: isGenerating || isToolExecuting,
					},
				});
			}, correlationId);
		}
	}, [
		mcpInitialized,
		client,
		isToolExecuting,
		isToolConfirmationMode,
		activeMode,
		pendingToolCallsLength,
		logger,
		developmentMode,
		isGenerating,
	]);
}
