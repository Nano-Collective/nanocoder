import {AgentSideConnection, ndJsonStream} from '@agentclientprotocol/sdk';
import {AcpAgent} from '@/acp/acp-agent';
import type {AcpInitContext} from '@/acp/acp-types';
import {directoryTrustRefusal} from '@/config/preferences';
import {initializePlain} from '@/plain/initialize';
import {getLogger} from '@/utils/logging';
import {getShutdownManager} from '@/utils/shutdown';

const logger = getLogger();

/**
 * Exit code when startup is refused because the folder is not trusted, so a
 * client can show a trust prompt without matching the message. Other startup
 * failures exit 1.
 */
const ACP_TRUST_REFUSED_EXIT_CODE = 3;

export interface RunAcpServerOptions {
	cliProvider?: string;
	cliModel?: string;
	appVersion?: string;
	/** Trust the working directory for this run only (`--trust-directory`). */
	trustDirectory?: boolean;
}

export async function runAcpServer(
	options: RunAcpServerOptions = {},
): Promise<void> {
	logger.info('ACP server starting...');

	// initializePlain() loads the working directory's project config
	// (providers, hooks, MCP servers), so refuse an untrusted folder first,
	// as `nanocoder run` does. stdout carries the protocol, so report on stderr.
	const refusal = directoryTrustRefusal(
		process.cwd(),
		options.trustDirectory ?? false,
	);
	if (refusal) {
		logger.error(`ACP not started: ${refusal}`);
		process.stderr.write(`[nanocoder] ${refusal}\n`);
		process.exit(ACP_TRUST_REFUSED_EXIT_CODE);
	}

	let initContext: AcpInitContext;
	try {
		initContext = await initializePlain({
			cliProvider: options.cliProvider,
			cliModel: options.cliModel,
		});
	} catch (error) {
		const msg = `ACP initialization failed: ${error instanceof Error ? error.message : String(error)}`;
		logger.error(msg);
		process.stderr.write(`[nanocoder] ${msg}\n`);
		process.exit(1);
	}

	logger.info(
		`ACP initialized: provider=${initContext.provider} model=${initContext.model}`,
	);

	// Convert Node.js streams to web streams for the SDK
	const input = new ReadableStream<Uint8Array>({
		start(controller) {
			process.stdin.on('data', (chunk: Buffer) => {
				controller.enqueue(new Uint8Array(chunk));
			});
			process.stdin.on('end', () => {
				controller.close();
			});
			process.stdin.on('error', err => {
				controller.error(err);
			});
		},
	});

	const output = new WritableStream<Uint8Array>({
		write(chunk) {
			process.stdout.write(chunk);
		},
		abort(reason) {
			logger.error(`ACP output stream aborted: ${String(reason)}`);
		},
	});

	const stream = ndJsonStream(output, input);

	const conn = new AgentSideConnection((connection: AgentSideConnection) => {
		const agent = new AcpAgent(initContext, connection, options.appVersion);
		return agent;
	}, stream);

	// Register graceful shutdown
	const shutdownManager = getShutdownManager();
	const connectionClosed = conn.closed;

	// Handle connection close
	connectionClosed
		.then(() => {
			logger.info('ACP connection closed');
			shutdownManager.gracefulShutdown(0);
		})
		.catch((error: unknown) => {
			logger.error(`ACP connection error: ${String(error)}`);
			shutdownManager.gracefulShutdown(1);
		});

	// Wait for connection to close
	await connectionClosed;
}
