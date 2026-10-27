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
- Controls (proposal): mouse position = bar position target, scroll wheel or Q/E = rotate;
  WASD alternative. Touch scheme **(open)**.

## Puck possession and flow (open — decide in M3)

The core loop needs the puck to end up with a goalie. Candidate rules:

1. **Catch:** a puck that enters a goalie box slowly enough (below a speed threshold) is
   caught by that goalie, who then has *N* seconds to shoot or it auto-launches weakly.
2. **Faceoff:** after a goal, the conceding goalie gets the puck.
3. **Dead puck:** a puck that stops in a blocker zone is given to the goalie of that half
   after *N* seconds.
4. **Fast puck into own box:** can the goalie save it (block) vs. it counts as a catch?

*Provisional for the M1 sandbox only:* rule 2 (the conceding goalie gets the puck after a
goal), plus a sandbox key that hands the puck to a goalie. M3 replaces this.

## Scoring and match structure (open)

- Goal = puck fully crosses the goal line.
- Match length: first to *N* goals vs. timed periods.
- Possible bonus: goals that ricochet off ≥ *k* teammate bars score extra (rewards the
  intended play style). Worth prototyping.

## Teams and lobby

- 4–8 players, two teams, roughly balanced. One goalie per team; goalie role picked or
  rotated each goal **(open)**.
- Rooms joined by short code / link. No accounts.

## Tuning knobs (to live in one shared config file)

Rink size, goal width, goalie-box size, puck radius/mass/friction, wall restitution,
bar length/width/restitution, bar move speed and rotate speed, max launch speed,
drag-length→speed curve, catch speed threshold, shot timer.
