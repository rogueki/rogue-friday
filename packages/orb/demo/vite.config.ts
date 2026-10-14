import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root,
  plugins: [react()],
  server: { port: 5180, strictPort: true, host: "127.0.0.1", fs: { allow: [fileURLToPath(new URL("..", import.meta.url)), fileURLToPath(new URL("../../..", import.meta.url))] } },
  preview: { port: 5180, host: "127.0.0.1" },
  build: { outDir: fileURLToPath(new URL("../.demo-dist", import.meta.url)), emptyOutDir: true },
});
