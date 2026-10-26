import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// GitHub Pages などサブパスで公開する場合は VITE_BASE=/becky-filter-sorter/ のように指定する
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
