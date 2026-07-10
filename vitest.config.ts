import { playwright } from '@vitest/browser-playwright';
import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

export default mergeConfig(viteConfig, defineConfig({
    test: {
        name: 'browser',
        globals: true,
        setupFiles: ['./test/setup.ts'],
        include: ['test/spec/**/*.test.ts', 'test/spec/**/GeometryData.ts'],
        testTimeout: 10_000,
        hookTimeout: 10_000,
        browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: 'chromium' }]
        }
    }
}));
