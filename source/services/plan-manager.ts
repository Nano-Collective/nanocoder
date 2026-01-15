/**
 * Plan Manager Service
 *
 * Manages plan file CRUD operations for Plan Mode.
 * Plans are stored as markdown files in `.nanocoder/plans/` directory.
 *
 * Plan IDs follow the format: {adjective}-{verb}-{noun}
 * Example: focused-creating-feature
 */

import {existsSync, promises as fs} from 'node:fs';
import * as path from 'node:path';
import {generateUniqueSlug, isValidSlug} from '@/utils/plan/slug-generator.js';

/**
 * Result type for directory validation
 */
interface DirectoryValidationResult {
	valid: boolean;
	reason?: string;
}

/**
 * Result type for plan read operations
 */
interface PlanReadResult {
	content: string;
	exists: boolean;
	planPath: string;
}

/**
 * Result type for plan creation
 */
interface PlanCreateResult {
	planId: string;
	planPath: string;
}

/**
 * Result type for plan listing
 */
interface PlanListEntry {
	planId: string;
	planPath: string;
}

/**
 * Plan Manager Service
 *
 * Provides centralized CRUD operations for plan files.
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
	 * Get the full path for a plan file
	 */
	private getPlanPath(planId: string): string {
		return path.join(this.getPlansDir(), `${planId}.md`);
	}

	/**
	 * Validate that a plan ID is in correct slug format
	 */
	private validatePlanId(planId: string): void {
		if (!isValidSlug(planId)) {
			throw new Error(
				`Invalid plan ID format: "${planId}". Plan IDs must follow the format {adjective}-{verb}-{noun}`,
			);
		}
	}

	/**
	 * Create a new plan file with a unique slug identifier
	 *
	 * @returns Object containing the generated plan ID and file path
	 */
	async createPlan(): Promise<PlanCreateResult> {
		// Ensure plans directory exists
		await this.ensurePlansDir();

		// Get existing plan IDs to ensure uniqueness
		const existingPlans = await this.listPlans();
		const existingSlugs = new Set(existingPlans.map(p => p.planId));

		// Generate unique slug
		const planId = generateUniqueSlug(existingSlugs);

		// Create empty plan file with YAML frontmatter
		const planPath = this.getPlanPath(planId);
		const initialContent = this.generateInitialPlanContent(planId);

		await fs.writeFile(planPath, initialContent, 'utf8');

		return {planId, planPath};
	}

	/**
	 * Generate initial plan file content with YAML frontmatter
	 */
	private generateInitialPlanContent(planId: string): string {
		const timestamp = new Date().toISOString();
		return `---
planId: ${planId}
created: ${timestamp}
phase: understanding
---

# Plan: ${planId}

## Understanding Phase

*Add your understanding phase notes here...*
`;
	}

	/**
	 * Read a plan file's content
	 *
	 * @param planId - The plan identifier
	 * @returns Object containing content, existence flag, and path
	 */
	async readPlan(planId: string): Promise<PlanReadResult> {
		this.validatePlanId(planId);

		const planPath = this.getPlanPath(planId);

		if (!existsSync(planPath)) {
			return {content: '', exists: false, planPath};
		}

		const content = await fs.readFile(planPath, 'utf8');
		return {content, exists: true, planPath};
	}

	/**
	 * Write content to a plan file
	 *
	 * @param planId - The plan identifier
	 * @param content - The markdown content to write
	 */
	async writePlan(planId: string, content: string): Promise<void> {
		this.validatePlanId(planId);

		const planPath = this.getPlanPath(planId);

		// Atomic write: write to temp file, then rename
		const tempPath = `${planPath}.tmp`;
		await fs.writeFile(tempPath, content, 'utf8');
		await fs.rename(tempPath, planPath);
	}

	/**
	 * Delete a plan file
	 *
	 * @param planId - The plan identifier
	 */
	async deletePlan(planId: string): Promise<void> {
		this.validatePlanId(planId);

		const planPath = this.getPlanPath(planId);

		if (!existsSync(planPath)) {
			throw new Error(`Plan not found: "${planId}"`);
		}

		await fs.unlink(planPath);
	}

	/**
	 * List all available plans in the workspace
	 *
	 * @returns Array of plan entries with planId and path
	 */
	async listPlans(): Promise<PlanListEntry[]> {
		const plansDir = this.getPlansDir();

		// If plans directory doesn't exist, return empty array
		if (!existsSync(plansDir)) {
			return [];
		}

		try {
			const entries = await fs.readdir(plansDir);

			// Filter for .md files and extract plan IDs
			const plans: PlanListEntry[] = [];
			for (const entry of entries) {
				if (entry.endsWith('.md')) {
					const planId = entry.slice(0, -3); // Remove .md extension
					const planPath = path.join(plansDir, entry);

					// Verify it's a valid plan ID format
					if (isValidSlug(planId)) {
						// Verify the file actually exists and is a file
						const stat = await fs.stat(planPath);
						if (stat.isFile()) {
							plans.push({planId, planPath});
						}
					}
				}
			}

			return plans;
		} catch {
			// If readdir fails, return empty array
			return [];
		}
	}

	/**
	 * Check if a given path is a plan file path
	 *
	 * @param targetPath - The path to check
	 * @returns true if the path is within the plans directory and has .md extension
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

		// Check if it has .md extension
		if (!absoluteTarget.endsWith('.md')) {
			return false;
		}

		return true;
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
 * Create a PlanManager instance for the given workspace
 *
 * @param cwd - Current working directory (defaults to process.cwd())
 * @returns PlanManager instance
 */
export function createPlanManager(cwd: string = process.cwd()): PlanManager {
	return new PlanManager(cwd);
}
