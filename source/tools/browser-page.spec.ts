import test from 'ava';
import {
	type BrowserPage,
	getBrowserPage,
	resetBrowserPageForTests,
	runBrowserAction,
} from './browser-page.js';

function fakePage(overrides: Partial<BrowserPage> = {}): BrowserPage {
	return {
		goto: async () => null,
		click: async () => undefined,
		fill: async () => undefined,
		screenshot: async () => Buffer.from('jpeg-bytes'),
		title: async () => 'Home',
		url: () => 'http://127.0.0.1:3000/',
		...overrides,
	};
}

test('navigate rejects non-http URLs', async t => {
	const page = fakePage();
	await t.throwsAsync(
		runBrowserAction(page, {action: 'navigate', url: 'file:///etc/passwd'}),
		{message: 'navigate only accepts http and https URLs'},
	);
	await t.throwsAsync(
		runBrowserAction(page, {action: 'navigate', url: 'localhost:3000'}),
		{message: 'navigate only accepts http and https URLs'},
	);
	await t.throwsAsync(runBrowserAction(page, {action: 'navigate'}), {
		message: 'navigate requires url',
	});
});

test('navigate allows localhost and reports the landed URL', async t => {
	let opened = '';
	const page = fakePage({
		goto: async url => {
			opened = url;
			return null;
		},
	});
	const result = await runBrowserAction(page, {
		action: 'navigate',
		url: 'http://localhost:3000/app',
	});
	t.is(opened, 'http://localhost:3000/app');
	t.is(result.text, 'Navigated to http://127.0.0.1:3000/');
	t.is(result.image, undefined);
});

test('click and type require a selector', async t => {
	const page = fakePage();
	await t.throwsAsync(runBrowserAction(page, {action: 'click'}), {
		message: 'click requires selector',
	});
	await t.throwsAsync(runBrowserAction(page, {action: 'type', text: 'hi'}), {
		message: 'type requires selector',
	});
});

test('type sets the field value', async t => {
	let filled: {selector: string; text: string} | undefined;
	const page = fakePage({
		fill: async (selector, text) => {
			filled = {selector, text};
		},
	});
	const result = await runBrowserAction(page, {
		action: 'type',
		selector: '#email',
		text: 'a@b.co',
	});
	t.deepEqual(filled, {selector: '#email', text: 'a@b.co'});
	t.is(result.text, 'Set #email');
});

test('screenshot returns jpeg bytes separate from the caption', async t => {
	const page = fakePage();
	const result = await runBrowserAction(page, {action: 'screenshot'});
	t.is(result.text, 'Screenshot of http://127.0.0.1:3000/ (Home)');
	t.false(result.text.includes('jpeg-bytes'));
	t.is(result.image?.mediaType, 'image/jpeg');
	t.is(result.image?.data, Buffer.from('jpeg-bytes').toString('base64'));
});

test('unknown action is an error', async t => {
	await t.throwsAsync(runBrowserAction(fakePage(), {action: 'eval'}), {
		message: 'browser action must be navigate, click, type, or screenshot',
	});
});

test('a failed browser launch can be retried', async t => {
	resetBrowserPageForTests();
	let calls = 0;
	const load = async () => {
		calls += 1;
		throw new Error('no chromium');
	};
	await t.throwsAsync(getBrowserPage(load), {message: 'no chromium'});
	await t.throwsAsync(getBrowserPage(load), {message: 'no chromium'});
	t.is(calls, 2);
	resetBrowserPageForTests();
});
