import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Relative asset URLs, so the build works under a path prefix (/bingo/) as well as at
  // the root. The server's serveSpa adds the <base href> (the prefix's, or "/" at the
  // root, so reloaded deep links still find /assets).
  base: "./",
  plugins: [react()],
  server: {
    host: true,
    port: 5174,
  },
});
