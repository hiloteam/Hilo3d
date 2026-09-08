import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        name: 'ui-contract',
        include: [
            'test/ui/example-paths.contract.ts',
            'test/ui/physics-scenes.contract.test.ts',
            'test/ui/character-scene.contract.test.ts',
            'test/ui/bridge-scene.contract.test.ts'
        ],
        environment: 'node',
        globals: false,
        browser: { enabled: false }
    }
});
