/**
 * Pure helpers for `ci-fix-runner.ts`, kept in their own module because the
 * runner entry point runs `main()` on import.
 */

import type {CiFixRunnerInput} from '@/daemon/ci-fix-runner';
import {getAllowedToolNames} from '@/verify/trust';

/**
 * The runner has no GitHub credentials (see `buildFixRunnerEnv` in
 * `ci-fix-orchestrator.ts`), so `git_pr` could only fail here. Drop it from
 * the tool list and tell the agent where the orchestrator put the log.
 */
export function getRunnerToolNames(
	trustLevel: CiFixRunnerInput['trustLevel'],
): string[] {
	return getAllowedToolNames(trustLevel).filter(name => name !== 'git_pr');
}

export function buildRunnerTaskDescription(input: CiFixRunnerInput): string {
	const logNote = input.failedLogPath
		? `The failing steps' log (\`gh run view ${input.payload.runId} --log-failed\`) has been saved to \`${input.failedLogPath}\`. Read it with \`read_file\` (use start_line/end_line for long logs) or search it with \`execute_bash\` (e.g. \`grep -n\`).`
		: `The failing steps' log for run ${input.payload.runId} could not be fetched. Diagnose from the checked-out code and the run's metadata, and say so in your diagnosis.`;
	return [
		input.taskDescription,
		'',
		'## Isolated fix run',
		'',
		'This run has no GitHub access: `git_pr` is not available, and `git push` and `gh` will fail. Do not try to work around that; the harness publishes your commits after you finish.',
		'',
		logNote,
	].join('\n');
}
