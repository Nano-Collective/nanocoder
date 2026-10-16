/**
 * Composer chrome: model stays on the input row; provider and mode live
 * behind the settings popover using the same dropdown style as the model
 * selector.
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

test('markup keeps model on the row and puts provider and mode in settings', t => {
	const row = slice(PANEL_HTML, 'add-menu-btn', 'send-stop-btn');
	t.true(row.includes('id="model-trigger"'));
	t.false(row.includes('id="mode-trigger"'));
	t.true(row.includes('id="composer-settings-trigger"'));
	t.false(row.includes('id="provider-trigger"'));

	const settings = slice(PANEL_HTML, 'composer-settings', 'model-dropdown');
	t.true(settings.includes('id="provider-trigger"'));
	t.true(settings.includes('id="mode-trigger"'));
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

test('provider dropdown shows a readable label and matching items', t => {
	const panel = createPanel();
	syncComposer(panel);
	t.is(panel.byId('provider-trigger-label')?.textContent, 'claude');
	t.is(panel.byId('provider-trigger')?.getAttribute('aria-haspopup'), 'menu');
	t.is(
		panel.byId('provider-trigger')?.getAttribute('aria-controls'),
		'provider-dropdown',
	);
	t.is(panel.byId('provider-trigger')?.getAttribute('aria-expanded'), 'false');
	t.is(panel.byId('provider-dropdown')?.children[0].textContent, 'claude');
	t.is(panel.byId('provider-dropdown')?.children[1].textContent, 'openai');
});

test('mode dropdown shows a readable label and matching items', t => {
	const panel = createPanel();
	syncComposer(panel);
	t.is(panel.byId('mode-trigger-label')?.textContent, 'Auto-Accept');
	t.is(panel.byId('mode-trigger')?.title, 'Mode: Auto-Accept');
	t.is(panel.byId('mode-trigger')?.getAttribute('aria-label'), 'Mode: Auto-Accept');
	t.is(panel.byId('mode-trigger')?.getAttribute('aria-haspopup'), 'menu');
	t.is(panel.byId('mode-trigger')?.getAttribute('aria-controls'), 'mode-dropdown');
	t.is(panel.byId('mode-trigger')?.getAttribute('aria-expanded'), 'false');
	t.is(panel.byId('mode-dropdown')?.children[0].textContent, 'Normal');
	t.is(panel.byId('mode-dropdown')?.children[1].textContent, 'Auto-Accept');
});

test('toggling a nested provider list keeps composer settings open', t => {
	const panel = createPanel();
	syncComposer(panel);
	panel.byId('composer-settings-trigger')?.click();
	panel.byId('provider-trigger')?.click();

	t.false(panel.byId('composer-settings')?.classList.contains('hidden'));
	t.false(panel.byId('provider-dropdown')?.classList.contains('hidden'));

	panel.byId('provider-trigger')?.click();
	t.false(panel.byId('composer-settings')?.classList.contains('hidden'));
	t.true(panel.byId('provider-dropdown')?.classList.contains('hidden'));
});

test('toggling the mode list keeps composer settings open', t => {
	const panel = createPanel();
	syncComposer(panel);
	panel.byId('composer-settings-trigger')?.click();
	panel.byId('mode-trigger')?.click();

	t.false(panel.byId('composer-settings')?.classList.contains('hidden'));
	t.false(panel.byId('mode-dropdown')?.classList.contains('hidden'));
	t.is(panel.byId('mode-trigger')?.getAttribute('aria-expanded'), 'true');
	t.is(
		panel.byId('composer-settings-trigger')?.getAttribute('aria-expanded'),
		'true',
	);

	panel.byId('mode-trigger')?.click();
	t.false(panel.byId('composer-settings')?.classList.contains('hidden'));
	t.true(panel.byId('mode-dropdown')?.classList.contains('hidden'));
	t.is(panel.byId('mode-trigger')?.getAttribute('aria-expanded'), 'false');
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
			// biome-ignore lint/suspicious/noExplicitAny: testing arbitrary extension messages
			(message: any) =>
				message.type === 'setProvider' && message.provider === 'openai',
		),
	);

	panel.byId('mode-trigger')?.click();
	panel.byId('mode-dropdown')?.children[2].click();
	t.true(
		panel.sent.some(
			// biome-ignore lint/suspicious/noExplicitAny: testing arbitrary extension messages
			(message: any) =>
				message.type === 'setMode' && message.mode === 'yolo',
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

test('model dropdown labels keep provider prefixes out of the trigger and items', t => {
	const panel = createPanel();
	panel.post({
		type: 'syncState',
		availableProviders: ['openrouter'],
		provider: 'openrouter',
		availableModes: ['normal'],
		mode: 'normal',
		availableModels: ['anthropic/claude-sonnet-4-5', 'openai/gpt-5-codex'],
		model: 'anthropic/claude-sonnet-4-5',
	});

	t.is(panel.byId('model-trigger-label')?.textContent, 'claude-sonnet-4-5');
	t.is(panel.byId('model-dropdown')?.children[0].textContent, 'claude-sonnet-4-5');
	t.is(panel.byId('model-dropdown')?.children[1].textContent, 'gpt-5-codex');
});

test('clicking a disabled element does not dispatch events (harness coverage)', t => {
	const panel = createPanel();
	const btn = panel.byId('add-menu-btn');
	if (!btn) return t.fail('Button not found');
	
	let clicked = false;
	btn.addEventListener('click', () => {
		clicked = true;
	});
	btn.disabled = true;
	btn.click();
	t.false(clicked);
});

test('removeEventListener removes the listener (harness coverage)', t => {
	const panel = createPanel();
	const btn = panel.byId('add-menu-btn');
	if (!btn) return t.fail('Button not found');
	
	let clicks = 0;
	const listener = () => {
		clicks++;
	};
	btn.addEventListener('click', listener);
	btn.click();
	t.is(clicks, 1);
	
	btn.removeEventListener('click', listener);
	btn.click();
	t.is(clicks, 1);
});
