import path from 'node:path';
import type {SwarmConfig, SwarmSnapshot} from './types';

/** What is printed once the dashboard closes: the outcome and what to do next. */
export function formatSwarmSummary(
	config: SwarmConfig,
	snapshot: SwarmSnapshot,
): string {
	const lines: string[] = [];
	const files = snapshot.patches.flatMap(patch => patch.files);
	const failed = snapshot.status === 'failed';

	if (failed) {
		lines.push(`Swarm failed: ${snapshot.error}`);
		lines.push('Swarm did not change your working tree.');
	} else if (snapshot.error) {
		lines.push(snapshot.error);
	}

	if (!failed && files.length === 0) {
		lines.push('Swarm finished. The workers made no changes.');
	} else if (snapshot.applied) {
		lines.push(
			`Swarm finished. Applied changes to ${files.length} file(s), left uncommitted:`,
			...files.map(file => `  ${file}`),
		);
	} else if (files.length > 0) {
		lines.push(
			failed
				? 'Patches from the workers that finished:'
				: `Swarm finished. Nothing was applied${config.swarmMode === 'review' ? ' (review mode)' : ''}.`,
			...snapshot.patches.map(
				patch => `  ${patch.patchPath}  (${patch.files.join(', ')})`,
			),
		);
		if (!failed) {
			const patches = path.posix.join(
				...(snapshot.runDir ?? '').split(path.sep),
				'*.patch',
			);
			lines.push(
				`To apply them all: git apply ${snapshot.patches.length === 1 ? snapshot.patches[0]?.patchPath : patches}`,
			);
		}
	}

	if (snapshot.runDir) lines.push(`Logs: ${snapshot.runDir}`);
	return lines.join('\n');
}
