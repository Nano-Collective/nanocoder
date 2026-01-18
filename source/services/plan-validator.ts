/**
 * Plan Validator Service
 *
 * Validates plan documents after creation.
 * Performs structural validation (required sections) and business rule validation.
 */

import {getRequiredSections} from '@/services/template-service';
import type {DocumentType} from '@/types/templates';
import type {
	BusinessRuleConfig,
	DocumentValidationResult,
	ValidationIssue,
	ValidationResult,
} from '@/types/validation';
import {DEFAULT_BUSINESS_RULE_CONFIG} from '@/types/validation';

/**
 * Plan Validator Service
 *
 * Validates plan documents for structure and business rules.
 */
export class PlanValidator {
	private readonly businessRuleConfig: BusinessRuleConfig;

	constructor(config?: Partial<BusinessRuleConfig>) {
		this.businessRuleConfig = {
			...DEFAULT_BUSINESS_RULE_CONFIG,
			...config,
		};
	}

	/**
	 * Validate a specific document
	 *
	 * @param documentType - The type of document to validate
	 * @param content - The markdown content to validate
	 * @returns Validation result with issues grouped by level
	 */
	validateDocument(
		documentType: DocumentType,
		content: string,
	): ValidationResult {
		const errors: ValidationIssue[] = [];
		const warnings: ValidationIssue[] = [];
		const info: ValidationIssue[] = [];

		// Structural validation - check for required sections
		const structuralIssues = this.validateStructure(documentType, content);
		errors.push(...structuralIssues.filter(i => i.level === 'error'));
		warnings.push(...structuralIssues.filter(i => i.level === 'warning'));
		info.push(...structuralIssues.filter(i => i.level === 'info'));

		// Business rule validation
		const businessIssues = this.validateBusinessRules(documentType, content);
		errors.push(...businessIssues.filter(i => i.level === 'error'));
		warnings.push(...businessIssues.filter(i => i.level === 'warning'));
		info.push(...businessIssues.filter(i => i.level === 'info'));

		// Document-level result
		const documentResult: DocumentValidationResult = {
			document: documentType,
			valid: errors.length === 0,
			errors: errors.filter(e => e.document === documentType),
			warnings: warnings.filter(w => w.document === documentType),
			info: info.filter(i => i.document === documentType),
			timestamp: new Date(),
		};

		return {
			valid: errors.length === 0,
			errors,
			warnings,
			info,
			documents: {
				proposal: this.createEmptyResult('proposal'),
				design: this.createEmptyResult('design'),
				spec: this.createEmptyResult('spec'),
				tasks: this.createEmptyResult('tasks'),
				plan: this.createEmptyResult('plan'),
				[documentType]: documentResult,
			},
			timestamp: new Date(),
		};
	}

	/**
	 * Validate multiple documents (cross-document validation)
	 *
	 * @param documents - Map of document type to content
	 * @returns Validation result with cross-document checks
	 */
	validateDocuments(
		documents: Partial<Record<DocumentType, string>>,
	): ValidationResult {
		const errors: ValidationIssue[] = [];
		const warnings: ValidationIssue[] = [];
		const info: ValidationIssue[] = [];
		const documentResults: Record<DocumentType, DocumentValidationResult> = {
			proposal: this.createEmptyResult('proposal'),
			design: this.createEmptyResult('design'),
			spec: this.createEmptyResult('spec'),
			tasks: this.createEmptyResult('tasks'),
			plan: this.createEmptyResult('plan'),
		};

		// Validate each document
		for (const [docType, content] of Object.entries(documents)) {
			if (content) {
				const typedDocType = docType as DocumentType;
				const result = this.validateDocument(typedDocType, content);
				errors.push(...result.errors);
				warnings.push(...result.warnings);
				info.push(...result.info);
				documentResults[typedDocType] = result.documents[
					typedDocType
				] as DocumentValidationResult;
			}
		}

		// Cross-document validation
		const crossDocumentIssues = this.validateCrossDocument(documents);
		errors.push(...crossDocumentIssues.filter(i => i.level === 'error'));
		warnings.push(...crossDocumentIssues.filter(i => i.level === 'warning'));
		info.push(...crossDocumentIssues.filter(i => i.level === 'info'));

		return {
			valid: errors.length === 0,
			errors,
			warnings,
			info,
			documents: documentResults,
			timestamp: new Date(),
		};
	}

	/**
	 * Validate document structure (required sections)
	 */
	private validateStructure(
		documentType: DocumentType,
		content: string,
	): ValidationIssue[] {
		const issues: ValidationIssue[] = [];
		const requiredSections = getRequiredSections(documentType);

		// Check each required section
		for (const section of requiredSections) {
			// Look for section header (## Section Name)
			const sectionPattern = new RegExp(`^##\\s+${section}\\s*$`, 'm');
			if (!sectionPattern.test(content)) {
				issues.push({
					level: 'error',
					message: `Missing required section: "${section}"`,
					document: documentType,
				});
			}
		}

		return issues;
	}

	/**
	 * Validate business rules for a document
	 */
	private validateBusinessRules(
		documentType: DocumentType,
		content: string,
	): ValidationIssue[] {
		const issues: ValidationIssue[] = [];

		switch (documentType) {
			case 'proposal': {
				issues.push(...this.validateProposalBusinessRules(content));
				break;
			}
			case 'tasks': {
				issues.push(...this.validateTasksBusinessRules(content));
				break;
			}
			case 'spec': {
				issues.push(...this.validateSpecBusinessRules(content));
				break;
			}
			case 'design': {
				issues.push(...this.validateDesignBusinessRules(content));
				break;
			}
			case 'plan': {
				// plan.md is auto-generated, minimal validation needed
				break;
			}
		}

		return issues;
	}

	/**
	 * Validate proposal.md business rules
	 */
	private validateProposalBusinessRules(content: string): ValidationIssue[] {
		const issues: ValidationIssue[] = [];

		// Extract Why section
		const whyMatch = content.match(/## Why\s*\n([\s\S]*?)(?=##|$)/);
		if (whyMatch) {
			const whyContent = whyMatch[1].trim();
			const whyLength = whyContent.length;

			if (whyLength < this.businessRuleConfig.minProposalWhyLength) {
				issues.push({
					level: 'error',
					message: `Why section is too short (${whyLength} chars). Minimum: ${this.businessRuleConfig.minProposalWhyLength} chars.`,
					document: 'proposal',
				});
			}

			if (whyLength > this.businessRuleConfig.maxProposalWhyLength) {
				issues.push({
					level: 'warning',
					message: `Why section is very long (${whyLength} chars). Consider shortening to ${this.businessRuleConfig.maxProposalWhyLength} chars or less.`,
					document: 'proposal',
				});
			}

			// Check for placeholder text
			if (
				whyContent.includes('*Describe why') ||
				whyContent.includes('TODO:') ||
				whyContent.includes('<fill in>')
			) {
				issues.push({
					level: 'error',
					message:
						'Why section contains placeholder text. Please provide actual content.',
					document: 'proposal',
				});
			}
		}

		return issues;
	}

	/**
	 * Validate tasks.md business rules
	 */
	private validateTasksBusinessRules(content: string): ValidationIssue[] {
		const issues: ValidationIssue[] = [];

		// Count tasks (checkboxes starting with "- [")
		const taskMatches = content.matchAll(/^\- \[ \]/gm);
		const taskCount = Array.from(taskMatches).length;

		if (taskCount < this.businessRuleConfig.minTaskCount) {
			issues.push({
				level: 'error',
				message: `Too few tasks (${taskCount}). Minimum: ${this.businessRuleConfig.minTaskCount} tasks.`,
				document: 'tasks',
			});
		}

		if (taskCount > this.businessRuleConfig.maxTaskCount) {
			issues.push({
				level: 'warning',
				message: `Very large task list (${taskCount} tasks). Consider breaking into smaller plans if possible.`,
				document: 'tasks',
			});
		}

		// Check for placeholder tasks
		if (content.includes('*Add task*') || content.includes('TODO task')) {
			issues.push({
				level: 'error',
				message:
					'Tasks section contains placeholder text. Please provide actual tasks.',
				document: 'tasks',
			});
		}

		return issues;
	}

	/**
	 * Validate spec.md business rules
	 */
	private validateSpecBusinessRules(content: string): ValidationIssue[] {
		const issues: ValidationIssue[] = [];

		// Check for Gherkin scenarios
		const scenarioMatches = content.matchAll(
			/\*\*Scenario:\*\*.*?\*\*GIVEN\*\*.*?\*\*WHEN\*\*.*?\*\*THEN\*\*/gs,
		);
		const scenarioCount = Array.from(scenarioMatches).length;

		if (scenarioCount === 0) {
			issues.push({
				level: 'warning',
				message:
					'No Gherkin scenarios found. Consider adding scenarios with GIVEN/WHEN/THEN format.',
				document: 'spec',
			});
		}

		// Check for delta sections
		const hasDeltaSections =
			content.includes('## ADDED Requirements') ||
			content.includes('## MODIFIED Requirements') ||
			content.includes('## REMOVED Requirements') ||
			content.includes('## RENAMED Requirements');

		if (!hasDeltaSections) {
			issues.push({
				level: 'error',
				message:
					'Spec must include at least one delta section (ADDED/MODIFIED/REMOVED/RENAMED Requirements).',
				document: 'spec',
			});
		}

		return issues;
	}

	/**
	 * Validate design.md business rules
	 */
	private validateDesignBusinessRules(content: string): ValidationIssue[] {
		const issues: ValidationIssue[] = [];

		// Check for required sections with content
		const requiredSections = ['Context', 'Goals', 'Decisions'];
		for (const section of requiredSections) {
			const pattern = new RegExp(
				`^##\\s+${section}\\s*\\n([\\s\\S]*?)(?=##|$)`,
				'm',
			);
			const match = content.match(pattern);
			if (match) {
				const sectionContent = match[1].trim();
				if (sectionContent.length < 10) {
					issues.push({
						level: 'warning',
						message: `${section} section is very brief. Consider adding more detail.`,
						document: 'design',
					});
				}
			}
		}

		// Check for Context section - required for design.md
		if (!content.match(/## Context\s*\n/)) {
			issues.push({
				level: 'error',
				message:
					'Design document must include a Context section explaining the background.',
				document: 'design',
			});
		}

		return issues;
	}

	/**
	 * Cross-document validation
	 */
	private validateCrossDocument(
		documents: Partial<Record<DocumentType, string>>,
	): ValidationIssue[] {
		const issues: ValidationIssue[] = [];

		// Check if proposal exists
		if (!documents.proposal) {
			issues.push({
				level: 'error',
				message:
					'proposal.md is required and must be created before other documents.',
			});
		}

		// Check if tasks exists
		if (!documents.tasks) {
			issues.push({
				level: 'error',
				message: 'tasks.md is required for implementation planning.',
			});
		}

		// Check that tasks.md task count aligns with proposal scope
		if (documents.proposal && documents.tasks) {
			const proposalImpactCount = documents.proposal.match(/- /g)?.length || 0;
			const tasksTaskCount = documents.tasks.match(/^- \[ \]/gm)?.length || 0;

			// Rough heuristic: should have at least 1 task per 2 impacted items
			if (tasksTaskCount < proposalImpactCount / 2) {
				issues.push({
					level: 'warning',
					message: `Task count (${tasksTaskCount}) seems low for proposal scope (${proposalImpactCount} impacted items). Consider adding more tasks.`,
				});
			}
		}

		return issues;
	}

	/**
	 * Create an empty validation result
	 */
	private createEmptyResult(
		documentType: DocumentType,
	): DocumentValidationResult {
		return {
			document: documentType,
			valid: true,
			errors: [],
			warnings: [],
			info: [],
			timestamp: new Date(),
		};
	}
}

/**
 * Create a PlanValidator instance with default config
 *
 * @param config - Optional business rule configuration overrides
 * @returns PlanValidator instance
 */
export function createPlanValidator(
	config?: Partial<BusinessRuleConfig>,
): PlanValidator {
	return new PlanValidator(config);
}

/**
 * Validate a single document (convenience function)
 *
 * @param documentType - The type of document to validate
 * @param content - The markdown content to validate
 * @param config - Optional business rule configuration overrides
 * @returns Validation result
 */
export function validateDocument(
	documentType: DocumentType,
	content: string,
	config?: Partial<BusinessRuleConfig>,
): ValidationResult {
	const validator = new PlanValidator(config);
	return validator.validateDocument(documentType, content);
}

/**
 * Validate multiple documents (convenience function)
 *
 * @param documents - Map of document type to content
 * @param config - Optional business rule configuration overrides
 * @returns Validation result
 */
export function validateDocuments(
	documents: Partial<Record<DocumentType, string>>,
	config?: Partial<BusinessRuleConfig>,
): ValidationResult {
	const validator = new PlanValidator(config);
	return validator.validateDocuments(documents);
}
