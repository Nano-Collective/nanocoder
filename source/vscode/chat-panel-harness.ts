/**
 * Boots the chat panel scripts inside a VM against a stub DOM so the panel's
 * rendering can be driven and inspected from tests. Shared by the chat-panel
 * specs. Mirrors production load order in chat-panel.html: the helper scripts
 * must run first because chat-panel.js reads `globalThis.NanocoderMentionUtils`
 * and `globalThis.NanocoderSlashCommandUtils` at IIFE eval time.
 */
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createContext, runInContext} from 'node:vm';

const mediaUrl = (filename: string) =>
	fileURLToPath(
		new URL(`../../plugins/vscode/media/${filename}`, import.meta.url),
	);

// The panel reads its siblings off `globalThis` at load - the slash command
// table is destructured at the top level, so a missing one throws before a
// single element is built. chat-panel.html loads them ahead of the panel; this
// list mirrors that order.
const MENTION_UTILS_SOURCE = readFileSync(mediaUrl('mention-utils.js'), 'utf8');
const URI_UTILS_SOURCE = readFileSync(mediaUrl('uri-utils.js'), 'utf8');
const SLASH_COMMAND_UTILS_SOURCE = readFileSync(
	mediaUrl('slash-command-utils.js'),
	'utf8',
);
const PANEL_SOURCE = readFileSync(mediaUrl('chat-panel.js'), 'utf8');

const SHELL_IDS = [
	'add-image-btn',
	'add-menu-btn',
	'add-menu-dropdown',
	'attach-btn',
	'chat-input',
	'chat-view',
	'close-modal-btn',
	'composer-box',
	'composer-mode-badge',
	'composer-settings',
	'composer-settings-trigger',
	'context-chips',
	'context-chips-clear',
	'history-list',
	'history-view',
	'icon-send',
	'icon-stop',
	'image-modal',
	'image-preview-container',
	'image-upload',
	'menu-attach-file',
	'menu-upload-image',
	'mention-dropdown',
	'messages-container',
	'slash-dropdown',
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
	'timeline-confirm',
	'timeline-hint',
	'timeline-nodes',
	'timeline-strip',
	'timeline-track',
];

// The panel assigns arbitrary properties (onclick, oninput, ...) to the nodes
// it builds, so the stub has to stay open-ended.
// biome-ignore lint/suspicious/noExplicitAny: open-ended DOM stub
export type StubElement = any;

/**
 * Matches the selector forms the panel actually uses: a single class ('.foo')
 * or a bare tag name ('svg'). Classes are checked against both `className` and
 * `classList`, since the stub keeps those independent.
 */
function matchesSelector(element: StubElement, selector: string): boolean {
	if (selector.startsWith('.')) {
		const name = selector.slice(1);
		return element.classList.contains(name);
	}
	return String(element.tagName ?? '').toLowerCase() === selector.toLowerCase();
}

function queryAll(root: StubElement, selector: string): StubElement[] {
	const found: StubElement[] = [];
	for (const child of root.children) {
		if (matchesSelector(child, selector)) found.push(child);
		found.push(...queryAll(child, selector));
	}
	return found;
}

export function createElement(tagName: string): StubElement {
	const classes = new Set<string>();
	const attributes = new Map<string, string>();
	// Registered handlers, so a test can drive a real listener rather than only
	// the `onclick` properties the panel assigns directly.
	const listeners = new Map<string, ((event: StubElement) => void)[]>();
	let html = '';
	let text = '';

	const element: StubElement = {
		tagName,
		id: '',
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
			// Real appendChild moves a node rather than cloning it, and the panel
			// relies on that when a card is re-homed into the work summary.
			if (child.parentElement && child.parentElement !== element) {
				child.parentElement.removeChild(child);
			}
			child.parentElement = element;
			if (!element.children.includes(child)) element.children.push(child);
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
		querySelector: (selector: string) => queryAll(element, selector)[0] ?? null,
		querySelectorAll: (selector: string) => queryAll(element, selector),
		closest: () => null,
		setAttribute: (name: string, value: string) => attributes.set(name, value),
		getAttribute: (name: string) => attributes.get(name) ?? null,
		removeAttribute: (name: string) => {
			attributes.delete(name);
		},
		addEventListener: (type: string, fn: (event: StubElement) => void) => {
			const registered = listeners.get(type);
			if (registered) registered.push(fn);
			else listeners.set(type, [fn]);
		},
		removeEventListener: (type: string, fn: (event: StubElement) => void) => {
			listeners.set(
				type,
				(listeners.get(type) ?? []).filter(candidate => candidate !== fn),
			);
		},
		focus: () => {},
		click: (event: StubElement = {stopPropagation() {}}) => {
			if (element.disabled) return;
			for (const fn of listeners.get('click') ?? []) fn(event);
		},
		/** Drive any registered listener, not just click. */
		dispatch: (type: string, event: StubElement = {}) => {
			for (const fn of listeners.get(type) ?? []) fn(event);
		},
		scrollTop: 0,
		scrollHeight: 0,
		scrollLeft: 0,
		scrollWidth: 0,
	};

	Object.defineProperty(element, 'className', {
		get: () => [...classes].join(' '),
		set: (value: string) => {
			classes.clear();
			for (const name of String(value).split(' ')) {
				if (name) classes.add(name);
			}
		},
	});

	Object.defineProperty(element, 'innerHTML', {
		get: () => html,
		set: (value: string) => {
			html = String(value);
			// Detached children must not keep claiming this node as their parent,
			// or remove() on one of them would corrupt the new child list.
			for (const child of element.children) child.parentElement = null;
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

export function findById(root: StubElement, id: string): StubElement | null {
	for (const child of root.children) {
		if (child.id === id) return child;
		const found = findById(child, id);
		if (found) return found;
	}
	return null;
}

export function createPanel(options: {marked?: boolean} = {}) {
	const clock = {now: 1_700_000_000_000};

	class FakeDate extends Date {
		// biome-ignore lint/suspicious/noExplicitAny: mirrors the Date constructor overloads.
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
	// Mirrors the `hidden` class these carry in chat-panel.html, so a panel that
	// never renders a chip looks the same here as it does on load.
	const hiddenOnLoad = new Set([
		'add-menu-dropdown',
		'composer-settings',
		'context-chips',
		'context-chips-clear',
		'mention-dropdown',
		'mode-dropdown',
		'model-dropdown',
		'provider-dropdown',
		'slash-dropdown',
	]);
	for (const id of SHELL_IDS) {
		const element = createElement('div');
		element.id = id;
		if (hiddenOnLoad.has(id)) element.classList.add('hidden');
		body.appendChild(element);
	}

	const documentListeners = new Map<
		string,
		Array<(event: StubElement) => void>
	>();
	const messageListeners: ((event: {data: unknown}) => void)[] = [];
	// Everything the panel posts back to the extension host.
	const sent: unknown[] = [];
	// Everything a copy button has put on the clipboard, newest last.
	const copied: string[] = [];
	const sandbox: Record<string, unknown> = {
		document: {
			body,
			createElement,
			createElementNS: (_namespace: string, tagName: string) =>
				createElement(tagName),
			getElementById: (id: string) => findById(root, id),
			querySelector: (selector: string) => queryAll(root, selector)[0] ?? null,
			querySelectorAll: (selector: string) => queryAll(root, selector),
			addEventListener: (type: string, fn: (event: StubElement) => void) => {
				const registered = documentListeners.get(type);
				if (registered) registered.push(fn);
				else documentListeners.set(type, [fn]);
			},
		},
		window: {
			addEventListener: (
				type: string,
				fn: (event: {data: unknown}) => void,
			) => {
				if (type === 'message') messageListeners.push(fn);
			},
		},
		navigator: {
			userAgent: '',
			clipboard: {
				writeText: async (value: string) => {
					copied.push(value);
				},
			},
		},
		acquireVsCodeApi: () => ({
			postMessage: (message: unknown) => {
				sent.push(message);
			},
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

	sandbox.globalThis = sandbox;
	createContext(sandbox);
	runInContext(MENTION_UTILS_SOURCE, sandbox);
	runInContext(URI_UTILS_SOURCE, sandbox);
	runInContext(SLASH_COMMAND_UTILS_SOURCE, sandbox);
	runInContext(PANEL_SOURCE, sandbox);

	const container = findById(root, 'messages-container') as StubElement;

	return {
		container,
		sent,
		copied,
		/** Any shell element by id, for panels rendered outside the transcript. */
		byId(id: string): StubElement | null {
			return findById(root, id);
		},
		dispatchDocument(type: string, event: StubElement = {}) {
			const payload = {
				preventDefault() {},
				stopPropagation() {},
				...event,
			};
			for (const fn of documentListeners.get(type) ?? []) fn(payload);
		},
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
		finish(outcome: string = 'completed') {
			this.update({sessionUpdate: 'prompt_response', outcome});
		},
		userMessage(value: string) {
			this.update({
				sessionUpdate: 'user_message_chunk',
				content: {type: 'text', text: value},
			});
		},
		/**
		 * Start a real turn, so `isProcessing` is set and the Stop button is
		 * live. `userMessage` only replays a message; it starts no turn.
		 */
		startTurn(text: string) {
			this.post({type: 'runPrompt', text});
		},
		/** Press Stop, the way the user cancels a turn. */
		stop() {
			(findById(root, 'send-stop-btn') as StubElement).click();
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
		/** The per-turn work summaries, in the order they were inserted. */
		summaries(): StubElement[] {
			return container.children.filter((child: StubElement) =>
				child.className.includes('work-summary'),
			);
		},
		/** Every stretch of reasoning, across all summaries. */
		thoughts(): StubElement[] {
			return container.querySelectorAll('.work-summary-thought');
		},
		/** The tool-call group cards, in the order they were inserted. */
		aggregators(): StubElement[] {
			return container.querySelectorAll('.tool-aggregator');
		},
		/** The copy/timestamp footers currently in the transcript. */
		footers(): StubElement[] {
			return container.querySelectorAll('.message-footer');
		},
	};
}
