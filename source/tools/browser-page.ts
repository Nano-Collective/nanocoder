import type {Browser, Page} from 'playwright-core';
import {isBlockedFetchHost} from '@/tools/fetch-url-guard';
import {getShutdownManager} from '@/utils/shutdown';

export type BrowserPage = Pick<
	Page,
	'goto' | 'click' | 'fill' | 'screenshot' | 'title' | 'url' | 'frames'
>;

export interface BrowserActionArgs {
	action?: string;
	url?: string;
	selector?: string;
	text?: string;
}

export interface BrowserActionImage {
	data: string;
	mediaType: 'image/jpeg';
}

export type BrowserActionResult = {
	text: string;
	image?: BrowserActionImage;
};

const VIEWPORT = {width: 1280, height: 720};

let opening: Promise<BrowserPage> | null = null;

export function resetBrowserPageForTests(): void {
	opening = null;
}

type PlaywrightLike = {
	chromium: {
		launch(options: {headless: boolean}): Promise<Browser>;
	};
};

/**
 * fetch_url's private/metadata block, minus loopback: checking a local dev
 * server is what this tool is for.
 */
function isBlockedBrowserUrl(url: string): boolean {
	let hostname: string;
	try {
		hostname = new URL(url).hostname;
	} catch {
		return false;
	}
	const host = hostname
		.toLowerCase()
		.replace(/\.$/, '')
		.replace(/^\[|\]$/g, '');
	const loopback =
		host === 'localhost' ||
		host.endsWith('.localhost') ||
		host === '::1' ||
		/^127(\.\d{1,3}){3}$/.test(host);
	return !loopback && isBlockedFetchHost(hostname);
}

async function loadPlaywright(): Promise<PlaywrightLike> {
	try {
		return (await import('playwright-core')) as PlaywrightLike;
	} catch {
		throw new Error(
			'browser needs the playwright-core package, which ships with nanocoder. If Chromium is missing, run: npx playwright install chromium',
		);
	}
}

async function launch(
	load: () => Promise<PlaywrightLike>,
): Promise<BrowserPage> {
	const pw = await load();
	const browser = await pw.chromium.launch({headless: true});
	// A crashed or closed browser launches fresh on the next call.
	browser.on('disconnected', () => {
		opening = null;
	});
	getShutdownManager().register({
		name: 'browser-page',
		priority: 15,
		handler: async () => {
			opening = null;
			await browser.close();
		},
	});
	const page = await browser.newPage({viewport: VIEWPORT});
	page.on('crash', () => {
		void browser.close().catch(() => undefined);
	});
	// Covers subresources, iframes, fetch, and link clicks. Redirect hops skip
	// routing, so runBrowserAction also checks where each frame landed.
	await page.route('**/*', route =>
		isBlockedBrowserUrl(route.request().url())
			? route.abort('blockedbyclient')
			: route.continue(),
	);
	return page;
}

export async function getBrowserPage(
	load: () => Promise<PlaywrightLike> = loadPlaywright,
): Promise<BrowserPage> {
	if (!opening) {
		opening = launch(load).catch(error => {
			opening = null;
			throw error;
		});
	}
	return opening;
}

export async function runBrowserAction(
	page: BrowserPage,
	args: BrowserActionArgs,
): Promise<BrowserActionResult> {
	await leaveBlockedFrames(page);
	const result = await act(page, args);
	await leaveBlockedFrames(page);
	return result;
}

/**
 * A redirect hop is not routed, so a public page can still land a frame on a
 * private address. The request has gone out by then; drop the page before the
 * model can read or screenshot it.
 */
async function leaveBlockedFrames(page: BrowserPage): Promise<void> {
	const blocked = page
		.frames()
		.map(frame => frame.url())
		.find(isBlockedBrowserUrl);
	if (!blocked) {
		return;
	}
	await page.goto('about:blank');
	throw new Error(
		`browser blocked a redirect to a private or internal address: ${new URL(blocked).hostname}`,
	);
}

async function act(
	page: BrowserPage,
	args: BrowserActionArgs,
): Promise<BrowserActionResult> {
	switch (args.action) {
		case 'navigate': {
			const url = requireHttpUrl(args.url);
			await page.goto(url, {waitUntil: 'domcontentloaded'});
			return {text: `Navigated to ${page.url()}`};
		}
		case 'click': {
			const selector = required(args.selector, 'click requires selector');
			await page.click(selector);
			return {text: `Clicked ${selector}`};
		}
		case 'type': {
			const selector = required(args.selector, 'type requires selector');
			await page.fill(selector, args.text ?? '');
			return {text: `Set ${selector}`};
		}
		case 'screenshot': {
			const bytes = await page.screenshot({type: 'jpeg', quality: 60});
			const title = await page.title();
			return {
				text: `Screenshot of ${page.url()}${title ? ` (${title})` : ''}`,
				image: {
					data: Buffer.from(bytes).toString('base64'),
					mediaType: 'image/jpeg',
				},
			};
		}
		default:
			throw new Error(
				'browser action must be navigate, click, type, or screenshot',
			);
	}
}

function required(value: string | undefined, message: string): string {
	if (!value) {
		throw new Error(message);
	}
	return value;
}

function requireHttpUrl(url: string | undefined): string {
	if (!url) {
		throw new Error('navigate requires url');
	}
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		throw new Error('navigate requires an absolute http or https URL');
	}
	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
		throw new Error('navigate only accepts http and https URLs');
	}
	if (isBlockedBrowserUrl(url)) {
		throw new Error(
			`navigate cannot open a private or internal address: ${parsed.hostname}`,
		);
	}
	return url;
}
