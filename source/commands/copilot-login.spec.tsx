import test from 'ava';
import React from 'react';
import {copilotLoginCommand} from './copilot-login-command.js';
import {CopilotLogin} from './copilot-login.js';

test('copilot-login command creates CopilotLogin component', async t => {
	const result = await copilotLoginCommand.handler([], [], {} as any);
	
	t.truthy(React.isValidElement(result));
	// Check that it's a CopilotLogin component by checking its type
	const element = result as React.ReactElement;
	// @ts-expect-error - we know this is a CopilotLogin component
	t.is(element.type, CopilotLogin);
});

test('copilot-login command accepts provider name argument', async t => {
	const result = await copilotLoginCommand.handler(['CustomProvider'], [], {} as any);
	
	t.truthy(React.isValidElement(result));
	const element = result as React.ReactElement;
	// @ts-expect-error - we know this has props
	t.is(element.props.providerName, 'CustomProvider');
});

test('copilot-login command uses default provider name when none provided', async t => {
	const result = await copilotLoginCommand.handler([], [], {} as any);
	
	t.truthy(React.isValidElement(result));
	const element = result as React.ReactElement;
	// @ts-expect-error - we know this has props
	t.is(element.props.providerName, 'GitHub Copilot');
});