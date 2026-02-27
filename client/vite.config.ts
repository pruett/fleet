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
    port: clientPort,
    strictPort: true,
    proxy: {
      "/api": `http://localhost:${serverPort}`,
      "/ws": {
        target: `ws://localhost:${serverPort}`,
        ws: true,
      },
    },
  },
})
