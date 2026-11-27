import {Text, useFocus, useInput} from 'ink';
import {useCallback, useEffect, useRef, useState} from 'react';
import {StyledSelectInput} from '@/components/ui/styled-select-input';
import {TitledBoxWithPreferences} from '@/components/ui/titled-box';
import {useResponsiveTerminal} from '@/hooks/useTerminalWidth';
import {useTheme} from '@/hooks/useTheme';
import {formatError} from '@/utils/error-formatter';
import {
	type DetectedProvider,
	detectFirstRunProviders,
	getFirstRunSetupPaths,
	saveDetectedProviders,
} from './first-run-providers';
import {ProviderWizard} from './provider-wizard';
import type {ConfigLocation} from './steps/location-step';

interface FirstRunProviderWizardProps {
	projectDir: string;
	onComplete: (configPath: string) => void;
	onCancel: () => void;
	detectProviders?: typeof detectFirstRunProviders;
}

function DetectedProviderSetup({
	paths,
	projectDir,
	onComplete,
	onCancel,
	onManual,
	detectProviders = detectFirstRunProviders,
}: FirstRunProviderWizardProps & {
	paths: Partial<Record<ConfigLocation, string>>;
	onManual: () => void;
}) {
	const {colors} = useTheme();
	const {boxWidth} = useResponsiveTerminal();
	const [providers, setProviders] = useState<DetectedProvider[]>([]);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string>();
	const saveInProgress = useRef(false);
	useFocus({autoFocus: true, id: 'first-run-provider-setup'});
	useInput((_input, key) => {
		if (key.escape && !saveInProgress.current) onCancel();
	});

	useEffect(() => {
		const controller = new AbortController();
		void detectProviders(process.env, controller.signal).then(
			found => {
				if (controller.signal.aborted) return;
				if (found.length) setProviders(found);
				else onManual();
			},
			() => {
				if (!controller.signal.aborted) onManual();
			},
		);
		return () => controller.abort();
	}, [detectProviders, onManual]);

	const save = async (location: ConfigLocation) => {
		if (saveInProgress.current) return;
		saveInProgress.current = true;
		setSaving(true);
		setError(undefined);
		try {
			onComplete(await saveDetectedProviders(projectDir, location, providers));
		} catch (error) {
			setError(formatError(error));
		} finally {
			saveInProgress.current = false;
			setSaving(false);
		}
	};

	const choices: {label: string; value: ConfigLocation | 'manual'}[] = [];
	if (providers.length) {
		if (paths.project)
			choices.push({
				label: 'Use detected providers for this project',
				value: 'project',
			});
		if (paths.global)
			choices.push({
				label: 'Use detected providers in the user config',
				value: 'global',
			});
	}
	choices.push({label: 'Configure manually', value: 'manual'});

	return (
		<TitledBoxWithPreferences
			title="Provider setup"
			width={boxWidth}
			paddingX={2}
			paddingY={1}
			flexDirection="column"
		>
			{providers.length ? (
				providers.map(({config, keyVariable}) => (
					<Text key={config.name} color={colors.text} wrap="truncate-end">
						{config.name} ·{' '}
						{keyVariable
							? `${keyVariable} set`
							: `${config.models.length} local ${config.models.length === 1 ? 'model' : 'models'}`}
					</Text>
				))
			) : (
				<Text color={colors.secondary}>
					Looking for local models and provider keys…
				</Text>
			)}
			{error && <Text color={colors.error}>{error}</Text>}
			{saving ? (
				<Text color={colors.secondary}>Saving configuration…</Text>
			) : (
				<StyledSelectInput
					items={choices}
					onSelect={({value}) => {
						if (value === 'manual') onManual();
						else void save(value);
					}}
				/>
			)}
		</TitledBoxWithPreferences>
	);
}

export function FirstRunProviderWizard({
	detectProviders,
	...props
}: FirstRunProviderWizardProps) {
	const [paths, setPaths] = useState(() =>
		getFirstRunSetupPaths(props.projectDir),
	);
	const onManual = useCallback(() => setPaths(undefined), []);
	return paths ? (
		<DetectedProviderSetup
			{...props}
			paths={paths}
			onManual={onManual}
			detectProviders={detectProviders}
		/>
	) : (
		<ProviderWizard {...props} />
	);
}
