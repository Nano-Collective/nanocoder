import type {Browser, Page} from 'playwright-core';
import {getShutdownManager} from '@/utils/shutdown';

export type BrowserPage = Pick<
	Page,
	'goto' | 'click' | 'fill' | 'screenshot' | 'title' | 'url'
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
	getShutdownManager().register({
		name: 'browser-page',
		priority: 15,
		handler: async () => {
			opening = null;
			await browser.close();
		},
	});
	return browser.newPage({viewport: VIEWPORT});
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
	return url;
}
