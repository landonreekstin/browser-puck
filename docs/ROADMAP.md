# browser-puck — Roadmap

Milestones are sequential; each ends playable/verifiable. Check items off as they land.
Design questions are in [DESIGN.md](DESIGN.md) — resolve the **(open)** ones a milestone
depends on before starting it.

## Proposed stack (decided in M0; change it here first if it changes)

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript everywhere | one language for client, server and the shared sim |
| Layout | npm workspaces: `shared/`, `server/`, `client/` | the sim is written once and runs on both sides |
| Physics | hand-rolled, fixed timestep, in `shared/` | only circle-vs-capsule/segment/wall collisions are needed; full control of "bars add no energy" |
| Server | Node 24 + `ws`, **server-authoritative** | 8 players, no trust in clients |
| Client | Vite + Canvas 2D | boring and enough for flat shapes; revisit (PixiJS) only if needed |
| Tests | Vitest | sim is pure functions → unit-testable |
| Verify GUI | `playwright-core` driving the nix Chromium + scripted bot clients | GUI changes get *shown* working, not asserted |
| Dev runner | `scripts/dev.mjs` (plain Node) | starts server + client without adding `concurrently` |

## M0 — Scaffolding

- [x] npm workspaces with `shared`, `server`, `client`; strict `tsconfig`
- [x] Vite dev server for client, `tsx watch` (or similar) for server
- [x] Vitest wired up; one trivial test passes
- [x] Client connects to server over WebSocket and displays a ping/RTT
- [x] `npm run dev` starts both; `npm test`, `npm run typecheck` documented in CLAUDE.md

## M1 — Offline physics sandbox (single screen, no networking)

The feel of the game is decided here. Everything lives in `shared/sim`.

- [x] Rink, walls, centre line, goals, goalie boxes rendered from the shared config
- [x] Puck with friction + wall restitution; fixed-timestep sim (e.g. 60 Hz) decoupled from render
- [x] Goalie: confined to box; click-drag slingshot launch with aim line + power meter
- [x] Blocker bar: capsule collision, move (confined to half minus goalie box), rotate
- [x] Bars reflect but never add energy; unit tests prove it (speed after hit ≤ before)
- [x] Tunneling-safe at max puck speed (substeps or swept collision) — tested
- [x] Goal detection
- [x] Debug overlay: velocities, collision normals, a live tuning panel for the knobs

Sandbox controls: `1`–`6`/Tab select a piece · mouse = move target · drag = goalie slingshot
(Esc cancels) · wheel or Q/E = rotate bar · R = give the puck to that team's goalie · F3 or
`` ` `` = debug overlay · T = tuning panel ("Copy changes" exports tweaked knobs as JSON).

## M2 — Multiplayer core

- [ ] Rooms with join codes/links; lobby: pick name, team, role
- [ ] 4–8 players, exactly one goalie per team enforced server-side
- [ ] Server runs the authoritative sim; clients send inputs only
- [ ] Snapshots at 20–30 Hz; client interpolates remote entities
- [ ] Headless bot client (Node) that joins and plays randomly — used for load and
      regression testing with 8 players
- [ ] Disconnect/reconnect keeps your slot

## M3 — Rules and match flow

- [ ] Resolve possession/catch/faceoff rules in DESIGN.md, then implement
- [ ] Score, match end condition, kickoff after a goal
- [ ] Shot timer for a goalie holding the puck
- [ ] Optional: multi-deflection bonus scoring

## M4 — Netcode feel

- [ ] Client-side prediction for your own bar/goalie aim (no input lag on your own piece)
- [ ] Reconciliation on server correction
- [ ] Test with artificial latency/jitter (e.g. 100 ms ± 30) via a dev flag
- [ ] Puck rendering stays smooth under packet loss

## M5 — Presentation

- [ ] Visual pass: team colours, puck trail, hit flashes, goal celebration
- [ ] Sound effects
- [ ] Touch controls (phone/tablet) for both roles
- [ ] Lobby/room UI polish, shareable invite link

## M6 — Homelab deployment

Follows the nixos-config companion-repo rule: the game is *packaged* there, never vendored.

- [ ] `npm run build` produces a static client bundle + server entry
- [ ] Server also serves the static client (one process, one port)
- [ ] `pkgs/browser-puck/default.nix` in nixos-config (`buildNpmPackage` + `fetchFromGitHub` pin)
- [ ] `modules/nixos/homelab/browser-puck.nix` declaring `customConfig.homelab.browserPuck`
      (systemd service, `DynamicUser`, port option) — enabled on **mini-server**
- [ ] nginx vhost `puck.lan` in `reverse-proxy-mini.nix` (`proxyWebsockets = true` is already set by `mkProxy`)
- [ ] `.lan` DNS entry; restricted WireGuard peers allowed to reach it (optiplex-fw pf)
- [ ] Decide: VPN-only friends, or a public port forward (needs TLS + abuse thinking)

## M7 — Later / ideas

- Spectator mode, replays (inputs are already a log → deterministic replay)
- Power-ups, alternative rink shapes
- Bots to fill empty slots
- Stats: assists = bars the puck bounced off before a goal
