import path from 'node:path';
import {render} from 'ink';
import {createLLMClient} from '@/client-factory';
import {SwarmDashboard} from '@/components/swarm/swarm-dashboard';
import {getLastUsedModel, loadPreferences} from '@/config/preferences';
import {getThemeColors} from '@/config/themes';
import {directoryTrustRefusal} from '@/config/trust/directory-trust';
import {ThemeContext} from '@/hooks/useTheme';
import {formatError} from '@/utils/error-formatter';
import {getShutdownManager} from '@/utils/shutdown';
import {runSwarm} from './coordinator';
import {formatSwarmSummary} from './summary';
import type {SwarmConfig, SwarmSnapshot} from './types';

const SHUTDOWN_TIMEOUT_MS = 30_000;

export interface SwarmCommandOptions {
	config: SwarmConfig;
	trustDirectory: boolean;
	cliProvider?: string;
	cliModel?: string;
	/** Extra options every worker is started with. */
	workerOptions: string[];
}

async function createSwarmClient(provider?: string, model?: string) {
	const {client, actualProvider} = await createLLMClient(
		provider,
		model,
		undefined,
		{strictProvider: provider !== undefined},
	);
	const lastUsed = model ? undefined : getLastUsedModel(actualProvider);
	if (lastUsed && (await client.getAvailableModels()).includes(lastUsed)) {
		client.setModel(lastUsed);
	}
	return {client, provider: actualProvider};
}

export async function runSwarmCommand({
	config,
	trustDirectory,
	cliProvider,
	cliModel,
	workerOptions,
}: SwarmCommandOptions): Promise<void> {
	if (!process.stdin.isTTY || !process.stdout.isTTY) {
		throw new Error(
			'`nanocoder swarm` requires an interactive terminal (TTY).',
		);
	}
	const cwd = process.cwd();
	const cliPath = path.resolve(process.argv[1] ?? '');
	const refusal = directoryTrustRefusal(cwd, trustDirectory);
	if (refusal) throw new Error(refusal);

	let session: Awaited<ReturnType<typeof createSwarmClient>>;
	try {
		session = await createSwarmClient(cliProvider, cliModel);
	} catch (error) {
		throw new Error(formatError(error));
	}

	const abort = new AbortController();
	let answer: (apply: boolean) => void = () => undefined;
	const confirmApply = () =>
		new Promise<boolean>(resolve => {
			answer = resolve;
			abort.signal.addEventListener('abort', () => resolve(false), {
				once: true,
			});
		});

	const theme = loadPreferences().selectedTheme ?? 'tokyo-night';
	const themeValue = {
		currentTheme: theme,
		colors: getThemeColors(theme),
		setCurrentTheme: () => undefined,
	};
	const view = (snapshot: SwarmSnapshot) => (
		<ThemeContext.Provider value={themeValue}>
			<SwarmDashboard
				config={config}
				snapshot={snapshot}
				onCancel={() => abort.abort()}
				onConfirm={apply => answer(apply)}
			/>
		</ThemeContext.Provider>
	);
	const instance = render(
		view({
			status: 'decomposing',
			workers: [],
			patches: [],
			applied: false,
		}),
		// Ctrl+C has to stop the workers and remove their worktrees first.
		{exitOnCtrlC: false},
	);

	const run = runSwarm(config, {
		client: session.client,
		cwd,
		cliPath,
		workerOptions: [
			'--provider',
			session.provider,
			'--model',
			session.client.getCurrentModel(),
			...workerOptions,
		],
		signal: abort.signal,
		onUpdate: snapshot => instance.rerender(view(snapshot)),
		confirmApply,
	});

	// A signal or a closed terminal must not leave workers running. Stopping
	// them and removing the worktrees can outlast the default shutdown window.
	const shutdownManager = getShutdownManager({
		timeoutMs: SHUTDOWN_TIMEOUT_MS,
	});
	// The shutdown manager listens for these with `once`, so by the time Ink's
	// exit hook runs there is no listener left and it re-raises the signal,
	// killing the process before cleanup. A persistent listener prevents that.
	const cancel = () => abort.abort();
	process.on('SIGINT', cancel);
	process.on('SIGTERM', cancel);
	shutdownManager.register({
		name: 'swarm-cleanup',
		priority: -1,
		handler: async () => {
			abort.abort();
			await run;
		},
	});

	const result = await run;
	instance.unmount();
	process.stdout.write(`${formatSwarmSummary(config, result)}\n`);
	await shutdownManager.gracefulShutdown(result.status === 'complete' ? 0 : 1);
}
