# browser-puck — Deployment (M6)

How the game gets to players. Per the companion-repo rule it is only *packaged* in
nixos-config: `pkgs/browser-puck/default.nix` (`fetchFromGitHub` pin) and
`modules/nixos/homelab/browser-puck.nix` (`customConfig.homelab.browserPuck`), enabled on
**mini-server**. Bumping the pin follows nixos-config's `docs/companion-repos.md`.

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
- The **nixos-config package**, built from a local copy of this checkout instead of the GitHub
  pin, builds in the sandbox (308 KB output). Its `bin/browser-puck`, run from `/`, passes
  `verify:room` (2 browsers + 6 bots).

## How players reach it

**Everyone plays at `http://192.168.1.76:8787`.** That covers restricted WireGuard
friends, full peers and the Main LAN.

- Restricted peers' tunnels route only `192.168.1.76/32` (the NAS's legacy alias on
  optiplex-fw), and they use public DNS, so a `.lan` name behind nginx would never reach
  them. That is why the game uses the same pattern as The Batman netplay: one pf rule on
  optiplex-fw, placed before the `<restricted_peers>` block, redirects that alias's port
  8787 to mini-server:

  ```
  pass in quick on wg0 proto tcp from 10.10.0.0/24 to $nas_legacy_ip port 8787 rdr-to 192.168.100.103
  ```

  (plus the same rule `on re0` from the Main LAN if LAN players should use that address too).
- The server listens on `0.0.0.0:8787`. mini-server's own firewall is off; optiplex-fw is
  the perimeter.
- The page opens its WebSocket on its own origin (`ws://192.168.1.76:8787/ws`), so the one
  redirected port carries both the page and the game.

## Still to decide (lando)

- **Public internet access** (a router port forward). It needs TLS (a real cert) and abuse
  limits (rate-limit room creation, cap rooms per IP), and neither exists yet. VPN-only needs
  nothing more than the above.
