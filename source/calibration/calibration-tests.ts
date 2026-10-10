import type {CalibrationTestDefinition} from '@/types/calibration';

export const CALIBRATION_TESTS: CalibrationTestDefinition[] = [
	{
		id: 'json_schema',
		name: 'JSON Schema Adherence',
		description:
			'Tests if the model can generate strictly conforming JSON without markdown wrappers or conversational filler.',
		prompt:
			'Respond ONLY with a valid raw JSON object conforming to this exact schema: {"status": "ok", "code": 200, "items": ["alpha", "beta"]}. Do not include markdown code blocks, backticks, or any additional text.',
		validate: (response: string) => {
			const trimmed = response.trim();
			const hasFences =
				trimmed.startsWith('```') || trimmed.includes('```json');
			const cleanJson = trimmed
				.replace(/^```json\s*|^```\s*|```$/gi, '')
				.trim();

			try {
				const parsed = JSON.parse(cleanJson) as Record<string, unknown>;
				const hasValidStatus = parsed.status === 'ok';
				const hasValidCode = parsed.code === 200;
				const hasValidItems =
					Array.isArray(parsed.items) &&
					parsed.items.length === 2 &&
					parsed.items[0] === 'alpha' &&
					parsed.items[1] === 'beta';

				if (hasValidStatus && hasValidCode && hasValidItems) {
					if (hasFences) {
						return {
							passed: true,
							score: 80,
							details: 'Valid JSON but contained markdown codeblock fences.',
						};
					}
					return {
						passed: true,
						score: 100,
						details: 'Strict JSON adherence satisfied.',
					};
				}
				return {
					passed: false,
					score: 40,
					details:
						'JSON parsed but schema fields did not match expected values.',
				};
			} catch {
				return {
					passed: false,
					score: 0,
					details: 'Failed to parse response as JSON.',
				};
			}
		},
	},
	{
		id: 'instruction_following',
		name: 'Multi-Constraint Instruction Following',
		description:
			'Tests adherence to line count, prefix constraints, and positional keywords.',
		prompt:
			'Follow these rules strictly:\n1. Output exactly 3 lines.\n2. Each line must start with "- item_".\n3. The word "CALIBRATE" in uppercase must appear on line 2 only.\n4. Output nothing else.',
		validate: (response: string) => {
			const lines = response
				.trim()
				.split('\n')
				.map(l => l.trim())
				.filter(Boolean);

			if (lines.length !== 3) {
				return {
					passed: false,
					score: Math.max(0, 100 - Math.abs(lines.length - 3) * 30),
					details: `Expected exactly 3 lines, got ${lines.length}.`,
				};
			}

			let score = 30; // base score for 3 lines
			const allPrefixed = lines.every(l => l.startsWith('- item_'));
			if (allPrefixed) {
				score += 35;
			}

			const line2HasKeyword = lines[1]?.includes('CALIBRATE') ?? false;
			const line1HasKeyword = lines[0]?.includes('CALIBRATE') ?? false;
			const line3HasKeyword = lines[2]?.includes('CALIBRATE') ?? false;

			if (line2HasKeyword && !line1HasKeyword && !line3HasKeyword) {
				score += 35;
			}

			const passed = score >= 80;
			return {
				passed,
				score,
				details: passed
					? 'All negative/positive instruction constraints satisfied.'
					: `Partial compliance (score: ${score}/100).`,
			};
		},
	},
	{
		id: 'tool_syntax_matching',
		name: 'Tool Delimiter & XML Formatting',
		description:
			'Tests exact reproduction of XML tool-call delimiters and attribute syntax.',
		prompt:
			'Format a tool call using exact XML tags: <tool_call name="read_file"><path>source/app.tsx</path></tool_call>. Output ONLY this XML block without any explanation or markdown formatting.',
		validate: (response: string) => {
			const trimmed = response.trim();
			const xmlMatch =
				/<tool_call\s+name="read_file">\s*<path>source\/app\.tsx<\/path>\s*<\/tool_call>/i.test(
					trimmed,
				);

			if (xmlMatch) {
				const hasSurroundingFluff =
					!trimmed.startsWith('<tool_call') ||
					!trimmed.endsWith('</tool_call>');
				if (hasSurroundingFluff) {
					return {
						passed: true,
						score: 75,
						details:
							'Valid XML tool call but included surrounding text/markdown.',
					};
				}
				return {
					passed: true,
					score: 100,
					details: 'Exact XML tool call formatting matched.',
				};
			}

			// Partial checks
			const hasToolCallTag = /<tool_call[^>]*>/i.test(trimmed);
			const hasPathTag = /<path>[^<]+<\/path>/i.test(trimmed);

			if (hasToolCallTag && hasPathTag) {
				return {
					passed: false,
					score: 50,
					details:
						'Tags present but syntax or attributes deviated from template.',
				};
			}

			return {
				passed: false,
				score: 0,
				details: 'Failed to generate expected XML tool call structure.',
			};
		},
	},
];
