import { playwright } from '@vitest/browser-playwright';
import { defineConfig, mergeConfig } from 'vitest/config';
import { createViteConfig } from './vite.config';

export default mergeConfig(
    createViteConfig('test'),
    defineConfig({
        test: {
            name: 'browser',
            globals: false,
            clearMocks: true,
            restoreMocks: true,
            unstubEnvs: true,
            unstubGlobals: true,
            setupFiles: ['./test/setup.ts'],
            include: ['test/spec/**/*.test.ts'],
            testTimeout: 10_000,
            hookTimeout: 10_000,
            coverage: {
                provider: 'v8',
                include: ['src/**/*.ts'],
                exclude: ['src/**/*.d.ts'],
                reportsDirectory: 'coverage',
                reporter: ['text', 'json-summary', 'html'],
                reportOnFailure: true,
                thresholds: {
                    branches: 40,
                    functions: 58,
                    lines: 62,
                    statements: 60
                }
            },
            browser: {
                enabled: true,
                headless: true,
                provider: playwright({
                    launchOptions: {
                        args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader']
                    }
                }),
                instances: [{ browser: 'chromium' }]
            }
        }
    })
);
