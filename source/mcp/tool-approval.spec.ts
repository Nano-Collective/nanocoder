import test from 'ava';
import type {DevelopmentMode, MCPServer} from '@/types/index';
import {createMCPToolApproval, isToolAutoApproved} from './tool-approval';

console.log('\ntool-approval.spec.ts');

const server = (alwaysAllow?: string[]): MCPServer => ({
	name: 'srv',
	transport: 'stdio',
	command: 'x',
	alwaysAllow,
});

test('isToolAutoApproved only matches tools listed in alwaysAllow', t => {
	t.false(isToolAutoApproved(undefined, 'read'));
	t.false(isToolAutoApproved(server(), 'read'));
	t.false(isToolAutoApproved(server(['write']), 'read'));
	t.true(isToolAutoApproved(server(['read', 'write']), 'read'));
});

// Expected "needs approval" per mode for each (readOnly, autoApproved) pair.
const matrix: Array<{
	readOnly: boolean;
	autoApproved: boolean;
	expected: Partial<Record<DevelopmentMode, boolean>>;
}> = [
	{
		readOnly: false,
		autoApproved: false,
		expected: {normal: true, 'auto-accept': true, plan: true, headless: false},
	},
	{
		readOnly: true,
		autoApproved: false,
		// The server's own hint must not silence a normal-mode prompt.
		expected: {
			normal: true,
			'auto-accept': false,
			plan: false,
			headless: false,
		},
	},
	{
		readOnly: false,
		autoApproved: true,
		// alwaysAllow must not let a writer run in plan mode.
		expected: {
			normal: false,
			'auto-accept': false,
			plan: true,
			headless: false,
		},
	},
	{
		readOnly: true,
		autoApproved: true,
		expected: {
			normal: false,
			'auto-accept': false,
			plan: false,
			headless: false,
		},
	},
];

for (const {readOnly, autoApproved, expected} of matrix) {
	test(`createMCPToolApproval readOnly=${readOnly} autoApproved=${autoApproved}`, async t => {
		const approval = createMCPToolApproval({readOnly, autoApproved});
		for (const [mode, needsApproval] of Object.entries(expected)) {
			t.is(
				await approval({}, mode as DevelopmentMode),
				needsApproval,
				`mode ${mode}`,
			);
		}
	});
}
