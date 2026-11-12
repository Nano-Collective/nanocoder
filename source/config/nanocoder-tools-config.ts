import {getAppConfig} from '@/config/index';

/**
 * Check if a nanocoder tool is configured to always be allowed.
 * @param toolName - The name of the tool to check
 * @returns true if the tool is in the top-level alwaysAllow list
 */
export function isNanocoderToolAlwaysAllowed(toolName: string): boolean {
	const config = getAppConfig();
	const topLevelAlwaysAllow = config.alwaysAllow;
	return (
		Array.isArray(topLevelAlwaysAllow) && topLevelAlwaysAllow.includes(toolName)
	);
}

export const WEB_SEARCH_ENGINES = ['brave', 'searxng'] as const;
export type WebSearchEngine = (typeof WEB_SEARCH_ENGINES)[number];

export interface WebSearchSettings {
	engine: WebSearchEngine;
	apiKey?: string;
	baseUrl?: string;
	allowPrivateNetwork: boolean;
}

export type WebSearchStatus =
	| {available: true; settings: WebSearchSettings}
	| {available: false; reason: string};

/**
 * Read nanocoder.nanocoderTools.webSearch and say whether web_search can run.
 * `engine` defaults to `brave`, which needs `apiKey`; `searxng` needs
 * `baseUrl`. When it is unavailable the tool is not registered, and `reason`
 * says what is missing (shown by /doctor).
 */
export function getWebSearchStatus(): WebSearchStatus {
	const config = getAppConfig().nanocoderTools?.webSearch;
	const engine = config?.engine ?? 'brave';
	if (!WEB_SEARCH_ENGINES.includes(engine)) {
		return {
			available: false,
			reason: `unknown engine "${String(engine)}" (use ${WEB_SEARCH_ENGINES.join(' or ')})`,
		};
	}

	const settings: WebSearchSettings = {
		engine,
		apiKey: config?.apiKey?.trim() || undefined,
		baseUrl: config?.baseUrl?.trim() || undefined,
		allowPrivateNetwork: config?.allowPrivateNetwork === true,
	};
	if (engine === 'brave' && !settings.apiKey) {
		return {available: false, reason: 'no Brave Search API key'};
	}
	if (engine === 'searxng' && !settings.baseUrl) {
		return {available: false, reason: 'no SearXNG base URL'};
	}
	return {available: true, settings};
}

/** The configured engine for the settings list, or `not set`. */
export function describeWebSearchSetting(): string {
	const status = getWebSearchStatus();
	return status.available
		? describeWebSearchEngine(status.settings)
		: 'not set';
}

/** The engine's name as shown to the user. */
export function describeWebSearchEngine(settings: WebSearchSettings): string {
	if (settings.engine === 'searxng') {
		let host = settings.baseUrl ?? '';
		try {
			host = new URL(host).host;
		} catch {
			// Shown as configured; the search itself reports the bad URL.
		}
		return `SearXNG (${host})`;
	}
	return 'Brave Search API';
}
