import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'shared', include: ['packages/shared/src/**/*.test.ts'] } },
      {
        test: {
          name: 'api',
          include: ['apps/api/src/**/*.test.ts'],
          // Cada archivo de tests usa su propia BD temporal (ver el setup).
          setupFiles: ['apps/api/test/setup.ts'],
        },
      },
    ],
  },
});
