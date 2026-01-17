import {Text} from 'ink';
import React from 'react';
import NanocoderShapeSelector from '@/components/nanocoder-shape-selector';
import {colors} from '@/config/index';
import {updateNanocoderShape} from '@/config/preferences';
import type {Command} from '@/types/index';
import type {NanocoderShape} from '@/types/ui';

const validShapes: NanocoderShape[] = [
	'block',
	'slick',
	'tiny',
	'grid',
	'pallet',
	'shade',
	'simple',
	'simpleBlock',
	'3d',
	'simple3d',
	'chrome',
	'huge',
];

export const nanocoderShapeCommand: Command = {
	name: 'nanocoder-shape',
	description: 'Select a branding style for the Nanocoder welcome banner',
	handler: async (args: string[], _messages, _metadata) => {
		if (args.length === 0) {
			// Show interactive selector when no arguments provided
			return Promise.resolve(
				React.createElement(NanocoderShapeSelector, {
					onComplete: (shape: NanocoderShape) => {
						return React.createElement(
							Text,
							{color: colors.success},
							`Nanocoder shape set to: ${shape}`,
						);
					},
					onCancel: () => {
						return React.createElement(
							Text,
							{color: colors.info},
							'Nanocoder shape selection cancelled. Current style retained.',
						);
					},
				}),
			);
		}

		// If a shape is provided as argument, set it directly
		const shape = args[0] as NanocoderShape;

		if (validShapes.includes(shape)) {
			updateNanocoderShape(shape);
			return Promise.resolve(
				React.createElement(
					Text,
					{color: colors.success},
					`Nanocoder shape set to: ${shape}`,
				),
			);
		} else {
			return Promise.resolve(
				React.createElement(
					Text,
					{color: colors.error},
					`Invalid shape: ${shape}. Available shapes: ${validShapes.join(', ')}`,
				),
			);
		}
	},
};
