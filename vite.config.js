import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), "DEV_");
  const clientPort = Number(environment.DEV_CLIENT_PORT || 5173);
  const serverPort = Number(environment.DEV_SERVER_PORT || 3001);
  const proxyTarget =
    environment.DEV_SERVER_ORIGIN || `http://127.0.0.1:${serverPort}`;

  return {
    plugins: [react()],
    server: {
      host: environment.DEV_CLIENT_HOST || "0.0.0.0",
      port: clientPort,
      strictPort: true,
      proxy: {
        "/socket.io": {
          target: proxyTarget,
          ws: true,
        },
        "/api": {
          target: proxyTarget,
        },
      },
    },
  };
});
