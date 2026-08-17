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
 * ProviderManager and codex/opencode provider pickers), then opens the existing
 * provider wizard to add/edit rather than jumping straight into it.
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
	const [editing, setEditing] = useState(false);

	const providers = getAppConfig().providers ?? [];

	useInput((_, key) => {
		if (editing) return;
		if (key.escape) onBack();
		if (key.shift && key.tab) onBack();
	});

	if (editing) {
		return (
			<ProviderWizard
				projectDir={process.cwd()}
				onComplete={async () => {
					// Rebuild the client for current provider/model without clearing
					// messages. The parent owns closing the editing state.
					await onProvidersChanged?.();
					setEditing(false);
				}}
				onCancel={() => setEditing(false)}
			/>
		);
	}

	const items = [
		...providers.map((p, i) => {
			const where = p.baseUrl ? p.baseUrl : 'default endpoint';
			const models = p.models?.length
				? `${p.models[0]}${p.models.length > 1 ? ` +${p.models.length - 1}` : ''}`
				: 'no models';
			return {label: `${p.name}  ·  ${where}  ·  ${models}`, value: String(i)};
		}),
		{label: '+ Add or edit providers…', value: 'edit'},
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
					configured. Enter opens the wizard to add or edit.
				</Text>
			</Box>
			<StyledSelectInput items={items} onSelect={() => setEditing(true)} />
			<Box marginTop={1}>
				<Text color={colors.secondary}>Shift+Tab back · Esc back</Text>
			</Box>
		</TitledBoxWithPreferences>
	);
}
