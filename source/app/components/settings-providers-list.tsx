import {Box, Text, useInput} from 'ink';
import SelectInput from 'ink-select-input';
import {useState} from 'react';
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
}: {
	onBack: () => void;
	onCancel: () => void;
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
				onComplete={onBack}
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
		{label: '＋ Add or edit providers…', value: 'edit'},
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
			<SelectInput
				items={items}
				onSelect={() => setEditing(true)}
				indicatorComponent={({isSelected}) => (
					<Text color={isSelected ? colors.primary : colors.text}>
						{isSelected ? '> ' : '  '}
					</Text>
				)}
				itemComponent={({isSelected, label}) => (
					<Text color={isSelected ? colors.primary : colors.text}>{label}</Text>
				)}
			/>
			<Box marginTop={1}>
				<Text color={colors.secondary}>Shift+Tab back · Esc exit</Text>
			</Box>
		</TitledBoxWithPreferences>
	);
}
