/**
 * Plan Manager Service
 *
 * Manages plan directory CRUD operations for Plan Mode.
 * Plans are stored as directories with markdown documents in `.nanocoder/plans/` directory.
 *
 * Plan summaries follow kebab-case format (e.g., "add-api-authentication")
 * The directory contains: proposal.md, design.md, spec.md, tasks.md, plan.md
 */

import {existsSync, promises as fs, statSync} from 'node:fs';
import * as path from 'node:path';
import {
	getDocumentFileName,
	isPlanDocument,
} from '@/services/template-service.js';
import type {DocumentType} from '@/types/templates';
import {
	generateBriefSummary,
	isValidSummary,
} from '@/utils/plan/summary-generator.js';

/**
 * Result type for directory validation
 */
interface DirectoryValidationResult {
	valid: boolean;
	reason?: string;
}

/**
 * Result type for plan read operations
 * Returns all document paths and whether the plan directory exists
 */
interface PlanReadResult {
	exists: boolean;
	planSummary: string;
	planDirectoryPath: string;
	proposalPath: string | null;
	designPath: string | null;
	specPath: string | null;
	tasksPath: string | null;
	planFilePath: string | null;
}

/**
 * Result type for plan creation
 * Returns the plan summary and all document paths
 */
interface PlanCreateResult {
	planSummary: string;
	planDirectoryPath: string;
	proposalPath: string;
	planFilePath: string;
}

/**
 * Result type for document creation
 */
interface DocumentCreateResult {
	documentPath: string;
}

/**
 * Result type for document read
 */
interface DocumentReadResult {
	content: string;
	exists: boolean;
	documentPath: string;
}

/**
 * Result type for plan listing
 */
interface PlanListEntry {
	planSummary: string;
	planDirectoryPath: string;
	isLegacy: boolean; // true = old single-file format, false = new directory format
}

/**
 * Plan Manager Service
 *
 * Provides centralized CRUD operations for plan directories.
 * Follows the pattern of CheckpointManager for consistency.
 */
export class PlanManager {
	private readonly workspaceRoot: string;
	private readonly plansDirName = '.nanocoder';
	private readonly plansSubDir = 'plans';

	constructor(workspaceRoot: string) {
		this.workspaceRoot = workspaceRoot;
	}

	/**
	 * Ensure the plans directory exists
	 */
	private async ensurePlansDir(): Promise<string> {
		const plansDir = this.getPlansDir();

		if (!existsSync(plansDir)) {
			await fs.mkdir(plansDir, {recursive: true});
		}

		return plansDir;
	}

	/**
	 * Get the plans directory path
	 */
	private getPlansDir(): string {
		return path.join(this.workspaceRoot, this.plansDirName, this.plansSubDir);
	}

	/**
	 * Get the plan directory path for a given summary
	 */
	getPlanDirectoryPath(planSummary: string): string {
		return path.join(this.getPlansDir(), planSummary);
	}

	/**
	 * Get the path for a specific document
	 */
	getDocumentPath(planSummary: string, documentType: DocumentType): string {
		const planDir = this.getPlanDirectoryPath(planSummary);
		const fileName = getDocumentFileName(documentType);
		return path.join(planDir, fileName);
	}

	/**
	 * Get all document paths for a plan
	 */
	getAllDocumentPaths(planSummary: string): {
		proposalPath: string;
		designPath: string;
		specPath: string;
		tasksPath: string;
		planFilePath: string;
	} {
		return {
			proposalPath: this.getDocumentPath(planSummary, 'proposal'),
			designPath: this.getDocumentPath(planSummary, 'design'),
			specPath: this.getDocumentPath(planSummary, 'spec'),
			tasksPath: this.getDocumentPath(planSummary, 'tasks'),
			planFilePath: this.getDocumentPath(planSummary, 'plan'),
		};
	}

	/**
	 * Validate that a plan summary is in correct kebab-case format
	 */
	private validatePlanSummary(planSummary: string): void {
		if (!isValidSummary(planSummary)) {
			throw new Error(
				`Invalid plan summary format: "${planSummary}". Plan summaries must be kebab-case (e.g., "add-api-authentication")`,
			);
		}
	}

	/**
	 * Create a new plan directory with initial proposal.md
	 *
	 * @param userRequest - Optional user's request/query to generate meaningful summary
	 * @param llmClient - Optional LLM client for intent-based summary generation
	 * @returns Object containing the plan summary and document paths
	 */
	async createPlan(
		userRequest?: string,
		llmClient?: Parameters<typeof generateBriefSummary>[1],
	): Promise<PlanCreateResult> {
		// Ensure plans directory exists
		await this.ensurePlansDir();

		// Get existing plan summaries to ensure uniqueness
		const existingPlans = await this.listPlans();
		const existingSummaries = new Set(
			existingPlans
				.map(p => p.planSummary)
				.filter(s => !s.includes('/')), // Filter out legacy file paths
		);

		// Generate unique summary from user request using LLM intent classification or semantic extraction
		const planSummary = await generateBriefSummary(
			userRequest || 'new-plan',
			llmClient,
		);
		const uniqueSummary = await this.ensureUniqueSummary(
			planSummary,
			existingSummaries,
		);

		// Create plan directory
		const planDirectoryPath = this.getPlanDirectoryPath(uniqueSummary);
		await fs.mkdir(planDirectoryPath, {recursive: true});

		// Get all document paths
		const paths = this.getAllDocumentPaths(uniqueSummary);

		// Create initial proposal.md with template
		const initialProposalContent =
			this.generateInitialProposalContent(uniqueSummary);
		await fs.writeFile(paths.proposalPath, initialProposalContent, 'utf8');

		// Create initial plan.md with template
		const initialPlanContent = this.generateInitialPlanContent(uniqueSummary);
		await fs.writeFile(paths.planFilePath, initialPlanContent, 'utf8');

		return {
			planSummary: uniqueSummary,
			planDirectoryPath,
			proposalPath: paths.proposalPath,
			planFilePath: paths.planFilePath,
		};
	}

	/**
	 * Ensure summary is unique by adding numeric suffix if needed
	 */
	private async ensureUniqueSummary(
		baseSummary: string,
		existingSummaries: Set<string>,
	): Promise<string> {
		let summary = baseSummary;
		let counter = 2;

		while (existingSummaries.has(summary) && counter < 100) {
			summary = `${baseSummary}-${counter}`;
			counter++;
		}

		return summary;
	}

	/**
	 * Generate initial proposal.md content with template
	 */
	private generateInitialProposalContent(planSummary: string): string {
		const timestamp = new Date().toISOString();
		return `---
summary: ${planSummary}
created: ${timestamp}
phase: understanding
---

# ${planSummary}

## Why

*Describe why this change is needed (50-1000 characters)...*

## What Changes

- *List the changes being made...*

## Impact

### Affected Specs

- (None)

### Affected Code

- (None)
`;
	}

	/**
	 * Generate initial plan.md content with template
	 */
	private generateInitialPlanContent(planSummary: string): string {
		const timestamp = new Date().toISOString();
		return `---
summary: ${planSummary}
created: ${timestamp}
phase: understanding
---

# ${planSummary}

## Overview

*Overview will be populated after proposal is created...*

## Tasks

*Tasks will be populated during Final Plan phase...*
`;
	}

	/**
	 * Read plan information (directory exists and all document paths)
	 *
	 * @param planSummary - The plan summary identifier
	 * @returns Object with existence flag and all document paths
	 */
	async readPlan(planSummary: string): Promise<PlanReadResult> {
		this.validatePlanSummary(planSummary);

		const planDirectoryPath = this.getPlanDirectoryPath(planSummary);
		const paths = this.getAllDocumentPaths(planSummary);

		const exists = existsSync(planDirectoryPath);

		return {
			exists,
			planSummary,
			planDirectoryPath,
			proposalPath:
				exists && existsSync(paths.proposalPath) ? paths.proposalPath : null,
			designPath:
				exists && existsSync(paths.designPath) ? paths.designPath : null,
			specPath: exists && existsSync(paths.specPath) ? paths.specPath : null,
			tasksPath: exists && existsSync(paths.tasksPath) ? paths.tasksPath : null,
			planFilePath:
				exists && existsSync(paths.planFilePath) ? paths.planFilePath : null,
		};
	}

	/**
	 * Create or update a document in the plan directory
	 *
	 * @param planSummary - The plan summary identifier
	 * @param documentType - The type of document to create
	 * @param content - The markdown content to write
	 * @returns Object with the document path
	 */
	async createDocument(
		planSummary: string,
		documentType: DocumentType,
		content: string,
	): Promise<DocumentCreateResult> {
		this.validatePlanSummary(planSummary);

		const documentPath = this.getDocumentPath(planSummary, documentType);

		// Ensure plan directory exists
		const planDirectoryPath = this.getPlanDirectoryPath(planSummary);
		if (!existsSync(planDirectoryPath)) {
			throw new Error(`Plan directory does not exist: "${planSummary}"`);
		}

		// Atomic write: write to temp file, then rename
		const tempPath = `${documentPath}.tmp`;
		await fs.writeFile(tempPath, content, 'utf8');
		await fs.rename(tempPath, documentPath);

		return {documentPath};
	}

	/**
	 * Read a specific document from the plan directory
	 *
	 * @param planSummary - The plan summary identifier
	 * @param documentType - The type of document to read
	 * @returns Object with content, existence flag, and path
	 */
	async readDocument(
		planSummary: string,
		documentType: DocumentType,
	): Promise<DocumentReadResult> {
		this.validatePlanSummary(planSummary);

		const documentPath = this.getDocumentPath(planSummary, documentType);

		if (!existsSync(documentPath)) {
			return {content: '', exists: false, documentPath};
		}

		const content = await fs.readFile(documentPath, 'utf8');
		return {content, exists: true, documentPath};
	}

	/**
	 * List all documents in a plan directory
	 *
	 * @param planSummary - The plan summary identifier
	 * @returns Array of document types that exist
	 */
	async listDocuments(planSummary: string): Promise<DocumentType[]> {
		this.validatePlanSummary(planSummary);

		const planDirectoryPath = this.getPlanDirectoryPath(planSummary);

		if (!existsSync(planDirectoryPath)) {
			return [];
		}

		try {
			const entries = await fs.readdir(planDirectoryPath);
			const documents: DocumentType[] = [];

			for (const entry of entries) {
				if (entry.endsWith('.md')) {
					const docType = getDocumentTypeFromFileName(entry);
					if (docType) {
						documents.push(docType);
					}
				}
			}

			return documents;
		} catch {
			return [];
		}
	}

	/**
	 * Delete a plan directory and all its contents
	 *
	 * @param planSummary - The plan summary identifier
	 */
	async deletePlan(planSummary: string): Promise<void> {
		this.validatePlanSummary(planSummary);

		const planDirectoryPath = this.getPlanDirectoryPath(planSummary);

		if (!existsSync(planDirectoryPath)) {
			throw new Error(`Plan not found: "${planSummary}"`);
		}

		await fs.rm(planDirectoryPath, {recursive: true, force: true});
	}

	/**
	 * Write content to a document (alias for createDocument for consistency)
	 *
	 * @param planSummary - The plan summary identifier
	 * @param documentType - The type of document to write
	 * @param content - The markdown content to write
	 */
	async writeDocument(
		planSummary: string,
		documentType: DocumentType,
		content: string,
	): Promise<void> {
		await this.createDocument(planSummary, documentType, content);
	}

	/**
	 * List all available plans in the workspace
	 * Includes both new directory format and legacy single-file format
	 *
	 * @returns Array of plan entries with summary and path
	 */
	async listPlans(): Promise<PlanListEntry[]> {
		const plansDir = this.getPlansDir();

		// If plans directory doesn't exist, return empty array
		if (!existsSync(plansDir)) {
			return [];
		}

		try {
			const entries = await fs.readdir(plansDir, {withFileTypes: true});
			const plans: PlanListEntry[] = [];

			for (const entry of entries) {
				if (entry.isDirectory()) {
					// New format: directory with documents
					const planSummary = entry.name;
					const planDirectoryPath = path.join(plansDir, planSummary);

					// Verify it's a valid plan summary format
					if (isValidSummary(planSummary)) {
						plans.push({
							planSummary,
							planDirectoryPath,
							isLegacy: false,
						});
					}
				} else if (entry.isFile() && entry.name.endsWith('.md')) {
					// Legacy format: single .md file
					const planSummary = entry.name.slice(0, -3); // Remove .md extension
					const planDirectoryPath = path.join(plansDir, entry.name);

					// Include legacy plans for backward compatibility
					plans.push({
						planSummary,
						planDirectoryPath,
						isLegacy: true,
					});
				}
			}

			return plans;
		} catch {
			// If readdir fails, return empty array
			return [];
		}
	}

	/**
	 * Check if a given path is within a plan directory or is a plan document
	 *
	 * @param targetPath - The path to check
	 * @returns true if the path is within a plan directory or is a plan document
	 */
	isPlanFilePath(targetPath: string): boolean {
		// Resolve the target path to an absolute path
		const absoluteTarget = path.resolve(targetPath);
		const plansDir = path.resolve(this.getPlansDir());

		// Check if the path is within the plans directory
		const relativePath = path.relative(plansDir, absoluteTarget);

		// If relative path starts with '..', it's outside the plans directory
		if (relativePath.startsWith('..')) {
			return false;
		}

		// Check if it's a plan document file
		if (isPlanDocument(targetPath)) {
			return true;
		}

		// Check if the path is a plan directory itself
		try {
			const stat = statSync(absoluteTarget);
			if (stat.isDirectory()) {
				// Check if it's a valid plan summary (kebab-case)
				const dirName = path.basename(absoluteTarget);
				return isValidSummary(dirName);
			}
		} catch {
			// If stat fails, return false
		}

		return false;
	}

	/**
	 * Validate that the current directory is suitable for plan mode
	 *
	 * @returns Object with valid flag and optional reason for failure
	 */
	async validateDirectory(): Promise<DirectoryValidationResult> {
		// Check if workspace root exists
		if (!existsSync(this.workspaceRoot)) {
			return {
				valid: false,
				reason: `Directory does not exist: "${this.workspaceRoot}"`,
			};
		}

		// Try to access the directory
		try {
			await fs.access(
				this.workspaceRoot,
				fs.constants.R_OK | fs.constants.W_OK,
			);
		} catch {
			return {
				valid: false,
				reason: `Directory is not readable/writable: "${this.workspaceRoot}"`,
			};
		}

		// Try to create plans directory to verify write permissions
		try {
			await this.ensurePlansDir();

			// Try to write a test file
			const testPath = path.join(this.getPlansDir(), '.write-test');
			await fs.writeFile(testPath, 'test', 'utf8');
			await fs.unlink(testPath);
		} catch (error) {
			return {
				valid: false,
				reason: `Cannot write to plans directory: ${error instanceof Error ? error.message : String(error)}`,
			};
		}

		return {valid: true};
	}
}

/**
 * Helper to get document type from filename
 */
function getDocumentTypeFromFileName(fileName: string): DocumentType | null {
	const baseName = fileName.replace(/\.md$/, '');
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
 * Create a PlanManager instance for the given workspace
 *
 * @param cwd - Current working directory (defaults to process.cwd())
 * @returns PlanManager instance
 */
export function createPlanManager(cwd: string = process.cwd()): PlanManager {
	return new PlanManager(cwd);
}
