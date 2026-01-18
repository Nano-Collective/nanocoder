/**
 * Template Context Types for Plan Documents
 *
 * Defines the structure and context for generating plan document templates.
 * Each document type has its own context interface for type-safe template generation.
 */

/**
 * Context for proposal.md template
 */
export interface ProposalTemplateContext {
	/** Brief summary of the change (kebab-case) */
	summary: string;
	/** Why this change is needed (50-1000 characters) */
	why: string;
	/** List of changes being made */
	changes: Array<{
		/** Description of the change */
		description: string;
		/** Whether this is a breaking change */
		breaking?: boolean;
	}>;
	/** Affected specs/capabilities */
	impactedSpecs: string[];
	/** Affected code files/modules */
	impactedCode: string[];
}

/**
 * Context for design.md template
 */
export interface DesignTemplateContext {
	/** Background, constraints, stakeholders */
	context: string;
	/** Goals of this design */
	goals: string[];
	/** Non-goals - explicitly out of scope */
	nonGoals: string[];
	/** Technical decisions made */
	decisions: Array<{
		/** What was decided */
		what: string;
		/** Why this decision was made */
		why: string;
		/** Alternative approaches considered */
		alternatives: string;
	}>;
	/** Known risks and mitigations */
	risks: Array<{
		/** Description of the risk */
		risk: string;
		/** How to mitigate the risk */
		mitigation: string;
	}>;
	/** Migration approach description */
	migration: string;
	/** Step-by-step migration steps */
	steps: string[];
	/** Rollback plan if things go wrong */
	rollback: string;
	/** Unresolved questions */
	questions: string[];
}

/**
 * Context for spec.md template (delta format)
 */
export interface SpecTemplateContext {
	/** New requirements being added */
	addedRequirements: Array<{
		/** Requirement name */
		name: string;
		/** Full requirement description */
		description: string;
		/** Scenarios for this requirement */
		scenarios: Array<{
			/** Scenario name */
			name: string;
			/** WHEN condition */
			when: string;
			/** THEN expected result */
			then: string;
		}>;
	}>;
	/** Existing requirements being modified */
	modifiedRequirements: Array<{
		/** Requirement name */
		name: string;
		/** Full updated requirement content */
		fullContent: string;
		/** Scenarios for this requirement */
		scenarios: Array<{
			/** Scenario name */
			name: string;
			/** WHEN condition */
			when: string;
			/** THEN expected result */
			then: string;
		}>;
	}>;
	/** Requirements being removed */
	removedRequirements: Array<{
		/** Requirement name */
		name: string;
		/** Reason for removal */
		reason: string;
		/** Migration path for existing code/data */
		migration: string;
	}>;
	/** Requirements being renamed */
	renamedRequirements: Array<{
		/** Old requirement name */
		oldName: string;
		/** New requirement name */
		newName: string;
	}>;
}

/**
 * Context for tasks.md template
 */
export interface TasksTemplateContext {
	/** Implementation tasks */
	implementationTasks: Array<{
		/** Task number (e.g., "1.1") */
		taskNumber: string;
		/** Task description */
		taskDescription: string;
	}>;
	/** Testing tasks */
	testingTasks: Array<{
		/** Task number (e.g., "2.1") */
		taskNumber: string;
		/** Task description */
		taskDescription: string;
	}>;
	/** Documentation tasks */
	documentationTasks: Array<{
		/** Task number (e.g., "3.1") */
		taskNumber: string;
		/** Task description */
		taskDescription: string;
	}>;
	/** Deployment tasks */
	deploymentTasks: Array<{
		/** Task number (e.g., "4.1") */
		taskNumber: string;
		/** Task description */
		taskDescription: string;
	}>;
}

/**
 * Context for plan.md template (consolidated view)
 */
export interface PlanTemplateContext {
	/** Brief summary */
	summary: string;
	/** Summary from proposal.md */
	proposalSummary: string;
	/** Whether design.md exists */
	designExists: boolean;
	/** Summary of design decisions (if exists) */
	designSummary?: string;
	/** Whether spec.md exists */
	specExists: boolean;
	/** Summary of requirements (if exists) */
	specSummary?: string;
	/** Summary of tasks */
	tasksSummary: string;
}

/**
 * Generic template context that can be any document type
 */
export type TemplateContext =
	| ProposalTemplateContext
	| DesignTemplateContext
	| SpecTemplateContext
	| TasksTemplateContext
	| PlanTemplateContext;

/**
 * Document type discriminator
 */
export type DocumentType = 'proposal' | 'design' | 'spec' | 'tasks' | 'plan';

/**
 * Map document type to its template context type
 */
export type DocumentContext<T extends DocumentType> = T extends 'proposal'
	? ProposalTemplateContext
	: T extends 'design'
		? DesignTemplateContext
		: T extends 'spec'
			? SpecTemplateContext
			: T extends 'tasks'
				? TasksTemplateContext
				: T extends 'plan'
					? PlanTemplateContext
					: never;
