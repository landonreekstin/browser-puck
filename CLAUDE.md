# CLAUDE.md — browser-puck

Online team air-hockey in the browser for 4–8 players. Read **`docs/DESIGN.md`** (the
rules — source of truth) and **`docs/ROADMAP.md`** (milestones, stack, current progress)
before substantive changes.

## Standing rules

1. **Server-authoritative.** Clients send *inputs*, never positions or puck state. The
   server's sim is the only truth.
2. **The sim lives in `shared/` and is pure.** No DOM, no `ws`, no `Date.now()`, no
   `Math.random()` inside it — time comes in as a fixed `dt`, randomness from a seeded RNG
   passed in. Client and server both import it; it must be unit-testable headlessly.
3. **Fixed timestep.** Physics steps at a fixed rate independent of render frame rate or
   network rate.
4. **Blockers never add energy to the puck.** Only the goalie launch does. Keep a test
   proving it.
5. **All tuning numbers live in one shared config**, not as literals scattered in code.
6. **Design changes go in `docs/DESIGN.md` first**, then code. Resolve an **(open)** item
   there before implementing it.
7. **Prefer boring code.** Readability beats cleverness; ask before adding a dependency
   beyond the stack listed in the roadmap.

## Environment

- **`nix develop` (or direnv via `.envrc`) is the only supported entry point.** Node 24,
  npm and Chromium come from `flake.nix`. No global `npm install -g`, no nvm; project deps
  go in `package.json` and `node_modules/.bin` is on `PATH` inside the shell.
- Headless verification uses `playwright-core` with the nix Chromium (`$CHROMIUM_PATH`,
  `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` is set) — Playwright's own downloaded browsers don't run on NixOS.
- Commands (inside the devshell, from the repo root):
  - `npm install` — install all workspaces
  - `npm run dev` — server (`tsx watch` on :8787, ws at `/ws`) + client (Vite on :5173, proxies
    `/ws`); Ctrl-C stops both. Open http://localhost:5173 (sandbox: `/?sandbox`)
  - `npm run build` / `npm start` — production bundle; one process serves client + ws on
    `PORT` (see docs/DEPLOY.md). Verify scripts take `CLIENT_URL` and bots take `PUCK_URL`
    to target it.
  - `npm test` — Vitest (`shared/**/*.test.ts`, `server/**/*.test.ts`)
  - `npm run typecheck` — `tsc` over every workspace and `scripts/`
  - `npm run verify:ping` — with `dev` running: opens 2 headless clients (`CLIENTS=8` for more),
    checks each connects and shows an RTT, screenshots into `screenshots/`
  - `npm run verify:sandbox` — with `dev` running: drives the M1 sandbox through its real
    mouse/keyboard UI (move/rotate a bar, aim with preview, score, debug overlay, tuning panel)
    with assertions + screenshots
  - `npm run verify:room` — with `dev` running: 2 browser clients + 6 bots in one room (create,
    join by link, slots, start, shoot seen on the other client, reload keeps slot, end match)
  - `npm run verify:netcode` — with `dev` running: a lagged client (200±60 ms, 10% loss) plus
    a 60%-loss spectator; measures own-piece response vs server lag, prediction convergence,
    and the worst frame-to-frame puck jump
  - `npm run verify:rules` — with `dev` running: 8 bots play a full match (up to 4 min) while
    a browser spectates; checks shots, catches/dead-puck handoffs and goals keep happening and
    the puck never lies dead longer than the rule allows
  - `npm run bot -- --room CODE --count N` (or `--create --count 8 --start`) — headless bot
    players; `--goalies` prefers goal slots, `--seconds N` exits after N s

## Verify before commit (non-negotiable)

Carried over from nixos-config, where it was violated often enough to become the rule:

- **Never commit or push until the change is verified working** — typecheck/tests passing
  is *not* sufficient for gameplay or UI changes. Run the game and confirm the behaviour.
- **No display is not a reason to hand testing back.** Drive headless Chromium (screenshot
  → look → act) and use the scripted bot clients to fill a room with 8 players. Show it
  working rather than assert it.
- Multiplayer changes are verified with **at least two clients** in one room.
- Watch exit codes: `cmd | head; echo $?` reports `head`'s status, not `cmd`'s.

## Git workflow

- Remote: `github.com/landonreekstin/browser-puck` (private). `gh` is logged in as
  `landonreekstin`.
- Order: **branch → edit → verify → commit → PR**. Docs and small tweaks may go straight
  to `main` after verification; features get a branch + PR.
- Merge a PR with `gh pr merge <N> --merge` once lando asks and checks are green.
- Commit style: `type(scope): description` — types `feat`, `fix`, `tweak`, `pkg`, `test`,
  `docs`, `refactor`; lowercase, no trailing period; scope = area (`sim`, `server`,
  `client`, `net`, `lobby`, `deploy`, `nix`). **No Co-Authored-By or AI attribution lines.**
  e.g. `feat(sim): capsule-vs-circle collision for blocker bars`
- If several sessions work at once, give each its own worktree
  (`git worktree add ../browser-puck-<branch> -b <branch>`) — never work in a tree
  holding another session's uncommitted files.

### When Claude Code runs as root (sudo)

- Fix ownership after edits: `sudo chown -R lando:users /home/lando/browser-puck`
  (never `$USER`/`~` — both expand to root).
- Load the SSH key before pushing: `ssh-add -l 2>/dev/null || ssh-add /home/lando/.ssh/id_ed25519`
- Set identity explicitly if needed:
  `git -c user.name="lando" -c user.email="landonreekstin@gmail.com" commit ...`

## Machines and homelab

- **Develop on `gaming-pc`** (NixOS + Hyprland, has a display and the nix devshell).
- The system itself is managed by `~/nixos-config` (flake; read its `CLAUDE.md` before
  touching it). Never run `nixos-rebuild` by hand — use `rebuild` from inside that repo.
- **Deployment target: `mini-server`** (`192.168.100.103`, server LAN behind the OpenBSD
  firewall `optiplex-fw` at `192.168.1.189`). It already hosts the game servers and the
  game-control dashboard behind nginx (`modules/nixos/homelab/reverse-proxy-mini.nix`,
  `.lan` vhosts with websocket proxying).
- **Companion-repo rule:** this game stays in this repo; nixos-config only *packages* it
  (`pkgs/browser-puck/default.nix` with a `fetchFromGitHub` pin + a homelab module). Never
  copy source into nixos-config. Bumping the pin follows nixos-config's
  `docs/companion-repos.md`.
- Network facts that matter for M6 (details in nixos-config `docs/networking.md`):
  - `.lan` names resolve via the NAS's unbound (`192.168.1.76`); a new name needs a DNS entry there.
  - Friends connect over WireGuard (`10.10.0.0/24`, UDP 51822). Restricted peers only reach
    an allowlist in optiplex-fw's pf `<restricted_peers>` rules — a new service needs adding.
  - Public exposure = Spectrum router forward → optiplex-fw `rdr-to` → mini-server; the
    router has no hairpin NAT.
- Ports already used on mini-server: 80/443 (nginx), 8080 (game-control), 8222
  (vaultwarden), 8123 (Home Assistant), plus game-server ports. Pick something free for the
  game server (proposal: **8787**) and make it a module option.

## Layout

npm workspaces; `@puck/shared` is consumed as TS source (no build step) by Vite and tsx.

- `shared/` (`@puck/shared`) — sim, physics, `src/config.ts` (all tuning), `src/protocol.ts`
  (message types). Pure TS: its tsconfig has no DOM or Node types.
- `server/` (`@puck/server`) — HTTP + `ws` server (`main.ts`, `static.ts`), `Room` (slots + authoritative loop,
  clock injected for tests), `bot.ts` headless bot clients
- `client/` (`@puck/client`) — Vite + Canvas 2D: `online.ts` (lobby → match, snapshot
  interpolation), `sandbox.ts` (`?sandbox`, offline M1), shared `render`/`controls`
- `scripts/` — `dev.mjs` (runs server + client), headless verification scripts
- `docs/` — DESIGN.md, ROADMAP.md, DEPLOY.md (build output + nixos-config drafts)
