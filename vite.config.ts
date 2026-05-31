import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
    // Override Nitro preset from cloudflare to vercel-static
    // This generates a /dist folder Vercel can serve directly
  },
  vite: {
    build: {
      outDir: "dist",
    },
  },
});
