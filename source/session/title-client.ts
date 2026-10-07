import {createLLMClient} from '@/client-factory';
import {getAppConfig, getConfigGeneration} from '@/config/index';
import type {LLMClient} from '@/types/core';
import {getLogger} from '@/utils/logging';

/** Built at most once per config, and only when an override is configured. */
let cachedClient: LLMClient | null = null;
/**
 * The config generation plus the provider/model the cached client was built
 * from. The names alone are not enough: editing a provider's baseURL or apiKey
 * leaves `titleProvider` reading the same string while it no longer points at
 * the same endpoint, so the generation is what makes any config edit rebuild.
 */
let cachedKey: string | null = null;
let warnedAboutFailure = false;

/** Test seam. Production code never calls this. */
export function resetTitleClientCache(): void {
	cachedClient = null;
	cachedKey = null;
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

	const key = `${getConfigGeneration()}\u0000${provider ?? ''}\u0000${model ?? ''}`;
	if (cachedClient && cachedKey === key) return cachedClient;

	try {
		const {client} = await createLLMClient(provider, model);
		cachedClient = client;
		cachedKey = key;
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
