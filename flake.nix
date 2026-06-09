{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    pre-commit-hooks = {
      url = "github:cachix/pre-commit-hooks.nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    {
      self,
      nixpkgs,
      flake-utils,
      pre-commit-hooks,
      ...
    }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
        pname = "nanocoder";
        version = "1.27.0";

        nodejs = pkgs.nodejs_24;

        # nixpkgs ships pnpm 11 as `pnpm_11` (default `pnpm` is still 10).
        # Its `fetchPnpmDeps` handles most pnpm 11 reproducibility quirks
        # natively: v11/{tmp,projects} cleanup, JSON checkedAt stripping,
        # and SQLite v11/index.db row normalisation via `pnpm-fixup-state-db`.
        # See nixpkgs PR #505103.
        #
        # The remaining pnpmDeps reproducibility fix lives below: see the
        # comment on `pnpmDeps` for the upstream shell-syntax bug we work
        # around with env-var derivation attrs.
        pnpm = pkgs.pnpm_11;
        pnpmConfigHook = pkgs.pnpmConfigHook.override { inherit pnpm; };
        fetchPnpmDeps = pkgs.fetchPnpmDeps.override { inherit pnpm; };

        package = pkgs.stdenv.mkDerivation (finalAttrs: {
          inherit pname version;

          src = pkgs.fetchFromGitHub {
            owner = "nano-collective";
            repo = pname;
            rev = "v${version}";
            sha256 = "sha256-3Bi0in4mvy8wJPSgCaPwhULoAv0rC0x8j0hIPUT4wqk=";
          };

          nativeBuildInputs = [
            nodejs
            pnpm
            pnpmConfigHook
            pkgs.makeBinaryWrapper
          ];

          # fetcherVersion = 3 bundles the deps store into a reproducible
          # tarball (nixpkgs PR #469950).
          #
          # Work around a bug in nixpkgs' fetchPnpmDeps installPhase for
          # pnpm >= 11: it writes
          #     export pnpm_config_side_effects_cache false
          #     export pnpm_config_update_notifier false
          # which is incorrect shell — `export VAR value` does not assign,
          # it exports VAR (often empty) and runs `value` as a command.
          # So both settings end up at their pnpm defaults, and the default
          # `side-effects-cache=true` makes pnpm record a per-package
          # `sideEffects` field in v11/index.db whose value depends on the
          # order in which packages are installed in parallel. The single
          # row that drifts here is `ink@6.8.0`. Three identical CI runs
          # produced three distinct pnpmDeps hashes before this fix.
          #
          # Setting the values as derivation attributes makes Nix export
          # them as build env vars before installPhase runs, so the broken
          # upstream `export X val` lines become idempotent no-ops.
          #
          # Verify upstream has fixed the typo before dropping these:
          #   nix eval --raw nixpkgs#path \
          #     | xargs -I{} grep -n 'export pnpm_config_' \
          #         {}/pkgs/build-support/node/fetch-pnpm-deps/default.nix
          # If those lines show `export X=val` (with `=`), drop these
          # two attrs and re-run the update-nix workflow to refresh the
          # pnpmDeps hash.
          pnpmDeps = (fetchPnpmDeps {
            inherit (finalAttrs) pname version src;
            hash = "sha256-EX2aB5+e+bOI/q27nwTnbZd3SNOMyh4829ykKNIOeZ0=";
            fetcherVersion = 3;
          }).overrideAttrs (_: {
            pnpm_config_side_effects_cache = "false";
            pnpm_config_update_notifier = "false";
          });

          buildPhase = ''
            runHook preBuild
            pnpm run build
            runHook postBuild
          '';

          installPhase = ''
            runHook preInstall

            mkdir -p $out/bin
            mkdir -p $out/lib/${pname}

            # Copy built files
            cp -r dist $out/lib/${pname}/
            cp -r node_modules $out/lib/${pname}/
            cp package.json $out/lib/${pname}/
            cp -r plugins $out/lib/${pname}/

            # Copy static files not bundled by tsc (loaded at runtime via __dirname)
            install -D source/config/themes.json $out/lib/${pname}/source/config/themes.json
            mkdir -p $out/lib/${pname}/source/app/prompts
            cp -r source/app/prompts/* $out/lib/${pname}/source/app/prompts/

            # Create wrapper executable
            makeWrapper ${nodejs}/bin/node $out/bin/${pname} \
              --set NODE_PATH "$out/lib/${pname}/node_modules" \
              --add-flags "$out/lib/${pname}/dist/cli.js"

            runHook postInstall
          '';

          meta = with pkgs.lib; {
            description = "A beautiful local-first coding agent running in your terminal - built by the community for the community ⚒";
            homepage = "https://github.com/Nano-Collective/nanocoder";
            license = licenses.mit;
          };
        });
      in
      {
        packages.default = package;

        devShells.default = pkgs.mkShell {
          packages = with pkgs; [
            nodejs
            pnpm
            git
          ];
        };

        checks.pre-commit-check = pre-commit-hooks.lib.${system}.run {
          src = self;
          hooks = {
            nixfmt = {
              enable = true;
              entry = "${pkgs.nixfmt}/bin/nixfmt";
            };
          };
        };
      }
    );
}
