/**
 * BoundedMap - A Map with size and TTL constraints to prevent unbounded memory growth
 *
 * Features:
 * - Maximum size limit with automatic eviction of oldest entries
 * - Optional TTL (time-to-live) for automatic expiration
 * - Maintains insertion order for predictable eviction
 */

interface BoundedMapEntry<V> {
	value: V;
	timestamp: number;
}

export interface BoundedMapOptions {
	/**
	 * Maximum number of entries. When exceeded, oldest entries are removed.
	 * @default 1000
	 */
	maxSize?: number;

	/**
	 * Time-to-live in milliseconds. Entries older than this are automatically removed.
	 * Set to 0 or undefined to disable TTL.
	 * @default undefined (no TTL)
	 */
	ttl?: number;
}

/**
 * A Map implementation with automatic size limiting and optional TTL
 */
export class BoundedMap<K, V> {
	private map: Map<K, BoundedMapEntry<V>>;
	private maxSize: number;
	private ttl?: number;

	constructor(options: BoundedMapOptions = {}) {
		this.map = new Map();
		this.maxSize = options.maxSize ?? 1000;
		this.ttl = options.ttl;

		if (this.maxSize <= 0) {
			throw new Error('maxSize must be greater than 0');
		}
	}

	/**
	 * Set a key-value pair, enforcing size limit
	 */
	set(key: K, value: V): this {
		// Remove oldest entry if at capacity (skip when overwriting an
		// existing key — an overwrite must not evict a different entry)
		if (this.map.size >= this.maxSize && !this.map.has(key)) {
			const firstKey = this.map.keys().next().value;
			if (firstKey !== undefined) {
				this.map.delete(firstKey);
			}
		}

		// Bump access order on overwrite: deleting before re-inserting moves
		// the key to the most-recent position, so a frequently-overwritten key
		// is not left at the oldest position and prematurely evicted.
		if (this.map.has(key)) {
			this.map.delete(key);
		}

		this.map.set(key, {
			value,
			timestamp: Date.now(),
		});

		return this;
	}

	/**
	 * Get a value by key, checking TTL if configured
	 */
	get(key: K): V | undefined {
		const entry = this.map.get(key);
		if (!entry) {
			return undefined;
		}

		// Check TTL if configured
		if (this.ttl !== undefined && this.ttl > 0) {
			const age = Date.now() - entry.timestamp;
			if (age > this.ttl) {
				this.map.delete(key);
				return undefined;
			}
		}

		return entry.value;
	}

	/**
	 * Check if key exists and is not expired
	 */
	has(key: K): boolean {
		const entry = this.map.get(key);
		if (!entry) {
			return false;
		}

		// Check TTL if configured
		if (this.ttl !== undefined && this.ttl > 0) {
			const age = Date.now() - entry.timestamp;
			if (age > this.ttl) {
				this.map.delete(key);
				return false;
			}
		}

		return true;
	}

	/**
	 * Delete a key-value pair
	 */
	delete(key: K): boolean {
		return this.map.delete(key);
	}

	/**
	 * Clear all entries
	 */
	clear(): void {
		this.map.clear();
	}

	/**
	 * Get number of entries (including potentially expired ones)
	 */
	get size(): number {
		return this.map.size;
	}

	/**
	 * Get all non-expired keys
	 */
	keys(): IterableIterator<K> {
		this.cleanupExpired();
		return this.map.keys();
	}

	/**
	 * Get all non-expired values
	 */
	*values(): IterableIterator<V> {
		this.cleanupExpired();
		for (const entry of this.map.values()) {
			yield entry.value;
		}
	}

	/**
	 * Get all non-expired entries as [key, value] pairs
	 */
	*entries(): IterableIterator<[K, V]> {
		this.cleanupExpired();
		for (const [key, entry] of this.map.entries()) {
			yield [key, entry.value];
		}
	}

	/**
	 * Iterate over non-expired entries
	 */
	forEach(
		callbackfn: (value: V, key: K, map: BoundedMap<K, V>) => void,
		thisArg?: unknown,
	): void {
		this.cleanupExpired();
		for (const [key, entry] of this.map.entries()) {
			callbackfn.call(thisArg, entry.value, key, this);
		}
	}

	/**
	 * Remove all expired entries based on TTL
	 */
	private cleanupExpired(): void {
		if (!this.ttl || this.ttl <= 0) {
			return;
		}

		const now = Date.now();
		const keysToDelete: K[] = [];

		for (const [key, entry] of this.map.entries()) {
			if (now - entry.timestamp > this.ttl) {
				keysToDelete.push(key);
			}
		}

		for (const key of keysToDelete) {
			this.map.delete(key);
		}
	}

	/**
	 * Get all entries including expired ones (for debugging)
	 */
	getRawSize(): number {
		return this.map.size;
	}

	/**
	 * Make BoundedMap iterable
	 */
	[Symbol.iterator](): IterableIterator<[K, V]> {
		return this.entries();
	}
}
