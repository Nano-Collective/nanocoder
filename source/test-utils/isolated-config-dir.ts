/**
 * Side-effect import: points NANOCODER_CONFIG_DIR at a fresh temp directory.
 *
 * Import this FIRST in a spec whose code under test resolves a file through
 * the config dir at module-load time (e.g. the `promptHistory` singleton
 * resolves `.nano-coder-history`). Because ES imports evaluate in order, the
 * env var is set before that module is first evaluated, so the spec never
 * reads or writes the developer's real config files.
 */
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

process.env.NANOCODER_CONFIG_DIR = mkdtempSync(
	join(tmpdir(), 'nanocoder-isolated-config-'),
);
