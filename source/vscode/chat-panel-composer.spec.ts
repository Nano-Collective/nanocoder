/**
 * Composer chrome: model stays on the input row; provider and approval mode
 * live behind the settings popover (#859).
 */
import test from 'ava';
import {createPanel} from './chat-panel-harness';

test('settings trigger opens the composer settings popover', t => {
	const panel = createPanel();
	t.true(panel.byId('composer-settings')?.classList.contains('hidden'));

	panel.byId('composer-settings-trigger')?.click();

	t.false(panel.byId('composer-settings')?.classList.contains('hidden'));
	t.is(panel.byId('composer-settings-trigger')?.getAttribute('aria-expanded'), 'true');
});

test('opening a nested provider list keeps composer settings open', t => {
	const panel = createPanel();
	panel.byId('composer-settings-trigger')?.click();
	panel.byId('provider-trigger')?.click();

	t.false(panel.byId('composer-settings')?.classList.contains('hidden'));
	t.false(panel.byId('provider-dropdown')?.classList.contains('hidden'));
});

test('opening the model list closes composer settings', t => {
	const panel = createPanel();
	panel.byId('composer-settings-trigger')?.click();
	panel.byId('model-trigger')?.click();

	t.true(panel.byId('composer-settings')?.classList.contains('hidden'));
	t.false(panel.byId('model-dropdown')?.classList.contains('hidden'));
});
