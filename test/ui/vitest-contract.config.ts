import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        name: 'ui-contract',
        include: ['test/ui/example-paths.contract.ts'],
        environment: 'node',
        globals: false,
        browser: { enabled: false }
    }
});
