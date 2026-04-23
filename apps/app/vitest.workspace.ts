import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  {
    extends: './vitest.config.ts',
    test: {
      name: 'node',
      environment: 'node',
      include: ['src/**/*.test.ts'],
    },
  },
  {
    extends: './vitest.config.ts',
    test: {
      name: 'jsdom',
      environment: 'jsdom',
      include: ['src/**/*.test.tsx'],
      setupFiles: ['src/features/lod/test-setup.ts'],
    },
  },
]);
