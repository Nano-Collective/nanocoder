import test from 'ava';
import {createPanel, type StubElement} from './chat-panel-harness';

// Marks every string that went through the sanitizer, so a test can tell a
// sanitized render from raw marked output.
const tagSanitized = (html: string) => `clean:${html}`;

const markdownBodies = (panel: ReturnType<typeof createPanel>) =>
	panel.container.querySelectorAll('.markdown-body') as StubElement[];

const agentBodies = (panel: ReturnType<typeof createPanel>) =>
	panel.container.querySelectorAll('.agent-markdown') as StubElement[];

test('sanitizes a replayed user message before it reaches innerHTML', t => {
	const panel = createPanel({marked: true, sanitize: tagSanitized});

	panel.userMessage('<img src="https://example.com/pixel.png">');

	const [body] = markdownBodies(panel);
	t.is(body.innerHTML, 'clean:<md><img src="https://example.com/pixel.png"></md>');
});

test('sanitizes the first agent chunk and every throttled re-render', t => {
	const panel = createPanel({marked: true, sanitize: tagSanitized});

	panel.text('<b>one</b>');
	const [body] = agentBodies(panel);
	t.is(body.innerHTML, 'clean:<md><b>one</b></md>');

	panel.text(' two');
	panel.runTimers();
	t.is(body.innerHTML, 'clean:<md><b>one</b> two</md>');
});

test('sanitizes the pending render flushed at a turn boundary', t => {
	const panel = createPanel({marked: true, sanitize: tagSanitized});

	panel.text('first');
	panel.text(' <style>body{display:none}</style>');
	// The second chunk is still waiting on the 50ms timer; a new user message
	// ends the text block and flushes it.
	panel.userMessage('next');

	const [body] = agentBodies(panel);
	t.is(body.innerHTML, 'clean:<md>first <style>body{display:none}</style></md>');
});

test('sanitizes thoughts', t => {
	const panel = createPanel({marked: true, sanitize: tagSanitized});

	panel.thought('<div class="fixed inset-0">thinking</div>');
	panel.runTimers();

	const thought = panel.thoughts()[0];
	t.is(
		thought.children[1].innerHTML,
		'clean:<md><div class="fixed inset-0">thinking</div></md>',
	);
});

test('falls back to plain text when DOMPurify did not load', t => {
	const panel = createPanel({marked: true, sanitize: false});

	panel.userMessage('<img src=x onerror=alert(1)>');
	panel.text('<b>agent</b>');
	panel.thought('<i>thought</i>');
	panel.runTimers();

	const [userBody] = markdownBodies(panel);
	t.is(userBody.innerHTML, '');
	t.is(userBody.textContent, '<img src=x onerror=alert(1)>');

	const [agentBody] = agentBodies(panel);
	t.is(agentBody.innerHTML, '');
	t.is(agentBody.textContent, '<b>agent</b>');

	const thought = panel.thoughts()[0];
	t.is(thought.children[1].innerHTML, '');
	t.is(thought.children[1].textContent, '<i>thought</i>');
});
