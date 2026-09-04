import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // GitHub Pages serves a project repo under /<repo-name>/, not the domain root — asset URLs
  // in the built HTML/JS need that prefix or they'll 404. Only applied for production builds
  // (GITHUB_PAGES=true, set by the deploy workflow) so the local dev server still runs at "/".
  base: process.env.GITHUB_PAGES === 'true' ? '/tidee-moments/' : '/',
  plugins: [react()],
  server: {
    port: Number(process.env.PORT) || 5173,
    allowedHosts: true,
  },
});
