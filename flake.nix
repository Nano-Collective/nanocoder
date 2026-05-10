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
        version = "1.26.1";

        nodejs = pkgs.nodejs_24;

        # nixpkgs currently ships pnpm 10. The repo's lockfile is generated
        # by pnpm 11 (new patchedDependencies / overrides format), so older
        # pnpm bails with ERR_PNPM_LOCKFILE_CONFIG_MISMATCH. Override the
        # nixpkgs pnpm derivation to the version pinned by package.json's
        # `packageManager` field.
        #
        # Two pnpm 11 incompatibilities also need patching:
        # 1. The npm tarball ships bin/pnpm.cjs (a Corepack-compat shim)
        #    without the execute bit. The nixpkgs builder symlinks
        #    $out/bin/pnpm → pnpm.cjs, so we chmod +x in postInstall.
        # 2. nixpkgs's fetchPnpmDeps installPhase runs `pnpm config set
        #    manage-package-manager-versions false` against the global
        #    config to silence version-mismatch errors. pnpm 11 rejects
        #    that key globally (only allowed in pnpm-workspace.yaml).
        #    Since our pnpm version matches `packageManager`, the command
        #    is unnecessary — we patch it out with a no-op.
        pnpm = (pkgs.pnpm.override {
          version = "11.0.9";
          hash = "sha256-TYTXsOMckFT2Flh5VpgHAAfQO3I4SB4hYaViVXqpCDQ=";
        }).overrideAttrs (old: {
          postInstall = (old.postInstall or "") + ''
            chmod +x $out/libexec/pnpm/bin/pnpm.cjs $out/libexec/pnpm/bin/pnpx.cjs
          '';
        });
        pnpmConfigHook = pkgs.pnpmConfigHook.override { inherit pnpm; };
        fetchPnpmDeps = pkgs.fetchPnpmDeps.override { inherit pnpm; };

        package = pkgs.stdenv.mkDerivation (finalAttrs: {
          inherit pname version;

          src = pkgs.fetchFromGitHub {
            owner = "nano-collective";
            repo = pname;
            rev = "v${version}";
            sha256 = "sha256-YRjUb6dNVWEEGgqnCZCOeEbF3QN3/HUgwfCH+X+IbSE=";
          };

          nativeBuildInputs = [
            nodejs
            pnpm
            pnpmConfigHook
            pkgs.makeBinaryWrapper
          ];

          # fetcherVersion = 3 bundles the deps store into a reproducible
          # tarball (nixpkgs PR #469950). Required because pnpm 11's
          # loose-file output (fetcherVersion = 2) produced a different
          # hash every run.
          #
          # nixpkgs's fetchPnpmDeps fixupPhase hard-codes cleanup paths to
          # `$storePath/{v3,v10}/{tmp,projects}` — it doesn't yet know about
          # pnpm 11's `v11/` layout. Without us cleaning v11 in preFixup,
          # `v11/projects/` (symlinks pointing at `/build/source/<random>`)
          # and `v11/tmp/` (timestamped temp files) get bundled into the
          # tarball, defeating reproducibility. Drop them ourselves.
          pnpmDeps = (fetchPnpmDeps {
            inherit (finalAttrs) pname version src;
            hash = "sha256-odcsIWN5dlquZ+tMqkR1XeJxxNCsg4vEb8M/z9hsd3I=";
            fetcherVersion = 3;
          }).overrideAttrs (old: {
            installPhase = builtins.replaceStrings
              [ "pnpm config set manage-package-manager-versions false" ]
              [ "true # patched for pnpm 11: key no longer allowed globally" ]
              old.installPhase;
            preFixup = (old.preFixup or "") + ''
              rm -rf $storePath/v11/tmp $storePath/v11/projects
            '';
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
