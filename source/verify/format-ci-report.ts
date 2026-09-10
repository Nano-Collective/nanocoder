export interface FormatCiReportInput {
	runId: number;
	workflowName: string;
	branch: string;
	url: string;
	subagentOutput: string;
	/** True when this run actually committed and published a fix (auto-fix's
	 * draft PR, or full-commit's direct push) — adjusts the footer so it
	 * doesn't falsely claim "no auto-fix applied" when one was. */
	fixApplied?: boolean;
}

/**
 * Composes a deterministic header (run id, workflow, branch, URL — never
 * re-derived from the LLM's own text) with the investigator subagent's
 * narrative diagnosis into a single report body, mirroring
 * `format-review.ts`'s split between deterministic and model-generated
 * content.
 */
export function formatCiReport(input: FormatCiReportInput): string {
	const {runId, workflowName, branch, url, subagentOutput, fixApplied} = input;

	const footer = fixApplied
		? '*Generated automatically by the Nanocoder daemon — a fix was implemented, committed, and published as described above. Review before merging.*'
		: '*Generated automatically by the Nanocoder daemon — advisory diagnosis, no auto-fix applied.*';

	return [
		`## Nanocoder CI Investigation — "${workflowName}" failed on \`${branch}\``,
		'',
		`Run: [#${runId}](${url})`,
		'',
		subagentOutput.trim(),
		'',
		'---',
		footer,
	].join('\n');
}
