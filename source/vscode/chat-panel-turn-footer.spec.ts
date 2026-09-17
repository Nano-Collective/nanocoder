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
	footer.querySelector('.copy-btn') ??
	footer.children.find((child: StubElement) => child.title === 'Copy');

const retryButton = (footer: StubElement): StubElement =>
	footer.querySelector('.retry-btn') ??
	footer.children.find((child: StubElement) => child.title === 'Retry');

const timestamp = (footer: StubElement): string =>
	(footer.querySelector('.timestamp') ??
	footer.children.find((child: StubElement) => child.title !== 'Copy'))
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

test('replayed response usage metadata restores the token and cost line', t => {
	const panel = createPanel();
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
	panel.userMessage('first');
	panel.update({
		sessionUpdate: 'agent_message_chunk',
		content: {type: 'text', text: 'Response A'},
		_meta: {
			'nanocoder/response-usage': {
				inputTokens: 6500,
				outputTokens: 500,
				totalTokens: 7000,
				cost: 0.004,
			},
		},
	});

	const usageLine = panel.container.children.find(
		(child: StubElement) => child.textContent === 'Tokens: 7k | <$0.01',
	);
	t.truthy(usageLine);
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

test('disabling usage hides already-rendered indicators', t => {
	const panel = createPanel();
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
	panel.userMessage('first');
	panel.text('Response A');
	panel.update({
		sessionUpdate: 'prompt_response',
		outcome: 'completed',
		usage: {totalTokens: 1200},
		cost: 0.012,
	});

	const indicator = panel.container.children.find((child: StubElement) =>
		child.classList.contains('token-usage-indicator'),
	);
	t.truthy(indicator);
	t.is(indicator.style.display, undefined);

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
			showTokenUsage: false,
		},
	});

	t.is(indicator.style.display, 'none');
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

// ============================================================================
// Retry button and layout (#1094)
// ============================================================================

test('agent footer includes a Retry button and Copy button in an action group', t => {
	const panel = createPanel();
	panel.userMessage('hello');
	panel.text('world');

	const [footer] = agentFooters(panel);
	const retryBtn = retryButton(footer);
	const copyBtn = copyButton(footer);

	t.truthy(retryBtn, 'Retry button should be present');
	t.is(retryBtn.title, 'Retry');
	t.is(retryBtn.getAttribute('aria-label'), 'Retry response');
	t.true(retryBtn.innerHTML.includes('<svg'), 'Retry button contains SVG icon');

	t.truthy(copyBtn, 'Copy button should be present');
	t.is(copyBtn.title, 'Copy');

	// Verify layout: actions and timestamp are grouped together on the left
	t.true(footer.classList.contains('self-start'));
	const actionsGroup = footer.querySelector('.message-actions');
	t.truthy(actionsGroup, 'actions group should exist');
	t.is(actionsGroup.children[0], retryBtn, 'Retry button should be first on the left');
	t.is(actionsGroup.children[1], copyBtn, 'Copy button should be next to Retry');
	t.is(
		actionsGroup.children[2],
		footer.querySelector('.timestamp'),
		'Timestamp should be on the left just after Copy',
	);
});

test('user message footers do not contain Retry or Copy buttons', t => {
	const panel = createPanel();
	panel.userMessage('user prompt');

	const userFooters = panel.footers().filter((footer: StubElement) =>
		footer.classList.contains('self-end'),
	);
	t.is(userFooters.length, 1);
	t.falsy(userFooters[0].querySelector('.retry-btn'));
	t.falsy(userFooters[0].querySelector('.copy-btn'));
});

test('clicking Retry button sends retryMessage with prompt to extension host', t => {
	const panel = createPanel();
	panel.userMessage('Explain quantum computing');
	panel.text('Quantum computing leverages superposition...');
	panel.finish();

	const [footer] = agentFooters(panel);
	const retryBtn = retryButton(footer);
	retryBtn.click();

	const retryMsg = panel.sent.find((m: any) => m.type === 'retryMessage');
	t.truthy(retryMsg, 'should have sent retryMessage');
	t.is(retryMsg.text, 'Explain quantum computing');
});

test('clicking Retry on an older response retries that specific turn prompt', t => {
	const panel = createPanel();
	panel.userMessage('first prompt');
	panel.text('first response');
	panel.finish();

	panel.userMessage('second prompt');
	panel.text('second response');
	panel.finish();

	const [firstFooter, secondFooter] = agentFooters(panel);

	retryButton(firstFooter).click();
	let retryMsgs = panel.sent.filter((m: any) => m.type === 'retryMessage');
	t.is(retryMsgs.length, 1);
	t.is(retryMsgs[0].text, 'first prompt');

	panel.finish();

	retryButton(secondFooter).click();
	retryMsgs = panel.sent.filter((m: any) => m.type === 'retryMessage');
	t.is(retryMsgs.length, 2);
	t.is(retryMsgs[1].text, 'second prompt');
});

test('clicking Retry button while processing is active does nothing', t => {
	const panel = createPanel();
	panel.userMessage('initial prompt');
	panel.text('thinking...');
	// Still streaming/processing - do not call panel.finish()
	panel.startTurn('active turn');

	const [footer] = agentFooters(panel);
	const retryBtn = retryButton(footer);
	const sentCountBefore = panel.sent.length;

	retryBtn.click();
	t.is(panel.sent.length, sentCountBefore, 'no message should be sent when processing is active');
});

test('clicking Retry erases the current response and footer from the DOM without duplicating user prompt', t => {
	const panel = createPanel();
	panel.userMessage('Write a hello world function');
	panel.text('console.log("hello world");');
	panel.finish();

	// Initially we have 1 user message and 1 assistant message
	const userWrappersBefore = panel.container.children.filter(
		(child: StubElement) => child.dataset.role === 'user' || child.classList.contains('self-end'),
	);
	t.is(userWrappersBefore.length, 1);
	t.is(agentFooters(panel).length, 1);

	const [footer] = agentFooters(panel);
	retryButton(footer).click();

	// After retry: assistant message and its footer are erased
	t.is(agentFooters(panel).length, 0);
	const userWrappersAfter = panel.container.children.filter(
		(child: StubElement) => child.dataset.role === 'user' || child.classList.contains('self-end'),
	);
	t.is(userWrappersAfter.length, 1, 'user prompt bubble is preserved and not duplicated');
	t.true(panel.container.children.includes(userWrappersBefore[0]));

	// When regenerated response streams in, it renders directly in-place
	panel.text('function hello() { return "hello world"; }');
	panel.finish();

	t.is(agentFooters(panel).length, 1);
	const finalUserWrappers = panel.container.children.filter(
		(child: StubElement) => child.dataset.role === 'user' || child.classList.contains('self-end'),
	);
	t.is(finalUserWrappers.length, 1, 'user message was still not duplicated');
	t.true(
		panel.container.children.some((child: StubElement) =>
			child.textContent.includes('function hello() { return "hello world"; }'),
		),
	);
});

test('clicking Retry on an older turn erases that response and subsequent turns in the DOM', t => {
	const panel = createPanel();
	panel.userMessage('Prompt 1');
	panel.text('Answer 1');
	panel.finish();

	panel.userMessage('Prompt 2');
	panel.text('Answer 2');
	panel.finish();

	// 2 user messages, 2 agent footers
	t.is(agentFooters(panel).length, 2);
	const [footer1] = agentFooters(panel);

	// Retry turn 1
	retryButton(footer1).click();

	// Turn 2 and Turn 1's response should be erased from DOM
	t.is(agentFooters(panel).length, 0);
	const remainingUserWrappers = panel.container.children.filter(
		(child: StubElement) => child.dataset.role === 'user' || child.classList.contains('self-end'),
	);
	t.is(remainingUserWrappers.length, 1, 'only Prompt 1 remains');
	t.true(remainingUserWrappers[0].textContent.includes('Prompt 1'));

	// New answer streams in for Prompt 1
	panel.text('New Answer 1');
	panel.finish();

	t.is(agentFooters(panel).length, 1);
	t.true(
		panel.container.children.some((child: StubElement) =>
			child.textContent.includes('New Answer 1'),
		),
	);
});

test('resuming a session from history renders the user message properly even after retry was invoked', t => {
	const panel = createPanel();
	panel.userMessage('how are you');
	panel.text('Doing well, thanks.');
	panel.finish();

	// User clicked retry on this message
	const [footer] = agentFooters(panel);
	retryButton(footer).click();
	panel.text('Regenerated answer');
	panel.finish();

	// Now user switches to history or reloads the session
	panel.post({type: 'clear', isLoading: true});
	// Replay session history
	panel.userMessage('how are you');
	panel.text('Regenerated answer');
	panel.post({type: 'sessionLoaded'});

	const userWrappers = panel.container.children.filter(
		(child: StubElement) => child.dataset.role === 'user' || child.classList.contains('self-end'),
	);
	t.is(userWrappers.length, 1, 'user message must be visible and rendered when loaded from history');
	t.true(userWrappers[0].textContent.includes('how are you'));
});

test('clicking Retry on an image-only turn resubmits the images, not nothing', t => {
	const panel = createPanel();
	panel.userMessage('caption');
	panel.text('Response to the caption.');
	panel.finish();

	const [footer] = agentFooters(panel);
	// The harness can only feed text through `userMessage`. To exercise the
	// empty-prompt-with-images branch the click handler gained, mutate the
	// footer in place: blank the carry-over prompt text and attach the image
	// payload that a real image-only turn would carry. The click handler
	// must post a retryMessage whose text is empty and whose images match.
	const images = [{mimeType: 'image/png', data: 'AAAA'}];
	footer.dataset.promptText = '';
	(footer as any)._promptImages = images;

	const retryMsgsBefore = panel.sent.filter(
		(m: any) => m.type === 'retryMessage',
	).length;
	const retryBtn = retryButton(footer);
	t.false(retryBtn.disabled, 'retry must be enabled even with empty prompt text');
	retryBtn.click();

	const retryMsgs = panel.sent.filter((m: any) => m.type === 'retryMessage');
	t.is(retryMsgs.length, retryMsgsBefore + 1);
	t.deepEqual(retryMsgs.at(-1).images, images);
});


