import {planLimits} from './plans.js';

/** Seats, not storage: a similarly named neighbour of the real answer. */
export function isOverSeatQuota(account) {
	const limit = planLimits[account.plan]?.seats ?? 0;
	return account.seats > limit;
}
