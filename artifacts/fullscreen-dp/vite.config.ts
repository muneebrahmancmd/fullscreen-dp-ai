import { defineConfig } from "vite";
import path from "path";

const rawPort = process.env.PORT;

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

export default defineConfig({
  root: path.resolve(import.meta.dirname, "public"),
  base: "/",
  server: {
    port,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: path.resolve(import.meta.dirname, "public/index.html"),
        login: path.resolve(import.meta.dirname, "public/login.html"),
        verify: path.resolve(import.meta.dirname, "public/verify.html"),
        admin: path.resolve(import.meta.dirname, "public/admin.html"),
      },
    },
  },
});
