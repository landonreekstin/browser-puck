// The single home for tuning numbers (CLAUDE.md rule 5). See docs/DESIGN.md "Tuning knobs".
export const config = {
  net: {
    /** Game server port (dev and, by default, deployment). */
    port: 8787,
    /** How often the client sends a ping to measure RTT. */
    pingIntervalMs: 1000,
  },
} as const;
