import test from 'ava';
import {createPanel, type StubElement} from '@/vscode/chat-panel-harness';

console.log('\nchat-panel-tool-cards.spec.ts');

// ============================================================================
// Helpers
// ============================================================================

const DIFF = [
	{type: 'diff', path: '/repo/src/a.ts', oldText: 'old', newText: 'new'},
];

/**
 * The announcement the agent emits for every call in a queued batch. It names
 * the file through `locations` but withholds the diff until the call is about
 * to run - see the announcedBatch branch in acp-conversation.ts.
 */
const announceEdit = (panel: any, toolCallId = 'call-1') =>
	panel.update({
		sessionUpdate: 'tool_call',
		toolCallId,
		title: 'write_file: src/a.ts',
		kind: 'edit',
		status: 'pending',
		locations: [{path: '/repo/src/a.ts'}],
	});

/** The content-bearing emit sent just before the call runs. */
const readyEdit = (panel: any, toolCallId = 'call-1') =>
	panel.update({
		sessionUpdate: 'tool_call_update',
		toolCallId,
		title: 'write_file: src/a.ts',
		kind: 'edit',
		status: 'pending',
		content: DIFF,
	});

const editCard = (panel: any): StubElement =>
	panel.container.querySelector('.tool-card');

const actionText = (card: StubElement) =>
	card.querySelector('.tool-card-action').textContent;

const fileText = (card: StubElement) =>
	card.querySelector('.tool-card-action').parentElement.children[1].textContent;

const diffBtn = (card: StubElement) => card.querySelector('.tool-card-diff-btn');

const clickCard = (card: StubElement) =>
	card.querySelector('.tool-card-row').onclick();

const showDiffMessages = (panel: any) =>
	panel.sent.filter((m: any) => m && m.type === 'showDiff');

// ============================================================================
// The queued edit card does not claim the edit already happened
// ============================================================================

test('an announced edit reads "Edit", not "Edited"', t => {
	const panel = createPanel();
	announceEdit(panel);

	const card = editCard(panel);
	t.truthy(card, 'the announcement creates a card');
	t.is(actionText(card), 'Edit');
	t.is(fileText(card), 'a.ts');
});

test('the label follows the call through its lifecycle', t => {
	const panel = createPanel();
	announceEdit(panel);
	t.is(actionText(editCard(panel)), 'Edit');

	panel.update({
		sessionUpdate: 'tool_call_update',
		toolCallId: 'call-1',
		status: 'in_progress',
	});
	t.is(actionText(editCard(panel)), 'Editing');

	panel.update({
		sessionUpdate: 'tool_call_update',
		toolCallId: 'call-1',
		status: 'completed',
	});
	t.is(actionText(editCard(panel)), 'Edited');
});

test('a cancelled edit does not read as a failure', t => {
	const panel = createPanel();
	announceEdit(panel);

	// The agent reports a user cancel as failed with an explanatory rawOutput.
	panel.update({
		sessionUpdate: 'tool_call_update',
		toolCallId: 'call-1',
		status: 'failed',
		rawOutput: 'Cancelled by user',
	});

	const card = editCard(panel);
	t.is(actionText(card), 'Cancelled edit to');
	t.is(card.querySelector('.tool-status').dataset.status, 'cancelled');
});

test('a denied edit is labelled as denied', t => {
	const panel = createPanel();
	announceEdit(panel);
	panel.update({
		sessionUpdate: 'tool_call_update',
		toolCallId: 'call-1',
		status: 'failed',
		rawOutput: 'Denied by user',
	});

	t.is(actionText(editCard(panel)), 'Denied edit to');
});

test('a genuine failure still reads as a failure', t => {
	const panel = createPanel();
	announceEdit(panel);
	panel.update({
		sessionUpdate: 'tool_call_update',
		toolCallId: 'call-1',
		status: 'failed',
		rawOutput: 'Error: ENOENT no such file',
	});

	const card = editCard(panel);
	t.is(actionText(card), 'Failed to edit');
	t.is(card.querySelector('.tool-status').dataset.status, 'failed');
});

// ============================================================================
// "Open Diff" stays inert until the host has the change
// ============================================================================

test('the diff affordance is hidden on the queued announcement', t => {
	const panel = createPanel();
	announceEdit(panel);

	const card = editCard(panel);
	t.not(card.dataset.hasDiff, 'true');
	t.true(diffBtn(card).classList.contains('hidden'));
});

test('clicking a card with no registered diff posts nothing', t => {
	const panel = createPanel();
	announceEdit(panel);

	clickCard(editCard(panel));

	// Previously this reached the host and raised "Change <id> not found".
	t.is(showDiffMessages(panel).length, 0);
});

test('the diff affordance appears once content carries a diff', t => {
	const panel = createPanel();
	announceEdit(panel);
	readyEdit(panel);

	const card = editCard(panel);
	t.is(card.dataset.hasDiff, 'true');
	t.false(diffBtn(card).classList.contains('hidden'));
});

test('clicking a card with a registered diff posts showDiff', t => {
	const panel = createPanel();
	announceEdit(panel);
	readyEdit(panel);

	clickCard(editCard(panel));

	const posted = showDiffMessages(panel);
	t.is(posted.length, 1);
	t.is((posted[0] as any).toolCallId, 'call-1');
});

test('the diff stays available after the call finishes', t => {
	const panel = createPanel();
	announceEdit(panel);
	readyEdit(panel);

	// The completion update carries rawOutput but no content.
	panel.update({
		sessionUpdate: 'tool_call_update',
		toolCallId: 'call-1',
		status: 'completed',
		rawOutput: 'written',
	});

	const card = editCard(panel);
	t.is(card.dataset.hasDiff, 'true');
	clickCard(card);
	t.is(showDiffMessages(panel).length, 1);
});

test('a single-call edit is clickable straight away', t => {
	const panel = createPanel();
	// With no batch to announce, the first emit already carries the diff.
	panel.update({
		sessionUpdate: 'tool_call',
		toolCallId: 'solo',
		title: 'string_replace: src/a.ts',
		kind: 'edit',
		status: 'pending',
		content: DIFF,
	});

	const card = editCard(panel);
	t.is(card.dataset.hasDiff, 'true');
	clickCard(card);
	t.is(showDiffMessages(panel).length, 1);
});

test('content without a usable diff does not arm the button', t => {
	const panel = createPanel();
	announceEdit(panel);
	// string_replace yields no diff when the match is not unique; the host
	// registers nothing, so neither should the panel offer to open it.
	panel.update({
		sessionUpdate: 'tool_call_update',
		toolCallId: 'call-1',
		status: 'pending',
		content: [{type: 'content', content: {type: 'text', text: 'hi'}}],
	});

	const card = editCard(panel);
	t.not(card.dataset.hasDiff, 'true');
	clickCard(card);
	t.is(showDiffMessages(panel).length, 0);
});

// ============================================================================
// Non-edit tools go to the aggregated list and read as plain English
// ============================================================================

const toolRows = (panel: any): StubElement[] =>
	panel.container.querySelectorAll('.tool-label');

test('known tools are labelled with their verb', t => {
	const panel = createPanel();
	panel.update({
		sessionUpdate: 'tool_call',
		toolCallId: 'r1',
		title: 'read_file: source/x.ts',
		kind: 'read',
		status: 'pending',
	});
	panel.update({
		sessionUpdate: 'tool_call',
		toolCallId: 'b1',
		title: 'execute_bash: pnpm test',
		kind: 'execute',
		status: 'pending',
	});

	const labels = toolRows(panel).map((row: StubElement) => row.textContent);
	t.deepEqual(labels, ['Reading source/x.ts', 'Running pnpm test']);
});

test('tools with no path keep their bare title', t => {
	const panel = createPanel();
	// fetch_url and web_search take a url/query, so buildToolCallMeta leaves the
	// title as the bare tool name - there is no ": " for a verb to attach to.
	for (const [id, title] of [
		['f1', 'fetch_url'],
		['w1', 'web_search'],
	]) {
		panel.update({
			sessionUpdate: 'tool_call',
			toolCallId: id,
			title,
			kind: 'fetch',
			status: 'pending',
		});
	}

	const labels = toolRows(panel).map((row: StubElement) => row.textContent);
	t.deepEqual(labels, ['fetch_url', 'web_search']);
});

test('an edit-kind call never lands in the aggregated list', t => {
	const panel = createPanel();
	announceEdit(panel);

	t.is(toolRows(panel).length, 0);
	t.truthy(editCard(panel));
});

// ============================================================================
// Files the agent changes surface in the context panel
// ============================================================================

const chipsRow = (panel: any): StubElement => panel.byId('context-chips');

const chips = (panel: any): StubElement[] => chipsRow(panel).children;

const chipNames = (panel: any): string[] =>
	chips(panel).map(
		(chip: StubElement) => chip.querySelector('.chip-name').textContent,
	);

/** The completion update: a status and a rawOutput, nothing else. */
const completeEdit = (panel: any, toolCallId = 'call-1') =>
	panel.update({
		sessionUpdate: 'tool_call_update',
		toolCallId,
		status: 'completed',
		rawOutput: 'written',
	});

/** Click a chip on its name, rather than on the x that removes it. */
const clickChip = (chip: StubElement) =>
	chip.click({target: chip.querySelector('.chip-name')});

const submit = (panel: any, text: string) => {
	panel.byId('chat-input').value = text;
	panel.byId('send-stop-btn').click();
};

const sentOfType = (panel: any, type: string) =>
	panel.sent.filter((message: any) => message && message.type === type);

test('a finished edit puts its file in the context panel', t => {
	const panel = createPanel();
	announceEdit(panel);
	t.deepEqual(chipNames(panel), [], 'a queued edit has not changed anything yet');

	completeEdit(panel);

	t.deepEqual(chipNames(panel), ['a.ts']);
	t.false(chipsRow(panel).classList.contains('hidden'));

	// The row now holds two kinds of chip, so the agent's are marked apart from
	// the ones the user attached.
	const chip = chips(panel)[0];
	t.true(chip.classList.contains('context-chip-edited'));
	t.true(
		chip.querySelector('.chip-name').getAttribute('title').startsWith('/repo/src/a.ts'),
	);
});

test('an edit that never ran leaves the panel empty', t => {
	const panel = createPanel();
	announceEdit(panel);
	panel.update({
		sessionUpdate: 'tool_call_update',
		toolCallId: 'call-1',
		status: 'failed',
		rawOutput: 'Denied by user',
	});

	t.deepEqual(chipNames(panel), []);
});

test('the path falls back to the diff when locations are absent', t => {
	const panel = createPanel();
	// A single-call turn skips the announcement, so the first emit is the one
	// carrying the diff.
	panel.update({
		sessionUpdate: 'tool_call',
		toolCallId: 'solo',
		title: 'string_replace: src/a.ts',
		kind: 'edit',
		status: 'pending',
		content: DIFF,
	});
	completeEdit(panel, 'solo');

	t.deepEqual(chipNames(panel), ['a.ts']);
});

test('an edit that names no absolute path is skipped', t => {
	const panel = createPanel();
	// The title alone is not enough: it holds the path as the model wrote it,
	// and the host can only open an absolute one.
	panel.update({
		sessionUpdate: 'tool_call',
		toolCallId: 'bare',
		title: 'write_file: src/a.ts',
		kind: 'edit',
		status: 'pending',
	});
	completeEdit(panel, 'bare');

	t.deepEqual(chipNames(panel), []);
});

test('repeated edits to one file leave a single chip', t => {
	const panel = createPanel();
	for (const toolCallId of ['call-1', 'call-2']) {
		announceEdit(panel, toolCallId);
		completeEdit(panel, toolCallId);
	}

	t.deepEqual(chipNames(panel), ['a.ts']);
});

test('clicking a changed file opens it in the editor', t => {
	const panel = createPanel();
	announceEdit(panel);
	completeEdit(panel);

	clickChip(chips(panel)[0]);

	t.deepEqual(sentOfType(panel, 'openPath'), [
		{type: 'openPath', path: '/repo/src/a.ts', kind: 'file'},
	]);
});

test('a changed file can be dismissed', t => {
	const panel = createPanel();
	announceEdit(panel);
	completeEdit(panel);

	const chip = chips(panel)[0];
	chip.click({target: chip.querySelector('.chip-remove')});

	t.deepEqual(chipNames(panel), []);
	t.is(sentOfType(panel, 'openPath').length, 0, 'removing does not also open');
});

test('a changed file is not attached to the next prompt', t => {
	const panel = createPanel();
	announceEdit(panel);
	completeEdit(panel);

	submit(panel, 'looks good');

	// The agent wrote the file, so its contents are already in the thread -
	// inlining them again would spend context to say nothing new.
	t.is(sentOfType(panel, 'submitMessage')[0].text, 'looks good');
	t.deepEqual(chipNames(panel), ['a.ts'], 'and it stays put for later review');
});

test('a changed file alone does not make an empty composer sendable', t => {
	const panel = createPanel();
	announceEdit(panel);
	completeEdit(panel);

	submit(panel, '   ');

	t.is(sentOfType(panel, 'submitMessage').length, 0);
});

test('a file the user attached is still sent as context', t => {
	const panel = createPanel();
	panel.post({
		type: 'pathInfoResolved',
		path: '/repo/src/b.ts',
		name: 'b.ts',
		kind: 'file',
	});
	announceEdit(panel);
	completeEdit(panel);
	t.deepEqual(chipNames(panel), ['b.ts', 'a.ts']);

	submit(panel, 'check this');

	t.is(
		sentOfType(panel, 'submitMessage')[0].text,
		'check this\n\n@[file] /repo/src/b.ts',
	);
	t.deepEqual(chipNames(panel), ['a.ts'], "the user's chip is consumed, the agent's is not");
});

test('a new conversation clears the changed files', t => {
	const panel = createPanel();
	announceEdit(panel);
	completeEdit(panel);

	panel.post({type: 'clear'});

	t.deepEqual(chipNames(panel), []);
	t.true(chipsRow(panel).classList.contains('hidden'));
});

test('attaching a changed file yourself promotes it into the prompt', t => {
	const panel = createPanel();
	announceEdit(panel);
	completeEdit(panel);

	panel.post({
		type: 'pathInfoResolved',
		path: '/repo/src/a.ts',
		name: 'a.ts',
		kind: 'file',
	});

	t.deepEqual(chipNames(panel), ['a.ts'], 'the row does not gain a duplicate');
	t.false(chips(panel)[0].classList.contains('context-chip-edited'));

	submit(panel, 'fix this');

	t.is(
		sentOfType(panel, 'submitMessage')[0].text,
		'fix this\n\n@[file] /repo/src/a.ts',
	);
	t.deepEqual(chipNames(panel), [], 'and it is consumed like any attachment');
});
