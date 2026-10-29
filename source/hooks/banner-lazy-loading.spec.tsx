import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'ava';
import React from 'react';
import stripAnsi from 'strip-ansi';

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bannerPackages = new Set([
	'ink-big-text',
	'ink-gradient',
	'cfonts',
	'gradient-string',
]);

// Configure preferences before importing components, and register all AVA hooks
// synchronously (AVA disallows hooks or tests registered after top-level await).
const configDir = mkdtempSync(join(tmpdir(), 'nanocoder-banner-lazy-spec-'));
process.env.NANOCODER_CONFIG_DIR = configDir;
test.after.always(() => rmSync(configDir, {recursive: true, force: true}));

// Guard against reintroducing static runtime imports of heavy banner packages.
// Dynamic import() calls and import type declarations are intentionally allowed.
test('banner packages have no eager imports in startup UI modules', t => {
 for (const relativeFile of [
  'components/welcome-message.tsx',
  'app/components/settings-selector.tsx',
  'hooks/use-banner-modules.ts',
 ]) {
  const source = readFileSync(resolve(sourceRoot, relativeFile), 'utf8');
  // Match static imports/re-exports, including named imports split over lines.
  // Exclude type-only imports and exports. Unlike a source-wide package-name
  // search, this allows the import() expressions that implement lazy loading.
  const staticImports = source.matchAll(
   /^\s*(?:import|export)\s+(?!type\b)(?:[^;]*?\s+from\s*)?['"]([^'"]+)['"]\s*;?/gm,
  );
  for (const match of staticImports) {
   if (bannerPackages.has(match[1] ?? '')) {
    t.fail(`${relativeFile} eagerly imports ${match[1]}`);
   }
  }
 }
 t.pass();
});

async function waitForArt(lastFrame: () => string | undefined): Promise<string> {
	const deadline = Date.now() + 3000;
	while (Date.now() < deadline) {
		const output = stripAnsi(lastFrame() ?? '');
		if (/███/.test(output)) return output;
		await new Promise(resolve => setTimeout(resolve, 10));
	}
	return stripAnsi(lastFrame() ?? '');
}

test.serial('Nanocoder Shape settings preview renders after lazy loading', async t => {
	const previousColumns = process.stdout.columns;
	process.stdout.columns = 100;
	try {
		const {resetPreferencesCache} = await import('../config/preferences.js');
		resetPreferencesCache();
		const {renderWithTheme} = await import('../test-utils/render-with-theme.js');
		const {SettingsNanocoderShapePanel} = await import(
			'../app/components/settings-selector.js'
		);
		const {lastFrame, unmount} = renderWithTheme(
			<SettingsNanocoderShapePanel onBack={() => {}} onCancel={() => {}} />,
		);
		t.teardown(unmount);
		const initial = stripAnsi(lastFrame() ?? '');
		t.regex(initial, /Choose your branding style/);
		const final = await waitForArt(lastFrame);
		t.regex(final, /███/, 'block font preview appears after dynamic imports');
	} finally {
		process.stdout.columns = previousColumns;
	}
});
