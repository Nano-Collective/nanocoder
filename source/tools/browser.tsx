import {Box, Text} from 'ink';
import React from 'react';
import ToolMessage from '@/components/tool-message';
import {isNanocoderToolAlwaysAllowed} from '@/config/nanocoder-tools-config';
import {ThemeContext} from '@/hooks/useTheme';
import {
	type BrowserActionArgs,
	getBrowserPage,
	runBrowserAction,
} from '@/tools/browser-page';
import type {NanocoderToolExport, VisualToolOutput} from '@/types/core';
import {jsonSchema, tool} from '@/types/core';

const browserCoreTool = tool({
	description:
		'Drive one shared headless Chromium page. navigate opens an absolute http(s) URL (localhost is allowed; private network and cloud metadata addresses are blocked). click and type take a CSS selector. type sets the field value. screenshot returns an image you can see. Call screenshot after navigate or a click before judging layout.',
	inputSchema: jsonSchema<BrowserActionArgs>({
		type: 'object',
		properties: {
			action: {
				type: 'string',
				enum: ['navigate', 'click', 'type', 'screenshot'],
				description: 'What to do on the shared page.',
			},
			url: {
				type: 'string',
				description: 'Absolute http or https URL. Required for navigate.',
			},
			selector: {
				type: 'string',
				description: 'CSS selector. Required for click and type.',
			},
			text: {
				type: 'string',
				description: 'Value to set. Used by type. Empty clears the field.',
			},
		},
		required: ['action'],
	}),
	execute: async args => {
		const page = await getBrowserPage();
		const outcome = await runBrowserAction(page, args);
		if (!outcome.image) {
			return outcome.text;
		}
		const visual: VisualToolOutput = {
			llmContent: outcome.text,
			images: [outcome.image],
		};
		return visual;
	},
});

const BrowserFormatter = React.memo(
	({args, result}: {args: BrowserActionArgs; result?: string}) => {
		const themeContext = React.useContext(ThemeContext);
		if (!themeContext) {
			throw new Error('ThemeContext not found');
		}
		const {colors} = themeContext;
		const target = args.url || args.selector || '';

		return (
			<ToolMessage
				hideBox={true}
				message={
					<Box flexDirection="column">
						<Text color={colors.tool}>
							⚒ browser {args.action}
							{target ? ` ${target}` : ''}
						</Text>
						{result && <Text color={colors.secondary}>{result}</Text>}
					</Box>
				}
			/>
		);
	},
);

export const browserTool: NanocoderToolExport = {
	name: 'browser' as const,
	tool: browserCoreTool,
	formatter: (args: BrowserActionArgs, result?: string) => (
		<BrowserFormatter args={args} result={result} />
	),
	approval: (_args, mode) => {
		if (isNanocoderToolAlwaysAllowed('browser')) return false;
		if (mode === 'headless') return false;
		return true;
	},
};
