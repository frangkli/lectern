import node from "@astrojs/node";
import { defineConfig, fontProviders } from "astro/config";

// One server, on loopback: docs are read from disk on every request, so nothing is prerendered.
export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone" }),
  server: { host: "127.0.0.1" },
  // The kit names these faces; Astro downloads them at build time and serves them itself.
  fonts: [
    { name: "Hanken Grotesk", cssVariable: "--font-hanken", provider: fontProviders.google(), weights: ["100 900"], styles: ["normal", "italic"] },
    { name: "Geist Mono", cssVariable: "--font-geist-mono", provider: fontProviders.google(), weights: ["400 600"], fallbacks: ["monospace"] },
  ],
});
