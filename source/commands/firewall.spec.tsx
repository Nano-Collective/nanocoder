import React from 'react';
import test from 'ava';
import { renderWithTheme } from '@/test-utils/render-with-theme';
import { getFirewallConfig, resetFirewallConfig } from '@/firewall/mutation-firewall';
import { readFileSync } from 'node:fs';
import type { Colors } from '@/types/ui';
import { firewallCommand, getFirewallStatusColors } from './firewall';

const mockMetadata = {
	provider: 'TestProvider',
	model: 'test-model',
};

test.beforeEach(() => {
	resetFirewallConfig();
});

test('firewallCommand has correct metadata', (t) => {
	t.is(firewallCommand.name, 'firewall');
	t.truthy(firewallCommand.description);
	t.is(typeof firewallCommand.handler, 'function');
});

test('firewallCommand renders status view by default', async (t) => {
	const result = await firewallCommand.handler([], [], mockMetadata);
	const { lastFrame } = renderWithTheme(result as React.ReactElement);
	const output = lastFrame() || '';

	t.true(output.includes('Mutation Firewall Configuration'));
	t.true(output.includes('DISABLED'));
});

test('firewallCommand enables and disables firewall', async (t) => {
	await firewallCommand.handler(['enable'], [], mockMetadata);
	t.is(getFirewallConfig().mode, 'strict');
	t.true(getFirewallConfig().enabled);

	await firewallCommand.handler(['disable'], [], mockMetadata);
	t.is(getFirewallConfig().mode, 'disabled');
	t.false(getFirewallConfig().enabled);
});

test('firewallCommand configures mode', async (t) => {
	const result = await firewallCommand.handler(['mode', 'lenient'], [], mockMetadata);
	const { lastFrame } = renderWithTheme(result as React.ReactElement);
	const output = lastFrame() || '';

	t.true(output.includes('Firewall mode set to \'lenient\''));
	t.is(getFirewallConfig().mode, 'lenient');
});

test('firewallCommand toggles rules', async (t) => {
	await firewallCommand.handler(['toggle', 'any'], [], mockMetadata);
	t.false(getFirewallConfig().blockAnyTypes);

	await firewallCommand.handler(['toggle', 'tests'], [], mockMetadata);
	t.false(getFirewallConfig().protectTestCases);

	await firewallCommand.handler(['toggle', 'exports'], [], mockMetadata);
	t.false(getFirewallConfig().preserveExportSignatures);
});

test('firewallCommand manages protected patterns', async (t) => {
	await firewallCommand.handler(['protect', 'sensitive/*.env'], [], mockMetadata);
	t.true(getFirewallConfig().protectedPatterns.includes('sensitive/*.env'));

	await firewallCommand.handler(['unprotect', 'sensitive/*.env'], [], mockMetadata);
	t.false(getFirewallConfig().protectedPatterns.includes('sensitive/*.env'));
});

test('firewallCommand resets config', async (t) => {
	await firewallCommand.handler(['mode', 'strict'], [], mockMetadata);
	t.is(getFirewallConfig().mode, 'strict');
	t.true(getFirewallConfig().enabled);

	await firewallCommand.handler(['reset'], [], mockMetadata);
	t.is(getFirewallConfig().mode, 'disabled');
	t.false(getFirewallConfig().enabled);
});

test('firewallCommand description says what the firewall does in plain words', (t) => {
	t.notRegex(firewallCommand.description, /negative-space/i);
	t.regex(firewallCommand.description, /block/);
	t.regex(firewallCommand.description, /tests/);
	for (const sub of ['enable', 'disable', 'mode', 'toggle', 'protect', 'reset']) {
		t.true(firewallCommand.description.includes(sub), sub);
	}
});

test('firewallCommand lists enable and disable for an unknown subcommand', async (t) => {
	const result = await firewallCommand.handler(['bogus'], [], mockMetadata);
	const { lastFrame } = renderWithTheme(result as React.ReactElement);
	const output = (lastFrame() || '').replace(/\s+/g, ' ');

	t.true(output.includes('enable, disable'));
});

const themeColors: Colors = {
	primary: '#000001',
	secondary: '#000002',
	text: '#000003',
	base: '#000004',
	info: '#000005',
	warning: '#000006',
	error: '#000007',
	success: '#000008',
	tool: '#000009',
	diffAdded: '#00000a',
	diffRemoved: '#00000b',
	diffAddedText: '#00000c',
	diffRemovedText: '#00000d',
};

test('firewall status colours come from the theme', (t) => {
	const on = getFirewallStatusColors(
		{
			...getFirewallConfig(),
			enabled: true,
			mode: 'lenient',
			blockAnyTypes: true,
			protectTestCases: false,
		},
		themeColors,
	);
	t.is(on.status, themeColors.success);
	t.is(on.mode, themeColors.warning);
	t.is(on.blockAnyTypes, themeColors.success);
	t.is(on.protectTestCases, themeColors.error);
	t.is(on.patternBullet, themeColors.warning);

	const off = getFirewallStatusColors(
		{...getFirewallConfig(), enabled: false, mode: 'disabled'},
		themeColors,
	);
	t.is(off.status, themeColors.error);
	t.is(off.mode, themeColors.secondary);
});

test('firewall status view uses no hard-coded colour names', (t) => {
	const source = readFileSync(new URL('./firewall.tsx', import.meta.url), 'utf8');
	t.notRegex(source, /color=["'{]+\s*["']?(green|red|yellow|gray|grey)["']/);
	t.notRegex(source, /\?\s*'(green|red|yellow|gray)'/);
});
