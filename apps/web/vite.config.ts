import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // GitHub Pages serves the site from /<repo>/; CI sets BASE_PATH for that build.
  base: process.env.BASE_PATH ?? '/',
});
