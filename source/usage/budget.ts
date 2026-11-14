/**
 * Spend and token budget cap for runs and sessions.
 *
 * A `BudgetTracker` accumulates provider-reported usage after each model
 * response (tokens always, USD cost when models.dev prices the model) and
 * compares the running totals with the configured limits. At 80% of a limit
 * it reports `warning` once; at 100% it reports `exceeded` and the caller
 * stops before the next request.
 *
 * Models without a price in the database fall back to the token limit only:
 * the USD limit is not enforced for them and the summary says the cost is
 * unknown instead of treating it as zero.
 */

import {TIMEOUT_COST_LOOKUP_MS} from '@/constants';
import {getModelPricing} from '@/models/index';
import type {BudgetConfig} from '@/types/config';
import type {ApiUsage} from '@/types/core';
import {getTotalTokens} from '@/usage/format';
import {calculateUsageCost, type TokenPricing} from '@/usage/response-usage';

/** Warn when a limit is this percent used; stop at 100%. */
export const BUDGET_WARNING_PERCENT = 80;

/**
 * Distinct non-zero exit code for headless runs stopped by the budget cap
 * (plain shell: 0 success, 1 error, 2 tool-approval-required).
 */
export const BUDGET_EXCEEDED_EXIT_CODE = 3;

export interface BudgetLimits {
	/** Maximum estimated spend in USD for the run/session. */
	maxBudgetUsd?: number;
	/** Maximum total tokens (provider-reported input + output) for the run/session. */
	maxTokensTotal?: number;
}

export interface BudgetTotals {
	totalTokens: number;
	/** Running estimated spend in USD; undefined when the model is unpriced. */
	totalCostUsd: number | undefined;
	/** False when no price is known for the model — cost is unknown, not zero. */
	costKnown: boolean;
}

export type BudgetStatus = 'ok' | 'warning' | 'exceeded';

export type BudgetLimitKind = 'usd' | 'tokens';

export interface BudgetCheck {
	status: BudgetStatus;
	/** Which limit was hit, when status is `exceeded`. */
	exceededLimit: BudgetLimitKind | null;
	/** Which limit crossed the warning threshold on this response, if any. */
	warnedLimit: BudgetLimitKind | null;
	totals: BudgetTotals;
	limits: BudgetLimits;
}

type PricingLookup = (model: string) => Promise<TokenPricing | null>;

/** A limit is enforceable only when it is a finite number above zero. */
export function isValidBudgetLimit(value: number | undefined): boolean {
	return value !== undefined && Number.isFinite(value) && (value as number) > 0;
}

/**
 * Resolve the limits in effect for a scope. CLI flags win over settings;
 * the USD setting is scoped (`perRunUsd` for runs, `perSessionUsd` for
 * interactive/daemon sessions) while `maxTokensTotal` is shared.
 */
export function resolveBudgetLimits(options: {
	cli?: BudgetLimits;
	config?: BudgetConfig;
	scope: 'run' | 'session';
}): BudgetLimits {
	const {cli, config, scope} = options;
	const configuredUsd =
		scope === 'run' ? config?.perRunUsd : config?.perSessionUsd;
	const maxBudgetUsd = cli?.maxBudgetUsd ?? configuredUsd;
	const maxTokensTotal = cli?.maxTokensTotal ?? config?.maxTokensTotal;
	const limits: BudgetLimits = {};
	if (isValidBudgetLimit(maxBudgetUsd)) {
		limits.maxBudgetUsd = maxBudgetUsd;
	}
	if (isValidBudgetLimit(maxTokensTotal)) {
		limits.maxTokensTotal = maxTokensTotal;
	}
	return limits;
}

function formatUsd(value: number): string {
	return `$${value.toFixed(2)}`;
}

function formatTokens(value: number): string {
	return value.toLocaleString('en-US');
}

/**
 * One-line running-total summary, e.g.
 * `$1.23 of $2.00 (62%) · 45,200 of 100,000 tokens`.
 * Unpriced models report the token side only and say the cost is unknown.
 */
export function formatBudgetSummary(
	totals: BudgetTotals,
	limits: BudgetLimits,
	model?: string,
): string {
	const parts: string[] = [];
	if (limits.maxBudgetUsd !== undefined) {
		if (totals.costKnown && totals.totalCostUsd !== undefined) {
			const percent = Math.round(
				(totals.totalCostUsd / limits.maxBudgetUsd) * 100,
			);
			parts.push(
				`${formatUsd(totals.totalCostUsd)} of ${formatUsd(limits.maxBudgetUsd)} (${percent}%)`,
			);
		} else {
			parts.push(
				`cost unknown${model ? ` for ${model}` : ''} (no price in models.dev) — $${limits.maxBudgetUsd.toFixed(2)} limit not enforced`,
			);
		}
	}
	if (limits.maxTokensTotal !== undefined) {
		const percent = Math.round(
			(totals.totalTokens / limits.maxTokensTotal) * 100,
		);
		parts.push(
			`${formatTokens(totals.totalTokens)} of ${formatTokens(limits.maxTokensTotal)} tokens (${percent}%)`,
		);
	}
	if (parts.length === 0) {
		return 'no budget limit set';
	}
	return parts.join(' · ');
}

/**
 * Accumulates usage for one run/session and checks it against the limits
 * after each response. Pricing is looked up once (memoized in the models
 * client) and bounded so a cold or offline models.dev fetch never holds up
 * the loop: a timed-out lookup prices this turn as unknown and the next
 * turn picks the memoized price up.
 */
export class BudgetTracker {
	private readonly limits: BudgetLimits;
	private model: string;
	private readonly getPricing: PricingLookup;
	private pricingPromise: Promise<TokenPricing | null> | null = null;
	private totalTokens = 0;
	private totalCostUsd: number | undefined;
	private warnedUsd = false;
	private warnedTokens = false;
	private continueOnceGranted = false;

	constructor(
		limits: BudgetLimits,
		model: string,
		getPricing: PricingLookup = getModelPricing,
	) {
		this.limits = {...limits};
		this.model = model;
		this.getPricing = getPricing;
	}

	/** The limits this tracker enforces (a copy). */
	getLimits(): BudgetLimits {
		return {...this.limits};
	}

	/** Whether any limit is configured at all. */
	hasLimits(): boolean {
		return (
			this.limits.maxBudgetUsd !== undefined ||
			this.limits.maxTokensTotal !== undefined
		);
	}

	getTotals(): BudgetTotals {
		return {
			totalTokens: this.totalTokens,
			totalCostUsd: this.totalCostUsd,
			costKnown: this.totalCostUsd !== undefined,
		};
	}

	/**
	 * Switch the model used for pricing (e.g. a mid-session model switch):
	 * later turns are priced at the new model's rates. Totals are untouched.
	 */
	setModel(model: string): void {
		if (model === this.model) {
			return;
		}
		this.model = model;
		this.pricingPromise = null;
	}

	/**
	 * Interactive escape hatch: let exactly one more response through even
	 * when a limit is already hit, then re-arm the check. Consumed by the
	 * next `recordResponse` call.
	 */
	grantContinueOnce(): void {
		this.continueOnceGranted = true;
	}

	/**
	 * Raise the limit(s) that are currently hit (doubling them) and re-arm
	 * their warnings, so the run can continue under a higher cap.
	 */
	raiseLimits(): BudgetLimits {
		if (
			this.limits.maxBudgetUsd !== undefined &&
			this.totalCostUsd !== undefined &&
			this.totalCostUsd >= this.limits.maxBudgetUsd
		) {
			this.limits.maxBudgetUsd = this.limits.maxBudgetUsd * 2;
			this.warnedUsd = false;
		}
		if (
			this.limits.maxTokensTotal !== undefined &&
			this.totalTokens >= this.limits.maxTokensTotal
		) {
			this.limits.maxTokensTotal = this.limits.maxTokensTotal * 2;
			this.warnedTokens = false;
		}
		return this.getLimits();
	}

	private async getPricingBounded(): Promise<TokenPricing | null> {
		if (!this.pricingPromise) {
			this.pricingPromise = this.getPricing(this.model).catch(() => null);
		}
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			return await Promise.race([
				this.pricingPromise,
				new Promise<null>(resolve => {
					timer = setTimeout(() => resolve(null), TIMEOUT_COST_LOOKUP_MS);
				}),
			]);
		} finally {
			clearTimeout(timer);
		}
	}

	/**
	 * Record one response's provider-reported usage and check the limits.
	 * Turns with no usable token fields leave the totals untouched.
	 */
	async recordResponse(usage: ApiUsage | undefined): Promise<BudgetCheck> {
		if (usage) {
			const turnTotal = getTotalTokens(usage);
			if (turnTotal !== null) {
				this.totalTokens += turnTotal;
			}
			if (this.limits.maxBudgetUsd !== undefined) {
				const pricing = await this.getPricingBounded();
				if (pricing) {
					const turnCost = calculateUsageCost(usage, pricing);
					if (turnCost !== undefined) {
						this.totalCostUsd = (this.totalCostUsd ?? 0) + turnCost;
					}
				}
			}
		}

		const totals = this.getTotals();
		const check: BudgetCheck = {
			status: 'ok',
			exceededLimit: null,
			warnedLimit: null,
			totals,
			limits: this.getLimits(),
		};

		// A granted one-more-turn bypasses this check exactly once.
		if (this.continueOnceGranted) {
			this.continueOnceGranted = false;
			return check;
		}

		// Exceeded wins over warning: at 100% the run stops before the next
		// request, so there is nothing left to warn about.
		if (
			this.limits.maxBudgetUsd !== undefined &&
			totals.totalCostUsd !== undefined &&
			totals.totalCostUsd >= this.limits.maxBudgetUsd
		) {
			check.status = 'exceeded';
			check.exceededLimit = 'usd';
			return check;
		}
		if (
			this.limits.maxTokensTotal !== undefined &&
			totals.totalTokens >= this.limits.maxTokensTotal
		) {
			check.status = 'exceeded';
			check.exceededLimit = 'tokens';
			return check;
		}

		const warnThreshold = BUDGET_WARNING_PERCENT / 100;
		const usdCrossedWarning =
			this.limits.maxBudgetUsd !== undefined &&
			!this.warnedUsd &&
			totals.totalCostUsd !== undefined &&
			totals.totalCostUsd >= this.limits.maxBudgetUsd * warnThreshold;
		const tokensCrossedWarning =
			this.limits.maxTokensTotal !== undefined &&
			!this.warnedTokens &&
			totals.totalTokens >= this.limits.maxTokensTotal * warnThreshold;
		// Report one warning per response (USD first); the other limit's
		// flag stays unset so its warning is reported on the next response
		// instead of being silently swallowed.
		if (usdCrossedWarning) {
			this.warnedUsd = true;
			check.status = 'warning';
			check.warnedLimit = 'usd';
		} else if (tokensCrossedWarning) {
			this.warnedTokens = true;
			check.status = 'warning';
			check.warnedLimit = 'tokens';
		}
		return check;
	}

	/** Human-readable stop message for the `exceeded` state. */
	formatExceededMessage(check: BudgetCheck): string {
		const summary = formatBudgetSummary(check.totals, check.limits, this.model);
		const limit =
			check.exceededLimit === 'usd'
				? `budget of ${formatUsd(check.limits.maxBudgetUsd as number)}`
				: `token limit of ${formatTokens(check.limits.maxTokensTotal as number)} tokens`;
		return (
			`Budget exceeded: spent ${summary}. ` +
			`Reached the ${limit} — stopping before the next request. ` +
			`Raise the limit (--max-budget-usd / --max-tokens-total or nanocoder.budget in agents.config.json) to continue.`
		);
	}

	/** Human-readable warning for a limit crossing 80%. */
	formatWarningMessage(check: BudgetCheck): string {
		const summary = formatBudgetSummary(check.totals, check.limits, this.model);
		return `Budget warning: ${summary}. The run will stop at 100%.`;
	}
}
