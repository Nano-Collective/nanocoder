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
        version = "1.25.2";

        nodejs = pkgs.nodejs_24;

        package = pkgs.stdenv.mkDerivation (finalAttrs: {
          inherit pname version;

          src = pkgs.fetchFromGitHub {
            owner = "nano-collective";
            repo = pname;
            rev = "v${version}";
            sha256 = "sha256-+flJPeLAlLWXw+yX2g7pp3rZFUN6YFFIntztP08cMTY=";
          };

          nativeBuildInputs = [
            nodejs
            pkgs.pnpm
            pkgs.pnpmConfigHook
            pkgs.makeBinaryWrapper
          ];

          pnpmDeps = pkgs.fetchPnpmDeps {
            inherit (finalAttrs) pname version src;
            hash = "sha256-GDMLRvEb1RJUcsIrwSTs9aBPYGVga4ZWj/gIX2LXjc0=";
            fetcherVersion = 2;
          };

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
