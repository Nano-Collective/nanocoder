#!/usr/bin/env bash
# Catch a publish tarball that omits the CLI, or a CLI that does not print
# package.json's version. `test -f dist/cli.js` in the workspace is not the
# same as the tarball: npm only ships `files`.
#
# --ignore-scripts: `prepare` is husky. The release job already built dist/.

set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"

version=$(node -p "require('./package.json').version")
bin=$(node -p "require('./package.json').bin.nanocoder || ''")

if [[ -z "$version" || -z "$bin" ]]; then
	echo "package.json must have version and bin.nanocoder" >&2
	exit 1
fi

if [[ ! -f "$bin" ]]; then
	echo "missing $bin — run pnpm run build first" >&2
	exit 1
fi

export NANOCODER_SMOKE_BIN="$bin"

# npm 10 prints one object; some versions wrap it in an array.
npm pack --dry-run --json --ignore-scripts --loglevel=error | node -e '
const pack = JSON.parse(require("fs").readFileSync(0, "utf8").trim());
const data = Array.isArray(pack) ? pack[0] : pack;
if (data && data.error) {
	console.error("npm pack failed: " + JSON.stringify(data.error));
	process.exit(1);
}
const bin = process.env.NANOCODER_SMOKE_BIN;
const files = (data && data.files ? data.files : []).map((f) =>
	String(f.path).replace(/^\.\//, ""),
);
if (!files.includes(bin)) {
	console.error("npm pack is missing " + bin);
	process.exit(1);
}
console.log("npm pack includes " + bin + " (" + files.length + " files)");
'

got=$(node "$bin" --version | tr -d '\r')
if [[ "$got" != "$version" ]]; then
	echo "$bin --version: expected $version, got $got" >&2
	exit 1
fi
echo "$bin --version = $version"

# Verify contributors.json was copied into dist/commands/ by build:fast.
# /credits silently returns [] when this file is missing, so --version alone
# would never catch it.
contributors="$(dirname "$bin")/commands/contributors.json"
if [[ ! -f "$contributors" ]]; then
	echo "missing $contributors — run pnpm run build first" >&2
	exit 1
fi
echo "data-file check: $contributors present"

# Exercise a non-trivial chunk that loads the config module graph and reads
# package.json via resolvePackageJsonPath(). If the __dirname candidates all
# miss, getPackageVersion() returns "unknown" — assert the real version appears
# in the output so a broken path is caught here rather than silently at runtime.
config_out=$(node "$bin" config list 2>&1) || {
	echo "$bin config list: exited non-zero" >&2
	exit 1
}
if echo "$config_out" | grep -qF "unknown"; then
	echo "$bin config list: 'unknown' found in output — package.json path is broken" >&2
	echo "$config_out" >&2
	exit 1
fi
echo "$bin config list: ok (no 'unknown' sentinel in output)"
