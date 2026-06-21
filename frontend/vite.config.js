import { defineConfig } from 'vite';

// `base` MUST match the GitHub repo name so asset URLs resolve under
// https://<user>.github.io/<repo>/ . This repo is "USPTO".
// Override with VITE_BASE=/ for local preview at the root if you prefer.
export default defineConfig({
  base: process.env.VITE_BASE ?? '/USPTO/',
  server: { port: 5173, host: 'localhost' },
  build: { outDir: 'dist', emptyOutDir: true },
});
