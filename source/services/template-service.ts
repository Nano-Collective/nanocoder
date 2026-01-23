/**
 * Template Service for Plan Mode
 *
 * Provides functions to generate all plan document templates.
 */

import generateDesignTemplate from '@/templates/plan-mode/design.template';
import generatePlanTemplate from '@/templates/plan-mode/plan.template';
import generateProposalTemplate from '@/templates/plan-mode/proposal.template';
import generateSpecTemplate from '@/templates/plan-mode/spec.template';
import generateTasksTemplate from '@/templates/plan-mode/tasks.template';
import type {
	DesignTemplateContext,
	DocumentType,
	PlanTemplateContext,
	ProposalTemplateContext,
	SpecTemplateContext,
	TasksTemplateContext,
} from '@/types/templates';

/**
 * Generate a template for a specific document type
 */
export function generateDocumentTemplate(
	documentType: DocumentType,
	context:
		| ProposalTemplateContext
		| DesignTemplateContext
		| SpecTemplateContext
		| TasksTemplateContext
		| PlanTemplateContext,
): string {
	switch (documentType) {
		case 'proposal':
			return generateProposalTemplate(context as ProposalTemplateContext);
		case 'design':
			return generateDesignTemplate(context as DesignTemplateContext);
		case 'spec':
			return generateSpecTemplate(context as SpecTemplateContext);
		case 'tasks':
			return generateTasksTemplate(context as TasksTemplateContext);
		case 'plan':
			return generatePlanTemplate(context as PlanTemplateContext);
		default:
			const exhaustiveCheck: never = documentType;
			throw new Error(`Unknown document type: ${exhaustiveCheck}`);
	}
}

/**
 * Get the template filename for a document type
 */
export function getDocumentFileName(documentType: DocumentType): string {
	switch (documentType) {
		case 'proposal':
			return 'proposal.md';
		case 'design':
			return 'design.md';
		case 'spec':
			return 'spec.md';
		case 'tasks':
			return 'tasks.md';
		case 'plan':
			return 'plan.md';
		default:
			const exhaustiveCheck: never = documentType;
			throw new Error(`Unknown document type: ${exhaustiveCheck}`);
	}
}

/**
 * Get the document type from a filename
 */
export function getDocumentTypeFromFileName(
	fileName: string,
): DocumentType | null {
	const baseName = fileName.replace(/^.*\//, '').replace(/\.md$/, '');
	switch (baseName) {
		case 'proposal':
			return 'proposal';
		case 'design':
			return 'design';
		case 'spec':
			return 'spec';
		case 'tasks':
			return 'tasks';
		case 'plan':
			return 'plan';
		default:
			return null;
	}
}

/**
 * Check if a filename is a plan document
 */
export function isPlanDocument(fileName: string): boolean {
	return getDocumentTypeFromFileName(fileName) !== null;
}

/**
 * Get required sections for a document type (for validation)
 */
export function getRequiredSections(documentType: DocumentType): string[] {
	switch (documentType) {
		case 'proposal':
			return ['Why', 'What Changes', 'Impact'];
		case 'design':
			return ['Context', 'Goals', 'Decisions', 'Risks & Trade-offs'];
		case 'spec':
			// At least one of the delta sections should be present
			return [
				'ADDED Requirements',
				'MODIFIED Requirements',
				'REMOVED Requirements',
				'RENAMED Requirements',
			];
		case 'tasks':
			// At least one task section should be present
			return ['Implementation', 'Testing', 'Documentation', 'Deployment'];
		case 'plan':
			return ['Overview', 'Tasks'];
		default:
			const exhaustiveCheck: never = documentType;
			throw new Error(`Unknown document type: ${exhaustiveCheck}`);
	}
}
