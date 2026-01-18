/**
 * Spec Template for Plan Mode
 *
 * Created during Review phase to document requirements.
 * Uses delta format (ADDED/MODIFIED/REMOVED/RENAMED) with Gherkin scenarios.
 */

import type {SpecTemplateContext} from '@/types/templates';

export function generateSpecTemplate(context: SpecTemplateContext): string {
	const {
		addedRequirements,
		modifiedRequirements,
		removedRequirements,
		renamedRequirements,
	} = context;

	let content = '';

	// ADDED Requirements
	if (addedRequirements.length > 0) {
		content += '## ADDED Requirements\n\n';
		for (const req of addedRequirements) {
			content += `### ${req.name}\n\n`;
			content += `${req.description}\n\n`;
			content += '#### Scenarios\n\n';
			for (const scenario of req.scenarios) {
				content += `**Scenario:** ${scenario.name}\n\n`;
				content += `**GIVEN** ${scenario.when}\n`;
				content += `**WHEN** ${scenario.when}\n`;
				content += `**THEN** ${scenario.then}\n`;
				content += '\n';
			}
			content += '\n';
		}
	}

	// MODIFIED Requirements
	if (modifiedRequirements.length > 0) {
		if (content) content += '\n';
		content += '## MODIFIED Requirements\n\n';
		for (const req of modifiedRequirements) {
			content += `### ${req.name}\n\n`;
			content += `${req.fullContent}\n\n`;
			content += '#### Scenarios\n\n';
			for (const scenario of req.scenarios) {
				content += `**Scenario:** ${scenario.name}\n\n`;
				content += `**GIVEN** ${scenario.when}\n`;
				content += `**WHEN** ${scenario.when}\n`;
				content += `**THEN** ${scenario.then}\n`;
				content += '\n';
			}
			content += '\n';
		}
	}

	// REMOVED Requirements
	if (removedRequirements.length > 0) {
		if (content) content += '\n';
		content += '## REMOVED Requirements\n\n';
		for (const req of removedRequirements) {
			content += `### ${req.name}\n\n`;
			content += `**Reason:** ${req.reason}\n\n`;
			content += `**Migration:** ${req.migration}\n\n`;
		}
	}

	// RENAMED Requirements
	if (renamedRequirements.length > 0) {
		if (content) content += '\n';
		content += '## RENAMED Requirements\n\n';
		for (const req of renamedRequirements) {
			content += `- \`${req.oldName}\` → \`${req.newName}\`\n`;
		}
	}

	return content;
}

export default generateSpecTemplate;
