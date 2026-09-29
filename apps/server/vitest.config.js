import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    projects: [
      {
        extends: true,
        test: { name: 'unit', include: ['tests/unit/**/*.test.js'] },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.js'],
          // Starts one ephemeral in-memory MongoDB for the whole run and
          // destroys it (and all data) afterwards.
          globalSetup: ['tests/integration/globalSetup.js'],
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
})
