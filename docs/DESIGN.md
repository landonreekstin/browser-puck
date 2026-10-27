# browser-puck — Game Design

The source of truth for *what the game is*. Code comments link here rather than restating
rules. Anything marked **(open)** is undecided — settle it in this file before coding it.

## Pitch

Online, browser-based, team air hockey for **4–8 players** (two teams of 2–4). Each team
has one **goalie** — the only player who can put force on the puck — and 1–3 **blockers**,
flat rotating bars that can only block and deflect. The fun is the bank shot: the goalie
lines up a launch that ricochets off teammates' bars (and walls) on its way into the
opposing goal.

## The rink

- Top-down rectangle, split by a centre line into two halves, one per team.
- A **goal** centred on each end wall.
- A **goalie box** in front of each goal. Only that team's goalie may be inside it.
- Walls are bouncy (restitution < 1); the puck has light friction so it eventually stops.
- Orientation: the rink is wider than tall. Team 0 defends the **left** goal, team 1 the
  **right**. A goal is an opening in the end wall; its edges (posts) are solid.

## Roles

### Goalie (one per team)

- Confined to their own goalie box.
- **The only player who can launch the puck.** Launch is a slingshot/cannon:
  **click (or touch) and drag back and to the sides** — the drag *direction* sets the aim
  (shot goes opposite the pull, like a slingshot) and the drag *length* sets the power,
  clamped to a max.
- Show an aim preview while dragging (direction line + power meter). The preview is the
  sim's own prediction of the shot with every other piece frozen where it is now, drawn
  through the first **`aimPreview.bounces`** bounces (knob; default **1**, `0` = only up to
  the first contact, `-1` = no path, just the aim line). It's a prediction: pieces that move
  afterwards change the real outcome.
- The goalie can only launch while **holding** the puck. A held puck sits on the goalie and
  moves with it.
- Also acts as a last line of defence by body-blocking inside the box.

### Blocker (the rest of the team)

- A **flat bar** (rendered as a capsule: a segment with rounded ends).
- **Moves anywhere in their team's half, outside the goalie box.** "Outside" applies to
  the bar's centre; its rounded ends may overhang the box edge. Bars pass through each other.
- **Rotates** to change the deflection angle. Movement and rotation are capped by
  `bar.moveSpeed` / `bar.rotateSpeed`. The input is a *target* pose and the bar moves
  toward it.
- **Cannot launch the puck.** A bar imparts no energy of its own: the puck reflects off it
  with restitution ≤ 1 (clamped in code), and **bar velocity is never transferred to the
  puck. There is no knob for it** (standing rule 4). A bar moving into a slow or resting
  puck pushes it out of the way (position only, velocity unchanged), so a blocker can nudge
  a dead puck at bar speed but can never shoot it. If that turns out to be exploitable,
  M3's dead-puck rule handles it.
- Goalies body-block the same way: a reflection that never adds speed.
- Controls (built): mouse position = bar position target, scroll wheel or Q/E = rotate. The
  WASD alternative isn't built.

### Touch controls (M5, proposed by Claude, pending review)

Touch has no hover, so pieces move only while a finger is down and stay put on release.

- **Goalie:** a touch that starts on or near your goalie (within 2.5 goalie radii) drags it
  around the box. A touch that starts anywhere else is the slingshot: pull back, release
  to shoot, and drag back to near the start point to cancel.
- **Blocker:** one finger drags the bar. A second finger twisting around the first rotates
  it. On-screen ⟲ ⟳ buttons (shown on touch screens for blockers) rotate while held, for
  one-handed play.

## Puck possession and flow (M3)

> **Proposed by Claude while lando was away. Not yet approved, so review it.** Every number
> is a knob in `shared/src/config.ts` (`rules.*`, `match.*`), and each rule can be switched
> off by setting its knob to 0.

The core loop needs the puck to end up with a goalie. The rules:

1. **Catch:** a puck whose centre is inside a goalie box and is moving slower than
   `rules.catchSpeed` is caught by that box's goalie. It then sits on the goalie (it's
   *held*). A goalie can only shoot while holding.
2. **Fast puck into own box:** no catch. The goalie can body-block it (a reflection that
   adds no speed), and it is caught once it slows below `catchSpeed` inside the box. This
   settles candidate 4: fast pucks are saves, slow ones are catches.
3. **Shot timer:** a goalie holding the puck for `rules.shotTimerSeconds` auto-launches it
   weakly (`rules.autoLaunchPower`) straight at the other goal. That keeps the game moving,
   including when the goalie's player is away.
4. **Dead puck:** a puck slower than `rules.deadSpeed` outside both boxes for
   `rules.deadPuckSeconds` is given to the goalie of the half it's in.
5. **Faceoff:** after a goal, the conceding goalie gets the puck. The first kickoff of a
   match goes to a random team (the server rolls it; the sim just takes the team).

The sandbox's R key (hand the puck to a goalie) stays as a sandbox-only convenience.

## Scoring and match structure (M3)

> **Proposed by Claude, pending review**, like the section above.

- Goal = puck fully crosses the goal line.
- **First to `match.goalsToWin` (default 5) wins.** The sim records the winner and freezes
  the puck. Everyone sees the result, and the host's "End match" returns to the lobby.
  Timed periods stay a possible alternative; they aren't built.
- Possible bonus: goals that ricochet off ≥ *k* teammate bars score extra (rewards the
  intended play style). Still **(open)**, not built. The sim already reports every bar
  contact, so it's cheap to add.

## Teams and lobby

- 4–8 players, two teams, roughly balanced. One goalie per team. In M2 the goalie role is
  **picked in the lobby** like any other slot. Rotating it each goal stays **(open)**.
- Rooms joined by short code / link. No accounts.

### Rooms and slots (M2)

- A room has a 4-letter **code**; the invite link is `…/?room=CODE`. The first player to
  join is the **host**. If the host leaves, the next connected player becomes host.
- Each team has fixed **slots**: one goalie and up to three blockers (`t0-goalie`,
  `t0-b0`…`t0-b2`, same for `t1`). A player holds at most one slot, or none (spectator).
  The server enforces one player per slot, so there is one goalie per team.
- **Start** (host only) needs each team to have 2–4 players: a goalie plus at least one
  blocker. That gives the 4-player minimum.
- **During a match** players can still take a free slot (drop-in). A blocker that joins
  appears at its slot's home position. Leaving a blocker slot removes that bar.
- **Disconnect:** your slot and piece are kept (the piece just stops) for
  `room.reconnectGraceSeconds`. Rejoining with the same browser (it keeps a per-room token)
  puts you back in your slot. After the grace period your slot frees up. An unoccupied
  goalie holding the puck auto-launches it when the shot timer runs out (M3).
- The host can end the match, which returns everyone to the lobby (score reset).

## Tuning knobs (to live in one shared config file)

Rink size, goal width, goalie-box size, puck radius/mass/friction, wall restitution,
bar length/width/restitution, bar move speed and rotate speed, max launch speed,
drag-length→speed curve, catch speed threshold, shot timer.
