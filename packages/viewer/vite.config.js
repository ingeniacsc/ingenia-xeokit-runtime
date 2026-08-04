import { defineConfig } from "vite";

export default defineConfig({
  base: "/",
  build: {
    sourcemap: true,
    target: "es2022",
  },
  server: {
    strictPort: true,
    headers: {
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  },
});
