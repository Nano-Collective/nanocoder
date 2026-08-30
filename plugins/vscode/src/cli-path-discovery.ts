/**
 * Re-export the pure CLI discovery logic from the main source tree.
 *
 * The canonical implementation lives in source/vscode/cli-path-discovery.ts
 * (inside the root rootDir) so it can be unit-tested by AVA.
 * This file re-exports it for the VS Code extension bundle (esbuild has no
 * rootDir restriction, so the relative path across workspace roots is fine).
 */
export * from '../../../source/vscode/cli-path-discovery';
