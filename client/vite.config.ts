import path from "path"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

const serverPort = process.env.FLEET_SERVER_PORT || "3000"
const clientPort = Number(process.env.FLEET_CLIENT_PORT) || 5173

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    allowedHosts: true,
    port: clientPort,
    strictPort: true,
    proxy: {
      "/api/sse": {
        target: `http://localhost:${serverPort}`,
        // SSE requires the proxy to stream chunks without buffering.
        // selfHandleResponse tells http-proxy not to pipe automatically —
        // we pipe manually so each chunk flushes immediately.
        selfHandleResponse: true,
        configure: (proxy) => {
          proxy.on("proxyRes", (proxyRes, _req, res) => {
            res.writeHead(proxyRes.statusCode ?? 200, proxyRes.headers);
            proxyRes.pipe(res);
          });
        },
      },
      "/api": `http://localhost:${serverPort}`,
    },
  },
})
