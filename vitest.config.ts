import { playwright } from '@vitest/browser-playwright';
import { defineConfig, mergeConfig } from 'vitest/config';
import { createViteConfig } from './vite.config';

const coverageRun = process.argv.includes('--coverage');

export default mergeConfig(
    createViteConfig(),
    defineConfig({
        test: {
            name: 'browser',
            globals: false,
            clearMocks: true,
            restoreMocks: true,
            unstubEnvs: true,
            unstubGlobals: true,
            setupFiles: ['./test/setup.ts'],
            include: ['test/spec/**/*.test.ts', 'examples/**/*.test.ts'],
            // Native WebGPU owns an actual device and must not share the heavily instrumented
            // coverage process. The dedicated RHI suite runs it immediately afterward.
            exclude: coverageRun ? ['test/spec/**/*.native.test.ts'] : [],
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
                        args: [
                            '--enable-unsafe-swiftshader',
                            '--enable-unsafe-webgpu',
                            '--use-angle=swiftshader',
                            '--use-webgpu-adapter=swiftshader'
                        ]
                    }
                }),
                instances: [{ browser: 'chromium' }]
            }
        }
    })
);
