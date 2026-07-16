import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {createServer, type Server} from 'node:http';
import type {Duplex} from 'node:stream';
import {WebSocket, WebSocketServer} from 'ws';
import {nanocoderLogoSvg, renderWebModePage} from './page.js';
import {
	parseWebClientEvent,
	serializeWebServerEvent,
	WEB_PROTOCOL_VERSION,
	type WebClientEvent,
	type WebServerEvent,
} from './protocol.js';

export interface LocalWebServerOptions {
	host?: string;
	port?: number;
	token?: string;
	openBrowser?: boolean;
	onClientEvent?: (event: WebClientEvent) => void | Promise<void>;
}

export interface LocalWebServer {
	server: Server;
	host: string;
	port: number;
	token: string;
	url: string;
	eventsUrl: string;
	broadcastEvent: (event: WebServerEvent) => void;
	close: () => Promise<void>;
}

const DEFAULT_HOST = '127.0.0.1';
function createLocalWebToken(): string {
	return randomBytes(32).toString('hex');
}

export async function startLocalWebServer(
	options: LocalWebServerOptions = {},
): Promise<LocalWebServer> {
	const host = options.host ?? DEFAULT_HOST;
	const requestedPort = options.port ?? 0;
	const token = options.token ?? createLocalWebToken();

	const server = createServer((request, response) => {
		const requestUrl = new URL(request.url ?? '/', `http://${host}`);

		if (requestUrl.pathname === '/health') {
			response.writeHead(200, {'content-type': 'application/json'});
			response.end(JSON.stringify({ok: true, mode: 'web'}));
			return;
		}

		if (requestUrl.pathname === '/assets/nanocoder-icon.svg') {
			response.writeHead(200, {
				'cache-control': 'public, max-age=3600',
				'content-type': 'image/svg+xml; charset=utf-8',
			});
			response.end(nanocoderLogoSvg);
			return;
		}

		if (requestUrl.pathname !== '/' && requestUrl.pathname !== '/index.html') {
			response.writeHead(404, {'content-type': 'text/plain; charset=utf-8'});
			response.end('Not found');
			return;
		}

		if (requestUrl.searchParams.get('token') !== token) {
			response.writeHead(401, {'content-type': 'text/plain; charset=utf-8'});
			response.end('Access token required');
			return;
		}

		response.writeHead(200, {'content-type': 'text/html; charset=utf-8'});
		response.end(renderWebModePage());
	});
	const webSocketServer = new WebSocketServer({noServer: true});
	const connectedClients = new Set<WebSocket>();

	server.on('upgrade', (request, socket, head) => {
		const requestUrl = new URL(request.url ?? '/', `http://${host}`);
		if (
			requestUrl.pathname !== '/events' ||
			requestUrl.searchParams.get('token') !== token
		) {
			rejectWebSocketUpgrade(socket);
			return;
		}

		webSocketServer.handleUpgrade(request, socket, head, clientSocket => {
			webSocketServer.emit('connection', clientSocket, request);
		});
	});

	webSocketServer.on('connection', clientSocket => {
		connectedClients.add(clientSocket);
		sendServerEvent(clientSocket, {
			type: 'ready',
			protocolVersion: WEB_PROTOCOL_VERSION,
		});

		clientSocket.on('message', message => {
			void handleClientMessage(
				clientSocket,
				message.toString(),
				options.onClientEvent,
			);
		});

		clientSocket.on('close', () => {
			connectedClients.delete(clientSocket);
		});
	});

	await new Promise<void>((resolve, reject) => {
		server.once('error', reject);
		server.listen(requestedPort, host, () => {
			server.off('error', reject);
			resolve();
		});
	});

	const address = server.address();
	if (!address || typeof address === 'string') {
		await closeServer(server);
		throw new Error('Unable to determine local web server address.');
	}

	const port = address.port;
	const url = `http://${host}:${port}/?token=${token}`;
	// Local-only WebSocket paired with the localhost HTTP page; using wss:// here
	// would require local TLS certificate setup that this server does not provide.
	const eventsUrl = `ws://${host}:${port}/events?token=${token}`; // nosemgrep: javascript.lang.security.detect-insecure-websocket.detect-insecure-websocket

	if (options.openBrowser !== false) {
		openUrl(url);
	}

	return {
		server,
		host,
		port,
		token,
		url,
		eventsUrl,
		broadcastEvent: event => {
			for (const clientSocket of connectedClients) {
				sendServerEvent(clientSocket, event);
			}
		},
		close: () =>
			closeWebServerWithClients(server, webSocketServer, connectedClients),
	};
}

async function handleClientMessage(
	clientSocket: WebSocket,
	rawMessage: string,
	onClientEvent: LocalWebServerOptions['onClientEvent'],
): Promise<void> {
	let event: WebClientEvent;
	try {
		event = parseWebClientEvent(rawMessage);
	} catch (error) {
		sendServerEvent(clientSocket, {
			type: 'error',
			message: error instanceof Error ? error.message : 'Invalid web event.',
		});
		return;
	}

	if (event.type === 'hello') {
		sendServerEvent(clientSocket, {
			type: 'ready',
			protocolVersion: WEB_PROTOCOL_VERSION,
		});
		return;
	}

	try {
		await onClientEvent?.(event);
	} catch (error) {
		sendServerEvent(clientSocket, {
			type: 'error',
			message:
				error instanceof Error
					? error.message
					: 'Unable to handle browser event.',
		});
		return;
	}

	sendServerEvent(clientSocket, {
		type: 'ack',
		id: event.id,
	});
}

function sendServerEvent(clientSocket: WebSocket, event: WebServerEvent): void {
	if (clientSocket.readyState !== WebSocket.OPEN) {
		return;
	}

	clientSocket.send(serializeWebServerEvent(event));
}

function rejectWebSocketUpgrade(socket: Duplex): void {
	socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
	socket.destroy();
}

function openUrl(url: string): void {
	const platform = process.platform;
	const command =
		platform === 'darwin' ? 'open' : platform === 'win32' ? 'cmd' : 'xdg-open';
	const args = platform === 'win32' ? ['/c', 'start', '', url] : [url];
	// The URL is generated locally from host/port/token and is passed without a shell.
	const child = spawn(command, args, {
		detached: true,
		stdio: 'ignore',
	}); // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
	child.on('error', () => {});
	child.unref();
}

async function closeServer(server: Server): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		server.close(error => {
			if (error) {
				reject(error);
				return;
			}
			resolve();
		});
	});
}

async function closeWebServerWithClients(
	server: Server,
	webSocketServer: WebSocketServer,
	connectedClients: Set<WebSocket>,
): Promise<void> {
	for (const clientSocket of connectedClients) {
		clientSocket.close();
	}
	connectedClients.clear();

	await new Promise<void>(resolve => {
		webSocketServer.close(() => {
			resolve();
		});
	});

	await closeServer(server);
}
