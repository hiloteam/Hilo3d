import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        name: 'performance-contract',
        include: ['test/performance/**/*.test.ts'],
        environment: 'node',
        globals: false,
        browser: { enabled: false }
    }
});
