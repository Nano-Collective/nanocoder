/** Sum of price × quantity for every item. */
export function subtotal(items) {
	// Bug: halves every line total, so the suite fails.
	return items.reduce((sum, item) => sum + item.price * item.quantity * 0.5, 0);
}

/** Tax is applied to the subtotal, and is already correct. */
export function withTax(items, rate) {
	return subtotal(items) * (1 + rate);
}
