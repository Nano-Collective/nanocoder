import test from 'ava';
import {
	type BrowserPage,
	chromiumInstallHint,
	getBrowserPage,
	resetBrowserPageForTests,
	resetBrowserResolveCacheForTests,
	runBrowserAction,
} from './browser-page.js';
import {hostResolver} from './fetch-url-guard.js';

// Specs never reach real DNS: public names resolve publicly, rebinding-style
// names resolve to what they spell, and anything else fails to resolve.
const DNS: Record<string, string[]> = {
	'example.com': ['93.184.216.34'],
	'169.254.169.254.nip.io': ['169.254.169.254'],
	'internal.example.com': ['93.184.216.34', '10.0.0.7'],
	'localtest.me': ['127.0.0.1'],
};
const originalResolve = hostResolver.resolve;
const lookups: string[] = [];
test.before(() => {
	hostResolver.resolve = async host => {
		lookups.push(host);
		const addresses = DNS[host];
		if (!addresses) throw new Error(`ENOTFOUND ${host}`);
		return addresses;
	};
});
test.after.always(() => {
	hostResolver.resolve = originalResolve;
});
test.beforeEach(() => {
	resetBrowserResolveCacheForTests();
});

function fakePage(overrides: Partial<BrowserPage> = {}): BrowserPage {
	return {
		goto: async () => null,
		click: async () => undefined,
		fill: async () => undefined,
		screenshot: async () => Buffer.from('jpeg-bytes'),
		title: async () => 'Home',
		url: () => 'http://127.0.0.1:3000/',
		frames: () => [],
		...overrides,
	};
}

function framesAt(...urls: string[]): BrowserPage['frames'] {
	return () =>
		urls.map(url => ({url: () => url})) as unknown as ReturnType<
			BrowserPage['frames']
		>;
}

test('navigate blocks private and metadata addresses but not loopback', async t => {
	for (const url of [
		'http://169.254.169.254/latest/meta-data',
		'http://10.0.0.5/',
		'http://192.168.1.1/',
		'http://metadata.google.internal/',
		'http://[fd00::1]/',
	]) {
		await t.throwsAsync(runBrowserAction(fakePage(), {action: 'navigate', url}), {
			message: /navigate cannot open a private or internal address/,
		});
	}
	for (const url of [
		'http://localhost:3000/',
		'http://127.0.0.1:5173/',
		'http://[::1]:8080/',
		'http://app.localhost/',
	]) {
		await t.notThrowsAsync(
			runBrowserAction(fakePage(), {action: 'navigate', url}),
		);
	}
});

test('a redirect that lands a frame on a private address is dropped', async t => {
	const opened: string[] = [];
	let landed = false;
	const page = fakePage({
		goto: async url => {
			opened.push(url);
			landed = url !== 'about:blank';
			return null;
		},
		frames: () =>
			framesAt(landed ? 'http://169.254.169.254/latest' : 'about:blank')(),
	});
	await t.throwsAsync(
		runBrowserAction(page, {action: 'navigate', url: 'https://example.com/r'}),
		{
			message:
				'browser blocked a redirect to a private or internal address: 169.254.169.254',
		},
	);
	t.deepEqual(opened, ['https://example.com/r', 'about:blank']);
});

function fakePlaywright() {
	const fake = {
		launches: 0,
		closes: 0,
		route: undefined as ((route: unknown) => Promise<void>) | undefined,
		browserEvents: new Map<string, () => void>(),
		pageEvents: new Map<string, () => void>(),
		load: async () => ({
			chromium: {
				launch: async () => {
					fake.launches += 1;
					return {
						on: (event: string, fn: () => void) =>
							fake.browserEvents.set(event, fn),
						close: async () => {
							fake.closes += 1;
						},
						newPage: async () => ({
							on: (event: string, fn: () => void) =>
								fake.pageEvents.set(event, fn),
							route: async (
								_pattern: string,
								fn: (route: unknown) => Promise<void>,
							) => {
								fake.route = fn;
							},
						}),
					} as never;
				},
			},
		}),
	};
	return fake;
}

test('a crashed browser is relaunched on the next call', async t => {
	resetBrowserPageForTests();
	const fake = fakePlaywright();
	await getBrowserPage(fake.load);
	await getBrowserPage(fake.load);
	t.is(fake.launches, 1);

	fake.pageEvents.get('crash')?.();
	t.is(fake.closes, 1);
	fake.browserEvents.get('disconnected')?.();
	await getBrowserPage(fake.load);
	t.is(fake.launches, 2);
	resetBrowserPageForTests();
});

test('the launched page aborts requests to private addresses', async t => {
	resetBrowserPageForTests();
	const fake = fakePlaywright();
	await getBrowserPage(fake.load);
	const handler = fake.route;
	const outcome = async (url: string) => {
		let result = '';
		await handler?.({
			request: () => ({url: () => url}),
			abort: async () => {
				result = 'abort';
			},
			continue: async () => {
				result = 'continue';
			},
		});
		return result;
	};
	t.is(await outcome('http://169.254.169.254/'), 'abort');
	t.is(await outcome('http://10.1.1.1/iframe'), 'abort');
	t.is(await outcome('http://localhost:3000/app.js'), 'continue');
	t.is(await outcome('https://example.com/'), 'continue');
	// Names are resolved: a public record pointing at metadata or a private
	// address is blocked, one pointing at loopback is allowed.
	t.is(await outcome('http://169.254.169.254.nip.io/latest/meta-data'), 'abort');
	t.is(await outcome('https://internal.example.com/'), 'abort');
	t.is(await outcome('http://localtest.me:3000/'), 'continue');
	t.is(await outcome('http://does-not-resolve.invalid/'), 'abort');
	t.is(await outcome('data:text/plain,hi'), 'continue');
	resetBrowserPageForTests();
});

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

test.serial('navigate resolves the host and blocks names that point at private addresses', async t => {
	const opened: string[] = [];
	const page = fakePage({
		goto: async url => {
			opened.push(url);
			return null;
		},
	});
	await t.throwsAsync(
		runBrowserAction(page, {
			action: 'navigate',
			url: 'http://169.254.169.254.nip.io/latest/meta-data',
		}),
		{
			message:
				'navigate cannot open a private or internal address: 169.254.169.254.nip.io resolves to 169.254.169.254',
		},
	);
	t.deepEqual(opened, []);
	await t.notThrowsAsync(
		runBrowserAction(page, {action: 'navigate', url: 'http://localtest.me:3000/'}),
	);
});

test.serial('a redirect that lands a frame on a name resolving to metadata is dropped', async t => {
	let landed = false;
	const page = fakePage({
		goto: async url => {
			landed = url !== 'about:blank';
			return null;
		},
		frames: () =>
			framesAt(landed ? 'http://169.254.169.254.nip.io/latest' : 'about:blank')(),
	});
	await t.throwsAsync(
		runBrowserAction(page, {action: 'navigate', url: 'https://example.com/r'}),
		{message: /redirect to a private or internal address: 169\.254\.169\.254\.nip\.io resolves to 169\.254\.169\.254/},
	);
});

test.serial('subresources from one host share a lookup', async t => {
	resetBrowserPageForTests();
	const fake = fakePlaywright();
	await getBrowserPage(fake.load);
	const before = lookups.filter(h => h === 'example.com').length;
	for (const path of ['a.js', 'b.css', 'c.png']) {
		await fake.route?.({
			request: () => ({url: () => `https://example.com/${path}`}),
			abort: async () => undefined,
			continue: async () => undefined,
		});
	}
	t.is(lookups.filter(h => h === 'example.com').length - before, 1);
	resetBrowserPageForTests();
});

test('a missing Chromium points at the playwright-core install command', async t => {
	resetBrowserPageForTests();
	const load = async () => ({
		chromium: {
			launch: async () => {
				throw new Error(
					"browserType.launch: Executable doesn't exist at /x/chrome\nPlease run: npx playwright install",
				);
			},
		},
	});
	const error = await t.throwsAsync(getBrowserPage(load as never));
	t.regex(error?.message ?? '', /npx playwright-core@\d+\.\d+\.\d+ install chromium/);
	t.regex(error?.message ?? '', /--with-deps/);
	t.notRegex(error?.message ?? '', /npx playwright install/);
	resetBrowserPageForTests();
});

test('the install hint pins the bundled playwright-core version', t => {
	t.regex(chromiumInstallHint(), /^npx playwright-core@\d+\.\d+\.\d+ install chromium/);
});
