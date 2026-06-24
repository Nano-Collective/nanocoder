/**
 * Pure-TypeScript JSON tree data structures and mutation utilities.
 * No React dependencies — importable from components, config layers, or tests.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export type JsonKind =
	| 'null'
	| 'boolean'
	| 'number'
	| 'string'
	| 'object'
	| 'array';

export interface JsonNode {
	kind: JsonKind;
	/** Key name for object properties; undefined for array elements and root */
	key: string | undefined;
	/** Raw value for primitives */
	value: unknown;
	/** Child nodes for objects and arrays */
	children: JsonNode[];
	/** Depth from root (root = 0) */
	depth: number;
	/** Whether children are collapsed in the viewer */
	collapsed: boolean;
	/** Number of children (for objects/arrays) */
	size: number;
	/** 0-based index among siblings */
	index: number;
}

/** A single flattened row ready for rendering */
export interface JsonFlatRow {
	/** Dot-separated JSONPath (e.g. "nanocoder.tune.toolProfile") */
	path: string;
	/** Array of path segments */
	pathSegments: string[];
	/** Visual indentation level */
	indent: number;
	/** Display key (undefined for array elements) */
	key: string | undefined;
	/** Display value string */
	value: string;
	/** JSON kind for color-coding */
	kind: JsonKind;
	/** Whether this row can be expanded/collapsed */
	hasChildren: boolean;
	/** Whether children are currently collapsed */
	isCollapsed: boolean;
	/** Number of hidden children when collapsed */
	hiddenCount: number;
	/** 1-based line number in the flattened view */
	lineNumber: number;
	/** Trailing punctuation (",", "}", "]") */
	trailing: string;
}

// ─── Parsing ─────────────────────────────────────────────────────────────────

/**
 * Convert any JSON-serializable value into a JsonNode tree.
 */
export function parseJsonToTree(
	data: unknown,
	_key: string | undefined = undefined,
	_depth: number = 0,
	_index: number = 0,
): JsonNode {
	if (data === null) {
		return {
			kind: 'null',
			key: _key,
			value: null,
			children: [],
			depth: _depth,
			collapsed: false,
			size: 0,
			index: _index,
		};
	}
	if (typeof data === 'boolean') {
		return {
			kind: 'boolean',
			key: _key,
			value: data,
			children: [],
			depth: _depth,
			collapsed: false,
			size: 0,
			index: _index,
		};
	}
	if (typeof data === 'number') {
		return {
			kind: 'number',
			key: _key,
			value: data,
			children: [],
			depth: _depth,
			collapsed: false,
			size: 0,
			index: _index,
		};
	}
	if (typeof data === 'string') {
		return {
			kind: 'string',
			key: _key,
			value: data,
			children: [],
			depth: _depth,
			collapsed: false,
			size: 0,
			index: _index,
		};
	}
	if (Array.isArray(data)) {
		const children = data.map((item, i) =>
			parseJsonToTree(item, undefined, _depth + 1, i),
		);
		return {
			kind: 'array',
			key: _key,
			value: data,
			children,
			depth: _depth,
			collapsed: false,
			size: children.length,
			index: _index,
		};
	}
	if (typeof data === 'object') {
		const entries = Object.entries(data as Record<string, unknown>);
		const children = entries.map(([k, v], i) =>
			parseJsonToTree(v, k, _depth + 1, i),
		);
		return {
			kind: 'object',
			key: _key,
			value: data,
			children,
			depth: _depth,
			collapsed: false,
			size: children.length,
			index: _index,
		};
	}
	// Fallback for undefined or other edge cases
	return {
		kind: 'null',
		key: _key,
		value: data,
		children: [],
		depth: _depth,
		collapsed: false,
		size: 0,
		index: _index,
	};
}

// ─── Flattening ──────────────────────────────────────────────────────────────

/**
 * Flatten a JsonNode tree into an array of renderable rows.
 * Respects collapsed state — collapsed nodes show a single summary row.
 */
export function flattenTree(root: JsonNode): JsonFlatRow[] {
	const rows: JsonFlatRow[] = [];
	let lineNumber = 0;
	flattenNode(root, [], rows, () => ++lineNumber, false);
	return rows;
}

function flattenNode(
	node: JsonNode,
	pathSegments: string[],
	rows: JsonFlatRow[],
	nextLine: () => number,
	isLast: boolean,
): void {
	const path = buildPath(pathSegments);
	const trailing = isLast ? '' : ',';

	if (node.kind === 'object' || node.kind === 'array') {
		const openBracket = node.kind === 'object' ? '{' : '[';
		const closeBracket = node.kind === 'object' ? '}' : ']';

		if (node.collapsed) {
			// Single collapsed row: { ... } or [ ... ]
			rows.push({
				path,
				pathSegments: [...pathSegments],
				indent: node.depth,
				key: node.key,
				value: `${openBracket} ... ${closeBracket}`,
				kind: node.kind,
				hasChildren: true,
				isCollapsed: true,
				hiddenCount: node.size,
				lineNumber: nextLine(),
				trailing,
			});
		} else {
			// Open bracket row
			rows.push({
				path,
				pathSegments: [...pathSegments],
				indent: node.depth,
				key: node.key,
				value: openBracket,
				kind: node.kind,
				hasChildren: true,
				isCollapsed: false,
				hiddenCount: 0,
				lineNumber: nextLine(),
				trailing,
			});

			// Children
			node.children.forEach((child, i) => {
				const childPath =
					node.kind === 'array'
						? [...pathSegments, `[${i}]`]
						: [...pathSegments, child.key ?? ''];
				const childIsLast = i === node.children.length - 1;
				flattenNode(child, childPath, rows, nextLine, childIsLast);
			});

			// Close bracket row
			rows.push({
				path,
				pathSegments: [...pathSegments],
				indent: node.depth,
				key: undefined,
				value: closeBracket,
				kind: node.kind,
				hasChildren: false,
				isCollapsed: false,
				hiddenCount: 0,
				lineNumber: nextLine(),
				trailing,
			});
		}
	} else {
		// Primitive row
		rows.push({
			path,
			pathSegments: [...pathSegments],
			indent: node.depth,
			key: node.key,
			value: formatValue(node.value, node.kind),
			kind: node.kind,
			hasChildren: false,
			isCollapsed: false,
			hiddenCount: 0,
			lineNumber: nextLine(),
			trailing,
		});
	}
}

function buildPath(segments: string[]): string {
	if (segments.length === 0) return '$';
	return segments
		.map(seg => {
			// Array indices: $.items[0]
			if (/^\[\d+\]$/.test(seg)) {
				return seg;
			}
			// Object keys with dots: $.key.name
			return seg;
		})
		.join('');
}

function formatValue(value: unknown, kind: JsonKind): string {
	if (kind === 'null') return 'null';
	if (kind === 'boolean') return String(value);
	if (kind === 'number') return String(value);
	if (kind === 'string') return `"${value}"`;
	return String(value);
}

// ─── Path Utilities ──────────────────────────────────────────────────────────

/**
 * Find a node by its path segments in the tree.
 */
export function findNodeByPath(
	root: JsonNode,
	segments: string[],
): JsonNode | null {
	if (segments.length === 0) return root;

	const [first, ...rest] = segments;

	if (root.kind === 'array') {
		const match = first.match(/^\[(\d+)\]$/);
		if (!match) return null;
		const idx = parseInt(match[1], 10);
		const child = root.children[idx];
		if (!child) return null;
		return rest.length === 0 ? child : findNodeByPath(child, rest);
	}

	if (root.kind === 'object') {
		const child = root.children.find(c => c.key === first);
		if (!child) return null;
		return rest.length === 0 ? child : findNodeByPath(child, rest);
	}

	return null;
}

/**
 * Get the raw value at a path in the original data.
 */
export function getValueAtPath(data: unknown, segments: string[]): unknown {
	if (segments.length === 0) return data;
	const [first, ...rest] = segments;

	if (Array.isArray(data)) {
		const match = first.match(/^\[(\d+)\]$/);
		if (!match) return undefined;
		const idx = parseInt(match[1], 10);
		return getValueAtPath(data[idx], rest);
	}

	if (data && typeof data === 'object') {
		return getValueAtPath((data as Record<string, unknown>)[first], rest);
	}

	return undefined;
}

/**
 * Parse a `key: value` input string from the add-sibling flow.
 * Returns `{ key, value }` where `value` is the parsed JSON value.
 *
 * Supports:
 *   - `myKey`            → { key: 'myKey', value: null }
 *   - `myKey: hello`     → { key: 'myKey', value: 'hello' }
 *   - `myKey: 42`        → { key: 'myKey', value: 42 }
 *   - `myKey: {}`        → { key: 'myKey', value: {} }
 *   - `myKey: {a: 1}`    → { key: 'myKey', value: { a: 1 } }  (lenient)
 *   - `myKey: [1,2,3]`   → { key: 'myKey', value: [1, 2, 3] }
 */
export function parseKeyValueInput(input: string): {
	key: string;
	value: unknown;
} {
	const trimmed = input.trim();
	if (trimmed.length === 0) {
		return {key: 'newKey', value: null};
	}

	// Split on the first colon to separate key from value
	const colonIndex = trimmed.indexOf(':');
	if (colonIndex === -1) {
		// No colon — treat entire input as the key with null value
		return {key: trimmed.trim(), value: null};
	}

	const key = trimmed.slice(0, colonIndex).trim();
	const rawValue = trimmed.slice(colonIndex + 1).trim();

	// No value after colon
	if (rawValue.length === 0) {
		return {key: key || 'newKey', value: null};
	}

	// Try strict JSON.parse first
	try {
		return {key: key || 'newKey', value: JSON.parse(rawValue)};
	} catch {}

	// Lenient parsing for bare {key: value} or [value] patterns
	const lenient = tryLenientParse(rawValue);
	if (lenient !== null) {
		return {key: key || 'newKey', value: lenient};
	}

	// Fallback: treat as a plain string
	return {key: key || 'newKey', value: rawValue};
}

/**
 * Attempt to parse a value that looks like JSON but may have unquoted keys
 * or unquoted string values, e.g. `{a: 1, b: hello}` or `[one, two]`.
 * Returns null if the input doesn't look like a structured value.
 */
function tryLenientParse(input: string): unknown {
	const trimmed = input.trim();

	// Only attempt lenient parsing for object/array literals
	if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) {
		return null;
	}

	// Transform: quote unquoted keys and unquoted string values
	// Strategy: wrap bare identifiers in quotes
	let transformed = lenifyJson(trimmed);

	try {
		return JSON.parse(transformed);
	} catch {
		return null;
	}
}

/**
 * Transform lenient JSON-like input into valid JSON by quoting
 * unquoted keys and string values.
 */
function lenifyJson(input: string): string {
	const result: string[] = [];
	let i = 0;
	let inString = false;
	let expectColon = false;
	let afterColon = true;
	let _depth = 0;

	while (i < input.length) {
		const ch = input[i];

		if (inString) {
			result.push(ch);
			if (ch === '\\' && i + 1 < input.length) {
				i++;
				result.push(input[i]);
			} else if (ch === '"') {
				inString = false;
			}
			i++;
			continue;
		}

		// Outside a string
		if (ch === '"') {
			inString = true;
			result.push(ch);
			i++;
			continue;
		}

		if (ch === '{' || ch === '[') {
			_depth++;
			result.push(ch);
			expectColon = false;
			afterColon = false;
			i++;
			continue;
		}

		if (ch === '}' || ch === ']') {
			_depth--;
			result.push(ch);
			i++;
			continue;
		}

		if (ch === ':') {
			expectColon = true;
			afterColon = true;
			result.push(ch);
			i++;
			continue;
		}

		if (ch === ',') {
			result.push(ch);
			expectColon = false;
			afterColon = false;
			i++;
			continue;
		}

		// Skip whitespace
		if (/\s/.test(ch)) {
			result.push(ch);
			i++;
			continue;
		}

		// Read a bare token (unquoted identifier or literal)
		const tokenStart = i;
		while (
			i < input.length &&
			!'{}[]:,"'.includes(input[i]) &&
			!/\s/.test(input[i])
		) {
			i++;
		}
		const token = input.slice(tokenStart, i);

		if (token.length === 0) {
			i++;
			continue;
		}

		// Determine if this token needs quoting
		if (expectColon || afterColon) {
			// This is a value position
			const parsed = tryParseLiteral(token);
			if (parsed !== null) {
				// It's a known literal (true, false, null, number)
				result.push(token);
			} else {
				// It's an unquoted string value
				result.push(`"${escapeJsonString(token)}"`);
			}
			expectColon = false;
			afterColon = false;
		} else {
			// This is a key position (inside an object)
			const parsed = tryParseLiteral(token);
			if (parsed !== null) {
				// It's a literal used as a key — quote it
				result.push(`"${escapeJsonString(token)}"`);
			} else {
				// Bare identifier key
				result.push(`"${escapeJsonString(token)}"`);
			}
		}
	}

	return result.join('');
}

/**
 * Try to parse a token as a JSON literal (number, boolean, null).
 * Returns the parsed value or null if it's not a known literal.
 */
function tryParseLiteral(token: string): unknown {
	if (token === 'true') return true;
	if (token === 'false') return false;
	if (token === 'null') return null;
	if (/^-?\d+\.?\d*$/.test(token)) return Number(token);
	return null;
}

/** Escape a string for JSON embedding */
function escapeJsonString(s: string): string {
	return s
		.replace(/\\/g, '\\\\')
		.replace(/"/g, '\\"')
		.replace(/\n/g, '\\n')
		.replace(/\r/g, '\\r')
		.replace(/\t/g, '\\t');
}

// ─── Mutations ───────────────────────────────────────────────────────────────

/**
 * Toggle collapsed state of a node at the given path.
 */
export function toggleCollapse(root: JsonNode, segments: string[]): JsonNode {
	if (segments.length === 0) {
		return cloneNode({...root, collapsed: !root.collapsed});
	}

	const [first, ...rest] = segments;

	if (root.kind === 'array') {
		const match = first.match(/^\[(\d+)\]$/);
		if (!match) return root;
		const idx = parseInt(match[1], 10);
		const newChildren = [...root.children];
		newChildren[idx] = toggleCollapse(newChildren[idx], rest);
		return cloneNode({...root, children: newChildren});
	}

	if (root.kind === 'object') {
		const newChildren = root.children.map(child => {
			if (child.key === first) {
				return toggleCollapse(child, rest);
			}
			return child;
		});
		return cloneNode({...root, children: newChildren});
	}

	return root;
}

/**
 * Collapse all nodes beyond the given depth.
 */
export function collapseBeyondDepth(
	root: JsonNode,
	maxDepth: number,
): JsonNode {
	return cloneNode(collapseNodeAtDepth(root, 0, maxDepth));
}

function collapseNodeAtDepth(
	node: JsonNode,
	currentDepth: number,
	maxDepth: number,
): JsonNode {
	if (node.kind !== 'object' && node.kind !== 'array') {
		return node;
	}

	const shouldCollapse = currentDepth >= maxDepth;

	const newChildren = node.children.map(child =>
		collapseNodeAtDepth(child, currentDepth + 1, maxDepth),
	);

	return cloneNode({
		...node,
		collapsed: shouldCollapse || node.collapsed,
		children: newChildren,
	});
}

/**
 * Set a primitive value at the given path.
 * Returns a new tree with the updated value.
 */
export function setValueAtPath(
	root: JsonNode,
	segments: string[],
	newValue: unknown,
): JsonNode {
	if (segments.length === 0) {
		// Replace entire root
		return parseJsonToTree(newValue);
	}

	const [first, ...rest] = segments;

	if (root.kind === 'array') {
		const match = first.match(/^\[(\d+)\]$/);
		if (!match) return root;
		const idx = parseInt(match[1], 10);
		const newChildren = [...root.children];
		if (rest.length === 0) {
			newChildren[idx] = parseJsonToTree(
				newValue,
				undefined,
				root.depth + 1,
				idx,
			);
		} else {
			newChildren[idx] = setValueAtPath(newChildren[idx], rest, newValue);
		}
		return cloneNode({
			...root,
			children: newChildren,
			value: newChildren,
			size: newChildren.length,
		});
	}

	if (root.kind === 'object') {
		const newChildren = root.children.map(child => {
			if (child.key === first) {
				if (rest.length === 0) {
					return parseJsonToTree(newValue, first, root.depth + 1, child.index);
				}
				return setValueAtPath(child, rest, newValue);
			}
			return child;
		});
		const newValueObj = objectFromChildren(newChildren);
		return cloneNode({
			...root,
			children: newChildren,
			value: newValueObj,
			size: newChildren.length,
		});
	}

	return root;
}

/**
 * Add a new sibling after the node at the given path.
 * `parsedEntry` contains the key and (optionally) value to insert.
 * For arrays: `key` is ignored and `value` is used.
 */
export function addSibling(
	root: JsonNode,
	segments: string[],
	parsedEntry: {key: string; value: unknown},
): JsonNode {
	if (root.kind !== 'object' && root.kind !== 'array') {
		return root;
	}

	// If segments is empty, add to root
	if (segments.length === 0) {
		return addToRoot(root, parsedEntry);
	}

	const [first, ...rest] = segments;

	if (root.kind === 'array') {
		const match = first.match(/^\[(\d+)\]$/);
		if (!match) return root;
		const idx = parseInt(match[1], 10);
		const newChildren = [...root.children];

		if (rest.length === 0) {
			// Add after the matched index
			const newNode = parseJsonToTree(
				parsedEntry.value,
				undefined,
				root.depth + 1,
				idx + 1,
			);
			newChildren.splice(idx + 1, 0, newNode);
			// Re-index
			const reindexed = newChildren.map((c, i) => cloneNode({...c, index: i}));
			return cloneNode({
				...root,
				children: reindexed,
				value: reindexed,
				size: reindexed.length,
			});
		}

		newChildren[idx] = addSibling(newChildren[idx], rest, parsedEntry);
		const newValueArr = arrayFromChildren(newChildren);
		return cloneNode({
			...root,
			children: newChildren,
			value: newValueArr,
			size: newChildren.length,
		});
	}

	if (root.kind === 'object') {
		// First, check if we're adding at this level (rest.length === 0)
		if (rest.length === 0) {
			const newChildren: JsonNode[] = [];
			for (const child of root.children) {
				newChildren.push(child);
				if (child.key === first) {
					const newNode = parseJsonToTree(
						parsedEntry.value,
						parsedEntry.key,
						root.depth + 1,
						newChildren.length,
					);
					newChildren.push(newNode);
				}
			}
			const newValueObj = objectFromChildren(newChildren);
			return cloneNode({
				...root,
				children: newChildren,
				value: newValueObj,
				size: newChildren.length,
			});
		}

		// Descend into the matched child
		const newChildren = root.children.map(child => {
			if (child.key === first) {
				return addSibling(child, rest, parsedEntry);
			}
			return child;
		});
		const newValueObj = objectFromChildren(newChildren);
		return cloneNode({
			...root,
			children: newChildren,
			value: newValueObj,
			size: newChildren.length,
		});
	}

	return root;
}

/**
 * Delete the node at the given path.
 */
export function deleteAtPath(root: JsonNode, segments: string[]): JsonNode {
	if (segments.length === 0) {
		return parseJsonToTree(null);
	}

	const [first, ...rest] = segments;

	if (root.kind === 'array') {
		const match = first.match(/^\[(\d+)\]$/);
		if (!match) return root;
		const idx = parseInt(match[1], 10);

		if (rest.length === 0) {
			const newChildren = root.children.filter((_, i) => i !== idx);
			const reindexed = newChildren.map((c, i) => cloneNode({...c, index: i}));
			return cloneNode({
				...root,
				children: reindexed,
				value: reindexed,
				size: reindexed.length,
			});
		}

		const newChildren = [...root.children];
		newChildren[idx] = deleteAtPath(newChildren[idx], rest);
		const newValueArr = arrayFromChildren(newChildren);
		return cloneNode({
			...root,
			children: newChildren,
			value: newValueArr,
			size: newChildren.length,
		});
	}

	if (root.kind === 'object') {
		if (rest.length === 0) {
			const newChildren = root.children.filter(c => c.key !== first);
			const newValueObj = objectFromChildren(newChildren);
			return cloneNode({
				...root,
				children: newChildren,
				value: newValueObj,
				size: newChildren.length,
			});
		}

		const newChildren = root.children.map(child => {
			if (child.key === first) {
				return deleteAtPath(child, rest);
			}
			return child;
		});
		const newValueObj = objectFromChildren(newChildren);
		return cloneNode({
			...root,
			children: newChildren,
			value: newValueObj,
			size: newChildren.length,
		});
	}

	return root;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function addToRoot(
	root: JsonNode,
	parsedEntry: {key: string; value: unknown},
): JsonNode {
	if (root.kind === 'object') {
		const newNode = parseJsonToTree(
			parsedEntry.value,
			parsedEntry.key,
			root.depth + 1,
			root.children.length,
		);
		const newChildren = [...root.children, newNode];
		const newValueObj = objectFromChildren(newChildren);
		return cloneNode({
			...root,
			children: newChildren,
			value: newValueObj,
			size: newChildren.length,
		});
	}
	if (root.kind === 'array') {
		const newNode = parseJsonToTree(
			parsedEntry.value,
			undefined,
			root.depth + 1,
			root.children.length,
		);
		const newChildren = [...root.children, newNode];
		return cloneNode({
			...root,
			children: newChildren,
			value: newChildren,
			size: newChildren.length,
		});
	}
	return root;
}

function cloneNode(node: JsonNode): JsonNode {
	return {
		kind: node.kind,
		key: node.key,
		value: node.value,
		children: node.children,
		depth: node.depth,
		collapsed: node.collapsed,
		size: node.size,
		index: node.index,
	};
}

function objectFromChildren(children: JsonNode[]): Record<string, unknown> {
	const obj: Record<string, unknown> = {};
	for (const child of children) {
		if (child.key !== undefined) {
			obj[child.key] = extractRawValue(child);
		}
	}
	return obj;
}

function arrayFromChildren(children: JsonNode[]): unknown[] {
	return children.map(child => extractRawValue(child));
}

function extractRawValue(node: JsonNode): unknown {
	if (node.kind === 'object') {
		return objectFromChildren(node.children);
	}
	if (node.kind === 'array') {
		return arrayFromChildren(node.children);
	}
	return node.value;
}

/**
 * Extract the raw JSON-serializable value from a JsonNode tree.
 */
export function extractTreeValue(root: JsonNode): unknown {
	return extractRawValue(root);
}
