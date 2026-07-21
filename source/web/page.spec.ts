import test from 'ava';
import {nanocoderLogoSvg, renderWebModePage} from './page.js';

test('web mode page renders the Nanocoder logo asset markup', t => {
	t.true(nanocoderLogoSvg.includes('aria-label="Nanocoder"'));
	t.true(nanocoderLogoSvg.includes('viewBox="0 0 64 64"'));
	t.true(nanocoderLogoSvg.includes('#7dcfff'));
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
