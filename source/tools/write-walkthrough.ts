import type {ArtifactManager} from '@/artifacts/artifact-manager';
import {artifactManager} from '@/artifacts/artifact-manager';
import type {NanocoderToolExport, ToolExecutionContext} from '@/types/core';
import {jsonSchema, tool} from '@/types/core';

type TestStatus = 'passed' | 'failed';

interface WriteWalkthroughArgs {
	summary: string;
	filesChanged: Array<{path: string; description: string}>;
	tests: Array<{command: string; status: TestStatus; details?: string}>;
	untestedReason?: string;
	verificationSteps: string[];
}

const TEST_ICONS: Record<TestStatus, string> = {
	passed: '✅',
	failed: '❌',
};

function renderWalkthrough(args: WriteWalkthroughArgs): string {
	const lines = [
		'# Walkthrough',
		'',
		'## Summary',
		'',
		args.summary.trim(),
		'',
		'## Files Changed',
		'',
	];

	if (args.filesChanged.length === 0) {
		lines.push('No files changed.');
	} else {
		for (const file of args.filesChanged) {
			lines.push(`- \`${file.path}\` — ${file.description}`);
		}
	}

	lines.push('', '## Tests', '');
	for (const testResult of args.tests) {
		const details = testResult.details ? ` — ${testResult.details}` : '';
		lines.push(
			`- ${TEST_ICONS[testResult.status]} \`${testResult.command}\`${details}`,
		);
	}
	if (args.tests.length === 0 && args.untestedReason) {
		lines.push(`Not run — ${args.untestedReason}`);
	}

	lines.push('', '## How to Verify', '');
	for (const [index, step] of args.verificationSteps.entries()) {
		lines.push(`${index + 1}. ${step}`);
	}

	return `${lines.join('\n')}\n`;
}

export function createWriteWalkthroughTool(
	manager: ArtifactManager,
): NanocoderToolExport {
	return {
		name: 'write_walkthrough',
		tool: tool({
			description:
				'Persist the completion walkthrough for a complex implementation. ' +
				'Include only files actually changed and tests actually run; use untestedReason when no tests ran.',
			inputSchema: jsonSchema<WriteWalkthroughArgs>({
				type: 'object',
				properties: {
					summary: {type: 'string'},
					filesChanged: {
						type: 'array',
						items: {
							type: 'object',
							properties: {
								path: {type: 'string'},
								description: {type: 'string'},
							},
							required: ['path', 'description'],
						},
					},
					tests: {
						type: 'array',
						items: {
							type: 'object',
							properties: {
								command: {type: 'string'},
								status: {type: 'string', enum: ['passed', 'failed']},
								details: {type: 'string'},
							},
							required: ['command', 'status'],
						},
					},
					untestedReason: {type: 'string'},
					verificationSteps: {
						type: 'array',
						items: {type: 'string'},
					},
				},
				required: ['summary', 'filesChanged', 'tests', 'verificationSteps'],
			}),
			execute: async (args, options) => {
				const sessionId = (options as ToolExecutionContext | undefined)
					?.sessionId;
				if (!sessionId) {
					throw new Error('write_walkthrough requires an active session');
				}
				const artifactPath = await manager.writeArtifact(
					sessionId,
					'walkthrough',
					renderWalkthrough(args),
				);
				return `Walkthrough saved to ${artifactPath}`;
			},
		}),
		validator: async args => {
			if (typeof args?.summary !== 'string') {
				return {valid: false, error: 'Walkthrough summary is required'};
			}
			if (!Array.isArray(args.filesChanged)) {
				return {valid: false, error: 'Files changed must be provided'};
			}
			if (!Array.isArray(args.tests)) {
				return {valid: false, error: 'Test results must be provided'};
			}
			if (!Array.isArray(args.verificationSteps)) {
				return {valid: false, error: 'Verification steps must be provided'};
			}
			if (!args.summary.trim()) {
				return {valid: false, error: 'Walkthrough summary cannot be empty'};
			}
			if (
				args.filesChanged.some(
					(file: unknown) =>
						!file ||
						typeof file !== 'object' ||
						typeof (file as Record<string, unknown>).path !== 'string' ||
						typeof (file as Record<string, unknown>).description !== 'string',
				)
			) {
				return {
					valid: false,
					error: 'Each changed file must include a path and description',
				};
			}
			if (
				args.tests.some((testResult: unknown) => {
					if (!testResult || typeof testResult !== 'object') return true;
					const candidate = testResult as Record<string, unknown>;
					return (
						typeof candidate.command !== 'string' ||
						(candidate.status !== 'passed' && candidate.status !== 'failed')
					);
				})
			) {
				return {
					valid: false,
					error: 'Each test result must include a command and valid status',
				};
			}
			if (
				args.verificationSteps.length === 0 ||
				args.verificationSteps.some((step: string) => !step.trim())
			) {
				return {valid: false, error: 'Provide at least one verification step'};
			}
			if (args.tests.length === 0 && !args.untestedReason?.trim()) {
				return {
					valid: false,
					error: 'Provide test results or explain why tests were not run',
				};
			}
			return {valid: true};
		},
		approval: false,
	};
}

export const writeWalkthroughTool = createWriteWalkthroughTool(artifactManager);
