import {spawnSync} from 'node:child_process';
import nodeModule from 'node:module';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import test from 'ava';

/*
 * The CLI fast paths (`nanocoder config`, `trust`, `daemon`, `verify`,
 * `init`, `completion`) promise never to load Ink. A single transitive import
 * of a component, such as a config loader logging through the Ink-backed
 * message queue, silently breaks that and makes every one of them pay for the
 * whole TUI stack. Import each entry module in a fresh process and record
 * every module it resolves.
 */

// Resolves each module the child imports and prints the ones that are Ink or
// React. A resolve hook sees ESM and CJS loads alike.
const PROBE = `
import {registerHooks} from 'node:module';
const loaded = new Set();
registerHooks({
	resolve(specifier, context, next) {
		const result = next(specifier, context);
		loaded.add(result.url);
		return result;
	},
});
await import(process.env.PROBE_TARGET);
const ui = [...loaded].filter(url => /\\/node_modules\\/(ink|react)\\//.test(url));
process.stdout.write(JSON.stringify({count: loaded.size, ui}));
`;

const FAST_PATH_MODULES = [
	'source/config/index.ts',
	'source/config/config-cli.ts',
	'source/config/trust-cli.ts',
	'source/daemon/cli.ts',
	'source/verify/cli.ts',
	'source/init/initializer.ts',
	'source/cli-completions/cli.ts',
];

const hasRegisterHooks =
	typeof (nodeModule as {registerHooks?: unknown}).registerHooks ===
	'function';

for (const modulePath of FAST_PATH_MODULES) {
	(hasRegisterHooks ? test : test.skip)(
		`importing ${modulePath} does not load Ink or React`,
		t => {
			t.timeout(60_000);
			const result = spawnSync(
				process.execPath,
				['--import', 'tsx', '--input-type=module', '--eval', PROBE],
				{
					cwd: process.cwd(),
					encoding: 'utf-8',
					env: {
						...process.env,
						PROBE_TARGET: pathToFileURL(join(process.cwd(), modulePath)).href,
					},
				},
			);
			t.is(result.status, 0, result.stderr);
			const {count, ui} = JSON.parse(result.stdout) as {
				count: number;
				ui: string[];
			};
			// Guard against the probe silently seeing nothing.
			t.true(count > 1, 'probe should record the module graph');
			t.deepEqual(ui, [], `${modulePath} pulled in UI modules`);
		},
	);
}
