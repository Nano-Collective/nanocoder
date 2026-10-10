import {createContext, runInContext} from 'node:vm';
import test from 'ava';
import {createElement} from '@/vscode/chat-panel-harness';
import {renderWebModePage} from './page.js';

function bootBrowser(storageBlocked = false) {
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
	const copied: string[] = [];
	const timers = new Map<number, () => void>();
	let nextTimer = 0;
	const socketListeners = new Map<string, () => void>();
	class Socket {
		static OPEN = 1;
		readyState = 1;
		addEventListener(type: string, callback: () => void) {socketListeners.set(type, callback);}
		send(raw: string) {sent.push(JSON.parse(raw));}
	}
	const context = createContext({
		document: {querySelector: get, createElement: element, createTextNode: (text: string) => {const node = element('text'); node.textContent = text; return node;}, documentElement: root, addEventListener() {}},
		window: {location: {search: '?token=test', href: 'http://localhost/?token=test'}, localStorage: {getItem: (key: string) => {if (storageBlocked) throw new Error('Storage blocked'); return storage.get(key) ?? null;}, setItem: (key: string, value: string) => {if (storageBlocked) throw new Error('Storage blocked'); storage.set(key, value);}, removeItem: (key: string) => {if (storageBlocked) throw new Error('Storage blocked'); return storage.delete(key);}}, setTimeout: (callback: () => void) => {const id = ++nextTimer; timers.set(id, callback); return id;}, clearTimeout: (id: number) => timers.delete(id), matchMedia: () => ({matches: false})},
		URL, URLSearchParams, Event, WebSocket: Socket,
		navigator: {clipboard: {writeText: async (text: string) => {copied.push(text);}}},
	});
	const script = renderWebModePage('test').match(/<script nonce="test">([\s\S]*?)<\/script>/)![1];
	runInContext(script, context);
	context.copied = copied;
	context.disconnect = () => socketListeners.get('close')?.();
	return {get, sent, storage, flushTimers: () => {for (let count = 0; timers.size && count < 100; count++) {const pending = [...timers.values()]; timers.clear(); pending.forEach(callback => callback());}}, run: (code: string) => runInContext(code, context), event: (event: unknown) => runInContext(`handleServerEvent(${JSON.stringify(event)})`, context)};
}

test('browser boots without CDN globals and persists the full streamed reply', t => {
	const browser = bootBrowser();
	browser.event({type: 'ready', protocolVersion: 1});
	browser.event({type: 'assistant_delta', id: 'turn', text: 'Hello'});
	browser.event({type: 'assistant_delta', id: 'turn', text: ' world'});
	browser.run('flushAssistantRendering(); writeStoredMessages();');
	t.is(browser.get('#messageList').querySelector('.message-content')!.textContent, 'Hello world');
	const saved = JSON.parse(browser.storage.get('nanocoder.webMode.localSession.v1')!);
	t.is(saved[0].text, 'Hello world');
	browser.event({type: 'assistant_content', id: 'turn', text: 'Corrected'});
	browser.run('flushAssistantRendering();');
	t.is(browser.get('#messageList').querySelector('.message-content')!.textContent, 'Corrected');
});

test('panel navigation ignores stale replies and shows compact per-file source control', t => {
	const browser = bootBrowser();
	browser.run('runtimeReady = true; setComposerEnabled(true);');
	browser.get('#tasksPanelButton').click();
	const old = browser.sent.at(-1) as {id: string};
	browser.get('#changesPanelButton').click();
	const current = browser.sent.at(-1) as {id: string};
	browser.event({type: 'workspace_panel', id: old.id, data: {panel: 'tasks', items: [{name: 'Stale task'}]}});
	t.false(browser.get('#workspacePanelContent').textContent.includes('Stale task'));
	browser.event({type: 'workspace_panel', id: current.id, data: {panel: 'changes', items: [{name: 'file.ts', path: 'src/file.ts', detail: 'src', status: 'M'}]}});
	browser.get('#workspacePanelContent').querySelector('button')!.click();
	const selected = browser.sent.at(-1) as {id: string};
	t.like(selected, {panel: 'changes', path: 'src/file.ts'});
	browser.event({type: 'workspace_panel', id: selected.id, data: {panel: 'changes', path: 'src/file.ts', items: [{name: 'file.ts', path: 'src/file.ts', detail: 'src', status: 'M'}], diffs: [{title: 'Unstaged changes', content: '@@ -3,1 +3,1 @@\n-old\n+new'}]}});
	t.is(browser.get('#workspacePanelContent').querySelectorAll('.addition').length, 1);
	t.is(browser.get('#workspacePanelContent').querySelectorAll('.deletion').length, 1);
	t.is(browser.get('#workspacePanelContent').querySelector('.change-status')!.textContent, 'M');
	t.false(browser.sent.some((event: any) => event.type === 'user_message'));
});

test('reconnect releases a settings request whose acknowledgment was lost', t => {
	const browser = bootBrowser();
	browser.run("settingsRequestId = 'pending'; disconnect();");
	browser.event({type: 'ready', protocolVersion: 1});
	browser.event({type: 'state', activeTurnId: null, busy: false, session: null, messages: [], sessionRevision: 0, runtimeReady: true, settings: {provider: 'local', model: 'small', mode: 'normal', providers: [{name: 'local', models: ['small']}], modes: ['normal']}});
	t.is(browser.run('settingsRequestId'), null);
	t.false(browser.get('#saveSettingsButton').disabled);
});

test('tool IDs are scoped to their turn and updated output replaces the old result', t => {
	const browser = bootBrowser();
	for (const turn of ['first', 'second']) {
		browser.run(`setActiveTurn('${turn}');`);
		browser.event({type: 'tool_started', id: 'reused', name: 'read_file'});
		browser.event({type: 'tool_finished', id: 'reused', name: 'read_file', ok: true, output: turn});
	}
	t.is(browser.run("workSummaries.get('second').tools.children.length"), 1);
	t.true(browser.get('#messageList').textContent.includes('first'));
	browser.event({type: 'tool_finished', id: 'reused', name: 'read_file', ok: true, output: 'updated'});
	t.true(browser.get('#messageList').textContent.includes('updated'));
	t.false(browser.get('#messageList').textContent.includes('second'));
});

test('copy and time remain hidden through intermediate responses and appear only on the final reply', t => {
	const browser = bootBrowser();
	browser.run("setActiveTurn('turn');");
	browser.event({type: 'assistant_delta', id: 'turn', text: 'Checking'});
	browser.event({type: 'assistant_delta', id: 'turn:response:2', text: 'Done'});
	const footers = browser.get('#messageList').querySelectorAll('.message-footer');
	t.true(footers[0].hidden);
	t.true(footers[1].hidden);
	browser.event({type: 'turn_completed', id: 'turn'});
	t.true(footers[0].hidden);
	t.false(footers[1].hidden);
	browser.event({type: 'state', activeTurnId: null, busy: false, session: null, sessionRevision: 0, messages: [{id: 'turn', role: 'assistant', content: 'Checking', footerVisible: false}, {id: 'turn:response:2', role: 'assistant', content: 'Done', footerVisible: true}]});
	t.true(footers[0].hidden);
	t.false(footers[1].hidden);
});

test('empty cleaned assistant content removes its streamed tool text', t => {
	const browser = bootBrowser();
	browser.event({type: 'assistant_delta', id: 'turn', text: '<tool_call>read_file</tool_call>'});
	browser.event({type: 'assistant_content', id: 'turn', text: ''});
	browser.flushTimers();
	t.is(browser.get('#messageList').querySelectorAll('.message-content').length, 0);
	t.is(browser.run('storedMessages.length'), 0);
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
	browser.event({type: 'state', activeTurnId: null, busy: false, session: null, messages: [], runtimeReady: true, sessionRevision: 0});
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

test('transport readiness does not enable input until the runtime is ready', t => {
	const browser = bootBrowser();
	browser.event({type: 'ready', protocolVersion: 1});
	t.true(browser.get('#messageInput').disabled);
	browser.event({type: 'state', activeTurnId: null, busy: false, session: null, messages: [], sessionRevision: 0, runtimeReady: false, runtimeStatus: 'Approve directory trust in the terminal.'});
	t.true(browser.get('#composerNote').textContent.includes('Approve directory trust'));
	t.true(browser.get('#messageInput').disabled);
	browser.event({type: 'state', activeTurnId: null, busy: false, session: null, messages: [], sessionRevision: 0, runtimeReady: true});
	t.false(browser.get('#messageInput').disabled);
	t.is((browser.sent.at(-1) as {type: string}).type, 'list_sessions');
});

test('completion snapshots preserve errors and tool failure notices and reset clears them', t => {
	const browser = bootBrowser();
	const state = {type: 'state', activeTurnId: 'turn', busy: false, session: null, messages: [{role: 'user', id: 'turn', content: 'prompt'}], sessionRevision: 0, runtimeReady: true};
	browser.event(state);
	browser.event({type: 'tool_finished', id: 'tool', name: 'write_file', ok: false});
	browser.event({type: 'error', id: 'turn', message: 'Provider failed'});
	browser.event({...state, activeTurnId: null});
	t.true(browser.get('#messageList').textContent.includes('Provider failed'));
	t.true(browser.get('#messageList').textContent.includes('write file — failed'));
	browser.event({...state, activeTurnId: null, messages: [], sessionRevision: 1});
	t.is(browser.get('#messageList').textContent, '');
});

test('blocked browser storage does not prevent boot or chat', t => {
	const browser = bootBrowser(true);
	browser.event({type: 'ready', protocolVersion: 1});
	browser.event({type: 'state', activeTurnId: null, busy: false, session: null, messages: [], sessionRevision: 0, runtimeReady: true});
	browser.run("submitUserMessage('hello');");
	t.is(browser.run('activeTurnId !== null'), true);
});

test('settings populate configured models and submit a runtime update', t => {
	const browser = bootBrowser();
	browser.event({type: 'ready', protocolVersion: 1});
	browser.event({type: 'state', activeTurnId: null, busy: false, session: null, messages: [], sessionRevision: 0, runtimeReady: true,
		settings: {provider: 'local', model: 'small', mode: 'normal', providers: [{name: 'local', models: ['small', 'large']}], modes: ['normal', 'plan']}});
	t.is(browser.get('#modelSelect').value, 'small');
	browser.run("modelSelect.value = 'large'; settingsForm.dispatchEvent({type: 'submit', preventDefault() {}});");
	t.like(browser.sent.at(-1), {type: 'update_settings', provider: 'local', model: 'large', mode: 'normal'});
});

test('state updates retain message DOM and session-loaded does not render the chat twice', t => {
	const browser = bootBrowser();
	const state = {type: 'state', activeTurnId: null, busy: false, sessionRevision: 0, session: null, messages: [{id: 'turn', role: 'user', content: 'hello'}]};
	browser.event(state);
	const element = browser.get('#messageList').querySelector('.message');
	browser.event(state);
	t.is(browser.get('#messageList').querySelector('.message'), element);
	browser.event({type: 'session_loaded', session: {id: 'saved'}, messages: [{role: 'user', content: 'loaded'}]});
	t.is(browser.get('#messageList').querySelector('.message'), element);
});

test('composer attachments can be removed individually', t => {
	const browser = bootBrowser();
	browser.run("pendingImages = [{data: 'one'}, {data: 'two'}]; renderImagePreviews();");
	t.is(browser.get('#imagePreviewContainer').querySelectorAll('img').length, 2);
	browser.get('#imagePreviewContainer').querySelector('button')!.click();
	t.is(browser.run('pendingImages.length'), 1);
	t.is(browser.run('pendingImages[0].data'), 'two');
	browser.get('#imagePreviewContainer').querySelector('button')!.click();
	t.true(browser.get('#imagePreviewContainer').hidden);
});

test('sidebar reuses rows and types an updated session title', t => {
	const browser = bootBrowser();
	const session = {id: 'saved', title: 'hi', lastAccessedAt: new Date().toISOString()};
	browser.event({type: 'sessions', sessions: [session]});
	const row = browser.get('#threadList').querySelector('button');
	browser.event({type: 'sessions', sessions: [{...session, title: 'Fix Login Redirect'}]});
	t.is(browser.get('#threadList').querySelector('button'), row);
	t.true(browser.get('#threadList').textContent.includes('F'));
	t.false(browser.get('#threadList').textContent.includes('Fix Login Redirect'));
	browser.flushTimers();
	t.true(browser.get('#threadList').textContent.includes('Fix Login Redirect'));
});

test('images open a larger viewer and the close button dismisses it', t => {
	const browser = bootBrowser();
	browser.run("pendingImages = [{data: 'AA==', mediaType: 'image/png'}]; renderImagePreviews();");
	const image = browser.get('#imagePreviewContainer').querySelector('img')!;
	t.is(image.src, 'data:image/png;base64,AA==');
	image.click();
	t.false(browser.get('#imageViewer').hidden);
	t.is(browser.get('#expandedImage').src, image.src);
	browser.get('#closeImageViewer').click();
	t.true(browser.get('#imageViewer').hidden);
});

test('custom dropdown selects a model without a native select', t => {
	const browser = bootBrowser();
	browser.event({type: 'ready', protocolVersion: 1});
	browser.event({type: 'state', activeTurnId: null, busy: false, session: null, sessionRevision: 0, messages: [], runtimeReady: true, settings: {provider: 'local', model: 'small', mode: 'normal', providers: [{name: 'local', models: ['small', 'large']}], modes: ['normal']}});
	browser.run("fillSelect(modelSelect, ['small', 'large'], 'small');");
	browser.get('#modelSelect').click();
	t.false(browser.get('#modelOptions').hidden);
	browser.get('#modelOptions').querySelectorAll('button')[1].click();
	t.is(browser.get('#modelSelect').value, 'large');
	t.true(browser.get('#modelOptions').hidden);
});

test('empty composer shrinks immediately after submission', t => {
	const browser = bootBrowser();
	browser.event({type: 'ready', protocolVersion: 1});
	browser.event({type: 'state', activeTurnId: null, busy: false, session: null, sessionRevision: 0, messages: [], runtimeReady: true});
	browser.run("messageInput.value = 'multiline draft'; messageInput.style.height = '180px'; submitUserMessage(messageInput.value);");
	t.is(browser.get('#messageInput').style.height, 'auto');
});

test('active session appears immediately from state without waiting for session history', t => {
	const browser = bootBrowser();
	browser.event({type: 'state', activeTurnId: 'turn', busy: false, session: {id: 'new', title: 'hi nanocoder', lastAccessedAt: new Date().toISOString()}, sessionRevision: 0, messages: [], runtimeReady: true});
	t.true(browser.get('#threadList').textContent.includes('hi nanocoder'));
});

test('settings closes after a successful save and stays open on failure', t => {
	const browser = bootBrowser();
	browser.run("settingsModal.classList.remove('hidden'); settingsRequestId = 'save';");
	browser.event({type: 'error', id: 'save', message: 'Provider unavailable'});
	t.false(browser.get('#settingsModal').classList.contains('hidden'));
	browser.run("settingsRequestId = 'retry';");
	browser.event({type: 'ack', id: 'retry'});
	t.true(browser.get('#settingsModal').classList.contains('hidden'));
	t.is(browser.get('#settingsModal').getAttribute('aria-hidden'), 'true');
});

test('NC loader appears while waiting and disappears on text or turn completion', t => {
	const browser = bootBrowser();
	browser.event({type: 'state', activeTurnId: 'turn', busy: false, session: null, sessionRevision: 0, messages: [{id: 'turn', role: 'user', content: 'hello'}]});
	t.is(browser.get('#messageList').querySelectorAll('.response-loader').length, 1);
	browser.event({type: 'assistant_delta', id: 'turn', text: 'Hello'});
	t.is(browser.get('#messageList').querySelectorAll('.response-loader').length, 0);
	browser.run("setActiveTurn('next');");
	t.is(browser.get('#messageList').querySelectorAll('.response-loader').length, 1);
	browser.event({type: 'turn_completed', id: 'next'});
	t.is(browser.get('#messageList').querySelectorAll('.response-loader').length, 0);
});

test('message footers show timestamps and copy the full streamed reply', async t => {
	const browser = bootBrowser();
	browser.event({type: 'assistant_delta', id: 'reply', text: 'Hello'});
	browser.event({type: 'assistant_delta', id: 'reply', text: ' world'});
	browser.flushTimers();
	browser.event({type: 'turn_completed', id: 'reply'});
	t.truthy(browser.get('#messageList').querySelector('.message-time')!.textContent);
	browser.get('#messageList').querySelector('.message-footer')!.querySelector('button')!.click();
	await Promise.resolve();
	t.is(browser.run('copied[0]'), 'Hello world');
});

test('streamed reply retains its DOM through completion and authoritative history updates', t => {
	const browser = bootBrowser();
	const state = {type: 'state', activeTurnId: 'turn', busy: false, session: null, sessionRevision: 0, messages: [{id: 'turn', role: 'user', content: 'hello'}]};
	browser.event(state);
	browser.event({type: 'assistant_delta', id: 'turn', text: 'Hello world'});
	browser.flushTimers();
	const reply = browser.get('#messageList').querySelectorAll('.assistant')[0];
	browser.event({type: 'turn_completed', id: 'turn'});
	browser.event({...state, activeTurnId: null, messages: [...state.messages, {id: 'turn', role: 'assistant', content: 'Hello world'}]});
	t.is(browser.get('#messageList').querySelectorAll('.assistant')[0], reply);
	t.true(browser.get('#messageList').textContent.includes('Hello world'));
});

test('thinking and tools share a collapsible summary and tool completion updates one row', t => {
	const browser = bootBrowser();
	browser.event({type: 'state', activeTurnId: 'turn', busy: false, session: null, sessionRevision: 0, messages: []});
	browser.event({type: 'work_update', work: {id: 'turn', startedAt: Date.now(), status: 'working', reasoning: [{id: 'thought', text: 'Checking the file.'}], tools: []}});
	browser.event({type: 'tool_started', id: 'read', name: 'read_file', arguments: {path: 'README.md'}});
	const card = browser.get('#messageList').querySelector('.work-tool');
	browser.event({type: 'tool_finished', id: 'read', name: 'read_file', ok: true, output: 'File contents'});
	t.is(browser.get('#messageList').querySelector('.work-tool'), card);
	t.is(browser.get('#messageList').querySelectorAll('.work-tool').length, 1);
	t.true(browser.get('#messageList').textContent.includes('Checking the file.'));
	t.true(browser.get('#messageList').textContent.includes('File contents'));
	browser.event({type: 'turn_completed', id: 'turn'});
	t.is(browser.run("workSummaries.get('turn').element.open"), false);
});

test('permission request opens the work summary and puts approval on its tool row', t => {
	const browser = bootBrowser();
	browser.event({type: 'state', activeTurnId: 'turn', busy: false, session: null, sessionRevision: 0, messages: []});
	browser.event({type: 'approval_required', id: 'approval', toolCallId: 'edit', toolName: 'write_file', arguments: {path: 'README.md'}});
	t.is(browser.run("workSummaries.get('turn').element.open"), true);
	t.true(browser.get('#messageList').querySelector('.work-tool')!.textContent.includes('Approve'));
});
