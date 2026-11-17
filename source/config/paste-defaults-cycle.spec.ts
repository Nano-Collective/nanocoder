import {spawnSync} from 'node:child_process';
import nodeModule from 'node:module';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import test from 'ava';

/*
 * `@/input/paste-utils` imports the config module, so the config module must
 * not import it back: the cycle meant whichever side loaded second read
 * DEFAULT_SINGLE_LINE_PASTE_THRESHOLD in its temporal dead zone. The constant
 * lives in `@/constants` now. Load the config module in a fresh process and
 * check paste-utils never enters its graph.
 */

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
const config = await import(process.env.PROBE_TARGET);
process.stdout.write(JSON.stringify({
	count: loaded.size,
	pasteUtils: [...loaded].filter(url => url.includes('/input/paste-utils')),
	defaults: config.getDefaultPasteConfig(),
}));
`;

const hasRegisterHooks =
	typeof (nodeModule as {registerHooks?: unknown}).registerHooks ===
	'function';

(hasRegisterHooks ? test : test.skip)(
	'the config module does not import paste-utils (no runtime cycle)',
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
					PROBE_TARGET: pathToFileURL(
						join(process.cwd(), 'source/config/index.ts'),
					).href,
				},
			},
		);
		t.is(result.status, 0, result.stderr);
		const {count, pasteUtils, defaults} = JSON.parse(result.stdout) as {
			count: number;
			pasteUtils: string[];
			defaults: {singleLineThreshold: number};
		};
		t.true(count > 1, 'probe should record the module graph');
		t.deepEqual(pasteUtils, []);
		t.deepEqual(defaults, {singleLineThreshold: 800});
	},
);
