import {createContext, runInContext} from 'node:vm';
import test from 'ava';
import {createElement} from '@/vscode/chat-panel-harness';
import {renderWebModePage} from './page.js';

function bootBrowser() {
	const elements = new Map<string, ReturnType<typeof createElement>>();
	const storage = new Map<string, string>();
	const root = createElement('html');
	const get = (selector: string) => {
		if (!elements.has(selector)) elements.set(selector, element('div'));
		return elements.get(selector)!;
	};
	function element(tag: string) {
		const node = createElement(tag);
		node.append = (...children: ReturnType<typeof createElement>[]) => children.forEach(child => node.appendChild(child));
		node.replaceChildren = (...children: ReturnType<typeof createElement>[]) => {node.innerHTML = ''; node.append(...children);};
		node.scrollIntoView = () => {};
		return node;
	}
	const sent: unknown[] = [];
	class Socket {
		static OPEN = 1;
		readyState = 1;
		addEventListener() {}
		send(raw: string) {sent.push(JSON.parse(raw));}
	}
	const context = createContext({
		document: {querySelector: get, createElement: element, createTextNode: (text: string) => {const node = element('text'); node.textContent = text; return node;}, documentElement: root, addEventListener() {}},
		window: {location: {search: '?token=test', href: 'http://localhost/?token=test'}, localStorage: {getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key)}, setTimeout: () => 1, matchMedia: () => ({matches: false})},
		URL, URLSearchParams, WebSocket: Socket,
	});
	const script = renderWebModePage('test').match(/<script nonce="test">([\s\S]*?)<\/script>/)![1];
	runInContext(script, context);
	return {get, sent, storage, run: (code: string) => runInContext(code, context), event: (event: unknown) => runInContext(`handleServerEvent(${JSON.stringify(event)})`, context)};
}

test('browser boots without CDN globals and persists the full streamed reply', t => {
	const browser = bootBrowser();
	browser.event({type: 'ready', protocolVersion: 1});
	browser.event({type: 'assistant_delta', id: 'turn', text: 'Hello'});
	browser.event({type: 'assistant_delta', id: 'turn', text: ' world'});
	t.is(browser.get('#messageList').textContent, 'Hello world');
	const saved = JSON.parse(browser.storage.get('nanocoder.webMode.localSession.v1')!);
	t.is(saved[0].text, 'Hello world');
	browser.event({type: 'assistant_content', id: 'turn', text: 'Corrected'});
	t.is(browser.get('#messageList').textContent, 'Corrected');
});

test('state restores another tab or refreshed browser with prompt, reply, images and stop control', t => {
	const browser = bootBrowser();
	browser.event({type: 'ready', protocolVersion: 1});
	browser.event({type: 'state', activeTurnId: 'turn', busy: false, session: null, messages: [
		{id: 'turn', role: 'user', content: 'Prompt', images: [{data: 'data:image/png;base64,AA==', mediaType: 'image/png'}]},
		{id: 'turn', role: 'assistant', content: 'Reply'},
	]});
	t.is(browser.run('activeTurnId'), 'turn');
	t.is(browser.get('#sendButton').getAttribute('aria-label'), 'Cancel response');
	t.true(browser.get('#messageInput').disabled);
	t.true(browser.get('#messageList').textContent.includes('Prompt'));
	t.true(browser.get('#messageList').textContent.includes('Reply'));
	t.is(browser.get('#messageList').querySelectorAll('img').length, 1);
	browser.event({type: 'error', id: 'history', message: 'history failed'});
	t.is(browser.run('activeTurnId'), 'turn');
});

test('reset waits for success, keeps failed reset history, and clears attachments after acknowledgment', t => {
	const browser = bootBrowser();
	browser.event({type: 'ready', protocolVersion: 1});
	browser.run("appendMessage('user', 'keep this'); pendingImages = [{data: 'data:image/png;base64,AA==', mediaType: 'image/png'}]; renderImagePreviews();");
	t.false(browser.get('#sendButton').disabled);
	browser.get('#newChatButton').click();
	t.true(browser.get('#messageList').textContent.includes('keep this'));
	const reset = browser.sent.at(-1) as {id: string; type: string};
	t.is(reset.type, 'reset_session');
	browser.event({type: 'error', id: reset.id, message: 'reset failed'});
	t.true(browser.get('#messageList').textContent.includes('keep this'));
	t.is(browser.run('pendingImages.length'), 1);
	browser.get('#newChatButton').click();
	const retry = browser.sent.at(-1) as {id: string};
	browser.event({type: 'state', activeTurnId: null, busy: false, session: null, messages: []});
	browser.event({type: 'ack', id: retry.id});
	t.is(browser.run('pendingImages.length'), 0);
	t.is(browser.get('#messageList').textContent, '');
});

test('a reset from another tab clears image drafts even when neither session has an id', t => {
	const browser = bootBrowser();
	browser.event({type: 'ready', protocolVersion: 1});
	browser.event({type: 'state', activeTurnId: null, busy: false, session: null, messages: [], sessionRevision: 0});
	browser.run("pendingImages = [{data: 'data:image/png;base64,AA==', mediaType: 'image/png'}]; messageInput.value = 'draft'; renderImagePreviews();");
	browser.event({type: 'state', activeTurnId: null, busy: false, session: null, messages: [], sessionRevision: 1});
	t.is(browser.run('pendingImages.length'), 0);
	t.is(browser.get('#messageInput').value, '');
});
