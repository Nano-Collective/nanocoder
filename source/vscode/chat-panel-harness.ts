/**
 * Boots `plugins/vscode/media/chat-panel.js` inside a VM against a stub DOM so
 * the panel's rendering can be driven and inspected from tests. Shared by the
 * chat-panel specs; extracted verbatim from chat-panel-thoughts.spec.ts.
 *
 * `mention-utils.js` must run first: the real webview loads it before
 * `chat-panel.js`, which immediately reads `globalThis.NanocoderMentionUtils`.
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
	'context-chips',
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

// The panel assigns arbitrary properties (onclick, oninput, ...) to the nodes it
// builds, so the stub has to stay open-ended.
// biome-ignore lint/suspicious/noExplicitAny: stub nodes are intentionally open-ended
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
		click: (event: StubElement = {}) => {
			for (const fn of listeners.get('click') ?? []) fn(event);
		},
		scrollTop: 0,
		scrollHeight: 0,
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
	for (const id of SHELL_IDS) {
		const element = createElement('div');
		element.id = id;
		body.appendChild(element);
	}

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
		/** Any node in the stub shell, by id. */
		byId(id: string): StubElement | null {
			return findById(root, id);
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
		/** The tool-call cards, in the order they were inserted. */
		aggregators(): StubElement[] {
			return container.children.filter((child: StubElement) =>
				child.className.includes('tool-aggregator'),
			);
		},
		/** The copy/timestamp footers currently in the transcript. */
		footers(): StubElement[] {
			return container.querySelectorAll('.message-footer');
		},
	};
}
