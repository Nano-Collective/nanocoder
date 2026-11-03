import test from 'ava';
import {getAllowedToolNames} from '@/verify/trust';
import {
	buildRunnerTaskDescription,
	getRunnerToolNames,
} from './ci-fix-runner-task';

console.log('\nci-fix-runner-task.spec.ts');

const PAYLOAD = {
	runId: 42,
	workflowName: 'CI',
	branch: 'feature-x',
	headSha: 'abc123',
	url: 'https://github.com/o/r/actions/runs/42',
};

test('the runner drops git_pr, which has no credentials there', t => {
	for (const level of ['auto-fix', 'full-commit'] as const) {
		const tools = getRunnerToolNames(level);
		t.false(tools.includes('git_pr'));
		t.deepEqual(
			tools,
			getAllowedToolNames(level).filter(name => name !== 'git_pr'),
		);
	}
});

test('the task description points the agent at the staged log', t => {
	const description = buildRunnerTaskDescription({
		worktreePath: '/tmp/clone',
		trustLevel: 'auto-fix',
		payload: PAYLOAD,
		taskDescription: 'Investigate CI failure',
		failedLogPath: '.git/nanocoder-ci/failed-steps.log',
	});
	t.true(description.startsWith('Investigate CI failure'));
	t.true(description.includes('.git/nanocoder-ci/failed-steps.log'));
	t.regex(description, /no GitHub access/);
});

test('the task description says when the log could not be fetched', t => {
	const description = buildRunnerTaskDescription({
		worktreePath: '/tmp/clone',
		trustLevel: 'full-commit',
		payload: PAYLOAD,
		taskDescription: 'Investigate CI failure',
	});
	t.regex(description, /could not be fetched/);
});
