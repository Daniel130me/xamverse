import { defineConfig } from 'vitest/config';

// The SDK is environment-agnostic (node tests; DOM only behind injectables).
// `css.postcss` is neutralized so vitest does not pick up the app's root
// postcss.config.mjs (Tailwind 4 plugin breaks Vite's plugin contract here).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
  css: {
    postcss: { plugins: [] },
  },
});
