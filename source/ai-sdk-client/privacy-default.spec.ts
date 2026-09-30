import {createServer, type Server} from 'node:http';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {AISDKClient} from '@/ai-sdk-client';
import {updatePrivacyPreference} from '@/config/preferences';
import type {AIProviderConfig} from '@/types/config';

// Scrubbing is a user preference. Only the TUI passed it through to the
// client, so --plain, ACP (the VS Code extension) and subagents sent secrets
// in the clear with scrubbing switched on. The client now falls back to the
// preference when a caller does not say.

const SECRET = 'sk-live-abcdef1234567890abcdef1234567890';

function startCapturingServer(): Promise<{
	server: Server;
	port: number;
	bodies: string[];
}> {
	const bodies: string[] = [];
	const server = createServer((req, res) => {
		let body = '';
		req.on('data', chunk => {
			body += chunk;
		});
		req.on('end', () => {
			bodies.push(body);
			res.writeHead(200, {'Content-Type': 'text/event-stream'});
			const base = {id: 'x', object: 'chat.completion.chunk', created: 0, model: 'm'};
			res.write(
				`data: ${JSON.stringify({...base, choices: [{index: 0, delta: {role: 'assistant', content: 'ok'}, finish_reason: null}]})}\n\n`,
			);
			res.write(
				`data: ${JSON.stringify({...base, choices: [{index: 0, delta: {}, finish_reason: 'stop'}]})}\n\n`,
			);
			res.end('data: [DONE]\n\n');
		});
	});
	return new Promise(resolve => {
		server.listen(0, '127.0.0.1', () => {
			const address = server.address();
			const port = typeof address === 'object' && address ? address.port : 0;
			resolve({server, port, bodies});
		});
	});
}

test.serial(
	'the client scrubs by preference when the caller passes no privacy settings',
	async t => {
		const originalConfigDir = process.env.NANOCODER_CONFIG_DIR;
		const configDir = mkdtempSync(join(tmpdir(), 'privacy-default-'));
		process.env.NANOCODER_CONFIG_DIR = configDir;
		const {server, port, bodies} = await startCapturingServer();
		try {
			updatePrivacyPreference(true);
			const config: AIProviderConfig = {
				name: 'Local',
				type: 'openai-compatible',
				models: ['m'],
				config: {baseURL: `http://127.0.0.1:${port}/v1`, apiKey: 'x'},
			};
			const client = await AISDKClient.create(config);

			await client.chat(
				[{role: 'user', content: `my key is ${SECRET}`}],
				{},
				{},
			);

			t.is(bodies.length, 1);
			t.false(bodies[0]?.includes(SECRET));
		} finally {
			server.close();
			rmSync(configDir, {recursive: true, force: true});
			if (originalConfigDir === undefined) {
				delete process.env.NANOCODER_CONFIG_DIR;
			} else {
				process.env.NANOCODER_CONFIG_DIR = originalConfigDir;
			}
		}
	},
);
