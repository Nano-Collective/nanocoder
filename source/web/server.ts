import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {createServer, type Server} from 'node:http';

export interface LocalWebServerOptions {
	host?: string;
	port?: number;
	token?: string;
	openBrowser?: boolean;
}

export interface LocalWebServer {
	server: Server;
	host: string;
	port: number;
	token: string;
	url: string;
	close: () => Promise<void>;
}

const DEFAULT_HOST = '127.0.0.1';

export function createLocalWebToken(): string {
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
		response.end(renderPlaceholderPage());
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

	if (options.openBrowser !== false) {
		openUrl(url);
	}

	return {
		server,
		host,
		port,
		token,
		url,
		close: () => closeServer(server),
	};
}

function openUrl(url: string): void {
	const platform = process.platform;
	const command =
		platform === 'darwin' ? 'open' : platform === 'win32' ? 'cmd' : 'xdg-open';
	const args = platform === 'win32' ? ['/c', 'start', '', url] : [url];
	const child = spawn(command, args, {
		detached: true,
		stdio: 'ignore',
	});
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

function renderPlaceholderPage(): string {
	return `<!doctype html>
<html lang="en">
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<title>Nanocoder Web Mode</title>
	<style>
		:root {
			color-scheme: light dark;
			font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
			background: #111315;
			color: #f7f7f2;
		}
		body {
			margin: 0;
			min-height: 100vh;
			display: grid;
			place-items: center;
			background:
				radial-gradient(circle at 20% 20%, rgba(99, 102, 241, 0.16), transparent 28rem),
				linear-gradient(135deg, #111315 0%, #191b1f 100%);
		}
		main {
			width: min(680px, calc(100vw - 48px));
		}
		.status {
			display: inline-flex;
			align-items: center;
			gap: 8px;
			margin-bottom: 18px;
			color: #b8f3d4;
			font-size: 14px;
			font-weight: 600;
		}
		.status::before {
			content: "";
			width: 9px;
			height: 9px;
			border-radius: 999px;
			background: #55d98d;
			box-shadow: 0 0 0 5px rgba(85, 217, 141, 0.14);
		}
		h1 {
			font-size: clamp(36px, 8vw, 68px);
			line-height: 1.1;
			letter-spacing: 0;
			margin: 0 0 18px;
		}
		p {
			color: #c9ccd3;
			font-size: 18px;
			line-height: 1.6;
			margin: 0;
		}
		.note {
			margin-top: 28px;
			color: #8f96a3;
			font-size: 14px;
		}
	</style>
</head>
<body>
	<main>
		<div class="status">Local session ready</div>
		<h1>Nanocoder web mode</h1>
		<p>Your browser connection is live. Keep the terminal open for chat, tool approvals, and agent output while the full workspace view is being wired into this page.</p>
		<p class="note">This page is served only from your machine and requires the private URL token.</p>
	</main>
</body>
</html>`;
}
