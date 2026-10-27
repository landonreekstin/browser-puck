import { defineConfig } from "vite";

// Bundles the server (and @puck/shared, which is TS source) into dist/main.js for plain
// `node`. `ws` stays an ordinary runtime dependency.
export default defineConfig({
  build: {
    ssr: "src/main.ts",
    outDir: "dist",
    target: "node24",
    rollupOptions: { output: { entryFileNames: "main.js" } },
  },
  ssr: { noExternal: ["@puck/shared"] },
});
