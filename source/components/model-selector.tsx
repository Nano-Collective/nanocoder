import {useState} from 'react';
import {
	ItemSelector,
	type ItemSelectorOption,
} from '@/components/item-selector';
import {loadAllProviderConfigs} from '@/config/mcp-config-loader';

interface ModelSelectorProps {
	currentProvider: string;
	currentModel: string;
	onModelSelect: (provider: string, model: string) => void;
	onCancel: () => void;
}

export default function ModelSelector({
	currentProvider,
	currentModel,
	onModelSelect,
	onCancel,
}: ModelSelectorProps) {
	// Flat list of every model across every configured provider. The option
	// value is the entry's index, so a selection maps back to its
	// (provider, model) pair without encoding a delimiter into the value.
	const [entries] = useState<{provider: string; model: string}[]>(() =>
		loadAllProviderConfigs().flatMap(provider =>
			(provider.models ?? []).map(model => ({
				provider: provider.name,
				model,
			})),
		),
	);

	const items: ItemSelectorOption[] = entries.map((entry, index) => ({
		label: `${entry.model} (${entry.provider})${
			entry.provider === currentProvider && entry.model === currentModel
				? ' (current)'
				: ''
		}`,
		value: String(index),
	}));

	const error =
		entries.length === 0
			? 'No models available. Please check your configuration.'
			: null;

	const currentIndex = entries.findIndex(
		entry => entry.provider === currentProvider && entry.model === currentModel,
	);

	return (
		<ItemSelector
			title="Select a Model"
			items={items}
			searchable
			initialSelectedValue={
				currentIndex >= 0 ? String(currentIndex) : undefined
			}
			onSelect={value => {
				const entry = entries[Number(value)];
				if (entry) {
					onModelSelect(entry.provider, entry.model);
				}
			}}
			onCancel={onCancel}
			error={error}
			errorTitle="Model Selection - Error"
			errorHint="Make sure your providers are properly configured."
		/>
	);
}
