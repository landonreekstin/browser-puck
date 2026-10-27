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

- [x] Rooms with join codes/links; lobby: pick name, team, role
- [x] 4–8 players, exactly one goalie per team enforced server-side
- [x] Server runs the authoritative sim; clients send inputs only
- [x] Snapshots at 20–30 Hz; client interpolates remote entities
- [x] Headless bot client (Node) that joins and plays randomly — used for load and
      regression testing with 8 players
- [x] Disconnect/reconnect keeps your slot

Play: `npm run dev`, open http://localhost:5173, create a room, share the link. The offline
sandbox moved to `/?sandbox`. Fill seats with `npm run bot -- --room CODE --count 6`. In M2
your own piece is drawn from server snapshots too (about 100 ms + RTT behind your mouse); M4
adds prediction.

## M3 — Rules and match flow

- [x] Resolve possession/catch/faceoff rules in DESIGN.md, then implement — **proposed by Claude, pending lando's review** (all knobs in `rules.*`/`match.*`)
- [x] Score, match end condition, kickoff after a goal
- [x] Shot timer for a goalie holding the puck
- [ ] Optional: multi-deflection bonus scoring — not built (still open in DESIGN.md)

## M4 — Netcode feel

- [x] Client-side prediction for your own bar/goalie aim (no input lag on your own piece)
- [x] Reconciliation on server correction
- [x] Test with artificial latency/jitter (e.g. 100 ms ± 30) via a dev flag
- [x] Puck rendering stays smooth under packet loss

How it works: the client sends one input per sim tick (seq-numbered, batched at
`net.inputRate`). The server consumes one per tick, merging any backlog beyond
`net.maxInputQueue`, and acks the last applied seq per slot in each snapshot. `Predictor`
(`shared/src/predict.ts`) replays unacked inputs on the server's copy of your piece with the
sim's own motion code. Pieces are kinematic, so steady latency gives an exact match (tested
against the real `Room`), and jitter corrections get blended out. Remote pieces and the puck
render `net.interpDelayMs` behind. When snapshots run out, the client runs the sim forward
(up to `net.maxExtrapolateMs`). The puck itself is not predicted: after you shoot, it leaves
your goalie one RTT later.

Dev flag: `?lag=200&jitter=60&loss=0.1` (added RTT ms, ± ms per message with order kept,
fraction of snapshots dropped). The debug overlay (F3) shows the correction and extrapolation.

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
