import {Box, Text, useInput} from 'ink';
import SelectInput from 'ink-select-input';
import Spinner from 'ink-spinner';
import {useEffect, useRef, useState} from 'react';
import TextInput from '@/components/text-input';
import {getColors} from '@/config/index';
import {useResponsiveTerminal} from '@/hooks/useTerminalWidth';
import type {ProviderConfig} from '../../types/config';
import {
	PROVIDER_TEMPLATES,
	type ProviderTemplate,
} from '../templates/provider-templates';
import {
	type ApiCompatibility,
	type FetchedModel,
	fetchModels,
} from '../utils/fetch-models';

interface ProviderStepProps {
	onComplete: (providers: ProviderConfig[]) => void;
	onBack?: () => void;
	onDelete?: () => void;
	existingProviders?: ProviderConfig[];
	configExists?: boolean;
}

type Mode =
	| 'select-template-or-custom'
	| 'template-selection'
	| 'edit-selection'
	| 'edit-or-delete'
	| 'field-input'
	| 'fetching-models'
	| 'model-selection'
	| 'done';

interface TemplateOption {
	label: string;
	value: string;
}

/**
 * Find the best matching template for an existing provider config.
 * Match by id, name, or baseUrl — then fall back to custom.
 */
export function findTemplateForProvider(
	provider: ProviderConfig,
): ProviderTemplate | undefined {
	// Match by template id or name
	const byId = PROVIDER_TEMPLATES.find(t => t.id === provider.name);
	if (byId) return byId;
	const byName = PROVIDER_TEMPLATES.find(t => t.name === provider.name);
	if (byName) return byName;

	// Match by baseUrl — each non-custom template has a unique hardcoded baseUrl
	if (provider.baseUrl) {
		for (const template of PROVIDER_TEMPLATES) {
			if (template.id === 'custom') continue;
			try {
				const config = template.buildConfig({
					providerName: '_',
					model: '_',
					apiKey: '_',
					baseUrl: '_',
				});
				if (config.baseUrl === provider.baseUrl) return template;
			} catch {
				// Skip templates that fail with placeholder data
			}
		}
	}

	return PROVIDER_TEMPLATES.find(t => t.id === 'custom');
}

export function ProviderStep({
	onComplete,
	onBack,
	onDelete,
	existingProviders = [],
	configExists = false,
}: ProviderStepProps) {
	const colors = getColors();
	const {isNarrow} = useResponsiveTerminal();
	const [providers, setProviders] =
		useState<ProviderConfig[]>(existingProviders);

	// Update providers when existingProviders prop changes
	useEffect(() => {
		setProviders(existingProviders);
	}, [existingProviders]);

	const [mode, setMode] = useState<Mode>('select-template-or-custom');
	const [selectedTemplate, setSelectedTemplate] =
		useState<ProviderTemplate | null>(null);
	const [currentFieldIndex, setCurrentFieldIndex] = useState(0);
	const [fieldAnswers, setFieldAnswers] = useState<Record<string, string>>({});
	const [currentValue, setCurrentValue] = useState('');
	const [error, setError] = useState<string | null>(null);
	const [inputKey, setInputKey] = useState(0);
	const [cameFromCustom, setCameFromCustom] = useState(false);
	const [editingIndex, setEditingIndex] = useState<number | null>(null);
	const [fetchedModels, setFetchedModels] = useState<FetchedModel[]>([]);
	const [selectedModelIds, setSelectedModelIds] = useState<Set<string>>(
		new Set(),
	);

	// Ref to track if component is mounted (prevents setState after unmount)
	const isMountedRef = useRef(true);

	// Track mount status and cleanup on unmount
	useEffect(() => {
		isMountedRef.current = true;
		return () => {
			isMountedRef.current = false;
		};
	}, []);

	// Clear model-related state when template changes (prevents stale data leaking)
	// Note: We intentionally depend on selectedTemplate to trigger cleanup on template change
	useEffect(() => {
		// Only clear if we have a template (avoid clearing on initial mount with null)
		if (selectedTemplate !== null) {
			setFetchedModels([]);
			setSelectedModelIds(new Set());
		}
	}, [selectedTemplate]);

	const initialOptions =
		providers.length > 0
			? [
					{label: 'Add another provider', value: 'templates'},
					{label: 'Edit existing providers', value: 'edit'},
					{label: 'Done & Save', value: 'done'},
					...(configExists && onDelete
						? [{label: 'Delete config file', value: 'delete'}]
						: []),
				]
			: [
					{label: 'Choose from common templates', value: 'templates'},
					{label: 'Add custom provider manually', value: 'custom'},
				];

	const getTemplateOptions = (): TemplateOption[] => [
		...PROVIDER_TEMPLATES.map(template => ({
			label: template.name,
			value: template.id,
		})),
		...(providers.length > 0 ? [{label: 'Done & Save', value: 'done'}] : []),
	];

	const editOptions: TemplateOption[] = providers.map((provider, index) => ({
		label: provider.name,
		value: `edit-${index}`,
	}));

	const handleInitialSelect = (item: {value: string}) => {
		if (item.value === 'templates') {
			setMode('template-selection');
			setCameFromCustom(false);
		} else if (item.value === 'custom') {
			// Find custom template
			const customTemplate = PROVIDER_TEMPLATES.find(t => t.id === 'custom');
			if (customTemplate) {
				setSelectedTemplate(customTemplate);
				setCurrentFieldIndex(0);
				setFieldAnswers({});
				setCurrentValue('');
				setMode('field-input');
				setCameFromCustom(true);
			}
		} else if (item.value === 'edit') {
			setMode('edit-selection');
		} else if (item.value === 'done') {
			onComplete(providers);
		} else if (item.value === 'delete' && onDelete) {
			onDelete();
		}
	};

	const handleTemplateSelect = (item: TemplateOption) => {
		if (item.value === 'done') {
			onComplete(providers);
			return;
		}

		// Adding new provider
		const template = PROVIDER_TEMPLATES.find(t => t.id === item.value);
		if (template) {
			setEditingIndex(null); // Not editing
			setSelectedTemplate(template);
			setCurrentFieldIndex(0);
			setFieldAnswers({});
			setCurrentValue(template.fields[0]?.default || '');
			setError(null);
			setMode('field-input');
			setCameFromCustom(false);
		}
	};

	const handleEditSelect = (item: TemplateOption) => {
		if (item.value.startsWith('edit-')) {
			const index = Number.parseInt(item.value.replace('edit-', ''), 10);
			setEditingIndex(index);
			setMode('edit-or-delete');
		}
	};

	const handleEditOrDeleteChoice = (item: {value: string}) => {
		if (item.value === 'delete' && editingIndex !== null) {
			const newProviders = providers.filter((_, i) => i !== editingIndex);
			setProviders(newProviders);
			setEditingIndex(null);
			setMode('select-template-or-custom');
			return;
		}

		if (item.value === 'edit' && editingIndex !== null) {
			const provider = providers[editingIndex];
			if (provider) {
				const template = findTemplateForProvider(provider);

				if (template) {
					setSelectedTemplate(template);
					setCurrentFieldIndex(0);

					const answers: Record<string, string> = {};
					if (provider.name) answers.providerName = provider.name;
					if (provider.baseUrl) answers.baseUrl = provider.baseUrl;
					if (provider.apiKey) answers.apiKey = provider.apiKey;
					if (provider.models) answers.model = provider.models.join(', ');

					setFieldAnswers(answers);
					setCurrentValue(
						answers[template.fields[0]?.name] ||
							template.fields[0]?.default ||
							'',
					);
					setError(null);
					setMode('field-input');
					setCameFromCustom(false);
				}
			}
		}
	};

	const handleFieldSubmit = () => {
		if (!selectedTemplate) return;

		const currentField = selectedTemplate.fields[currentFieldIndex];
		if (!currentField) return;

		// Validate required fields
		if (currentField.required && !currentValue.trim()) {
			setError('This field is required');
			return;
		}

		// Validate duplicate provider names
		if (currentField.name === 'providerName' && currentValue.trim()) {
			const nameLower = currentValue.trim().toLowerCase();
			const isDuplicate = providers.some(
				(p, i) => p.name.toLowerCase() === nameLower && i !== editingIndex,
			);
			if (isDuplicate) {
				setError(`A provider named '${currentValue.trim()}' already exists`);
				return;
			}
		}

		// Validate with custom validator
		if (currentField.validator && currentValue.trim()) {
			const validationError = currentField.validator(currentValue);
			if (validationError) {
				setError(validationError);
				return;
			}
		}

		// Save answer
		const newAnswers = {
			...fieldAnswers,
			[currentField.name]: currentValue.trim(),
		};
		setFieldAnswers(newAnswers);
		setError(null);

		// Move to next field or complete
		if (currentFieldIndex < selectedTemplate.fields.length - 1) {
			const nextField = selectedTemplate.fields[currentFieldIndex + 1];

			// Auto-fetch models when we reach the model field
			if (nextField?.name === 'model') {
				handleFetchModels(newAnswers);
				return;
			}

			setCurrentFieldIndex(currentFieldIndex + 1);
			setCurrentValue(newAnswers[nextField?.name] || nextField?.default || '');
		} else {
			// Validate models array is not empty before building config
			const modelsValue = newAnswers.model || '';
			const modelsArray = modelsValue
				.split(',')
				.map(m => m.trim())
				.filter(Boolean);
			if (modelsArray.length === 0) {
				setError('At least one model name is required');
				return;
			}

			// Build config and add/update provider
			try {
				const providerConfig = selectedTemplate.buildConfig(newAnswers);

				if (editingIndex !== null) {
					// Replace existing provider
					const newProviders = [...providers];
					newProviders[editingIndex] = providerConfig;
					setProviders(newProviders);
				} else {
					// Add new provider
					setProviders([...providers, providerConfig]);
				}

				// Reset and go back to appropriate screen
				const wasEditing = editingIndex !== null;
				setSelectedTemplate(null);
				setCurrentFieldIndex(0);
				setFieldAnswers({});
				setCurrentValue('');
				setEditingIndex(null);
				setMode(
					wasEditing ? 'select-template-or-custom' : 'template-selection',
				);
			} catch (err) {
				setError(
					err instanceof Error ? err.message : 'Failed to build configuration',
				);
			}
		}
	};

	const goToManualModelInput = (answers: Record<string, string>) => {
		const modelFieldIndex = selectedTemplate?.fields.findIndex(
			f => f.name === 'model',
		);
		if (modelFieldIndex !== undefined && modelFieldIndex >= 0) {
			setCurrentFieldIndex(modelFieldIndex);
			const modelField = selectedTemplate?.fields[modelFieldIndex];
			setCurrentValue(
				answers[modelField?.name || ''] || modelField?.default || '',
			);
			setMode('field-input');
		}
	};

	const handleFetchModels = async (answers: Record<string, string>) => {
		if (!selectedTemplate) return;

		// Build a partial config to get the baseUrl, apiKey, and sdkProvider
		const partialConfig = selectedTemplate.buildConfig({
			...answers,
			model: '_',
		});
		const baseUrl = partialConfig.baseUrl;
		const apiKey = partialConfig.apiKey;
		const sdkProvider = partialConfig.sdkProvider;

		// Skip fetch for providers requiring special auth flows
		if (
			!baseUrl ||
			sdkProvider === 'github-copilot' ||
			sdkProvider === 'chatgpt-codex'
		) {
			goToManualModelInput(answers);
			return;
		}

		// Determine API compatibility from sdkProvider or template id
		let apiCompatibility: ApiCompatibility = 'openai-compatible';
		if (selectedTemplate.id === 'ollama') {
			apiCompatibility = 'ollama';
		} else if (sdkProvider === 'anthropic') {
			apiCompatibility = 'anthropic';
		} else if (sdkProvider === 'google') {
			apiCompatibility = 'google';
		}

		setMode('fetching-models');

		try {
			const result = await fetchModels(baseUrl, apiCompatibility, apiKey);

			if (!isMountedRef.current) return;

			if (result.success && result.models.length > 0) {
				setFetchedModels(result.models);
				setSelectedModelIds(new Set());
				setMode('model-selection');
				return;
			}
		} catch {
			// Silent failure
		}

		if (!isMountedRef.current) return;
		goToManualModelInput(answers);
	};

	const handleModelToggle = (modelId: string) => {
		setSelectedModelIds(prev => {
			const newSet = new Set(prev);
			if (newSet.has(modelId)) {
				newSet.delete(modelId);
			} else {
				newSet.add(modelId);
			}
			return newSet;
		});
	};

	const handleSelectAllModels = () => {
		setSelectedModelIds(prev => {
			if (prev.size === fetchedModels.length) {
				// Deselect all
				return new Set();
			} else {
				// Select all
				return new Set(fetchedModels.map(m => m.id));
			}
		});
	};

	const handleModelSelectionComplete = () => {
		if (selectedModelIds.size === 0) {
			setError('Please select at least one model');
			return;
		}

		// Save selected models to fieldAnswers
		const selectedModels = Array.from(selectedModelIds).join(', ');
		const newAnswers: Record<string, string> = {
			...fieldAnswers,
			model: selectedModels,
		};
		setFieldAnswers(newAnswers);
		setError(null);

		// Find the model field index and continue to the next field or complete
		if (!selectedTemplate) return;

		const modelFieldIndex = selectedTemplate.fields.findIndex(
			f => f.name === 'model',
		);

		if (modelFieldIndex < selectedTemplate.fields.length - 1) {
			// There are more fields after model
			setCurrentFieldIndex(modelFieldIndex + 1);
			const nextField = selectedTemplate.fields[modelFieldIndex + 1];
			setCurrentValue(newAnswers[nextField?.name] || nextField?.default || '');
			setMode('field-input');
		} else {
			// Model was the last field - build config
			try {
				const providerConfig = selectedTemplate.buildConfig(newAnswers);

				if (editingIndex !== null) {
					const newProviders = [...providers];
					newProviders[editingIndex] = providerConfig;
					setProviders(newProviders);
				} else {
					setProviders([...providers, providerConfig]);
				}

				// Reset and go back to appropriate screen
				const wasEditing = editingIndex !== null;
				setSelectedTemplate(null);
				setCurrentFieldIndex(0);
				setFieldAnswers({});
				setCurrentValue('');
				setEditingIndex(null);
				setFetchedModels([]);
				setSelectedModelIds(new Set());
				setMode(
					wasEditing ? 'select-template-or-custom' : 'template-selection',
				);
			} catch (err) {
				setError(
					err instanceof Error ? err.message : 'Failed to build configuration',
				);
			}
		}
	};

	useInput((_input, key) => {
		// Handle Shift+Tab for going back
		if (key.shift && key.tab) {
			if (mode === 'field-input') {
				// In field input mode, check if we can go back to previous field
				if (currentFieldIndex > 0) {
					// Go back to previous field
					setCurrentFieldIndex(currentFieldIndex - 1);
					const prevField = selectedTemplate?.fields[currentFieldIndex - 1];
					setCurrentValue(
						fieldAnswers[prevField?.name || ''] || prevField?.default || '',
					);
					setInputKey(prev => prev + 1); // Force remount to reset cursor position
					setError(null);
				} else {
					// At first field, go back based on where we came from
					if (editingIndex !== null) {
						// Was editing, go back to edit-or-delete choice
						setMode('edit-or-delete');
					} else if (cameFromCustom) {
						// Came from custom selection, go back to initial choice
						setMode('select-template-or-custom');
					} else {
						// Came from template selection, go back there
						setMode('template-selection');
					}
					setSelectedTemplate(null);
					setCurrentFieldIndex(0);
					setFieldAnswers({});
					setCurrentValue('');
					setError(null);
				}
			} else if (mode === 'template-selection') {
				// In template selection, go back to initial choice
				setMode('select-template-or-custom');
			} else if (mode === 'edit-or-delete') {
				// In edit-or-delete, go back to edit selection
				setEditingIndex(null);
				setMode('edit-selection');
			} else if (mode === 'edit-selection') {
				// In edit selection, go back to initial choice
				setMode('select-template-or-custom');
			} else if (mode === 'model-selection') {
				// Go back to the field before the model field
				const modelFieldIndex = selectedTemplate?.fields.findIndex(
					f => f.name === 'model',
				);
				const prevIndex =
					modelFieldIndex !== undefined && modelFieldIndex > 0
						? modelFieldIndex - 1
						: 0;
				setCurrentFieldIndex(prevIndex);
				const prevField = selectedTemplate?.fields[prevIndex];
				setCurrentValue(
					fieldAnswers[prevField?.name || ''] || prevField?.default || '',
				);
				setFetchedModels([]);
				setSelectedModelIds(new Set());
				setError(null);
				setMode('field-input');
			} else if (mode === 'select-template-or-custom') {
				// At root level, call parent's onBack
				if (onBack) {
					onBack();
				}
			}
			return;
		}

		if (mode === 'field-input') {
			if (key.return) {
				handleFieldSubmit();
			} else if (key.escape) {
				// Go back to template selection
				setMode('template-selection');
				setSelectedTemplate(null);
				setCurrentFieldIndex(0);
				setFieldAnswers({});
				setCurrentValue('');
				setError(null);
			}
		}

		if (mode === 'model-selection') {
			if (key.escape) {
				setFetchedModels([]);
				setSelectedModelIds(new Set());
				setError(null);
				// Go back to the field before the model field
				const modelFieldIndex = selectedTemplate?.fields.findIndex(
					f => f.name === 'model',
				);
				const prevIndex =
					modelFieldIndex !== undefined && modelFieldIndex > 0
						? modelFieldIndex - 1
						: 0;
				setCurrentFieldIndex(prevIndex);
				const prevField = selectedTemplate?.fields[prevIndex];
				setCurrentValue(
					fieldAnswers[prevField?.name || ''] || prevField?.default || '',
				);
				setMode('field-input');
			}
		}
	});

	if (mode === 'select-template-or-custom') {
		return (
			<Box flexDirection="column">
				<Box marginBottom={1}>
					<Text bold color={colors.primary}>
						Let's add AI providers. Would you like to use a template?
					</Text>
				</Box>
				{providers.length > 0 && (
					<Box marginBottom={1}>
						<Text color={colors.success}>
							{providers.length} provider(s) already added
						</Text>
					</Box>
				)}
				<SelectInput
					items={initialOptions}
					onSelect={(item: {value: string}) => handleInitialSelect(item)}
				/>
			</Box>
		);
	}

	if (mode === 'template-selection') {
		return (
			<Box flexDirection="column">
				<Box marginBottom={1}>
					<Text bold color={colors.primary}>
						Choose a provider template:
					</Text>
				</Box>
				{providers.length > 0 && (
					<Box marginBottom={1}>
						<Text color={colors.success}>
							Added: {providers.map(p => p.name).join(', ')}
						</Text>
					</Box>
				)}
				<SelectInput
					items={getTemplateOptions()}
					onSelect={(item: TemplateOption) => handleTemplateSelect(item)}
				/>
			</Box>
		);
	}

	if (mode === 'edit-selection') {
		return (
			<Box flexDirection="column">
				<Box marginBottom={1}>
					<Text bold color={colors.primary}>
						Select a provider to edit:
					</Text>
				</Box>
				<SelectInput
					items={editOptions}
					onSelect={(item: TemplateOption) => handleEditSelect(item)}
				/>
			</Box>
		);
	}

	if (mode === 'edit-or-delete') {
		const provider = editingIndex !== null ? providers[editingIndex] : null;
		const editOrDeleteOptions = [
			{label: 'Edit this provider', value: 'edit'},
			{label: 'Delete this provider', value: 'delete'},
		];

		return (
			<Box flexDirection="column">
				<Box marginBottom={1}>
					<Text bold color={colors.primary}>
						{provider?.name} - What would you like to do?
					</Text>
				</Box>
				<SelectInput
					items={editOrDeleteOptions}
					onSelect={(item: {value: string}) => handleEditOrDeleteChoice(item)}
				/>
			</Box>
		);
	}

	if (mode === 'field-input' && selectedTemplate) {
		const currentField = selectedTemplate.fields[currentFieldIndex];
		if (!currentField) return null;

		return (
			<Box flexDirection="column">
				<Box marginBottom={1}>
					<Text bold color={colors.primary}>
						{selectedTemplate.name} Configuration
					</Text>
					<Text>
						{' '}
						(Field {currentFieldIndex + 1}/{selectedTemplate.fields.length})
					</Text>
				</Box>

				<Box>
					<Text>
						{currentField.prompt}
						{currentField.required && <Text color={colors.error}> *</Text>}:{' '}
						{currentField.sensitive && '****'}
					</Text>
				</Box>

				{!currentField.sensitive && (
					<Box
						marginBottom={1}
						borderStyle="round"
						borderColor={colors.secondary}
					>
						<TextInput
							key={inputKey}
							value={currentValue}
							onChange={setCurrentValue}
							onSubmit={handleFieldSubmit}
						/>
					</Box>
				)}

				{currentField.sensitive && (
					<Box
						marginBottom={1}
						borderStyle="round"
						borderColor={colors.secondary}
					>
						<TextInput
							key={inputKey}
							value={currentValue}
							onChange={setCurrentValue}
							onSubmit={handleFieldSubmit}
							mask="*"
						/>
					</Box>
				)}

				{error && (
					<Box marginBottom={1}>
						<Text color={colors.error}>{error}</Text>
					</Box>
				)}

				{isNarrow ? (
					<Box flexDirection="column">
						<Text color={colors.secondary}>Enter: continue</Text>
						<Text color={colors.secondary}>Shift+Tab: go back</Text>
					</Box>
				) : (
					<Box>
						<Text color={colors.secondary}>
							Press Enter to continue | Shift+Tab to go back
						</Text>
					</Box>
				)}
			</Box>
		);
	}

	if (mode === 'fetching-models' && selectedTemplate) {
		return (
			<Box flexDirection="column">
				<Box marginBottom={1}>
					<Text bold color={colors.primary}>
						{selectedTemplate.name} Configuration
					</Text>
				</Box>
				<Box>
					<Text color={colors.info}>
						<Spinner type="dots" /> Fetching models from{' '}
						{fieldAnswers.baseUrl || selectedTemplate.name}...
					</Text>
				</Box>
			</Box>
		);
	}

	if (mode === 'model-selection' && selectedTemplate) {
		const allSelected = selectedModelIds.size === fetchedModels.length;
		const modelOptions = [
			{
				// Show checked when all selected, unchecked when not - matches visual state
				label: allSelected
					? '[✓] All selected (toggle to deselect)'
					: '[ ] Select All',
				value: '__select_all__',
			},
			...fetchedModels.map(m => ({
				label: `${selectedModelIds.has(m.id) ? '[✓]' : '[ ]'} ${m.name}`,
				value: m.id,
			})),
			{label: 'Done - Continue with selected models', value: '__done__'},
		];

		return (
			<Box flexDirection="column">
				<Box marginBottom={1}>
					<Text bold color={colors.primary}>
						{selectedTemplate.name} Configuration
					</Text>
				</Box>
				<Box marginBottom={1}>
					<Text>Select models to use ({selectedModelIds.size} selected):</Text>
				</Box>
				<SelectInput
					items={modelOptions}
					onSelect={(item: {value: string}) => {
						if (item.value === '__done__') {
							handleModelSelectionComplete();
						} else if (item.value === '__select_all__') {
							handleSelectAllModels();
						} else {
							handleModelToggle(item.value);
						}
					}}
				/>
				{error && (
					<Box marginTop={1}>
						<Text color={colors.error}>{error}</Text>
					</Box>
				)}
				{isNarrow ? (
					<Box flexDirection="column" marginTop={1}>
						<Text color={colors.secondary}>Enter: toggle/continue</Text>
						<Text color={colors.secondary}>Shift+Tab: go back</Text>
					</Box>
				) : (
					<Box marginTop={1}>
						<Text color={colors.secondary}>
							Press Enter to toggle | Shift+Tab to go back
						</Text>
					</Box>
				)}
			</Box>
		);
	}

	return null;
}
