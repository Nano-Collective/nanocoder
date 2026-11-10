import test from 'ava';
import {render} from 'ink-testing-library';
import React from 'react';
import {themes} from '@/config/themes';
import {ThemeContext} from '@/hooks/useTheme';
import {TitleShapeContext} from '@/hooks/useTitleShape';
import type {ToolManager} from '@/tools/tool-manager';
import {MCP, MCPLoginFlow, handleMcpArgs, mcpCommand} from './mcp.js';

console.log(`\nmcp.spec.tsx`);

function renderThemed(element: React.ReactElement) {
	const themeContextValue = {
		currentTheme: 'tokyo-night' as const,
		colors: themes['tokyo-night'].colors,
		setCurrentTheme: () => {},
	};
	const wrap = (node: React.ReactElement) => (
		<ThemeContext.Provider value={themeContextValue}>
			<TitleShapeContext.Provider
				value={{
					currentTitleShape: 'pill',
					setCurrentTitleShape: () => {},
					commitTitleShape: () => {},
				}}
			>
				{node}
			</TitleShapeContext.Provider>
		</ThemeContext.Provider>
	);
	const result = render(wrap(element));
	return {
		...result,
		rerender: (node: React.ReactElement) => result.rerender(wrap(node)),
	};
}

function fakeToolManager(overrides: Partial<ToolManager> = {}): ToolManager {
	return {
		getServerNames: () => [],
		getConnectedServers: () => [],
		getServerTools: () => [],
		getServerInfo: () => undefined,
		getMCPClient: () => null,
		onMCPHealthChange: () => () => {},
		getAuthRequiredMCPServers: () => [],
		loginToMCPServer: async () => {},
		logoutFromMCPServer: async () => {},
		...overrides,
	} as unknown as ToolManager;
}

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

test('mcp command is registered with its name and description', t => {
	t.is(mcpCommand.name, 'mcp');
	t.regex(mcpCommand.description, /login/);
});

test('/mcp lists servers that require authentication', t => {
	const toolManager = fakeToolManager({
		getAuthRequiredMCPServers: () => ['notion'],
	});
	const {lastFrame, unmount} = renderThemed(<MCP toolManager={toolManager} />);
	const frame = lastFrame() ?? '';
	t.regex(frame, /Authentication required \(1\)/);
	t.regex(frame, /\/mcp login notion/);
	t.notRegex(frame, /No MCP servers connected/);
	unmount();
});

test('/mcp with no servers keeps the empty-state help', t => {
	const {lastFrame, unmount} = renderThemed(
		<MCP toolManager={fakeToolManager()} />,
	);
	t.regex(lastFrame() ?? '', /No MCP servers connected/);
	unmount();
});

test('/mcp rejects unknown subcommands and missing server names', async t => {
	for (const args of [['frobnicate'], ['login'], ['logout'], ['login', 'a', 'b']]) {
		const element = await handleMcpArgs(args, fakeToolManager());
		const {lastFrame, unmount} = renderThemed(element);
		t.regex(lastFrame() ?? '', /Usage: \/mcp/);
		unmount();
	}
});

test('/mcp login starts the flow once and shows URL, then success', async t => {
	let calls = 0;
	let reportUrl: ((url: URL) => void) | undefined;
	let finish: (() => void) | undefined;
	const toolManager = fakeToolManager({
		loginToMCPServer: (_name: string, onUrl?: (url: URL) => void) => {
			calls++;
			reportUrl = onUrl;
			return new Promise<void>(resolve => {
				finish = resolve;
			});
		},
	});

	const element = await handleMcpArgs(['login', 'notion'], toolManager);
	const {lastFrame, rerender, unmount} = renderThemed(element);
	t.regex(lastFrame() ?? '', /Contacting the authorization server/);

	reportUrl?.(new URL('https://auth.example.com/authorize?client_id=x'));
	await wait(10);
	t.regex(lastFrame() ?? '', /https:\/\/auth\.example\.com\/authorize\?client_id=x/);

	// Re-rendering the same element must not start a second flow.
	rerender(element);
	await wait(10);
	t.is(calls, 1);

	finish?.();
	await wait(10);
	t.regex(lastFrame() ?? '', /Signed in to notion/);
	unmount();
});

test('/mcp login shows the error when the flow fails', async t => {
	const toolManager = fakeToolManager({
		loginToMCPServer: async () => {
			throw new Error('server said no');
		},
	});
	const element = await handleMcpArgs(['login', 'notion'], toolManager);
	const {lastFrame, unmount} = renderThemed(element);
	await wait(10);
	t.regex(lastFrame() ?? '', /Login failed: server said no/);
	unmount();
});

test('/mcp logout reports success and failure', async t => {
	let loggedOut = '';
	const ok = await handleMcpArgs(
		['logout', 'notion'],
		fakeToolManager({
			logoutFromMCPServer: async (name: string) => {
				loggedOut = name;
			},
		}),
	);
	t.is(loggedOut, 'notion');
	const okRender = renderThemed(ok);
	t.regex(okRender.lastFrame() ?? '', /Signed out of notion/);
	okRender.unmount();

	const failed = await handleMcpArgs(
		['logout', 'notion'],
		fakeToolManager({
			logoutFromMCPServer: async () => {
				throw new Error('unknown server');
			},
		}),
	);
	const failedRender = renderThemed(failed);
	t.regex(failedRender.lastFrame() ?? '', /Logout failed: unknown server/);
	failedRender.unmount();
});

test('MCPLoginFlow delivers the current state, then updates in order', async t => {
	const seen: string[] = [];
	const flow = new MCPLoginFlow('srv', async onUrl => {
		await wait(1);
		onUrl(new URL('https://a.example/x'));
	});
	flow.subscribe(state => seen.push(state.status));
	await wait(20);
	t.deepEqual(seen, ['starting', 'visit', 'done']);
	t.is(flow.getState().authorizationUrl, 'https://a.example/x');
});
