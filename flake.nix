{
  description = "browser-puck — a team air-hockey browser game for 4–8 players";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
      in {
        devShells.default = pkgs.mkShell {
          packages = with pkgs; [
            nodejs_24          # node + npm (npm workspaces; no global installs)
            typescript-language-server
            chromium           # headless browser for screenshot / multi-client verification
            jq
          ];

          shellHook = ''
            # Point Playwright (if adopted) at the nix chromium instead of its own download.
            export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
            export CHROMIUM_PATH=${pkgs.chromium}/bin/chromium
            export PATH="$PWD/node_modules/.bin:$PATH"
          '';
        };
      });
}
