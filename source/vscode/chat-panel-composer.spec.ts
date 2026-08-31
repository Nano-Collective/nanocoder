/**
 * Composer chrome: model and mode stay on the input row; provider lives
 * behind the settings popover.
 */
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import test from 'ava';
import {createPanel} from './chat-panel-harness';

const PANEL_HTML = readFileSync(
	fileURLToPath(
		new URL('../../plugins/vscode/media/chat-panel.html', import.meta.url),
	),
	'utf8',
);

const slice = (source: string, startId: string, endId: string) => {
	const start = source.indexOf(`id="${startId}"`);
	const end = source.indexOf(`id="${endId}"`);
	if (start < 0 || end < 0 || end <= start) {
		throw new Error(`could not slice ${startId}..${endId}`);
	}
	return source.slice(start, end);
};

const syncComposer = (panel: ReturnType<typeof createPanel>) => {
	panel.post({
		type: 'syncState',
		availableProviders: ['claude', 'openai'],
		provider: 'claude',
		availableModes: ['normal', 'auto-accept', 'yolo', 'plan'],
		mode: 'auto-accept',
		availableModels: ['sonnet'],
		model: 'sonnet',
	});
};

test('markup groups model and mode on the row while keeping provider in settings', t => {
	const row = slice(PANEL_HTML, 'add-menu-btn', 'send-stop-btn');
	t.true(row.includes('id="model-trigger"'));
	t.true(row.includes('id="mode-trigger"'));
	t.true(row.includes('id="composer-settings-trigger"'));
	t.false(row.includes('id="provider-trigger"'));
	t.false(row.includes('id="composer-mode-badge"'));
	t.true(
		row.indexOf('id="model-trigger"') <
			row.indexOf('id="mode-trigger"'),
	);

	const settings = slice(PANEL_HTML, 'composer-settings', 'model-dropdown');
	t.true(settings.includes('id="provider-trigger"'));
	t.true(settings.includes('id="provider-dropdown"'));
	t.false(settings.includes('id="mode-trigger"'));
	t.false(settings.includes('id="mode-dropdown"'));
	t.false(settings.includes('id="model-trigger"'));
});

test('settings trigger opens the composer settings popover', t => {
	const panel = createPanel();
	t.true(panel.byId('composer-settings')?.classList.contains('hidden'));

	panel.byId('composer-settings-trigger')?.click();

	t.false(panel.byId('composer-settings')?.classList.contains('hidden'));
	t.is(
		panel.byId('composer-settings-trigger')?.getAttribute('aria-expanded'),
		'true',
	);
});

test('the mode dropdown shows a readable label', t => {
	const panel = createPanel();
	syncComposer(panel);
	t.is(panel.byId('mode-trigger-label')?.textContent, 'Auto-Accept');
	t.is(panel.byId('mode-trigger')?.title, 'Auto-Accept');
});

test('opening a nested provider list keeps composer settings open', t => {
	const panel = createPanel();
	syncComposer(panel);
	panel.byId('composer-settings-trigger')?.click();
	panel.byId('provider-trigger')?.click();

	t.false(panel.byId('composer-settings')?.classList.contains('hidden'));
	t.false(panel.byId('provider-dropdown')?.classList.contains('hidden'));
});

test('opening the mode list closes composer settings', t => {
	const panel = createPanel();
	syncComposer(panel);
	panel.byId('composer-settings-trigger')?.click();
	panel.byId('mode-trigger')?.click();

	t.true(panel.byId('composer-settings')?.classList.contains('hidden'));
	t.false(panel.byId('mode-dropdown')?.classList.contains('hidden'));
	t.is(
		panel.byId('composer-settings-trigger')?.getAttribute('aria-expanded'),
		'false',
	);
});

test('opening the model list closes composer settings', t => {
	const panel = createPanel();
	syncComposer(panel);
	panel.byId('composer-settings-trigger')?.click();
	panel.byId('model-trigger')?.click();

	t.true(panel.byId('composer-settings')?.classList.contains('hidden'));
	t.false(panel.byId('model-dropdown')?.classList.contains('hidden'));
	t.is(
		panel.byId('composer-settings-trigger')?.getAttribute('aria-expanded'),
		'false',
	);
});

test('Escape and outside click close composer settings', t => {
	const panel = createPanel();
	panel.byId('composer-settings-trigger')?.click();
	panel.dispatchDocument('keydown', {key: 'Escape'});
	t.true(panel.byId('composer-settings')?.classList.contains('hidden'));

	panel.byId('composer-settings-trigger')?.click();
	panel.dispatchDocument('click');
	t.true(panel.byId('composer-settings')?.classList.contains('hidden'));
});

test('opening the add menu closes composer settings', t => {
	const panel = createPanel();
	panel.byId('composer-settings-trigger')?.click();
	panel.byId('add-menu-btn')?.click();

	t.true(panel.byId('composer-settings')?.classList.contains('hidden'));
	t.false(panel.byId('add-menu-dropdown')?.classList.contains('hidden'));
});

test('provider and mode still post the existing extension messages', t => {
	const panel = createPanel();
	syncComposer(panel);

	panel.byId('composer-settings-trigger')?.click();
	panel.byId('provider-trigger')?.click();
	panel.byId('provider-dropdown')?.children[1].click();
	t.true(
		panel.sent.some(
			(message: {type?: string; provider?: string}) =>
				message.type === 'setProvider' && message.provider === 'openai',
		),
	);

	panel.byId('mode-trigger')?.click();
	panel.byId('mode-dropdown')?.children[1].click();
	t.true(
		panel.sent.some(
			(message: {type?: string; mode?: string}) =>
				message.type === 'setMode' && message.mode === 'auto-accept',
		),
	);

	panel.post({
		type: 'syncState',
		availableProviders: ['claude', 'openai'],
		provider: 'openai',
		availableModes: ['normal', 'auto-accept', 'yolo', 'plan'],
		mode: 'yolo',
		availableModels: ['sonnet'],
		model: 'sonnet',
	});
	t.is(panel.byId('mode-trigger-label')?.textContent, 'YOLO');
});
