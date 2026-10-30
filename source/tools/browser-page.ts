import {createRequire} from 'node:module';
import {isIP} from 'node:net';
import type {Browser, Page} from 'playwright-core';
import {hostResolver, isBlockedFetchHost} from '@/tools/fetch-url-guard';
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

function isLoopbackHost(host: string): boolean {
	return (
		host === 'localhost' ||
		host.endsWith('.localhost') ||
		host === '::1' ||
		/^127(\.\d{1,3}){3}$/.test(host)
	);
}

function normalizeHost(hostname: string): string {
	return hostname
		.toLowerCase()
		.replace(/\.$/, '')
		.replace(/^\[|\]$/g, '');
}

/**
 * fetch_url's private/metadata block, minus loopback: checking a local dev
 * server is what this tool is for. Judges the URL text only; see
 * `isBlockedBrowserUrlResolved` for names that point somewhere private.
 */
function isBlockedBrowserUrl(url: string): boolean {
	let hostname: string;
	try {
		hostname = new URL(url).hostname;
	} catch {
		return false;
	}
	return (
		!isLoopbackHost(normalizeHost(hostname)) && isBlockedFetchHost(hostname)
	);
}

const RESOLVE_CACHE_MS = 10_000;
const resolvedVerdicts = new Map<
	string,
	{at: number; blocked: Promise<string | null>}
>();

/**
 * The address a host resolves to that the browser must not reach, or null.
 * Loopback answers are allowed, as for loopback names; a host that fails to
 * resolve is treated as blocked, since the check cannot vouch for it.
 * Verdicts are cached briefly so a page's many subresources from one host
 * cost one lookup.
 */
function blockedResolvedAddress(host: string): Promise<string | null> {
	const cached = resolvedVerdicts.get(host);
	if (cached && Date.now() - cached.at < RESOLVE_CACHE_MS) {
		return cached.blocked;
	}
	const blocked = hostResolver.resolve(host).then(
		addresses =>
			addresses.find(
				address =>
					!isLoopbackHost(normalizeHost(address)) &&
					isBlockedFetchHost(address),
			) ?? null,
		() => `${host} (could not be resolved)`,
	);
	resolvedVerdicts.set(host, {at: Date.now(), blocked});
	return blocked;
}

/**
 * `isBlockedBrowserUrl`, plus a DNS lookup of http(s) hosts: a public record
 * such as `169.254.169.254.nip.io` reaches the metadata service without
 * naming it. Returns the hostname (and offending address) to report, or null.
 *
 * Same known gap as fetch_url: the address is checked, not pinned, so DNS
 * rebinding between this lookup and Chromium's is not closed.
 */
async function blockedBrowserTarget(url: string): Promise<string | null> {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return null;
	}
	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
		return null;
	}
	if (isBlockedBrowserUrl(url)) {
		return parsed.hostname;
	}
	const host = normalizeHost(parsed.hostname);
	if (isIP(host) || isLoopbackHost(host)) {
		return null;
	}
	const address = await blockedResolvedAddress(host);
	return address === null ? null : `${host} resolves to ${address}`;
}

export function resetBrowserResolveCacheForTests(): void {
	resolvedVerdicts.clear();
}

/**
 * The command that installs the Chromium this playwright-core expects. It
 * names `playwright-core` (the package nanocoder ships) rather than
 * `playwright`, and pins its version: an unpinned npx fetches the latest
 * release, whose browser revision may not be the one this copy launches.
 */
export function chromiumInstallHint(): string {
	let pkg = 'playwright-core';
	try {
		const {version} = createRequire(import.meta.url)(
			'playwright-core/package.json',
		) as {version?: string};
		if (version) pkg = `playwright-core@${version}`;
	} catch {
		// Not installed: the unpinned name is the best available hint.
	}
	return `npx ${pkg} install chromium (on Linux, add --with-deps to also install its system libraries)`;
}

async function loadPlaywright(): Promise<PlaywrightLike> {
	try {
		return (await import('playwright-core')) as PlaywrightLike;
	} catch {
		throw new Error(
			`browser needs the playwright-core package, which ships with nanocoder. If Chromium is missing, run: ${chromiumInstallHint()}`,
		);
	}
}

/**
 * playwright-core's own missing-browser error tells the user to run
 * `npx playwright install`, which installs the separate `playwright` package
 * at whatever version is latest. Replace it with the matching command.
 */
async function launchChromium(pw: PlaywrightLike): Promise<Browser> {
	try {
		return await pw.chromium.launch({headless: true});
	} catch (error) {
		if (
			error instanceof Error &&
			error.message.includes("Executable doesn't exist")
		) {
			throw new Error(
				`browser could not find Chromium. Install it with: ${chromiumInstallHint()}`,
			);
		}
		throw error;
	}
}

async function launch(
	load: () => Promise<PlaywrightLike>,
): Promise<BrowserPage> {
	const browser = await launchChromium(await load());
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
	await page.route('**/*', async route =>
		(await blockedBrowserTarget(route.request().url()))
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
	let blocked: string | null = null;
	for (const frame of page.frames()) {
		blocked = await blockedBrowserTarget(frame.url());
		if (blocked) break;
	}
	if (!blocked) {
		return;
	}
	await page.goto('about:blank');
	throw new Error(
		`browser blocked a redirect to a private or internal address: ${blocked}`,
	);
}

async function act(
	page: BrowserPage,
	args: BrowserActionArgs,
): Promise<BrowserActionResult> {
	switch (args.action) {
		case 'navigate': {
			const url = requireHttpUrl(args.url);
			const blocked = await blockedBrowserTarget(url);
			if (blocked) {
				throw new Error(
					`navigate cannot open a private or internal address: ${blocked}`,
				);
			}
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
