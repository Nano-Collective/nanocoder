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
        version = "1.30.0";

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
            sha256 = "sha256-xcsIgVoDH9h94xOoh5rnwkPIMKP9ck++2hEiVBJyN70=";
          };

          nativeBuildInputs = [
            nodejs
            pnpm
            pnpmConfigHook
            pkgs.makeBinaryWrapper
          ];

          # fetcherVersion = 4 dumps SQLite database to an SQL file
          #
          # * updated from `fetcherVersion = 3` because support has been dropped (nixpkgs PR #538919)
          # * an issue in nixpkgs/pkgs/build-support/node/fetch-pnpm-deps/default.nix concerning 
          #   environment variables `pnpm_config_side_effects_cache` and `pnpm_config_update_notifier`
          #   has been resolved, hence we can simply use `fetchPnpmDeps` here without `.overrideAttrs`
          pnpmDeps = (fetchPnpmDeps {
            inherit (finalAttrs) pname version src;
            hash = "sha256-J9DxZAW9627pa+gUEhGqcr/Fd4s4jqDlIcLE2iI5vXE=";
            fetcherVersion = 4;
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
