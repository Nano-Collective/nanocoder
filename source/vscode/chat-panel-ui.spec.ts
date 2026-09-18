import test from 'ava';
import {createPanel} from './chat-panel-harness';

console.log('\nchat-panel-ui.spec.ts');

test('user message bubble has max-w-[90%] class', t => {
	const panel = createPanel();
	panel.userMessage('hello');

	const userMessageWrapper = panel.container.children[0];
	t.true(userMessageWrapper.className.includes('max-w-[90%]'), 'user message bubble should have max-w-[90%] class');
});

test('artifact bar appears on artifactsUpdated, close hides it, and user preference is sticky', t => {
	const panel = createPanel();

	// Send an artifactsUpdated message (the real extension host type, with `kind`).
	panel.post({
		type: 'artifactsUpdated',
		artifacts: [
			{ kind: 'implementation_plan', path: '/plan.md' },
		],
	});

	const artifactBar = panel.byId('artifact-bar');
	t.truthy(artifactBar, 'artifact-bar should exist');
	// renderArtifacts shows the bar when there are matching artifacts.
	t.false(artifactBar.classList.contains('hidden'), 'artifact bar should be visible after receiving artifacts');
	t.true(artifactBar.classList.contains('flex'), 'artifact bar should have flex class');

	// Close the bar via the close button.
	const closeBtn = panel.byId('artifact-close');
	t.truthy(closeBtn, 'close button should exist');
	closeBtn.click();

	t.true(artifactBar.classList.contains('hidden'), 'artifact bar should be hidden after clicking close');

	// A second update with the same count should keep the bar hidden (user preference sticky).
	panel.post({
		type: 'artifactsUpdated',
		artifacts: [
			{ kind: 'implementation_plan', path: '/plan.md' },
		],
	});

	t.true(artifactBar.classList.contains('hidden'), 'artifact bar should remain hidden when count did not increase');

	// A third update with MORE artifacts should re-open the bar (resets user preference).
	panel.post({
		type: 'artifactsUpdated',
		artifacts: [
			{ kind: 'implementation_plan', path: '/plan.md' },
			{ kind: 'task', path: '/task.md' },
		],
	});

	t.false(artifactBar.classList.contains('hidden'), 'artifact bar should reopen when new artifacts arrive');
});

test('userHasScrolledUp prevents auto-scroll during stream but forced scroll works', t => {
	const panel = createPanel();

	let scrollPos = 0;
	Object.defineProperty(panel.container, 'scrollHeight', { value: 1000, writable: true });
	Object.defineProperty(panel.container, 'clientHeight', { value: 500, writable: true });
	Object.defineProperty(panel.container, 'scrollTop', {
		get: () => scrollPos,
		set: (val) => { scrollPos = val; },
	});

	// Scroll to top (user scrolled up).
	scrollPos = 0;
	panel.container.dispatch('scroll');

	// Streaming text should NOT scroll to bottom because the user scrolled up.
	panel.text('chunk');
	t.is(scrollPos, 0, 'should not auto-scroll if user scrolled up');

	// But finishing the turn forces a scroll.
	panel.finish();
	t.is(scrollPos, 1000, 'should force scroll to bottom when finished');

	// After a forced scroll, subsequent chunks should auto-scroll again
	// (the guard must have been cleared by the force).
	panel.text('chunk2');
	t.is(scrollPos, 1000, 'subsequent chunk should auto-scroll after a forced scroll cleared the guard');
});

test('duration/outcome replay via _meta renders correct title on the work summary', t => {
	const panel = createPanel();
	panel.userMessage('hello');

	// A thought chunk creates and attaches a WorkSummary.
	panel.thought('Thinking…');

	const summaries = panel.summaries();
	t.is(summaries.length, 1, 'a work summary should exist after a thought');

	// Replay a message chunk that carries duration + outcome in _meta (as the
	// history replay path would produce from a persisted cancelled session).
	panel.update({
		sessionUpdate: 'agent_message_chunk',
		content: { type: 'text', text: 'Cancelled.' },
		_meta: {
			'nanocoder/durationMs': 42000,
			'nanocoder/outcome': 'cancelled',
		},
	});

	// Trigger finishCurrentWorkSummary via sessionLoaded (mimics history load).
	panel.post({ type: 'sessionLoaded' });

	// The summary title should reflect the overridden duration and outcome.
	// finish() uses elapsedMs() → _overrideDuration → 42000ms → "42s"
	// and outcome 'cancelled' → "Stopped after 42s".
	const summaryEl = summaries[0];
	const header = summaryEl.querySelector('button');
	const titleSpan = header?.children?.[0];
	t.truthy(titleSpan, 'title span should exist inside the header');
	t.regex(titleSpan.textContent, /Stopped after 42s/, 'summary should show "Stopped after 42s"');
});
