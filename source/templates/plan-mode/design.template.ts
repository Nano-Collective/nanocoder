/**
 * Design Template for Plan Mode
 *
 * Created during Design phase to document technical decisions.
 * Includes context, goals, decisions, risks, and migration plan.
 */

import type {DesignTemplateContext} from '@/types/templates';

export function generateDesignTemplate(context: DesignTemplateContext): string {
	const {
		context: contextSection,
		goals,
		nonGoals,
		decisions,
		risks,
		migration,
		steps,
		rollback,
		questions,
	} = context;

	// Format goals list
	const goalsList = goals.map(goal => `- ${goal}`).join('\n');

	// Format non-goals list
	const nonGoalsList = nonGoals.map(nonGoal => `- ${nonGoal}`).join('\n');

	// Format decisions
	const decisionsList = decisions
		.map(({what, why, alternatives}) => {
			return `### ${what}

**Why:** ${why}

**Alternatives considered:** ${alternatives}`;
		})
		.join('\n\n');

	// Format risks
	const risksList = risks
		.map(({risk, mitigation}) => {
			return `- **Risk:** ${risk}\n  **Mitigation:** ${mitigation}`;
		})
		.join('\n');

	// Format migration steps
	const stepsList = steps.map((step, i) => `${i + 1}. ${step}`).join('\n');

	// Format questions
	const questionsList =
		questions.length > 0 ? questions.map(q => `- ${q}`).join('\n') : '- (None)';

	return `# Design

## Context

${contextSection}

## Goals

${goalsList}

## Non-Goals

${nonGoalsList}

## Decisions

${decisionsList}

## Risks & Trade-offs

${risksList}

## Migration Plan

${migration}

### Steps

${stepsList}

### Rollback

${rollback}

## Open Questions

${questionsList}
`;
}

export default generateDesignTemplate;
