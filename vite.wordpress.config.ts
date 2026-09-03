import { defineConfig } from "vite";
import type { Plugin } from "vite";

import { renderWordPressDevLoader } from "./scripts/local-wordpress-loader.ts";
import locale from "./locales/es-ES.json";

const assetPort = Number.parseInt(process.env.NEXO_ASSET_PORT ?? "4176", 10);

function wordpressLoader(): Plugin {
  return {
    name: "nexo-wordpress-local-loader",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const requestUrl = new URL(request.url ?? "/", "http://localhost");
        if (requestUrl.pathname !== "/loader.js") {
          next();
          return;
        }
        response.statusCode = 200;
        response.setHeader("Content-Type", "text/javascript; charset=utf-8");
        response.setHeader("Cache-Control", "no-store");
        response.end(renderWordPressDevLoader(locale));
      });
    }
  };
}

export default defineConfig({
  appType: "custom",
  plugins: [wordpressLoader()],
  server: {
    host: "127.0.0.1",
    port: assetPort,
    strictPort: true,
    cors: {
      origin: /^http:\/\/(?:localhost|127\.0\.0\.1):\d+$/u
    }
  }
});
