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

const isOpen = (summary: StubElement) =>
	summary.children[1].style.display !== 'none';

const clickHeader = (summary: StubElement) => summary.children[0].onclick();

/**
 * The work the turn's summary holds, in order, one word per activity. The
 * agent's own prose is not in here: it stays outside the summary so a
 * collapsed box can never hide the answer.
 */
const work = (panel: any): string[] => {
	const summary = panel.summaries()[0];
	if (!summary) return [];
	return summary.children[1].children.map((child: StubElement) => {
		if (child.className.includes('tool-aggregator')) return 'tools';
		if (child.className.includes('work-summary-thought')) return 'thoughts';
		if (child.className.includes('tool-card')) return 'edit';
		if (String(child.id).startsWith('plan-card')) return 'plan';
		return 'unknown';
	});
};

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
	t.deepEqual(work(panel), ['tools', 'thoughts', 'tools']);
});

test('reply text between two tool phases starts a fresh card', t => {
	const panel = createPanel();
	runTool(panel, 'r1', 'first.ts');
	panel.text('Here is what I found.');
	runTool(panel, 'r2', 'second.ts');

	const cards = panel.aggregators();
	t.is(cards.length, 2);
	t.deepEqual(rowsOf(cards[1]), ['Reading second.ts']);
	// The reply is not part of the work, so it is not inside the summary - but
	// it still ends the run of tools before it.
	t.deepEqual(work(panel), ['tools', 'tools']);
	t.is(panel.container.querySelectorAll('.agent-markdown').length, 1);
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
	t.deepEqual(work(panel), ['tools', 'edit', 'tools']);
});

test('a plan card between two tool phases starts a fresh card', t => {
	const panel = createPanel();
	runTool(panel, 'r1', 'first.ts');
	sendPlan(panel);
	runTool(panel, 'r2', 'second.ts');

	const cards = panel.aggregators();
	t.is(cards.length, 2);
	t.deepEqual(rowsOf(cards[1]), ['Reading second.ts']);
	t.deepEqual(work(panel), ['tools', 'plan', 'tools']);
});

test('an uninterrupted run of tools stays in one card', t => {
	const panel = createPanel();
	runTool(panel, 'r1', 'first.ts');
	runTool(panel, 'r2', 'second.ts');

	const cards = panel.aggregators();
	t.is(cards.length, 1);
	t.deepEqual(rowsOf(cards[0]), ['Reading first.ts', 'Reading second.ts']);
});

test('each card names how many tools it ran', t => {
	const panel = createPanel();
	runTool(panel, 'r1', 'first.ts');
	t.is(panel.aggregators()[0].children[0].children[0].textContent, 'Tools (1)');

	runTool(panel, 'r2', 'second.ts');
	t.is(panel.aggregators()[0].children[0].children[0].textContent, 'Tools (2)');

	panel.text('Done looking.');
	runTool(panel, 'r3', 'third.ts');
	t.is(panel.aggregators()[1].children[0].children[0].textContent, 'Tools (1)');
});

// ============================================================================
// An unfinished tool keeps its card, so it cannot be duplicated
//
// Closing a card while one of its tools was still running orphaned that tool's
// row: the next update for it built a second row in a new card, leaving the
// first spinning forever.
// ============================================================================

test('a running tool holds its card across an interruption', t => {
	const panel = createPanel();
	startTool(panel, 'r1');
	panel.thought('while that runs');

	t.is(panel.aggregators().length, 1);
	// The summary stays open too, so the running tool is still on screen.
	t.true(isOpen(panel.summaries()[0]));
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
// Collapse belongs to the turn's summary, not to each card
//
// Nesting a collapsible card inside a collapsible summary gave the user two
// headers to fight with to reach one tool, so the cards no longer toggle.
// ============================================================================

test('the tool cards have no collapse control of their own', t => {
	const panel = createPanel();
	runTool(panel, 'r1');

	t.is(panel.aggregators()[0].children[0].onclick, undefined);
});

test('ending the turn does not re-expand a summary the user collapsed', t => {
	const panel = createPanel();
	panel.userMessage('look at this');
	runTool(panel, 'r1');

	clickHeader(panel.summaries()[0]);
	t.false(isOpen(panel.summaries()[0]));

	panel.finish();
	t.false(isOpen(panel.summaries()[0]), 'stays as the user left it');
});

test('ending the turn does not collapse a summary the user opened', t => {
	const panel = createPanel();
	panel.userMessage('look at this');
	runTool(panel, 'r1');

	clickHeader(panel.summaries()[0]);
	clickHeader(panel.summaries()[0]);

	panel.finish();
	t.true(isOpen(panel.summaries()[0]));
});
