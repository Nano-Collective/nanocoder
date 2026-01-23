/**
 * Plan Template for Plan Mode (Consolidated View)
 *
 * Consolidated view of all plan documents.
 * Created during Final Plan phase for easy reference.
 */

import type {PlanTemplateContext} from '@/types/templates';

export function generatePlanTemplate(context: PlanTemplateContext): string {
	const {
		summary,
		proposalSummary,
		designExists,
		designSummary,
		specExists,
		specSummary,
		tasksSummary,
	} = context;

	let content = `# ${summary}

## Overview

${proposalSummary}
`;

	// Design section (optional)
	if (designExists && designSummary) {
		content += `
## Design Summary

${designSummary}
`;
	}

	// Spec section (optional)
	if (specExists && specSummary) {
		content += `
## Spec Summary

${specSummary}
`;
	}

	// Tasks section (always included)
	content += `
## Tasks

${tasksSummary}
`;

	return content;
}

export default generatePlanTemplate;
