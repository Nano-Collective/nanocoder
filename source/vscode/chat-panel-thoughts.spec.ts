import test from 'ava';
import {createPanel, type StubElement} from '@/vscode/chat-panel-harness';

const titleOf = (box: StubElement) => box.children[0].children[0].textContent;
const bodyOf = (box: StubElement) => box.children[1].textContent;
const isOpen = (box: StubElement) => box.children[1].style.display !== 'none';
const clickHeader = (box: StubElement) => box.children[0].onclick();

test('groups every thought of one response into a single section', t => {
	const panel = createPanel();

	panel.thought('first thought');
	panel.text('some answer');
	panel.tool('call-1');
	panel.thought('second thought');
	panel.text('more answer');
	panel.thought('third thought');
	panel.finish();

	const boxes = panel.boxes();
	t.is(boxes.length, 1);
	t.true(bodyOf(boxes[0]).includes('first thought'));
	t.true(bodyOf(boxes[0]).includes('second thought'));
	t.true(bodyOf(boxes[0]).includes('third thought'));
});

test('counts only the stretches actually spent thinking', t => {
	const panel = createPanel();

	panel.thought('reasoning');
	panel.advance(3_000);
	panel.text('answer');
	panel.advance(60_000);
	panel.tool('call-1');
	panel.advance(30_000);
	panel.thought('more reasoning');
	panel.advance(2_500);
	panel.finish();

	t.is(titleOf(panel.boxes()[0]), 'Thought for 5s');
});

test('separates interrupted thought stretches with a blank line', t => {
	const panel = createPanel();

	panel.thought('first');
	panel.text('answer');
	panel.thought('second');
	panel.finish();

	t.is(bodyOf(panel.boxes()[0]), 'first\n\nsecond');
});

test('keeps consecutive chunks of one stretch unseparated', t => {
	const panel = createPanel();

	panel.thought('let me ');
	panel.thought('check that');
	panel.finish();

	t.is(bodyOf(panel.boxes()[0]), 'let me check that');
});

test('starts a new section for the next response', t => {
	const panel = createPanel();

	panel.thought('first response thought');
	panel.text('first answer');
	panel.finish();
	panel.thought('second response thought');
	panel.finish();

	const boxes = panel.boxes();
	t.is(boxes.length, 2);
	t.is(bodyOf(boxes[0]), 'first response thought');
	t.is(bodyOf(boxes[1]), 'second response thought');
});

test('collapses while paused and reopens when thoughts resume', t => {
	const panel = createPanel();

	panel.thought('reasoning');
	const box = panel.boxes()[0];
	t.true(isOpen(box));
	t.is(titleOf(box), 'Thinking...');

	panel.advance(2_000);
	panel.text('answer');
	t.false(isOpen(box));
	t.is(titleOf(box), 'Thought for 2s');

	panel.thought('more reasoning');
	t.true(isOpen(box));
	t.is(titleOf(box), 'Thinking for 2s');

	panel.advance(1_000);
	panel.finish();
	t.false(isOpen(box));
	t.is(titleOf(box), 'Thought for 3s');
});

test('respects a manual toggle for the rest of the response', t => {
	const panel = createPanel();

	panel.thought('reasoning');
	const box = panel.boxes()[0];
	clickHeader(box);
	t.false(isOpen(box));

	panel.thought('still reasoning');
	t.false(isOpen(box));

	panel.text('answer');
	t.false(isOpen(box));

	clickHeader(box);
	panel.thought('more reasoning');
	panel.finish();
	t.true(isOpen(box));
});

test('keeps the live timer running while thoughts stream', t => {
	const panel = createPanel();

	panel.thought('reasoning');
	panel.advance(4_000);
	panel.runTimers();
	t.is(titleOf(panel.boxes()[0]), 'Thinking for 4s');

	panel.text('answer');
	panel.advance(10_000);
	panel.runTimers();
	t.is(titleOf(panel.boxes()[0]), 'Thought for 4s');
});

test('renders answer text and tool cards after the thought section', t => {
	const panel = createPanel();

	panel.thought('reasoning');
	panel.text('answer');
	panel.tool('call-1');
	panel.thought('more reasoning');
	panel.finish();

	t.is(panel.boxes().length, 1);
	t.true(panel.container.children[0].className.includes('thought-aggregator'));
	t.true(panel.container.children.length > 2);
});

test('renders the grouped thoughts as markdown when marked is loaded', t => {
	const panel = createPanel({marked: true});

	panel.thought('first');
	const box = panel.boxes()[0];
	t.is(box.children[1].innerHTML, '');

	panel.runTimers();
	t.is(box.children[1].innerHTML, '<md>first</md>');

	panel.text('answer');
	panel.thought('second');
	panel.finish();
	t.is(box.children[1].innerHTML, '<md>first\n\nsecond</md>');
});

test('keeps one section per response when a session is replayed', t => {
	const panel = createPanel();

	panel.post({type: 'clear', isLoading: true});
	panel.userMessage('first question');
	panel.thought('first response thought');
	panel.text('first answer');
	panel.userMessage('second question');
	panel.thought('second response thought');
	panel.text('second answer');
	panel.post({type: 'sessionLoaded'});

	const boxes = panel.boxes();
	t.is(boxes.length, 2);
	t.is(bodyOf(boxes[0]), 'first response thought');
	t.is(bodyOf(boxes[1]), 'second response thought');
});

test('closes a still-open section once the replayed session is loaded', t => {
	const panel = createPanel();

	panel.userMessage('question');
	panel.thought('trailing thought');
	panel.advance(6_000);
	panel.post({type: 'sessionLoaded'});

	const box = panel.boxes()[0];
	t.is(titleOf(box), 'Thought for 6s');
	t.false(isOpen(box));

	panel.advance(60_000);
	panel.runTimers();
	t.is(titleOf(box), 'Thought for 6s');
});

test('drops the section when the session is cleared', t => {
	const panel = createPanel();

	panel.thought('reasoning');
	panel.post({type: 'clear'});
	t.is(panel.boxes().length, 0);

	panel.thought('fresh reasoning');
	const boxes = panel.boxes();
	t.is(boxes.length, 1);
	t.is(bodyOf(boxes[0]), 'fresh reasoning');
});
