import test from 'ava';
import {loadTuiRenderer} from './load-tui-renderer.js';

const renderTui = (() => {
	throw new Error('not called');
}) as unknown as typeof import('./render-tui.js').renderTui;

function setNodeEnv(value: string | undefined) {
	// Assigning undefined would store the string "undefined".
	if (value === undefined) {
		delete process.env.NODE_ENV;
	} else {
		process.env.NODE_ENV = value;
	}
}

async function withNodeEnv(value: string | undefined, run: () => Promise<void>) {
	const saved = process.env.NODE_ENV;
	setNodeEnv(value);
	try {
		await run();
	} finally {
		setNodeEnv(saved);
	}
}

test.serial(
	'loadTuiRenderer imports the renderer with NODE_ENV=production and unsets it again',
	async t => {
		await withNodeEnv(undefined, async () => {
			let duringImport: string | undefined;
			const loaded = await loadTuiRenderer(async () => {
				duringImport = process.env.NODE_ENV;
				return {renderTui};
			});

			t.is(loaded, renderTui);
			t.is(duringImport, 'production');
			t.false('NODE_ENV' in process.env);
		});
	},
);

test.serial('loadTuiRenderer keeps an explicit NODE_ENV', async t => {
	await withNodeEnv('development', async () => {
		let duringImport: string | undefined;
		await loadTuiRenderer(async () => {
			duringImport = process.env.NODE_ENV;
			return {renderTui};
		});

		t.is(duringImport, 'development');
		t.is(process.env.NODE_ENV, 'development');
	});
});

test.serial('loadTuiRenderer unsets NODE_ENV when the import fails', async t => {
	await withNodeEnv(undefined, async () => {
		await t.throwsAsync(
			loadTuiRenderer(async () => {
				throw new Error('import failed');
			}),
			{message: 'import failed'},
		);
		t.false('NODE_ENV' in process.env);
	});
});
