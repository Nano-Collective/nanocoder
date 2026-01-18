import type {
	DevelopmentMode,
	DocumentType,
	PlanModeState,
	PlanPhase,
	ValidationResult,
} from '@/types/core';

/**
 * Global development mode state
 * This is used by tool definitions to determine needsApproval dynamically
 * Updated via setCurrentMode() when mode changes in the UI
 */
let currentMode: DevelopmentMode = 'normal';

/**
 * Global plan mode state
 * Tracks the active plan during plan mode
 * Updated via setters when entering/exiting plan mode
 */
let currentPlanSummary: string = '';
let currentPlanPhase: PlanPhase = 'understanding';
let currentPlanDirectoryPath: string = '';
let currentProposalPath: string | null = null;
let currentDesignPath: string | null = null;
let currentSpecPath: string | null = null;
let currentTasksPath: string | null = null;
let currentPlanFilePath: string = '';
let currentDocument: DocumentType | null = null;
let currentCompletedDocuments: Set<DocumentType> = new Set();
let currentValidationResults: ValidationResult | null = null;

/**
 * Get the current development mode
 * Used by tool definitions to determine if approval is needed
 */
export function getCurrentMode(): DevelopmentMode {
	return currentMode;
}

/**
 * Set the current development mode
 * Called by the app when mode changes via Shift+Tab
 */
export function setCurrentMode(mode: DevelopmentMode): void {
	currentMode = mode;
}

/**
 * Get the current plan summary (directory name)
 */
export function getPlanSummary(): string {
	return currentPlanSummary;
}

/**
 * Set the current plan summary
 */
export function setPlanSummary(summary: string): void {
	currentPlanSummary = summary;
}

/**
 * Get the current plan directory path
 */
export function getPlanDirectoryPath(): string {
	return currentPlanDirectoryPath;
}

/**
 * Set the current plan directory path
 */
export function setPlanDirectoryPath(path: string): void {
	currentPlanDirectoryPath = path;
}

/**
 * Get the current plan phase
 */
export function getPlanPhase(): PlanPhase {
	return currentPlanPhase;
}

/**
 * Set the current plan phase
 */
export function setPlanPhase(phase: PlanPhase): void {
	currentPlanPhase = phase;
}

/**
 * Get the current proposal.md path
 */
export function getProposalPath(): string | null {
	return currentProposalPath;
}

/**
 * Set the current proposal.md path
 */
export function setProposalPath(path: string | null): void {
	currentProposalPath = path;
}

/**
 * Get the current design.md path
 */
export function getDesignPath(): string | null {
	return currentDesignPath;
}

/**
 * Set the current design.md path
 */
export function setDesignPath(path: string | null): void {
	currentDesignPath = path;
}

/**
 * Get the current spec.md path
 */
export function getSpecPath(): string | null {
	return currentSpecPath;
}

/**
 * Set the current spec.md path
 */
export function setSpecPath(path: string | null): void {
	currentSpecPath = path;
}

/**
 * Get the current tasks.md path
 */
export function getTasksPath(): string | null {
	return currentTasksPath;
}

/**
 * Set the current tasks.md path
 */
export function setTasksPath(path: string | null): void {
	currentTasksPath = path;
}

/**
 * Get the current plan.md (consolidated) path
 */
export function getPlanFilePath(): string {
	return currentPlanFilePath;
}

/**
 * Set the current plan.md (consolidated) path
 */
export function setPlanFilePath(filePath: string): void {
	currentPlanFilePath = filePath;
}

/**
 * Get the currently active document
 */
export function getCurrentDocument(): DocumentType | null {
	return currentDocument;
}

/**
 * Set the currently active document
 */
export function setCurrentDocument(doc: DocumentType | null): void {
	currentDocument = doc;
}

/**
 * Get the set of completed documents
 */
export function getCompletedDocuments(): Set<DocumentType> {
	return currentCompletedDocuments;
}

/**
 * Add a document to the completed set
 */
export function addCompletedDocument(doc: DocumentType): void {
	currentCompletedDocuments.add(doc);
}

/**
 * Remove a document from the completed set
 */
export function removeCompletedDocument(doc: DocumentType): void {
	currentCompletedDocuments.delete(doc);
}

/**
 * Get the last validation results
 */
export function getValidationResults(): ValidationResult | null {
	return currentValidationResults;
}

/**
 * Set validation results
 */
export function setValidationResults(results: ValidationResult | null): void {
	currentValidationResults = results;
}

/**
 * Get the current plan ID (alias for planSummary)
 * @deprecated Use getPlanSummary() instead
 */
export function getPlanId(): string {
	return currentPlanSummary;
}

/**
 * Set the current plan ID (alias for setPlanSummary)
 * @deprecated Use setPlanSummary() instead
 */
export function setPlanId(summary: string): void {
	currentPlanSummary = summary;
}

/**
 * Get the complete plan mode state
 */
export function getPlanModeState(): PlanModeState {
	return {
		active: currentPlanSummary !== '',
		planSummary: currentPlanSummary,
		phase: currentPlanPhase,
		planDirectoryPath: currentPlanDirectoryPath,
		proposalPath: currentProposalPath,
		designPath: currentDesignPath,
		specPath: currentSpecPath,
		tasksPath: currentTasksPath,
		planFilePath: currentPlanFilePath,
		currentDocument: currentDocument,
		completedDocuments: currentCompletedDocuments,
		validationResults: currentValidationResults,
	};
}

/**
 * Reset plan mode state to defaults
 * Called when exiting plan mode
 */
export function resetPlanModeState(): void {
	currentPlanSummary = '';
	currentPlanPhase = 'understanding';
	currentPlanDirectoryPath = '';
	currentProposalPath = null;
	currentDesignPath = null;
	currentSpecPath = null;
	currentTasksPath = null;
	currentPlanFilePath = '';
	currentDocument = null;
	currentCompletedDocuments = new Set();
	currentValidationResults = null;
}
