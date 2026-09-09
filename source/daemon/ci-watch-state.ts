/**
 * Persisted CI-watch dedup state. Lets `CiEventSource`'s `seenFailedRunIds`
 * survive a daemon restart, so a failed run that's already been investigated
 * and posted doesn't get re-investigated and re-posted the next time the
 * daemon boots while that run is still the most recent completed one.
 *
 * Same atomic-write pattern as `lockfile.ts`: write to a sibling `*.tmp` file
 * and rename in place. Unlike the lockfile, this file is meant to outlive a
 * stopped daemon, so there's no removal/liveness helper here.
 */

import {randomBytes} from 'node:crypto';
import {existsSync} from 'node:fs';
import {mkdir, readFile, rename, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';

export interface CiWatchState {
	seenFailedRunIds: number[];
}

export function getCiWatchStatePath(projectRoot: string): string {
	return join(projectRoot, '.nanocoder', 'ci-watch-state.json');
}

export async function readCiWatchState(
	projectRoot: string,
): Promise<CiWatchState> {
	const path = getCiWatchStatePath(projectRoot);
	if (!existsSync(path)) return {seenFailedRunIds: []};
	try {
		const raw = await readFile(path, 'utf-8');
		const parsed = JSON.parse(raw) as CiWatchState;
		if (!Array.isArray(parsed.seenFailedRunIds)) return {seenFailedRunIds: []};
		return parsed;
	} catch {
		return {seenFailedRunIds: []};
	}
}

export async function writeCiWatchState(
	projectRoot: string,
	state: CiWatchState,
): Promise<void> {
	const path = getCiWatchStatePath(projectRoot);
	await mkdir(dirname(path), {recursive: true});
	const tmp = `${path}.${randomBytes(8).toString('hex')}.tmp`;
	await writeFile(tmp, JSON.stringify(state, null, 2), 'utf-8');
	await rename(tmp, path);
}
