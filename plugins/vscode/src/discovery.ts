/**
 * Re-export the pure discovery logic from the main source tree so the VS
 * Code extension can bundle it without re-implementing the file format.
 *
 * The canonical implementation lives in source/vscode/discovery.ts; this
 * thin wrapper exists so the extension bundle resolves the relative path
 * cleanly through esbuild (the same pattern used for cli-path-discovery.ts).
 */
export {
	clearDiscoveryFile,
	getDefaultConfigDir,
	getDiscoveryFilePath,
	readDiscoveryFile,
	type ServerDiscovery,
	VSCODE_DISCOVERY_FILENAME,
	VSCODE_DISCOVERY_VERSION,
	writeDiscoveryFile,
} from '../../../source/vscode/discovery';
