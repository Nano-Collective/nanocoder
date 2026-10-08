import React from 'react';
import test from 'ava';
import { renderWithTheme } from '@/test-utils/render-with-theme';
import { getFirewallConfig, resetFirewallConfig } from '@/firewall/mutation-firewall';
import { firewallCommand } from './firewall';

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
	t.true(output.includes('ENABLED'));
	t.true(output.includes('STRICT'));
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
	await firewallCommand.handler(['mode', 'disabled'], [], mockMetadata);
	t.is(getFirewallConfig().mode, 'disabled');

	await firewallCommand.handler(['reset'], [], mockMetadata);
	t.is(getFirewallConfig().mode, 'strict');
	t.true(getFirewallConfig().enabled);
});
