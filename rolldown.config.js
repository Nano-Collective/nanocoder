import path from 'node:path';
import {defineConfig} from 'rolldown';

export default defineConfig({
	input: 'source/cli.tsx',
	output: {
		dir: 'dist',
		format: 'esm',
		banner: '#!/usr/bin/env node',
	},
	platform: 'node',
	resolve: {
		alias: {
			'@': path.resolve(process.cwd(), 'source'),
		},
	},
	external: [/\.node$/, /^node:/, /node_modules/],
});
