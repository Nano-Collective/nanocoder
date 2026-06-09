/**
 * Body-level lint for skill members. The frontmatter parsers validate
 * structure; this validates the template body - the part that actually runs.
 * These checks catch the failure class the parsers can't see: a tool body
 * using a mustache tag the engine doesn't render, or a placeholder that
 * resolves to nothing because it was never declared as a parameter.
 *
 * Tool bodies (source/custom-tools/template.ts) support:
 *   {{ name }}                shell-quoted substitution
 *   {{# name }}…{{/ name }}   section (rendered when truthy)
 *   {{^ name }}…{{/ name }}   inverted section (rendered when falsy)
 *
 * Command bodies (source/custom-commands/executor.ts) support:
 *   {{ name }}                plain substitution (not shell-quoted)
 *   {{# name }}…{{/ name }}   section / inverted section (same engine as tools)
 * with the built-in variables cwd, command, and args available alongside the
 * declared positional parameters.
 */

export interface BodyIssue {
	severity: 'error' | 'warning';
	message: string;
}

const IDENT = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
/** Matches a single mustache tag, capturing its sigil (#, ^, /) and inner name. */
const TAG_RE = /\{\{([#^/]?)\s*([^{}]*?)\s*\}\}/g;
/** Mustache sigils for tags neither engine supports: &, >, !, =. */
const UNSUPPORTED_SIGIL = /^[&>!=]/;

const COMMAND_BUILTINS = ['cwd', 'command', 'args'];

/**
 * Lint a custom-tool script body against its declared parameter names.
 */
export function lintToolBody(
	body: string,
	declaredParams: string[],
): BodyIssue[] {
	const issues: BodyIssue[] = [];
	const declared = new Set(declaredParams);

	if (body.includes('{{{')) {
		issues.push({
			severity: 'error',
			message:
				'Unescaped-output tags ({{{ }}}) are not supported. Use {{ name }} - values are already shell-quoted.',
		});
	}

	const openStack: string[] = [];
	for (const match of body.matchAll(TAG_RE)) {
		const sigil = match[1] ?? '';
		const name = match[2] ?? '';

		if (sigil === '#' || sigil === '^') {
			if (!IDENT.test(name)) {
				issues.push({
					severity: 'error',
					message: `Malformed section tag {{${sigil} ${name} }}.`,
				});
				continue;
			}
			openStack.push(name);
			if (!declared.has(name)) {
				issues.push({
					severity: 'error',
					message: `Section {{${sigil} ${name} }} references "${name}", which is not a declared parameter.`,
				});
			}
		} else if (sigil === '/') {
			const open = openStack.pop();
			if (open !== name) {
				issues.push({
					severity: 'error',
					message: `Unbalanced closing tag {{/ ${name} }}${open ? ` (expected {{/ ${open} }})` : ' (no matching section)'}.`,
				});
			}
		} else if (UNSUPPORTED_SIGIL.test(name)) {
			issues.push({
				severity: 'error',
				message: `Unsupported tag {{${name}}}. The tool engine supports only {{ var }}, {{# section }}, {{^ section }}, and {{/ section }}.`,
			});
		} else if (!IDENT.test(name)) {
			issues.push({
				severity: 'error',
				message: `Malformed tag {{ ${name} }}.`,
			});
		} else if (!declared.has(name)) {
			issues.push({
				severity: 'error',
				message: `Body references {{ ${name} }}, which is not a declared parameter, so it renders empty. Add "${name}" under "parameters:", or remove the reference.`,
			});
		}
	}

	for (const open of openStack) {
		issues.push({
			severity: 'error',
			message: `Unclosed section {{# ${open} }} (missing {{/ ${open} }}).`,
		});
	}

	return issues;
}

export interface CommandBodyLintOptions {
	/**
	 * True when the frontmatter has a `parameters:` key but it did NOT parse to
	 * a list of names. This is almost always the custom-tool parameter format
	 * (a typed mapping) used by mistake - the command parser silently drops it,
	 * so the placeholders look undeclared. We call that out explicitly.
	 */
	parametersMalformed?: boolean;
}

/** How command parameters are declared - referenced by several messages. */
const COMMAND_PARAM_HINT =
	'Command parameters are a positional list of names: `parameters: [pr_number, issue_number]` (then {{ pr_number }} is the 1st argument). This is NOT the custom-tool format - commands have no per-parameter `type`/`required` mapping.';

/**
 * Lint a custom-command prompt body. Command bodies support {{ name }}
 * substitution plus {{# name }} / {{^ name }} sections; every referenced name
 * must be a declared parameter (the part before any `=default`) or a built-in.
 * `declaredParams` should already be stripped to bare names.
 */
export function lintCommandBody(
	content: string,
	declaredParams: string[],
	opts: CommandBodyLintOptions = {},
): BodyIssue[] {
	const issues: BodyIssue[] = [];
	const declared = Array.isArray(declaredParams) ? declaredParams : [];
	const known = new Set([...COMMAND_BUILTINS, ...declared]);

	if (opts.parametersMalformed) {
		issues.push({
			severity: 'error',
			message: `The "parameters:" block is not a list of names, so it is ignored and the placeholders below are undeclared. ${COMMAND_PARAM_HINT}`,
		});
	}

	if (content.includes('{{{')) {
		issues.push({
			severity: 'error',
			message:
				'Unescaped-output tags ({{{ }}}) are not supported in command bodies.',
		});
	}

	const openStack: string[] = [];
	let sawUndeclared = false;
	for (const match of content.matchAll(TAG_RE)) {
		const sigil = match[1] ?? '';
		const name = match[2] ?? '';

		if (sigil === '#' || sigil === '^') {
			if (!IDENT.test(name)) {
				issues.push({
					severity: 'error',
					message: `Malformed section tag {{${sigil} ${name} }} in command body.`,
				});
				continue;
			}
			openStack.push(name);
			if (!known.has(name)) {
				sawUndeclared = true;
				issues.push({
					severity: 'error',
					message: `Section {{${sigil} ${name} }} references "${name}", which is not a declared parameter or a built-in (cwd, command, args).`,
				});
			}
		} else if (sigil === '/') {
			const open = openStack.pop();
			if (open !== name) {
				issues.push({
					severity: 'error',
					message: `Unbalanced closing tag {{/ ${name} }}${open ? ` (expected {{/ ${open} }})` : ' (no matching section)'} in command body.`,
				});
			}
		} else if (UNSUPPORTED_SIGIL.test(name)) {
			issues.push({
				severity: 'error',
				message: `Unsupported tag {{${name}}} in command body.`,
			});
		} else if (!IDENT.test(name)) {
			issues.push({
				severity: 'error',
				message: `Malformed tag {{ ${name} }} in command body.`,
			});
		} else if (!known.has(name)) {
			sawUndeclared = true;
			issues.push({
				severity: 'error',
				message: `Body references {{ ${name} }}, which is not a declared parameter or a built-in (cwd, command, args).`,
			});
		}
	}

	for (const open of openStack) {
		issues.push({
			severity: 'error',
			message: `Unclosed section {{# ${open} }} (missing {{/ ${open} }}) in command body.`,
		});
	}

	// One guidance line that teaches the fix, rather than repeating the syntax
	// on every placeholder. Skip it if the malformed-block message already
	// carried the same hint.
	if (sawUndeclared && !opts.parametersMalformed) {
		issues.push({
			severity: 'error',
			message: `How to fix: ${COMMAND_PARAM_HINT}`,
		});
	}

	return issues;
}
