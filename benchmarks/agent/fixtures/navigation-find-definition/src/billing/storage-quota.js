import {planLimits} from './plans.js';

/** True when the account has used more storage than its plan allows. */
export function isOverStorageQuota(account) {
	const limit = planLimits[account.plan]?.storageBytes ?? 0;
	return account.usedBytes > limit;
}
