import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { nitro } from "nitro/vite";

// Identificador de esta versión del build (el commit en Vercel). El navegador lo compara con el
// que informa el servidor (/api/version) para avisar que hay una versión nueva.
const APP_BUILD_ID = process.env.VERCEL_GIT_COMMIT_SHA ?? Date.now().toString(36);

export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
  },
  vite: {
    define: { __APP_BUILD_ID__: JSON.stringify(APP_BUILD_ID) },
    plugins: [
      nitro({
        preset: "vercel",
      }),
    ],
  },
});
