export interface FormatCiReportInput {
	runId: number;
	workflowName: string;
	branch: string;
	url: string;
	subagentOutput: string;
}

/**
 * Composes a deterministic header (run id, workflow, branch, URL — never
 * re-derived from the LLM's own text) with the investigator subagent's
 * narrative diagnosis into a single report body, mirroring
 * `format-review.ts`'s split between deterministic and model-generated
 * content.
 */
export function formatCiReport(input: FormatCiReportInput): string {
	const {runId, workflowName, branch, url, subagentOutput} = input;

	return [
		`## Nanocoder CI Investigation — "${workflowName}" failed on \`${branch}\``,
		'',
		`Run: [#${runId}](${url})`,
		'',
		subagentOutput.trim(),
		'',
		'---',
		'*Generated automatically by the Nanocoder daemon — advisory diagnosis, no auto-fix applied.*',
	].join('\n');
}
