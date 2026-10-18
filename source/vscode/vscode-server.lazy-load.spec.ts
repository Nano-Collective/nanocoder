import test from 'ava';
import {createRequire} from 'node:module';

/**
 * `ws` is a CommonJS package, so a dynamic `import('ws')` populates
 * `require.cache` as a side effect. Checking the cache is a reliable way to
 * assert whether the package has been loaded in this process — and this
 * spec file must never import `ws` itself, or the cache check would be
 * seeded before the assertions run.
 */
const require = createRequire(import.meta.url);

function loadedWsModules(): string[] {
	return Object.keys(require.cache).filter(path =>
		/[\\/]node_modules[\\/]ws[\\/]/.test(path),
	);
}

test.serial('importing vscode-server does not load the ws package', async t => {
	t.deepEqual(loadedWsModules(), []);

	await import('./vscode-server.js');

	t.deepEqual(
		loadedWsModules(),
		[],
		'importing the module should leave ws out of the module graph (#1821)',
	);
});

test.serial('starting the VS Code server loads the ws package', async t => {
	const {VSCodeServer} = await import('./vscode-server.js');

	const server = new VSCodeServer(0, {
		token: 'lazy-ws-test-token-not-for-production',
	});
	t.true(await server.start());
	await server.stop();

	t.true(
		loadedWsModules().length > 0,
		'starting the server should load the ws package',
	);
});
