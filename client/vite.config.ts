import { defineConfig } from "vite";
import { defaultConfig } from "@puck/shared";

export default defineConfig({
  server: {
    port: 5173,
    strictPort: true,
    host: true,
    // The page talks to the game server on its own origin; in dev, forward that here.
    proxy: {
      [defaultConfig.net.wsPath]: { target: `ws://localhost:${defaultConfig.net.port}`, ws: true },
    },
  },
});
