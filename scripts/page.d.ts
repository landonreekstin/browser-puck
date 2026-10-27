// The hooks the client exposes for headless verification scripts (see client/src/online.ts
// and sandbox.ts). Shapes are left loose; each script casts what it reads.
type PageVec = { x: number; y: number };

interface Window {
  __puck: { world: () => unknown; rendered?: () => unknown; toScreen: (p: PageVec) => PageVec };
  __log: unknown[];
}
