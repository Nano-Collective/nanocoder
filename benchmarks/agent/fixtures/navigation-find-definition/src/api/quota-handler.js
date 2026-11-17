import {isOverStorageQuota} from '../billing/storage-quota.js';

// Calls the decision but does not make it.
export function quotaHandler(account) {
	return isOverStorageQuota(account) ? 413 : 200;
}
