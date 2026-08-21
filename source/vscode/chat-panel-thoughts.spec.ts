import test from 'ava';
import {createPanel, type StubElement} from '@/vscode/chat-panel-harness';

const titleOf = (summary: StubElement) =>
	summary.children[0].children[0].textContent;
const bodyOf = (summary: StubElement) => summary.children[1];
const thoughtText = (thought: StubElement) => thought.children[1].textContent;
const isOpen = (summary: StubElement) =>
	bodyOf(summary).style.display !== 'none';
const clickHeader = (summary: StubElement) => summary.children[0].onclick();

const activityKind = (element: StubElement) => {
	if (element.classList.contains('work-summary-thought')) return 'thought';
	if (element.classList.contains('tool-aggregator')) return 'tools';
	if (element.classList.contains('tool-card')) return 'edit';
	if (String(element.id).startsWith('plan-card-')) return 'plan';
	return 'unknown';
};

const isInside = (element: StubElement, ancestor: StubElement) => {
	let current = element.parentElement;
	while (current) {
		if (current === ancestor) return true;
		current = current.parentElement;
	}
	return false;
};

test('groups one turn execution activity into a single ordered summary', t => {
	const panel = createPanel();

	panel.userMessage('please inspect and edit the project');
	panel.thought('inspect first');
	panel.update({
		sessionUpdate: 'tool_call',
		toolCallId: 'read-1',
		title: 'read_file: source/a.ts',
		kind: 'read',
		status: 'pending',
	});
	panel.text('I found the relevant file.');
	panel.thought('now edit it');
	panel.update({
		sessionUpdate: 'tool_call',
		toolCallId: 'edit-1',
		title: 'write_file: source/a.ts',
		kind: 'edit',
		status: 'pending',
	});
	panel.update({
		sessionUpdate: 'plan',
		entries: [{content: 'Run tests', status: 'in_progress'}],
	});
	panel.finish();

	const summaries = panel.summaries();
	t.is(summaries.length, 1);
	t.deepEqual(bodyOf(summaries[0]).children.map(activityKind), [
		'thought',
		'tools',
		'thought',
		'edit',
		'plan',
	]);
});

test('does not merge tool groups across intervening thoughts', t => {
	const panel = createPanel();
	panel.userMessage('inspect two areas');

	panel.update({
		sessionUpdate: 'tool_call',
		toolCallId: 'first',
		title: 'read_file: source/first.ts',
		kind: 'read',
		status: 'pending',
	});
	panel.thought('the second area needs a separate check');
	panel.update({
		sessionUpdate: 'tool_call_update',
		toolCallId: 'first',
		status: 'completed',
	});
	panel.update({
		sessionUpdate: 'tool_call',
		toolCallId: 'second',
		title: 'read_file: source/second.ts',
		kind: 'read',
		status: 'pending',
	});

	const groups = bodyOf(panel.summaries()[0]).children.filter(
		(child: StubElement) => child.classList.contains('tool-aggregator'),
	);
	t.is(groups.length, 2);
	t.deepEqual(
		groups[0]
			.querySelectorAll('.tool-label')
			.map((label: StubElement) => label.textContent),
		['Reading source/first.ts'],
	);
	t.deepEqual(
		groups[1]
			.querySelectorAll('.tool-label')
			.map((label: StubElement) => label.textContent),
		['Reading source/second.ts'],
	);
});

test('keeps streaming chunks together and starts a new thought after work', t => {
	const panel = createPanel();

	panel.thought('let me ');
	panel.thought('check that');
	panel.tool('call-1');
	panel.thought('one more detail');

	const thoughts = panel.thoughts();
	t.is(thoughts.length, 2);
	t.is(thoughtText(thoughts[0]), 'let me check that');
	t.is(thoughtText(thoughts[1]), 'one more detail');
});

test('measures the whole turn rather than only thought stretches', t => {
	const panel = createPanel();

	panel.userMessage('do the work');
	panel.advance(5_000);
	panel.thought('reasoning');
	panel.runTimers();

	const summary = panel.summaries()[0];
	t.is(titleOf(summary), 'Working for 5s');

	panel.text('progress update');
	panel.advance(60_000);
	panel.runTimers();
	t.is(titleOf(summary), 'Working for 1m 5s');

	panel.finish();
	t.is(titleOf(summary), 'Worked for 1m 5s');
});

test('stays open while streaming and collapses when the turn completes', t => {
	const panel = createPanel();

	panel.userMessage('run a task');
	panel.thought('reasoning');
	const summary = panel.summaries()[0];
	t.true(isOpen(summary));

	panel.finish();
	t.false(isOpen(summary));
	t.is(summary.children[0].getAttribute('aria-expanded'), 'false');

	clickHeader(summary);
	t.true(isOpen(summary));
	clickHeader(summary);
	t.false(isOpen(summary));
});

test('keeps the final answer outside the work summary', t => {
	const panel = createPanel();

	panel.userMessage('answer after checking');
	panel.thought('checking');
	panel.tool('call-1');
	panel.text('This is the final answer.');
	panel.finish();

	const summary = panel.summaries()[0];
	const answer = panel.container.querySelector('.agent-markdown');
	t.false(isInside(answer, summary));
	t.is(bodyOf(summary).querySelectorAll('.agent-markdown').length, 0);
	t.true(
		panel.container.children.indexOf(summary) <
			panel.container.children.indexOf(answer.parentElement.parentElement),
	);
});

test('does not leave an empty summary for a direct answer', t => {
	const panel = createPanel();

	panel.userMessage('say hello');
	panel.text('Hello.');
	panel.finish();

	t.is(panel.summaries().length, 0);
	t.is(panel.container.querySelectorAll('.agent-markdown').length, 1);
});

test('labels cancelled and failed terminal states', t => {
	const cancelled = createPanel();
	cancelled.userMessage('stop this');
	cancelled.thought('working');
	cancelled.advance(2_000);
	cancelled.finish('cancelled');

	const cancelledSummary = cancelled.summaries()[0];
	t.is(titleOf(cancelledSummary), 'Stopped after 2s');
	t.is(cancelledSummary.dataset.outcome, 'cancelled');

	const failed = createPanel();
	failed.userMessage('this will fail');
	failed.tool('call-1');
	failed.advance(3_000);
	failed.finish('failed');

	const failedSummary = failed.summaries()[0];
	t.is(titleOf(failedSummary), 'Failed after 3s');
	t.is(failedSummary.dataset.outcome, 'failed');
});

test('keeps late tool updates in their original cancelled turn', t => {
	const panel = createPanel();

	panel.userMessage('start the first task');
	panel.tool('first-tool');
	panel.finish('cancelled');

	panel.userMessage('start another task');
	panel.thought('new ');
	panel.update({
		sessionUpdate: 'tool_call_update',
		toolCallId: 'first-tool',
		status: 'failed',
		rawOutput: 'Cancelled by user',
	});
	panel.thought('thought');

	const summaries = panel.summaries();
	t.is(summaries.length, 2);
	t.is(titleOf(summaries[0]), 'Stopped after 0s');
	t.is(summaries[0].querySelectorAll('.tool-label').length, 1);
	t.is(summaries[1].querySelectorAll('.work-summary-thought').length, 1);
	t.is(thoughtText(summaries[1].querySelector('.work-summary-thought')), 'new thought');
});

test('reopens the summary when a tool needs approval', t => {
	const panel = createPanel();

	panel.userMessage('inspect a file');
	panel.tool('call-1');
	const summary = panel.summaries()[0];
	clickHeader(summary);
	t.false(isOpen(summary));

	panel.post({
		type: 'permissionRequested',
		toolCallId: 'call-1',
		toolCall: {},
	});

	t.true(isOpen(summary));
	t.truthy(bodyOf(summary).querySelector('.tool-actions'));
});

test('renders thoughts as markdown when marked is loaded', t => {
	const panel = createPanel({marked: true});

	panel.thought('**inspect** the code');
	const thought = panel.thoughts()[0];
	t.is(thought.children[1].innerHTML, '');

	panel.runTimers();
	t.is(thought.children[1].innerHTML, '<md>**inspect** the code</md>');
});

test('keeps one summary per turn when a session is replayed', t => {
	const panel = createPanel();

	panel.post({type: 'clear', isLoading: true});
	panel.userMessage('first question');
	panel.thought('first thought');
	panel.text('first answer');
	panel.userMessage('second question');
	panel.tool('second-tool');
	panel.text('second answer');
	panel.post({type: 'sessionLoaded'});

	const summaries = panel.summaries();
	t.is(summaries.length, 2);
	t.is(thoughtText(summaries[0].querySelector('.work-summary-thought')), 'first thought');
	t.is(summaries[1].querySelectorAll('.tool-label').length, 1);
	t.false(isOpen(summaries[0]));
	t.false(isOpen(summaries[1]));
});

test('drops the active summary when the session is cleared', t => {
	const panel = createPanel();

	panel.userMessage('question');
	panel.thought('reasoning');
	t.is(panel.summaries().length, 1);

	panel.post({type: 'clear'});
	t.is(panel.summaries().length, 0);

	panel.userMessage('fresh question');
	panel.thought('fresh reasoning');
	t.is(panel.summaries().length, 1);
	t.is(thoughtText(panel.thoughts()[0]), 'fresh reasoning');
});
