import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {getProjectRoot} from '@/services/session-cwd';
import {ensureNanocoderGitignore} from '@/utils/ensure-nanocoder-gitignore';
import {withExclusiveLock} from '@/utils/exclusive-file-lock';
import {
	assertValidPlanGraph,
	buildPlanNodes,
	isValidPlanId,
	normalizePlanTitle,
	slugifyPlanId,
	summarizePlan,
} from './graph.js';
import type {
	PlanGraph,
	PlanIndex,
	PlanNode,
	PlanNodeInput,
	PlanNodeStatus,
	PlanSummary,
} from './types.js';

const INDEX_VERSION = 1 as const;
const PLAN_EXTENSION = '.jsonl';
const LOCK_FILE = '.lock';

export class PlanStoreError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'PlanStoreError';
	}
}

export interface CreatePlanInput {
	title: string;
	nodes: PlanNodeInput[];
}

export interface ReplacePlanInput {
	title?: string;
	nodes: PlanNodeInput[];
}

export interface PlanNodePatch {
	status?: PlanNodeStatus;
	title?: string;
	description?: string | null;
	agent?: string | null;
	checkpoint?: string | null;
	blockedReason?: string | null;
	dependsOn?: string[];
}

export interface PlanNodeUpdateResult {
	plan: PlanGraph;
	node: PlanNode;
}

interface PlanJsonlHeader {
	type: 'header';
	version: number;
	id: string;
	title: string;
	createdAt: string;
	updatedAt: string;
}

interface PlanJsonlNode extends PlanNode {
	type: 'node';
}

/**
 * Project-scoped store for plan graphs.
 *
 * Layout, chosen to match the issue and the existing `.nanocoder/` runtime
 * directories:
 *
 *   .nanocoder/plans/<id>.jsonl   header line, then one node per line
 *   .nanocoder/plans/index.json   active plan id + lightweight summaries
 *
 * JSONL is rewritten atomically as a whole snapshot rather than appended to.
 * Nodes reference each other by id, so an append-only log would need replay
 * logic on every read for no benefit. The snapshot keeps the file readable as
 * a diff and survives a partially-written rename.
 */
export class PlanStore {
	constructor(private readonly workspaceRoot?: string) {}

	getWorkspaceRoot(): string {
		return this.workspaceRoot ?? getProjectRoot();
	}

	getPlansDir(): string {
		return path.join(this.getWorkspaceRoot(), '.nanocoder', 'plans');
	}

	getPlanPath(planId: string): string {
		if (!isValidPlanId(planId)) {
			throw new PlanStoreError(`Invalid plan id "${planId}"`);
		}
		return path.join(this.getPlansDir(), `${planId}${PLAN_EXTENSION}`);
	}

	getIndexPath(): string {
		return path.join(this.getPlansDir(), 'index.json');
	}

	async loadPlan(planId: string): Promise<PlanGraph | null> {
		if (!isValidPlanId(planId)) return null;
		return this.readPlanUnlocked(planId);
	}

	async listPlans(): Promise<PlanSummary[]> {
		await this.ensureDirs();
		return this.withLock(async () => {
			const summaries = await this.scanSummariesUnlocked();
			const index = await this.readIndexUnlocked();
			const activeStillExists = summaries.some(
				summary => summary.id === index.activePlanId,
			);
			const next: PlanIndex = {
				version: INDEX_VERSION,
				activePlanId: activeStillExists ? index.activePlanId : null,
				plans: summaries,
			};
			await this.writeIndexIfChangedUnlocked(index, next);
			return summaries;
		});
	}

	async getActivePlanId(): Promise<string | null> {
		await this.ensureDirs();
		return this.withLock(async () => {
			const index = await this.readIndexUnlocked();
			if (index.activePlanId) return index.activePlanId;

			// A valid index with an explicit null means the user disabled active
			// plan injection. Only recover when the index itself is missing or
			// corrupt; don't silently reactivate a plan the user switched off.
			const indexExists = await pathExists(this.getIndexPath());
			if (indexExists) {
				try {
					const parsed = JSON.parse(
						await fs.readFile(this.getIndexPath(), 'utf8'),
					) as Partial<PlanIndex>;
					if (
						parsed?.version === INDEX_VERSION &&
						(parsed.activePlanId === null ||
							typeof parsed.activePlanId === 'string') &&
						Array.isArray(parsed.plans)
					) {
						return parsed.activePlanId;
					}
				} catch {
					// Fall through to rebuilding from durable plan files.
				}
			}

			const plans = await this.scanSummariesUnlocked();
			const recovered: PlanIndex = {
				version: INDEX_VERSION,
				activePlanId: plans[0]?.id ?? null,
				plans,
			};
			await this.writeIndexUnlocked(recovered);
			return recovered.activePlanId;
		});
	}

	async getActivePlan(): Promise<PlanGraph | null> {
		const planId = await this.getActivePlanId();
		if (!planId) return null;
		return this.readPlanUnlocked(planId);
	}

	async setActivePlanId(planId: string | null): Promise<void> {
		await this.ensureDirs();
		await this.withLock(async () => {
			const index = await this.readIndexUnlocked();
			if (planId === null) {
				index.activePlanId = null;
				await this.writeIndexUnlocked(index);
				return;
			}

			const plan = await this.readPlanUnlocked(planId);
			if (!plan) {
				throw new PlanStoreError(`Plan "${planId}" does not exist`);
			}
			index.activePlanId = plan.id;
			upsertSummary(index, plan);
			await this.writeIndexUnlocked(index);
		});
	}

	async createPlan(input: CreatePlanInput): Promise<PlanGraph> {
		await this.ensureDirs();
		return this.withLock(async () => {
			const now = new Date().toISOString();
			const title = normalizePlanTitle(input.title);
			const planId = await this.allocatePlanIdUnlocked(title);
			const plan: PlanGraph = {
				id: planId,
				title,
				createdAt: now,
				updatedAt: now,
				nodes: buildPlanNodes(input.nodes, now),
			};
			assertValidPlanGraph(plan);
			await this.writePlanUnlocked(plan);

			const index = await this.readIndexUnlocked();
			index.activePlanId = plan.id;
			upsertSummary(index, plan);
			await this.writeIndexUnlocked(index);
			return plan;
		});
	}

	/** Replace every node of an existing plan, keeping its id and creation time. */
	async replacePlan(
		planId: string,
		input: ReplacePlanInput,
	): Promise<PlanGraph> {
		await this.ensureDirs();
		return this.withLock(async () => {
			const existing = await this.readPlanUnlocked(planId);
			if (!existing) {
				throw new PlanStoreError(`Plan "${planId}" does not exist`);
			}

			const now = new Date().toISOString();
			const plan: PlanGraph = {
				id: existing.id,
				title: normalizePlanTitle(input.title ?? '') || existing.title,
				createdAt: existing.createdAt,
				updatedAt: now,
				nodes: buildPlanNodes(input.nodes, now),
			};
			assertValidPlanGraph(plan);
			await this.writePlanUnlocked(plan);

			const index = await this.readIndexUnlocked();
			upsertSummary(index, plan);
			await this.writeIndexUnlocked(index);
			return plan;
		});
	}

	async updatePlanNode(
		planId: string,
		nodeId: string,
		patch: PlanNodePatch,
	): Promise<PlanNodeUpdateResult> {
		await this.ensureDirs();
		return this.withLock(async () => {
			const plan = await this.readPlanUnlocked(planId);
			if (!plan) {
				throw new PlanStoreError(`Plan "${planId}" does not exist`);
			}

			const node = plan.nodes.find(candidate => candidate.id === nodeId);
			if (!node) {
				throw new PlanStoreError(`Plan "${planId}" has no node "${nodeId}"`);
			}

			applyPatch(node, patch);
			const now = new Date().toISOString();
			node.updatedAt = now;
			plan.updatedAt = now;
			assertValidPlanGraph(plan);

			await this.writePlanUnlocked(plan);
			const index = await this.readIndexUnlocked();
			upsertSummary(index, plan);
			await this.writeIndexUnlocked(index);
			return {plan, node};
		});
	}

	async deletePlan(planId: string): Promise<boolean> {
		if (!isValidPlanId(planId)) return false;
		await this.ensureDirs();
		return this.withLock(async () => {
			try {
				await fs.unlink(this.getPlanPath(planId));
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
					return false;
				}
				throw error;
			}

			const index = await this.readIndexUnlocked();
			index.plans = index.plans.filter(summary => summary.id !== planId);
			if (index.activePlanId === planId) {
				index.activePlanId = null;
			}
			await this.writeIndexUnlocked(index);
			return true;
		});
	}

	// -------------------------------------------------------------------------
	// Internals
	// -------------------------------------------------------------------------

	private async ensureDirs(): Promise<void> {
		const plansDir = this.getPlansDir();
		await fs.mkdir(plansDir, {recursive: true, mode: 0o700});
		await fs.chmod(plansDir, 0o700).catch(() => {});
		// `.nanocoder/plans/` is runtime state, like checkpoints and timeline.
		await ensureNanocoderGitignore(this.getWorkspaceRoot());
	}

	private async withLock<T>(operation: () => Promise<T>): Promise<T> {
		return withExclusiveLock(
			path.join(this.getPlansDir(), LOCK_FILE),
			operation,
		);
	}

	private async allocatePlanIdUnlocked(title: string): Promise<string> {
		const base = slugifyPlanId(title);
		for (let suffix = 1; suffix < 10_000; suffix++) {
			const candidate = suffix === 1 ? base : `${base}-${suffix}`;
			if (!(await pathExists(this.getPlanPath(candidate)))) {
				return candidate;
			}
		}
		throw new PlanStoreError('Could not allocate a unique plan id');
	}

	private async readPlanUnlocked(planId: string): Promise<PlanGraph | null> {
		const filePath = this.getPlanPath(planId);
		let content: string;
		try {
			content = await fs.readFile(filePath, 'utf8');
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
				return null;
			}
			throw error;
		}
		return parsePlanJsonl(content, planId);
	}

	private async writePlanUnlocked(plan: PlanGraph): Promise<void> {
		await writeFileAtomic(this.getPlanPath(plan.id), serializePlanJsonl(plan));
	}

	private async readIndexUnlocked(): Promise<PlanIndex> {
		try {
			const raw = await fs.readFile(this.getIndexPath(), 'utf8');
			const parsed = JSON.parse(raw) as Partial<PlanIndex>;
			if (
				parsed &&
				parsed.version === INDEX_VERSION &&
				Array.isArray(parsed.plans)
			) {
				return {
					version: INDEX_VERSION,
					activePlanId:
						typeof parsed.activePlanId === 'string'
							? parsed.activePlanId
							: null,
					plans: parsed.plans.filter(isPlanSummary),
				};
			}
		} catch {
			// Missing or corrupt index. Plan files remain the source of truth, so
			// rebuild it from the directory instead of failing.
		}
		return {version: INDEX_VERSION, activePlanId: null, plans: []};
	}

	private async writeIndexUnlocked(index: PlanIndex): Promise<void> {
		const payload = JSON.stringify(index, null, 2) + '\n';
		await writeFileAtomic(this.getIndexPath(), payload);
	}

	private async writeIndexIfChangedUnlocked(
		previous: PlanIndex,
		next: PlanIndex,
	): Promise<void> {
		if (JSON.stringify(previous) === JSON.stringify(next)) return;
		await this.writeIndexUnlocked(next);
	}

	private async scanSummariesUnlocked(): Promise<PlanSummary[]> {
		const plansDir = this.getPlansDir();
		let entries: string[];
		try {
			entries = await fs.readdir(plansDir);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
			throw error;
		}

		const summaries: PlanSummary[] = [];
		for (const entry of entries) {
			if (!entry.endsWith(PLAN_EXTENSION)) continue;
			const planId = entry.slice(0, -PLAN_EXTENSION.length);
			if (!isValidPlanId(planId)) continue;
			try {
				const plan = await this.readPlanUnlocked(planId);
				if (plan) summaries.push(summarizePlan(plan));
			} catch {
				// A hand-edited or half-written plan must not hide the others.
			}
		}

		return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
	}
}

function applyPatch(node: PlanNode, patch: PlanNodePatch): void {
	if (patch.title !== undefined) {
		node.title = normalizePlanTitle(patch.title);
	}
	if (patch.description !== undefined) {
		setOptional(node, 'description', patch.description);
	}
	if (patch.agent !== undefined) {
		setOptional(node, 'agent', patch.agent);
	}
	if (patch.checkpoint !== undefined) {
		setOptional(node, 'checkpoint', patch.checkpoint);
	}
	if (patch.dependsOn !== undefined) {
		node.dependsOn = dedupe(patch.dependsOn);
	}
	if (patch.status !== undefined) {
		node.status = patch.status;
		// Leaving blocked drops the stale reason. Entering blocked requires one,
		// which validation enforces.
		if (patch.status !== 'blocked') {
			delete node.blockedReason;
		}
	}
	if (patch.blockedReason !== undefined) {
		setOptional(node, 'blockedReason', patch.blockedReason);
	}
}

function setOptional<
	K extends 'description' | 'agent' | 'checkpoint' | 'blockedReason',
>(node: PlanNode, key: K, value: string | null): void {
	const trimmed = value?.trim() ?? '';
	if (trimmed.length > 0) {
		node[key] = trimmed;
	} else {
		delete node[key];
	}
}

function dedupe(values: string[]): string[] {
	return [...new Set(values.map(value => value.trim()).filter(Boolean))];
}

function upsertSummary(index: PlanIndex, plan: PlanGraph): void {
	const summary = summarizePlan(plan);
	const position = index.plans.findIndex(candidate => candidate.id === plan.id);
	if (position >= 0) {
		index.plans[position] = summary;
	} else {
		index.plans.push(summary);
	}
}

function isPlanSummary(value: unknown): value is PlanSummary {
	if (!value || typeof value !== 'object') return false;
	const summary = value as Partial<PlanSummary>;
	return (
		typeof summary.id === 'string' &&
		typeof summary.title === 'string' &&
		typeof summary.total === 'number' &&
		typeof summary.done === 'number' &&
		typeof summary.doing === 'number' &&
		typeof summary.blocked === 'number' &&
		typeof summary.updatedAt === 'string'
	);
}

async function pathExists(filePath: string): Promise<boolean> {
	try {
		await fs.access(filePath);
		return true;
	} catch {
		return false;
	}
}

async function writeFileAtomic(
	filePath: string,
	content: string,
): Promise<void> {
	await fs.mkdir(path.dirname(filePath), {recursive: true, mode: 0o700});
	const temporaryPath = `${filePath}.${crypto.randomUUID()}.tmp`;
	try {
		await fs.writeFile(temporaryPath, content, {
			encoding: 'utf8',
			mode: 0o600,
		});
		await fs.rename(temporaryPath, filePath);
	} catch (error) {
		await fs.unlink(temporaryPath).catch(() => {});
		throw error;
	}
}

function serializePlanJsonl(plan: PlanGraph): string {
	const header: PlanJsonlHeader = {
		type: 'header',
		version: INDEX_VERSION,
		id: plan.id,
		title: plan.title,
		createdAt: plan.createdAt,
		updatedAt: plan.updatedAt,
	};
	const lines: string[] = [JSON.stringify(header)];
	for (const node of plan.nodes) {
		const record: PlanJsonlNode = {type: 'node', ...node};
		lines.push(JSON.stringify(record));
	}
	return lines.join('\n') + '\n';
}

export function parsePlanJsonl(
	content: string,
	expectedId?: string,
): PlanGraph {
	const lines = content.split(/\r?\n/).filter(line => line.trim().length > 0);
	if (lines.length === 0) {
		throw new PlanStoreError('Plan file is empty');
	}

	let header: PlanJsonlHeader | null = null;
	const nodes: PlanNode[] = [];

	for (const [index, line] of lines.entries()) {
		let record: unknown;
		try {
			record = JSON.parse(line);
		} catch {
			throw new PlanStoreError(`Invalid JSON on line ${index + 1} of plan`);
		}
		if (!record || typeof record !== 'object') {
			throw new PlanStoreError(`Invalid record on line ${index + 1} of plan`);
		}

		const candidate = record as Record<string, unknown>;
		if (candidate.type === 'header') {
			if (index !== 0) {
				throw new PlanStoreError('Plan header must be the first line');
			}
			header = {
				type: 'header',
				version: typeof candidate.version === 'number' ? candidate.version : 1,
				id: typeof candidate.id === 'string' ? candidate.id : '',
				title: typeof candidate.title === 'string' ? candidate.title : '',
				createdAt:
					typeof candidate.createdAt === 'string'
						? candidate.createdAt
						: new Date().toISOString(),
				updatedAt:
					typeof candidate.updatedAt === 'string'
						? candidate.updatedAt
						: new Date().toISOString(),
			};
			continue;
		}

		nodes.push(parseNodeRecord(candidate, index + 1));
	}

	if (!header) {
		throw new PlanStoreError('Plan file is missing its header line');
	}
	if (expectedId && header.id !== expectedId) {
		throw new PlanStoreError(
			`Plan file id "${header.id}" does not match "${expectedId}"`,
		);
	}

	return {
		id: header.id,
		title: header.title,
		createdAt: header.createdAt,
		updatedAt: header.updatedAt,
		nodes,
	};
}

function parseNodeRecord(
	candidate: Record<string, unknown>,
	lineNumber: number,
): PlanNode {
	if (typeof candidate.id !== 'string' || candidate.id.trim().length === 0) {
		throw new PlanStoreError(
			`Plan node on line ${lineNumber} is missing an id`,
		);
	}
	if (
		typeof candidate.title !== 'string' ||
		candidate.title.trim().length === 0
	) {
		throw new PlanStoreError(
			`Plan node "${candidate.id}" on line ${lineNumber} is missing a title`,
		);
	}

	const status = candidate.status;
	const node: PlanNode = {
		id: candidate.id,
		title: candidate.title,
		status:
			status === 'todo' ||
			status === 'doing' ||
			status === 'done' ||
			status === 'blocked'
				? status
				: 'todo',
		dependsOn: Array.isArray(candidate.dependsOn)
			? candidate.dependsOn.filter(
					(value): value is string => typeof value === 'string',
				)
			: [],
		createdAt:
			typeof candidate.createdAt === 'string'
				? candidate.createdAt
				: new Date().toISOString(),
		updatedAt:
			typeof candidate.updatedAt === 'string'
				? candidate.updatedAt
				: new Date().toISOString(),
	};

	if (typeof candidate.description === 'string') {
		node.description = candidate.description;
	}
	if (typeof candidate.agent === 'string') {
		node.agent = candidate.agent;
	}
	if (typeof candidate.checkpoint === 'string') {
		node.checkpoint = candidate.checkpoint;
	}
	if (typeof candidate.blockedReason === 'string') {
		node.blockedReason = candidate.blockedReason;
	}

	return node;
}
