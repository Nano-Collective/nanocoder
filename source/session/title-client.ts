import {createLLMClient} from '@/client-factory';
import {getAppConfig} from '@/config/index';
import type {LLMClient} from '@/types/core';
import {getLogger} from '@/utils/logging';

/** Built at most once per process, and only when an override is configured. */
let cachedClient: LLMClient | null = null;
let warnedAboutFailure = false;

/** Test seam. Production code never calls this. */
export function resetTitleClientCache(): void {
	cachedClient = null;
	warnedAboutFailure = false;
}

/**
 * Which client generates the title. Default is the session's own, so nothing
 * extra is constructed and no new auth is needed. A user who wants to spend
 * less can name a model in config; we never pick one for them.
 */
export async function resolveTitleClient(
	sessionClient: LLMClient,
): Promise<LLMClient> {
	const sessions = getAppConfig().sessions;
	const model = sessions?.titleModel;
	const provider = sessions?.titleProvider;

	if (!model && !provider) return sessionClient;
	if (cachedClient) return cachedClient;

	try {
		const {client} = await createLLMClient(provider, model);
		cachedClient = client;
		return client;
	} catch (error) {
		// Fall back rather than going quiet, so a typo in config does not look
		// like a broken feature. Warn once per process, not once per session.
		if (!warnedAboutFailure) {
			warnedAboutFailure = true;
			const named = [provider, model].filter(Boolean).join('/');
			getLogger().warn(
				`Session title model "${named}" could not be used (${error}). ` +
					'Falling back to the session model.',
			);
		}
		return sessionClient;
	}
}
