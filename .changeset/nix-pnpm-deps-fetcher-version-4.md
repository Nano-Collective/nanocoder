---
"@nanocollective/nanocoder": patch
---

Fix NixOS and nix build issues by bumping `fetcherVersion` in file `flake.nix`.

Recently, `nixpkgs-unstable` has dropped support for `fetcherVersion=3`, see https://github.com/NixOS/nixpkgs/pull/538919.
Besides setting `fetcherVersion=4`, a workaround for faulty environment variable assignment in `nixpkgs` at `pkgs/build-support/node/fetch-pnpm-deps/default.nix` is no longer needed and has been removed.
See discussion in https://github.com/Nano-Collective/nanocoder/pull/1247.
