import {Box, Text, useInput} from 'ink';
import SelectInput from 'ink-select-input';
import {useEffect, useState} from 'react';
import {TitledBoxWithPreferences} from '@/components/ui/titled-box';
import {useTerminalWidth} from '@/hooks/useTerminalWidth';
import {useTheme} from '@/hooks/useTheme';
import {LLMClient} from '@/types/core';

interface ModelSelectorProps {
	client: LLMClient | null;
	currentModel: string;
	onModelSelect: (model: string) => void;
	onCancel: () => void;
}

interface ModelOption {
	label: string;
	value: string;
}

export default function ModelSelector({
	client,
	currentModel,
	onModelSelect,
	onCancel,
}: ModelSelectorProps) {
	const boxWidth = useTerminalWidth();
	const {colors} = useTheme();
	const [models, setModels] = useState<ModelOption[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	// Handle escape key to cancel
	useInput((_, key) => {
		if (key.escape) {
			onCancel();
		}
	});

	useEffect(() => {
		const loadModels = async () => {
			if (!client) {
				setError('No active client found');
				setLoading(false);
				return;
			}

			try {
				const availableModels = await client.getAvailableModels();

				if (availableModels.length === 0) {
					setError('No models available. Please check your configuration.');
					setLoading(false);
					return;
				}

				const modelOptions: ModelOption[] = availableModels.map(model => ({
					label: `${model}${model === currentModel ? ' (current)' : ''}`,
					value: model,
				}));

				setModels(modelOptions);
				setLoading(false);
			} catch (err) {
				setError(`Error accessing models: ${String(err)}`);
				setLoading(false);
			}
		};

		void loadModels();
	}, [client, currentModel]);

	const handleSelect = (item: ModelOption) => {
		onModelSelect(item.value);
	};

	if (loading) {
		return (
			<TitledBoxWithPreferences
				title="Model Selection"
				width={boxWidth}
				borderColor={colors.primary}
				paddingX={2}
				paddingY={1}
				marginBottom={1}
			>
				<Text color={colors.secondary}>Loading available models...</Text>
			</TitledBoxWithPreferences>
		);
	}

	if (error) {
		return (
			<TitledBoxWithPreferences
				title="Model Selection - Error"
				width={boxWidth}
				borderColor={colors.error}
				paddingX={2}
				paddingY={1}
				marginBottom={1}
			>
				<Box flexDirection="column">
					<Text color={colors.error}>{error}</Text>
					<Text color={colors.secondary}>
						Make sure your provider is properly configured.
					</Text>
					<Box marginTop={1}>
						<Text color={colors.secondary}>Press Escape to cancel</Text>
					</Box>
				</Box>
			</TitledBoxWithPreferences>
		);
	}

	return (
		<TitledBoxWithPreferences
			title="Select a Model"
			width={boxWidth}
			borderColor={colors.primary}
			paddingX={2}
			paddingY={1}
			marginBottom={1}
		>
			<Box flexDirection="column">
				<SelectInput items={models} onSelect={handleSelect} />
				<Box marginTop={1}>
					<Text color={colors.secondary}>Press Escape to cancel</Text>
				</Box>
			</Box>
		</TitledBoxWithPreferences>
	);
}
