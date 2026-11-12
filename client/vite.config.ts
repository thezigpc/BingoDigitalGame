import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Relative asset URLs, so the build works under a path prefix (/bingo/) as well as at
  // the root. index.html carries <base href="/"> for the root; under a prefix the server
  // injects the prefix's own <base> ahead of it.
  base: "./",
  plugins: [react()],
  server: {
    host: true,
    port: 5174,
  },
});
