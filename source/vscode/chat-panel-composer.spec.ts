/**
 * Composer chrome: model stays on the input row; provider and approval mode
 * live behind the settings popover (#859).
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
		mode: 'normal',
		availableModels: ['sonnet'],
		model: 'sonnet',
	});
};

test('markup keeps model on the row and moves provider and mode into settings', t => {
	const row = slice(PANEL_HTML, 'add-menu-btn', 'send-stop-btn');
	t.true(row.includes('id="model-trigger"'));
	t.true(row.includes('id="composer-settings-trigger"'));
	t.true(row.includes('id="composer-mode-badge"'));
	t.false(row.includes('id="provider-trigger"'));
	t.false(row.includes('id="mode-trigger"'));

	const settings = slice(PANEL_HTML, 'composer-settings', 'model-dropdown');
	t.true(settings.includes('id="provider-trigger"'));
	t.true(settings.includes('id="mode-trigger"'));
	t.true(settings.includes('id="provider-dropdown"'));
	t.true(settings.includes('id="mode-dropdown"'));
	t.true(
		settings.indexOf('id="mode-trigger"') <
			settings.indexOf('id="provider-dropdown"'),
	);
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

test('the gear shows the current approval mode', t => {
	const panel = createPanel();
	syncComposer(panel);
	t.is(panel.byId('composer-mode-badge')?.textContent, 'normal');
	t.true(
		panel
			.byId('composer-settings-trigger')
			?.title.includes('normal'),
	);
});

test('opening a nested provider list keeps composer settings open', t => {
	const panel = createPanel();
	syncComposer(panel);
	panel.byId('composer-settings-trigger')?.click();
	panel.byId('provider-trigger')?.click();

	t.false(panel.byId('composer-settings')?.classList.contains('hidden'));
	t.false(panel.byId('provider-dropdown')?.classList.contains('hidden'));
});

test('opening a nested mode list keeps composer settings open', t => {
	const panel = createPanel();
	syncComposer(panel);
	panel.byId('composer-settings-trigger')?.click();
	panel.byId('mode-trigger')?.click();

	t.false(panel.byId('composer-settings')?.classList.contains('hidden'));
	t.false(panel.byId('mode-dropdown')?.classList.contains('hidden'));
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

	panel.byId('composer-settings-trigger')?.click();
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
	t.is(panel.byId('composer-mode-badge')?.textContent, 'yolo');
});
