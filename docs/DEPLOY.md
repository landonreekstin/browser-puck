# browser-puck — Deployment (M6)

What this repo provides, and drafts of the nixos-config side. Per the companion-repo rule
the game is only *packaged* in nixos-config. **Nothing has been applied there.** The drafts
below are for lando to review and land (`docs/companion-repos.md` in nixos-config gets a
`browser-puck` section at the same time).

## What the build produces

```bash
npm run build   # client/dist (static) + server/dist/main.js (Vite SSR bundle incl. @puck/shared)
npm start       # node server/dist/main.js — one process, one port
```

The server is one HTTP server that serves:

| Path | What |
|---|---|
| `/` and everything else | the built client (`index.html` no-cache, `assets/*` immutable) |
| `/ws` | the game WebSocket (`net.wsPath`) |
| `/healthz` | `ok`, for probes |

Environment variables:

| Var | Default | Meaning |
|---|---|---|
| `PORT` | `8787` (`net.port`) | listen port |
| `HOST` | `0.0.0.0` | bind address, `127.0.0.1` behind nginx |
| `STATIC_DIR` | `client/dist` next to the checkout, if built | the built client. Unset and not found: the static side is off (dev) |

Runtime dependencies of the bundle: Node 24 plus the `ws` package. The client talks to the
server on its own origin (`ws(s)://<host>/ws`), so any reverse proxy only needs websocket
upgrade on that host. `mkProxy` already sets `proxyWebsockets = true`.

## Verified

- `npm run build`, then `PORT=8790 node server/dist/main.js`. `verify:ping`, `verify:sandbox`,
  `verify:room` and `verify:netcode` all pass against it (`CLIENT_URL=http://localhost:8790
  PUCK_URL=ws://localhost:8790/ws`).
- The **Nix package below**, built from a local copy of this checkout instead of the GitHub
  pin, builds in the sandbox (308 KB output). Its `bin/browser-puck`, run from `/`, passes
  `verify:room` (2 browsers + 6 bots).

## Draft: `pkgs/browser-puck/default.nix` (nixos-config)

```nix
# The browser-puck game server + built client, from its own repo.
# To update: bump `rev`, `hash` and `npmDepsHash` — see docs/companion-repos.md#browser-puck.
{ lib, buildNpmPackage, fetchFromGitHub, nodejs_24, runtimeShell }:

buildNpmPackage {
  pname = "browser-puck";
  version = "unstable-YYYY-MM-DD";
  src = fetchFromGitHub {
    owner = "landonreekstin";
    repo = "browser-puck";
    rev = "<sha>";
    hash = lib.fakeHash; # build once, copy the real hash from the mismatch error
  };
  # Changes whenever package-lock.json does. Same trick: lib.fakeHash, build, copy.
  npmDepsHash = lib.fakeHash;
  nodejs = nodejs_24;
  npmBuildScript = "build";

  installPhase = ''
    runHook preInstall
    mkdir -p $out/share/browser-puck/node_modules $out/bin
    cp -r client/dist $out/share/browser-puck/client
    cp server/dist/main.js $out/share/browser-puck/server.js
    cp -r node_modules/ws $out/share/browser-puck/node_modules/   # the bundle's only runtime dep
    cat > $out/bin/browser-puck <<SH
    #!${runtimeShell}
    export STATIC_DIR="\''${STATIC_DIR:-$out/share/browser-puck/client}"
    exec ${nodejs_24}/bin/node $out/share/browser-puck/server.js "\$@"
    SH
    chmod +x $out/bin/browser-puck
    runHook postInstall
  '';
}
```

## Draft: `modules/nixos/homelab/browser-puck.nix` (nixos-config)

```nix
# ~/nixos-config/modules/nixos/homelab/browser-puck.nix
{ config, lib, pkgs, ... }:

let
  cfg = config.customConfig.homelab.browserPuck;
  pkg = pkgs.callPackage ../../../pkgs/browser-puck { };
in
{
  options.customConfig.homelab.browserPuck = with lib; {
    enable = mkEnableOption "browser-puck team air-hockey server";
    port = mkOption {
      type = types.port;
      default = 8787;
      description = "Local port; nginx fronts it as puck.lan.";
    };
  };

  config = lib.mkIf cfg.enable {
    systemd.services.browser-puck = {
      description = "browser-puck game server";
      after = [ "network.target" ];
      wantedBy = [ "multi-user.target" ];
      environment = {
        PORT = toString cfg.port;
        HOST = "127.0.0.1"; # only nginx talks to it
      };
      serviceConfig = {
        Type = "simple";
        ExecStart = "${pkg}/bin/browser-puck";
        DynamicUser = true;
        Restart = "on-failure";
        SyslogIdentifier = "browser-puck";
        # No state on disk; rooms live in memory.
        ProtectSystem = "strict";
        ProtectHome = true;
        PrivateTmp = true;
        NoNewPrivileges = true;
      };
    };
  };
}
```

## Draft: the rest of the wiring (nixos-config)

1. `reverse-proxy-mini.nix`: add
   `(lib.mkIf cfg.browserPuck.enable { "puck.lan" = mkProxy cfg.browserPuck.port; })`.
2. mini-server host: `customConfig.homelab.browserPuck.enable = true;` (port 8787 is free
   per the CLAUDE.md port list).
3. DNS: a `puck.lan` record in the NAS's unbound (`192.168.1.76`), pointing at mini-server.
4. WireGuard restricted peers: they reach puck.lan through nginx on mini-server's 80/443.
   Check whether optiplex-fw's `<restricted_peers>` rules already allow that, as they would
   for `dashboard.lan`. If not, add it.
5. Verify on the box: `curl http://puck.lan/healthz`, then
   `CLIENT_URL=http://puck.lan PUCK_URL=ws://puck.lan/ws npm run verify:room` from gaming-pc.

## Still to decide (lando)

- **VPN-only friends vs a public port forward.** Public needs TLS (a real cert, not the local
  CA) and abuse thinking. At minimum: rate-limit room creation and cap rooms per IP. Neither
  exists yet. VPN-only needs nothing more than the steps above.
