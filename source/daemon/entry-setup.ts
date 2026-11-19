import {loadPlugins} from '@/plugins/host';
import {setAutoCommitClient} from '@/services/auto-commit';
import type {LLMClient} from '@/types/core';

export interface DaemonSessionDeps {
	setAutoCommitClient: (client: LLMClient | null) => void;
	loadPlugins: (trusted: boolean) => Promise<void>;
}

/**
 * Per-process setup the TUI and --plain do for their sessions, done once for
 * the daemon. `nanocoder daemon start` only spawns the daemon after the
 * project passes its trust gate, so plugins load as trusted, the way --plain
 * loads them after its own gate. The client also writes `autoCommit` messages.
 */
export async function prepareDaemonSession(
	client: LLMClient,
	deps: DaemonSessionDeps = {setAutoCommitClient, loadPlugins},
): Promise<void> {
	deps.setAutoCommitClient(client);
	await deps.loadPlugins(true);
}
