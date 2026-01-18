/**
 * Validation Types for Plan Documents
 *
 * Defines types for validating plan documents including
 * structural, business rule, and cross-document validation.
 */

import type {DocumentType} from './templates.js';

/**
 * Individual validation issue
 */
export interface ValidationIssue {
	/** Severity level */
	level: ValidationLevel;
	/** Human-readable error message */
	message: string;
	/** Which document this issue applies to */
	document?: DocumentType;
	/** Line number where issue occurs (if applicable) */
	line?: number;
	/** Specific code or identifier for the issue */
	code?: string;
}

/**
 * Severity level of a validation issue
 */
export type ValidationLevel = 'error' | 'warning' | 'info';

/**
 * Result of validating a single document
 */
export interface DocumentValidationResult {
	/** Which document was validated */
	document: DocumentType;
	/** Whether validation passed (no errors) */
	valid: boolean;
	/** Error-level issues */
	errors: ValidationIssue[];
	/** Warning-level issues */
	warnings: ValidationIssue[];
	/** Info-level issues */
	info: ValidationIssue[];
	/** When validation was performed */
	timestamp: Date;
}

/**
 * Result of validating entire plan directory
 */
export interface ValidationResult {
	/** Overall validation status */
	valid: boolean;
	/** All error-level issues */
	errors: ValidationIssue[];
	/** All warning-level issues */
	warnings: ValidationIssue[];
	/** All info-level issues */
	info: ValidationIssue[];
	/** Per-document validation results */
	documents: Record<DocumentType, DocumentValidationResult>;
	/** When validation was performed */
	timestamp: Date;
}

/**
 * Collection of all plan documents for validation
 */
export interface PlanDocuments {
	/** proposal.md content */
	proposal: string | null;
	/** design.md content */
	design: string | null;
	/** spec.md content */
	spec: string | null;
	/** tasks.md content */
	tasks: string | null;
	/** plan.md content */
	plan: string | null;
}

/**
 * Validation options
 */
export interface ValidationOptions {
	/** Whether to run in strict mode (warnings = errors) */
	strict?: boolean;
	/** Whether to validate optional documents that don't exist */
	validateOptional?: boolean;
	/** Maximum document length (in characters) */
	maxLength?: number;
}

/**
 * Business rule validation configuration
 */
export interface BusinessRuleConfig {
	/** Minimum length for proposal "Why" section */
	minProposalWhyLength: number;
	/** Maximum length for proposal "Why" section */
	maxProposalWhyLength: number;
	/** Minimum number of tasks required */
	minTaskCount: number;
	/** Maximum number of tasks (for local LLM efficiency) */
	maxTaskCount: number;
	/** Minimum scenarios per requirement */
	minScenariosPerRequirement: number;
	/** Maximum scenarios per requirement */
	maxScenariosPerRequirement: number;
}

/**
 * Default business rule configuration
 */
export const DEFAULT_BUSINESS_RULE_CONFIG: BusinessRuleConfig = {
	minProposalWhyLength: 50,
	maxProposalWhyLength: 1000,
	minTaskCount: 3,
	maxTaskCount: 50,
	minScenariosPerRequirement: 1,
	maxScenariosPerRequirement: 10,
};

/**
 * Validation error codes
 */
export const VALIDATION_CODES = {
	// Structural errors
	MISSING_SECTION: 'MISSING_SECTION',
	INVALID_FORMAT: 'INVALID_FORMAT',
	INVALID_HEADER: 'INVALID_HEADER',

	// Business rule errors
	CONTENT_TOO_SHORT: 'CONTENT_TOO_SHORT',
	CONTENT_TOO_LONG: 'CONTENT_TOO_LONG',
	INVALID_FORMAT_SPEC: 'INVALID_FORMAT_SPEC',
	MISSING_SCENARIOS: 'MISSING_SCENARIOS',
	TOO_FEW_TASKS: 'TOO_FEW_TASKS',
	TOO_MANY_TASKS: 'TOO_MANY_TASKS',

	// Cross-document errors
	INCONSISTENT_DOCUMENTS: 'INCONSISTENT_DOCUMENTS',
	MISSING_REQUIRED_DOCUMENT: 'MISSING_REQUIRED_DOCUMENT',
} as const;

/**
 * Validation error code type
 */
export type ValidationErrorCode =
	(typeof VALIDATION_CODES)[keyof typeof VALIDATION_CODES];
