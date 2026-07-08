import {Box, Text} from 'ink';
import {useState} from 'react';
import {getColors} from '@/config/index';
import type {DevelopmentMode} from '@/types/core';
import type {ModeProviderConfig, ProviderConfig} from '../types/config';
import {BaseConfigWizard} from './base-config-wizard';
import {ModeProviderStep} from './steps/mode-provider-step';
import {ProviderStep} from './steps/provider-step';
import {
	buildProviderConfigObject,
	type ProviderWizardState,
} from './validation';

interface ProviderWizardProps {
	projectDir: string;
	onComplete: (configPath: string) => void;
	onCancel?: () => void;
}

function parseProviderConfig(raw: unknown): ProviderWizardState {
	const config = raw as {
		nanocoder?: {
			providers?: ProviderConfig[];
			modeProviders?: Partial<Record<DevelopmentMode, ModeProviderConfig>>;
		};
	} | null;
	return {
		providers: config?.nanocoder?.providers ?? [],
		modeProviders: config?.nanocoder?.modeProviders ?? {},
	};
}

function ProviderSummaryItems({items}: {items: ProviderWizardState}) {
	const colors = getColors();
	const {providers, modeProviders} = items;

	if (providers.length === 0) {
		return (
			<Box marginBottom={1}>
				<Text color={colors.warning}>No providers configured</Text>
			</Box>
		);
	}

	return (
		<Box marginBottom={1} flexDirection="column">
			<Text color={colors.secondary}>Providers ({providers.length}):</Text>
			{providers.map((provider, index) => (
				<Text key={index} color={colors.success}>
					• {provider.name}
					<Text>
						{' '}
						({provider.models.length}{' '}
						{provider.models.length === 1 ? 'model' : 'models'}
						{provider.models.length <= 3
							? `: ${provider.models.join(', ')}`
							: ''}
						)
					</Text>
				</Text>
			))}

			{modeProviders && Object.keys(modeProviders).length > 0 && (
				<Box flexDirection="column" marginTop={1}>
					<Text color={colors.secondary}>Mode-Specific Providers:</Text>
					{Object.entries(modeProviders).map(([mode, config]) => (
						<Text key={mode} color={colors.success}>
							• {mode}: {config.provider} ({config.model})
						</Text>
					))}
				</Box>
			)}
		</Box>
	);
}

function ProviderCompleteExtras({items}: {items: ProviderWizardState}) {
	const colors = getColors();
	const copilotProviders = items.providers.filter(
		p => p.sdkProvider === 'github-copilot',
	);
	const codexProviders = items.providers.filter(
		p => p.sdkProvider === 'chatgpt-codex',
	);
	const localProviders = items.providers.filter(
		p =>
			!p.apiKey &&
			p.baseUrl &&
			(p.baseUrl.includes('localhost') || p.baseUrl.includes('127.0.0.1')),
	);

	const needsAuth = copilotProviders.length > 0 || codexProviders.length > 0;
	const hasLocal = localProviders.length > 0;

	return (
		<>
			{needsAuth && (
				<Box marginBottom={1} flexDirection="column">
					{copilotProviders.length > 0 && (
						<Text color={colors.primary}>
							Run /copilot-login to auth with Copilot.
						</Text>
					)}
					{codexProviders.length > 0 && (
						<Text color={colors.primary}>
							Run /codex-login to auth with ChatGPT/Codex.
						</Text>
					)}
				</Box>
			)}
			{hasLocal && (
				<Box marginBottom={1}>
					<Text>
						Ensure your local{' '}
						{localProviders.length === 1 ? 'server is' : 'servers are'} running
						before use.
					</Text>
				</Box>
			)}
		</>
	);
}

function ProviderWizardSteps({
	items,
	onComplete,
	onBack,
	onDelete,
	configExists,
}: {
	items: ProviderWizardState;
	onComplete: (items: ProviderWizardState) => void;
	onBack: () => void;
	onDelete: () => void;
	configExists: boolean;
}) {
	const [step, setStep] = useState<'providers' | 'modes'>('providers');
	const [providers, setProviders] = useState(items.providers);

	if (step === 'providers') {
		return (
			<ProviderStep
				existingProviders={providers}
				onComplete={newProviders => {
					setProviders(newProviders);
					setStep('modes');
				}}
				onBack={onBack}
				onDelete={onDelete}
				configExists={configExists}
			/>
		);
	}

	return (
		<ModeProviderStep
			providers={providers}
			existingModeProviders={items.modeProviders}
			onComplete={modeProviders => {
				onComplete({providers, modeProviders});
			}}
			onBack={() => setStep('providers')}
		/>
	);
}

export function ProviderWizard({
	projectDir,
	onComplete,
	onCancel,
}: ProviderWizardProps) {
	return (
		<BaseConfigWizard<ProviderWizardState>
			title="Provider Wizard"
			focusId="config-wizard"
			configFileName="agents.config.json"
			initialItems={{providers: [], modeProviders: {}}}
			parseConfig={parseProviderConfig}
			buildConfig={buildProviderConfigObject}
			hasItems={items => items.providers.length > 0}
			renderConfigureStep={args => <ProviderWizardSteps {...args} />}
			renderSummaryItems={items => <ProviderSummaryItems items={items} />}
			renderCompleteExtras={items => <ProviderCompleteExtras items={items} />}
			projectDir={projectDir}
			onComplete={onComplete}
			onCancel={onCancel}
		/>
	);
}
