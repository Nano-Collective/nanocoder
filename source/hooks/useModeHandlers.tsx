import {LLMClient, Message} from '@/types/core';
import {createLLMClient} from '@/client-factory';
import {
	updateLastUsed,
	savePreferences,
	loadPreferences,
} from '@/config/preferences';
import {reloadAppConfig} from '@/config/index';
import SuccessMessage from '@/components/success-message';
import ErrorMessage from '@/components/error-message';
import React from 'react';
import type {ThemePreset} from '@/types/ui';

interface UseModeHandlersProps {
	client: LLMClient | null;
	currentModel: string;
	currentProvider: string;
	currentTheme: ThemePreset;
	setClient: (client: LLMClient | null) => void;
	setCurrentModel: (model: string) => void;
	setCurrentProvider: (provider: string) => void;
	setCurrentTheme: (theme: ThemePreset) => void;
	setMessages: (messages: Message[]) => void;
	setIsModelSelectionMode: (mode: boolean) => void;
	setIsProviderSelectionMode: (mode: boolean) => void;
	setIsThemeSelectionMode: (mode: boolean) => void;
	setIsRecommendationsMode: (mode: boolean) => void;
	setIsConfigWizardMode: (mode: boolean) => void;
	setIsSessionSelectionMode: (mode: boolean) => void;
	addToChatQueue: (component: React.ReactNode) => void;
	componentKeyCounter: number;
}

export function useModeHandlers({
	client,
	currentModel,
	currentProvider,
	currentTheme: _currentTheme,
	setClient,
	setCurrentModel,
	setCurrentProvider,
	setCurrentTheme,
	setMessages,
	setIsModelSelectionMode,
	setIsProviderSelectionMode,
	setIsThemeSelectionMode,
	setIsRecommendationsMode,
	setIsConfigWizardMode,
	setIsSessionSelectionMode,
	addToChatQueue,
	componentKeyCounter,
}: UseModeHandlersProps) {
	// Helper function to enter model selection mode
	const enterModelSelectionMode = () => {
		setIsModelSelectionMode(true);
	};

	// Helper function to enter provider selection mode
	const enterProviderSelectionMode = () => {
		setIsProviderSelectionMode(true);
	};

	// Handle model selection
	const handleModelSelect = async (selectedModel: string) => {
		if (client && selectedModel !== currentModel) {
			client.setModel(selectedModel);
			setCurrentModel(selectedModel);

			// Clear message history when switching models
			setMessages([]);
			await client.clearContext();

			// Update preferences
			updateLastUsed(currentProvider, selectedModel);

			// Add success message to chat queue
			addToChatQueue(
				<SuccessMessage
					key={`model-changed-${componentKeyCounter}`}
					message={`Model changed to: ${selectedModel}. Chat history cleared.`}
					hideBox={true}
				/>,
			);
		}
		setIsModelSelectionMode(false);
	};

	// Handle model selection cancel
	const handleModelSelectionCancel = () => {
		setIsModelSelectionMode(false);
	};

	// Handle provider selection
	const handleProviderSelect = async (selectedProvider: string) => {
		if (selectedProvider !== currentProvider) {
			try {
				// Create new client for the selected provider
				const {client: newClient, actualProvider} = await createLLMClient(
					selectedProvider,
				);

				// Check if we got the provider we requested
				if (actualProvider !== selectedProvider) {
					// Provider was forced to a different one (likely due to missing config)
					addToChatQueue(
						<ErrorMessage
							key={`provider-forced-${componentKeyCounter}`}
							message={`${selectedProvider} is not available. Please ensure it's properly configured in agents.config.json.`}
							hideBox={true}
						/>,
					);
					return; // Don't change anything
				}

				setClient(newClient);
				setCurrentProvider(actualProvider);

				// Set the model from the new client
				const newModel = newClient.getCurrentModel();
				setCurrentModel(newModel);

				// Clear message history when switching providers
				setMessages([]);
				await newClient.clearContext();

				// Update preferences - use the actualProvider (which is what was successfully created)
				updateLastUsed(actualProvider, newModel);

				// Add success message to chat queue
				addToChatQueue(
					<SuccessMessage
						key={`provider-changed-${componentKeyCounter}`}
						message={`Provider changed to: ${actualProvider}, model: ${newModel}. Chat history cleared.`}
						hideBox={true}
					/>,
				);
			} catch (error) {
				// Add error message if provider change fails
				addToChatQueue(
					<ErrorMessage
						key={`provider-error-${componentKeyCounter}`}
						message={`Failed to change provider to ${selectedProvider}: ${String(
							error,
						)}`}
						hideBox={true}
					/>,
				);
			}
		}
		setIsProviderSelectionMode(false);
	};

	// Handle provider selection cancel
	const handleProviderSelectionCancel = () => {
		setIsProviderSelectionMode(false);
	};

	// Helper function to enter theme selection mode
	const enterThemeSelectionMode = () => {
		setIsThemeSelectionMode(true);
	};

	// Handle theme selection
	const handleThemeSelect = (selectedTheme: ThemePreset) => {
		const preferences = loadPreferences();
		preferences.selectedTheme = selectedTheme;
		savePreferences(preferences);

		// Update the theme state immediately for real-time switching
		setCurrentTheme(selectedTheme);

		// Add success message to chat queue
		addToChatQueue(
			<SuccessMessage
				key={`theme-changed-${componentKeyCounter}`}
				message={`Theme changed to: ${selectedTheme}.`}
				hideBox={true}
			/>,
		);

		setIsThemeSelectionMode(false);
	};

	// Handle theme selection cancel
	const handleThemeSelectionCancel = () => {
		setIsThemeSelectionMode(false);
	};

	// Helper function to enter recommendations mode
	const enterRecommendationsMode = () => {
		setIsRecommendationsMode(true);
	};

	// Handle recommendations cancel
	const handleRecommendationsCancel = () => {
		setIsRecommendationsMode(false);
	};

	// Helper function to enter config wizard mode
		const enterConfigWizardMode = () => {
			setIsConfigWizardMode(true);
		};
	
	// Helper function to enter session selection mode
	const enterSessionSelectionMode = () => {
		setIsSessionSelectionMode(true);
	};

	// Handle config wizard cancel/complete
	const handleConfigWizardComplete = async (configPath?: string) => {
		setIsConfigWizardMode(false);
		if (configPath) {
			addToChatQueue(
				<SuccessMessage
					key={`config-wizard-complete-${componentKeyCounter}`}
					message={`Configuration saved to: ${configPath}.`}
					hideBox={true}
				/>,
			);

			// Reload the app configuration to pick up the newly saved config
			reloadAppConfig();

			// Reinitialize client with new configuration
			try {
				const preferences = loadPreferences();
				const {client: newClient, actualProvider} = await createLLMClient(
					preferences.lastProvider,
				);
				setClient(newClient);
				setCurrentProvider(actualProvider);

				const newModel = newClient.getCurrentModel();
				setCurrentModel(newModel);

				// Clear message history when switching providers
				setMessages([]);
				await newClient.clearContext();

				addToChatQueue(
					<SuccessMessage
						key={`config-init-${componentKeyCounter}`}
						message={`Ready! Using provider: ${actualProvider}, model: ${newModel}`}
						hideBox={true}
					/>,
				);
			} catch (error) {
				addToChatQueue(
					<ErrorMessage
						key={`config-init-error-${componentKeyCounter}`}
						message={`Failed to initialize with new configuration: ${String(
							error,
						)}`}
						hideBox={true}
					/>,
				);
			}
		}
	};

	const handleConfigWizardCancel = () => {
		setIsConfigWizardMode(false);
	};

	return {
		enterModelSelectionMode,
		enterProviderSelectionMode,
		enterThemeSelectionMode,
		enterRecommendationsMode,
		enterConfigWizardMode,
	enterSessionSelectionMode,
		handleModelSelect,
		handleModelSelectionCancel,
		handleProviderSelect,
		handleProviderSelectionCancel,
		handleThemeSelect,
		handleThemeSelectionCancel,
		handleRecommendationsCancel,
		handleConfigWizardComplete,
		handleConfigWizardCancel,
	};
}
