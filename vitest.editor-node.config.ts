import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        name: 'editor-node',
        environment: 'node',
        include: ['editor/server/**/*.test.ts'],
        globals: false,
        clearMocks: true,
        restoreMocks: true,
        testTimeout: 15_000,
        hookTimeout: 15_000
    }
});
