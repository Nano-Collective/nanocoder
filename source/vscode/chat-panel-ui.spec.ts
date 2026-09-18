import test from 'ava';
import {createPanel} from './chat-panel-harness';

console.log('\nchat-panel-ui.spec.ts');

test('user message bubble has max-w-[90%] class', t => {
	const panel = createPanel();
	panel.userMessage('hello');
	
	const userMessageWrapper = panel.container.children[0];
	t.true(userMessageWrapper.className.includes('max-w-[90%]'), 'user message bubble should have max-w-[90%] class');
});

test('artifact container can be closed and preserves state', t => {
	const panel = createPanel();
	
	// Create an artifact to trigger the container
	panel.post({
		type: 'artifactsUpdate',
		artifacts: [
			{ id: '1', name: 'plan.md', path: '/plan.md', status: 'created', summary: 'test plan' }
		]
	});
	
	const artifactsContainer = panel.byId('artifact-bar');
	t.not(artifactsContainer, null, 'artifacts container should be created');
	
	const toggleBtn = panel.byId('artifact-toggle');
	t.not(toggleBtn, null, 'toggle button should exist');
	
	// Close the container
	const closeBtn = panel.byId('artifact-close');
	closeBtn?.click();
	t.true(artifactsContainer?.classList.contains('hidden'), 'artifacts container should be hidden after clicking close');
	
	// Send another update to simulate a new artifact
	panel.post({
		type: 'artifactsUpdate',
		artifacts: [
			{ id: '1', name: 'plan.md', path: '/plan.md', status: 'created', summary: 'test plan' },
			{ id: '2', name: 'plan2.md', path: '/plan2.md', status: 'created', summary: 'test plan 2' }
		]
	});
	
	t.true(artifactsContainer?.classList.contains('hidden'), 'artifacts container should remain hidden if user closed it');
});

test('userHasScrolledUp prevents auto-scroll during stream but forced scroll works', t => {
	const panel = createPanel();
	
	let scrollPos = 0;
	// Mock scrollHeight and scrollTop
	Object.defineProperty(panel.container, 'scrollHeight', { value: 1000, writable: true });
	Object.defineProperty(panel.container, 'clientHeight', { value: 500, writable: true });
	Object.defineProperty(panel.container, 'scrollTop', {
		get: () => scrollPos,
		set: (val) => { scrollPos = val; }
	});
	
	// Scroll to top (user scrolled up)
	scrollPos = 0;
	panel.container.dispatch('scroll');
	
	// Append message, it should NOT scroll to bottom because user scrolled up
	panel.text('chunk');
	t.is(scrollPos, 0, 'should not auto-scroll if user scrolled up');
	
	// But finishing the turn forces a scroll
	panel.finish();
	t.is(scrollPos, 1000, 'should force scroll to bottom when finished');
});
