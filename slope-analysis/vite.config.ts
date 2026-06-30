import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Forma serves extensions from the manifest URL; keep the base relative so the
// built assets resolve correctly regardless of where the bundle is hosted.
export default defineConfig({
  base: "./",
  plugins: [react()],
  server: {
    port: 5173,
  },
});
