import {Box, Text, useInput} from 'ink';
import {useState} from 'react';
import {StyledSelectInput} from '@/components/ui/styled-select-input';
import {TitledBoxWithPreferences} from '@/components/ui/titled-box';
import {getAppConfig} from '@/config/index';
import {useResponsiveTerminal} from '@/hooks/useTerminalWidth';
import {useTheme} from '@/hooks/useTheme';
import {ProviderWizard} from '@/wizards/provider-wizard';

/**
 * Lists the configured AI providers first (inspired by openclaude's
 * ProviderManager and codex/opencode provider pickers). Selecting a provider
 * opens the wizard on that entry's edit/delete choice; the trailing row adds a
 * new one.
 */
export function SettingsProvidersListPanel({
	onBack,
	onProvidersChanged,
}: {
	onBack: () => void;
	onCancel: () => void;
	onProvidersChanged?: () => void | Promise<void>;
}) {
	const {colors} = useTheme();
	const {boxWidth, isNarrow} = useResponsiveTerminal();
	// null = not editing. '' = adding a new provider (no entry targeted).
	const [editTarget, setEditTarget] = useState<string | null>(null);

	const providers = getAppConfig().providers ?? [];

	useInput((_, key) => {
		if (editTarget !== null) return;
		if (key.escape) onBack();
		if (key.shift && key.tab) onBack();
	});

	if (editTarget !== null) {
		return (
			<ProviderWizard
				projectDir={process.cwd()}
				initialEditName={editTarget || undefined}
				onComplete={async () => {
					// Rebuild the client for current provider/model without clearing
					// messages. The parent owns closing the editing state.
					await onProvidersChanged?.();
					setEditTarget(null);
				}}
				onCancel={() => setEditTarget(null)}
			/>
		);
	}

	const items = [
		...providers.map(p => {
			const where = p.baseUrl ? p.baseUrl : 'default endpoint';
			const models = p.models?.length
				? `${p.models[0]}${p.models.length > 1 ? ` +${p.models.length - 1}` : ''}`
				: 'no models';
			// Value is the provider name so the wizard can target this entry even
			// though it loads a single config file rather than the resolved config.
			return {label: `${p.name}  ·  ${where}  ·  ${models}`, value: p.name};
		}),
		{label: '+ Add a provider…', value: ''},
	];

	return (
		<TitledBoxWithPreferences
			title="Settings · Providers"
			width={isNarrow ? '100%' : boxWidth}
			borderColor={colors.primary}
			paddingX={2}
			paddingY={1}
			flexDirection="column"
			marginBottom={1}
		>
			<Box marginBottom={1}>
				<Text color={colors.secondary}>
					{providers.length} provider{providers.length === 1 ? '' : 's'}{' '}
					configured. Enter edits or deletes the selected provider.
				</Text>
			</Box>
			<StyledSelectInput
				items={items}
				onSelect={item => setEditTarget(item.value)}
			/>
			<Box marginTop={1}>
				<Text color={colors.secondary}>Shift+Tab back · Esc back</Text>
			</Box>
		</TitledBoxWithPreferences>
	);
}
