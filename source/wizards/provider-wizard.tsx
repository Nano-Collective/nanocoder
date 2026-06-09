import {Box, Text} from 'ink';
import {getColors} from '@/config/index';
import type {ProviderConfig} from '../types/config';
import {BaseConfigWizard} from './base-config-wizard';
import {ProviderStep} from './steps/provider-step';
import {buildProviderConfigObject} from './validation';

interface ProviderWizardProps {
	projectDir: string;
	onComplete: (configPath: string) => void;
	onCancel?: () => void;
}

function parseProviderConfig(raw: unknown): ProviderConfig[] {
	const config = raw as {nanocoder?: {providers?: ProviderConfig[]}} | null;
	return config?.nanocoder?.providers ?? [];
}

function ProviderSummaryItems({items}: {items: ProviderConfig[]}) {
	const colors = getColors();

	if (items.length === 0) {
		return (
			<Box marginBottom={1}>
				<Text color={colors.warning}>No providers configured</Text>
			</Box>
		);
	}

	return (
		<Box marginBottom={1} flexDirection="column">
			<Text color={colors.secondary}>Providers ({items.length}):</Text>
			{items.map((provider, index) => (
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
		</Box>
	);
}

function ProviderCompleteExtras({items}: {items: ProviderConfig[]}) {
	const colors = getColors();
	const copilotProviders = items.filter(
		p => p.sdkProvider === 'github-copilot',
	);
	const codexProviders = items.filter(p => p.sdkProvider === 'chatgpt-codex');
	const localProviders = items.filter(
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

export function ProviderWizard({
	projectDir,
	onComplete,
	onCancel,
}: ProviderWizardProps) {
	return (
		<BaseConfigWizard<ProviderConfig[]>
			title="Provider Wizard"
			focusId="config-wizard"
			configFileName="agents.config.json"
			initialItems={[]}
			parseConfig={parseProviderConfig}
			buildConfig={buildProviderConfigObject}
			hasItems={items => items.length > 0}
			renderConfigureStep={({
				items,
				onComplete: onItemsComplete,
				onBack,
				onDelete,
				configExists,
			}) => (
				<ProviderStep
					existingProviders={items}
					onComplete={onItemsComplete}
					onBack={onBack}
					onDelete={onDelete}
					configExists={configExists}
				/>
			)}
			renderSummaryItems={items => <ProviderSummaryItems items={items} />}
			renderCompleteExtras={items => <ProviderCompleteExtras items={items} />}
			projectDir={projectDir}
			onComplete={onComplete}
			onCancel={onCancel}
		/>
	);
}
