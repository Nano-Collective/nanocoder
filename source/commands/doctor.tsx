import {readFile} from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Box, Text} from 'ink';
import React from 'react';
import {loadProviderConfigs} from '@/client-factory';
import {TitledBoxWithPreferences} from '@/components/ui/titled-box';
import {
	type DaemonLock,
	readLiveLockfile,
	readLockfile,
} from '@/daemon/lockfile';
import {useTerminalWidth} from '@/hooks/useTerminalWidth';
import {useTheme} from '@/hooks/useTheme';
import {getLSPManager} from '@/lsp/lsp-manager';
import {getToolManager} from '@/message-handler';
import {generateKey} from '@/session/key-generator';
import type {ToolManager} from '@/tools/tool-manager';
import type {AIProviderConfig, Command} from '@/types/index';
import {formatError} from '@/utils/error-formatter';
import {isLocalURL} from '@/utils/url-utils';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LOCAL_PROBE_TIMEOUT_MS = 500;

type Section<T> = {status: 'ok'; data: T} | {status: 'error'; error: string};

export interface DoctorProvider {
	name: string;
	modelCount: number;
	baseURL: string | null;
	location: 'local' | 'hosted' | 'unknown';
	reachability: 'reachable' | 'unreachable' | 'skipped' | 'not-local';
}

export interface DoctorLspServer {
	name: string;
	ready: boolean;
	languages: string[];
}

export interface DoctorMcpServer {
	name: string;
	transport: string;
	toolCount: number;
	url?: string;
}

export interface DoctorReport {
	system: {
		nodeVersion: string;
		platform: NodeJS.Platform;
		arch: string;
	};
	nanocoder: Section<{version: string}>;
	providers: Section<DoctorProvider[]>;
	lsp: Section<{
		initialized: boolean;
		servers: DoctorLspServer[];
	}>;
	mcp: Section<DoctorMcpServer[]>;
	daemon: Section<
		| {state: 'running'; lock: DaemonLock; uptimeMs: number}
		| {state: 'not-running'}
		| {state: 'stale-cleaned'}
	>;
}

export interface DoctorDependencies {
	now: () => number;
	getVersion: () => Promise<string>;
	getProviders: () => AIProviderConfig[];
	getLspStatus: () => Promise<{
		initialized: boolean;
		servers: Array<{name: string; ready: boolean; languages: string[]}>;
	}>;
	getToolManager: () => ToolManager | null;
	getDaemonLock: () => Promise<DaemonLock | null>;
	probeLocalProvider: (
		baseURL: string,
	) => Promise<'reachable' | 'unreachable' | 'skipped'>;
}

async function getPackageVersion(): Promise<string> {
	try {
		const content = await readFile(
			path.join(__dirname, '../../package.json'),
			'utf8',
		);
		const packageJson = JSON.parse(content) as {version?: string};
		return packageJson.version ?? '0.0.0';
	} catch {
		return '0.0.0';
	}
}

async function probeLocalProvider(
	baseURL: string,
): Promise<'reachable' | 'unreachable' | 'skipped'> {
	if (process.env.NANOCODER_DOCTOR_PROBE === '0') {
		return 'skipped';
	}

	return new Promise(resolve => {
		try {
			const parsed = new URL(baseURL);
			const port =
				parsed.port === ''
					? parsed.protocol === 'https:'
						? 443
						: 80
					: Number.parseInt(parsed.port, 10);
			const socket = net.createConnection({host: parsed.hostname, port});

			const finish = (result: 'reachable' | 'unreachable') => {
				socket.destroy();
				resolve(result);
			};

			socket.setTimeout(LOCAL_PROBE_TIMEOUT_MS);
			socket.once('connect', () => finish('reachable'));
			socket.once('timeout', () => finish('unreachable'));
			socket.once('error', () => finish('unreachable'));
		} catch {
			resolve('unreachable');
		}
	});
}

async function getDaemonLock(): Promise<DaemonLock | null> {
	const projectRoot = process.cwd();
	const lock = await readLockfile(projectRoot);

	// readLiveLockfile validates the recorded pid and removes stale lockfiles.
	// /doctor stays diagnostic-only; it does not start, stop, or reconfigure
	// the daemon.
	const live = await readLiveLockfile(projectRoot);
	if (!live && lock) {
		return {
			...lock,
			pid: -1,
		};
	}

	return live;
}

function defaultDependencies(): DoctorDependencies {
	return {
		now: () => Date.now(),
		getVersion: getPackageVersion,
		getProviders: loadProviderConfigs,
		getLspStatus: async () => {
			const manager = await getLSPManager();
			return manager.getStatus();
		},
		getToolManager,
		getDaemonLock,
		probeLocalProvider,
	};
}

async function settle<T>(load: () => Promise<T> | T): Promise<Section<T>> {
	try {
		return {status: 'ok', data: await load()};
	} catch (error) {
		return {status: 'error', error: formatError(error)};
	}
}

async function collectProviders(
	deps: DoctorDependencies,
): Promise<DoctorProvider[]> {
	const providers = deps.getProviders();

	return Promise.all(
		providers.map(async provider => {
			const baseURL = provider.config.baseURL ?? null;
			const local = baseURL ? isLocalURL(baseURL) : false;
			const reachability =
				baseURL && local
					? await deps.probeLocalProvider(baseURL)
					: baseURL
						? 'not-local'
						: 'skipped';

			return {
				name: provider.name,
				modelCount: provider.models.length,
				baseURL,
				location: baseURL ? (local ? 'local' : 'hosted') : 'unknown',
				reachability,
			};
		}),
	);
}

function collectMcp(toolManager: ToolManager | null): DoctorMcpServer[] {
	const serverNames = toolManager?.getConnectedServers() ?? [];

	return serverNames.map(serverName => {
		const serverInfo = toolManager?.getServerInfo(serverName);
		const serverTools = toolManager?.getServerTools(serverName) ?? [];
		return {
			name: serverName,
			transport: String(serverInfo?.transport ?? 'stdio'),
			toolCount: serverTools.length,
			url: serverInfo?.url,
		};
	});
}

function normalizeDaemon(
	lock: DaemonLock | null,
	now: number,
): DoctorReport['daemon'] {
	if (!lock) {
		return {status: 'ok', data: {state: 'not-running'}};
	}

	if (lock.pid === -1) {
		return {status: 'ok', data: {state: 'stale-cleaned'}};
	}

	return {
		status: 'ok',
		data: {
			state: 'running',
			lock,
			uptimeMs: Math.max(0, now - lock.startedAt),
		},
	};
}

export async function collectDoctorReport(
	dependencies: DoctorDependencies = defaultDependencies(),
): Promise<DoctorReport> {
	const [nanocoder, providers, lsp, mcp, daemonLock] = await Promise.all([
		settle(() => dependencies.getVersion().then(version => ({version}))),
		settle(() => collectProviders(dependencies)),
		settle(() => dependencies.getLspStatus()),
		settle(() => collectMcp(dependencies.getToolManager())),
		settle(() => dependencies.getDaemonLock()),
	]);

	return {
		system: {
			nodeVersion: process.version,
			platform: process.platform,
			arch: process.arch,
		},
		nanocoder,
		providers,
		lsp,
		mcp,
		daemon:
			daemonLock.status === 'ok'
				? normalizeDaemon(daemonLock.data, dependencies.now())
				: daemonLock,
	};
}

function formatDuration(ms: number): string {
	const totalSeconds = Math.floor(ms / 1000);
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;

	if (hours > 0) return `${hours}h ${minutes}m`;
	if (minutes > 0) return `${minutes}m ${seconds}s`;
	return `${seconds}s`;
}

function SectionTitle({children}: {children: React.ReactNode}) {
	const {colors} = useTheme();
	return (
		<Box marginTop={1}>
			<Text color={colors.primary} bold>
				{children}
			</Text>
		</Box>
	);
}

function SectionError({message}: {message: string}) {
	const {colors} = useTheme();
	return <Text color={colors.error}> error: {message}</Text>;
}

export function Doctor({report}: {report: DoctorReport}) {
	const boxWidth = useTerminalWidth();
	const {colors} = useTheme();

	return (
		<TitledBoxWithPreferences
			title="/doctor"
			width={boxWidth}
			borderColor={colors.primary}
			paddingX={2}
			paddingY={1}
			flexDirection="column"
			marginBottom={1}
		>
			<Text color={colors.secondary}>
				Copy this report into bug reports. Secrets are not printed.
			</Text>

			<SectionTitle>System</SectionTitle>
			<Text color={colors.text}>
				• Node {report.system.nodeVersion} • {report.system.platform}/
				{report.system.arch}
			</Text>

			<SectionTitle>Nanocoder</SectionTitle>
			{report.nanocoder.status === 'ok' ? (
				<Text color={colors.text}>
					• version {report.nanocoder.data.version}
				</Text>
			) : (
				<SectionError message={report.nanocoder.error} />
			)}

			<SectionTitle>Providers</SectionTitle>
			{report.providers.status === 'error' ? (
				<SectionError message={report.providers.error} />
			) : report.providers.data.length === 0 ? (
				<Text color={colors.secondary}>• No providers configured</Text>
			) : (
				report.providers.data.map(provider => (
					<Text key={provider.name} color={colors.text}>
						• {provider.name}: {provider.modelCount} model
						{provider.modelCount === 1 ? '' : 's'} • {provider.location}
						{provider.baseURL ? ` • ${provider.baseURL}` : ''}
						{provider.location === 'local' ? ` • ${provider.reachability}` : ''}
					</Text>
				))
			)}

			<SectionTitle>LSP</SectionTitle>
			{report.lsp.status === 'error' ? (
				<SectionError message={report.lsp.error} />
			) : (
				<>
					<Text color={colors.text}>
						• {report.lsp.data.initialized ? 'initialized' : 'not initialized'}
					</Text>
					{report.lsp.data.servers.length === 0 ? (
						<Text color={colors.secondary}>• No LSP servers connected</Text>
					) : (
						report.lsp.data.servers.map(server => (
							<Text key={server.name} color={colors.text}>
								• {server.name}: {server.ready ? 'ready' : 'initializing'}
								{server.languages.length > 0
									? ` • ${server.languages.join(', ')}`
									: ''}
							</Text>
						))
					)}
				</>
			)}

			<SectionTitle>MCP</SectionTitle>
			{report.mcp.status === 'error' ? (
				<SectionError message={report.mcp.error} />
			) : report.mcp.data.length === 0 ? (
				<Text color={colors.secondary}>• No MCP servers connected</Text>
			) : (
				report.mcp.data.map(server => (
					<Text key={server.name} color={colors.text}>
						• {server.name}: {server.transport} • {server.toolCount} tool
						{server.toolCount === 1 ? '' : 's'}
						{server.url ? ` • ${server.url}` : ''}
					</Text>
				))
			)}

			<SectionTitle>Daemon</SectionTitle>
			{report.daemon.status === 'error' ? (
				<SectionError message={report.daemon.error} />
			) : report.daemon.data.state === 'running' ? (
				<>
					<Text color={colors.text}>
						• running • pid {report.daemon.data.lock.pid} • uptime{' '}
						{formatDuration(report.daemon.data.uptimeMs)}
					</Text>
					<Text color={colors.secondary}>
						• socket {report.daemon.data.lock.socketPath}
					</Text>
				</>
			) : report.daemon.data.state === 'stale-cleaned' ? (
				<Text color={colors.warning}>• stale lockfile cleaned</Text>
			) : (
				<Text color={colors.secondary}>• not running</Text>
			)}
		</TitledBoxWithPreferences>
	);
}

export const doctorCommand: Command = {
	name: 'doctor',
	description: 'Show environment health report for bug reports',
	handler: async () => {
		const report = await collectDoctorReport();
		return React.createElement(Doctor, {
			key: generateKey('doctor'),
			report,
		});
	},
};
