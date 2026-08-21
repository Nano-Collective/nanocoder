import test from 'ava';
import {createPageNonce, nanocoderLogoSvg, renderWebModePage} from './page.js';

test('web mode page renders the Nanocoder logo asset markup', t => {
	t.true(nanocoderLogoSvg.includes('aria-label="Nanocoder"'));
	t.true(nanocoderLogoSvg.includes('viewBox="0 0 64 64"'));
	t.true(nanocoderLogoSvg.includes('#7dcfff'));
});

test('web mode page gives icon, thread, and send buttons a visible keyboard focus state', t => {
	const page = renderWebModePage();

	t.true(page.includes('.icon-button:hover,\n\t\t.icon-button:focus-visible {'));
	t.true(page.includes('.thread-item:hover,\n\t\t.thread-item:focus-visible {'));
	t.true(
		page.includes(
			'.send-button:not(:disabled):hover,\n\t\t.send-button:not(:disabled):focus-visible {',
		),
	);
});

test('web mode page styles the sidebar and message scrollbars instead of using the browser default', t => {
	const page = renderWebModePage();

	t.true(page.includes('.thread-list::-webkit-scrollbar {'));
	t.true(page.includes('.messages::-webkit-scrollbar {'));
	t.true(page.includes('scrollbar-width: thin;'));
});

test('web mode page snaps the message list to the newest content instead of animating every scroll', t => {
	const page = renderWebModePage();

	// scrollTop is reassigned on every appendMessage()/appendAssistantDelta()
	// call, i.e. once per streamed token. CSS scroll-behavior: smooth turns
	// each of those into a queued animation; browsers throttle rAF work in a
	// backgrounded tab, so the queue drains all at once, as a visible jump,
	// the moment the tab regains focus.
	t.false(page.includes('scroll-behavior: smooth'));
});

test('web mode page tells the backend to reset the session when starting a new chat', t => {
	const page = renderWebModePage();

	t.true(
		page.includes(
			"sendClientEvent({type: 'reset_session', id: 'browser-reset-' + Date.now()});",
		),
	);
	const newChatHandlerIndex = page.indexOf("newChatButton.addEventListener('click'");
	const resetEventIndex = page.indexOf("type: 'reset_session'");
	t.true(newChatHandlerIndex >= 0 && resetEventIndex > newChatHandlerIndex);
});

test('web mode page restores a rejected message into the composer instead of losing it', t => {
	const page = renderWebModePage();

	t.true(page.includes('const pendingMessageElement = message.id'));
	t.true(page.includes("pendingMessageElement.querySelector('.message-content').textContent"));
	t.true(page.includes("updateMessageMeta(pendingMessageElement, 'Not sent — ' + message.message)"));
	t.true(page.includes('pendingMessages.delete(message.id)'));
	t.true(page.includes('setPromptText(failedText)'));
});

test('web mode page reconnects the WebSocket with backoff instead of requiring a manual refresh', t => {
	const page = renderWebModePage();

	t.true(page.includes('function connectSocket() {'));
	t.true(page.includes('function scheduleReconnect() {'));
	t.true(page.includes('scheduleReconnect();'));
	t.true(page.includes('reconnectDelayMs = Math.min(reconnectDelayMs * 2, maxReconnectDelayMs);'));
	t.true(page.includes("setStatus('Reconnecting…', '');"));
	t.false(page.includes("setStatus('Disconnected', 'disconnected');"));
});

test('web mode page links the favicon and scopes inline style/script to the given nonce', t => {
	const nonce = createPageNonce();
	const page = renderWebModePage(nonce);

	t.true(
		page.includes(
			'<link rel="icon" type="image/svg+xml" href="/assets/nanocoder-icon.svg">',
		),
	);
	t.true(page.includes(`<style nonce="${nonce}">`));
	t.true(page.includes(`<script nonce="${nonce}">`));
});

test('web mode page renders prompt controls as real buttons', t => {
	const page = renderWebModePage();

	t.true(page.includes("pill.className = 'mode-pill'"));
	t.true(page.includes("pill.type = 'button'"));
	t.true(page.includes("promptButton.className = 'prompt-button'"));
	t.true(page.includes("promptButton.type = 'button'"));
	t.true(
		page.includes('Summarize this repository and suggest the next clean change'),
	);
	t.true(page.includes('Find the safest place to wire browser chat into the CLI'));
	t.false(page.includes('Phase 4'));
});

test('web mode page uses one delegated prompt click handler', t => {
	const page = renderWebModePage();

	t.true(page.includes("emptyState.addEventListener('click'"));
	t.true(page.includes("event.target.closest('[data-prompt]')"));
	t.true(page.includes("target.dataset.action === 'submit'"));
	t.true(page.includes('submitUserMessage(prompt)'));
	t.true(page.includes('setPromptText(prompt)'));
});

test('web mode messages layer does not block empty-state prompt clicks', t => {
	const page = renderWebModePage();

	t.true(page.includes('.messages {'));
	t.true(page.includes('pointer-events: none;'));
	t.true(page.includes('.message {'));
	t.true(page.includes('pointer-events: auto;'));
	t.true(page.includes('.empty-state {'));
	t.true(page.includes('z-index: 2;'));
});

test('web mode composer sends cancellation for the active runtime turn', t => {
	const page = renderWebModePage();

	t.true(page.includes('let activeTurnId = null'));
	t.true(page.includes("sendClientEvent({type: 'cancel', id: activeTurnId})"));
	t.true(page.includes("sendButton.classList.toggle('is-cancel', isActive)"));
	t.true(page.includes("isActive ? 'Cancel response' : 'Send message'"));
	t.true(page.includes('Nanocoder is working. Use the stop button to cancel.'));
	t.false(page.includes("appendMessage('system', 'Turn completed'"));
});

test('web mode renders streamed assistant output as safe markdown', t => {
	const page = renderWebModePage();

	t.true(page.includes('function renderAssistantText(element, text)'));
	t.true(page.includes("document.createElement('pre')"));
	t.true(page.includes("document.createElement('li')"));
	t.true(page.includes('textElement.dataset.rawText = nextText'));
	t.false(page.includes("appendMessage('assistant', '', 'Assistant output')"));
});

test('web mode renders actionable approval and question cards', t => {
	const page = renderWebModePage();

	t.true(page.includes('function renderApprovalCard(message)'));
	t.true(page.includes('function renderQuestionCard(message)'));
	t.true(page.includes("type: 'approval_response'"));
	t.true(page.includes("type: 'question_response'"));
	t.true(page.includes("approveButton.textContent = 'Approve'"));
	t.true(page.includes("denyButton.textContent = 'Deny'"));
	t.true(page.includes("message.allowFreeform"));
	t.false(page.includes("appendMessage('system', message.reason, 'Approval required')"));
	t.false(page.includes("appendMessage('system', message.question, 'Question required')"));
});

test('web mode shows live tool running and completed status', t => {
	const page = renderWebModePage();

	t.true(page.includes("'system tool-status', 'Running tool: ' + message.name"));
	t.true(page.includes("'Tool finished: ' + message.name"));
	t.true(
		page.includes(
			'Provider and model stay in the terminal runtime; during a browser turn, approvals and questions are answered here.',
		),
	);
});

test('web mode page ships a light theme that cannot affect the dark default', t => {
	const page = renderWebModePage();

	t.true(page.includes(':root[data-theme="light"] {'));
	t.true(page.includes(':root[data-theme="light"] body {'));
	t.true(page.includes(':root[data-theme="light"] .message.user {'));
	// Every light rule is scoped by the attribute selector, so it can only ever
	// apply once <html data-theme="light"> is set; it never edits an existing
	// dark rule.
	const lightRuleCount = (page.match(/:root\[data-theme="light"\]/gu) ?? []).length;
	t.true(lightRuleCount > 20);
});

test('web mode page toggles and persists the theme', t => {
	const page = renderWebModePage();

	t.true(page.includes("id=\"themeToggleButton\""));
	t.true(page.includes('function applyTheme(theme)'));
	t.true(page.includes("document.documentElement.dataset.theme = theme"));
	t.true(page.includes("window.localStorage.setItem(themeStorageKey, theme)"));
	t.true(
		page.includes(
			"window.matchMedia('(prefers-color-scheme: light)').matches",
		),
	);
	t.true(
		page.includes(
			"applyTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light')",
		),
	);
});

test('web mode page collapses and persists the sidebar', t => {
	const page = renderWebModePage();

	t.true(page.includes('id="sidebarToggleButton"'));
	t.true(page.includes('.app-shell.sidebar-collapsed {'));
	t.true(page.includes('.app-shell.sidebar-collapsed .sidebar {'));
	t.true(page.includes('function applySidebarCollapsed(isCollapsed)'));
	t.true(page.includes("appShell.classList.toggle('sidebar-collapsed', isCollapsed)"));
	t.true(
		page.includes(
			"applySidebarCollapsed(!appShell.classList.contains('sidebar-collapsed'))",
		),
	);
	t.true(page.includes('window.localStorage.setItem(sidebarStorageKey'));
});

test('web mode page reduces metadata label weight so it does not compete with primary text', t => {
	const page = renderWebModePage();

	t.true(
		page.includes('.meta {\n\t\t\tcolor: rgba(245, 242, 235, 0.5);\n\t\t\tfont-size: 11px;'),
	);
	t.false(page.includes('font-size: 12px;\n\t\t}\n\t\t.message.user .meta'));
});

test('web mode markdown renderer supports italics, strikethrough, and links', t => {
	const page = renderWebModePage();

	t.true(page.includes('function appendInlineMarkdown(element, text)'));
	t.true(page.includes("const isBold = remainingText.startsWith('**')"));
	t.true(page.includes("const isStrike = !isBold && remainingText.startsWith('~~')"));
	t.true(
		page.includes(
			"const isItalic = !isBold && !isStrike && !isCode && remainingText.startsWith('*')",
		),
	);
	t.true(page.includes("tagName = isBold ? 'strong' : isStrike ? 's' : isCode ? 'code' : 'em'"));
	// Link handling: parsed with its own regex ahead of the marker scan, and
	// recurses on the link text so `[**bold** link](url)` still bolds inside it.
	t.true(page.includes("anchor.rel = 'noopener noreferrer'"));
	t.true(page.includes('appendInlineMarkdown(anchor, linkMatch[1])'));
});

test('web mode code blocks get language-aware syntax highlighting', t => {
	const page = renderWebModePage();

	t.true(page.includes('function highlightCode(codeElement, rawText, language)'));
	t.true(page.includes("codeElement.className = language ? 'language-' + language : ''"));
	t.true(page.includes("span.className = 'tok-' + tokenType"));
	t.true(page.includes('rawText.matchAll(CODE_TOKEN_PATTERN)'));
	// Language tag is read from the opening fence line, e.g. ```js.
	t.true(page.includes('codeLang = line.trim().slice(codeFence.length).trim()'));
});

test('web mode page requests real session history instead of showing hardcoded threads', t => {
	const page = renderWebModePage();

	// The three hardcoded thread buttons are gone; the sidebar starts empty
	// and is populated once the backend replies.
	t.false(page.includes('data-thread-label="Nanocoder web mode"'));
	t.false(page.includes('Runtime bridge next'));
	t.false(page.includes('Tool approvals'));
	t.true(page.includes('id="threadListEmpty"'));
	t.true(page.includes("sendClientEvent({type: 'list_sessions'"));
	t.true(page.includes('function renderThreadList(sessions)'));
	t.true(page.includes('function applyLoadedSession(sessionSummary, messages)'));
});

test('web mode page loads a session on click and guards against switching mid-turn', t => {
	const page = renderWebModePage();

	t.true(page.includes("threadList.addEventListener('click'"));
	t.true(page.includes("event.target.closest('.thread-item')"));
	t.true(
		page.includes(
			"sendClientEvent({\n\t\t\t\t\ttype: 'load_session',\n\t\t\t\t\tid: 'browser-load-' + Date.now(),\n\t\t\t\t\tsessionId: target.dataset.sessionId,\n\t\t\t\t});",
		),
	);
	t.true(
		page.includes(
			"'Finish or cancel the current turn before switching sessions.'",
		),
	);
});

test('web mode page handles the sessions and session_loaded server events', t => {
	const page = renderWebModePage();

	t.true(page.includes("if (message.type === 'sessions') {"));
	t.true(page.includes('renderThreadList(message.sessions)'));
	t.true(page.includes("if (message.type === 'session_loaded') {"));
	t.true(page.includes('applyLoadedSession(message.session, message.messages)'));
});

test('web mode history button reveals and refreshes the real session list', t => {
	const page = renderWebModePage();

	const historyHandlerIndex = page.indexOf("historyButton.addEventListener('click'");
	const listSessionsIndex = page.indexOf(
		"type: 'list_sessions'",
		historyHandlerIndex,
	);
	t.true(historyHandlerIndex >= 0 && listSessionsIndex > historyHandlerIndex);
	t.true(page.includes('applySidebarCollapsed(false)'));
});

test('web mode settings button shows real current state instead of a canned notice', t => {
	const page = renderWebModePage();

	t.true(
		page.includes(
			"document.documentElement.dataset.theme === 'light' ? 'Light' : 'Dark'",
		),
	);
	t.true(
		page.includes(
			"appShell.classList.contains('sidebar-collapsed')\n\t\t\t\t\t? 'collapsed'\n\t\t\t\t\t: 'expanded'",
		),
	);
});
