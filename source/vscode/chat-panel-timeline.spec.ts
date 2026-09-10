/**
 * Covers the action-timeline strip in the VS Code chat panel: rendering,
 * the confirm-before-revert flow, and the in-turn lockout.
 */
import test from 'ava';
import {createPanel, type StubElement} from './chat-panel-harness';

const CHECKPOINT = {
	id: 'cp-1',
	seq: 1,
	toolCallId: 'call-1',
	toolName: 'write_file',
	title: 'write_file: src/a.ts',
	timestamp: '2023-11-14T22:13:20.000Z',
	filesChanged: ['src/a.ts'],
};

const SECOND = {
	...CHECKPOINT,
	id: 'cp-2',
	seq: 2,
	toolCallId: 'call-2',
	toolName: 'execute_bash',
	title: 'execute_bash',
	filesChanged: ['src/a.ts', 'src/b.ts'],
};

/** Every node the strip rendered, including the trailing "now" marker. */
function nodes(panel: ReturnType<typeof createPanel>): StubElement[] {
	const container = panel.byId('timeline-nodes');
	return container ? container.querySelectorAll('.timeline-node') : [];
}

test('timeline strip hides itself when there are no checkpoints', t => {
	const panel = createPanel();
	panel.post({type: 'updateTimeline', entries: []});

	t.true(panel.byId('timeline-strip')?.classList.contains('hidden'));
	t.is(nodes(panel).length, 0);
});

test('timeline strip renders one node per checkpoint plus a now marker', t => {
	const panel = createPanel();
	panel.post({type: 'updateTimeline', entries: [CHECKPOINT, SECOND]});

	t.false(panel.byId('timeline-strip')?.classList.contains('hidden'));
	const rendered = nodes(panel);
	t.is(rendered.length, 3);
	t.is(rendered[0].dataset.id, 'cp-1');
	t.is(rendered[0].dataset.kind, 'edit');
	t.is(rendered[1].dataset.kind, 'execute');
	t.is(rendered[2].dataset.kind, 'now');
	t.true(rendered[2].className.includes('is-selected'));
});

test('timeline node labels name the step and its files', t => {
	const panel = createPanel();
	panel.post({type: 'updateTimeline', entries: [CHECKPOINT]});

	const label = nodes(panel)[0].getAttribute('aria-label');
	t.true(label.includes('Step 1'));
	t.true(label.includes('write_file: src/a.ts'));
	t.true(label.includes('src/a.ts'));
});

test('hovering a node writes its label to the hint line', t => {
	const panel = createPanel();
	panel.post({type: 'updateTimeline', entries: [CHECKPOINT]});

	const node = nodes(panel)[0];
	node.dispatch('mouseenter');
	t.true(panel.byId('timeline-hint')?.textContent.includes('Step 1'));

	node.dispatch('mouseleave');
	t.is(panel.byId('timeline-hint')?.textContent, '');
});

test('focusing a node writes the hint too, so it is not hover-only', t => {
	const panel = createPanel();
	panel.post({type: 'updateTimeline', entries: [CHECKPOINT]});

	nodes(panel)[0].dispatch('focus');
	t.true(panel.byId('timeline-hint')?.textContent.includes('Step 1'));
});

test('clicking a node asks for confirmation instead of reverting', t => {
	const panel = createPanel();
	panel.post({type: 'updateTimeline', entries: [CHECKPOINT]});

	nodes(panel)[0].click();

	const confirm = panel.byId('timeline-confirm') as StubElement;
	t.false(confirm.classList.contains('hidden'));
	t.deepEqual(
		panel.sent.filter(
			(message: any) => message.type === 'revertToCheckpoint',
		),
		[],
		'no revert is requested until the user confirms',
	);
});

test('confirming a revert posts the checkpoint id and closes the prompt', t => {
	const panel = createPanel();
	panel.post({type: 'updateTimeline', entries: [CHECKPOINT, SECOND]});

	nodes(panel)[1].click();
	const confirm = panel.byId('timeline-confirm') as StubElement;
	const buttons = confirm.querySelectorAll('button');
	t.is(buttons.length, 2);
	buttons[0].click();

	t.deepEqual(panel.sent.at(-1), {
		type: 'revertToCheckpoint',
		checkpointId: 'cp-2',
	});
	t.true(confirm.classList.contains('hidden'));
});

test('cancelling closes the prompt without reverting', t => {
	const panel = createPanel();
	panel.post({type: 'updateTimeline', entries: [CHECKPOINT]});

	nodes(panel)[0].click();
	const confirm = panel.byId('timeline-confirm') as StubElement;
	confirm.querySelectorAll('button')[1].click();

	t.true(confirm.classList.contains('hidden'));
	t.deepEqual(
		panel.sent.filter(
			(message: any) => message.type === 'revertToCheckpoint',
		),
		[],
	);
});

test('a new entry list drops any open confirmation', t => {
	const panel = createPanel();
	panel.post({type: 'updateTimeline', entries: [CHECKPOINT]});
	nodes(panel)[0].click();

	panel.post({type: 'updateTimeline', entries: [CHECKPOINT, SECOND]});
	t.true(panel.byId('timeline-confirm')?.classList.contains('hidden'));
});

test('the strip locks while a turn is running and unlocks after it', t => {
	const panel = createPanel();
	panel.post({type: 'updateTimeline', entries: [CHECKPOINT]});
	const strip = panel.byId('timeline-strip') as StubElement;

	panel.post({type: 'runPrompt', text: 'keep going'});
	t.true(strip.classList.contains('timeline-disabled'));

	panel.finish();
	t.false(strip.classList.contains('timeline-disabled'));
});

test('a revert clear keeps the strip, a plain clear empties it', t => {
	const panel = createPanel();
	panel.post({type: 'updateTimeline', entries: [CHECKPOINT]});

	// The provider clears with isLoading before flushing a revert's replay.
	panel.post({type: 'clear', isLoading: true});
	t.is(nodes(panel).length, 2);

	panel.post({type: 'clear'});
	t.true(panel.byId('timeline-strip')?.classList.contains('hidden'));
});
