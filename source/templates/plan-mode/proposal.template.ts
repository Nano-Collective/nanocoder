/**
 * Proposal Template for Plan Mode
 *
 * First document created during Understanding phase.
 * Describes what changes are being made and why.
 */

import type {ProposalTemplateContext} from '@/types/templates';

export function generateProposalTemplate(
	context: ProposalTemplateContext,
): string {
	const {summary, why, changes, impactedSpecs, impactedCode} = context;

	// Format changes with breaking change markers
	const changesList = changes
		.map(({description, breaking}) => {
			const marker = breaking ? ' **BREAKING**' : '';
			return `- ${description}${marker}`;
		})
		.join('\n');

	// Format impacted specs
	const specsList =
		impactedSpecs.length > 0
			? impactedSpecs.map(spec => `- ${spec}`).join('\n')
			: '- (None)';

	// Format impacted code
	const codeList =
		impactedCode.length > 0
			? impactedCode.map(code => `- ${code}`).join('\n')
			: '- (None)';

	return `# ${summary}

## Why

${why}

## What Changes

${changesList}

## Impact

### Affected Specs

${specsList}

### Affected Code

${codeList}
`;
}

export default generateProposalTemplate;
