import test from 'ava';
import {createPanel, type StubElement} from '@/vscode/chat-panel-harness';

console.log('\nchat-panel-tool-aggregation.spec.ts');

// ============================================================================
// Helpers
// ============================================================================

/** A non-edit call that starts running and stays unfinished. */
const startTool = (panel: any, toolCallId: string, path = 'src/a.ts') =>
	panel.update({
		sessionUpdate: 'tool_call',
		toolCallId,
		title: `read_file: ${path}`,
		kind: 'read',
		status: 'in_progress',
	});

const finishTool = (panel: any, toolCallId: string) =>
	panel.update({
		sessionUpdate: 'tool_call_update',
		toolCallId,
		status: 'completed',
	});

/** A call that runs to completion, so the phase it belongs to is idle. */
const runTool = (panel: any, toolCallId: string, path?: string) => {
	startTool(panel, toolCallId, path);
	finishTool(panel, toolCallId);
};

const runEdit = (panel: any, toolCallId = 'edit-1') => {
	panel.update({
		sessionUpdate: 'tool_call',
		toolCallId,
		title: 'write_file: src/b.ts',
		kind: 'edit',
		status: 'in_progress',
	});
	finishTool(panel, toolCallId);
};

const sendPlan = (panel: any) =>
	panel.update({
		sessionUpdate: 'plan',
		entries: [{content: 'Do the thing', status: 'in_progress'}],
	});

/** The tools listed in one aggregated card, top to bottom. */
const rowsOf = (card: StubElement): string[] =>
	card.querySelectorAll('.tool-label').map((row: StubElement) => row.textContent);

const isOpen = (card: StubElement) => card.children[1].style.display !== 'none';

const collapse = (card: StubElement) => card.children[0].onclick();

/** What the transcript holds, in order, one word per element. */
const transcript = (panel: any): string[] =>
	panel.container.children.map((child: StubElement) => {
		if (child.className.includes('tool-aggregator')) return 'tools';
		if (child.className.includes('thought-aggregator')) return 'thoughts';
		if (child.className.includes('tool-card')) return 'edit';
		if (String(child.id).startsWith('plan-card')) return 'plan';
		return 'text';
	});

// ============================================================================
// A finished tool phase closes when anything else is inserted (#856)
//
// The aggregated card used to be reset only at the end of a turn, so a tool
// arriving after an interruption was appended to the card ABOVE whatever the
// agent had just inserted, putting the transcript out of order.
// ============================================================================

test('a thought between two tool phases starts a fresh card', t => {
	const panel = createPanel();
	runTool(panel, 'r1', 'first.ts');
	panel.thought('considering');
	runTool(panel, 'r2', 'second.ts');

	const cards = panel.aggregators();
	t.is(cards.length, 2);
	t.deepEqual(rowsOf(cards[0]), ['Reading first.ts']);
	t.deepEqual(rowsOf(cards[1]), ['Reading second.ts']);
	t.deepEqual(transcript(panel), ['tools', 'thoughts', 'tools']);
});

test('reply text between two tool phases starts a fresh card', t => {
	const panel = createPanel();
	runTool(panel, 'r1', 'first.ts');
	panel.text('Here is what I found.');
	runTool(panel, 'r2', 'second.ts');

	const cards = panel.aggregators();
	t.is(cards.length, 2);
	t.deepEqual(rowsOf(cards[1]), ['Reading second.ts']);
	t.deepEqual(transcript(panel), ['tools', 'text', 'tools']);
});

test('an edit card between two tool phases starts a fresh card', t => {
	const panel = createPanel();
	runTool(panel, 'r1', 'first.ts');
	runEdit(panel);
	runTool(panel, 'r2', 'second.ts');

	const cards = panel.aggregators();
	t.is(cards.length, 2);
	// The read after the edit must not fall back into the card above it.
	t.deepEqual(rowsOf(cards[0]), ['Reading first.ts']);
	t.deepEqual(rowsOf(cards[1]), ['Reading second.ts']);
	t.deepEqual(transcript(panel), ['tools', 'edit', 'tools']);
});

test('a plan card between two tool phases starts a fresh card', t => {
	const panel = createPanel();
	runTool(panel, 'r1', 'first.ts');
	sendPlan(panel);
	runTool(panel, 'r2', 'second.ts');

	const cards = panel.aggregators();
	t.is(cards.length, 2);
	t.deepEqual(rowsOf(cards[1]), ['Reading second.ts']);
	t.deepEqual(transcript(panel), ['tools', 'plan', 'tools']);
});

test('an uninterrupted run of tools stays in one card', t => {
	const panel = createPanel();
	runTool(panel, 'r1', 'first.ts');
	runTool(panel, 'r2', 'second.ts');

	const cards = panel.aggregators();
	t.is(cards.length, 1);
	t.deepEqual(rowsOf(cards[0]), ['Reading first.ts', 'Reading second.ts']);
});

test('a finished phase collapses once the agent moves on', t => {
	const panel = createPanel();
	runTool(panel, 'r1');
	t.true(isOpen(panel.aggregators()[0]), 'stays open while it is the phase');

	panel.text('Done looking.');
	t.false(isOpen(panel.aggregators()[0]));
});

// ============================================================================
// An unfinished tool keeps its card, so it cannot be duplicated
//
// Closing a card while one of its tools was still running orphaned that tool's
// row: the next update for it built a second row in a new card, leaving the
// first spinning forever.
// ============================================================================

test('a running tool holds its card open across an interruption', t => {
	const panel = createPanel();
	startTool(panel, 'r1');
	panel.thought('while that runs');

	t.is(panel.aggregators().length, 1);
	t.true(isOpen(panel.aggregators()[0]));
});

test('a running tool interrupted mid-flight is not duplicated', t => {
	const panel = createPanel();
	startTool(panel, 'r1');
	panel.thought('while that runs');
	finishTool(panel, 'r1');

	const cards = panel.aggregators();
	t.is(cards.length, 1, 'the late completion reuses the original card');
	t.deepEqual(rowsOf(cards[0]), ['Reading src/a.ts']);
	t.is(panel.container.querySelectorAll('.tool-status').length, 1);
});

test('a queued tool also holds its card open', t => {
	const panel = createPanel();
	// 'pending' is the queued announcement, before the call starts running.
	panel.update({
		sessionUpdate: 'tool_call',
		toolCallId: 'r1',
		title: 'read_file: src/a.ts',
		kind: 'read',
		status: 'pending',
	});
	panel.text('Queued that up.');
	finishTool(panel, 'r1');

	const cards = panel.aggregators();
	t.is(cards.length, 1);
	t.deepEqual(rowsOf(cards[0]), ['Reading src/a.ts']);
});

test('a phase closes once its last tool finishes', t => {
	const panel = createPanel();
	startTool(panel, 'r1', 'first.ts');
	finishTool(panel, 'r1');
	panel.text('All done.');
	runTool(panel, 'r2', 'second.ts');

	t.is(panel.aggregators().length, 2);
});

// ============================================================================
// A manual collapse survives the card being closed
//
// close() collapsed by calling toggle(false), but toggle ignored its argument
// and simply flipped, so closing a card the user had already collapsed
// re-expanded it.
// ============================================================================

test('closing does not re-expand a card the user collapsed', t => {
	const panel = createPanel();
	runTool(panel, 'r1');

	collapse(panel.aggregators()[0]);
	t.false(isOpen(panel.aggregators()[0]));

	panel.text('Moving on.');
	t.false(isOpen(panel.aggregators()[0]), 'stays as the user left it');
});

test('a collapsed card can still be reopened by hand', t => {
	const panel = createPanel();
	runTool(panel, 'r1');

	collapse(panel.aggregators()[0]);
	panel.text('Moving on.');
	collapse(panel.aggregators()[0]);

	t.true(isOpen(panel.aggregators()[0]));
});
