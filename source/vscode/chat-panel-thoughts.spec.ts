import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createContext, runInContext} from 'node:vm';
import test from 'ava';

const PANEL_SOURCE = readFileSync(
	fileURLToPath(
		new URL('../../plugins/vscode/media/chat-panel.js', import.meta.url),
	),
	'utf8',
);

const SHELL_IDS = [
	'add-image-btn',
	'attach-btn',
	'chat-input',
	'chat-view',
	'close-modal-btn',
	'composer-box',
	'context-chips',
	'history-list',
	'history-view',
	'icon-send',
	'icon-stop',
	'image-modal',
	'image-preview-container',
	'image-upload',
	'messages-container',
	'modal-image',
	'mode-dropdown',
	'mode-trigger',
	'mode-trigger-label',
	'model-dropdown',
	'model-trigger',
	'model-trigger-label',
	'provider-dropdown',
	'provider-trigger',
	'provider-trigger-label',
	'send-stop-btn',
];

type StubElement = any;

function createElement(tagName: string): StubElement {
	const classes = new Set<string>();
	const attributes = new Map<string, string>();
	let html = '';
	let text = '';

	const element: StubElement = {
		tagName,
		id: '',
		className: '',
		title: '',
		value: '',
		disabled: false,
		files: null,
		style: {},
		dataset: {},
		children: [] as StubElement[],
		parentElement: null as StubElement | null,
		classList: {
			add: (...names: string[]) => names.forEach(name => classes.add(name)),
			remove: (...names: string[]) =>
				names.forEach(name => classes.delete(name)),
			contains: (name: string) => classes.has(name),
			toggle: (name: string, force?: boolean) => {
				const on = force === undefined ? !classes.has(name) : force;
				if (on) classes.add(name);
				else classes.delete(name);
			},
		},
		appendChild(child: StubElement) {
			child.parentElement = element;
			element.children.push(child);
			return child;
		},
		removeChild(child: StubElement) {
			element.children = element.children.filter(
				(candidate: StubElement) => candidate !== child,
			);
			child.parentElement = null;
			return child;
		},
		remove() {
			element.parentElement?.removeChild(element);
		},
		querySelector: () => null,
		querySelectorAll: () => [],
		closest: () => null,
		setAttribute: (name: string, value: string) => attributes.set(name, value),
		getAttribute: (name: string) => attributes.get(name) ?? null,
		addEventListener: () => {},
		removeEventListener: () => {},
		focus: () => {},
		click: () => {},
		scrollTop: 0,
		scrollHeight: 0,
	};

	Object.defineProperty(element, 'innerHTML', {
		get: () => html,
		set: (value: string) => {
			html = String(value);
			element.children = [];
		},
	});
	Object.defineProperty(element, 'textContent', {
		get: () => text,
		set: (value: string) => {
			text = String(value);
		},
	});

	return element;
}

function findById(root: StubElement, id: string): StubElement | null {
	for (const child of root.children) {
		if (child.id === id) return child;
		const found = findById(child, id);
		if (found) return found;
	}
	return null;
}

function createPanel(options: {marked?: boolean} = {}) {
	const clock = {now: 1_700_000_000_000};

	class FakeDate extends Date {
		constructor(...args: any[]) {
			super(...((args.length ? args : [clock.now]) as []));
		}
		static now() {
			return clock.now;
		}
	}

	let nextTimerId = 1;
	const timers = new Map<number, {fn: () => void; repeat: boolean}>();
	const schedule = (fn: () => void, repeat: boolean) => {
		const id = nextTimerId++;
		timers.set(id, {fn, repeat});
		return id;
	};
	const cancel = (id: number) => {
		timers.delete(id);
	};

	const root = createElement('html');
	const body = createElement('body');
	root.appendChild(body);
	for (const id of SHELL_IDS) {
		const element = createElement('div');
		element.id = id;
		body.appendChild(element);
	}

	const messageListeners: ((event: {data: unknown}) => void)[] = [];
	const sandbox: Record<string, unknown> = {
		document: {
			body,
			createElement,
			createElementNS: (_namespace: string, tagName: string) =>
				createElement(tagName),
			getElementById: (id: string) => findById(root, id),
			querySelector: () => null,
			querySelectorAll: () => [],
			addEventListener: () => {},
		},
		window: {
			addEventListener: (
				type: string,
				fn: (event: {data: unknown}) => void,
			) => {
				if (type === 'message') messageListeners.push(fn);
			},
		},
		navigator: {userAgent: '', clipboard: {writeText: async () => {}}},
		acquireVsCodeApi: () => ({
			postMessage: () => {},
			getState: () => undefined,
			setState: () => {},
		}),
		setTimeout: (fn: () => void) => schedule(fn, false),
		setInterval: (fn: () => void) => schedule(fn, true),
		clearTimeout: cancel,
		clearInterval: cancel,
		Date: FakeDate,
		console,
	};
	if (options.marked) {
		sandbox.marked = {parse: (value: string) => `<md>${value}</md>`};
	}

	createContext(sandbox);
	runInContext(PANEL_SOURCE, sandbox);

	const container = findById(root, 'messages-container') as StubElement;

	return {
		container,
		post(message: unknown) {
			for (const listener of messageListeners) listener({data: message});
		},
		update(update: Record<string, unknown>) {
			this.post({type: 'acpUpdate', update});
		},
		thought(value: string) {
			this.update({
				sessionUpdate: 'agent_thought_chunk',
				content: {type: 'text', text: value},
			});
		},
		text(value: string) {
			this.update({
				sessionUpdate: 'agent_message_chunk',
				content: {type: 'text', text: value},
			});
		},
		tool(toolCallId: string) {
			this.update({
				sessionUpdate: 'tool_call',
				toolCallId,
				title: 'read_file',
				status: 'pending',
			});
		},
		finish() {
			this.update({sessionUpdate: 'prompt_response'});
		},
		userMessage(value: string) {
			this.update({
				sessionUpdate: 'user_message_chunk',
				content: {type: 'text', text: value},
			});
		},
		advance(ms: number) {
			clock.now += ms;
		},
		runTimers() {
			for (const [id, timer] of [...timers]) {
				if (!timer.repeat) timers.delete(id);
				timer.fn();
			}
		},
		boxes(): StubElement[] {
			return container.children.filter((child: StubElement) =>
				child.className.includes('thought-aggregator'),
			);
		},
	};
}

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
