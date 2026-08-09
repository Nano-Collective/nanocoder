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
			"'Provider and model stay in the terminal runtime. During a browser turn, approvals and questions are answered here.'",
		),
	);
});
