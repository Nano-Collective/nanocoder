import path from 'node:path';
import {defineConfig} from 'rolldown';

export default defineConfig({
	input: {
		cli: 'source/cli.tsx',
		// `nanocoder daemon start` spawns this file by path (it is never
		// `import`ed), so it must be an explicit entry or the flat bundle leaves
		// the spawn pointing at a nonexistent dist/entry.js.
		'daemon/entry': 'source/daemon/entry.ts',
	},
	output: {
		dir: 'dist',
		format: 'esm',
		// Preserve the directory structure the tsc build produces
		// (dist/cli.js, dist/daemon/entry.js) so path resolution is identical.
		entryFileNames: '[name].js',
		chunkFileNames: '[name]-[hash].js',
		// Content-hashed chunk names would otherwise accumulate across builds:
		// a stale chunk can shadow the fresh one and bloat the published package.
		cleanDir: true,
	},
	platform: 'node',
	resolve: {
		alias: {
			'@': path.resolve(process.cwd(), 'source'),
		},
	},
	external: [/\.node$/, /^node:/, /node_modules/],
});
