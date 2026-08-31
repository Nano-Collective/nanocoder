import test from 'ava';
import {createPanel, type StubElement} from '@/vscode/chat-panel-harness';

console.log('\nchat-panel-turn-footer.spec.ts');

// ============================================================================
// Helpers
// ============================================================================

/** Agent footers only - a user message carries its own, aligned the other way. */
const agentFooters = (panel: any): StubElement[] =>
	panel.footers().filter((footer: StubElement) =>
		footer.classList.contains('self-start'),
	);

const copyButton = (footer: StubElement): StubElement =>
	footer.children.find((child: StubElement) => child.title === 'Copy');

const timestamp = (footer: StubElement): string =>
	footer.children.find((child: StubElement) => child.title !== 'Copy')
		.textContent;

const runTool = (panel: any, toolCallId: string) => {
	panel.update({
		sessionUpdate: 'tool_call',
		toolCallId,
		title: 'read_file: src/a.ts',
		kind: 'read',
		status: 'in_progress',
	});
	panel.update({
		sessionUpdate: 'tool_call_update',
		toolCallId,
		status: 'completed',
	});
};

// ============================================================================
// One footer per response, not one per text segment
//
// A tool card splits a response into several text blocks. Each block used to
// grow its own copy button and timestamp, so a single answer ended up with a
// row of them down the transcript.
// ============================================================================

test('a response split by a tool card keeps one footer', t => {
	const panel = createPanel();
	panel.userMessage('go');
	panel.text('Looking into it.');
	runTool(panel, 'r1');
	panel.text('Here is the answer.');

	t.is(agentFooters(panel).length, 1);
});

test('the footer moves to the newest text block', t => {
	const panel = createPanel();
	panel.userMessage('go');
	panel.text('Looking into it.');
	runTool(panel, 'r1');
	panel.text('Here is the answer.');

	const [footer] = agentFooters(panel);
	const blocks = panel.container.children;
	t.is(
		blocks.indexOf(footer.parentElement),
		blocks.length - 1,
		'the footer sits under the last block, not the first',
	);
});

test('each response gets its own footer', t => {
	const panel = createPanel();
	panel.userMessage('first');
	panel.text('Response A');
	panel.finish();
	panel.userMessage('second');
	panel.text('Response B');

	t.is(agentFooters(panel).length, 2);
});

test('usage footer is hidden until the setting is enabled', t => {
	const panel = createPanel();
	panel.userMessage('first');
	panel.text('Response A');
	panel.update({
		sessionUpdate: 'prompt_response',
		outcome: 'completed',
		usage: {totalTokens: 1200},
		cost: 0.012,
	});

	t.false(
		panel.container.children.some((child: StubElement) =>
			child.textContent.includes('Tokens:'),
		),
	);

	panel.post({
		type: 'settingsData',
		settings: {
			providers: [],
			mcpServers: [],
			alwaysAllow: [],
			defaultMode: null,
			autoCompact: {enabled: true, threshold: 60, mode: 'conservative'},
			reasoningTraces: false,
			sessions: {autoSave: true},
			webSearch: {configured: false},
			showTokenUsage: true,
		},
	});
	panel.userMessage('second');
	panel.text('Response B');
	panel.update({
		sessionUpdate: 'prompt_response',
		outcome: 'completed',
		usage: {totalTokens: 1200},
		cost: 0.012,
	});

	t.true(
		panel.container.children.some((child: StubElement) =>
			child.textContent.includes('Tokens: 1.2k | ~$0.01'),
		),
	);
});

// ============================================================================
// A footer copies its own response
//
// The copy closure read the turn wrapper it happened to be sitting in, so once
// a newer response arrived, an older footer handed back the newer text.
// ============================================================================

test('an older response copies its own text, not a newer one', t => {
	const panel = createPanel();
	panel.userMessage('first');
	panel.text('Response A');
	panel.finish();
	panel.userMessage('second');
	panel.text('Response B');

	const [first, second] = agentFooters(panel);
	copyButton(first).click();
	t.deepEqual(panel.copied, ['Response A']);

	copyButton(second).click();
	t.deepEqual(panel.copied, ['Response A', 'Response B']);
});

test('copying a split response yields every segment', t => {
	const panel = createPanel();
	panel.userMessage('go');
	panel.text('Looking into it.');
	runTool(panel, 'r1');
	panel.text('Here is the answer.');

	copyButton(agentFooters(panel)[0]).click();
	t.deepEqual(panel.copied, ['Looking into it.\n\nHere is the answer.']);
});

test('the footer keeps up with text still streaming in', t => {
	const panel = createPanel();
	panel.userMessage('go');
	panel.text('Half a ');
	panel.text('sentence.');

	copyButton(agentFooters(panel)[0]).click();
	t.deepEqual(panel.copied, ['Half a sentence.']);
});

test('clearing the session drops the footer', t => {
	const panel = createPanel();
	panel.userMessage('go');
	panel.text('Response A');
	const before = timestamp(agentFooters(panel)[0]);

	panel.post({type: 'clear'});
	panel.advance(90 * 60 * 1000);
	panel.text('Response B');

	const footers = agentFooters(panel);
	t.is(footers.length, 1, 'the cleared turn does not leave its footer behind');
	// A reused footer would still be stamped with the cleared session's time.
	t.not(timestamp(footers[0]), before);
	copyButton(footers[0]).click();
	t.deepEqual(panel.copied, ['Response B']);
});
